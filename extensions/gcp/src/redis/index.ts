/**
 * GCP Extension — Memorystore for Redis Manager
 *
 * Manages Memorystore for Redis instances.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

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
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
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
      // Placeholder: would call redis.projects.locations.instances.list
      const _endpoint = `https://redis.googleapis.com/v1/projects/${this.projectId}/locations/${loc}/instances`;

      return [] as GcpRedisInstance[];
    }, this.retryOptions);
  }

  /** Get a single Redis instance by location and name. */
  async getInstance(location: string, name: string): Promise<GcpRedisInstance> {
    return withGcpRetry(async () => {
      // Placeholder: would call redis.projects.locations.instances.get
      const _endpoint = `https://redis.googleapis.com/v1/projects/${this.projectId}/locations/${location}/instances/${name}`;

      throw new Error(`Redis instance ${name} not found in ${location} (placeholder)`);
    }, this.retryOptions);
  }

  /** Delete a Redis instance. */
  async deleteInstance(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call redis.projects.locations.instances.delete
      const _endpoint = `https://redis.googleapis.com/v1/projects/${this.projectId}/locations/${location}/instances/${name}`;

      return {
        success: true,
        message: `Redis instance ${name} deletion initiated in ${location}`,
        operationId: `op-delete-${Date.now()}`,
      };
    }, this.retryOptions);
  }

  /** Initiate a failover for a Redis instance (Standard tier only). */
  async failover(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call redis.projects.locations.instances.failover
      const _endpoint = `https://redis.googleapis.com/v1/projects/${this.projectId}/locations/${location}/instances/${name}:failover`;

      return {
        success: true,
        message: `Failover initiated for Redis instance ${name} in ${location}`,
        operationId: `op-failover-${Date.now()}`,
      };
    }, this.retryOptions);
  }
}

/** Factory: create a GcpRedisManager instance. */
export function createRedisManager(projectId: string, retryOptions?: GcpRetryOptions): GcpRedisManager {
  return new GcpRedisManager(projectId, retryOptions);
}
