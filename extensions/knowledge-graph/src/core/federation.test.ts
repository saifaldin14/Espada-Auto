/**
 * Tests for federation module — cross-extension graph federation.
 */

import { describe, it, expect } from "vitest";
import {
  GraphFederationManager,
  formatFederationStatsMarkdown,
} from "../core/federation.js";
import type {
  FederatedQueryResult,
  FederatedStats,
  FederationPeer,
  MergeResult,
} from "../core/federation.js";
import type {
  GraphNode,
  GraphEdge,
  GraphStorage,
  GraphStats,
  NodeFilter,
  TraversalDirection,
} from "../types.js";

// =============================================================================
// Mock Helpers
// =============================================================================

const now = new Date().toISOString();

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "node-1",
    provider: "aws",
    resourceType: "compute",
    nativeId: "i-12345",
    name: "test-instance",
    region: "us-east-1",
    account: "123456789",
    status: "running",
    tags: { Environment: "prod" },
    metadata: {},
    costMonthly: 100,
    owner: null,
    discoveredAt: now,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: "edge-1",
    sourceNodeId: "node-1",
    targetNodeId: "node-2",
    relationshipType: "connected-to",
    confidence: 1.0,
    discoveredVia: "config-scan",
    metadata: {},
    createdAt: now,
    lastSeenAt: now,
    ...overrides,
  };
}

function makeStats(overrides: Partial<GraphStats> = {}): GraphStats {
  return {
    totalNodes: 5,
    totalEdges: 3,
    totalChanges: 0,
    totalGroups: 0,
    nodesByProvider: { aws: 5 },
    nodesByResourceType: { compute: 5 },
    edgesByRelationshipType: { "connects-to": 3 },
    totalCostMonthly: 500,
    lastSyncAt: now,
    oldestChange: null,
    newestChange: null,
    ...overrides,
  };
}

/**
 * Create a minimal mock GraphStorage. Implements methods used by
 * GraphFederationManager; stubs the rest.
 */
function createMockStorage(
  nodes: GraphNode[] = [],
  edges: GraphEdge[] = [],
  stats?: GraphStats,
): GraphStorage {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return {
    initialize: async () => {},
    close: async () => {},

    // Nodes
    upsertNode: async () => {},
    upsertNodes: async () => {},
    getNode: async (id: string) => nodeMap.get(id) ?? null,
    getNodeByNativeId: async () => null,
    queryNodes: async (_filter: NodeFilter) => nodes,
    queryNodesPaginated: async () => ({ items: nodes, total: nodes.length, hasMore: false }),
    deleteNode: async () => {},
    markNodesDisappeared: async () => [],

    // Edges
    upsertEdge: async () => {},
    upsertEdges: async () => {},
    getEdge: async (id: string) => edges.find((e) => e.id === id) ?? null,
    getEdgesForNode: async (
      nodeId: string,
      _direction: TraversalDirection,
    ) => edges.filter((e) => e.sourceNodeId === nodeId || e.targetNodeId === nodeId),
    queryEdges: async () => edges,
    queryEdgesPaginated: async () => ({ items: edges, total: edges.length, hasMore: false }),
    deleteEdge: async () => {},
    deleteStaleEdges: async () => 0,

    // Changes
    appendChange: async () => {},
    appendChanges: async () => {},
    getChanges: async () => [],
    getChangesPaginated: async () => ({ items: [], total: 0, hasMore: false }),
    getNodeTimeline: async () => [],

    // Groups
    upsertGroup: async () => {},
    getGroup: async () => null,
    listGroups: async () => [],
    deleteGroup: async () => {},
    addGroupMember: async () => {},
    removeGroupMember: async () => {},
    getGroupMembers: async () => [],
    getNodeGroups: async () => [],

    // Sync records
    saveSyncRecord: async () => {},
    getLastSyncRecord: async () => null,
    listSyncRecords: async () => [],

    // Traversal
    getNeighbors: async (
      _nodeId: string,
      _depth: number,
      _direction: TraversalDirection,
    ) => ({ nodes, edges }),

    // Stats
    getStats: async () => stats ?? makeStats({ totalNodes: nodes.length, totalEdges: edges.length }),
  } as unknown as GraphStorage;
}

// =============================================================================
// Peer Management
// =============================================================================

describe("GraphFederationManager — peer management", () => {
  it("registers a peer", () => {
    const local = createMockStorage();
    const mgr = new GraphFederationManager(local, "local");
    const peer = mgr.registerPeer("p1", "Peer One", "ns-p1", createMockStorage());
    expect(peer.id).toBe("p1");
    expect(peer.name).toBe("Peer One");
    expect(peer.namespace).toBe("ns-p1");
    expect(peer.healthy).toBe(true);
  });

  it("rejects duplicate peer ID", () => {
    const local = createMockStorage();
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer One", "ns-p1", createMockStorage());
    expect(() =>
      mgr.registerPeer("p1", "Another", "ns-another", createMockStorage()),
    ).toThrow(/already registered/);
  });

  it("rejects duplicate namespace", () => {
    const local = createMockStorage();
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer One", "shared-ns", createMockStorage());
    expect(() =>
      mgr.registerPeer("p2", "Peer Two", "shared-ns", createMockStorage()),
    ).toThrow(/already used/);
  });

  it("rejects local namespace reservation", () => {
    const local = createMockStorage();
    const mgr = new GraphFederationManager(local, "local");
    expect(() =>
      mgr.registerPeer("p1", "Peer One", "local", createMockStorage()),
    ).toThrow(/reserved/);
  });

  it("lists and retrieves peers", () => {
    const local = createMockStorage();
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer 1", "ns1", createMockStorage());
    mgr.registerPeer("p2", "Peer 2", "ns2", createMockStorage());
    expect(mgr.getPeers()).toHaveLength(2);
    expect(mgr.getPeer("p1")).not.toBeNull();
    expect(mgr.getPeer("p1")!.name).toBe("Peer 1");
    expect(mgr.getPeer("unknown")).toBeNull();
  });

  it("removes a peer", () => {
    const local = createMockStorage();
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer 1", "ns1", createMockStorage());
    expect(mgr.removePeer("p1")).toBe(true);
    expect(mgr.removePeer("p1")).toBe(false);
    expect(mgr.getPeers()).toHaveLength(0);
  });
});

// =============================================================================
// Health Checking
// =============================================================================

describe("GraphFederationManager — health checking", () => {
  it("marks healthy peers as healthy", async () => {
    const local = createMockStorage();
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer", "ns1", createMockStorage([makeNode()]));
    const results = await mgr.healthCheckAll();
    expect(results.get("p1")).toBe(true);
  });

  it("marks broken peers as unhealthy", async () => {
    const local = createMockStorage();
    const brokenStorage = createMockStorage();
    brokenStorage.getStats = async () => {
      throw new Error("connection refused");
    };
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("broken", "Broken", "ns-broken", brokenStorage);
    const results = await mgr.healthCheckAll();
    expect(results.get("broken")).toBe(false);
  });
});

// =============================================================================
// Federated Queries
// =============================================================================

describe("GraphFederationManager — queryNodes", () => {
  it("aggregates nodes from local and peers", async () => {
    const localNode = makeNode({ id: "local-1", name: "local-instance" });
    const peerNode = makeNode({ id: "peer-1", name: "peer-instance" });

    const local = createMockStorage([localNode]);
    const peerStorage = createMockStorage([peerNode]);
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer", "ns1", peerStorage);

    const result = await mgr.queryNodes({});
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.some((n) => n.id === "local-1")).toBe(true);
    expect(result.nodes.some((n) => n.id === "peer-1")).toBe(true);
    // Check source attribution
    const localResult = result.nodes.find((n) => n.id === "local-1")!;
    expect(localResult.sourceNamespace).toBe("local");
    expect(localResult.sourcePeerId).toBe("local");
    const peerResult = result.nodes.find((n) => n.id === "peer-1")!;
    expect(peerResult.sourceNamespace).toBe("ns1");
    expect(peerResult.sourcePeerId).toBe("p1");
  });

  it("reports peer status", async () => {
    const local = createMockStorage([makeNode()]);
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer", "ns1", createMockStorage([]));

    const result = await mgr.queryNodes({});
    expect(result.peerStatus.length).toBeGreaterThanOrEqual(2); // local + p1
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("excludes unhealthy peers by default", async () => {
    const local = createMockStorage([makeNode({ id: "l1" })]);
    const peerStorage = createMockStorage([makeNode({ id: "p1" })]);
    const mgr = new GraphFederationManager(local, "local");
    const peer = mgr.registerPeer("p1", "Peer", "ns1", peerStorage);
    // Manually mark unhealthy
    (peer as { healthy: boolean }).healthy = false;

    const result = await mgr.queryNodes({});
    // Should only have local nodes
    expect(result.nodes.every((n) => n.sourcePeerId === "local")).toBe(true);
  });

  it("filters nodes by providerFilter option", async () => {
    const awsNode = makeNode({ id: "aws-1", provider: "aws" });
    const gcpNode = makeNode({ id: "gcp-1", provider: "gcp" });
    // Mock storage that actually filters by provider
    const local = createMockStorage([awsNode, gcpNode]);
    local.queryNodes = async (filter: NodeFilter) =>
      [awsNode, gcpNode].filter((n) => !filter.provider || n.provider === filter.provider);

    const mgr = new GraphFederationManager(local, "local");
    const result = await mgr.queryNodes({}, { providerFilter: "aws" });
    expect(result.nodes.every((n) => n.provider === "aws")).toBe(true);
  });

  it("filters nodes by resourceTypeFilter option", async () => {
    const computeNode = makeNode({ id: "c1", resourceType: "compute" });
    const storageNode = makeNode({ id: "s1", resourceType: "storage" });
    const local = createMockStorage([computeNode, storageNode]);
    local.queryNodes = async (filter: NodeFilter) =>
      [computeNode, storageNode].filter(
        (n) => !filter.resourceType || n.resourceType === filter.resourceType,
      );

    const mgr = new GraphFederationManager(local, "local");
    const result = await mgr.queryNodes({}, { resourceTypeFilter: "storage" });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].resourceType).toBe("storage");
  });
});

describe("GraphFederationManager — getNode", () => {
  it("finds node in local storage first", async () => {
    const node = makeNode({ id: "n1" });
    const local = createMockStorage([node]);
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer", "ns1", createMockStorage([makeNode({ id: "n1", name: "peer-ver" })]));

    const found = await mgr.getNode("n1");
    expect(found).not.toBeNull();
    expect(found!.sourcePeerId).toBe("local");
  });

  it("falls through to peer when not in local", async () => {
    const local = createMockStorage([]);
    const peerStorage = createMockStorage([makeNode({ id: "only-in-peer" })]);
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer", "ns1", peerStorage);

    const found = await mgr.getNode("only-in-peer");
    expect(found).not.toBeNull();
    expect(found!.sourcePeerId).toBe("p1");
  });

  it("returns null when node not found anywhere", async () => {
    const local = createMockStorage([]);
    const mgr = new GraphFederationManager(local, "local");
    const found = await mgr.getNode("nonexistent");
    expect(found).toBeNull();
  });
});

describe("GraphFederationManager — getNeighborsFederated", () => {
  it("aggregates neighbors from local and peers", async () => {
    const n1 = makeNode({ id: "n1" });
    const n2 = makeNode({ id: "n2" });
    const e1 = makeEdge({ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" });

    const local = createMockStorage([n1], [e1]);
    const peerStorage = createMockStorage([n2], []);
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer", "ns1", peerStorage);

    const result = await mgr.getNeighborsFederated("n1", 1, "downstream");
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("deduplicates nodes by ID", async () => {
    const sharedNode = makeNode({ id: "shared" });
    const local = createMockStorage([sharedNode]);
    const peerStorage = createMockStorage([sharedNode]);
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer", "ns1", peerStorage);

    const result = await mgr.getNeighborsFederated("shared", 1, "both");
    const ids = result.nodes.map((n) => n.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it("filters edges by relationshipTypeFilter", async () => {
    const n1 = makeNode({ id: "n1" });
    const n2 = makeNode({ id: "n2" });
    const runsIn = makeEdge({ id: "e1", sourceNodeId: "n1", targetNodeId: "n2", relationshipType: "runs-in" });
    const routesTo = makeEdge({ id: "e2", sourceNodeId: "n1", targetNodeId: "n2", relationshipType: "routes-to" });

    const local = createMockStorage([n1, n2], [runsIn, routesTo]);
    const mgr = new GraphFederationManager(local, "local");

    const result = await mgr.getNeighborsFederated("n1", 1, "both", {
      relationshipTypeFilter: "runs-in",
    });
    expect(result.edges.every((e) => e.relationshipType === "runs-in")).toBe(true);
  });

  it("filters neighbors by providerFilter and resourceTypeFilter", async () => {
    const awsCompute = makeNode({ id: "n1", provider: "aws", resourceType: "compute" });
    const gcpStorage = makeNode({ id: "n2", provider: "gcp", resourceType: "storage" });
    const local = createMockStorage([awsCompute, gcpStorage]);
    const mgr = new GraphFederationManager(local, "local");

    const result = await mgr.getNeighborsFederated("n1", 1, "both", {
      providerFilter: "aws",
    });
    expect(result.nodes.every((n) => n.provider === "aws")).toBe(true);
  });
});

// =============================================================================
// Federated Edge Queries
// =============================================================================

describe("GraphFederationManager — queryEdgesFederated", () => {
  it("aggregates edges from local and peers", async () => {
    const localEdge = makeEdge({ id: "le1" });
    const peerEdge = makeEdge({ id: "pe1" });
    const local = createMockStorage([], [localEdge]);
    const peerStorage = createMockStorage([], [peerEdge]);
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer", "ns1", peerStorage);

    const edges = await mgr.queryEdgesFederated({});
    expect(edges).toHaveLength(2);
    expect(edges.some((e) => e.id === "le1" && e.sourcePeerId === "local")).toBe(true);
    expect(edges.some((e) => e.id === "pe1" && e.sourcePeerId === "p1")).toBe(true);
  });

  it("applies relationshipTypeFilter from options", async () => {
    const runsIn = makeEdge({ id: "e1", relationshipType: "runs-in" });
    const routesTo = makeEdge({ id: "e2", relationshipType: "routes-to" });
    const local = createMockStorage([], [runsIn, routesTo]);
    local.queryEdges = async (filter) => {
      const all = [runsIn, routesTo];
      if (filter.relationshipType) {
        return all.filter((e) => e.relationshipType === filter.relationshipType);
      }
      return all;
    };
    const mgr = new GraphFederationManager(local, "local");

    const edges = await mgr.queryEdgesFederated({}, { relationshipTypeFilter: "runs-in" });
    expect(edges.every((e) => e.relationshipType === "runs-in")).toBe(true);
  });

  it("skips unreachable peers gracefully", async () => {
    const localEdge = makeEdge({ id: "le1" });
    const local = createMockStorage([], [localEdge]);
    const brokenStorage = createMockStorage();
    brokenStorage.queryEdges = async () => { throw new Error("timeout"); };
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("broken", "Broken", "ns-broken", brokenStorage);

    const edges = await mgr.queryEdgesFederated({});
    expect(edges).toHaveLength(1);
    expect(edges[0].sourcePeerId).toBe("local");
  });
});

// =============================================================================
// Graph Merging
// =============================================================================

describe("GraphFederationManager — mergePeerIntoLocal", () => {
  it("merges new nodes from peer into local", async () => {
    const peerNode = makeNode({ id: "remote-1" });
    const local = createMockStorage([]);
    const peerStorage = createMockStorage([peerNode], [makeEdge({ sourceNodeId: "remote-1" })]);

    let nodesUpserted = 0;
    local.upsertNode = async () => { nodesUpserted++; };
    local.upsertEdge = async () => {};
    local.getEdge = async () => null;

    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer", "ns1", peerStorage);

    const result = await mgr.mergePeerIntoLocal("p1");
    expect(result.nodesAdded).toBe(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(nodesUpserted).toBeGreaterThanOrEqual(1);
  });

  it("throws for unknown peer", async () => {
    const local = createMockStorage();
    const mgr = new GraphFederationManager(local, "local");
    await expect(mgr.mergePeerIntoLocal("nope")).rejects.toThrow(/Unknown peer/);
  });
});

// =============================================================================
// Aggregated Stats
// =============================================================================

describe("GraphFederationManager — getStats", () => {
  it("aggregates stats across local and peers", async () => {
    const local = createMockStorage([], [], makeStats({ totalNodes: 10, totalCostMonthly: 1000 }));
    const peer = createMockStorage([], [], makeStats({ totalNodes: 5, totalCostMonthly: 300 }));
    const mgr = new GraphFederationManager(local, "local");
    mgr.registerPeer("p1", "Peer", "ns1", peer);

    const stats = await mgr.getStats();
    expect(stats.totalPeers).toBe(2); // local + 1 peer
    expect(stats.healthyPeers).toBe(2);
    expect(stats.aggregated.totalNodes).toBe(15);
    expect(stats.aggregated.totalCostMonthly).toBe(1300);
    expect(stats.perPeer).toHaveLength(2);
  });
});

// =============================================================================
// Markdown formatting
// =============================================================================

describe("formatFederationStatsMarkdown", () => {
  it("renders stats as markdown table", () => {
    const stats: FederatedStats = {
      totalPeers: 2,
      healthyPeers: 2,
      aggregated: makeStats({ totalNodes: 15, totalEdges: 8, totalCostMonthly: 1500 }),
      perPeer: [
        { peerId: "local", namespace: "local", healthy: true, stats: makeStats({ totalNodes: 10, totalCostMonthly: 1000 }) },
        { peerId: "p1", namespace: "ns1", healthy: true, stats: makeStats({ totalNodes: 5, totalCostMonthly: 500 }) },
      ],
    };
    const md = formatFederationStatsMarkdown(stats);
    expect(md).toContain("# Graph Federation Status");
    expect(md).toContain("Total Peers");
    expect(md).toContain("## Per-Peer Breakdown");
    expect(md).toContain("local");
    expect(md).toContain("ns1");
  });

  it("includes Nodes by Provider section", () => {
    const stats: FederatedStats = {
      totalPeers: 1,
      healthyPeers: 1,
      aggregated: makeStats({
        nodesByProvider: { aws: 10, gcp: 5 },
      }),
      perPeer: [
        { peerId: "local", namespace: "local", healthy: true, stats: makeStats() },
      ],
    };
    const md = formatFederationStatsMarkdown(stats);
    expect(md).toContain("## Nodes by Provider");
    expect(md).toContain("aws");
    expect(md).toContain("gcp");
  });

  it("includes Nodes by Resource Type section", () => {
    const stats: FederatedStats = {
      totalPeers: 1,
      healthyPeers: 1,
      aggregated: makeStats({
        nodesByResourceType: { compute: 8, storage: 3, network: 2 },
      }),
      perPeer: [
        { peerId: "local", namespace: "local", healthy: true, stats: makeStats() },
      ],
    };
    const md = formatFederationStatsMarkdown(stats);
    expect(md).toContain("## Nodes by Resource Type");
    expect(md).toContain("compute");
    expect(md).toContain("storage");
    expect(md).toContain("network");
  });

  it("includes Edges by Relationship Type section", () => {
    const stats: FederatedStats = {
      totalPeers: 1,
      healthyPeers: 1,
      aggregated: makeStats({
        edgesByRelationshipType: { "runs-in": 5, "routes-to": 3 },
      }),
      perPeer: [
        { peerId: "local", namespace: "local", healthy: true, stats: makeStats() },
      ],
    };
    const md = formatFederationStatsMarkdown(stats);
    expect(md).toContain("## Edges by Relationship Type");
    expect(md).toContain("runs-in");
    expect(md).toContain("routes-to");
  });
});
