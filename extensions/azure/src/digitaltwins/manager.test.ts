import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureDigitalTwinsManager } from "./manager.js";

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

describe("AzureDigitalTwinsManager", () => {
  let manager: AzureDigitalTwinsManager;

  const mockDigitalTwins = {
    list: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
    beginDeleteAndWait: vi.fn(),
  };

  const mockDigitalTwinsEndpoint = {
    list: vi.fn(),
  };

  const mockPrivateEndpointConnections = {
    list: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureDigitalTwinsManager(mockCredentialsManager, "sub-123", {
      maxAttempts: 1,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      digitalTwins: mockDigitalTwins,
      digitalTwinsEndpoint: mockDigitalTwinsEndpoint,
      privateEndpointConnections: mockPrivateEndpointConnections,
    });
  });

  // ---------------------------------------------------------------------------
  // Instances
  // ---------------------------------------------------------------------------

  describe("listInstances", () => {
    it("lists all Digital Twins instances across the subscription", async () => {
      mockDigitalTwins.list.mockReturnValue(
        asyncIter([
          { id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.DigitalTwins/digitalTwinsInstances/dt1", name: "dt1", location: "eastus" },
          { id: "/subscriptions/sub/resourceGroups/rg2/providers/Microsoft.DigitalTwins/digitalTwinsInstances/dt2", name: "dt2", location: "westus" },
        ]),
      );

      const result = await manager.listInstances();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("dt1");
      expect(result[1].name).toBe("dt2");
      expect(mockDigitalTwins.list).toHaveBeenCalled();
    });

    it("filters by resource group when provided", async () => {
      mockDigitalTwins.listByResourceGroup.mockReturnValue(
        asyncIter([{ id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.DigitalTwins/digitalTwinsInstances/dt1", name: "dt1", location: "eastus" }]),
      );

      const result = await manager.listInstances("rg1");
      expect(result).toHaveLength(1);
      expect(mockDigitalTwins.listByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getInstance", () => {
    it("returns an instance by name", async () => {
      mockDigitalTwins.get.mockResolvedValue({
        id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.DigitalTwins/digitalTwinsInstances/dt1",
        name: "dt1",
        location: "eastus",
        provisioningState: "Succeeded",
        hostName: "dt1.api.eus.digitaltwins.azure.net",
        publicNetworkAccess: "Enabled",
      });

      const result = await manager.getInstance("rg1", "dt1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("dt1");
      expect(result!.hostName).toBe("dt1.api.eus.digitaltwins.azure.net");
    });

    it("returns null for 404", async () => {
      mockDigitalTwins.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getInstance("rg1", "nonexistent");
      expect(result).toBeNull();
    });

    it("propagates non-404 errors", async () => {
      mockDigitalTwins.get.mockRejectedValue(new Error("Server error"));
      await expect(manager.getInstance("rg1", "dt1")).rejects.toThrow("Server error");
    });
  });

  describe("deleteInstance", () => {
    it("deletes an instance", async () => {
      mockDigitalTwins.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(manager.deleteInstance("rg1", "dt1")).resolves.toBeUndefined();
      expect(mockDigitalTwins.beginDeleteAndWait).toHaveBeenCalledWith("rg1", "dt1");
    });
  });

  // ---------------------------------------------------------------------------
  // Endpoints
  // ---------------------------------------------------------------------------

  describe("listEndpoints", () => {
    it("lists endpoints for a Digital Twins instance", async () => {
      mockDigitalTwinsEndpoint.list.mockReturnValue(
        asyncIter([
          {
            id: "/sub/rg/dt1/endpoints/ep1",
            name: "ep1",
            properties: { endpointType: "EventHub", provisioningState: "Succeeded", authenticationType: "KeyBased" },
          },
        ]),
      );

      const result = await manager.listEndpoints("rg1", "dt1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("ep1");
      expect(result[0].endpointType).toBe("EventHub");
      expect(mockDigitalTwinsEndpoint.list).toHaveBeenCalledWith("rg1", "dt1");
    });
  });

  // ---------------------------------------------------------------------------
  // Private Endpoint Connections
  // ---------------------------------------------------------------------------

  describe("listPrivateEndpoints", () => {
    it("lists private endpoint connections for an instance", async () => {
      mockPrivateEndpointConnections.list.mockResolvedValue({
        value: [
          {
            id: "/sub/rg/dt1/privateEndpointConnections/pe1",
            name: "pe1",
            properties: {
              privateEndpoint: { id: "/sub/rg/pe/pe1" },
              privateLinkServiceConnectionState: { status: "Approved" },
              provisioningState: "Succeeded",
              groupIds: ["API"],
            },
          },
        ],
      });

      const result = await manager.listPrivateEndpoints("rg1", "dt1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("pe1");
      expect(result[0].connectionState).toBe("Approved");
      expect(mockPrivateEndpointConnections.list).toHaveBeenCalledWith("rg1", "dt1");
    });

    it("returns empty array when no private endpoints", async () => {
      mockPrivateEndpointConnections.list.mockResolvedValue({});
      const result = await manager.listPrivateEndpoints("rg1", "dt1");
      expect(result).toHaveLength(0);
    });
  });
});
