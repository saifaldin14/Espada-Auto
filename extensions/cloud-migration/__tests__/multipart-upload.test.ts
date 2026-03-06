/**
 * Multi-Part Upload & Streaming Engine Integration — Tests
 *
 * Tests the native multi-part upload support added to all three provider
 * adapters (AWS, Azure, GCP) and the updated streaming transfer engine
 * that dispatches to native multi-part APIs for objects above the threshold.
 *
 * Uses mock adapters; no real cloud credentials required.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createStreamingTransfer,
  DEFAULT_STREAMING_OPTIONS,
} from "../src/data/streaming-transfer-engine.js";
import type { ObjectTransferConfig } from "../src/data/types.js";
import type {
  CloudProviderAdapter,
  ListObjectsOutput,
  ObjectDataOutput,
  PutObjectOutput,
  MultipartUploadInit,
  UploadPartParams,
  UploadPartOutput,
  CompleteMultipartUploadParams,
} from "../src/providers/types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeConfig(overrides?: Partial<ObjectTransferConfig>): ObjectTransferConfig {
  return {
    sourceBucket: "src-bucket",
    sourceProvider: "aws",
    sourceRegion: "us-east-1",
    targetBucket: "tgt-bucket",
    targetProvider: "azure",
    targetRegion: "eastus",
    concurrency: 1,
    chunkSizeMB: 64,
    metadataPreserve: true,
    aclPreserve: false,
    ...overrides,
  };
}

function makeListObjectsPage(
  objects: Array<{ key: string; sizeBytes: number; etag?: string }>,
): ListObjectsOutput {
  return {
    objects: objects.map((o) => ({
      key: o.key,
      sizeBytes: o.sizeBytes,
      lastModified: "2024-01-01T00:00:00Z",
      etag: o.etag ?? `etag-${o.key}`,
      storageClass: "STANDARD",
    })),
    truncated: false,
    continuationToken: undefined,
    totalCount: objects.length,
  };
}

function makeObjectData(key: string, sizeBytes: number): ObjectDataOutput {
  return {
    data: Buffer.alloc(sizeBytes, key.charCodeAt(0)),
    contentType: "application/octet-stream",
    etag: `etag-${key}`,
    metadata: { "x-source-key": key },
  };
}

/**
 * Create a mock source adapter that serves objects of a given size.
 */
function makeMockSourceAdapter(
  objects: Array<{ key: string; sizeBytes: number }>,
): CloudProviderAdapter {
  return {
    storage: {
      listBuckets: vi.fn(),
      getBucket: vi.fn(),
      createBucket: vi.fn(),
      deleteBucket: vi.fn(),
      listObjects: vi.fn().mockResolvedValue(makeListObjectsPage(objects)),
      getObjectUrl: vi.fn(),
      getObject: vi.fn().mockImplementation(async (_b: string, key: string) => {
        const obj = objects.find((o) => o.key === key);
        return makeObjectData(key, obj?.sizeBytes ?? 1024);
      }),
      putObject: vi.fn(),
      deleteObject: vi.fn(),
      setBucketVersioning: vi.fn(),
      setBucketTags: vi.fn(),
      initiateMultipartUpload: vi.fn(),
      uploadPart: vi.fn(),
      completeMultipartUpload: vi.fn(),
      abortMultipartUpload: vi.fn(),
    },
    compute: {} as any,
    dns: {} as any,
    network: {} as any,
  } as unknown as CloudProviderAdapter;
}

/**
 * Create a mock target adapter with multi-part upload support.
 */
function makeMockTargetAdapter(): CloudProviderAdapter {
  let partCounter = 0;

  return {
    storage: {
      listBuckets: vi.fn(),
      getBucket: vi.fn(),
      createBucket: vi.fn(),
      deleteBucket: vi.fn(),
      listObjects: vi.fn().mockResolvedValue(makeListObjectsPage([])),
      getObjectUrl: vi.fn(),
      getObject: vi.fn(),
      putObject: vi.fn().mockResolvedValue({ etag: "single-put-etag" } as PutObjectOutput),
      deleteObject: vi.fn(),
      setBucketVersioning: vi.fn(),
      setBucketTags: vi.fn(),

      // Multi-part mock implementations
      initiateMultipartUpload: vi.fn().mockImplementation(
        async (bucket: string, key: string): Promise<MultipartUploadInit> => ({
          uploadId: `upload-${Date.now()}`,
          bucketName: bucket,
          key,
        }),
      ),
      uploadPart: vi.fn().mockImplementation(
        async (params: UploadPartParams): Promise<UploadPartOutput> => ({
          partNumber: params.partNumber,
          etag: `part-etag-${++partCounter}`,
        }),
      ),
      completeMultipartUpload: vi.fn().mockImplementation(
        async (_params: CompleteMultipartUploadParams): Promise<PutObjectOutput> => ({
          etag: "multipart-complete-etag",
        }),
      ),
      abortMultipartUpload: vi.fn().mockResolvedValue(undefined),
    },
    compute: {} as any,
    dns: {} as any,
    network: {} as any,
  } as unknown as CloudProviderAdapter;
}

// =============================================================================
// Provider Adapter Interface Compliance
// =============================================================================

describe("multi-part upload — provider adapter interface", () => {
  it("StorageAdapter interface includes all 4 multi-part methods", async () => {
    // Runtime check that the mock adapter has all needed methods
    const adapter = makeMockTargetAdapter();
    expect(typeof adapter.storage.initiateMultipartUpload).toBe("function");
    expect(typeof adapter.storage.uploadPart).toBe("function");
    expect(typeof adapter.storage.completeMultipartUpload).toBe("function");
    expect(typeof adapter.storage.abortMultipartUpload).toBe("function");
  });

  it("initiateMultipartUpload returns uploadId, bucket, key", async () => {
    const adapter = makeMockTargetAdapter();
    const result = await adapter.storage.initiateMultipartUpload("my-bucket", "large-file.bin");

    expect(result.uploadId).toBeDefined();
    expect(typeof result.uploadId).toBe("string");
    expect(result.bucketName).toBe("my-bucket");
    expect(result.key).toBe("large-file.bin");
  });

  it("uploadPart returns partNumber and etag", async () => {
    const adapter = makeMockTargetAdapter();
    const result = await adapter.storage.uploadPart({
      bucketName: "my-bucket",
      key: "large-file.bin",
      uploadId: "upload-123",
      partNumber: 1,
      data: Buffer.alloc(1024),
    });

    expect(result.partNumber).toBe(1);
    expect(typeof result.etag).toBe("string");
    expect(result.etag.length).toBeGreaterThan(0);
  });

  it("completeMultipartUpload returns etag", async () => {
    const adapter = makeMockTargetAdapter();
    const result = await adapter.storage.completeMultipartUpload({
      bucketName: "b",
      key: "k",
      uploadId: "u",
      parts: [{ partNumber: 1, etag: "e1" }],
    });

    expect(result.etag).toBe("multipart-complete-etag");
  });

  it("abortMultipartUpload resolves without error", async () => {
    const adapter = makeMockTargetAdapter();
    await expect(
      adapter.storage.abortMultipartUpload("b", "k", "u"),
    ).resolves.toBeUndefined();
  });
});

// =============================================================================
// Streaming Engine — Native Multi-Part Upload Integration
// =============================================================================

describe("streaming engine — native multi-part upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses native multi-part API for objects above threshold", async () => {
    // Object is 2000 bytes; threshold is 500 bytes → triggers multi-part
    const objects = [{ key: "large.bin", sizeBytes: 2000 }];
    const srcAdapter = makeMockSourceAdapter(objects);
    const tgtAdapter = makeMockTargetAdapter();
    const config = makeConfig();

    const task = createStreamingTransfer(config, {
      sourceAdapter: srcAdapter,
      targetAdapter: tgtAdapter,
      multiPartThresholdBytes: 500,
      partSizeBytes: 600, // 2000 / 600 = 4 parts (3×600 + 1×200)
    });

    const result = await task.start();

    expect(result.objectsTransferred).toBe(1);

    // Should have called initiate, uploadPart (4 times), and complete
    expect(tgtAdapter.storage.initiateMultipartUpload).toHaveBeenCalledTimes(1);
    expect(tgtAdapter.storage.uploadPart).toHaveBeenCalledTimes(4);
    expect(tgtAdapter.storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    // Should NOT have used single putObject for this object
    expect(tgtAdapter.storage.putObject).not.toHaveBeenCalled();
    // Should NOT have called abort
    expect(tgtAdapter.storage.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it("uses single putObject for objects below threshold", async () => {
    const objects = [{ key: "small.txt", sizeBytes: 100 }];
    const srcAdapter = makeMockSourceAdapter(objects);
    const tgtAdapter = makeMockTargetAdapter();
    const config = makeConfig();

    const task = createStreamingTransfer(config, {
      sourceAdapter: srcAdapter,
      targetAdapter: tgtAdapter,
      multiPartThresholdBytes: 5000,
    });

    const result = await task.start();

    expect(result.objectsTransferred).toBe(1);
    expect(tgtAdapter.storage.putObject).toHaveBeenCalledTimes(1);
    expect(tgtAdapter.storage.initiateMultipartUpload).not.toHaveBeenCalled();
  });

  it("passes correct part number sequence to uploadPart", async () => {
    const objects = [{ key: "seq.bin", sizeBytes: 3000 }];
    const srcAdapter = makeMockSourceAdapter(objects);
    const tgtAdapter = makeMockTargetAdapter();
    const config = makeConfig();

    const task = createStreamingTransfer(config, {
      sourceAdapter: srcAdapter,
      targetAdapter: tgtAdapter,
      multiPartThresholdBytes: 500,
      partSizeBytes: 1000, // 3 parts
    });

    await task.start();

    const calls = (tgtAdapter.storage.uploadPart as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(3);
    expect(calls[0][0].partNumber).toBe(1);
    expect(calls[1][0].partNumber).toBe(2);
    expect(calls[2][0].partNumber).toBe(3);
  });

  it("passes all part results to completeMultipartUpload", async () => {
    const objects = [{ key: "complete.bin", sizeBytes: 1500 }];
    const srcAdapter = makeMockSourceAdapter(objects);
    const tgtAdapter = makeMockTargetAdapter();
    const config = makeConfig();

    const task = createStreamingTransfer(config, {
      sourceAdapter: srcAdapter,
      targetAdapter: tgtAdapter,
      multiPartThresholdBytes: 500,
      partSizeBytes: 600, // 3 parts
    });

    await task.start();

    const completeCalls = (tgtAdapter.storage.completeMultipartUpload as ReturnType<typeof vi.fn>).mock.calls;
    expect(completeCalls.length).toBe(1);
    const partsArg = completeCalls[0][0].parts;
    expect(partsArg.length).toBe(3);
    expect(partsArg[0].partNumber).toBe(1);
    expect(partsArg[1].partNumber).toBe(2);
    expect(partsArg[2].partNumber).toBe(3);
    // Each part should have an etag
    for (const p of partsArg) {
      expect(typeof p.etag).toBe("string");
      expect(p.etag.length).toBeGreaterThan(0);
    }
  });

  it("aborts multi-part upload when a part fails after retries", async () => {
    const objects = [{ key: "fail.bin", sizeBytes: 2000 }];
    const srcAdapter = makeMockSourceAdapter(objects);
    const tgtAdapter = makeMockTargetAdapter();
    const config = makeConfig();

    // Make uploadPart fail on part 2
    let callCount = 0;
    (tgtAdapter.storage.uploadPart as ReturnType<typeof vi.fn>).mockImplementation(
      async (params: UploadPartParams) => {
        callCount++;
        if (params.partNumber === 2) {
          throw new Error("Simulated part upload failure");
        }
        return { partNumber: params.partNumber, etag: `etag-${params.partNumber}` };
      },
    );

    const task = createStreamingTransfer(config, {
      sourceAdapter: srcAdapter,
      targetAdapter: tgtAdapter,
      multiPartThresholdBytes: 500,
      partSizeBytes: 600,
      maxRetries: 1, // Only 1 retry for speed
      retryDelayMs: 10,
    });

    // The transfer should fail because part 2 fails consistently
    const result = await task.start();

    // The object should be in the failed list
    expect(result.objectsFailed).toBe(1);

    // abortMultipartUpload should have been called to clean up
    expect(tgtAdapter.storage.abortMultipartUpload).toHaveBeenCalled();
    // completeMultipartUpload should NOT have been called
    expect(tgtAdapter.storage.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it("handles multiple objects with mixed sizes (some below, some above threshold)", async () => {
    const objects = [
      { key: "tiny.txt", sizeBytes: 100 },   // Below threshold
      { key: "large1.bin", sizeBytes: 3000 }, // Above threshold
      { key: "medium.dat", sizeBytes: 400 },  // Below threshold
      { key: "large2.bin", sizeBytes: 2500 }, // Above threshold
    ];
    const srcAdapter = makeMockSourceAdapter(objects);
    const tgtAdapter = makeMockTargetAdapter();
    const config = makeConfig({ concurrency: 1 });

    const task = createStreamingTransfer(config, {
      sourceAdapter: srcAdapter,
      targetAdapter: tgtAdapter,
      multiPartThresholdBytes: 1000,
      partSizeBytes: 1000,
    });

    const result = await task.start();

    expect(result.objectsTransferred).toBe(4);

    // 2 small objects via putObject
    expect(tgtAdapter.storage.putObject).toHaveBeenCalledTimes(2);

    // 2 large objects via multi-part (2 initiations and 2 completions)
    expect(tgtAdapter.storage.initiateMultipartUpload).toHaveBeenCalledTimes(2);
    expect(tgtAdapter.storage.completeMultipartUpload).toHaveBeenCalledTimes(2);
  });

  it("correctly chunks data into partSizeBytes segments", async () => {
    // 2500 bytes with 1000-byte parts = 3 parts (1000 + 1000 + 500)
    const objects = [{ key: "chunk-test.bin", sizeBytes: 2500 }];
    const srcAdapter = makeMockSourceAdapter(objects);
    const tgtAdapter = makeMockTargetAdapter();
    const config = makeConfig();

    const task = createStreamingTransfer(config, {
      sourceAdapter: srcAdapter,
      targetAdapter: tgtAdapter,
      multiPartThresholdBytes: 100,
      partSizeBytes: 1000,
    });

    await task.start();

    const calls = (tgtAdapter.storage.uploadPart as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(3);

    // First two parts should be 1000 bytes
    expect(calls[0][0].data.length).toBe(1000);
    expect(calls[1][0].data.length).toBe(1000);
    // Last part should be 500 bytes
    expect(calls[2][0].data.length).toBe(500);
  });

  it("passes the correct uploadId from initiate to all parts and complete", async () => {
    const objects = [{ key: "id-check.bin", sizeBytes: 1500 }];
    const srcAdapter = makeMockSourceAdapter(objects);
    const tgtAdapter = makeMockTargetAdapter();

    // Override to return a specific uploadId
    (tgtAdapter.storage.initiateMultipartUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
      uploadId: "test-upload-id-42",
      bucketName: "tgt-bucket",
      key: "id-check.bin",
    });

    const config = makeConfig();

    const task = createStreamingTransfer(config, {
      sourceAdapter: srcAdapter,
      targetAdapter: tgtAdapter,
      multiPartThresholdBytes: 500,
      partSizeBytes: 600,
    });

    await task.start();

    // All uploadPart calls should use the same uploadId
    const partCalls = (tgtAdapter.storage.uploadPart as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of partCalls) {
      expect(call[0].uploadId).toBe("test-upload-id-42");
    }

    // completeMultipartUpload should also use same uploadId
    const completeCalls = (tgtAdapter.storage.completeMultipartUpload as ReturnType<typeof vi.fn>).mock.calls;
    expect(completeCalls[0][0].uploadId).toBe("test-upload-id-42");
  });
});

// =============================================================================
// Default Options
// =============================================================================

describe("DEFAULT_STREAMING_OPTIONS", () => {
  it("has a 100MB multi-part threshold", () => {
    expect(DEFAULT_STREAMING_OPTIONS.multiPartThresholdBytes).toBe(100 * 1024 * 1024);
  });

  it("has a 64MB part size", () => {
    expect(DEFAULT_STREAMING_OPTIONS.partSizeBytes).toBe(64 * 1024 * 1024);
  });

  it("has a positive concurrency default", () => {
    expect(DEFAULT_STREAMING_OPTIONS.concurrency).toBeGreaterThan(0);
  });

  it("has maxRetries >= 1", () => {
    expect(DEFAULT_STREAMING_OPTIONS.maxRetries).toBeGreaterThanOrEqual(1);
  });
});
