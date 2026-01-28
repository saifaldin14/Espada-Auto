/**
 * Infrastructure Audit Logger
 */

import type { AuditLogEntry, AuditEventType, AuditSeverity, Environment, AuditLogQuery, AuditLogResult } from "./types.js";

export type AuditConfig = {
  retentionDays: number;
  flushIntervalMs: number;
  maxBufferSize: number;
  sensitiveFields: string[];
  enableRealTimeProcessing: boolean;
};

export const defaultAuditConfig: AuditConfig = {
  retentionDays: 90,
  flushIntervalMs: 5000,
  maxBufferSize: 100,
  sensitiveFields: ["password", "secret", "token", "key", "credential"],
  enableRealTimeProcessing: true,
};

export interface AuditStorage {
  save(entry: AuditLogEntry): Promise<void>;
  saveBatch(entries: AuditLogEntry[]): Promise<void>;
  query(options: AuditLogQuery): Promise<AuditLogResult>;
  getById(id: string): Promise<AuditLogEntry | null>;
}

export class InMemoryAuditStorage implements AuditStorage {
  private entries: AuditLogEntry[] = [];

  async save(entry: AuditLogEntry): Promise<void> { this.entries.push(entry); }
  async saveBatch(entries: AuditLogEntry[]): Promise<void> { this.entries.push(...entries); }
  async getById(id: string): Promise<AuditLogEntry | null> { return this.entries.find(e => e.id === id) ?? null; }

  async query(options: AuditLogQuery): Promise<AuditLogResult> {
    let results = [...this.entries];
    if (options.startDate) results = results.filter(e => e.timestamp >= options.startDate!);
    if (options.endDate) results = results.filter(e => e.timestamp <= options.endDate!);
    if (options.eventTypes?.length) results = results.filter(e => options.eventTypes!.includes(e.eventType));
    if (options.actorIds?.length) results = results.filter(e => options.actorIds!.includes(e.actorId));
    if (options.environments?.length) results = results.filter(e => e.environment && options.environments!.includes(e.environment));
    if (options.severities?.length) results = results.filter(e => options.severities!.includes(e.severity));
    if (options.operationIds?.length) results = results.filter(e => e.operationId && options.operationIds!.includes(e.operationId));

    const dir = options.orderDirection === "asc" ? 1 : -1;
    if (options.orderBy === "severity") {
      const sev: Record<AuditSeverity, number> = { info: 1, warning: 2, critical: 3 };
      results.sort((a, b) => (sev[a.severity] - sev[b.severity]) * dir);
    } else {
      results.sort((a, b) => (a.timestamp.getTime() - b.timestamp.getTime()) * dir);
    }

    const total = results.length;
    if (options.offset) results = results.slice(options.offset);
    if (options.limit) results = results.slice(0, options.limit);

    return { entries: results, total, hasMore: (options.offset ?? 0) + results.length < total };
  }
}

export class InfrastructureAuditLogger {
  private config: AuditConfig;
  private storage: AuditStorage;
  private buffer: AuditLogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private correlationId: string | null = null;
  private sessionId: string | null = null;

  constructor(options: { config?: Partial<AuditConfig>; storage?: AuditStorage }) {
    this.config = { ...defaultAuditConfig, ...options.config };
    this.storage = options.storage ?? new InMemoryAuditStorage();
    if (this.config.enableRealTimeProcessing) this.startFlushTimer();
  }

  setCorrelationId(id: string | null): void { this.correlationId = id; }
  setSessionId(id: string | null): void { this.sessionId = id; }

  async log(options: {
    eventType: AuditEventType;
    severity: AuditSeverity;
    actorId: string;
    actorName?: string;
    actorRoles?: string[];
    operationId?: string;
    commandId?: string;
    commandName?: string;
    environment?: Environment;
    resourceIds?: string[];
    parameters?: Record<string, unknown>;
    result?: "success" | "failure" | "pending";
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLogEntry> {
    const entry: AuditLogEntry = {
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(),
      eventType: options.eventType,
      severity: options.severity,
      actorId: options.actorId,
      actorName: options.actorName,
      actorRoles: options.actorRoles,
      operationId: options.operationId,
      commandId: options.commandId,
      commandName: options.commandName,
      environment: options.environment,
      resourceIds: options.resourceIds,
      parameters: options.parameters ? this.sanitizeParameters(options.parameters) : undefined,
      result: options.result,
      errorMessage: options.errorMessage,
      metadata: options.metadata,
      correlationId: this.correlationId ?? undefined,
      sessionId: this.sessionId ?? undefined,
    };

    if (this.config.enableRealTimeProcessing) {
      this.buffer.push(entry);
      if (this.buffer.length >= this.config.maxBufferSize) await this.flush();
    } else {
      await this.storage.save(entry);
    }
    return entry;
  }

  async logCommandExecution(options: {
    operationId: string;
    commandId: string;
    commandName: string;
    parameters: Record<string, unknown>;
    actorId: string;
    actorName: string;
    environment: Environment;
    result: "success" | "failure";
    errorMessage?: string;
    durationMs?: number;
  }): Promise<AuditLogEntry> {
    return this.log({
      eventType: options.result === "success" ? "command_executed" : "command_failed",
      severity: options.result === "success" ? "info" : "warning",
      actorId: options.actorId,
      actorName: options.actorName,
      operationId: options.operationId,
      commandId: options.commandId,
      commandName: options.commandName,
      parameters: options.parameters,
      environment: options.environment,
      result: options.result,
      errorMessage: options.errorMessage,
      metadata: options.durationMs ? { durationMs: options.durationMs } : undefined,
    });
  }

  async logAccessDenied(options: {
    operationId: string;
    commandId: string;
    commandName: string;
    actorId: string;
    actorName: string;
    environment: Environment;
    reason: string;
  }): Promise<AuditLogEntry> {
    return this.log({
      eventType: "access_denied",
      severity: "warning",
      actorId: options.actorId,
      actorName: options.actorName,
      operationId: options.operationId,
      commandId: options.commandId,
      commandName: options.commandName,
      environment: options.environment,
      result: "failure",
      errorMessage: options.reason,
    });
  }

  async logSessionEvent(options: {
    actorId: string;
    actorName: string;
    environment: Environment;
    eventType: "session_started" | "session_ended";
    metadata?: Record<string, unknown>;
  }): Promise<AuditLogEntry> {
    return this.log({
      eventType: options.eventType,
      severity: "info",
      actorId: options.actorId,
      actorName: options.actorName,
      environment: options.environment,
      result: "success",
      metadata: options.metadata,
    });
  }

  async logBreakGlassEvent(options: {
    eventType: "break_glass_activated" | "break_glass_deactivated";
    actorId: string;
    actorName: string;
    environment: Environment;
    sessionId: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLogEntry> {
    return this.log({
      eventType: options.eventType,
      severity: "critical",
      actorId: options.actorId,
      actorName: options.actorName,
      environment: options.environment,
      result: "success",
      metadata: { ...options.metadata, breakGlassSessionId: options.sessionId, reason: options.reason },
    });
  }

  async query(options: AuditLogQuery): Promise<AuditLogResult> {
    await this.flush();
    return this.storage.query(options);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const entries = [...this.buffer];
    this.buffer = [];
    await this.storage.saveBatch(entries);
  }

  destroy(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);
  }

  private sanitizeParameters(params: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (this.config.sensitiveFields.some(f => key.toLowerCase().includes(f))) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = this.sanitizeParameters(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}

export function createAuditLogger(options: { config?: Partial<AuditConfig>; storage?: AuditStorage } = {}): InfrastructureAuditLogger {
  return new InfrastructureAuditLogger(options);
}
