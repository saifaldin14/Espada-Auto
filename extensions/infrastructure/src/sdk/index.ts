/**
 * Infrastructure Extension Framework - SDK
 *
 * This module provides the SDK for building infrastructure providers
 * that integrate with the Espada infrastructure framework.
 */

import type {
  CommandExecutionContext,
  CommandExecutionResult,
  CommandParameter,
  InfrastructureCapability,
  InfrastructureCommand,
  InfrastructureCommandCategory,
  InfrastructureProviderCategory,
  InfrastructureProviderMeta,
  InfrastructureResourceType,
  ProviderAuthConfig,
  ProviderAuthMethod,
  ValidationResult,
} from "../types.js";
import { BaseInfrastructureProvider, type HealthCheckItem } from "../provider.js";
import { createInfrastructureLogger, type InfrastructureLogger } from "../logging/logger.js";

// =============================================================================
// Provider Builder
// =============================================================================

/**
 * Builder for creating infrastructure provider metadata
 */
export class ProviderMetaBuilder {
  private meta: Partial<InfrastructureProviderMeta> = {};

  id(id: string): this {
    this.meta.id = id;
    return this;
  }

  name(name: string): this {
    this.meta.name = name;
    return this;
  }

  displayName(displayName: string): this {
    this.meta.displayName = displayName;
    return this;
  }

  description(description: string): this {
    this.meta.description = description;
    return this;
  }

  version(version: string): this {
    this.meta.version = version;
    return this;
  }

  category(category: InfrastructureProviderCategory): this {
    this.meta.category = category;
    return this;
  }

  capabilities(...capabilities: InfrastructureCapability[]): this {
    this.meta.capabilities = capabilities;
    return this;
  }

  supportedResources(...resources: InfrastructureResourceType[]): this {
    this.meta.supportedResources = resources;
    return this;
  }

  authMethods(...methods: ProviderAuthMethod[]): this {
    this.meta.authMethods = methods;
    return this;
  }

  documentation(url: string): this {
    this.meta.documentation = url;
    return this;
  }

  homepage(url: string): this {
    this.meta.homepage = url;
    return this;
  }

  icon(icon: string): this {
    this.meta.icon = icon;
    return this;
  }

  build(): InfrastructureProviderMeta {
    if (!this.meta.id) throw new Error("Provider ID is required");
    if (!this.meta.name) throw new Error("Provider name is required");

    return {
      id: this.meta.id,
      name: this.meta.name,
      displayName: this.meta.displayName ?? this.meta.name,
      description: this.meta.description ?? "",
      version: this.meta.version ?? "1.0.0",
      category: this.meta.category ?? "custom",
      capabilities: this.meta.capabilities ?? [],
      supportedResources: this.meta.supportedResources ?? [],
      authMethods: this.meta.authMethods ?? ["api-key"],
      documentation: this.meta.documentation,
      homepage: this.meta.homepage,
      icon: this.meta.icon,
    };
  }
}

/**
 * Create a provider meta builder
 */
export function defineProvider(): ProviderMetaBuilder {
  return new ProviderMetaBuilder();
}

// =============================================================================
// Command Builder
// =============================================================================

/**
 * Builder for creating infrastructure commands
 */
export class CommandBuilder {
  private command: Partial<InfrastructureCommand> = {
    parameters: [],
    requiredCapabilities: [],
    examples: [],
  };

  id(id: string): this {
    this.command.id = id;
    return this;
  }

  name(name: string): this {
    this.command.name = name;
    return this;
  }

  description(description: string): this {
    this.command.description = description;
    return this;
  }

  category(category: InfrastructureCommandCategory): this {
    this.command.category = category;
    return this;
  }

  parameter(param: CommandParameter): this {
    this.command.parameters!.push(param);
    return this;
  }

  stringParam(
    name: string,
    description: string,
    options?: Partial<Omit<CommandParameter, "name" | "type" | "description">>,
  ): this {
    return this.parameter({
      name,
      type: "string",
      description,
      required: options?.required ?? false,
      default: options?.default,
      validation: options?.validation,
      sensitive: options?.sensitive,
    });
  }

  numberParam(
    name: string,
    description: string,
    options?: Partial<Omit<CommandParameter, "name" | "type" | "description">>,
  ): this {
    return this.parameter({
      name,
      type: "number",
      description,
      required: options?.required ?? false,
      default: options?.default,
      validation: options?.validation,
    });
  }

  booleanParam(
    name: string,
    description: string,
    options?: Partial<Omit<CommandParameter, "name" | "type" | "description">>,
  ): this {
    return this.parameter({
      name,
      type: "boolean",
      description,
      required: options?.required ?? false,
      default: options?.default,
    });
  }

  requiredCapabilities(...capabilities: InfrastructureCapability[]): this {
    this.command.requiredCapabilities = capabilities;
    return this;
  }

  supportsDryRun(value = true): this {
    this.command.supportsDryRun = value;
    return this;
  }

  dangerous(value = true): this {
    this.command.dangerous = value;
    return this;
  }

  example(description: string, parameters: Record<string, unknown>): this {
    this.command.examples!.push({ description, parameters });
    return this;
  }

  build(): InfrastructureCommand {
    if (!this.command.id) throw new Error("Command ID is required");
    if (!this.command.name) throw new Error("Command name is required");

    return {
      id: this.command.id,
      name: this.command.name,
      description: this.command.description ?? "",
      category: this.command.category ?? "utility",
      parameters: this.command.parameters ?? [],
      requiredCapabilities: this.command.requiredCapabilities ?? [],
      supportsDryRun: this.command.supportsDryRun ?? false,
      dangerous: this.command.dangerous ?? false,
      examples: this.command.examples ?? [],
    };
  }
}

/**
 * Create a command builder
 */
export function defineCommand(): CommandBuilder {
  return new CommandBuilder();
}

// =============================================================================
// Simple Provider Implementation
// =============================================================================

/**
 * Options for creating a simple provider
 */
export type SimpleProviderOptions = {
  meta: InfrastructureProviderMeta;
  commands?: InfrastructureCommand[];
  onInitialize?: (auth: ProviderAuthConfig, logger: InfrastructureLogger) => Promise<void>;
  onStart?: (logger: InfrastructureLogger) => Promise<void>;
  onStop?: (logger: InfrastructureLogger) => Promise<void>;
  onDestroy?: (logger: InfrastructureLogger) => Promise<void>;
  onHealthCheck?: (logger: InfrastructureLogger) => Promise<HealthCheckItem[]>;
  onValidateConfig?: (
    config: Record<string, unknown>,
    logger: InfrastructureLogger,
  ) => Promise<ValidationResult>;
  onExecuteCommand?: <T>(
    command: InfrastructureCommand,
    parameters: Record<string, unknown>,
    context: CommandExecutionContext,
    logger: InfrastructureLogger,
  ) => Promise<CommandExecutionResult<T>>;
};

/**
 * Simple infrastructure provider implementation
 *
 * Provides a convenient way to create providers without extending
 * the base class directly.
 */
export class SimpleInfrastructureProvider extends BaseInfrastructureProvider {
  readonly meta: InfrastructureProviderMeta;
  private options: SimpleProviderOptions;

  constructor(options: SimpleProviderOptions, logger?: InfrastructureLogger) {
    super(logger ?? createInfrastructureLogger(options.meta.id));
    this.meta = options.meta;
    this.options = options;

    // Register commands
    if (options.commands) {
      for (const command of options.commands) {
        this.registerCommand(command);
      }
    }
  }

  protected async onInitialize(auth: ProviderAuthConfig): Promise<void> {
    if (this.options.onInitialize) {
      await this.options.onInitialize(auth, this._logger);
    }
  }

  protected async onStart(): Promise<void> {
    if (this.options.onStart) {
      await this.options.onStart(this._logger);
    }
  }

  protected async onStop(): Promise<void> {
    if (this.options.onStop) {
      await this.options.onStop(this._logger);
    }
  }

  protected async onDestroy(): Promise<void> {
    if (this.options.onDestroy) {
      await this.options.onDestroy(this._logger);
    }
  }

  protected async performHealthChecks(): Promise<HealthCheckItem[]> {
    if (this.options.onHealthCheck) {
      return this.options.onHealthCheck(this._logger);
    }
    return [{ name: "default", status: "healthy" }];
  }

  protected async onValidateConfig(config: Record<string, unknown>): Promise<ValidationResult> {
    if (this.options.onValidateConfig) {
      return this.options.onValidateConfig(config, this._logger);
    }
    return { valid: true, errors: [], warnings: [] };
  }

  protected async onExecuteCommand<T>(
    command: InfrastructureCommand,
    parameters: Record<string, unknown>,
    context: CommandExecutionContext,
    _log: (entry: { level: "trace" | "debug" | "info" | "warn" | "error"; message: string }) => void,
  ): Promise<Omit<CommandExecutionResult<T>, "duration" | "logs">> {
    if (this.options.onExecuteCommand) {
      const result = await this.options.onExecuteCommand<T>(
        command,
        parameters,
        context,
        this._logger,
      );
      return {
        success: result.success,
        data: result.data,
        error: result.error,
        resourcesAffected: result.resourcesAffected,
        rollbackAvailable: result.rollbackAvailable,
      };
    }

    return {
      success: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: `Command ${command.id} is not implemented`,
        recoverable: false,
      },
      resourcesAffected: [],
      rollbackAvailable: false,
    };
  }
}

/**
 * Create a simple provider
 */
export function createSimpleProvider(
  options: SimpleProviderOptions,
  logger?: InfrastructureLogger,
): SimpleInfrastructureProvider {
  return new SimpleInfrastructureProvider(options, logger);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a success result
 */
export function success<T>(data: T, resourcesAffected: string[] = []): CommandExecutionResult<T> {
  return {
    success: true,
    data,
    duration: 0,
    logs: [],
    resourcesAffected,
    rollbackAvailable: false,
  };
}

/**
 * Create a failure result
 */
export function failure(
  code: string,
  message: string,
  options?: {
    details?: Record<string, unknown>;
    recoverable?: boolean;
    rollbackAvailable?: boolean;
  },
): CommandExecutionResult {
  return {
    success: false,
    error: {
      code,
      message,
      details: options?.details,
      recoverable: options?.recoverable ?? false,
    },
    duration: 0,
    logs: [],
    resourcesAffected: [],
    rollbackAvailable: options?.rollbackAvailable ?? false,
  };
}

/**
 * Validation helpers
 */
export const validation = {
  ok: (): ValidationResult => ({ valid: true, errors: [], warnings: [] }),
  error: (code: string, message: string, path: string[] = []): ValidationResult => ({
    valid: false,
    errors: [{ code, path, message }],
    warnings: [],
  }),
  warning: (code: string, message: string, path: string[] = []): ValidationResult => ({
    valid: true,
    errors: [],
    warnings: [{ code, path, message }],
  }),
};
