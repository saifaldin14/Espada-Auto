/**
 * Cost governance tests — budgets, infracost parsing, forecasting.
 */

import { describe, expect, it } from "vitest";
import {
  BudgetManager,
  getUtilization,
  linearForecast,
  getTrendDirection,
} from "../src/budgets.js";
import { parseBreakdownJson, parseDiffJson } from "../src/infracost.js";
import type { Budget, BudgetInput } from "../src/types.js";

// ---------------------------------------------------------------------------
// parseBreakdownJson
// ---------------------------------------------------------------------------
describe("parseBreakdownJson", () => {
  it("parses empty projects", () => {
    const raw = JSON.stringify({ totalMonthlyCost: "0", totalHourlyCost: "0", projects: [] });
    const result = parseBreakdownJson(raw);
    expect(result.totalMonthlyCost).toBe(0);
    expect(result.totalHourlyCost).toBe(0);
    expect(result.resources).toHaveLength(0);
    expect(result.currency).toBe("USD");
  });

  it("parses a single resource", () => {
    const raw = JSON.stringify({
      totalMonthlyCost: "52.56",
      totalHourlyCost: "0.072",
      currency: "USD",
      projects: [
        {
          breakdown: {
            resources: [
              {
                name: "aws_instance.web",
                resourceType: "aws_instance",
                monthlyCost: "52.56",
                hourlyCost: "0.072",
                subresources: [
                  { name: "compute", monthlyCost: "40.00", hourlyCost: "0.055" },
                  { name: "ebs", monthlyCost: "12.56", hourlyCost: "0.017" },
                ],
              },
            ],
          },
        },
      ],
    });
    const result = parseBreakdownJson(raw);
    expect(result.totalMonthlyCost).toBe(52.56);
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]!.name).toBe("aws_instance.web");
    expect(result.resources[0]!.provider).toBe("aws");
    expect(result.resources[0]!.subResources).toHaveLength(2);
    expect(result.resources[0]!.subResources![0]!.monthlyCost).toBe(40);
  });

  it("handles multiple projects", () => {
    const raw = JSON.stringify({
      totalMonthlyCost: "100",
      totalHourlyCost: "0.137",
      projects: [
        {
          breakdown: {
            resources: [
              { name: "a.one", resourceType: "aws_s3_bucket", monthlyCost: "30", hourlyCost: "0.04" },
            ],
          },
        },
        {
          breakdown: {
            resources: [
              { name: "b.two", resourceType: "google_storage_bucket", monthlyCost: "70", hourlyCost: "0.097" },
            ],
          },
        },
      ],
    });
    const result = parseBreakdownJson(raw);
    expect(result.resources).toHaveLength(2);
    expect(result.resources[1]!.provider).toBe("google");
  });

  it("handles missing subresources", () => {
    const raw = JSON.stringify({
      totalMonthlyCost: "10",
      totalHourlyCost: "0.01",
      projects: [
        {
          breakdown: {
            resources: [
              { name: "azure_vm.test", resourceType: "azurerm_virtual_machine", monthlyCost: "10", hourlyCost: "0.01" },
            ],
          },
        },
      ],
    });
    const result = parseBreakdownJson(raw);
    expect(result.resources[0]!.subResources).toHaveLength(0);
    expect(result.resources[0]!.provider).toBe("azurerm");
  });
});

// ---------------------------------------------------------------------------
// parseDiffJson
// ---------------------------------------------------------------------------
describe("parseDiffJson", () => {
  it("parses empty diff", () => {
    const raw = JSON.stringify({
      totalMonthlyCost: "50",
      totalHourlyCost: "0.068",
      projects: [],
      diffTotalMonthlyCost: "10",
    });
    const result = parseDiffJson(raw);
    expect(result.projectedMonthlyCost).toBe(50);
    expect(result.deltaMonthlyCost).toBe(10);
    expect(result.resourceChanges).toHaveLength(0);
  });

  it("parses resource changes", () => {
    const raw = JSON.stringify({
      totalMonthlyCost: "80",
      totalHourlyCost: "0.11",
      diffTotalMonthlyCost: "30",
      projects: [
        {
          diff: {
            resources: [
              {
                name: "aws_instance.web",
                resourceType: "aws_instance",
                monthlyCost: "80",
                hourlyCost: "0.11",
              },
            ],
          },
          pastBreakdown: {
            resources: [
              {
                name: "aws_instance.web",
                resourceType: "aws_instance",
                monthlyCost: "50",
                hourlyCost: "0.068",
              },
            ],
          },
        },
      ],
    });
    const result = parseDiffJson(raw);
    expect(result.resourceChanges).toHaveLength(1);
    expect(result.resourceChanges[0]!.name).toBe("aws_instance.web");
    expect(result.resourceChanges[0]!.action).toBe("update");
    expect(result.resourceChanges[0]!.previousMonthlyCost).toBe(50);
    expect(result.resourceChanges[0]!.newMonthlyCost).toBe(80);
  });

  it("detects created resources", () => {
    const raw = JSON.stringify({
      totalMonthlyCost: "30",
      totalHourlyCost: "0.04",
      diffTotalMonthlyCost: "30",
      projects: [
        {
          diff: {
            resources: [
              {
                name: "aws_s3_bucket.new",
                resourceType: "aws_s3_bucket",
                monthlyCost: "30",
                hourlyCost: "0.04",
              },
            ],
          },
          pastBreakdown: { resources: [] },
        },
      ],
    });
    const result = parseDiffJson(raw);
    expect(result.resourceChanges[0]!.action).toBe("create");
    expect(result.resourceChanges[0]!.previousMonthlyCost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BudgetManager
// ---------------------------------------------------------------------------
describe("BudgetManager", () => {
  const makeBudgetInput = (overrides?: Partial<BudgetInput>): BudgetInput => ({
    name: "Test Budget",
    scope: "project",
    scopeId: "proj-1",
    monthlyLimit: 1000,
    ...overrides,
  });

  it("creates a budget with defaults", () => {
    const mgr = new BudgetManager();
    const b = mgr.setBudget(makeBudgetInput());
    expect(b.name).toBe("Test Budget");
    expect(b.monthlyLimit).toBe(1000);
    expect(b.warningThreshold).toBe(80);
    expect(b.criticalThreshold).toBe(100);
    expect(b.currentSpend).toBe(0);
    expect(b.currency).toBe("USD");
  });

  it("retrieves budget by ID", () => {
    const mgr = new BudgetManager();
    const b = mgr.setBudget(makeBudgetInput());
    expect(mgr.getBudget(b.id)).toEqual(b);
  });

  it("finds budget by scope", () => {
    const mgr = new BudgetManager();
    mgr.setBudget(makeBudgetInput());
    const found = mgr.findBudget("project", "proj-1");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Test Budget");
  });

  it("returns null for missing budget", () => {
    const mgr = new BudgetManager();
    expect(mgr.getBudget("nonexistent")).toBeNull();
    expect(mgr.findBudget("team", "no-team")).toBeNull();
  });

  it("updates existing budget on same scope", () => {
    const mgr = new BudgetManager();
    const b1 = mgr.setBudget(makeBudgetInput());
    const b2 = mgr.setBudget(makeBudgetInput({ monthlyLimit: 2000 }));
    expect(b2.id).toBe(b1.id);
    expect(b2.monthlyLimit).toBe(2000);
    expect(mgr.listBudgets()).toHaveLength(1);
  });

  it("lists all budgets", () => {
    const mgr = new BudgetManager();
    mgr.setBudget(makeBudgetInput());
    mgr.setBudget(makeBudgetInput({ scope: "team", scopeId: "team-a" }));
    expect(mgr.listBudgets()).toHaveLength(2);
  });

  it("deletes a budget", () => {
    const mgr = new BudgetManager();
    const b = mgr.setBudget(makeBudgetInput());
    expect(mgr.deleteBudget(b.id)).toBe(true);
    expect(mgr.getBudget(b.id)).toBeNull();
    expect(mgr.deleteBudget("nope")).toBe(false);
  });

  it("updates spend", () => {
    const mgr = new BudgetManager();
    const b = mgr.setBudget(makeBudgetInput());
    const updated = mgr.updateSpend(b.id, 500);
    expect(updated!.currentSpend).toBe(500);
    expect(mgr.updateSpend("nope", 100)).toBeNull();
  });

  it("returns ok status when under warning", () => {
    const mgr = new BudgetManager();
    const b = mgr.setBudget(makeBudgetInput({ monthlyLimit: 1000 }));
    mgr.updateSpend(b.id, 500);
    expect(mgr.getStatus(mgr.getBudget(b.id)!)).toBe("ok");
  });

  it("returns warning status", () => {
    const mgr = new BudgetManager();
    const b = mgr.setBudget(makeBudgetInput({ monthlyLimit: 1000, warningThreshold: 80 }));
    mgr.updateSpend(b.id, 850);
    expect(mgr.getStatus(mgr.getBudget(b.id)!)).toBe("warning");
  });

  it("returns critical status", () => {
    const mgr = new BudgetManager();
    const b = mgr.setBudget(
      makeBudgetInput({ monthlyLimit: 1000, warningThreshold: 80, criticalThreshold: 95 }),
    );
    mgr.updateSpend(b.id, 960);
    expect(mgr.getStatus(mgr.getBudget(b.id)!)).toBe("critical");
  });

  it("returns exceeded status", () => {
    const mgr = new BudgetManager();
    const b = mgr.setBudget(makeBudgetInput({ monthlyLimit: 1000 }));
    mgr.updateSpend(b.id, 1100);
    expect(mgr.getStatus(mgr.getBudget(b.id)!)).toBe("exceeded");
  });

  it("getAllStatuses includes utilization", () => {
    const mgr = new BudgetManager();
    const b = mgr.setBudget(makeBudgetInput({ monthlyLimit: 200 }));
    mgr.updateSpend(b.id, 100);
    const statuses = mgr.getAllStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.utilization).toBe(50);
    expect(statuses[0]!.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// getUtilization
// ---------------------------------------------------------------------------
describe("getUtilization", () => {
  it("calculates percentage", () => {
    const b = { monthlyLimit: 1000, currentSpend: 750 } as Budget;
    expect(getUtilization(b)).toBe(75);
  });

  it("returns 0 for zero limit", () => {
    const b = { monthlyLimit: 0, currentSpend: 100 } as Budget;
    expect(getUtilization(b)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// linearForecast
// ---------------------------------------------------------------------------
describe("linearForecast", () => {
  it("returns empty for fewer than 2 points", () => {
    expect(linearForecast([{ date: "2024-01-01", amount: 100 }], 3)).toHaveLength(0);
    expect(linearForecast([], 3)).toHaveLength(0);
  });

  it("projects increasing trend", () => {
    const data = [
      { date: "2024-01-01", amount: 100 },
      { date: "2024-02-01", amount: 200 },
      { date: "2024-03-01", amount: 300 },
    ];
    const forecast = linearForecast(data, 2);
    expect(forecast).toHaveLength(2);
    expect(forecast[0]!.amount).toBeGreaterThan(300);
    expect(forecast[1]!.amount).toBeGreaterThan(forecast[0]!.amount);
  });

  it("projects decreasing trend with floor at 0", () => {
    const data = [
      { date: "2024-01-01", amount: 300 },
      { date: "2024-02-01", amount: 200 },
      { date: "2024-03-01", amount: 100 },
    ];
    const forecast = linearForecast(data, 5);
    // Eventually hits 0 floor
    const lastValue = forecast[forecast.length - 1]!.amount;
    expect(lastValue).toBe(0);
  });

  it("projects stable trend", () => {
    const data = [
      { date: "2024-01-01", amount: 500 },
      { date: "2024-02-01", amount: 500 },
      { date: "2024-03-01", amount: 500 },
    ];
    const forecast = linearForecast(data, 3);
    expect(forecast).toHaveLength(3);
    for (const p of forecast) {
      expect(p.amount).toBeCloseTo(500, 0);
    }
  });
});

// ---------------------------------------------------------------------------
// getTrendDirection
// ---------------------------------------------------------------------------
describe("getTrendDirection", () => {
  it("detects increasing", () => {
    expect(getTrendDirection(100, 120)).toBe("increasing");
  });

  it("detects decreasing", () => {
    expect(getTrendDirection(100, 80)).toBe("decreasing");
  });

  it("detects stable", () => {
    expect(getTrendDirection(100, 103)).toBe("stable");
  });

  it("handles zero current", () => {
    expect(getTrendDirection(0, 50)).toBe("stable");
  });
});
