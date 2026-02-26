/**
 * Azure Front Door Manager
 *
 * Manages Azure Front Door profiles, endpoints, origin groups, origins,
 * and routes via @azure/arm-cdn (AFD Standard/Premium shares the CDN SDK).
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  FrontDoorProfile,
  FrontDoorEndpoint,
  FrontDoorOriginGroup,
  FrontDoorOrigin,
  FrontDoorRoute,
} from "./types.js";

export class AzureFrontDoorManager {
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
    const { CdnManagementClient } = await import("@azure/arm-cdn");
    return new CdnManagementClient(credential, this.subscriptionId);
  }

  private extractResourceGroup(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i);
    return match ? match[1] : "";
  }

  // ---------------------------------------------------------------------------
  // Profiles
  // ---------------------------------------------------------------------------

  /** List Front Door profiles (AFD Standard/Premium). */
  async listProfiles(resourceGroup?: string): Promise<FrontDoorProfile[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const profiles: FrontDoorProfile[] = [];
      const iter = resourceGroup
        ? client.profiles.listByResourceGroup(resourceGroup)
        : client.profiles.list();

      for await (const p of iter) {
        // AFD profiles have sku.name containing "Standard_AzureFrontDoor" or "Premium_AzureFrontDoor"
        if (p.sku?.name?.includes("AzureFrontDoor")) {
          profiles.push(this.mapProfile(p));
        }
      }
      return profiles;
    }, this.retryOptions);
  }

  /** Get a specific Front Door profile. */
  async getProfile(resourceGroup: string, name: string): Promise<FrontDoorProfile | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const p = await client.profiles.get(resourceGroup, name);
        return this.mapProfile(p, resourceGroup);
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete a Front Door profile. */
  async deleteProfile(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.profiles.beginDeleteAndWait(resourceGroup, name),
      this.retryOptions,
    );
  }

  // ---------------------------------------------------------------------------
  // Endpoints
  // ---------------------------------------------------------------------------

  /** List AFD endpoints for a profile. */
  async listEndpoints(resourceGroup: string, profileName: string): Promise<FrontDoorEndpoint[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const endpoints: FrontDoorEndpoint[] = [];
      for await (const ep of client.afdEndpoints.listByProfile(resourceGroup, profileName)) {
        endpoints.push({
          id: ep.id ?? "",
          name: ep.name ?? "",
          hostName: ep.hostName,
          provisioningState: ep.provisioningState,
          deploymentStatus: ep.deploymentStatus,
          enabledState: ep.enabledState,
        });
      }
      return endpoints;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Origin Groups
  // ---------------------------------------------------------------------------

  /** List origin groups for a profile. */
  async listOriginGroups(resourceGroup: string, profileName: string): Promise<FrontDoorOriginGroup[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const groups: FrontDoorOriginGroup[] = [];
      for await (const og of client.afdOriginGroups.listByProfile(resourceGroup, profileName)) {
        groups.push({
          id: og.id ?? "",
          name: og.name ?? "",
          provisioningState: og.provisioningState,
          deploymentStatus: og.deploymentStatus,
          healthProbeSettings: og.healthProbeSettings
            ? {
                probePath: og.healthProbeSettings.probePath,
                probeRequestType: og.healthProbeSettings.probeRequestType,
                probeProtocol: og.healthProbeSettings.probeProtocol,
                probeIntervalInSeconds: og.healthProbeSettings.probeIntervalInSeconds,
              }
            : undefined,
          sessionAffinityState: og.sessionAffinityState,
        });
      }
      return groups;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Origins
  // ---------------------------------------------------------------------------

  /** List origins within an origin group. */
  async listOrigins(
    resourceGroup: string,
    profileName: string,
    originGroupName: string,
  ): Promise<FrontDoorOrigin[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const origins: FrontDoorOrigin[] = [];
      for await (const o of client.afdOrigins.listByOriginGroup(resourceGroup, profileName, originGroupName)) {
        origins.push({
          id: o.id ?? "",
          name: o.name ?? "",
          hostName: o.hostName,
          httpPort: o.httpPort,
          httpsPort: o.httpsPort,
          originHostHeader: o.originHostHeader,
          priority: o.priority,
          weight: o.weight,
          enabledState: o.enabledState,
          provisioningState: o.provisioningState,
          deploymentStatus: o.deploymentStatus,
        });
      }
      return origins;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  /** List routes for an AFD endpoint. */
  async listRoutes(
    resourceGroup: string,
    profileName: string,
    endpointName: string,
  ): Promise<FrontDoorRoute[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const routes: FrontDoorRoute[] = [];
      for await (const r of client.routes.listByEndpoint(resourceGroup, profileName, endpointName)) {
        routes.push({
          id: r.id ?? "",
          name: r.name ?? "",
          provisioningState: r.provisioningState,
          deploymentStatus: r.deploymentStatus,
          enabledState: r.enabledState,
          patternsToMatch: r.patternsToMatch ?? [],
          forwardingProtocol: r.forwardingProtocol,
          httpsRedirect: r.httpsRedirect,
          originGroupId: r.originGroup?.id,
        });
      }
      return routes;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private mapProfile(p: unknown, rg?: string): FrontDoorProfile {
    const profile = p as {
      id?: string; name?: string; location?: string;
      sku?: { name?: string };
      provisioningState?: string; resourceState?: string;
      frontDoorId?: string;
      originResponseTimeoutSeconds?: number;
      tags?: Record<string, string>;
    };

    return {
      id: profile.id ?? "",
      name: profile.name ?? "",
      resourceGroup: rg ?? this.extractResourceGroup(profile.id ?? ""),
      location: profile.location ?? "global",
      skuName: profile.sku?.name,
      provisioningState: profile.provisioningState,
      resourceState: profile.resourceState,
      frontDoorId: profile.frontDoorId,
      originResponseTimeoutSeconds: profile.originResponseTimeoutSeconds,
      tags: profile.tags as Record<string, string>,
    };
  }
}

export function createFrontDoorManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureFrontDoorManager {
  return new AzureFrontDoorManager(credentialsManager, subscriptionId, retryOptions);
}
