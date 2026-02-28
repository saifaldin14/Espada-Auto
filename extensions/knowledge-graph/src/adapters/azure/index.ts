/**
 * Azure Adapter — Module Index
 *
 * Re-exports all public symbols from the decomposed Azure adapter modules.
 *
 * Module structure:
 *   context.ts      — Shared AzureAdapterContext interface for domain module delegation
 *   utils.ts        — Utility functions (node ID, edge builder, status mapping)
 *   compute.ts      — VM deeper discovery (power state, GPU detection, NIC linking)
 *   containers.ts   — AKS clusters, ACI groups, ACR registries
 *   network.ts      — VNets, NSGs, Load Balancers, Public IPs, Firewalls, AppGW, Front Door
 *   database.ts     — SQL Servers/Databases, CosmosDB accounts, Redis caches, MySQL/PostgreSQL flex
 *   storage.ts      — Storage accounts, blob containers
 *   serverless.ts   — Azure Functions, Web Apps, App Service Plans, Spring Apps, Static Web Apps
 *   messaging.ts    — Service Bus, Event Hubs, Event Grid
 *   security.ts     — Key Vault, Security Center, IAM role assignments
 *   dns.ts          — DNS zones, record sets, resolution edges
 *   backup.ts       — Recovery Services vaults, backup items
 *   ai.ts           — Cognitive Services, AI deployments
 *   cdn.ts          — CDN profiles, endpoints
 *   enrichment.ts   — Cost, monitoring, activity log, tagging enrichment
 *   governance.ts   — Azure Policy, Compliance
 *   devops.ts       — Azure DevOps, Automation Accounts
 *   integration.ts  — API Management, Logic Apps, Data Factory
 *   platform.ts     — Resource Groups, Subscriptions, Management Groups
 *   analytics.ts    — Synapse Analytics, Purview
 *   hybrid.ts       — Arc servers/K8s, HCI clusters, Bastion, Traffic Manager
 *   iot.ts          — SignalR, Digital Twins, Notification Hubs, Maps
 */

// Context
export type { AzureAdapterContext } from "./context.js";

// Utilities
export {
  buildAzureNodeId,
  makeAzureEdge,
  mapAzureStatus,
  findNodeByNativeId,
  pushEdgeIfNew,
} from "./utils.js";

// Domain Modules
export { discoverComputeDeeper } from "./compute.js";
export { discoverContainersDeeper } from "./containers.js";
export {
  discoverNetworkDeeper,
  discoverFirewallDeeper,
  discoverAppGatewayDeeper,
  discoverFrontDoorDeeper,
} from "./network.js";
export {
  discoverSQLDeeper,
  discoverCosmosDBDeeper,
  discoverRedisDeeper,
  discoverFlexDatabaseDeeper,
} from "./database.js";
export { discoverStorageDeeper } from "./storage.js";
export {
  discoverFunctionsDeeper,
  discoverWebAppsDeeper,
  discoverSpringAppsDeeper,
  discoverStaticWebAppsDeeper,
} from "./serverless.js";
export {
  discoverServiceBusDeeper,
  discoverEventHubsDeeper,
  discoverEventGridDeeper,
} from "./messaging.js";
export {
  discoverKeyVaultDeeper,
  discoverSecurityPosture,
  discoverIAMDeeper,
} from "./security.js";
export { discoverDNSDeeper } from "./dns.js";
export { discoverBackupDeeper } from "./backup.js";
export { discoverAIDeeper } from "./ai.js";
export { discoverCDNDeeper } from "./cdn.js";
export {
  enrichWithCostData,
  enrichWithMonitoring,
  enrichWithActivityLog,
  enrichWithTagData,
} from "./enrichment.js";

// Governance
export { discoverPolicyDeeper, discoverComplianceDeeper } from "./governance.js";

// DevOps & Automation
export { discoverDevOpsDeeper, discoverAutomationDeeper } from "./devops.js";

// Integration
export {
  discoverAPIManagementDeeper,
  discoverLogicAppsDeeper,
  discoverDataFactoryDeeper,
} from "./integration.js";

// Platform
export {
  discoverResourceGroupsDeeper,
  discoverSubscriptionsDeeper,
  discoverEnterpriseDeeper,
} from "./platform.js";

// Analytics
export { discoverSynapseDeeper, discoverPurviewDeeper } from "./analytics.js";

// Hybrid
export {
  discoverHybridDeeper,
  discoverBastionDeeper,
  discoverTrafficManagerDeeper,
} from "./hybrid.js";

// IoT / Realtime
export {
  discoverSignalRDeeper,
  discoverDigitalTwinsDeeper,
  discoverNotificationHubsDeeper,
  discoverMapsDeeper,
} from "./iot.js";
