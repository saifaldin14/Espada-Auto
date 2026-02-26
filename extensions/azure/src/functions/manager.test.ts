/**
 * Azure Functions Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureFunctionsManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockWebApps = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
  get: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  delete: vi.fn(),
  beginCreateOrUpdateAndWait: vi.fn(),
  listFunctions: vi.fn(),
  listApplicationSettings: vi.fn(),
  updateApplicationSettings: vi.fn(),
};

vi.mock("@azure/arm-appservice", () => ({
  WebSiteManagementClient: vi.fn().mockImplementation(function() { return {
    webApps: mockWebApps,
  }; }),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureFunctionsManager", () => {
  let mgr: AzureFunctionsManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureFunctionsManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listFunctionApps", () => {
    it("lists only function apps (filters by kind)", async () => {
      mockWebApps.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Web/sites/func-1", name: "func-1", location: "eastus", kind: "functionapp", properties: { state: "Running", defaultHostName: "func-1.azurewebsites.net" }, tags: {} },
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Web/sites/web-1", name: "web-1", location: "eastus", kind: "app", properties: { state: "Running" }, tags: {} },
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Web/sites/func-2", name: "func-2", location: "eastus", kind: "functionapp,linux", properties: { state: "Stopped" }, tags: {} },
      ]));
      const apps = await mgr.listFunctionApps();
      expect(apps).toHaveLength(2);
      expect(apps.every((a) => a.name.startsWith("func"))).toBe(true);
    });

    it("filters by resource group", async () => {
      mockWebApps.listByResourceGroup.mockReturnValue(asyncIter([
        { id: "id", name: "func-1", location: "eastus", kind: "functionapp", properties: { state: "Running" }, tags: {} },
      ]));
      const apps = await mgr.listFunctionApps("rg-1");
      expect(apps).toHaveLength(1);
      expect(mockWebApps.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("getFunctionApp", () => {
    it("returns function app", async () => {
      mockWebApps.get.mockResolvedValue({
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Web/sites/func-1",
        name: "func-1", location: "eastus", kind: "functionapp",
        properties: { state: "Running", defaultHostName: "func-1.azurewebsites.net" },
      });
      const app = await mgr.getFunctionApp("rg-1", "func-1");
      expect(app).not.toBeNull();
      expect(app!.name).toBe("func-1");
    });

    it("returns null on 404", async () => {
      mockWebApps.get.mockRejectedValue({ statusCode: 404 });
      expect(await mgr.getFunctionApp("rg-1", "gone")).toBeNull();
    });
  });

  describe("startFunctionApp", () => {
    it("starts an app", async () => {
      mockWebApps.start.mockResolvedValue(undefined);
      await expect(mgr.startFunctionApp("rg-1", "func-1")).resolves.toBeUndefined();
      expect(mockWebApps.start).toHaveBeenCalledWith("rg-1", "func-1");
    });
  });

  describe("stopFunctionApp", () => {
    it("stops an app", async () => {
      mockWebApps.stop.mockResolvedValue(undefined);
      await expect(mgr.stopFunctionApp("rg-1", "func-1")).resolves.toBeUndefined();
    });
  });

  describe("restartFunctionApp", () => {
    it("restarts an app", async () => {
      mockWebApps.restart.mockResolvedValue(undefined);
      await expect(mgr.restartFunctionApp("rg-1", "func-1")).resolves.toBeUndefined();
    });
  });

  describe("deleteFunctionApp", () => {
    it("deletes an app", async () => {
      mockWebApps.delete.mockResolvedValue(undefined);
      await expect(mgr.deleteFunctionApp("rg-1", "func-1")).resolves.toBeUndefined();
    });
  });

  describe("createFunctionApp", () => {
    it("creates a function app", async () => {
      mockWebApps.beginCreateOrUpdateAndWait.mockResolvedValue({
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Web/sites/new-func",
        name: "new-func", location: "eastus", kind: "functionapp",
        state: "Running", defaultHostName: "new-func.azurewebsites.net",
      });
      const app = await mgr.createFunctionApp({
        name: "new-func", resourceGroup: "rg-1", location: "eastus",
        runtime: "node", storageAccountConnectionString: "DefaultEndpointsProtocol=https;...",
      });
      expect(app.name).toBe("new-func");
    });
  });

  describe("listFunctions", () => {
    it("lists functions in an app", async () => {
      mockWebApps.listFunctions.mockReturnValue(asyncIter([
        { name: "HttpTrigger1" },
        { name: "TimerTrigger1" },
      ]));
      const fns = await mgr.listFunctions("rg-1", "func-1");
      expect(fns).toHaveLength(2);
      expect(fns[0]).toBe("HttpTrigger1");
    });
  });

  describe("getAppSettings", () => {
    it("returns app settings", async () => {
      mockWebApps.listApplicationSettings.mockResolvedValue({
        properties: { FUNCTIONS_WORKER_RUNTIME: "node", MY_KEY: "val" },
      });
      const settings = await mgr.getAppSettings("rg-1", "func-1");
      expect(settings.MY_KEY).toBe("val");
    });
  });

  describe("updateAppSettings", () => {
    it("merges and updates settings", async () => {
      mockWebApps.listApplicationSettings.mockResolvedValue({
        properties: { EXISTING: "old" },
      });
      mockWebApps.updateApplicationSettings.mockResolvedValue({
        properties: { EXISTING: "old", NEW_KEY: "new" },
      });
      const settings = await mgr.updateAppSettings("rg-1", "func-1", { NEW_KEY: "new" });
      expect(settings.NEW_KEY).toBe("new");
    });
  });
});
