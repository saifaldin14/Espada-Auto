/**
 * Azure API Management — Type Definitions
 */

export type APIMSkuName = "Developer" | "Standard" | "Premium" | "Basic" | "Consumption" | "Isolated";

export type APIMService = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  sku: { name: APIMSkuName; capacity: number };
  gatewayUrl?: string;
  portalUrl?: string;
  managementApiUrl?: string;
  publisherEmail?: string;
  publisherName?: string;
  provisioningState?: string;
};

export type APIProduct = {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  state: string;
  subscriptionRequired?: boolean;
  approvalRequired?: boolean;
  subscriptionsLimit?: number;
};

export type APIDefinition = {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  path: string;
  protocols: string[];
  serviceUrl?: string;
  apiType?: string;
  apiVersion?: string;
  isCurrent?: boolean;
};

export type APIMSubscription = {
  id: string;
  name: string;
  displayName?: string;
  ownerId?: string;
  scope: string;
  state: string;
  primaryKey?: string;
  secondaryKey?: string;
  createdDate?: string;
  expirationDate?: string;
};

export type APIMPolicy = {
  id: string;
  name: string;
  value: string;
  format?: string;
};

// =============================================================================
// Write Operation Types
// =============================================================================

export type APIMServiceCreateOptions = {
  name: string;
  resourceGroup: string;
  location: string;
  publisherEmail: string;
  publisherName: string;
  skuName?: APIMSkuName;
  skuCapacity?: number;
  tags?: Record<string, string>;
};

export type APIMApiCreateOptions = {
  name: string;
  displayName: string;
  path: string;
  serviceUrl?: string;
  protocols?: string[];
  subscriptionRequired?: boolean;
};
