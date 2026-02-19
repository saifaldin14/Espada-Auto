/**
 * Google Distributed Cloud (GDC) Discovery Adapter
 *
 * Discovers GDC zones and nodes — maps them to the unified
 * HybridDiscoveryAdapter interface for the graph coordinator.
 * GDC is Google's fully air-gapped / sovereign cloud offering.
 */

import type { GDCZone, GDCNode, GcpHybridDiscoveryResult } from "./types.js";

// ── Local KG type mirrors (cross-extension rootDir pattern) ─────────────────

type ConnectivityStatus = "connected" | "intermittent" | "disconnected" | "unknown";
type HybridSiteCapability = "compute" | "storage" | "networking" | "ai-inference" | "gpu" | "disconnected-ops";
type FleetClusterStatus = "healthy" | "degraded" | "offline" | "provisioning";

type HybridSite = {
  id: string;
  name: string;
  provider: "gdc";
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
  provider: "gdc";
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

export class GDCDiscoveryAdapter implements HybridDiscoveryAdapter {
  constructor(
    private projectId: string,
    private options: {
      location?: string;
    } = {},
  ) {}

  // ── HybridDiscoveryAdapter interface ────────────────────────────────

  async discoverSites(): Promise<HybridSite[]> {
    const zones = await this.listGDCZones();
    const allNodes = await this.listGDCNodes();

    return zones.map((zone) => {
      const zoneNodes = allNodes.filter((n) => n.zone === zone.name);
      const location = extractLocation(zone.name);

      return {
        id: zone.name,
        name: zone.displayName ?? zone.name.split("/").pop() ?? zone.name,
        provider: "gdc" as const,
        type: "datacenter" as const,
        parentCloudRegion: location,
        status: mapZoneStatus(zone.state),
        capabilities: inferGDCCapabilities(zoneNodes),
        resourceCount: zoneNodes.length,
        managedClusters: [],
        metadata: {
          projectId: this.projectId,
          createTime: zone.createTime,
          labels: zone.labels,
        },
      };
    });
  }

  async discoverFleet(): Promise<FleetCluster[]> {
    // GDC nodes are compute, not Kubernetes clusters; map as single-node "clusters"
    // for the fleet view. In practice, GDC clusters would come from the GKE API
    // within the GDC zone.
    const nodes = await this.listGDCNodes();

    // Group nodes by zone as pseudo-fleets
    const byZone = new Map<string, GDCNode[]>();
    for (const n of nodes) {
      if (!byZone.has(n.zone)) byZone.set(n.zone, []);
      byZone.get(n.zone)!.push(n);
    }

    const clusters: FleetCluster[] = [];
    for (const [zone, zoneNodes] of byZone) {
      clusters.push({
        id: zone,
        name: zone.split("/").pop() ?? zone,
        provider: "gdc",
        kubernetesVersion: "gdc-managed",
        nodeCount: zoneNodes.length,
        status: inferZoneClusterStatus(zoneNodes),
        connectivity: "disconnected", // GDC is air-gapped by design
        location: {
          siteId: zone,
          region: extractLocation(zone),
          parentRegion: extractLocation(zone),
        },
        labels: zoneNodes[0]?.labels,
        lastHeartbeat: undefined,
      });
    }

    return clusters;
  }

  async discoverConnections(): Promise<HybridConnection[]> {
    // GDC is air-gapped; no cloud connections by design
    return [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.listGDCZones();
      return true;
    } catch {
      return false;
    }
  }

  // ── GDC REST Stubs ────────────────────────────────────────────────────

  async listGDCZones(): Promise<GDCZone[]> {
    void this.options;
    // TODO: implement via GDC management API
    return [];
  }

  async listGDCNodes(): Promise<GDCNode[]> {
    // TODO: implement via GDC management API
    return [];
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function extractLocation(resourceName: string): string {
  const parts = resourceName.split("/");
  const locIdx = parts.indexOf("locations");
  return locIdx >= 0 && parts[locIdx + 1] ? parts[locIdx + 1] : "global";
}

function mapZoneStatus(state: string): ConnectivityStatus {
  switch (state) {
    case "ACTIVE":
      return "connected";
    case "CREATING":
      return "intermittent";
    case "DELETING":
      return "disconnected";
    default:
      return "unknown";
  }
}

function inferGDCCapabilities(nodes: GDCNode[]): HybridSiteCapability[] {
  const caps: HybridSiteCapability[] = ["compute", "storage", "networking", "disconnected-ops"];

  // Check for GPU machine types
  const hasGPU = nodes.some(
    (n) => n.machineType.includes("gpu") || n.machineType.includes("a2") || n.machineType.includes("a3"),
  );
  if (hasGPU) {
    caps.push("gpu", "ai-inference");
  }

  return caps;
}

function inferZoneClusterStatus(nodes: GDCNode[]): FleetClusterStatus {
  if (nodes.length === 0) return "offline";
  const states = nodes.map((n) => n.state);
  if (states.every((s) => s === "RUNNING")) return "healthy";
  if (states.some((s) => s === "ERROR")) return "degraded";
  if (states.every((s) => s === "PROVISIONING")) return "provisioning";
  return "degraded";
}
