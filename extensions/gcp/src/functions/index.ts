/**
 * GCP Extension — Cloud Functions Manager
 *
 * Manages Cloud Functions (1st and 2nd gen).
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

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

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /**
   * List Cloud Functions, optionally filtered by location.
   *
   * @param opts - Optional filter with `location` (omit to list across all locations).
   */
  async listFunctions(opts?: { location?: string }): Promise<GcpCloudFunction[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call cloudfunctions.projects.locations.functions.list
      const location = opts?.location ?? "-"; // "-" means all locations
      const _endpoint = `https://cloudfunctions.googleapis.com/v2/projects/${this.projectId}/locations/${location}/functions`;

      return [] as GcpCloudFunction[];
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
      // Placeholder: would call cloudfunctions.projects.locations.functions.get
      const _endpoint = `https://cloudfunctions.googleapis.com/v2/projects/${this.projectId}/locations/${location}/functions/${name}`;

      throw new Error(`Function ${name} not found in ${location} (placeholder)`);
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
      // Placeholder: would call cloudfunctions.projects.locations.functions.delete
      const _endpoint = `https://cloudfunctions.googleapis.com/v2/projects/${this.projectId}/locations/${location}/functions/${name}`;

      return {
        success: true,
        message: `Function ${name} deletion initiated in ${location}`,
        operationId: `op-delete-fn-${Date.now()}`,
      };
    }, this.retryOptions);
  }

  /**
   * List available locations for Cloud Functions deployment.
   */
  async listLocations(): Promise<string[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call cloudfunctions.projects.locations.list
      const _endpoint = `https://cloudfunctions.googleapis.com/v2/projects/${this.projectId}/locations`;

      // Return well-known locations as placeholder data
      return [
        "us-central1",
        "us-east1",
        "us-east4",
        "us-west1",
        "europe-west1",
        "europe-west2",
        "europe-west3",
        "asia-east1",
        "asia-east2",
        "asia-northeast1",
      ];
    }, this.retryOptions);
  }
}

/** Factory: create a GcpFunctionsManager instance. */
export function createFunctionsManager(projectId: string, retryOptions?: GcpRetryOptions): GcpFunctionsManager {
  return new GcpFunctionsManager(projectId, retryOptions);
}
