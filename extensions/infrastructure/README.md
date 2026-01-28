# Infrastructure Extension Framework

A comprehensive framework for building and managing infrastructure providers within the Espada ecosystem.

## Overview

The Infrastructure Extension Framework provides a unified interface for integrating various infrastructure providers (cloud services, container orchestration, databases, etc.) into Espada. It includes:

- **Provider Interface**: Standard interface for all infrastructure providers
- **Logging Subsystem**: Infrastructure-specific logging with multiple transports
- **Command Validation**: Comprehensive parameter and context validation
- **Session Management**: Stateful session handling with persistence
- **Plugin Discovery**: Automatic discovery of infrastructure plugins
- **Lifecycle Management**: Provider initialization, startup, shutdown, and health monitoring
- **SDK**: Tools for building custom infrastructure providers

## Installation

```bash
pnpm add @espada/infrastructure
```

## Quick Start

### Creating a Simple Provider

```typescript
import {
  defineProvider,
  defineCommand,
  createSimpleProvider,
  success,
  failure,
} from "@espada/infrastructure/sdk";

// Define provider metadata
const providerMeta = defineProvider()
  .id("my-cloud")
  .name("My Cloud Provider")
  .displayName("My Cloud")
  .description("Custom cloud infrastructure provider")
  .version("1.0.0")
  .category("cloud")
  .capabilities("provision", "deprovision", "monitor")
  .supportedResources("compute", "storage", "network")
  .authMethods("api-key", "oauth2")
  .build();

// Define commands
const listInstancesCommand = defineCommand()
  .id("list-instances")
  .name("List Instances")
  .description("List all compute instances")
  .category("manage")
  .stringParam("region", "Target region", { required: false })
  .booleanParam("includeTerminated", "Include terminated instances", {
    default: false,
  })
  .supportsDryRun()
  .build();

// Create the provider
const provider = createSimpleProvider({
  meta: providerMeta,
  commands: [listInstancesCommand],

  async onInitialize(auth, logger) {
    logger.info("Initializing My Cloud provider");
    // Initialize API client with auth credentials
  },

  async onStart(logger) {
    logger.info("Starting My Cloud provider");
    // Start background processes, connections, etc.
  },

  async onStop(logger) {
    logger.info("Stopping My Cloud provider");
    // Clean up connections
  },

  async onHealthCheck(logger) {
    // Perform health checks
    return [
      { name: "api-connectivity", status: "healthy" },
      { name: "credentials", status: "healthy" },
    ];
  },

  async onExecuteCommand(command, parameters, context, logger) {
    if (command.id === "list-instances") {
      const instances = await fetchInstances(parameters.region as string);
      return success(instances, []);
    }
    return failure("NOT_IMPLEMENTED", `Command ${command.id} not implemented`);
  },
});
```

### Using the Provider Registry

```typescript
import {
  createProviderRegistry,
  createInfrastructureLogger,
} from "@espada/infrastructure";

// Create logger
const logger = createInfrastructureLogger("my-app");

// Create and initialize registry
const registry = createProviderRegistry(
  {
    autoDiscover: true,
    autoStart: false,
  },
  logger
);

await registry.initialize();

// Register a custom provider factory
registry.registerFactory(providerMeta, (options) => {
  return createSimpleProvider({
    meta: providerMeta,
    // ... provider implementation
  });
});

// Create and start a provider instance
const provider = await registry.createAndInitializeProvider("my-cloud", {
  auth: {
    method: "api-key",
    credentials: { apiKey: "your-api-key" },
  },
});

await registry.getLifecycleManager().startProvider("my-cloud");
```

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    Infrastructure Framework                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │    Provider     │  │    Session      │  │    Lifecycle    │  │
│  │    Registry     │  │    Manager      │  │    Manager      │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │           │
│           └────────────────────┼────────────────────┘           │
│                                │                                 │
│  ┌─────────────────────────────┴─────────────────────────────┐  │
│  │                    Provider Interface                      │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │Initialize│ │  Start   │ │  Stop    │ │   Execute    │  │  │
│  │  │          │ │          │ │          │ │   Command    │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │    Logging      │  │   Validation    │  │    Discovery    │  │
│  │   Subsystem     │  │   Framework     │  │    System       │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Provider Lifecycle

```
                      ┌──────────────┐
                      │ Uninitialized│
                      └──────┬───────┘
                             │ initialize()
                             ▼
                      ┌──────────────┐
                      │ Initializing │
                      └──────┬───────┘
                             │ success
                             ▼
         stop()       ┌──────────────┐
    ┌─────────────────│    Ready     │
    │                 └──────┬───────┘
    │                        │ start()
    │                        ▼
    │                 ┌──────────────┐
    └────────────────▶│   Active     │◀────┐
                      └──────┬───────┘     │
                             │ stop()      │ restart()
                             ▼             │
                      ┌──────────────┐     │
                      │  Suspended   │─────┘
                      └──────┬───────┘
                             │ destroy()
                             ▼
                      ┌──────────────┐
                      │  Terminated  │
                      └──────────────┘
```

## Configuration

### Plugin Configuration

```json
{
  "plugins": {
    "infrastructure": {
      "providers": [
        {
          "id": "aws",
          "enabled": true,
          "auth": {
            "method": "service-account",
            "profile": "default"
          },
          "settings": {
            "region": "us-west-2"
          }
        }
      ],
      "defaultProvider": "aws",
      "sessionConfig": {
        "timeout": 3600000,
        "maxConcurrent": 10,
        "persistState": true
      },
      "commandConfig": {
        "validation": {
          "strict": true,
          "allowDryRun": true
        },
        "execution": {
          "defaultTimeout": 60000
        }
      },
      "loggingConfig": {
        "level": "info",
        "destinations": [
          { "type": "console", "config": {} }
        ]
      }
    }
  }
}
```

## CLI Commands

The framework registers the following CLI commands:

```bash
# List registered providers
espada infra providers

# List active instances
espada infra instances

# Show framework status
espada infra status

# Discover plugins
espada infra discover
```

## API Reference

### Provider Interface

```typescript
interface InfrastructureProvider {
  readonly meta: InfrastructureProviderMeta;
  readonly state: ProviderLifecycleState;
  readonly logger: InfrastructureLogger;

  initialize(auth: ProviderAuthConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  healthCheck(): Promise<ProviderHealthCheck>;
  validateConfig(config: Record<string, unknown>): Promise<ValidationResult>;
  getCommands(): InfrastructureCommand[];
  executeCommand<T>(
    commandId: string,
    parameters: Record<string, unknown>,
    context: CommandExecutionContext
  ): Promise<CommandExecutionResult<T>>;
  getCapabilities(): InfrastructureCapability[];
  hasCapability(capability: InfrastructureCapability): boolean;
  getSupportedResources(): InfrastructureResourceType[];
  listResources(type: InfrastructureResourceType): Promise<ResourceState[]>;
  getResource(id: string): Promise<ResourceState | null>;
  onLifecycle(hook: LifecycleHookName, handler: LifecycleHookHandler): () => void;
}
```

### Provider Categories

- `cloud` - Cloud infrastructure providers (AWS, GCP, Azure)
- `container` - Container runtimes (Docker, Podman)
- `kubernetes` - Kubernetes providers
- `serverless` - Serverless platforms
- `database` - Database providers
- `storage` - Storage providers
- `network` - Network infrastructure
- `security` - Security tools
- `monitoring` - Monitoring systems
- `ci-cd` - CI/CD platforms
- `custom` - Custom providers

### Capabilities

- `provision` - Create resources
- `deprovision` - Delete resources
- `scale` - Scale resources
- `monitor` - Monitor resources
- `backup` - Backup data
- `restore` - Restore data
- `migrate` - Migrate resources
- `audit` - Audit operations
- `cost-analysis` - Cost analysis
- `security-scan` - Security scanning
- `dry-run` - Dry run support
- `rollback` - Rollback support
- `snapshot` - Snapshot support
- `replicate` - Replication support

## Development

### Building

```bash
pnpm build
```

### Testing

```bash
pnpm test
```

### Type Checking

```bash
pnpm typecheck
```

## License

MIT
