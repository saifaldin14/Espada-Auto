/**
 * Azure SignalR Service types.
 */

/** SignalR Service resource. */
export interface SignalRResource {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  skuName?: string;
  skuTier?: string;
  skuCapacity?: number;
  hostName?: string;
  publicPort?: number;
  serverPort?: number;
  version?: string;
  kind?: string;
  publicNetworkAccess?: string;
  disableLocalAuth?: boolean;
  disableAadAuth?: boolean;
  externalIp?: string;
  tags?: Record<string, string>;
}

/** SignalR custom domain. */
export interface SignalRCustomDomain {
  id: string;
  name: string;
  domainName?: string;
  provisioningState?: string;
  customCertificateId?: string;
}

/** SignalR private endpoint connection. */
export interface SignalRPrivateEndpointConnection {
  id: string;
  name: string;
  provisioningState?: string;
  privateEndpointId?: string;
  groupIds?: string[];
  connectionState?: string;
}

/** SignalR usage. */
export interface SignalRUsage {
  currentValue?: number;
  limit?: number;
  name?: string;
  unit?: string;
}
