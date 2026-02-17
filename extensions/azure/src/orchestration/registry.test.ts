/**
 * IDIO — Registry Unit Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerStepType,
  getStepDefinition,
  getStepHandler,
  listStepTypes,
  listStepTypesByCategory,
  hasStepType,
  unregisterStepType,
  clearStepRegistry,
} from "./registry.js";
import type { StepTypeDefinition, StepHandler } from "./types.js";

const testDef: StepTypeDefinition = {
  id: "test-step",
  label: "Test Step",
  description: "A test step for unit tests",
  category: "compute",
  parameters: [
    { name: "name", type: "string", description: "Name param", required: true },
    { name: "count", type: "number", description: "Count param", required: false, default: 1 },
  ],
  outputs: [
    { name: "result", type: "string", description: "Result output" },
  ],
  rollbackSupported: true,
  estimatedDurationMs: 5000,
};

const testHandler: StepHandler = {
  execute: async () => ({ result: "done" }),
  rollback: async () => {},
};

describe("Step Registry", () => {
  beforeEach(() => {
    clearStepRegistry();
  });

  it("registers and retrieves a step type", () => {
    registerStepType(testDef, testHandler);
    expect(getStepDefinition("test-step")).toEqual(testDef);
    expect(getStepHandler("test-step")).toEqual(testHandler);
  });

  it("returns undefined for unknown step types", () => {
    expect(getStepDefinition("unknown")).toBeUndefined();
    expect(getStepHandler("unknown")).toBeUndefined();
  });

  it("hasStepType returns correct boolean", () => {
    expect(hasStepType("test-step")).toBe(false);
    registerStepType(testDef, testHandler);
    expect(hasStepType("test-step")).toBe(true);
  });

  it("lists all registered step types", () => {
    registerStepType(testDef, testHandler);
    const networkDef = { ...testDef, id: "net-step", category: "networking" as const };
    registerStepType(networkDef, testHandler);

    const types = listStepTypes();
    expect(types).toHaveLength(2);
    expect(types.map((t) => t.id)).toContain("test-step");
    expect(types.map((t) => t.id)).toContain("net-step");
  });

  it("lists step types by category", () => {
    registerStepType(testDef, testHandler);
    const networkDef = { ...testDef, id: "net-step", category: "networking" as const };
    registerStepType(networkDef, testHandler);

    expect(listStepTypesByCategory("compute")).toHaveLength(1);
    expect(listStepTypesByCategory("networking")).toHaveLength(1);
    expect(listStepTypesByCategory("data")).toHaveLength(0);
  });

  it("unregisters a step type", () => {
    registerStepType(testDef, testHandler);
    expect(hasStepType("test-step")).toBe(true);
    unregisterStepType("test-step");
    expect(hasStepType("test-step")).toBe(false);
  });

  it("clears all registrations", () => {
    registerStepType(testDef, testHandler);
    registerStepType({ ...testDef, id: "other" }, testHandler);
    expect(listStepTypes()).toHaveLength(2);
    clearStepRegistry();
    expect(listStepTypes()).toHaveLength(0);
  });

  it("throws on duplicate step type registration", () => {
    registerStepType(testDef, testHandler);
    expect(() => registerStepType(testDef, testHandler)).toThrow(/already registered/);
  });
});
