/**
 * Azure Local / HCI Discovery Adapter
 *
 * Discovers Azure Local (formerly Azure Stack HCI) clusters running
 * on customer-owned hardware. Maps them to the HybridDiscoveryAdapter
 * interface for the graph coordinator.
 *
 * Delegates all SDK calls to AzureHybridManager.
 */

import type {
  AzureStackHCICluster,
} from "./types.js";
import type { AzureHybridManager } from "./manager.js";

// ── Local KG type mirrors (cross-extension rootDir pattern) ─────────────────

type ConnectivityStatus = "connected" | "intermittent" | "disconnected" | "unknown";
type HybridSiteCapability = "compute" | "storage" | "networking" | "ai-inference" | "gpu" | "disconnected-ops" | "sovereign";
type FleetClusterStatus = "healthy" | "degraded" | "offline" | "provisioning";

type GraphNodeLocationType =
  | "cloud-region"
  | "availability-zone"
  | "edge-site"
  | "on-premises"
  | "custom-location";

type GraphNodeLocation = {
  type: GraphNodeLocationType;
  name: string;
  provider: "azure";
  region?: string;
  parentRegion?: string;
  coordinates?: { latitude: number; longitude: number };
  address?: {
    city?: string;
    state?: string;
    country: string;
    postalCode?: string;
  };
  connectivityStatus?: ConnectivityStatus;
};

type GraphNodeStatus =
  | "running"
  | "stopped"
  | "pending"
  | "creating"
  | "deleting"
  | "deleted"
  | "error"
  | "unknown"
  | "disappeared";

type GraphResourceType = string;

type GraphNodeInput = {
  id: string;
  provider: string;
  resourceType: GraphResourceType;
  nativeId: string;
  name: string;
  region: string;
  account: string;
  status: GraphNodeStatus;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  costMonthly: number | null;
  owner: string | null;
  createdAt: string | null;
};

type HybridSite = {
  id: string;
  name: string;
  provider: "azure";
  type: "edge-site" | "datacenter" | "branch" | "factory" | "retail" | "field";
  parentCloudRegion: string;
  status: ConnectivityStatus;
  capabilities: HybridSiteCapability[];
  resourceCount: number;
  location?: { latitude: number; longitude: number; address?: string };
  managedClusters: string[];
  managedVMs: string[];
  metadata?: Record<string, unknown>;
};

type FleetCluster = {
  id: string;
  name: string;
  provider: "azure";
  kubernetesVersion: string;
  nodeCount: number;
  status: FleetClusterStatus;
  connectivity: ConnectivityStatus;
  location: GraphNodeLocation;
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
  discoverHybridResources(): Promise<GraphNodeInput[]>;
  healthCheck(): Promise<boolean>;
};

// ── Adapter ─────────────────────────────────────────────────────────────────────

export class AzureLocalDiscoveryAdapter implements HybridDiscoveryAdapter {
  constructor(
    private manager: AzureHybridManager,
    private subscriptionId: string,
    private options: {
      resourceGroup?: string;
      region?: string;
    } = {},
  ) {}

  // ── HybridDiscoveryAdapter interface ────────────────────────────────

  async discoverSites(): Promise<HybridSite[]> {
    const hciClusters = await this.manager.listHCIClusters(this.options.resourceGroup);

    const sites: HybridSite[] = [];

    // Map HCI clusters to datacenter/edge sites
    for (const hci of hciClusters) {
      sites.push({
        id: hci.id,
        name: hci.name,
        provider: "azure",
        type: "datacenter",
        parentCloudRegion: hci.location,
        status: mapHCIStatus(hci.status),
        capabilities: inferHCICapabilities(hci),
        resourceCount: hci.nodeCount,
        managedClusters: [],
        managedVMs: [],
        metadata: {
          clusterId: hci.cloudId,
          clusterVersion: hci.clusterVersion,
          subscriptionId: this.subscriptionId,
          trialDaysRemaining: hci.trialDaysRemaining,
          serviceEndpoint: hci.serviceEndpoint,
          lastSyncTimestamp: hci.lastSyncTimestamp,
        },
      });
    }

    return sites;
  }

  async discoverFleet(): Promise<FleetCluster[]> {
    // Azure Local runs AKS-HCI clusters; discover via HCI cluster metadata
    const hciClusters = await this.manager.listHCIClusters(this.options.resourceGroup);
    const clusters: FleetCluster[] = [];

    for (const hci of hciClusters) {
      // Each HCI cluster that can run AKS is treated as a fleet cluster
      if (hci.clusterVersion) {
        clusters.push({
          id: `aks-hci-${hci.id}`,
          name: `AKS on ${hci.name}`,
          provider: "azure",
          kubernetesVersion: hci.clusterVersion ?? "unknown",
          nodeCount: hci.nodeCount,
          status: mapHCIToFleetStatus(hci.status),
          connectivity: mapHCIStatus(hci.status),
          location: {
            type: "on-premises",
            name: hci.name,
            provider: "azure",
            region: hci.location,
            parentRegion: hci.location,
          },
          labels: hci.tags,
          lastHeartbeat: hci.lastSyncTimestamp,
        });
      }
    }

    return clusters;
  }

  async discoverConnections(): Promise<HybridConnection[]> {
    // Azure Local connects to Azure via service endpoint
    const hciClusters = await this.manager.listHCIClusters(this.options.resourceGroup);

    return hciClusters
      .filter((hci) => hci.serviceEndpoint)
      .map((hci) => ({
        sourceSiteId: hci.id,
        targetSiteId: `azure-region:${hci.location}`,
        type: "internet" as const,
        status: mapHCIStatus(hci.status),
      }));
  }

  async discoverHybridResources(): Promise<GraphNodeInput[]> {
    const hciClusters = await this.manager.listHCIClusters(this.options.resourceGroup);
    const nodes: GraphNodeInput[] = [];

    for (const hci of hciClusters) {
      // HCI cluster node
      nodes.push({
        id: `azure::${hci.location}:hci-cluster:${hci.id}`,
        provider: "azure",
        resourceType: "hci-cluster",
        nativeId: hci.id,
        name: hci.name,
        region: hci.location,
        account: this.subscriptionId,
        status: mapHCIStatusToNodeStatus(hci.status),
        tags: hci.tags ?? {},
        metadata: {
          clusterVersion: hci.clusterVersion,
          nodeCount: hci.nodeCount,
          serviceEndpoint: hci.serviceEndpoint,
        },
        costMonthly: null,
        owner: null,
        createdAt: hci.registrationTimestamp ?? null,
      });
    }

    return nodes;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.manager.listHCIClusters(this.options.resourceGroup);
      return true;
    } catch {
      return false;
    }
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

function mapHCIStatusToNodeStatus(status: string): GraphNodeStatus {
  switch (status) {
    case "Connected":
      return "running";
    case "Disconnected":
      return "error";
    case "NotYetRegistered":
      return "pending";
    case "Error":
    case "DeploymentFailed":
      return "error";
    default:
      return "unknown";
  }
}

function mapHCIToFleetStatus(status: string): FleetClusterStatus {
  switch (status) {
    case "Connected":
      return "healthy";
    case "Disconnected":
      return "offline";
    case "Error":
    case "DeploymentFailed":
      return "degraded";
    default:
      return "provisioning";
  }
}

function inferHCICapabilities(hci: AzureStackHCICluster): HybridSiteCapability[] {
  const caps: HybridSiteCapability[] = ["compute", "storage", "networking"];

  // HCI supports disconnected operations
  caps.push("disconnected-ops");

  // Check if cluster has GPU capabilities via node count (heuristic)
  if (hci.nodeCount >= 4) {
    caps.push("ai-inference");
  }

  return caps;
}
