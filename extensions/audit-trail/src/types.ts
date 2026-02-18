/**
 * Persistent Audit Trail — Core Types
 *
 * Unified audit event model for tracking all operations across Espada subsystems.
 * Built on the infrastructure extension's audit types, promoted to a shared system.
 */

// ─── Event Types ───────────────────────────────────────────────────────────────

export type AuditEventType =
  | "command_executed"
  | "tool_invoked"
  | "policy_evaluated"
  | "approval_requested"
  | "approval_granted"
  | "approval_denied"
  | "state_changed"
  | "config_changed"
  | "auth_login"
  | "auth_logout"
  | "auth_failed"
  | "resource_created"
  | "resource_updated"
  | "resource_deleted"
  | "drift_detected"
  | "alert_triggered"
  | "break_glass_activated"
  | "role_assigned"
  | "role_removed"
  | "policy_created"
  | "policy_deleted"
  | "compliance_scanned"
  | "blueprint_deployed"
  | "terraform_plan"
  | "terraform_apply";

export type AuditSeverity = "info" | "warn" | "error" | "critical";
export type AuditResult = "success" | "failure" | "pending" | "denied";

// ─── Core Event ────────────────────────────────────────────────────────────────

export type AuditActor = {
  id: string;
  name: string;
  roles: string[];
  ip?: string;
  channel?: string;
  agentId?: string;
};

export type AuditResource = {
  type: string;
  id: string;
  provider?: string;
};

export type AuditEvent = {
  id: string;
  timestamp: string; // ISO-8601
  eventType: AuditEventType;
  severity: AuditSeverity;
  actor: AuditActor;
  operation: string;
  resource?: AuditResource;
  parameters?: Record<string, unknown>;
  result: AuditResult;
  correlationId?: string;
  sessionId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

// ─── Query Types ───────────────────────────────────────────────────────────────

export type AuditQuery = {
  startDate?: string;
  endDate?: string;
  eventTypes?: AuditEventType[];
  actorIds?: string[];
  resourceTypes?: string[];
  severity?: AuditSeverity[];
  result?: AuditResult[];
  correlationId?: string;
  operation?: string;
  limit?: number;
  offset?: number;
};

export type AuditSummary = {
  totalEvents: number;
  timeRange: { start: string; end: string };
  byType: Partial<Record<AuditEventType, number>>;
  byResult: Partial<Record<AuditResult, number>>;
  bySeverity: Partial<Record<AuditSeverity, number>>;
  topActors: { id: string; name: string; count: number }[];
  topResources: { id: string; type: string; count: number }[];
  topOperations: { operation: string; count: number }[];
};

export type AuditTimeline = {
  resourceId: string;
  resourceType: string;
  events: AuditEvent[];
  firstSeen: string;
  lastSeen: string;
};

// ─── Input Types ───────────────────────────────────────────────────────────────

export type AuditEventInput = Omit<AuditEvent, "id" | "timestamp"> & {
  timestamp?: string;
};

// ─── Storage Interface ─────────────────────────────────────────────────────────

export interface AuditStorage {
  initialize(): Promise<void>;
  save(event: AuditEvent): void;
  saveBatch(events: AuditEvent[]): void;
  query(filter: AuditQuery): AuditEvent[];
  getById(id: string): AuditEvent | undefined;
  getTimeline(resourceId: string, limit?: number): AuditEvent[];
  getActorActivity(actorId: string, limit?: number): AuditEvent[];
  getSummary(startDate: string, endDate: string): AuditSummary;
  getEventCount(): number;
  prune(beforeDate: string): number;
  close(): void;
}

// ─── Configuration ─────────────────────────────────────────────────────────────

export type AuditConfig = {
  storage: { type: "sqlite" | "memory"; path?: string };
  retentionDays: number;
  flushIntervalMs: number;
  maxBufferSize: number;
  sensitiveFields: string[];
};

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  storage: { type: "sqlite", path: "~/.espada/audit.db" },
  retentionDays: 90,
  flushIntervalMs: 1000,
  maxBufferSize: 100,
  sensitiveFields: [
    "password",
    "secret",
    "token",
    "apiKey",
    "api_key",
    "accessKey",
    "access_key",
    "secretKey",
    "secret_key",
    "privateKey",
    "private_key",
    "credential",
    "authorization",
  ],
};

// ─── Sensitive field list for redaction ─────────────────────────────────────

export const REDACTED = "[REDACTED]";
