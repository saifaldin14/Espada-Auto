/**
 * Azure Spring Apps types.
 */

/** An Azure Spring Apps service instance. */
export interface AzureSpringApp {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  skuName?: string;
  skuTier?: string;
  version?: number;
  serviceId?: string;
  networkProfile?: {
    serviceRuntimeSubnetId?: string;
    appSubnetId?: string;
    outboundType?: string;
  };
  fqdn?: string;
  powerState?: string;
  zoneRedundant?: boolean;
  tags: Record<string, string>;
}

/** An app within an Azure Spring Apps service. */
export interface AzureSpringAppDeployment {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  activeDeploymentName?: string;
  url?: string;
  httpsOnly?: boolean;
  isPublic?: boolean;
  fqdn?: string;
  temporaryDisk?: { sizeInGB?: number; mountPath?: string };
  persistentDisk?: { sizeInGB?: number; mountPath?: string; usedInGB?: number };
}

/** A deployment within an app. */
export interface AzureSpringDeployment {
  id: string;
  name: string;
  provisioningState?: string;
  status?: string;
  active?: boolean;
  instances?: AzureSpringDeploymentInstance[];
}

/** An instance within a deployment. */
export interface AzureSpringDeploymentInstance {
  name?: string;
  status?: string;
  discoveryStatus?: string;
  startTime?: string;
  zone?: string;
}
