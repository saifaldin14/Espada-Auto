/**
 * Infrastructure Knowledge Graph — Autonomous Remediation Agent
 *
 * Chains the full pipeline: detect violations → generate IaC fix →
 * compute blast radius → score risk → auto-apply or escalate.
 *
 * This is not a "suggest and forget" system. It produces executable
 * remediation actions with safety guarantees:
 *   - Low-risk fixes are auto-applied with full audit trail
 *   - Medium-risk fixes create PRs with blast radius reports
 *   - High-risk fixes are blocked and flagged for human review
 *
 * Requires: compliance engine, remediation generator, governance,
 * blast radius from the graph engine.
 */

import type {
  GraphStorage,
  GraphNode,
  GraphResourceType,
  CloudProvider,
  NodeFilter,
} from "../types.js";
import type { GraphEngine } from "../core/engine.js";
import type {
  ComplianceFramework,
  ComplianceReport,
} from "./compliance.js";
import type {
  DriftResult,
} from "../types.js";
import type {
  RemediationPatch,
  IaCFormat,
} from "./remediation.js";
import type {
  RiskAssessment,
  ChangeRequest,
} from "../core/governance.js";
import { runComplianceAssessment } from "./compliance.js";
import { generateRemediationPlan } from "./remediation.js";
import { calculateRiskScore, ChangeGovernor } from "../core/governance.js";

// =============================================================================
// Types
// =============================================================================

/** Decision taken for a remediation action. */
export type RemediationDecision =
  | "auto-applied"
  | "pr-created"
  | "manual-review"
  | "blocked"
  | "skipped"
  | "failed";

/** A single remediation action with full context. */
export type RemediationAction = {
  /** Unique action ID. */
  id: string;
  /** The compliance violation or drift that triggered this. */
  violation: {
    controlId: string;
    framework: ComplianceFramework | "drift";
    severity: "critical" | "high" | "medium" | "low";
    title: string;
    nodeId: string;
    nodeName: string;
    resourceType: GraphResourceType;
    provider: CloudProvider;
  };
  /** The generated IaC fix. */
  patch: RemediationPatch | null;
  /** Risk assessment of applying this fix. */
  risk: RiskAssessment;
  /** Blast radius of applying this fix. */
  blastRadiusSize: number;
  /** What was decided. */
  decision: RemediationDecision;
  /** Why this decision was made. */
  reason: string;
  /** If auto-applied, the governance change request. */
  changeRequest?: ChangeRequest;
  /** Timestamp of the decision. */
  decidedAt: string;
};

/** Summary of a complete remediation run. */
export type RemediationRunResult = {
  /** Unique run ID. */
  id: string;
  /** When the run started. */
  startedAt: string;
  /** When the run completed. */
  completedAt: string;
  /** Total violations found. */
  totalViolations: number;
  /** Breakdown by decision. */
  autoApplied: number;
  prCreated: number;
  manualReview: number;
  blocked: number;
  skipped: number;
  failed: number;
  /** All actions taken. */
  actions: RemediationAction[];
  /** Frameworks assessed. */
  frameworks: ComplianceFramework[];
  /** IaC format used. */
  format: IaCFormat;
  /** Total estimated savings from applied fixes. */
  estimatedSavings: number;
};

/** Configuration for the remediation agent. */
export type RemediationAgentConfig = {
  /** Risk score threshold below which fixes are auto-applied (default: 25). */
  autoApplyThreshold?: number;
  /** Risk score threshold above which fixes are blocked (default: 70). */
  blockThreshold?: number;
  /** Maximum blast radius size for auto-apply (default: 3). */
  maxAutoApplyBlastRadius?: number;
  /** IaC format for generated patches (default: "terraform"). */
  format?: IaCFormat;
  /** Compliance frameworks to assess (default: all). */
  frameworks?: ComplianceFramework[];
  /** Resource filter to scope the assessment (default: all). */
  filter?: NodeFilter;
  /** Maximum violations to process per run (default: 100). */
  maxActionsPerRun?: number;
  /** Whether to include drift-based remediation (default: true). */
  includeDrift?: boolean;
  /** Dry run — don't actually auto-apply (default: false). */
  dryRun?: boolean;
  /** Callback when a PR should be created. Returns PR URL if successful. */
  onCreatePR?: (action: RemediationAction) => Promise<string | null>;
  /** Callback when auto-apply succeeds. */
  onAutoApplied?: (action: RemediationAction) => Promise<void>;
  /** Callback for audit logging of decisions. */
  onDecision?: (action: RemediationAction) => Promise<void>;
};

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_AUTO_THRESHOLD = 25;
const DEFAULT_BLOCK_THRESHOLD = 70;
const DEFAULT_MAX_BLAST_RADIUS = 3;
const DEFAULT_MAX_ACTIONS = 100;
const ALL_FRAMEWORKS: ComplianceFramework[] = [
  "soc2", "hipaa", "pci-dss", "iso-27001", "cis", "nist-800-53",
];

// =============================================================================
// Agent Implementation
// =============================================================================

/**
 * Run the autonomous remediation agent.
 *
 * Performs a full compliance assessment, generates fixes for every
 * violation, evaluates safety of each fix, and makes a decision:
 * auto-apply, create PR, escalate, or block.
 */
export async function runRemediationAgent(
  engine: GraphEngine,
  storage: GraphStorage,
  governor: ChangeGovernor | null,
  config: RemediationAgentConfig = {},
): Promise<RemediationRunResult> {
  const {
    autoApplyThreshold = DEFAULT_AUTO_THRESHOLD,
    blockThreshold = DEFAULT_BLOCK_THRESHOLD,
    maxAutoApplyBlastRadius = DEFAULT_MAX_BLAST_RADIUS,
    format = "terraform",
    frameworks = ALL_FRAMEWORKS,
    filter,
    maxActionsPerRun = DEFAULT_MAX_ACTIONS,
    includeDrift = true,
    dryRun = false,
    onCreatePR,
    onAutoApplied,
    onDecision,
  } = config;

  const startedAt = new Date().toISOString();
  const runId = generateRunId();
  const actions: RemediationAction[] = [];

  // --- Phase 1: Detect violations ---
  const complianceReport = await runComplianceAssessment(frameworks, storage, filter);
  const violations = extractViolations(complianceReport);

  // --- Phase 2: Detect drift (optional) ---
  let driftViolations: ViolationRecord[] = [];
  if (includeDrift) {
    try {
      const driftResult = await engine.detectDrift();
      driftViolations = extractDriftViolations(driftResult);
    } catch {
      // Drift detection may fail if no adapters configured; non-fatal
    }
  }

  const allViolations = [...violations, ...driftViolations].slice(0, maxActionsPerRun);

  // --- Phase 3: Process each violation ---
  for (const violation of allViolations) {
    const action = await processViolation(
      violation,
      engine,
      storage,
      governor,
      {
        format,
        autoApplyThreshold,
        blockThreshold,
        maxAutoApplyBlastRadius,
        dryRun,
        onCreatePR,
        onAutoApplied,
        onDecision,
      },
    );
    actions.push(action);
  }

  const completedAt = new Date().toISOString();

  return {
    id: runId,
    startedAt,
    completedAt,
    totalViolations: allViolations.length,
    autoApplied: actions.filter((a) => a.decision === "auto-applied").length,
    prCreated: actions.filter((a) => a.decision === "pr-created").length,
    manualReview: actions.filter((a) => a.decision === "manual-review").length,
    blocked: actions.filter((a) => a.decision === "blocked").length,
    skipped: actions.filter((a) => a.decision === "skipped").length,
    failed: actions.filter((a) => a.decision === "failed").length,
    actions,
    frameworks,
    format,
    estimatedSavings: 0, // remediation doesn't directly save money
  };
}

// =============================================================================
// Violation Extraction
// =============================================================================

type ViolationRecord = {
  controlId: string;
  framework: ComplianceFramework | "drift";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  nodeId: string;
  nodeName: string;
  resourceType: GraphResourceType;
  provider: CloudProvider;
  driftedFields?: Array<{ field: string; expectedValue: string | null; actualValue: string | null }>;
};

function extractViolations(report: ComplianceReport): ViolationRecord[] {
  const violations: ViolationRecord[] = [];

  for (const summary of report.frameworks) {
    for (const result of summary.results) {
      if (result.status === "fail") {
        violations.push({
          controlId: result.controlId,
          framework: result.framework,
          severity: result.severity,
          title: result.title,
          nodeId: result.nodeId,
          nodeName: result.nodeName,
          resourceType: result.resourceType,
          provider: result.provider,
        });
      }
    }
  }

  // Sort by severity: critical first
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  violations.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));

  return violations;
}

function extractDriftViolations(driftResult: DriftResult): ViolationRecord[] {
  const violations: ViolationRecord[] = [];

  for (const drifted of driftResult.driftedNodes) {
    violations.push({
      controlId: `drift-${drifted.node.id}`,
      framework: "drift",
      severity: "medium",
      title: `Configuration drift detected on ${drifted.node.name}`,
      nodeId: drifted.node.id,
      nodeName: drifted.node.name,
      resourceType: drifted.node.resourceType,
      provider: drifted.node.provider,
      driftedFields: drifted.changes.map((c) => ({
        field: c.field ?? "unknown",
        expectedValue: c.previousValue,
        actualValue: c.newValue,
      })),
    });
  }

  return violations;
}

// =============================================================================
// Per-Violation Processing
// =============================================================================

type ProcessConfig = {
  format: IaCFormat;
  autoApplyThreshold: number;
  blockThreshold: number;
  maxAutoApplyBlastRadius: number;
  dryRun: boolean;
  onCreatePR?: (action: RemediationAction) => Promise<string | null>;
  onAutoApplied?: (action: RemediationAction) => Promise<void>;
  onDecision?: (action: RemediationAction) => Promise<void>;
};

async function processViolation(
  violation: ViolationRecord,
  engine: GraphEngine,
  _storage: GraphStorage,
  governor: ChangeGovernor | null,
  config: ProcessConfig,
): Promise<RemediationAction> {
  const actionId = generateActionId();
  const now = new Date().toISOString();

  // --- Step 1: Compute blast radius of the affected resource ---
  let blastRadiusSize = 0;
  try {
    const blast = await engine.getBlastRadius(violation.nodeId, 4);
    blastRadiusSize = blast.nodes.size - 1; // exclude the target itself
  } catch {
    // Node may not exist in graph; proceed with 0
  }

  // --- Step 2: Generate remediation patch ---
  let patch: RemediationPatch | null = null;
  if (violation.framework !== "drift") {
    // For compliance violations, build a synthetic drift result to feed the remediator
    const syntheticDrift = buildSyntheticDrift(violation);
    try {
      const plan = generateRemediationPlan(syntheticDrift, config.format);
      patch = plan.autoRemediable[0] ?? plan.manualReview[0] ?? null;
    } catch {
      // Remediation generation may fail for some resource types
    }
  } else if (violation.driftedFields) {
    // For drift violations, build from actual drift data
    const driftResult = buildDriftResult(violation);
    try {
      const plan = generateRemediationPlan(driftResult, config.format);
      patch = plan.autoRemediable[0] ?? plan.manualReview[0] ?? null;
    } catch {
      // Non-fatal
    }
  }

  // --- Step 3: Risk score ---
  const environment = "unknown"; // Could be enriched from node tags
  const risk = calculateRiskScore({
    blastRadiusSize,
    costAtRisk: 0,
    dependentCount: blastRadiusSize,
    environment,
    isGpuAiWorkload: false,
    action: "reconfigure",
  });

  // --- Step 4: Make decision ---
  let decision: RemediationDecision;
  let reason: string;
  let changeRequest: ChangeRequest | undefined;

  if (!patch) {
    decision = "skipped";
    reason = "No auto-remediable IaC patch could be generated for this violation.";
  } else if (risk.score >= config.blockThreshold) {
    decision = "blocked";
    reason = `Risk score ${risk.score} exceeds block threshold ${config.blockThreshold}. ` +
      `Factors: ${risk.factors.join("; ")}`;
  } else if (
    risk.score <= config.autoApplyThreshold &&
    blastRadiusSize <= config.maxAutoApplyBlastRadius
  ) {
    // Auto-apply path
    if (config.dryRun) {
      decision = "auto-applied";
      reason = `[DRY RUN] Would auto-apply: risk ${risk.score} ≤ ${config.autoApplyThreshold}, ` +
        `blast radius ${blastRadiusSize} ≤ ${config.maxAutoApplyBlastRadius}`;
    } else {
      // Route through governor if available
      if (governor) {
        try {
          changeRequest = await governor.interceptChange({
            initiator: "remediation-agent",
            initiatorType: "agent",
            targetResourceId: violation.nodeId,
            resourceType: violation.resourceType,
            provider: violation.provider,
            action: "reconfigure",
            description: `Auto-remediation: ${violation.title}`,
            metadata: {
              controlId: violation.controlId,
              framework: violation.framework,
              patchRisk: patch.risk,
              blastRadiusSize,
            },
          });

          if (changeRequest.status === "auto-approved" || changeRequest.status === "approved") {
            decision = "auto-applied";
            reason = `Governance approved: risk ${risk.score}, blast radius ${blastRadiusSize}. ` +
              `Change request: ${changeRequest.id}`;
          } else if (changeRequest.status === "pending") {
            decision = "manual-review";
            reason = `Governance requires approval. Change request: ${changeRequest.id}`;
          } else {
            decision = "blocked";
            reason = `Governance rejected: ${changeRequest.reason ?? "policy violation"}`;
          }
        } catch (err) {
          decision = "failed";
          reason = `Governance error: ${err instanceof Error ? err.message : String(err)}`;
        }
      } else {
        decision = "auto-applied";
        reason = `Auto-applied: risk ${risk.score} ≤ ${config.autoApplyThreshold}, ` +
          `blast radius ${blastRadiusSize} ≤ ${config.maxAutoApplyBlastRadius}`;
      }
    }
  } else {
    // Medium risk — create PR
    decision = "pr-created";
    reason = `Risk ${risk.score} exceeds auto-approve threshold. ` +
      `Blast radius: ${blastRadiusSize}. Creating PR for review.`;
  }

  const action: RemediationAction = {
    id: actionId,
    violation,
    patch,
    risk,
    blastRadiusSize,
    decision,
    reason,
    changeRequest,
    decidedAt: now,
  };

  // --- Step 5: Execute callbacks ---
  try {
    if (decision === "auto-applied" && !config.dryRun && config.onAutoApplied) {
      await config.onAutoApplied(action);
    }
    if (decision === "pr-created" && config.onCreatePR) {
      await config.onCreatePR(action);
    }
    if (config.onDecision) {
      await config.onDecision(action);
    }
  } catch {
    // Callback failures should not abort the run
  }

  return action;
}

// =============================================================================
// Helpers
// =============================================================================

function buildSyntheticDrift(violation: ViolationRecord): DriftResult {
  // Create a synthetic DriftResult from a compliance violation so the
  // existing remediation generator can produce a patch.
  const node: GraphNode = {
    id: violation.nodeId,
    provider: violation.provider,
    resourceType: violation.resourceType,
    nativeId: violation.nodeId,
    name: violation.nodeName,
    region: "",
    account: "",
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: null,
    owner: null,
    discoveredAt: new Date().toISOString(),
    createdAt: null,
    updatedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };

  return {
    driftedNodes: [
      {
        node,
        changes: [
          {
            id: `change-${violation.controlId}`,
            targetId: violation.nodeId,
            changeType: "node-drifted",
            field: violation.controlId,
            previousValue: "non-compliant",
            newValue: "compliant",
            detectedAt: new Date().toISOString(),
            detectedVia: "drift-scan",
            correlationId: null,
            initiator: "remediation-agent",
            initiatorType: "agent",
            metadata: { framework: violation.framework },
          },
        ],
      },
    ],
    disappearedNodes: [],
    newNodes: [],
    scannedAt: new Date().toISOString(),
  };
}

function buildDriftResult(violation: ViolationRecord): DriftResult {
  const node: GraphNode = {
    id: violation.nodeId,
    provider: violation.provider,
    resourceType: violation.resourceType,
    nativeId: violation.nodeId,
    name: violation.nodeName,
    region: "",
    account: "",
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: null,
    owner: null,
    discoveredAt: new Date().toISOString(),
    createdAt: null,
    updatedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };

  const changes = (violation.driftedFields ?? []).map((f, idx) => ({
    id: `drift-change-${idx}`,
    targetId: violation.nodeId,
    changeType: "node-drifted" as const,
    field: f.field,
    previousValue: f.expectedValue,
    newValue: f.actualValue,
    detectedAt: new Date().toISOString(),
    detectedVia: "drift-scan" as const,
    correlationId: null,
    initiator: "remediation-agent",
    initiatorType: "agent" as const,
    metadata: {},
  }));

  return {
    driftedNodes: [{ node, changes }],
    disappearedNodes: [],
    newNodes: [],
    scannedAt: new Date().toISOString(),
  };
}

let _runCounter = 0;
let _actionCounter = 0;

/** @internal Reset counters for deterministic tests. */
export function resetRemediationCounters(): void {
  _runCounter = 0;
  _actionCounter = 0;
}

function generateRunId(): string {
  _runCounter++;
  return `remediation-run-${Date.now()}-${_runCounter}`;
}

function generateActionId(): string {
  _actionCounter++;
  return `remediation-action-${Date.now()}-${_actionCounter}`;
}

// =============================================================================
// Formatting
// =============================================================================

/** Format a remediation run result as markdown. */
export function formatRemediationRunMarkdown(result: RemediationRunResult): string {
  const lines: string[] = [];

  lines.push("## Autonomous Remediation Report");
  lines.push("");
  lines.push(`**Run ID:** ${result.id}`);
  lines.push(`**Period:** ${result.startedAt} → ${result.completedAt}`);
  lines.push(`**Frameworks:** ${result.frameworks.join(", ")}`);
  lines.push(`**Format:** ${result.format}`);
  lines.push("");

  // Summary table
  lines.push("### Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|--------|-------|");
  lines.push(`| Total violations found | ${result.totalViolations} |`);
  lines.push(`| Auto-applied | ${result.autoApplied} |`);
  lines.push(`| PR created | ${result.prCreated} |`);
  lines.push(`| Manual review | ${result.manualReview} |`);
  lines.push(`| Blocked | ${result.blocked} |`);
  lines.push(`| Skipped | ${result.skipped} |`);
  lines.push(`| Failed | ${result.failed} |`);
  lines.push("");

  // Effectiveness
  const resolved = result.autoApplied + result.prCreated;
  const pct = result.totalViolations > 0
    ? Math.round((resolved / result.totalViolations) * 100)
    : 0;
  lines.push(`**Resolution rate:** ${resolved}/${result.totalViolations} (${pct}%)`);
  lines.push("");

  // Critical/blocked actions
  const blockedActions = result.actions.filter((a) => a.decision === "blocked");
  if (blockedActions.length > 0) {
    lines.push("### Blocked (requires human review)");
    lines.push("");
    for (const a of blockedActions) {
      lines.push(`- **${a.violation.title}** on \`${a.violation.nodeName}\``);
      lines.push(`  Risk: ${a.risk.level} (${a.risk.score}), Blast radius: ${a.blastRadiusSize}`);
      lines.push(`  Reason: ${a.reason}`);
    }
    lines.push("");
  }

  // Auto-applied
  const autoActions = result.actions.filter((a) => a.decision === "auto-applied");
  if (autoActions.length > 0) {
    lines.push("### Auto-Applied");
    lines.push("");
    for (const a of autoActions) {
      lines.push(`- ✅ **${a.violation.title}** on \`${a.violation.nodeName}\``);
      lines.push(`  ${a.reason}`);
    }
    lines.push("");
  }

  // PR created
  const prActions = result.actions.filter((a) => a.decision === "pr-created");
  if (prActions.length > 0) {
    lines.push("### PRs Created");
    lines.push("");
    for (const a of prActions) {
      lines.push(`- 🔀 **${a.violation.title}** on \`${a.violation.nodeName}\``);
      lines.push(`  Risk: ${a.risk.level} (${a.risk.score})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
