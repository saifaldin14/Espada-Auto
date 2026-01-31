/**
 * AWS Guardrails & Approval Workflows Module
 *
 * Exports the guardrails manager and all types.
 */

export { createGuardrailsManager, type GuardrailsManager } from './manager.js';

export type {
  // Core types
  GuardrailsOperationResult,
  Environment,
  ActionSeverity,
  ActionType,
  DayOfWeek,
  
  // Approval workflow types
  ApprovalStatus,
  Approver,
  ApprovalRequest,
  ApprovalResponse,
  ImpactAssessment,
  ResourceDependency,
  
  // Dry run types
  DryRunResult,
  AffectedResource,
  PlannedChange,
  
  // Environment protection types
  EnvironmentProtection,
  TimeWindow,
  RequiredTag,
  
  // Audit logging types
  AuditLogEntry,
  AuditLogQueryOptions,
  AuditLogQueryResult,
  AuditLogSummary,
  
  // Rate limiting types
  RateLimitConfig,
  RateLimitStatus,
  
  // Safety check types
  SafetyCheckConfig,
  SafetyCheckResult,
  SafetyCheck,
  
  // Ticketing types
  TicketingSystem,
  TicketInfo,
  TicketingIntegrationConfig,
  
  // Change request types
  ChangeRequest,
  PlannedAction,
  
  // Configuration types
  GuardrailsManagerConfig,
  
  // Action classification types
  ActionClassification,
  
  // Backup types
  PreOperationBackup,
  
  // Notification types
  NotificationChannelConfig,
  NotificationEvent,
  NotificationPayload,
  
  // Policy types
  GuardrailsPolicy,
  PolicyCondition,
  PolicyAction,
  
  // Operation context types
  OperationContext,
  GuardrailsEvaluationResult,
} from './types.js';

export { DEFAULT_ACTION_CLASSIFICATIONS } from './types.js';
