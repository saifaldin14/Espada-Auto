/**
 * Azure Arc Discovery Adapter
 *
 * Discovers Arc-enabled servers, Arc-connected Kubernetes clusters,
 * Azure Stack HCI clusters, and Custom Locations — then maps them
 * to the HybridDiscoveryAdapter interface for the graph coordinator.
 */

import type {
  AzureArcServer,
  AzureArcKubernetesCluster,
  AzureStackHCICluster,
  AzureCustomLocation,
  AzureLocalDevice,
  AzureArcListOptions,
  AzureArcKubernetesListOptions,
  AzureHybridDiscoveryResult,
} from "./types.js";

// ── Local KG type mirrors (cross-extension rootDir pattern) ─────────────────

type ConnectivityStatus = "connected" | "intermittent" | "disconnected" | "unknown";
type HybridSiteCapability = "compute" | "storage" | "networking" | "ai-inference" | "gpu" | "disconnected-ops";
type FleetClusterStatus = "healthy" | "degraded" | "offline" | "provisioning";

type HybridSite = {
  id: string;
  name: string;
  provider: "azure-arc";
  type: "edge-site" | "branch" | "factory" | "retail" | "datacenter" | "field";
  parentCloudRegion: string;
  status: ConnectivityStatus;
  capabilities: HybridSiteCapability[];
  resourceCount: number;
  location?: { latitude: number; longitude: number; address?: string };
  managedClusters: string[];
  metadata?: Record<string, unknown>;
};

type FleetCluster = {
  id: string;
  name: string;
  provider: "azure-arc";
  kubernetesVersion: string;
  nodeCount: number;
  status: FleetClusterStatus;
  connectivity: ConnectivityStatus;
  location: {
    siteId?: string;
    region?: string;
    parentRegion?: string;
  };
  labels?: Record<string, string>;
  lastHeartbeat?: string;
};

type HybridConnection = {
  sourceSiteId: string;
  targetSiteId: string;
  type: "vpn" | "expressroute" | "direct-connect" | "sd-wan" | "internet";
  status: ConnectivityStatus;
  bandwidthMbps?: number;
  latencyMs?: number;
};

type HybridDiscoveryAdapter = {
  discoverSites(): Promise<HybridSite[]>;
  discoverFleet(): Promise<FleetCluster[]>;
  discoverConnections(): Promise<HybridConnection[]>;
  healthCheck(): Promise<boolean>;
};

// ── Adapter ─────────────────────────────────────────────────────────────────────

export class AzureArcDiscoveryAdapter implements HybridDiscoveryAdapter {
  constructor(
    private subscriptionId: string,
    private options: {
      resourceGroup?: string;
      region?: string;
    } = {},
  ) {}

  // ── HybridDiscoveryAdapter interface ────────────────────────────────

  async discoverSites(): Promise<HybridSite[]> {
    const hciClusters = await this.listHCIClusters();
    const customLocations = await this.listCustomLocations();

    const sites: HybridSite[] = [];

    // Map HCI clusters to edge sites
    for (const hci of hciClusters) {
      const arcClusters = await this.listArcKubernetesClusters({
        resourceGroup: hci.resourceGroup,
      });

      sites.push({
        id: hci.id,
        name: hci.name,
        provider: "azure-arc",
        type: "datacenter",
        parentCloudRegion: hci.location,
        status: mapHCIStatus(hci.status),
        capabilities: inferHCICapabilities(hci),
        resourceCount: hci.nodeCount,
        managedClusters: arcClusters.map((c) => c.id),
        metadata: {
          clusterVersion: hci.clusterVersion,
          subscriptionId: this.subscriptionId,
          trialDaysRemaining: hci.trialDaysRemaining,
        },
      });
    }

    // Map Custom Locations to edge sites (if not already covered)
    const existingIds = new Set(sites.map((s) => s.id));
    for (const cl of customLocations) {
      if (existingIds.has(cl.id)) continue;
      sites.push({
        id: cl.id,
        name: cl.displayName ?? cl.name,
        provider: "azure-arc",
        type: "edge-site",
        parentCloudRegion: cl.location,
        status: cl.provisioningState === "Succeeded" ? "connected" : "unknown",
        capabilities: ["compute"],
        resourceCount: cl.clusterExtensionIds?.length ?? 0,
        managedClusters: [cl.hostResourceId],
        metadata: {
          namespace: cl.namespace,
          hostType: cl.hostType,
        },
      });
    }

    return sites;
  }

  async discoverFleet(): Promise<FleetCluster[]> {
    const arcClusters = await this.listArcKubernetesClusters();

    return arcClusters.map((c) => ({
      id: c.id,
      name: c.name,
      provider: "azure-arc" as const,
      kubernetesVersion: c.kubernetesVersion,
      nodeCount: c.totalNodeCount,
      status: mapClusterStatus(c),
      connectivity: mapConnectivityStatus(c.connectivityStatus),
      location: {
        siteId: undefined,
        region: c.location,
        parentRegion: c.location,
      },
      labels: c.tags,
      lastHeartbeat: c.lastConnectivityTime,
    }));
  }

  async discoverConnections(): Promise<HybridConnection[]> {
    // Azure Arc doesn't expose connection topology directly;
    // connections are inferred from co-located resources in the graph
    return [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Lightweight probe: list a single Arc server
      const servers = await this.listArcServers({ subscriptionId: this.subscriptionId });
      return servers.length >= 0; // Even empty is fine
    } catch {
      return false;
    }
  }

  // ── Azure REST Stubs ──────────────────────────────────────────────────
  //
  // These call the Azure Resource Graph / ARM APIs. In production they
  // would use the Azure SDK. For now they serve as typed contracts that
  // the real SDK integration will fill in.

  async listArcServers(opts?: AzureArcListOptions): Promise<AzureArcServer[]> {
    void opts;
    // TODO: implement via @azure/arm-hybridcompute
    return [];
  }

  async listArcKubernetesClusters(
    opts?: AzureArcKubernetesListOptions,
  ): Promise<AzureArcKubernetesCluster[]> {
    void opts;
    // TODO: implement via @azure/arm-hybridkubernetes
    return [];
  }

  async listHCIClusters(): Promise<AzureStackHCICluster[]> {
    // TODO: implement via @azure/arm-azurestackhci
    return [];
  }

  async listCustomLocations(): Promise<AzureCustomLocation[]> {
    // TODO: implement via @azure/arm-extendedlocation
    return [];
  }

  async listLocalDevices(): Promise<AzureLocalDevice[]> {
    // TODO: implement via @azure/arm-databoxedge
    return [];
  }

  /**
   * Full discovery: combines all Azure hybrid resource types.
   */
  async discoverAll(): Promise<AzureHybridDiscoveryResult> {
    const [arcServers, arcClusters, hciClusters, customLocations, localDevices] =
      await Promise.all([
        this.listArcServers(),
        this.listArcKubernetesClusters(),
        this.listHCIClusters(),
        this.listCustomLocations(),
        this.listLocalDevices(),
      ]);

    return {
      arcServers,
      arcClusters,
      hciClusters,
      customLocations,
      localDevices,
      subscriptionId: this.subscriptionId,
      discoveredAt: new Date().toISOString(),
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function mapHCIStatus(status: string): ConnectivityStatus {
  switch (status) {
    case "Connected":
      return "connected";
    case "Disconnected":
      return "disconnected";
    case "NotYetRegistered":
    case "DeploymentFailed":
    case "Error":
      return "unknown";
    default:
      return "unknown";
  }
}

function mapConnectivityStatus(status: string): ConnectivityStatus {
  switch (status) {
    case "Connected":
      return "connected";
    case "Connecting":
      return "intermittent";
    case "Offline":
    case "Expired":
      return "disconnected";
    default:
      return "unknown";
  }
}

function mapClusterStatus(cluster: AzureArcKubernetesCluster): FleetClusterStatus {
  if (cluster.provisioningState === "Succeeded" && cluster.connectivityStatus === "Connected") {
    return "healthy";
  }
  if (cluster.connectivityStatus === "Offline" || cluster.connectivityStatus === "Expired") {
    return "offline";
  }
  if (cluster.provisioningState === "Creating") {
    return "provisioning";
  }
  return "degraded";
}

function inferHCICapabilities(
  _hci: AzureStackHCICluster,
): HybridSiteCapability[] {
  const caps: HybridSiteCapability[] = ["compute", "storage", "networking"];
  // HCI always supports disconnected ops
  caps.push("disconnected-ops");
  return caps;
}
