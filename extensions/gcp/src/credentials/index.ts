/**
 * GCP Extension — Credentials Manager
 *
 * Manages GCP authentication via Application Default Credentials,
 * service account key files, gcloud CLI, and workload identity.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpRetryOptions, GcpPluginConfig } from "../types.js";
import { withGcpRetry } from "../retry.js";

// =============================================================================
// Types
// =============================================================================

/** Supported GCP authentication methods. */
export type GcpCredentialMethod =
  | "default"
  | "service-account"
  | "gcloud-cli"
  | "workload-identity";

/** Result of a credential resolution attempt. */
export type GcpCredentialResult = {
  method: GcpCredentialMethod;
  projectId: string;
  accessToken?: string;
};

/** Options for creating a credentials manager. */
export type GcpCredentialsManagerOptions = {
  projectId?: string;
  credentialMethod?: GcpCredentialMethod;
  serviceAccountKeyFile?: string;
  workloadIdentityProvider?: string;
  retry?: GcpRetryOptions;
};

// =============================================================================
// Credential Cache
// =============================================================================

class CredentialCache {
  private cache = new Map<string, { token: string; expiresAt: number }>();
  private ttlMs: number;

  constructor(ttlMs = 3_600_000) {
    this.ttlMs = ttlMs;
  }

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.token;
  }

  set(key: string, token: string): void {
    this.cache.set(key, {
      token,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

// =============================================================================
// GcpCredentialsManager
// =============================================================================

/**
 * Manages GCP authentication across multiple credential methods.
 *
 * Supports Application Default Credentials, service account JSON key files,
 * gcloud CLI-based auth, and workload identity federation.
 */
export class GcpCredentialsManager {
  private projectId: string;
  private method: GcpCredentialMethod;
  private serviceAccountKeyFile?: string;
  private workloadIdentityProvider?: string;
  private retryOptions: GcpRetryOptions;
  private cache: CredentialCache;
  private initialized = false;

  constructor(options: GcpCredentialsManagerOptions = {}) {
    this.projectId = options.projectId ?? "";
    this.method = options.credentialMethod ?? "default";
    this.serviceAccountKeyFile = options.serviceAccountKeyFile;
    this.workloadIdentityProvider = options.workloadIdentityProvider;
    this.retryOptions = options.retry ?? {};
    this.cache = new CredentialCache();
  }

  /**
   * Initialize the credentials manager.
   * Validates the chosen auth method and pre-warms the cache.
   */
  async initialize(): Promise<void> {
    await withGcpRetry(async () => {
      // Placeholder: validate credentials are available for the chosen method
      switch (this.method) {
        case "default":
          // Would use google-auth-library's GoogleAuth with ADC
          break;
        case "service-account":
          if (!this.serviceAccountKeyFile) {
            throw new Error("Service account key file is required for service-account auth");
          }
          // Would read and validate the JSON key file
          break;
        case "gcloud-cli":
          // Would exec `gcloud auth print-access-token` to verify CLI auth
          break;
        case "workload-identity":
          if (!this.workloadIdentityProvider) {
            throw new Error("Workload identity provider is required for workload-identity auth");
          }
          // Would configure workload identity federation
          break;
      }
      this.initialized = true;
    }, this.retryOptions);
  }

  /**
   * Resolve a credential for API calls.
   * Returns the auth method, project ID, and optionally an access token.
   */
  async getCredential(): Promise<GcpCredentialResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    return withGcpRetry(async () => {
      const cached = this.cache.get(this.method);
      if (cached) {
        return { method: this.method, projectId: this.projectId, accessToken: cached };
      }

      // Placeholder: obtain access token based on method
      let accessToken: string | undefined;

      switch (this.method) {
        case "default":
          // Would call GoogleAuth.getAccessToken()
          accessToken = `adc-placeholder-token-${Date.now()}`;
          break;
        case "service-account":
          // Would use JWT from service account key to get access token
          accessToken = `sa-placeholder-token-${Date.now()}`;
          break;
        case "gcloud-cli":
          // Would exec `gcloud auth print-access-token`
          accessToken = `cli-placeholder-token-${Date.now()}`;
          break;
        case "workload-identity":
          // Would use STS exchange for federated token
          accessToken = `wi-placeholder-token-${Date.now()}`;
          break;
      }

      if (accessToken) {
        this.cache.set(this.method, accessToken);
      }

      return { method: this.method, projectId: this.projectId, accessToken };
    }, this.retryOptions);
  }

  /** Clear the cached credentials. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Get the configured project ID. */
  getProjectId(): string {
    return this.projectId;
  }

  /**
   * Obtain a short-lived access token for the current auth method.
   * Useful for passing to clients that need raw bearer tokens.
   */
  async getAccessToken(): Promise<string> {
    const result = await this.getCredential();
    if (!result.accessToken) {
      throw new Error(`No access token available for method: ${result.method}`);
    }
    return result.accessToken;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a GcpCredentialsManager from a config object.
 *
 * @param config - GCP plugin configuration or credentials-specific options.
 * @returns A configured GcpCredentialsManager instance.
 */
export function createCredentialsManager(
  config: GcpPluginConfig | GcpCredentialsManagerOptions = {},
): GcpCredentialsManager {
  const opts: GcpCredentialsManagerOptions = {
    projectId: "defaultProject" in config ? config.defaultProject : (config as GcpCredentialsManagerOptions).projectId,
    credentialMethod:
      "credentialMethod" in config
        ? (config.credentialMethod as GcpCredentialMethod)
        : (config as GcpCredentialsManagerOptions).credentialMethod,
    serviceAccountKeyFile:
      "serviceAccountKeyFile" in config
        ? config.serviceAccountKeyFile
        : (config as GcpCredentialsManagerOptions).serviceAccountKeyFile,
    retry: config.retry,
  };

  return new GcpCredentialsManager(opts);
}
