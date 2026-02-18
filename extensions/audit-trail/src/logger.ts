/**
 * Persistent Audit Trail — Logger
 *
 * Buffered audit logger with sensitive field redaction, correlation ID propagation,
 * and automatic retention-based pruning. This is the primary interface for
 * all subsystems to emit audit events.
 */

import { randomUUID } from "node:crypto";
import type {
  AuditStorage,
  AuditEvent,
  AuditEventInput,
  AuditConfig,
  AuditQuery,
  AuditSummary,
  AuditTimeline,
  AuditSeverity,
  AuditActor,
  AuditResource,
  AuditEventType,
  AuditResult,
} from "./types.js";
import { DEFAULT_AUDIT_CONFIG, REDACTED } from "./types.js";

export class AuditLogger {
  private readonly storage: AuditStorage;
  private readonly config: AuditConfig;
  private buffer: AuditEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastPruneDate: string | null = null;

  constructor(storage: AuditStorage, config?: Partial<AuditConfig>) {
    this.storage = storage;
    this.config = { ...DEFAULT_AUDIT_CONFIG, ...config };
  }

  /** Start the flush timer and run initial pruning */
  start(): void {
    if (this.config.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);
      // Unref so it doesn't keep the process alive
      if (this.flushTimer && typeof this.flushTimer === "object" && "unref" in this.flushTimer) {
        (this.flushTimer as NodeJS.Timeout).unref();
      }
    }
    this.pruneIfNeeded();
  }

  /** Stop the flush timer and flush remaining events */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  // ─── Core Logging ──────────────────────────────────────────────────────────

  /** Log an audit event (buffered) */
  log(input: AuditEventInput): AuditEvent {
    const event: AuditEvent = {
      ...input,
      id: randomUUID(),
      timestamp: input.timestamp ?? new Date().toISOString(),
      parameters: input.parameters ? this.redactSensitive(input.parameters) : undefined,
      metadata: input.metadata ? this.redactSensitive(input.metadata) : undefined,
    };

    this.buffer.push(event);

    if (this.buffer.length >= this.config.maxBufferSize) {
      this.flush();
    }

    return event;
  }

  // ─── Convenience Methods ───────────────────────────────────────────────────

  /** Log a tool invocation */
  logToolInvocation(
    actor: AuditActor,
    toolName: string,
    params: Record<string, unknown>,
    result: AuditResult,
    durationMs?: number,
    correlationId?: string,
  ): AuditEvent {
    return this.log({
      eventType: "tool_invoked",
      severity: "info",
      actor,
      operation: `tool:${toolName}`,
      parameters: params,
      result,
      durationMs,
      correlationId,
    });
  }

  /** Log a command execution */
  logCommand(
    actor: AuditActor,
    command: string,
    params: Record<string, unknown>,
    result: AuditResult,
    durationMs?: number,
  ): AuditEvent {
    return this.log({
      eventType: "command_executed",
      severity: "info",
      actor,
      operation: `command:${command}`,
      parameters: params,
      result,
      durationMs,
    });
  }

  /** Log an authentication event */
  logAuth(
    actor: AuditActor,
    action: "login" | "logout" | "failed",
    method: string,
    severity: AuditSeverity = "info",
  ): AuditEvent {
    const typeMap: Record<string, AuditEventType> = {
      login: "auth_login",
      logout: "auth_logout",
      failed: "auth_failed",
    };
    return this.log({
      eventType: typeMap[action],
      severity: action === "failed" ? "warn" : severity,
      actor,
      operation: `auth:${action}`,
      result: action === "failed" ? "failure" : "success",
      metadata: { method },
    });
  }

  /** Log a resource change */
  logResourceChange(
    actor: AuditActor,
    action: "created" | "updated" | "deleted",
    resource: AuditResource,
    details?: Record<string, unknown>,
    correlationId?: string,
  ): AuditEvent {
    const typeMap: Record<string, AuditEventType> = {
      created: "resource_created",
      updated: "resource_updated",
      deleted: "resource_deleted",
    };
    return this.log({
      eventType: typeMap[action],
      severity: action === "deleted" ? "warn" : "info",
      actor,
      operation: `resource:${action}`,
      resource,
      metadata: details,
      result: "success",
      correlationId,
    });
  }

  /** Log a policy evaluation */
  logPolicyEvaluation(
    actor: AuditActor,
    policyId: string,
    resource: AuditResource | undefined,
    result: AuditResult,
    details?: Record<string, unknown>,
  ): AuditEvent {
    return this.log({
      eventType: "policy_evaluated",
      severity: result === "denied" ? "warn" : "info",
      actor,
      operation: `policy:evaluate:${policyId}`,
      resource,
      result,
      metadata: details,
    });
  }

  /** Log a config change */
  logConfigChange(
    actor: AuditActor,
    key: string,
    previousValue: unknown,
    newValue: unknown,
  ): AuditEvent {
    return this.log({
      eventType: "config_changed",
      severity: "warn",
      actor,
      operation: `config:set:${key}`,
      result: "success",
      metadata: {
        key,
        previousValue: this.redactValue(key, previousValue),
        newValue: this.redactValue(key, newValue),
      },
    });
  }

  /** Log a Terraform operation */
  logTerraform(
    actor: AuditActor,
    action: "plan" | "apply",
    details: Record<string, unknown>,
    result: AuditResult,
    durationMs?: number,
  ): AuditEvent {
    return this.log({
      eventType: action === "plan" ? "terraform_plan" : "terraform_apply",
      severity: action === "apply" ? "warn" : "info",
      actor,
      operation: `terraform:${action}`,
      result,
      metadata: details,
      durationMs,
    });
  }

  // ─── Querying ──────────────────────────────────────────────────────────────

  /** Query audit events with filters */
  query(filter: AuditQuery): AuditEvent[] {
    this.flush();
    return this.storage.query(filter);
  }

  /** Get a specific event by ID */
  getById(id: string): AuditEvent | undefined {
    this.flush();
    return this.storage.getById(id);
  }

  /** Get chronological events for a resource */
  getTimeline(resourceId: string, limit?: number): AuditTimeline {
    this.flush();
    const events = this.storage.getTimeline(resourceId, limit);
    const resourceType = events[0]?.resource?.type ?? "unknown";
    return {
      resourceId,
      resourceType,
      events,
      firstSeen: events.length > 0 ? events[events.length - 1].timestamp : "",
      lastSeen: events.length > 0 ? events[0].timestamp : "",
    };
  }

  /** Get all actions by an actor */
  getActorActivity(actorId: string, limit?: number): AuditEvent[] {
    this.flush();
    return this.storage.getActorActivity(actorId, limit);
  }

  /** Get aggregated summary for a time range */
  getSummary(startDate: string, endDate: string): AuditSummary {
    this.flush();
    return this.storage.getSummary(startDate, endDate);
  }

  /** Get total event count */
  getEventCount(): number {
    return this.storage.getEventCount() + this.buffer.length;
  }

  // ─── Maintenance ───────────────────────────────────────────────────────────

  /** Flush buffered events to storage */
  flush(): void {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    this.storage.saveBatch(events);
  }

  /** Prune events older than retention period */
  prune(): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.retentionDays);
    const pruned = this.storage.prune(cutoff.toISOString());
    this.lastPruneDate = new Date().toISOString();
    return pruned;
  }

  /** Export events matching filter as JSON */
  exportEvents(filter: AuditQuery): string {
    const events = this.query(filter);
    return JSON.stringify(events, null, 2);
  }

  /** Export events matching filter as CSV */
  exportCSV(filter: AuditQuery): string {
    const events = this.query(filter);
    const headers = [
      "id",
      "timestamp",
      "eventType",
      "severity",
      "actorId",
      "actorName",
      "operation",
      "resourceType",
      "resourceId",
      "result",
      "correlationId",
      "durationMs",
    ];
    const rows = events.map((e) =>
      [
        e.id,
        e.timestamp,
        e.eventType,
        e.severity,
        e.actor.id,
        e.actor.name,
        e.operation,
        e.resource?.type ?? "",
        e.resource?.id ?? "",
        e.result,
        e.correlationId ?? "",
        e.durationMs?.toString() ?? "",
      ]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(","),
    );
    return [headers.join(","), ...rows].join("\n");
  }

  /** Close the logger cleanly */
  close(): void {
    this.stop();
    this.storage.close();
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private pruneIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastPruneDate?.startsWith(today)) return;
    // Run pruning in background — don't block initialization
    try {
      this.prune();
    } catch {
      // Pruning failure is non-fatal
    }
  }

  /** Redact sensitive fields from an object */
  private redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (this.isSensitiveKey(key)) {
        result[key] = REDACTED;
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        result[key] = this.redactSensitive(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /** Check if a key name indicates sensitive data */
  private isSensitiveKey(key: string): boolean {
    const lower = key.toLowerCase();
    return this.config.sensitiveFields.some((f) => lower.includes(f.toLowerCase()));
  }

  /** Redact a single value if its key is sensitive */
  private redactValue(key: string, value: unknown): unknown {
    if (this.isSensitiveKey(key)) return REDACTED;
    return value;
  }
}
