/**
 * Azure Network Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureNetworkManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock SDK
// ---------------------------------------------------------------------------

const mockVirtualNetworks = {
  listAll: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
};

const mockSubnets = { list: vi.fn() };
const mockNSGs = { listAll: vi.fn(), list: vi.fn(), get: vi.fn() };
const mockSecurityRules = { list: vi.fn() };
const mockLBs = { listAll: vi.fn(), list: vi.fn() };
const mockPublicIPs = { listAll: vi.fn(), list: vi.fn() };

vi.mock("@azure/arm-network", () => ({
  NetworkManagementClient: vi.fn().mockImplementation(() => ({
    virtualNetworks: mockVirtualNetworks,
    subnets: mockSubnets,
    networkSecurityGroups: mockNSGs,
    securityRules: mockSecurityRules,
    loadBalancers: mockLBs,
    publicIPAddresses: mockPublicIPs,
  })),
}));

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
  getSubscriptionId: () => "sub-1",
  getTenantId: () => undefined,
  clearCache: vi.fn(),
} as unknown as AzureCredentialsManager;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AzureNetworkManager", () => {
  let mgr: AzureNetworkManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureNetworkManager(mockCredentialsManager, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  // --- VNets ---
  describe("listVNets", () => {
    it("lists all VNets without resource group", async () => {
      mockVirtualNetworks.listAll.mockReturnValue(asyncIter([{
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Network/virtualNetworks/vnet-1",
        name: "vnet-1", location: "eastus",
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        provisioningState: "Succeeded", enableDdosProtection: false,
        subnets: [{ id: "sub-id", name: "default", addressPrefix: "10.0.0.0/24" }],
        tags: { env: "dev" },
      }]));
      const vnets = await mgr.listVNets();
      expect(vnets).toHaveLength(1);
      expect(vnets[0].name).toBe("vnet-1");
      expect(vnets[0].addressSpace).toEqual(["10.0.0.0/16"]);
      expect(vnets[0].subnets).toHaveLength(1);
    });

    it("filters by resource group", async () => {
      mockVirtualNetworks.list.mockReturnValue(asyncIter([]));
      await mgr.listVNets("rg-1");
      expect(mockVirtualNetworks.list).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("getVNet", () => {
    it("returns VNet when found", async () => {
      mockVirtualNetworks.get.mockResolvedValue({
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Network/virtualNetworks/vnet-1",
        name: "vnet-1", location: "eastus",
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [], provisioningState: "Succeeded",
      });
      const vnet = await mgr.getVNet("rg-1", "vnet-1");
      expect(vnet).not.toBeNull();
      expect(vnet!.name).toBe("vnet-1");
    });

    it("returns null on 404", async () => {
      mockVirtualNetworks.get.mockRejectedValue({ statusCode: 404 });
      const vnet = await mgr.getVNet("rg-1", "gone");
      expect(vnet).toBeNull();
    });
  });

  // --- Subnets ---
  describe("listSubnets", () => {
    it("lists subnets in a VNet", async () => {
      mockSubnets.list.mockReturnValue(asyncIter([
        { id: "sub-1", name: "default", addressPrefix: "10.0.0.0/24", provisioningState: "Succeeded" },
        { id: "sub-2", name: "backend", addressPrefix: "10.0.1.0/24", networkSecurityGroup: { id: "nsg-1" } },
      ]));
      const subnets = await mgr.listSubnets("rg-1", "vnet-1");
      expect(subnets).toHaveLength(2);
      expect(subnets[0].addressPrefix).toBe("10.0.0.0/24");
      expect(subnets[1].networkSecurityGroupId).toBe("nsg-1");
    });
  });

  // --- NSGs ---
  describe("listNSGs", () => {
    it("lists all NSGs", async () => {
      mockNSGs.listAll.mockReturnValue(asyncIter([{
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Network/networkSecurityGroups/nsg-1",
        name: "nsg-1", location: "eastus", provisioningState: "Succeeded",
        securityRules: [{
          id: "rule-1", name: "AllowHTTP", priority: 100, direction: "Inbound",
          access: "Allow", protocol: "Tcp", destinationPortRange: "80",
        }],
      }]));
      const nsgs = await mgr.listNSGs();
      expect(nsgs).toHaveLength(1);
      expect(nsgs[0].securityRules).toHaveLength(1);
      expect(nsgs[0].securityRules[0].priority).toBe(100);
    });
  });

  describe("getNSG", () => {
    it("returns null on 404", async () => {
      mockNSGs.get.mockRejectedValue({ statusCode: 404 });
      const nsg = await mgr.getNSG("rg-1", "gone");
      expect(nsg).toBeNull();
    });
  });

  describe("listNSGRules", () => {
    it("returns security rules for an NSG", async () => {
      mockSecurityRules.list.mockReturnValue(asyncIter([
        { id: "r1", name: "AllowSSH", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", destinationPortRange: "22" },
      ]));
      const rules = await mgr.listNSGRules("rg-1", "nsg-1");
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe("AllowSSH");
      expect(rules[0].access).toBe("Allow");
    });
  });

  // --- Load Balancers ---
  describe("listLoadBalancers", () => {
    it("lists all load balancers", async () => {
      mockLBs.listAll.mockReturnValue(asyncIter([{
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Network/loadBalancers/lb-1",
        name: "lb-1", location: "eastus", sku: { name: "Standard" },
        provisioningState: "Succeeded",
        frontendIPConfigurations: [{ id: "fip", name: "default" }],
      }]));
      const lbs = await mgr.listLoadBalancers();
      expect(lbs).toHaveLength(1);
      expect(lbs[0].name).toBe("lb-1");
    });
  });

  // --- Public IPs ---
  describe("listPublicIPs", () => {
    it("lists all public IPs", async () => {
      mockPublicIPs.listAll.mockReturnValue(asyncIter([{
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Network/publicIPAddresses/pip-1",
        name: "pip-1", location: "eastus", ipAddress: "20.100.0.1",
        publicIPAllocationMethod: "Static", sku: { name: "Standard" },
      }]));
      const pips = await mgr.listPublicIPs();
      expect(pips).toHaveLength(1);
      expect(pips[0].name).toBe("pip-1");
      expect(pips[0].ipAddress).toBe("20.100.0.1");
    });
  });
});
