/**
 * Azure App Service (Web Apps) Manager
 *
 * Manages Azure Web Apps, App Service Plans, and deployment slots
 * via @azure/arm-appservice. Shares the same SDK as Functions but
 * filters for web app kinds (excludes functionapp).
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { WebApp, AppServicePlan, DeploymentSlot, WebAppConfig } from "./types.js";

export class AzureWebAppManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    retryOptions?: AzureRetryOptions,
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions ?? {};
  }

  private async getClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { WebSiteManagementClient } = await import("@azure/arm-appservice");
    return new WebSiteManagementClient(credential, this.subscriptionId);
  }

  private extractResourceGroup(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i);
    return match ? match[1] : "";
  }

  // ---------------------------------------------------------------------------
  // Web Apps
  // ---------------------------------------------------------------------------

  /** List web apps (excludes function apps). */
  async listWebApps(resourceGroup?: string): Promise<WebApp[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const apps: WebApp[] = [];
      const iter = resourceGroup
        ? client.webApps.listByResourceGroup(resourceGroup)
        : client.webApps.list();

      for await (const app of iter) {
        // Skip function apps — those belong to the Functions manager
        if (app.kind?.includes("functionapp")) continue;
        apps.push({
          id: app.id ?? "",
          name: app.name ?? "",
          resourceGroup: this.extractResourceGroup(app.id ?? ""),
          location: app.location ?? "",
          state: (app.state as WebApp["state"]) ?? "Unknown",
          kind: app.kind ?? "",
          defaultHostName: app.defaultHostName ?? "",
          httpsOnly: app.httpsOnly ?? false,
          enabled: app.enabled ?? true,
          appServicePlanId: app.serverFarmId,
          outboundIpAddresses: app.outboundIpAddresses,
          linuxFxVersion: app.siteConfig?.linuxFxVersion,
          tags: app.tags as Record<string, string>,
        });
      }
      return apps;
    }, this.retryOptions);
  }

  /** Get a specific web app. */
  async getWebApp(resourceGroup: string, name: string): Promise<WebApp | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const app = await client.webApps.get(resourceGroup, name);
        if (app.kind?.includes("functionapp")) return null;
        return {
          id: app.id ?? "",
          name: app.name ?? "",
          resourceGroup,
          location: app.location ?? "",
          state: (app.state as WebApp["state"]) ?? "Unknown",
          kind: app.kind ?? "",
          defaultHostName: app.defaultHostName ?? "",
          httpsOnly: app.httpsOnly ?? false,
          enabled: app.enabled ?? true,
          appServicePlanId: app.serverFarmId,
          outboundIpAddresses: app.outboundIpAddresses,
          linuxFxVersion: app.siteConfig?.linuxFxVersion,
          tags: app.tags as Record<string, string>,
        };
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Start a web app. */
  async startWebApp(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(() => client.webApps.start(resourceGroup, name), this.retryOptions);
  }

  /** Stop a web app. */
  async stopWebApp(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(() => client.webApps.stop(resourceGroup, name), this.retryOptions);
  }

  /** Restart a web app. */
  async restartWebApp(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(() => client.webApps.restart(resourceGroup, name), this.retryOptions);
  }

  /** Delete a web app. */
  async deleteWebApp(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(() => client.webApps.delete(resourceGroup, name), this.retryOptions);
  }

  /** Get web app configuration details. */
  async getWebAppConfig(resourceGroup: string, name: string): Promise<WebAppConfig | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const config = await client.webApps.getConfiguration(resourceGroup, name);
        return {
          linuxFxVersion: config.linuxFxVersion,
          windowsFxVersion: config.windowsFxVersion,
          javaVersion: config.javaVersion,
          nodeVersion: config.nodeVersion,
          pythonVersion: config.pythonVersion,
          phpVersion: config.phpVersion,
          dotnetVersion: config.netFrameworkVersion,
          alwaysOn: config.alwaysOn,
          ftpsState: config.ftpsState,
          http20Enabled: config.http20Enabled,
          minTlsVersion: config.minTlsVersion,
          numberOfWorkers: config.numberOfWorkers,
        };
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // App Service Plans
  // ---------------------------------------------------------------------------

  /** List App Service Plans. */
  async listAppServicePlans(resourceGroup?: string): Promise<AppServicePlan[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const plans: AppServicePlan[] = [];
      const iter = resourceGroup
        ? client.appServicePlans.listByResourceGroup(resourceGroup)
        : client.appServicePlans.list();

      for await (const plan of iter) {
        plans.push({
          id: plan.id ?? "",
          name: plan.name ?? "",
          resourceGroup: this.extractResourceGroup(plan.id ?? ""),
          location: plan.location ?? "",
          kind: plan.kind ?? "",
          sku: plan.sku?.name ?? "",
          tier: plan.sku?.tier ?? "",
          capacity: plan.sku?.capacity ?? 0,
          numberOfSites: plan.numberOfSites ?? 0,
          provisioningState: plan.provisioningState,
          reserved: plan.reserved ?? false,
          tags: plan.tags as Record<string, string>,
        });
      }
      return plans;
    }, this.retryOptions);
  }

  /** Get a specific App Service Plan. */
  async getAppServicePlan(resourceGroup: string, name: string): Promise<AppServicePlan | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const plan = await client.appServicePlans.get(resourceGroup, name);
        return {
          id: plan.id ?? "",
          name: plan.name ?? "",
          resourceGroup,
          location: plan.location ?? "",
          kind: plan.kind ?? "",
          sku: plan.sku?.name ?? "",
          tier: plan.sku?.tier ?? "",
          capacity: plan.sku?.capacity ?? 0,
          numberOfSites: plan.numberOfSites ?? 0,
          provisioningState: plan.provisioningState,
          reserved: plan.reserved ?? false,
          tags: plan.tags as Record<string, string>,
        };
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Deployment Slots
  // ---------------------------------------------------------------------------

  /** List deployment slots for a web app. */
  async listDeploymentSlots(resourceGroup: string, appName: string): Promise<DeploymentSlot[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const slots: DeploymentSlot[] = [];
      for await (const slot of client.webApps.listSlots(resourceGroup, appName)) {
        slots.push({
          id: slot.id ?? "",
          name: slot.name ?? "",
          resourceGroup,
          location: slot.location ?? "",
          state: slot.state ?? "Unknown",
          defaultHostName: slot.defaultHostName ?? "",
          tags: slot.tags as Record<string, string>,
        });
      }
      return slots;
    }, this.retryOptions);
  }

  /** Swap deployment slots. */
  async swapSlots(
    resourceGroup: string,
    appName: string,
    sourceSlot: string,
    targetSlot: string,
  ): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.webApps.beginSwapSlotAndWait(resourceGroup, appName, sourceSlot, {
        targetSlot,
        preserveVnet: true,
      }),
      this.retryOptions,
    );
  }
}

export function createWebAppManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureWebAppManager {
  return new AzureWebAppManager(credentialsManager, subscriptionId, retryOptions);
}
