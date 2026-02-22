/**
 * GCP Extension — App Engine Manager
 *
 * Manages App Engine applications, services, and versions.
 * Uses native fetch() via shared API helpers — no SDK needed.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpList, gcpRequest, gcpMutate, shortName } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** An App Engine application. */
export type GcpAppEngineApp = {
  id: string;
  locationId: string;
  servingStatus: string;
  defaultHostname: string;
};

/** An App Engine service. */
export type GcpAppEngineService = {
  name: string;
  id: string;
  split: Record<string, number>;
};

/** An App Engine version. */
export type GcpAppEngineVersion = {
  name: string;
  id: string;
  runtime: string;
  servingStatus: string;
  createTime: string;
  versionUrl: string;
};

// =============================================================================
// GcpAppEngineManager
// =============================================================================

/**
 * Manages GCP App Engine resources.
 *
 * Provides methods for inspecting the application, listing services and
 * versions, and deleting specific versions.
 */
export class GcpAppEngineManager {
  private projectId: string;
  private retryOptions: GcpRetryOptions;
  private getAccessToken: () => Promise<string>;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** Get the App Engine application for the project. */
  async getApplication(): Promise<GcpAppEngineApp> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://appengine.googleapis.com/v1/apps/${this.projectId}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return {
        id: (raw.id as string) ?? "",
        locationId: (raw.locationId as string) ?? "",
        servingStatus: (raw.servingStatus as string) ?? "",
        defaultHostname: (raw.defaultHostname as string) ?? "",
      };
    }, this.retryOptions);
  }

  /** List all services in the App Engine application. */
  async listServices(): Promise<GcpAppEngineService[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://appengine.googleapis.com/v1/apps/${this.projectId}/services`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "services");
      return raw.map((s) => this.mapService(s));
    }, this.retryOptions);
  }

  /** Get a single App Engine service by name. */
  async getService(name: string): Promise<GcpAppEngineService> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://appengine.googleapis.com/v1/apps/${this.projectId}/services/${name}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapService(raw);
    }, this.retryOptions);
  }

  /** List versions for an App Engine service. */
  async listVersions(service: string): Promise<GcpAppEngineVersion[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://appengine.googleapis.com/v1/apps/${this.projectId}/services/${service}/versions`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "versions");
      return raw.map((v) => ({
        name: shortName((v.name as string) ?? ""),
        id: (v.id as string) ?? "",
        runtime: (v.runtime as string) ?? "",
        servingStatus: (v.servingStatus as string) ?? "",
        createTime: (v.createTime as string) ?? "",
        versionUrl: (v.versionUrl as string) ?? "",
      }));
    }, this.retryOptions);
  }

  /** Delete a specific version of an App Engine service. */
  async deleteVersion(service: string, version: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://appengine.googleapis.com/v1/apps/${this.projectId}/services/${service}/versions/${version}`;
      return gcpMutate(url, token, undefined, "DELETE");
    }, this.retryOptions);
  }

  /** Map raw API response to GcpAppEngineService. */
  private mapService(s: Record<string, unknown>): GcpAppEngineService {
    const split = (s.split as Record<string, unknown>) ?? {};
    const allocations = (split.allocations as Record<string, number>) ?? {};
    return {
      name: shortName((s.name as string) ?? ""),
      id: (s.id as string) ?? "",
      split: allocations,
    };
  }
}

/** Factory: create a GcpAppEngineManager instance. */
export function createAppEngineManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpAppEngineManager {
  return new GcpAppEngineManager(projectId, getAccessToken, retryOptions);
}
