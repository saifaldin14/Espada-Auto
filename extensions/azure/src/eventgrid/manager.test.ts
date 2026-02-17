/**
 * Azure Event Grid Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureEventGridManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockTopics = {
  listBySubscription: vi.fn(),
  listByResourceGroup: vi.fn(),
};

const mockEventSubscriptions = { listGlobalBySubscription: vi.fn() };

const mockDomains = {
  listBySubscription: vi.fn(),
  listByResourceGroup: vi.fn(),
};

const mockSystemTopics = {
  listBySubscription: vi.fn(),
  listByResourceGroup: vi.fn(),
};

vi.mock("@azure/arm-eventgrid", () => ({
  EventGridManagementClient: vi.fn().mockImplementation(() => ({
    topics: mockTopics,
    eventSubscriptions: mockEventSubscriptions,
    domains: mockDomains,
    systemTopics: mockSystemTopics,
  })),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureEventGridManager", () => {
  let mgr: AzureEventGridManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureEventGridManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listTopics", () => {
    it("lists all topics", async () => {
      mockTopics.listBySubscription.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.EventGrid/topics/topic-1", name: "topic-1", location: "eastus", properties: { provisioningState: "Succeeded", endpoint: "https://topic-1.eastus-1.eventgrid.azure.net/api/events" }, tags: {} },
      ]));
      const topics = await mgr.listTopics();
      expect(topics).toHaveLength(1);
      expect(topics[0].name).toBe("topic-1");
    });

    it("filters by resource group", async () => {
      mockTopics.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listTopics("rg-1");
      expect(mockTopics.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("listEventSubscriptions", () => {
    it("lists global subscriptions", async () => {
      mockEventSubscriptions.listGlobalBySubscription.mockReturnValue(asyncIter([
        { id: "es-1", name: "sub-1", properties: { destination: { endpointType: "WebHook" }, provisioningState: "Succeeded", topic: "/subscriptions/sub-1" } },
      ]));
      const subs = await mgr.listEventSubscriptions();
      expect(subs).toHaveLength(1);
    });
  });

  describe("listDomains", () => {
    it("lists all domains", async () => {
      mockDomains.listBySubscription.mockReturnValue(asyncIter([
        { id: "d-id", name: "domain-1", location: "eastus", properties: { provisioningState: "Succeeded", endpoint: "https://domain-1.eventgrid.azure.net" }, tags: {} },
      ]));
      const domains = await mgr.listDomains();
      expect(domains).toHaveLength(1);
      expect(domains[0].name).toBe("domain-1");
    });

    it("filters by resource group", async () => {
      mockDomains.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listDomains("rg-1");
      expect(mockDomains.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("listSystemTopics", () => {
    it("lists system topics", async () => {
      mockSystemTopics.listBySubscription.mockReturnValue(asyncIter([
        { id: "st-id", name: "sys-topic-1", location: "eastus", properties: { provisioningState: "Succeeded", source: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Storage/storageAccounts/sa1", topicType: "Microsoft.Storage.StorageAccounts" }, tags: {} },
      ]));
      const topics = await mgr.listSystemTopics();
      expect(topics).toHaveLength(1);
      expect(topics[0].name).toBe("sys-topic-1");
    });

    it("filters by resource group", async () => {
      mockSystemTopics.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listSystemTopics("rg-1");
      expect(mockSystemTopics.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });
});
