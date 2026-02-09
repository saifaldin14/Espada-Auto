/**
 * AWS Utils Module Tests (new helpers)
 *
 * Covers ARN parsing/building, error classification, retry, and formatting.
 */

import { describe, it, expect, vi } from "vitest";
import {
  parseArn,
  buildArn,
  classifyError,
  retry,
  formatBytes,
  formatDuration,
  formatCost,
  truncate,
} from "./index.js";

// =============================================================================
// ARN parsing
// =============================================================================

describe("parseArn", () => {
  it("should parse an S3 bucket ARN", () => {
    const parsed = parseArn("arn:aws:s3:::my-bucket");
    expect(parsed).not.toBeNull();
    expect(parsed!.service).toBe("s3");
    expect(parsed!.partition).toBe("aws");
    expect(parsed!.resource).toBe("my-bucket");
  });

  it("should parse an IAM role ARN (slash delimiter)", () => {
    const parsed = parseArn("arn:aws:iam::123456789012:role/MyRole");
    expect(parsed).not.toBeNull();
    expect(parsed!.service).toBe("iam");
    expect(parsed!.accountId).toBe("123456789012");
    expect(parsed!.resourceType).toBe("role");
    expect(parsed!.resourceId).toBe("MyRole");
  });

  it("should parse an SNS topic ARN (colon delimiter)", () => {
    const parsed = parseArn("arn:aws:sns:us-east-1:123456789012:my-topic");
    expect(parsed).not.toBeNull();
    expect(parsed!.region).toBe("us-east-1");
    expect(parsed!.resource).toBe("my-topic");
  });

  it("should parse China partition ARNs", () => {
    const parsed = parseArn("arn:aws-cn:s3:::bucket");
    expect(parsed!.partition).toBe("aws-cn");
  });

  it("should parse GovCloud partition ARNs", () => {
    const parsed = parseArn("arn:aws-us-gov:s3:::bucket");
    expect(parsed!.partition).toBe("aws-us-gov");
  });

  it("should return null for invalid strings", () => {
    expect(parseArn("not-an-arn")).toBeNull();
    expect(parseArn("")).toBeNull();
    expect(parseArn("arn:aws:s3")).toBeNull();
  });
});

describe("buildArn", () => {
  it("should build a basic ARN", () => {
    const arn = buildArn({
      service: "s3",
      resource: "my-bucket",
    });
    expect(arn).toBe("arn:aws:s3:::my-bucket");
  });

  it("should include region and account when provided", () => {
    const arn = buildArn({
      service: "ec2",
      region: "us-west-2",
      accountId: "123456789012",
      resource: "instance/i-abc123",
    });
    expect(arn).toBe("arn:aws:ec2:us-west-2:123456789012:instance/i-abc123");
  });

  it("should support non-default partitions", () => {
    const arn = buildArn({
      partition: "aws-cn",
      service: "s3",
      resource: "bucket",
    });
    expect(arn).toContain("aws-cn");
  });

  it("round-trips with parseArn", () => {
    const original = "arn:aws:iam::123456789012:role/MyRole";
    const parsed = parseArn(original)!;
    const rebuilt = buildArn({
      partition: parsed.partition,
      service: parsed.service,
      region: parsed.region,
      accountId: parsed.accountId,
      resource: parsed.resource,
    });
    expect(rebuilt).toBe(original);
  });
});

// =============================================================================
// Error classification
// =============================================================================

describe("classifyError", () => {
  it("should classify throttling errors", () => {
    const result = classifyError({ name: "ThrottlingException", message: "Rate exceeded" });
    expect(result.category).toBe("throttle");
    expect(result.retryable).toBe(true);
  });

  it("should classify auth errors", () => {
    const result = classifyError({ name: "ExpiredTokenException", message: "Token expired" });
    expect(result.category).toBe("auth");
    expect(result.retryable).toBe(false);
  });

  it("should classify permission errors", () => {
    const result = classifyError({ name: "AccessDenied", message: "Denied" });
    expect(result.category).toBe("permission");
    expect(result.retryable).toBe(false);
  });

  it("should classify not-found errors", () => {
    const result = classifyError({ name: "ResourceNotFoundException", message: "Not found" });
    expect(result.category).toBe("not-found");
    expect(result.retryable).toBe(false);
  });

  it("should classify service errors as retryable", () => {
    const result = classifyError({ name: "InternalError", message: "Internal" });
    expect(result.category).toBe("service");
    expect(result.retryable).toBe(true);
  });

  it("should classify network errors as retryable", () => {
    const result = classifyError({ name: "TimeoutError", message: "Timed out" });
    expect(result.category).toBe("network");
    expect(result.retryable).toBe(true);
  });

  it("should classify unknown errors", () => {
    const result = classifyError({ name: "WeirdError", message: "?" });
    expect(result.category).toBe("unknown");
    expect(result.retryable).toBe(false);
  });

  it("should handle plain Error instances", () => {
    const result = classifyError(new Error("ECONNREFUSED"));
    expect(result.category).toBe("network");
  });

  it("should handle non-Error values gracefully", () => {
    const result = classifyError("string error");
    expect(result.category).toBe("unknown");
  });
});

// =============================================================================
// Retry
// =============================================================================

describe("retry", () => {
  it("should succeed on first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retry(fn, { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on transient errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ name: "ThrottlingException", message: "wait" })
      .mockResolvedValue("recovered");
    const result = await retry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should not retry non-retryable errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue({ name: "AccessDenied", message: "nope" });
    await expect(retry(fn, { maxAttempts: 3, baseDelayMs: 10 })).rejects.toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should stop after maxAttempts", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue({ name: "InternalError", message: "fail" });
    await expect(retry(fn, { maxAttempts: 2, baseDelayMs: 10 })).rejects.toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should call onRetry callback", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ name: "ThrottlingException", message: "wait" })
      .mockResolvedValue("ok");
    await retry(fn, { maxAttempts: 3, baseDelayMs: 10, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("should respect AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi
      .fn()
      .mockRejectedValue({ name: "InternalError", message: "fail" });
    await expect(
      retry(fn, { maxAttempts: 5, baseDelayMs: 10, signal: controller.signal }),
    ).rejects.toBeTruthy();
    // Should not keep retrying after abort
    expect(fn.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

// =============================================================================
// Formatting
// =============================================================================

describe("formatBytes", () => {
  it("should format zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("should format bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("should format KiB", () => {
    expect(formatBytes(1024)).toBe("1.0 KiB");
  });

  it("should format MiB", () => {
    expect(formatBytes(1_048_576)).toBe("1.0 MiB");
  });

  it("should format GiB", () => {
    expect(formatBytes(1_073_741_824)).toBe("1.0 GiB");
  });
});

describe("formatDuration", () => {
  it("should format zero seconds", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("should format seconds only", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("should format minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2m 5s");
  });

  it("should format hours, minutes, seconds", () => {
    expect(formatDuration(3661)).toBe("1h 1m 1s");
  });

  it("should handle negative as 0s", () => {
    expect(formatDuration(-5)).toBe("0s");
  });
});

describe("formatCost", () => {
  it("should format USD", () => {
    expect(formatCost(12.5)).toBe("$12.50");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(1234.567)).toBe("$1234.57");
  });
});

describe("truncate", () => {
  it("should not truncate short strings", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("should truncate long strings with ellipsis", () => {
    const result = truncate("hello world", 6);
    expect(result).toHaveLength(6);
    expect(result.endsWith("…")).toBe(true);
  });

  it("should handle exact length", () => {
    expect(truncate("abc", 3)).toBe("abc");
  });
});
