/**
 * Azure Bastion — Type Definitions
 */

// ============================================================================
// Bastion Hosts
// ============================================================================

export type BastionHost = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  dnsName?: string;
  scaleUnits?: number;
  disableCopyPaste?: boolean;
  enableFileCopy?: boolean;
  enableIpConnect?: boolean;
  enableShareableLink?: boolean;
  enableTunneling?: boolean;
  enableKerberos?: boolean;
  skuName?: BastionSkuName;
  ipConfigurations?: BastionIPConfiguration[];
  tags?: Record<string, string>;
};

export type BastionSkuName = "Basic" | "Standard" | "Developer";

export type BastionIPConfiguration = {
  id: string;
  name: string;
  subnetId?: string;
  publicIpAddressId?: string;
  privateIpAllocationMethod?: string;
  provisioningState?: string;
};

// ============================================================================
// Bastion Shareable Links
// ============================================================================

export type BastionShareableLink = {
  vm: string;
  bsl: string;
  createdAt?: string;
  message?: string;
};
