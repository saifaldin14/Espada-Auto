/**
 * Azure Database manager for MySQL and PostgreSQL Flexible Servers.
 *
 * Provides operations for managing Azure Database for MySQL Flexible Server
 * and Azure Database for PostgreSQL Flexible Server — listing, retrieval,
 * deletion, and sub-resource enumeration (databases, firewall rules).
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  AzureMySqlFlexibleServer,
  AzurePostgreSqlFlexibleServer,
  AzureFlexibleDatabase,
  AzureFlexibleFirewallRule,
} from "./types.js";

export class AzureDatabaseManager {
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

  // ---------------------------------------------------------------------------
  // MySQL Flexible Server client
  // ---------------------------------------------------------------------------

  private async getMySqlClient() {
    const { MySQLManagementFlexibleServerClient } = await import("@azure/arm-mysql-flexible");
    const { credential } = await this.credentialsManager.getCredential();
    return new MySQLManagementFlexibleServerClient(credential, this.subscriptionId);
  }

  // ---------------------------------------------------------------------------
  // PostgreSQL Flexible Server client
  // ---------------------------------------------------------------------------

  private async getPgClient() {
    const { PostgreSQLManagementFlexibleServerClient } = await import("@azure/arm-postgresql-flexible");
    const { credential } = await this.credentialsManager.getCredential();
    return new PostgreSQLManagementFlexibleServerClient(credential, this.subscriptionId);
  }

  // ---------------------------------------------------------------------------
  // MySQL operations
  // ---------------------------------------------------------------------------

  /** List MySQL Flexible Servers, optionally filtered by resource group. */
  async listMySqlServers(resourceGroup?: string): Promise<AzureMySqlFlexibleServer[]> {
    return withAzureRetry(async () => {
      const client = await this.getMySqlClient();
      const results: AzureMySqlFlexibleServer[] = [];
      const iter = resourceGroup
        ? client.servers.listByResourceGroup(resourceGroup)
        : client.servers.list();
      for await (const s of iter) {
        results.push(this.mapMySqlServer(s));
      }
      return results;
    }, this.retryOptions);
  }

  /** Get a single MySQL Flexible Server. Returns null if not found. */
  async getMySqlServer(resourceGroup: string, serverName: string): Promise<AzureMySqlFlexibleServer | null> {
    return withAzureRetry(async () => {
      try {
        const client = await this.getMySqlClient();
        const server = await client.servers.get(resourceGroup, serverName);
        return this.mapMySqlServer(server);
      } catch (error: unknown) {
        if ((error as { statusCode?: number }).statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete a MySQL Flexible Server. */
  async deleteMySqlServer(resourceGroup: string, serverName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getMySqlClient();
      await client.servers.beginDeleteAndWait(resourceGroup, serverName);
    }, this.retryOptions);
  }

  /** List databases in a MySQL Flexible Server. */
  async listMySqlDatabases(resourceGroup: string, serverName: string): Promise<AzureFlexibleDatabase[]> {
    return withAzureRetry(async () => {
      const client = await this.getMySqlClient();
      const results: AzureFlexibleDatabase[] = [];
      for await (const db of client.databases.listByServer(resourceGroup, serverName)) {
        results.push({
          id: (db as unknown as Record<string, string>).id ?? "",
          name: (db as unknown as Record<string, string>).name ?? "",
          charset: (db as unknown as Record<string, string>).charset,
          collation: (db as unknown as Record<string, string>).collation,
        });
      }
      return results;
    }, this.retryOptions);
  }

  /** List firewall rules for a MySQL Flexible Server. */
  async listMySqlFirewallRules(resourceGroup: string, serverName: string): Promise<AzureFlexibleFirewallRule[]> {
    return withAzureRetry(async () => {
      const client = await this.getMySqlClient();
      const results: AzureFlexibleFirewallRule[] = [];
      for await (const r of client.firewallRules.listByServer(resourceGroup, serverName)) {
        results.push({
          id: (r as unknown as Record<string, string>).id ?? "",
          name: (r as unknown as Record<string, string>).name ?? "",
          startIpAddress: (r as unknown as Record<string, string>).startIpAddress ?? "",
          endIpAddress: (r as unknown as Record<string, string>).endIpAddress ?? "",
        });
      }
      return results;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // PostgreSQL operations
  // ---------------------------------------------------------------------------

  /** List PostgreSQL Flexible Servers, optionally filtered by resource group. */
  async listPgServers(resourceGroup?: string): Promise<AzurePostgreSqlFlexibleServer[]> {
    return withAzureRetry(async () => {
      const client = await this.getPgClient();
      const results: AzurePostgreSqlFlexibleServer[] = [];
      const iter = resourceGroup
        ? client.servers.listByResourceGroup(resourceGroup)
        : client.servers.listBySubscription();
      for await (const s of iter) {
        results.push(this.mapPgServer(s));
      }
      return results;
    }, this.retryOptions);
  }

  /** Get a single PostgreSQL Flexible Server. Returns null if not found. */
  async getPgServer(resourceGroup: string, serverName: string): Promise<AzurePostgreSqlFlexibleServer | null> {
    return withAzureRetry(async () => {
      try {
        const client = await this.getPgClient();
        const server = await client.servers.get(resourceGroup, serverName);
        return this.mapPgServer(server);
      } catch (error: unknown) {
        if ((error as { statusCode?: number }).statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete a PostgreSQL Flexible Server. */
  async deletePgServer(resourceGroup: string, serverName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getPgClient();
      await client.servers.beginDeleteAndWait(resourceGroup, serverName);
    }, this.retryOptions);
  }

  /** List databases in a PostgreSQL Flexible Server. */
  async listPgDatabases(resourceGroup: string, serverName: string): Promise<AzureFlexibleDatabase[]> {
    return withAzureRetry(async () => {
      const client = await this.getPgClient();
      const results: AzureFlexibleDatabase[] = [];
      for await (const db of client.databases.listByServer(resourceGroup, serverName)) {
        results.push({
          id: (db as unknown as Record<string, string>).id ?? "",
          name: (db as unknown as Record<string, string>).name ?? "",
          charset: (db as unknown as Record<string, string>).charset,
          collation: (db as unknown as Record<string, string>).collation,
        });
      }
      return results;
    }, this.retryOptions);
  }

  /** List firewall rules for a PostgreSQL Flexible Server. */
  async listPgFirewallRules(resourceGroup: string, serverName: string): Promise<AzureFlexibleFirewallRule[]> {
    return withAzureRetry(async () => {
      const client = await this.getPgClient();
      const results: AzureFlexibleFirewallRule[] = [];
      for await (const r of client.firewallRules.listByServer(resourceGroup, serverName)) {
        results.push({
          id: (r as unknown as Record<string, string>).id ?? "",
          name: (r as unknown as Record<string, string>).name ?? "",
          startIpAddress: (r as unknown as Record<string, string>).startIpAddress ?? "",
          endIpAddress: (r as unknown as Record<string, string>).endIpAddress ?? "",
        });
      }
      return results;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Mapping helpers
  // ---------------------------------------------------------------------------

  private mapMySqlServer(s: unknown): AzureMySqlFlexibleServer {
    const typed = s as {
      id?: string; name?: string; location?: string;
      state?: string; version?: string;
      sku?: { name?: string; tier?: string };
      administratorLogin?: string; fullyQualifiedDomainName?: string;
      storage?: { storageSizeGB?: number };
      backup?: { backupRetentionDays?: number };
      highAvailability?: { mode?: string; state?: string };
      availabilityZone?: string;
      replicaCapacity?: number; replicationRole?: string;
      tags?: Record<string, string>;
    };
    return {
      id: typed.id ?? "",
      name: typed.name ?? "",
      resourceGroup: this.extractResourceGroup(typed.id),
      location: typed.location ?? "",
      state: typed.state,
      version: typed.version,
      skuName: typed.sku?.name,
      skuTier: typed.sku?.tier,
      administratorLogin: typed.administratorLogin,
      fullyQualifiedDomainName: typed.fullyQualifiedDomainName,
      storageGB: typed.storage?.storageSizeGB,
      backupRetentionDays: typed.backup?.backupRetentionDays,
      haEnabled: typed.highAvailability?.mode !== "Disabled" && typed.highAvailability?.mode !== undefined,
      haState: typed.highAvailability?.state,
      availabilityZone: typed.availabilityZone,
      replicaCapacity: typed.replicaCapacity,
      replicationRole: typed.replicationRole,
      tags: typed.tags ?? {},
    };
  }

  private mapPgServer(s: unknown): AzurePostgreSqlFlexibleServer {
    const typed = s as {
      id?: string; name?: string; location?: string;
      state?: string; version?: string;
      sku?: { name?: string; tier?: string };
      administratorLogin?: string; fullyQualifiedDomainName?: string;
      storage?: { storageSizeGB?: number };
      backup?: { backupRetentionDays?: number };
      highAvailability?: { mode?: string; state?: string };
      availabilityZone?: string;
      replicaCapacity?: number; replicationRole?: string;
      tags?: Record<string, string>;
    };
    return {
      id: typed.id ?? "",
      name: typed.name ?? "",
      resourceGroup: this.extractResourceGroup(typed.id),
      location: typed.location ?? "",
      state: typed.state,
      version: typed.version,
      skuName: typed.sku?.name,
      skuTier: typed.sku?.tier,
      administratorLogin: typed.administratorLogin,
      fullyQualifiedDomainName: typed.fullyQualifiedDomainName,
      storageGB: typed.storage?.storageSizeGB,
      backupRetentionDays: typed.backup?.backupRetentionDays,
      haEnabled: typed.highAvailability?.mode !== "Disabled" && typed.highAvailability?.mode !== undefined,
      haState: typed.highAvailability?.state,
      availabilityZone: typed.availabilityZone,
      replicaCapacity: typed.replicaCapacity,
      replicationRole: typed.replicationRole,
      tags: typed.tags ?? {},
    };
  }
}

/** Factory function for creating a Database manager. */
export function createDatabaseManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureDatabaseManager {
  return new AzureDatabaseManager(credentialsManager, subscriptionId, retryOptions);
}
