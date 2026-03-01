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
// Deployment Slot Options
// =============================================================================

export type CreateDeploymentSlotOptions = {
  /** Name of the slot to create (e.g. "staging", "canary"). */
  slotName: string;
  /** Optional: clone config from this source slot (default: production). */
  configurationSource?: string;
  /** Optional tags. */
  tags?: Record<string, string>;
};

export type SlotTrafficConfig = {
  /** Map of slot name → percentage (0–100). Sum with production must equal 100. */
  routingRules: Array<{
    /** Slot name (not the full "app/slot" format). */
    slotName: string;
    /** Percentage of traffic routed to this slot (0–100). */
    reroutePercentage: number;
  }>;
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
