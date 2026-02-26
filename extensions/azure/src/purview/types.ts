/**
 * Microsoft Purview types.
 */

/** A Purview account. */
export interface AzurePurviewAccount {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  friendlyName?: string;
  skuName?: string;
  skuCapacity?: number;
  publicNetworkAccess?: string;
  managedResourceGroupName?: string;
  createdAt?: string;
  createdBy?: string;
  endpoints?: {
    catalog?: string;
    scan?: string;
    guardian?: string;
  };
  managedResources?: {
    storageAccount?: string;
    resourceGroup?: string;
    eventHubNamespace?: string;
  };
  tags: Record<string, string>;
}

/** A private endpoint connection on a Purview account. */
export interface AzurePurviewPrivateEndpoint {
  id: string;
  name: string;
  privateEndpointId?: string;
  connectionState?: string;
  provisioningState?: string;
}
