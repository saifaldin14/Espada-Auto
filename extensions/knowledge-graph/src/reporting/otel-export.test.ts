/**
 * Tests for OTLP metric/trace export (otel-export.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GraphStats, DriftResult, GraphNode, GraphChange } from "../types.js";
import type { ComplianceReport, ComplianceSummary } from "../analysis/compliance.js";
import {
  buildGraphMetrics,
  buildDriftMetrics,
  buildComplianceMetrics,
  buildScanTrace,
  buildComplianceTrace,
  pushMetrics,
  pushTraces,
  collectAndExportMetrics,
  type OTLPMetricsPayload,
  type OTLPTracePayload,
  type OTELExportOptions,
} from "./otel-export.js";

// =============================================================================
// Fixtures
// =============================================================================

function makeStats(overrides?: Partial<GraphStats>): GraphStats {
  return {
    totalNodes: 42,
    totalEdges: 77,
    totalChanges: 10,
    totalCostMonthly: 1234.56,
    nodesByProvider: { aws: 25, azure: 17 },
    nodesByResourceType: { compute: 20, database: 12, storage: 10 },
    edgesByType: { "runs-in": 40, "depends-on": 37 },
    ...overrides,
  };
}

function makeGraphNode(id: string, overrides?: Partial<GraphNode>): GraphNode {
  return {
    id,
    name: id,
    provider: "aws",
    account: "123456789",
    region: "us-east-1",
    resourceType: "compute",
    nativeId: id,
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: null,
    owner: null,
    createdAt: null,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    version: 1,
    ...overrides,
  } as GraphNode;
}

function makeDriftResult(): DriftResult {
  const node = makeGraphNode("drift-1");
  const change: GraphChange = {
    id: "change-1",
    targetId: "drift-1",
    changeType: "node-drifted",
    field: "status",
    previousValue: "running",
    newValue: "stopped",
    detectedAt: new Date().toISOString(),
    detectedVia: "drift-scan",
    correlationId: null,
    initiator: null,
    initiatorType: null,
    metadata: {},
  };
  return {
    driftedNodes: [{ node, changes: [change] }],
    disappearedNodes: [makeGraphNode("gone-1")],
    newNodes: [makeGraphNode("new-1"), makeGraphNode("new-2")],
  };
}

function makeComplianceReport(): ComplianceReport {
  const summary: ComplianceSummary = {
    framework: "cis",
    totalControls: 10,
    passed: 7,
    failed: 2,
    warnings: 1,
    notApplicable: 0,
    score: 70,
    failureBySeverity: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
    results: [],
  };
  return {
    generatedAt: new Date().toISOString(),
    frameworks: [summary],
    totalResources: 42,
    criticalResources: [],
  };
}

// =============================================================================
// buildGraphMetrics
// =============================================================================

describe("buildGraphMetrics", () => {
  it("produces valid OTLP metrics payload", () => {
    const stats = makeStats();
    const payload = buildGraphMetrics(stats);

    expect(payload.resourceMetrics).toHaveLength(1);
    const rm = payload.resourceMetrics[0];
    expect(rm.scopeMetrics).toHaveLength(1);

    const metrics = rm.scopeMetrics[0].metrics;
    const names = metrics.map(m => m.name);
    expect(names).toContain("infra_graph.nodes.total");
    expect(names).toContain("infra_graph.edges.total");
    expect(names).toContain("infra_graph.changes.total");
    expect(names).toContain("infra_graph.cost.monthly");
    expect(names).toContain("infra_graph.nodes.by_provider");
    expect(names).toContain("infra_graph.nodes.by_resource_type");
  });

  it("sets correct integer values for node count", () => {
    const stats = makeStats({ totalNodes: 100 });
    const payload = buildGraphMetrics(stats);
    const nodeTotalMetric = payload.resourceMetrics[0].scopeMetrics[0].metrics
      .find(m => m.name === "infra_graph.nodes.total");
    expect(nodeTotalMetric?.gauge.dataPoints[0].asInt).toBe(100);
  });

  it("sets cost as double", () => {
    const stats = makeStats({ totalCostMonthly: 5678.90 });
    const payload = buildGraphMetrics(stats);
    const costMetric = payload.resourceMetrics[0].scopeMetrics[0].metrics
      .find(m => m.name === "infra_graph.cost.monthly");
    expect(costMetric?.gauge.dataPoints[0].asDouble).toBeCloseTo(5678.90);
    expect(costMetric?.gauge.dataPoints[0].asInt).toBeUndefined();
  });

  it("uses custom service name in resource attributes", () => {
    const payload = buildGraphMetrics(makeStats(), { serviceName: "my-service" });
    const attrs = payload.resourceMetrics[0].resource.attributes;
    const sn = attrs.find(a => a.key === "service.name");
    expect(sn?.value.stringValue).toBe("my-service");
  });

  it("adds custom resource attributes", () => {
    const payload = buildGraphMetrics(makeStats(), {
      resourceAttributes: { "env": "prod", "team": "infra" },
    });
    const attrs = payload.resourceMetrics[0].resource.attributes;
    expect(attrs.find(a => a.key === "env")?.value.stringValue).toBe("prod");
    expect(attrs.find(a => a.key === "team")?.value.stringValue).toBe("infra");
  });

  it("creates per-provider data points", () => {
    const stats = makeStats({ nodesByProvider: { aws: 25, gcp: 15 } });
    const payload = buildGraphMetrics(stats);
    const byProviderMetric = payload.resourceMetrics[0].scopeMetrics[0].metrics
      .find(m => m.name === "infra_graph.nodes.by_provider");
    expect(byProviderMetric?.gauge.dataPoints).toHaveLength(2);
    const providers = byProviderMetric!.gauge.dataPoints.map(dp =>
      dp.attributes.find(a => a.key === "provider")?.value.stringValue,
    );
    expect(providers).toContain("aws");
    expect(providers).toContain("gcp");
  });

  it("omits per-provider metric when no providers", () => {
    const stats = makeStats({ nodesByProvider: {} });
    const payload = buildGraphMetrics(stats);
    const names = payload.resourceMetrics[0].scopeMetrics[0].metrics.map(m => m.name);
    expect(names).not.toContain("infra_graph.nodes.by_provider");
  });

  it("includes timeUnixNano as a string on all data points", () => {
    const payload = buildGraphMetrics(makeStats());
    for (const m of payload.resourceMetrics[0].scopeMetrics[0].metrics) {
      for (const dp of m.gauge.dataPoints) {
        expect(typeof dp.timeUnixNano).toBe("string");
        expect(BigInt(dp.timeUnixNano)).toBeGreaterThan(0n);
      }
    }
  });
});

// =============================================================================
// buildDriftMetrics
// =============================================================================

describe("buildDriftMetrics", () => {
  it("produces drift total, disappeared, and new metrics", () => {
    const drift = makeDriftResult();
    const payload = buildDriftMetrics(drift);

    const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
    const names = metrics.map(m => m.name);
    expect(names).toContain("infra_graph.drift.total");
    expect(names).toContain("infra_graph.drift.disappeared");
    expect(names).toContain("infra_graph.drift.new");
  });

  it("sets correct drift counts", () => {
    const drift = makeDriftResult();
    const metrics = buildDriftMetrics(drift).resourceMetrics[0].scopeMetrics[0].metrics;
    const total = metrics.find(m => m.name === "infra_graph.drift.total");
    const disappeared = metrics.find(m => m.name === "infra_graph.drift.disappeared");
    const newM = metrics.find(m => m.name === "infra_graph.drift.new");

    expect(total?.gauge.dataPoints[0].asInt).toBe(1);
    expect(disappeared?.gauge.dataPoints[0].asInt).toBe(1);
    expect(newM?.gauge.dataPoints[0].asInt).toBe(2);
  });

  it("includes per-provider drift when drifted nodes exist", () => {
    const drift = makeDriftResult();
    const metrics = buildDriftMetrics(drift).resourceMetrics[0].scopeMetrics[0].metrics;
    const byProvider = metrics.find(m => m.name === "infra_graph.drift.by_provider");
    expect(byProvider).toBeDefined();
    expect(byProvider!.gauge.dataPoints[0].asInt).toBe(1);
  });

  it("omits per-provider when no drifted nodes", () => {
    const drift: DriftResult = { driftedNodes: [], disappearedNodes: [], newNodes: [] };
    const metrics = buildDriftMetrics(drift).resourceMetrics[0].scopeMetrics[0].metrics;
    const names = metrics.map(m => m.name);
    expect(names).not.toContain("infra_graph.drift.by_provider");
  });
});

// =============================================================================
// buildComplianceMetrics
// =============================================================================

describe("buildComplianceMetrics", () => {
  it("produces metrics for each framework in the report", () => {
    const report = makeComplianceReport();
    const payload = buildComplianceMetrics(report);
    const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
    const names = metrics.map(m => m.name);

    expect(names).toContain("infra_graph.compliance.score");
    expect(names).toContain("infra_graph.compliance.controls.total");
    expect(names).toContain("infra_graph.compliance.controls.passed");
    expect(names).toContain("infra_graph.compliance.controls.failed");
    expect(names).toContain("infra_graph.compliance.failures.by_severity");
  });

  it("sets correct compliance score as double", () => {
    const report = makeComplianceReport();
    const payload = buildComplianceMetrics(report);
    const scoreMetric = payload.resourceMetrics[0].scopeMetrics[0].metrics
      .find(m => m.name === "infra_graph.compliance.score");
    expect(scoreMetric?.gauge.dataPoints[0].asDouble).toBe(70);
  });

  it("includes framework label on data points", () => {
    const report = makeComplianceReport();
    const metrics = buildComplianceMetrics(report).resourceMetrics[0].scopeMetrics[0].metrics;
    const scoreMetric = metrics.find(m => m.name === "infra_graph.compliance.score");
    const fw = scoreMetric?.gauge.dataPoints[0].attributes.find(a => a.key === "framework");
    expect(fw?.value.stringValue).toBe("cis");
  });

  it("only emits severity metrics for non-zero counts", () => {
    const report = makeComplianceReport();
    // failureBySeverity: { critical: 1, high: 1, medium: 0, low: 0, info: 0 }
    const metrics = buildComplianceMetrics(report).resourceMetrics[0].scopeMetrics[0].metrics;
    const severityMetrics = metrics.filter(m => m.name === "infra_graph.compliance.failures.by_severity");
    // Only critical + high should be emitted (2 non-zero)
    expect(severityMetrics).toHaveLength(2);
  });

  it("handles multi-framework reports", () => {
    const report = makeComplianceReport();
    report.frameworks.push({
      framework: "soc2",
      totalControls: 5,
      passed: 5,
      failed: 0,
      warnings: 0,
      notApplicable: 0,
      score: 100,
      failureBySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      results: [],
    });
    const metrics = buildComplianceMetrics(report).resourceMetrics[0].scopeMetrics[0].metrics;
    const scoreMetrics = metrics.filter(m => m.name === "infra_graph.compliance.score");
    expect(scoreMetrics).toHaveLength(2);
  });
});

// =============================================================================
// buildScanTrace
// =============================================================================

describe("buildScanTrace", () => {
  it("produces a valid trace payload", () => {
    const payload = buildScanTrace({
      provider: "aws",
      region: "us-east-1",
      nodesDiscovered: 100,
      edgesCreated: 200,
      durationMs: 5000,
    });

    expect(payload.resourceSpans).toHaveLength(1);
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("infra-graph.scan.aws");
    expect(spans[0].kind).toBe(2); // SERVER
    expect(spans[0].status.code).toBe(1); // OK
  });

  it("sets error status when error is provided", () => {
    const payload = buildScanTrace({
      provider: "azure",
      nodesDiscovered: 0,
      edgesCreated: 0,
      durationMs: 100,
      error: "Auth failed",
    });

    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.status.code).toBe(2); // ERROR
    expect(span.status.message).toBe("Auth failed");
  });

  it("includes region attribute when provided", () => {
    const payload = buildScanTrace({
      provider: "aws",
      region: "eu-west-1",
      nodesDiscovered: 10,
      edgesCreated: 5,
      durationMs: 1000,
    });

    const attrs = payload.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    const region = attrs.find(a => a.key === "cloud.region");
    expect(region?.value.stringValue).toBe("eu-west-1");
  });

  it("omits region attribute when not provided", () => {
    const payload = buildScanTrace({
      provider: "gcp",
      nodesDiscovered: 5,
      edgesCreated: 3,
      durationMs: 500,
    });

    const attrs = payload.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    expect(attrs.find(a => a.key === "cloud.region")).toBeUndefined();
  });

  it("generates valid hex trace and span IDs", () => {
    const payload = buildScanTrace({
      provider: "aws",
      nodesDiscovered: 1,
      edgesCreated: 1,
      durationMs: 100,
    });

    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  });
});

// =============================================================================
// buildComplianceTrace
// =============================================================================

describe("buildComplianceTrace", () => {
  it("produces a valid trace payload", () => {
    const payload = buildComplianceTrace({
      framework: "nist-800-53",
      controlsEvaluated: 10,
      passed: 8,
      failed: 2,
      durationMs: 300,
    });

    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("infra-graph.compliance.nist-800-53");
    expect(spans[0].kind).toBe(1); // INTERNAL
  });

  it("sets OK status when no failures", () => {
    const payload = buildComplianceTrace({
      framework: "cis",
      controlsEvaluated: 5,
      passed: 5,
      failed: 0,
      durationMs: 100,
    });

    expect(payload.resourceSpans[0].scopeSpans[0].spans[0].status.code).toBe(1);
  });

  it("sets error status when there are failures", () => {
    const payload = buildComplianceTrace({
      framework: "cis",
      controlsEvaluated: 5,
      passed: 3,
      failed: 2,
      durationMs: 100,
    });

    expect(payload.resourceSpans[0].scopeSpans[0].spans[0].status.code).toBe(2);
  });
});

// =============================================================================
// pushMetrics / pushTraces (with mocked fetch)
// =============================================================================

describe("pushMetrics", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends POST to /v1/metrics with correct headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("{}"),
    });
    globalThis.fetch = mockFetch;

    const payload = buildGraphMetrics(makeStats());
    const result = await pushMetrics(payload, {
      collectorEndpoint: "http://test-collector:4318",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test-collector:4318/v1/metrics");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("includes Authorization header when apiKey is provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
    });
    globalThis.fetch = mockFetch;

    await pushMetrics(buildGraphMetrics(makeStats()), {
      collectorEndpoint: "http://collector:4318",
      collectorApiKey: "secret-key",
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["Authorization"]).toBe("Bearer secret-key");
  });

  it("handles failed responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal error"),
    });

    const result = await pushMetrics(buildGraphMetrics(makeStats()), {});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.body).toBe("Internal error");
  });

  it("passes timeout signal to fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
    });
    globalThis.fetch = mockFetch;

    await pushMetrics(buildGraphMetrics(makeStats()), {
      timeoutMs: 5000,
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.signal).toBeDefined();
  });

  it("normalizes endpoint URL with trailing slash", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
    });
    globalThis.fetch = mockFetch;

    await pushMetrics(buildGraphMetrics(makeStats()), {
      collectorEndpoint: "http://collector:4318/",
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://collector:4318/v1/metrics");
  });

  it("rejects invalid endpoint URL", async () => {
    await expect(
      pushMetrics(buildGraphMetrics(makeStats()), {
        collectorEndpoint: "not://valid",
      }),
    ).rejects.toThrow(/Invalid OTLP collector endpoint|Unsupported protocol/);
  });

  it("retries on 5xx errors with backoff", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({
          ok: false,
          status: 503,
          text: () => Promise.resolve("Service unavailable"),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("{}"),
      });
    });
    globalThis.fetch = mockFetch;

    const result = await pushMetrics(buildGraphMetrics(makeStats()), {
      collectorEndpoint: "http://collector:4318",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 15_000);

  it("returns last error after exhausting retries", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve("Down"),
    });
    globalThis.fetch = mockFetch;

    const result = await pushMetrics(buildGraphMetrics(makeStats()), {
      collectorEndpoint: "http://collector:4318",
    });

    // After 3 attempts (1 + 2 retries), returns the last 503
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 15_000);
});

describe("pushTraces", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends POST to /v1/traces", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
    });
    globalThis.fetch = mockFetch;

    const payload = buildScanTrace({
      provider: "aws",
      nodesDiscovered: 10,
      edgesCreated: 5,
      durationMs: 100,
    });

    await pushTraces(payload, {
      collectorEndpoint: "http://test:4318",
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://test:4318/v1/traces");
  });
});

// =============================================================================
// collectAndExportMetrics
// =============================================================================

describe("collectAndExportMetrics", () => {
  it("collects stats from storage and returns OTLP payload", async () => {
    // Create a minimal mock storage
    const mockStorage = {
      getStats: vi.fn().mockResolvedValue(makeStats({ totalNodes: 99 })),
    };

    const payload = await collectAndExportMetrics(mockStorage as any);
    expect(mockStorage.getStats).toHaveBeenCalledOnce();

    const nodeTotalMetric = payload.resourceMetrics[0].scopeMetrics[0].metrics
      .find(m => m.name === "infra_graph.nodes.total");
    expect(nodeTotalMetric?.gauge.dataPoints[0].asInt).toBe(99);
  });
});
