/**
 * Infrastructure Knowledge Graph — Change Impact Analyzer
 *
 * Answers: "If I make this change, what's the full impact across cost,
 * compliance, availability, and dependent teams?"
 *
 * Composes blast radius + cost attribution + compliance evaluation +
 * group/team ownership + governance risk scoring into a single
 * cross-cutting impact report. This is the "what happens if" engine
 * that no single-purpose tool can replicate.
 */

import type {
  GraphStorage,
  GraphNode,
  GraphResourceType,
  SubgraphResult,
  GraphRelationshipType,
} from "../types.js";
import type { GraphEngine } from "../core/engine.js";
import type { ComplianceFramework, ControlResult, ComplianceReport } from "./compliance.js";
import type { RiskAssessment, ChangeRequest } from "../core/governance.js";
import type { GraphFederationManager } from "../core/federation.js";
import { runComplianceAssessment } from "./compliance.js";
import { calculateRiskScore } from "../core/governance.js";

// =============================================================================
// Types
// =============================================================================

/** The action being evaluated for impact. */
export type ChangeAction =
  | "destroy"
  | "stop"
  | "modify"
  | "scale-down"
  | "scale-up"
  | "reconfigure"
  | "migrate"
  | "detach";

/** A single node in the blast radius with context. */
export type AffectedResource = {
  node: GraphNode;
  /** Number of hops from the target. */
  hops: number;
  /** How this resource relates to the target (via edge relationship). */
  relationship: GraphRelationshipType | "transitive";
  /** Whether this is on a critical path (single point of failure chain). */
  isCritical: boolean;
  /** Estimated impact on this specific resource. */
  impact: "will-break" | "degraded" | "data-loss-risk" | "cost-impact" | "unknown";
};

/** Cost impact breakdown. */
export type CostImpact = {
  /** Direct monthly cost of the target resource. */
  directMonthlyCost: number;
  /** Total cost of downstream resources at risk. */
  downstreamCostAtRisk: number;
  /** Estimated incident cost if dependent services fail (heuristic). */
  estimatedIncidentCost: number;
  /** Net monthly cost change from this action (negative = savings). */
  netMonthlyCostChange: number;
};

/** A compliance framework that would be affected. */
export type ComplianceImpact = {
  /** Frameworks affected by this change. */
  frameworksAffected: ComplianceFramework[];
  /** Controls that would fail after this change. */
  controlsAtRisk: ControlResult[];
  /** Number of new violations this change would introduce. */
  newViolationCount: number;
};

/** A team or group affected by this change. */
export type AffectedTeam = {
  /** Group/team name. */
  team: string;
  /** Group ID. */
  groupId: string;
  /** Which of their nodes are in the blast radius. */
  affectedNodeIds: string[];
  /** Why they're affected. */
  reason: string;
};

/** A single step in the suggested safe execution path. */
export type SafePathStep = {
  /** Step number (1-based). */
  order: number;
  /** What to do. */
  action: string;
  /** Which resource. */
  targetName: string;
  targetId: string;
  /** Why this step is needed before proceeding. */
  rationale: string;
  /** Whether this step can be automated. */
  automatable: boolean;
};

/** The complete change impact report. */
export type ChangeImpactReport = {
  generatedAt: string;
  /** The resource being changed. */
  targetNode: GraphNode;
  /** The proposed action. */
  action: ChangeAction;

  // --- Blast Radius ---
  blastRadius: {
    directDependents: number;
    totalAffected: number;
    maxDepth: number;
    affectedResources: AffectedResource[];
  };

  // --- Cost ---
  costImpact: CostImpact;

  // --- Compliance ---
  complianceImpact: ComplianceImpact;

  // --- Teams ---
  teamsAffected: AffectedTeam[];

  // --- Safe path ---
  suggestedSafePath: SafePathStep[];

  // --- Overall risk ---
  risk: RiskAssessment;

  // --- Formatted summary ---
  summary: string;
};

/** Options for change impact analysis. */
export type ChangeImpactOptions = {
  /** Max traversal depth for blast radius (default: 6). */
  maxDepth?: number;
  /** Edge types to follow (default: all). */
  edgeTypes?: GraphRelationshipType[];
  /** Compliance frameworks to check (default: all). */
  frameworks?: ComplianceFramework[];
  /** Whether to include federated peer graphs (default: false). */
  includeFederated?: boolean;
  /** Federation manager if federated analysis is desired. */
  federation?: GraphFederationManager;
  /** Incident cost multiplier for heuristic (default: 10x monthly cost). */
  incidentCostMultiplier?: number;
};

// =============================================================================
// Constants
// =============================================================================

/** Actions that typically cause service disruption. */
const DESTRUCTIVE_ACTIONS: ChangeAction[] = ["destroy", "stop", "detach"];

/** Actions that cause partial degradation. */
const DISRUPTIVE_ACTIONS: ChangeAction[] = ["modify", "scale-down", "reconfigure", "migrate"];

/** Relationship types that indicate hard dependency. */
const HARD_DEPENDENCY_TYPES: GraphRelationshipType[] = [
  "depends-on",
  "runs-in",
  "reads-from",
  "writes-to",
  "stores-in",
  "authenticated-by",
  "encrypts-with",
  "backed-by",
  "connected-to",
];

/** Resource types that are typically team-critical. */
const CRITICAL_RESOURCE_TYPES: GraphResourceType[] = [
  "database",
  "cluster",
  "load-balancer",
  "vpc",
  "secret",
  "identity",
  "iam-role",
];

// =============================================================================
// Implementation
// =============================================================================

/**
 * Analyze the full cross-cutting impact of a proposed infrastructure change.
 *
 * Composes blast radius, cost attribution, compliance evaluation,
 * team ownership, and governance risk scoring into a single report.
 */
export async function analyzeChangeImpact(
  engine: GraphEngine,
  storage: GraphStorage,
  targetNodeId: string,
  action: ChangeAction,
  options: ChangeImpactOptions = {},
): Promise<ChangeImpactReport> {
  const {
    maxDepth = 6,
    edgeTypes,
    frameworks = ["soc2", "hipaa", "pci-dss", "iso-27001", "cis", "nist-800-53"],
    includeFederated = false,
    federation,
    incidentCostMultiplier = 10,
  } = options;

  const generatedAt = new Date().toISOString();

  // --- 1. Resolve target node ---
  const targetNode = await storage.getNode(targetNodeId);
  if (!targetNode) {
    throw new Error(`Node not found: ${targetNodeId}`);
  }

  // --- 2. Compute blast radius ---
  const blastSubgraph = await engine.getBlastRadius(targetNodeId, maxDepth, edgeTypes);
  const affectedResources = buildAffectedResources(
    targetNode,
    blastSubgraph,
    action,
    storage,
  );

  // --- 3. Cost impact ---
  const costImpact = computeCostImpact(
    targetNode,
    blastSubgraph,
    action,
    incidentCostMultiplier,
  );

  // --- 4. Compliance impact (on affected resources) ---
  const complianceImpact = await computeComplianceImpact(
    storage,
    blastSubgraph,
    frameworks,
    action,
  );

  // --- 5. Team/group impact ---
  const teamsAffected = await computeTeamImpact(
    storage,
    blastSubgraph,
    targetNode,
  );

  // --- 6. Federated impact (if requested) ---
  if (includeFederated && federation) {
    const federatedTeams = await computeFederatedImpact(
      federation,
      blastSubgraph,
      targetNode,
    );
    teamsAffected.push(...federatedTeams);
  }

  // --- 7. Governance risk score ---
  const environment = targetNode.tags["environment"] ?? targetNode.tags["env"] ?? null;
  const isGpuAiWorkload =
    targetNode.tags["gpu"] === "true" ||
    targetNode.resourceType === "cluster" &&
      (targetNode.metadata["instanceType"] as string ?? "").includes("gpu");

  const risk = calculateRiskScore({
    blastRadiusSize: blastSubgraph.nodes.size,
    costAtRisk: costImpact.downstreamCostAtRisk,
    dependentCount: affectedResources.filter((r) => r.hops === 1).length,
    environment,
    isGpuAiWorkload,
    action: mapActionToGovernanceAction(action),
    hourOfDay: new Date().getHours(),
  });

  // --- 8. Generate safe path ---
  const suggestedSafePath = generateSafePath(
    targetNode,
    action,
    affectedResources,
    blastSubgraph,
  );

  // --- 9. Build summary ---
  const report: ChangeImpactReport = {
    generatedAt,
    targetNode,
    action,
    blastRadius: {
      directDependents: affectedResources.filter((r) => r.hops === 1).length,
      totalAffected: affectedResources.length,
      maxDepth: Math.max(0, ...affectedResources.map((r) => r.hops)),
      affectedResources,
    },
    costImpact,
    complianceImpact,
    teamsAffected,
    suggestedSafePath,
    risk,
    summary: "", // filled below
  };

  report.summary = formatImpactSummary(report);
  return report;
}

// =============================================================================
// Blast Radius Analysis
// =============================================================================

function buildAffectedResources(
  target: GraphNode,
  subgraph: SubgraphResult,
  action: ChangeAction,
  _storage: GraphStorage,
): AffectedResource[] {
  const resources: AffectedResource[] = [];

  for (const [nodeId, node] of subgraph.nodes) {
    if (nodeId === target.id) continue;

    // Determine hop distance
    let hops = 0;
    for (const [depth, ids] of subgraph.hops) {
      if (ids.includes(nodeId)) {
        hops = depth;
        break;
      }
    }

    // Find the relationship type from edges
    const edge = subgraph.edges.find(
      (e) => e.sourceNodeId === nodeId || e.targetNodeId === nodeId,
    );
    const relationship: GraphRelationshipType | "transitive" =
      edge?.relationshipType ?? "transitive";

    // Determine if this is a critical path node (hard dependency at hop 1)
    const isCritical =
      hops === 1 && HARD_DEPENDENCY_TYPES.includes(relationship as GraphRelationshipType);

    // Classify impact
    const impact = classifyImpact(action, relationship, hops, node);

    resources.push({ node, hops, relationship, isCritical, impact });
  }

  // Sort by severity: critical first, then by hops
  resources.sort((a, b) => {
    if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
    if (a.hops !== b.hops) return a.hops - b.hops;
    return impactSeverity(a.impact) - impactSeverity(b.impact);
  });

  return resources;
}

function classifyImpact(
  action: ChangeAction,
  relationship: GraphRelationshipType | "transitive",
  hops: number,
  _node: GraphNode,
): AffectedResource["impact"] {
  if (DESTRUCTIVE_ACTIONS.includes(action)) {
    if (hops === 1 && HARD_DEPENDENCY_TYPES.includes(relationship as GraphRelationshipType)) {
      // Database being destroyed? Consumers will break.
      if (
        relationship === "reads-from" ||
        relationship === "writes-to" ||
        relationship === "stores-in"
      ) {
        return "data-loss-risk";
      }
      return "will-break";
    }
    if (hops <= 2) return "degraded";
    return "cost-impact";
  }

  if (DISRUPTIVE_ACTIONS.includes(action)) {
    if (hops === 1) return "degraded";
    return "cost-impact";
  }

  return "unknown";
}

function impactSeverity(impact: AffectedResource["impact"]): number {
  const order: Record<AffectedResource["impact"], number> = {
    "will-break": 0,
    "data-loss-risk": 1,
    "degraded": 2,
    "cost-impact": 3,
    "unknown": 4,
  };
  return order[impact] ?? 4;
}

// =============================================================================
// Cost Impact
// =============================================================================

function computeCostImpact(
  target: GraphNode,
  subgraph: SubgraphResult,
  action: ChangeAction,
  incidentMultiplier: number,
): CostImpact {
  const directMonthlyCost = target.costMonthly ?? 0;

  // Sum cost of all downstream resources at risk
  let downstreamCostAtRisk = 0;
  for (const [nodeId, node] of subgraph.nodes) {
    if (nodeId === target.id) continue;
    downstreamCostAtRisk += node.costMonthly ?? 0;
  }

  // Heuristic: incident cost is a multiplier of direct + downstream cost
  // based on number of critical resources affected
  const criticalCount = Array.from(subgraph.nodes.values()).filter(
    (n) => CRITICAL_RESOURCE_TYPES.includes(n.resourceType),
  ).length;
  const incidentFactor = Math.max(1, criticalCount) * incidentMultiplier;
  const estimatedIncidentCost =
    DESTRUCTIVE_ACTIONS.includes(action)
      ? (directMonthlyCost + downstreamCostAtRisk) * incidentFactor / 30 // per-incident, not per-month
      : 0;

  // Net cost change depends on action
  let netMonthlyCostChange = 0;
  if (action === "destroy" || action === "stop") {
    netMonthlyCostChange = -directMonthlyCost;
  } else if (action === "scale-down") {
    netMonthlyCostChange = -directMonthlyCost * 0.4; // heuristic: 40% savings
  } else if (action === "scale-up") {
    netMonthlyCostChange = directMonthlyCost * 0.5; // heuristic: 50% increase
  }

  return {
    directMonthlyCost,
    downstreamCostAtRisk,
    estimatedIncidentCost,
    netMonthlyCostChange,
  };
}

// =============================================================================
// Compliance Impact
// =============================================================================

async function computeComplianceImpact(
  storage: GraphStorage,
  subgraph: SubgraphResult,
  frameworks: ComplianceFramework[],
  action: ChangeAction,
): Promise<ComplianceImpact> {
  // Get IDs of all affected resources
  const affectedIds = new Set(subgraph.nodes.keys());

  // Run compliance assessment on the full graph
  let report: ComplianceReport;
  try {
    report = await runComplianceAssessment(frameworks, storage);
  } catch {
    return { frameworksAffected: [], controlsAtRisk: [], newViolationCount: 0 };
  }

  // Filter to controls that involve affected resources
  const controlsAtRisk: ControlResult[] = [];
  const frameworksAffected = new Set<ComplianceFramework>();

  for (const summary of report.frameworks) {
    for (const result of summary.results) {
      if (affectedIds.has(result.nodeId)) {
        // If the action is destructive, any passing control on this resource
        // could become a fail (resource disappears, controls become N/A or fail)
        if (
          DESTRUCTIVE_ACTIONS.includes(action) ||
          result.status === "fail" ||
          result.status === "warning"
        ) {
          controlsAtRisk.push(result);
          frameworksAffected.add(result.framework);
        }
      }
    }
  }

  // New violations = controls that currently pass but would fail
  const newViolationCount = DESTRUCTIVE_ACTIONS.includes(action)
    ? controlsAtRisk.filter((r) => r.status === "pass").length
    : 0;

  return {
    frameworksAffected: [...frameworksAffected],
    controlsAtRisk,
    newViolationCount,
  };
}

// =============================================================================
// Team Impact
// =============================================================================

async function computeTeamImpact(
  storage: GraphStorage,
  subgraph: SubgraphResult,
  target: GraphNode,
): Promise<AffectedTeam[]> {
  const teamMap = new Map<string, AffectedTeam>();
  const affectedIds = Array.from(subgraph.nodes.keys());

  for (const nodeId of affectedIds) {
    try {
      const groups = await storage.getNodeGroups(nodeId);
      for (const group of groups) {
        if (group.groupType === "team" || group.groupType === "service" || group.groupType === "application") {
          const key = group.id;
          if (!teamMap.has(key)) {
            teamMap.set(key, {
              team: group.name,
              groupId: group.id,
              affectedNodeIds: [],
              reason: nodeId === target.id
                ? `Directly owns the target resource "${target.name}"`
                : `Owns resources in the blast radius`,
            });
          }
          teamMap.get(key)!.affectedNodeIds.push(nodeId);
        }
      }
    } catch {
      // Group lookup may fail for some storage backends; skip
    }
  }

  // Also check owner tags
  for (const [nodeId, node] of subgraph.nodes) {
    const owner = node.owner ?? node.tags["team"] ?? node.tags["owner"];
    if (owner) {
      const key = `tag:${owner}`;
      if (!teamMap.has(key)) {
        teamMap.set(key, {
          team: owner,
          groupId: "",
          affectedNodeIds: [],
          reason: "Identified via resource owner/team tag",
        });
      }
      const existing = teamMap.get(key)!;
      if (!existing.affectedNodeIds.includes(nodeId)) {
        existing.affectedNodeIds.push(nodeId);
      }
    }
  }

  return Array.from(teamMap.values());
}

// =============================================================================
// Federated Impact
// =============================================================================

async function computeFederatedImpact(
  federation: GraphFederationManager,
  _subgraph: SubgraphResult,
  target: GraphNode,
): Promise<AffectedTeam[]> {
  const teams: AffectedTeam[] = [];

  try {
    // Check if any peer graphs have nodes that depend on the target
    const peers = federation.getPeers();
    for (const peer of peers) {
      if (!peer.healthy) continue;

      // Check if the peer has edges pointing to the target node
      const peerEdges = await peer.storage.queryEdges({
        targetNodeId: target.id,
      });

      if (peerEdges.length > 0) {
        const affectedNodeIds = peerEdges.map((e) => e.sourceNodeId);
        teams.push({
          team: `[${peer.namespace}] ${peer.name}`,
          groupId: peer.id,
          affectedNodeIds,
          reason: `Federated peer "${peer.name}" has ${peerEdges.length} resource(s) depending on the target`,
        });
      }
    }
  } catch {
    // Federation query may fail; non-fatal
  }

  return teams;
}

// =============================================================================
// Safe Path Generation
// =============================================================================

function generateSafePath(
  target: GraphNode,
  action: ChangeAction,
  affected: AffectedResource[],
  _subgraph: SubgraphResult,
): SafePathStep[] {
  const steps: SafePathStep[] = [];
  let order = 0;

  // Critical dependents that will break
  const willBreak = affected.filter((r) => r.impact === "will-break" || r.impact === "data-loss-risk");
  const degraded = affected.filter((r) => r.impact === "degraded");

  // If destructive action on a database/storage, suggest backup first
  if (
    DESTRUCTIVE_ACTIONS.includes(action) &&
    ["database", "storage", "cache"].includes(target.resourceType)
  ) {
    steps.push({
      order: ++order,
      action: "Create backup/snapshot",
      targetName: target.name,
      targetId: target.id,
      rationale: `${target.resourceType} contains data that should be backed up before ${action}`,
      automatable: true,
    });
  }

  // For each resource that will break, suggest mitigation
  for (const resource of willBreak) {
    if (resource.impact === "data-loss-risk") {
      steps.push({
        order: ++order,
        action: "Migrate data consumers to alternative source",
        targetName: resource.node.name,
        targetId: resource.node.id,
        rationale: `"${resource.node.name}" ${resource.relationship === "reads-from" ? "reads from" : "writes to"} the target — will lose data access`,
        automatable: false,
      });
    } else {
      steps.push({
        order: ++order,
        action: "Update dependency or provision replacement",
        targetName: resource.node.name,
        targetId: resource.node.id,
        rationale: `"${resource.node.name}" directly depends on the target and will break`,
        automatable: false,
      });
    }
  }

  // If the target is a network resource, suggest connectivity verification
  if (["vpc", "subnet", "security-group", "load-balancer", "nat-gateway"].includes(target.resourceType)) {
    steps.push({
      order: ++order,
      action: "Verify network connectivity for dependent services",
      targetName: target.name,
      targetId: target.id,
      rationale: "Network change may affect connectivity of all downstream services",
      automatable: true,
    });
  }

  // Add monitoring step for degraded resources
  if (degraded.length > 0) {
    steps.push({
      order: ++order,
      action: `Set up monitoring alerts for ${degraded.length} potentially affected resource(s)`,
      targetName: target.name,
      targetId: target.id,
      rationale: "Detect degradation early in resources that may be impacted",
      automatable: true,
    });
  }

  // Execute the actual change
  steps.push({
    order: ++order,
    action: `Execute: ${action} ${target.resourceType}`,
    targetName: target.name,
    targetId: target.id,
    rationale: "Perform the planned change after prerequisites are met",
    automatable: action !== "destroy", // destroy typically needs manual confirm
  });

  // Post-change verification
  steps.push({
    order: ++order,
    action: "Run drift detection and verify graph consistency",
    targetName: target.name,
    targetId: target.id,
    rationale: "Confirm the change was applied correctly and no unexpected drift occurred",
    automatable: true,
  });

  return steps;
}

// =============================================================================
// Action Mapping
// =============================================================================

function mapActionToGovernanceAction(
  action: ChangeAction,
): ChangeRequest["action"] {
  switch (action) {
    case "destroy":
      return "delete";
    case "stop":
      return "update";
    case "modify":
    case "reconfigure":
      return "reconfigure";
    case "scale-down":
    case "scale-up":
      return "scale";
    case "migrate":
    case "detach":
      return "update";
    default:
      return "update";
  }
}

// =============================================================================
// Formatting
// =============================================================================

/** Format the impact report as a human-readable summary. */
export function formatImpactSummary(report: ChangeImpactReport): string {
  const lines: string[] = [];
  const { targetNode, action, blastRadius, costImpact, complianceImpact, teamsAffected, risk } = report;

  lines.push(`## Impact Analysis: ${action} "${targetNode.name}"`);
  lines.push("");
  lines.push(`**Target:** ${targetNode.name} (${targetNode.resourceType}, ${targetNode.provider}, ${targetNode.region})`);
  lines.push(`**Action:** ${action}`);
  lines.push(`**Risk Level:** ${risk.level.toUpperCase()} (score: ${risk.score})`);
  lines.push("");

  // Blast radius
  lines.push(`### Blast Radius: ${blastRadius.totalAffected} resource(s) affected`);
  lines.push("");

  const willBreak = blastRadius.affectedResources.filter((r) => r.impact === "will-break");
  const dataLoss = blastRadius.affectedResources.filter((r) => r.impact === "data-loss-risk");
  const degradedList = blastRadius.affectedResources.filter((r) => r.impact === "degraded");

  if (willBreak.length > 0) {
    lines.push(`**WILL BREAK (${willBreak.length}):**`);
    for (const r of willBreak) {
      lines.push(`  - ${r.node.name} (${r.node.resourceType}) — ${r.relationship}, hop ${r.hops}`);
    }
    lines.push("");
  }

  if (dataLoss.length > 0) {
    lines.push(`**DATA LOSS RISK (${dataLoss.length}):**`);
    for (const r of dataLoss) {
      lines.push(`  - ${r.node.name} (${r.node.resourceType}) — ${r.relationship}, hop ${r.hops}`);
    }
    lines.push("");
  }

  if (degradedList.length > 0) {
    lines.push(`**MAY DEGRADE (${degradedList.length}):**`);
    for (const r of degradedList.slice(0, 10)) {
      lines.push(`  - ${r.node.name} (${r.node.resourceType}) — hop ${r.hops}`);
    }
    if (degradedList.length > 10) {
      lines.push(`  - ... and ${degradedList.length - 10} more`);
    }
    lines.push("");
  }

  // Cost impact
  lines.push("### Cost Impact");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Direct monthly cost | $${costImpact.directMonthlyCost.toFixed(2)}/mo |`);
  lines.push(`| Downstream cost at risk | $${costImpact.downstreamCostAtRisk.toFixed(2)}/mo |`);
  if (costImpact.estimatedIncidentCost > 0) {
    lines.push(`| Estimated incident cost | $${costImpact.estimatedIncidentCost.toFixed(2)} |`);
  }
  lines.push(`| Net monthly cost change | ${costImpact.netMonthlyCostChange >= 0 ? "+" : ""}$${costImpact.netMonthlyCostChange.toFixed(2)}/mo |`);
  lines.push("");

  // Compliance impact
  if (complianceImpact.frameworksAffected.length > 0) {
    lines.push("### Compliance Impact");
    lines.push("");
    lines.push(`**Frameworks affected:** ${complianceImpact.frameworksAffected.join(", ")}`);
    lines.push(`**Controls at risk:** ${complianceImpact.controlsAtRisk.length}`);
    if (complianceImpact.newViolationCount > 0) {
      lines.push(`**New violations:** ${complianceImpact.newViolationCount}`);
    }
    lines.push("");

    const critical = complianceImpact.controlsAtRisk.filter((c) => c.severity === "critical");
    if (critical.length > 0) {
      lines.push("**Critical controls at risk:**");
      for (const c of critical.slice(0, 5)) {
        lines.push(`  - ${c.framework} ${c.controlId}: ${c.title} (${c.status})`);
      }
      lines.push("");
    }
  }

  // Teams
  if (teamsAffected.length > 0) {
    lines.push("### Teams Affected");
    lines.push("");
    for (const t of teamsAffected) {
      lines.push(`- **${t.team}** — ${t.affectedNodeIds.length} resource(s): ${t.reason}`);
    }
    lines.push("");
  }

  // Safe path
  if (report.suggestedSafePath.length > 0) {
    lines.push("### Suggested Safe Path");
    lines.push("");
    for (const step of report.suggestedSafePath) {
      const auto = step.automatable ? " ✅" : " ⚠️ manual";
      lines.push(`${step.order}. **${step.action}** → ${step.targetName}${auto}`);
      lines.push(`   _${step.rationale}_`);
    }
    lines.push("");
  }

  // Risk factors
  if (risk.factors.length > 0) {
    lines.push("### Risk Factors");
    lines.push("");
    for (const f of risk.factors) {
      lines.push(`- ${f}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format the impact report as compact markdown suitable for MCP tool output.
 */
export function formatImpactMarkdown(report: ChangeImpactReport): string {
  return report.summary;
}
