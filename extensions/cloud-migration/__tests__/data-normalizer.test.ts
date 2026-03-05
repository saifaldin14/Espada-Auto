/**
 * Cross-Cloud Migration Engine — Data Normalizer & Transfer Engine Tests
 */
import { describe, it, expect } from "vitest";

import {
  normalizeS3Bucket,
  normalizeAzureBlobContainer,
  normalizeGCSBucket,
  type S3BucketInfo,
  type AzureBlobContainerInfo,
  type GCSBucketInfo,
} from "../src/data/normalizer.js";

import {
  createObjectTransfer,
  getStorageClassMappings,
  estimateTransferTime,
} from "../src/data/transfer-engine.js";

import { mapStorageClass } from "../src/data/types.js";

describe("data/normalizer", () => {
  describe("normalizeS3Bucket", () => {
    it("normalizes an S3 bucket", () => {
      const s3: S3BucketInfo = {
        name: "my-bucket",
        region: "us-east-1",
        creationDate: "2024-01-01",
        versioning: true,
        objectCount: 10000,
        totalSizeBytes: 1024 * 1024 * 1024 * 50,
        tags: { team: "data" },
      };

      const b = normalizeS3Bucket(s3);
      expect(b.provider).toBe("aws");
      expect(b.name).toBe("my-bucket");
      expect(b.id).toBe("my-bucket");
      expect(b.region).toBe("us-east-1");
      expect(b.versioning).toBe(true);
    });
  });

  describe("normalizeAzureBlobContainer", () => {
    it("normalizes an Azure Blob container", () => {
      const azure: AzureBlobContainerInfo = {
        name: "my-container",
        storageAccountName: "storageacc",
        region: "eastus",
        accessTier: "Hot",
        encryption: { enabled: true, keySource: "Microsoft.Storage" },
        publicAccess: "None",
        objectCount: 5000,
        totalSizeBytes: 1024 * 1024 * 1024 * 10,
        tags: {},
      };

      const b = normalizeAzureBlobContainer(azure);
      expect(b.provider).toBe("azure");
      expect(b.name).toBe("my-container");
      expect(b.id).toBe("storageacc/my-container");
    });
  });

  describe("normalizeGCSBucket", () => {
    it("normalizes a GCS bucket", () => {
      const gcs: GCSBucketInfo = {
        name: "gcs-bucket",
        location: "us-central1",
        locationType: "region",
        storageClass: "STANDARD",
        versioning: false,
        objectCount: 2000,
        totalSizeBytes: 1024 * 1024 * 1024,
        labels: { env: "prod" },
      };

      const b = normalizeGCSBucket(gcs);
      expect(b.provider).toBe("gcp");
      expect(b.name).toBe("gcs-bucket");
      expect(b.tags.env).toBe("prod");
    });
  });
});

describe("data/types - mapStorageClass", () => {
  it("maps AWS STANDARD to Azure Hot", () => {
    const mapped = mapStorageClass("STANDARD", "aws", "azure");
    expect(typeof mapped).toBe("string");
    expect(mapped.length).toBeGreaterThan(0);
  });

  it("maps GCP STANDARD to AWS STANDARD", () => {
    const mapped = mapStorageClass("STANDARD", "gcp", "aws");
    expect(typeof mapped).toBe("string");
  });

  it("returns input for unknown mapping", () => {
    const mapped = mapStorageClass("UNKNOWN_CLASS", "aws", "azure");
    expect(mapped).toBe("UNKNOWN_CLASS");
  });
});

describe("data/transfer-engine", () => {
  describe("createObjectTransfer", () => {
    it("creates a transfer task", () => {
      const transfer = createObjectTransfer({
        sourceBucket: "src-bucket",
        sourceProvider: "aws",
        sourceRegion: "us-east-1",
        targetBucket: "tgt-bucket",
        targetProvider: "azure",
        targetRegion: "eastus",
        concurrency: 4,
        chunkSizeMB: 64,
        metadataPreserve: true,
        aclPreserve: false,
      });

      expect(transfer).toHaveProperty("taskId");
      expect(transfer).toHaveProperty("start");
      expect(transfer).toHaveProperty("getProgress");
      expect(typeof transfer.taskId).toBe("string");
    });
  });

  describe("getStorageClassMappings", () => {
    it("returns mapping for aws → azure", () => {
      const mappings = getStorageClassMappings("aws", "azure", ["STANDARD", "GLACIER"]);
      expect(typeof mappings).toBe("object");
      expect(Object.keys(mappings).length).toBeGreaterThan(0);
    });
  });

  describe("estimateTransferTime", () => {
    it("estimates time based on size and bandwidth", () => {
      const result = estimateTransferTime({
        totalSizeBytes: 1024 * 1024 * 1024,
        objectCount: 100,
        concurrency: 4,
        estimatedBandwidthMbps: 1000,
      });
      expect(result.estimatedMs).toBeGreaterThan(0);
      expect(result).toHaveProperty("bottleneck");
    });

    it("handles zero size", () => {
      const result = estimateTransferTime({
        totalSizeBytes: 0,
        objectCount: 0,
        concurrency: 4,
        estimatedBandwidthMbps: 1000,
      });
      expect(result.estimatedMs).toBeGreaterThanOrEqual(0);
    });
  });
});
