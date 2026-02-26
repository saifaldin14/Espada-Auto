/**
 * Azure Application Gateway — Type Definitions
 */

// =============================================================================
// Application Gateway
// =============================================================================

export type AppGatewaySkuTier = "Standard_v2" | "WAF_v2" | "Standard" | "WAF";

export type ApplicationGateway = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  operationalState?: string;
  skuName?: string;
  skuTier?: AppGatewaySkuTier;
  skuCapacity?: number;
  enableHttp2?: boolean;
  enableFips?: boolean;
  firewallPolicyId?: string;
  frontendIPConfigurations: AppGatewayFrontendIP[];
  backendAddressPools: AppGatewayBackendPool[];
  httpListeners: AppGatewayHttpListener[];
  tags?: Record<string, string>;
};

// =============================================================================
// Frontend IP Configuration
// =============================================================================

export type AppGatewayFrontendIP = {
  id: string;
  name: string;
  privateIpAddress?: string;
  publicIpAddressId?: string;
  subnetId?: string;
};

// =============================================================================
// Backend Address Pool
// =============================================================================

export type AppGatewayBackendPool = {
  id: string;
  name: string;
  backendAddresses: AppGatewayBackendAddress[];
};

export type AppGatewayBackendAddress = {
  fqdn?: string;
  ipAddress?: string;
};

// =============================================================================
// HTTP Listener
// =============================================================================

export type AppGatewayHttpListener = {
  id: string;
  name: string;
  protocol?: string;
  hostName?: string;
  frontendPort?: string;
};

// =============================================================================
// WAF Configuration
// =============================================================================

export type WAFConfiguration = {
  enabled: boolean;
  firewallMode?: string;
  ruleSetType?: string;
  ruleSetVersion?: string;
  maxRequestBodySizeInKb?: number;
  fileUploadLimitInMb?: number;
  requestBodyCheck?: boolean;
};
