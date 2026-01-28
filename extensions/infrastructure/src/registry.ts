/**
 * Infrastructure Provider Registry
 *
 * This module provides a centralized registry for managing
 * infrastructure providers, their factories, and instances.
 */

import type {
  DiscoveredPlugin,
  InfrastructureConfigSchema,
  InfrastructureProviderMeta,
  ProviderAuthConfig,
} from "../types.js";
import type {
  InfrastructureProvider,
  InfrastructureProviderFactory,
  ProviderFactoryOptions,
} from "../provider.js";
import type { InfrastructureLogger } from "../logging/logger.js";
import { InfrastructureLifecycleManager, type LifecycleManagerOptions } from "../lifecycle/manager.js";
import { InfrastructureSessionManager, type SessionConfig } from "../session/manager.js";
import { InfrastructurePluginDiscoverer, type PluginDiscoveryOptions } from "../discovery/discoverer.js";

// =============================================================================
// Registry Types
// =============================================================================

/**
 * Provider factory registration
 */
export type ProviderFactoryRegistration = {
  id: string;
  meta: InfrastructureProviderMeta;
  factory: InfrastructureProviderFactory;
  plugin?: DiscoveredPlugin;
  registeredAt: Date;
};

/**
 * Provider instance entry
 */
export type ProviderInstanceEntry = {
  id: string;
  instanceId: string;
  provider: InfrastructureProvider;
  config: Record<string, unknown>;
  createdAt: Date;
};

/**
 * Registry options
 */
export type RegistryOptions = {
  config?: InfrastructureConfigSchema;
  discovery?: PluginDiscoveryOptions;
  lifecycle?: LifecycleManagerOptions;
  session?: SessionConfig;
  stateDir?: string;
  autoDiscover?: boolean;
  autoStart?: boolean;
};

// =============================================================================
// Provider Registry Implementation
// =============================================================================

/**
 * Infrastructure provider registry
 *
 * Central registry for managing infrastructure provider factories,
 * instances, and their lifecycle.
 */
export class InfrastructureProviderRegistry {
  private factories: Map<string, ProviderFactoryRegistration> = new Map();
  private instances: Map<string, ProviderInstanceEntry> = new Map();
  private logger: InfrastructureLogger;
  private lifecycleManager: InfrastructureLifecycleManager;
  private sessionManager: InfrastructureSessionManager;
  private discoverer: InfrastructurePluginDiscoverer;
  private options: RegistryOptions;
  private initialized = false;

  constructor(options: RegistryOptions, logger: InfrastructureLogger) {
    this.options = options;
    this.logger = logger;

    // Initialize managers
    this.lifecycleManager = new InfrastructureLifecycleManager(
      options.lifecycle ?? {},
      logger.child("lifecycle"),
    );

    this.sessionManager = new InfrastructureSessionManager({
      config: options.session ?? {
        timeout: 3600000,
        maxConcurrent: 10,
        persistState: true,
        stateDirectory: options.stateDir,
        cleanupInterval: 300000,
      },
      logger: logger.child("session"),
    });

    this.discoverer = new InfrastructurePluginDiscoverer(
      options.discovery ?? {},
      logger.child("discovery"),
    );
  }

  /**
   * Initialize the registry
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.logger.info("Initializing infrastructure provider registry");

    // Start session manager
    this.sessionManager.start();

    // Auto-discover plugins if enabled
    if (this.options.autoDiscover !== false) {
      await this.discoverAndRegisterProviders();
    }

    // Auto-initialize configured providers
    if (this.options.config?.providers) {
      for (const providerConfig of this.options.config.providers) {
        if (providerConfig.enabled) {
          try {
            await this.createAndInitializeProvider(providerConfig.id, {
              auth: providerConfig.auth,
              config: providerConfig.settings,
            });
          } catch (error) {
            this.logger.error(`Failed to initialize provider ${providerConfig.id}: ${error}`);
          }
        }
      }
    }

    // Auto-start if enabled
    if (this.options.autoStart) {
      await this.lifecycleManager.startAll();
    }

    this.initialized = true;
    this.logger.info("Infrastructure provider registry initialized", {
      factories: this.factories.size,
      instances: this.instances.size,
    });
  }

  /**
   * Shutdown the registry
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down infrastructure provider registry");

    // Shutdown lifecycle manager (stops all providers)
    await this.lifecycleManager.shutdown();

    // Stop session manager
    this.sessionManager.stop();

    // Clear state
    this.factories.clear();
    this.instances.clear();
    this.initialized = false;

    this.logger.info("Infrastructure provider registry shutdown complete");
  }

  /**
   * Register a provider factory
   */
  registerFactory(
    meta: InfrastructureProviderMeta,
    factory: InfrastructureProviderFactory,
    plugin?: DiscoveredPlugin,
  ): void {
    if (this.factories.has(meta.id)) {
      throw new Error(`Provider factory already registered: ${meta.id}`);
    }

    this.factories.set(meta.id, {
      id: meta.id,
      meta,
      factory,
      plugin,
      registeredAt: new Date(),
    });

    this.logger.info(`Registered provider factory: ${meta.id}`, {
      name: meta.name,
      category: meta.category,
      capabilities: meta.capabilities,
    });
  }

  /**
   * Unregister a provider factory
   */
  unregisterFactory(factoryId: string): boolean {
    const removed = this.factories.delete(factoryId);
    if (removed) {
      this.logger.info(`Unregistered provider factory: ${factoryId}`);
    }
    return removed;
  }

  /**
   * Get a registered factory
   */
  getFactory(factoryId: string): ProviderFactoryRegistration | null {
    return this.factories.get(factoryId) ?? null;
  }

  /**
   * Get all registered factories
   */
  getAllFactories(): ProviderFactoryRegistration[] {
    return Array.from(this.factories.values());
  }

  /**
   * Create a provider instance
   */
  async createProvider(
    factoryId: string,
    options: { instanceId?: string; config?: Record<string, unknown> },
  ): Promise<InfrastructureProvider> {
    const registration = this.factories.get(factoryId);
    if (!registration) {
      throw new Error(`Provider factory not found: ${factoryId}`);
    }

    const instanceId = options.instanceId ?? `${factoryId}_${Date.now()}`;
    if (this.instances.has(instanceId)) {
      throw new Error(`Provider instance already exists: ${instanceId}`);
    }

    const factoryOptions: ProviderFactoryOptions = {
      id: instanceId,
      config: options.config ?? {},
      logger: this.logger.child(instanceId),
      stateDir: this.options.stateDir,
    };

    const provider = await registration.factory(factoryOptions);

    this.instances.set(instanceId, {
      id: factoryId,
      instanceId,
      provider,
      config: options.config ?? {},
      createdAt: new Date(),
    });

    // Register with lifecycle manager
    this.lifecycleManager.registerProvider(provider);

    this.logger.info(`Created provider instance: ${instanceId}`, { factoryId });

    return provider;
  }

  /**
   * Create and initialize a provider
   */
  async createAndInitializeProvider(
    factoryId: string,
    options: {
      instanceId?: string;
      config?: Record<string, unknown>;
      auth: ProviderAuthConfig;
    },
  ): Promise<InfrastructureProvider> {
    const provider = await this.createProvider(factoryId, {
      instanceId: options.instanceId,
      config: options.config,
    });

    await this.lifecycleManager.initializeProvider(provider.meta.id, options.auth);

    return provider;
  }

  /**
   * Get a provider instance
   */
  getInstance(instanceId: string): ProviderInstanceEntry | null {
    return this.instances.get(instanceId) ?? null;
  }

  /**
   * Get all provider instances
   */
  getAllInstances(): ProviderInstanceEntry[] {
    return Array.from(this.instances.values());
  }

  /**
   * Get instances by factory ID
   */
  getInstancesByFactory(factoryId: string): ProviderInstanceEntry[] {
    return Array.from(this.instances.values()).filter((i) => i.id === factoryId);
  }

  /**
   * Destroy a provider instance
   */
  async destroyInstance(instanceId: string): Promise<void> {
    const entry = this.instances.get(instanceId);
    if (!entry) {
      throw new Error(`Provider instance not found: ${instanceId}`);
    }

    await this.lifecycleManager.unregisterProvider(instanceId);
    this.instances.delete(instanceId);

    this.logger.info(`Destroyed provider instance: ${instanceId}`);
  }

  /**
   * Discover and register providers from plugins
   */
  async discoverAndRegisterProviders(): Promise<void> {
    const result = await this.discoverer.discover();

    for (const plugin of result.plugins) {
      for (const providerMeta of plugin.manifest.providers) {
        try {
          // Load the provider factory from the plugin
          const factory = await this.loadProviderFactory(plugin, providerMeta);
          if (factory) {
            this.registerFactory(providerMeta, factory, plugin);
          }
        } catch (error) {
          this.logger.error(`Failed to load provider ${providerMeta.id} from plugin: ${error}`);
        }
      }
    }

    if (result.errors.length > 0) {
      this.logger.warn(`${result.errors.length} plugin discovery errors occurred`);
    }
  }

  /**
   * Load a provider factory from a plugin
   */
  private async loadProviderFactory(
    plugin: DiscoveredPlugin,
    meta: InfrastructureProviderMeta,
  ): Promise<InfrastructureProviderFactory | null> {
    try {
      // Dynamic import of plugin module
      const modulePath = `${plugin.path}/providers/${meta.id}.js`;
      const module = await import(modulePath);

      if (typeof module.createProvider === "function") {
        return module.createProvider as InfrastructureProviderFactory;
      }

      if (typeof module.default === "function") {
        return module.default as InfrastructureProviderFactory;
      }

      this.logger.warn(`Plugin ${plugin.manifest.id} does not export a provider factory for ${meta.id}`);
      return null;
    } catch (error) {
      // Plugin may not have a loadable factory, which is okay
      // The factory can be registered manually
      this.logger.debug(`Could not load provider factory from plugin: ${error}`);
      return null;
    }
  }

  /**
   * Get the lifecycle manager
   */
  getLifecycleManager(): InfrastructureLifecycleManager {
    return this.lifecycleManager;
  }

  /**
   * Get the session manager
   */
  getSessionManager(): InfrastructureSessionManager {
    return this.sessionManager;
  }

  /**
   * Get the plugin discoverer
   */
  getDiscoverer(): InfrastructurePluginDiscoverer {
    return this.discoverer;
  }

  /**
   * Get registry statistics
   */
  getStatistics(): RegistryStatistics {
    return {
      factories: this.factories.size,
      instances: this.instances.size,
      lifecycle: this.lifecycleManager.getStatistics(),
    };
  }
}

/**
 * Registry statistics
 */
export type RegistryStatistics = {
  factories: number;
  instances: number;
  lifecycle: {
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
};

/**
 * Create a provider registry
 */
export function createProviderRegistry(
  options: RegistryOptions,
  logger: InfrastructureLogger,
): InfrastructureProviderRegistry {
  return new InfrastructureProviderRegistry(options, logger);
}
