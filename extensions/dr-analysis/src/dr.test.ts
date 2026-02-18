/**
 * DR Analysis tests — posture scoring, recovery planning, gap detection.
 */

import { describe, expect, it } from "vitest";
import type { DRNode, DREdge } from "../src/types.js";
import {
  analyzePosture,
  findSingleRegionRisks,
  findUnprotectedCritical,
  getRecoveryRequirement,
  estimateRTO,
  estimateRPO,
  estimateRecoveryTimes,
  generateRecoveryPlan,
  generateRecommendations,
} from "../src/analyzer.js";
import { scorePosture, gradeFromScore } from "../src/scoring.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeNode = (overrides?: Partial<DRNode>): DRNode => ({
  id: "node-1",
  name: "test-resource",
  provider: "aws",
  resourceType: "database",
  region: "us-east-1",
  status: "running",
  tags: {},
  metadata: {},
  costMonthly: 100,
  ...overrides,
});

const makeEdge = (
  sourceId: string,
  targetId: string,
  relationshipType: string,
): DREdge => ({
  sourceId,
  targetId,
  relationshipType,
});

// ---------------------------------------------------------------------------
// findSingleRegionRisks
// ---------------------------------------------------------------------------
describe("findSingleRegionRisks", () => {
  it("detects critical risk for unprotected single-region database", () => {
    const nodes = [makeNode({ id: "db1", resourceType: "database", region: "us-east-1" })];
    const risks = findSingleRegionRisks(nodes, []);
    expect(risks).toHaveLength(1);
    expect(risks[0]!.riskLevel).toBe("critical");
    expect(risks[0]!.hasFailover).toBe(false);
  });

  it("detects medium risk when failover exists", () => {
    const nodes = [
      makeNode({ id: "db1", region: "us-east-1" }),
      makeNode({ id: "db2", region: "us-west-2" }),
    ];
    const edges = [makeEdge("db1", "db2", "replicates-to")];
    const risks = findSingleRegionRisks(nodes, edges);
    const east = risks.find((r) => r.region === "us-east-1");
    expect(east!.riskLevel).toBe("medium");
    expect(east!.hasFailover).toBe(true);
  });

  it("groups resources by provider:region", () => {
    const nodes = [
      makeNode({ id: "a", region: "us-east-1", provider: "aws" }),
      makeNode({ id: "b", region: "us-east-1", provider: "aws" }),
      makeNode({ id: "c", region: "eu-west-1", provider: "aws" }),
    ];
    const risks = findSingleRegionRisks(nodes, []);
    expect(risks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// findUnprotectedCritical
// ---------------------------------------------------------------------------
describe("findUnprotectedCritical", () => {
  it("identifies database without backup or replication", () => {
    const nodes = [makeNode({ id: "db1" })];
    const unprotected = findUnprotectedCritical(nodes, []);
    expect(unprotected).toHaveLength(1);
  });

  it("excludes protected resources", () => {
    const nodes = [makeNode({ id: "db1" })];
    const edges = [makeEdge("db1", "backup-target", "backs-up")];
    const unprotected = findUnprotectedCritical(nodes, edges);
    expect(unprotected).toHaveLength(0);
  });

  it("excludes non-critical types", () => {
    const nodes = [makeNode({ id: "dns1", resourceType: "dns" })];
    const unprotected = findUnprotectedCritical(nodes, []);
    expect(unprotected).toHaveLength(0);
  });

  it("identifies multiple unprotected", () => {
    const nodes = [
      makeNode({ id: "db1", resourceType: "database" }),
      makeNode({ id: "s1", resourceType: "storage" }),
      makeNode({ id: "c1", resourceType: "compute" }),
    ];
    const unprotected = findUnprotectedCritical(nodes, []);
    expect(unprotected).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// getRecoveryRequirement
// ---------------------------------------------------------------------------
describe("getRecoveryRequirement", () => {
  it("returns none for unprotected resource", () => {
    const node = makeNode({ id: "db1" });
    const req = getRecoveryRequirement(node, []);
    expect(req.backupStrategy).toBe("none");
    expect(req.replicationStatus).toBe("none");
    expect(req.failoverCapable).toBe(false);
  });

  it("detects snapshot strategy for backup edge", () => {
    const node = makeNode({ id: "db1" });
    const edges = [makeEdge("db1", "backup", "backs-up")];
    const req = getRecoveryRequirement(node, edges);
    expect(req.backupStrategy).toBe("snapshot");
  });

  it("detects multi-region for backup + replication", () => {
    const node = makeNode({ id: "db1" });
    const edges = [
      makeEdge("db1", "backup", "backs-up"),
      makeEdge("db1", "replica", "replicates-to"),
    ];
    const req = getRecoveryRequirement(node, edges);
    expect(req.backupStrategy).toBe("multi-region");
    expect(req.replicationStatus).toBe("async");
  });

  it("detects sync replication with failover", () => {
    const node = makeNode({ id: "db1" });
    const edges = [
      makeEdge("db1", "replica", "replicates-to"),
      makeEdge("db1", "replica", "fails-over-to"),
    ];
    const req = getRecoveryRequirement(node, edges);
    expect(req.replicationStatus).toBe("sync");
    expect(req.failoverCapable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// estimateRTO / estimateRPO
// ---------------------------------------------------------------------------
describe("estimateRTO", () => {
  it("returns lower RTO for multi-region", () => {
    const multi = estimateRTO("database", "multi-region");
    const none = estimateRTO("database", "none");
    expect(multi).toBeLessThan(none);
  });

  it("handles unknown resource type", () => {
    const rto = estimateRTO("unknown", "snapshot");
    expect(rto).toBe(30);
  });
});

describe("estimateRPO", () => {
  it("returns 0 for active-active", () => {
    expect(estimateRPO("database", "active-active")).toBe(0);
  });

  it("returns 1440 for no replication", () => {
    expect(estimateRPO("database", "none")).toBe(1440);
  });
});

// ---------------------------------------------------------------------------
// estimateRecoveryTimes
// ---------------------------------------------------------------------------
describe("estimateRecoveryTimes", () => {
  it("returns RTO for each node", () => {
    const nodes = [
      makeNode({ id: "db1", resourceType: "database" }),
      makeNode({ id: "c1", resourceType: "compute" }),
    ];
    const times = estimateRecoveryTimes(nodes, []);
    expect(times["db1"]).toBeGreaterThan(0);
    expect(times["c1"]).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// generateRecoveryPlan
// ---------------------------------------------------------------------------
describe("generateRecoveryPlan", () => {
  it("generates plan for region failure", () => {
    const nodes = [
      makeNode({ id: "db1", resourceType: "database", region: "us-east-1" }),
      makeNode({ id: "c1", resourceType: "compute", region: "us-east-1" }),
      makeNode({ id: "c2", resourceType: "compute", region: "us-west-2" }),
    ];
    const plan = generateRecoveryPlan("region-failure", nodes, [], "us-east-1");
    expect(plan.scenario).toBe("region-failure");
    expect(plan.affectedResources).toHaveLength(2);
    expect(plan.recoverySteps.length).toBeGreaterThan(0);
  });

  it("generates plan for data corruption (databases + storage only)", () => {
    const nodes = [
      makeNode({ id: "db1", resourceType: "database" }),
      makeNode({ id: "s1", resourceType: "storage" }),
      makeNode({ id: "c1", resourceType: "compute" }),
    ];
    const plan = generateRecoveryPlan("data-corruption", nodes, []);
    expect(plan.affectedResources).toHaveLength(2);
  });

  it("orders recovery steps with databases first", () => {
    const nodes = [
      makeNode({ id: "c1", resourceType: "compute" }),
      makeNode({ id: "db1", resourceType: "database" }),
    ];
    const plan = generateRecoveryPlan("service-outage", nodes, []);
    expect(plan.recoverySteps[0]!.resourceId).toBe("db1");
  });
});

// ---------------------------------------------------------------------------
// generateRecommendations
// ---------------------------------------------------------------------------
describe("generateRecommendations", () => {
  it("recommends backup for unprotected resources", () => {
    const nodes = [makeNode({ id: "db1" })];
    const unprotected = [nodes[0]!];
    const recs = generateRecommendations(nodes, [], [], unprotected);
    expect(recs.some((r) => r.category === "backup")).toBe(true);
  });

  it("returns empty when everything is protected", () => {
    const recs = generateRecommendations([], [], [], []);
    expect(recs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// scorePosture / gradeFromScore
// ---------------------------------------------------------------------------
describe("scorePosture", () => {
  it("returns 100 for no critical resources", () => {
    const nodes = [makeNode({ id: "dns1", resourceType: "dns" })];
    const score = scorePosture(nodes, [], [], []);
    expect(score).toBe(100);
  });

  it("returns low score for unprotected critical resources", () => {
    const nodes = [makeNode({ id: "db1" })];
    const score = scorePosture(nodes, [], [{ region: "us-east-1", provider: "aws", criticalResources: 1, totalResources: 1, hasFailover: false, riskLevel: "critical" }], [nodes[0]!]);
    expect(score).toBeLessThan(50);
  });

  it("returns higher score with backup coverage", () => {
    const nodes = [makeNode({ id: "db1" })];
    const edges = [makeEdge("db1", "backup", "backs-up")];
    const scoreProtected = scorePosture(nodes, edges, [], []);
    const scoreUnprotected = scorePosture(nodes, [], [{ region: "us-east-1", provider: "aws", criticalResources: 1, totalResources: 1, hasFailover: false, riskLevel: "critical" }], [nodes[0]!]);
    expect(scoreProtected).toBeGreaterThan(scoreUnprotected);
  });
});

describe("gradeFromScore", () => {
  it("returns A for 90+", () => expect(gradeFromScore(95)).toBe("A"));
  it("returns B for 80-89", () => expect(gradeFromScore(85)).toBe("B"));
  it("returns C for 70-79", () => expect(gradeFromScore(75)).toBe("C"));
  it("returns D for 60-69", () => expect(gradeFromScore(65)).toBe("D"));
  it("returns F for <60", () => expect(gradeFromScore(45)).toBe("F"));
});

// ---------------------------------------------------------------------------
// analyzePosture (integration)
// ---------------------------------------------------------------------------
describe("analyzePosture", () => {
  it("returns full analysis with score and grade", () => {
    const nodes = [
      makeNode({ id: "db1", resourceType: "database" }),
      makeNode({ id: "s1", resourceType: "storage" }),
    ];
    const result = analyzePosture(nodes, []);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D", "F"]).toContain(result.grade);
    expect(result.unprotectedCriticalResources.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("returns good score for well-protected infra", () => {
    const nodes = [
      makeNode({ id: "db1", resourceType: "database", region: "us-east-1" }),
      makeNode({ id: "db2", resourceType: "database", region: "us-west-2" }),
    ];
    const edges = [
      makeEdge("db1", "backup1", "backs-up"),
      makeEdge("db1", "db2", "replicates-to"),
      makeEdge("db1", "db2", "fails-over-to"),
      makeEdge("db2", "backup2", "backs-up"),
      makeEdge("db1", "mon1", "monitored-by"),
      makeEdge("db2", "mon1", "monitored-by"),
    ];
    const result = analyzePosture(nodes, edges);
    expect(result.overallScore).toBeGreaterThan(50);
    expect(result.unprotectedCriticalResources).toHaveLength(0);
  });
});
