/**
 * GKE Fleet Discovery Adapter
 *
 * Discovers GKE Fleet memberships (Anthos), on-prem clusters, and
 * bare-metal clusters — maps them to the unified HybridDiscoveryAdapter
 * interface for the graph coordinator.
 */

import type {
  GKEFleet,
  GKEFleetMembership,
  GKEOnPremCluster,
  GKEBareMetalCluster,
  GcpFleetListOptions,
  GcpOnPremClusterListOptions,
} from "./types.js";
import { gcpList } from "../api.js";

// ── Local KG type mirrors (cross-extension rootDir pattern) ─────────────────

type ConnectivityStatus = "connected" | "intermittent" | "disconnected" | "unknown";
type HybridSiteCapability = "compute" | "storage" | "networking" | "ai-inference" | "gpu" | "disconnected-ops";
type FleetClusterStatus = "healthy" | "degraded" | "offline" | "provisioning";

type HybridSite = {
  id: string;
  name: string;
  provider: "gcp";
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
  provider: "gcp";
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

export class GKEFleetDiscoveryAdapter implements HybridDiscoveryAdapter {
  constructor(
    private projectId: string,
    private getAccessToken: () => Promise<string>,
    private options: {
      location?: string;
    } = {},
  ) {}

  // ── HybridDiscoveryAdapter interface ────────────────────────────────

  async discoverSites(): Promise<HybridSite[]> {
    const memberships = await this.listFleetMemberships();
    const sites: HybridSite[] = [];

    // Group on-prem/edge memberships by infrastructure location
    const onPremMemberships = memberships.filter(
      (m) => m.infrastructureType === "ON_PREM" || isOnPremEndpoint(m.endpoint),
    );

    // Treat each unique admin cluster as a "site"
    const adminGroups = groupByAdminCluster(onPremMemberships);

    for (const [adminId, members] of Object.entries(adminGroups)) {
      const location = extractLocation(adminId);
      sites.push({
        id: adminId,
        name: `GKE Fleet Site: ${location}`,
        provider: "gcp",
        type: "datacenter",
        parentCloudRegion: location,
        status: inferMembershipGroupStatus(members),
        capabilities: ["compute", "networking"],
        resourceCount: members.length,
        managedClusters: members.map((m) => m.name),
        metadata: {
          membershipCount: members.length,
          projectId: this.projectId,
        },
      });
    }

    return sites;
  }

  async discoverFleet(): Promise<FleetCluster[]> {
    const [memberships, onPremClusters, bareMetalClusters] = await Promise.all([
      this.listFleetMemberships(),
      this.listOnPremClusters(),
      this.listBareMetalClusters(),
    ]);

    const clusters: FleetCluster[] = [];

    // Map on-prem VMware clusters
    for (const c of onPremClusters) {
      clusters.push({
        id: c.name,
        name: c.localName ?? c.name.split("/").pop() ?? c.name,
        provider: "gcp",
        kubernetesVersion: c.onPremVersion,
        nodeCount: c.controlPlaneNode?.replicas ?? 0,
        status: mapOnPremStatus(c.state),
        connectivity: c.fleet?.membership ? "connected" : "unknown",
        location: {
          siteId: c.adminClusterName,
          region: extractLocation(c.name),
          parentRegion: extractLocation(c.name),
        },
        labels: undefined,
        lastHeartbeat: c.updateTime,
      });
    }

    // Map bare-metal clusters
    for (const c of bareMetalClusters) {
      clusters.push({
        id: c.name,
        name: c.localName ?? c.name.split("/").pop() ?? c.name,
        provider: "gcp",
        kubernetesVersion: c.bareMetalVersion,
        nodeCount: c.nodeCount ?? 0,
        status: mapBareMetalStatus(c.state),
        connectivity: c.fleet?.membership ? "connected" : "unknown",
        location: {
          siteId: c.adminClusterName,
          region: extractLocation(c.name),
          parentRegion: extractLocation(c.name),
        },
        labels: undefined,
        lastHeartbeat: c.updateTime,
      });
    }

    // Map memberships that don't have a corresponding on-prem/BM cluster
    const clusterIds = new Set(clusters.map((c) => c.id));
    for (const m of memberships) {
      if (clusterIds.has(m.name)) continue;
      clusters.push({
        id: m.name,
        name: m.name.split("/").pop() ?? m.name,
        provider: "gcp",
        kubernetesVersion: "unknown",
        nodeCount: 0,
        status: mapMembershipStatus(m.state.code),
        connectivity: m.lastConnectionTime ? "connected" : "unknown",
        location: {
          siteId: undefined,
          region: extractLocation(m.name),
          parentRegion: extractLocation(m.name),
        },
        labels: m.labels,
        lastHeartbeat: m.lastConnectionTime,
      });
    }

    return clusters;
  }

  async discoverConnections(): Promise<HybridConnection[]> {
    // GKE Fleet doesn't expose connection topology;
    // connections are inferred from network-level data
    return [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.listFleets();
      return true;
    } catch {
      return false;
    }
  }

  // ── GCP REST Stubs ────────────────────────────────────────────────────

  async listFleets(_opts?: GcpFleetListOptions): Promise<GKEFleet[]> {
    const token = await this.getAccessToken();
    const loc = this.options.location ?? "global";
    const url = `https://gkehub.googleapis.com/v1/projects/${this.projectId}/locations/${loc}/fleets`;
    return gcpList<GKEFleet>(url, token, "fleets");
  }

  async listFleetMemberships(
    _opts?: GcpFleetListOptions,
  ): Promise<GKEFleetMembership[]> {
    const token = await this.getAccessToken();
    const loc = this.options.location ?? "-";
    const url = `https://gkehub.googleapis.com/v1/projects/${this.projectId}/locations/${loc}/memberships`;
    return gcpList<GKEFleetMembership>(url, token, "resources");
  }

  async listOnPremClusters(
    _opts?: GcpOnPremClusterListOptions,
  ): Promise<GKEOnPremCluster[]> {
    const token = await this.getAccessToken();
    const loc = this.options.location ?? "-";
    const url = `https://gkeonprem.googleapis.com/v1/projects/${this.projectId}/locations/${loc}/vmwareClusters`;
    return gcpList<GKEOnPremCluster>(url, token, "vmwareClusters");
  }

  async listBareMetalClusters(
    _opts?: GcpOnPremClusterListOptions,
  ): Promise<GKEBareMetalCluster[]> {
    const token = await this.getAccessToken();
    const loc = this.options.location ?? "-";
    const url = `https://gkeonprem.googleapis.com/v1/projects/${this.projectId}/locations/${loc}/bareMetalClusters`;
    return gcpList<GKEBareMetalCluster>(url, token, "bareMetalClusters");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function isOnPremEndpoint(endpoint: GKEFleetMembership["endpoint"]): boolean {
  return "onPremCluster" in endpoint || "applianceCluster" in endpoint || "edgeCluster" in endpoint;
}

function groupByAdminCluster(
  memberships: GKEFleetMembership[],
): Record<string, GKEFleetMembership[]> {
  const groups: Record<string, GKEFleetMembership[]> = {};
  for (const m of memberships) {
    // Use the location segment (project/location) as the grouping key
    const parts = m.name.split("/");
    const key = parts.length >= 4 ? parts.slice(0, 4).join("/") : m.name;
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  }
  return groups;
}

function extractLocation(resourceName: string): string {
  // GCP resource names: projects/{project}/locations/{location}/...
  const parts = resourceName.split("/");
  const locIdx = parts.indexOf("locations");
  return locIdx >= 0 && parts[locIdx + 1] ? parts[locIdx + 1] : "global";
}

function inferMembershipGroupStatus(
  members: GKEFleetMembership[],
): ConnectivityStatus {
  const codes = members.map((m) => m.state.code);
  if (codes.every((c) => c === "READY")) return "connected";
  if (codes.some((c) => c === "READY")) return "intermittent";
  return "disconnected";
}

function mapOnPremStatus(state: string): FleetClusterStatus {
  switch (state) {
    case "RUNNING":
      return "healthy";
    case "PROVISIONING":
    case "RECONCILING":
      return "provisioning";
    case "DEGRADED":
      return "degraded";
    case "ERROR":
    case "STOPPING":
      return "offline";
    default:
      return "degraded";
  }
}

function mapBareMetalStatus(state: string): FleetClusterStatus {
  switch (state) {
    case "RUNNING":
      return "healthy";
    case "PROVISIONING":
    case "RECONCILING":
      return "provisioning";
    case "DEGRADED":
      return "degraded";
    case "ERROR":
    case "STOPPING":
      return "offline";
    default:
      return "degraded";
  }
}

function mapMembershipStatus(code: string): FleetClusterStatus {
  switch (code) {
    case "READY":
      return "healthy";
    case "CREATING":
    case "UPDATING":
    case "SERVICE_UPDATING":
      return "provisioning";
    case "DELETING":
      return "offline";
    default:
      return "degraded";
  }
}
