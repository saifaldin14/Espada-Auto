/**
 * Azure Extension — Credentials Manager
 *
 * Manages Azure authentication using @azure/identity.
 * Supports DefaultAzureCredential chain, Azure CLI, Service Principal,
 * Managed Identity, and Interactive Browser flows.
 */

import type { TokenCredential } from "@azure/identity";
import type { AzurePluginConfig } from "../types.js";

// =============================================================================
// Types
// =============================================================================

export type AzureCredentialMethod =
  | "default"
  | "cli"
  | "service-principal"
  | "managed-identity"
  | "browser";

export type AzureCredentialSource = {
  method: AzureCredentialMethod;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  certificatePath?: string;
  managedIdentityClientId?: string;
};

export type CredentialsManagerOptions = {
  defaultSubscription?: string;
  defaultTenantId?: string;
  credentialMethod?: AzureCredentialMethod;
  credentialSources?: AzureCredentialSource[];
};

export type CredentialResolutionResult = {
  credential: TokenCredential;
  method: AzureCredentialMethod;
  subscriptionId?: string;
  tenantId?: string;
};

// =============================================================================
// Credential Cache
// =============================================================================

class CredentialCache {
  private cache = new Map<string, { credential: TokenCredential; expiresAt: number }>();
  private ttlMs: number;

  constructor(ttlMs = 3_600_000) {
    this.ttlMs = ttlMs;
  }

  get(key: string): TokenCredential | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.credential;
  }

  set(key: string, credential: TokenCredential): void {
    this.cache.set(key, {
      credential,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

// =============================================================================
// Credentials Manager
// =============================================================================

export class AzureCredentialsManager {
  private options: CredentialsManagerOptions;
  private cache = new CredentialCache();
  private currentCredential: CredentialResolutionResult | null = null;

  constructor(options: CredentialsManagerOptions = {}) {
    this.options = {
      credentialMethod: options.credentialMethod ?? "default",
      defaultSubscription: options.defaultSubscription ?? process.env.AZURE_SUBSCRIPTION_ID,
      defaultTenantId: options.defaultTenantId ?? process.env.AZURE_TENANT_ID,
      ...options,
    };
  }

  /**
   * Initialize the credentials manager and validate connectivity.
   */
  async initialize(): Promise<void> {
    await this.getCredential();
  }

  /**
   * Get an Azure TokenCredential, using the configured method.
   */
  async getCredential(method?: AzureCredentialMethod): Promise<CredentialResolutionResult> {
    const resolvedMethod = method ?? this.options.credentialMethod ?? "default";
    const cacheKey = `${resolvedMethod}:${this.options.defaultTenantId ?? ""}`;

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return {
        credential: cached,
        method: resolvedMethod,
        subscriptionId: this.options.defaultSubscription,
        tenantId: this.options.defaultTenantId,
      };
    }

    const credential = await this.createCredential(resolvedMethod);

    this.cache.set(cacheKey, credential);
    this.currentCredential = {
      credential,
      method: resolvedMethod,
      subscriptionId: this.options.defaultSubscription,
      tenantId: this.options.defaultTenantId,
    };

    return this.currentCredential;
  }

  /**
   * Get the subscription ID (from config or environment).
   */
  getSubscriptionId(): string | undefined {
    return this.options.defaultSubscription;
  }

  /**
   * Get the tenant ID (from config or environment).
   */
  getTenantId(): string | undefined {
    return this.options.defaultTenantId;
  }

  /**
   * Clear the credential cache.
   */
  clearCache(): void {
    this.cache.clear();
    this.currentCredential = null;
  }

  /**
   * Create a credential using the specified method.
   * Dynamic import of @azure/identity to avoid hard failures if not installed.
   */
  private async createCredential(method: AzureCredentialMethod): Promise<TokenCredential> {
    const identity = await import("@azure/identity");

    switch (method) {
      case "cli":
        return new identity.AzureCliCredential();

      case "service-principal": {
        const tenantId = this.options.defaultTenantId ?? process.env.AZURE_TENANT_ID;
        const clientId = process.env.AZURE_CLIENT_ID;
        const clientSecret = process.env.AZURE_CLIENT_SECRET;

        if (!tenantId || !clientId || !clientSecret) {
          throw new Error(
            "Service principal auth requires AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET",
          );
        }

        return new identity.ClientSecretCredential(tenantId, clientId, clientSecret);
      }

      case "managed-identity": {
        const clientId = process.env.AZURE_CLIENT_ID;
        return clientId
          ? new identity.ManagedIdentityCredential({ clientId })
          : new identity.ManagedIdentityCredential();
      }

      case "browser":
        return new identity.InteractiveBrowserCredential({
          tenantId: this.options.defaultTenantId,
        });

      case "default":
      default:
        return new identity.DefaultAzureCredential();
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createCredentialsManager(
  options?: CredentialsManagerOptions,
): AzureCredentialsManager {
  return new AzureCredentialsManager(options);
}

/**
 * Create credentials manager from plugin config.
 */
export function createCredentialsManagerFromConfig(
  config: AzurePluginConfig,
): AzureCredentialsManager {
  return new AzureCredentialsManager({
    defaultSubscription: config.defaultSubscription,
    defaultTenantId: config.defaultTenantId,
    credentialMethod: config.credentialMethod,
  });
}
