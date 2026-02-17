/**
 * GCP Extension — Compute Engine Manager
 *
 * Manages Compute Engine instances, machine types, and disks.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

// =============================================================================
// Types
// =============================================================================

/** Network interface attached to a Compute Engine instance. */
export type GcpNetworkInterface = {
  network: string;
  subnetwork?: string;
  networkIP?: string;
  accessConfigs?: Array<{ name: string; natIP?: string; type: string }>;
};

/** Disk attachment on a Compute Engine instance. */
export type GcpAttachedDisk = {
  deviceName: string;
  source: string;
  boot: boolean;
  autoDelete: boolean;
  sizeGb?: number;
};

/** A Compute Engine virtual machine instance. */
export type GcpComputeInstance = {
  name: string;
  zone: string;
  machineType: string;
  status: string;
  networkInterfaces: GcpNetworkInterface[];
  disks: GcpAttachedDisk[];
  labels: Record<string, string>;
  createdAt: string;
};

/** A Compute Engine machine type. */
export type GcpMachineType = {
  name: string;
  description: string;
  guestCpus: number;
  memoryMb: number;
};

/** A Compute Engine persistent disk. */
export type GcpDisk = {
  name: string;
  zone: string;
  sizeGb: number;
  type: string;
  status: string;
  sourceImage: string;
};

// =============================================================================
// GcpComputeManager
// =============================================================================

/**
 * Manages GCP Compute Engine resources.
 *
 * Provides methods for listing, starting, stopping, resetting, and deleting
 * VM instances as well as querying machine types and persistent disks.
 */
export class GcpComputeManager {
  private projectId: string;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /**
   * List Compute Engine instances, optionally filtered to a specific zone.
   *
   * @param opts - Optional filter with `zone` (omit to list across all zones).
   */
  async listInstances(opts?: { zone?: string }): Promise<GcpComputeInstance[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call compute.instances.aggregatedList or compute.instances.list
      const _endpoint = opts?.zone
        ? `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${opts.zone}/instances`
        : `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/aggregated/instances`;

      // Placeholder response
      return [] as GcpComputeInstance[];
    }, this.retryOptions);
  }

  /**
   * Get a single Compute Engine instance by zone and name.
   *
   * @param zone - The zone the instance resides in (e.g. "us-central1-a").
   * @param name - The instance name.
   */
  async getInstance(zone: string, name: string): Promise<GcpComputeInstance> {
    return withGcpRetry(async () => {
      // Placeholder: would call compute.instances.get
      const _endpoint = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${zone}/instances/${name}`;

      throw new Error(`Instance ${name} not found in zone ${zone} (placeholder)`);
    }, this.retryOptions);
  }

  /**
   * Start a stopped Compute Engine instance.
   *
   * @param zone - The zone the instance resides in.
   * @param name - The instance name.
   */
  async startInstance(zone: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call compute.instances.start
      const _endpoint = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${zone}/instances/${name}/start`;

      return {
        success: true,
        message: `Instance ${name} start initiated in ${zone}`,
        operationId: `op-start-${Date.now()}`,
      };
    }, this.retryOptions);
  }

  /**
   * Stop a running Compute Engine instance.
   *
   * @param zone - The zone the instance resides in.
   * @param name - The instance name.
   */
  async stopInstance(zone: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call compute.instances.stop
      const _endpoint = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${zone}/instances/${name}/stop`;

      return {
        success: true,
        message: `Instance ${name} stop initiated in ${zone}`,
        operationId: `op-stop-${Date.now()}`,
      };
    }, this.retryOptions);
  }

  /**
   * Reset (hard reboot) a Compute Engine instance.
   *
   * @param zone - The zone the instance resides in.
   * @param name - The instance name.
   */
  async resetInstance(zone: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call compute.instances.reset
      const _endpoint = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${zone}/instances/${name}/reset`;

      return {
        success: true,
        message: `Instance ${name} reset initiated in ${zone}`,
        operationId: `op-reset-${Date.now()}`,
      };
    }, this.retryOptions);
  }

  /**
   * Delete a Compute Engine instance.
   *
   * @param zone - The zone the instance resides in.
   * @param name - The instance name.
   */
  async deleteInstance(zone: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      // Placeholder: would call compute.instances.delete
      const _endpoint = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${zone}/instances/${name}`;

      return {
        success: true,
        message: `Instance ${name} deletion initiated in ${zone}`,
        operationId: `op-delete-${Date.now()}`,
      };
    }, this.retryOptions);
  }

  /**
   * List available machine types in a zone.
   *
   * @param zone - The zone to query (e.g. "us-central1-a").
   */
  async listMachineTypes(zone: string): Promise<GcpMachineType[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call compute.machineTypes.list
      const _endpoint = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${zone}/machineTypes`;

      return [] as GcpMachineType[];
    }, this.retryOptions);
  }

  /**
   * List persistent disks, optionally filtered to a specific zone.
   *
   * @param opts - Optional filter with `zone` (omit to list across all zones).
   */
  async listDisks(opts?: { zone?: string }): Promise<GcpDisk[]> {
    return withGcpRetry(async () => {
      // Placeholder: would call compute.disks.aggregatedList or compute.disks.list
      const _endpoint = opts?.zone
        ? `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${opts.zone}/disks`
        : `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/aggregated/disks`;

      return [] as GcpDisk[];
    }, this.retryOptions);
  }
}

/** Factory: create a GcpComputeManager instance. */
export function createComputeManager(projectId: string, retryOptions?: GcpRetryOptions): GcpComputeManager {
  return new GcpComputeManager(projectId, retryOptions);
}
