/**
 * Azure Cost Management Manager
 *
 * Queries costs, forecasts, and budgets via @azure/arm-costmanagement.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { CostQueryResult, Budget, CostQueryOptions } from "./types.js";

export class AzureCostManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions?: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    retryOptions?: AzureRetryOptions
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions;
  }

  private async getCostClient() {
    const { CostManagementClient } = await import("@azure/arm-costmanagement");
    const credential = this.credentialsManager.getCredential();
    return new CostManagementClient(credential);
  }

  async queryCosts(options?: CostQueryOptions): Promise<CostQueryResult> {
    return withAzureRetry(async () => {
      const client = await this.getCostClient();
      const scope = `/subscriptions/${this.subscriptionId}`;
      const grouping = (options?.groupBy ?? []).map((dim) => ({
        type: "Dimension" as const,
        name: dim,
      }));
      const result = await client.query.usage(scope, {
        type: "ActualCost",
        timeframe: (options?.timeframe as any) ?? "MonthToDate",
        timePeriod: options?.timePeriod
          ? { from: new Date(options.timePeriod.from), to: new Date(options.timePeriod.to) }
          : undefined,
        dataset: {
          granularity: (options?.granularity as any) ?? "None",
          aggregation: { totalCost: { name: "Cost", function: "Sum" } },
          grouping: grouping.length > 0 ? grouping : undefined,
        },
      });
      return {
        columns: (result.columns ?? []).map((c) => ({ name: c.name ?? "", type: c.type ?? "" })),
        rows: (result.rows ?? []) as Array<Array<string | number>>,
        nextLink: result.nextLink,
      };
    }, this.retryOptions);
  }

  async getForecast(options?: { timeframe?: string }): Promise<CostQueryResult> {
    return withAzureRetry(async () => {
      const client = await this.getCostClient();
      const scope = `/subscriptions/${this.subscriptionId}`;
      const now = new Date();
      const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const result = await client.forecast.usage(scope, {
        type: "ActualCost",
        timeframe: (options?.timeframe as any) ?? "MonthToDate",
        timePeriod: { from: now, to: endDate },
        dataset: {
          granularity: "Daily" as any,
          aggregation: { totalCost: { name: "Cost", function: "Sum" } },
        },
      });
      return {
        columns: (result.columns ?? []).map((c) => ({ name: c.name ?? "", type: c.type ?? "" })),
        rows: (result.rows ?? []) as Array<Array<string | number>>,
        nextLink: result.nextLink,
      };
    }, this.retryOptions);
  }

  async listBudgets(resourceGroup?: string): Promise<Budget[]> {
    return withAzureRetry(async () => {
      const { ConsumptionManagementClient } = await import("@azure/arm-consumption");
      const credential = this.credentialsManager.getCredential();
      const client = new ConsumptionManagementClient(credential, this.subscriptionId);
      const scope = resourceGroup
        ? `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroup}`
        : `/subscriptions/${this.subscriptionId}`;
      const results: Budget[] = [];
      for await (const b of client.budgets.list(scope)) {
        results.push({
          id: b.id ?? "",
          name: b.name ?? "",
          amount: b.amount ?? 0,
          currency: "USD",
          timeGrain: (b.timeGrain as any) ?? "Monthly",
          currentSpend: b.currentSpend?.amount ?? 0,
          notifications: Object.values(b.notifications ?? {}).map((n) => ({
            threshold: n.threshold ?? 0,
            operator: n.operator ?? "",
            contactEmails: n.contactEmails ?? [],
            enabled: n.enabled ?? false,
          })),
          startDate: b.timePeriod?.startDate?.toISOString(),
          endDate: b.timePeriod?.endDate?.toISOString(),
        });
      }
      return results;
    }, this.retryOptions);
  }
}

export function createCostManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureCostManager {
  return new AzureCostManager(credentialsManager, subscriptionId, retryOptions);
}
