/**
 * Cross-Cloud Migration Engine — Integrity Verifier Tests
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

let sha256: typeof import("../src/core/integrity-verifier.js").sha256;
let verifyObjectIntegrity: typeof import("../src/core/integrity-verifier.js").verifyObjectIntegrity;
let verifyVolumeIntegrity: typeof import("../src/core/integrity-verifier.js").verifyVolumeIntegrity;
let verifySchemaIntegrity: typeof import("../src/core/integrity-verifier.js").verifySchemaIntegrity;
let createIntegrityReport: typeof import("../src/core/integrity-verifier.js").createIntegrityReport;

describe("integrity-verifier", () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../src/core/integrity-verifier.js");
    sha256 = mod.sha256;
    verifyObjectIntegrity = mod.verifyObjectIntegrity;
    verifyVolumeIntegrity = mod.verifyVolumeIntegrity;
    verifySchemaIntegrity = mod.verifySchemaIntegrity;
    createIntegrityReport = mod.createIntegrityReport;
    // Reset state to avoid diagnostics leaking
    const { resetPluginState } = await import("../src/state.js");
    resetPluginState();
  });

  describe("sha256", () => {
    it("returns a 64-char hex string", () => {
      const hash = sha256("hello world");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces consistent hashes", () => {
      expect(sha256("test")).toBe(sha256("test"));
    });

    it("produces different hashes for different inputs", () => {
      expect(sha256("a")).not.toBe(sha256("b"));
    });

    it("handles empty string", () => {
      const hash = sha256("");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("handles Buffer input", () => {
      const hash = sha256(Buffer.from("hello"));
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("verifyObjectIntegrity", () => {
    it("passes when all objects match", () => {
      const result = verifyObjectIntegrity({
        jobId: "j1",
        sourceObjects: [
          { key: "data/file.csv", sizeBytes: 1024, lastModified: "2024-01-01", sha256: "abc123", storageClass: "STANDARD", metadata: {} },
        ],
        targetObjects: [
          { key: "data/file.csv", sizeBytes: 1024, lastModified: "2024-01-01", sha256: "abc123", storageClass: "STANDARD", metadata: {} },
        ],
      });
      expect(result.passed).toBe(true);
    });

    it("fails when checksums differ", () => {
      const result = verifyObjectIntegrity({
        jobId: "j2",
        sourceObjects: [
          { key: "a.txt", sizeBytes: 100, lastModified: "2024-01-01", sha256: "aaa", storageClass: "STANDARD", metadata: {} },
        ],
        targetObjects: [
          { key: "a.txt", sizeBytes: 100, lastModified: "2024-01-01", sha256: "bbb", storageClass: "STANDARD", metadata: {} },
        ],
      });
      expect(result.passed).toBe(false);
    });

    it("fails when object count differs", () => {
      const result = verifyObjectIntegrity({
        jobId: "j3",
        sourceObjects: [
          { key: "a.txt", sizeBytes: 100, lastModified: "2024-01-01", storageClass: "STANDARD", metadata: {} },
          { key: "b.txt", sizeBytes: 200, lastModified: "2024-01-01", storageClass: "STANDARD", metadata: {} },
        ],
        targetObjects: [
          { key: "a.txt", sizeBytes: 100, lastModified: "2024-01-01", storageClass: "STANDARD", metadata: {} },
        ],
      });
      expect(result.passed).toBe(false);
    });
  });

  describe("verifyVolumeIntegrity", () => {
    it("passes when checksums and sizes match", () => {
      const result = verifyVolumeIntegrity({
        jobId: "j4",
        volumeId: "vol-001",
        sourceChecksum: "aaa",
        targetChecksum: "aaa",
        sourceSizeBytes: 1024,
        targetSizeBytes: 1024,
      });
      expect(result.passed).toBe(true);
    });

    it("fails on checksum mismatch", () => {
      const result = verifyVolumeIntegrity({
        jobId: "j5",
        volumeId: "vol-001",
        sourceChecksum: "aaa",
        targetChecksum: "bbb",
        sourceSizeBytes: 1024,
        targetSizeBytes: 1024,
      });
      expect(result.passed).toBe(false);
    });
  });

  describe("verifySchemaIntegrity", () => {
    it("passes for identical schemas", () => {
      const result = verifySchemaIntegrity({
        jobId: "j6",
        databaseId: "db-1",
        comparison: {
          tablesMatched: 1,
          tablesMissing: [],
          tablesExtra: [],
          rowCountDiffs: [],
          schemaDiffs: [],
          passed: true,
        },
      });
      expect(result.passed).toBe(true);
    });

    it("detects missing tables", () => {
      const result = verifySchemaIntegrity({
        jobId: "j7",
        databaseId: "db-2",
        comparison: {
          tablesMatched: 0,
          tablesMissing: ["users"],
          tablesExtra: [],
          rowCountDiffs: [],
          schemaDiffs: [],
          passed: false,
        },
      });
      expect(result.passed).toBe(false);
    });
  });

  describe("createIntegrityReport", () => {
    it("returns passed when all checks pass", () => {
      const report = createIntegrityReport({
        jobId: "job-1",
        resourceId: "r1",
        resourceType: "object-storage",
        level: "object-level",
        checks: [
          { name: "count-check", passed: true, expected: 10, actual: 10 },
        ],
      });
      expect(report.passed).toBe(true);
      expect(report.jobId).toBe("job-1");
      expect(report.checks.length).toBe(1);
    });

    it("returns failed when any check fails", () => {
      const report = createIntegrityReport({
        jobId: "job-2",
        resourceId: "r1",
        resourceType: "object-storage",
        level: "object-level",
        checks: [
          { name: "count-ok", passed: true, expected: 10, actual: 10 },
          { name: "checksum-fail", passed: false, expected: "aaa", actual: "bbb" },
        ],
      });
      expect(report.passed).toBe(false);
    });

    it("handles empty checks list", () => {
      const report = createIntegrityReport({
        jobId: "job-3",
        resourceId: "r1",
        resourceType: "vm",
        level: "volume-level",
        checks: [],
      });
      expect(report.passed).toBe(true);
      expect(report.checks.length).toBe(0);
    });
  });
});
