/**
 * Persistent Audit Trail — SQLite Storage
 *
 * WAL-mode SQLite database for persistent audit event storage with indexed
 * columns for fast querying, automatic retention pruning, and batch writes.
 */

import Database from "better-sqlite3";
import type {
  AuditStorage,
  AuditEvent,
  AuditQuery,
  AuditSummary,
  AuditSeverity,
  AuditEventType,
  AuditResult,
} from "./types.js";

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  actor_roles TEXT NOT NULL DEFAULT '[]',
  actor_ip TEXT,
  actor_channel TEXT,
  actor_agent_id TEXT,
  operation TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  resource_provider TEXT,
  parameters TEXT,
  result TEXT NOT NULL,
  correlation_id TEXT,
  session_id TEXT,
  duration_ms INTEGER,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_actor_id ON audit_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource_id ON audit_events(resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource_type ON audit_events(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_events(severity);
CREATE INDEX IF NOT EXISTS idx_audit_result ON audit_events(result);
CREATE INDEX IF NOT EXISTS idx_audit_correlation_id ON audit_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_session_id ON audit_events(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_operation ON audit_events(operation);

CREATE TABLE IF NOT EXISTS audit_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function eventToRow(e: AuditEvent): Record<string, unknown> {
  return {
    id: e.id,
    timestamp: e.timestamp,
    event_type: e.eventType,
    severity: e.severity,
    actor_id: e.actor.id,
    actor_name: e.actor.name,
    actor_roles: JSON.stringify(e.actor.roles),
    actor_ip: e.actor.ip ?? null,
    actor_channel: e.actor.channel ?? null,
    actor_agent_id: e.actor.agentId ?? null,
    operation: e.operation,
    resource_type: e.resource?.type ?? null,
    resource_id: e.resource?.id ?? null,
    resource_provider: e.resource?.provider ?? null,
    parameters: e.parameters ? JSON.stringify(e.parameters) : null,
    result: e.result,
    correlation_id: e.correlationId ?? null,
    session_id: e.sessionId ?? null,
    duration_ms: e.durationMs ?? null,
    metadata: e.metadata ? JSON.stringify(e.metadata) : null,
  };
}

function rowToEvent(row: Record<string, unknown>): AuditEvent {
  return {
    id: row.id as string,
    timestamp: row.timestamp as string,
    eventType: row.event_type as AuditEventType,
    severity: row.severity as AuditSeverity,
    actor: {
      id: row.actor_id as string,
      name: row.actor_name as string,
      roles: JSON.parse((row.actor_roles as string) || "[]"),
      ip: (row.actor_ip as string) ?? undefined,
      channel: (row.actor_channel as string) ?? undefined,
      agentId: (row.actor_agent_id as string) ?? undefined,
    },
    operation: row.operation as string,
    resource: row.resource_type
      ? {
          type: row.resource_type as string,
          id: row.resource_id as string,
          provider: (row.resource_provider as string) ?? undefined,
        }
      : undefined,
    parameters: row.parameters ? JSON.parse(row.parameters as string) : undefined,
    result: row.result as AuditResult,
    correlationId: (row.correlation_id as string) ?? undefined,
    sessionId: (row.session_id as string) ?? undefined,
    durationMs: (row.duration_ms as number) ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
  };
}

export class SQLiteAuditStorage implements AuditStorage {
  private db!: Database.Database;
  private readonly dbPath: string;

  private insertStmt!: Database.Statement;
  private insertBatchTransaction!: Database.Transaction<(events: AuditEvent[]) => void>;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_DDL);

    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO audit_events
        (id, timestamp, event_type, severity, actor_id, actor_name, actor_roles,
         actor_ip, actor_channel, actor_agent_id, operation, resource_type,
         resource_id, resource_provider, parameters, result, correlation_id,
         session_id, duration_ms, metadata)
      VALUES
        (@id, @timestamp, @event_type, @severity, @actor_id, @actor_name, @actor_roles,
         @actor_ip, @actor_channel, @actor_agent_id, @operation, @resource_type,
         @resource_id, @resource_provider, @parameters, @result, @correlation_id,
         @session_id, @duration_ms, @metadata)
    `);

    this.insertBatchTransaction = this.db.transaction((events: AuditEvent[]) => {
      for (const event of events) {
        this.insertStmt.run(eventToRow(event));
      }
    });
  }

  save(event: AuditEvent): void {
    this.insertStmt.run(eventToRow(event));
  }

  saveBatch(events: AuditEvent[]): void {
    if (events.length === 0) return;
    this.insertBatchTransaction(events);
  }

  query(filter: AuditQuery): AuditEvent[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.startDate) {
      conditions.push("timestamp >= @startDate");
      params.startDate = filter.startDate;
    }
    if (filter.endDate) {
      conditions.push("timestamp <= @endDate");
      params.endDate = filter.endDate;
    }
    if (filter.eventTypes?.length) {
      const placeholders = filter.eventTypes.map((_, i) => `@et${i}`);
      conditions.push(`event_type IN (${placeholders.join(", ")})`);
      filter.eventTypes.forEach((et, i) => {
        params[`et${i}`] = et;
      });
    }
    if (filter.actorIds?.length) {
      const placeholders = filter.actorIds.map((_, i) => `@ai${i}`);
      conditions.push(`actor_id IN (${placeholders.join(", ")})`);
      filter.actorIds.forEach((ai, i) => {
        params[`ai${i}`] = ai;
      });
    }
    if (filter.resourceTypes?.length) {
      const placeholders = filter.resourceTypes.map((_, i) => `@rt${i}`);
      conditions.push(`resource_type IN (${placeholders.join(", ")})`);
      filter.resourceTypes.forEach((rt, i) => {
        params[`rt${i}`] = rt;
      });
    }
    if (filter.severity?.length) {
      const placeholders = filter.severity.map((_, i) => `@sev${i}`);
      conditions.push(`severity IN (${placeholders.join(", ")})`);
      filter.severity.forEach((s, i) => {
        params[`sev${i}`] = s;
      });
    }
    if (filter.result?.length) {
      const placeholders = filter.result.map((_, i) => `@res${i}`);
      conditions.push(`result IN (${placeholders.join(", ")})`);
      filter.result.forEach((r, i) => {
        params[`res${i}`] = r;
      });
    }
    if (filter.correlationId) {
      conditions.push("correlation_id = @correlationId");
      params.correlationId = filter.correlationId;
    }
    if (filter.operation) {
      conditions.push("operation LIKE @operation");
      params.operation = `%${filter.operation}%`;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const sql = `SELECT * FROM audit_events ${where} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`;
    const rows = this.db.prepare(sql).all(params) as Record<string, unknown>[];
    return rows.map(rowToEvent);
  }

  getById(id: string): AuditEvent | undefined {
    const row = this.db
      .prepare("SELECT * FROM audit_events WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToEvent(row) : undefined;
  }

  getTimeline(resourceId: string, limit = 50): AuditEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM audit_events WHERE resource_id = ? ORDER BY timestamp DESC LIMIT ?")
      .all(resourceId, limit) as Record<string, unknown>[];
    return rows.map(rowToEvent);
  }

  getActorActivity(actorId: string, limit = 50): AuditEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM audit_events WHERE actor_id = ? ORDER BY timestamp DESC LIMIT ?")
      .all(actorId, limit) as Record<string, unknown>[];
    return rows.map(rowToEvent);
  }

  getSummary(startDate: string, endDate: string): AuditSummary {
    const base = "WHERE timestamp >= ? AND timestamp <= ?";

    const total = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM audit_events ${base}`)
      .get(startDate, endDate) as { cnt: number };

    const byType = this.db
      .prepare(`SELECT event_type, COUNT(*) as cnt FROM audit_events ${base} GROUP BY event_type`)
      .all(startDate, endDate) as { event_type: string; cnt: number }[];

    const byResult = this.db
      .prepare(`SELECT result, COUNT(*) as cnt FROM audit_events ${base} GROUP BY result`)
      .all(startDate, endDate) as { result: string; cnt: number }[];

    const bySeverity = this.db
      .prepare(`SELECT severity, COUNT(*) as cnt FROM audit_events ${base} GROUP BY severity`)
      .all(startDate, endDate) as { severity: string; cnt: number }[];

    const topActors = this.db
      .prepare(
        `SELECT actor_id, actor_name, COUNT(*) as cnt FROM audit_events ${base} GROUP BY actor_id ORDER BY cnt DESC LIMIT 10`,
      )
      .all(startDate, endDate) as { actor_id: string; actor_name: string; cnt: number }[];

    const topResources = this.db
      .prepare(
        `SELECT resource_id, resource_type, COUNT(*) as cnt FROM audit_events ${base} AND resource_id IS NOT NULL GROUP BY resource_id ORDER BY cnt DESC LIMIT 10`,
      )
      .all(startDate, endDate) as { resource_id: string; resource_type: string; cnt: number }[];

    const topOps = this.db
      .prepare(
        `SELECT operation, COUNT(*) as cnt FROM audit_events ${base} GROUP BY operation ORDER BY cnt DESC LIMIT 10`,
      )
      .all(startDate, endDate) as { operation: string; cnt: number }[];

    return {
      totalEvents: total.cnt,
      timeRange: { start: startDate, end: endDate },
      byType: Object.fromEntries(byType.map((r) => [r.event_type, r.cnt])),
      byResult: Object.fromEntries(byResult.map((r) => [r.result, r.cnt])),
      bySeverity: Object.fromEntries(bySeverity.map((r) => [r.severity, r.cnt])),
      topActors: topActors.map((r) => ({ id: r.actor_id, name: r.actor_name, count: r.cnt })),
      topResources: topResources.map((r) => ({ id: r.resource_id, type: r.resource_type, count: r.cnt })),
      topOperations: topOps.map((r) => ({ operation: r.operation, count: r.cnt })),
    };
  }

  getEventCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM audit_events").get() as { cnt: number };
    return row.cnt;
  }

  prune(beforeDate: string): number {
    const result = this.db.prepare("DELETE FROM audit_events WHERE timestamp < ?").run(beforeDate);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
