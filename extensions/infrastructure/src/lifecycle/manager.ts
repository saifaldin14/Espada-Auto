/**
 * Infrastructure Provider Lifecycle Management
 *
 * This module provides comprehensive lifecycle management for
 * infrastructure providers, including initialization, startup,
 * shutdown, health monitoring, and event handling.
 */

import type {
  InfrastructureEvent,
  InfrastructureEventHandler,
  InfrastructureEventType,
  LifecycleContext,
  LifecycleHookHandler,
  LifecycleHookName,
  LifecycleHookRegistration,
  ProviderAuthConfig,
  ProviderLifecycleState,
} from "../types.js";
import type { InfrastructureProvider, ProviderHealthCheck } from "../provider.js";
import type { InfrastructureLogger } from "../logging/logger.js";

// =============================================================================
// Lifecycle Manager Types
// =============================================================================

/**
 * Provider registration entry
 */
export type ProviderRegistration = {
  provider: InfrastructureProvider;
  state: ProviderLifecycleState;
  auth?: ProviderAuthConfig;
  registeredAt: Date;
  lastStateChange: Date;
  error?: Error;
  healthCheckInterval?: NodeJS.Timeout;
  lastHealthCheck?: ProviderHealthCheck;
};

/**
 * Lifecycle manager options
 */
export type LifecycleManagerOptions = {
  /** Health check interval in milliseconds */
  healthCheckInterval?: number;
  /** Whether to auto-restart providers on failure */
  autoRestart?: boolean;
  /** Maximum restart attempts */
  maxRestartAttempts?: number;
  /** Restart delay in milliseconds */
  restartDelay?: number;
  /** Shutdown timeout in milliseconds */
  shutdownTimeout?: number;
};

/**
 * Provider lifecycle event
 */
export type ProviderLifecycleEvent = {
  providerId: string;
  state: ProviderLifecycleState;
  previousState?: ProviderLifecycleState;
  error?: Error;
  timestamp: Date;
};

// =============================================================================
// Lifecycle Manager Implementation
// =============================================================================

/**
 * Infrastructure provider lifecycle manager
 *
 * Manages the lifecycle of infrastructure providers including
 * registration, initialization, startup, shutdown, and health monitoring.
 */
export class InfrastructureLifecycleManager {
  private providers: Map<string, ProviderRegistration> = new Map();
  private hooks: Map<LifecycleHookName, Set<LifecycleHookRegistration>> = new Map();
  private eventHandlers: Map<InfrastructureEventType, Set<InfrastructureEventHandler>> = new Map();
  private options: Required<LifecycleManagerOptions>;
  private logger: InfrastructureLogger;
  private restartAttempts: Map<string, number> = new Map();
  private shuttingDown = false;

  constructor(options: LifecycleManagerOptions, logger: InfrastructureLogger) {
    this.options = {
      healthCheckInterval: options.healthCheckInterval ?? 60000,
      autoRestart: options.autoRestart ?? true,
      maxRestartAttempts: options.maxRestartAttempts ?? 3,
      restartDelay: options.restartDelay ?? 5000,
      shutdownTimeout: options.shutdownTimeout ?? 30000,
    };
    this.logger = logger;
  }

  /**
   * Register a provider
   */
  registerProvider(provider: InfrastructureProvider): void {
    const id = provider.meta.id;
    if (this.providers.has(id)) {
      throw new Error(`Provider already registered: ${id}`);
    }

    this.providers.set(id, {
      provider,
      state: "uninitialized",
      registeredAt: new Date(),
      lastStateChange: new Date(),
    });

    this.logger.info(`Provider registered: ${id}`, {
      name: provider.meta.name,
      version: provider.meta.version,
    });

    void this.emitEvent("provider:registered", { providerId: id, meta: provider.meta });
  }

  /**
   * Unregister a provider
   */
  async unregisterProvider(providerId: string): Promise<void> {
    const registration = this.providers.get(providerId);
    if (!registration) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    // Stop and destroy if running
    if (
      registration.state === "active" ||
      registration.state === "ready" ||
      registration.state === "suspended"
    ) {
      await this.stopProvider(providerId);
      await this.destroyProvider(providerId);
    }

    // Clear health check interval
    if (registration.healthCheckInterval) {
      clearInterval(registration.healthCheckInterval);
    }

    this.providers.delete(providerId);
    this.restartAttempts.delete(providerId);

    this.logger.info(`Provider unregistered: ${providerId}`);
  }

  /**
   * Initialize a provider
   */
  async initializeProvider(providerId: string, auth: ProviderAuthConfig): Promise<void> {
    const registration = this.providers.get(providerId);
    if (!registration) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    if (registration.state !== "uninitialized") {
      throw new Error(`Provider ${providerId} is already initialized (state: ${registration.state})`);
    }

    await this.runWithHooks("beforeInit", providerId, async () => {
      try {
        this.updateState(providerId, "initializing");
        await registration.provider.initialize(auth);
        registration.auth = auth;
        this.updateState(providerId, "ready");
        await this.runHooks("afterInit", providerId);
        void this.emitEvent("provider:initialized", { providerId });
      } catch (error) {
        registration.error = error as Error;
        this.updateState(providerId, "error");
        void this.emitEvent("provider:error", {
          providerId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
  }

  /**
   * Start a provider
   */
  async startProvider(providerId: string): Promise<void> {
    const registration = this.providers.get(providerId);
    if (!registration) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    if (registration.state !== "ready" && registration.state !== "suspended") {
      throw new Error(
        `Provider ${providerId} cannot be started from state: ${registration.state}`,
      );
    }

    await this.runWithHooks("beforeStart", providerId, async () => {
      try {
        await registration.provider.start();
        this.updateState(providerId, "active");
        await this.runHooks("afterStart", providerId);

        // Start health checks
        this.startHealthChecks(providerId);

        // Reset restart attempts on successful start
        this.restartAttempts.set(providerId, 0);

        this.logger.info(`Provider started: ${providerId}`);
        void this.emitEvent("provider:ready", { providerId });
      } catch (error) {
        registration.error = error as Error;
        this.updateState(providerId, "error");
        void this.emitEvent("provider:error", {
          providerId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
  }

  /**
   * Stop a provider
   */
  async stopProvider(providerId: string): Promise<void> {
    const registration = this.providers.get(providerId);
    if (!registration) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    if (registration.state !== "active") {
      return; // Already stopped
    }

    await this.runWithHooks("beforeStop", providerId, async () => {
      try {
        // Stop health checks
        this.stopHealthChecks(providerId);

        this.updateState(providerId, "suspending");
        await registration.provider.stop();
        this.updateState(providerId, "suspended");
        await this.runHooks("afterStop", providerId);

        this.logger.info(`Provider stopped: ${providerId}`);
      } catch (error) {
        registration.error = error as Error;
        this.updateState(providerId, "error");
        throw error;
      }
    });
  }

  /**
   * Destroy a provider
   */
  async destroyProvider(providerId: string): Promise<void> {
    const registration = this.providers.get(providerId);
    if (!registration) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    if (registration.state === "terminated") {
      return; // Already destroyed
    }

    // Stop first if running
    if (registration.state === "active") {
      await this.stopProvider(providerId);
    }

    await this.runWithHooks("beforeDestroy", providerId, async () => {
      try {
        this.updateState(providerId, "terminating");
        await registration.provider.destroy();
        this.updateState(providerId, "terminated");
        await this.runHooks("afterDestroy", providerId);

        void this.emitEvent("provider:terminated", { providerId });
        this.logger.info(`Provider destroyed: ${providerId}`);
      } catch (error) {
        registration.error = error as Error;
        this.updateState(providerId, "error");
        throw error;
      }
    });
  }

  /**
   * Restart a provider
   */
  async restartProvider(providerId: string): Promise<void> {
    const registration = this.providers.get(providerId);
    if (!registration) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    this.logger.info(`Restarting provider: ${providerId}`);

    // Stop if running
    if (registration.state === "active") {
      await this.stopProvider(providerId);
    }

    // Start again
    await this.startProvider(providerId);
  }

  /**
   * Check health of a provider
   */
  async checkProviderHealth(providerId: string): Promise<ProviderHealthCheck> {
    const registration = this.providers.get(providerId);
    if (!registration) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    const healthCheck = await registration.provider.healthCheck();
    registration.lastHealthCheck = healthCheck;

    await this.runHooks("onHealthCheck", providerId, healthCheck);
    void this.emitEvent("health:check", { providerId, healthCheck });

    // Handle unhealthy state
    if (healthCheck.status === "unhealthy" && this.options.autoRestart && !this.shuttingDown) {
      await this.handleUnhealthyProvider(providerId);
    }

    return healthCheck;
  }

  /**
   * Get provider registration
   */
  getProvider(providerId: string): ProviderRegistration | null {
    return this.providers.get(providerId) ?? null;
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): ProviderRegistration[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get providers by state
   */
  getProvidersByState(state: ProviderLifecycleState): ProviderRegistration[] {
    return Array.from(this.providers.values()).filter((r) => r.state === state);
  }

  /**
   * Register a lifecycle hook
   */
  registerHook(
    hook: LifecycleHookName,
    handler: LifecycleHookHandler,
    options?: { priority?: number; once?: boolean },
  ): () => void {
    if (!this.hooks.has(hook)) {
      this.hooks.set(hook, new Set());
    }

    const registration: LifecycleHookRegistration = {
      hook,
      handler,
      priority: options?.priority ?? 0,
      once: options?.once ?? false,
    };

    this.hooks.get(hook)!.add(registration);

    return () => {
      this.hooks.get(hook)?.delete(registration);
    };
  }

  /**
   * Register an event handler
   */
  on<T = unknown>(
    eventType: InfrastructureEventType,
    handler: InfrastructureEventHandler<T>,
  ): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }

    this.eventHandlers.get(eventType)!.add(handler as InfrastructureEventHandler);

    return () => {
      this.eventHandlers.get(eventType)?.delete(handler as InfrastructureEventHandler);
    };
  }

  /**
   * Start all registered providers
   */
  async startAll(): Promise<void> {
    const providers = this.getProvidersByState("ready").concat(
      this.getProvidersByState("suspended"),
    );

    this.logger.info(`Starting ${providers.length} providers`);

    const results = await Promise.allSettled(
      providers.map((r) => this.startProvider(r.provider.meta.id)),
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      this.logger.warn(`${failures.length} providers failed to start`);
    }
  }

  /**
   * Stop all providers
   */
  async stopAll(): Promise<void> {
    const providers = this.getProvidersByState("active");

    this.logger.info(`Stopping ${providers.length} providers`);

    await Promise.allSettled(providers.map((r) => this.stopProvider(r.provider.meta.id)));
  }

  /**
   * Shutdown the lifecycle manager
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.logger.info("Shutting down lifecycle manager");

    // Create timeout promise
    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        this.logger.warn("Shutdown timeout reached, forcing termination");
        resolve();
      }, this.options.shutdownTimeout);
    });

    // Shutdown all providers
    const shutdownProviders = async () => {
      await this.stopAll();
      const providers = Array.from(this.providers.values());
      await Promise.allSettled(providers.map((r) => this.destroyProvider(r.provider.meta.id)));
    };

    await Promise.race([shutdownProviders(), timeout]);

    // Clear all state
    this.providers.clear();
    this.hooks.clear();
    this.eventHandlers.clear();
    this.restartAttempts.clear();

    this.logger.info("Lifecycle manager shutdown complete");
  }

  /**
   * Get lifecycle statistics
   */
  getStatistics(): LifecycleStatistics {
    const byState = new Map<ProviderLifecycleState, number>();
    const healthSummary = {
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
      unknown: 0,
    };

    for (const registration of this.providers.values()) {
      byState.set(registration.state, (byState.get(registration.state) ?? 0) + 1);

      if (registration.lastHealthCheck) {
        healthSummary[registration.lastHealthCheck.status]++;
      } else {
        healthSummary.unknown++;
      }
    }

    return {
      totalProviders: this.providers.size,
      byState: Object.fromEntries(byState),
      healthSummary,
      totalHooks: Array.from(this.hooks.values()).reduce((sum, set) => sum + set.size, 0),
      totalEventHandlers: Array.from(this.eventHandlers.values()).reduce(
        (sum, set) => sum + set.size,
        0,
      ),
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private updateState(providerId: string, state: ProviderLifecycleState): void {
    const registration = this.providers.get(providerId);
    if (!registration) return;

    const previousState = registration.state;
    registration.state = state;
    registration.lastStateChange = new Date();

    if (state !== "error") {
      registration.error = undefined;
    }

    this.logger.debug(`Provider state change: ${providerId}`, {
      from: previousState,
      to: state,
    });
  }

  private async runHooks(
    hook: LifecycleHookName,
    providerId: string,
    extra?: unknown,
  ): Promise<void> {
    const handlers = this.hooks.get(hook);
    if (!handlers || handlers.size === 0) return;

    const registration = this.providers.get(providerId);
    const context: LifecycleContext = {
      providerId,
      state: registration?.state ?? "uninitialized",
      error: registration?.error,
      metadata: extra ? { extra } : {},
    };

    // Sort by priority (higher first)
    const sorted = Array.from(handlers).sort((a, b) => b.priority - a.priority);
    const toRemove: LifecycleHookRegistration[] = [];

    for (const reg of sorted) {
      try {
        await reg.handler(context);
        if (reg.once) {
          toRemove.push(reg);
        }
      } catch (error) {
        this.logger.error(`Lifecycle hook error (${hook}): ${error}`);
      }
    }

    // Remove one-time handlers
    for (const reg of toRemove) {
      handlers.delete(reg);
    }
  }

  private async runWithHooks(
    hook: LifecycleHookName,
    providerId: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    await this.runHooks(hook, providerId);
    await fn();
  }

  private async emitEvent(type: InfrastructureEventType, data: unknown): Promise<void> {
    const handlers = this.eventHandlers.get(type);
    if (!handlers || handlers.size === 0) return;

    const event: InfrastructureEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      type,
      timestamp: new Date(),
      source: "lifecycle-manager",
      data,
    };

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        this.logger.error(`Event handler error (${type}): ${error}`);
      }
    }
  }

  private startHealthChecks(providerId: string): void {
    const registration = this.providers.get(providerId);
    if (!registration) return;

    // Clear existing interval
    if (registration.healthCheckInterval) {
      clearInterval(registration.healthCheckInterval);
    }

    // Start new interval
    registration.healthCheckInterval = setInterval(() => {
      void this.checkProviderHealth(providerId).catch((error) => {
        this.logger.error(`Health check failed for ${providerId}: ${error}`);
      });
    }, this.options.healthCheckInterval);

    // Run initial health check
    void this.checkProviderHealth(providerId).catch(() => {});
  }

  private stopHealthChecks(providerId: string): void {
    const registration = this.providers.get(providerId);
    if (!registration || !registration.healthCheckInterval) return;

    clearInterval(registration.healthCheckInterval);
    registration.healthCheckInterval = undefined;
  }

  private async handleUnhealthyProvider(providerId: string): Promise<void> {
    const attempts = this.restartAttempts.get(providerId) ?? 0;

    if (attempts >= this.options.maxRestartAttempts) {
      this.logger.error(
        `Provider ${providerId} exceeded max restart attempts (${this.options.maxRestartAttempts})`,
      );
      return;
    }

    this.restartAttempts.set(providerId, attempts + 1);
    this.logger.warn(
      `Provider ${providerId} unhealthy, attempting restart (${attempts + 1}/${this.options.maxRestartAttempts})`,
    );

    // Wait before restart
    await new Promise((resolve) => setTimeout(resolve, this.options.restartDelay));

    try {
      await this.restartProvider(providerId);
    } catch (error) {
      this.logger.error(`Failed to restart provider ${providerId}: ${error}`);
    }
  }
}

/**
 * Lifecycle statistics
 */
export type LifecycleStatistics = {
  totalProviders: number;
  byState: Record<string, number>;
  healthSummary: {
    healthy: number;
    degraded: number;
    unhealthy: number;
    unknown: number;
  };
  totalHooks: number;
  totalEventHandlers: number;
};

/**
 * Create a lifecycle manager
 */
export function createLifecycleManager(
  options: LifecycleManagerOptions,
  logger: InfrastructureLogger,
): InfrastructureLifecycleManager {
  return new InfrastructureLifecycleManager(options, logger);
}
