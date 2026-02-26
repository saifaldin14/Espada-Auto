/**
 * Azure Spring Apps manager.
 *
 * Provides operations for managing Azure Spring Apps services,
 * apps, and deployments.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  AzureSpringApp,
  AzureSpringAppDeployment,
  AzureSpringDeployment,
} from "./types.js";

export class AzureSpringAppsManager {
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

  private extractResourceGroup(resourceId?: string): string {
    if (!resourceId) return "";
    const match = resourceId.match(/\/resourceGroups\/([^/]+)/i);
    return match?.[1] ?? "";
  }

  private async getClient() {
    const { AppPlatformManagementClient } = await import("@azure/arm-appplatform");
    const { credential } = await this.credentialsManager.getCredential();
    return new AppPlatformManagementClient(credential, this.subscriptionId);
  }

  // ---------------------------------------------------------------------------
  // Service operations
  // ---------------------------------------------------------------------------

  /** List Spring Apps services, optionally filtered by resource group. */
  async listServices(resourceGroup?: string): Promise<AzureSpringApp[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: AzureSpringApp[] = [];
      const iter = resourceGroup
        ? client.services.list(resourceGroup)
        : client.services.listBySubscription();
      for await (const s of iter) {
        results.push(this.mapService(s));
      }
      return results;
    }, this.retryOptions);
  }

  /** Get a single Spring Apps service. Returns null if not found. */
  async getService(resourceGroup: string, serviceName: string): Promise<AzureSpringApp | null> {
    return withAzureRetry(async () => {
      try {
        const client = await this.getClient();
        const svc = await client.services.get(resourceGroup, serviceName);
        return this.mapService(svc);
      } catch (error: unknown) {
        if ((error as { statusCode?: number }).statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete a Spring Apps service. */
  async deleteService(resourceGroup: string, serviceName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.services.beginDeleteAndWait(resourceGroup, serviceName);
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // App operations
  // ---------------------------------------------------------------------------

  /** List apps in a Spring Apps service. */
  async listApps(resourceGroup: string, serviceName: string): Promise<AzureSpringAppDeployment[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: AzureSpringAppDeployment[] = [];
      for await (const app of client.apps.list(resourceGroup, serviceName)) {
        results.push(this.mapApp(app));
      }
      return results;
    }, this.retryOptions);
  }

  /** Get a single app. Returns null if not found. */
  async getApp(resourceGroup: string, serviceName: string, appName: string): Promise<AzureSpringAppDeployment | null> {
    return withAzureRetry(async () => {
      try {
        const client = await this.getClient();
        const app = await client.apps.get(resourceGroup, serviceName, appName);
        return this.mapApp(app);
      } catch (error: unknown) {
        if ((error as { statusCode?: number }).statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Deployment operations
  // ---------------------------------------------------------------------------

  /** List deployments for an app. */
  async listDeployments(resourceGroup: string, serviceName: string, appName: string): Promise<AzureSpringDeployment[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: AzureSpringDeployment[] = [];
      for await (const d of client.deployments.list(resourceGroup, serviceName, appName)) {
        results.push(this.mapDeployment(d));
      }
      return results;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Mapping helpers
  // ---------------------------------------------------------------------------

  private mapService(s: unknown): AzureSpringApp {
    const typed = s as {
      id?: string; name?: string; location?: string;
      properties?: {
        provisioningState?: string;
        version?: number;
        serviceId?: string;
        networkProfile?: { serviceRuntimeSubnetId?: string; appSubnetId?: string; outboundType?: string };
        fqdn?: string;
        powerState?: string;
        zoneRedundant?: boolean;
      };
      sku?: { name?: string; tier?: string };
      tags?: Record<string, string>;
    };
    return {
      id: typed.id ?? "",
      name: typed.name ?? "",
      resourceGroup: this.extractResourceGroup(typed.id),
      location: typed.location ?? "",
      provisioningState: typed.properties?.provisioningState,
      skuName: typed.sku?.name,
      skuTier: typed.sku?.tier,
      version: typed.properties?.version,
      serviceId: typed.properties?.serviceId,
      networkProfile: typed.properties?.networkProfile,
      fqdn: typed.properties?.fqdn,
      powerState: typed.properties?.powerState,
      zoneRedundant: typed.properties?.zoneRedundant,
      tags: typed.tags ?? {},
    };
  }

  private mapApp(app: unknown): AzureSpringAppDeployment {
    const typed = app as {
      id?: string; name?: string; location?: string;
      properties?: {
        provisioningState?: string;
        activeDeploymentName?: string;
        url?: string;
        httpsOnly?: boolean;
        public?: boolean;
        fqdn?: string;
        temporaryDisk?: { sizeInGB?: number; mountPath?: string };
        persistentDisk?: { sizeInGB?: number; mountPath?: string; usedInGB?: number };
      };
    };
    return {
      id: typed.id ?? "",
      name: typed.name ?? "",
      resourceGroup: this.extractResourceGroup(typed.id),
      location: typed.location ?? "",
      provisioningState: typed.properties?.provisioningState,
      activeDeploymentName: typed.properties?.activeDeploymentName,
      url: typed.properties?.url,
      httpsOnly: typed.properties?.httpsOnly,
      isPublic: typed.properties?.public,
      fqdn: typed.properties?.fqdn,
      temporaryDisk: typed.properties?.temporaryDisk,
      persistentDisk: typed.properties?.persistentDisk,
    };
  }

  private mapDeployment(d: unknown): AzureSpringDeployment {
    const typed = d as {
      id?: string; name?: string;
      properties?: {
        provisioningState?: string;
        status?: string;
        active?: boolean;
        instances?: Array<{
          name?: string; status?: string;
          discoveryStatus?: string; startTime?: string;
          zone?: string;
        }>;
      };
    };
    return {
      id: typed.id ?? "",
      name: typed.name ?? "",
      provisioningState: typed.properties?.provisioningState,
      status: typed.properties?.status,
      active: typed.properties?.active,
      instances: typed.properties?.instances?.map((i) => ({
        name: i.name,
        status: i.status,
        discoveryStatus: i.discoveryStatus,
        startTime: i.startTime,
        zone: i.zone,
      })),
    };
  }
}

/** Factory function for creating a Spring Apps manager. */
export function createSpringAppsManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureSpringAppsManager {
  return new AzureSpringAppsManager(credentialsManager, subscriptionId, retryOptions);
}
