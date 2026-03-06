/**
 * Runtime Validators for Cloud Adapter Boundaries
 *
 * Replaces unsafe `as unknown` casts with type guards and runtime
 * validation at every SDK response boundary. This prevents type-lies
 * from propagating through the system when cloud SDK responses change
 * shape unexpectedly.
 */

// =============================================================================
// Primitive Extractors
// =============================================================================

/**
 * Safely extract an array from an unknown value.
 * Returns an empty array if the value is not iterable.
 */
export function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Safely extract a record from an unknown value.
 * Returns an empty record if the value is not an object.
 */
export function safeRecord(value: unknown): Record<string, unknown> {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Safely extract a number from an unknown value.
 * Returns the fallback (default 0) if the value is not numeric.
 */
export function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

/**
 * Safely extract a string from an unknown value.
 * Returns the fallback (default "") if the value is not a string.
 */
export function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Safely extract a boolean from an unknown value.
 */
export function safeBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// =============================================================================
// Manager Cache — Type-safe Lazy-Loading Cache
// =============================================================================

/**
 * A type-safe cache for lazily-loaded cloud SDK managers.
 *
 * Eliminates the `this._field as unknown | null` identity-cast pattern
 * used across all AWS/Azure adapter managers. Each manager is stored
 * once and returned without any `as unknown` cast on subsequent calls.
 *
 * Usage:
 *   private managers = new ManagerCache();
 *
 *   private async getVMManager(): Promise<unknown | null> {
 *     return this.managers.getOrCreate('vm', async () => {
 *       // ... dynamic import + factory logic ...
 *       return createdManager;
 *     }, this.config.managers?.vm);
 *   }
 */
export class ManagerCache {
  private cache = new Map<string, unknown | null>();

  /**
   * Get a cached manager or create it via the factory.
   *
   * @param key — Unique identifier for this manager (e.g., "vm", "cost")
   * @param factory — Async factory that creates the manager on first call
   * @param injected — Optional pre-injected manager (from config.managers)
   * @returns The manager instance or null if unavailable
   */
  async getOrCreate(
    key: string,
    factory: () => Promise<unknown>,
    injected?: unknown,
  ): Promise<unknown | null> {
    // Return from cache if already resolved
    if (this.cache.has(key)) {
      return this.cache.get(key) ?? null;
    }

    // Use injected manager if provided
    if (injected !== undefined) {
      this.cache.set(key, injected);
      return injected;
    }

    // Try the factory, cache null on failure
    try {
      const manager = await factory();
      this.cache.set(key, manager);
      return manager;
    } catch {
      this.cache.set(key, null);
      return null;
    }
  }

  /**
   * Check if a manager has been resolved (even to null).
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Clear the cache (useful for testing or reconnection).
   */
  clear(): void {
    this.cache.clear();
  }
}

// =============================================================================
// SDK Response Validators — Cloud-specific
// =============================================================================

/**
 * Validate and extract an array property from an SDK response object.
 * This replaces the pattern: `props["field"] as unknown[]`
 *
 * @param obj — The SDK response object
 * @param field — The property name to extract
 * @returns The array if present and valid, or an empty array
 */
export function extractArray(
  obj: Record<string, unknown>,
  field: string,
): unknown[] {
  return safeArray(obj[field]);
}

/**
 * Validate and extract a nested record from an SDK response.
 * This replaces: `props["field"] as Record<string, unknown>`
 */
export function extractRecord(
  obj: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  return safeRecord(obj[field]);
}

/**
 * Safely cast a generic resource object to a record for field traversal.
 * This replaces the double-cast: `resource as unknown as Record<string, unknown>`
 */
export function toRecord(value: unknown): Record<string, unknown> {
  return safeRecord(value);
}

/**
 * Extract a numeric field from a pool/resource record with a fallback.
 * Replaces: `(p as Record<string, unknown>)["count"] as number ?? 0`
 */
export function extractNumber(
  obj: Record<string, unknown>,
  field: string,
  fallback = 0,
): number {
  return safeNumber(obj[field], fallback);
}

/**
 * Extract a string field from a pool/resource record with a fallback.
 */
export function extractString(
  obj: Record<string, unknown>,
  field: string,
  fallback = "",
): string {
  return safeString(obj[field], fallback);
}
