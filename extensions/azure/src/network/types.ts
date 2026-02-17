/**
 * Azure Network — Type Definitions
 */

// =============================================================================
// Virtual Network
// =============================================================================

export type VirtualNetwork = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  addressSpace: string[];
  provisioningState?: string;
  enableDdosProtection?: boolean;
  subnets: Subnet[];
  tags?: Record<string, string>;
};

// =============================================================================
// Subnet
// =============================================================================

export type Subnet = {
  id: string;
  name: string;
  addressPrefix: string;
  networkSecurityGroupId?: string;
  routeTableId?: string;
  provisioningState?: string;
  privateEndpointNetworkPolicies?: string;
  delegations?: string[];
};

// =============================================================================
// Network Security Group
// =============================================================================

export type NetworkSecurityGroup = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  securityRules: NSGRule[];
  tags?: Record<string, string>;
};

export type NSGRule = {
  id: string;
  name: string;
  priority: number;
  direction: "Inbound" | "Outbound";
  access: "Allow" | "Deny";
  protocol: string;
  sourceAddressPrefix?: string;
  destinationAddressPrefix?: string;
  sourcePortRange?: string;
  destinationPortRange?: string;
  description?: string;
};

// =============================================================================
// Load Balancer
// =============================================================================

export type LoadBalancer = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  sku?: string;
  provisioningState?: string;
  frontendIPConfigurations: string[];
  backendAddressPools: string[];
  tags?: Record<string, string>;
};

// =============================================================================
// Public IP Address
// =============================================================================

export type PublicIPAddress = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  ipAddress?: string;
  allocationMethod?: string;
  sku?: string;
  dnsLabel?: string;
  provisioningState?: string;
  tags?: Record<string, string>;
};

// =============================================================================
// Network Interface
// =============================================================================

export type NetworkInterface = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  privateIpAddress?: string;
  macAddress?: string;
  provisioningState?: string;
  virtualMachineId?: string;
  networkSecurityGroupId?: string;
  tags?: Record<string, string>;
};

// =============================================================================
// VPN Gateway
// =============================================================================

export type VPNGateway = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  gatewayType?: string;
  vpnType?: string;
  sku?: string;
  provisioningState?: string;
  tags?: Record<string, string>;
};

// =============================================================================
// VNet Peering
// =============================================================================

export type VNetPeering = {
  id: string;
  name: string;
  peeringState?: string;
  remoteVirtualNetworkId?: string;
  allowVirtualNetworkAccess?: boolean;
  allowForwardedTraffic?: boolean;
  allowGatewayTransit?: boolean;
  useRemoteGateways?: boolean;
};
