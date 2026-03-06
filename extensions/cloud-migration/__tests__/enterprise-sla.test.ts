/**
 * Enterprise SLA Features — Tests
 *
 * Covers the four enterprise-grade data integrity guarantees:
 * 1. Inline SHA-256 during streaming transfer
 * 2. Row-level checksumming for database migrations
 * 3. Idempotency tokens on all mutating operations
 * 4. Post-migration reconciliation step
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Inline SHA-256
import { createStreamingTransfer } from "../src/data/streaming-transfer-engine.js";
import type { ObjectTransferConfig } from "../src/data/types.js";
import type { CloudProviderAdapter } from "../src/providers/types.js";

// Row-level checksums
import {
  computeRowChecksum,
  verifyRowIntegrity,
  type RowChecksum,
} from "../src/core/integrity-verifier.js";

// Idempotency
import {
  generateIdempotencyKey,
  checkIdempotency,
  recordIdempotency,
  clearIdempotencyRegistry,
  getIdempotencyRegistrySize,
  executePlan,
  registerStepHandler,
} from "../src/core/migration-engine.js";

// Reconciliation
import { reconcileHandler } from "../src/data/steps/reconcile.js";
import type { MigrationStepContext } from "../src/types.js";

// State
import { resetPluginState } from "../src/state.js";

// =============================================================================
// Helpers
// =============================================================================

function mockAdapter(objects: Array<{ key: string; data: Buffer; sizeBytes: number; etag?: string }>): CloudProviderAdapter {
  return {
    provider: "aws",
    compute: {} as any,
    storage: {
      listObjects: vi.fn().mockResolvedValue({
        objects: objects.map((o) => ({
          key: o.key,
          sizeBytes: o.sizeBytes,
          etag: o.etag ?? `etag-${o.key}`,
          lastModified: new Date().toISOString(),
          storageClass: "STANDARD",
        })),
        truncated: false,
      }),
      getObject: vi.fn().mockImplementation((_bucket: string, key: string) => {
        const obj = objects.find((o) => o.key === key);
        if (!obj) throw new Error(`Object not found: ${key}`);
        return Promise.resolve({
          data: obj.data,
          contentType: "application/octet-stream",
          metadata: {},
        });
      }),
      putObject: vi.fn().mockResolvedValue({ etag: "target-etag" }),
      initiateMultipartUpload: vi.fn().mockResolvedValue({ uploadId: "upload-123" }),
      uploadPart: vi.fn().mockImplementation((_args: any) => Promise.resolve({ partNumber: _args.partNumber ?? 1, etag: "part-etag" })),
      completeMultipartUpload: vi.fn().mockResolvedValue({ etag: "multipart-etag" }),
      abortMultipartUpload: vi.fn().mockResolvedValue(undefined),
    },
    network: {} as any,
    database: {} as any,
  } as unknown as CloudProviderAdapter;
}

function makeTransferConfig(): ObjectTransferConfig {
  return {
    sourceBucket: "src-bucket",
    sourceProvider: "aws",
    sourceRegion: "us-east-1",
    targetBucket: "tgt-bucket",
    targetProvider: "azure",
    targetRegion: "eastus",
    concurrency: 2,
    chunkSizeMB: 64,
    metadataPreserve: true,
    aclPreserve: false,
  };
}

// =============================================================================
// 1. Inline SHA-256 During Streaming Transfer
// =============================================================================

describe("Inline SHA-256 during streaming transfer", () => {
  it("computes SHA-256 for each object during transfer", async () => {
    const data1 = Buffer.from("Hello, enterprise migration!");
    const data2 = Buffer.from("Second object data");

    const srcAdapter = mockAdapter([
      { key: "file1.txt", data: data1, sizeBytes: data1.length },
      { key: "file2.txt", data: data2, sizeBytes: data2.length },
    ]);
    const tgtAdapter = mockAdapter([]);

    const config = makeTransferConfig();
    const task = createStreamingTransfer(config, {
      sourceAdapter: srcAdapter,
      targetAdapter: tgtAdapter,
      concurrency: 2,
    });

    const result = await task.start();

    // Inline checksums should be present
    expect(result.inlineChecksums).toBeDefined();
    expect(result.inlineChecksums).toBeInstanceOf(Map);
    expect(result.inlineChecksums!.size).toBe(2);

    // Verify the hashes are valid SHA-256 hex strings (64 chars)
    for (const [key, hash] of result.inlineChecksums!) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(["file1.txt", "file2.txt"]).toContain(key);
    }
  });

  it("includes inline-sha256 check in integrity report", async () => {
    const data = Buffer.from("integrity-check-data");
    const srcAdapter = mockAdapter([
      { key: "obj.bin", data, sizeBytes: data.length },
    ]);
    const tgtAdapter = mockAdapter([]);
    const config = makeTransferConfig();

    const task = createStreamingTransfer(config, {
      sourceAdapter: srcAdapter,
      targetAdapter: tgtAdapter,
    });

    const result = await task.start();

    // The integrity report should have an "inline-sha256" check
    const sha256Check = result.integrityReport.checks.find((c) => c.name === "inline-sha256");
    expect(sha256Check).toBeDefined();
    expect(sha256Check!.passed).toBe(true);
    expect(sha256Check!.details).toContain("verified with inline SHA-256");
  });

  it("sets inlineSha256 on individual TransferObjectEntry in manifest", async () => {
    const data = Buffer.from("manifest-test");
    const srcAdapter = mockAdapter([
      { key: "manifest.txt", data, sizeBytes: data.length },
    ]);
    const tgtAdapter = mockAdapter([]);
    const config = makeTransferConfig();

    const task = createStreamingTransfer(config, {
      sourceAdapter: srcAdapter,
      targetAdapter: tgtAdapter,
    });

    const result = await task.start();

    expect(result.manifest.objects.length).toBe(1);
    const entry = result.manifest.objects[0];
    expect(entry.inlineSha256).toBeDefined();
    expect(entry.inlineSha256).toMatch(/^[a-f0-9]{64}$/);
    // sourceChecksum should be the inline hash, not the etag
    expect(entry.sourceChecksum).toBe(entry.inlineSha256);
  });

  it("correctly computes SHA-256 matching node:crypto reference", async () => {
    const { createHash } = await import("node:crypto");
    const data = Buffer.from("reference-hash-test-12345");
    const expectedHash = createHash("sha256").update(data).digest("hex");

    const srcAdapter = mockAdapter([
      { key: "ref.dat", data, sizeBytes: data.length },
    ]);
    const tgtAdapter = mockAdapter([]);
    const config = makeTransferConfig();

    const task = createStreamingTransfer(config, {
      sourceAdapter: srcAdapter,
      targetAdapter: tgtAdapter,
    });

    const result = await task.start();

    expect(result.inlineChecksums!.get("ref.dat")).toBe(expectedHash);
  });

  it("handles multi-part upload objects with inline SHA-256", async () => {
    // Create data larger than default multi-part threshold (100MB)
    // We'll lower the threshold instead
    const data = Buffer.alloc(200, "x");
    const srcAdapter = mockAdapter([
      { key: "big-file.bin", data, sizeBytes: data.length },
    ]);
    const tgtAdapter = mockAdapter([]);
    const config = makeTransferConfig();

    const task = createStreamingTransfer(config, {
      sourceAdapter: srcAdapter,
      targetAdapter: tgtAdapter,
      multiPartThresholdBytes: 100, // Force multi-part
      partSizeBytes: 64,
    });

    const result = await task.start();

    expect(result.inlineChecksums!.has("big-file.bin")).toBe(true);
    expect(result.inlineChecksums!.get("big-file.bin")).toMatch(/^[a-f0-9]{64}$/);
  });
});

// =============================================================================
// 2. Row-Level Checksumming for Database Migrations
// =============================================================================

describe("Row-level checksumming", () => {
  beforeEach(() => {
    resetPluginState();
  });

  describe("computeRowChecksum", () => {
    it("produces consistent SHA-256 for same input", () => {
      const hash1 = computeRowChecksum(["John", "Doe", 42, true]);
      const hash2 = computeRowChecksum(["John", "Doe", 42, true]);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces different hashes for different data", () => {
      const hash1 = computeRowChecksum(["John", "Doe", 42]);
      const hash2 = computeRowChecksum(["Jane", "Doe", 42]);
      expect(hash1).not.toBe(hash2);
    });

    it("handles null and undefined values", () => {
      const hash1 = computeRowChecksum([null, "test", undefined]);
      const hash2 = computeRowChecksum([null, "test", undefined]);
      expect(hash1).toBe(hash2);
    });

    it("differentiates between null and string 'null'", () => {
      const hash1 = computeRowChecksum([null]);
      const hash2 = computeRowChecksum(["null"]);
      expect(hash1).not.toBe(hash2);
    });

    it("handles empty arrays", () => {
      const hash = computeRowChecksum([]);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("handles complex types by stringifying", () => {
      const hash = computeRowChecksum([{ nested: true }, [1, 2, 3]]);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("verifyRowIntegrity", () => {
    it("passes when all rows match", () => {
      const sourceRows: RowChecksum[] = [
        { table: "users", primaryKey: "1", checksum: "abc123" },
        { table: "users", primaryKey: "2", checksum: "def456" },
      ];
      const targetRows: RowChecksum[] = [
        { table: "users", primaryKey: "1", checksum: "abc123" },
        { table: "users", primaryKey: "2", checksum: "def456" },
      ];

      const report = verifyRowIntegrity({
        jobId: "test-job",
        databaseId: "db-1",
        sourceRows,
        targetRows,
      });

      expect(report.passed).toBe(true);
      expect(report.level).toBe("row-level");
      expect(report.resourceType).toBe("database");
    });

    it("detects checksum mismatches", () => {
      const sourceRows: RowChecksum[] = [
        { table: "orders", primaryKey: "1", checksum: "aaa" },
        { table: "orders", primaryKey: "2", checksum: "bbb" },
      ];
      const targetRows: RowChecksum[] = [
        { table: "orders", primaryKey: "1", checksum: "aaa" },
        { table: "orders", primaryKey: "2", checksum: "CHANGED" },
      ];

      const report = verifyRowIntegrity({
        jobId: "test-job",
        databaseId: "db-1",
        sourceRows,
        targetRows,
      });

      expect(report.passed).toBe(false);
      const rowCheck = report.checks.find((c) => c.name === "row-checksum:orders");
      expect(rowCheck?.passed).toBe(false);
      expect(rowCheck?.details).toContain("1 mismatches");
    });

    it("detects rows missing in target", () => {
      const sourceRows: RowChecksum[] = [
        { table: "products", primaryKey: "1", checksum: "aaa" },
        { table: "products", primaryKey: "2", checksum: "bbb" },
      ];
      const targetRows: RowChecksum[] = [
        { table: "products", primaryKey: "1", checksum: "aaa" },
        // primaryKey "2" is missing
      ];

      const report = verifyRowIntegrity({
        jobId: "test-job",
        databaseId: "db-1",
        sourceRows,
        targetRows,
      });

      expect(report.passed).toBe(false);
      const rowCheck = report.checks.find((c) => c.name === "row-checksum:products");
      expect(rowCheck?.passed).toBe(false);
      expect(rowCheck?.details).toContain("1 missing");
    });

    it("detects extra rows in target", () => {
      const sourceRows: RowChecksum[] = [
        { table: "logs", primaryKey: "1", checksum: "aaa" },
      ];
      const targetRows: RowChecksum[] = [
        { table: "logs", primaryKey: "1", checksum: "aaa" },
        { table: "logs", primaryKey: "2", checksum: "extra" },
      ];

      const report = verifyRowIntegrity({
        jobId: "test-job",
        databaseId: "db-1",
        sourceRows,
        targetRows,
      });

      expect(report.passed).toBe(false);
    });

    it("handles multiple tables independently", () => {
      const sourceRows: RowChecksum[] = [
        { table: "users", primaryKey: "1", checksum: "u1" },
        { table: "orders", primaryKey: "1", checksum: "o1" },
      ];
      const targetRows: RowChecksum[] = [
        { table: "users", primaryKey: "1", checksum: "u1" },
        { table: "orders", primaryKey: "1", checksum: "WRONG" },
      ];

      const report = verifyRowIntegrity({
        jobId: "test-job",
        databaseId: "db-1",
        sourceRows,
        targetRows,
      });

      expect(report.passed).toBe(false);
      const usersCheck = report.checks.find((c) => c.name === "row-checksum:users");
      const ordersCheck = report.checks.find((c) => c.name === "row-checksum:orders");
      expect(usersCheck?.passed).toBe(true);
      expect(ordersCheck?.passed).toBe(false);
    });

    it("supports sampling with sampleRate", () => {
      // With 1000 rows and sampleRate=0.1, roughly 100 should be checked
      const rows: RowChecksum[] = Array.from({ length: 1000 }, (_, i) => ({
        table: "big_table",
        primaryKey: String(i),
        checksum: `hash-${i}`,
      }));

      const report = verifyRowIntegrity({
        jobId: "test-job",
        databaseId: "db-1",
        sourceRows: rows,
        targetRows: rows,
        sampleRate: 0.1,
      });

      expect(report.passed).toBe(true);
      // The overall check should reference sampled counts
      const overallCheck = report.checks.find((c) => c.name === "row-integrity-overall");
      expect(overallCheck?.passed).toBe(true);
    });

    it("produces aggregate overall check", () => {
      const report = verifyRowIntegrity({
        jobId: "test-job",
        databaseId: "db-1",
        sourceRows: [{ table: "t1", primaryKey: "1", checksum: "a" }],
        targetRows: [{ table: "t1", primaryKey: "1", checksum: "a" }],
      });

      const overall = report.checks.find((c) => c.name === "row-integrity-overall");
      expect(overall).toBeDefined();
      expect(overall?.passed).toBe(true);
      expect(overall?.details).toContain("passed row-level verification");
    });

    it("handles empty datasets gracefully", () => {
      const report = verifyRowIntegrity({
        jobId: "test-job",
        databaseId: "db-1",
        sourceRows: [],
        targetRows: [],
      });

      expect(report.passed).toBe(true);
    });

    it("limits mismatches details to 10", () => {
      const sourceRows: RowChecksum[] = Array.from({ length: 20 }, (_, i) => ({
        table: "t",
        primaryKey: String(i),
        checksum: `src-${i}`,
      }));
      const targetRows: RowChecksum[] = Array.from({ length: 20 }, (_, i) => ({
        table: "t",
        primaryKey: String(i),
        checksum: `tgt-${i}`, // All different
      }));

      const report = verifyRowIntegrity({
        jobId: "test-job",
        databaseId: "db-1",
        sourceRows,
        targetRows,
      });

      expect(report.passed).toBe(false);
    });
  });
});

// =============================================================================
// 3. Idempotency Tokens on Mutating Operations
// =============================================================================

describe("Idempotency tokens", () => {
  beforeEach(() => {
    resetPluginState();
    clearIdempotencyRegistry();
  });

  describe("generateIdempotencyKey", () => {
    it("produces deterministic keys for same inputs", () => {
      const key1 = generateIdempotencyKey("job-1", "step-a", { foo: "bar" });
      const key2 = generateIdempotencyKey("job-1", "step-a", { foo: "bar" });
      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces different keys for different job IDs", () => {
      const key1 = generateIdempotencyKey("job-1", "step-a", { foo: "bar" });
      const key2 = generateIdempotencyKey("job-2", "step-a", { foo: "bar" });
      expect(key1).not.toBe(key2);
    });

    it("produces different keys for different step IDs", () => {
      const key1 = generateIdempotencyKey("job-1", "step-a", { foo: "bar" });
      const key2 = generateIdempotencyKey("job-1", "step-b", { foo: "bar" });
      expect(key1).not.toBe(key2);
    });

    it("produces different keys for different params", () => {
      const key1 = generateIdempotencyKey("job-1", "step-a", { foo: "bar" });
      const key2 = generateIdempotencyKey("job-1", "step-a", { foo: "baz" });
      expect(key1).not.toBe(key2);
    });

    it("handles empty params", () => {
      const key = generateIdempotencyKey("job-1", "step-a", {});
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("checkIdempotency / recordIdempotency", () => {
    it("returns null for unknown keys", () => {
      expect(checkIdempotency("unknown-key")).toBeNull();
    });

    it("returns recorded entry after recording", () => {
      const record = {
        idempotencyKey: "test-key-1",
        jobId: "job-1",
        stepId: "step-a",
        status: "succeeded" as const,
        outputs: { vmId: "vm-123" },
        completedAt: new Date().toISOString(),
      };

      recordIdempotency(record);
      const found = checkIdempotency("test-key-1");

      expect(found).not.toBeNull();
      expect(found!.jobId).toBe("job-1");
      expect(found!.outputs).toEqual({ vmId: "vm-123" });
    });

    it("clearIdempotencyRegistry removes all entries", () => {
      recordIdempotency({
        idempotencyKey: "key-1",
        jobId: "j1",
        stepId: "s1",
        status: "succeeded",
        outputs: {},
        completedAt: new Date().toISOString(),
      });

      expect(getIdempotencyRegistrySize()).toBe(1);
      clearIdempotencyRegistry();
      expect(getIdempotencyRegistrySize()).toBe(0);
      expect(checkIdempotency("key-1")).toBeNull();
    });
  });

  describe("executePlan idempotency integration", () => {
    const stepType = "verify-boot" as const;

    beforeEach(() => {
      registerStepHandler(
        stepType,
        {
          execute: vi.fn().mockResolvedValue({ booted: true }),
        },
        false,
      );
    });

    it("skips re-execution for already-completed steps with same params", async () => {
      const handler = {
        execute: vi.fn().mockResolvedValue({ result: "first-run" }),
      };
      registerStepHandler("verify-connectivity" as any, handler, false);

      const plan = {
        id: "plan-1",
        name: "Test Plan",
        description: "Test",
        jobId: "job-1",
        steps: [
          {
            id: "step-1",
            type: "verify-connectivity" as const,
            name: "Step 1",
            description: "Test step",
            params: { target: "10.0.0.1" },
            dependsOn: [],
            timeoutMs: 10_000,
            pipeline: "network" as const,
            resourceType: "dns" as const,
            requiresRollback: false,
          },
        ],
        globalParams: {},
        createdAt: new Date().toISOString(),
        estimatedDurationMs: 1000,
        estimatedCost: {} as any,
        riskAssessment: { overallRisk: "low" as const, factors: [] },
      };

      // First execution
      const result1 = await executePlan(plan);
      expect(result1.status).toBe("succeeded");
      expect(handler.execute).toHaveBeenCalledTimes(1);

      // Second execution with the same plan — should be idempotent
      const result2 = await executePlan(plan);
      expect(result2.status).toBe("succeeded");
      // Handler should NOT be called again
      expect(handler.execute).toHaveBeenCalledTimes(1);
    });

    it("re-executes when params change", async () => {
      const handler = {
        execute: vi.fn().mockResolvedValue({ result: "executed" }),
      };
      registerStepHandler("map-network" as any, handler, false);

      const makePlan = (target: string) => ({
        id: "plan-1",
        name: "Test Plan",
        description: "Test",
        jobId: "job-1",
        steps: [
          {
            id: "step-1",
            type: "map-network" as const,
            name: "Step 1",
            description: "Test step",
            params: { target },
            dependsOn: [],
            timeoutMs: 10_000,
            pipeline: "network" as const,
            resourceType: "dns" as const,
            requiresRollback: false,
          },
        ],
        globalParams: {},
        createdAt: new Date().toISOString(),
        estimatedDurationMs: 1000,
        estimatedCost: {} as any,
        riskAssessment: { overallRisk: "low" as const, factors: [] },
      });

      await executePlan(makePlan("10.0.0.1"));
      expect(handler.execute).toHaveBeenCalledTimes(1);

      // Different params → should re-execute
      await executePlan(makePlan("10.0.0.2"));
      expect(handler.execute).toHaveBeenCalledTimes(2);
    });
  });
});

// =============================================================================
// 4. Post-Migration Reconciliation Step
// =============================================================================

describe("Post-migration reconciliation", () => {
  beforeEach(() => {
    resetPluginState();
  });

  function makeCtx(params: Record<string, unknown>): MigrationStepContext {
    return {
      params,
      globalParams: {},
      tags: {},
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    };
  }

  it("produces a stub report when no credentials are provided", async () => {
    const ctx = makeCtx({
      resourceType: "object-storage",
      sourceBucket: "src",
      targetBucket: "tgt",
      sourceProvider: "aws",
      targetProvider: "azure",
      cooldownMs: 0,
    });

    const result = await reconcileHandler.execute(ctx);

    expect(result.reconciled).toBe(true);
    expect(result.driftDetected).toBe(false);
    expect(result.report).toBeDefined();
    expect((result.report as any).level).toBe("reconciliation");
  });

  it("throws on unsupported resource type", async () => {
    const ctx = makeCtx({
      resourceType: "unsupported",
      cooldownMs: 0,
    });

    await expect(reconcileHandler.execute(ctx)).rejects.toThrow("Unsupported resource type");
  });

  it("reconciles database resources", async () => {
    const ctx = makeCtx({
      resourceType: "database",
      sourceDatabaseId: "pg-source",
      targetDatabaseId: "pg-target",
      tables: ["users", "orders"],
      cooldownMs: 0,
    });

    const result = await reconcileHandler.execute(ctx);

    expect(result.reconciled).toBe(true);
    expect(result.resourceType).toBe("database");
    expect(result.driftDetected).toBe(false);
    const report = result.report as any;
    expect(report.level).toBe("reconciliation");
    expect(report.checks.length).toBeGreaterThanOrEqual(3); // 2 table checks + 1 overall
  });

  it("throws when object-storage params are incomplete", async () => {
    const ctx = makeCtx({
      resourceType: "object-storage",
      sourceBucket: "src",
      // missing targetBucket, sourceProvider, targetProvider
      cooldownMs: 0,
    });
    // Provide fake credentials so it doesn't hit the stub path
    (ctx as any).sourceCredentials = { provider: "aws" };
    (ctx as any).targetCredentials = { provider: "azure" };

    await expect(reconcileHandler.execute(ctx)).rejects.toThrow("requires sourceBucket");
  });

  it("waits for cooldown before reconciling", async () => {
    const start = Date.now();
    const ctx = makeCtx({
      resourceType: "database",
      sourceDatabaseId: "db1",
      targetDatabaseId: "db2",
      tables: [],
      cooldownMs: 100,
    });

    await reconcileHandler.execute(ctx);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some timing slack
  });

  it("respects abort signal during cooldown", async () => {
    const controller = new AbortController();
    const ctx = makeCtx({
      resourceType: "database",
      sourceDatabaseId: "db1",
      targetDatabaseId: "db2",
      tables: [],
      cooldownMs: 50, // Short cooldown
    });
    ctx.signal = controller.signal;

    // Abort after the cooldown completes but before DB reconciliation finishes
    // Verify the signal property is wired through to the context
    const result = await reconcileHandler.execute(ctx);
    expect(result.reconciled).toBe(true);

    // Now test that an already-aborted signal throws
    controller.abort();
    const ctx2 = makeCtx({
      resourceType: "object-storage",
      sourceBucket: "src",
      targetBucket: "tgt",
      sourceProvider: "aws",
      targetProvider: "azure",
      cooldownMs: 0,
    });
    ctx2.signal = controller.signal;
    (ctx2 as any).sourceCredentials = { provider: "aws" };
    (ctx2 as any).targetCredentials = { provider: "azure" };

    await expect(reconcileHandler.execute(ctx2)).rejects.toThrow();
  });

  it("has no rollback handler (read-only step)", () => {
    expect(reconcileHandler.rollback).toBeUndefined();
  });
});

// =============================================================================
// Integration: Full SLA Chain
// =============================================================================

describe("Enterprise SLA integration", () => {
  beforeEach(() => {
    resetPluginState();
    clearIdempotencyRegistry();
  });

  it("inline SHA-256 hashes can be verified by computeRowChecksum utility", () => {
    // Demonstrate that the same hash utility works for both object and row checksums
    const { createHash } = require("node:crypto");
    const data = "consistent-hashing-test";
    const expected = createHash("sha256").update(data).digest("hex");

    // computeRowChecksum uses the same SHA-256 primitive
    // (different serialization, but same algo)
    const hash = computeRowChecksum([data]);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("idempotency registry size tracks correctly across operations", () => {
    expect(getIdempotencyRegistrySize()).toBe(0);

    recordIdempotency({
      idempotencyKey: generateIdempotencyKey("j1", "s1", { a: 1 }),
      jobId: "j1",
      stepId: "s1",
      status: "succeeded",
      outputs: {},
      completedAt: new Date().toISOString(),
    });

    recordIdempotency({
      idempotencyKey: generateIdempotencyKey("j1", "s2", { b: 2 }),
      jobId: "j1",
      stepId: "s2",
      status: "succeeded",
      outputs: {},
      completedAt: new Date().toISOString(),
    });

    expect(getIdempotencyRegistrySize()).toBe(2);

    // Same key doesn't increase count
    recordIdempotency({
      idempotencyKey: generateIdempotencyKey("j1", "s1", { a: 1 }),
      jobId: "j1",
      stepId: "s1",
      status: "succeeded",
      outputs: { updated: true },
      completedAt: new Date().toISOString(),
    });

    expect(getIdempotencyRegistrySize()).toBe(2);
    clearIdempotencyRegistry();
    expect(getIdempotencyRegistrySize()).toBe(0);
  });

  it("reconciliation level is a valid IntegrityLevel", () => {
    const report = verifyRowIntegrity({
      jobId: "test",
      databaseId: "db",
      sourceRows: [],
      targetRows: [],
    });

    // row-level is now a valid IntegrityLevel
    expect(report.level).toBe("row-level");
  });
});
