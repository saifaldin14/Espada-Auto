/**
 * Azure Subscription Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureSubscriptionManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockSubscriptions = {
  list: vi.fn(),
  get: vi.fn(),
  listLocations: vi.fn(),
};
const mockTenants = { list: vi.fn() };

vi.mock("@azure/arm-subscriptions", () => ({
  SubscriptionClient: vi.fn().mockImplementation(function() { return {
    subscriptions: mockSubscriptions,
    tenants: mockTenants,
  }; }),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureSubscriptionManager", () => {
  let mgr: AzureSubscriptionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureSubscriptionManager(mockCreds, { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listSubscriptions", () => {
    it("lists all subscriptions", async () => {
      mockSubscriptions.list.mockReturnValue(asyncIter([
        { subscriptionId: "sub-1", displayName: "Dev Sub", state: "Enabled", tenantId: "t-1" },
        { subscriptionId: "sub-2", displayName: "Prod Sub", state: "Enabled", tenantId: "t-1" },
      ]));
      const subs = await mgr.listSubscriptions();
      expect(subs).toHaveLength(2);
    });
  });

  describe("getSubscription", () => {
    it("returns subscription details", async () => {
      mockSubscriptions.get.mockResolvedValue({ subscriptionId: "sub-1", displayName: "Dev Sub", state: "Enabled", tenantId: "t-1" });
      const sub = await mgr.getSubscription("sub-1");
      expect(sub.displayName).toBe("Dev Sub");
    });
  });

  describe("listTenants", () => {
    it("lists tenants", async () => {
      mockTenants.list.mockReturnValue(asyncIter([
        { tenantId: "t-1", displayName: "My Tenant", tenantCategory: "Home" },
      ]));
      const tenants = await mgr.listTenants();
      expect(tenants).toHaveLength(1);
    });
  });

  describe("listLocations", () => {
    it("lists locations for a subscription", async () => {
      mockSubscriptions.listLocations.mockReturnValue(asyncIter([
        { id: "loc-1", name: "eastus", displayName: "East US", metadata: { regionType: "Physical" }, regionalDisplayName: "(US) East US" },
      ]));
      const locs = await mgr.listLocations("sub-1");
      expect(locs).toHaveLength(1);
    });
  });
});
