/**
 * Enterprise Durable Task Queue — Barrel Export
 *
 */

export {
  DurableTaskQueue,
  type Task,
  type TaskDefinition,
  type TaskStatus,
  type TaskPriority,
  type TaskEvent,
  type TaskHandler,
  type TaskResult,
  type TaskContext,
  type TaskQueueStats,
} from "./durable-task-queue.js";

// =============================================================================
// Global accessor for gateway task queue instance
// =============================================================================

import type { DurableTaskQueue as DTQ } from "./durable-task-queue.js";

let _taskQueue: DTQ | null = null;

/**
 * Set the gateway-wide task queue instance.
 * Called from server.impl.ts after enterprise bootstrap.
 */
export function setGatewayTaskQueue(queue: DTQ): void {
  _taskQueue = queue;
}

/**
 * Get the gateway-wide task queue instance.
 * Returns null if the enterprise task queue is not enabled.
 */
export function getGatewayTaskQueue(): DTQ | null {
  return _taskQueue;
}
