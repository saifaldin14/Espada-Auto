/**
 * GCP Extension — Cloud CDN Manager
 *
 * Manages backend buckets, backend services, and cache invalidation.
 * Uses native fetch() via shared API helpers — no SDK needed.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpList, gcpRequest, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** A backend bucket used by Cloud CDN. */
export type GcpBackendBucket = {
  name: string;
  bucketName: string;
  enableCdn: boolean;
  cdnPolicy: Record<string, unknown>;
  createdAt: string;
};

/** A backend service used by Cloud CDN / load balancing. */
export type GcpBackendService = {
  name: string;
  backends: Array<Record<string, unknown>>;
  protocol: string;
  enableCdn: boolean;
  cdnPolicy: Record<string, unknown>;
  healthChecks: string[];
};

// =============================================================================
// GcpCDNManager
// =============================================================================

/**
 * Manages GCP Cloud CDN resources.
 *
 * Provides methods for listing and inspecting backend buckets and backend
 * services, and for invalidating CDN caches.
 */
export class GcpCDNManager {
  private projectId: string;
  private retryOptions: GcpRetryOptions;
  private getAccessToken: () => Promise<string>;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all backend buckets in the project. */
  async listBackendBuckets(): Promise<GcpBackendBucket[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/backendBuckets`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "items");
      return raw.map((b) => ({
        name: (b.name as string) ?? "",
        bucketName: (b.bucketName as string) ?? "",
        enableCdn: (b.enableCdn as boolean) ?? false,
        cdnPolicy: (b.cdnPolicy as Record<string, unknown>) ?? {},
        createdAt: (b.creationTimestamp as string) ?? "",
      }));
    }, this.retryOptions);
  }

  /** Get a single backend bucket by name. */
  async getBackendBucket(name: string): Promise<GcpBackendBucket> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/backendBuckets/${name}`;
      const b = await gcpRequest<Record<string, unknown>>(url, token);
      return {
        name: (b.name as string) ?? "",
        bucketName: (b.bucketName as string) ?? "",
        enableCdn: (b.enableCdn as boolean) ?? false,
        cdnPolicy: (b.cdnPolicy as Record<string, unknown>) ?? {},
        createdAt: (b.creationTimestamp as string) ?? "",
      };
    }, this.retryOptions);
  }

  /** List all backend services in the project. */
  async listBackendServices(): Promise<GcpBackendService[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/backendServices`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "items");
      return raw.map((s) => ({
        name: (s.name as string) ?? "",
        backends: (s.backends as Array<Record<string, unknown>>) ?? [],
        protocol: (s.protocol as string) ?? "",
        enableCdn: (s.enableCDN as boolean) ?? false,
        cdnPolicy: (s.cdnPolicy as Record<string, unknown>) ?? {},
        healthChecks: (s.healthChecks as string[]) ?? [],
      }));
    }, this.retryOptions);
  }

  /** Get a single backend service by name. */
  async getBackendService(name: string): Promise<GcpBackendService> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/backendServices/${name}`;
      const s = await gcpRequest<Record<string, unknown>>(url, token);
      return {
        name: (s.name as string) ?? "",
        backends: (s.backends as Array<Record<string, unknown>>) ?? [],
        protocol: (s.protocol as string) ?? "",
        enableCdn: (s.enableCDN as boolean) ?? false,
        cdnPolicy: (s.cdnPolicy as Record<string, unknown>) ?? {},
        healthChecks: (s.healthChecks as string[]) ?? [],
      };
    }, this.retryOptions);
  }

  /** Invalidate cached content for a URL map at a given path. */
  async invalidateCache(urlMap: string, path: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://compute.googleapis.com/compute/v1/projects/${this.projectId}/global/urlMaps/${urlMap}/invalidateCache`;
      return gcpMutate(url, token, { path });
    }, this.retryOptions);
  }
}
