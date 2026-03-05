/**
 * Comprehensive QA Tests — Enterprise Configuration Validator
 *
 * Covers every validation rule in validateEnterpriseConfig:
 * - Cluster: address required, leaseTtlMs warning
 * - DR: encryptionKey hex + length, scheduleIntervalMs, maxBackups
 * - Audit: minSeverity enum, retentionDays
 * - Secrets: backend types, vault address, file path
 * - Drift: scanIntervalMs warning
 * - Task Queue: pollIntervalMs warning
 * - Cross-module: DR encryption without secrets manager
 * - Valid config → clean pass
 */

import { describe, it, expect } from "vitest";
import { validateEnterpriseConfig, type ValidationResult } from "./validate-config.js";
import type { EnterpriseConfig } from "./bootstrap.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function validConfig(overrides?: Partial<EnterpriseConfig>): EnterpriseConfig {
  return {
    cluster: { enabled: true, address: "127.0.0.1:6379" },
    dr: { enabled: true, encryptionKey: "a".repeat(64) },
    audit: { enabled: true },
    secrets: { enabled: true, backends: [{ type: "env" }] },
    drift: { enabled: true },
    taskQueue: { enabled: true },
    ...overrides,
  } as EnterpriseConfig;
}

function expectValid(result: ValidationResult) {
  expect(result.valid).toBe(true);
  expect(result.errors).toHaveLength(0);
}

function expectErrors(result: ValidationResult, ...substrings: string[]) {
  expect(result.valid).toBe(false);
  for (const s of substrings) {
    expect(result.errors.some((e) => e.includes(s))).toBe(true);
  }
}

function expectWarnings(result: ValidationResult, ...substrings: string[]) {
  for (const s of substrings) {
    expect(result.warnings.some((w) => w.includes(s))).toBe(true);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════

describe("validateEnterpriseConfig", () => {
  // ── Happy path ─────────────────────────────────────────────────────────────

  it("reports valid for a well-formed config", () => {
    const result = validateEnterpriseConfig(validConfig());
    expectValid(result);
  });

  it("reports valid when all modules are disabled", () => {
    const result = validateEnterpriseConfig({
      cluster: { enabled: false },
      dr: { enabled: false },
      audit: { enabled: false },
      secrets: { enabled: false },
      drift: { enabled: false },
      taskQueue: { enabled: false },
    } as EnterpriseConfig);
    expectValid(result);
  });

  // ── Cluster ────────────────────────────────────────────────────────────────

  describe("cluster", () => {
    it("errors when cluster.enabled but no address", () => {
      const result = validateEnterpriseConfig(validConfig({ cluster: { enabled: true } as any }));
      expectErrors(result, "cluster.address");
    });

    it("warns on leaseTtlMs < 1000", () => {
      const result = validateEnterpriseConfig(
        validConfig({
          cluster: { enabled: true, address: "127.0.0.1:6379", leaseTtlMs: 500 },
        } as any),
      );
      expectWarnings(result, "leaseTtlMs");
    });
  });

  // ── Disaster Recovery ──────────────────────────────────────────────────────

  describe("disaster recovery", () => {
    it("errors when encryptionKey is not 64 hex chars", () => {
      const result = validateEnterpriseConfig(
        validConfig({ dr: { enabled: true, encryptionKey: "tooshort" } } as any),
      );
      expectErrors(result, "64 hex chars");
    });

    it("errors when encryptionKey is 64 chars but not hex", () => {
      const key = "g".repeat(64); // 'g' is not a hex digit
      const result = validateEnterpriseConfig(
        validConfig({ dr: { enabled: true, encryptionKey: key } } as any),
      );
      expectErrors(result, "hexadecimal");
    });

    it("warns on scheduleIntervalMs < 60s", () => {
      const result = validateEnterpriseConfig(
        validConfig({
          dr: { enabled: true, encryptionKey: "a".repeat(64), scheduleIntervalMs: 30_000 },
        } as any),
      );
      expectWarnings(result, "scheduleIntervalMs");
    });

    it("errors when maxBackups < 1", () => {
      const result = validateEnterpriseConfig(
        validConfig({
          dr: { enabled: true, encryptionKey: "a".repeat(64), maxBackups: 0 },
        } as any),
      );
      expectErrors(result, "maxBackups");
    });
  });

  // ── Audit ──────────────────────────────────────────────────────────────────

  describe("audit", () => {
    it("errors on invalid minSeverity", () => {
      const result = validateEnterpriseConfig(
        validConfig({ audit: { enabled: true, minSeverity: "debug" } } as any),
      );
      expectErrors(result, "minSeverity");
    });

    it("accepts valid minSeverity values", () => {
      for (const severity of ["info", "warn", "error", "critical"]) {
        const result = validateEnterpriseConfig(
          validConfig({ audit: { enabled: true, minSeverity: severity } } as any),
        );
        expect(result.errors.some((e) => e.includes("minSeverity"))).toBe(false);
      }
    });

    it("errors on retentionDays < 0", () => {
      const result = validateEnterpriseConfig(
        validConfig({ audit: { enabled: true, retentionDays: -1 } } as any),
      );
      expectErrors(result, "retentionDays");
    });
  });

  // ── Secrets ────────────────────────────────────────────────────────────────

  describe("secrets", () => {
    it("errors on invalid backend type", () => {
      const result = validateEnterpriseConfig(
        validConfig({
          secrets: { enabled: true, backends: [{ type: "redis" }] },
        } as any),
      );
      expectErrors(result, "backends[0].type");
    });

    it("errors when vault backend has no vault.address", () => {
      const result = validateEnterpriseConfig(
        validConfig({
          secrets: { enabled: true, backends: [{ type: "vault" }] },
        } as any),
      );
      expectErrors(result, "vault.address");
    });

    it("errors when file backend has no file.path", () => {
      const result = validateEnterpriseConfig(
        validConfig({
          secrets: { enabled: true, backends: [{ type: "file" }] },
        } as any),
      );
      expectErrors(result, "file.path");
    });

    it("accepts valid vault backend with address", () => {
      const result = validateEnterpriseConfig(
        validConfig({
          secrets: {
            enabled: true,
            backends: [{ type: "vault", vault: { address: "http://vault:8200" } }],
          },
        } as any),
      );
      expect(result.errors.some((e) => e.includes("vault.address"))).toBe(false);
    });
  });

  // ── Drift ──────────────────────────────────────────────────────────────────

  describe("drift", () => {
    it("warns on scanIntervalMs < 10s", () => {
      const result = validateEnterpriseConfig(
        validConfig({ drift: { enabled: true, scanIntervalMs: 5000 } } as any),
      );
      expectWarnings(result, "scanIntervalMs");
    });
  });

  // ── Task Queue ─────────────────────────────────────────────────────────────

  describe("task queue", () => {
    it("warns on pollIntervalMs < 100ms", () => {
      const result = validateEnterpriseConfig(
        validConfig({ taskQueue: { enabled: true, pollIntervalMs: 50 } } as any),
      );
      expectWarnings(result, "pollIntervalMs");
    });
  });

  // ── Cross-module dependencies ──────────────────────────────────────────────

  describe("cross-module", () => {
    it("warns when DR encryption enabled but secrets manager disabled", () => {
      const result = validateEnterpriseConfig({
        dr: { enabled: true, encryptionKey: "a".repeat(64) },
        secrets: { enabled: false },
      } as EnterpriseConfig);
      expectWarnings(result, "secrets manager is disabled");
    });

    it("no cross-module warning when both DR and secrets are enabled", () => {
      const result = validateEnterpriseConfig(
        validConfig({
          dr: { enabled: true, encryptionKey: "a".repeat(64) },
          secrets: { enabled: true, backends: [{ type: "env" }] },
        } as any),
      );
      expect(result.warnings.some((w) => w.includes("secrets manager is disabled"))).toBe(false);
    });
  });
});
