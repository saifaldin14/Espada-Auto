/**
 * GCP Extension — IAM Manager
 *
 * Manages IAM service accounts, policies, bindings, and roles.
 * Uses native fetch() via shared API helpers — no SDK needed.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** A GCP IAM service account. */
export type GcpServiceAccount = {
  email: string;
  name: string;
  displayName: string;
  disabled: boolean;
  uniqueId: string;
  description: string;
};

/** An IAM policy binding. */
export type GcpIamBinding = {
  role: string;
  members: string[];
  condition?: {
    title: string;
    description?: string;
    expression: string;
  };
};

/** A project-level IAM policy. */
export type GcpIamPolicy = {
  bindings: GcpIamBinding[];
  etag: string;
  version: number;
};

/** An IAM role (predefined or custom). */
export type GcpRole = {
  name: string;
  title: string;
  description: string;
  includedPermissions: string[];
  stage: string;
};

// =============================================================================
// GcpIAMManager
// =============================================================================

/**
 * Manages GCP IAM resources.
 *
 * Provides methods for managing service accounts, IAM policies/bindings,
 * and role introspection.
 */
export class GcpIAMManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all service accounts in the project. */
  async listServiceAccounts(): Promise<GcpServiceAccount[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://iam.googleapis.com/v1/projects/${this.projectId}/serviceAccounts`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "accounts");
      return raw.map((a) => ({
        email: (a.email as string) ?? "",
        name: (a.name as string) ?? "",
        displayName: (a.displayName as string) ?? "",
        disabled: (a.disabled as boolean) ?? false,
        uniqueId: (a.uniqueId as string) ?? "",
        description: (a.description as string) ?? "",
      }));
    }, this.retryOptions);
  }

  /** Get a single service account by email. */
  async getServiceAccount(email: string): Promise<GcpServiceAccount> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://iam.googleapis.com/v1/projects/-/serviceAccounts/${email}`;
      const a = await gcpRequest<Record<string, unknown>>(url, token);
      return {
        email: (a.email as string) ?? "",
        name: (a.name as string) ?? "",
        displayName: (a.displayName as string) ?? "",
        disabled: (a.disabled as boolean) ?? false,
        uniqueId: (a.uniqueId as string) ?? "",
        description: (a.description as string) ?? "",
      };
    }, this.retryOptions);
  }

  /** Create a new service account. */
  async createServiceAccount(
    accountId: string,
    displayName: string,
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://iam.googleapis.com/v1/projects/${this.projectId}/serviceAccounts`;
      const body = { accountId, serviceAccount: { displayName } };
      return gcpMutate(url, token, body);
    }, this.retryOptions);
  }

  /** Delete a service account by email. */
  async deleteServiceAccount(email: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://iam.googleapis.com/v1/projects/-/serviceAccounts/${email}`;
      return gcpMutate(url, token, undefined, "DELETE");
    }, this.retryOptions);
  }

  /** Get the IAM policy for the project. */
  async getIamPolicy(): Promise<GcpIamPolicy> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudresourcemanager.googleapis.com/v1/projects/${this.projectId}:getIamPolicy`;
      const data = await gcpRequest<Record<string, unknown>>(url, token, { method: "POST", body: {} });
      return {
        bindings: (data.bindings as GcpIamBinding[]) ?? [],
        etag: (data.etag as string) ?? "",
        version: (data.version as number) ?? 1,
      };
    }, this.retryOptions);
  }

  /** Set the IAM policy for the project. */
  async setIamPolicy(policy: GcpIamPolicy): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudresourcemanager.googleapis.com/v1/projects/${this.projectId}:setIamPolicy`;
      await gcpRequest(url, token, { method: "POST", body: { policy } });
      return { success: true, message: "IAM policy updated" };
    }, this.retryOptions);
  }

  /** List IAM roles, optionally including deleted roles. */
  async listRoles(opts?: { showDeleted?: boolean }): Promise<GcpRole[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const showDeleted = opts?.showDeleted ? "true" : "false";
      const url = `https://iam.googleapis.com/v1/roles?showDeleted=${showDeleted}`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "roles");
      return raw.map((r) => ({
        name: (r.name as string) ?? "",
        title: (r.title as string) ?? "",
        description: (r.description as string) ?? "",
        includedPermissions: (r.includedPermissions as string[]) ?? [],
        stage: (r.stage as string) ?? "",
      }));
    }, this.retryOptions);
  }

  /** Get a single IAM role by fully qualified name. */
  async getRole(name: string): Promise<GcpRole> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://iam.googleapis.com/v1/${name}`;
      const r = await gcpRequest<Record<string, unknown>>(url, token);
      return {
        name: (r.name as string) ?? "",
        title: (r.title as string) ?? "",
        description: (r.description as string) ?? "",
        includedPermissions: (r.includedPermissions as string[]) ?? [],
        stage: (r.stage as string) ?? "",
      };
    }, this.retryOptions);
  }
}
