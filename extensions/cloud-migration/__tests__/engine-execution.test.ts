/**
 * Cross-Cloud Migration Engine — Execution Tests
 *
 * Tests the core executePlan function:
 * - Successful multi-layer DAG execution
 * - Step failure → auto-rollback
 * - Output reference resolution between steps
 * - Dry-run mode
 * - failFast behaviour
 * - Event emission during execution
 * - Phase transitions
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  executePlan,
  resolveStepHandler,
  resolveOutputRefs,
  topologicalSort,
  addEventListener,
  createMigrationJob,
  transitionJobPhase,
  clearIdempotencyRegistry,
} from "../src/core/migration-engine.js";

import { getPluginState, resetPluginState } from "../src/state.js";

import { isValidPhaseTransition } from "../src/types.js";

import type {
  MigrationStep,
  MigrationStepHandler,
  MigrationStepType,
  MigrationExecutionPlan,
  MigrationCostEstimate,
  MigrationEvent,
} from "../src/types.js";

// =============================================================================
// Helpers
// =============================================================================

function registerHandler(
  type: MigrationStepType,
  handler: MigrationStepHandler,
): void {
  getPluginState().stepHandlers.set(type, handler);
}

function makeStep(overrides: Partial<MigrationStep> & Pick<MigrationStep, "id" | "type" | "name">): MigrationStep {
  return {
    description: `Step: ${overrides.name}`,
    params: {},
    dependsOn: [],
    timeoutMs: 60_000,
    pipeline: "compute",
    resourceType: "vm",
    requiresRollback: false,
    ...overrides,
  };
}

const emptyCostEstimate: MigrationCostEstimate = {
  sourceProvider: "aws",
  targetProvider: "azure",
  egressCost: { category: "egress", description: "", amount: 0, unit: "USD", quantity: 0 },
  transferCost: { category: "transfer", description: "", amount: 0, unit: "USD", quantity: 0 },
  targetInfraCost: { category: "infra", description: "", amount: 0, unit: "USD", quantity: 0 },
  conversionCost: { category: "conversion", description: "", amount: 0, unit: "USD", quantity: 0 },
  totalEstimatedCost: 0,
  currency: "USD",
  breakdown: [],
  estimatedDurationHours: 1,
  confidenceLevel: "low",
};

function makePlan(steps: MigrationStep[], jobId: string = "job-1"): MigrationExecutionPlan {
  return {
    id: "plan-1",
    name: "Test Plan",
    description: "Test execution plan",
    jobId,
    steps,
    globalParams: { region: "us-east-1" },
    createdAt: new Date().toISOString(),
    estimatedDurationMs: 10000,
    estimatedCost: emptyCostEstimate,
    riskAssessment: { overallRisk: "low", factors: [] },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("migration-engine/executePlan", () => {
  beforeEach(() => {
    resetPluginState();
    clearIdempotencyRegistry();
  });

  describe("successful execution", () => {
    it("executes a single-step plan", async () => {
      const executeFn = vi.fn().mockResolvedValue({ imageId: "ami-123" });
      registerHandler("snapshot-source", { execute: executeFn });

      const plan = makePlan([
        makeStep({ id: "s1", type: "snapshot-source", name: "Snapshot" }),
      ]);

      // Create the job so executePlan can find it
      const state = getPluginState();
      state.jobs.set(plan.jobId, {
        id: plan.jobId,
        name: "Test Job",
        description: "",
        phase: "executing",
        phaseHistory: [],
        source: { provider: "aws", region: "us-east-1" },
        target: { provider: "azure", region: "eastus" },
        resourceIds: [],
        resourceTypes: [],
        integrityReports: [],
        compatibilityResults: [],
        auditTrail: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        initiatedBy: "test",
        metadata: {},
      });

      const result = await executePlan(plan);

      expect(result.status).toBe("succeeded");
      expect(result.steps.length).toBe(1);
      expect(result.steps[0].status).toBe("succeeded");
      expect(result.errors.length).toBe(0);
      expect(executeFn).toHaveBeenCalledTimes(1);
    });

    it("executes a multi-layer DAG in correct order", async () => {
      const executionOrder: string[] = [];

      registerHandler("snapshot-source", {
        execute: async () => { executionOrder.push("snapshot"); return { snapshotId: "snap-1" }; },
      });
      registerHandler("export-image", {
        execute: async () => { executionOrder.push("export"); return { imagePath: "/tmp/img.vmdk" }; },
      });
      registerHandler("import-image", {
        execute: async () => { executionOrder.push("import"); return { imageId: "ami-789" }; },
      });

      const steps = [
        makeStep({ id: "s1", type: "snapshot-source", name: "Snapshot", dependsOn: [] }),
        makeStep({ id: "s2", type: "export-image", name: "Export", dependsOn: ["s1"] }),
        makeStep({ id: "s3", type: "import-image", name: "Import", dependsOn: ["s2"] }),
      ];

      const plan = makePlan(steps);

      const result = await executePlan(plan);

      expect(result.status).toBe("succeeded");
      expect(executionOrder).toEqual(["snapshot", "export", "import"]);
    });

    it("executes independent steps in the same layer concurrently", async () => {
      const startTimes: Record<string, number> = {};

      registerHandler("snapshot-source", {
        execute: async () => {
          startTimes["snapshot"] = Date.now();
          await new Promise((r) => setTimeout(r, 50));
          return {};
        },
      });
      registerHandler("inventory-source", {
        execute: async () => {
          startTimes["inventory"] = Date.now();
          await new Promise((r) => setTimeout(r, 50));
          return {};
        },
      });
      registerHandler("map-network", {
        execute: async () => {
          startTimes["network"] = Date.now();
          await new Promise((r) => setTimeout(r, 50));
          return {};
        },
      });

      // All three have no dependencies → same layer
      const steps = [
        makeStep({ id: "s1", type: "snapshot-source", name: "Snapshot", pipeline: "compute" }),
        makeStep({ id: "s2", type: "inventory-source", name: "Inventory", pipeline: "data", resourceType: "object-storage" }),
        makeStep({ id: "s3", type: "map-network", name: "Network Map", pipeline: "network", resourceType: "security-rules" }),
      ];

      const plan = makePlan(steps);
      const result = await executePlan(plan, { maxConcurrency: 10 });

      expect(result.status).toBe("succeeded");

      // All should start within close time proximity (same layer)
      const times = Object.values(startTimes);
      const maxDelta = Math.max(...times) - Math.min(...times);
      expect(maxDelta).toBeLessThan(40); // Should start near-simultaneously
    });
  });

  describe("output reference resolution", () => {
    it("resolves output refs between sequential steps", async () => {
      let capturedParams: Record<string, unknown> = {};

      registerHandler("snapshot-source", {
        execute: async () => ({ snapshotId: "snap-abc" }),
      });
      registerHandler("export-image", {
        execute: async (ctx) => {
          capturedParams = ctx.params;
          return { imagePath: "/tmp/disk.vmdk" };
        },
      });

      const steps = [
        makeStep({
          id: "snap",
          type: "snapshot-source",
          name: "Snapshot",
        }),
        makeStep({
          id: "export",
          type: "export-image",
          name: "Export",
          dependsOn: ["snap"],
          params: { sourceSnapshot: "snap.outputs.snapshotId" },
        }),
      ];

      const plan = makePlan(steps);
      const result = await executePlan(plan);

      expect(result.status).toBe("succeeded");
      expect(capturedParams.sourceSnapshot).toBe("snap-abc");
    });

    it("throws on unresolved output refs", async () => {
      registerHandler("export-image", {
        execute: async () => ({}),
      });

      const steps = [
        makeStep({
          id: "export",
          type: "export-image",
          name: "Export",
          params: { sourceSnapshot: "nonexistent.outputs.snapshotId" },
        }),
      ];

      const plan = makePlan(steps);
      const result = await executePlan(plan);

      // Should fail because ref can't be resolved
      expect(result.status).not.toBe("succeeded");
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("dry-run mode", () => {
    it("does not call execute in dry-run mode", async () => {
      const executeFn = vi.fn().mockResolvedValue({});
      registerHandler("snapshot-source", { execute: executeFn });

      const steps = [
        makeStep({ id: "s1", type: "snapshot-source", name: "Snapshot" }),
      ];

      const plan = makePlan(steps);
      const result = await executePlan(plan, { dryRun: true });

      expect(result.status).toBe("succeeded");
      expect(executeFn).not.toHaveBeenCalled();
      expect(result.steps[0].outputs).toEqual({ dryRun: true });
    });
  });

  describe("failure and rollback", () => {
    it("auto-rollbacks completed steps on failure", async () => {
      const rollbackCalled: string[] = [];

      registerHandler("snapshot-source", {
        execute: async () => ({ snapshotId: "snap-1" }),
        rollback: async () => { rollbackCalled.push("snapshot"); },
      });
      registerHandler("export-image", {
        execute: async () => { throw new Error("Export failed: disk full"); },
      });

      const steps = [
        makeStep({
          id: "s1",
          type: "snapshot-source",
          name: "Snapshot",
          requiresRollback: true,
        }),
        makeStep({
          id: "s2",
          type: "export-image",
          name: "Export",
          dependsOn: ["s1"],
        }),
      ];

      const plan = makePlan(steps);
      const result = await executePlan(plan, { autoRollback: true });

      expect(result.status).toBe("rolled-back");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Export failed: disk full");
      expect(rollbackCalled).toEqual(["snapshot"]);
    });

    it("does not rollback when autoRollback is false", async () => {
      const rollbackCalled: string[] = [];

      registerHandler("snapshot-source", {
        execute: async () => ({ snapshotId: "snap-1" }),
        rollback: async () => { rollbackCalled.push("snapshot"); },
      });
      registerHandler("export-image", {
        execute: async () => { throw new Error("Export failed"); },
      });

      const steps = [
        makeStep({ id: "s1", type: "snapshot-source", name: "Snapshot" }),
        makeStep({ id: "s2", type: "export-image", name: "Export", dependsOn: ["s1"] }),
      ];

      const plan = makePlan(steps);
      const result = await executePlan(plan, { autoRollback: false });

      expect(result.status).toBe("failed");
      expect(rollbackCalled).toEqual([]);
    });

    it("handles rollback handler errors gracefully", async () => {
      registerHandler("snapshot-source", {
        execute: async () => ({ snapshotId: "snap-1" }),
        rollback: async () => { throw new Error("Rollback failed: snapshot locked"); },
      });
      registerHandler("export-image", {
        execute: async () => { throw new Error("Export error"); },
      });

      const steps = [
        makeStep({ id: "s1", type: "snapshot-source", name: "Snapshot" }),
        makeStep({ id: "s2", type: "export-image", name: "Export", dependsOn: ["s1"] }),
      ];

      const plan = makePlan(steps);
      const result = await executePlan(plan, { autoRollback: true });

      // Should still complete execution (rolled-back status)
      expect(result.status).toBe("rolled-back");
      // Rollback error should be recorded
      const snapshotStep = result.steps.find((s) => s.stepId === "s1");
      expect(snapshotStep?.rollbackError).toContain("Rollback failed");
    });

    it("failFast stops execution after first failure", async () => {
      const executed: string[] = [];

      registerHandler("snapshot-source", {
        execute: async () => { executed.push("s1"); throw new Error("fail"); },
      });
      registerHandler("inventory-source", {
        execute: async () => { executed.push("s2"); return {}; },
      });
      registerHandler("export-image", {
        execute: async () => { executed.push("s3"); return {}; },
      });

      // s1 and s2 are in the same layer (no deps), s3 depends on s1
      const steps = [
        makeStep({ id: "s1", type: "snapshot-source", name: "Snapshot" }),
        makeStep({ id: "s2", type: "inventory-source", name: "Inventory", pipeline: "data", resourceType: "object-storage" }),
        makeStep({ id: "s3", type: "export-image", name: "Export", dependsOn: ["s1"] }),
      ];

      const plan = makePlan(steps);
      const result = await executePlan(plan, { failFast: true, autoRollback: false });

      expect(result.status).toBe("failed");
      // s3 should not have been executed
      expect(executed).not.toContain("s3");
    });
  });

  describe("conditional steps", () => {
    it("skips step when condition check fails", async () => {
      registerHandler("snapshot-source", {
        execute: async () => { throw new Error("boom"); },
      });
      registerHandler("export-image", {
        execute: async () => ({ result: "exported" }),
      });

      const steps = [
        makeStep({ id: "s1", type: "snapshot-source", name: "Snapshot" }),
        makeStep({
          id: "s2",
          type: "export-image",
          name: "Export",
          dependsOn: ["s1"],
          condition: { stepId: "s1", check: "succeeded" },
        }),
      ];

      const plan = makePlan(steps);
      const result = await executePlan(plan, { failFast: false, autoRollback: false });

      const exportStep = result.steps.find((s) => s.stepId === "s2");
      expect(exportStep?.status).toBe("skipped");
    });
  });

  describe("event emission", () => {
    it("emits execution:start and execution:complete events", async () => {
      const events: MigrationEvent[] = [];
      const removeListener = addEventListener((e) => events.push(e));

      registerHandler("snapshot-source", {
        execute: async () => ({}),
      });

      const plan = makePlan([
        makeStep({ id: "s1", type: "snapshot-source", name: "Snapshot" }),
      ]);

      await executePlan(plan);

      removeListener();

      const types = events.map((e) => e.type);
      expect(types).toContain("execution:start");
      expect(types).toContain("execution:complete");
      expect(types).toContain("step:start");
      expect(types).toContain("step:complete");
    });

    it("emits execution:failed event on failure", async () => {
      const events: MigrationEvent[] = [];
      const removeListener = addEventListener((e) => events.push(e));

      registerHandler("snapshot-source", {
        execute: async () => { throw new Error("fail"); },
      });

      const plan = makePlan([
        makeStep({ id: "s1", type: "snapshot-source", name: "Snapshot" }),
      ]);

      await executePlan(plan, { autoRollback: true });

      removeListener();

      const types = events.map((e) => e.type);
      expect(types).toContain("execution:failed");
    });
  });
});

// =============================================================================
// resolveStepHandler
// =============================================================================

describe("migration-engine/resolveStepHandler", () => {
  beforeEach(() => { resetPluginState(); });

  it("returns a registered handler", () => {
    const handler: MigrationStepHandler = { execute: async () => ({}) };
    getPluginState().stepHandlers.set("snapshot-source", handler);
    expect(resolveStepHandler("snapshot-source")).toBe(handler);
  });

  it("throws for unregistered handler", () => {
    expect(() => resolveStepHandler("snapshot-source")).toThrow("No step handler registered");
  });
});

// =============================================================================
// resolveOutputRefs
// =============================================================================

describe("migration-engine/resolveOutputRefs", () => {
  it("resolves valid output references", () => {
    const outputs = new Map<string, unknown>();
    outputs.set("step-1.outputs.imageId", "ami-123");
    outputs.set("step-2.outputs.bucketName", "my-bucket");

    const params = {
      image: "step-1.outputs.imageId",
      bucket: "step-2.outputs.bucketName",
      region: "us-east-1", // plain value — not a ref
    };

    const result = resolveOutputRefs(params, outputs);
    expect(result.image).toBe("ami-123");
    expect(result.bucket).toBe("my-bucket");
    expect(result.region).toBe("us-east-1");
  });

  it("throws for unresolved references", () => {
    const outputs = new Map<string, unknown>();
    const params = { image: "nonexistent.outputs.imageId" };

    expect(() => resolveOutputRefs(params, outputs)).toThrow("Unresolved output reference");
  });

  it("passes through non-string values unchanged", () => {
    const outputs = new Map<string, unknown>();
    const params = { count: 42, active: true, tags: { env: "prod" } };

    const result = resolveOutputRefs(params, outputs);
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.tags).toEqual({ env: "prod" });
  });
});

// =============================================================================
// topologicalSort
// =============================================================================

describe("migration-engine/topologicalSort", () => {
  it("sorts independent steps into a single layer", () => {
    const steps = [
      makeStep({ id: "a", type: "snapshot-source", name: "A" }),
      makeStep({ id: "b", type: "inventory-source", name: "B", pipeline: "data", resourceType: "object-storage" }),
      makeStep({ id: "c", type: "map-network", name: "C", pipeline: "network", resourceType: "security-rules" }),
    ];

    const layers = topologicalSort(steps);
    expect(layers.length).toBe(1);
    expect(layers[0].length).toBe(3);
  });

  it("sorts linear dependencies into sequential layers", () => {
    const steps = [
      makeStep({ id: "a", type: "snapshot-source", name: "Snapshot" }),
      makeStep({ id: "b", type: "export-image", name: "Export", dependsOn: ["a"] }),
      makeStep({ id: "c", type: "import-image", name: "Import", dependsOn: ["b"] }),
    ];

    const layers = topologicalSort(steps);
    expect(layers.length).toBe(3);
    expect(layers[0][0].id).toBe("a");
    expect(layers[1][0].id).toBe("b");
    expect(layers[2][0].id).toBe("c");
  });

  it("detects diamond dependency pattern", () => {
    //   A
    //  / \
    // B   C
    //  \ /
    //   D
    const steps = [
      makeStep({ id: "a", type: "snapshot-source", name: "A" }),
      makeStep({ id: "b", type: "export-image", name: "B", dependsOn: ["a"] }),
      makeStep({ id: "c", type: "transfer-image", name: "C", dependsOn: ["a"] }),
      makeStep({ id: "d", type: "import-image", name: "D", dependsOn: ["b", "c"] }),
    ];

    const layers = topologicalSort(steps);
    expect(layers.length).toBe(3);
    // Layer 0: A
    expect(layers[0].map((s) => s.id)).toEqual(["a"]);
    // Layer 1: B, C (parallel)
    expect(layers[1].map((s) => s.id).sort()).toEqual(["b", "c"]);
    // Layer 2: D
    expect(layers[2].map((s) => s.id)).toEqual(["d"]);
  });

  it("handles empty step list", () => {
    const layers = topologicalSort([]);
    expect(layers.length).toBe(0);
  });
});

// =============================================================================
// Phase Transition Tests
// =============================================================================

describe("types/isValidPhaseTransition", () => {
  it("allows created → assessing", () => {
    expect(isValidPhaseTransition("created", "assessing")).toBe(true);
  });

  it("allows assessing → planning", () => {
    expect(isValidPhaseTransition("assessing", "planning")).toBe(true);
  });

  it("allows planning → awaiting-approval", () => {
    expect(isValidPhaseTransition("planning", "awaiting-approval")).toBe(true);
  });

  it("allows awaiting-approval → executing", () => {
    expect(isValidPhaseTransition("awaiting-approval", "executing")).toBe(true);
  });

  it("allows executing → verifying", () => {
    expect(isValidPhaseTransition("executing", "verifying")).toBe(true);
  });

  it("allows verifying → cutting-over", () => {
    expect(isValidPhaseTransition("verifying", "cutting-over")).toBe(true);
  });

  it("allows cutting-over → completed", () => {
    expect(isValidPhaseTransition("cutting-over", "completed")).toBe(true);
  });

  it("allows executing → rolling-back", () => {
    expect(isValidPhaseTransition("executing", "rolling-back")).toBe(true);
  });

  it("allows rolling-back → rolled-back", () => {
    expect(isValidPhaseTransition("rolling-back", "rolled-back")).toBe(true);
  });

  it("allows most active phases → failed", () => {
    // All phases from assessing onward can transition to failed
    const phases: Array<Parameters<typeof isValidPhaseTransition>[0]> = [
      "assessing", "planning", "awaiting-approval",
      "executing", "verifying", "cutting-over", "rolling-back",
    ];
    for (const phase of phases) {
      expect(isValidPhaseTransition(phase, "failed")).toBe(true);
    }
  });

  it("disallows created → failed (must assess first)", () => {
    expect(isValidPhaseTransition("created", "failed")).toBe(false);
  });

  it("disallows backward transitions", () => {
    expect(isValidPhaseTransition("executing", "planning")).toBe(false);
    expect(isValidPhaseTransition("verifying", "assessing")).toBe(false);
    expect(isValidPhaseTransition("completed", "executing")).toBe(false);
  });

  it("disallows completed → created", () => {
    expect(isValidPhaseTransition("completed", "created")).toBe(false);
  });
});
