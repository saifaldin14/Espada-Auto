/**
 * Unit tests for enterprise persistent state stores and DedupMapAdapter.
 *
 * Covers: InMemoryDedupStore, SQLiteDedupStore, DedupMapAdapter,
 *         InMemoryRateLimitStore, SQLiteRateLimitStore
 *
 */

import { describe, it, expect, afterEach } from "vitest";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  InMemoryDedupStore,
  SQLiteDedupStore,
  InMemoryRateLimitStore,
  SQLiteRateLimitStore,
  DedupMapAdapter,
} from "./index.js";
import type { DedupeEntry } from "./dedup-store.js";

function tmpDb(name: string): string {
  const dir = join(tmpdir(), "espada-test-state");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${name}-${randomUUID()}.db`);
}

function cleanup(path: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(path + suffix);
    } catch {
      /* ignore */
    }
  }
}

// =============================================================================
// DedupStore — InMemory
// =============================================================================

describe("InMemoryDedupStore", () => {
  it("stores and retrieves entries", () => {
    const store = new InMemoryDedupStore();
    const entry: DedupeEntry = { ts: Date.now(), ok: true, payload: { id: 1 } };
    store.set("key1", entry);

    expect(store.has("key1")).toBe(true);
    expect(store.get("key1")).toEqual(entry);
    expect(store.size()).toBe(1);
  });

  it("returns null for missing keys", () => {
    const store = new InMemoryDedupStore();
    expect(store.get("missing")).toBeNull();
    expect(store.has("missing")).toBe(false);
  });

  it("deletes entries", () => {
    const store = new InMemoryDedupStore();
    store.set("key1", { ts: Date.now(), ok: true });

    expect(store.delete("key1")).toBe(true);
    expect(store.has("key1")).toBe(false);
    expect(store.delete("nonexistent")).toBe(false);
  });

  it("prunes expired entries", () => {
    const store = new InMemoryDedupStore();
    const old = Date.now() - 10_000;
    const recent = Date.now();

    store.set("old1", { ts: old, ok: true });
    store.set("old2", { ts: old, ok: true });
    store.set("recent", { ts: recent, ok: true });

    const pruned = store.prune(5_000, 100);
    expect(pruned).toBe(2);
    expect(store.size()).toBe(1);
    expect(store.has("recent")).toBe(true);
  });

  it("prunes to max entries", () => {
    const store = new InMemoryDedupStore();
    for (let i = 0; i < 10; i++) {
      store.set(`key${i}`, { ts: Date.now() + i, ok: true });
    }

    store.prune(999_999, 5); // TTL won't expire anything, but maxEntries = 5
    expect(store.size()).toBe(5);
  });

  it("iterates entries", () => {
    const store = new InMemoryDedupStore();
    store.set("a", { ts: 1, ok: true });
    store.set("b", { ts: 2, ok: false });

    const entries = [...store.entries()];
    expect(entries).toHaveLength(2);
    expect(entries.map(([k]) => k).sort()).toEqual(["a", "b"]);
  });
});

// =============================================================================
// DedupStore — SQLite
// =============================================================================

describe("SQLiteDedupStore", () => {
  let dbPath: string;
  let store: SQLiteDedupStore;

  afterEach(() => {
    store?.close();
    if (dbPath) cleanup(dbPath);
  });

  it("stores and retrieves entries with payload", () => {
    dbPath = tmpDb("dedup");
    store = new SQLiteDedupStore(dbPath);

    const entry: DedupeEntry = {
      ts: Date.now(),
      ok: true,
      payload: { message: "hello" },
    };
    store.set("key1", entry);

    const result = store.get("key1");
    expect(result).not.toBeNull();
    expect(result!.ts).toBe(entry.ts);
    expect(result!.ok).toBe(true);
    expect(result!.payload).toEqual({ message: "hello" });
  });

  it("stores and retrieves entries with error", () => {
    dbPath = tmpDb("dedup-err");
    store = new SQLiteDedupStore(dbPath);

    const entry: DedupeEntry = {
      ts: Date.now(),
      ok: false,
      error: { code: "00-1", message: "fail" },
    };
    store.set("err1", entry);

    const result = store.get("err1");
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    expect(result!.error).toEqual({ code: "00-1", message: "fail" });
  });

  it("upserts entries (on conflict update)", () => {
    dbPath = tmpDb("dedup-upsert");
    store = new SQLiteDedupStore(dbPath);

    store.set("key1", { ts: 100, ok: true });
    store.set("key1", { ts: 200, ok: false });

    expect(store.size()).toBe(1);
    expect(store.get("key1")!.ts).toBe(200);
    expect(store.get("key1")!.ok).toBe(false);
  });

  it("prunes expired entries from SQLite", () => {
    dbPath = tmpDb("dedup-prune");
    store = new SQLiteDedupStore(dbPath);

    const old = Date.now() - 10_000;
    store.set("old1", { ts: old, ok: true });
    store.set("old2", { ts: old, ok: true });
    store.set("recent", { ts: Date.now(), ok: true });

    const pruned = store.prune(5_000, 100);
    expect(pruned).toBe(2);
    expect(store.size()).toBe(1);
  });

  it("iterates entries in timestamp order", () => {
    dbPath = tmpDb("dedup-iter");
    store = new SQLiteDedupStore(dbPath);

    store.set("b", { ts: 2, ok: true });
    store.set("a", { ts: 1, ok: true });
    store.set("c", { ts: 3, ok: true });

    const entries = [...store.entries()];
    expect(entries.map(([k]) => k)).toEqual(["a", "b", "c"]); // ordered by ts ASC
  });

  it("persists across close and reopen", () => {
    dbPath = tmpDb("dedup-persist");
    store = new SQLiteDedupStore(dbPath);
    store.set("persist", { ts: 42, ok: true });
    store.close();

    const store2 = new SQLiteDedupStore(dbPath);
    expect(store2.get("persist")!.ts).toBe(42);
    store2.close();
  });
});

// =============================================================================
// DedupMapAdapter
// =============================================================================

describe("DedupMapAdapter", () => {
  it("implements Map.get/set/has/delete", () => {
    const store = new InMemoryDedupStore();
    const map: Map<string, DedupeEntry> = new DedupMapAdapter(store);

    const entry: DedupeEntry = { ts: Date.now(), ok: true };
    map.set("k", entry);

    expect(map.has("k")).toBe(true);
    expect(map.get("k")).toEqual(entry);
    expect(map.size).toBe(1);

    map.delete("k");
    expect(map.has("k")).toBe(false);
    expect(map.size).toBe(0);
  });

  it("get returns undefined for missing keys (Map contract)", () => {
    const adapter = new DedupMapAdapter(new InMemoryDedupStore());
    expect(adapter.get("nope")).toBeUndefined();
  });

  it("supports for-of iteration", () => {
    const store = new InMemoryDedupStore();
    const map = new DedupMapAdapter(store);
    map.set("x", { ts: 1, ok: true });
    map.set("y", { ts: 2, ok: false });

    const keys: string[] = [];
    for (const [k] of map) {
      keys.push(k);
    }
    expect(keys.sort()).toEqual(["x", "y"]);
  });

  it("supports entries(), keys(), values()", () => {
    const map = new DedupMapAdapter(new InMemoryDedupStore());
    map.set("a", { ts: 10, ok: true });

    expect([...map.entries()]).toHaveLength(1);
    expect([...map.keys()]).toEqual(["a"]);
    expect([...map.values()]).toHaveLength(1);
    expect([...map.values()][0].ts).toBe(10);
  });

  it("forEach works", () => {
    const map = new DedupMapAdapter(new InMemoryDedupStore());
    map.set("z", { ts: 99, ok: true });

    const collected: string[] = [];
    map.forEach((_v, k) => collected.push(k));
    expect(collected).toEqual(["z"]);
  });

  it("works with SQLiteDedupStore backend", () => {
    const dbPath = tmpDb("adapter-sqlite");
    const store = new SQLiteDedupStore(dbPath);
    const map: Map<string, DedupeEntry> = new DedupMapAdapter(store);

    map.set("sqlite-key", { ts: Date.now(), ok: true, payload: { x: 1 } });
    expect(map.has("sqlite-key")).toBe(true);
    expect(map.get("sqlite-key")!.payload).toEqual({ x: 1 });
    expect(map.size).toBe(1);

    store.close();
    cleanup(dbPath);
  });
});

// =============================================================================
// RateLimitStore — InMemory
// =============================================================================

describe("InMemoryRateLimitStore", () => {
  it("allows requests within limit", () => {
    const store = new InMemoryRateLimitStore();
    const cfg = { windowMs: 60_000, maxRequests: 3 };

    expect(store.check("ip1", cfg)).toBe(true);
    expect(store.check("ip1", cfg)).toBe(true);
    expect(store.check("ip1", cfg)).toBe(true);
  });

  it("blocks requests over limit", () => {
    const store = new InMemoryRateLimitStore();
    const cfg = { windowMs: 60_000, maxRequests: 2 };

    store.check("ip1", cfg);
    store.check("ip1", cfg);
    expect(store.check("ip1", cfg)).toBe(false);
  });

  it("tracks keys independently", () => {
    const store = new InMemoryRateLimitStore();
    const cfg = { windowMs: 60_000, maxRequests: 1 };

    expect(store.check("a", cfg)).toBe(true);
    expect(store.check("b", cfg)).toBe(true);
    expect(store.check("a", cfg)).toBe(false);
    expect(store.check("b", cfg)).toBe(false);
  });

  it("reports remaining count", () => {
    const store = new InMemoryRateLimitStore();
    const cfg = { windowMs: 60_000, maxRequests: 5 };

    store.check("ip1", cfg);
    store.check("ip1", cfg);
    expect(store.getRemaining("ip1", cfg)).toBe(3);
  });

  it("resets a specific key", () => {
    const store = new InMemoryRateLimitStore();
    const cfg = { windowMs: 60_000, maxRequests: 1 };

    store.check("ip1", cfg);
    expect(store.check("ip1", cfg)).toBe(false);

    store.reset("ip1");
    expect(store.check("ip1", cfg)).toBe(true);
  });
});

// =============================================================================
// RateLimitStore — SQLite
// =============================================================================

describe("SQLiteRateLimitStore", () => {
  let dbPath: string;
  let store: SQLiteRateLimitStore;

  afterEach(() => {
    store?.close();
    if (dbPath) cleanup(dbPath);
  });

  it("allows and blocks requests correctly", () => {
    dbPath = tmpDb("rl");
    store = new SQLiteRateLimitStore(dbPath);
    const cfg = { windowMs: 60_000, maxRequests: 2 };

    expect(store.check("ip1", cfg)).toBe(true);
    expect(store.check("ip1", cfg)).toBe(true);
    expect(store.check("ip1", cfg)).toBe(false);
  });

  it("tracks keys independently in SQLite", () => {
    dbPath = tmpDb("rl-keys");
    store = new SQLiteRateLimitStore(dbPath);
    const cfg = { windowMs: 60_000, maxRequests: 1 };

    expect(store.check("x", cfg)).toBe(true);
    expect(store.check("y", cfg)).toBe(true);
    expect(store.check("x", cfg)).toBe(false);
  });

  it("reports remaining count", () => {
    dbPath = tmpDb("rl-remaining");
    store = new SQLiteRateLimitStore(dbPath);
    const cfg = { windowMs: 60_000, maxRequests: 10 };

    store.check("ip1", cfg);
    store.check("ip1", cfg);
    store.check("ip1", cfg);
    expect(store.getRemaining("ip1", cfg)).toBe(7);
  });

  it("persists across close and reopen", () => {
    dbPath = tmpDb("rl-persist");
    store = new SQLiteRateLimitStore(dbPath);
    const cfg = { windowMs: 60_000, maxRequests: 2 };

    store.check("ip1", cfg);
    store.check("ip1", cfg);
    store.close();

    const store2 = new SQLiteRateLimitStore(dbPath);
    // Third request should fail because state persisted
    expect(store2.check("ip1", cfg)).toBe(false);
    store2.close();
    store = undefined!; // prevent afterEach double-close
  });
});
