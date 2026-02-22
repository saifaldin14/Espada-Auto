/**
 * GCP Extension — Cloud Scheduler Manager
 *
 * Manages Cloud Scheduler jobs (cron-like scheduling).
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpList, gcpMutate, gcpRequest, shortName } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** A Cloud Scheduler job. */
export type GcpSchedulerJob = {
  name: string;
  description: string;
  schedule: string;
  timeZone: string;
  state: string;
  httpTarget?: Record<string, unknown>;
  pubsubTarget?: Record<string, unknown>;
  lastAttemptTime: string;
  scheduleTime: string;
};

/** Input for creating a Cloud Scheduler job. */
export type GcpSchedulerJobInput = {
  name: string;
  description: string;
  schedule: string;
  timeZone: string;
  httpTarget?: Record<string, unknown>;
  pubsubTarget?: Record<string, unknown>;
};

// =============================================================================
// Helpers
// =============================================================================

function mapJob(raw: Record<string, unknown>): GcpSchedulerJob {
  return {
    name: shortName((raw.name as string) ?? ""),
    description: (raw.description as string) ?? "",
    schedule: (raw.schedule as string) ?? "",
    timeZone: (raw.timeZone as string) ?? "",
    state: (raw.state as string) ?? "",
    httpTarget: raw.httpTarget as Record<string, unknown> | undefined,
    pubsubTarget: raw.pubsubTarget as Record<string, unknown> | undefined,
    lastAttemptTime: (raw.lastAttemptTime as string) ?? "",
    scheduleTime: (raw.scheduleTime as string) ?? "",
  };
}

// =============================================================================
// GcpSchedulerManager
// =============================================================================

/**
 * Manages GCP Cloud Scheduler resources.
 *
 * Provides methods for creating, listing, pausing, and resuming
 * scheduled jobs.
 */
export class GcpSchedulerManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all scheduler jobs in a specific location. */
  async listJobs(location: string): Promise<GcpSchedulerJob[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudscheduler.googleapis.com/v1/projects/${this.projectId}/locations/${location}/jobs`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "jobs");
      return raw.map(mapJob);
    }, this.retryOptions);
  }

  /** Get a single scheduler job by name. */
  async getJob(location: string, name: string): Promise<GcpSchedulerJob> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudscheduler.googleapis.com/v1/projects/${this.projectId}/locations/${location}/jobs/${name}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return mapJob(raw);
    }, this.retryOptions);
  }

  /** Create a new scheduler job. */
  async createJob(location: string, job: GcpSchedulerJobInput): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudscheduler.googleapis.com/v1/projects/${this.projectId}/locations/${location}/jobs`;
      const body = {
        name: `projects/${this.projectId}/locations/${location}/jobs/${job.name}`,
        description: job.description,
        schedule: job.schedule,
        timeZone: job.timeZone,
        httpTarget: job.httpTarget,
        pubsubTarget: job.pubsubTarget,
      };
      return gcpMutate(url, token, body, "POST");
    }, this.retryOptions);
  }

  /** Delete a scheduler job by name. */
  async deleteJob(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudscheduler.googleapis.com/v1/projects/${this.projectId}/locations/${location}/jobs/${name}`;
      return gcpMutate(url, token, {}, "DELETE");
    }, this.retryOptions);
  }

  /** Pause a scheduler job. */
  async pauseJob(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudscheduler.googleapis.com/v1/projects/${this.projectId}/locations/${location}/jobs/${name}:pause`;
      return gcpMutate(url, token, {}, "POST");
    }, this.retryOptions);
  }

  /** Resume a paused scheduler job. */
  async resumeJob(location: string, name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://cloudscheduler.googleapis.com/v1/projects/${this.projectId}/locations/${location}/jobs/${name}:resume`;
      return gcpMutate(url, token, {}, "POST");
    }, this.retryOptions);
  }
}
