/**
 * GCP Extension — Cloud Monitoring Manager
 *
 * Manages alert policies, uptime checks, metric descriptors, time series,
 * and notification channels via the Cloud Monitoring REST API (v3).
 */

import type { GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList } from "../api.js";

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
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** Map raw API response to our GcpAlertPolicy shape. */
  private mapAlertPolicy(raw: Record<string, unknown>): GcpAlertPolicy {
    return {
      name: (raw.name ?? "") as string,
      displayName: (raw.displayName ?? "") as string,
      enabled: (raw.enabled ?? false) as boolean,
      conditions: (raw.conditions ?? []) as Array<Record<string, unknown>>,
      combiner: (raw.combiner ?? "") as string,
      notificationChannels: (raw.notificationChannels ?? []) as string[],
      createdAt: ((raw.mutateTime ?? (raw.creationRecord as Record<string, unknown>)?.mutateTime ?? "") as string),
    };
  }

  /** List all alert policies in the project. */
  async listAlertPolicies(): Promise<GcpAlertPolicy[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://monitoring.googleapis.com/v3/projects/${this.projectId}/alertPolicies`;
      const raw = await gcpList<Record<string, unknown>>(url, token, "alertPolicies");
      return raw.map((r) => this.mapAlertPolicy(r));
    }, this.retryOptions);
  }

  /** Get a single alert policy by resource name. */
  async getAlertPolicy(name: string): Promise<GcpAlertPolicy> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://monitoring.googleapis.com/v3/${name}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapAlertPolicy(raw);
    }, this.retryOptions);
  }

  /** List all uptime check configurations. */
  async listUptimeChecks(): Promise<GcpUptimeCheck[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://monitoring.googleapis.com/v3/projects/${this.projectId}/uptimeCheckConfigs`;
      return gcpList<GcpUptimeCheck>(url, token, "uptimeCheckConfigs");
    }, this.retryOptions);
  }

  /** List metric descriptors, optionally filtered. */
  async listMetricDescriptors(filter?: string): Promise<GcpMetricDescriptor[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      let url = `https://monitoring.googleapis.com/v3/projects/${this.projectId}/metricDescriptors`;
      if (filter) {
        url += `?filter=${encodeURIComponent(filter)}`;
      }
      return gcpList<GcpMetricDescriptor>(url, token, "metricDescriptors");
    }, this.retryOptions);
  }

  /** Query time series data for a given filter and time interval. */
  async queryTimeSeries(
    filter: string,
    interval: { startTime: string; endTime: string },
  ): Promise<GcpTimeSeries[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url =
        `https://monitoring.googleapis.com/v3/projects/${this.projectId}/timeSeries` +
        `?filter=${encodeURIComponent(filter)}` +
        `&interval.startTime=${encodeURIComponent(interval.startTime)}` +
        `&interval.endTime=${encodeURIComponent(interval.endTime)}`;
      const data = await gcpRequest<{ timeSeries?: GcpTimeSeries[] }>(url, token);
      return data.timeSeries ?? [];
    }, this.retryOptions);
  }

  /** List all notification channels in the project. */
  async listNotificationChannels(): Promise<GcpNotificationChannel[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://monitoring.googleapis.com/v3/projects/${this.projectId}/notificationChannels`;
      return gcpList<GcpNotificationChannel>(url, token, "notificationChannels");
    }, this.retryOptions);
  }
}
