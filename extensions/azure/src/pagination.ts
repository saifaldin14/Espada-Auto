/**
 * Azure Pagination Utilities
 *
 * Shared helpers for paginating Azure SDK async iterators.
 * All Azure SDK list methods return PagedAsyncIterableIterator;
 * these helpers break iteration at a caller-defined limit and
 * return AzurePagedResult with hasMore / totalCount metadata.
 */

import type { AzurePagedResult, AzurePaginationOptions } from "./types.js";

/**
 * Validate pagination options. Throws if limit or offset is negative, NaN,
 * or not a finite integer.
 */
export function validatePagination(pagination?: AzurePaginationOptions): void {
  if (!pagination) return;
  const { limit, offset } = pagination;
  if (limit !== undefined) {
    if (!Number.isFinite(limit) || limit < 0 || !Number.isInteger(limit)) {
      throw new Error(`Invalid limit: ${limit}. Must be a non-negative integer.`);
    }
  }
  if (offset !== undefined) {
    if (!Number.isFinite(offset) || offset < 0 || !Number.isInteger(offset)) {
      throw new Error(`Invalid offset: ${offset}. Must be a non-negative integer.`);
    }
  }
}

/**
 * Collect items from an async iterable with pagination support.
 *
 * When `limit` is provided, stops collecting after that many items
 * (after skipping `offset` items) and sets `hasMore = true` if the
 * iterator had more items available.
 *
 * When no pagination options are given, exhausts the iterator and
 * returns all items (equivalent to `Array.fromAsync`).
 *
 * @param iterator   Any async iterable (Azure SDK paging iterator).
 * @param mapFn      Transform each raw SDK item to the domain type.
 * @param filterFn   Optional predicate applied after mapping (in-memory filter).
 * @param pagination Optional limit/offset pagination.
 */
export async function collectPaged<TRaw, TOut>(
  iterator: AsyncIterable<TRaw>,
  mapFn: (item: TRaw) => TOut,
  filterFn?: (item: TOut) => boolean,
  pagination?: AzurePaginationOptions,
): Promise<AzurePagedResult<TOut>> {
  validatePagination(pagination);
  const limit = pagination?.limit;
  const offset = pagination?.offset ?? 0;

  const items: TOut[] = [];
  let totalSeen = 0;
  let skipped = 0;
  let hasMore = false;

  for await (const raw of iterator) {
    const mapped = mapFn(raw);

    // Apply in-memory filter
    if (filterFn && !filterFn(mapped)) continue;

    totalSeen++;

    // Skip `offset` items
    if (skipped < offset) {
      skipped++;
      continue;
    }

    // Collect up to `limit` items
    if (limit !== undefined && items.length >= limit) {
      // We've already collected enough — at least one more exists
      hasMore = true;
      break;
    }

    items.push(mapped);
  }

  // If we didn't break early, we exhausted the iterator
  // totalSeen may not reflect the true total if we broke early
  return {
    items,
    hasMore,
    totalCount: hasMore ? undefined : totalSeen,
  };
}

/**
 * Convenience overload: collect all items without pagination.
 * Returns a plain array (backward-compatible with existing callers).
 */
export async function collectAll<TRaw, TOut>(
  iterator: AsyncIterable<TRaw>,
  mapFn: (item: TRaw) => TOut,
  filterFn?: (item: TOut) => boolean,
): Promise<TOut[]> {
  const result = await collectPaged(iterator, mapFn, filterFn);
  return result.items;
}
