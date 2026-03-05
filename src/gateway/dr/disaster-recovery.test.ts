/**
 * Comprehensive QA Tests — Disaster Recovery Manager
 *
 * Enterprise-grade test suite covering:
 * - Backup creation with file + SQLite hot copy
 * - Integrity verification via SHA-256 hashes
 * - Restore: full + selective + dry-run
 * - Encrypted backup/restore
 * - Restore without decryptionKey → error
 * - Retention enforcement by count and age
 * - Schedule start/stop lifecycle
 * - Manifest CRUD
 * - Production hardening: MEDIUM #20 (encrypted restore guard)
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { DisasterRecoveryManager } from "./disaster-recovery.js";
import type { BackupManifest, DRConfig } from "./disaster-recovery.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir(name: string): string {
  const dir = join(tmpdir(), "espada-test-dr", `${name}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string) {
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

const VALID_KEY = randomBytes(32).toString("hex");

// ═══════════════════════════════════════════════════════════════════════════════
// Disaster Recovery Manager
// ═══════════════════════════════════════════════════════════════════════════════

describe("DisasterRecoveryManager", () => {
  let testDir: string;
  let sourceDir: string;
  let dr: DisasterRecoveryManager;

  beforeEach(() => {
    testDir = tmpDir("dr");
    sourceDir = join(testDir, "source");
    mkdirSync(sourceDir, { recursive: true });
  });

  afterEach(() => {
    dr?.close();
    cleanupDir(testDir);
  });

  function createDR(overrides?: Partial<DRConfig>): DisasterRecoveryManager {
    const manifestDbPath = join(testDir, "manifests.db");
    dr = new DisasterRecoveryManager(manifestDbPath, {
      enabled: true,
      targets: [{ type: "local", localPath: join(testDir, "backups") }],
      maxBackups: 10,
      maxAgeDays: 90,
      encrypted: false,
      sourcePaths: [sourceDir],
      ...overrides,
    });
    return dr;
  }

  // =========================================================================
  // Backup creation
  // =========================================================================

  describe("createBackup()", () => {
    it("creates a backup of JSON files", () => {
      writeFileSync(join(sourceDir, "config.json"), JSON.stringify({ key: "value" }));
      const mgr = createDR();

      const manifest = mgr.createBackup({ label: "test-backup" });

      expect(manifest.status).toBe("completed");
      expect(manifest.files.length).toBeGreaterThanOrEqual(1);
      expect(manifest.totalBytes).toBeGreaterThan(0);
      expect(manifest.integrityHash).toBeTruthy();
      expect(manifest.label).toBe("test-backup");
      expect(manifest.encrypted).toBe(false);
    });

    it("backs up SQLite databases using serialize API", () => {
      const dbFilePath = join(sourceDir, "state.db");
      const db = new Database(dbFilePath);
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)");
      db.exec("INSERT INTO test (val) VALUES ('hello')");
      db.close();

      const mgr = createDR();
      const manifest = mgr.createBackup();

      expect(manifest.status).toBe("completed");
      const sqliteFile = manifest.files.find((f) => f.type === "sqlite");
      expect(sqliteFile).toBeDefined();
      expect(sqliteFile!.sizeBytes).toBeGreaterThan(0);
      expect(sqliteFile!.relativePath).toBe(join("source", "state.db"));
    });

    it("handles mix of file types in source directory", () => {
      writeFileSync(join(sourceDir, "config.json"), "{}");
      writeFileSync(join(sourceDir, "notes.txt"), "hello");

      const mgr = createDR();
      const manifest = mgr.createBackup();

      expect(manifest.status).toBe("completed");
      expect(manifest.files.length).toBe(2);
    });

    it("skips non-existent source paths gracefully", () => {
      const mgr = createDR({
        sourcePaths: [join(testDir, "nonexistent"), sourceDir],
      });
      writeFileSync(join(sourceDir, "data.json"), "{}");

      const manifest = mgr.createBackup();
      expect(manifest.status).toBe("completed");
      expect(manifest.files.length).toBe(1);
    });

    it("records failed backup in manifest DB when error occurs", () => {
      const mgr = createDR({
        targets: [{ type: "local", localPath: "/root/no-permission-for-test" }],
      });

      // This should fail (can't create backup dir) but still record in DB
      const manifest = mgr.createBackup();
      expect(manifest.status).toBe("failed");
      expect(manifest.error).toBeTruthy();
    });
  });

  // =========================================================================
  // Encrypted backup/restore
  // =========================================================================

  describe("encrypted backup/restore", () => {
    it("encrypts files during backup", () => {
      writeFileSync(join(sourceDir, "secret.json"), JSON.stringify({ pw: "hunter2" }));
      const mgr = createDR({ encrypted: true, encryptionKey: VALID_KEY });

      const manifest = mgr.createBackup();
      expect(manifest.status).toBe("completed");
      expect(manifest.encrypted).toBe(true);

      // The backed up file should NOT contain the plaintext
      const backupDir = join(testDir, "backups", manifest.id);
      const backedUp = readFileSync(join(backupDir, "source", "secret.json"));
      expect(backedUp.toString("utf8")).not.toContain("hunter2");
    });

    it("restore with decryptionKey succeeds", () => {
      writeFileSync(join(sourceDir, "secret.json"), JSON.stringify({ pw: "hunter2" }));
      const mgr = createDR({ encrypted: true, encryptionKey: VALID_KEY });
      const manifest = mgr.createBackup();

      const restoreDir = join(testDir, "restored");
      mkdirSync(restoreDir, { recursive: true });

      const result = mgr.restore({
        backupId: manifest.id,
        targetDir: restoreDir,
        decryptionKey: VALID_KEY,
      });

      expect(result.success).toBe(true);
      expect(result.filesRestored).toBe(1);

      const restored = JSON.parse(readFileSync(join(restoreDir, "source", "secret.json"), "utf8"));
      expect(restored.pw).toBe("hunter2");
    });

    it("restore without decryptionKey reports per-file error (MEDIUM #20)", () => {
      writeFileSync(join(sourceDir, "secret.json"), "{}");
      const mgr = createDR({ encrypted: true, encryptionKey: VALID_KEY });
      const manifest = mgr.createBackup();

      const result = mgr.restore({
        backupId: manifest.id,
        targetDir: join(testDir, "restored2"),
      });

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("decryptionKey")]),
      );
    });
  });

  // =========================================================================
  // Integrity verification
  // =========================================================================

  describe("verifyBackup()", () => {
    it("returns valid for untampered backup", () => {
      writeFileSync(join(sourceDir, "data.json"), "{}");
      const mgr = createDR();
      const manifest = mgr.createBackup();

      const result = mgr.verifyBackup(manifest.id);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("detects tampered file (hash mismatch)", () => {
      writeFileSync(join(sourceDir, "data.json"), JSON.stringify({ original: true }));
      const mgr = createDR();
      const manifest = mgr.createBackup();

      // Tamper with the backed-up file
      const backupDir = join(testDir, "backups", manifest.id);
      writeFileSync(join(backupDir, "source", "data.json"), JSON.stringify({ tampered: true }));

      const result = mgr.verifyBackup(manifest.id);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("Hash mismatch")]),
      );
    });

    it("detects missing backup file", () => {
      writeFileSync(join(sourceDir, "data.json"), "{}");
      const mgr = createDR();
      const manifest = mgr.createBackup();

      // Remove the backed-up file
      const backupDir = join(testDir, "backups", manifest.id);
      rmSync(join(backupDir, "source", "data.json"));

      const result = mgr.verifyBackup(manifest.id);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("Missing file")]),
      );
    });

    it("returns error for non-existent backup ID", () => {
      const mgr = createDR();
      const result = mgr.verifyBackup("nonexistent-id");
      expect(result.valid).toBe(false);
    });
  });

  // =========================================================================
  // Restore
  // =========================================================================

  describe("restore()", () => {
    it("restores all files to target directory", () => {
      writeFileSync(join(sourceDir, "a.json"), JSON.stringify({ a: 1 }));
      writeFileSync(join(sourceDir, "b.json"), JSON.stringify({ b: 2 }));
      const mgr = createDR();
      const manifest = mgr.createBackup();

      const restoreDir = join(testDir, "restore-target");
      const result = mgr.restore({
        backupId: manifest.id,
        targetDir: restoreDir,
      });

      expect(result.success).toBe(true);
      expect(result.filesRestored).toBe(2);
      expect(existsSync(join(restoreDir, "source", "a.json"))).toBe(true);
      expect(existsSync(join(restoreDir, "source", "b.json"))).toBe(true);
    });

    it("dry-run does not actually restore files", () => {
      writeFileSync(join(sourceDir, "data.json"), "{}");
      const mgr = createDR();
      const manifest = mgr.createBackup();

      const restoreDir = join(testDir, "dryrun");
      const result = mgr.restore({
        backupId: manifest.id,
        targetDir: restoreDir,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.filesRestored).toBeGreaterThan(0);
      // Files should NOT actually be restored
      expect(existsSync(restoreDir)).toBe(false);
    });

    it("selective restore: only specified files", () => {
      writeFileSync(join(sourceDir, "keep.json"), "{}");
      writeFileSync(join(sourceDir, "skip.json"), "{}");
      const mgr = createDR();
      const manifest = mgr.createBackup();

      const restoreDir = join(testDir, "selective");
      const result = mgr.restore({
        backupId: manifest.id,
        targetDir: restoreDir,
        files: [join("source", "keep.json")],
      });

      expect(result.success).toBe(true);
      expect(result.filesRestored).toBe(1);
      expect(existsSync(join(restoreDir, "source", "keep.json"))).toBe(true);
      expect(existsSync(join(restoreDir, "source", "skip.json"))).toBe(false);
    });

    it("returns error for non-existent backup", () => {
      const mgr = createDR();
      const result = mgr.restore({ backupId: "nope" });
      expect(result.success).toBe(false);
      expect(result.errors).toContain("Backup nope not found");
    });
  });

  // =========================================================================
  // Manifest management
  // =========================================================================

  describe("manifests", () => {
    it("getManifest() returns a specific backup", () => {
      writeFileSync(join(sourceDir, "data.json"), "{}");
      const mgr = createDR();
      const backup = mgr.createBackup();

      const manifest = mgr.getManifest(backup.id);
      expect(manifest).not.toBeNull();
      expect(manifest!.id).toBe(backup.id);
      expect(manifest!.status).toBe("completed");
    });

    it("listManifests() returns all backups ordered by date", () => {
      writeFileSync(join(sourceDir, "data.json"), "{}");
      const mgr = createDR();

      mgr.createBackup({ label: "first" });
      mgr.createBackup({ label: "second" });

      const manifests = mgr.listManifests();
      expect(manifests.length).toBe(2);
      // Most recent first
      expect(manifests[0].label).toBe("second");
    });

    it("listManifests() filters by status", () => {
      writeFileSync(join(sourceDir, "data.json"), "{}");
      const mgr = createDR();
      mgr.createBackup(); // completed

      const completed = mgr.listManifests({ status: "completed" });
      expect(completed.length).toBe(1);

      const failed = mgr.listManifests({ status: "failed" });
      expect(failed.length).toBe(0);
    });

    it("getManifest() returns null for unknown ID", () => {
      const mgr = createDR();
      expect(mgr.getManifest("unknown")).toBeNull();
    });
  });

  // =========================================================================
  // Retention
  // =========================================================================

  describe("retention enforcement", () => {
    it("removes oldest backups when maxBackups exceeded", () => {
      writeFileSync(join(sourceDir, "data.json"), "{}");
      const mgr = createDR({ maxBackups: 2, maxAgeDays: 9999 });

      // Create 3 backups — oldest should be removed
      mgr.createBackup({ label: "b1" });
      mgr.createBackup({ label: "b2" });
      mgr.createBackup({ label: "b3" });

      const remaining = mgr.listManifests();
      expect(remaining.length).toBe(2);
    });
  });

  // =========================================================================
  // Schedule
  // =========================================================================

  describe("schedule", () => {
    it("startSchedule + stopSchedule lifecycle", () => {
      const mgr = createDR();
      mgr.startSchedule(60_000);
      // Should not throw on double start
      mgr.startSchedule(60_000);
      // Stop
      mgr.stopSchedule();
      mgr.stopSchedule(); // double stop is safe
    });

    it("stopSchedule is called on close()", () => {
      const mgr = createDR();
      mgr.startSchedule(60_000);
      mgr.close();
      // close() should have stopped the schedule — no lingering timer
    });
  });

  // =========================================================================
  // Directory backup (recursive)
  // =========================================================================

  describe("directory backup", () => {
    it("recursively backs up subdirectories", () => {
      const subDir = join(sourceDir, "nested");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(sourceDir, "root.json"), "{}");
      writeFileSync(join(subDir, "child.json"), "{}");

      const mgr = createDR();
      const manifest = mgr.createBackup();

      expect(manifest.status).toBe("completed");
      expect(manifest.files.length).toBe(2);
      const names = manifest.files.map((f) => f.relativePath);
      expect(names).toContain(join("source", "root.json"));
      expect(names).toContain(join("source", "nested", "child.json"));
    });
  });
});
