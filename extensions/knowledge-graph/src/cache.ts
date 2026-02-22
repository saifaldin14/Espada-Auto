/**
 * Infrastructure Knowledge Graph — Query Cache
 *
 * LRU cache layer for expensive graph operations:
 *   - Blast radius results
 *   - Dependency chain traversals
 *   - Cost aggregations
 *   - Stats queries
 *
 * Designed to sit between the GraphEngine and GraphStorage,
 * caching traversal results that are expensive to recompute.
 */

import type {
  GraphNode,
  GraphEdge,
  SubgraphResult,
  GraphStats,
  CostAttribution,
} from "./types.js";

// =============================================================================
// Cache Configuration
// =============================================================================

export type QueryCacheConfig = {
  /** Maximum number of entries in the cache (default: 500). */
  maxEntries?: number;
  /** Default TTL in milliseconds (default: 5 minutes). */
  defaultTtlMs?: number;
  /** TTL for blast radius queries (default: 2 minutes). */
  blastRadiusTtlMs?: number;
  /** TTL for stats queries (default: 30 seconds). */
  statsTtlMs?: number;
  /** TTL for cost attribution queries (default: 5 minutes). */
  costTtlMs?: number;
  /** Whether to enable cache (default: true). */
  enabled?: boolean;
};

const DEFAULT_CONFIG: Required<QueryCacheConfig> = {
  maxEntries: 500,
  defaultTtlMs: 5 * 60 * 1000,       // 5 minutes
  blastRadiusTtlMs: 2 * 60 * 1000,   // 2 minutes
  statsTtlMs: 30 * 1000,              // 30 seconds
  costTtlMs: 5 * 60 * 1000,           // 5 minutes
  enabled: true,
};

// =============================================================================
// Cache Entry
// =============================================================================

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  accessedAt: number;
  hitCount: number;
};

// =============================================================================
// LRU Cache Implementation
// =============================================================================

/**
 * Typed LRU cache with TTL support and per-key expiry.
 */
export class LRUCache<K, V> {
  private entries = new Map<K, CacheEntry<V>>();
  private maxEntries: number;
  private defaultTtlMs: number;

  constructor(maxEntries = 500, defaultTtlMs = 300_000) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Get a value from the cache. Returns undefined if not found or expired.
   */
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }

    // Update access metadata (LRU tracking)
    entry.accessedAt = Date.now();
    entry.hitCount++;

    // Move to end (most recently used) — Map preserves insertion order
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value;
  }

  /**
   * Set a value in the cache with optional custom TTL.
   */
  set(key: K, value: V, ttlMs?: number): void {
    // Evict if at capacity
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      this.evictLRU();
    }

    this.entries.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
      accessedAt: Date.now(),
      hitCount: 0,
    });
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a specific key.
   */
  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  /**
   * Invalidate all entries whose keys match a predicate.
   */
  invalidateMatching(predicate: (key: K) => boolean): number {
    let count = 0;
    for (const key of this.entries.keys()) {
      if (predicate(key)) {
        this.entries.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Get the number of entries (including expired ones that haven't been pruned).
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Remove all expired entries.
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Get cache statistics.
   */
  getStats(): { size: number; maxEntries: number; hitRate: number } {
    let totalHits = 0;
    for (const entry of this.entries.values()) {
      totalHits += entry.hitCount;
    }
    return {
      size: this.entries.size,
      maxEntries: this.maxEntries,
      hitRate: this.entries.size > 0 ? totalHits / this.entries.size : 0,
    };
  }

  /** Evict the least recently used entry. */
  private evictLRU(): void {
    // Map iteration order = insertion order; first key = oldest/LRU
    const firstKey = this.entries.keys().next().value;
    if (firstKey !== undefined) {
      this.entries.delete(firstKey);
    }
  }
}

// =============================================================================
// Query Cache — Domain-Specific Cache Layer
// =============================================================================

/** Cache key categories for invalidation. */
type CacheCategory = "blast-radius" | "dependency" | "stats" | "cost" | "neighbors" | "general";

/**
 * Domain-aware query cache for the Knowledge Graph.
 *
 * Wraps LRUCache with knowledge-graph-specific semantics:
 *   - Category-based TTLs (blast radius, stats, cost each have different TTLs)
 *   - Node-aware invalidation (when a node changes, invalidate related cache entries)
 *   - Stats for monitoring cache effectiveness
 */
export class QueryCache {
  private cache: LRUCache<string, unknown>;
  private config: Required<QueryCacheConfig>;

  // Track total hits/misses for monitoring
  private totalHits = 0;
  private totalMisses = 0;

  constructor(config: QueryCacheConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new LRUCache(this.config.maxEntries, this.config.defaultTtlMs);
  }

  /** Whether caching is enabled. */
  get enabled(): boolean {
    return this.config.enabled;
  }

  // ---------- Typed Getters/Setters ----------

  /**
   * Cache a blast radius result.
   */
  setBlastRadius(nodeId: string, depth: number, result: SubgraphResult): void {
    if (!this.config.enabled) return;
    const key = this.makeKey("blast-radius", `${nodeId}:${depth}`);
    this.cache.set(key, result, this.config.blastRadiusTtlMs);
  }

  /**
   * Get a cached blast radius result.
   */
  getBlastRadius(nodeId: string, depth: number): SubgraphResult | undefined {
    if (!this.config.enabled) return undefined;
    const key = this.makeKey("blast-radius", `${nodeId}:${depth}`);
    const result = this.cache.get(key) as SubgraphResult | undefined;
    this.trackHitMiss(result !== undefined);
    return result;
  }

  /**
   * Cache a neighbors/dependency chain result.
   */
  setNeighbors(
    nodeId: string,
    depth: number,
    direction: string,
    result: { nodes: GraphNode[]; edges: GraphEdge[] },
  ): void {
    if (!this.config.enabled) return;
    const key = this.makeKey("neighbors", `${nodeId}:${depth}:${direction}`);
    this.cache.set(key, result, this.config.defaultTtlMs);
  }

  /**
   * Get cached neighbors result.
   */
  getNeighbors(
    nodeId: string,
    depth: number,
    direction: string,
  ): { nodes: GraphNode[]; edges: GraphEdge[] } | undefined {
    if (!this.config.enabled) return undefined;
    const key = this.makeKey("neighbors", `${nodeId}:${depth}:${direction}`);
    const result = this.cache.get(key) as { nodes: GraphNode[]; edges: GraphEdge[] } | undefined;
    this.trackHitMiss(result !== undefined);
    return result;
  }

  /**
   * Cache graph stats.
   */
  setStats(stats: GraphStats): void {
    if (!this.config.enabled) return;
    const key = this.makeKey("stats", "global");
    this.cache.set(key, stats, this.config.statsTtlMs);
  }

  /**
   * Get cached graph stats.
   */
  getStats(): GraphStats | undefined {
    if (!this.config.enabled) return undefined;
    const key = this.makeKey("stats", "global");
    const result = this.cache.get(key) as GraphStats | undefined;
    this.trackHitMiss(result !== undefined);
    return result;
  }

  /**
   * Cache a cost attribution result.
   */
  setCostAttribution(label: string, result: CostAttribution): void {
    if (!this.config.enabled) return;
    const key = this.makeKey("cost", label);
    this.cache.set(key, result, this.config.costTtlMs);
  }

  /**
   * Get a cached cost attribution result.
   */
  getCostAttribution(label: string): CostAttribution | undefined {
    if (!this.config.enabled) return undefined;
    const key = this.makeKey("cost", label);
    const result = this.cache.get(key) as CostAttribution | undefined;
    this.trackHitMiss(result !== undefined);
    return result;
  }

  /**
   * Generic cache get/set for arbitrary query results.
   */
  getGeneric<T>(category: CacheCategory, id: string): T | undefined {
    if (!this.config.enabled) return undefined;
    const key = this.makeKey(category, id);
    const result = this.cache.get(key) as T | undefined;
    this.trackHitMiss(result !== undefined);
    return result;
  }

  setGeneric<T>(category: CacheCategory, id: string, value: T, ttlMs?: number): void {
    if (!this.config.enabled) return;
    const key = this.makeKey(category, id);
    this.cache.set(key, value, ttlMs);
  }

  // ---------- Invalidation ----------

  /**
   * Invalidate all cache entries related to a specific node.
   * Called when a node is created, updated, or deleted.
   */
  invalidateNode(nodeId: string): number {
    return this.cache.invalidateMatching((key) => key.includes(nodeId));
  }

  /**
   * Invalidate all entries for a category.
   */
  invalidateCategory(category: CacheCategory): number {
    const prefix = `${category}:`;
    return this.cache.invalidateMatching((key) => key.startsWith(prefix));
  }

  /**
   * Invalidate all stats caches (call after sync).
   */
  invalidateStats(): number {
    return this.invalidateCategory("stats");
  }

  /**
   * Invalidate everything (call after major changes).
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  // ---------- Monitoring ----------

  /**
   * Get cache performance statistics.
   */
  getCacheStats(): {
    size: number;
    maxEntries: number;
    totalHits: number;
    totalMisses: number;
    hitRate: number;
    internalStats: { size: number; maxEntries: number; hitRate: number };
  } {
    const total = this.totalHits + this.totalMisses;
    return {
      size: this.cache.size,
      maxEntries: this.config.maxEntries,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      hitRate: total > 0 ? this.totalHits / total : 0,
      internalStats: this.cache.getStats(),
    };
  }

  /**
   * Remove expired entries. Call periodically in long-running processes.
   */
  prune(): number {
    return this.cache.prune();
  }

  // ---------- Internals ----------

  private makeKey(category: CacheCategory, id: string): string {
    return `${category}:${id}`;
  }

  private trackHitMiss(hit: boolean): void {
    if (hit) this.totalHits++;
    else this.totalMisses++;
  }
}
