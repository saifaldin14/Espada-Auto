/**
 * Azure Adapter — Shared Context Interface
 *
 * Defines the dependency surface that domain modules need from the main
 * AzureDiscoveryAdapter class. Follows the same pattern as the AWS adapter
 * context — enables domain-specific logic (compute, database, security, etc.)
 * to live in separate modules while sharing manager access.
 */

import type { GraphResourceType } from "../../types.js";
import type { AzureAdapterConfig } from "../azure.js";

/**
 * Shared context passed to Azure domain module functions.
 *
 * Provides access to adapter configuration, cost estimation,
 * and lazy-loaded @espada/azure manager instances.
 */
export interface AzureAdapterContext {
  /** Azure subscription ID from adapter config. */
  readonly subscriptionId: string;

  /** Full adapter configuration (read-only). */
  readonly config: AzureAdapterConfig;

  // ---------------------------------------------------------------------------
  // Cost Estimation
  // ---------------------------------------------------------------------------

  /** Static cost estimation fallback using resource metadata. */
  estimateCostStatic(
    resourceType: GraphResourceType,
    metadata: Record<string, unknown>,
  ): number | null;

  // ---------------------------------------------------------------------------
  // @espada/azure Manager Getters (lazy-loaded, return null if unavailable)
  // ---------------------------------------------------------------------------

  getVMManager(): Promise<unknown | null>;
  getContainerManager(): Promise<unknown | null>;
  getNetworkManager(): Promise<unknown | null>;
  getSQLManager(): Promise<unknown | null>;
  getCosmosDBManager(): Promise<unknown | null>;
  getStorageManager(): Promise<unknown | null>;
  getFunctionsManager(): Promise<unknown | null>;
  getWebAppManager(): Promise<unknown | null>;
  getKeyVaultManager(): Promise<unknown | null>;
  getServiceBusManager(): Promise<unknown | null>;
  getEventHubsManager(): Promise<unknown | null>;
  getEventGridManager(): Promise<unknown | null>;
  getDNSManager(): Promise<unknown | null>;
  getRedisManager(): Promise<unknown | null>;
  getCDNManager(): Promise<unknown | null>;
  getAIManager(): Promise<unknown | null>;
  getBackupManager(): Promise<unknown | null>;
  getFirewallManager(): Promise<unknown | null>;
  getAppGatewayManager(): Promise<unknown | null>;
  getFrontDoorManager(): Promise<unknown | null>;
  getCostManager(): Promise<unknown | null>;
  getMonitorManager(): Promise<unknown | null>;
  getSecurityManager(): Promise<unknown | null>;
  getIAMManager(): Promise<unknown | null>;
  getTaggingManager(): Promise<unknown | null>;
  getActivityLogManager(): Promise<unknown | null>;

  // New manager getters
  getPolicyManager(): Promise<unknown | null>;
  getComplianceManager(): Promise<unknown | null>;
  getDevOpsManager(): Promise<unknown | null>;
  getAutomationManager(): Promise<unknown | null>;
  getAPIManagementManager(): Promise<unknown | null>;
  getLogicManager(): Promise<unknown | null>;
  getDataFactoryManager(): Promise<unknown | null>;
  getResourcesManager(): Promise<unknown | null>;
  getSubscriptionsManager(): Promise<unknown | null>;
  getEnterpriseManager(): Promise<unknown | null>;
  getSynapseManager(): Promise<unknown | null>;
  getPurviewManager(): Promise<unknown | null>;
  getHybridManager(): Promise<unknown | null>;
  getBastionManager(): Promise<unknown | null>;
  getTrafficManagerManager(): Promise<unknown | null>;
  getSpringAppsManager(): Promise<unknown | null>;
  getStaticWebAppsManager(): Promise<unknown | null>;
  getSignalRManager(): Promise<unknown | null>;
  getDigitalTwinsManager(): Promise<unknown | null>;
  getNotificationHubsManager(): Promise<unknown | null>;
  getMapsManager(): Promise<unknown | null>;
  getDatabaseManager(): Promise<unknown | null>;
}
