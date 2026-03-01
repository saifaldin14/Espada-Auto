/**
 * Azure Traffic Manager Manager
 *
 * Manages Traffic Manager profiles and endpoints via @azure/arm-trafficmanager.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  TrafficManagerProfile,
  TrafficManagerEndpoint,
  CreateTrafficManagerProfileOptions,
  CreateOrUpdateEndpointOptions,
  UpdateEndpointWeightOptions,
} from "./types.js";

export class AzureTrafficManagerManager {
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
    const { TrafficManagerManagementClient } = await import("@azure/arm-trafficmanager");
    return new TrafficManagerManagementClient(credential, this.subscriptionId);
  }

  private extractResourceGroup(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i);
    return match ? match[1] : "";
  }

  // ---------------------------------------------------------------------------
  // Traffic Manager Profiles
  // ---------------------------------------------------------------------------

  /** List Traffic Manager profiles. */
  async listProfiles(resourceGroup?: string): Promise<TrafficManagerProfile[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const profiles: TrafficManagerProfile[] = [];
      const iter = resourceGroup
        ? client.profiles.listByResourceGroup(resourceGroup)
        : client.profiles.listBySubscription();

      for await (const p of iter) {
        profiles.push(this.mapProfile(p));
      }
      return profiles;
    }, this.retryOptions);
  }

  /** Get a specific Traffic Manager profile. */
  async getProfile(resourceGroup: string, name: string): Promise<TrafficManagerProfile | null> {
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

  /** Delete a Traffic Manager profile. */
  async deleteProfile(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.profiles.delete(resourceGroup, name),
      this.retryOptions,
    );
  }

  // ---------------------------------------------------------------------------
  // Traffic Manager Endpoints
  // ---------------------------------------------------------------------------

  /** List endpoints for a Traffic Manager profile. */
  async listEndpoints(resourceGroup: string, profileName: string): Promise<TrafficManagerEndpoint[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      // SDK does not have a direct listEndpoints on the profile; endpoints are
      // nested on the profile itself, so we fetch the profile and return them.
      const profile = await client.profiles.get(resourceGroup, profileName);
      return (profile.endpoints ?? []).map((ep): TrafficManagerEndpoint => ({
        id: ep.id ?? "",
        name: ep.name ?? "",
        type: ep.type ?? "",
        endpointStatus: ep.endpointStatus,
        endpointMonitorStatus: ep.endpointMonitorStatus,
        target: ep.target,
        targetResourceId: ep.targetResourceId,
        weight: ep.weight,
        priority: ep.priority,
        endpointLocation: ep.endpointLocation,
        minChildEndpoints: ep.minChildEndpoints,
        minChildEndpointsIPv4: ep.minChildEndpointsIPv4,
        minChildEndpointsIPv6: ep.minChildEndpointsIPv6,
      }));
    }, this.retryOptions);
  }

  /** Get a specific endpoint within a profile. */
  async getEndpoint(
    resourceGroup: string,
    profileName: string,
    endpointType: "AzureEndpoints" | "ExternalEndpoints" | "NestedEndpoints",
    endpointName: string,
  ): Promise<TrafficManagerEndpoint | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const ep = await client.endpoints.get(resourceGroup, profileName, endpointType, endpointName);
        return {
          id: ep.id ?? "",
          name: ep.name ?? "",
          type: ep.type ?? "",
          endpointStatus: ep.endpointStatus,
          endpointMonitorStatus: ep.endpointMonitorStatus,
          target: ep.target,
          targetResourceId: ep.targetResourceId,
          weight: ep.weight,
          priority: ep.priority,
          endpointLocation: ep.endpointLocation,
          minChildEndpoints: ep.minChildEndpoints,
          minChildEndpointsIPv4: ep.minChildEndpointsIPv4,
          minChildEndpointsIPv6: ep.minChildEndpointsIPv6,
        };
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete an endpoint from a profile. */
  async deleteEndpoint(
    resourceGroup: string,
    profileName: string,
    endpointType: "AzureEndpoints" | "ExternalEndpoints" | "NestedEndpoints",
    endpointName: string,
  ): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.endpoints.delete(resourceGroup, profileName, endpointType, endpointName),
      this.retryOptions,
    );
  }

  // ---------------------------------------------------------------------------
  // Mutating operations for deployment strategies
  // ---------------------------------------------------------------------------

  /** Create a new Traffic Manager profile. */
  async createProfile(options: CreateTrafficManagerProfileOptions): Promise<TrafficManagerProfile> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const result = await client.profiles.createOrUpdate(
        options.resourceGroup,
        options.name,
        {
          location: "global",
          trafficRoutingMethod: options.trafficRoutingMethod,
          dnsConfig: {
            relativeName: options.relativeDnsName,
            ttl: options.ttl ?? 30,
          },
          monitorConfig: {
            protocol: options.monitorProtocol ?? "HTTPS",
            port: options.monitorPort ?? 443,
            path: options.monitorPath ?? "/",
          },
          tags: options.tags,
        },
      );
      return this.mapProfile(result, options.resourceGroup);
    }, this.retryOptions);
  }

  /** Create or update an endpoint within a Traffic Manager profile. */
  async createOrUpdateEndpoint(options: CreateOrUpdateEndpointOptions): Promise<TrafficManagerEndpoint> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const ep = await client.endpoints.createOrUpdate(
        options.resourceGroup,
        options.profileName,
        options.endpointType,
        options.endpointName,
        {
          target: options.target,
          targetResourceId: options.targetResourceId,
          weight: options.weight,
          priority: options.priority,
          endpointStatus: options.endpointStatus ?? "Enabled",
          endpointLocation: options.endpointLocation,
        },
      );
      return {
        id: ep.id ?? "",
        name: ep.name ?? "",
        type: ep.type ?? "",
        endpointStatus: ep.endpointStatus,
        endpointMonitorStatus: ep.endpointMonitorStatus,
        target: ep.target,
        targetResourceId: ep.targetResourceId,
        weight: ep.weight,
        priority: ep.priority,
        endpointLocation: ep.endpointLocation,
        minChildEndpoints: ep.minChildEndpoints,
        minChildEndpointsIPv4: ep.minChildEndpointsIPv4,
        minChildEndpointsIPv6: ep.minChildEndpointsIPv6,
      };
    }, this.retryOptions);
  }

  /** Update the weight of a single endpoint (for traffic shifting). */
  async updateEndpointWeight(options: UpdateEndpointWeightOptions): Promise<TrafficManagerEndpoint> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const existing = await client.endpoints.get(
        options.resourceGroup,
        options.profileName,
        options.endpointType,
        options.endpointName,
      );
      const ep = await client.endpoints.createOrUpdate(
        options.resourceGroup,
        options.profileName,
        options.endpointType,
        options.endpointName,
        {
          ...existing,
          weight: options.weight,
        },
      );
      return {
        id: ep.id ?? "",
        name: ep.name ?? "",
        type: ep.type ?? "",
        endpointStatus: ep.endpointStatus,
        endpointMonitorStatus: ep.endpointMonitorStatus,
        target: ep.target,
        targetResourceId: ep.targetResourceId,
        weight: ep.weight,
        priority: ep.priority,
        endpointLocation: ep.endpointLocation,
        minChildEndpoints: ep.minChildEndpoints,
        minChildEndpointsIPv4: ep.minChildEndpointsIPv4,
        minChildEndpointsIPv6: ep.minChildEndpointsIPv6,
      };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private mapProfile(p: unknown, rg?: string): TrafficManagerProfile {
    const profile = p as {
      id?: string; name?: string; location?: string;
      profileStatus?: string; trafficRoutingMethod?: string;
      maxReturn?: number; provisioningState?: string;
      dnsConfig?: { relativeName?: string; fqdn?: string; ttl?: number };
      monitorConfig?: {
        profileMonitorStatus?: string; protocol?: string; port?: number;
        path?: string; intervalInSeconds?: number; timeoutInSeconds?: number;
        toleratedNumberOfFailures?: number;
      };
      tags?: Record<string, string>;
    };

    return {
      id: profile.id ?? "",
      name: profile.name ?? "",
      resourceGroup: rg ?? this.extractResourceGroup(profile.id ?? ""),
      location: profile.location ?? "global",
      profileStatus: profile.profileStatus,
      trafficRoutingMethod: profile.trafficRoutingMethod,
      dnsConfig: profile.dnsConfig
        ? {
            relativeName: profile.dnsConfig.relativeName,
            fqdn: profile.dnsConfig.fqdn,
            ttl: profile.dnsConfig.ttl,
          }
        : undefined,
      monitorConfig: profile.monitorConfig
        ? {
            profileMonitorStatus: profile.monitorConfig.profileMonitorStatus,
            protocol: profile.monitorConfig.protocol,
            port: profile.monitorConfig.port,
            path: profile.monitorConfig.path,
            intervalInSeconds: profile.monitorConfig.intervalInSeconds,
            timeoutInSeconds: profile.monitorConfig.timeoutInSeconds,
            toleratedNumberOfFailures: profile.monitorConfig.toleratedNumberOfFailures,
          }
        : undefined,
      maxReturn: profile.maxReturn,
      provisioningState: profile.provisioningState,
      tags: profile.tags as Record<string, string>,
    };
  }
}

export function createTrafficManagerManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureTrafficManagerManager {
  return new AzureTrafficManagerManager(credentialsManager, subscriptionId, retryOptions);
}
