/**
 * DR posture analyzer — scans graph topology for DR weaknesses.
 */

import type {
  DRNode,
  DREdge,
  DRAnalysis,
  DRRecommendation,
  SingleRegionRisk,
  RecoveryRequirement,
  RecoveryPlan,
  RecoveryStep,
  FailureScenario,
  RiskLevel,
  BackupStrategy,
  ReplicationStatus,
} from "./types.js";
import { scorePosture, gradeFromScore } from "./scoring.js";

/** Critical resource types that need DR protection. */
const CRITICAL_TYPES = new Set([
  "database",
  "storage",
  "queue",
  "stream",
  "cache",
  "cluster",
  "compute",
]);

/** DR-relevant edge types. */
const BACKUP_EDGES = new Set(["backs-up", "backed-by"]);
const REPLICATION_EDGES = new Set(["replicates-to", "replicates"]);
const FAILOVER_EDGES = new Set(["fails-over-to"]);

/**
 * Analyze overall DR posture from graph nodes and edges.
 */
export function analyzePosture(nodes: DRNode[], edges: DREdge[]): DRAnalysis {
  const singleRegionRisks = findSingleRegionRisks(nodes, edges);
  const unprotected = findUnprotectedCritical(nodes, edges);
  const rtoEstimates = estimateRecoveryTimes(nodes, edges);
  const recommendations = generateRecommendations(nodes, edges, singleRegionRisks, unprotected);
  const score = scorePosture(nodes, edges, singleRegionRisks, unprotected);
  const grade = gradeFromScore(score);

  return {
    overallScore: score,
    grade,
    singleRegionRisks,
    unprotectedCriticalResources: unprotected,
    recoveryTimeEstimates: rtoEstimates,
    recommendations,
  };
}

/**
 * Find regions with critical resources that lack cross-region failover.
 */
export function findSingleRegionRisks(nodes: DRNode[], edges: DREdge[]): SingleRegionRisk[] {
  // Group nodes by provider:region
  const byRegion = new Map<string, DRNode[]>();
  for (const n of nodes) {
    const key = `${n.provider}:${n.region}`;
    const list = byRegion.get(key) ?? [];
    list.push(n);
    byRegion.set(key, list);
  }

  const risks: SingleRegionRisk[] = [];
  for (const [key, regionNodes] of byRegion) {
    const [provider, region] = key.split(":") as [string, string];
    const criticalCount = regionNodes.filter((n) => CRITICAL_TYPES.has(n.resourceType)).length;
    const hasFailover = regionNodes.some((n) =>
      edges.some(
        (e) =>
          e.sourceId === n.id &&
          (FAILOVER_EDGES.has(e.relationshipType) || REPLICATION_EDGES.has(e.relationshipType)),
      ),
    );

    const riskLevel = computeRegionRisk(criticalCount, regionNodes.length, hasFailover);

    risks.push({
      region,
      provider: provider as DRNode["provider"],
      criticalResources: criticalCount,
      totalResources: regionNodes.length,
      hasFailover,
      riskLevel,
    });
  }

  return risks.sort((a, b) => riskOrder(a.riskLevel) - riskOrder(b.riskLevel));
}

function computeRegionRisk(
  criticalCount: number,
  _totalCount: number,
  hasFailover: boolean,
): RiskLevel {
  if (criticalCount > 0 && !hasFailover) return "critical";
  if (criticalCount > 0 && hasFailover) return "medium";
  if (!hasFailover) return "high";
  return "low";
}

function riskOrder(level: RiskLevel): number {
  const order: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return order[level];
}

/**
 * Find critical resources without backup or replication edges.
 */
export function findUnprotectedCritical(nodes: DRNode[], edges: DREdge[]): DRNode[] {
  return nodes.filter((n) => {
    if (!CRITICAL_TYPES.has(n.resourceType)) return false;
    const hasBackup = edges.some(
      (e) => e.sourceId === n.id && BACKUP_EDGES.has(e.relationshipType),
    );
    const hasReplication = edges.some(
      (e) => e.sourceId === n.id && REPLICATION_EDGES.has(e.relationshipType),
    );
    return !hasBackup && !hasReplication;
  });
}

/**
 * Determine recovery requirements for a node.
 */
export function getRecoveryRequirement(
  node: DRNode,
  edges: DREdge[],
): RecoveryRequirement {
  const nodeEdges = edges.filter((e) => e.sourceId === node.id);
  const hasBackup = nodeEdges.some((e) => BACKUP_EDGES.has(e.relationshipType));
  const hasReplication = nodeEdges.some((e) => REPLICATION_EDGES.has(e.relationshipType));
  const hasFailover = nodeEdges.some((e) => FAILOVER_EDGES.has(e.relationshipType));

  let backupStrategy: BackupStrategy = "none";
  if (hasReplication && hasBackup) backupStrategy = "multi-region";
  else if (hasReplication) backupStrategy = "replication";
  else if (hasBackup) backupStrategy = "snapshot";

  let replicationStatus: ReplicationStatus = "none";
  if (hasReplication) {
    replicationStatus = hasFailover ? "sync" : "async";
  }

  // Estimate RTO/RPO based on resource type and protection level
  const rto = estimateRTO(node.resourceType, backupStrategy);
  const rpo = estimateRPO(node.resourceType, replicationStatus);

  return {
    nodeId: node.id,
    rpo,
    rto,
    backupStrategy,
    replicationStatus,
    failoverCapable: hasFailover,
  };
}

/**
 * Estimate RTO in minutes for a resource type with a given backup strategy.
 */
export function estimateRTO(resourceType: string, strategy: BackupStrategy): number {
  const baseRTO: Record<string, number> = {
    database: 60,
    storage: 30,
    compute: 15,
    cache: 10,
    queue: 20,
    cluster: 45,
    stream: 15,
  };
  const base = baseRTO[resourceType] ?? 30;

  const multipliers: Record<BackupStrategy, number> = {
    "multi-region": 0.2,
    replication: 0.5,
    snapshot: 1.0,
    none: 3.0,
  };
  return Math.round(base * multipliers[strategy]);
}

/**
 * Estimate RPO in minutes.
 */
export function estimateRPO(_resourceType: string, replication: ReplicationStatus): number {
  const rpoMap: Record<ReplicationStatus, number> = {
    "active-active": 0,
    sync: 1,
    async: 15,
    none: 1440, // 24 hours
  };
  return rpoMap[replication];
}

/**
 * Estimate recovery times for all nodes.
 */
export function estimateRecoveryTimes(
  nodes: DRNode[],
  edges: DREdge[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const n of nodes) {
    const req = getRecoveryRequirement(n, edges);
    result[n.id] = req.rto ?? 30;
  }
  return result;
}

/**
 * Generate a recovery plan for a failure scenario.
 */
export function generateRecoveryPlan(
  scenario: FailureScenario,
  nodes: DRNode[],
  edges: DREdge[],
  targetRegion?: string,
): RecoveryPlan {
  // Determine affected resources
  const affected = getAffectedResources(scenario, nodes, targetRegion);

  // Build dependency order (BFS topological sort)
  const steps = buildRecoverySteps(affected, edges);
  const totalRTO = steps.reduce((sum, s) => Math.max(sum, s.estimatedDuration), 0);
  const totalRPO = Math.max(
    ...affected.map((n) => {
      const req = getRecoveryRequirement(n, edges);
      return req.rpo ?? 1440;
    }),
    0,
  );

  // Group steps by dependency level
  const depGroups = groupByDependencyLevel(steps);

  return {
    scenario,
    affectedResources: affected,
    recoverySteps: steps,
    estimatedRTO: totalRTO,
    estimatedRPO: totalRPO,
    dependencies: depGroups,
  };
}

function getAffectedResources(
  scenario: FailureScenario,
  nodes: DRNode[],
  targetRegion?: string,
): DRNode[] {
  switch (scenario) {
    case "region-failure":
      return targetRegion
        ? nodes.filter((n) => n.region === targetRegion)
        : nodes;
    case "az-failure":
      // Approximate: 1/3 of resources in a region
      if (targetRegion) {
        const regional = nodes.filter((n) => n.region === targetRegion);
        return regional.slice(0, Math.ceil(regional.length / 3));
      }
      return nodes.slice(0, Math.ceil(nodes.length / 3));
    case "service-outage":
      return nodes.filter((n) => CRITICAL_TYPES.has(n.resourceType));
    case "data-corruption":
      return nodes.filter(
        (n) => n.resourceType === "database" || n.resourceType === "storage",
      );
  }
}

function buildRecoverySteps(affected: DRNode[], edges: DREdge[]): RecoveryStep[] {
  const steps: RecoveryStep[] = [];
  const affectedIds = new Set(affected.map((n) => n.id));

  // Order: databases first, then compute, then networking
  const priority: Record<string, number> = {
    database: 1,
    storage: 2,
    cache: 3,
    queue: 4,
    compute: 5,
    cluster: 6,
  };

  const sorted = [...affected].sort(
    (a, b) => (priority[a.resourceType] ?? 10) - (priority[b.resourceType] ?? 10),
  );

  for (let i = 0; i < sorted.length; i++) {
    const node = sorted[i]!;
    const deps = edges
      .filter((e) => e.targetId === node.id && affectedIds.has(e.sourceId))
      .map((e) => sorted.findIndex((n) => n.id === e.sourceId))
      .filter((idx) => idx >= 0 && idx < i);

    steps.push({
      order: i + 1,
      action: getRecoveryAction(node.resourceType),
      resourceId: node.id,
      resourceName: node.name,
      estimatedDuration: estimateRTO(node.resourceType, "snapshot"),
      dependsOn: deps.map((d) => d + 1),
      manual: node.resourceType === "cluster",
    });
  }

  return steps;
}

function getRecoveryAction(resourceType: string): string {
  const actions: Record<string, string> = {
    database: "Restore database from backup/replica",
    storage: "Restore storage from backup",
    compute: "Launch replacement instances",
    cache: "Rebuild cache cluster",
    queue: "Recreate message queue",
    cluster: "Rebuild container cluster",
    stream: "Recreate data stream",
  };
  return actions[resourceType] ?? "Restore resource";
}

function groupByDependencyLevel(steps: RecoveryStep[]): string[][] {
  const groups: string[][] = [];
  const placed = new Set<number>();

  while (placed.size < steps.length) {
    const level: string[] = [];
    for (const step of steps) {
      if (placed.has(step.order)) continue;
      if (step.dependsOn.every((d) => placed.has(d))) {
        level.push(step.resourceId);
        placed.add(step.order);
      }
    }
    if (level.length === 0) break; // prevent infinite loop on cycles
    groups.push(level);
  }

  return groups;
}

/**
 * Generate DR recommendations based on analysis.
 */
export function generateRecommendations(
  nodes: DRNode[],
  edges: DREdge[],
  regionRisks: SingleRegionRisk[],
  unprotected: DRNode[],
): DRRecommendation[] {
  const recs: DRRecommendation[] = [];

  // Unprotected critical resources
  for (const node of unprotected) {
    recs.push({
      severity: "critical",
      category: "backup",
      description: `${node.name} (${node.resourceType}) has no backup or replication configured`,
      affectedResources: [node.id],
      estimatedCost: 50,
      effort: "medium",
    });
  }

  // High-risk single-region deployments
  for (const risk of regionRisks) {
    if (risk.riskLevel === "critical") {
      recs.push({
        severity: "critical",
        category: "failover",
        description: `Region ${risk.region} has ${risk.criticalResources} critical resources with no failover`,
        affectedResources: [],
        estimatedCost: 200,
        effort: "high",
      });
    }
  }

  // Resources without monitoring
  const monitored = new Set(
    edges.filter((e) => e.relationshipType === "monitors" || e.relationshipType === "monitored-by")
      .flatMap((e) => [e.sourceId, e.targetId]),
  );
  const unmonitored = nodes.filter(
    (n) => CRITICAL_TYPES.has(n.resourceType) && !monitored.has(n.id),
  );
  if (unmonitored.length > 0) {
    recs.push({
      severity: "high",
      category: "monitoring",
      description: `${unmonitored.length} critical resources lack monitoring`,
      affectedResources: unmonitored.map((n) => n.id),
      estimatedCost: 20,
      effort: "low",
    });
  }

  return recs.sort((a, b) => riskOrder(a.severity) - riskOrder(b.severity));
}
