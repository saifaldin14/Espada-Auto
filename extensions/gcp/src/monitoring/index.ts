/**
 * GCP Extension — Cloud Monitoring Manager
 *
 * Manages alert policies, uptime checks, metric descriptors, time series,
 * and notification channels.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpOperationResult, GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

// =============================================================================
// Types
// =============================================================================

/** An alert policy in Cloud Monitoring. */
export type GcpAlertPolicy = {
  name: string;
  displayName: string;
  enabled: boolean;
  conditions: Array<Record<string, unknown>>;
  combiner: string;
  notificationChannels: string[];
  createdAt: string;
};

/** An uptime check configuration. */
export type GcpUptimeCheck = {
  name: string;
  displayName: string;
  monitoredResource: Record<string, unknown>;
  httpCheck: Record<string, unknown>;
  period: string;
  timeout: string;
};

/** A metric descriptor in Cloud Monitoring. */
export type GcpMetricDescriptor = {
  name: string;
  type: string;
  metricKind: string;
  valueType: string;
  description: string;
};

/** A time series result from a monitoring query. */
export type GcpTimeSeries = {
  metric: Record<string, unknown>;
  resource: Record<string, unknown>;
  points: Array<Record<string, unknown>>;
};

/** A notification channel used by alert policies. */
export type GcpNotificationChannel = {
  name: string;
  type: string;
  displayName: string;
  enabled: boolean;
  labels: Record<string, string>;
};

// =============================================================================
// GcpMonitoringManager
// =============================================================================

/**
 * Manages GCP Cloud Monitoring resources.
 *
 * Provides methods for listing alert policies, uptime checks, metric
 * descriptors, time series data, and notification channels.
 */
export class GcpMonitoringManager {
  private projectId: string;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /** List all alert policies in the project. */
  async listAlertPolicies(): Promise<GcpAlertPolicy[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://monitoring.googleapis.com/v3/projects/${this.projectId}/alertPolicies`;
      return [] as GcpAlertPolicy[];
    }, this.retryOptions);
  }

  /** Get a single alert policy by resource name. */
  async getAlertPolicy(name: string): Promise<GcpAlertPolicy> {
    return withGcpRetry(async () => {
      const _endpoint = `https://monitoring.googleapis.com/v3/${name}`;
      throw new Error(`Alert policy ${name} not found (placeholder)`);
    }, this.retryOptions);
  }

  /** List all uptime check configurations. */
  async listUptimeChecks(): Promise<GcpUptimeCheck[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://monitoring.googleapis.com/v3/projects/${this.projectId}/uptimeCheckConfigs`;
      return [] as GcpUptimeCheck[];
    }, this.retryOptions);
  }

  /** List metric descriptors, optionally filtered. */
  async listMetricDescriptors(filter?: string): Promise<GcpMetricDescriptor[]> {
    return withGcpRetry(async () => {
      const _filter = filter ?? "";
      const _endpoint = `https://monitoring.googleapis.com/v3/projects/${this.projectId}/metricDescriptors`;
      return [] as GcpMetricDescriptor[];
    }, this.retryOptions);
  }

  /** Query time series data for a given filter and time interval. */
  async queryTimeSeries(
    filter: string,
    interval: { startTime: string; endTime: string },
  ): Promise<GcpTimeSeries[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://monitoring.googleapis.com/v3/projects/${this.projectId}/timeSeries`;
      const _params = { filter, interval };
      return [] as GcpTimeSeries[];
    }, this.retryOptions);
  }

  /** List all notification channels in the project. */
  async listNotificationChannels(): Promise<GcpNotificationChannel[]> {
    return withGcpRetry(async () => {
      const _endpoint = `https://monitoring.googleapis.com/v3/projects/${this.projectId}/notificationChannels`;
      return [] as GcpNotificationChannel[];
    }, this.retryOptions);
  }
}
