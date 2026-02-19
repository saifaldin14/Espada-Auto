/**
 * Cost governance types — breakdowns, diffs, budgets, forecasts,
 * and policy-engine type mirrors (avoid cross-extension rootDir imports).
 */

// ── Policy-Engine Type Mirrors ─────────────────────────────────────────────────

export type PolicySeverity = "critical" | "high" | "medium" | "low" | "info";

export type RuleCondition =
  | { type: "field_equals"; field: string; value: unknown }
  | { type: "field_not_equals"; field: string; value: unknown }
  | { type: "field_contains"; field: string; value: string }
  | { type: "field_matches"; field: string; pattern: string }
  | { type: "field_gt"; field: string; value: number }
  | { type: "field_lt"; field: string; value: number }
  | { type: "field_exists"; field: string }
  | { type: "field_not_exists"; field: string }
  | { type: "field_in"; field: string; values: unknown[] }
  | { type: "field_not_in"; field: string; values: unknown[] }
  | { type: "tag_missing"; tag: string }
  | { type: "tag_equals"; tag: string; value: string }
  | { type: "and"; conditions: RuleCondition[] }
  | { type: "or"; conditions: RuleCondition[] }
  | { type: "not"; condition: RuleCondition }
  | { type: "resource_type"; resourceType: string }
  | { type: "provider"; provider: string }
  | { type: "region"; region: string }
  | { type: "custom"; evaluator: string; args?: Record<string, unknown> };

export interface PolicyRule {
  id: string;
  description: string;
  condition: RuleCondition;
  action: string;
  message: string;
}

export interface PolicyDefinition {
  id: string;
  name: string;
  description: string;
  type: string;
  enabled: boolean;
  severity: PolicySeverity;
  labels: string[];
  autoAttachPatterns: string[];
  rules: PolicyRule[];
  createdAt: string;
  updatedAt: string;
}

export interface ResourceInput {
  id: string;
  type: string;
  provider: string;
  region: string;
  name: string;
  status: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
}

export type PolicyEvaluationInput = {
  resource?: ResourceInput;
  plan?: { resourceChanges?: unknown[]; resources?: ResourceInput[]; totalCreates: number; totalUpdates: number; totalDeletes: number };
  actor?: { id: string; roles: string[]; groups: string[] };
  environment?: string;
  graph?: { neighbors: ResourceInput[]; blastRadius: number; dependencyDepth: number };
  cost?: { current: number; projected: number; delta: number; currency: string };
  metadata?: Record<string, unknown>;
};

export interface RuleResult {
  ruleId: string;
  description: string;
  passed: boolean;
  action: "deny" | "warn" | "require_approval" | "notify";
  message: string;
}

export interface PolicyEvaluationResult {
  policyId: string;
  policyName: string;
  allowed: boolean;
  denied: boolean;
  warnings: string[];
  denials: string[];
  approvalRequired: boolean;
  notifications: string[];
  evaluatedRules: RuleResult[];
  evaluatedAt: string;
  durationMs: number;
}

export interface AggregatedPolicyResult {
  allowed: boolean;
  denied: boolean;
  warnings: string[];
  denials: string[];
  approvalRequired: boolean;
  notifications: string[];
  results: PolicyEvaluationResult[];
  totalPolicies: number;
  passedPolicies: number;
  failedPolicies: number;
  evaluatedAt: string;
  totalDurationMs: number;
}

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
