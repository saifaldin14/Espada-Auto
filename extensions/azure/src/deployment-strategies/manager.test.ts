/**
 * Azure Deployment Strategies — Manager Tests
 *
 * Tests the 4 strategy operations:
 *   1. Blue/green slot swap
 *   2. Canary slot traffic shifting
 *   3. Traffic Manager weighted shifting
 *   4. Deployment status aggregation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureDeploymentStrategyManager } from "./manager.js";

// ---------------------------------------------------------------------------
// Mock managers
// ---------------------------------------------------------------------------

function createMockWebAppManager() {
  return {
    listDeploymentSlots: vi.fn(),
    swapSlots: vi.fn(),
    setSlotTrafficPercentage: vi.fn(),
    getSlotTrafficPercentage: vi.fn(),
    getWebApp: vi.fn(),
  };
}

function createMockTrafficManagerManager() {
  return {
    getProfile: vi.fn(),
    listEndpoints: vi.fn(),
    updateEndpointWeight: vi.fn(),
  };
}

describe("AzureDeploymentStrategyManager", () => {
  let manager: AzureDeploymentStrategyManager;
  let mockWebApp: ReturnType<typeof createMockWebAppManager>;
  let mockTM: ReturnType<typeof createMockTrafficManagerManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWebApp = createMockWebAppManager();
    mockTM = createMockTrafficManagerManager();
    manager = new AzureDeploymentStrategyManager(mockWebApp as any, mockTM as any);
  });

  // =========================================================================
  // Blue/Green Slot Swap
  // =========================================================================

  describe("blueGreenSlotSwap", () => {
    it("swaps source → target on success", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([
        { name: "myapp/staging", state: "Running", defaultHostName: "myapp-staging.azurewebsites.net" },
      ]);
      mockWebApp.swapSlots.mockResolvedValue(undefined);

      const result = await manager.blueGreenSlotSwap({
        resourceGroup: "rg1",
        appName: "myapp",
        sourceSlot: "staging",
      });

      expect(result.success).toBe(true);
      expect(result.strategy).toBe("blue-green-slot");
      expect(result.sourceSlot).toBe("staging");
      expect(result.targetSlot).toBe("production");
      expect(result.summary).toContain("✅");
      expect(result.summary).toContain("staging");
      expect(result.swappedAt).toBeTruthy();
      expect(mockWebApp.swapSlots).toHaveBeenCalledWith("rg1", "myapp", "staging", "production");
    });

    it("uses custom target slot", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([
        { name: "myapp/blue", state: "Running", defaultHostName: "myapp-blue.azurewebsites.net" },
      ]);
      mockWebApp.swapSlots.mockResolvedValue(undefined);

      const result = await manager.blueGreenSlotSwap({
        resourceGroup: "rg1",
        appName: "myapp",
        sourceSlot: "blue",
        targetSlot: "green",
      });

      expect(result.success).toBe(true);
      expect(result.targetSlot).toBe("green");
      expect(mockWebApp.swapSlots).toHaveBeenCalledWith("rg1", "myapp", "blue", "green");
    });

    it("fails if source slot does not exist", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([
        { name: "myapp/canary", state: "Running", defaultHostName: "myapp-canary.azurewebsites.net" },
      ]);

      const result = await manager.blueGreenSlotSwap({
        resourceGroup: "rg1",
        appName: "myapp",
        sourceSlot: "staging",
      });

      expect(result.success).toBe(false);
      expect(result.summary).toContain("not found");
      expect(result.summary).toContain("staging");
      expect(mockWebApp.swapSlots).not.toHaveBeenCalled();
    });

    it("fails if no slots exist", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([]);

      const result = await manager.blueGreenSlotSwap({
        resourceGroup: "rg1",
        appName: "myapp",
        sourceSlot: "staging",
      });

      expect(result.success).toBe(false);
      expect(result.summary).toContain("not found");
      expect(mockWebApp.swapSlots).not.toHaveBeenCalled();
    });

    it("runs health check before swap (healthy)", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([
        { name: "myapp/staging", state: "Running", defaultHostName: "myapp-staging.azurewebsites.net" },
      ]);
      mockWebApp.swapSlots.mockResolvedValue(undefined);

      // Mock global fetch for the health check
      const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      const result = await manager.blueGreenSlotSwap({
        resourceGroup: "rg1",
        appName: "myapp",
        sourceSlot: "staging",
        healthCheck: true,
        healthCheckPath: "/health",
      });

      expect(result.success).toBe(true);
      expect(result.healthCheck).not.toBeNull();
      expect(result.healthCheck!.healthy).toBe(true);
      expect(result.healthCheck!.url).toBe("https://myapp-staging.azurewebsites.net/health");
      expect(mockWebApp.swapSlots).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("aborts swap on failed health check", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([
        { name: "myapp/staging", state: "Running", defaultHostName: "myapp-staging.azurewebsites.net" },
      ]);

      const mockFetch = vi.fn().mockResolvedValue({ status: 503 });
      vi.stubGlobal("fetch", mockFetch);

      const result = await manager.blueGreenSlotSwap({
        resourceGroup: "rg1",
        appName: "myapp",
        sourceSlot: "staging",
        healthCheck: true,
      });

      expect(result.success).toBe(false);
      expect(result.healthCheck).not.toBeNull();
      expect(result.healthCheck!.healthy).toBe(false);
      expect(result.healthCheck!.statusCode).toBe(503);
      expect(result.summary).toContain("health check failed");
      expect(mockWebApp.swapSlots).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("handles health check network error", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([
        { name: "myapp/staging", state: "Running", defaultHostName: "myapp-staging.azurewebsites.net" },
      ]);

      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await manager.blueGreenSlotSwap({
        resourceGroup: "rg1",
        appName: "myapp",
        sourceSlot: "staging",
        healthCheck: true,
      });

      expect(result.success).toBe(false);
      expect(result.healthCheck!.error).toContain("ECONNREFUSED");
      expect(mockWebApp.swapSlots).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("skips health check when not requested", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([
        { name: "myapp/staging", state: "Running", defaultHostName: "myapp-staging.azurewebsites.net" },
      ]);
      mockWebApp.swapSlots.mockResolvedValue(undefined);

      const result = await manager.blueGreenSlotSwap({
        resourceGroup: "rg1",
        appName: "myapp",
        sourceSlot: "staging",
      });

      expect(result.success).toBe(true);
      expect(result.healthCheck).toBeNull();
    });
  });

  // =========================================================================
  // Canary Slot Traffic Shifting
  // =========================================================================

  describe("canarySlotShift", () => {
    it("sets canary traffic percentage", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([
        { name: "myapp/staging", state: "Running", defaultHostName: "myapp-staging.azurewebsites.net" },
      ]);
      mockWebApp.setSlotTrafficPercentage.mockResolvedValue(undefined);

      const result = await manager.canarySlotShift({
        resourceGroup: "rg1",
        appName: "myapp",
        slotName: "staging",
        percentage: 20,
      });

      expect(result.success).toBe(true);
      expect(result.strategy).toBe("canary-slot");
      expect(result.percentage).toBe(20);
      expect(result.productionPercentage).toBe(80);
      expect(result.summary).toContain("20%");
      expect(result.summary).toContain("staging");
      expect(mockWebApp.setSlotTrafficPercentage).toHaveBeenCalledWith("rg1", "myapp", {
        routingRules: [{ slotName: "staging", reroutePercentage: 20 }],
      });
    });

    it("reverts canary with 0% (clears rules)", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([
        { name: "myapp/staging", state: "Running", defaultHostName: "myapp-staging.azurewebsites.net" },
      ]);
      mockWebApp.setSlotTrafficPercentage.mockResolvedValue(undefined);

      const result = await manager.canarySlotShift({
        resourceGroup: "rg1",
        appName: "myapp",
        slotName: "staging",
        percentage: 0,
      });

      expect(result.success).toBe(true);
      expect(result.percentage).toBe(0);
      expect(result.productionPercentage).toBe(100);
      expect(result.summary).toContain("reverted");
      expect(mockWebApp.setSlotTrafficPercentage).toHaveBeenCalledWith("rg1", "myapp", {
        routingRules: [],
      });
    });

    it("rejects invalid percentage (negative)", async () => {
      const result = await manager.canarySlotShift({
        resourceGroup: "rg1",
        appName: "myapp",
        slotName: "staging",
        percentage: -10,
      });

      expect(result.success).toBe(false);
      expect(result.summary).toContain("Invalid percentage");
      expect(mockWebApp.setSlotTrafficPercentage).not.toHaveBeenCalled();
    });

    it("rejects invalid percentage (>100)", async () => {
      const result = await manager.canarySlotShift({
        resourceGroup: "rg1",
        appName: "myapp",
        slotName: "staging",
        percentage: 150,
      });

      expect(result.success).toBe(false);
      expect(result.summary).toContain("Invalid percentage");
    });

    it("fails if slot does not exist", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([]);

      const result = await manager.canarySlotShift({
        resourceGroup: "rg1",
        appName: "myapp",
        slotName: "staging",
        percentage: 10,
      });

      expect(result.success).toBe(false);
      expect(result.summary).toContain("not found");
      expect(mockWebApp.setSlotTrafficPercentage).not.toHaveBeenCalled();
    });

    it("sets 100% canary traffic", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([
        { name: "myapp/staging", state: "Running", defaultHostName: "myapp-staging.azurewebsites.net" },
      ]);
      mockWebApp.setSlotTrafficPercentage.mockResolvedValue(undefined);

      const result = await manager.canarySlotShift({
        resourceGroup: "rg1",
        appName: "myapp",
        slotName: "staging",
        percentage: 100,
      });

      expect(result.success).toBe(true);
      expect(result.percentage).toBe(100);
      expect(result.productionPercentage).toBe(0);
    });
  });

  // =========================================================================
  // Traffic Manager Weighted Shifting
  // =========================================================================

  describe("trafficManagerShift", () => {
    it("updates endpoint weights on Weighted profile", async () => {
      mockTM.getProfile.mockResolvedValue({
        name: "my-tm",
        trafficRoutingMethod: "Weighted",
      });
      mockTM.updateEndpointWeight.mockImplementation(async (opts: any) => ({
        name: opts.endpointName,
        weight: opts.weight,
        target: `${opts.endpointName}.azurewebsites.net`,
        endpointStatus: "Enabled",
      }));

      const result = await manager.trafficManagerShift({
        resourceGroup: "rg1",
        profileName: "my-tm",
        weights: [
          { endpointName: "blue", endpointType: "AzureEndpoints", weight: 800 },
          { endpointName: "green", endpointType: "AzureEndpoints", weight: 200 },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.strategy).toBe("traffic-manager-weighted");
      expect(result.endpoints).toHaveLength(2);
      expect(result.endpoints[0].weight).toBe(800);
      expect(result.endpoints[1].weight).toBe(200);
      expect(result.summary).toContain("✅");
      expect(result.summary).toContain("blue");
      expect(result.summary).toContain("green");
      expect(mockTM.updateEndpointWeight).toHaveBeenCalledTimes(2);
    });

    it("fails if profile not found", async () => {
      mockTM.getProfile.mockResolvedValue(null);

      const result = await manager.trafficManagerShift({
        resourceGroup: "rg1",
        profileName: "missing",
        weights: [{ endpointName: "ep1", endpointType: "AzureEndpoints", weight: 500 }],
      });

      expect(result.success).toBe(false);
      expect(result.summary).toContain("not found");
      expect(mockTM.updateEndpointWeight).not.toHaveBeenCalled();
    });

    it("fails if profile is not Weighted routing", async () => {
      mockTM.getProfile.mockResolvedValue({
        name: "my-tm",
        trafficRoutingMethod: "Priority",
      });

      const result = await manager.trafficManagerShift({
        resourceGroup: "rg1",
        profileName: "my-tm",
        weights: [{ endpointName: "ep1", endpointType: "AzureEndpoints", weight: 500 }],
      });

      expect(result.success).toBe(false);
      expect(result.summary).toContain("Priority");
      expect(result.summary).toContain("Weighted");
      expect(mockTM.updateEndpointWeight).not.toHaveBeenCalled();
    });

    it("rejects weight below 1", async () => {
      mockTM.getProfile.mockResolvedValue({
        name: "my-tm",
        trafficRoutingMethod: "Weighted",
      });

      const result = await manager.trafficManagerShift({
        resourceGroup: "rg1",
        profileName: "my-tm",
        weights: [{ endpointName: "ep1", endpointType: "AzureEndpoints", weight: 0 }],
      });

      expect(result.success).toBe(false);
      expect(result.summary).toContain("Invalid weight");
      expect(mockTM.updateEndpointWeight).not.toHaveBeenCalled();
    });

    it("rejects weight above 1000", async () => {
      mockTM.getProfile.mockResolvedValue({
        name: "my-tm",
        trafficRoutingMethod: "Weighted",
      });

      const result = await manager.trafficManagerShift({
        resourceGroup: "rg1",
        profileName: "my-tm",
        weights: [{ endpointName: "ep1", endpointType: "AzureEndpoints", weight: 1001 }],
      });

      expect(result.success).toBe(false);
      expect(result.summary).toContain("Invalid weight");
    });

    it("calculates percentage breakdown in summary", async () => {
      mockTM.getProfile.mockResolvedValue({
        name: "my-tm",
        trafficRoutingMethod: "Weighted",
      });
      mockTM.updateEndpointWeight.mockImplementation(async (opts: any) => ({
        name: opts.endpointName,
        weight: opts.weight,
        endpointStatus: "Enabled",
      }));

      const result = await manager.trafficManagerShift({
        resourceGroup: "rg1",
        profileName: "my-tm",
        weights: [
          { endpointName: "blue", endpointType: "AzureEndpoints", weight: 750 },
          { endpointName: "green", endpointType: "AzureEndpoints", weight: 250 },
        ],
      });

      expect(result.success).toBe(true);
      // 750/(750+250) = 75%, 250/(750+250) = 25%
      expect(result.summary).toContain("75%");
      expect(result.summary).toContain("25%");
    });
  });

  // =========================================================================
  // Deployment Status
  // =========================================================================

  describe("getDeploymentStatus", () => {
    it("returns slots and traffic routing", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([
        { name: "myapp/staging", state: "Running", defaultHostName: "myapp-staging.azurewebsites.net" },
        { name: "myapp/canary", state: "Stopped", defaultHostName: "myapp-canary.azurewebsites.net" },
      ]);
      mockWebApp.getSlotTrafficPercentage.mockResolvedValue({
        routingRules: [
          { slotName: "staging", reroutePercentage: 15 },
        ],
      });

      const status = await manager.getDeploymentStatus("rg1", "myapp");

      expect(status.appName).toBe("myapp");
      expect(status.resourceGroup).toBe("rg1");
      expect(status.slots).toHaveLength(2);
      expect(status.slots[0].name).toBe("myapp/staging");
      expect(status.slots[0].state).toBe("Running");
      expect(status.slotRouting).not.toBeNull();
      expect(status.slotRouting!.productionPercentage).toBe(85);
      expect(status.slotRouting!.rules[0].slotName).toBe("staging");
      expect(status.slotRouting!.rules[0].percentage).toBe(15);
      expect(status.trafficManager).toBeUndefined();
    });

    it("returns null slotRouting when no rules configured", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([]);
      mockWebApp.getSlotTrafficPercentage.mockResolvedValue({
        routingRules: [],
      });

      const status = await manager.getDeploymentStatus("rg1", "myapp");

      expect(status.slotRouting).toBeNull();
      expect(status.slots).toEqual([]);
    });

    it("includes Traffic Manager info when requested", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([]);
      mockWebApp.getSlotTrafficPercentage.mockResolvedValue({ routingRules: [] });
      mockTM.getProfile.mockResolvedValue({
        name: "my-tm",
        trafficRoutingMethod: "Weighted",
      });
      mockTM.listEndpoints.mockResolvedValue([
        { name: "blue", weight: 900, target: "blue.azurewebsites.net", endpointStatus: "Enabled" },
        { name: "green", weight: 100, target: "green.azurewebsites.net", endpointStatus: "Enabled" },
      ]);

      const status = await manager.getDeploymentStatus("rg1", "myapp", {
        profileName: "my-tm",
      });

      expect(status.trafficManager).toBeDefined();
      expect(status.trafficManager!.profileName).toBe("my-tm");
      expect(status.trafficManager!.routingMethod).toBe("Weighted");
      expect(status.trafficManager!.endpoints).toHaveLength(2);
      expect(status.trafficManager!.endpoints[0].name).toBe("blue");
      expect(status.trafficManager!.endpoints[0].weight).toBe(900);
    });

    it("omits Traffic Manager when profile not found", async () => {
      mockWebApp.listDeploymentSlots.mockResolvedValue([]);
      mockWebApp.getSlotTrafficPercentage.mockResolvedValue({ routingRules: [] });
      mockTM.getProfile.mockResolvedValue(null);

      const status = await manager.getDeploymentStatus("rg1", "myapp", {
        profileName: "missing-tm",
      });

      expect(status.trafficManager).toBeUndefined();
    });

    it("fetches slots and traffic concurrently", async () => {
      let resolveSlots: Function;
      let resolveTraffic: Function;
      const slotsPromise = new Promise<any[]>((r) => { resolveSlots = r; });
      const trafficPromise = new Promise<any>((r) => { resolveTraffic = r; });

      mockWebApp.listDeploymentSlots.mockReturnValue(slotsPromise);
      mockWebApp.getSlotTrafficPercentage.mockReturnValue(trafficPromise);

      const statusPromise = manager.getDeploymentStatus("rg1", "myapp");

      // Both should have been called before either resolves
      expect(mockWebApp.listDeploymentSlots).toHaveBeenCalledTimes(1);
      expect(mockWebApp.getSlotTrafficPercentage).toHaveBeenCalledTimes(1);

      resolveSlots!([]);
      resolveTraffic!({ routingRules: [] });

      const status = await statusPromise;
      expect(status.appName).toBe("myapp");
    });
  });
});
