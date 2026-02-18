/**
 * DR Analysis ↔ Knowledge Graph Bridge — Tests
 *
 * Tests the type conversion, bridge sync, and analysis facade.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  KnowledgeGraphBridge,
  kgNodesToDR,
  kgEdgesToDR,
  type KGNode,
  type KGEdge,
} from "./kg-bridge.js";

// =============================================================================
// Test Helpers — KG-shaped data
// =============================================================================

function makeKGNode(overrides?: Partial<KGNode>): KGNode {
  return {
    id: "aws:123:us-east-1:compute:i-abc",
    name: "web-server-1",
    provider: "aws",
    resourceType: "compute",
    region: "us-east-1",
    status: "running",
    tags: { Environment: "production" },
    metadata: { instanceType: "t3.large" },
    costMonthly: 120,
    ...overrides,
  };
}

function makeKGEdge(overrides?: Partial<KGEdge>): KGEdge {
  return {
    sourceNodeId: "aws:123:us-east-1:compute:i-abc",
    targetNodeId: "aws:123:us-east-1:database:db-xyz",
    relationshipType: "connects-to",
    ...overrides,
  };
}

function makeSampleTopology(): { nodes: KGNode[]; edges: KGEdge[] } {
  return {
    nodes: [
      makeKGNode({ id: "n1", name: "web-server", provider: "aws", region: "us-east-1", resourceType: "compute" }),
      makeKGNode({ id: "n2", name: "api-server", provider: "aws", region: "us-east-1", resourceType: "compute" }),
      makeKGNode({ id: "n3", name: "primary-db", provider: "aws", region: "us-east-1", resourceType: "database" }),
      makeKGNode({ id: "n4", name: "replica-db", provider: "aws", region: "us-west-2", resourceType: "database" }),
      makeKGNode({ id: "n5", name: "lb", provider: "aws", region: "us-east-1", resourceType: "load-balancer" }),
      makeKGNode({ id: "n6", name: "k8s-cluster", provider: "kubernetes", region: "default", resourceType: "cluster" }),
    ],
    edges: [
      makeKGEdge({ sourceNodeId: "n5", targetNodeId: "n1", relationshipType: "routes-to" }),
      makeKGEdge({ sourceNodeId: "n5", targetNodeId: "n2", relationshipType: "routes-to" }),
      makeKGEdge({ sourceNodeId: "n1", targetNodeId: "n3", relationshipType: "connects-to" }),
      makeKGEdge({ sourceNodeId: "n2", targetNodeId: "n3", relationshipType: "connects-to" }),
      makeKGEdge({ sourceNodeId: "n3", targetNodeId: "n4", relationshipType: "replicates-to" }),
    ],
  };
}

// =============================================================================
// Type Conversion Tests
// =============================================================================

describe("kgNodesToDR", () => {
  it("should convert KG nodes to DR nodes", () => {
    const kgNodes = [
      makeKGNode({ id: "n1", provider: "aws" }),
      makeKGNode({ id: "n2", provider: "azure" }),
      makeKGNode({ id: "n3", provider: "gcp" }),
    ];

    const drNodes = kgNodesToDR(kgNodes);
    expect(drNodes.length).toBe(3);
    expect(drNodes[0]!.id).toBe("n1");
    expect(drNodes[1]!.provider).toBe("azure");
    expect(drNodes[2]!.provider).toBe("gcp");
  });

  it("should filter out non-cloud providers", () => {
    const kgNodes = [
      makeKGNode({ id: "n1", provider: "aws" }),
      makeKGNode({ id: "n2", provider: "kubernetes" }),
      makeKGNode({ id: "n3", provider: "custom" }),
    ];

    const drNodes = kgNodesToDR(kgNodes);
    expect(drNodes.length).toBe(1);
    expect(drNodes[0]!.id).toBe("n1");
  });

  it("should default null tags/metadata", () => {
    const node = makeKGNode({ tags: undefined as any, metadata: undefined as any });
    const drNodes = kgNodesToDR([node]);
    expect(drNodes[0]!.tags).toEqual({});
    expect(drNodes[0]!.metadata).toEqual({});
  });

  it("should handle empty input", () => {
    expect(kgNodesToDR([])).toEqual([]);
  });
});

describe("kgEdgesToDR", () => {
  it("should rename sourceNodeId/targetNodeId to sourceId/targetId", () => {
    const edges = [
      makeKGEdge({ sourceNodeId: "a", targetNodeId: "b", relationshipType: "connects-to" }),
    ];
    const nodeIds = new Set(["a", "b"]);

    const drEdges = kgEdgesToDR(edges, nodeIds);
    expect(drEdges.length).toBe(1);
    expect(drEdges[0]!.sourceId).toBe("a");
    expect(drEdges[0]!.targetId).toBe("b");
    expect(drEdges[0]!.relationshipType).toBe("connects-to");
  });

  it("should filter out edges with endpoints outside the node set", () => {
    const edges = [
      makeKGEdge({ sourceNodeId: "a", targetNodeId: "b" }),
      makeKGEdge({ sourceNodeId: "a", targetNodeId: "c" }),
    ];
    const nodeIds = new Set(["a", "b"]); // "c" not included

    const drEdges = kgEdgesToDR(edges, nodeIds);
    expect(drEdges.length).toBe(1);
  });

  it("should handle empty input", () => {
    expect(kgEdgesToDR([], new Set())).toEqual([]);
  });
});

// =============================================================================
// KnowledgeGraphBridge Tests
// =============================================================================

describe("KnowledgeGraphBridge", () => {
  let bridge: KnowledgeGraphBridge;
  let fetchMock: ReturnType<typeof vi.fn<(filter?: Record<string, unknown>) => Promise<{ nodes: KGNode[]; edges: KGEdge[] }>>>;

  beforeEach(() => {
    fetchMock = vi.fn<(filter?: Record<string, unknown>) => Promise<{ nodes: KGNode[]; edges: KGEdge[] }>>().mockResolvedValue(makeSampleTopology());
    bridge = new KnowledgeGraphBridge(fetchMock);
  });

  describe("sync", () => {
    it("should fetch topology and return counts", async () => {
      const result = await bridge.sync();

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(result.nodeCount).toBe(5); // 6 KG nodes minus 1 kubernetes
      expect(result.edgeCount).toBe(5);
      expect(result.filteredOut).toBe(1); // kubernetes node
    });

    it("should pass provider filter to fetch", async () => {
      await bridge.sync({ provider: "aws" });

      expect(fetchMock).toHaveBeenCalledWith({ provider: "aws" });
    });

    it("should pass region filter to fetch", async () => {
      await bridge.sync({ region: "us-east-1" });

      expect(fetchMock).toHaveBeenCalledWith({ region: "us-east-1" });
    });

    it("should pass no filter when none specified", async () => {
      await bridge.sync();

      expect(fetchMock).toHaveBeenCalledWith(undefined);
    });
  });

  describe("analyzePosture", () => {
    it("should return null before sync", () => {
      expect(bridge.analyzePosture()).toBeNull();
    });

    it("should return analysis after sync", async () => {
      await bridge.sync();

      const analysis = bridge.analyzePosture();
      expect(analysis).not.toBeNull();
      expect(analysis!.grade).toBeDefined();
      expect(analysis!.overallScore).toBeGreaterThanOrEqual(0);
      expect(analysis!.overallScore).toBeLessThanOrEqual(100);
      expect(analysis!.recommendations).toBeInstanceOf(Array);
    });
  });

  describe("generatePlan", () => {
    it("should return null before sync", () => {
      expect(bridge.generatePlan("region-failure")).toBeNull();
    });

    it("should return recovery plan after sync", async () => {
      await bridge.sync();

      const plan = bridge.generatePlan("region-failure", "us-east-1");
      expect(plan).not.toBeNull();
      expect(plan!.scenario).toBe("region-failure");
      expect(plan!.recoverySteps).toBeInstanceOf(Array);
      expect(plan!.estimatedRTO).toBeGreaterThanOrEqual(0);
    });
  });

  describe("findGaps", () => {
    it("should return empty before sync", () => {
      expect(bridge.findGaps()).toEqual([]);
    });

    it("should return unprotected resources after sync", async () => {
      await bridge.sync();

      const gaps = bridge.findGaps();
      // The sample topology has some resources without backups
      expect(gaps).toBeInstanceOf(Array);
    });

    it("should filter by resource type", async () => {
      await bridge.sync();

      const dbGaps = bridge.findGaps("database");
      const allGaps = bridge.findGaps();

      // Filtered result should be subset of all gaps
      expect(dbGaps.length).toBeLessThanOrEqual(allGaps.length);
      for (const g of dbGaps) {
        expect(g.resourceType).toBe("database");
      }
    });
  });

  describe("getStatus", () => {
    it("should report not synced initially", () => {
      const status = bridge.getStatus();
      expect(status.synced).toBe(false);
      expect(status.lastSyncAt).toBeNull();
      expect(status.nodeCount).toBe(0);
    });

    it("should report synced after sync", async () => {
      await bridge.sync();

      const status = bridge.getStatus();
      expect(status.synced).toBe(true);
      expect(status.lastSyncAt).toBeDefined();
      expect(status.nodeCount).toBe(5);
      expect(status.edgeCount).toBe(5);
    });
  });

  describe("error handling", () => {
    it("should propagate fetch errors", async () => {
      const failingBridge = new KnowledgeGraphBridge(
        () => Promise.reject(new Error("KG unavailable")),
      );

      await expect(failingBridge.sync()).rejects.toThrow("KG unavailable");
    });
  });
});
