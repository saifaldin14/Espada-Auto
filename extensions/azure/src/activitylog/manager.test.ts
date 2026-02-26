/**
 * Azure Activity Log Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureActivityLogManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockActivityLogs = { list: vi.fn() };

vi.mock("@azure/arm-monitor", () => ({
  MonitorClient: vi.fn().mockImplementation(function() { return {
    activityLogs: mockActivityLogs,
  }; }),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureActivityLogManager", () => {
  let mgr: AzureActivityLogManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureActivityLogManager(mockCreds, "sub-1");
  });

  describe("getEvents", () => {
    it("returns activity log events", async () => {
      mockActivityLogs.list.mockReturnValue(asyncIter([
        { eventTimestamp: new Date(), operationName: { localizedValue: "Create VM", value: "Microsoft.Compute/virtualMachines/write" }, status: { localizedValue: "Succeeded", value: "Succeeded" }, caller: "user@example.com", resourceGroupName: "rg-1", level: "Informational" },
      ]));
      const events = await mgr.getEvents();
      expect(events).toHaveLength(1);
    });

    it("returns empty when no events", async () => {
      mockActivityLogs.list.mockReturnValue(asyncIter([]));
      expect(await mgr.getEvents()).toEqual([]);
    });

    it("filters by resource group", async () => {
      mockActivityLogs.list.mockReturnValue(asyncIter([]));
      await mgr.getEvents({ resourceGroup: "rg-1" });
      expect(mockActivityLogs.list).toHaveBeenCalledWith(expect.stringContaining("resourceGroupName eq 'rg-1'"));
    });
  });

  describe("getResourceOperations", () => {
    it("delegates to getEvents", async () => {
      mockActivityLogs.list.mockReturnValue(asyncIter([
        { eventTimestamp: new Date(), operationName: { value: "write", localizedValue: "Write" }, status: { value: "Succeeded", localizedValue: "Succeeded" }, caller: "user@example.com", level: "Informational" },
      ]));
      const events = await mgr.getResourceOperations("/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-1");
      expect(events).toHaveLength(1);
    });
  });
});
