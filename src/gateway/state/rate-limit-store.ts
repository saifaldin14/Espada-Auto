/**
 * Enterprise Persistent State — Rate Limit Store
 *
 * Abstraction layer for rate-limit bucket storage. Replaces the bare
 * module-level Map in server-http.ts with a pluggable interface.
 *
 * Provides InMemory (default, backwards-compatible) and SQLite
 * (persistent, multi-instance safe) implementations.
 *
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// =============================================================================
// Types
// =============================================================================

export type RateLimitBucket = {
  count: number;
  windowStart: number;
};

export type RateLimitConfig = {
  windowMs: number;
  maxRequests: number;
};

// =============================================================================
// Interface
// =============================================================================

/**
 * Storage interface for rate limit buckets.
 */
export interface RateLimitStore {
  /**
   * Check and increment the rate limit for a given key.
   * Returns true if the request is allowed, false if rate limited.
   */
  check(key: string, config: RateLimitConfig): boolean;

  /**
   * Reset the rate limit for a specific key.
   */
  reset(key: string): void;

  /**
   * Prune expired buckets. Returns count of pruned entries.
   */
  prune(config: RateLimitConfig): number;

  /**
   * Get current bucket count for a key (for response headers).
   */
  getRemaining(key: string, config: RateLimitConfig): number;

  /**
   * Close the store and release resources.
   */
  close(): void;
}

// =============================================================================
// In-Memory Rate Limit Store (default)
// =============================================================================

/**
 * In-memory rate limit store using Map. Backwards-compatible with the
 * existing bare Map implementation. No persistence across restarts.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, RateLimitBucket>();

  check(key: string, config: RateLimitConfig): boolean {
    if (config.maxRequests <= 0) return true;

    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || now - existing.windowStart >= config.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }

    existing.count += 1;
    return existing.count <= config.maxRequests;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  prune(config: RateLimitConfig): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= config.windowMs) {
        this.buckets.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  getRemaining(key: string, config: RateLimitConfig): number {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || now - existing.windowStart >= config.windowMs) {
      return config.maxRequests;
    }

    return Math.max(0, config.maxRequests - existing.count);
  }

  close(): void {
    this.buckets.clear();
  }
}

// =============================================================================
// SQLite Rate Limit Store (persistent, multi-instance safe)
// =============================================================================

/**
 * SQLite-backed rate limit store. Persists across restarts and supports
 * shared access from multiple gateway instances (via WAL mode + busy timeout).
 */
export class SQLiteRateLimitStore implements RateLimitStore {
  private db: Database.Database;
  private stmtCheck: Database.Statement;
  private stmtUpsert: Database.Statement;
  private stmtGet: Database.Statement;
  private stmtReset: Database.Statement;
  private stmtPrune: Database.Statement;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limit_buckets (
        key           TEXT PRIMARY KEY,
        count         INTEGER NOT NULL DEFAULT 0,
        window_start  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rate_limit_window
        ON rate_limit_buckets(window_start);
    `);

    // Pre-compile statements for performance
    this.stmtCheck = this.db.prepare(
      "SELECT count, window_start FROM rate_limit_buckets WHERE key = ?",
    );
    this.stmtUpsert = this.db.prepare(`
      INSERT INTO rate_limit_buckets (key, count, window_start)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        count = excluded.count,
        window_start = excluded.window_start
    `);
    this.stmtGet = this.db.prepare(
      "SELECT count, window_start FROM rate_limit_buckets WHERE key = ?",
    );
    this.stmtReset = this.db.prepare("DELETE FROM rate_limit_buckets WHERE key = ?");
    this.stmtPrune = this.db.prepare("DELETE FROM rate_limit_buckets WHERE window_start < ?");
  }

  check(key: string, config: RateLimitConfig): boolean {
    if (config.maxRequests <= 0) return true;

    const now = Date.now();
    const row = this.stmtCheck.get(key) as { count: number; window_start: number } | undefined;

    if (!row || now - row.window_start >= config.windowMs) {
      this.stmtUpsert.run(key, 1, now);
      return true;
    }

    const newCount = row.count + 1;
    this.stmtUpsert.run(key, newCount, row.window_start);
    return newCount <= config.maxRequests;
  }

  reset(key: string): void {
    this.stmtReset.run(key);
  }

  prune(config: RateLimitConfig): number {
    const cutoff = Date.now() - config.windowMs;
    const result = this.stmtPrune.run(cutoff);
    return result.changes;
  }

  getRemaining(key: string, config: RateLimitConfig): number {
    const now = Date.now();
    const row = this.stmtGet.get(key) as { count: number; window_start: number } | undefined;

    if (!row || now - row.window_start >= config.windowMs) {
      return config.maxRequests;
    }

    return Math.max(0, config.maxRequests - row.count);
  }

  close(): void {
    this.db.close();
  }
}
