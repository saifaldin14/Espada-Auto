/**
 * Infrastructure Knowledge Graph — In-Memory Graph Storage
 *
 * Test-friendly storage backend backed by Maps and arrays.
 * Implements the same GraphStorage interface as SQLiteGraphStorage.
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
  SyncRecord,
  TraversalDirection,
  GraphRelationshipType,
  CloudProvider,
  GraphGroupMember,
} from "../types.js";

function now(): string {
  return new Date().toISOString();
}

function inputToNode(input: GraphNodeInput): GraphNode {
  const ts = now();
  return {
    ...input,
    discoveredAt: input.discoveredAt ?? ts,
    updatedAt: input.updatedAt ?? ts,
    lastSeenAt: input.lastSeenAt ?? ts,
  };
}

function inputToEdge(input: GraphEdgeInput): GraphEdge {
  const ts = now();
  return {
    ...input,
    createdAt: input.createdAt ?? ts,
    lastSeenAt: input.lastSeenAt ?? ts,
  };
}

export class InMemoryGraphStorage implements GraphStorage {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private changes: GraphChange[] = [];
  private groups = new Map<string, GraphGroup>();
  private groupMembers: GraphGroupMember[] = [];
  private syncRecords: SyncRecord[] = [];

  async initialize(): Promise<void> {
    // No-op
  }

  async close(): Promise<void> {
    this.nodes.clear();
    this.edges.clear();
    this.changes = [];
    this.groups.clear();
    this.groupMembers = [];
    this.syncRecords = [];
  }

  // ---------- Nodes ----------

  async upsertNode(input: GraphNodeInput): Promise<void> {
    const existing = this.nodes.get(input.id);
    const node = inputToNode(input);
    if (existing) {
      node.discoveredAt = existing.discoveredAt;
    }
    this.nodes.set(input.id, node);
  }

  async upsertNodes(inputs: GraphNodeInput[]): Promise<void> {
    for (const input of inputs) {
      await this.upsertNode(input);
    }
  }

  async getNode(id: string): Promise<GraphNode | null> {
    return this.nodes.get(id) ?? null;
  }

  async getNodeByNativeId(provider: CloudProvider, nativeId: string): Promise<GraphNode | null> {
    for (const node of this.nodes.values()) {
      if (node.provider === provider && node.nativeId === nativeId) return node;
    }
    return null;
  }

  async queryNodes(filter: NodeFilter): Promise<GraphNode[]> {
    let results = Array.from(this.nodes.values());

    if (filter.provider) results = results.filter((n) => n.provider === filter.provider);
    if (filter.resourceType) {
      const types = Array.isArray(filter.resourceType) ? filter.resourceType : [filter.resourceType];
      results = results.filter((n) => types.includes(n.resourceType));
    }
    if (filter.region) results = results.filter((n) => n.region === filter.region);
    if (filter.account) results = results.filter((n) => n.account === filter.account);
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      results = results.filter((n) => statuses.includes(n.status));
    }
    if (filter.namePattern) {
      const lower = filter.namePattern.replace(/%/g, '').toLowerCase();
      results = results.filter((n) => n.name.toLowerCase().includes(lower));
    }
    if (filter.owner) results = results.filter((n) => n.owner === filter.owner);
    if (filter.minCost != null) results = results.filter((n) => (n.costMonthly ?? 0) >= filter.minCost!);
    if (filter.maxCost != null) results = results.filter((n) => (n.costMonthly ?? 0) <= filter.maxCost!);
    if (filter.tags) {
      for (const [key, value] of Object.entries(filter.tags)) {
        results = results.filter((n) => n.tags[key] === value);
      }
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  async queryNodesPaginated(
    filter: NodeFilter,
    pagination: PaginationOptions = {},
  ): Promise<PaginatedResult<GraphNode>> {
    const all = await this.queryNodes(filter);
    return paginateArray(all, pagination, (node) => node.id);
  }

  async deleteNode(id: string): Promise<void> {
    this.nodes.delete(id);
    // Cascade edges
    for (const [edgeId, edge] of this.edges) {
      if (edge.sourceNodeId === id || edge.targetNodeId === id) {
        this.edges.delete(edgeId);
      }
    }
    // Cascade group members
    this.groupMembers = this.groupMembers.filter((gm) => gm.nodeId !== id);
  }

  async markNodesDisappeared(olderThan: string, provider?: CloudProvider): Promise<string[]> {
    const disappeared: string[] = [];
    const ts = now();
    for (const [id, node] of this.nodes) {
      if (node.lastSeenAt < olderThan && node.status !== "disappeared") {
        if (provider && node.provider !== provider) continue;
        this.nodes.set(id, { ...node, status: "disappeared", updatedAt: ts });
        disappeared.push(id);
      }
    }
    return disappeared;
  }

  // ---------- Edges ----------

  async upsertEdge(input: GraphEdgeInput): Promise<void> {
    const existing = this.edges.get(input.id);
    const edge = inputToEdge(input);
    if (existing) {
      edge.createdAt = existing.createdAt;
    }
    this.edges.set(input.id, edge);
  }

  async upsertEdges(inputs: GraphEdgeInput[]): Promise<void> {
    for (const input of inputs) {
      await this.upsertEdge(input);
    }
  }

  async getEdge(id: string): Promise<GraphEdge | null> {
    return this.edges.get(id) ?? null;
  }

  async getEdgesForNode(
    nodeId: string,
    direction: TraversalDirection,
    relationshipType?: GraphRelationshipType,
  ): Promise<GraphEdge[]> {
    let results: GraphEdge[] = [];
    for (const edge of this.edges.values()) {
      const matchesDir =
        direction === "both"
          ? edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId
          : direction === "downstream"
            ? edge.sourceNodeId === nodeId
            : edge.targetNodeId === nodeId;
      if (matchesDir) {
        if (relationshipType && edge.relationshipType !== relationshipType) continue;
        results.push(edge);
      }
    }
    return results;
  }

  async queryEdges(filter: EdgeFilter): Promise<GraphEdge[]> {
    let results = Array.from(this.edges.values());

    if (filter.sourceNodeId) results = results.filter((e) => e.sourceNodeId === filter.sourceNodeId);
    if (filter.targetNodeId) results = results.filter((e) => e.targetNodeId === filter.targetNodeId);
    if (filter.relationshipType) {
      const types = Array.isArray(filter.relationshipType) ? filter.relationshipType : [filter.relationshipType];
      results = results.filter((e) => types.includes(e.relationshipType));
    }
    if (filter.minConfidence != null) results = results.filter((e) => e.confidence >= filter.minConfidence!);
    if (filter.discoveredVia) results = results.filter((e) => e.discoveredVia === filter.discoveredVia);

    return results;
  }

  async queryEdgesPaginated(
    filter: EdgeFilter,
    pagination: PaginationOptions = {},
  ): Promise<PaginatedResult<GraphEdge>> {
    const all = await this.queryEdges(filter);
    return paginateArray(all, pagination, (edge) => edge.id);
  }

  async deleteEdge(id: string): Promise<void> {
    this.edges.delete(id);
  }

  async deleteStaleEdges(olderThan: string): Promise<number> {
    let count = 0;
    for (const [id, edge] of this.edges) {
      if (edge.lastSeenAt < olderThan) {
        this.edges.delete(id);
        count++;
      }
    }
    return count;
  }

  // ---------- Changes ----------

  async appendChange(change: GraphChange): Promise<void> {
    this.changes.push(change);
  }

  async appendChanges(changes: GraphChange[]): Promise<void> {
    this.changes.push(...changes);
  }

  async getChanges(filter: ChangeFilter): Promise<GraphChange[]> {
    let results = [...this.changes];

    if (filter.targetId) results = results.filter((c) => c.targetId === filter.targetId);
    if (filter.changeType) {
      const types = Array.isArray(filter.changeType) ? filter.changeType : [filter.changeType];
      results = results.filter((c) => types.includes(c.changeType));
    }
    if (filter.since) results = results.filter((c) => c.detectedAt >= filter.since!);
    if (filter.until) results = results.filter((c) => c.detectedAt <= filter.until!);
    if (filter.detectedVia) results = results.filter((c) => c.detectedVia === filter.detectedVia);
    if (filter.correlationId) results = results.filter((c) => c.correlationId === filter.correlationId);
    if (filter.initiator) results = results.filter((c) => c.initiator === filter.initiator);
    if (filter.initiatorType) results = results.filter((c) => c.initiatorType === filter.initiatorType);

    return results.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  }

  async getChangesPaginated(
    filter: ChangeFilter,
    pagination: PaginationOptions = {},
  ): Promise<PaginatedResult<GraphChange>> {
    const all = await this.getChanges(filter);
    return paginateArray(all, pagination, (change) => change.id);
  }

  async getNodeTimeline(nodeId: string, limit = 100): Promise<GraphChange[]> {
    return this.changes
      .filter((c) => c.targetId === nodeId)
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
      .slice(0, limit);
  }

  // ---------- Groups ----------

  async upsertGroup(group: GraphGroup): Promise<void> {
    this.groups.set(group.id, group);
  }

  async getGroup(id: string): Promise<GraphGroup | null> {
    return this.groups.get(id) ?? null;
  }

  async listGroups(groupType?: GraphGroupType): Promise<GraphGroup[]> {
    let results = Array.from(this.groups.values());
    if (groupType) results = results.filter((g) => g.groupType === groupType);
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  async deleteGroup(id: string): Promise<void> {
    this.groups.delete(id);
    this.groupMembers = this.groupMembers.filter((gm) => gm.groupId !== id);
  }

  async addGroupMember(groupId: string, nodeId: string): Promise<void> {
    const exists = this.groupMembers.some((gm) => gm.groupId === groupId && gm.nodeId === nodeId);
    if (!exists) {
      this.groupMembers.push({ groupId, nodeId, addedAt: now() });
    }
  }

  async removeGroupMember(groupId: string, nodeId: string): Promise<void> {
    this.groupMembers = this.groupMembers.filter(
      (gm) => !(gm.groupId === groupId && gm.nodeId === nodeId),
    );
  }

  async getGroupMembers(groupId: string): Promise<GraphNode[]> {
    const nodeIds = this.groupMembers.filter((gm) => gm.groupId === groupId).map((gm) => gm.nodeId);
    const nodes: GraphNode[] = [];
    for (const id of nodeIds) {
      const node = this.nodes.get(id);
      if (node) nodes.push(node);
    }
    return nodes.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getNodeGroups(nodeId: string): Promise<GraphGroup[]> {
    const groupIds = this.groupMembers.filter((gm) => gm.nodeId === nodeId).map((gm) => gm.groupId);
    const groups: GraphGroup[] = [];
    for (const id of groupIds) {
      const group = this.groups.get(id);
      if (group) groups.push(group);
    }
    return groups.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------- Sync Records ----------

  async saveSyncRecord(record: SyncRecord): Promise<void> {
    this.syncRecords.push(record);
  }

  async getLastSyncRecord(provider?: CloudProvider): Promise<SyncRecord | null> {
    const filtered = provider
      ? this.syncRecords.filter((r) => r.provider === provider)
      : this.syncRecords;
    if (filtered.length === 0) return null;
    return filtered.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  }

  async listSyncRecords(limit = 50): Promise<SyncRecord[]> {
    return [...this.syncRecords]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  // ---------- Graph Traversal (BFS) ----------

  async getNeighbors(
    nodeId: string,
    depth: number,
    direction: TraversalDirection,
    edgeTypes?: GraphRelationshipType[],
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const maxDepth = Math.min(depth, 10);
    const visited = new Set<string>();
    const collectedEdges: GraphEdge[] = [];
    const queue: Array<{ id: string; d: number }> = [{ id: nodeId, d: 0 }];
    visited.add(nodeId);

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (item.d >= maxDepth) continue;

      for (const edge of this.edges.values()) {
        if (edgeTypes && !edgeTypes.includes(edge.relationshipType)) continue;

        let neighborId: string | null = null;
        if (
          (direction === "downstream" || direction === "both") &&
          edge.sourceNodeId === item.id
        ) {
          neighborId = edge.targetNodeId;
        }
        if (
          (direction === "upstream" || direction === "both") &&
          edge.targetNodeId === item.id
        ) {
          neighborId = edge.sourceNodeId;
        }

        if (neighborId && !visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ id: neighborId, d: item.d + 1 });
          collectedEdges.push(edge);
        } else if (neighborId && visited.has(neighborId)) {
          // Still collect the edge even if node already visited
          if (!collectedEdges.some((e) => e.id === edge.id)) {
            collectedEdges.push(edge);
          }
        }
      }
    }

    const nodes: GraphNode[] = [];
    for (const id of visited) {
      const node = this.nodes.get(id);
      if (node) nodes.push(node);
    }

    return { nodes, edges: collectedEdges };
  }

  // ---------- Stats ----------

  async getStats(): Promise<GraphStats> {
    const nodesByProvider: Record<string, number> = {};
    const nodesByResourceType: Record<string, number> = {};
    let totalCost = 0;

    for (const node of this.nodes.values()) {
      nodesByProvider[node.provider] = (nodesByProvider[node.provider] ?? 0) + 1;
      nodesByResourceType[node.resourceType] = (nodesByResourceType[node.resourceType] ?? 0) + 1;
      if (node.costMonthly != null) totalCost += node.costMonthly;
    }

    const edgesByRelationshipType: Record<string, number> = {};
    for (const edge of this.edges.values()) {
      edgesByRelationshipType[edge.relationshipType] =
        (edgesByRelationshipType[edge.relationshipType] ?? 0) + 1;
    }

    const sorted = [...this.changes].sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
    const lastSync = await this.getLastSyncRecord();

    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.size,
      totalChanges: this.changes.length,
      totalGroups: this.groups.size,
      nodesByProvider,
      nodesByResourceType,
      edgesByRelationshipType,
      totalCostMonthly: totalCost,
      lastSyncAt: lastSync?.startedAt ?? null,
      oldestChange: sorted[0]?.detectedAt ?? null,
      newestChange: sorted[sorted.length - 1]?.detectedAt ?? null,
    };
  }
}

// =============================================================================
// Pagination helpers
// =============================================================================

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;

/** Encode an offset-based cursor as a base64 string. */
function encodeCursor(offset: number): string {
  return Buffer.from(`off:${offset}`).toString("base64url");
}

/** Decode a base64url cursor back to a numeric offset. */
function decodeCursor(cursor: string): number {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const match = decoded.match(/^off:(\d+)$/);
  if (!match) throw new Error(`Invalid pagination cursor: ${cursor}`);
  const offset = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error(`Invalid pagination cursor offset: ${offset}`);
  }
  return offset;
}

/**
 * Apply cursor-based pagination to a pre-sorted in-memory array.
 * `idFn` extracts the unique ID from each item (used for type safety but the
 * cursor is offset-based for simplicity in the in-memory implementation).
 */
function paginateArray<T>(
  all: T[],
  pagination: PaginationOptions,
  _idFn: (item: T) => string,
): PaginatedResult<T> {
  const limit = Math.max(1, Math.min(pagination.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
  const offset = pagination.cursor ? decodeCursor(pagination.cursor) : 0;

  const items = all.slice(offset, offset + limit);
  const hasMore = offset + limit < all.length;

  return {
    items,
    totalCount: all.length,
    nextCursor: hasMore ? encodeCursor(offset + limit) : null,
    hasMore,
  };
}
