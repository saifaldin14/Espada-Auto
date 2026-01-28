/**
 * Infrastructure Extension Framework
 *
 * A comprehensive framework for building and managing infrastructure
 * providers within the Espada ecosystem.
 *
 * @module @espada/infrastructure
 */

// Core Types
export * from "./types.js";

// Provider Interface
export {
  type InfrastructureProvider,
  type InfrastructureProviderFactory,
  type ProviderFactoryOptions,
  type ProviderHealthCheck,
  type HealthCheckItem,
  BaseInfrastructureProvider,
} from "./provider.js";

// Logging Subsystem
export {
  type InfrastructureLogLevel,
  type InfrastructureLogEntry,
  type LogFormatter,
  type LogTransport,
  type InfrastructureLogger,
  type LogContext,
  compareLogLevels,
  shouldLog,
  createDefaultFormatter,
  ConsoleTransport,
  FileTransport,
  InfrastructureLoggerImpl,
  createInfrastructureLogger,
  getInfrastructureLogger,
  setGlobalInfrastructureLogger,
} from "./logging/index.js";

// Command Validation
export {
  type CommandValidationOptions,
  type CommandValidator,
  type ParameterValidationContext,
  type CommandValidationResult,
  InfrastructureCommandValidator,
  createCommandValidator,
  builtInValidators,
  validateCommand,
} from "./validation/command-validator.js";

// Configuration Validation
export {
  providerAuthConfigSchema,
  providerConfigEntrySchema,
  sessionConfigSchema,
  commandConfigSchema,
  logDestinationSchema,
  loggingConfigSchema,
  securityConfigSchema,
  infrastructureConfigSchema,
  validateInfrastructureConfig,
  validateProviderConfig,
  validateSessionConfig,
  validateCommandConfig,
  validateLoggingConfig,
  validateSecurityConfig,
  getDefaultInfrastructureConfig,
  mergeWithDefaults,
  getInfrastructureConfigJsonSchema,
} from "./validation/config-validator.js";

// Session Management
export {
  type CreateSessionOptions,
  type UpdateSessionOptions,
  type SessionQueryOptions,
  type SessionStorage,
  type SessionStatistics,
  InMemorySessionStorage,
  FileSessionStorage,
  InfrastructureSessionManager,
  createSessionManager,
} from "./session/index.js";

// Plugin Discovery
export {
  type PluginSource,
  type PluginDiscoveryOptions,
  InfrastructurePluginDiscoverer,
  createPluginDiscoverer,
  discoverInfrastructurePlugins,
} from "./discovery/index.js";

// Lifecycle Management
export {
  type ProviderRegistration,
  type LifecycleManagerOptions,
  type ProviderLifecycleEvent,
  type LifecycleStatistics,
  InfrastructureLifecycleManager,
  createLifecycleManager,
} from "./lifecycle/index.js";

// Provider Registry
export {
  type ProviderFactoryRegistration,
  type ProviderInstanceEntry,
  type RegistryOptions,
  type RegistryStatistics,
  InfrastructureProviderRegistry,
  createProviderRegistry,
} from "./registry.js";

// SDK for building providers
export {
  ProviderMetaBuilder,
  CommandBuilder,
  SimpleInfrastructureProvider,
  defineProvider,
  defineCommand,
  createSimpleProvider,
  success,
  failure,
  validation,
  type SimpleProviderOptions,
} from "./sdk/index.js";

// Security & Approval System
export {
  // Types
  type RiskLevel,
  type Environment,
  type OperationCategory,
  type ApprovalStatus,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalChainStep,
  type EscalationPolicy,
  type InfrastructurePermission,
  type InfrastructureRole,
  type InfrastructureUser,
  type PermissionCheck,
  type TimeWindow,
  type TimeWindowSchedule,
  type TimeWindowCheckResult,
  type AuditLogEntry,
  type AuditEventType,
  type BreakGlassSession,
  type BreakGlassPolicy,
  type BreakGlassReason,
  type RollbackPlan,
  type RollbackStep,
  type RiskAssessment,
  type RiskFactor,
  // Risk Scoring
  type RiskScoringConfig,
  type RiskContext,
  InfrastructureRiskScorer,
  createRiskScorer,
  defaultRiskScoringConfig,
  assessCommandRisk,
  // Approvals
  type ApprovalSystemConfig,
  type ApprovalChainTemplate,
  type ApprovalStorage,
  InMemoryApprovalStorage,
  InfrastructureApprovalManager,
  createApprovalManager,
  defaultApprovalConfig,
  // Audit Logger
  type AuditConfig,
  type AuditStorage,
  type AuditLogQuery,
  InMemoryAuditStorage,
  InfrastructureAuditLogger,
  createAuditLogger,
  defaultAuditConfig,
  // Rollback
  type RollbackConfig,
  type RollbackStorage,
  type CommandRollbackMapping,
  InMemoryRollbackStorage,
  InfrastructureRollbackManager,
  createRollbackManager,
  defaultRollbackConfig,
  // RBAC
  type RBACConfig,
  type RBACStorage,
  InMemoryRBACStorage,
  InfrastructureRBACManager,
  createRBACManager,
  defaultRBACConfig,
  DEFAULT_ROLES,
  // Time Windows
  type TimeWindowConfig,
  type TimeWindowStorage,
  InMemoryTimeWindowStorage,
  InfrastructureTimeWindowManager,
  createTimeWindowManager,
  defaultTimeWindowConfig,
  DEFAULT_TIME_WINDOWS,
  // Break Glass
  type BreakGlassConfig,
  type BreakGlassStorage,
  InMemoryBreakGlassStorage,
  InfrastructureBreakGlassManager,
  createBreakGlassManager,
  defaultBreakGlassConfig,
  DEFAULT_POLICIES,
  // Unified Security Facade
  type SecurityFacadeConfig,
  type SecurityFacadeStorage,
  type SecurityCheckResult,
  InfrastructureSecurityFacade,
  createSecurityFacade,
} from "./security/index.js";
