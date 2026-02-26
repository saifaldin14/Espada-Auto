/**
 * Azure Monitor Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureMonitorManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockMetrics = { list: vi.fn() };
const mockMetricAlerts = {
  listByResourceGroup: vi.fn(),
  createOrUpdate: vi.fn(),
  delete: vi.fn(),
};
const mockDiagnosticSettings = {
  list: vi.fn(),
  createOrUpdate: vi.fn(),
  delete: vi.fn(),
};

const mockWorkspaces = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
};

vi.mock("@azure/arm-monitor", () => ({
  MonitorClient: vi.fn().mockImplementation(function() { return {
    metrics: mockMetrics,
    metricAlerts: mockMetricAlerts,
    diagnosticSettings: mockDiagnosticSettings,
  }; }),
}));

vi.mock("@azure/arm-operationalinsights", () => ({
  OperationalInsightsManagementClient: vi.fn().mockImplementation(function() { return {
    workspaces: mockWorkspaces,
  }; }),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureMonitorManager", () => {
  let mgr: AzureMonitorManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureMonitorManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listMetrics", () => {
    it("returns metrics for a resource", async () => {
      mockMetrics.list.mockResolvedValue({
        value: [
          { id: "m-1", name: { value: "CpuPercentage", localizedValue: "CPU Percentage" }, unit: "Percent", timeseries: [{ data: [{ timeStamp: new Date(), average: 45.2 }] }] },
        ],
      });
      const metrics = await mgr.listMetrics("/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-1", ["CpuPercentage"]);
      expect(metrics).toHaveLength(1);
    });
  });

  describe("listAlertRules", () => {
    it("lists metric alert rules", async () => {
      mockMetricAlerts.listByResourceGroup.mockReturnValue(asyncIter([
        { id: "ar-id", name: "high-cpu", location: "global", properties: { severity: 2, enabled: true, description: "High CPU", criteria: {} } },
      ]));
      const alerts = await mgr.listAlertRules("rg-1");
      expect(alerts).toHaveLength(1);
    });
  });

  describe("listLogAnalyticsWorkspaces", () => {
    it("lists all workspaces", async () => {
      mockWorkspaces.list.mockReturnValue(asyncIter([
        { id: "ws-id", name: "la-ws-1", location: "eastus", properties: { customerId: "guid", sku: { name: "PerGB2018" }, retentionInDays: 30, provisioningState: "Succeeded" } },
      ]));
      const ws = await mgr.listLogAnalyticsWorkspaces();
      expect(ws).toHaveLength(1);
      expect(ws[0].name).toBe("la-ws-1");
    });

    it("filters by resource group", async () => {
      mockWorkspaces.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listLogAnalyticsWorkspaces("rg-1");
      expect(mockWorkspaces.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("listDiagnosticSettings", () => {
    it("returns diagnostic settings", async () => {
      mockDiagnosticSettings.list.mockResolvedValue({
        value: [
          { id: "ds-id", name: "diag-1", properties: { storageAccountId: "sa-id", workspaceId: "ws-id", logs: [], metrics: [] } },
        ],
      });
      const settings = await mgr.listDiagnosticSettings("/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-1");
      expect(settings).toHaveLength(1);
    });
  });

  describe("createAlertRule", () => {
    it("creates a metric alert rule", async () => {
      mockMetricAlerts.createOrUpdate.mockResolvedValue({
        id: "ar-id", name: "cpu-alert", location: "global",
        severity: 2, enabled: true, scopes: ["/subscriptions/sub-1"],
        evaluationFrequency: "PT5M", windowSize: "PT5M",
      });
      const rule = await mgr.createAlertRule("rg-1", {
        name: "cpu-alert",
        scopes: ["/subscriptions/sub-1"],
        severity: 2,
        criteria: [{ metricName: "CpuPercentage", operator: "GreaterThan", threshold: 80, timeAggregation: "Average" }],
      });
      expect(rule.name).toBe("cpu-alert");
      expect(rule.severity).toBe(2);
    });
  });

  describe("deleteAlertRule", () => {
    it("deletes a metric alert rule", async () => {
      mockMetricAlerts.delete.mockResolvedValue(undefined);
      await expect(mgr.deleteAlertRule("rg-1", "old-alert")).resolves.toBeUndefined();
    });
  });

  describe("createDiagnosticSetting", () => {
    it("creates a diagnostic setting", async () => {
      mockDiagnosticSettings.createOrUpdate.mockResolvedValue({
        id: "ds-id", name: "new-diag",
        workspaceId: "ws-id",
        logs: [{ category: "AuditLogs", enabled: true }],
        metrics: [{ category: "AllMetrics", enabled: true }],
      });
      const ds = await mgr.createDiagnosticSetting(
        "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-1",
        "new-diag",
        { workspaceId: "ws-id", logs: [{ category: "AuditLogs", enabled: true }] }
      );
      expect(ds.name).toBe("new-diag");
    });
  });

  describe("deleteDiagnosticSetting", () => {
    it("deletes a diagnostic setting", async () => {
      mockDiagnosticSettings.delete.mockResolvedValue(undefined);
      await expect(mgr.deleteDiagnosticSetting("/subscriptions/sub-1/resource", "old-diag")).resolves.toBeUndefined();
    });
  });
});
