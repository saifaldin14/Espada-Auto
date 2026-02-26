import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  GCP_RETRY_DEFAULTS,
  GCP_RETRYABLE_CODES,
  shouldRetryGcpError,
  getGcpRetryAfterMs,
  withGcpRetry,
  createGcpRetryRunner,
  formatErrorMessage,
} from "./retry.js";

// =============================================================================
// Defaults & Constants
// =============================================================================

describe("GCP_RETRY_DEFAULTS", () => {
  it("has expected default values", () => {
    expect(GCP_RETRY_DEFAULTS).toEqual({
      maxAttempts: 3,
      minDelayMs: 100,
      maxDelayMs: 30_000,
      jitterFactor: 0.2,
    });
  });
});

describe("GCP_RETRYABLE_CODES", () => {
  it("contains core network error codes", () => {
    for (const code of ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"]) {
      expect(GCP_RETRYABLE_CODES.has(code)).toBe(true);
    }
  });

  it("contains GCP-specific codes", () => {
    for (const code of ["UNAVAILABLE", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED"]) {
      expect(GCP_RETRYABLE_CODES.has(code)).toBe(true);
    }
  });
});

// =============================================================================
// shouldRetryGcpError
// =============================================================================

describe("shouldRetryGcpError", () => {
  it("returns true for retryable error code (ECONNRESET)", () => {
    expect(shouldRetryGcpError({ code: "ECONNRESET" })).toBe(true);
  });

  it("returns false for non-retryable error code", () => {
    expect(shouldRetryGcpError({ code: "ENOENT" })).toBe(false);
  });

  it("returns true for HTTP 429 (too many requests)", () => {
    expect(shouldRetryGcpError({ statusCode: 429 })).toBe(true);
  });

  it("returns true for HTTP 503 (service unavailable)", () => {
    expect(shouldRetryGcpError({ status: 503 })).toBe(true);
  });

  it("returns false for HTTP 400 (bad request)", () => {
    expect(shouldRetryGcpError({ statusCode: 400 })).toBe(false);
  });

  it("returns true for gRPC code 14 (UNAVAILABLE)", () => {
    expect(shouldRetryGcpError({ code: 14 })).toBe(true);
  });

  it("returns true for gRPC code 8 (RESOURCE_EXHAUSTED)", () => {
    expect(shouldRetryGcpError({ code: 8 })).toBe(true);
  });

  it("returns true for gRPC code 4 (DEADLINE_EXCEEDED)", () => {
    expect(shouldRetryGcpError({ code: 4 })).toBe(true);
  });

  it("returns true for 'rate limit' message pattern", () => {
    expect(shouldRetryGcpError({ message: "Rate Limit exceeded for project" })).toBe(true);
  });

  it("returns true for 'quota exceeded' message pattern", () => {
    expect(shouldRetryGcpError({ message: "Quota exceeded" })).toBe(true);
  });

  it("returns false for null", () => {
    expect(shouldRetryGcpError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(shouldRetryGcpError(undefined)).toBe(false);
  });
});

// =============================================================================
// getGcpRetryAfterMs
// =============================================================================

describe("getGcpRetryAfterMs", () => {
  it("parses numeric seconds header", () => {
    const error = { headers: { "retry-after": "5" } };
    expect(getGcpRetryAfterMs(error)).toBe(5000);
  });

  it("parses date string header", () => {
    const futureDate = new Date(Date.now() + 10_000).toUTCString();
    const error = { headers: { "retry-after": futureDate } };
    const ms = getGcpRetryAfterMs(error);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(10_000);
  });

  it("returns null when no headers present", () => {
    expect(getGcpRetryAfterMs({ message: "fail" })).toBeNull();
  });

  it("returns null when retry-after header is missing", () => {
    expect(getGcpRetryAfterMs({ headers: { "content-type": "text/plain" } })).toBeNull();
  });

  it("returns null for null error", () => {
    expect(getGcpRetryAfterMs(null)).toBeNull();
  });

  it("returns null for undefined error", () => {
    expect(getGcpRetryAfterMs(undefined)).toBeNull();
  });
});

// =============================================================================
// withGcpRetry
// =============================================================================

describe("withGcpRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on first successful attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withGcpRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries and succeeds on second attempt", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: "ECONNRESET" })
      .mockResolvedValue("recovered");

    const promise = withGcpRetry(fn, { maxAttempts: 3, minDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 });
    // advance past the backoff delay
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all retries", async () => {
    const error = { code: "ECONNRESET", message: "Connection reset" };
    const fn = vi.fn().mockRejectedValue(error);

    const promise = withGcpRetry(fn, { maxAttempts: 2, minDelayMs: 50, maxDelayMs: 200, jitterFactor: 0 });
    // Suppress unhandled rejection while timers advance
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).rejects.toEqual(error);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const error = { code: "ENOENT", message: "Not found" };
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withGcpRetry(fn, { maxAttempts: 3 })).rejects.toEqual(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects custom maxAttempts option", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: "UNAVAILABLE" })
      .mockRejectedValueOnce({ code: "UNAVAILABLE" })
      .mockResolvedValue("done");

    const promise = withGcpRetry(fn, { maxAttempts: 5, minDelayMs: 50, maxDelayMs: 500, jitterFactor: 0 });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// =============================================================================
// createGcpRetryRunner
// =============================================================================

describe("createGcpRetryRunner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a working retry runner", async () => {
    const runner = createGcpRetryRunner({ maxAttempts: 2, minDelayMs: 50, maxDelayMs: 200, jitterFactor: 0 });
    const fn = vi.fn().mockResolvedValue(42);
    const result = await runner(fn);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runner retries on retryable errors", async () => {
    const runner = createGcpRetryRunner({ maxAttempts: 3, minDelayMs: 50, maxDelayMs: 200, jitterFactor: 0 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: "ETIMEDOUT" })
      .mockResolvedValue("ok");

    const promise = runner(fn);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// formatErrorMessage
// =============================================================================

describe("formatErrorMessage", () => {
  it("formats error with code and status", () => {
    const result = formatErrorMessage({ code: "UNAVAILABLE", statusCode: 503, message: "Service down" });
    expect(result).toBe("[UNAVAILABLE] (HTTP 503) Service down");
  });

  it("formats error with message only", () => {
    const result = formatErrorMessage({ message: "Something went wrong" });
    expect(result).toBe("Something went wrong");
  });

  it("returns 'Unknown error' for null", () => {
    expect(formatErrorMessage(null)).toBe("Unknown error");
  });

  it("returns 'Unknown error' for undefined", () => {
    expect(formatErrorMessage(undefined)).toBe("Unknown error");
  });

  it("returns the string itself for string errors", () => {
    expect(formatErrorMessage("boom")).toBe("boom");
  });

  it("formats error with status field instead of statusCode", () => {
    const result = formatErrorMessage({ status: 500, message: "Internal" });
    expect(result).toBe("(HTTP 500) Internal");
  });
});
