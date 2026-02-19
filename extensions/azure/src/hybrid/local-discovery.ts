/**
 * Azure Local / HCI Discovery Adapter
 *
 * Discovers Azure Local (formerly Azure Stack HCI) clusters, VMs,
 * virtual networks, and storage containers running on customer-owned
 * hardware. Maps them to the HybridDiscoveryAdapter interface.
 *
 * Azure Local resources are native ARM resources managed via Azure Arc,
 * so we use the same ARM SDK pattern as arc-discovery.ts.
 */

import type {
  AzureStackHCICluster,
  AzureCustomLocation,
  AzureLocalDevice,
} from "./types.js";

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

// ── Azure Local VM + Network + Storage types ────────────────────────────────

export type AzureLocalVM = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  status: "Running" | "Stopped" | "Starting" | "Stopping" | "Failed" | "Unknown";
  hardwareProfile?: {
    vmSize?: string;
    processors?: number;
    memoryMB?: number;
  };
  osProfile?: {
    computerName?: string;
    osType?: "Windows" | "Linux";
  };
  storageProfile?: {
    osDisk?: { name?: string; sizeGB?: number };
    dataDisks?: { name?: string; sizeGB?: number }[];
  };
  networkProfile?: {
    networkInterfaces?: string[];
  };
  hciClusterId: string;
  tags: Record<string, string>;
};

export type AzureLocalNetwork = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  networkType: "nat" | "transparent" | "l2bridge" | "l2tunnel" | "ics" | "private" | "overlay" | "internal";
  vmSwitchName?: string;
  subnets?: { name: string; addressPrefix: string }[];
  hciClusterId: string;
  provisioningState: string;
  tags: Record<string, string>;
};

export type AzureLocalStorage = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  path: string;
  provisioningState: string;
  sizeGB?: number;
  hciClusterId: string;
  tags: Record<string, string>;
};

// ── Adapter ─────────────────────────────────────────────────────────────────────

export class AzureLocalDiscoveryAdapter implements HybridDiscoveryAdapter {
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
    const localDevices = await this.listLocalDevices();

    const sites: HybridSite[] = [];

    // Map HCI clusters to datacenter/edge sites
    for (const hci of hciClusters) {
      const vms = await this.listHCIVirtualMachines(hci.id);

      sites.push({
        id: hci.id,
        name: hci.name,
        provider: "azure",
        type: "datacenter",
        parentCloudRegion: hci.location,
        status: mapHCIStatus(hci.status),
        capabilities: inferHCICapabilities(hci),
        resourceCount: hci.nodeCount + vms.length,
        managedClusters: [],
        managedVMs: vms.map((vm) => vm.id),
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

    // Map Azure Local devices (Azure Stack Edge) to edge sites
    const existingIds = new Set(sites.map((s) => s.id));
    for (const device of localDevices) {
      if (existingIds.has(device.id)) continue;

      sites.push({
        id: device.id,
        name: device.name,
        provider: "azure",
        type: "edge-site",
        parentCloudRegion: device.location,
        status: "connected", // ASE devices are always connected when visible
        capabilities: inferDeviceCapabilities(device),
        resourceCount: device.nodeCount ?? 1,
        managedClusters: [],
        managedVMs: [],
        metadata: {
          deviceType: device.deviceType,
          serialNumber: device.serialNumber,
          modelDescription: device.modelDescription,
          softwareVersion: device.deviceSoftwareVersion,
          localCapacityGB: device.deviceLocalCapacity,
          roleTypes: device.configuredRoleTypes,
        },
      });
    }

    return sites;
  }

  async discoverFleet(): Promise<FleetCluster[]> {
    // Azure Local runs AKS-HCI clusters; discover via HCI cluster metadata
    const hciClusters = await this.listHCIClusters();
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
    const hciClusters = await this.listHCIClusters();

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
    const hciClusters = await this.listHCIClusters();
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

      // VMs on this cluster
      const vms = await this.listHCIVirtualMachines(hci.id);
      for (const vm of vms) {
        nodes.push({
          id: `azure::${hci.location}:compute-instance:${vm.id}`,
          provider: "azure",
          resourceType: "compute",
          nativeId: vm.id,
          name: vm.name,
          region: hci.location,
          account: this.subscriptionId,
          status: mapVMStatus(vm.status),
          tags: vm.tags,
          metadata: {
            hciClusterId: hci.id,
            osType: vm.osProfile?.osType,
            processors: vm.hardwareProfile?.processors,
            memoryMB: vm.hardwareProfile?.memoryMB,
          },
          costMonthly: null,
          owner: null,
          createdAt: null,
        });
      }

      // Networks
      const networks = await this.listHCINetworks(hci.id);
      for (const net of networks) {
        nodes.push({
          id: `azure::${hci.location}:virtual-network:${net.id}`,
          provider: "azure",
          resourceType: "network",
          nativeId: net.id,
          name: net.name,
          region: hci.location,
          account: this.subscriptionId,
          status: net.provisioningState === "Succeeded" ? "running" : "pending",
          tags: net.tags,
          metadata: {
            hciClusterId: hci.id,
            networkType: net.networkType,
            subnets: net.subnets,
          },
          costMonthly: null,
          owner: null,
          createdAt: null,
        });
      }

      // Storage containers
      const storage = await this.listHCIStorage(hci.id);
      for (const sc of storage) {
        nodes.push({
          id: `azure::${hci.location}:storage-bucket:${sc.id}`,
          provider: "azure",
          resourceType: "storage",
          nativeId: sc.id,
          name: sc.name,
          region: hci.location,
          account: this.subscriptionId,
          status: sc.provisioningState === "Succeeded" ? "running" : "pending",
          tags: sc.tags,
          metadata: {
            hciClusterId: hci.id,
            path: sc.path,
            sizeGB: sc.sizeGB,
          },
          costMonthly: null,
          owner: null,
          createdAt: null,
        });
      }
    }

    return nodes;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const clusters = await this.listHCIClusters();
      return clusters.length >= 0;
    } catch {
      return false;
    }
  }

  // ── Azure REST Stubs ──────────────────────────────────────────────────
  //
  // These call the Azure ARM APIs via the Azure SDK. For now they serve
  // as typed contracts that real SDK integration will fill in.

  async listHCIClusters(): Promise<AzureStackHCICluster[]> {
    void this.options;
    // TODO: implement via @azure/arm-azurestackhci
    return [];
  }

  async listHCIVirtualMachines(_clusterId: string): Promise<AzureLocalVM[]> {
    // TODO: implement via @azure/arm-azurestackhci virtualMachineInstances.list()
    return [];
  }

  async listHCINetworks(_clusterId: string): Promise<AzureLocalNetwork[]> {
    // TODO: implement via @azure/arm-azurestackhci logicalNetworks.list()
    return [];
  }

  async listHCIStorage(_clusterId: string): Promise<AzureLocalStorage[]> {
    // TODO: implement via @azure/arm-azurestackhci storageContainers.list()
    return [];
  }

  async listLocalDevices(): Promise<AzureLocalDevice[]> {
    // TODO: implement via @azure/arm-databoxedge devices.listBySubscription()
    return [];
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

function mapVMStatus(status: string): GraphNodeStatus {
  switch (status) {
    case "Running":
      return "running";
    case "Stopped":
      return "stopped";
    case "Starting":
    case "Stopping":
      return "pending";
    case "Failed":
      return "error";
    default:
      return "unknown";
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

function inferDeviceCapabilities(device: AzureLocalDevice): HybridSiteCapability[] {
  const caps: HybridSiteCapability[] = ["compute"];

  if (device.deviceLocalCapacity && device.deviceLocalCapacity > 0) {
    caps.push("storage");
  }

  // AI-capable devices
  if (device.configuredRoleTypes?.includes("GPU")) {
    caps.push("gpu");
    caps.push("ai-inference");
  }

  // IoT/edge roles
  if (device.configuredRoleTypes?.includes("IoT")) {
    caps.push("networking");
  }

  return caps;
}
