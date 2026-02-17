/**
 * Azure Cosmos DB Manager
 *
 * Manages Azure Cosmos DB accounts via @azure/arm-cosmosdb.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { CosmosDBAccount, CosmosDBDatabase, CosmosDBContainer, CosmosDBThroughput } from "./types.js";

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
}

// =============================================================================
// Factory
// =============================================================================

export function createCosmosDBManager(
  credentialsManager: AzureCredentialsManager, subscriptionId: string, retryOptions?: AzureRetryOptions,
): AzureCosmosDBManager {
  return new AzureCosmosDBManager(credentialsManager, subscriptionId, retryOptions);
}
