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

// ============================================================================
// Traffic Manager Profile Creation
// ============================================================================

export type CreateTrafficManagerProfileOptions = {
  /** Profile name. */
  name: string;
  /** Resource group for the profile. */
  resourceGroup: string;
  /** Routing method (Weighted is typical for blue/green shifting). */
  trafficRoutingMethod: TrafficRoutingMethod;
  /** DNS config: relative name becomes <name>.trafficmanager.net. */
  relativeDnsName: string;
  /** DNS TTL in seconds (lower = faster failover, e.g. 30). */
  ttl?: number;
  /** Health probe protocol. */
  monitorProtocol?: "HTTP" | "HTTPS" | "TCP";
  /** Health probe port. */
  monitorPort?: number;
  /** Health probe path (e.g. "/health"). */
  monitorPath?: string;
  /** Tags. */
  tags?: Record<string, string>;
};

export type CreateOrUpdateEndpointOptions = {
  /** Resource group of the profile. */
  resourceGroup: string;
  /** Traffic Manager profile name. */
  profileName: string;
  /** Endpoint type. */
  endpointType: "AzureEndpoints" | "ExternalEndpoints" | "NestedEndpoints";
  /** Endpoint name. */
  endpointName: string;
  /** Target FQDN (for external endpoints). */
  target?: string;
  /** Azure resource ID (for Azure endpoints). */
  targetResourceId?: string;
  /** Weight (1–1000) for Weighted routing. */
  weight?: number;
  /** Priority (1–1000) for Priority routing. */
  priority?: number;
  /** Endpoint status. */
  endpointStatus?: "Enabled" | "Disabled";
  /** Geographic location (for ExternalEndpoints). */
  endpointLocation?: string;
};

export type UpdateEndpointWeightOptions = {
  resourceGroup: string;
  profileName: string;
  endpointType: "AzureEndpoints" | "ExternalEndpoints" | "NestedEndpoints";
  endpointName: string;
  /** New weight value (1–1000). */
  weight: number;
};
