/**
 * Azure API Management Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureApiManagementManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockApiManagementService = {
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

const mockApiPolicy = {
  get: vi.fn(),
  createOrUpdate: vi.fn(),
};

vi.mock("@azure/arm-apimanagement", () => ({
  ApiManagementClient: vi.fn().mockImplementation(function() { return {
    apiManagementService: mockApiManagementService,
    api: mockApi,
    product: mockProduct,
    apiPolicy: mockApiPolicy,
  }; }),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

const retryOptions = { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 };

describe("AzureApiManagementManager", () => {
  let mgr: AzureApiManagementManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureApiManagementManager(mockCreds, "sub-1", retryOptions);
  });

  describe("listServices", () => {
    it("returns all services", async () => {
      mockApiManagementService.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1", name: "apim-1", location: "eastus", sku: { name: "Consumption", capacity: 0 } },
      ]));
      const svcs = await mgr.listServices();
      expect(svcs).toHaveLength(1);
      expect(svcs[0].name).toBe("apim-1");
    });

    it("returns services by resource group", async () => {
      mockApiManagementService.listByResourceGroup.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1", name: "apim-1", location: "eastus", sku: { name: "Developer", capacity: 1 } },
      ]));
      const svcs = await mgr.listServices("rg-1");
      expect(svcs).toHaveLength(1);
    });
  });

  describe("getService", () => {
    it("returns a service", async () => {
      mockApiManagementService.get.mockResolvedValue({
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1",
        name: "apim-1", location: "eastus", sku: { name: "Consumption", capacity: 0 },
        gatewayUrl: "https://apim-1.azure-api.net",
      });
      const svc = await mgr.getService("rg-1", "apim-1");
      expect(svc?.name).toBe("apim-1");
      expect(svc?.gatewayUrl).toBe("https://apim-1.azure-api.net");
    });

    it("returns null for 404", async () => {
      mockApiManagementService.get.mockRejectedValue({ statusCode: 404 });
      const svc = await mgr.getService("rg-1", "missing");
      expect(svc).toBeNull();
    });
  });

  describe("createService", () => {
    it("creates an API Management service", async () => {
      mockApiManagementService.beginCreateOrUpdateAndWait.mockResolvedValue({
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/new-apim",
        name: "new-apim", location: "eastus",
        sku: { name: "Consumption", capacity: 0 },
        provisioningState: "Succeeded",
      });
      const svc = await mgr.createService({
        name: "new-apim", resourceGroup: "rg-1", location: "eastus",
        publisherEmail: "admin@example.com", publisherName: "Admin",
      });
      expect(svc.name).toBe("new-apim");
    });
  });

  describe("deleteService", () => {
    it("deletes an API Management service", async () => {
      mockApiManagementService.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(mgr.deleteService("rg-1", "apim-1")).resolves.toBeUndefined();
    });
  });

  describe("listApis", () => {
    it("returns APIs", async () => {
      mockApi.listByService.mockReturnValue(asyncIter([
        { id: "api-id", name: "my-api", displayName: "My API", path: "/api", protocols: ["https"] },
      ]));
      const apis = await mgr.listApis("rg-1", "apim-1");
      expect(apis).toHaveLength(1);
      expect(apis[0].displayName).toBe("My API");
    });
  });

  describe("createApi", () => {
    it("creates an API", async () => {
      mockApi.beginCreateOrUpdateAndWait.mockResolvedValue({
        id: "api-id", name: "new-api", displayName: "New API", path: "/new",
        protocols: ["https"], serviceUrl: "https://backend.example.com",
      });
      const api = await mgr.createApi("rg-1", "apim-1", {
        name: "new-api", displayName: "New API", path: "/new",
        serviceUrl: "https://backend.example.com",
      });
      expect(api.name).toBe("new-api");
      expect(api.path).toBe("/new");
    });
  });

  describe("deleteApi", () => {
    it("deletes an API", async () => {
      mockApi.delete.mockResolvedValue(undefined);
      await expect(mgr.deleteApi("rg-1", "apim-1", "old-api")).resolves.toBeUndefined();
      expect(mockApi.delete).toHaveBeenCalledWith("rg-1", "apim-1", "old-api", "*");
    });
  });

  describe("listProducts", () => {
    it("returns products", async () => {
      mockProduct.listByService.mockReturnValue(asyncIter([
        { id: "p-id", name: "starter", displayName: "Starter", state: "published", subscriptionRequired: true },
      ]));
      const products = await mgr.listProducts("rg-1", "apim-1");
      expect(products).toHaveLength(1);
      expect(products[0].displayName).toBe("Starter");
    });
  });

  describe("createProduct", () => {
    it("creates a product", async () => {
      mockProduct.createOrUpdate.mockResolvedValue({
        id: "p-id", name: "premium", displayName: "Premium", state: "notPublished",
        subscriptionRequired: true,
      });
      const product = await mgr.createProduct("rg-1", "apim-1", "premium", "Premium");
      expect(product.name).toBe("premium");
      expect(product.displayName).toBe("Premium");
    });
  });

  describe("getApiPolicy", () => {
    it("returns API policy", async () => {
      mockApiPolicy.get.mockResolvedValue({
        id: "pol-id", name: "policy", value: "<policies><inbound/></policies>", format: "xml",
      });
      const pol = await mgr.getApiPolicy("rg-1", "apim-1", "my-api");
      expect(pol?.value).toContain("<policies>");
    });

    it("returns null for 404", async () => {
      mockApiPolicy.get.mockRejectedValue({ statusCode: 404 });
      const pol = await mgr.getApiPolicy("rg-1", "apim-1", "no-policy");
      expect(pol).toBeNull();
    });
  });

  describe("setApiPolicy", () => {
    it("sets API policy", async () => {
      mockApiPolicy.createOrUpdate.mockResolvedValue({
        id: "pol-id", name: "policy", value: "<policies><inbound><rate-limit/></inbound></policies>", format: "xml",
      });
      const pol = await mgr.setApiPolicy("rg-1", "apim-1", "my-api", "<policies><inbound><rate-limit/></inbound></policies>");
      expect(pol.value).toContain("rate-limit");
    });
  });
});
