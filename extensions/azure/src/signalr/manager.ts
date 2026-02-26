/**
 * Azure SignalR Service Manager
 *
 * Manages SignalR Service resources, custom domains, and
 * private endpoints via @azure/arm-signalr.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  SignalRResource,
  SignalRCustomDomain,
  SignalRPrivateEndpointConnection,
  SignalRUsage,
} from "./types.js";

export class AzureSignalRManager {
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
    const { SignalRManagementClient } = await import("@azure/arm-signalr");
    return new SignalRManagementClient(credential, this.subscriptionId);
  }

  private extractResourceGroup(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i);
    return match ? match[1] : "";
  }

  // ---------------------------------------------------------------------------
  // SignalR Resources
  // ---------------------------------------------------------------------------

  /** List SignalR Service resources. */
  async listSignalRResources(resourceGroup?: string): Promise<SignalRResource[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const resources: SignalRResource[] = [];
      const iter = resourceGroup
        ? client.signalR.listByResourceGroup(resourceGroup)
        : client.signalR.listBySubscription();

      for await (const r of iter) {
        resources.push(this.mapSignalR(r));
      }
      return resources;
    }, this.retryOptions);
  }

  /** Get a specific SignalR resource. */
  async getSignalRResource(resourceGroup: string, name: string): Promise<SignalRResource | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const r = await client.signalR.get(resourceGroup, name);
        return this.mapSignalR(r, resourceGroup);
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete a SignalR resource. */
  async deleteSignalRResource(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.signalR.beginDeleteAndWait(resourceGroup, name),
      this.retryOptions,
    );
  }

  /** Restart a SignalR resource. */
  async restartSignalRResource(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.signalR.beginRestartAndWait(resourceGroup, name),
      this.retryOptions,
    );
  }

  // ---------------------------------------------------------------------------
  // Custom Domains
  // ---------------------------------------------------------------------------

  /** List custom domains for a SignalR resource. */
  async listCustomDomains(resourceGroup: string, resourceName: string): Promise<SignalRCustomDomain[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const domains: SignalRCustomDomain[] = [];
      for await (const d of client.signalRCustomDomains.list(resourceGroup, resourceName)) {
        const raw = d as {
          id?: string; name?: string;
          properties?: {
            domainName?: string; provisioningState?: string;
            customCertificate?: { id?: string };
          };
        };
        domains.push({
          id: raw.id ?? "",
          name: raw.name ?? "",
          domainName: raw.properties?.domainName,
          provisioningState: raw.properties?.provisioningState,
          customCertificateId: raw.properties?.customCertificate?.id,
        });
      }
      return domains;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Private Endpoint Connections
  // ---------------------------------------------------------------------------

  /** List private endpoint connections. */
  async listPrivateEndpointConnections(resourceGroup: string, resourceName: string): Promise<SignalRPrivateEndpointConnection[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const connections: SignalRPrivateEndpointConnection[] = [];
      for await (const pe of client.signalRPrivateEndpointConnections.list(resourceGroup, resourceName)) {
        const raw = pe as {
          id?: string; name?: string;
          properties?: {
            provisioningState?: string;
            privateEndpoint?: { id?: string };
            groupIds?: string[];
            privateLinkServiceConnectionState?: { status?: string };
          };
        };
        connections.push({
          id: raw.id ?? "",
          name: raw.name ?? "",
          provisioningState: raw.properties?.provisioningState,
          privateEndpointId: raw.properties?.privateEndpoint?.id,
          groupIds: raw.properties?.groupIds,
          connectionState: raw.properties?.privateLinkServiceConnectionState?.status,
        });
      }
      return connections;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Usages
  // ---------------------------------------------------------------------------

  /** List SignalR Service usages for a location. */
  async listUsages(location: string): Promise<SignalRUsage[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const usages: SignalRUsage[] = [];
      for await (const u of client.usages.list(location)) {
        usages.push({
          currentValue: u.currentValue,
          limit: u.limit,
          name: u.name?.value,
          unit: u.unit,
        });
      }
      return usages;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private mapSignalR(r: unknown, rg?: string): SignalRResource {
    const res = r as {
      id?: string; name?: string; location?: string;
      provisioningState?: string;
      sku?: { name?: string; tier?: string; capacity?: number };
      hostName?: string; publicPort?: number; serverPort?: number;
      version?: string; kind?: string;
      publicNetworkAccess?: string;
      disableLocalAuth?: boolean; disableAadAuth?: boolean;
      externalIP?: string;
      tags?: Record<string, string>;
    };

    return {
      id: res.id ?? "",
      name: res.name ?? "",
      resourceGroup: rg ?? this.extractResourceGroup(res.id ?? ""),
      location: res.location ?? "",
      provisioningState: res.provisioningState,
      skuName: res.sku?.name,
      skuTier: res.sku?.tier,
      skuCapacity: res.sku?.capacity,
      hostName: res.hostName,
      publicPort: res.publicPort,
      serverPort: res.serverPort,
      version: res.version,
      kind: res.kind,
      publicNetworkAccess: res.publicNetworkAccess,
      disableLocalAuth: res.disableLocalAuth,
      disableAadAuth: res.disableAadAuth,
      externalIp: res.externalIP,
      tags: res.tags as Record<string, string>,
    };
  }
}

export function createSignalRManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureSignalRManager {
  return new AzureSignalRManager(credentialsManager, subscriptionId, retryOptions);
}
