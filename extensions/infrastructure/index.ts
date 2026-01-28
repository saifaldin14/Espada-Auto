/**
 * Infrastructure Extension Framework - Espada Plugin Entry Point
 *
 * This is the main plugin entry point that registers the infrastructure
 * framework with the Espada ecosystem.
 */

// Define CLI command type
interface CliCommand {
  command(name: string): CliCommand;
  description(desc: string): CliCommand;
  action(fn: () => Promise<void>): CliCommand;
}

interface CliContext {
  program: {
    command(name: string): CliCommand;
  };
}

// Plugin API type for Espada integration
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EspadaPluginApi = any;

import {
  createProviderRegistry,
  createInfrastructureLogger,
  getDefaultInfrastructureConfig,
  type InfrastructureConfigSchema,
  type RegistryOptions,
} from "./src/index.js";

// Global registry instance
let registry: ReturnType<typeof createProviderRegistry> | null = null;

/**
 * Infrastructure plugin configuration schema
 */
const configSchema = {
  safeParse(value: unknown) {
    if (value === undefined || value === null) {
      return { success: true, data: getDefaultInfrastructureConfig() };
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      return {
        success: false,
        error: { issues: [{ path: [], message: "expected config object" }] },
      };
    }
    // In a real implementation, we'd use the full Zod schema validation
    return { success: true, data: value as InfrastructureConfigSchema };
  },
  jsonSchema: {
    type: "object",
    properties: {
      providers: {
        type: "array",
        description: "List of infrastructure provider configurations",
      },
      defaultProvider: {
        type: "string",
        description: "Default infrastructure provider to use",
      },
      sessionConfig: {
        type: "object",
        description: "Session management configuration",
      },
      commandConfig: {
        type: "object",
        description: "Command execution configuration",
      },
      loggingConfig: {
        type: "object",
        description: "Logging configuration",
      },
      securityConfig: {
        type: "object",
        description: "Security configuration",
      },
    },
  },
  uiHints: {
    providers: {
      label: "Infrastructure Providers",
      help: "Configure infrastructure providers for cloud and DevOps operations",
      advanced: false,
    },
    defaultProvider: {
      label: "Default Provider",
      help: "The default provider to use when not specified",
    },
    sessionConfig: {
      label: "Session Configuration",
      help: "Configure session timeouts and limits",
      advanced: true,
    },
    commandConfig: {
      label: "Command Configuration",
      help: "Configure command validation and execution settings",
      advanced: true,
    },
    loggingConfig: {
      label: "Logging Configuration",
      help: "Configure infrastructure logging",
      advanced: true,
    },
    securityConfig: {
      label: "Security Configuration",
      help: "Configure security settings for infrastructure operations",
      advanced: true,
    },
  },
};

/**
 * Infrastructure plugin definition
 */
const plugin = {
  id: "infrastructure",
  name: "Infrastructure Extension Framework",
  description:
    "Comprehensive infrastructure provider framework for cloud and DevOps automation",
  version: "1.0.0",
  configSchema,

  async register(api: EspadaPluginApi) {
    const logger = createInfrastructureLogger("plugin");
    logger.info("Registering infrastructure extension framework");

    // Get plugin configuration
    const config = (api.pluginConfig as InfrastructureConfigSchema) ?? getDefaultInfrastructureConfig();

    // Create registry options
    const registryOptions: RegistryOptions = {
      config,
      stateDir: api.runtime.resolveStateDir?.("infrastructure"),
      autoDiscover: true,
      autoStart: false, // Don't auto-start providers, let the user control this
    };

    // Create and initialize registry
    registry = createProviderRegistry(registryOptions, logger);
    await registry.initialize();

    // Register CLI commands
    api.registerCli(
      (ctx: CliContext) => {
        const infra = ctx.program
          .command("infra")
          .description("Infrastructure provider management");

        infra
          .command("providers")
          .description("List registered infrastructure providers")
          .action(async () => {
            if (!registry) {
              console.error("Infrastructure registry not initialized");
              return;
            }

            const factories = registry.getAllFactories();
            if (factories.length === 0) {
              console.log("No infrastructure providers registered");
              return;
            }

            console.log("\nRegistered Infrastructure Providers:\n");
            for (const factory of factories) {
              console.log(`  ${factory.meta.name} (${factory.id})`);
              console.log(`    Category: ${factory.meta.category}`);
              console.log(`    Version: ${factory.meta.version}`);
              console.log(`    Capabilities: ${factory.meta.capabilities.join(", ") || "none"}`);
              console.log();
            }
          });

        infra
          .command("instances")
          .description("List active provider instances")
          .action(async () => {
            if (!registry) {
              console.error("Infrastructure registry not initialized");
              return;
            }

            const instances = registry.getAllInstances();
            if (instances.length === 0) {
              console.log("No active provider instances");
              return;
            }

            console.log("\nActive Provider Instances:\n");
            for (const instance of instances) {
              const reg = registry.getLifecycleManager().getProvider(instance.instanceId);
              console.log(`  ${instance.instanceId}`);
              console.log(`    Provider: ${instance.id}`);
              console.log(`    State: ${reg?.state ?? "unknown"}`);
              console.log(`    Created: ${instance.createdAt.toISOString()}`);
              console.log();
            }
          });

        infra
          .command("status")
          .description("Show infrastructure framework status")
          .action(async () => {
            if (!registry) {
              console.error("Infrastructure registry not initialized");
              return;
            }

            const stats = registry.getStatistics();
            console.log("\nInfrastructure Framework Status:\n");
            console.log(`  Registered Factories: ${stats.factories}`);
            console.log(`  Active Instances: ${stats.instances}`);
            console.log(`  Lifecycle Hooks: ${stats.lifecycle.totalHooks}`);
            console.log(`  Event Handlers: ${stats.lifecycle.totalEventHandlers}`);
            console.log();
            console.log("  Health Summary:");
            console.log(`    Healthy: ${stats.lifecycle.healthSummary.healthy}`);
            console.log(`    Degraded: ${stats.lifecycle.healthSummary.degraded}`);
            console.log(`    Unhealthy: ${stats.lifecycle.healthSummary.unhealthy}`);
            console.log(`    Unknown: ${stats.lifecycle.healthSummary.unknown}`);
          });

        infra
          .command("discover")
          .description("Discover infrastructure plugins")
          .action(async () => {
            if (!registry) {
              console.error("Infrastructure registry not initialized");
              return;
            }

            console.log("Discovering infrastructure plugins...");
            await registry.discoverAndRegisterProviders();
            console.log("Discovery complete");
          });
      },
      { commands: ["infra"] },
    );

    // Register gateway methods
    api.registerGatewayMethod("infrastructure/providers", async () => {
      if (!registry) {
        return { success: false, error: "Registry not initialized" };
      }
      return {
        success: true,
        data: registry.getAllFactories().map((f) => ({
          id: f.id,
          meta: f.meta,
          registeredAt: f.registeredAt,
        })),
      };
    });

    api.registerGatewayMethod("infrastructure/instances", async () => {
      if (!registry) {
        return { success: false, error: "Registry not initialized" };
      }
      return {
        success: true,
        data: registry.getAllInstances().map((i) => ({
          id: i.id,
          instanceId: i.instanceId,
          state: registry!.getLifecycleManager().getProvider(i.instanceId)?.state,
          createdAt: i.createdAt,
        })),
      };
    });

    api.registerGatewayMethod("infrastructure/status", async () => {
      if (!registry) {
        return { success: false, error: "Registry not initialized" };
      }
      return {
        success: true,
        data: registry.getStatistics(),
      };
    });

    // Register service for cleanup
    api.registerService({
      id: "infrastructure-framework",
      async start() {
        logger.info("Infrastructure framework service started");
      },
      async stop() {
        if (registry) {
          await registry.shutdown();
          registry = null;
        }
        logger.info("Infrastructure framework service stopped");
      },
    });

    logger.info("Infrastructure extension framework registered successfully");
  },

  async activate(api: EspadaPluginApi) {
    // Start all configured providers
    if (registry) {
      const config = api.pluginConfig as InfrastructureConfigSchema | undefined;
      if (config?.providers) {
        const enabledProviders = config.providers.filter((p) => p.enabled);
        for (const provider of enabledProviders) {
          try {
            const instance = registry.getInstance(provider.id);
            if (instance) {
              await registry.getLifecycleManager().startProvider(provider.id);
            }
          } catch (error) {
            const logger = createInfrastructureLogger("activation");
            logger.error(`Failed to start provider ${provider.id}: ${error}`);
          }
        }
      }
    }
  },
};

export default plugin;

/**
 * Get the global infrastructure registry
 */
export function getInfrastructureRegistry() {
  return registry;
}
