/**
 * Map-compatible adapter for DedupStore
 *
 * Wraps a DedupStore behind a Map<string, DedupeEntry>-compatible interface
 * so that the rest of the gateway code (server-methods, server-maintenance, etc.)
 * can use a persistent DedupStore without any type changes.
 *
 */

import type { DedupStore, DedupeEntry } from "./dedup-store.js";

/**
 * A Map-like wrapper around any DedupStore. Implements enough of the
 * Map<string, DedupeEntry> contract to satisfy all gateway consumers:
 *
 * - .get(key)
 * - .set(key, value)
 * - .has(key)
 * - .delete(key)
 * - .size (property)
 * - [Symbol.iterator]() / entries() — for-of iteration
 */
export class DedupMapAdapter implements Map<string, DedupeEntry> {
  constructor(private readonly store: DedupStore) {}

  get(key: string): DedupeEntry | undefined {
    return this.store.get(key) ?? undefined;
  }

  set(key: string, value: DedupeEntry): this {
    this.store.set(key, value);
    return this;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  get size(): number {
    return this.store.size();
  }

  clear(): void {
    // Iterate and delete all
    for (const [key] of this.store.entries()) {
      this.store.delete(key);
    }
  }

  forEach(
    callbackfn: (value: DedupeEntry, key: string, map: Map<string, DedupeEntry>) => void,
  ): void {
    for (const [key, value] of this.store.entries()) {
      callbackfn(value, key, this);
    }
  }

  *entries(): MapIterator<[string, DedupeEntry]> {
    yield* this.store.entries();
  }

  *keys(): MapIterator<string> {
    for (const [key] of this.store.entries()) {
      yield key;
    }
  }

  *values(): MapIterator<DedupeEntry> {
    for (const [, value] of this.store.entries()) {
      yield value;
    }
  }

  [Symbol.iterator](): MapIterator<[string, DedupeEntry]> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return "DedupMapAdapter";
  }
}
