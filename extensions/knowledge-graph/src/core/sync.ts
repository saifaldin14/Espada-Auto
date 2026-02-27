/**
 * Infrastructure Knowledge Graph — Sync Performance Utilities
 *
 * Optimizations for large-scale infrastructure sync operations:
 *   - Node attribute hashing for delta detection (skip unchanged nodes)
 *   - Batch processing with configurable parallelism
 *   - Streaming/paginated discovery results
 *   - Incremental sync coordinator
 */

import { createHash } from "node:crypto";
import type {
  GraphNodeInput,
  GraphEdgeInput,
  GraphNode,
  GraphStorage,
  CloudProvider,
} from "../types.js";

// =============================================================================
// Delta Detection — Hash-Based Change Detection
// =============================================================================

/**
 * Compute a stable content hash of a node's mutable attributes.
 * Used to detect whether a node has actually changed between syncs,
 * avoiding unnecessary upserts and change records.
 */
export function computeNodeHash(node: GraphNodeInput): string {
  const hasher = createHash("sha256");

  // Hash only mutable fields; immutable fields (id, provider, nativeId, etc.)
  // don't need to be tracked for changes.
  hasher.update(node.name);
  hasher.update(node.status);
  hasher.update(node.region);
  hasher.update(node.account);
  hasher.update(JSON.stringify(node.tags));
  hasher.update(JSON.stringify(node.metadata));
  hasher.update(String(node.costMonthly ?? ""));
  hasher.update(node.owner ?? "");

  return hasher.digest("hex");
}

/**
 * Compare two nodes and determine if any mutable fields changed.
 * More detailed than a hash comparison — returns the list of changed fields.
 */
export function diffNodeFields(
  existing: GraphNode,
  incoming: GraphNodeInput,
): string[] {
  const changed: string[] = [];

  if (existing.name !== incoming.name) changed.push("name");
  if (existing.status !== incoming.status) changed.push("status");
  if (existing.region !== incoming.region) changed.push("region");
  if (existing.account !== incoming.account) changed.push("account");
  if (JSON.stringify(existing.tags) !== JSON.stringify(incoming.tags)) changed.push("tags");
  if (JSON.stringify(existing.metadata) !== JSON.stringify(incoming.metadata)) changed.push("metadata");
  if (existing.costMonthly !== incoming.costMonthly) changed.push("costMonthly");
  if (existing.owner !== incoming.owner) changed.push("owner");

  return changed;
}

// =============================================================================
// Batch Processing — Parallelism Control
// =============================================================================

/** Options for batch processing. */
export type BatchOptions = {
  /** Number of concurrent operations (default: 5). */
  concurrency?: number;
  /** Batch size for grouping items before processing (default: 100). */
  batchSize?: number;
  /** Callback invoked after each batch completes. */
  onBatchComplete?: (completed: number, total: number) => void;
  /** Abort signal to cancel processing. */
  signal?: AbortSignal;
};

/**
 * Process items in batches with controlled concurrency.
 * Balances throughput against API rate limits.
 */
export async function processBatched<T, R>(
  items: T[],
  processor: (batch: T[]) => Promise<R>,
  options: BatchOptions = {},
): Promise<R[]> {
  const { concurrency = 5, batchSize = 100, onBatchComplete, signal } = options;

  // Split into batches
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  const results: R[] = [];
  let completed = 0;

  // Process batches with concurrency limit
  for (let i = 0; i < batches.length; i += concurrency) {
    if (signal?.aborted) {
      throw new Error("Batch processing aborted");
    }

    const chunk = batches.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map((batch) => processor(batch)));
    results.push(...chunkResults);

    completed += chunk.length;
    onBatchComplete?.(completed, batches.length);
  }

  return results;
}

/**
 * Process items one at a time with a concurrency pool.
 * Useful for API calls that should be limited but not batched.
 */
export async function processPooled<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency = 5,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      if (signal?.aborted) throw new Error("Processing aborted");
      const idx = nextIndex++;
      results[idx] = await processor(items[idx]);
    }
  });

  await Promise.all(workers);
  return results;
}

// =============================================================================
// Streaming Discovery — Paginated Results
// =============================================================================

/** A page of discovery results. */
export type DiscoveryPage<T> = {
  items: T[];
  nextToken?: string;
  hasMore: boolean;
};

/** Configuration for paginated discovery. */
export type PaginatedDiscoveryConfig = {
  /** Page size (default: 100). */
  pageSize?: number;
  /** Maximum number of pages to fetch (safety limit, default: 1000). */
  maxPages?: number;
  /** Abort signal. */
  signal?: AbortSignal;
};

/**
 * Consume a paginated API endpoint, yielding all items.
 * Handles pagination tokens automatically.
 */
export async function* paginatedDiscover<T>(
  fetcher: (pageSize: number, nextToken?: string) => Promise<DiscoveryPage<T>>,
  config: PaginatedDiscoveryConfig = {},
): AsyncGenerator<T[], void, unknown> {
  const { pageSize = 100, maxPages = 1000, signal } = config;

  let nextToken: string | undefined;
  let pageCount = 0;

  do {
    if (signal?.aborted) return;
    if (pageCount >= maxPages) return;

    const page = await fetcher(pageSize, nextToken);
    if (page.items.length > 0) {
      yield page.items;
    }

    nextToken = page.nextToken;
    pageCount++;
  } while (nextToken);
}

/**
 * Collect all items from a paginated discovery into a flat array.
 * Convenience wrapper around paginatedDiscover.
 */
export async function collectPaginated<T>(
  fetcher: (pageSize: number, nextToken?: string) => Promise<DiscoveryPage<T>>,
  config: PaginatedDiscoveryConfig = {},
): Promise<T[]> {
  const all: T[] = [];
  for await (const page of paginatedDiscover(fetcher, config)) {
    all.push(...page);
  }
  return all;
}

// =============================================================================
// Incremental Sync Coordinator
// =============================================================================

/** Result of an incremental sync operation. */
export type IncrementalSyncResult = {
  /** Nodes that were created (not previously in storage). */
  created: number;
  /** Nodes that were updated (mutable fields changed). */
  updated: number;
  /** Nodes that were unchanged (hash match, skipped). */
  skipped: number;
  /** Nodes marked disappeared (existed before, not in discovery). */
  disappeared: number;
  /** Edges that were upserted. */
  edgesUpserted: number;
  /** Duration in ms. */
  durationMs: number;
};

/** In-memory hash cache for delta detection across syncs. */
export class NodeHashCache {
  private hashes = new Map<string, string>();

  /** Set the hash for a node. */
  set(nodeId: string, hash: string): void {
    this.hashes.set(nodeId, hash);
  }

  /** Get the stored hash for a node (undefined if not cached). */
  get(nodeId: string): string | undefined {
    return this.hashes.get(nodeId);
  }

  /** Check if a node's hash matches (no change). */
  matches(nodeId: string, hash: string): boolean {
    return this.hashes.get(nodeId) === hash;
  }

  /** Remove a node from the cache. */
  delete(nodeId: string): void {
    this.hashes.delete(nodeId);
  }

  /** Clear the entire cache. */
  clear(): void {
    this.hashes.clear();
  }

  /** Number of cached hashes. */
  get size(): number {
    return this.hashes.size;
  }

  /**
   * Build a hash cache from existing storage nodes.
   * Call once at startup, then maintain incrementally.
   */
  static async fromStorage(storage: GraphStorage): Promise<NodeHashCache> {
    const cache = new NodeHashCache();
    const nodes = await storage.queryNodes({});
    for (const node of nodes) {
      cache.set(node.id, computeNodeHash(node));
    }
    return cache;
  }
}

/**
 * Perform an incremental sync: compare discovered nodes against cached hashes,
 * only upsert nodes that actually changed.
 */
export async function incrementalSync(
  storage: GraphStorage,
  discoveredNodes: GraphNodeInput[],
  discoveredEdges: GraphEdgeInput[],
  hashCache: NodeHashCache,
  options?: {
    /** Provider for marking disappeared nodes. */
    provider?: CloudProvider;
    /** Timestamp threshold for disappearance detection. */
    staleThreshold?: string;
    /** Batch size for upserts (default: 100). */
    batchSize?: number;
  },
): Promise<IncrementalSyncResult> {
  const startMs = Date.now();
  const batchSize = options?.batchSize ?? 100;

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let disappeared = 0;

  // Partition discovered nodes into create/update/skip
  const toUpsert: GraphNodeInput[] = [];
  const discoveredIds = new Set<string>();

  for (const node of discoveredNodes) {
    discoveredIds.add(node.id);
    const hash = computeNodeHash(node);

    if (hashCache.matches(node.id, hash)) {
      // Node unchanged — still update lastSeenAt
      skipped++;
      continue;
    }

    const existing = await storage.getNode(node.id);
    if (existing) {
      updated++;
    } else {
      created++;
    }

    toUpsert.push(node);
    hashCache.set(node.id, hash);
  }

  // Batch upsert changed nodes
  for (let i = 0; i < toUpsert.length; i += batchSize) {
    await storage.upsertNodes(toUpsert.slice(i, i + batchSize));
  }

  // Batch upsert edges
  for (let i = 0; i < discoveredEdges.length; i += batchSize) {
    await storage.upsertEdges(discoveredEdges.slice(i, i + batchSize));
  }

  // Mark disappeared nodes
  if (options?.staleThreshold) {
    const disappearedIds = await storage.markNodesDisappeared(
      options.staleThreshold,
      options.provider,
    );
    disappeared = disappearedIds.length;

    // Remove disappeared nodes from hash cache
    for (const id of disappearedIds) {
      hashCache.delete(id);
    }
  }

  return {
    created,
    updated,
    skipped,
    disappeared,
    edgesUpserted: discoveredEdges.length,
    durationMs: Date.now() - startMs,
  };
}
