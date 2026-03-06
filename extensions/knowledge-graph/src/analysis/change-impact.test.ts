/**
 * Infrastructure Knowledge Graph — Change Impact Analyzer Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  analyzeChangeImpact,
  formatImpactSummary,
  type ChangeImpactReport,
  type ChangeAction,
} from "./change-impact.js";
import type {
  GraphStorage,
  GraphNode,
  GraphEdge,
  SubgraphResult,
  GraphGroup,
  GraphStats,
} from "../types.js";
import type { GraphEngine } from "../core/engine.js";

// =============================================================================
// Fixtures
// =============================================================================

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "node-1",
    provider: "aws",
    resourceType: "compute",
    nativeId: "i-abc123",
    name: "web-server-1",
    region: "us-east-1",
    account: "123456789",
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: 100,
    owner: null,
    discoveredAt: "2025-01-01T00:00:00Z",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    lastSeenAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEdge(src: string, tgt: string, rel: string = "depends-on"): GraphEdge {
  return {
    id: `${src}-${tgt}`,
    sourceNodeId: src,
    targetNodeId: tgt,
    relationshipType: rel as GraphEdge["relationshipType"],
    confidence: 1,
    discoveredVia: "config-scan",
    metadata: {},
    createdAt: "2025-01-01T00:00:00Z",
    lastSeenAt: "2025-01-01T00:00:00Z",
  };
}

function buildSubgraph(
  root: GraphNode,
  dependents: GraphNode[],
  edges: GraphEdge[],
): SubgraphResult {
  const nodes = new Map<string, GraphNode>();
  nodes.set(root.id, root);
  for (const d of dependents) nodes.set(d.id, d);

  const hops = new Map<number, string[]>();
  hops.set(0, [root.id]);
  if (dependents.length > 0) {
    hops.set(1, dependents.map((d) => d.id));
  }

  const totalCost = Array.from(nodes.values()).reduce(
    (sum, n) => sum + (n.costMonthly ?? 0),
    0,
  );

  return { rootNodeId: root.id, nodes, edges, hops, totalCostMonthly: totalCost };
}

// =============================================================================
// Mocks
// =============================================================================

function mockStorage(nodes: Map<string, GraphNode>): GraphStorage {
  return {
    getNode: vi.fn(async (id: string) => nodes.get(id) ?? null),
    getNodeGroups: vi.fn(async () => []),
    queryNodes: vi.fn(async () => Array.from(nodes.values())),
    getEdgesForNode: vi.fn(async () => []),
    queryEdges: vi.fn(async () => []),
    getStats: vi.fn(async (): Promise<GraphStats> => ({
      totalNodes: nodes.size,
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
    })),
  } as unknown as GraphStorage;
}

function mockEngine(
  storage: GraphStorage,
  blastResult: SubgraphResult,
): GraphEngine {
  return {
    getStorage: () => storage,
    getBlastRadius: vi.fn(async () => blastResult),
    getStats: vi.fn(async () => ({
      totalNodes: 10,
      totalEdges: 5,
      totalChanges: 0,
      totalGroups: 0,
      nodesByProvider: {},
      nodesByResourceType: {},
      edgesByRelationshipType: {},
      totalCostMonthly: 1000,
      lastSyncAt: null,
      oldestChange: null,
      newestChange: null,
    })),
  } as unknown as GraphEngine;
}

// =============================================================================
// Tests
// =============================================================================

describe("Change Impact Analyzer", () => {
  const dbNode = makeNode({
    id: "rds-1",
    name: "payment-db",
    resourceType: "database",
    costMonthly: 500,
    tags: { environment: "production", team: "payments" },
  });

  const apiNode = makeNode({
    id: "api-1",
    name: "payment-api",
    resourceType: "compute",
    costMonthly: 200,
    tags: { team: "payments" },
  });

  const workerNode = makeNode({
    id: "worker-1",
    name: "analytics-worker",
    resourceType: "compute",
    costMonthly: 150,
    tags: { team: "data-eng" },
  });

  const allNodes = new Map<string, GraphNode>();
  allNodes.set("rds-1", dbNode);
  allNodes.set("api-1", apiNode);
  allNodes.set("worker-1", workerNode);

  const edges = [
    makeEdge("api-1", "rds-1", "reads-from"),
    makeEdge("worker-1", "rds-1", "reads-from"),
  ];

  const subgraph = buildSubgraph(dbNode, [apiNode, workerNode], edges);

  describe("analyzeChangeImpact", () => {
    it("throws if target node not found", async () => {
      const storage = mockStorage(new Map());
      const engine = mockEngine(storage, subgraph);

      await expect(
        analyzeChangeImpact(engine, storage, "nonexistent", "destroy"),
      ).rejects.toThrow("Node not found: nonexistent");
    });

    it("produces a full report for destructive action on database", async () => {
      const storage = mockStorage(allNodes);
      const engine = mockEngine(storage, subgraph);

      const report = await analyzeChangeImpact(engine, storage, "rds-1", "destroy");

      expect(report.targetNode.id).toBe("rds-1");
      expect(report.action).toBe("destroy");

      // Blast radius should include both dependents
      expect(report.blastRadius.totalAffected).toBe(2);
      expect(report.blastRadius.directDependents).toBe(2);

      // Data loss risk for read-from relationships
      const dataLoss = report.blastRadius.affectedResources.filter(
        (r) => r.impact === "data-loss-risk",
      );
      expect(dataLoss.length).toBeGreaterThan(0);

      // Cost impact
      expect(report.costImpact.directMonthlyCost).toBe(500);
      expect(report.costImpact.downstreamCostAtRisk).toBe(350); // 200 + 150
      expect(report.costImpact.netMonthlyCostChange).toBe(-500);
      expect(report.costImpact.estimatedIncidentCost).toBeGreaterThan(0);

      // Risk should be high or critical for production database destroy
      expect(["high", "critical"]).toContain(report.risk.level);

      // Summary should be populated
      expect(report.summary).toContain("payment-db");
      expect(report.summary).toContain("destroy");
    });

    it("reports teams via owner tags", async () => {
      const storage = mockStorage(allNodes);
      const engine = mockEngine(storage, subgraph);

      const report = await analyzeChangeImpact(engine, storage, "rds-1", "destroy");

      // Both teams from tags should appear
      const teamNames = report.teamsAffected.map((t) => t.team);
      expect(teamNames).toContain("payments");
      expect(teamNames).toContain("data-eng");
    });

    it("includes safe path steps for database destroy", async () => {
      const storage = mockStorage(allNodes);
      const engine = mockEngine(storage, subgraph);

      const report = await analyzeChangeImpact(engine, storage, "rds-1", "destroy");

      expect(report.suggestedSafePath.length).toBeGreaterThanOrEqual(3);

      // First step should be backup for database
      expect(report.suggestedSafePath[0].action).toContain("backup");

      // Should include migration steps for data consumers
      const migrationSteps = report.suggestedSafePath.filter(
        (s) => s.action.includes("Migrate") || s.action.includes("dependency"),
      );
      expect(migrationSteps.length).toBeGreaterThan(0);
    });

    it("handles non-destructive actions with lower impact", async () => {
      const storage = mockStorage(allNodes);
      const engine = mockEngine(storage, subgraph);

      const report = await analyzeChangeImpact(engine, storage, "rds-1", "scale-up");

      // Scale-up should not have incident cost
      expect(report.costImpact.estimatedIncidentCost).toBe(0);

      // Net cost should be positive (increase)
      expect(report.costImpact.netMonthlyCostChange).toBeGreaterThan(0);

      // Dependents should be degraded, not broken
      const willBreak = report.blastRadius.affectedResources.filter(
        (r) => r.impact === "will-break" || r.impact === "data-loss-risk",
      );
      expect(willBreak.length).toBe(0);
    });

    it("handles isolated node with no dependents", async () => {
      const loneNode = makeNode({ id: "lone-1", name: "lone-server", costMonthly: 50 });
      const loneNodes = new Map([["lone-1", loneNode]]);
      const loneSubgraph = buildSubgraph(loneNode, [], []);
      const storage = mockStorage(loneNodes);
      const engine = mockEngine(storage, loneSubgraph);

      const report = await analyzeChangeImpact(engine, storage, "lone-1", "destroy");

      expect(report.blastRadius.totalAffected).toBe(0);
      expect(report.costImpact.downstreamCostAtRisk).toBe(0);
      expect(report.risk.level).toBe("low");
    });
  });

  describe("formatImpactSummary", () => {
    it("produces markdown with all sections", async () => {
      const storage = mockStorage(allNodes);
      const engine = mockEngine(storage, subgraph);
      const report = await analyzeChangeImpact(engine, storage, "rds-1", "destroy");

      const md = formatImpactSummary(report);

      expect(md).toContain("## Impact Analysis");
      expect(md).toContain("Blast Radius");
      expect(md).toContain("Cost Impact");
      expect(md).toContain("Teams Affected");
      expect(md).toContain("Suggested Safe Path");
      expect(md).toContain("Risk Factors");
    });

    it("markdown contains actual resource names", async () => {
      const storage = mockStorage(allNodes);
      const engine = mockEngine(storage, subgraph);
      const report = await analyzeChangeImpact(engine, storage, "rds-1", "destroy");

      const md = formatImpactSummary(report);
      expect(md).toContain("payment-api");
      expect(md).toContain("analytics-worker");
    });
  });
});
