/**
 * Cost Policy — Tests
 */

import { describe, it, expect } from "vitest";
import {
  createCostDeltaPolicy,
  createHighCostApprovalPolicy,
  createDestructiveHighCostPolicy,
  createNewResourceNotifyPolicy,
  createBudgetUtilizationPolicy,
  getDefaultCostPolicies,
} from "./cost-policy.js";
import type {
  PolicyDefinition,
  PolicyEvaluationInput,
  PolicyEvaluationResult,
  AggregatedPolicyResult,
  RuleCondition,
  RuleResult,
  ResourceInput,
} from "./types.js";

// ── Inlined PolicyEvaluationEngine (avoid cross-extension rootDir import) ───

function getField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function flattenInput(input: PolicyEvaluationInput): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  if (input.resource) {
    flat.resource = input.resource;
    flat["resource.id"] = input.resource.id;
    flat["resource.type"] = input.resource.type;
    flat["resource.provider"] = input.resource.provider;
    flat["resource.region"] = input.resource.region;
    flat["resource.name"] = input.resource.name;
    flat["resource.status"] = input.resource.status;
    flat["resource.tags"] = input.resource.tags;
    flat["resource.metadata"] = input.resource.metadata;
    for (const [k, v] of Object.entries(input.resource.tags)) flat[`resource.tags.${k}`] = v;
    for (const [k, v] of Object.entries(input.resource.metadata)) flat[`resource.metadata.${k}`] = v;
  }
  if (input.plan) {
    flat.plan = input.plan;
    flat["plan.totalCreates"] = input.plan.totalCreates;
    flat["plan.totalUpdates"] = input.plan.totalUpdates;
    flat["plan.totalDeletes"] = input.plan.totalDeletes;
  }
  if (input.actor) { flat.actor = input.actor; flat["actor.id"] = input.actor.id; flat["actor.roles"] = input.actor.roles; }
  if (input.environment) flat.environment = input.environment;
  if (input.cost) {
    flat.cost = input.cost;
    flat["cost.current"] = input.cost.current;
    flat["cost.projected"] = input.cost.projected;
    flat["cost.delta"] = input.cost.delta;
  }
  if (input.graph) { flat.graph = input.graph; flat["graph.blastRadius"] = input.graph.blastRadius; flat["graph.dependencyDepth"] = input.graph.dependencyDepth; }
  return flat;
}

function evaluateCondition(condition: RuleCondition, data: Record<string, unknown>, resource?: ResourceInput): boolean {
  switch (condition.type) {
    case "field_equals": return getField(data, condition.field) === condition.value;
    case "field_not_equals": return getField(data, condition.field) !== condition.value;
    case "field_contains": { const v = getField(data, condition.field); return typeof v === "string" ? v.includes(condition.value) : Array.isArray(v) ? v.includes(condition.value) : false; }
    case "field_matches": { const v = getField(data, condition.field); return typeof v === "string" && new RegExp(condition.pattern).test(v); }
    case "field_gt": { const v = getField(data, condition.field); return typeof v === "number" && v > condition.value; }
    case "field_lt": { const v = getField(data, condition.field); return typeof v === "number" && v < condition.value; }
    case "field_exists": return getField(data, condition.field) !== undefined;
    case "field_not_exists": return getField(data, condition.field) === undefined;
    case "field_in": return condition.values.includes(getField(data, condition.field));
    case "field_not_in": return !condition.values.includes(getField(data, condition.field));
    case "tag_missing": return !resource?.tags || !(condition.tag in resource.tags);
    case "tag_equals": return resource?.tags?.[condition.tag] === condition.value;
    case "and": return condition.conditions.every((c) => evaluateCondition(c, data, resource));
    case "or": return condition.conditions.some((c) => evaluateCondition(c, data, resource));
    case "not": return !evaluateCondition(condition.condition, data, resource);
    case "resource_type": return resource?.type === condition.resourceType;
    case "provider": return resource?.provider === condition.provider;
    case "region": return resource?.region === condition.region;
    case "custom": return true;
  }
}

class PolicyEvaluationEngine {
  evaluate(policy: PolicyDefinition, input: PolicyEvaluationInput): PolicyEvaluationResult {
    const startTime = Date.now();
    if (!policy.enabled) {
      return { policyId: policy.id, policyName: policy.name, allowed: true, denied: false, warnings: [], denials: [], approvalRequired: false, notifications: [], evaluatedRules: [], evaluatedAt: new Date().toISOString(), durationMs: Date.now() - startTime };
    }
    const data = flattenInput(input);
    const warnings: string[] = [], denials: string[] = [], notifications: string[] = [];
    let approvalRequired = false;
    const ruleResults: RuleResult[] = [];
    for (const rule of policy.rules) {
      const triggered = evaluateCondition(rule.condition, data, input.resource);
      if (triggered) {
        ruleResults.push({ ruleId: rule.id, description: rule.description, passed: false, action: rule.action as RuleResult["action"], message: rule.message });
        switch (rule.action) { case "deny": denials.push(rule.message); break; case "warn": warnings.push(rule.message); break; case "require_approval": approvalRequired = true; warnings.push(`Approval required: ${rule.message}`); break; case "notify": notifications.push(rule.message); break; }
      } else {
        ruleResults.push({ ruleId: rule.id, description: rule.description, passed: true, action: rule.action as RuleResult["action"], message: rule.message });
      }
    }
    return { policyId: policy.id, policyName: policy.name, allowed: denials.length === 0, denied: denials.length > 0, warnings, denials, approvalRequired, notifications, evaluatedRules: ruleResults, evaluatedAt: new Date().toISOString(), durationMs: Date.now() - startTime };
  }

  evaluateAll(policies: PolicyDefinition[], input: PolicyEvaluationInput): AggregatedPolicyResult {
    const startTime = Date.now();
    const results: PolicyEvaluationResult[] = [], allWarnings: string[] = [], allDenials: string[] = [], allNotifications: string[] = [];
    let anyApprovalRequired = false, passedCount = 0, failedCount = 0;
    for (const policy of policies) {
      const result = this.evaluate(policy, input);
      results.push(result);
      allWarnings.push(...result.warnings); allDenials.push(...result.denials); allNotifications.push(...result.notifications);
      if (result.approvalRequired) anyApprovalRequired = true;
      if (result.denied) failedCount++; else passedCount++;
    }
    return { allowed: allDenials.length === 0, denied: allDenials.length > 0, warnings: allWarnings, denials: allDenials, approvalRequired: anyApprovalRequired, notifications: allNotifications, results, totalPolicies: policies.length, passedPolicies: passedCount, failedPolicies: failedCount, evaluatedAt: new Date().toISOString(), totalDurationMs: Date.now() - startTime };
  }
}

const engine = new PolicyEvaluationEngine();

// ── Cost Delta Policy ────────────────────────────────────────────

describe("createCostDeltaPolicy", () => {
  const policy = createCostDeltaPolicy(500);

  it("allows changes below threshold", () => {
    const input: PolicyEvaluationInput = {
      cost: { current: 100, projected: 400, delta: 300, currency: "USD" },
    };
    const result = engine.evaluate(policy, input);
    expect(result.denied).toBe(false);
    expect(result.allowed).toBe(true);
  });

  it("denies changes above threshold", () => {
    const input: PolicyEvaluationInput = {
      cost: { current: 100, projected: 700, delta: 600, currency: "USD" },
    };
    const result = engine.evaluate(policy, input);
    expect(result.denied).toBe(true);
    expect(result.denials).toHaveLength(1);
    expect(result.denials[0]).toContain("$500");
  });

  it("allows change at exactly threshold", () => {
    const input: PolicyEvaluationInput = {
      cost: { current: 100, projected: 600, delta: 500, currency: "USD" },
    };
    const result = engine.evaluate(policy, input);
    expect(result.denied).toBe(false);
  });
});

// ── High Cost Approval Policy ────────────────────────────────────

describe("createHighCostApprovalPolicy", () => {
  const policy = createHighCostApprovalPolicy(200);

  it("does not require approval below threshold", () => {
    const input: PolicyEvaluationInput = {
      cost: { current: 50, projected: 100, delta: 50, currency: "USD" },
    };
    const result = engine.evaluate(policy, input);
    expect(result.approvalRequired).toBe(false);
  });

  it("requires approval above threshold", () => {
    const input: PolicyEvaluationInput = {
      cost: { current: 100, projected: 300, delta: 200, currency: "USD" },
    };
    const result = engine.evaluate(policy, input);
    expect(result.approvalRequired).toBe(true);
  });
});

// ── Destructive High Cost Policy ─────────────────────────────────

describe("createDestructiveHighCostPolicy", () => {
  const policy = createDestructiveHighCostPolicy(1000);

  it("allows deletes on low-cost resources", () => {
    const input: PolicyEvaluationInput = {
      plan: { totalCreates: 0, totalUpdates: 0, totalDeletes: 1 },
      cost: { current: 50, projected: 0, delta: -50, currency: "USD" },
    };
    const result = engine.evaluate(policy, input);
    expect(result.denied).toBe(false);
  });

  it("denies deletes on high-cost resources", () => {
    const input: PolicyEvaluationInput = {
      plan: { totalCreates: 0, totalUpdates: 0, totalDeletes: 2 },
      cost: { current: 1500, projected: 0, delta: -1500, currency: "USD" },
    };
    const result = engine.evaluate(policy, input);
    expect(result.denied).toBe(true);
  });

  it("allows non-destructive changes on high-cost resources", () => {
    const input: PolicyEvaluationInput = {
      plan: { totalCreates: 0, totalUpdates: 1, totalDeletes: 0 },
      cost: { current: 2000, projected: 2100, delta: 100, currency: "USD" },
    };
    const result = engine.evaluate(policy, input);
    expect(result.denied).toBe(false);
  });
});

// ── New Resource Notify Policy ───────────────────────────────────

describe("createNewResourceNotifyPolicy", () => {
  const policy = createNewResourceNotifyPolicy();

  it("sends notification when resources are created", () => {
    const input: PolicyEvaluationInput = {
      plan: { totalCreates: 3, totalUpdates: 0, totalDeletes: 0 },
    };
    const result = engine.evaluate(policy, input);
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]).toContain("New infrastructure");
  });

  it("does not notify when no creates", () => {
    const input: PolicyEvaluationInput = {
      plan: { totalCreates: 0, totalUpdates: 1, totalDeletes: 0 },
    };
    const result = engine.evaluate(policy, input);
    expect(result.notifications).toHaveLength(0);
  });
});

// ── Budget Utilization Policy ────────────────────────────────────

describe("createBudgetUtilizationPolicy", () => {
  const policy = createBudgetUtilizationPolicy(10000, 80, 100);

  it("allows changes well within budget", () => {
    const input: PolicyEvaluationInput = {
      cost: { current: 3000, projected: 5000, delta: 2000, currency: "USD" },
    };
    const result = engine.evaluate(policy, input);
    expect(result.denied).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns when approaching budget limit", () => {
    const input: PolicyEvaluationInput = {
      cost: { current: 7000, projected: 9000, delta: 2000, currency: "USD" },
    };
    const result = engine.evaluate(policy, input);
    expect(result.denied).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("denies when exceeding budget", () => {
    const input: PolicyEvaluationInput = {
      cost: { current: 8000, projected: 11000, delta: 3000, currency: "USD" },
    };
    const result = engine.evaluate(policy, input);
    expect(result.denied).toBe(true);
  });
});

// ── Default Policies ─────────────────────────────────────────────

describe("getDefaultCostPolicies", () => {
  it("returns 5 default policies", () => {
    const policies = getDefaultCostPolicies();
    expect(policies).toHaveLength(5);
    expect(policies.every((p) => p.type === "cost")).toBe(true);
    expect(policies.every((p) => p.enabled)).toBe(true);
  });

  it("all have valid structure", () => {
    const policies = getDefaultCostPolicies();
    for (const p of policies) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.rules.length).toBeGreaterThan(0);
      expect(p.labels).toContain("cost");
    }
  });

  it("can be evaluated by the engine without errors", () => {
    const policies = getDefaultCostPolicies();
    const input: PolicyEvaluationInput = {
      plan: { totalCreates: 1, totalUpdates: 0, totalDeletes: 0 },
      cost: { current: 100, projected: 150, delta: 50, currency: "USD" },
    };
    const result = engine.evaluateAll(policies, input);
    expect(result.totalPolicies).toBe(5);
    expect(typeof result.allowed).toBe("boolean");
  });
});
