/**
 * Azure API Management Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureAPIManagementManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockService = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
};
const mockApi = { listByService: vi.fn() };
const mockProduct = { listByService: vi.fn() };
const mockSubscription = { list: vi.fn() };

vi.mock("@azure/arm-apimanagement", () => ({
  ApiManagementClient: vi.fn().mockImplementation(() => ({
    apiManagementService: mockService,
    api: mockApi,
    product: mockProduct,
    subscription: mockSubscription,
  })),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureAPIManagementManager", () => {
  let mgr: AzureAPIManagementManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureAPIManagementManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listServices", () => {
    it("lists all APIM services", async () => {
      mockService.list.mockReturnValue(asyncIter([
        { id: "id", name: "apim-1", location: "eastus", sku: { name: "Developer", capacity: 1 }, properties: { gatewayUrl: "https://apim-1.azure-api.net", provisioningState: "Succeeded" }, tags: {} },
      ]));
      const services = await mgr.listServices();
      expect(services).toHaveLength(1);
      expect(services[0].name).toBe("apim-1");
    });

    it("filters by resource group", async () => {
      mockService.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listServices("rg-1");
      expect(mockService.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("listAPIs", () => {
    it("lists APIs in a service", async () => {
      mockApi.listByService.mockReturnValue(asyncIter([
        { id: "api-id", name: "my-api", properties: { displayName: "My API", path: "/api", protocols: ["https"], serviceUrl: "https://backend.example.com", apiVersion: "v1" } },
      ]));
      const apis = await mgr.listAPIs("rg-1", "apim-1");
      expect(apis).toHaveLength(1);
    });
  });

  describe("listProducts", () => {
    it("lists products", async () => {
      mockProduct.listByService.mockReturnValue(asyncIter([
        { id: "prod-id", name: "starter", properties: { displayName: "Starter", state: "published", subscriptionRequired: true } },
      ]));
      const products = await mgr.listProducts("rg-1", "apim-1");
      expect(products).toHaveLength(1);
    });
  });

  describe("listSubscriptions", () => {
    it("lists subscriptions", async () => {
      mockSubscription.list.mockReturnValue(asyncIter([
        { id: "sub-id", name: "sub-1", properties: { displayName: "Test Sub", state: "active", scope: "/apis/my-api", primaryKey: "pk", secondaryKey: "sk" } },
      ]));
      const subs = await mgr.listSubscriptions("rg-1", "apim-1");
      expect(subs).toHaveLength(1);
    });
  });
});
