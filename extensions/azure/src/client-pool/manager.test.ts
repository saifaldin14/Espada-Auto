/**
 * Azure Client Pool — Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AzureClientPool, createClientPool } from "./manager.js";
import type { TokenCredential } from "@azure/identity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockCredential: TokenCredential = {
  getToken: vi.fn().mockResolvedValue({ token: "t", expiresOnTimestamp: Date.now() + 3600000 }),
};

function makeClient(name: string) {
  return { name, dispose: vi.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AzureClientPool", () => {
  let pool: AzureClientPool;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = new AzureClientPool({ maxClients: 3, ttlMs: 5000 });
  });

  // -------------------------------------------------------------------------
  // getOrCreate
  // -------------------------------------------------------------------------
  describe("getOrCreate", () => {
    it("creates a new client on first call", () => {
      const factory = vi.fn().mockReturnValue(makeClient("c1"));

      const client = pool.getOrCreate("key1", factory, mockCredential);
      expect(client.name).toBe("c1");
      expect(factory).toHaveBeenCalledWith(mockCredential);
    });

    it("returns cached client on second call (cache hit)", () => {
      const factory = vi.fn().mockReturnValue(makeClient("c1"));

      const client1 = pool.getOrCreate("key1", factory, mockCredential);
      const client2 = pool.getOrCreate("key1", factory, mockCredential);

      expect(client1).toBe(client2);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("creates different clients for different keys", () => {
      const f1 = vi.fn().mockReturnValue(makeClient("c1"));
      const f2 = vi.fn().mockReturnValue(makeClient("c2"));

      const c1 = pool.getOrCreate("key1", f1, mockCredential);
      const c2 = pool.getOrCreate("key2", f2, mockCredential);

      expect(c1.name).toBe("c1");
      expect(c2.name).toBe("c2");
    });

    it("evicts oldest client when pool is full", () => {
      const factory = vi.fn();
      factory.mockReturnValueOnce(makeClient("c1"));
      factory.mockReturnValueOnce(makeClient("c2"));
      factory.mockReturnValueOnce(makeClient("c3"));
      factory.mockReturnValueOnce(makeClient("c4"));

      pool.getOrCreate("a", factory, mockCredential);
      pool.getOrCreate("b", factory, mockCredential);
      pool.getOrCreate("c", factory, mockCredential);
      // Pool full (3). Next call should evict oldest.
      pool.getOrCreate("d", factory, mockCredential);

      const stats = pool.getStats();
      expect(stats.size).toBe(3);
      expect(stats.misses).toBe(4);
    });

    it("recreates client after TTL expires", async () => {
      const shortPool = new AzureClientPool({ maxClients: 10, ttlMs: 1 });
      const factory = vi.fn();
      factory.mockReturnValueOnce(makeClient("old"));
      factory.mockReturnValueOnce(makeClient("new"));

      shortPool.getOrCreate("key", factory, mockCredential);
      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 10));
      const client2 = shortPool.getOrCreate("key", factory, mockCredential);

      expect(client2.name).toBe("new");
      expect(factory).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------
  describe("remove", () => {
    it("removes a client from the pool", () => {
      const factory = vi.fn().mockReturnValue(makeClient("c1"));
      pool.getOrCreate("key1", factory, mockCredential);
      expect(pool.getStats().size).toBe(1);

      pool.remove("key1");
      expect(pool.getStats().size).toBe(0);
    });

    it("no-ops when removing non-existing key", () => {
      pool.remove("nonexistent");
      expect(pool.getStats().size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------
  describe("clear", () => {
    it("clears all clients and resets stats", () => {
      const factory = vi.fn().mockReturnValue(makeClient("c"));
      pool.getOrCreate("a", factory, mockCredential);
      pool.getOrCreate("b", factory, mockCredential);
      pool.getOrCreate("a", factory, mockCredential); // hit

      pool.clear();
      const stats = pool.getStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------
  describe("getStats", () => {
    it("returns accurate pool statistics", () => {
      const factory = vi.fn().mockReturnValue(makeClient("c"));

      pool.getOrCreate("a", factory, mockCredential); // miss
      pool.getOrCreate("b", factory, mockCredential); // miss
      pool.getOrCreate("a", factory, mockCredential); // hit

      const stats = pool.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(3);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
    });

    it("returns zeroes for empty pool", () => {
      const stats = pool.getStats();
      expect(stats).toEqual({ size: 0, maxSize: 3, hits: 0, misses: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // Default configuration
  // -------------------------------------------------------------------------
  describe("defaults", () => {
    it("uses default maxClients and ttlMs", () => {
      const defaultPool = new AzureClientPool();
      const stats = defaultPool.getStats();
      expect(stats.maxSize).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------
  describe("createClientPool", () => {
    it("creates an AzureClientPool instance", () => {
      const instance = createClientPool();
      expect(instance).toBeInstanceOf(AzureClientPool);
    });

    it("passes config through", () => {
      const instance = createClientPool({ maxClients: 5 });
      expect(instance.getStats().maxSize).toBe(5);
    });
  });
});
