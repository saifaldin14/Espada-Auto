/**
 * Azure Credentials Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AzureCredentialsManager,
  createCredentialsManager,
} from "./manager.js";

// Mock @azure/identity
vi.mock("@azure/identity", () => {
  const mockGetToken = vi.fn().mockResolvedValue({
    token: "mock-token",
    expiresOnTimestamp: Date.now() + 3600000,
  });

  return {
    DefaultAzureCredential: vi.fn().mockImplementation(function() { return { getToken: mockGetToken }; }),
    AzureCliCredential: vi.fn().mockImplementation(function() { return { getToken: mockGetToken }; }),
    ClientSecretCredential: vi.fn().mockImplementation(function() { return { getToken: mockGetToken }; }),
    ManagedIdentityCredential: vi.fn().mockImplementation(function() { return { getToken: mockGetToken }; }),
    InteractiveBrowserCredential: vi.fn().mockImplementation(function() { return { getToken: mockGetToken }; }),
  };
});

describe("AzureCredentialsManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates with default options", () => {
    const mgr = createCredentialsManager();
    expect(mgr).toBeInstanceOf(AzureCredentialsManager);
  });

  it("getCredential returns a credential using default method", async () => {
    const mgr = createCredentialsManager({ credentialMethod: "default" });
    const result = await mgr.getCredential();
    expect(result.credential).toBeDefined();
    expect(result.method).toBe("default");
  });

  it("getCredential uses CLI method", async () => {
    const mgr = createCredentialsManager({ credentialMethod: "cli" });
    const result = await mgr.getCredential();
    expect(result.method).toBe("cli");
  });

  it("getCredential caches credentials", async () => {
    const mgr = createCredentialsManager({ credentialMethod: "default" });
    const r1 = await mgr.getCredential();
    const r2 = await mgr.getCredential();
    // Both return the same cached credential
    expect(r1.credential).toBe(r2.credential);
  });

  it("clearCache removes cached credentials", async () => {
    const mgr = createCredentialsManager({ credentialMethod: "default" });
    await mgr.getCredential();
    mgr.clearCache();
    // After clearing, a new credential will be created
    const result = await mgr.getCredential();
    expect(result.credential).toBeDefined();
  });

  it("getSubscriptionId returns configured subscription", () => {
    const mgr = createCredentialsManager({
      defaultSubscription: "sub-123",
    });
    expect(mgr.getSubscriptionId()).toBe("sub-123");
  });

  it("getTenantId returns configured tenant", () => {
    const mgr = createCredentialsManager({
      defaultTenantId: "tenant-456",
    });
    expect(mgr.getTenantId()).toBe("tenant-456");
  });

  it("service-principal method requires env vars", async () => {
    const originalEnv = { ...process.env };
    delete process.env.AZURE_TENANT_ID;
    delete process.env.AZURE_CLIENT_ID;
    delete process.env.AZURE_CLIENT_SECRET;

    const mgr = createCredentialsManager({ credentialMethod: "service-principal" });
    await expect(mgr.getCredential()).rejects.toThrow("Service principal auth requires");

    process.env = originalEnv;
  });
});
