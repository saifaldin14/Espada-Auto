/**
 * GCP Cost Management
 *
 * Cloud Billing, Budgets, Recommendations, and Cost Analysis using the
 * Cloud Billing API & Cloud Billing Budget API.
 */

import type { GcpRetryOptions, GcpOperationResult } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

export type CostGranularity = "DAILY" | "MONTHLY" | "QUARTERLY";

export type CostDimension = "SERVICE" | "PROJECT" | "REGION" | "SKU" | "LABEL";

export type CostMetric = "cost" | "usage" | "credit";

export type BudgetType = "SPECIFIED_AMOUNT" | "LAST_MONTH_COST" | "LAST_PERIOD_COST";

export type BudgetTimeUnit = "MONTHLY" | "QUARTERLY" | "YEARLY";

export type AlertThresholdType = "CURRENT_SPEND" | "FORECASTED_SPEND";

export type CostDataPoint = {
  startDate: string;
  endDate: string;
  service?: string;
  project?: string;
  region?: string;
  sku?: string;
  label?: string;
  cost: number;
  currency: string;
  credits: number;
  usage?: number;
  usageUnit?: string;
};

export type CostSummaryResult = {
  totalCost: number;
  currency: string;
  startDate: string;
  endDate: string;
  dataPoints: CostDataPoint[];
  byService: Record<string, number>;
  byProject: Record<string, number>;
};

export type GetCostSummaryOptions = {
  billingAccountId: string;
  startDate: string;
  endDate: string;
  granularity?: CostGranularity;
  groupBy?: CostDimension;
  projectFilter?: string[];
  serviceFilter?: string[];
};

export type CostForecastResult = {
  forecastedCost: number;
  currency: string;
  startDate: string;
  endDate: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
};

export type ForecastCostOptions = {
  billingAccountId: string;
  forecastDays: number;
};

export type BudgetAlert = {
  thresholdPercent: number;
  thresholdType: AlertThresholdType;
  notificationChannels?: string[];
};

export type BudgetInfo = {
  name: string;
  displayName: string;
  billingAccount: string;
  amount: number;
  currency: string;
  budgetType: BudgetType;
  timeUnit: BudgetTimeUnit;
  currentSpend: number;
  currentSpendPercent: number;
  alerts: BudgetAlert[];
  etag: string;
};

export type CreateBudgetOptions = {
  billingAccountId: string;
  displayName: string;
  amount: number;
  currency?: string;
  budgetType?: BudgetType;
  timeUnit?: BudgetTimeUnit;
  projectFilter?: string[];
  serviceFilter?: string[];
  alerts?: BudgetAlert[];
};

export type RecommendationType = "COST_SAVINGS" | "PERFORMANCE" | "SECURITY" | "SUSTAINABILITY";

export type CostRecommendation = {
  name: string;
  description: string;
  recommenderType: RecommendationType;
  primaryImpact: {
    category: string;
    costProjection?: {
      cost: number;
      duration: string;
    };
  };
  priority: "P1" | "P2" | "P3" | "P4";
  state: "ACTIVE" | "CLAIMED" | "SUCCEEDED" | "FAILED" | "DISMISSED";
  resource: string;
  lastRefreshTime: string;
};

export type UnusedResourceType = "IDLE_VM" | "UNATTACHED_DISK" | "IDLE_IP" | "IDLE_LB" | "UNUSED_SNAPSHOT";

export type UnusedResource = {
  resourceId: string;
  resourceType: UnusedResourceType;
  name: string;
  location: string;
  project: string;
  estimatedMonthlySavings: number;
  currency: string;
  lastUsed?: string;
  createdAt: string;
};

// =============================================================================
// Manager
// =============================================================================

const BILLING_BASE = "https://cloudbilling.googleapis.com/v1";
const BUDGETS_BASE = "https://billingbudgets.googleapis.com/v1";
const RECOMMENDER_BASE = "https://recommender.googleapis.com/v1";

export class GcpCostManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(
    projectId: string,
    getAccessToken: () => Promise<string>,
    retryOptions?: GcpRetryOptions,
  ) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = {
      ...(retryOptions ?? {}),
      service: "billing",
      projectId: this.projectId,
    };
  }

  // ---------------------------------------------------------------------------
  // Cost Analysis
  // ---------------------------------------------------------------------------

  async getCostSummary(opts: GetCostSummaryOptions): Promise<CostSummaryResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      // Use BigQuery billing export query via the billing API
      const url = `${BILLING_BASE}/billingAccounts/${opts.billingAccountId}:queryCostUsage`;
      const body = {
        usageDateRange: {
          startDate: this.parseDate(opts.startDate),
          endDate: this.parseDate(opts.endDate),
        },
        granularity: opts.granularity ?? "MONTHLY",
        groupBy: opts.groupBy ? [opts.groupBy] : undefined,
        filter: this.buildCostFilter(opts),
      };

      try {
        const data = await gcpRequest<Record<string, unknown>>(url, token, { method: "POST", body });
        return this.mapCostSummary(data, opts);
      } catch {
        // Fallback: return empty summary if billing export not configured
        return {
          totalCost: 0,
          currency: "USD",
          startDate: opts.startDate,
          endDate: opts.endDate,
          dataPoints: [],
          byService: {},
          byProject: {},
        };
      }
    }, this.retryOptions);
  }

  async forecastCost(opts: ForecastCostOptions): Promise<CostForecastResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BILLING_BASE}/billingAccounts/${opts.billingAccountId}:forecastCostUsage`;
      const body = {
        forecastPeriod: { days: opts.forecastDays },
      };

      try {
        const data = await gcpRequest<Record<string, unknown>>(url, token, { method: "POST", body });
        return {
          forecastedCost: Number(data.forecastedCost ?? 0),
          currency: String(data.currency ?? "USD"),
          startDate: new Date().toISOString().slice(0, 10),
          endDate: new Date(Date.now() + opts.forecastDays * 86400000).toISOString().slice(0, 10),
          confidence: (data.confidence as CostForecastResult["confidence"]) ?? "MEDIUM",
        };
      } catch {
        return {
          forecastedCost: 0,
          currency: "USD",
          startDate: new Date().toISOString().slice(0, 10),
          endDate: new Date(Date.now() + opts.forecastDays * 86400000).toISOString().slice(0, 10),
          confidence: "LOW",
        };
      }
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Budgets
  // ---------------------------------------------------------------------------

  async listBudgets(billingAccountId: string): Promise<BudgetInfo[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BUDGETS_BASE}/billingAccounts/${billingAccountId}/budgets`;
      const items = await gcpList<Record<string, unknown>>(url, token, "budgets");
      return items.map((b) => this.mapBudget(b));
    }, this.retryOptions);
  }

  async createBudget(opts: CreateBudgetOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BUDGETS_BASE}/billingAccounts/${opts.billingAccountId}/budgets`;
      const body = {
        displayName: opts.displayName,
        amount: {
          specifiedAmount: {
            currencyCode: opts.currency ?? "USD",
            units: String(Math.floor(opts.amount)),
            nanos: Math.round((opts.amount % 1) * 1e9),
          },
        },
        budgetFilter: {
          projects: opts.projectFilter?.map((p) => `projects/${p}`),
          services: opts.serviceFilter?.map((s) => `services/${s}`),
          calendarPeriod: opts.timeUnit ?? "MONTHLY",
        },
        thresholdRules: (opts.alerts ?? []).map((a) => ({
          thresholdPercent: a.thresholdPercent / 100,
          spendBasis: a.thresholdType === "FORECASTED_SPEND" ? "FORECASTED_SPEND" : "CURRENT_SPEND",
        })),
        notificationsRule: {
          monitoringNotificationChannels: opts.alerts?.flatMap((a) => a.notificationChannels ?? []),
        },
      };
      const result = await gcpMutate(url, token, body);
      return { success: true, message: `Budget "${opts.displayName}" created`, operationId: result.operationId };
    }, this.retryOptions);
  }

  async deleteBudget(billingAccountId: string, budgetId: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BUDGETS_BASE}/billingAccounts/${billingAccountId}/budgets/${budgetId}`;
      await gcpRequest(url, token, { method: "DELETE" });
      return { success: true, message: `Budget ${budgetId} deleted` };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Recommendations
  // ---------------------------------------------------------------------------

  async listRecommendations(location?: string): Promise<CostRecommendation[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const loc = location ?? "-";
      const recommenders = [
        "google.compute.instance.MachineTypeRecommender",
        "google.compute.instance.IdleResourceRecommender",
        "google.compute.disk.IdleResourceRecommender",
        "google.compute.address.IdleResourceRecommender",
      ];

      const allRecs: CostRecommendation[] = [];
      for (const recommender of recommenders) {
        try {
          const url = `${RECOMMENDER_BASE}/projects/${this.projectId}/locations/${loc}/recommenders/${recommender}/recommendations`;
          const items = await gcpList<Record<string, unknown>>(url, token, "recommendations");
          allRecs.push(...items.map((r) => this.mapRecommendation(r)));
        } catch {
          // Skip recommenders that aren't available
        }
      }
      return allRecs;
    }, this.retryOptions);
  }

  async findUnusedResources(location?: string): Promise<UnusedResource[]> {
    const recs = await this.listRecommendations(location);
    return recs
      .filter((r) => r.state === "ACTIVE" && r.primaryImpact.costProjection)
      .map((r) => ({
        resourceId: r.resource,
        resourceType: this.classifyUnusedResourceType(r.name),
        name: r.resource.split("/").pop() ?? r.resource,
        location: this.extractLocation(r.name),
        project: this.projectId,
        estimatedMonthlySavings: Math.abs(r.primaryImpact.costProjection?.cost ?? 0),
        currency: "USD",
        createdAt: r.lastRefreshTime,
      }));
  }

  // ---------------------------------------------------------------------------
  // Billing Account Info
  // ---------------------------------------------------------------------------

  async getBillingInfo(): Promise<{ billingAccountName: string; billingEnabled: boolean }> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${BILLING_BASE}/projects/${this.projectId}/billingInfo`;
      const data = await gcpRequest<Record<string, unknown>>(url, token);
      return {
        billingAccountName: String(data.billingAccountName ?? ""),
        billingEnabled: Boolean(data.billingEnabled),
      };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private parseDate(dateStr: string): { year: number; month: number; day: number } {
    const [year, month, day] = dateStr.split("-").map(Number);
    return { year, month, day };
  }

  private buildCostFilter(opts: GetCostSummaryOptions): Record<string, unknown> | undefined {
    const filter: Record<string, unknown> = {};
    if (opts.projectFilter?.length) filter.projects = opts.projectFilter.map((p) => `projects/${p}`);
    if (opts.serviceFilter?.length) filter.services = opts.serviceFilter.map((s) => `services/${s}`);
    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  private mapCostSummary(data: Record<string, unknown>, opts: GetCostSummaryOptions): CostSummaryResult {
    const rows = (data.costUsageRows ?? []) as Array<Record<string, unknown>>;
    let totalCost = 0;
    const byService: Record<string, number> = {};
    const byProject: Record<string, number> = {};
    const dataPoints: CostDataPoint[] = [];

    for (const row of rows) {
      const cost = Number(row.cost ?? 0);
      totalCost += cost;
      const service = String(row.service ?? "");
      const project = String(row.project ?? "");
      if (service) byService[service] = (byService[service] ?? 0) + cost;
      if (project) byProject[project] = (byProject[project] ?? 0) + cost;
      dataPoints.push({
        startDate: String(row.startDate ?? opts.startDate),
        endDate: String(row.endDate ?? opts.endDate),
        service: service || undefined,
        project: project || undefined,
        cost,
        currency: String(row.currency ?? "USD"),
        credits: Number(row.credits ?? 0),
      });
    }

    return {
      totalCost,
      currency: "USD",
      startDate: opts.startDate,
      endDate: opts.endDate,
      dataPoints,
      byService,
      byProject,
    };
  }

  private mapBudget(raw: Record<string, unknown>): BudgetInfo {
    const amount = raw.amount as Record<string, unknown> | undefined;
    const specifiedAmount = amount?.specifiedAmount as Record<string, unknown> | undefined;
    const amountValue = specifiedAmount
      ? Number(specifiedAmount.units ?? 0) + Number(specifiedAmount.nanos ?? 0) / 1e9
      : 0;

    const thresholdRules = (raw.thresholdRules ?? []) as Array<Record<string, unknown>>;
    const currentSpend = Number((raw.currentSpend as Record<string, unknown>)?.amount ?? 0);

    return {
      name: String(raw.name ?? ""),
      displayName: String(raw.displayName ?? ""),
      billingAccount: String(raw.billingAccount ?? ""),
      amount: amountValue,
      currency: String(specifiedAmount?.currencyCode ?? "USD"),
      budgetType: specifiedAmount ? "SPECIFIED_AMOUNT" : "LAST_MONTH_COST",
      timeUnit: String((raw.budgetFilter as Record<string, unknown>)?.calendarPeriod ?? "MONTHLY") as BudgetTimeUnit,
      currentSpend,
      currentSpendPercent: amountValue > 0 ? (currentSpend / amountValue) * 100 : 0,
      alerts: thresholdRules.map((t) => ({
        thresholdPercent: Number(t.thresholdPercent ?? 0) * 100,
        thresholdType: (t.spendBasis === "FORECASTED_SPEND" ? "FORECASTED_SPEND" : "CURRENT_SPEND") as AlertThresholdType,
      })),
      etag: String(raw.etag ?? ""),
    };
  }

  private mapRecommendation(raw: Record<string, unknown>): CostRecommendation {
    const content = raw.content as Record<string, unknown> | undefined;
    const primaryImpact = (raw.primaryImpact ?? content?.primaryImpact ?? {}) as Record<string, unknown>;
    const costProjection = primaryImpact.costProjection as Record<string, unknown> | undefined;

    return {
      name: String(raw.name ?? ""),
      description: String(raw.description ?? content?.overview ?? ""),
      recommenderType: "COST_SAVINGS",
      primaryImpact: {
        category: String(primaryImpact.category ?? "COST"),
        costProjection: costProjection
          ? {
              cost: Number((costProjection.cost as Record<string, unknown>)?.units ?? 0),
              duration: String(costProjection.duration ?? ""),
            }
          : undefined,
      },
      priority: (raw.priority as CostRecommendation["priority"]) ?? "P3",
      state: String((raw.stateInfo as Record<string, unknown>)?.state ?? "ACTIVE") as CostRecommendation["state"],
      resource: String(raw.name ?? "").replace(/\/recommendations\/.*/, ""),
      lastRefreshTime: String(raw.lastRefreshTime ?? ""),
    };
  }

  private classifyUnusedResourceType(name: string): UnusedResourceType {
    if (name.includes("Instance")) return "IDLE_VM";
    if (name.includes("disk") || name.includes("Disk")) return "UNATTACHED_DISK";
    if (name.includes("address") || name.includes("Address")) return "IDLE_IP";
    return "IDLE_VM";
  }

  private extractLocation(name: string): string {
    const match = name.match(/locations\/([^/]+)/);
    return match?.[1] ?? "-";
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createCostManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpCostManager {
  return new GcpCostManager(projectId, getAccessToken, retryOptions);
}
