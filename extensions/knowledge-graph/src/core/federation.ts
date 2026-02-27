/**
 * Infrastructure Knowledge Graph — Cross-Extension Graph Federation
 *
 * Provides a federation layer for merging and querying graphs across
 * multiple Espada extension instances. Each extension maintains its own
 * local graph store; the federation layer provides a unified virtual view.
 *
 * Supports:
 *   - Peer registration and health checking
 *   - Cross-graph node/edge querying
 *   - Graph merging with conflict resolution
 *   - Statistics aggregation
 *   - Namespace isolation
 */

import type {
  GraphNode,
  GraphEdge,
  GraphNodeInput,
  GraphEdgeInput,
  GraphStorage,
  GraphStats,
  NodeFilter,
  EdgeFilter,
  CloudProvider,
  GraphResourceType,
  GraphRelationshipType,
  TraversalDirection,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

/** A peer in the federation. */
export type FederationPeer = {
  /** Unique peer identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Namespace prefix for nodes from this peer. */
  namespace: string;
  /** Peer's graph storage. */
  storage: GraphStorage;
  /** When the peer was registered. */
  registeredAt: string;
  /** Whether the peer is currently reachable. */
  healthy: boolean;
  /** Last health check timestamp. */
  lastHealthCheck: string | null;
  /** Peer metadata. */
  metadata: Record<string, unknown>;
};

/** Conflict resolution strategy for merging. */
export type ConflictResolution =
  | "local-wins"
  | "remote-wins"
  | "newest-wins"
  | "merge-tags";

/** Options for federated queries. */
export type FederatedQueryOptions = {
  /** Which peer namespaces to include (all if empty). */
  namespaces?: string[];
  /** Timeout per peer query in milliseconds. */
  timeoutMs?: number;
  /** Whether to include unreachable peers. */
  includeUnhealthy?: boolean;
  /** Filter nodes by cloud provider. */
  providerFilter?: CloudProvider;
  /** Filter nodes by resource type. */
  resourceTypeFilter?: GraphResourceType;
  /** Filter edges by relationship type. */
  relationshipTypeFilter?: GraphRelationshipType;
};

/** A federated node includes source attribution. */
export type FederatedNode = GraphNode & {
  /** The peer namespace this node came from. */
  sourceNamespace: string;
  /** The peer ID. */
  sourcePeerId: string;
};

/** A federated edge includes source attribution. */
export type FederatedEdge = GraphEdge & {
  sourceNamespace: string;
  sourcePeerId: string;
};

/** Result of a federated query. */
export type FederatedQueryResult = {
  nodes: FederatedNode[];
  edges: FederatedEdge[];
  /** Per-peer query status. */
  peerStatus: Array<{
    peerId: string;
    namespace: string;
    success: boolean;
    durationMs: number;
    error?: string;
    nodeCount: number;
    edgeCount: number;
  }>;
  /** Total query duration. */
  totalDurationMs: number;
};

/** Aggregated stats across the federation. */
export type FederatedStats = {
  totalPeers: number;
  healthyPeers: number;
  aggregated: GraphStats;
  perPeer: Array<{
    peerId: string;
    namespace: string;
    healthy: boolean;
    stats: GraphStats | null;
  }>;
};

/** Result of a merge operation. */
export type MergeResult = {
  nodesAdded: number;
  nodesUpdated: number;
  nodesSkipped: number;
  edgesAdded: number;
  edgesUpdated: number;
  edgesSkipped: number;
  conflicts: number;
  durationMs: number;
};

// =============================================================================
// Federation Manager
// =============================================================================

/**
 * Manages a federation of graph storage instances, providing a unified
 * query and merge layer across multiple Espada extension graphs.
 */
export class GraphFederationManager {
  private peers: Map<string, FederationPeer> = new Map();
  private localNamespace: string;
  private localStorage: GraphStorage;

  constructor(localStorage: GraphStorage, localNamespace = "local") {
    this.localStorage = localStorage;
    this.localNamespace = localNamespace;
  }

  // ---------------------------------------------------------------------------
  // Peer Management
  // ---------------------------------------------------------------------------

  /**
   * Register a new peer in the federation.
   */
  registerPeer(
    id: string,
    name: string,
    namespace: string,
    storage: GraphStorage,
    metadata: Record<string, unknown> = {},
  ): FederationPeer {
    if (this.peers.has(id)) {
      throw new Error(`Peer already registered: ${id}`);
    }
    if (namespace === this.localNamespace) {
      throw new Error(`Namespace '${namespace}' is reserved for the local graph`);
    }
    // Ensure unique namespace
    for (const peer of this.peers.values()) {
      if (peer.namespace === namespace) {
        throw new Error(`Namespace '${namespace}' already used by peer '${peer.id}'`);
      }
    }

    const peer: FederationPeer = {
      id,
      name,
      namespace,
      storage,
      registeredAt: new Date().toISOString(),
      healthy: true,
      lastHealthCheck: null,
      metadata,
    };
    this.peers.set(id, peer);
    return peer;
  }

  /**
   * Remove a peer from the federation.
   */
  removePeer(id: string): boolean {
    return this.peers.delete(id);
  }

  /**
   * Get all registered peers.
   */
  getPeers(): FederationPeer[] {
    return [...this.peers.values()];
  }

  /**
   * Get a specific peer by ID.
   */
  getPeer(id: string): FederationPeer | null {
    return this.peers.get(id) ?? null;
  }

  /**
   * Health-check all peers.
   */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    await Promise.all(
      [...this.peers.entries()].map(async ([id, peer]) => {
        try {
          const stats = await peer.storage.getStats();
          peer.healthy = stats.totalNodes >= 0; // basic sanity
          peer.lastHealthCheck = new Date().toISOString();
          results.set(id, peer.healthy);
        } catch {
          peer.healthy = false;
          peer.lastHealthCheck = new Date().toISOString();
          results.set(id, false);
        }
      }),
    );

    return results;
  }

  // ---------------------------------------------------------------------------
  // Federated Queries
  // ---------------------------------------------------------------------------

  /**
   * Query nodes across all federated peers (and optionally the local graph).
   */
  async queryNodes(
    filter: NodeFilter,
    options: FederatedQueryOptions = {},
  ): Promise<FederatedQueryResult> {
    const start = Date.now();
    const allNodes: FederatedNode[] = [];
    const allEdges: FederatedEdge[] = [];
    const peerStatus: FederatedQueryResult["peerStatus"] = [];

    // Merge provider/resourceType filters from options into the node filter
    const mergedFilter: NodeFilter = { ...filter };
    if (options.providerFilter) {
      mergedFilter.provider = options.providerFilter;
    }
    if (options.resourceTypeFilter) {
      mergedFilter.resourceType = options.resourceTypeFilter;
    }

    // Query local graph
    const localStart = Date.now();
    try {
      const localNodes = await this.localStorage.queryNodes(mergedFilter);
      const fedNodes = localNodes.map((n) => ({
        ...n,
        sourceNamespace: this.localNamespace,
        sourcePeerId: "local",
      }));
      allNodes.push(...fedNodes);
      peerStatus.push({
        peerId: "local",
        namespace: this.localNamespace,
        success: true,
        durationMs: Date.now() - localStart,
        nodeCount: fedNodes.length,
        edgeCount: 0,
      });
    } catch (err) {
      peerStatus.push({
        peerId: "local",
        namespace: this.localNamespace,
        success: false,
        durationMs: Date.now() - localStart,
        error: String(err),
        nodeCount: 0,
        edgeCount: 0,
      });
    }

    // Query peers
    const targetPeers = this.getTargetPeers(options);
    await Promise.all(
      targetPeers.map(async (peer) => {
        const peerStart = Date.now();
        try {
          const nodes = await withTimeout(
            peer.storage.queryNodes(mergedFilter),
            options.timeoutMs ?? 5000,
          );
          const fedNodes = nodes.map((n) => ({
            ...n,
            sourceNamespace: peer.namespace,
            sourcePeerId: peer.id,
          }));
          allNodes.push(...fedNodes);
          peerStatus.push({
            peerId: peer.id,
            namespace: peer.namespace,
            success: true,
            durationMs: Date.now() - peerStart,
            nodeCount: fedNodes.length,
            edgeCount: 0,
          });
        } catch (err) {
          peerStatus.push({
            peerId: peer.id,
            namespace: peer.namespace,
            success: false,
            durationMs: Date.now() - peerStart,
            error: String(err),
            nodeCount: 0,
            edgeCount: 0,
          });
        }
      }),
    );

    return {
      nodes: allNodes,
      edges: allEdges,
      peerStatus,
      totalDurationMs: Date.now() - start,
    };
  }

  /**
   * Get node by ID across all peers.
   */
  async getNode(
    nodeId: string,
    options: FederatedQueryOptions = {},
  ): Promise<FederatedNode | null> {
    // Check local first
    const local = await this.localStorage.getNode(nodeId);
    if (local) {
      return {
        ...local,
        sourceNamespace: this.localNamespace,
        sourcePeerId: "local",
      };
    }

    // Check peers
    const targetPeers = this.getTargetPeers(options);
    for (const peer of targetPeers) {
      try {
        const node = await withTimeout(
          peer.storage.getNode(nodeId),
          options.timeoutMs ?? 5000,
        );
        if (node) {
          return {
            ...node,
            sourceNamespace: peer.namespace,
            sourcePeerId: peer.id,
          };
        }
      } catch {
        // Skip unreachable peers
      }
    }

    return null;
  }

  /**
   * Get neighbors across the federation—traverses local graph and all peers.
   */
  async getNeighborsFederated(
    nodeId: string,
    depth: number,
    direction: TraversalDirection,
    options: FederatedQueryOptions = {},
  ): Promise<FederatedQueryResult> {
    const start = Date.now();
    const allNodes: FederatedNode[] = [];
    const allEdges: FederatedEdge[] = [];
    const peerStatus: FederatedQueryResult["peerStatus"] = [];

    // Local traversal
    const localStart = Date.now();
    try {
      const result = await this.localStorage.getNeighbors(nodeId, depth, direction);
      allNodes.push(
        ...result.nodes.map((n) => ({
          ...n,
          sourceNamespace: this.localNamespace,
          sourcePeerId: "local",
        })),
      );
      allEdges.push(
        ...result.edges.map((e) => ({
          ...e,
          sourceNamespace: this.localNamespace,
          sourcePeerId: "local",
        })),
      );
      peerStatus.push({
        peerId: "local",
        namespace: this.localNamespace,
        success: true,
        durationMs: Date.now() - localStart,
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
      });
    } catch (err) {
      peerStatus.push({
        peerId: "local",
        namespace: this.localNamespace,
        success: false,
        durationMs: Date.now() - localStart,
        error: String(err),
        nodeCount: 0,
        edgeCount: 0,
      });
    }

    // Peer traversals
    const targetPeers = this.getTargetPeers(options);
    await Promise.all(
      targetPeers.map(async (peer) => {
        const peerStart = Date.now();
        try {
          const result = await withTimeout(
            peer.storage.getNeighbors(nodeId, depth, direction),
            options.timeoutMs ?? 5000,
          );
          allNodes.push(
            ...result.nodes.map((n) => ({
              ...n,
              sourceNamespace: peer.namespace,
              sourcePeerId: peer.id,
            })),
          );
          allEdges.push(
            ...result.edges.map((e) => ({
              ...e,
              sourceNamespace: peer.namespace,
              sourcePeerId: peer.id,
            })),
          );
          peerStatus.push({
            peerId: peer.id,
            namespace: peer.namespace,
            success: true,
            durationMs: Date.now() - peerStart,
            nodeCount: result.nodes.length,
            edgeCount: result.edges.length,
          });
        } catch (err) {
          peerStatus.push({
            peerId: peer.id,
            namespace: peer.namespace,
            success: false,
            durationMs: Date.now() - peerStart,
            error: String(err),
            nodeCount: 0,
            edgeCount: 0,
          });
        }
      }),
    );

    // Deduplicate nodes by ID
    const seen = new Set<string>();
    const deduped: FederatedNode[] = [];
    for (const node of allNodes) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        deduped.push(node);
      }
    }

    // Filter edges by relationship type if specified
    const filteredEdges: FederatedEdge[] = options.relationshipTypeFilter
      ? allEdges.filter((e) => e.relationshipType === options.relationshipTypeFilter)
      : allEdges;

    // Filter nodes by provider/resource type if specified
    let filteredNodes = deduped;
    if (options.providerFilter) {
      filteredNodes = filteredNodes.filter((n) => n.provider === options.providerFilter);
    }
    if (options.resourceTypeFilter) {
      filteredNodes = filteredNodes.filter((n) => n.resourceType === options.resourceTypeFilter);
    }

    return {
      nodes: filteredNodes,
      edges: filteredEdges,
      peerStatus,
      totalDurationMs: Date.now() - start,
    };
  }

  // ---------------------------------------------------------------------------
  // Federated Edge Queries
  // ---------------------------------------------------------------------------

  /**
   * Query edges across all federated peers using an EdgeFilter.
   */
  async queryEdgesFederated(
    filter: EdgeFilter,
    options: FederatedQueryOptions = {},
  ): Promise<FederatedEdge[]> {
    const allEdges: FederatedEdge[] = [];

    // Apply relationship type override from options
    const mergedFilter: EdgeFilter = { ...filter };
    if (options.relationshipTypeFilter && !mergedFilter.relationshipType) {
      mergedFilter.relationshipType = options.relationshipTypeFilter;
    }

    // Query local
    try {
      const localEdges = await this.localStorage.queryEdges(mergedFilter);
      allEdges.push(
        ...localEdges.map((e) => ({
          ...e,
          sourceNamespace: this.localNamespace,
          sourcePeerId: "local",
        })),
      );
    } catch {
      // Skip local on error
    }

    // Query peers
    const targetPeers = this.getTargetPeers(options);
    await Promise.all(
      targetPeers.map(async (peer) => {
        try {
          const edges = await withTimeout(
            peer.storage.queryEdges(mergedFilter),
            options.timeoutMs ?? 5000,
          );
          allEdges.push(
            ...edges.map((e) => ({
              ...e,
              sourceNamespace: peer.namespace,
              sourcePeerId: peer.id,
            })),
          );
        } catch {
          // Skip unreachable peers
        }
      }),
    );

    return allEdges;
  }

  // ---------------------------------------------------------------------------
  // Graph Merging
  // ---------------------------------------------------------------------------

  /**
   * Merge a peer's graph data into the local graph.
   */
  async mergePeerIntoLocal(
    peerId: string,
    conflictResolution: ConflictResolution = "newest-wins",
    filter?: NodeFilter,
  ): Promise<MergeResult> {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error(`Unknown peer: ${peerId}`);

    const start = Date.now();
    let nodesAdded = 0;
    let nodesUpdated = 0;
    let nodesSkipped = 0;
    let edgesAdded = 0;
    let edgesUpdated = 0;
    let edgesSkipped = 0;
    let conflicts = 0;

    // Fetch remote nodes
    const remoteNodes = await peer.storage.queryNodes(filter ?? {});

    for (const remoteNode of remoteNodes) {
      const localNode = await this.localStorage.getNode(remoteNode.id);

      if (!localNode) {
        // New node — add
        await this.localStorage.upsertNode(nodeToInput(remoteNode));
        nodesAdded++;
      } else {
        // Conflict — resolve
        conflicts++;
        const winner = resolveNodeConflict(localNode, remoteNode, conflictResolution);
        if (winner === "remote") {
          await this.localStorage.upsertNode(nodeToInput(remoteNode));
          nodesUpdated++;
        } else if (winner === "merge") {
          const merged = mergeNodeTags(localNode, remoteNode);
          await this.localStorage.upsertNode(nodeToInput(merged));
          nodesUpdated++;
        } else {
          nodesSkipped++;
        }
      }
    }

    // Fetch and merge edges for the merged nodes
    for (const remoteNode of remoteNodes) {
      const remoteEdges = await peer.storage.getEdgesForNode(remoteNode.id, "both");
      for (const edge of remoteEdges) {
        const localEdge = await this.localStorage.getEdge(edge.id);
        if (!localEdge) {
          await this.localStorage.upsertEdge(edgeToInput(edge));
          edgesAdded++;
        } else {
          // Edge exists — skip unless remote is newer
          if (conflictResolution === "remote-wins") {
            await this.localStorage.upsertEdge(edgeToInput(edge));
            edgesUpdated++;
          } else {
            edgesSkipped++;
          }
        }
      }
    }

    return {
      nodesAdded,
      nodesUpdated,
      nodesSkipped,
      edgesAdded,
      edgesUpdated,
      edgesSkipped,
      conflicts,
      durationMs: Date.now() - start,
    };
  }

  // ---------------------------------------------------------------------------
  // Aggregated Stats
  // ---------------------------------------------------------------------------

  /**
   * Get aggregated statistics across the federation.
   */
  async getStats(): Promise<FederatedStats> {
    const perPeer: FederatedStats["perPeer"] = [];

    // Local stats
    const localStats = await this.localStorage.getStats();
    perPeer.push({
      peerId: "local",
      namespace: this.localNamespace,
      healthy: true,
      stats: localStats,
    });

    // Peer stats
    await Promise.all(
      [...this.peers.values()].map(async (peer) => {
        try {
          const stats = await peer.storage.getStats();
          perPeer.push({
            peerId: peer.id,
            namespace: peer.namespace,
            healthy: peer.healthy,
            stats,
          });
        } catch {
          perPeer.push({
            peerId: peer.id,
            namespace: peer.namespace,
            healthy: false,
            stats: null,
          });
        }
      }),
    );

    // Aggregate
    const aggregated: GraphStats = {
      totalNodes: 0,
      totalEdges: 0,
      totalChanges: 0,
      totalGroups: 0,
      nodesByProvider: {},
      nodesByResourceType: {},
      edgesByRelationshipType: {},
      totalCostMonthly: 0,
      lastSyncAt: null,
      oldestChange: null,
      newestChange: null,
    };

    for (const p of perPeer) {
      if (!p.stats) continue;
      aggregated.totalNodes += p.stats.totalNodes;
      aggregated.totalEdges += p.stats.totalEdges;
      aggregated.totalChanges += p.stats.totalChanges;
      aggregated.totalGroups += p.stats.totalGroups;
      aggregated.totalCostMonthly += p.stats.totalCostMonthly;

      for (const [k, v] of Object.entries(p.stats.nodesByProvider)) {
        aggregated.nodesByProvider[k] = (aggregated.nodesByProvider[k] ?? 0) + v;
      }
      for (const [k, v] of Object.entries(p.stats.nodesByResourceType)) {
        aggregated.nodesByResourceType[k] = (aggregated.nodesByResourceType[k] ?? 0) + v;
      }
      for (const [k, v] of Object.entries(p.stats.edgesByRelationshipType)) {
        aggregated.edgesByRelationshipType[k] = (aggregated.edgesByRelationshipType[k] ?? 0) + v;
      }

      if (p.stats.lastSyncAt) {
        if (!aggregated.lastSyncAt || p.stats.lastSyncAt > aggregated.lastSyncAt) {
          aggregated.lastSyncAt = p.stats.lastSyncAt;
        }
      }
    }

    return {
      totalPeers: this.peers.size + 1, // +1 for local
      healthyPeers: perPeer.filter((p) => p.healthy).length,
      aggregated,
      perPeer,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getTargetPeers(options: FederatedQueryOptions): FederationPeer[] {
    let peers = [...this.peers.values()];

    if (!options.includeUnhealthy) {
      peers = peers.filter((p) => p.healthy);
    }

    if (options.namespaces && options.namespaces.length > 0) {
      const ns = new Set(options.namespaces);
      peers = peers.filter((p) => ns.has(p.namespace));
    }

    return peers;
  }
}

// =============================================================================
// Helpers
// =============================================================================

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout")), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

function resolveNodeConflict(
  local: GraphNode,
  remote: GraphNode,
  strategy: ConflictResolution,
): "local" | "remote" | "merge" {
  switch (strategy) {
    case "local-wins":
      return "local";
    case "remote-wins":
      return "remote";
    case "merge-tags":
      return "merge";
    case "newest-wins":
      return (remote.lastSeenAt ?? "") > (local.lastSeenAt ?? "")
        ? "remote"
        : "local";
    default:
      return "local";
  }
}

function mergeNodeTags(local: GraphNode, remote: GraphNode): GraphNode {
  return {
    ...local,
    tags: { ...local.tags, ...remote.tags },
    lastSeenAt: (remote.lastSeenAt ?? "") > (local.lastSeenAt ?? "")
      ? remote.lastSeenAt
      : local.lastSeenAt,
  };
}

function nodeToInput(node: GraphNode): GraphNodeInput {
  return {
    id: node.id,
    name: node.name,
    resourceType: node.resourceType,
    provider: node.provider,
    nativeId: node.nativeId,
    region: node.region,
    account: node.account,
    status: node.status,
    costMonthly: node.costMonthly,
    tags: node.tags,
    metadata: node.metadata,
    owner: node.owner,
    createdAt: node.createdAt,
    discoveredAt: node.discoveredAt,
    lastSeenAt: node.lastSeenAt,
  };
}

function edgeToInput(edge: GraphEdge): GraphEdgeInput {
  return {
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    relationshipType: edge.relationshipType,
    discoveredVia: edge.discoveredVia,
    createdAt: edge.createdAt,
    lastSeenAt: edge.lastSeenAt,
    confidence: edge.confidence,
    metadata: edge.metadata,
  };
}

/**
 * Format federation statistics as markdown.
 */
export function formatFederationStatsMarkdown(stats: FederatedStats): string {
  const lines: string[] = [
    "# Graph Federation Status",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Peers | ${stats.totalPeers} |`,
    `| Healthy Peers | ${stats.healthyPeers} |`,
    `| Total Nodes | ${stats.aggregated.totalNodes} |`,
    `| Total Edges | ${stats.aggregated.totalEdges} |`,
    `| Total Cost | $${stats.aggregated.totalCostMonthly.toFixed(2)}/mo |`,
    "",
    "## Per-Peer Breakdown",
    "",
    "| Peer | Namespace | Healthy | Nodes | Edges | Cost |",
    "|------|-----------|---------|-------|-------|------|",
    ...stats.perPeer.map((p) => {
      const s = p.stats;
      return `| ${p.peerId} | ${p.namespace} | ${p.healthy ? "Yes" : "No"} | ${s?.totalNodes ?? "-"} | ${s?.totalEdges ?? "-"} | ${s ? `$${s.totalCostMonthly.toFixed(2)}` : "-"} |`;
    }),
    "",
  ];

  // Nodes by Provider breakdown
  const providerEntries = Object.entries(stats.aggregated.nodesByProvider);
  if (providerEntries.length > 0) {
    lines.push(
      "## Nodes by Provider",
      "",
      "| Provider | Count |",
      "|----------|-------|",
      ...providerEntries.map(([provider, count]) => `| ${provider} | ${count} |`),
      "",
    );
  }

  // Nodes by Resource Type breakdown
  const resourceTypeEntries = Object.entries(stats.aggregated.nodesByResourceType);
  if (resourceTypeEntries.length > 0) {
    lines.push(
      "## Nodes by Resource Type",
      "",
      "| Resource Type | Count |",
      "|---------------|-------|",
      ...resourceTypeEntries.map(([rt, count]) => `| ${rt} | ${count} |`),
      "",
    );
  }

  // Edges by Relationship Type breakdown
  const relationshipEntries = Object.entries(stats.aggregated.edgesByRelationshipType);
  if (relationshipEntries.length > 0) {
    lines.push(
      "## Edges by Relationship Type",
      "",
      "| Relationship | Count |",
      "|--------------|-------|",
      ...relationshipEntries.map(([rel, count]) => `| ${rel} | ${count} |`),
      "",
    );
  }

  return lines.join("\n");
}
