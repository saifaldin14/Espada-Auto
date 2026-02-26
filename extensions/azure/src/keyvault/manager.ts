/**
 * Azure Key Vault Manager
 *
 * Manages Azure Key Vaults via @azure/arm-keyvault and @azure/keyvault-secrets.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { KeyVault, KeyVaultSecret, KeyVaultKey } from "./types.js";

// =============================================================================
// AzureKeyVaultManager
// =============================================================================

export class AzureKeyVaultManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions: AzureRetryOptions;

  constructor(credentialsManager: AzureCredentialsManager, subscriptionId: string, retryOptions?: AzureRetryOptions) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions ?? {};
  }

  private async getManagementClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { KeyVaultManagementClient } = await import("@azure/arm-keyvault");
    return new KeyVaultManagementClient(credential, this.subscriptionId);
  }

  private async getSecretClient(vaultUrl: string) {
    const { credential } = await this.credentialsManager.getCredential();
    const { SecretClient } = await import("@azure/keyvault-secrets");
    return new SecretClient(vaultUrl, credential);
  }

  /**
   * List key vaults.
   */
  async listVaults(resourceGroup?: string): Promise<KeyVault[]> {
    const client = await this.getManagementClient();
    return withAzureRetry(async () => {
      const vaults: KeyVault[] = [];
      const iter = resourceGroup
        ? client.vaults.listByResourceGroup(resourceGroup)
        : client.vaults.listBySubscription();
      for await (const v of iter) {
        vaults.push({
          id: v.id ?? "", name: v.name ?? "",
          resourceGroup: (v.id ?? "").match(/resourceGroups\/([^/]+)/i)?.[1] ?? "",
          location: v.location ?? "",
          vaultUri: v.properties?.vaultUri ?? "",
          tenantId: v.properties?.tenantId,
          sku: v.properties?.sku?.name,
          enableSoftDelete: v.properties?.enableSoftDelete,
          enablePurgeProtection: v.properties?.enablePurgeProtection,
          softDeleteRetentionInDays: v.properties?.softDeleteRetentionInDays,
          tags: v.tags as Record<string, string>,
        });
      }
      return vaults;
    }, this.retryOptions);
  }

  /**
   * Get a specific vault.
   */
  async getVault(resourceGroup: string, vaultName: string): Promise<KeyVault | null> {
    const client = await this.getManagementClient();
    return withAzureRetry(async () => {
      try {
        const v = await client.vaults.get(resourceGroup, vaultName);
        return {
          id: v.id ?? "", name: v.name ?? "", resourceGroup, location: v.location ?? "",
          vaultUri: v.properties?.vaultUri ?? "",
          tenantId: v.properties?.tenantId,
          sku: v.properties?.sku?.name,
          enableSoftDelete: v.properties?.enableSoftDelete,
          enablePurgeProtection: v.properties?.enablePurgeProtection,
          softDeleteRetentionInDays: v.properties?.softDeleteRetentionInDays,
          tags: v.tags as Record<string, string>,
        };
      } catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return null; throw e; }
    }, this.retryOptions);
  }

  /**
   * List secrets in a vault.
   */
  async listSecrets(vaultUrl: string): Promise<KeyVaultSecret[]> {
    const client = await this.getSecretClient(vaultUrl);
    return withAzureRetry(async () => {
      const secrets: KeyVaultSecret[] = [];
      for await (const s of client.listPropertiesOfSecrets()) {
        secrets.push({
          id: s.id ?? "", name: s.name ?? "",
          contentType: s.contentType,
          enabled: s.enabled,
          notBefore: s.notBefore?.toISOString(),
          expiresOn: s.expiresOn?.toISOString(),
          createdOn: s.createdOn?.toISOString(),
          updatedOn: s.updatedOn?.toISOString(),
          tags: s.tags,
        });
      }
      return secrets;
    }, this.retryOptions);
  }

  /**
   * Get a specific secret value.
   */
  async getSecret(vaultUrl: string, secretName: string): Promise<KeyVaultSecret | null> {
    const client = await this.getSecretClient(vaultUrl);
    return withAzureRetry(async () => {
      try {
        const s = await client.getSecret(secretName);
        return {
          id: s.properties.id ?? "", name: s.name,
          value: s.value,
          contentType: s.properties.contentType,
          enabled: s.properties.enabled,
          notBefore: s.properties.notBefore?.toISOString(),
          expiresOn: s.properties.expiresOn?.toISOString(),
          createdOn: s.properties.createdOn?.toISOString(),
          updatedOn: s.properties.updatedOn?.toISOString(),
          tags: s.properties.tags,
        };
      } catch (e) { if ((e as { code?: string }).code === "SecretNotFound") return null; throw e; }
    }, this.retryOptions);
  }

  /**
   * Set a secret.
   */
  async setSecret(vaultUrl: string, secretName: string, value: string, contentType?: string): Promise<KeyVaultSecret> {
    const client = await this.getSecretClient(vaultUrl);
    return withAzureRetry(async () => {
      const s = await client.setSecret(secretName, value, { contentType });
      return {
        id: s.properties.id ?? "", name: s.name,
        value: s.value,
        contentType: s.properties.contentType,
        enabled: s.properties.enabled,
        createdOn: s.properties.createdOn?.toISOString(),
        updatedOn: s.properties.updatedOn?.toISOString(),
        tags: s.properties.tags,
      };
    }, this.retryOptions);
  }

  /**
   * Delete a secret (soft-delete).
   */
  async deleteSecret(vaultUrl: string, secretName: string): Promise<void> {
    const client = await this.getSecretClient(vaultUrl);
    await withAzureRetry(async () => {
      const poller = await client.beginDeleteSecret(secretName);
      await poller.pollUntilDone();
    }, this.retryOptions);
  }

  /**
   * List keys in a vault (via management API).
   */
  async listKeys(resourceGroup: string, vaultName: string): Promise<KeyVaultKey[]> {
    const client = await this.getManagementClient();
    return withAzureRetry(async () => {
      const keys: KeyVaultKey[] = [];
      for await (const k of client.keys.list(resourceGroup, vaultName)) {
        const keyProps = k as { properties?: { kty?: string; keyOps?: string[] } };
        keys.push({
          id: k.id ?? "", name: k.name ?? "",
          keyType: keyProps.properties?.kty,
          keyOps: keyProps.properties?.keyOps,
          tags: k.tags as Record<string, string>,
        });
      }
      return keys;
    }, this.retryOptions);
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createKeyVaultManager(
  credentialsManager: AzureCredentialsManager, subscriptionId: string, retryOptions?: AzureRetryOptions,
): AzureKeyVaultManager {
  return new AzureKeyVaultManager(credentialsManager, subscriptionId, retryOptions);
}
