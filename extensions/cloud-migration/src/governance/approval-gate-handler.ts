/**
 * Governance Step — Approval Gate
 *
 * Step handler that pauses the migration pipeline until a human (or
 * automated policy) grants approval. Integrates with the governance
 * module's ApprovalPolicy system.
 *
 * Behavior:
 * - Evaluates the approval policy to determine if this step requires approval
 * - Creates an approval request with risk metadata
 * - Polls for an approval decision until timeout or signal abort
 * - In dry-run mode, auto-approves immediately
 * - Supports auto-approval for low-risk steps when configured
 */

import type { MigrationStepHandler, MigrationStepContext, MigrationPhase } from "../types.js";
import {
  type ApprovalPolicy,
  type ApprovalRequest,
  type ApprovalDecision,
  DEFAULT_APPROVAL_POLICY,
  createApprovalRequest,
  evaluateRiskLevel,
} from "./approval-gate.js";
import { getAuditLogger } from "./audit-logger.js";

// =============================================================================
// Types
// =============================================================================

export interface ApprovalGateParams {
  /** Migration job ID. */
  jobId: string;
  /** Step that triggered this gate (e.g., "cutover", "provision-vm"). */
  gatedStepId?: string;
  /** Phase transition requiring approval. */
  gatedPhase?: string;
  /** Description of what is being approved. */
  description?: string;
  /** Type of approval gate. */
  gateType?: ApprovalRequest["type"];
  /** Estimated cost (USD) of the gated operation. */
  estimatedCostUSD?: number;
  /** Estimated data volume (GB) of the gated operation. */
  estimatedDataVolumeGB?: number;
  /** Number of VMs being migrated. */
  vmCount?: number;
  /** Whether the workload includes databases. */
  hasDatabase?: boolean;
  /** Whether this is a production workload. */
  isProduction?: boolean;
  /** Whether to auto-approve (e.g., in dry-run or test mode). */
  autoApprove?: boolean;
  /** Custom approval policy overrides. */
  approvalPolicy?: Partial<ApprovalPolicy>;
  /** Identity of the person requesting. */
  requestedBy?: string;
  /** Poll interval for checking approval status (ms). */
  pollIntervalMs?: number;
  /** Callback URL or channel for approval notification. */
  notificationChannel?: string;
}

interface ApprovalGateResult {
  approved: boolean;
  requestId: string;
  riskLevel: string;
  decidedBy: string;
  decidedAt: string;
  reason?: string;
  waitDurationMs: number;
  autoApproved: boolean;
}

// =============================================================================
// In-Memory Approval Store
// =============================================================================

/**
 * In-memory store for pending approval requests.
 * In production, this would be backed by a database or external service.
 * External systems can call `submitApprovalDecision()` to approve/reject.
 */
const pendingApprovals = new Map<string, ApprovalRequest>();
const approvalDecisions = new Map<string, ApprovalDecision>();

/**
 * Submit an approval decision for a pending request.
 * Called by external webhook, CLI, or UI integration.
 */
export function submitApprovalDecision(decision: ApprovalDecision): boolean {
  const request = pendingApprovals.get(decision.requestId);
  if (!request) return false;

  approvalDecisions.set(decision.requestId, decision);
  pendingApprovals.delete(decision.requestId);
  return true;
}

/**
 * Get all pending approval requests.
 */
export function getPendingApprovals(): ApprovalRequest[] {
  return [...pendingApprovals.values()];
}

/**
 * Clear all pending approvals and decisions (for testing).
 */
export function resetApprovalStore(): void {
  pendingApprovals.clear();
  approvalDecisions.clear();
}

// =============================================================================
// Step Handler
// =============================================================================

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as ApprovalGateParams;
  const start = Date.now();

  // Merge custom policy with defaults
  const policy: ApprovalPolicy = {
    ...DEFAULT_APPROVAL_POLICY,
    ...params.approvalPolicy,
  };

  // Evaluate risk level
  const riskLevel = evaluateRiskLevel({
    estimatedCostUSD: params.estimatedCostUSD ?? 0,
    dataVolumeGB: params.estimatedDataVolumeGB ?? 0,
    vmCount: params.vmCount ?? 1,
    hasDatabase: params.hasDatabase ?? false,
    isProduction: params.isProduction ?? false,
  });

  const description = params.description
    ?? `Approval required for ${params.gatedStepId ?? params.gatedPhase ?? "migration step"}`;

  ctx.log.info(`Approval gate triggered: ${description}`);
  ctx.log.info(`  Risk level: ${riskLevel}`);
  ctx.log.info(`  Job: ${params.jobId}`);
  if (params.gatedStepId) ctx.log.info(`  Gated step: ${params.gatedStepId}`);
  if (params.gatedPhase) ctx.log.info(`  Gated phase: ${params.gatedPhase}`);

  // Check if auto-approve is enabled (dry-run, test mode, or explicit flag)
  if (params.autoApprove || (policy.autoApproveInDryRun && ctx.tags?.["dry-run"] === "true")) {
    ctx.log.info(`  AUTO-APPROVED (${params.autoApprove ? "explicit" : "dry-run mode"})`);

    // Audit log
    try {
      const auditLogger = getAuditLogger();
      auditLogger.log({
        jobId: params.jobId,
        action: "approve",
        actor: "system-auto",
        phase: (params.gatedPhase as MigrationPhase) ?? "executing",
        stepId: params.gatedStepId ?? "approval-gate",
        details: {
          riskLevel,
          autoApproved: true,
          reason: "Auto-approved per policy",
        },
      });
    } catch {
      // Audit logging is best-effort
    }

    return buildResult({
      approved: true,
      requestId: `auto-${Date.now()}`,
      riskLevel,
      decidedBy: "system-auto",
      decidedAt: new Date().toISOString(),
      reason: "Auto-approved per policy",
      waitDurationMs: Date.now() - start,
      autoApproved: true,
    });
  }

  // Create the approval request
  const request = createApprovalRequest({
    jobId: params.jobId,
    stepId: params.gatedStepId,
    phase: params.gatedPhase as MigrationPhase | undefined,
    type: params.gateType ?? "step-execution",
    description,
    riskLevel,
    metadata: {
      estimatedCostUSD: params.estimatedCostUSD,
      estimatedDataVolumeGB: params.estimatedDataVolumeGB,
      vmCount: params.vmCount,
      hasDatabase: params.hasDatabase,
      isProduction: params.isProduction,
      notificationChannel: params.notificationChannel,
    },
    requestedBy: params.requestedBy,
    policy,
  });

  // Store the request for external decision
  pendingApprovals.set(request.id, request);
  ctx.log.info(`  Created approval request: ${request.id}`);
  ctx.log.info(`  Timeout: ${request.timeoutMs}ms (${Math.round(request.timeoutMs / 60000)}m)`);

  if (params.notificationChannel) {
    ctx.log.info(`  Notification sent to: ${params.notificationChannel}`);
  }

  // Audit log the request
  try {
    const auditLogger = getAuditLogger();
    auditLogger.log({
      jobId: params.jobId,
      action: "execute",
      actor: params.requestedBy ?? "system",
      phase: (params.gatedPhase as MigrationPhase) ?? "executing",
      stepId: params.gatedStepId ?? "approval-gate",
      details: {
        event: "approval-requested",
        requestId: request.id,
        riskLevel,
        timeoutMs: request.timeoutMs,
      },
    });
  } catch {
    // Audit logging is best-effort
  }

  // Poll for approval decision
  const pollInterval = params.pollIntervalMs ?? 5_000; // 5s default
  const deadline = Date.now() + request.timeoutMs;

  while (Date.now() < deadline) {
    ctx.signal?.throwIfAborted();

    // Check for a decision
    const decision = approvalDecisions.get(request.id);
    if (decision) {
      const waitDurationMs = Date.now() - start;
      ctx.log.info(`  Decision received: ${decision.approved ? "APPROVED" : "REJECTED"} by ${decision.decidedBy}`);
      if (decision.reason) ctx.log.info(`  Reason: ${decision.reason}`);
      ctx.log.info(`  Wait duration: ${waitDurationMs}ms`);

      // Audit log the decision
      try {
        const auditLogger = getAuditLogger();
        auditLogger.log({
          jobId: params.jobId,
          action: decision.approved ? "approve" : "execute",
          actor: decision.decidedBy,
          phase: (params.gatedPhase as MigrationPhase) ?? "executing",
          stepId: params.gatedStepId ?? "approval-gate",
          details: {
            event: "approval-decided",
            requestId: request.id,
            approved: decision.approved,
            reason: decision.reason,
            waitDurationMs,
          },
        });
      } catch {
        // Best-effort
      }

      // Clean up the decision from the store
      approvalDecisions.delete(request.id);

      if (!decision.approved) {
        throw new Error(`Approval rejected by ${decision.decidedBy}: ${decision.reason ?? "No reason provided"}`);
      }

      return buildResult({
        approved: true,
        requestId: request.id,
        riskLevel,
        decidedBy: decision.decidedBy,
        decidedAt: decision.decidedAt,
        reason: decision.reason,
        waitDurationMs,
        autoApproved: false,
      });
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout — clean up and fail
  pendingApprovals.delete(request.id);
  const waitDurationMs = Date.now() - start;
  ctx.log.error(`  Approval timed out after ${waitDurationMs}ms`);

  // Audit log the timeout
  try {
    const auditLogger = getAuditLogger();
    auditLogger.log({
      jobId: params.jobId,
      action: "execute",
      actor: "system",
      phase: (params.gatedPhase as MigrationPhase) ?? "executing",
      stepId: params.gatedStepId ?? "approval-gate",
      details: {
        event: "approval-timeout",
        requestId: request.id,
        timeoutMs: request.timeoutMs,
        waitDurationMs,
      },
    });
  } catch {
    // Best-effort
  }

  throw new Error(`Approval gate timed out after ${request.timeoutMs}ms for: ${description}`);
}

function buildResult(result: ApprovalGateResult): Record<string, unknown> {
  return result as unknown as Record<string, unknown>;
}

// Approval gates are not rollback-able — they are a governance checkpoint
export const approvalGateHandler: MigrationStepHandler = {
  execute,
};
