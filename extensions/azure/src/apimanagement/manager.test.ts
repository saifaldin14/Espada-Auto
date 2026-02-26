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
  get: vi.fn(),
  beginCreateOrUpdateAndWait: vi.fn(),
  beginDeleteAndWait: vi.fn(),
};
const mockApi = {
  listByService: vi.fn(),
  beginCreateOrUpdateAndWait: vi.fn(),
  delete: vi.fn(),
};
const mockProduct = {
  listByService: vi.fn(),
  createOrUpdate: vi.fn(),
};
const mockSubscription = { list: vi.fn() };
const mockApiPolicy = {
  get: vi.fn(),
  createOrUpdate: vi.fn(),
};

vi.mock("@azure/arm-apimanagement", () => ({
  ApiManagementClient: vi.fn().mockImplementation(function() { return {
    apiManagementService: mockService,
    api: mockApi,
    product: mockProduct,
    subscription: mockSubscription,
    apiPolicy: mockApiPolicy,
  }; }),
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

  describe("getService", () => {
    it("returns a service", async () => {
      mockService.get.mockResolvedValue({
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1",
        name: "apim-1", location: "eastus",
        sku: { name: "Developer", capacity: 1 }, provisioningState: "Succeeded",
      });
      const svc = await mgr.getService("rg-1", "apim-1");
      expect(svc).not.toBeNull();
      expect(svc!.name).toBe("apim-1");
    });

    it("returns null on 404", async () => {
      mockService.get.mockRejectedValue({ statusCode: 404 });
      expect(await mgr.getService("rg-1", "gone")).toBeNull();
    });
  });

  describe("createService", () => {
    it("creates a service", async () => {
      mockService.beginCreateOrUpdateAndWait.mockResolvedValue({
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/new-apim",
        name: "new-apim", location: "eastus", sku: { name: "Consumption", capacity: 0 },
      });
      const svc = await mgr.createService({
        name: "new-apim", resourceGroup: "rg-1", location: "eastus",
        publisherEmail: "admin@example.com", publisherName: "Admin",
      });
      expect(svc.name).toBe("new-apim");
    });
  });

  describe("deleteService", () => {
    it("deletes a service", async () => {
      mockService.beginDeleteAndWait.mockResolvedValue(undefined);
      await mgr.deleteService("rg-1", "apim-1");
      expect(mockService.beginDeleteAndWait).toHaveBeenCalledWith("rg-1", "apim-1");
    });
  });

  describe("createApi", () => {
    it("creates an API", async () => {
      mockApi.beginCreateOrUpdateAndWait.mockResolvedValue({
        id: "api-id", name: "new-api", displayName: "New API", path: "/new", protocols: ["https"],
      });
      const api = await mgr.createApi("rg-1", "apim-1", {
        name: "new-api", displayName: "New API", path: "/new",
      });
      expect(api.name).toBe("new-api");
    });
  });

  describe("deleteApi", () => {
    it("deletes an API", async () => {
      mockApi.delete.mockResolvedValue(undefined);
      await mgr.deleteApi("rg-1", "apim-1", "my-api");
      expect(mockApi.delete).toHaveBeenCalledWith("rg-1", "apim-1", "my-api", "*");
    });
  });

  describe("createProduct", () => {
    it("creates a product", async () => {
      mockProduct.createOrUpdate.mockResolvedValue({
        id: "prod-id", name: "new-prod", displayName: "New Product", state: "notPublished",
      });
      const prod = await mgr.createProduct("rg-1", "apim-1", "new-prod", "New Product");
      expect(prod.name).toBe("new-prod");
    });
  });

  describe("getApiPolicy", () => {
    it("returns a policy", async () => {
      mockApiPolicy.get.mockResolvedValue({
        id: "policy-id", name: "policy", value: "<policies/>", format: "xml",
      });
      const policy = await mgr.getApiPolicy("rg-1", "apim-1", "my-api");
      expect(policy).not.toBeNull();
      expect(policy!.value).toBe("<policies/>");
    });

    it("returns null on 404", async () => {
      mockApiPolicy.get.mockRejectedValue({ statusCode: 404 });
      expect(await mgr.getApiPolicy("rg-1", "apim-1", "no-api")).toBeNull();
    });
  });

  describe("setApiPolicy", () => {
    it("sets a policy", async () => {
      mockApiPolicy.createOrUpdate.mockResolvedValue({
        id: "policy-id", name: "policy", value: "<policies><inbound/></policies>", format: "xml",
      });
      const policy = await mgr.setApiPolicy("rg-1", "apim-1", "my-api", "<policies><inbound/></policies>");
      expect(policy.value).toContain("<inbound/>");
    });
  });
});
