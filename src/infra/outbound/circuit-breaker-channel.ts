/**
 * Circuit breaker integration for outbound channel delivery.
 *
 * Wraps per-channel outbound send calls with circuit breakers so that a
 * degraded channel endpoint (e.g. WhatsApp API down, Telegram rate limited)
 * fails fast instead of blocking the agent run with repeated timeouts.
 *
 * Uses the global {@link circuitBreakerRegistry} so that breaker state is
 * visible in the `/health` endpoint.
 *
 * @module
 */

import {
  circuitBreakerRegistry,
  makeDiagnosticStateChangeHandler,
  type CircuitBreakerConfig,
} from "../circuit-breaker.js";

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

/**
 * Default circuit breaker settings tuned for channel delivery.
 *
 * Channels are more tolerant of retries than LLM APIs (no token cost),
 * so we allow more failures before tripping, and use a shorter reset
 * timeout so that recovered endpoints are retried quickly.
 */
const CHANNEL_DEFAULTS: Required<
  Pick<CircuitBreakerConfig, "failureThreshold" | "resetTimeoutMs" | "halfOpenMaxProbes">
> = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxProbes: 2,
};

// ────────────────────────────────────────────────────────────────────────────
// shouldTrip — only trip on network / server errors, not app-level issues
// ────────────────────────────────────────────────────────────────────────────

function shouldTripForChannel(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Network-level failures
  if (
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("unavailable")
  ) {
    return true;
  }
  // HTTP status codes
  const status =
    (err as { status?: number; statusCode?: number }).status ??
    (err as { statusCode?: number }).statusCode;
  if (typeof status === "number") {
    return status === 429 || status >= 500;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Return the circuit breaker for a given channel (e.g. `"whatsapp"`,
 * `"telegram"`, `"slack"`). Optionally scoped to an account.
 * Creates it on first access with channel-tuned defaults.
 */
const diagnosticHandler = makeDiagnosticStateChangeHandler();

export function getChannelBreaker(channel: string, accountId?: string) {
  const name = accountId ? `channel:${channel}:${accountId}` : `channel:${channel}`;
  return circuitBreakerRegistry.getOrCreate(name, {
    ...CHANNEL_DEFAULTS,
    shouldTrip: shouldTripForChannel,
    onStateChange: (event) => {
      const logFn = event.to === "open" ? console.warn : console.info;
      logFn(
        `[circuit-breaker] Channel "${channel}"${accountId ? ` (${accountId})` : ""}: ${event.from} → ${event.to}` +
          (event.to === "open" ? ` (after ${event.failures} failures)` : ""),
      );
      diagnosticHandler?.(event);
    },
  });
}

/**
 * Check whether a channel's circuit is currently allowing requests.
 */
export function isChannelAvailable(channel: string, accountId?: string): boolean {
  const name = accountId ? `channel:${channel}:${accountId}` : `channel:${channel}`;
  const breaker = circuitBreakerRegistry.get(name);
  if (!breaker) return true;
  return breaker.canExecute();
}

/**
 * Record a successful delivery for a channel.
 */
export function recordChannelSuccess(channel: string, accountId?: string): void {
  const name = accountId ? `channel:${channel}:${accountId}` : `channel:${channel}`;
  const breaker = circuitBreakerRegistry.get(name);
  breaker?.recordSuccess();
}

/**
 * Record a failed delivery for a channel.
 */
export function recordChannelFailure(channel: string, err: unknown, accountId?: string): void {
  const breaker = getChannelBreaker(channel, accountId);
  breaker.recordFailure(err);
}

/**
 * Wrap an async function with per-channel circuit breaker protection.
 * Returns the result if the circuit allows the call, or throws
 * `CircuitOpenError` if the circuit is open.
 *
 * @example
 * ```ts
 * const result = await withChannelBreaker("telegram", accountId, () =>
 *   sendMessageTelegram(to, text),
 * );
 * ```
 */
export async function withChannelBreaker<T>(
  channel: string,
  accountId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const breaker = getChannelBreaker(channel, accountId);
  return breaker.execute(fn) as Promise<T>;
}
