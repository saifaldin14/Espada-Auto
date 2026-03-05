/**
 * Drift Reconciliation Engine
 *
 * Continuous drift detection and policy-based reconciliation
 * that unifies the existing per-extension drift checks into a
 * single, scheduled, policy-driven system.
 *
 * Features:
 * - Unified drift model across Terraform, Pulumi, Kubernetes
 * - Scheduled drift scans (configurable interval)
 * - Policy engine: alert-only, auto-remediate, approval-gate
 * - Persistent drift history with SQLite storage
 * - Webhook/event bus integration for alerting
 * - Audit trail for all drift events
 *
 */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { EventEmitter } from "node:events";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("enterprise").child("drift");

// =============================================================================
// Types
// =============================================================================

export type DriftSeverity = "info" | "low" | "medium" | "high" | "critical";

export type DriftStatus =
  | "detected"
  | "acknowledged"
  | "remediating"
  | "resolved"
  | "ignored"
  | "failed";

export type ReconciliationPolicy = "alert-only" | "auto-remediate" | "approval-gate";

export type ProviderType =
  | "terraform"
  | "pulumi"
  | "kubernetes"
  | "aws"
  | "azure"
  | "gcp"
  | "custom";

/**
 * A unified drift result that normalizes across all infrastructure providers.
 */
export interface UnifiedDriftResult {
  /** Unique drift ID */
  id: string;

  /** Provider type */
  provider: ProviderType;

  /** Provider-specific scan context (e.g. workspace, stack, namespace) */
  scope: string;

  /** ISO timestamp of detection */
  detectedAt: string;

  /** Overall severity */
  severity: DriftSeverity;

  /** Current status */
  status: DriftStatus;

  /** Resources that have drifted */
  resources: DriftedResource[];

  /** Summary statistics */
  summary: DriftSummary;

  /** Applied reconciliation policy */
  policy: ReconciliationPolicy;

  /** Remediation result (if auto-remediate) */
  remediationResult?: RemediationResult;

  /** Who acknowledged/approved (if applicable) */
  acknowledgedBy?: string;

  /** ISO timestamp when resolved */
  resolvedAt?: string;

  /** Metadata */
  metadata?: Record<string, string>;
}

export interface DriftedResource {
  /** Resource type (e.g. "aws_s3_bucket", "Deployment", "aws:s3:Bucket") */
  resourceType: string;

  /** Resource identifier */
  resourceId: string;

  /** Human-readable name */
  resourceName?: string;

  /** Fields that have drifted */
  fields: DriftedField[];

  /** Drift severity for this resource */
  severity: DriftSeverity;

  /** Whether this resource is new (not in expected state) or deleted */
  changeType: "modified" | "added" | "deleted";
}

export interface DriftedField {
  /** Dot-path to the field */
  path: string;

  /** Expected value */
  expected: unknown;

  /** Actual value */
  actual: unknown;

  /** Whether this is a security-sensitive field */
  sensitive?: boolean;
}

export interface DriftSummary {
  /** Total resources checked */
  totalResources: number;

  /** Number of resources with drift */
  driftedResources: number;

  /** Total drifted fields */
  driftedFields: number;

  /** Breakdown by change type */
  modified: number;
  added: number;
  deleted: number;
}

export interface RemediationResult {
  /** Whether remediation succeeded */
  success: boolean;

  /** What action was taken */
  action: string;

  /** Timestamp */
  timestamp: string;

  /** Error if failed */
  error?: string;

  /** Resources affected */
  resourcesAffected: number;
}

// =============================================================================
// Drift Policy
// =============================================================================

export interface DriftPolicy {
  /** Unique policy ID */
  id: string;

  /** Human-readable name */
  name: string;

  /** Provider this policy applies to (or '*' for all) */
  provider: ProviderType | "*";

  /** Scope pattern (glob) */
  scopePattern: string;

  /** Resource type pattern (glob) */
  resourcePattern: string;

  /** Reconciliation action */
  action: ReconciliationPolicy;

  /** Severity threshold — only apply this policy for drifts >= this severity */
  severityThreshold: DriftSeverity;

  /** Whether this policy is active */
  enabled: boolean;

  /** Priority (lower = evaluated first) */
  priority: number;

  /** Created timestamp */
  createdAt: string;
}

// =============================================================================
// Drift Scanner Interface
// =============================================================================

/**
 * Interface that provider-specific scanners implement.
 */
export interface DriftScanner {
  /** Provider type */
  readonly provider: ProviderType;

  /** Scan for drift. Returns normalized drift results. */
  scan(scope: string): Promise<UnifiedDriftResult>;

  /** Attempt to remediate detected drift. */
  remediate?(drift: UnifiedDriftResult): Promise<RemediationResult>;
}

// =============================================================================
// Drift scan config
// =============================================================================

export interface DriftReconciliationConfig {
  /** Enable/disable the drift engine */
  enabled: boolean;

  /** Scan interval in minutes (default: 60) */
  scanIntervalMinutes: number;

  /** Default policy for unmatched drift */
  defaultPolicy: ReconciliationPolicy;

  /** Maximum concurrent scans */
  maxConcurrentScans: number;

  /** Scopes to scan: [{ provider, scope }] */
  scopes: Array<{ provider: ProviderType; scope: string }>;
}

// =============================================================================
// Events
// =============================================================================

export type DriftEvent =
  | { type: "drift.detected"; drift: UnifiedDriftResult }
  | { type: "drift.resolved"; driftId: string }
  | { type: "drift.remediation.started"; driftId: string }
  | { type: "drift.remediation.completed"; driftId: string; success: boolean }
  | { type: "drift.scan.started"; provider: ProviderType; scope: string }
  | { type: "drift.scan.completed"; provider: ProviderType; scope: string; driftCount: number }
  | { type: "drift.policy.matched"; driftId: string; policyId: string };

// =============================================================================
// Drift Reconciliation Engine
// =============================================================================

const SEVERITY_ORDER: Record<DriftSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export class DriftReconciliationEngine extends EventEmitter {
  private db: Database.Database;
  private config: DriftReconciliationConfig;
  private scanners = new Map<ProviderType, DriftScanner>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private initialScanTimeout: ReturnType<typeof setTimeout> | null = null;
  private isClosing = false;
  private activeScanCount = 0;

  constructor(dbPath: string, config?: Partial<DriftReconciliationConfig>) {
    super();

    this.config = {
      enabled: config?.enabled ?? true,
      scanIntervalMinutes: config?.scanIntervalMinutes ?? 60,
      defaultPolicy: config?.defaultPolicy ?? "alert-only",
      maxConcurrentScans: config?.maxConcurrentScans ?? 3,
      scopes: config?.scopes ?? [],
    };

    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");

    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS drift_results (
        id               TEXT PRIMARY KEY,
        provider         TEXT NOT NULL,
        scope            TEXT NOT NULL,
        detected_at      TEXT NOT NULL,
        severity         TEXT NOT NULL DEFAULT 'info',
        status           TEXT NOT NULL DEFAULT 'detected',
        resources        TEXT NOT NULL DEFAULT '[]',
        summary          TEXT NOT NULL DEFAULT '{}',
        policy           TEXT NOT NULL DEFAULT 'alert-only',
        remediation      TEXT DEFAULT NULL,
        acknowledged_by  TEXT DEFAULT NULL,
        resolved_at      TEXT DEFAULT NULL,
        metadata         TEXT DEFAULT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_drift_provider_scope
        ON drift_results(provider, scope);
      CREATE INDEX IF NOT EXISTS idx_drift_status
        ON drift_results(status);
      CREATE INDEX IF NOT EXISTS idx_drift_detected
        ON drift_results(detected_at);
      CREATE INDEX IF NOT EXISTS idx_drift_severity
        ON drift_results(severity);

      CREATE TABLE IF NOT EXISTS drift_policies (
        id                 TEXT PRIMARY KEY,
        name               TEXT NOT NULL,
        provider           TEXT NOT NULL DEFAULT '*',
        scope_pattern      TEXT NOT NULL DEFAULT '*',
        resource_pattern   TEXT NOT NULL DEFAULT '*',
        action             TEXT NOT NULL DEFAULT 'alert-only',
        severity_threshold TEXT NOT NULL DEFAULT 'low',
        enabled            INTEGER NOT NULL DEFAULT 1,
        priority           INTEGER NOT NULL DEFAULT 100,
        created_at         TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_policy_provider
        ON drift_policies(provider);
      CREATE INDEX IF NOT EXISTS idx_policy_priority
        ON drift_policies(priority);

      CREATE TABLE IF NOT EXISTS drift_scan_log (
        id          TEXT PRIMARY KEY,
        provider    TEXT NOT NULL,
        scope       TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        completed_at TEXT DEFAULT NULL,
        drift_count INTEGER DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'running',
        error       TEXT DEFAULT NULL
      );
    `);
  }

  // ===========================================================================
  // Scanner Registration
  // ===========================================================================

  /**
   * Register a provider-specific drift scanner.
   */
  registerScanner(scanner: DriftScanner): void {
    this.scanners.set(scanner.provider, scanner);
  }

  // ===========================================================================
  // Scan Lifecycle
  // ===========================================================================

  /**
   * Start the automated drift scan loop.
   */
  start(): void {
    if (this.scanTimer) return;

    this.scanTimer = setInterval(
      () => {
        void this.runAllScans();
      },
      this.config.scanIntervalMinutes * 60 * 1000,
    );

    // Run initial scan after a short delay
    this.initialScanTimeout = setTimeout(() => {
      this.initialScanTimeout = null;
      void this.runAllScans();
    }, 5_000);
  }

  /**
   * Run all configured drift scans.
   */
  async runAllScans(): Promise<UnifiedDriftResult[]> {
    if (this.isClosing || !this.config.enabled) return [];

    const results: UnifiedDriftResult[] = [];

    for (const { provider, scope } of this.config.scopes) {
      if (this.activeScanCount >= this.config.maxConcurrentScans) {
        // Log skip — operator should increase maxConcurrentScans or reduce scopes
        log.warn("drift scan skipped due to concurrency limit", { provider, scope });
        continue;
      }

      try {
        const result = await this.scanScope(provider, scope);
        if (result) results.push(result);
      } catch {
        // Individual scan failures shouldn't stop others
      }
    }

    return results;
  }

  /**
   * Run a single drift scan for a provider+scope.
   */
  async scanScope(provider: ProviderType, scope: string): Promise<UnifiedDriftResult | null> {
    const scanner = this.scanners.get(provider);
    if (!scanner) return null;

    const scanId = randomUUID();
    const startedAt = new Date().toISOString();

    this.db
      .prepare(
        "INSERT INTO drift_scan_log (id, provider, scope, started_at, status) VALUES (?, ?, ?, ?, 'running')",
      )
      .run(scanId, provider, scope, startedAt);

    this.activeScanCount++;

    this.emit("event", {
      type: "drift.scan.started",
      provider,
      scope,
    } satisfies DriftEvent);

    try {
      const result = await scanner.scan(scope);

      // Determine policy
      const policy = this.resolvePolicy(result);
      result.policy = policy.action;

      // Persist result
      this.saveDriftResult(result);

      // Update scan log
      this.db
        .prepare(
          "UPDATE drift_scan_log SET completed_at = ?, drift_count = ?, status = 'completed' WHERE id = ?",
        )
        .run(new Date().toISOString(), result.summary.driftedResources, scanId);

      this.emit("event", {
        type: "drift.scan.completed",
        provider,
        scope,
        driftCount: result.summary.driftedResources,
      } satisfies DriftEvent);

      if (result.summary.driftedResources > 0) {
        this.emit("event", {
          type: "drift.detected",
          drift: result,
        } satisfies DriftEvent);

        // Apply policy
        if (policy.action === "auto-remediate" && scanner.remediate) {
          this.emit("event", {
            type: "drift.remediation.started",
            driftId: result.id,
          } satisfies DriftEvent);

          const remResult = await scanner.remediate(result);
          result.remediationResult = remResult;

          if (remResult.success) {
            result.status = "resolved";
            result.resolvedAt = new Date().toISOString();
          } else {
            result.status = "failed";
          }

          this.updateDriftResult(result);

          this.emit("event", {
            type: "drift.remediation.completed",
            driftId: result.id,
            success: remResult.success,
          } satisfies DriftEvent);
        }
      }

      return result;
    } catch (err) {
      this.db
        .prepare(
          "UPDATE drift_scan_log SET completed_at = ?, status = 'failed', error = ? WHERE id = ?",
        )
        .run(new Date().toISOString(), err instanceof Error ? err.message : String(err), scanId);

      return null;
    } finally {
      this.activeScanCount--;
    }
  }

  // ===========================================================================
  // Policy Management
  // ===========================================================================

  /**
   * Add a drift policy.
   */
  addPolicy(policy: Omit<DriftPolicy, "id" | "createdAt">): DriftPolicy {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(`
        INSERT INTO drift_policies (id, name, provider, scope_pattern, resource_pattern, action, severity_threshold, enabled, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        policy.name,
        policy.provider,
        policy.scopePattern,
        policy.resourcePattern,
        policy.action,
        policy.severityThreshold,
        policy.enabled ? 1 : 0,
        policy.priority,
        now,
      );

    return { ...policy, id, createdAt: now };
  }

  /**
   * List all drift policies.
   */
  listPolicies(): DriftPolicy[] {
    const rows = this.db
      .prepare("SELECT * FROM drift_policies ORDER BY priority ASC")
      .all() as PolicyRow[];
    return rows.map(rowToPolicy);
  }

  /**
   * Delete a drift policy.
   */
  deletePolicy(id: string): boolean {
    const result = this.db.prepare("DELETE FROM drift_policies WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /**
   * Resolve the most specific policy applicable to a drift result.
   */
  private resolvePolicy(drift: UnifiedDriftResult): DriftPolicy {
    const policies = this.listPolicies().filter((p) => p.enabled);

    for (const policy of policies) {
      // Check provider match
      if (policy.provider !== "*" && policy.provider !== drift.provider) continue;

      // Check scope pattern
      if (policy.scopePattern !== "*" && !matchGlob(policy.scopePattern, drift.scope)) continue;

      // Check severity threshold
      if (SEVERITY_ORDER[drift.severity] < SEVERITY_ORDER[policy.severityThreshold]) continue;

      // Check resource pattern
      if (policy.resourcePattern !== "*") {
        const hasMatchingResource = drift.resources.some((r) =>
          matchGlob(policy.resourcePattern, r.resourceType),
        );
        if (!hasMatchingResource) continue;
      }

      this.emit("event", {
        type: "drift.policy.matched",
        driftId: drift.id,
        policyId: policy.id,
      } satisfies DriftEvent);

      return policy;
    }

    // Fallback default policy
    return {
      id: "default",
      name: "Default Policy",
      provider: "*",
      scopePattern: "*",
      resourcePattern: "*",
      action: this.config.defaultPolicy,
      severityThreshold: "info",
      enabled: true,
      priority: 9999,
      createdAt: new Date().toISOString(),
    };
  }

  // ===========================================================================
  // Drift Result Management
  // ===========================================================================

  private saveDriftResult(drift: UnifiedDriftResult): void {
    this.db
      .prepare(`
        INSERT INTO drift_results (id, provider, scope, detected_at, severity, status, resources, summary, policy, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        drift.id,
        drift.provider,
        drift.scope,
        drift.detectedAt,
        drift.severity,
        drift.status,
        JSON.stringify(drift.resources),
        JSON.stringify(drift.summary),
        drift.policy,
        drift.metadata ? JSON.stringify(drift.metadata) : null,
      );
  }

  private updateDriftResult(drift: UnifiedDriftResult): void {
    this.db
      .prepare(`
        UPDATE drift_results SET
          status = ?,
          remediation = ?,
          acknowledged_by = ?,
          resolved_at = ?
        WHERE id = ?
      `)
      .run(
        drift.status,
        drift.remediationResult ? JSON.stringify(drift.remediationResult) : null,
        drift.acknowledgedBy ?? null,
        drift.resolvedAt ?? null,
        drift.id,
      );
  }

  /**
   * Get a drift result by ID.
   */
  getDrift(id: string): UnifiedDriftResult | null {
    const row = this.db.prepare("SELECT * FROM drift_results WHERE id = ?").get(id) as
      | DriftRow
      | undefined;
    return row ? rowToDriftResult(row) : null;
  }

  /**
   * List drift results with filtering.
   */
  listDrifts(filter?: {
    provider?: ProviderType;
    scope?: string;
    status?: DriftStatus;
    severity?: DriftSeverity;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): UnifiedDriftResult[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.provider) {
      conditions.push("provider = ?");
      params.push(filter.provider);
    }
    if (filter?.scope) {
      conditions.push("scope = ?");
      params.push(filter.scope);
    }
    if (filter?.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.severity) {
      conditions.push("severity = ?");
      params.push(filter.severity);
    }
    if (filter?.from) {
      conditions.push("detected_at >= ?");
      params.push(filter.from);
    }
    if (filter?.to) {
      conditions.push("detected_at <= ?");
      params.push(filter.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;

    const rows = this.db
      .prepare(`SELECT * FROM drift_results ${where} ORDER BY detected_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as DriftRow[];

    return rows.map(rowToDriftResult);
  }

  /**
   * Acknowledge a drift (for approval-gate policy).
   */
  acknowledgeDrift(id: string, userId: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE drift_results SET status = 'acknowledged', acknowledged_by = ? WHERE id = ? AND status = 'detected'",
      )
      .run(userId, id);
    return result.changes > 0;
  }

  /**
   * Ignore a drift.
   */
  ignoreDrift(id: string): boolean {
    const result = this.db
      .prepare("UPDATE drift_results SET status = 'ignored' WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  /**
   * Get drift statistics.
   */
  getStats(): {
    total: number;
    byStatus: Record<string, number>;
    bySeverity: Record<string, number>;
    byProvider: Record<string, number>;
  } {
    const statusRows = this.db
      .prepare("SELECT status, COUNT(*) as count FROM drift_results GROUP BY status")
      .all() as Array<{ status: string; count: number }>;

    const severityRows = this.db
      .prepare("SELECT severity, COUNT(*) as count FROM drift_results GROUP BY severity")
      .all() as Array<{ severity: string; count: number }>;

    const providerRows = this.db
      .prepare("SELECT provider, COUNT(*) as count FROM drift_results GROUP BY provider")
      .all() as Array<{ provider: string; count: number }>;

    const byStatus: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byProvider: Record<string, number> = {};
    let total = 0;

    for (const r of statusRows) {
      byStatus[r.status] = r.count;
      total += r.count;
    }
    for (const r of severityRows) bySeverity[r.severity] = r.count;
    for (const r of providerRows) byProvider[r.provider] = r.count;

    return { total, byStatus, bySeverity, byProvider };
  }

  /**
   * Prune old resolved/ignored drift results.
   */
  prune(olderThanDays = 90): number {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db
      .prepare(
        "DELETE FROM drift_results WHERE status IN ('resolved', 'ignored') AND detected_at < ?",
      )
      .run(cutoff);
    return result.changes;
  }

  /** Stop the engine. */
  stop(): void {
    this.isClosing = true;
    if (this.initialScanTimeout) {
      clearTimeout(this.initialScanTimeout);
      this.initialScanTimeout = null;
    }
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  /** Close the engine and database. */
  close(): void {
    this.stop();
    this.db.close();
  }
}

// =============================================================================
// Row types & converters
// =============================================================================

type DriftRow = {
  id: string;
  provider: string;
  scope: string;
  detected_at: string;
  severity: string;
  status: string;
  resources: string;
  summary: string;
  policy: string;
  remediation: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  metadata: string | null;
};

type PolicyRow = {
  id: string;
  name: string;
  provider: string;
  scope_pattern: string;
  resource_pattern: string;
  action: string;
  severity_threshold: string;
  enabled: number;
  priority: number;
  created_at: string;
};

function rowToDriftResult(row: DriftRow): UnifiedDriftResult {
  return {
    id: row.id,
    provider: row.provider as ProviderType,
    scope: row.scope,
    detectedAt: row.detected_at,
    severity: row.severity as DriftSeverity,
    status: row.status as DriftStatus,
    resources: JSON.parse(row.resources) as DriftedResource[],
    summary: JSON.parse(row.summary) as DriftSummary,
    policy: row.policy as ReconciliationPolicy,
    remediationResult: row.remediation
      ? (JSON.parse(row.remediation) as RemediationResult)
      : undefined,
    acknowledgedBy: row.acknowledged_by ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, string>) : undefined,
  };
}

function rowToPolicy(row: PolicyRow): DriftPolicy {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as ProviderType | "*",
    scopePattern: row.scope_pattern,
    resourcePattern: row.resource_pattern,
    action: row.action as ReconciliationPolicy,
    severityThreshold: row.severity_threshold as DriftSeverity,
    enabled: row.enabled === 1,
    priority: row.priority,
    createdAt: row.created_at,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function matchGlob(pattern: string, value: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$",
  );
  return regex.test(value);
}
