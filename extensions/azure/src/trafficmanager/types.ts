/**
 * Azure Traffic Manager — Type Definitions
 */

// ============================================================================
// Traffic Manager Profiles
// ============================================================================

export type TrafficManagerProfile = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  profileStatus?: string;
  trafficRoutingMethod?: string;
  dnsConfig?: TrafficManagerDnsConfig;
  monitorConfig?: TrafficManagerMonitorConfig;
  maxReturn?: number;
  provisioningState?: string;
  tags?: Record<string, string>;
};

export type TrafficManagerDnsConfig = {
  relativeName?: string;
  fqdn?: string;
  ttl?: number;
};

export type TrafficManagerMonitorConfig = {
  profileMonitorStatus?: string;
  protocol?: string;
  port?: number;
  path?: string;
  intervalInSeconds?: number;
  timeoutInSeconds?: number;
  toleratedNumberOfFailures?: number;
};

// ============================================================================
// Traffic Manager Endpoints
// ============================================================================

export type TrafficManagerEndpoint = {
  id: string;
  name: string;
  type: string;
  endpointStatus?: string;
  endpointMonitorStatus?: string;
  target?: string;
  targetResourceId?: string;
  weight?: number;
  priority?: number;
  endpointLocation?: string;
  minChildEndpoints?: number;
  minChildEndpointsIPv4?: number;
  minChildEndpointsIPv6?: number;
};

export type TrafficRoutingMethod =
  | "Performance"
  | "Priority"
  | "Weighted"
  | "Geographic"
  | "MultiValue"
  | "Subnet";
