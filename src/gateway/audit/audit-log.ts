/**
 * Enterprise Structured Audit Log Pipeline
 *
 * Gateway-level tamper-evident audit log that captures every significant
 * action: API calls, tool invocations, RBAC decisions, SSO events,
 * config changes, and agent operations.
 *
 * Features:
 * - Append-only SQLite storage with cryptographic hash chain
 * - Configurable sinks (file, stdout, webhook/SIEM)
 * - Structured entries with actor, action, resource, outcome
 * - Tamper detection via SHA-256 chain verification
 * - Retention policies with automated archival
 * - Search/filter API
 *
 */

import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, existsSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

// =============================================================================
// Types
// =============================================================================

export type AuditAction =
  // Auth events
  | "auth.login"
  | "auth.logout"
  | "auth.login_failed"
  | "auth.token_issued"
  | "auth.token_revoked"
  | "auth.mfa_verified"
  // RBAC events
  | "rbac.role_created"
  | "rbac.role_updated"
  | "rbac.role_deleted"
  | "rbac.role_assigned"
  | "rbac.role_unassigned"
  | "rbac.permission_denied"
  | "rbac.permission_granted"
  // API events
  | "api.request"
  | "api.ws_connect"
  | "api.ws_disconnect"
  | "api.rate_limited"
  // Tool events
  | "tool.invoked"
  | "tool.succeeded"
  | "tool.failed"
  | "tool.denied"
  // Agent events
  | "agent.spawned"
  | "agent.completed"
  | "agent.failed"
  | "agent.approval_requested"
  | "agent.approval_granted"
  | "agent.approval_denied"
  // Config events
  | "config.updated"
  | "config.reloaded"
  // Infrastructure events
  | "infra.resource_created"
  | "infra.resource_updated"
  | "infra.resource_deleted"
  | "infra.drift_detected"
  // Task queue events
  | "task.created"
  | "task.completed"
  | "task.failed"
  | "task.dead_lettered"
  // Custom
  | `custom.${string}`;

export type AuditOutcome = "success" | "failure" | "denied" | "error";

export type AuditSeverity = "info" | "warn" | "error" | "critical";

/**
 * A structured audit log entry.
 */
export interface AuditEntry {
  /** Unique entry ID (UUID) */
  id: string;

  /** ISO timestamp */
  timestamp: string;

  /** Sequence number (monotonically increasing) */
  seq: number;

  /** Action performed */
  action: AuditAction;

  /** Outcome of the action */
  outcome: AuditOutcome;

  /** Severity level */
  severity: AuditSeverity;

  /** Who performed the action */
  actor: AuditActor;

  /** What was acted upon */
  resource: AuditResource;

  /** Additional context */
  context: Record<string, unknown>;

  /** SHA-256 hash of this entry (including previous hash for chain) */
  hash: string;

  /** SHA-256 hash of the previous entry (chain link) */
  previousHash: string;
}

export interface AuditActor {
  /** Actor type */
  type: "user" | "agent" | "system" | "api-key";

  /** Actor identifier */
  id: string;

  /** Display name */
  name?: string;

  /** Email (for users) */
  email?: string;

  /** IP address */
  ip?: string;

  /** User agent string */
  userAgent?: string;

  /** Session ID */
  sessionId?: string;
}

export interface AuditResource {
  /** Resource type */
  type: string;

  /** Resource identifier */
  id: string;

  /** Human-readable name */
  name?: string;

  /** Additional resource metadata */
  metadata?: Record<string, string>;
}

export interface AuditSinkConfig {
  type: "file" | "stdout" | "webhook";

  /** For file sink: path to write to */
  filePath?: string;

  /** For webhook sink */
  webhookUrl?: string;
  webhookHeaders?: Record<string, string>;
  webhookBatchSize?: number;
  webhookFlushIntervalMs?: number;
}

export interface AuditLogConfig {
  /** Enable/disable audit logging (default: true) */
  enabled: boolean;

  /** Output sinks (default: SQLite + stdout) */
  sinks: AuditSinkConfig[];

  /** Retention period in days (default: 90) */
  retentionDays: number;

  /** Minimum severity to log (default: info) */
  minimumSeverity: AuditSeverity;

  /** Actions to exclude from logging (glob patterns) */
  excludeActions?: string[];
}

// =============================================================================
// Severity ordering
// =============================================================================

const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  info: 0,
  warn: 1,
  error: 2,
  critical: 3,
};

// =============================================================================
// Audit Log Pipeline
// =============================================================================

/**
 * Tamper-evident, append-only audit log with cryptographic hash chain.
 *
 * Every entry is hashed with the previous entry's hash, forming a chain
 * that can be verified for integrity. If any entry is modified or removed,
 * the chain breaks and verification fails.
 */
export class AuditLogPipeline {
  private db: Database.Database;
  private config: AuditLogConfig;
  private seq = 0;
  private lastHash = "genesis";
  private sinks: AuditSink[] = [];
  private webhookBuffer: AuditEntry[] = [];
  private webhookFlushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dbPath: string, config?: Partial<AuditLogConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      sinks: config?.sinks ?? [{ type: "stdout" }],
      retentionDays: config?.retentionDays ?? 90,
      minimumSeverity: config?.minimumSeverity ?? "info",
      excludeActions: config?.excludeActions,
    };

    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");

    this.createTables();
    this.loadState();
    this.initializeSinks();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id            TEXT PRIMARY KEY,
        seq           INTEGER NOT NULL UNIQUE,
        timestamp     TEXT NOT NULL,
        action        TEXT NOT NULL,
        outcome       TEXT NOT NULL,
        severity      TEXT NOT NULL DEFAULT 'info',
        actor_type    TEXT NOT NULL,
        actor_id      TEXT NOT NULL,
        actor_name    TEXT DEFAULT NULL,
        actor_email   TEXT DEFAULT NULL,
        actor_ip      TEXT DEFAULT NULL,
        actor_ua      TEXT DEFAULT NULL,
        actor_session TEXT DEFAULT NULL,
        resource_type TEXT NOT NULL,
        resource_id   TEXT NOT NULL,
        resource_name TEXT DEFAULT NULL,
        resource_meta TEXT DEFAULT NULL,
        context       TEXT NOT NULL DEFAULT '{}',
        hash          TEXT NOT NULL,
        previous_hash TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp
        ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_action
        ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_actor
        ON audit_log(actor_type, actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_resource
        ON audit_log(resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_audit_severity
        ON audit_log(severity);
      CREATE INDEX IF NOT EXISTS idx_audit_outcome
        ON audit_log(outcome);
      CREATE INDEX IF NOT EXISTS idx_audit_seq
        ON audit_log(seq);
    `);
  }

  private loadState(): void {
    const lastRow = this.db
      .prepare("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1")
      .get() as { seq: number; hash: string } | undefined;

    if (lastRow) {
      this.seq = lastRow.seq;
      this.lastHash = lastRow.hash;
    }
  }

  private initializeSinks(): void {
    for (const sinkConfig of this.config.sinks) {
      switch (sinkConfig.type) {
        case "stdout":
          this.sinks.push(new StdoutAuditSink());
          break;
        case "file":
          if (sinkConfig.filePath) {
            this.sinks.push(new FileAuditSink(sinkConfig.filePath));
          }
          break;
        case "webhook":
          if (sinkConfig.webhookUrl) {
            this.sinks.push(
              new WebhookAuditSink(
                sinkConfig.webhookUrl,
                sinkConfig.webhookHeaders,
                sinkConfig.webhookBatchSize ?? 100,
                sinkConfig.webhookFlushIntervalMs ?? 30_000,
              ),
            );
          }
          break;
      }
    }
  }

  // ===========================================================================
  // Write
  // ===========================================================================

  /**
   * Record an audit event. Returns the created entry.
   */
  record(params: {
    action: AuditAction;
    outcome: AuditOutcome;
    severity?: AuditSeverity;
    actor: AuditActor;
    resource: AuditResource;
    context?: Record<string, unknown>;
  }): AuditEntry | null {
    if (!this.config.enabled) return null;

    const severity = params.severity ?? "info";

    // Check minimum severity
    if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[this.config.minimumSeverity]) {
      return null;
    }

    // Check exclusions
    if (this.config.excludeActions?.some((pattern) => matchGlob(pattern, params.action))) {
      return null;
    }

    this.seq++;
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const previousHash = this.lastHash;

    // Compute hash chain
    const hashInput = JSON.stringify({
      id,
      seq: this.seq,
      timestamp,
      action: params.action,
      outcome: params.outcome,
      actor: params.actor,
      resource: params.resource,
      context: params.context ?? {},
      previousHash,
    });
    const hash = createHash("sha256").update(hashInput).digest("hex");

    const entry: AuditEntry = {
      id,
      timestamp,
      seq: this.seq,
      action: params.action,
      outcome: params.outcome,
      severity,
      actor: params.actor,
      resource: params.resource,
      context: params.context ?? {},
      hash,
      previousHash,
    };

    // Persist to SQLite
    this.db
      .prepare(`
        INSERT INTO audit_log (
          id, seq, timestamp, action, outcome, severity,
          actor_type, actor_id, actor_name, actor_email, actor_ip, actor_ua, actor_session,
          resource_type, resource_id, resource_name, resource_meta,
          context, hash, previous_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        entry.id,
        entry.seq,
        entry.timestamp,
        entry.action,
        entry.outcome,
        entry.severity,
        entry.actor.type,
        entry.actor.id,
        entry.actor.name ?? null,
        entry.actor.email ?? null,
        entry.actor.ip ?? null,
        entry.actor.userAgent ?? null,
        entry.actor.sessionId ?? null,
        entry.resource.type,
        entry.resource.id,
        entry.resource.name ?? null,
        entry.resource.metadata ? JSON.stringify(entry.resource.metadata) : null,
        JSON.stringify(entry.context),
        entry.hash,
        entry.previousHash,
      );

    this.lastHash = hash;

    // Push to sinks
    for (const sink of this.sinks) {
      try {
        sink.write(entry);
      } catch {
        // Sink failures shouldn't break the audit pipeline
      }
    }

    return entry;
  }

  // ===========================================================================
  // Query
  // ===========================================================================

  /**
   * Search audit entries with filtering.
   */
  search(filter?: {
    action?: AuditAction | AuditAction[];
    actorId?: string;
    actorType?: AuditActor["type"];
    resourceId?: string;
    resourceType?: string;
    outcome?: AuditOutcome;
    severity?: AuditSeverity;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): AuditEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.action) {
      const actions = Array.isArray(filter.action) ? filter.action : [filter.action];
      conditions.push(`action IN (${actions.map(() => "?").join(", ")})`);
      params.push(...actions);
    }
    if (filter?.actorId) {
      conditions.push("actor_id = ?");
      params.push(filter.actorId);
    }
    if (filter?.actorType) {
      conditions.push("actor_type = ?");
      params.push(filter.actorType);
    }
    if (filter?.resourceId) {
      conditions.push("resource_id = ?");
      params.push(filter.resourceId);
    }
    if (filter?.resourceType) {
      conditions.push("resource_type = ?");
      params.push(filter.resourceType);
    }
    if (filter?.outcome) {
      conditions.push("outcome = ?");
      params.push(filter.outcome);
    }
    if (filter?.severity) {
      conditions.push("severity = ?");
      params.push(filter.severity);
    }
    if (filter?.from) {
      conditions.push("timestamp >= ?");
      params.push(filter.from);
    }
    if (filter?.to) {
      conditions.push("timestamp <= ?");
      params.push(filter.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ?? 100;
    const offset = filter?.offset ?? 0;

    const rows = this.db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY seq DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as AuditRow[];

    return rows.map(rowToAuditEntry);
  }

  /**
   * Count audit entries matching filter.
   */
  count(filter?: {
    action?: AuditAction;
    actorId?: string;
    outcome?: AuditOutcome;
    from?: string;
    to?: string;
  }): number {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.action) {
      conditions.push("action = ?");
      params.push(filter.action);
    }
    if (filter?.actorId) {
      conditions.push("actor_id = ?");
      params.push(filter.actorId);
    }
    if (filter?.outcome) {
      conditions.push("outcome = ?");
      params.push(filter.outcome);
    }
    if (filter?.from) {
      conditions.push("timestamp >= ?");
      params.push(filter.from);
    }
    if (filter?.to) {
      conditions.push("timestamp <= ?");
      params.push(filter.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`)
      .get(...params) as { count: number };

    return row.count;
  }

  // ===========================================================================
  // Integrity Verification
  // ===========================================================================

  /**
   * Verify the integrity of the audit log hash chain.
   * Returns the first broken link if tampered, or null if intact.
   */
  verifyIntegrity(options?: { fromSeq?: number; toSeq?: number }): {
    intact: boolean;
    brokenAtSeq?: number;
    details?: string;
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.fromSeq !== undefined) {
      conditions.push("seq >= ?");
      params.push(options.fromSeq);
    }
    if (options?.toSeq !== undefined) {
      conditions.push("seq <= ?");
      params.push(options.toSeq);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY seq ASC`)
      .all(...params) as AuditRow[];

    let expectedPreviousHash = "genesis";

    // If starting from a specific seq, get the hash of the entry before it
    if (options?.fromSeq !== undefined && options.fromSeq > 1) {
      const prev = this.db
        .prepare("SELECT hash FROM audit_log WHERE seq = ?")
        .get(options.fromSeq - 1) as { hash: string } | undefined;
      if (prev) {
        expectedPreviousHash = prev.hash;
      }
    }

    for (const row of rows) {
      // Verify chain link
      if (row.previous_hash !== expectedPreviousHash) {
        return {
          intact: false,
          brokenAtSeq: row.seq,
          details: `Chain broken at seq ${row.seq}: expected previousHash ${expectedPreviousHash}, got ${row.previous_hash}`,
        };
      }

      // Verify entry hash
      const entry = rowToAuditEntry(row);
      const hashInput = JSON.stringify({
        id: entry.id,
        seq: entry.seq,
        timestamp: entry.timestamp,
        action: entry.action,
        outcome: entry.outcome,
        actor: entry.actor,
        resource: entry.resource,
        context: entry.context,
        previousHash: entry.previousHash,
      });
      const expectedHash = createHash("sha256").update(hashInput).digest("hex");

      if (row.hash !== expectedHash) {
        return {
          intact: false,
          brokenAtSeq: row.seq,
          details: `Entry hash mismatch at seq ${row.seq}: expected ${expectedHash}, got ${row.hash}`,
        };
      }

      expectedPreviousHash = row.hash;
    }

    return { intact: true };
  }

  // ===========================================================================
  // Retention
  // ===========================================================================

  /**
   * Prune audit entries older than the retention period.
   * Returns count of pruned entries.
   *
   * WARNING: Pruning deletes entries from the hash chain. Call export() first
   * to archive entries if tamper-evident chain integrity is required for
   * compliance audits spanning the pruned period.
   */
  prune(): number {
    const cutoff = new Date(
      Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const result = this.db.prepare("DELETE FROM audit_log WHERE timestamp < ?").run(cutoff);

    return result.changes;
  }

  /**
   * Export audit entries as JSONL for archival.
   */
  export(options: { from?: string; to?: string; format: "jsonl" | "json" }): string {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.from) {
      conditions.push("timestamp >= ?");
      params.push(options.from);
    }
    if (options.to) {
      conditions.push("timestamp <= ?");
      params.push(options.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY seq ASC`)
      .all(...params) as AuditRow[];

    const entries = rows.map(rowToAuditEntry);

    if (options.format === "jsonl") {
      return entries.map((e) => JSON.stringify(e)).join("\n");
    }

    return JSON.stringify(entries, null, 2);
  }

  /** Close the audit log pipeline. */
  async close(): Promise<void> {
    if (this.webhookFlushTimer) {
      clearInterval(this.webhookFlushTimer);
      this.webhookFlushTimer = null;
    }
    for (const sink of this.sinks) {
      await sink.close?.();
    }
    this.db.close();
  }
}

// =============================================================================
// Audit Sinks
// =============================================================================

interface AuditSink {
  write(entry: AuditEntry): void;
  close?(): void | Promise<void>;
}

class StdoutAuditSink implements AuditSink {
  write(entry: AuditEntry): void {
    const line = JSON.stringify({
      ts: entry.timestamp,
      action: entry.action,
      outcome: entry.outcome,
      severity: entry.severity,
      actor: `${entry.actor.type}:${entry.actor.id}`,
      resource: `${entry.resource.type}:${entry.resource.id}`,
    });
    process.stdout.write(`[AUDIT] ${line}\n`);
  }
}

class FileAuditSink implements AuditSink {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  write(entry: AuditEntry): void {
    appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf8");
  }
}

class WebhookAuditSink implements AuditSink {
  private url: string;
  private headers: Record<string, string>;
  private batchSize: number;
  private buffer: AuditEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval>;

  constructor(
    url: string,
    headers?: Record<string, string>,
    batchSize = 100,
    flushIntervalMs = 30_000,
  ) {
    this.url = url;
    this.headers = headers ?? {};
    this.batchSize = batchSize;

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, flushIntervalMs);
  }

  write(entry: AuditEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= this.batchSize) {
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, this.batchSize);

    try {
      await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify({ entries: batch }),
      });
    } catch {
      // Re-queue on failure (at front for retry)
      this.buffer.unshift(...batch);
      // Cap buffer to prevent OOM on persistent delivery failure
      const maxBuffer = 10_000;
      if (this.buffer.length > maxBuffer) {
        this.buffer.length = maxBuffer;
      }
    }
  }

  async close(): Promise<void> {
    clearInterval(this.flushTimer);
    await this.flush();
  }
}

// =============================================================================
// Row types and converters
// =============================================================================

type AuditRow = {
  id: string;
  seq: number;
  timestamp: string;
  action: string;
  outcome: string;
  severity: string;
  actor_type: string;
  actor_id: string;
  actor_name: string | null;
  actor_email: string | null;
  actor_ip: string | null;
  actor_ua: string | null;
  actor_session: string | null;
  resource_type: string;
  resource_id: string;
  resource_name: string | null;
  resource_meta: string | null;
  context: string;
  hash: string;
  previous_hash: string;
};

function rowToAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    seq: row.seq,
    action: row.action as AuditAction,
    outcome: row.outcome as AuditOutcome,
    severity: row.severity as AuditSeverity,
    actor: {
      type: row.actor_type as AuditActor["type"],
      id: row.actor_id,
      name: row.actor_name ?? undefined,
      email: row.actor_email ?? undefined,
      ip: row.actor_ip ?? undefined,
      userAgent: row.actor_ua ?? undefined,
      sessionId: row.actor_session ?? undefined,
    },
    resource: {
      type: row.resource_type,
      id: row.resource_id,
      name: row.resource_name ?? undefined,
      metadata: row.resource_meta
        ? (JSON.parse(row.resource_meta) as Record<string, string>)
        : undefined,
    },
    context: JSON.parse(row.context) as Record<string, unknown>,
    hash: row.hash,
    previousHash: row.previous_hash,
  };
}

// =============================================================================
// Glob matching helper
// =============================================================================

const globCache = new Map<string, RegExp>();

function matchGlob(pattern: string, value: string): boolean {
  let regex = globCache.get(pattern);
  if (!regex) {
    regex = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, "[^.]*")
          .replace(/\?/g, ".") +
        "$",
    );
    globCache.set(pattern, regex);
  }
  return regex.test(value);
}
