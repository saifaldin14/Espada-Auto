/**
 * Tool Registry Tests
 *
 * Validates that the standalone tool registry builds correctly
 * and individual tools execute against an in-memory graph.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { buildToolRegistry, type ToolDefinition, type ToolRegistryDeps } from "./tool-registry.js";
import { InMemoryGraphStorage } from "../storage/memory-store.js";
import { GraphEngine } from "../core/engine.js";
import type { GraphStorage, GraphNodeInput, GraphEdgeInput } from "../types.js";

// =============================================================================
// Helpers
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
    discoveredVia: "api-field",
    metadata: {},
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("Tool Registry", () => {
  let storage: GraphStorage;
  let engine: GraphEngine;
  let tools: ToolDefinition[];
  let toolMap: Map<string, ToolDefinition>;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    await storage.initialize();
    engine = new GraphEngine({ storage });
    const deps: ToolRegistryDeps = { engine, storage };
    tools = buildToolRegistry(deps);
    toolMap = new Map(tools.map((t) => [t.name, t]));
  });

  // ─── Registry structure ────────────────────────────────────────
  describe("registry structure", () => {
    it("builds at least 24 tools (non-temporal)", () => {
      expect(tools.length).toBeGreaterThanOrEqual(24);
    });

    it("all tools have required fields", () => {
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.label).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeTruthy();
        expect(typeof tool.execute).toBe("function");
      }
    });

    it("all tool names are unique", () => {
      const names = tools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it("all tool names start with kg_", () => {
      for (const tool of tools) {
        expect(tool.name).toMatch(/^kg_/);
      }
    });

    it("includes expected core tools", () => {
      const coreTools = [
        "kg_blast_radius",
        "kg_dependencies",
        "kg_cost",
        "kg_drift",
        "kg_spof_analysis",
        "kg_path",
        "kg_orphans",
        "kg_status",
        "kg_export",
        "kg_query",
        "kg_compliance",
        "kg_recommendations",
        "kg_visualize",
        "kg_rbac",
        "kg_benchmark",
        "kg_export_extended",
      ];
      for (const name of coreTools) {
        expect(toolMap.has(name), `missing tool: ${name}`).toBe(true);
      }
    });
  });

  // ─── Tool execution (empty graph) ─────────────────────────────
  describe("execution on empty graph", () => {
    it("kg_status returns graph stats", async () => {
      const tool = toolMap.get("kg_status")!;
      const result = await tool.execute({});
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("Knowledge Graph Status");
      expect(result.content[0].text).toContain("Total nodes");
    });

    it("kg_orphans on empty graph returns zero orphans", async () => {
      const tool = toolMap.get("kg_orphans")!;
      const result = await tool.execute({});
      expect(result.content[0].text).toContain("Orphaned Resources");
      expect(result.content[0].text).toContain("**Found:** 0");
    });

    it("kg_export returns valid JSON output", async () => {
      const tool = toolMap.get("kg_export")!;
      const result = await tool.execute({ format: "json" });
      expect(result.content[0].type).toBe("text");
      // Should be parseable JSON
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    });

    it("kg_governance_summary returns dashboard", async () => {
      const tool = toolMap.get("kg_governance_summary")!;
      const result = await tool.execute({});
      expect(result.content[0].text).toContain("Governance Dashboard");
    });

    it("kg_pending_approvals returns empty list", async () => {
      const tool = toolMap.get("kg_pending_approvals")!;
      const result = await tool.execute({});
      expect(result.content[0].text).toContain("Pending Approvals");
      expect(result.content[0].text).toContain("**Count:** 0");
    });

    it("kg_rbac shows role overview", async () => {
      const tool = toolMap.get("kg_rbac")!;
      const result = await tool.execute({});
      expect(result.content[0].text).toContain("RBAC Policy Overview");
      expect(result.content[0].text).toContain("viewer");
      expect(result.content[0].text).toContain("admin");
    });
  });

  // ─── Tool execution (populated graph) ─────────────────────────
  describe("execution on populated graph", () => {
    beforeEach(async () => {
      await storage.upsertNodes([
        makeNode("vpc-1", { resourceType: "vpc", costMonthly: 0 }),
        makeNode("ec2-1", { resourceType: "compute", costMonthly: 150 }),
        makeNode("ec2-2", { resourceType: "compute", costMonthly: 200 }),
        makeNode("rds-1", { resourceType: "database", costMonthly: 300 }),
        makeNode("orphan-1", { resourceType: "storage" }),
      ]);
      await storage.upsertEdges([
        makeEdge("e1", "ec2-1", "vpc-1"),
        makeEdge("e2", "ec2-2", "vpc-1"),
        makeEdge("e3", "rds-1", "vpc-1"),
        makeEdge("e4", "ec2-1", "rds-1", "connects-to"),
      ]);
    });

    it("kg_status reports correct node count", async () => {
      const tool = toolMap.get("kg_status")!;
      const result = await tool.execute({});
      expect(result.content[0].text).toContain("5"); // 5 nodes
    });

    it("kg_orphans finds orphan-1", async () => {
      const tool = toolMap.get("kg_orphans")!;
      const result = await tool.execute({});
      expect(result.content[0].text).toContain("orphan-1");
    });

    it("kg_path finds route from ec2-1 to vpc-1", async () => {
      const tool = toolMap.get("kg_path")!;
      const result = await tool.execute({ from: "ec2-1", to: "vpc-1" });
      expect(result.content[0].text).toContain("ec2-1");
      expect(result.content[0].text).toContain("vpc-1");
    });

    it("kg_path reports no path for nonexistent nodes", async () => {
      const tool = toolMap.get("kg_path")!;
      const result = await tool.execute({ from: "nope-1", to: "nope-2" });
      expect(result.content[0].text).toContain("No path found");
    });

    it("kg_blast_radius computes impact for vpc-1", async () => {
      const tool = toolMap.get("kg_blast_radius")!;
      const result = await tool.execute({ resourceId: "vpc-1" });
      expect(result.content[0].text).toContain("Blast Radius");
    });

    it("kg_dependencies shows downstream of vpc-1", async () => {
      const tool = toolMap.get("kg_dependencies")!;
      const result = await tool.execute({ resourceId: "vpc-1", direction: "downstream" });
      expect(result.content[0].text).toContain("Dependencies");
    });

    it("kg_request_change submits a change request", async () => {
      const tool = toolMap.get("kg_request_change")!;
      const result = await tool.execute({
        resourceId: "ec2-1",
        action: "delete",
        description: "Decommission old instance",
      });
      expect(result.content[0].text).toContain("Change Request");
      expect(result.content[0].text).toContain("Risk Score");
    });

    it("kg_query IQL finds compute resources", async () => {
      const tool = toolMap.get("kg_query")!;
      const result = await tool.execute({ query: "FIND resources WHERE type = 'compute'" });
      expect(result.content[0].text).toContain("IQL Query Result");
    });

    it("kg_query returns syntax error for invalid IQL", async () => {
      const tool = toolMap.get("kg_query")!;
      const result = await tool.execute({ query: "NOT VALID QUERY" });
      expect(result.content[0].text).toContain("Syntax Error");
    });

    it("kg_export mermaid returns mermaid diagram", async () => {
      const tool = toolMap.get("kg_export")!;
      const result = await tool.execute({ format: "mermaid" });
      expect(result.content[0].text).toContain("graph");
    });

    it("kg_spof_analysis runs without error", async () => {
      const tool = toolMap.get("kg_spof_analysis")!;
      const result = await tool.execute({});
      expect(result.content[0].text).toContain("Single Points of Failure");
    });
  });
});
