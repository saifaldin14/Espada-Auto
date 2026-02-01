/**
 * AWS Enhanced Conversational UX Module
 *
 * Exports for infrastructure context management, proactive insights,
 * natural language queries, and wizard-mode guided infrastructure creation.
 */

// Export types
export type {
  // Common types
  ConversationalOperationResult,
  ConversationalManagerConfig,

  // Context types
  EnvironmentType,
  TrackedResourceType,
  ResourceReference,
  OperationRecord,
  InfrastructureContext,
  ResourceFilter,

  // Insight types
  InsightSeverity,
  InsightCategory,
  InsightStatus,
  ProactiveInsight,
  InsightImpact,
  InsightRecommendation,
  InsightCheckConfig,
  GetInsightsOptions,

  // Query types
  QueryIntent,
  TimeRangeType,
  ParsedQuery,
  QueryResult,
  QueryPattern,

  // Wizard types
  WizardType,
  WizardStepType,
  WizardStepOption,
  WizardStep,
  WizardExecutionPlan,
  PlannedResource,
  WizardState,
  WizardTemplate,

  // Summary types
  InfrastructureSummary,
  SessionSummary,

  // Manager interface
  ConversationalManager,
} from './types.js';

// Export constants
export {
  WIZARD_TEMPLATES,
  INSIGHT_CHECKS,
  QUERY_PATTERNS,
} from './types.js';

// Export manager
export {
  AWSConversationalManager,
  createConversationalManager,
} from './manager.js';
