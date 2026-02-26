/**
 * Azure Event Hubs Manager — Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureEventHubsManager } from "./manager.js";

function asyncIter<T>(items: T[]) {
  return { [Symbol.asyncIterator]: async function* () { for (const i of items) yield i; } };
}

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: {} }),
  clearCache: vi.fn(),
} as any;

describe("AzureEventHubsManager", () => {
  let manager: AzureEventHubsManager;

  const mockNamespaces = {
    list: vi.fn(),
    listByResourceGroup: vi.fn(),
    get: vi.fn(),
    beginDeleteAndWait: vi.fn(),
    listAuthorizationRules: vi.fn(),
  };

  const mockEventHubs = {
    listByNamespace: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  };

  const mockConsumerGroups = {
    listByEventHub: vi.fn(),
  };

  const mockAuthorizationRules = {
    listByNamespace: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureEventHubsManager(mockCredentialsManager, "sub-123", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      namespaces: mockNamespaces,
      eventHubs: mockEventHubs,
      consumerGroups: mockConsumerGroups,
    });
  });

  describe("listNamespaces", () => {
    it("should list all namespaces", async () => {
      mockNamespaces.list.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.EventHub/namespaces/ns1",
          name: "ns1", location: "eastus",
          sku: { name: "Standard", tier: "Standard", capacity: 1 },
          provisioningState: "Succeeded", status: "Active",
          kafkaEnabled: true, isAutoInflateEnabled: false,
          maximumThroughputUnits: 0,
          tags: { env: "prod" },
        },
      ]));

      const namespaces = await manager.listNamespaces();
      expect(namespaces).toHaveLength(1);
      expect(namespaces[0].name).toBe("ns1");
      expect(namespaces[0].sku).toBe("Standard");
      expect(namespaces[0].kafkaEnabled).toBe(true);
      expect(namespaces[0].resourceGroup).toBe("rg1");
    });

    it("should filter by resource group", async () => {
      mockNamespaces.listByResourceGroup.mockReturnValue(asyncIter([]));
      const result = await manager.listNamespaces("rg1");
      expect(result).toEqual([]);
      expect(mockNamespaces.listByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getNamespace", () => {
    it("should return a namespace", async () => {
      mockNamespaces.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.EventHub/namespaces/ns1",
        name: "ns1", location: "eastus",
        sku: { name: "Premium", tier: "Premium", capacity: 2 },
        provisioningState: "Succeeded", status: "Active",
        kafkaEnabled: true, isAutoInflateEnabled: true,
        maximumThroughputUnits: 10,
      });

      const ns = await manager.getNamespace("rg1", "ns1");
      expect(ns).not.toBeNull();
      expect(ns!.name).toBe("ns1");
      expect(ns!.sku).toBe("Premium");
      expect(ns!.isAutoInflateEnabled).toBe(true);
    });

    it("should return null for 404", async () => {
      mockNamespaces.get.mockRejectedValue({ statusCode: 404 });
      const ns = await manager.getNamespace("rg1", "nonexistent");
      expect(ns).toBeNull();
    });
  });

  describe("deleteNamespace", () => {
    it("should delete a namespace", async () => {
      mockNamespaces.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(manager.deleteNamespace("rg1", "ns1")).resolves.toBeUndefined();
      expect(mockNamespaces.beginDeleteAndWait).toHaveBeenCalledWith("rg1", "ns1");
    });
  });

  describe("listEventHubs", () => {
    it("should list event hubs in a namespace", async () => {
      mockEventHubs.listByNamespace.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.EventHub/namespaces/ns1/eventhubs/eh1",
          name: "eh1",
          partitionCount: 4, messageRetentionInDays: 7,
          status: "Active",
          createdAt: new Date("2024-01-01"),
        },
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.EventHub/namespaces/ns1/eventhubs/eh2",
          name: "eh2",
          partitionCount: 8, messageRetentionInDays: 1,
          status: "Active",
          createdAt: new Date("2024-06-01"),
        },
      ]));

      const hubs = await manager.listEventHubs("rg1", "ns1");
      expect(hubs).toHaveLength(2);
      expect(hubs[0].name).toBe("eh1");
      expect(hubs[0].partitionCount).toBe(4);
      expect(hubs[0].messageRetentionInDays).toBe(7);
      expect(hubs[1].name).toBe("eh2");
    });
  });

  describe("getEventHub", () => {
    it("should return an event hub", async () => {
      mockEventHubs.get.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.EventHub/namespaces/ns1/eventhubs/eh1",
        name: "eh1",
        partitionCount: 4, messageRetentionInDays: 7,
        status: "Active",
        createdAt: new Date("2024-01-01"),
      });

      const hub = await manager.getEventHub("rg1", "ns1", "eh1");
      expect(hub).not.toBeNull();
      expect(hub!.name).toBe("eh1");
    });

    it("should return null for 404", async () => {
      mockEventHubs.get.mockRejectedValue({ statusCode: 404 });
      const hub = await manager.getEventHub("rg1", "ns1", "nonexistent");
      expect(hub).toBeNull();
    });
  });

  describe("deleteEventHub", () => {
    it("should delete an event hub", async () => {
      mockEventHubs.delete.mockResolvedValue(undefined);
      await expect(manager.deleteEventHub("rg1", "ns1", "eh1")).resolves.toBeUndefined();
      expect(mockEventHubs.delete).toHaveBeenCalledWith("rg1", "ns1", "eh1");
    });
  });

  describe("listConsumerGroups", () => {
    it("should list consumer groups", async () => {
      mockConsumerGroups.listByEventHub.mockReturnValue(asyncIter([
        { id: "cg1", name: "$Default" },
        { id: "cg2", name: "my-consumer-group" },
      ]));

      const groups = await manager.listConsumerGroups("rg1", "ns1", "eh1");
      expect(groups).toHaveLength(2);
      expect(groups[0].name).toBe("$Default");
      expect(groups[1].name).toBe("my-consumer-group");
    });
  });

  describe("listAuthorizationRules", () => {
    it("should list namespace authorization rules", async () => {
      mockNamespaces.listAuthorizationRules.mockReturnValue(asyncIter([
        { id: "rule1", name: "RootManageSharedAccessKey", rights: ["Listen", "Manage", "Send"] },
        { id: "rule2", name: "SendOnly", rights: ["Send"] },
      ]));

      const rules = await manager.listAuthorizationRules("rg1", "ns1");
      expect(rules).toHaveLength(2);
      expect(rules[0].name).toBe("RootManageSharedAccessKey");
      expect(rules[0].rights).toEqual(["Listen", "Manage", "Send"]);
      expect(rules[1].name).toBe("SendOnly");
      expect(rules[1].rights).toEqual(["Send"]);
      expect(mockNamespaces.listAuthorizationRules).toHaveBeenCalledWith("rg1", "ns1");
    });
  });

  describe("error propagation", () => {
    it("should rethrow non-404 errors from getNamespace", async () => {
      mockNamespaces.get.mockRejectedValue({ statusCode: 500, message: "Internal Server Error" });
      await expect(manager.getNamespace("rg1", "ns1")).rejects.toEqual({ statusCode: 500, message: "Internal Server Error" });
    });
  });
});
