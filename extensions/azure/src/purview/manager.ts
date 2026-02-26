/**
 * Microsoft Purview manager.
 *
 * Provides operations for managing Microsoft Purview (formerly Azure Purview)
 * accounts — listing, retrieval, deletion, and private endpoint connections.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  AzurePurviewAccount,
  AzurePurviewPrivateEndpoint,
} from "./types.js";

export class AzurePurviewManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    retryOptions?: AzureRetryOptions,
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions ?? {};
  }

  private extractResourceGroup(resourceId?: string): string {
    if (!resourceId) return "";
    const match = resourceId.match(/\/resourceGroups\/([^/]+)/i);
    return match?.[1] ?? "";
  }

  private async getClient() {
    const { PurviewManagementClient } = await import("@azure/arm-purview");
    const { credential } = await this.credentialsManager.getCredential();
    return new PurviewManagementClient(credential, this.subscriptionId);
  }

  // ---------------------------------------------------------------------------
  // Account operations
  // ---------------------------------------------------------------------------

  /** List Purview accounts, optionally filtered by resource group. */
  async listAccounts(resourceGroup?: string): Promise<AzurePurviewAccount[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: AzurePurviewAccount[] = [];
      const iter = resourceGroup
        ? client.accounts.listByResourceGroup(resourceGroup)
        : client.accounts.listBySubscription();
      for await (const acct of iter) {
        results.push(this.mapAccount(acct));
      }
      return results;
    }, this.retryOptions);
  }

  /** Get a single Purview account. Returns null if not found. */
  async getAccount(resourceGroup: string, accountName: string): Promise<AzurePurviewAccount | null> {
    return withAzureRetry(async () => {
      try {
        const client = await this.getClient();
        const acct = await client.accounts.get(resourceGroup, accountName);
        return this.mapAccount(acct);
      } catch (error: unknown) {
        if ((error as { statusCode?: number }).statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete a Purview account. */
  async deleteAccount(resourceGroup: string, accountName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.accounts.beginDeleteAndWait(resourceGroup, accountName);
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Private endpoint connections
  // ---------------------------------------------------------------------------

  /** List private endpoint connections for a Purview account. */
  async listPrivateEndpoints(resourceGroup: string, accountName: string): Promise<AzurePurviewPrivateEndpoint[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: AzurePurviewPrivateEndpoint[] = [];
      for await (const pe of client.privateEndpointConnections.listByAccount(resourceGroup, accountName)) {
        const typed = pe as unknown as {
          id?: string; name?: string;
          properties?: {
            privateEndpoint?: { id?: string };
            privateLinkServiceConnectionState?: { status?: string };
            provisioningState?: string;
          };
        };
        results.push({
          id: typed.id ?? "",
          name: typed.name ?? "",
          privateEndpointId: typed.properties?.privateEndpoint?.id,
          connectionState: typed.properties?.privateLinkServiceConnectionState?.status,
          provisioningState: typed.properties?.provisioningState,
        });
      }
      return results;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Mapping helpers
  // ---------------------------------------------------------------------------

  private mapAccount(acct: unknown): AzurePurviewAccount {
    const typed = acct as {
      id?: string; name?: string; location?: string;
      provisioningState?: string; friendlyName?: string;
      sku?: { name?: string; capacity?: number };
      publicNetworkAccess?: string;
      managedResourceGroupName?: string;
      createdAt?: string; createdBy?: string;
      endpoints?: { catalog?: string; scan?: string; guardian?: string };
      managedResources?: { storageAccount?: string; resourceGroup?: string; eventHubNamespace?: string };
      properties?: {
        provisioningState?: string; friendlyName?: string;
        publicNetworkAccess?: string;
        managedResourceGroupName?: string;
        createdAt?: string; createdBy?: string;
        endpoints?: { catalog?: string; scan?: string; guardian?: string };
        managedResources?: { storageAccount?: string; resourceGroup?: string; eventHubNamespace?: string };
      };
      tags?: Record<string, string>;
    };
    return {
      id: typed.id ?? "",
      name: typed.name ?? "",
      resourceGroup: this.extractResourceGroup(typed.id),
      location: typed.location ?? "",
      provisioningState: typed.provisioningState ?? typed.properties?.provisioningState,
      friendlyName: typed.friendlyName ?? typed.properties?.friendlyName,
      skuName: typed.sku?.name,
      skuCapacity: typed.sku?.capacity,
      publicNetworkAccess: typed.publicNetworkAccess ?? typed.properties?.publicNetworkAccess,
      managedResourceGroupName: typed.managedResourceGroupName ?? typed.properties?.managedResourceGroupName,
      createdAt: typed.createdAt ?? typed.properties?.createdAt,
      createdBy: typed.createdBy ?? typed.properties?.createdBy,
      endpoints: typed.endpoints ?? typed.properties?.endpoints,
      managedResources: typed.managedResources ?? typed.properties?.managedResources,
      tags: typed.tags ?? {},
    };
  }
}

/** Factory function for creating a Purview manager. */
export function createPurviewManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzurePurviewManager {
  return new AzurePurviewManager(credentialsManager, subscriptionId, retryOptions);
}
