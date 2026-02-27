/**
 * Infrastructure Knowledge Graph — Graph Anomaly Detection
 *
 * Detects anomalies in infrastructure graph topology and cost data by
 * analyzing temporal snapshots for:
 *
 *   - Sudden node count changes (topology anomalies)
 *   - Cost spikes/drops (cost anomalies)
 *   - Relationship pattern deviations (structural anomalies)
 *   - Node churn (rapid create/delete cycles)
 *
 * Uses statistical methods (z-score, IQR, rolling averages) to identify
 * deviations from baseline behavior.
 */

import type { GraphStorage, GraphNode, CloudProvider, GraphResourceType } from "../types.js";
import type { GraphSnapshot, TemporalGraphStorage, SnapshotDiff } from "../core/temporal.js";

// =============================================================================
// Types
// =============================================================================

/** Types of anomalies that can be detected. */
export type AnomalyType =
  | "cost-spike"
  | "cost-drop"
  | "node-surge"
  | "node-loss"
  | "edge-surge"
  | "edge-loss"
  | "high-churn"
  | "structural-drift";

/** Severity of an anomaly. */
export type AnomalySeverity = "critical" | "high" | "medium" | "low";

/** A detected anomaly. */
export type GraphAnomaly = {
  /** Unique anomaly ID. */
  id: string;
  /** Type of anomaly. */
  type: AnomalyType;
  /** Severity based on deviation magnitude. */
  severity: AnomalySeverity;
  /** Human-readable description. */
  description: string;
  /** When the anomaly was detected. */
  detectedAt: string;
  /** Snapshot that triggered the anomaly. */
  snapshotId: string;
  /** The metric value that triggered the anomaly. */
  actualValue: number;
  /** The expected (baseline) value. */
  expectedValue: number;
  /** Standard deviations from the mean. */
  zScore: number;
  /** Affected resources (if identifiable). */
  affectedResources: string[];
  /** Optional metadata. */
  metadata: Record<string, unknown>;
};

/** Configuration for anomaly detection. */
export type AnomalyDetectionConfig = {
  /** Z-score threshold for anomaly detection (default: 2.0). */
  zScoreThreshold?: number;
  /** Minimum snapshots required before detection activates (default: 5). */
  minSnapshots?: number;
  /** Window size for rolling statistics (default: 10). */
  rollingWindow?: number;
  /** Whether to detect cost anomalies (default: true). */
  detectCost?: boolean;
  /** Whether to detect topology anomalies (default: true). */
  detectTopology?: boolean;
  /** Whether to detect structural anomalies (default: true). */
  detectStructural?: boolean;
  /** Whether to detect churn anomalies (default: true). */
  detectChurn?: boolean;
  /** Provider filter. */
  provider?: CloudProvider;
  /** Resource type filter — narrows live-graph enrichment in detectAnomaliesFromGraph. */
  resourceType?: GraphResourceType;
};

/** Statistical baseline for a metric. */
export type MetricBaseline = {
  mean: number;
  stdDev: number;
  median: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  iqr: number;
  count: number;
};

/** Full anomaly detection report. */
export type AnomalyReport = {
  generatedAt: string;
  snapshotsAnalyzed: number;
  anomalies: GraphAnomaly[];
  baselines: {
    nodeCount: MetricBaseline;
    edgeCount: MetricBaseline;
    totalCost: MetricBaseline;
  };
  summary: {
    totalAnomalies: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
  };
  /** Rolling average trend for cost series (present when enough snapshots exist). */
  costTrend?: number[];
  /** Cost breakdown by resource type from live graph (set by detectAnomaliesFromGraph). */
  resourceTypeCostBreakdown?: Record<string, number>;
  /** Total live nodes inspected (set by detectAnomaliesFromGraph). */
  totalLiveNodes?: number;
};

// =============================================================================
// Statistical Helpers
// =============================================================================

/**
 * Compute statistical baseline from a numeric series.
 */
export function computeBaseline(values: number[]): MetricBaseline {
  if (values.length === 0) {
    return { mean: 0, stdDev: 0, median: 0, min: 0, max: 0, q1: 0, q3: 0, iqr: 0, count: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1
    ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
    : 0;
  const stdDev = Math.sqrt(variance);

  const median = n % 2 === 0
    ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2
    : sorted[Math.floor(n / 2)]!;

  const q1 = sorted[Math.floor(n * 0.25)]!;
  const q3 = sorted[Math.floor(n * 0.75)]!;

  return {
    mean,
    stdDev,
    median,
    min: sorted[0]!,
    max: sorted[n - 1]!,
    q1,
    q3,
    iqr: q3 - q1,
    count: n,
  };
}

/**
 * Compute the z-score for a value relative to a baseline.
 */
export function zScore(value: number, baseline: MetricBaseline): number {
  if (baseline.stdDev === 0) return value === baseline.mean ? 0 : Infinity;
  return (value - baseline.mean) / baseline.stdDev;
}

/**
 * Compute a rolling average for a series.
 */
export function rollingAverage(values: number[], windowSize: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = values.slice(start, i + 1);
    result.push(window.reduce((a, b) => a + b, 0) / window.length);
  }
  return result;
}

// =============================================================================
// Anomaly Detection Engine
// =============================================================================

/**
 * Detect anomalies across temporal snapshots.
 */
export async function detectAnomalies(
  temporal: TemporalGraphStorage,
  config: AnomalyDetectionConfig = {},
): Promise<AnomalyReport> {
  const {
    zScoreThreshold = 2.0,
    minSnapshots = 5,
    rollingWindow = 10,
    detectCost = true,
    detectTopology = true,
    detectStructural = true,
    detectChurn = true,
    provider,
  } = config;

  const snapshots = await temporal.listSnapshots({
    provider: provider ?? undefined,
    limit: 200,
  });

  // Sort oldest-first
  const sorted: GraphSnapshot[] = [...snapshots].reverse();
  const anomalies: GraphAnomaly[] = [];

  if (sorted.length < minSnapshots) {
    return buildEmptyReport(sorted.length);
  }

  // Extract time series
  const nodeCounts = sorted.map((s) => s.nodeCount);
  const edgeCounts = sorted.map((s) => s.edgeCount);
  const totalCosts = sorted.map((s) => s.totalCostMonthly);

  // Compute baselines
  const nodeBaseline = computeBaseline(nodeCounts);
  const edgeBaseline = computeBaseline(edgeCounts);
  const costBaseline = computeBaseline(totalCosts);

  // Compute rolling-average trend for smoothed cost analysis
  const costTrend = rollingAverage(totalCosts, rollingWindow);

  // Detect cost anomalies
  if (detectCost) {
    for (let i = Math.max(1, minSnapshots - 1); i < sorted.length; i++) {
      const snap = sorted[i]!;
      const z = zScore(snap.totalCostMonthly, costBaseline);

      if (Math.abs(z) >= zScoreThreshold) {
        const isSpike = z > 0;
        anomalies.push({
          id: `anomaly-cost-${snap.id}`,
          type: isSpike ? "cost-spike" : "cost-drop",
          severity: severityFromZScore(Math.abs(z)),
          description: isSpike
            ? `Cost spike: $${snap.totalCostMonthly.toFixed(2)} (expected ~$${costBaseline.mean.toFixed(2)}, z=${z.toFixed(2)})`
            : `Cost drop: $${snap.totalCostMonthly.toFixed(2)} (expected ~$${costBaseline.mean.toFixed(2)}, z=${z.toFixed(2)})`,
          detectedAt: snap.createdAt,
          snapshotId: snap.id,
          actualValue: snap.totalCostMonthly,
          expectedValue: costBaseline.mean,
          zScore: z,
          affectedResources: [],
          metadata: { provider: snap.provider },
        });
      }
    }
  }

  // Detect topology anomalies
  if (detectTopology) {
    for (let i = Math.max(1, minSnapshots - 1); i < sorted.length; i++) {
      const snap = sorted[i]!;
      const nodeZ = zScore(snap.nodeCount, nodeBaseline);
      const edgeZ = zScore(snap.edgeCount, edgeBaseline);

      if (Math.abs(nodeZ) >= zScoreThreshold) {
        const isSurge = nodeZ > 0;
        anomalies.push({
          id: `anomaly-node-${snap.id}`,
          type: isSurge ? "node-surge" : "node-loss",
          severity: severityFromZScore(Math.abs(nodeZ)),
          description: isSurge
            ? `Node surge: ${snap.nodeCount} nodes (expected ~${Math.round(nodeBaseline.mean)}, z=${nodeZ.toFixed(2)})`
            : `Node loss: ${snap.nodeCount} nodes (expected ~${Math.round(nodeBaseline.mean)}, z=${nodeZ.toFixed(2)})`,
          detectedAt: snap.createdAt,
          snapshotId: snap.id,
          actualValue: snap.nodeCount,
          expectedValue: nodeBaseline.mean,
          zScore: nodeZ,
          affectedResources: [],
          metadata: { provider: snap.provider },
        });
      }

      if (Math.abs(edgeZ) >= zScoreThreshold) {
        const isSurge = edgeZ > 0;
        anomalies.push({
          id: `anomaly-edge-${snap.id}`,
          type: isSurge ? "edge-surge" : "edge-loss",
          severity: severityFromZScore(Math.abs(edgeZ)),
          description: isSurge
            ? `Edge surge: ${snap.edgeCount} edges (z=${edgeZ.toFixed(2)})`
            : `Edge loss: ${snap.edgeCount} edges (z=${edgeZ.toFixed(2)})`,
          detectedAt: snap.createdAt,
          snapshotId: snap.id,
          actualValue: snap.edgeCount,
          expectedValue: edgeBaseline.mean,
          zScore: edgeZ,
          affectedResources: [],
          metadata: { provider: snap.provider },
        });
      }
    }
  }

  // Detect churn (rapid creation/deletion between consecutive snapshots)
  if (detectChurn && sorted.length >= 2) {
    const churnValues: number[] = [];
    const diffs: Array<SnapshotDiff | null> = [];

    for (let i = 1; i < sorted.length; i++) {
      try {
        const diff: SnapshotDiff = await temporal.diffSnapshots(sorted[i - 1]!.id, sorted[i]!.id);
        diffs.push(diff);
        churnValues.push(diff.addedNodes.length + diff.removedNodes.length);
      } catch {
        diffs.push(null);
        churnValues.push(0);
      }
    }

    if (churnValues.length >= minSnapshots) {
      const churnBaseline = computeBaseline(churnValues);
      for (let i = 0; i < churnValues.length; i++) {
        const churn = churnValues[i]!;
        const z = zScore(churn, churnBaseline);

        if (z >= zScoreThreshold && churn > 0) {
          const snap = sorted[i + 1]!;
          const diff = diffs[i];
          // Collect affected resource IDs from the diff's added/removed nodes
          const affectedNodes: GraphNode[] = diff
            ? [...diff.addedNodes, ...diff.removedNodes]
            : [];
          anomalies.push({
            id: `anomaly-churn-${snap.id}`,
            type: "high-churn",
            severity: severityFromZScore(z),
            description: `High churn: ${churn} resources created/deleted (expected ~${Math.round(churnBaseline.mean)}, z=${z.toFixed(2)})`,
            detectedAt: snap.createdAt,
            snapshotId: snap.id,
            actualValue: churn,
            expectedValue: churnBaseline.mean,
            zScore: z,
            affectedResources: affectedNodes.map((n) => n.id).slice(0, 20),
            metadata: { addedCount: diff?.addedNodes.length ?? 0, removedCount: diff?.removedNodes.length ?? 0 },
          });
        }
      }
    }
  }

  // Detect structural drift (edge-to-node ratio anomalies)
  if (detectStructural) {
    const ratios = sorted
      .filter((s) => s.nodeCount > 0)
      .map((s) => s.edgeCount / s.nodeCount);

    if (ratios.length >= minSnapshots) {
      const ratioBaseline = computeBaseline(ratios);

      for (let i = Math.max(1, minSnapshots - 1); i < sorted.length; i++) {
        const snap = sorted[i]!;
        if (snap.nodeCount === 0) continue;

        const ratio = snap.edgeCount / snap.nodeCount;
        const z = zScore(ratio, ratioBaseline);

        if (Math.abs(z) >= zScoreThreshold) {
          anomalies.push({
            id: `anomaly-struct-${snap.id}`,
            type: "structural-drift",
            severity: severityFromZScore(Math.abs(z)),
            description: `Structural drift: edge/node ratio ${ratio.toFixed(2)} (expected ~${ratioBaseline.mean.toFixed(2)}, z=${z.toFixed(2)})`,
            detectedAt: snap.createdAt,
            snapshotId: snap.id,
            actualValue: ratio,
            expectedValue: ratioBaseline.mean,
            zScore: z,
            affectedResources: [],
            metadata: { edgeCount: snap.edgeCount, nodeCount: snap.nodeCount },
          });
        }
      }
    }
  }

  // Build report
  const bySeverity: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const a of anomalies) {
    bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
    byType[a.type] = (byType[a.type] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    snapshotsAnalyzed: sorted.length,
    anomalies: anomalies.sort((a, b) => b.zScore - a.zScore),
    baselines: {
      nodeCount: nodeBaseline,
      edgeCount: edgeBaseline,
      totalCost: costBaseline,
    },
    summary: {
      totalAnomalies: anomalies.length,
      bySeverity,
      byType,
    },
    costTrend,
  };
}

/**
 * Detect anomalies with live-graph enrichment.
 *
 * Runs the standard temporal anomaly detection, then queries the live
 * graph to add a per-resource-type cost breakdown and total node count.
 * When `config.resourceType` is set, the live-graph query is filtered
 * to that resource type.
 */
export async function detectAnomaliesFromGraph(
  storage: GraphStorage,
  temporal: TemporalGraphStorage,
  config: AnomalyDetectionConfig = {},
): Promise<AnomalyReport> {
  const report = await detectAnomalies(temporal, config);

  // Build filter for live graph query
  const filter: { provider?: CloudProvider; resourceType?: GraphResourceType } = {};
  if (config.provider) filter.provider = config.provider;
  if (config.resourceType) filter.resourceType = config.resourceType;

  const nodes: GraphNode[] = await storage.queryNodes(filter);

  // Compute per-resource-type cost breakdown from live graph
  const costByType: Record<string, number> = {};
  for (const node of nodes) {
    if (node.costMonthly != null) {
      costByType[node.resourceType] = (costByType[node.resourceType] ?? 0) + node.costMonthly;
    }
  }

  report.resourceTypeCostBreakdown = costByType;
  report.totalLiveNodes = nodes.length;

  return report;
}

// =============================================================================
// Helpers
// =============================================================================

function severityFromZScore(z: number): AnomalySeverity {
  if (z >= 4.0) return "critical";
  if (z >= 3.0) return "high";
  if (z >= 2.5) return "medium";
  return "low";
}

function buildEmptyReport(snapshotsAnalyzed: number): AnomalyReport {
  const empty: MetricBaseline = { mean: 0, stdDev: 0, median: 0, min: 0, max: 0, q1: 0, q3: 0, iqr: 0, count: 0 };
  return {
    generatedAt: new Date().toISOString(),
    snapshotsAnalyzed,
    anomalies: [],
    baselines: { nodeCount: empty, edgeCount: empty, totalCost: empty },
    summary: { totalAnomalies: 0, bySeverity: {}, byType: {} },
  };
}

/**
 * Format an anomaly report as markdown.
 */
export function formatAnomalyReportMarkdown(report: AnomalyReport): string {
  const lines: string[] = [
    "# Graph Anomaly Detection Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Snapshots analyzed: ${report.snapshotsAnalyzed}`,
    `Total anomalies: ${report.summary.totalAnomalies}`,
    "",
  ];

  if (report.anomalies.length > 0) {
    lines.push(
      "## Anomalies",
      "",
      "| Type | Severity | Z-Score | Description |",
      "|------|----------|---------|-------------|",
      ...report.anomalies.map(
        (a) => `| ${a.type} | ${a.severity} | ${a.zScore.toFixed(2)} | ${a.description} |`,
      ),
      "",
    );
  }

  lines.push(
    "## Baselines",
    "",
    "| Metric | Mean | StdDev | Min | Max |",
    "|--------|------|--------|-----|-----|",
    `| Node Count | ${report.baselines.nodeCount.mean.toFixed(0)} | ${report.baselines.nodeCount.stdDev.toFixed(1)} | ${report.baselines.nodeCount.min} | ${report.baselines.nodeCount.max} |`,
    `| Edge Count | ${report.baselines.edgeCount.mean.toFixed(0)} | ${report.baselines.edgeCount.stdDev.toFixed(1)} | ${report.baselines.edgeCount.min} | ${report.baselines.edgeCount.max} |`,
    `| Total Cost | $${report.baselines.totalCost.mean.toFixed(2)} | $${report.baselines.totalCost.stdDev.toFixed(2)} | $${report.baselines.totalCost.min.toFixed(2)} | $${report.baselines.totalCost.max.toFixed(2)} |`,
  );

  if (report.resourceTypeCostBreakdown && Object.keys(report.resourceTypeCostBreakdown).length > 0) {
    const entries = Object.entries(report.resourceTypeCostBreakdown)
      .sort(([, a], [, b]) => b - a);
    lines.push(
      "",
      "## Cost by Resource Type",
      "",
      "| Resource Type | Monthly Cost |",
      "|---------------|-------------|",
      ...entries.map(([type, cost]) => `| ${type} | $${cost.toFixed(2)} |`),
    );
  }

  if (report.costTrend && report.costTrend.length > 0) {
    const latest = report.costTrend[report.costTrend.length - 1]!;
    const earliest = report.costTrend[0]!;
    const direction = latest > earliest ? "↑" : latest < earliest ? "↓" : "→";
    lines.push(
      "",
      "## Cost Trend",
      "",
      `Rolling average: $${earliest.toFixed(2)} ${direction} $${latest.toFixed(2)} (${report.costTrend.length} data points)`,
    );
  }

  return lines.join("\n");
}
