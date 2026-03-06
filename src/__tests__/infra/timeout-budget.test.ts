import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TimeoutBudget, BudgetExhaustedError, createRunBudget } from "../../infra/timeout-budget.js";

// =============================================================================
// TimeoutBudget: Basic Lifecycle
// =============================================================================

describe("TimeoutBudget", () => {
  describe("construction", () => {
    it("should create a budget with correct totalMs and deadlineMs", () => {
      const before = Date.now();
      const budget = new TimeoutBudget(5000);
      const after = Date.now();

      expect(budget.totalMs).toBe(5000);
      expect(budget.deadlineMs).toBeGreaterThanOrEqual(before + 5000);
      expect(budget.deadlineMs).toBeLessThanOrEqual(after + 5000);

      budget.dispose();
    });

    it("should report remaining time", () => {
      const budget = new TimeoutBudget(10_000);
      expect(budget.remainingMs()).toBeGreaterThan(9_900);
      expect(budget.remainingMs()).toBeLessThanOrEqual(10_000);

      budget.dispose();
    });

    it("should report not expired when fresh", () => {
      const budget = new TimeoutBudget(10_000);
      expect(budget.isExpired()).toBe(false);

      budget.dispose();
    });

    it("should report elapsed time", () => {
      const budget = new TimeoutBudget(10_000);
      expect(budget.elapsedMs()).toBeGreaterThanOrEqual(0);
      expect(budget.elapsedMs()).toBeLessThan(100);

      budget.dispose();
    });

    it("should provide an AbortSignal", () => {
      const budget = new TimeoutBudget(10_000);
      expect(budget.signal).toBeDefined();
      expect(budget.signal.aborted).toBe(false);

      budget.dispose();
    });
  });

  // ===========================================================================
  // Timeout behavior
  // ===========================================================================

  describe("timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should abort signal when budget expires", async () => {
      const budget = new TimeoutBudget(100);
      expect(budget.signal.aborted).toBe(false);

      vi.advanceTimersByTime(100);

      expect(budget.signal.aborted).toBe(true);
      expect(budget.signal.reason).toBeInstanceOf(BudgetExhaustedError);
    });

    it("should not abort signal before timeout", () => {
      const budget = new TimeoutBudget(1000);

      vi.advanceTimersByTime(500);

      expect(budget.signal.aborted).toBe(false);

      budget.dispose();
    });

    it("should dispose without aborting", () => {
      const budget = new TimeoutBudget(1000);
      budget.dispose();

      vi.advanceTimersByTime(2000);

      // Timer was cleared, so signal should not have been aborted.
      expect(budget.signal.aborted).toBe(false);
    });

    it("should be safe to call dispose multiple times", () => {
      const budget = new TimeoutBudget(1000);
      expect(() => {
        budget.dispose();
        budget.dispose();
        budget.dispose();
      }).not.toThrow();
    });
  });

  // ===========================================================================
  // Parent signal forwarding
  // ===========================================================================

  describe("parent signal", () => {
    it("should abort when parent signal aborts", () => {
      const parent = new AbortController();
      const budget = new TimeoutBudget(60_000, { parentSignal: parent.signal });

      expect(budget.signal.aborted).toBe(false);

      parent.abort(new Error("parent died"));

      expect(budget.signal.aborted).toBe(true);
      expect(budget.signal.reason).toBeInstanceOf(Error);

      budget.dispose();
    });

    it("should immediately abort if parent signal already aborted", () => {
      const parent = new AbortController();
      parent.abort("already dead");

      const budget = new TimeoutBudget(60_000, { parentSignal: parent.signal });
      expect(budget.signal.aborted).toBe(true);

      budget.dispose();
    });
  });

  // ===========================================================================
  // Child budgets
  // ===========================================================================

  describe("child()", () => {
    it("should create a child capped to remaining time", () => {
      const parent = new TimeoutBudget(10_000);
      const child = parent.child(5_000);

      expect(child.totalMs).toBe(5_000);
      expect(child.remainingMs()).toBeLessThanOrEqual(5_000);
      expect(child.remainingMs()).toBeGreaterThan(4_900);

      child.dispose();
      parent.dispose();
    });

    it("should cap child to parent remaining when maxMs exceeds it", () => {
      const parent = new TimeoutBudget(2_000);
      const child = parent.child(10_000);

      // Child should be capped to parent's ~2000ms remaining.
      expect(child.totalMs).toBeLessThanOrEqual(2_000);
      expect(child.totalMs).toBeGreaterThan(1_900);

      child.dispose();
      parent.dispose();
    });

    it("should inherit full remaining time when maxMs is omitted", () => {
      const parent = new TimeoutBudget(5_000);
      const child = parent.child();

      expect(child.totalMs).toBeLessThanOrEqual(5_000);
      expect(child.totalMs).toBeGreaterThan(4_900);

      child.dispose();
      parent.dispose();
    });

    it("should abort child when parent aborts", () => {
      const parentAc = new AbortController();
      const parent = new TimeoutBudget(10_000, { parentSignal: parentAc.signal });
      const child = parent.child(5_000);

      expect(child.signal.aborted).toBe(false);

      parentAc.abort("parent abort");

      expect(parent.signal.aborted).toBe(true);
      expect(child.signal.aborted).toBe(true);

      child.dispose();
      parent.dispose();
    });

    it("should allow grandchild budgets", () => {
      const grandparent = new TimeoutBudget(10_000);
      const parent = grandparent.child(5_000);
      const child = parent.child(2_000);

      expect(child.totalMs).toBe(2_000);
      expect(child.remainingMs()).toBeGreaterThan(1_900);

      child.dispose();
      parent.dispose();
      grandparent.dispose();
    });
  });

  // ===========================================================================
  // execute()
  // ===========================================================================

  describe("execute()", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should resolve when fn completes within budget", async () => {
      const budget = new TimeoutBudget(1000);
      const result = budget.execute(async () => {
        return 42;
      }, "test-op");

      await vi.advanceTimersByTimeAsync(0);

      await expect(result).resolves.toBe(42);
      budget.dispose();
    });

    it("should reject with BudgetExhaustedError when budget expires during fn", async () => {
      vi.useRealTimers(); // Use real timers for this test to avoid unhandled rejection
      const budget = new TimeoutBudget(30);

      await expect(
        budget.execute(() => new Promise((resolve) => setTimeout(resolve, 200)), "slow-op"),
      ).rejects.toBeInstanceOf(BudgetExhaustedError);
      budget.dispose();
    });

    it("should reject immediately if budget already expired", async () => {
      const budget = new TimeoutBudget(1);

      vi.advanceTimersByTime(10);

      await expect(
        budget.execute(async () => "should not run", "expired-op"),
      ).rejects.toBeInstanceOf(BudgetExhaustedError);
    });

    it("should pass abort signal to fn", async () => {
      const budget = new TimeoutBudget(5000);
      let receivedSignal: AbortSignal | undefined;

      const result = budget.execute(async (signal) => {
        receivedSignal = signal;
        return "done";
      });

      await vi.advanceTimersByTimeAsync(0);

      await result;
      expect(receivedSignal).toBeDefined();
      expect(receivedSignal?.aborted).toBe(false);

      budget.dispose();
    });

    it("should propagate fn errors", async () => {
      vi.useRealTimers(); // Use real timers to avoid unhandled rejection from fake timer scheduling
      const budget = new TimeoutBudget(5000);

      await expect(
        budget.execute(async () => {
          throw new Error("fn failed");
        }),
      ).rejects.toThrow("fn failed");
      budget.dispose();
    });
  });

  // ===========================================================================
  // BudgetExhaustedError
  // ===========================================================================

  describe("BudgetExhaustedError", () => {
    it("should have correct properties", () => {
      const err = new BudgetExhaustedError("my-op", 5000, 5200);
      expect(err.name).toBe("BudgetExhaustedError");
      expect(err.operationLabel).toBe("my-op");
      expect(err.totalMs).toBe(5000);
      expect(err.elapsedMs).toBe(5200);
      expect(err.message).toContain("my-op");
      expect(err.message).toContain("5200ms");
      expect(err.message).toContain("5000ms");
    });
  });

  // ===========================================================================
  // createRunBudget helper
  // ===========================================================================

  describe("createRunBudget()", () => {
    it("should create a budget with given timeoutMs", () => {
      const budget = createRunBudget(30_000);
      expect(budget.totalMs).toBe(30_000);
      expect(budget.remainingMs()).toBeGreaterThan(29_900);

      budget.dispose();
    });

    it("should forward parent signal", () => {
      const parent = new AbortController();
      const budget = createRunBudget(30_000, parent.signal, "test-run");

      parent.abort("stop");
      expect(budget.signal.aborted).toBe(true);

      budget.dispose();
    });
  });
});
