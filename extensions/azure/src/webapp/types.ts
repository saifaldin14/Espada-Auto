/**
 * Azure App Service (Web Apps) — Type Definitions
 */

// =============================================================================
// Web App
// =============================================================================

export type WebAppState = "Running" | "Stopped" | "Unknown";

export type WebApp = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  state: WebAppState;
  kind: string;
  defaultHostName: string;
  httpsOnly: boolean;
  enabled: boolean;
  appServicePlanId?: string;
  outboundIpAddresses?: string;
  linuxFxVersion?: string;
  tags?: Record<string, string>;
};

// =============================================================================
// App Service Plan
// =============================================================================

export type AppServicePlan = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  kind: string;
  sku: string;
  tier: string;
  capacity: number;
  numberOfSites: number;
  provisioningState?: string;
  reserved: boolean;
  tags?: Record<string, string>;
};

// =============================================================================
// Deployment Slot
// =============================================================================

export type DeploymentSlot = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  state: string;
  defaultHostName: string;
  tags?: Record<string, string>;
};

// =============================================================================
// Web App Configuration
// =============================================================================

export type WebAppConfig = {
  linuxFxVersion?: string;
  windowsFxVersion?: string;
  javaVersion?: string;
  nodeVersion?: string;
  pythonVersion?: string;
  phpVersion?: string;
  dotnetVersion?: string;
  alwaysOn?: boolean;
  ftpsState?: string;
  http20Enabled?: boolean;
  minTlsVersion?: string;
  numberOfWorkers?: number;
};
