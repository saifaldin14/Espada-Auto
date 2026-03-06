/**
 * Unit tests for DurableTaskQueue (enterprise task queue / job scheduler).
 *
 * Covers: submit, getTask, idempotency keys, priority ordering,
 *         listTasks, getStats, cancel, handler registration, close.
 *
 */

import { describe, it, expect, afterEach } from "vitest";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DurableTaskQueue } from "../../../gateway/task-queue/index.js";
import type { Task } from "../../../gateway/task-queue/index.js";

function tmpDb(name: string): string {
  const dir = join(tmpdir(), "espada-test-taskq");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${name}-${randomUUID()}.db`);
}

function cleanup(path: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(path + suffix);
    } catch {
      /* ignore */
    }
  }
}

describe("DurableTaskQueue", () => {
  let dbPath: string;
  let queue: DurableTaskQueue;

  afterEach(() => {
    queue?.close();
    if (dbPath) cleanup(dbPath);
  });

  // ===========================================================================
  // Submit & retrieve
  // ===========================================================================

  it("submits a task and retrieves it by ID", () => {
    dbPath = tmpDb("submit");
    queue = new DurableTaskQueue(dbPath);

    const task = queue.submit({
      type: "terraform.apply",
      payload: { region: "us-east-1" },
      metadata: { userId: "u1" },
    });

    expect(task.id).toBeTruthy();
    expect(task.type).toBe("terraform.apply");
    expect(task.status).toBe("pending");
    expect(task.payload).toEqual({ region: "us-east-1" });
    expect(task.metadata).toEqual({ userId: "u1" });
    expect(task.attempts).toBe(0);
    expect(task.maxRetries).toBe(3); // default

    const fetched = queue.getTask(task.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(task.id);
  });

  it("returns null for nonexistent task", () => {
    dbPath = tmpDb("getmissing");
    queue = new DurableTaskQueue(dbPath);

    expect(queue.getTask("nonexistent")).toBeNull();
  });

  // ===========================================================================
  // Idempotency
  // ===========================================================================

  it("returns existing task for duplicate idempotency key", () => {
    dbPath = tmpDb("idempotency");
    queue = new DurableTaskQueue(dbPath);

    const t1 = queue.submit({
      type: "deploy",
      payload: { v: 1 },
      idempotencyKey: "deploy-abc",
    });

    const t2 = queue.submit({
      type: "deploy",
      payload: { v: 2 },
      idempotencyKey: "deploy-abc",
    });

    expect(t2.id).toBe(t1.id);
    // payload should be the original, not the second submission
    expect(t2.payload).toEqual({ v: 1 });
  });

  it("allows different idempotency keys", () => {
    dbPath = tmpDb("idempotency-diff");
    queue = new DurableTaskQueue(dbPath);

    const t1 = queue.submit({
      type: "deploy",
      payload: {},
      idempotencyKey: "key-1",
    });

    const t2 = queue.submit({
      type: "deploy",
      payload: {},
      idempotencyKey: "key-2",
    });

    expect(t1.id).not.toBe(t2.id);
  });

  // ===========================================================================
  // Priority ordering
  // ===========================================================================

  it("lists tasks ordered by priority", () => {
    dbPath = tmpDb("priority");
    queue = new DurableTaskQueue(dbPath);

    queue.submit({ type: "t", payload: {}, priority: "low" });
    queue.submit({ type: "t", payload: {}, priority: "critical" });
    queue.submit({ type: "t", payload: {}, priority: "normal" });
    queue.submit({ type: "t", payload: {}, priority: "high" });

    const tasks = queue.listTasks();
    const priorities = tasks.map((t) => t.priority);
    expect(priorities).toEqual(["critical", "high", "normal", "low"]);
  });

  // ===========================================================================
  // Filtering
  // ===========================================================================

  it("filters tasks by status", () => {
    dbPath = tmpDb("filter-status");
    queue = new DurableTaskQueue(dbPath);

    queue.submit({ type: "a", payload: {} });
    queue.submit({ type: "b", payload: {} });

    const pending = queue.listTasks({ status: "pending" });
    expect(pending).toHaveLength(2);

    const running = queue.listTasks({ status: "running" });
    expect(running).toHaveLength(0);
  });

  it("filters tasks by type", () => {
    dbPath = tmpDb("filter-type");
    queue = new DurableTaskQueue(dbPath);

    queue.submit({ type: "terraform.apply", payload: {} });
    queue.submit({ type: "terraform.plan", payload: {} });
    queue.submit({ type: "migration.compute", payload: {} });

    const tfTasks = queue.listTasks({ type: "terraform.apply" });
    expect(tfTasks).toHaveLength(1);
    expect(tfTasks[0].type).toBe("terraform.apply");
  });

  // ===========================================================================
  // Stats
  // ===========================================================================

  it("returns queue statistics", () => {
    dbPath = tmpDb("stats");
    queue = new DurableTaskQueue(dbPath);

    queue.submit({ type: "a", payload: {} });
    queue.submit({ type: "b", payload: {} });
    queue.submit({ type: "c", payload: {} });

    const stats = queue.getStats();
    expect(stats.pending).toBe(3);
    expect(stats.running).toBe(0);
    expect(stats.total).toBe(3);
  });

  // ===========================================================================
  // Events
  // ===========================================================================

  it("emits task:created event on submit", () => {
    dbPath = tmpDb("event-created");
    queue = new DurableTaskQueue(dbPath);

    const events: { type: string; task: Task }[] = [];
    queue.on("task:created", (evt: { type: string; task: Task }) => {
      events.push(evt);
    });

    queue.submit({ type: "test", payload: { x: 1 } });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("task:created");
    expect(events[0].task.type).toBe("test");
  });

  // ===========================================================================
  // Scheduling
  // ===========================================================================

  it("stores scheduled time", () => {
    dbPath = tmpDb("scheduled");
    queue = new DurableTaskQueue(dbPath);

    const futureDate = new Date(Date.now() + 3600_000).toISOString();
    const task = queue.submit({
      type: "scheduled-job",
      payload: {},
      scheduledAt: futureDate,
    });

    expect(task.scheduledAt).toBe(futureDate);
  });

  // ===========================================================================
  // Custom options
  // ===========================================================================

  it("accepts custom maxRetries and timeout", () => {
    dbPath = tmpDb("custom-opts");
    queue = new DurableTaskQueue(dbPath);

    const task = queue.submit({
      type: "long-running",
      payload: {},
      maxRetries: 10,
      timeoutMs: 7200_000,
    });

    expect(task.maxRetries).toBe(10);
    expect(task.timeoutMs).toBe(7200_000);
  });

  // ===========================================================================
  // Persistence
  // ===========================================================================

  it("persists tasks across close and reopen", () => {
    dbPath = tmpDb("persist");
    queue = new DurableTaskQueue(dbPath);

    queue.submit({ type: "persist-test", payload: { key: "value" } });
    queue.close();

    const queue2 = new DurableTaskQueue(dbPath);
    const tasks = queue2.listTasks({ type: "persist-test" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].payload).toEqual({ key: "value" });
    queue2.close();
    queue = undefined!; // prevent afterEach double-close
  });
});
