/**
 * Azure Storage Manager
 */
import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions, AzurePaginationOptions, AzurePagedResult } from "../types.js";
import { withAzureRetry } from "../retry.js";
import { collectPaged, collectAll } from "../pagination.js";
import type { StorageAccount, BlobContainer, StorageAccountCreateOptions, BlobContainerCreateOptions } from "./types.js";

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

  /**
   * Create a storage account.
   */
  async createStorageAccount(options: StorageAccountCreateOptions): Promise<StorageAccount> {
    const client = await this.getStorageClient();
    return withAzureRetry(async () => {
      const result = await client.storageAccounts.beginCreateAndWait(
        options.resourceGroup,
        options.name,
        {
          location: options.location,
          kind: options.kind ?? "StorageV2",
          sku: { name: options.sku ?? "Standard_LRS" },
          enableHttpsTrafficOnly: options.httpsOnly ?? true,
          minimumTlsVersion: options.minimumTlsVersion ?? "TLS1_2",
          tags: options.tags,
        },
      );
      return {
        id: result.id ?? "", name: result.name ?? "", resourceGroup: options.resourceGroup,
        location: result.location ?? "", kind: (result.kind ?? "StorageV2") as StorageAccount["kind"],
        sku: (result.sku?.name ?? "Standard_LRS") as StorageAccount["sku"],
        provisioningState: result.provisioningState ?? "",
        primaryEndpoints: result.primaryEndpoints as StorageAccount["primaryEndpoints"],
        httpsOnly: result.enableHttpsTrafficOnly ?? true,
        tags: result.tags as Record<string, string>,
      };
    }, this.retryOptions);
  }

  /**
   * Create a blob container within a storage account.
   */
  async createContainer(
    resourceGroup: string, accountName: string, options: BlobContainerCreateOptions,
  ): Promise<BlobContainer> {
    const client = await this.getStorageClient();
    return withAzureRetry(async () => {
      const c = await client.blobContainers.create(resourceGroup, accountName, options.name, {
        publicAccess: options.publicAccess ?? "None",
        metadata: options.metadata,
      });
      return {
        name: c.name ?? options.name, publicAccess: c.publicAccess ?? "None",
        lastModified: c.lastModifiedTime?.toISOString(),
        leaseState: c.leaseState, hasImmutabilityPolicy: c.hasImmutabilityPolicy ?? false,
        hasLegalHold: c.hasLegalHold ?? false,
      };
    }, this.retryOptions);
  }

  /**
   * Delete a blob container.
   */
  async deleteContainer(resourceGroup: string, accountName: string, containerName: string): Promise<void> {
    const client = await this.getStorageClient();
    await withAzureRetry(() => client.blobContainers.delete(resourceGroup, accountName, containerName), this.retryOptions);
  }

  /**
   * Set the access tier for a storage account.
   */
  async setAccessTier(resourceGroup: string, accountName: string, accessTier: "Hot" | "Cool"): Promise<void> {
    const client = await this.getStorageClient();
    await withAzureRetry(async () => {
      await client.storageAccounts.update(resourceGroup, accountName, {
        accessTier,
      });
    }, this.retryOptions);
  }
}

export function createStorageManager(
  credentialsManager: AzureCredentialsManager, subscriptionId: string, retryOptions?: AzureRetryOptions,
): AzureStorageManager {
  return new AzureStorageManager(credentialsManager, subscriptionId, retryOptions);
}
