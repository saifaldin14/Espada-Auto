/**
 * Infrastructure Knowledge Graph — OpenTelemetry Export
 *
 * Exports graph metrics and traces in OTLP-compatible format.
 * Supports both push (HTTP POST to collector) and pull (returns
 * serialized payload for external tooling).
 *
 * Zero external dependencies — produces OTLP JSON that any
 * OpenTelemetry-compatible collector can ingest.
 */

import type { GraphStats, GraphStorage, DriftResult } from "../types.js";
import type { ComplianceReport } from "../analysis/compliance.js";

// =============================================================================
// Types
// =============================================================================

/** Metric data point in OTLP gauge format. */
export type OTLPGaugeDataPoint = {
  attributes: Array<{ key: string; value: { stringValue: string } }>;
  timeUnixNano: string;
  asInt?: number;
  asDouble?: number;
};

/** A single OTLP metric (gauge). */
export type OTLPMetric = {
  name: string;
  description: string;
  unit: string;
  gauge: { dataPoints: OTLPGaugeDataPoint[] };
};

/** OTLP metrics export payload (ScopeMetrics wrapper). */
export type OTLPMetricsPayload = {
  resourceMetrics: Array<{
    resource: {
      attributes: Array<{ key: string; value: { stringValue: string } }>;
    };
    scopeMetrics: Array<{
      scope: { name: string; version: string };
      metrics: OTLPMetric[];
    }>;
  }>;
};

/** A single OTLP trace span. */
export type OTLPSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number; // 1=internal, 2=server, 3=client
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{
    key: string;
    value: { stringValue?: string; intValue?: number };
  }>;
  status: { code: number; message?: string }; // 0=unset, 1=ok, 2=error
};

/** OTLP trace export payload. */
export type OTLPTracePayload = {
  resourceSpans: Array<{
    resource: {
      attributes: Array<{ key: string; value: { stringValue: string } }>;
    };
    scopeSpans: Array<{
      scope: { name: string; version: string };
      spans: OTLPSpan[];
    }>;
  }>;
};

/** Options for OTEL export. */
export type OTELExportOptions = {
  /** Service name (defaults to "infra-graph"). */
  serviceName?: string;
  /** Service version. */
  serviceVersion?: string;
  /** Extra resource attributes. */
  resourceAttributes?: Record<string, string>;
  /** OTLP collector endpoint for push mode (e.g. http://localhost:4318). */
  collectorEndpoint?: string;
  /** Optional API key header for collector auth. */
  collectorApiKey?: string;
  /** Fetch timeout in ms (default: 10000). */
  timeoutMs?: number;
};

// =============================================================================
// Helpers
// =============================================================================

import { VERSION } from "../index.js";

const SCOPE_NAME = "infra-graph";
const SCOPE_VERSION = VERSION;

/** Generate a random hex string of given byte length (crypto-quality). */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Current time as nanosecond string. */
function nowNano(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

/** Build OTLP resource attributes. */
function buildResourceAttributes(
  opts: OTELExportOptions,
): Array<{ key: string; value: { stringValue: string } }> {
  const attrs: Array<{ key: string; value: { stringValue: string } }> = [
    {
      key: "service.name",
      value: { stringValue: opts.serviceName ?? "infra-graph" },
    },
    {
      key: "service.version",
      value: { stringValue: opts.serviceVersion ?? SCOPE_VERSION },
    },
  ];

  if (opts.resourceAttributes) {
    for (const [k, v] of Object.entries(opts.resourceAttributes)) {
      attrs.push({ key: k, value: { stringValue: v } });
    }
  }

  return attrs;
}

/** Create a gauge data point. */
function gaugePoint(
  value: number,
  attrs: Record<string, string> = {},
  isInt = true,
): OTLPGaugeDataPoint {
  const point: OTLPGaugeDataPoint = {
    attributes: Object.entries(attrs).map(([key, v]) => ({
      key,
      value: { stringValue: v },
    })),
    timeUnixNano: nowNano(),
  };
  if (isInt) {
    point.asInt = Math.round(value);
  } else {
    point.asDouble = value;
  }
  return point;
}

// =============================================================================
// Metric Builders
// =============================================================================

/**
 * Build OTLP metrics from graph statistics.
 */
export function buildGraphMetrics(
  stats: GraphStats,
  opts: OTELExportOptions = {},
): OTLPMetricsPayload {
  const metrics: OTLPMetric[] = [];

  // -- Aggregate counters ----------------------------------------------------
  metrics.push({
    name: "infra_graph.nodes.total",
    description: "Total number of nodes in the infrastructure graph",
    unit: "{nodes}",
    gauge: { dataPoints: [gaugePoint(stats.totalNodes)] },
  });

  metrics.push({
    name: "infra_graph.edges.total",
    description: "Total number of edges (relationships) in the graph",
    unit: "{edges}",
    gauge: { dataPoints: [gaugePoint(stats.totalEdges)] },
  });

  metrics.push({
    name: "infra_graph.changes.total",
    description: "Total number of changes tracked",
    unit: "{changes}",
    gauge: { dataPoints: [gaugePoint(stats.totalChanges)] },
  });

  metrics.push({
    name: "infra_graph.cost.monthly",
    description: "Total estimated monthly cost across all tracked resources",
    unit: "USD",
    gauge: { dataPoints: [gaugePoint(stats.totalCostMonthly, {}, false)] },
  });

  // -- Per-provider breakdowns ------------------------------------------------
  const providerPoints = Object.entries(stats.nodesByProvider).map(
    ([provider, count]) => gaugePoint(count, { provider }),
  );
  if (providerPoints.length > 0) {
    metrics.push({
      name: "infra_graph.nodes.by_provider",
      description: "Node count broken down by cloud provider",
      unit: "{nodes}",
      gauge: { dataPoints: providerPoints },
    });
  }

  // -- Per-resource-type breakdowns -------------------------------------------
  const rtPoints = Object.entries(stats.nodesByResourceType).map(
    ([resourceType, count]) => gaugePoint(count, { resource_type: resourceType }),
  );
  if (rtPoints.length > 0) {
    metrics.push({
      name: "infra_graph.nodes.by_resource_type",
      description: "Node count broken down by resource type",
      unit: "{nodes}",
      gauge: { dataPoints: rtPoints },
    });
  }

  return {
    resourceMetrics: [
      {
        resource: { attributes: buildResourceAttributes(opts) },
        scopeMetrics: [
          {
            scope: { name: SCOPE_NAME, version: SCOPE_VERSION },
            metrics,
          },
        ],
      },
    ],
  };
}

/**
 * Build OTLP metrics from a drift detection result.
 */
export function buildDriftMetrics(
  drift: DriftResult,
  opts: OTELExportOptions = {},
): OTLPMetricsPayload {
  const metrics: OTLPMetric[] = [
    {
      name: "infra_graph.drift.total",
      description: "Number of resources that have drifted from desired state",
      unit: "{resources}",
      gauge: { dataPoints: [gaugePoint(drift.driftedNodes.length)] },
    },
    {
      name: "infra_graph.drift.disappeared",
      description: "Number of resources that have disappeared",
      unit: "{resources}",
      gauge: { dataPoints: [gaugePoint(drift.disappearedNodes.length)] },
    },
    {
      name: "infra_graph.drift.new",
      description: "Number of newly discovered resources",
      unit: "{resources}",
      gauge: { dataPoints: [gaugePoint(drift.newNodes.length)] },
    },
  ];

  // Per-provider drift counts
  const providerDrift = new Map<string, number>();
  for (const { node } of drift.driftedNodes) {
    providerDrift.set(node.provider, (providerDrift.get(node.provider) ?? 0) + 1);
  }
  if (providerDrift.size > 0) {
    metrics.push({
      name: "infra_graph.drift.by_provider",
      description: "Drifted resources per provider",
      unit: "{resources}",
      gauge: {
        dataPoints: [...providerDrift.entries()].map(([provider, count]) =>
          gaugePoint(count, { provider }),
        ),
      },
    });
  }

  return {
    resourceMetrics: [
      {
        resource: { attributes: buildResourceAttributes(opts) },
        scopeMetrics: [
          {
            scope: { name: SCOPE_NAME, version: SCOPE_VERSION },
            metrics,
          },
        ],
      },
    ],
  };
}

/**
 * Build OTLP metrics from a compliance report.
 * Emits metrics for each framework summary in the report.
 */
export function buildComplianceMetrics(
  report: ComplianceReport,
  opts: OTELExportOptions = {},
): OTLPMetricsPayload {
  const metrics: OTLPMetric[] = [];

  for (const summary of report.frameworks) {
    metrics.push(
      {
        name: "infra_graph.compliance.score",
        description: "Compliance score (0-100)",
        unit: "%",
        gauge: {
          dataPoints: [
            gaugePoint(summary.score, { framework: summary.framework }, false),
          ],
        },
      },
      {
        name: "infra_graph.compliance.controls.total",
        description: "Total controls evaluated",
        unit: "{controls}",
        gauge: {
          dataPoints: [
            gaugePoint(summary.totalControls, { framework: summary.framework }),
          ],
        },
      },
      {
        name: "infra_graph.compliance.controls.passed",
        description: "Controls that passed evaluation",
        unit: "{controls}",
        gauge: {
          dataPoints: [
            gaugePoint(summary.passed, { framework: summary.framework }),
          ],
        },
      },
      {
        name: "infra_graph.compliance.controls.failed",
        description: "Controls that failed evaluation",
        unit: "{controls}",
        gauge: {
          dataPoints: [
            gaugePoint(summary.failed, { framework: summary.framework }),
          ],
        },
      },
    );

    // Per-severity breakdown of failures
    for (const [severity, count] of Object.entries(summary.failureBySeverity)) {
      if (count > 0) {
        metrics.push({
          name: "infra_graph.compliance.failures.by_severity",
          description: "Failed compliance controls by severity",
          unit: "{controls}",
          gauge: {
            dataPoints: [
              gaugePoint(count, { framework: summary.framework, severity }),
            ],
          },
        });
      }
    }
  }

  return {
    resourceMetrics: [
      {
        resource: { attributes: buildResourceAttributes(opts) },
        scopeMetrics: [
          {
            scope: { name: SCOPE_NAME, version: SCOPE_VERSION },
            metrics,
          },
        ],
      },
    ],
  };
}

// =============================================================================
// Trace Builders
// =============================================================================

/**
 * Create an OTLP trace payload for a scan operation.
 * Use this to instrument cloud scanning and graph sync operations.
 */
export function buildScanTrace(
  scanInfo: {
    provider: string;
    region?: string;
    nodesDiscovered: number;
    edgesCreated: number;
    durationMs: number;
    error?: string;
  },
  opts: OTELExportOptions = {},
): OTLPTracePayload {
  const traceId = randomHex(16);
  const rootSpanId = randomHex(8);
  const now = BigInt(Date.now()) * 1_000_000n;
  const start = now - BigInt(scanInfo.durationMs) * 1_000_000n;

  const spans: OTLPSpan[] = [
    {
      traceId,
      spanId: rootSpanId,
      name: `infra-graph.scan.${scanInfo.provider}`,
      kind: 2, // SERVER
      startTimeUnixNano: start.toString(),
      endTimeUnixNano: now.toString(),
      attributes: [
        { key: "cloud.provider", value: { stringValue: scanInfo.provider } },
        ...(scanInfo.region
          ? [{ key: "cloud.region", value: { stringValue: scanInfo.region } }]
          : []),
        {
          key: "infra_graph.scan.nodes_discovered",
          value: { intValue: scanInfo.nodesDiscovered },
        },
        {
          key: "infra_graph.scan.edges_created",
          value: { intValue: scanInfo.edgesCreated },
        },
      ],
      status: scanInfo.error
        ? { code: 2, message: scanInfo.error }
        : { code: 1 },
    },
  ];

  return {
    resourceSpans: [
      {
        resource: { attributes: buildResourceAttributes(opts) },
        scopeSpans: [
          {
            scope: { name: SCOPE_NAME, version: SCOPE_VERSION },
            spans,
          },
        ],
      },
    ],
  };
}

/**
 * Create an OTLP trace payload for a compliance evaluation.
 */
export function buildComplianceTrace(
  evalInfo: {
    framework: string;
    controlsEvaluated: number;
    passed: number;
    failed: number;
    durationMs: number;
  },
  opts: OTELExportOptions = {},
): OTLPTracePayload {
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  const now = BigInt(Date.now()) * 1_000_000n;
  const start = now - BigInt(evalInfo.durationMs) * 1_000_000n;

  return {
    resourceSpans: [
      {
        resource: { attributes: buildResourceAttributes(opts) },
        scopeSpans: [
          {
            scope: { name: SCOPE_NAME, version: SCOPE_VERSION },
            spans: [
              {
                traceId,
                spanId,
                name: `infra-graph.compliance.${evalInfo.framework}`,
                kind: 1, // INTERNAL
                startTimeUnixNano: start.toString(),
                endTimeUnixNano: now.toString(),
                attributes: [
                  {
                    key: "compliance.framework",
                    value: { stringValue: evalInfo.framework },
                  },
                  {
                    key: "compliance.controls_evaluated",
                    value: { intValue: evalInfo.controlsEvaluated },
                  },
                  {
                    key: "compliance.passed",
                    value: { intValue: evalInfo.passed },
                  },
                  {
                    key: "compliance.failed",
                    value: { intValue: evalInfo.failed },
                  },
                ],
                status: evalInfo.failed > 0 ? { code: 2 } : { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
}

// =============================================================================
// Push to Collector
// =============================================================================

/** Normalize collector endpoint — strip trailing slashes, validate URL. */
function normalizeEndpoint(raw: string): string {
  const ep = raw.replace(/\/+$/, "");
  try {
    const parsed = new URL(ep);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    throw new Error(`Invalid OTLP collector endpoint: ${ep}`);
  }
}

/**
 * Push OTLP metrics to an OpenTelemetry collector via HTTP.
 * Uses the standard /v1/metrics endpoint.
 */
export async function pushMetrics(
  payload: OTLPMetricsPayload,
  opts: OTELExportOptions,
): Promise<{ ok: boolean; status: number; body: string }> {
  const endpoint = normalizeEndpoint(opts.collectorEndpoint ?? "http://localhost:4318");
  const url = `${endpoint}/v1/metrics`;
  return pushOTLP(url, payload, opts.collectorApiKey, opts.timeoutMs);
}

/**
 * Push OTLP traces to an OpenTelemetry collector via HTTP.
 * Uses the standard /v1/traces endpoint.
 */
export async function pushTraces(
  payload: OTLPTracePayload,
  opts: OTELExportOptions,
): Promise<{ ok: boolean; status: number; body: string }> {
  const endpoint = normalizeEndpoint(opts.collectorEndpoint ?? "http://localhost:4318");
  const url = `${endpoint}/v1/traces`;
  return pushOTLP(url, payload, opts.collectorApiKey, opts.timeoutMs);
}

/** Internal: POST JSON to an OTLP endpoint with retry + backoff. */
async function pushOTLP(
  url: string,
  payload: unknown,
  apiKey?: string,
  timeoutMs = 10_000,
  maxRetries = 2,
): Promise<{ ok: boolean; status: number; body: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const jsonBody = JSON.stringify(payload);
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: jsonBody,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const body = await res.text();
      // Retry on 5xx or 429 (rate limit)
      if ((res.status >= 500 || res.status === 429) && attempt < maxRetries) {
        const backoffMs = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      return { ok: res.ok, status: res.status, body };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const backoffMs = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
    }
  }
  return { ok: false, status: 0, body: lastError?.message ?? "OTLP push failed" };
}

// =============================================================================
// Convenience: Full Pipeline
// =============================================================================

/**
 * Collect all graph metrics from storage and export as OTLP.
 * Returns the serialized payload — call `pushMetrics()` to send it.
 */
export async function collectAndExportMetrics(
  storage: GraphStorage,
  opts: OTELExportOptions = {},
): Promise<OTLPMetricsPayload> {
  const stats = await storage.getStats();
  return buildGraphMetrics(stats, opts);
}
