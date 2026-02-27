/**
 * Infrastructure Knowledge Graph — Role-Based Access Control (P3.23)
 *
 * Provides per-team, per-environment, per-provider access control on graph
 * queries. Wraps a GraphStorage implementation and filters results based
 * on the caller's role and scope permissions.
 *
 * Design goals:
 *   - Enforce least-privilege for graph read operations.
 *   - Allow fine-grained scoping by provider, account, region, resource type.
 *   - Support both role-based (RBAC) and attribute-based (ABAC) policies.
 *   - Zero-overhead when RBAC is disabled (no wrapping).
 *   - Audit every access decision for compliance.
 */

import type {
  GraphStorage,
  GraphNode,
  GraphNodeInput,
  GraphEdge,
  GraphEdgeInput,
  GraphChange,
  GraphGroup,
  GraphGroupType,
  NodeFilter,
  EdgeFilter,
  ChangeFilter,
  PaginationOptions,
  PaginatedResult,
  CloudProvider,
  GraphResourceType,
  GraphRelationshipType,
  SyncRecord,
  GraphStats,
  TraversalDirection,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

/** Built-in roles with increasing privilege. */
export type RBACRole = "viewer" | "operator" | "admin" | "superadmin";

/** Scope of access for a principal. */
export type AccessScope = {
  /** Allowed cloud providers (empty = all). */
  providers?: CloudProvider[];
  /** Allowed accounts (empty = all). */
  accounts?: string[];
  /** Allowed regions (empty = all). */
  regions?: string[];
  /** Allowed resource types (empty = all). */
  resourceTypes?: GraphResourceType[];
  /** Allowed tag filters — principal can only see nodes matching these tags. */
  requiredTags?: Record<string, string>;
};

/** Permissions granted by a role. */
export type RBACPermissions = {
  /** Can read nodes/edges/topology. */
  read: boolean;
  /** Can write (upsert/delete) nodes and edges. */
  write: boolean;
  /** Can read cost data. */
  readCost: boolean;
  /** Can view the change log. */
  readChanges: boolean;
  /** Can manage groups. */
  manageGroups: boolean;
  /** Can manage sync records. */
  manageSync: boolean;
  /** Can view graph stats. */
  readStats: boolean;
  /** Can perform graph traversals (blast radius, neighbors). */
  traverse: boolean;
  /** Can export topology. */
  export: boolean;
};

/** A principal (user/agent/service) with role + scope. */
export type RBACPrincipal = {
  /** Unique identifier (user ID, agent ID, API key, etc.). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Assigned role. */
  role: RBACRole;
  /** Access scope restrictions. */
  scope: AccessScope;
  /** Custom permission overrides (merged on top of role defaults). */
  permissionOverrides?: Partial<RBACPermissions>;
};

/** An RBAC policy binding principals to storage. */
export type RBACPolicy = {
  /** Whether RBAC is enabled. */
  enabled: boolean;
  /** Default role for unauthenticated/unknown principals. */
  defaultRole: RBACRole;
  /** Registered principals. */
  principals: RBACPrincipal[];
  /** Whether to log access decisions. */
  auditLog: boolean;
};

/** An access decision record for audit trails. */
export type AccessDecision = {
  /** When the decision was made. */
  timestamp: string;
  /** Principal ID. */
  principalId: string;
  /** Operation attempted. */
  operation: string;
  /** Whether access was granted. */
  granted: boolean;
  /** Reason for denial (if denied). */
  reason?: string;
  /** Number of results filtered out by scope. */
  filteredCount?: number;
};

/** Error thrown when access is denied. */
export class AccessDeniedError extends Error {
  constructor(
    public readonly principalId: string,
    public readonly operation: string,
    public readonly reason: string,
  ) {
    super(`Access denied for ${principalId}: ${reason} (operation: ${operation})`);
    this.name = "AccessDeniedError";
  }
}

// =============================================================================
// Role → Permissions Mapping
// =============================================================================

/** Default permissions for each role. */
const ROLE_PERMISSIONS: Record<RBACRole, RBACPermissions> = {
  viewer: {
    read: true,
    write: false,
    readCost: false,
    readChanges: false,
    manageGroups: false,
    manageSync: false,
    readStats: true,
    traverse: true,
    export: false,
  },
  operator: {
    read: true,
    write: false,
    readCost: true,
    readChanges: true,
    manageGroups: false,
    manageSync: false,
    readStats: true,
    traverse: true,
    export: true,
  },
  admin: {
    read: true,
    write: true,
    readCost: true,
    readChanges: true,
    manageGroups: true,
    manageSync: true,
    readStats: true,
    traverse: true,
    export: true,
  },
  superadmin: {
    read: true,
    write: true,
    readCost: true,
    readChanges: true,
    manageGroups: true,
    manageSync: true,
    readStats: true,
    traverse: true,
    export: true,
  },
};

/** Get effective permissions for a principal. */
export function getEffectivePermissions(principal: RBACPrincipal): RBACPermissions {
  const base = { ...ROLE_PERMISSIONS[principal.role] };
  if (principal.permissionOverrides) {
    return { ...base, ...principal.permissionOverrides };
  }
  return base;
}

/** Get permissions for a role (no overrides). */
export function getRolePermissions(role: RBACRole): RBACPermissions {
  return { ...ROLE_PERMISSIONS[role] };
}

// =============================================================================
// Scope Checking
// =============================================================================

/** Check if a node is within a principal's access scope. */
export function isNodeInScope(node: GraphNode, scope: AccessScope): boolean {
  if (scope.providers?.length && !scope.providers.includes(node.provider)) {
    return false;
  }
  if (scope.accounts?.length && !scope.accounts.includes(node.account)) {
    return false;
  }
  if (scope.regions?.length && !scope.regions.includes(node.region)) {
    return false;
  }
  if (scope.resourceTypes?.length && !scope.resourceTypes.includes(node.resourceType)) {
    return false;
  }
  if (scope.requiredTags) {
    for (const [key, value] of Object.entries(scope.requiredTags)) {
      if (node.tags[key] !== value) {
        return false;
      }
    }
  }
  return true;
}

/** Check if a node filter is compatible with a scope (pre-filter optimization). */
export function mergeFilterWithScope(
  filter: NodeFilter,
  scope: AccessScope,
): NodeFilter {
  const merged = { ...filter };

  // If scope restricts provider and filter doesn't, apply scope
  if (scope.providers?.length) {
    if (merged.provider) {
      // Filter already specifies a provider — check it's allowed
      if (!scope.providers.includes(merged.provider)) {
        // Return an impossible filter (no results)
        return { ...merged, provider: "custom" as CloudProvider, namePattern: "__rbac_no_match__" };
      }
    }
    // If only one provider in scope, pre-apply it
    if (scope.providers.length === 1 && !merged.provider) {
      merged.provider = scope.providers[0];
    }
  }

  if (scope.accounts?.length === 1 && !merged.account) {
    merged.account = scope.accounts[0];
  }

  if (scope.regions?.length === 1 && !merged.region) {
    merged.region = scope.regions[0];
  }

  // Merge required tags
  if (scope.requiredTags) {
    merged.tags = { ...(merged.tags ?? {}), ...scope.requiredTags };
  }

  return merged;
}

// =============================================================================
// RBAC-Wrapped Storage
// =============================================================================

/**
 * Wraps a GraphStorage implementation with RBAC enforcement.
 * All read operations are filtered by the principal's scope.
 * Write operations are gated by permission checks.
 */
export class RBACGraphStorage implements GraphStorage {
  private readonly auditLog: AccessDecision[] = [];

  constructor(
    private readonly inner: GraphStorage,
    private readonly principal: RBACPrincipal,
    private readonly policy: RBACPolicy,
  ) {}

  // -- Helpers -----------------------------------------------------------------

  private get permissions(): RBACPermissions {
    return getEffectivePermissions(this.principal);
  }

  private get scope(): AccessScope {
    return this.principal.scope;
  }

  private deny(operation: string, reason: string): never {
    this.logDecision(operation, false, reason);
    throw new AccessDeniedError(this.principal.id, operation, reason);
  }

  private requirePermission(operation: string, permission: keyof RBACPermissions): void {
    if (!this.permissions[permission]) {
      this.deny(operation, `Missing permission: ${permission}`);
    }
    this.logDecision(operation, true);
  }

  private logDecision(operation: string, granted: boolean, reason?: string, filteredCount?: number): void {
    if (!this.policy.auditLog) return;
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      principalId: this.principal.id,
      operation,
      granted,
      reason,
      filteredCount,
    });
  }

  /** Get the audit log of access decisions. */
  getAuditLog(): AccessDecision[] {
    return [...this.auditLog];
  }

  /** Filter nodes by scope. */
  private filterNodes(nodes: GraphNode[], operation: string): GraphNode[] {
    const filtered = nodes.filter((n) => isNodeInScope(n, this.scope));
    const removedCount = nodes.length - filtered.length;
    if (removedCount > 0) {
      this.logDecision(operation, true, undefined, removedCount);
    }
    return filtered;
  }

  /** Filter edges to only include those connecting in-scope nodes. */
  private async filterEdges(edges: GraphEdge[], operation: string): Promise<GraphEdge[]> {
    // Collect all referenced node IDs
    const nodeIds = new Set<string>();
    for (const e of edges) {
      nodeIds.add(e.sourceNodeId);
      nodeIds.add(e.targetNodeId);
    }

    // Check which nodes are in scope
    const inScopeIds = new Set<string>();
    for (const id of nodeIds) {
      const node = await this.inner.getNode(id);
      if (node && isNodeInScope(node, this.scope)) {
        inScopeIds.add(id);
      }
    }

    const filtered = edges.filter(
      (e) => inScopeIds.has(e.sourceNodeId) && inScopeIds.has(e.targetNodeId),
    );
    const removedCount = edges.length - filtered.length;
    if (removedCount > 0) {
      this.logDecision(operation, true, undefined, removedCount);
    }
    return filtered;
  }

  // -- Lifecycle ---------------------------------------------------------------

  async initialize(): Promise<void> {
    this.requirePermission("initialize", "write");
    return this.inner.initialize();
  }

  async close(): Promise<void> {
    return this.inner.close();
  }

  // -- Nodes -------------------------------------------------------------------

  async upsertNode(node: GraphNodeInput): Promise<void> {
    this.requirePermission("upsertNode", "write");
    return this.inner.upsertNode(node);
  }

  async upsertNodes(nodes: GraphNodeInput[]): Promise<void> {
    this.requirePermission("upsertNodes", "write");
    return this.inner.upsertNodes(nodes);
  }

  async getNode(id: string): Promise<GraphNode | null> {
    this.requirePermission("getNode", "read");
    const node = await this.inner.getNode(id);
    if (node && !isNodeInScope(node, this.scope)) {
      this.logDecision("getNode", true, undefined, 1);
      return null;
    }
    return node;
  }

  async getNodeByNativeId(provider: CloudProvider, nativeId: string): Promise<GraphNode | null> {
    this.requirePermission("getNodeByNativeId", "read");
    if (this.scope.providers?.length && !this.scope.providers.includes(provider)) {
      this.logDecision("getNodeByNativeId", true, undefined, 1);
      return null;
    }
    const node = await this.inner.getNodeByNativeId(provider, nativeId);
    if (node && !isNodeInScope(node, this.scope)) {
      this.logDecision("getNodeByNativeId", true, undefined, 1);
      return null;
    }
    return node;
  }

  async queryNodes(filter: NodeFilter): Promise<GraphNode[]> {
    this.requirePermission("queryNodes", "read");
    const mergedFilter = mergeFilterWithScope(filter, this.scope);
    const nodes = await this.inner.queryNodes(mergedFilter);
    return this.filterNodes(nodes, "queryNodes");
  }

  async queryNodesPaginated(
    filter: NodeFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<GraphNode>> {
    this.requirePermission("queryNodesPaginated", "read");
    const mergedFilter = mergeFilterWithScope(filter, this.scope);
    const result = await this.inner.queryNodesPaginated(mergedFilter, pagination);
    const filtered = this.filterNodes(result.items, "queryNodesPaginated");
    return {
      ...result,
      items: filtered,
      totalCount: filtered.length,
    };
  }

  async deleteNode(id: string): Promise<void> {
    this.requirePermission("deleteNode", "write");
    return this.inner.deleteNode(id);
  }

  async markNodesDisappeared(olderThan: string, provider?: CloudProvider): Promise<string[]> {
    this.requirePermission("markNodesDisappeared", "write");
    return this.inner.markNodesDisappeared(olderThan, provider);
  }

  // -- Edges -------------------------------------------------------------------

  async upsertEdge(edge: GraphEdgeInput): Promise<void> {
    this.requirePermission("upsertEdge", "write");
    return this.inner.upsertEdge(edge);
  }

  async upsertEdges(edges: GraphEdgeInput[]): Promise<void> {
    this.requirePermission("upsertEdges", "write");
    return this.inner.upsertEdges(edges);
  }

  async getEdge(id: string): Promise<GraphEdge | null> {
    this.requirePermission("getEdge", "read");
    const edge = await this.inner.getEdge(id);
    if (!edge) return null;
    const filtered = await this.filterEdges([edge], "getEdge");
    return filtered.length > 0 ? filtered[0]! : null;
  }

  async getEdgesForNode(
    nodeId: string,
    direction: TraversalDirection,
    relationshipType?: GraphRelationshipType,
  ): Promise<GraphEdge[]> {
    this.requirePermission("getEdgesForNode", "read");
    const edges = await this.inner.getEdgesForNode(nodeId, direction, relationshipType);
    return this.filterEdges(edges, "getEdgesForNode");
  }

  async queryEdges(filter: EdgeFilter): Promise<GraphEdge[]> {
    this.requirePermission("queryEdges", "read");
    const edges = await this.inner.queryEdges(filter);
    return this.filterEdges(edges, "queryEdges");
  }

  async queryEdgesPaginated(
    filter: EdgeFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<GraphEdge>> {
    this.requirePermission("queryEdgesPaginated", "read");
    const result = await this.inner.queryEdgesPaginated(filter, pagination);
    const filtered = await this.filterEdges(result.items, "queryEdgesPaginated");
    return {
      ...result,
      items: filtered,
      totalCount: filtered.length,
    };
  }

  async deleteEdge(id: string): Promise<void> {
    this.requirePermission("deleteEdge", "write");
    return this.inner.deleteEdge(id);
  }

  async deleteStaleEdges(olderThan: string): Promise<number> {
    this.requirePermission("deleteStaleEdges", "write");
    return this.inner.deleteStaleEdges(olderThan);
  }

  // -- Changes ------------------------------------------------------------------

  async appendChange(change: GraphChange): Promise<void> {
    this.requirePermission("appendChange", "write");
    return this.inner.appendChange(change);
  }

  async appendChanges(changes: GraphChange[]): Promise<void> {
    this.requirePermission("appendChanges", "write");
    return this.inner.appendChanges(changes);
  }

  async getChanges(filter: ChangeFilter): Promise<GraphChange[]> {
    this.requirePermission("getChanges", "readChanges");
    return this.inner.getChanges(filter);
  }

  async getChangesPaginated(
    filter: ChangeFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<GraphChange>> {
    this.requirePermission("getChangesPaginated", "readChanges");
    return this.inner.getChangesPaginated(filter, pagination);
  }

  async getNodeTimeline(nodeId: string, limit?: number): Promise<GraphChange[]> {
    this.requirePermission("getNodeTimeline", "readChanges");
    // Check the target node is in scope
    const node = await this.inner.getNode(nodeId);
    if (node && !isNodeInScope(node, this.scope)) {
      this.logDecision("getNodeTimeline", true, undefined, 1);
      return [];
    }
    return this.inner.getNodeTimeline(nodeId, limit);
  }

  // -- Groups -------------------------------------------------------------------

  async upsertGroup(group: GraphGroup): Promise<void> {
    this.requirePermission("upsertGroup", "manageGroups");
    return this.inner.upsertGroup(group);
  }

  async getGroup(id: string): Promise<GraphGroup | null> {
    this.requirePermission("getGroup", "read");
    return this.inner.getGroup(id);
  }

  async listGroups(groupType?: GraphGroupType): Promise<GraphGroup[]> {
    this.requirePermission("listGroups", "read");
    return this.inner.listGroups(groupType);
  }

  async deleteGroup(id: string): Promise<void> {
    this.requirePermission("deleteGroup", "manageGroups");
    return this.inner.deleteGroup(id);
  }

  async addGroupMember(groupId: string, nodeId: string): Promise<void> {
    this.requirePermission("addGroupMember", "manageGroups");
    return this.inner.addGroupMember(groupId, nodeId);
  }

  async removeGroupMember(groupId: string, nodeId: string): Promise<void> {
    this.requirePermission("removeGroupMember", "manageGroups");
    return this.inner.removeGroupMember(groupId, nodeId);
  }

  async getGroupMembers(groupId: string): Promise<GraphNode[]> {
    this.requirePermission("getGroupMembers", "read");
    const members = await this.inner.getGroupMembers(groupId);
    return this.filterNodes(members, "getGroupMembers");
  }

  async getNodeGroups(nodeId: string): Promise<GraphGroup[]> {
    this.requirePermission("getNodeGroups", "read");
    return this.inner.getNodeGroups(nodeId);
  }

  // -- Sync records -------------------------------------------------------------

  async saveSyncRecord(record: SyncRecord): Promise<void> {
    this.requirePermission("saveSyncRecord", "manageSync");
    return this.inner.saveSyncRecord(record);
  }

  async getLastSyncRecord(provider?: CloudProvider): Promise<SyncRecord | null> {
    this.requirePermission("getLastSyncRecord", "readStats");
    return this.inner.getLastSyncRecord(provider);
  }

  async listSyncRecords(limit?: number): Promise<SyncRecord[]> {
    this.requirePermission("listSyncRecords", "readStats");
    return this.inner.listSyncRecords(limit);
  }

  // -- Graph traversal ----------------------------------------------------------

  async getNeighbors(
    nodeId: string,
    depth: number,
    direction: TraversalDirection,
    edgeTypes?: GraphRelationshipType[],
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    this.requirePermission("getNeighbors", "traverse");
    const result = await this.inner.getNeighbors(nodeId, depth, direction, edgeTypes);
    const filteredNodes = this.filterNodes(result.nodes, "getNeighbors");
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = result.edges.filter(
      (e) => filteredNodeIds.has(e.sourceNodeId) && filteredNodeIds.has(e.targetNodeId),
    );
    return { nodes: filteredNodes, edges: filteredEdges };
  }

  // -- Stats --------------------------------------------------------------------

  async getStats(): Promise<GraphStats> {
    this.requirePermission("getStats", "readStats");
    // Superadmin gets unfiltered stats; others get filtered
    if (this.principal.role === "superadmin") {
      return this.inner.getStats();
    }
    // For scoped principals, compute stats from filtered nodes
    const nodes = await this.queryNodes({});
    const edges = await this.queryEdges({});

    const nodesByProvider: Record<string, number> = {};
    const nodesByResourceType: Record<string, number> = {};
    let totalCost = 0;
    for (const n of nodes) {
      nodesByProvider[n.provider] = (nodesByProvider[n.provider] ?? 0) + 1;
      nodesByResourceType[n.resourceType] = (nodesByResourceType[n.resourceType] ?? 0) + 1;
      if (n.costMonthly != null) totalCost += n.costMonthly;
    }

    const edgesByRelationshipType: Record<string, number> = {};
    for (const e of edges) {
      edgesByRelationshipType[e.relationshipType] =
        (edgesByRelationshipType[e.relationshipType] ?? 0) + 1;
    }

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      totalChanges: 0, // Not computed for scoped views
      totalGroups: 0,
      nodesByProvider,
      nodesByResourceType,
      edgesByRelationshipType,
      totalCostMonthly: totalCost,
      lastSyncAt: null,
      oldestChange: null,
      newestChange: null,
    };
  }
}

// =============================================================================
// Policy Management
// =============================================================================

/** Default policy — RBAC disabled, full access for everyone. */
export const DEFAULT_RBAC_POLICY: RBACPolicy = {
  enabled: false,
  defaultRole: "admin",
  principals: [],
  auditLog: false,
};

/**
 * Create an RBAC policy with the given principals.
 */
export function createRBACPolicy(
  principals: RBACPrincipal[],
  options: { defaultRole?: RBACRole; auditLog?: boolean } = {},
): RBACPolicy {
  return {
    enabled: true,
    defaultRole: options.defaultRole ?? "viewer",
    principals,
    auditLog: options.auditLog ?? true,
  };
}

/**
 * Look up a principal by ID from a policy. Falls back to an anonymous
 * principal with the policy's default role if not found.
 */
export function resolvePrincipal(
  policy: RBACPolicy,
  principalId: string,
): RBACPrincipal {
  const found = policy.principals.find((p) => p.id === principalId);
  if (found) return found;

  // Anonymous / unknown principal: gets default role with empty scope
  return {
    id: principalId,
    name: "Unknown",
    role: policy.defaultRole,
    scope: {},
  };
}

/**
 * Wrap a GraphStorage with RBAC enforcement for a specific principal.
 * Returns the original storage unwrapped if RBAC is disabled.
 */
export function withRBAC(
  storage: GraphStorage,
  policy: RBACPolicy,
  principalId: string,
): GraphStorage {
  if (!policy.enabled) return storage;

  const principal = resolvePrincipal(policy, principalId);
  return new RBACGraphStorage(storage, principal, policy);
}

/**
 * Format an RBAC policy summary as markdown.
 */
export function formatRBACPolicyMarkdown(policy: RBACPolicy): string {
  const lines: string[] = [
    "# RBAC Policy Summary",
    "",
    `**Enabled:** ${policy.enabled}`,
    `**Default Role:** ${policy.defaultRole}`,
    `**Audit Logging:** ${policy.auditLog}`,
    `**Principals:** ${policy.principals.length}`,
    "",
  ];

  if (policy.principals.length > 0) {
    lines.push(
      "## Principals",
      "",
      "| ID | Name | Role | Providers | Accounts | Regions | Resource Types |",
      "|----|------|------|-----------|----------|---------|----------------|",
      ...policy.principals.map((p) =>
        `| ${p.id} | ${p.name} | ${p.role} | ${p.scope.providers?.join(", ") ?? "all"} | ${p.scope.accounts?.join(", ") ?? "all"} | ${p.scope.regions?.join(", ") ?? "all"} | ${p.scope.resourceTypes?.join(", ") ?? "all"} |`,
      ),
      "",
    );
  }

  lines.push(
    "## Role Permissions",
    "",
    "| Role | Read | Write | Cost | Changes | Groups | Sync | Stats | Traverse | Export |",
    "|------|------|-------|------|---------|--------|------|-------|----------|--------|",
    ...Object.entries(ROLE_PERMISSIONS).map(([role, perms]) =>
      `| ${role} | ${perms.read ? "✅" : "❌"} | ${perms.write ? "✅" : "❌"} | ${perms.readCost ? "✅" : "❌"} | ${perms.readChanges ? "✅" : "❌"} | ${perms.manageGroups ? "✅" : "❌"} | ${perms.manageSync ? "✅" : "❌"} | ${perms.readStats ? "✅" : "❌"} | ${perms.traverse ? "✅" : "❌"} | ${perms.export ? "✅" : "❌"} |`,
    ),
  );

  return lines.join("\n");
}
