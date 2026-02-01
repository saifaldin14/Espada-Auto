/**
 * AWS Observability Types
 *
 * Type definitions for CloudWatch, X-Ray, CloudWatch Logs, Synthetics,
 * and comprehensive monitoring operations.
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Observability operation result
 */
export interface ObservabilityOperationResult<T = void> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/**
 * Observability Manager configuration
 */
export interface ObservabilityManagerConfig {
  /** Default AWS region */
  defaultRegion?: string;
  /** AWS credentials */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

/**
 * Time range for queries
 */
export interface TimeRange {
  startTime: Date;
  endTime: Date;
}

/**
 * Dimension for metrics
 */
export interface MetricDimension {
  name: string;
  value: string;
}

// =============================================================================
// CloudWatch Alarms Types
// =============================================================================

/**
 * Alarm state values
 */
export type AlarmState = 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';

/**
 * Comparison operators for alarms
 */
export type ComparisonOperator =
  | 'GreaterThanOrEqualToThreshold'
  | 'GreaterThanThreshold'
  | 'LessThanThreshold'
  | 'LessThanOrEqualToThreshold'
  | 'LessThanLowerOrGreaterThanUpperThreshold'
  | 'LessThanLowerThreshold'
  | 'GreaterThanUpperThreshold';

/**
 * Statistic types
 */
export type Statistic = 'SampleCount' | 'Average' | 'Sum' | 'Minimum' | 'Maximum';

/**
 * Treat missing data options
 */
export type TreatMissingData = 'breaching' | 'notBreaching' | 'ignore' | 'missing';

/**
 * Standard unit types
 */
export type StandardUnit =
  | 'Seconds'
  | 'Microseconds'
  | 'Milliseconds'
  | 'Bytes'
  | 'Kilobytes'
  | 'Megabytes'
  | 'Gigabytes'
  | 'Terabytes'
  | 'Bits'
  | 'Kilobits'
  | 'Megabits'
  | 'Gigabits'
  | 'Terabits'
  | 'Percent'
  | 'Count'
  | 'Bytes/Second'
  | 'Kilobytes/Second'
  | 'Megabytes/Second'
  | 'Gigabytes/Second'
  | 'Terabytes/Second'
  | 'Bits/Second'
  | 'Kilobits/Second'
  | 'Megabits/Second'
  | 'Gigabits/Second'
  | 'Terabits/Second'
  | 'Count/Second'
  | 'None';

/**
 * CloudWatch alarm information
 */
export interface AlarmInfo {
  alarmName: string;
  alarmArn: string;
  alarmDescription?: string;
  stateValue: AlarmState;
  stateReason?: string;
  stateReasonData?: string;
  stateUpdatedTimestamp?: Date;
  metricName?: string;
  namespace?: string;
  statistic?: Statistic;
  extendedStatistic?: string;
  dimensions: MetricDimension[];
  period?: number;
  evaluationPeriods: number;
  datapointsToAlarm?: number;
  threshold?: number;
  comparisonOperator: ComparisonOperator;
  treatMissingData?: TreatMissingData;
  actionsEnabled: boolean;
  alarmActions: string[];
  okActions: string[];
  insufficientDataActions: string[];
  unit?: StandardUnit;
  alarmConfigurationUpdatedTimestamp?: Date;
}

/**
 * Options for listing alarms
 */
export interface ListAlarmsOptions {
  alarmNames?: string[];
  alarmNamePrefix?: string;
  stateValue?: AlarmState;
  actionPrefix?: string;
  maxResults?: number;
}

/**
 * Options for creating an alarm
 */
export interface CreateAlarmOptions {
  alarmName: string;
  alarmDescription?: string;
  metricName: string;
  namespace: string;
  statistic?: Statistic;
  extendedStatistic?: string;
  dimensions?: MetricDimension[];
  period: number;
  evaluationPeriods: number;
  datapointsToAlarm?: number;
  threshold: number;
  comparisonOperator: ComparisonOperator;
  treatMissingData?: TreatMissingData;
  actionsEnabled?: boolean;
  alarmActions?: string[];
  okActions?: string[];
  insufficientDataActions?: string[];
  unit?: StandardUnit;
  tags?: Record<string, string>;
}

/**
 * Alarm history item
 */
export interface AlarmHistoryItem {
  alarmName: string;
  alarmType?: string;
  timestamp?: Date;
  historyItemType?: 'ConfigurationUpdate' | 'StateUpdate' | 'Action';
  historySummary?: string;
  historyData?: string;
}

// =============================================================================
// CloudWatch Metrics Types
// =============================================================================

/**
 * Metric data point
 */
export interface MetricDataPoint {
  timestamp?: Date;
  sampleCount?: number;
  average?: number;
  sum?: number;
  minimum?: number;
  maximum?: number;
  unit?: StandardUnit;
  extendedStatistics?: Record<string, number>;
}

/**
 * Metric information
 */
export interface MetricInfo {
  namespace: string;
  metricName: string;
  dimensions: MetricDimension[];
}

/**
 * Options for getting metric statistics
 */
export interface GetMetricStatisticsOptions {
  namespace: string;
  metricName: string;
  dimensions?: MetricDimension[];
  startTime: Date;
  endTime: Date;
  period: number;
  statistics?: Statistic[];
  extendedStatistics?: string[];
  unit?: StandardUnit;
}

/**
 * Metric data query for GetMetricData
 */
export interface MetricDataQuery {
  id: string;
  metricStat?: {
    metric: {
      namespace: string;
      metricName: string;
      dimensions?: MetricDimension[];
    };
    period: number;
    stat: string;
    unit?: StandardUnit;
  };
  expression?: string;
  label?: string;
  returnData?: boolean;
  period?: number;
}

/**
 * Metric data result
 */
export interface MetricDataResult {
  id: string;
  label?: string;
  timestamps: Date[];
  values: number[];
  statusCode?: 'Complete' | 'InternalError' | 'PartialData' | 'Forbidden';
  messages?: { code?: string; value?: string }[];
}

/**
 * Options for putting custom metric data
 */
export interface PutMetricDataOptions {
  namespace: string;
  metricData: {
    metricName: string;
    dimensions?: MetricDimension[];
    timestamp?: Date;
    value?: number;
    values?: number[];
    counts?: number[];
    statisticValues?: {
      sampleCount: number;
      sum: number;
      minimum: number;
      maximum: number;
    };
    unit?: StandardUnit;
    storageResolution?: number;
  }[];
}

/**
 * Options for listing metrics
 */
export interface ListMetricsOptions {
  namespace?: string;
  metricName?: string;
  dimensions?: MetricDimension[];
  recentlyActive?: 'PT3H';
  includeLinkedAccounts?: boolean;
  owningAccount?: string;
}

// =============================================================================
// CloudWatch Dashboards Types
// =============================================================================

/**
 * Dashboard information
 */
export interface DashboardInfo {
  dashboardName: string;
  dashboardArn?: string;
  lastModified?: Date;
  size?: number;
}

/**
 * Dashboard body widget
 */
export interface DashboardWidget {
  type: 'metric' | 'text' | 'log' | 'alarm' | 'explorer';
  x: number;
  y: number;
  width: number;
  height: number;
  properties: Record<string, unknown>;
}

/**
 * Dashboard body structure
 */
export interface DashboardBody {
  widgets: DashboardWidget[];
  start?: string;
  end?: string;
  periodOverride?: 'auto' | 'inherit' | number;
}

/**
 * Options for creating a dashboard
 */
export interface CreateDashboardOptions {
  dashboardName: string;
  dashboardBody: DashboardBody;
}

/**
 * Dashboard template for common use cases
 */
export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  category: 'ec2' | 'rds' | 'lambda' | 'ecs' | 'eks' | 'apigateway' | 'elb' | 'custom';
  requiredDimensions: string[];
  widgets: DashboardWidget[];
}

// =============================================================================
// CloudWatch Logs Types
// =============================================================================

/**
 * Log group information
 */
export interface LogGroupInfo {
  logGroupName: string;
  logGroupArn?: string;
  creationTime?: Date;
  retentionInDays?: number;
  metricFilterCount?: number;
  storedBytes?: number;
  kmsKeyId?: string;
  dataProtectionStatus?: 'ACTIVATED' | 'DELETED' | 'ARCHIVED' | 'DISABLED';
}

/**
 * Log stream information
 */
export interface LogStreamInfo {
  logStreamName: string;
  creationTime?: Date;
  firstEventTimestamp?: Date;
  lastEventTimestamp?: Date;
  lastIngestionTime?: Date;
  uploadSequenceToken?: string;
  arn?: string;
  storedBytes?: number;
}

/**
 * Log event
 */
export interface LogEvent {
  timestamp?: Date;
  message: string;
  ingestionTime?: Date;
  logStreamName?: string;
  eventId?: string;
}

/**
 * Options for listing log groups
 */
export interface ListLogGroupsOptions {
  logGroupNamePrefix?: string;
  logGroupNamePattern?: string;
  includeLinkedAccounts?: boolean;
  logGroupClass?: 'STANDARD' | 'INFREQUENT_ACCESS';
  maxResults?: number;
}

/**
 * Options for listing log streams
 */
export interface ListLogStreamsOptions {
  logGroupName: string;
  logStreamNamePrefix?: string;
  orderBy?: 'LogStreamName' | 'LastEventTime';
  descending?: boolean;
  maxResults?: number;
}

/**
 * Options for filtering log events
 */
export interface FilterLogEventsOptions {
  logGroupName: string;
  logStreamNames?: string[];
  logStreamNamePrefix?: string;
  startTime?: Date;
  endTime?: Date;
  filterPattern?: string;
  limit?: number;
  interleaved?: boolean;
  unmask?: boolean;
}

/**
 * Log Insights query status
 */
export type QueryStatus = 'Scheduled' | 'Running' | 'Complete' | 'Failed' | 'Cancelled' | 'Timeout' | 'Unknown';

/**
 * Log Insights query result field
 */
export interface QueryResultField {
  field?: string;
  value?: string;
}

/**
 * Log Insights query result
 */
export interface LogInsightsQueryResult {
  queryId: string;
  status: QueryStatus;
  statistics?: {
    recordsMatched?: number;
    recordsScanned?: number;
    bytesScanned?: number;
  };
  results: QueryResultField[][];
}

/**
 * Options for starting a Log Insights query
 */
export interface StartLogInsightsQueryOptions {
  logGroupNames: string[];
  queryString: string;
  startTime: Date;
  endTime: Date;
  limit?: number;
}

/**
 * Metric filter information
 */
export interface MetricFilterInfo {
  filterName: string;
  filterPattern: string;
  metricTransformations: {
    metricName: string;
    metricNamespace: string;
    metricValue: string;
    defaultValue?: number;
    dimensions?: Record<string, string>;
    unit?: StandardUnit;
  }[];
  creationTime?: Date;
  logGroupName?: string;
}

/**
 * Options for creating a metric filter
 */
export interface CreateMetricFilterOptions {
  filterName: string;
  filterPattern: string;
  logGroupName: string;
  metricTransformations: {
    metricName: string;
    metricNamespace: string;
    metricValue: string;
    defaultValue?: number;
    dimensions?: Record<string, string>;
    unit?: StandardUnit;
  }[];
}

// =============================================================================
// X-Ray Types
// =============================================================================

/**
 * X-Ray trace summary
 */
export interface TraceSummary {
  id?: string;
  duration?: number;
  responseTime?: number;
  hasFault?: boolean;
  hasError?: boolean;
  hasThrottle?: boolean;
  isPartial?: boolean;
  http?: {
    httpURL?: string;
    httpStatus?: number;
    httpMethod?: string;
    userAgent?: string;
    clientIp?: string;
  };
  annotations?: Record<string, { annotationValue?: { stringValue?: string; numberValue?: number; booleanValue?: boolean } }[]>;
  users?: { userName?: string }[];
  serviceIds?: {
    name?: string;
    names?: string[];
    accountId?: string;
    type?: string;
  }[];
  resourceARNs?: { arn?: string }[];
  matchedEventTime?: Date;
  availabilityZones?: { name?: string }[];
  entryPoint?: {
    name?: string;
    names?: string[];
    accountId?: string;
    type?: string;
  };
  faultRootCauses?: {
    services?: {
      name?: string;
      names?: string[];
      type?: string;
      accountId?: string;
      entityPath?: { name?: string; exceptions?: { name?: string; message?: string }[] }[];
      inferred?: boolean;
    }[];
    clientImpacting?: boolean;
  }[];
  errorRootCauses?: {
    services?: {
      name?: string;
      names?: string[];
      type?: string;
      accountId?: string;
      entityPath?: { name?: string; exceptions?: { name?: string; message?: string }[] }[];
      inferred?: boolean;
    }[];
    clientImpacting?: boolean;
  }[];
  responseTimeRootCauses?: {
    services?: {
      name?: string;
      names?: string[];
      type?: string;
      accountId?: string;
      entityPath?: { name?: string; coverage?: number }[];
      inferred?: boolean;
    }[];
    clientImpacting?: boolean;
  }[];
  revision?: number;
}

/**
 * X-Ray trace segment
 */
export interface TraceSegment {
  id?: string;
  document?: string;
}

/**
 * X-Ray trace detail
 */
export interface TraceDetail {
  id?: string;
  duration?: number;
  limitExceeded?: boolean;
  segments: TraceSegment[];
}

/**
 * Options for getting trace summaries
 */
export interface GetTraceSummariesOptions {
  startTime: Date;
  endTime: Date;
  timeRangeType?: 'TraceId' | 'Event';
  sampling?: boolean;
  samplingStrategy?: {
    name?: 'PartialScan' | 'FixedRate';
    value?: number;
  };
  filterExpression?: string;
}

/**
 * X-Ray service map node
 */
export interface ServiceMapNode {
  referenceId?: number;
  name?: string;
  names?: string[];
  root?: boolean;
  accountId?: string;
  type?: string;
  state?: string;
  startTime?: Date;
  endTime?: Date;
  edges?: {
    referenceId?: number;
    startTime?: Date;
    endTime?: Date;
    summaryStatistics?: {
      okCount?: number;
      errorStatistics?: { throttleCount?: number; otherCount?: number; totalCount?: number };
      faultStatistics?: { otherCount?: number; totalCount?: number };
      totalCount?: number;
      totalResponseTime?: number;
    };
    responseTimeHistogram?: { value?: number; count?: number }[];
    aliases?: { name?: string; names?: string[]; type?: string }[];
  }[];
  summaryStatistics?: {
    okCount?: number;
    errorStatistics?: { throttleCount?: number; otherCount?: number; totalCount?: number };
    faultStatistics?: { otherCount?: number; totalCount?: number };
    totalCount?: number;
    totalResponseTime?: number;
  };
  durationHistogram?: { value?: number; count?: number }[];
  responseTimeHistogram?: { value?: number; count?: number }[];
}

/**
 * X-Ray service map
 */
export interface ServiceMap {
  startTime?: Date;
  endTime?: Date;
  services: ServiceMapNode[];
  containsOldGroupVersions?: boolean;
}

/**
 * X-Ray group information
 */
export interface XRayGroupInfo {
  groupName?: string;
  groupARN?: string;
  filterExpression?: string;
  insightsConfiguration?: {
    insightsEnabled?: boolean;
    notificationsEnabled?: boolean;
  };
}

/**
 * X-Ray insight summary
 */
export interface InsightSummary {
  insightId?: string;
  groupARN?: string;
  groupName?: string;
  rootCauseServiceId?: {
    name?: string;
    names?: string[];
    accountId?: string;
    type?: string;
  };
  categories?: ('FAULT')[];
  state?: 'ACTIVE' | 'CLOSED';
  startTime?: Date;
  endTime?: Date;
  summary?: string;
  clientRequestImpactStatistics?: {
    faultCount?: number;
    okCount?: number;
    totalCount?: number;
  };
  rootCauseServiceRequestImpactStatistics?: {
    faultCount?: number;
    okCount?: number;
    totalCount?: number;
  };
  topAnomalousServices?: {
    serviceId?: {
      name?: string;
      names?: string[];
      accountId?: string;
      type?: string;
    };
  }[];
  lastUpdateTime?: Date;
}

// =============================================================================
// CloudWatch Synthetics Types
// =============================================================================

/**
 * Canary runtime version
 */
export type CanaryRuntime =
  | 'syn-python-selenium-1.0'
  | 'syn-python-selenium-1.1'
  | 'syn-python-selenium-1.2'
  | 'syn-python-selenium-1.3'
  | 'syn-python-selenium-2.0'
  | 'syn-python-selenium-2.1'
  | 'syn-nodejs-puppeteer-3.0'
  | 'syn-nodejs-puppeteer-3.1'
  | 'syn-nodejs-puppeteer-3.2'
  | 'syn-nodejs-puppeteer-3.3'
  | 'syn-nodejs-puppeteer-3.4'
  | 'syn-nodejs-puppeteer-3.5'
  | 'syn-nodejs-puppeteer-3.6'
  | 'syn-nodejs-puppeteer-3.7'
  | 'syn-nodejs-puppeteer-3.8'
  | 'syn-nodejs-puppeteer-3.9'
  | 'syn-nodejs-puppeteer-4.0'
  | 'syn-nodejs-puppeteer-5.0'
  | 'syn-nodejs-puppeteer-5.1'
  | 'syn-nodejs-puppeteer-5.2'
  | 'syn-nodejs-puppeteer-6.0'
  | 'syn-nodejs-puppeteer-6.1'
  | 'syn-nodejs-puppeteer-6.2';

/**
 * Canary state
 */
export type CanaryState =
  | 'CREATING'
  | 'READY'
  | 'STARTING'
  | 'RUNNING'
  | 'UPDATING'
  | 'STOPPING'
  | 'STOPPED'
  | 'ERROR'
  | 'DELETING';

/**
 * Canary run state
 */
export type CanaryRunState = 'RUNNING' | 'PASSED' | 'FAILED';

/**
 * Canary information
 */
export interface CanaryInfo {
  id?: string;
  name: string;
  status?: {
    state?: CanaryState;
    stateReason?: string;
    stateReasonCode?: 'INVALID_PERMISSIONS' | 'CREATE_PENDING' | 'CREATE_IN_PROGRESS' | 'CREATE_FAILED' | 'UPDATE_PENDING' | 'UPDATE_IN_PROGRESS' | 'UPDATE_COMPLETE' | 'ROLLBACK_COMPLETE' | 'ROLLBACK_FAILED' | 'DELETE_IN_PROGRESS' | 'DELETE_FAILED' | 'SYNC_DELETE_IN_PROGRESS';
  };
  schedule?: {
    expression?: string;
    durationInSeconds?: number;
  };
  runConfig?: {
    timeoutInSeconds?: number;
    memoryInMB?: number;
    activeTracing?: boolean;
    environmentVariables?: Record<string, string>;
  };
  successRetentionPeriodInDays?: number;
  failureRetentionPeriodInDays?: number;
  code?: {
    sourceLocationArn?: string;
    handler?: string;
  };
  executionRoleArn?: string;
  runtimeVersion?: string;
  vpcConfig?: {
    vpcId?: string;
    subnetIds?: string[];
    securityGroupIds?: string[];
  };
  artifactS3Location?: string;
  engineArn?: string;
  tags?: Record<string, string>;
}

/**
 * Canary run information
 */
export interface CanaryRunInfo {
  id?: string;
  name?: string;
  status?: {
    state?: CanaryRunState;
    stateReason?: string;
    stateReasonCode?: 'CANARY_FAILURE' | 'EXECUTION_FAILURE';
  };
  timeline?: {
    started?: Date;
    completed?: Date;
  };
  artifactS3Location?: string;
}

/**
 * Options for creating a canary
 */
export interface CreateCanaryOptions {
  name: string;
  code: {
    s3Bucket?: string;
    s3Key?: string;
    s3Version?: string;
    zipFile?: Uint8Array;
    handler: string;
  };
  artifactS3Location: string;
  executionRoleArn: string;
  schedule: {
    expression: string;
    durationInSeconds?: number;
  };
  runConfig?: {
    timeoutInSeconds?: number;
    memoryInMB?: number;
    activeTracing?: boolean;
    environmentVariables?: Record<string, string>;
  };
  successRetentionPeriodInDays?: number;
  failureRetentionPeriodInDays?: number;
  runtimeVersion: CanaryRuntime;
  vpcConfig?: {
    subnetIds?: string[];
    securityGroupIds?: string[];
  };
  tags?: Record<string, string>;
}

/**
 * Options for updating a canary
 */
export interface UpdateCanaryOptions {
  name: string;
  code?: {
    s3Bucket?: string;
    s3Key?: string;
    s3Version?: string;
    zipFile?: Uint8Array;
    handler?: string;
  };
  executionRoleArn?: string;
  runtimeVersion?: CanaryRuntime;
  schedule?: {
    expression?: string;
    durationInSeconds?: number;
  };
  runConfig?: {
    timeoutInSeconds?: number;
    memoryInMB?: number;
    activeTracing?: boolean;
    environmentVariables?: Record<string, string>;
  };
  successRetentionPeriodInDays?: number;
  failureRetentionPeriodInDays?: number;
  vpcConfig?: {
    subnetIds?: string[];
    securityGroupIds?: string[];
  };
  artifactS3Location?: string;
}

// =============================================================================
// Anomaly Detection Types
// =============================================================================

/**
 * Anomaly detector information
 */
export interface AnomalyDetectorInfo {
  namespace?: string;
  metricName?: string;
  dimensions: MetricDimension[];
  stat?: string;
  configuration?: {
    excludedTimeRanges?: TimeRange[];
    metricTimezone?: string;
  };
  stateValue?: 'PENDING_TRAINING' | 'TRAINED_INSUFFICIENT_DATA' | 'TRAINED';
  singleMetricAnomalyDetector?: {
    namespace?: string;
    metricName?: string;
    dimensions?: MetricDimension[];
    stat?: string;
  };
  metricMathAnomalyDetector?: {
    metricDataQueries?: MetricDataQuery[];
  };
}

/**
 * Options for putting an anomaly detector
 */
export interface PutAnomalyDetectorOptions {
  namespace: string;
  metricName: string;
  dimensions?: MetricDimension[];
  stat: string;
  configuration?: {
    excludedTimeRanges?: TimeRange[];
    metricTimezone?: string;
  };
}

// =============================================================================
// Composite Alarm Types
// =============================================================================

/**
 * Composite alarm information
 */
export interface CompositeAlarmInfo {
  alarmName: string;
  alarmArn?: string;
  alarmDescription?: string;
  alarmRule: string;
  stateValue: AlarmState;
  stateReason?: string;
  stateReasonData?: string;
  stateUpdatedTimestamp?: Date;
  stateTransitionedTimestamp?: Date;
  actionsEnabled: boolean;
  alarmActions: string[];
  okActions: string[];
  insufficientDataActions: string[];
  alarmConfigurationUpdatedTimestamp?: Date;
  actionsSuppressedBy?: 'WaitPeriod' | 'ExtensionPeriod' | 'Alarm';
  actionsSuppressedReason?: string;
  actionsSuppressor?: string;
  actionsSuppressorExtensionPeriod?: number;
  actionsSuppressorWaitPeriod?: number;
}

/**
 * Options for creating a composite alarm
 */
export interface CreateCompositeAlarmOptions {
  alarmName: string;
  alarmDescription?: string;
  alarmRule: string;
  actionsEnabled?: boolean;
  alarmActions?: string[];
  okActions?: string[];
  insufficientDataActions?: string[];
  actionsSuppressor?: string;
  actionsSuppressorExtensionPeriod?: number;
  actionsSuppressorWaitPeriod?: number;
  tags?: Record<string, string>;
}

// =============================================================================
// Observability Summary Types
// =============================================================================

/**
 * Overall observability health summary
 */
export interface ObservabilityHealthSummary {
  timestamp: Date;
  alarms: {
    total: number;
    inAlarm: number;
    ok: number;
    insufficientData: number;
    topAlarms: AlarmInfo[];
  };
  logs: {
    totalGroups: number;
    totalStoredBytes: number;
    recentErrors: number;
    topLogGroups: LogGroupInfo[];
  };
  traces: {
    totalTraces: number;
    faultPercentage: number;
    errorPercentage: number;
    averageLatency: number;
  };
  synthetics: {
    totalCanaries: number;
    passing: number;
    failing: number;
    recentRuns: CanaryRunInfo[];
  };
  anomalies: {
    totalDetectors: number;
    activeAnomalies: number;
  };
}

/**
 * Predefined alarm templates
 */
export interface AlarmTemplate {
  id: string;
  name: string;
  description: string;
  category: 'ec2' | 'rds' | 'lambda' | 'ecs' | 'elb' | 'apigateway' | 's3' | 'dynamodb' | 'sqs' | 'sns' | 'custom';
  metricName: string;
  namespace: string;
  statistic: Statistic;
  period: number;
  evaluationPeriods: number;
  threshold: number;
  comparisonOperator: ComparisonOperator;
  requiredDimensions: string[];
  treatMissingData: TreatMissingData;
}

/**
 * Canary blueprint template
 */
export interface CanaryBlueprint {
  id: string;
  name: string;
  description: string;
  type: 'heartbeat' | 'api' | 'broken-link' | 'visual' | 'gui-workflow';
  runtime: CanaryRuntime;
  codeTemplate: string;
  requiredParameters: string[];
}
