/**
 * Type definitions for Azure Notification Hubs resources.
 */

/** An Azure Notification Hubs namespace. */
export interface NotificationHubNamespace {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState: string | undefined;
  status: string | undefined;
  enabled: boolean | undefined;
  critical: boolean | undefined;
  skuName: string | undefined;
  skuTier: string | undefined;
  skuCapacity: number | undefined;
  serviceBusEndpoint: string | undefined;
  scaleUnit: string | undefined;
  namespaceType: string | undefined;
  createdAt: Date | undefined;
  updatedAt: Date | undefined;
  tags: Record<string, string>;
}

/** A notification hub within a namespace. */
export interface NotificationHub {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  registrationTtl: string | undefined;
  dailyMaxActiveDevices: number | undefined;
  tags: Record<string, string>;
}

/** A Notification Hubs authorization rule. */
export interface NotificationHubAuthorizationRule {
  id: string;
  name: string;
  rights: string[];
}
