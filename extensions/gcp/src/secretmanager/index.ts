/**
 * GCP Extension — Secret Manager
 *
 * Manages secrets, secret versions, and secret access.
 * Uses native fetch() via shared API helpers — no SDK needed.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate, shortName } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** A Secret Manager secret. */
export type GcpSecret = {
  name: string;
  createTime: string;
  labels: Record<string, string>;
  replication: string;
};

/** A version of a Secret Manager secret. */
export type GcpSecretVersion = {
  name: string;
  state: string;
  createTime: string;
};

// =============================================================================
// Helpers
// =============================================================================

/** Describe a replication config object as a human-readable string. */
function describeReplication(replication: unknown): string {
  if (!replication || typeof replication !== "object") return "";
  const rep = replication as Record<string, unknown>;
  if ("automatic" in rep) return "AUTOMATIC";
  if ("userManaged" in rep) return "USER_MANAGED";
  return JSON.stringify(rep);
}

// =============================================================================
// GcpSecretManagerManager
// =============================================================================

/**
 * Manages GCP Secret Manager resources.
 *
 * Provides methods for creating, listing, and accessing secrets
 * and their versions.
 */
export class GcpSecretManagerManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all secrets in the project. */
  async listSecrets(): Promise<GcpSecret[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://secretmanager.googleapis.com/v1/projects/${this.projectId}/secrets`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "secrets");
      return raw.map((s) => ({
        name: shortName((s.name as string) ?? ""),
        createTime: (s.createTime as string) ?? "",
        labels: (s.labels as Record<string, string>) ?? {},
        replication: s.replication ? describeReplication(s.replication) : "",
      }));
    }, this.retryOptions);
  }

  /** Get a single secret by name. */
  async getSecret(name: string): Promise<GcpSecret> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://secretmanager.googleapis.com/v1/projects/${this.projectId}/secrets/${name}`;
      const s = await gcpRequest<Record<string, unknown>>(url, token);
      return {
        name: shortName((s.name as string) ?? ""),
        createTime: (s.createTime as string) ?? "",
        labels: (s.labels as Record<string, string>) ?? {},
        replication: s.replication ? describeReplication(s.replication) : "",
      };
    }, this.retryOptions);
  }

  /** Create a new secret. */
  async createSecret(
    secretId: string,
    opts?: { labels?: Record<string, string>; replication?: string },
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://secretmanager.googleapis.com/v1/projects/${this.projectId}/secrets?secretId=${encodeURIComponent(secretId)}`;
      const body = {
        replication: { automatic: {} },
        labels: opts?.labels ?? {},
      };
      return gcpMutate(url, token, body);
    }, this.retryOptions);
  }

  /** Delete a secret by name. */
  async deleteSecret(name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://secretmanager.googleapis.com/v1/projects/${this.projectId}/secrets/${name}`;
      return gcpMutate(url, token, undefined, "DELETE");
    }, this.retryOptions);
  }

  /** Add a new version to an existing secret with the given payload. */
  async addSecretVersion(secret: string, payload: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://secretmanager.googleapis.com/v1/projects/${this.projectId}/secrets/${secret}:addVersion`;
      const body = { payload: { data: Buffer.from(payload).toString("base64") } };
      return gcpMutate(url, token, body);
    }, this.retryOptions);
  }

  /**
   * Access a secret version's payload.
   *
   * @param secret  - The secret name.
   * @param version - The version to access (defaults to "latest").
   */
  async accessSecretVersion(secret: string, version?: string): Promise<string> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const ver = version ?? "latest";
      const url = `https://secretmanager.googleapis.com/v1/projects/${this.projectId}/secrets/${secret}/versions/${ver}:access`;
      const data = await gcpRequest<{ payload?: { data?: string } }>(url, token);
      const b64 = data.payload?.data ?? "";
      return Buffer.from(b64, "base64").toString("utf-8");
    }, this.retryOptions);
  }

  /** List all versions of a secret. */
  async listSecretVersions(secret: string): Promise<GcpSecretVersion[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://secretmanager.googleapis.com/v1/projects/${this.projectId}/secrets/${secret}/versions`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "versions");
      return raw.map((v) => ({
        name: shortName((v.name as string) ?? ""),
        state: (v.state as string) ?? "",
        createTime: (v.createTime as string) ?? "",
      }));
    }, this.retryOptions);
  }
}
