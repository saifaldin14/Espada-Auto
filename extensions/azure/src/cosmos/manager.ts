/**
 * Azure Cosmos DB Manager
 *
 * Manages Cosmos DB accounts, databases, and containers via @azure/arm-cosmosdb.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  CosmosDBAccount,
  CosmosDBDatabase,
  CosmosDBContainer,
  CosmosDBAccountCreateOptions,
  CosmosDBAccountKeys,
} from "./types.js";

export class AzureCosmosDBManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions?: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    retryOptions?: AzureRetryOptions
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions;
  }

  private async getClient() {
    const { CosmosDBManagementClient } = await import("@azure/arm-cosmosdb");
    const { credential } = await this.credentialsManager.getCredential();
    return new CosmosDBManagementClient(credential, this.subscriptionId);
  }

  /**
   * List all Cosmos DB accounts, optionally filtered by resource group.
   */
  async listAccounts(resourceGroup?: string): Promise<CosmosDBAccount[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: CosmosDBAccount[] = [];
      const iter = resourceGroup
        ? client.databaseAccounts.listByResourceGroup(resourceGroup)
        : client.databaseAccounts.list();
      for await (const a of iter) {
        results.push(this.mapAccount(a));
      }
      return results;
    }, this.retryOptions);
  }

  /**
   * Get a specific Cosmos DB account.
   */
  async getAccount(resourceGroup: string, accountName: string): Promise<CosmosDBAccount | null> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      try {
        const a = await client.databaseAccounts.get(resourceGroup, accountName);
        return this.mapAccount(a);
      } catch (e) {
        if ((e as { statusCode?: number }).statusCode === 404) return null;
        throw e;
      }
    }, this.retryOptions);
  }

  /**
   * Create or update a Cosmos DB account.
   */
  async createAccount(options: CosmosDBAccountCreateOptions): Promise<CosmosDBAccount> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
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
      return this.mapAccount(a);
    }, this.retryOptions);
  }

  /**
   * Delete a Cosmos DB account.
   */
  async deleteAccount(resourceGroup: string, accountName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.databaseAccounts.beginDeleteAndWait(resourceGroup, accountName);
    }, this.retryOptions);
  }

  /**
   * List keys for a Cosmos DB account.
   */
  async listKeys(resourceGroup: string, accountName: string): Promise<CosmosDBAccountKeys> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
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
   * List SQL databases under a Cosmos DB account.
   */
  async listDatabases(resourceGroup: string, accountName: string): Promise<CosmosDBDatabase[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: CosmosDBDatabase[] = [];
      for await (const db of client.sqlResources.listSqlDatabases(resourceGroup, accountName)) {
        results.push({
          id: db.id ?? "",
          name: db.name ?? "",
          accountName,
          throughput: undefined, // throughput requires a separate call
        });
      }
      return results;
    }, this.retryOptions);
  }

  /**
   * Create a SQL database.
   */
  async createDatabase(
    resourceGroup: string,
    accountName: string,
    databaseName: string,
    throughput?: number
  ): Promise<CosmosDBDatabase> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const params: Record<string, unknown> = {
        resource: { id: databaseName },
      };
      if (throughput) {
        params.options = { throughput };
      }
      const db = await client.sqlResources.beginCreateUpdateSqlDatabaseAndWait(
        resourceGroup, accountName, databaseName, params as any,
      );
      return {
        id: db.id ?? "",
        name: db.name ?? "",
        accountName,
        throughput,
      };
    }, this.retryOptions);
  }

  /**
   * Delete a SQL database.
   */
  async deleteDatabase(
    resourceGroup: string,
    accountName: string,
    databaseName: string
  ): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.sqlResources.beginDeleteSqlDatabaseAndWait(
        resourceGroup, accountName, databaseName,
      );
    }, this.retryOptions);
  }

  /**
   * List SQL containers in a database.
   */
  async listContainers(
    resourceGroup: string,
    accountName: string,
    databaseName: string
  ): Promise<CosmosDBContainer[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: CosmosDBContainer[] = [];
      for await (const c of client.sqlResources.listSqlContainers(
        resourceGroup, accountName, databaseName
      )) {
        results.push({
          id: c.id ?? "",
          name: c.name ?? "",
          databaseName,
          partitionKey: c.resource?.partitionKey
            ? { paths: c.resource.partitionKey.paths ?? [], kind: c.resource.partitionKey.kind ?? "Hash" }
            : undefined,
          defaultTtl: c.resource?.defaultTtl,
        });
      }
      return results;
    }, this.retryOptions);
  }

  /**
   * Create a SQL container.
   */
  async createContainer(
    resourceGroup: string,
    accountName: string,
    databaseName: string,
    containerName: string,
    partitionKeyPath: string,
    options?: { throughput?: number; defaultTtl?: number; partitionKeyKind?: string }
  ): Promise<CosmosDBContainer> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const params: Record<string, unknown> = {
        resource: {
          id: containerName,
          partitionKey: {
            paths: [partitionKeyPath],
            kind: options?.partitionKeyKind ?? "Hash",
          },
          defaultTtl: options?.defaultTtl,
        },
      };
      if (options?.throughput) {
        params.options = { throughput: options.throughput };
      }
      const c = await client.sqlResources.beginCreateUpdateSqlContainerAndWait(
        resourceGroup, accountName, databaseName, containerName, params as any,
      );
      return {
        id: c.id ?? "",
        name: c.name ?? "",
        databaseName,
        partitionKey: c.resource?.partitionKey
          ? { paths: c.resource.partitionKey.paths ?? [], kind: c.resource.partitionKey.kind ?? "Hash" }
          : undefined,
        defaultTtl: c.resource?.defaultTtl,
        throughput: options?.throughput,
      };
    }, this.retryOptions);
  }

  /**
   * Delete a SQL container.
   */
  async deleteContainer(
    resourceGroup: string,
    accountName: string,
    databaseName: string,
    containerName: string
  ): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.sqlResources.beginDeleteSqlContainerAndWait(
        resourceGroup, accountName, databaseName, containerName,
      );
    }, this.retryOptions);
  }

  /**
   * Update throughput on a SQL database.
   */
  async updateDatabaseThroughput(
    resourceGroup: string,
    accountName: string,
    databaseName: string,
    throughput: number
  ): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.sqlResources.beginUpdateSqlDatabaseThroughputAndWait(
        resourceGroup, accountName, databaseName,
        { resource: { throughput } },
      );
    }, this.retryOptions);
  }

  /**
   * Update throughput on a SQL container.
   */
  async updateContainerThroughput(
    resourceGroup: string,
    accountName: string,
    databaseName: string,
    containerName: string,
    throughput: number
  ): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.sqlResources.beginUpdateSqlContainerThroughputAndWait(
        resourceGroup, accountName, databaseName, containerName,
        { resource: { throughput } },
      );
    }, this.retryOptions);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapAccount(a: any): CosmosDBAccount {
    return {
      id: a.id ?? "",
      name: a.name ?? "",
      resourceGroup: a.id?.match(/resourceGroups\/([^/]+)/i)?.[1] ?? "",
      location: a.location ?? "",
      kind: a.kind,
      documentEndpoint: a.documentEndpoint,
      provisioningState: a.provisioningState,
      consistencyPolicy: a.consistencyPolicy
        ? { defaultConsistencyLevel: a.consistencyPolicy.defaultConsistencyLevel ?? "" }
        : undefined,
      locations: a.locations?.map((l: any) => ({
        locationName: l.locationName ?? "",
        failoverPriority: l.failoverPriority ?? 0,
        isZoneRedundant: l.isZoneRedundant,
      })),
      capabilities: a.capabilities?.map((c: any) => c.name ?? ""),
      enableAutomaticFailover: a.enableAutomaticFailover,
      enableMultipleWriteLocations: a.enableMultipleWriteLocations,
      tags: a.tags,
    };
  }
}

export function createCosmosDBManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureCosmosDBManager {
  return new AzureCosmosDBManager(credentialsManager, subscriptionId, retryOptions);
}
