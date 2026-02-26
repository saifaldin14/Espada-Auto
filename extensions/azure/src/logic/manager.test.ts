/**
 * Azure Logic Apps Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureLogicAppsManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockWorkflows = {
  listBySubscription: vi.fn(),
  listByResourceGroup: vi.fn(),
  get: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  createOrUpdate: vi.fn(),
  delete: vi.fn(),
};
const mockWorkflowRuns = { list: vi.fn() };
const mockWorkflowTriggers = {
  list: vi.fn(),
  run: vi.fn(),
};

vi.mock("@azure/arm-logic", () => ({
  LogicManagementClient: vi.fn().mockImplementation(function() { return {
    workflows: mockWorkflows,
    workflowRuns: mockWorkflowRuns,
    workflowTriggers: mockWorkflowTriggers,
  }; }),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureLogicAppsManager", () => {
  let mgr: AzureLogicAppsManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureLogicAppsManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listWorkflows", () => {
    it("lists all workflows", async () => {
      mockWorkflows.listBySubscription.mockReturnValue(asyncIter([
        { id: "id", name: "wf-1", location: "eastus", properties: { state: "Enabled", createdTime: new Date(), changedTime: new Date(), provisioningState: "Succeeded" }, tags: {} },
      ]));
      const wfs = await mgr.listWorkflows();
      expect(wfs).toHaveLength(1);
      expect(wfs[0].name).toBe("wf-1");
    });

    it("filters by resource group", async () => {
      mockWorkflows.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listWorkflows("rg-1");
      expect(mockWorkflows.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("getWorkflow", () => {
    it("returns workflow details", async () => {
      mockWorkflows.get.mockResolvedValue({ name: "wf-1", location: "eastus", properties: { state: "Enabled" } });
      const wf = await mgr.getWorkflow("rg-1", "wf-1");
      expect(wf.name).toBe("wf-1");
    });
  });

  describe("listRuns", () => {
    it("lists workflow runs", async () => {
      mockWorkflowRuns.list.mockReturnValue(asyncIter([
        { id: "r-id", name: "run-1", properties: { status: "Succeeded", startTime: new Date(), endTime: new Date(), trigger: { name: "manual" } } },
      ]));
      const runs = await mgr.listRuns("rg-1", "wf-1");
      expect(runs).toHaveLength(1);
    });
  });

  describe("listTriggers", () => {
    it("lists workflow triggers", async () => {
      mockWorkflowTriggers.list.mockReturnValue(asyncIter([
        { id: "t-id", name: "manual", properties: { state: "Enabled", provisioningState: "Succeeded", createdTime: new Date() } },
      ]));
      const triggers = await mgr.listTriggers("rg-1", "wf-1");
      expect(triggers).toHaveLength(1);
    });
  });

  describe("enableWorkflow", () => {
    it("enables a workflow", async () => {
      mockWorkflows.enable.mockResolvedValue(undefined);
      await expect(mgr.enableWorkflow("rg-1", "wf-1")).resolves.toBeUndefined();
      expect(mockWorkflows.enable).toHaveBeenCalledWith("rg-1", "wf-1");
    });
  });

  describe("disableWorkflow", () => {
    it("disables a workflow", async () => {
      mockWorkflows.disable.mockResolvedValue(undefined);
      await expect(mgr.disableWorkflow("rg-1", "wf-1")).resolves.toBeUndefined();
    });
  });

  describe("createWorkflow", () => {
    it("creates a Logic App workflow", async () => {
      mockWorkflows.createOrUpdate.mockResolvedValue({
        id: "wf-id", name: "new-wf", location: "eastus",
        state: "Enabled", provisioningState: "Succeeded",
        createdTime: new Date(), changedTime: new Date(),
      });
      const wf = await mgr.createWorkflow({
        name: "new-wf", resourceGroup: "rg-1", location: "eastus",
      });
      expect(wf.name).toBe("new-wf");
      expect(wf.state).toBe("Enabled");
    });
  });

  describe("deleteWorkflow", () => {
    it("deletes a workflow", async () => {
      mockWorkflows.delete.mockResolvedValue(undefined);
      await expect(mgr.deleteWorkflow("rg-1", "wf-1")).resolves.toBeUndefined();
    });
  });

  describe("runTrigger", () => {
    it("runs a workflow trigger", async () => {
      mockWorkflowTriggers.run.mockResolvedValue(undefined);
      await expect(mgr.runTrigger("rg-1", "wf-1", "manual")).resolves.toBeUndefined();
      expect(mockWorkflowTriggers.run).toHaveBeenCalledWith("rg-1", "wf-1", "manual");
    });
  });
});
