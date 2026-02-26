/**
 * Azure Application Gateway Manager — Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureAppGatewayManager } from "./manager.js";

function asyncIter<T>(items: T[]) {
  return { [Symbol.asyncIterator]: async function* () { for (const i of items) yield i; } };
}

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: {} }),
  clearCache: vi.fn(),
} as any;

describe("AzureAppGatewayManager", () => {
  let manager: AzureAppGatewayManager;

  const mockApplicationGateways = {
    listAll: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    beginStartAndWait: vi.fn(),
    beginStopAndWait: vi.fn(),
    beginDeleteAndWait: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureAppGatewayManager(mockCredentialsManager, "sub-123", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      applicationGateways: mockApplicationGateways,
    });
  });

  describe("listGateways", () => {
    it("should list all application gateways", async () => {
      mockApplicationGateways.listAll.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/applicationGateways/agw1",
          name: "agw1", location: "eastus",
          provisioningState: "Succeeded", operationalState: "Running",
          sku: { name: "Standard_v2", tier: "Standard_v2", capacity: 2 },
          frontendIPConfigurations: [{ name: "appGwPublicFrontendIp", publicIPAddress: { id: "/pip1" } }],
          backendAddressPools: [{ name: "backend-pool", backendAddresses: [{ ipAddress: "10.0.0.1" }] }],
          httpListeners: [{ name: "listener1", protocol: "Http", hostName: "example.com" }],
          tags: {},
        },
      ]));

      const gateways = await manager.listGateways();
      expect(gateways).toHaveLength(1);
      expect(gateways[0].name).toBe("agw1");
      expect(gateways[0].skuTier).toBe("Standard_v2");
      expect(gateways[0].operationalState).toBe("Running");
      expect(gateways[0].frontendIPConfigurations).toHaveLength(1);
      expect(gateways[0].backendAddressPools).toHaveLength(1);
      expect(gateways[0].httpListeners).toHaveLength(1);
    });

    it("should filter by resource group", async () => {
      mockApplicationGateways.list.mockReturnValue(asyncIter([]));
      const result = await manager.listGateways("rg1");
      expect(result).toEqual([]);
      expect(mockApplicationGateways.list).toHaveBeenCalledWith("rg1");
    });

    it("should handle gateways without WAF", async () => {
      mockApplicationGateways.listAll.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/applicationGateways/agw2",
          name: "agw2", location: "westus",
          provisioningState: "Succeeded", operationalState: "Stopped",
          sku: { name: "Basic", tier: "Basic", capacity: 1 },
          frontendIPConfigurations: [],
          backendAddressPools: [],
          httpListeners: [],
          tags: {},
        },
      ]));

      const gateways = await manager.listGateways();
      expect(gateways).toHaveLength(1);
      expect(gateways[0].operationalState).toBe("Stopped");
    });
  });

  describe("getGateway", () => {
    it("should return a gateway", async () => {
      mockApplicationGateways.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/applicationGateways/agw1",
        name: "agw1", location: "eastus",
        provisioningState: "Succeeded", operationalState: "Running",
        sku: { name: "WAF_v2", tier: "WAF_v2", capacity: 3 },
        frontendIPConfigurations: [],
        backendAddressPools: [],
        httpListeners: [],
        tags: {},
      });

      const gw = await manager.getGateway("rg1", "agw1");
      expect(gw).not.toBeNull();
      expect(gw!.name).toBe("agw1");
      expect(gw!.skuTier).toBe("WAF_v2");
      expect(gw!.skuCapacity).toBe(3);
    });

    it("should return null for 404", async () => {
      mockApplicationGateways.get.mockRejectedValue({ statusCode: 404 });
      const gw = await manager.getGateway("rg1", "nonexistent");
      expect(gw).toBeNull();
    });
  });

  describe("gateway lifecycle operations", () => {
    it("should start a gateway", async () => {
      mockApplicationGateways.beginStartAndWait.mockResolvedValue(undefined);
      await expect(manager.startGateway("rg1", "agw1")).resolves.toBeUndefined();
      expect(mockApplicationGateways.beginStartAndWait).toHaveBeenCalledWith("rg1", "agw1");
    });

    it("should stop a gateway", async () => {
      mockApplicationGateways.beginStopAndWait.mockResolvedValue(undefined);
      await expect(manager.stopGateway("rg1", "agw1")).resolves.toBeUndefined();
      expect(mockApplicationGateways.beginStopAndWait).toHaveBeenCalledWith("rg1", "agw1");
    });

    it("should delete a gateway", async () => {
      mockApplicationGateways.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(manager.deleteGateway("rg1", "agw1")).resolves.toBeUndefined();
      expect(mockApplicationGateways.beginDeleteAndWait).toHaveBeenCalledWith("rg1", "agw1");
    });
  });

  describe("getWAFConfig", () => {
    it("should return WAF configuration when present", async () => {
      mockApplicationGateways.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/applicationGateways/agw1",
        name: "agw1", location: "eastus",
        provisioningState: "Succeeded", operationalState: "Running",
        sku: { name: "WAF_v2", tier: "WAF_v2", capacity: 2 },
        frontendIPConfigurations: [],
        backendAddressPools: [],
        httpListeners: [],
        webApplicationFirewallConfiguration: {
          enabled: true,
          firewallMode: "Detection",
          ruleSetType: "OWASP",
          ruleSetVersion: "3.1",
        },
      });

      const waf = await manager.getWAFConfig("rg1", "agw1");
      expect(waf).not.toBeNull();
      expect(waf!.enabled).toBe(true);
      expect(waf!.firewallMode).toBe("Detection");
      expect(waf!.ruleSetVersion).toBe("3.1");
    });

    it("should return null when no WAF", async () => {
      mockApplicationGateways.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Network/applicationGateways/agw2",
        name: "agw2", location: "eastus",
        provisioningState: "Succeeded",
        sku: { name: "Standard_v2", tier: "Standard_v2", capacity: 1 },
        frontendIPConfigurations: [],
        backendAddressPools: [],
        httpListeners: [],
      });

      const waf = await manager.getWAFConfig("rg1", "agw2");
      expect(waf).toBeNull();
    });

    it("should return null for 404 gateway", async () => {
      mockApplicationGateways.get.mockRejectedValue({ statusCode: 404 });
      const waf = await manager.getWAFConfig("rg1", "nonexistent");
      expect(waf).toBeNull();
    });
  });

  describe("error propagation", () => {
    it("should rethrow non-404 errors from getGateway", async () => {
      mockApplicationGateways.get.mockRejectedValue({ statusCode: 403, message: "Forbidden" });
      await expect(manager.getGateway("rg1", "gw1")).rejects.toEqual({ statusCode: 403, message: "Forbidden" });
    });
  });
});
