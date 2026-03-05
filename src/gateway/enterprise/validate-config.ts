/**
 * Enterprise Configuration Validator
 *
 * Runs before bootstrapEnterprise() to surface misconfiguration early.
 * Validates required fields, enum values, and cross-module dependencies.
 * Returns structured diagnostics — does NOT throw.
 *
 */

import type { EnterpriseConfig } from "./bootstrap.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("enterprise").child("config-validate");

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate the enterprise configuration object.
 * Each rule logs its finding and appends to errors/warnings.
 */
export function validateEnterpriseConfig(config: EnterpriseConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Cluster ────────────────────────────────────────────────
  if (config.cluster?.enabled) {
    if (!config.cluster.address) {
      errors.push("cluster.enabled requires cluster.address (host:port)");
    }
    if (config.cluster.leaseTtlMs !== undefined && config.cluster.leaseTtlMs < 1000) {
      warnings.push("cluster.leaseTtlMs < 1000ms may cause excessive leader elections");
    }
  }

  // ── Disaster Recovery ──────────────────────────────────────
  if (config.dr?.enabled) {
    if (config.dr.encryptionKey) {
      const keyLen = config.dr.encryptionKey.length;
      if (keyLen !== 64) {
        errors.push(`dr.encryptionKey must be 64 hex chars (32 bytes), got ${keyLen}`);
      } else if (!/^[0-9a-fA-F]+$/.test(config.dr.encryptionKey)) {
        errors.push("dr.encryptionKey must be valid hexadecimal");
      }
    }
    if (config.dr.scheduleIntervalMs !== undefined && config.dr.scheduleIntervalMs < 60_000) {
      warnings.push("dr.scheduleIntervalMs < 60s is aggressive for production");
    }
    if (config.dr.maxBackups !== undefined && config.dr.maxBackups < 1) {
      errors.push("dr.maxBackups must be >= 1");
    }
  }

  // ── Audit ──────────────────────────────────────────────────
  if (config.audit?.enabled) {
    const validSeverities = new Set(["info", "warn", "error", "critical"]);
    if (config.audit.minSeverity && !validSeverities.has(config.audit.minSeverity)) {
      errors.push(
        `audit.minSeverity must be one of: ${[...validSeverities].join(", ")}; got "${config.audit.minSeverity}"`,
      );
    }
    if (config.audit.retentionDays !== undefined && config.audit.retentionDays < 0) {
      errors.push("audit.retentionDays must be >= 0 (0 = unlimited)");
    }
  }

  // ── Secrets ────────────────────────────────────────────────
  if (config.secrets?.enabled) {
    const validBackendTypes = new Set(["env", "file", "vault"]);
    if (config.secrets.backends && config.secrets.backends.length > 0) {
      for (const [i, backend] of config.secrets.backends.entries()) {
        if (!validBackendTypes.has(backend.type)) {
          errors.push(
            `secrets.backends[${i}].type must be one of: ${[...validBackendTypes].join(", ")}; got "${backend.type}"`,
          );
        }
        if (backend.type === "vault" && !backend.vault?.address) {
          errors.push(`secrets.backends[${i}]: vault backend requires vault.address`);
        }
        if (backend.type === "file" && !backend.file?.path) {
          errors.push(`secrets.backends[${i}]: file backend requires file.path`);
        }
      }
    }
  }

  // ── Drift ──────────────────────────────────────────────────
  if (config.drift?.enabled) {
    if (config.drift.scanIntervalMs !== undefined && config.drift.scanIntervalMs < 10_000) {
      warnings.push("drift.scanIntervalMs < 10s is very aggressive");
    }
  }

  // ── Task Queue ─────────────────────────────────────────────
  if (config.taskQueue?.enabled) {
    if (config.taskQueue.pollIntervalMs !== undefined && config.taskQueue.pollIntervalMs < 100) {
      warnings.push("taskQueue.pollIntervalMs < 100ms may cause high CPU usage");
    }
  }

  // ── Cross-module dependencies ──────────────────────────────
  if (config.dr?.enabled && config.dr.encryptionKey && !config.secrets?.enabled) {
    warnings.push(
      "DR encryption enabled but secrets manager is disabled — encryption key is stored in plain config",
    );
  }

  // ── Log findings ───────────────────────────────────────────
  for (const err of errors) {
    log.error(err);
  }
  for (const warn of warnings) {
    log.warn(warn);
  }

  const valid = errors.length === 0;
  if (valid && warnings.length === 0) {
    log.info("enterprise configuration validated successfully");
  } else if (valid) {
    log.info("enterprise configuration valid with warnings", { warnings: warnings.length });
  } else {
    log.error("enterprise configuration has errors — some modules may fail to initialize", {
      errors: errors.length,
      warnings: warnings.length,
    });
  }

  return { valid, errors, warnings };
}
