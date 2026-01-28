/**
 * Infrastructure Provider Interface
 *
 * This module defines the core interface that all infrastructure providers
 * must implement to integrate with the Espada infrastructure framework.
 */

import type {
  CommandExecutionContext,
  CommandExecutionResult,
  InfrastructureCapability,
  InfrastructureCommand,
  InfrastructureProviderMeta,
  InfrastructureResourceType,
  LifecycleContext,
  LifecycleHookHandler,
  LifecycleHookName,
  ProviderAuthConfig,
  ProviderHealthStatus,
  ProviderLifecycleState,
  ResourceState,
  ValidationResult,
} from "./types.js";
import type { InfrastructureLogger } from "./logging/logger.js";

// =============================================================================
// Provider Interface
// =============================================================================

/**
 * Core infrastructure provider interface
 *
 * All infrastructure providers must implement this interface to be compatible
 * with the Espada infrastructure framework.
 */
export interface InfrastructureProvider {
  /**
   * Provider metadata
   */
  readonly meta: InfrastructureProviderMeta;

  /**
   * Current lifecycle state
   */
  readonly state: ProviderLifecycleState;

  /**
   * Provider logger instance
   */
  readonly logger: InfrastructureLogger;

  /**
   * Initialize the provider with authentication configuration
   */
  initialize(auth: ProviderAuthConfig): Promise<void>;

  /**
   * Start the provider and prepare for operations
   */
  start(): Promise<void>;

  /**
   * Stop the provider gracefully
   */
  stop(): Promise<void>;

  /**
   * Destroy the provider and clean up resources
   */
  destroy(): Promise<void>;

  /**
   * Check provider health status
   */
  healthCheck(): Promise<ProviderHealthCheck>;

  /**
   * Validate provider configuration
   */
  validateConfig(config: Record<string, unknown>): Promise<ValidationResult>;

  /**
   * Get available commands for this provider
   */
  getCommands(): InfrastructureCommand[];

  /**
   * Execute a command
   */
  executeCommand<T = unknown>(
    commandId: string,
    parameters: Record<string, unknown>,
    context: CommandExecutionContext,
  ): Promise<CommandExecutionResult<T>>;

  /**
   * Get supported capabilities
   */
  getCapabilities(): InfrastructureCapability[];

  /**
   * Check if a capability is supported
   */
  hasCapability(capability: InfrastructureCapability): boolean;

  /**
   * Get supported resource types
   */
  getSupportedResources(): InfrastructureResourceType[];

  /**
   * List resources of a specific type
   */
  listResources(type: InfrastructureResourceType): Promise<ResourceState[]>;

  /**
   * Get a specific resource by ID
   */
  getResource(id: string): Promise<ResourceState | null>;

  /**
   * Register a lifecycle hook
   */
  onLifecycle(hook: LifecycleHookName, handler: LifecycleHookHandler): () => void;
}

/**
 * Provider health check result
 */
export type ProviderHealthCheck = {
  status: ProviderHealthStatus;
  message?: string;
  checks: HealthCheckItem[];
  timestamp: Date;
};

/**
 * Individual health check item
 */
export type HealthCheckItem = {
  name: string;
  status: ProviderHealthStatus;
  message?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
};

// =============================================================================
// Provider Factory
// =============================================================================

/**
 * Provider factory function type
 */
export type InfrastructureProviderFactory = (
  options: ProviderFactoryOptions,
) => InfrastructureProvider | Promise<InfrastructureProvider>;

/**
 * Provider factory options
 */
export type ProviderFactoryOptions = {
  id: string;
  config: Record<string, unknown>;
  logger: InfrastructureLogger;
  stateDir?: string;
};

// =============================================================================
// Abstract Base Provider
// =============================================================================

/**
 * Abstract base class for infrastructure providers
 *
 * Provides default implementations for common functionality
 * that can be overridden by concrete implementations.
 */
export abstract class BaseInfrastructureProvider implements InfrastructureProvider {
  abstract readonly meta: InfrastructureProviderMeta;

  protected _state: ProviderLifecycleState = "uninitialized";
  protected _logger: InfrastructureLogger;
  protected _auth: ProviderAuthConfig | null = null;
  protected _lifecycleHooks: Map<LifecycleHookName, Set<LifecycleHookHandler>> = new Map();
  protected _commands: Map<string, InfrastructureCommand> = new Map();
  protected _resources: Map<string, ResourceState> = new Map();

  constructor(logger: InfrastructureLogger) {
    this._logger = logger;
  }

  get state(): ProviderLifecycleState {
    return this._state;
  }

  get logger(): InfrastructureLogger {
    return this._logger;
  }

  async initialize(auth: ProviderAuthConfig): Promise<void> {
    if (this._state !== "uninitialized") {
      throw new Error(`Cannot initialize provider in state: ${this._state}`);
    }

    this._state = "initializing";
    await this.emitLifecycleHook("beforeInit");

    try {
      this._auth = auth;
      await this.onInitialize(auth);
      this._state = "ready";
      await this.emitLifecycleHook("afterInit");
      this._logger.info("Provider initialized successfully");
    } catch (error) {
      this._state = "error";
      await this.emitLifecycleHook("onError", error as Error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this._state !== "ready" && this._state !== "suspended") {
      throw new Error(`Cannot start provider in state: ${this._state}`);
    }

    await this.emitLifecycleHook("beforeStart");

    try {
      await this.onStart();
      this._state = "active";
      await this.emitLifecycleHook("afterStart");
      this._logger.info("Provider started successfully");
    } catch (error) {
      this._state = "error";
      await this.emitLifecycleHook("onError", error as Error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this._state !== "active") {
      throw new Error(`Cannot stop provider in state: ${this._state}`);
    }

    this._state = "suspending";
    await this.emitLifecycleHook("beforeStop");

    try {
      await this.onStop();
      this._state = "suspended";
      await this.emitLifecycleHook("afterStop");
      this._logger.info("Provider stopped successfully");
    } catch (error) {
      this._state = "error";
      await this.emitLifecycleHook("onError", error as Error);
      throw error;
    }
  }

  async destroy(): Promise<void> {
    if (this._state === "terminated") {
      return;
    }

    this._state = "terminating";
    await this.emitLifecycleHook("beforeDestroy");

    try {
      await this.onDestroy();
      this._state = "terminated";
      await this.emitLifecycleHook("afterDestroy");
      this._logger.info("Provider destroyed successfully");
    } catch (error) {
      this._state = "error";
      await this.emitLifecycleHook("onError", error as Error);
      throw error;
    }
  }

  async healthCheck(): Promise<ProviderHealthCheck> {
    await this.emitLifecycleHook("onHealthCheck");

    const checks = await this.performHealthChecks();
    const hasUnhealthy = checks.some((c) => c.status === "unhealthy");
    const hasDegraded = checks.some((c) => c.status === "degraded");

    let status: ProviderHealthStatus = "healthy";
    if (hasUnhealthy) {
      status = "unhealthy";
    } else if (hasDegraded) {
      status = "degraded";
    }

    return {
      status,
      checks,
      timestamp: new Date(),
    };
  }

  async validateConfig(config: Record<string, unknown>): Promise<ValidationResult> {
    return this.onValidateConfig(config);
  }

  getCommands(): InfrastructureCommand[] {
    return Array.from(this._commands.values());
  }

  async executeCommand<T = unknown>(
    commandId: string,
    parameters: Record<string, unknown>,
    context: CommandExecutionContext,
  ): Promise<CommandExecutionResult<T>> {
    const command = this._commands.get(commandId);
    if (!command) {
      return {
        success: false,
        error: {
          code: "COMMAND_NOT_FOUND",
          message: `Command not found: ${commandId}`,
          recoverable: false,
        },
        duration: 0,
        logs: [],
        resourcesAffected: [],
        rollbackAvailable: false,
      };
    }

    const startTime = Date.now();
    const logs: Array<{
      timestamp: Date;
      level: "trace" | "debug" | "info" | "warn" | "error";
      message: string;
      metadata?: Record<string, unknown>;
    }> = [];

    try {
      const result = await this.onExecuteCommand<T>(command, parameters, context, (log) => {
        logs.push({ ...log, timestamp: new Date() });
      });

      return {
        ...result,
        duration: Date.now() - startTime,
        logs,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : String(error),
          recoverable: false,
        },
        duration: Date.now() - startTime,
        logs,
        resourcesAffected: [],
        rollbackAvailable: false,
      };
    }
  }

  getCapabilities(): InfrastructureCapability[] {
    return this.meta.capabilities;
  }

  hasCapability(capability: InfrastructureCapability): boolean {
    return this.meta.capabilities.includes(capability);
  }

  getSupportedResources(): InfrastructureResourceType[] {
    return this.meta.supportedResources;
  }

  async listResources(type: InfrastructureResourceType): Promise<ResourceState[]> {
    return Array.from(this._resources.values()).filter((r) => r.type === type);
  }

  async getResource(id: string): Promise<ResourceState | null> {
    return this._resources.get(id) ?? null;
  }

  onLifecycle(hook: LifecycleHookName, handler: LifecycleHookHandler): () => void {
    if (!this._lifecycleHooks.has(hook)) {
      this._lifecycleHooks.set(hook, new Set());
    }
    this._lifecycleHooks.get(hook)!.add(handler);

    return () => {
      this._lifecycleHooks.get(hook)?.delete(handler);
    };
  }

  // ==========================================================================
  // Protected methods to be overridden by subclasses
  // ==========================================================================

  protected abstract onInitialize(auth: ProviderAuthConfig): Promise<void>;
  protected abstract onStart(): Promise<void>;
  protected abstract onStop(): Promise<void>;
  protected abstract onDestroy(): Promise<void>;
  protected abstract performHealthChecks(): Promise<HealthCheckItem[]>;
  protected abstract onValidateConfig(config: Record<string, unknown>): Promise<ValidationResult>;
  protected abstract onExecuteCommand<T>(
    command: InfrastructureCommand,
    parameters: Record<string, unknown>,
    context: CommandExecutionContext,
    log: (entry: Omit<CommandExecutionResult["logs"][0], "timestamp">) => void,
  ): Promise<Omit<CommandExecutionResult<T>, "duration" | "logs">>;

  // ==========================================================================
  // Protected helper methods
  // ==========================================================================

  protected registerCommand(command: InfrastructureCommand): void {
    this._commands.set(command.id, command);
  }

  protected updateResource(resource: ResourceState): void {
    this._resources.set(resource.id, { ...resource, updatedAt: new Date() });
  }

  protected removeResource(id: string): void {
    this._resources.delete(id);
  }

  protected async emitLifecycleHook(hook: LifecycleHookName, error?: Error): Promise<void> {
    const handlers = this._lifecycleHooks.get(hook);
    if (!handlers || handlers.size === 0) return;

    const context: LifecycleContext = {
      providerId: this.meta.id,
      state: this._state,
      error,
      metadata: {},
    };

    for (const handler of handlers) {
      try {
        await handler(context);
      } catch (err) {
        this._logger.error(`Lifecycle hook error (${hook}): ${err}`);
      }
    }
  }
}
