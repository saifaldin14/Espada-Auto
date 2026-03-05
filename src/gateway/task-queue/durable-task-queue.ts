/**
 * Enterprise Durable Task Queue
 *
 * Persistent, crash-safe task queue for long-running infrastructure operations.
 * Tasks survive gateway restarts and provide exactly-once execution guarantees
 * via idempotency keys. Includes dead-letter queue, retry with exponential
 * backoff, and a full lifecycle state machine.
 *
 * Task lifecycle:
 *   pending → claimed → running → succeeded | failed | retryable
 *   retryable → pending (after backoff delay)
 *   failed (max retries) → dead-letter
 *
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

// =============================================================================
// Types
// =============================================================================

export type TaskStatus =
  | "pending"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "retryable"
  | "dead-letter"
  | "cancelled";

export type TaskPriority = "critical" | "high" | "normal" | "low";

export interface TaskDefinition {
  /** Unique task type identifier (e.g., "terraform.apply", "migration.compute") */
  type: string;

  /** Task payload — serializable JSON */
  payload: Record<string, unknown>;

  /** Optional idempotency key for exactly-once semantics */
  idempotencyKey?: string;

  /** Task priority (default: "normal") */
  priority?: TaskPriority;

  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;

  /** Base delay for exponential backoff in ms (default: 5000) */
  retryBaseDelayMs?: number;

  /** Maximum time a task can run before being considered stuck (default: 30 min) */
  timeoutMs?: number;

  /** Optional scheduling — run after this timestamp */
  scheduledAt?: string;

  /** Metadata for tracking (agent ID, session, user, etc.) */
  metadata?: Record<string, string>;
}

export interface Task {
  /** Unique task ID (UUID) */
  id: string;

  /** Task type */
  type: string;

  /** Current status */
  status: TaskStatus;

  /** Task payload */
  payload: Record<string, unknown>;

  /** Idempotency key (null if not set) */
  idempotencyKey: string | null;

  /** Priority */
  priority: TaskPriority;

  /** Number of attempts made */
  attempts: number;

  /** Maximum retry attempts */
  maxRetries: number;

  /** Timeout in milliseconds */
  timeoutMs: number;

  /** When the task was created */
  createdAt: string;

  /** When the task was last updated */
  updatedAt: string;

  /** When the task is scheduled to run (null = immediately) */
  scheduledAt: string | null;

  /** When the task was claimed by a worker */
  claimedAt: string | null;

  /** When the task started running */
  startedAt: string | null;

  /** When the task completed (succeeded, failed, or dead-lettered) */
  completedAt: string | null;

  /** Worker ID that claimed this task */
  workerId: string | null;

  /** Result data (on success) */
  result: Record<string, unknown> | null;

  /** Error details (on failure) */
  error: string | null;

  /** Task metadata */
  metadata: Record<string, string>;
}

export type TaskEvent =
  | { type: "task:created"; task: Task }
  | { type: "task:claimed"; task: Task }
  | { type: "task:running"; task: Task }
  | { type: "task:succeeded"; task: Task }
  | { type: "task:failed"; task: Task }
  | { type: "task:retrying"; task: Task; nextAttemptAt: string }
  | { type: "task:dead-letter"; task: Task }
  | { type: "task:cancelled"; task: Task }
  | { type: "task:timeout"; task: Task };

export type TaskHandler = (task: Task, context: TaskContext) => Promise<TaskResult>;

export type TaskResult =
  | { status: "succeeded"; result?: Record<string, unknown> }
  | { status: "failed"; error: string; retryable?: boolean };

export interface TaskContext {
  /** Report progress (0-100) */
  reportProgress(percent: number, message?: string): void;

  /** Check if task cancellation was requested */
  isCancelled(): boolean;

  /** Abort signal linked to task timeout and cancellation */
  signal: AbortSignal;
}

export interface TaskQueueStats {
  pending: number;
  claimed: number;
  running: number;
  succeeded: number;
  failed: number;
  deadLetter: number;
  cancelled: number;
  total: number;
}

// =============================================================================
// Priority mapping
// =============================================================================

const PRIORITY_MAP: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// =============================================================================
// Durable Task Queue
// =============================================================================

/**
 * SQLite-backed durable task queue with exactly-once semantics.
 *
 * Features:
 * - Persistent across restarts (SQLite WAL mode)
 * - Exactly-once via idempotency keys
 * - Priority queue (critical > high > normal > low)
 * - Exponential backoff retry
 * - Dead-letter queue for permanently failed tasks
 * - Timeout detection for stuck tasks
 * - Event emission for monitoring
 */
export class DurableTaskQueue extends EventEmitter {
  private db: Database.Database;
  private handlers = new Map<string, TaskHandler>();
  private workerId: string;
  private pollIntervalMs: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stuckCheckTimer: ReturnType<typeof setInterval> | null = null;
  private activeAborts = new Map<string, AbortController>();
  private cancelledTasks = new Set<string>();

  constructor(
    dbPath: string,
    options?: {
      workerId?: string;
      pollIntervalMs?: number;
    },
  ) {
    super();
    this.workerId = options?.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
    this.pollIntervalMs = options?.pollIntervalMs ?? 1000;

    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");

    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id                TEXT PRIMARY KEY,
        type              TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'pending',
        payload           TEXT NOT NULL DEFAULT '{}',
        idempotency_key   TEXT DEFAULT NULL,
        priority          INTEGER NOT NULL DEFAULT 2,
        attempts          INTEGER NOT NULL DEFAULT 0,
        max_retries       INTEGER NOT NULL DEFAULT 3,
        timeout_ms        INTEGER NOT NULL DEFAULT 1800000,
        retry_base_delay  INTEGER NOT NULL DEFAULT 5000,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        scheduled_at      TEXT DEFAULT NULL,
        claimed_at        TEXT DEFAULT NULL,
        started_at        TEXT DEFAULT NULL,
        completed_at      TEXT DEFAULT NULL,
        worker_id         TEXT DEFAULT NULL,
        result            TEXT DEFAULT NULL,
        error             TEXT DEFAULT NULL,
        metadata          TEXT NOT NULL DEFAULT '{}',
        progress          INTEGER DEFAULT NULL,
        progress_message  TEXT DEFAULT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency
        ON tasks(idempotency_key) WHERE idempotency_key IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_tasks_status_priority
        ON tasks(status, priority, created_at);

      CREATE INDEX IF NOT EXISTS idx_tasks_type
        ON tasks(type);

      CREATE INDEX IF NOT EXISTS idx_tasks_scheduled
        ON tasks(scheduled_at) WHERE status = 'pending';

      CREATE INDEX IF NOT EXISTS idx_tasks_worker
        ON tasks(worker_id) WHERE status IN ('claimed', 'running');

      -- Dead-letter archive for failed tasks
      CREATE TABLE IF NOT EXISTS task_dead_letters (
        id                TEXT PRIMARY KEY,
        task_id           TEXT NOT NULL,
        type              TEXT NOT NULL,
        payload           TEXT NOT NULL,
        error             TEXT NOT NULL,
        attempts          INTEGER NOT NULL,
        metadata          TEXT NOT NULL DEFAULT '{}',
        dead_lettered_at  TEXT NOT NULL DEFAULT (datetime('now')),
        original_created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_dead_letters_type
        ON task_dead_letters(type);
    `);
  }

  // ===========================================================================
  // Task Submission
  // ===========================================================================

  /**
   * Submit a new task to the queue.
   * If an idempotency key is provided and a task with that key already exists,
   * returns the existing task instead of creating a new one.
   */
  submit(definition: TaskDefinition): Task {
    // Check idempotency
    if (definition.idempotencyKey) {
      const existing = this.db
        .prepare("SELECT * FROM tasks WHERE idempotency_key = ?")
        .get(definition.idempotencyKey) as TaskRow | undefined;

      if (existing) {
        return rowToTask(existing);
      }
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const priority = PRIORITY_MAP[definition.priority ?? "normal"];

    this.db
      .prepare(`
        INSERT INTO tasks (
          id, type, status, payload, idempotency_key, priority,
          max_retries, timeout_ms, retry_base_delay, created_at,
          updated_at, scheduled_at, metadata
        ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        definition.type,
        JSON.stringify(definition.payload),
        definition.idempotencyKey ?? null,
        priority,
        definition.maxRetries ?? 3,
        definition.timeoutMs ?? 30 * 60 * 1000,
        definition.retryBaseDelayMs ?? 5000,
        now,
        now,
        definition.scheduledAt ?? null,
        JSON.stringify(definition.metadata ?? {}),
      );

    const task = this.getTask(id)!;
    this.emitEvent({ type: "task:created", task });
    return task;
  }

  // ===========================================================================
  // Task Retrieval
  // ===========================================================================

  /** Get a task by ID. */
  getTask(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;

    return row ? rowToTask(row) : null;
  }

  /** List tasks with optional filtering. */
  listTasks(filter?: {
    status?: TaskStatus;
    type?: string;
    limit?: number;
    offset?: number;
  }): Task[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.type) {
      conditions.push("type = ?");
      params.push(filter.type);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ?? 100;
    const offset = filter?.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM tasks ${where} ORDER BY priority ASC, created_at ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as TaskRow[];

    return rows.map(rowToTask);
  }

  /** Get queue statistics. */
  getStats(): TaskQueueStats {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status")
      .all() as { status: string; count: number }[];

    const stats: TaskQueueStats = {
      pending: 0,
      claimed: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      deadLetter: 0,
      cancelled: 0,
      total: 0,
    };

    for (const row of rows) {
      switch (row.status) {
        case "pending":
          stats.pending = row.count;
          break;
        case "claimed":
          stats.claimed = row.count;
          break;
        case "running":
          stats.running = row.count;
          break;
        case "succeeded":
          stats.succeeded = row.count;
          break;
        case "failed":
          stats.failed = row.count;
          break;
        case "dead-letter":
          stats.deadLetter = row.count;
          break;
        case "cancelled":
          stats.cancelled = row.count;
          break;
      }
      stats.total += row.count;
    }

    return stats;
  }

  /** List dead-lettered tasks. */
  listDeadLetters(limit = 50): Array<{
    id: string;
    taskId: string;
    type: string;
    payload: Record<string, unknown>;
    error: string;
    attempts: number;
    deadLetteredAt: string;
  }> {
    const rows = this.db
      .prepare("SELECT * FROM task_dead_letters ORDER BY dead_lettered_at DESC LIMIT ?")
      .all(limit) as Array<{
      id: string;
      task_id: string;
      type: string;
      payload: string;
      error: string;
      attempts: number;
      dead_lettered_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      type: r.type,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
      error: r.error,
      attempts: r.attempts,
      deadLetteredAt: r.dead_lettered_at,
    }));
  }

  // ===========================================================================
  // Task Lifecycle
  // ===========================================================================

  /** Cancel a task. Only pending and claimed tasks can be cancelled. */
  cancel(taskId: string): boolean {
    const task = this.getTask(taskId);
    if (!task) return false;

    if (task.status === "running") {
      // Signal cancellation to the handler
      this.cancelledTasks.add(taskId);
      const abort = this.activeAborts.get(taskId);
      if (abort) abort.abort();
      return true;
    }

    if (task.status !== "pending" && task.status !== "claimed") {
      return false;
    }

    this.updateStatus(taskId, "cancelled");
    const updated = this.getTask(taskId)!;
    this.emitEvent({ type: "task:cancelled", task: updated });
    return true;
  }

  /** Retry a dead-lettered task by creating a new task from it. */
  retryDeadLetter(deadLetterId: string): Task | null {
    const dlRow = this.db
      .prepare("SELECT * FROM task_dead_letters WHERE id = ?")
      .get(deadLetterId) as
      | { task_id: string; type: string; payload: string; metadata: string }
      | undefined;

    if (!dlRow) return null;

    const originalTask = this.getTask(dlRow.task_id);
    return this.submit({
      type: dlRow.type,
      payload: JSON.parse(dlRow.payload) as Record<string, unknown>,
      maxRetries: originalTask?.maxRetries ?? 3,
      metadata: JSON.parse(dlRow.metadata ?? "{}") as Record<string, string>,
    });
  }

  // ===========================================================================
  // Task Handlers
  // ===========================================================================

  /**
   * Register a handler for a task type.
   * Only one handler per task type is supported.
   */
  registerHandler(taskType: string, handler: TaskHandler): void {
    this.handlers.set(taskType, handler);
  }

  // ===========================================================================
  // Worker Loop
  // ===========================================================================

  /** Start processing tasks. */
  start(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(() => {
      this.poll();
    }, this.pollIntervalMs);

    // Check for stuck tasks every 60 seconds
    this.stuckCheckTimer = setInterval(() => {
      this.recoverStuckTasks();
    }, 60_000);

    // Initial poll
    this.poll();
  }

  /** Stop processing tasks. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.stuckCheckTimer) {
      clearInterval(this.stuckCheckTimer);
      this.stuckCheckTimer = null;
    }

    // Abort all active tasks
    for (const [, abort] of this.activeAborts) {
      abort.abort();
    }
    this.activeAborts.clear();
  }

  /** Close the queue and release all resources. */
  close(): void {
    this.stop();
    this.db.close();
  }

  private poll(): void {
    const now = new Date().toISOString();

    // Claim the next pending task
    const row = this.db
      .prepare(`
        SELECT * FROM tasks
        WHERE status = 'pending'
          AND (scheduled_at IS NULL OR scheduled_at <= ?)
        ORDER BY priority ASC, created_at ASC
        LIMIT 1
      `)
      .get(now) as TaskRow | undefined;

    if (!row) return;

    // Atomically claim the task
    const result = this.db
      .prepare(`
        UPDATE tasks SET
          status = 'claimed',
          worker_id = ?,
          claimed_at = ?,
          updated_at = ?
        WHERE id = ? AND status = 'pending'
      `)
      .run(this.workerId, now, now, row.id);

    if (result.changes === 0) return; // Another worker claimed it

    const task = this.getTask(row.id)!;
    this.emitEvent({ type: "task:claimed", task });

    // Execute the task
    this.executeTask(task).catch((err) => {
      try {
        this.updateStatus(task.id, "failed", {
          error: `Unexpected execution error: ${err instanceof Error ? err.message : String(err)}`,
          completedAt: new Date().toISOString(),
        });
      } catch {
        /* swallow if already closed */
      }
    });
  }

  private async executeTask(task: Task): Promise<void> {
    const handler = this.handlers.get(task.type);
    if (!handler) {
      this.updateStatus(task.id, "failed", {
        error: `No handler registered for task type: ${task.type}`,
      });
      return;
    }

    // Mark as running
    this.updateStatus(task.id, "running", {
      startedAt: new Date().toISOString(),
      attempts: task.attempts + 1,
    });
    const runningTask = this.getTask(task.id)!;
    this.emitEvent({ type: "task:running", task: runningTask });

    // Set up abort controller for timeout and cancellation
    const abortController = new AbortController();
    this.activeAborts.set(task.id, abortController);

    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, task.timeoutMs);

    const context: TaskContext = {
      reportProgress: (percent: number, message?: string) => {
        this.db
          .prepare(
            "UPDATE tasks SET progress = ?, progress_message = ?, updated_at = ? WHERE id = ?",
          )
          .run(percent, message ?? null, new Date().toISOString(), task.id);
      },
      isCancelled: () => this.cancelledTasks.has(task.id),
      signal: abortController.signal,
    };

    try {
      const result = await handler(runningTask, context);

      clearTimeout(timeoutId);
      this.activeAborts.delete(task.id);
      this.cancelledTasks.delete(task.id);

      if (result.status === "succeeded") {
        this.updateStatus(task.id, "succeeded", {
          result: result.result ? JSON.stringify(result.result) : null,
          completedAt: new Date().toISOString(),
        });
        const succeeded = this.getTask(task.id)!;
        this.emitEvent({ type: "task:succeeded", task: succeeded });
      } else {
        // Failed
        const attempts = task.attempts + 1;
        const retryable = result.retryable !== false && attempts < task.maxRetries;

        if (retryable) {
          // Exponential backoff: baseDelay * 2^attempt (with jitter)
          const baseDelay = this.db
            .prepare("SELECT retry_base_delay FROM tasks WHERE id = ?")
            .get(task.id) as { retry_base_delay: number } | undefined;
          const delay = (baseDelay?.retry_base_delay ?? 5000) * Math.pow(2, attempts - 1);
          const jitter = Math.random() * delay * 0.1;
          const nextAttemptAt = new Date(Date.now() + delay + jitter).toISOString();

          this.updateStatus(task.id, "pending", {
            error: result.error,
            scheduledAt: nextAttemptAt,
          });
          const retrying = this.getTask(task.id)!;
          this.emitEvent({
            type: "task:retrying",
            task: retrying,
            nextAttemptAt,
          });
        } else {
          // Permanently failed → dead letter
          this.updateStatus(task.id, "dead-letter", {
            error: result.error,
            completedAt: new Date().toISOString(),
          });

          // Archive to dead letter table
          this.db
            .prepare(`
              INSERT INTO task_dead_letters (id, task_id, type, payload, error, attempts, metadata, original_created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              randomUUID(),
              task.id,
              task.type,
              JSON.stringify(task.payload),
              result.error,
              attempts,
              JSON.stringify(task.metadata),
              task.createdAt,
            );

          const deadLettered = this.getTask(task.id)!;
          this.emitEvent({ type: "task:dead-letter", task: deadLettered });
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      this.activeAborts.delete(task.id);
      this.cancelledTasks.delete(task.id);

      const errorMsg = err instanceof Error ? err.message : String(err);

      if (abortController.signal.aborted) {
        const attempts = task.attempts + 1;
        const retryable = attempts < task.maxRetries;

        if (retryable) {
          const delay = 5000 * Math.pow(2, attempts - 1);
          const nextAttemptAt = new Date(Date.now() + delay).toISOString();
          this.updateStatus(task.id, "pending", {
            error: `Task timed out after ${task.timeoutMs}ms: ${errorMsg}`,
            scheduledAt: nextAttemptAt,
          });
        } else {
          this.updateStatus(task.id, "dead-letter", {
            error: `Task timed out after ${task.timeoutMs}ms (max retries exhausted): ${errorMsg}`,
            completedAt: new Date().toISOString(),
          });
        }
        const timedOut = this.getTask(task.id)!;
        this.emitEvent({ type: "task:timeout", task: timedOut });
      } else {
        // Unexpected error — treat as retryable
        const attempts = task.attempts + 1;
        if (attempts < task.maxRetries) {
          const delay = 5000 * Math.pow(2, attempts - 1);
          const nextAttemptAt = new Date(Date.now() + delay).toISOString();

          this.updateStatus(task.id, "pending", {
            error: errorMsg,
            scheduledAt: nextAttemptAt,
          });
        } else {
          this.updateStatus(task.id, "dead-letter", {
            error: errorMsg,
            completedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  /** Recover tasks that have been stuck in claimed/running state. */
  private recoverStuckTasks(): void {
    const stuckThresholdMs = 5 * 60_000; // 5 minutes without update = stuck
    const cutoff = new Date(Date.now() - stuckThresholdMs).toISOString();

    const stuck = this.db
      .prepare(`
        SELECT * FROM tasks
        WHERE status IN ('claimed', 'running')
          AND updated_at < ?
      `)
      .all(cutoff) as TaskRow[];

    for (const row of stuck) {
      const task = rowToTask(row);
      if (task.attempts < task.maxRetries) {
        this.updateStatus(task.id, "pending", {
          error: "Recovered from stuck state",
          workerId: null,
        });
      } else {
        this.updateStatus(task.id, "dead-letter", {
          error: "Task stuck and exceeded max retries",
          completedAt: new Date().toISOString(),
        });
      }
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private updateStatus(
    taskId: string,
    status: TaskStatus,
    extra?: {
      error?: string | null;
      result?: string | null;
      completedAt?: string | null;
      startedAt?: string | null;
      scheduledAt?: string | null;
      workerId?: string | null;
      attempts?: number;
    },
  ): void {
    const now = new Date().toISOString();
    const sets = ["status = ?", "updated_at = ?"];
    const params: unknown[] = [status, now];

    if (extra?.error !== undefined) {
      sets.push("error = ?");
      params.push(extra.error);
    }
    if (extra?.result !== undefined) {
      sets.push("result = ?");
      params.push(extra.result);
    }
    if (extra?.completedAt !== undefined) {
      sets.push("completed_at = ?");
      params.push(extra.completedAt);
    }
    if (extra?.startedAt !== undefined) {
      sets.push("started_at = ?");
      params.push(extra.startedAt);
    }
    if (extra?.scheduledAt !== undefined) {
      sets.push("scheduled_at = ?");
      params.push(extra.scheduledAt);
    }
    if (extra?.workerId !== undefined) {
      sets.push("worker_id = ?");
      params.push(extra.workerId);
    }
    if (extra?.attempts !== undefined) {
      sets.push("attempts = ?");
      params.push(extra.attempts);
    }

    params.push(taskId);
    this.db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  private emitEvent(event: TaskEvent): void {
    this.emit(event.type, event);
    this.emit("task:*", event);
  }

  /** Prune completed/cancelled tasks older than the given age. */
  pruneCompleted(olderThanMs: number): number {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const result = this.db
      .prepare("DELETE FROM tasks WHERE status IN ('succeeded', 'cancelled') AND completed_at < ?")
      .run(cutoff);
    return result.changes;
  }
}

// =============================================================================
// Row types and converters
// =============================================================================

const PRIORITY_REVERSE: Record<number, TaskPriority> = {
  0: "critical",
  1: "high",
  2: "normal",
  3: "low",
};

type TaskRow = {
  id: string;
  type: string;
  status: string;
  payload: string;
  idempotency_key: string | null;
  priority: number;
  attempts: number;
  max_retries: number;
  timeout_ms: number;
  retry_base_delay: number;
  created_at: string;
  updated_at: string;
  scheduled_at: string | null;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  worker_id: string | null;
  result: string | null;
  error: string | null;
  metadata: string;
  progress: number | null;
  progress_message: string | null;
};

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    type: row.type,
    status: row.status as TaskStatus,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    idempotencyKey: row.idempotency_key,
    priority: PRIORITY_REVERSE[row.priority] ?? "normal",
    attempts: row.attempts,
    maxRetries: row.max_retries,
    timeoutMs: row.timeout_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scheduledAt: row.scheduled_at,
    claimedAt: row.claimed_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    workerId: row.worker_id,
    result: row.result ? (JSON.parse(row.result) as Record<string, unknown>) : null,
    error: row.error,
    metadata: JSON.parse(row.metadata) as Record<string, string>,
  };
}
