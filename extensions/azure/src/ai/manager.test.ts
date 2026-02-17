/**
 * Azure AI Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureAIManager, createAIManager } from "./manager.js";
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

const mockAccounts = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
  get: vi.fn(),
  listKeys: vi.fn(),
};

const mockDeployments = {
  list: vi.fn(),
};

const mockModels = {
  list: vi.fn(),
};

vi.mock("@azure/arm-cognitiveservices", () => ({
  CognitiveServicesManagementClient: vi.fn().mockImplementation(() => ({
    accounts: mockAccounts,
    deployments: mockDeployments,
    models: mockModels,
  })),
}));

const mockCredential = { getToken: vi.fn().mockResolvedValue({ token: "t", expiresOnTimestamp: Date.now() + 3600000 }) };
const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: mockCredential, method: "default" }),
  getSubscriptionId: () => "sub-1",
  getTenantId: () => undefined,
  clearCache: vi.fn(),
} as unknown as AzureCredentialsManager;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AzureAIManager", () => {
  let mgr: AzureAIManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureAIManager(mockCredentialsManager, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  // -------------------------------------------------------------------------
  // listAccounts
  // -------------------------------------------------------------------------
  describe("listAccounts", () => {
    it("lists all accounts across subscription", async () => {
      mockAccounts.list.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.CognitiveServices/accounts/ai1",
          name: "ai1",
          location: "eastus",
          kind: "OpenAI",
          sku: { name: "S0" },
          properties: { endpoint: "https://ai1.cognitiveservices.azure.com", provisioningState: "Succeeded", capabilities: [{ name: "chat" }], customSubDomainName: "ai1" },
        },
      ]));

      const result = await mgr.listAccounts();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("ai1");
      expect(result[0].kind).toBe("OpenAI");
      expect(result[0].endpoint).toBe("https://ai1.cognitiveservices.azure.com");
      expect(result[0].capabilities).toEqual(["chat"]);
      expect(mockAccounts.list).toHaveBeenCalled();
    });

    it("lists accounts by resource group", async () => {
      mockAccounts.listByResourceGroup.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-2/providers/Microsoft.CognitiveServices/accounts/ai2", name: "ai2", location: "westus2", kind: "CognitiveServices", sku: { name: "F0" }, properties: {} },
      ]));

      const result = await mgr.listAccounts("rg-2");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("ai2");
      expect(mockAccounts.listByResourceGroup).toHaveBeenCalledWith("rg-2");
    });

    it("returns empty array when no accounts", async () => {
      mockAccounts.list.mockReturnValue(asyncIter([]));
      const result = await mgr.listAccounts();
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getAccount
  // -------------------------------------------------------------------------
  describe("getAccount", () => {
    it("retrieves a specific account", async () => {
      mockAccounts.get.mockResolvedValue({
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.CognitiveServices/accounts/ai1",
        name: "ai1",
        location: "eastus",
        kind: "OpenAI",
        sku: { name: "S0" },
        properties: { endpoint: "https://ai1.cognitiveservices.azure.com", provisioningState: "Succeeded", capabilities: [], customSubDomainName: "ai1" },
      });

      const result = await mgr.getAccount("rg-1", "ai1");
      expect(result.name).toBe("ai1");
      expect(result.resourceGroup).toBe("rg-1");
      expect(mockAccounts.get).toHaveBeenCalledWith("rg-1", "ai1");
    });

    it("handles nullish properties gracefully", async () => {
      mockAccounts.get.mockResolvedValue({ id: null, name: null, location: null, kind: null, sku: null, properties: null });
      const result = await mgr.getAccount("rg-1", "noai");
      expect(result.name).toBe("");
      expect(result.location).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // listDeployments
  // -------------------------------------------------------------------------
  describe("listDeployments", () => {
    it("lists deployments for an account", async () => {
      mockDeployments.list.mockReturnValue(asyncIter([
        {
          id: "/deployments/d1",
          name: "gpt-4",
          properties: { model: { name: "gpt-4", version: "0613", format: "OpenAI" }, provisioningState: "Succeeded", rateLimits: [{ key: "tokens", renewalPeriod: 60, count: 10000 }] },
          sku: { name: "Standard", capacity: 10 },
        },
      ]));

      const result = await mgr.listDeployments("rg-1", "ai1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("gpt-4");
      expect(result[0].model.name).toBe("gpt-4");
      expect(result[0].sku?.capacity).toBe(10);
      expect(result[0].rateLimits).toHaveLength(1);
      expect(mockDeployments.list).toHaveBeenCalledWith("rg-1", "ai1");
    });

    it("handles deployment without sku", async () => {
      mockDeployments.list.mockReturnValue(asyncIter([
        { id: "/deployments/d2", name: "gpt-3.5", properties: { model: { name: "gpt-3.5-turbo", version: "0301" } } },
      ]));

      const result = await mgr.listDeployments("rg-1", "ai1");
      expect(result[0].sku).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // listModels
  // -------------------------------------------------------------------------
  describe("listModels", () => {
    it("lists available models for a location", async () => {
      mockModels.list.mockReturnValue(asyncIter([
        { model: { name: "gpt-4", format: "OpenAI", version: "0613", capabilities: { chat: "true" }, lifecycleStatus: "GA", maxCapacity: 100 } },
        { model: { name: "dall-e-3", format: "OpenAI", version: "3.0", capabilities: { image: "true" }, lifecycleStatus: "GA", maxCapacity: 50 } },
      ]));

      const result = await mgr.listModels("eastus");
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("gpt-4");
      expect(result[1].name).toBe("dall-e-3");
      expect(mockModels.list).toHaveBeenCalledWith("eastus");
    });

    it("skips entries without model property", async () => {
      mockModels.list.mockReturnValue(asyncIter([
        { model: { name: "gpt-4", format: "OpenAI", version: "1" } },
        { model: null },
        {},
      ]));

      const result = await mgr.listModels("westus2");
      expect(result).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // getKeys
  // -------------------------------------------------------------------------
  describe("getKeys", () => {
    it("retrieves account keys", async () => {
      mockAccounts.listKeys.mockResolvedValue({ key1: "abc123", key2: "def456" });

      const result = await mgr.getKeys("rg-1", "ai1");
      expect(result.key1).toBe("abc123");
      expect(result.key2).toBe("def456");
      expect(mockAccounts.listKeys).toHaveBeenCalledWith("rg-1", "ai1");
    });

    it("defaults to empty strings for null keys", async () => {
      mockAccounts.listKeys.mockResolvedValue({ key1: null, key2: null });
      const result = await mgr.getKeys("rg-1", "ai1");
      expect(result.key1).toBe("");
      expect(result.key2).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------
  describe("createAIManager", () => {
    it("creates an AzureAIManager instance", () => {
      const instance = createAIManager(mockCredentialsManager, "sub-1");
      expect(instance).toBeInstanceOf(AzureAIManager);
    });
  });
});
