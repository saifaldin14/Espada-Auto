import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureSignalRManager } from "./manager.js";

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

describe("AzureSignalRManager", () => {
  let manager: AzureSignalRManager;

  const mockSignalR = {
    listBySubscription: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
    beginDeleteAndWait: vi.fn(),
    beginRestartAndWait: vi.fn(),
  };

  const mockCustomDomains = {
    list: vi.fn(),
  };

  const mockPrivateEndpoints = {
    list: vi.fn(),
  };

  const mockUsages = {
    list: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureSignalRManager(mockCredentialsManager, "sub-123", {
      maxAttempts: 1,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      signalR: mockSignalR,
      signalRCustomDomains: mockCustomDomains,
      signalRPrivateEndpointConnections: mockPrivateEndpoints,
      usages: mockUsages,
    });
  });

  // ---------------------------------------------------------------------------
  // SignalR Resources
  // ---------------------------------------------------------------------------

  describe("listSignalRResources", () => {
    it("lists all resources across the subscription", async () => {
      mockSignalR.listBySubscription.mockReturnValue(
        asyncIter([
          { id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.SignalRService/SignalR/sr1", name: "sr1", location: "eastus", sku: { name: "Standard_S1" } },
          { id: "/subscriptions/sub/resourceGroups/rg2/providers/Microsoft.SignalRService/SignalR/sr2", name: "sr2", location: "westus" },
        ]),
      );

      const result = await manager.listSignalRResources();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("sr1");
      expect(result[0].skuName).toBe("Standard_S1");
    });

    it("filters by resource group", async () => {
      mockSignalR.listByResourceGroup.mockReturnValue(
        asyncIter([
          { id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.SignalRService/SignalR/sr1", name: "sr1", location: "eastus" },
        ]),
      );

      const result = await manager.listSignalRResources("rg1");
      expect(result).toHaveLength(1);
      expect(mockSignalR.listByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getSignalRResource", () => {
    it("returns a resource by name", async () => {
      mockSignalR.get.mockResolvedValue({
        id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.SignalRService/SignalR/sr1",
        name: "sr1",
        location: "eastus",
        provisioningState: "Succeeded",
        hostName: "sr1.service.signalr.net",
      });

      const result = await manager.getSignalRResource("rg1", "sr1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("sr1");
      expect(result!.hostName).toBe("sr1.service.signalr.net");
    });

    it("returns null for 404", async () => {
      mockSignalR.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getSignalRResource("rg1", "missing");
      expect(result).toBeNull();
    });

    it("propagates non-404 errors", async () => {
      mockSignalR.get.mockRejectedValue(new Error("Server error"));
      await expect(manager.getSignalRResource("rg1", "sr1")).rejects.toThrow("Server error");
    });
  });

  describe("deleteSignalRResource", () => {
    it("deletes a resource", async () => {
      mockSignalR.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(manager.deleteSignalRResource("rg1", "sr1")).resolves.toBeUndefined();
      expect(mockSignalR.beginDeleteAndWait).toHaveBeenCalledWith("rg1", "sr1");
    });
  });

  describe("restartSignalRResource", () => {
    it("restarts a resource", async () => {
      mockSignalR.beginRestartAndWait.mockResolvedValue(undefined);
      await expect(manager.restartSignalRResource("rg1", "sr1")).resolves.toBeUndefined();
      expect(mockSignalR.beginRestartAndWait).toHaveBeenCalledWith("rg1", "sr1");
    });
  });

  // ---------------------------------------------------------------------------
  // Custom Domains
  // ---------------------------------------------------------------------------

  describe("listCustomDomains", () => {
    it("lists custom domains", async () => {
      mockCustomDomains.list.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/sr/customDomains/d1", name: "d1", properties: { domainName: "example.com", provisioningState: "Succeeded" } },
        ]),
      );

      const result = await manager.listCustomDomains("rg1", "sr1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("d1");
      expect(mockCustomDomains.list).toHaveBeenCalledWith("rg1", "sr1");
    });
  });

  // ---------------------------------------------------------------------------
  // Private Endpoint Connections
  // ---------------------------------------------------------------------------

  describe("listPrivateEndpointConnections", () => {
    it("lists private endpoint connections", async () => {
      mockPrivateEndpoints.list.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/sr/pe/pe1", name: "pe1", properties: { provisioningState: "Succeeded" } },
        ]),
      );

      const result = await manager.listPrivateEndpointConnections("rg1", "sr1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("pe1");
    });
  });

  // ---------------------------------------------------------------------------
  // Usages
  // ---------------------------------------------------------------------------

  describe("listUsages", () => {
    it("lists usages for a location", async () => {
      mockUsages.list.mockReturnValue(
        asyncIter([
          { currentValue: 5, limit: 100, name: { value: "FreeTierInstances" }, unit: "Count" },
        ]),
      );

      const result = await manager.listUsages("eastus");
      expect(result).toHaveLength(1);
      expect(result[0].currentValue).toBe(5);
      expect(result[0].limit).toBe(100);
      expect(mockUsages.list).toHaveBeenCalledWith("eastus");
    });
  });
});
