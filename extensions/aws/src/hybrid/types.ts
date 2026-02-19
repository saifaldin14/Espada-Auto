/**
 * AWS Hybrid / Outposts Types
 *
 * Type definitions for AWS Outposts, ECS Anywhere, EKS Anywhere,
 * and SSM-managed on-premises nodes.
 */

// ── AWS Outposts ────────────────────────────────────────────────────────────────

export type AwsOutpostAvailabilityZoneType = "availability-zone" | "availability-zone-id";

export type AwsOutpost = {
  outpostId: string;
  outpostArn: string;
  ownerId: string;
  name: string;
  description?: string;
  siteId: string;
  availabilityZone: string;
  availabilityZoneId: string;
  lifeCycleStatus: string;
  tags?: Record<string, string>;
};

export type AwsOutpostSite = {
  siteId: string;
  siteArn: string;
  accountId: string;
  name: string;
  description?: string;
  operatingAddressCity?: string;
  operatingAddressStateOrRegion?: string;
  operatingAddressCountryCode?: string;
  rackPhysicalProperties?: {
    powerDrawKva?: string;
    powerPhase?: string;
    powerConnector?: string;
    uplinkCount?: number;
    uplinkGbps?: string;
    fiberOpticCableType?: string;
    maximumSupportedWeightLbs?: string;
  };
  tags?: Record<string, string>;
};

export type AwsOutpostAssetType = "COMPUTE";

export type AwsOutpostAsset = {
  assetId: string;
  assetType: AwsOutpostAssetType;
  rackId: string;
  computeAttributes?: {
    hostId?: string;
    state?: "ACTIVE" | "ISOLATED" | "RETIRING";
  };
};

// ── EKS Anywhere ────────────────────────────────────────────────────────────────

export type EKSAnywhereCluster = {
  name: string;
  arn?: string;
  kubernetesVersion: string;
  status: "CREATING" | "ACTIVE" | "DELETING" | "FAILED" | "UPDATING";
  provider: "vsphere" | "bare_metal" | "cloudstack" | "nutanix" | "snow";
  controlPlaneNodeCount: number;
  workerNodeCount: number;
  endpoint?: string;
  region: string;
  connectorId?: string;
  tags?: Record<string, string>;
};

// ── ECS Anywhere ────────────────────────────────────────────────────────────────

export type ECSAnywhereInstance = {
  containerInstanceArn: string;
  ec2InstanceId?: string;
  agentConnected: boolean;
  status: "ACTIVE" | "DRAINING" | "REGISTERING" | "DEREGISTERING" | "REGISTRATION_FAILED";
  registeredAt: string;
  registeredResources: {
    name: string;
    type: string;
    integerValue?: number;
  }[];
  remainingResources: {
    name: string;
    type: string;
    integerValue?: number;
  }[];
  tags?: Record<string, string>;
};

// ── SSM Managed Instance ────────────────────────────────────────────────────────

export type SSMManagedInstance = {
  instanceId: string;
  pingStatus: "Online" | "ConnectionLost" | "Inactive";
  lastPingDateTime?: string;
  agentVersion?: string;
  platformType: "Windows" | "Linux" | "MacOS";
  platformName?: string;
  platformVersion?: string;
  activationId?: string;
  iamRole?: string;
  registrationDate?: string;
  resourceType: "ManagedInstance" | "EC2Instance";
  name?: string;
  ipAddress?: string;
  computerName?: string;
  sourceId?: string;
  sourceType?: string;
};

// ── Discovery Result ────────────────────────────────────────────────────────────

export type AwsHybridDiscoveryResult = {
  outposts: AwsOutpost[];
  outpostSites: AwsOutpostSite[];
  outpostAssets: AwsOutpostAsset[];
  eksAnywhereClusters: EKSAnywhereCluster[];
  ecsAnywhereInstances: ECSAnywhereInstance[];
  ssmManagedInstances: SSMManagedInstance[];
  region: string;
  discoveredAt: string;
};

// ── List/Filter Options ─────────────────────────────────────────────────────────

export type AwsOutpostListOptions = {
  region?: string;
  siteId?: string;
  lifeCycleStatus?: string;
};

export type AwsHybridClusterListOptions = {
  region?: string;
  status?: string;
  provider?: string;
};
