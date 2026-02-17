/**
 * IDIO — Intelligent Dynamic Infrastructure Orchestration (GCP)
 *
 * Public API for the GCP orchestration engine.
 */

// Types
export type {
  StepCategory,
  PlanStep,
  StepCondition,
  ExecutionPlan,
  StepResult,
  OrchestrationResult,
  StepDefinition,
  StepHandler,
  StepExecutionContext,
  StepLogger,
  OrchestrationOptions,
  BlueprintCategory,
  BlueprintParameter,
  Blueprint,
} from "./types.js";

// Step registry
export {
  registerStepType,
  getStepDefinition,
  getStepHandler,
  listStepTypes,
  hasStepType,
  clearStepRegistry,
  BUILTIN_STEP_DEFINITIONS,
  registerBuiltinSteps,
  registerBuiltinStepsDryRun,
} from "./steps.js";
export type { ResourceManagerFactories } from "./steps.js";

// Planner
export {
  validatePlan,
  topologicalSort,
  resolveStepParams,
  evaluateCondition,
} from "./planner.js";

// Engine
export { Orchestrator } from "./engine.js";

// Blueprints
export {
  registerBlueprint,
  getBlueprint,
  listBlueprints,
  BUILTIN_BLUEPRINTS,
  registerBuiltinBlueprints,
  webAppWithSqlBlueprint,
  staticSiteWithCdnBlueprint,
  apiBackendBlueprint,
  microservicesBackboneBlueprint,
  dataPlatformBlueprint,
} from "./blueprints.js";
