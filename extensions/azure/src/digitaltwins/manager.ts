/**
 * Azure Digital Twins manager.
 *
 * Provides operations for managing Azure Digital Twins instances,
 * endpoints, and private endpoint connections.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  AzureDigitalTwinsInstance,
  AzureDigitalTwinsEndpoint,
  AzureDigitalTwinsPrivateEndpoint,
} from "./types.js";

export class AzureDigitalTwinsManager {
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
    const { AzureDigitalTwinsManagementClient } = await import("@azure/arm-digitaltwins");
    const { credential } = await this.credentialsManager.getCredential();
    return new AzureDigitalTwinsManagementClient(credential, this.subscriptionId);
  }

  // ---------------------------------------------------------------------------
  // Instance operations
  // ---------------------------------------------------------------------------

  /** List Digital Twins instances, optionally filtered by resource group. */
  async listInstances(resourceGroup?: string): Promise<AzureDigitalTwinsInstance[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: AzureDigitalTwinsInstance[] = [];
      const iter = resourceGroup
        ? client.digitalTwins.listByResourceGroup(resourceGroup)
        : client.digitalTwins.list();
      for await (const dt of iter) {
        results.push(this.mapInstance(dt));
      }
      return results;
    }, this.retryOptions);
  }

  /** Get a single Digital Twins instance. Returns null if not found. */
  async getInstance(resourceGroup: string, instanceName: string): Promise<AzureDigitalTwinsInstance | null> {
    return withAzureRetry(async () => {
      try {
        const client = await this.getClient();
        const dt = await client.digitalTwins.get(resourceGroup, instanceName);
        return this.mapInstance(dt);
      } catch (error: unknown) {
        if ((error as { statusCode?: number }).statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete a Digital Twins instance. */
  async deleteInstance(resourceGroup: string, instanceName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.digitalTwins.beginDeleteAndWait(resourceGroup, instanceName);
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Endpoint operations
  // ---------------------------------------------------------------------------

  /** List endpoints for a Digital Twins instance. */
  async listEndpoints(resourceGroup: string, instanceName: string): Promise<AzureDigitalTwinsEndpoint[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: AzureDigitalTwinsEndpoint[] = [];
      for await (const ep of client.digitalTwinsEndpoint.list(resourceGroup, instanceName)) {
        results.push(this.mapEndpoint(ep));
      }
      return results;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Private endpoint connections
  // ---------------------------------------------------------------------------

  /** List private endpoint connections for a Digital Twins instance. */
  async listPrivateEndpoints(resourceGroup: string, instanceName: string): Promise<AzureDigitalTwinsPrivateEndpoint[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const resp = await client.privateEndpointConnections.list(resourceGroup, instanceName);
      const items = (resp as unknown as { value?: unknown[] }).value ?? [];
      return items.map((pe) => {
        const typed = pe as {
          id?: string; name?: string;
          properties?: {
            privateEndpoint?: { id?: string };
            privateLinkServiceConnectionState?: { status?: string };
            provisioningState?: string;
            groupIds?: string[];
          };
        };
        return {
          id: typed.id ?? "",
          name: typed.name ?? "",
          privateEndpointId: typed.properties?.privateEndpoint?.id,
          connectionState: typed.properties?.privateLinkServiceConnectionState?.status,
          provisioningState: typed.properties?.provisioningState,
          groupIds: typed.properties?.groupIds,
        };
      });
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Mapping helpers
  // ---------------------------------------------------------------------------

  private mapInstance(dt: unknown): AzureDigitalTwinsInstance {
    const typed = dt as {
      id?: string; name?: string; location?: string;
      provisioningState?: string;
      hostName?: string;
      publicNetworkAccess?: string;
      createdTime?: string;
      lastUpdatedTime?: string;
      tags?: Record<string, string>;
    };
    return {
      id: typed.id ?? "",
      name: typed.name ?? "",
      resourceGroup: this.extractResourceGroup(typed.id),
      location: typed.location ?? "",
      provisioningState: typed.provisioningState,
      hostName: typed.hostName,
      publicNetworkAccess: typed.publicNetworkAccess,
      createdTime: typed.createdTime,
      lastUpdatedTime: typed.lastUpdatedTime,
      tags: typed.tags ?? {},
    };
  }

  private mapEndpoint(ep: unknown): AzureDigitalTwinsEndpoint {
    const typed = ep as {
      id?: string; name?: string;
      properties?: {
        endpointType?: string;
        provisioningState?: string;
        createdTime?: string;
        authenticationType?: string;
        deadLetterSecret?: string;
      };
    };
    return {
      id: typed.id ?? "",
      name: typed.name ?? "",
      endpointType: typed.properties?.endpointType,
      provisioningState: typed.properties?.provisioningState,
      createdTime: typed.properties?.createdTime,
      authenticationType: typed.properties?.authenticationType,
      deadLetterSecret: typed.properties?.deadLetterSecret,
    };
  }
}

/** Factory function for creating a Digital Twins manager. */
export function createDigitalTwinsManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureDigitalTwinsManager {
  return new AzureDigitalTwinsManager(credentialsManager, subscriptionId, retryOptions);
}
