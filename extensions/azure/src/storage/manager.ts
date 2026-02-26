/**
 * Azure Storage Manager
 */
import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions, AzurePaginationOptions, AzurePagedResult } from "../types.js";
import { withAzureRetry } from "../retry.js";
import { collectPaged, collectAll } from "../pagination.js";
import type { StorageAccount, BlobContainer } from "./types.js";

export class AzureStorageManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions: AzureRetryOptions;

  constructor(credentialsManager: AzureCredentialsManager, subscriptionId: string, retryOptions?: AzureRetryOptions) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions ?? {};
  }

  private async getStorageClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { StorageManagementClient } = await import("@azure/arm-storage");
    return new StorageManagementClient(credential, this.subscriptionId);
  }

  /**
   * List storage accounts with optional pagination.
   */
  async listStorageAccounts(resourceGroup: string | undefined, pagination: AzurePaginationOptions & { limit: number }): Promise<AzurePagedResult<StorageAccount>>;
  async listStorageAccounts(resourceGroup?: string, pagination?: AzurePaginationOptions): Promise<StorageAccount[]>;
  async listStorageAccounts(resourceGroup?: string, pagination?: AzurePaginationOptions): Promise<StorageAccount[] | AzurePagedResult<StorageAccount>> {
    const client = await this.getStorageClient();
    return withAzureRetry(async () => {
      const iter = resourceGroup
        ? client.storageAccounts.listByResourceGroup(resourceGroup)
        : client.storageAccounts.list();

      const mapFn = (a: any): StorageAccount => ({
        id: a.id ?? "", name: a.name ?? "",
        resourceGroup: (a.id ?? "").match(/resourceGroups\/([^/]+)/i)?.[1] ?? "",
        location: a.location ?? "", kind: (a.kind ?? "StorageV2") as StorageAccount["kind"],
        sku: (a.sku?.name ?? "Standard_LRS") as StorageAccount["sku"],
        provisioningState: a.provisioningState ?? "",
        primaryEndpoints: a.primaryEndpoints as StorageAccount["primaryEndpoints"],
        httpsOnly: a.enableHttpsTrafficOnly ?? true,
        tags: a.tags as Record<string, string>,
      });

      if (pagination?.limit !== undefined) {
        return collectPaged(iter, mapFn, undefined, pagination);
      }

      return collectAll(iter, mapFn);
    }, this.retryOptions);
  }

  async getStorageAccount(resourceGroup: string, name: string): Promise<StorageAccount | null> {
    const client = await this.getStorageClient();
    return withAzureRetry(async () => {
      try {
        const a = await client.storageAccounts.getProperties(resourceGroup, name);
        return {
          id: a.id ?? "", name: a.name ?? "", resourceGroup, location: a.location ?? "",
          kind: (a.kind ?? "StorageV2") as StorageAccount["kind"],
          sku: (a.sku?.name ?? "Standard_LRS") as StorageAccount["sku"],
          provisioningState: a.provisioningState ?? "",
          primaryEndpoints: a.primaryEndpoints as StorageAccount["primaryEndpoints"],
          httpsOnly: a.enableHttpsTrafficOnly ?? true,
          tags: a.tags as Record<string, string>,
        };
      } catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return null; throw e; }
    }, this.retryOptions);
  }

  async listContainers(resourceGroup: string, accountName: string): Promise<BlobContainer[]> {
    const client = await this.getStorageClient();
    return withAzureRetry(async () => {
      const containers: BlobContainer[] = [];
      for await (const c of client.blobContainers.list(resourceGroup, accountName)) {
        containers.push({
          name: c.name ?? "", publicAccess: c.publicAccess ?? "None",
          lastModified: c.lastModifiedTime?.toISOString(),
          leaseState: c.leaseState, hasImmutabilityPolicy: c.hasImmutabilityPolicy ?? false,
          hasLegalHold: c.hasLegalHold ?? false,
        });
      }
      return containers;
    }, this.retryOptions);
  }

  async deleteStorageAccount(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getStorageClient();
    await withAzureRetry(() => client.storageAccounts.delete(resourceGroup, name), this.retryOptions);
  }
}

export function createStorageManager(
  credentialsManager: AzureCredentialsManager, subscriptionId: string, retryOptions?: AzureRetryOptions,
): AzureStorageManager {
  return new AzureStorageManager(credentialsManager, subscriptionId, retryOptions);
}
