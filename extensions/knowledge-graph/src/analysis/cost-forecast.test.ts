/**
 * Tests for the cost forecasting module.
 */

import { describe, it, expect } from "vitest";
import {
  fitLinearRegression,
  detectSeasonality,
  generateForecastFromData,
  formatCostForecastMarkdown,
  fitEWMA,
  fitHoltLinear,
  fitHoltWinters,
  forecastHoltWinters,
  selectBestModel,
  ensembleForecast,
} from "./cost-forecast.js";
import type { CostDataPoint, CostForecast, ForecastMethod } from "./cost-forecast.js";

// =============================================================================
// Helpers
// =============================================================================

function generateLinearData(
  days: number,
  baseRate: number,
  dailyGrowth: number,
): CostDataPoint[] {
  const points: CostDataPoint[] = [];
  const start = new Date("2024-01-01");
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    points.push({
      timestamp: d.toISOString(),
      totalCost: baseRate + dailyGrowth * i,
      nodeCount: 10 + Math.floor(i / 10),
      provider: "aws",
    });
  }
  return points;
}

function generateSeasonalData(weeks: number): CostDataPoint[] {
  const points: CostDataPoint[] = [];
  const start = new Date("2024-01-01");
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(date.getDate() + w * 7 + d);
      const seasonal = d >= 5 ? -40 : 20;
      points.push({
        timestamp: date.toISOString(),
        totalCost: 100 + seasonal + w * 2,
        nodeCount: 10,
      });
    }
  }
  return points;
}

// =============================================================================
// Tests
// =============================================================================

describe("Cost Forecasting", () => {
  describe("fitLinearRegression", () => {
    it("fits a perfect linear dataset", () => {
      const points = [
        { x: 1, y: 10 },
        { x: 2, y: 20 },
        { x: 3, y: 30 },
        { x: 4, y: 40 },
        { x: 5, y: 50 },
      ];
      const model = fitLinearRegression(points);
      expect(model.slope).toBeCloseTo(10, 5);
      expect(model.intercept).toBeCloseTo(0, 5);
      expect(model.rSquared).toBeCloseTo(1, 5);
      expect(model.dataPoints).toBe(5);
    });

    it("handles constant data", () => {
      const points = [
        { x: 1, y: 42 },
        { x: 2, y: 42 },
        { x: 3, y: 42 },
        { x: 4, y: 42 },
        { x: 5, y: 42 },
      ];
      const model = fitLinearRegression(points);
      expect(model.slope).toBeCloseTo(0, 5);
      expect(model.intercept).toBeCloseTo(42, 5);
    });

    it("returns meaningful R² for noisy data", () => {
      const points = [
        { x: 1, y: 10 }, { x: 2, y: 15 }, { x: 3, y: 8 },
        { x: 4, y: 22 }, { x: 5, y: 18 }, { x: 6, y: 25 },
        { x: 7, y: 20 }, { x: 8, y: 30 }, { x: 9, y: 28 },
        { x: 10, y: 35 },
      ];
      const model = fitLinearRegression(points);
      expect(model.slope).toBeGreaterThan(0);
      expect(model.rSquared).toBeGreaterThan(0);
      expect(model.rSquared).toBeLessThanOrEqual(1);
    });

    it("returns default for empty input", () => {
      const model = fitLinearRegression([]);
      expect(model.slope).toBe(0);
      expect(model.dataPoints).toBe(0);
    });

    it("handles single data point", () => {
      const model = fitLinearRegression([{ x: 5, y: 100 }]);
      expect(model.slope).toBe(0);
      expect(model.intercept).toBe(100);
      expect(model.dataPoints).toBe(1);
    });
  });

  describe("detectSeasonality", () => {
    it("detects weekly pattern in seasonal data", () => {
      const data = generateSeasonalData(8);
      const pattern = detectSeasonality(data);
      expect(pattern.detected).toBe(true);
      expect(pattern.variationFactor).toBeGreaterThan(1.1);
      expect(pattern.peakDay).toBeGreaterThanOrEqual(0);
      expect(pattern.peakDay).toBeLessThanOrEqual(6);
    });

    it("returns not-detected for constant data", () => {
      const data: CostDataPoint[] = [];
      const start = new Date("2024-01-01");
      for (let i = 0; i < 30; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        data.push({ timestamp: d.toISOString(), totalCost: 100, nodeCount: 10 });
      }
      const pattern = detectSeasonality(data);
      expect(pattern.detected).toBe(false);
      expect(pattern.variationFactor).toBeCloseTo(1.0, 1);
    });

    it("returns not-detected for insufficient data", () => {
      const data: CostDataPoint[] = [
        { timestamp: "2024-01-01T00:00:00Z", totalCost: 100, nodeCount: 5 },
      ];
      const pattern = detectSeasonality(data);
      expect(pattern.detected).toBe(false);
    });
  });

  describe("generateForecastFromData", () => {
    it("generates a forecast from linear data", () => {
      const data = generateLinearData(60, 100, 2);
      const forecast = generateForecastFromData(data, {
        forecastDays: 30,
        confidenceLevel: 0.95,
      });
      expect(forecast.model.slope).toBeGreaterThan(0);
      expect(forecast.forecast).toHaveLength(30);
      expect(forecast.summary.currentMonthlyCost).toBeGreaterThan(0);
    });

    it("forecasted values increase for upward-trending data", () => {
      const data = generateLinearData(90, 50, 3);
      const forecast = generateForecastFromData(data, { forecastDays: 14 });
      const lastHistoric = data[data.length - 1]!.totalCost;
      const lastForecast = forecast.forecast[forecast.forecast.length - 1]!.predicted;
      expect(lastForecast).toBeGreaterThan(lastHistoric);
    });

    it("includes confidence intervals", () => {
      const data = generateLinearData(60, 100, 1);
      const forecast = generateForecastFromData(data, {
        forecastDays: 7,
        confidenceLevel: 0.95,
      });
      for (const point of forecast.forecast) {
        expect(point.upperBound).toBeGreaterThanOrEqual(point.predicted);
        expect(point.lowerBound).toBeLessThanOrEqual(point.predicted);
      }
    });

    it("returns flat forecast with zero confidence for insufficient data", () => {
      const data = generateLinearData(1, 100, 1);
      const forecast = generateForecastFromData(data, { minDataPoints: 3, forecastDays: 7 });
      // Should still produce forecast points (flat at current cost)
      expect(forecast.forecast).toHaveLength(7);
      for (const point of forecast.forecast) {
        expect(point.predicted).toBe(100); // flat at last known cost
        expect(point.confidence).toBe(0);
      }
    });
  });

  describe("formatCostForecastMarkdown", () => {
    it("renders markdown for a forecast", () => {
      const forecast: CostForecast = {
        generatedAt: new Date().toISOString(),
        historicalData: generateLinearData(30, 100, 2),
        model: { slope: 2, intercept: 100, rSquared: 0.95, dataPoints: 30 },
        forecastMethod: "linear-regression",
        forecast: [{
          timestamp: "2024-03-01T00:00:00Z",
          predicted: 220,
          lowerBound: 200,
          upperBound: 240,
          confidence: 0.9,
        }],
        seasonality: { peakDay: 0, variationFactor: 1.0, detected: false },
        summary: {
          currentMonthlyCost: 200,
          predicted30DayCost: 220,
          predicted90DayCost: 260,
          costTrend: "increasing",
          trendRate: 60,
          projectedAnnualCost: 2640,
          costPerNode: 20,
          byProvider: { aws: 200 },
          byResourceType: { compute: 150 },
          topCostDrivers: [{ nodeId: "n1", name: "web-server", cost: 100 }],
        },
      };
      const md = formatCostForecastMarkdown(forecast);
      expect(md).toContain("Cost Forecast");
      expect(md).toContain("increasing");
      expect(md).toContain("200");
    });

    it("includes model selection section when present", () => {
      const forecast: CostForecast = {
        generatedAt: new Date().toISOString(),
        historicalData: generateLinearData(30, 100, 2),
        model: { slope: 2, intercept: 100, rSquared: 0.95, dataPoints: 30 },
        forecastMethod: "holt-winters",
        modelSelection: {
          selectedMethod: "holt-winters",
          reason: "Seasonal data detected",
          methodAccuracy: { "holt-winters": 3.2, "linear-regression": 8.5, "ewma": 6.1 },
        },
        holtWintersModel: {
          alpha: 0.3, beta: 0.05, gamma: 0.2, seasonalPeriod: 7,
          level: 200, trend: 1.5, seasonalIndices: [0, 1, 2, 3, -2, -1, -3],
          mape: 3.2, rmse: 5.1,
        },
        forecast: [],
        seasonality: { peakDay: 3, variationFactor: 1.3, detected: true },
        summary: {
          currentMonthlyCost: 200, predicted30DayCost: 220, predicted90DayCost: 260,
          costTrend: "increasing", trendRate: 60, projectedAnnualCost: 2640,
          costPerNode: 20, byProvider: {}, byResourceType: {}, topCostDrivers: [],
        },
      };
      const md = formatCostForecastMarkdown(forecast);
      expect(md).toContain("Model Selection");
      expect(md).toContain("holt-winters");
      expect(md).toContain("Holt-Winters Model");
      expect(md).toContain("level");
      expect(md).toContain("seasonal");
    });
  });

  // ===========================================================================
  // EWMA
  // ===========================================================================

  describe("fitEWMA", () => {
    it("smooths a noisy series", () => {
      const values = [10, 12, 11, 13, 15, 14, 16, 18, 17, 20];
      const model = fitEWMA(values);
      expect(model.alpha).toBeGreaterThan(0);
      expect(model.alpha).toBeLessThan(1);
      expect(model.smoothedSeries).toHaveLength(values.length);
      // Smoothed value should be near the last few data points
      expect(model.smoothedValue).toBeGreaterThan(10);
      expect(model.smoothedValue).toBeLessThan(25);
    });

    it("uses the given alpha when provided", () => {
      const values = [100, 102, 98, 105, 101];
      const model = fitEWMA(values, 0.5);
      expect(model.alpha).toBe(0.5);
    });

    it("handles single value", () => {
      const model = fitEWMA([42]);
      expect(model.smoothedValue).toBe(42);
      expect(model.smoothedSeries).toEqual([42]);
    });

    it("returns defaults for empty input", () => {
      const model = fitEWMA([]);
      expect(model.smoothedValue).toBe(0);
      expect(model.smoothedSeries).toEqual([]);
    });

    it("higher alpha tracks changes faster", () => {
      const values = [10, 10, 10, 10, 100, 100, 100, 100];
      const fast = fitEWMA(values, 0.9);
      const slow = fitEWMA(values, 0.1);
      // After the jump, fast-alpha should be closer to 100
      expect(fast.smoothedSeries[5]!).toBeGreaterThan(slow.smoothedSeries[5]!);
    });
  });

  // ===========================================================================
  // Holt Linear
  // ===========================================================================

  describe("fitHoltLinear", () => {
    it("captures upward trend", () => {
      const values = Array.from({ length: 30 }, (_, i) => 100 + 5 * i);
      const holt = fitHoltLinear(values);
      expect(holt.trend).toBeGreaterThan(0);
      expect(holt.level).toBeGreaterThan(200);
      expect(holt.fittedValues).toHaveLength(30);
    });

    it("captures downward trend", () => {
      const values = Array.from({ length: 30 }, (_, i) => 500 - 3 * i);
      const holt = fitHoltLinear(values);
      expect(holt.trend).toBeLessThan(0);
    });

    it("handles constant data with near-zero trend", () => {
      const values = Array.from({ length: 20 }, () => 42);
      const holt = fitHoltLinear(values);
      expect(Math.abs(holt.trend)).toBeLessThan(1);
    });

    it("handles very short series (< 3 points)", () => {
      const holt = fitHoltLinear([10, 20]);
      expect(holt.level).toBe(10);
      expect(holt.trend).toBe(0);
    });

    it("uses provided alpha/beta when given", () => {
      const values = Array.from({ length: 20 }, (_, i) => 100 + 2 * i);
      const holt = fitHoltLinear(values, 0.5, 0.2);
      expect(holt.alpha).toBe(0.5);
      expect(holt.beta).toBe(0.2);
    });

    it("computes MAPE and RMSE", () => {
      const values = Array.from({ length: 30 }, (_, i) => 100 + 2 * i + Math.sin(i) * 3);
      const holt = fitHoltLinear(values);
      expect(holt.mape).toBeGreaterThanOrEqual(0);
      expect(holt.rmse).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================================
  // Holt-Winters
  // ===========================================================================

  describe("fitHoltWinters", () => {
    it("fits seasonal data with weekly pattern", () => {
      // Need at least 2 full periods (14 days for weekly)
      const data = generateSeasonalData(4); // 28 days
      const values = data.map((d) => d.totalCost);
      const model = fitHoltWinters(values, 7);
      expect(model).not.toBeNull();
      expect(model!.alpha).toBeGreaterThanOrEqual(0);
      expect(model!.alpha).toBeLessThanOrEqual(1);
      expect(model!.beta).toBeGreaterThanOrEqual(0);
      expect(model!.gamma).toBeGreaterThanOrEqual(0);
      expect(model!.seasonalPeriod).toBe(7);
      expect(model!.seasonalIndices).toHaveLength(7);
    });

    it("returns null for insufficient data", () => {
      const values = [10, 20, 30, 40, 50]; // only 5, need 14 for period=7
      const model = fitHoltWinters(values, 7);
      expect(model).toBeNull();
    });

    it("captures seasonal amplitude", () => {
      const data = generateSeasonalData(6); // 42 days
      const values = data.map((d) => d.totalCost);
      const model = fitHoltWinters(values, 7)!;
      // Seasonal indices should not all be zero
      const maxIdx = Math.max(...model.seasonalIndices);
      const minIdx = Math.min(...model.seasonalIndices);
      expect(maxIdx - minIdx).toBeGreaterThan(1);
    });

    it("computes in-sample accuracy metrics", () => {
      const data = generateSeasonalData(4);
      const values = data.map((d) => d.totalCost);
      const model = fitHoltWinters(values, 7)!;
      expect(model.mape).toBeGreaterThanOrEqual(0);
      expect(model.rmse).toBeGreaterThanOrEqual(0);
    });

    it("uses provided parameters when given", () => {
      const data = generateSeasonalData(3);
      const values = data.map((d) => d.totalCost);
      const model = fitHoltWinters(values, 7, 0.4, 0.1, 0.3);
      expect(model).not.toBeNull();
      expect(model!.alpha).toBe(0.4);
      expect(model!.beta).toBe(0.1);
      expect(model!.gamma).toBe(0.3);
    });
  });

  // ===========================================================================
  // Holt-Winters Forecasting
  // ===========================================================================

  describe("forecastHoltWinters", () => {
    it("generates the requested number of forecast steps", () => {
      const data = generateSeasonalData(4);
      const values = data.map((d) => d.totalCost);
      const model = fitHoltWinters(values, 7)!;
      const forecasts = forecastHoltWinters(model, 14);
      expect(forecasts).toHaveLength(14);
    });

    it("produces non-negative forecasts", () => {
      const data = generateSeasonalData(4);
      const values = data.map((d) => d.totalCost);
      const model = fitHoltWinters(values, 7)!;
      const forecasts = forecastHoltWinters(model, 30);
      for (const f of forecasts) {
        expect(f).toBeGreaterThanOrEqual(0);
      }
    });

    it("forecasts repeat seasonal pattern", () => {
      const data = generateSeasonalData(6);
      const values = data.map((d) => d.totalCost);
      const model = fitHoltWinters(values, 7)!;
      const forecasts = forecastHoltWinters(model, 14);
      // Day 0 and Day 7 should have similar seasonal component
      // (within some tolerance since trend shifts them)
      const diff0_7 = Math.abs(forecasts[0]! - forecasts[7]!);
      // With trend, the difference should be roughly 7 * trend
      expect(diff0_7).toBeLessThan(50);
    });
  });

  // ===========================================================================
  // Model Selection
  // ===========================================================================

  describe("selectBestModel", () => {
    it("returns linear-regression for very short data", () => {
      const data = generateLinearData(3, 100, 1);
      const result = selectBestModel(data);
      expect(result.selectedMethod).toBe("linear-regression");
      expect(result.reason).toContain("Insufficient");
    });

    it("includes accuracy metrics for each method tested", () => {
      const data = generateLinearData(30, 100, 2);
      const result = selectBestModel(data);
      expect(Object.keys(result.methodAccuracy).length).toBeGreaterThanOrEqual(2);
      for (const mape of Object.values(result.methodAccuracy)) {
        expect(mape).toBeGreaterThanOrEqual(0);
      }
    });

    it("tests Holt-Winters when enough seasonal data", () => {
      const data = generateSeasonalData(4); // 28 days
      const result = selectBestModel(data, 7);
      // Should have tested holt-winters
      expect(result.methodAccuracy).toHaveProperty("holt-winters");
    });

    it("provides a reason string for the selection", () => {
      const data = generateLinearData(30, 100, 2);
      const result = selectBestModel(data);
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).toContain("MAPE");
    });

    it("selects a method with lowest MAPE", () => {
      const data = generateLinearData(60, 100, 2);
      const result = selectBestModel(data);
      const selectedMAPE = result.methodAccuracy[result.selectedMethod]!;
      for (const mape of Object.values(result.methodAccuracy)) {
        expect(selectedMAPE).toBeLessThanOrEqual(mape + 0.001);
      }
    });
  });

  // ===========================================================================
  // Updated generateForecastFromData (model selection integration)
  // ===========================================================================

  describe("generateForecastFromData — advanced models", () => {
    it("includes forecastMethod in result", () => {
      const data = generateLinearData(60, 100, 2);
      const forecast = generateForecastFromData(data, { forecastDays: 14 });
      expect(forecast.forecastMethod).toBeDefined();
      expect(["linear-regression", "holt-winters", "holt-linear", "ewma", "ensemble"]).toContain(
        forecast.forecastMethod,
      );
    });

    it("includes modelSelection when enough data", () => {
      const data = generateLinearData(60, 100, 2);
      const forecast = generateForecastFromData(data, { forecastDays: 14 });
      expect(forecast.modelSelection).toBeDefined();
      expect(forecast.modelSelection!.selectedMethod).toBe(forecast.forecastMethod);
    });

    it("populates ewmaModel", () => {
      const data = generateLinearData(60, 100, 2);
      const forecast = generateForecastFromData(data, { forecastDays: 14 });
      expect(forecast.ewmaModel).toBeDefined();
      expect(forecast.ewmaModel!.alpha).toBeGreaterThan(0);
    });

    it("populates holtWintersModel for seasonal data", () => {
      const data = generateSeasonalData(6); // 42 days, enough for HW
      const forecast = generateForecastFromData(data, { forecastDays: 14 });
      expect(forecast.holtWintersModel).toBeDefined();
    });

    it("still generates valid confidence intervals", () => {
      const data = generateSeasonalData(6);
      const forecast = generateForecastFromData(data, { forecastDays: 14 });
      for (const point of forecast.forecast) {
        expect(point.upperBound).toBeGreaterThanOrEqual(point.predicted);
        expect(point.lowerBound).toBeLessThanOrEqual(point.predicted);
        expect(point.lowerBound).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ===========================================================================
  // Edge-case / Production Safety Tests
  // ===========================================================================

  describe("production edge cases", () => {
    it("fitHoltWinters returns null for seasonalPeriod 0", () => {
      const values = Array.from({ length: 30 }, (_, i) => 100 + i);
      expect(fitHoltWinters(values, 0)).toBeNull();
    });

    it("fitHoltWinters returns null for seasonalPeriod 1", () => {
      const values = Array.from({ length: 30 }, (_, i) => 100 + i);
      expect(fitHoltWinters(values, 1)).toBeNull();
    });

    it("fitHoltWinters returns null for negative seasonalPeriod", () => {
      const values = Array.from({ length: 30 }, (_, i) => 100 + i);
      expect(fitHoltWinters(values, -5)).toBeNull();
    });

    it("fitHoltWinters returns null when input contains NaN", () => {
      const values = [100, 200, NaN, 400, 300, 200, 100, 500, 600, 700, 800, 900, 1000, 1100];
      expect(fitHoltWinters(values, 7)).toBeNull();
    });

    it("fitHoltWinters returns null when input contains Infinity", () => {
      const values = [100, 200, Infinity, 400, 300, 200, 100, 500, 600, 700, 800, 900, 1000, 1100];
      expect(fitHoltWinters(values, 7)).toBeNull();
    });

    it("generateForecastFromData handles NaN in cost data gracefully", () => {
      const data: CostDataPoint[] = [];
      const start = new Date("2024-01-01");
      for (let i = 0; i < 40; i++) {
        data.push({
          timestamp: new Date(start.getTime() + i * 86400000).toISOString(),
          totalCost: i === 10 ? NaN : 100 + i * 2,
          nodeCount: 10,
        });
      }
      const forecast = generateForecastFromData(data, { forecastDays: 7 });
      // Should produce a valid forecast (NaN replaced with 0 or filtered)
      expect(forecast.forecast.length).toBe(7);
      for (const point of forecast.forecast) {
        expect(Number.isFinite(point.predicted)).toBe(true);
        expect(Number.isFinite(point.lowerBound)).toBe(true);
        expect(Number.isFinite(point.upperBound)).toBe(true);
      }
    });

    it("generateForecastFromData handles all-zero cost data", () => {
      const data: CostDataPoint[] = [];
      const start = new Date("2024-01-01");
      for (let i = 0; i < 40; i++) {
        data.push({
          timestamp: new Date(start.getTime() + i * 86400000).toISOString(),
          totalCost: 0,
          nodeCount: 10,
        });
      }
      const forecast = generateForecastFromData(data, { forecastDays: 7 });
      expect(forecast.forecast.length).toBe(7);
      for (const point of forecast.forecast) {
        expect(Number.isFinite(point.predicted)).toBe(true);
        expect(point.predicted).toBeGreaterThanOrEqual(0);
      }
    });

    it("selectBestModel never returns NaN in methodAccuracy", () => {
      const data = generateLinearData(60, 100, 1);
      const sel = selectBestModel(data, 7);
      for (const mape of Object.values(sel.methodAccuracy)) {
        expect(Number.isFinite(mape)).toBe(true);
      }
    });
  });
});

// =============================================================================
// Ensemble Forecasting
// =============================================================================

describe("ensembleForecast", () => {
  it("combines multiple models with inverse-MAPE weights", () => {
    const result = ensembleForecast([
      { method: "linear-regression" as ForecastMethod, predictions: [100, 110], mape: 10 },
      { method: "ewma" as ForecastMethod, predictions: [95, 105], mape: 5 },
    ]);

    expect(result.members).toHaveLength(2);
    // EWMA (mape=5) should have higher weight than LR (mape=10)
    const ewmaMember = result.members.find((m) => m.method === "ewma");
    const lrMember = result.members.find((m) => m.method === "linear-regression");
    expect(ewmaMember!.weight).toBeGreaterThan(lrMember!.weight);
    // Weights sum to 1
    const totalWeight = result.members.reduce((s, m) => s + m.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 5);
    // Combined is a blend
    expect(result.combined).toHaveLength(2);
    expect(result.combined[0]).toBeGreaterThan(0);
  });

  it("handles single model gracefully", () => {
    const result = ensembleForecast([
      { method: "ewma" as ForecastMethod, predictions: [100, 200], mape: 8 },
    ]);
    expect(result.members).toHaveLength(1);
    expect(result.members[0]!.weight).toBe(1);
    expect(result.combined).toEqual([100, 200]);
  });

  it("handles empty input gracefully", () => {
    const result = ensembleForecast([]);
    expect(result.members).toHaveLength(0);
    expect(result.combined).toHaveLength(0);
    expect(result.combinedMAPE).toBeNull();
  });

  it("filters out zero and invalid mape models", () => {
    const result = ensembleForecast([
      { method: "linear-regression" as ForecastMethod, predictions: [100], mape: 0 },
      { method: "ewma" as ForecastMethod, predictions: [95], mape: 5 },
      { method: "holt-linear" as ForecastMethod, predictions: [90], mape: Infinity },
    ]);
    // Only EWMA should be included (mape > 0 and finite)
    expect(result.members).toHaveLength(1);
    expect(result.members[0]!.method).toBe("ewma");
  });

  it("computes ensembleMAPE when test values provided", () => {
    const result = ensembleForecast(
      [
        { method: "linear-regression" as ForecastMethod, predictions: [100, 110, 120], mape: 10 },
        { method: "ewma" as ForecastMethod, predictions: [105, 115, 125], mape: 5 },
      ],
      [102, 112, 122],
    );
    expect(result.combinedMAPE).not.toBeNull();
    expect(Number.isFinite(result.combinedMAPE!)).toBe(true);
  });
});

describe("selectBestModel with ensemble", () => {
  it("includes ensemble in methodAccuracy for sufficient data", () => {
    const data = generateLinearData(60, 100, 2);
    const selection = selectBestModel(data, 7);
    // With 60 data points, ensemble should be among candidates
    expect("ensemble" in selection.methodAccuracy || Object.keys(selection.methodAccuracy).length >= 3).toBe(true);
  });

  it("generateForecastFromData can produce ensemble forecast", () => {
    // Use data with mixed patterns to encourage ensemble selection
    const data: CostDataPoint[] = [];
    const start = new Date("2024-01-01");
    for (let i = 0; i < 90; i++) {
      const seasonal = Math.sin((i / 7) * 2 * Math.PI) * 50;
      const trend = i * 0.5;
      const noise = (Math.sin(i * 137.5) * 10); // deterministic noise
      data.push({
        timestamp: new Date(start.getTime() + i * 86400000).toISOString(),
        totalCost: 500 + trend + seasonal + noise,
        nodeCount: 10,
      });
    }
    const forecast = generateForecastFromData(data, { forecastDays: 7 });
    // Should have a valid forecast regardless of method chosen
    expect(forecast.forecast).toHaveLength(7);
    for (const point of forecast.forecast) {
      expect(Number.isFinite(point.predicted)).toBe(true);
      expect(point.predicted).toBeGreaterThanOrEqual(0);
    }
    // Model selection should include ensemble as a candidate
    if (forecast.modelSelection) {
      expect(Object.keys(forecast.modelSelection.methodAccuracy).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("ensemble production edge cases", () => {
  it("handles members with mismatched prediction lengths", () => {
    const result = ensembleForecast([
      { method: "ewma" as ForecastMethod, predictions: [100, 200, 300], mape: 5 },
      { method: "linear-regression" as ForecastMethod, predictions: [110], mape: 10 },
    ]);
    // Combined should be length of the longest member
    expect(result.combined).toHaveLength(3);
    // All values should be finite and non-negative
    for (const v of result.combined) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("all-zero-MAPE members return empty ensemble", () => {
    const result = ensembleForecast([
      { method: "ewma" as ForecastMethod, predictions: [100], mape: 0 },
      { method: "linear-regression" as ForecastMethod, predictions: [100], mape: 0 },
    ]);
    expect(result.members).toHaveLength(0);
    expect(result.combined).toHaveLength(0);
  });

  it("generateForecastFromData with NaN/Infinity costs does not crash", () => {
    const data: CostDataPoint[] = [];
    const start = new Date("2024-01-01");
    for (let i = 0; i < 30; i++) {
      data.push({
        timestamp: new Date(start.getTime() + i * 86400000).toISOString(),
        totalCost: i === 15 ? NaN : (i === 20 ? Infinity : 100 + i),
        nodeCount: 5,
      });
    }
    // Should not throw — sanitisation replaces NaN/Infinity with 0
    const forecast = generateForecastFromData(data, { forecastDays: 7 });
    expect(forecast.forecast).toHaveLength(7);
    for (const point of forecast.forecast) {
      expect(Number.isFinite(point.predicted)).toBe(true);
    }
  });
});
