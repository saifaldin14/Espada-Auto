/**
 * IDIO — Intelligent Dynamic Infrastructure Orchestration (GCP)
 *
 * Type definitions for the multi-step GCP orchestration engine.
 */

// =============================================================================
// Step Categories
// =============================================================================

export type StepCategory =
  | "foundation"
  | "compute"
  | "storage"
  | "database"
  | "networking"
  | "security"
  | "monitoring"
  | "messaging"
  | "ai"
  | "platform"
  | "custom";

// =============================================================================
// Step Definitions
// =============================================================================

/**
 * A concrete step in an execution plan.
 */
export type PlanStep = {
  /** Unique instance ID within this plan. */
  id: string;
  /** The registered step type to execute. */
  type: string;
  /** Human-readable name for this instance. */
  name: string;
  /** Input parameters — values or output references ($step.X.Y). */
  params: Record<string, unknown>;
  /** Step instance IDs that must complete before this step runs. */
  dependsOn?: string[];
  /** Condition: only run if this evaluates to true. */
  condition?: StepCondition;
  /** Whether to trigger rollback if this step fails. */
  rollbackOnFailure?: boolean;
  /** Override timeout for this step (ms). */
  timeout?: number;
};

/**
 * Condition that determines whether a step should execute.
 */
export type StepCondition = {
  /** Step instance ID to check. */
  stepId: string;
  /** Check type. */
  check: "succeeded" | "failed" | "skipped" | "completed";
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
  /** All steps in the plan. */
  steps: PlanStep[];
  /** Global parameters shared across all steps. */
  params: Record<string, unknown>;
  /** When this plan was created. */
  createdAt: string;
};

// =============================================================================
// Execution Results
// =============================================================================

/**
 * Runtime result for a single step after execution.
 */
export type StepResult = {
  stepId: string;
  stepName: string;
  stepType: string;
  status: "completed" | "failed" | "skipped" | "rolled-back";
  outputs: Record<string, unknown>;
  durationMs: number;
  error?: string;
  startedAt: string;
  completedAt: string;
};

/**
 * Overall orchestration result for the entire plan.
 */
export type OrchestrationResult = {
  planId: string;
  planName: string;
  status: "completed" | "failed" | "partial" | "rolled-back";
  steps: StepResult[];
  outputs: Record<string, Record<string, unknown>>;
  errors: string[];
  totalDurationMs: number;
  startedAt: string;
  completedAt: string;
};

// =============================================================================
// Step Type Registry
// =============================================================================

/**
 * A registered step type definition that the orchestrator knows how to execute.
 */
export type StepDefinition = {
  /** Unique type ID (e.g. "create-gcs-bucket"). */
  type: string;
  /** GCP service category. */
  category: StepCategory;
  /** What this step does. */
  description: string;
  /** Parameter names this step requires. */
  requiredParams: string[];
  /** Parameter names this step optionally accepts. */
  optionalParams: string[];
  /** Output names this step produces (available to downstream steps). */
  outputs: string[];
};

/**
 * Runtime handler for a step type.
 */
export type StepHandler = {
  /** Execute the step and return outputs. */
  execute: (ctx: StepExecutionContext) => Promise<Record<string, unknown>>;
  /** Optional rollback logic to undo this step's effects. */
  rollback?: (ctx: StepExecutionContext, outputs: Record<string, unknown>) => Promise<void>;
};

/**
 * Context passed to a step handler during execution.
 */
export type StepExecutionContext = {
  /** The step instance ID. */
  stepId: string;
  /** Resolved input parameters. */
  params: Record<string, unknown>;
  /** Outputs from all previously completed steps, keyed by step ID. */
  outputs: Record<string, Record<string, unknown>>;
  /** Whether this is a dry-run (no real resources created). */
  dryRun: boolean;
  /** Logger for this step. */
  logger: StepLogger;
};

export type StepLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

// =============================================================================
// Orchestration Options
// =============================================================================

/**
 * Options to control orchestration behavior.
 */
export type OrchestrationOptions = {
  /** Skip real execution; return placeholder outputs. */
  dryRun?: boolean;
  /** Labels applied to all created GCP resources. */
  globalLabels?: Record<string, string>;
  /** Max number of steps to execute concurrently. */
  concurrency?: number;
  /** Callback fired when a step begins. */
  onStepStart?: (stepId: string) => void;
  /** Callback fired when a step completes. */
  onStepComplete?: (stepId: string, result: StepResult) => void;
};

// =============================================================================
// Blueprints
// =============================================================================

export type BlueprintCategory =
  | "web-app"
  | "api"
  | "data"
  | "microservices"
  | "ai"
  | "messaging"
  | "serverless"
  | "custom";

/**
 * A declared parameter for a blueprint.
 */
export type BlueprintParameter = {
  name: string;
  description: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  default?: unknown;
  choices?: string[];
};

/**
 * A reusable, parameterized template that generates an ExecutionPlan
 * for a common GCP architecture pattern.
 */
export type Blueprint = {
  id: string;
  name: string;
  description: string;
  category: BlueprintCategory;
  parameters: BlueprintParameter[];
  generate: (params: Record<string, unknown>) => ExecutionPlan;
};
