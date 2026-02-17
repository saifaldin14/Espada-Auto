/**
 * Azure Extension — Retry Utilities
 *
 * Azure-specific retry logic with exponential backoff and jitter.
 * Mirrors the pattern from the AWS extension retry module.
 */

import type { AzureRetryOptions } from "./types.js";

// =============================================================================
// Configuration
// =============================================================================

export type RetryConfig = Required<AzureRetryOptions>;

export const AZURE_RETRY_DEFAULTS: RetryConfig = {
  maxAttempts: 3,
  minDelayMs: 100,
  maxDelayMs: 30_000,
  jitterFactor: 0.2,
};

/**
 * Azure error codes that are safe to retry.
 */
export const AZURE_RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EPIPE",
  "EAI_AGAIN",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
  "RequestTimeout",
  "ServiceUnavailable",
  "InternalServerError",
  "ServerBusy",
  "TooManyRequests",
  "OperationTimedOut",
  "GatewayTimeout",
  "ServiceTimeout",
  "RetryableError",
  "ThrottlingException",
  "RequestRateTooLarge",
  "Conflict",
]);

// =============================================================================
// Error Checking
// =============================================================================

/**
 * Determine whether an Azure error is safe to retry.
 */
export function shouldRetryAzureError(error: unknown): boolean {
  if (error === null || error === undefined) return false;

  const err = error as Record<string, unknown>;

  // Check error code
  const code = (err.code ?? err.Code ?? "") as string;
  if (code && AZURE_RETRYABLE_CODES.has(code)) return true;

  // Check HTTP status code (429 = throttled, 5xx = server errors)
  const statusCode = (err.statusCode ?? err.status ?? 0) as number;
  if (statusCode === 429) return true;
  if (statusCode >= 500 && statusCode < 600) return true;

  // Check error message patterns
  const message = ((err.message ?? "") as string).toLowerCase();
  const retryablePatterns = [
    "throttl",
    "too many requests",
    "rate limit",
    "server busy",
    "temporarily unavailable",
    "service unavailable",
    "connection reset",
    "socket hang up",
    "econnreset",
    "etimedout",
    "network error",
    "fetch failed",
  ];
  for (const pattern of retryablePatterns) {
    if (message.includes(pattern)) return true;
  }

  return false;
}

/**
 * Extract Retry-After header value from an Azure error response (in ms).
 */
export function getAzureRetryAfterMs(error: unknown): number | null {
  if (error === null || error === undefined) return null;

  const err = error as Record<string, unknown>;
  const headers = err.headers as Record<string, string> | undefined;
  if (!headers) return null;

  const retryAfter = headers["retry-after"] ?? headers["Retry-After"];
  if (!retryAfter) return null;

  // Could be seconds (integer) or HTTP date
  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds)) return seconds * 1000;

  const date = new Date(retryAfter);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return null;
}

// =============================================================================
// Retry Execution
// =============================================================================

/**
 * Execute a function with Azure-specific retry logic.
 */
export async function withAzureRetry<T>(
  fn: () => Promise<T>,
  options?: AzureRetryOptions,
): Promise<T> {
  const config: RetryConfig = {
    maxAttempts: options?.maxAttempts ?? AZURE_RETRY_DEFAULTS.maxAttempts,
    minDelayMs: options?.minDelayMs ?? AZURE_RETRY_DEFAULTS.minDelayMs,
    maxDelayMs: options?.maxDelayMs ?? AZURE_RETRY_DEFAULTS.maxDelayMs,
    jitterFactor: options?.jitterFactor ?? AZURE_RETRY_DEFAULTS.jitterFactor,
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= config.maxAttempts) break;
      if (!shouldRetryAzureError(error)) break;

      // Calculate delay with exponential backoff + jitter
      const retryAfterMs = getAzureRetryAfterMs(error);
      let delayMs: number;

      if (retryAfterMs !== null) {
        delayMs = retryAfterMs;
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
}

/**
 * Create a pre-configured retry runner.
 */
export function createAzureRetryRunner(options?: AzureRetryOptions) {
  return <T>(fn: () => Promise<T>) => withAzureRetry(fn, options);
}

// =============================================================================
// Error Formatting
// =============================================================================

/**
 * Format an Azure error into a human-readable message.
 */
export function formatErrorMessage(error: unknown): string {
  if (error === null || error === undefined) return "Unknown error";
  if (typeof error === "string") return error;

  const err = error as Record<string, unknown>;
  const code = (err.code ?? "") as string;
  const message = (err.message ?? "Unknown error") as string;
  const statusCode = (err.statusCode ?? "") as string | number;

  const parts: string[] = [];
  if (code) parts.push(`[${code}]`);
  if (statusCode) parts.push(`(HTTP ${statusCode})`);
  parts.push(message);

  return parts.join(" ");
}
