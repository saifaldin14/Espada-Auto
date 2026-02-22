/**
 * GCP Extension — Cloud Logging Manager
 *
 * Manages log entries, sinks, and log-based metrics via the
 * Cloud Logging REST API (v2).
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** A log entry from Cloud Logging. */
export type GcpLogEntry = {
  logName: string;
  resource: Record<string, unknown>;
  timestamp: string;
  severity: string;
  jsonPayload?: Record<string, unknown>;
  textPayload?: string;
  insertId: string;
};

/** A Cloud Logging sink that routes log entries. */
export type GcpLogSink = {
  name: string;
  destination: string;
  filter: string;
  outputVersionFormat: string;
  writerIdentity: string;
  createTime: string;
};

/** A log-based metric in Cloud Logging. */
export type GcpLogMetric = {
  name: string;
  description: string;
  filter: string;
  metricDescriptor: Record<string, unknown>;
  createTime: string;
};

// =============================================================================
// GcpLoggingManager
// =============================================================================

/**
 * Manages GCP Cloud Logging resources.
 *
 * Provides methods for querying log entries and managing sinks and
 * log-based metrics.
 */
export class GcpLoggingManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List log entries matching a filter. */
  async listLogEntries(
    filter: string,
    opts?: { pageSize?: number; orderBy?: string },
  ): Promise<GcpLogEntry[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://logging.googleapis.com/v2/entries:list`;
      const data = await gcpRequest<{ entries?: GcpLogEntry[] }>(url, token, {
        method: "POST",
        body: {
          resourceNames: [`projects/${this.projectId}`],
          filter,
          pageSize: opts?.pageSize,
          orderBy: opts?.orderBy,
        },
      });
      return data.entries ?? [];
    }, this.retryOptions);
  }

  /** List all log sinks in the project. */
  async listSinks(): Promise<GcpLogSink[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://logging.googleapis.com/v2/projects/${this.projectId}/sinks`;
      return gcpList<GcpLogSink>(url, token, "sinks");
    }, this.retryOptions);
  }

  /** Get a single log sink by name. */
  async getSink(name: string): Promise<GcpLogSink> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://logging.googleapis.com/v2/projects/${this.projectId}/sinks/${name}`;
      return gcpRequest<GcpLogSink>(url, token);
    }, this.retryOptions);
  }

  /** Create a new log sink. */
  async createSink(sink: {
    name: string;
    destination: string;
    filter?: string;
  }): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://logging.googleapis.com/v2/projects/${this.projectId}/sinks`;
      return gcpMutate(url, token, sink);
    }, this.retryOptions);
  }

  /** Delete a log sink by name. */
  async deleteSink(name: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://logging.googleapis.com/v2/projects/${this.projectId}/sinks/${name}`;
      return gcpMutate(url, token, undefined, "DELETE");
    }, this.retryOptions);
  }

  /** List all log-based metrics in the project. */
  async listMetrics(): Promise<GcpLogMetric[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://logging.googleapis.com/v2/projects/${this.projectId}/metrics`;
      return gcpList<GcpLogMetric>(url, token, "metrics");
    }, this.retryOptions);
  }
}
