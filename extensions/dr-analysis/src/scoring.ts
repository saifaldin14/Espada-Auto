/**
 * DR posture scoring — weighted score 0-100 and grade A-F.
 */

import type {
  DRNode,
  DREdge,
  DRGrade,
  SingleRegionRisk,
  DEFAULT_WEIGHTS as _DefaultWeights,
} from "./types.js";
import { DEFAULT_WEIGHTS } from "./types.js";

const CRITICAL_TYPES = new Set([
  "database", "storage", "queue", "stream", "cache", "cluster", "compute",
]);

const BACKUP_EDGES = new Set(["backs-up", "backed-by"]);
const REPLICATION_EDGES = new Set(["replicates-to", "replicates"]);

/**
 * Score the overall DR posture (0-100).
 */
export function scorePosture(
  nodes: DRNode[],
  edges: DREdge[],
  regionRisks: SingleRegionRisk[],
  unprotected: DRNode[],
  weights = DEFAULT_WEIGHTS,
): number {
  const criticalNodes = nodes.filter((n) => CRITICAL_TYPES.has(n.resourceType));
  if (criticalNodes.length === 0) return 100; // No critical resources = perfect score

  // 1. Backup coverage: % of critical resources with backup edges
  const backedUp = criticalNodes.filter((n) =>
    edges.some((e) => e.sourceId === n.id && BACKUP_EDGES.has(e.relationshipType)),
  ).length;
  const backupScore = (backedUp / criticalNodes.length) * 100;

  // 2. Replication breadth: % of critical resources with replication edges
  const replicated = criticalNodes.filter((n) =>
    edges.some((e) => e.sourceId === n.id && REPLICATION_EDGES.has(e.relationshipType)),
  ).length;
  const replicationScore = (replicated / criticalNodes.length) * 100;

  // 3. SPOF count: penalize single points of failure (unprotected critical resources)
  const spofScore = Math.max(0, 100 - (unprotected.length / criticalNodes.length) * 100);

  // 4. Cross-region distribution: penalize single-region deployments
  const regions = new Set(nodes.map((n) => `${n.provider}:${n.region}`));
  const highRiskRegions = regionRisks.filter(
    (r) => r.riskLevel === "critical" || r.riskLevel === "high",
  ).length;
  const regionScore =
    regions.size > 1
      ? Math.max(0, 100 - (highRiskRegions / regions.size) * 100)
      : highRiskRegions > 0
        ? 20
        : 50;

  // 5. Recovery plan existence: based on whether resources have failover edges
  const withFailover = nodes.filter((n) =>
    edges.some(
      (e) =>
        e.sourceId === n.id &&
        (e.relationshipType === "fails-over-to" || REPLICATION_EDGES.has(e.relationshipType)),
    ),
  ).length;
  const planScore = nodes.length > 0 ? (withFailover / nodes.length) * 100 : 0;

  const weighted =
    backupScore * weights.backupCoverage +
    replicationScore * weights.replicationBreadth +
    spofScore * weights.spofCount +
    regionScore * weights.crossRegionDistribution +
    planScore * weights.recoveryPlanExistence;

  return Math.round(Math.min(100, Math.max(0, weighted)));
}

/**
 * Convert numeric score to letter grade.
 */
export function gradeFromScore(score: number): DRGrade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}
