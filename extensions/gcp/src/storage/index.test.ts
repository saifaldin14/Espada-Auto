import { describe, it, expect, vi, beforeEach } from "vitest";
import { GcpStorageManager } from "./index.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

vi.mock("../api.js", () => ({
  gcpRequest: vi.fn(),
  gcpList: vi.fn(),
  gcpMutate: vi.fn(),
}));

vi.mock("../retry.js", () => ({
  withGcpRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

const PROJECT = "test-project";
const TOKEN = "tok_test";
const getToken = vi.fn(async () => TOKEN);

function makeManager() {
  return new GcpStorageManager(PROJECT, getToken);
}

function rawBucket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "my-bucket",
    location: "US",
    storageClass: "STANDARD",
    labels: { env: "prod" },
    timeCreated: "2025-06-01T00:00:00Z",
    versioning: { enabled: true },
    lifecycle: {
      rule: [
        {
          action: { type: "Delete" },
          condition: { age: 30, isLive: true },
        },
      ],
    },
    ...overrides,
  };
}

function rawObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "docs/readme.md",
    bucket: "my-bucket",
    size: "1024",
    contentType: "text/markdown",
    timeCreated: "2025-06-01T00:00:00Z",
    updated: "2025-06-02T00:00:00Z",
    metadata: { custom: "value" },
    ...overrides,
  };
}

describe("GcpStorageManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Buckets
  // ---------------------------------------------------------------------------

  describe("listBuckets", () => {
    it("returns mapped buckets via gcpList", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([rawBucket()]);

      const buckets = await makeManager().listBuckets();
      expect(gcpList).toHaveBeenCalledWith(
        `https://storage.googleapis.com/storage/v1/b?project=${PROJECT}`,
        TOKEN,
        "items",
      );
      expect(buckets).toHaveLength(1);
      expect(buckets[0]).toEqual({
        name: "my-bucket",
        location: "US",
        storageClass: "STANDARD",
        labels: { env: "prod" },
        createdAt: "2025-06-01T00:00:00Z",
        versioning: true,
        lifecycle: [
          {
            action: { type: "Delete", storageClass: undefined },
            condition: { age: 30, matchesStorageClass: undefined, isLive: true, numNewerVersions: undefined },
          },
        ],
      });
    });

    it("handles missing/empty fields with defaults", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([{}]);
      const buckets = await makeManager().listBuckets();
      expect(buckets[0]).toEqual({
        name: "",
        location: "",
        storageClass: "",
        labels: {},
        createdAt: "",
        versioning: false,
        lifecycle: [],
      });
    });
  });

  describe("getBucket", () => {
    it("fetches a single bucket by name", async () => {
      vi.mocked(gcpRequest).mockResolvedValueOnce(rawBucket());

      const bucket = await makeManager().getBucket("my-bucket");
      expect(gcpRequest).toHaveBeenCalledWith(
        "https://storage.googleapis.com/storage/v1/b/my-bucket",
        TOKEN,
      );
      expect(bucket.name).toBe("my-bucket");
      expect(bucket.versioning).toBe(true);
    });
  });

  describe("createBucket", () => {
    it("calls gcpMutate with POST and bucket config", async () => {
      vi.mocked(gcpMutate).mockResolvedValueOnce({ success: true, message: "created" });

      const result = await makeManager().createBucket("new-bucket", { location: "EU" });
      expect(gcpMutate).toHaveBeenCalledWith(
        `https://storage.googleapis.com/storage/v1/b?project=${PROJECT}`,
        TOKEN,
        { name: "new-bucket", location: "EU", storageClass: "STANDARD" },
        "POST",
      );
      expect(result.success).toBe(true);
    });

    it("uses provided storageClass", async () => {
      vi.mocked(gcpMutate).mockResolvedValueOnce({ success: true, message: "created" });
      await makeManager().createBucket("cold-bucket", { location: "US", storageClass: "COLDLINE" });
      expect(vi.mocked(gcpMutate).mock.calls[0][2]).toEqual({
        name: "cold-bucket",
        location: "US",
        storageClass: "COLDLINE",
      });
    });
  });

  describe("deleteBucket", () => {
    it("calls gcpMutate with DELETE", async () => {
      vi.mocked(gcpMutate).mockResolvedValueOnce({ success: true, message: "deleted" });

      const result = await makeManager().deleteBucket("old-bucket");
      expect(gcpMutate).toHaveBeenCalledWith(
        "https://storage.googleapis.com/storage/v1/b/old-bucket",
        TOKEN,
        {},
        "DELETE",
      );
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Objects
  // ---------------------------------------------------------------------------

  describe("listObjects", () => {
    it("lists objects in a bucket", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([rawObject()]);

      const objects = await makeManager().listObjects("my-bucket");
      expect(gcpList).toHaveBeenCalledWith(
        "https://storage.googleapis.com/storage/v1/b/my-bucket/o",
        TOKEN,
        "items",
      );
      expect(objects).toHaveLength(1);
      expect(objects[0]).toEqual({
        name: "docs/readme.md",
        bucket: "my-bucket",
        size: 1024,
        contentType: "text/markdown",
        createdAt: "2025-06-01T00:00:00Z",
        updatedAt: "2025-06-02T00:00:00Z",
        metadata: { custom: "value" },
      });
    });

    it("passes prefix query param when provided", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([]);
      await makeManager().listObjects("my-bucket", { prefix: "logs/" });
      expect(gcpList).toHaveBeenCalledWith(
        "https://storage.googleapis.com/storage/v1/b/my-bucket/o?prefix=logs%2F",
        TOKEN,
        "items",
      );
    });
  });

  describe("deleteObject", () => {
    it("deletes an object via gcpMutate with DELETE", async () => {
      vi.mocked(gcpMutate).mockResolvedValueOnce({ success: true, message: "deleted" });

      const result = await makeManager().deleteObject("my-bucket", "docs/readme.md");
      expect(gcpMutate).toHaveBeenCalledWith(
        `https://storage.googleapis.com/storage/v1/b/my-bucket/o/${encodeURIComponent("docs/readme.md")}`,
        TOKEN,
        {},
        "DELETE",
      );
      expect(result.success).toBe(true);
    });
  });
});
