import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureSynapseManager } from "./manager.js";

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

describe("AzureSynapseManager", () => {
  let manager: AzureSynapseManager;

  const mockWorkspaces = {
    list: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
    beginDeleteAndWait: vi.fn(),
  };

  const mockSqlPools = {
    listByWorkspace: vi.fn(),
    get: vi.fn(),
  };

  const mockBigDataPools = {
    listByWorkspace: vi.fn(),
    get: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureSynapseManager(mockCredentialsManager, "sub-123", {
      maxAttempts: 1,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      workspaces: mockWorkspaces,
      sqlPools: mockSqlPools,
      bigDataPools: mockBigDataPools,
    });
  });

  // ---------------------------------------------------------------------------
  // Workspaces
  // ---------------------------------------------------------------------------

  describe("listWorkspaces", () => {
    it("lists all workspaces across the subscription", async () => {
      mockWorkspaces.list.mockReturnValue(
        asyncIter([
          { id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Synapse/workspaces/ws1", name: "ws1", location: "eastus" },
          { id: "/subscriptions/sub/resourceGroups/rg2/providers/Microsoft.Synapse/workspaces/ws2", name: "ws2", location: "westus" },
        ]),
      );

      const result = await manager.listWorkspaces();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("ws1");
      expect(result[1].name).toBe("ws2");
      expect(mockWorkspaces.list).toHaveBeenCalled();
    });

    it("filters by resource group when provided", async () => {
      mockWorkspaces.listByResourceGroup.mockReturnValue(
        asyncIter([{ id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Synapse/workspaces/ws1", name: "ws1", location: "eastus" }]),
      );

      const result = await manager.listWorkspaces("rg1");
      expect(result).toHaveLength(1);
      expect(mockWorkspaces.listByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getWorkspace", () => {
    it("returns a workspace by name", async () => {
      mockWorkspaces.get.mockResolvedValue({
        id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.Synapse/workspaces/ws1",
        name: "ws1",
        location: "eastus",
        provisioningState: "Succeeded",
      });

      const result = await manager.getWorkspace("rg1", "ws1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("ws1");
      expect(result!.provisioningState).toBe("Succeeded");
    });

    it("returns null for 404", async () => {
      mockWorkspaces.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getWorkspace("rg1", "nonexistent");
      expect(result).toBeNull();
    });

    it("propagates non-404 errors", async () => {
      mockWorkspaces.get.mockRejectedValue(new Error("Server error"));
      await expect(manager.getWorkspace("rg1", "ws1")).rejects.toThrow("Server error");
    });
  });

  describe("deleteWorkspace", () => {
    it("deletes a workspace", async () => {
      mockWorkspaces.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(manager.deleteWorkspace("rg1", "ws1")).resolves.toBeUndefined();
      expect(mockWorkspaces.beginDeleteAndWait).toHaveBeenCalledWith("rg1", "ws1");
    });
  });

  // ---------------------------------------------------------------------------
  // SQL Pools
  // ---------------------------------------------------------------------------

  describe("listSqlPools", () => {
    it("lists SQL pools in a workspace", async () => {
      mockSqlPools.listByWorkspace.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/ws/sqlPools/pool1", name: "pool1", sku: { name: "DW100c" }, status: "Online" },
        ]),
      );

      const result = await manager.listSqlPools("rg1", "ws1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("pool1");
      expect(mockSqlPools.listByWorkspace).toHaveBeenCalledWith("rg1", "ws1");
    });
  });

  describe("getSqlPool", () => {
    it("returns a SQL pool", async () => {
      mockSqlPools.get.mockResolvedValue({
        id: "/sub/rg/ws/sqlPools/pool1",
        name: "pool1",
        sku: { name: "DW100c", capacity: 1 },
        status: "Online",
      });

      const result = await manager.getSqlPool("rg1", "ws1", "pool1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("pool1");
    });

    it("returns null for 404", async () => {
      mockSqlPools.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getSqlPool("rg1", "ws1", "missing");
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Spark Pools
  // ---------------------------------------------------------------------------

  describe("listSparkPools", () => {
    it("lists Spark pools in a workspace", async () => {
      mockBigDataPools.listByWorkspace.mockReturnValue(
        asyncIter([{ id: "/sub/rg/ws/bigDataPools/spark1", name: "spark1", nodeSize: "Medium", nodeCount: 3 }]),
      );

      const result = await manager.listSparkPools("rg1", "ws1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("spark1");
      expect(mockBigDataPools.listByWorkspace).toHaveBeenCalledWith("rg1", "ws1");
    });
  });

  describe("getSparkPool", () => {
    it("returns a Spark pool", async () => {
      mockBigDataPools.get.mockResolvedValue({
        id: "/sub/rg/ws/bigDataPools/spark1",
        name: "spark1",
        nodeSize: "Medium",
        nodeCount: 3,
        provisioningState: "Succeeded",
      });

      const result = await manager.getSparkPool("rg1", "ws1", "spark1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("spark1");
    });

    it("returns null for 404", async () => {
      mockBigDataPools.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getSparkPool("rg1", "ws1", "missing");
      expect(result).toBeNull();
    });
  });
});
