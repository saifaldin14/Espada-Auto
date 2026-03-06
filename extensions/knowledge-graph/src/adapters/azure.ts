/**
 * Infrastructure Knowledge Graph — Azure Adapter
 *
 * Maps Azure resources into the universal graph model using the Azure
 * Resource Graph API for bulk discovery, enriched by per-service Azure
 * manager calls for deeper sub-resource discovery.
 *
 * Architecture:
 * - Phase 1: Azure Resource Graph KQL query for bulk resource discovery
 * - Phase 2: Per-service manager calls for deeper enrichment (azure/ domain modules)
 *
 * Azure SDK dependencies are loaded dynamically at runtime — this module
 * works with @azure/arm-resourcegraph and @azure/identity if installed.
 */

import type {
  GraphNodeInput,
  GraphEdgeInput,
  GraphResourceType,
  GraphRelationshipType,
  CloudProvider,
} from "../types.js";
import { ManagerCache, safeArray, safeRecord, safeNumber, safeString, toRecord } from "./validators.js";
import type {
  GraphDiscoveryAdapter,
  DiscoverOptions,
  DiscoveryResult,
  DiscoveryError,
} from "./types.js";
import type { AzureAdapterContext } from "./azure/context.js";

// Domain module imports (lazy-loaded via the adapter's delegation methods)
import * as computeModule from "./azure/compute.js";
import * as containersModule from "./azure/containers.js";
import * as networkModule from "./azure/network.js";
import * as databaseModule from "./azure/database.js";
import * as storageModule from "./azure/storage.js";
import * as serverlessModule from "./azure/serverless.js";
import * as messagingModule from "./azure/messaging.js";
import * as securityModule from "./azure/security.js";
import * as dnsModule from "./azure/dns.js";
import * as backupModule from "./azure/backup.js";
import * as aiModule from "./azure/ai.js";
import * as cdnModule from "./azure/cdn.js";
import * as enrichmentModule from "./azure/enrichment.js";
import * as governanceModule from "./azure/governance.js";
import * as devopsModule from "./azure/devops.js";
import * as integrationModule from "./azure/integration.js";
import * as platformModule from "./azure/platform.js";
import * as analyticsModule from "./azure/analytics.js";
import * as hybridModule from "./azure/hybrid.js";
import * as iotModule from "./azure/iot.js";

// =============================================================================
// Azure Resource Type → Graph Type Mapping
// =============================================================================

/**
 * Maps Azure resource types (as returned by Resource Graph) to our
 * canonical GraphResourceType. Covers the most common Azure services.
 */
export type AzureResourceMapping = {
  /** Azure resource type (lowercase), e.g. "microsoft.compute/virtualmachines". */
  azureType: string;
  /** Mapped graph resource type. */
  graphType: GraphResourceType;
  /** Whether this is an AI/ML workload. */
  isAiWorkload?: boolean;
};

export const AZURE_RESOURCE_MAPPINGS: AzureResourceMapping[] = [
  // Compute
  { azureType: "microsoft.compute/virtualmachines", graphType: "compute" },
  { azureType: "microsoft.compute/virtualmachinescalesets", graphType: "compute" },

  // Containers
  { azureType: "microsoft.containerservice/managedclusters", graphType: "cluster" },
  { azureType: "microsoft.containerinstance/containergroups", graphType: "container" },
  { azureType: "microsoft.app/containerapps", graphType: "container" },

  // Serverless
  { azureType: "microsoft.web/sites", graphType: "serverless-function" },
  { azureType: "microsoft.web/serverfarms", graphType: "compute" },

  // Networking
  { azureType: "microsoft.network/virtualnetworks", graphType: "vpc" },
  { azureType: "microsoft.network/virtualnetworks/subnets", graphType: "subnet" },
  { azureType: "microsoft.network/networksecuritygroups", graphType: "security-group" },
  { azureType: "microsoft.network/loadbalancers", graphType: "load-balancer" },
  { azureType: "microsoft.network/applicationgateways", graphType: "load-balancer" },
  { azureType: "microsoft.network/publicipaddresses", graphType: "network" },
  { azureType: "microsoft.network/natgateways", graphType: "nat-gateway" },
  { azureType: "microsoft.network/dnszones", graphType: "dns" },
  { azureType: "microsoft.network/privatednszones", graphType: "dns" },
  { azureType: "microsoft.cdn/profiles", graphType: "cdn" },
  { azureType: "microsoft.network/frontdoors", graphType: "cdn" },
  { azureType: "microsoft.network/networkinterfaces", graphType: "network" },
  { azureType: "microsoft.network/virtualnetworkgateways", graphType: "network" },

  // Database
  { azureType: "microsoft.sql/servers", graphType: "database" },
  { azureType: "microsoft.sql/servers/databases", graphType: "database" },
  { azureType: "microsoft.dbformysql/flexibleservers", graphType: "database" },
  { azureType: "microsoft.dbforpostgresql/flexibleservers", graphType: "database" },
  { azureType: "microsoft.documentdb/databaseaccounts", graphType: "database" },

  // Cache
  { azureType: "microsoft.cache/redis", graphType: "cache" },
  { azureType: "microsoft.cache/redisenterprise", graphType: "cache" },

  // Storage
  { azureType: "microsoft.storage/storageaccounts", graphType: "storage" },
  { azureType: "microsoft.compute/disks", graphType: "storage" },

  // Messaging
  { azureType: "microsoft.servicebus/namespaces", graphType: "queue" },
  { azureType: "microsoft.eventhub/namespaces", graphType: "stream" },
  { azureType: "microsoft.eventgrid/topics", graphType: "topic" },

  // Security / Identity
  { azureType: "microsoft.keyvault/vaults", graphType: "secret" },
  { azureType: "microsoft.managedidentity/userassignedidentities", graphType: "identity" },

  // API Management
  { azureType: "microsoft.apimanagement/service", graphType: "api-gateway" },

  // AI / ML
  { azureType: "microsoft.cognitiveservices/accounts", graphType: "custom", isAiWorkload: true },
  { azureType: "microsoft.machinelearningservices/workspaces", graphType: "custom", isAiWorkload: true },
  { azureType: "microsoft.machinelearningservices/workspaces/onlineendpoints", graphType: "custom", isAiWorkload: true },
  { azureType: "microsoft.search/searchservices", graphType: "custom", isAiWorkload: true },

  // Integration
  { azureType: "microsoft.logic/workflows", graphType: "serverless-function" },
  { azureType: "microsoft.datafactory/factories", graphType: "custom" },

  // Analytics
  { azureType: "microsoft.synapse/workspaces", graphType: "custom" },
  { azureType: "microsoft.purview/accounts", graphType: "custom" },

  // Hybrid / Arc
  { azureType: "microsoft.hybridcompute/machines", graphType: "hybrid-machine" },
  { azureType: "microsoft.kubernetes/connectedclusters", graphType: "connected-cluster" },
  { azureType: "microsoft.azurestackhci/clusters", graphType: "hci-cluster" },

  // Bastion
  { azureType: "microsoft.network/bastionhosts", graphType: "custom" },

  // Traffic Manager
  { azureType: "microsoft.network/trafficmanagerprofiles", graphType: "load-balancer" },

  // Automation
  { azureType: "microsoft.automation/automationaccounts", graphType: "custom" },

  // Platform
  { azureType: "microsoft.web/staticsites", graphType: "serverless-function" },
  { azureType: "microsoft.appplatform/spring", graphType: "container" },

  // IoT / Realtime
  { azureType: "microsoft.signalrservice/signalr", graphType: "custom" },
  { azureType: "microsoft.digitaltwins/digitaltwinsinstances", graphType: "custom" },
  { azureType: "microsoft.notificationhubs/namespaces", graphType: "topic" },
  { azureType: "microsoft.maps/accounts", graphType: "custom" },

  // Governance
  { azureType: "microsoft.authorization/policyassignments", graphType: "policy" },

  // Management Groups
  { azureType: "microsoft.management/managementgroups", graphType: "custom" },
];

// =============================================================================
// Azure Relationship Rules
// =============================================================================

/**
 * Rules for inferring relationships between Azure resources based on their
 * properties and resource ID hierarchy.
 */
export type AzureRelationshipRule = {
  sourceType: string;
  field: string;
  targetType: string;
  relationship: GraphRelationshipType;
  isArray: boolean;
};

export const AZURE_RELATIONSHIP_RULES: AzureRelationshipRule[] = [
  // VMs → VNet/Subnet via NIC
  { sourceType: "microsoft.compute/virtualmachines", field: "properties.networkProfile.networkInterfaces[].id", targetType: "microsoft.network/networkinterfaces", relationship: "attached-to", isArray: true },
  { sourceType: "microsoft.network/networkinterfaces", field: "properties.ipConfigurations[].properties.subnet.id", targetType: "microsoft.network/virtualnetworks/subnets", relationship: "runs-in", isArray: true },
  { sourceType: "microsoft.network/networkinterfaces", field: "properties.networkSecurityGroup.id", targetType: "microsoft.network/networksecuritygroups", relationship: "secured-by", isArray: false },

  // Subnets → VNet
  { sourceType: "microsoft.network/virtualnetworks/subnets", field: "__parent", targetType: "microsoft.network/virtualnetworks", relationship: "runs-in", isArray: false },

  // NSG → Subnet
  { sourceType: "microsoft.network/networksecuritygroups", field: "properties.subnets[].id", targetType: "microsoft.network/virtualnetworks/subnets", relationship: "secures", isArray: true },

  // Load Balancer → Public IP
  { sourceType: "microsoft.network/loadbalancers", field: "properties.frontendIPConfigurations[].properties.publicIPAddress.id", targetType: "microsoft.network/publicipaddresses", relationship: "uses", isArray: true },

  // AKS → VNet/Subnet
  { sourceType: "microsoft.containerservice/managedclusters", field: "properties.agentPoolProfiles[].vnetSubnetID", targetType: "microsoft.network/virtualnetworks/subnets", relationship: "runs-in", isArray: true },

  // App Service → Server Farm
  { sourceType: "microsoft.web/sites", field: "properties.serverFarmId", targetType: "microsoft.web/serverfarms", relationship: "runs-in", isArray: false },

  // SQL Database → SQL Server
  { sourceType: "microsoft.sql/servers/databases", field: "__parent", targetType: "microsoft.sql/servers", relationship: "runs-in", isArray: false },

  // Managed Identity → Key Vault (via access policies)
  { sourceType: "microsoft.keyvault/vaults", field: "properties.accessPolicies[].objectId", targetType: "microsoft.managedidentity/userassignedidentities", relationship: "used-by", isArray: true },

  // Traffic Manager → endpoints
  { sourceType: "microsoft.network/trafficmanagerprofiles", field: "properties.endpoints[].properties.targetResourceId", targetType: "*", relationship: "load-balances", isArray: true },

  // Bastion → VNet (via subnet)
  { sourceType: "microsoft.network/bastionhosts", field: "properties.ipConfigurations[].properties.subnet.id", targetType: "microsoft.network/virtualnetworks/subnets", relationship: "connected-to", isArray: true },

  // Logic Apps → Storage Account
  { sourceType: "microsoft.logic/workflows", field: "properties.flowAccessControlConfiguration.triggers.openAuthenticationPolicies", targetType: "*", relationship: "uses", isArray: false },

  // Arc servers → location
  { sourceType: "microsoft.hybridcompute/machines", field: "properties.privateLinkScopeResourceId", targetType: "*", relationship: "connected-to", isArray: false },
];

// =============================================================================
// Configuration
// =============================================================================

export type AzureAdapterConfig = {
  /** Azure subscription ID. */
  subscriptionId: string;
  /** Azure tenant ID (for authentication). */
  tenantId?: string;
  /** Azure client ID / app ID (for service principal auth). */
  clientId?: string;
  /** Azure client secret (for service principal auth). */
  clientSecret?: string;
  /** Resource groups to filter (all if omitted). */
  resourceGroups?: string[];
  /**
   * Optional client factory for dependency injection / testing.
   */
  clientFactory?: AzureClientFactory;
  /**
   * Pre-built @espada/azure managers for dependency injection.
   * Keys match the manager type, values are mock/real instances.
   */
  managers?: AzureManagerOverrides;
};

/** Override map for injecting Azure managers in tests. */
export type AzureManagerOverrides = {
  vm?: unknown | null;
  container?: unknown | null;
  network?: unknown | null;
  sql?: unknown | null;
  cosmosdb?: unknown | null;
  storage?: unknown | null;
  functions?: unknown | null;
  webapp?: unknown | null;
  keyvault?: unknown | null;
  servicebus?: unknown | null;
  eventhubs?: unknown | null;
  eventgrid?: unknown | null;
  dns?: unknown | null;
  redis?: unknown | null;
  cdn?: unknown | null;
  ai?: unknown | null;
  backup?: unknown | null;
  firewall?: unknown | null;
  appgateway?: unknown | null;
  frontdoor?: unknown | null;
  cost?: unknown | null;
  monitor?: unknown | null;
  security?: unknown | null;
  iam?: unknown | null;
  tagging?: unknown | null;
  activitylog?: unknown | null;
  // New managers
  policy?: unknown | null;
  compliance?: unknown | null;
  devops?: unknown | null;
  automation?: unknown | null;
  apimanagement?: unknown | null;
  logic?: unknown | null;
  datafactory?: unknown | null;
  resources?: unknown | null;
  subscriptions?: unknown | null;
  enterprise?: unknown | null;
  synapse?: unknown | null;
  purview?: unknown | null;
  hybrid?: unknown | null;
  bastion?: unknown | null;
  trafficmanager?: unknown | null;
  springapps?: unknown | null;
  staticwebapps?: unknown | null;
  signalr?: unknown | null;
  digitaltwins?: unknown | null;
  notificationhubs?: unknown | null;
  maps?: unknown | null;
  database?: unknown | null;
};

export type AzureClientFactory = (
  subscriptionId: string,
  config?: { credentials?: unknown },
) => AzureResourceGraphClient;

/** Minimal interface for Resource Graph query results. */
export type AzureResourceGraphClient = {
  query(query: string, subscriptionIds: string[]): Promise<AzureQueryResult>;
  dispose?: () => void;
};

export type AzureQueryResult = {
  data: AzureResourceRecord[];
  totalRecords: number;
};

export type AzureResourceRecord = {
  id: string;
  name: string;
  type: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  tags: Record<string, string> | null;
  properties: Record<string, unknown>;
  sku?: { name?: string; tier?: string; capacity?: number };
};

// =============================================================================
// Node ID
// =============================================================================

export function buildAzureNodeId(
  subscriptionId: string,
  resourceType: GraphResourceType,
  nativeId: string,
): string {
  // Use a hash of the full resource ID for brevity, but keep it deterministic
  return `azure:${subscriptionId}:${resourceType}:${hashResourceId(nativeId)}`;
}

function hashResourceId(id: string): string {
  // Simple deterministic hash — take the meaningful suffix from the Azure ID
  const parts = id.split("/");
  return parts.slice(-2).join("/").toLowerCase().replace(/[^a-z0-9-/]/g, "");
}

// =============================================================================
// Azure Discovery Adapter
// =============================================================================

/**
 * Azure Discovery Adapter.
 *
 * Uses Azure Resource Graph for efficient bulk discovery — a single paginated
 * query returns all resources across the subscription with full properties.
 * This is significantly faster than per-service API calls.
 *
 * Credential handling:
 * - DefaultAzureCredential (env vars, managed identity, Azure CLI, etc.)
 * - Service principal with client ID + client secret
 * - Custom client factory for testing
 */
export class AzureDiscoveryAdapter implements GraphDiscoveryAdapter {
  readonly provider: CloudProvider = "azure";
  readonly displayName = "Microsoft Azure";

  private config: AzureAdapterConfig;
  private sdkAvailable: boolean | null = null;

  // ---------------------------------------------------------------------------
  // Lazy-loaded @espada/azure manager instances (via type-safe ManagerCache)
  // ---------------------------------------------------------------------------
  private _managers = new ManagerCache();

  constructor(config: AzureAdapterConfig) {
    this.config = config;
  }

  supportedResourceTypes(): GraphResourceType[] {
    const types = new Set<GraphResourceType>();
    for (const mapping of AZURE_RESOURCE_MAPPINGS) {
      types.add(mapping.graphType);
    }
    return [...types];
  }

  /**
   * Discover all Azure resources using Resource Graph.
   */
  async discover(options?: DiscoverOptions): Promise<DiscoveryResult> {
    const startMs = Date.now();
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    const errors: DiscoveryError[] = [];

    if (!(await this.ensureSdkAvailable())) {
      return {
        provider: "azure",
        nodes: [],
        edges: [],
        errors: [{
          resourceType: "custom",
          message: "Azure SDK (@azure/arm-resourcegraph, @azure/identity) is not installed.",
        }],
        durationMs: Date.now() - startMs,
      };
    }

    try {
      const client = await this.createClient();
      if (!client) {
        return {
          provider: "azure",
          nodes: [],
          edges: [],
          errors: [{ resourceType: "custom", message: "Failed to create Azure Resource Graph client." }],
          durationMs: Date.now() - startMs,
        };
      }

      try {
        // Build the Resource Graph query
        const query = this.buildResourceGraphQuery(options);
        const result = await client.query(query, [this.config.subscriptionId]);

        // Build transient lookup: Azure resource ID → node ID
        const azureIdToNodeId = new Map<string, string>();

        for (const resource of result.data) {
          if (options?.signal?.aborted) break;

          const mapping = this.resolveMapping(resource.type);
          if (!mapping) continue; // Unknown resource type — skip

          // Apply tag filter
          if (options?.tags && resource.tags) {
            const match = Object.entries(options.tags).every(
              ([k, v]) => resource.tags?.[k] === v,
            );
            if (!match) continue;
          }

          const nodeId = buildAzureNodeId(
            this.config.subscriptionId,
            mapping.graphType,
            resource.id,
          );
          azureIdToNodeId.set(resource.id.toLowerCase(), nodeId);

          const node = this.mapResourceToNode(resource, mapping, nodeId);
          nodes.push(node);
        }

        // Second pass: extract relationships
        for (const resource of result.data) {
          if (options?.signal?.aborted) break;

          const mapping = this.resolveMapping(resource.type);
          if (!mapping) continue;

          const sourceNodeId = azureIdToNodeId.get(resource.id.toLowerCase());
          if (!sourceNodeId) continue;

          const resourceEdges = this.extractRelationships(
            sourceNodeId,
            resource,
            azureIdToNodeId,
          );
          edges.push(...resourceEdges);
        }
      } finally {
        client.dispose?.();
      }
    } catch (error) {
      errors.push({
        resourceType: "custom",
        message: `Azure discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // =========================================================================
    // Phase 2: Domain module deeper discovery via @espada/azure managers
    // =========================================================================
    if (!options?.signal?.aborted) {
      // Resource discovery
      await this._discoverComputeDeeper(nodes, edges);
      await this._discoverContainersDeeper(nodes, edges);
      await this._discoverNetworkDeeper(nodes, edges);
      await this._discoverFirewallDeeper(nodes, edges);
      await this._discoverAppGatewayDeeper(nodes, edges);
      await this._discoverFrontDoorDeeper(nodes, edges);
      await this._discoverSQLDeeper(nodes, edges);
      await this._discoverCosmosDBDeeper(nodes, edges);
      await this._discoverRedisDeeper(nodes, edges);
      await this._discoverStorageDeeper(nodes, edges);
      await this._discoverFunctionsDeeper(nodes, edges);
      await this._discoverWebAppsDeeper(nodes, edges);
      await this._discoverServiceBusDeeper(nodes, edges);
      await this._discoverEventHubsDeeper(nodes, edges);
      await this._discoverEventGridDeeper(nodes, edges);
      await this._discoverKeyVaultDeeper(nodes, edges);
      await this._discoverDNSDeeper(nodes, edges);
      await this._discoverBackupDeeper(nodes, edges);
      await this._discoverAIDeeper(nodes, edges);
      await this._discoverCDNDeeper(nodes, edges);

      // Security & IAM
      await this._discoverSecurityPosture(nodes, edges);
      await this._discoverIAMDeeper(nodes, edges);

      // Enrichment (cost, monitoring, activity log)
      await this._enrichWithCostData(nodes, edges);
      await this._enrichWithMonitoring(nodes, edges);
      await this._enrichWithActivityLog(nodes, edges);
      await this._enrichWithTagData(nodes, edges);

      // New domain discoveries
      await this._discoverPolicyDeeper(nodes, edges);
      await this._discoverComplianceDeeper(nodes, edges);
      await this._discoverDevOpsDeeper(nodes, edges);
      await this._discoverAutomationDeeper(nodes, edges);
      await this._discoverAPIManagementDeeper(nodes, edges);
      await this._discoverLogicAppsDeeper(nodes, edges);
      await this._discoverDataFactoryDeeper(nodes, edges);
      await this._discoverResourceGroupsDeeper(nodes, edges);
      await this._discoverSubscriptionsDeeper(nodes, edges);
      await this._discoverEnterpriseDeeper(nodes, edges);
      await this._discoverSynapseDeeper(nodes, edges);
      await this._discoverPurviewDeeper(nodes, edges);
      await this._discoverHybridDeeper(nodes, edges);
      await this._discoverBastionDeeper(nodes, edges);
      await this._discoverTrafficManagerDeeper(nodes, edges);
      await this._discoverSpringAppsDeeper(nodes, edges);
      await this._discoverStaticWebAppsDeeper(nodes, edges);
      await this._discoverFlexDatabaseDeeper(nodes, edges);
      await this._discoverSignalRDeeper(nodes, edges);
      await this._discoverDigitalTwinsDeeper(nodes, edges);
      await this._discoverNotificationHubsDeeper(nodes, edges);
      await this._discoverMapsDeeper(nodes, edges);
    }

    const limitedNodes = options?.limit ? nodes.slice(0, options.limit) : nodes;

    return {
      provider: "azure",
      nodes: limitedNodes,
      edges,
      errors,
      durationMs: Date.now() - startMs,
    };
  }

  supportsIncrementalSync(): boolean {
    // Azure Activity Log integration is Phase 6
    return false;
  }

  /**
   * Verify Azure credentials by querying for a single resource.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.createClient();
      if (!client) return false;

      try {
        const result = await client.query(
          "Resources | take 1 | project id",
          [this.config.subscriptionId],
        );
        return result.totalRecords >= 0;
      } finally {
        client.dispose?.();
      }
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Resource Graph Query Builder
  // ===========================================================================

  /**
   * Build an Azure Resource Graph (KQL) query to fetch resources.
   */
  private buildResourceGraphQuery(options?: DiscoverOptions): string {
    const parts: string[] = ["Resources"];

    // Filter by resource type if specific types requested
    if (options?.resourceTypes) {
      const azureTypes = options.resourceTypes.flatMap((rt) =>
        AZURE_RESOURCE_MAPPINGS
          .filter((m) => m.graphType === rt)
          .map((m) => `'${m.azureType}'`),
      );
      if (azureTypes.length > 0) {
        parts.push(`| where type in~ (${azureTypes.join(", ")})`);
      }
    } else {
      // Only fetch types we know how to map
      const knownTypes = AZURE_RESOURCE_MAPPINGS.map((m) => `'${m.azureType}'`);
      parts.push(`| where type in~ (${knownTypes.join(", ")})`);
    }

    // Filter by resource group (escape single quotes to prevent KQL injection)
    if (this.config.resourceGroups?.length) {
      const rgs = this.config.resourceGroups.map((rg) => `'${rg.replace(/'/g, "\\'")}'`);
      parts.push(`| where resourceGroup in~ (${rgs.join(", ")})`);
    }

    // Filter by tags
    if (options?.tags) {
      for (const [key, value] of Object.entries(options.tags)) {
        // Escape single quotes to prevent KQL injection
        const safeKey = key.replace(/'/g, "\\'");
        const safeValue = value.replace(/'/g, "\\'");
        parts.push(`| where tags['${safeKey}'] == '${safeValue}'`);
      }
    }

    parts.push("| project id, name, type, location, resourceGroup, subscriptionId, tags, properties, sku");

    return parts.join(" ");
  }

  // ===========================================================================
  // Resource → Node Mapping
  // ===========================================================================

  private resolveMapping(azureType: string): AzureResourceMapping | undefined {
    return AZURE_RESOURCE_MAPPINGS.find(
      (m) => m.azureType === azureType.toLowerCase(),
    );
  }

  private mapResourceToNode(
    resource: AzureResourceRecord,
    mapping: AzureResourceMapping,
    nodeId: string,
  ): GraphNodeInput {
    const tags = resource.tags ?? {};

    return {
      id: nodeId,
      provider: "azure",
      resourceType: mapping.graphType,
      nativeId: resource.id,
      name: tags["Name"] ?? resource.name,
      region: resource.location,
      account: resource.subscriptionId,
      status: this.inferStatus(resource),
      tags,
      metadata: {
        resourceGroup: resource.resourceGroup,
        ...this.extractMetadata(resource, mapping),
        ...(mapping.isAiWorkload ? { isAiWorkload: true } : {}),
      },
      costMonthly: this.estimateCost(resource, mapping),
      owner: tags["Owner"] ?? tags["owner"] ?? tags["Team"] ?? tags["team"] ?? null,
      createdAt: (resource.properties["createdTime"] as string) ?? null,
    };
  }

  // ===========================================================================
  // Status Inference
  // ===========================================================================

  private inferStatus(resource: AzureResourceRecord): GraphNodeInput["status"] {
    const props = resource.properties;
    const provisioningState = (props["provisioningState"] as string)?.toLowerCase();
    const powerState = (props["extended"]
      ? (props["extended"] as Record<string, unknown>)["instanceView"]
        ? ((props["extended"] as Record<string, unknown>)["instanceView"] as Record<string, unknown>)["powerState"]
          ? ((props["extended"] as Record<string, unknown>)["instanceView"] as Record<string, unknown>)["powerState"] as Record<string, unknown>
          : undefined
        : undefined
      : undefined
    )?.["displayStatus"] as string | undefined;

    if (provisioningState === "succeeded" || provisioningState === "running") {
      if (powerState) {
        const ps = powerState.toLowerCase();
        if (ps.includes("running")) return "running";
        if (ps.includes("stopped") || ps.includes("deallocated")) return "stopped";
      }
      return "running";
    }
    if (provisioningState === "creating" || provisioningState === "updating") return "creating";
    if (provisioningState === "deleting") return "deleting";
    if (provisioningState === "failed") return "error";

    return "running";
  }

  // ===========================================================================
  // Metadata Extraction
  // ===========================================================================

  private extractMetadata(
    resource: AzureResourceRecord,
    mapping: AzureResourceMapping,
  ): Record<string, unknown> {
    const meta: Record<string, unknown> = {};
    const props = resource.properties;

    // SKU info
    if (resource.sku) {
      if (resource.sku.name) meta["skuName"] = resource.sku.name;
      if (resource.sku.tier) meta["skuTier"] = resource.sku.tier;
      if (resource.sku.capacity) meta["skuCapacity"] = resource.sku.capacity;
    }

    switch (mapping.azureType) {
      case "microsoft.compute/virtualmachines": {
        const vmSize = (props["hardwareProfile"] as Record<string, unknown>)?.["vmSize"];
        if (vmSize) {
          meta["vmSize"] = vmSize;
          // Detect GPU VMs
          const size = String(vmSize).toLowerCase();
          if (/^standard_n[a-z]|^standard_nc|^standard_nd/.test(size)) {
            meta["isGpuInstance"] = true;
            meta["aiWorkload"] = true;
          }
        }
        const osProfile = props["osProfile"] as Record<string, unknown>;
        if (osProfile?.["computerName"]) meta["computerName"] = osProfile["computerName"];
        break;
      }
      case "microsoft.containerservice/managedclusters": {
        if (props["kubernetesVersion"]) meta["k8sVersion"] = props["kubernetesVersion"];
        const pools = safeArray(props["agentPoolProfiles"]);
        if (pools.length > 0) {
          meta["nodePoolCount"] = pools.length;
          meta["totalNodes"] = pools.reduce(
            (sum: number, p: unknown) => sum + safeNumber(safeRecord(p)["count"]),
            0,
          );
        }
        break;
      }
      case "microsoft.sql/servers/databases": {
        if (props["maxSizeBytes"]) meta["maxSizeGb"] = Number(props["maxSizeBytes"]) / (1024 ** 3);
        if (props["currentServiceObjectiveName"]) meta["serviceObjective"] = props["currentServiceObjectiveName"];
        break;
      }
      case "microsoft.cognitiveservices/accounts": {
        if (props["kind"]) meta["cognitiveKind"] = props["kind"];
        // Azure OpenAI is a Cognitive Services kind
        if (props["kind"] === "OpenAI") {
          meta["isAiWorkload"] = true;
          meta["isAzureOpenAI"] = true;
        }
        break;
      }
      case "microsoft.machinelearningservices/workspaces": {
        if (props["friendlyName"]) meta["friendlyName"] = props["friendlyName"];
        meta["isAiWorkload"] = true;
        break;
      }
      case "microsoft.storage/storageaccounts": {
        if (props["primaryEndpoints"]) meta["endpoints"] = props["primaryEndpoints"];
        if (props["supportsHttpsTrafficOnly"] === false) meta["httpOnly"] = true;
        if (props["allowBlobPublicAccess"] === true) meta["publicAccess"] = true;
        // Also detect public access via network ACLs defaultAction
        const networkAcls = props["networkAcls"] as Record<string, unknown> | undefined;
        if (networkAcls && networkAcls["defaultAction"] === "Allow") meta["publicAccess"] = true;
        break;
      }
      case "microsoft.web/sites": {
        if (props["kind"]) meta["appKind"] = props["kind"];
        if (props["state"]) meta["appState"] = props["state"];
        if (props["defaultHostName"]) meta["defaultHostName"] = props["defaultHostName"];
        break;
      }
    }

    return meta;
  }

  // ===========================================================================
  // Relationship Extraction
  // ===========================================================================

  private extractRelationships(
    sourceNodeId: string,
    resource: AzureResourceRecord,
    azureIdToNodeId: Map<string, string>,
  ): GraphEdgeInput[] {
    const edges: GraphEdgeInput[] = [];
    const azureType = resource.type.toLowerCase();

    // Apply explicit relationship rules
    for (const rule of AZURE_RELATIONSHIP_RULES) {
      if (rule.sourceType !== azureType) continue;

      if (rule.field === "__parent") {
        // Parent relationship: derived from resource ID hierarchy
        const parentId = this.getParentResourceId(resource.id);
        if (parentId) {
          const targetNodeId = azureIdToNodeId.get(parentId.toLowerCase());
          if (targetNodeId) {
            edges.push(this.makeEdge(sourceNodeId, targetNodeId, rule.relationship, "parent-child"));
          }
        }
        continue;
      }

      // Resolve field path from properties
      const values = resolveAzureField(resource, rule.field);
      for (const value of values) {
        const targetNodeId = azureIdToNodeId.get(String(value).toLowerCase());
        if (targetNodeId && targetNodeId !== sourceNodeId) {
          edges.push(this.makeEdge(sourceNodeId, targetNodeId, rule.relationship, rule.field));
        }
      }
    }

    // Implicit VNet/Subnet containment from resource ID
    if (azureType === "microsoft.network/virtualnetworks/subnets") {
      const vnetId = this.getParentResourceId(resource.id);
      if (vnetId) {
        const vnetNodeId = azureIdToNodeId.get(vnetId.toLowerCase());
        if (vnetNodeId) {
          edges.push(this.makeEdge(sourceNodeId, vnetNodeId, "runs-in", "id-hierarchy"));
        }
      }
    }

    return edges;
  }

  private makeEdge(
    sourceNodeId: string,
    targetNodeId: string,
    relationship: GraphRelationshipType,
    field: string,
  ): GraphEdgeInput {
    return {
      id: `${sourceNodeId}--${relationship}--${targetNodeId}`,
      sourceNodeId,
      targetNodeId,
      relationshipType: relationship,
      confidence: 0.9,
      discoveredVia: "api-field",
      metadata: { field },
    };
  }

  /**
   * Derive the parent resource ID from an Azure resource ID.
   * e.g. "/subscriptions/.../virtualNetworks/vnet1/subnets/sub1"
   *    → "/subscriptions/.../virtualNetworks/vnet1"
   */
  private getParentResourceId(resourceId: string): string | null {
    const parts = resourceId.split("/");
    // Azure resource IDs have at least 8 segments for child resources
    if (parts.length >= 10) {
      return parts.slice(0, -2).join("/");
    }
    return null;
  }

  // ===========================================================================
  // Cost Estimation
  // ===========================================================================

  private estimateCost(
    resource: AzureResourceRecord,
    mapping: AzureResourceMapping,
  ): number | null {
    const sku = resource.sku;

    switch (mapping.azureType) {
      case "microsoft.compute/virtualmachines": {
        const vmSize = String(
          (resource.properties["hardwareProfile"] as Record<string, unknown>)?.["vmSize"] ?? "",
        ).toLowerCase();
        return AZURE_VM_COSTS[vmSize] ?? null;
      }
      case "microsoft.sql/servers/databases": {
        const slo = String(resource.properties["currentServiceObjectiveName"] ?? "").toLowerCase();
        return AZURE_SQL_COSTS[slo] ?? null;
      }
      case "microsoft.cache/redis": {
        const skuName = `${sku?.tier ?? "standard"}_${sku?.name ?? "c1"}`.toLowerCase();
        return AZURE_REDIS_COSTS[skuName] ?? null;
      }
      case "microsoft.containerservice/managedclusters": {
        // AKS control plane is free; cost is in node pools
        const aksPools = safeArray(resource.properties["agentPoolProfiles"]);
        if (aksPools.length > 0) {
          let total = 0;
          for (const pool of aksPools) {
            const p = safeRecord(pool);
            const vmSize = safeString(p["vmSize"]).toLowerCase();
            const count = safeNumber(p["count"], 1);
            const perVm = AZURE_VM_COSTS[vmSize];
            if (perVm) total += perVm * count;
          }
          return total > 0 ? total : null;
        }
        return null;
      }
      case "microsoft.cognitiveservices/accounts": {
        // AI services — base estimate for provisioned instances
        if (sku?.name === "S0") return 75;
        if (sku?.tier === "Standard") return 150;
        return null;
      }
    }

    return null;
  }

  // ===========================================================================
  // SDK Loading
  // ===========================================================================

  private async ensureSdkAvailable(): Promise<boolean> {
    if (this.config.clientFactory) {
      this.sdkAvailable = true;
      return true;
    }

    if (this.sdkAvailable !== null) return this.sdkAvailable;

    try {
      await import("@azure/arm-resourcegraph");
      await import("@azure/identity");
      this.sdkAvailable = true;
    } catch {
      this.sdkAvailable = false;
    }

    return this.sdkAvailable;
  }

  private async createClient(): Promise<AzureResourceGraphClient | null> {
    if (this.config.clientFactory) {
      return this.config.clientFactory(this.config.subscriptionId);
    }

    try {
      const identityModule = await import("@azure/identity");
      const graphModule = await import("@azure/arm-resourcegraph");

      // Build credential
      let credential: unknown;
      if (this.config.clientId && this.config.clientSecret && this.config.tenantId) {
        credential = new identityModule.ClientSecretCredential(
          this.config.tenantId,
          this.config.clientId,
          this.config.clientSecret,
        );
      } else {
        credential = new identityModule.DefaultAzureCredential();
      }

      const client = new graphModule.ResourceGraphClient(credential as never);

      return {
        query: async (query: string, subscriptionIds: string[]): Promise<AzureQueryResult> => {
          const response = await client.resources({
            query,
            subscriptions: subscriptionIds,
          });
          return {
            data: (response.data as AzureResourceRecord[]) ?? [],
            totalRecords: response.totalRecords ?? 0,
          };
        },
        dispose: () => {
          // ResourceGraphClient doesn't need explicit cleanup
        },
      };
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Lazy Manager Getters
  // ===========================================================================

  /**
   * Lazily get or create an AzureCredentialsManager from @espada/azure.
   * Returns null if the extension is unavailable.
   */
  private async getAzureCredentialsManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("credentials", async () => {
      const mod = await import("@espada/azure/credentials");
      return mod.createCredentialsManager({
        defaultSubscription: this.config.subscriptionId,
        defaultTenantId: this.config.tenantId,
      });
    });
  }

  /** Helper: create a manager via its factory, using the shared credentials manager. */
  private async _createManager(
    importFn: () => Promise<{ [key: string]: unknown }>,
    factoryName: string,
  ): Promise<unknown> {
    const cm = await this.getAzureCredentialsManager();
    if (!cm) throw new Error("Credentials manager unavailable");
    const mod = await importFn();
    const factory = mod[factoryName];
    if (typeof factory !== "function") throw new Error(`Factory ${factoryName} not found`);
    return factory(cm, this.config.subscriptionId);
  }

  private async getVMManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("vm", () => this._createManager(() => import("@espada/azure/vms"), "createVMManager"), this.config.managers?.vm);
  }

  private async getContainerManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("container", () => this._createManager(() => import("@espada/azure/containers"), "createContainerManager"), this.config.managers?.container);
  }

  private async getNetworkManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("network", () => this._createManager(() => import("@espada/azure/network"), "createNetworkManager"), this.config.managers?.network);
  }

  private async getSQLManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("sql", () => this._createManager(() => import("@espada/azure/sql"), "createSQLManager"), this.config.managers?.sql);
  }

  private async getCosmosDBManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("cosmosdb", () => this._createManager(() => import("@espada/azure/cosmosdb"), "createCosmosDBManager"), this.config.managers?.cosmosdb);
  }

  private async getStorageManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("storage", () => this._createManager(() => import("@espada/azure/storage"), "createStorageManager"), this.config.managers?.storage);
  }

  private async getFunctionsManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("functions", () => this._createManager(() => import("@espada/azure/functions"), "createFunctionsManager"), this.config.managers?.functions);
  }

  /** Web App manager — uses @espada/azure/webapp subpath. */
  private async getWebAppManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("webapp", () => this._createManager(() => import("@espada/azure/webapp"), "createWebAppManager"), this.config.managers?.webapp);
  }

  private async getKeyVaultManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("keyvault", () => this._createManager(() => import("@espada/azure/keyvault"), "createKeyVaultManager"), this.config.managers?.keyvault);
  }

  private async getServiceBusManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("servicebus", () => this._createManager(() => import("@espada/azure/servicebus"), "createServiceBusManager"), this.config.managers?.servicebus);
  }

  /** Event Hubs manager — uses @espada/azure/eventhubs subpath. */
  private async getEventHubsManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("eventhubs", () => this._createManager(() => import("@espada/azure/eventhubs"), "createEventHubsManager"), this.config.managers?.eventhubs);
  }

  private async getEventGridManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("eventgrid", () => this._createManager(() => import("@espada/azure/eventgrid"), "createEventGridManager"), this.config.managers?.eventgrid);
  }

  private async getDNSManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("dns", () => this._createManager(() => import("@espada/azure/dns"), "createDNSManager"), this.config.managers?.dns);
  }

  private async getRedisManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("redis", () => this._createManager(() => import("@espada/azure/redis"), "createRedisManager"), this.config.managers?.redis);
  }

  private async getCDNManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("cdn", () => this._createManager(() => import("@espada/azure/cdn"), "createCDNManager"), this.config.managers?.cdn);
  }

  private async getAIManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("ai", () => this._createManager(() => import("@espada/azure/ai"), "createAIManager"), this.config.managers?.ai);
  }

  private async getBackupManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("backup", () => this._createManager(() => import("@espada/azure/backup"), "createBackupManager"), this.config.managers?.backup);
  }

  /** Firewall manager — uses @espada/azure/firewall subpath. */
  private async getFirewallManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("firewall", () => this._createManager(() => import("@espada/azure/firewall"), "createFirewallManager"), this.config.managers?.firewall);
  }

  /** Application Gateway manager — uses @espada/azure/appgateway subpath. */
  private async getAppGatewayManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("appgateway", () => this._createManager(() => import("@espada/azure/appgateway"), "createAppGatewayManager"), this.config.managers?.appgateway);
  }

  /** Front Door manager — uses @espada/azure/frontdoor subpath. */
  private async getFrontDoorManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("frontdoor", () => this._createManager(() => import("@espada/azure/frontdoor"), "createFrontDoorManager"), this.config.managers?.frontdoor);
  }

  private async getCostManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("cost", () => this._createManager(() => import("@espada/azure/cost"), "createCostManager"), this.config.managers?.cost);
  }

  private async getMonitorManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("monitor", () => this._createManager(() => import("@espada/azure/monitor"), "createMonitorManager"), this.config.managers?.monitor);
  }

  private async getSecurityManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("security", () => this._createManager(() => import("@espada/azure/security"), "createSecurityManager"), this.config.managers?.security);
  }

  private async getIAMManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("iam", () => this._createManager(() => import("@espada/azure/iam"), "createIAMManager"), this.config.managers?.iam);
  }

  private async getTaggingManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("tagging", () => this._createManager(() => import("@espada/azure/tagging"), "createTaggingManager"), this.config.managers?.tagging);
  }

  private async getActivityLogManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("activitylog", () => this._createManager(() => import("@espada/azure/activitylog"), "createActivityLogManager"), this.config.managers?.activitylog);
  }

  // --- New manager getters ---

  private async getPolicyManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("policy", () => this._createManager(() => import("@espada/azure/policy"), "createPolicyManager"), this.config.managers?.policy);
  }

  private async getComplianceManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("compliance", () => this._createManager(() => import("@espada/azure/compliance"), "createComplianceManager"), this.config.managers?.compliance);
  }

  private async getDevOpsManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("devops", () => this._createManager(() => import("@espada/azure/devops"), "createDevOpsManager"), this.config.managers?.devops);
  }

  private async getAutomationManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("automation", () => this._createManager(() => import("@espada/azure/automation"), "createAutomationManager"), this.config.managers?.automation);
  }

  private async getAPIManagementManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("apimanagement", () => this._createManager(() => import("@espada/azure/apimanagement"), "createAPIManagementManager"), this.config.managers?.apimanagement);
  }

  private async getLogicManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("logic", () => this._createManager(() => import("@espada/azure/logic"), "createLogicManager"), this.config.managers?.logic);
  }

  private async getDataFactoryManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("datafactory", () => this._createManager(() => import("@espada/azure/datafactory"), "createDataFactoryManager"), this.config.managers?.datafactory);
  }

  private async getResourcesManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("resources", () => this._createManager(() => import("@espada/azure/resources"), "createResourcesManager"), this.config.managers?.resources);
  }

  private async getSubscriptionsManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("subscriptions", async () => {
      const cm = await this.getAzureCredentialsManager();
      if (!cm) throw new Error("Credentials manager unavailable");
      const mod = await import("@espada/azure/subscriptions");
      const factory = mod["createSubscriptionManager"];
      if (typeof factory !== "function") throw new Error("Factory createSubscriptionManager not found");
      // subscriptions manager takes only credentialsManager (no subscriptionId)
      return factory(cm as never);
    }, this.config.managers?.subscriptions);
  }

  private async getEnterpriseManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("enterprise", () => this._createManager(() => import("@espada/azure/enterprise"), "createEnterpriseManager"), this.config.managers?.enterprise);
  }

  private async getSynapseManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("synapse", () => this._createManager(() => import("@espada/azure/synapse"), "createSynapseManager"), this.config.managers?.synapse);
  }

  private async getPurviewManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("purview", () => this._createManager(() => import("@espada/azure/purview"), "createPurviewManager"), this.config.managers?.purview);
  }

  private async getHybridManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("hybrid", () => this._createManager(() => import("@espada/azure/hybrid"), "createHybridManager"), this.config.managers?.hybrid);
  }

  private async getBastionManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("bastion", () => this._createManager(() => import("@espada/azure/bastion"), "createBastionManager"), this.config.managers?.bastion);
  }

  private async getTrafficManagerManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("trafficmanager", () => this._createManager(() => import("@espada/azure/trafficmanager"), "createTrafficManagerManager"), this.config.managers?.trafficmanager);
  }

  private async getSpringAppsManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("springapps", () => this._createManager(() => import("@espada/azure/springapps"), "createSpringAppsManager"), this.config.managers?.springapps);
  }

  private async getStaticWebAppsManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("staticwebapps", () => this._createManager(() => import("@espada/azure/staticwebapps"), "createStaticWebAppsManager"), this.config.managers?.staticwebapps);
  }

  private async getSignalRManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("signalr", () => this._createManager(() => import("@espada/azure/signalr"), "createSignalRManager"), this.config.managers?.signalr);
  }

  private async getDigitalTwinsManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("digitaltwins", () => this._createManager(() => import("@espada/azure/digitaltwins"), "createDigitalTwinsManager"), this.config.managers?.digitaltwins);
  }

  private async getNotificationHubsManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("notificationhubs", () => this._createManager(() => import("@espada/azure/notificationhubs"), "createNotificationHubsManager"), this.config.managers?.notificationhubs);
  }

  private async getMapsManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("maps", () => this._createManager(() => import("@espada/azure/maps"), "createMapsManager"), this.config.managers?.maps);
  }

  private async getDatabaseManager(): Promise<unknown | null> {
    return this._managers.getOrCreate("database", () => this._createManager(() => import("@espada/azure/database"), "createDatabaseManager"), this.config.managers?.database);
  }

  // ===========================================================================
  // Context Builder
  // ===========================================================================

  private _getContext(): AzureAdapterContext {
    return {
      subscriptionId: this.config.subscriptionId,
      config: this.config,
      estimateCostStatic: (_resourceType, _metadata) => null,
      getVMManager: () => this.getVMManager(),
      getContainerManager: () => this.getContainerManager(),
      getNetworkManager: () => this.getNetworkManager(),
      getSQLManager: () => this.getSQLManager(),
      getCosmosDBManager: () => this.getCosmosDBManager(),
      getStorageManager: () => this.getStorageManager(),
      getFunctionsManager: () => this.getFunctionsManager(),
      getWebAppManager: () => this.getWebAppManager(),
      getKeyVaultManager: () => this.getKeyVaultManager(),
      getServiceBusManager: () => this.getServiceBusManager(),
      getEventHubsManager: () => this.getEventHubsManager(),
      getEventGridManager: () => this.getEventGridManager(),
      getDNSManager: () => this.getDNSManager(),
      getRedisManager: () => this.getRedisManager(),
      getCDNManager: () => this.getCDNManager(),
      getAIManager: () => this.getAIManager(),
      getBackupManager: () => this.getBackupManager(),
      getFirewallManager: () => this.getFirewallManager(),
      getAppGatewayManager: () => this.getAppGatewayManager(),
      getFrontDoorManager: () => this.getFrontDoorManager(),
      getCostManager: () => this.getCostManager(),
      getMonitorManager: () => this.getMonitorManager(),
      getSecurityManager: () => this.getSecurityManager(),
      getIAMManager: () => this.getIAMManager(),
      getTaggingManager: () => this.getTaggingManager(),
      getActivityLogManager: () => this.getActivityLogManager(),
      // New managers
      getPolicyManager: () => this.getPolicyManager(),
      getComplianceManager: () => this.getComplianceManager(),
      getDevOpsManager: () => this.getDevOpsManager(),
      getAutomationManager: () => this.getAutomationManager(),
      getAPIManagementManager: () => this.getAPIManagementManager(),
      getLogicManager: () => this.getLogicManager(),
      getDataFactoryManager: () => this.getDataFactoryManager(),
      getResourcesManager: () => this.getResourcesManager(),
      getSubscriptionsManager: () => this.getSubscriptionsManager(),
      getEnterpriseManager: () => this.getEnterpriseManager(),
      getSynapseManager: () => this.getSynapseManager(),
      getPurviewManager: () => this.getPurviewManager(),
      getHybridManager: () => this.getHybridManager(),
      getBastionManager: () => this.getBastionManager(),
      getTrafficManagerManager: () => this.getTrafficManagerManager(),
      getSpringAppsManager: () => this.getSpringAppsManager(),
      getStaticWebAppsManager: () => this.getStaticWebAppsManager(),
      getSignalRManager: () => this.getSignalRManager(),
      getDigitalTwinsManager: () => this.getDigitalTwinsManager(),
      getNotificationHubsManager: () => this.getNotificationHubsManager(),
      getMapsManager: () => this.getMapsManager(),
      getDatabaseManager: () => this.getDatabaseManager(),
    };
  }

  // ===========================================================================
  // Domain Module Delegation (Phase 2 wrappers)
  // ===========================================================================

  private async _discoverComputeDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await computeModule.discoverComputeDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverContainersDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await containersModule.discoverContainersDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverNetworkDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await networkModule.discoverNetworkDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverFirewallDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await networkModule.discoverFirewallDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverAppGatewayDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await networkModule.discoverAppGatewayDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverFrontDoorDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await networkModule.discoverFrontDoorDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverSQLDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await databaseModule.discoverSQLDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverCosmosDBDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await databaseModule.discoverCosmosDBDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverRedisDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await databaseModule.discoverRedisDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverStorageDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await storageModule.discoverStorageDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverFunctionsDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await serverlessModule.discoverFunctionsDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverWebAppsDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await serverlessModule.discoverWebAppsDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverServiceBusDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await messagingModule.discoverServiceBusDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverEventHubsDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await messagingModule.discoverEventHubsDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverEventGridDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await messagingModule.discoverEventGridDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverKeyVaultDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await securityModule.discoverKeyVaultDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverDNSDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await dnsModule.discoverDNSDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverBackupDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await backupModule.discoverBackupDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverAIDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await aiModule.discoverAIDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverCDNDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await cdnModule.discoverCDNDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverSecurityPosture(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await securityModule.discoverSecurityPosture(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverIAMDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await securityModule.discoverIAMDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _enrichWithCostData(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await enrichmentModule.enrichWithCostData(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _enrichWithMonitoring(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await enrichmentModule.enrichWithMonitoring(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _enrichWithActivityLog(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await enrichmentModule.enrichWithActivityLog(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _enrichWithTagData(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await enrichmentModule.enrichWithTagData(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  // --- New domain delegation wrappers ---

  private async _discoverPolicyDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await governanceModule.discoverPolicyDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverComplianceDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await governanceModule.discoverComplianceDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverDevOpsDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await devopsModule.discoverDevOpsDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverAutomationDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await devopsModule.discoverAutomationDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverAPIManagementDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await integrationModule.discoverAPIManagementDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverLogicAppsDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await integrationModule.discoverLogicAppsDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverDataFactoryDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await integrationModule.discoverDataFactoryDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverResourceGroupsDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await platformModule.discoverResourceGroupsDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverSubscriptionsDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await platformModule.discoverSubscriptionsDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverEnterpriseDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await platformModule.discoverEnterpriseDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverSynapseDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await analyticsModule.discoverSynapseDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverPurviewDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await analyticsModule.discoverPurviewDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverHybridDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await hybridModule.discoverHybridDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverBastionDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await hybridModule.discoverBastionDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverTrafficManagerDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await hybridModule.discoverTrafficManagerDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverSpringAppsDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await serverlessModule.discoverSpringAppsDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverStaticWebAppsDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await serverlessModule.discoverStaticWebAppsDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverFlexDatabaseDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await databaseModule.discoverFlexDatabaseDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverSignalRDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await iotModule.discoverSignalRDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverDigitalTwinsDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await iotModule.discoverDigitalTwinsDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverNotificationHubsDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await iotModule.discoverNotificationHubsDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }

  private async _discoverMapsDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void> {
    try { await iotModule.discoverMapsDeeper(this._getContext(), nodes, edges); } catch { /* skip */ }
  }
}

// =============================================================================
// Cost Tables (approximate monthly USD, pay-as-you-go)
// =============================================================================

const AZURE_VM_COSTS: Record<string, number> = {
  // B-series (burstable)
  standard_b1s: 7.59, standard_b2s: 30.37, standard_b2ms: 60.74,
  // D-series (general purpose)
  standard_d2s_v3: 70.08, standard_d4s_v3: 140.16, standard_d8s_v3: 280.32,
  standard_d2s_v5: 70.08, standard_d4s_v5: 140.16, standard_d8s_v5: 280.32,
  // E-series (memory optimized)
  standard_e2s_v3: 91.98, standard_e4s_v3: 183.96, standard_e8s_v3: 367.92,
  // F-series (compute optimized)
  standard_f2s_v2: 62.05, standard_f4s_v2: 124.10, standard_f8s_v2: 248.20,
  // N-series (GPU)
  standard_nc6s_v3: 2190.24, standard_nc12s_v3: 4380.48, standard_nc24s_v3: 8760.96,
  standard_nd96asr_v4: 21900.00, standard_nd96amsr_a100_v4: 26280.00,
  // A-series (AI optimized)
  standard_nc24ads_a100_v4: 2700.00,
};

const AZURE_SQL_COSTS: Record<string, number> = {
  s0: 14.72, s1: 29.43, s2: 73.58, s3: 147.17,
  p1: 453.98, p2: 907.97, p4: 1815.93, p6: 3631.87,
  gp_s_gen5_1: 57.02, gp_s_gen5_2: 114.04,
  gp_gen5_2: 332.55, gp_gen5_4: 665.10,
  bc_gen5_2: 872.63, bc_gen5_4: 1745.26,
};

const AZURE_REDIS_COSTS: Record<string, number> = {
  basic_c0: 16.06, basic_c1: 33.58, basic_c2: 62.05,
  standard_c0: 32.12, standard_c1: 67.16, standard_c2: 124.10,
  premium_p1: 248.20, premium_p2: 496.40, premium_p3: 963.44,
};

// =============================================================================
// Field Resolution Helper
// =============================================================================

/**
 * Resolve a dot-path with bracket array notation from an Azure resource.
 * Similar to AWS's resolveFieldPath but starts from the resource object.
 */
function resolveAzureField(resource: AzureResourceRecord, path: string): string[] {
  const obj = path.startsWith("properties.")
    ? resource.properties
    : toRecord(resource);

  const adjustedPath = path.startsWith("properties.")
    ? path.slice("properties.".length)
    : path;

  return resolveFieldPathAzure(obj, adjustedPath);
}

function resolveFieldPathAzure(obj: unknown, path: string): string[] {
  if (obj == null || typeof obj !== "object") return [];

  const parts = path.split(".");
  let current: unknown[] = [obj];

  for (const part of parts) {
    const next: unknown[] = [];
    const arrayMatch = part.match(/^(.+?)\[(.*)?\]$/);

    if (arrayMatch) {
      const [, key, indexOrKey] = arrayMatch;
      for (const item of current) {
        if (item == null || typeof item !== "object") continue;
        const value = (item as Record<string, unknown>)[key!];
        if (Array.isArray(value)) {
          if (indexOrKey === "" || indexOrKey === undefined) {
            next.push(...value);
          } else {
            for (const v of value) {
              if (v && typeof v === "object" && (v as Record<string, unknown>)[indexOrKey] !== undefined) {
                next.push((v as Record<string, unknown>)[indexOrKey]);
              }
            }
          }
        }
      }
    } else {
      for (const item of current) {
        if (item == null || typeof item !== "object") continue;
        const value = (item as Record<string, unknown>)[part];
        if (value !== undefined && value !== null) {
          next.push(value);
        }
      }
    }

    current = next;
    if (current.length === 0) break;
  }

  return current
    .flat(Infinity)
    .filter((v) => v != null)
    .map((v) => String(v));
}
