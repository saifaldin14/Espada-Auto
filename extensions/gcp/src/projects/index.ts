/**
 * GCP Extension — Resource Manager (Projects)
 *
 * Manages GCP projects, labels, and enabled APIs via the
 * Cloud Resource Manager v3 and Service Usage v1 REST APIs.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** A GCP project. */
export type GcpProject = {
  projectId: string;
  name: string;
  projectNumber: string;
  state: string;
  labels: Record<string, string>;
  createTime: string;
  parent: { type: string; id: string };
};

/** An API/service enabled on a project. */
export type GcpEnabledApi = {
  name: string;
  title: string;
  state: string;
};

// =============================================================================
// GcpProjectManager
// =============================================================================

/**
 * Manages GCP projects and their configuration.
 *
 * Provides methods for inspecting project metadata, labels, and
 * enabled APIs/services.
 */
export class GcpProjectManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** Map CRM v3 raw response to our GcpProject type. */
  private mapProject(raw: Record<string, unknown>): GcpProject {
    const resourceName = (raw.name ?? "") as string; // "projects/123456"
    const parentStr = (raw.parent ?? "") as string; // "folders/123" or "organizations/456"
    const parentParts = parentStr.split("/");
    return {
      projectId: (raw.projectId ?? "") as string,
      name: (raw.displayName ?? raw.projectId ?? "") as string,
      projectNumber: resourceName.replace("projects/", ""),
      state: (raw.state ?? "") as string,
      labels: (raw.labels ?? {}) as Record<string, string>,
      createTime: (raw.createTime ?? "") as string,
      parent: {
        type: parentParts[0] ?? "",
        id: parentParts[1] ?? "",
      },
    };
  }

  /** Map Service Usage raw response to our GcpEnabledApi type. */
  private mapApi(raw: Record<string, unknown>): GcpEnabledApi {
    const config = (raw.config ?? {}) as Record<string, unknown>;
    return {
      name: (raw.name ?? "") as string,
      title: (config.title ?? "") as string,
      state: (raw.state ?? "") as string,
    };
  }

  /** Get details for a specific project. */
  async getProject(projectId: string): Promise<GcpProject> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudresourcemanager.googleapis.com/v3/projects/${projectId}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapProject(raw);
    }, this.retryOptions);
  }

  /** List projects accessible to the caller, optionally filtered. */
  async listProjects(opts?: { filter?: string }): Promise<GcpProject[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      let url = `https://cloudresourcemanager.googleapis.com/v3/projects`;
      if (opts?.filter) {
        url += `?filter=${encodeURIComponent(opts.filter)}`;
      }
      const rawList = await gcpList<Record<string, unknown>>(url, token, "projects");
      return rawList.map((raw) => this.mapProject(raw));
    }, this.retryOptions);
  }

  /** Get the labels for a project. */
  async getLabels(projectId: string): Promise<Record<string, string>> {
    const project = await this.getProject(projectId);
    return project.labels;
  }

  /** Update labels on a project. */
  async updateLabels(
    projectId: string,
    labels: Record<string, string>,
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      return gcpMutate(
        `https://cloudresourcemanager.googleapis.com/v3/projects/${projectId}?updateMask=labels`,
        token,
        { labels },
        "PATCH",
      );
    }, this.retryOptions);
  }

  /** List enabled APIs/services for a project. */
  async listApis(projectId: string): Promise<GcpEnabledApi[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://serviceusage.googleapis.com/v1/projects/${projectId}/services?filter=state:ENABLED`;
      const rawList = await gcpList<Record<string, unknown>>(url, token, "services");
      return rawList.map((raw) => this.mapApi(raw));
    }, this.retryOptions);
  }

  /** Enable an API/service on a project. */
  async enableApi(projectId: string, api: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${api}:enable`;
      return gcpMutate(url, token, {});
    }, this.retryOptions);
  }
}
