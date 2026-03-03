/**
 * Generic circuit breaker implementation for protecting against cascading failures.
 *
 * Implements the three-state circuit breaker pattern:
 *   - **Closed** — Requests pass through normally. Failures are counted.
 *   - **Open**   — All requests are rejected immediately with `CircuitOpenError`.
 *   - **Half-open** — A limited number of probe requests are allowed through.
 *                      Success closes the circuit; failure re-opens it.
 *
 * @example
 * ```ts
 * const cb = new CircuitBreaker<Response>("openai", {
 *   failureThreshold: 5,
 *   resetTimeoutMs: 30_000,
 *   halfOpenMaxProbes: 1,
 * });
 *
 * const result = await cb.execute(() => fetch("https://api.openai.com/..."));
 * ```
 *
 * @module
 */

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** The three canonical circuit breaker states. */
export type CircuitState = "closed" | "open" | "half_open";

/** Configuration for a {@link CircuitBreaker} instance. */
export type CircuitBreakerConfig = {
  /**
   * Number of consecutive failures required to trip the breaker from closed
   * to open. Defaults to `5`.
   */
  failureThreshold?: number;

  /**
   * Milliseconds the circuit remains open before transitioning to half-open.
   * Defaults to `30_000` (30 seconds).
   */
  resetTimeoutMs?: number;

  /**
   * Maximum concurrent probe requests allowed in the half-open state.
   * Defaults to `1`.
   */
  halfOpenMaxProbes?: number;

  /**
   * Optional predicate to decide whether a caught error should count as a
   * circuit-breaker failure. Return `false` to let non-transient errors
   * (e.g. 400 Bad Request) pass through without tripping the breaker.
   *
   * Defaults to `() => true` (all errors count).
   */
  shouldTrip?: (err: unknown) => boolean;

  /**
   * Callback invoked whenever the circuit state changes.
   * Useful for emitting metrics or logging.
   */
  onStateChange?: (event: CircuitStateChangeEvent) => void;

  /**
   * Timeout budget (in ms) per individual call executed through the breaker.
   * When set, calls that exceed this duration are aborted and counted as
   * failures. `0` or `undefined` means no timeout enforcement.
   */
  callTimeoutMs?: number;
};

/** Payload emitted via {@link CircuitBreakerConfig.onStateChange}. */
export type CircuitStateChangeEvent = {
  /** Human-readable name of this circuit breaker. */
  name: string;
  /** Previous state. */
  from: CircuitState;
  /** New state. */
  to: CircuitState;
  /** Epoch timestamp when the transition occurred. */
  timestamp: number;
  /** Failure count when the transition happened (relevant for closed→open). */
  failures: number;
};

/** Read-only snapshot of a circuit breaker's internal state. */
export type CircuitBreakerSnapshot = {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  totalRejections: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  halfOpenProbes: number;
};

// ────────────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when a request is rejected because the circuit is open.
 * The caller can inspect `remainingMs` to decide whether to retry,
 * fall back, or surface the failure.
 */
export class CircuitOpenError extends Error {
  override readonly name = "CircuitOpenError";
  /** Name of the breaker that rejected the call. */
  readonly breakerName: string;
  /** Approximate milliseconds until the circuit transitions to half-open. */
  readonly remainingMs: number;

  constructor(breakerName: string, remainingMs: number) {
    super(
      `Circuit breaker "${breakerName}" is open — requests blocked for ~${Math.round(remainingMs)}ms`,
    );
    this.breakerName = breakerName;
    this.remainingMs = remainingMs;
  }
}

/**
 * Thrown when a call executed through the circuit breaker exceeds
 * the configured `callTimeoutMs`.
 */
export class CircuitTimeoutError extends Error {
  override readonly name = "CircuitTimeoutError";
  readonly breakerName: string;
  readonly timeoutMs: number;

  constructor(breakerName: string, timeoutMs: number) {
    super(`Circuit breaker "${breakerName}" call timed out after ${timeoutMs}ms`);
    this.breakerName = breakerName;
    this.timeoutMs = timeoutMs;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Resolved defaults
// ────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxProbes: 1,
} as const;

function resolveConfig(cfg?: CircuitBreakerConfig) {
  return {
    failureThreshold: Math.max(1, Math.round(cfg?.failureThreshold ?? DEFAULTS.failureThreshold)),
    resetTimeoutMs: Math.max(0, cfg?.resetTimeoutMs ?? DEFAULTS.resetTimeoutMs),
    halfOpenMaxProbes: Math.max(
      1,
      Math.round(cfg?.halfOpenMaxProbes ?? DEFAULTS.halfOpenMaxProbes),
    ),
    shouldTrip: cfg?.shouldTrip ?? (() => true),
    onStateChange: cfg?.onStateChange,
    callTimeoutMs:
      cfg?.callTimeoutMs && Number.isFinite(cfg.callTimeoutMs) && cfg.callTimeoutMs > 0
        ? cfg.callTimeoutMs
        : undefined,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// CircuitBreaker
// ────────────────────────────────────────────────────────────────────────────

export class CircuitBreaker<T = unknown> {
  readonly name: string;

  private readonly cfg: ReturnType<typeof resolveConfig>;

  // ── mutable internal state ──
  private _state: CircuitState = "closed";
  private _failures = 0;
  private _successes = 0;
  private _halfOpenProbes = 0;
  private _lastFailureTime = 0;
  private _lastSuccessTime = 0;

  // ── lifetime counters ──
  private _totalRequests = 0;
  private _totalFailures = 0;
  private _totalSuccesses = 0;
  private _totalRejections = 0;

  constructor(name: string, config?: CircuitBreakerConfig) {
    this.name = name;
    this.cfg = resolveConfig(config);
  }

  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ Public API                                                          │
  // └──────────────────────────────────────────────────────────────────────┘

  /** Current circuit state. */
  get state(): CircuitState {
    // Check if an open circuit should transition to half-open.
    if (this._state === "open" && this.shouldTransitionToHalfOpen()) {
      this.transition("half_open");
    }
    return this._state;
  }

  /**
   * Execute `fn` through the circuit breaker.
   *
   * - If the circuit is **closed**, `fn` runs normally.
   * - If the circuit is **open**, a `CircuitOpenError` is thrown immediately.
   * - If the circuit is **half-open**, up to `halfOpenMaxProbes` concurrent
   *   probe calls are allowed; additional calls are rejected.
   *
   * On **success** the circuit closes (if half-open) or resets the failure
   * counter (if closed). On **failure** the failure counter increments and
   * the circuit may trip to open.
   */
  async execute(fn: () => Promise<T>): Promise<T> {
    this._totalRequests += 1;

    const currentState = this.state; // triggers lazy half-open check

    // ── open: reject immediately ──
    if (currentState === "open") {
      this._totalRejections += 1;
      const elapsed = Date.now() - this._lastFailureTime;
      const remaining = Math.max(0, this.cfg.resetTimeoutMs - elapsed);
      throw new CircuitOpenError(this.name, remaining);
    }

    // ── half-open: enforce probe limit ──
    if (currentState === "half_open") {
      if (this._halfOpenProbes >= this.cfg.halfOpenMaxProbes) {
        this._totalRejections += 1;
        throw new CircuitOpenError(this.name, this.cfg.resetTimeoutMs);
      }
      this._halfOpenProbes += 1;
    }

    try {
      const result = this.cfg.callTimeoutMs
        ? await this.executeWithTimeout(fn, this.cfg.callTimeoutMs)
        : await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  /**
   * Returns `true` if the circuit would currently allow a request through
   * (i.e. it is closed, or it is half-open with remaining probe budget).
   */
  canExecute(): boolean {
    const s = this.state;
    if (s === "closed") return true;
    if (s === "half_open") return this._halfOpenProbes < this.cfg.halfOpenMaxProbes;
    return false;
  }

  /** Manually trip the circuit to open (e.g. from an external signal). */
  forceOpen(): void {
    if (this._state !== "open") {
      this._lastFailureTime = Date.now();
      this.transition("open");
    }
  }

  /** Manually close the circuit (e.g. after a dependency is confirmed healthy). */
  forceClose(): void {
    if (this._state !== "closed") {
      this.resetCounters();
      this.transition("closed");
    }
  }

  /** Reset all counters and return to the closed state. */
  reset(): void {
    this.resetCounters();
    this._totalRequests = 0;
    this._totalFailures = 0;
    this._totalSuccesses = 0;
    this._totalRejections = 0;
    if (this._state !== "closed") {
      this.transition("closed");
    }
  }

  /**
   * Manually record a success without executing through the breaker.
   * Use when the call is managed externally (e.g. LLM runner) and you
   * want to feed outcomes into the breaker's state machine retroactively.
   */
  recordSuccess(): void {
    this.onSuccess();
  }

  /**
   * Manually record a failure without executing through the breaker.
   * The `shouldTrip` predicate is still evaluated — non-transient errors
   * are ignored.
   */
  recordFailure(err: unknown): void {
    this.onFailure(err);
  }

  /** Export a read-only snapshot for health checks and metrics. */
  snapshot(): CircuitBreakerSnapshot {
    return {
      name: this.name,
      state: this.state,
      failures: this._failures,
      successes: this._successes,
      totalRequests: this._totalRequests,
      totalFailures: this._totalFailures,
      totalSuccesses: this._totalSuccesses,
      totalRejections: this._totalRejections,
      lastFailureTime: this._lastFailureTime,
      lastSuccessTime: this._lastSuccessTime,
      halfOpenProbes: this._halfOpenProbes,
    };
  }

  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ Internal                                                            │
  // └──────────────────────────────────────────────────────────────────────┘

  private shouldTransitionToHalfOpen(): boolean {
    return Date.now() - this._lastFailureTime >= this.cfg.resetTimeoutMs;
  }

  private transition(to: CircuitState): void {
    const from = this._state;
    if (from === to) return;
    this._state = to;
    if (to === "half_open") {
      this._halfOpenProbes = 0;
    }
    this.cfg.onStateChange?.({
      name: this.name,
      from,
      to,
      timestamp: Date.now(),
      failures: this._failures,
    });
  }

  private onSuccess(): void {
    this._totalSuccesses += 1;
    this._successes += 1;
    this._lastSuccessTime = Date.now();

    if (this._state === "half_open") {
      // Probe succeeded — close the circuit.
      this.resetCounters();
      this.transition("closed");
    } else if (this._state === "closed") {
      // Consecutive-failure counter resets on any success.
      this._failures = 0;
    }
  }

  private onFailure(err: unknown): void {
    this._totalFailures += 1;

    // Let non-transient errors pass through without tripping breaker.
    if (!this.cfg.shouldTrip(err)) return;

    this._failures += 1;
    this._lastFailureTime = Date.now();

    if (this._state === "half_open") {
      // Probe failed — re-open immediately.
      this.transition("open");
    } else if (this._state === "closed" && this._failures >= this.cfg.failureThreshold) {
      // Threshold reached — trip to open.
      this.transition("open");
    }
  }

  private resetCounters(): void {
    this._failures = 0;
    this._successes = 0;
    this._halfOpenProbes = 0;
  }

  private executeWithTimeout(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      // Provide an AbortController so the fn can cooperate with cancellation
      // when the timeout fires. The fn is not required to use it — this is
      // best-effort cancellation consistent with the project's AbortSignal
      // patterns.
      const ac = typeof AbortController !== "undefined" ? new AbortController() : undefined;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          ac?.abort();
          reject(new CircuitTimeoutError(this.name, timeoutMs));
        }
      }, timeoutMs);

      fn().then(
        (result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        },
        (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        },
      );
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CircuitBreakerRegistry — centralized management & health reporting
// ────────────────────────────────────────────────────────────────────────────

/**
 * A global registry that tracks all circuit breakers in the system.
 *
 * Provides:
 * - Lookup by name
 * - Aggregated snapshot for health endpoints
 * - Factory method for creating pre-registered breakers
 *
 * @example
 * ```ts
 * const registry = new CircuitBreakerRegistry();
 * const cb = registry.getOrCreate<Response>("anthropic", { failureThreshold: 3 });
 * const health = registry.snapshot(); // all breakers
 * ```
 */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker<unknown>>();

  /**
   * Return the breaker registered under `name`, creating one if it does not
   * exist. Subsequent calls with the same name return the same instance
   * (config is only applied on first creation).
   */
  getOrCreate<U = unknown>(name: string, config?: CircuitBreakerConfig): CircuitBreaker<U> {
    let cb = this.breakers.get(name);
    if (!cb) {
      cb = new CircuitBreaker<U>(name, config);
      this.breakers.set(name, cb);
    }
    return cb as CircuitBreaker<U>;
  }

  /** Return the breaker registered under `name`, or `undefined`. */
  get<U = unknown>(name: string): CircuitBreaker<U> | undefined {
    return this.breakers.get(name) as CircuitBreaker<U> | undefined;
  }

  /** Check whether a breaker with `name` exists. */
  has(name: string): boolean {
    return this.breakers.has(name);
  }

  /** Remove and return the breaker registered under `name`. */
  remove(name: string): boolean {
    return this.breakers.delete(name);
  }

  /** Return the number of registered breakers. */
  get size(): number {
    return this.breakers.size;
  }

  /** Iterate over all registered breakers. */
  [Symbol.iterator](): IterableIterator<[string, CircuitBreaker<unknown>]> {
    return this.breakers.entries();
  }

  /**
   * Return snapshots of every registered breaker.
   * Useful for health endpoints and dashboards.
   */
  snapshot(): CircuitBreakerSnapshot[] {
    const out: CircuitBreakerSnapshot[] = [];
    for (const cb of this.breakers.values()) {
      out.push(cb.snapshot());
    }
    return out;
  }

  /**
   * Return a summary object suitable for inclusion in gateway health
   * responses. Groups breakers by state and flags any that are open.
   */
  healthSummary(): CircuitBreakerHealthSummary {
    const snapshots = this.snapshot();
    const byState: Record<CircuitState, string[]> = {
      closed: [],
      open: [],
      half_open: [],
    };
    for (const s of snapshots) {
      byState[s.state].push(s.name);
    }
    return {
      total: snapshots.length,
      open: byState.open,
      halfOpen: byState.half_open,
      closed: byState.closed,
      hasOpenCircuits: byState.open.length > 0,
      breakers: snapshots,
    };
  }

  /** Reset all breakers (useful for testing). */
  resetAll(): void {
    for (const cb of this.breakers.values()) {
      cb.reset();
    }
  }

  /** Remove all breakers (useful for testing). */
  clear(): void {
    this.breakers.clear();
  }
}

/** Summary returned by {@link CircuitBreakerRegistry.healthSummary}. */
export type CircuitBreakerHealthSummary = {
  total: number;
  open: string[];
  halfOpen: string[];
  closed: string[];
  hasOpenCircuits: boolean;
  breakers: CircuitBreakerSnapshot[];
};

// ────────────────────────────────────────────────────────────────────────────
// Global singleton registry
// ────────────────────────────────────────────────────────────────────────────

/**
 * Module-level singleton registry.
 * Import and use directly, or create your own `CircuitBreakerRegistry` for
 * isolated testing.
 */
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

// ────────────────────────────────────────────────────────────────────────────
// Diagnostic integration
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create an `onStateChange` callback that emits diagnostic events via the
 * platform's existing {@link emitDiagnosticEvent} pipeline.
 *
 * Use this when creating circuit breakers that should be surfaced through
 * the OTel / diagnostics system.
 *
 * @example
 * ```ts
 * const cb = new CircuitBreaker("openai", {
 *   onStateChange: makeDiagnosticStateChangeHandler(),
 * });
 * ```
 */
export function makeDiagnosticStateChangeHandler(): CircuitBreakerConfig["onStateChange"] {
  let emitFn:
    | ((event: { type: string; name: string; from: string; to: string; failures: number }) => void)
    | undefined;
  let importPromise: Promise<void> | undefined;

  return (event: CircuitStateChangeEvent) => {
    if (!emitFn && !importPromise) {
      importPromise = import("./diagnostic-events.js")
        .then((mod) => {
          emitFn = (e) =>
            mod.emitDiagnosticEvent(e as Parameters<typeof mod.emitDiagnosticEvent>[0]);
        })
        .catch(() => {
          emitFn = () => {};
        });
    }
    // Fire-and-forget — if the import hasn't resolved yet, the event is dropped.
    // This is acceptable because state change events are informational.
    emitFn?.({
      type: "circuit_breaker.state_change",
      name: event.name,
      from: event.from,
      to: event.to,
      failures: event.failures,
    });
  };
}
