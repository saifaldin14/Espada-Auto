/**
 * GCP Extension — Credentials Manager
 *
 * Manages GCP authentication via Application Default Credentials,
 * service account key files, gcloud CLI, and GCE/Cloud Run metadata server.
 * Uses native Node.js `crypto` for JWT signing — no SDK needed.
 */

import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

import type { GcpRetryOptions, GcpPluginConfig } from "../types.js";
import { withGcpRetry } from "../retry.js";

const execAsync = promisify(execCb);

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

/** Shape of a service account JSON key file. */
type ServiceAccountKey = {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
};

/** Shape of an ADC authorized_user credential file. */
type AuthorizedUserCredential = {
  type: "authorized_user";
  client_id: string;
  client_secret: string;
  refresh_token: string;
  quota_project_id?: string;
};

/** OAuth2 token response from Google. */
type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

/** GCE metadata server token response. */
type MetadataTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

// =============================================================================
// Constants
// =============================================================================

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const METADATA_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default";
const METADATA_PROJECT_URL =
  "http://metadata.google.internal/computeMetadata/v1/project/project-id";

// =============================================================================
// Credential Cache
// =============================================================================

class CredentialCache {
  private cache = new Map<string, { token: string; expiresAt: number }>();

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    // Refresh 5 minutes before expiry
    if (Date.now() > entry.expiresAt - 300_000) {
      this.cache.delete(key);
      return null;
    }
    return entry.token;
  }

  set(key: string, token: string, expiresInSeconds: number): void {
    this.cache.set(key, {
      token,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

// =============================================================================
// JWT Signing (for service account auth)
// =============================================================================

function base64url(input: string | Buffer): string {
  const b64 = Buffer.from(input).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Create a signed JWT for service account authentication.
 * Uses RS256 (RSA + SHA-256) per Google OAuth2 spec.
 */
function createServiceAccountJwt(key: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: CLOUD_PLATFORM_SCOPE,
      aud: key.token_uri || GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );

  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = base64url(signer.sign(key.private_key));

  return `${unsigned}.${signature}`;
}

// =============================================================================
// Token acquisition helpers
// =============================================================================

/** Exchange a service account JWT for an OAuth2 access token. */
async function getTokenFromServiceAccount(key: ServiceAccountKey): Promise<TokenResponse> {
  const jwt = createServiceAccountJwt(key);

  const res = await fetch(key.token_uri || GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(jwt)}`,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Service account token exchange failed (HTTP ${res.status}): ${errBody}`);
  }

  return (await res.json()) as TokenResponse;
}

/** Use a refresh token (authorized_user ADC) to obtain an access token. */
async function getTokenFromRefreshToken(cred: AuthorizedUserCredential): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: [
      `grant_type=refresh_token`,
      `client_id=${encodeURIComponent(cred.client_id)}`,
      `client_secret=${encodeURIComponent(cred.client_secret)}`,
      `refresh_token=${encodeURIComponent(cred.refresh_token)}`,
    ].join("&"),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Refresh token exchange failed (HTTP ${res.status}): ${errBody}`);
  }

  return (await res.json()) as TokenResponse;
}

/** Fetch an access token from the GCE metadata server. */
async function getTokenFromMetadataServer(): Promise<MetadataTokenResponse> {
  const res = await fetch(`${METADATA_URL}/token`, {
    headers: { "Metadata-Flavor": "Google" },
  });

  if (!res.ok) {
    throw new Error(`Metadata server token request failed (HTTP ${res.status})`);
  }

  return (await res.json()) as MetadataTokenResponse;
}

/** Get the project ID from the GCE metadata server. */
async function getProjectIdFromMetadata(): Promise<string> {
  const res = await fetch(METADATA_PROJECT_URL, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!res.ok) throw new Error("Failed to get project ID from metadata server");
  return (await res.text()).trim();
}

/** Get an access token via `gcloud auth print-access-token`. */
async function getTokenFromGcloudCli(): Promise<string> {
  const { stdout } = await execAsync("gcloud auth print-access-token");
  const token = stdout.trim();
  if (!token) throw new Error("gcloud CLI returned empty access token");
  return token;
}

/** Get the project ID from `gcloud config get-value project`. */
async function getProjectIdFromGcloud(): Promise<string> {
  const { stdout } = await execAsync("gcloud config get-value project 2>/dev/null");
  return stdout.trim();
}

/** Read a JSON file and parse it. */
async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as T;
}

/**
 * Locate the Application Default Credentials file.
 * Checks GOOGLE_APPLICATION_CREDENTIALS env var first, then the well-known path.
 */
function getAdcFilePath(): string {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  return join(homedir(), ".config", "gcloud", "application_default_credentials.json");
}

// =============================================================================
// GcpCredentialsManager
// =============================================================================

/**
 * Manages GCP authentication across multiple credential methods.
 *
 * Supports Application Default Credentials (service account + authorized user),
 * explicit service account JSON key files, gcloud CLI-based auth, and the
 * GCE/Cloud Run metadata server (workload identity).
 */
export class GcpCredentialsManager {
  private projectId: string;
  private method: GcpCredentialMethod;
  private serviceAccountKeyFile?: string;
  private retryOptions: GcpRetryOptions;
  private cache: CredentialCache;
  private initialized = false;
  private resolvedAdcType?: "service_account" | "authorized_user";

  constructor(options: GcpCredentialsManagerOptions = {}) {
    this.projectId = options.projectId ?? "";
    this.method = options.credentialMethod ?? "default";
    this.serviceAccountKeyFile = options.serviceAccountKeyFile;
    this.retryOptions = options.retry ?? {};
    this.cache = new CredentialCache();
  }

  /**
   * Initialize the credentials manager.
   * Validates the chosen auth method and discovers the project ID if needed.
   */
  async initialize(): Promise<void> {
    await withGcpRetry(async () => {
      switch (this.method) {
        case "default": {
          // Try reading ADC file to determine type and project
          try {
            const adcPath = getAdcFilePath();
            const cred = await readJsonFile<Record<string, unknown>>(adcPath);

            if (cred.type === "service_account") {
              this.resolvedAdcType = "service_account";
              if (!this.projectId) {
                this.projectId = (cred as ServiceAccountKey).project_id;
              }
            } else if (cred.type === "authorized_user") {
              this.resolvedAdcType = "authorized_user";
              if (!this.projectId) {
                const au = cred as AuthorizedUserCredential;
                this.projectId = au.quota_project_id ?? "";
              }
            }
          } catch {
            // ADC file not found — fall back to metadata server
            try {
              if (!this.projectId) {
                this.projectId = await getProjectIdFromMetadata();
              }
            } catch {
              // Not on GCE either — try gcloud
              if (!this.projectId) {
                try {
                  this.projectId = await getProjectIdFromGcloud();
                } catch {
                  // No project found
                }
              }
            }
          }
          break;
        }
        case "service-account": {
          if (!this.serviceAccountKeyFile) {
            throw new Error("Service account key file is required for service-account auth");
          }
          const key = await readJsonFile<ServiceAccountKey>(this.serviceAccountKeyFile);
          if (key.type !== "service_account") {
            throw new Error(`Expected service_account key file, got type: ${key.type}`);
          }
          if (!this.projectId) {
            this.projectId = key.project_id;
          }
          break;
        }
        case "gcloud-cli": {
          // Verify gcloud is available
          await getTokenFromGcloudCli();
          if (!this.projectId) {
            this.projectId = await getProjectIdFromGcloud();
          }
          break;
        }
        case "workload-identity": {
          // Metadata server must be reachable
          await getTokenFromMetadataServer();
          if (!this.projectId) {
            this.projectId = await getProjectIdFromMetadata();
          }
          break;
        }
      }
      this.initialized = true;
    }, this.retryOptions);
  }

  /**
   * Resolve a credential for API calls.
   * Returns the auth method, project ID, and an access token.
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

      let accessToken: string;
      let expiresIn = 3600;

      switch (this.method) {
        case "default": {
          // ADC: try file first, then metadata server, then gcloud
          try {
            const adcPath = getAdcFilePath();
            const cred = await readJsonFile<Record<string, unknown>>(adcPath);

            if (cred.type === "service_account" || this.resolvedAdcType === "service_account") {
              const tokenRes = await getTokenFromServiceAccount(cred as ServiceAccountKey);
              accessToken = tokenRes.access_token;
              expiresIn = tokenRes.expires_in;
            } else if (cred.type === "authorized_user" || this.resolvedAdcType === "authorized_user") {
              const tokenRes = await getTokenFromRefreshToken(cred as AuthorizedUserCredential);
              accessToken = tokenRes.access_token;
              expiresIn = tokenRes.expires_in;
            } else {
              throw new Error(`Unsupported ADC credential type: ${cred.type}`);
            }
          } catch (adcError) {
            // Fall back to metadata server
            try {
              const metaRes = await getTokenFromMetadataServer();
              accessToken = metaRes.access_token;
              expiresIn = metaRes.expires_in;
            } catch {
              // Fall back to gcloud CLI
              try {
                accessToken = await getTokenFromGcloudCli();
                expiresIn = 3600; // gcloud tokens are ~1 hour
              } catch {
                throw adcError; // Re-throw original error if all fallbacks fail
              }
            }
          }
          break;
        }
        case "service-account": {
          const key = await readJsonFile<ServiceAccountKey>(this.serviceAccountKeyFile!);
          const tokenRes = await getTokenFromServiceAccount(key);
          accessToken = tokenRes.access_token;
          expiresIn = tokenRes.expires_in;
          break;
        }
        case "gcloud-cli": {
          accessToken = await getTokenFromGcloudCli();
          expiresIn = 3600;
          break;
        }
        case "workload-identity": {
          const metaRes = await getTokenFromMetadataServer();
          accessToken = metaRes.access_token;
          expiresIn = metaRes.expires_in;
          break;
        }
      }

      this.cache.set(this.method, accessToken!, expiresIn);

      return { method: this.method, projectId: this.projectId, accessToken: accessToken! };
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
   * Useful for passing to service managers that need raw bearer tokens.
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
