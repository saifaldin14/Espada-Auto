/**
 * GCP Extension — Cloud DNS Manager
 *
 * Manages Cloud DNS zones and record sets.
 * Uses native fetch() via shared API helpers — no SDK needed.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpList, gcpRequest, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** A Cloud DNS managed zone. */
export type GcpManagedZone = {
  name: string;
  dnsName: string;
  description: string;
  visibility: "public" | "private";
  nameServers: string[];
  createdAt: string;
};

/** A DNS resource record set. */
export type GcpDNSRecord = {
  name: string;
  type: string;
  ttl: number;
  rrdatas: string[];
};

/** Input for creating a DNS record set. */
export type GcpDNSRecordInput = {
  name: string;
  type: string;
  ttl: number;
  rrdatas: string[];
};

// =============================================================================
// GcpDNSManager
// =============================================================================

/**
 * Manages GCP Cloud DNS resources.
 *
 * Provides methods for creating and managing DNS zones and record sets.
 */
export class GcpDNSManager {
  private projectId: string;
  private retryOptions: GcpRetryOptions;
  private getAccessToken: () => Promise<string>;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all managed DNS zones in the project. */
  async listManagedZones(): Promise<GcpManagedZone[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://dns.googleapis.com/dns/v1/projects/${this.projectId}/managedZones`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "managedZones");
      return raw.map((z) => ({
        name: (z.name as string) ?? "",
        dnsName: (z.dnsName as string) ?? "",
        description: (z.description as string) ?? "",
        visibility: (z.visibility as "public" | "private") ?? "public",
        nameServers: (z.nameServers as string[]) ?? [],
        createdAt: (z.creationTime as string) ?? "",
      }));
    }, this.retryOptions);
  }

  /** Get a single managed zone by name. */
  async getManagedZone(name: string): Promise<GcpManagedZone> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://dns.googleapis.com/dns/v1/projects/${this.projectId}/managedZones/${name}`;
      const z = await gcpRequest<Record<string, unknown>>(url, token);
      return {
        name: (z.name as string) ?? "",
        dnsName: (z.dnsName as string) ?? "",
        description: (z.description as string) ?? "",
        visibility: (z.visibility as "public" | "private") ?? "public",
        nameServers: (z.nameServers as string[]) ?? [],
        createdAt: (z.creationTime as string) ?? "",
      };
    }, this.retryOptions);
  }

  /** Create a new managed DNS zone. */
  async createManagedZone(zone: {
    name: string;
    dnsName: string;
    description?: string;
  }): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://dns.googleapis.com/dns/v1/projects/${this.projectId}/managedZones`;
      return gcpMutate(url, token, {
        name: zone.name,
        dnsName: zone.dnsName,
        description: zone.description ?? "",
      });
    }, this.retryOptions);
  }

  /** Delete a managed DNS zone by name. */
  async deleteManagedZone(name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://dns.googleapis.com/dns/v1/projects/${this.projectId}/managedZones/${name}`;
      return gcpMutate(url, token, undefined, "DELETE");
    }, this.retryOptions);
  }

  /** List all record sets in a managed zone. */
  async listRecordSets(zone: string): Promise<GcpDNSRecord[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://dns.googleapis.com/dns/v1/projects/${this.projectId}/managedZones/${zone}/rrsets`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "rrsets");
      return raw.map((r) => ({
        name: (r.name as string) ?? "",
        type: (r.type as string) ?? "",
        ttl: (r.ttl as number) ?? 0,
        rrdatas: (r.rrdatas as string[]) ?? [],
      }));
    }, this.retryOptions);
  }

  /** Create a new record set in a managed zone. */
  async createRecordSet(zone: string, record: GcpDNSRecordInput): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://dns.googleapis.com/dns/v1/projects/${this.projectId}/managedZones/${zone}/rrsets`;
      return gcpMutate(url, token, record);
    }, this.retryOptions);
  }

  /** Delete a record set from a managed zone. */
  async deleteRecordSet(zone: string, name: string, type: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://dns.googleapis.com/dns/v1/projects/${this.projectId}/managedZones/${zone}/rrsets/${name}/${type}`;
      return gcpMutate(url, token, undefined, "DELETE");
    }, this.retryOptions);
  }
}
