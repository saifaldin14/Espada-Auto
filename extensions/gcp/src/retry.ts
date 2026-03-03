/**
 * GCP Extension — Retry Utilities
 *
 * GCP-specific retry logic with exponential backoff and jitter.
 * Mirrors the pattern from the Azure/AWS extension retry modules.
 */

import type { GcpRetryOptions } from "./types.js";

// =============================================================================
// Configuration
// =============================================================================

export type RetryConfig = Required<Pick<GcpRetryOptions, "maxAttempts" | "minDelayMs" | "maxDelayMs" | "jitterFactor">>;

export const GCP_RETRY_DEFAULTS: RetryConfig = {
  maxAttempts: 3,
  minDelayMs: 100,
  maxDelayMs: 30_000,
  jitterFactor: 0.2,
};

/**
 * GCP error codes that are safe to retry.
 */
export const GCP_RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EPIPE",
  "EAI_AGAIN",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
  "UNAVAILABLE",
  "DEADLINE_EXCEEDED",
  "RESOURCE_EXHAUSTED",
  "ABORTED",
  "INTERNAL",
  "UNKNOWN",
  "SERVICE_UNAVAILABLE",
  "RATE_LIMIT_EXCEEDED",
  "rateLimitExceeded",
  "backendError",
  "internalError",
  "badGateway",
  "serviceUnavailable",
  "gatewayTimeout",
]);

// =============================================================================
// Error Checking
// =============================================================================

/**
 * Determine whether a GCP error is safe to retry.
 */
export function shouldRetryGcpError(error: unknown): boolean {
  if (error === null || error === undefined) return false;

  const err = error as Record<string, unknown>;

  // Check error code
  const code = (err.code ?? err.Code ?? "") as string;
  if (code && GCP_RETRYABLE_CODES.has(code)) return true;

  // Check HTTP status code (429 = throttled, 5xx = server errors)
  const statusCode = (err.statusCode ?? err.status ?? err.code ?? 0) as number;
  if (statusCode === 429) return true;
  if (typeof statusCode === "number" && statusCode >= 500 && statusCode < 600) return true;

  // Check gRPC status codes (14 = UNAVAILABLE, 8 = RESOURCE_EXHAUSTED, 4 = DEADLINE_EXCEEDED)
  if (statusCode === 14 || statusCode === 8 || statusCode === 4) return true;

  // Check error message patterns
  const message = ((err.message ?? "") as string).toLowerCase();
  const retryablePatterns = [
    "throttl",
    "too many requests",
    "rate limit",
    "quota exceeded",
    "temporarily unavailable",
    "service unavailable",
    "connection reset",
    "socket hang up",
    "econnreset",
    "etimedout",
    "network error",
    "fetch failed",
    "deadline exceeded",
    "backend error",
  ];
  for (const pattern of retryablePatterns) {
    if (message.includes(pattern)) return true;
  }

  return false;
}

/**
 * Extract Retry-After header value from a GCP error response (in ms).
 */
export function getGcpRetryAfterMs(error: unknown): number | null {
  if (error === null || error === undefined) return null;

  const err = error as Record<string, unknown>;
  const headers = err.headers as Record<string, string> | undefined;
  if (!headers) return null;

  const retryAfter = headers["retry-after"] ?? headers["Retry-After"];
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds)) return seconds * 1000;

  const date = new Date(retryAfter);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return null;
}

// ── Concurrency limiter (lightweight bulkhead for cloud API calls) ──
const MAX_CONCURRENT_GCP_CALLS = 20;
let _active = 0;
const _waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (_active < MAX_CONCURRENT_GCP_CALLS) {
    _active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => _waiters.push(() => { _active++; resolve(); }));
}

function releaseSlot(): void {
  _active--;
  if (_waiters.length > 0) _waiters.shift()!();
}

// =============================================================================
// Retry Execution
// =============================================================================

/**
 * Execute a function with GCP-specific retry logic and optional circuit breaker protection.
 *
 * When `options.service` is provided, the call is wrapped in a per-service
 * circuit breaker. If the service's circuit is open, the call is rejected
 * immediately without burning retry attempts.
 */
export async function withGcpRetry<T>(
  fn: () => Promise<T>,
  options?: GcpRetryOptions,
): Promise<T> {
  const doRetry = async () => {
    const config: RetryConfig = {
      maxAttempts: options?.maxAttempts ?? GCP_RETRY_DEFAULTS.maxAttempts,
      minDelayMs: options?.minDelayMs ?? GCP_RETRY_DEFAULTS.minDelayMs,
      maxDelayMs: options?.maxDelayMs ?? GCP_RETRY_DEFAULTS.maxDelayMs,
      jitterFactor: options?.jitterFactor ?? GCP_RETRY_DEFAULTS.jitterFactor,
    };

    let lastError: unknown;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt >= config.maxAttempts) break;
        if (!shouldRetryGcpError(error)) break;

        const retryAfterMs = getGcpRetryAfterMs(error);
        let delayMs: number;

        if (retryAfterMs !== null) {
          delayMs = Math.min(retryAfterMs, config.maxDelayMs);
        } else {
          const baseDelay = config.minDelayMs * 2 ** (attempt - 1);
          const cappedDelay = Math.min(baseDelay, config.maxDelayMs);
          const jitter = cappedDelay * config.jitterFactor * (Math.random() * 2 - 1);
          delayMs = Math.max(config.minDelayMs, cappedDelay + jitter);
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  };

  if (options?.service) {
    const { withGcpCircuitBreaker } = await import("./circuit-breaker.js");
    await acquireSlot();
    try {
      return await withGcpCircuitBreaker(
        options.service,
        doRetry,
        { projectId: options.projectId },
      );
    } finally {
      releaseSlot();
    }
  }

  await acquireSlot();
  try {
    return await doRetry();
  } finally {
    releaseSlot();
  }
}

/**
 * Create a pre-configured retry runner.
 */
export function createGcpRetryRunner(options?: GcpRetryOptions) {
  return <T>(fn: () => Promise<T>) => withGcpRetry(fn, options);
}

// =============================================================================
// Error Formatting
// =============================================================================

/**
 * Format a GCP error into a human-readable message.
 */
export function formatErrorMessage(error: unknown): string {
  if (error === null || error === undefined) return "Unknown error";
  if (typeof error === "string") return error;

  const err = error as Record<string, unknown>;
  const code = (err.code ?? "") as string;
  const message = (err.message ?? "Unknown error") as string;
  const statusCode = (err.statusCode ?? err.status ?? "") as string | number;

  const parts: string[] = [];
  if (code) parts.push(`[${code}]`);
  if (statusCode) parts.push(`(HTTP ${statusCode})`);
  parts.push(message);

  return parts.join(" ");
}
