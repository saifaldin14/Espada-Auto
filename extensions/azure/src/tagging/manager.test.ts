/**
 * Azure Tagging Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureTaggingManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

const mockTagsOperations = {
  createOrUpdateAtScope: vi.fn(),
  deleteAtScope: vi.fn(),
  getAtScope: vi.fn(),
};

vi.mock("@azure/arm-resources", () => ({
  ResourceManagementClient: vi.fn().mockImplementation(() => ({
    tagsOperations: mockTagsOperations,
  })),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureTaggingManager", () => {
  let mgr: AzureTaggingManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureTaggingManager(mockCreds, "sub-1");
  });

  describe("validateTags", () => {
    it("validates valid tags", () => {
      const result = mgr.validateTags({ environment: "prod", team: "platform" });
      expect(result.valid).toBe(true);
    });
  });

  describe("getEffectiveTags", () => {
    it("returns user tags merged with defaults", () => {
      const tags = mgr.getEffectiveTags({ custom: "value" });
      expect(tags).toHaveProperty("custom", "value");
    });

    it("returns defaults when no user tags", () => {
      const tags = mgr.getEffectiveTags();
      expect(typeof tags).toBe("object");
    });
  });

  describe("updateResourceTags", () => {
    it("merges tags on a resource", async () => {
      mockTagsOperations.createOrUpdateAtScope.mockResolvedValue({});
      await mgr.updateResourceTags({
        resourceId: "/subscriptions/sub-1/resourceGroups/rg-1",
        action: "merge",
        tags: { env: "prod" },
      });
      expect(mockTagsOperations.createOrUpdateAtScope).toHaveBeenCalled();
    });

    it("deletes tags on a resource", async () => {
      mockTagsOperations.deleteAtScope.mockResolvedValue({});
      await mgr.updateResourceTags({
        resourceId: "/subscriptions/sub-1/resourceGroups/rg-1",
        action: "delete",
        tags: {},
      });
      expect(mockTagsOperations.deleteAtScope).toHaveBeenCalled();
    });
  });

  describe("getResourceTags", () => {
    it("returns tags for a resource", async () => {
      mockTagsOperations.getAtScope.mockResolvedValue({ properties: { tags: { env: "dev", team: "platform" } } });
      const tags = await mgr.getResourceTags("/subscriptions/sub-1/resourceGroups/rg-1");
      expect(tags).toEqual({ env: "dev", team: "platform" });
    });

    it("returns empty object when no tags", async () => {
      mockTagsOperations.getAtScope.mockResolvedValue({ properties: {} });
      const tags = await mgr.getResourceTags("/subscriptions/sub-1/resourceGroups/rg-1");
      expect(tags).toEqual({});
    });
  });
});
