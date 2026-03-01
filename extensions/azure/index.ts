/**
 * Azure Core Services Extension — Espada Plugin Entry Point
 *
 * Thin wrapper that delegates to focused registration modules:
 *   - src/register-cli.ts     — CLI commands
 *   - src/register-gateway.ts — Gateway methods
 *   - src/register-tools.ts   — Agent tools
 *   - src/lifecycle.ts        — Service start/stop
 *
 * State is shared via AzurePluginState (src/plugin-state.ts).
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import { enableAzureDiagnostics } from "./src/diagnostics.js";
import { configSchema, getDefaultConfig, type AzureExtensionConfig } from "./src/config.js";
import { createPluginState } from "./src/plugin-state.js";
import { registerAzureCli } from "./src/register-cli.js";
import { registerGatewayMethods } from "./src/register-gateway.js";
import { registerAgentTools } from "./src/register-tools.js";
import { registerServiceLifecycle } from "./src/lifecycle.js";

// Shared state — populated during register(), managers filled during start()
let _state: ReturnType<typeof createPluginState> | null = null;

const plugin = {
  id: "azure",
  name: "Azure Core Services",
  description: "Comprehensive Azure infrastructure management with VMs, Storage, KeyVault, and more",
  version: "2026.2.16-beta.1",
  configSchema,

  uiHints: {
    defaultSubscription: { label: "Default Subscription", help: "Azure subscription ID used when none is specified", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", advanced: false },
    defaultRegion: { label: "Default Region", help: "Azure region for new resources (e.g. eastus, westeurope)", placeholder: "eastus", advanced: false },
    defaultTenantId: { label: "Tenant ID", help: "Azure Active Directory tenant ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", advanced: false },
    credentialMethod: { label: "Credential Method", help: "Authentication method: cli, environment, or managed-identity", placeholder: "cli", advanced: true },
    devOpsOrganization: { label: "DevOps Organization", help: "Azure DevOps organization name for DevOps features", placeholder: "my-org", advanced: true },
    "tagConfig.enforceDefaultTags": { label: "Enforce Default Tags", help: "Automatically apply default tags to new resources", advanced: true },
    "tagConfig.defaultTags": { label: "Default Tags", help: "Default tags applied to all created resources (JSON object)", placeholder: '{"environment":"production"}', advanced: true },
    "retryConfig.maxRetries": { label: "Max Retries", help: "Maximum number of retry attempts for Azure API calls", placeholder: "3", advanced: true },
    "retryConfig.baseDelayMs": { label: "Retry Base Delay", help: "Base delay in milliseconds between retries", placeholder: "1000", advanced: true },
    "diagnostics.enabled": { label: "Enable Diagnostics", help: "Enable Azure diagnostic logging for debugging", advanced: true },
    "diagnostics.logLevel": { label: "Diagnostic Log Level", help: "Logging verbosity: info, warning, or error", placeholder: "info", advanced: true },
  },

  register(api: EspadaPluginApi) {
    api.logger.info("Registering Azure extension");

    const config = (api.pluginConfig as AzureExtensionConfig) ?? getDefaultConfig();
    const state = createPluginState(config);
    state.pluginLogger = api.logger;
    _state = state;

    if (config.diagnostics?.enabled) {
      enableAzureDiagnostics();
      api.logger.info("Azure diagnostics enabled");
    }

    // Register all modules
    registerAzureCli(api, state);
    registerGatewayMethods(api, state);
    registerAgentTools(api, state);
    registerServiceLifecycle(api, state);

    api.logger.info("[Azure] Azure extension registered successfully");
  },
};

export default plugin;

/**
 * Get the global Azure managers for programmatic access.
 */
export function getAzureManagers() {
  const s = _state;
  return {
    credentials: s?.credentialsManager ?? null,
    cli: s?.cliWrapper ?? null,
    context: s?.contextManager ?? null,
    serviceDiscovery: s?.serviceDiscovery ?? null,
    tagging: s?.taggingManager ?? null,
    activityLog: s?.activityLogManager ?? null,
    vm: s?.vmManager ?? null,
    functions: s?.functionsManager ?? null,
    containers: s?.containerManager ?? null,
    storage: s?.storageManager ?? null,
    sql: s?.sqlManager ?? null,
    cosmosDB: s?.cosmosDBManager ?? null,
    network: s?.networkManager ?? null,
    keyVault: s?.keyVaultManager ?? null,
    monitor: s?.monitorManager ?? null,
    iam: s?.iamManager ?? null,
    cost: s?.costManager ?? null,
    serviceBus: s?.serviceBusManager ?? null,
    eventGrid: s?.eventGridManager ?? null,
    dns: s?.dnsManager ?? null,
    redis: s?.redisManager ?? null,
    cdn: s?.cdnManager ?? null,
    security: s?.securityManager ?? null,
    policy: s?.policyManager ?? null,
    backup: s?.backupManager ?? null,
    ai: s?.aiManager ?? null,
    devOps: s?.devOpsManager ?? null,
    pat: s?.patManager ?? null,
    apim: s?.apimManager ?? null,
    logic: s?.logicManager ?? null,
    resources: s?.resourceManager ?? null,
    subscriptions: s?.subscriptionManager ?? null,
    guardrails: s?.guardrailsManager ?? null,
    compliance: s?.complianceManager ?? null,
    automation: s?.automationManager ?? null,
    hybrid: s?.hybridManager ?? null,
    orchestrator: s?.orchestrator ?? null,
    intentCompiler: s?.intentCompiler ?? null,
    conversationalManager: s?.conversationalManager ?? null,
    iacManager: s?.iacManager ?? null,
    reconciliationEngine: s?.reconciliationEngine ?? null,
    enterpriseServices: s?.enterpriseServices ?? null,
    deploymentStrategy: s?.deploymentStrategyManager ?? null,
  };
}
