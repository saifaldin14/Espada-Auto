/**
 * Azure Web App Manager — Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureWebAppManager } from "./manager.js";

function asyncIter<T>(items: T[]) {
  return { [Symbol.asyncIterator]: async function* () { for (const i of items) yield i; } };
}

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: {} }),
  clearCache: vi.fn(),
} as any;

describe("AzureWebAppManager", () => {
  let manager: AzureWebAppManager;

  const mockWebApps = {
    list: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    delete: vi.fn(),
    getConfiguration: vi.fn(),
    updateConfiguration: vi.fn(),
    listSlots: vi.fn(),
    beginSwapSlotAndWait: vi.fn(),
    beginCreateOrUpdateSlotAndWait: vi.fn(),
    deleteSlot: vi.fn(),
  };

  const mockAppServicePlans = {
    list: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureWebAppManager(mockCredentialsManager, "sub-123", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      webApps: mockWebApps,
      appServicePlans: mockAppServicePlans,
    });
  });

  describe("listWebApps", () => {
    it("should list web apps excluding function apps", async () => {
      mockWebApps.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Web/sites/webapp1", name: "webapp1", location: "eastus", state: "Running", kind: "app", defaultHostName: "webapp1.azurewebsites.net", httpsOnly: true, enabled: true, tags: {} },
        { id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Web/sites/func1", name: "func1", location: "eastus", state: "Running", kind: "functionapp", defaultHostName: "func1.azurewebsites.net", httpsOnly: false, enabled: true, tags: {} },
        { id: "/subscriptions/sub-123/resourceGroups/rg2/providers/Microsoft.Web/sites/webapp2", name: "webapp2", location: "westus", state: "Stopped", kind: "app,linux", defaultHostName: "webapp2.azurewebsites.net", httpsOnly: false, enabled: false, tags: {} },
      ]));

      const apps = await manager.listWebApps();

      expect(apps).toHaveLength(2);
      expect(apps[0].name).toBe("webapp1");
      expect(apps[0].state).toBe("Running");
      expect(apps[0].resourceGroup).toBe("rg1");
      expect(apps[1].name).toBe("webapp2");
      expect(apps[1].state).toBe("Stopped");
    });

    it("should filter by resource group", async () => {
      mockWebApps.listByResourceGroup.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Web/sites/webapp1", name: "webapp1", location: "eastus", state: "Running", kind: "app", defaultHostName: "webapp1.azurewebsites.net", httpsOnly: true, enabled: true },
      ]));

      const apps = await manager.listWebApps("rg1");
      expect(apps).toHaveLength(1);
      expect(mockWebApps.listByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getWebApp", () => {
    it("should return a web app", async () => {
      mockWebApps.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Web/sites/webapp1",
        name: "webapp1", location: "eastus", state: "Running", kind: "app",
        defaultHostName: "webapp1.azurewebsites.net", httpsOnly: true, enabled: true,
      });

      const app = await manager.getWebApp("rg1", "webapp1");
      expect(app).not.toBeNull();
      expect(app!.name).toBe("webapp1");
    });

    it("should return null for function apps", async () => {
      mockWebApps.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Web/sites/func1",
        name: "func1", location: "eastus", state: "Running", kind: "functionapp",
        defaultHostName: "func1.azurewebsites.net", httpsOnly: false, enabled: true,
      });

      const app = await manager.getWebApp("rg1", "func1");
      expect(app).toBeNull();
    });

    it("should return null for 404", async () => {
      mockWebApps.get.mockRejectedValue({ statusCode: 404 });
      const app = await manager.getWebApp("rg1", "nonexistent");
      expect(app).toBeNull();
    });
  });

  describe("web app lifecycle operations", () => {
    it("should start a web app", async () => {
      mockWebApps.start.mockResolvedValue(undefined);
      await expect(manager.startWebApp("rg1", "webapp1")).resolves.toBeUndefined();
      expect(mockWebApps.start).toHaveBeenCalledWith("rg1", "webapp1");
    });

    it("should stop a web app", async () => {
      mockWebApps.stop.mockResolvedValue(undefined);
      await expect(manager.stopWebApp("rg1", "webapp1")).resolves.toBeUndefined();
      expect(mockWebApps.stop).toHaveBeenCalledWith("rg1", "webapp1");
    });

    it("should restart a web app", async () => {
      mockWebApps.restart.mockResolvedValue(undefined);
      await expect(manager.restartWebApp("rg1", "webapp1")).resolves.toBeUndefined();
      expect(mockWebApps.restart).toHaveBeenCalledWith("rg1", "webapp1");
    });

    it("should delete a web app", async () => {
      mockWebApps.delete.mockResolvedValue(undefined);
      await expect(manager.deleteWebApp("rg1", "webapp1")).resolves.toBeUndefined();
      expect(mockWebApps.delete).toHaveBeenCalledWith("rg1", "webapp1");
    });
  });

  describe("getWebAppConfig", () => {
    it("should return configuration details", async () => {
      mockWebApps.getConfiguration.mockResolvedValue({
        linuxFxVersion: "NODE|18-lts",
        alwaysOn: true,
        ftpsState: "Disabled",
        http20Enabled: true,
        minTlsVersion: "1.2",
        numberOfWorkers: 2,
      });

      const config = await manager.getWebAppConfig("rg1", "webapp1");
      expect(config).not.toBeNull();
      expect(config!.linuxFxVersion).toBe("NODE|18-lts");
      expect(config!.alwaysOn).toBe(true);
    });

    it("should return null for 404", async () => {
      mockWebApps.getConfiguration.mockRejectedValue({ statusCode: 404 });
      const config = await manager.getWebAppConfig("rg1", "nonexistent");
      expect(config).toBeNull();
    });
  });

  describe("listAppServicePlans", () => {
    it("should list App Service Plans", async () => {
      mockAppServicePlans.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Web/serverfarms/plan1", name: "plan1", location: "eastus", kind: "linux", sku: { name: "B1", tier: "Basic", capacity: 1 }, numberOfSites: 2, reserved: true },
      ]));

      const plans = await manager.listAppServicePlans();
      expect(plans).toHaveLength(1);
      expect(plans[0].name).toBe("plan1");
      expect(plans[0].sku).toBe("B1");
      expect(plans[0].tier).toBe("Basic");
      expect(plans[0].numberOfSites).toBe(2);
    });
  });

  describe("getAppServicePlan", () => {
    it("should return an App Service Plan", async () => {
      mockAppServicePlans.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Web/serverfarms/plan1",
        name: "plan1", location: "eastus", kind: "linux",
        sku: { name: "P1v3", tier: "PremiumV3", capacity: 2 },
        numberOfSites: 3, provisioningState: "Succeeded", reserved: true,
      });

      const plan = await manager.getAppServicePlan("rg1", "plan1");
      expect(plan).not.toBeNull();
      expect(plan!.name).toBe("plan1");
      expect(plan!.sku).toBe("P1v3");
      expect(plan!.tier).toBe("PremiumV3");
      expect(plan!.capacity).toBe(2);
      expect(plan!.numberOfSites).toBe(3);
    });

    it("should return null for 404", async () => {
      mockAppServicePlans.get.mockRejectedValue({ statusCode: 404 });
      const plan = await manager.getAppServicePlan("rg1", "nonexistent");
      expect(plan).toBeNull();
    });
  });

  describe("listDeploymentSlots", () => {
    it("should list deployment slots", async () => {
      mockWebApps.listSlots.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Web/sites/webapp1/slots/staging", name: "webapp1/staging", location: "eastus", state: "Running", defaultHostName: "webapp1-staging.azurewebsites.net" },
      ]));

      const slots = await manager.listDeploymentSlots("rg1", "webapp1");
      expect(slots).toHaveLength(1);
      expect(slots[0].name).toBe("webapp1/staging");
      expect(slots[0].state).toBe("Running");
    });
  });

  describe("swapSlots", () => {
    it("should swap deployment slots", async () => {
      mockWebApps.beginSwapSlotAndWait.mockResolvedValue(undefined);
      await expect(manager.swapSlots("rg1", "webapp1", "staging", "production")).resolves.toBeUndefined();
      expect(mockWebApps.beginSwapSlotAndWait).toHaveBeenCalledWith(
        "rg1", "webapp1", "staging", { targetSlot: "production", preserveVnet: true },
      );
    });
  });

  describe("createDeploymentSlot", () => {
    it("should create a deployment slot", async () => {
      mockWebApps.get.mockResolvedValue({ location: "eastus" });
      mockWebApps.beginCreateOrUpdateSlotAndWait.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Web/sites/webapp1/slots/staging",
        name: "webapp1/staging",
        location: "eastus",
        state: "Running",
        defaultHostName: "webapp1-staging.azurewebsites.net",
        tags: { env: "staging" },
      });

      const slot = await manager.createDeploymentSlot("rg1", "webapp1", {
        slotName: "staging",
        tags: { env: "staging" },
      });

      expect(slot.name).toBe("webapp1/staging");
      expect(slot.state).toBe("Running");
      expect(slot.defaultHostName).toBe("webapp1-staging.azurewebsites.net");
      expect(mockWebApps.beginCreateOrUpdateSlotAndWait).toHaveBeenCalledWith(
        "rg1", "webapp1", "staging",
        expect.objectContaining({ location: "eastus", tags: { env: "staging" } }),
      );
    });

    it("should clone config when configurationSource is specified", async () => {
      mockWebApps.get.mockResolvedValue({ location: "eastus" });
      mockWebApps.beginCreateOrUpdateSlotAndWait.mockResolvedValue({
        id: "slot-id", name: "webapp1/canary", location: "eastus",
        state: "Running", defaultHostName: "webapp1-canary.azurewebsites.net",
      });

      await manager.createDeploymentSlot("rg1", "webapp1", {
        slotName: "canary",
        configurationSource: "staging",
      });

      // First call creates the slot, second call clones config
      expect(mockWebApps.beginCreateOrUpdateSlotAndWait).toHaveBeenCalledTimes(2);
      expect(mockWebApps.beginCreateOrUpdateSlotAndWait).toHaveBeenLastCalledWith(
        "rg1", "webapp1", "canary",
        expect.objectContaining({
          cloningInfo: {
            sourceWebAppId: expect.stringContaining("/slots/staging"),
          },
        }),
      );
    });
  });

  describe("deleteDeploymentSlot", () => {
    it("should delete a deployment slot", async () => {
      mockWebApps.deleteSlot.mockResolvedValue(undefined);
      await expect(manager.deleteDeploymentSlot("rg1", "webapp1", "staging")).resolves.toBeUndefined();
      expect(mockWebApps.deleteSlot).toHaveBeenCalledWith("rg1", "webapp1", "staging");
    });
  });

  describe("setSlotTrafficPercentage", () => {
    it("should update traffic routing rules", async () => {
      mockWebApps.getConfiguration.mockResolvedValue({ linuxFxVersion: "NODE|18" });
      mockWebApps.updateConfiguration.mockResolvedValue(undefined);

      await manager.setSlotTrafficPercentage("rg1", "webapp1", {
        routingRules: [
          { slotName: "staging", reroutePercentage: 20 },
          { slotName: "canary", reroutePercentage: 5 },
        ],
      });

      expect(mockWebApps.updateConfiguration).toHaveBeenCalledWith(
        "rg1", "webapp1",
        expect.objectContaining({
          experiments: {
            rampUpRules: [
              { name: "staging", actionHostName: "webapp1-staging.azurewebsites.net", reroutePercentage: 20 },
              { name: "canary", actionHostName: "webapp1-canary.azurewebsites.net", reroutePercentage: 5 },
            ],
          },
        }),
      );
    });
  });

  describe("getSlotTrafficPercentage", () => {
    it("should return current routing rules", async () => {
      mockWebApps.getConfiguration.mockResolvedValue({
        experiments: {
          rampUpRules: [
            { name: "staging", reroutePercentage: 30 },
          ],
        },
      });

      const config = await manager.getSlotTrafficPercentage("rg1", "webapp1");
      expect(config.routingRules).toHaveLength(1);
      expect(config.routingRules[0].slotName).toBe("staging");
      expect(config.routingRules[0].reroutePercentage).toBe(30);
    });

    it("should return empty rules when none configured", async () => {
      mockWebApps.getConfiguration.mockResolvedValue({});
      const config = await manager.getSlotTrafficPercentage("rg1", "webapp1");
      expect(config.routingRules).toEqual([]);
    });
  });

  describe("error propagation", () => {
    it("should rethrow non-404 errors from getWebApp", async () => {
      mockWebApps.get.mockRejectedValue({ statusCode: 403, message: "Forbidden" });
      await expect(manager.getWebApp("rg1", "webapp1")).rejects.toEqual({ statusCode: 403, message: "Forbidden" });
    });
  });
});
