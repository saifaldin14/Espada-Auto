import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createAWSRetryRunner,
  withAWSRetry,
  awsRetry,
  shouldRetryAWSError,
  getAWSRetryAfterMs,
  AWS_RETRY_DEFAULTS,
} from "./retry.js";

describe("AWS Retry Utilities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("AWS_RETRY_DEFAULTS", () => {
    it("should have sensible defaults", () => {
      expect(AWS_RETRY_DEFAULTS.attempts).toBe(3);
      expect(AWS_RETRY_DEFAULTS.minDelayMs).toBe(100);
      expect(AWS_RETRY_DEFAULTS.maxDelayMs).toBe(30_000);
      expect(AWS_RETRY_DEFAULTS.jitter).toBe(0.2);
    });
  });

  describe("shouldRetryAWSError", () => {
    it("should retry ThrottlingException", () => {
      const error = new Error("ThrottlingException");
      (error as any).name = "ThrottlingException";
      expect(shouldRetryAWSError(error, 1)).toBe(true);
    });

    it("should retry TooManyRequestsException", () => {
      const error = new Error("TooManyRequestsException");
      (error as any).name = "TooManyRequestsException";
      expect(shouldRetryAWSError(error, 1)).toBe(true);
    });

    it("should retry ServiceUnavailable", () => {
      const error = new Error("ServiceUnavailable");
      (error as any).name = "ServiceUnavailable";
      expect(shouldRetryAWSError(error, 1)).toBe(true);
    });

    it("should retry 429 status code", () => {
      const error = new Error("Rate limit exceeded");
      (error as any).name = "SomeError";
      (error as any).$metadata = { httpStatusCode: 429 };
      expect(shouldRetryAWSError(error, 1)).toBe(true);
    });

    it("should retry 503 status code", () => {
      const error = new Error("Service unavailable");
      (error as any).name = "SomeError";
      (error as any).$metadata = { httpStatusCode: 503 };
      expect(shouldRetryAWSError(error, 1)).toBe(true);
    });

    it("should retry on throttling message", () => {
      const error = new Error("Request was throttled");
      expect(shouldRetryAWSError(error, 1)).toBe(true);
    });

    it("should retry on rate limit message", () => {
      const error = new Error("Rate limit exceeded");
      expect(shouldRetryAWSError(error, 1)).toBe(true);
    });

    it("should retry on timeout message", () => {
      const error = new Error("Connection timeout");
      expect(shouldRetryAWSError(error, 1)).toBe(true);
    });

    it("should retry ECONNRESET", () => {
      const error = new Error("ECONNRESET");
      (error as any).code = "ECONNRESET";
      expect(shouldRetryAWSError(error, 1)).toBe(true);
    });

    it("should not retry non-retryable errors", () => {
      const error = new Error("Access denied");
      (error as any).name = "AccessDeniedException";
      expect(shouldRetryAWSError(error, 1)).toBe(false);
    });

    it("should not retry null/undefined", () => {
      expect(shouldRetryAWSError(null, 1)).toBe(false);
      expect(shouldRetryAWSError(undefined, 1)).toBe(false);
    });
  });

  describe("getAWSRetryAfterMs", () => {
    it("should extract retry-after from 429 response", () => {
      const error = {
        $metadata: { httpStatusCode: 429 },
        $response: { headers: { "retry-after": "5" } },
      };
      expect(getAWSRetryAfterMs(error)).toBe(5000);
    });

    it("should extract retry-after from 503 response", () => {
      const error = {
        $metadata: { httpStatusCode: 503 },
        $response: { headers: { "retry-after": "10" } },
      };
      expect(getAWSRetryAfterMs(error)).toBe(10000);
    });

    it("should return undefined for non-retryable responses", () => {
      const error = {
        $metadata: { httpStatusCode: 400 },
        $response: { headers: { "retry-after": "5" } },
      };
      expect(getAWSRetryAfterMs(error)).toBeUndefined();
    });

    it("should return undefined for missing retry-after header", () => {
      const error = {
        $metadata: { httpStatusCode: 429 },
        $response: { headers: {} },
      };
      expect(getAWSRetryAfterMs(error)).toBeUndefined();
    });

    it("should return undefined for null/undefined", () => {
      expect(getAWSRetryAfterMs(null)).toBeUndefined();
      expect(getAWSRetryAfterMs(undefined)).toBeUndefined();
    });
  });

  describe("createAWSRetryRunner", () => {
    it("should succeed on first attempt", async () => {
      const runner = createAWSRetryRunner();
      const fn = vi.fn().mockResolvedValue("success");

      const result = await runner(fn, "test-op");

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on throttling error", async () => {
      const runner = createAWSRetryRunner({ retry: { attempts: 3 } });
      const throttleError = new Error("ThrottlingException");
      (throttleError as any).name = "ThrottlingException";

      const fn = vi
        .fn()
        .mockRejectedValueOnce(throttleError)
        .mockResolvedValue("success");

      const resultPromise = runner(fn, "test-op");
      
      // Advance timers to allow retry
      await vi.advanceTimersByTimeAsync(1000);
      
      const result = await resultPromise;
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should call onRetry callback", async () => {
      const onRetry = vi.fn();
      const runner = createAWSRetryRunner({ onRetry, verbose: false });
      const throttleError = new Error("ThrottlingException");
      (throttleError as any).name = "ThrottlingException";

      const fn = vi
        .fn()
        .mockRejectedValueOnce(throttleError)
        .mockResolvedValue("success");

      const resultPromise = runner(fn, "test-op");
      await vi.advanceTimersByTimeAsync(1000);
      await resultPromise;

      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          label: "test-op",
        })
      );
    });

    it("should throw after max attempts", async () => {
      const runner = createAWSRetryRunner({ retry: { attempts: 2 } });
      const throttleError = new Error("ThrottlingException");
      (throttleError as any).name = "ThrottlingException";

      const fn = vi.fn().mockRejectedValue(throttleError);

      const resultPromise = runner(fn, "test-op");

      // Attach rejection handler immediately to prevent unhandled rejection,
      // then flush all timers so the retry loop runs to completion
      const rejection = expect(resultPromise).rejects.toThrow("ThrottlingException");
      await vi.runAllTimersAsync();
      await rejection;

      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("withAWSRetry", () => {
    it("should wrap function with retry logic", async () => {
      const fn = vi.fn().mockResolvedValue("result");

      const result = await withAWSRetry(fn, { label: "test" });

      expect(result).toBe("result");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("awsRetry (default instance)", () => {
    it("should be available as default export", () => {
      expect(typeof awsRetry).toBe("function");
    });
  });
});
