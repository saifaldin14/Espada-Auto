/**
 * Tests for policy-authoring module.
 */

import { describe, it, expect } from "vitest";
import {
  buildPolicyRule,
  buildPolicyRules,
  allOf,
  anyOf,
  not,
  fieldEquals,
  fieldGt,
  fieldLt,
  fieldMatches,
  fieldIn,
  validatePolicyRule,
  validatePolicyPack,
  createPolicyPack,
  getSecurityBaselinePack,
  getCostGovernancePack,
  getAvailableTemplates,
  formatPolicyPackMarkdown,
} from "./policy-authoring.js";
import type { PolicyTemplateInput } from "./policy-authoring.js";
import type { LocalRegoRule } from "../core/opa-engine.js";

// =============================================================================
// Helpers
// =============================================================================

function makeInput(overrides: Partial<PolicyTemplateInput> = {}): PolicyTemplateInput {
  return {
    id: "test.rule",
    name: "Test Rule",
    template: "require-tags",
    severity: "medium",
    action: "warn",
    params: { tags: ["Environment"] },
    ...overrides,
  };
}

// =============================================================================
// buildPolicyRule — template builders
// =============================================================================

describe("buildPolicyRule", () => {
  it("builds require-tags rule", () => {
    const rule = buildPolicyRule(
      makeInput({
        template: "require-tags",
        params: { tags: ["Environment", "Owner"] },
      }),
    );
    expect(rule.id).toBe("test.rule");
    expect(rule.severity).toBe("medium");
    expect(rule.action).toBe("warn");
    expect(rule.condition).toBeDefined();
    expect(rule.message).toContain("tag");
  });

  it("builds require-encryption rule", () => {
    const rule = buildPolicyRule(
      makeInput({
        template: "require-encryption",
        params: {},
      }),
    );
    expect(rule.id).toBe("test.rule");
    expect(rule.condition).toBeDefined();
    expect(rule.message.toLowerCase()).toContain("encrypt");
  });

  it("builds restrict-regions rule", () => {
    const rule = buildPolicyRule(
      makeInput({
        template: "restrict-regions",
        params: { allowedRegions: ["us-east-1", "eu-west-1"] },
      }),
    );
    expect(rule.condition).toBeDefined();
    expect(rule.message.toLowerCase()).toContain("region");
  });

  it("builds cost-limit rule", () => {
    const rule = buildPolicyRule(
      makeInput({
        template: "cost-limit",
        severity: "high",
        action: "deny",
        params: { maxMonthlyCost: 1000 },
      }),
    );
    expect(rule.severity).toBe("high");
    expect(rule.action).toBe("deny");
    expect(rule.condition).toBeDefined();
  });

  it("builds restrict-resource-types rule", () => {
    const rule = buildPolicyRule(
      makeInput({
        template: "restrict-resource-types",
        params: { blockedTypes: ["gpu-instance", "bare-metal"] },
      }),
    );
    expect(rule.condition).toBeDefined();
  });

  it("builds restrict-providers rule", () => {
    const rule = buildPolicyRule(
      makeInput({
        template: "restrict-providers",
        params: { allowedProviders: ["aws", "azure"] },
      }),
    );
    expect(rule.condition).toBeDefined();
  });

  it("builds require-approval-for-action rule", () => {
    const rule = buildPolicyRule(
      makeInput({
        template: "require-approval-for-action",
        action: "require_approval",
        params: { actions: ["delete", "destroy"] },
      }),
    );
    expect(rule.action).toBe("require_approval");
    expect(rule.condition).toBeDefined();
  });

  it("builds naming-convention rule", () => {
    const rule = buildPolicyRule(
      makeInput({
        template: "naming-convention",
        params: { pattern: "^[a-z][a-z0-9-]+$" },
      }),
    );
    expect(rule.condition).toBeDefined();
  });

  it("builds restrict-initiator rule", () => {
    const rule = buildPolicyRule(
      makeInput({
        template: "restrict-initiator",
        params: { blockedInitiators: ["root", "admin"] },
      }),
    );
    expect(rule.condition).toBeDefined();
  });

  it("builds custom rule with user-provided condition", () => {
    const condition = fieldEquals("status", "running");
    const rule = buildPolicyRule(
      makeInput({
        template: "custom",
        params: { condition, message: "Custom check" },
      }),
    );
    expect(rule.condition).toEqual(condition);
  });

  it("uses custom package when provided", () => {
    const rule = buildPolicyRule(
      makeInput({ package: "espada.policy.custom" }),
    );
    expect(rule.package).toBe("espada.policy.custom");
  });

  it("throws on missing required template params", () => {
    expect(() =>
      buildPolicyRule(makeInput({ template: "require-tags", params: {} })),
    ).toThrow();
  });

  it("throws on empty required tags array", () => {
    expect(() =>
      buildPolicyRule(makeInput({ template: "require-tags", params: { tags: [] } })),
    ).toThrow();
  });

  it("throws on missing allowedRegions", () => {
    expect(() =>
      buildPolicyRule(makeInput({ template: "restrict-regions", params: {} })),
    ).toThrow();
  });
});

// =============================================================================
// buildPolicyRules (batch)
// =============================================================================

describe("buildPolicyRules", () => {
  it("builds multiple rules at once", () => {
    const rules = buildPolicyRules([
      makeInput({ id: "r1", template: "require-tags", params: { tags: ["Env"] } }),
      makeInput({ id: "r2", template: "cost-limit", params: { maxMonthlyCost: 500 } }),
    ]);
    expect(rules).toHaveLength(2);
    expect(rules[0]!.id).toBe("r1");
    expect(rules[1]!.id).toBe("r2");
  });

  it("returns empty array for empty input", () => {
    expect(buildPolicyRules([])).toEqual([]);
  });
});

// =============================================================================
// Combinators
// =============================================================================

describe("condition combinators", () => {
  it("fieldEquals creates field_equals condition", () => {
    const cond = fieldEquals("provider", "aws");
    expect(cond).toEqual({ type: "field_equals", field: "provider", value: "aws" });
  });

  it("fieldGt creates field_gt condition", () => {
    const cond = fieldGt("costMonthly", 100);
    expect(cond).toEqual({ type: "field_gt", field: "costMonthly", value: 100 });
  });

  it("fieldLt creates field_lt condition", () => {
    const cond = fieldLt("costMonthly", 50);
    expect(cond).toEqual({ type: "field_lt", field: "costMonthly", value: 50 });
  });

  it("fieldMatches creates field_matches condition", () => {
    const cond = fieldMatches("name", "^prod-.*");
    expect(cond).toEqual({ type: "field_matches", field: "name", pattern: "^prod-.*" });
  });

  it("fieldIn creates field_in condition", () => {
    const cond = fieldIn("region", ["us-east-1", "us-west-2"]);
    expect(cond).toEqual({ type: "field_in", field: "region", values: ["us-east-1", "us-west-2"] });
  });

  it("allOf creates AND condition", () => {
    const c1 = fieldEquals("provider", "aws");
    const c2 = fieldGt("costMonthly", 100);
    const combined = allOf(c1, c2);
    expect(combined.type).toBe("and");
    if (combined.type === "and") {
      expect(combined.conditions).toHaveLength(2);
    }
  });

  it("anyOf creates OR condition", () => {
    const c1 = fieldEquals("provider", "aws");
    const c2 = fieldEquals("provider", "azure");
    const combined = anyOf(c1, c2);
    expect(combined.type).toBe("or");
    if (combined.type === "or") {
      expect(combined.conditions).toHaveLength(2);
    }
  });

  it("not creates NOT condition", () => {
    const inner = fieldEquals("status", "running");
    const negated = not(inner);
    expect(negated.type).toBe("not");
    if (negated.type === "not") {
      expect(negated.condition).toEqual(inner);
    }
  });

  it("combinators can be nested", () => {
    const complex = allOf(
      anyOf(fieldEquals("provider", "aws"), fieldEquals("provider", "gcp")),
      not(fieldLt("costMonthly", 10)),
    );
    expect(complex.type).toBe("and");
  });
});

// =============================================================================
// Validation
// =============================================================================

describe("validatePolicyRule", () => {
  it("validates a well-formed rule", () => {
    const rule = buildPolicyRule(makeInput());
    const result = validatePolicyRule(rule);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports error for empty rule ID", () => {
    const rule = buildPolicyRule(makeInput());
    rule.id = "";
    const result = validatePolicyRule(rule);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("ID"))).toBe(true);
  });

  it("reports error for empty message", () => {
    const rule = buildPolicyRule(makeInput());
    rule.message = "";
    const result = validatePolicyRule(rule);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("message"))).toBe(true);
  });

  it("warns when package does not start with espada.", () => {
    const rule = buildPolicyRule(makeInput());
    rule.package = "custom.rules";
    const result = validatePolicyRule(rule);
    expect(result.warnings.some((w) => w.includes("espada."))).toBe(true);
  });
});

describe("validatePolicyPack", () => {
  it("validates a well-formed pack", () => {
    const pack = getSecurityBaselinePack();
    const result = validatePolicyPack(pack);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports error for missing pack name", () => {
    const pack = createPolicyPack("", "desc", [buildPolicyRule(makeInput())]);
    const result = validatePolicyPack(pack);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("reports error for duplicate rule IDs", () => {
    const rule1 = buildPolicyRule(makeInput({ id: "dup.1" }));
    const rule2 = buildPolicyRule(makeInput({ id: "dup.1" }));
    const pack = createPolicyPack("test", "desc", [rule1, rule2]);
    const result = validatePolicyPack(pack);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate"))).toBe(true);
  });

  it("warns on empty rules", () => {
    const pack = createPolicyPack("test", "desc", []);
    const result = validatePolicyPack(pack);
    expect(result.warnings.some((w) => w.includes("no rules"))).toBe(true);
  });
});

// =============================================================================
// Policy Pack Management
// =============================================================================

describe("createPolicyPack", () => {
  it("creates a pack with provided fields", () => {
    const rules = [buildPolicyRule(makeInput())];
    const pack = createPolicyPack("my-pack", "A pack", rules, ["tag1"]);
    expect(pack.name).toBe("my-pack");
    expect(pack.description).toBe("A pack");
    expect(pack.version).toBe("1.0.0");
    expect(pack.rules).toHaveLength(1);
    expect(pack.tags).toEqual(["tag1"]);
    expect(pack.createdAt).toBeDefined();
  });
});

// =============================================================================
// Built-in Packs
// =============================================================================

describe("built-in packs", () => {
  it("getSecurityBaselinePack returns a valid pack", () => {
    const pack = getSecurityBaselinePack();
    expect(pack.name).toBe("security-baseline");
    expect(pack.rules.length).toBeGreaterThanOrEqual(3);
    expect(pack.tags).toContain("security");
    const result = validatePolicyPack(pack);
    expect(result.valid).toBe(true);
  });

  it("getCostGovernancePack returns a valid pack", () => {
    const pack = getCostGovernancePack();
    expect(pack.name).toBe("cost-governance");
    expect(pack.rules.length).toBeGreaterThanOrEqual(2);
    expect(pack.tags).toContain("cost");
    const result = validatePolicyPack(pack);
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// getAvailableTemplates
// =============================================================================

describe("getAvailableTemplates", () => {
  it("returns all 10 templates", () => {
    const templates = getAvailableTemplates();
    expect(templates).toHaveLength(10);
    const names = templates.map((t) => t.template);
    expect(names).toContain("require-tags");
    expect(names).toContain("require-encryption");
    expect(names).toContain("restrict-regions");
    expect(names).toContain("cost-limit");
    expect(names).toContain("restrict-resource-types");
    expect(names).toContain("restrict-providers");
    expect(names).toContain("require-approval-for-action");
    expect(names).toContain("naming-convention");
    expect(names).toContain("restrict-initiator");
    expect(names).toContain("custom");
  });

  it("each template has description and requiredParams", () => {
    for (const t of getAvailableTemplates()) {
      expect(typeof t.description).toBe("string");
      expect(Array.isArray(t.requiredParams)).toBe(true);
    }
  });
});

// =============================================================================
// Markdown formatting
// =============================================================================

describe("formatPolicyPackMarkdown", () => {
  it("renders pack as markdown", () => {
    const pack = getSecurityBaselinePack();
    const md = formatPolicyPackMarkdown(pack);
    expect(md).toContain("# Policy Pack: security-baseline");
    expect(md).toContain("## Rules");
    expect(md).toContain("| ID |");
    // Should include rule detail sections
    for (const rule of pack.rules) {
      expect(md).toContain(`### ${rule.id}`);
    }
  });
});
