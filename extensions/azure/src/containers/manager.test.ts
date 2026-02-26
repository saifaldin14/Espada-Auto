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
  beginCreateOrUpdateAndWait: vi.fn(),
  beginDeleteAndWait: vi.fn(),
  listClusterUserCredentials: vi.fn(),
};

const mockAgentPools = {
  beginCreateOrUpdateAndWait: vi.fn(),
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
  ContainerServiceClient: vi.fn().mockImplementation(function() { return {
    managedClusters: mockManagedClusters,
    agentPools: mockAgentPools,
  }; }),
}));

vi.mock("@azure/arm-containerinstance", () => ({
  ContainerInstanceManagementClient: vi.fn().mockImplementation(function() { return {
    containerGroups: mockContainerGroups,
  }; }),
}));

vi.mock("@azure/arm-containerregistry", () => ({
  ContainerRegistryManagementClient: vi.fn().mockImplementation(function() { return {
    registries: mockRegistries,
  }; }),
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

  describe("createAKSCluster", () => {
    it("creates an AKS cluster", async () => {
      mockManagedClusters.beginCreateOrUpdateAndWait.mockResolvedValue({
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ContainerService/managedClusters/new-aks",
        name: "new-aks", location: "eastus", kubernetesVersion: "1.29",
        provisioningState: "Succeeded", powerState: { code: "Running" },
        agentPoolProfiles: [{ name: "nodepool1", count: 3, vmSize: "Standard_D2s_v5", osType: "Linux", mode: "System" }],
        fqdn: "new-aks.hcp.eastus.azmk8s.io",
      });
      const cluster = await mgr.createAKSCluster({
        name: "new-aks", resourceGroup: "rg-1", location: "eastus",
      });
      expect(cluster.name).toBe("new-aks");
      expect(cluster.nodeCount).toBe(3);
    });
  });

  describe("deleteAKSCluster", () => {
    it("deletes an AKS cluster", async () => {
      mockManagedClusters.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(mgr.deleteAKSCluster("rg-1", "aks-1")).resolves.toBeUndefined();
    });
  });

  describe("scaleNodePool", () => {
    it("scales a node pool", async () => {
      mockAgentPools.beginCreateOrUpdateAndWait.mockResolvedValue(undefined);
      await expect(mgr.scaleNodePool("rg-1", "aks-1", "nodepool1", 5)).resolves.toBeUndefined();
      expect(mockAgentPools.beginCreateOrUpdateAndWait).toHaveBeenCalledWith(
        "rg-1", "aks-1", "nodepool1", { count: 5 }
      );
    });
  });

  describe("getClusterCredentials", () => {
    it("returns kubeconfig", async () => {
      mockManagedClusters.listClusterUserCredentials.mockResolvedValue({
        kubeconfigs: [{ name: "clusterUser", value: new TextEncoder().encode("apiVersion: v1") }],
      });
      const kubeconfig = await mgr.getClusterCredentials("rg-1", "aks-1");
      expect(kubeconfig).toBe("apiVersion: v1");
    });

    it("returns empty string when no credentials", async () => {
      mockManagedClusters.listClusterUserCredentials.mockResolvedValue({ kubeconfigs: [] });
      const kubeconfig = await mgr.getClusterCredentials("rg-1", "aks-1");
      expect(kubeconfig).toBe("");
    });
  });
});
