/**
 * Azure Hybrid / Arc Types
 *
 * Type definitions for Azure Arc servers, Arc-enabled Kubernetes,
 * Azure Stack HCI, and Azure Custom Locations.
 */

import type { AzureRegion, AzureResource, AzureTagSet } from "../types.js";

// ── Azure Arc Server ────────────────────────────────────────────────────────────

export type AzureArcAgentStatus =
  | "Connected"
  | "Disconnected"
  | "Error"
  | "Expired";

export type AzureArcServer = AzureResource & {
  type: "Microsoft.HybridCompute/machines";
  agentVersion: string;
  status: AzureArcAgentStatus;
  osSku: string;
  osType: "Windows" | "Linux";
  domainName?: string;
  machineFqdn?: string;
  lastStatusChange?: string;
  provisioningState: "Succeeded" | "Failed" | "Creating" | "Updating" | "Deleting";
  extensions?: AzureArcExtension[];
};

export type AzureArcExtension = {
  name: string;
  type: string;
  provisioningState: string;
  version?: string;
};

// ── Azure Arc Kubernetes ────────────────────────────────────────────────────────

export type ArcKubernetesConnectivityStatus =
  | "Connected"
  | "Connecting"
  | "Offline"
  | "Expired";

export type AzureArcKubernetesCluster = AzureResource & {
  type: "Microsoft.Kubernetes/connectedClusters";
  distribution: string;
  distributionVersion?: string;
  kubernetesVersion: string;
  totalNodeCount: number;
  totalCoreCount: number;
  agentVersion: string;
  connectivityStatus: ArcKubernetesConnectivityStatus;
  lastConnectivityTime?: string;
  infrastructure: string;
  offering?: string;
  provisioningState: string;
  managedIdentityCertificateExpirationTime?: string;
};

// ── Azure Stack HCI ─────────────────────────────────────────────────────────────

export type AzureStackHCIStatus =
  | "Connected"
  | "Disconnected"
  | "NotYetRegistered"
  | "Error"
  | "DeploymentFailed";

export type AzureStackHCICluster = AzureResource & {
  type: "Microsoft.AzureStackHCI/clusters";
  cloudId?: string;
  status: AzureStackHCIStatus;
  lastBillingTimestamp?: string;
  registrationTimestamp?: string;
  lastSyncTimestamp?: string;
  trialDaysRemaining: number;
  nodeCount: number;
  clusterVersion?: string;
  serviceEndpoint?: string;
};

// ── Custom Location ─────────────────────────────────────────────────────────────

export type AzureCustomLocation = AzureResource & {
  type: "Microsoft.ExtendedLocation/customLocations";
  hostResourceId: string;
  namespace?: string;
  hostType: "Kubernetes";
  provisioningState: string;
  clusterExtensionIds?: string[];
  displayName?: string;
  authentication?: {
    type: string;
    value?: string;
  };
};

// ── Azure Local (Azure Stack Edge / ASE) ────────────────────────────────────────

export type AzureLocalDevice = AzureResource & {
  type: "Microsoft.DataBoxEdge/dataBoxEdgeDevices";
  modelDescription?: string;
  serialNumber?: string;
  deviceType?: string;
  deviceSoftwareVersion?: string;
  deviceLocalCapacity?: number;
  nodeCount?: number;
  timeZone?: string;
  culture?: string;
  configuredRoleTypes?: string[];
};

// ── Discovery Result ────────────────────────────────────────────────────────────

export type AzureHybridDiscoveryResult = {
  arcServers: AzureArcServer[];
  arcClusters: AzureArcKubernetesCluster[];
  hciClusters: AzureStackHCICluster[];
  customLocations: AzureCustomLocation[];
  localDevices: AzureLocalDevice[];
  subscriptionId: string;
  discoveredAt: string;
};

// ── List/Filter Options ─────────────────────────────────────────────────────────

export type AzureArcListOptions = {
  subscriptionId?: string;
  resourceGroup?: string;
  region?: AzureRegion;
  tags?: AzureTagSet;
  status?: AzureArcAgentStatus;
};

export type AzureArcKubernetesListOptions = {
  subscriptionId?: string;
  resourceGroup?: string;
  region?: AzureRegion;
  distribution?: string;
  connectivityStatus?: ArcKubernetesConnectivityStatus;
};
