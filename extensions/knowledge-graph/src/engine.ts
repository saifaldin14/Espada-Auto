/**
 * Infrastructure Knowledge Graph — Graph Engine
 *
 * Central orchestrator that coordinates adapters, storage, and queries.
 * Handles sync (full & incremental), blast-radius analysis, drift detection,
 * cost aggregation, and change tracking.
 */

import type {
  GraphStorage,
  GraphNode,
  GraphNodeInput,
  GraphEdge,
  GraphChange,
  SubgraphResult,
  DriftResult,
  CostAttribution,
  NodeFilter,
  SyncRecord,
  GraphRelationshipType,
  CloudProvider,
  GraphStats,
  TraversalDirection,
} from "./types.js";
import type { GraphDiscoveryAdapter, DiscoverOptions } from "./adapters/types.js";
import { AdapterRegistry } from "./adapters/types.js";

// =============================================================================
// Engine Configuration
// =============================================================================

export type GraphEngineConfig = {
  /** Max traversal depth for blast radius / dependency queries. */
  maxTraversalDepth: number;
  /** When marking nodes disappeared, use this threshold (ISO duration from now). */
  staleThresholdMs: number;
  /** Whether to auto-detect drift on every sync. */
  enableDriftDetection: boolean;
  /** Whether to delete edges whose nodes have disappeared. */
  pruneOrphanedEdges: boolean;
};

export const defaultEngineConfig: GraphEngineConfig = {
  maxTraversalDepth: 8,
  staleThresholdMs: 24 * 60 * 60 * 1000, // 24 hours
  enableDriftDetection: true,
  pruneOrphanedEdges: true,
};

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Diff two values and return whether they changed.
 * Handles JSON-serialized complex values.
 */
function valuesChanged(a: unknown, b: unknown): boolean {
  if (a === b) return false;
  if (a == null && b == null) return false;
  const sa = typeof a === "object" ? JSON.stringify(a) : String(a ?? "");
  const sb = typeof b === "object" ? JSON.stringify(b) : String(b ?? "");
  return sa !== sb;
}

// =============================================================================
// Graph Engine
// =============================================================================

export class GraphEngine {
  private storage: GraphStorage;
  private adapters: AdapterRegistry;
  private config: GraphEngineConfig;

  constructor(options: {
    storage: GraphStorage;
    adapters?: AdapterRegistry;
    config?: Partial<GraphEngineConfig>;
  }) {
    this.storage = options.storage;
    this.adapters = options.adapters ?? new AdapterRegistry();
    this.config = { ...defaultEngineConfig, ...options.config };
  }

  /** Register a provider adapter. */
  registerAdapter(adapter: GraphDiscoveryAdapter): void {
    this.adapters.register(adapter);
  }

  /** Get storage for direct queries. */
  getStorage(): GraphStorage {
    return this.storage;
  }

  /** Get graph statistics. */
  async getStats(): Promise<GraphStats> {
    return this.storage.getStats();
  }

  // ===========================================================================
  // Sync
  // ===========================================================================

  /**
   * Run a full discovery sync across all registered adapters (or a subset).
   *
   * For each adapter:
   *   1. Discover all resources and relationships
   *   2. Upsert nodes (detect creates/updates)
   *   3. Upsert edges
   *   4. Mark stale nodes as disappeared
   *   5. Record changes
   *   6. Save sync record
   */
  async sync(options?: {
    providers?: CloudProvider[];
    discoverOptions?: DiscoverOptions;
  }): Promise<SyncRecord[]> {
    const targetAdapters = options?.providers
      ? options.providers
          .map((p) => this.adapters.get(p))
          .filter((a): a is GraphDiscoveryAdapter => a != null)
      : this.adapters.getAll();

    const syncRecords: SyncRecord[] = [];

    for (const adapter of targetAdapters) {
      const record = await this.syncProvider(adapter, options?.discoverOptions);
      syncRecords.push(record);
    }

    return syncRecords;
  }

  /**
   * Sync a single provider adapter.
   */
  private async syncProvider(
    adapter: GraphDiscoveryAdapter,
    discoverOptions?: DiscoverOptions,
  ): Promise<SyncRecord> {
    const syncId = `sync-${adapter.provider}-${generateId()}`;
    const startedAt = now();
    const startMs = Date.now();

    const record: SyncRecord = {
      id: syncId,
      provider: adapter.provider,
      status: "running",
      startedAt,
      completedAt: null,
      nodesDiscovered: 0,
      nodesCreated: 0,
      nodesUpdated: 0,
      nodesDisappeared: 0,
      edgesDiscovered: 0,
      edgesCreated: 0,
      edgesRemoved: 0,
      changesRecorded: 0,
      errors: [],
      durationMs: null,
    };

    try {
      const result = await adapter.discover(discoverOptions);
      record.nodesDiscovered = result.nodes.length;
      record.edgesDiscovered = result.edges.length;
      record.errors = result.errors.map((e) => `${e.resourceType}${e.region ? ` (${e.region})` : ""}: ${e.message}`);

      // Process nodes — detect creates vs updates
      const changes: GraphChange[] = [];

      for (const nodeInput of result.nodes) {
        const existing = await this.storage.getNode(nodeInput.id);

        if (!existing) {
          // New node
          record.nodesCreated++;
          changes.push({
            id: generateId(),
            targetId: nodeInput.id,
            changeType: "node-created",
            field: null,
            previousValue: null,
            newValue: nodeInput.name,
            detectedAt: now(),
            detectedVia: "sync",
            correlationId: syncId,
            initiator: null,
            initiatorType: null,
            metadata: { provider: adapter.provider, resourceType: nodeInput.resourceType },
          });
        } else {
          // Existing node — check for field-level changes
          const fieldChanges = this.diffNode(existing, nodeInput);
          if (fieldChanges.length > 0) {
            record.nodesUpdated++;
            changes.push(...fieldChanges.map((fc) => ({
              ...fc,
              correlationId: syncId,
            })));
          }
        }
      }

      // Batch upsert nodes
      await this.storage.upsertNodes(result.nodes);

      // Process edges — detect new edges
      for (const edgeInput of result.edges) {
        const existing = await this.storage.getEdge(edgeInput.id);
        if (!existing) {
          record.edgesCreated++;
          changes.push({
            id: generateId(),
            targetId: edgeInput.id,
            changeType: "edge-created",
            field: null,
            previousValue: null,
            newValue: `${edgeInput.sourceNodeId} -[${edgeInput.relationshipType}]-> ${edgeInput.targetNodeId}`,
            detectedAt: now(),
            detectedVia: "sync",
            correlationId: syncId,
            initiator: null,
            initiatorType: null,
            metadata: { relationshipType: edgeInput.relationshipType },
          });
        }
      }

      // Batch upsert edges
      await this.storage.upsertEdges(result.edges);

      // Mark stale nodes as disappeared
      const staleThreshold = new Date(startMs - this.config.staleThresholdMs).toISOString();
      const disappeared = await this.storage.markNodesDisappeared(staleThreshold, adapter.provider);
      record.nodesDisappeared = disappeared.length;
      for (const nodeId of disappeared) {
        changes.push({
          id: generateId(),
          targetId: nodeId,
          changeType: "node-disappeared",
          field: "status",
          previousValue: null,
          newValue: "disappeared",
          detectedAt: now(),
          detectedVia: "sync",
          correlationId: syncId,
          initiator: null,
          initiatorType: null,
          metadata: {},
        });
      }

      // Prune orphaned edges
      if (this.config.pruneOrphanedEdges) {
        const removed = await this.storage.deleteStaleEdges(staleThreshold);
        record.edgesRemoved = removed;
      }

      // Persist all changes
      if (changes.length > 0) {
        await this.storage.appendChanges(changes);
      }
      record.changesRecorded = changes.length;

      record.status = record.errors.length > 0 ? "partial" : "completed";
    } catch (error) {
      record.status = "failed";
      record.errors.push(error instanceof Error ? error.message : String(error));
    }

    record.completedAt = now();
    record.durationMs = Date.now() - startMs;
    await this.storage.saveSyncRecord(record);

    return record;
  }

  /**
   * Diff an existing node against a new input to find changed fields.
   */
  private diffNode(existing: GraphNode, input: GraphNodeInput): GraphChange[] {
    const changes: GraphChange[] = [];
    const ts = now();

    const fields: Array<{ key: string; oldVal: unknown; newVal: unknown }> = [
      { key: "name", oldVal: existing.name, newVal: input.name },
      { key: "status", oldVal: existing.status, newVal: input.status },
      { key: "region", oldVal: existing.region, newVal: input.region },
      { key: "owner", oldVal: existing.owner, newVal: input.owner },
      { key: "costMonthly", oldVal: existing.costMonthly, newVal: input.costMonthly },
    ];

    for (const { key, oldVal, newVal } of fields) {
      if (valuesChanged(oldVal, newVal)) {
        changes.push({
          id: generateId(),
          targetId: existing.id,
          changeType: "node-updated",
          field: key,
          previousValue: oldVal == null ? null : String(oldVal),
          newValue: newVal == null ? null : String(newVal),
          detectedAt: ts,
          detectedVia: "sync",
          correlationId: null,
          initiator: null,
          initiatorType: null,
          metadata: {},
        });
      }
    }

    // Check tags diff
    if (valuesChanged(existing.tags, input.tags)) {
      changes.push({
        id: generateId(),
        targetId: existing.id,
        changeType: "node-updated",
        field: "tags",
        previousValue: JSON.stringify(existing.tags),
        newValue: JSON.stringify(input.tags),
        detectedAt: ts,
        detectedVia: "sync",
        correlationId: null,
        initiator: null,
        initiatorType: null,
        metadata: {},
      });
    }

    // Check metadata diff
    if (valuesChanged(existing.metadata, input.metadata)) {
      changes.push({
        id: generateId(),
        targetId: existing.id,
        changeType: "node-updated",
        field: "metadata",
        previousValue: JSON.stringify(existing.metadata),
        newValue: JSON.stringify(input.metadata),
        detectedAt: ts,
        detectedVia: "sync",
        correlationId: null,
        initiator: null,
        initiatorType: null,
        metadata: {},
      });
    }

    // Cost change gets its own type
    if (valuesChanged(existing.costMonthly, input.costMonthly)) {
      changes.push({
        id: generateId(),
        targetId: existing.id,
        changeType: "cost-changed",
        field: "costMonthly",
        previousValue: existing.costMonthly == null ? null : String(existing.costMonthly),
        newValue: input.costMonthly == null ? null : String(input.costMonthly),
        detectedAt: ts,
        detectedVia: "sync",
        correlationId: null,
        initiator: null,
        initiatorType: null,
        metadata: {},
      });
    }

    return changes;
  }

  // ===========================================================================
  // Blast Radius Analysis
  // ===========================================================================

  /**
   * Compute the blast radius of a change to the given node.
   *
   * Returns all nodes reachable within `depth` hops, grouped by distance.
   * Used by the confirmation workflow to show what will be affected.
   */
  async getBlastRadius(
    nodeId: string,
    depth?: number,
    edgeTypes?: GraphRelationshipType[],
  ): Promise<SubgraphResult> {
    const maxDepth = depth ?? this.config.maxTraversalDepth;
    const rootNode = await this.storage.getNode(nodeId);

    if (!rootNode) {
      return {
        rootNodeId: nodeId,
        nodes: new Map(),
        edges: [],
        hops: new Map(),
        totalCostMonthly: 0,
      };
    }

    // Get all reachable nodes (both directions — anything connected is affected)
    const { nodes, edges } = await this.storage.getNeighbors(
      nodeId,
      maxDepth,
      "both",
      edgeTypes,
    );

    // Compute hop distances via BFS
    const hops = this.computeHopDistances(nodeId, nodes, edges);

    // Build result
    const nodeMap = new Map<string, GraphNode>();
    let totalCost = 0;
    for (const node of nodes) {
      nodeMap.set(node.id, node);
      if (node.costMonthly != null) totalCost += node.costMonthly;
    }

    return {
      rootNodeId: nodeId,
      nodes: nodeMap,
      edges,
      hops,
      totalCostMonthly: totalCost,
    };
  }

  /**
   * Get the dependency chain for a node in one direction.
   *
   * - upstream: "what does this node depend on?"
   * - downstream: "what depends on this node?"
   */
  async getDependencyChain(
    nodeId: string,
    direction: TraversalDirection,
    depth?: number,
    edgeTypes?: GraphRelationshipType[],
  ): Promise<SubgraphResult> {
    const maxDepth = depth ?? this.config.maxTraversalDepth;
    const rootNode = await this.storage.getNode(nodeId);

    if (!rootNode) {
      return {
        rootNodeId: nodeId,
        nodes: new Map(),
        edges: [],
        hops: new Map(),
        totalCostMonthly: 0,
      };
    }

    const { nodes, edges } = await this.storage.getNeighbors(
      nodeId,
      maxDepth,
      direction,
      edgeTypes,
    );

    const hops = this.computeHopDistances(nodeId, nodes, edges);

    const nodeMap = new Map<string, GraphNode>();
    let totalCost = 0;
    for (const node of nodes) {
      nodeMap.set(node.id, node);
      if (node.costMonthly != null) totalCost += node.costMonthly;
    }

    return {
      rootNodeId: nodeId,
      nodes: nodeMap,
      edges,
      hops,
      totalCostMonthly: totalCost,
    };
  }

  /**
   * BFS to compute hop distances from a root node.
   */
  private computeHopDistances(
    rootId: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): Map<number, string[]> {
    // Build adjacency list
    const adj = new Map<string, Set<string>>();
    for (const node of nodes) {
      adj.set(node.id, new Set());
    }
    for (const edge of edges) {
      adj.get(edge.sourceNodeId)?.add(edge.targetNodeId);
      adj.get(edge.targetNodeId)?.add(edge.sourceNodeId);
    }

    // BFS
    const distances = new Map<string, number>();
    distances.set(rootId, 0);
    const queue = [rootId];
    let head = 0;

    while (head < queue.length) {
      const current = queue[head++];
      const currentDist = distances.get(current)!;
      const neighbors = adj.get(current);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (!distances.has(neighbor)) {
          distances.set(neighbor, currentDist + 1);
          queue.push(neighbor);
        }
      }
    }

    // Group by hop distance
    const hops = new Map<number, string[]>();
    for (const [nodeId, dist] of distances) {
      const existing = hops.get(dist) ?? [];
      existing.push(nodeId);
      hops.set(dist, existing);
    }

    return hops;
  }

  // ===========================================================================
  // Drift Detection
  // ===========================================================================

  /**
   * Detect drift by comparing current provider state against stored graph state.
   *
   * Re-discovers resources from a specific provider and compares against
   * what's in the graph, without updating the graph. Use `sync()` to
   * both detect and persist changes.
   */
  async detectDrift(provider?: CloudProvider): Promise<DriftResult> {
    const targetAdapters = provider
      ? [this.adapters.get(provider)].filter((a): a is GraphDiscoveryAdapter => a != null)
      : this.adapters.getAll();

    const driftedNodes: DriftResult["driftedNodes"] = [];
    const disappearedNodes: GraphNode[] = [];
    const newNodes: GraphNode[] = [];
    const scanTime = now();

    for (const adapter of targetAdapters) {
      const result = await adapter.discover();

      // Check new and changed nodes
      for (const nodeInput of result.nodes) {
        const existing = await this.storage.getNode(nodeInput.id);

        if (!existing) {
          newNodes.push({
            ...nodeInput,
            discoveredAt: scanTime,
            updatedAt: scanTime,
            lastSeenAt: scanTime,
          });
        } else {
          const changes = this.diffNode(existing, nodeInput);
          if (changes.length > 0) {
            // Mark as drifted
            const driftChanges = changes.map((c) => ({
              ...c,
              changeType: "node-drifted" as const,
              detectedVia: "drift-scan" as const,
            }));
            driftedNodes.push({ node: existing, changes: driftChanges });
          }
        }
      }

      // Check for disappeared nodes
      const discoveredIds = new Set(result.nodes.map((n) => n.id));
      const storedNodes = await this.storage.queryNodes({
        provider: adapter.provider,
        status: ["running", "stopped", "pending", "creating", "unknown"],
      });

      for (const stored of storedNodes) {
        if (!discoveredIds.has(stored.id)) {
          disappearedNodes.push(stored);
        }
      }
    }

    return {
      driftedNodes,
      disappearedNodes,
      newNodes,
      scannedAt: scanTime,
    };
  }

  // ===========================================================================
  // Cost Attribution
  // ===========================================================================

  /**
   * Get cost attribution for a single node and its downstream dependencies.
   */
  async getNodeCost(nodeId: string, includeDownstream = false): Promise<CostAttribution> {
    const node = await this.storage.getNode(nodeId);
    if (!node) {
      return { label: nodeId, totalMonthly: 0, byResourceType: {}, byProvider: {}, nodes: [] };
    }

    let targetNodes: GraphNode[];
    if (includeDownstream) {
      const { nodes } = await this.storage.getNeighbors(nodeId, this.config.maxTraversalDepth, "downstream");
      targetNodes = nodes;
    } else {
      targetNodes = [node];
    }

    return this.buildCostAttribution(node.name, targetNodes);
  }

  /**
   * Get cost attribution for a group.
   */
  async getGroupCost(groupId: string): Promise<CostAttribution> {
    const group = await this.storage.getGroup(groupId);
    if (!group) {
      return { label: groupId, totalMonthly: 0, byResourceType: {}, byProvider: {}, nodes: [] };
    }

    const members = await this.storage.getGroupMembers(groupId);
    return this.buildCostAttribution(group.name, members);
  }

  /**
   * Get cost attribution for a filtered set of nodes.
   */
  async getCostByFilter(filter: NodeFilter, label?: string): Promise<CostAttribution> {
    const nodes = await this.storage.queryNodes(filter);
    return this.buildCostAttribution(label ?? "filtered", nodes);
  }

  private buildCostAttribution(label: string, nodes: GraphNode[]): CostAttribution {
    const byResourceType: Record<string, number> = {};
    const byProvider: Record<string, number> = {};
    const nodeEntries: CostAttribution["nodes"] = [];
    let total = 0;

    for (const node of nodes) {
      const cost = node.costMonthly ?? 0;
      total += cost;
      byResourceType[node.resourceType] = (byResourceType[node.resourceType] ?? 0) + cost;
      byProvider[node.provider] = (byProvider[node.provider] ?? 0) + cost;
      if (cost > 0) {
        nodeEntries.push({
          nodeId: node.id,
          name: node.name,
          resourceType: node.resourceType,
          costMonthly: cost,
        });
      }
    }

    // Sort by cost descending
    nodeEntries.sort((a, b) => b.costMonthly - a.costMonthly);

    return {
      label,
      totalMonthly: total,
      byResourceType,
      byProvider,
      nodes: nodeEntries,
    };
  }

  // ===========================================================================
  // Timeline
  // ===========================================================================

  /**
   * Get the change timeline for a specific node.
   */
  async getTimeline(nodeId: string, limit = 50): Promise<GraphChange[]> {
    return this.storage.getNodeTimeline(nodeId, limit);
  }

  // ===========================================================================
  // Topology Export
  // ===========================================================================

  /**
   * Export a filtered subgraph for visualization.
   */
  async getTopology(filter?: NodeFilter): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const nodes = filter
      ? await this.storage.queryNodes(filter)
      : await this.storage.queryNodes({});

    const nodeIds = new Set(nodes.map((n) => n.id));

    // Get all edges between the matched nodes
    const allEdges: GraphEdge[] = [];
    for (const node of nodes) {
      const edges = await this.storage.getEdgesForNode(node.id, "both");
      for (const edge of edges) {
        // Only include edges where both endpoints are in the result set
        if (nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)) {
          if (!allEdges.some((e) => e.id === edge.id)) {
            allEdges.push(edge);
          }
        }
      }
    }

    return { nodes, edges: allEdges };
  }
}
