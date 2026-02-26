/**
 * Azure service lifecycle — start() / stop() registration.
 *
 * Extracted from the monolithic index.ts. Instantiates every Azure manager
 * during start() and stores them on the shared AzurePluginState; clears them
 * during stop().
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import type { AzurePluginState } from "./plugin-state.js";
import { clearPluginState } from "./plugin-state.js";

// Manager constructors
import { createCredentialsManager } from "./credentials/index.js";
import { createCLIWrapper } from "./cli/index.js";
import { AzureContextManager } from "./context/index.js";
import { AzureServiceDiscovery } from "./discovery/index.js";
import { AzureTaggingManager } from "./tagging/index.js";
import { AzureActivityLogManager } from "./activitylog/index.js";
import { AzureVMManager } from "./vms/index.js";
import { AzureFunctionsManager } from "./functions/index.js";
import { AzureContainerManager } from "./containers/index.js";
import { AzureStorageManager } from "./storage/index.js";
import { AzureSQLManager } from "./sql/index.js";
import { AzureCosmosDBManager } from "./cosmosdb/index.js";
import { AzureNetworkManager } from "./network/index.js";
import { AzureKeyVaultManager } from "./keyvault/index.js";
import { AzureMonitorManager } from "./monitor/index.js";
import { AzureIAMManager } from "./iam/index.js";
import { AzureCostManager } from "./cost/index.js";
import { AzureServiceBusManager } from "./servicebus/index.js";
import { AzureEventGridManager } from "./eventgrid/index.js";
import { AzureDNSManager } from "./dns/index.js";
import { AzureRedisManager } from "./redis/index.js";
import { AzureCDNManager } from "./cdn/index.js";
import { AzureSecurityManager } from "./security/index.js";
import { AzurePolicyManager } from "./policy/index.js";
import { AzureBackupManager } from "./backup/index.js";
import { AzureAIManager } from "./ai/index.js";
import { AzureDevOpsManager, createPATManager } from "./devops/index.js";
import { AzureAPIManagementManager } from "./apimanagement/index.js";
import { AzureLogicAppsManager } from "./logic/index.js";
import { AzureResourceManager } from "./resources/index.js";
import { AzureSubscriptionManager } from "./subscriptions/index.js";
import { createGuardrailsManager } from "./guardrails/index.js";
import { AzureComplianceManager } from "./compliance/index.js";
import { AzureAutomationManager } from "./automation/index.js";
import { AzureHybridManager } from "./hybrid/index.js";
import { AzureWebAppManager } from "./webapp/index.js";
import { AzureFirewallManager } from "./firewall/index.js";
import { AzureEventHubsManager } from "./eventhubs/index.js";
import { AzureAppGatewayManager } from "./appgateway/index.js";
import { AzureTrafficManagerManager } from "./trafficmanager/index.js";
import { AzureBastionManager } from "./bastion/index.js";
import { AzureFrontDoorManager } from "./frontdoor/index.js";
import { AzureStaticWebAppsManager } from "./staticwebapps/index.js";

// Orchestration (IDIO)
import { Orchestrator, registerBuiltinSteps, clearStepRegistry } from "./orchestration/index.js";

export function registerServiceLifecycle(api: EspadaPluginApi, state: AzurePluginState): void {
  api.registerService({
    id: "azure-core-services",

    async start() {
      const log = state.pluginLogger ?? { info: console.log, warn: console.warn, error: console.error };
      log.info("[Azure] Initializing Azure managers");

      const config = state.config;
      const subscriptionId = config.defaultSubscription ?? "";
      const retryOpts = config.retryConfig
        ? { maxAttempts: config.retryConfig.maxAttempts ?? 3, minDelayMs: config.retryConfig.minDelayMs ?? 100, maxDelayMs: config.retryConfig.maxDelayMs ?? 30000 }
        : undefined;

      // Initialize credentials
      state.credentialsManager = createCredentialsManager({
        defaultSubscription: subscriptionId,
        defaultTenantId: config.defaultTenantId,
        credentialMethod: (config.credentialMethod ?? "default") as "default" | "cli" | "service-principal" | "managed-identity" | "browser",
      });
      await state.credentialsManager.initialize();

      state.cliWrapper = createCLIWrapper();
      state.contextManager = new AzureContextManager(state.credentialsManager, config.defaultRegion);
      state.serviceDiscovery = new AzureServiceDiscovery(state.credentialsManager, subscriptionId);
      state.taggingManager = new AzureTaggingManager(state.credentialsManager, subscriptionId);
      state.activityLogManager = new AzureActivityLogManager(state.credentialsManager, subscriptionId);

      // Compute
      state.vmManager = new AzureVMManager(state.credentialsManager, subscriptionId, config.defaultRegion, retryOpts);
      state.functionsManager = new AzureFunctionsManager(state.credentialsManager, subscriptionId, retryOpts);
      state.webAppManager = new AzureWebAppManager(state.credentialsManager, subscriptionId, retryOpts);
      state.staticWebAppsManager = new AzureStaticWebAppsManager(state.credentialsManager, subscriptionId, retryOpts);
      state.containerManager = new AzureContainerManager(state.credentialsManager, subscriptionId, retryOpts);

      // Data
      state.storageManager = new AzureStorageManager(state.credentialsManager, subscriptionId, retryOpts);
      state.sqlManager = new AzureSQLManager(state.credentialsManager, subscriptionId, retryOpts);
      state.cosmosDBManager = new AzureCosmosDBManager(state.credentialsManager, subscriptionId, retryOpts);
      state.redisManager = new AzureRedisManager(state.credentialsManager, subscriptionId, retryOpts);

      // Networking
      state.networkManager = new AzureNetworkManager(state.credentialsManager, subscriptionId, retryOpts);
      state.firewallManager = new AzureFirewallManager(state.credentialsManager, subscriptionId, retryOpts);
      state.appGatewayManager = new AzureAppGatewayManager(state.credentialsManager, subscriptionId, retryOpts);
      state.trafficManagerManager = new AzureTrafficManagerManager(state.credentialsManager, subscriptionId, retryOpts);
      state.bastionManager = new AzureBastionManager(state.credentialsManager, subscriptionId, retryOpts);
      state.frontDoorManager = new AzureFrontDoorManager(state.credentialsManager, subscriptionId, retryOpts);
      state.dnsManager = new AzureDNSManager(state.credentialsManager, subscriptionId, retryOpts);
      state.cdnManager = new AzureCDNManager(state.credentialsManager, subscriptionId, retryOpts);

      // Security & Identity
      state.keyVaultManager = new AzureKeyVaultManager(state.credentialsManager, subscriptionId, retryOpts);
      state.iamManager = new AzureIAMManager(state.credentialsManager, subscriptionId, retryOpts);
      state.securityManager = new AzureSecurityManager(state.credentialsManager, subscriptionId, retryOpts);
      state.policyManager = new AzurePolicyManager(state.credentialsManager, subscriptionId, retryOpts);

      // Operations
      state.monitorManager = new AzureMonitorManager(state.credentialsManager, subscriptionId, retryOpts);
      state.costManager = new AzureCostManager(state.credentialsManager, subscriptionId, retryOpts);
      state.backupManager = new AzureBackupManager(state.credentialsManager, subscriptionId, retryOpts);
      state.automationManager = new AzureAutomationManager(state.credentialsManager, subscriptionId, retryOpts);

      // Messaging
      state.serviceBusManager = new AzureServiceBusManager(state.credentialsManager, subscriptionId, retryOpts);
      state.eventGridManager = new AzureEventGridManager(state.credentialsManager, subscriptionId, retryOpts);
      state.eventHubsManager = new AzureEventHubsManager(state.credentialsManager, subscriptionId, retryOpts);

      // AI
      state.aiManager = new AzureAIManager(state.credentialsManager, subscriptionId, retryOpts);

      // Platform
      state.resourceManager = new AzureResourceManager(state.credentialsManager, subscriptionId, retryOpts);
      state.subscriptionManager = new AzureSubscriptionManager(state.credentialsManager, retryOpts);
      state.logicManager = new AzureLogicAppsManager(state.credentialsManager, subscriptionId, retryOpts);
      state.apimManager = new AzureAPIManagementManager(state.credentialsManager, subscriptionId, retryOpts);

      // DevOps (requires organization)
      if (config.devOpsOrganization) {
        state.devOpsManager = new AzureDevOpsManager(state.credentialsManager, config.devOpsOrganization, retryOpts);
      }

      // PAT Manager (always available — stores encrypted PATs locally)
      state.patManager = createPATManager({ defaultOrganization: config.devOpsOrganization });
      await state.patManager.initialize();

      // Governance
      state.guardrailsManager = createGuardrailsManager();
      state.complianceManager = new AzureComplianceManager(state.credentialsManager, subscriptionId, retryOpts);

      // Hybrid / Arc
      state.hybridManager = new AzureHybridManager(state.credentialsManager, subscriptionId, config.defaultRegion, retryOpts);

      // Orchestration (IDIO)
      clearStepRegistry();
      registerBuiltinSteps(
        () => state.resourceManager!,
        () => state.storageManager!,
      );
      state.orchestrator = new Orchestrator({
        globalTags: Object.fromEntries(
          (config.defaultTags ?? []).map((t: { key: string; value: string }) => [t.key, t.value]),
        ),
      });

      // Optionally probe identity
      try {
        await state.contextManager.initialize();
      } catch {
        // Credentials may not be available at start
      }

      log.info("[Azure] Azure Core Services started");
    },

    async stop() {
      clearPluginState(state);
      clearStepRegistry();
      state.pluginLogger?.info("[Azure] Azure Core Services stopped");
    },
  });
}
