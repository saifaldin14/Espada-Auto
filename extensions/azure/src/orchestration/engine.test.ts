/**
 * IDIO — Orchestration Engine Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator, orchestrate } from "./engine.js";
import { registerStepType, clearStepRegistry } from "./registry.js";
import type { ExecutionPlan, PlanStep, StepInstanceId, OrchestrationEvent, StepHandler } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function step(id: string, type: string, params: Record<string, unknown> = {}, dependsOn?: string[]): PlanStep {
  return { id: id as StepInstanceId, type, label: id, params, dependsOn: dependsOn as StepInstanceId[] };
}

function registerSimpleStep(id: string, outputs: Record<string, unknown> = {}, opts?: { failOnExecute?: boolean; executeDelay?: number; rollbackFn?: () => Promise<void> }) {
  const handler: StepHandler = {
    async execute() {
      if (opts?.executeDelay) await new Promise((r) => setTimeout(r, opts.executeDelay));
      if (opts?.failOnExecute) throw new Error(`Step ${id} failed`);
      return outputs;
    },
    rollback: opts?.rollbackFn,
  };

  registerStepType({
    id,
    label: id,
    description: "",
    category: "compute",
    parameters: [],
    outputs: Object.entries(outputs).map(([name]) => ({ name, type: "string" as const, description: "" })),
    rollbackSupported: Boolean(opts?.rollbackFn),
    estimatedDurationMs: 1000,
  }, handler);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator", () => {
  beforeEach(() => {
    clearStepRegistry();
  });

  it("executes a simple linear plan", async () => {
    registerSimpleStep("step-a", { result: "a-done" });
    registerSimpleStep("step-b", { result: "b-done" });

    const plan: ExecutionPlan = {
      id: "plan-1",
      name: "Linear Plan",
      steps: [
        step("s1", "step-a", {}),
        step("s2", "step-b", {}, ["s1"]),
      ],
    };

    const result = await orchestrate(plan);
    expect(result.status).toBe("succeeded");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].status).toBe("succeeded");
    expect(result.steps[1].status).toBe("succeeded");
    expect(result.errors).toHaveLength(0);
  });

  it("executes parallel steps concurrently", async () => {
    const execution: string[] = [];
    registerStepType({
      id: "track-a", label: "A", description: "", category: "compute",
      parameters: [], outputs: [], rollbackSupported: false, estimatedDurationMs: 100,
    }, {
      async execute() { execution.push("a-start"); await sleep(50); execution.push("a-end"); return {}; },
    });
    registerStepType({
      id: "track-b", label: "B", description: "", category: "compute",
      parameters: [], outputs: [], rollbackSupported: false, estimatedDurationMs: 100,
    }, {
      async execute() { execution.push("b-start"); await sleep(50); execution.push("b-end"); return {}; },
    });

    const plan: ExecutionPlan = {
      id: "plan-parallel",
      name: "Parallel",
      steps: [step("a", "track-a"), step("b", "track-b")],
    };

    const result = await orchestrate(plan, { maxConcurrency: 2 });
    expect(result.status).toBe("succeeded");
    // Both should start before either ends
    expect(execution.indexOf("a-start")).toBeLessThan(execution.indexOf("a-end"));
    expect(execution.indexOf("b-start")).toBeLessThan(execution.indexOf("b-end"));
  });

  it("resolves output references between steps", async () => {
    let capturedParams: Record<string, unknown> | undefined;

    registerStepType({
      id: "producer", label: "Producer", description: "", category: "compute",
      parameters: [], outputs: [{ name: "value", type: "string", description: "" }],
      rollbackSupported: false, estimatedDurationMs: 100,
    }, {
      async execute() { return { value: "hello-from-producer" }; },
    });

    registerStepType({
      id: "consumer", label: "Consumer", description: "", category: "compute",
      parameters: [{ name: "input", type: "string", description: "", required: true }],
      outputs: [], rollbackSupported: false, estimatedDurationMs: 100,
    }, {
      async execute(ctx) { capturedParams = ctx.params; return {}; },
    });

    const plan: ExecutionPlan = {
      id: "plan-refs",
      name: "Refs",
      steps: [
        step("prod", "producer"),
        step("cons", "consumer", { input: "prod.outputs.value" }, ["prod"]),
      ],
    };

    const result = await orchestrate(plan);
    expect(result.status).toBe("succeeded");
    expect(capturedParams?.input).toBe("hello-from-producer");
  });

  it("handles step failure with failFast", async () => {
    registerSimpleStep("good-step", { x: "1" });
    registerSimpleStep("bad-step", {}, { failOnExecute: true });
    registerSimpleStep("after-step", { y: "2" });

    const plan: ExecutionPlan = {
      id: "plan-fail",
      name: "Fail Plan",
      steps: [
        step("s1", "good-step"),
        step("s2", "bad-step", {}, ["s1"]),
        step("s3", "after-step", {}, ["s2"]),
      ],
    };

    const result = await orchestrate(plan, { failFast: true, autoRollback: false });
    expect(result.status).toBe("failed");
    expect(result.steps.find((s) => s.stepId === "s2")?.status).toBe("failed");
    expect(result.steps.find((s) => s.stepId === "s3")?.status).toBe("skipped");
  });

  it("performs rollback on failure in reverse order", async () => {
    const rollbackOrder: string[] = [];

    registerStepType({
      id: "rb-step", label: "Rollbackable", description: "", category: "compute",
      parameters: [{ name: "id", type: "string", description: "", required: false }],
      outputs: [], rollbackSupported: true, estimatedDurationMs: 100,
    }, {
      async execute() { return {}; },
      async rollback(ctx) { rollbackOrder.push(String(ctx.params.id ?? "unknown")); },
    });

    registerSimpleStep("fail-step", {}, { failOnExecute: true });

    const plan: ExecutionPlan = {
      id: "plan-rb",
      name: "Rollback Plan",
      steps: [
        step("s1", "rb-step", { id: "first" }),
        step("s2", "rb-step", { id: "second" }, ["s1"]),
        step("s3", "fail-step", {}, ["s2"]),
      ],
    };

    const result = await orchestrate(plan, { autoRollback: true });
    expect(result.status).toBe("failed");
    // Rollback should happen in reverse completion order: s2 then s1
    expect(rollbackOrder).toEqual(["second", "first"]);
  });

  it("skips steps with unmet conditions", async () => {
    registerSimpleStep("always-step", { flag: "true" });
    registerSimpleStep("conditional-step", {});

    const plan: ExecutionPlan = {
      id: "plan-cond",
      name: "Conditional Plan",
      steps: [
        step("s1", "always-step"),
        {
          ...step("s2", "conditional-step", {}, ["s1"]),
          condition: { check: "failed", stepId: "s1" as StepInstanceId },
        },
      ],
    };

    const result = await orchestrate(plan);
    expect(result.status).toBe("succeeded");
    expect(result.steps.find((s) => s.stepId === "s2")?.status).toBe("skipped");
  });

  it("supports dry-run mode", async () => {
    const executeFn = vi.fn().mockResolvedValue({ result: "real" });
    registerStepType({
      id: "dry-step", label: "Dry", description: "", category: "compute",
      parameters: [],
      outputs: [{ name: "result", type: "string", description: "" }],
      rollbackSupported: false, estimatedDurationMs: 100,
    }, { execute: executeFn });

    const plan: ExecutionPlan = {
      id: "plan-dry",
      name: "Dry Run",
      steps: [step("s1", "dry-step")],
    };

    const result = await orchestrate(plan, { dryRun: true });
    expect(result.status).toBe("succeeded");
    expect(executeFn).not.toHaveBeenCalled();
    expect(result.steps[0].outputs?.result).toBe("<dry-run:result>");
  });

  it("emits lifecycle events", async () => {
    registerSimpleStep("event-step", {});

    const events: OrchestrationEvent[] = [];
    const plan: ExecutionPlan = {
      id: "plan-events",
      name: "Events",
      steps: [step("s1", "event-step")],
    };

    const engine = new Orchestrator();
    engine.on((e) => events.push(e));
    await engine.execute(plan);

    const types = events.map((e) => e.type);
    expect(types).toContain("plan:start");
    expect(types).toContain("step:start");
    expect(types).toContain("step:complete");
    expect(types).toContain("plan:complete");
  });

  it("respects step timeout", async () => {
    registerStepType({
      id: "slow-step", label: "Slow", description: "", category: "compute",
      parameters: [], outputs: [], rollbackSupported: false, estimatedDurationMs: 10_000,
    }, {
      async execute() {
        await new Promise((r) => setTimeout(r, 10_000));
        return {};
      },
    });

    const plan: ExecutionPlan = {
      id: "plan-timeout",
      name: "Timeout",
      steps: [step("s1", "slow-step")],
    };

    const result = await orchestrate(plan, { stepTimeoutMs: 100, autoRollback: false });
    expect(result.status).toBe("failed");
    expect(result.steps[0].error).toMatch(/timed out/);
  });

  it("retries on step failure", async () => {
    let attempts = 0;
    registerStepType({
      id: "flaky-step", label: "Flaky", description: "", category: "compute",
      parameters: [], outputs: [{ name: "ok", type: "string", description: "" }],
      rollbackSupported: false, estimatedDurationMs: 100,
    }, {
      async execute() {
        attempts++;
        if (attempts < 3) throw new Error("transient");
        return { ok: "yes" };
      },
    });

    const plan: ExecutionPlan = {
      id: "plan-retry",
      name: "Retry",
      steps: [step("s1", "flaky-step")],
    };

    const result = await orchestrate(plan, { maxRetries: 3 });
    expect(result.status).toBe("succeeded");
    expect(attempts).toBe(3);
  });

  it("handles validation failures gracefully", async () => {
    // No steps registered — plan references unknown type
    const plan: ExecutionPlan = {
      id: "plan-invalid",
      name: "Invalid",
      steps: [step("s1", "nonexistent-step")],
    };

    const result = await orchestrate(plan);
    expect(result.status).toBe("failed");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("un-registers event listeners", async () => {
    registerSimpleStep("unsub-step", {});
    const events: OrchestrationEvent[] = [];
    const engine = new Orchestrator();
    const unsub = engine.on((e) => events.push(e));
    unsub();

    const plan: ExecutionPlan = {
      id: "plan-unsub",
      name: "Unsub",
      steps: [step("s1", "unsub-step")],
    };
    await engine.execute(plan);
    expect(events).toHaveLength(0);
  });

  it("handles cancellation via AbortSignal", async () => {
    registerStepType({
      id: "cancel-step", label: "Cancel", description: "", category: "compute",
      parameters: [], outputs: [], rollbackSupported: false, estimatedDurationMs: 10_000,
    }, {
      async execute() {
        await new Promise((r) => setTimeout(r, 5_000));
        return {};
      },
    });

    const controller = new AbortController();
    const plan: ExecutionPlan = {
      id: "plan-cancel",
      name: "Cancel",
      steps: [step("s1", "cancel-step")],
    };

    // Abort after 50ms
    setTimeout(() => controller.abort(), 50);
    const result = await orchestrate(plan, { signal: controller.signal, stepTimeoutMs: 10_000 });
    expect(result.status).toBe("cancelled");
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
