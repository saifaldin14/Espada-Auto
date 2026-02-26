import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureNotificationHubsManager } from "./manager.js";

function asyncIter<T>(items: T[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const i of items) yield i;
    },
  };
}

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: {} }),
  clearCache: vi.fn(),
} as any;

describe("AzureNotificationHubsManager", () => {
  let manager: AzureNotificationHubsManager;

  const mockNamespaces = {
    list: vi.fn(),
    listAll: vi.fn(),
    get: vi.fn(),
    beginDeleteAndWait: vi.fn(),
    listAuthorizationRules: vi.fn(),
  };

  const mockNotificationHubs = {
    list: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureNotificationHubsManager(mockCredentialsManager, "sub-123", {
      maxAttempts: 1,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      namespaces: mockNamespaces,
      notificationHubs: mockNotificationHubs,
    });
  });

  // ---------------------------------------------------------------------------
  // Namespaces
  // ---------------------------------------------------------------------------

  describe("listNamespaces", () => {
    it("lists all namespaces across the subscription", async () => {
      mockNamespaces.listAll.mockReturnValue(
        asyncIter([
          { id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.NotificationHubs/namespaces/ns1", name: "ns1", location: "eastus", sku: { name: "Standard" } },
          { id: "/subscriptions/sub/resourceGroups/rg2/providers/Microsoft.NotificationHubs/namespaces/ns2", name: "ns2", location: "westus" },
        ]),
      );

      const result = await manager.listNamespaces();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("ns1");
      expect(result[0].skuName).toBe("Standard");
      expect(result[1].name).toBe("ns2");
    });

    it("filters by resource group", async () => {
      mockNamespaces.list.mockReturnValue(
        asyncIter([
          { id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.NotificationHubs/namespaces/ns1", name: "ns1", location: "eastus" },
        ]),
      );

      const result = await manager.listNamespaces("rg1");
      expect(result).toHaveLength(1);
      expect(mockNamespaces.list).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getNamespace", () => {
    it("returns a namespace by name", async () => {
      mockNamespaces.get.mockResolvedValue({
        id: "/subscriptions/sub/resourceGroups/rg1/providers/Microsoft.NotificationHubs/namespaces/ns1",
        name: "ns1",
        location: "eastus",
        provisioningState: "Succeeded",
        sku: { name: "Standard", tier: "Standard" },
      });

      const result = await manager.getNamespace("rg1", "ns1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("ns1");
      expect(result!.skuName).toBe("Standard");
    });

    it("returns null for 404", async () => {
      mockNamespaces.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getNamespace("rg1", "missing");
      expect(result).toBeNull();
    });

    it("propagates non-404 errors", async () => {
      mockNamespaces.get.mockRejectedValue(new Error("Server error"));
      await expect(manager.getNamespace("rg1", "ns1")).rejects.toThrow("Server error");
    });
  });

  describe("deleteNamespace", () => {
    it("deletes a namespace", async () => {
      mockNamespaces.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(manager.deleteNamespace("rg1", "ns1")).resolves.toBeUndefined();
      expect(mockNamespaces.beginDeleteAndWait).toHaveBeenCalledWith("rg1", "ns1");
    });
  });

  // ---------------------------------------------------------------------------
  // Notification Hubs
  // ---------------------------------------------------------------------------

  describe("listNotificationHubs", () => {
    it("lists notification hubs in a namespace", async () => {
      mockNotificationHubs.list.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/ns/notificationHubs/hub1", name: "hub1", location: "eastus" },
          { id: "/sub/rg/ns/notificationHubs/hub2", name: "hub2", location: "eastus" },
        ]),
      );

      const result = await manager.listNotificationHubs("rg1", "ns1");
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("hub1");
      expect(mockNotificationHubs.list).toHaveBeenCalledWith("rg1", "ns1");
    });
  });

  describe("getNotificationHub", () => {
    it("returns a notification hub", async () => {
      mockNotificationHubs.get.mockResolvedValue({
        id: "/sub/rg/ns/notificationHubs/hub1",
        name: "hub1",
        location: "eastus",
        registrationTtl: "P90D",
      });

      const result = await manager.getNotificationHub("rg1", "ns1", "hub1");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("hub1");
      expect(result!.registrationTtl).toBe("P90D");
    });

    it("returns null for 404", async () => {
      mockNotificationHubs.get.mockRejectedValue({ statusCode: 404 });
      const result = await manager.getNotificationHub("rg1", "ns1", "missing");
      expect(result).toBeNull();
    });
  });

  describe("deleteNotificationHub", () => {
    it("deletes a notification hub", async () => {
      mockNotificationHubs.delete.mockResolvedValue(undefined);
      await expect(manager.deleteNotificationHub("rg1", "ns1", "hub1")).resolves.toBeUndefined();
      expect(mockNotificationHubs.delete).toHaveBeenCalledWith("rg1", "ns1", "hub1");
    });
  });

  // ---------------------------------------------------------------------------
  // Authorization Rules
  // ---------------------------------------------------------------------------

  describe("listNamespaceAuthorizationRules", () => {
    it("lists authorization rules for a namespace", async () => {
      mockNamespaces.listAuthorizationRules.mockReturnValue(
        asyncIter([
          { id: "/sub/rg/ns/rules/rule1", name: "rule1", rights: ["Listen", "Send"] },
        ]),
      );

      const result = await manager.listNamespaceAuthorizationRules("rg1", "ns1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("rule1");
      expect(result[0].rights).toEqual(["Listen", "Send"]);
    });
  });
});
