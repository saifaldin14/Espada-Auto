/**
 * Azure Synapse Analytics types.
 */

/** Synapse workspace. */
export interface SynapseWorkspace {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  managedResourceGroupName?: string;
  sqlAdministratorLogin?: string;
  connectivityEndpoints?: Record<string, string>;
  defaultDataLakeStorage?: SynapseDataLakeStorage;
  managedVirtualNetwork?: string;
  publicNetworkAccess?: string;
  tags?: Record<string, string>;
}

export interface SynapseDataLakeStorage {
  accountUrl?: string;
  filesystem?: string;
}

/** Synapse SQL pool (dedicated). */
export interface SynapseSqlPool {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  status?: string;
  skuName?: string;
  skuCapacity?: number;
  maxSizeBytes?: number;
  collation?: string;
  provisioningState?: string;
  restorePointInTime?: string;
  createMode?: string;
  tags?: Record<string, string>;
}

/** Synapse Spark pool (Big Data pool). */
export interface SynapseSparkPool {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  nodeSize?: string;
  nodeSizeFamily?: string;
  nodeCount?: number;
  autoScaleEnabled?: boolean;
  autoScaleMinNodeCount?: number;
  autoScaleMaxNodeCount?: number;
  autoPauseEnabled?: boolean;
  autoPauseDelayInMinutes?: number;
  sparkVersion?: string;
  isComputeIsolationEnabled?: boolean;
  tags?: Record<string, string>;
}
