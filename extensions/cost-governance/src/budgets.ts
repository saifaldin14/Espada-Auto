/**
 * Budget manager — CRUD for cost budgets with threshold alerts.
 * Supports in-memory (tests) and JSON file persistence (~/.espada/budgets.json).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
  Budget,
  BudgetInput,
  BudgetScope,
  BudgetStatus,
  BudgetAuditAction,
  BudgetAuditEntry,
} from "./types.js";

export class BudgetManager {
  private budgets: Map<string, Budget> = new Map();
  private auditEntries: BudgetAuditEntry[] = [];
  private filePath: string | null;
  private auditFilePath: string | null;
  private maxAuditEntries: number;

  /**
   * @param filePath — JSON file path for persistence. Pass `null` for in-memory only (tests).
   *                    Defaults to `~/.espada/budgets.json`.
   */
  constructor(filePath?: string | null) {
    if (filePath === null) {
      this.filePath = null;
      this.auditFilePath = null;
    } else {
      this.filePath = filePath ?? join(homedir(), ".espada", "budgets.json");
      this.auditFilePath = this.filePath.replace(/\.json$/i, ".audit.json");
    }
    this.maxAuditEntries = 5000;
    this.load();
    this.loadAudit();
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
      const dir = dirname(this.filePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify([...this.budgets.values()], null, 2));
    } catch {
      // Best-effort persist
    }
  }

  /** Load audit trail from disk (no-op for in-memory mode). */
  private loadAudit(): void {
    if (!this.auditFilePath) return;
    try {
      if (existsSync(this.auditFilePath)) {
        const raw = readFileSync(this.auditFilePath, "utf-8");
        const arr: BudgetAuditEntry[] = JSON.parse(raw);
        this.auditEntries = Array.isArray(arr) ? arr : [];
      }
    } catch {
      // Corrupted file — start fresh
      this.auditEntries = [];
    }
  }

  /** Flush audit trail to disk (no-op for in-memory mode). */
  private saveAudit(): void {
    if (!this.auditFilePath) return;
    try {
      const dir = dirname(this.auditFilePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.auditFilePath, JSON.stringify(this.auditEntries, null, 2));
    } catch {
      // Best-effort persist
    }
  }

  /** Create or update a budget. */
  setBudget(input: BudgetInput): Budget {
    const existing = this.findBudget(input.scope, input.scopeId);
    const id = existing?.id ?? crypto.randomUUID();
    const previousStatus = existing ? this.getStatus(existing) : null;

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
    this.appendAuditEntry(existing ? "budget_updated" : "budget_created", budget, {
      previousStatus,
      currentStatus: this.getStatus(budget),
      metadata: {
        monthlyLimit: budget.monthlyLimit,
        warningThreshold: budget.warningThreshold,
        criticalThreshold: budget.criticalThreshold,
      },
    });
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
    const existing = this.budgets.get(id);
    const ok = this.budgets.delete(id);
    if (ok) {
      this.save();
      if (existing) {
        this.appendAuditEntry("budget_deleted", existing, {
          previousStatus: this.getStatus(existing),
          currentStatus: null,
        });
      }
    }
    return ok;
  }

  /** Update current spend for a budget. */
  updateSpend(id: string, currentSpend: number): Budget | null {
    const budget = this.budgets.get(id);
    if (!budget) return null;
    const previousStatus = this.getStatus(budget);
    const previousSpend = budget.currentSpend;
    budget.currentSpend = currentSpend;
    budget.updatedAt = new Date().toISOString();
    this.save();

    const currentStatus = this.getStatus(budget);
    this.appendAuditEntry("spend_updated", budget, {
      previousStatus,
      currentStatus,
      metadata: {
        previousSpend,
        currentSpend,
        delta: currentSpend - previousSpend,
      },
    });
    if (previousStatus !== currentStatus) {
      this.appendAuditEntry("status_changed", budget, {
        previousStatus,
        currentStatus,
      });
    }

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

  /** List budget audit entries, newest first. */
  listAuditEntries(options?: {
    limit?: number;
    scope?: BudgetScope;
    scopeId?: string;
  }): BudgetAuditEntry[] {
    const limit = options?.limit && options.limit > 0 ? Math.floor(options.limit) : undefined;
    let entries = [...this.auditEntries].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    if (options?.scope) {
      entries = entries.filter((entry) => entry.scope === options.scope);
    }
    if (options?.scopeId) {
      entries = entries.filter((entry) => entry.scopeId === options.scopeId);
    }

    return limit ? entries.slice(0, limit) : entries;
  }

  /** Clear audit entries, optionally only entries up to and including a timestamp. */
  clearAuditEntries(beforeOrAt?: string): number {
    if (!beforeOrAt) {
      const removed = this.auditEntries.length;
      this.auditEntries = [];
      this.saveAudit();
      return removed;
    }

    const threshold = new Date(beforeOrAt).getTime();
    if (Number.isNaN(threshold)) {
      return 0;
    }

    const beforeCount = this.auditEntries.length;
    this.auditEntries = this.auditEntries.filter((entry) => {
      const ts = new Date(entry.timestamp).getTime();
      return Number.isNaN(ts) || ts > threshold;
    });
    const removed = beforeCount - this.auditEntries.length;
    if (removed > 0) {
      this.saveAudit();
    }
    return removed;
  }

  private appendAuditEntry(
    action: BudgetAuditAction,
    budget: Budget,
    details?: {
      previousStatus?: BudgetStatus | null;
      currentStatus?: BudgetStatus | null;
      metadata?: Record<string, unknown>;
    },
  ): void {
    const entry: BudgetAuditEntry = {
      id: crypto.randomUUID(),
      action,
      budgetId: budget.id,
      budgetName: budget.name,
      scope: budget.scope,
      scopeId: budget.scopeId,
      previousStatus: details?.previousStatus ?? null,
      currentStatus: details?.currentStatus ?? null,
      timestamp: new Date().toISOString(),
      metadata: details?.metadata ?? {},
    };

    this.auditEntries.push(entry);
    if (this.auditEntries.length > this.maxAuditEntries) {
      const overflow = this.auditEntries.length - this.maxAuditEntries;
      this.auditEntries.splice(0, overflow);
    }
    this.saveAudit();
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
