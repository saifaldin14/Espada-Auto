/**
 * Tests for the agent cost allocation module.
 *
 * Since computeCostAllocations requires a full GraphStorage with agent nodes
 * and edges, we test the formatCostAllocationMarkdown function directly and
 * construct valid CostAllocationReport objects to verify formatting.
 */

import { describe, it, expect } from "vitest";
import {
  formatCostAllocationMarkdown,
} from "./agent-cost-allocation.js";
import type {
  CostAllocationReport,
  CostAllocationEntry,
  AgentCostSummary,
  AgentBudgetStatus,
} from "./agent-cost-allocation.js";

// =============================================================================
// Helpers
// =============================================================================

function makeReport(overrides: Partial<CostAllocationReport> = {}): CostAllocationReport {
  const entry: CostAllocationEntry = {
    agentNodeId: "agent-1",
    agentName: "deploy-bot",
    resourceNodeId: "res-1",
    resourceName: "web-server",
    resourceType: "compute",
    provider: "aws",
    allocatedCostMonthly: 100,
    allocationMethod: "exclusive",
    fraction: 1.0,
    actionCostUsd: 0.05,
  };

  const summary: AgentCostSummary = {
    agentNodeId: "agent-1",
    agentName: "deploy-bot",
    totalInfraCost: 100,
    totalActionCost: 0.05,
    totalCost: 100.05,
    resourceCount: 1,
    byResourceType: { compute: 100 },
    byProvider: { aws: 100 },
    topResources: [{ nodeId: "res-1", name: "web-server", resourceType: "compute", cost: 100 }],
    costPerAction: 0.05,
    costPerResource: 100,
  };

  return {
    generatedAt: new Date().toISOString(),
    allocations: [entry],
    agentSummaries: [summary],
    budgetStatus: [],
    summary: {
      totalAllocatedCost: 100,
      totalUnallocatedCost: 50,
      agentCount: 1,
      resourceCount: 1,
    },
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("Agent Cost Allocation", () => {
  describe("formatCostAllocationMarkdown", () => {
    it("renders a report with allocations", () => {
      const report = makeReport();
      const md = formatCostAllocationMarkdown(report);

      expect(md).toContain("Cost Allocation");
      expect(md).toContain("deploy-bot");
      expect(md).toContain("100");
    });

    it("includes budget status when present", () => {
      const budgetStatus: AgentBudgetStatus = {
        agentNodeId: "agent-1",
        agentName: "deploy-bot",
        budget: 200,
        spent: 100.05,
        remaining: 99.95,
        utilization: 0.5,
        status: "under",
      };

      const report = makeReport({ budgetStatus: [budgetStatus] });
      const md = formatCostAllocationMarkdown(report);

      expect(md).toContain("deploy-bot");
      expect(md).toContain("200");
    });

    it("handles empty allocations", () => {
      const report = makeReport({
        allocations: [],
        agentSummaries: [],
        summary: {
          totalAllocatedCost: 0,
          totalUnallocatedCost: 500,
          agentCount: 0,
          resourceCount: 0,
        },
      });

      const md = formatCostAllocationMarkdown(report);
      expect(md).toContain("Cost Allocation");
    });

    it("includes top resources per agent section", () => {
      const report = makeReport({
        budgetStatus: [
          {
            agentNodeId: "agent-1",
            agentName: "deploy-bot",
            budget: 200,
            spent: 100.05,
            remaining: 99.95,
            utilization: 0.5,
            status: "under",
          },
        ],
      });
      const md = formatCostAllocationMarkdown(report);

      expect(md).toContain("Top Resources per Agent");
      expect(md).toContain("web-server");
      expect(md).toContain("compute");
    });

    it("shows multiple agents", () => {
      const report = makeReport({
        agentSummaries: [
          {
            agentNodeId: "agent-1",
            agentName: "deploy-bot",
            totalInfraCost: 100,
            totalActionCost: 0.05,
            totalCost: 100.05,
            resourceCount: 1,
            byResourceType: { compute: 100 },
            byProvider: { aws: 100 },
            topResources: [{ nodeId: "res-1", name: "web-server", resourceType: "compute", cost: 100 }],
            costPerAction: 0.05,
            costPerResource: 100,
          },
          {
            agentNodeId: "agent-2",
            agentName: "monitor-bot",
            totalInfraCost: 50,
            totalActionCost: 0.02,
            totalCost: 50.02,
            resourceCount: 2,
            byResourceType: { database: 50 },
            byProvider: { aws: 50 },
            topResources: [{ nodeId: "res-2", name: "main-db", resourceType: "database", cost: 50 }],
            costPerAction: 0.01,
            costPerResource: 25,
          },
        ],
      });

      const md = formatCostAllocationMarkdown(report);
      expect(md).toContain("deploy-bot");
      expect(md).toContain("monitor-bot");
    });
  });

  describe("CostAllocationEntry type", () => {
    it("constructs a valid entry", () => {
      const entry: CostAllocationEntry = {
        agentNodeId: "a1",
        agentName: "bot",
        resourceNodeId: "r1",
        resourceName: "db",
        resourceType: "database",
        provider: "aws",
        allocatedCostMonthly: 200,
        allocationMethod: "proportional",
        fraction: 0.5,
        actionCostUsd: 1.0,
      };
      expect(entry.fraction).toBe(0.5);
      expect(entry.allocationMethod).toBe("proportional");
    });
  });
});
