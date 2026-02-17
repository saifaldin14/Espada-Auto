/**
 * Azure Key Vault Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureKeyVaultManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock SDK
// ---------------------------------------------------------------------------

const mockVaults = {
  listBySubscription: vi.fn(),
  listByResourceGroup: vi.fn(),
  get: vi.fn(),
};

const mockKeys = { list: vi.fn() };

const mockSecretClient = {
  listPropertiesOfSecrets: vi.fn(),
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  beginDeleteSecret: vi.fn(),
};

vi.mock("@azure/arm-keyvault", () => ({
  KeyVaultManagementClient: vi.fn().mockImplementation(() => ({
    vaults: mockVaults,
    keys: mockKeys,
  })),
}));

vi.mock("@azure/keyvault-secrets", () => ({
  SecretClient: vi.fn().mockImplementation(() => mockSecretClient),
}));

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
  getSubscriptionId: () => "sub-1",
  getTenantId: () => undefined,
  clearCache: vi.fn(),
} as unknown as AzureCredentialsManager;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AzureKeyVaultManager", () => {
  let mgr: AzureKeyVaultManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureKeyVaultManager(mockCredentialsManager, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listVaults", () => {
    it("lists all vaults across subscription", async () => {
      mockVaults.listBySubscription.mockReturnValue(asyncIter([{
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.KeyVault/vaults/kv-1",
        name: "kv-1", location: "eastus",
        properties: { vaultUri: "https://kv-1.vault.azure.net/", tenantId: "t-1", sku: { name: "standard" }, enableSoftDelete: true, enablePurgeProtection: true, softDeleteRetentionInDays: 90 },
        tags: { team: "platform" },
      }]));
      const vaults = await mgr.listVaults();
      expect(vaults).toHaveLength(1);
      expect(vaults[0].name).toBe("kv-1");
      expect(vaults[0].vaultUri).toBe("https://kv-1.vault.azure.net/");
      expect(vaults[0].enableSoftDelete).toBe(true);
      expect(vaults[0].resourceGroup).toBe("rg-1");
    });

    it("filters by resource group", async () => {
      mockVaults.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listVaults("rg-1");
      expect(mockVaults.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("getVault", () => {
    it("returns vault info", async () => {
      mockVaults.get.mockResolvedValue({
        id: "id", name: "kv-1", location: "eastus",
        properties: { vaultUri: "https://kv-1.vault.azure.net/", sku: { name: "standard" } },
      });
      const vault = await mgr.getVault("rg-1", "kv-1");
      expect(vault).not.toBeNull();
      expect(vault!.name).toBe("kv-1");
    });

    it("returns null on 404", async () => {
      mockVaults.get.mockRejectedValue({ statusCode: 404 });
      expect(await mgr.getVault("rg-1", "gone")).toBeNull();
    });
  });

  describe("listSecrets", () => {
    it("lists secret properties", async () => {
      mockSecretClient.listPropertiesOfSecrets.mockReturnValue(asyncIter([
        { id: "https://kv-1.vault.azure.net/secrets/s1", name: "s1", enabled: true, contentType: "text/plain", createdOn: new Date("2024-01-01"), tags: {} },
        { id: "https://kv-1.vault.azure.net/secrets/s2", name: "s2", enabled: false, contentType: "application/json" },
      ]));
      const secrets = await mgr.listSecrets("https://kv-1.vault.azure.net/");
      expect(secrets).toHaveLength(2);
      expect(secrets[0].name).toBe("s1");
      expect(secrets[0].enabled).toBe(true);
      expect(secrets[1].enabled).toBe(false);
    });
  });

  describe("getSecret", () => {
    it("returns secret with value", async () => {
      mockSecretClient.getSecret.mockResolvedValue({
        name: "my-secret", value: "super-secret-value",
        properties: { id: "id-1", contentType: "text/plain", enabled: true, createdOn: new Date("2024-01-01"), tags: {} },
      });
      const secret = await mgr.getSecret("https://kv-1.vault.azure.net/", "my-secret");
      expect(secret).not.toBeNull();
      expect(secret!.name).toBe("my-secret");
      expect(secret!.value).toBe("super-secret-value");
    });

    it("returns null when secret not found", async () => {
      mockSecretClient.getSecret.mockRejectedValue({ code: "SecretNotFound" });
      expect(await mgr.getSecret("https://kv-1.vault.azure.net/", "nope")).toBeNull();
    });
  });

  describe("setSecret", () => {
    it("creates/updates a secret", async () => {
      mockSecretClient.setSecret.mockResolvedValue({
        name: "new-secret", value: "val",
        properties: { id: "id-1", contentType: "text/plain", enabled: true, createdOn: new Date(), tags: {} },
      });
      const secret = await mgr.setSecret("https://kv-1.vault.azure.net/", "new-secret", "val", "text/plain");
      expect(secret.name).toBe("new-secret");
      expect(secret.value).toBe("val");
      expect(mockSecretClient.setSecret).toHaveBeenCalledWith("new-secret", "val", { contentType: "text/plain" });
    });
  });

  describe("deleteSecret", () => {
    it("starts delete and polls to completion", async () => {
      const mockPoller = { pollUntilDone: vi.fn().mockResolvedValue(undefined) };
      mockSecretClient.beginDeleteSecret.mockResolvedValue(mockPoller);
      await mgr.deleteSecret("https://kv-1.vault.azure.net/", "old-secret");
      expect(mockSecretClient.beginDeleteSecret).toHaveBeenCalledWith("old-secret");
      expect(mockPoller.pollUntilDone).toHaveBeenCalled();
    });
  });

  describe("listKeys", () => {
    it("lists keys in a vault", async () => {
      mockKeys.list.mockReturnValue(asyncIter([
        { id: "k1", name: "key-1", properties: { kty: "RSA", keyOps: ["encrypt", "decrypt"] }, tags: {} },
      ]));
      const keys = await mgr.listKeys("rg-1", "kv-1");
      expect(keys).toHaveLength(1);
      expect(keys[0].name).toBe("key-1");
    });
  });
});
