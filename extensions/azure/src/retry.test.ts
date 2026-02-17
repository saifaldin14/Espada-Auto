/**
 * Azure Extension — Retry Tests
 */

import { describe, it, expect, vi } from "vitest";
import {
  shouldRetryAzureError,
  getAzureRetryAfterMs,
  withAzureRetry,
  formatErrorMessage,
  AZURE_RETRYABLE_CODES,
} from "./retry.js";

describe("shouldRetryAzureError", () => {
  it("returns false for null/undefined", () => {
    expect(shouldRetryAzureError(null)).toBe(false);
    expect(shouldRetryAzureError(undefined)).toBe(false);
  });

  it("retries known Azure error codes", () => {
    for (const code of AZURE_RETRYABLE_CODES) {
      expect(shouldRetryAzureError({ code })).toBe(true);
    }
  });

  it("retries HTTP 429 (throttled)", () => {
    expect(shouldRetryAzureError({ statusCode: 429 })).toBe(true);
  });

  it("retries HTTP 5xx errors", () => {
    expect(shouldRetryAzureError({ statusCode: 500 })).toBe(true);
    expect(shouldRetryAzureError({ statusCode: 502 })).toBe(true);
    expect(shouldRetryAzureError({ statusCode: 503 })).toBe(true);
  });

  it("does not retry HTTP 4xx (except 429)", () => {
    expect(shouldRetryAzureError({ statusCode: 400 })).toBe(false);
    expect(shouldRetryAzureError({ statusCode: 403 })).toBe(false);
    expect(shouldRetryAzureError({ statusCode: 404 })).toBe(false);
  });

  it("retries errors with retryable message patterns", () => {
    expect(shouldRetryAzureError({ message: "Too Many Requests" })).toBe(true);
    expect(shouldRetryAzureError({ message: "Service temporarily unavailable" })).toBe(true);
    expect(shouldRetryAzureError({ message: "connection reset by peer" })).toBe(true);
  });

  it("does not retry non-retryable errors", () => {
    expect(shouldRetryAzureError({ code: "ResourceNotFound" })).toBe(false);
    expect(shouldRetryAzureError({ message: "Invalid parameter" })).toBe(false);
  });
});

describe("getAzureRetryAfterMs", () => {
  it("returns null for null/undefined", () => {
    expect(getAzureRetryAfterMs(null)).toBe(null);
    expect(getAzureRetryAfterMs(undefined)).toBe(null);
  });

  it("returns null when no headers", () => {
    expect(getAzureRetryAfterMs({ message: "error" })).toBe(null);
  });

  it("parses numeric retry-after (seconds)", () => {
    expect(getAzureRetryAfterMs({ headers: { "retry-after": "5" } })).toBe(5000);
  });

  it("returns null for missing retry-after header", () => {
    expect(getAzureRetryAfterMs({ headers: {} })).toBe(null);
  });
});

describe("withAzureRetry", () => {
  it("returns result on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withAzureRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ code: "TooManyRequests", statusCode: 429 })
      .mockResolvedValue("ok");

    const result = await withAzureRetry(fn, { maxAttempts: 3, minDelayMs: 1, maxDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const error = { code: "ServiceUnavailable", statusCode: 503, message: "Down" };
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withAzureRetry(fn, { maxAttempts: 2, minDelayMs: 1, maxDelayMs: 10 }),
    ).rejects.toEqual(error);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const error = { code: "ResourceNotFound", statusCode: 404, message: "Not found" };
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withAzureRetry(fn, { maxAttempts: 3, minDelayMs: 1, maxDelayMs: 10 }),
    ).rejects.toEqual(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("formatErrorMessage", () => {
  it("handles null/undefined", () => {
    expect(formatErrorMessage(null)).toBe("Unknown error");
    expect(formatErrorMessage(undefined)).toBe("Unknown error");
  });

  it("handles string errors", () => {
    expect(formatErrorMessage("boom")).toBe("boom");
  });

  it("formats error with code and status", () => {
    const result = formatErrorMessage({ code: "Forbidden", statusCode: 403, message: "Access denied" });
    expect(result).toContain("[Forbidden]");
    expect(result).toContain("(HTTP 403)");
    expect(result).toContain("Access denied");
  });
});
