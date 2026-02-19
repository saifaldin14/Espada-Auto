/**
 * Cost Governance — Cost Policy Rules
 *
 * Pre-built cost-specific policy definitions for the Policy Engine.
 * These are declarative rules that gate infrastructure changes based on
 * cost thresholds, budget utilization, and spending patterns.
 *
 * Integrates with the Policy Engine's rule evaluator — rules use
 * `cost.*` and `plan.*` condition fields.
 */

import type { PolicyDefinition, PolicyRule } from "./types.js";

// ── Pre-Built Cost Policy Definitions ──────────────────────────────────────────

/**
 * Deny changes that increase monthly cost by more than a given amount.
 */
export function createCostDeltaPolicy(
  maxDeltaUsd: number,
  options?: { id?: string; severity?: "critical" | "high" | "medium" | "low" },
): PolicyDefinition {
  const now = new Date().toISOString();
  return {
    id: options?.id ?? "cost-delta-limit",
    name: `Cost delta limit ($${maxDeltaUsd}/mo)`,
    description: `Deny changes that increase monthly cost by more than $${maxDeltaUsd}`,
    type: "cost",
    enabled: true,
    severity: options?.severity ?? "high",
    labels: ["cost", "governance"],
    autoAttachPatterns: ["*"],
    rules: [
      {
        id: "cost-delta-exceeded",
        description: `Monthly cost increase exceeds $${maxDeltaUsd}`,
        condition: { type: "field_gt", field: "cost.delta", value: maxDeltaUsd },
        action: "deny",
        message: `Change would increase monthly cost by more than $${maxDeltaUsd}. Current delta: check cost.delta field.`,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Require approval for resources costing more than a given monthly amount.
 */
export function createHighCostApprovalPolicy(
  thresholdUsd: number,
  options?: { id?: string; severity?: "critical" | "high" | "medium" | "low" },
): PolicyDefinition {
  const now = new Date().toISOString();
  return {
    id: options?.id ?? "high-cost-approval",
    name: `High cost approval (>$${thresholdUsd}/mo)`,
    description: `Require approval for resources projected to cost more than $${thresholdUsd}/month`,
    type: "cost",
    enabled: true,
    severity: options?.severity ?? "medium",
    labels: ["cost", "approval"],
    autoAttachPatterns: ["*"],
    rules: [
      {
        id: "high-cost-resource",
        description: `Projected monthly cost exceeds $${thresholdUsd}`,
        condition: { type: "field_gt", field: "cost.projected", value: thresholdUsd },
        action: "require_approval",
        message: `Projected cost exceeds $${thresholdUsd}/month — approval required.`,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Warn when cost increase exceeds a percentage threshold.
 */
export function createCostPercentageWarnPolicy(
  maxPercentIncrease: number,
  options?: { id?: string; severity?: "critical" | "high" | "medium" | "low" },
): PolicyDefinition {
  const now = new Date().toISOString();
  return {
    id: options?.id ?? "cost-percent-warn",
    name: `Cost increase warning (>${maxPercentIncrease}%)`,
    description: `Warn when change increases costs by more than ${maxPercentIncrease}%`,
    type: "cost",
    enabled: true,
    severity: options?.severity ?? "medium",
    labels: ["cost", "warning"],
    autoAttachPatterns: ["*"],
    rules: [
      {
        id: "cost-percent-exceeded",
        description: `Cost increase exceeds ${maxPercentIncrease}%`,
        condition: {
          type: "and",
          conditions: [
            { type: "field_gt", field: "cost.current", value: 0 },
            { type: "field_gt", field: "cost.delta", value: 0 },
          ],
        },
        action: "warn",
        message: `Cost increase may exceed ${maxPercentIncrease}% — review the cost diff.`,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Deny plans with destructive changes (deletes) when cost is above threshold.
 */
export function createDestructiveHighCostPolicy(
  costThresholdUsd: number,
  options?: { id?: string; severity?: "critical" | "high" | "medium" | "low" },
): PolicyDefinition {
  const now = new Date().toISOString();
  return {
    id: options?.id ?? "destructive-high-cost",
    name: `Deny destructive changes on high-cost resources (>$${costThresholdUsd}/mo)`,
    description: `Deny plans that delete resources with monthly cost above $${costThresholdUsd}`,
    type: "cost",
    enabled: true,
    severity: options?.severity ?? "critical",
    labels: ["cost", "safety", "destructive"],
    autoAttachPatterns: ["*"],
    rules: [
      {
        id: "destructive-high-cost-deny",
        description: `Destructive change on resource costing >$${costThresholdUsd}/mo`,
        condition: {
          type: "and",
          conditions: [
            { type: "field_gt", field: "plan.totalDeletes", value: 0 },
            { type: "field_gt", field: "cost.current", value: costThresholdUsd },
          ],
        },
        action: "deny",
        message: `Cannot delete resources with monthly cost above $${costThresholdUsd}. Review carefully.`,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Notify when any new resource is created.
 * Useful for cost visibility — alerts the team whenever spend is about to increase.
 */
export function createNewResourceNotifyPolicy(
  options?: { id?: string },
): PolicyDefinition {
  const now = new Date().toISOString();
  return {
    id: options?.id ?? "new-resource-notify",
    name: "Notify on new resource creation",
    description: "Send notification when new infrastructure resources are created",
    type: "cost",
    enabled: true,
    severity: "info",
    labels: ["cost", "visibility"],
    autoAttachPatterns: ["*"],
    rules: [
      {
        id: "new-resource-created",
        description: "New resource being created",
        condition: { type: "field_gt", field: "plan.totalCreates", value: 0 },
        action: "notify",
        message: "New infrastructure resource(s) being created — review cost impact.",
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

// ── Budget-Based Policies ──────────────────────────────────────────────────────

/**
 * Create a budget utilization warning policy.
 *
 * Warns when projected spend after a change would push utilization past a threshold.
 */
export function createBudgetUtilizationPolicy(
  budgetUsd: number,
  warningPercent = 80,
  criticalPercent = 100,
  options?: { id?: string },
): PolicyDefinition {
  const warningAmount = (budgetUsd * warningPercent) / 100;
  const criticalAmount = (budgetUsd * criticalPercent) / 100;
  const now = new Date().toISOString();

  const rules: PolicyRule[] = [
    {
      id: "budget-critical",
      description: `Projected spend exceeds ${criticalPercent}% of $${budgetUsd} budget`,
      condition: { type: "field_gt", field: "cost.projected", value: criticalAmount },
      action: "deny",
      message: `Projected spend ($${criticalAmount}+) would exceed ${criticalPercent}% of the $${budgetUsd} monthly budget.`,
    },
    {
      id: "budget-warning",
      description: `Projected spend exceeds ${warningPercent}% of $${budgetUsd} budget`,
      condition: {
        type: "and",
        conditions: [
          { type: "field_gt", field: "cost.projected", value: warningAmount },
          { type: "field_lt", field: "cost.projected", value: criticalAmount },
        ],
      },
      action: "warn",
      message: `Projected spend approaching budget limit (${warningPercent}% of $${budgetUsd}).`,
    },
  ];

  return {
    id: options?.id ?? "budget-utilization",
    name: `Budget utilization ($${budgetUsd}/mo)`,
    description: `Warn at ${warningPercent}% and deny at ${criticalPercent}% of $${budgetUsd} monthly budget`,
    type: "cost",
    enabled: true,
    severity: "high",
    labels: ["cost", "budget"],
    autoAttachPatterns: ["*"],
    rules,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Default Cost Policy Library ────────────────────────────────────────────────

/**
 * Return a set of sensible default cost policies.
 *
 * These are a good starting point for most organizations:
 * - Deny cost increases > $500/mo
 * - Require approval for resources > $200/mo
 * - Warn on % increases
 * - Deny destructive changes on high-cost resources > $1000/mo
 * - Notify on new resource creation
 */
export function getDefaultCostPolicies(): PolicyDefinition[] {
  return [
    createCostDeltaPolicy(500),
    createHighCostApprovalPolicy(200),
    createCostPercentageWarnPolicy(25),
    createDestructiveHighCostPolicy(1000),
    createNewResourceNotifyPolicy(),
  ];
}
