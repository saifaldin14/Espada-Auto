/**
 * Tests for Infrastructure Monitoring — Phase 6
 *
 * Covers: InfraMonitor, alert rules, event sources, timeline helpers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  InfraMonitor,
  SCHEDULE_PRESETS,
  BUILTIN_ALERT_RULES,
  orphanAlertRule,
  spofAlertRule,
  costAnomalyAlertRule,
  unauthorizedChangeAlertRule,
  disappearedAlertRule,
  getTimelineSummary,
  getGraphDiff,
  getCostTrend,
  CloudTrailEventSource,
  AzureActivityLogEventSource,
  GcpAuditLogEventSource,
  type AlertEvaluationContext,
  type CloudEvent,
  type AlertInstance,
  type CloudTrailClient,
  type AzureActivityClient,
  type GcpAuditClient,
} from "./monitoring.js";
import { GraphEngine } from "../core/engine.js";
import { InMemoryGraphStorage } from "../storage/memory-store.js";
import type {
  GraphNodeInput,
  GraphEdgeInput,
  GraphChange,
  GraphStats,
  SyncRecord,
} from "../types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeNode(overrides: Partial<GraphNodeInput>): GraphNodeInput {
  return {
    id: overrides.id ?? "node-1",
    provider: overrides.provider ?? "aws",
    resourceType: overrides.resourceType ?? "compute",
    nativeId: overrides.nativeId ?? "arn:aws:ec2:us-east-1:123:instance/i-1",
    name: overrides.name ?? "test-resource",
    region: overrides.region ?? "us-east-1",
    account: overrides.account ?? "123",
    status: overrides.status ?? "running",
    tags: overrides.tags ?? {},
    metadata: overrides.metadata ?? {},
    costMonthly: overrides.costMonthly ?? null,
    owner: overrides.owner ?? null,
    createdAt: overrides.createdAt ?? null,
  };
}

async function createTestStorage(
  nodes: GraphNodeInput[] = [],
  edges: GraphEdgeInput[] = [],
  changes: GraphChange[] = [],
): Promise<InMemoryGraphStorage> {
  const storage = new InMemoryGraphStorage();
  await storage.initialize();
  for (const node of nodes) await storage.upsertNode(node);
  for (const edge of edges) await storage.upsertEdge(edge);
  for (const change of changes) await storage.appendChange(change);
  return storage;
}

function makeChange(overrides: Partial<GraphChange>): GraphChange {
  return {
    id: overrides.id ?? `change-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    targetId: overrides.targetId ?? "node-1",
    changeType: overrides.changeType ?? "node-updated",
    field: overrides.field ?? null,
    previousValue: overrides.previousValue ?? null,
    newValue: overrides.newValue ?? null,
    detectedAt: overrides.detectedAt ?? new Date().toISOString(),
    detectedVia: overrides.detectedVia ?? "sync",
    correlationId: overrides.correlationId ?? null,
    initiator: overrides.initiator ?? null,
    initiatorType: overrides.initiatorType ?? null,
    metadata: overrides.metadata ?? {},
  };
}

function makeSyncRecord(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    id: overrides.id ?? "sync-1",
    provider: overrides.provider ?? "aws",
    status: overrides.status ?? "completed",
    startedAt: overrides.startedAt ?? new Date(Date.now() - 60000).toISOString(),
    completedAt: overrides.completedAt ?? new Date().toISOString(),
    nodesDiscovered: overrides.nodesDiscovered ?? 10,
    nodesCreated: overrides.nodesCreated ?? 0,
    nodesUpdated: overrides.nodesUpdated ?? 0,
    nodesDisappeared: overrides.nodesDisappeared ?? 0,
    edgesDiscovered: overrides.edgesDiscovered ?? 5,
    edgesCreated: overrides.edgesCreated ?? 0,
    edgesRemoved: overrides.edgesRemoved ?? 0,
    changesRecorded: overrides.changesRecorded ?? 0,
    errors: overrides.errors ?? [],
    durationMs: overrides.durationMs ?? 1000,
  };
}

function makeStats(overrides: Partial<GraphStats> = {}): GraphStats {
  return {
    totalNodes: overrides.totalNodes ?? 10,
    totalEdges: overrides.totalEdges ?? 5,
    totalChanges: overrides.totalChanges ?? 0,
    totalGroups: overrides.totalGroups ?? 0,
    nodesByProvider: overrides.nodesByProvider ?? {},
    nodesByResourceType: overrides.nodesByResourceType ?? {},
    edgesByRelationshipType: overrides.edgesByRelationshipType ?? {},
    totalCostMonthly: overrides.totalCostMonthly ?? 1000,
    lastSyncAt: overrides.lastSyncAt ?? null,
    oldestChange: overrides.oldestChange ?? null,
    newestChange: overrides.newestChange ?? null,
  };
}

async function makeAlertContext(
  storage: InMemoryGraphStorage,
  overrides: Partial<AlertEvaluationContext> = {},
): Promise<AlertEvaluationContext> {
  const engine = new GraphEngine({ storage });
  return {
    engine,
    storage,
    syncRecords: overrides.syncRecords ?? [makeSyncRecord()],
    previousStats: overrides.previousStats ?? null,
    currentStats: overrides.currentStats ?? await storage.getStats(),
  };
}

// =============================================================================
// Schedule Presets
// =============================================================================

describe("SCHEDULE_PRESETS", () => {
  it("should define standard intervals", () => {
    expect(SCHEDULE_PRESETS["5min"]).toBe(5 * 60 * 1000);
    expect(SCHEDULE_PRESETS["15min"]).toBe(15 * 60 * 1000);
    expect(SCHEDULE_PRESETS.hourly).toBe(60 * 60 * 1000);
    expect(SCHEDULE_PRESETS.daily).toBe(24 * 60 * 60 * 1000);
  });
});

// =============================================================================
// Built-in Alert Rules
// =============================================================================

describe("BUILTIN_ALERT_RULES", () => {
  it("should have 5 built-in rules", () => {
    expect(BUILTIN_ALERT_RULES).toHaveLength(5);
  });

  it("should all be enabled by default", () => {
    for (const rule of BUILTIN_ALERT_RULES) {
      expect(rule.enabled).toBe(true);
    }
  });

  it("should have unique IDs", () => {
    const ids = BUILTIN_ALERT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("orphanAlertRule", () => {
  it("should alert on orphaned resources", async () => {
    // Orphan: node with no edges
    const storage = await createTestStorage([
      makeNode({ id: "orphan-1", name: "lonely-vm", status: "running", costMonthly: 100 }),
    ]);
    const ctx = await makeAlertContext(storage);
    const alerts = await orphanAlertRule.evaluate(ctx);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].category).toBe("orphan");
    expect(alerts[0].affectedNodeIds).toContain("orphan-1");
    expect(alerts[0].costImpact).toBe(100);
  });

  it("should not alert when all nodes have connections", async () => {
    const storage = await createTestStorage(
      [
        makeNode({ id: "vm-1", status: "running" }),
        makeNode({ id: "vpc-1", resourceType: "vpc", status: "running" }),
      ],
      [
        {
          id: "edge-1",
          sourceNodeId: "vm-1",
          targetNodeId: "vpc-1",
          relationshipType: "runs-in",
          confidence: 1,
          discoveredVia: "config-scan",
          metadata: {},
        },
      ],
    );
    const ctx = await makeAlertContext(storage);
    const alerts = await orphanAlertRule.evaluate(ctx);
    expect(alerts).toHaveLength(0);
  });

  it("should escalate to critical when orphan cost exceeds $1000", async () => {
    const storage = await createTestStorage([
      makeNode({ id: "gpu-1", status: "running", costMonthly: 1500 }),
    ]);
    const ctx = await makeAlertContext(storage);
    const alerts = await orphanAlertRule.evaluate(ctx);

    expect(alerts[0].severity).toBe("critical");
  });
});

describe("spofAlertRule", () => {
  it("should alert on high-degree nodes with high reachability", async () => {
    // Create a star topology: central node connected to 6 leaf nodes
    const nodes = [
      makeNode({ id: "hub", name: "central-lb", status: "running", resourceType: "load-balancer" }),
      ...Array.from({ length: 6 }, (_, i) =>
        makeNode({ id: `leaf-${i}`, name: `service-${i}`, status: "running" }),
      ),
    ];
    const edges: GraphEdgeInput[] = Array.from({ length: 6 }, (_, i) => ({
      id: `edge-${i}`,
      sourceNodeId: "hub",
      targetNodeId: `leaf-${i}`,
      relationshipType: "routes-to" as const,
      confidence: 1,
      discoveredVia: "config-scan" as const,
      metadata: {},
    }));

    const storage = await createTestStorage(nodes, edges);
    const ctx = await makeAlertContext(storage);
    const alerts = await spofAlertRule.evaluate(ctx);

    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts[0].category).toBe("spof");
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].affectedNodeIds).toContain("hub");
  });

  it("should not alert on low-degree nodes", async () => {
    const storage = await createTestStorage([
      makeNode({ id: "vm-1", status: "running" }),
      makeNode({ id: "vm-2", status: "running" }),
    ], [
      {
        id: "e-1",
        sourceNodeId: "vm-1",
        targetNodeId: "vm-2",
        relationshipType: "depends-on",
        confidence: 1,
        discoveredVia: "config-scan",
        metadata: {},
      },
    ]);
    const ctx = await makeAlertContext(storage);
    const alerts = await spofAlertRule.evaluate(ctx);
    expect(alerts).toHaveLength(0);
  });
});

describe("costAnomalyAlertRule", () => {
  it("should alert when cost increases > 20%", async () => {
    const storage = await createTestStorage();
    const ctx = await makeAlertContext(storage, {
      previousStats: makeStats({ totalCostMonthly: 1000 }),
      currentStats: makeStats({ totalCostMonthly: 1500 }),
    });
    const alerts = await costAnomalyAlertRule.evaluate(ctx);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].category).toBe("cost-anomaly");
    expect(alerts[0].costImpact).toBe(500);
  });

  it("should not alert when cost change is under 20%", async () => {
    const storage = await createTestStorage();
    const ctx = await makeAlertContext(storage, {
      previousStats: makeStats({ totalCostMonthly: 1000 }),
      currentStats: makeStats({ totalCostMonthly: 1100 }),
    });
    const alerts = await costAnomalyAlertRule.evaluate(ctx);
    expect(alerts).toHaveLength(0);
  });

  it("should not alert when no previous stats", async () => {
    const storage = await createTestStorage();
    const ctx = await makeAlertContext(storage, {
      previousStats: null,
      currentStats: makeStats({ totalCostMonthly: 5000 }),
    });
    const alerts = await costAnomalyAlertRule.evaluate(ctx);
    expect(alerts).toHaveLength(0);
  });

  it("should escalate to critical when > 50%", async () => {
    const storage = await createTestStorage();
    const ctx = await makeAlertContext(storage, {
      previousStats: makeStats({ totalCostMonthly: 1000 }),
      currentStats: makeStats({ totalCostMonthly: 2000 }),
    });
    const alerts = await costAnomalyAlertRule.evaluate(ctx);
    expect(alerts[0].severity).toBe("critical");
  });
});

describe("unauthorizedChangeAlertRule", () => {
  it("should alert on changes without approval", async () => {
    const syncRecord = makeSyncRecord({
      startedAt: new Date(Date.now() - 60000).toISOString(),
    });
    const storage = await createTestStorage([], [], [
      makeChange({
        changeType: "node-created",
        initiatorType: "agent",
        correlationId: null,
        detectedAt: new Date().toISOString(),
      }),
    ]);
    const ctx = await makeAlertContext(storage, {
      syncRecords: [syncRecord],
    });
    const alerts = await unauthorizedChangeAlertRule.evaluate(ctx);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].category).toBe("unauthorized-change");
    expect(alerts[0].severity).toBe("critical");
  });

  it("should not alert on approved changes", async () => {
    const syncRecord = makeSyncRecord({
      startedAt: new Date(Date.now() - 60000).toISOString(),
    });
    const storage = await createTestStorage([], [], [
      makeChange({
        changeType: "node-created",
        initiator: "user@example.com",
        initiatorType: "human",
        correlationId: "approval-123",
        detectedAt: new Date().toISOString(),
      }),
    ]);
    const ctx = await makeAlertContext(storage, {
      syncRecords: [syncRecord],
    });
    const alerts = await unauthorizedChangeAlertRule.evaluate(ctx);
    expect(alerts).toHaveLength(0);
  });
});

describe("disappearedAlertRule", () => {
  it("should alert when resources disappear", async () => {
    const syncRecord = makeSyncRecord({
      nodesDisappeared: 3,
      startedAt: new Date(Date.now() - 60000).toISOString(),
    });
    const storage = await createTestStorage([], [], [
      makeChange({ changeType: "node-disappeared", targetId: "vm-1", detectedAt: new Date().toISOString() }),
      makeChange({ changeType: "node-disappeared", targetId: "vm-2", detectedAt: new Date().toISOString() }),
      makeChange({ changeType: "node-disappeared", targetId: "vm-3", detectedAt: new Date().toISOString() }),
    ]);
    const ctx = await makeAlertContext(storage, {
      syncRecords: [syncRecord],
    });
    const alerts = await disappearedAlertRule.evaluate(ctx);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].affectedNodeIds).toHaveLength(3);
  });

  it("should not alert when no resources disappeared", async () => {
    const syncRecord = makeSyncRecord({ nodesDisappeared: 0 });
    const storage = await createTestStorage();
    const ctx = await makeAlertContext(storage, {
      syncRecords: [syncRecord],
    });
    const alerts = await disappearedAlertRule.evaluate(ctx);
    expect(alerts).toHaveLength(0);
  });
});

// =============================================================================
// InfraMonitor
// =============================================================================

describe("InfraMonitor", () => {
  it("should initialize with default config", async () => {
    const storage = await createTestStorage();
    const engine = new GraphEngine({ storage });
    const monitor = new InfraMonitor({ engine, storage });

    expect(monitor.isRunning()).toBe(false);
    const status = monitor.getStatus();
    expect(status.alertRulesEnabled).toBe(5);
    expect(status.alertRulesTotal).toBe(5);
  });

  it("should run a sync cycle", async () => {
    const storage = await createTestStorage([
      makeNode({ id: "vm-1", status: "running" }),
    ]);
    const engine = new GraphEngine({ storage });
    const monitor = new InfraMonitor({
      engine,
      storage,
      config: { alertRules: [] },
    });

    const result = await monitor.runSyncCycle();
    expect(result.syncRecords).toHaveLength(0); // No adapters registered
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeTruthy();
  });

  it("should evaluate alerts during sync cycle", async () => {
    // Create orphan to trigger alert
    const storage = await createTestStorage([
      makeNode({ id: "orphan-1", status: "running", costMonthly: 50 }),
    ]);
    const engine = new GraphEngine({ storage });
    const monitor = new InfraMonitor({
      engine,
      storage,
      config: {
        alertRules: [orphanAlertRule],
      },
    });

    const result = await monitor.runSyncCycle();
    expect(result.alerts.length).toBeGreaterThanOrEqual(1);
    expect(monitor.alertHistory.length).toBeGreaterThanOrEqual(1);
  });

  it("should respect alert cooldown", async () => {
    const storage = await createTestStorage([
      makeNode({ id: "orphan-1", status: "running" }),
    ]);
    const engine = new GraphEngine({ storage });
    const monitor = new InfraMonitor({
      engine,
      storage,
      config: {
        alertRules: [orphanAlertRule],
        alertCooldownMs: 60000,
      },
    });

    // First cycle should trigger
    const result1 = await monitor.runSyncCycle();
    expect(result1.alerts.length).toBeGreaterThan(0);

    // Second cycle within cooldown should not trigger
    const result2 = await monitor.runSyncCycle();
    expect(result2.alerts).toHaveLength(0);
  });

  it("should dispatch to callback destination", async () => {
    const received: AlertInstance[] = [];
    const storage = await createTestStorage([
      makeNode({ id: "orphan-1", status: "running" }),
    ]);
    const engine = new GraphEngine({ storage });
    const monitor = new InfraMonitor({
      engine,
      storage,
      config: {
        alertRules: [orphanAlertRule],
        alertDestinations: [{
          type: "callback",
          callback: async (alerts) => { received.push(...alerts); },
        }],
      },
    });

    await monitor.runSyncCycle();
    expect(received.length).toBeGreaterThan(0);
    expect(received[0].ruleId).toBe("builtin-orphan");
  });

  it("should start and stop", async () => {
    const storage = await createTestStorage();
    const engine = new GraphEngine({ storage });
    const monitor = new InfraMonitor({
      engine,
      storage,
      config: {
        schedule: { intervalMs: 999999 },
        alertRules: [],
      },
    });

    await monitor.start();
    expect(monitor.isRunning()).toBe(true);

    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  it("should respect maxAlertsPerCycle", async () => {
    const storage = await createTestStorage([
      makeNode({ id: "orphan-1", status: "running" }),
    ]);
    const engine = new GraphEngine({ storage });
    const monitor = new InfraMonitor({
      engine,
      storage,
      config: {
        alertRules: [orphanAlertRule, spofAlertRule, costAnomalyAlertRule],
        maxAlertsPerCycle: 1,
      },
    });

    const result = await monitor.runSyncCycle();
    expect(result.alerts.length).toBeLessThanOrEqual(1);
  });

  it("should provide status summary", async () => {
    const storage = await createTestStorage();
    const engine = new GraphEngine({ storage });
    const monitor = new InfraMonitor({ engine, storage });

    const status = monitor.getStatus();
    expect(status.running).toBe(false);
    expect(status.alertRulesEnabled).toBe(5);
    expect(status.alertsTriggered).toBe(0);
    expect(status.activeEventSources).toHaveLength(0);
  });
});

// =============================================================================
// Event Sources
// =============================================================================

describe("CloudTrailEventSource", () => {
  it("should fetch and parse events", async () => {
    const mockClient: CloudTrailClient = {
      lookupEvents: async () => ({
        Events: [
          {
            EventId: "ct-1",
            EventName: "RunInstances",
            EventTime: new Date().toISOString(),
            Username: "admin",
            ReadOnly: "false",
            Resources: [
              { ResourceType: "AWS::EC2::Instance", ResourceName: "i-12345" },
            ],
          },
        ],
      }),
    };

    const source = new CloudTrailEventSource({
      region: "us-east-1",
      clientFactory: () => mockClient,
    });

    const events = await source.fetchEvents(new Date(Date.now() - 3600000).toISOString());
    expect(events).toHaveLength(1);
    expect(events[0].provider).toBe("aws");
    expect(events[0].eventType).toBe("RunInstances");
    expect(events[0].actor).toBe("admin");
    expect(events[0].readOnly).toBe(false);
  });

  it("should filter read-only events by default", async () => {
    const mockClient: CloudTrailClient = {
      lookupEvents: async () => ({
        Events: [
          { EventId: "ct-1", EventName: "DescribeInstances", ReadOnly: "true" },
          { EventId: "ct-2", EventName: "RunInstances", ReadOnly: "false" },
        ],
      }),
    };

    const source = new CloudTrailEventSource({
      clientFactory: () => mockClient,
    });

    const events = await source.fetchEvents(new Date().toISOString());
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("RunInstances");
  });

  it("should health check via client", async () => {
    const mockClient: CloudTrailClient = {
      lookupEvents: async () => ({ Events: [] }),
    };

    const source = new CloudTrailEventSource({
      clientFactory: () => mockClient,
    });

    const health = await source.healthCheck();
    expect(health.ok).toBe(true);
  });
});

describe("AzureActivityLogEventSource", () => {
  it("should fetch and parse events", async () => {
    const mockClient: AzureActivityClient = {
      listEvents: async () => [
        {
          eventDataId: "az-1",
          eventTimestamp: new Date().toISOString(),
          operationName: { value: "Microsoft.Compute/virtualMachines/write" },
          resourceId: "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-1",
          resourceType: { value: "Microsoft.Compute/virtualMachines" },
          caller: "user@example.com",
          status: { value: "Succeeded" },
        },
      ],
    };

    const source = new AzureActivityLogEventSource({
      subscriptionId: "sub-1",
      clientFactory: () => mockClient,
    });

    const events = await source.fetchEvents(new Date(Date.now() - 3600000).toISOString());
    expect(events).toHaveLength(1);
    expect(events[0].provider).toBe("azure");
    expect(events[0].eventType).toBe("Microsoft.Compute/virtualMachines/write");
    expect(events[0].success).toBe(true);
    expect(events[0].readOnly).toBe(false);
  });
});

describe("GcpAuditLogEventSource", () => {
  it("should fetch and parse events", async () => {
    const mockClient: GcpAuditClient = {
      listEntries: async () => [
        {
          insertId: "gcp-1",
          timestamp: new Date().toISOString(),
          resource: { type: "gce_instance", labels: { instance_id: "12345" } },
          protoPayload: {
            methodName: "v1.compute.instances.insert",
            resourceName: "projects/my-project/zones/us-central1-a/instances/vm-1",
            authenticationInfo: { principalEmail: "user@example.com" },
          },
        },
      ],
    };

    const source = new GcpAuditLogEventSource({
      projectId: "my-project",
      clientFactory: () => mockClient,
    });

    const events = await source.fetchEvents(new Date(Date.now() - 3600000).toISOString());
    expect(events).toHaveLength(1);
    expect(events[0].provider).toBe("gcp");
    expect(events[0].eventType).toBe("v1.compute.instances.insert");
    expect(events[0].actor).toBe("user@example.com");
    expect(events[0].readOnly).toBe(false);
  });

  it("should detect read-only methods", async () => {
    const mockClient: GcpAuditClient = {
      listEntries: async () => [
        {
          insertId: "gcp-2",
          timestamp: new Date().toISOString(),
          protoPayload: { methodName: "getProject" },
        },
      ],
    };

    const source = new GcpAuditLogEventSource({
      projectId: "my-project",
      clientFactory: () => mockClient,
    });

    const events = await source.fetchEvents(new Date().toISOString());
    expect(events[0].readOnly).toBe(true);
  });
});

// =============================================================================
// Timeline Helpers
// =============================================================================

describe("getTimelineSummary", () => {
  it("should summarize changes in a time range", async () => {
    const since = new Date(Date.now() - 3600000).toISOString();
    const storage = await createTestStorage([], [], [
      makeChange({ changeType: "node-created", targetId: "vm-1", initiator: "admin", detectedAt: new Date().toISOString() }),
      makeChange({ changeType: "node-updated", targetId: "vm-1", initiator: "admin", detectedAt: new Date().toISOString() }),
      makeChange({ changeType: "node-created", targetId: "vm-2", initiator: "bot", detectedAt: new Date().toISOString() }),
    ]);

    const summary = await getTimelineSummary(storage, since);
    expect(summary.totalChanges).toBe(3);
    expect(summary.affectedResourceCount).toBe(2);
    expect(summary.byType["node-created"]).toBe(2);
    expect(summary.byType["node-updated"]).toBe(1);
    expect(summary.byInitiator["admin"]).toBe(2);
    expect(summary.byInitiator["bot"]).toBe(1);
  });

  it("should return empty summary for no changes", async () => {
    const storage = await createTestStorage();
    const summary = await getTimelineSummary(storage, new Date(Date.now() - 3600000).toISOString());
    expect(summary.totalChanges).toBe(0);
    expect(summary.affectedResourceCount).toBe(0);
  });
});

describe("getGraphDiff", () => {
  it("should categorize changes into created/deleted/modified", async () => {
    const since = new Date(Date.now() - 3600000).toISOString();
    const storage = await createTestStorage([], [], [
      makeChange({ changeType: "node-created", targetId: "new-vm", detectedAt: new Date().toISOString() }),
      makeChange({ changeType: "node-deleted", targetId: "old-vm", detectedAt: new Date().toISOString() }),
      makeChange({ changeType: "node-updated", targetId: "existing-vm", field: "status", detectedAt: new Date().toISOString() }),
      makeChange({ changeType: "node-drifted", targetId: "drifted-vm", field: "tags", detectedAt: new Date().toISOString() }),
    ]);

    const diff = await getGraphDiff(storage, since);
    expect(diff.created).toContain("new-vm");
    expect(diff.deleted).toContain("old-vm");
    expect(diff.modified["existing-vm"]).toHaveLength(1);
    expect(diff.modified["drifted-vm"]).toHaveLength(1);
  });

  it("should deduplicate created/deleted IDs", async () => {
    const since = new Date(Date.now() - 3600000).toISOString();
    const storage = await createTestStorage([], [], [
      makeChange({ id: "c1", changeType: "node-created", targetId: "vm-1", detectedAt: new Date().toISOString() }),
      makeChange({ id: "c2", changeType: "node-created", targetId: "vm-1", detectedAt: new Date().toISOString() }),
    ]);

    const diff = await getGraphDiff(storage, since);
    expect(diff.created).toHaveLength(1);
  });
});

describe("getCostTrend", () => {
  it("should return trend from sync records", async () => {
    const storage = await createTestStorage();
    await storage.saveSyncRecord(makeSyncRecord({
      id: "sync-1",
      status: "completed",
      nodesDiscovered: 10,
    }));
    await storage.saveSyncRecord(makeSyncRecord({
      id: "sync-2",
      status: "completed",
      nodesDiscovered: 12,
    }));

    const trend = await getCostTrend(storage);
    expect(trend).toHaveLength(2);
    expect(trend[0].nodesDiscovered).toBeGreaterThan(0);
  });

  it("should skip failed syncs", async () => {
    const storage = await createTestStorage();
    await storage.saveSyncRecord(makeSyncRecord({
      id: "sync-1",
      status: "failed",
    }));

    const trend = await getCostTrend(storage);
    expect(trend).toHaveLength(0);
  });
});
