/**
 * Azure Container Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureContainerManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockManagedClusters = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
};

const mockContainerGroups = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
};

const mockRegistries = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
};

vi.mock("@azure/arm-containerservice", () => ({
  ContainerServiceClient: vi.fn().mockImplementation(() => ({
    managedClusters: mockManagedClusters,
  })),
}));

vi.mock("@azure/arm-containerinstance", () => ({
  ContainerInstanceManagementClient: vi.fn().mockImplementation(() => ({
    containerGroups: mockContainerGroups,
  })),
}));

vi.mock("@azure/arm-containerregistry", () => ({
  ContainerRegistryManagementClient: vi.fn().mockImplementation(() => ({
    registries: mockRegistries,
  })),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureContainerManager", () => {
  let mgr: AzureContainerManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureContainerManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listAKSClusters", () => {
    it("lists all AKS clusters", async () => {
      mockManagedClusters.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ContainerService/managedClusters/aks-1", name: "aks-1", location: "eastus", properties: { kubernetesVersion: "1.28", provisioningState: "Succeeded", powerState: { code: "Running" }, fqdn: "aks-1.hcp.eastus.azmk8s.io" }, tags: {} },
      ]));
      const clusters = await mgr.listAKSClusters();
      expect(clusters).toHaveLength(1);
      expect(clusters[0].name).toBe("aks-1");
    });

    it("filters by resource group", async () => {
      mockManagedClusters.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listAKSClusters("rg-1");
      expect(mockManagedClusters.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });

    it("returns empty when no clusters", async () => {
      mockManagedClusters.list.mockReturnValue(asyncIter([]));
      expect(await mgr.listAKSClusters()).toEqual([]);
    });
  });

  describe("listContainerInstances", () => {
    it("lists all container instances", async () => {
      mockContainerGroups.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ContainerInstance/containerGroups/ci-1", name: "ci-1", location: "eastus", properties: { osType: "Linux", provisioningState: "Succeeded", ipAddress: { ip: "10.0.0.5", type: "Public" }, containers: [{ name: "web", properties: { image: "nginx:latest" } }] }, tags: {} },
      ]));
      const instances = await mgr.listContainerInstances();
      expect(instances).toHaveLength(1);
      expect(instances[0].name).toBe("ci-1");
    });

    it("filters by resource group", async () => {
      mockContainerGroups.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listContainerInstances("rg-1");
      expect(mockContainerGroups.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("listContainerRegistries", () => {
    it("lists all registries", async () => {
      mockRegistries.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ContainerRegistry/registries/myacr", name: "myacr", location: "eastus", properties: { loginServer: "myacr.azurecr.io", provisioningState: "Succeeded", adminUserEnabled: true }, sku: { name: "Standard", tier: "Standard" }, tags: {} },
      ]));
      const registries = await mgr.listContainerRegistries();
      expect(registries).toHaveLength(1);
      expect(registries[0].name).toBe("myacr");
    });

    it("filters by resource group", async () => {
      mockRegistries.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listContainerRegistries("rg-1");
      expect(mockRegistries.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });
});
