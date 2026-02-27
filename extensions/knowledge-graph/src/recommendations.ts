/**
 * Infrastructure Knowledge Graph — Resource Recommendation Engine (P2.18)
 *
 * Analyzes the infrastructure graph to generate actionable optimization
 * recommendations: right-sizing, unused resource cleanup, cost optimization,
 * security hardening, and reliability improvements.
 */

import type {
  GraphStorage,
  GraphNode,
  GraphResourceType,
  CloudProvider,
  NodeFilter,
} from "./types.js";
import type { GraphEngine } from "./engine.js";
import {
  findOrphans,
  findSinglePointsOfFailure,
  findCriticalNodes,
} from "./queries.js";

// =============================================================================
// Types
// =============================================================================

/** Category of recommendation. */
export type RecommendationCategory =
  | "cost-optimization"
  | "right-sizing"
  | "unused-resource"
  | "security"
  | "reliability"
  | "tagging"
  | "architecture";

/** Priority of a recommendation. */
export type RecommendationPriority = "critical" | "high" | "medium" | "low";

/** A single actionable recommendation. */
export type Recommendation = {
  /** Unique recommendation ID. */
  id: string;
  /** Category. */
  category: RecommendationCategory;
  /** Priority. */
  priority: RecommendationPriority;
  /** Short title. */
  title: string;
  /** Detailed explanation. */
  description: string;
  /** Affected resource IDs. */
  affectedNodeIds: string[];
  /** Affected resource names (for display). */
  affectedResources: string[];
  /** Estimated monthly cost savings (negative = cost). */
  estimatedSavingsMonthly: number;
  /** Suggested action to take. */
  suggestedAction: string;
  /** Effort to implement. */
  effort: "trivial" | "small" | "medium" | "large";
  /** Provider (if provider-specific). */
  provider?: CloudProvider;
};

/** Full recommendation report. */
export type RecommendationReport = {
  generatedAt: string;
  totalRecommendations: number;
  totalEstimatedSavings: number;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  recommendations: Recommendation[];
};

// =============================================================================
// Recommendation Generators
// =============================================================================

let recCounter = 0;
function recId(): string {
  return `rec-${Date.now()}-${++recCounter}`;
}

/** Reset the counter (for testing). */
export function resetRecommendationCounter(): void {
  recCounter = 0;
}

/**
 * Detect orphaned resources that can be deleted.
 */
async function detectUnusedResources(
  storage: GraphStorage,
  _filter?: NodeFilter,
): Promise<Recommendation[]> {
  const orphans = await findOrphans(storage);
  const recs: Recommendation[] = [];

  // Group orphans by resource type
  const byType = new Map<GraphResourceType, GraphNode[]>();
  for (const node of orphans) {
    const list = byType.get(node.resourceType) ?? [];
    list.push(node);
    byType.set(node.resourceType, list);
  }

  for (const [resourceType, nodes] of byType) {
    const totalCost = nodes.reduce(
      (sum, n) => sum + (n.costMonthly ?? 0),
      0,
    );
    if (nodes.length === 0) continue;

    recs.push({
      id: recId(),
      category: "unused-resource",
      priority: totalCost > 100 ? "high" : totalCost > 10 ? "medium" : "low",
      title: `${nodes.length} orphaned ${resourceType} resource(s)`,
      description: `Found ${nodes.length} ${resourceType} resources with no relationships to other infrastructure. These may be unused and safe to delete.`,
      affectedNodeIds: nodes.map((n) => n.id),
      affectedResources: nodes.map((n) => n.name),
      estimatedSavingsMonthly: totalCost,
      suggestedAction: `Review and delete orphaned ${resourceType} resources`,
      effort: nodes.length > 5 ? "medium" : "trivial",
    });
  }

  return recs;
}

/**
 * Detect costly stopped/idle resources.
 */
async function detectIdleResources(
  storage: GraphStorage,
  _filter?: NodeFilter,
): Promise<Recommendation[]> {
  const stopped = await storage.queryNodes({ status: "stopped" });
  const recs: Recommendation[] = [];

  const costlyIdlers = stopped.filter(
    (n) => n.costMonthly != null && n.costMonthly > 0,
  );

  if (costlyIdlers.length > 0) {
    const totalCost = costlyIdlers.reduce(
      (sum, n) => sum + (n.costMonthly ?? 0),
      0,
    );
    recs.push({
      id: recId(),
      category: "cost-optimization",
      priority: totalCost > 200 ? "high" : "medium",
      title: `${costlyIdlers.length} stopped resource(s) still incurring cost`,
      description: `Found ${costlyIdlers.length} resources in "stopped" state that are still generating charges ($${totalCost.toFixed(2)}/mo). Consider terminating or snapshotting and deleting.`,
      affectedNodeIds: costlyIdlers.map((n) => n.id),
      affectedResources: costlyIdlers.map(
        (n) => `${n.name} ($${(n.costMonthly ?? 0).toFixed(2)}/mo)`,
      ),
      estimatedSavingsMonthly: totalCost,
      suggestedAction:
        "Snapshot critical data, then terminate stopped resources",
      effort: "small",
    });
  }

  return recs;
}

/**
 * Detect resources without required tags.
 */
async function detectUntaggedResources(
  storage: GraphStorage,
  filter?: NodeFilter,
): Promise<Recommendation[]> {
  const allNodes = await storage.queryNodes(filter ?? {});
  const requiredTags = ["Environment", "Owner"];
  const recs: Recommendation[] = [];

  const untagged = allNodes.filter(
    (n) =>
      !requiredTags.every(
        (t) => n.tags[t] != null && n.tags[t]!.trim() !== "",
      ),
  );

  if (untagged.length > 0) {
    recs.push({
      id: recId(),
      category: "tagging",
      priority:
        untagged.length > allNodes.length * 0.3 ? "high" : "medium",
      title: `${untagged.length} resource(s) missing required tags`,
      description: `Found ${untagged.length} out of ${allNodes.length} resources missing one or more of: ${requiredTags.join(", ")}. Proper tagging enables cost allocation and access control.`,
      affectedNodeIds: untagged.map((n) => n.id),
      affectedResources: untagged.slice(0, 20).map((n) => n.name),
      estimatedSavingsMonthly: 0,
      suggestedAction: `Apply ${requiredTags.join(", ")} tags to all resources`,
      effort: untagged.length > 20 ? "medium" : "small",
    });
  }

  return recs;
}

/**
 * Detect single points of failure that need redundancy.
 */
async function detectReliabilityIssues(
  storage: GraphStorage,
  engine: GraphEngine,
): Promise<Recommendation[]> {
  const spofs = await findSinglePointsOfFailure(storage);
  const recs: Recommendation[] = [];

  for (const spof of spofs) {
    const blastRadius = await engine.getBlastRadius(spof.id, 2);
    const impactedCount = blastRadius.nodes.size - 1;
    const costAtRisk = blastRadius.totalCostMonthly;

    if (impactedCount > 2 || costAtRisk > 100) {
      recs.push({
        id: recId(),
        category: "reliability",
        priority: impactedCount > 10 ? "critical" : "high",
        title: `SPOF: ${spof.name} impacts ${impactedCount} resources`,
        description: `${spof.name} (${spof.resourceType}) is a single point of failure. If it goes down, ${impactedCount} resources ($${costAtRisk.toFixed(2)}/mo) are affected.`,
        affectedNodeIds: [spof.id],
        affectedResources: [spof.name],
        estimatedSavingsMonthly: 0,
        suggestedAction: `Add redundancy for ${spof.resourceType}: multi-AZ deployment, load balancer, or replica`,
        effort: "large",
        provider: spof.provider,
      });
    }
  }

  return recs;
}

/**
 * Detect resources without encryption.
 */
async function detectSecurityIssues(
  storage: GraphStorage,
  filter?: NodeFilter,
): Promise<Recommendation[]> {
  const dataTypes: GraphResourceType[] = [
    "storage",
    "database",
    "cache",
    "queue",
    "stream",
  ];
  const recs: Recommendation[] = [];

  for (const rt of dataTypes) {
    const nodes = await storage.queryNodes({ resourceType: rt, ...(filter ?? {}) });
    const unencrypted = nodes.filter((n) => {
      const m = n.metadata;
      return (
        m.encrypted !== true &&
        m.encryptionEnabled !== true &&
        m.storageEncrypted !== true &&
        m.kmsKeyId == null &&
        m.sseAlgorithm == null
      );
    });

    if (unencrypted.length > 0) {
      recs.push({
        id: recId(),
        category: "security",
        priority: "high",
        title: `${unencrypted.length} ${rt} resource(s) without encryption`,
        description: `Found ${unencrypted.length} ${rt} resources without encryption at rest. This may violate compliance requirements (SOC2, HIPAA, PCI-DSS).`,
        affectedNodeIds: unencrypted.map((n) => n.id),
        affectedResources: unencrypted.map((n) => n.name),
        estimatedSavingsMonthly: 0,
        suggestedAction: `Enable encryption at rest for all ${rt} resources`,
        effort: "small",
      });
    }
  }

  return recs;
}

/**
 * Detect oversized resources based on cost thresholds.
 */
async function detectRightSizingOpportunities(
  storage: GraphStorage,
  filter?: NodeFilter,
): Promise<Recommendation[]> {
  const allNodes = await storage.queryNodes(filter ?? {});
  const recs: Recommendation[] = [];

  // Find resources that cost significantly more than average for their type
  const costByType = new Map<GraphResourceType, number[]>();
  for (const n of allNodes) {
    if (n.costMonthly != null && n.costMonthly > 0) {
      const list = costByType.get(n.resourceType) ?? [];
      list.push(n.costMonthly);
      costByType.set(n.resourceType, list);
    }
  }

  for (const [resourceType, costs] of costByType) {
    if (costs.length < 3) continue;
    const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
    const threshold = avg * 3; // 3x average = potential oversized

    const oversized = allNodes.filter(
      (n) =>
        n.resourceType === resourceType &&
        n.costMonthly != null &&
        n.costMonthly > threshold,
    );

    if (oversized.length > 0) {
      const potentialSavings = oversized.reduce(
        (sum, n) => sum + ((n.costMonthly ?? 0) - avg),
        0,
      );
      recs.push({
        id: recId(),
        category: "right-sizing",
        priority: potentialSavings > 500 ? "high" : "medium",
        title: `${oversized.length} potentially oversized ${resourceType} resource(s)`,
        description: `${oversized.length} ${resourceType} resources cost >3x the average ($${avg.toFixed(2)}/mo). Review if they can be downsized.`,
        affectedNodeIds: oversized.map((n) => n.id),
        affectedResources: oversized.map(
          (n) => `${n.name} ($${(n.costMonthly ?? 0).toFixed(2)}/mo)`,
        ),
        estimatedSavingsMonthly: potentialSavings * 0.3, // conservative 30%
        suggestedAction: `Review instance types and usage metrics for high-cost ${resourceType} resources`,
        effort: "medium",
      });
    }
  }

  return recs;
}

/**
 * Detect architectural issues (over-connected critical nodes).
 */
async function detectArchitectureIssues(
  storage: GraphStorage,
): Promise<Recommendation[]> {
  const critical = await findCriticalNodes(storage, undefined, 10);
  const recs: Recommendation[] = [];

  // Nodes with very high degree centrality may be architectural bottlenecks
  const bottlenecks = critical.filter((c) => c.degree > 15);
  if (bottlenecks.length > 0) {
    recs.push({
      id: recId(),
      category: "architecture",
      priority: "medium",
      title: `${bottlenecks.length} potential architectural bottleneck(s)`,
      description: `Found ${bottlenecks.length} resources with >15 connections, which may be architectural bottlenecks. Consider decomposing or adding intermediary services.`,
      affectedNodeIds: bottlenecks.map((c) => c.node.id),
      affectedResources: bottlenecks.map(
        (c) => `${c.node.name} (${c.degree} connections)`,
      ),
      estimatedSavingsMonthly: 0,
      suggestedAction:
        "Review high-degree resources and consider breaking dependencies",
      effort: "large",
    });
  }

  return recs;
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Analyze the infrastructure graph and generate recommendations.
 */
export async function generateRecommendations(
  engine: GraphEngine,
  storage: GraphStorage,
  _filter?: NodeFilter,
): Promise<RecommendationReport> {
  resetRecommendationCounter();

  const allRecs = await Promise.all([
    detectUnusedResources(storage, _filter),
    detectIdleResources(storage, _filter),
    detectUntaggedResources(storage, _filter),
    detectReliabilityIssues(storage, engine),
    detectSecurityIssues(storage, _filter),
    detectRightSizingOpportunities(storage, _filter),
    detectArchitectureIssues(storage),
  ]);

  const recommendations = allRecs.flat().sort((a, b) => {
    const priority: Record<RecommendationPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    const diff = priority[a.priority] - priority[b.priority];
    if (diff !== 0) return diff;
    return b.estimatedSavingsMonthly - a.estimatedSavingsMonthly;
  });

  const byCategory: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let totalSavings = 0;

  for (const rec of recommendations) {
    byCategory[rec.category] = (byCategory[rec.category] ?? 0) + 1;
    byPriority[rec.priority] = (byPriority[rec.priority] ?? 0) + 1;
    totalSavings += rec.estimatedSavingsMonthly;
  }

  return {
    generatedAt: new Date().toISOString(),
    totalRecommendations: recommendations.length,
    totalEstimatedSavings: Math.round(totalSavings * 100) / 100,
    byCategory,
    byPriority,
    recommendations,
  };
}

/**
 * Format a recommendation report as markdown.
 */
export function formatRecommendationsMarkdown(
  report: RecommendationReport,
): string {
  const lines: string[] = [
    "# Infrastructure Recommendations",
    "",
    `Generated: ${report.generatedAt}`,
    `Total recommendations: ${report.totalRecommendations}`,
    `Estimated monthly savings: $${report.totalEstimatedSavings.toFixed(2)}`,
    "",
    "## Summary by Priority",
    "",
    "| Priority | Count |",
    "|----------|-------|",
    ...Object.entries(report.byPriority).map(
      ([k, v]) => `| ${k} | ${v} |`,
    ),
    "",
    "## Summary by Category",
    "",
    "| Category | Count |",
    "|----------|-------|",
    ...Object.entries(report.byCategory).map(
      ([k, v]) => `| ${k} | ${v} |`,
    ),
    "",
    "## Recommendations",
    "",
  ];

  for (const rec of report.recommendations) {
    lines.push(
      `### [${rec.priority.toUpperCase()}] ${rec.title}`,
      "",
      `**Category:** ${rec.category}`,
      `**Effort:** ${rec.effort}`,
      rec.estimatedSavingsMonthly > 0
        ? `**Estimated savings:** $${rec.estimatedSavingsMonthly.toFixed(2)}/mo`
        : "",
      "",
      rec.description,
      "",
      `**Action:** ${rec.suggestedAction}`,
      "",
      `**Affected resources:** ${rec.affectedResources.slice(0, 10).join(", ")}${rec.affectedResources.length > 10 ? ` (+${rec.affectedResources.length - 10} more)` : ""}`,
      "",
    );
  }

  return lines.filter((l) => l !== undefined).join("\n");
}
