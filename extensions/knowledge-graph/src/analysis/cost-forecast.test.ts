/**
 * Tests for the cost forecasting module.
 */

import { describe, it, expect } from "vitest";
import {
  fitLinearRegression,
  detectSeasonality,
  generateForecastFromData,
  formatCostForecastMarkdown,
} from "./cost-forecast.js";
import type { CostDataPoint, CostForecast } from "./cost-forecast.js";

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

    it("returns empty forecast for insufficient data", () => {
      const data = generateLinearData(1, 100, 1);
      const forecast = generateForecastFromData(data, { minDataPoints: 3 });
      expect(forecast.forecast).toHaveLength(0);
    });
  });

  describe("formatCostForecastMarkdown", () => {
    it("renders markdown for a forecast", () => {
      const forecast: CostForecast = {
        generatedAt: new Date().toISOString(),
        historicalData: generateLinearData(30, 100, 2),
        model: { slope: 2, intercept: 100, rSquared: 0.95, dataPoints: 30 },
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
  });
});
