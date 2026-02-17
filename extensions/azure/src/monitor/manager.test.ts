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
const mockMetricAlerts = { listByResourceGroup: vi.fn() };
const mockDiagnosticSettings = { list: vi.fn() };

const mockWorkspaces = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
};

vi.mock("@azure/arm-monitor", () => ({
  MonitorClient: vi.fn().mockImplementation(() => ({
    metrics: mockMetrics,
    metricAlerts: mockMetricAlerts,
    diagnosticSettings: mockDiagnosticSettings,
  })),
}));

vi.mock("@azure/arm-operationalinsights", () => ({
  OperationalInsightsManagementClient: vi.fn().mockImplementation(() => ({
    workspaces: mockWorkspaces,
  })),
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
});
