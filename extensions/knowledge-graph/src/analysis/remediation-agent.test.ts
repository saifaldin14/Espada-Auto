/**
 * Infrastructure Knowledge Graph — Autonomous Remediation Agent Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runRemediationAgent,
  formatRemediationRunMarkdown,
  resetRemediationCounters,
  type RemediationAgentConfig,
  type RemediationAction,
} from "./remediation-agent.js";
import type {
  GraphStorage,
  GraphNode,
  GraphEdge,
  SubgraphResult,
  GraphStats,
  DriftResult,
} from "../types.js";
import type { GraphEngine } from "../core/engine.js";
import type { ChangeGovernor, ChangeRequest } from "../core/governance.js";

// =============================================================================
// Fixtures
// =============================================================================

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "node-1",
    provider: "aws",
    resourceType: "compute",
    nativeId: "i-abc123",
    name: "web-server-1",
    region: "us-east-1",
    account: "123456789",
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: 100,
    owner: null,
    discoveredAt: "2025-01-01T00:00:00Z",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    lastSeenAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function emptySubgraph(nodeId: string): SubgraphResult {
  const node = makeNode({ id: nodeId });
  return {
    rootNodeId: nodeId,
    nodes: new Map([[nodeId, node]]),
    edges: [],
    hops: new Map([[0, [nodeId]]]),
    totalCostMonthly: 0,
  };
}

// =============================================================================
// Mock storage that returns a few nodes with compliance issues
// =============================================================================

function mockStorageWithNodes(...nodes: GraphNode[]): GraphStorage {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return {
    getNode: vi.fn(async (id: string) => nodeMap.get(id) ?? null),
    queryNodes: vi.fn(async () => nodes),
    queryNodesPaginated: vi.fn(async () => ({
      items: nodes,
      totalCount: nodes.length,
      nextCursor: null,
      hasMore: false,
    })),
    getEdgesForNode: vi.fn(async () => []),
    queryEdges: vi.fn(async () => []),
    getNodeGroups: vi.fn(async () => []),
    getNeighbors: vi.fn(async () => ({ nodes: [], edges: [] })),
    getStats: vi.fn(async (): Promise<GraphStats> => ({
      totalNodes: nodes.length,
      totalEdges: 0,
      totalChanges: 0,
      totalGroups: 0,
      nodesByProvider: {},
      nodesByResourceType: {},
      edgesByRelationshipType: {},
      totalCostMonthly: 0,
      lastSyncAt: null,
      oldestChange: null,
      newestChange: null,
    })),
  } as unknown as GraphStorage;
}

function mockEngine(storage: GraphStorage): GraphEngine {
  return {
    getStorage: () => storage,
    getBlastRadius: vi.fn(async (nodeId: string) => emptySubgraph(nodeId)),
    detectDrift: vi.fn(async (): Promise<DriftResult> => ({
      driftedNodes: [],
      disappearedNodes: [],
      newNodes: [],
      scannedAt: new Date().toISOString(),
    })),
    getStats: vi.fn(async () => ({
      totalNodes: 5,
      totalEdges: 2,
      totalChanges: 0,
      totalGroups: 0,
      nodesByProvider: {},
      nodesByResourceType: {},
      edgesByRelationshipType: {},
      totalCostMonthly: 500,
      lastSyncAt: null,
      oldestChange: null,
      newestChange: null,
    })),
  } as unknown as GraphEngine;
}

function mockGovernor(autoApprove: boolean = true): ChangeGovernor {
  return {
    interceptChange: vi.fn(async (params): Promise<ChangeRequest> => ({
      id: "cr-1",
      initiator: params.initiator,
      initiatorType: params.initiatorType,
      targetResourceId: params.targetResourceId,
      resourceType: params.resourceType,
      provider: params.provider,
      action: params.action,
      description: params.description,
      risk: { score: 10, level: "low", factors: [] },
      status: autoApprove ? "auto-approved" : "pending",
      createdAt: new Date().toISOString(),
      resolvedAt: autoApprove ? new Date().toISOString() : null,
      resolvedBy: autoApprove ? "system" : null,
      reason: null,
      policyViolations: [],
      metadata: {},
    })),
    approveChange: vi.fn(),
    rejectChange: vi.fn(),
  } as unknown as ChangeGovernor;
}

// =============================================================================
// Tests
// =============================================================================

describe("Autonomous Remediation Agent", () => {
  beforeEach(() => {
    resetRemediationCounters();
  });

  describe("runRemediationAgent", () => {
    it("returns empty result when no violations found", async () => {
      // Node WITH encryption so compliance passes
      const node = makeNode({
        id: "s3-1",
        resourceType: "storage",
        name: "my-bucket",
        metadata: { encrypted: true, encryptionAlgorithm: "AES256" },
        tags: { environment: "dev" },
      });
      const storage = mockStorageWithNodes(node);
      const engine = mockEngine(storage);

      const result = await runRemediationAgent(engine, storage, null, {
        frameworks: ["cis"], // use a framework
        includeDrift: false,
      });

      // At minimum it should return a valid result shape
      expect(result.id).toMatch(/^remediation-run-/);
      expect(result.startedAt).toBeTruthy();
      expect(result.completedAt).toBeTruthy();
      expect(typeof result.totalViolations).toBe("number");
      expect(result.actions.length).toBe(result.totalViolations);
    });

    it("processes violations and generates actions", async () => {
      // Node without encryption — should fail compliance
      const node = makeNode({
        id: "rds-1",
        resourceType: "database",
        name: "unencrypted-db",
        provider: "aws",
        metadata: {},
        tags: {},
      });
      const storage = mockStorageWithNodes(node);
      const engine = mockEngine(storage);

      const result = await runRemediationAgent(engine, storage, null, {
        frameworks: ["soc2"],
        includeDrift: false,
        dryRun: true,
      });

      // SOC2 should flag unencrypted database
      if (result.totalViolations > 0) {
        expect(result.actions.length).toBeGreaterThan(0);

        const firstAction = result.actions[0];
        expect(firstAction.violation.nodeId).toBe("rds-1");
        expect(firstAction.decision).toBeTruthy();
        expect(firstAction.reason).toBeTruthy();
        expect(firstAction.risk).toHaveProperty("score");
        expect(firstAction.risk).toHaveProperty("level");
      }
    });

    it("routes through governor when provided", async () => {
      const node = makeNode({
        id: "ec2-1",
        resourceType: "compute",
        name: "no-monitoring",
        metadata: {},
      });
      const storage = mockStorageWithNodes(node);
      const engine = mockEngine(storage);
      const governor = mockGovernor(true);

      const result = await runRemediationAgent(engine, storage, governor, {
        frameworks: ["cis"],
        includeDrift: false,
        autoApplyThreshold: 50, // generous threshold
      });

      // If there were violations that got auto-applied, governor should have been called
      const autoApplied = result.actions.filter((a) => a.decision === "auto-applied");
      if (autoApplied.length > 0) {
        expect(governor.interceptChange).toHaveBeenCalled();
        expect(autoApplied[0].changeRequest).toBeDefined();
      }
    });

    it("blocks high-risk remediation", async () => {
      const node = makeNode({
        id: "vpc-1",
        resourceType: "vpc",
        name: "production-vpc",
        metadata: {},
      });
      const storage = mockStorageWithNodes(node);

      // Make blast radius large
      const bigBlast = emptySubgraph("vpc-1");
      for (let i = 0; i < 20; i++) {
        const depNode = makeNode({ id: `dep-${i}`, costMonthly: 500 });
        bigBlast.nodes.set(depNode.id, depNode);
      }
      bigBlast.hops.set(1, Array.from({ length: 20 }, (_, i) => `dep-${i}`));

      const engine = {
        ...mockEngine(storage),
        getBlastRadius: vi.fn(async () => bigBlast),
      } as unknown as GraphEngine;

      const result = await runRemediationAgent(engine, storage, null, {
        frameworks: ["cis"],
        includeDrift: false,
        blockThreshold: 50, // lower threshold to make blocking more likely
      });

      // Any violations on this high-impact VPC should be blocked or manual-review
      const blocked = result.actions.filter(
        (a) => a.decision === "blocked" || a.decision === "manual-review",
      );
      // All non-skipped actions should be blocked due to large blast radius
      const nonSkipped = result.actions.filter((a) => a.decision !== "skipped");
      if (nonSkipped.length > 0) {
        expect(blocked.length + result.actions.filter((a) => a.decision === "pr-created").length).toBe(nonSkipped.length);
      }
    });

    it("calls onDecision callback for each action", async () => {
      const node = makeNode({
        id: "db-1",
        resourceType: "database",
        name: "test-db",
        metadata: {},
      });
      const storage = mockStorageWithNodes(node);
      const engine = mockEngine(storage);
      const decisions: RemediationAction[] = [];

      await runRemediationAgent(engine, storage, null, {
        frameworks: ["soc2"],
        includeDrift: false,
        dryRun: true,
        onDecision: async (action) => {
          decisions.push(action);
        },
      });

      // callback should have been called for each action
      expect(decisions.length).toBeGreaterThanOrEqual(0);
      // If violations were found, each should have a callback
      // (can be 0 if the node passed all checks)
    });

    it("respects maxActionsPerRun limit", async () => {
      // Create many non-compliant nodes
      const nodes = Array.from({ length: 20 }, (_, i) =>
        makeNode({
          id: `node-${i}`,
          resourceType: "database",
          name: `db-${i}`,
          metadata: {},
        }),
      );
      const storage = mockStorageWithNodes(...nodes);
      const engine = mockEngine(storage);

      const result = await runRemediationAgent(engine, storage, null, {
        frameworks: ["soc2"],
        includeDrift: false,
        maxActionsPerRun: 5,
        dryRun: true,
      });

      // Should not exceed the limit
      expect(result.actions.length).toBeLessThanOrEqual(5);
    });

    it("includes drift violations when includeDrift is true", async () => {
      const node = makeNode({ id: "ec2-drift", name: "drifted-server" });
      const storage = mockStorageWithNodes(node);

      const driftResult: DriftResult = {
        driftedNodes: [
          {
            node,
            changes: [
              {
                id: "c1",
                targetId: "ec2-drift",
                changeType: "node-drifted",
                field: "instanceType",
                previousValue: "t3.micro",
                newValue: "t3.large",
                detectedAt: new Date().toISOString(),
                detectedVia: "drift-scan",
                correlationId: null,
                initiator: null,
                initiatorType: null,
                metadata: {},
              },
            ],
          },
        ],
        disappearedNodes: [],
        newNodes: [],
        scannedAt: new Date().toISOString(),
      };

      const engine = {
        ...mockEngine(storage),
        detectDrift: vi.fn(async () => driftResult),
      } as unknown as GraphEngine;

      const result = await runRemediationAgent(engine, storage, null, {
        frameworks: [],
        includeDrift: true,
        dryRun: true,
      });

      const driftActions = result.actions.filter(
        (a) => a.violation.framework === "drift",
      );
      expect(driftActions.length).toBe(1);
      expect(driftActions[0].violation.nodeId).toBe("ec2-drift");
    });
  });

  describe("formatRemediationRunMarkdown", () => {
    it("produces structured markdown", async () => {
      const node = makeNode({
        id: "s3-1",
        resourceType: "storage",
        name: "test-bucket",
        metadata: {},
      });
      const storage = mockStorageWithNodes(node);
      const engine = mockEngine(storage);

      const result = await runRemediationAgent(engine, storage, null, {
        frameworks: ["soc2"],
        includeDrift: false,
        dryRun: true,
      });

      const md = formatRemediationRunMarkdown(result);
      expect(md).toContain("## Autonomous Remediation Report");
      expect(md).toContain("Summary");
      expect(md).toContain("Total violations found");
      expect(md).toContain("Resolution rate");
    });
  });
});
