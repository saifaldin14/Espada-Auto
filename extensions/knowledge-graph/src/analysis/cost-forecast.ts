/**
 * Infrastructure Knowledge Graph — Cost Forecasting Engine
 *
 * Provides time-series analysis and forecasting of infrastructure costs
 * using linear regression, seasonal decomposition, and anomaly-aware
 * confidence intervals.
 *
 * Consumes snapshot cost data from the temporal module and graph node
 * costs to produce forward-looking cost projections.
 */

import type { GraphStorage, GraphNode, CloudProvider, GraphResourceType } from "../types.js";
import type { GraphSnapshot, TemporalGraphStorage } from "../core/temporal.js";

// =============================================================================
// Types
// =============================================================================

/** A single data point in the cost time series. */
export type CostDataPoint = {
  timestamp: string;
  totalCost: number;
  nodeCount: number;
  provider?: string;
  resourceType?: string;
};

/** Linear regression model parameters. */
export type RegressionModel = {
  slope: number;
  intercept: number;
  rSquared: number;
  dataPoints: number;
};

/** A single forecast point with confidence interval. */
export type ForecastPoint = {
  timestamp: string;
  predicted: number;
  lowerBound: number;
  upperBound: number;
  confidence: number;
};

/** Seasonal pattern detected in cost data. */
export type SeasonalPattern = {
  /** Day of week with highest cost (0=Sun, 6=Sat). */
  peakDay: number;
  /** Average cost variation factor (1.0 = no variation). */
  variationFactor: number;
  /** Whether a meaningful seasonal pattern was detected. */
  detected: boolean;
};

/** Complete cost forecast result. */
export type CostForecast = {
  /** When the forecast was generated. */
  generatedAt: string;
  /** Historical data points used. */
  historicalData: CostDataPoint[];
  /** Regression model parameters. */
  model: RegressionModel;
  /** Forecasted data points. */
  forecast: ForecastPoint[];
  /** Seasonal pattern analysis. */
  seasonality: SeasonalPattern;
  /** Summary metrics. */
  summary: CostForecastSummary;
};

/** High-level forecast summary. */
export type CostForecastSummary = {
  currentMonthlyCost: number;
  predicted30DayCost: number;
  predicted90DayCost: number;
  costTrend: "increasing" | "decreasing" | "stable";
  trendRate: number;
  /** Estimated annual cost based on current trend. */
  projectedAnnualCost: number;
  /** Cost per node (current). */
  costPerNode: number;
  /** Breakdown by provider (current snapshot). */
  byProvider: Record<string, number>;
  /** Breakdown by resource type (current snapshot). */
  byResourceType: Record<string, number>;
  /** Top 5 cost drivers. */
  topCostDrivers: Array<{ nodeId: string; name: string; cost: number }>;
};

/** Options for generating a cost forecast. */
export type CostForecastOptions = {
  /** Number of days to forecast ahead (default: 90). */
  forecastDays?: number;
  /** Confidence level for intervals (default: 0.95). */
  confidenceLevel?: number;
  /** Filter by provider. */
  provider?: CloudProvider;
  /** Filter by resource type. */
  resourceType?: GraphResourceType;
  /** Minimum data points required (default: 3). */
  minDataPoints?: number;
};

// =============================================================================
// Linear Regression
// =============================================================================

/**
 * Fit a simple linear regression model: y = slope * x + intercept.
 * x values are millisecond timestamps normalized to days-from-first.
 */
export function fitLinearRegression(
  points: Array<{ x: number; y: number }>,
): RegressionModel {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0, rSquared: 0, dataPoints: 0 };
  if (n === 1) return { slope: 0, intercept: points[0]!.y, rSquared: 1, dataPoints: 1 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
    sumYY += p.y * p.y;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    return { slope: 0, intercept: sumY / n, rSquared: 0, dataPoints: n };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // R² coefficient of determination
  const meanY = sumY / n;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 1;

  return { slope, intercept, rSquared: Math.max(0, rSquared), dataPoints: n };
}

/**
 * Compute the standard error of the regression for prediction intervals.
 */
function computeStdError(
  points: Array<{ x: number; y: number }>,
  model: RegressionModel,
): number {
  if (points.length <= 2) return 0;

  const residuals = points.map((p) => p.y - (model.slope * p.x + model.intercept));
  const sse = residuals.reduce((s, r) => s + r * r, 0);
  return Math.sqrt(sse / (points.length - 2));
}

// =============================================================================
// Seasonal Analysis
// =============================================================================

/**
 * Detect weekly seasonal patterns in cost data.
 */
export function detectSeasonality(data: CostDataPoint[]): SeasonalPattern {
  if (data.length < 7) {
    return { peakDay: 0, variationFactor: 1.0, detected: false };
  }

  // Group costs by day-of-week
  const dayBuckets: number[][] = [[], [], [], [], [], [], []];
  for (const point of data) {
    const day = new Date(point.timestamp).getDay();
    dayBuckets[day]!.push(point.totalCost);
  }

  const dayAverages = dayBuckets.map((bucket) =>
    bucket.length > 0 ? bucket.reduce((a, b) => a + b, 0) / bucket.length : 0,
  );

  const overallAvg = dayAverages.reduce((a, b) => a + b, 0) / 7;
  if (overallAvg === 0) {
    return { peakDay: 0, variationFactor: 1.0, detected: false };
  }

  const peakDay = dayAverages.indexOf(Math.max(...dayAverages));
  const maxAvg = Math.max(...dayAverages);
  const minAvg = Math.min(...dayAverages.filter((a) => a > 0));
  const variationFactor = minAvg > 0 ? maxAvg / minAvg : 1.0;

  // Consider seasonal if variation is > 10%
  const detected = variationFactor > 1.1;

  return { peakDay, variationFactor, detected };
}

// =============================================================================
// Core Forecast Engine
// =============================================================================

/**
 * Build the historical cost time series from temporal snapshots.
 */
export async function buildCostTimeSeries(
  temporal: TemporalGraphStorage,
  options?: {
    provider?: CloudProvider;
    since?: string;
    limit?: number;
  },
): Promise<CostDataPoint[]> {
  const snapshots = await temporal.listSnapshots({
    since: options?.since,
    provider: options?.provider,
    limit: options?.limit ?? 200,
  });

  // Snapshots come newest-first; reverse for chronological order
  const sorted: GraphSnapshot[] = [...snapshots].reverse();

  return sorted.map((snap: GraphSnapshot) => ({
    timestamp: snap.createdAt,
    totalCost: snap.totalCostMonthly,
    nodeCount: snap.nodeCount,
    provider: snap.provider ?? undefined,
  }));
}

/**
 * Generate a cost forecast from historical data points.
 */
export function generateForecastFromData(
  data: CostDataPoint[],
  options: CostForecastOptions = {},
): CostForecast {
  const {
    forecastDays = 90,
    confidenceLevel = 0.95,
    minDataPoints = 3,
  } = options;

  const now = new Date();

  if (data.length < minDataPoints) {
    return buildEmptyForecast(data, now);
  }

  // Convert timestamps to days-from-first for regression
  const firstTs = new Date(data[0]!.timestamp).getTime();
  const msPerDay = 24 * 60 * 60 * 1000;

  const regressionPoints = data.map((d) => ({
    x: (new Date(d.timestamp).getTime() - firstTs) / msPerDay,
    y: d.totalCost,
  }));

  const model = fitLinearRegression(regressionPoints);
  const stdError = computeStdError(regressionPoints, model);
  const seasonality = detectSeasonality(data);

  // Confidence multiplier ( approximate z-score)
  const zScore = confidenceLevel >= 0.99 ? 2.576
    : confidenceLevel >= 0.95 ? 1.96
    : confidenceLevel >= 0.90 ? 1.645
    : 1.0;

  // Generate forecast points
  const lastX = regressionPoints[regressionPoints.length - 1]!.x;
  const forecast: ForecastPoint[] = [];

  for (let day = 1; day <= forecastDays; day++) {
    const futureX = lastX + day;
    const predicted = Math.max(0, model.slope * futureX + model.intercept);

    // Prediction interval widens with distance from data
    const distance = futureX - lastX;
    const interval = zScore * stdError * Math.sqrt(1 + 1 / data.length + distance);

    forecast.push({
      timestamp: new Date(now.getTime() + day * msPerDay).toISOString(),
      predicted: Math.round(predicted * 100) / 100,
      lowerBound: Math.max(0, Math.round((predicted - interval) * 100) / 100),
      upperBound: Math.round((predicted + interval) * 100) / 100,
      confidence: Math.max(0, Math.min(1, model.rSquared * (1 - distance / (forecastDays * 2)))),
    });
  }

  // Build summary
  const currentCost = data[data.length - 1]!.totalCost;
  const currentNodes = data[data.length - 1]!.nodeCount;
  const predicted30 = forecast[Math.min(29, forecast.length - 1)]?.predicted ?? currentCost;
  const predicted90 = forecast[forecast.length - 1]?.predicted ?? currentCost;

  // Daily slope → monthly rate
  const monthlyRate = model.slope * 30;
  const costTrend: CostForecastSummary["costTrend"] =
    monthlyRate > currentCost * 0.02 ? "increasing"
    : monthlyRate < -currentCost * 0.02 ? "decreasing"
    : "stable";

  const summary: CostForecastSummary = {
    currentMonthlyCost: currentCost,
    predicted30DayCost: predicted30,
    predicted90DayCost: predicted90,
    costTrend,
    trendRate: Math.round(monthlyRate * 100) / 100,
    projectedAnnualCost: Math.round(predicted30 * 12 * 100) / 100,
    costPerNode: currentNodes > 0 ? Math.round(currentCost / currentNodes * 100) / 100 : 0,
    byProvider: {},
    byResourceType: {},
    topCostDrivers: [],
  };

  return {
    generatedAt: now.toISOString(),
    historicalData: data,
    model,
    forecast,
    seasonality,
    summary,
  };
}

/**
 * Generate a full cost forecast using temporal snapshots + current graph state.
 */
export async function generateCostForecast(
  storage: GraphStorage,
  temporal: TemporalGraphStorage,
  options: CostForecastOptions = {},
): Promise<CostForecast> {
  // Build time series from snapshots
  const data = await buildCostTimeSeries(temporal, {
    provider: options.provider,
  });

  const forecast = generateForecastFromData(data, options);

  // Enrich summary with current graph breakdown
  const filter: { provider?: CloudProvider; resourceType?: GraphResourceType } = {};
  if (options.provider) filter.provider = options.provider;
  if (options.resourceType) filter.resourceType = options.resourceType;

  const nodes: GraphNode[] = await storage.queryNodes(filter);

  const byProvider: Record<string, number> = {};
  const byResourceType: Record<string, number> = {};
  const nodeCosts: Array<{ node: GraphNode; cost: number }> = [];

  for (const node of nodes) {
    const cost = node.costMonthly ?? 0;
    byProvider[node.provider] = (byProvider[node.provider] ?? 0) + cost;
    byResourceType[node.resourceType] = (byResourceType[node.resourceType] ?? 0) + cost;
    if (cost > 0) {
      nodeCosts.push({ node, cost });
    }
  }

  forecast.summary.byProvider = byProvider;
  forecast.summary.byResourceType = byResourceType;
  forecast.summary.topCostDrivers = nodeCosts
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5)
    .map((d) => ({ nodeId: d.node.id, name: d.node.name, cost: d.cost }));

  return forecast;
}

// =============================================================================
// Helpers
// =============================================================================

function buildEmptyForecast(data: CostDataPoint[], now: Date): CostForecast {
  const currentCost = data.length > 0 ? data[data.length - 1]!.totalCost : 0;
  return {
    generatedAt: now.toISOString(),
    historicalData: data,
    model: { slope: 0, intercept: currentCost, rSquared: 0, dataPoints: data.length },
    forecast: [],
    seasonality: { peakDay: 0, variationFactor: 1.0, detected: false },
    summary: {
      currentMonthlyCost: currentCost,
      predicted30DayCost: currentCost,
      predicted90DayCost: currentCost,
      costTrend: "stable",
      trendRate: 0,
      projectedAnnualCost: currentCost * 12,
      costPerNode: 0,
      byProvider: {},
      byResourceType: {},
      topCostDrivers: [],
    },
  };
}

/**
 * Format a cost forecast as markdown.
 */
export function formatCostForecastMarkdown(forecast: CostForecast): string {
  const s = forecast.summary;
  const lines: string[] = [
    "# Infrastructure Cost Forecast",
    "",
    `Generated: ${forecast.generatedAt}`,
    `Data points: ${forecast.historicalData.length}`,
    `Model R²: ${forecast.model.rSquared.toFixed(3)}`,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Current Monthly Cost | $${s.currentMonthlyCost.toFixed(2)} |`,
    `| 30-Day Forecast | $${s.predicted30DayCost.toFixed(2)} |`,
    `| 90-Day Forecast | $${s.predicted90DayCost.toFixed(2)} |`,
    `| Trend | ${s.costTrend} (${s.trendRate >= 0 ? "+" : ""}$${s.trendRate.toFixed(2)}/mo) |`,
    `| Projected Annual | $${s.projectedAnnualCost.toFixed(2)} |`,
    `| Cost per Node | $${s.costPerNode.toFixed(2)} |`,
    "",
  ];

  if (Object.keys(s.byProvider).length > 0) {
    lines.push(
      "## Cost by Provider",
      "",
      "| Provider | Monthly Cost |",
      "|----------|-------------|",
      ...Object.entries(s.byProvider)
        .sort((a, b) => b[1] - a[1])
        .map(([p, c]) => `| ${p} | $${c.toFixed(2)} |`),
      "",
    );
  }

  if (Object.keys(s.byResourceType).length > 0) {
    lines.push(
      "## Cost by Resource Type",
      "",
      "| Resource Type | Monthly Cost |",
      "|---------------|-------------|",
      ...Object.entries(s.byResourceType)
        .sort((a, b) => b[1] - a[1])
        .map(([rt, c]) => `| ${rt} | $${c.toFixed(2)} |`),
      "",
    );
  }

  if (s.topCostDrivers.length > 0) {
    lines.push(
      "## Top Cost Drivers",
      "",
      "| Resource | Monthly Cost |",
      "|----------|-------------|",
      ...s.topCostDrivers.map((d) => `| ${d.name} | $${d.cost.toFixed(2)} |`),
      "",
    );
  }

  if (forecast.seasonality.detected) {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    lines.push(
      "## Seasonality",
      "",
      `Peak cost day: ${days[forecast.seasonality.peakDay]}`,
      `Variation factor: ${forecast.seasonality.variationFactor.toFixed(2)}x`,
      "",
    );
  }

  return lines.join("\n");
}
