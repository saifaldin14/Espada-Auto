/**
 * GCP Extension — Resource Manager (Projects)
 *
 * Manages GCP projects, labels, and enabled APIs.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

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
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /** Get details for a specific project. */
  async getProject(projectId: string): Promise<GcpProject> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudresourcemanager.googleapis.com/v3/projects/${projectId}`;
      throw new Error(`Project ${projectId} not found (placeholder)`);
    }, this.retryOptions);
  }

  /** List projects accessible to the caller, optionally filtered. */
  async listProjects(opts?: { filter?: string }): Promise<GcpProject[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudresourcemanager.googleapis.com/v3/projects`;
      const _params = { filter: opts?.filter };
      return [] as GcpProject[];
    }, this.retryOptions);
  }

  /** Get the labels for a project. */
  async getLabels(projectId: string): Promise<Record<string, string>> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudresourcemanager.googleapis.com/v3/projects/${projectId}`;
      return {} as Record<string, string>;
    }, this.retryOptions);
  }

  /** Update labels on a project. */
  async updateLabels(
    projectId: string,
    labels: Record<string, string>,
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudresourcemanager.googleapis.com/v3/projects/${projectId}`;
      const _body = { labels };
      return {
        success: true,
        message: `Labels updated on project ${projectId} (placeholder)`,
      } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** List enabled APIs/services for a project. */
  async listApis(projectId: string): Promise<GcpEnabledApi[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://serviceusage.googleapis.com/v1/projects/${projectId}/services?filter=state:ENABLED`;
      return [] as GcpEnabledApi[];
    }, this.retryOptions);
  }

  /** Enable an API/service on a project. */
  async enableApi(projectId: string, api: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${api}:enable`;
      return {
        success: true,
        message: `API ${api} enabled on project ${projectId} (placeholder)`,
      } as GcpOperationResult;
    }, this.retryOptions);
  }
}
