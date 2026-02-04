/**
 * Advanced Observability Types
 *
 * Type definitions for OpenTelemetry integration, deployment metrics,
 * anomaly detection, alerting, and third-party observability integrations.
 */

// =============================================================================
// OpenTelemetry Types
// =============================================================================

export type TelemetrySignalType = 'traces' | 'metrics' | 'logs';

export type TelemetryExporterType =
  | 'otlp'
  | 'otlp-http'
  | 'otlp-grpc'
  | 'jaeger'
  | 'zipkin'
  | 'prometheus'
  | 'console'
  | 'datadog'
  | 'splunk'
  | 'newrelic';

export interface TelemetryExporterConfig {
  /** Exporter type */
  type: TelemetryExporterType;
  /** Endpoint URL */
  endpoint: string;
  /** Headers for authentication */
  headers?: Record<string, string>;
  /** API key (for vendor exporters) */
  apiKey?: string;
  /** Batch size */
  batchSize?: number;
  /** Export interval (ms) */
  exportIntervalMs?: number;
  /** Timeout (ms) */
  timeoutMs?: number;
  /** Enable compression */
  compression?: boolean;
  /** TLS configuration */
  tls?: {
    insecure?: boolean;
    certFile?: string;
    keyFile?: string;
    caFile?: string;
  };
}

export interface TracingConfig {
  /** Enable tracing */
  enabled: boolean;
  /** Service name */
  serviceName: string;
  /** Service version */
  serviceVersion?: string;
  /** Environment */
  environment?: string;
  /** Sample rate (0.0 - 1.0) */
  sampleRate: number;
  /** Exporters */
  exporters: TelemetryExporterConfig[];
  /** Propagators (W3C, B3, Jaeger) */
  propagators?: string[];
  /** Resource attributes */
  resourceAttributes?: Record<string, string>;
  /** Instrumentation config */
  instrumentation?: {
    http?: boolean;
    grpc?: boolean;
    aws?: boolean;
    database?: boolean;
  };
}

export interface MetricsConfig {
  /** Enable metrics */
  enabled: boolean;
  /** Service name */
  serviceName: string;
  /** Exporters */
  exporters: TelemetryExporterConfig[];
  /** Collection interval (ms) */
  collectionIntervalMs: number;
  /** Resource attributes */
  resourceAttributes?: Record<string, string>;
  /** Custom metrics prefix */
  metricsPrefix?: string;
  /** Enable runtime metrics */
  runtimeMetrics?: boolean;
  /** Enable host metrics */
  hostMetrics?: boolean;
}

export interface LoggingConfig {
  /** Enable log collection */
  enabled: boolean;
  /** Service name */
  serviceName: string;
  /** Exporters */
  exporters: TelemetryExporterConfig[];
  /** Minimum log level */
  minLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  /** Include trace context */
  includeTraceContext: boolean;
  /** Resource attributes */
  resourceAttributes?: Record<string, string>;
  /** Structured logging format */
  structuredFormat?: 'json' | 'logfmt';
}

export interface TelemetryConfig {
  /** Tenant ID */
  tenantId: string;
  /** Configuration name */
  name: string;
  /** Tracing configuration */
  tracing?: TracingConfig;
  /** Metrics configuration */
  metrics?: MetricsConfig;
  /** Logging configuration */
  logging?: LoggingConfig;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

// =============================================================================
// Deployment Metrics Types
// =============================================================================

export type DeploymentStatus =
  | 'pending'
  | 'in_progress'
  | 'succeeded'
  | 'failed'
  | 'rolled_back'
  | 'cancelled';

export interface DeploymentMetric {
  /** Metric ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Deployment ID */
  deploymentId: string;
  /** Project/application name */
  projectName: string;
  /** Environment */
  environment: string;
  /** Region */
  region?: string;
  /** Status */
  status: DeploymentStatus;
  /** Deployment started */
  startedAt: string;
  /** Deployment completed */
  completedAt?: string;
  /** Duration (ms) */
  durationMs?: number;
  /** Triggered by */
  triggeredBy: string;
  /** Trigger type */
  triggerType: 'manual' | 'ci_cd' | 'gitops' | 'rollback' | 'scheduled';
  /** Resources affected */
  resourcesAffected: number;
  /** Resources changed */
  resourcesChanged: number;
  /** Resources created */
  resourcesCreated: number;
  /** Resources deleted */
  resourcesDeleted: number;
  /** Error message */
  errorMessage?: string;
  /** Rollback deployment ID */
  rollbackOf?: string;
  /** Git commit SHA */
  commitSha?: string;
  /** Git branch */
  branch?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface DeploymentFrequencyMetric {
  /** Time period (YYYY-MM-DD or YYYY-MM) */
  period: string;
  /** Granularity */
  granularity: 'hour' | 'day' | 'week' | 'month';
  /** Total deployments */
  totalDeployments: number;
  /** Successful deployments */
  successfulDeployments: number;
  /** Failed deployments */
  failedDeployments: number;
  /** Success rate */
  successRate: number;
  /** Average duration (ms) */
  avgDurationMs: number;
  /** P50 duration (ms) */
  p50DurationMs: number;
  /** P95 duration (ms) */
  p95DurationMs: number;
  /** P99 duration (ms) */
  p99DurationMs: number;
  /** By environment breakdown */
  byEnvironment?: Record<string, {
    total: number;
    success: number;
    failed: number;
  }>;
}

export interface LeadTimeMetric {
  /** Deployment ID */
  deploymentId: string;
  /** Commit to deploy time (ms) */
  commitToDeployMs: number;
  /** PR merge to deploy time (ms) */
  prMergeToDeployMs?: number;
  /** Build time (ms) */
  buildTimeMs?: number;
  /** Test time (ms) */
  testTimeMs?: number;
  /** Approval wait time (ms) */
  approvalWaitMs?: number;
  /** Total lead time (ms) */
  totalLeadTimeMs: number;
}

export interface MeanTimeToRecoveryMetric {
  /** Incident ID */
  incidentId: string;
  /** Deployment that caused failure */
  failedDeploymentId: string;
  /** Recovery deployment ID */
  recoveryDeploymentId: string;
  /** Time to detect (ms) */
  timeToDetectMs: number;
  /** Time to recover (ms) */
  timeToRecoverMs: number;
  /** Total MTTR (ms) */
  totalMttrMs: number;
  /** Recovery method */
  recoveryMethod: 'rollback' | 'fix_forward' | 'manual';
}

export interface ChangeFailureRateMetric {
  /** Time period */
  period: string;
  /** Total changes */
  totalChanges: number;
  /** Failed changes */
  failedChanges: number;
  /** Failure rate */
  failureRate: number;
  /** By type breakdown */
  byType?: Record<string, {
    total: number;
    failed: number;
    rate: number;
  }>;
}

// =============================================================================
// Dashboard Types
// =============================================================================

export type WidgetType =
  | 'line_chart'
  | 'bar_chart'
  | 'pie_chart'
  | 'gauge'
  | 'stat'
  | 'table'
  | 'heatmap'
  | 'log_stream'
  | 'trace_list'
  | 'alert_list'
  | 'deployment_timeline';

export interface DashboardWidget {
  /** Widget ID */
  id: string;
  /** Widget type */
  type: WidgetType;
  /** Title */
  title: string;
  /** Description */
  description?: string;
  /** Grid position */
  gridPosition: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Query configuration */
  query: {
    /** Metric name or query string */
    metric?: string;
    /** PromQL/custom query */
    query?: string;
    /** Data source */
    dataSource?: string;
    /** Aggregation */
    aggregation?: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'p50' | 'p95' | 'p99';
    /** Group by */
    groupBy?: string[];
    /** Filters */
    filters?: Record<string, string>;
    /** Time range */
    timeRange?: string;
  };
  /** Display options */
  options?: {
    unit?: string;
    decimals?: number;
    thresholds?: Array<{ value: number; color: string }>;
    legend?: boolean;
    stacked?: boolean;
  };
}

export interface Dashboard {
  /** Dashboard ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Dashboard name */
  name: string;
  /** Description */
  description?: string;
  /** Owner user ID */
  ownerId: string;
  /** Visibility */
  visibility: 'private' | 'team' | 'organization';
  /** Tags */
  tags: string[];
  /** Widgets */
  widgets: DashboardWidget[];
  /** Default time range */
  defaultTimeRange: string;
  /** Auto refresh interval (seconds) */
  refreshInterval?: number;
  /** Variables/filters */
  variables?: Array<{
    name: string;
    label: string;
    type: 'text' | 'dropdown' | 'multi-select';
    options?: string[];
    default?: string;
  }>;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

// =============================================================================
// Anomaly Detection Types
// =============================================================================

export type AnomalyType =
  | 'spike'
  | 'dip'
  | 'trend_change'
  | 'seasonality_deviation'
  | 'outlier'
  | 'pattern_break';

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AnomalyDetectionModel {
  /** Model ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Model name */
  name: string;
  /** Description */
  description?: string;
  /** Algorithm */
  algorithm: 'isolation_forest' | 'prophet' | 'arima' | 'lstm' | 'statistical' | 'ensemble';
  /** Target metric */
  targetMetric: string;
  /** Model parameters */
  parameters: {
    /** Sensitivity (0.0 - 1.0) */
    sensitivity?: number;
    /** Training window (hours) */
    trainingWindowHours?: number;
    /** Seasonality period (hours) */
    seasonalityPeriod?: number;
    /** Minimum data points for training */
    minDataPoints?: number;
    /** Custom parameters */
    [key: string]: unknown;
  };
  /** Training status */
  trainingStatus: 'pending' | 'training' | 'ready' | 'failed';
  /** Last trained */
  lastTrainedAt?: string;
  /** Model accuracy metrics */
  accuracy?: {
    precision?: number;
    recall?: number;
    f1Score?: number;
    falsePositiveRate?: number;
  };
  /** Active */
  active: boolean;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

export interface DetectedAnomaly {
  /** Anomaly ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Model ID */
  modelId: string;
  /** Anomaly type */
  type: AnomalyType;
  /** Severity */
  severity: AnomalySeverity;
  /** Metric name */
  metricName: string;
  /** Detected value */
  detectedValue: number;
  /** Expected value */
  expectedValue: number;
  /** Deviation percentage */
  deviationPercent: number;
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** Start time */
  startedAt: string;
  /** End time (if resolved) */
  endedAt?: string;
  /** Duration (ms) */
  durationMs?: number;
  /** Related dimensions */
  dimensions?: Record<string, string>;
  /** Root cause analysis */
  rootCauseAnalysis?: {
    possibleCauses: string[];
    correlatedMetrics?: string[];
    correlatedEvents?: string[];
    suggestedActions?: string[];
  };
  /** Acknowledged */
  acknowledged: boolean;
  /** Acknowledged by */
  acknowledgedBy?: string;
  /** False positive marked */
  isFalsePositive?: boolean;
}

// =============================================================================
// Alerting Types
// =============================================================================

export type AlertConditionOperator =
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'regex';

export type AlertState = 'ok' | 'pending' | 'alerting' | 'no_data' | 'error';

export interface AlertCondition {
  /** Condition type */
  type: 'threshold' | 'anomaly' | 'absence' | 'rate_of_change' | 'composite';
  /** Metric or query */
  metric?: string;
  query?: string;
  /** Operator */
  operator?: AlertConditionOperator;
  /** Threshold value */
  threshold?: number;
  /** Duration before alerting (seconds) */
  forDuration?: number;
  /** Aggregation */
  aggregation?: 'avg' | 'sum' | 'min' | 'max' | 'count' | 'last';
  /** Anomaly model ID (for anomaly type) */
  anomalyModelId?: string;
  /** Absence duration (for absence type) */
  absenceDuration?: number;
  /** Rate of change threshold (for rate_of_change type) */
  rateOfChangePercent?: number;
  /** Child conditions (for composite type) */
  children?: AlertCondition[];
  /** Composite logic (for composite type) */
  logic?: 'and' | 'or';
}

export interface AlertNotificationChannel {
  /** Channel type */
  type: 'email' | 'slack' | 'pagerduty' | 'opsgenie' | 'webhook' | 'teams' | 'sns';
  /** Channel configuration */
  config: {
    /** Email addresses */
    emails?: string[];
    /** Slack webhook URL or channel */
    slackWebhook?: string;
    slackChannel?: string;
    /** PagerDuty integration key */
    pagerdutyKey?: string;
    pagerdutyServiceId?: string;
    /** OpsGenie API key */
    opsgenieKey?: string;
    /** Webhook URL */
    webhookUrl?: string;
    webhookHeaders?: Record<string, string>;
    /** MS Teams webhook */
    teamsWebhook?: string;
    /** SNS topic ARN */
    snsTopicArn?: string;
  };
  /** Send on states */
  sendOn: AlertState[];
  /** Message template */
  messageTemplate?: string;
}

export interface AlertRule {
  /** Rule ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Rule name */
  name: string;
  /** Description */
  description?: string;
  /** Severity */
  severity: AnomalySeverity;
  /** Condition */
  condition: AlertCondition;
  /** Notification channels */
  notifications: AlertNotificationChannel[];
  /** Labels */
  labels?: Record<string, string>;
  /** Annotations */
  annotations?: Record<string, string>;
  /** Evaluation interval (seconds) */
  evaluationInterval: number;
  /** Enabled */
  enabled: boolean;
  /** Muted until */
  mutedUntil?: string;
  /** Current state */
  currentState: AlertState;
  /** Last evaluation */
  lastEvaluatedAt?: string;
  /** Last state change */
  lastStateChangeAt?: string;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

export interface AlertIncident {
  /** Incident ID */
  id: string;
  /** Tenant ID */
  tenantId: string;
  /** Alert rule ID */
  alertRuleId: string;
  /** Alert rule name */
  alertRuleName: string;
  /** Severity */
  severity: AnomalySeverity;
  /** State */
  state: 'firing' | 'resolved';
  /** Started at */
  startedAt: string;
  /** Resolved at */
  resolvedAt?: string;
  /** Duration (ms) */
  durationMs?: number;
  /** Metric value that triggered */
  triggerValue?: number;
  /** Labels */
  labels?: Record<string, string>;
  /** Notifications sent */
  notificationsSent: Array<{
    channel: string;
    sentAt: string;
    success: boolean;
    error?: string;
  }>;
  /** Acknowledged */
  acknowledged: boolean;
  /** Acknowledged by */
  acknowledgedBy?: string;
  /** Acknowledged at */
  acknowledgedAt?: string;
  /** Notes */
  notes?: string;
}

// =============================================================================
// Integration Types (Datadog, Splunk, New Relic)
// =============================================================================

export type ObservabilityProvider = 'datadog' | 'splunk' | 'newrelic' | 'grafana' | 'prometheus' | 'cloudwatch';

export interface DatadogIntegration {
  /** Provider type */
  provider: 'datadog';
  /** API key */
  apiKey: string;
  /** Application key */
  appKey?: string;
  /** Site (datadoghq.com, datadoghq.eu, etc.) */
  site: string;
  /** Service name */
  serviceName: string;
  /** Environment */
  environment?: string;
  /** Tags */
  tags?: string[];
  /** Enable APM */
  enableApm?: boolean;
  /** Enable logs */
  enableLogs?: boolean;
  /** Enable infrastructure */
  enableInfrastructure?: boolean;
}

export interface SplunkIntegration {
  /** Provider type */
  provider: 'splunk';
  /** HEC endpoint */
  hecEndpoint: string;
  /** HEC token */
  hecToken: string;
  /** Index */
  index?: string;
  /** Source */
  source?: string;
  /** Source type */
  sourceType?: string;
  /** Enable metrics */
  enableMetrics?: boolean;
  /** Enable traces */
  enableTraces?: boolean;
  /** Splunk Observability realm (for O11y Cloud) */
  observabilityRealm?: string;
  /** Observability access token */
  observabilityToken?: string;
}

export interface NewRelicIntegration {
  /** Provider type */
  provider: 'newrelic';
  /** License key */
  licenseKey: string;
  /** Insights insert key */
  insightsInsertKey?: string;
  /** Account ID */
  accountId: string;
  /** Region (US or EU) */
  region: 'us' | 'eu';
  /** Application name */
  appName: string;
  /** Enable distributed tracing */
  enableDistributedTracing?: boolean;
  /** Enable logs in context */
  enableLogsInContext?: boolean;
  /** Enable infrastructure agent */
  enableInfrastructure?: boolean;
}

export interface ObservabilityIntegrationConfig {
  /** Tenant ID */
  tenantId: string;
  /** Integration ID */
  id: string;
  /** Integration name */
  name: string;
  /** Active */
  active: boolean;
  /** Configuration */
  config: DatadogIntegration | SplunkIntegration | NewRelicIntegration;
  /** Sync deployments to provider */
  syncDeployments?: boolean;
  /** Sync alerts from provider */
  syncAlerts?: boolean;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

// =============================================================================
// Result Types
// =============================================================================

export interface ObservabilityResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}
