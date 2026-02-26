/**
 * Azure Digital Twins types.
 */

/** An Azure Digital Twins instance. */
export interface AzureDigitalTwinsInstance {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  hostName?: string;
  publicNetworkAccess?: string;
  createdTime?: string;
  lastUpdatedTime?: string;
  tags: Record<string, string>;
}

/** An endpoint on an Azure Digital Twins instance. */
export interface AzureDigitalTwinsEndpoint {
  id: string;
  name: string;
  endpointType?: string;
  provisioningState?: string;
  createdTime?: string;
  authenticationType?: string;
  deadLetterSecret?: string;
}

/** A private endpoint connection on an Azure Digital Twins instance. */
export interface AzureDigitalTwinsPrivateEndpoint {
  id: string;
  name: string;
  privateEndpointId?: string;
  connectionState?: string;
  provisioningState?: string;
  groupIds?: string[];
}
