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

/** Holt-Winters model parameters. */
export type HoltWintersModel = {
  /** Smoothing factor for the level component (0-1). */
  alpha: number;
  /** Smoothing factor for the trend component (0-1). */
  beta: number;
  /** Smoothing factor for the seasonal component (0-1). */
  gamma: number;
  /** Seasonal period length (e.g. 7 for weekly). */
  seasonalPeriod: number;
  /** Final level estimate. */
  level: number;
  /** Final trend estimate. */
  trend: number;
  /** Seasonal indices (one per period position). */
  seasonalIndices: number[];
  /** In-sample MAPE (Mean Absolute Percentage Error). */
  mape: number;
  /** In-sample RMSE (Root Mean Squared Error). */
  rmse: number;
};

/** Exponentially Weighted Moving Average parameters. */
export type EWMAModel = {
  /** Smoothing factor (0-1). Higher = more weight on recent data. */
  alpha: number;
  /** Final smoothed value. */
  smoothedValue: number;
  /** All smoothed values in series. */
  smoothedSeries: number[];
};

/** Which forecasting method was used. */
export type ForecastMethod =
  | "linear-regression"
  | "holt-winters"
  | "holt-linear"
  | "ewma"
  | "ensemble";

/** Model selection result with accuracy metrics. */
export type ModelSelection = {
  /** Which method was selected. */
  selectedMethod: ForecastMethod;
  /** Why this method was chosen. */
  reason: string;
  /** Per-method accuracy comparison (MAPE). */
  methodAccuracy: Record<string, number>;
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
  /** Holt-Winters model (if enough data is available). */
  holtWintersModel?: HoltWintersModel;
  /** EWMA model. */
  ewmaModel?: EWMAModel;
  /** Which forecasting method was used for the primary forecast. */
  forecastMethod: ForecastMethod;
  /** Model selection details. */
  modelSelection?: ModelSelection;
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
// Exponentially Weighted Moving Average (EWMA)
// =============================================================================

/**
 * Fit an EWMA model. Good for short-term smoothing and noise reduction.
 * Uses the given alpha or auto-optimizes for minimum MSE.
 */
export function fitEWMA(
  values: number[],
  alpha?: number,
): EWMAModel {
  if (values.length === 0) {
    return { alpha: 0.3, smoothedValue: 0, smoothedSeries: [] };
  }

  const bestAlpha = alpha ?? optimizeEWMAAlpha(values);
  const smoothed: number[] = [values[0]!];

  for (let i = 1; i < values.length; i++) {
    smoothed.push(bestAlpha * values[i]! + (1 - bestAlpha) * smoothed[i - 1]!);
  }

  return {
    alpha: bestAlpha,
    smoothedValue: smoothed[smoothed.length - 1]!,
    smoothedSeries: smoothed,
  };
}

/** Grid-search for the alpha that minimizes MSE on the series. */
function optimizeEWMAAlpha(values: number[]): number {
  let bestAlpha = 0.3;
  let bestMSE = Infinity;

  for (let a = 0.05; a <= 0.95; a += 0.05) {
    let smoothed = values[0]!;
    let mse = 0;
    for (let i = 1; i < values.length; i++) {
      smoothed = a * values[i]! + (1 - a) * smoothed;
      mse += (values[i]! - smoothed) ** 2;
    }
    mse /= (values.length - 1);
    if (mse < bestMSE) {
      bestMSE = mse;
      bestAlpha = a;
    }
  }

  return Math.round(bestAlpha * 100) / 100;
}

// =============================================================================
// Holt's Linear Exponential Smoothing (Double Exponential)
// =============================================================================

/**
 * Holt's linear method: captures level + trend without seasonality.
 * Better than plain linear regression when the trend is changing over time.
 */
export function fitHoltLinear(
  values: number[],
  alpha?: number,
  beta?: number,
): { level: number; trend: number; alpha: number; beta: number; fittedValues: number[]; mape: number; rmse: number } {
  if (values.length < 3) {
    return { level: values[0] ?? 0, trend: 0, alpha: 0.3, beta: 0.1, fittedValues: [...values], mape: 0, rmse: 0 };
  }

  const bestParams = alpha != null && beta != null
    ? { alpha, beta }
    : optimizeHoltParams(values);

  const a = bestParams.alpha;
  const b = bestParams.beta;

  let level = values[0]!;
  let trend = values[1]! - values[0]!;
  const fitted: number[] = [level];

  for (let t = 1; t < values.length; t++) {
    const prevLevel = level;
    level = a * values[t]! + (1 - a) * (prevLevel + trend);
    trend = b * (level - prevLevel) + (1 - b) * trend;
    fitted.push(level + trend);
  }

  const { mape, rmse } = computeAccuracy(values, fitted);

  return { level, trend, alpha: a, beta: b, fittedValues: fitted, mape, rmse };
}

/** Grid-search for optimal Holt parameters. */
function optimizeHoltParams(values: number[]): { alpha: number; beta: number } {
  let bestAlpha = 0.3;
  let bestBeta = 0.1;
  let bestMSE = Infinity;

  for (let a = 0.1; a <= 0.9; a += 0.1) {
    for (let b = 0.01; b <= 0.5; b += 0.05) {
      let level = values[0]!;
      let trend = values[1]! - values[0]!;
      let mse = 0;

      for (let t = 1; t < values.length; t++) {
        const forecast = level + trend;
        mse += (values[t]! - forecast) ** 2;
        const prevLevel = level;
        level = a * values[t]! + (1 - a) * (prevLevel + trend);
        trend = b * (level - prevLevel) + (1 - b) * trend;
      }
      mse /= (values.length - 1);

      if (mse < bestMSE) {
        bestMSE = mse;
        bestAlpha = a;
        bestBeta = b;
      }
    }
  }

  return { alpha: Math.round(bestAlpha * 100) / 100, beta: Math.round(bestBeta * 100) / 100 };
}

// =============================================================================
// Holt-Winters Triple Exponential Smoothing
// =============================================================================

/**
 * Holt-Winters additive method for data with trend AND seasonal patterns.
 * This is the CFO-grade forecasting method — captures weekly cost cycles,
 * end-of-month spikes, and changing growth rates simultaneously.
 *
 * Requires at least 2 full seasonal periods of data (e.g. 14 days for weekly).
 */
export function fitHoltWinters(
  values: number[],
  seasonalPeriod: number,
  alpha?: number,
  beta?: number,
  gamma?: number,
): HoltWintersModel | null {
  // Guard against degenerate or invalid period
  if (seasonalPeriod < 2 || !Number.isFinite(seasonalPeriod)) {
    return null;
  }

  // Need at least 2 full periods for meaningful seasonal decomposition
  if (values.length < seasonalPeriod * 2) {
    return null;
  }

  // Guard against NaN/Infinity in input — would collapse the entire model
  if (values.some((v) => !Number.isFinite(v))) {
    return null;
  }

  const bestParams = alpha != null && beta != null && gamma != null
    ? { alpha, beta, gamma }
    : optimizeHoltWintersParams(values, seasonalPeriod);

  const a = bestParams.alpha;
  const b = bestParams.beta;
  const g = bestParams.gamma;
  const m = seasonalPeriod;

  // Initialize level and trend from first period
  let level = 0;
  for (let i = 0; i < m; i++) level += values[i]!;
  level /= m;

  let trend = 0;
  for (let i = 0; i < m; i++) {
    trend += (values[m + i]! - values[i]!);
  }
  trend /= (m * m);

  // Initialize seasonal indices from first two periods
  const seasonal = new Array<number>(m);
  for (let i = 0; i < m; i++) {
    seasonal[i] = values[i]! - level;
  }

  // Run the Holt-Winters recursion
  const fitted: number[] = [];
  for (let t = 0; t < values.length; t++) {
    const sIdx = t % m;
    if (t < m) {
      fitted.push(level + trend + seasonal[sIdx]!);
      continue;
    }

    const prevLevel = level;
    const prevSeasonal = seasonal[sIdx]!;

    // Level update: deseasonalize the observation
    level = a * (values[t]! - prevSeasonal) + (1 - a) * (prevLevel + trend);
    // Trend update
    trend = b * (level - prevLevel) + (1 - b) * trend;
    // Seasonal update
    seasonal[sIdx] = g * (values[t]! - level) + (1 - g) * prevSeasonal;

    fitted.push(level + trend + seasonal[sIdx]!);
  }

  const { mape, rmse } = computeAccuracy(values, fitted);

  return {
    alpha: a,
    beta: b,
    gamma: g,
    seasonalPeriod: m,
    level,
    trend,
    seasonalIndices: [...seasonal],
    mape,
    rmse,
  };
}

/** Forecast future values using a fitted Holt-Winters model. */
export function forecastHoltWinters(
  model: HoltWintersModel,
  steps: number,
): number[] {
  const forecasts: number[] = [];
  for (let h = 1; h <= steps; h++) {
    const sIdx = (h - 1) % model.seasonalPeriod;
    const pred = model.level + h * model.trend + model.seasonalIndices[sIdx]!;
    forecasts.push(Math.max(0, pred));
  }
  return forecasts;
}

/** Grid-search for Holt-Winters parameters (coarse then fine). */
function optimizeHoltWintersParams(
  values: number[],
  m: number,
): { alpha: number; beta: number; gamma: number } {
  let bestAlpha = 0.3;
  let bestBeta = 0.1;
  let bestGamma = 0.1;
  let bestMSE = Infinity;

  // Coarse grid search
  for (let a = 0.1; a <= 0.9; a += 0.2) {
    for (let b = 0.01; b <= 0.3; b += 0.1) {
      for (let g = 0.05; g <= 0.5; g += 0.15) {
        const mse = evaluateHoltWintersMSE(values, m, a, b, g);
        if (mse < bestMSE) {
          bestMSE = mse;
          bestAlpha = a;
          bestBeta = b;
          bestGamma = g;
        }
      }
    }
  }

  // Fine search around best coarse values
  const steps = [
    { a: -0.1, b: -0.05, g: -0.05 },
    { a: -0.05, b: -0.02, g: -0.02 },
    { a: 0, b: 0, g: 0 },
    { a: 0.05, b: 0.02, g: 0.02 },
    { a: 0.1, b: 0.05, g: 0.05 },
  ];

  for (const da of steps) {
    for (const db of steps) {
      for (const dg of steps) {
        const a = clamp(bestAlpha + da.a, 0.01, 0.99);
        const b = clamp(bestBeta + db.b, 0.001, 0.5);
        const g = clamp(bestGamma + dg.g, 0.01, 0.99);
        const mse = evaluateHoltWintersMSE(values, m, a, b, g);
        if (mse < bestMSE) {
          bestMSE = mse;
          bestAlpha = a;
          bestBeta = b;
          bestGamma = g;
        }
      }
    }
  }

  return {
    alpha: Math.round(bestAlpha * 100) / 100,
    beta: Math.round(bestBeta * 1000) / 1000,
    gamma: Math.round(bestGamma * 100) / 100,
  };
}

function evaluateHoltWintersMSE(
  values: number[],
  m: number,
  alpha: number,
  beta: number,
  gamma: number,
): number {
  if (m < 2 || values.length < m * 2) return Infinity;

  let level = 0;
  for (let i = 0; i < m; i++) level += values[i]!;
  level /= m;

  let trend = 0;
  for (let i = 0; i < m; i++) trend += (values[m + i]! - values[i]!);
  trend /= (m * m);

  const seasonal = new Array<number>(m);
  for (let i = 0; i < m; i++) seasonal[i] = values[i]! - level;

  let mse = 0;
  let count = 0;

  for (let t = m; t < values.length; t++) {
    const sIdx = t % m;
    const forecast = level + trend + seasonal[sIdx]!;
    mse += (values[t]! - forecast) ** 2;
    count++;

    const prevLevel = level;
    level = alpha * (values[t]! - seasonal[sIdx]!) + (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonal[sIdx] = gamma * (values[t]! - level) + (1 - gamma) * seasonal[sIdx]!;
  }

  return count > 0 ? mse / count : Infinity;
}

// =============================================================================
// Model Selection — Automatic Best-Method Picker
// =============================================================================

/**
 * Automatically select the best forecasting model for the given data.
 * Uses holdout validation: trains on first 80%, tests on last 20%.
 *
 * Selection logic:
 *   - < 7 data points → linear regression (only method with enough data)
 *   - 7-13 points → compare regression vs Holt linear vs EWMA
 *   - 14+ points → compare all including Holt-Winters with weekly seasonality
 *   - If seasonal pattern detected → boost Holt-Winters score
 */
export function selectBestModel(
  data: CostDataPoint[],
  seasonalPeriod = 7,
): ModelSelection {
  const values = data.map((d) => d.totalCost);
  const methodAccuracy: Record<string, number> = {};

  if (values.length < 5) {
    return {
      selectedMethod: "linear-regression",
      reason: "Insufficient data for advanced methods (< 5 points)",
      methodAccuracy: { "linear-regression": 0 },
    };
  }

  // Train/test split (80/20)
  const splitIdx = Math.floor(values.length * 0.8);
  const trainValues = values.slice(0, splitIdx);
  const testValues = values.slice(splitIdx);

  if (testValues.length === 0) {
    return {
      selectedMethod: "linear-regression",
      reason: "Not enough test data for validation",
      methodAccuracy: { "linear-regression": 0 },
    };
  }

  // 1. Linear regression
  const msPerDay = 24 * 60 * 60 * 1000;
  const firstTs = new Date(data[0]!.timestamp).getTime();
  const trainPoints = data.slice(0, splitIdx).map((d) => ({
    x: (new Date(d.timestamp).getTime() - firstTs) / msPerDay,
    y: d.totalCost,
  }));
  const regModel = fitLinearRegression(trainPoints);
  const regPredictions = data.slice(splitIdx).map((d) => {
    const x = (new Date(d.timestamp).getTime() - firstTs) / msPerDay;
    return Math.max(0, regModel.slope * x + regModel.intercept);
  });
  methodAccuracy["linear-regression"] = computeMAPE(testValues, regPredictions);

  // 2. EWMA
  const ewma = fitEWMA(trainValues);
  const ewmaPredictions = new Array<number>(testValues.length).fill(ewma.smoothedValue);
  methodAccuracy["ewma"] = computeMAPE(testValues, ewmaPredictions);

  // 3. Holt linear (hoist model for reuse in ensemble branch below)
  const holtModel = trainValues.length >= 3 ? fitHoltLinear(trainValues) : null;
  let holtPredictions: number[] | null = null;
  if (holtModel) {
    holtPredictions = [];
    for (let h = 1; h <= testValues.length; h++) {
      holtPredictions.push(Math.max(0, holtModel.level + h * holtModel.trend));
    }
    methodAccuracy["holt-linear"] = computeMAPE(testValues, holtPredictions);
  }

  // 4. Holt-Winters (hoist model for reuse in ensemble branch below)
  const hwModel = trainValues.length >= seasonalPeriod * 2
    ? fitHoltWinters(trainValues, seasonalPeriod)
    : null;
  let hwPredictions: number[] | null = null;
  if (hwModel) {
    hwPredictions = forecastHoltWinters(hwModel, testValues.length);
    methodAccuracy["holt-winters"] = computeMAPE(testValues, hwPredictions);
  }

  // 5. Ensemble — weighted average of all available models
  //    Weights are inversely proportional to MAPE (lower error → higher weight).
  if (Object.keys(methodAccuracy).length >= 2) {
    const entries = Object.entries(methodAccuracy).filter(([, mape]) => Number.isFinite(mape) && mape > 0);
    if (entries.length >= 2) {
      const inverseSum = entries.reduce((s, [, mape]) => s + 1 / mape, 0);
      const weights = new Map(entries.map(([m, mape]) => [m, (1 / mape) / inverseSum]));

      // Build ensemble predictions on the test set
      const ensemblePredictions: number[] = new Array(testValues.length).fill(0);

      // Reuse already-fitted models instead of re-fitting
      const methodPredictions: Record<string, number[]> = {};
      methodPredictions["linear-regression"] = regPredictions;
      methodPredictions["ewma"] = ewmaPredictions;
      if (holtPredictions) {
        methodPredictions["holt-linear"] = holtPredictions;
      }
      if (hwPredictions) {
        methodPredictions["holt-winters"] = hwPredictions;
      }

      for (const [method, w] of weights) {
        const preds = methodPredictions[method];
        if (!preds) continue;
        for (let i = 0; i < testValues.length; i++) {
          ensemblePredictions[i] += (preds[i] ?? 0) * w;
        }
      }

      methodAccuracy["ensemble"] = computeMAPE(testValues, ensemblePredictions);
    }
  }

  // Pick the method with the lowest MAPE
  let bestMethod: ForecastMethod = "linear-regression";
  let bestMAPE = Infinity;
  let reason = "";

  for (const [method, mape] of Object.entries(methodAccuracy)) {
    if (mape < bestMAPE) {
      bestMAPE = mape;
      bestMethod = method as ForecastMethod;
    }
  }

  // Explain the selection
  const seasonality = detectSeasonality(data);
  if (bestMethod === "ensemble") {
    reason = `Ensemble selected: weighted combination of ${Object.keys(methodAccuracy).length - 1} models with MAPE=${bestMAPE.toFixed(1)}%`;
  } else if (bestMethod === "holt-winters") {
    reason = `Holt-Winters selected: seasonal data (period=${seasonalPeriod}) with MAPE=${bestMAPE.toFixed(1)}%`;
  } else if (bestMethod === "holt-linear") {
    reason = `Holt linear selected: trend detected with MAPE=${bestMAPE.toFixed(1)}%`;
  } else if (bestMethod === "ewma") {
    reason = `EWMA selected: stable/mean-reverting data with MAPE=${bestMAPE.toFixed(1)}%`;
  } else {
    reason = `Linear regression selected: ${seasonality.detected ? "seasonal pattern detected but HW not better" : "clear linear trend"} with MAPE=${bestMAPE.toFixed(1)}%`;
  }

  return { selectedMethod: bestMethod, reason, methodAccuracy };
}

// =============================================================================
// Ensemble Forecasting
// =============================================================================

/** Per-model forecast with its inverse-MAPE weight. */
export type EnsembleMember = {
  method: ForecastMethod;
  weight: number;
  predictions: number[];
};

/** Result of an ensemble forecast. */
export type EnsembleForecastResult = {
  members: EnsembleMember[];
  combined: number[];
  combinedMAPE: number | null;
};

/**
 * Build a weighted ensemble from individual model forecasts.
 * Weights are inversely proportional to each model's holdout MAPE.
 * Returns the ensemble members, combined predictions, and (if test data
 * is provided) the ensemble MAPE.
 */
export function ensembleForecast(
  memberForecasts: Array<{ method: ForecastMethod; predictions: number[]; mape: number }>,
  testValues?: number[],
): EnsembleForecastResult {
  const validMembers = memberForecasts.filter(
    (m) => Number.isFinite(m.mape) && m.mape > 0 && m.predictions.length > 0,
  );

  if (validMembers.length === 0) {
    return { members: [], combined: [], combinedMAPE: null };
  }

  // Single-model ensemble = that model
  if (validMembers.length === 1) {
    const m = validMembers[0]!;
    return {
      members: [{ method: m.method, weight: 1, predictions: m.predictions }],
      combined: [...m.predictions],
      combinedMAPE: testValues ? computeMAPE(testValues, m.predictions) : null,
    };
  }

  const inverseSum = validMembers.reduce((s, m) => s + 1 / m.mape, 0);
  const members: EnsembleMember[] = validMembers.map((m) => ({
    method: m.method,
    weight: (1 / m.mape) / inverseSum,
    predictions: m.predictions,
  }));

  const predLengths = members.map((m) => m.predictions.length);
  const steps = predLengths.length > 0 ? Math.max(...predLengths) : 0;
  const combined: number[] = [];
  for (let i = 0; i < steps; i++) {
    let val = 0;
    for (const m of members) {
      val += (m.predictions[i] ?? 0) * m.weight;
    }
    combined.push(Math.max(0, val));
  }

  const combinedMAPE = testValues ? computeMAPE(testValues, combined) : null;
  return { members, combined, combinedMAPE };
}

// =============================================================================
// Accuracy Metrics
// =============================================================================

/** Mean Absolute Percentage Error — the standard forecast accuracy metric. */
function computeMAPE(actual: number[], predicted: number[]): number {
  const len = Math.min(actual.length, predicted.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < len; i++) {
    const a = actual[i]!;
    const p = predicted[i]!;
    if (a !== 0 && Number.isFinite(a) && Number.isFinite(p)) {
      sum += Math.abs((a - p) / a);
      count++;
    }
  }
  return count > 0 ? (sum / count) * 100 : 0;
}

/** Compute both MAPE and RMSE for a fitted vs actual series. */
function computeAccuracy(actual: number[], fitted: number[]): { mape: number; rmse: number } {
  const len = Math.min(actual.length, fitted.length);
  let mapeSum = 0;
  let mapeCount = 0;
  let mseSum = 0;

  for (let i = 0; i < len; i++) {
    const a = actual[i]!;
    const f = fitted[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(f)) continue;
    if (a !== 0) {
      mapeSum += Math.abs((a - f) / a);
      mapeCount++;
    }
    mseSum += (a - f) ** 2;
  }

  return {
    mape: mapeCount > 0 ? (mapeSum / mapeCount) * 100 : 0,
    rmse: len > 0 ? Math.sqrt(mseSum / len) : 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
 * Automatically selects the best forecasting method based on data
 * characteristics: linear regression, Holt linear, Holt-Winters, or EWMA.
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

  // Sanitise input: replace NaN/Infinity costs with 0 so downstream math stays finite
  data = data.map((d) =>
    Number.isFinite(d.totalCost)
      ? d
      : { ...d, totalCost: 0 },
  );

  if (data.length < minDataPoints) {
    return buildEmptyForecast(data, now, forecastDays);
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

  // Confidence multiplier (approximate z-score)
  const zScore = confidenceLevel >= 0.99 ? 2.576
    : confidenceLevel >= 0.95 ? 1.96
    : confidenceLevel >= 0.90 ? 1.645
    : 1.0;

  // Extract values (already sanitised above)
  const values = data.map((d) => d.totalCost);

  // Fit advanced models (done once here; selectBestModel uses holdout portion only)
  const ewmaModel = fitEWMA(values);
  const holtWintersModel = fitHoltWinters(values, 7); // weekly seasonality

  // Select best model via holdout validation
  const modelSelection = selectBestModel(data, 7);
  const selectedMethod = modelSelection.selectedMethod;

  // Generate forecast using the selected method
  const lastX = regressionPoints[regressionPoints.length - 1]!.x;
  const forecast: ForecastPoint[] = [];

  // If HW was selected but model is null (shouldn't happen, but be safe),
  // fall back to linear regression and correct the method label.
  let actualMethod = selectedMethod;
  if (selectedMethod === "holt-winters" && !holtWintersModel) {
    actualMethod = "linear-regression";
  }
  if (selectedMethod === "ensemble" && !modelSelection.methodAccuracy["ensemble"]) {
    actualMethod = "linear-regression";
  }

  if (actualMethod === "ensemble") {
    // Weighted ensemble: combine all available model forecasts
    const accuracies = modelSelection.methodAccuracy;
    const entries = Object.entries(accuracies).filter(
      ([m, mape]) => m !== "ensemble" && Number.isFinite(mape) && mape > 0,
    );
    const inverseSum = entries.reduce((s, [, mape]) => s + 1 / mape, 0);
    const weights = new Map(entries.map(([m, mape]) => [m, (1 / mape) / inverseSum]));

    // Produce per-method full-data forecasts
    const methodForecasts: Record<string, number[]> = {};

    // Linear regression
    const lrForecasts: number[] = [];
    for (let day = 1; day <= forecastDays; day++) {
      lrForecasts.push(Math.max(0, model.slope * (lastX + day) + model.intercept));
    }
    methodForecasts["linear-regression"] = lrForecasts;

    // EWMA
    methodForecasts["ewma"] = new Array(forecastDays).fill(Math.max(0, ewmaModel.smoothedValue));

    // Holt linear (reuse the model already fit above instead of re-fitting)
    const holt = values.length >= 3 ? fitHoltLinear(values) : null;
    if (holt) {
      const hlForecasts: number[] = [];
      for (let day = 1; day <= forecastDays; day++) {
        hlForecasts.push(Math.max(0, holt.level + day * holt.trend));
      }
      methodForecasts["holt-linear"] = hlForecasts;
    }

    // Holt-Winters
    if (holtWintersModel) {
      methodForecasts["holt-winters"] = forecastHoltWinters(holtWintersModel, forecastDays);
    }

    // Compute ensemble RMSE for CI (weighted average of component RMSEs)
    let ensembleRmse = stdError; // fallback
    {
      let weightedRmse = 0;
      for (const [m, w] of weights) {
        if (m === "holt-winters" && holtWintersModel) weightedRmse += w * holtWintersModel.rmse;
        else if (m === "holt-linear" && holt) weightedRmse += w * holt.rmse;
        else weightedRmse += w * stdError;
      }
      if (weightedRmse > 0) ensembleRmse = weightedRmse;
    }

    for (let day = 1; day <= forecastDays; day++) {
      let predicted = 0;
      for (const [m, w] of weights) {
        const preds = methodForecasts[m];
        if (preds) predicted += (preds[day - 1] ?? 0) * w;
      }
      predicted = Math.round(Math.max(0, predicted) * 100) / 100;
      const errorFactor = ensembleRmse * Math.sqrt(1 + day / data.length);
      const interval = zScore * errorFactor;
      // Ensemble confidence: average of component model confidences, decay with horizon
      const baseConfidence = entries.reduce((s, [, mape]) => s + Math.max(0, 1 - mape / 100), 0) / entries.length;
      forecast.push({
        timestamp: new Date(now.getTime() + day * msPerDay).toISOString(),
        predicted,
        lowerBound: Math.max(0, Math.round((predicted - interval) * 100) / 100),
        upperBound: Math.round((predicted + interval) * 100) / 100,
        confidence: Math.max(0, Math.min(1, baseConfidence * (1 - day / (forecastDays * 3)))),
      });
    }
  } else if (actualMethod === "holt-winters" && holtWintersModel) {
    // Use Holt-Winters for seasonal-aware forecasting
    const hwForecasts = forecastHoltWinters(holtWintersModel, forecastDays);
    for (let day = 0; day < forecastDays; day++) {
      const predicted = Math.round(hwForecasts[day]! * 100) / 100;
      // Widen confidence interval based on forecast horizon and model error
      const errorFactor = holtWintersModel.rmse * Math.sqrt(1 + (day + 1) / data.length);
      const interval = zScore * errorFactor;
      forecast.push({
        timestamp: new Date(now.getTime() + (day + 1) * msPerDay).toISOString(),
        predicted,
        lowerBound: Math.max(0, Math.round((predicted - interval) * 100) / 100),
        upperBound: Math.round((predicted + interval) * 100) / 100,
        confidence: Math.max(0, Math.min(1, 1 - holtWintersModel.mape / 100)),
      });
    }
  } else if (actualMethod === "holt-linear") {
    // Use Holt's linear for trend-aware forecasting
    const holt = fitHoltLinear(values);
    for (let day = 1; day <= forecastDays; day++) {
      const predicted = Math.max(0, Math.round((holt.level + day * holt.trend) * 100) / 100);
      const errorFactor = holt.rmse * Math.sqrt(1 + day / data.length);
      const interval = zScore * errorFactor;
      forecast.push({
        timestamp: new Date(now.getTime() + day * msPerDay).toISOString(),
        predicted,
        lowerBound: Math.max(0, Math.round((predicted - interval) * 100) / 100),
        upperBound: Math.round((predicted + interval) * 100) / 100,
        confidence: Math.max(0, Math.min(1, 1 - holt.mape / 100)),
      });
    }
  } else if (actualMethod === "ewma") {
    // EWMA: flat forecast at last smoothed value with widening CI
    const predicted = Math.max(0, Math.round(ewmaModel.smoothedValue * 100) / 100);
    // Estimate variance from residuals for confidence interval
    let residualVar = 0;
    for (let i = 0; i < values.length; i++) {
      residualVar += (values[i]! - (ewmaModel.smoothedSeries[i] ?? values[i]!)) ** 2;
    }
    residualVar = values.length > 1 ? residualVar / (values.length - 1) : 0;
    const residualStd = Math.sqrt(residualVar);

    for (let day = 1; day <= forecastDays; day++) {
      // SES h-step prediction interval: σ² × [1 + (h-1)α²]
      const interval = zScore * residualStd * Math.sqrt(1 + (day - 1) * ewmaModel.alpha * ewmaModel.alpha);
      forecast.push({
        timestamp: new Date(now.getTime() + day * msPerDay).toISOString(),
        predicted,
        lowerBound: Math.max(0, Math.round((predicted - interval) * 100) / 100),
        upperBound: Math.round((predicted + interval) * 100) / 100,
        confidence: Math.max(0, Math.min(1, 1 - (day / forecastDays) * 0.3)),
      });
    }
  } else {
    // Fall back to linear regression (original method)
    for (let day = 1; day <= forecastDays; day++) {
      const futureX = lastX + day;
      const predicted = Math.max(0, model.slope * futureX + model.intercept);
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
  }

  // Build summary
  const currentCost = data[data.length - 1]!.totalCost;
  const currentNodes = data[data.length - 1]!.nodeCount;
  const predicted30 = forecast[Math.min(29, forecast.length - 1)]?.predicted ?? currentCost;
  const predicted90 = forecast[forecast.length - 1]?.predicted ?? currentCost;

  // Daily slope → monthly rate
  const monthlyRate = model.slope * 30;
  // Minimum absolute threshold prevents degenerate classification when cost ≈ 0
  const trendThreshold = Math.max(currentCost * 0.02, 1.0);
  const costTrend: CostForecastSummary["costTrend"] =
    monthlyRate > trendThreshold ? "increasing"
    : monthlyRate < -trendThreshold ? "decreasing"
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
    holtWintersModel: holtWintersModel ?? undefined,
    ewmaModel,
    forecastMethod: actualMethod,
    modelSelection,
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

function buildEmptyForecast(data: CostDataPoint[], now: Date, forecastDays = 90): CostForecast {
  const currentCost = data.length > 0 ? data[data.length - 1]!.totalCost : 0;
  const msPerDay = 24 * 60 * 60 * 1000;

  // Generate flat forecast at current cost so consumers never face an empty array
  const forecast: ForecastPoint[] = [];
  for (let day = 1; day <= forecastDays; day++) {
    forecast.push({
      timestamp: new Date(now.getTime() + day * msPerDay).toISOString(),
      predicted: currentCost,
      lowerBound: Math.max(0, currentCost),
      upperBound: currentCost,
      confidence: 0, // zero confidence — insufficient data
    });
  }

  return {
    generatedAt: now.toISOString(),
    historicalData: data,
    model: { slope: 0, intercept: currentCost, rSquared: 0, dataPoints: data.length },
    forecastMethod: "linear-regression",
    forecast,
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
    `Forecast method: ${forecast.forecastMethod}`,
    `Model R²: ${forecast.model.rSquared.toFixed(3)}`,
    "",
  ];

  // Model selection details
  if (forecast.modelSelection) {
    lines.push(
      "## Model Selection",
      "",
      `**Selected:** ${forecast.modelSelection.selectedMethod}`,
      `**Reason:** ${forecast.modelSelection.reason}`,
      "",
      "| Method | MAPE (%) |",
      "|--------|----------|",
      ...Object.entries(forecast.modelSelection.methodAccuracy)
        .sort((a, b) => a[1] - b[1])
        .map(([m, mape]) => `| ${m}${m === forecast.forecastMethod ? " ✓" : ""} | ${mape.toFixed(1)}% |`),
      "",
    );
  }

  // Holt-Winters parameters
  if (forecast.holtWintersModel) {
    const hw = forecast.holtWintersModel;
    lines.push(
      "## Holt-Winters Model",
      "",
      `| Parameter | Value |`,
      `|-----------|-------|`,
      `| α (level) | ${hw.alpha.toFixed(2)} |`,
      `| β (trend) | ${hw.beta.toFixed(3)} |`,
      `| γ (seasonal) | ${hw.gamma.toFixed(2)} |`,
      `| Seasonal Period | ${hw.seasonalPeriod} days |`,
      `| In-sample MAPE | ${hw.mape.toFixed(1)}% |`,
      `| In-sample RMSE | $${hw.rmse.toFixed(2)} |`,
      "",
    );
  }

  lines.push(
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
  );

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
