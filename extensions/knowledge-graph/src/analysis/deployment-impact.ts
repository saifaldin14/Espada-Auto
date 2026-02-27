/**
 * Infrastructure Knowledge Graph — Deployment Impact Analysis
 *
 * Analyzes Terraform plan output to predict the blast radius and impact
 * of infrastructure changes before they are applied. Uses the knowledge
 * graph to enrich plan data with dependency information, cost projections,
 * and risk scoring.
 *
 * Supports:
 *   - Terraform plan JSON parsing
 *   - Blast radius computation via graph traversal
 *   - Cost delta estimation
 *   - Risk scoring based on resource criticality
 *   - Compliance impact assessment
 */

import type {
  GraphStorage,
  GraphNode,
  GraphEdge,
  CloudProvider,
  GraphResourceType,
  TraversalDirection,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

/** A resource change from a Terraform plan. */
export type PlannedChange = {
  /** Terraform resource address (e.g., "aws_instance.web"). */
  address: string;
  /** Action Terraform will take. */
  action: "create" | "update" | "delete" | "replace" | "read" | "no-op";
  /** Resource type in the plan. */
  resourceType: string;
  /** Provider. */
  provider: string;
  /** Attributes before the change (null for creates). */
  before: Record<string, unknown> | null;
  /** Attributes after the change (null for deletes). */
  after: Record<string, unknown> | null;
  /** Which attributes are changing. */
  changedAttributes: string[];
};

/** Impact assessment for a single planned change. */
export type ChangeImpact = {
  /** The planned change. */
  change: PlannedChange;
  /** Matched graph node (if the resource exists in the graph). */
  graphNodeId: string | null;
  /** Downstream nodes affected by this change. */
  downstreamNodes: GraphNode[];
  /** Upstream nodes that depend on this resource. */
  upstreamNodes: GraphNode[];
  /** Total blast radius (unique affected nodes). */
  blastRadius: number;
  /** Edges traversed in the blast radius (dependency paths). */
  affectedEdges: GraphEdge[];
  /** Estimated monthly cost delta. */
  costDelta: number;
  /** Risk score (0–100). */
  riskScore: number;
  /** Risk factors identified. */
  riskFactors: string[];
  /** Risk level. */
  riskLevel: "critical" | "high" | "medium" | "low";
};

/** Full deployment impact analysis report. */
export type DeploymentImpactReport = {
  generatedAt: string;
  /** Source of the plan data. */
  planSource: string;
  /** Individual change impacts. */
  impacts: ChangeImpact[];
  /** Overall risk assessment. */
  overallRisk: {
    score: number;
    level: "critical" | "high" | "medium" | "low";
    factors: string[];
  };
  /** Summary metrics. */
  summary: DeploymentImpactSummary;
};

/** Summary of deployment impact. */
export type DeploymentImpactSummary = {
  totalChanges: number;
  creates: number;
  updates: number;
  deletes: number;
  replaces: number;
  totalBlastRadius: number;
  totalCostDelta: number;
  criticalResources: number;
  complianceImpacts: number;
  /** Change count by graph resource type (only for matched nodes). */
  byResourceType: Record<string, number>;
};

/** Terraform plan JSON format (simplified). */
export type TerraformPlan = {
  format_version?: string;
  terraform_version?: string;
  planned_values?: {
    root_module?: TerraformPlanModule;
  };
  resource_changes?: TerraformResourceChange[];
  prior_state?: {
    values?: {
      root_module?: TerraformPlanModule;
    };
  };
};

type TerraformPlanModule = {
  resources?: TerraformPlanResource[];
  child_modules?: TerraformPlanModule[];
};

type TerraformPlanResource = {
  address: string;
  type: string;
  name: string;
  provider_name: string;
  values: Record<string, unknown>;
};

/** A resource change from Terraform plan JSON. */
type TerraformResourceChange = {
  address: string;
  type: string;
  name: string;
  provider_name: string;
  change: {
    actions: string[];
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    after_unknown?: Record<string, boolean>;
  };
};

// =============================================================================
// Plan Parsing
// =============================================================================

/**
 * Parse a Terraform plan JSON into structured planned changes.
 */
export function parseTerraformPlan(plan: TerraformPlan): PlannedChange[] {
  const changes: PlannedChange[] = [];

  for (const rc of plan.resource_changes ?? []) {
    const actions = rc.change.actions;
    let action: PlannedChange["action"] = "no-op";

    if (actions.includes("create") && actions.includes("delete")) {
      action = "replace";
    } else if (actions.includes("create")) {
      action = "create";
    } else if (actions.includes("delete")) {
      action = "delete";
    } else if (actions.includes("update")) {
      action = "update";
    } else if (actions.includes("read")) {
      action = "read";
    }

    if (action === "no-op" || action === "read") continue;

    // Compute changed attributes
    const changedAttributes: string[] = [];
    if (rc.change.before && rc.change.after) {
      for (const key of Object.keys(rc.change.after)) {
        const beforeVal = JSON.stringify(rc.change.before[key] ?? null);
        const afterVal = JSON.stringify(rc.change.after[key] ?? null);
        if (beforeVal !== afterVal) changedAttributes.push(key);
      }
    }

    // Extract provider from provider_name (e.g., "registry.terraform.io/hashicorp/aws")
    const provider = extractProvider(rc.provider_name);

    changes.push({
      address: rc.address,
      action,
      resourceType: rc.type,
      provider,
      before: rc.change.before,
      after: rc.change.after,
      changedAttributes,
    });
  }

  return changes;
}

function extractProvider(providerName: string): string {
  const parts = providerName.split("/");
  const last = parts[parts.length - 1] ?? providerName;
  // Map common Terraform providers to graph providers
  const map: Record<string, string> = {
    aws: "aws",
    azurerm: "azure",
    google: "gcp",
    kubernetes: "kubernetes",
  };
  return map[last] ?? last;
}

// =============================================================================
// Resource Matching
// =============================================================================

/**
 * Try to match a planned change to an existing graph node.
 */
async function matchToGraphNode(
  storage: GraphStorage,
  change: PlannedChange,
): Promise<GraphNode | null> {
  // Try matching by native ID from before attributes
  if (change.before) {
    const arn = change.before.arn ?? change.before.id;
    if (typeof arn === "string") {
      const node = await storage.getNodeByNativeId(
        change.provider as CloudProvider,
        arn,
      );
      if (node) return node;
    }
  }

  // Try matching by name pattern
  const name = (change.after?.name ?? change.before?.name) as string | undefined;
  if (name) {
    const nodes = await storage.queryNodes({
      namePattern: name,
      provider: change.provider as CloudProvider,
    });
    if (nodes.length === 1) return nodes[0]!;
  }

  return null;
}

// =============================================================================
// Risk Scoring
// =============================================================================

/** Resource types with high criticality. */
const CRITICAL_RESOURCE_TYPES: Set<GraphResourceType> = new Set([
  "database", "cluster", "load-balancer", "vpc", "iam-role",
  "secret", "security-group", "dns", "certificate",
]);

/** Resource types with medium criticality. */
const MEDIUM_RESOURCE_TYPES: Set<GraphResourceType> = new Set([
  "compute", "cache", "queue", "storage", "function",
  "api-gateway", "container",
]);

/** Edge relationship types that cross security/compliance boundaries. */
const COMPLIANCE_EDGE_TYPES = new Set([
  "authenticates", "authorizes", "encrypts", "secures",
  "policy-governs", "controls-access",
]);

/**
 * Score the risk of a planned change (0–100).
 */
function scoreChangeRisk(
  change: PlannedChange,
  blastRadius: number,
  graphNode: GraphNode | null,
): { score: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  // Action risk
  switch (change.action) {
    case "delete":
      score += 40;
      factors.push("Destructive action (delete)");
      break;
    case "replace":
      score += 35;
      factors.push("Resource replacement (delete + create)");
      break;
    case "update":
      score += 15;
      factors.push("Resource update");
      break;
    case "create":
      score += 5;
      factors.push("New resource creation");
      break;
  }

  // Resource criticality
  const graphType = graphNode?.resourceType;
  if (graphType && CRITICAL_RESOURCE_TYPES.has(graphType)) {
    score += 25;
    factors.push(`Critical resource type: ${graphType}`);
  } else if (graphType && MEDIUM_RESOURCE_TYPES.has(graphType)) {
    score += 15;
    factors.push(`Important resource type: ${graphType}`);
  }

  // Blast radius
  if (blastRadius > 20) {
    score += 20;
    factors.push(`Large blast radius: ${blastRadius} resources affected`);
  } else if (blastRadius > 5) {
    score += 10;
    factors.push(`Moderate blast radius: ${blastRadius} resources affected`);
  }

  // Production environment
  if (graphNode?.tags.Environment === "production" || graphNode?.tags.env === "production") {
    score += 15;
    factors.push("Production environment resource");
  }

  // High cost resource
  if (graphNode && (graphNode.costMonthly ?? 0) > 100) {
    score += 5;
    factors.push(`High-cost resource: $${graphNode.costMonthly?.toFixed(2)}/mo`);
  }

  // Sensitive attribute changes
  const sensitiveAttrs = new Set(["password", "secret", "key", "token", "iam", "policy", "security_group"]);
  const hasSensitiveChange = change.changedAttributes.some((a) =>
    sensitiveAttrs.has(a) || [...sensitiveAttrs].some((s) => a.includes(s)),
  );
  if (hasSensitiveChange) {
    score += 10;
    factors.push("Sensitive attribute change detected");
  }

  return { score: Math.min(100, score), factors };
}

function riskLevel(score: number): "critical" | "high" | "medium" | "low" {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

// =============================================================================
// Cost Delta Estimation
// =============================================================================

/**
 * Estimate cost delta from a planned change.
 */
function estimateCostDelta(
  change: PlannedChange,
  graphNode: GraphNode | null,
): number {
  const currentCost = graphNode?.costMonthly ?? 0;

  switch (change.action) {
    case "delete":
      return -currentCost;
    case "create":
      // Use graph average for similar resource types if available
      return 0; // Conservative — can't estimate new resource cost without pricing API
    case "replace":
      return 0; // Replacement should be cost-neutral in most cases
    case "update": {
      // Check if instance size changed (common cost-changing update)
      const beforeSize = change.before?.instance_type ?? change.before?.machine_type ?? change.before?.sku;
      const afterSize = change.after?.instance_type ?? change.after?.machine_type ?? change.after?.sku;
      if (beforeSize !== afterSize && beforeSize && afterSize) {
        return 0; // Would need pricing API for accurate estimate
      }
      return 0;
    }
    default:
      return 0;
  }
}

// =============================================================================
// Main Analysis
// =============================================================================

/**
 * Analyze the deployment impact of planned changes against the knowledge graph.
 */
export async function analyzeDeploymentImpact(
  storage: GraphStorage,
  changes: PlannedChange[],
  options: {
    planSource?: string;
    maxDepth?: number;
    /** Traversal direction for blast radius. Defaults to "downstream". */
    direction?: TraversalDirection;
  } = {},
): Promise<DeploymentImpactReport> {
  const { planSource = "terraform-plan", maxDepth = 3, direction = "downstream" } = options;

  const impacts: ChangeImpact[] = [];
  const allAffectedIds = new Set<string>();

  for (const change of changes) {
    const graphNode = await matchToGraphNode(storage, change);
    let downstreamNodes: GraphNode[] = [];
    let upstreamNodes: GraphNode[] = [];

    let affectedEdges: GraphEdge[] = [];

    if (graphNode) {
      // Traverse graph for blast radius using configured direction
      const primary: TraversalDirection = direction === "both" ? "downstream" : direction;
      const primaryResult = await storage.getNeighbors(
        graphNode.id, maxDepth, primary,
      );
      downstreamNodes = primaryResult.nodes.filter((n) => n.id !== graphNode.id);
      affectedEdges = [...primaryResult.edges];

      const secondaryDir: TraversalDirection = primary === "downstream" ? "upstream" : "downstream";
      const secondaryResult = await storage.getNeighbors(
        graphNode.id, maxDepth, secondaryDir,
      );
      upstreamNodes = secondaryResult.nodes.filter((n) => n.id !== graphNode.id);

      // When using "both" direction, include edges from both traversals
      if (direction === "both") {
        affectedEdges = [...affectedEdges, ...secondaryResult.edges];
      }

      allAffectedIds.add(graphNode.id);
      for (const n of downstreamNodes) allAffectedIds.add(n.id);
    }

    const blastRadius = downstreamNodes.length;
    const { score, factors } = scoreChangeRisk(change, blastRadius, graphNode);
    const costDelta = estimateCostDelta(change, graphNode);

    impacts.push({
      change,
      graphNodeId: graphNode?.id ?? null,
      downstreamNodes,
      upstreamNodes,
      blastRadius,
      affectedEdges,
      costDelta,
      riskScore: score,
      riskFactors: factors,
      riskLevel: riskLevel(score),
    });
  }

  // Compute overall risk
  const maxRisk = impacts.length > 0
    ? Math.max(...impacts.map((i) => i.riskScore))
    : 0;
  const avgRisk = impacts.length > 0
    ? impacts.reduce((s, i) => s + i.riskScore, 0) / impacts.length
    : 0;
  const overallScore = Math.round(maxRisk * 0.6 + avgRisk * 0.4);

  const overallFactors: string[] = [];
  if (impacts.some((i) => i.change.action === "delete")) {
    overallFactors.push("Contains destructive changes");
  }
  if (allAffectedIds.size > 50) {
    overallFactors.push(`Large total blast radius: ${allAffectedIds.size} resources`);
  }
  if (impacts.some((i) => i.riskLevel === "critical")) {
    overallFactors.push("Contains critical risk changes");
  }

  const summary: DeploymentImpactSummary = {
    totalChanges: changes.length,
    creates: changes.filter((c) => c.action === "create").length,
    updates: changes.filter((c) => c.action === "update").length,
    deletes: changes.filter((c) => c.action === "delete").length,
    replaces: changes.filter((c) => c.action === "replace").length,
    totalBlastRadius: allAffectedIds.size,
    totalCostDelta: impacts.reduce((s, i) => s + i.costDelta, 0),
    criticalResources: impacts.filter((i) => i.riskLevel === "critical").length,
    complianceImpacts: impacts.reduce((count, i) =>
      count + i.affectedEdges.filter((e) => COMPLIANCE_EDGE_TYPES.has(e.relationshipType)).length,
    0),
    byResourceType: buildResourceTypeBreakdown(impacts),
  };

  return {
    generatedAt: new Date().toISOString(),
    planSource,
    impacts: impacts.sort((a, b) => b.riskScore - a.riskScore),
    overallRisk: {
      score: overallScore,
      level: riskLevel(overallScore),
      factors: overallFactors,
    },
    summary,
  };
}

/**
 * Analyze a Terraform plan JSON directly.
 */
/** Build a count of changes per graph resource type from matched nodes. */
function buildResourceTypeBreakdown(impacts: ChangeImpact[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const impact of impacts) {
    // Collect unique resource types from affected nodes
    const types = new Set<string>();
    for (const node of impact.downstreamNodes) {
      types.add(node.resourceType);
    }
    for (const node of impact.upstreamNodes) {
      types.add(node.resourceType);
    }
    for (const t of types) {
      breakdown[t] = (breakdown[t] ?? 0) + 1;
    }
  }
  return breakdown;
}

export async function analyzeTerraformPlanImpact(
  storage: GraphStorage,
  planJson: TerraformPlan,
): Promise<DeploymentImpactReport> {
  const changes = parseTerraformPlan(planJson);
  return analyzeDeploymentImpact(storage, changes, { planSource: "terraform-plan-json" });
}

/**
 * Format a deployment impact report as markdown.
 */
export function formatDeploymentImpactMarkdown(
  report: DeploymentImpactReport,
): string {
  const s = report.summary;
  const lines: string[] = [
    "# Deployment Impact Analysis",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${report.planSource}`,
    `Overall risk: **${report.overallRisk.level}** (${report.overallRisk.score}/100)`,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Changes | ${s.totalChanges} |`,
    `| Creates | ${s.creates} |`,
    `| Updates | ${s.updates} |`,
    `| Deletes | ${s.deletes} |`,
    `| Replaces | ${s.replaces} |`,
    `| Total Blast Radius | ${s.totalBlastRadius} resources |`,
    `| Cost Delta | $${s.totalCostDelta.toFixed(2)}/mo |`,
    `| Critical Resources | ${s.criticalResources} |`,
    `| Compliance Impacts | ${s.complianceImpacts} |`,
    "",
  ];

  // Resource type breakdown
  if (Object.keys(s.byResourceType).length > 0) {
    const entries = Object.entries(s.byResourceType).sort(([, a], [, b]) => b - a);
    lines.push(
      "## Changes by Resource Type",
      "",
      "| Resource Type | Affected Count |",
      "|---------------|---------------|",
      ...entries.map(([type, count]) => `| ${type} | ${count} |`),
      "",
    );
  }

  if (report.overallRisk.factors.length > 0) {
    lines.push(
      "## Risk Factors",
      "",
      ...report.overallRisk.factors.map((f) => `- ${f}`),
      "",
    );
  }

  if (report.impacts.length > 0) {
    lines.push(
      "## Change Details",
      "",
      "| Resource | Action | Risk | Blast Radius | Cost Delta |",
      "|----------|--------|------|-------------|-----------|",
      ...report.impacts.map(
        (i) =>
          `| ${i.change.address} | ${i.change.action} | ${i.riskLevel} (${i.riskScore}) | ${i.blastRadius} | $${i.costDelta.toFixed(2)} |`,
      ),
      "",
    );

    // Show dependency paths from affected edges
    const edgeRelTypes = new Map<string, number>();
    for (const impact of report.impacts) {
      for (const edge of impact.affectedEdges) {
        edgeRelTypes.set(edge.relationshipType, (edgeRelTypes.get(edge.relationshipType) ?? 0) + 1);
      }
    }
    if (edgeRelTypes.size > 0) {
      lines.push(
        "## Dependency Paths",
        "",
        "| Relationship Type | Count |",
        "|-------------------|-------|",
        ...[...edgeRelTypes.entries()]
          .sort(([, a], [, b]) => b - a)
          .map(([type, count]) => `| ${type} | ${count} |`),
        "",
      );
    }
  }

  return lines.join("\n");
}
