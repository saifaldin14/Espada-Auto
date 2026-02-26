/**
 * Azure Extension — Shared Types
 *
 * Core type definitions used across all Azure service modules.
 */

// =============================================================================
// Azure Resource Types
// =============================================================================

export type AzureResourceType =
  | "Microsoft.Compute/virtualMachines"
  | "Microsoft.Storage/storageAccounts"
  | "Microsoft.Web/sites"
  | "Microsoft.Sql/servers"
  | "Microsoft.DocumentDB/databaseAccounts"
  | "Microsoft.Network/virtualNetworks"
  | "Microsoft.Network/networkSecurityGroups"
  | "Microsoft.Network/loadBalancers"
  | "Microsoft.Network/applicationGateways"
  | "Microsoft.Network/publicIPAddresses"
  | "Microsoft.KeyVault/vaults"
  | "Microsoft.ContainerService/managedClusters"
  | "Microsoft.ContainerInstance/containerGroups"
  | "Microsoft.ContainerRegistry/registries"
  | "Microsoft.Insights/components"
  | "Microsoft.OperationalInsights/workspaces"
  | "Microsoft.Authorization/roleAssignments"
  | "Microsoft.CostManagement/exports"
  | "Microsoft.ServiceBus/namespaces"
  | "Microsoft.EventGrid/topics"
  | "Microsoft.Network/dnszones"
  | "Microsoft.Cache/Redis"
  | "Microsoft.Cdn/profiles"
  | "Microsoft.Security/assessments"
  | "Microsoft.Authorization/policyDefinitions"
  | "Microsoft.RecoveryServices/vaults"
  | "Microsoft.CognitiveServices/accounts"
  | "Microsoft.Logic/workflows"
  | "Microsoft.ApiManagement/service"
  | "Microsoft.Automation/automationAccounts"
  | "Microsoft.Resources/resourceGroups";

// =============================================================================
// Azure Regions
// =============================================================================

export type AzureRegion =
  | "eastus"
  | "eastus2"
  | "westus"
  | "westus2"
  | "westus3"
  | "centralus"
  | "northcentralus"
  | "southcentralus"
  | "westcentralus"
  | "canadacentral"
  | "canadaeast"
  | "brazilsouth"
  | "northeurope"
  | "westeurope"
  | "uksouth"
  | "ukwest"
  | "francecentral"
  | "francesouth"
  | "germanywestcentral"
  | "norwayeast"
  | "swedencentral"
  | "switzerlandnorth"
  | "eastasia"
  | "southeastasia"
  | "japaneast"
  | "japanwest"
  | "koreacentral"
  | "koreasouth"
  | "centralindia"
  | "southindia"
  | "westindia"
  | "australiaeast"
  | "australiasoutheast"
  | "australiacentral"
  | "southafricanorth"
  | "uaenorth"
  | string; // Allow custom regions

// =============================================================================
// Common Configuration
// =============================================================================

export type AzureRetryOptions = {
  maxAttempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
};

export type AzurePluginConfig = {
  defaultSubscription?: string;
  defaultRegion?: string;
  defaultTenantId?: string;
  credentialMethod?: "default" | "cli" | "service-principal" | "managed-identity" | "browser";
  credentialSources?: string[];
  retry?: AzureRetryOptions;
  diagnostics?: {
    enabled?: boolean;
    verbose?: boolean;
  };
  tagConfig?: {
    requiredTags?: string[];
    optionalTags?: string[];
  };
  defaultTags?: Array<{ key: string; value: string }>;
};

// =============================================================================
// Common Result Types
// =============================================================================

export type AzureOperationResult<T = unknown> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  requestId?: string;
};

export type AzureResource = {
  id: string;
  name: string;
  type: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  tags?: Record<string, string>;
  properties?: Record<string, unknown>;
  createdAt?: string;
  modifiedAt?: string;
};

export type AzureResourceFilter = {
  resourceGroup?: string;
  location?: string;
  tags?: Record<string, string>;
  type?: AzureResourceType;
  namePattern?: string;
};

// =============================================================================
// Pagination
// =============================================================================

/**
 * Options for paginating list results.
 * When `limit` is provided, iteration stops after collecting that many items.
 * When `offset` is provided, that many items are skipped before collecting.
 */
export type AzurePaginationOptions = {
  /** Maximum number of items to return. Omit for all results. */
  limit?: number;
  /** Number of items to skip before collecting. Default: 0. */
  offset?: number;
};

export type AzurePagedResult<T> = {
  items: T[];
  nextLink?: string;
  totalCount?: number;
  /** Whether more items exist beyond this page. */
  hasMore?: boolean;
};

// =============================================================================
// Tags
// =============================================================================

export type AzureTagSet = Record<string, string>;

export type AzureTagOperation = {
  action: "add" | "remove" | "replace";
  tags: AzureTagSet;
};
