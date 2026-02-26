/**
 * Azure Firewall Manager — Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureFirewallManager } from "./manager.js";

function asyncIter<T>(items: T[]) {
  return { [Symbol.asyncIterator]: async function* () { for (const i of items) yield i; } };
}

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: {} }),
  clearCache: vi.fn(),
} as any;

describe("AzureFirewallManager", () => {
  let manager: AzureFirewallManager;

  const mockAzureFirewalls = {
    listAll: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    beginDeleteAndWait: vi.fn(),
  };

  const mockFirewallPolicies = {
    listAll: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
  };

  const mockFirewallPolicyRuleCollectionGroups = {
    list: vi.fn(),
  };

  const mockIpGroups = {
    list: vi.fn(),
    listByResourceGroup: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureFirewallManager(mockCredentialsManager, "sub-123", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      azureFirewalls: mockAzureFirewalls,
      firewallPolicies: mockFirewallPolicies,
      firewallPolicyRuleCollectionGroups: mockFirewallPolicyRuleCollectionGroups,
      ipGroups: mockIpGroups,
    });
  });

  describe("listFirewalls", () => {
    it("should list all firewalls", async () => {
      mockAzureFirewalls.listAll.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/azureFirewalls/fw1",
          name: "fw1", location: "eastus",
          provisioningState: "Succeeded", threatIntelMode: "Alert",
          sku: { name: "AZFW_VNet", tier: "Standard" },
          ipConfigurations: [{ name: "ipconfig1", privateIPAddress: "10.0.0.4", publicIPAddress: { id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/publicIPAddresses/pip1" } }],
          firewallPolicy: { id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/firewallPolicies/policy1" },
          tags: { env: "prod" },
        },
      ]));

      const firewalls = await manager.listFirewalls();
      expect(firewalls).toHaveLength(1);
      expect(firewalls[0].name).toBe("fw1");
      expect(firewalls[0].skuTier).toBe("Standard");
      expect(firewalls[0].threatIntelMode).toBe("Alert");
      expect(firewalls[0].ipConfigurations).toHaveLength(1);
    });

    it("should filter by resource group", async () => {
      mockAzureFirewalls.list.mockReturnValue(asyncIter([]));
      const result = await manager.listFirewalls("rg1");
      expect(result).toEqual([]);
      expect(mockAzureFirewalls.list).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getFirewall", () => {
    it("should return a firewall", async () => {
      mockAzureFirewalls.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/azureFirewalls/fw1",
        name: "fw1", location: "eastus",
        provisioningState: "Succeeded", threatIntelMode: "Deny",
        sku: { name: "AZFW_VNet", tier: "Premium" },
        ipConfigurations: [],
        tags: {},
      });

      const fw = await manager.getFirewall("rg1", "fw1");
      expect(fw).not.toBeNull();
      expect(fw!.name).toBe("fw1");
      expect(fw!.skuTier).toBe("Premium");
    });

    it("should return null for 404", async () => {
      mockAzureFirewalls.get.mockRejectedValue({ statusCode: 404 });
      const fw = await manager.getFirewall("rg1", "nonexistent");
      expect(fw).toBeNull();
    });
  });

  describe("deleteFirewall", () => {
    it("should delete a firewall", async () => {
      mockAzureFirewalls.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(manager.deleteFirewall("rg1", "fw1")).resolves.toBeUndefined();
      expect(mockAzureFirewalls.beginDeleteAndWait).toHaveBeenCalledWith("rg1", "fw1");
    });
  });

  describe("listPolicies", () => {
    it("should list all firewall policies", async () => {
      mockFirewallPolicies.listAll.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/firewallPolicies/policy1",
          name: "policy1", location: "eastus",
          provisioningState: "Succeeded",
          sku: { tier: "Premium" },
          threatIntelMode: "Alert",
          dnsSettings: { enableProxy: true, servers: ["10.0.0.1"] },
          tags: {},
        },
      ]));

      const policies = await manager.listPolicies();
      expect(policies).toHaveLength(1);
      expect(policies[0].name).toBe("policy1");
      expect(policies[0].threatIntelMode).toBe("Alert");
      expect(policies[0].dnsSettings!.enableProxy).toBe(true);
    });
  });

  describe("getPolicy", () => {
    it("should return a firewall policy", async () => {
      mockFirewallPolicies.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/firewallPolicies/policy1",
        name: "policy1", location: "eastus",
        provisioningState: "Succeeded", threatIntelMode: "Deny",
        dnsSettings: { enableProxy: true, servers: ["10.0.0.1", "10.0.0.2"] },
        tags: { tier: "premium" },
      });

      const policy = await manager.getPolicy("rg1", "policy1");
      expect(policy).not.toBeNull();
      expect(policy!.name).toBe("policy1");
      expect(policy!.threatIntelMode).toBe("Deny");
      expect(policy!.dnsSettings!.servers).toHaveLength(2);
    });

    it("should return null for 404", async () => {
      mockFirewallPolicies.get.mockRejectedValue({ statusCode: 404 });
      const policy = await manager.getPolicy("rg1", "nonexistent");
      expect(policy).toBeNull();
    });
  });

  describe("listRuleCollectionGroups", () => {
    it("should list rule collection groups for a policy", async () => {
      mockFirewallPolicyRuleCollectionGroups.list.mockReturnValue(asyncIter([
        { id: "rcg1", name: "DefaultNetworkRuleCollectionGroup", priority: 200, provisioningState: "Succeeded" },
      ]));

      const groups = await manager.listRuleCollectionGroups("rg1", "policy1");
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe("DefaultNetworkRuleCollectionGroup");
      expect(groups[0].priority).toBe(200);
    });
  });

  describe("listIPGroups", () => {
    it("should list all IP Groups", async () => {
      mockIpGroups.list.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/ipGroups/ipg1",
          name: "ipg1", location: "eastus",
          provisioningState: "Succeeded",
          ipAddresses: ["10.0.0.0/24", "10.1.0.0/24"],
          firewalls: [{ id: "/fw1" }],
          tags: {},
        },
      ]));

      const groups = await manager.listIPGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe("ipg1");
      expect(groups[0].ipAddresses).toHaveLength(2);
    });
  });

  describe("error propagation", () => {
    it("should rethrow non-404 errors from getFirewall", async () => {
      mockAzureFirewalls.get.mockRejectedValue({ statusCode: 403, message: "Forbidden" });
      await expect(manager.getFirewall("rg1", "fw1")).rejects.toEqual({ statusCode: 403, message: "Forbidden" });
    });
  });
});
