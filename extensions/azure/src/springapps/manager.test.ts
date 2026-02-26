import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureSpringAppsManager } from "./manager.js";

/** Helper to create an async iterable from an array. */
function asyncIter<T>(items: T[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const i of items) yield i;
    },
  };
}

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: {} }),
  clearCache: vi.fn(),
} as any;

describe("AzureSpringAppsManager", () => {
  let manager: AzureSpringAppsManager;

  const mockServices = {
    list: vi.fn(),
    listBySubscription: vi.fn(),
    get: vi.fn(),
    beginDeleteAndWait: vi.fn(),
  };

  const mockApps = {
    list: vi.fn(),
    get: vi.fn(),
  };

  const mockDeployments = {
    list: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureSpringAppsManager(mockCredentialsManager, "sub-123", {
      maxAttempts: 1,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      services: mockServices,
      apps: mockApps,
      deployments: mockDeployments,
    });
  });

  // ---------------------------------------------------------------------------
  // Services
  // ---------------------------------------------------------------------------

  describe("listServices", () => {
    it("lists all services across the subscription", async () => {
      mockServices.listBySubscription.mockReturnValue(
        asyncIter([
          { id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.AppPlatform/Spring/svc1", name: "svc1", location: "eastus" },
          { id: "/subscriptions/sub/resourceGroups/rg2/providers/Microsoft.AppPlatform/Spring/svc2", name: "svc2", location: "westus" },
        ]),
      );

      const result = await manager.listServices();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("svc1");
      expect(result[1].name).toBe("svc2");
      expect(mockServices.listBySubscription).toHaveBeenCalled();
    });

    it("filters by resource group when provided", async () => {
      mockServices.list.mockReturnValue(
        asyncIter([{ id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.AppPlatform/Spring/svc1", name: "svc1", location: "eastus" }]),
      );

      const result = await manager.listServices("rg1");
      expect(result).toHaveLength(1);
      expect(mockServices.list).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getService", () => {
    it("returns a service by name", async () => {
      mockServices.get.mockResolvedValue({
        id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.AppPlatform/Spring/svc1",
        name: "svc1",
        location: "eastus",
        properties: { provisioningState: "Succeeded", fqdn: "svc1.azuremicroservices.io" },
        sku: { name: "S0", tier: "Standard" },
      });

      const result = await manager.getService("rg1", "svc1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("svc1");
      expect(result!.provisioningState).toBe("Succeeded");
      expect(result!.fqdn).toBe("svc1.azuremicroservices.io");
    });

    it("returns null for 404", async () => {
      mockServices.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getService("rg1", "nonexistent");
      expect(result).toBeNull();
    });

    it("propagates non-404 errors", async () => {
      mockServices.get.mockRejectedValue(new Error("Server error"));
      await expect(manager.getService("rg1", "svc1")).rejects.toThrow("Server error");
    });
  });

  describe("deleteService", () => {
    it("deletes a service", async () => {
      mockServices.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(manager.deleteService("rg1", "svc1")).resolves.toBeUndefined();
      expect(mockServices.beginDeleteAndWait).toHaveBeenCalledWith("rg1", "svc1");
    });
  });

  // ---------------------------------------------------------------------------
  // Apps
  // ---------------------------------------------------------------------------

  describe("listApps", () => {
    it("lists apps in a Spring service", async () => {
      mockApps.list.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/svc1/apps/app1", name: "app1", properties: { provisioningState: "Succeeded", url: "https://app1.azuremicroservices.io" } },
          { id: "/sub/rg/svc1/apps/app2", name: "app2", properties: { provisioningState: "Succeeded" } },
        ]),
      );

      const result = await manager.listApps("rg1", "svc1");
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("app1");
      expect(mockApps.list).toHaveBeenCalledWith("rg1", "svc1");
    });
  });

  describe("getApp", () => {
    it("returns an app by name", async () => {
      mockApps.get.mockResolvedValue({
        id: "/sub/rg/svc1/apps/app1",
        name: "app1",
        properties: { provisioningState: "Succeeded", url: "https://app1.azuremicroservices.io", httpsOnly: true },
      });

      const result = await manager.getApp("rg1", "svc1", "app1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("app1");
      expect(result!.httpsOnly).toBe(true);
    });

    it("returns null for 404", async () => {
      mockApps.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getApp("rg1", "svc1", "missing");
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Deployments
  // ---------------------------------------------------------------------------

  describe("listDeployments", () => {
    it("lists deployments for an app", async () => {
      mockDeployments.list.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/svc1/apps/app1/deployments/default", name: "default", properties: { status: "Running", active: true } },
        ]),
      );

      const result = await manager.listDeployments("rg1", "svc1", "app1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("default");
      expect(mockDeployments.list).toHaveBeenCalledWith("rg1", "svc1", "app1");
    });
  });
});
