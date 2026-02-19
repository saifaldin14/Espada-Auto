/**
 * AWS Outposts & Hybrid Discovery Adapter
 *
 * Discovers AWS Outposts, EKS Anywhere clusters, ECS Anywhere instances,
 * and SSM managed on-premises nodes — maps them to the unified
 * HybridDiscoveryAdapter interface for graph coordinator consumption.
 */

import type {
  AwsOutpost,
  AwsOutpostSite,
  AwsOutpostAsset,
  EKSAnywhereCluster,
  ECSAnywhereInstance,
  SSMManagedInstance,
  AwsHybridDiscoveryResult,
  AwsOutpostListOptions,
  AwsHybridClusterListOptions,
} from "./types.js";

// ── Local KG type mirrors (cross-extension rootDir pattern) ─────────────────

type ConnectivityStatus = "connected" | "intermittent" | "disconnected" | "unknown";
type HybridSiteCapability = "compute" | "storage" | "networking" | "ai-inference" | "gpu" | "disconnected-ops";
type FleetClusterStatus = "healthy" | "degraded" | "offline" | "provisioning";

type HybridSite = {
  id: string;
  name: string;
  provider: "aws";
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
  provider: "aws";
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

export class AwsOutpostsDiscoveryAdapter implements HybridDiscoveryAdapter {
  constructor(
    private region: string,
    private options: {
      siteId?: string;
    } = {},
  ) {}

  // ── HybridDiscoveryAdapter interface ────────────────────────────────

  async discoverSites(): Promise<HybridSite[]> {
    const [sites, outposts, assets] = await Promise.all([
      this.listOutpostSites(),
      this.listOutposts(),
      this.listOutpostAssets(),
    ]);

    return sites.map((site) => {
      const siteOutposts = outposts.filter((o) => o.siteId === site.siteId);
      const siteAssets = assets.filter((a) =>
        siteOutposts.some((o) => o.outpostId === a.rackId),
      );

      const address = [
        site.operatingAddressCity,
        site.operatingAddressStateOrRegion,
        site.operatingAddressCountryCode,
      ]
        .filter(Boolean)
        .join(", ");

      return {
        id: site.siteId,
        name: site.name,
        provider: "aws" as const,
        type: "datacenter" as const,
        parentCloudRegion: this.region,
        status: siteOutposts.length > 0 ? inferOutpostSiteStatus(siteOutposts) : ("unknown" as ConnectivityStatus),
        capabilities: inferOutpostCapabilities(siteAssets),
        resourceCount: siteAssets.length,
        location: address ? { latitude: 0, longitude: 0, address } : undefined,
        managedClusters: [],
        metadata: {
          outpostCount: siteOutposts.length,
          assetCount: siteAssets.length,
          region: this.region,
          rackProperties: site.rackPhysicalProperties,
        },
      };
    });
  }

  async discoverFleet(): Promise<FleetCluster[]> {
    const eksAnywhere = await this.listEKSAnywhereClusters();

    return eksAnywhere.map((c) => ({
      id: c.arn ?? c.name,
      name: c.name,
      provider: "aws" as const,
      kubernetesVersion: c.kubernetesVersion,
      nodeCount: c.controlPlaneNodeCount + c.workerNodeCount,
      status: mapEKSAnywhereStatus(c.status),
      connectivity: c.connectorId ? ("connected" as ConnectivityStatus) : ("unknown" as ConnectivityStatus),
      location: {
        siteId: undefined,
        region: c.region,
        parentRegion: this.region,
      },
      labels: c.tags,
      lastHeartbeat: undefined,
    }));
  }

  async discoverConnections(): Promise<HybridConnection[]> {
    // AWS hybrid connections are typically Direct Connect or VPN;
    // these are discovered via the networking module, not the Outposts API
    return [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.listOutposts();
      return true;
    } catch {
      return false;
    }
  }

  // ── AWS REST Stubs ────────────────────────────────────────────────────
  //
  // These call the AWS Outposts / EKS / ECS / SSM APIs. In production
  // they would use the AWS SDK. For now they serve as typed contracts.

  async listOutposts(_opts?: AwsOutpostListOptions): Promise<AwsOutpost[]> {
    // TODO: implement via @aws-sdk/client-outposts
    return [];
  }

  async listOutpostSites(): Promise<AwsOutpostSite[]> {
    // TODO: implement via @aws-sdk/client-outposts
    return [];
  }

  async listOutpostAssets(): Promise<AwsOutpostAsset[]> {
    // TODO: implement via @aws-sdk/client-outposts
    return [];
  }

  async listEKSAnywhereClusters(
    _opts?: AwsHybridClusterListOptions,
  ): Promise<EKSAnywhereCluster[]> {
    // TODO: implement via @aws-sdk/client-eks
    return [];
  }

  async listECSAnywhereInstances(): Promise<ECSAnywhereInstance[]> {
    // TODO: implement via @aws-sdk/client-ecs
    return [];
  }

  async listSSMManagedInstances(): Promise<SSMManagedInstance[]> {
    // TODO: implement via @aws-sdk/client-ssm
    return [];
  }

  /**
   * Full discovery: combines all AWS hybrid resource types.
   */
  async discoverAll(): Promise<AwsHybridDiscoveryResult> {
    const [
      outposts,
      outpostSites,
      outpostAssets,
      eksAnywhereClusters,
      ecsAnywhereInstances,
      ssmManagedInstances,
    ] = await Promise.all([
      this.listOutposts(),
      this.listOutpostSites(),
      this.listOutpostAssets(),
      this.listEKSAnywhereClusters(),
      this.listECSAnywhereInstances(),
      this.listSSMManagedInstances(),
    ]);

    return {
      outposts,
      outpostSites,
      outpostAssets,
      eksAnywhereClusters,
      ecsAnywhereInstances,
      ssmManagedInstances,
      region: this.region,
      discoveredAt: new Date().toISOString(),
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function inferOutpostSiteStatus(outposts: AwsOutpost[]): ConnectivityStatus {
  const statuses = outposts.map((o) => o.lifeCycleStatus);
  if (statuses.every((s) => s === "ACTIVE")) return "connected";
  if (statuses.some((s) => s === "ACTIVE")) return "intermittent";
  return "disconnected";
}

function inferOutpostCapabilities(
  assets: AwsOutpostAsset[],
): HybridSiteCapability[] {
  const caps: HybridSiteCapability[] = ["compute", "networking"];
  if (assets.length > 0) {
    caps.push("storage");
  }
  // Outposts support local compute but not fully disconnected ops
  return caps;
}

function mapEKSAnywhereStatus(
  status: EKSAnywhereCluster["status"],
): FleetClusterStatus {
  switch (status) {
    case "ACTIVE":
      return "healthy";
    case "CREATING":
    case "UPDATING":
      return "provisioning";
    case "FAILED":
      return "degraded";
    case "DELETING":
      return "offline";
    default:
      return "degraded";
  }
}
