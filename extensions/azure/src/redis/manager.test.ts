/**
 * Azure Redis Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureRedisManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockRedis = {
  listBySubscription: vi.fn(),
  listByResourceGroup: vi.fn(),
  get: vi.fn(),
  listKeys: vi.fn(),
  regenerateKey: vi.fn(),
};

const mockFwRules = { list: vi.fn() };

vi.mock("@azure/arm-rediscache", () => ({
  RedisManagementClient: vi.fn().mockImplementation(() => ({
    redis: mockRedis,
    firewallRules: mockFwRules,
  })),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureRedisManager", () => {
  let mgr: AzureRedisManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureRedisManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listCaches", () => {
    it("lists all caches", async () => {
      mockRedis.listBySubscription.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Cache/Redis/cache-1", name: "cache-1", location: "eastus", properties: { hostName: "cache-1.redis.cache.windows.net", port: 6379, sslPort: 6380, provisioningState: "Succeeded", redisVersion: "6" }, sku: { name: "Standard", family: "C", capacity: 1 }, tags: {} },
      ]));
      const caches = await mgr.listCaches();
      expect(caches).toHaveLength(1);
      expect(caches[0].name).toBe("cache-1");
    });

    it("filters by resource group", async () => {
      mockRedis.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listCaches("rg-1");
      expect(mockRedis.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("getCache", () => {
    it("returns cache details", async () => {
      mockRedis.get.mockResolvedValue({
        id: "id", name: "cache-1", location: "eastus",
        properties: { hostName: "cache-1.redis.cache.windows.net", port: 6379, sslPort: 6380, provisioningState: "Succeeded", redisVersion: "6" },
        sku: { name: "Premium", family: "P", capacity: 2 }, tags: {},
      });
      const cache = await mgr.getCache("rg-1", "cache-1");
      expect(cache.name).toBe("cache-1");
    });
  });

  describe("listFirewallRules", () => {
    it("lists firewall rules", async () => {
      mockFwRules.list.mockReturnValue(asyncIter([
        { id: "fw-id", name: "allow-office", properties: { startIP: "10.0.0.1", endIP: "10.0.0.254" } },
      ]));
      const rules = await mgr.listFirewallRules("rg-1", "cache-1");
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe("allow-office");
    });
  });

  describe("getKeys", () => {
    it("returns access keys", async () => {
      mockRedis.listKeys.mockResolvedValue({ primaryKey: "pk-123", secondaryKey: "sk-456" });
      const keys = await mgr.getKeys("rg-1", "cache-1");
      expect(keys.primaryKey).toBe("pk-123");
      expect(keys.secondaryKey).toBe("sk-456");
    });
  });

  describe("regenerateKey", () => {
    it("regenerates primary key", async () => {
      mockRedis.regenerateKey.mockResolvedValue({ primaryKey: "new-pk", secondaryKey: "sk-456" });
      const keys = await mgr.regenerateKey("rg-1", "cache-1", "Primary");
      expect(keys.primaryKey).toBe("new-pk");
    });
  });
});
