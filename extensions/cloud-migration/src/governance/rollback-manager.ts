/**
 * Governance — Rollback Manager
 *
 * Coordinates rollback across multiple pipelines, maintaining a
 * stack of completed steps and executing rollbacks in reverse order.
 * Integrates with the audit logger to record all rollback actions.
 */

import type { MigrationStep, MigrationStepHandler, MigrationStepContext, MigrationJob } from "../types.js";
import { getAuditLogger } from "./audit-logger.js";

// =============================================================================
// Types
// =============================================================================

export interface RollbackPlan {
  jobId: string;
  stepsToRollback: MigrationStep[];
  estimatedDurationMs: number;
  riskLevel: "low" | "medium" | "high";
  warnings: string[];
}

export interface RollbackResult {
  jobId: string;
  stepsRolledBack: number;
  stepsFailed: number;
  errors: Array<{ stepId: string; error: string }>;
  durationMs: number;
  complete: boolean;
}

export type RollbackEntry = {
  stepId: string;
  stepType: string;
  outputs: unknown;
  completedAt: string;
};

// =============================================================================
// Rollback Stack
// =============================================================================

/**
 * Maintains a per-job stack of completed steps for rollback.
 */
export class RollbackStack {
  private stacks = new Map<string, RollbackEntry[]>();

  /**
   * Push a completed step onto the rollback stack.
   */
  push(jobId: string, entry: RollbackEntry): void {
    const stack = this.stacks.get(jobId) ?? [];
    stack.push(entry);
    this.stacks.set(jobId, stack);
  }

  /**
   * Pop the most recent step (for rollback).
   */
  pop(jobId: string): RollbackEntry | undefined {
    const stack = this.stacks.get(jobId);
    if (!stack || stack.length === 0) return undefined;
    return stack.pop();
  }

  /**
   * Get the full stack (without popping).
   */
  peek(jobId: string): RollbackEntry[] {
    return [...(this.stacks.get(jobId) ?? [])];
  }

  /**
   * Get the stack depth.
   */
  depth(jobId: string): number {
    return this.stacks.get(jobId)?.length ?? 0;
  }

  /**
   * Clear a job's rollback stack.
   */
  clear(jobId: string): void {
    this.stacks.delete(jobId);
  }

  /**
   * Clear all stacks.
   */
  clearAll(): void {
    this.stacks.clear();
  }
}

// =============================================================================
// Rollback Plan Generation
// =============================================================================

/**
 * Generate a rollback plan for a job.
 */
export function generateRollbackPlan(
  jobId: string,
  stack: RollbackStack,
  stepHandlers: Map<string, MigrationStepHandler>,
): RollbackPlan {
  const entries = stack.peek(jobId);
  const warnings: string[] = [];

  // Steps in reverse order (LIFO)
  const stepsToRollback: MigrationStep[] = [];
  let estimatedDurationMs = 0;

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const handler = stepHandlers.get(entry.stepType);

    if (!handler?.rollback) {
      warnings.push(`Step "${entry.stepId}" (${entry.stepType}) has no rollback handler — will be skipped`);
      continue;
    }

    stepsToRollback.push({
      id: entry.stepId,
      type: entry.stepType as any,
      name: `Rollback: ${entry.stepId}`,
      description: `Rollback for step ${entry.stepId}`,
      params: {},
      dependsOn: [],
      timeoutMs: 30_000,
      pipeline: "compute" as any,
      resourceType: "vm" as any,
      requiresRollback: false,
    });

    // Estimate 30% of execution time for rollback
    estimatedDurationMs += 5000;
  }

  // Risk assessment
  let riskLevel: RollbackPlan["riskLevel"] = "low";
  if (entries.some((e) => e.stepType === "cutover")) {
    riskLevel = "high";
    warnings.push("Cutover step was completed — rollback involves DNS/traffic reversal");
  } else if (entries.some((e) => e.stepType.includes("provision") || e.stepType.includes("import"))) {
    riskLevel = "medium";
  }

  return {
    jobId,
    stepsToRollback,
    estimatedDurationMs,
    riskLevel,
    warnings,
  };
}

/**
 * Execute a rollback plan.
 */
export async function executeRollback(params: {
  plan: RollbackPlan;
  stack: RollbackStack;
  resolveHandler: (type: string) => MigrationStepHandler | undefined;
  log: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<RollbackResult> {
  const { plan, stack, resolveHandler, log, signal } = params;
  const startTime = Date.now();
  const audit = getAuditLogger();
  const errors: Array<{ stepId: string; error: string }> = [];
  let stepsRolledBack = 0;

  log(`Starting rollback for job ${plan.jobId} (${plan.stepsToRollback.length} steps)`);

  audit.log({
    jobId: plan.jobId,
    action: "rollback-started",
    phase: "rolling-back",
    details: {
      stepsToRollback: plan.stepsToRollback.length,
      riskLevel: plan.riskLevel,
    },
  });

  for (const step of plan.stepsToRollback) {
    signal?.throwIfAborted();

    const entry = stack.pop(plan.jobId);
    if (!entry) continue;

    const handler = resolveHandler(entry.stepType);
    if (!handler?.rollback) {
      log(`  Skipping ${entry.stepId} (no rollback handler)`);
      continue;
    }

    try {
      log(`  Rolling back step ${entry.stepId} (${entry.stepType})`);

      const ctx: MigrationStepContext = {
        params: {},
        globalParams: {},
        tags: {},
        log: {
          info: (msg: string) => log(`    ${msg}`),
          warn: (msg: string) => log(`    WARN: ${msg}`),
          error: (msg: string) => log(`    ERROR: ${msg}`),
        },
        signal,
      };

      const outputs = (entry.outputs ?? {}) as Record<string, unknown>;
      await handler.rollback(ctx, outputs);

      stepsRolledBack++;

      audit.log({
        jobId: plan.jobId,
        action: "step-rolled-back",
        phase: "rolling-back",
        stepId: entry.stepId,
        details: { stepType: entry.stepType },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ stepId: entry.stepId, error: message });
      log(`  ERROR rolling back ${entry.stepId}: ${message}`);

      audit.log({
        jobId: plan.jobId,
        action: "rollback-step-failed",
        phase: "rolling-back",
        stepId: entry.stepId,
        details: { error: message },
      });
    }
  }

  const durationMs = Date.now() - startTime;
  const complete = errors.length === 0;

  audit.log({
    jobId: plan.jobId,
    action: complete ? "rollback-completed" : "rollback-partial",
    phase: "rolling-back",
    details: {
      stepsRolledBack,
      stepsFailed: errors.length,
      durationMs,
    },
  });

  log(`Rollback ${complete ? "completed" : "partially completed"}: ${stepsRolledBack} rolled back, ${errors.length} failed`);

  return {
    jobId: plan.jobId,
    stepsRolledBack,
    stepsFailed: errors.length,
    errors,
    durationMs,
    complete,
  };
}
