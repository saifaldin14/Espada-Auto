/**
 * IDIO (Intent-Driven Infrastructure Orchestration) Module
 * 
 * Complete declarative infrastructure management for AWS:
 * - Intent compilation and validation
 * - Policy enforcement
 * - Execution with real AWS provisioning
 * - State persistence
 * - Drift detection and reconciliation
 * - AI Agent tool integration
 */

// Orchestrator
export {
  IDIOOrchestrator,
  createIDIOOrchestrator,
  IntentValidationError,
  PlanExecutionError,
  TemplateNotFoundError,
} from './orchestrator.js';

export type {
  IDIOConfig,
  IDIOResult,
} from './orchestrator.js';

// Execution Engine
export {
  AWSExecutionEngine,
  createExecutionEngine,
} from './execution-engine.js';

export type {
  ExecutionEngineConfig,
  ExecutionStep,
  ResourceExecutionContext,
} from './execution-engine.js';

// State Store
export {
  IDIOStateStore,
  createStateStore,
} from './state-store.js';

export type {
  StateStoreConfig,
  StoredPlan,
  StoredExecution,
  StoredResource,
  StoredDriftRecord,
  StoredAuditLog,
  QueryOptions,
  QueryResult,
  StateStoreResult,
} from './state-store.js';

// Tool Definitions for AI Agent Integration
export {
  IDIOToolHandler,
  createIDIOToolHandler,
  idioToolDefinitions,
} from './tools.js';

export type {
  ToolDefinition,
  ParameterDefinition,
  ToolResult,
} from './tools.js';
