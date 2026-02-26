/**
 * Azure API Management — Type Definitions
 */

export type ApiManagementSkuName = "Consumption" | "Developer" | "Basic" | "Standard" | "Premium" | "Isolated";

export type ApiManagementService = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  sku: { name: ApiManagementSkuName; capacity: number };
  gatewayUrl?: string;
  portalUrl?: string;
  managementApiUrl?: string;
  publisherEmail?: string;
  publisherName?: string;
  provisioningState?: string;
  tags?: Record<string, string>;
};

export type ApiManagementApi = {
  id: string;
  name: string;
  displayName?: string;
  path: string;
  serviceUrl?: string;
  protocols?: string[];
  apiRevision?: string;
  apiVersion?: string;
  isCurrent?: boolean;
  subscriptionRequired?: boolean;
};

export type ApiManagementProduct = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  state?: "notPublished" | "published";
  subscriptionRequired?: boolean;
  approvalRequired?: boolean;
  subscriptionsLimit?: number;
};

export type ApiManagementPolicy = {
  id: string;
  name: string;
  value: string;
  format?: string;
};

export type ApiManagementServiceCreateOptions = {
  name: string;
  resourceGroup: string;
  location: string;
  publisherEmail: string;
  publisherName: string;
  skuName?: ApiManagementSkuName;
  skuCapacity?: number;
  tags?: Record<string, string>;
};

export type ApiManagementApiCreateOptions = {
  name: string;
  displayName: string;
  path: string;
  serviceUrl?: string;
  protocols?: string[];
  subscriptionRequired?: boolean;
};
