/**
 * IDIO — Intelligent Dynamic Infrastructure Orchestration
 *
 * Type definitions for the multi-step Azure orchestration engine.
 */

// =============================================================================
// Step Definitions
// =============================================================================

/** Unique identifier for a step type (e.g. "create-resource-group", "create-sql-server"). */
export type StepTypeId = string;

/** Unique identifier for a step instance within a plan. */
export type StepInstanceId = string;

/** Status of an individual step during execution. */
export type StepStatus =
  | "pending"
  | "waiting"   // waiting on dependencies
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "rolled-back";

/** Severity levels for validation issues. */
export type ValidationSeverity = "error" | "warning" | "info";

/**
 * A declared parameter for a step type.
 */
export type StepParameterDef = {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
};

/**
 * A declared output that a step produces.
 */
export type StepOutputDef = {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
};

/**
 * A registered step type that the orchestrator knows how to execute.
 */
export type StepTypeDefinition = {
  /** Unique type ID, e.g. "create-resource-group". */
  id: StepTypeId;
  /** Human-readable label. */
  label: string;
  /** What this step does. */
  description: string;
  /** Azure service category. */
  category: StepCategory;
  /** Parameters this step accepts. */
  parameters: StepParameterDef[];
  /** Outputs this step produces (available to downstream steps). */
  outputs: StepOutputDef[];
  /** Whether this step supports rollback. */
  rollbackSupported: boolean;
  /** Estimated duration hint for progress reporting. */
  estimatedDurationMs?: number;
};

export type StepCategory =
  | "resource-group"
  | "compute"
  | "data"
  | "networking"
  | "security"
  | "messaging"
  | "cdn"
  | "dns"
  | "ai"
  | "monitoring"
  | "platform";

// =============================================================================
// Step Instances (Plan Nodes)
// =============================================================================

/**
 * A reference to an output from another step, used for wiring dependencies.
 * Format: `${ stepInstanceId }.outputs.${ outputName }`
 */
export type StepOutputRef = `${string}.outputs.${string}`;

/**
 * A concrete step in an execution plan.
 */
export type PlanStep = {
  /** Unique instance ID within this plan. */
  id: StepInstanceId;
  /** The registered step type to execute. */
  type: StepTypeId;
  /** Human-readable name for this instance. */
  name: string;
  /** Input parameters — values or references to other step outputs. */
  params: Record<string, unknown | StepOutputRef>;
  /** Step instance IDs that must complete before this step runs. */
  dependsOn: StepInstanceId[];
  /** Condition: only run if this evaluates to true (default: always). */
  condition?: StepCondition;
  /** Override timeout for this step (ms). */
  timeoutMs?: number;
  /** Tags to apply to the created resource (if applicable). */
  tags?: Record<string, string>;
};

/** Condition that determines whether a step should execute. */
export type StepCondition = {
  /** Step instance ID to check. */
  stepId: StepInstanceId;
  /** Check type. */
  check: "succeeded" | "failed" | "output-equals" | "output-truthy";
  /** For output-equals: the output name to check. */
  outputName?: string;
  /** For output-equals: the expected value. */
  expectedValue?: unknown;
};

// =============================================================================
// Execution Plan
// =============================================================================

/**
 * A fully resolved execution plan — a DAG of steps.
 */
export type ExecutionPlan = {
  /** Unique plan ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this plan accomplishes. */
  description: string;
  /** The blueprint ID that generated this plan (if any). */
  blueprintId?: string;
  /** All steps in topological order. */
  steps: PlanStep[];
  /** Global parameters shared across all steps. */
  globalParams: Record<string, unknown>;
  /** When this plan was created. */
  createdAt: string;
  /** Estimated total duration (ms). */
  estimatedDurationMs?: number;
};

/**
 * Validation result for a plan.
 */
export type PlanValidation = {
  valid: boolean;
  issues: PlanValidationIssue[];
};

export type PlanValidationIssue = {
  severity: ValidationSeverity;
  stepId?: StepInstanceId;
  message: string;
  code: string;
};

// =============================================================================
// Execution State
// =============================================================================

/**
 * Runtime state for a single step during execution.
 */
export type StepExecutionState = {
  stepId: StepInstanceId;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  outputs: Record<string, unknown>;
  error?: string;
  rollbackError?: string;
  retryCount: number;
};

/**
 * Overall execution state for the plan.
 */
export type ExecutionState = {
  planId: string;
  status: "pending" | "running" | "succeeded" | "failed" | "rolling-back" | "rolled-back" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  totalDurationMs?: number;
  steps: Map<StepInstanceId, StepExecutionState>;
  /** Collected outputs from all completed steps, keyed by "stepId.outputs.name". */
  resolvedOutputs: Map<string, unknown>;
};

// =============================================================================
// Execution Options
// =============================================================================

/** Options controlling orchestration behavior. */
export type OrchestrationOptions = {
  /** If true, validate and report the plan without executing. */
  dryRun?: boolean;
  /** Maximum parallel steps (default: 4). */
  maxConcurrency?: number;
  /** Abort the entire plan on first failure (default: true). */
  failFast?: boolean;
  /** Automatically rollback completed steps on failure (default: true). */
  autoRollback?: boolean;
  /** Global timeout for the entire plan (ms, default: 600_000 = 10 min). */
  timeoutMs?: number;
  /** Per-step default timeout (ms, default: 120_000 = 2 min). */
  stepTimeoutMs?: number;
  /** Max retries per step (default: 1). */
  maxRetries?: number;
  /** Tags to merge into every step that creates resources. */
  globalTags?: Record<string, string>;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
};

// =============================================================================
// Events
// =============================================================================

export type OrchestrationEventType =
  | "plan:start"
  | "plan:complete"
  | "plan:failed"
  | "plan:cancelled"
  | "step:start"
  | "step:complete"
  | "step:failed"
  | "step:skipped"
  | "step:rollback-start"
  | "step:rollback-complete"
  | "step:rollback-failed"
  | "step:retry";

export type OrchestrationEvent = {
  type: OrchestrationEventType;
  planId: string;
  stepId?: StepInstanceId;
  stepName?: string;
  timestamp: string;
  message: string;
  error?: string;
  outputs?: Record<string, unknown>;
  progress?: { completed: number; total: number; percentage: number };
};

export type OrchestrationEventListener = (event: OrchestrationEvent) => void;

// =============================================================================
// Execution Result
// =============================================================================

/** Final result after plan execution completes. */
export type OrchestrationResult = {
  planId: string;
  planName: string;
  status: ExecutionState["status"];
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  steps: StepExecutionResult[];
  outputs: Record<string, unknown>;
  errors: string[];
};

export type StepExecutionResult = {
  stepId: StepInstanceId;
  stepName: string;
  stepType: StepTypeId;
  status: StepStatus;
  durationMs: number;
  outputs: Record<string, unknown>;
  error?: string;
  rollbackError?: string;
};

// =============================================================================
// Step Handler (implementation interface)
// =============================================================================

/** Context passed to step execute/rollback handlers. */
export type StepContext = {
  /** Resolved input parameters (refs already replaced with values). */
  params: Record<string, unknown>;
  /** Global parameters from the plan. */
  globalParams: Record<string, unknown>;
  /** Tags to apply (merged global + step-level). */
  tags: Record<string, string>;
  /** Logger. */
  log: StepLogger;
  /** Abort signal. */
  signal?: AbortSignal;
};

export type StepLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

/** The execute function for a step type. Returns outputs. */
export type StepExecuteFn = (ctx: StepContext) => Promise<Record<string, unknown>>;

/** Optional rollback function for a step type. Receives the outputs from execute. */
export type StepRollbackFn = (ctx: StepContext, outputs: Record<string, unknown>) => Promise<void>;

/** A registered handler implementing a step type. */
export type StepHandler = {
  execute: StepExecuteFn;
  rollback?: StepRollbackFn;
};

// =============================================================================
// Blueprints
// =============================================================================

/**
 * A blueprint is a reusable template for generating an execution plan.
 * Users provide blueprint parameters, and the blueprint generates PlanSteps.
 */
export type Blueprint = {
  /** Unique blueprint ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** What this blueprint deploys. */
  description: string;
  /** Category / use case. */
  category: BlueprintCategory;
  /** Parameters the user must provide. */
  parameters: BlueprintParameter[];
  /** Generate an execution plan from the provided params. */
  generate: (params: Record<string, unknown>) => ExecutionPlan;
};

export type BlueprintCategory =
  | "web-app"
  | "api"
  | "data"
  | "microservices"
  | "ai"
  | "messaging"
  | "custom";

export type BlueprintParameter = {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
  default?: unknown;
  choices?: unknown[];
};
