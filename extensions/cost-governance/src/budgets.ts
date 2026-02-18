/**
 * Budget manager — CRUD for cost budgets with threshold alerts.
 * Supports in-memory (tests) and JSON file persistence (~/.espada/budgets.json).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Budget, BudgetInput, BudgetScope, BudgetStatus } from "./types.js";

export class BudgetManager {
  private budgets: Map<string, Budget> = new Map();
  private filePath: string | null;

  /**
   * @param filePath — JSON file path for persistence. Pass `null` for in-memory only (tests).
   *                    Defaults to `~/.espada/budgets.json`.
   */
  constructor(filePath?: string | null) {
    if (filePath === null) {
      this.filePath = null;
    } else {
      this.filePath = filePath ?? join(homedir(), ".espada", "budgets.json");
    }
    this.load();
  }

  /** Load budgets from disk (no-op for in-memory mode). */
  private load(): void {
    if (!this.filePath) return;
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        const arr: Budget[] = JSON.parse(raw);
        for (const b of arr) this.budgets.set(b.id, b);
      }
    } catch {
      // Corrupted file — start fresh
    }
  }

  /** Flush budgets to disk (no-op for in-memory mode). */
  private save(): void {
    if (!this.filePath) return;
    try {
      const dir = this.filePath.replace(/[/\\][^/\\]+$/, "");
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify([...this.budgets.values()], null, 2));
    } catch {
      // Best-effort persist
    }
  }

  /** Create or update a budget. */
  setBudget(input: BudgetInput): Budget {
    const existing = this.findBudget(input.scope, input.scopeId);
    const id = existing?.id ?? crypto.randomUUID();

    const budget: Budget = {
      id,
      name: input.name,
      scope: input.scope,
      scopeId: input.scopeId,
      monthlyLimit: input.monthlyLimit,
      warningThreshold: input.warningThreshold ?? 80,
      criticalThreshold: input.criticalThreshold ?? 100,
      currentSpend: existing?.currentSpend ?? 0,
      currency: input.currency ?? "USD",
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.budgets.set(id, budget);
    this.save();
    return budget;
  }

  /** Get a budget by ID. */
  getBudget(id: string): Budget | null {
    return this.budgets.get(id) ?? null;
  }

  /** Find a budget by scope and scope ID. */
  findBudget(scope: BudgetScope, scopeId: string): Budget | null {
    for (const b of this.budgets.values()) {
      if (b.scope === scope && b.scopeId === scopeId) return b;
    }
    return null;
  }

  /** List all budgets. */
  listBudgets(): Budget[] {
    return [...this.budgets.values()];
  }

  /** Delete a budget by ID. */
  deleteBudget(id: string): boolean {
    const ok = this.budgets.delete(id);
    if (ok) this.save();
    return ok;
  }

  /** Update current spend for a budget. */
  updateSpend(id: string, currentSpend: number): Budget | null {
    const budget = this.budgets.get(id);
    if (!budget) return null;
    budget.currentSpend = currentSpend;
    budget.updatedAt = new Date().toISOString();
    this.save();
    return budget;
  }

  /** Get budget status based on current spend vs thresholds. */
  getStatus(budget: Budget): BudgetStatus {
    const utilization = getUtilization(budget);
    if (utilization >= 100) return "exceeded";
    if (utilization >= budget.criticalThreshold) return "critical";
    if (utilization >= budget.warningThreshold) return "warning";
    return "ok";
  }

  /** Get all budgets with their statuses. */
  getAllStatuses(): Array<Budget & { status: BudgetStatus; utilization: number }> {
    return this.listBudgets().map((b) => ({
      ...b,
      status: this.getStatus(b),
      utilization: getUtilization(b),
    }));
  }
}

/** Calculate utilization percentage. */
export function getUtilization(budget: Budget): number {
  if (budget.monthlyLimit <= 0) return 0;
  return (budget.currentSpend / budget.monthlyLimit) * 100;
}

/**
 * Simple linear cost forecast based on historical data points.
 */
export function linearForecast(
  dataPoints: Array<{ date: string; amount: number }>,
  monthsAhead: number,
): Array<{ date: string; amount: number }> {
  if (dataPoints.length < 2) return [];

  // Simple linear regression
  const n = dataPoints.length;
  const xValues = dataPoints.map((_, i) => i);
  const yValues = dataPoints.map((d) => d.amount);

  const sumX = xValues.reduce((a, b) => a + b, 0);
  const sumY = yValues.reduce((a, b) => a + b, 0);
  const sumXY = xValues.reduce((a, x, i) => a + x * yValues[i]!, 0);
  const sumX2 = xValues.reduce((a, x) => a + x * x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const lastDate = new Date(dataPoints[dataPoints.length - 1]!.date);
  const projected: Array<{ date: string; amount: number }> = [];

  for (let i = 1; i <= monthsAhead; i++) {
    const futureDate = new Date(lastDate);
    futureDate.setMonth(futureDate.getMonth() + i);
    const x = n - 1 + i;
    const amount = Math.max(0, intercept + slope * x);

    projected.push({
      date: futureDate.toISOString().split("T")[0]!,
      amount: Math.round(amount * 100) / 100,
    });
  }

  return projected;
}

/**
 * Determine trend direction from forecast data.
 */
export function getTrendDirection(
  current: number,
  projected: number,
): "increasing" | "stable" | "decreasing" {
  const delta = projected - current;
  const pct = current > 0 ? (delta / current) * 100 : 0;
  if (pct > 5) return "increasing";
  if (pct < -5) return "decreasing";
  return "stable";
}
