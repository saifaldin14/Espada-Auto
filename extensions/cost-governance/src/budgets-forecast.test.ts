/**
 * Cost Governance — Budget Forecasting & Anomaly Detection Tests
 *
 * Tests budget threshold alerting combinations, cost anomaly detection
 * via forecasting, trend analysis, and the untested createCostPercentageWarnPolicy.
 */

import { describe, expect, it } from "vitest";
import {
  BudgetManager,
  getUtilization,
  linearForecast,
  getTrendDirection,
} from "./budgets.js";
import { createCostPercentageWarnPolicy, createBudgetUtilizationPolicy } from "./cost-policy.js";
import type { Budget, BudgetInput, PolicyEvaluationInput, PolicyDefinition, RuleCondition, RuleResult, ResourceInput } from "./types.js";

// ── Inlined lightweight policy evaluator (same approach as cost-policy.test) ──

function getField(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function flattenInput(input: PolicyEvaluationInput): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  if (input.cost) {
    flat.cost = input.cost;
    flat["cost.current"] = input.cost.current;
    flat["cost.projected"] = input.cost.projected;
    flat["cost.delta"] = input.cost.delta;
  }
  if (input.plan) {
    flat.plan = input.plan;
    flat["plan.totalCreates"] = input.plan.totalCreates;
    flat["plan.totalUpdates"] = input.plan.totalUpdates;
    flat["plan.totalDeletes"] = input.plan.totalDeletes;
  }
  return flat;
}

function evalCondition(cond: RuleCondition, data: Record<string, unknown>): boolean {
  switch (cond.type) {
    case "field_gt": { const v = getField(data, cond.field); return typeof v === "number" && v > cond.value; }
    case "field_lt": { const v = getField(data, cond.field); return typeof v === "number" && v < cond.value; }
    case "field_equals": return getField(data, cond.field) === cond.value;
    case "and": return cond.conditions.every((c) => evalCondition(c, data));
    case "or": return cond.conditions.some((c) => evalCondition(c, data));
    case "not": return !evalCondition(cond.condition, data);
    default: return true;
  }
}

function evaluatePolicy(policy: PolicyDefinition, input: PolicyEvaluationInput) {
  if (!policy.enabled) return { denied: false, warnings: [] as string[], notifications: [] as string[], approvalRequired: false };
  const data = flattenInput(input);
  const warnings: string[] = [], denials: string[] = [], notifications: string[] = [];
  let approvalRequired = false;
  for (const rule of policy.rules) {
    if (evalCondition(rule.condition, data)) {
      switch (rule.action) {
        case "deny": denials.push(rule.message); break;
        case "warn": warnings.push(rule.message); break;
        case "require_approval": approvalRequired = true; break;
        case "notify": notifications.push(rule.message); break;
      }
    }
  }
  return { denied: denials.length > 0, warnings, notifications, approvalRequired, denials };
}

// ── Helpers ────────────────────────────────────────────────────────

const makeBudgetInput = (overrides?: Partial<BudgetInput>): BudgetInput => ({
  name: "Test Budget",
  scope: "project",
  scopeId: "proj-1",
  monthlyLimit: 1000,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Budget threshold alerting — multi-budget scenarios
// ---------------------------------------------------------------------------
describe("BudgetManager — multi-budget threshold alerting", () => {
  it("getAllStatuses returns mixed statuses across budgets", () => {
    const mgr = new BudgetManager(null);
    const b1 = mgr.setBudget(makeBudgetInput({ name: "Low", scopeId: "p1", monthlyLimit: 1000 }));
    const b2 = mgr.setBudget(makeBudgetInput({ name: "Mid", scope: "team", scopeId: "t1", monthlyLimit: 500 }));
    const b3 = mgr.setBudget(makeBudgetInput({ name: "Over", scope: "environment", scopeId: "e1", monthlyLimit: 200 }));

    mgr.updateSpend(b1.id, 400);  // ok (40%)
    mgr.updateSpend(b2.id, 420);  // warning (84%)
    mgr.updateSpend(b3.id, 250);  // exceeded (125%)

    const statuses = mgr.getAllStatuses();
    expect(statuses).toHaveLength(3);
    const statusSet = new Set(statuses.map((s) => s.status));
    expect(statusSet.has("ok")).toBe(true);
    expect(statusSet.has("warning")).toBe(true);
    expect(statusSet.has("exceeded")).toBe(true);
  });

  it("custom thresholds trigger at correct utilization", () => {
    const mgr = new BudgetManager(null);
    const b = mgr.setBudget(makeBudgetInput({
      monthlyLimit: 1000,
      warningThreshold: 50,
      criticalThreshold: 75,
    }));

    mgr.updateSpend(b.id, 400);
    expect(mgr.getStatus(mgr.getBudget(b.id)!)).toBe("ok");

    mgr.updateSpend(b.id, 600);
    expect(mgr.getStatus(mgr.getBudget(b.id)!)).toBe("warning");

    mgr.updateSpend(b.id, 800);
    expect(mgr.getStatus(mgr.getBudget(b.id)!)).toBe("critical");

    mgr.updateSpend(b.id, 1100);
    expect(mgr.getStatus(mgr.getBudget(b.id)!)).toBe("exceeded");
  });

  it("utilization at exact boundary triggers next level", () => {
    const mgr = new BudgetManager(null);
    const b = mgr.setBudget(makeBudgetInput({ monthlyLimit: 1000, warningThreshold: 80 }));

    mgr.updateSpend(b.id, 800); // exactly 80%
    expect(mgr.getStatus(mgr.getBudget(b.id)!)).toBe("warning");
  });

  it("spending at exactly 100% triggers exceeded", () => {
    const mgr = new BudgetManager(null);
    const b = mgr.setBudget(makeBudgetInput({ monthlyLimit: 500 }));
    mgr.updateSpend(b.id, 500); // exactly 100%
    expect(mgr.getStatus(mgr.getBudget(b.id)!)).toBe("exceeded");
  });
});

// ---------------------------------------------------------------------------
// Cost anomaly detection via forecasting
// ---------------------------------------------------------------------------
describe("cost anomaly detection — linearForecast", () => {
  it("detects spending spike anomaly", () => {
    const data = [
      { date: "2024-01-01", amount: 100 },
      { date: "2024-02-01", amount: 105 },
      { date: "2024-03-01", amount: 110 },
      { date: "2024-04-01", amount: 300 }, // spike
    ];
    const forecast = linearForecast(data, 1);
    const projected = forecast[0]!.amount;
    // With the spike, projected should be notably above the last stable value
    expect(projected).toBeGreaterThan(200);
  });

  it("steady spend produces stable forecast", () => {
    const data = [
      { date: "2024-01-01", amount: 500 },
      { date: "2024-02-01", amount: 500 },
      { date: "2024-03-01", amount: 500 },
      { date: "2024-04-01", amount: 500 },
    ];
    const forecast = linearForecast(data, 3);
    for (const point of forecast) {
      expect(point.amount).toBeCloseTo(500, 0);
    }
  });

  it("rapid growth forecast exceeds budget threshold", () => {
    const data = [
      { date: "2024-01-01", amount: 200 },
      { date: "2024-02-01", amount: 400 },
      { date: "2024-03-01", amount: 600 },
    ];
    const budget = 1000;
    const forecast = linearForecast(data, 3);
    const exceedsBudget = forecast.some((p) => p.amount > budget);
    expect(exceedsBudget).toBe(true);
  });

  it("forecast dates increment monthly", () => {
    const data = [
      { date: "2024-06-01", amount: 100 },
      { date: "2024-07-01", amount: 200 },
    ];
    const forecast = linearForecast(data, 3);
    expect(forecast).toHaveLength(3);
    // linearForecast increments months from last date; month-end dates may shift
    expect(new Date(forecast[0]!.date).getMonth()).toBeGreaterThanOrEqual(6); // Jul or Aug
    expect(new Date(forecast[2]!.date).getMonth()).toBeGreaterThanOrEqual(8); // Sep or Oct
  });

  it("two data points produce valid linear projection", () => {
    const data = [
      { date: "2024-01-01", amount: 100 },
      { date: "2024-02-01", amount: 150 },
    ];
    const forecast = linearForecast(data, 1);
    expect(forecast).toHaveLength(1);
    expect(forecast[0]!.amount).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Trend direction analysis
// ---------------------------------------------------------------------------
describe("getTrendDirection — anomaly patterns", () => {
  it("large jump detects increasing", () => {
    expect(getTrendDirection(100, 200)).toBe("increasing");
  });

  it("small variation is stable", () => {
    expect(getTrendDirection(1000, 1040)).toBe("stable");
  });

  it("cost drop detects decreasing", () => {
    expect(getTrendDirection(500, 400)).toBe("decreasing");
  });

  it("5% boundary — exactly 5% is stable", () => {
    expect(getTrendDirection(100, 105)).toBe("stable");
  });

  it("just over 5% is increasing", () => {
    expect(getTrendDirection(100, 106)).toBe("increasing");
  });

  it("just under -5% is decreasing", () => {
    expect(getTrendDirection(100, 94)).toBe("decreasing");
  });
});

// ---------------------------------------------------------------------------
// createCostPercentageWarnPolicy (previously untested)
// ---------------------------------------------------------------------------
describe("createCostPercentageWarnPolicy", () => {
  const policy = createCostPercentageWarnPolicy(25);

  it("creates policy with correct metadata", () => {
    expect(policy.id).toBe("cost-percent-warn");
    expect(policy.type).toBe("cost");
    expect(policy.enabled).toBe(true);
    expect(policy.labels).toContain("cost");
    expect(policy.rules.length).toBeGreaterThan(0);
  });

  it("warns when cost increases from a positive baseline", () => {
    const input: PolicyEvaluationInput = {
      cost: { current: 100, projected: 200, delta: 100, currency: "USD" },
    };
    const result = evaluatePolicy(policy, input);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("25%");
  });

  it("does not warn when cost decreases", () => {
    const input: PolicyEvaluationInput = {
      cost: { current: 200, projected: 100, delta: -100, currency: "USD" },
    };
    const result = evaluatePolicy(policy, input);
    expect(result.warnings).toHaveLength(0);
  });

  it("does not warn when current cost is zero", () => {
    const input: PolicyEvaluationInput = {
      cost: { current: 0, projected: 50, delta: 50, currency: "USD" },
    };
    const result = evaluatePolicy(policy, input);
    expect(result.warnings).toHaveLength(0);
  });

  it("accepts custom id and severity", () => {
    const custom = createCostPercentageWarnPolicy(10, { id: "custom-pct", severity: "critical" });
    expect(custom.id).toBe("custom-pct");
    expect(custom.severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// Budget utilization policy — edge cases
// ---------------------------------------------------------------------------
describe("createBudgetUtilizationPolicy — edge cases", () => {
  it("no warning or denial well under budget", () => {
    const policy = createBudgetUtilizationPolicy(10000, 80, 100);
    const input: PolicyEvaluationInput = {
      cost: { current: 1000, projected: 2000, delta: 1000, currency: "USD" },
    };
    const result = evaluatePolicy(policy, input);
    expect(result.denied).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns at warning threshold", () => {
    const policy = createBudgetUtilizationPolicy(1000, 80, 100);
    const input: PolicyEvaluationInput = {
      cost: { current: 700, projected: 850, delta: 150, currency: "USD" },
    };
    const result = evaluatePolicy(policy, input);
    expect(result.denied).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("denies when projected exceeds full budget", () => {
    const policy = createBudgetUtilizationPolicy(1000, 80, 100);
    const input: PolicyEvaluationInput = {
      cost: { current: 800, projected: 1200, delta: 400, currency: "USD" },
    };
    const result = evaluatePolicy(policy, input);
    expect(result.denied).toBe(true);
  });

  it("tight budget with low thresholds", () => {
    const policy = createBudgetUtilizationPolicy(100, 50, 90);
    const input: PolicyEvaluationInput = {
      cost: { current: 40, projected: 55, delta: 15, currency: "USD" },
    };
    const result = evaluatePolicy(policy, input);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.denied).toBe(false);
  });
});
