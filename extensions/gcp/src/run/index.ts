/**
 * GCP Extension — Cloud Run Manager
 *
 * Manages Cloud Run services and revisions.
 * Uses native fetch() via shared API helpers — no SDK needed.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpList, gcpRequest, gcpMutate, shortName } from "../api.js";

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
  private getAccessToken: () => Promise<string>;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /**
   * List Cloud Run services, optionally filtered by location.
   *
   * @param opts - Optional filter with `location` (omit to list across all locations).
   */
  async listServices(opts?: { location?: string }): Promise<GcpCloudRunService[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const location = opts?.location ?? "-";
      const url = `https://run.googleapis.com/v2/projects/${this.projectId}/locations/${location}/services`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "services");
      return raw.map((s) => this.mapService(s));
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
      const token = await this.getAccessToken();
      const url = `https://run.googleapis.com/v2/projects/${this.projectId}/locations/${location}/services/${name}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapService(raw);
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
      const token = await this.getAccessToken();
      const url = `https://run.googleapis.com/v2/projects/${this.projectId}/locations/${location}/services/${name}`;
      return gcpMutate(url, token, undefined, "DELETE");
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
      const token = await this.getAccessToken();
      const url = `https://run.googleapis.com/v2/projects/${this.projectId}/locations/${location}/services/${service}/revisions`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "revisions");
      return raw.map((r) => this.mapRevision(r));
    }, this.retryOptions);
  }

  /** Map raw v2 API response to GcpCloudRunService. */
  private mapService(s: Record<string, unknown>): GcpCloudRunService {
    const fullName = (s.name as string) ?? "";
    const parts = fullName.split("/");
    const locationIndex = parts.indexOf("locations");
    const location = locationIndex >= 0 ? parts[locationIndex + 1] ?? "unknown" : "unknown";

    const reconciling = s.reconciling as boolean | undefined;
    const conditions = (s.conditions as Array<Record<string, unknown>>) ?? [];
    let status = "UNKNOWN";
    if (reconciling) {
      status = "DEPLOYING";
    } else {
      const ready = conditions.find((c) => c.type === "Ready");
      status = ready ? (ready.status === "True" ? "ACTIVE" : "FAILED") : "UNKNOWN";
    }

    const rawTraffic = (s.traffic as Array<Record<string, unknown>>) ?? [];
    const traffic: GcpTrafficTarget[] = rawTraffic.map((t) => ({
      revisionName: shortName((t.revision as string) ?? ""),
      percent: (t.percent as number) ?? 0,
      latestRevision: t.type === "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST" ? true : undefined,
    }));

    return {
      name: shortName(fullName),
      location,
      url: (s.uri as string) ?? "",
      status,
      latestRevision: shortName((s.latestReadyRevision as string) ?? ""),
      labels: (s.labels as Record<string, string>) ?? {},
      traffic,
    };
  }

  /** Map raw v2 API response to GcpCloudRunRevision. */
  private mapRevision(r: Record<string, unknown>): GcpCloudRunRevision {
    const containers = (r.containers as Array<Record<string, unknown>>) ?? [];
    const image = containers.length > 0 ? (containers[0].image as string) ?? "" : "";
    const scaling = (r.scaling as Record<string, unknown>) ?? {};

    const reconciling = r.reconciling as boolean | undefined;
    const conditions = (r.conditions as Array<Record<string, unknown>>) ?? [];
    let status = "UNKNOWN";
    if (reconciling) {
      status = "DEPLOYING";
    } else {
      const ready = conditions.find((c) => c.type === "Ready");
      status = ready ? (ready.status === "True" ? "ACTIVE" : "FAILED") : "UNKNOWN";
    }

    return {
      name: shortName((r.name as string) ?? ""),
      createdAt: (r.createTime as string) ?? "",
      image,
      scaling: {
        minInstanceCount: scaling.minInstanceCount as number | undefined,
        maxInstanceCount: scaling.maxInstanceCount as number | undefined,
      },
      status,
    };
  }
}

/** Factory: create a GcpCloudRunManager instance. */
export function createCloudRunManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpCloudRunManager {
  return new GcpCloudRunManager(projectId, getAccessToken, retryOptions);
}
