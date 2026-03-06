/**
 * Cloud Adapter Validators — Tests
 *
 * Tests for the runtime validators and ManagerCache that replace
 * unsafe `as unknown` casts at cloud SDK boundaries.
 */

import { describe, it, expect } from "vitest";
import {
  safeArray,
  safeRecord,
  safeNumber,
  safeString,
  safeBool,
  ManagerCache,
  extractArray,
  extractRecord,
  toRecord,
  extractNumber,
  extractString,
} from "../../src/adapters/validators.js";

// =============================================================================
// safeArray
// =============================================================================

describe("safeArray", () => {
  it("should return the array when given an array", () => {
    expect(safeArray([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("should return empty array for null", () => {
    expect(safeArray(null)).toEqual([]);
  });

  it("should return empty array for undefined", () => {
    expect(safeArray(undefined)).toEqual([]);
  });

  it("should return empty array for a string", () => {
    expect(safeArray("not-an-array")).toEqual([]);
  });

  it("should return empty array for a number", () => {
    expect(safeArray(42)).toEqual([]);
  });

  it("should return empty array for an object", () => {
    expect(safeArray({ a: 1 })).toEqual([]);
  });

  it("should return empty array for empty array", () => {
    expect(safeArray([])).toEqual([]);
  });
});

// =============================================================================
// safeRecord
// =============================================================================

describe("safeRecord", () => {
  it("should return the object when given a plain object", () => {
    const obj = { a: 1, b: "two" };
    expect(safeRecord(obj)).toEqual(obj);
  });

  it("should return empty record for null", () => {
    expect(safeRecord(null)).toEqual({});
  });

  it("should return empty record for undefined", () => {
    expect(safeRecord(undefined)).toEqual({});
  });

  it("should return empty record for an array", () => {
    expect(safeRecord([1, 2])).toEqual({});
  });

  it("should return empty record for a string", () => {
    expect(safeRecord("hello")).toEqual({});
  });

  it("should return empty record for a number", () => {
    expect(safeRecord(42)).toEqual({});
  });

  it("should handle nested objects", () => {
    const obj = { nested: { deep: true } };
    expect(safeRecord(obj)).toEqual(obj);
  });
});

// =============================================================================
// safeNumber
// =============================================================================

describe("safeNumber", () => {
  it("should return the number when given a number", () => {
    expect(safeNumber(42)).toBe(42);
  });

  it("should return 0 for NaN", () => {
    expect(safeNumber(NaN)).toBe(0);
  });

  it("should return fallback for null", () => {
    expect(safeNumber(null, -1)).toBe(-1);
  });

  it("should return fallback for undefined", () => {
    expect(safeNumber(undefined)).toBe(0);
  });

  it("should parse numeric strings", () => {
    expect(safeNumber("3.14")).toBe(3.14);
  });

  it("should return fallback for non-numeric strings", () => {
    expect(safeNumber("abc", 99)).toBe(99);
  });

  it("should handle zero", () => {
    expect(safeNumber(0)).toBe(0);
  });

  it("should handle negative numbers", () => {
    expect(safeNumber(-5)).toBe(-5);
  });

  it("should handle Infinity", () => {
    expect(safeNumber(Infinity)).toBe(Infinity);
  });
});

// =============================================================================
// safeString
// =============================================================================

describe("safeString", () => {
  it("should return the string when given a string", () => {
    expect(safeString("hello")).toBe("hello");
  });

  it("should return empty for null", () => {
    expect(safeString(null)).toBe("");
  });

  it("should return empty for undefined", () => {
    expect(safeString(undefined)).toBe("");
  });

  it("should return fallback for a number", () => {
    expect(safeString(42, "fallback")).toBe("fallback");
  });

  it("should handle empty string", () => {
    expect(safeString("")).toBe("");
  });
});

// =============================================================================
// safeBool
// =============================================================================

describe("safeBool", () => {
  it("should return true for true", () => {
    expect(safeBool(true)).toBe(true);
  });

  it("should return false for false", () => {
    expect(safeBool(false)).toBe(false);
  });

  it("should return fallback for null", () => {
    expect(safeBool(null, true)).toBe(true);
  });

  it("should return fallback for undefined", () => {
    expect(safeBool(undefined)).toBe(false);
  });

  it("should return fallback for a string", () => {
    expect(safeBool("true", false)).toBe(false);
  });
});

// =============================================================================
// ManagerCache
// =============================================================================

describe("ManagerCache", () => {
  it("should create and cache a manager via factory", async () => {
    const cache = new ManagerCache();
    let callCount = 0;

    const result = await cache.getOrCreate("test", async () => {
      callCount++;
      return { name: "TestManager" };
    });

    expect(result).toEqual({ name: "TestManager" });
    expect(callCount).toBe(1);

    // Second call should return cached value
    const result2 = await cache.getOrCreate("test", async () => {
      callCount++;
      return { name: "DifferentManager" };
    });

    expect(result2).toEqual({ name: "TestManager" });
    expect(callCount).toBe(1); // Factory not called again
  });

  it("should use injected manager instead of factory", async () => {
    const cache = new ManagerCache();
    const injected = { name: "InjectedManager" };

    const result = await cache.getOrCreate(
      "test",
      async () => ({ name: "FactoryManager" }),
      injected,
    );

    expect(result).toEqual(injected);
  });

  it("should return null when factory throws", async () => {
    const cache = new ManagerCache();

    const result = await cache.getOrCreate("test", async () => {
      throw new Error("SDK not available");
    });

    expect(result).toBeNull();
  });

  it("should cache null on factory failure and not retry", async () => {
    const cache = new ManagerCache();
    let callCount = 0;

    await cache.getOrCreate("test", async () => {
      callCount++;
      throw new Error("fail");
    });

    const result2 = await cache.getOrCreate("test", async () => {
      callCount++;
      return { name: "recovered" };
    });

    expect(result2).toBeNull();
    expect(callCount).toBe(1); // Factory only called once
  });

  it("should track separate keys independently", async () => {
    const cache = new ManagerCache();

    await cache.getOrCreate("a", async () => "manager-a");
    await cache.getOrCreate("b", async () => "manager-b");

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(false);
  });

  it("should clear all cached managers", async () => {
    const cache = new ManagerCache();

    await cache.getOrCreate("a", async () => "manager-a");
    await cache.getOrCreate("b", async () => "manager-b");

    cache.clear();

    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(false);
  });

  it("should not use injected when it is undefined", async () => {
    const cache = new ManagerCache();

    const result = await cache.getOrCreate(
      "test",
      async () => "from-factory",
      undefined,
    );

    expect(result).toBe("from-factory");
  });
});

// =============================================================================
// extractArray / extractRecord / toRecord / extractNumber / extractString
// =============================================================================

describe("extractArray", () => {
  it("should extract an array field from an object", () => {
    expect(extractArray({ items: [1, 2] }, "items")).toEqual([1, 2]);
  });

  it("should return empty array for missing field", () => {
    expect(extractArray({}, "items")).toEqual([]);
  });

  it("should return empty array for non-array field", () => {
    expect(extractArray({ items: "not-array" }, "items")).toEqual([]);
  });
});

describe("extractRecord", () => {
  it("should extract a record field from an object", () => {
    const obj = { config: { key: "value" } };
    expect(extractRecord(obj, "config")).toEqual({ key: "value" });
  });

  it("should return empty record for missing field", () => {
    expect(extractRecord({}, "config")).toEqual({});
  });
});

describe("toRecord", () => {
  it("should wrap a plain object as a record", () => {
    const obj = { a: 1 };
    expect(toRecord(obj)).toEqual({ a: 1 });
  });

  it("should return empty record for non-object", () => {
    expect(toRecord(42)).toEqual({});
  });

  it("should return empty record for null", () => {
    expect(toRecord(null)).toEqual({});
  });
});

describe("extractNumber", () => {
  it("should extract a numeric field", () => {
    expect(extractNumber({ count: 42 }, "count")).toBe(42);
  });

  it("should return fallback for missing field", () => {
    expect(extractNumber({}, "count", -1)).toBe(-1);
  });
});

describe("extractString", () => {
  it("should extract a string field", () => {
    expect(extractString({ name: "test" }, "name")).toBe("test");
  });

  it("should return fallback for missing field", () => {
    expect(extractString({}, "name", "default")).toBe("default");
  });
});
