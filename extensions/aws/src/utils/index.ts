/**
 * AWS Utilities Module
 *
 * Shared helpers used across the AWS extension:
 * - ARN parsing and building
 * - AWS API pagination
 * - Error formatting / classification
 * - Retry with exponential back-off
 * - Size / duration formatting
 */

export { which, commandExists } from "./which.js";

// =============================================================================
// ARN Parsing
// =============================================================================

/** Parsed components of an AWS ARN */
export interface ParsedArn {
  partition: string;
  service: string;
  region: string;
  accountId: string;
  resource: string;
  resourceType?: string;
  resourceId?: string;
}

/**
 * Parse an ARN string into its components.
 *
 * Supports both `:` and `/` resource delimiters.
 * @example parseArn("arn:aws:s3:::my-bucket") → { service: "s3", resource: "my-bucket", … }
 * @example parseArn("arn:aws:iam::123456:role/MyRole") → { resourceType: "role", resourceId: "MyRole", … }
 */
export function parseArn(arn: string): ParsedArn | null {
  // arn:partition:service:region:account-id:resource-type/resource-id
  // arn:partition:service:region:account-id:resource-type:resource-id
  // arn:partition:service:region:account-id:resource-id
  const match = arn.match(
    /^arn:([^:]+):([^:]+):([^:]*):([^:]*):(.+)$/,
  );
  if (!match) return null;

  const [, partition, service, region, accountId, resource] = match;

  let resourceType: string | undefined;
  let resourceId: string | undefined;

  // Try "/" delimiter first (iam, ecs, etc.)
  const slashIdx = resource.indexOf("/");
  if (slashIdx !== -1) {
    resourceType = resource.slice(0, slashIdx);
    resourceId = resource.slice(slashIdx + 1);
  } else {
    // Try ":" delimiter (sns, sqs, etc.)
    const colonIdx = resource.indexOf(":");
    if (colonIdx !== -1) {
      resourceType = resource.slice(0, colonIdx);
      resourceId = resource.slice(colonIdx + 1);
    }
  }

  return { partition, service, region, accountId, resource, resourceType, resourceId };
}

/**
 * Build an ARN string from components.
 */
export function buildArn(parts: {
  partition?: string;
  service: string;
  region?: string;
  accountId?: string;
  resource: string;
}): string {
  return [
    "arn",
    parts.partition ?? "aws",
    parts.service,
    parts.region ?? "",
    parts.accountId ?? "",
    parts.resource,
  ].join(":");
}

// =============================================================================
// Pagination Helper
// =============================================================================

/** Options for paginating an AWS SDK v3 command. */
export interface PaginateOptions<TOutput> {
  /** The token field name in the response (e.g. "NextToken"). */
  tokenField?: string;
  /** Maximum number of pages to fetch (safety valve). */
  maxPages?: number;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Called after each page — return `false` to stop early. */
  onPage?: (page: TOutput, pageIndex: number) => boolean | void;
}

/**
 * Generic paginator for any AWS SDK v3 client + command pair.
 *
 * Iterates until `tokenField` is absent in the response or `maxPages` is reached.
 *
 * @example
 * const pages = await paginate(ec2, DescribeInstancesCommand, { Filters: [] }, { tokenField: "NextToken" });
 */
export async function paginate<
  TClient extends { send: (cmd: unknown) => Promise<unknown> },
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>,
>(
  client: TClient,
  CommandClass: new (input: TInput) => { input: TInput },
  baseInput: TInput,
  opts: PaginateOptions<TOutput> = {},
): Promise<TOutput[]> {
  const tokenField = opts.tokenField ?? "NextToken";
  const maxPages = opts.maxPages ?? 100;
  const pages: TOutput[] = [];

  let nextToken: string | undefined;
  let pageIndex = 0;

  do {
    if (opts.signal?.aborted) break;

    const input: TInput = nextToken
      ? { ...baseInput, [tokenField]: nextToken }
      : { ...baseInput };

    const result: TOutput = await client.send(new CommandClass(input));
    pages.push(result);

    if (opts.onPage?.(result, pageIndex) === false) break;

    nextToken = (result as Record<string, unknown>)[tokenField] as
      | string
      | undefined;
    pageIndex++;
  } while (nextToken && pageIndex < maxPages);

  return pages;
}

// =============================================================================
// Error Classification
// =============================================================================

/** Standard error categories for AWS errors */
export type AWSErrorCategory =
  | "auth"
  | "permission"
  | "throttle"
  | "not-found"
  | "conflict"
  | "validation"
  | "limit"
  | "network"
  | "service"
  | "unknown";

export interface ClassifiedError {
  category: AWSErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  /** Suggested wait in ms before retry (only set for throttle / service). */
  retryAfterMs?: number;
  raw: unknown;
}

/**
 * Classify an AWS SDK error into a standard category.
 *
 * Works with SDK v3 `ServiceException` shapes as well as plain Error.
 */
export function classifyError(error: unknown): ClassifiedError {
  const err = error as Record<string, unknown>;
  const code = (err.Code ?? err.name ?? "") as string;
  const message =
    (err.message as string) ?? (err.Message as string) ?? String(error);

  // Auth errors
  if (
    code.includes("ExpiredToken") ||
    code.includes("InvalidClientToken") ||
    code === "AuthFailure" ||
    code.includes("SignatureDoesNotMatch")
  ) {
    return { category: "auth", code, message, retryable: false, raw: error };
  }

  // Permission errors
  if (
    code === "AccessDenied" ||
    code === "AccessDeniedException" ||
    code === "UnauthorizedAccess" ||
    code.includes("Unauthorized")
  ) {
    return { category: "permission", code, message, retryable: false, raw: error };
  }

  // Throttling
  if (
    code === "Throttling" ||
    code === "ThrottlingException" ||
    code === "TooManyRequestsException" ||
    code === "RequestLimitExceeded"
  ) {
    return {
      category: "throttle",
      code,
      message,
      retryable: true,
      retryAfterMs: 1000,
      raw: error,
    };
  }

  // Not found
  if (
    code.includes("NotFound") ||
    code.includes("NoSuch") ||
    code === "ResourceNotFoundException"
  ) {
    return { category: "not-found", code, message, retryable: false, raw: error };
  }

  // Conflict / already exists
  if (
    code.includes("AlreadyExists") ||
    code.includes("Conflict") ||
    code.includes("Duplicate")
  ) {
    return { category: "conflict", code, message, retryable: false, raw: error };
  }

  // Validation
  if (
    code.includes("Validation") ||
    code === "InvalidParameterValue" ||
    code === "MalformedInput"
  ) {
    return { category: "validation", code, message, retryable: false, raw: error };
  }

  // Limit / quota
  if (
    code.includes("LimitExceeded") ||
    code.includes("QuotaExceeded")
  ) {
    return { category: "limit", code, message, retryable: false, raw: error };
  }

  // Service errors (5xx or generic)
  if (
    code.includes("InternalError") ||
    code.includes("ServiceUnavailable") ||
    code.includes("ServiceException")
  ) {
    return {
      category: "service",
      code,
      message,
      retryable: true,
      retryAfterMs: 2000,
      raw: error,
    };
  }

  // Network / timeout
  if (
    code === "TimeoutError" ||
    code === "NetworkingError" ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT")
  ) {
    return {
      category: "network",
      code,
      message,
      retryable: true,
      retryAfterMs: 3000,
      raw: error,
    };
  }

  return { category: "unknown", code, message, retryable: false, raw: error };
}

// =============================================================================
// Retry with Back-Off
// =============================================================================

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms. Default: 1000 */
  baseDelayMs?: number;
  /** Maximum delay in ms. Default: 30 000 */
  maxDelayMs?: number;
  /** Jitter factor 0..1. Default: 0.2 */
  jitter?: number;
  /** AbortSignal */
  signal?: AbortSignal;
  /** Only retry when this predicate returns true. Default: retryable errors. */
  shouldRetry?: (error: ClassifiedError, attempt: number) => boolean;
  /** Called before each retry. */
  onRetry?: (error: ClassifiedError, attempt: number, delayMs: number) => void;
}

/**
 * Retry an async operation with exponential back-off and jitter.
 *
 * Uses {@link classifyError} to decide retryability.
 *
 * @example
 * const instances = await retry(() => ec2.send(new DescribeInstancesCommand({})));
 */
export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 1000;
  const maxDelay = opts.maxDelayMs ?? 30_000;
  const jitter = opts.jitter ?? 0.2;
  const shouldRetry =
    opts.shouldRetry ?? ((classified) => classified.retryable);

  let lastError: ClassifiedError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = classifyError(error);

      if (attempt >= maxAttempts || !shouldRetry(lastError, attempt)) {
        throw error;
      }

      if (opts.signal?.aborted) throw error;

      // Exponential back-off with jitter
      const expDelay = baseDelay * 2 ** (attempt - 1);
      const jitteredDelay =
        expDelay * (1 - jitter + Math.random() * jitter * 2);
      const delayMs = Math.min(jitteredDelay, maxDelay);

      opts.onRetry?.(lastError, attempt, delayMs);

      await sleep(delayMs, opts.signal);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError?.raw ?? new Error("Retry exhausted");
}

// =============================================================================
// Formatting Helpers
// =============================================================================

/**
 * Format byte count into a human-readable string.
 * @example formatBytes(1_048_576) → "1.0 MiB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const i = Math.floor(Math.log2(Math.abs(bytes)) / 10);
  const idx = Math.min(i, units.length - 1);
  const value = bytes / 2 ** (idx * 10);
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

/**
 * Format a duration in seconds into a human-readable string.
 * @example formatDuration(3661) → "1h 1m 1s"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

/**
 * Format a cost value in USD.
 * @example formatCost(12.5) → "$12.50"
 */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/**
 * Truncate a string to `max` chars with ellipsis.
 */
export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

// =============================================================================
// Internal helpers
// =============================================================================

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
