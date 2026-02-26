/**
 * Shared mutable state for the Azure plugin.
 *
 * All manager references live on a single object so that CLI, gateway, and tool
 * registration files can capture them by reference. The lifecycle (start/stop)
 * populates and clears the state; the registered callbacks read from it at
 * invocation time.
 */

import type { EspadaPluginApi } from "espada/plugin-sdk";
import type { AzureCredentialsManager } from "./credentials/index.js";
import type { AzureCLIWrapper } from "./cli/index.js";
import type { AzureContextManager } from "./context/index.js";
import type { AzureServiceDiscovery } from "./discovery/index.js";
import type { AzureTaggingManager } from "./tagging/index.js";
import type { AzureActivityLogManager } from "./activitylog/index.js";
import type { AzureVMManager } from "./vms/index.js";
import type { AzureFunctionsManager } from "./functions/index.js";
import type { AzureContainerManager } from "./containers/index.js";
import type { AzureStorageManager } from "./storage/index.js";
import type { AzureSQLManager } from "./sql/index.js";
import type { AzureCosmosDBManager } from "./cosmosdb/index.js";
import type { AzureNetworkManager } from "./network/index.js";
import type { AzureKeyVaultManager } from "./keyvault/index.js";
import type { AzureMonitorManager } from "./monitor/index.js";
import type { AzureIAMManager } from "./iam/index.js";
import type { AzureCostManager } from "./cost/index.js";
import type { AzureServiceBusManager } from "./servicebus/index.js";
import type { AzureEventGridManager } from "./eventgrid/index.js";
import type { AzureDNSManager } from "./dns/index.js";
import type { AzureRedisManager } from "./redis/index.js";
import type { AzureCDNManager } from "./cdn/index.js";
import type { AzureSecurityManager } from "./security/index.js";
import type { AzurePolicyManager } from "./policy/index.js";
import type { AzureBackupManager } from "./backup/index.js";
import type { AzureAIManager } from "./ai/index.js";
import type { AzureDevOpsManager, DevOpsPATManager } from "./devops/index.js";
import type { AzureAPIManagementManager } from "./apimanagement/index.js";
import type { AzureLogicAppsManager } from "./logic/index.js";
import type { AzureResourceManager } from "./resources/index.js";
import type { AzureSubscriptionManager } from "./subscriptions/index.js";
import type { AzureGuardrailsManager } from "./guardrails/index.js";
import type { AzureComplianceManager } from "./compliance/index.js";
import type { AzureAutomationManager } from "./automation/index.js";
import type { AzureHybridManager } from "./hybrid/index.js";
import type { AzureWebAppManager } from "./webapp/index.js";
import type { AzureFirewallManager } from "./firewall/index.js";
import type { AzureEventHubsManager } from "./eventhubs/index.js";
import type { AzureAppGatewayManager } from "./appgateway/index.js";
import type { AzureTrafficManagerManager } from "./trafficmanager/index.js";
import type { AzureBastionManager } from "./bastion/index.js";
import type { AzureFrontDoorManager } from "./frontdoor/index.js";
import type { AzureStaticWebAppsManager } from "./staticwebapps/index.js";
import type { AzureSynapseManager } from "./synapse/index.js";
import type { AzureDataFactoryManager } from "./datafactory/index.js";
import type { AzureSignalRManager } from "./signalr/index.js";
import type { AzureNotificationHubsManager } from "./notificationhubs/index.js";
import type { AzureDatabaseManager } from "./database/index.js";
import type { AzureSpringAppsManager } from "./springapps/index.js";
import type { AzurePurviewManager } from "./purview/index.js";
import type { AzureMapsManager } from "./maps/index.js";
import type { AzureDigitalTwinsManager } from "./digitaltwins/index.js";
import type { Orchestrator } from "./orchestration/index.js";
import type { AzureExtensionConfig } from "./config.js";

export type { AzureExtensionConfig } from "./config.js";

/** Mutable state container shared across all registration modules. */
export interface AzurePluginState {
  config: AzureExtensionConfig;
  pluginLogger: EspadaPluginApi["logger"] | null;

  // Managers (set during service start, cleared on stop)
  credentialsManager: AzureCredentialsManager | null;
  cliWrapper: AzureCLIWrapper | null;
  contextManager: AzureContextManager | null;
  serviceDiscovery: AzureServiceDiscovery | null;
  taggingManager: AzureTaggingManager | null;
  activityLogManager: AzureActivityLogManager | null;
  vmManager: AzureVMManager | null;
  functionsManager: AzureFunctionsManager | null;
  webAppManager: AzureWebAppManager | null;
  containerManager: AzureContainerManager | null;
  storageManager: AzureStorageManager | null;
  sqlManager: AzureSQLManager | null;
  cosmosDBManager: AzureCosmosDBManager | null;
  networkManager: AzureNetworkManager | null;
  firewallManager: AzureFirewallManager | null;
  appGatewayManager: AzureAppGatewayManager | null;
  trafficManagerManager: AzureTrafficManagerManager | null;
  bastionManager: AzureBastionManager | null;
  frontDoorManager: AzureFrontDoorManager | null;
  keyVaultManager: AzureKeyVaultManager | null;
  monitorManager: AzureMonitorManager | null;
  iamManager: AzureIAMManager | null;
  costManager: AzureCostManager | null;
  serviceBusManager: AzureServiceBusManager | null;
  eventGridManager: AzureEventGridManager | null;
  eventHubsManager: AzureEventHubsManager | null;
  staticWebAppsManager: AzureStaticWebAppsManager | null;
  dnsManager: AzureDNSManager | null;
  redisManager: AzureRedisManager | null;
  cdnManager: AzureCDNManager | null;
  securityManager: AzureSecurityManager | null;
  policyManager: AzurePolicyManager | null;
  backupManager: AzureBackupManager | null;
  aiManager: AzureAIManager | null;
  devOpsManager: AzureDevOpsManager | null;
  patManager: DevOpsPATManager | null;
  apimManager: AzureAPIManagementManager | null;
  logicManager: AzureLogicAppsManager | null;
  resourceManager: AzureResourceManager | null;
  subscriptionManager: AzureSubscriptionManager | null;
  guardrailsManager: AzureGuardrailsManager | null;
  complianceManager: AzureComplianceManager | null;
  automationManager: AzureAutomationManager | null;
  hybridManager: AzureHybridManager | null;
  synapseManager: AzureSynapseManager | null;
  dataFactoryManager: AzureDataFactoryManager | null;
  signalRManager: AzureSignalRManager | null;
  notificationHubsManager: AzureNotificationHubsManager | null;
  databaseManager: AzureDatabaseManager | null;
  springAppsManager: AzureSpringAppsManager | null;
  purviewManager: AzurePurviewManager | null;
  mapsManager: AzureMapsManager | null;
  digitalTwinsManager: AzureDigitalTwinsManager | null;
  orchestrator: Orchestrator | null;
}

/** Create a fresh plugin state with all managers set to null. */
export function createPluginState(config: AzureExtensionConfig): AzurePluginState {
  return {
    config,
    pluginLogger: null,
    credentialsManager: null,
    cliWrapper: null,
    contextManager: null,
    serviceDiscovery: null,
    taggingManager: null,
    activityLogManager: null,
    vmManager: null,
    functionsManager: null,
    webAppManager: null,
    containerManager: null,
    storageManager: null,
    sqlManager: null,
    cosmosDBManager: null,
    networkManager: null,
    firewallManager: null,
    appGatewayManager: null,
    trafficManagerManager: null,
    bastionManager: null,
    frontDoorManager: null,
    keyVaultManager: null,
    monitorManager: null,
    iamManager: null,
    costManager: null,
    serviceBusManager: null,
    eventGridManager: null,
    eventHubsManager: null,
    staticWebAppsManager: null,
    dnsManager: null,
    redisManager: null,
    cdnManager: null,
    securityManager: null,
    policyManager: null,
    backupManager: null,
    aiManager: null,
    devOpsManager: null,
    patManager: null,
    apimManager: null,
    logicManager: null,
    resourceManager: null,
    subscriptionManager: null,
    guardrailsManager: null,
    complianceManager: null,
    automationManager: null,
    hybridManager: null,
    synapseManager: null,
    dataFactoryManager: null,
    signalRManager: null,
    notificationHubsManager: null,
    databaseManager: null,
    springAppsManager: null,
    purviewManager: null,
    mapsManager: null,
    digitalTwinsManager: null,
    orchestrator: null,
  };
}

/** Reset all managers to null during service stop. */
export function clearPluginState(state: AzurePluginState): void {
  if (state.credentialsManager) {
    state.credentialsManager.clearCache();
  }
  state.credentialsManager = null;
  state.cliWrapper = null;
  state.contextManager = null;
  state.serviceDiscovery = null;
  state.taggingManager = null;
  state.activityLogManager = null;
  state.vmManager = null;
  state.functionsManager = null;
  state.webAppManager = null;
  state.containerManager = null;
  state.storageManager = null;
  state.sqlManager = null;
  state.cosmosDBManager = null;
  state.networkManager = null;
  state.firewallManager = null;
  state.appGatewayManager = null;
  state.trafficManagerManager = null;
  state.bastionManager = null;
  state.frontDoorManager = null;
  state.keyVaultManager = null;
  state.monitorManager = null;
  state.iamManager = null;
  state.costManager = null;
  state.serviceBusManager = null;
  state.eventGridManager = null;
  state.eventHubsManager = null;
  state.staticWebAppsManager = null;
  state.dnsManager = null;
  state.redisManager = null;
  state.cdnManager = null;
  state.securityManager = null;
  state.policyManager = null;
  state.backupManager = null;
  state.aiManager = null;
  state.devOpsManager = null;
  state.patManager = null;
  state.apimManager = null;
  state.logicManager = null;
  state.resourceManager = null;
  state.subscriptionManager = null;
  state.guardrailsManager = null;
  state.complianceManager = null;
  state.automationManager = null;
  state.hybridManager = null;
  state.synapseManager = null;
  state.dataFactoryManager = null;
  state.signalRManager = null;
  state.notificationHubsManager = null;
  state.databaseManager = null;
  state.springAppsManager = null;
  state.purviewManager = null;
  state.mapsManager = null;
  state.digitalTwinsManager = null;
  state.orchestrator = null;
}

/** Theme helpers for CLI output. */
export const theme = {
  error: (s: string) => `\x1b[31m${s}\x1b[0m`,
  success: (s: string) => `\x1b[32m${s}\x1b[0m`,
  warn: (s: string) => `\x1b[33m${s}\x1b[0m`,
  info: (s: string) => `\x1b[34m${s}\x1b[0m`,
  muted: (s: string) => `\x1b[90m${s}\x1b[0m`,
} as const;
