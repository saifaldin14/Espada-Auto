/**
 * Tests for the graph visualization export module (P2.16).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStorage } from "../storage/index.js";
import type { GraphNodeInput, GraphEdgeInput, GraphStorage } from "../types.js";
import {
  exportVisualization,
  DEFAULT_COLORS,
} from "./visualization.js";
import type { VisualizationFormat } from "./visualization.js";

// =============================================================================
// Fixtures
// =============================================================================

function makeNode(id: string, overrides?: Partial<GraphNodeInput>): GraphNodeInput {
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
    ...overrides,
  };
}

function makeEdge(id: string, from: string, to: string, rel = "runs-in"): GraphEdgeInput {
  return {
    id,
    sourceNodeId: from,
    targetNodeId: to,
    relationshipType: rel as GraphEdgeInput["relationshipType"],
    confidence: 1.0,
    discoveredVia: "config-scan",
    metadata: {},
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("Graph Visualization (P2.16)", () => {
  let storage: GraphStorage;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    await storage.initialize();
  });

  describe("DEFAULT_COLORS", () => {
    it("has color entries for common resource types", () => {
      expect(DEFAULT_COLORS.compute).toBeDefined();
      expect(DEFAULT_COLORS.database).toBeDefined();
      expect(DEFAULT_COLORS.storage).toBeDefined();
      expect(DEFAULT_COLORS.network).toBeDefined();
      expect(DEFAULT_COLORS.custom).toBeDefined();
    });

    it("colors are valid hex codes", () => {
      for (const color of Object.values(DEFAULT_COLORS)) {
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });
  });

  describe("exportVisualization — Cytoscape", () => {
    it("returns empty visualization for empty graph", async () => {
      const result = await exportVisualization(storage, "cytoscape");
      expect(result.format).toBe("cytoscape");
      expect(result.nodeCount).toBe(0);
      expect(result.edgeCount).toBe(0);
    });

    it("exports nodes and edges as cytoscape JSON", async () => {
      await storage.upsertNode(makeNode("server-1", { costMonthly: 100 }));
      await storage.upsertNode(makeNode("vpc-1", { resourceType: "vpc" }));
      await storage.upsertEdge(makeEdge("e1", "server-1", "vpc-1"));

      const result = await exportVisualization(storage, "cytoscape");
      expect(result.nodeCount).toBe(2);
      expect(result.edgeCount).toBe(1);

      const data = JSON.parse(result.content);
      expect(data.format).toBe("cytoscape");
      expect(data.elements).toBeDefined();
      expect(data.style).toBeDefined();
      expect(data.layout).toBeDefined();
    });

    it("includes provider grouping when requested", async () => {
      await storage.upsertNode(makeNode("aws-server", { provider: "aws" }));
      await storage.upsertNode(makeNode("gcp-server", { provider: "gcp", account: "gcp-proj" }));

      const result = await exportVisualization(storage, "cytoscape", {
        groupByProvider: true,
      });

      expect(result.groupCount).toBeGreaterThan(0);
      const data = JSON.parse(result.content);
      const groups = data.elements.filter(
        (e: Record<string, unknown>) =>
          typeof e.classes === "string" && (e.classes as string).includes("group"),
      );
      expect(groups.length).toBeGreaterThanOrEqual(2);
    });

    it("includes cost labels when requested", async () => {
      await storage.upsertNode(makeNode("expensive", { costMonthly: 500 }));

      const result = await exportVisualization(storage, "cytoscape", {
        includeCost: true,
      });

      const data = JSON.parse(result.content);
      const nodeEl = data.elements.find(
        (e: Record<string, Record<string, unknown>>) => e.data?.id === "expensive",
      );
      expect(nodeEl.data.costLabel).toContain("$500");
    });

    it("includes metadata when requested", async () => {
      await storage.upsertNode(
        makeNode("tagged", { tags: { Environment: "production" } }),
      );

      const result = await exportVisualization(storage, "cytoscape", {
        includeMetadata: true,
      });

      const data = JSON.parse(result.content);
      const nodeEl = data.elements.find(
        (e: Record<string, Record<string, unknown>>) => e.data?.id === "tagged",
      );
      expect(nodeEl.data.tags).toBeDefined();
      expect(nodeEl.data.tags.Environment).toBe("production");
    });

    it("respects maxNodes limit", async () => {
      for (let i = 0; i < 10; i++) {
        await storage.upsertNode(makeNode(`node-${i}`));
      }

      const result = await exportVisualization(storage, "cytoscape", {
        maxNodes: 5,
      });

      expect(result.nodeCount).toBeLessThanOrEqual(5);
    });

    it("highlights node and neighborhood", async () => {
      await storage.upsertNode(makeNode("center"));
      await storage.upsertNode(makeNode("neighbor-1"));
      await storage.upsertNode(makeNode("neighbor-2"));
      await storage.upsertNode(makeNode("far-away"));
      await storage.upsertEdge(makeEdge("e1", "center", "neighbor-1"));
      await storage.upsertEdge(makeEdge("e2", "center", "neighbor-2"));

      const result = await exportVisualization(storage, "cytoscape", {
        highlightNodeId: "center",
        highlightDepth: 1,
      });

      const data = JSON.parse(result.content);
      const highlightedNodes = data.elements.filter(
        (e: Record<string, Record<string, unknown>>) =>
          e.data?.id && typeof e.classes === "string" && (e.classes as string).includes("highlighted"),
      );
      expect(highlightedNodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("exportVisualization — D3 Force", () => {
    it("returns d3-force format", async () => {
      await storage.upsertNode(makeNode("node-1"));
      await storage.upsertNode(makeNode("node-2"));
      await storage.upsertEdge(makeEdge("e1", "node-1", "node-2"));

      const result = await exportVisualization(storage, "d3-force");
      expect(result.format).toBe("d3-force");

      const data = JSON.parse(result.content);
      expect(data.format).toBe("d3-force");
      expect(data.nodes).toBeDefined();
      expect(data.links).toBeDefined();
      expect(data.simulation).toBeDefined();
      expect(data.nodes.length).toBe(2);
      expect(data.links.length).toBe(1);
    });

    it("d3 nodes have required properties", async () => {
      await storage.upsertNode(makeNode("test-node", { costMonthly: 50 }));

      const result = await exportVisualization(storage, "d3-force");
      const data = JSON.parse(result.content);
      const node = data.nodes[0];

      expect(node.id).toBe("test-node");
      expect(node.label).toBeDefined();
      expect(node.group).toBe("aws");
      expect(node.color).toBeDefined();
      expect(node.radius).toBeGreaterThan(0);
    });

    it("d3 links have confidence-based stroke", async () => {
      await storage.upsertNode(makeNode("a"));
      await storage.upsertNode(makeNode("b"));
      await storage.upsertEdge({
        id: "e1",
        sourceNodeId: "a",
        targetNodeId: "b",
        relationshipType: "runs-in",
        confidence: 0.5,
        discoveredVia: "config-scan",
        metadata: {},
      });

      const result = await exportVisualization(storage, "d3-force");
      const data = JSON.parse(result.content);
      const link = data.links[0];

      expect(link.confidence).toBe(0.5);
      expect(link.strokeDasharray).toBe("5,5");
    });
  });

  describe("Layout config", () => {
    it("uses cose layout for force-directed", async () => {
      const result = await exportVisualization(storage, "cytoscape", {
        layout: "force-directed",
      });
      expect(result.layoutConfig.name).toBe("cose");
    });

    it("uses dagre layout for hierarchical", async () => {
      const result = await exportVisualization(storage, "cytoscape", {
        layout: "hierarchical",
      });
      expect(result.layoutConfig.name).toBe("dagre");
    });

    it("uses circle layout for circular", async () => {
      const result = await exportVisualization(storage, "cytoscape", {
        layout: "circular",
      });
      expect(result.layoutConfig.name).toBe("circle");
    });

    it("uses grid layout for grid", async () => {
      const result = await exportVisualization(storage, "cytoscape", {
        layout: "grid",
      });
      expect(result.layoutConfig.name).toBe("grid");
    });

    it("uses concentric layout for concentric", async () => {
      const result = await exportVisualization(storage, "cytoscape", {
        layout: "concentric",
      });
      expect(result.layoutConfig.name).toBe("concentric");
    });
  });

  describe("Filter support", () => {
    it("filters nodes by provider", async () => {
      await storage.upsertNode(makeNode("aws-node", { provider: "aws" }));
      await storage.upsertNode(makeNode("gcp-node", { provider: "gcp", account: "gcp-proj" }));

      const result = await exportVisualization(storage, "cytoscape", {
        filter: { provider: "aws" },
      });

      expect(result.nodeCount).toBe(1);
    });

    it("filters nodes by resource type", async () => {
      await storage.upsertNode(makeNode("server", { resourceType: "compute" }));
      await storage.upsertNode(makeNode("db", { resourceType: "database" }));

      const result = await exportVisualization(storage, "d3-force", {
        filter: { resourceType: "database" },
      });

      expect(result.nodeCount).toBe(1);
    });
  });
});
