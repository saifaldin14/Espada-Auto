/**
 * Provider Registry — Adapter Resolution & Lifecycle
 *
 * Central registry that maps MigrationProvider → CloudProviderAdapter.
 * Used by step handlers to obtain the correct source/target adapter
 * based on the migration job's credential configuration.
 *
 * Adapters are cached per (provider, credential-hash) so the same
 * credential set reuses a single adapter instance.
 */

import type { MigrationProvider } from "../types.js";
import type {
  CloudProviderAdapter,
  ProviderCredentialConfig,
  AWSCredentialConfig,
  AzureCredentialConfig,
  GCPCredentialConfig,
} from "./types.js";

// =============================================================================
// Provider Registry
// =============================================================================

/**
 * Singleton registry that creates and caches CloudProviderAdapter instances.
 *
 * Step handlers call `resolveAdapter(provider, credentialConfig)` to get
 * a ready-to-use adapter that wraps the real SDK managers.
 */
class ProviderRegistry {
  /** Cache keyed by `${provider}::${credentialHash}` */
  private adapters = new Map<string, CloudProviderAdapter>();

  /**
   * Resolve a provider adapter for the given provider and credentials.
   *
   * If the adapter has already been created for this credential set, the
   * cached instance is returned. Otherwise a new adapter is lazily loaded
   * from the provider-specific adapter module.
   */
  async resolveAdapter(
    provider: MigrationProvider,
    credentials: ProviderCredentialConfig,
  ): Promise<CloudProviderAdapter> {
    const key = this.credentialKey(provider, credentials);
    const cached = this.adapters.get(key);
    if (cached) return cached;

    let adapter: CloudProviderAdapter;

    switch (provider) {
      case "aws": {
        const { createAWSAdapter } = await import("./aws-adapter.js");
        adapter = createAWSAdapter(credentials as AWSCredentialConfig);
        break;
      }
      case "azure": {
        const { createAzureAdapter } = await import("./azure-adapter.js");
        adapter = createAzureAdapter(credentials as AzureCredentialConfig);
        break;
      }
      case "gcp": {
        const { createGCPAdapter } = await import("./gcp-adapter.js");
        adapter = createGCPAdapter(credentials as GCPCredentialConfig);
        break;
      }
      case "on-premises":
      case "vmware":
      case "nutanix":
        throw new Error(
          `Provider '${provider}' is not yet supported for automated migration. ` +
          `Supported providers: aws, azure, gcp.`,
        );
      default:
        throw new Error(`Unknown migration provider: ${provider}`);
    }

    this.adapters.set(key, adapter);
    return adapter;
  }

  /**
   * Check whether a specific provider is supported for automated migration.
   */
  isSupported(provider: MigrationProvider): boolean {
    return provider === "aws" || provider === "azure" || provider === "gcp";
  }

  /**
   * Clear all cached adapters. Called during service stop.
   */
  clear(): void {
    this.adapters.clear();
  }

  /**
   * Get the number of currently cached adapters (for diagnostics).
   */
  get size(): number {
    return this.adapters.size;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private credentialKey(provider: MigrationProvider, config: ProviderCredentialConfig): string {
    // Build a stable key from provider + relevant config fields
    switch (provider) {
      case "aws": {
        const aws = config as AWSCredentialConfig;
        return `aws::${aws.region}::${aws.accessKeyId ?? "default"}::${aws.profile ?? ""}`;
      }
      case "azure": {
        const az = config as AzureCredentialConfig;
        return `azure::${az.subscriptionId}::${az.tenantId ?? "default"}::${az.clientId ?? ""}`;
      }
      case "gcp": {
        const gcp = config as GCPCredentialConfig;
        return `gcp::${gcp.projectId}::${gcp.keyFilePath ?? "default"}`;
      }
      default:
        return `${provider}::${JSON.stringify(config)}`;
    }
  }
}

// =============================================================================
// Singleton instance
// =============================================================================

let registryInstance: ProviderRegistry | null = null;

/**
 * Get the singleton ProviderRegistry instance.
 */
export function getProviderRegistry(): ProviderRegistry {
  if (!registryInstance) {
    registryInstance = new ProviderRegistry();
  }
  return registryInstance;
}

/**
 * Reset the provider registry (for tests and service restart).
 */
export function resetProviderRegistry(): void {
  if (registryInstance) {
    registryInstance.clear();
  }
  registryInstance = null;
}

/**
 * Convenience: resolve an adapter for a provider using credentials
 * from the migration step context.
 *
 * This is the primary entry point for step handlers.
 */
export async function resolveProviderAdapter(
  provider: MigrationProvider,
  credentials: ProviderCredentialConfig,
): Promise<CloudProviderAdapter> {
  return getProviderRegistry().resolveAdapter(provider, credentials);
}
