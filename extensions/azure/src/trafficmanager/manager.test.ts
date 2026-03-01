/**
 * Azure Traffic Manager Manager — Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureTrafficManagerManager } from "./manager.js";

function asyncIter<T>(items: T[]) {
  return { [Symbol.asyncIterator]: async function* () { for (const i of items) yield i; } };
}

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: {} }),
  clearCache: vi.fn(),
} as any;

describe("AzureTrafficManagerManager", () => {
  let manager: AzureTrafficManagerManager;

  const mockProfiles = {
    listBySubscription: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    createOrUpdate: vi.fn(),
  };

  const mockEndpoints = {
    get: vi.fn(),
    delete: vi.fn(),
    createOrUpdate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureTrafficManagerManager(mockCredentialsManager, "sub-123", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      profiles: mockProfiles,
      endpoints: mockEndpoints,
    });
  });

  describe("listProfiles", () => {
    it("should list all profiles", async () => {
      mockProfiles.listBySubscription.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/trafficManagerProfiles/tm1",
          name: "tm1", location: "global",
          profileStatus: "Enabled", trafficRoutingMethod: "Performance",
          dnsConfig: { relativeName: "tm1", fqdn: "tm1.trafficmanager.net", ttl: 60 },
          monitorConfig: { profileMonitorStatus: "Online", protocol: "HTTPS", port: 443, path: "/health" },
          provisioningState: "Succeeded",
          tags: { env: "prod" },
        },
      ]));

      const profiles = await manager.listProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe("tm1");
      expect(profiles[0].trafficRoutingMethod).toBe("Performance");
      expect(profiles[0].dnsConfig?.fqdn).toBe("tm1.trafficmanager.net");
      expect(profiles[0].monitorConfig?.protocol).toBe("HTTPS");
    });

    it("should filter by resource group", async () => {
      mockProfiles.listByResourceGroup.mockReturnValue(asyncIter([]));
      const result = await manager.listProfiles("rg1");
      expect(result).toEqual([]);
      expect(mockProfiles.listByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getProfile", () => {
    it("should return a profile", async () => {
      mockProfiles.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/trafficManagerProfiles/tm1",
        name: "tm1", location: "global",
        profileStatus: "Enabled", trafficRoutingMethod: "Weighted",
      });

      const profile = await manager.getProfile("rg1", "tm1");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("tm1");
      expect(profile!.trafficRoutingMethod).toBe("Weighted");
      expect(mockProfiles.get).toHaveBeenCalledWith("rg1", "tm1");
    });

    it("should return null for 404", async () => {
      mockProfiles.get.mockRejectedValue({ statusCode: 404 });
      const profile = await manager.getProfile("rg1", "missing");
      expect(profile).toBeNull();
    });

    it("should propagate non-404 errors", async () => {
      mockProfiles.get.mockRejectedValue(new Error("Internal server error"));
      await expect(manager.getProfile("rg1", "tm1")).rejects.toThrow("Internal server error");
    });
  });

  describe("deleteProfile", () => {
    it("should delete a profile", async () => {
      mockProfiles.delete.mockResolvedValue(undefined);
      await manager.deleteProfile("rg1", "tm1");
      expect(mockProfiles.delete).toHaveBeenCalledWith("rg1", "tm1");
    });

    it("should propagate delete errors", async () => {
      mockProfiles.delete.mockRejectedValue(new Error("Delete failed"));
      await expect(manager.deleteProfile("rg1", "tm1")).rejects.toThrow("Delete failed");
    });
  });

  describe("listEndpoints", () => {
    it("should list endpoints from profile", async () => {
      mockProfiles.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/trafficManagerProfiles/tm1",
        name: "tm1",
        endpoints: [
          {
            id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/trafficManagerProfiles/tm1/ExternalEndpoints/ep1",
            name: "ep1", type: "Microsoft.Network/trafficManagerProfiles/ExternalEndpoints",
            endpointStatus: "Enabled", endpointMonitorStatus: "Online",
            target: "example.com", weight: 100, priority: 1,
            endpointLocation: "East US",
          },
        ],
      });

      const endpoints = await manager.listEndpoints("rg1", "tm1");
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].name).toBe("ep1");
      expect(endpoints[0].target).toBe("example.com");
      expect(endpoints[0].weight).toBe(100);
    });

    it("should return empty array when no endpoints", async () => {
      mockProfiles.get.mockResolvedValue({ id: "x", name: "tm1" });
      const endpoints = await manager.listEndpoints("rg1", "tm1");
      expect(endpoints).toEqual([]);
    });
  });

  describe("getEndpoint", () => {
    it("should return an endpoint", async () => {
      mockEndpoints.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/trafficManagerProfiles/tm1/ExternalEndpoints/ep1",
        name: "ep1", type: "ExternalEndpoints",
        endpointStatus: "Enabled", target: "example.com",
      });

      const ep = await manager.getEndpoint("rg1", "tm1", "ExternalEndpoints", "ep1");
      expect(ep).not.toBeNull();
      expect(ep!.name).toBe("ep1");
      expect(ep!.target).toBe("example.com");
    });

    it("should return null for 404", async () => {
      mockEndpoints.get.mockRejectedValue({ statusCode: 404 });
      const ep = await manager.getEndpoint("rg1", "tm1", "ExternalEndpoints", "missing");
      expect(ep).toBeNull();
    });

    it("should propagate non-404 errors", async () => {
      mockEndpoints.get.mockRejectedValue(new Error("Server error"));
      await expect(manager.getEndpoint("rg1", "tm1", "ExternalEndpoints", "ep1")).rejects.toThrow("Server error");
    });
  });

  describe("deleteEndpoint", () => {
    it("should delete an endpoint", async () => {
      mockEndpoints.delete.mockResolvedValue(undefined);
      await manager.deleteEndpoint("rg1", "tm1", "ExternalEndpoints", "ep1");
      expect(mockEndpoints.delete).toHaveBeenCalledWith("rg1", "tm1", "ExternalEndpoints", "ep1");
    });

    it("should propagate delete errors", async () => {
      mockEndpoints.delete.mockRejectedValue(new Error("Delete endpoint failed"));
      await expect(manager.deleteEndpoint("rg1", "tm1", "ExternalEndpoints", "ep1")).rejects.toThrow("Delete endpoint failed");
    });
  });

  describe("createProfile", () => {
    it("should create a traffic manager profile", async () => {
      mockProfiles.createOrUpdate.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/trafficManagerProfiles/tm-new",
        name: "tm-new",
        location: "global",
        profileStatus: "Enabled",
        trafficRoutingMethod: "Weighted",
        dnsConfig: { relativeName: "tm-new", fqdn: "tm-new.trafficmanager.net", ttl: 60 },
        monitorConfig: { protocol: "HTTPS", port: 443, path: "/health" },
        provisioningState: "Succeeded",
        tags: { env: "prod" },
      });

      const profile = await manager.createProfile({
        resourceGroup: "rg1",
        name: "tm-new",
        trafficRoutingMethod: "Weighted",
        relativeDnsName: "tm-new",
        ttl: 60,
        monitorProtocol: "HTTPS",
        monitorPort: 443,
        monitorPath: "/health",
        tags: { env: "prod" },
      });

      expect(profile.name).toBe("tm-new");
      expect(profile.trafficRoutingMethod).toBe("Weighted");
      expect(profile.dnsConfig?.fqdn).toBe("tm-new.trafficmanager.net");
      expect(mockProfiles.createOrUpdate).toHaveBeenCalledWith(
        "rg1", "tm-new",
        expect.objectContaining({
          location: "global",
          trafficRoutingMethod: "Weighted",
          dnsConfig: { relativeName: "tm-new", ttl: 60 },
          monitorConfig: { protocol: "HTTPS", port: 443, path: "/health" },
          tags: { env: "prod" },
        }),
      );
    });

    it("should use sensible defaults for monitor config", async () => {
      mockProfiles.createOrUpdate.mockResolvedValue({
        id: "id", name: "tm-default", location: "global",
        dnsConfig: { relativeName: "tm-default", ttl: 30 },
        monitorConfig: { protocol: "HTTPS", port: 443, path: "/" },
      });

      await manager.createProfile({
        resourceGroup: "rg1",
        name: "tm-default",
        trafficRoutingMethod: "Performance",
        relativeDnsName: "tm-default",
      });

      expect(mockProfiles.createOrUpdate).toHaveBeenCalledWith(
        "rg1", "tm-default",
        expect.objectContaining({
          dnsConfig: { relativeName: "tm-default", ttl: 30 },
          monitorConfig: { protocol: "HTTPS", port: 443, path: "/" },
        }),
      );
    });
  });

  describe("createOrUpdateEndpoint", () => {
    it("should create an endpoint", async () => {
      mockEndpoints.createOrUpdate.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/trafficManagerProfiles/tm1/ExternalEndpoints/ep-new",
        name: "ep-new",
        type: "Microsoft.Network/trafficManagerProfiles/ExternalEndpoints",
        endpointStatus: "Enabled",
        target: "app.example.com",
        weight: 50,
        priority: 1,
      });

      const ep = await manager.createOrUpdateEndpoint({
        resourceGroup: "rg1",
        profileName: "tm1",
        endpointType: "ExternalEndpoints",
        endpointName: "ep-new",
        target: "app.example.com",
        weight: 50,
        priority: 1,
      });

      expect(ep.name).toBe("ep-new");
      expect(ep.target).toBe("app.example.com");
      expect(ep.weight).toBe(50);
      expect(mockEndpoints.createOrUpdate).toHaveBeenCalledWith(
        "rg1", "tm1", "ExternalEndpoints", "ep-new",
        expect.objectContaining({
          target: "app.example.com",
          weight: 50,
          priority: 1,
          endpointStatus: "Enabled",
        }),
      );
    });
  });

  describe("updateEndpointWeight", () => {
    it("should update endpoint weight via GET then PUT", async () => {
      mockEndpoints.get.mockResolvedValue({
        id: "ep-id", name: "ep1", type: "ExternalEndpoints",
        endpointStatus: "Enabled", target: "app.example.com",
        weight: 100, priority: 1,
      });
      mockEndpoints.createOrUpdate.mockResolvedValue({
        id: "ep-id", name: "ep1", type: "ExternalEndpoints",
        endpointStatus: "Enabled", target: "app.example.com",
        weight: 25, priority: 1,
      });

      const ep = await manager.updateEndpointWeight({
        resourceGroup: "rg1",
        profileName: "tm1",
        endpointType: "ExternalEndpoints",
        endpointName: "ep1",
        weight: 25,
      });

      expect(ep.weight).toBe(25);
      expect(mockEndpoints.get).toHaveBeenCalledWith("rg1", "tm1", "ExternalEndpoints", "ep1");
      expect(mockEndpoints.createOrUpdate).toHaveBeenCalledWith(
        "rg1", "tm1", "ExternalEndpoints", "ep1",
        expect.objectContaining({ weight: 25 }),
      );
    });
  });
});
