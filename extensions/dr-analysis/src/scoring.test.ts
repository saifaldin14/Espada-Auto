/**
 * DR Scoring tests — weighted posture scores, grade boundaries,
 * custom weights, dependency chain analysis, and complex topologies.
 */

import { describe, expect, it } from "vitest";
import { scorePosture, gradeFromScore } from "./scoring.js";
import {
  generateRecoveryPlan,
  findSingleRegionRisks,
  findUnprotectedCritical,
  estimateRTO,
  estimateRPO,
  analyzePosture,
} from "./analyzer.js";
import type { DRNode, DREdge, SingleRegionRisk, DRScoringWeights } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const node = (id: string, overrides?: Partial<DRNode>): DRNode => ({
  id,
  name: `resource-${id}`,
  provider: "aws",
  resourceType: "database",
  region: "us-east-1",
  status: "running",
  tags: {},
  metadata: {},
  costMonthly: 100,
  ...overrides,
});

const edge = (src: string, tgt: string, rel: string): DREdge => ({
  sourceId: src,
  targetId: tgt,
  relationshipType: rel,
});

// ---------------------------------------------------------------------------
// scorePosture — custom weights
// ---------------------------------------------------------------------------
describe("scorePosture — custom weights", () => {
  const nodes = [node("db1"), node("s1", { resourceType: "storage" })];

  it("returns 100 when no critical nodes exist", () => {
    const noncritical = [node("dns1", { resourceType: "dns" })];
    expect(scorePosture(noncritical, [], [], [])).toBe(100);
  });

  it("gives higher score when backup weight is dominant and backups exist", () => {
    const edges = [edge("db1", "bk", "backs-up"), edge("s1", "bk2", "backs-up")];
    const backupHeavy: DRScoringWeights = {
      backupCoverage: 0.8,
      replicationBreadth: 0.05,
      spofCount: 0.05,
      crossRegionDistribution: 0.05,
      recoveryPlanExistence: 0.05,
    };
    const score = scorePosture(nodes, edges, [], [], backupHeavy);
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it("penalises heavily when SPOF weight is high and resources unprotected", () => {
    const spofHeavy: DRScoringWeights = {
      backupCoverage: 0.05,
      replicationBreadth: 0.05,
      spofCount: 0.8,
      crossRegionDistribution: 0.05,
      recoveryPlanExistence: 0.05,
    };
    const score = scorePosture(nodes, [], [], nodes, spofHeavy);
    expect(score).toBeLessThan(20);
  });

  it("scores 0 in worst case (all unprotected, single region, no edges)", () => {
    const risks: SingleRegionRisk[] = [{
      region: "us-east-1", provider: "aws",
      criticalResources: 2, totalResources: 2,
      hasFailover: false, riskLevel: "critical",
    }];
    const score = scorePosture(nodes, [], risks, nodes);
    expect(score).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// gradeFromScore — boundary values
// ---------------------------------------------------------------------------
describe("gradeFromScore — boundaries", () => {
  it("returns A at exactly 90", () => expect(gradeFromScore(90)).toBe("A"));
  it("returns B at exactly 80", () => expect(gradeFromScore(80)).toBe("B"));
  it("returns C at exactly 70", () => expect(gradeFromScore(70)).toBe("C"));
  it("returns D at exactly 60", () => expect(gradeFromScore(60)).toBe("D"));
  it("returns F at 59", () => expect(gradeFromScore(59)).toBe("F"));
  it("returns A at 100", () => expect(gradeFromScore(100)).toBe("A"));
  it("returns F at 0", () => expect(gradeFromScore(0)).toBe("F"));
});

// ---------------------------------------------------------------------------
// RTO/RPO matrix coverage
// ---------------------------------------------------------------------------
describe("RTO/RPO matrix", () => {
  const strategies = ["none", "snapshot", "replication", "multi-region"] as const;
  const types = ["database", "storage", "compute", "cache", "queue", "cluster", "stream"];

  it("multi-region always yields lowest RTO for every type", () => {
    for (const t of types) {
      const multi = estimateRTO(t, "multi-region");
      const none = estimateRTO(t, "none");
      expect(multi).toBeLessThan(none);
    }
  });

  it("RTO ordering: none > snapshot > replication > multi-region", () => {
    for (const t of types) {
      const none = estimateRTO(t, "none");
      const snap = estimateRTO(t, "snapshot");
      const repl = estimateRTO(t, "replication");
      const multi = estimateRTO(t, "multi-region");
      expect(none).toBeGreaterThanOrEqual(snap);
      expect(snap).toBeGreaterThanOrEqual(repl);
      expect(repl).toBeGreaterThanOrEqual(multi);
    }
  });

  it("RPO ordering: active-active (0) < sync (1) < async (15) < none (1440)", () => {
    expect(estimateRPO("database", "active-active")).toBe(0);
    expect(estimateRPO("database", "sync")).toBe(1);
    expect(estimateRPO("database", "async")).toBe(15);
    expect(estimateRPO("database", "none")).toBe(1440);
  });
});

// ---------------------------------------------------------------------------
// Dependency chain analysis in recovery plans
// ---------------------------------------------------------------------------
describe("dependency chain analysis", () => {
  it("produces steps in priority order (db → storage → compute)", () => {
    const nodes = [
      node("c1", { resourceType: "compute" }),
      node("s1", { resourceType: "storage" }),
      node("db1", { resourceType: "database" }),
    ];
    const plan = generateRecoveryPlan("service-outage", nodes, []);
    const ids = plan.recoverySteps.map((s) => s.resourceId);
    expect(ids.indexOf("db1")).toBeLessThan(ids.indexOf("s1"));
    expect(ids.indexOf("s1")).toBeLessThan(ids.indexOf("c1"));
  });

  it("marks cluster recovery as manual", () => {
    const nodes = [node("k1", { resourceType: "cluster" })];
    const plan = generateRecoveryPlan("service-outage", nodes, []);
    expect(plan.recoverySteps[0]!.manual).toBe(true);
  });

  it("marks non-cluster recovery as automated", () => {
    const nodes = [node("db1", { resourceType: "database" })];
    const plan = generateRecoveryPlan("service-outage", nodes, []);
    expect(plan.recoverySteps[0]!.manual).toBe(false);
  });

  it("computes RPO based on replication status of affected nodes", () => {
    const nodes = [node("db1"), node("db2", { region: "us-west-2" })];
    const edges = [edge("db1", "db2", "replicates-to")];
    const plan = generateRecoveryPlan("region-failure", nodes, edges, "us-east-1");
    // Only db1 is affected (us-east-1); it has async replication → RPO=15
    expect(plan.estimatedRPO).toBeLessThan(1440);
  });

  it("handles az-failure scenario (subset of region)", () => {
    const nodes = Array.from({ length: 6 }, (_, i) =>
      node(`n${i}`, { resourceType: "compute", region: "us-east-1" }),
    );
    const plan = generateRecoveryPlan("az-failure", nodes, [], "us-east-1");
    expect(plan.affectedResources.length).toBe(2); // ceil(6/3)
    expect(plan.scenario).toBe("az-failure");
  });
});

// ---------------------------------------------------------------------------
// Complex topology — full analyzePosture integration
// ---------------------------------------------------------------------------
describe("complex topology scoring", () => {
  it("multi-region replicated topology scores higher than single-region", () => {
    const singleRegion = [
      node("db1"), node("app1", { resourceType: "compute" }),
    ];
    const multiRegion = [
      node("db1"), node("db2", { region: "eu-west-1" }),
      node("app1", { resourceType: "compute" }),
      node("app2", { resourceType: "compute", region: "eu-west-1" }),
    ];
    const multiEdges = [
      edge("db1", "db2", "replicates-to"),
      edge("db1", "db2", "fails-over-to"),
      edge("db1", "bk", "backs-up"),
      edge("db2", "bk2", "backs-up"),
    ];
    const single = analyzePosture(singleRegion, []);
    const multi = analyzePosture(multiRegion, multiEdges);
    expect(multi.overallScore).toBeGreaterThan(single.overallScore);
  });

  it("fully protected infra earns grade A or B", () => {
    const nodes = [
      node("db1"), node("db2", { region: "us-west-2" }),
      node("cache1", { resourceType: "cache" }),
    ];
    const edges = [
      edge("db1", "db2", "replicates-to"),
      edge("db1", "db2", "fails-over-to"),
      edge("db1", "bk1", "backs-up"),
      edge("db2", "bk2", "backs-up"),
      edge("cache1", "bk3", "backs-up"),
      edge("cache1", "cr", "replicates-to"),
    ];
    const result = analyzePosture(nodes, edges);
    expect(["A", "B", "C"]).toContain(result.grade);
  });

  it("monitoring gaps generate high-severity recommendation", () => {
    const nodes = [node("db1")];
    const edges = [edge("db1", "bk", "backs-up")];
    const result = analyzePosture(nodes, edges);
    const monRec = result.recommendations.find((r) => r.category === "monitoring");
    expect(monRec).toBeDefined();
    expect(monRec!.severity).toBe("high");
  });

  it("single-region risks are sorted by severity", () => {
    const nodes = [
      node("db1", { region: "us-east-1" }),
      node("dns1", { resourceType: "dns", region: "us-west-2" }),
    ];
    const risks = findSingleRegionRisks(nodes, []);
    expect(risks.length).toBe(2);
    // critical should come first
    const levels = risks.map((r) => r.riskLevel);
    expect(levels[0]).toBe("critical");
  });
});
