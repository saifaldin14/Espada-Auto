/**
 * Hybrid/Edge Infrastructure — Shared Types
 *
 * Provider-agnostic abstractions for edge sites, fleet clusters,
 * hybrid topology, and discovery adapters.
 */

// Re-export KG types used throughout the hybrid extension.
// Local mirrors to avoid cross-extension rootDir issues.
export type CloudProvider =
  | "aws"
  | "azure"
  | "gcp"
  | "kubernetes"
  | "custom"
  | "azure-arc"
  | "gdc"
  | "vmware"
  | "nutanix";

export type ConnectivityStatus =
  | "connected"
  | "degraded"
  | "disconnected"
  | "unknown";

export type GraphNodeLocationType =
  | "cloud-region"
  | "availability-zone"
  | "edge-site"
  | "on-premises"
  | "custom-location";

export type GraphNodeLocation = {
  type: GraphNodeLocationType;
  name: string;
  provider: CloudProvider;
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

// ── Graph type mirrors ──────────────────────────────────────────────────────────

export type GraphResourceType =
  | "compute"
  | "storage"
  | "network"
  | "database"
  | "cache"
  | "queue"
  | "function"
  | "serverless-function"
  | "container"
  | "cluster"
  | "load-balancer"
  | "dns"
  | "certificate"
  | "secret"
  | "policy"
  | "identity"
  | "vpc"
  | "subnet"
  | "security-group"
  | "iam-role"
  | "nat-gateway"
  | "api-gateway"
  | "cdn"
  | "topic"
  | "stream"
  | "custom"
  | "hybrid-machine"
  | "connected-cluster"
  | "custom-location"
  | "outpost"
  | "edge-site"
  | "hci-cluster"
  | "fleet";

export type GraphRelationshipType =
  | "runs-in"
  | "contains"
  | "secured-by"
  | "routes-to"
  | "depends-on"
  | "uses"
  | "attached-to"
  | "managed-by"
  | "hosted-on"
  | "member-of-fleet"
  | "deployed-at"
  | "connected-to"
  | "custom";

export type GraphNodeStatus =
  | "running"
  | "stopped"
  | "pending"
  | "creating"
  | "deleting"
  | "deleted"
  | "error"
  | "unknown"
  | "disappeared";

export type GraphNodeInput = {
  id: string;
  provider: CloudProvider;
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

export type GraphEdgeInput = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: GraphRelationshipType;
  confidence: number;
  discoveredVia: "config-scan" | "api-field" | "runtime-trace" | "iac-parse" | "event-stream" | "manual";
  metadata: Record<string, unknown>;
};

export type GraphNode = GraphNodeInput & {
  discoveredAt: string;
  updatedAt: string;
  lastSeenAt: string;
};

export type GraphEdge = GraphEdgeInput & {
  createdAt: string;
  lastSeenAt: string;
};

// ── Hybrid Site ─────────────────────────────────────────────────────────────────

/** Capability of a physical edge/on-premises site. */
export type HybridSiteCapability =
  | "compute"
  | "containers"
  | "storage"
  | "ai-inference"
  | "disconnected-ops"
  | "sovereign";

/**
 * Represents a physical edge or on-premises site where infrastructure
 * is deployed — a warehouse, factory, branch office, data centre, etc.
 */
export type HybridSite = {
  /** Unique site identifier. */
  id: string;
  /** Human-readable site name. */
  name: string;
  /** Cloud provider managing this site. */
  provider: CloudProvider;
  /** Physical / logical location. */
  location: GraphNodeLocation;
  /** Current connectivity to parent cloud. */
  status: ConnectivityStatus;
  /** Cloud region this site connects to. */
  parentCloudRegion: string;
  /** Number of resources deployed at this site. */
  resourceCount: number;
  /** K8s cluster node IDs at this site. */
  managedClusters: string[];
  /** Machine node IDs at this site. */
  managedMachines: string[];
  /** Site capabilities. */
  capabilities: HybridSiteCapability[];
  /** Last successful sync timestamp. */
  lastSyncAt: string;
  /** Additional metadata. */
  metadata: Record<string, unknown>;
};

// ── Fleet Cluster ───────────────────────────────────────────────────────────────

/**
 * A Kubernetes cluster in a fleet — may be cloud-hosted, on-premises,
 * or running on edge hardware.
 */
export type FleetCluster = {
  id: string;
  name: string;
  provider: CloudProvider;
  fleetId?: string;
  location: GraphNodeLocation;
  kubernetesVersion: string;
  nodeCount: number;
  status: "running" | "stopped" | "degraded" | "unknown";
  managedBy: "gke" | "aks" | "eks" | "arc" | "self-managed";
  connectivity: ConnectivityStatus;
  workloadCount?: number;
  lastHeartbeat?: string;
};

// ── Hybrid Topology ─────────────────────────────────────────────────────────────

/** A network link between two locations (edge site ↔ cloud region). */
export type HybridConnection = {
  from: string;
  to: string;
  status: ConnectivityStatus;
  latencyMs?: number;
  bandwidth?: string;
};

/**
 * Full hybrid topology snapshot — cloud regions, edge sites, fleet
 * clusters, and their interconnections.
 */
export type HybridTopology = {
  cloudRegions: {
    provider: CloudProvider;
    region: string;
    resourceCount: number;
    edgeSites: HybridSite[];
  }[];
  edgeSites: HybridSite[];
  fleetClusters: FleetCluster[];
  connections: HybridConnection[];
  summary: {
    totalCloudResources: number;
    totalEdgeResources: number;
    totalSites: number;
    totalClusters: number;
    connectedSites: number;
    disconnectedSites: number;
  };
};

// ── Discovery Adapter Interface ─────────────────────────────────────────────────

/**
 * Interface that each provider-specific hybrid discovery module implements.
 * The HybridDiscoveryCoordinator calls these adapters to build the unified
 * topology view.
 */
export interface HybridDiscoveryAdapter {
  /** Which provider this adapter covers. */
  provider: CloudProvider;
  /** Discover physical / logical edge sites. */
  discoverSites(): Promise<HybridSite[]>;
  /** Discover Kubernetes clusters (fleet view). */
  discoverFleetClusters(): Promise<FleetCluster[]>;
  /** Discover all hybrid resources as graph node inputs. */
  discoverHybridResources(): Promise<GraphNodeInput[]>;
  /** Quick connectivity health-check. */
  healthCheck(): Promise<boolean>;
}
