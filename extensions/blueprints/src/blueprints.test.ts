/**
 * Blueprint tests — engine, library, validation, rendering.
 */

import { describe, expect, it } from "vitest";
import {
  validateParameters,
  validateParameterValue,
  resolveParameters,
  renderTemplate,
  renderResources,
  render,
  preview,
  InstanceStore,
} from "../src/engine.js";
import {
  builtInBlueprints,
  getBlueprintById,
  filterBlueprints,
} from "../src/library.js";
import type { Blueprint, BlueprintParameter} from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeBlueprint = (overrides?: Partial<Blueprint>): Blueprint => ({
  id: "test-bp",
  name: "Test Blueprint",
  description: "A test",
  version: "1.0.0",
  category: "web-app",
  providers: ["aws"],
  parameters: [
    { id: "name", name: "Name", type: "string", required: true, validation: { minLength: 3 } },
    { id: "count", name: "Count", type: "number", required: false, default: 2, validation: { min: 1, max: 10 } },
    { id: "enable_ssl", name: "SSL", type: "boolean", required: false, default: true },
    { id: "tier", name: "Tier", type: "select", required: true, options: ["free", "pro", "enterprise"] },
  ],
  resources: [
    { type: "aws_instance", name: "${{ inputs.name }}-web", provider: "aws", config: { instance_type: "t3.micro" } },
  ],
  dependencies: [],
  policies: [],
  estimatedCostRange: [10, 50],
  tags: ["test"],
  ...overrides,
});

// ---------------------------------------------------------------------------
// validateParameters
// ---------------------------------------------------------------------------
describe("validateParameters", () => {
  it("passes with valid params", () => {
    const bp = makeBlueprint();
    const errors = validateParameters(bp, { name: "myapp", tier: "pro" });
    expect(errors).toHaveLength(0);
  });

  it("fails on missing required param", () => {
    const bp = makeBlueprint();
    const errors = validateParameters(bp, { tier: "pro" });
    expect(errors.some((e) => e.parameterId === "name")).toBe(true);
  });

  it("fails on unknown param", () => {
    const bp = makeBlueprint();
    const errors = validateParameters(bp, { name: "app", tier: "pro", unknown: "x" });
    expect(errors.some((e) => e.parameterId === "unknown")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateParameterValue
// ---------------------------------------------------------------------------
describe("validateParameterValue", () => {
  it("validates string minLength", () => {
    const param: BlueprintParameter = { id: "x", name: "X", type: "string", required: true, validation: { minLength: 5 } };
    const errors = validateParameterValue(param, "ab");
    expect(errors).toHaveLength(1);
  });

  it("validates string maxLength", () => {
    const param: BlueprintParameter = { id: "x", name: "X", type: "string", required: true, validation: { maxLength: 3 } };
    const errors = validateParameterValue(param, "abcdef");
    expect(errors).toHaveLength(1);
  });

  it("validates string pattern", () => {
    const param: BlueprintParameter = { id: "x", name: "X", type: "string", required: true, validation: { pattern: "^[a-z]+$" } };
    expect(validateParameterValue(param, "abc")).toHaveLength(0);
    expect(validateParameterValue(param, "ABC")).toHaveLength(1);
  });

  it("validates number min/max", () => {
    const param: BlueprintParameter = { id: "x", name: "X", type: "number", required: true, validation: { min: 1, max: 10 } };
    expect(validateParameterValue(param, 5)).toHaveLength(0);
    expect(validateParameterValue(param, 0)).toHaveLength(1);
    expect(validateParameterValue(param, 11)).toHaveLength(1);
  });

  it("validates boolean type", () => {
    const param: BlueprintParameter = { id: "x", name: "X", type: "boolean", required: true };
    expect(validateParameterValue(param, true)).toHaveLength(0);
    expect(validateParameterValue(param, "yes")).toHaveLength(1);
  });

  it("validates select options", () => {
    const param: BlueprintParameter = { id: "x", name: "X", type: "select", required: true, options: ["a", "b"] };
    expect(validateParameterValue(param, "a")).toHaveLength(0);
    expect(validateParameterValue(param, "c")).toHaveLength(1);
  });

  it("rejects wrong type for number", () => {
    const param: BlueprintParameter = { id: "x", name: "X", type: "number", required: true };
    expect(validateParameterValue(param, "not-a-number")).toHaveLength(1);
  });

  it("rejects wrong type for string", () => {
    const param: BlueprintParameter = { id: "x", name: "X", type: "string", required: true };
    expect(validateParameterValue(param, 42)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resolveParameters
// ---------------------------------------------------------------------------
describe("resolveParameters", () => {
  it("fills defaults for missing optional params", () => {
    const bp = makeBlueprint();
    const resolved = resolveParameters(bp, { name: "myapp", tier: "pro" });
    expect(resolved.name).toBe("myapp");
    expect(resolved.count).toBe(2);
    expect(resolved.enable_ssl).toBe(true);
  });

  it("overrides defaults with provided values", () => {
    const bp = makeBlueprint();
    const resolved = resolveParameters(bp, { name: "myapp", tier: "pro", count: 5 });
    expect(resolved.count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------
describe("renderTemplate", () => {
  it("replaces inputs placeholders", () => {
    expect(renderTemplate("${{ inputs.name }}-web", { name: "myapp" })).toBe("myapp-web");
  });

  it("handles multiple replacements", () => {
    const result = renderTemplate("${{ inputs.a }}-${{ inputs.b }}", { a: "x", b: "y" });
    expect(result).toBe("x-y");
  });

  it("replaces missing keys with empty string", () => {
    expect(renderTemplate("${{ inputs.missing }}-ok", {})).toBe("-ok");
  });

  it("handles whitespace in template expression", () => {
    expect(renderTemplate("${{inputs.name}}", { name: "test" })).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// renderResources
// ---------------------------------------------------------------------------
describe("renderResources", () => {
  it("renders resource names and config", () => {
    const resources = [
      { type: "aws_instance", name: "${{ inputs.name }}-web", provider: "aws" as const, config: { ami: "${{ inputs.ami }}" } },
    ];
    const rendered = renderResources(resources, { name: "app", ami: "ami-123" });
    expect(rendered[0]!.name).toBe("app-web");
    expect(rendered[0]!.config.ami).toBe("ami-123");
  });
});

// ---------------------------------------------------------------------------
// render (full)
// ---------------------------------------------------------------------------
describe("render", () => {
  it("generates HCL files grouped by provider", () => {
    const bp = makeBlueprint();
    const result = render(bp, { name: "myapp", tier: "pro" });
    expect(result.files.has("aws-resources.tf")).toBe(true);
    const hcl = result.files.get("aws-resources.tf")!;
    expect(hcl).toContain("myapp-web");
    expect(hcl).toContain("aws_instance");
  });

  it("creates separate files for multiple providers", () => {
    const bp = makeBlueprint({
      providers: ["aws", "gcp"],
      resources: [
        { type: "aws_s3_bucket", name: "bucket", provider: "aws", config: {} },
        { type: "google_storage_bucket", name: "bucket", provider: "gcp", config: {} },
      ],
    });
    const result = render(bp, { name: "x", tier: "pro" });
    expect(result.files.size).toBe(2);
    expect(result.files.has("aws-resources.tf")).toBe(true);
    expect(result.files.has("gcp-resources.tf")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------
describe("preview", () => {
  it("returns validation errors for bad params", () => {
    const bp = makeBlueprint();
    const result = preview(bp, { tier: "pro" }); // missing required 'name'
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it("returns resources and cost range", () => {
    const bp = makeBlueprint();
    const result = preview(bp, { name: "myapp", tier: "pro" });
    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.estimatedCostRange).toEqual([10, 50]);
  });
});

// ---------------------------------------------------------------------------
// InstanceStore
// ---------------------------------------------------------------------------
describe("InstanceStore", () => {
  it("creates and retrieves instances", () => {
    const store = new InstanceStore();
    const bp = makeBlueprint();
    const inst = store.create(bp, "my-deploy", { name: "app" });
    expect(inst.status).toBe("deploying");
    expect(store.get(inst.id)).toEqual(inst);
  });

  it("lists all instances", () => {
    const store = new InstanceStore();
    const bp = makeBlueprint();
    store.create(bp, "a", {});
    store.create(bp, "b", {});
    expect(store.list()).toHaveLength(2);
  });

  it("updates status", () => {
    const store = new InstanceStore();
    const bp = makeBlueprint();
    const inst = store.create(bp, "x", {});
    store.updateStatus(inst.id, "active");
    expect(store.get(inst.id)!.status).toBe("active");
  });

  it("returns null for missing instance", () => {
    const store = new InstanceStore();
    expect(store.get("nope")).toBeNull();
    expect(store.updateStatus("nope", "active")).toBeNull();
  });

  it("deletes instances", () => {
    const store = new InstanceStore();
    const bp = makeBlueprint();
    const inst = store.create(bp, "x", {});
    expect(store.delete(inst.id)).toBe(true);
    expect(store.get(inst.id)).toBeNull();
    expect(store.delete("nope")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
describe("builtInBlueprints", () => {
  it("has 15 blueprints (5 archetypes × 3 providers)", () => {
    expect(builtInBlueprints).toHaveLength(15);
  });

  it("covers all categories", () => {
    const categories = new Set(builtInBlueprints.map((b) => b.category));
    expect(categories).toContain("web-app");
    expect(categories).toContain("serverless");
    expect(categories).toContain("container");
    expect(categories).toContain("static-site");
    expect(categories).toContain("data");
  });
});

describe("getBlueprintById", () => {
  it("finds existing blueprint", () => {
    const bp = getBlueprintById("three-tier-web-app-aws");
    expect(bp).not.toBeNull();
    expect(bp!.category).toBe("web-app");
  });

  it("returns null for unknown ID", () => {
    expect(getBlueprintById("nonexistent")).toBeNull();
  });
});

describe("filterBlueprints", () => {
  it("filters by category", () => {
    const results = filterBlueprints(builtInBlueprints, { category: "serverless" });
    expect(results).toHaveLength(3);
    expect(results.every((b) => b.category === "serverless")).toBe(true);
  });

  it("filters by provider", () => {
    const results = filterBlueprints(builtInBlueprints, { provider: "azure" });
    expect(results).toHaveLength(5);
  });

  it("filters by tag", () => {
    const results = filterBlueprints(builtInBlueprints, { tag: "kubernetes" });
    expect(results).toHaveLength(3);
  });

  it("combines filters", () => {
    const results = filterBlueprints(builtInBlueprints, {
      category: "container",
      provider: "gcp",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("container-cluster-gcp");
  });

  it("returns empty for no match", () => {
    const results = filterBlueprints(builtInBlueprints, { category: "custom" });
    expect(results).toHaveLength(0);
  });
});
