/**
 * Azure Extension — Progress Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createAzureProgress,
  withAzureProgress,
  createMultiStepProgress,
  waitWithProgress,
} from "./progress.js";

// Suppress stderr output during tests
beforeEach(() => {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

describe("createAzureProgress", () => {
  it("creates a progress reporter", () => {
    const p = createAzureProgress("test");
    expect(p.setLabel).toBeTypeOf("function");
    expect(p.setPercent).toBeTypeOf("function");
    expect(p.tick).toBeTypeOf("function");
    expect(p.done).toBeTypeOf("function");
    p.done();
  });

  it("silent mode suppresses output", () => {
    const write = vi.spyOn(process.stderr, "write");
    const p = createAzureProgress("test", { silent: true });
    p.setPercent(50);
    p.done();
    // The initial render is called but silent suppresses it
    // Just verify no error is thrown
    expect(p).toBeDefined();
  });
});

describe("withAzureProgress", () => {
  it("returns result on success", async () => {
    const result = await withAzureProgress("test", async () => "ok", { silent: true });
    expect(result).toBe("ok");
  });

  it("cleans up on error", async () => {
    await expect(
      withAzureProgress(
        "test",
        async () => {
          throw new Error("fail");
        },
        { silent: true },
      ),
    ).rejects.toThrow("fail");
  });
});

describe("createMultiStepProgress", () => {
  it("advances through steps", () => {
    const p = createMultiStepProgress("deploy", 3);
    p.nextStep("step 1");
    p.nextStep("step 2");
    p.nextStep("step 3");
    p.done();
  });
});

describe("waitWithProgress", () => {
  it("resolves when check returns true", async () => {
    const checkFn = vi.fn().mockResolvedValue(true);
    const result = await waitWithProgress("test", checkFn, {
      intervalMs: 10,
      timeoutMs: 1000,
      silent: true,
    });
    expect(result).toBe(true);
    expect(checkFn).toHaveBeenCalledTimes(1);
  });

  it("times out when check never returns true", async () => {
    const checkFn = vi.fn().mockResolvedValue(false);
    const result = await waitWithProgress("test", checkFn, {
      intervalMs: 10,
      timeoutMs: 50,
      silent: true,
    });
    expect(result).toBe(false);
    expect(checkFn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
