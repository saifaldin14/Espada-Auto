import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureDataFactoryManager } from "./manager.js";

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

describe("AzureDataFactoryManager", () => {
  let manager: AzureDataFactoryManager;

  const mockFactories = {
    list: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  };

  const mockPipelines = {
    listByFactory: vi.fn(),
  };

  const mockPipelineRuns = {
    queryByFactory: vi.fn(),
  };

  const mockDatasets = {
    listByFactory: vi.fn(),
  };

  const mockLinkedServices = {
    listByFactory: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureDataFactoryManager(mockCredentialsManager, "sub-123", {
      maxAttempts: 1,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      factories: mockFactories,
      pipelines: mockPipelines,
      pipelineRuns: mockPipelineRuns,
      datasets: mockDatasets,
      linkedServices: mockLinkedServices,
    });
  });

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  describe("listFactories", () => {
    it("lists all factories across the subscription", async () => {
      mockFactories.list.mockReturnValue(
        asyncIter([
          { id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.DataFactory/factories/adf1", name: "adf1", location: "eastus" },
          { id: "/subscriptions/sub/resourceGroups/rg2/providers/Microsoft.DataFactory/factories/adf2", name: "adf2", location: "westus" },
        ]),
      );

      const result = await manager.listFactories();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("adf1");
      expect(result[1].name).toBe("adf2");
    });

    it("filters by resource group", async () => {
      mockFactories.listByResourceGroup.mockReturnValue(
        asyncIter([
          { id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.DataFactory/factories/adf1", name: "adf1", location: "eastus" },
        ]),
      );

      const result = await manager.listFactories("rg1");
      expect(result).toHaveLength(1);
      expect(mockFactories.listByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getFactory", () => {
    it("returns a factory by name", async () => {
      mockFactories.get.mockResolvedValue({
        id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.DataFactory/factories/adf1",
        name: "adf1",
        location: "eastus",
        provisioningState: "Succeeded",
      });

      const result = await manager.getFactory("rg1", "adf1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("adf1");
    });

    it("returns null for 404", async () => {
      mockFactories.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getFactory("rg1", "missing");
      expect(result).toBeNull();
    });

    it("propagates non-404 errors", async () => {
      mockFactories.get.mockRejectedValue(new Error("Server error"));
      await expect(manager.getFactory("rg1", "adf1")).rejects.toThrow("Server error");
    });
  });

  describe("deleteFactory", () => {
    it("deletes a factory", async () => {
      mockFactories.delete.mockResolvedValue(undefined);
      await expect(manager.deleteFactory("rg1", "adf1")).resolves.toBeUndefined();
      expect(mockFactories.delete).toHaveBeenCalledWith("rg1", "adf1");
    });
  });

  // ---------------------------------------------------------------------------
  // Pipelines
  // ---------------------------------------------------------------------------

  describe("listPipelines", () => {
    it("lists pipelines in a factory", async () => {
      mockPipelines.listByFactory.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/adf/pipelines/p1", name: "p1", activities: [1, 2], description: "Pipeline 1" },
          { id: "/sub/rg/adf/pipelines/p2", name: "p2", activities: [1] },
        ]),
      );

      const result = await manager.listPipelines("rg1", "adf1");
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("p1");
      expect(mockPipelines.listByFactory).toHaveBeenCalledWith("rg1", "adf1");
    });
  });

  // ---------------------------------------------------------------------------
  // Pipeline Runs
  // ---------------------------------------------------------------------------

  describe("listPipelineRuns", () => {
    it("queries pipeline runs by time range", async () => {
      const after = new Date("2024-01-01");
      const before = new Date("2024-01-02");
      mockPipelineRuns.queryByFactory.mockResolvedValue({
        value: [
          { runId: "run1", pipelineName: "p1", status: "Succeeded" },
          { runId: "run2", pipelineName: "p1", status: "Failed", message: "Error" },
        ],
      });

      const result = await manager.listPipelineRuns("rg1", "adf1", after, before);
      expect(result).toHaveLength(2);
      expect(result[0].runId).toBe("run1");
      expect(result[1].status).toBe("Failed");
      expect(mockPipelineRuns.queryByFactory).toHaveBeenCalledWith("rg1", "adf1", {
        lastUpdatedAfter: after,
        lastUpdatedBefore: before,
      });
    });

    it("returns empty array when no runs", async () => {
      mockPipelineRuns.queryByFactory.mockResolvedValue({ value: [] });
      const result = await manager.listPipelineRuns("rg1", "adf1", new Date(), new Date());
      expect(result).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Datasets
  // ---------------------------------------------------------------------------

  describe("listDatasets", () => {
    it("lists datasets in a factory", async () => {
      mockDatasets.listByFactory.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/adf/datasets/ds1", name: "ds1", properties: { type: "AzureBlob" } },
        ]),
      );

      const result = await manager.listDatasets("rg1", "adf1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("ds1");
    });
  });

  // ---------------------------------------------------------------------------
  // Linked Services
  // ---------------------------------------------------------------------------

  describe("listLinkedServices", () => {
    it("lists linked services in a factory", async () => {
      mockLinkedServices.listByFactory.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/adf/linkedservices/ls1", name: "ls1", properties: { type: "AzureSqlDatabase" } },
        ]),
      );

      const result = await manager.listLinkedServices("rg1", "adf1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("ls1");
    });
  });
});
