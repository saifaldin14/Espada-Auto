/**
 * Circuit breaker integration for LLM provider calls.
 *
 * Wraps LLM API calls with per-provider circuit breakers so that a degraded
 * provider (rate limiting, repeated auth failures, timeouts) is taken out of
 * rotation immediately rather than waiting for each call to time out.
 *
 * Uses the global {@link circuitBreakerRegistry} so that breaker state is
 * visible in the `/health` endpoint.
 *
 * @module
 */

import {
  CircuitBreaker,
  CircuitOpenError,
  circuitBreakerRegistry,
  makeDiagnosticStateChangeHandler,
  type CircuitBreakerConfig,
} from "../../infra/circuit-breaker.js";
import { FailoverError } from "../failover-error.js";
import { type FailoverReason } from "../pi-embedded-helpers.js";

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

/**
 * Default circuit breaker settings tuned for LLM provider APIs.
 *
 * - 5 consecutive failures trips the breaker (matches auth-profile cooldown
 *   counts already used by the failover system).
 * - 60 s reset timeout — long enough to let temporary rate limits expire,
 *   short enough that a recovered provider is quickly retried.
 * - Only 1 half-open probe at a time to avoid burning tokens/quota.
 */
const LLM_PROVIDER_DEFAULTS: Required<
  Pick<CircuitBreakerConfig, "failureThreshold" | "resetTimeoutMs" | "halfOpenMaxProbes">
> = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenMaxProbes: 1,
};

/**
 * Failover reasons that should trip the circuit breaker.
 * Non-transient errors (format, user-side issues) should not.
 */
const TRIPPABLE_REASONS = new Set<FailoverReason | string>([
  "rate_limit",
  "timeout",
  "auth",
  "billing",
  "server_error",
  "unknown",
]);

// ────────────────────────────────────────────────────────────────────────────
// shouldTrip — decides whether an error is transient (flippable)
// ────────────────────────────────────────────────────────────────────────────

function shouldTripForLLM(err: unknown): boolean {
  // FailoverErrors carry a classified reason; only trip on transient reasons.
  if (err instanceof FailoverError) {
    return TRIPPABLE_REASONS.has(err.reason);
  }

  // Generic network / timeout errors.
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("timeout") ||
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("socket hang up") ||
      msg.includes("fetch failed")
    ) {
      return true;
    }
    // HTTP status codes embedded in error messages or properties
    const status =
      (err as { status?: number; statusCode?: number }).status ??
      (err as { statusCode?: number }).statusCode;
    if (typeof status === "number") {
      // 429 = rate limited, 5xx = server error — both should trip.
      return status === 429 || status >= 500;
    }
  }

  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Return the circuit breaker for a given LLM provider (e.g. `"anthropic"`,
 * `"openai"`, `"google"`). Creates it on first access with LLM-tuned
 * defaults.
 */
const diagnosticHandler = makeDiagnosticStateChangeHandler();

export function getLLMProviderBreaker(provider: string): CircuitBreaker<unknown> {
  const name = `llm:${provider}`;
  return circuitBreakerRegistry.getOrCreate(name, {
    ...LLM_PROVIDER_DEFAULTS,
    shouldTrip: shouldTripForLLM,
    onStateChange: (event) => {
      const logFn = event.to === "open" ? console.warn : console.info;
      logFn(
        `[circuit-breaker] LLM provider "${provider}": ${event.from} → ${event.to}` +
          (event.to === "open" ? ` (after ${event.failures} failures)` : ""),
      );
      diagnosticHandler?.(event);
    },
  });
}

/**
 * Check whether a provider's circuit is currently allowing requests.
 * Useful for pre-flight checks in model selection / failover logic to skip
 * a provider whose circuit is open before attempting an API call.
 */
export function isLLMProviderAvailable(provider: string): boolean {
  const name = `llm:${provider}`;
  const breaker = circuitBreakerRegistry.get(name);
  // If no breaker exists yet, the provider has never been called — allow it.
  if (!breaker) return true;
  return breaker.canExecute();
}

/**
 * Record a successful LLM call for a provider.
 * Call this when `runEmbeddedAttempt` completes without error.
 */
export function recordLLMProviderSuccess(provider: string): void {
  const breaker = circuitBreakerRegistry.get(`llm:${provider}`);
  breaker?.recordSuccess();
}

/**
 * Record a failed LLM call for a provider.
 * Call this when `runEmbeddedAttempt` fails with a transient error.
 */
export function recordLLMProviderFailure(provider: string, err: unknown): void {
  const breaker = circuitBreakerRegistry.get(`llm:${provider}`) ?? getLLMProviderBreaker(provider);
  breaker.recordFailure(err);
}

/**
 * Convert a `CircuitOpenError` to a `FailoverError` so the existing model
 * fallback system can handle it seamlessly.
 */
export function circuitOpenToFailover(
  err: CircuitOpenError,
  provider: string,
  model?: string,
): FailoverError {
  return new FailoverError(`Provider "${provider}" circuit breaker is open — ${err.message}`, {
    reason: "rate_limit",
    provider,
    model,
    status: 429,
  });
}
