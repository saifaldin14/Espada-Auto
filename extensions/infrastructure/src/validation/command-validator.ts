/**
 * Infrastructure Command Validation Framework
 *
 * This module provides a comprehensive command validation system for
 * infrastructure operations, including parameter validation, security
 * checks, and execution policy enforcement.
 */

import { z } from "zod";
import type {
  CommandConfig,
  CommandExecutionContext,
  CommandParameter,
  InfrastructureCommand,
  ValidationError,
  ValidationResult,
  ValidationWarning,
} from "../types.js";
import type { InfrastructureLogger } from "../logging/logger.js";

// =============================================================================
// Validation Types
// =============================================================================

/**
 * Command validation options
 */
export type CommandValidationOptions = {
  strict: boolean;
  allowDryRun: boolean;
  requireConfirmation: boolean;
  dangerousCommandsRequireExplicit: boolean;
  customValidators?: CommandValidator[];
};

/**
 * Custom command validator
 */
export type CommandValidator = {
  name: string;
  validate: (
    command: InfrastructureCommand,
    parameters: Record<string, unknown>,
    context: CommandExecutionContext,
  ) => ValidationResult | Promise<ValidationResult>;
};

/**
 * Parameter validation context
 */
export type ParameterValidationContext = {
  command: InfrastructureCommand;
  parameter: CommandParameter;
  value: unknown;
  allParameters: Record<string, unknown>;
  executionContext: CommandExecutionContext;
};

// =============================================================================
// Parameter Type Validators
// =============================================================================

/**
 * Zod schemas for parameter types
 */
const parameterTypeSchemas = {
  string: z.string(),
  number: z.number(),
  boolean: z.boolean(),
  array: z.array(z.unknown()),
  object: z.record(z.unknown()),
  file: z.string().min(1, "File path cannot be empty"),
  secret: z.string().min(1, "Secret value cannot be empty"),
  "resource-ref": z.string().regex(/^[a-z0-9-]+:[a-z0-9-]+$/, "Invalid resource reference format"),
};

/**
 * Validate a single parameter value
 */
function validateParameterValue(
  param: CommandParameter,
  value: unknown,
): { valid: boolean; errors: string[]; coercedValue?: unknown } {
  const errors: string[] = [];

  // Check required
  if (param.required && (value === undefined || value === null)) {
    return { valid: false, errors: [`Parameter '${param.name}' is required`] };
  }

  // If not provided and not required, use default
  if (value === undefined || value === null) {
    return { valid: true, errors: [], coercedValue: param.default };
  }

  // Type validation
  const schema = parameterTypeSchemas[param.type];
  if (schema) {
    const result = schema.safeParse(value);
    if (!result.success) {
      errors.push(
        `Parameter '${param.name}' has invalid type: expected ${param.type}, got ${typeof value}`,
      );
      return { valid: false, errors };
    }
  }

  // Additional validations
  if (param.validation) {
    // Pattern validation for strings
    if (param.validation.pattern && typeof value === "string") {
      const pattern = new RegExp(param.validation.pattern);
      if (!pattern.test(value)) {
        errors.push(
          `Parameter '${param.name}' does not match pattern: ${param.validation.pattern}`,
        );
      }
    }

    // Min/max for numbers
    if (typeof value === "number") {
      if (param.validation.min !== undefined && value < param.validation.min) {
        errors.push(
          `Parameter '${param.name}' must be at least ${param.validation.min}, got ${value}`,
        );
      }
      if (param.validation.max !== undefined && value > param.validation.max) {
        errors.push(
          `Parameter '${param.name}' must be at most ${param.validation.max}, got ${value}`,
        );
      }
    }

    // Enum validation
    if (param.validation.enum && !param.validation.enum.includes(value)) {
      errors.push(
        `Parameter '${param.name}' must be one of: ${param.validation.enum.join(", ")}`,
      );
    }

    // Custom validation
    if (param.validation.custom && !param.validation.custom(value)) {
      errors.push(`Parameter '${param.name}' failed custom validation`);
    }
  }

  return { valid: errors.length === 0, errors, coercedValue: value };
}

// =============================================================================
// Command Validator Implementation
// =============================================================================

/**
 * Infrastructure command validator
 */
export class InfrastructureCommandValidator {
  private options: CommandValidationOptions;
  private logger: InfrastructureLogger;
  private customValidators: CommandValidator[];

  constructor(options: Partial<CommandValidationOptions>, logger: InfrastructureLogger) {
    this.options = {
      strict: options.strict ?? true,
      allowDryRun: options.allowDryRun ?? true,
      requireConfirmation: options.requireConfirmation ?? false,
      dangerousCommandsRequireExplicit: options.dangerousCommandsRequireExplicit ?? true,
      customValidators: options.customValidators ?? [],
    };
    this.logger = logger;
    this.customValidators = this.options.customValidators;
  }

  /**
   * Validate a command with parameters
   */
  async validate(
    command: InfrastructureCommand,
    parameters: Record<string, unknown>,
    context: CommandExecutionContext,
  ): Promise<CommandValidationResult> {
    this.logger.debug(`Validating command: ${command.id}`, { parameters: Object.keys(parameters) });

    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const coercedParameters: Record<string, unknown> = {};

    // Validate parameters
    const paramValidation = this.validateParameters(command, parameters);
    errors.push(...paramValidation.errors);
    warnings.push(...paramValidation.warnings);
    Object.assign(coercedParameters, paramValidation.coercedParameters);

    // Validate execution context
    const contextValidation = this.validateContext(command, context);
    errors.push(...contextValidation.errors);
    warnings.push(...contextValidation.warnings);

    // Validate dangerous command requirements
    if (command.dangerous) {
      const dangerValidation = this.validateDangerousCommand(command, context);
      errors.push(...dangerValidation.errors);
      warnings.push(...dangerValidation.warnings);
    }

    // Run custom validators
    for (const validator of this.customValidators) {
      try {
        const result = await validator.validate(command, parameters, context);
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      } catch (error) {
        errors.push({
          code: "CUSTOM_VALIDATOR_ERROR",
          path: [],
          message: `Custom validator '${validator.name}' failed: ${error}`,
        });
      }
    }

    const valid = errors.length === 0;

    if (!valid) {
      this.logger.warn(`Command validation failed: ${command.id}`, {
        errorCount: errors.length,
        errors: errors.map((e) => e.message),
      });
    }

    return {
      valid,
      errors,
      warnings,
      coercedParameters,
      requiresConfirmation: command.dangerous && this.options.requireConfirmation,
    };
  }

  /**
   * Validate command parameters
   */
  private validateParameters(
    command: InfrastructureCommand,
    parameters: Record<string, unknown>,
  ): {
    errors: ValidationError[];
    warnings: ValidationWarning[];
    coercedParameters: Record<string, unknown>;
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const coercedParameters: Record<string, unknown> = {};

    // Validate each defined parameter
    for (const param of command.parameters) {
      const value = parameters[param.name];
      const result = validateParameterValue(param, value);

      if (!result.valid) {
        for (const error of result.errors) {
          errors.push({
            code: "PARAMETER_VALIDATION_FAILED",
            path: [param.name],
            message: error,
            value,
          });
        }
      } else {
        coercedParameters[param.name] = result.coercedValue;
      }

      // Warn about sensitive parameters
      if (param.sensitive && value !== undefined) {
        warnings.push({
          code: "SENSITIVE_PARAMETER",
          path: [param.name],
          message: `Parameter '${param.name}' contains sensitive data`,
          suggestion: "Ensure this value is properly secured",
        });
      }
    }

    // Check for unknown parameters in strict mode
    if (this.options.strict) {
      const definedParams = new Set(command.parameters.map((p) => p.name));
      for (const key of Object.keys(parameters)) {
        if (!definedParams.has(key)) {
          errors.push({
            code: "UNKNOWN_PARAMETER",
            path: [key],
            message: `Unknown parameter: ${key}`,
            value: parameters[key],
          });
        }
      }
    }

    return { errors, warnings, coercedParameters };
  }

  /**
   * Validate execution context
   */
  private validateContext(
    command: InfrastructureCommand,
    context: CommandExecutionContext,
  ): {
    errors: ValidationError[];
    warnings: ValidationWarning[];
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validate dry-run support
    if (context.dryRun && !command.supportsDryRun) {
      if (this.options.allowDryRun) {
        warnings.push({
          code: "DRY_RUN_NOT_SUPPORTED",
          path: ["context", "dryRun"],
          message: `Command '${command.id}' does not support dry-run mode`,
          suggestion: "The command will be executed normally",
        });
      } else {
        errors.push({
          code: "DRY_RUN_NOT_SUPPORTED",
          path: ["context", "dryRun"],
          message: `Command '${command.id}' does not support dry-run mode`,
        });
      }
    }

    // Validate timeout
    if (context.timeout <= 0) {
      errors.push({
        code: "INVALID_TIMEOUT",
        path: ["context", "timeout"],
        message: "Timeout must be a positive number",
        value: context.timeout,
      });
    }

    // Validate session
    if (!context.sessionId) {
      errors.push({
        code: "MISSING_SESSION",
        path: ["context", "sessionId"],
        message: "Session ID is required for command execution",
      });
    }

    return { errors, warnings };
  }

  /**
   * Validate dangerous command requirements
   */
  private validateDangerousCommand(
    command: InfrastructureCommand,
    context: CommandExecutionContext,
  ): {
    errors: ValidationError[];
    warnings: ValidationWarning[];
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    warnings.push({
      code: "DANGEROUS_COMMAND",
      path: [],
      message: `Command '${command.id}' is marked as dangerous`,
      suggestion: "Review the command parameters carefully before execution",
    });

    if (this.options.dangerousCommandsRequireExplicit) {
      const hasExplicitConfirm = context.variables["__confirm_dangerous__"] === true;
      if (!hasExplicitConfirm && !context.dryRun) {
        errors.push({
          code: "DANGEROUS_COMMAND_NOT_CONFIRMED",
          path: [],
          message: `Dangerous command '${command.id}' requires explicit confirmation`,
        });
      }
    }

    return { errors, warnings };
  }

  /**
   * Register a custom validator
   */
  registerValidator(validator: CommandValidator): void {
    this.customValidators.push(validator);
  }

  /**
   * Remove a custom validator
   */
  removeValidator(name: string): boolean {
    const index = this.customValidators.findIndex((v) => v.name === name);
    if (index >= 0) {
      this.customValidators.splice(index, 1);
      return true;
    }
    return false;
  }
}

/**
 * Extended validation result with coerced parameters
 */
export type CommandValidationResult = ValidationResult & {
  coercedParameters: Record<string, unknown>;
  requiresConfirmation: boolean;
};

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Create a command validator from configuration
 */
export function createCommandValidator(
  config: CommandConfig,
  logger: InfrastructureLogger,
): InfrastructureCommandValidator {
  return new InfrastructureCommandValidator(config.validation, logger);
}

/**
 * Built-in validators
 */
export const builtInValidators: CommandValidator[] = [
  {
    name: "resource-exists",
    validate: async (command, parameters) => {
      const errors: ValidationError[] = [];
      const warnings: ValidationWarning[] = [];

      // Check for resource reference parameters
      for (const param of command.parameters) {
        if (param.type === "resource-ref" && parameters[param.name]) {
          // In a real implementation, this would check if the resource exists
          warnings.push({
            code: "RESOURCE_REFERENCE",
            path: [param.name],
            message: `Resource reference '${parameters[param.name]}' will be validated at execution time`,
          });
        }
      }

      return { valid: true, errors, warnings };
    },
  },
  {
    name: "capability-check",
    validate: async (command, _parameters, context) => {
      const errors: ValidationError[] = [];
      const warnings: ValidationWarning[] = [];

      // This validator would check if the provider has required capabilities
      if (command.requiredCapabilities.length > 0) {
        warnings.push({
          code: "CAPABILITY_CHECK",
          path: [],
          message: `Command requires capabilities: ${command.requiredCapabilities.join(", ")}`,
        });
      }

      return { valid: true, errors, warnings };
    },
  },
];

/**
 * Quick validation helper
 */
export async function validateCommand(
  command: InfrastructureCommand,
  parameters: Record<string, unknown>,
  context: CommandExecutionContext,
  options?: Partial<CommandValidationOptions>,
  logger?: InfrastructureLogger,
): Promise<CommandValidationResult> {
  const validator = new InfrastructureCommandValidator(
    options ?? {},
    logger ?? (await import("../logging/logger.js")).getInfrastructureLogger("validation"),
  );

  // Register built-in validators
  for (const v of builtInValidators) {
    validator.registerValidator(v);
  }

  return validator.validate(command, parameters, context);
}
