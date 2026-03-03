/**
 * AWS Extension — Circuit Breaker for Cloud API Calls
 *
 * Self-contained circuit breaker for AWS service API calls.
 * Prevents cascading failures when a specific AWS service (e.g. EC2, S3)
 * is degraded or throttling heavily.
 *
 * This module is self-contained to avoid tsconfig rootDir issues.
 * It implements the same pattern as src/infra/circuit-breaker.ts.
 *
 * @module
 */

import { shouldRetryAWSError } from "./retry.js";

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
  /** Predicate — only count errors that return true. Default: shouldRetryAWSError. */
  shouldTrip?: (err: unknown) => boolean;
  /** Callback on state transitions. */
  onStateChange?: (event: { name: string; from: CircuitState; to: CircuitState; failures: number }) => void;
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
    super(`Circuit breaker "${breakerName}" is open — requests blocked for ~${Math.round(remainingMs)}ms`);
    this.breakerName = breakerName;
    this.remainingMs = remainingMs;
  }
}

// =============================================================================
// Defaults
// =============================================================================

/**
 * AWS services have higher API rate limits than LLM providers,
 * so we use a higher failure threshold (10 vs 5) and shorter reset (30s).
 */
const DEFAULTS = {
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
    this.failureThreshold = Math.max(1, Math.round(config?.failureThreshold ?? DEFAULTS.failureThreshold));
    this.resetTimeoutMs = Math.max(0, config?.resetTimeoutMs ?? DEFAULTS.resetTimeoutMs);
    this.halfOpenMaxProbes = Math.max(1, Math.round(config?.halfOpenMaxProbes ?? DEFAULTS.halfOpenMaxProbes));
    this.shouldTrip = config?.shouldTrip ?? ((err) => shouldRetryAWSError(err, 0));
    this.onStateChange = config?.onStateChange;
  }

  get state(): CircuitState {
    if (this._state === "open" && Date.now() - this._lastFailureTime >= this.resetTimeoutMs) {
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
// Registry — per-service circuit breaker tracking
// =============================================================================

const breakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker for a specific AWS service.
 *
 * Breaker names follow the pattern `aws:<service>` (e.g. `aws:ec2`, `aws:s3`).
 * Optionally scoped to a region: `aws:<service>:<region>`.
 *
 * @example
 * ```ts
 * const breaker = getAWSServiceBreaker("ec2");
 * const breaker = getAWSServiceBreaker("s3", "us-west-2");
 * ```
 */
export function getAWSServiceBreaker(service: string, region?: string): CircuitBreaker {
  const name = region ? `aws:${service}:${region}` : `aws:${service}`;
  let cb = breakers.get(name);
  if (!cb) {
    cb = new CircuitBreaker(name, {
      onStateChange: (event) => {
        const logFn = event.to === "open" ? console.warn : console.info;
        logFn(
          `[circuit-breaker] AWS ${service}${region ? ` (${region})` : ""}: ${event.from} → ${event.to}` +
            (event.to === "open" ? ` (after ${event.failures} failures)` : ""),
        );
      },
    });
    breakers.set(name, cb);
  }
  return cb;
}

/**
 * Check if an AWS service circuit is currently allowing requests.
 */
export function isAWSServiceAvailable(service: string, region?: string): boolean {
  const name = region ? `aws:${service}:${region}` : `aws:${service}`;
  const cb = breakers.get(name);
  if (!cb) return true;
  return cb.canExecute();
}

/**
 * Execute an AWS API call with circuit breaker + retry protection.
 *
 * The circuit breaker wraps *around* the retry logic: if the service circuit
 * is open, the call is rejected immediately without burning retry attempts.
 *
 * @example
 * ```ts
 * const result = await withAWSCircuitBreaker(
 *   "ec2",
 *   () => withAWSRetry(() => client.send(new DescribeInstancesCommand({})), { label: "DescribeInstances" }),
 *   { region: "us-east-1" },
 * );
 * ```
 */
export async function withAWSCircuitBreaker<T>(
  service: string,
  fn: () => Promise<T>,
  opts?: { region?: string },
): Promise<T> {
  const cb = getAWSServiceBreaker(service, opts?.region);
  return cb.execute(fn);
}

/**
 * Return snapshots of all registered AWS service breakers.
 */
export function getAWSCircuitBreakerSnapshots(): CircuitBreakerSnapshot[] {
  const out: CircuitBreakerSnapshot[] = [];
  for (const cb of breakers.values()) {
    out.push(cb.snapshot());
  }
  return out;
}

/**
 * Summary suitable for health reporting.
 */
export function getAWSCircuitBreakerHealthSummary() {
  const snapshots = getAWSCircuitBreakerSnapshots();
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

/**
 * Reset all AWS service breakers (for testing).
 */
export function resetAllAWSBreakers(): void {
  for (const cb of breakers.values()) cb.reset();
  breakers.clear();
}
