/**
 * Azure Static Web Apps Manager — Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureStaticWebAppsManager } from "./manager.js";

function asyncIter<T>(items: T[]) {
  return { [Symbol.asyncIterator]: async function* () { for (const i of items) yield i; } };
}

const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: {} }),
  clearCache: vi.fn(),
} as any;

describe("AzureStaticWebAppsManager", () => {
  let manager: AzureStaticWebAppsManager;

  const mockStaticSites = {
    list: vi.fn(),
    listStaticSitesByResourceGroup: vi.fn(),
    getStaticSite: vi.fn(),
    beginDeleteStaticSiteAndWait: vi.fn(),
    listStaticSiteCustomDomains: vi.fn(),
    listStaticSiteBuilds: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AzureStaticWebAppsManager(mockCredentialsManager, "sub-123", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });

    vi.spyOn(manager as any, "getClient").mockResolvedValue({
      staticSites: mockStaticSites,
    });
  });

  describe("listStaticApps", () => {
    it("should list all static apps", async () => {
      mockStaticSites.list.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Web/staticSites/swa1",
          name: "swa1", location: "Central US",
          sku: { name: "Free", tier: "Free" },
          defaultHostname: "lively-tree-abc123.azurestaticapps.net",
          repositoryUrl: "https://github.com/user/repo",
          branch: "main", provider: "GitHub",
          buildProperties: {
            appLocation: "/", apiLocation: "api", outputLocation: "dist",
            appBuildCommand: "npm run build", apiBuildCommand: "",
          },
          customDomains: ["www.example.com"],
          provisioningState: "Succeeded",
          tags: { env: "prod" },
        },
      ]));

      const apps = await manager.listStaticApps();
      expect(apps).toHaveLength(1);
      expect(apps[0].name).toBe("swa1");
      expect(apps[0].skuName).toBe("Free");
      expect(apps[0].defaultHostname).toBe("lively-tree-abc123.azurestaticapps.net");
      expect(apps[0].repositoryUrl).toBe("https://github.com/user/repo");
      expect(apps[0].branch).toBe("main");
      expect(apps[0].buildProperties?.outputLocation).toBe("dist");
      expect(apps[0].customDomains).toEqual(["www.example.com"]);
    });

    it("should filter by resource group", async () => {
      mockStaticSites.listStaticSitesByResourceGroup.mockReturnValue(asyncIter([]));
      const result = await manager.listStaticApps("rg1");
      expect(result).toEqual([]);
      expect(mockStaticSites.listStaticSitesByResourceGroup).toHaveBeenCalledWith("rg1");
    });
  });

  describe("getStaticApp", () => {
    it("should return a static app", async () => {
      mockStaticSites.getStaticSite.mockResolvedValue({
        id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Web/staticSites/swa1",
        name: "swa1", location: "Central US",
        sku: { name: "Standard", tier: "Standard" },
        defaultHostname: "lively-tree-abc123.azurestaticapps.net",
      });

      const app = await manager.getStaticApp("rg1", "swa1");
      expect(app).not.toBeNull();
      expect(app!.name).toBe("swa1");
      expect(app!.skuName).toBe("Standard");
      expect(mockStaticSites.getStaticSite).toHaveBeenCalledWith("rg1", "swa1");
    });

    it("should return null for 404", async () => {
      mockStaticSites.getStaticSite.mockRejectedValue({ statusCode: 404 });
      const app = await manager.getStaticApp("rg1", "missing");
      expect(app).toBeNull();
    });

    it("should propagate non-404 errors", async () => {
      mockStaticSites.getStaticSite.mockRejectedValue(new Error("Internal server error"));
      await expect(manager.getStaticApp("rg1", "swa1")).rejects.toThrow("Internal server error");
    });
  });

  describe("deleteStaticApp", () => {
    it("should delete a static app", async () => {
      mockStaticSites.beginDeleteStaticSiteAndWait.mockResolvedValue(undefined);
      await manager.deleteStaticApp("rg1", "swa1");
      expect(mockStaticSites.beginDeleteStaticSiteAndWait).toHaveBeenCalledWith("rg1", "swa1");
    });

    it("should propagate delete errors", async () => {
      mockStaticSites.beginDeleteStaticSiteAndWait.mockRejectedValue(new Error("Delete failed"));
      await expect(manager.deleteStaticApp("rg1", "swa1")).rejects.toThrow("Delete failed");
    });
  });

  describe("listCustomDomains", () => {
    it("should list custom domains", async () => {
      mockStaticSites.listStaticSiteCustomDomains.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Web/staticSites/swa1/customDomains/www.example.com",
          name: "www.example.com",
          domainName: "www.example.com",
          status: "Ready",
          validationToken: "token123",
        },
      ]));

      const domains = await manager.listCustomDomains("rg1", "swa1");
      expect(domains).toHaveLength(1);
      expect(domains[0].domainName).toBe("www.example.com");
      expect(domains[0].status).toBe("Ready");
      expect(mockStaticSites.listStaticSiteCustomDomains).toHaveBeenCalledWith("rg1", "swa1");
    });

    it("should return empty array when no domains", async () => {
      mockStaticSites.listStaticSiteCustomDomains.mockReturnValue(asyncIter([]));
      const domains = await manager.listCustomDomains("rg1", "swa1");
      expect(domains).toEqual([]);
    });
  });

  describe("listBuilds", () => {
    it("should list builds", async () => {
      mockStaticSites.listStaticSiteBuilds.mockReturnValue(asyncIter([
        {
          id: "/subscriptions/sub-123/resourceGroups/rg1/providers/Microsoft.Web/staticSites/swa1/builds/default",
          name: "default",
          buildId: "default",
          hostname: "lively-tree-abc123.azurestaticapps.net",
          status: "Ready",
          sourceBranch: "main",
          pullRequestTitle: undefined,
          createdTimeUtc: new Date("2024-01-15T10:00:00Z"),
          lastUpdatedOn: new Date("2024-01-15T10:05:00Z"),
        },
      ]));

      const builds = await manager.listBuilds("rg1", "swa1");
      expect(builds).toHaveLength(1);
      expect(builds[0].name).toBe("default");
      expect(builds[0].status).toBe("Ready");
      expect(builds[0].sourceBranch).toBe("main");
      expect(builds[0].createdTimeUtc).toBe("2024-01-15T10:00:00.000Z");
      expect(mockStaticSites.listStaticSiteBuilds).toHaveBeenCalledWith("rg1", "swa1");
    });

    it("should return empty array when no builds", async () => {
      mockStaticSites.listStaticSiteBuilds.mockReturnValue(asyncIter([]));
      const builds = await manager.listBuilds("rg1", "swa1");
      expect(builds).toEqual([]);
    });
  });
});
