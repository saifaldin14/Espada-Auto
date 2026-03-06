/**
 * Resilience Utilities — Timeout, Circuit Breaker, Shape Validation
 *
 * Production-grade utilities used by all integration bridges to handle
 * external extension failures gracefully.
 */

// =============================================================================
// Timeout
// =============================================================================

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`Timeout: ${label} exceeded ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Race a promise against a timeout. Returns the promise result if it
 * resolves before `ms` milliseconds, otherwise throws TimeoutError.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  if (ms <= 0) return promise;

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// =============================================================================
// Circuit Breaker
// =============================================================================

export type CircuitBreakerState = "closed" | "open" | "half-open";

/**
 * Simple circuit breaker that opens after `threshold` consecutive failures
 * and resets after `resetTimeMs` milliseconds.
 *
 * Usage:
 *   const breaker = new CircuitBreaker("auth", 5, 60_000);
 *   const result = await breaker.execute(() => authEngine.authorize(user, perm));
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private _state: CircuitBreakerState = "closed";

  constructor(
    private readonly label: string,
    private readonly threshold: number = 5,
    private readonly resetTimeMs: number = 60_000,
  ) {}

  get state(): CircuitBreakerState {
    return this._state;
  }

  get isOpen(): boolean {
    return this._state === "open";
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws immediately if the breaker is open (unless reset time has elapsed).
   */
  async execute<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this._state === "open") {
      if (Date.now() - this.lastFailureTime > this.resetTimeMs) {
        this._state = "half-open";
      } else {
        throw new Error(`Circuit breaker open for ${this.label} — failing fast`);
      }
    }

    try {
      const result = await fn();
      if (this._state === "half-open") {
        this._state = "closed";
        this.failures = 0;
      }
      return result;
    } catch (err) {
      this.failures++;
      this.lastFailureTime = Date.now();
      if (this.failures >= this.threshold) {
        this._state = "open";
      }
      throw err;
    }
  }

  reset(): void {
    this._state = "closed";
    this.failures = 0;
    this.lastFailureTime = 0;
  }
}

// =============================================================================
// Runtime Shape Validation
// =============================================================================

/**
 * Validate that a runtime object has the expected method shape.
 * Used to validate getService() results before trusting them.
 *
 * @returns true if the object has all required methods as functions
 */
export function validateServiceShape(
  service: unknown,
  requiredMethods: readonly string[],
  label: string,
): service is Record<string, (...args: unknown[]) => unknown> {
  if (!service || typeof service !== "object") {
    return false;
  }

  const obj = service as Record<string, unknown>;
  const missing: string[] = [];

  for (const method of requiredMethods) {
    if (typeof obj[method] !== "function") {
      missing.push(method);
    }
  }

  if (missing.length > 0) {
    // eslint-disable-next-line no-console -- shape mismatch is a genuine misconfiguration
    console.warn(`[validateServiceShape] ${label}: missing methods: ${missing.join(", ")}`);
    return false;
  }

  return true;
}

/**
 * Shape definitions for each sibling extension service.
 * Used at plugin init time to validate getService() results.
 */
export const SERVICE_SHAPES = {
  authEngine: ["authorize", "getUserPermissions"],
  userResolver: ["getUser"],
  auditLogger: ["log"],
  complianceEvaluator: ["evaluate"],
  policyEngine: ["evaluate", "evaluateAll"],
  policyStorage: ["list"],
  budgetManager: ["listBudgets", "getStatus", "updateSpend"],
  terraformBridge: ["stateToGraphNodes", "dependenciesToGraphEdges", "syncStateToGraph", "diffGraphVsState"],
  alertingExtension: ["resolveRoutes", "dispatchToChannels"],
} as const;
