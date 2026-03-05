/**
 * Enterprise Event Bus & Outbound Webhook System
 *
 * Unified event bus that replaces the bare Set<fn>-based event systems
 * with a structured, typed event bus supporting:
 *
 * - Internal pub/sub (typed events with namespaces)
 * - Outbound webhook registration with HMAC-SHA256 signing
 * - Retry with exponential backoff
 * - Dead-letter storage for failed deliveries
 * - Event catalog and schema discovery
 * - Pluggable transport (in-process, Redis, etc.)
 *
 */

import Database from "better-sqlite3";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { EventEmitter } from "node:events";

// =============================================================================
// Types
// =============================================================================

export type EventNamespace =
  | "agent"
  | "diagnostic"
  | "audit"
  | "gateway"
  | "tool"
  | "rbac"
  | "sso"
  | "config"
  | "infra"
  | "task"
  | "plugin"
  | "custom";

export interface BusEvent<T = unknown> {
  /** Auto-generated event ID */
  id: string;

  /** Dot-separated event name, e.g. 'agent.lifecycle.started' */
  name: string;

  /** Top-level namespace */
  namespace: EventNamespace;

  /** ISO timestamp */
  timestamp: string;

  /** Typed payload */
  data: T;

  /** Source component/module */
  source?: string;

  /** Correlation ID for tracing across services */
  correlationId?: string;

  /** Metadata tags */
  tags?: Record<string, string>;
}

export interface WebhookRegistration {
  /** Unique webhook ID */
  id: string;

  /** Human-readable label */
  name: string;

  /** URL to POST events to */
  url: string;

  /** Event patterns to subscribe (glob), e.g. 'agent.*', 'audit.rbac.*' */
  eventPatterns: string[];

  /** HMAC secret for signing payloads */
  secret: string;

  /** Active flag */
  enabled: boolean;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Max retry attempts (default: 5) */
  maxRetries: number;

  /** Created timestamp */
  createdAt: string;

  /** Updated timestamp */
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  eventName: string;
  url: string;
  status: "pending" | "delivered" | "failed" | "dead-letter";
  httpStatus?: number;
  attempts: number;
  maxRetries: number;
  nextRetryAt?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export type EventHandler<T = unknown> = (event: BusEvent<T>) => void | Promise<void>;

export interface EventSubscription {
  /** Pattern (glob) to match event names */
  pattern: string;
  /** Handler function */
  handler: EventHandler;
  /** Unsubscribe function */
  unsubscribe: () => void;
}

// =============================================================================
// EventBus
// =============================================================================

/**
 * Enterprise event bus with typed events, outbound webhook delivery,
 * and HMAC-signed payloads.
 */
export class EventBus extends EventEmitter {
  private db: Database.Database;
  private subscriptions = new Map<string, Set<EventHandler>>();
  private webhookCache: WebhookRegistration[] = [];
  private deliveryTimer: ReturnType<typeof setInterval> | null = null;
  private isClosing = false;

  constructor(dbPath: string) {
    super();

    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");

    this.createTables();
    this.loadWebhooks();
    this.startDeliveryWorker();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        url             TEXT NOT NULL,
        event_patterns  TEXT NOT NULL DEFAULT '[]',
        secret          TEXT NOT NULL,
        enabled         INTEGER NOT NULL DEFAULT 1,
        headers         TEXT DEFAULT NULL,
        max_retries     INTEGER NOT NULL DEFAULT 5,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id              TEXT PRIMARY KEY,
        webhook_id      TEXT NOT NULL,
        event_id        TEXT NOT NULL,
        event_name      TEXT NOT NULL,
        url             TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        http_status     INTEGER DEFAULT NULL,
        attempts        INTEGER NOT NULL DEFAULT 0,
        max_retries     INTEGER NOT NULL DEFAULT 5,
        next_retry_at   TEXT DEFAULT NULL,
        error           TEXT DEFAULT NULL,
        payload         TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        completed_at    TEXT DEFAULT NULL,
        FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_delivery_status
        ON webhook_deliveries(status);
      CREATE INDEX IF NOT EXISTS idx_delivery_next_retry
        ON webhook_deliveries(status, next_retry_at);
      CREATE INDEX IF NOT EXISTS idx_delivery_webhook
        ON webhook_deliveries(webhook_id);
      CREATE INDEX IF NOT EXISTS idx_delivery_event
        ON webhook_deliveries(event_id);

      CREATE TABLE IF NOT EXISTS event_catalog (
        name           TEXT PRIMARY KEY,
        namespace      TEXT NOT NULL,
        description    TEXT DEFAULT NULL,
        schema_json    TEXT DEFAULT NULL,
        first_seen     TEXT NOT NULL,
        last_seen      TEXT NOT NULL,
        count          INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  private loadWebhooks(): void {
    const rows = this.db.prepare("SELECT * FROM webhooks WHERE enabled = 1").all() as WebhookRow[];
    this.webhookCache = rows.map(rowToWebhook);
  }

  private startDeliveryWorker(): void {
    this.deliveryTimer = setInterval(() => {
      void this.processDeliveries();
    }, 5_000);
  }

  // ===========================================================================
  // Pub/Sub
  // ===========================================================================

  /**
   * Publish an event into the bus. Dispatches to in-process subscribers
   * and queues outbound webhook deliveries.
   */
  publish<T = unknown>(params: {
    name: string;
    namespace?: EventNamespace;
    data: T;
    source?: string;
    correlationId?: string;
    tags?: Record<string, string>;
  }): BusEvent<T> {
    const namespace = params.namespace ?? (params.name.split(".")[0] as EventNamespace) ?? "custom";

    const event: BusEvent<T> = {
      id: randomUUID(),
      name: params.name,
      namespace,
      timestamp: new Date().toISOString(),
      data: params.data,
      source: params.source,
      correlationId: params.correlationId,
      tags: params.tags,
    };

    // Update event catalog
    this.db
      .prepare(`
        INSERT INTO event_catalog (name, namespace, first_seen, last_seen, count)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(name) DO UPDATE SET
          last_seen = excluded.last_seen,
          count = count + 1
      `)
      .run(event.name, namespace, event.timestamp, event.timestamp);

    // Dispatch to in-process subscribers
    for (const [pattern, handlers] of this.subscriptions) {
      if (matchEventPattern(pattern, event.name)) {
        for (const handler of handlers) {
          try {
            const result = handler(event);
            if (result instanceof Promise) {
              result.catch(() => {
                /* ignore async handler failures */
              });
            }
          } catch {
            /* ignore synchronous handler failures */
          }
        }
      }
    }

    // Queue webhook deliveries
    this.queueWebhookDeliveries(event);

    // Emit for EventEmitter listeners
    this.emit("event", event);
    this.emit(event.name, event);

    return event;
  }

  /**
   * Subscribe to events matching a pattern.
   * Supports dot-path glob: 'agent.*', 'audit.rbac.*', '*'
   */
  subscribe<T = unknown>(pattern: string, handler: EventHandler<T>): EventSubscription {
    if (!this.subscriptions.has(pattern)) {
      this.subscriptions.set(pattern, new Set());
    }

    const handlers = this.subscriptions.get(pattern)!;
    const wrappedHandler = handler as EventHandler;
    handlers.add(wrappedHandler);

    const unsubscribe = () => {
      handlers.delete(wrappedHandler);
      if (handlers.size === 0) {
        this.subscriptions.delete(pattern);
      }
    };

    return { pattern, handler: wrappedHandler, unsubscribe };
  }

  // ===========================================================================
  // Webhook Management
  // ===========================================================================

  /**
   * Register an outbound webhook.
   */
  registerWebhook(params: {
    name: string;
    url: string;
    eventPatterns: string[];
    secret?: string;
    headers?: Record<string, string>;
    maxRetries?: number;
  }): WebhookRegistration {
    const id = randomUUID();
    const now = new Date().toISOString();
    const secret = params.secret ?? randomUUID();

    this.db
      .prepare(`
        INSERT INTO webhooks (id, name, url, event_patterns, secret, headers, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        params.name,
        params.url,
        JSON.stringify(params.eventPatterns),
        secret,
        params.headers ? JSON.stringify(params.headers) : null,
        params.maxRetries ?? 5,
        now,
        now,
      );

    this.loadWebhooks();
    return this.webhookCache.find((w) => w.id === id)!;
  }

  /**
   * Update a webhook registration.
   */
  updateWebhook(
    id: string,
    updates: Partial<
      Pick<
        WebhookRegistration,
        "name" | "url" | "eventPatterns" | "enabled" | "headers" | "maxRetries"
      >
    >,
  ): WebhookRegistration | null {
    const existing = this.db.prepare("SELECT * FROM webhooks WHERE id = ?").get(id) as
      | WebhookRow
      | undefined;
    if (!existing) return null;

    const now = new Date().toISOString();

    this.db
      .prepare(`
        UPDATE webhooks SET
          name = COALESCE(?, name),
          url = COALESCE(?, url),
          event_patterns = COALESCE(?, event_patterns),
          enabled = COALESCE(?, enabled),
          headers = COALESCE(?, headers),
          max_retries = COALESCE(?, max_retries),
          updated_at = ?
        WHERE id = ?
      `)
      .run(
        updates.name ?? null,
        updates.url ?? null,
        updates.eventPatterns ? JSON.stringify(updates.eventPatterns) : null,
        updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : null,
        updates.headers ? JSON.stringify(updates.headers) : null,
        updates.maxRetries ?? null,
        now,
        id,
      );

    this.loadWebhooks();
    return this.webhookCache.find((w) => w.id === id) ?? null;
  }

  /**
   * Remove a webhook registration and all its deliveries.
   */
  deleteWebhook(id: string): boolean {
    const result = this.db.prepare("DELETE FROM webhooks WHERE id = ?").run(id);
    this.loadWebhooks();
    return result.changes > 0;
  }

  /**
   * List all webhook registrations.
   */
  listWebhooks(): WebhookRegistration[] {
    const rows = this.db
      .prepare("SELECT * FROM webhooks ORDER BY created_at DESC")
      .all() as WebhookRow[];
    return rows.map(rowToWebhook);
  }

  /**
   * Get delivery history for a webhook.
   */
  getDeliveries(
    webhookId: string,
    options?: { limit?: number; offset?: number; status?: string },
  ): WebhookDelivery[] {
    const conditions: string[] = ["webhook_id = ?"];
    const params: unknown[] = [webhookId];

    if (options?.status) {
      conditions.push("status = ?");
      params.push(options.status);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM webhook_deliveries ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as DeliveryRow[];

    return rows.map(rowToDelivery);
  }

  /**
   * Retry a dead-lettered delivery.
   */
  retryDelivery(deliveryId: string): boolean {
    const result = this.db
      .prepare(`
        UPDATE webhook_deliveries
        SET status = 'pending', attempts = 0, next_retry_at = NULL, error = NULL
        WHERE id = ? AND status = 'dead-letter'
      `)
      .run(deliveryId);
    return result.changes > 0;
  }

  // ===========================================================================
  // Event Catalog
  // ===========================================================================

  /**
   * Get the event catalog (all known event types).
   */
  getCatalog(): Array<{
    name: string;
    namespace: string;
    description: string | null;
    count: number;
    firstSeen: string;
    lastSeen: string;
  }> {
    const rows = this.db.prepare("SELECT * FROM event_catalog ORDER BY name ASC").all() as Array<{
      name: string;
      namespace: string;
      description: string | null;
      schema_json: string | null;
      first_seen: string;
      last_seen: string;
      count: number;
    }>;

    return rows.map((r) => ({
      name: r.name,
      namespace: r.namespace,
      description: r.description,
      count: r.count,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
    }));
  }

  // ===========================================================================
  // Internal: Webhook Delivery
  // ===========================================================================

  private queueWebhookDeliveries(event: BusEvent): void {
    const now = new Date().toISOString();
    const payload = JSON.stringify(event);

    for (const webhook of this.webhookCache) {
      if (!webhook.enabled) continue;
      if (!webhook.eventPatterns.some((p) => matchEventPattern(p, event.name))) continue;

      const deliveryId = randomUUID();

      this.db
        .prepare(`
          INSERT INTO webhook_deliveries
            (id, webhook_id, event_id, event_name, url, status, max_retries, payload, created_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `)
        .run(
          deliveryId,
          webhook.id,
          event.id,
          event.name,
          webhook.url,
          webhook.maxRetries,
          payload,
          now,
        );
    }
  }

  private async processDeliveries(): Promise<void> {
    if (this.isClosing) return;

    const now = new Date().toISOString();

    // Fetch pending deliveries ready for delivery/retry
    const pending = this.db
      .prepare(`
        SELECT d.*, w.secret, w.headers as webhook_headers
        FROM webhook_deliveries d
        JOIN webhooks w ON d.webhook_id = w.id
        WHERE d.status IN ('pending')
          AND (d.next_retry_at IS NULL OR d.next_retry_at <= ?)
        ORDER BY d.created_at ASC
        LIMIT 50
      `)
      .all(now) as Array<DeliveryRow & { secret: string; webhook_headers: string | null }>;

    for (const delivery of pending) {
      if (this.isClosing) break;
      await this.deliver(delivery, delivery.secret, delivery.webhook_headers);
    }
  }

  private async deliver(
    delivery: DeliveryRow & { secret: string; webhook_headers: string | null },
    secret: string,
    webhookHeadersJson: string | null,
  ): Promise<void> {
    const attempt = delivery.attempts + 1;

    // Compute HMAC signature
    const signature = createHmac("sha256", secret).update(delivery.payload).digest("hex");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Webhook-Id": delivery.webhook_id,
      "X-Webhook-Signature": `sha256=${signature}`,
      "X-Webhook-Timestamp": new Date().toISOString(),
      "X-Event-Id": delivery.event_id,
      "X-Event-Name": delivery.event_name,
      "X-Delivery-Id": delivery.id,
    };

    if (webhookHeadersJson) {
      try {
        const custom = JSON.parse(webhookHeadersJson) as Record<string, string>;
        // Apply custom headers first, then overwrite protected headers below
        for (const [k, v] of Object.entries(custom)) {
          // Block overriding security/integrity headers
          const lower = k.toLowerCase();
          if (
            lower.startsWith("x-webhook-") ||
            lower.startsWith("x-event-") ||
            lower.startsWith("x-delivery-")
          )
            continue;
          headers[k] = v;
        }
      } catch {
        /* ignore */
      }
    }

    try {
      const response = await fetch(delivery.url, {
        method: "POST",
        headers,
        body: delivery.payload,
        signal: AbortSignal.timeout(30_000),
      });

      if (response.ok) {
        // Delivered
        this.db
          .prepare(`
            UPDATE webhook_deliveries
            SET status = 'delivered', http_status = ?, attempts = ?, completed_at = ?
            WHERE id = ?
          `)
          .run(response.status, attempt, new Date().toISOString(), delivery.id);
      } else {
        // HTTP error
        this.handleDeliveryFailure(
          delivery.id,
          attempt,
          delivery.max_retries,
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
        );
      }
    } catch (err) {
      this.handleDeliveryFailure(
        delivery.id,
        attempt,
        delivery.max_retries,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private handleDeliveryFailure(
    deliveryId: string,
    attempt: number,
    maxRetries: number,
    error: string,
    httpStatus?: number,
  ): void {
    if (attempt >= maxRetries) {
      // Move to dead letter
      this.db
        .prepare(`
          UPDATE webhook_deliveries
          SET status = 'dead-letter', attempts = ?, error = ?, http_status = ?, completed_at = ?
          WHERE id = ?
        `)
        .run(attempt, error, httpStatus ?? null, new Date().toISOString(), deliveryId);
    } else {
      // Schedule retry with exponential backoff + jitter
      const baseDelay = 1000;
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
      const nextRetryAt = new Date(Date.now() + delay).toISOString();

      this.db
        .prepare(`
          UPDATE webhook_deliveries
          SET status = 'pending', attempts = ?, error = ?, http_status = ?, next_retry_at = ?
          WHERE id = ?
        `)
        .run(attempt, error, httpStatus ?? null, nextRetryAt, deliveryId);
    }
  }

  // ===========================================================================
  // Cleanup & Stats
  // ===========================================================================

  /**
   * Prune old delivered/dead-lettered deliveries.
   */
  pruneDeliveries(olderThanDays = 30): number {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db
      .prepare(
        "DELETE FROM webhook_deliveries WHERE status IN ('delivered', 'dead-letter') AND created_at < ?",
      )
      .run(cutoff);
    return result.changes;
  }

  /**
   * Get delivery stats for a webhook.
   */
  getDeliveryStats(webhookId?: string): {
    total: number;
    pending: number;
    delivered: number;
    failed: number;
    deadLetter: number;
  } {
    const where = webhookId ? "WHERE webhook_id = ?" : "";
    const params = webhookId ? [webhookId] : [];

    const rows = this.db
      .prepare(`SELECT status, COUNT(*) as count FROM webhook_deliveries ${where} GROUP BY status`)
      .all(...params) as Array<{ status: string; count: number }>;

    const stats = { total: 0, pending: 0, delivered: 0, failed: 0, deadLetter: 0 };
    for (const row of rows) {
      stats.total += row.count;
      switch (row.status) {
        case "pending":
          stats.pending = row.count;
          break;
        case "delivered":
          stats.delivered = row.count;
          break;
        case "failed":
          stats.failed = row.count;
          break;
        case "dead-letter":
          stats.deadLetter = row.count;
          break;
      }
    }
    return stats;
  }

  /** Close the event bus. */
  close(): void {
    this.isClosing = true;
    if (this.deliveryTimer) {
      clearInterval(this.deliveryTimer);
      this.deliveryTimer = null;
    }
    this.subscriptions.clear();
    this.db.close();
  }
}

// =============================================================================
// Row types and converters
// =============================================================================

type WebhookRow = {
  id: string;
  name: string;
  url: string;
  event_patterns: string;
  secret: string;
  enabled: number;
  headers: string | null;
  max_retries: number;
  created_at: string;
  updated_at: string;
};

type DeliveryRow = {
  id: string;
  webhook_id: string;
  event_id: string;
  event_name: string;
  url: string;
  status: string;
  http_status: number | null;
  attempts: number;
  max_retries: number;
  next_retry_at: string | null;
  error: string | null;
  payload: string;
  created_at: string;
  completed_at: string | null;
};

function rowToWebhook(row: WebhookRow): WebhookRegistration {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    eventPatterns: (() => {
      try {
        return JSON.parse(row.event_patterns) as string[];
      } catch {
        return [];
      }
    })(),
    secret: row.secret,
    enabled: row.enabled === 1,
    headers: (() => {
      try {
        return row.headers ? (JSON.parse(row.headers) as Record<string, string>) : undefined;
      } catch {
        return undefined;
      }
    })(),
    maxRetries: row.max_retries,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    eventId: row.event_id,
    eventName: row.event_name,
    url: row.url,
    status: row.status as WebhookDelivery["status"],
    httpStatus: row.http_status ?? undefined,
    attempts: row.attempts,
    maxRetries: row.max_retries,
    nextRetryAt: row.next_retry_at ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

// =============================================================================
// Pattern matching
// =============================================================================

const eventPatternCache = new Map<string, RegExp>();

/**
 * Match event names against dot-path glob patterns.
 *   'agent.*' matches 'agent.lifecycle' and 'agent.lifecycle.started'
 *   'audit.rbac.*' matches 'audit.rbac.role_created'
 *   '*' matches everything
 */
function matchEventPattern(pattern: string, name: string): boolean {
  if (pattern === "*") return true;

  let regex = eventPatternCache.get(pattern);
  if (!regex) {
    const regexStr =
      "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        // '**' matches anything including dots
        .replace(/\*\*/g, "DOUBLE_STAR")
        // '*' matches a single segment (not dots)
        .replace(/\*/g, "[^.]*")
        .replace(/DOUBLE_STAR/g, ".*") +
      // Allow trailing segments after the pattern
      "(\\..+)?$";
    regex = new RegExp(regexStr);
    eventPatternCache.set(pattern, regex);
  }

  return regex.test(name);
}
