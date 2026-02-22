/**
 * GCP Extension — Memorystore for Redis Manager
 *
 * Manages Memorystore for Redis instances via the Redis REST API.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** A Memorystore for Redis instance. */
export type GcpRedisInstance = {
  name: string;
  location: string;
  tier: string;
  memorySizeGb: number;
  host: string;
  port: number;
  state: string;
  redisVersion: string;
  labels: Record<string, string>;
  createTime: string;
};

// =============================================================================
// GcpRedisManager
// =============================================================================

/**
 * Manages GCP Memorystore for Redis resources.
 *
 * Provides methods for listing, inspecting, deleting, and failing over
 * Redis instances.
 */
export class GcpRedisManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /**
   * List Redis instances, optionally filtered to a specific location.
   *
   * @param opts - Optional filter with `location` (e.g. "us-central1"). Omit to use wildcard "-".
   */
  async listInstances(opts?: { location?: string }): Promise<GcpRedisInstance[]> {
    return withGcpRetry(async () => {
      const loc = opts?.location ?? "-";
      const token = await this.getAccessToken();
      const url = `https://redis.googleapis.com/v1/projects/${this.projectId}/locations/${loc}/instances`;
      return gcpList<GcpRedisInstance>(url, token, "instances");
    }, this.retryOptions);
  }

  /** Get a single Redis instance by location and name. */
  async getInstance(location: string, name: string): Promise<GcpRedisInstance> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://redis.googleapis.com/v1/projects/${this.projectId}/locations/${location}/instances/${name}`;
      return gcpRequest(url, token) as Promise<GcpRedisInstance>;
    }, this.retryOptions);
  }

  /** Delete a Redis instance. */
  async deleteInstance(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://redis.googleapis.com/v1/projects/${this.projectId}/locations/${location}/instances/${name}`;
      return gcpMutate(url, token, undefined, "DELETE");
    }, this.retryOptions);
  }

  /** Initiate a failover for a Redis instance (Standard tier only). */
  async failover(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://redis.googleapis.com/v1/projects/${this.projectId}/locations/${location}/instances/${name}:failover`;
      return gcpMutate(url, token, { dataProtectionMode: "LIMITED_DATA_LOSS" });
    }, this.retryOptions);
  }
}

/** Factory: create a GcpRedisManager instance. */
export function createRedisManager(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions): GcpRedisManager {
  return new GcpRedisManager(projectId, getAccessToken, retryOptions);
}
