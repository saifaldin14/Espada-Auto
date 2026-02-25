/**
 * IDIO — Orchestration Engine
 *
 * The core execution engine that:
 * - Validates the plan
 * - Topologically sorts steps into concurrent layers
 * - Executes steps with concurrency control
 * - Resolves inter-step output references at runtime
 * - Handles retries, timeouts, cancellation (AbortSignal)
 * - Auto-rollbacks completed steps on failure (reverse order)
 * - Emits lifecycle events
 * - Supports dry-run mode
 */

import type {
  ExecutionPlan,
  PlanStep,
  ExecutionState,
  OrchestrationOptions,
  OrchestrationEvent,
  OrchestrationResult,
  StepExecutionResult,
  StepContext,
  StepLogger,
  StepExecutionState,
  StepInstanceId,
} from "./types.js";
import { getStepHandler, getStepDefinition } from "./registry.js";
import { validatePlan, topologicalSort, resolveStepParams, evaluateCondition } from "./planner.js";

// =============================================================================
// Default Options
// =============================================================================

const DEFAULT_OPTIONS: Required<OrchestrationOptions> = {
  dryRun: false,
  maxConcurrency: 4,
  failFast: true,
  autoRollback: true,
  timeoutMs: 600_000,      // 10 min total
  stepTimeoutMs: 120_000,  // 2 min per step
  maxRetries: 1,
  globalTags: {},
  signal: undefined as unknown as AbortSignal,
};

// =============================================================================
// Orchestrator
// =============================================================================

export type OrchestrationEventListener = (event: OrchestrationEvent) => void;

export class Orchestrator {
  private options: Required<OrchestrationOptions>;
  private listeners: OrchestrationEventListener[] = [];

  constructor(options?: Partial<OrchestrationOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options } as Required<OrchestrationOptions>;
  }

  /** Subscribe to orchestration lifecycle events. */
  on(listener: OrchestrationEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: OrchestrationEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* swallow listener errors */ }
    }
  }

  /**
   * Execute an orchestration plan.
   */
  async execute(plan: ExecutionPlan): Promise<OrchestrationResult> {
    const started = Date.now();
    const opts = { ...this.options };

    // 1. Validate the plan
    const validation = validatePlan(plan);
    if (!validation.valid) {
      const now = new Date().toISOString();
      return {
        planId: plan.id,
        planName: plan.name,
        status: "failed",
        steps: [],
        startedAt: new Date(started).toISOString(),
        completedAt: now,
        totalDurationMs: Date.now() - started,
        outputs: {},
        errors: validation.issues
          .filter((i) => i.severity === "error")
          .map((i) => i.message),
      };
    }

    // 2. Build execution layers
    let layers: PlanStep[][];
    try {
      layers = topologicalSort(plan.steps);
    } catch (err: any) {
      const now = new Date().toISOString();
      return {
        planId: plan.id,
        planName: plan.name,
        status: "failed",
        steps: [],
        startedAt: new Date(started).toISOString(),
        completedAt: now,
        totalDurationMs: Date.now() - started,
        outputs: {},
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }

    // 3. Initialize execution state
    const state: ExecutionState = {
      planId: plan.id,
      status: "running",
      startedAt: new Date(started).toISOString(),
      steps: new Map(),
      resolvedOutputs: new Map(),
    };

    for (const step of plan.steps) {
      state.steps.set(step.id, {
        stepId: step.id,
        status: "pending",
        outputs: {},
        retryCount: 0,
      });
    }

    // Track completed step IDs for rollback ordering
    const completedStepIds: StepInstanceId[] = [];
    const stepResults: StepExecutionResult[] = [];

    this.emit({
      type: "plan:start",
      planId: plan.id,
      timestamp: new Date().toISOString(),
      message: `Starting plan "${plan.name}" with ${plan.steps.length} steps`,
      progress: { completed: 0, total: plan.steps.length, percentage: 0 },
    });

    // 4. Global timeout
    const timeoutController = new AbortController();
    let globalTimer: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeoutMs > 0) {
      globalTimer = setTimeout(() => timeoutController.abort(), opts.timeoutMs);
    }

    // Combine external signal + our timeout
    const combinedSignal = opts.signal
      ? anySignal([opts.signal, timeoutController.signal])
      : timeoutController.signal;

    let planFailed = false;

    try {
      // 5. Execute layer by layer
      for (const layer of layers) {
        if (planFailed && opts.failFast) break;
        if (combinedSignal.aborted) break;

        // Filter steps whose conditions are met
        const runnableSteps = layer.filter((step) => {
          if (step.condition) {
            // Build a status map for condition evaluation
            const statusMap = new Map<string, { status: string }>();
            for (const [id, ses] of state.steps) {
              statusMap.set(id, { status: ses.status });
            }
            // Build an outputs map for condition evaluation
            const outputsMap = new Map<string, Record<string, unknown>>();
            for (const [id, val] of state.resolvedOutputs) {
              if (val && typeof val === "object") {
                outputsMap.set(id, val as Record<string, unknown>);
              }
            }
            const conditionMet = evaluateCondition(step.condition, statusMap, outputsMap);
            if (!conditionMet) {
              this.markSkipped(state, step, stepResults, plan.id, "Condition not met");
              return false;
            }
          }
          return true;
        });

        // Execute with concurrency control
        const concurrencyLimit = Math.min(opts.maxConcurrency, runnableSteps.length);
        const chunks = chunkArray(runnableSteps, concurrencyLimit);

        for (const chunk of chunks) {
          if (planFailed && opts.failFast) break;
          if (combinedSignal.aborted) break;

          const chunkResults = await Promise.allSettled(
            chunk.map((step) =>
              this.executeStep(step, state, opts, plan, combinedSignal)
            ),
          );

          for (let i = 0; i < chunkResults.length; i++) {
            const step = chunk[i];
            const result = chunkResults[i];

            if (result.status === "fulfilled") {
              stepResults.push(result.value);
              if (result.value.status === "failed") {
                planFailed = true;
              } else if (result.value.status === "succeeded") {
                completedStepIds.push(step.id);
              }
            } else {
              // Promise rejected (unexpected)
              const err = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
              stepResults.push({
                stepId: step.id,
                stepName: step.name,
                stepType: step.type,
                status: "failed",
                durationMs: 0,
                outputs: {},
                error: err.message,
              });
              planFailed = true;
            }
          }
        }
      }

      // Mark remaining pending steps as skipped
      for (const step of plan.steps) {
        const ss = state.steps.get(step.id);
        if (ss && ss.status === "pending") {
          this.markSkipped(state, step, stepResults, plan.id, planFailed ? "Skipped due to earlier failure" : "Not reached");
        }
      }

    } finally {
      if (globalTimer) clearTimeout(globalTimer);
    }

    // 6. Rollback on failure
    if (planFailed && opts.autoRollback && !opts.dryRun) {
      await this.rollback(state, plan, completedStepIds);
    }

    // Handle cancellation
    if (combinedSignal.aborted) {
      this.emit({
        type: "plan:cancelled",
        planId: plan.id,
        timestamp: new Date().toISOString(),
        message: "Orchestration was cancelled",
      });
      return {
        planId: plan.id,
        planName: plan.name,
        status: "cancelled",
        steps: stepResults,
        startedAt: new Date(started).toISOString(),
        completedAt: new Date().toISOString(),
        totalDurationMs: Date.now() - started,
        outputs: Object.fromEntries(state.resolvedOutputs),
        errors: ["Orchestration was cancelled"],
      };
    }

    const finalStatus = planFailed ? "failed" : "succeeded";
    this.emit({
      type: planFailed ? "plan:failed" : "plan:complete",
      planId: plan.id,
      timestamp: new Date().toISOString(),
      message: planFailed
        ? `Plan "${plan.name}" failed`
        : `Plan "${plan.name}" completed successfully in ${Date.now() - started}ms`,
    });

    return {
      planId: plan.id,
      planName: plan.name,
      status: finalStatus,
      steps: stepResults,
      startedAt: new Date(started).toISOString(),
      completedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - started,
      outputs: Object.fromEntries(state.resolvedOutputs),
      errors: stepResults.filter((r) => r.error).map((r) => r.error!),
    };
  }

  // ---------------------------------------------------------------------------
  // Step Execution
  // ---------------------------------------------------------------------------

  private async executeStep(
    step: PlanStep,
    state: ExecutionState,
    opts: Required<OrchestrationOptions>,
    plan: ExecutionPlan,
    signal: AbortSignal,
  ): Promise<StepExecutionResult> {
    const stepState = state.steps.get(step.id)!;
    const stepStart = Date.now();
    stepState.status = "running";
    stepState.startedAt = new Date().toISOString();

    this.emit({
      type: "step:start",
      planId: plan.id,
      stepId: step.id,
      stepName: step.name,
      timestamp: new Date().toISOString(),
      message: `Starting step "${step.name}" (${step.type})`,
    });

    const handler = getStepHandler(step.type);
    if (!handler) {
      const errMsg = `No handler registered for step type "${step.type}"`;
      stepState.status = "failed";
      stepState.completedAt = new Date().toISOString();
      stepState.error = errMsg;
      this.emit({
        type: "step:failed",
        planId: plan.id,
        stepId: step.id,
        stepName: step.name,
        timestamp: new Date().toISOString(),
        message: errMsg,
        error: errMsg,
      });
      return { stepId: step.id, stepName: step.name, stepType: step.type, status: "failed", durationMs: 0, outputs: {}, error: errMsg };
    }

    // Resolve params — build outputs map compatible with resolveStepParams
    let resolvedParams: Record<string, unknown>;
    try {
      const outputsMap = new Map<string, Record<string, unknown>>();
      for (const [id, val] of state.resolvedOutputs) {
        if (val && typeof val === "object") {
          outputsMap.set(id, val as Record<string, unknown>);
        }
      }
      resolvedParams = resolveStepParams(step, outputsMap, plan.globalParams ?? {});
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      stepState.status = "failed";
      stepState.completedAt = new Date().toISOString();
      stepState.error = errMsg;
      this.emit({
        type: "step:failed",
        planId: plan.id,
        stepId: step.id,
        stepName: step.name,
        timestamp: new Date().toISOString(),
        message: `Failed to resolve params: ${errMsg}`,
        error: errMsg,
      });
      return { stepId: step.id, stepName: step.name, stepType: step.type, status: "failed", durationMs: Date.now() - stepStart, outputs: {}, error: errMsg };
    }

    // Build step context
    const logger = createStepLogger(step.id);
    const ctx: StepContext = {
      params: resolvedParams,
      globalParams: plan.globalParams ?? {},
      tags: { ...opts.globalTags, "idio:step": step.id, "idio:type": step.type },
      log: logger,
      signal,
    };

    // Dry-run: skip actual execution
    if (opts.dryRun) {
      const def = getStepDefinition(step.type);
      const mockOutputs: Record<string, unknown> = {};
      if (def) {
        for (const out of def.outputs) {
          mockOutputs[out.name] = `<dry-run:${out.name}>`;
        }
      }
      const duration = Date.now() - stepStart;
      stepState.status = "succeeded";
      stepState.completedAt = new Date().toISOString();
      stepState.outputs = mockOutputs;
      stepState.durationMs = duration;
      state.resolvedOutputs.set(step.id, mockOutputs);
      this.emit({
        type: "step:complete",
        planId: plan.id,
        stepId: step.id,
        stepName: step.name,
        timestamp: new Date().toISOString(),
        message: `Step "${step.name}" completed (dry-run)`,
        outputs: mockOutputs,
      });
      return { stepId: step.id, stepName: step.name, stepType: step.type, status: "succeeded", durationMs: duration, outputs: mockOutputs };
    }

    // Execute with retries
    let lastError: Error | undefined;
    const maxAttempts = (opts.maxRetries ?? 0) + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) break;

      try {
        const outputs = await withTimeout(
          handler.execute(ctx),
          opts.stepTimeoutMs,
          `Step "${step.id}" timed out after ${opts.stepTimeoutMs}ms`,
        );

        const duration = Date.now() - stepStart;
        stepState.status = "succeeded";
        stepState.completedAt = new Date().toISOString();
        stepState.outputs = outputs;
        stepState.durationMs = duration;
        state.resolvedOutputs.set(step.id, outputs);

        this.emit({
          type: "step:complete",
          planId: plan.id,
          stepId: step.id,
          stepName: step.name,
          timestamp: new Date().toISOString(),
          message: `Step "${step.name}" succeeded in ${duration}ms`,
          outputs,
        });
        return { stepId: step.id, stepName: step.name, stepType: step.type, status: "succeeded", durationMs: duration, outputs };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        stepState.retryCount = attempt;

        if (attempt < maxAttempts && !signal.aborted) {
          logger.warn(`Attempt ${attempt}/${maxAttempts} failed, retrying: ${lastError.message}`);
          this.emit({
            type: "step:retry",
            planId: plan.id,
            stepId: step.id,
            stepName: step.name,
            timestamp: new Date().toISOString(),
            message: `Retrying step "${step.name}" (attempt ${attempt + 1}/${maxAttempts})`,
            error: lastError.message,
          });
          // Exponential backoff: 1s, 2s, 4s...
          await sleep(Math.min(1000 * Math.pow(2, attempt - 1), 10_000));
        }
      }
    }

    // All attempts failed
    const duration = Date.now() - stepStart;
    stepState.status = "failed";
    stepState.completedAt = new Date().toISOString();
    stepState.error = lastError?.message;
    stepState.durationMs = duration;
    this.emit({
      type: "step:failed",
      planId: plan.id,
      stepId: step.id,
      stepName: step.name,
      timestamp: new Date().toISOString(),
      message: `Step "${step.name}" failed: ${lastError?.message}`,
      error: lastError?.message,
    });
    return { stepId: step.id, stepName: step.name, stepType: step.type, status: "failed", durationMs: duration, outputs: {}, error: lastError?.message };
  }

  private markSkipped(
    state: ExecutionState,
    step: PlanStep,
    stepResults: StepExecutionResult[],
    planId: string,
    reason: string,
  ): void {
    const ss = state.steps.get(step.id)!;
    ss.status = "skipped";
    ss.completedAt = new Date().toISOString();
    this.emit({
      type: "step:skipped",
      planId,
      stepId: step.id,
      stepName: step.name,
      timestamp: new Date().toISOString(),
      message: `Step "${step.name}" skipped: ${reason}`,
    });
    stepResults.push({ stepId: step.id, stepName: step.name, stepType: step.type, status: "skipped", durationMs: 0, outputs: {} });
  }

  // ---------------------------------------------------------------------------
  // Rollback
  // ---------------------------------------------------------------------------

  private async rollback(
    state: ExecutionState,
    plan: ExecutionPlan,
    completedStepIds: StepInstanceId[],
  ): Promise<void> {
    // Rollback in reverse completion order
    const reversedIds = [...completedStepIds].reverse();
    const stepMap = new Map(plan.steps.map((s) => [s.id, s]));

    for (const stepId of reversedIds) {
      const step = stepMap.get(stepId);
      if (!step) continue;

      const def = getStepDefinition(step.type);
      if (!def?.rollbackSupported) continue;

      const handler = getStepHandler(step.type);
      if (!handler?.rollback) continue;

      this.emit({
        type: "step:rollback-start",
        planId: plan.id,
        stepId: step.id,
        stepName: step.name,
        timestamp: new Date().toISOString(),
        message: `Rolling back step "${step.name}"`,
      });

      const logger = createStepLogger(step.id);
      const stepOutputs = state.resolvedOutputs.get(step.id);
      const outputsRecord = (stepOutputs && typeof stepOutputs === "object") ? stepOutputs as Record<string, unknown> : {};
      const ctx: StepContext = {
        params: { ...step.params, ...outputsRecord },
        globalParams: plan.globalParams ?? {},
        tags: { ...this.options.globalTags, "idio:step": step.id, "idio:rollback": "true" },
        log: logger,
        signal: new AbortController().signal,
      };

      try {
        await handler.rollback(ctx, outputsRecord);
        const ses = state.steps.get(step.id);
        if (ses) ses.status = "rolled-back";
        this.emit({
          type: "step:rollback-complete",
          planId: plan.id,
          stepId: step.id,
          stepName: step.name,
          timestamp: new Date().toISOString(),
          message: `Successfully rolled back step "${step.name}"`,
        });
      } catch (err: any) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const ses = state.steps.get(step.id);
        if (ses) ses.rollbackError = errMsg;
        this.emit({
          type: "step:rollback-failed",
          planId: plan.id,
          stepId: step.id,
          stepName: step.name,
          timestamp: new Date().toISOString(),
          message: `Failed to rollback step "${step.name}": ${errMsg}`,
          error: errMsg,
        });
      }
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

function createStepLogger(stepId: string): StepLogger {
  return {
    info: (msg: string) => console.debug(`[IDIO:${stepId}] ${msg}`),
    warn: (msg: string) => console.warn(`[IDIO:${stepId}] ⚠ ${msg}`),
    error: (msg: string) => console.error(`[IDIO:${stepId}] ✗ ${msg}`),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [array];
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Combine multiple AbortSignals — aborts when ANY signal fires.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

// =============================================================================
// Convenience
// =============================================================================

/**
 * Create and execute an orchestration plan in one call.
 */
export async function orchestrate(
  plan: ExecutionPlan,
  options?: Partial<OrchestrationOptions>,
  listener?: OrchestrationEventListener,
): Promise<OrchestrationResult> {
  const engine = new Orchestrator(options);
  if (listener) engine.on(listener);
  return engine.execute(plan);
}
