/**
 * Cost governance types — breakdowns, diffs, budgets, forecasts.
 */

/* ---------- Cost Breakdown ---------- */

export interface ResourceCost {
  name: string;
  resourceType: string;
  provider: string;
  monthlyCost: number;
  hourlyCost: number;
  subResources?: SubResourceCost[];
}

export interface SubResourceCost {
  name: string;
  monthlyCost: number;
  hourlyCost: number;
  unit: string;
  quantity: number;
  unitPrice: number;
}

export interface CostBreakdown {
  totalMonthlyCost: number;
  totalHourlyCost: number;
  resources: ResourceCost[];
  currency: string;
  generatedAt: string;
}

/* ---------- Cost Diff ---------- */

export interface ResourceCostChange {
  name: string;
  resourceType: string;
  action: "create" | "update" | "delete" | "no-change";
  previousMonthlyCost: number;
  newMonthlyCost: number;
  deltaMonthlyCost: number;
}

export interface CostDiff {
  currentMonthlyCost: number;
  projectedMonthlyCost: number;
  deltaMonthlyCost: number;
  deltaPercent: number;
  resourceChanges: ResourceCostChange[];
  currency: string;
  generatedAt: string;
}

/* ---------- Budget ---------- */

export type BudgetScope = "team" | "project" | "environment" | "global";
export type BudgetStatus = "ok" | "warning" | "critical" | "exceeded";

export interface Budget {
  id: string;
  name: string;
  scope: BudgetScope;
  scopeId: string;
  monthlyLimit: number;
  warningThreshold: number;  // percentage (e.g. 80)
  criticalThreshold: number; // percentage (e.g. 100)
  currentSpend: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetInput {
  name: string;
  scope: BudgetScope;
  scopeId: string;
  monthlyLimit: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  currency?: string;
}

/* ---------- Forecast ---------- */

export interface CostDataPoint {
  date: string;       // ISO date
  amount: number;
  currency: string;
}

export interface CostForecast {
  historicalData: CostDataPoint[];
  projectedData: CostDataPoint[];
  projectedMonthlyCost: number;
  trendDirection: "increasing" | "stable" | "decreasing";
  trendPercent: number;
  generatedAt: string;
}
