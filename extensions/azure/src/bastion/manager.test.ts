/**
 * Azure Bastion Manager — Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureBastionManager } from "./manager.js";

function asyncIter<T>(items: T[]) {
  return { [Symbol.asyncIterator]: async function* () { for (const i of items) yield i; } };
}

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: {} }),
  clearCache: vi.fn(),
} as any;

describe("AzureBastionManager", () => {
  let manager: AzureBastionManager;

  const mockBastionHosts = {
    list: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
    beginDeleteAndWait: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureBastionManager(mockCredentialsManager, "sub-123", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      bastionHosts: mockBastionHosts,
    });
  });

  describe("listBastionHosts", () => {
    it("should list all bastion hosts", async () => {
      mockBastionHosts.list.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/bastionHosts/bastion1",
          name: "bastion1", location: "eastus",
          provisioningState: "Succeeded", dnsName: "bst-abc123.bastion.azure.com",
          scaleUnits: 2, disableCopyPaste: false, enableFileCopy: true,
          enableIpConnect: true, enableShareableLink: false,
          enableTunneling: true, enableKerberos: false,
          sku: { name: "Standard" },
          ipConfigurations: [
            {
              id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/bastionHosts/bastion1/bastionHostIpConfigurations/ipconfig1",
              name: "ipconfig1",
              subnet: { id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/virtualNetworks/vnet1/subnets/AzureBastionSubnet" },
              publicIPAddress: { id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/publicIPAddresses/pip1" },
              privateIPAllocationMethod: "Dynamic",
              provisioningState: "Succeeded",
            },
          ],
          tags: { env: "prod" },
        },
      ]));

      const hosts = await manager.listBastionHosts();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].name).toBe("bastion1");
      expect(hosts[0].skuName).toBe("Standard");
      expect(hosts[0].scaleUnits).toBe(2);
      expect(hosts[0].enableTunneling).toBe(true);
      expect(hosts[0].ipConfigurations).toHaveLength(1);
      expect(hosts[0].dnsName).toBe("bst-abc123.bastion.azure.com");
    });

    it("should filter by resource group", async () => {
      mockBastionHosts.listByResourceGroup.mockReturnValue(asyncIter([]));
      const result = await manager.listBastionHosts("rg1");
      expect(result).toEqual([]);
      expect(mockBastionHosts.listByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getBastionHost", () => {
    it("should return a bastion host", async () => {
      mockBastionHosts.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/bastionHosts/bastion1",
        name: "bastion1", location: "eastus",
        provisioningState: "Succeeded",
        sku: { name: "Basic" },
        ipConfigurations: [],
      });

      const host = await manager.getBastionHost("rg1", "bastion1");
      expect(host).not.toBeNull();
      expect(host!.name).toBe("bastion1");
      expect(host!.skuName).toBe("Basic");
      expect(mockBastionHosts.get).toHaveBeenCalledWith("rg1", "bastion1");
    });

    it("should return null for 404", async () => {
      mockBastionHosts.get.mockRejectedValue({ statusCode: 404 });
      const host = await manager.getBastionHost("rg1", "missing");
      expect(host).toBeNull();
    });

    it("should propagate non-404 errors", async () => {
      mockBastionHosts.get.mockRejectedValue(new Error("Internal server error"));
      await expect(manager.getBastionHost("rg1", "bastion1")).rejects.toThrow("Internal server error");
    });
  });

  describe("deleteBastionHost", () => {
    it("should delete a bastion host", async () => {
      mockBastionHosts.beginDeleteAndWait.mockResolvedValue(undefined);
      await manager.deleteBastionHost("rg1", "bastion1");
      expect(mockBastionHosts.beginDeleteAndWait).toHaveBeenCalledWith("rg1", "bastion1");
    });

    it("should propagate delete errors", async () => {
      mockBastionHosts.beginDeleteAndWait.mockRejectedValue(new Error("Delete failed"));
      await expect(manager.deleteBastionHost("rg1", "bastion1")).rejects.toThrow("Delete failed");
    });
  });
});
