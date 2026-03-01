/**
 * Azure Deployment Strategies — Manager
 *
 * Orchestrates blue/green slot swaps, canary traffic shifting, and
 * Traffic Manager weighted deployments by composing lower-level
 * WebApp and Traffic Manager manager methods.
 */

import type { AzureWebAppManager } from "../webapp/index.js";
import type { AzureTrafficManagerManager } from "../trafficmanager/index.js";
import type {
  BlueGreenSlotOptions,
  BlueGreenSlotResult,
  CanarySlotOptions,
  CanarySlotResult,
  TrafficManagerShiftOptions,
  TrafficManagerShiftResult,
  DeploymentStatus,
  HealthCheckResult,
} from "./types.js";

export class AzureDeploymentStrategyManager {
  constructor(
    private webAppManager: AzureWebAppManager,
    private trafficManagerManager: AzureTrafficManagerManager,
  ) {}

  // ---------------------------------------------------------------------------
  // Blue/Green via Deployment Slot Swap
  // ---------------------------------------------------------------------------

  /**
   * Execute a blue/green deployment by swapping deployment slots.
   *
   * 1. Validates the source slot exists and is running
   * 2. Optionally health-checks the source slot
   * 3. Swaps source → target (atomic zero-downtime swap)
   */
  async blueGreenSlotSwap(options: BlueGreenSlotOptions): Promise<BlueGreenSlotResult> {
    const { resourceGroup, appName, sourceSlot, targetSlot = "production" } = options;

    // 1. Validate source slot exists
    const slots = await this.webAppManager.listDeploymentSlots(resourceGroup, appName);
    const sourceExists = slots.some(
      (s) => s.name === `${appName}/${sourceSlot}` || s.name === sourceSlot,
    );
    if (!sourceExists) {
      return {
        strategy: "blue-green-slot",
        success: false,
        appName,
        sourceSlot,
        targetSlot,
        healthCheck: null,
        summary: `❌ Source slot '${sourceSlot}' not found on '${appName}'. Available slots: ${slots.map((s) => s.name).join(", ") || "(none)"}`,
        swappedAt: new Date().toISOString(),
      };
    }

    // 2. Optional health check
    let healthCheck: HealthCheckResult | null = null;
    if (options.healthCheck) {
      const slot = slots.find(
        (s) => s.name === `${appName}/${sourceSlot}` || s.name === sourceSlot,
      )!;
      const url = `https://${slot.defaultHostName}${options.healthCheckPath ?? "/"}`;
      healthCheck = await this.performHealthCheck(url, options.healthCheckTimeoutMs ?? 10_000);

      if (!healthCheck.healthy) {
        return {
          strategy: "blue-green-slot",
          success: false,
          appName,
          sourceSlot,
          targetSlot,
          healthCheck,
          summary: `❌ Pre-swap health check failed for '${sourceSlot}' (${healthCheck.error ?? `HTTP ${healthCheck.statusCode}`}). Swap aborted.`,
          swappedAt: new Date().toISOString(),
        };
      }
    }

    // 3. Perform swap
    await this.webAppManager.swapSlots(resourceGroup, appName, sourceSlot, targetSlot);

    return {
      strategy: "blue-green-slot",
      success: true,
      appName,
      sourceSlot,
      targetSlot,
      healthCheck,
      summary:
        `✅ Blue/green swap complete: '${sourceSlot}' → '${targetSlot}' on '${appName}'.` +
        `\nThe code from '${sourceSlot}' is now serving ${targetSlot} traffic.` +
        (healthCheck ? `\nPre-swap health check: ✅ ${healthCheck.responseTimeMs}ms` : ""),
      swappedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Canary via Slot Traffic Routing
  // ---------------------------------------------------------------------------

  /**
   * Set canary traffic percentage for a deployment slot.
   *
   * Routes `percentage`% of live traffic to the specified slot while the
   * remainder stays on production. Use 0% to revert all traffic to production.
   */
  async canarySlotShift(options: CanarySlotOptions): Promise<CanarySlotResult> {
    const { resourceGroup, appName, slotName, percentage } = options;

    if (percentage < 0 || percentage > 100) {
      return {
        strategy: "canary-slot",
        success: false,
        appName,
        slotName,
        percentage,
        productionPercentage: 100 - percentage,
        summary: `❌ Invalid percentage ${percentage}. Must be 0–100.`,
      };
    }

    // Validate slot exists
    const slots = await this.webAppManager.listDeploymentSlots(resourceGroup, appName);
    const slotExists = slots.some(
      (s) => s.name === `${appName}/${slotName}` || s.name === slotName,
    );
    if (!slotExists) {
      return {
        strategy: "canary-slot",
        success: false,
        appName,
        slotName,
        percentage,
        productionPercentage: 100 - percentage,
        summary: `❌ Slot '${slotName}' not found on '${appName}'. Available: ${slots.map((s) => s.name).join(", ") || "(none)"}`,
      };
    }

    // Set traffic percentage (0% clears routing rules → all traffic to production)
    if (percentage === 0) {
      await this.webAppManager.setSlotTrafficPercentage(resourceGroup, appName, {
        routingRules: [],
      });
    } else {
      await this.webAppManager.setSlotTrafficPercentage(resourceGroup, appName, {
        routingRules: [{ slotName, reroutePercentage: percentage }],
      });
    }

    const productionPct = 100 - percentage;
    return {
      strategy: "canary-slot",
      success: true,
      appName,
      slotName,
      percentage,
      productionPercentage: productionPct,
      summary:
        percentage === 0
          ? `✅ Canary reverted: all traffic for '${appName}' now goes to production.`
          : `✅ Canary active: ${percentage}% → '${slotName}', ${productionPct}% → production on '${appName}'.`,
    };
  }

  // ---------------------------------------------------------------------------
  // Traffic Manager Weighted Shifting
  // ---------------------------------------------------------------------------

  /**
   * Shift traffic across Traffic Manager endpoints by updating weights.
   *
   * Validates the profile uses Weighted routing, then updates each endpoint's
   * weight. Useful for cross-region blue/green deployments.
   */
  async trafficManagerShift(options: TrafficManagerShiftOptions): Promise<TrafficManagerShiftResult> {
    const { resourceGroup, profileName, weights } = options;

    // Validate profile exists and uses Weighted routing
    const profile = await this.trafficManagerManager.getProfile(resourceGroup, profileName);
    if (!profile) {
      return {
        strategy: "traffic-manager-weighted",
        success: false,
        profileName,
        endpoints: [],
        summary: `❌ Traffic Manager profile '${profileName}' not found in resource group '${resourceGroup}'.`,
      };
    }

    if (profile.trafficRoutingMethod !== "Weighted") {
      return {
        strategy: "traffic-manager-weighted",
        success: false,
        profileName,
        endpoints: [],
        summary: `❌ Profile '${profileName}' uses '${profile.trafficRoutingMethod}' routing. Traffic weight shifting requires 'Weighted' routing method.`,
      };
    }

    // Validate all weights are in range 1–1000
    for (const w of weights) {
      if (w.weight < 1 || w.weight > 1000) {
        return {
          strategy: "traffic-manager-weighted",
          success: false,
          profileName,
          endpoints: [],
          summary: `❌ Invalid weight ${w.weight} for endpoint '${w.endpointName}'. Must be 1–1000.`,
        };
      }
    }

    // Update each endpoint's weight
    const updatedEndpoints: TrafficManagerShiftResult["endpoints"] = [];
    for (const w of weights) {
      const ep = await this.trafficManagerManager.updateEndpointWeight({
        resourceGroup,
        profileName,
        endpointType: w.endpointType,
        endpointName: w.endpointName,
        weight: w.weight,
      });
      updatedEndpoints.push({
        name: ep.name,
        weight: ep.weight ?? w.weight,
        target: ep.target ?? ep.targetResourceId,
        status: ep.endpointStatus,
      });
    }

    const totalWeight = updatedEndpoints.reduce((s, e) => s + (e.weight ?? 0), 0);
    const summary = updatedEndpoints
      .map((e) => `• ${e.name}: weight ${e.weight} (${Math.round(((e.weight ?? 0) / totalWeight) * 100)}%)`)
      .join("\n");

    return {
      strategy: "traffic-manager-weighted",
      success: true,
      profileName,
      endpoints: updatedEndpoints,
      summary: `✅ Traffic Manager weights updated for '${profileName}':\n${summary}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Deployment Status
  // ---------------------------------------------------------------------------

  /**
   * Get aggregated deployment status for a web app: slots, traffic routing,
   * and optionally Traffic Manager profile info.
   */
  async getDeploymentStatus(
    resourceGroup: string,
    appName: string,
    trafficManagerProfile?: { profileName: string },
  ): Promise<DeploymentStatus> {
    // Fetch slots + traffic routing concurrently
    const [slots, trafficConfig] = await Promise.all([
      this.webAppManager.listDeploymentSlots(resourceGroup, appName),
      this.webAppManager.getSlotTrafficPercentage(resourceGroup, appName),
    ]);

    const slotRouting =
      trafficConfig.routingRules.length > 0
        ? {
            productionPercentage:
              100 - trafficConfig.routingRules.reduce((s, r) => s + r.reroutePercentage, 0),
            rules: trafficConfig.routingRules.map((r) => ({
              slotName: r.slotName,
              percentage: r.reroutePercentage,
            })),
          }
        : null;

    const status: DeploymentStatus = {
      appName,
      resourceGroup,
      slotRouting,
      slots: slots.map((s) => ({
        name: s.name,
        state: s.state,
        hostName: s.defaultHostName,
      })),
    };

    // Optionally fetch Traffic Manager info
    if (trafficManagerProfile) {
      const profile = await this.trafficManagerManager.getProfile(
        resourceGroup,
        trafficManagerProfile.profileName,
      );
      if (profile) {
        const endpoints = await this.trafficManagerManager.listEndpoints(
          resourceGroup,
          trafficManagerProfile.profileName,
        );
        status.trafficManager = {
          profileName: profile.name,
          routingMethod: profile.trafficRoutingMethod ?? "Unknown",
          endpoints: endpoints.map((e) => ({
            name: e.name,
            weight: e.weight,
            target: e.target ?? e.targetResourceId,
            status: e.endpointStatus,
          })),
        };
      }
    }

    return status;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async performHealthCheck(url: string, timeoutMs: number): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      const elapsed = Date.now() - start;

      return {
        url,
        statusCode: response.status,
        healthy: response.status >= 200 && response.status < 400,
        responseTimeMs: elapsed,
      };
    } catch (error) {
      return {
        url,
        statusCode: null,
        healthy: false,
        responseTimeMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function createDeploymentStrategyManager(
  webAppManager: AzureWebAppManager,
  trafficManagerManager: AzureTrafficManagerManager,
): AzureDeploymentStrategyManager {
  return new AzureDeploymentStrategyManager(webAppManager, trafficManagerManager);
}
