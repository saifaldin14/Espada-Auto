/**
 * Azure Monitor Manager
 *
 * Manages Azure Monitor metrics, alerts, and Log Analytics workspaces.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  MetricResult,
  AlertRule,
  LogAnalyticsWorkspace,
  DiagnosticSetting,
} from "./types.js";

export class AzureMonitorManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions?: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    retryOptions?: AzureRetryOptions
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions;
  }

  private async getMonitorClient() {
    const { MonitorClient } = await import("@azure/arm-monitor");
    const { credential } = await this.credentialsManager.getCredential();
    return new MonitorClient(credential, this.subscriptionId);
  }

  async listMetrics(
    resourceUri: string,
    metricNames: string[],
    options?: { timespan?: string; interval?: string; aggregation?: string }
  ): Promise<MetricResult[]> {
    return withAzureRetry(async () => {
      const client = await this.getMonitorClient();
      const response = await client.metrics.list(resourceUri, {
        metricnames: metricNames.join(","),
        timespan: options?.timespan,
        interval: options?.interval,
        aggregation: options?.aggregation,
      });
      return (response.value ?? []).map((m) => ({
        id: m.id ?? "",
        name: m.name?.value ?? "",
        unit: m.unit ?? "",
        timeseries: (m.timeseries ?? []).map((ts) => ({
          data: (ts.data ?? []).map((d) => ({
            timestamp: d.timeStamp?.toISOString() ?? "",
            average: d.average,
            count: d.count,
            maximum: d.maximum,
            minimum: d.minimum,
            total: d.total,
          })),
        })),
      }));
    }, this.retryOptions);
  }

  async listAlertRules(resourceGroup: string): Promise<AlertRule[]> {
    return withAzureRetry(async () => {
      const client = await this.getMonitorClient();
      const results: AlertRule[] = [];
      for await (const rule of client.metricAlerts.listByResourceGroup(resourceGroup)) {
        results.push({
          id: rule.id ?? "",
          name: rule.name ?? "",
          resourceGroup,
          location: rule.location ?? "",
          description: rule.description,
          severity: (rule.severity ?? 3) as 0 | 1 | 2 | 3 | 4,
          enabled: rule.enabled ?? false,
          scopes: rule.scopes ?? [],
          evaluationFrequency: rule.evaluationFrequency,
          windowSize: rule.windowSize,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listLogAnalyticsWorkspaces(resourceGroup?: string): Promise<LogAnalyticsWorkspace[]> {
    return withAzureRetry(async () => {
      const { OperationalInsightsManagementClient } = await import(
        "@azure/arm-operationalinsights"
      );
      const { credential } = await this.credentialsManager.getCredential();
      const client = new OperationalInsightsManagementClient(credential, this.subscriptionId);
      const results: LogAnalyticsWorkspace[] = [];
      const iter = resourceGroup
        ? client.workspaces.listByResourceGroup(resourceGroup)
        : client.workspaces.list();
      for await (const ws of iter) {
        results.push({
          id: ws.id ?? "",
          name: ws.name ?? "",
          resourceGroup: ws.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: ws.location ?? "",
          customerId: ws.customerId,
          sku: ws.sku?.name,
          retentionInDays: ws.retentionInDays,
          provisioningState: ws.provisioningState,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listDiagnosticSettings(resourceUri: string): Promise<DiagnosticSetting[]> {
    return withAzureRetry(async () => {
      const client = await this.getMonitorClient();
      const response = await client.diagnosticSettings.list(resourceUri);
      return (response.value ?? []).map((ds) => ({
        id: ds.id ?? "",
        name: ds.name ?? "",
        resourceUri,
        workspaceId: ds.workspaceId,
        storageAccountId: ds.storageAccountId,
        eventHubAuthorizationRuleId: ds.eventHubAuthorizationRuleId,
        logs: (ds.logs ?? []).map((l) => ({
          category: l.category ?? "",
          enabled: l.enabled ?? false,
          retentionDays: l.retentionPolicy?.days,
        })),
        metrics: (ds.metrics ?? []).map((m) => ({
          category: m.category ?? "",
          enabled: m.enabled ?? false,
          retentionDays: m.retentionPolicy?.days,
        })),
      }));
    }, this.retryOptions);
  }
}

export function createMonitorManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureMonitorManager {
  return new AzureMonitorManager(credentialsManager, subscriptionId, retryOptions);
}
