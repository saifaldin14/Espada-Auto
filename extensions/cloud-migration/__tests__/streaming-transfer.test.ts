/**
 * Streaming Transfer Engine — Tests
 *
 * Tests the streaming/resumable/delta-sync transfer engine including:
 * - Stub path (no adapters)
 * - Real path with mock adapters
 * - Checkpoint serialization/deserialization
 * - Delta sync (skip unchanged objects)
 * - Resumable transfers (skip completed keys)
 * - Multi-part upload threshold
 * - Abort signal handling
 * - Concurrent batching
 * - Error handling and retry
 * - Storage class mapping
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createStreamingTransfer,
  serializeCheckpoint,
  deserializeCheckpoint,
  getStreamingStorageClassMappings,
  DEFAULT_STREAMING_OPTIONS,
} from "../src/data/streaming-transfer-engine.js";
import type {
  TransferCheckpoint,
  StreamingTransferOptions,
} from "../src/data/streaming-transfer-engine.js";
import type { ObjectTransferConfig } from "../src/data/types.js";
import type {
  CloudProviderAdapter,
  ListObjectsOutput,
  ObjectDataOutput,
  PutObjectOutput,
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
    concurrency: 4,
    chunkSizeMB: 64,
    metadataPreserve: true,
    aclPreserve: false,
    ...overrides,
  };
}

function makeListObjectsPage(
  objects: Array<{ key: string; sizeBytes: number; etag?: string }>,
  truncated = false,
  continuationToken?: string,
): ListObjectsOutput {
  return {
    objects: objects.map((o) => ({
      key: o.key,
      sizeBytes: o.sizeBytes,
      lastModified: "2024-01-01T00:00:00Z",
      etag: o.etag ?? `etag-${o.key}`,
      storageClass: "STANDARD",
    })),
    truncated,
    continuationToken,
    totalCount: objects.length,
  };
}

function makeObjectData(key: string, sizeBytes = 1024): ObjectDataOutput {
  return {
    data: Buffer.alloc(sizeBytes, key.charCodeAt(0)),
    contentType: "application/octet-stream",
    etag: `etag-${key}`,
    metadata: { "x-source-key": key },
  };
}

function makePutResult(etag?: string): PutObjectOutput {
  return {
    etag: etag ?? "target-etag",
    versionId: undefined,
  };
}

function makeMockSourceAdapter(
  objects: Array<{ key: string; sizeBytes: number; etag?: string }>,
): CloudProviderAdapter {
  const listObjects = vi.fn().mockResolvedValue(makeListObjectsPage(objects));
  const getObject = vi.fn().mockImplementation(async (_bucket: string, key: string) => {
    const obj = objects.find((o) => o.key === key);
    return makeObjectData(key, obj?.sizeBytes ?? 1024);
  });

  return {
    storage: {
      listBuckets: vi.fn(),
      getBucket: vi.fn(),
      createBucket: vi.fn(),
      deleteBucket: vi.fn(),
      listObjects,
      getObjectUrl: vi.fn(),
      getObject,
      putObject: vi.fn(),
      deleteObject: vi.fn(),
      setBucketVersioning: vi.fn(),
      setBucketTags: vi.fn(),
    },
    compute: {} as any,
    dns: {} as any,
    network: {} as any,
  } as unknown as CloudProviderAdapter;
}

function makeMockTargetAdapter(): CloudProviderAdapter {
  return {
    storage: {
      listBuckets: vi.fn(),
      getBucket: vi.fn(),
      createBucket: vi.fn(),
      deleteBucket: vi.fn(),
      listObjects: vi.fn().mockResolvedValue(makeListObjectsPage([])),
      getObjectUrl: vi.fn(),
      getObject: vi.fn(),
      putObject: vi.fn().mockResolvedValue(makePutResult()),
      deleteObject: vi.fn(),
      setBucketVersioning: vi.fn(),
      setBucketTags: vi.fn(),
    },
    compute: {} as any,
    dns: {} as any,
    network: {} as any,
  } as unknown as CloudProviderAdapter;
}

// =============================================================================
// Defaults
// =============================================================================

describe("streaming-transfer-engine", () => {
  describe("DEFAULT_STREAMING_OPTIONS", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_STREAMING_OPTIONS.concurrency).toBe(16);
      expect(DEFAULT_STREAMING_OPTIONS.partSizeBytes).toBe(64 * 1024 * 1024);
      expect(DEFAULT_STREAMING_OPTIONS.multiPartThresholdBytes).toBe(100 * 1024 * 1024);
      expect(DEFAULT_STREAMING_OPTIONS.maxRetries).toBe(3);
      expect(DEFAULT_STREAMING_OPTIONS.retryDelayMs).toBe(1000);
      expect(DEFAULT_STREAMING_OPTIONS.bandwidthLimitBytesPerSec).toBe(0);
      expect(DEFAULT_STREAMING_OPTIONS.enableDeltaSync).toBe(false);
      expect(DEFAULT_STREAMING_OPTIONS.enableResume).toBe(false);
    });
  });

  // ===========================================================================
  // Checkpoint Serialization
  // ===========================================================================

  describe("serializeCheckpoint / deserializeCheckpoint", () => {
    it("round-trips a checkpoint through serialization", () => {
      const cp: TransferCheckpoint = {
        taskId: "stream-task-1",
        sourceBucket: "src",
        targetBucket: "tgt",
        completedKeys: new Set(["file1.txt", "file2.txt"]),
        targetEtags: new Map([["file1.txt", "etag-1"], ["file2.txt", "etag-2"]]),
        savedAt: "2024-01-15T10:00:00Z",
        totalObjects: 100,
        totalBytes: 5000,
      };

      const serialized = serializeCheckpoint(cp);
      expect(Array.isArray(serialized.completedKeys)).toBe(true);
      expect(typeof serialized.targetEtags).toBe("object");
      expect(serialized.taskId).toBe("stream-task-1");

      const restored = deserializeCheckpoint(serialized);
      expect(restored.taskId).toBe("stream-task-1");
      expect(restored.completedKeys).toBeInstanceOf(Set);
      expect(restored.completedKeys.has("file1.txt")).toBe(true);
      expect(restored.completedKeys.has("file2.txt")).toBe(true);
      expect(restored.targetEtags).toBeInstanceOf(Map);
      expect(restored.targetEtags.get("file1.txt")).toBe("etag-1");
      expect(restored.totalObjects).toBe(100);
      expect(restored.totalBytes).toBe(5000);
    });

    it("handles empty checkpoint", () => {
      const cp: TransferCheckpoint = {
        taskId: "empty",
        sourceBucket: "s",
        targetBucket: "t",
        completedKeys: new Set(),
        targetEtags: new Map(),
        savedAt: "2024-01-01T00:00:00Z",
        totalObjects: 0,
        totalBytes: 0,
      };

      const restored = deserializeCheckpoint(serializeCheckpoint(cp));
      expect(restored.completedKeys.size).toBe(0);
      expect(restored.targetEtags.size).toBe(0);
    });
  });

  // ===========================================================================
  // Stub Path (no adapters)
  // ===========================================================================

  describe("createStreamingTransfer — stub path", () => {
    it("creates a transfer task with a unique taskId", () => {
      const config = makeConfig();
      const task = createStreamingTransfer(config);
      expect(task.taskId).toContain("stream-");
      expect(task.taskId).toContain("src-bucket");
    });

    it("executes stub transfer (no adapters) and returns zero-count result", async () => {
      const config = makeConfig();
      const task = createStreamingTransfer(config);
      const result = await task.start();

      expect(result.objectsTransferred).toBe(0);
      expect(result.bytesTransferred).toBe(0);
      expect(result.objectsFailed).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.manifest).toBeDefined();
      expect(result.manifest.sourceBucket).toBe("src-bucket");
      expect(result.manifest.targetBucket).toBe("tgt-bucket");
      expect(result.integrityReport.passed).toBe(true);
    });

    it("getProgress reflects stub completion", async () => {
      const config = makeConfig();
      const task = createStreamingTransfer(config);
      await task.start();

      const progress = task.getProgress();
      expect(progress.status).toBe("complete");
    });

    it("getCheckpoint returns null when resume not enabled", async () => {
      const config = makeConfig();
      const task = createStreamingTransfer(config);
      await task.start();
      expect(task.getCheckpoint()).toBeNull();
    });
  });

  // ===========================================================================
  // Real Path (with mock adapters)
  // ===========================================================================

  describe("createStreamingTransfer — real path with mock adapters", () => {
    it("transfers all objects from source to target", async () => {
      const objects = [
        { key: "data/file1.txt", sizeBytes: 1024 },
        { key: "data/file2.txt", sizeBytes: 2048 },
        { key: "data/file3.txt", sizeBytes: 512 },
      ];
      const srcAdapter = makeMockSourceAdapter(objects);
      const tgtAdapter = makeMockTargetAdapter();
      const config = makeConfig();

      const task = createStreamingTransfer(config, {
        sourceAdapter: srcAdapter,
        targetAdapter: tgtAdapter,
        concurrency: 2,
      });

      const result = await task.start();

      expect(result.objectsTransferred).toBe(3);
      expect(result.bytesTransferred).toBe(1024 + 2048 + 512);
      expect(result.objectsFailed).toBe(0);
      expect(result.integrityReport.passed).toBe(true);

      // Verify adapter calls
      expect(srcAdapter.storage.listObjects).toHaveBeenCalledWith("src-bucket", expect.objectContaining({ maxKeys: 1000 }));
      expect(srcAdapter.storage.getObject).toHaveBeenCalledTimes(3);
      expect(tgtAdapter.storage.putObject).toHaveBeenCalledTimes(3);
    });

    it("applies exclude patterns to filter objects", async () => {
      const objects = [
        { key: "data/file1.txt", sizeBytes: 1024 },
        { key: "data/.hidden", sizeBytes: 100 },
        { key: "data/temp/cache.bin", sizeBytes: 500 },
      ];
      const srcAdapter = makeMockSourceAdapter(objects);
      const tgtAdapter = makeMockTargetAdapter();
      const config = makeConfig({ excludePatterns: [".hidden", "temp/"] });

      const task = createStreamingTransfer(config, {
        sourceAdapter: srcAdapter,
        targetAdapter: tgtAdapter,
      });

      const result = await task.start();

      expect(result.objectsTransferred).toBe(1);
      expect(result.bytesTransferred).toBe(1024);
    });

    it("produces a transfer manifest with all transferred keys", async () => {
      const objects = [
        { key: "a.txt", sizeBytes: 100 },
        { key: "b.txt", sizeBytes: 200 },
      ];
      const srcAdapter = makeMockSourceAdapter(objects);
      const tgtAdapter = makeMockTargetAdapter();
      const config = makeConfig();

      const task = createStreamingTransfer(config, {
        sourceAdapter: srcAdapter,
        targetAdapter: tgtAdapter,
      });

      const result = await task.start();
      expect(result.manifest.objects).toHaveLength(2);
      expect(result.manifest.objects[0].key).toBe("a.txt");
      expect(result.manifest.objects[1].key).toBe("b.txt");
      expect(result.manifest.objects[0].status).toBe("completed");
    });

    it("handles empty source inventory", async () => {
      const srcAdapter = makeMockSourceAdapter([]);
      const tgtAdapter = makeMockTargetAdapter();
      const config = makeConfig();

      const task = createStreamingTransfer(config, {
        sourceAdapter: srcAdapter,
        targetAdapter: tgtAdapter,
      });

      const result = await task.start();
      expect(result.objectsTransferred).toBe(0);
      expect(result.objectsFailed).toBe(0);
      expect(result.integrityReport.passed).toBe(true);
    });
  });

  // ===========================================================================
  // Delta Sync
  // ===========================================================================

  describe("delta sync — skip unchanged objects", () => {
    it("skips objects whose ETags match in the target", async () => {
      const objects = [
        { key: "unchanged.txt", sizeBytes: 100, etag: "etag-unchanged" },
        { key: "changed.txt", sizeBytes: 200, etag: "etag-changed" },
      ];
      const srcAdapter = makeMockSourceAdapter(objects);
      const tgtAdapter = makeMockTargetAdapter();

      // Target already has unchanged.txt with same ETag
      (tgtAdapter.storage.listObjects as any).mockResolvedValue(
        makeListObjectsPage([
          { key: "unchanged.txt", sizeBytes: 100, etag: "etag-unchanged" },
        ]),
      );

      const config = makeConfig();
      const task = createStreamingTransfer(config, {
        sourceAdapter: srcAdapter,
        targetAdapter: tgtAdapter,
        enableDeltaSync: true,
      });

      const result = await task.start();

      // Only the changed object should be transferred
      expect(srcAdapter.storage.getObject).toHaveBeenCalledTimes(1);
      expect(tgtAdapter.storage.putObject).toHaveBeenCalledTimes(1);
      expect(result.objectsTransferred).toBe(2); // 1 skipped + 1 transferred = 2 total
      expect(result.objectsFailed).toBe(0);
    });

    it("transfers all objects when delta sync is disabled", async () => {
      const objects = [
        { key: "unchanged.txt", sizeBytes: 100, etag: "etag-unchanged" },
        { key: "changed.txt", sizeBytes: 200, etag: "etag-changed" },
      ];
      const srcAdapter = makeMockSourceAdapter(objects);
      const tgtAdapter = makeMockTargetAdapter();
      const config = makeConfig();

      const task = createStreamingTransfer(config, {
        sourceAdapter: srcAdapter,
        targetAdapter: tgtAdapter,
        enableDeltaSync: false,
      });

      const result = await task.start();
      expect(srcAdapter.storage.getObject).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // Resumable Transfers
  // ===========================================================================

  describe("resumable transfers — checkpoint-based resume", () => {
    it("skips already-completed keys from a previous checkpoint", async () => {
      const objects = [
        { key: "done.txt", sizeBytes: 100 },
        { key: "pending.txt", sizeBytes: 200 },
      ];
      const srcAdapter = makeMockSourceAdapter(objects);
      const tgtAdapter = makeMockTargetAdapter();
      const config = makeConfig();

      const previousCheckpoint: TransferCheckpoint = {
        taskId: "old-task",
        sourceBucket: "src-bucket",
        targetBucket: "tgt-bucket",
        completedKeys: new Set(["done.txt"]),
        targetEtags: new Map(),
        savedAt: "2024-01-01T00:00:00Z",
        totalObjects: 2,
        totalBytes: 300,
      };

      const task = createStreamingTransfer(config, {
        sourceAdapter: srcAdapter,
        targetAdapter: tgtAdapter,
        enableResume: true,
        checkpoint: previousCheckpoint,
      });

      const result = await task.start();

      // Only pending.txt should be downloaded+uploaded
      expect(srcAdapter.storage.getObject).toHaveBeenCalledTimes(1);
      expect(srcAdapter.storage.getObject).toHaveBeenCalledWith("src-bucket", "pending.txt");
      expect(tgtAdapter.storage.putObject).toHaveBeenCalledTimes(1);
    });

    it("saves checkpoint after each batch when resume is enabled", async () => {
      const objects = [
        { key: "f1.txt", sizeBytes: 100 },
        { key: "f2.txt", sizeBytes: 200 },
      ];
      const srcAdapter = makeMockSourceAdapter(objects);
      const tgtAdapter = makeMockTargetAdapter();
      const config = makeConfig();

      const task = createStreamingTransfer(config, {
        sourceAdapter: srcAdapter,
        targetAdapter: tgtAdapter,
        enableResume: true,
        concurrency: 4,
      });

      await task.start();

      const checkpoint = task.getCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.completedKeys.has("f1.txt")).toBe(true);
      expect(checkpoint!.completedKeys.has("f2.txt")).toBe(true);
      expect(checkpoint!.savedAt).toBeDefined();
    });
  });

  // ===========================================================================
  // Error Handling & Retry
  // ===========================================================================

  describe("error handling and retry", () => {
    it("retries failed transfers up to maxRetries", async () => {
      const objects = [{ key: "retry-me.txt", sizeBytes: 100 }];
      const srcAdapter = makeMockSourceAdapter(objects);
      const tgtAdapter = makeMockTargetAdapter();

      // Fail twice then succeed
      let callCount = 0;
      (tgtAdapter.storage.putObject as any).mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error("Transient error");
        }
        return makePutResult();
      });

      const config = makeConfig();
      const task = createStreamingTransfer(config, {
        sourceAdapter: srcAdapter,
        targetAdapter: tgtAdapter,
        maxRetries: 3,
        retryDelayMs: 10, // Fast retry for tests
      });

      const result = await task.start();
      expect(result.objectsTransferred).toBe(1);
      expect(result.objectsFailed).toBe(0);
    });

    it("records failures when all retries are exhausted", async () => {
      const objects = [{ key: "fail-me.txt", sizeBytes: 100 }];
      const srcAdapter = makeMockSourceAdapter(objects);
      const tgtAdapter = makeMockTargetAdapter();

      (tgtAdapter.storage.putObject as any).mockRejectedValue(new Error("Permanent failure"));

      const config = makeConfig();
      const task = createStreamingTransfer(config, {
        sourceAdapter: srcAdapter,
        targetAdapter: tgtAdapter,
        maxRetries: 1,
        retryDelayMs: 10,
      });

      const result = await task.start();
      expect(result.objectsFailed).toBe(1);
      expect(result.integrityReport.passed).toBe(false);
    });

    it("respects AbortSignal and throws on abort", async () => {
      const objects = [{ key: "aborted.txt", sizeBytes: 100 }];
      const srcAdapter = makeMockSourceAdapter(objects);
      const tgtAdapter = makeMockTargetAdapter();

      const controller = new AbortController();
      controller.abort(); // abort immediately

      const config = makeConfig();
      const task = createStreamingTransfer(config, {
        sourceAdapter: srcAdapter,
        targetAdapter: tgtAdapter,
      });

      await expect(task.start(controller.signal)).rejects.toThrow();
    });
  });

  // ===========================================================================
  // Multi-Part Upload Threshold
  // ===========================================================================

  describe("multi-part upload threshold", () => {
    it("uses single putObject for objects below threshold", async () => {
      const objects = [{ key: "small.txt", sizeBytes: 1024 }];
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
    });
  });

  // ===========================================================================
  // Storage Class Mapping
  // ===========================================================================

  describe("getStreamingStorageClassMappings", () => {
    it("maps AWS classes to Azure equivalents", () => {
      const mapping = getStreamingStorageClassMappings("aws", "azure", [
        "STANDARD",
        "STANDARD_IA",
        "GLACIER",
      ]);
      expect(mapping.STANDARD).toBe("Hot");
      expect(mapping.STANDARD_IA).toBe("Cool");
      expect(mapping.GLACIER).toBe("Archive");
    });

    it("maps GCP classes to AWS equivalents", () => {
      const mapping = getStreamingStorageClassMappings("gcp", "aws", [
        "STANDARD",
        "NEARLINE",
        "COLDLINE",
      ]);
      expect(mapping.STANDARD).toBe("STANDARD");
      expect(mapping.NEARLINE).toBe("STANDARD_IA");
      expect(mapping.COLDLINE).toBe("GLACIER");
    });

    it("returns input class when no mapping exists", () => {
      const mapping = getStreamingStorageClassMappings("aws", "aws", ["STANDARD"]);
      expect(mapping.STANDARD).toBe("STANDARD");
    });
  });

  // ===========================================================================
  // Progress Tracking
  // ===========================================================================

  describe("progress tracking", () => {
    it("initial progress is inventorying with zero counters", () => {
      const config = makeConfig();
      const task = createStreamingTransfer(config);
      const progress = task.getProgress();

      expect(progress.status).toBe("inventorying");
      expect(progress.objectsTransferred).toBe(0);
      expect(progress.bytesTransferred).toBe(0);
      expect(progress.objectsFailed).toBe(0);
    });

    it("progress shows complete after stub transfer", async () => {
      const config = makeConfig();
      const task = createStreamingTransfer(config);
      await task.start();

      const progress = task.getProgress();
      expect(progress.status).toBe("complete");
    });

    it("progress reflects transferred objects after real transfer", async () => {
      const objects = [
        { key: "a.bin", sizeBytes: 500 },
        { key: "b.bin", sizeBytes: 1500 },
      ];
      const srcAdapter = makeMockSourceAdapter(objects);
      const tgtAdapter = makeMockTargetAdapter();
      const config = makeConfig();

      const task = createStreamingTransfer(config, {
        sourceAdapter: srcAdapter,
        targetAdapter: tgtAdapter,
      });

      await task.start();
      const progress = task.getProgress();

      expect(progress.status).toBe("complete");
      expect(progress.objectsTotal).toBe(2);
      expect(progress.objectsTransferred).toBe(2);
      expect(progress.bytesTotal).toBe(2000);
    });
  });
});
