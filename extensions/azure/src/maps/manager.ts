/**
 * Azure Maps manager.
 *
 * Provides operations for managing Azure Maps accounts and
 * creator resources — listing, retrieval, and deletion.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  AzureMapsAccount,
  AzureMapsCreator,
} from "./types.js";

export class AzureMapsManager {
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
    const { AzureMapsManagementClient } = await import("@azure/arm-maps");
    const { credential } = await this.credentialsManager.getCredential();
    return new AzureMapsManagementClient(credential, this.subscriptionId);
  }

  // ---------------------------------------------------------------------------
  // Account operations
  // ---------------------------------------------------------------------------

  /** List Maps accounts, optionally filtered by resource group. */
  async listAccounts(resourceGroup?: string): Promise<AzureMapsAccount[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: AzureMapsAccount[] = [];
      const iter = resourceGroup
        ? client.accounts.listByResourceGroup(resourceGroup)
        : client.accounts.listBySubscription();
      for await (const acct of iter) {
        results.push(this.mapAccount(acct));
      }
      return results;
    }, this.retryOptions);
  }

  /** Get a single Maps account. Returns null if not found. */
  async getAccount(resourceGroup: string, accountName: string): Promise<AzureMapsAccount | null> {
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

  /** Delete a Maps account. */
  async deleteAccount(resourceGroup: string, accountName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.accounts.delete(resourceGroup, accountName);
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Creator operations
  // ---------------------------------------------------------------------------

  /** List creator resources in a Maps account. */
  async listCreators(resourceGroup: string, accountName: string): Promise<AzureMapsCreator[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: AzureMapsCreator[] = [];
      for await (const c of client.creators.listByAccount(resourceGroup, accountName)) {
        results.push(this.mapCreator(c));
      }
      return results;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Mapping helpers
  // ---------------------------------------------------------------------------

  private mapAccount(acct: unknown): AzureMapsAccount {
    const typed = acct as {
      id?: string; name?: string; location?: string;
      sku?: { name?: string };
      kind?: string;
      properties?: {
        provisioningState?: string;
        uniqueId?: string;
        disableLocalAuth?: boolean;
        linkedResources?: Array<{ uniqueName?: string; id?: string }>;
        cors?: { allowedOrigins?: string[] };
      };
      tags?: Record<string, string>;
    };
    return {
      id: typed.id ?? "",
      name: typed.name ?? "",
      resourceGroup: this.extractResourceGroup(typed.id),
      location: typed.location ?? "",
      skuName: typed.sku?.name,
      kind: typed.kind,
      provisioningState: typed.properties?.provisioningState,
      uniqueId: typed.properties?.uniqueId,
      disableLocalAuth: typed.properties?.disableLocalAuth,
      linkedResources: typed.properties?.linkedResources,
      cors: typed.properties?.cors,
      tags: typed.tags ?? {},
    };
  }

  private mapCreator(c: unknown): AzureMapsCreator {
    const typed = c as {
      id?: string; name?: string; location?: string;
      properties?: {
        provisioningState?: string;
        storageUnits?: number;
        consumedStorageUnitPercentage?: number;
      };
      tags?: Record<string, string>;
    };
    return {
      id: typed.id ?? "",
      name: typed.name ?? "",
      resourceGroup: this.extractResourceGroup(typed.id),
      location: typed.location ?? "",
      provisioningState: typed.properties?.provisioningState,
      storageUnits: typed.properties?.storageUnits,
      consumedStorageUnitPercentage: typed.properties?.consumedStorageUnitPercentage,
      tags: typed.tags ?? {},
    };
  }
}

/** Factory function for creating a Maps manager. */
export function createMapsManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureMapsManager {
  return new AzureMapsManager(credentialsManager, subscriptionId, retryOptions);
}
