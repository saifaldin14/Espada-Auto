/**
 * Infrastructure Validation Module Index
 */

export {
  type CommandValidationOptions,
  type CommandValidator,
  type ParameterValidationContext,
  type CommandValidationResult,
  InfrastructureCommandValidator,
  createCommandValidator,
  builtInValidators,
  validateCommand,
} from "./command-validator.js";

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
} from "./config-validator.js";
