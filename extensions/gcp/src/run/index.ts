/**
 * GCP Extension — Cloud Run Manager
 *
 * Manages Cloud Run services and revisions.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

// =============================================================================
// Types
// =============================================================================

/** Traffic split entry for a Cloud Run service. */
export type GcpTrafficTarget = {
  revisionName: string;
  percent: number;
  latestRevision?: boolean;
};

/** Scaling configuration for a Cloud Run revision. */
export type GcpRevisionScaling = {
  minInstanceCount?: number;
  maxInstanceCount?: number;
};

/** A Cloud Run revision. */
export type GcpCloudRunRevision = {
  name: string;
  createdAt: string;
  image: string;
  scaling: GcpRevisionScaling;
  status: string;
};

/** A Cloud Run service. */
export type GcpCloudRunService = {
  name: string;
  location: string;
  url: string;
  status: string;
  latestRevision: string;
  labels: Record<string, string>;
  traffic: GcpTrafficTarget[];
};

// =============================================================================
// GcpCloudRunManager
// =============================================================================

/**
 * Manages GCP Cloud Run services and revisions.
 *
 * Provides methods for listing, inspecting, and deleting services
 * as well as listing revisions for a given service.
 */
export class GcpCloudRunManager {
  private projectId: string;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /**
   * List Cloud Run services, optionally filtered by location.
   *
   * @param opts - Optional filter with `location` (omit to list across all locations).
   */
  async listServices(opts?: { location?: string }): Promise<GcpCloudRunService[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call run.projects.locations.services.list
      const location = opts?.location ?? "-"; // "-" means all locations
      const _endpoint = `https://run.googleapis.com/v2/projects/${this.projectId}/locations/${location}/services`;

      return [] as GcpCloudRunService[];
    }, this.retryOptions);
  }

  /**
   * Get details for a specific Cloud Run service.
   *
   * @param location - The service location (e.g. "us-central1").
   * @param name     - The service name.
   */
  async getService(location: string, name: string): Promise<GcpCloudRunService> {
    return withGcpRetry(async () => {
      // Placeholder: would call run.projects.locations.services.get
      const _endpoint = `https://run.googleapis.com/v2/projects/${this.projectId}/locations/${location}/services/${name}`;

      throw new Error(`Service ${name} not found in ${location} (placeholder)`);
    }, this.retryOptions);
  }

  /**
   * Delete a Cloud Run service.
   *
   * @param location - The service location.
   * @param name     - The service name.
   */
  async deleteService(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call run.projects.locations.services.delete
      const _endpoint = `https://run.googleapis.com/v2/projects/${this.projectId}/locations/${location}/services/${name}`;

      return {
        success: true,
        message: `Service ${name} deletion initiated in ${location}`,
        operationId: `op-delete-svc-${Date.now()}`,
      };
    }, this.retryOptions);
  }

  /**
   * List revisions for a Cloud Run service.
   *
   * @param location - The service location.
   * @param service  - The service name.
   */
  async listRevisions(location: string, service: string): Promise<GcpCloudRunRevision[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call run.projects.locations.revisions.list with service filter
      const _endpoint = `https://run.googleapis.com/v2/projects/${this.projectId}/locations/${location}/services/${service}/revisions`;

      return [] as GcpCloudRunRevision[];
    }, this.retryOptions);
  }
}

/** Factory: create a GcpCloudRunManager instance. */
export function createCloudRunManager(projectId: string, retryOptions?: GcpRetryOptions): GcpCloudRunManager {
  return new GcpCloudRunManager(projectId, retryOptions);
}
