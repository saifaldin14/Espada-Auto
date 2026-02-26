import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureMapsManager } from "./manager.js";

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

describe("AzureMapsManager", () => {
  let manager: AzureMapsManager;

  const mockAccounts = {
    listBySubscription: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  };

  const mockCreators = {
    listByAccount: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureMapsManager(mockCredentialsManager, "sub-123", {
      maxAttempts: 1,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      accounts: mockAccounts,
      creators: mockCreators,
    });
  });

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  describe("listAccounts", () => {
    it("lists all Maps accounts across the subscription", async () => {
      mockAccounts.listBySubscription.mockReturnValue(
        asyncIter([
          { id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Maps/accounts/map1", name: "map1", location: "eastus", sku: { name: "S1" }, kind: "Gen2" },
          { id: "/subscriptions/sub/resourceGroups/rg2/providers/Microsoft.Maps/accounts/map2", name: "map2", location: "westus", sku: { name: "S0" }, kind: "Gen1" },
        ]),
      );

      const result = await manager.listAccounts();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("map1");
      expect(result[1].name).toBe("map2");
      expect(mockAccounts.listBySubscription).toHaveBeenCalled();
    });

    it("filters by resource group when provided", async () => {
      mockAccounts.listByResourceGroup.mockReturnValue(
        asyncIter([{ id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Maps/accounts/map1", name: "map1", location: "eastus", sku: { name: "S1" } }]),
      );

      const result = await manager.listAccounts("rg1");
      expect(result).toHaveLength(1);
      expect(mockAccounts.listByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getAccount", () => {
    it("returns an account by name", async () => {
      mockAccounts.get.mockResolvedValue({
        id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Maps/accounts/map1",
        name: "map1",
        location: "eastus",
        sku: { name: "S1" },
        kind: "Gen2",
        properties: { uniqueId: "uid-123", disableLocalAuth: false },
      });

      const result = await manager.getAccount("rg1", "map1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("map1");
      expect(result!.skuName).toBe("S1");
      expect(result!.kind).toBe("Gen2");
    });

    it("returns null for 404", async () => {
      mockAccounts.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getAccount("rg1", "nonexistent");
      expect(result).toBeNull();
    });

    it("propagates non-404 errors", async () => {
      mockAccounts.get.mockRejectedValue(new Error("Server error"));
      await expect(manager.getAccount("rg1", "map1")).rejects.toThrow("Server error");
    });
  });

  describe("deleteAccount", () => {
    it("deletes an account", async () => {
      mockAccounts.delete.mockResolvedValue(undefined);
      await expect(manager.deleteAccount("rg1", "map1")).resolves.toBeUndefined();
      expect(mockAccounts.delete).toHaveBeenCalledWith("rg1", "map1");
    });
  });

  // ---------------------------------------------------------------------------
  // Creators
  // ---------------------------------------------------------------------------

  describe("listCreators", () => {
    it("lists creators for a Maps account", async () => {
      mockCreators.listByAccount.mockReturnValue(
        asyncIter([
          {
            id: "/sub/rg/map1/creators/creator1",
            name: "creator1",
            location: "eastus",
            properties: { storageUnits: 5, consumedStorageUnitPercentage: 20.5, provisioningState: "Succeeded" },
          },
        ]),
      );

      const result = await manager.listCreators("rg1", "map1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("creator1");
      expect(result[0].storageUnits).toBe(5);
      expect(mockCreators.listByAccount).toHaveBeenCalledWith("rg1", "map1");
    });
  });
});
