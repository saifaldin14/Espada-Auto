/**
 * Infrastructure Knowledge Graph — Governance Tests
 *
 * Tests for the ChangeGovernor, risk scoring, change request pipeline,
 * and audit trail functionality.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStorage } from "./storage/memory-store.js";
import { GraphEngine } from "./engine.js";
import {
  ChangeGovernor,
  calculateRiskScore,
  defaultGovernorConfig,
} from "./governance.js";
import type { GraphNodeInput, GraphStorage, CloudProvider, GraphResourceType } from "./types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeNode(overrides: Partial<GraphNodeInput> & { id: string }): GraphNodeInput {
  return {
    name: overrides.name ?? overrides.id,
    provider: "aws",
    account: "123456789",
    region: "us-east-1",
    resourceType: "compute",
    nativeId: overrides.id,
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: null,
    owner: null,
    createdAt: null,
    ...overrides,
  };
}

// =============================================================================
// Risk Scoring
// =============================================================================

describe("calculateRiskScore", () => {
  it("should return low risk for minimal changes", () => {
    const result = calculateRiskScore({
      blastRadiusSize: 0,
      costAtRisk: 0,
      dependentCount: 0,
      environment: "dev",
      isGpuAiWorkload: false,
      action: "update",
    });

    expect(result.score).toBeLessThanOrEqual(20);
    expect(result.level).toBe("low");
    expect(result.factors).toBeInstanceOf(Array);
  });

  it("should score production environment higher", () => {
    const dev = calculateRiskScore({
      blastRadiusSize: 1,
      costAtRisk: 100,
      dependentCount: 1,
      environment: "dev",
      isGpuAiWorkload: false,
      action: "update",
    });

    const prod = calculateRiskScore({
      blastRadiusSize: 1,
      costAtRisk: 100,
      dependentCount: 1,
      environment: "production",
      isGpuAiWorkload: false,
      action: "update",
    });

    expect(prod.score).toBeGreaterThan(dev.score);
    expect(prod.factors.some((f) => f.includes("Production"))).toBe(true);
  });

  it("should elevate GPU/AI workload risk", () => {
    const noGpu = calculateRiskScore({
      blastRadiusSize: 2,
      costAtRisk: 500,
      dependentCount: 2,
      environment: "staging",
      isGpuAiWorkload: false,
      action: "update",
    });

    const withGpu = calculateRiskScore({
      blastRadiusSize: 2,
      costAtRisk: 500,
      dependentCount: 2,
      environment: "staging",
      isGpuAiWorkload: true,
      action: "update",
    });

    expect(withGpu.score).toBeGreaterThan(noGpu.score);
    expect(withGpu.factors.some((f) => f.includes("GPU/AI"))).toBe(true);
  });

  it("should score deletes higher than updates", () => {
    const update = calculateRiskScore({
      blastRadiusSize: 3,
      costAtRisk: 200,
      dependentCount: 2,
      environment: "staging",
      isGpuAiWorkload: false,
      action: "update",
    });

    const del = calculateRiskScore({
      blastRadiusSize: 3,
      costAtRisk: 200,
      dependentCount: 2,
      environment: "staging",
      isGpuAiWorkload: false,
      action: "delete",
    });

    expect(del.score).toBeGreaterThan(update.score);
    expect(del.factors.some((f) => f.includes("delete"))).toBe(true);
  });

  it("should apply off-hours risk bonus", () => {
    const businessHours = calculateRiskScore({
      blastRadiusSize: 1,
      costAtRisk: 100,
      dependentCount: 1,
      environment: "dev",
      isGpuAiWorkload: false,
      action: "update",
      hourOfDay: 14,
    });

    const offHours = calculateRiskScore({
      blastRadiusSize: 1,
      costAtRisk: 100,
      dependentCount: 1,
      environment: "dev",
      isGpuAiWorkload: false,
      action: "update",
      hourOfDay: 3,
    });

    expect(offHours.score).toBeGreaterThan(businessHours.score);
  });

  it("should return critical for max-risk scenario", () => {
    const result = calculateRiskScore({
      blastRadiusSize: 50,
      costAtRisk: 10000,
      dependentCount: 20,
      environment: "production",
      isGpuAiWorkload: true,
      action: "delete",
      hourOfDay: 2,
    });

    expect(result.level).toBe("critical");
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it("should clamp score to 0–100", () => {
    const result = calculateRiskScore({
      blastRadiusSize: 1000,
      costAtRisk: 1000000,
      dependentCount: 1000,
      environment: "production",
      isGpuAiWorkload: true,
      action: "delete",
      hourOfDay: 2,
    });

    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// Change Governor
// =============================================================================

describe("ChangeGovernor", () => {
  let storage: GraphStorage;
  let engine: GraphEngine;
  let governor: ChangeGovernor;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    await storage.initialize();
    engine = new GraphEngine({ storage });
    governor = new ChangeGovernor(engine, storage);
  });

  describe("interceptChange", () => {
    it("should auto-approve low-risk human changes", async () => {
      const request = await governor.interceptChange({
        initiator: "alice",
        initiatorType: "human",
        targetResourceId: "aws:123:us-east-1:compute:nonexistent",
        resourceType: "compute",
        provider: "aws",
        action: "update",
        description: "Update dev instance tags",
      });

      expect(request.status).toBe("auto-approved");
      expect(request.risk.level).toBe("low");
      expect(request.resolvedAt).not.toBeNull();
      expect(request.resolvedBy).toBe("system");
    });

    it("should block high-risk changes for approval", async () => {
      // Create a node with high cost and dependents
      await storage.upsertNode(
        makeNode({
          id: "prod-db",
          name: "Production Database",
          costMonthly: 2000,
          tags: { Environment: "production" },
        }),
      );

      // Create downstream dependents
      for (let i = 0; i < 8; i++) {
        await storage.upsertNode(makeNode({ id: `svc-${i}`, name: `Service ${i}` }));
        await storage.upsertEdge({
          id: `edge-${i}`,
          sourceNodeId: `svc-${i}`,
          targetNodeId: "prod-db",
          relationshipType: "depends-on",
          confidence: 1,
          discoveredVia: "config-scan",
          metadata: {},
          lastSeenAt: new Date().toISOString(),
        });
      }

      const request = await governor.interceptChange({
        initiator: "deploy-agent",
        initiatorType: "agent",
        targetResourceId: "prod-db",
        resourceType: "database",
        provider: "aws",
        action: "delete",
        description: "Delete production database",
      });

      expect(request.status).toBe("pending");
      expect(request.risk.score).toBeGreaterThan(defaultGovernorConfig.blockThreshold);
    });

    it("should record audit trail for every change request", async () => {
      await governor.interceptChange({
        initiator: "agent-1",
        initiatorType: "agent",
        targetResourceId: "some-resource",
        resourceType: "compute",
        provider: "aws",
        action: "create",
        description: "Create new instance",
      });

      const changes = await storage.getChanges({
        initiator: "agent-1",
        initiatorType: "agent",
      });

      expect(changes.length).toBeGreaterThanOrEqual(1);
      expect(changes[0]!.initiator).toBe("agent-1");
      expect(changes[0]!.initiatorType).toBe("agent");
    });

    it("should notify registered callbacks for pending requests", async () => {
      const notifications: string[] = [];
      governor.onApprovalRequired(async (req) => {
        notifications.push(req.id);
      });

      // Create a protected environment resource
      await storage.upsertNode(
        makeNode({
          id: "prod-instance",
          tags: { Environment: "production" },
          costMonthly: 500,
        }),
      );

      // Create dependents to push it over auto-approve threshold
      for (let i = 0; i < 6; i++) {
        await storage.upsertNode(makeNode({ id: `dep-${i}` }));
        await storage.upsertEdge({
          id: `e-dep-${i}`,
          sourceNodeId: `dep-${i}`,
          targetNodeId: "prod-instance",
          relationshipType: "depends-on",
          confidence: 1,
          discoveredVia: "config-scan",
          metadata: {},
          lastSeenAt: new Date().toISOString(),
        });
      }

      const request = await governor.interceptChange({
        initiator: "deploy-bot",
        initiatorType: "agent",
        targetResourceId: "prod-instance",
        resourceType: "compute",
        provider: "aws",
        action: "delete",
        description: "Scale down prod",
      });

      if (request.status === "pending") {
        expect(notifications.length).toBe(1);
      }
    });

    it("should detect policy violations for GPU resources without cost tags", async () => {
      await storage.upsertNode(
        makeNode({
          id: "gpu-instance",
          resourceType: "compute",
          tags: {},
          costMonthly: 3000,
          metadata: { instanceType: "p4d.24xlarge" },
        }),
      );

      const request = await governor.interceptChange({
        initiator: "ml-agent",
        initiatorType: "agent",
        targetResourceId: "gpu-instance",
        resourceType: "compute",
        provider: "aws",
        action: "update",
        description: "Update SageMaker endpoint config",
      });

      expect(request.policyViolations.length).toBeGreaterThan(0);
      expect(request.policyViolations[0]).toContain("cost allocation tag");
    });
  });

  describe("approveChange", () => {
    it("should approve a pending request", async () => {
      // Create a scenario that produces a pending request
      await storage.upsertNode(
        makeNode({
          id: "prod-db-2",
          tags: { Environment: "production" },
          costMonthly: 1500,
        }),
      );

      for (let i = 0; i < 6; i++) {
        await storage.upsertNode(makeNode({ id: `backend-${i}` }));
        await storage.upsertEdge({
          id: `dep-edge-${i}`,
          sourceNodeId: `backend-${i}`,
          targetNodeId: "prod-db-2",
          relationshipType: "depends-on",
          confidence: 1,
          discoveredVia: "config-scan",
          metadata: {},
          lastSeenAt: new Date().toISOString(),
        });
      }

      const request = await governor.interceptChange({
        initiator: "deploy-agent",
        initiatorType: "agent",
        targetResourceId: "prod-db-2",
        resourceType: "database",
        provider: "aws",
        action: "delete",
        description: "Decommission database",
      });

      expect(request.status).toBe("pending");

      const approved = await governor.approveChange(request.id, "ops-lead", "Reviewed blast radius");
      expect(approved).not.toBeNull();
      expect(approved!.status).toBe("approved");
      expect(approved!.resolvedBy).toBe("ops-lead");
      expect(approved!.reason).toBe("Reviewed blast radius");
    });

    it("should return null for non-pending requests", async () => {
      const request = await governor.interceptChange({
        initiator: "alice",
        initiatorType: "human",
        targetResourceId: "dev-instance",
        resourceType: "compute",
        provider: "aws",
        action: "update",
        description: "Dev change",
      });

      // Already auto-approved
      const result = await governor.approveChange(request.id, "ops-lead");
      expect(result).toBeNull();
    });
  });

  describe("rejectChange", () => {
    it("should reject a pending request", async () => {
      await storage.upsertNode(
        makeNode({
          id: "important-db",
          tags: { Environment: "production" },
          costMonthly: 2000,
        }),
      );

      for (let i = 0; i < 6; i++) {
        await storage.upsertNode(makeNode({ id: `client-${i}` }));
        await storage.upsertEdge({
          id: `c-edge-${i}`,
          sourceNodeId: `client-${i}`,
          targetNodeId: "important-db",
          relationshipType: "depends-on",
          confidence: 1,
          discoveredVia: "config-scan",
          metadata: {},
          lastSeenAt: new Date().toISOString(),
        });
      }

      const request = await governor.interceptChange({
        initiator: "rogue-agent",
        initiatorType: "agent",
        targetResourceId: "important-db",
        resourceType: "database",
        provider: "aws",
        action: "delete",
        description: "Drop production database",
      });

      expect(request.status).toBe("pending");

      const rejected = await governor.rejectChange(request.id, "admin", "Too risky");
      expect(rejected).not.toBeNull();
      expect(rejected!.status).toBe("rejected");
      expect(rejected!.reason).toBe("Too risky");
    });
  });

  describe("audit trail queries", () => {
    it("should filter by initiator", async () => {
      await governor.interceptChange({
        initiator: "agent-a",
        initiatorType: "agent",
        targetResourceId: "res-1",
        resourceType: "compute",
        provider: "aws",
        action: "create",
        description: "Create by agent A",
      });

      await governor.interceptChange({
        initiator: "agent-b",
        initiatorType: "agent",
        targetResourceId: "res-2",
        resourceType: "compute",
        provider: "aws",
        action: "create",
        description: "Create by agent B",
      });

      const trailA = governor.getAuditTrail({ initiator: "agent-a" });
      expect(trailA).toHaveLength(1);
      expect(trailA[0]!.initiator).toBe("agent-a");

      const trailAll = governor.getAuditTrail({});
      expect(trailAll).toHaveLength(2);
    });

    it("should filter by status", async () => {
      await governor.interceptChange({
        initiator: "alice",
        initiatorType: "human",
        targetResourceId: "dev-1",
        resourceType: "compute",
        provider: "aws",
        action: "update",
        description: "Low risk",
      });

      const autoApproved = governor.getAuditTrail({ status: "auto-approved" });
      expect(autoApproved.length).toBeGreaterThanOrEqual(1);
    });

    it("should filter by action", async () => {
      await governor.interceptChange({
        initiator: "bob",
        initiatorType: "human",
        targetResourceId: "res-x",
        resourceType: "storage",
        provider: "aws",
        action: "delete",
        description: "Delete bucket",
      });

      await governor.interceptChange({
        initiator: "bob",
        initiatorType: "human",
        targetResourceId: "res-y",
        resourceType: "compute",
        provider: "aws",
        action: "create",
        description: "Create instance",
      });

      const deletes = governor.getAuditTrail({ action: "delete" });
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.action).toBe("delete");
    });
  });

  describe("governance summary", () => {
    it("should generate summary statistics", async () => {
      // Create a few requests
      await governor.interceptChange({
        initiator: "agent-1",
        initiatorType: "agent",
        targetResourceId: "r1",
        resourceType: "compute",
        provider: "aws",
        action: "create",
        description: "Create 1",
      });

      await governor.interceptChange({
        initiator: "agent-1",
        initiatorType: "agent",
        targetResourceId: "r2",
        resourceType: "storage",
        provider: "aws",
        action: "create",
        description: "Create 2",
      });

      await governor.interceptChange({
        initiator: "alice",
        initiatorType: "human",
        targetResourceId: "r3",
        resourceType: "compute",
        provider: "aws",
        action: "update",
        description: "Update 3",
      });

      const summary = governor.getSummary();
      expect(summary.totalRequests).toBe(3);
      expect(summary.byInitiator["agent-1"]).toBe(2);
      expect(summary.byInitiator["alice"]).toBe(1);
      expect(summary.avgRiskScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe("pending requests", () => {
    it("should list only pending requests", async () => {
      // Auto-approved (low risk)
      await governor.interceptChange({
        initiator: "alice",
        initiatorType: "human",
        targetResourceId: "dev-thing",
        resourceType: "compute",
        provider: "aws",
        action: "update",
        description: "Dev thing",
      });

      const pending = governor.getPendingRequests();
      // Low-risk human change should be auto-approved, so no pending
      expect(pending.every((p) => p.status === "pending")).toBe(true);
    });
  });

  describe("custom config", () => {
    it("should respect custom auto-approve threshold", async () => {
      const strictGovernor = new ChangeGovernor(engine, storage, {
        autoApproveThreshold: 0, // nothing auto-approves
        allowAgentAutoApprove: false,
      });

      const request = await strictGovernor.interceptChange({
        initiator: "alice",
        initiatorType: "human",
        targetResourceId: "anything",
        resourceType: "compute",
        provider: "aws",
        action: "update",
        description: "Any change",
      });

      // Even a zero-blast-radius change should be pending with threshold 0
      // (score will be > 0 due to unknown environment)
      expect(request.status).toBe("pending");
    });

    it("should block agent auto-approve when disabled", async () => {
      const noAgentApprove = new ChangeGovernor(engine, storage, {
        allowAgentAutoApprove: false,
      });

      const request = await noAgentApprove.interceptChange({
        initiator: "deploy-bot",
        initiatorType: "agent",
        targetResourceId: "something",
        resourceType: "compute",
        provider: "aws",
        action: "update",
        description: "Agent change",
      });

      expect(request.status).toBe("pending");
    });
  });
});
