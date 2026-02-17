/**
 * Azure Storage Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureStorageManager } from "./manager.js";
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

function makeSdkStorageAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Storage/storageAccounts/sa1",
    name: "sa1",
    location: "eastus",
    kind: "StorageV2",
    sku: { name: "Standard_LRS" },
    provisioningState: "Succeeded",
    primaryEndpoints: { blob: "https://sa1.blob.core.windows.net/" },
    enableHttpsTrafficOnly: true,
    tags: { env: "test" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock SDK
// ---------------------------------------------------------------------------

const mockStorageAccounts = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
  getProperties: vi.fn(),
  delete: vi.fn(),
};

const mockBlobContainers = {
  list: vi.fn(),
};

vi.mock("@azure/arm-storage", () => ({
  StorageManagementClient: vi.fn().mockImplementation(() => ({
    storageAccounts: mockStorageAccounts,
    blobContainers: mockBlobContainers,
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

describe("AzureStorageManager", () => {
  let mgr: AzureStorageManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureStorageManager(mockCredentialsManager, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listStorageAccounts", () => {
    it("lists all accounts when no resource group", async () => {
      mockStorageAccounts.list.mockReturnValue(asyncIter([makeSdkStorageAccount()]));
      const accounts = await mgr.listStorageAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe("sa1");
      expect(accounts[0].kind).toBe("StorageV2");
      expect(accounts[0].sku).toBe("Standard_LRS");
      expect(accounts[0].httpsOnly).toBe(true);
    });

    it("lists accounts in a resource group", async () => {
      mockStorageAccounts.listByResourceGroup.mockReturnValue(asyncIter([makeSdkStorageAccount()]));
      const accounts = await mgr.listStorageAccounts("rg-1");
      expect(accounts).toHaveLength(1);
      expect(mockStorageAccounts.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });

    it("returns empty array with no accounts", async () => {
      mockStorageAccounts.list.mockReturnValue(asyncIter([]));
      const accounts = await mgr.listStorageAccounts();
      expect(accounts).toEqual([]);
    });

    it("extracts resource group from ID", async () => {
      mockStorageAccounts.list.mockReturnValue(asyncIter([makeSdkStorageAccount()]));
      const accounts = await mgr.listStorageAccounts();
      expect(accounts[0].resourceGroup).toBe("rg-1");
    });

    it("maps tags", async () => {
      mockStorageAccounts.list.mockReturnValue(asyncIter([makeSdkStorageAccount()]));
      const accounts = await mgr.listStorageAccounts();
      expect(accounts[0].tags).toEqual({ env: "test" });
    });
  });

  describe("getStorageAccount", () => {
    it("returns account when found", async () => {
      mockStorageAccounts.getProperties.mockResolvedValue(makeSdkStorageAccount());
      const account = await mgr.getStorageAccount("rg-1", "sa1");
      expect(account).not.toBeNull();
      expect(account!.name).toBe("sa1");
    });

    it("returns null on 404", async () => {
      mockStorageAccounts.getProperties.mockRejectedValue({ statusCode: 404 });
      const account = await mgr.getStorageAccount("rg-1", "nonexistent");
      expect(account).toBeNull();
    });

    it("throws on non-404 errors", async () => {
      mockStorageAccounts.getProperties.mockRejectedValue({ statusCode: 500, message: "Error" });
      await expect(mgr.getStorageAccount("rg-1", "sa1")).rejects.toEqual({ statusCode: 500, message: "Error" });
    });
  });

  describe("listContainers", () => {
    it("lists blob containers", async () => {
      mockBlobContainers.list.mockReturnValue(asyncIter([
        { name: "container1", publicAccess: "Blob", lastModifiedTime: new Date("2024-01-01"), leaseState: "Available", hasImmutabilityPolicy: false, hasLegalHold: false },
        { name: "container2", publicAccess: "None", lastModifiedTime: new Date("2024-06-15"), leaseState: "Available", hasImmutabilityPolicy: true, hasLegalHold: false },
      ]));
      const containers = await mgr.listContainers("rg-1", "sa1");
      expect(containers).toHaveLength(2);
      expect(containers[0].name).toBe("container1");
      expect(containers[0].publicAccess).toBe("Blob");
      expect(containers[1].hasImmutabilityPolicy).toBe(true);
    });

    it("returns empty array when no containers", async () => {
      mockBlobContainers.list.mockReturnValue(asyncIter([]));
      const containers = await mgr.listContainers("rg-1", "sa1");
      expect(containers).toEqual([]);
    });
  });

  describe("deleteStorageAccount", () => {
    it("calls delete on the SDK client", async () => {
      mockStorageAccounts.delete.mockResolvedValue(undefined);
      await mgr.deleteStorageAccount("rg-1", "sa1");
      expect(mockStorageAccounts.delete).toHaveBeenCalledWith("rg-1", "sa1");
    });
  });
});
