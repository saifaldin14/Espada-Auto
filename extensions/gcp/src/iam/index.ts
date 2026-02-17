/**
 * GCP Extension — IAM Manager
 *
 * Manages IAM service accounts, policies, bindings, and roles.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

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
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all service accounts in the project. */
  async listServiceAccounts(): Promise<GcpServiceAccount[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://iam.googleapis.com/v1/projects/${this.projectId}/serviceAccounts`;
      return [] as GcpServiceAccount[];
    }, this.retryOptions);
  }

  /** Get a single service account by email. */
  async getServiceAccount(email: string): Promise<GcpServiceAccount> {
    return withGcpRetry(async () => {
      const _endpoint = `https://iam.googleapis.com/v1/projects/${this.projectId}/serviceAccounts/${email}`;
      throw new Error(`Service account ${email} not found (placeholder)`);
    }, this.retryOptions);
  }

  /** Create a new service account. */
  async createServiceAccount(
    accountId: string,
    displayName: string,
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://iam.googleapis.com/v1/projects/${this.projectId}/serviceAccounts`;
      const _body = { accountId, serviceAccount: { displayName } };
      return { success: true, message: `Service account ${accountId} created (placeholder)` } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** Delete a service account by email. */
  async deleteServiceAccount(email: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://iam.googleapis.com/v1/projects/${this.projectId}/serviceAccounts/${email}`;
      return { success: true, message: `Service account ${email} deleted (placeholder)` } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** Get the IAM policy for the project. */
  async getIamPolicy(): Promise<GcpIamPolicy> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudresourcemanager.googleapis.com/v1/projects/${this.projectId}:getIamPolicy`;
      return { bindings: [], etag: "", version: 1 } as GcpIamPolicy;
    }, this.retryOptions);
  }

  /** Set the IAM policy for the project. */
  async setIamPolicy(policy: GcpIamPolicy): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudresourcemanager.googleapis.com/v1/projects/${this.projectId}:setIamPolicy`;
      const _body = { policy };
      return { success: true, message: "IAM policy updated (placeholder)" } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** List IAM roles, optionally including deleted roles. */
  async listRoles(opts?: { showDeleted?: boolean }): Promise<GcpRole[]> {
    return withGcpRetry(async () => {
      const showDeleted = opts?.showDeleted ? "true" : "false";
      const _endpoint = `https://iam.googleapis.com/v1/roles?showDeleted=${showDeleted}`;
      return [] as GcpRole[];
    }, this.retryOptions);
  }

  /** Get a single IAM role by fully qualified name. */
  async getRole(name: string): Promise<GcpRole> {
    return withGcpRetry(async () => {
      const _endpoint = `https://iam.googleapis.com/v1/${name}`;
      throw new Error(`Role ${name} not found (placeholder)`);
    }, this.retryOptions);
  }
}
