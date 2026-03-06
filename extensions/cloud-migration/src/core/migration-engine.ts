/**
 * Cross-Cloud Migration Engine — Core Orchestrator
 *
 * Wraps the proven DAG-based ExecutionPlan pattern from Azure orchestration.
 * Provides topological sort, concurrency layers, auto-rollback, and event lifecycle.
 */

import { randomUUID, createHash } from "node:crypto";

import type {
  MigrationJob,
  MigrationPhase,
  MigrationExecutionPlan,
  MigrationStep,
  MigrationStepHandler,
  MigrationStepContext,
  MigrationStepExecutionState,
  MigrationStepStatus,
  MigrationExecutionState,
  MigrationOrchestrationResult,
  MigrationStepExecutionResult,
  MigrationOrchestrationOptions,
  MigrationEvent,
  MigrationEventListener,
  MigrationStepType,
  MigrationStepLogger,
} from "../types.js";
import {
  isValidPhaseTransition,
} from "../types.js";
import { getPluginState } from "../state.js";

// =============================================================================
// Step Registry
// =============================================================================

/**
 * Register a step handler. Enforces that mutating steps have rollback.
 */
export function registerStepHandler(
  type: MigrationStepType,
  handler: MigrationStepHandler,
  requiresRollback = true,
): void {
  if (requiresRollback && !handler.rollback) {
    throw new Error(
      `Step handler "${type}" is marked as requiring rollback but no rollback function was provided`,
    );
  }
  const state = getPluginState();
  state.stepHandlers.set(type, handler);
}

/**
 * Resolve the handler for a step type. Throws if not registered.
 */
export function resolveStepHandler(type: MigrationStepType): MigrationStepHandler {
  const state = getPluginState();
  const handler = state.stepHandlers.get(type);
  if (!handler) {
    throw new Error(`No step handler registered for type: ${type}`);
  }
  return handler;
}

// =============================================================================
// Topological Sort
// =============================================================================

/**
 * Topological sort with concurrency layers.
 * Returns groups of steps that can execute in parallel within each layer.
 */
export function topologicalSort(steps: MigrationStep[]): MigrationStep[][] {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const step of steps) {
    inDegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }

  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!stepMap.has(dep)) {
        throw new Error(`Step "${step.id}" depends on unknown step "${dep}"`);
      }
      adjacency.get(dep)!.push(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  const layers: MigrationStep[][] = [];
  let queue = steps.filter((s) => inDegree.get(s.id) === 0);

  while (queue.length > 0) {
    layers.push([...queue]);
    const nextQueue: MigrationStep[] = [];

    for (const step of queue) {
      for (const neighborId of adjacency.get(step.id) ?? []) {
        const newDegree = (inDegree.get(neighborId) ?? 1) - 1;
        inDegree.set(neighborId, newDegree);
        if (newDegree === 0) {
          nextQueue.push(stepMap.get(neighborId)!);
        }
      }
    }

    queue = nextQueue;
  }

  const totalProcessed = layers.reduce((sum, l) => sum + l.length, 0);
  if (totalProcessed !== steps.length) {
    throw new Error("Cycle detected in migration step DAG");
  }

  return layers;
}

// =============================================================================
// Output Resolution
// =============================================================================

/**
 * Resolve step output references: `${stepId}.outputs.${name}` → actual value.
 */
export function resolveOutputRefs(
  params: Record<string, unknown>,
  resolvedOutputs: Map<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && /^[a-zA-Z0-9_-]+\.outputs\.[a-zA-Z0-9_.-]+$/.test(value)) {
      const resolvedValue = resolvedOutputs.get(value);
      if (resolvedValue === undefined) {
        throw new Error(`Unresolved output reference: ${value}`);
      }
      resolved[key] = resolvedValue;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

// =============================================================================
// Idempotency Registry (Enterprise SLA)
// =============================================================================

/**
 * Completed operation record used for idempotency enforcement.
 */
export interface IdempotencyRecord {
  idempotencyKey: string;
  jobId: string;
  stepId: string;
  status: "succeeded" | "failed";
  outputs: Record<string, unknown>;
  completedAt: string;
}

/**
 * In-memory idempotency registry.
 *
 * In a production deployment this would be backed by a durable store
 * (e.g., DynamoDB, Cosmos DB, or PostgreSQL) with TTL-based expiry.
 * The in-memory implementation is sufficient for single-process execution
 * and demonstrates the contract.
 */
const idempotencyRegistry = new Map<string, IdempotencyRecord>();

/**
 * Generate a deterministic idempotency key from job ID, step ID, and params.
 *
 * The key is a SHA-256 hash of the concatenated values, ensuring that
 * the same operation with the same parameters always yields the same key.
 */
export function generateIdempotencyKey(
  jobId: string,
  stepId: string,
  params: Record<string, unknown>,
): string {
  const payload = JSON.stringify([jobId, stepId, params]);
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Check if an operation has already been completed with this key.
 * Returns the cached result if found, or null if the operation should proceed.
 */
export function checkIdempotency(key: string): IdempotencyRecord | null {
  return idempotencyRegistry.get(key) ?? null;
}

/**
 * Record a completed operation for future idempotency checks.
 */
export function recordIdempotency(record: IdempotencyRecord): void {
  idempotencyRegistry.set(record.idempotencyKey, record);
}

/**
 * Clear the idempotency registry. Used during service reset / testing.
 */
export function clearIdempotencyRegistry(): void {
  idempotencyRegistry.clear();
}

/**
 * Get the current size of the idempotency registry (for diagnostics).
 */
export function getIdempotencyRegistrySize(): number {
  return idempotencyRegistry.size;
}

// =============================================================================
// Event Emission
// =============================================================================

function emitEvent(event: MigrationEvent): void {
  const state = getPluginState();
  for (const listener of state.eventListeners) {
    try {
      listener(event);
    } catch {
      // Event listeners must not break orchestration
    }
  }
}

export function addEventListener(listener: MigrationEventListener): () => void {
  const state = getPluginState();
  state.eventListeners.add(listener);
  return () => { state.eventListeners.delete(listener); };
}

// =============================================================================
// Job Management
// =============================================================================

/**
 * Create a new migration job.
 */
export function createMigrationJob(params: {
  name: string;
  description: string;
  source: MigrationJob["source"];
  target: MigrationJob["target"];
  resourceIds: string[];
  resourceTypes: MigrationJob["resourceTypes"];
  initiatedBy: string;
  metadata?: Record<string, unknown>;
}): MigrationJob {
  const state = getPluginState();
  const now = new Date().toISOString();
  const job: MigrationJob = {
    id: randomUUID(),
    name: params.name,
    description: params.description,
    phase: "created",
    phaseHistory: [{ from: "init", to: "created", timestamp: now, triggeredBy: params.initiatedBy, reason: "Job created" }],
    source: params.source,
    target: params.target,
    resourceIds: params.resourceIds,
    resourceTypes: params.resourceTypes,
    integrityReports: [],
    compatibilityResults: [],
    auditTrail: [],
    createdAt: now,
    updatedAt: now,
    initiatedBy: params.initiatedBy,
    metadata: params.metadata ?? {},
  };

  state.jobs.set(job.id, job);
  state.activeJobCount++;
  state.diagnostics.jobsCreated++;

  emitEvent({
    type: "job:created",
    jobId: job.id,
    timestamp: now,
    message: `Migration job "${job.name}" created`,
  });

  return job;
}

/**
 * Transition a job to a new phase with validation.
 */
export function transitionJobPhase(
  jobId: string,
  toPhase: MigrationPhase,
  triggeredBy: string,
  reason: string,
): MigrationJob {
  const state = getPluginState();
  const job = state.jobs.get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  if (!isValidPhaseTransition(job.phase, toPhase)) {
    throw new Error(
      `Invalid phase transition: ${job.phase} → ${toPhase} for job ${jobId}`,
    );
  }

  const now = new Date().toISOString();
  const prevPhase = job.phase;
  const lastTransition = job.phaseHistory[job.phaseHistory.length - 1];
  const durationMs = lastTransition
    ? Date.now() - new Date(lastTransition.timestamp).getTime()
    : undefined;

  job.phaseHistory.push({
    from: prevPhase,
    to: toPhase,
    timestamp: now,
    triggeredBy,
    reason,
    durationMs,
  });
  job.phase = toPhase;
  job.updatedAt = now;

  if (toPhase === "completed" || toPhase === "failed" || toPhase === "rolled-back") {
    job.completedAt = now;
    state.activeJobCount = Math.max(0, state.activeJobCount - 1);
    if (toPhase === "completed") state.diagnostics.jobsCompleted++;
    if (toPhase === "failed") state.diagnostics.jobsFailed++;
    if (toPhase === "rolled-back") state.diagnostics.jobsRolledBack++;
  }

  emitEvent({
    type: "job:phase-change",
    jobId: job.id,
    timestamp: now,
    message: `Job "${job.name}" phase: ${prevPhase} → ${toPhase} (${reason})`,
  });

  return job;
}

/**
 * Get a job by ID.
 */
export function getJob(jobId: string): MigrationJob | undefined {
  return getPluginState().jobs.get(jobId);
}

/**
 * List all jobs, optionally filtered.
 */
export function listJobs(filter?: {
  phase?: MigrationPhase;
  provider?: string;
  limit?: number;
}): MigrationJob[] {
  const state = getPluginState();
  let jobs = Array.from(state.jobs.values());

  if (filter?.phase) {
    jobs = jobs.filter((j) => j.phase === filter.phase);
  }
  if (filter?.provider) {
    jobs = jobs.filter(
      (j) => j.source.provider === filter.provider || j.target.provider === filter.provider,
    );
  }
  jobs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  if (filter?.limit) {
    jobs = jobs.slice(0, filter.limit);
  }
  return jobs;
}

// =============================================================================
// Execution Engine
// =============================================================================

function createStepLogger(jobId: string, stepId: string, stepName: string): MigrationStepLogger {
  return {
    info: (msg: string) => emitEvent({
      type: "step:start",
      jobId,
      stepId,
      stepName,
      timestamp: new Date().toISOString(),
      message: msg,
    }),
    warn: (msg: string) => emitEvent({
      type: "step:start",
      jobId,
      stepId,
      stepName,
      timestamp: new Date().toISOString(),
      message: `[WARN] ${msg}`,
    }),
    error: (msg: string) => emitEvent({
      type: "step:failed",
      jobId,
      stepId,
      stepName,
      timestamp: new Date().toISOString(),
      message: `[ERROR] ${msg}`,
    }),
  };
}

/**
 * Execute a single step with timeout, error handling, and output capture.
 */
async function executeStep(
  step: MigrationStep,
  handler: MigrationStepHandler,
  ctx: MigrationStepContext,
  execState: MigrationStepExecutionState,
  jobId: string,
  options: MigrationOrchestrationOptions,
): Promise<void> {
  const startedAt = new Date().toISOString();
  execState.status = "running";
  execState.startedAt = startedAt;

  const diag = getPluginState().diagnostics;
  diag.stepsExecuted++;

  emitEvent({
    type: "step:start",
    jobId,
    stepId: step.id,
    stepName: step.name,
    timestamp: startedAt,
    message: `Starting step: ${step.name}`,
  });

  const timeoutMs = step.timeoutMs ?? options.stepTimeoutMs ?? 600_000;

  try {
    const outputs = await Promise.race([
      handler.execute(ctx),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Step "${step.name}" timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);

    const completedAt = new Date().toISOString();
    execState.status = "succeeded";
    execState.completedAt = completedAt;
    execState.durationMs = Date.now() - new Date(startedAt).getTime();
    execState.outputs = outputs;
    diag.stepsSucceeded++;

    emitEvent({
      type: "step:complete",
      jobId,
      stepId: step.id,
      stepName: step.name,
      timestamp: completedAt,
      message: `Step "${step.name}" completed`,
      outputs,
    });
  } catch (err: unknown) {
    const completedAt = new Date().toISOString();
    const errorMsg = err instanceof Error ? err.message : String(err);

    execState.status = "failed";
    execState.completedAt = completedAt;
    execState.durationMs = Date.now() - new Date(startedAt).getTime();
    execState.error = errorMsg;
    diag.stepsFailed++;
    diag.lastError = errorMsg;

    emitEvent({
      type: "step:failed",
      jobId,
      stepId: step.id,
      stepName: step.name,
      timestamp: completedAt,
      message: `Step "${step.name}" failed: ${errorMsg}`,
      error: errorMsg,
    });

    throw err;
  }
}

/**
 * Rollback completed steps in reverse topological order.
 */
async function rollbackSteps(
  completedSteps: MigrationStep[],
  execState: MigrationExecutionState,
  jobId: string,
  globalParams: Record<string, unknown>,
  tags: Record<string, string>,
): Promise<void> {
  // Reverse order so we undo from the most recently completed step
  const reversed = [...completedSteps].reverse();

  for (const step of reversed) {
    const handler = getPluginState().stepHandlers.get(step.type);
    if (!handler?.rollback) continue;

    const stepState = execState.steps.get(step.id);
    if (!stepState || stepState.status !== "succeeded") continue;

    emitEvent({
      type: "step:rollback-start",
      jobId,
      stepId: step.id,
      stepName: step.name,
      timestamp: new Date().toISOString(),
      message: `Rolling back step: ${step.name}`,
    });

    try {
      const ctx: MigrationStepContext = {
        params: {},
        globalParams,
        tags: tags ?? {},
        log: createStepLogger(jobId, step.id, step.name),
      };
      await handler.rollback(ctx, stepState.outputs);

      stepState.status = "rolled-back";
      emitEvent({
        type: "step:rollback-complete",
        jobId,
        stepId: step.id,
        stepName: step.name,
        timestamp: new Date().toISOString(),
        message: `Rollback complete for step: ${step.name}`,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      stepState.rollbackError = errorMsg;

      emitEvent({
        type: "step:rollback-failed",
        jobId,
        stepId: step.id,
        stepName: step.name,
        timestamp: new Date().toISOString(),
        message: `Rollback failed for step "${step.name}": ${errorMsg}`,
        error: errorMsg,
      });
    }
  }
}

/**
 * Execute a full migration plan — the core orchestration loop.
 *
 * 1. Topological sort to get concurrency layers
 * 2. Execute each layer (up to maxConcurrency within each layer)
 * 3. Resolve output references between steps
 * 4. Auto-rollback on failure (if enabled)
 */
export async function executePlan(
  plan: MigrationExecutionPlan,
  options: MigrationOrchestrationOptions = {},
): Promise<MigrationOrchestrationResult> {
  const {
    maxConcurrency = 4,
    autoRollback = true,
    dryRun = false,
    failFast = true,
  } = options;

  const startedAt = new Date().toISOString();
  const execState: MigrationExecutionState = {
    planId: plan.id,
    status: "running",
    startedAt,
    steps: new Map(),
    resolvedOutputs: new Map(),
  };

  // Initialize step states
  for (const step of plan.steps) {
    execState.steps.set(step.id, {
      stepId: step.id,
      status: "pending",
      outputs: {},
      retryCount: 0,
    });
  }

  // Store on the job
  const job = getPluginState().jobs.get(plan.jobId);
  if (job) {
    job.executionState = execState;
  }

  emitEvent({
    type: "execution:start",
    jobId: plan.jobId,
    planId: plan.id,
    timestamp: startedAt,
    message: `Starting execution of plan "${plan.name}" (${plan.steps.length} steps)`,
    progress: { completed: 0, total: plan.steps.length, percentage: 0 },
  });

  const layers = topologicalSort(plan.steps);
  const completedSteps: MigrationStep[] = [];
  const errors: string[] = [];
  let failed = false;

  for (const layer of layers) {
    if (failed && failFast) break;

    // Execute steps in this layer with bounded concurrency
    const chunks: MigrationStep[][] = [];
    for (let i = 0; i < layer.length; i += maxConcurrency) {
      chunks.push(layer.slice(i, i + maxConcurrency));
    }

    for (const chunk of chunks) {
      if (failed && failFast) break;

      const results = await Promise.allSettled(
        chunk.map(async (step) => {
          const handler = resolveStepHandler(step.type);
          const stepState = execState.steps.get(step.id)!;

          // Check condition
          if (step.condition) {
            const condStepState = execState.steps.get(step.condition.stepId);
            if (condStepState) {
              if (step.condition.check === "succeeded" && condStepState.status !== "succeeded") {
                stepState.status = "skipped";
                return;
              }
              if (step.condition.check === "failed" && condStepState.status !== "failed") {
                stepState.status = "skipped";
                return;
              }
            }
          }

          // Resolve output references
          const resolvedParams = resolveOutputRefs(step.params, execState.resolvedOutputs);
          const merged = { ...plan.globalParams, ...resolvedParams };

          if (dryRun) {
            stepState.status = "succeeded";
            stepState.outputs = { dryRun: true };
            return;
          }

          // Idempotency check: skip execution if this exact operation completed before
          const idempotencyKey = generateIdempotencyKey(plan.jobId, step.id, merged);
          const existing = checkIdempotency(idempotencyKey);
          if (existing && existing.status === "succeeded") {
            stepState.status = "succeeded";
            stepState.outputs = existing.outputs;
            stepState.startedAt = existing.completedAt;
            stepState.completedAt = existing.completedAt;

            // Restore outputs for downstream steps
            for (const [key, value] of Object.entries(existing.outputs)) {
              execState.resolvedOutputs.set(`${step.id}.outputs.${key}`, value);
            }

            emitEvent({
              type: "step:complete",
              jobId: plan.jobId,
              stepId: step.id,
              stepName: step.name,
              timestamp: new Date().toISOString(),
              message: `Step "${step.name}" skipped (idempotent — already completed)`,
              outputs: existing.outputs,
            });

            completedSteps.push(step);
            return;
          }

          const ctx: MigrationStepContext = {
            params: merged,
            globalParams: plan.globalParams,
            tags: step.tags ?? {},
            log: createStepLogger(plan.jobId, step.id, step.name),
            signal: options.signal,
          };

          await executeStep(step, handler, ctx, stepState, plan.jobId, options);

          // Record successful execution in idempotency registry
          if (stepState.status === "succeeded") {
            recordIdempotency({
              idempotencyKey,
              jobId: plan.jobId,
              stepId: step.id,
              status: "succeeded",
              outputs: stepState.outputs,
              completedAt: stepState.completedAt ?? new Date().toISOString(),
            });
          }

          // Store outputs for downstream steps
          for (const [key, value] of Object.entries(stepState.outputs)) {
            execState.resolvedOutputs.set(`${step.id}.outputs.${key}`, value);
          }

          completedSteps.push(step);
        }),
      );

      // Check for failures
      for (const result of results) {
        if (result.status === "rejected") {
          const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
          errors.push(errorMsg);
          failed = true;
        }
      }
    }
  }

  if (failed && autoRollback) {
    execState.status = "rolling-back";
    emitEvent({
      type: "execution:failed",
      jobId: plan.jobId,
      planId: plan.id,
      timestamp: new Date().toISOString(),
      message: `Execution failed, rolling back ${completedSteps.length} completed steps`,
    });

    await rollbackSteps(
      completedSteps,
      execState,
      plan.jobId,
      plan.globalParams,
      options.globalTags ?? {},
    );
    execState.status = "rolled-back";
  } else if (failed) {
    execState.status = "failed";
  } else {
    execState.status = "succeeded";
  }

  const completedAt = new Date().toISOString();
  execState.completedAt = completedAt;
  execState.totalDurationMs = Date.now() - new Date(startedAt).getTime();

  const stepResults: MigrationStepExecutionResult[] = plan.steps.map((step) => {
    const ss = execState.steps.get(step.id)!;
    return {
      stepId: step.id,
      stepName: step.name,
      stepType: step.type,
      status: ss.status,
      durationMs: ss.durationMs ?? 0,
      outputs: ss.outputs,
      error: ss.error,
      rollbackError: ss.rollbackError,
    };
  });

  const allOutputs: Record<string, unknown> = {};
  for (const [key, value] of execState.resolvedOutputs) {
    allOutputs[key] = value;
  }

  emitEvent({
    type: execState.status === "succeeded" ? "execution:complete" : "execution:failed",
    jobId: plan.jobId,
    planId: plan.id,
    timestamp: completedAt,
    message: `Plan "${plan.name}" ${execState.status} in ${execState.totalDurationMs}ms`,
    progress: {
      completed: completedSteps.length,
      total: plan.steps.length,
      percentage: Math.round((completedSteps.length / plan.steps.length) * 100),
    },
  });

  return {
    planId: plan.id,
    planName: plan.name,
    jobId: plan.jobId,
    status: execState.status,
    startedAt,
    completedAt,
    totalDurationMs: execState.totalDurationMs,
    steps: stepResults,
    outputs: allOutputs,
    errors,
    integrityReports: [],
  };
}
