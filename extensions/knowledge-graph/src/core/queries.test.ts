/**
 * Infrastructure Knowledge Graph — Graph Query Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStorage } from "../storage/memory-store.js";
import {
  shortestPath,
  findOrphans,
  findCriticalNodes,
  findSinglePointsOfFailure,
  findClusters,
} from "./queries.js";
import type { GraphStorage, GraphNodeInput, GraphEdgeInput } from "../types.js";

// =============================================================================
// Helpers
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

function makeEdge(id: string, from: string, to: string, rel = "runs-in"): GraphEdgeInput {
  return {
    id,
    sourceNodeId: from,
    targetNodeId: to,
    relationshipType: rel as GraphEdgeInput["relationshipType"],
    confidence: 1.0,
    discoveredVia: "api-field",
    metadata: {},
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("Graph Queries", () => {
  let storage: GraphStorage;

  beforeEach(() => {
    storage = new InMemoryGraphStorage();
  });

  // ===========================================================================
  // Shortest Path
  // ===========================================================================

  describe("shortestPath", () => {
    it("should find shortest path between two nodes", async () => {
      await storage.upsertNodes([makeNode("a"), makeNode("b"), makeNode("c")]);
      await storage.upsertEdges([
        makeEdge("e1", "a", "b"),
        makeEdge("e2", "b", "c"),
      ]);

      const result = await shortestPath(storage, "a", "c");
      expect(result.found).toBe(true);
      expect(result.path).toEqual(["a", "b", "c"]);
      expect(result.hops).toBe(2);
      expect(result.edges).toHaveLength(2);
    });

    it("should return the shorter of two paths", async () => {
      // a -> b -> c -> d (long path)
      // a -> d (short path)
      await storage.upsertNodes([makeNode("a"), makeNode("b"), makeNode("c"), makeNode("d")]);
      await storage.upsertEdges([
        makeEdge("e1", "a", "b"),
        makeEdge("e2", "b", "c"),
        makeEdge("e3", "c", "d"),
        makeEdge("e4", "a", "d"),
      ]);

      const result = await shortestPath(storage, "a", "d");
      expect(result.found).toBe(true);
      expect(result.hops).toBe(1);
      expect(result.path).toEqual(["a", "d"]);
    });

    it("should return not-found for disconnected nodes", async () => {
      await storage.upsertNodes([makeNode("a"), makeNode("b")]);
      // No edges

      const result = await shortestPath(storage, "a", "b");
      expect(result.found).toBe(false);
      expect(result.path).toEqual([]);
    });

    it("should handle same source and destination", async () => {
      await storage.upsertNodes([makeNode("a")]);

      const result = await shortestPath(storage, "a", "a");
      expect(result.found).toBe(true);
      expect(result.path).toEqual(["a"]);
      expect(result.hops).toBe(0);
    });

    it("should treat graph as undirected for path finding", async () => {
      // a -> b, c -> b (but path from a to c should work via b)
      await storage.upsertNodes([makeNode("a"), makeNode("b"), makeNode("c")]);
      await storage.upsertEdges([
        makeEdge("e1", "a", "b"),
        makeEdge("e2", "c", "b"),
      ]);

      const result = await shortestPath(storage, "a", "c");
      expect(result.found).toBe(true);
      expect(result.hops).toBe(2);
    });
  });

  // ===========================================================================
  // Orphans
  // ===========================================================================

  describe("findOrphans", () => {
    it("should find nodes with no edges", async () => {
      await storage.upsertNodes([makeNode("a"), makeNode("b"), makeNode("c")]);
      await storage.upsertEdges([makeEdge("e1", "a", "b")]);

      const orphans = await findOrphans(storage);
      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.id).toBe("c");
    });

    it("should return empty when all nodes are connected", async () => {
      await storage.upsertNodes([makeNode("a"), makeNode("b")]);
      await storage.upsertEdges([makeEdge("e1", "a", "b")]);

      const orphans = await findOrphans(storage);
      expect(orphans).toHaveLength(0);
    });

    it("should return all nodes when none are connected", async () => {
      await storage.upsertNodes([makeNode("a"), makeNode("b"), makeNode("c")]);

      const orphans = await findOrphans(storage);
      expect(orphans).toHaveLength(3);
    });
  });

  // ===========================================================================
  // Critical Nodes
  // ===========================================================================

  describe("findCriticalNodes", () => {
    it("should identify high-degree nodes", async () => {
      // Hub-and-spoke: hub connects to a, b, c, d
      await storage.upsertNodes([
        makeNode("hub"),
        makeNode("a"),
        makeNode("b"),
        makeNode("c"),
        makeNode("d"),
      ]);
      await storage.upsertEdges([
        makeEdge("e1", "hub", "a"),
        makeEdge("e2", "hub", "b"),
        makeEdge("e3", "hub", "c"),
        makeEdge("e4", "hub", "d"),
      ]);

      const critical = await findCriticalNodes(storage, undefined, 5);
      expect(critical.length).toBeGreaterThan(0);
      const hub = critical.find((c) => c.node.id === "hub");
      expect(hub).toBeDefined();
      expect(hub!.outDegree).toBe(4);
    });

    it("should skip nodes with zero edges", async () => {
      await storage.upsertNodes([makeNode("isolated")]);

      const critical = await findCriticalNodes(storage);
      expect(critical).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Single Points of Failure
  // ===========================================================================

  describe("findSinglePointsOfFailure", () => {
    it("should find articulation points", async () => {
      // a - b - c (b is articulation point)
      await storage.upsertNodes([makeNode("a"), makeNode("b"), makeNode("c")]);
      await storage.upsertEdges([
        makeEdge("e1", "a", "b"),
        makeEdge("e2", "b", "c"),
      ]);

      const spofs = await findSinglePointsOfFailure(storage);
      expect(spofs.map((n) => n.id)).toContain("b");
    });

    it("should not flag nodes in a fully connected triangle", async () => {
      // a - b, b - c, a - c (no articulation points)
      await storage.upsertNodes([makeNode("a"), makeNode("b"), makeNode("c")]);
      await storage.upsertEdges([
        makeEdge("e1", "a", "b"),
        makeEdge("e2", "b", "c"),
        makeEdge("e3", "a", "c"),
      ]);

      const spofs = await findSinglePointsOfFailure(storage);
      expect(spofs).toHaveLength(0);
    });

    it("should return empty for fewer than 3 nodes", async () => {
      await storage.upsertNodes([makeNode("a"), makeNode("b")]);
      await storage.upsertEdges([makeEdge("e1", "a", "b")]);

      const spofs = await findSinglePointsOfFailure(storage);
      expect(spofs).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Clusters
  // ===========================================================================

  describe("findClusters", () => {
    it("should find connected components", async () => {
      // Cluster 1: a-b, Cluster 2: c-d, Isolated: e
      await storage.upsertNodes([
        makeNode("a"), makeNode("b"),
        makeNode("c"), makeNode("d"),
        makeNode("e"),
      ]);
      await storage.upsertEdges([
        makeEdge("e1", "a", "b"),
        makeEdge("e2", "c", "d"),
      ]);

      const result = await findClusters(storage);
      expect(result.clusters).toHaveLength(2); // a-b and c-d
      expect(result.isolatedNodes).toEqual(["e"]);
      expect(result.totalClusters).toBe(3); // 2 clusters + 1 isolated
    });

    it("should handle fully connected graph as single cluster", async () => {
      await storage.upsertNodes([makeNode("a"), makeNode("b"), makeNode("c")]);
      await storage.upsertEdges([
        makeEdge("e1", "a", "b"),
        makeEdge("e2", "b", "c"),
      ]);

      const result = await findClusters(storage);
      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0]).toHaveLength(3);
      expect(result.isolatedNodes).toHaveLength(0);
    });
  });
});
