/**
 * Azure CDN Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureCDNManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockProfiles = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
  beginCreateAndWait: vi.fn(),
  beginDeleteAndWait: vi.fn(),
};

const mockEndpoints = {
  listByProfile: vi.fn(),
  beginPurgeContentAndWait: vi.fn(),
  beginCreateAndWait: vi.fn(),
  beginDeleteAndWait: vi.fn(),
};

const mockCustomDomains = { listByEndpoint: vi.fn() };

vi.mock("@azure/arm-cdn", () => ({
  CdnManagementClient: vi.fn().mockImplementation(function() { return {
    profiles: mockProfiles,
    endpoints: mockEndpoints,
    customDomains: mockCustomDomains,
  }; }),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureCDNManager", () => {
  let mgr: AzureCDNManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureCDNManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listProfiles", () => {
    it("lists all profiles", async () => {
      mockProfiles.list.mockReturnValue(asyncIter([
        { id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Cdn/profiles/cdn-1", name: "cdn-1", location: "global", sku: { name: "Standard_Microsoft" }, properties: { provisioningState: "Succeeded", resourceState: "Active" }, tags: {} },
      ]));
      const profiles = await mgr.listProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe("cdn-1");
    });

    it("filters by resource group", async () => {
      mockProfiles.listByResourceGroup.mockReturnValue(asyncIter([]));
      await mgr.listProfiles("rg-1");
      expect(mockProfiles.listByResourceGroup).toHaveBeenCalledWith("rg-1");
    });
  });

  describe("listEndpoints", () => {
    it("lists endpoints for a profile", async () => {
      mockEndpoints.listByProfile.mockReturnValue(asyncIter([
        { id: "ep-id", name: "endpoint-1", location: "global", properties: { hostName: "endpoint-1.azureedge.net", originHostHeader: "origin.example.com", isHttpAllowed: true, isHttpsAllowed: true, provisioningState: "Succeeded", resourceState: "Running" } },
      ]));
      const endpoints = await mgr.listEndpoints("rg-1", "cdn-1");
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].name).toBe("endpoint-1");
    });
  });

  describe("listCustomDomains", () => {
    it("lists custom domains for an endpoint", async () => {
      mockCustomDomains.listByEndpoint.mockReturnValue(asyncIter([
        { id: "cd-id", name: "www-example-com", properties: { hostName: "www.example.com", customHttpsProvisioningState: "Enabled", validationData: "data" } },
      ]));
      const domains = await mgr.listCustomDomains("rg-1", "cdn-1", "endpoint-1");
      expect(domains).toHaveLength(1);
      expect(domains[0].name).toBe("www-example-com");
    });
  });

  describe("purgeContent", () => {
    it("purges content paths", async () => {
      mockEndpoints.beginPurgeContentAndWait.mockResolvedValue(undefined);
      await mgr.purgeContent("rg-1", "cdn-1", "endpoint-1", ["/*"]);
      expect(mockEndpoints.beginPurgeContentAndWait).toHaveBeenCalledWith("rg-1", "cdn-1", "endpoint-1", { contentPaths: ["/*"] });
    });
  });

  describe("createProfile", () => {
    it("creates a CDN profile", async () => {
      mockProfiles.beginCreateAndWait.mockResolvedValue({
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Cdn/profiles/new-cdn",
        name: "new-cdn", location: "global",
        sku: { name: "Standard_Microsoft" },
        provisioningState: "Succeeded", resourceState: "Active",
      });
      const profile = await mgr.createProfile("rg-1", "new-cdn", "global", "Standard_Microsoft");
      expect(profile.name).toBe("new-cdn");
    });
  });

  describe("deleteProfile", () => {
    it("deletes a CDN profile", async () => {
      mockProfiles.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(mgr.deleteProfile("rg-1", "cdn-1")).resolves.toBeUndefined();
    });
  });

  describe("createEndpoint", () => {
    it("creates a CDN endpoint", async () => {
      mockEndpoints.beginCreateAndWait.mockResolvedValue({
        id: "ep-id", name: "new-ep",
        hostName: "new-ep.azureedge.net",
        origins: [{ name: "origin1", hostName: "origin.example.com" }],
        isHttpAllowed: true, isHttpsAllowed: true,
        provisioningState: "Succeeded",
      });
      const ep = await mgr.createEndpoint("rg-1", "cdn-1", "new-ep", [
        { name: "origin1", hostName: "origin.example.com" },
      ]);
      expect(ep.name).toBe("new-ep");
      expect(ep.origins).toHaveLength(1);
    });
  });

  describe("deleteEndpoint", () => {
    it("deletes a CDN endpoint", async () => {
      mockEndpoints.beginDeleteAndWait.mockResolvedValue(undefined);
      await expect(mgr.deleteEndpoint("rg-1", "cdn-1", "ep-1")).resolves.toBeUndefined();
    });
  });
});
