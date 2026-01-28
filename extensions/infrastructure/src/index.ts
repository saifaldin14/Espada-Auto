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
