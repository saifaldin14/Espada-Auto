/**
 * Cross-Cloud Migration Engine — Migration Engine (Core Orchestrator) Tests
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  registerStepHandler,
  resolveStepHandler,
  topologicalSort,
  resolveOutputRefs,
  addEventListener,
  createMigrationJob,
  transitionJobPhase,
  getJob,
  listJobs,
} from "../src/core/migration-engine.js";

import { resetPluginState, getPluginState } from "../src/state.js";
import type { MigrationStep, MigrationStepHandler, MigrationStepContext } from "../src/types.js";

// Helper to create a job with correct params
function makeJob(overrides?: Record<string, unknown>) {
  return createMigrationJob({
    name: "Test Migration",
    description: "Unit test job",
    source: { provider: "aws", region: "us-east-1" },
    target: { provider: "azure", region: "eastus" },
    resourceIds: [],
    resourceTypes: ["vm"],
    initiatedBy: "test",
    ...overrides,
  } as any);
}

describe("migration-engine", () => {
  beforeEach(() => {
    resetPluginState();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step Handler Registry
  // ─────────────────────────────────────────────────────────────────────────
  describe("registerStepHandler / resolveStepHandler", () => {
    it("registers and resolves a handler", () => {
      const handler: MigrationStepHandler = {
        async execute(ctx: MigrationStepContext) {
          return { outputs: {} };
        },
      };
      registerStepHandler("snapshot-source", handler, false);
      const resolved = resolveStepHandler("snapshot-source");
      expect(resolved).toBe(handler);
    });

    it("throws when requiring rollback but none provided", () => {
      const handler: MigrationStepHandler = {
        async execute() { return {}; },
      };
      expect(() => registerStepHandler("snapshot-source", handler, true)).toThrow(/rollback/);
    });

    it("throws for unregistered handler", () => {
      expect(() => resolveStepHandler("export-database")).toThrow();
    });

    it("tracks handler count in plugin state", () => {
      const handler: MigrationStepHandler = { async execute() { return { outputs: {} }; } };
      registerStepHandler("snapshot-source", handler, false);
      registerStepHandler("export-image", handler, false);
      expect(getPluginState().stepHandlers.size).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Topological Sort (DAG layers)
  // ─────────────────────────────────────────────────────────────────────────
  describe("topologicalSort", () => {
    function makeStep(id: string, deps: string[] = []): MigrationStep {
      return {
        id,
        name: id,
        type: "snapshot-source",
        dependsOn: deps,
        params: {},
      } as MigrationStep;
    }

    it("returns single layer for independent steps", () => {
      const layers = topologicalSort([
        makeStep("a"),
        makeStep("b"),
        makeStep("c"),
      ]);
      expect(layers.length).toBe(1);
      expect(layers[0].length).toBe(3);
    });

    it("returns sequential layers for chain", () => {
      const layers = topologicalSort([
        makeStep("a"),
        makeStep("b", ["a"]),
        makeStep("c", ["b"]),
      ]);
      expect(layers.length).toBe(3);
      expect(layers[0].map((s) => s.id)).toContain("a");
      expect(layers[1].map((s) => s.id)).toContain("b");
      expect(layers[2].map((s) => s.id)).toContain("c");
    });

    it("handles diamond dependencies", () => {
      const layers = topologicalSort([
        makeStep("a"),
        makeStep("b", ["a"]),
        makeStep("c", ["a"]),
        makeStep("d", ["b", "c"]),
      ]);
      expect(layers.length).toBe(3);
      expect(layers[0].map((s) => s.id)).toEqual(["a"]);
      expect(layers[1].map((s) => s.id).sort()).toEqual(["b", "c"]);
      expect(layers[2].map((s) => s.id)).toEqual(["d"]);
    });

    it("returns empty for empty input", () => {
      expect(topologicalSort([])).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Output Reference Resolution
  // ─────────────────────────────────────────────────────────────────────────
  describe("resolveOutputRefs", () => {
    it("resolves stepId.outputs.name references", () => {
      const params = {
        imageId: "step-a.outputs.imageId",
        plain: "no-ref",
      };
      const outputMap = new Map<string, unknown>([
        ["step-a.outputs.imageId", "ami-12345"],
      ]);
      const resolved = resolveOutputRefs(params, outputMap);
      expect(resolved.imageId).toBe("ami-12345");
      expect(resolved.plain).toBe("no-ref");
    });

    it("throws for unresolvable refs", () => {
      const params = { ref: "missing.outputs.val" };
      const outputMap = new Map<string, unknown>();
      expect(() => resolveOutputRefs(params, outputMap)).toThrow(/Unresolved/);
    });

    it("passes through non-reference strings", () => {
      const params = { name: "just a string", count: 42 };
      const outputMap = new Map<string, unknown>();
      const resolved = resolveOutputRefs(params, outputMap);
      expect(resolved.name).toBe("just a string");
      expect(resolved.count).toBe(42);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Event Listeners
  // ─────────────────────────────────────────────────────────────────────────
  describe("addEventListener", () => {
    it("adds a listener and returns unsubscribe function", () => {
      const listener = vi.fn();
      const unsub = addEventListener(listener);
      expect(getPluginState().eventListeners.size).toBe(1);
      unsub();
      expect(getPluginState().eventListeners.size).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Job CRUD
  // ─────────────────────────────────────────────────────────────────────────
  describe("createMigrationJob", () => {
    it("creates a job in 'created' phase", () => {
      const job = makeJob();
      expect(job.id).toBeTruthy();
      expect(job.phase).toBe("created");
      expect(job.source.provider).toBe("aws");
      expect(job.target.provider).toBe("azure");
    });

    it("stores the job in plugin state", () => {
      const job = makeJob();
      expect(getPluginState().jobs.has(job.id)).toBe(true);
    });

    it("increments diagnostics.jobsCreated", () => {
      makeJob();
      expect(getPluginState().diagnostics.jobsCreated).toBe(1);
    });
  });

  describe("getJob / listJobs", () => {
    it("getJob returns undefined for non-existent ID", () => {
      expect(getJob("nonexistent")).toBeUndefined();
    });

    it("listJobs returns all jobs", () => {
      makeJob();
      makeJob({ name: "Job 2" });
      expect(listJobs().length).toBe(2);
    });

    it("listJobs filters by phase", () => {
      const job = makeJob();
      makeJob({ name: "Job 2" });

      // Transition one job
      transitionJobPhase(job.id, "assessing", "test", "test");

      const assessing = listJobs({ phase: "assessing" });
      expect(assessing.length).toBe(1);
      expect(assessing[0].id).toBe(job.id);

      const created = listJobs({ phase: "created" });
      expect(created.length).toBe(1);
    });
  });

  describe("transitionJobPhase", () => {
    it("transitions through valid phases", () => {
      const job = makeJob();

      transitionJobPhase(job.id, "assessing", "test", "start assessment");
      expect(getJob(job.id)?.phase).toBe("assessing");

      transitionJobPhase(job.id, "planning", "test", "assessment done");
      expect(getJob(job.id)?.phase).toBe("planning");
    });

    it("rejects invalid transitions", () => {
      const job = makeJob();
      // created → executing is not valid
      expect(() => transitionJobPhase(job.id, "executing", "test", "skip")).toThrow();
    });

    it("records phase history entry", () => {
      const job = makeJob();
      transitionJobPhase(job.id, "assessing", "test", "test");
      const updated = getJob(job.id)!;
      expect(updated.phaseHistory.length).toBeGreaterThanOrEqual(1);
    });

    it("throws for non-existent job", () => {
      expect(() => transitionJobPhase("fake", "assessing", "test", "test")).toThrow();
    });
  });
});
