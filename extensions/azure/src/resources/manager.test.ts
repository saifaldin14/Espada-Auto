/**
 * Azure Resource Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureResourceManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockResourceGroups = {
  list: vi.fn(),
  get: vi.fn(),
  createOrUpdate: vi.fn(),
  beginDeleteAndWait: vi.fn(),
};

const mockDeployments = {
  listByResourceGroup: vi.fn(),
  beginCreateOrUpdateAndWait: vi.fn(),
  beginValidateAndWait: vi.fn(),
};

const mockResources = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
};

vi.mock("@azure/arm-resources", () => ({
  ResourceManagementClient: vi.fn().mockImplementation(() => ({
    resourceGroups: mockResourceGroups,
    deployments: mockDeployments,
    resources: mockResources,
  })),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureResourceManager", () => {
  let mgr: AzureResourceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureResourceManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listResourceGroups", () => {
    it("lists all resource groups", async () => {
      mockResourceGroups.list.mockReturnValue(asyncIter([
        { id: "rg-id", name: "rg-1", location: "eastus", properties: { provisioningState: "Succeeded" }, tags: {} },
      ]));
      const rgs = await mgr.listResourceGroups();
      expect(rgs).toHaveLength(1);
      expect(rgs[0].name).toBe("rg-1");
    });
  });

  describe("getResourceGroup", () => {
    it("returns resource group details", async () => {
      mockResourceGroups.get.mockResolvedValue({ name: "rg-1", location: "eastus", properties: { provisioningState: "Succeeded" } });
      const rg = await mgr.getResourceGroup("rg-1");
      expect(rg.name).toBe("rg-1");
    });
  });

  describe("createResourceGroup", () => {
    it("creates a resource group", async () => {
      mockResourceGroups.createOrUpdate.mockResolvedValue({ name: "rg-new", location: "westus", tags: { env: "dev" } });
      const rg = await mgr.createResourceGroup("rg-new", "westus", { env: "dev" });
      expect(rg.name).toBe("rg-new");
    });
  });

  describe("deleteResourceGroup", () => {
    it("deletes a resource group", async () => {
      mockResourceGroups.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(mgr.deleteResourceGroup("rg-old")).resolves.toBeUndefined();
    });
  });

  describe("listDeployments", () => {
    it("lists deployments", async () => {
      mockDeployments.listByResourceGroup.mockReturnValue(asyncIter([
        { id: "dep-id", name: "deploy-1", properties: { provisioningState: "Succeeded", timestamp: new Date(), mode: "Incremental" } },
      ]));
      const deps = await mgr.listDeployments("rg-1");
      expect(deps).toHaveLength(1);
    });
  });

  describe("createDeployment", () => {
    it("creates an ARM deployment", async () => {
      mockDeployments.beginCreateOrUpdateAndWait.mockResolvedValue({
        id: "dep-id", name: "deploy-1", properties: { provisioningState: "Succeeded" },
      });
      const dep = await mgr.createDeployment("rg-1", "deploy-1", { "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#" });
      expect(dep.name).toBe("deploy-1");
    });
  });

  describe("validateDeployment", () => {
    it("validates successfully", async () => {
      mockDeployments.beginValidateAndWait.mockResolvedValue({ properties: { provisioningState: "Succeeded" } });
      const result = await mgr.validateDeployment("rg-1", "dep-1", {});
      expect(result.isValid).toBe(true);
    });
  });

  describe("listResources", () => {
    it("lists all resources", async () => {
      mockResources.list.mockReturnValue(asyncIter([
        { id: "res-1", name: "vm-1", type: "Microsoft.Compute/virtualMachines", location: "eastus" },
      ]));
      const resources = await mgr.listResources();
      expect(resources).toHaveLength(1);
    });

    it("lists resources by resource group", async () => {
      mockResources.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listResources("rg-1");
      expect(mockResources.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });
});
