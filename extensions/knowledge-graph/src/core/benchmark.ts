/**
 * Infrastructure Knowledge Graph — Performance Benchmarks (P3.24)
 *
 * Automated benchmarks at 1K, 10K, and 100K node scales.
 * Measures sync time, query latency, traversal performance,
 * and memory usage. Returns structured results for regression tracking.
 */

import type {
  GraphStorage,
  GraphNodeInput,
  GraphEdgeInput,
  CloudProvider,
  GraphResourceType,
  GraphNodeStatus,
  GraphRelationshipType,
  EdgeDiscoveryMethod,
} from "../types.js";
import { GraphEngine } from "../core/engine.js";
import {
  shortestPath,
  findOrphans,
  findCriticalNodes,
  findSinglePointsOfFailure,
  findClusters,
} from "../core/queries.js";

// =============================================================================
// Types
// =============================================================================

/** A single benchmark measurement. */
export type BenchmarkMeasurement = {
  /** Name of the benchmark. */
  name: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Operations per second (if applicable). */
  opsPerSecond?: number;
  /** Items processed. */
  itemCount: number;
  /** Additional info. */
  metadata?: Record<string, unknown>;
};

/** Benchmark scale. */
export type BenchmarkScale = "1k" | "10k" | "100k";

/** Full benchmark run result. */
export type BenchmarkResult = {
  /** When the benchmark was run. */
  runAt: string;
  /** Scale of the benchmark. */
  scale: BenchmarkScale;
  /** Total nodes in the graph. */
  nodeCount: number;
  /** Total edges in the graph. */
  edgeCount: number;
  /** Total duration of the entire benchmark suite. */
  totalDurationMs: number;
  /** Individual measurements. */
  measurements: BenchmarkMeasurement[];
  /** Peak memory usage in MB (approximate). */
  peakMemoryMB: number;
};

/** Options for running benchmarks. */
export type BenchmarkOptions = {
  /** Scale to benchmark (default: "1k"). */
  scale?: BenchmarkScale;
  /** Number of repetitions for latency tests (default: 10). */
  repetitions?: number;
  /** Whether to run traversal benchmarks (expensive at large scale). */
  includeTraversals?: boolean;
  /** Whether to run algorithm benchmarks (SPOF, critical nodes). */
  includeAlgorithms?: boolean;
};

// =============================================================================
// Data Generation
// =============================================================================

const PROVIDERS: CloudProvider[] = ["aws", "azure", "gcp"];
const RESOURCE_TYPES: GraphResourceType[] = [
  "compute", "database", "storage", "network", "load-balancer",
  "function", "container", "vpc", "subnet", "security-group",
  "cache", "queue", "topic", "api-gateway", "cdn",
];
const REGIONS = [
  "us-east-1", "us-west-2", "eu-west-1", "eu-central-1",
  "ap-southeast-1", "ap-northeast-1",
];
const STATUSES: GraphNodeStatus[] = ["running", "stopped", "pending"];
const RELATIONSHIP_TYPES: GraphRelationshipType[] = [
  "connected-to", "routes-to", "uses", "depends-on",
  "reads-from", "writes-to", "triggers", "monitors",
];
const DISCOVERY_METHODS: EdgeDiscoveryMethod[] = [
  "api-field", "config-scan", "iac-parse",
];

/** Get node count for a scale. */
function scaleToNodeCount(scale: BenchmarkScale): number {
  switch (scale) {
    case "1k": return 1_000;
    case "10k": return 10_000;
    case "100k": return 100_000;
  }
}

/** Deterministic pseudo-random (seedable) for repeatable benchmarks. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Generate synthetic graph nodes. */
export function generateNodes(count: number, seed = 42): GraphNodeInput[] {
  const rand = seededRandom(seed);
  const now = new Date().toISOString();
  const nodes: GraphNodeInput[] = [];

  for (let i = 0; i < count; i++) {
    const provider = PROVIDERS[Math.floor(rand() * PROVIDERS.length)]!;
    const resourceType = RESOURCE_TYPES[Math.floor(rand() * RESOURCE_TYPES.length)]!;
    const region = REGIONS[Math.floor(rand() * REGIONS.length)]!;
    const status: GraphNodeStatus = STATUSES[Math.floor(rand() * STATUSES.length)]!;

    nodes.push({
      id: `${provider}:bench:${region}:${resourceType}:node-${i}`,
      provider,
      resourceType,
      nativeId: `node-${i}`,
      name: `bench-${resourceType}-${i}`,
      region,
      account: `bench-account-${Math.floor(rand() * 5)}`,
      status,
      tags: {
        env: rand() > 0.5 ? "production" : "staging",
        team: `team-${Math.floor(rand() * 10)}`,
        benchmark: "true",
      },
      metadata: {
        generated: true,
        index: i,
      },
      costMonthly: Math.round(rand() * 500 * 100) / 100,
      owner: `owner-${Math.floor(rand() * 20)}`,
      createdAt: now,
    });
  }

  return nodes;
}

/**
 * Generate synthetic edges with realistic connectivity.
 * ~3 edges per node on average (similar to real infrastructure).
 */
export function generateEdges(
  nodes: GraphNodeInput[],
  edgesPerNode = 3,
  seed = 123,
): GraphEdgeInput[] {
  const rand = seededRandom(seed);
  const edges: GraphEdgeInput[] = [];
  const edgeIds = new Set<string>();

  for (let i = 0; i < nodes.length; i++) {
    const source = nodes[i]!;
    const numEdges = Math.max(1, Math.floor(rand() * edgesPerNode * 2));

    for (let j = 0; j < numEdges; j++) {
      const targetIdx = Math.floor(rand() * nodes.length);
      if (targetIdx === i) continue;
      const target = nodes[targetIdx]!;

      const relType: GraphRelationshipType = RELATIONSHIP_TYPES[
        Math.floor(rand() * RELATIONSHIP_TYPES.length)
      ]!;
      const discoveryMethod: EdgeDiscoveryMethod = DISCOVERY_METHODS[
        Math.floor(rand() * DISCOVERY_METHODS.length)
      ]!;
      const edgeId = `${source.id}:${relType}:${target.id}`;

      // Skip duplicate edges
      if (edgeIds.has(edgeId)) continue;
      edgeIds.add(edgeId);

      edges.push({
        id: edgeId,
        sourceNodeId: source.id,
        targetNodeId: target.id,
        relationshipType: relType,
        confidence: 0.8 + rand() * 0.2,
        discoveredVia: discoveryMethod,
        metadata: {},
      });
    }
  }

  return edges;
}

// =============================================================================
// Timing Utility
// =============================================================================

/** Measure async function execution time. */
async function measure<T>(
  name: string,
  fn: () => Promise<T>,
  itemCount: number,
): Promise<BenchmarkMeasurement & { result: T }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;

  return {
    name,
    durationMs: Math.round(durationMs * 100) / 100,
    opsPerSecond: durationMs > 0
      ? Math.round((itemCount / (durationMs / 1000)) * 100) / 100
      : 0,
    itemCount,
    result,
  };
}

/** Get current memory usage in MB. */
function getMemoryMB(): number {
  if (typeof process !== "undefined" && process.memoryUsage) {
    return Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100;
  }
  return 0;
}

// =============================================================================
// Benchmark Suite
// =============================================================================

/**
 * Run the full benchmark suite at the specified scale.
 */
export async function runBenchmarks(
  storage: GraphStorage,
  options: BenchmarkOptions = {},
): Promise<BenchmarkResult> {
  const scale = options.scale ?? "1k";
  const repetitions = options.repetitions ?? 10;
  const includeTraversals = options.includeTraversals ?? true;
  const includeAlgorithms = options.includeAlgorithms ?? (scale !== "100k");

  const nodeCount = scaleToNodeCount(scale);
  const measurements: BenchmarkMeasurement[] = [];
  const suiteStart = performance.now();
  const startMemory = getMemoryMB();

  // -- 1. Generate synthetic data ---------------------------------------------
  const genNodes = await measure(
    "generate-nodes",
    async () => generateNodes(nodeCount),
    nodeCount,
  );
  measurements.push(genNodes);

  const genEdges = await measure(
    "generate-edges",
    async () => generateEdges(genNodes.result),
    genNodes.result.length,
  );
  measurements.push(genEdges);

  // -- 2. Bulk insert nodes ---------------------------------------------------
  const insertNodes = await measure(
    "insert-nodes",
    async () => {
      // Insert in batches of 500
      const batchSize = 500;
      for (let i = 0; i < genNodes.result.length; i += batchSize) {
        await storage.upsertNodes(genNodes.result.slice(i, i + batchSize));
      }
    },
    genNodes.result.length,
  );
  measurements.push(insertNodes);

  // -- 3. Bulk insert edges ---------------------------------------------------
  const insertEdges = await measure(
    "insert-edges",
    async () => {
      const batchSize = 500;
      for (let i = 0; i < genEdges.result.length; i += batchSize) {
        await storage.upsertEdges(genEdges.result.slice(i, i + batchSize));
      }
    },
    genEdges.result.length,
  );
  measurements.push(insertEdges);

  const peakAfterInsert = getMemoryMB();

  // -- 4. Query benchmarks ----------------------------------------------------

  // 4a. Point lookup by ID
  const sampleIds = genNodes.result
    .filter((_, i) => i % Math.max(1, Math.floor(nodeCount / repetitions)) === 0)
    .slice(0, repetitions)
    .map((n) => n.id);

  const pointLookup = await measure(
    "point-lookup",
    async () => {
      for (const id of sampleIds) {
        await storage.getNode(id);
      }
    },
    sampleIds.length,
  );
  measurements.push(pointLookup);

  // 4b. Query by provider
  const queryByProvider = await measure(
    "query-by-provider",
    async () => {
      for (const p of PROVIDERS) {
        await storage.queryNodes({ provider: p });
      }
    },
    PROVIDERS.length,
  );
  measurements.push(queryByProvider);

  // 4c. Query by resource type
  const queryByType = await measure(
    "query-by-resource-type",
    async () => {
      for (const t of RESOURCE_TYPES.slice(0, 5)) {
        await storage.queryNodes({ resourceType: t });
      }
    },
    5,
  );
  measurements.push(queryByType);

  // 4d. Query by tag
  const queryByTag = await measure(
    "query-by-tag",
    async () => {
      await storage.queryNodes({ tags: { env: "production" } });
      await storage.queryNodes({ tags: { benchmark: "true" } });
    },
    2,
  );
  measurements.push(queryByTag);

  // 4e. Edge lookup
  const edgeLookup = await measure(
    "edge-lookup",
    async () => {
      for (const id of sampleIds.slice(0, Math.min(5, sampleIds.length))) {
        await storage.getEdgesForNode(id, "both");
      }
    },
    Math.min(5, sampleIds.length),
  );
  measurements.push(edgeLookup);

  // 4f. Stats
  const statsBench = await measure(
    "get-stats",
    async () => storage.getStats(),
    1,
  );
  measurements.push(statsBench);

  // -- 5. Traversal benchmarks ------------------------------------------------
  if (includeTraversals) {
    const engine = new GraphEngine({ storage });

    // 5a. Blast radius (depth 2)
    const blastRadius = await measure(
      "blast-radius-depth-2",
      async () => {
        for (const id of sampleIds.slice(0, Math.min(3, sampleIds.length))) {
          await engine.getBlastRadius(id, 2);
        }
      },
      Math.min(3, sampleIds.length),
    );
    measurements.push(blastRadius);

    // 5b. Dependency chain
    const depChain = await measure(
      "dependency-chain",
      async () => {
        for (const id of sampleIds.slice(0, Math.min(3, sampleIds.length))) {
          await engine.getDependencyChain(id, "downstream", 3);
        }
      },
      Math.min(3, sampleIds.length),
    );
    measurements.push(depChain);

    // 5c. Neighbors (depth 2)
    const neighbors = await measure(
      "neighbors-depth-2",
      async () => {
        for (const id of sampleIds.slice(0, Math.min(3, sampleIds.length))) {
          await storage.getNeighbors(id, 2, "both");
        }
      },
      Math.min(3, sampleIds.length),
    );
    measurements.push(neighbors);
  }

  // -- 6. Algorithm benchmarks ------------------------------------------------
  if (includeAlgorithms) {
    // 6a. Find orphans
    const orphans = await measure(
      "find-orphans",
      async () => findOrphans(storage),
      1,
    );
    measurements.push(orphans);

    // 6b. Find clusters
    const clusters = await measure(
      "find-clusters",
      async () => findClusters(storage),
      1,
    );
    measurements.push(clusters);

    // Only run expensive algorithms for <= 10k scale
    if (scale !== "100k") {
      // 6c. Shortest path (between two known nodes)
      if (sampleIds.length >= 2) {
        const sp = await measure(
          "shortest-path",
          async () => {
            await shortestPath(storage, sampleIds[0]!, sampleIds[1]!);
          },
          1,
        );
        measurements.push(sp);
      }

      // 6d. Critical nodes
      const critical = await measure(
        "find-critical-nodes",
        async () => findCriticalNodes(storage, {}, 10),
        1,
      );
      measurements.push(critical);

      // 6e. SPOF detection
      const spof = await measure(
        "find-spof",
        async () => findSinglePointsOfFailure(storage),
        1,
      );
      measurements.push(spof);
    }
  }

  const peakMemory = Math.max(peakAfterInsert, getMemoryMB()) - startMemory;
  const totalDurationMs = Math.round((performance.now() - suiteStart) * 100) / 100;

  return {
    runAt: new Date().toISOString(),
    scale,
    nodeCount: genNodes.result.length,
    edgeCount: genEdges.result.length,
    totalDurationMs,
    measurements,
    peakMemoryMB: Math.max(0, peakMemory),
  };
}

/**
 * Format benchmark results as markdown.
 */
export function formatBenchmarkMarkdown(result: BenchmarkResult): string {
  const lines: string[] = [
    `# Performance Benchmark — ${result.scale.toUpperCase()} Scale`,
    "",
    `**Run at:** ${result.runAt}`,
    `**Nodes:** ${result.nodeCount.toLocaleString()}`,
    `**Edges:** ${result.edgeCount.toLocaleString()}`,
    `**Total Duration:** ${(result.totalDurationMs / 1000).toFixed(2)}s`,
    `**Peak Memory:** ${result.peakMemoryMB.toFixed(1)} MB`,
    "",
    "## Measurements",
    "",
    "| Benchmark | Duration (ms) | Items | Ops/sec |",
    "|-----------|--------------|-------|---------|",
    ...result.measurements.map((m) =>
      `| ${m.name} | ${m.durationMs.toFixed(2)} | ${m.itemCount.toLocaleString()} | ${m.opsPerSecond?.toLocaleString() ?? "—"} |`,
    ),
  ];

  // Performance summary
  const insertOps = result.measurements.find((m) => m.name === "insert-nodes");
  const lookupOps = result.measurements.find((m) => m.name === "point-lookup");

  if (insertOps || lookupOps) {
    lines.push("", "## Summary", "");
    if (insertOps) {
      lines.push(`- **Insert throughput:** ${insertOps.opsPerSecond?.toLocaleString()} nodes/sec`);
    }
    if (lookupOps) {
      lines.push(`- **Point lookup:** ${(lookupOps.durationMs / lookupOps.itemCount).toFixed(2)}ms avg`);
    }
  }

  return lines.join("\n");
}
