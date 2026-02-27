/**
 * Infrastructure Knowledge Graph — Multi-Region Failover Mapping
 *
 * Maps infrastructure across regions to identify:
 *   - Active/standby region pairs
 *   - Cross-region replication relationships
 *   - Failover readiness scoring
 *   - Single-region dependencies (no failover path)
 *   - Recovery time/point objective (RTO/RPO) estimation
 *   - Compliance cross-referencing (availability requirements)
 */

import type {
  GraphStorage,
  GraphNode,
  GraphEdge,
  CloudProvider,
  GraphResourceType,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

/** A region with its resources and metrics. */
export type RegionProfile = {
  /** Region identifier (e.g., "us-east-1"). */
  region: string;
  /** Cloud provider. */
  provider: CloudProvider;
  /** Total resources in this region. */
  resourceCount: number;
  /** Resources by type. */
  byResourceType: Record<string, number>;
  /** Total monthly cost. */
  totalCostMonthly: number;
  /** Whether this region has compute, database, and networking. */
  isFullStack: boolean;
  /** Node IDs in this region. */
  nodeIds: string[];
};

/** A failover pair between two regions. */
export type FailoverPair = {
  /** Primary (active) region. */
  primary: RegionProfile;
  /** Secondary (standby/DR) region. */
  secondary: RegionProfile;
  /** Cross-region relationships found. */
  crossRegionEdges: GraphEdge[];
  /** Types of replication detected. */
  replicationTypes: string[];
  /** Failover readiness score (0–100). */
  readinessScore: number;
  /** Estimated RTO in minutes (based on resource types and replication). */
  estimatedRtoMinutes: number;
  /** Estimated RPO in minutes (based on replication type). */
  estimatedRpoMinutes: number;
  /** Issues found. */
  issues: FailoverIssue[];
};

/** An issue with the failover configuration. */
export type FailoverIssue = {
  severity: "critical" | "high" | "medium" | "low";
  category: "replication" | "capacity" | "networking" | "data" | "completeness";
  description: string;
  affectedResources: string[];
};

/** A resource with no failover coverage. */
export type SingleRegionDependency = {
  nodeId: string;
  nodeName: string;
  resourceType: GraphResourceType;
  region: string;
  provider: CloudProvider;
  /** Monthly cost at risk. */
  costMonthly: number;
  /** Why this is a concern. */
  reason: string;
};

/** Full failover mapping report. */
export type FailoverMap = {
  generatedAt: string;
  /** All region profiles. */
  regions: RegionProfile[];
  /** Detected failover pairs. */
  failoverPairs: FailoverPair[];
  /** Resources with no failover coverage. */
  singleRegionDependencies: SingleRegionDependency[];
  /** Overall failover readiness score (0–100). */
  overallReadiness: number;
  /** Summary metrics. */
  summary: FailoverMapSummary;
};

/** Summary metrics for the failover map. */
export type FailoverMapSummary = {
  totalRegions: number;
  totalFailoverPairs: number;
  coveredResources: number;
  uncoveredResources: number;
  totalCostAtRisk: number;
  averageReadiness: number;
  worstRtoMinutes: number;
  worstRpoMinutes: number;
};

// =============================================================================
// Region Profiling
// =============================================================================

/** Critical resource types that form a "full stack". */
const FULL_STACK_TYPES: GraphResourceType[] = ["compute", "database", "network", "vpc", "load-balancer"];

/** Resource types that need failover coverage. */
const CRITICAL_TYPES: GraphResourceType[] = [
  "compute", "database", "cache", "storage", "load-balancer",
  "cluster", "queue", "function", "api-gateway",
];

/**
 * Build profiles for each region in the graph.
 */
export async function buildRegionProfiles(
  storage: GraphStorage,
): Promise<RegionProfile[]> {
  const allNodes = await storage.queryNodes({});
  const regionMap = new Map<string, { provider: CloudProvider; nodes: GraphNode[] }>();

  for (const node of allNodes) {
    if (node.metadata.isAgent === true) continue;
    const key = `${node.provider}:${node.region}`;
    const entry = regionMap.get(key) ?? { provider: node.provider, nodes: [] };
    entry.nodes.push(node);
    regionMap.set(key, entry);
  }

  const profiles: RegionProfile[] = [];
  for (const [_key, { provider, nodes }] of regionMap) {
    const byResourceType: Record<string, number> = {};
    let totalCost = 0;

    for (const n of nodes) {
      byResourceType[n.resourceType] = (byResourceType[n.resourceType] ?? 0) + 1;
      totalCost += n.costMonthly ?? 0;
    }

    const hasTypes = new Set(nodes.map((n) => n.resourceType));
    const isFullStack = FULL_STACK_TYPES.filter((t) => hasTypes.has(t)).length >= 3;

    profiles.push({
      region: nodes[0]!.region,
      provider,
      resourceCount: nodes.length,
      byResourceType,
      totalCostMonthly: Math.round(totalCost * 100) / 100,
      isFullStack,
      nodeIds: nodes.map((n) => n.id),
    });
  }

  return profiles.sort((a, b) => b.resourceCount - a.resourceCount);
}

// =============================================================================
// Cross-Region Relationship Detection
// =============================================================================

/** Relationship types that indicate cross-region replication/failover. */
const REPLICATION_EDGE_TYPES = new Set([
  "replicates-to", "replicates", "peers-with", "backs-up",
  "backed-by", "routes-to", "connected-to",
]);

/**
 * Find cross-region edges between two regions.
 */
async function findCrossRegionEdges(
  storage: GraphStorage,
  region1NodeIds: Set<string>,
  region2NodeIds: Set<string>,
): Promise<GraphEdge[]> {
  const crossEdges: GraphEdge[] = [];
  const seen = new Set<string>();

  // Check edges from region1 nodes → region2 nodes
  for (const nodeId of region1NodeIds) {
    const edges = await storage.getEdgesForNode(nodeId, "both");
    for (const edge of edges) {
      if (seen.has(edge.id)) continue;
      seen.add(edge.id);

      const otherEnd = edge.sourceNodeId === nodeId ? edge.targetNodeId : edge.sourceNodeId;
      if (region2NodeIds.has(otherEnd)) {
        crossEdges.push(edge);
      }
    }
  }

  return crossEdges;
}

// =============================================================================
// Failover Analysis
// =============================================================================

/**
 * Compute failover readiness score for a region pair.
 */
function computeReadinessScore(
  primary: RegionProfile,
  secondary: RegionProfile,
  crossEdges: GraphEdge[],
): { score: number; issues: FailoverIssue[] } {
  const issues: FailoverIssue[] = [];
  let score = 100;

  // Check capacity parity
  const capacityRatio = primary.resourceCount > 0
    ? secondary.resourceCount / primary.resourceCount
    : 0;

  if (capacityRatio < 0.5) {
    score -= 30;
    issues.push({
      severity: "high",
      category: "capacity",
      description: `Secondary region has only ${Math.round(capacityRatio * 100)}% of primary's resources`,
      affectedResources: [],
    });
  } else if (capacityRatio < 0.8) {
    score -= 15;
    issues.push({
      severity: "medium",
      category: "capacity",
      description: `Secondary region has ${Math.round(capacityRatio * 100)}% of primary's resources`,
      affectedResources: [],
    });
  }

  // Check resource type coverage
  for (const type of CRITICAL_TYPES) {
    const primaryCount = primary.byResourceType[type] ?? 0;
    const secondaryCount = secondary.byResourceType[type] ?? 0;

    if (primaryCount > 0 && secondaryCount === 0) {
      score -= 15;
      issues.push({
        severity: "critical",
        category: "completeness",
        description: `${type} exists in primary (${primaryCount}) but not in secondary`,
        affectedResources: [],
      });
    }
  }

  // Check replication relationships
  const replicationEdges = crossEdges.filter((e) =>
    REPLICATION_EDGE_TYPES.has(e.relationshipType),
  );

  if (replicationEdges.length === 0) {
    score -= 25;
    issues.push({
      severity: "critical",
      category: "replication",
      description: "No cross-region replication relationships detected",
      affectedResources: [],
    });
  }

  // Check full stack readiness
  if (primary.isFullStack && !secondary.isFullStack) {
    score -= 20;
    issues.push({
      severity: "high",
      category: "completeness",
      description: "Secondary region is not a full stack (missing compute/database/network)",
      affectedResources: [],
    });
  }

  return { score: Math.max(0, score), issues };
}

/**
 * Estimate RTO based on resource types and replication status.
 */
function estimateRto(
  crossEdges: GraphEdge[],
  secondary: RegionProfile,
): number {
  const hasReplication = crossEdges.some((e) =>
    REPLICATION_EDGE_TYPES.has(e.relationshipType),
  );
  const hasCompute = (secondary.byResourceType["compute"] ?? 0) > 0;
  const hasDatabase = (secondary.byResourceType["database"] ?? 0) > 0;

  // Active-active (replication + full stack) → minutes
  if (hasReplication && hasCompute && hasDatabase) return 5;
  // Warm standby (has resources, has replication)
  if (hasReplication) return 30;
  // Pilot light (has some resources, no replication)
  if (hasCompute) return 120;
  // Cold standby (needs provisioning)
  return 480;
}

/**
 * Estimate RPO based on replication type.
 */
function estimateRpo(crossEdges: GraphEdge[]): number {
  const hassynchReplication = crossEdges.some(
    (e) => e.metadata.replicationType === "synchronous" || e.metadata.sync === true,
  );
  const hasReplication = crossEdges.some((e) =>
    REPLICATION_EDGE_TYPES.has(e.relationshipType),
  );

  if (hassynchReplication) return 0;
  if (hasReplication) return 15;
  return 1440; // 24 hours — no replication
}

// =============================================================================
// Main Analysis
// =============================================================================

/**
 * Generate a complete failover mapping for the infrastructure.
 */
export async function generateFailoverMap(
  storage: GraphStorage,
): Promise<FailoverMap> {
  const regions = await buildRegionProfiles(storage);
  const failoverPairs: FailoverPair[] = [];

  // Find failover pairs (regions from same provider with cross-region edges)
  const providerRegions = new Map<string, RegionProfile[]>();
  for (const region of regions) {
    const list = providerRegions.get(region.provider) ?? [];
    list.push(region);
    providerRegions.set(region.provider, list);
  }

  for (const [_provider, provRegions] of providerRegions) {
    if (provRegions.length < 2) continue;

    // Check each pair
    for (let i = 0; i < provRegions.length; i++) {
      for (let j = i + 1; j < provRegions.length; j++) {
        const r1 = provRegions[i]!;
        const r2 = provRegions[j]!;

        const r1Ids = new Set(r1.nodeIds);
        const r2Ids = new Set(r2.nodeIds);

        const crossEdges = await findCrossRegionEdges(storage, r1Ids, r2Ids);

        // Only create pair if there's some relationship or both are full stacks
        if (crossEdges.length === 0 && !r1.isFullStack && !r2.isFullStack) continue;

        // Determine primary/secondary by resource count (larger = primary)
        const [primary, secondary] = r1.resourceCount >= r2.resourceCount
          ? [r1, r2] : [r2, r1];

        const { score, issues } = computeReadinessScore(primary, secondary, crossEdges);
        const replicationTypes = [...new Set(
          crossEdges
            .filter((e) => REPLICATION_EDGE_TYPES.has(e.relationshipType))
            .map((e) => e.relationshipType),
        )];

        failoverPairs.push({
          primary,
          secondary,
          crossRegionEdges: crossEdges,
          replicationTypes,
          readinessScore: score,
          estimatedRtoMinutes: estimateRto(crossEdges, secondary),
          estimatedRpoMinutes: estimateRpo(crossEdges),
          issues,
        });
      }
    }
  }

  // Find single-region dependencies
  const coveredNodeIds = new Set<string>();
  for (const pair of failoverPairs) {
    for (const id of pair.primary.nodeIds) coveredNodeIds.add(id);
    for (const id of pair.secondary.nodeIds) coveredNodeIds.add(id);
  }

  const allNodes = await storage.queryNodes({});
  const singleRegionDependencies: SingleRegionDependency[] = [];

  for (const node of allNodes) {
    if (node.metadata.isAgent === true) continue;
    if (coveredNodeIds.has(node.id)) continue;
    if (!CRITICAL_TYPES.includes(node.resourceType)) continue;

    singleRegionDependencies.push({
      nodeId: node.id,
      nodeName: node.name,
      resourceType: node.resourceType,
      region: node.region,
      provider: node.provider,
      costMonthly: node.costMonthly ?? 0,
      reason: `${node.resourceType} in ${node.region} has no failover region pair`,
    });
  }

  // Compute summary
  const totalCostAtRisk = singleRegionDependencies.reduce((s, d) => s + d.costMonthly, 0);
  const readinessScores = failoverPairs.map((p) => p.readinessScore);
  const avgReadiness = readinessScores.length > 0
    ? readinessScores.reduce((a, b) => a + b, 0) / readinessScores.length
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    regions,
    failoverPairs,
    singleRegionDependencies,
    overallReadiness: Math.round(avgReadiness),
    summary: {
      totalRegions: regions.length,
      totalFailoverPairs: failoverPairs.length,
      coveredResources: coveredNodeIds.size,
      uncoveredResources: singleRegionDependencies.length,
      totalCostAtRisk: Math.round(totalCostAtRisk * 100) / 100,
      averageReadiness: Math.round(avgReadiness * 10) / 10,
      worstRtoMinutes: failoverPairs.length > 0
        ? Math.max(...failoverPairs.map((p) => p.estimatedRtoMinutes))
        : 0,
      worstRpoMinutes: failoverPairs.length > 0
        ? Math.max(...failoverPairs.map((p) => p.estimatedRpoMinutes))
        : 0,
    },
  };
}

/**
 * Format a failover map as markdown.
 */
export function formatFailoverMapMarkdown(map: FailoverMap): string {
  const lines: string[] = [
    "# Multi-Region Failover Map",
    "",
    `Generated: ${map.generatedAt}`,
    `Overall readiness: ${map.overallReadiness}%`,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Regions | ${map.summary.totalRegions} |`,
    `| Failover Pairs | ${map.summary.totalFailoverPairs} |`,
    `| Covered Resources | ${map.summary.coveredResources} |`,
    `| Uncovered Resources | ${map.summary.uncoveredResources} |`,
    `| Cost at Risk | $${map.summary.totalCostAtRisk.toFixed(2)} |`,
    `| Worst RTO | ${map.summary.worstRtoMinutes} min |`,
    `| Worst RPO | ${map.summary.worstRpoMinutes} min |`,
    "",
  ];

  if (map.failoverPairs.length > 0) {
    lines.push(
      "## Failover Pairs",
      "",
      "| Primary | Secondary | Readiness | RTO | RPO | Issues |",
      "|---------|-----------|-----------|-----|-----|--------|",
      ...map.failoverPairs.map(
        (p) => `| ${p.primary.region} | ${p.secondary.region} | ${p.readinessScore}% | ${p.estimatedRtoMinutes}m | ${p.estimatedRpoMinutes}m | ${p.issues.length} |`,
      ),
      "",
    );
  }

  if (map.singleRegionDependencies.length > 0) {
    lines.push(
      "## Single-Region Dependencies",
      "",
      "| Resource | Type | Region | Monthly Cost |",
      "|----------|------|--------|-------------|",
      ...map.singleRegionDependencies
        .sort((a, b) => b.costMonthly - a.costMonthly)
        .slice(0, 20)
        .map((d) => `| ${d.nodeName} | ${d.resourceType} | ${d.region} | $${d.costMonthly.toFixed(2)} |`),
      "",
    );
  }

  return lines.join("\n");
}
