/**
 * GCP Hybrid / Fleet / GDC Types
 *
 * Type definitions for GKE Fleet (Anthos), GKE on-prem,
 * GKE on Bare Metal, and Google Distributed Cloud (GDC).
 */

// ── GKE Fleet ───────────────────────────────────────────────────────────────────

export type GKEFleetMembershipState =
  | "MEMBERSHIP_STATE_UNSPECIFIED"
  | "CREATING"
  | "READY"
  | "DELETING"
  | "UPDATING"
  | "SERVICE_UPDATING";

export type GKEFleet = {
  name: string; // projects/{project}/locations/{location}/fleets/{fleet}
  displayName?: string;
  createTime: string;
  updateTime?: string;
  deleteTime?: string;
  uid: string;
  state: { code: "OK" | "WARNING" | "ERROR" };
  labels?: Record<string, string>;
};

export type GKEFleetMembership = {
  name: string; // projects/{project}/locations/{location}/memberships/{membership}
  endpoint: GKEFleetEndpoint;
  state: { code: GKEFleetMembershipState; description?: string };
  authority?: { issuer: string; workloadIdentityPool?: string };
  createTime: string;
  updateTime?: string;
  uniqueId: string;
  labels?: Record<string, string>;
  externalId?: string;
  lastConnectionTime?: string;
  infrastructureType?: "ON_PREM" | "MULTI_CLOUD";
};

export type GKEFleetEndpoint =
  | { gkeCluster: { resourceLink: string; clusterMissing?: boolean } }
  | { onPremCluster: { resourceLink: string; adminCluster?: boolean; clusterMissing?: boolean } }
  | { multiCloudCluster: { resourceLink: string; clusterMissing?: boolean } }
  | { edgeCluster: { resourceLink: string } }
  | { applianceCluster: { resourceLink?: string } };

// ── GKE On-Prem (Anthos Clusters) ──────────────────────────────────────────────

export type GKEOnPremClusterState =
  | "STATE_UNSPECIFIED"
  | "PROVISIONING"
  | "RUNNING"
  | "RECONCILING"
  | "STOPPING"
  | "ERROR"
  | "DEGRADED";

export type GKEOnPremCluster = {
  name: string; // projects/{project}/locations/{location}/vmwareClusters/{cluster}
  adminClusterName?: string;
  description?: string;
  onPremVersion: string;
  endpoint?: string;
  state: GKEOnPremClusterState;
  createTime: string;
  updateTime?: string;
  localName?: string;
  controlPlaneNode?: {
    cpus: number;
    memory: number;
    replicas: number;
  };
  loadBalancer?: {
    vipConfig?: { controlPlaneVip: string; ingressVip: string };
  };
  vcenter?: {
    address?: string;
    datacenter?: string;
    cluster?: string;
    datastore?: string;
    folder?: string;
    resourcePool?: string;
  };
  status?: { conditions?: Array<{ type: string; status: string; message?: string }> };
  uid: string;
  fleet?: { membership: string };
};

// ── GKE on Bare Metal ───────────────────────────────────────────────────────────

export type GKEBareMetalClusterState =
  | "STATE_UNSPECIFIED"
  | "PROVISIONING"
  | "RUNNING"
  | "RECONCILING"
  | "STOPPING"
  | "ERROR"
  | "DEGRADED";

export type GKEBareMetalCluster = {
  name: string; // projects/{project}/locations/{location}/bareMetalClusters/{cluster}
  adminClusterName?: string;
  description?: string;
  bareMetalVersion: string;
  endpoint?: string;
  state: GKEBareMetalClusterState;
  createTime: string;
  updateTime?: string;
  localName?: string;
  controlPlane?: {
    controlPlaneNodePoolConfig?: {
      nodePoolConfig?: {
        nodeConfigs?: Array<{ nodeIp?: string }>;
        operatingSystem?: string;
      };
    };
  };
  uid: string;
  fleet?: { membership: string };
  nodeCount?: number;
};

// ── Google Distributed Cloud (GDC) ──────────────────────────────────────────────

export type GDCZone = {
  name: string; // projects/{project}/locations/{location}/zones/{zone}
  displayName?: string;
  state: "STATE_UNSPECIFIED" | "CREATING" | "ACTIVE" | "DELETING";
  createTime: string;
  labels?: Record<string, string>;
};

export type GDCNode = {
  name: string;
  nodeId: string;
  zone: string;
  machineType: string;
  state: "STATE_UNSPECIFIED" | "PROVISIONING" | "RUNNING" | "STOPPED" | "ERROR";
  createTime: string;
  labels?: Record<string, string>;
};

// ── Discovery Result ────────────────────────────────────────────────────────────

export type GcpHybridDiscoveryResult = {
  fleets: GKEFleet[];
  memberships: GKEFleetMembership[];
  onPremClusters: GKEOnPremCluster[];
  bareMetalClusters: GKEBareMetalCluster[];
  gdcZones: GDCZone[];
  gdcNodes: GDCNode[];
  projectId: string;
  discoveredAt: string;
};

// ── List Options ────────────────────────────────────────────────────────────────

export type GcpFleetListOptions = {
  projectId?: string;
  location?: string;
};

export type GcpOnPremClusterListOptions = {
  projectId?: string;
  location?: string;
  state?: GKEOnPremClusterState;
};
