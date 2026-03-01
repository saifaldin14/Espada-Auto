---
summary: Infrastructure provider framework for cloud and DevOps automation — provider registry, lifecycle management, session state, security facade, conversational AI context, and an SDK for building custom providers.
read_when:
  - building custom infrastructure providers
  - managing provider lifecycle and health checks
  - configuring security, approvals, RBAC, or break-glass access
  - using the infrastructure SDK to define providers and commands
  - working with provider sessions or plugin discovery
  - integrating conversational AI with infrastructure operations
---

# Infrastructure

The **Infrastructure Extension Framework** (`@espada/infrastructure`) provides a
complete platform for building, registering, and managing infrastructure
providers within Espada. It is not an individual cloud integration but a
*framework* that other extensions (AWS, Azure, Kubernetes, Terraform, etc.) can
build on, with a unified provider registry, lifecycle manager, session system,
security facade, conversational AI pipeline, and an SDK for rapid provider
development.

> **Plugin ID:** `infrastructure` · **Version:** 1.0.0 · **11 test files, 322 test cases**

---

## Prerequisites

| Requirement | Purpose |
|---|---|
| Espada instance | Core runtime |
| Node.js ≥ 18 | Extension host |

No external binaries are required — the framework runs entirely inside the
Espada process.

---

## Install

```yaml
# espada.yaml
extensions:
  infrastructure:
    enabled: true
```

### Configuration keys

```yaml
extensions:
  infrastructure:
    providers:                     # Array of provider configurations
      - id: my-cloud
        enabled: true
        auth:
          method: api-key          # api-key | oauth2 | service-account | iam-role | certificate | token | custom
          credentials:
            apiKey: "${MY_API_KEY}"
        settings: {}
    defaultProvider: my-cloud      # Default provider to use
    sessionConfig:
      timeout: 3600000             # Session TTL (ms)
      maxConcurrent: 10            # Max concurrent sessions
      persistState: true           # Persist sessions to disk
      cleanupInterval: 300000      # Expired-session sweep interval (ms)
    commandConfig:
      validation:
        strict: true
        allowDryRun: true
        requireConfirmation: false
        dangerousCommandsRequireExplicit: true
      execution:
        defaultTimeout: 60000
        maxRetries: 3
        retryDelay: 1000
        parallelLimit: 5
      history:
        enabled: true
        maxEntries: 1000
        retentionDays: 30
    loggingConfig:
      level: info                  # trace | debug | info | warn | error | fatal
      includeTimestamps: true
      includeMetadata: true
      destinations:
        - type: console            # console | file | remote
          config: {}
      redactPatterns: []
    securityConfig:
      encryption:
        enabled: true
        algorithm: aes-256-gcm
        keyRotationDays: 90
      audit:
        enabled: true
        logAllCommands: true
        logSensitiveData: false
      access:
        requireMfa: false
```

---

## Architecture overview

```
┌─────────────────────────────────────────────────────┐
│                 Infrastructure Plugin                │
│  index.ts  ─  CLI commands / Gateway methods / Svc  │
└────────────────────────┬────────────────────────────┘
                         │
       ┌─────────────────┼──────────────────┐
       │                 │                  │
┌──────▼───────┐  ┌──────▼──────┐   ┌──────▼──────┐
│   Provider   │  │  Lifecycle  │   │   Session   │
│   Registry   │  │  Manager    │   │   Manager   │
└──────┬───────┘  └─────────────┘   └─────────────┘
       │
  ┌────┼──────┬──────────┬──────────┬───────────┐
  │         │          │          │           │
┌─▼──┐  ┌──▼───┐  ┌───▼──┐  ┌──▼───┐  ┌────▼────┐
│ SDK│  │ Disc │  │ Log  │  │ Val  │  │Security │
│    │  │overy │  │ging  │  │idat. │  │ Facade  │
└────┘  └──────┘  └──────┘  └──────┘  └─────────┘
```

---

## Core subsystems

### Provider types

Every provider belongs to a **category** and declares **capabilities** and
**resource types**:

| Categories | `cloud` · `container` · `kubernetes` · `serverless` · `database` · `storage` · `network` · `security` · `monitoring` · `ci-cd` · `custom` |
|---|---|
| **Capabilities** | `provision` · `deprovision` · `scale` · `monitor` · `backup` · `restore` · `migrate` · `audit` · `cost-analysis` · `security-scan` · `dry-run` · `rollback` · `snapshot` · `replicate` |
| **Resource types** | `compute` · `storage` · `network` · `database` · `cache` · `queue` · `function` · `container` · `cluster` · `load-balancer` · `dns` · `certificate` · `secret` · `policy` · `identity` · `custom` |
| **Auth methods** | `api-key` · `oauth2` · `service-account` · `iam-role` · `certificate` · `token` · `custom` |

### Provider lifecycle

Providers follow a strict state machine:

```
uninitialized ──► initializing ──► ready ──► active
                                     ▲         │
                                     │    suspending
                                     │         │
                                  suspended ◄──┘
                                     │
                                terminating ──► terminated
                                     │
                                   error
```

**Lifecycle hooks** (10 stages):
`beforeInit` · `afterInit` · `beforeStart` · `afterStart` · `beforeStop` ·
`afterStop` · `beforeDestroy` · `afterDestroy` · `onError` · `onHealthCheck`

### Provider registry

`InfrastructureProviderRegistry` is the central registry for provider
factories and instances:

| Method | Description |
|---|---|
| `registerFactory(meta, factory, plugin?)` | Register a provider factory |
| `unregisterFactory(factoryId)` | Remove a factory |
| `getFactory(factoryId)` | Look up a factory by ID |
| `getAllFactories()` | List all registered factories |
| `createProvider(factoryId, options)` | Instantiate a provider |
| `createAndInitializeProvider(factoryId, options)` | Create + initialize + authenticate |
| `getInstance(instanceId)` | Look up a running instance |
| `getAllInstances()` | List all instances |
| `getInstancesByFactory(factoryId)` | Instances for a given factory |
| `destroyInstance(instanceId)` | Tear down an instance |
| `discoverAndRegisterProviders()` | Run plugin discovery |
| `getStatistics()` | Factories count, instances count, lifecycle stats |
| `shutdown()` | Stop all providers and clean up |

### Lifecycle manager

`InfrastructureLifecycleManager` orchestrates provider state transitions,
health monitoring, and auto-restart:

| Option | Default | Description |
|---|---|---|
| `healthCheckInterval` | 60 000 ms | Periodic health poll |
| `autoRestart` | `true` | Restart on failure |
| `maxRestartAttempts` | 3 | Max restart tries |
| `restartDelay` | 5 000 ms | Delay between restarts |
| `shutdownTimeout` | 30 000 ms | Graceful shutdown timeout |

Key methods: `registerProvider`, `initializeProvider`, `startProvider`,
`stopProvider`, `destroyProvider`, `startAll`, `shutdown`, `getStatistics`.

### Session manager

`InfrastructureSessionManager` manages stateful sessions for infrastructure
operations:

- **In-memory storage** (`InMemorySessionStorage`) — fast, ephemeral
- **File-based storage** (`FileSessionStorage`) — persistent across restarts
- Sessions track provider context, auth, resources, variables, pending
  operations, and command history
- Automatic expiry and cleanup on a configurable interval

### Plugin discovery

`InfrastructurePluginDiscoverer` searches multiple sources for provider
plugins:

| Source | Description |
|---|---|
| Bundled | Shipped with the installation |
| Installed | Added via package manager |
| Local | Directories on disk |
| Remote | Registry URLs |

Manifest files recognised:
`infrastructure.plugin.json`, `espada-infrastructure.json`, `plugin.json`,
`package.json`.

Discovery results are cached (default 60 s TTL).

---

## Security facade

`InfrastructureSecurityFacade` unifies seven security subsystems behind a
single `checkOperation()` call:

### 1. Risk scoring

`InfrastructureRiskScorer` computes a 0-100 risk score from weighted factors:

| Factor | Default weight | Description |
|---|---|---|
| Environment | 0.25 | Production = 2×, staging = 1.2×, dev = 0.5× |
| Operation type | 0.20 | delete 90, security 85, network 80 … audit 10 |
| Resource count | 0.10 | More resources → higher risk |
| Resource criticality | 0.15 | Matches `*-prod-*`, `*-database-*`, etc. |
| Time of day | 0.05 | Off-hours penalised |
| User history | 0.10 | Past success/failure ratio |
| Recent changes | 0.10 | Churn indicator |
| Rollback availability | 0.05 | No rollback → higher risk |

Risk levels: `critical` (≥ 80) · `high` (≥ 60) · `medium` (≥ 40) · `low` (≥ 20) · `minimal`.

### 2. RBAC

`InfrastructureRBACManager` enforces role-based access with 15 granular
permissions:

`infra:read` · `infra:create` · `infra:update` · `infra:delete` ·
`infra:scale` · `infra:migrate` · `infra:backup` · `infra:restore` ·
`infra:security` · `infra:network` · `infra:access` · `infra:audit` ·
`infra:approve` · `infra:admin` · `infra:break-glass`

Roles support per-environment scoping, time-window constraints, cost limits,
and operation-rate limits.

### 3. Approval chains

`InfrastructureApprovalManager` implements multi-step approval workflows:

- Configurable chains per risk level and environment
- Escalation policies with timeout-based auto-escalation
- Approval conditions: time-window, parameter-override,
  monitoring-required, rollback-plan

### 4. Audit logging

`InfrastructureAuditLogger` records 21 event types:

`operation_requested` · `operation_approved` · `operation_rejected` ·
`operation_started` · `operation_completed` · `operation_failed` ·
`operation_rolled_back` · `permission_granted` · `permission_denied` ·
`break_glass_activated` · `break_glass_deactivated` · `role_assigned` ·
`role_revoked` · `policy_changed` · `escalation_triggered` ·
`time_window_override` · `access_denied` · `command_executed` ·
`command_failed` · `session_started` · `session_ended`

### 5. Rollback plans

`InfrastructureRollbackManager` generates and tracks rollback plans with
step-by-step reversal procedures, risk ratings, and estimated durations.

### 6. Time windows

`InfrastructureTimeWindowManager` enforces deployment windows:

- Per-environment and per-risk-level schedules
- Configurable day-of-week, start/end hours, timezone
- Override capability for emergencies

### 7. Break-glass access

`InfrastructureBreakGlassManager` provides emergency bypass:

- Requires a reason code and justification
- Sessions are time-limited and fully audited
- Configurable policies per environment
- Auto-deactivation after timeout

### Security check flow

```
checkOperation()
  │
  ├─ 1. Risk scoring  ──► compute risk score + level
  ├─ 2. Break glass    ──► if active, bypass remaining checks
  ├─ 3. RBAC           ──► check user permissions
  ├─ 4. Time windows   ──► enforce deployment windows
  └─ 5. Approval       ──► require multi-step approval if needed
```

---

## Validation

### Command validator

`InfrastructureCommandValidator` validates command parameters against
their declared schemas:

- Type validation (string, number, boolean, array, object, file, secret,
  resource-ref)
- Pattern / min / max / enum constraints
- Required-parameter checks
- Sensitive-parameter redaction
- Dangerous-command explicit confirmation
- Built-in validators: `requiredParams`, `typeCheck`, `sensitiveParams`,
  `dryRunCheck`, `dangerousCommandCheck`

### Config validator

Zod-based validation for all configuration sections:

| Function | Validates |
|---|---|
| `validateInfrastructureConfig(config)` | Full config |
| `validateProviderConfig(config)` | Provider entries |
| `validateSessionConfig(config)` | Session settings |
| `validateCommandConfig(config)` | Command settings |
| `validateLoggingConfig(config)` | Logging settings |
| `validateSecurityConfig(config)` | Security settings |
| `getDefaultInfrastructureConfig()` | Returns safe defaults |
| `mergeWithDefaults(partial)` | Deep-merge with defaults |
| `getInfrastructureConfigJsonSchema()` | JSON Schema export |

---

## Logging

`InfrastructureLoggerImpl` provides structured, contextual logging:

- **Six levels:** trace · debug · info · warn · error · fatal
- **Structured entries** with subsystem, providerId, sessionId, commandId,
  resourceId, duration, error
- **Transports:** `ConsoleTransport` (colour-coded TTY), `FileTransport`
  (JSON lines to disk)
- **Child loggers** via `logger.child("name")` for subsystem scoping
- **Context injection** via `logger.withContext({ providerId, sessionId })`
- **Redaction** of patterns matching `redactPatterns` config

---

## Conversational AI pipeline

`InfrastructureConversationManager` integrates seven components to turn
natural-language messages into structured infrastructure operations:

### Intent classifier

`InfrastructureIntentClassifier` classifies user messages into infrastructure
intent categories (provision, manage, monitor, security, cost, utility) with
confidence scores and clarification detection.

### Parameter extractor

`InfrastructureParameterExtractor` pulls typed parameters from natural
language, identifies ambiguous values, and suggests defaults when parameters
are missing.

### Resource resolver

`InfrastructureResourceResolver` resolves natural-language resource
references (by name, ID, or context) and handles ambiguity when multiple
resources match.

### State provider

`InfrastructureStateProvider` maintains a live snapshot of infrastructure
state including resource metrics, active operations, and progress tracking.
Supports metric queries and state subscriptions.

### Confirmation workflow

`InfrastructureConfirmationWorkflow` determines when operations need
user confirmation based on risk, environment, and intent. Generates impact
summaries and manages pending confirmations.

### Error humanizer

`InfrastructureErrorHumanizer` translates raw errors and stack traces into
user-friendly explanations with suggested remediation actions.

### Status updater

`InfrastructureStatusUpdater` tracks operation progress with step-by-step
updates, subscriber notifications, and configurable verbosity.

---

## SDK

The SDK (`@espada/infrastructure/sdk`) provides builders and helpers
for rapid provider development.

### Provider builder

```ts
import { defineProvider } from "@espada/infrastructure/sdk";

const meta = defineProvider()
  .id("my-cloud")
  .name("My Cloud Provider")
  .displayName("My Cloud")
  .description("Custom cloud infrastructure provider")
  .version("1.0.0")
  .category("cloud")
  .capabilities("provision", "deprovision", "scale", "monitor")
  .supportedResources("compute", "storage", "network")
  .authMethods("api-key", "oauth2")
  .build();
```

### Command builder

```ts
import { defineCommand } from "@espada/infrastructure/sdk";

const command = defineCommand()
  .id("create-instance")
  .name("Create Instance")
  .description("Provision a new compute instance")
  .category("provision")
  .stringParam("name", "Instance name", { required: true })
  .stringParam("region", "Target region", { required: true })
  .numberParam("cpu", "CPU count", { default: 2 })
  .numberParam("memory", "Memory in GB", { default: 4 })
  .booleanParam("dryRun", "Simulate without provisioning")
  .requiredCapabilities("provision")
  .supportsDryRun()
  .dangerous(false)
  .example("Create a small instance", { name: "web-1", region: "us-east-1", cpu: 2 })
  .build();
```

### Simple provider

```ts
import { createSimpleProvider, success, failure } from "@espada/infrastructure/sdk";

const provider = createSimpleProvider({
  meta,
  commands: [command],

  async onInitialize(auth, logger) {
    logger.info("Connecting with API key");
    // Validate credentials…
  },

  async onStart(logger) {
    logger.info("Provider started");
  },

  async onHealthCheck(logger) {
    return [{ name: "api", status: "healthy" }];
  },

  async onExecuteCommand(cmd, params, ctx, logger) {
    if (cmd.id === "create-instance") {
      // Provision resource…
      return success({ instanceId: "i-123" }, ["i-123"]);
    }
    return failure("UNKNOWN_CMD", `Unknown: ${cmd.id}`);
  },
});
```

### Base provider class

For advanced use, extend `BaseInfrastructureProvider` directly and override
the abstract methods:

| Abstract method | Purpose |
|---|---|
| `onInitialize(auth)` | Authenticate and connect |
| `onStart()` | Prepare for operations |
| `onStop()` | Graceful pause |
| `onDestroy()` | Cleanup resources |
| `performHealthChecks()` | Return health check items |
| `onValidateConfig(config)` | Validate provider config |
| `onExecuteCommand(cmd, params, ctx, log)` | Run a command |

Helper methods available on the base class: `registerCommand`,
`updateResource`, `removeResource`, `emitLifecycleHook`.

### Result helpers

| Helper | Usage |
|---|---|
| `success(data, affectedResources?)` | Wrap a successful result |
| `failure(code, message, options?)` | Wrap an error result |
| `validation.ok()` | Valid config |
| `validation.error(code, msg, path?)` | Config error |
| `validation.warning(code, msg, path?)` | Config warning |

---

## CLI commands

All commands live under `espada infra`:

| Command | Description |
|---|---|
| `espada infra providers` | List registered provider factories (name, ID, category, version, capabilities) |
| `espada infra instances` | List active provider instances (instanceId, provider, state, createdAt) |
| `espada infra status` | Show framework status — factory count, instance count, lifecycle hooks, health summary |
| `espada infra discover` | Trigger plugin discovery and register discovered providers |

---

## Gateway methods

| Method | Returns |
|---|---|
| `infrastructure/providers` | All registered factories (id, meta, registeredAt) |
| `infrastructure/instances` | All active instances (id, instanceId, state, createdAt) |
| `infrastructure/status` | Registry statistics (factories, instances, lifecycle stats, health summary) |

---

## Services

| Service | Behaviour |
|---|---|
| `infrastructure-framework` | `start()` — logs readiness; `stop()` — calls `registry.shutdown()`, tears down all providers and sessions |

---

## Event types

The framework emits 20 event types across provider, session, command,
resource, and system categories:

```
provider:registered  provider:initialized  provider:ready
provider:error       provider:terminated
session:created      session:activated     session:expired
session:terminated
command:started      command:completed     command:failed
command:cancelled
resource:created     resource:updated      resource:deleted
resource:error
health:check         config:changed
```

---

## Example conversations

**Check framework status**
```
You: What infrastructure providers are running?
Espada: The infrastructure framework has 3 registered factories and 2 active
        instances. Both instances are healthy.
```

**Discover new providers**
```
You: Discover infrastructure plugins
Espada: Running plugin discovery… found 2 new providers:
        • aws-core (cloud) — provision, deprovision, scale, monitor
        • k8s-core (kubernetes) — provision, scale, monitor, rollback
        Registered both provider factories.
```

**Security check before operation**
```
You: Delete the production database cluster
Espada: ⚠ Risk score: 92/100 (critical)
        Factors: production environment (2×), delete operation (90),
        critical resource (*-database-*).
        This requires approval from an infra:admin before proceeding.
        Shall I submit an approval request?
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Registry not initialized" in CLI output | The plugin has not finished `activate()`. Check `espada infra status` after startup completes. |
| Provider stuck in `initializing` | Auth credentials may be invalid. Check `loggingConfig.level: debug` for details. |
| Discovery finds 0 plugins | Verify `bundledDirs` / `installedDirs` point to directories containing valid manifest files. |
| Session expired unexpectedly | Increase `sessionConfig.timeout` or call `session.extend()` from the SDK. |
| Break-glass access denied | Ensure the user's role includes `infra:break-glass` permission and the environment policy allows activation. |
| High risk score blocking operations | Lower `securityConfig` thresholds or run in `development` environment first. |
| Health checks report "degraded" | One or more provider sub-checks are failing. Run `espada infra status` for the health summary. |
