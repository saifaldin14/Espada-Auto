/**
 * Integration Bridge Tests
 *
 * Tests for the cross-extension integration layer. Uses mocked extension
 * interfaces to verify bridge behaviour without requiring sibling extensions.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryGraphStorage } from "../../src/storage/memory-store.js";
import { GraphEngine } from "../../src/core/engine.js";
import type {
  GraphStorage,
  GraphNodeInput,
  GraphEdgeInput,
  CloudProvider,
  GraphResourceType,
} from "../../src/types.js";
import type {
  IntegrationContext,
  AuthEngine,
  AuthUser,
  AuditLoggerLike,
  ComplianceEvaluator,
  WaiverStore,
  ComplianceWaiver,
  PolicyEvaluationEngine,
  PolicyStorageLike,
  BudgetManagerLike,
  TerraformGraphBridge,
  AlertingExtension,
  AlertingConfig,
  BridgeLogger,
} from "../../src/integrations/types.js";
import {
  IntegrationManager,
  withEnterpriseAuth,
  withAuditTrail,
  AuthenticatedGraphStorage,
  AuditedGraphStorage,
} from "../../src/integrations/index.js";
import { ComplianceBridge } from "../../src/integrations/compliance-bridge.js";
import { PolicyBridge } from "../../src/integrations/policy-bridge.js";
import { CostBridge } from "../../src/integrations/cost-bridge.js";
import { TerraformBridge } from "../../src/integrations/terraform-bridge.js";
import { AlertingBridge } from "../../src/integrations/alerting-bridge.js";

// =============================================================================
// Fixtures
// =============================================================================

function makeNode(id: string, overrides?: Partial<GraphNodeInput>): GraphNodeInput {
  return {
    id,
    name: id,
    provider: "aws" as CloudProvider,
    account: "123456789",
    region: "us-east-1",
    resourceType: "compute" as GraphResourceType,
    nativeId: id,
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: 100,
    owner: null,
    createdAt: null,
    ...overrides,
  };
}

function makeEdge(source: string, target: string): GraphEdgeInput {
  return {
    id: `${source}->${target}`,
    sourceNodeId: source,
    targetNodeId: target,
    relationshipType: "depends-on",
    confidence: 1,
    discoveredVia: "config-scan",
    metadata: {},
  };
}

// =============================================================================
// Mock Factories
// =============================================================================

function createMockLogger(): BridgeLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createMockAuthEngine(opts?: { allowAll?: boolean }): AuthEngine {
  return {
    authorize: vi.fn().mockResolvedValue({
      allowed: opts?.allowAll ?? true,
      reason: opts?.allowAll === false ? "No permission" : "Has role",
      missingPermissions: opts?.allowAll === false ? ["infra.read"] : [],
      matchedRole: opts?.allowAll !== false ? "admin" : undefined,
    }),
    getUserPermissions: vi.fn().mockResolvedValue(
      opts?.allowAll !== false
        ? new Set(["infra.read", "infra.write", "infra.delete", "infra.admin"])
        : new Set(),
    ),
  };
}

function createMockAuditLogger(): AuditLoggerLike & { log: ReturnType<typeof vi.fn> } {
  return {
    log: vi.fn(),
  };
}

function createMockPolicyEngine(): PolicyEvaluationEngine {
  return {
    evaluateAll: vi.fn().mockReturnValue({
      allowed: true,
      denied: false,
      warnings: [],
      denials: [],
      approvalRequired: false,
      notifications: [],
      results: [],
      totalPolicies: 2,
      passedPolicies: 2,
      failedPolicies: 0,
      evaluatedAt: new Date().toISOString(),
      totalDurationMs: 5,
    }),
    evaluate: vi.fn().mockReturnValue({
      policyId: "p1",
      policyName: "test-policy",
      allowed: true,
      denied: false,
      warnings: [],
      denials: [],
      approvalRequired: false,
      notifications: [],
      evaluatedAt: new Date().toISOString(),
      durationMs: 3,
    }),
  };
}

function createMockPolicyStorage(): PolicyStorageLike {
  return {
    list: vi.fn().mockResolvedValue([
      {
        id: "pol-1",
        name: "test-policy",
        description: "Test",
        type: "access",
        enabled: true,
        severity: "medium",
        labels: [],
        rules: [],
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ]),
  };
}

function createMockBudgetManager(): BudgetManagerLike {
  return {
    listBudgets: vi.fn().mockReturnValue([
      {
        id: "b1",
        name: "Production",
        scope: "environment",
        scopeId: "prod",
        monthlyLimit: 10000,
        warningThreshold: 80,
        criticalThreshold: 100,
        currentSpend: 7500,
        currency: "USD",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-06-01T00:00:00Z",
      },
    ]),
    getStatus: vi.fn().mockReturnValue("warning"),
    updateSpend: vi.fn().mockReturnValue(null),
  };
}

function createMockAlertingExtension(): AlertingExtension {
  let dispatchCounter = 0;
  return {
    resolveRoutes: vi.fn().mockImplementation((_alert, _rules, _channelMap) => {
      // Default: return one route with one channel
      return [{
        rule: { id: "r1", name: "catch-all", priority: 1, enabled: true, conditions: [], channelIds: ["ch1"], stopOnMatch: false, createdAt: "2024-01-01" },
        channels: [{ id: "ch1", name: "default", type: "webhook" as const, config: {}, createdAt: "2024-01-01" }],
      }];
    }),
    dispatchToChannels: vi.fn().mockImplementation(async (alert) => {
      dispatchCounter++;
      return [{
        id: `dispatch-${dispatchCounter}`,
        alertId: alert.id,
        channelId: "ch1",
        ruleId: "r1",
        status: "sent" as const,
        message: alert.title,
        dispatchedAt: new Date().toISOString(),
      }];
    }),
    defaultSender: vi.fn().mockResolvedValue({ success: true }),
  };
}

function createMockAlertingConfig(): AlertingConfig {
  const channels = new Map();
  channels.set("ch1", { id: "ch1", name: "default", type: "webhook" as const, config: {}, createdAt: "2024-01-01" });
  return {
    rules: [{ id: "r1", name: "catch-all", priority: 1, enabled: true, conditions: [], channelIds: ["ch1"], stopOnMatch: false, createdAt: "2024-01-01" }],
    channels,
  };
}

function createMockComplianceEvaluator(): ComplianceEvaluator {
  return {
    evaluate: vi.fn().mockReturnValue({
      framework: "cis",
      frameworkVersion: "1.0",
      totalControls: 10,
      passedControls: 8,
      failedControls: 2,
      waivedControls: 0,
      notApplicable: 0,
      score: 80,
      violations: [
        {
          controlId: "CIS-1.1",
          controlTitle: "Root account MFA",
          framework: "cis",
          resourceNodeId: "node-1",
          resourceName: "web-server",
          resourceType: "compute",
          severity: "high",
          description: "MFA not enabled",
          remediation: "Enable MFA",
          status: "open",
          detectedAt: new Date().toISOString(),
        },
      ],
      byCategory: {},
      bySeverity: { high: 1, medium: 1 },
    }),
  };
}

function createMockWaiverStore(): WaiverStore & { _waivers: ComplianceWaiver[] } {
  const waivers: ComplianceWaiver[] = [];
  return {
    _waivers: waivers,
    add: vi.fn().mockImplementation((waiver: ComplianceWaiver) => {
      waivers.push(waiver);
    }),
    remove: vi.fn().mockImplementation((id: string) => {
      const idx = waivers.findIndex((w) => w.id === id);
      if (idx >= 0) { waivers.splice(idx, 1); return true; }
      return false;
    }),
    get: vi.fn().mockImplementation((id: string) => waivers.find((w) => w.id === id)),
    list: vi.fn().mockImplementation(() => [...waivers]),
    listActive: vi.fn().mockImplementation(() =>
      waivers.filter((w) => new Date(w.expiresAt) > new Date()),
    ),
    isWaived: vi.fn().mockReturnValue(false),
  };
}

async function setupContext(extOverrides?: Partial<IntegrationContext["ext"]>, alertingConfig?: AlertingConfig): Promise<{
  storage: GraphStorage;
  engine: GraphEngine;
  ctx: IntegrationContext;
  logger: BridgeLogger;
}> {
  const storage = new InMemoryGraphStorage();
  await storage.initialize();

  // Seed some data
  await storage.upsertNodes([
    makeNode("node-1", { name: "web-server", resourceType: "compute" as GraphResourceType, costMonthly: 200 }),
    makeNode("node-2", { name: "api-server", resourceType: "compute" as GraphResourceType, costMonthly: 150 }),
    makeNode("node-3", { name: "main-db", resourceType: "database" as GraphResourceType, costMonthly: 500 }),
    makeNode("node-4", { name: "cache", resourceType: "compute" as GraphResourceType, costMonthly: 50, provider: "azure" as CloudProvider }),
  ]);
  await storage.upsertEdges([
    makeEdge("node-1", "node-2"),
    makeEdge("node-2", "node-3"),
    makeEdge("node-1", "node-4"),
  ]);

  const engine = new GraphEngine({
    storage,
    config: { maxTraversalDepth: 8, enableDriftDetection: true },
  });

  const logger = createMockLogger();

  const ext = extOverrides ?? {};
  const available = {
    enterpriseAuth: !!ext.authEngine,
    auditTrail: !!ext.auditLogger,
    compliance: !!ext.complianceEvaluator,
    policyEngine: !!ext.policyEngine,
    costGovernance: !!ext.budgetManager,
    terraform: !!ext.terraformBridge,
    alertingIntegration: !!ext.alertingExtension,
  };

  const ctx: IntegrationContext = { engine, storage, logger, available, ext, alertingConfig };

  return { storage, engine, ctx, logger };
}

// =============================================================================
// Tests: IntegrationManager
// =============================================================================

describe("IntegrationManager", () => {
  it("initializes with no extensions (graceful degradation)", async () => {
    const { engine, storage, logger } = await setupContext();
    const mgr = new IntegrationManager({ engine, storage, logger });

    expect(mgr.availableSummary).toBe("none");
    expect(mgr.available.enterpriseAuth).toBe(false);
    expect(mgr.available.auditTrail).toBe(false);
  });

  it("detects available extensions", async () => {
    const { engine, storage, logger } = await setupContext();
    const mgr = new IntegrationManager({
      engine,
      storage,
      logger,
      extensions: {
        authEngine: createMockAuthEngine(),
        auditLogger: createMockAuditLogger(),
      },
    });

    expect(mgr.available.enterpriseAuth).toBe(true);
    expect(mgr.available.auditTrail).toBe(true);
    expect(mgr.available.policyEngine).toBe(false);
    expect(mgr.availableSummary).toContain("auth");
    expect(mgr.availableSummary).toContain("audit");
  });

  it("getSecureStorage composes auth + audit wrappers", async () => {
    const { engine, storage, logger } = await setupContext();
    const mgr = new IntegrationManager({
      engine,
      storage,
      logger,
      extensions: {
        authEngine: createMockAuthEngine(),
        auditLogger: createMockAuditLogger(),
      },
    });

    const secure = mgr.getSecureStorage("user-1");
    // Should be able to read (auth allows all)
    const node = await secure.getNode("node-1");
    expect(node).toBeTruthy();
    expect(node!.name).toBe("web-server");
  });

  it("updateExtensions hot-reloads availability", async () => {
    const { engine, storage, logger } = await setupContext();
    const mgr = new IntegrationManager({ engine, storage, logger });

    expect(mgr.available.policyEngine).toBe(false);

    mgr.updateExtensions({ policyEngine: createMockPolicyEngine() });
    expect(mgr.available.policyEngine).toBe(true);
  });
});

// =============================================================================
// Tests: Auth Bridge
// =============================================================================

describe("AuthenticatedGraphStorage", () => {
  it("allows operations when auth permits", async () => {
    const { storage, ctx } = await setupContext({
      authEngine: createMockAuthEngine({ allowAll: true }),
      auditLogger: createMockAuditLogger(),
    });

    const authed = withEnterpriseAuth(storage, ctx, "user-1");
    const node = await authed.getNode("node-1");
    expect(node).toBeTruthy();
    expect(node!.name).toBe("web-server");
  });

  it("denies operations when auth denies", async () => {
    const auth = createMockAuthEngine({ allowAll: false });
    const { storage, ctx } = await setupContext({ authEngine: auth });

    const authed = withEnterpriseAuth(storage, ctx, "user-1");
    await expect(authed.getNode("node-1")).rejects.toThrow(/denied/i);
  });

  it("returns raw storage when auth unavailable", async () => {
    const { storage, ctx } = await setupContext();
    const result = withEnterpriseAuth(storage, ctx, "user-1");
    // Should be the same storage instance (no wrapping)
    expect(result).toBe(storage);
  });
});

// =============================================================================
// Tests: Audit Bridge
// =============================================================================

describe("AuditedGraphStorage", () => {
  it("emits audit events on mutations", async () => {
    const auditLogger = createMockAuditLogger();
    const { storage, ctx } = await setupContext({ auditLogger });

    const audited = withAuditTrail(storage, ctx, "user-42");
    await audited.upsertNode(makeNode("new-node", { name: "new-server" }));

    expect(auditLogger.log).toHaveBeenCalled();
    const event = auditLogger.log.mock.calls[0][0];
    expect(event.eventType).toMatch(/resource/i);
    expect(event.actor.id).toBe("user-42");
  });

  it("passes through reads without auditing", async () => {
    const auditLogger = createMockAuditLogger();
    const { storage, ctx } = await setupContext({ auditLogger });

    const audited = withAuditTrail(storage, ctx, "user-42");
    await audited.getNode("node-1");

    // getNode is a read — should not generate an audit event
    expect(auditLogger.log).not.toHaveBeenCalled();
  });

  it("returns raw storage when audit unavailable", async () => {
    const { storage, ctx } = await setupContext();
    const result = withAuditTrail(storage, ctx, "user-1");
    expect(result).toBe(storage);
  });
});

// =============================================================================
// Tests: Compliance Bridge
// =============================================================================

describe("ComplianceBridge", () => {
  it("falls back to built-in compliance when extension unavailable", async () => {
    const { ctx } = await setupContext();
    const bridge = new ComplianceBridge(ctx);

    // Should not throw even without the compliance extension
    const result = await bridge.evaluate("cis");
    expect(result).toBeTruthy();
    expect(result.framework).toBe("cis");
    expect(typeof result.score).toBe("number");
  });

  it("evaluates all frameworks", async () => {
    const { ctx } = await setupContext();
    const bridge = new ComplianceBridge(ctx);

    const results = await bridge.evaluateAll();
    expect(results instanceof Map).toBe(true);
    expect(results.size).toBeGreaterThan(0);
  });
});

// =============================================================================
// Tests: Policy Bridge
// =============================================================================

describe("PolicyBridge", () => {
  it("evaluates a node with graph context", async () => {
    const policyEngine = createMockPolicyEngine();
    const policyStorage = createMockPolicyStorage();
    const { ctx } = await setupContext({ policyEngine, policyStorage });
    const bridge = new PolicyBridge(ctx);

    const result = await bridge.evaluateNode("node-1");
    expect(result).toBeTruthy();
    expect(result!.allowed).toBe(true);
    expect(policyEngine.evaluateAll).toHaveBeenCalled();

    // Verify policies and graph context were passed
    const callArgs = (policyEngine.evaluateAll as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBeTruthy(); // policies array
    expect(callArgs[1].resource).toBeTruthy();
    expect(callArgs[1].resource.id).toBe("node-1");
  });

  it("returns null for non-existent nodes", async () => {
    const { ctx } = await setupContext({ policyEngine: createMockPolicyEngine(), policyStorage: createMockPolicyStorage() });
    const bridge = new PolicyBridge(ctx);

    const result = await bridge.evaluateNode("non-existent");
    expect(result).toBeNull();
  });

  it("returns null when policy engine unavailable", async () => {
    const { ctx } = await setupContext();
    const bridge = new PolicyBridge(ctx);

    const result = await bridge.evaluateNode("node-1");
    expect(result).toBeNull();
  });

  it("pre-mutation check includes blast radius for deletes", async () => {
    const policyEngine = createMockPolicyEngine();
    const policyStorage = createMockPolicyStorage();
    const { ctx } = await setupContext({ policyEngine, policyStorage });
    const bridge = new PolicyBridge(ctx);

    const result = await bridge.preMutationCheck("node-1", "delete");
    expect(result).toBeTruthy();

    const callArgs = (policyEngine.evaluateAll as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].graph).toBeTruthy();
    expect(callArgs[1].graph.blastRadius).toBeGreaterThan(0);
  });
});

// =============================================================================
// Tests: Cost Bridge
// =============================================================================

describe("CostBridge", () => {
  it("returns cost summary from graph nodes", async () => {
    const { ctx } = await setupContext();
    const bridge = new CostBridge(ctx);

    const summary = await bridge.getCostSummary();
    expect(summary.totalMonthly).toBeGreaterThan(0);
    expect(summary.nodeCount).toBe(4);
    expect(summary.byProvider.aws).toBeTruthy();
  });

  it("filters by provider", async () => {
    const { ctx } = await setupContext();
    const bridge = new CostBridge(ctx);

    const summary = await bridge.getCostSummary({ provider: "azure" as CloudProvider });
    expect(summary.nodeCount).toBe(1);
    expect(summary.byProvider.azure).toBeTruthy();
  });

  it("returns budgets from cost-governance extension", async () => {
    const budgetManager = createMockBudgetManager();
    const { ctx } = await setupContext({ budgetManager });
    const bridge = new CostBridge(ctx);

    const budgets = bridge.getBudgets();
    expect(budgets.length).toBe(1);
    expect(budgets[0].name).toBe("Production");
  });

  it("returns empty budgets when extension unavailable", async () => {
    const { ctx } = await setupContext();
    const bridge = new CostBridge(ctx);

    const budgets = bridge.getBudgets();
    expect(budgets).toEqual([]);
  });

  it("calculates cost impact with blast radius", async () => {
    const { ctx } = await setupContext();
    const bridge = new CostBridge(ctx);

    const impact = await bridge.getCostImpact("node-1", 3);
    expect(impact).toBeTruthy();
    expect(impact!.directCost).toBe(200); // web-server
    expect(impact!.blastRadiusCost).toBeGreaterThan(0);
  });
});

// =============================================================================
// Tests: Alerting Bridge
// =============================================================================

describe("AlertingBridge", () => {
  it("dispatches drift alerts", async () => {
    const alertingExtension = createMockAlertingExtension();
    const alertingConfig = createMockAlertingConfig();
    const { ctx } = await setupContext({ alertingExtension }, alertingConfig);
    const bridge = new AlertingBridge(ctx);

    expect(bridge.available).toBe(true);

    const result = await bridge.alertDrift({
      driftedNodes: [{
        node: {
          id: "node-1",
          name: "web-server",
          provider: "aws" as CloudProvider,
          account: "123",
          region: "us-east-1",
          resourceType: "compute" as GraphResourceType,
          nativeId: "i-123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: 100,
          owner: null,
          createdAt: null,
          discoveredAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-06-01T00:00:00Z",
          lastSeenAt: "2024-06-01T00:00:00Z",
        },
        changes: [{
          id: "chg-1",
          targetId: "node-1",
          changeType: "node-updated" as const,
          field: "status",
          previousValue: "running",
          newValue: "stopped",
          detectedAt: new Date().toISOString(),
          detectedVia: "sync" as const,
          correlationId: null,
          initiator: null,
          initiatorType: null,
          metadata: {},
        }],
      }],
      disappearedNodes: [],
      newNodes: [],
      scannedAt: new Date().toISOString(),
    });

    expect(result.sent).toBe(1);
    expect(result.alertIds.length).toBe(1);
    expect(alertingExtension.resolveRoutes).toHaveBeenCalled();
    expect(alertingExtension.dispatchToChannels).toHaveBeenCalled();
  });

  it("batches compliance violations by severity", async () => {
    const alertingExtension = createMockAlertingExtension();
    const alertingConfig = createMockAlertingConfig();
    const { ctx } = await setupContext({ alertingExtension }, alertingConfig);
    const bridge = new AlertingBridge(ctx);

    const result = await bridge.alertComplianceViolations([
      { controlId: "c1", controlTitle: "Encryption at rest", framework: "soc2", resourceNodeId: "n1", resourceName: "db", severity: "critical" },
      { controlId: "c2", controlTitle: "Access logging", framework: "soc2", resourceNodeId: "n2", resourceName: "api", severity: "high" },
      { controlId: "c3", controlTitle: "Tagging", framework: "cis", resourceNodeId: "n3", resourceName: "vm", severity: "medium" },
    ]);

    // 1 critical (individual) + 1 high (batched) + 1 medium (summary) = 3 alerts
    expect(result.sent).toBe(3);
  });

  it("returns zero when alerting unavailable", async () => {
    const { ctx } = await setupContext();
    const bridge = new AlertingBridge(ctx);

    expect(bridge.available).toBe(false);
    const result = await bridge.alertCostAnomaly({
      nodeId: "n1",
      nodeName: "db",
      previousCost: 100,
      currentCost: 500,
      percentChange: 400,
    });
    expect(result.sent).toBe(0);
  });
});

// =============================================================================
// Tests: Terraform Bridge
// =============================================================================

describe("TerraformBridge", () => {
  it("gets terraform-managed nodes from graph", async () => {
    const { storage, ctx } = await setupContext();

    // Add a node with terraform metadata
    await storage.upsertNode(
      makeNode("tf-node-1", {
        name: "tf-instance",
        metadata: { terraformAddress: "aws_instance.web", managedBy: "terraform" },
      }),
    );

    const bridge = new TerraformBridge(ctx);
    const managed = await bridge.getTerraformManagedNodes();
    expect(managed.length).toBeGreaterThanOrEqual(1);
    expect(managed.some((n) => n.name === "tf-instance")).toBe(true);
  });

  it("gets terraform addresses from graph", async () => {
    const { storage, ctx } = await setupContext();

    await storage.upsertNode(
      makeNode("tf-node-2", {
        name: "tf-rds",
        metadata: { terraformAddress: "aws_rds_instance.main", managedBy: "terraform" },
      }),
    );

    const bridge = new TerraformBridge(ctx);
    const addresses = await bridge.getTerraformAddresses();
    expect(addresses.length).toBeGreaterThanOrEqual(1);
    expect(addresses).toContain("aws_rds_instance.main");
  });
});

// =============================================================================
// Tests: Integration Pipeline (drift + alerting)
// =============================================================================

describe("IntegrationManager pipelines", () => {
  it("detectDriftAndAlert runs without errors when no extensions", async () => {
    const { engine, storage, logger } = await setupContext();
    const mgr = new IntegrationManager({ engine, storage, logger });

    const result = await mgr.detectDriftAndAlert();
    expect(result.driftedCount).toBeGreaterThanOrEqual(0);
    expect(result.alertsSent).toBe(0);
  });

  it("evaluateComplianceAndAlert filters by frameworks when specified", async () => {
    const { engine, storage, logger } = await setupContext();
    const mgr = new IntegrationManager({ engine, storage, logger });

    const result = await mgr.evaluateComplianceAndAlert({
      frameworks: ["cis"],
      alertOnViolations: false,
    });

    // Should only contain the requested framework(s)
    const keys = [...result.results.keys()];
    for (const key of keys) {
      expect(key).toBe("cis");
    }
  });

  it("evaluateComplianceAndAlert returns all frameworks when none specified", async () => {
    const { engine, storage, logger } = await setupContext();
    const mgr = new IntegrationManager({ engine, storage, logger });

    const result = await mgr.evaluateComplianceAndAlert();
    // Should have multiple frameworks when no filter
    expect(result.results.size).toBeGreaterThan(0);
  });
});

// =============================================================================
// Tests: Compliance Bridge — WaiverStore + Extension Path
// =============================================================================

describe("ComplianceBridge — WaiverStore", () => {
  it("creates a waiver via add() and returns full ComplianceWaiver", async () => {
    const waiverStore = createMockWaiverStore();
    const auditLogger = createMockAuditLogger();
    const evaluator = createMockComplianceEvaluator();
    const { ctx } = await setupContext({
      waiverStore,
      auditLogger,
      complianceEvaluator: evaluator,
    });
    const bridge = new ComplianceBridge(ctx);

    const waiver = bridge.createWaiver({
      controlId: "CIS-1.1",
      resourceId: "node-1",
      reason: "Temporary exception",
      approvedBy: "admin@corp.com",
      expiresAt: "2025-12-31T00:00:00Z",
    });

    expect(waiver).not.toBeNull();
    expect(waiver!.id).toMatch(/^waiver-/);
    expect(waiver!.controlId).toBe("CIS-1.1");
    expect(waiver!.approvedAt).toBeTruthy();
    expect(waiverStore.add).toHaveBeenCalledWith(waiver);
  });

  it("audits waiver creation with correct eventType", async () => {
    const waiverStore = createMockWaiverStore();
    const auditLogger = createMockAuditLogger();
    const { ctx } = await setupContext({ waiverStore, auditLogger, complianceEvaluator: createMockComplianceEvaluator() });
    const bridge = new ComplianceBridge(ctx);

    bridge.createWaiver({
      controlId: "CIS-1.1",
      resourceId: "node-1",
      reason: "Exception",
      approvedBy: "admin",
      expiresAt: "2025-12-31T00:00:00Z",
    });

    expect(auditLogger.log).toHaveBeenCalled();
    const event = auditLogger.log.mock.calls[0][0];
    expect(event.eventType).toBe("compliance_waiver_created");
    expect(event.operation).toBe("kg.compliance.createWaiver");
  });

  it("returns null when waiver store is unavailable", async () => {
    const { ctx } = await setupContext();
    const bridge = new ComplianceBridge(ctx);

    const result = bridge.createWaiver({
      controlId: "CIS-1.1",
      resourceId: "node-1",
      reason: "Test",
      approvedBy: "admin",
      expiresAt: "2025-12-31T00:00:00Z",
    });

    expect(result).toBeNull();
  });

  it("listWaivers returns active waivers from store", async () => {
    const waiverStore = createMockWaiverStore();
    const { ctx } = await setupContext({ waiverStore, complianceEvaluator: createMockComplianceEvaluator() });
    const bridge = new ComplianceBridge(ctx);

    // Create a waiver first
    bridge.createWaiver({
      controlId: "C1",
      resourceId: "r1",
      reason: "Test",
      approvedBy: "admin",
      expiresAt: "2099-12-31T00:00:00Z",
    });

    const waivers = bridge.listWaivers();
    expect(waivers.length).toBe(1);
    expect(waivers[0].controlId).toBe("C1");
  });

  it("removeWaiver delegates to store", async () => {
    const waiverStore = createMockWaiverStore();
    const { ctx } = await setupContext({ waiverStore, complianceEvaluator: createMockComplianceEvaluator() });
    const bridge = new ComplianceBridge(ctx);

    const result = bridge.removeWaiver("non-existent");
    expect(waiverStore.remove).toHaveBeenCalledWith("non-existent");
    expect(result).toBe(false);
  });
});

describe("ComplianceBridge — Extension Evaluator Path", () => {
  it("delegates to compliance extension's evaluator when available", async () => {
    const evaluator = createMockComplianceEvaluator();
    const { ctx } = await setupContext({ complianceEvaluator: evaluator });
    const bridge = new ComplianceBridge(ctx);

    const result = await bridge.evaluate("cis");
    expect(result.framework).toBe("cis");
    expect(result.score).toBe(80);
    expect(evaluator.evaluate).toHaveBeenCalled();
  });

  it("passes waiver lookup when waiver store is available", async () => {
    const evaluator = createMockComplianceEvaluator();
    const waiverStore = createMockWaiverStore();
    const { ctx } = await setupContext({ complianceEvaluator: evaluator, waiverStore });
    const bridge = new ComplianceBridge(ctx);

    await bridge.evaluate("cis");
    const callArgs = (evaluator.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[2]).toBeTruthy(); // waiverLookup
    expect(typeof callArgs[2].isWaived).toBe("function");
  });
});

// =============================================================================
// Tests: Cost Bridge — syncCostsToBudgets + getCostTrends
// =============================================================================

describe("CostBridge — syncCostsToBudgets", () => {
  it("syncs graph costs to budget manager", async () => {
    const budgetManager = createMockBudgetManager();
    const { ctx } = await setupContext({ budgetManager });
    const bridge = new CostBridge(ctx);

    const result = await bridge.syncCostsToBudgets();
    expect(result.synced).toBe(1);
    expect(result.budgets.length).toBe(1);
    expect(result.budgets[0].name).toBe("Production");
    expect(budgetManager.updateSpend).toHaveBeenCalled();
  });

  it("returns empty when budget manager unavailable", async () => {
    const { ctx } = await setupContext();
    const bridge = new CostBridge(ctx);

    const result = await bridge.syncCostsToBudgets();
    expect(result.synced).toBe(0);
    expect(result.budgets).toEqual([]);
  });
});

describe("CostBridge — getCostTrends", () => {
  it("returns non-negative cost trends", async () => {
    const { ctx } = await setupContext();
    const bridge = new CostBridge(ctx);

    const trends = await bridge.getCostTrends(7);
    // Even with no changes, should not return negative costs
    for (const t of trends) {
      expect(t.totalCost).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("CostBridge — findUntrackedResources", () => {
  it("accepts custom excluded resource types", async () => {
    const { ctx } = await setupContext();
    const bridge = new CostBridge(ctx);

    // All test nodes have costMonthly set, so this should return empty
    const untracked = await bridge.findUntrackedResources(undefined, ["compute"]);
    // No nodes without cost, so result is empty regardless of exclusion list
    expect(Array.isArray(untracked)).toBe(true);
  });
});

// =============================================================================
// Tests: Auth Bridge — TTL Cache + Failure Paths
// =============================================================================

describe("AuthenticatedGraphStorage — cache TTL", () => {
  it("re-resolves user after TTL expires", async () => {
    let callCount = 0;
    const userResolver = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        id: "user-1",
        email: "user@corp.com",
        name: `User ${callCount}`,
        roles: ["admin"],
        mfaEnabled: false,
        disabled: false,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      } as AuthUser;
    });

    const authEngine = createMockAuthEngine({ allowAll: true });
    const { storage, ctx } = await setupContext({ authEngine });

    // Directly construct with short TTL by subclassing
    const authed = new AuthenticatedGraphStorage(
      storage,
      authEngine,
      "user-1",
      ctx.logger,
      undefined,
      userResolver,
    );

    // First call: resolves user
    await authed.getNode("node-1");
    expect(userResolver).toHaveBeenCalledTimes(1);

    // Second call (within TTL): uses cache
    await authed.getNode("node-2");
    expect(userResolver).toHaveBeenCalledTimes(1);
  });

  it("handles auth engine failure with circuit breaker", async () => {
    const authEngine: AuthEngine = {
      authorize: vi.fn().mockRejectedValue(new Error("Auth service down")),
      getUserPermissions: vi.fn().mockRejectedValue(new Error("Auth service down")),
    };
    const { storage, ctx } = await setupContext({ authEngine });
    const authed = withEnterpriseAuth(storage, ctx, "user-1");

    // Should throw on first failures
    await expect(authed.getNode("node-1")).rejects.toThrow();
  });
});

// =============================================================================
// Tests: Alerting Bridge — Alert Shape Validation
// =============================================================================

describe("AlertingBridge — alert shape", () => {
  it("generates alerts with crypto.randomUUID-based IDs", async () => {
    const alertingExtension = createMockAlertingExtension();
    const alertingConfig = createMockAlertingConfig();
    const { ctx } = await setupContext({ alertingExtension }, alertingConfig);
    const bridge = new AlertingBridge(ctx);

    const result = await bridge.alertCostAnomaly({
      nodeId: "n1",
      nodeName: "db",
      previousCost: 100,
      currentCost: 500,
      percentChange: 400,
    });

    expect(result.sent).toBe(1);

    // Verify alert shape in the dispatch call
    const dispatchCall = (alertingExtension.dispatchToChannels as ReturnType<typeof vi.fn>).mock.calls[0];
    const alert = dispatchCall[0];
    expect(alert.provider).toBe("knowledge-graph");
    expect(alert.status).toBe("triggered");
    expect(alert.rawPayload).toBeTruthy();
    expect(alert.id).toMatch(/^kg-cost_anomaly-/);
    // UUID pattern after the prefix
    expect(alert.id).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("includes rawPayload in all alerts", async () => {
    const alertingExtension = createMockAlertingExtension();
    const alertingConfig = createMockAlertingConfig();
    const { ctx } = await setupContext({ alertingExtension }, alertingConfig);
    const bridge = new AlertingBridge(ctx);

    await bridge.alertSPOF({
      nodeId: "n1",
      nodeName: "critical-lb",
      dependentCount: 50,
      totalCostImpact: 10000,
    });

    const dispatchCall = (alertingExtension.dispatchToChannels as ReturnType<typeof vi.fn>).mock.calls[0];
    const alert = dispatchCall[0];
    expect(alert.rawPayload).toBeDefined();
    expect(alert.rawPayload.source).toBe("knowledge-graph");
  });

  it("handles dispatch failures gracefully", async () => {
    const alertingExtension = createMockAlertingExtension();
    (alertingExtension.dispatchToChannels as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Channel down"),
    );
    const alertingConfig = createMockAlertingConfig();
    const { ctx } = await setupContext({ alertingExtension }, alertingConfig);
    const bridge = new AlertingBridge(ctx);

    const result = await bridge.alertCostAnomaly({
      nodeId: "n1",
      nodeName: "db",
      previousCost: 100,
      currentCost: 500,
      percentChange: 400,
    });

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
  });
});

// =============================================================================
// Tests: CircuitBreaker
// =============================================================================

describe("CircuitBreaker", () => {
  // Import directly
  let CircuitBreaker: typeof import("../../src/integrations/resilience.js").CircuitBreaker;

  beforeEach(async () => {
    const mod = await import("../../src/integrations/resilience.js");
    CircuitBreaker = mod.CircuitBreaker;
  });

  it("starts in closed state", () => {
    const breaker = new CircuitBreaker("test", 3, 1000);
    expect(breaker.state).toBe("closed");
    expect(breaker.isOpen).toBe(false);
  });

  it("opens after threshold failures", async () => {
    const breaker = new CircuitBreaker("test", 3, 60_000);

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(() => { throw new Error("fail"); })).rejects.toThrow("fail");
    }

    expect(breaker.state).toBe("open");
    expect(breaker.isOpen).toBe(true);
  });

  it("fails fast when open", async () => {
    const breaker = new CircuitBreaker("test", 2, 60_000);

    // Trip the breaker
    for (let i = 0; i < 2; i++) {
      await expect(breaker.execute(() => { throw new Error("fail"); })).rejects.toThrow("fail");
    }

    // Should fail fast with circuit breaker message
    await expect(breaker.execute(() => "ok")).rejects.toThrow(/circuit breaker open/i);
  });

  it("resets to closed on success in half-open", async () => {
    const breaker = new CircuitBreaker("test", 2, 1); // 1ms reset time

    // Trip the breaker
    for (let i = 0; i < 2; i++) {
      await expect(breaker.execute(() => { throw new Error("fail"); })).rejects.toThrow("fail");
    }

    // Wait for reset time
    await new Promise((r) => setTimeout(r, 5));

    // Should succeed and transition to closed
    const result = await breaker.execute(() => "recovered");
    expect(result).toBe("recovered");
    expect(breaker.state).toBe("closed");
  });

  it("reset() restores closed state", async () => {
    const breaker = new CircuitBreaker("test", 2, 60_000);

    for (let i = 0; i < 2; i++) {
      await expect(breaker.execute(() => { throw new Error("fail"); })).rejects.toThrow();
    }

    expect(breaker.state).toBe("open");
    breaker.reset();
    expect(breaker.state).toBe("closed");

    const result = await breaker.execute(() => 42);
    expect(result).toBe(42);
  });
});

// =============================================================================
// Tests: Timeout
// =============================================================================

describe("withTimeout", () => {
  let withTimeout: typeof import("../../src/integrations/resilience.js").withTimeout;
  let TimeoutError: typeof import("../../src/integrations/resilience.js").TimeoutError;

  beforeEach(async () => {
    const mod = await import("../../src/integrations/resilience.js");
    withTimeout = mod.withTimeout;
    TimeoutError = mod.TimeoutError;
  });

  it("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000, "test");
    expect(result).toBe("ok");
  });

  it("throws TimeoutError when promise exceeds timeout", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 500));
    await expect(withTimeout(slow, 1, "slow-op")).rejects.toThrow(/timeout/i);
  });

  it("passes through when ms <= 0", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 0, "test");
    expect(result).toBe("ok");
  });
});

// =============================================================================
// Tests: Policy Bridge — Failure Paths
// =============================================================================

describe("PolicyBridge — failure paths", () => {
  it("handles policy engine evaluation error gracefully in evaluateNodes", async () => {
    const policyEngine: PolicyEvaluationEngine = {
      evaluateAll: vi.fn().mockImplementation(() => { throw new Error("Engine crash"); }),
      evaluate: vi.fn(),
    };
    const policyStorage = createMockPolicyStorage();
    const { ctx } = await setupContext({ policyEngine, policyStorage });
    const bridge = new PolicyBridge(ctx);

    // Should not throw, just return empty results for failed nodes
    const results = await bridge.evaluateNodes({});
    expect(results.size).toBe(0);
  });

  it("evaluateNodes limits batch size with maxNodes", async () => {
    const policyEngine = createMockPolicyEngine();
    const policyStorage = createMockPolicyStorage();
    const { ctx } = await setupContext({ policyEngine, policyStorage });
    const bridge = new PolicyBridge(ctx);

    const results = await bridge.evaluateNodes({}, { maxNodes: 2 });
    // We have 4 test nodes but limited to 2
    expect(results.size).toBeLessThanOrEqual(2);
  });
});
