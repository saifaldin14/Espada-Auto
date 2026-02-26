import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzurePurviewManager } from "./manager.js";

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

describe("AzurePurviewManager", () => {
  let manager: AzurePurviewManager;

  const mockAccounts = {
    listBySubscription: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
    beginDeleteAndWait: vi.fn(),
  };

  const mockPrivateEndpointConnections = {
    listByAccount: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzurePurviewManager(mockCredentialsManager, "sub-123", {
      maxAttempts: 1,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      accounts: mockAccounts,
      privateEndpointConnections: mockPrivateEndpointConnections,
    });
  });

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  describe("listAccounts", () => {
    it("lists all Purview accounts across the subscription", async () => {
      mockAccounts.listBySubscription.mockReturnValue(
        asyncIter([
          { id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Purview/accounts/pv1", name: "pv1", location: "eastus" },
          { id: "/subscriptions/sub/resourceGroups/rg2/providers/Microsoft.Purview/accounts/pv2", name: "pv2", location: "westus" },
        ]),
      );

      const result = await manager.listAccounts();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("pv1");
      expect(result[1].name).toBe("pv2");
      expect(mockAccounts.listBySubscription).toHaveBeenCalled();
    });

    it("filters by resource group when provided", async () => {
      mockAccounts.listByResourceGroup.mockReturnValue(
        asyncIter([{ id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Purview/accounts/pv1", name: "pv1", location: "eastus" }]),
      );

      const result = await manager.listAccounts("rg1");
      expect(result).toHaveLength(1);
      expect(mockAccounts.listByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getAccount", () => {
    it("returns an account by name", async () => {
      mockAccounts.get.mockResolvedValue({
        id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Purview/accounts/pv1",
        name: "pv1",
        location: "eastus",
        properties: {
          provisioningState: "Succeeded",
          friendlyName: "My Purview",
          publicNetworkAccess: "Enabled",
          endpoints: { catalog: "https://pv1.purview.azure.com/catalog" },
        },
      });

      const result = await manager.getAccount("rg1", "pv1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("pv1");
      expect(result!.friendlyName).toBe("My Purview");
    });

    it("returns null for 404", async () => {
      mockAccounts.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getAccount("rg1", "nonexistent");
      expect(result).toBeNull();
    });

    it("propagates non-404 errors", async () => {
      mockAccounts.get.mockRejectedValue(new Error("Server error"));
      await expect(manager.getAccount("rg1", "pv1")).rejects.toThrow("Server error");
    });
  });

  describe("deleteAccount", () => {
    it("deletes an account", async () => {
      mockAccounts.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(manager.deleteAccount("rg1", "pv1")).resolves.toBeUndefined();
      expect(mockAccounts.beginDeleteAndWait).toHaveBeenCalledWith("rg1", "pv1");
    });
  });

  // ---------------------------------------------------------------------------
  // Private Endpoints
  // ---------------------------------------------------------------------------

  describe("listPrivateEndpoints", () => {
    it("lists private endpoint connections for an account", async () => {
      mockPrivateEndpointConnections.listByAccount.mockReturnValue(
        asyncIter([
          {
            id: "/sub/rg/pv1/privateEndpointConnections/pe1",
            name: "pe1",
            properties: {
              privateEndpoint: { id: "/sub/rg/pe/pe1" },
              privateLinkServiceConnectionState: { status: "Approved" },
              provisioningState: "Succeeded",
            },
          },
        ]),
      );

      const result = await manager.listPrivateEndpoints("rg1", "pv1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("pe1");
      expect(mockPrivateEndpointConnections.listByAccount).toHaveBeenCalledWith("rg1", "pv1");
    });
  });
});
