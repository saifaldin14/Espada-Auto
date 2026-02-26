/**
 * Azure Synapse Analytics Manager
 *
 * Manages Synapse workspaces, SQL pools, and Spark pools
 * via @azure/arm-synapse.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  SynapseWorkspace,
  SynapseSqlPool,
  SynapseSparkPool,
} from "./types.js";

export class AzureSynapseManager {
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

  private async getClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { SynapseManagementClient } = await import("@azure/arm-synapse");
    return new SynapseManagementClient(credential, this.subscriptionId);
  }

  private extractResourceGroup(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i);
    return match ? match[1] : "";
  }

  // ---------------------------------------------------------------------------
  // Workspaces
  // ---------------------------------------------------------------------------

  /** List Synapse workspaces. */
  async listWorkspaces(resourceGroup?: string): Promise<SynapseWorkspace[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const workspaces: SynapseWorkspace[] = [];
      const iter = resourceGroup
        ? client.workspaces.listByResourceGroup(resourceGroup)
        : client.workspaces.list();

      for await (const w of iter) {
        workspaces.push(this.mapWorkspace(w));
      }
      return workspaces;
    }, this.retryOptions);
  }

  /** Get a specific Synapse workspace. */
  async getWorkspace(resourceGroup: string, name: string): Promise<SynapseWorkspace | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const w = await client.workspaces.get(resourceGroup, name);
        return this.mapWorkspace(w, resourceGroup);
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete a Synapse workspace. */
  async deleteWorkspace(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.workspaces.beginDeleteAndWait(resourceGroup, name),
      this.retryOptions,
    );
  }

  // ---------------------------------------------------------------------------
  // SQL Pools (Dedicated)
  // ---------------------------------------------------------------------------

  /** List SQL pools in a Synapse workspace. */
  async listSqlPools(resourceGroup: string, workspaceName: string): Promise<SynapseSqlPool[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const pools: SynapseSqlPool[] = [];
      for await (const p of client.sqlPools.listByWorkspace(resourceGroup, workspaceName)) {
        pools.push(this.mapSqlPool(p, resourceGroup));
      }
      return pools;
    }, this.retryOptions);
  }

  /** Get a specific SQL pool. */
  async getSqlPool(resourceGroup: string, workspaceName: string, poolName: string): Promise<SynapseSqlPool | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const p = await client.sqlPools.get(resourceGroup, workspaceName, poolName);
        return this.mapSqlPool(p, resourceGroup);
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Spark Pools (Big Data)
  // ---------------------------------------------------------------------------

  /** List Spark pools in a Synapse workspace. */
  async listSparkPools(resourceGroup: string, workspaceName: string): Promise<SynapseSparkPool[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const pools: SynapseSparkPool[] = [];
      for await (const p of client.bigDataPools.listByWorkspace(resourceGroup, workspaceName)) {
        pools.push(this.mapSparkPool(p, resourceGroup));
      }
      return pools;
    }, this.retryOptions);
  }

  /** Get a specific Spark pool. */
  async getSparkPool(resourceGroup: string, workspaceName: string, poolName: string): Promise<SynapseSparkPool | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const p = await client.bigDataPools.get(resourceGroup, workspaceName, poolName);
        return this.mapSparkPool(p, resourceGroup);
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private mapWorkspace(w: unknown, rg?: string): SynapseWorkspace {
    const ws = w as {
      id?: string; name?: string; location?: string;
      provisioningState?: string;
      managedResourceGroupName?: string;
      sqlAdministratorLogin?: string;
      connectivityEndpoints?: Record<string, string>;
      defaultDataLakeStorage?: { accountUrl?: string; filesystem?: string };
      managedVirtualNetwork?: string;
      publicNetworkAccess?: string;
      tags?: Record<string, string>;
    };

    return {
      id: ws.id ?? "",
      name: ws.name ?? "",
      resourceGroup: rg ?? this.extractResourceGroup(ws.id ?? ""),
      location: ws.location ?? "",
      provisioningState: ws.provisioningState,
      managedResourceGroupName: ws.managedResourceGroupName,
      sqlAdministratorLogin: ws.sqlAdministratorLogin,
      connectivityEndpoints: ws.connectivityEndpoints,
      defaultDataLakeStorage: ws.defaultDataLakeStorage
        ? {
            accountUrl: ws.defaultDataLakeStorage.accountUrl,
            filesystem: ws.defaultDataLakeStorage.filesystem,
          }
        : undefined,
      managedVirtualNetwork: ws.managedVirtualNetwork,
      publicNetworkAccess: ws.publicNetworkAccess,
      tags: ws.tags as Record<string, string>,
    };
  }

  private mapSqlPool(p: unknown, rg?: string): SynapseSqlPool {
    const pool = p as {
      id?: string; name?: string; location?: string;
      status?: string;
      sku?: { name?: string; capacity?: number };
      maxSizeBytes?: number;
      collation?: string;
      provisioningState?: string;
      restorePointInTime?: Date;
      createMode?: string;
      tags?: Record<string, string>;
    };

    return {
      id: pool.id ?? "",
      name: pool.name ?? "",
      resourceGroup: rg ?? this.extractResourceGroup(pool.id ?? ""),
      location: pool.location ?? "",
      status: pool.status,
      skuName: pool.sku?.name,
      skuCapacity: pool.sku?.capacity,
      maxSizeBytes: pool.maxSizeBytes,
      collation: pool.collation,
      provisioningState: pool.provisioningState,
      restorePointInTime: pool.restorePointInTime?.toISOString(),
      createMode: pool.createMode,
      tags: pool.tags as Record<string, string>,
    };
  }

  private mapSparkPool(p: unknown, rg?: string): SynapseSparkPool {
    const pool = p as {
      id?: string; name?: string; location?: string;
      provisioningState?: string;
      nodeSize?: string;
      nodeSizeFamily?: string;
      nodeCount?: number;
      autoScale?: { enabled?: boolean; minNodeCount?: number; maxNodeCount?: number };
      autoPause?: { enabled?: boolean; delayInMinutes?: number };
      sparkVersion?: string;
      isComputeIsolationEnabled?: boolean;
      tags?: Record<string, string>;
    };

    return {
      id: pool.id ?? "",
      name: pool.name ?? "",
      resourceGroup: rg ?? this.extractResourceGroup(pool.id ?? ""),
      location: pool.location ?? "",
      provisioningState: pool.provisioningState,
      nodeSize: pool.nodeSize,
      nodeSizeFamily: pool.nodeSizeFamily,
      nodeCount: pool.nodeCount,
      autoScaleEnabled: pool.autoScale?.enabled,
      autoScaleMinNodeCount: pool.autoScale?.minNodeCount,
      autoScaleMaxNodeCount: pool.autoScale?.maxNodeCount,
      autoPauseEnabled: pool.autoPause?.enabled,
      autoPauseDelayInMinutes: pool.autoPause?.delayInMinutes,
      sparkVersion: pool.sparkVersion,
      isComputeIsolationEnabled: pool.isComputeIsolationEnabled,
      tags: pool.tags as Record<string, string>,
    };
  }
}

export function createSynapseManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureSynapseManager {
  return new AzureSynapseManager(credentialsManager, subscriptionId, retryOptions);
}
