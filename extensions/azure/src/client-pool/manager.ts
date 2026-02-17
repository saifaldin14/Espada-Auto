/**
 * Azure Client Pool — Connection Pooling for Azure SDK Clients
 */

import type { TokenCredential } from "@azure/identity";

// =============================================================================
// Types
// =============================================================================

export type ClientPoolConfig = {
  maxClients?: number;
  ttlMs?: number;
};

export type ClientPoolEntry<T> = {
  client: T;
  createdAt: number;
  lastUsed: number;
};

export type ClientPoolStats = {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
};

// =============================================================================
// Client Pool Manager
// =============================================================================

export class AzureClientPool {
  private pool = new Map<string, ClientPoolEntry<unknown>>();
  private maxClients: number;
  private ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(config?: ClientPoolConfig) {
    this.maxClients = config?.maxClients ?? 50;
    this.ttlMs = config?.ttlMs ?? 1_800_000; // 30 min default
  }

  /**
   * Get or create a client from the pool.
   */
  getOrCreate<T>(
    key: string,
    factory: (credential: TokenCredential) => T,
    credential: TokenCredential,
  ): T {
    const existing = this.pool.get(key) as ClientPoolEntry<T> | undefined;

    if (existing && Date.now() - existing.createdAt < this.ttlMs) {
      existing.lastUsed = Date.now();
      this.hits++;
      return existing.client;
    }

    // Evict expired entries if at capacity
    if (this.pool.size >= this.maxClients) {
      this.evictOldest();
    }

    const client = factory(credential);
    this.pool.set(key, {
      client,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    });
    this.misses++;

    return client;
  }

  /**
   * Remove a client from the pool.
   */
  remove(key: string): void {
    this.pool.delete(key);
  }

  /**
   * Clear all pooled clients.
   */
  clear(): void {
    this.pool.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get pool statistics.
   */
  getStats(): ClientPoolStats {
    return {
      size: this.pool.size,
      maxSize: this.maxClients,
      hits: this.hits,
      misses: this.misses,
    };
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.pool) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.pool.delete(oldestKey);
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createClientPool(config?: ClientPoolConfig): AzureClientPool {
  return new AzureClientPool(config);
}
