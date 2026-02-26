/**
 * Azure Containers — Type Definitions (AKS, ACI, ACR)
 */

export type AKSCluster = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  kubernetesVersion: string;
  provisioningState: string;
  powerState: string;
  nodeCount: number;
  fqdn?: string;
  agentPoolProfiles: AKSNodePool[];
  tags?: Record<string, string>;
};

export type AKSNodePool = {
  name: string;
  count: number;
  vmSize: string;
  osType: string;
  mode: "System" | "User";
  enableAutoScaling: boolean;
  minCount?: number;
  maxCount?: number;
};

export type ContainerInstance = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  osType: string;
  state: string;
  containers: ContainerInfo[];
  ipAddress?: string;
  tags?: Record<string, string>;
};

export type ContainerInfo = {
  name: string;
  image: string;
  cpu: number;
  memoryInGB: number;
  ports: number[];
  state?: string;
};

export type ContainerRegistry = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  sku: string;
  loginServer: string;
  adminUserEnabled: boolean;
  tags?: Record<string, string>;
};

export type AKSClusterCreateOptions = {
  name: string;
  resourceGroup: string;
  location: string;
  kubernetesVersion?: string;
  dnsPrefix?: string;
  nodePoolName?: string;
  nodeCount?: number;
  vmSize?: string;
  enableAutoScaling?: boolean;
  minCount?: number;
  maxCount?: number;
  tags?: Record<string, string>;
};
