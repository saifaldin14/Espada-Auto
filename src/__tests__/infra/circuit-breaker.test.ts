import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitOpenError,
  CircuitTimeoutError,
  circuitBreakerRegistry,
  type CircuitBreakerConfig,
  type CircuitState,
  type CircuitStateChangeEvent,
} from "../../infra/circuit-breaker.js";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const succeed = () => Promise.resolve("ok");
const fail = (msg = "boom") => Promise.reject(new Error(msg));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class TransientError extends Error {
  readonly transient = true;
}

class PermanentError extends Error {
  readonly transient = false;
}

// ────────────────────────────────────────────────────────────────────────────
// CircuitBreaker
// ────────────────────────────────────────────────────────────────────────────

describe("CircuitBreaker", () => {
  describe("closed state (default)", () => {
    it("allows calls through when closed", async () => {
      const cb = new CircuitBreaker("test");
      const result = await cb.execute(succeed);
      expect(result).toBe("ok");
      expect(cb.state).toBe("closed");
    });

    it("passes through rejections without tripping on first failure", async () => {
      const cb = new CircuitBreaker("test", { failureThreshold: 3 });
      await expect(cb.execute(() => fail())).rejects.toThrow("boom");
      expect(cb.state).toBe("closed");
    });

    it("resets failure counter on success", async () => {
      const cb = new CircuitBreaker("test", { failureThreshold: 3 });
      // 2 failures
      await expect(cb.execute(() => fail())).rejects.toThrow();
      await expect(cb.execute(() => fail())).rejects.toThrow();
      // 1 success resets
      await cb.execute(succeed);
      // 2 more failures — should still be closed
      await expect(cb.execute(() => fail())).rejects.toThrow();
      await expect(cb.execute(() => fail())).rejects.toThrow();
      expect(cb.state).toBe("closed");
    });
  });

  describe("closed → open transition", () => {
    it("trips to open after failureThreshold consecutive failures", async () => {
      const cb = new CircuitBreaker("test", {
        failureThreshold: 3,
        resetTimeoutMs: 60_000,
      });
      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(() => fail())).rejects.toThrow();
      }
      expect(cb.state).toBe("open");
    });

    it("emits onStateChange when tripping", async () => {
      const changes: CircuitStateChangeEvent[] = [];
      const cb = new CircuitBreaker("test-trip", {
        failureThreshold: 2,
        resetTimeoutMs: 60_000,
        onStateChange: (e) => changes.push(e),
      });
      await expect(cb.execute(() => fail())).rejects.toThrow();
      await expect(cb.execute(() => fail())).rejects.toThrow();
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        name: "test-trip",
        from: "closed",
        to: "open",
        failures: 2,
      });
    });
  });

  describe("open state", () => {
    it("rejects calls immediately with CircuitOpenError", async () => {
      const cb = new CircuitBreaker("test", {
        failureThreshold: 1,
        resetTimeoutMs: 60_000,
      });
      await expect(cb.execute(() => fail())).rejects.toThrow();
      expect(cb.state).toBe("open");
      await expect(cb.execute(succeed)).rejects.toThrow(CircuitOpenError);
    });

    it("CircuitOpenError includes breaker name and remaining ms", async () => {
      const cb = new CircuitBreaker("my-service", {
        failureThreshold: 1,
        resetTimeoutMs: 10_000,
      });
      await expect(cb.execute(() => fail())).rejects.toThrow();
      try {
        await cb.execute(succeed);
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitOpenError);
        const coe = err as CircuitOpenError;
        expect(coe.breakerName).toBe("my-service");
        expect(coe.remainingMs).toBeGreaterThan(0);
        expect(coe.remainingMs).toBeLessThanOrEqual(10_000);
      }
    });

    it("increments totalRejections counter", async () => {
      const cb = new CircuitBreaker("test", {
        failureThreshold: 1,
        resetTimeoutMs: 60_000,
      });
      await expect(cb.execute(() => fail())).rejects.toThrow();
      try {
        await cb.execute(succeed);
      } catch {
        // expected
      }
      try {
        await cb.execute(succeed);
      } catch {
        // expected
      }
      const snap = cb.snapshot();
      expect(snap.totalRejections).toBe(2);
    });
  });

  describe("open → half_open transition", () => {
    it("transitions to half_open after resetTimeoutMs elapses", async () => {
      vi.useFakeTimers();
      try {
        const cb = new CircuitBreaker("test", {
          failureThreshold: 1,
          resetTimeoutMs: 1000,
        });
        await expect(cb.execute(() => fail())).rejects.toThrow();
        expect(cb.state).toBe("open");

        vi.advanceTimersByTime(1000);
        expect(cb.state).toBe("half_open");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("half_open state", () => {
    let cb: CircuitBreaker<string>;

    beforeEach(async () => {
      vi.useFakeTimers();
      cb = new CircuitBreaker<string>("test", {
        failureThreshold: 1,
        resetTimeoutMs: 100,
        halfOpenMaxProbes: 1,
      });
      await expect(cb.execute(() => fail("initial"))).rejects.toThrow();
      vi.advanceTimersByTime(100);
      expect(cb.state).toBe("half_open");
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("allows a single probe request", async () => {
      const result = await cb.execute(() => Promise.resolve("probe-ok"));
      expect(result).toBe("probe-ok");
      expect(cb.state).toBe("closed");
    });

    it("reopens on probe failure", async () => {
      await expect(cb.execute(() => fail("probe-fail"))).rejects.toThrow();
      expect(cb.state).toBe("open");
    });

    it("rejects excess probe requests", async () => {
      // Start a probe (don't await yet)
      const probePromise = cb.execute(
        () => new Promise<string>((r) => setTimeout(() => r("slow"), 50)),
      );
      // Second probe should be rejected
      await expect(cb.execute(succeed)).rejects.toThrow(CircuitOpenError);
      vi.advanceTimersByTime(50);
      await probePromise;
    });
  });

  describe("shouldTrip filter", () => {
    it("only trips on errors matching shouldTrip predicate", async () => {
      const cb = new CircuitBreaker("test", {
        failureThreshold: 1,
        resetTimeoutMs: 60_000,
        shouldTrip: (err) => err instanceof TransientError,
      });
      // PermanentError should NOT trip
      await expect(cb.execute(() => Promise.reject(new PermanentError("perm")))).rejects.toThrow();
      expect(cb.state).toBe("closed");
      // TransientError SHOULD trip
      await expect(cb.execute(() => Promise.reject(new TransientError("trans")))).rejects.toThrow();
      expect(cb.state).toBe("open");
    });
  });

  describe("callTimeoutMs", () => {
    it("throws CircuitTimeoutError when call exceeds timeout", async () => {
      const cb = new CircuitBreaker("test", {
        callTimeoutMs: 50,
        failureThreshold: 10,
      });
      await expect(
        cb.execute(() => new Promise<string>((r) => setTimeout(() => r("late"), 200))),
      ).rejects.toThrow(CircuitTimeoutError);
    });

    it("does not interfere with calls that finish in time", async () => {
      const cb = new CircuitBreaker("test", {
        callTimeoutMs: 1000,
      });
      const result = await cb.execute(succeed);
      expect(result).toBe("ok");
    });
  });

  describe("manual recording", () => {
    it("recordSuccess closes a half-open breaker", async () => {
      vi.useFakeTimers();
      try {
        const cb = new CircuitBreaker("test", {
          failureThreshold: 1,
          resetTimeoutMs: 100,
        });
        await expect(cb.execute(() => fail())).rejects.toThrow();
        vi.advanceTimersByTime(100);
        expect(cb.state).toBe("half_open");
        cb.recordSuccess();
        expect(cb.state).toBe("closed");
      } finally {
        vi.useRealTimers();
      }
    });

    it("recordFailure trips the breaker", async () => {
      const cb = new CircuitBreaker("test", { failureThreshold: 2 });
      cb.recordFailure(new Error("one"));
      cb.recordFailure(new Error("two"));
      expect(cb.state).toBe("open");
    });

    it("recordFailure respects shouldTrip", async () => {
      const cb = new CircuitBreaker("test", {
        failureThreshold: 1,
        shouldTrip: () => false,
      });
      cb.recordFailure(new Error("no-trip"));
      expect(cb.state).toBe("closed");
    });
  });

  describe("forceOpen / forceClose / reset", () => {
    it("forceOpen trips immediately regardless of failure count", () => {
      const cb = new CircuitBreaker("test");
      expect(cb.state).toBe("closed");
      cb.forceOpen();
      expect(cb.state).toBe("open");
    });

    it("forceClose restores from open", () => {
      const cb = new CircuitBreaker("test", { failureThreshold: 1 });
      cb.forceOpen();
      expect(cb.state).toBe("open");
      cb.forceClose();
      expect(cb.state).toBe("closed");
    });

    it("reset clears all counters and lifetime stats", async () => {
      const cb = new CircuitBreaker("test", { failureThreshold: 1 });
      await expect(cb.execute(() => fail())).rejects.toThrow();
      cb.reset();
      const snap = cb.snapshot();
      expect(snap.state).toBe("closed");
      expect(snap.failures).toBe(0);
      expect(snap.totalRequests).toBe(0);
      expect(snap.totalFailures).toBe(0);
    });
  });

  describe("snapshot", () => {
    it("returns accurate counters", async () => {
      const cb = new CircuitBreaker("snap-test", { failureThreshold: 5 });
      await cb.execute(succeed);
      await cb.execute(succeed);
      await expect(cb.execute(() => fail())).rejects.toThrow();

      const snap = cb.snapshot();
      expect(snap.name).toBe("snap-test");
      expect(snap.state).toBe("closed");
      expect(snap.totalRequests).toBe(3);
      expect(snap.totalSuccesses).toBe(2);
      expect(snap.totalFailures).toBe(1);
      expect(snap.failures).toBe(1);
      expect(snap.lastSuccessTime).toBeGreaterThan(0);
      expect(snap.lastFailureTime).toBeGreaterThan(0);
    });
  });

  describe("canExecute", () => {
    it("returns true when closed", () => {
      const cb = new CircuitBreaker("test");
      expect(cb.canExecute()).toBe(true);
    });

    it("returns false when open", () => {
      const cb = new CircuitBreaker("test", {
        failureThreshold: 1,
        resetTimeoutMs: 60_000,
      });
      cb.forceOpen();
      expect(cb.canExecute()).toBe(false);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CircuitBreakerRegistry
// ────────────────────────────────────────────────────────────────────────────

describe("CircuitBreakerRegistry", () => {
  let registry: CircuitBreakerRegistry;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry();
  });

  it("creates and returns the same breaker for a given name", () => {
    const cb1 = registry.getOrCreate("svc-a");
    const cb2 = registry.getOrCreate("svc-a");
    expect(cb1).toBe(cb2);
  });

  it("creates distinct breakers for different names", () => {
    const a = registry.getOrCreate("svc-a");
    const b = registry.getOrCreate("svc-b");
    expect(a).not.toBe(b);
  });

  it("get returns undefined for unknown names", () => {
    expect(registry.get("nope")).toBeUndefined();
  });

  it("has returns true for registered, false otherwise", () => {
    registry.getOrCreate("exists");
    expect(registry.has("exists")).toBe(true);
    expect(registry.has("nope")).toBe(false);
  });

  it("remove deletes a breaker", () => {
    registry.getOrCreate("temp");
    expect(registry.remove("temp")).toBe(true);
    expect(registry.has("temp")).toBe(false);
  });

  it("snapshot returns all registered breakers", async () => {
    const a = registry.getOrCreate("a");
    const b = registry.getOrCreate("b");
    await a.execute(succeed);
    const snapshots = registry.snapshot();
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((s) => s.name).sort()).toEqual(["a", "b"]);
  });

  it("healthSummary groups breakers by state", async () => {
    const a = registry.getOrCreate("healthy", { failureThreshold: 10 });
    const b = registry.getOrCreate("broken", { failureThreshold: 1, resetTimeoutMs: 60_000 });
    await a.execute(succeed);
    await expect(b.execute(() => fail())).rejects.toThrow();

    const summary = registry.healthSummary();
    expect(summary.total).toBe(2);
    expect(summary.closed).toContain("healthy");
    expect(summary.open).toContain("broken");
    expect(summary.hasOpenCircuits).toBe(true);
  });

  it("resetAll resets every breaker", async () => {
    const cb = registry.getOrCreate("r", { failureThreshold: 1, resetTimeoutMs: 60_000 });
    await expect(cb.execute(() => fail())).rejects.toThrow();
    expect(cb.state).toBe("open");
    registry.resetAll();
    expect(cb.state).toBe("closed");
  });

  it("clear removes all breakers", () => {
    registry.getOrCreate("a");
    registry.getOrCreate("b");
    registry.clear();
    expect(registry.size).toBe(0);
  });

  it("is iterable", () => {
    registry.getOrCreate("x");
    registry.getOrCreate("y");
    const names: string[] = [];
    for (const [name] of registry) {
      names.push(name);
    }
    expect(names.sort()).toEqual(["x", "y"]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Global singleton
// ────────────────────────────────────────────────────────────────────────────

describe("circuitBreakerRegistry (global singleton)", () => {
  afterEach(() => {
    circuitBreakerRegistry.clear();
  });

  it("is a singleton CircuitBreakerRegistry", () => {
    expect(circuitBreakerRegistry).toBeInstanceOf(CircuitBreakerRegistry);
  });

  it("persists breakers across calls", () => {
    const cb = circuitBreakerRegistry.getOrCreate("global-test");
    expect(circuitBreakerRegistry.get("global-test")).toBe(cb);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Edge cases
// ────────────────────────────────────────────────────────────────────────────

describe("CircuitBreaker edge cases", () => {
  it("handles failureThreshold = 1", async () => {
    const cb = new CircuitBreaker("t", { failureThreshold: 1, resetTimeoutMs: 60_000 });
    await expect(cb.execute(() => fail())).rejects.toThrow();
    expect(cb.state).toBe("open");
  });

  it("handles very large failureThreshold", async () => {
    const cb = new CircuitBreaker("t", { failureThreshold: 1_000_000 });
    for (let i = 0; i < 100; i++) {
      await expect(cb.execute(() => fail())).rejects.toThrow();
    }
    expect(cb.state).toBe("closed"); // 100 < 1M
  });

  it("handles zero resetTimeoutMs (immediate half-open)", async () => {
    const cb = new CircuitBreaker("t", { failureThreshold: 1, resetTimeoutMs: 0 });
    await expect(cb.execute(() => fail())).rejects.toThrow();
    // With 0 reset, the state getter should see open→half_open immediately
    expect(cb.state).toBe("half_open");
  });

  it("handles concurrent calls correctly", async () => {
    const cb = new CircuitBreaker<string>("t", { failureThreshold: 5 });
    const results = await Promise.all(Array.from({ length: 10 }, () => cb.execute(succeed)));
    expect(results).toHaveLength(10);
    expect(results.every((r) => r === "ok")).toBe(true);
    expect(cb.snapshot().totalRequests).toBe(10);
    expect(cb.snapshot().totalSuccesses).toBe(10);
  });

  it("does not double-count on re-entrant execute", async () => {
    const cb = new CircuitBreaker<string>("t");
    const result = await cb.execute(async () => {
      // Nested execute
      return cb.execute(succeed);
    });
    expect(result).toBe("ok");
    expect(cb.snapshot().totalRequests).toBe(2);
  });

  it("negative failureThreshold is clamped to 1", async () => {
    const cb = new CircuitBreaker("t", { failureThreshold: -5, resetTimeoutMs: 60_000 });
    await expect(cb.execute(() => fail())).rejects.toThrow();
    expect(cb.state).toBe("open");
  });

  it("halfOpenMaxProbes defaults to 1", async () => {
    vi.useFakeTimers();
    try {
      const cb = new CircuitBreaker("t", { failureThreshold: 1, resetTimeoutMs: 50 });
      await expect(cb.execute(() => fail())).rejects.toThrow();
      vi.advanceTimersByTime(50);
      // Start a probe
      const p = cb.execute(() => new Promise<string>((r) => setTimeout(() => r("ok"), 10)));
      // Immediately try another — should be rejected
      await expect(cb.execute(succeed)).rejects.toThrow(CircuitOpenError);
      vi.advanceTimersByTime(10);
      await p;
    } finally {
      vi.useRealTimers();
    }
  });
});
