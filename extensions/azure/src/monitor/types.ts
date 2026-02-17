/**
 * Azure Monitor — Type Definitions
 */

export type MetricAggregationType = "Average" | "Count" | "Maximum" | "Minimum" | "Total" | "None";

export type MetricDefinition = {
  id: string;
  name: string;
  displayName?: string;
  unit: string;
  primaryAggregationType?: MetricAggregationType;
  supportedAggregationTypes?: MetricAggregationType[];
  metricAvailabilities?: Array<{ timeGrain: string; retention: string }>;
};

export type MetricValue = {
  timestamp: string;
  average?: number;
  count?: number;
  maximum?: number;
  minimum?: number;
  total?: number;
};

export type MetricResult = {
  id: string;
  name: string;
  unit: string;
  timeseries: Array<{
    data: MetricValue[];
    metadataValues?: Array<{ name: string; value: string }>;
  }>;
};

export type AlertRule = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  description?: string;
  severity: 0 | 1 | 2 | 3 | 4;
  enabled: boolean;
  scopes: string[];
  evaluationFrequency?: string;
  windowSize?: string;
};

export type LogAnalyticsWorkspace = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  customerId?: string;
  sku?: string;
  retentionInDays?: number;
  provisioningState?: string;
};

export type DiagnosticSetting = {
  id: string;
  name: string;
  resourceUri: string;
  workspaceId?: string;
  storageAccountId?: string;
  eventHubAuthorizationRuleId?: string;
  logs: Array<{ category: string; enabled: boolean; retentionDays?: number }>;
  metrics: Array<{ category: string; enabled: boolean; retentionDays?: number }>;
};

export type ApplicationInsightsComponent = {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  applicationId?: string;
  instrumentationKey?: string;
  connectionString?: string;
  applicationType?: string;
  retentionInDays?: number;
};
