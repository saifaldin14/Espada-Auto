/**
 * Azure Firewall — Type Definitions
 */

// =============================================================================
// Azure Firewall
// =============================================================================

export type FirewallSkuTier = "Standard" | "Premium" | "Basic";

export type AzureFirewall = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  threatIntelMode?: string;
  skuTier?: FirewallSkuTier;
  firewallPolicyId?: string;
  ipConfigurations: FirewallIPConfiguration[];
  tags?: Record<string, string>;
};

export type FirewallIPConfiguration = {
  id: string;
  name: string;
  privateIpAddress?: string;
  publicIpAddressId?: string;
  subnetId?: string;
};

// =============================================================================
// Firewall Policy
// =============================================================================

export type FirewallPolicy = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  threatIntelMode?: string;
  dnsSettings?: FirewallDnsSettings;
  tags?: Record<string, string>;
};

export type FirewallDnsSettings = {
  enableProxy?: boolean;
  servers?: string[];
};

// =============================================================================
// Firewall Rule Collection Group
// =============================================================================

export type FirewallRuleCollectionGroup = {
  id: string;
  name: string;
  priority: number;
  provisioningState?: string;
  ruleCollectionCount: number;
};

// =============================================================================
// IP Group (used with Firewall rules)
// =============================================================================

export type IPGroup = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  ipAddresses: string[];
  firewalls: string[];
  tags?: Record<string, string>;
};
