/**
 * IDIO — Planner & Dependency Resolver Unit Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  validatePlan,
  topologicalSort,
  flattenLayers,
  isOutputRef,
  parseOutputRef,
  resolveStepParams,
  evaluateCondition,
} from "./planner.js";
import { registerStepType, clearStepRegistry } from "./registry.js";
import type { ExecutionPlan, PlanStep, StepInstanceId, StepCondition } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function step(id: string, type: string, params: Record<string, unknown> = {}, dependsOn?: string[]): PlanStep {
  return { id: id as StepInstanceId, type, name: id, params, dependsOn: (dependsOn ?? []) as StepInstanceId[] };
}

function plan(id: string, name: string, steps: PlanStep[]): ExecutionPlan {
  return { id, name, steps, description: "", globalParams: {}, createdAt: new Date().toISOString() };
}

function registerTestSteps() {
  const handler = { execute: async () => ({}) };

  registerStepType({
    id: "create-resource-group",
    label: "Create RG",
    description: "",
    category: "resource-group",
    parameters: [
      { name: "name", type: "string", description: "", required: true },
      { name: "location", type: "string", description: "", required: true },
    ],
    outputs: [
      { name: "resourceGroupName", type: "string", description: "" },
      { name: "resourceGroupId", type: "string", description: "" },
    ],
    rollbackSupported: true,
    estimatedDurationMs: 5000,
  }, handler);

  registerStepType({
    id: "create-web-app",
    label: "Create Web App",
    description: "",
    category: "compute",
    parameters: [
      { name: "resourceGroup", type: "string", description: "", required: true },
      { name: "name", type: "string", description: "", required: true },
      { name: "location", type: "string", description: "", required: true },
      { name: "planId", type: "string", description: "", required: true },
    ],
    outputs: [
      { name: "webAppName", type: "string", description: "" },
      { name: "webAppId", type: "string", description: "" },
      { name: "webAppUrl", type: "string", description: "" },
    ],
    rollbackSupported: false,
    estimatedDurationMs: 30000,
  }, handler);

  registerStepType({
    id: "create-app-service-plan",
    label: "Create Plan",
    description: "",
    category: "compute",
    parameters: [
      { name: "resourceGroup", type: "string", description: "", required: true },
      { name: "name", type: "string", description: "", required: true },
      { name: "location", type: "string", description: "", required: true },
    ],
    outputs: [
      { name: "planName", type: "string", description: "" },
      { name: "planId", type: "string", description: "" },
    ],
    rollbackSupported: false,
    estimatedDurationMs: 15000,
  }, handler);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Output Reference Parsing", () => {
  it("detects valid output refs", () => {
    expect(isOutputRef("step1.outputs.name")).toBe(true);
    expect(isOutputRef("rg.outputs.resourceGroupName")).toBe(true);
    expect(isOutputRef("my-step.outputs.foo_bar")).toBe(true);
  });

  it("rejects invalid output refs", () => {
    expect(isOutputRef("not-a-ref")).toBe(false);
    expect(isOutputRef("")).toBe(false);
    expect(isOutputRef("step1.outputs.")).toBe(false);
    expect(isOutputRef(".outputs.name")).toBe(false);
    expect(isOutputRef("step1.results.name")).toBe(false);
  });

  it("parses output refs correctly", () => {
    expect(parseOutputRef("step1.outputs.name")).toEqual({ sourceStepId: "step1", outputName: "name" });
    expect(parseOutputRef("my-step.outputs.foo_bar")).toEqual({ sourceStepId: "my-step", outputName: "foo_bar" });
    expect(parseOutputRef("invalid")).toBeNull();
  });
});

describe("resolveStepParams", () => {
  it("resolves output references from completed steps", () => {
    const s = step("webapp", "create-web-app", {
      resourceGroup: "rg.outputs.resourceGroupName",
      name: "myapp",
      location: "eastus",
      planId: "plan.outputs.planId",
    });

    const outputs = new Map<string, Record<string, unknown>>();
    outputs.set("rg", { resourceGroupName: "my-rg", resourceGroupId: "/sub/rg/my-rg" });
    outputs.set("plan", { planName: "my-plan", planId: "/sub/rg/plan/my-plan" });

    const resolved = resolveStepParams(s, outputs, {});
    expect(resolved.resourceGroup).toBe("my-rg");
    expect(resolved.planId).toBe("/sub/rg/plan/my-plan");
    expect(resolved.name).toBe("myapp");
    expect(resolved.location).toBe("eastus");
  });

  it("resolves $global references", () => {
    const s = step("rg", "create-resource-group", {
      name: "my-rg",
      location: "$global.location",
    });
    const resolved = resolveStepParams(s, new Map(), { location: "westus2" });
    expect(resolved.location).toBe("westus2");
  });

  it("throws when referenced step has no outputs", () => {
    const s = step("webapp", "create-web-app", {
      resourceGroup: "missing.outputs.name",
      name: "a",
      location: "b",
      planId: "c",
    });
    expect(() => resolveStepParams(s, new Map(), {})).toThrow(/Cannot resolve.*missing/);
  });

  it("throws when referenced output does not exist", () => {
    const s = step("webapp", "create-web-app", {
      resourceGroup: "rg.outputs.nonExisting",
      name: "a",
      location: "b",
      planId: "c",
    });
    const outputs = new Map<string, Record<string, unknown>>();
    outputs.set("rg", { resourceGroupName: "rg-1" });
    expect(() => resolveStepParams(s, outputs, {})).toThrow(/nonExisting.*not found/);
  });
});

describe("evaluateCondition", () => {
  const states = new Map<string, { status: string }>();
  states.set("step1", { status: "succeeded" });
  states.set("step2", { status: "failed" });

  const outputs = new Map<string, Record<string, unknown>>();
  outputs.set("step1", { result: "ok", count: 5 });

  it("evaluates 'succeeded'", () => {
    expect(evaluateCondition({ check: "succeeded", stepId: "step1" }, states, outputs)).toBe(true);
    expect(evaluateCondition({ check: "succeeded", stepId: "step2" }, states, outputs)).toBe(false);
  });

  it("evaluates 'failed'", () => {
    expect(evaluateCondition({ check: "failed", stepId: "step2" }, states, outputs)).toBe(true);
    expect(evaluateCondition({ check: "failed", stepId: "step1" }, states, outputs)).toBe(false);
  });

  it("evaluates 'output-equals'", () => {
    const cond: StepCondition = { check: "output-equals", stepId: "step1", outputName: "result", expectedValue: "ok" };
    expect(evaluateCondition(cond, states, outputs)).toBe(true);
    const cond2: StepCondition = { check: "output-equals", stepId: "step1", outputName: "result", expectedValue: "fail" };
    expect(evaluateCondition(cond2, states, outputs)).toBe(false);
  });

  it("evaluates 'output-truthy'", () => {
    expect(evaluateCondition({ check: "output-truthy", stepId: "step1", outputName: "count" }, states, outputs)).toBe(true);
    expect(evaluateCondition({ check: "output-truthy", stepId: "step1", outputName: "missing" }, states, outputs)).toBe(false);
  });
});

describe("Plan Validation", () => {
  beforeEach(() => {
    clearStepRegistry();
    registerTestSteps();
  });

  it("validates a correct plan", () => {
    const p = plan("test-plan", "Test", [
      step("rg", "create-resource-group", { name: "my-rg", location: "eastus" }),
      step("plan", "create-app-service-plan", {
        resourceGroup: "rg.outputs.resourceGroupName",
        name: "my-plan",
        location: "eastus",
      }, ["rg"]),
    ]);
    const result = validatePlan(p);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("rejects unknown step types", () => {
    const p = plan("test", "Test", [step("x", "unknown-type", {})]);
    const result = validatePlan(p);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("Unknown step type"))).toBe(true);
  });

  it("rejects missing required parameters", () => {
    const p = plan("test", "Test", [step("rg", "create-resource-group", { name: "my-rg" })]); // missing location
    const result = validatePlan(p);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("location"))).toBe(true);
  });

  it("rejects invalid dependsOn references", () => {
    const p = plan("test", "Test", [step("rg", "create-resource-group", { name: "rg", location: "eastus" }, ["missing"])]);
    const result = validatePlan(p);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("unknown step"))).toBe(true);
  });

  it("rejects self-dependency", () => {
    const p = plan("test", "Test", [step("rg", "create-resource-group", { name: "rg", location: "eastus" }, ["rg"])]);
    const result = validatePlan(p);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("depends on itself"))).toBe(true);
  });

  it("rejects duplicate step IDs", () => {
    const p = plan("test", "Test", [
      step("rg", "create-resource-group", { name: "rg1", location: "eastus" }),
      step("rg", "create-resource-group", { name: "rg2", location: "westus" }),
    ]);
    const result = validatePlan(p);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("Duplicate step ID"))).toBe(true);
  });

  it("detects invalid output reference to unknown step", () => {
    const p = plan("test", "Test", [
      step("plan", "create-app-service-plan", {
        resourceGroup: "missing.outputs.resourceGroupName",
        name: "plan",
        location: "eastus",
      }),
    ]);
    const result = validatePlan(p);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("unknown step"))).toBe(true);
  });

  it("detects invalid output name in reference", () => {
    const p = plan("test", "Test", [
      step("rg", "create-resource-group", { name: "rg", location: "eastus" }),
      step("plan", "create-app-service-plan", {
        resourceGroup: "rg.outputs.nonExistentOutput",
        name: "plan",
        location: "eastus",
      }, ["rg"]),
    ]);
    const result = validatePlan(p);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("no output named"))).toBe(true);
  });

  it("detects circular dependencies", () => {
    const p = plan("test", "Test", [
      step("a", "create-resource-group", { name: "a", location: "eastus" }, ["b"]),
      step("b", "create-resource-group", { name: "b", location: "eastus" }, ["a"]),
    ]);
    const result = validatePlan(p);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("Circular dependency"))).toBe(true);
  });
});

describe("Topological Sort", () => {
  it("sorts independent steps into one layer", () => {
    const steps = [
      step("a", "t", {}),
      step("b", "t", {}),
      step("c", "t", {}),
    ];
    const layers = topologicalSort(steps);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toHaveLength(3);
  });

  it("sorts dependent steps into multiple layers", () => {
    const steps = [
      step("rg", "t", {}),
      step("plan", "t", {}, ["rg"]),
      step("app", "t", {}, ["plan"]),
    ];
    const layers = topologicalSort(steps);
    expect(layers).toHaveLength(3);
    expect(layers[0][0].id).toBe("rg");
    expect(layers[1][0].id).toBe("plan");
    expect(layers[2][0].id).toBe("app");
  });

  it("groups parallel steps in same layer", () => {
    const steps = [
      step("rg", "t", {}),
      step("vnet", "t", {}, ["rg"]),
      step("nsg", "t", {}, ["rg"]),
      step("sql", "t", {}, ["rg"]),
      step("app", "t", {}, ["vnet", "nsg", "sql"]),
    ];
    const layers = topologicalSort(steps);
    expect(layers).toHaveLength(3);
    expect(layers[0]).toHaveLength(1); // rg
    expect(layers[1]).toHaveLength(3); // vnet, nsg, sql
    expect(layers[2]).toHaveLength(1); // app
  });

  it("includes implicit deps from output references", () => {
    const steps = [
      step("rg", "t", {}),
      step("plan", "t", { rg: "rg.outputs.name" }), // implicit dep via output ref
    ];
    const layers = topologicalSort(steps);
    expect(layers).toHaveLength(2);
    expect(layers[0][0].id).toBe("rg");
    expect(layers[1][0].id).toBe("plan");
  });

  it("throws on cycles", () => {
    const steps = [
      step("a", "t", {}, ["b"]),
      step("b", "t", {}, ["a"]),
    ];
    expect(() => topologicalSort(steps)).toThrow(/Cycle detected/);
  });

  it("flattenLayers produces correct order", () => {
    const steps = [
      step("rg", "t", {}),
      step("plan", "t", {}, ["rg"]),
      step("app", "t", {}, ["plan"]),
    ];
    const flat = flattenLayers(topologicalSort(steps));
    expect(flat.map((s) => s.id)).toEqual(["rg", "plan", "app"]);
  });
});
