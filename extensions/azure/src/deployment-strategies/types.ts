/**
 * Azure Deployment Strategies — Type Definitions
 *
 * Types for blue/green slot swaps, canary traffic shifting,
 * and Traffic Manager weighted deployments.
 */

// =============================================================================
// Strategy Variants
// =============================================================================

export type DeploymentStrategyType =
  | "blue-green-slot"
  | "canary-slot"
  | "traffic-manager-weighted";

// =============================================================================
// Blue/Green Slot Swap
// =============================================================================

/**
 * Perform a blue/green deployment via Azure Deployment Slot swap.
 *
 * Flow:
 *   1. Validate source slot exists and is running
 *   2. (optional) Run warm-up check on source slot URL
 *   3. Swap source → target (atomic, zero-downtime)
 *   4. Return swap result with old/new production details
 */
export type BlueGreenSlotOptions = {
  resourceGroup: string;
  appName: string;
  /** Source slot (e.g. "staging") — the code you want to promote. */
  sourceSlot: string;
  /** Target slot (default: "production"). */
  targetSlot?: string;
  /** If true, run a pre-swap health check on the source slot's URL. */
  healthCheck?: boolean;
  /** Health check URL path (default: "/"). Appended to slot hostname. */
  healthCheckPath?: string;
  /** Health check timeout in ms (default: 10000). */
  healthCheckTimeoutMs?: number;
};

export type BlueGreenSlotResult = {
  strategy: "blue-green-slot";
  success: boolean;
  appName: string;
  sourceSlot: string;
  targetSlot: string;
  /** Pre-swap health check result (null if not requested). */
  healthCheck: HealthCheckResult | null;
  /** Human-readable summary. */
  summary: string;
  /** ISO timestamp of the swap. */
  swappedAt: string;
};

// =============================================================================
// Canary Slot Traffic Shifting
// =============================================================================

/**
 * Canary deployment via Azure Slot Traffic Routing (Testing in Production).
 *
 * Gradually shifts traffic from production to a canary slot in configurable
 * percentage steps. Each step can be validated before proceeding.
 */
export type CanarySlotOptions = {
  resourceGroup: string;
  appName: string;
  /** Target slot for canary traffic (e.g. "staging", "canary"). */
  slotName: string;
  /** Traffic percentage to send to the canary slot (0–100). */
  percentage: number;
};

export type CanarySlotResult = {
  strategy: "canary-slot";
  success: boolean;
  appName: string;
  slotName: string;
  /** Now-active canary percentage. */
  percentage: number;
  /** Production percentage (100 − canary). */
  productionPercentage: number;
  summary: string;
};

// =============================================================================
// Traffic Manager Weighted Shifting
// =============================================================================

/**
 * DNS-level traffic shifting via Azure Traffic Manager weighted routing.
 *
 * Used for cross-region or cross-environment blue/green deployments where
 * both environments are independent apps (not deployment slots).
 *
 * Flow: update endpoint weights on a Weighted TM profile.
 */
export type TrafficManagerShiftOptions = {
  resourceGroup: string;
  profileName: string;
  /** Endpoint weights to set. Keys are endpoint names, values are weights 1–1000. */
  weights: Array<{
    endpointName: string;
    endpointType: "AzureEndpoints" | "ExternalEndpoints" | "NestedEndpoints";
    weight: number;
  }>;
};

export type TrafficManagerShiftResult = {
  strategy: "traffic-manager-weighted";
  success: boolean;
  profileName: string;
  /** Updated endpoint weights. */
  endpoints: Array<{
    name: string;
    weight: number;
    target?: string;
    status?: string;
  }>;
  summary: string;
};

// =============================================================================
// Deployment Status
// =============================================================================

/**
 * Aggregated deployment status across both slot-based and TM-based strategies.
 */
export type DeploymentStatus = {
  appName: string;
  resourceGroup: string;
  /** Current slot traffic routing (if any). */
  slotRouting: {
    productionPercentage: number;
    rules: Array<{ slotName: string; percentage: number }>;
  } | null;
  /** Available slots on the app. */
  slots: Array<{ name: string; state: string; hostName: string }>;
  /** Traffic Manager profiles associated (if requested). */
  trafficManager?: {
    profileName: string;
    routingMethod: string;
    endpoints: Array<{ name: string; weight?: number; target?: string; status?: string }>;
  };
};

// =============================================================================
// Health Check
// =============================================================================

export type HealthCheckResult = {
  url: string;
  statusCode: number | null;
  healthy: boolean;
  responseTimeMs: number;
  error?: string;
};
