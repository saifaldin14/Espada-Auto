/**
 * Auth Bridge — Enterprise Auth ↔ Knowledge Graph
 *
 * Wraps GraphStorage with enterprise-auth RBAC enforcement. Maps the
 * enterprise-auth Permission model (`infra.read`, `infra.write`, `infra.delete`)
 * to graph operations. Falls back to the KG's built-in RBAC when the
 * enterprise-auth extension is unavailable.
 *
 * Key design decisions:
 *   - Uses the same GraphStorage interface so it's transparently composable
 *   - Audit events are emitted via the audit bridge (if available)
 *   - Graceful degradation: all operations pass through when auth is unavailable
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
  GraphStats,
  NodeFilter,
  EdgeFilter,
  ChangeFilter,
  PaginationOptions,
  PaginatedResult,
  CloudProvider,
  GraphRelationshipType,
  SyncRecord,
  TraversalDirection,
} from "../types.js";

import type {
  AuthEngine,
  AuthorizationResult,
  AuthUser,
  EnterprisePermission,
  AuditLoggerLike,
  BridgeLogger,
  IntegrationContext,
} from "./types.js";
import { withTimeout, CircuitBreaker } from "./resilience.js";

// =============================================================================
// Graph operation → Permission mapping
// =============================================================================

/** Maps graph storage operations to enterprise-auth permissions. */
const OP_PERMISSION_MAP: Record<string, EnterprisePermission> = {
  // Read operations
  getNode: "infra.read",
  getNodeByNativeId: "infra.read",
  queryNodes: "infra.read",
  queryNodesPaginated: "infra.read",
  getEdge: "infra.read",
  getEdgesForNode: "infra.read",
  queryEdges: "infra.read",
  queryEdgesPaginated: "infra.read",
  getChanges: "infra.read",
  getChangesPaginated: "infra.read",
  getNodeTimeline: "infra.read",
  getGroup: "infra.read",
  listGroups: "infra.read",
  getGroupMembers: "infra.read",
  getNodeGroups: "infra.read",
  getLastSyncRecord: "infra.read",
  listSyncRecords: "infra.read",
  getNeighbors: "infra.read",
  getStats: "infra.read",

  // Write operations
  initialize: "infra.admin",
  upsertNode: "infra.write",
  upsertNodes: "infra.write",
  upsertEdge: "infra.write",
  upsertEdges: "infra.write",
  appendChange: "infra.write",
  appendChanges: "infra.write",
  upsertGroup: "infra.write",
  addGroupMember: "infra.write",
  removeGroupMember: "infra.write",
  saveSyncRecord: "infra.write",
  markNodesDisappeared: "infra.write",

  // Delete operations
  deleteNode: "infra.delete",
  deleteEdge: "infra.delete",
  deleteStaleEdges: "infra.delete",
  deleteGroup: "infra.delete",

  // Lifecycle
  close: "infra.admin",
};

// =============================================================================
// Access Denied Error
// =============================================================================

export class EnterpriseAccessDeniedError extends Error {
  constructor(
    public readonly userId: string,
    public readonly operation: string,
    public readonly permission: EnterprisePermission,
    public readonly authResult: AuthorizationResult,
  ) {
    super(
      `Enterprise auth denied: user=${userId} operation=${operation} ` +
        `permission=${permission} reason=${authResult.reason}`,
    );
    this.name = "EnterpriseAccessDeniedError";
  }
}

// =============================================================================
// AuthenticatedGraphStorage
// =============================================================================

/**
 * GraphStorage wrapper that enforces enterprise-auth permissions on every
 * operation. Emits audit events when an audit logger is available.
 */
export class AuthenticatedGraphStorage implements GraphStorage {
  private readonly breaker = new CircuitBreaker("auth", 5, 30_000);
  private cachedUser: AuthUser | null = null;

  constructor(
    private readonly inner: GraphStorage,
    private readonly authEngine: AuthEngine,
    private readonly userId: string,
    private readonly logger: BridgeLogger,
    private readonly auditLogger?: AuditLoggerLike,
    private readonly userResolver?: (id: string) => Promise<AuthUser | null>,
  ) {}

  // -- Internal helpers -------------------------------------------------------

  /**
   * Resolve the full AuthUser from userId.
   * Caches the result to avoid repeated lookups per storage session.
   */
  private async resolveUser(): Promise<AuthUser> {
    if (this.cachedUser) return this.cachedUser;

    if (this.userResolver) {
      const user = await this.userResolver(this.userId);
      if (user) {
        this.cachedUser = user;
        return user;
      }
    }

    // Fallback: construct minimal user (roles will be empty — RbacEngine
    // will resolve roles from storage based on user.id)
    const fallback: AuthUser = {
      id: this.userId,
      email: `${this.userId}@unknown`,
      name: this.userId,
      roles: [],
      mfaEnabled: false,
      disabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.cachedUser = fallback;
    return fallback;
  }

  private async authorize(operation: string): Promise<void> {
    const permission = OP_PERMISSION_MAP[operation];
    if (!permission) {
      // Unknown operation — allow but log warning
      this.logger.warn(`No permission mapping for operation: ${operation}`);
      return;
    }

    const user = await this.resolveUser();
    const result = await this.breaker.execute(() =>
      withTimeout(
        this.authEngine.authorize(user, permission),
        5_000,
        `auth.authorize(${operation})`,
      ),
    );

    if (!result.allowed) {
      this.emitAudit(operation, "denied", {
        permission,
        reason: result.reason,
        missingPermissions: result.missingPermissions,
      });
      throw new EnterpriseAccessDeniedError(this.userId, operation, permission, result);
    }

    this.emitAudit(operation, "success", { permission, matchedRole: result.matchedRole });
  }

  private emitAudit(
    operation: string,
    result: "success" | "failure" | "denied",
    metadata?: Record<string, unknown>,
  ): void {
    if (!this.auditLogger) return;

    this.auditLogger.log({
      eventType: result === "denied" ? "auth_failed" : "tool_invoked",
      severity: result === "denied" ? "warn" : "info",
      actor: { id: this.userId, name: this.userId, roles: [] },
      operation: `kg.${operation}`,
      result,
      metadata: {
        bridge: "auth",
        ...metadata,
      },
    });
  }

  // -- Lifecycle ---------------------------------------------------------------

  async initialize(): Promise<void> {
    await this.authorize("initialize");
    return this.inner.initialize();
  }

  async close(): Promise<void> {
    // Always allow close to prevent resource leaks
    return this.inner.close();
  }

  // -- Nodes -------------------------------------------------------------------

  async upsertNode(node: GraphNodeInput): Promise<void> {
    await this.authorize("upsertNode");
    return this.inner.upsertNode(node);
  }

  async upsertNodes(nodes: GraphNodeInput[]): Promise<void> {
    await this.authorize("upsertNodes");
    return this.inner.upsertNodes(nodes);
  }

  async getNode(id: string): Promise<GraphNode | null> {
    await this.authorize("getNode");
    return this.inner.getNode(id);
  }

  async getNodeByNativeId(provider: CloudProvider, nativeId: string): Promise<GraphNode | null> {
    await this.authorize("getNodeByNativeId");
    return this.inner.getNodeByNativeId(provider, nativeId);
  }

  async queryNodes(filter: NodeFilter): Promise<GraphNode[]> {
    await this.authorize("queryNodes");
    return this.inner.queryNodes(filter);
  }

  async queryNodesPaginated(
    filter: NodeFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<GraphNode>> {
    await this.authorize("queryNodesPaginated");
    return this.inner.queryNodesPaginated(filter, pagination);
  }

  async deleteNode(id: string): Promise<void> {
    await this.authorize("deleteNode");
    return this.inner.deleteNode(id);
  }

  async markNodesDisappeared(olderThan: string, provider?: CloudProvider): Promise<string[]> {
    await this.authorize("markNodesDisappeared");
    return this.inner.markNodesDisappeared(olderThan, provider);
  }

  // -- Edges -------------------------------------------------------------------

  async upsertEdge(edge: GraphEdgeInput): Promise<void> {
    await this.authorize("upsertEdge");
    return this.inner.upsertEdge(edge);
  }

  async upsertEdges(edges: GraphEdgeInput[]): Promise<void> {
    await this.authorize("upsertEdges");
    return this.inner.upsertEdges(edges);
  }

  async getEdge(id: string): Promise<GraphEdge | null> {
    await this.authorize("getEdge");
    return this.inner.getEdge(id);
  }

  async getEdgesForNode(
    nodeId: string,
    direction: TraversalDirection,
    relationshipType?: GraphRelationshipType,
  ): Promise<GraphEdge[]> {
    await this.authorize("getEdgesForNode");
    return this.inner.getEdgesForNode(nodeId, direction, relationshipType);
  }

  async queryEdges(filter: EdgeFilter): Promise<GraphEdge[]> {
    await this.authorize("queryEdges");
    return this.inner.queryEdges(filter);
  }

  async queryEdgesPaginated(
    filter: EdgeFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<GraphEdge>> {
    await this.authorize("queryEdgesPaginated");
    return this.inner.queryEdgesPaginated(filter, pagination);
  }

  async deleteEdge(id: string): Promise<void> {
    await this.authorize("deleteEdge");
    return this.inner.deleteEdge(id);
  }

  async deleteStaleEdges(olderThan: string): Promise<number> {
    await this.authorize("deleteStaleEdges");
    return this.inner.deleteStaleEdges(olderThan);
  }

  // -- Changes ------------------------------------------------------------------

  async appendChange(change: GraphChange): Promise<void> {
    await this.authorize("appendChange");
    return this.inner.appendChange(change);
  }

  async appendChanges(changes: GraphChange[]): Promise<void> {
    await this.authorize("appendChanges");
    return this.inner.appendChanges(changes);
  }

  async getChanges(filter: ChangeFilter): Promise<GraphChange[]> {
    await this.authorize("getChanges");
    return this.inner.getChanges(filter);
  }

  async getChangesPaginated(
    filter: ChangeFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<GraphChange>> {
    await this.authorize("getChangesPaginated");
    return this.inner.getChangesPaginated(filter, pagination);
  }

  async getNodeTimeline(nodeId: string, limit?: number): Promise<GraphChange[]> {
    await this.authorize("getNodeTimeline");
    return this.inner.getNodeTimeline(nodeId, limit);
  }

  // -- Groups -------------------------------------------------------------------

  async upsertGroup(group: GraphGroup): Promise<void> {
    await this.authorize("upsertGroup");
    return this.inner.upsertGroup(group);
  }

  async getGroup(id: string): Promise<GraphGroup | null> {
    await this.authorize("getGroup");
    return this.inner.getGroup(id);
  }

  async listGroups(groupType?: GraphGroupType): Promise<GraphGroup[]> {
    await this.authorize("listGroups");
    return this.inner.listGroups(groupType);
  }

  async deleteGroup(id: string): Promise<void> {
    await this.authorize("deleteGroup");
    return this.inner.deleteGroup(id);
  }

  async addGroupMember(groupId: string, nodeId: string): Promise<void> {
    await this.authorize("addGroupMember");
    return this.inner.addGroupMember(groupId, nodeId);
  }

  async removeGroupMember(groupId: string, nodeId: string): Promise<void> {
    await this.authorize("removeGroupMember");
    return this.inner.removeGroupMember(groupId, nodeId);
  }

  async getGroupMembers(groupId: string): Promise<GraphNode[]> {
    await this.authorize("getGroupMembers");
    return this.inner.getGroupMembers(groupId);
  }

  async getNodeGroups(nodeId: string): Promise<GraphGroup[]> {
    await this.authorize("getNodeGroups");
    return this.inner.getNodeGroups(nodeId);
  }

  // -- Sync records -------------------------------------------------------------

  async saveSyncRecord(record: SyncRecord): Promise<void> {
    await this.authorize("saveSyncRecord");
    return this.inner.saveSyncRecord(record);
  }

  async getLastSyncRecord(provider?: CloudProvider): Promise<SyncRecord | null> {
    await this.authorize("getLastSyncRecord");
    return this.inner.getLastSyncRecord(provider);
  }

  async listSyncRecords(limit?: number): Promise<SyncRecord[]> {
    await this.authorize("listSyncRecords");
    return this.inner.listSyncRecords(limit);
  }

  // -- Graph traversal ----------------------------------------------------------

  async getNeighbors(
    nodeId: string,
    depth: number,
    direction: TraversalDirection,
    edgeTypes?: GraphRelationshipType[],
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    await this.authorize("getNeighbors");
    return this.inner.getNeighbors(nodeId, depth, direction, edgeTypes);
  }

  // -- Stats --------------------------------------------------------------------

  async getStats(): Promise<GraphStats> {
    await this.authorize("getStats");
    return this.inner.getStats();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Wrap a GraphStorage with enterprise-auth enforcement.
 *
 * If the auth engine is not available, returns the inner storage unwrapped
 * (graceful degradation).
 */
export function withEnterpriseAuth(
  storage: GraphStorage,
  ctx: IntegrationContext,
  userId: string,
): GraphStorage {
  if (!ctx.available.enterpriseAuth || !ctx.ext.authEngine) {
    ctx.logger.debug?.("Enterprise auth unavailable — passing through without auth enforcement");
    return storage;
  }

  const userResolver = ctx.ext.userResolver
    ? (id: string) => ctx.ext.userResolver!.getUser(id)
    : undefined;

  return new AuthenticatedGraphStorage(
    storage,
    ctx.ext.authEngine,
    userId,
    ctx.logger,
    ctx.ext.auditLogger,
    userResolver,
  );
}
