/**
 * Infrastructure Knowledge Graph — Benchmark Tests (P3.24)
 */

import { describe, it, expect } from "vitest";
import { InMemoryGraphStorage } from "../storage/memory-store.js";
import {
  generateNodes,
  generateEdges,
  runBenchmarks,
  formatBenchmarkMarkdown,
} from "./benchmark.js";
import type { BenchmarkResult, BenchmarkScale } from "./benchmark.js";

// =============================================================================
// Tests — Data Generation
// =============================================================================

describe("generateNodes", () => {
  it("generates the requested number of nodes", () => {
    const nodes = generateNodes(100);
    expect(nodes.length).toBe(100);
  });

  it("produces deterministic output with same seed", () => {
    const a = generateNodes(50, 42);
    const b = generateNodes(50, 42);
    expect(a.map((n) => n.id)).toEqual(b.map((n) => n.id));
    expect(a.map((n) => n.provider)).toEqual(b.map((n) => n.provider));
  });

  it("produces different output with different seeds", () => {
    const a = generateNodes(50, 1);
    const b = generateNodes(50, 2);
    // IDs include index so they differ; check that providers vary
    const aProviders = a.map((n) => n.provider).join(",");
    const bProviders = b.map((n) => n.provider).join(",");
    expect(aProviders).not.toBe(bProviders);
  });

  it("all nodes have required fields populated", () => {
    const nodes = generateNodes(20);
    for (const n of nodes) {
      expect(n.id).toBeTruthy();
      expect(n.provider).toBeTruthy();
      expect(n.resourceType).toBeTruthy();
      expect(n.region).toBeTruthy();
      expect(n.account).toBeTruthy();
      expect(n.status).toBeTruthy();
      expect(n.tags).toBeDefined();
      expect(n.tags.benchmark).toBe("true");
      expect(n.name).toBeTruthy();
    }
  });

  it("nodes span multiple providers and resource types", () => {
    const nodes = generateNodes(200);
    const providers = new Set(nodes.map((n) => n.provider));
    const types = new Set(nodes.map((n) => n.resourceType));
    expect(providers.size).toBeGreaterThan(1);
    expect(types.size).toBeGreaterThan(3);
  });

  it("all nodes have cost values", () => {
    const nodes = generateNodes(50);
    for (const n of nodes) {
      expect(typeof n.costMonthly).toBe("number");
      expect(n.costMonthly).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("generateEdges", () => {
  it("generates edges for the given nodes", () => {
    const nodes = generateNodes(50);
    const edges = generateEdges(nodes);
    expect(edges.length).toBeGreaterThan(0);
  });

  it("all edges reference valid node IDs", () => {
    const nodes = generateNodes(100);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = generateEdges(nodes);
    for (const e of edges) {
      expect(nodeIds.has(e.sourceNodeId)).toBe(true);
      expect(nodeIds.has(e.targetNodeId)).toBe(true);
    }
  });

  it("no self-loops are generated", () => {
    const nodes = generateNodes(100);
    const edges = generateEdges(nodes);
    for (const e of edges) {
      expect(e.sourceNodeId).not.toBe(e.targetNodeId);
    }
  });

  it("no duplicate edge IDs", () => {
    const nodes = generateNodes(200);
    const edges = generateEdges(nodes);
    const ids = edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("produces deterministic output with same seed", () => {
    const nodes = generateNodes(50, 42);
    const a = generateEdges(nodes, 3, 123);
    const b = generateEdges(nodes, 3, 123);
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
  });

  it("edges have valid relationship types", () => {
    const validTypes = [
      "connected-to", "routes-to", "uses", "depends-on",
      "reads-from", "writes-to", "triggers", "monitors",
    ];
    const nodes = generateNodes(100);
    const edges = generateEdges(nodes);
    for (const e of edges) {
      expect(validTypes).toContain(e.relationshipType);
    }
  });

  it("edges have confidence > 0", () => {
    const nodes = generateNodes(50);
    const edges = generateEdges(nodes);
    for (const e of edges) {
      expect(e.confidence).toBeGreaterThan(0);
      expect(e.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// =============================================================================
// Tests — Benchmark Suite
// =============================================================================

describe("runBenchmarks", () => {
  it("runs at 1k scale and returns valid results", async () => {
    const storage = new InMemoryGraphStorage();
    await storage.initialize();

    const result = await runBenchmarks(storage, {
      scale: "1k",
      repetitions: 3,
      includeTraversals: false,
      includeAlgorithms: false,
    });

    expect(result.scale).toBe("1k");
    expect(result.nodeCount).toBe(1000);
    expect(result.edgeCount).toBeGreaterThan(0);
    expect(result.totalDurationMs).toBeGreaterThan(0);
    expect(result.measurements.length).toBeGreaterThan(0);
    expect(result.runAt).toBeTruthy();
  }, 30_000);

  it("measurements include required fields", async () => {
    const storage = new InMemoryGraphStorage();
    await storage.initialize();

    const result = await runBenchmarks(storage, {
      scale: "1k",
      repetitions: 2,
      includeTraversals: false,
      includeAlgorithms: false,
    });

    for (const m of result.measurements) {
      expect(m.name).toBeTruthy();
      expect(typeof m.durationMs).toBe("number");
      expect(m.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof m.itemCount).toBe("number");
    }
  }, 30_000);

  it("includes data generation, insert, and query measurements", async () => {
    const storage = new InMemoryGraphStorage();
    await storage.initialize();

    const result = await runBenchmarks(storage, {
      scale: "1k",
      repetitions: 2,
      includeTraversals: false,
      includeAlgorithms: false,
    });

    const names = result.measurements.map((m) => m.name);
    expect(names).toContain("generate-nodes");
    expect(names).toContain("generate-edges");
    expect(names).toContain("insert-nodes");
    expect(names).toContain("insert-edges");
    expect(names).toContain("point-lookup");
    expect(names).toContain("query-by-provider");
    expect(names).toContain("get-stats");
  }, 30_000);

  it("includes traversal measurements when requested", async () => {
    const storage = new InMemoryGraphStorage();
    await storage.initialize();

    const result = await runBenchmarks(storage, {
      scale: "1k",
      repetitions: 2,
      includeTraversals: true,
      includeAlgorithms: false,
    });

    const names = result.measurements.map((m) => m.name);
    expect(names).toContain("blast-radius-depth-2");
    expect(names).toContain("dependency-chain");
    expect(names).toContain("neighbors-depth-2");
  }, 60_000);

  it("includes algorithm measurements when requested", async () => {
    const storage = new InMemoryGraphStorage();
    await storage.initialize();

    const result = await runBenchmarks(storage, {
      scale: "1k",
      repetitions: 2,
      includeTraversals: false,
      includeAlgorithms: true,
    });

    const names = result.measurements.map((m) => m.name);
    expect(names).toContain("find-orphans");
    expect(names).toContain("find-clusters");
  }, 60_000);

  it("reports positive peak memory", async () => {
    const storage = new InMemoryGraphStorage();
    await storage.initialize();

    const result = await runBenchmarks(storage, {
      scale: "1k",
      repetitions: 2,
      includeTraversals: false,
      includeAlgorithms: false,
    });

    expect(typeof result.peakMemoryMB).toBe("number");
    expect(result.peakMemoryMB).toBeGreaterThanOrEqual(0);
  }, 30_000);
});

// =============================================================================
// Tests — Markdown Formatting
// =============================================================================

describe("formatBenchmarkMarkdown", () => {
  function mockResult(): BenchmarkResult {
    return {
      runAt: "2025-01-15T12:00:00Z",
      scale: "1k" as BenchmarkScale,
      nodeCount: 1000,
      edgeCount: 2500,
      totalDurationMs: 1234.56,
      peakMemoryMB: 45.2,
      measurements: [
        { name: "insert-nodes", durationMs: 200.12, itemCount: 1000, opsPerSecond: 5000 },
        { name: "point-lookup", durationMs: 5.3, itemCount: 10, opsPerSecond: 1886.79 },
        { name: "find-orphans", durationMs: 50, itemCount: 1 },
      ],
    };
  }

  it("produces markdown with heading and scale", () => {
    const md = formatBenchmarkMarkdown(mockResult());
    expect(md).toContain("# Performance Benchmark — 1K Scale");
  });

  it("includes run metadata", () => {
    const md = formatBenchmarkMarkdown(mockResult());
    expect(md).toContain("**Nodes:** 1,000");
    expect(md).toContain("**Edges:** 2,500");
    expect(md).toContain("**Peak Memory:** 45.2 MB");
  });

  it("includes measurement table", () => {
    const md = formatBenchmarkMarkdown(mockResult());
    expect(md).toContain("| Benchmark | Duration (ms) | Items | Ops/sec |");
    expect(md).toContain("insert-nodes");
    expect(md).toContain("point-lookup");
  });

  it("includes summary section", () => {
    const md = formatBenchmarkMarkdown(mockResult());
    expect(md).toContain("## Summary");
    expect(md).toContain("Insert throughput");
    expect(md).toContain("Point lookup");
  });
});
