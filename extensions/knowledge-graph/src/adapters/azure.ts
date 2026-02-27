/**
 * Infrastructure Knowledge Graph — Azure Adapter
 *
 * Maps Azure resources into the universal graph model using the Azure
 * Resource Graph API for bulk discovery. Supports AI workloads
 * (Azure OpenAI Service, Cognitive Services, Machine Learning).
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
import type {
  GraphDiscoveryAdapter,
  DiscoverOptions,
  DiscoveryResult,
  DiscoveryError,
} from "./types.js";

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
        const pools = props["agentPoolProfiles"] as unknown[];
        if (Array.isArray(pools)) {
          meta["nodePoolCount"] = pools.length;
          meta["totalNodes"] = pools.reduce(
            (sum: number, p: unknown) => sum + ((p as Record<string, unknown>)["count"] as number ?? 0),
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
        const pools = resource.properties["agentPoolProfiles"] as unknown[];
        if (Array.isArray(pools)) {
          let total = 0;
          for (const pool of pools) {
            const p = pool as Record<string, unknown>;
            const vmSize = String(p["vmSize"] ?? "").toLowerCase();
            const count = (p["count"] as number) ?? 1;
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
    : (resource as unknown as Record<string, unknown>);

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
