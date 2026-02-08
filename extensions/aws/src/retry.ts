/**
 * AWS Retry Runner
 *
 * Unified retry logic for AWS API calls.
 * Handles AWS-specific throttling, rate limiting, and transient errors.
 *
 * This module is self-contained to avoid tsconfig rootDir issues.
 * It implements the same patterns as src/infra/retry.ts.
 */

/**
 * Retry configuration options
 */
export type RetryConfig = {
  attempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
};

/**
 * Retry attempt information
 */
export type RetryInfo = {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  err: unknown;
  label?: string;
};

/**
 * Retry options
 */
export type RetryOptions = RetryConfig & {
  label?: string;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  retryAfterMs?: (err: unknown) => number | undefined;
  onRetry?: (info: RetryInfo) => void;
};

/**
 * Default retry configuration for AWS API calls
 */
export const AWS_RETRY_DEFAULTS: Required<RetryConfig> = {
  attempts: 3,
  minDelayMs: 100,
  maxDelayMs: 30_000,
  jitter: 0.2,
};

// =============================================================================
// Helper Functions (self-contained versions of core utilities)
// =============================================================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Extract error code from an error object
 */
export function extractErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") return code;
  if (typeof code === "number") return String(code);
  return undefined;
}

/**
 * Format error message from any error type
 */
export function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name || "Error";
  }
  if (typeof err === "string") return err;
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") {
    return String(err);
  }
  try {
    return JSON.stringify(err);
  } catch {
    return Object.prototype.toString.call(err);
  }
}

function resolveRetryConfig(
  defaults: Required<RetryConfig>,
  overrides?: RetryConfig,
): Required<RetryConfig> {
  const attempts = Math.max(1, Math.round(overrides?.attempts ?? defaults.attempts));
  const minDelayMs = Math.max(0, Math.round(overrides?.minDelayMs ?? defaults.minDelayMs));
  const maxDelayMs = Math.max(minDelayMs, Math.round(overrides?.maxDelayMs ?? defaults.maxDelayMs));
  const jitter = Math.min(1, Math.max(0, overrides?.jitter ?? defaults.jitter));
  return { attempts, minDelayMs, maxDelayMs, jitter };
}

function applyJitter(delayMs: number, jitter: number): number {
  if (jitter <= 0) return delayMs;
  const offset = (Math.random() * 2 - 1) * jitter;
  return Math.max(0, Math.round(delayMs * (1 + offset)));
}

async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const resolved = resolveRetryConfig(AWS_RETRY_DEFAULTS, options);
  const maxAttempts = resolved.attempts;
  const minDelayMs = resolved.minDelayMs;
  const maxDelayMs = resolved.maxDelayMs;
  const jitter = resolved.jitter;
  const shouldRetry = options.shouldRetry ?? (() => true);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) break;

      const retryAfterMs = options.retryAfterMs?.(err);
      const hasRetryAfter = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs);
      const baseDelay = hasRetryAfter
        ? Math.max(retryAfterMs, minDelayMs)
        : minDelayMs * 2 ** (attempt - 1);
      let delay = Math.min(baseDelay, maxDelayMs);
      delay = applyJitter(delay, jitter);
      delay = Math.min(Math.max(delay, minDelayMs), maxDelayMs);

      options.onRetry?.({
        attempt,
        maxAttempts,
        delayMs: delay,
        err,
        label: options.label,
      });
      await sleep(delay);
    }
  }

  throw lastErr ?? new Error("Retry failed");
}

// =============================================================================
// AWS-Specific Retry Logic
// =============================================================================

/**
 * Pattern matching AWS throttling and transient errors
 */
const AWS_RETRY_PATTERN =
  /throttl|rate|limit|503|504|timeout|connect|reset|ECONNRESET|ETIMEDOUT|TooManyRequestsException|ServiceUnavailable|RequestLimitExceeded|ProvisionedThroughputExceededException|SlowDown/i;

/**
 * AWS error codes that should always be retried
 */
const AWS_RETRYABLE_CODES = new Set([
  "ThrottlingException",
  "Throttling",
  "TooManyRequestsException",
  "RequestLimitExceeded",
  "ProvisionedThroughputExceededException",
  "ServiceUnavailable",
  "ServiceUnavailableException",
  "InternalError",
  "InternalServiceError",
  "InternalServerError",
  "SlowDown",
  "EC2ThrottledException",
  "RequestThrottled",
  "BandwidthLimitExceeded",
  "RequestTimeout",
  "PriorRequestNotComplete",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ECONNREFUSED",
]);

/**
 * Check if an error is an AWS SDK error
 */
function isAWSError(err: unknown): err is Error & { name: string; $metadata?: { httpStatusCode?: number } } {
  return err instanceof Error && typeof (err as { name?: unknown }).name === "string";
}

/**
 * Extract retry-after delay from AWS error response
 */
export function getAWSRetryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;

  // Check for Retry-After header in AWS SDK v3 errors
  const metadata = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
  if (metadata?.httpStatusCode === 429 || metadata?.httpStatusCode === 503) {
    const retryAfter = (err as { $response?: { headers?: { "retry-after"?: string } } }).$response?.headers?.["retry-after"];
    if (typeof retryAfter === "string") {
      const seconds = parseInt(retryAfter, 10);
      if (!Number.isNaN(seconds)) return seconds * 1000;
    }
  }

  return undefined;
}

/**
 * Determine if an AWS error should be retried
 */
export function shouldRetryAWSError(err: unknown, _attempt: number): boolean {
  if (!err) return false;

  // Check for retryable error codes
  const code = extractErrorCode(err);
  if (code && AWS_RETRYABLE_CODES.has(code)) return true;

  // Check error name for AWS SDK v3 errors
  if (isAWSError(err)) {
    if (AWS_RETRYABLE_CODES.has(err.name)) return true;

    // Check HTTP status code
    const statusCode = err.$metadata?.httpStatusCode;
    if (statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504) {
      return true;
    }
  }

  // Check error message pattern
  const message = formatErrorMessage(err);
  if (AWS_RETRY_PATTERN.test(message)) return true;

  return false;
}

/**
 * AWS retry options type
 */
export type AWSRetryOptions = {
  retry?: RetryConfig;
  verbose?: boolean;
  label?: string;
  onRetry?: (info: RetryInfo) => void;
};

/**
 * Create an AWS retry runner function
 */
export function createAWSRetryRunner(options: AWSRetryOptions = {}) {
  const config = resolveRetryConfig(AWS_RETRY_DEFAULTS, options.retry);

  return async function awsRetry<T>(
    fn: () => Promise<T>,
    label?: string,
  ): Promise<T> {
    const retryOptions: RetryOptions = {
      ...config,
      label,
      shouldRetry: shouldRetryAWSError,
      retryAfterMs: getAWSRetryAfterMs,
      onRetry: (info) => {
        if (options.verbose) {
          console.warn(
            `[aws] ${info.label ?? "operation"} throttled, retry ${info.attempt}/${info.maxAttempts} in ${info.delayMs}ms`,
          );
        }
        options.onRetry?.(info);
      },
    };

    return retryAsync(fn, retryOptions);
  };
}

/**
 * Default AWS retry runner instance
 */
export const awsRetry = createAWSRetryRunner();

/**
 * Execute an AWS operation with retry logic
 *
 * @example
 * ```typescript
 * const result = await withAWSRetry(
 *   () => ec2Client.send(new DescribeInstancesCommand({})),
 *   { label: "DescribeInstances" }
 * );
 * ```
 */
export async function withAWSRetry<T>(
  fn: () => Promise<T>,
  options?: { label?: string } & AWSRetryOptions,
): Promise<T> {
  const runner = options?.retry || options?.verbose || options?.onRetry
    ? createAWSRetryRunner(options)
    : awsRetry;

  return runner(fn, options?.label);
}
