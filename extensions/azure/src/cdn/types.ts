/**
 * Azure CDN — Type Definitions
 */

export type CDNSkuName = "Standard_Microsoft" | "Standard_Akamai" | "Standard_Verizon" | "Premium_Verizon" | "Standard_AzureFrontDoor" | "Premium_AzureFrontDoor";

export type CDNProfile = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  sku: CDNSkuName;
  provisioningState?: string;
  resourceState?: string;
  frontDoorId?: string;
};

export type CDNEndpoint = {
  id: string;
  name: string;
  profileName: string;
  hostName?: string;
  originHostHeader?: string;
  isHttpAllowed?: boolean;
  isHttpsAllowed?: boolean;
  isCompressionEnabled?: boolean;
  provisioningState?: string;
  resourceState?: string;
  origins: Array<{ name: string; hostName: string }>;
};

export type CDNCustomDomain = {
  id: string;
  name: string;
  endpointName: string;
  hostName: string;
  validationData?: string;
  provisioningState?: string;
  resourceState?: string;
  customHttpsProvisioningState?: string;
};

export type CDNOrigin = {
  id: string;
  name: string;
  hostName: string;
  httpPort?: number;
  httpsPort?: number;
  enabled?: boolean;
  priority?: number;
  weight?: number;
  originHostHeader?: string;
};
