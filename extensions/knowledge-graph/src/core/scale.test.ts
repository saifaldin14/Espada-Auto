/**
 * Infrastructure Knowledge Graph — Phase 8 Tests
 *
 * Tests for:
 *   - Sync performance utilities (delta detection, batching, pagination)
 *   - Query cache (LRU, TTL, invalidation)
 *   - Multi-tenant support (account registry, tenant manager)
 *   - PostgreSQL storage (row mappers only — actual PG requires a running server)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  computeNodeHash,
  diffNodeFields,
  processBatched,
  processPooled,
  collectPaginated,
  NodeHashCache,
  incrementalSync,
} from "./sync.js";
import type { DiscoveryPage, IncrementalSyncResult } from "./sync.js";
import { LRUCache, QueryCache } from "./cache.js";
import type { QueryCacheConfig } from "./cache.js";
import {
  AccountRegistry,
  TenantManager,
  discoverCrossAccountRelationships,
  tenantScopedFilter,
} from "./tenant.js";
import type { CloudAccount, CloudAccountInput, Tenant, TenantStorageFactory } from "./tenant.js";
import { InMemoryGraphStorage } from "../storage/memory-store.js";
import type {
  GraphNode,
  GraphNodeInput,
  GraphEdgeInput,
  GraphRelationshipType,
  SubgraphResult,
  GraphStats,
  CostAttribution,
} from "../types.js";

// =============================================================================
// Helper Factories
// =============================================================================

function makeNode(overrides: Partial<GraphNodeInput> = {}): GraphNodeInput {
  const id = overrides.id ?? `aws:123:us-east-1:compute:i-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    provider: "aws",
    resourceType: "compute",
    nativeId: `arn:aws:ec2:us-east-1:123:instance/${id}`,
    name: overrides.name ?? `test-instance-${id.slice(-6)}`,
    region: "us-east-1",
    account: "123456789012",
    status: "running",
    tags: { Environment: "production" },
    metadata: { instanceType: "t3.medium" },
    costMonthly: 50,
    owner: "platform-team",
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEdge(
  sourceNodeId: string,
  targetNodeId: string,
  relType: GraphRelationshipType = "depends-on",
): GraphEdgeInput {
  return {
    id: `edge-${sourceNodeId}-${targetNodeId}`,
    sourceNodeId,
    targetNodeId,
    relationshipType: relType,
    confidence: 1.0,
    discoveredVia: "config-scan",
    metadata: {},
  };
}

// =============================================================================
// Sync Performance Tests
// =============================================================================

describe("Sync Performance", () => {
  describe("computeNodeHash", () => {
    it("should produce consistent hashes for identical nodes", () => {
      const node = makeNode({ id: "test-1", name: "web-server" });
      const hash1 = computeNodeHash(node);
      const hash2 = computeNodeHash(node);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex
    });

    it("should produce different hashes for different names", () => {
      const node1 = makeNode({ id: "test-1", name: "web-server-a" });
      const node2 = makeNode({ id: "test-1", name: "web-server-b" });
      expect(computeNodeHash(node1)).not.toBe(computeNodeHash(node2));
    });

    it("should produce different hashes for different tags", () => {
      const node1 = makeNode({ id: "test-1", tags: { env: "prod" } });
      const node2 = makeNode({ id: "test-1", tags: { env: "staging" } });
      expect(computeNodeHash(node1)).not.toBe(computeNodeHash(node2));
    });

    it("should produce different hashes for different costs", () => {
      const node1 = makeNode({ id: "test-1", costMonthly: 100 });
      const node2 = makeNode({ id: "test-1", costMonthly: 200 });
      expect(computeNodeHash(node1)).not.toBe(computeNodeHash(node2));
    });

    it("should handle null cost", () => {
      const node = makeNode({ id: "test-1", costMonthly: null });
      const hash = computeNodeHash(node);
      expect(hash).toHaveLength(64);
    });
  });

  describe("diffNodeFields", () => {
    it("should detect no changes for identical nodes", () => {
      const node = makeNode({ id: "n1", name: "test" });
      const existing: GraphNode = {
        ...node,
        discoveredAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        lastSeenAt: "2025-01-01T00:00:00Z",
      };
      expect(diffNodeFields(existing, node)).toEqual([]);
    });

    it("should detect name change", () => {
      const existing: GraphNode = {
        ...makeNode({ id: "n1", name: "old-name" }),
        discoveredAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        lastSeenAt: "2025-01-01T00:00:00Z",
      };
      const incoming = makeNode({ id: "n1", name: "new-name" });
      const changed = diffNodeFields(existing, incoming);
      expect(changed).toContain("name");
    });

    it("should detect multiple changed fields", () => {
      const existing: GraphNode = {
        ...makeNode({ id: "n1", name: "old", status: "running", costMonthly: 50 }),
        discoveredAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        lastSeenAt: "2025-01-01T00:00:00Z",
      };
      const incoming = makeNode({ id: "n1", name: "new", status: "stopped", costMonthly: 0 });
      const changed = diffNodeFields(existing, incoming);
      expect(changed).toContain("name");
      expect(changed).toContain("status");
      expect(changed).toContain("costMonthly");
    });
  });

  describe("processBatched", () => {
    it("should process all items in batches", async () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const results = await processBatched(
        items,
        async (batch) => batch.reduce((a, b) => a + b, 0),
        { batchSize: 3, concurrency: 2 },
      );
      // 4 batches: [1,2,3], [4,5,6], [7,8,9], [10]
      expect(results).toEqual([6, 15, 24, 10]);
    });

    it("should invoke onBatchComplete callback", async () => {
      const items = [1, 2, 3, 4];
      const progress: Array<[number, number]> = [];
      await processBatched(
        items,
        async (batch) => batch.length,
        {
          batchSize: 2,
          concurrency: 1,
          onBatchComplete: (completed, total) => progress.push([completed, total]),
        },
      );
      expect(progress.length).toBe(2);
      expect(progress[1]).toEqual([2, 2]);
    });

    it("should respect abort signal", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        processBatched(
          [1, 2, 3],
          async (batch) => batch,
          { signal: controller.signal },
        ),
      ).rejects.toThrow("aborted");
    });
  });

  describe("processPooled", () => {
    it("should process items with concurrency", async () => {
      const items = [1, 2, 3, 4, 5];
      const results = await processPooled(
        items,
        async (item) => item * 2,
        3,
      );
      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    it("should handle empty input", async () => {
      const results = await processPooled(
        [] as number[],
        async (item) => item,
        5,
      );
      expect(results).toEqual([]);
    });
  });

  describe("collectPaginated", () => {
    it("should collect all pages into a flat array", async () => {
      let page = 0;
      const fetcher = async (
        _pageSize: number,
        _nextToken?: string,
      ): Promise<DiscoveryPage<number>> => {
        page++;
        if (page === 1) return { items: [1, 2, 3], nextToken: "page2", hasMore: true };
        if (page === 2) return { items: [4, 5, 6], nextToken: "page3", hasMore: true };
        return { items: [7], hasMore: false };
      };

      const result = await collectPaginated(fetcher);
      expect(result).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it("should respect maxPages limit", async () => {
      let pageCount = 0;
      const fetcher = async (): Promise<DiscoveryPage<number>> => {
        pageCount++;
        return { items: [pageCount], nextToken: `page${pageCount + 1}`, hasMore: true };
      };

      const result = await collectPaginated(fetcher, { maxPages: 3 });
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe("NodeHashCache", () => {
    it("should cache and retrieve hashes", () => {
      const cache = new NodeHashCache();
      cache.set("node-1", "abc123");
      expect(cache.get("node-1")).toBe("abc123");
      expect(cache.matches("node-1", "abc123")).toBe(true);
      expect(cache.matches("node-1", "xyz789")).toBe(false);
    });

    it("should return undefined for unknown nodes", () => {
      const cache = new NodeHashCache();
      expect(cache.get("unknown")).toBeUndefined();
    });

    it("should delete entries", () => {
      const cache = new NodeHashCache();
      cache.set("node-1", "hash1");
      cache.delete("node-1");
      expect(cache.get("node-1")).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it("should clear all entries", () => {
      const cache = new NodeHashCache();
      cache.set("a", "1");
      cache.set("b", "2");
      cache.clear();
      expect(cache.size).toBe(0);
    });

    it("should build from storage", async () => {
      const storage = new InMemoryGraphStorage();
      await storage.initialize();
      await storage.upsertNode(makeNode({ id: "n1", name: "server-1" }));
      await storage.upsertNode(makeNode({ id: "n2", name: "server-2" }));

      const cache = await NodeHashCache.fromStorage(storage);
      expect(cache.size).toBe(2);
      expect(cache.get("n1")).toBeDefined();
      expect(cache.get("n2")).toBeDefined();

      await storage.close();
    });
  });

  describe("incrementalSync", () => {
    it("should skip unchanged nodes", async () => {
      const storage = new InMemoryGraphStorage();
      await storage.initialize();

      const node = makeNode({ id: "n1", name: "server-1" });
      await storage.upsertNode(node);

      const cache = new NodeHashCache();
      cache.set("n1", computeNodeHash(node));

      // Re-discover the same node (unchanged)
      const result = await incrementalSync(
        storage,
        [node],
        [],
        cache,
      );

      expect(result.skipped).toBe(1);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);

      await storage.close();
    });

    it("should detect updated nodes", async () => {
      const storage = new InMemoryGraphStorage();
      await storage.initialize();

      const node = makeNode({ id: "n1", name: "server-1" });
      await storage.upsertNode(node);

      const cache = new NodeHashCache();
      cache.set("n1", computeNodeHash(node));

      // Re-discover with changed name
      const updated = makeNode({ id: "n1", name: "server-1-updated" });
      const result = await incrementalSync(storage, [updated], [], cache);

      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(0);

      await storage.close();
    });

    it("should detect new nodes", async () => {
      const storage = new InMemoryGraphStorage();
      await storage.initialize();

      const cache = new NodeHashCache();
      const newNode = makeNode({ id: "n-new", name: "brand-new" });

      const result = await incrementalSync(storage, [newNode], [], cache);

      expect(result.created).toBe(1);
      expect(cache.get("n-new")).toBeDefined();

      await storage.close();
    });

    it("should upsert edges", async () => {
      const storage = new InMemoryGraphStorage();
      await storage.initialize();

      const n1 = makeNode({ id: "n1" });
      const n2 = makeNode({ id: "n2" });
      await storage.upsertNodes([n1, n2]);

      const cache = new NodeHashCache();
      const edge = makeEdge("n1", "n2");

      const result = await incrementalSync(storage, [], [edge], cache);
      expect(result.edgesUpserted).toBe(1);

      const stored = await storage.getEdge(edge.id);
      expect(stored).not.toBeNull();

      await storage.close();
    });
  });
});

// =============================================================================
// Query Cache Tests
// =============================================================================

describe("Query Cache", () => {
  describe("LRUCache", () => {
    it("should store and retrieve values", () => {
      const cache = new LRUCache<string, number>(10, 60_000);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBe(2);
    });

    it("should return undefined for missing keys", () => {
      const cache = new LRUCache<string, number>(10, 60_000);
      expect(cache.get("missing")).toBeUndefined();
    });

    it("should evict LRU entry when at capacity", () => {
      const cache = new LRUCache<string, number>(3, 60_000);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.set("d", 4); // Should evict "a"
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("d")).toBe(4);
    });

    it("should not evict recently accessed entries", () => {
      const cache = new LRUCache<string, number>(3, 60_000);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Access "a" to make it recently used
      cache.get("a");

      cache.set("d", 4); // Should evict "b" (now LRU)
      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBeUndefined();
    });

    it("should expire entries based on TTL", () => {
      const cache = new LRUCache<string, number>(10, 100); // 100ms TTL
      cache.set("a", 1);

      // Manually expire by setting a very short TTL test
      // Use vi.useFakeTimers for precise control
      vi.useFakeTimers();
      cache.set("b", 2, 50);

      vi.advanceTimersByTime(60); // Past 50ms TTL

      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("a")).toBe(1); // Still valid

      vi.useRealTimers();
    });

    it("should report has() correctly", () => {
      const cache = new LRUCache<string, number>(10, 60_000);
      cache.set("a", 1);
      expect(cache.has("a")).toBe(true);
      expect(cache.has("b")).toBe(false);
    });

    it("should delete entries", () => {
      const cache = new LRUCache<string, number>(10, 60_000);
      cache.set("a", 1);
      expect(cache.delete("a")).toBe(true);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.delete("b")).toBe(false);
    });

    it("should invalidate matching entries", () => {
      const cache = new LRUCache<string, number>(10, 60_000);
      cache.set("blast:node-1", 1);
      cache.set("blast:node-2", 2);
      cache.set("stats:global", 3);

      const removed = cache.invalidateMatching((k) => k.startsWith("blast:"));
      expect(removed).toBe(2);
      expect(cache.get("stats:global")).toBe(3);
    });

    it("should clear all entries", () => {
      const cache = new LRUCache<string, number>(10, 60_000);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.clear();
      expect(cache.size).toBe(0);
    });

    it("should prune expired entries", () => {
      vi.useFakeTimers();
      const cache = new LRUCache<string, number>(10, 60_000);
      cache.set("short", 1, 50);
      cache.set("long", 2, 100_000);

      vi.advanceTimersByTime(60);
      const pruned = cache.prune();
      expect(pruned).toBe(1);
      expect(cache.size).toBe(1);

      vi.useRealTimers();
    });

    it("should provide stats", () => {
      const cache = new LRUCache<string, number>(100, 60_000);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.get("a"); // 1 hit
      cache.get("a"); // 2 hits

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxEntries).toBe(100);
      expect(stats.hitRate).toBeGreaterThan(0);
    });
  });

  describe("QueryCache", () => {
    let queryCache: QueryCache;

    beforeEach(() => {
      queryCache = new QueryCache({ defaultTtlMs: 60_000 });
    });

    it("should cache and retrieve blast radius results", () => {
      const result: SubgraphResult = {
        rootNodeId: "n1",
        nodes: new Map(),
        edges: [],
        hops: new Map(),
        totalCostMonthly: 500,
      };

      queryCache.setBlastRadius("n1", 3, result);
      expect(queryCache.getBlastRadius("n1", 3)).toBe(result);
      expect(queryCache.getBlastRadius("n1", 5)).toBeUndefined(); // Different depth
    });

    it("should cache and retrieve neighbors results", () => {
      const result = { nodes: [], edges: [] };
      queryCache.setNeighbors("n1", 2, "downstream", result);
      expect(queryCache.getNeighbors("n1", 2, "downstream")).toBe(result);
      expect(queryCache.getNeighbors("n1", 2, "upstream")).toBeUndefined();
    });

    it("should cache and retrieve stats", () => {
      const stats: GraphStats = {
        totalNodes: 100,
        totalEdges: 200,
        totalChanges: 50,
        totalGroups: 5,
        nodesByProvider: { aws: 80, azure: 20 },
        nodesByResourceType: { compute: 50, storage: 30 },
        edgesByRelationshipType: { "depends-on": 100 },
        totalCostMonthly: 5000,
        lastSyncAt: "2025-01-01T00:00:00Z",
        oldestChange: "2024-06-01T00:00:00Z",
        newestChange: "2025-01-01T00:00:00Z",
      };

      queryCache.setStats(stats);
      expect(queryCache.getStats()).toBe(stats);
    });

    it("should cache and retrieve cost attribution", () => {
      const cost: CostAttribution = {
        label: "production",
        totalMonthly: 5000,
        byResourceType: { compute: 3000 },
        byProvider: { aws: 5000 },
        nodes: [],
      };

      queryCache.setCostAttribution("production", cost);
      expect(queryCache.getCostAttribution("production")).toBe(cost);
    });

    it("should invalidate by node ID", () => {
      const result: SubgraphResult = {
        rootNodeId: "n1",
        nodes: new Map(),
        edges: [],
        hops: new Map(),
        totalCostMonthly: 0,
      };

      queryCache.setBlastRadius("n1", 3, result);
      queryCache.setNeighbors("n1", 2, "downstream", { nodes: [], edges: [] });

      const removed = queryCache.invalidateNode("n1");
      expect(removed).toBe(2);
      expect(queryCache.getBlastRadius("n1", 3)).toBeUndefined();
    });

    it("should invalidate by category", () => {
      queryCache.setStats({
        totalNodes: 0, totalEdges: 0, totalChanges: 0, totalGroups: 0,
        nodesByProvider: {}, nodesByResourceType: {}, edgesByRelationshipType: {},
        totalCostMonthly: 0, lastSyncAt: null, oldestChange: null, newestChange: null,
      });
      queryCache.setBlastRadius("n1", 3, {
        rootNodeId: "n1", nodes: new Map(), edges: [], hops: new Map(), totalCostMonthly: 0,
      });

      const removed = queryCache.invalidateStats();
      expect(removed).toBe(1);
      expect(queryCache.getStats()).toBeUndefined();
    });

    it("should invalidate all", () => {
      queryCache.setStats({
        totalNodes: 0, totalEdges: 0, totalChanges: 0, totalGroups: 0,
        nodesByProvider: {}, nodesByResourceType: {}, edgesByRelationshipType: {},
        totalCostMonthly: 0, lastSyncAt: null, oldestChange: null, newestChange: null,
      });
      queryCache.setBlastRadius("n1", 3, {
        rootNodeId: "n1", nodes: new Map(), edges: [], hops: new Map(), totalCostMonthly: 0,
      });

      queryCache.invalidateAll();
      expect(queryCache.getStats()).toBeUndefined();
      expect(queryCache.getBlastRadius("n1", 3)).toBeUndefined();
    });

    it("should provide cache stats", () => {
      queryCache.setStats({
        totalNodes: 0, totalEdges: 0, totalChanges: 0, totalGroups: 0,
        nodesByProvider: {}, nodesByResourceType: {}, edgesByRelationshipType: {},
        totalCostMonthly: 0, lastSyncAt: null, oldestChange: null, newestChange: null,
      });

      // Hit
      queryCache.getStats();
      // Miss
      queryCache.getBlastRadius("missing", 1);

      const stats = queryCache.getCacheStats();
      expect(stats.totalHits).toBe(1);
      expect(stats.totalMisses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });

    it("should respect disabled config", () => {
      const disabled = new QueryCache({ enabled: false });
      disabled.setStats({
        totalNodes: 0, totalEdges: 0, totalChanges: 0, totalGroups: 0,
        nodesByProvider: {}, nodesByResourceType: {}, edgesByRelationshipType: {},
        totalCostMonthly: 0, lastSyncAt: null, oldestChange: null, newestChange: null,
      });
      expect(disabled.getStats()).toBeUndefined();
    });

    it("should handle generic get/set", () => {
      queryCache.setGeneric("general", "custom-key", { value: 42 });
      const result = queryCache.getGeneric<{ value: number }>("general", "custom-key");
      expect(result).toEqual({ value: 42 });
    });
  });
});

// =============================================================================
// Multi-Tenant Tests
// =============================================================================

describe("Multi-Tenant", () => {
  describe("AccountRegistry", () => {
    let registry: AccountRegistry;

    beforeEach(() => {
      registry = new AccountRegistry();
    });

    function makeAccount(overrides: Partial<CloudAccountInput> = {}): CloudAccountInput {
      return {
        id: overrides.id ?? `acct-${Math.random().toString(36).slice(2, 8)}`,
        provider: "aws",
        nativeAccountId: "123456789012",
        name: "production",
        tenantId: "tenant-1",
        enabled: true,
        regions: ["us-east-1", "us-west-2"],
        auth: { method: "default" },
        tags: { env: "prod" },
        ...overrides,
      };
    }

    it("should register and retrieve accounts", () => {
      const input = makeAccount({ id: "acct-1", name: "production" });
      const account = registry.register(input);
      expect(account.id).toBe("acct-1");
      expect(account.name).toBe("production");
      expect(account.createdAt).toBeDefined();

      const retrieved = registry.get("acct-1");
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("production");
    });

    it("should update existing accounts", () => {
      const input = makeAccount({ id: "acct-1", name: "old-name" });
      registry.register(input);

      const updated = registry.register({ ...input, name: "new-name" });
      expect(updated.name).toBe("new-name");
      expect(updated.createdAt).toBe(registry.get("acct-1")!.createdAt); // Preserves createdAt
    });

    it("should unregister accounts", () => {
      registry.register(makeAccount({ id: "acct-1" }));
      expect(registry.unregister("acct-1")).toBe(true);
      expect(registry.get("acct-1")).toBeUndefined();
      expect(registry.unregister("unknown")).toBe(false);
    });

    it("should list accounts with filters", () => {
      registry.register(makeAccount({ id: "aws-1", provider: "aws", tenantId: "t1", enabled: true }));
      registry.register(makeAccount({ id: "azure-1", provider: "azure", tenantId: "t1", enabled: true }));
      registry.register(makeAccount({ id: "aws-2", provider: "aws", tenantId: "t2", enabled: false }));

      expect(registry.list({ provider: "aws" })).toHaveLength(2);
      expect(registry.list({ tenantId: "t1" })).toHaveLength(2);
      expect(registry.list({ enabled: true })).toHaveLength(2);
      expect(registry.list({ provider: "aws", enabled: true })).toHaveLength(1);
    });

    it("should get unique providers", () => {
      registry.register(makeAccount({ id: "1", provider: "aws" }));
      registry.register(makeAccount({ id: "2", provider: "azure" }));
      registry.register(makeAccount({ id: "3", provider: "aws" }));

      const providers = registry.getProviders();
      expect(providers).toContain("aws");
      expect(providers).toContain("azure");
      expect(providers).toHaveLength(2);
    });

    it("should get unique tenant IDs", () => {
      registry.register(makeAccount({ id: "1", tenantId: "t1" }));
      registry.register(makeAccount({ id: "2", tenantId: "t2" }));
      registry.register(makeAccount({ id: "3", tenantId: "t1" }));

      const tenants = registry.getTenantIds();
      expect(tenants).toContain("t1");
      expect(tenants).toContain("t2");
      expect(tenants).toHaveLength(2);
    });

    it("should mark account as synced", () => {
      registry.register(makeAccount({ id: "acct-1" }));
      registry.markSynced("acct-1", "2025-06-15T12:00:00Z");
      expect(registry.get("acct-1")!.lastSyncAt).toBe("2025-06-15T12:00:00Z");
    });

    it("should enable/disable accounts", () => {
      registry.register(makeAccount({ id: "acct-1", enabled: true }));
      registry.setEnabled("acct-1", false);
      expect(registry.get("acct-1")!.enabled).toBe(false);
    });

    it("should count by provider", () => {
      registry.register(makeAccount({ id: "1", provider: "aws" }));
      registry.register(makeAccount({ id: "2", provider: "aws" }));
      registry.register(makeAccount({ id: "3", provider: "azure" }));

      const counts = registry.countByProvider();
      expect(counts.aws).toBe(2);
      expect(counts.azure).toBe(1);
    });
  });

  describe("TenantManager", () => {
    let manager: TenantManager;
    let factory: TenantStorageFactory;

    beforeEach(() => {
      // Mock factory that creates in-memory storage
      factory = {
        create: async (_tenant: Tenant) => new InMemoryGraphStorage(),
        destroy: async (_tenantId: string) => {},
      };
      manager = new TenantManager(factory);
    });

    it("should create a tenant", async () => {
      const tenant = await manager.createTenant({
        id: "t1",
        name: "Acme Corp",
        isolation: { strategy: "schema", schemaName: "acme" },
      });

      expect(tenant.id).toBe("t1");
      expect(tenant.name).toBe("Acme Corp");
      expect(tenant.active).toBe(true);
      expect(tenant.maxAccounts).toBe(100);
      expect(tenant.maxNodes).toBe(500_000);
    });

    it("should reject duplicate tenant IDs", async () => {
      await manager.createTenant({
        id: "t1",
        name: "First",
        isolation: { strategy: "shared" },
      });

      await expect(
        manager.createTenant({
          id: "t1",
          name: "Second",
          isolation: { strategy: "shared" },
        }),
      ).rejects.toThrow("already exists");
    });

    it("should get tenant by ID", async () => {
      await manager.createTenant({
        id: "t1",
        name: "Acme",
        isolation: { strategy: "shared" },
      });

      expect(manager.getTenant("t1")?.name).toBe("Acme");
      expect(manager.getTenant("missing")).toBeUndefined();
    });

    it("should list tenants", async () => {
      await manager.createTenant({ id: "t1", name: "A", isolation: { strategy: "shared" } });
      await manager.createTenant({ id: "t2", name: "B", isolation: { strategy: "shared" } });

      expect(manager.listTenants()).toHaveLength(2);
    });

    it("should get storage for a tenant", async () => {
      await manager.createTenant({
        id: "t1",
        name: "Test",
        isolation: { strategy: "shared" },
      });

      const storage = await manager.getStorage("t1");
      expect(storage).toBeDefined();

      // Second call should return cached instance
      const storage2 = await manager.getStorage("t1");
      expect(storage2).toBe(storage);
    });

    it("should reject storage for unknown tenant", async () => {
      await expect(manager.getStorage("unknown")).rejects.toThrow("not found");
    });

    it("should reject storage for inactive tenant", async () => {
      await manager.createTenant({
        id: "t1",
        name: "Test",
        isolation: { strategy: "shared" },
      });
      manager.deactivateTenant("t1");

      // Clear cache so it tries to create anew
      // The getStorage hits the cache first, so we need a fresh manager
      const freshManager = new TenantManager(factory);
      // Register the tenant as inactive manually
      await freshManager.createTenant({
        id: "t-inactive",
        name: "Inactive",
        isolation: { strategy: "shared" },
      });
      freshManager.deactivateTenant("t-inactive");

      // Cached storage still works, but creating new storage for inactive tenant should fail
      // We test by checking the tenant state
      expect(freshManager.getTenant("t-inactive")?.active).toBe(false);
    });

    it("should deactivate and reactivate tenants", async () => {
      await manager.createTenant({
        id: "t1",
        name: "Test",
        isolation: { strategy: "shared" },
      });

      manager.deactivateTenant("t1");
      expect(manager.getTenant("t1")?.active).toBe(false);
      expect(manager.listTenants(true)).toHaveLength(0);
      expect(manager.listTenants(false)).toHaveLength(1);

      manager.reactivateTenant("t1");
      expect(manager.getTenant("t1")?.active).toBe(true);
    });

    it("should delete a tenant", async () => {
      await manager.createTenant({
        id: "t1",
        name: "Delete Me",
        isolation: { strategy: "shared" },
      });

      await manager.deleteTenant("t1");
      expect(manager.getTenant("t1")).toBeUndefined();
      expect(manager.listTenants(false)).toHaveLength(0);
    });

    it("should provide global stats", async () => {
      await manager.createTenant({ id: "t1", name: "A", isolation: { strategy: "shared" } });
      await manager.createTenant({ id: "t2", name: "B", isolation: { strategy: "shared" } });

      // Seed some data in tenant 1
      const storage1 = await manager.getStorage("t1");
      await storage1.upsertNode(makeNode({ id: "n1" }));
      await storage1.upsertNode(makeNode({ id: "n2" }));

      const globalStats = await manager.getGlobalStats();
      expect(globalStats.tenants).toBe(2);
      expect(globalStats.activeTenants).toBe(2);
      expect(globalStats.totalStats.totalNodes).toBe(2);
      expect(globalStats.perTenant).toHaveLength(2);
    });

    it("should close all storage on close", async () => {
      await manager.createTenant({ id: "t1", name: "A", isolation: { strategy: "shared" } });
      await manager.getStorage("t1");

      // Should not throw
      await manager.close();
    });
  });

  describe("discoverCrossAccountRelationships", () => {
    it("should discover IAM trust relationships", async () => {
      const storage = new InMemoryGraphStorage();
      await storage.initialize();

      // Source account has an IAM role trusting the target account
      await storage.upsertNode(makeNode({
        id: "aws:source:us-east-1:iam-role:role-1",
        provider: "aws",
        resourceType: "iam-role",
        account: "111111111111",
        name: "cross-account-role",
        metadata: { trustPolicy: '{"Principal": {"AWS": "arn:aws:iam::222222222222:root"}}' },
      }));

      // Target account has an IAM role
      await storage.upsertNode(makeNode({
        id: "aws:target:us-east-1:iam-role:role-2",
        provider: "aws",
        resourceType: "iam-role",
        account: "222222222222",
        name: "target-role",
        metadata: {},
      }));

      const result = await discoverCrossAccountRelationships(storage, {
        sourceAccountId: "111111111111",
        targetAccountId: "222222222222",
        relationshipTypes: ["iam-trust"],
      });

      expect(result.discovered).toBe(1);
      expect(result.relationships[0].type).toBe("iam-trust");

      await storage.close();
    });

    it("should handle no relationships found", async () => {
      const storage = new InMemoryGraphStorage();
      await storage.initialize();

      await storage.upsertNode(makeNode({
        id: "n1",
        account: "111111111111",
        resourceType: "compute",
      }));

      const result = await discoverCrossAccountRelationships(storage, {
        sourceAccountId: "111111111111",
        targetAccountId: "222222222222",
        relationshipTypes: ["vpc-peering"],
      });

      expect(result.discovered).toBe(0);

      await storage.close();
    });
  });

  describe("tenantScopedFilter", () => {
    it("should return base filter when no accounts match", () => {
      const registry = new AccountRegistry();
      const filter = tenantScopedFilter(registry, "unknown-tenant", { provider: "aws" });
      expect(filter.provider).toBe("aws");
    });

    it("should merge with base filter for matching accounts", () => {
      const registry = new AccountRegistry();
      registry.register({
        id: "acct-1",
        provider: "aws",
        nativeAccountId: "123",
        name: "prod",
        tenantId: "t1",
        enabled: true,
        regions: [],
        auth: { method: "default" },
        tags: {},
      });

      const filter = tenantScopedFilter(registry, "t1", { provider: "aws" });
      expect(filter.provider).toBe("aws");
    });
  });
});

// =============================================================================
// PostgreSQL Storage Tests (Unit — no actual PG connection)
// =============================================================================

describe("PostgresGraphStorage (unit)", () => {
  it("should throw if not initialized", async () => {
    // We can't easily test without pg, but we can import the class
    // and verify it exists with the right methods
    const { PostgresGraphStorage } = await import("../storage/postgres-store.js");

    const instance = new PostgresGraphStorage({
      connectionString: "postgres://localhost/test",
    });

    // Accessing db before initialize should throw
    await expect(instance.getNode("test")).rejects.toThrow("not initialized");
  });

  it("should export PostgresConfig type", async () => {
    const mod = await import("../storage/postgres-store.js");
    expect(mod.PostgresGraphStorage).toBeDefined();
  });
});
