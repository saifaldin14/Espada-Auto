/**
 * GCP Extension — Cloud Functions Manager
 *
 * Manages Cloud Functions (1st and 2nd gen).
 * Uses native fetch() via shared API helpers — no SDK needed.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpList, gcpRequest, gcpMutate, shortName } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** HTTPS trigger configuration for a Cloud Function. */
export type GcpHttpsTrigger = {
  url: string;
  securityLevel?: "SECURE_ALWAYS" | "SECURE_OPTIONAL";
};

/** Event trigger configuration for a Cloud Function. */
export type GcpEventTrigger = {
  eventType: string;
  resource: string;
  service?: string;
  failurePolicy?: { retry: boolean };
};

/** A Cloud Function resource. */
export type GcpCloudFunction = {
  name: string;
  location: string;
  runtime: string;
  status: string;
  entryPoint: string;
  trigger: "https" | "event";
  httpsTrigger?: GcpHttpsTrigger;
  eventTrigger?: GcpEventTrigger;
  labels: Record<string, string>;
};

// =============================================================================
// GcpFunctionsManager
// =============================================================================

/**
 * Manages GCP Cloud Functions.
 *
 * Provides methods for listing, inspecting, and deleting Cloud Functions,
 * as well as listing available deployment locations.
 */
export class GcpFunctionsManager {
  private projectId: string;
  private retryOptions: GcpRetryOptions;
  private getAccessToken: () => Promise<string>;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /**
   * List Cloud Functions, optionally filtered by location.
   *
   * @param opts - Optional filter with `location` (omit to list across all locations).
   */
  async listFunctions(opts?: { location?: string }): Promise<GcpCloudFunction[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const location = opts?.location ?? "-";
      const url = `https://cloudfunctions.googleapis.com/v2/projects/${this.projectId}/locations/${location}/functions`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "functions");
      return raw.map((f) => this.mapFunction(f));
    }, this.retryOptions);
  }

  /**
   * Get details for a specific Cloud Function.
   *
   * @param location - The function location (e.g. "us-central1").
   * @param name     - The function name.
   */
  async getFunction(location: string, name: string): Promise<GcpCloudFunction> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudfunctions.googleapis.com/v2/projects/${this.projectId}/locations/${location}/functions/${name}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapFunction(raw);
    }, this.retryOptions);
  }

  /**
   * Delete a Cloud Function.
   *
   * @param location - The function location.
   * @param name     - The function name.
   */
  async deleteFunction(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudfunctions.googleapis.com/v2/projects/${this.projectId}/locations/${location}/functions/${name}`;
      return gcpMutate(url, token, undefined, "DELETE");
    }, this.retryOptions);
  }

  /**
   * List available locations for Cloud Functions deployment.
   */
  async listLocations(): Promise<string[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudfunctions.googleapis.com/v2/projects/${this.projectId}/locations`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "locations");
      return raw.map((loc) => (loc as { locationId: string }).locationId);
    }, this.retryOptions);
  }

  /** Map raw v2 API response to GcpCloudFunction. */
  private mapFunction(f: Record<string, unknown>): GcpCloudFunction {
    const fullName = (f.name as string) ?? "";
    // Extract location from full resource name: projects/P/locations/L/functions/F
    const parts = fullName.split("/");
    const locationIndex = parts.indexOf("locations");
    const location = locationIndex >= 0 ? parts[locationIndex + 1] ?? "unknown" : "unknown";

    const buildConfig = (f.buildConfig as Record<string, unknown>) ?? {};
    const serviceConfig = (f.serviceConfig as Record<string, unknown>) ?? {};
    const eventTrigger = f.eventTrigger as Record<string, unknown> | undefined;

    const triggerType: "https" | "event" = eventTrigger ? "event" : "https";

    const result: GcpCloudFunction = {
      name: shortName(fullName),
      location,
      runtime: (buildConfig.runtime as string) ?? "",
      status: (f.state as string) ?? "UNKNOWN",
      entryPoint: (buildConfig.entryPoint as string) ?? "",
      trigger: triggerType,
      labels: (f.labels as Record<string, string>) ?? {},
    };

    if (eventTrigger) {
      const filters = (eventTrigger.eventFilters as Array<Record<string, string>>) ?? [];
      result.eventTrigger = {
        eventType: (eventTrigger.eventType as string) ?? "",
        resource: filters[0]?.value ?? "",
      };
    } else {
      const uri = (serviceConfig.uri as string) ?? "";
      result.httpsTrigger = { url: uri };
    }

    return result;
  }
}

/** Factory: create a GcpFunctionsManager instance. */
export function createFunctionsManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpFunctionsManager {
  return new GcpFunctionsManager(projectId, getAccessToken, retryOptions);
}
