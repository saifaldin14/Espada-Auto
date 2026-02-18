/**
 * Infrastructure Knowledge Graph — Graph Query Helpers
 *
 * Specialized graph algorithms for infrastructure analysis:
 * - Shortest path between two resources
 * - Orphan detection (isolated resources)
 * - Critical path analysis (high fan-in/fan-out nodes)
 * - Single-point-of-failure detection
 * - Resource clustering by connectivity
 */

import type {
  GraphStorage,
  GraphNode,
  GraphEdge,
  NodeFilter,
  GraphRelationshipType,
} from "./types.js";

// =============================================================================
// Types
// =============================================================================

export type PathResult = {
  /** Ordered list of node IDs from source to destination. */
  path: string[];
  /** Edges traversed along the path. */
  edges: GraphEdge[];
  /** Total number of hops. */
  hops: number;
  /** Whether a path was found. */
  found: boolean;
};

export type CriticalNode = {
  node: GraphNode;
  /** Total edges (in + out). */
  degree: number;
  /** Number of incoming edges. */
  inDegree: number;
  /** Number of outgoing edges. */
  outDegree: number;
  /** Fraction of total nodes reachable from this node. */
  reachabilityRatio: number;
};

export type ClusterResult = {
  /** Each cluster is a set of connected node IDs. */
  clusters: string[][];
  /** Nodes with zero edges. */
  isolatedNodes: string[];
  /** Total number of distinct clusters (including isolated nodes as size-1 clusters). */
  totalClusters: number;
};

// =============================================================================
// Queries
// =============================================================================

/**
 * BFS-based shortest path between two graph nodes.
 *
 * Treats the graph as undirected for path finding —
 * a relationship in either direction counts.
 */
export async function shortestPath(
  storage: GraphStorage,
  fromId: string,
  toId: string,
  edgeTypes?: GraphRelationshipType[],
): Promise<PathResult> {
  if (fromId === toId) {
    return { path: [fromId], edges: [], hops: 0, found: true };
  }

  // BFS with parent tracking
  const visited = new Set<string>();
  const parent = new Map<string, { nodeId: string; edge: GraphEdge }>();
  const queue: string[] = [fromId];
  visited.add(fromId);

  let found = false;
  while (queue.length > 0) {
    const current = queue.shift()!;

    // Get all edges for this node
    const outEdges = await storage.getEdgesForNode(current, "both");

    for (const edge of outEdges) {
      // Respect edge type filter
      if (edgeTypes && !edgeTypes.includes(edge.relationshipType)) continue;

      const neighbor = edge.sourceNodeId === current ? edge.targetNodeId : edge.sourceNodeId;

      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, { nodeId: current, edge });
        queue.push(neighbor);

        if (neighbor === toId) {
          found = true;
          break;
        }
      }
    }

    if (found) break;
  }

  if (!found) {
    return { path: [], edges: [], hops: 0, found: false };
  }

  // Reconstruct path
  const path: string[] = [];
  const edges: GraphEdge[] = [];
  let current = toId;

  while (current !== fromId) {
    path.unshift(current);
    const entry = parent.get(current)!;
    edges.unshift(entry.edge);
    current = entry.nodeId;
  }
  path.unshift(fromId);

  return { path, edges, hops: path.length - 1, found: true };
}

/**
 * Find orphaned nodes — those with zero connections.
 *
 * These are likely:
 * - Resources that were manually created outside IaC
 * - Leftover from a failed deletion
 * - Missing relationship data from the adapter
 */
export async function findOrphans(
  storage: GraphStorage,
  filter?: NodeFilter,
): Promise<GraphNode[]> {
  const nodes = await storage.queryNodes(filter ?? {});
  const orphans: GraphNode[] = [];

  for (const node of nodes) {
    const edges = await storage.getEdgesForNode(node.id, "both");
    if (edges.length === 0) {
      orphans.push(node);
    }
  }

  return orphans;
}

/**
 * Find critical nodes — high degree and high reachability.
 *
 * A critical node is one that:
 * - Has many connections (high degree)
 * - Can reach a large fraction of the graph (high reachability)
 *
 * These are potential bottlenecks or high-blast-radius targets.
 */
export async function findCriticalNodes(
  storage: GraphStorage,
  filter?: NodeFilter,
  topN = 20,
): Promise<CriticalNode[]> {
  const allNodes = await storage.queryNodes(filter ?? {});
  if (allNodes.length === 0) return [];

  const totalNodes = allNodes.length;
  const results: CriticalNode[] = [];

  for (const node of allNodes) {
    const outEdges = await storage.getEdgesForNode(node.id, "downstream");
    const inEdges = await storage.getEdgesForNode(node.id, "upstream");
    const outDegree = outEdges.length;
    const inDegree = inEdges.length;
    const degree = outDegree + inDegree;

    if (degree === 0) continue;

    // BFS reachability (downstream only for infrastructure impact)
    const reachable = new Set<string>();
    const queue: string[] = [node.id];
    reachable.add(node.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const edges = await storage.getEdgesForNode(current, "downstream");
      for (const edge of edges) {
        if (!reachable.has(edge.targetNodeId)) {
          reachable.add(edge.targetNodeId);
          queue.push(edge.targetNodeId);
        }
      }
    }

    results.push({
      node,
      degree,
      inDegree,
      outDegree,
      reachabilityRatio: reachable.size / totalNodes,
    });
  }

  // Sort by degree * reachability (composite score)
  results.sort((a, b) => {
    const scoreA = a.degree * a.reachabilityRatio;
    const scoreB = b.degree * b.reachabilityRatio;
    return scoreB - scoreA;
  });

  return results.slice(0, topN);
}

/**
 * Find single points of failure (SPOFs).
 *
 * A SPOF is a node whose removal would disconnect parts of the graph
 * that were previously connected (an articulation point).
 *
 * Uses a modified Tarjan's algorithm for bridge detection in undirected graphs.
 */
export async function findSinglePointsOfFailure(
  storage: GraphStorage,
  filter?: NodeFilter,
): Promise<GraphNode[]> {
  const allNodes = await storage.queryNodes(filter ?? {});
  if (allNodes.length < 3) return []; // Can't have articulation points with < 3 nodes

  // Build full adjacency list
  const adj = new Map<string, Set<string>>();
  for (const node of allNodes) {
    adj.set(node.id, new Set());
  }

  const nodeMap = new Map<string, GraphNode>();
  for (const node of allNodes) {
    nodeMap.set(node.id, node);
    const edges = await storage.getEdgesForNode(node.id, "both");
    for (const edge of edges) {
      const neighbor = edge.sourceNodeId === node.id ? edge.targetNodeId : edge.sourceNodeId;
      if (adj.has(neighbor)) {
        adj.get(node.id)!.add(neighbor);
        adj.get(neighbor)!.add(node.id);
      }
    }
  }

  // Tarjan's bridge-finding (adapted for articulation points)
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const articulationPoints = new Set<string>();
  let timer = 0;

  function dfs(u: string): void {
    disc.set(u, timer);
    low.set(u, timer);
    timer++;

    let childCount = 0;
    const neighbors = adj.get(u) ?? new Set();

    for (const v of neighbors) {
      if (!disc.has(v)) {
        childCount++;
        parent.set(v, u);
        dfs(v);

        low.set(u, Math.min(low.get(u)!, low.get(v)!));

        // u is an articulation point if:
        // 1. u is root of DFS tree and has 2+ children
        if (parent.get(u) === null && childCount > 1) {
          articulationPoints.add(u);
        }
        // 2. u is not root and low[v] >= disc[u]
        if (parent.get(u) !== null && low.get(v)! >= disc.get(u)!) {
          articulationPoints.add(u);
        }
      } else if (v !== parent.get(u)) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
  }

  // Run DFS from each unvisited node (handles disconnected components)
  for (const nodeId of adj.keys()) {
    if (!disc.has(nodeId)) {
      parent.set(nodeId, null);
      dfs(nodeId);
    }
  }

  return Array.from(articulationPoints)
    .map((id) => nodeMap.get(id))
    .filter((n): n is GraphNode => n != null);
}

/**
 * Find connected clusters in the graph.
 *
 * Each cluster is a set of nodes that can reach each other.
 * Useful for identifying isolated subsystems.
 */
export async function findClusters(
  storage: GraphStorage,
  filter?: NodeFilter,
): Promise<ClusterResult> {
  const allNodes = await storage.queryNodes(filter ?? {});

  // Build adjacency list
  const adj = new Map<string, Set<string>>();
  for (const node of allNodes) {
    adj.set(node.id, new Set());
  }

  for (const node of allNodes) {
    const edges = await storage.getEdgesForNode(node.id, "both");
    for (const edge of edges) {
      const neighbor = edge.sourceNodeId === node.id ? edge.targetNodeId : edge.sourceNodeId;
      if (adj.has(neighbor)) {
        adj.get(node.id)!.add(neighbor);
        adj.get(neighbor)!.add(node.id);
      }
    }
  }

  // BFS connected components
  const visited = new Set<string>();
  const clusters: string[][] = [];
  const isolatedNodes: string[] = [];

  for (const nodeId of adj.keys()) {
    if (visited.has(nodeId)) continue;

    const cluster: string[] = [];
    const queue = [nodeId];
    visited.add(nodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      cluster.push(current);

      const neighbors = adj.get(current) ?? new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (cluster.length === 1 && (adj.get(nodeId)?.size ?? 0) === 0) {
      isolatedNodes.push(nodeId);
    } else {
      clusters.push(cluster);
    }
  }

  // Sort clusters by size descending
  clusters.sort((a, b) => b.length - a.length);

  return {
    clusters,
    isolatedNodes,
    totalClusters: clusters.length + isolatedNodes.length,
  };
}
