import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Bulkhead, BulkheadRejectedError, BulkheadRegistry, bulkheadRegistry } from "./bulkhead.js";

// =============================================================================
// Bulkhead: Basic Lifecycle
// =============================================================================

describe("Bulkhead", () => {
  describe("construction", () => {
    it("should create a bulkhead with default config", () => {
      const bh = new Bulkhead("test");
      const snap = bh.snapshot();

      expect(snap.name).toBe("test");
      expect(snap.maxConcurrency).toBe(10);
      expect(snap.maxQueue).toBe(100);
      expect(snap.activeCount).toBe(0);
      expect(snap.queuedCount).toBe(0);
    });

    it("should accept custom config", () => {
      const bh = new Bulkhead("custom", { maxConcurrency: 5, maxQueue: 20 });
      const snap = bh.snapshot();

      expect(snap.maxConcurrency).toBe(5);
      expect(snap.maxQueue).toBe(20);
    });

    it("should clamp maxConcurrency to at least 1", () => {
      const bh = new Bulkhead("clamped", { maxConcurrency: 0 });
      expect(bh.snapshot().maxConcurrency).toBe(1);
    });
  });

  // ===========================================================================
  // Execution
  // ===========================================================================

  describe("execute()", () => {
    it("should execute fn and return result", async () => {
      const bh = new Bulkhead("test");
      const result = await bh.execute(async () => 42);
      expect(result).toBe(42);
    });

    it("should propagate errors", async () => {
      const bh = new Bulkhead("test");
      await expect(
        bh.execute(async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
    });

    it("should track active count during execution", async () => {
      const bh = new Bulkhead("test", { maxConcurrency: 5 });
      let capturedActive = 0;

      await bh.execute(async () => {
        capturedActive = bh.active;
      });

      expect(capturedActive).toBe(1);
      expect(bh.active).toBe(0);
    });

    it("should track completed count", async () => {
      const bh = new Bulkhead("test");

      await bh.execute(async () => "a");
      await bh.execute(async () => "b");

      expect(bh.snapshot().completedCount).toBe(2);
    });

    it("should decrement active count even on error", async () => {
      const bh = new Bulkhead("test");

      try {
        await bh.execute(async () => {
          throw new Error("fail");
        });
      } catch {
        // expected
      }

      expect(bh.active).toBe(0);
      expect(bh.snapshot().completedCount).toBe(1);
    });
  });

  // ===========================================================================
  // Concurrency limiting
  // ===========================================================================

  describe("concurrency", () => {
    it("should limit concurrent executions", async () => {
      const bh = new Bulkhead("test", { maxConcurrency: 2, maxQueue: 10 });
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const task = async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 10));
        currentConcurrent--;
      };

      await Promise.all([bh.execute(task), bh.execute(task), bh.execute(task), bh.execute(task)]);

      expect(maxConcurrent).toBe(2);
    });

    it("should queue operations when at max concurrency", async () => {
      const bh = new Bulkhead("test", { maxConcurrency: 1, maxQueue: 10 });
      const order: number[] = [];
      let resolve1: () => void;
      const gate1 = new Promise<void>((r) => {
        resolve1 = r;
      });

      const p1 = bh.execute(async () => {
        order.push(1);
        await gate1;
      });

      // Give p1 time to start.
      await new Promise((r) => setTimeout(r, 5));

      const p2 = bh.execute(async () => {
        order.push(2);
      });

      expect(bh.active).toBe(1);
      expect(bh.queued).toBe(1);

      resolve1!();
      await p1;
      await p2;

      expect(order).toEqual([1, 2]);
    });
  });

  // ===========================================================================
  // Rejection
  // ===========================================================================

  describe("rejection", () => {
    it("should reject when queue is full", async () => {
      const bh = new Bulkhead("test", { maxConcurrency: 1, maxQueue: 1 });
      let resolve1: () => void;
      const gate = new Promise<void>((r) => {
        resolve1 = r;
      });

      // Fill the single concurrency slot.
      const p1 = bh.execute(() => gate);

      // Fill the single queue slot.
      const p2 = bh.execute(async () => "queued");

      // This should be rejected.
      await expect(bh.execute(async () => "rejected")).rejects.toBeInstanceOf(
        BulkheadRejectedError,
      );

      expect(bh.snapshot().rejectedCount).toBe(1);

      resolve1!();
      await p1;
      await p2;
    });

    it("should reject when abort signal is already aborted", async () => {
      const bh = new Bulkhead("test");
      const ac = new AbortController();
      ac.abort();

      await expect(bh.execute(async () => "never", ac.signal)).rejects.toBeInstanceOf(
        BulkheadRejectedError,
      );
    });

    it("BulkheadRejectedError should have correct properties", () => {
      const err = new BulkheadRejectedError("my-bh", 10, 5);
      expect(err.name).toBe("BulkheadRejectedError");
      expect(err.partition).toBe("my-bh");
      expect(err.maxQueue).toBe(10);
      expect(err.activeCount).toBe(5);
      expect(err.message).toContain("my-bh");
    });
  });

  // ===========================================================================
  // Queue timeout
  // ===========================================================================

  describe("queue timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should reject queued operation after queueTimeoutMs", async () => {
      const bh = new Bulkhead("test", {
        maxConcurrency: 1,
        maxQueue: 10,
        queueTimeoutMs: 100,
      });

      // Block the slot.
      const gate = new Promise<void>(() => {}); // never resolves
      const p1 = bh.execute(() => gate);

      // Queue a second operation.
      const p2 = bh.execute(async () => "should timeout");

      // Advance past the queue timeout.
      vi.advanceTimersByTime(100);

      await expect(p2).rejects.toBeInstanceOf(BulkheadRejectedError);
    });
  });

  // ===========================================================================
  // Abort signal
  // ===========================================================================

  describe("abort signal", () => {
    it("should reject queued operation when signal aborts", async () => {
      const bh = new Bulkhead("test", { maxConcurrency: 1 });
      const ac = new AbortController();
      const gate = new Promise<void>(() => {}); // never resolves

      // Block the slot.
      const p1 = bh.execute(() => gate);

      // Queue with abort signal.
      const p2 = bh.execute(async () => "should abort", ac.signal);

      // Abort the queued operation.
      ac.abort();

      await expect(p2).rejects.toBeInstanceOf(BulkheadRejectedError);
    });
  });

  // ===========================================================================
  // Snapshot
  // ===========================================================================

  describe("snapshot()", () => {
    it("should return accurate snapshot", async () => {
      const bh = new Bulkhead("snap-test", { maxConcurrency: 2, maxQueue: 5 });

      await bh.execute(async () => {});
      try {
        await bh.execute(async () => {
          throw new Error("nope");
        });
      } catch {
        /* expected */
      }

      const snap = bh.snapshot();
      expect(snap.name).toBe("snap-test");
      expect(snap.activeCount).toBe(0);
      expect(snap.completedCount).toBe(2);
      expect(snap.rejectedCount).toBe(0);
    });
  });
});

// =============================================================================
// BulkheadRegistry
// =============================================================================

describe("BulkheadRegistry", () => {
  it("should create and retrieve partitions", () => {
    const reg = new BulkheadRegistry();
    const bh = reg.get("test-partition", { maxConcurrency: 3 });

    expect(bh).toBeInstanceOf(Bulkhead);
    expect(bh.name).toBe("test-partition");
  });

  it("should return same instance on repeated get", () => {
    const reg = new BulkheadRegistry();
    const a = reg.get("x");
    const b = reg.get("x");
    expect(a).toBe(b);
  });

  it("should report size", () => {
    const reg = new BulkheadRegistry();
    expect(reg.size).toBe(0);
    reg.get("a");
    reg.get("b");
    expect(reg.size).toBe(2);
  });

  it("should check existence with has()", () => {
    const reg = new BulkheadRegistry();
    expect(reg.has("nope")).toBe(false);
    reg.get("yep");
    expect(reg.has("yep")).toBe(true);
  });

  it("should delete partitions", () => {
    const reg = new BulkheadRegistry();
    reg.get("tmp");
    expect(reg.delete("tmp")).toBe(true);
    expect(reg.has("tmp")).toBe(false);
  });

  it("should return snapshots of all partitions", () => {
    const reg = new BulkheadRegistry();
    reg.get("a", { maxConcurrency: 1 });
    reg.get("b", { maxConcurrency: 2 });

    const snaps = reg.snapshots();
    expect(snaps).toHaveLength(2);
    expect(snaps.map((s) => s.name).sort()).toEqual(["a", "b"]);
  });
});

// =============================================================================
// Global registry
// =============================================================================

describe("bulkheadRegistry (global)", () => {
  it("should have pre-registered partitions", () => {
    expect(bulkheadRegistry.has("llm")).toBe(true);
    expect(bulkheadRegistry.has("cloud-api")).toBe(true);
    expect(bulkheadRegistry.has("tools")).toBe(true);
    expect(bulkheadRegistry.has("internal")).toBe(true);
  });

  it("should have correct default limits", () => {
    const llm = bulkheadRegistry.get("llm").snapshot();
    expect(llm.maxConcurrency).toBe(8);

    const cloud = bulkheadRegistry.get("cloud-api").snapshot();
    expect(cloud.maxConcurrency).toBe(20);

    const tools = bulkheadRegistry.get("tools").snapshot();
    expect(tools.maxConcurrency).toBe(15);

    const internal = bulkheadRegistry.get("internal").snapshot();
    expect(internal.maxConcurrency).toBe(50);
  });
});
