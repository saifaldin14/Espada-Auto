import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// NOTE: The cloud provider circuit breakers (AWS, Azure, GCP) are self-contained
// duplicates of the core pattern in src/infra/circuit-breaker.ts. The core
// pattern is exhaustively tested in src/infra/circuit-breaker.test.ts (43 tests).
//
// These tests validate the cloud-specific wrappers:
// - Registry key naming (e.g. "aws:s3", "aws:s3:us-east-1")
// - withXxxCircuitBreaker() wrapper
// - getXxxServiceBreaker() / isXxxServiceAvailable()
// - Health summary aggregation
// - Reset function
// =============================================================================

// We test the AWS provider as representative — Azure and GCP follow the same
// pattern with different naming/error predicates.

describe("AWS Circuit Breaker (cloud extension)", () => {
  // Dynamic import so tests don't fail if the extension isn't compiled.
  let mod: typeof import("../../../extensions/aws/src/circuit-breaker.js");

  beforeEach(async () => {
    // Re-import fresh module for isolating registry state between tests.
    // vitest module isolation handles this via test file scope.
    mod = await import("../../../extensions/aws/src/circuit-breaker.js");
    mod.resetAllAWSBreakers();
  });

  describe("getAWSServiceBreaker()", () => {
    it("should create a breaker with default name aws:<service>", () => {
      const breaker = mod.getAWSServiceBreaker("s3");
      const snap = breaker.snapshot();
      expect(snap.name).toBe("aws:s3");
      expect(snap.state).toBe("closed");
    });

    it("should include region in name when provided", () => {
      const breaker = mod.getAWSServiceBreaker("ec2", "us-west-2");
      expect(breaker.snapshot().name).toBe("aws:ec2:us-west-2");
    });

    it("should return same instance for same service+region", () => {
      const a = mod.getAWSServiceBreaker("rds", "eu-west-1");
      const b = mod.getAWSServiceBreaker("rds", "eu-west-1");
      expect(a).toBe(b);
    });

    it("should return different instances for different regions", () => {
      const a = mod.getAWSServiceBreaker("s3", "us-east-1");
      const b = mod.getAWSServiceBreaker("s3", "eu-west-1");
      expect(a).not.toBe(b);
    });
  });

  describe("isAWSServiceAvailable()", () => {
    it("should return true when circuit is closed", () => {
      mod.getAWSServiceBreaker("lambda"); // Ensure it exists.
      expect(mod.isAWSServiceAvailable("lambda")).toBe(true);
    });

    it("should return true for unknown services (no breaker exists)", () => {
      expect(mod.isAWSServiceAvailable("nonexistent-service")).toBe(true);
    });
  });

  describe("withAWSCircuitBreaker()", () => {
    it("should execute fn and return result on success", async () => {
      const result = await mod.withAWSCircuitBreaker("dynamodb", async () => 42);
      expect(result).toBe(42);
    });

    it("should propagate errors", async () => {
      await expect(
        mod.withAWSCircuitBreaker("sqs", async () => {
          throw new Error("throttled");
        }),
      ).rejects.toThrow("throttled");
    });

    it("should record failures in the breaker", async () => {
      const service = "test-fail-service";
      for (let i = 0; i < 5; i++) {
        try {
          await mod.withAWSCircuitBreaker(service, async () => {
            const err: any = new Error("fail");
            err.name = "ThrottlingException"; // AWS SDK retryable error
            throw err;
          });
        } catch {
          // expected
        }
      }
      const breaker = mod.getAWSServiceBreaker(service);
      expect(breaker.snapshot().failures).toBeGreaterThan(0);
    });
  });

  describe("getAWSCircuitBreakerSnapshots()", () => {
    it("should return snapshots of all registered breakers", () => {
      mod.getAWSServiceBreaker("s3");
      mod.getAWSServiceBreaker("ec2");
      mod.getAWSServiceBreaker("rds");

      const snapshots = mod.getAWSCircuitBreakerSnapshots();
      expect(snapshots.length).toBe(3);
      const names = snapshots.map((s) => s.name);
      expect(names).toContain("aws:s3");
      expect(names).toContain("aws:ec2");
      expect(names).toContain("aws:rds");
    });
  });

  describe("getAWSCircuitBreakerHealthSummary()", () => {
    it("should report correct health summary", () => {
      mod.getAWSServiceBreaker("s3");
      mod.getAWSServiceBreaker("lambda");

      const summary = mod.getAWSCircuitBreakerHealthSummary();
      expect(summary.total).toBe(2);
      expect(summary.closed).toHaveLength(2);
      expect(summary.open).toHaveLength(0);
      expect(summary.halfOpen).toHaveLength(0);
      expect(summary.hasOpenCircuits).toBe(false);
    });
  });

  describe("resetAllAWSBreakers()", () => {
    it("should clear all registered breakers", () => {
      mod.getAWSServiceBreaker("a");
      mod.getAWSServiceBreaker("b");
      expect(mod.getAWSCircuitBreakerSnapshots().length).toBe(2);

      mod.resetAllAWSBreakers();
      expect(mod.getAWSCircuitBreakerSnapshots().length).toBe(0);
    });
  });
});
