/**
 * GCP Extension — Cloud Billing Manager
 *
 * Manages billing accounts, project billing info, budgets, and cost breakdowns
 * via the Cloud Billing REST API (v1) and Cloud Billing Budget API (v1).
 */

import type { GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList } from "../api.js";

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
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all billing accounts accessible to the caller. */
  async listBillingAccounts(): Promise<GcpBillingAccount[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudbilling.googleapis.com/v1/billingAccounts`;
      return gcpList<GcpBillingAccount>(url, token, "billingAccounts");
    }, this.retryOptions);
  }

  /** Get billing info for the current project. */
  async getBillingInfo(): Promise<GcpProjectBillingInfo> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudbilling.googleapis.com/v1/projects/${this.projectId}/billingInfo`;
      return gcpRequest<GcpProjectBillingInfo>(url, token);
    }, this.retryOptions);
  }

  /** List budgets for a given billing account. */
  async listBudgets(billingAccount: string): Promise<GcpBudget[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://billingbudgets.googleapis.com/v1/${billingAccount}/budgets`;
      return gcpList<GcpBudget>(url, token, "budgets");
    }, this.retryOptions);
  }

  /**
   * Get a cost breakdown for the project over a date range.
   *
   * GCP requires BigQuery billing export for detailed cost data.
   * This method fetches the project's billing info as a best-effort
   * approach and returns a structured (empty) breakdown.
   */
  async getCostBreakdown(opts?: {
    startDate?: string;
    endDate?: string;
  }): Promise<GcpCostBreakdown> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      // GCP requires BigQuery billing export for detailed cost data.
      // Fetch billing info to validate the project; return empty breakdown.
      await gcpRequest<Record<string, unknown>>(
        `https://cloudbilling.googleapis.com/v1/projects/${this.projectId}/billingInfo`,
        token,
      );
      return {
        totalCost: 0,
        currency: "USD",
        serviceCosts: [],
        period: {
          startDate: opts?.startDate ?? "",
          endDate: opts?.endDate ?? "",
        },
      };
    }, this.retryOptions);
  }
}
