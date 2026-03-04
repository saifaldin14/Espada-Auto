/**
 * Cloud Extensions — Shared Circuit Breaker
 *
 * Provider-agnostic circuit breaker implementation for cloud API calls.
 * Prevents cascading failures when a cloud service is degraded or throttling.
 *
 * Each provider (AWS, Azure, GCP) imports the core class and types from here,
 * then wraps them with a thin registry layer that adds provider-specific naming
 * and scope key semantics (region, subscriptionId, projectId).
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

export type CircuitState = "closed" | "open" | "half_open";

export type CircuitBreakerConfig = {
  /** Consecutive failures before opening. Default: 10. */
  failureThreshold?: number;
  /** Ms the circuit stays open before probing. Default: 30_000. */
  resetTimeoutMs?: number;
  /** Max concurrent probes in half-open state. Default: 1. */
  halfOpenMaxProbes?: number;
  /** Predicate — only count errors that return true. */
  shouldTrip?: (err: unknown) => boolean;
  /** Callback on state transitions. */
  onStateChange?: (event: {
    name: string;
    from: CircuitState;
    to: CircuitState;
    failures: number;
  }) => void;
};

export type CircuitBreakerSnapshot = {
  name: string;
  state: CircuitState;
  failures: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  totalRejections: number;
  lastFailureTime: number;
};

// =============================================================================
// Errors
// =============================================================================

export class CircuitOpenError extends Error {
  override readonly name = "CircuitOpenError";
  readonly breakerName: string;
  readonly remainingMs: number;

  constructor(breakerName: string, remainingMs: number) {
    super(
      `Circuit breaker "${breakerName}" is open — requests blocked for ~${Math.round(remainingMs)}ms`,
    );
    this.breakerName = breakerName;
    this.remainingMs = remainingMs;
  }
}

// =============================================================================
// Defaults
// =============================================================================

/**
 * Cloud services have higher API rate limits than LLM providers,
 * so we use a higher failure threshold (10 vs 5) and shorter reset (30s).
 */
export const CIRCUIT_BREAKER_DEFAULTS = {
  failureThreshold: 10,
  resetTimeoutMs: 30_000,
  halfOpenMaxProbes: 1,
} as const;

// =============================================================================
// CircuitBreaker
// =============================================================================

export class CircuitBreaker {
  readonly name: string;
  private failureThreshold: number;
  private resetTimeoutMs: number;
  private halfOpenMaxProbes: number;
  private shouldTrip: (err: unknown) => boolean;
  private onStateChange?: CircuitBreakerConfig["onStateChange"];

  private _state: CircuitState = "closed";
  private _failures = 0;
  private _halfOpenProbes = 0;
  private _lastFailureTime = 0;
  private _totalRequests = 0;
  private _totalFailures = 0;
  private _totalSuccesses = 0;
  private _totalRejections = 0;

  constructor(name: string, config?: CircuitBreakerConfig) {
    this.name = name;
    this.failureThreshold = Math.max(
      1,
      Math.round(config?.failureThreshold ?? CIRCUIT_BREAKER_DEFAULTS.failureThreshold),
    );
    this.resetTimeoutMs = Math.max(
      0,
      config?.resetTimeoutMs ?? CIRCUIT_BREAKER_DEFAULTS.resetTimeoutMs,
    );
    this.halfOpenMaxProbes = Math.max(
      1,
      Math.round(config?.halfOpenMaxProbes ?? CIRCUIT_BREAKER_DEFAULTS.halfOpenMaxProbes),
    );
    this.shouldTrip = config?.shouldTrip ?? (() => true);
    this.onStateChange = config?.onStateChange;
  }

  get state(): CircuitState {
    if (
      this._state === "open" &&
      Date.now() - this._lastFailureTime >= this.resetTimeoutMs
    ) {
      this.transition("half_open");
    }
    return this._state;
  }

  canExecute(): boolean {
    const s = this.state;
    if (s === "closed") return true;
    if (s === "half_open") return this._halfOpenProbes < this.halfOpenMaxProbes;
    return false;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this._totalRequests += 1;
    const currentState = this.state;

    if (currentState === "open") {
      this._totalRejections += 1;
      const elapsed = Date.now() - this._lastFailureTime;
      const remaining = Math.max(0, this.resetTimeoutMs - elapsed);
      throw new CircuitOpenError(this.name, remaining);
    }

    if (currentState === "half_open") {
      if (this._halfOpenProbes >= this.halfOpenMaxProbes) {
        this._totalRejections += 1;
        throw new CircuitOpenError(this.name, this.resetTimeoutMs);
      }
      this._halfOpenProbes += 1;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  recordSuccess(): void {
    this.onSuccess();
  }

  recordFailure(err: unknown): void {
    this.onFailure(err);
  }

  snapshot(): CircuitBreakerSnapshot {
    return {
      name: this.name,
      state: this.state,
      failures: this._failures,
      totalRequests: this._totalRequests,
      totalFailures: this._totalFailures,
      totalSuccesses: this._totalSuccesses,
      totalRejections: this._totalRejections,
      lastFailureTime: this._lastFailureTime,
    };
  }

  forceOpen(): void {
    if (this._state !== "open") {
      this._lastFailureTime = Date.now();
      this.transition("open");
    }
  }

  reset(): void {
    this._failures = 0;
    this._halfOpenProbes = 0;
    this._totalRequests = 0;
    this._totalFailures = 0;
    this._totalSuccesses = 0;
    this._totalRejections = 0;
    if (this._state !== "closed") {
      this.transition("closed");
    }
  }

  // ── Internal ──

  private transition(to: CircuitState): void {
    const from = this._state;
    if (from === to) return;
    this._state = to;
    if (to === "half_open") this._halfOpenProbes = 0;
    this.onStateChange?.({ name: this.name, from, to, failures: this._failures });
  }

  private onSuccess(): void {
    this._totalSuccesses += 1;
    if (this._state === "half_open") {
      this._failures = 0;
      this._halfOpenProbes = 0;
      this.transition("closed");
    } else if (this._state === "closed") {
      this._failures = 0;
    }
  }

  private onFailure(err: unknown): void {
    this._totalFailures += 1;
    if (!this.shouldTrip(err)) return;
    this._failures += 1;
    this._lastFailureTime = Date.now();
    if (this._state === "half_open") {
      this.transition("open");
    } else if (this._state === "closed" && this._failures >= this.failureThreshold) {
      this.transition("open");
    }
  }
}

// =============================================================================
// Registry Factory
// =============================================================================

export type ProviderRegistryConfig = {
  /** Provider prefix, e.g. "aws", "azure", "gcp". */
  prefix: string;
  /** Human-readable label for logs, e.g. "AWS", "Azure", "GCP". */
  label: string;
  /** Provider-specific shouldTrip default. */
  defaultShouldTrip?: (err: unknown) => boolean;
};

/**
 * Create a provider-scoped circuit breaker registry.
 *
 * Returns get/isAvailable/withBreaker/snapshots/healthSummary/resetAll
 * functions scoped to the given provider prefix.
 *
 * @example
 * ```ts
 * const aws = createProviderBreakerRegistry({
 *   prefix: "aws",
 *   label: "AWS",
 *   defaultShouldTrip: (err) => shouldRetryAWSError(err, 0),
 * });
 * const breaker = aws.getServiceBreaker("ec2", "us-east-1");
 * await aws.withCircuitBreaker("s3", () => client.send(cmd), { scope: "us-west-2" });
 * ```
 */
export function createProviderBreakerRegistry(config: ProviderRegistryConfig) {
  const breakers = new Map<string, CircuitBreaker>();

  function getServiceBreaker(service: string, scope?: string): CircuitBreaker {
    const name = scope
      ? `${config.prefix}:${service}:${scope}`
      : `${config.prefix}:${service}`;
    let cb = breakers.get(name);
    if (!cb) {
      cb = new CircuitBreaker(name, {
        shouldTrip: config.defaultShouldTrip,
        onStateChange: (event) => {
          const logFn = event.to === "open" ? console.warn : console.info;
          logFn(
            `[circuit-breaker] ${config.label} ${service}${scope ? ` (${scope})` : ""}: ${event.from} → ${event.to}` +
              (event.to === "open" ? ` (after ${event.failures} failures)` : ""),
          );
        },
      });
      breakers.set(name, cb);
    }
    return cb;
  }

  function isServiceAvailable(service: string, scope?: string): boolean {
    const name = scope
      ? `${config.prefix}:${service}:${scope}`
      : `${config.prefix}:${service}`;
    const cb = breakers.get(name);
    if (!cb) return true;
    return cb.canExecute();
  }

  async function withCircuitBreaker<T>(
    service: string,
    fn: () => Promise<T>,
    opts?: { scope?: string },
  ): Promise<T> {
    const cb = getServiceBreaker(service, opts?.scope);
    return cb.execute(fn);
  }

  function getSnapshots(): CircuitBreakerSnapshot[] {
    return Array.from(breakers.values(), (cb) => cb.snapshot());
  }

  function getHealthSummary() {
    const snapshots = getSnapshots();
    const open: string[] = [];
    const halfOpen: string[] = [];
    const closed: string[] = [];
    for (const s of snapshots) {
      if (s.state === "open") open.push(s.name);
      else if (s.state === "half_open") halfOpen.push(s.name);
      else closed.push(s.name);
    }
    return {
      total: snapshots.length,
      open,
      halfOpen,
      closed,
      hasOpenCircuits: open.length > 0,
      breakers: snapshots,
    };
  }

  function resetAll(): void {
    for (const cb of breakers.values()) cb.reset();
    breakers.clear();
  }

  return {
    getServiceBreaker,
    isServiceAvailable,
    withCircuitBreaker,
    getSnapshots,
    getHealthSummary,
    resetAll,
  };
}
