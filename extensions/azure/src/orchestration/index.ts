/**
 * IDIO — Intelligent Dynamic Infrastructure Orchestration
 *
 * Public API for the Azure orchestration engine.
 */

// Types
export type {
  StepTypeId,
  StepInstanceId,
  StepStatus,
  StepParameterDef,
  StepOutputDef,
  StepTypeDefinition,
  StepCategory,
  PlanStep,
  StepCondition,
  StepOutputRef,
  ExecutionPlan,
  PlanValidation,
  PlanValidationIssue,
  StepExecutionState,
  ExecutionState,
  OrchestrationOptions,
  OrchestrationEvent,
  OrchestrationResult,
  StepExecutionResult,
  StepContext,
  StepLogger,
  StepExecuteFn,
  StepRollbackFn,
  StepHandler,
  Blueprint,
  BlueprintCategory,
  BlueprintParameter,
} from "./types.js";

// Registry
export {
  registerStepType,
  getStepDefinition,
  getStepHandler,
  listStepTypes,
  listStepTypesByCategory,
  hasStepType,
  unregisterStepType,
  clearStepRegistry,
} from "./registry.js";

// Built-in steps
export {
  BUILTIN_STEP_DEFINITIONS,
  registerBuiltinSteps,
  registerBuiltinStepsDryRun,
} from "./steps.js";

// Planner
export {
  validatePlan,
  topologicalSort,
  flattenLayers,
  isOutputRef,
  parseOutputRef,
  resolveStepParams,
  evaluateCondition,
} from "./planner.js";

// Engine
export {
  Orchestrator,
  orchestrate,
} from "./engine.js";
export type { OrchestrationEventListener } from "./engine.js";

// Blueprints
export {
  BUILTIN_BLUEPRINTS,
  getBlueprint,
  listBlueprints,
  registerBlueprint,
  webAppWithSqlBlueprint,
  staticWebWithCdnBlueprint,
  apiBackendBlueprint,
  microservicesBackboneBlueprint,
  dataPlatformBlueprint,
} from "./blueprints.js";
