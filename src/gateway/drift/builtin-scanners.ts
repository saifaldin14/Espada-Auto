/**
 * Built-in Drift Scanners
 *
 * Provides lightweight config-file and environment-variable scanners
 * that detect configuration drift without external infrastructure.
 * These run as the default scanners when no provider-specific
 * scanners (Terraform, Pulumi, K8s) are registered.
 *
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  DriftScanner,
  UnifiedDriftResult,
  DriftedResource,
  DriftSummary,
  RemediationResult,
} from "./drift-reconciliation.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("enterprise").child("drift-scan");

/** Circuit-breaker defaults for scanners. */
const CB_MAX_FAILURES = 3;
const CB_COOLDOWN_MS = 60_000; // 1 minute

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  open: boolean;
}

// =============================================================================
// Config File Scanner
// =============================================================================

/**
 * Scans configuration files for changes since last snapshot.
 * The "scope" parameter is the directory to scan for config files.
 * Tracks file hashes and detects additions, deletions, and modifications.
 */
export class ConfigFileDriftScanner implements DriftScanner {
  readonly provider = "custom" as const;

  private snapshots = new Map<string, Map<string, string>>(); // scope → { relativePath → sha256 }
  private cb: CircuitBreakerState = { failures: 0, lastFailure: 0, open: false };
  private readonly extensions = new Set([
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".env",
    ".conf",
    ".cfg",
    ".ini",
  ]);

  async scan(scope: string): Promise<UnifiedDriftResult> {
    // Circuit-breaker: skip if open and cooldown hasn't elapsed
    if (this.cb.open) {
      if (Date.now() - this.cb.lastFailure < CB_COOLDOWN_MS) {
        log.warn("config file scanner circuit-breaker open, skipping", { scope });
        return this.emptyResult(scope);
      }
      // Half-open: attempt one scan
      this.cb.open = false;
      log.info("config file scanner circuit-breaker half-open, retrying", { scope });
    }

    let current: Map<string, string>;
    try {
      current = this.hashDirectory(scope);
      // Reset on success
      this.cb.failures = 0;
    } catch (err) {
      this.cb.failures++;
      this.cb.lastFailure = Date.now();
      if (this.cb.failures >= CB_MAX_FAILURES) {
        this.cb.open = true;
        log.error("config file scanner circuit-breaker opened after repeated failures", {
          failures: this.cb.failures,
          scope,
        });
      }
      log.warn("config file scan failed", { scope, error: String(err) });
      return this.emptyResult(scope);
    }

    const previous = this.snapshots.get(scope);

    const resources: DriftedResource[] = [];

    if (previous) {
      // Detect modified and deleted files
      for (const [path, oldHash] of previous) {
        const newHash = current.get(path);
        if (!newHash) {
          resources.push({
            resourceType: "config-file",
            resourceId: path,
            resourceName: basename(path),
            fields: [{ path: "exists", expected: true, actual: false }],
            severity: "medium",
            changeType: "deleted",
          });
        } else if (newHash !== oldHash) {
          resources.push({
            resourceType: "config-file",
            resourceId: path,
            resourceName: basename(path),
            fields: [{ path: "sha256", expected: oldHash, actual: newHash }],
            severity: "low",
            changeType: "modified",
          });
        }
      }

      // Detect added files
      for (const [path] of current) {
        if (!previous.has(path)) {
          resources.push({
            resourceType: "config-file",
            resourceId: path,
            resourceName: basename(path),
            fields: [{ path: "exists", expected: false, actual: true }],
            severity: "info",
            changeType: "added",
          });
        }
      }
    }

    // Save snapshot for next scan
    this.snapshots.set(scope, current);

    if (resources.length > 0) {
      log.info("config file drift detected", { scope, drifted: resources.length });
    } else if (previous) {
      log.debug("config file scan clean", { scope, files: current.size });
    }

    const summary = this.buildSummary(current.size, resources);

    return {
      id: randomUUID(),
      provider: "custom",
      scope,
      detectedAt: new Date().toISOString(),
      severity: resources.length > 0 ? this.maxSeverity(resources) : "info",
      status: resources.length > 0 ? "detected" : "resolved",
      resources,
      summary,
      policy: "alert-only",
    };
  }

  private hashDirectory(dir: string): Map<string, string> {
    const hashes = new Map<string, string>();
    if (!existsSync(dir)) return hashes;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = join(dir, entry.name);
        try {
          const stat = statSync(fullPath);
          if (stat.isFile() && this.extensions.has(this.getExt(entry.name))) {
            const content = readFileSync(fullPath);
            hashes.set(entry.name, createHash("sha256").update(content).digest("hex"));
          }
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // directory not readable
    }

    return hashes;
  }

  private getExt(filename: string): string {
    const dot = filename.lastIndexOf(".");
    return dot >= 0 ? filename.slice(dot) : "";
  }

  private emptyResult(scope: string): UnifiedDriftResult {
    return {
      id: randomUUID(),
      provider: "custom",
      scope,
      detectedAt: new Date().toISOString(),
      severity: "info",
      status: "resolved",
      resources: [],
      summary: {
        totalResources: 0,
        driftedResources: 0,
        driftedFields: 0,
        modified: 0,
        added: 0,
        deleted: 0,
      },
      policy: "alert-only",
    };
  }

  private maxSeverity(
    resources: DriftedResource[],
  ): "info" | "low" | "medium" | "high" | "critical" {
    const severityOrder = ["info", "low", "medium", "high", "critical"] as const;
    let max = 0;
    for (const r of resources) {
      const idx = severityOrder.indexOf(r.severity);
      if (idx > max) max = idx;
    }
    return severityOrder[max];
  }

  private buildSummary(total: number, resources: DriftedResource[]): DriftSummary {
    let modified = 0;
    let added = 0;
    let deleted = 0;
    let driftedFields = 0;
    for (const r of resources) {
      if (r.changeType === "modified") modified++;
      else if (r.changeType === "added") added++;
      else if (r.changeType === "deleted") deleted++;
      driftedFields += r.fields.length;
    }
    return {
      totalResources: total,
      driftedResources: resources.length,
      driftedFields,
      modified,
      added,
      deleted,
    };
  }
}

// =============================================================================
// Environment Variable Scanner
// =============================================================================

/**
 * Scans environment variables for drift against a baseline.
 * The "scope" parameter is a comma-separated list of env var prefixes to watch
 * (e.g. "ESPADA_,OPENAI_,ANTHROPIC_").
 */
export class EnvVarDriftScanner implements DriftScanner {
  readonly provider = "custom" as const;

  private snapshots = new Map<string, Map<string, string>>(); // scope → { varName → value }

  async scan(scope: string): Promise<UnifiedDriftResult> {
    const prefixes = scope
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const current = this.captureEnv(prefixes);
    const previous = this.snapshots.get(scope);

    const resources: DriftedResource[] = [];

    if (previous) {
      // Detect modified and removed vars
      for (const [name, oldValue] of previous) {
        const newValue = current.get(name);
        if (newValue === undefined) {
          resources.push({
            resourceType: "env-var",
            resourceId: name,
            resourceName: name,
            fields: [{ path: "value", expected: "[set]", actual: "[unset]", sensitive: true }],
            severity: "high",
            changeType: "deleted",
          });
        } else if (newValue !== oldValue) {
          resources.push({
            resourceType: "env-var",
            resourceId: name,
            resourceName: name,
            fields: [
              { path: "value", expected: "[previous]", actual: "[changed]", sensitive: true },
            ],
            severity: "medium",
            changeType: "modified",
          });
        }
      }

      // Detect added vars
      for (const [name] of current) {
        if (!previous.has(name)) {
          resources.push({
            resourceType: "env-var",
            resourceId: name,
            resourceName: name,
            fields: [{ path: "value", expected: "[unset]", actual: "[set]", sensitive: true }],
            severity: "info",
            changeType: "added",
          });
        }
      }
    }

    // Save snapshot
    this.snapshots.set(scope, current);

    if (resources.length > 0) {
      log.info("env var drift detected", { scope, drifted: resources.length });
    } else if (previous) {
      log.debug("env var scan clean", { scope, vars: current.size });
    }

    const summary: DriftSummary = {
      totalResources: current.size,
      driftedResources: resources.length,
      driftedFields: resources.reduce((sum, r) => sum + r.fields.length, 0),
      modified: resources.filter((r) => r.changeType === "modified").length,
      added: resources.filter((r) => r.changeType === "added").length,
      deleted: resources.filter((r) => r.changeType === "deleted").length,
    };

    return {
      id: randomUUID(),
      provider: "custom",
      scope,
      detectedAt: new Date().toISOString(),
      severity: resources.length > 0 ? "medium" : "info",
      status: resources.length > 0 ? "detected" : "resolved",
      resources,
      summary,
      policy: "alert-only",
    };
  }

  private captureEnv(prefixes: string[]): Map<string, string> {
    const vars = new Map<string, string>();
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (prefixes.length === 0 || prefixes.some((p) => key.startsWith(p))) {
        vars.set(key, value);
      }
    }
    return vars;
  }
}
