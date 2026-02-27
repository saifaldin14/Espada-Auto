/**
 * Infrastructure Knowledge Graph — Extended Export Tests (P3.29)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStorage } from "../storage/memory-store.js";
import type {
  GraphStorage,
  GraphNodeInput,
  GraphEdgeInput,
} from "../types.js";
import { exportExtended } from "./export-extended.js";
import type { ExtendedExportFormat, ExtendedExportResult } from "./export-extended.js";

// =============================================================================
// Fixtures
// =============================================================================

function makeNode(id: string, overrides?: Partial<GraphNodeInput>): GraphNodeInput {
  return {
    id,
    name: id,
    provider: "aws",
    account: "111111",
    region: "us-east-1",
    resourceType: "compute",
    nativeId: id,
    status: "running",
    tags: { env: "production", team: "infra" },
    metadata: { az: "us-east-1a" },
    costMonthly: 150.0,
    owner: "ops-team",
    createdAt: null,
    ...overrides,
  };
}

function makeEdge(src: string, tgt: string, rel = "connects-to"): GraphEdgeInput {
  return {
    id: `${src}:${rel}:${tgt}`,
    sourceNodeId: src,
    targetNodeId: tgt,
    relationshipType: rel,
    confidence: 0.95,
    discoveredVia: "api-list",
    metadata: {},
  };
}

let storage: InMemoryGraphStorage;

beforeEach(async () => {
  storage = new InMemoryGraphStorage();
  await storage.initialize();

  const nodes: GraphNodeInput[] = [
    makeNode("web-1"),
    makeNode("db-1", { resourceType: "database", costMonthly: 300 }),
    makeNode("cache-1", { resourceType: "cache", tags: { env: "staging" }, costMonthly: 80 }),
    makeNode("orphan-1", { resourceType: "storage", costMonthly: 20 }),
  ];
  const edges: GraphEdgeInput[] = [
    makeEdge("web-1", "db-1", "connects-to"),
    makeEdge("web-1", "cache-1", "reads-from"),
    makeEdge("db-1", "cache-1", "writes-to"),
  ];
  await storage.upsertNodes(nodes);
  await storage.upsertEdges(edges);
});

// =============================================================================
// Tests — YAML Export
// =============================================================================

describe("exportExtended(yaml)", () => {
  it("returns valid YAML-formatted output", async () => {
    const result = await exportExtended(storage, "yaml");
    expect(result.format).toBe("yaml");
    expect(result.nodeCount).toBe(4);
    expect(result.edgeCount).toBe(3);
    expect(result.content).toContain("nodes:");
    expect(result.content).toContain("edges:");
  });

  it("includes node fields in YAML", async () => {
    const result = await exportExtended(storage, "yaml");
    expect(result.content).toContain("id: web-1");
    expect(result.content).toContain("provider: aws");
    expect(result.content).toContain("resourceType: compute");
    expect(result.content).toContain("region: us-east-1");
  });

  it("includes edge fields in YAML", async () => {
    const result = await exportExtended(storage, "yaml");
    expect(result.content).toContain("source: web-1");
    expect(result.content).toContain("target: db-1");
    expect(result.content).toContain("relationship: connects-to");
  });

  it("includes cost when requested", async () => {
    const result = await exportExtended(storage, "yaml", { includeCost: true });
    expect(result.content).toContain("costMonthly: 150");
    expect(result.content).toContain("costMonthly: 300");
  });

  it("excludes cost by default", async () => {
    const result = await exportExtended(storage, "yaml", { includeCost: false });
    expect(result.content).not.toContain("costMonthly:");
  });

  it("includes metadata/tags when requested", async () => {
    const result = await exportExtended(storage, "yaml", { includeMetadata: true });
    expect(result.content).toContain("tags:");
    expect(result.content).toContain("env: production");
  });

  it("includes header comment with counts", async () => {
    const result = await exportExtended(storage, "yaml");
    expect(result.content).toContain("# Nodes: 4");
    expect(result.content).toContain("# Edges: 3");
  });

  it("respects filter by provider", async () => {
    const result = await exportExtended(storage, "yaml", {
      filter: { provider: "aws" },
    });
    expect(result.nodeCount).toBe(4); // all are AWS
  });

  it("respects maxNodes limit", async () => {
    const result = await exportExtended(storage, "yaml", { maxNodes: 2 });
    expect(result.nodeCount).toBe(2);
  });
});

// =============================================================================
// Tests — CSV Export
// =============================================================================

describe("exportExtended(csv)", () => {
  it("returns valid CSV output with sections", async () => {
    const result = await exportExtended(storage, "csv");
    expect(result.format).toBe("csv");
    expect(result.content).toContain("# NODES");
    expect(result.content).toContain("# EDGES");
  });

  it("includes node CSV headers", async () => {
    const result = await exportExtended(storage, "csv");
    expect(result.content).toContain("id,name,provider,resourceType,region,account,status");
  });

  it("includes edge CSV headers", async () => {
    const result = await exportExtended(storage, "csv");
    expect(result.content).toContain("id,source,target,relationship,confidence,discoveredVia");
  });

  it("includes node data rows", async () => {
    const result = await exportExtended(storage, "csv");
    expect(result.content).toContain("web-1");
    expect(result.content).toContain("db-1");
    expect(result.content).toContain("compute");
    expect(result.content).toContain("database");
  });

  it("includes cost column when requested", async () => {
    const result = await exportExtended(storage, "csv", { includeCost: true });
    // Headers should include costMonthly
    const lines = result.content.split("\n");
    const headerLine = lines.find((l) => l.startsWith("id,name"));
    expect(headerLine).toContain("costMonthly");
  });

  it("includes tags column when metadata is requested", async () => {
    const result = await exportExtended(storage, "csv", { includeMetadata: true });
    const lines = result.content.split("\n");
    const headerLine = lines.find((l) => l.startsWith("id,name"));
    expect(headerLine).toContain("tags");
    // Tags should be semicolon-delimited
    expect(result.content).toContain("env=production");
  });

  it("properly escapes CSV fields with special characters", async () => {
    // Add a node with a comma in the name
    await storage.upsertNode(makeNode("special,node", {
      name: "node, with comma",
    }));
    const result = await exportExtended(storage, "csv");
    // Should be wrapped in quotes
    expect(result.content).toContain('"node, with comma"');
  });

  it("reports correct counts", async () => {
    const result = await exportExtended(storage, "csv");
    expect(result.nodeCount).toBe(4);
    expect(result.edgeCount).toBe(3);
  });
});

// =============================================================================
// Tests — OpenLineage Export
// =============================================================================

describe("exportExtended(openlineage)", () => {
  it("returns valid OpenLineage JSON", async () => {
    const result = await exportExtended(storage, "openlineage");
    expect(result.format).toBe("openlineage");
    const parsed = JSON.parse(result.content);
    expect(parsed._type).toBe("openlineage-export");
    expect(parsed._producer).toBe("espada-knowledge-graph");
  });

  it("includes lineage events for edges", async () => {
    const result = await exportExtended(storage, "openlineage");
    const parsed = JSON.parse(result.content);
    expect(parsed.events.length).toBeGreaterThan(0);
  });

  it("events follow OpenLineage schema structure", async () => {
    const result = await exportExtended(storage, "openlineage");
    const parsed = JSON.parse(result.content);
    const event = parsed.events[0];
    expect(event.eventType).toBe("COMPLETE");
    expect(event.schemaURL).toContain("openlineage.io");
    expect(event.job).toBeDefined();
    expect(event.inputs).toBeInstanceOf(Array);
    expect(event.outputs).toBeInstanceOf(Array);
    expect(event.producer).toContain("espada.dev");
  });

  it("standalone nodes are listed as datasets", async () => {
    const result = await exportExtended(storage, "openlineage");
    const parsed = JSON.parse(result.content);
    // orphan-1 has no edges, should be standalone
    expect(parsed.datasets.length).toBeGreaterThan(0);
    const orphanDs = parsed.datasets.find(
      (d: { name: string }) => d.name === "orphan-1",
    );
    expect(orphanDs).toBeDefined();
    expect(orphanDs.namespace).toBe("aws");
  });

  it("includes summary section", async () => {
    const result = await exportExtended(storage, "openlineage");
    const parsed = JSON.parse(result.content);
    expect(parsed.summary.totalNodes).toBe(4);
    expect(parsed.summary.totalEdges).toBe(3);
    expect(parsed.summary.totalStandaloneDatasets).toBeGreaterThan(0);
  });

  it("includes cost facet when requested", async () => {
    const result = await exportExtended(storage, "openlineage", { includeCost: true });
    const parsed = JSON.parse(result.content);
    // Check that at least one event input has cost info
    const hasCostField = parsed.events.some((ev: Record<string, unknown>) => {
      const inputs = ev.inputs as Array<{ facets: { schema: { fields: Array<{ name: string }> } } }>;
      return inputs?.some((inp) =>
        inp.facets?.schema?.fields?.some((f) => f.name === "costMonthly"),
      );
    });
    expect(hasCostField).toBe(true);
  });

  it("includes metadata facet when requested", async () => {
    const result = await exportExtended(storage, "openlineage", { includeMetadata: true });
    const parsed = JSON.parse(result.content);
    // Check that at least one event input has custom metadata
    const hasCustom = parsed.events.some((ev: Record<string, unknown>) => {
      const inputs = ev.inputs as Array<{ facets: { custom?: unknown } }>;
      return inputs?.some((inp) => inp.facets?.custom !== undefined);
    });
    expect(hasCustom).toBe(true);
  });

  it("deduplicates edge events by pair", async () => {
    const result = await exportExtended(storage, "openlineage");
    const parsed = JSON.parse(result.content);
    // Each source→target pair should appear at most once
    const pairs = parsed.events.map(
      (ev: { inputs: Array<{ name: string }>; outputs: Array<{ name: string }> }) =>
        `${ev.inputs[0]?.name}→${ev.outputs[0]?.name}`,
    );
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

// =============================================================================
// Tests — Cross-Format
// =============================================================================

describe("exportExtended (cross-format)", () => {
  it("all formats return consistent node/edge counts", async () => {
    const formats: ExtendedExportFormat[] = ["yaml", "csv", "openlineage"];
    const results: ExtendedExportResult[] = [];

    for (const fmt of formats) {
      results.push(await exportExtended(storage, fmt));
    }

    // All should agree on counts
    for (const r of results) {
      expect(r.nodeCount).toBe(4);
      expect(r.edgeCount).toBe(3);
    }
  });

  it("maxNodes applies to all formats", async () => {
    const formats: ExtendedExportFormat[] = ["yaml", "csv", "openlineage"];
    for (const fmt of formats) {
      const result = await exportExtended(storage, fmt, { maxNodes: 2 });
      expect(result.nodeCount).toBe(2);
    }
  });

  it("empty graph produces valid output for all formats", async () => {
    const emptyStorage = new InMemoryGraphStorage();
    await emptyStorage.initialize();

    for (const fmt of ["yaml", "csv", "openlineage"] as ExtendedExportFormat[]) {
      const result = await exportExtended(emptyStorage, fmt);
      expect(result.nodeCount).toBe(0);
      expect(result.edgeCount).toBe(0);
      expect(result.content.length).toBeGreaterThan(0);
    }
  });
});
