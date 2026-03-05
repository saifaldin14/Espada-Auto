/**
 * Governance — Approval Gate
 *
 * Integrates with ExecApprovalManager to require human approval
 * before destructive migration operations. Supports configurable
 * approval policies, timeout, and escalation.
 */

import type { MigrationStep, MigrationPhase } from "../types.js";

// =============================================================================
// Approval Types
// =============================================================================

export interface ApprovalPolicy {
  /** Steps that always require approval */
  alwaysRequire: string[];
  /** Phases that require approval to enter */
  phaseGates: MigrationPhase[];
  /** Cost threshold (USD) above which approval is required */
  costThreshold: number;
  /** Data volume threshold (GB) above which approval is required */
  dataThresholdGB: number;
  /** Timeout for approval response (ms) */
  timeoutMs: number;
  /** Auto-approve in dry-run mode */
  autoApproveInDryRun: boolean;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  alwaysRequire: [
    "cutover",
    "provision-vm",
    "import-image",
    "create-target-bucket",
  ],
  phaseGates: [
    "executing",
    "cutting-over",
  ],
  costThreshold: 1000,
  dataThresholdGB: 100,
  timeoutMs: 3600000, // 1 hour
  autoApproveInDryRun: true,
};

export interface ApprovalRequest {
  id: string;
  jobId: string;
  stepId?: string;
  phase?: MigrationPhase;
  type: "step-execution" | "phase-transition" | "cost-approval" | "data-volume";
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  metadata: Record<string, unknown>;
  requestedAt: string;
  requestedBy: string;
  timeoutMs: number;
}

export interface ApprovalDecision {
  requestId: string;
  approved: boolean;
  decidedBy: string;
  decidedAt: string;
  reason?: string;
}

// =============================================================================
// Approval Gate
// =============================================================================

/**
 * Check if a step requires approval based on the policy.
 */
export function requiresApproval(
  step: MigrationStep,
  policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY,
): boolean {
  return policy.alwaysRequire.includes(step.type);
}

/**
 * Check if a phase transition requires approval.
 */
export function requiresPhaseApproval(
  phase: MigrationPhase,
  policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY,
): boolean {
  return policy.phaseGates.includes(phase);
}

/**
 * Check if the estimated cost exceeds the approval threshold.
 */
export function requiresCostApproval(
  estimatedCostUSD: number,
  policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY,
): boolean {
  return estimatedCostUSD > policy.costThreshold;
}

/**
 * Create an approval request.
 */
export function createApprovalRequest(params: {
  jobId: string;
  stepId?: string;
  phase?: MigrationPhase;
  type: ApprovalRequest["type"];
  description: string;
  riskLevel: ApprovalRequest["riskLevel"];
  metadata?: Record<string, unknown>;
  requestedBy?: string;
  policy?: ApprovalPolicy;
}): ApprovalRequest {
  const policy = params.policy ?? DEFAULT_APPROVAL_POLICY;

  return {
    id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    jobId: params.jobId,
    stepId: params.stepId,
    phase: params.phase,
    type: params.type,
    description: params.description,
    riskLevel: params.riskLevel,
    metadata: params.metadata ?? {},
    requestedAt: new Date().toISOString(),
    requestedBy: params.requestedBy ?? "system",
    timeoutMs: policy.timeoutMs,
  };
}

/**
 * Evaluate the risk level based on migration parameters.
 */
export function evaluateRiskLevel(params: {
  estimatedCostUSD: number;
  dataVolumeGB: number;
  vmCount: number;
  hasDatabase: boolean;
  isProduction: boolean;
}): ApprovalRequest["riskLevel"] {
  if (params.isProduction && (params.hasDatabase || params.vmCount > 10)) {
    return "critical";
  }
  if (params.estimatedCostUSD > 10000 || params.dataVolumeGB > 1000) {
    return "high";
  }
  if (params.vmCount > 5 || params.dataVolumeGB > 100) {
    return "medium";
  }
  return "low";
}
