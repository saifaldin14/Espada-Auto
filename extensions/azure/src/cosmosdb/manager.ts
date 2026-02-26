/**
 * Azure Cosmos DB Manager
 *
 * Manages Azure Cosmos DB accounts via @azure/arm-cosmosdb.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { CosmosDBAccount, CosmosDBDatabase, CosmosDBContainer, CosmosDBThroughput, CosmosDBAccountCreateOptions, CosmosDBAccountKeys } from "./types.js";

// =============================================================================
// AzureCosmosDBManager
// =============================================================================

export class AzureCosmosDBManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions: AzureRetryOptions;

  constructor(credentialsManager: AzureCredentialsManager, subscriptionId: string, retryOptions?: AzureRetryOptions) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions ?? {};
  }

  private async getClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { CosmosDBManagementClient } = await import("@azure/arm-cosmosdb");
    return new CosmosDBManagementClient(credential, this.subscriptionId);
  }

  /**
   * List all Cosmos DB accounts.
   */
  async listAccounts(resourceGroup?: string): Promise<CosmosDBAccount[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const accounts: CosmosDBAccount[] = [];
      const iter = resourceGroup
        ? client.databaseAccounts.listByResourceGroup(resourceGroup)
        : client.databaseAccounts.list();
      for await (const a of iter) {
        accounts.push({
          id: a.id ?? "", name: a.name ?? "",
          resourceGroup: (a.id ?? "").match(/resourceGroups\/([^/]+)/i)?.[1] ?? "",
          location: a.location ?? "", kind: a.kind,
          documentEndpoint: a.documentEndpoint, provisioningState: a.provisioningState,
          consistencyPolicy: a.consistencyPolicy ? {
            defaultConsistencyLevel: a.consistencyPolicy.defaultConsistencyLevel as CosmosDBAccount["consistencyPolicy"] extends undefined ? never : NonNullable<CosmosDBAccount["consistencyPolicy"]>["defaultConsistencyLevel"],
            maxStalenessPrefix: a.consistencyPolicy.maxStalenessPrefix,
            maxIntervalInSeconds: a.consistencyPolicy.maxIntervalInSeconds,
          } : undefined,
          enableAutomaticFailover: a.enableAutomaticFailover,
          enableMultipleWriteLocations: a.enableMultipleWriteLocations,
          readLocations: a.readLocations?.map((l) => l.locationName ?? ""),
          writeLocations: a.writeLocations?.map((l) => l.locationName ?? ""),
          tags: a.tags as Record<string, string>,
        });
      }
      return accounts;
    }, this.retryOptions);
  }

  /**
   * Get a specific Cosmos DB account.
   */
  async getAccount(resourceGroup: string, accountName: string): Promise<CosmosDBAccount | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const a = await client.databaseAccounts.get(resourceGroup, accountName);
        return {
          id: a.id ?? "", name: a.name ?? "", resourceGroup, location: a.location ?? "",
          kind: a.kind, documentEndpoint: a.documentEndpoint, provisioningState: a.provisioningState,
          enableAutomaticFailover: a.enableAutomaticFailover,
          enableMultipleWriteLocations: a.enableMultipleWriteLocations,
          tags: a.tags as Record<string, string>,
        };
      } catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return null; throw e; }
    }, this.retryOptions);
  }

  /**
   * Create or update a Cosmos DB account.
   */
  async createAccount(options: CosmosDBAccountCreateOptions): Promise<CosmosDBAccount> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const a = await client.databaseAccounts.beginCreateOrUpdateAndWait(
        options.resourceGroup, options.name,
        {
          location: options.location,
          kind: options.kind ?? "GlobalDocumentDB",
          databaseAccountOfferType: "Standard",
          locations: [{ locationName: options.location, failoverPriority: 0 }],
          consistencyPolicy: {
            defaultConsistencyLevel: options.consistencyLevel ?? "Session",
          },
          enableAutomaticFailover: options.enableAutomaticFailover ?? false,
          enableMultipleWriteLocations: options.enableMultipleWriteLocations ?? false,
          capabilities: options.capabilities?.map(c => ({ name: c })),
          tags: options.tags,
        },
      );
      return {
        id: a.id ?? "", name: a.name ?? "", resourceGroup: options.resourceGroup,
        location: a.location ?? "", kind: a.kind, documentEndpoint: a.documentEndpoint,
        provisioningState: a.provisioningState,
        enableAutomaticFailover: a.enableAutomaticFailover,
        enableMultipleWriteLocations: a.enableMultipleWriteLocations,
        tags: a.tags as Record<string, string>,
      };
    }, this.retryOptions);
  }

  /**
   * Delete a Cosmos DB account.
   */
  async deleteAccount(resourceGroup: string, accountName: string): Promise<void> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      await client.databaseAccounts.beginDeleteAndWait(resourceGroup, accountName);
    }, this.retryOptions);
  }

  /**
   * List keys for a Cosmos DB account.
   */
  async listKeys(resourceGroup: string, accountName: string): Promise<CosmosDBAccountKeys> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const keys = await client.databaseAccounts.listKeys(resourceGroup, accountName);
      return {
        primaryMasterKey: keys.primaryMasterKey,
        secondaryMasterKey: keys.secondaryMasterKey,
        primaryReadonlyMasterKey: keys.primaryReadonlyMasterKey,
        secondaryReadonlyMasterKey: keys.secondaryReadonlyMasterKey,
      };
    }, this.retryOptions);
  }

  /**
   * List SQL databases in a Cosmos DB account.
   */
  async listDatabases(resourceGroup: string, accountName: string): Promise<CosmosDBDatabase[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const databases: CosmosDBDatabase[] = [];
      for await (const d of client.sqlResources.listSqlDatabases(resourceGroup, accountName)) {
        databases.push({
          id: d.id ?? "", name: d.name ?? "",
          accountName, resourceGroup,
        });
      }
      return databases;
    }, this.retryOptions);
  }

  /**
   * List containers in a SQL database.
   */
  async listContainers(resourceGroup: string, accountName: string, databaseName: string): Promise<CosmosDBContainer[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const containers: CosmosDBContainer[] = [];
      for await (const c of client.sqlResources.listSqlContainers(resourceGroup, accountName, databaseName)) {
        const resource = c.resource;
        containers.push({
          id: c.id ?? "", name: resource?.id ?? c.name ?? "",
          databaseName,
          partitionKeyPath: resource?.partitionKey?.paths?.[0],
          defaultTtl: resource?.defaultTtl,
          indexingPolicy: resource?.indexingPolicy as Record<string, unknown> | undefined,
          uniqueKeyPolicy: resource?.uniqueKeyPolicy as Record<string, unknown> | undefined,
        });
      }
      return containers;
    }, this.retryOptions);
  }

  /**
   * Get throughput settings for a SQL database.
   */
  async getThroughput(resourceGroup: string, accountName: string, databaseName: string): Promise<CosmosDBThroughput | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const result = await client.sqlResources.getSqlDatabaseThroughput(resourceGroup, accountName, databaseName);
        const resource = result.resource;
        const isAutoscale = !!resource?.autoscaleSettings;
        return {
          throughput: resource?.throughput,
          autoscaleMaxThroughput: resource?.autoscaleSettings?.maxThroughput,
          minimumThroughput: resource?.minimumThroughput ? Number(resource.minimumThroughput) : undefined,
          isAutoscale,
        };
      } catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return null; throw e; }
    }, this.retryOptions);
  }

  /**
   * Create a SQL database.
   */
  async createDatabase(
    resourceGroup: string, accountName: string, databaseName: string, throughput?: number,
  ): Promise<CosmosDBDatabase> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const params: Record<string, unknown> = { resource: { id: databaseName } };
      if (throughput) params.options = { throughput };
      const db = await client.sqlResources.beginCreateUpdateSqlDatabaseAndWait(
        resourceGroup, accountName, databaseName, params as any,
      );
      return { id: db.id ?? "", name: db.name ?? "", accountName, resourceGroup };
    }, this.retryOptions);
  }

  /**
   * Delete a SQL database.
   */
  async deleteDatabase(resourceGroup: string, accountName: string, databaseName: string): Promise<void> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      await client.sqlResources.beginDeleteSqlDatabaseAndWait(resourceGroup, accountName, databaseName);
    }, this.retryOptions);
  }

  /**
   * Create a SQL container.
   */
  async createContainer(
    resourceGroup: string, accountName: string, databaseName: string,
    containerName: string, partitionKeyPath: string,
    options?: { throughput?: number; defaultTtl?: number; partitionKeyKind?: string },
  ): Promise<CosmosDBContainer> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const params: Record<string, unknown> = {
        resource: {
          id: containerName,
          partitionKey: { paths: [partitionKeyPath], kind: options?.partitionKeyKind ?? "Hash" },
          defaultTtl: options?.defaultTtl,
        },
      };
      if (options?.throughput) params.options = { throughput: options.throughput };
      const c = await client.sqlResources.beginCreateUpdateSqlContainerAndWait(
        resourceGroup, accountName, databaseName, containerName, params as any,
      );
      return {
        id: c.id ?? "", name: c.name ?? "", databaseName,
        partitionKeyPath, defaultTtl: options?.defaultTtl,
      };
    }, this.retryOptions);
  }

  /**
   * Delete a SQL container.
   */
  async deleteContainer(
    resourceGroup: string, accountName: string, databaseName: string, containerName: string,
  ): Promise<void> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      await client.sqlResources.beginDeleteSqlContainerAndWait(
        resourceGroup, accountName, databaseName, containerName,
      );
    }, this.retryOptions);
  }

  /**
   * Update throughput on a SQL database.
   */
  async updateDatabaseThroughput(
    resourceGroup: string, accountName: string, databaseName: string, throughput: number,
  ): Promise<void> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      await client.sqlResources.beginUpdateSqlDatabaseThroughputAndWait(
        resourceGroup, accountName, databaseName, { resource: { throughput } },
      );
    }, this.retryOptions);
  }

  /**
   * Update throughput on a SQL container.
   */
  async updateContainerThroughput(
    resourceGroup: string, accountName: string, databaseName: string,
    containerName: string, throughput: number,
  ): Promise<void> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      await client.sqlResources.beginUpdateSqlContainerThroughputAndWait(
        resourceGroup, accountName, databaseName, containerName,
        { resource: { throughput } },
      );
    }, this.retryOptions);
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createCosmosDBManager(
  credentialsManager: AzureCredentialsManager, subscriptionId: string, retryOptions?: AzureRetryOptions,
): AzureCosmosDBManager {
  return new AzureCosmosDBManager(credentialsManager, subscriptionId, retryOptions);
}
