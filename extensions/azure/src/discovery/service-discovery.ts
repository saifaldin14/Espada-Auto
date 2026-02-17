/**
 * Azure Service Discovery — Resource enumeration via Resource Graph
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureResource, AzureResourceType, AzureResourceFilter } from "../types.js";
import { withAzureRetry } from "../retry.js";

// =============================================================================
// Types
// =============================================================================

export type AzureServiceMetadata = {
  type: AzureResourceType;
  displayName: string;
  category: string;
  regions: string[];
};

export type ResourceEnumerationOptions = {
  subscriptionId?: string;
  filter?: AzureResourceFilter;
  maxResults?: number;
};

// =============================================================================
// Service Discovery
// =============================================================================

export class AzureServiceDiscovery {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;

  constructor(credentialsManager: AzureCredentialsManager, subscriptionId: string) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
  }

  /**
   * List all resources matching a filter.
   */
  async listResources(options?: ResourceEnumerationOptions): Promise<AzureResource[]> {
    const { credential } = await this.credentialsManager.getCredential();
    const subId = options?.subscriptionId ?? this.subscriptionId;

    // Dynamic import to avoid hard dependency
    const { ResourceManagementClient } = await import("@azure/arm-resources");
    const client = new ResourceManagementClient(credential, subId);

    return withAzureRetry(async () => {
      const resources: AzureResource[] = [];
      const filter = options?.filter;

      const listOptions: Record<string, string | undefined> = {};
      if (filter?.type) {
        listOptions.filter = `resourceType eq '${filter.type}'`;
      }

      for await (const resource of client.resources.list(listOptions)) {
        if (options?.maxResults && resources.length >= options.maxResults) break;

        // Apply additional client-side filters
        if (filter?.resourceGroup && resource.id) {
          const rgMatch = resource.id.match(/resourceGroups\/([^/]+)/i);
          if (rgMatch && rgMatch[1].toLowerCase() !== filter.resourceGroup.toLowerCase()) continue;
        }
        if (filter?.location && resource.location !== filter.location) continue;

        resources.push({
          id: resource.id ?? "",
          name: resource.name ?? "",
          type: resource.type ?? "",
          location: resource.location ?? "",
          resourceGroup: this.extractResourceGroup(resource.id ?? ""),
          subscriptionId: subId,
          tags: resource.tags as Record<string, string> | undefined,
        });
      }

      return resources;
    });
  }

  /**
   * List resource groups in the subscription.
   */
  async listResourceGroups(subscriptionId?: string): Promise<string[]> {
    const { credential } = await this.credentialsManager.getCredential();
    const subId = subscriptionId ?? this.subscriptionId;

    const { ResourceManagementClient } = await import("@azure/arm-resources");
    const client = new ResourceManagementClient(credential, subId);

    const groups: string[] = [];
    for await (const rg of client.resourceGroups.list()) {
      if (rg.name) groups.push(rg.name);
    }
    return groups;
  }

  /**
   * Get available Azure service types.
   */
  getServiceCatalog(): AzureServiceMetadata[] {
    return AZURE_SERVICE_CATALOG;
  }

  private extractResourceGroup(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i);
    return match ? match[1] : "";
  }
}

// =============================================================================
// Service Catalog (static metadata)
// =============================================================================

const AZURE_SERVICE_CATALOG: AzureServiceMetadata[] = [
  { type: "Microsoft.Compute/virtualMachines", displayName: "Virtual Machines", category: "compute", regions: ["eastus", "westus2", "westeurope", "southeastasia"] },
  { type: "Microsoft.Storage/storageAccounts", displayName: "Storage Accounts", category: "storage", regions: ["eastus", "westus2", "westeurope", "southeastasia"] },
  { type: "Microsoft.Web/sites", displayName: "App Service / Functions", category: "compute", regions: ["eastus", "westus2", "westeurope", "southeastasia"] },
  { type: "Microsoft.Sql/servers", displayName: "SQL Database", category: "database", regions: ["eastus", "westus2", "westeurope", "southeastasia"] },
  { type: "Microsoft.DocumentDB/databaseAccounts", displayName: "Cosmos DB", category: "database", regions: ["eastus", "westus2", "westeurope", "southeastasia"] },
  { type: "Microsoft.Network/virtualNetworks", displayName: "Virtual Networks", category: "network", regions: ["eastus", "westus2", "westeurope", "southeastasia"] },
  { type: "Microsoft.KeyVault/vaults", displayName: "Key Vault", category: "security", regions: ["eastus", "westus2", "westeurope", "southeastasia"] },
  { type: "Microsoft.ContainerService/managedClusters", displayName: "AKS", category: "containers", regions: ["eastus", "westus2", "westeurope", "southeastasia"] },
  { type: "Microsoft.Cache/Redis", displayName: "Azure Cache for Redis", category: "database", regions: ["eastus", "westus2", "westeurope", "southeastasia"] },
  { type: "Microsoft.ServiceBus/namespaces", displayName: "Service Bus", category: "messaging", regions: ["eastus", "westus2", "westeurope", "southeastasia"] },
];

// =============================================================================
// Factory
// =============================================================================

export function createServiceDiscovery(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
): AzureServiceDiscovery {
  return new AzureServiceDiscovery(credentialsManager, subscriptionId);
}
