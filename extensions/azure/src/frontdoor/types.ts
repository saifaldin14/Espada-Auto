/**
 * Azure Front Door — Type Definitions
 */

// ============================================================================
// Front Door Profiles (AFD Standard/Premium)
// ============================================================================

export type FrontDoorProfile = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  skuName?: string;
  provisioningState?: string;
  resourceState?: string;
  frontDoorId?: string;
  originResponseTimeoutSeconds?: number;
  tags?: Record<string, string>;
};

// ============================================================================
// Front Door Endpoints
// ============================================================================

export type FrontDoorEndpoint = {
  id: string;
  name: string;
  hostName?: string;
  provisioningState?: string;
  deploymentStatus?: string;
  enabledState?: string;
};

// ============================================================================
// Front Door Origins & Origin Groups
// ============================================================================

export type FrontDoorOriginGroup = {
  id: string;
  name: string;
  provisioningState?: string;
  deploymentStatus?: string;
  healthProbeSettings?: FrontDoorHealthProbeSettings;
  sessionAffinityState?: string;
};

export type FrontDoorHealthProbeSettings = {
  probePath?: string;
  probeRequestType?: string;
  probeProtocol?: string;
  probeIntervalInSeconds?: number;
};

export type FrontDoorOrigin = {
  id: string;
  name: string;
  hostName?: string;
  httpPort?: number;
  httpsPort?: number;
  originHostHeader?: string;
  priority?: number;
  weight?: number;
  enabledState?: string;
  provisioningState?: string;
  deploymentStatus?: string;
};

// ============================================================================
// Front Door Routes
// ============================================================================

export type FrontDoorRoute = {
  id: string;
  name: string;
  provisioningState?: string;
  deploymentStatus?: string;
  enabledState?: string;
  patternsToMatch?: string[];
  forwardingProtocol?: string;
  httpsRedirect?: string;
  originGroupId?: string;
};
