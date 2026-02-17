/**
 * Azure Service Bus Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureServiceBusManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockNamespaces = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
};

const mockQueues = {
  listByNamespace: vi.fn(),
  createOrUpdate: vi.fn(),
  delete: vi.fn(),
};

const mockTopics = { listByNamespace: vi.fn() };
const mockSubscriptions = { listByTopic: vi.fn() };

vi.mock("@azure/arm-servicebus", () => ({
  ServiceBusManagementClient: vi.fn().mockImplementation(() => ({
    namespaces: mockNamespaces,
    queues: mockQueues,
    topics: mockTopics,
    subscriptions: mockSubscriptions,
  })),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureServiceBusManager", () => {
  let mgr: AzureServiceBusManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureServiceBusManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listNamespaces", () => {
    it("lists all namespaces", async () => {
      mockNamespaces.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ServiceBus/namespaces/sb-1", name: "sb-1", location: "eastus", properties: { serviceBusEndpoint: "https://sb-1.servicebus.windows.net:443/", provisioningState: "Succeeded" }, sku: { name: "Standard", tier: "Standard" }, tags: {} },
      ]));
      const ns = await mgr.listNamespaces();
      expect(ns).toHaveLength(1);
      expect(ns[0].name).toBe("sb-1");
    });

    it("filters by resource group", async () => {
      mockNamespaces.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listNamespaces("rg-1");
      expect(mockNamespaces.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("listQueues", () => {
    it("lists queues in a namespace", async () => {
      mockQueues.listByNamespace.mockReturnValue(asyncIter([
        { id: "q-id", name: "orders", properties: { maxSizeInMegabytes: 5120, messageCount: 42, status: "Active", lockDuration: "PT30S", maxDeliveryCount: 10 } },
      ]));
      const queues = await mgr.listQueues("rg-1", "sb-1");
      expect(queues).toHaveLength(1);
      expect(queues[0].name).toBe("orders");
    });

    it("returns empty when no queues", async () => {
      mockQueues.listByNamespace.mockReturnValue(asyncIter([]));
      expect(await mgr.listQueues("rg-1", "sb-1")).toEqual([]);
    });
  });

  describe("listTopics", () => {
    it("lists topics in a namespace", async () => {
      mockTopics.listByNamespace.mockReturnValue(asyncIter([
        { id: "t-id", name: "events", properties: { maxSizeInMegabytes: 1024, subscriptionCount: 3, status: "Active" } },
      ]));
      const topics = await mgr.listTopics("rg-1", "sb-1");
      expect(topics).toHaveLength(1);
      expect(topics[0].name).toBe("events");
    });
  });

  describe("listSubscriptions", () => {
    it("lists topic subscriptions", async () => {
      mockSubscriptions.listByTopic.mockReturnValue(asyncIter([
        { id: "s-id", name: "processor", properties: { messageCount: 10, status: "Active", maxDeliveryCount: 5, lockDuration: "PT30S" } },
      ]));
      const subs = await mgr.listSubscriptions("rg-1", "sb-1", "events");
      expect(subs).toHaveLength(1);
      expect(subs[0].name).toBe("processor");
    });
  });

  describe("createQueue", () => {
    it("creates a queue with options", async () => {
      mockQueues.createOrUpdate.mockResolvedValue({ id: "q-id", name: "new-queue", properties: { maxSizeInMegabytes: 2048, status: "Active", lockDuration: "PT1M", maxDeliveryCount: 15 } });
      const queue = await mgr.createQueue("rg-1", "sb-1", "new-queue", { maxSizeInMegabytes: 2048, lockDuration: "PT1M", maxDeliveryCount: 15 });
      expect(queue.name).toBe("new-queue");
    });
  });

  describe("deleteQueue", () => {
    it("deletes a queue", async () => {
      mockQueues.delete.mockResolvedValue(undefined);
      await expect(mgr.deleteQueue("rg-1", "sb-1", "old-queue")).resolves.toBeUndefined();
    });
  });
});
