/**
 * Azure SQL Manager
 *
 * Manages Azure SQL Databases via @azure/arm-sql.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { SqlServer, SqlDatabase, SqlElasticPool, SqlFirewallRule, SqlFailoverGroup } from "./types.js";

// =============================================================================
// AzureSQLManager
// =============================================================================

export class AzureSQLManager {
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
    const { SqlManagementClient } = await import("@azure/arm-sql");
    return new SqlManagementClient(credential, this.subscriptionId);
  }

  /**
   * List SQL servers in the subscription or a specific resource group.
   */
  async listServers(resourceGroup?: string): Promise<SqlServer[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const servers: SqlServer[] = [];
      const iter = resourceGroup ? client.servers.listByResourceGroup(resourceGroup) : client.servers.list();
      for await (const s of iter) {
        servers.push({
          id: s.id ?? "", name: s.name ?? "",
          resourceGroup: (s.id ?? "").match(/resourceGroups\/([^/]+)/i)?.[1] ?? "",
          location: s.location ?? "",
          fullyQualifiedDomainName: s.fullyQualifiedDomainName,
          administratorLogin: s.administratorLogin,
          version: s.version,
          state: s.state,
          publicNetworkAccess: s.publicNetworkAccess,
          tags: s.tags as Record<string, string>,
        });
      }
      return servers;
    }, this.retryOptions);
  }

  /**
   * Get a specific SQL server.
   */
  async getServer(resourceGroup: string, serverName: string): Promise<SqlServer | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const s = await client.servers.get(resourceGroup, serverName);
        return {
          id: s.id ?? "", name: s.name ?? "", resourceGroup, location: s.location ?? "",
          fullyQualifiedDomainName: s.fullyQualifiedDomainName,
          administratorLogin: s.administratorLogin,
          version: s.version, state: s.state,
          publicNetworkAccess: s.publicNetworkAccess,
          tags: s.tags as Record<string, string>,
        };
      } catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return null; throw e; }
    }, this.retryOptions);
  }

  /**
   * List databases on a server.
   */
  async listDatabases(resourceGroup: string, serverName: string): Promise<SqlDatabase[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const databases: SqlDatabase[] = [];
      for await (const d of client.databases.listByServer(resourceGroup, serverName)) {
        databases.push({
          id: d.id ?? "", name: d.name ?? "", serverName, resourceGroup,
          location: d.location ?? "", status: d.status,
          edition: d.sku?.tier, serviceLevelObjective: d.sku?.name,
          maxSizeBytes: d.maxSizeBytes ? Number(d.maxSizeBytes) : undefined,
          collation: d.collation, creationDate: d.creationDate?.toISOString(),
          elasticPoolId: d.elasticPoolId, zoneRedundant: d.zoneRedundant,
          tags: d.tags as Record<string, string>,
        });
      }
      return databases;
    }, this.retryOptions);
  }

  /**
   * Get a specific database.
   */
  async getDatabase(resourceGroup: string, serverName: string, dbName: string): Promise<SqlDatabase | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const d = await client.databases.get(resourceGroup, serverName, dbName);
        return {
          id: d.id ?? "", name: d.name ?? "", serverName, resourceGroup,
          location: d.location ?? "", status: d.status,
          edition: d.sku?.tier, serviceLevelObjective: d.sku?.name,
          maxSizeBytes: d.maxSizeBytes ? Number(d.maxSizeBytes) : undefined,
          collation: d.collation, creationDate: d.creationDate?.toISOString(),
          elasticPoolId: d.elasticPoolId, zoneRedundant: d.zoneRedundant,
          tags: d.tags as Record<string, string>,
        };
      } catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return null; throw e; }
    }, this.retryOptions);
  }

  /**
   * List elastic pools on a server.
   */
  async listElasticPools(resourceGroup: string, serverName: string): Promise<SqlElasticPool[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const pools: SqlElasticPool[] = [];
      for await (const p of client.elasticPools.listByServer(resourceGroup, serverName)) {
        pools.push({
          id: p.id ?? "", name: p.name ?? "", serverName, resourceGroup,
          location: p.location ?? "", state: p.state,
          maxSizeBytes: p.maxSizeBytes ? Number(p.maxSizeBytes) : undefined,
          perDatabaseSettings: p.perDatabaseSettings ? {
            minCapacity: p.perDatabaseSettings.minCapacity,
            maxCapacity: p.perDatabaseSettings.maxCapacity,
          } : undefined,
          sku: p.sku ? { name: p.sku.name ?? "", tier: p.sku.tier ?? "", capacity: p.sku.capacity ?? 0 } : undefined,
          tags: p.tags as Record<string, string>,
        });
      }
      return pools;
    }, this.retryOptions);
  }

  /**
   * List firewall rules for a server.
   */
  async listFirewallRules(resourceGroup: string, serverName: string): Promise<SqlFirewallRule[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const rules: SqlFirewallRule[] = [];
      for await (const r of client.firewallRules.listByServer(resourceGroup, serverName)) {
        rules.push({
          id: r.id ?? "", name: r.name ?? "",
          startIpAddress: r.startIpAddress ?? "",
          endIpAddress: r.endIpAddress ?? "",
        });
      }
      return rules;
    }, this.retryOptions);
  }

  /**
   * Create a firewall rule.
   */
  async createFirewallRule(
    resourceGroup: string, serverName: string, ruleName: string,
    startIp: string, endIp: string,
  ): Promise<SqlFirewallRule> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const r = await client.firewallRules.createOrUpdate(resourceGroup, serverName, ruleName, {
        startIpAddress: startIp, endIpAddress: endIp,
      });
      return { id: r.id ?? "", name: r.name ?? "", startIpAddress: r.startIpAddress ?? "", endIpAddress: r.endIpAddress ?? "" };
    }, this.retryOptions);
  }

  /**
   * Delete a firewall rule.
   */
  async deleteFirewallRule(resourceGroup: string, serverName: string, ruleName: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(() => client.firewallRules.delete(resourceGroup, serverName, ruleName), this.retryOptions);
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createSQLManager(
  credentialsManager: AzureCredentialsManager, subscriptionId: string, retryOptions?: AzureRetryOptions,
): AzureSQLManager {
  return new AzureSQLManager(credentialsManager, subscriptionId, retryOptions);
}
