/**
 * Tests for the graph export module.
 *
 * Tests JSON, DOT, and Mermaid export formats.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStorage } from "./storage/index.js";
import { exportTopology } from "./export.js";
import type { GraphNodeInput, GraphEdgeInput, GraphStorage } from "./types.js";

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

describe("Graph Export", () => {
  let storage: GraphStorage;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    await storage.initialize();

    // Build a small topology:
    //   web-server --runs-in--> vpc
    //   web-server --depends-on--> database
    //   database --runs-in--> vpc
    await storage.upsertNodes([
      makeNode("web-server", { resourceType: "compute", costMonthly: 100, name: "web-server" }),
      makeNode("vpc", { resourceType: "vpc", name: "prod-vpc" }),
      makeNode("database", { resourceType: "database", costMonthly: 250, name: "prod-db" }),
    ]);

    await storage.upsertEdges([
      makeEdge("e1", "web-server", "vpc", "runs-in"),
      makeEdge("e2", "web-server", "database", "depends-on"),
      makeEdge("e3", "database", "vpc", "runs-in"),
    ]);
  });

  // ===========================================================================
  // JSON Export
  // ===========================================================================

  describe("JSON export", () => {
    it("should export valid JSON with all nodes and edges", async () => {
      const result = await exportTopology(storage, "json");

      expect(result.format).toBe("json");
      expect(result.nodeCount).toBe(3);
      expect(result.edgeCount).toBe(3);

      const data = JSON.parse(result.content);
      expect(data.nodes).toHaveLength(3);
      expect(data.edges).toHaveLength(3);
      expect(data.exportedAt).toBeDefined();
    });

    it("should include cost data when requested", async () => {
      const result = await exportTopology(storage, "json", { includeCost: true });
      const data = JSON.parse(result.content);

      const webServer = data.nodes.find((n: Record<string, unknown>) => n.id === "web-server");
      expect(webServer.costMonthly).toBe(100);
    });

    it("should exclude cost data when not requested", async () => {
      const result = await exportTopology(storage, "json", { includeCost: false });
      const data = JSON.parse(result.content);

      const webServer = data.nodes.find((n: Record<string, unknown>) => n.id === "web-server");
      expect(webServer.costMonthly).toBeUndefined();
    });

    it("should include metadata when requested", async () => {
      const result = await exportTopology(storage, "json", { includeMetadata: true });
      const data = JSON.parse(result.content);

      const webServer = data.nodes.find((n: Record<string, unknown>) => n.id === "web-server");
      expect(webServer.tags).toBeDefined();
      expect(webServer.metadata).toBeDefined();
    });

    it("should filter by provider", async () => {
      // Add an Azure node
      await storage.upsertNode(
        makeNode("azure-vm", { provider: "azure", name: "azure-vm", resourceType: "compute" }),
      );

      const result = await exportTopology(storage, "json", {
        filter: { provider: "aws" },
      });
      const data = JSON.parse(result.content);

      expect(data.nodes.every((n: Record<string, unknown>) => n.provider === "aws")).toBe(true);
    });

    it("should respect maxNodes limit", async () => {
      const result = await exportTopology(storage, "json", { maxNodes: 2 });

      expect(result.nodeCount).toBe(2);
    });
  });

  // ===========================================================================
  // DOT Export
  // ===========================================================================

  describe("DOT export", () => {
    it("should produce valid DOT format", async () => {
      const result = await exportTopology(storage, "dot");

      expect(result.format).toBe("dot");
      expect(result.content).toContain("digraph InfrastructureGraph");
      expect(result.content).toContain("rankdir=LR");
      expect(result.content).toContain("}");
    });

    it("should include provider subgraphs", async () => {
      const result = await exportTopology(storage, "dot");

      expect(result.content).toContain("subgraph cluster_aws");
      expect(result.content).toContain('label="AWS"');
    });

    it("should include edges with relationship labels", async () => {
      const result = await exportTopology(storage, "dot");

      expect(result.content).toContain('label="runs-in"');
      expect(result.content).toContain('label="depends-on"');
    });

    it("should use dashed style for low-confidence edges", async () => {
      await storage.upsertEdge({
        id: "e-low",
        sourceNodeId: "web-server",
        targetNodeId: "database",
        relationshipType: "monitors",
        confidence: 0.5,
        discoveredVia: "runtime-trace",
        metadata: {},
      });

      const result = await exportTopology(storage, "dot");
      expect(result.content).toContain("style=dashed");
    });

    it("should include cost in labels when requested", async () => {
      const result = await exportTopology(storage, "dot", { includeCost: true });

      expect(result.content).toContain("$100/mo");
      expect(result.content).toContain("$250/mo");
    });
  });

  // ===========================================================================
  // Mermaid Export
  // ===========================================================================

  describe("Mermaid export", () => {
    it("should produce valid Mermaid flowchart", async () => {
      const result = await exportTopology(storage, "mermaid");

      expect(result.format).toBe("mermaid");
      expect(result.content).toContain("flowchart LR");
    });

    it("should include provider subgraphs", async () => {
      const result = await exportTopology(storage, "mermaid");

      expect(result.content).toContain("subgraph AWS");
      expect(result.content).toContain("end");
    });

    it("should include edges with relationship labels", async () => {
      const result = await exportTopology(storage, "mermaid");

      expect(result.content).toContain("|runs-in|");
      expect(result.content).toContain("|depends-on|");
    });

    it("should use dashed arrows for low-confidence edges", async () => {
      await storage.upsertEdge({
        id: "e-low",
        sourceNodeId: "web-server",
        targetNodeId: "database",
        relationshipType: "monitors",
        confidence: 0.5,
        discoveredVia: "runtime-trace",
        metadata: {},
      });

      const result = await exportTopology(storage, "mermaid");
      expect(result.content).toContain("-.->");
    });

    it("should use different shapes for different resource types", async () => {
      const result = await exportTopology(storage, "mermaid");

      // database nodes get cylindrical shape [(...))]
      expect(result.content).toMatch(/\[\("/);
      // vpc nodes get stadium shape ([...])
      expect(result.content).toMatch(/\(\[/);
    });

    it("should handle multi-provider topologies", async () => {
      await storage.upsertNode(
        makeNode("azure-vm", { provider: "azure", name: "azure-vm" }),
      );

      const result = await exportTopology(storage, "mermaid");

      expect(result.content).toContain("subgraph AWS");
      expect(result.content).toContain("subgraph AZURE");
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("should handle empty graph", async () => {
      const emptyStorage = new InMemoryGraphStorage();
      await emptyStorage.initialize();

      const jsonResult = await exportTopology(emptyStorage, "json");
      expect(jsonResult.nodeCount).toBe(0);
      expect(jsonResult.edgeCount).toBe(0);

      const dotResult = await exportTopology(emptyStorage, "dot");
      expect(dotResult.content).toContain("digraph");

      const mermaidResult = await exportTopology(emptyStorage, "mermaid");
      expect(mermaidResult.content).toContain("flowchart LR");
    });

    it("should handle nodes with no edges", async () => {
      const solo = new InMemoryGraphStorage();
      await solo.initialize();
      await solo.upsertNode(makeNode("lonely"));

      const result = await exportTopology(solo, "json");
      expect(result.nodeCount).toBe(1);
      expect(result.edgeCount).toBe(0);
    });
  });
});
