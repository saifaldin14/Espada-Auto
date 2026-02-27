/**
 * Tests for the graph anomaly detection module.
 *
 * Since detectAnomalies requires TemporalGraphStorage, we test the
 * standalone statistical functions directly and verify the report
 * formatter.
 */

import { describe, it, expect } from "vitest";
import {
  computeBaseline,
  zScore,
  rollingAverage,
  formatAnomalyReportMarkdown,
  detectAnomaliesFromGraph,
} from "./anomaly-detection.js";
import type { AnomalyReport, MetricBaseline, GraphAnomaly } from "./anomaly-detection.js";

// =============================================================================
// Tests
// =============================================================================

describe("Anomaly Detection", () => {
  describe("computeBaseline", () => {
    it("computes mean, stdDev, median for a known dataset", () => {
      const values = [10, 20, 30, 40, 50];
      const b = computeBaseline(values);
      expect(b.mean).toBeCloseTo(30, 5);
      expect(b.median).toBe(30);
      expect(b.min).toBe(10);
      expect(b.max).toBe(50);
      expect(b.count).toBe(5);
      expect(b.stdDev).toBeGreaterThan(0);
    });

    it("handles single-element array", () => {
      const b = computeBaseline([42]);
      expect(b.mean).toBe(42);
      expect(b.median).toBe(42);
      expect(b.stdDev).toBe(0);
      expect(b.count).toBe(1);
    });

    it("handles empty array", () => {
      const b = computeBaseline([]);
      expect(b.count).toBe(0);
      expect(b.mean).toBe(0);
    });

    it("computes IQR correctly", () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const b = computeBaseline(values);
      expect(b.q1).toBeDefined();
      expect(b.q3).toBeDefined();
      expect(b.iqr).toBe(b.q3 - b.q1);
    });
  });

  describe("zScore", () => {
    it("returns 0 for value at mean", () => {
      const b = computeBaseline([10, 20, 30, 40, 50]);
      const z = zScore(b.mean, b);
      expect(z).toBeCloseTo(0, 5);
    });

    it("returns positive z-score for value above mean", () => {
      const b = computeBaseline([10, 20, 30, 40, 50]);
      const z = zScore(100, b);
      expect(z).toBeGreaterThan(0);
    });

    it("returns negative z-score for value below mean", () => {
      const b = computeBaseline([10, 20, 30, 40, 50]);
      const z = zScore(-50, b);
      expect(z).toBeLessThan(0);
    });

    it("returns 0 when stdDev is 0", () => {
      const b = computeBaseline([5, 5, 5, 5]);
      const z = zScore(5, b);
      expect(z).toBe(0);
    });
  });

  describe("rollingAverage", () => {
    it("computes rolling average with window 3", () => {
      const values = [10, 20, 30, 40, 50];
      const result = rollingAverage(values, 3);
      // Implementation returns same-length array, padding early values
      expect(result).toHaveLength(5);
      // Last 3 values should be full-window averages
      expect(result[2]).toBeCloseTo(20, 5);  // (10+20+30)/3
      expect(result[3]).toBeCloseTo(30, 5);  // (20+30+40)/3
      expect(result[4]).toBeCloseTo(40, 5);  // (30+40+50)/3
    });

    it("returns same-length array even when window > data", () => {
      const result = rollingAverage([1, 2], 5);
      // Implementation still returns values (partial windows)
      expect(result).toHaveLength(2);
    });

    it("returns same values for window of 1", () => {
      const values = [10, 20, 30];
      const result = rollingAverage(values, 1);
      expect(result).toEqual(values);
    });
  });

  describe("formatAnomalyReportMarkdown", () => {
    it("renders a report with anomalies", () => {
      const anomaly: GraphAnomaly = {
        id: "a1",
        type: "cost-spike",
        severity: "high",
        description: "Cost spike: $500 (expected ~$100)",
        detectedAt: "2024-01-15T00:00:00Z",
        snapshotId: "snap-5",
        actualValue: 500,
        expectedValue: 100,
        zScore: 3.2,
        affectedResources: ["node-1"],
        metadata: {},
      };

      const report: AnomalyReport = {
        generatedAt: new Date().toISOString(),
        snapshotsAnalyzed: 20,
        anomalies: [anomaly],
        baselines: {
          nodeCount: computeBaseline([10, 11, 12, 10, 11]),
          edgeCount: computeBaseline([5, 6, 5, 5, 6]),
          totalCost: computeBaseline([100, 110, 105, 100, 500]),
        },
        summary: {
          totalAnomalies: 1,
          bySeverity: { high: 1 },
          byType: { "cost-spike": 1 },
        },
      };

      const md = formatAnomalyReportMarkdown(report);
      expect(md).toContain("Anomaly");
      expect(md).toContain("cost-spike");
      expect(md).toContain("high");
    });

    it("renders an empty report", () => {
      const report: AnomalyReport = {
        generatedAt: new Date().toISOString(),
        snapshotsAnalyzed: 3,
        anomalies: [],
        baselines: {
          nodeCount: computeBaseline([10, 11, 12]),
          edgeCount: computeBaseline([5, 6, 5]),
          totalCost: computeBaseline([100, 110, 105]),
        },
        summary: {
          totalAnomalies: 0,
          bySeverity: {},
          byType: {},
        },
      };

      const md = formatAnomalyReportMarkdown(report);
      expect(md).toContain("Anomaly");
      expect(md).toContain("0");
    });

    it("renders cost trend when present", () => {
      const report: AnomalyReport = {
        generatedAt: new Date().toISOString(),
        snapshotsAnalyzed: 5,
        anomalies: [],
        baselines: {
          nodeCount: computeBaseline([10, 11, 12, 10, 11]),
          edgeCount: computeBaseline([5, 6, 5, 5, 6]),
          totalCost: computeBaseline([100, 110, 120, 130, 140]),
        },
        summary: { totalAnomalies: 0, bySeverity: {}, byType: {} },
        costTrend: [100, 105, 110, 115, 120],
      };

      const md = formatAnomalyReportMarkdown(report);
      expect(md).toContain("Cost Trend");
      expect(md).toContain("Rolling average");
      expect(md).toContain("data points");
    });

    it("renders resource type cost breakdown when present", () => {
      const report: AnomalyReport = {
        generatedAt: new Date().toISOString(),
        snapshotsAnalyzed: 5,
        anomalies: [],
        baselines: {
          nodeCount: computeBaseline([10, 11, 12, 10, 11]),
          edgeCount: computeBaseline([5, 6, 5, 5, 6]),
          totalCost: computeBaseline([100, 110, 120, 130, 140]),
        },
        summary: { totalAnomalies: 0, bySeverity: {}, byType: {} },
        resourceTypeCostBreakdown: { compute: 500, database: 300, storage: 100 },
      };

      const md = formatAnomalyReportMarkdown(report);
      expect(md).toContain("Cost by Resource Type");
      expect(md).toContain("compute");
      expect(md).toContain("database");
      expect(md).toContain("storage");
    });
  });
});
