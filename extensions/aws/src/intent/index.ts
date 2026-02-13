/**
 * AWS Intent Module
 * 
 * Type definitions, schema validation, and compilation for
 * Intent-Driven Infrastructure Orchestration (IDIO).
 */

// Types
export type {
  ComplianceFramework,
  ApplicationTier,
  TrafficPattern,
  ApplicationTierIntent,
  ApplicationIntent,
  InfrastructurePlan,
  PlannedResource,
  CostBreakdownItem,
  PolicyValidationResult,
  GuardrailCheckResult,
  IntentExecutionResult,
  ProvisionedResource,
  ExecutionError,
  ReconciliationResult,
  IntentTemplate,
} from './types.js';

// Schema validation
export {
  validateIntent,
  ApplicationIntentSchema,
  EXAMPLE_INTENTS,
} from './schema.js';

// Compiler
export {
  IntentCompiler,
  createIntentCompiler,
} from './compiler.js';

export type {
  CompilerConfig,
  CompilerContext,
  CostProvider,
} from './compiler.js';
