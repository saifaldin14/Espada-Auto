/**
 * Cross-Cloud Migration Engine — Runtime Configuration
 *
 * Reads and validates the configSchema values from the Espada plugin API.
 * All config values are bounded and typed.
 */

// =============================================================================
// Configuration Shape
// =============================================================================

export interface MigrationConfig {
  /** Maximum concurrent orchestration steps (1-64, default 4). */
  maxConcurrency: number;
  /** Maximum concurrent object transfers (1-256, default 16). */
  transferConcurrency: number;
  /** Global job timeout in milliseconds (60_000-86_400_000, default 14_400_000). */
  globalTimeoutMs: number;
  /** Default per-step timeout in milliseconds (5_000-3_600_000, default 600_000). */
  stepTimeoutMs: number;
  /** Automatically rollback on step failure (default true). */
  autoRollback: boolean;
  /** Require explicit approval before execution (default true). */
  requireApproval: boolean;
  /** Enable SHA-256 integrity verification (default true). */
  integrityVerification: boolean;
}

// =============================================================================
// Defaults & Bounds
// =============================================================================

const DEFAULTS: Readonly<MigrationConfig> = {
  maxConcurrency: 4,
  transferConcurrency: 16,
  globalTimeoutMs: 14_400_000,
  stepTimeoutMs: 600_000,
  autoRollback: true,
  requireApproval: true,
  integrityVerification: true,
};

const BOUNDS: Record<string, { min: number; max: number }> = {
  maxConcurrency: { min: 1, max: 64 },
  transferConcurrency: { min: 1, max: 256 },
  globalTimeoutMs: { min: 60_000, max: 86_400_000 },
  stepTimeoutMs: { min: 5_000, max: 3_600_000 },
};

// =============================================================================
// Runtime Config Singleton
// =============================================================================

let current: MigrationConfig = { ...DEFAULTS };

/**
 * Clamp a number to [min, max]. Returns defaultVal when the input is not a finite number.
 */
function clampNum(value: unknown, min: number, max: number, defaultVal: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return defaultVal;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Coerce a value to boolean. Returns defaultVal when the input is not a boolean.
 */
function coerceBool(value: unknown, defaultVal: boolean): boolean {
  if (typeof value === "boolean") return value;
  return defaultVal;
}

/**
 * Initialize runtime configuration from the Espada API config object.
 * Invalid or out-of-range values are silently clamped to their nearest bound.
 *
 * @param raw The raw config record from `api.getConfig()`.
 * @returns A list of warnings for values that were clamped or defaulted.
 */
export function initConfig(raw: Record<string, unknown> | undefined): string[] {
  const warnings: string[] = [];
  const r = raw ?? {};

  const cfg: MigrationConfig = {
    maxConcurrency: clampNum(r.maxConcurrency, BOUNDS.maxConcurrency.min, BOUNDS.maxConcurrency.max, DEFAULTS.maxConcurrency),
    transferConcurrency: clampNum(r.transferConcurrency, BOUNDS.transferConcurrency.min, BOUNDS.transferConcurrency.max, DEFAULTS.transferConcurrency),
    globalTimeoutMs: clampNum(r.globalTimeoutMs, BOUNDS.globalTimeoutMs.min, BOUNDS.globalTimeoutMs.max, DEFAULTS.globalTimeoutMs),
    stepTimeoutMs: clampNum(r.stepTimeoutMs, BOUNDS.stepTimeoutMs.min, BOUNDS.stepTimeoutMs.max, DEFAULTS.stepTimeoutMs),
    autoRollback: coerceBool(r.autoRollback, DEFAULTS.autoRollback),
    requireApproval: coerceBool(r.requireApproval, DEFAULTS.requireApproval),
    integrityVerification: coerceBool(r.integrityVerification, DEFAULTS.integrityVerification),
  };

  // Emit warnings for clamped numeric values
  for (const key of Object.keys(BOUNDS) as Array<keyof typeof BOUNDS>) {
    const raw = r[key];
    const { min, max } = BOUNDS[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      if (raw < min) warnings.push(`${key} (${raw}) clamped to minimum ${min}`);
      else if (raw > max) warnings.push(`${key} (${raw}) clamped to maximum ${max}`);
    } else if (raw !== undefined && raw !== null) {
      warnings.push(`${key} (${String(raw)}) is not a number, using default ${(DEFAULTS as Record<string, unknown>)[key]}`);
    }
  }

  current = cfg;
  return warnings;
}

/**
 * Get the current validated runtime configuration.
 */
export function getConfig(): Readonly<MigrationConfig> {
  return current;
}

/**
 * Reset config to defaults (for testing).
 */
export function resetConfig(): void {
  current = { ...DEFAULTS };
}

/**
 * Get orchestration options derived from config.
 * Merges config defaults with any per-call overrides.
 */
export function getOrchestrationOptions(
  overrides: Record<string, unknown> = {},
): {
  maxConcurrency: number;
  autoRollback: boolean;
  stepTimeoutMs: number;
  failFast: boolean;
} {
  return {
    maxConcurrency: typeof overrides.maxConcurrency === "number"
      ? clampNum(overrides.maxConcurrency, 1, 64, current.maxConcurrency)
      : current.maxConcurrency,
    autoRollback: typeof overrides.autoRollback === "boolean"
      ? overrides.autoRollback
      : current.autoRollback,
    stepTimeoutMs: typeof overrides.stepTimeoutMs === "number"
      ? clampNum(overrides.stepTimeoutMs, 5_000, 3_600_000, current.stepTimeoutMs)
      : current.stepTimeoutMs,
    failFast: typeof overrides.failFast === "boolean"
      ? overrides.failFast
      : true,
  };
}
