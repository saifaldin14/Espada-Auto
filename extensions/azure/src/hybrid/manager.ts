/**
 * Azure Hybrid / Arc Manager
 *
 * Manages Azure Arc-enabled servers, Arc Kubernetes clusters,
 * Azure Stack HCI clusters, and Custom Locations via official
 * Azure SDK packages.
 *
 * Follows the same manager pattern as AzureVMManager et al:
 * - Credentials injected via AzureCredentialsManager
 * - Lazy SDK client instantiation via dynamic import
 * - All list methods wrapped in withAzureRetry
 * - 404s return null for get-by-name methods
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  AzureArcServer,
  AzureArcExtension,
  AzureArcKubernetesCluster,
  AzureStackHCICluster,
  AzureCustomLocation,
  AzureArcListOptions,
  AzureArcKubernetesListOptions,
} from "./types.js";

// =============================================================================
// AzureHybridManager
// =============================================================================

export class AzureHybridManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private defaultRegion: string;
  private retryOptions: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    defaultRegion?: string,
    retryOptions?: AzureRetryOptions,
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.defaultRegion = defaultRegion ?? "eastus";
    this.retryOptions = retryOptions ?? {};
  }

  // ── SDK Client Factories (lazy dynamic import) ──────────────────────

  private async getHybridComputeClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { HybridComputeManagementClient } = await import(
      "@azure/arm-hybridcompute"
    );
    return new HybridComputeManagementClient(credential, this.subscriptionId);
  }

  private async getConnectedKubernetesClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { ConnectedKubernetesClient } = await import(
      "@azure/arm-hybridkubernetes"
    );
    return new ConnectedKubernetesClient(credential, this.subscriptionId);
  }

  private async getHCIClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { AzureStackHCIClient } = await import("@azure/arm-azurestackhci");
    return new AzureStackHCIClient(credential, this.subscriptionId);
  }

  private async getCustomLocationsClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { CustomLocationsManagementClient } = await import(
      "@azure/arm-extendedlocation"
    );
    return new CustomLocationsManagementClient(credential, this.subscriptionId);
  }

  // ── Arc Servers ─────────────────────────────────────────────────────

  /**
   * List Azure Arc-enabled servers.
   * Optionally filtered by resource group, region, or agent status.
   */
  async listArcServers(
    opts?: AzureArcListOptions,
  ): Promise<AzureArcServer[]> {
    const client = await this.getHybridComputeClient();

    return withAzureRetry(async () => {
      const servers: AzureArcServer[] = [];

      const iterator = opts?.resourceGroup
        ? client.machines.listByResourceGroup(opts.resourceGroup)
        : client.machines.listBySubscription();

      for await (const machine of iterator) {
        const server = this.mapArcServer(machine);

        // Apply optional filters
        if (opts?.region && server.location !== opts.region) continue;
        if (opts?.status && server.status !== opts.status) continue;
        if (opts?.tags) {
          const matchesTags = Object.entries(opts.tags).every(
            ([k, v]) => server.tags?.[k] === v,
          );
          if (!matchesTags) continue;
        }

        servers.push(server);
      }

      return servers;
    }, this.retryOptions);
  }

  /**
   * Get a single Arc server by name and resource group.
   */
  async getArcServer(
    resourceGroup: string,
    machineName: string,
  ): Promise<AzureArcServer | null> {
    const client = await this.getHybridComputeClient();

    return withAzureRetry(async () => {
      try {
        const machine = await client.machines.get(resourceGroup, machineName);
        return this.mapArcServer(machine);
      } catch (error: unknown) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /**
   * List extensions installed on an Arc server.
   */
  async listArcServerExtensions(
    resourceGroup: string,
    machineName: string,
  ): Promise<AzureArcExtension[]> {
    const client = await this.getHybridComputeClient();

    return withAzureRetry(async () => {
      const extensions: AzureArcExtension[] = [];

      for await (const ext of client.machineExtensions.list(
        resourceGroup,
        machineName,
      )) {
        extensions.push({
          name: ext.name ?? "unknown",
          type: ext.properties?.type ?? ext.type ?? "unknown",
          provisioningState: ext.properties?.provisioningState ?? "Unknown",
          version: ext.properties?.typeHandlerVersion,
        });
      }

      return extensions;
    }, this.retryOptions);
  }

  // ── Arc Kubernetes ──────────────────────────────────────────────────

  /**
   * List Azure Arc-connected Kubernetes clusters.
   * Optionally filtered by resource group, distribution, or connectivity status.
   */
  async listArcKubernetesClusters(
    opts?: AzureArcKubernetesListOptions,
  ): Promise<AzureArcKubernetesCluster[]> {
    const client = await this.getConnectedKubernetesClient();

    return withAzureRetry(async () => {
      const clusters: AzureArcKubernetesCluster[] = [];

      const iterator = opts?.resourceGroup
        ? client.connectedClusterOperations.listByResourceGroup(
            opts.resourceGroup,
          )
        : client.connectedClusterOperations.listBySubscription();

      for await (const cc of iterator) {
        const cluster = this.mapArcKubernetesCluster(cc);

        // Apply optional filters
        if (opts?.region && cluster.location !== opts.region) continue;
        if (
          opts?.distribution &&
          cluster.distribution !== opts.distribution
        )
          continue;
        if (
          opts?.connectivityStatus &&
          cluster.connectivityStatus !== opts.connectivityStatus
        )
          continue;

        clusters.push(cluster);
      }

      return clusters;
    }, this.retryOptions);
  }

  /**
   * Get a single Arc Kubernetes cluster by name and resource group.
   */
  async getArcKubernetesCluster(
    resourceGroup: string,
    clusterName: string,
  ): Promise<AzureArcKubernetesCluster | null> {
    const client = await this.getConnectedKubernetesClient();

    return withAzureRetry(async () => {
      try {
        const cc = await client.connectedClusterOperations.get(
          resourceGroup,
          clusterName,
        );
        return this.mapArcKubernetesCluster(cc);
      } catch (error: unknown) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  // ── Azure Stack HCI ─────────────────────────────────────────────────

  /**
   * List Azure Stack HCI clusters.
   * Optionally filtered by resource group.
   */
  async listHCIClusters(
    resourceGroup?: string,
  ): Promise<AzureStackHCICluster[]> {
    const client = await this.getHCIClient();

    return withAzureRetry(async () => {
      const clusters: AzureStackHCICluster[] = [];

      const iterator = resourceGroup
        ? client.clusters.listByResourceGroup(resourceGroup)
        : client.clusters.listBySubscription();

      for await (const c of iterator) {
        clusters.push(this.mapHCICluster(c));
      }

      return clusters;
    }, this.retryOptions);
  }

  /**
   * Get a single HCI cluster by name and resource group.
   */
  async getHCICluster(
    resourceGroup: string,
    clusterName: string,
  ): Promise<AzureStackHCICluster | null> {
    const client = await this.getHCIClient();

    return withAzureRetry(async () => {
      try {
        const c = await client.clusters.get(resourceGroup, clusterName);
        return this.mapHCICluster(c);
      } catch (error: unknown) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  // ── Custom Locations ────────────────────────────────────────────────

  /**
   * List Azure Custom Locations.
   * Optionally filtered by resource group.
   */
  async listCustomLocations(
    resourceGroup?: string,
  ): Promise<AzureCustomLocation[]> {
    const client = await this.getCustomLocationsClient();

    return withAzureRetry(async () => {
      const locations: AzureCustomLocation[] = [];

      const iterator = resourceGroup
        ? client.customLocations.listByResourceGroup(resourceGroup)
        : client.customLocations.listBySubscription();

      for await (const cl of iterator) {
        locations.push(this.mapCustomLocation(cl));
      }

      return locations;
    }, this.retryOptions);
  }

  /**
   * Get a single Custom Location by name and resource group.
   */
  async getCustomLocation(
    resourceGroup: string,
    name: string,
  ): Promise<AzureCustomLocation | null> {
    const client = await this.getCustomLocationsClient();

    return withAzureRetry(async () => {
      try {
        const cl = await client.customLocations.get(resourceGroup, name);
        return this.mapCustomLocation(cl);
      } catch (error: unknown) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  // ── Combined Discovery ──────────────────────────────────────────────

  /**
   * Full hybrid discovery: fetches all Arc/HCI/Custom Location resources
   * in parallel and returns a unified result.
   */
  async discoverAll(resourceGroup?: string) {
    const [arcServers, arcClusters, hciClusters, customLocations] =
      await Promise.all([
        this.listArcServers(
          resourceGroup ? { resourceGroup } : undefined,
        ),
        this.listArcKubernetesClusters(
          resourceGroup ? { resourceGroup } : undefined,
        ),
        this.listHCIClusters(resourceGroup),
        this.listCustomLocations(resourceGroup),
      ]);

    return {
      arcServers,
      arcClusters,
      hciClusters,
      customLocations,
      subscriptionId: this.subscriptionId,
      discoveredAt: new Date().toISOString(),
    };
  }

  // ── SDK → Domain Mappers ────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapArcServer(machine: any): AzureArcServer {
    const resourceId = (machine.id ?? "") as string;
    const rgMatch = resourceId.match(/resourceGroups\/([^/]+)/i);

    return {
      id: resourceId,
      name: (machine.name ?? "") as string,
      type: "Microsoft.HybridCompute/machines",
      location: (machine.location ?? this.defaultRegion) as string,
      resourceGroup: rgMatch?.[1] ?? "",
      subscriptionId: this.subscriptionId,
      tags: (machine.tags ?? {}) as Record<string, string>,
      agentVersion: (machine.agentVersion ?? "") as string,
      status: mapAgentStatus(machine.status),
      osSku: (machine.osSku ?? machine.osName ?? "") as string,
      osType: (machine.osType === "Windows" ? "Windows" : "Linux") as
        | "Windows"
        | "Linux",
      domainName: machine.domainName as string | undefined,
      machineFqdn: machine.machineFqdn as string | undefined,
      lastStatusChange: machine.lastStatusChange
        ? new Date(machine.lastStatusChange).toISOString()
        : undefined,
      provisioningState: mapProvisioningState(machine.provisioningState),
      extensions: machine.resources?.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ext: any) =>
          ({
            name: ext.name ?? "unknown",
            type: ext.properties?.type ?? ext.type ?? "unknown",
            provisioningState:
              ext.properties?.provisioningState ?? "Unknown",
            version: ext.properties?.typeHandlerVersion,
          }) satisfies AzureArcExtension,
      ),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapArcKubernetesCluster(cc: any): AzureArcKubernetesCluster {
    const resourceId = (cc.id ?? "") as string;
    const rgMatch = resourceId.match(/resourceGroups\/([^/]+)/i);

    return {
      id: resourceId,
      name: (cc.name ?? "") as string,
      type: "Microsoft.Kubernetes/connectedClusters",
      location: (cc.location ?? this.defaultRegion) as string,
      resourceGroup: rgMatch?.[1] ?? "",
      subscriptionId: this.subscriptionId,
      tags: (cc.tags ?? {}) as Record<string, string>,
      distribution: (cc.distribution ?? "unknown") as string,
      distributionVersion: cc.distributionVersion as string | undefined,
      kubernetesVersion: (cc.kubernetesVersion ?? "unknown") as string,
      totalNodeCount: (cc.totalNodeCount ?? 0) as number,
      totalCoreCount: (cc.totalCoreCount ?? 0) as number,
      agentVersion: (cc.agentVersion ?? "") as string,
      connectivityStatus: mapConnectivityStatus(cc.connectivityStatus),
      lastConnectivityTime: cc.lastConnectivityTime
        ? new Date(cc.lastConnectivityTime).toISOString()
        : undefined,
      infrastructure: (cc.infrastructure ?? "unknown") as string,
      offering: cc.offering as string | undefined,
      provisioningState: (cc.provisioningState ?? "Unknown") as string,
      managedIdentityCertificateExpirationTime:
        cc.managedIdentityCertificateExpirationTime
          ? new Date(
              cc.managedIdentityCertificateExpirationTime,
            ).toISOString()
          : undefined,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapHCICluster(c: any): AzureStackHCICluster {
    const resourceId = (c.id ?? "") as string;
    const rgMatch = resourceId.match(/resourceGroups\/([^/]+)/i);
    const reported = c.reportedProperties ?? {};
    const nodeCount =
      (reported.nodes as unknown[] | undefined)?.length ?? 0;

    return {
      id: resourceId,
      name: (c.name ?? "") as string,
      type: "Microsoft.AzureStackHCI/clusters",
      location: (c.location ?? this.defaultRegion) as string,
      resourceGroup: rgMatch?.[1] ?? "",
      subscriptionId: this.subscriptionId,
      tags: (c.tags ?? {}) as Record<string, string>,
      cloudId: (c.cloudId ?? reported.clusterId) as string | undefined,
      status: mapHCIStatus(c.status),
      lastBillingTimestamp: c.lastBillingTimestamp
        ? new Date(c.lastBillingTimestamp).toISOString()
        : undefined,
      registrationTimestamp: c.registrationTimestamp
        ? new Date(c.registrationTimestamp).toISOString()
        : undefined,
      lastSyncTimestamp: c.lastSyncTimestamp
        ? new Date(c.lastSyncTimestamp).toISOString()
        : undefined,
      trialDaysRemaining: (c.trialDaysRemaining ?? 0) as number,
      nodeCount,
      clusterVersion: (reported.clusterVersion ?? "") as string | undefined,
      serviceEndpoint: c.serviceEndpoint as string | undefined,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapCustomLocation(cl: any): AzureCustomLocation {
    const resourceId = (cl.id ?? "") as string;
    const rgMatch = resourceId.match(/resourceGroups\/([^/]+)/i);

    return {
      id: resourceId,
      name: (cl.name ?? "") as string,
      type: "Microsoft.ExtendedLocation/customLocations",
      location: (cl.location ?? this.defaultRegion) as string,
      resourceGroup: rgMatch?.[1] ?? "",
      subscriptionId: this.subscriptionId,
      tags: (cl.tags ?? {}) as Record<string, string>,
      hostResourceId: (cl.hostResourceId ?? "") as string,
      namespace: cl.namespace as string | undefined,
      hostType: (cl.hostType ?? "Kubernetes") as "Kubernetes",
      provisioningState: (cl.provisioningState ?? "Unknown") as string,
      clusterExtensionIds: cl.clusterExtensionIds as string[] | undefined,
      displayName: cl.displayName as string | undefined,
      authentication: cl.authentication
        ? {
            type: (cl.authentication.type ?? "") as string,
            value: cl.authentication.value as string | undefined,
          }
        : undefined,
    };
  }
}

// ── Status Mappers ──────────────────────────────────────────────────────────────

function mapAgentStatus(
  status: string | undefined,
): "Connected" | "Disconnected" | "Error" | "Expired" {
  switch (status) {
    case "Connected":
      return "Connected";
    case "Disconnected":
      return "Disconnected";
    case "Expired":
      return "Expired";
    case "Error":
      return "Error";
    default:
      return "Disconnected";
  }
}

function mapConnectivityStatus(
  status: string | undefined,
): "Connected" | "Connecting" | "Offline" | "Expired" {
  switch (status) {
    case "Connected":
      return "Connected";
    case "Connecting":
      return "Connecting";
    case "Expired":
      return "Expired";
    case "Offline":
      return "Offline";
    default:
      return "Offline";
  }
}

function mapHCIStatus(
  status: string | undefined,
):
  | "Connected"
  | "Disconnected"
  | "NotYetRegistered"
  | "Error"
  | "DeploymentFailed" {
  switch (status) {
    case "Connected":
    case "ConnectedRecently":
      return "Connected";
    case "Disconnected":
    case "NotConnectedRecently":
      return "Disconnected";
    case "NotYetRegistered":
      return "NotYetRegistered";
    case "DeploymentFailed":
      return "DeploymentFailed";
    case "Error":
      return "Error";
    default:
      return "Disconnected";
  }
}

function mapProvisioningState(
  state: string | undefined,
): "Succeeded" | "Failed" | "Creating" | "Updating" | "Deleting" {
  switch (state) {
    case "Succeeded":
      return "Succeeded";
    case "Failed":
      return "Failed";
    case "Creating":
      return "Creating";
    case "Updating":
      return "Updating";
    case "Deleting":
      return "Deleting";
    default:
      return "Succeeded";
  }
}
