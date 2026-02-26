/**
 * Azure Pagination Utilities — Unit Tests
 */

import { describe, it, expect } from "vitest";
import { collectPaged, collectAll, validatePagination } from "./pagination.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates an async iterable from an array (mimics Azure SDK paging). */
function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          return i < items.length
            ? { value: items[i++], done: false }
            : { value: undefined as any, done: true };
        },
      };
    },
  };
}

const identity = <T>(x: T): T => x;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectPaged", () => {
  it("returns all items when no pagination is provided", async () => {
    const result = await collectPaged(asyncIter([1, 2, 3, 4, 5]), identity);
    expect(result.items).toEqual([1, 2, 3, 4, 5]);
    expect(result.hasMore).toBe(false);
    expect(result.totalCount).toBe(5);
  });

  it("limits the number of returned items", async () => {
    const result = await collectPaged(asyncIter([1, 2, 3, 4, 5]), identity, undefined, { limit: 3 });
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.hasMore).toBe(true);
    // totalCount is undefined when we break early
    expect(result.totalCount).toBeUndefined();
  });

  it("returns all items when limit exceeds available", async () => {
    const result = await collectPaged(asyncIter([1, 2]), identity, undefined, { limit: 10 });
    expect(result.items).toEqual([1, 2]);
    expect(result.hasMore).toBe(false);
    expect(result.totalCount).toBe(2);
  });

  it("skips items with offset", async () => {
    const result = await collectPaged(asyncIter([1, 2, 3, 4, 5]), identity, undefined, { offset: 2 });
    expect(result.items).toEqual([3, 4, 5]);
    expect(result.hasMore).toBe(false);
  });

  it("combines limit and offset", async () => {
    const result = await collectPaged(asyncIter([1, 2, 3, 4, 5]), identity, undefined, { limit: 2, offset: 1 });
    expect(result.items).toEqual([2, 3]);
    expect(result.hasMore).toBe(true);
  });

  it("returns empty when offset exceeds items", async () => {
    const result = await collectPaged(asyncIter([1, 2, 3]), identity, undefined, { offset: 10 });
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it("applies map function", async () => {
    const result = await collectPaged(asyncIter([1, 2, 3]), (x) => x * 10);
    expect(result.items).toEqual([10, 20, 30]);
  });

  it("applies filter function", async () => {
    const result = await collectPaged(
      asyncIter([1, 2, 3, 4, 5]),
      identity,
      (x) => x % 2 === 0,
    );
    expect(result.items).toEqual([2, 4]);
    expect(result.hasMore).toBe(false);
    expect(result.totalCount).toBe(2);
  });

  it("applies filter with limit", async () => {
    const result = await collectPaged(
      asyncIter([1, 2, 3, 4, 5, 6]),
      identity,
      (x) => x % 2 === 0,
      { limit: 1 },
    );
    expect(result.items).toEqual([2]);
    expect(result.hasMore).toBe(true);
  });

  it("applies filter with offset and limit", async () => {
    const result = await collectPaged(
      asyncIter([1, 2, 3, 4, 5, 6, 7, 8]),
      identity,
      (x) => x % 2 === 0,
      { limit: 2, offset: 1 },
    );
    // Evens are [2, 4, 6, 8]. Skip 1 → [4, 6, 8]. Take 2 → [4, 6].
    expect(result.items).toEqual([4, 6]);
    expect(result.hasMore).toBe(true);
  });

  it("handles empty iterator", async () => {
    const result = await collectPaged(asyncIter([]), identity);
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.totalCount).toBe(0);
  });

  it("handles limit of 0", async () => {
    const result = await collectPaged(asyncIter([1, 2, 3]), identity, undefined, { limit: 0 });
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(true);
  });
});

describe("collectAll", () => {
  it("returns a flat array of all items", async () => {
    const items = await collectAll(asyncIter([1, 2, 3]), identity);
    expect(items).toEqual([1, 2, 3]);
  });

  it("applies map and filter", async () => {
    const items = await collectAll(
      asyncIter([1, 2, 3, 4]),
      (x) => x * 2,
      (x) => x > 4,
    );
    expect(items).toEqual([6, 8]);
  });

  it("returns empty array for empty iterator", async () => {
    const items = await collectAll(asyncIter([]), identity);
    expect(items).toEqual([]);
  });
});

describe("validatePagination", () => {
  it("accepts undefined pagination", () => {
    expect(() => validatePagination(undefined)).not.toThrow();
  });

  it("accepts valid limit and offset", () => {
    expect(() => validatePagination({ limit: 10, offset: 5 })).not.toThrow();
  });

  it("accepts zero limit", () => {
    expect(() => validatePagination({ limit: 0 })).not.toThrow();
  });

  it("accepts zero offset", () => {
    expect(() => validatePagination({ offset: 0 })).not.toThrow();
  });

  it("rejects negative limit", () => {
    expect(() => validatePagination({ limit: -1 })).toThrow("Invalid limit: -1");
  });

  it("rejects negative offset", () => {
    expect(() => validatePagination({ offset: -3 })).toThrow("Invalid offset: -3");
  });

  it("rejects NaN limit", () => {
    expect(() => validatePagination({ limit: NaN })).toThrow("Invalid limit: NaN");
  });

  it("rejects NaN offset", () => {
    expect(() => validatePagination({ offset: NaN })).toThrow("Invalid offset: NaN");
  });

  it("rejects Infinity limit", () => {
    expect(() => validatePagination({ limit: Infinity })).toThrow("Invalid limit: Infinity");
  });

  it("rejects fractional limit", () => {
    expect(() => validatePagination({ limit: 2.5 })).toThrow("Invalid limit: 2.5");
  });

  it("rejects fractional offset", () => {
    expect(() => validatePagination({ offset: 1.7 })).toThrow("Invalid offset: 1.7");
  });
});

describe("collectPaged validation integration", () => {
  it("throws on negative limit", async () => {
    await expect(
      collectPaged(asyncIter([1, 2, 3]), identity, undefined, { limit: -1 }),
    ).rejects.toThrow("Invalid limit");
  });

  it("throws on NaN offset", async () => {
    await expect(
      collectPaged(asyncIter([1, 2, 3]), identity, undefined, { limit: 5, offset: NaN }),
    ).rejects.toThrow("Invalid offset");
  });
});
