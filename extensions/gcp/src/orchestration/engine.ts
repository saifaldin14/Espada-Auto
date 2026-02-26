/**
 * IDIO — Orchestration Engine (GCP)
 *
 * The core execution engine that:
 * - Validates the plan
 * - Topologically sorts steps
 * - Executes steps with dependency resolution
 * - Resolves inter-step output references at runtime
 * - Handles conditions, failures, and rollback
 * - Emits lifecycle callbacks
 * - Supports dry-run mode
 */

import type {
  ExecutionPlan,
  OrchestrationOptions,
  OrchestrationResult,
  StepResult,
  StepExecutionContext,
  StepLogger,
} from "./types.js";
import { getStepHandler, getStepDefinition } from "./steps.js";
import { validatePlan, topologicalSort, resolveStepParams, evaluateCondition } from "./planner.js";

// =============================================================================
// Orchestrator
// =============================================================================

export class Orchestrator {
  private options: Required<OrchestrationOptions>;

  constructor(options?: OrchestrationOptions) {
    this.options = {
      dryRun: options?.dryRun ?? false,
      globalLabels: options?.globalLabels ?? {},
      concurrency: options?.concurrency ?? 1,
      onStepStart: options?.onStepStart ?? (() => {}),
      onStepComplete: options?.onStepComplete ?? (() => {}),
    };
  }

  /**
   * Execute an orchestration plan.
   */
  async execute(plan: ExecutionPlan): Promise<OrchestrationResult> {
    const startedAt = new Date();
    const opts = this.options;

    // 1. Validate the plan
    const validationErrors = validatePlan(plan);
    if (validationErrors.length > 0) {
      return {
        planId: plan.id,
        planName: plan.name,
        status: "failed",
        steps: [],
        outputs: {},
        errors: validationErrors,
        totalDurationMs: Date.now() - startedAt.getTime(),
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    // 2. Topologically sort steps
    let sortedSteps;
    try {
      sortedSteps = topologicalSort(plan);
    } catch (err: unknown) {
      return {
        planId: plan.id,
        planName: plan.name,
        status: "failed",
        steps: [],
        outputs: {},
        errors: [err instanceof Error ? err.message : String(err)],
        totalDurationMs: Date.now() - startedAt.getTime(),
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    // 3. Execute steps
    const stepResults: StepResult[] = [];
    const allOutputs: Record<string, Record<string, unknown>> = {};
    const resultMap = new Map<string, StepResult>();
    const completedStepIds: string[] = [];
    let planFailed = false;

    for (const step of sortedSteps) {
      // Skip remaining steps on failure
      if (planFailed) {
        const skipped: StepResult = {
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          status: "skipped",
          outputs: {},
          durationMs: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
        stepResults.push(skipped);
        resultMap.set(step.id, skipped);
        continue;
      }

      // Evaluate condition
      if (step.condition) {
        const conditionMet = evaluateCondition(step.condition, resultMap);
        if (!conditionMet) {
          const skipped: StepResult = {
            stepId: step.id,
            stepName: step.name,
            stepType: step.type,
            status: "skipped",
            outputs: {},
            durationMs: 0,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          };
          stepResults.push(skipped);
          resultMap.set(step.id, skipped);
          continue;
        }
      }

      // Resolve params with output references
      let resolvedParams: Record<string, unknown>;
      try {
        resolvedParams = resolveStepParams(step.params, allOutputs);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const failed: StepResult = {
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          status: "failed",
          outputs: {},
          durationMs: 0,
          error: `Failed to resolve params: ${errMsg}`,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
        stepResults.push(failed);
        resultMap.set(step.id, failed);
        planFailed = true;
        continue;
      }

      // Get handler
      const handler = getStepHandler(step.type);
      if (!handler) {
        const failed: StepResult = {
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          status: "failed",
          outputs: {},
          durationMs: 0,
          error: `No handler registered for step type "${step.type}"`,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
        stepResults.push(failed);
        resultMap.set(step.id, failed);
        planFailed = true;
        continue;
      }

      // Build execution context
      const logger = createStepLogger(step.id);
      const ctx: StepExecutionContext = {
        stepId: step.id,
        params: resolvedParams,
        outputs: allOutputs,
        dryRun: opts.dryRun,
        logger,
      };

      opts.onStepStart(step.id);
      const stepStart = Date.now();

      try {
        const outputs = await handler.execute(ctx);
        const durationMs = Date.now() - stepStart;

        allOutputs[step.id] = outputs;
        completedStepIds.push(step.id);

        const result: StepResult = {
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          status: "completed",
          outputs,
          durationMs,
          startedAt: new Date(stepStart).toISOString(),
          completedAt: new Date().toISOString(),
        };
        stepResults.push(result);
        resultMap.set(step.id, result);
        opts.onStepComplete(step.id, result);
      } catch (err: unknown) {
        const durationMs = Date.now() - stepStart;
        const errMsg = err instanceof Error ? err.message : String(err);

        const result: StepResult = {
          stepId: step.id,
          stepName: step.name,
          stepType: step.type,
          status: "failed",
          outputs: {},
          durationMs,
          error: errMsg,
          startedAt: new Date(stepStart).toISOString(),
          completedAt: new Date().toISOString(),
        };
        stepResults.push(result);
        resultMap.set(step.id, result);
        opts.onStepComplete(step.id, result);
        planFailed = true;

        // Rollback on failure if requested
        if (step.rollbackOnFailure && !opts.dryRun) {
          await this.rollbackCompletedSteps(completedStepIds, allOutputs, plan);
        }
      }
    }

    // Determine final status
    const hasFailures = stepResults.some((r) => r.status === "failed");
    const hasCompleted = stepResults.some((r) => r.status === "completed");
    const hasRolledBack = stepResults.some((r) => r.status === "rolled-back");

    let status: OrchestrationResult["status"];
    if (hasRolledBack) {
      status = "rolled-back";
    } else if (hasFailures && hasCompleted) {
      status = "partial";
    } else if (hasFailures) {
      status = "failed";
    } else {
      status = "completed";
    }

    return {
      planId: plan.id,
      planName: plan.name,
      status,
      steps: stepResults,
      outputs: allOutputs,
      errors: stepResults.filter((r) => r.error).map((r) => r.error!),
      totalDurationMs: Date.now() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Rollback
  // ---------------------------------------------------------------------------

  private async rollbackCompletedSteps(
    completedStepIds: string[],
    allOutputs: Record<string, Record<string, unknown>>,
    plan: ExecutionPlan,
  ): Promise<void> {
    const stepMap = new Map(plan.steps.map((s) => [s.id, s]));

    // Rollback in reverse completion order
    for (const stepId of [...completedStepIds].reverse()) {
      const step = stepMap.get(stepId);
      if (!step) continue;

      const handler = getStepHandler(step.type);
      if (!handler?.rollback) continue;

      const logger = createStepLogger(stepId);
      const ctx: StepExecutionContext = {
        stepId,
        params: step.params,
        outputs: allOutputs,
        dryRun: false,
        logger,
      };

      try {
        await handler.rollback(ctx, allOutputs[stepId] ?? {});
        logger.info(`Rolled back step "${step.name}"`);
      } catch (err: unknown) {
        logger.warn(`Rollback failed for step "${step.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

function createStepLogger(stepId: string): StepLogger {
  return {
    info: (msg: string) => console.log(`[IDIO:${stepId}] ${msg}`),
    warn: (msg: string) => console.warn(`[IDIO:${stepId}] ⚠ ${msg}`),
    error: (msg: string) => console.error(`[IDIO:${stepId}] ✗ ${msg}`),
  };
}
