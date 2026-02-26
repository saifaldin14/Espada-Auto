/**
 * Azure Automation Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureAutomationManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockAutomationAccount = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
};
const mockRunbook = {
  listByAutomationAccount: vi.fn(),
  get: vi.fn(),
};
const mockJob = {
  create: vi.fn(),
  listByAutomationAccount: vi.fn(),
};
const mockSchedule = { listByAutomationAccount: vi.fn() };

vi.mock("@azure/arm-automation", () => ({
  AutomationClient: vi.fn().mockImplementation(function() { return {
    automationAccount: mockAutomationAccount,
    runbook: mockRunbook,
    job: mockJob,
    schedule: mockSchedule,
  }; }),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureAutomationManager", () => {
  let mgr: AzureAutomationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureAutomationManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listAccounts", () => {
    it("lists all accounts", async () => {
      mockAutomationAccount.list.mockReturnValue(asyncIter([
        { id: "id", name: "auto-1", location: "eastus", properties: { state: "Ok", sku: { name: "Basic" } }, tags: {} },
      ]));
      const accounts = await mgr.listAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe("auto-1");
    });

    it("filters by resource group", async () => {
      mockAutomationAccount.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listAccounts("rg-1");
      expect(mockAutomationAccount.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("listRunbooks", () => {
    it("lists runbooks", async () => {
      mockRunbook.listByAutomationAccount.mockReturnValue(asyncIter([
        { id: "rb-id", name: "my-runbook", properties: { runbookType: "PowerShell", state: "Published", lastModifiedTime: new Date() } },
      ]));
      const runbooks = await mgr.listRunbooks("rg-1", "auto-1");
      expect(runbooks).toHaveLength(1);
      expect(runbooks[0].name).toBe("my-runbook");
    });
  });

  describe("getRunbook", () => {
    it("returns runbook details", async () => {
      mockRunbook.get.mockResolvedValue({
        id: "rb-id", name: "my-runbook", properties: { runbookType: "PowerShell", state: "Published" },
      });
      const rb = await mgr.getRunbook("rg-1", "auto-1", "my-runbook");
      expect(rb.name).toBe("my-runbook");
    });
  });

  describe("startRunbook", () => {
    it("starts a runbook job", async () => {
      mockJob.create.mockResolvedValue({
        id: "j-id", name: "job-1", properties: { status: "Running", startTime: new Date(), runbook: { name: "my-runbook" } },
      });
      const job = await mgr.startRunbook("rg-1", "auto-1", "my-runbook");
      expect(job.name).toBe("job-1");
    });
  });

  describe("listJobs", () => {
    it("lists jobs", async () => {
      mockJob.listByAutomationAccount.mockReturnValue(asyncIter([
        { id: "j-id", name: "job-1", properties: { status: "Completed", startTime: new Date(), endTime: new Date(), runbook: { name: "my-runbook" } } },
      ]));
      const jobs = await mgr.listJobs("rg-1", "auto-1");
      expect(jobs).toHaveLength(1);
    });
  });

  describe("listSchedules", () => {
    it("lists schedules", async () => {
      mockSchedule.listByAutomationAccount.mockReturnValue(asyncIter([
        { id: "s-id", name: "daily", properties: { frequency: "Day", interval: 1, startTime: new Date(), isEnabled: true } },
      ]));
      const schedules = await mgr.listSchedules("rg-1", "auto-1");
      expect(schedules).toHaveLength(1);
    });
  });
});
