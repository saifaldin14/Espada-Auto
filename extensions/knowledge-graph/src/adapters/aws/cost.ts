/**
 * AWS Adapter — Cost Domain Module
 *
 * Cost Explorer enrichment, forecasting, optimization recommendations,
 * and unused resource detection via the CostManager from @espada/aws.
 */

import type { GraphNodeInput } from "../../types.js";
import type { DiscoveryError } from "../types.js";
import type { AwsAdapterContext } from "./context.js";
import type { AwsForecastResult, AwsOptimizationResult, AwsUnusedResourcesResult } from "./types.js";
import { AWS_SERVICE_TO_RESOURCE_TYPE } from "./constants.js";

// =============================================================================
// Helpers
// =============================================================================

/** Format a Date as YYYY-MM-DD for Cost Explorer API calls. */
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// =============================================================================
// Internal helpers (not exported)
// =============================================================================

/**
 * Query AWS Cost Explorer for per-service monthly costs.
 * Delegates to `@espada/aws` CostManager.getCostSummary().
 *
 * Returns a map of AWS service name → monthly cost in USD.
 */
async function queryServiceCosts(
  ctx: AwsAdapterContext,
  timePeriod: { Start: string; End: string },
  lookbackDays: number,
): Promise<Map<string, number> | null> {
  const cm = await ctx.getCostManagerInstance();
  if (!cm) return null;

  try {
    // Use CostManager.getCostSummary() grouped by SERVICE
    const result = await (cm as { getCostSummary: (opts: unknown) => Promise<{ success: boolean; data?: { groups?: Array<{ key: string; total: number }> } }> }).getCostSummary({
      timePeriod: { start: timePeriod.Start, end: timePeriod.End },
      granularity: "MONTHLY",
      groupBy: [{ type: "DIMENSION", key: "SERVICE" }],
      metrics: ["UnblendedCost"],
    });

    if (!result.success || !result.data?.groups) return null;

    const serviceCosts = new Map<string, number>();
    for (const group of result.data.groups) {
      if (group.total > 0) {
        serviceCosts.set(group.key, group.total);
      }
    }

    // Normalize to monthly if lookback > 30 days
    if (lookbackDays > 30) {
      const factor = 30 / lookbackDays;
      for (const [k, v] of serviceCosts.entries()) {
        serviceCosts.set(k, Math.round(v * factor * 100) / 100);
      }
    }

    return serviceCosts.size > 0 ? serviceCosts : null;
  } catch {
    return null;
  }
}

/**
 * Query Cost Explorer for resource-level costs via CostManager.
 * Uses DAILY granularity over the last 14 days, then extrapolates to monthly.
 *
 * Returns a map of resource ARN/ID → monthly cost in USD.
 */
async function queryResourceCosts(
  ctx: AwsAdapterContext,
  _timePeriod: { Start: string; End: string },
  _lookbackDays: number,
): Promise<Map<string, number> | null> {
  const cm = await ctx.getCostManagerInstance();
  if (!cm) return null;

  try {
    // Resource-level data requires DAILY granularity and max 14 days
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 14 * 24 * 60 * 60 * 1000);

    const result = await (cm as { getCostSummary: (opts: unknown) => Promise<{ success: boolean; data?: { groups?: Array<{ key: string; total: number }> } }> }).getCostSummary({
      timePeriod: { start: formatDate(startDate), end: formatDate(endDate) },
      granularity: "DAILY",
      groupBy: [{ type: "DIMENSION", key: "RESOURCE" }],
      metrics: ["UnblendedCost"],
      filter: {
        dimension: "SERVICE",
        values: [
          "Amazon Elastic Compute Cloud - Compute",
          "Amazon Relational Database Service",
          "AWS Lambda",
          "Amazon Simple Storage Service",
          "Amazon ElastiCache",
          "Amazon Elastic Container Service",
          "Amazon Elastic Kubernetes Service",
          "Amazon SageMaker",
        ],
      },
    });

    if (!result.success || !result.data?.groups) return null;

    const resourceCosts = new Map<string, number>();
    for (const group of result.data.groups) {
      if (group.total > 0) {
        resourceCosts.set(group.key, group.total);
      }
    }

    // Extrapolate 14 days to monthly (×30/14)
    const factor = 30 / 14;
    for (const [k, v] of resourceCosts.entries()) {
      resourceCosts.set(k, Math.round(v * factor * 100) / 100);
    }

    return resourceCosts.size > 0 ? resourceCosts : null;
  } catch {
    return null;
  }
}

/**
 * Apply resource-level Cost Explorer data to matching nodes.
 * Matches by ARN substring or native resource ID.
 */
function applyResourceCosts(
  nodes: GraphNodeInput[],
  resourceCosts: Map<string, number>,
): void {
  for (const node of nodes) {
    for (const [arn, cost] of resourceCosts.entries()) {
      // Match by nativeId (contained in the ARN) or by full ARN match
      if (
        arn.includes(node.nativeId) ||
        (node.metadata["arn"] && arn === node.metadata["arn"]) ||
        arn.endsWith(`/${node.nativeId}`) ||
        arn.endsWith(`:${node.nativeId}`)
      ) {
        node.costMonthly = cost;
        node.metadata["costSource"] = "cost-explorer";
        node.metadata["costArn"] = arn;
        break;
      }
    }
  }
}

/**
 * Distribute service-level costs from Cost Explorer to discovered nodes
 * that don't already have resource-level cost data.
 *
 * Strategy: for each AWS service bucket, find matching uncosted nodes
 * and divide the service cost among them (weighted by static estimate
 * if available, otherwise equal split).
 */
function distributeServiceCosts(
  nodes: GraphNodeInput[],
  serviceCosts: Map<string, number>,
): void {
  for (const [awsService, totalCost] of serviceCosts.entries()) {
    const resourceTypes = AWS_SERVICE_TO_RESOURCE_TYPE[awsService];
    if (!resourceTypes) continue;

    // Find nodes of this resource type that don't have CE cost yet
    const uncostdNodes = nodes.filter(
      (n) =>
        resourceTypes.includes(n.resourceType) &&
        n.metadata["costSource"] !== "cost-explorer",
    );
    if (uncostdNodes.length === 0) continue;

    // Weighted distribution: use existing static estimates as weights
    const totalStaticWeight = uncostdNodes.reduce(
      (sum, n) => sum + (n.costMonthly ?? 1),
      0,
    );

    for (const node of uncostdNodes) {
      const weight = (node.costMonthly ?? 1) / totalStaticWeight;
      node.costMonthly = Math.round(totalCost * weight * 100) / 100;
      node.metadata["costSource"] = "cost-explorer-distributed";
    }
  }
}

// =============================================================================
// Exported functions
// =============================================================================

/**
 * Enrich discovered nodes with real cost data from AWS Cost Explorer.
 *
 * Delegates to the `@espada/aws` CostManager for CE queries, then
 * applies KG-specific distribution logic to map costs to graph nodes.
 *
 * Strategy:
 * 1. Query `GetCostAndUsage` grouped by SERVICE for the last N days.
 * 2. Map AWS service names to graph resource types.
 * 3. Distribute per-service costs proportionally across discovered nodes
 *    of that type (weighted by static estimates when available).
 * 4. For services with resource-level granularity (EC2, RDS, Lambda),
 *    also query `GetCostAndUsage` with RESOURCE dimension.
 *
 * Sets `metadata.costSource = "cost-explorer"` on enriched nodes.
 */
export async function enrichWithCostExplorer(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  errors: DiscoveryError[],
): Promise<void> {
  const lookbackDays = ctx.config.costLookbackDays ?? 30;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const timePeriod = {
    Start: formatDate(startDate),
    End: formatDate(endDate),
  };

  try {
    // Step 1: Get per-service cost totals (delegates to CostManager)
    const serviceCosts = await queryServiceCosts(ctx, timePeriod, lookbackDays);
    if (!serviceCosts || serviceCosts.size === 0) return;

    // Step 2: Try resource-level cost data for supported services
    const resourceCosts = await queryResourceCosts(ctx, timePeriod, lookbackDays);

    // Step 3: Match resource-level costs to nodes by ARN/ID
    if (resourceCosts && resourceCosts.size > 0) {
      applyResourceCosts(nodes, resourceCosts);
    }

    // Step 4: Distribute remaining service-level costs to uncosted nodes
    distributeServiceCosts(nodes, serviceCosts);
  } catch (error) {
    errors.push({
      resourceType: "custom",
      message: `Cost Explorer enrichment failed: ${error instanceof Error ? error.message : String(error)}`,
      code: (error as { code?: string })?.code,
    });
  }
}

/**
 * Forecast future AWS costs using CostManager.forecastCosts().
 *
 * Returns a forecast result or null if the CostManager is unavailable
 * or the forecast fails. This is a new capability enabled by the
 * @espada/aws integration.
 */
export async function forecastCosts(
  ctx: AwsAdapterContext,
  options?: {
    /** Forecast horizon in days (default: 30). */
    days?: number;
    /** Granularity: "MONTHLY" | "DAILY" (default: "MONTHLY"). */
    granularity?: string;
  },
): Promise<AwsForecastResult | null> {
  const cm = await ctx.getCostManagerInstance();
  if (!cm) return null;

  try {
    const days = options?.days ?? 30;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);

    const result = await (cm as {
      forecastCosts: (opts: unknown) => Promise<{
        success: boolean;
        data?: {
          totalForecastedCost: number;
          forecastPeriods?: Array<{ start: string; end: string; amount: number }>;
          currency?: string;
          confidenceLevel?: number;
        };
        error?: string;
      }>;
    }).forecastCosts({
      timePeriod: { start: formatDate(startDate), end: formatDate(endDate) },
      granularity: options?.granularity ?? "MONTHLY",
      metric: "UNBLENDED_COST",
    });

    if (!result.success || !result.data) return null;

    return {
      totalForecastedCost: result.data.totalForecastedCost,
      forecastPeriods: result.data.forecastPeriods ?? [],
      currency: result.data.currency ?? "USD",
      confidenceLevel: result.data.confidenceLevel,
    };
  } catch {
    return null;
  }
}

/**
 * Get optimization recommendations via CostManager.
 *
 * Covers rightsizing, reserved instance, and savings plan opportunities.
 * Returns null if the CostManager is unavailable.
 */
export async function getOptimizationRecommendations(
  ctx: AwsAdapterContext,
): Promise<AwsOptimizationResult | null> {
  const cm = await ctx.getCostManagerInstance();
  if (!cm) return null;

  try {
    const result = await (cm as {
      getOptimizationRecommendations: (opts?: unknown) => Promise<{
        success: boolean;
        data?: {
          rightsizing?: Array<{ instanceId: string; currentType: string; recommendedType: string; estimatedSavings: number }>;
          reservedInstances?: Array<{ service: string; recommendedCount: number; estimatedSavings: number }>;
          savingsPlans?: Array<{ type: string; commitment: number; estimatedSavings: number }>;
          totalEstimatedSavings?: number;
        };
        error?: string;
      }>;
    }).getOptimizationRecommendations();

    if (!result.success || !result.data) return null;

    return {
      rightsizing: result.data.rightsizing ?? [],
      reservedInstances: result.data.reservedInstances ?? [],
      savingsPlans: result.data.savingsPlans ?? [],
      totalEstimatedSavings: result.data.totalEstimatedSavings ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Detect unused AWS resources via CostManager.findUnusedResources().
 *
 * Identifies idle EBS volumes, unused EIPs, stale snapshots, cold Lambda
 * functions, idle instances, and unused load balancers.
 */
export async function findUnusedResources(
  ctx: AwsAdapterContext,
): Promise<AwsUnusedResourcesResult | null> {
  const cm = await ctx.getCostManagerInstance();
  if (!cm) return null;

  try {
    const result = await (cm as {
      findUnusedResources: (opts?: unknown) => Promise<{
        success: boolean;
        data?: {
          resources: Array<{
            resourceId: string;
            resourceType: string;
            reason: string;
            estimatedMonthlyCost: number;
            region?: string;
            lastUsed?: string;
          }>;
          totalWastedCost: number;
        };
        error?: string;
      }>;
    }).findUnusedResources();

    if (!result.success || !result.data) return null;

    return {
      resources: result.data.resources,
      totalWastedCost: result.data.totalWastedCost,
    };
  } catch {
    return null;
  }
}
