/**
 * Azure Extension — Circuit Breaker for Cloud API Calls
 *
 * Self-contained circuit breaker for Azure service API calls.
 * Prevents cascading failures when a specific Azure service
 * (e.g. VMs, App Service) is degraded or throttling heavily.
 *
 * This module is self-contained to avoid tsconfig rootDir issues.
 * It implements the same pattern as src/infra/circuit-breaker.ts.
 *
 * @module
 */

import { shouldRetryAzureError } from "./retry.js";

// =============================================================================
// Types
// =============================================================================

export type CircuitState = "closed" | "open" | "half_open";

export type CircuitBreakerConfig = {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenMaxProbes?: number;
  shouldTrip?: (err: unknown) => boolean;
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
    this.shouldTrip = config?.shouldTrip ?? shouldRetryAzureError;
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

  recordSuccess(): void { this.onSuccess(); }
  recordFailure(err: unknown): void { this.onFailure(err); }

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
    if (this._state !== "closed") this.transition("closed");
  }

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
// Registry
// =============================================================================

const breakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker for a specific Azure service.
 * Breaker names: `azure:<service>` or `azure:<service>:<subscriptionId>`.
 */
export function getAzureServiceBreaker(service: string, subscriptionId?: string): CircuitBreaker {
  const name = subscriptionId ? `azure:${service}:${subscriptionId}` : `azure:${service}`;
  let cb = breakers.get(name);
  if (!cb) {
    cb = new CircuitBreaker(name, {
      onStateChange: (event) => {
        const logFn = event.to === "open" ? console.warn : console.info;
        logFn(
          `[circuit-breaker] Azure ${service}${subscriptionId ? ` (${subscriptionId})` : ""}: ${event.from} → ${event.to}` +
            (event.to === "open" ? ` (after ${event.failures} failures)` : ""),
        );
      },
    });
    breakers.set(name, cb);
  }
  return cb;
}

export function isAzureServiceAvailable(service: string, subscriptionId?: string): boolean {
  const name = subscriptionId ? `azure:${service}:${subscriptionId}` : `azure:${service}`;
  const cb = breakers.get(name);
  if (!cb) return true;
  return cb.canExecute();
}

export async function withAzureCircuitBreaker<T>(
  service: string,
  fn: () => Promise<T>,
  opts?: { subscriptionId?: string },
): Promise<T> {
  const cb = getAzureServiceBreaker(service, opts?.subscriptionId);
  return cb.execute(fn);
}

export function getAzureCircuitBreakerSnapshots(): CircuitBreakerSnapshot[] {
  return Array.from(breakers.values(), (cb) => cb.snapshot());
}

export function getAzureCircuitBreakerHealthSummary() {
  const snapshots = getAzureCircuitBreakerSnapshots();
  const open: string[] = [];
  const halfOpen: string[] = [];
  const closed: string[] = [];
  for (const s of snapshots) {
    if (s.state === "open") open.push(s.name);
    else if (s.state === "half_open") halfOpen.push(s.name);
    else closed.push(s.name);
  }
  return { total: snapshots.length, open, halfOpen, closed, hasOpenCircuits: open.length > 0, breakers: snapshots };
}

export function resetAllAzureBreakers(): void {
  for (const cb of breakers.values()) cb.reset();
  breakers.clear();
}
