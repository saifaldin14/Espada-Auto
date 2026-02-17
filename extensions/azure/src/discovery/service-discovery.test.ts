/**
 * Azure Service Discovery — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureServiceDiscovery, createServiceDiscovery } from "./service-discovery.js";
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

const mockResources = {
  list: vi.fn(),
};

const mockResourceGroups = {
  list: vi.fn(),
};

vi.mock("@azure/arm-resources", () => ({
  ResourceManagementClient: vi.fn().mockImplementation(() => ({
    resources: mockResources,
    resourceGroups: mockResourceGroups,
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

describe("AzureServiceDiscovery", () => {
  let disc: AzureServiceDiscovery;

  beforeEach(() => {
    vi.clearAllMocks();
    disc = new AzureServiceDiscovery(mockCredentialsManager, "sub-1");
  });

  // -------------------------------------------------------------------------
  // listResources
  // -------------------------------------------------------------------------
  describe("listResources", () => {
    it("lists all resources", async () => {
      mockResources.list.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm1",
          name: "vm1",
          type: "Microsoft.Compute/virtualMachines",
          location: "eastus",
          tags: { env: "prod" },
        },
      ]));

      const result = await disc.listResources();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("vm1");
      expect(result[0].resourceGroup).toBe("rg-1");
      expect(result[0].subscriptionId).toBe("sub-1");
    });

    it("filters by resource type via SDK filter", async () => {
      mockResources.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Storage/storageAccounts/sa1", name: "sa1", type: "Microsoft.Storage/storageAccounts", location: "eastus" },
      ]));

      const result = await disc.listResources({ filter: { type: "Microsoft.Storage/storageAccounts" } });
      expect(result).toHaveLength(1);
      expect(mockResources.list).toHaveBeenCalledWith(
        expect.objectContaining({ filter: "resourceType eq 'Microsoft.Storage/storageAccounts'" }),
      );
    });

    it("filters by resource group client-side", async () => {
      mockResources.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm1", name: "vm1", type: "VM", location: "eastus" },
        { id: "/subscriptions/sub-1/resourceGroups/rg-2/providers/Microsoft.Compute/virtualMachines/vm2", name: "vm2", type: "VM", location: "eastus" },
      ]));

      const result = await disc.listResources({ filter: { resourceGroup: "rg-1" } });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("vm1");
    });

    it("filters by location", async () => {
      mockResources.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/X/Y/a", name: "a", type: "X/Y", location: "eastus" },
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/X/Y/b", name: "b", type: "X/Y", location: "westus2" },
      ]));

      const result = await disc.listResources({ filter: { location: "westus2" } });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("b");
    });

    it("respects maxResults", async () => {
      mockResources.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg/providers/X/Y/a", name: "a", type: "X", location: "eastus" },
        { id: "/subscriptions/sub-1/resourceGroups/rg/providers/X/Y/b", name: "b", type: "X", location: "eastus" },
        { id: "/subscriptions/sub-1/resourceGroups/rg/providers/X/Y/c", name: "c", type: "X", location: "eastus" },
      ]));

      const result = await disc.listResources({ maxResults: 2 });
      expect(result).toHaveLength(2);
    });

    it("uses custom subscriptionId when provided", async () => {
      mockResources.list.mockReturnValue(asyncIter([]));

      const result = await disc.listResources({ subscriptionId: "sub-override" });
      expect(result).toEqual([]);
    });

    it("returns empty array when no resources", async () => {
      mockResources.list.mockReturnValue(asyncIter([]));
      const result = await disc.listResources();
      expect(result).toEqual([]);
    });

    it("handles nullish resource properties", async () => {
      mockResources.list.mockReturnValue(asyncIter([
        { id: null, name: null, type: null, location: null, tags: null },
      ]));

      const result = await disc.listResources();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("");
      expect(result[0].resourceGroup).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // listResourceGroups
  // -------------------------------------------------------------------------
  describe("listResourceGroups", () => {
    it("lists resource groups", async () => {
      mockResourceGroups.list.mockReturnValue(asyncIter([
        { name: "rg-1" },
        { name: "rg-2" },
      ]));

      const result = await disc.listResourceGroups();
      expect(result).toEqual(["rg-1", "rg-2"]);
    });

    it("skips groups without name", async () => {
      mockResourceGroups.list.mockReturnValue(asyncIter([
        { name: "rg-1" },
        { name: null },
        {},
      ]));

      const result = await disc.listResourceGroups();
      expect(result).toEqual(["rg-1"]);
    });

    it("accepts custom subscriptionId", async () => {
      mockResourceGroups.list.mockReturnValue(asyncIter([]));
      const result = await disc.listResourceGroups("sub-other");
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getServiceCatalog
  // -------------------------------------------------------------------------
  describe("getServiceCatalog", () => {
    it("returns non-empty service catalog", () => {
      const catalog = disc.getServiceCatalog();
      expect(catalog.length).toBeGreaterThan(0);
    });

    it("each entry has required fields", () => {
      const catalog = disc.getServiceCatalog();
      for (const entry of catalog) {
        expect(entry.type).toBeTruthy();
        expect(entry.displayName).toBeTruthy();
        expect(entry.category).toBeTruthy();
        expect(entry.regions.length).toBeGreaterThan(0);
      }
    });

    it("includes known resource types", () => {
      const catalog = disc.getServiceCatalog();
      const types = catalog.map((c) => c.type);
      expect(types).toContain("Microsoft.Compute/virtualMachines");
      expect(types).toContain("Microsoft.Storage/storageAccounts");
    });
  });

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------
  describe("createServiceDiscovery", () => {
    it("creates an AzureServiceDiscovery instance", () => {
      const instance = createServiceDiscovery(mockCredentialsManager, "sub-1");
      expect(instance).toBeInstanceOf(AzureServiceDiscovery);
    });
  });
});
