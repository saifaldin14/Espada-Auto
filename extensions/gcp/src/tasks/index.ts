/**
 * GCP Extension — Cloud Tasks Manager
 *
 * Manages Cloud Tasks queues and tasks.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

// =============================================================================
// Types
// =============================================================================

/** A Cloud Tasks queue. */
export type GcpTaskQueue = {
  name: string;
  state: string;
  rateLimits: Record<string, unknown>;
  retryConfig: Record<string, unknown>;
};

/** A task within a Cloud Tasks queue. */
export type GcpTask = {
  name: string;
  scheduleTime: string;
  createTime: string;
  dispatchCount: number;
  responseCount: number;
  view: string;
};

// =============================================================================
// GcpTasksManager
// =============================================================================

/**
 * Manages GCP Cloud Tasks resources.
 *
 * Provides methods for creating and managing task queues, and for
 * listing tasks within queues.
 */
export class GcpTasksManager {
  private projectId: string;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all task queues in a specific location. */
  async listQueues(location: string): Promise<GcpTaskQueue[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues`;
      return [] as GcpTaskQueue[];
    }, this.retryOptions);
  }

  /** Get a single task queue by name. */
  async getQueue(location: string, name: string): Promise<GcpTaskQueue> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues/${name}`;
      throw new Error(`Queue ${name} not found (placeholder)`);
    }, this.retryOptions);
  }

  /** Create a new task queue. */
  async createQueue(
    location: string,
    queue: { name: string; rateLimits?: { maxDispatchesPerSecond?: number } },
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues`;
      const _body = queue;
      return { success: true, message: `Queue ${queue.name} created (placeholder)` } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** Delete a task queue by name. */
  async deleteQueue(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues/${name}`;
      return { success: true, message: `Queue ${name} deleted (placeholder)` } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** Pause a task queue. */
  async pauseQueue(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues/${name}:pause`;
      return { success: true, message: `Queue ${name} paused (placeholder)` } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** Resume a paused task queue. */
  async resumeQueue(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues/${name}:resume`;
      return { success: true, message: `Queue ${name} resumed (placeholder)` } as GcpOperationResult;
    }, this.retryOptions);
  }

  /** List tasks within a specific queue. */
  async listTasks(location: string, queue: string): Promise<GcpTask[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues/${queue}/tasks`;
      return [] as GcpTask[];
    }, this.retryOptions);
  }
}
