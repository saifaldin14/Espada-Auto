/**
 * GCP Extension — Google Kubernetes Engine (GKE) Manager
 *
 * Manages GKE clusters and node pools.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** Autoscaling configuration for a GKE node pool. */
export type GcpNodePoolAutoscaling = {
  enabled: boolean;
  minNodeCount?: number;
  maxNodeCount?: number;
};

/** A GKE node pool. */
export type GcpNodePool = {
  name: string;
  machineType: string;
  diskSizeGb: number;
  nodeCount: number;
  status: string;
  autoscaling: GcpNodePoolAutoscaling;
};

/** A GKE cluster. */
export type GcpGKECluster = {
  name: string;
  location: string;
  status: string;
  nodeCount: number;
  currentMasterVersion: string;
  labels: Record<string, string>;
  endpoint: string;
  network: string;
};

// =============================================================================
// GcpGKEManager
// =============================================================================

/**
 * Manages Google Kubernetes Engine clusters and node pools.
 *
 * Provides methods for listing and inspecting clusters,
 * deleting clusters, and listing node pools.
 */
export class GcpGKEManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /**
   * List GKE clusters, optionally filtered by location.
   *
   * @param opts - Optional filter with `location` (region or zone; omit to list all).
   */
  async listClusters(opts?: { location?: string }): Promise<GcpGKECluster[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const location = opts?.location ?? "-";
      const url = `https://container.googleapis.com/v1/projects/${this.projectId}/locations/${location}/clusters`;
      const items = await gcpList<Record<string, unknown>>(url, token, "clusters");
      return items.map((c) => this.mapCluster(c));
    }, this.retryOptions);
  }

  /**
   * Get details for a specific GKE cluster.
   *
   * @param location - The cluster location (region or zone, e.g. "us-central1").
   * @param name     - The cluster name.
   */
  async getCluster(location: string, name: string): Promise<GcpGKECluster> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://container.googleapis.com/v1/projects/${this.projectId}/locations/${location}/clusters/${name}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapCluster(raw);
    }, this.retryOptions);
  }

  /**
   * Delete a GKE cluster.
   *
   * @param location - The cluster location.
   * @param name     - The cluster name.
   */
  async deleteCluster(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://container.googleapis.com/v1/projects/${this.projectId}/locations/${location}/clusters/${name}`;
      return gcpMutate(url, token, {}, "DELETE");
    }, this.retryOptions);
  }

  /**
   * List node pools for a GKE cluster.
   *
   * @param location - The cluster location.
   * @param cluster  - The cluster name.
   */
  async listNodePools(location: string, cluster: string): Promise<GcpNodePool[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://container.googleapis.com/v1/projects/${this.projectId}/locations/${location}/clusters/${cluster}/nodePools`;
      const items = await gcpList<Record<string, unknown>>(url, token, "nodePools");
      return items.map((np) => {
        const config = (np.config ?? {}) as Record<string, unknown>;
        const autoscaling = (np.autoscaling ?? {}) as Record<string, unknown>;
        return {
          name: String(np.name ?? ""),
          machineType: String(config.machineType ?? ""),
          diskSizeGb: Number(config.diskSizeGb ?? 0),
          nodeCount: Number(np.initialNodeCount ?? 0),
          status: String(np.status ?? ""),
          autoscaling: {
            enabled: Boolean(autoscaling.enabled),
            minNodeCount: autoscaling.minNodeCount != null ? Number(autoscaling.minNodeCount) : undefined,
            maxNodeCount: autoscaling.maxNodeCount != null ? Number(autoscaling.maxNodeCount) : undefined,
          },
        };
      });
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Private mapping helpers
  // ---------------------------------------------------------------------------

  private mapCluster(raw: Record<string, unknown>): GcpGKECluster {
    return {
      name: String(raw.name ?? ""),
      location: String(raw.location ?? ""),
      status: String(raw.status ?? ""),
      nodeCount: Number(raw.currentNodeCount ?? 0),
      currentMasterVersion: String(raw.currentMasterVersion ?? ""),
      labels: (raw.resourceLabels as Record<string, string>) ?? {},
      endpoint: String(raw.endpoint ?? ""),
      network: String(raw.network ?? ""),
    };
  }
}

/** Factory: create a GcpGKEManager instance. */
export function createGKEManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpGKEManager {
  return new GcpGKEManager(projectId, getAccessToken, retryOptions);
}
