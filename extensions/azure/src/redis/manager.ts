/**
 * Azure Cache for Redis Manager
 *
 * Manages Redis caches via @azure/arm-rediscache.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { RedisCache, RedisFirewallRule, RedisAccessKeys, RedisSkuName } from "./types.js";

export class AzureRedisManager {
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
    const { RedisManagementClient } = await import("@azure/arm-rediscache");
    const { credential } = await this.credentialsManager.getCredential();
    return new RedisManagementClient(credential, this.subscriptionId);
  }

  async listCaches(resourceGroup?: string): Promise<RedisCache[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: RedisCache[] = [];
      const iter = resourceGroup
        ? client.redis.listByResourceGroup(resourceGroup)
        : client.redis.listBySubscription();
      for await (const r of iter) {
        results.push({
          id: r.id ?? "",
          name: r.name ?? "",
          resourceGroup: r.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: r.location ?? "",
          hostName: r.hostName,
          port: r.port,
          sslPort: r.sslPort,
          sku: {
            name: ((r.sku?.name ?? "Standard") as string as RedisSkuName),
            family: r.sku?.family ?? "",
            capacity: r.sku?.capacity ?? 0,
          },
          provisioningState: r.provisioningState,
          redisVersion: r.redisVersion,
          enableNonSslPort: r.enableNonSslPort,
          minimumTlsVersion: r.minimumTlsVersion,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async getCache(resourceGroup: string, cacheName: string): Promise<RedisCache> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const r = await client.redis.get(resourceGroup, cacheName);
      return {
        id: r.id ?? "",
        name: r.name ?? "",
        resourceGroup,
        location: r.location ?? "",
        hostName: r.hostName,
        port: r.port,
        sslPort: r.sslPort,
        sku: {
          name: ((r.sku?.name ?? "Standard") as string as RedisSkuName),
          family: r.sku?.family ?? "",
          capacity: r.sku?.capacity ?? 0,
        },
        provisioningState: r.provisioningState,
        redisVersion: r.redisVersion,
        enableNonSslPort: r.enableNonSslPort,
        minimumTlsVersion: r.minimumTlsVersion,
      };
    }, this.retryOptions);
  }

  async listFirewallRules(
    resourceGroup: string,
    cacheName: string
  ): Promise<RedisFirewallRule[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: RedisFirewallRule[] = [];
      for await (const rule of client.firewallRules.list(resourceGroup, cacheName)) {
        results.push({
          id: rule.id ?? "",
          name: rule.name ?? "",
          startIP: rule.startIP ?? "",
          endIP: rule.endIP ?? "",
        });
      }
      return results;
    }, this.retryOptions);
  }

  async getKeys(resourceGroup: string, cacheName: string): Promise<RedisAccessKeys> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const keys = await client.redis.listKeys(resourceGroup, cacheName);
      return {
        primaryKey: keys.primaryKey ?? "",
        secondaryKey: keys.secondaryKey ?? "",
      };
    }, this.retryOptions);
  }

  async regenerateKey(
    resourceGroup: string,
    cacheName: string,
    keyType: "Primary" | "Secondary"
  ): Promise<RedisAccessKeys> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const keys = await client.redis.regenerateKey(resourceGroup, cacheName, {
        keyType: keyType as "Primary" | "Secondary",
      });
      return {
        primaryKey: keys.primaryKey ?? "",
        secondaryKey: keys.secondaryKey ?? "",
      };
    }, this.retryOptions);
  }

  /**
   * Create an Azure Cache for Redis instance.
   */
  async createCache(
    resourceGroup: string,
    name: string,
    location: string,
    options?: {
      skuName?: RedisSkuName;
      skuFamily?: string;
      skuCapacity?: number;
      enableNonSslPort?: boolean;
      minimumTlsVersion?: string;
      redisVersion?: string;
      tags?: Record<string, string>;
    }
  ): Promise<RedisCache> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const r = await client.redis.beginCreateAndWait(resourceGroup, name, {
        location,
        sku: {
          name: options?.skuName ?? "Standard",
          family: options?.skuFamily ?? "C",
          capacity: options?.skuCapacity ?? 1,
        },
        enableNonSslPort: options?.enableNonSslPort ?? false,
        minimumTlsVersion: options?.minimumTlsVersion ?? "1.2",
        redisVersion: options?.redisVersion,
        tags: options?.tags,
      });
      return {
        id: r.id ?? "",
        name: r.name ?? "",
        resourceGroup,
        location: r.location ?? "",
        hostName: r.hostName,
        port: r.port,
        sslPort: r.sslPort,
        sku: {
          name: ((r.sku?.name ?? "Standard") as string as RedisSkuName),
          family: r.sku?.family ?? "",
          capacity: r.sku?.capacity ?? 0,
        },
        provisioningState: r.provisioningState,
        redisVersion: r.redisVersion,
        enableNonSslPort: r.enableNonSslPort,
        minimumTlsVersion: r.minimumTlsVersion,
      };
    }, this.retryOptions);
  }

  /**
   * Delete a Redis cache.
   */
  async deleteCache(resourceGroup: string, cacheName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.redis.beginDeleteAndWait(resourceGroup, cacheName);
    }, this.retryOptions);
  }

  /**
   * Create or update a firewall rule for a Redis cache.
   */
  async createFirewallRule(
    resourceGroup: string,
    cacheName: string,
    ruleName: string,
    startIP: string,
    endIP: string
  ): Promise<RedisFirewallRule> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const rule = await client.firewallRules.createOrUpdate(
        resourceGroup, cacheName, ruleName,
        { startIP, endIP }
      );
      return {
        id: rule.id ?? "",
        name: rule.name ?? "",
        startIP: rule.startIP ?? "",
        endIP: rule.endIP ?? "",
      };
    }, this.retryOptions);
  }

  /**
   * Delete a firewall rule from a Redis cache.
   */
  async deleteFirewallRule(
    resourceGroup: string,
    cacheName: string,
    ruleName: string
  ): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.firewallRules.delete(resourceGroup, cacheName, ruleName);
    }, this.retryOptions);
  }
}

export function createRedisManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureRedisManager {
  return new AzureRedisManager(credentialsManager, subscriptionId, retryOptions);
}
