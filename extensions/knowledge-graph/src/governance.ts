/**
 * Infrastructure Knowledge Graph — Agent Governance Layer
 *
 * Intercepts infrastructure change requests from AI agents (and humans),
 * scores their risk, routes high-risk operations through approval gates,
 * and maintains a full audit trail of every action.
 *
 * Design:
 *   - Every change request is recorded (append-only) regardless of outcome.
 *   - Risk is scored using blast radius, cost impact, dependent count,
 *     environment classification, GPU/AI workload flags, and time-of-day.
 *   - Low-risk changes are auto-approved; high-risk changes block until
 *     an authorized human approves or rejects.
 *   - Policy pre-checks use the existing policy-scan bridge to validate
 *     constraints before execution.
 */

import type {
  GraphStorage,
  GraphChange,
  GraphNode,
  CloudProvider,
  GraphResourceType,
} from "./types.js";
import type { GraphEngine } from "./engine.js";

// =============================================================================
// Types
// =============================================================================

/** Risk level thresholds. */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Result of a risk assessment on a proposed change. */
export type RiskAssessment = {
  /** Numeric score 0–100. */
  score: number;
  /** Bucketed risk level. */
  level: RiskLevel;
  /** Human-readable explanations for each scoring factor. */
  factors: string[];
};

/** Status of a change request in the approval pipeline. */
export type ChangeRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "auto-approved";

/**
 * A structured request to modify infrastructure.
 * Created before execution, resolved after approval/rejection.
 */
export type ChangeRequest = {
  /** Unique request ID. */
  id: string;
  /** Who (or what) initiated the change. */
  initiator: string;
  /** Whether the initiator is a human, AI agent, or system process. */
  initiatorType: "human" | "agent" | "system";
  /** Graph node ID of the target resource (may not exist yet for creates). */
  targetResourceId: string;
  /** Resource type being affected. */
  resourceType: GraphResourceType;
  /** Cloud provider. */
  provider: CloudProvider;
  /** The action being requested. */
  action: "create" | "update" | "delete" | "scale" | "reconfigure";
  /** Free-form description of the intended change. */
  description: string;
  /** Computed risk assessment. */
  risk: RiskAssessment;
  /** Current status in the approval pipeline. */
  status: ChangeRequestStatus;
  /** When the request was created. */
  createdAt: string;
  /** When the request was resolved (approved/rejected). */
  resolvedAt: string | null;
  /** Who resolved the request (null for auto-approved). */
  resolvedBy: string | null;
  /** Reason for approval/rejection. */
  reason: string | null;
  /** Policy violations detected during pre-check. */
  policyViolations: string[];
  /** Additional context. */
  metadata: Record<string, unknown>;
};

/** Options for querying the audit trail. */
export type AuditQuery = {
  /** Filter by initiator identity. */
  initiator?: string;
  /** Filter by initiator type. */
  initiatorType?: "human" | "agent" | "system";
  /** Filter by target resource. */
  targetResourceId?: string;
  /** Filter by action type. */
  action?: ChangeRequest["action"];
  /** Filter by status. */
  status?: ChangeRequestStatus;
  /** Changes after this timestamp. */
  since?: string;
  /** Changes before this timestamp. */
  until?: string;
  /** Maximum results. */
  limit?: number;
};

/** Summary of governance activity for dashboards. */
export type GovernanceSummary = {
  totalRequests: number;
  byStatus: Record<ChangeRequestStatus, number>;
  byInitiator: Record<string, number>;
  byRiskLevel: Record<RiskLevel, number>;
  policyViolationCount: number;
  avgRiskScore: number;
  period: { since: string; until: string };
};

/** Configuration for the change governor. */
export type GovernorConfig = {
  /** Risk score threshold for auto-approval (changes at or below are auto-approved). */
  autoApproveThreshold: number;
  /** Risk score threshold for blocking (changes above require manual approval). */
  blockThreshold: number;
  /** Whether to run policy pre-checks before approval. */
  enablePolicyChecks: boolean;
  /** Whether to allow auto-approval for agent-initiated changes. */
  allowAgentAutoApprove: boolean;
  /** Maximum blast radius (node count) for auto-approval. */
  maxAutoApproveBlastRadius: number;
  /** Environments that always require manual approval. */
  protectedEnvironments: string[];
  /** Resource types that always require manual approval. */
  protectedResourceTypes: GraphResourceType[];
};

export const defaultGovernorConfig: GovernorConfig = {
  autoApproveThreshold: 30,
  blockThreshold: 70,
  enablePolicyChecks: true,
  allowAgentAutoApprove: true,
  maxAutoApproveBlastRadius: 5,
  protectedEnvironments: ["production", "prod"],
  protectedResourceTypes: [],
};

// =============================================================================
// Risk Scoring
// =============================================================================

/** Weights for each risk factor (sum to ~100 at max). */
const RISK_WEIGHTS = {
  blastRadius: 25,
  costImpact: 20,
  dependentCount: 15,
  environment: 20,
  gpuAiWorkload: 10,
  timeOfDay: 5,
  destructiveAction: 5,
} as const;

/**
 * Calculate a risk score (0–100) for a proposed infrastructure change.
 *
 * Factors:
 *   - Blast radius: how many resources are transitively affected
 *   - Cost impact: monthly cost of the target + downstream resources
 *   - Dependent count: number of direct dependents
 *   - Environment: production gets higher risk
 *   - GPU/AI workload: elevated risk for expensive AI resources
 *   - Time of day: changes outside business hours get a small bump
 *   - Destructive action: deletes are riskier than updates
 */
export function calculateRiskScore(params: {
  /** Number of nodes in the blast radius. */
  blastRadiusSize: number;
  /** Total monthly cost at risk ($). */
  costAtRisk: number;
  /** Number of direct downstream dependents. */
  dependentCount: number;
  /** Environment tags (e.g. "production", "staging", "dev"). */
  environment: string | null;
  /** Whether the target is a GPU/AI workload. */
  isGpuAiWorkload: boolean;
  /** The action being performed. */
  action: ChangeRequest["action"];
  /** Hour of day (0–23) in the operator's timezone. */
  hourOfDay?: number;
}): RiskAssessment {
  const factors: string[] = [];
  let score = 0;

  // 1. Blast radius (0–25)
  const brScore = Math.min(params.blastRadiusSize / 20, 1) * RISK_WEIGHTS.blastRadius;
  score += brScore;
  if (params.blastRadiusSize > 0) {
    factors.push(
      `Blast radius: ${params.blastRadiusSize} resources affected (${brScore.toFixed(1)} pts)`,
    );
  }

  // 2. Cost impact (0–20)
  // $0 = 0 pts, $500/mo = 10 pts, $5000+/mo = 20 pts (log scale)
  const costScore =
    params.costAtRisk > 0
      ? Math.min(Math.log10(params.costAtRisk + 1) / Math.log10(5000), 1) *
        RISK_WEIGHTS.costImpact
      : 0;
  score += costScore;
  if (params.costAtRisk > 0) {
    factors.push(
      `Cost at risk: $${params.costAtRisk.toFixed(2)}/mo (${costScore.toFixed(1)} pts)`,
    );
  }

  // 3. Dependent count (0–15)
  const depScore = Math.min(params.dependentCount / 10, 1) * RISK_WEIGHTS.dependentCount;
  score += depScore;
  if (params.dependentCount > 0) {
    factors.push(
      `Direct dependents: ${params.dependentCount} (${depScore.toFixed(1)} pts)`,
    );
  }

  // 4. Environment (0–20)
  const env = (params.environment ?? "").toLowerCase();
  let envScore = 0;
  if (env.includes("prod")) {
    envScore = RISK_WEIGHTS.environment;
    factors.push(`Production environment (+${envScore} pts)`);
  } else if (env.includes("stag")) {
    envScore = RISK_WEIGHTS.environment * 0.5;
    factors.push(`Staging environment (+${envScore.toFixed(1)} pts)`);
  } else if (env === "" || env === "unknown") {
    envScore = RISK_WEIGHTS.environment * 0.3;
    factors.push(`Unknown environment (+${envScore.toFixed(1)} pts)`);
  }
  score += envScore;

  // 5. GPU/AI workload (0–10)
  if (params.isGpuAiWorkload) {
    score += RISK_WEIGHTS.gpuAiWorkload;
    factors.push(`GPU/AI workload (+${RISK_WEIGHTS.gpuAiWorkload} pts)`);
  }

  // 6. Time of day (0–5)
  if (params.hourOfDay != null) {
    const h = params.hourOfDay;
    if (h < 6 || h > 22) {
      score += RISK_WEIGHTS.timeOfDay;
      factors.push(`Off-hours change (+${RISK_WEIGHTS.timeOfDay} pts)`);
    }
  }

  // 7. Destructive action (0–5)
  if (params.action === "delete") {
    score += RISK_WEIGHTS.destructiveAction;
    factors.push(`Destructive action: delete (+${RISK_WEIGHTS.destructiveAction} pts)`);
  }

  // Clamp to 0–100
  score = Math.min(Math.max(Math.round(score), 0), 100);

  // Determine level
  let level: RiskLevel;
  if (score <= 20) level = "low";
  else if (score <= 50) level = "medium";
  else if (score <= 75) level = "high";
  else level = "critical";

  return { score, level, factors };
}

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `cr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Detect GPU/AI workload from resource type and metadata.
 */
function isGpuOrAiResource(node: GraphNode | null): boolean {
  if (!node) return false;
  const rt = node.resourceType;
  const gpuTypes: string[] = [
    "sagemaker-endpoint",
    "sagemaker-notebook",
    "bedrock-model",
    "gpu-instance",
    "eks-cluster", // often runs GPU workloads
  ];
  if (gpuTypes.includes(rt)) return true;

  // Check instance type metadata for GPU indicators
  const instanceType = String(node.metadata?.instanceType ?? "");
  if (/^(p[2-5]|g[4-6]|inf[12]|trn[12]|dl[12])\./i.test(instanceType)) return true;

  // Check tags
  const tags = node.tags ?? {};
  if (tags["gpu"] || tags["ai-workload"] || tags["ml-workload"]) return true;

  return false;
}

/**
 * Extract environment from node tags or metadata.
 */
function detectEnvironment(node: GraphNode | null): string | null {
  if (!node) return null;
  const tags = node.tags ?? {};
  return (
    tags["Environment"] ??
    tags["environment"] ??
    tags["env"] ??
    tags["Env"] ??
    tags["stage"] ??
    tags["Stage"] ??
    (node.metadata?.environment as string) ??
    null
  );
}

// =============================================================================
// Change Governor
// =============================================================================

/**
 * The Change Governor intercepts infrastructure modification requests,
 * assesses their risk, applies policy pre-checks, and routes them
 * through the appropriate approval path.
 *
 * Usage:
 *   const governor = new ChangeGovernor(engine, storage, config);
 *   const request = await governor.interceptChange({ ... });
 *   if (request.status === "pending") {
 *     // wait for human approval
 *     await governor.approveChange(request.id, "ops-lead", "Reviewed blast radius");
 *   }
 */
export class ChangeGovernor {
  private engine: GraphEngine;
  private storage: GraphStorage;
  private config: GovernorConfig;

  /** In-memory index of pending change requests (backed by storage changes). */
  private requests: Map<string, ChangeRequest> = new Map();

  /** Registered approval notification callbacks. */
  private notifiers: Array<(request: ChangeRequest) => Promise<void>> = [];

  constructor(
    engine: GraphEngine,
    storage: GraphStorage,
    config?: Partial<GovernorConfig>,
  ) {
    this.engine = engine;
    this.storage = storage;
    this.config = { ...defaultGovernorConfig, ...config };
  }

  /**
   * Register a callback to be notified when a change requires approval.
   * Used by channel integrations (Slack, Teams, CLI) to send approval prompts.
   */
  onApprovalRequired(callback: (request: ChangeRequest) => Promise<void>): void {
    this.notifiers.push(callback);
  }

  /**
   * Intercept a proposed infrastructure change.
   *
   * 1. Look up the target resource in the graph
   * 2. Compute blast radius and risk score
   * 3. Run policy pre-checks
   * 4. Auto-approve or block for manual approval
   * 5. Record in the audit trail
   */
  async interceptChange(params: {
    initiator: string;
    initiatorType: "human" | "agent" | "system";
    targetResourceId: string;
    resourceType: GraphResourceType;
    provider: CloudProvider;
    action: ChangeRequest["action"];
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChangeRequest> {
    // Look up target node (may not exist for creates)
    const targetNode = await this.storage.getNode(params.targetResourceId);

    // Compute blast radius
    const blastRadius = await this.engine.getBlastRadius(params.targetResourceId, 3);
    const blastRadiusSize = blastRadius.nodes.size;
    const costAtRisk = blastRadius.totalCostMonthly;

    // Count direct dependents
    const downstreamEdges = await this.storage.getEdgesForNode(
      params.targetResourceId,
      "downstream",
    );
    const dependentCount = downstreamEdges.length;

    // Detect environment and GPU/AI
    const environment = detectEnvironment(targetNode);
    const isGpu = isGpuOrAiResource(targetNode);

    // Calculate risk
    const risk = calculateRiskScore({
      blastRadiusSize,
      costAtRisk,
      dependentCount,
      environment,
      isGpuAiWorkload: isGpu,
      action: params.action,
      hourOfDay: new Date().getHours(),
    });

    // Run policy pre-checks
    const policyViolations: string[] = [];
    if (this.config.enablePolicyChecks) {
      policyViolations.push(...this.runPolicyPreChecks(params, targetNode));
    }

    // Determine approval status
    let status: ChangeRequestStatus;
    if (policyViolations.length > 0) {
      // Policy violations always block
      status = "pending";
    } else if (this.isProtected(params, environment)) {
      // Protected environments/resources always require approval
      status = "pending";
    } else if (risk.score <= this.config.autoApproveThreshold) {
      // Low risk: auto-approve
      if (params.initiatorType === "agent" && !this.config.allowAgentAutoApprove) {
        status = "pending";
      } else if (blastRadiusSize > this.config.maxAutoApproveBlastRadius) {
        status = "pending";
      } else {
        status = "auto-approved";
      }
    } else if (risk.score > this.config.blockThreshold) {
      // High risk: always require approval
      status = "pending";
    } else {
      // Medium risk: auto-approve humans, block agents
      status = params.initiatorType === "human" ? "auto-approved" : "pending";
    }

    const request: ChangeRequest = {
      id: generateId(),
      initiator: params.initiator,
      initiatorType: params.initiatorType,
      targetResourceId: params.targetResourceId,
      resourceType: params.resourceType,
      provider: params.provider,
      action: params.action,
      description: params.description,
      risk,
      status,
      createdAt: now(),
      resolvedAt: status === "auto-approved" ? now() : null,
      resolvedBy: status === "auto-approved" ? "system" : null,
      reason: status === "auto-approved" ? "Low risk — auto-approved" : null,
      policyViolations,
      metadata: {
        ...params.metadata,
        blastRadiusSize,
        costAtRisk,
        dependentCount,
        environment,
        isGpuAiWorkload: isGpu,
      },
    };

    // Store in memory
    this.requests.set(request.id, request);

    // Record in graph change log (audit trail)
    await this.recordAuditEntry(request);

    // Notify approval channels if pending
    if (status === "pending") {
      for (const notify of this.notifiers) {
        try {
          await notify(request);
        } catch {
          // Swallow notification errors — don't block the pipeline
        }
      }
    }

    return request;
  }

  /**
   * Approve a pending change request.
   */
  async approveChange(
    requestId: string,
    approvedBy: string,
    reason?: string,
  ): Promise<ChangeRequest | null> {
    const request = this.requests.get(requestId);
    if (!request || request.status !== "pending") return null;

    request.status = "approved";
    request.resolvedAt = now();
    request.resolvedBy = approvedBy;
    request.reason = reason ?? "Manually approved";

    // Record approval in audit trail
    await this.storage.appendChange({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      targetId: request.targetResourceId,
      changeType: "node-updated",
      field: "governance:approval",
      previousValue: "pending",
      newValue: "approved",
      detectedAt: now(),
      detectedVia: "manual",
      correlationId: request.id,
      initiator: approvedBy,
      initiatorType: "human",
      metadata: {
        requestId: request.id,
        reason: request.reason,
        riskScore: request.risk.score,
        riskLevel: request.risk.level,
      },
    });

    return request;
  }

  /**
   * Reject a pending change request.
   */
  async rejectChange(
    requestId: string,
    rejectedBy: string,
    reason: string,
  ): Promise<ChangeRequest | null> {
    const request = this.requests.get(requestId);
    if (!request || request.status !== "pending") return null;

    request.status = "rejected";
    request.resolvedAt = now();
    request.resolvedBy = rejectedBy;
    request.reason = reason;

    // Record rejection in audit trail
    await this.storage.appendChange({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      targetId: request.targetResourceId,
      changeType: "node-updated",
      field: "governance:rejection",
      previousValue: "pending",
      newValue: "rejected",
      detectedAt: now(),
      detectedVia: "manual",
      correlationId: request.id,
      initiator: rejectedBy,
      initiatorType: "human",
      metadata: {
        requestId: request.id,
        reason,
        riskScore: request.risk.score,
        riskLevel: request.risk.level,
      },
    });

    return request;
  }

  /**
   * Get a change request by ID.
   */
  getRequest(requestId: string): ChangeRequest | null {
    return this.requests.get(requestId) ?? null;
  }

  /**
   * Query the audit trail of change requests.
   */
  getAuditTrail(query: AuditQuery): ChangeRequest[] {
    let results = Array.from(this.requests.values());

    if (query.initiator) {
      results = results.filter((r) => r.initiator === query.initiator);
    }
    if (query.initiatorType) {
      results = results.filter((r) => r.initiatorType === query.initiatorType);
    }
    if (query.targetResourceId) {
      results = results.filter((r) => r.targetResourceId === query.targetResourceId);
    }
    if (query.action) {
      results = results.filter((r) => r.action === query.action);
    }
    if (query.status) {
      results = results.filter((r) => r.status === query.status);
    }
    if (query.since) {
      results = results.filter((r) => r.createdAt >= query.since!);
    }
    if (query.until) {
      results = results.filter((r) => r.createdAt <= query.until!);
    }

    // Sort newest first
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Get all pending requests awaiting approval.
   */
  getPendingRequests(): ChangeRequest[] {
    return Array.from(this.requests.values()).filter((r) => r.status === "pending");
  }

  /**
   * Generate a governance summary for a time period.
   */
  getSummary(since?: string, until?: string): GovernanceSummary {
    const periodSince = since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const periodUntil = until ?? now();

    const requests = this.getAuditTrail({ since: periodSince, until: periodUntil });

    const byStatus: Record<ChangeRequestStatus, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      "auto-approved": 0,
    };
    const byInitiator: Record<string, number> = {};
    const byRiskLevel: Record<RiskLevel, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    let policyViolationCount = 0;
    let totalRiskScore = 0;

    for (const req of requests) {
      byStatus[req.status]++;
      byInitiator[req.initiator] = (byInitiator[req.initiator] ?? 0) + 1;
      byRiskLevel[req.risk.level]++;
      totalRiskScore += req.risk.score;
      if (req.policyViolations.length > 0) policyViolationCount++;
    }

    return {
      totalRequests: requests.length,
      byStatus,
      byInitiator,
      byRiskLevel,
      policyViolationCount,
      avgRiskScore: requests.length > 0 ? Math.round(totalRiskScore / requests.length) : 0,
      period: { since: periodSince, until: periodUntil },
    };
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  /**
   * Check if the change targets a protected environment or resource type.
   */
  private isProtected(
    params: { provider: CloudProvider; resourceType: GraphResourceType },
    environment: string | null,
  ): boolean {
    // Protected environments
    if (environment) {
      const envLower = environment.toLowerCase();
      if (this.config.protectedEnvironments.some((pe) => envLower.includes(pe))) {
        return true;
      }
    }

    // Protected resource types
    if (this.config.protectedResourceTypes.includes(params.resourceType)) {
      return true;
    }

    return false;
  }

  /**
   * Run lightweight policy pre-checks before approval.
   * Returns an array of violation descriptions.
   */
  private runPolicyPreChecks(
    params: {
      action: ChangeRequest["action"];
      resourceType: GraphResourceType;
      provider: CloudProvider;
    },
    targetNode: GraphNode | null,
  ): string[] {
    const violations: string[] = [];

    // GPU instances must have cost tags
    if (
      isGpuOrAiResource(targetNode) &&
      params.action !== "delete"
    ) {
      const tags = targetNode?.tags ?? {};
      if (!tags["CostCenter"] && !tags["cost-center"] && !tags["CostAllocation"]) {
        violations.push("GPU/AI workloads must have a cost allocation tag (CostCenter or cost-center)");
      }
    }

    // S3 buckets: check for public access (if metadata available)
    if (
      params.resourceType === "storage" &&
      targetNode?.metadata?.publicAccessEnabled === true
    ) {
      violations.push("Storage resource has public access enabled — review required");
    }

    // Deletes of resources with high dependent count
    if (params.action === "delete" && targetNode) {
      const costThreshold = 1000;
      if ((targetNode.costMonthly ?? 0) > costThreshold) {
        violations.push(
          `Deleting resource with cost > $${costThreshold}/mo requires review`,
        );
      }
    }

    return violations;
  }

  /**
   * Record a change request in the graph's append-only change log.
   */
  private async recordAuditEntry(request: ChangeRequest): Promise<void> {
    const change: GraphChange = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      targetId: request.targetResourceId,
      changeType: this.actionToChangeType(request.action),
      field: `governance:${request.action}`,
      previousValue: null,
      newValue: JSON.stringify({
        requestId: request.id,
        status: request.status,
        risk: request.risk,
        description: request.description,
      }),
      detectedAt: request.createdAt,
      detectedVia: "manual",
      correlationId: request.id,
      initiator: request.initiator,
      initiatorType: request.initiatorType,
      metadata: {
        governanceRequest: true,
        action: request.action,
        riskScore: request.risk.score,
        riskLevel: request.risk.level,
        status: request.status,
        policyViolations: request.policyViolations,
      },
    };

    await this.storage.appendChange(change);
  }

  /**
   * Map a change request action to a graph change type.
   */
  private actionToChangeType(
    action: ChangeRequest["action"],
  ): GraphChange["changeType"] {
    switch (action) {
      case "create":
        return "node-created";
      case "delete":
        return "node-deleted";
      case "update":
      case "scale":
      case "reconfigure":
        return "node-updated";
    }
  }
}
