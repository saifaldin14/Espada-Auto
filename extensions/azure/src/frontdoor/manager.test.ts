/**
 * Azure Front Door Manager — Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureFrontDoorManager } from "./manager.js";

function asyncIter<T>(items: T[]) {
  return { [Symbol.asyncIterator]: async function* () { for (const i of items) yield i; } };
}

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: {} }),
  clearCache: vi.fn(),
} as any;

describe("AzureFrontDoorManager", () => {
  let manager: AzureFrontDoorManager;

  const mockProfiles = {
    list: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
    beginDeleteAndWait: vi.fn(),
  };

  // Note: profiles.listByResourceGroup is used for resource-group-filtered listing
  // (afdProfiles doesn't have listByResourceGroup in the SDK)

  const mockAfdEndpoints = {
    listByProfile: vi.fn(),
  };

  const mockAfdOriginGroups = {
    listByProfile: vi.fn(),
  };

  const mockAfdOrigins = {
    listByOriginGroup: vi.fn(),
  };

  const mockRoutes = {
    listByEndpoint: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureFrontDoorManager(mockCredentialsManager, "sub-123", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      profiles: mockProfiles,
      afdEndpoints: mockAfdEndpoints,
      afdOriginGroups: mockAfdOriginGroups,
      afdOrigins: mockAfdOrigins,
      routes: mockRoutes,
    });
  });

  describe("listProfiles", () => {
    it("should list all AFD profiles (filtering by sku)", async () => {
      mockProfiles.list.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Cdn/profiles/fd1",
          name: "fd1", location: "global",
          sku: { name: "Standard_AzureFrontDoor" },
          provisioningState: "Succeeded", resourceState: "Active",
          tags: { env: "prod" },
        },
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Cdn/profiles/cdn1",
          name: "cdn1", location: "global",
          sku: { name: "Standard_Microsoft" },
          provisioningState: "Succeeded",
        },
      ]));

      const profiles = await manager.listProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe("fd1");
      expect(profiles[0].skuName).toBe("Standard_AzureFrontDoor");
    });

    it("should filter by resource group", async () => {
      mockProfiles.listByResourceGroup.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Cdn/profiles/fd1",
          name: "fd1", sku: { name: "Premium_AzureFrontDoor" },
        },
      ]));

      const profiles = await manager.listProfiles("rg1");
      expect(profiles).toHaveLength(1);
      expect(profiles[0].skuName).toBe("Premium_AzureFrontDoor");
      expect(mockProfiles.listByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getProfile", () => {
    it("should return a profile", async () => {
      mockProfiles.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Cdn/profiles/fd1",
        name: "fd1", location: "global",
        sku: { name: "Standard_AzureFrontDoor" },
        provisioningState: "Succeeded", resourceState: "Active",
        frontDoorId: "fd-abc123",
        originResponseTimeoutSeconds: 60,
      });

      const profile = await manager.getProfile("rg1", "fd1");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("fd1");
      expect(profile!.frontDoorId).toBe("fd-abc123");
      expect(profile!.originResponseTimeoutSeconds).toBe(60);
    });

    it("should return null for 404", async () => {
      mockProfiles.get.mockRejectedValue({ statusCode: 404 });
      const profile = await manager.getProfile("rg1", "missing");
      expect(profile).toBeNull();
    });

    it("should propagate non-404 errors", async () => {
      mockProfiles.get.mockRejectedValue(new Error("Internal server error"));
      await expect(manager.getProfile("rg1", "fd1")).rejects.toThrow("Internal server error");
    });
  });

  describe("deleteProfile", () => {
    it("should delete a profile", async () => {
      mockProfiles.beginDeleteAndWait.mockResolvedValue(undefined);
      await manager.deleteProfile("rg1", "fd1");
      expect(mockProfiles.beginDeleteAndWait).toHaveBeenCalledWith("rg1", "fd1");
    });

    it("should propagate delete errors", async () => {
      mockProfiles.beginDeleteAndWait.mockRejectedValue(new Error("Delete failed"));
      await expect(manager.deleteProfile("rg1", "fd1")).rejects.toThrow("Delete failed");
    });
  });

  describe("listEndpoints", () => {
    it("should list AFD endpoints", async () => {
      mockAfdEndpoints.listByProfile.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Cdn/profiles/fd1/afdEndpoints/ep1",
          name: "ep1", hostName: "ep1-abc.z01.azurefd.net",
          provisioningState: "Succeeded", deploymentStatus: "NotStarted",
          enabledState: "Enabled",
        },
      ]));

      const endpoints = await manager.listEndpoints("rg1", "fd1");
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].name).toBe("ep1");
      expect(endpoints[0].hostName).toBe("ep1-abc.z01.azurefd.net");
      expect(endpoints[0].enabledState).toBe("Enabled");
    });

    it("should return empty array when no endpoints", async () => {
      mockAfdEndpoints.listByProfile.mockReturnValue(asyncIter([]));
      const endpoints = await manager.listEndpoints("rg1", "fd1");
      expect(endpoints).toEqual([]);
    });
  });

  describe("listOriginGroups", () => {
    it("should list origin groups", async () => {
      mockAfdOriginGroups.listByProfile.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Cdn/profiles/fd1/originGroups/og1",
          name: "og1", provisioningState: "Succeeded", deploymentStatus: "NotStarted",
          healthProbeSettings: {
            probePath: "/health",
            probeRequestType: "HEAD",
            probeProtocol: "Https",
            probeIntervalInSeconds: 30,
          },
          sessionAffinityState: "Disabled",
        },
      ]));

      const groups = await manager.listOriginGroups("rg1", "fd1");
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe("og1");
      expect(groups[0].healthProbeSettings?.probePath).toBe("/health");
      expect(groups[0].sessionAffinityState).toBe("Disabled");
    });
  });

  describe("listOrigins", () => {
    it("should list origins in a group", async () => {
      mockAfdOrigins.listByOriginGroup.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Cdn/profiles/fd1/originGroups/og1/origins/origin1",
          name: "origin1", hostName: "backend.example.com",
          httpPort: 80, httpsPort: 443,
          originHostHeader: "backend.example.com",
          priority: 1, weight: 1000,
          enabledState: "Enabled",
          provisioningState: "Succeeded",
        },
      ]));

      const origins = await manager.listOrigins("rg1", "fd1", "og1");
      expect(origins).toHaveLength(1);
      expect(origins[0].name).toBe("origin1");
      expect(origins[0].hostName).toBe("backend.example.com");
      expect(origins[0].httpsPort).toBe(443);
      expect(origins[0].weight).toBe(1000);
      expect(mockAfdOrigins.listByOriginGroup).toHaveBeenCalledWith("rg1", "fd1", "og1");
    });
  });

  describe("listRoutes", () => {
    it("should list routes for an endpoint", async () => {
      mockRoutes.listByEndpoint.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Cdn/profiles/fd1/afdEndpoints/ep1/routes/route1",
          name: "route1",
          provisioningState: "Succeeded",
          enabledState: "Enabled",
          patternsToMatch: ["/*"],
          forwardingProtocol: "HttpsOnly",
          httpsRedirect: "Enabled",
          originGroup: { id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Cdn/profiles/fd1/originGroups/og1" },
        },
      ]));

      const routes = await manager.listRoutes("rg1", "fd1", "ep1");
      expect(routes).toHaveLength(1);
      expect(routes[0].name).toBe("route1");
      expect(routes[0].patternsToMatch).toEqual(["/*"]);
      expect(routes[0].forwardingProtocol).toBe("HttpsOnly");
      expect(routes[0].originGroupId).toContain("og1");
      expect(mockRoutes.listByEndpoint).toHaveBeenCalledWith("rg1", "fd1", "ep1");
    });

    it("should return empty array when no routes", async () => {
      mockRoutes.listByEndpoint.mockReturnValue(asyncIter([]));
      const routes = await manager.listRoutes("rg1", "fd1", "ep1");
      expect(routes).toEqual([]);
    });
  });
});
