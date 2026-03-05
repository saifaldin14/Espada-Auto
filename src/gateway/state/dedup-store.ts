/**
 * Enterprise Persistent State — Dedup Store
 *
 * Abstraction layer for idempotency/dedup storage. Replaces the bare
 * module-level Map in server-runtime-state.ts with a pluggable interface.
 *
 * Provides InMemory (default, backwards-compatible) and SQLite
 * (persistent, multi-instance safe) implementations.
 *
 */

import type { ErrorShape } from "../protocol/index.js";
import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// =============================================================================
// Types
// =============================================================================

export type DedupeEntry = {
  ts: number;
  ok: boolean;
  payload?: unknown;
  error?: ErrorShape;
};

// =============================================================================
// Interface
// =============================================================================

/**
 * Storage interface for idempotency/dedup entries.
 */
export interface DedupStore {
  /**
   * Get a dedup entry by key. Returns null if not found.
   */
  get(key: string): DedupeEntry | null;

  /**
   * Set a dedup entry.
   */
  set(key: string, entry: DedupeEntry): void;

  /**
   * Check if a key exists.
   */
  has(key: string): boolean;

  /**
   * Delete a dedup entry.
   */
  delete(key: string): boolean;

  /**
   * Get the current size (number of entries).
   */
  size(): number;

  /**
   * Prune entries older than ttlMs. If remaining entries exceed maxEntries,
   * evict oldest. Returns count of pruned entries.
   */
  prune(ttlMs: number, maxEntries: number): number;

  /**
   * Iterate over all entries (for migration/export).
   */
  entries(): Iterable<[string, DedupeEntry]>;

  /**
   * Close the store and release resources.
   */
  close(): void;
}

// =============================================================================
// In-Memory Dedup Store (default)
// =============================================================================

/**
 * In-memory dedup store using Map. Backwards-compatible with the existing
 * bare Map implementation.
 */
export class InMemoryDedupStore implements DedupStore {
  private map = new Map<string, DedupeEntry>();

  get(key: string): DedupeEntry | null {
    return this.map.get(key) ?? null;
  }

  set(key: string, entry: DedupeEntry): void {
    this.map.set(key, entry);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  size(): number {
    return this.map.size;
  }

  prune(ttlMs: number, maxEntries: number): number {
    const now = Date.now();
    let pruned = 0;

    // Remove expired entries
    for (const [key, entry] of this.map) {
      if (now - entry.ts > ttlMs) {
        this.map.delete(key);
        pruned++;
      }
    }

    // Evict oldest if over capacity
    if (this.map.size > maxEntries) {
      const sorted = [...this.map.entries()].sort((a, b) => a[1].ts - b[1].ts);
      const toEvict = this.map.size - maxEntries;
      for (let i = 0; i < toEvict; i++) {
        this.map.delete(sorted[i][0]);
        pruned++;
      }
    }

    return pruned;
  }

  entries(): Iterable<[string, DedupeEntry]> {
    return this.map.entries();
  }

  close(): void {
    this.map.clear();
  }
}

// =============================================================================
// SQLite Dedup Store (persistent, multi-instance safe)
// =============================================================================

/**
 * SQLite-backed dedup store. Persists across restarts and supports
 * shared access from multiple gateway instances.
 */
export class SQLiteDedupStore implements DedupStore {
  private db: Database.Database;
  private stmtGet: Database.Statement;
  private stmtSet: Database.Statement;
  private stmtHas: Database.Statement;
  private stmtDelete: Database.Statement;
  private stmtSize: Database.Statement;
  private stmtPruneExpired: Database.Statement;
  private stmtAll: Database.Statement;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dedup_entries (
        key     TEXT PRIMARY KEY,
        ts      INTEGER NOT NULL,
        ok      INTEGER NOT NULL DEFAULT 1,
        payload TEXT DEFAULT NULL,
        error   TEXT DEFAULT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_dedup_ts
        ON dedup_entries(ts);
    `);

    this.stmtGet = this.db.prepare("SELECT * FROM dedup_entries WHERE key = ?");
    this.stmtSet = this.db.prepare(`
      INSERT INTO dedup_entries (key, ts, ok, payload, error)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        ts = excluded.ts,
        ok = excluded.ok,
        payload = excluded.payload,
        error = excluded.error
    `);
    this.stmtHas = this.db.prepare("SELECT 1 FROM dedup_entries WHERE key = ?");
    this.stmtDelete = this.db.prepare("DELETE FROM dedup_entries WHERE key = ?");
    this.stmtSize = this.db.prepare("SELECT COUNT(*) as count FROM dedup_entries");
    this.stmtPruneExpired = this.db.prepare("DELETE FROM dedup_entries WHERE ts < ?");
    this.stmtAll = this.db.prepare("SELECT * FROM dedup_entries ORDER BY ts ASC");
  }

  get(key: string): DedupeEntry | null {
    const row = this.stmtGet.get(key) as DedupRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  set(key: string, entry: DedupeEntry): void {
    this.stmtSet.run(
      key,
      entry.ts,
      entry.ok ? 1 : 0,
      entry.payload !== undefined ? JSON.stringify(entry.payload) : null,
      entry.error !== undefined ? JSON.stringify(entry.error) : null,
    );
  }

  has(key: string): boolean {
    return this.stmtHas.get(key) !== undefined;
  }

  delete(key: string): boolean {
    const result = this.stmtDelete.run(key);
    return result.changes > 0;
  }

  size(): number {
    const row = this.stmtSize.get() as { count: number };
    return row.count;
  }

  prune(ttlMs: number, maxEntries: number): number {
    const cutoff = Date.now() - ttlMs;
    let pruned = 0;

    // Remove expired entries
    const result = this.stmtPruneExpired.run(cutoff);
    pruned += result.changes;

    // Evict oldest if over capacity
    const currentSize = this.size();
    if (currentSize > maxEntries) {
      const toEvict = currentSize - maxEntries;
      const evictResult = this.db
        .prepare(
          `DELETE FROM dedup_entries WHERE key IN (
            SELECT key FROM dedup_entries ORDER BY ts ASC LIMIT ?
          )`,
        )
        .run(toEvict);
      pruned += evictResult.changes;
    }

    return pruned;
  }

  *entries(): Iterable<[string, DedupeEntry]> {
    const rows = this.stmtAll.all() as DedupRow[];
    for (const row of rows) {
      yield [row.key, rowToEntry(row)];
    }
  }

  close(): void {
    this.db.close();
  }
}

// =============================================================================
// Row types and converters
// =============================================================================

type DedupRow = {
  key: string;
  ts: number;
  ok: number;
  payload: string | null;
  error: string | null;
};

function rowToEntry(row: DedupRow): DedupeEntry {
  return {
    ts: row.ts,
    ok: row.ok === 1,
    payload: (() => {
      try {
        return row.payload ? JSON.parse(row.payload) : undefined;
      } catch {
        return undefined;
      }
    })(),
    error: (() => {
      try {
        return row.error ? JSON.parse(row.error) : undefined;
      } catch {
        return undefined;
      }
    })(),
  };
}
