/**
 * Audit Bridge — Audit Trail ↔ Knowledge Graph
 *
 * Wraps GraphStorage to emit structured audit events on every mutation
 * (upsert, delete, change). Uses the audit-trail extension's AuditLogger
 * for persistent, queryable, tamper-resistant logging with sensitive field
 * redaction and buffered writes.
 *
 * Design:
 *   - Decorates the storage layer so audit is automatic & complete
 *   - Read-only operations are NOT audited (too noisy)
 *   - Every mutation records: who, what, when, and the affected resource
 *   - Falls through silently when audit-trail is unavailable
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
  AuditLoggerLike,
  BridgeLogger,
  IntegrationContext,
} from "./types.js";

// =============================================================================
// AuditedGraphStorage
// =============================================================================

/**
 * GraphStorage wrapper that emits audit events for all mutations.
 *
 * Audit events follow the audit-trail extension's schema:
 *   - eventType: resource_created | resource_updated | resource_deleted | state_changed
 *   - severity: info for normal ops, warn for deletes
 *   - resource: { type, id, provider } — the affected KG entity
 */
export class AuditedGraphStorage implements GraphStorage {
  constructor(
    private readonly inner: GraphStorage,
    private readonly auditLogger: AuditLoggerLike,
    private readonly actorId: string,
    private readonly logger: BridgeLogger,
  ) {}

  // -- Audit helper -----------------------------------------------------------

  private emit(
    eventType: string,
    operation: string,
    resource?: { type: string; id: string; provider?: string },
    metadata?: Record<string, unknown>,
    severity: "info" | "warn" | "error" | "critical" = "info",
  ): void {
    try {
      this.auditLogger.log({
        eventType,
        severity,
        actor: { id: this.actorId, name: this.actorId, roles: [] },
        operation: `kg.${operation}`,
        resource,
        result: "success",
        metadata: { bridge: "audit", ...metadata },
      });
    } catch (err) {
      this.logger.error(`Audit emit failed for ${operation}: ${err}`);
    }
  }

  // -- Lifecycle ---------------------------------------------------------------

  async initialize(): Promise<void> {
    this.emit("state_changed", "initialize");
    return this.inner.initialize();
  }

  async close(): Promise<void> {
    this.emit("state_changed", "close");
    return this.inner.close();
  }

  // -- Nodes -------------------------------------------------------------------

  async upsertNode(node: GraphNodeInput): Promise<void> {
    // Check if node exists to distinguish create vs update
    const existing = await this.inner.getNode(node.id);
    await this.inner.upsertNode(node);

    this.emit(
      existing ? "resource_updated" : "resource_created",
      existing ? "upsertNode:update" : "upsertNode:create",
      { type: node.resourceType, id: node.id, provider: node.provider },
      { name: node.name, region: node.region, account: node.account },
    );
  }

  async upsertNodes(nodes: GraphNodeInput[]): Promise<void> {
    await this.inner.upsertNodes(nodes);

    this.emit(
      "resource_updated",
      "upsertNodes",
      undefined,
      { count: nodes.length, providers: [...new Set(nodes.map((n) => n.provider))] },
    );
  }

  async getNode(id: string): Promise<GraphNode | null> {
    return this.inner.getNode(id);
  }

  async getNodeByNativeId(provider: CloudProvider, nativeId: string): Promise<GraphNode | null> {
    return this.inner.getNodeByNativeId(provider, nativeId);
  }

  async queryNodes(filter: NodeFilter): Promise<GraphNode[]> {
    return this.inner.queryNodes(filter);
  }

  async queryNodesPaginated(
    filter: NodeFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<GraphNode>> {
    return this.inner.queryNodesPaginated(filter, pagination);
  }

  async deleteNode(id: string): Promise<void> {
    const node = await this.inner.getNode(id);
    await this.inner.deleteNode(id);

    this.emit(
      "resource_deleted",
      "deleteNode",
      node
        ? { type: node.resourceType, id: node.id, provider: node.provider }
        : { type: "unknown", id },
      node ? { name: node.name } : undefined,
      "warn",
    );
  }

  async markNodesDisappeared(olderThan: string, provider?: CloudProvider): Promise<string[]> {
    const disappeared = await this.inner.markNodesDisappeared(olderThan, provider);

    if (disappeared.length > 0) {
      this.emit(
        "state_changed",
        "markNodesDisappeared",
        undefined,
        { count: disappeared.length, provider, olderThan },
        "warn",
      );
    }

    return disappeared;
  }

  // -- Edges -------------------------------------------------------------------

  async upsertEdge(edge: GraphEdgeInput): Promise<void> {
    await this.inner.upsertEdge(edge);

    this.emit(
      "resource_created",
      "upsertEdge",
      { type: "edge", id: edge.id },
      {
        relationshipType: edge.relationshipType,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
      },
    );
  }

  async upsertEdges(edges: GraphEdgeInput[]): Promise<void> {
    await this.inner.upsertEdges(edges);

    this.emit(
      "resource_updated",
      "upsertEdges",
      undefined,
      { count: edges.length },
    );
  }

  async getEdge(id: string): Promise<GraphEdge | null> {
    return this.inner.getEdge(id);
  }

  async getEdgesForNode(
    nodeId: string,
    direction: TraversalDirection,
    relationshipType?: GraphRelationshipType,
  ): Promise<GraphEdge[]> {
    return this.inner.getEdgesForNode(nodeId, direction, relationshipType);
  }

  async queryEdges(filter: EdgeFilter): Promise<GraphEdge[]> {
    return this.inner.queryEdges(filter);
  }

  async queryEdgesPaginated(
    filter: EdgeFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<GraphEdge>> {
    return this.inner.queryEdgesPaginated(filter, pagination);
  }

  async deleteEdge(id: string): Promise<void> {
    await this.inner.deleteEdge(id);

    this.emit(
      "resource_deleted",
      "deleteEdge",
      { type: "edge", id },
      undefined,
      "warn",
    );
  }

  async deleteStaleEdges(olderThan: string): Promise<number> {
    const count = await this.inner.deleteStaleEdges(olderThan);

    if (count > 0) {
      this.emit(
        "resource_deleted",
        "deleteStaleEdges",
        undefined,
        { count, olderThan },
        "warn",
      );
    }

    return count;
  }

  // -- Changes (append-only) ---------------------------------------------------

  async appendChange(change: GraphChange): Promise<void> {
    await this.inner.appendChange(change);

    this.emit(
      "state_changed",
      "appendChange",
      { type: "change", id: change.id },
      { changeType: change.changeType, targetId: change.targetId },
    );
  }

  async appendChanges(changes: GraphChange[]): Promise<void> {
    await this.inner.appendChanges(changes);

    this.emit(
      "state_changed",
      "appendChanges",
      undefined,
      { count: changes.length },
    );
  }

  async getChanges(filter: ChangeFilter): Promise<GraphChange[]> {
    return this.inner.getChanges(filter);
  }

  async getChangesPaginated(
    filter: ChangeFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<GraphChange>> {
    return this.inner.getChangesPaginated(filter, pagination);
  }

  async getNodeTimeline(nodeId: string, limit?: number): Promise<GraphChange[]> {
    return this.inner.getNodeTimeline(nodeId, limit);
  }

  // -- Groups -------------------------------------------------------------------

  async upsertGroup(group: GraphGroup): Promise<void> {
    await this.inner.upsertGroup(group);

    this.emit(
      "resource_updated",
      "upsertGroup",
      { type: "group", id: group.id },
      { name: group.name, groupType: group.groupType },
    );
  }

  async getGroup(id: string): Promise<GraphGroup | null> {
    return this.inner.getGroup(id);
  }

  async listGroups(groupType?: GraphGroupType): Promise<GraphGroup[]> {
    return this.inner.listGroups(groupType);
  }

  async deleteGroup(id: string): Promise<void> {
    await this.inner.deleteGroup(id);

    this.emit(
      "resource_deleted",
      "deleteGroup",
      { type: "group", id },
      undefined,
      "warn",
    );
  }

  async addGroupMember(groupId: string, nodeId: string): Promise<void> {
    await this.inner.addGroupMember(groupId, nodeId);

    this.emit(
      "state_changed",
      "addGroupMember",
      { type: "group", id: groupId },
      { nodeId },
    );
  }

  async removeGroupMember(groupId: string, nodeId: string): Promise<void> {
    await this.inner.removeGroupMember(groupId, nodeId);

    this.emit(
      "state_changed",
      "removeGroupMember",
      { type: "group", id: groupId },
      { nodeId },
    );
  }

  async getGroupMembers(groupId: string): Promise<GraphNode[]> {
    return this.inner.getGroupMembers(groupId);
  }

  async getNodeGroups(nodeId: string): Promise<GraphGroup[]> {
    return this.inner.getNodeGroups(nodeId);
  }

  // -- Sync records -------------------------------------------------------------

  async saveSyncRecord(record: SyncRecord): Promise<void> {
    await this.inner.saveSyncRecord(record);

    this.emit(
      "state_changed",
      "saveSyncRecord",
      { type: "sync", id: record.id, provider: record.provider === "all" ? undefined : record.provider },
      {
        status: record.status,
        nodesDiscovered: record.nodesDiscovered,
        nodesCreated: record.nodesCreated,
        durationMs: record.durationMs,
      },
    );
  }

  async getLastSyncRecord(provider?: CloudProvider): Promise<SyncRecord | null> {
    return this.inner.getLastSyncRecord(provider);
  }

  async listSyncRecords(limit?: number): Promise<SyncRecord[]> {
    return this.inner.listSyncRecords(limit);
  }

  // -- Graph traversal ----------------------------------------------------------

  async getNeighbors(
    nodeId: string,
    depth: number,
    direction: TraversalDirection,
    edgeTypes?: GraphRelationshipType[],
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    return this.inner.getNeighbors(nodeId, depth, direction, edgeTypes);
  }

  // -- Stats --------------------------------------------------------------------

  async getStats(): Promise<GraphStats> {
    return this.inner.getStats();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Wrap a GraphStorage with audit trail logging.
 *
 * If the audit logger is not available, returns the inner storage unwrapped
 * (graceful degradation).
 */
export function withAuditTrail(
  storage: GraphStorage,
  ctx: IntegrationContext,
  actorId: string = "system",
): GraphStorage {
  if (!ctx.available.auditTrail || !ctx.ext.auditLogger) {
    ctx.logger.debug?.("Audit trail unavailable — mutations will not be audited");
    return storage;
  }

  return new AuditedGraphStorage(storage, ctx.ext.auditLogger, actorId, ctx.logger);
}
