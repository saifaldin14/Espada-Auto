/**
 * GCP Extension — Cloud Billing Manager
 *
 * Manages billing accounts, project billing info, budgets, and cost breakdowns.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

// =============================================================================
// Types
// =============================================================================

/** A Cloud Billing account. */
export type GcpBillingAccount = {
  name: string;
  displayName: string;
  open: boolean;
  masterBillingAccount: string;
};

/** Billing information associated with a project. */
export type GcpProjectBillingInfo = {
  projectId: string;
  billingAccountName: string;
  billingEnabled: boolean;
};

/** A budget configured in Cloud Billing. */
export type GcpBudget = {
  name: string;
  displayName: string;
  amount: { specifiedAmount?: { currencyCode: string; units: string }; lastPeriodAmount?: object };
  thresholdRules: Array<{ thresholdPercent: number; spendBasis: string }>;
  budgetFilter: Record<string, unknown>;
};

/** Cost for a single GCP service. */
export type GcpServiceCost = {
  service: string;
  cost: number;
  currency: string;
};

/** Aggregated cost breakdown for the project. */
export type GcpCostBreakdown = {
  totalCost: number;
  currency: string;
  serviceCosts: GcpServiceCost[];
  period: { startDate: string; endDate: string };
};

// =============================================================================
// GcpBillingManager
// =============================================================================

/**
 * Manages GCP Cloud Billing resources.
 *
 * Provides methods for listing billing accounts, querying project billing
 * info, budgets, and cost breakdowns.
 */
export class GcpBillingManager {
  private projectId: string;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all billing accounts accessible to the caller. */
  async listBillingAccounts(): Promise<GcpBillingAccount[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudbilling.googleapis.com/v1/billingAccounts`;
      return [] as GcpBillingAccount[];
    }, this.retryOptions);
  }

  /** Get billing info for the current project. */
  async getBillingInfo(): Promise<GcpProjectBillingInfo> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudbilling.googleapis.com/v1/projects/${this.projectId}/billingInfo`;
      throw new Error(`Billing info for project ${this.projectId} not found (placeholder)`);
    }, this.retryOptions);
  }

  /** List budgets for a given billing account. */
  async listBudgets(billingAccount: string): Promise<GcpBudget[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://billingbudgets.googleapis.com/v1/${billingAccount}/budgets`;
      return [] as GcpBudget[];
    }, this.retryOptions);
  }

  /** Get a cost breakdown for the project over a date range. */
  async getCostBreakdown(opts?: {
    startDate?: string;
    endDate?: string;
  }): Promise<GcpCostBreakdown> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudbilling.googleapis.com/v1/projects/${this.projectId}/costs`;
      const _params = opts;
      return {
        totalCost: 0,
        currency: "USD",
        serviceCosts: [],
        period: {
          startDate: opts?.startDate ?? "",
          endDate: opts?.endDate ?? "",
        },
      } as GcpCostBreakdown;
    }, this.retryOptions);
  }
}
