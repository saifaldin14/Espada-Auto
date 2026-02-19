/**
 * Hybrid/Edge Graph Model — helpers for creating hybrid-specific
 * Knowledge Graph nodes and edges.
 */

import type {
  HybridSite,
  FleetCluster,
  GraphNodeInput,
  GraphEdgeInput,
  GraphRelationshipType,
  CloudProvider,
} from "./types.js";

// ── Node Factories ──────────────────────────────────────────────────────────────

/**
 * Build a graph node representing a physical edge site.
 */
export function createEdgeSiteNode(site: HybridSite): GraphNodeInput {
  return {
    id: buildNodeId(site.provider, site.id, site.location.region ?? "edge", "edge-site"),
    provider: site.provider,
    resourceType: "edge-site",
    nativeId: site.id,
    name: site.name,
    region: site.location.region ?? site.parentCloudRegion,
    account: "",
    status: connectivityToStatus(site.status),
    tags: {},
    metadata: {
      locationType: site.location.type,
      locationName: site.location.name,
      parentCloudRegion: site.parentCloudRegion,
      capabilities: site.capabilities,
      resourceCount: site.resourceCount,
      managedClusters: site.managedClusters,
      managedMachines: site.managedMachines,
      coordinates: site.location.coordinates,
      address: site.location.address,
      connectivityStatus: site.status,
    },
    costMonthly: null,
    owner: null,
    createdAt: null,
  };
}

/**
 * Build a graph node representing a fleet (group of K8s clusters).
 */
export function createFleetNode(fleet: {
  id: string;
  name: string;
  provider: CloudProvider;
  region: string;
  clusterCount: number;
  metadata?: Record<string, unknown>;
}): GraphNodeInput {
  return {
    id: buildNodeId(fleet.provider, fleet.id, fleet.region, "fleet"),
    provider: fleet.provider,
    resourceType: "fleet",
    nativeId: fleet.id,
    name: fleet.name,
    region: fleet.region,
    account: "",
    status: "running",
    tags: {},
    metadata: {
      clusterCount: fleet.clusterCount,
      ...fleet.metadata,
    },
    costMonthly: null,
    owner: null,
    createdAt: null,
  };
}

/**
 * Build a graph node representing a K8s cluster in a fleet.
 */
export function createClusterNode(cluster: FleetCluster): GraphNodeInput {
  return {
    id: buildNodeId(
      cluster.provider,
      cluster.id,
      cluster.location.region ?? "edge",
      "connected-cluster",
    ),
    provider: cluster.provider,
    resourceType: "connected-cluster",
    nativeId: cluster.id,
    name: cluster.name,
    region: cluster.location.region ?? "",
    account: "",
    status: clusterStatusToNodeStatus(cluster.status),
    tags: {},
    metadata: {
      kubernetesVersion: cluster.kubernetesVersion,
      nodeCount: cluster.nodeCount,
      managedBy: cluster.managedBy,
      fleetId: cluster.fleetId,
      connectivity: cluster.connectivity,
      workloadCount: cluster.workloadCount,
      lastHeartbeat: cluster.lastHeartbeat,
      locationType: cluster.location.type,
      locationName: cluster.location.name,
    },
    costMonthly: null,
    owner: null,
    createdAt: null,
  };
}

/**
 * Build a directed graph edge with hybrid-specific relationship types.
 */
export function createHybridEdge(
  sourceId: string,
  targetId: string,
  relationship: GraphRelationshipType,
  metadata?: Record<string, unknown>,
): GraphEdgeInput {
  return {
    id: `${sourceId}--${relationship}--${targetId}`,
    sourceNodeId: sourceId,
    targetNodeId: targetId,
    relationshipType: relationship,
    confidence: 1.0,
    discoveredVia: "api-field",
    metadata: metadata ?? {},
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

/**
 * Deterministic node ID following the KG convention:
 * `{provider}:{account}:{region}:{resourceType}:{nativeId}`
 */
export function buildNodeId(
  provider: CloudProvider,
  nativeId: string,
  region: string,
  resourceType: string,
): string {
  return `${provider}::${region}:${resourceType}:${nativeId}`;
}

function connectivityToStatus(status: string): "running" | "error" | "unknown" {
  switch (status) {
    case "connected":
      return "running";
    case "degraded":
    case "disconnected":
      return "error";
    default:
      return "unknown";
  }
}

function clusterStatusToNodeStatus(
  status: "running" | "stopped" | "degraded" | "unknown",
): "running" | "stopped" | "error" | "unknown" {
  switch (status) {
    case "running":
      return "running";
    case "stopped":
      return "stopped";
    case "degraded":
      return "error";
    default:
      return "unknown";
  }
}
