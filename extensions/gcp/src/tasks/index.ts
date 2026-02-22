/**
 * GCP Extension — Cloud Tasks Manager
 *
 * Manages Cloud Tasks queues and tasks.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpList, gcpMutate, gcpRequest, shortName } from "../api.js";

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
// Helpers
// =============================================================================

function mapQueue(raw: Record<string, unknown>): GcpTaskQueue {
  return {
    name: shortName((raw.name as string) ?? ""),
    state: (raw.state as string) ?? "",
    rateLimits: (raw.rateLimits as Record<string, unknown>) ?? {},
    retryConfig: (raw.retryConfig as Record<string, unknown>) ?? {},
  };
}

function mapTask(raw: Record<string, unknown>): GcpTask {
  return {
    name: shortName((raw.name as string) ?? ""),
    scheduleTime: (raw.scheduleTime as string) ?? "",
    createTime: (raw.createTime as string) ?? "",
    dispatchCount: (raw.dispatchCount as number) ?? 0,
    responseCount: (raw.responseCount as number) ?? 0,
    view: (raw.view as string) ?? "BASIC",
  };
}

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
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all task queues in a specific location. */
  async listQueues(location: string): Promise<GcpTaskQueue[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "queues");
      return raw.map(mapQueue);
    }, this.retryOptions);
  }

  /** Get a single task queue by name. */
  async getQueue(location: string, name: string): Promise<GcpTaskQueue> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues/${name}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return mapQueue(raw);
    }, this.retryOptions);
  }

  /** Create a new task queue. */
  async createQueue(
    location: string,
    queue: { name: string; rateLimits?: { maxDispatchesPerSecond?: number } },
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues`;
      const body = {
        name: `projects/${this.projectId}/locations/${location}/queues/${queue.name}`,
        rateLimits: queue.rateLimits,
      };
      return gcpMutate(url, token, body, "POST");
    }, this.retryOptions);
  }

  /** Delete a task queue by name. */
  async deleteQueue(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues/${name}`;
      return gcpMutate(url, token, {}, "DELETE");
    }, this.retryOptions);
  }

  /** Pause a task queue. */
  async pauseQueue(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues/${name}:pause`;
      return gcpMutate(url, token, {}, "POST");
    }, this.retryOptions);
  }

  /** Resume a paused task queue. */
  async resumeQueue(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues/${name}:resume`;
      return gcpMutate(url, token, {}, "POST");
    }, this.retryOptions);
  }

  /** List tasks within a specific queue. */
  async listTasks(location: string, queue: string): Promise<GcpTask[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudtasks.googleapis.com/v2/projects/${this.projectId}/locations/${location}/queues/${queue}/tasks`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "tasks");
      return raw.map(mapTask);
    }, this.retryOptions);
  }
}
