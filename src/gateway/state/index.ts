/**
 * Enterprise Persistent State — Barrel Export
 *
 * Central export point for all persistent state stores.
 * Import from this module to access storage interfaces and implementations.
 *
 */

export {
  type RateLimitStore,
  type RateLimitBucket,
  type RateLimitConfig,
  InMemoryRateLimitStore,
  SQLiteRateLimitStore,
} from "./rate-limit-store.js";

export {
  type DedupStore,
  type DedupeEntry,
  InMemoryDedupStore,
  SQLiteDedupStore,
} from "./dedup-store.js";

export { DedupMapAdapter } from "./dedup-map-adapter.js";
