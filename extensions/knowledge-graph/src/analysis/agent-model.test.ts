/**
 * Tests for the agent action modeling module (P2.19).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStorage } from "../storage/index.js";
import type { GraphNodeInput, GraphEdgeInput, GraphStorage } from "../types.js";
import {
  registerAgent,
  recordAgentAction,
  getAgents,
  getAgentResources,
  detectAgentConflicts,
  getAgentActivity,
  generateAgentReport,
  formatAgentReportMarkdown,
  buildAgentNodeId,
} from "./agent-model.js";
import type { AgentNode, AgentAction } from "./agent-model.js";

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

const AGENT_1: AgentNode = {
  agentId: "deploy-bot",
  name: "Deploy Bot",
  role: "deployer",
  active: true,
  capabilities: ["deploy", "scale"],
  provider: "aws",
};

const AGENT_2: AgentNode = {
  agentId: "monitor-bot",
  name: "Monitor Bot",
  role: "monitor",
  active: true,
  capabilities: ["monitor", "alert"],
};

// =============================================================================
// Tests
// =============================================================================

describe("Agent Model (P2.19)", () => {
  let storage: GraphStorage;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    await storage.initialize();
  });

  describe("buildAgentNodeId", () => {
    it("builds deterministic node IDs", () => {
      const id = buildAgentNodeId("deploy-bot");
      expect(id).toBe("custom:agents:global:custom:deploy-bot");
    });
  });

  describe("registerAgent", () => {
    it("creates agent node in the graph", async () => {
      const node = await registerAgent(storage, AGENT_1);

      expect(node).toBeDefined();
      expect(node.name).toBe("Deploy Bot");
      expect(node.metadata.isAgent).toBe(true);
      expect(node.metadata.role).toBe("deployer");
      expect(node.status).toBe("running");
      expect(node.provider).toBe("aws");
    });

    it("marks inactive agents as stopped", async () => {
      const inactiveAgent: AgentNode = {
        ...AGENT_1,
        agentId: "inactive",
        active: false,
      };

      const node = await registerAgent(storage, inactiveAgent);
      expect(node.status).toBe("stopped");
    });

    it("stores capabilities in tags and metadata", async () => {
      const node = await registerAgent(storage, AGENT_1);
      expect(node.tags.capabilities).toBe("deploy,scale");
      expect(node.metadata.capabilities).toEqual(["deploy", "scale"]);
    });

    it("defaults provider to custom if not specified", async () => {
      const node = await registerAgent(storage, AGENT_2);
      expect(node.provider).toBe("custom");
    });
  });

  describe("recordAgentAction", () => {
    it("creates edges and changelog entries", async () => {
      const agentNode = await registerAgent(storage, AGENT_1);
      await storage.upsertNode(makeNode("server-1"));

      const action: AgentAction = {
        agentNodeId: agentNode.id,
        targetNodeId: "server-1",
        actionType: "update",
        timestamp: new Date().toISOString(),
        success: true,
        durationMs: 1500,
        costUsd: 0.02,
      };

      await recordAgentAction(storage, action);

      // Verify edge was created
      const edges = await storage.getEdgesForNode(agentNode.id, "downstream");
      expect(edges.length).toBeGreaterThanOrEqual(1);
      const actionEdge = edges.find((e) => e.targetNodeId === "server-1");
      expect(actionEdge).toBeDefined();
      expect(actionEdge!.relationshipType).toBe("writes-to");
    });

    it("records query actions as reads-from", async () => {
      const agentNode = await registerAgent(storage, AGENT_1);
      await storage.upsertNode(makeNode("database-1", { resourceType: "database" }));

      await recordAgentAction(storage, {
        agentNodeId: agentNode.id,
        targetNodeId: "database-1",
        actionType: "query",
        timestamp: new Date().toISOString(),
        success: true,
      });

      const edges = await storage.getEdgesForNode(agentNode.id, "downstream");
      const edge = edges.find((e) => e.targetNodeId === "database-1");
      expect(edge!.relationshipType).toBe("reads-from");
    });

    it("throws error for non-existent agent node", async () => {
      await storage.upsertNode(makeNode("server-1"));

      await expect(
        recordAgentAction(storage, {
          agentNodeId: "nonexistent-agent",
          targetNodeId: "server-1",
          actionType: "update",
          timestamp: new Date().toISOString(),
          success: true,
        }),
      ).rejects.toThrow("Agent node not found");
    });

    it("throws error for non-existent target node", async () => {
      const agentNode = await registerAgent(storage, AGENT_1);

      await expect(
        recordAgentAction(storage, {
          agentNodeId: agentNode.id,
          targetNodeId: "nonexistent-target",
          actionType: "update",
          timestamp: new Date().toISOString(),
          success: true,
        }),
      ).rejects.toThrow("Target node not found");
    });
  });

  describe("getAgents", () => {
    it("returns empty array for empty graph", async () => {
      const agents = await getAgents(storage);
      expect(agents).toEqual([]);
    });

    it("returns only agent nodes", async () => {
      await registerAgent(storage, AGENT_1);
      await registerAgent(storage, AGENT_2);
      await storage.upsertNode(makeNode("regular-node"));

      const agents = await getAgents(storage);
      expect(agents.length).toBe(2);
      expect(agents.every((a) => a.metadata.isAgent === true)).toBe(true);
    });
  });

  describe("getAgentResources", () => {
    it("returns resources touched by agent", async () => {
      const agent = await registerAgent(storage, AGENT_1);
      await storage.upsertNode(makeNode("server-1"));
      await storage.upsertNode(makeNode("server-2"));

      await recordAgentAction(storage, {
        agentNodeId: agent.id,
        targetNodeId: "server-1",
        actionType: "update",
        timestamp: new Date().toISOString(),
        success: true,
      });
      await recordAgentAction(storage, {
        agentNodeId: agent.id,
        targetNodeId: "server-2",
        actionType: "monitor",
        timestamp: new Date().toISOString(),
        success: true,
      });

      const resources = await getAgentResources(storage, agent.id);
      expect(resources.length).toBe(2);
    });
  });

  describe("detectAgentConflicts", () => {
    it("returns empty array with no conflicts", async () => {
      await registerAgent(storage, AGENT_1);
      const conflicts = await detectAgentConflicts(storage);
      expect(conflicts).toEqual([]);
    });

    it("detects two agents writing to same resource", async () => {
      const agent1 = await registerAgent(storage, AGENT_1);
      const agent2 = await registerAgent(storage, AGENT_2);
      await storage.upsertNode(makeNode("shared-server"));

      // Both agents write to the same resource
      await recordAgentAction(storage, {
        agentNodeId: agent1.id,
        targetNodeId: "shared-server",
        actionType: "update",
        timestamp: new Date().toISOString(),
        success: true,
      });
      await recordAgentAction(storage, {
        agentNodeId: agent2.id,
        targetNodeId: "shared-server",
        actionType: "scale",
        timestamp: new Date().toISOString(),
        success: true,
      });

      const conflicts = await detectAgentConflicts(storage);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.conflictType).toBe("concurrent-modify");
      expect(conflicts[0]!.targetName).toBe("shared-server");
    });
  });

  describe("getAgentActivity", () => {
    it("returns per-agent activity summaries", async () => {
      const agent = await registerAgent(storage, AGENT_1);
      await storage.upsertNode(makeNode("server-1"));

      await recordAgentAction(storage, {
        agentNodeId: agent.id,
        targetNodeId: "server-1",
        actionType: "update",
        timestamp: new Date().toISOString(),
        success: true,
        costUsd: 0.05,
      });

      const summaries = await getAgentActivity(storage);
      expect(summaries.length).toBe(1);
      expect(summaries[0]!.agentName).toBe("Deploy Bot");
      expect(summaries[0]!.totalActions).toBeGreaterThanOrEqual(1);
    });
  });

  describe("generateAgentReport", () => {
    it("returns full report with agents and conflicts", async () => {
      const agent1 = await registerAgent(storage, AGENT_1);
      const agent2 = await registerAgent(storage, AGENT_2);
      await storage.upsertNode(makeNode("server-1"));

      await recordAgentAction(storage, {
        agentNodeId: agent1.id,
        targetNodeId: "server-1",
        actionType: "update",
        timestamp: new Date().toISOString(),
        success: true,
      });
      await recordAgentAction(storage, {
        agentNodeId: agent2.id,
        targetNodeId: "server-1",
        actionType: "remediate",
        timestamp: new Date().toISOString(),
        success: true,
      });

      const report = await generateAgentReport(storage);
      expect(report.totalAgents).toBe(2);
      expect(report.generatedAt).toBeDefined();
      expect(report.conflicts.length).toBeGreaterThanOrEqual(1);
    });

    it("accepts since parameter", async () => {
      await registerAgent(storage, AGENT_1);
      const report = await generateAgentReport(storage, "2020-01-01T00:00:00Z");
      expect(report.totalAgents).toBe(1);
    });
  });

  describe("formatAgentReportMarkdown", () => {
    it("formats the report as markdown", async () => {
      const agent = await registerAgent(storage, AGENT_1);
      await storage.upsertNode(makeNode("server-1"));

      await recordAgentAction(storage, {
        agentNodeId: agent.id,
        targetNodeId: "server-1",
        actionType: "update",
        timestamp: new Date().toISOString(),
        success: true,
      });

      const report = await generateAgentReport(storage);
      const md = formatAgentReportMarkdown(report);
      expect(md).toContain("Agent Activity Report");
      expect(md).toContain("Deploy Bot");
    });
  });
});
