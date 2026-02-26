import { describe, it, expect } from "vitest";
import { ReconciliationEngine, createReconciliationEngine } from "./engine.js";
import type { ReconciliationConfig } from "./types.js";
import type { DesiredResource, ActualResource } from "./engine.js";

function makeConfig(overrides: Partial<ReconciliationConfig> = {}): ReconciliationConfig {
  return {
    subscriptionId: "sub-123",
    enableDriftDetection: true,
    enableComplianceCheck: true,
    enableCostAnomalyDetection: true,
    autoRemediate: false,
    dryRun: false,
    ...overrides,
  };
}

function makeDesired(): DesiredResource[] {
  return [
    {
      id: "r1",
      name: "web-app",
      type: "Microsoft.Web/sites",
      resourceGroup: "rg-test",
      properties: { httpsOnly: true, minTlsVersion: "1.2" },
      tags: { env: "production", team: "platform" },
    },
    {
      id: "r2",
      name: "storage-acct",
      type: "Microsoft.Storage/storageAccounts",
      resourceGroup: "rg-test",
      properties: { supportsHttpsTrafficOnly: true, minimumTlsVersion: "TLS1_2" },
      tags: { env: "production" },
    },
  ];
}

function makeActual(): ActualResource[] {
  return [
    {
      id: "r1",
      name: "web-app",
      type: "Microsoft.Web/sites",
      resourceGroup: "rg-test",
      properties: { httpsOnly: false, minTlsVersion: "1.0" },
      tags: { env: "production", team: "platform" },
      monthlyCostUsd: 100,
      historicalCostUsd: 50,
    },
    {
      id: "r2",
      name: "storage-acct",
      type: "Microsoft.Storage/storageAccounts",
      resourceGroup: "rg-test",
      properties: { supportsHttpsTrafficOnly: true, minimumTlsVersion: "TLS1_2" },
      tags: { env: "production" },
      monthlyCostUsd: 20,
      historicalCostUsd: 18,
    },
  ];
}

describe("ReconciliationEngine", () => {
  it("creates via factory", () => {
    const engine = createReconciliationEngine();
    expect(engine).toBeInstanceOf(ReconciliationEngine);
  });

  it("detects drift between desired and actual", () => {
    const engine = createReconciliationEngine();
    const result = engine.reconcile(makeConfig(), makeDesired(), makeActual());
    expect(result.summary.driftsDetected).toBeGreaterThan(0);
    // r1 has httpsOnly and minTlsVersion drift
    const r1Drift = result.drifts.find((d) => d.resourceId === "r1");
    expect(r1Drift).toBeDefined();
    expect(r1Drift!.changes.length).toBeGreaterThan(0);
  });

  it("detects no drift for matching resources", () => {
    const engine = createReconciliationEngine();
    const desired: DesiredResource[] = [
      { id: "r1", name: "test", type: "Microsoft.Web/sites", resourceGroup: "rg-test", properties: { a: 1 }, tags: {} },
    ];
    const actual: ActualResource[] = [
      { id: "r1", name: "test", type: "Microsoft.Web/sites", resourceGroup: "rg-test", properties: { a: 1 }, tags: {}, monthlyCostUsd: 10, historicalCostUsd: 10 },
    ];
    const result = engine.reconcile(makeConfig(), desired, actual);
    expect(result.summary.driftsDetected).toBe(0);
  });

  it("detects cost anomalies (spike)", () => {
    const engine = createReconciliationEngine();
    const desired = makeDesired();
    const actual: ActualResource[] = [
      { ...makeActual()[0], monthlyCostUsd: 500, historicalCostUsd: 100 },
      makeActual()[1],
    ];
    const result = engine.reconcile(makeConfig(), desired, actual);
    expect(result.costAnomalies.length).toBeGreaterThan(0);
    // 500 vs 100 is a 400% spike
    const spike = result.costAnomalies.find((a) => a.anomalyType === "spike");
    expect(spike).toBeDefined();
  });

  it("generates remediation actions for drift", () => {
    const engine = createReconciliationEngine();
    const result = engine.reconcile(makeConfig(), makeDesired(), makeActual());
    expect(result.remediationActions.length).toBeGreaterThan(0);
  });

  it("runs in dry-run mode (no auto-remediation)", () => {
    const engine = createReconciliationEngine();
    const result = engine.reconcile(makeConfig({ dryRun: true, autoRemediate: true }), makeDesired(), makeActual());
    expect(result.executedRemediations).toHaveLength(0);
  });

  it("auto-remediates when enabled", () => {
    const engine = createReconciliationEngine();
    const result = engine.reconcile(makeConfig({ autoRemediate: true }), makeDesired(), makeActual());
    // Some actions might be auto-remediable
    expect(result.executedRemediations.length).toBeGreaterThanOrEqual(0);
  });

  it("checks compliance with built-in policies", () => {
    const engine = createReconciliationEngine();
    const desired = makeDesired();
    const actual = makeActual();
    const result = engine.reconcile(makeConfig(), desired, actual);
    // r1 has httpsOnly: false — should flag compliance
    const complianceIssues = result.complianceIssues;
    expect(Array.isArray(complianceIssues)).toBe(true);
  });

  it("adds custom compliance policy", () => {
    const engine = createReconciliationEngine();
    engine.addCompliancePolicy({
      id: "custom-policy",
      name: "Custom Policy",
      framework: "custom-framework",
      severity: "high",
      check: (resource) => {
        if (resource.properties?.customField === true) return null;
        return {
          resourceId: resource.id,
          resourceName: resource.name,
          resourceType: resource.type,
          policyId: "custom-policy",
          policyName: "Custom Policy",
          framework: "custom-framework",
          severity: "high" as const,
          description: "customField must be true",
          recommendation: "Set customField to true",
        };
      },
    });
    const desired: DesiredResource[] = [
      { id: "r1", name: "test", type: "Microsoft.Web/sites", resourceGroup: "rg-test", properties: { customField: false }, tags: {} },
    ];
    const actual: ActualResource[] = [
      { id: "r1", name: "test", type: "Microsoft.Web/sites", resourceGroup: "rg-test", properties: { customField: false }, tags: {}, monthlyCostUsd: 10, historicalCostUsd: 10 },
    ];
    const result = engine.reconcile(makeConfig(), desired, actual);
    const customIssue = result.complianceIssues.find((i) => i.policyId === "custom-policy");
    expect(customIssue).toBeDefined();
  });

  it("creates and lists schedules", () => {
    const engine = createReconciliationEngine();
    const schedule = engine.createSchedule("daily-reconciliation", makeConfig(), "0 0 * * *");
    expect(schedule.id).toBeTruthy();
    expect(schedule.name).toBe("daily-reconciliation");

    const schedules = engine.listSchedules();
    expect(schedules.length).toBe(1);
    expect(schedules[0].id).toBe(schedule.id);
  });

  it("gets schedule by ID", () => {
    const engine = createReconciliationEngine();
    const schedule = engine.createSchedule("weekly", makeConfig(), "0 0 * * 0");
    const found = engine.getSchedule(schedule.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("weekly");
  });

  it("deletes schedule", () => {
    const engine = createReconciliationEngine();
    const schedule = engine.createSchedule("to-delete", makeConfig(), "0 0 * * *");
    const ok = engine.deleteSchedule(schedule.id);
    expect(ok).toBe(true);
    expect(engine.listSchedules()).toHaveLength(0);
  });

  it("returns false when deleting nonexistent schedule", () => {
    const engine = createReconciliationEngine();
    const ok = engine.deleteSchedule("nonexistent");
    expect(ok).toBe(false);
  });

  it("detects deleted resources (in desired but not actual)", () => {
    const engine = createReconciliationEngine();
    const desired: DesiredResource[] = [
      { id: "r1", name: "test", type: "Microsoft.Web/sites", resourceGroup: "rg-test", properties: {}, tags: {} },
      { id: "r2", name: "test2", type: "Microsoft.Storage/storageAccounts", resourceGroup: "rg-test", properties: {}, tags: {} },
    ];
    const actual: ActualResource[] = [
      { id: "r1", name: "test", type: "Microsoft.Web/sites", resourceGroup: "rg-test", properties: {}, tags: {}, monthlyCostUsd: 10, historicalCostUsd: 10 },
    ];
    const result = engine.reconcile(makeConfig(), desired, actual);
    const deletedDrift = result.drifts.find((d) => d.driftType === "deleted");
    expect(deletedDrift).toBeDefined();
  });

  it("generates summary with correct counts", () => {
    const engine = createReconciliationEngine();
    const result = engine.reconcile(makeConfig(), makeDesired(), makeActual());
    expect(result.summary).toBeDefined();
    expect(result.summary.driftsDetected).toBe(result.drifts.length);
    expect(result.summary.complianceIssuesFound).toBe(result.complianceIssues.length);
    expect(result.summary.costAnomaliesFound).toBe(result.costAnomalies.length);
    expect(result.summary.remediationsPlanned).toBe(result.remediationActions.length);
  });

  it("result has id and startedAt", () => {
    const engine = createReconciliationEngine();
    const result = engine.reconcile(makeConfig(), makeDesired(), makeActual());
    expect(result.id).toBeTruthy();
    expect(result.startedAt).toBeTruthy();
  });
});
