/**
 * GCP Extension — Compute Engine Manager
 *
 * Manages Compute Engine instances, machine types, and disks.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpAggregatedList, shortName, gcpMutate } from "../api.js";

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
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /**
   * List Compute Engine instances, optionally filtered to a specific zone.
   *
   * @param opts - Optional filter with `zone` (omit to list across all zones).
   */
  async listInstances(opts?: { zone?: string }): Promise<GcpComputeInstance[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      if (opts?.zone) {
        const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${opts.zone}/instances`;
        const items = await gcpList<Record<string, unknown>>(url, token, "items");
        return items.map((i) => this.mapInstance(i));
      }
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/aggregated/instances`;
      const items = await gcpAggregatedList<Record<string, unknown>>(url, token, "instances");
      return items.map((i) => this.mapInstance(i));
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
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${zone}/instances/${name}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapInstance(raw);
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
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${zone}/instances/${name}/start`;
      return gcpMutate(url, token, {}, "POST");
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
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${zone}/instances/${name}/stop`;
      return gcpMutate(url, token, {}, "POST");
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
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${zone}/instances/${name}/reset`;
      return gcpMutate(url, token, {}, "POST");
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
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${zone}/instances/${name}`;
      return gcpMutate(url, token, {}, "DELETE");
    }, this.retryOptions);
  }

  /**
   * List available machine types in a zone.
   *
   * @param zone - The zone to query (e.g. "us-central1-a").
   */
  async listMachineTypes(zone: string): Promise<GcpMachineType[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${zone}/machineTypes`;
      const items = await gcpList<Record<string, unknown>>(url, token, "items");
      return items.map((mt) => ({
        name: String(mt.name ?? ""),
        description: String(mt.description ?? ""),
        guestCpus: Number(mt.guestCpus ?? 0),
        memoryMb: Number(mt.memoryMb ?? 0),
      }));
    }, this.retryOptions);
  }

  /**
   * List persistent disks, optionally filtered to a specific zone.
   *
   * @param opts - Optional filter with `zone` (omit to list across all zones).
   */
  async listDisks(opts?: { zone?: string }): Promise<GcpDisk[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      if (opts?.zone) {
        const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/zones/${opts.zone}/disks`;
        const items = await gcpList<Record<string, unknown>>(url, token, "items");
        return items.map((d) => this.mapDisk(d));
      }
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/aggregated/disks`;
      const items = await gcpAggregatedList<Record<string, unknown>>(url, token, "disks");
      return items.map((d) => this.mapDisk(d));
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Private mapping helpers
  // ---------------------------------------------------------------------------

  private mapInstance(raw: Record<string, unknown>): GcpComputeInstance {
    const networkInterfaces = (Array.isArray(raw.networkInterfaces) ? raw.networkInterfaces : []) as Array<Record<string, unknown>>;
    const disks = (Array.isArray(raw.disks) ? raw.disks : []) as Array<Record<string, unknown>>;
    return {
      name: String(raw.name ?? ""),
      zone: shortName(String(raw.zone ?? "")),
      machineType: shortName(String(raw.machineType ?? "")),
      status: String(raw.status ?? ""),
      networkInterfaces: networkInterfaces.map((ni) => ({
        network: String(ni.network ?? ""),
        subnetwork: ni.subnetwork ? String(ni.subnetwork) : undefined,
        networkIP: ni.networkIP ? String(ni.networkIP) : undefined,
        accessConfigs: Array.isArray(ni.accessConfigs)
          ? (ni.accessConfigs as Array<Record<string, unknown>>).map((ac) => ({
              name: String(ac.name ?? ""),
              natIP: ac.natIP ? String(ac.natIP) : undefined,
              type: String(ac.type ?? ""),
            }))
          : undefined,
      })),
      disks: disks.map((d) => ({
        deviceName: String(d.deviceName ?? ""),
        source: String(d.source ?? ""),
        boot: Boolean(d.boot),
        autoDelete: Boolean(d.autoDelete),
        sizeGb: d.diskSizeGb != null ? Number(d.diskSizeGb) : undefined,
      })),
      labels: (raw.labels as Record<string, string>) ?? {},
      createdAt: String(raw.creationTimestamp ?? ""),
    };
  }

  private mapDisk(raw: Record<string, unknown>): GcpDisk {
    return {
      name: String(raw.name ?? ""),
      zone: shortName(String(raw.zone ?? "")),
      sizeGb: Number(raw.sizeGb ?? 0),
      type: shortName(String(raw.type ?? "")),
      status: String(raw.status ?? ""),
      sourceImage: String(raw.sourceImage ?? ""),
    };
  }
}

/** Factory: create a GcpComputeManager instance. */
export function createComputeManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpComputeManager {
  return new GcpComputeManager(projectId, getAccessToken, retryOptions);
}
