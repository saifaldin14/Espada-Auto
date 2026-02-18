/**
 * Infrastructure Knowledge Graph — Engine Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { GraphEngine } from "./engine.js";
import { InMemoryGraphStorage } from "./storage/memory-store.js";
import { AdapterRegistry } from "./adapters/types.js";
import type { GraphDiscoveryAdapter, DiscoveryResult } from "./adapters/types.js";
import type {
  GraphStorage,
  GraphNodeInput,
  GraphEdgeInput,
  GraphGroup,
  CloudProvider,
  GraphResourceType,
} from "./types.js";

// =============================================================================
// Test Adapter (mock)
// =============================================================================

function createMockAdapter(
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): GraphDiscoveryAdapter {
  return {
    provider: "aws" as CloudProvider,
    displayName: "Mock AWS",
    supportedResourceTypes: () => ["compute", "database", "vpc", "subnet"] as GraphResourceType[],
    discover: async (): Promise<DiscoveryResult> => ({
      provider: "aws",
      nodes,
      edges,
      errors: [],
      durationMs: 10,
    }),
    supportsIncrementalSync: () => false,
    healthCheck: async () => true,
  };
}

// =============================================================================
// Fixtures
// =============================================================================

function makeNode(id: string, overrides?: Partial<GraphNodeInput>): GraphNodeInput {
  return {
    id,
    name: id,
    provider: "aws",
    account: "123456789",
    region: "us-east-1",
    resourceType: "compute",
    nativeId: id,
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: null,
    owner: null,
    createdAt: null,
    ...overrides,
  };
}

function makeEdge(id: string, from: string, to: string, overrides?: Partial<GraphEdgeInput>): GraphEdgeInput {
  return {
    id,
    sourceNodeId: from,
    targetNodeId: to,
    relationshipType: "runs-in",
    confidence: 1.0,
    discoveredVia: "api-field",
    metadata: {},
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("GraphEngine", () => {
  let storage: GraphStorage;
  let engine: GraphEngine;

  beforeEach(() => {
    storage = new InMemoryGraphStorage();
    engine = new GraphEngine({ storage });
  });

  // ===========================================================================
  // Sync
  // ===========================================================================

  describe("sync", () => {
    it("should discover and persist nodes from an adapter", async () => {
      const adapter = createMockAdapter(
        [makeNode("n1"), makeNode("n2")],
        [makeEdge("e1", "n1", "n2")],
      );
      engine.registerAdapter(adapter);

      const records = await engine.sync();

      expect(records).toHaveLength(1);
      expect(records[0]!.status).toBe("completed");
      expect(records[0]!.nodesCreated).toBe(2);
      expect(records[0]!.edgesCreated).toBe(1);

      // Nodes persisted
      expect(await storage.getNode("n1")).toBeDefined();
      expect(await storage.getNode("n2")).toBeDefined();
      expect(await storage.getEdge("e1")).toBeDefined();
    });

    it("should detect node updates on re-sync", async () => {
      // First sync
      const adapter1 = createMockAdapter(
        [makeNode("n1", { name: "old-name" })],
        [],
      );
      engine.registerAdapter(adapter1);
      await engine.sync();

      // Second sync with updated name
      const engine2 = new GraphEngine({ storage });
      const adapter2 = createMockAdapter(
        [makeNode("n1", { name: "new-name" })],
        [],
      );
      engine2.registerAdapter(adapter2);
      const records = await engine2.sync();

      expect(records[0]!.nodesUpdated).toBe(1);
      expect(records[0]!.nodesCreated).toBe(0);
    });

    it("should record changes on sync", async () => {
      const adapter = createMockAdapter(
        [makeNode("n1")],
        [],
      );
      engine.registerAdapter(adapter);
      await engine.sync();

      const timeline = await storage.getNodeTimeline("n1", 10);
      expect(timeline.length).toBeGreaterThan(0);
      expect(timeline.some((c) => c.changeType === "node-created")).toBe(true);
    });

    it("should handle adapter errors gracefully", async () => {
      const adapter: GraphDiscoveryAdapter = {
        provider: "aws",
        displayName: "Failing Adapter",
        supportedResourceTypes: () => ["compute"],
        discover: async () => { throw new Error("SDK connection failed"); },
        supportsIncrementalSync: () => false,
        healthCheck: async () => false,
      };
      engine.registerAdapter(adapter);

      const records = await engine.sync();
      expect(records[0]!.status).toBe("failed");
      expect(records[0]!.errors.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Blast Radius
  // ===========================================================================

  describe("blast radius", () => {
    beforeEach(async () => {
      // Graph: vpc -> subnet -> instance -> db
      //                      -> another-instance
      await storage.upsertNodes([
        makeNode("vpc", { resourceType: "vpc" }),
        makeNode("subnet", { resourceType: "subnet" }),
        makeNode("instance1", { resourceType: "compute", costMonthly: 50 }),
        makeNode("instance2", { resourceType: "compute", costMonthly: 30 }),
        makeNode("db", { resourceType: "database", costMonthly: 200 }),
      ]);
      await storage.upsertEdges([
        makeEdge("e1", "vpc", "subnet", { relationshipType: "contains" }),
        makeEdge("e2", "subnet", "instance1", { relationshipType: "contains" }),
        makeEdge("e3", "subnet", "instance2", { relationshipType: "contains" }),
        makeEdge("e4", "instance1", "db", { relationshipType: "depends-on" }),
      ]);
    });

    it("should compute blast radius for a subnet", async () => {
      const result = await engine.getBlastRadius("subnet", 3);

      // Should include instance1, instance2, db (and vpc via bidirectional)
      expect(result.nodes.size).toBeGreaterThanOrEqual(3);
      expect(result.edges.length).toBeGreaterThan(0);
    });

    it("should compute hop distances", async () => {
      const result = await engine.getBlastRadius("subnet", 3);

      // Hop 0 = subnet itself
      expect(result.hops.get(0)).toEqual(["subnet"]);
      // Hop 1 should include directly connected nodes
      const hop1 = result.hops.get(1) ?? [];
      expect(hop1.length).toBeGreaterThan(0);
    });

    it("should include cost totals", async () => {
      const result = await engine.getBlastRadius("subnet", 3);
      expect(result.totalCostMonthly).toBeGreaterThan(0);
    });

    it("should return empty result for non-existent node", async () => {
      const result = await engine.getBlastRadius("does-not-exist");
      expect(result.nodes.size).toBe(0);
    });
  });

  // ===========================================================================
  // Dependency Chain
  // ===========================================================================

  describe("dependency chain", () => {
    beforeEach(async () => {
      // a -> b -> c
      await storage.upsertNodes([
        makeNode("a"),
        makeNode("b"),
        makeNode("c"),
      ]);
      await storage.upsertEdges([
        makeEdge("e1", "a", "b"),
        makeEdge("e2", "b", "c"),
      ]);
    });

    it("should find downstream dependencies", async () => {
      const result = await engine.getDependencyChain("a", "downstream", 3);
      const nodeIds = [...result.nodes.keys()];
      expect(nodeIds).toContain("b");
      expect(nodeIds).toContain("c");
    });

    it("should find upstream dependencies", async () => {
      const result = await engine.getDependencyChain("c", "upstream", 3);
      const nodeIds = [...result.nodes.keys()];
      expect(nodeIds).toContain("b");
      expect(nodeIds).toContain("a");
    });
  });

  // ===========================================================================
  // Cost Attribution
  // ===========================================================================

  describe("cost attribution", () => {
    beforeEach(async () => {
      await storage.upsertNodes([
        makeNode("n1", { costMonthly: 100, resourceType: "compute" }),
        makeNode("n2", { costMonthly: 200, resourceType: "database" }),
        makeNode("n3", { costMonthly: 50, resourceType: "compute" }),
      ]);
      await storage.upsertEdges([
        makeEdge("e1", "n1", "n2"),
        makeEdge("e2", "n1", "n3"),
      ]);
    });

    it("should attribute cost to a single node", async () => {
      const cost = await engine.getNodeCost("n1", false);
      expect(cost.totalMonthly).toBe(100);
      expect(cost.nodes).toHaveLength(1);
    });

    it("should attribute cost including downstream", async () => {
      const cost = await engine.getNodeCost("n1", true);
      // Should include n1 (100), n2 (200), n3 (50)
      expect(cost.totalMonthly).toBe(350);
      expect(cost.byResourceType.compute).toBe(150);
      expect(cost.byResourceType.database).toBe(200);
    });

    it("should attribute cost by group", async () => {
      const group: GraphGroup = {
        id: "g1",
        name: "test-service",
        groupType: "service",
        provider: "aws",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await storage.upsertGroup(group);
      await storage.addGroupMember("g1", "n1");
      await storage.addGroupMember("g1", "n2");

      const cost = await engine.getGroupCost("g1");
      expect(cost.totalMonthly).toBe(300);
      expect(cost.label).toBe("test-service");
    });

    it("should sort cost nodes by cost descending", async () => {
      const cost = await engine.getNodeCost("n1", true);
      expect(cost.nodes[0]!.costMonthly).toBeGreaterThanOrEqual(cost.nodes[1]!.costMonthly);
    });
  });

  // ===========================================================================
  // Stats
  // ===========================================================================

  describe("stats", () => {
    it("should return graph statistics", async () => {
      await storage.upsertNodes([makeNode("n1"), makeNode("n2")]);
      await storage.upsertEdges([makeEdge("e1", "n1", "n2")]);

      const stats = await engine.getStats();
      expect(stats.totalNodes).toBe(2);
      expect(stats.totalEdges).toBe(1);
    });
  });

  // ===========================================================================
  // Topology Export
  // ===========================================================================

  describe("topology", () => {
    it("should export filtered topology", async () => {
      await storage.upsertNodes([
        makeNode("n1", { provider: "aws" }),
        makeNode("n2", { provider: "aws" }),
        makeNode("n3", { provider: "azure" }),
      ]);
      await storage.upsertEdges([
        makeEdge("e1", "n1", "n2"),
        makeEdge("e2", "n1", "n3"),
      ]);

      const topo = await engine.getTopology({ provider: "aws" });
      expect(topo.nodes).toHaveLength(2);
      // Only edge between AWS nodes should be included
      expect(topo.edges).toHaveLength(1);
      expect(topo.edges[0]!.id).toBe("e1");
    });
  });
});
