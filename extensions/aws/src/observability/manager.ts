/**
 * AWS Observability Manager
 *
 * Provides comprehensive observability support including:
 * - CloudWatch Alarms management
 * - CloudWatch Metrics and custom metrics
 * - CloudWatch Dashboards
 * - CloudWatch Logs and Log Insights
 * - X-Ray tracing and service maps
 * - CloudWatch Synthetics (Canaries)
 * - Anomaly detection
 * - Composite alarms
 */

import {
  CloudWatchClient,
  PutMetricAlarmCommand,
  DeleteAlarmsCommand,
  DescribeAlarmsCommand,
  DescribeAlarmHistoryCommand,
  SetAlarmStateCommand,
  EnableAlarmActionsCommand,
  DisableAlarmActionsCommand,
  GetMetricStatisticsCommand,
  GetMetricDataCommand,
  ListMetricsCommand,
  PutMetricDataCommand,
  PutDashboardCommand,
  GetDashboardCommand,
  DeleteDashboardsCommand,
  ListDashboardsCommand,
  PutAnomalyDetectorCommand,
  DeleteAnomalyDetectorCommand,
  DescribeAnomalyDetectorsCommand,
  PutCompositeAlarmCommand,
  DescribeAlarmsForMetricCommand,
  TagResourceCommand,
  UntagResourceCommand,
  type MetricAlarm,
  type DashboardEntry,
  type Metric,
  type Datapoint,
  type MetricDataResult as CWMetricDataResult,
  type AlarmHistoryItem as CWAlarmHistoryItem,
  type AnomalyDetector,
  type CompositeAlarm,
} from '@aws-sdk/client-cloudwatch';

import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  CreateLogGroupCommand,
  DeleteLogGroupCommand,
  PutRetentionPolicyCommand,
  FilterLogEventsCommand,
  GetLogEventsCommand,
  StartQueryCommand,
  GetQueryResultsCommand,
  StopQueryCommand,
  DescribeQueriesCommand,
  PutMetricFilterCommand,
  DeleteMetricFilterCommand,
  DescribeMetricFiltersCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  TagLogGroupCommand,
  type LogGroup,
  type LogStream,
  type FilteredLogEvent,
  type OutputLogEvent,
  type QueryInfo,
  type MetricFilter,
} from '@aws-sdk/client-cloudwatch-logs';

import {
  XRayClient,
  GetTraceSummariesCommand,
  BatchGetTracesCommand,
  GetServiceGraphCommand,
  GetGroupsCommand,
  CreateGroupCommand,
  DeleteGroupCommand,
  UpdateGroupCommand,
  GetInsightSummariesCommand,
  GetInsightCommand,
  GetTimeSeriesServiceStatisticsCommand,
  type TraceSummary as XRayTraceSummary,
  type Trace,
  type Service,
  type Group,
  type InsightSummary as XRayInsightSummary,
  type TimeSeriesServiceStatistics,
} from '@aws-sdk/client-xray';

import {
  SyntheticsClient,
  CreateCanaryCommand,
  UpdateCanaryCommand,
  DeleteCanaryCommand,
  GetCanaryCommand,
  GetCanaryRunsCommand,
  DescribeCanariesCommand,
  DescribeCanariesLastRunCommand,
  StartCanaryCommand,
  StopCanaryCommand,
  DescribeRuntimeVersionsCommand,
  TagResourceCommand as SyntheticsTagResourceCommand,
  type Canary,
  type CanaryRun,
  type RuntimeVersion,
} from '@aws-sdk/client-synthetics';

import type {
  ObservabilityManagerConfig,
  ObservabilityOperationResult,
  // Alarms
  AlarmInfo,
  ListAlarmsOptions,
  CreateAlarmOptions,
  AlarmHistoryItem,
  AlarmState,
  AlarmTemplate,
  // Metrics
  MetricDataPoint,
  MetricInfo,
  GetMetricStatisticsOptions,
  MetricDataQuery,
  MetricDataResult,
  PutMetricDataOptions,
  ListMetricsOptions,
  MetricDimension,
  // Dashboards
  DashboardInfo,
  DashboardBody,
  CreateDashboardOptions,
  DashboardTemplate,
  // Logs
  LogGroupInfo,
  LogStreamInfo,
  LogEvent,
  ListLogGroupsOptions,
  ListLogStreamsOptions,
  FilterLogEventsOptions,
  LogInsightsQueryResult,
  StartLogInsightsQueryOptions,
  MetricFilterInfo,
  CreateMetricFilterOptions,
  QueryStatus,
  // X-Ray
  TraceSummary,
  TraceDetail,
  GetTraceSummariesOptions,
  ServiceMap,
  ServiceMapNode,
  XRayGroupInfo,
  InsightSummary,
  // Synthetics
  CanaryInfo,
  CanaryRunInfo,
  CreateCanaryOptions,
  UpdateCanaryOptions,
  CanaryBlueprint,
  // Anomaly Detection
  AnomalyDetectorInfo,
  PutAnomalyDetectorOptions,
  // Composite Alarms
  CompositeAlarmInfo,
  CreateCompositeAlarmOptions,
  // Summary
  ObservabilityHealthSummary,
} from './types.js';

/**
 * AWS Observability Manager
 */
export class ObservabilityManager {
  private cloudWatchClient: CloudWatchClient;
  private logsClient: CloudWatchLogsClient;
  private xrayClient: XRayClient;
  private syntheticsClient: SyntheticsClient;
  private config: ObservabilityManagerConfig;

  constructor(config: ObservabilityManagerConfig = {}) {
    this.config = config;
    const clientConfig = {
      region: config.defaultRegion ?? 'us-east-1',
      credentials: config.credentials,
    };

    this.cloudWatchClient = new CloudWatchClient(clientConfig);
    this.logsClient = new CloudWatchLogsClient(clientConfig);
    this.xrayClient = new XRayClient(clientConfig);
    this.syntheticsClient = new SyntheticsClient(clientConfig);
  }

  // ===========================================================================
  // CloudWatch Alarms Operations
  // ===========================================================================

  /**
   * List CloudWatch alarms
   */
  async listAlarms(options: ListAlarmsOptions = {}): Promise<AlarmInfo[]> {
    const { alarmNames, alarmNamePrefix, stateValue, actionPrefix, maxResults } = options;

    const command = new DescribeAlarmsCommand({
      AlarmNames: alarmNames,
      AlarmNamePrefix: alarmNamePrefix,
      StateValue: stateValue,
      ActionPrefix: actionPrefix,
      MaxRecords: maxResults,
    });

    const response = await this.cloudWatchClient.send(command);
    return (response.MetricAlarms ?? []).map(this.mapAlarm);
  }

  /**
   * Get alarm details
   */
  async getAlarm(alarmName: string): Promise<ObservabilityOperationResult<AlarmInfo>> {
    try {
      const command = new DescribeAlarmsCommand({
        AlarmNames: [alarmName],
      });

      const response = await this.cloudWatchClient.send(command);
      const alarm = response.MetricAlarms?.[0];

      if (!alarm) {
        return { success: false, error: `Alarm ${alarmName} not found` };
      }

      return { success: true, data: this.mapAlarm(alarm) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Create CloudWatch alarm
   */
  async createAlarm(options: CreateAlarmOptions): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new PutMetricAlarmCommand({
        AlarmName: options.alarmName,
        AlarmDescription: options.alarmDescription,
        MetricName: options.metricName,
        Namespace: options.namespace,
        Statistic: options.statistic,
        ExtendedStatistic: options.extendedStatistic,
        Dimensions: options.dimensions?.map(d => ({ Name: d.name, Value: d.value })),
        Period: options.period,
        EvaluationPeriods: options.evaluationPeriods,
        DatapointsToAlarm: options.datapointsToAlarm,
        Threshold: options.threshold,
        ComparisonOperator: options.comparisonOperator,
        TreatMissingData: options.treatMissingData,
        ActionsEnabled: options.actionsEnabled ?? true,
        AlarmActions: options.alarmActions,
        OKActions: options.okActions,
        InsufficientDataActions: options.insufficientDataActions,
        Unit: options.unit,
        Tags: options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
      });

      await this.cloudWatchClient.send(command);
      return { success: true, message: `Alarm ${options.alarmName} created successfully` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete CloudWatch alarms
   */
  async deleteAlarms(alarmNames: string[]): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new DeleteAlarmsCommand({
        AlarmNames: alarmNames,
      });

      await this.cloudWatchClient.send(command);
      return { success: true, message: `Deleted ${alarmNames.length} alarm(s)` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get alarm history
   */
  async getAlarmHistory(
    alarmName?: string,
    historyItemType?: 'ConfigurationUpdate' | 'StateUpdate' | 'Action',
    startDate?: Date,
    endDate?: Date,
    maxRecords?: number
  ): Promise<AlarmHistoryItem[]> {
    const command = new DescribeAlarmHistoryCommand({
      AlarmName: alarmName,
      HistoryItemType: historyItemType,
      StartDate: startDate,
      EndDate: endDate,
      MaxRecords: maxRecords,
    });

    const response = await this.cloudWatchClient.send(command);
    return (response.AlarmHistoryItems ?? []).map(this.mapAlarmHistoryItem);
  }

  /**
   * Set alarm state (for testing)
   */
  async setAlarmState(
    alarmName: string,
    stateValue: AlarmState,
    stateReason: string,
    stateReasonData?: string
  ): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new SetAlarmStateCommand({
        AlarmName: alarmName,
        StateValue: stateValue,
        StateReason: stateReason,
        StateReasonData: stateReasonData,
      });

      await this.cloudWatchClient.send(command);
      return { success: true, message: `Alarm ${alarmName} state set to ${stateValue}` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Enable alarm actions
   */
  async enableAlarmActions(alarmNames: string[]): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new EnableAlarmActionsCommand({
        AlarmNames: alarmNames,
      });

      await this.cloudWatchClient.send(command);
      return { success: true, message: `Enabled actions for ${alarmNames.length} alarm(s)` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Disable alarm actions
   */
  async disableAlarmActions(alarmNames: string[]): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new DisableAlarmActionsCommand({
        AlarmNames: alarmNames,
      });

      await this.cloudWatchClient.send(command);
      return { success: true, message: `Disabled actions for ${alarmNames.length} alarm(s)` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get alarms for a specific metric
   */
  async getAlarmsForMetric(
    namespace: string,
    metricName: string,
    dimensions?: MetricDimension[]
  ): Promise<AlarmInfo[]> {
    const command = new DescribeAlarmsForMetricCommand({
      Namespace: namespace,
      MetricName: metricName,
      Dimensions: dimensions?.map(d => ({ Name: d.name, Value: d.value })),
    });

    const response = await this.cloudWatchClient.send(command);
    return (response.MetricAlarms ?? []).map(this.mapAlarm);
  }

  /**
   * Create alarm from template
   */
  async createAlarmFromTemplate(
    templateId: string,
    alarmName: string,
    dimensions: MetricDimension[],
    alarmActions?: string[],
    thresholdOverride?: number
  ): Promise<ObservabilityOperationResult<void>> {
    const template = this.getAlarmTemplate(templateId);
    if (!template) {
      return { success: false, error: `Template ${templateId} not found` };
    }

    // Validate required dimensions
    for (const reqDim of template.requiredDimensions) {
      if (!dimensions.find(d => d.name === reqDim)) {
        return { success: false, error: `Missing required dimension: ${reqDim}` };
      }
    }

    return this.createAlarm({
      alarmName,
      alarmDescription: template.description,
      metricName: template.metricName,
      namespace: template.namespace,
      statistic: template.statistic,
      period: template.period,
      evaluationPeriods: template.evaluationPeriods,
      threshold: thresholdOverride ?? template.threshold,
      comparisonOperator: template.comparisonOperator,
      dimensions,
      treatMissingData: template.treatMissingData,
      alarmActions,
    });
  }

  // ===========================================================================
  // CloudWatch Metrics Operations
  // ===========================================================================

  /**
   * Get metric statistics
   */
  async getMetricStatistics(options: GetMetricStatisticsOptions): Promise<MetricDataPoint[]> {
    const command = new GetMetricStatisticsCommand({
      Namespace: options.namespace,
      MetricName: options.metricName,
      Dimensions: options.dimensions?.map(d => ({ Name: d.name, Value: d.value })),
      StartTime: options.startTime,
      EndTime: options.endTime,
      Period: options.period,
      Statistics: options.statistics,
      ExtendedStatistics: options.extendedStatistics,
      Unit: options.unit,
    });

    const response = await this.cloudWatchClient.send(command);
    return (response.Datapoints ?? []).map(this.mapDatapoint);
  }

  /**
   * Get metric data (supports multiple metrics and expressions)
   */
  async getMetricData(
    queries: MetricDataQuery[],
    startTime: Date,
    endTime: Date
  ): Promise<MetricDataResult[]> {
    const command = new GetMetricDataCommand({
      MetricDataQueries: queries.map(q => ({
        Id: q.id,
        MetricStat: q.metricStat ? {
          Metric: {
            Namespace: q.metricStat.metric.namespace,
            MetricName: q.metricStat.metric.metricName,
            Dimensions: q.metricStat.metric.dimensions?.map(d => ({ Name: d.name, Value: d.value })),
          },
          Period: q.metricStat.period,
          Stat: q.metricStat.stat,
          Unit: q.metricStat.unit,
        } : undefined,
        Expression: q.expression,
        Label: q.label,
        ReturnData: q.returnData,
        Period: q.period,
      })),
      StartTime: startTime,
      EndTime: endTime,
    });

    const response = await this.cloudWatchClient.send(command);
    return (response.MetricDataResults ?? []).map(this.mapMetricDataResult);
  }

  /**
   * List available metrics
   */
  async listMetrics(options: ListMetricsOptions = {}): Promise<MetricInfo[]> {
    const command = new ListMetricsCommand({
      Namespace: options.namespace,
      MetricName: options.metricName,
      Dimensions: options.dimensions?.map(d => ({
        Name: d.name,
        Value: d.value,
      })),
      RecentlyActive: options.recentlyActive,
      IncludeLinkedAccounts: options.includeLinkedAccounts,
      OwningAccount: options.owningAccount,
    });

    const response = await this.cloudWatchClient.send(command);
    return (response.Metrics ?? []).map(this.mapMetric);
  }

  /**
   * Put custom metric data
   */
  async putMetricData(options: PutMetricDataOptions): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new PutMetricDataCommand({
        Namespace: options.namespace,
        MetricData: options.metricData.map(m => ({
          MetricName: m.metricName,
          Dimensions: m.dimensions?.map(d => ({ Name: d.name, Value: d.value })),
          Timestamp: m.timestamp,
          Value: m.value,
          Values: m.values,
          Counts: m.counts,
          StatisticValues: m.statisticValues ? {
            SampleCount: m.statisticValues.sampleCount,
            Sum: m.statisticValues.sum,
            Minimum: m.statisticValues.minimum,
            Maximum: m.statisticValues.maximum,
          } : undefined,
          Unit: m.unit,
          StorageResolution: m.storageResolution,
        })),
      });

      await this.cloudWatchClient.send(command);
      return { success: true, message: 'Metric data published successfully' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // CloudWatch Dashboards Operations
  // ===========================================================================

  /**
   * List dashboards
   */
  async listDashboards(dashboardNamePrefix?: string): Promise<DashboardInfo[]> {
    const command = new ListDashboardsCommand({
      DashboardNamePrefix: dashboardNamePrefix,
    });

    const response = await this.cloudWatchClient.send(command);
    return (response.DashboardEntries ?? []).map(this.mapDashboardEntry);
  }

  /**
   * Get dashboard
   */
  async getDashboard(dashboardName: string): Promise<ObservabilityOperationResult<{ info: DashboardInfo; body: DashboardBody }>> {
    try {
      const command = new GetDashboardCommand({
        DashboardName: dashboardName,
      });

      const response = await this.cloudWatchClient.send(command);

      if (!response.DashboardBody) {
        return { success: false, error: `Dashboard ${dashboardName} not found` };
      }

      return {
        success: true,
        data: {
          info: {
            dashboardName: response.DashboardName ?? dashboardName,
            dashboardArn: response.DashboardArn,
          },
          body: JSON.parse(response.DashboardBody) as DashboardBody,
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Create or update dashboard
   */
  async putDashboard(options: CreateDashboardOptions): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new PutDashboardCommand({
        DashboardName: options.dashboardName,
        DashboardBody: JSON.stringify(options.dashboardBody),
      });

      const response = await this.cloudWatchClient.send(command);

      if (response.DashboardValidationMessages && response.DashboardValidationMessages.length > 0) {
        const messages = response.DashboardValidationMessages.map(m => m.Message).join(', ');
        return { success: false, error: `Dashboard validation errors: ${messages}` };
      }

      return { success: true, message: `Dashboard ${options.dashboardName} saved successfully` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete dashboards
   */
  async deleteDashboards(dashboardNames: string[]): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new DeleteDashboardsCommand({
        DashboardNames: dashboardNames,
      });

      await this.cloudWatchClient.send(command);
      return { success: true, message: `Deleted ${dashboardNames.length} dashboard(s)` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Create dashboard from template
   */
  async createDashboardFromTemplate(
    templateId: string,
    dashboardName: string,
    dimensions: Record<string, string>
  ): Promise<ObservabilityOperationResult<void>> {
    const template = this.getDashboardTemplate(templateId);
    if (!template) {
      return { success: false, error: `Dashboard template ${templateId} not found` };
    }

    // Validate required dimensions
    for (const reqDim of template.requiredDimensions) {
      if (!dimensions[reqDim]) {
        return { success: false, error: `Missing required dimension: ${reqDim}` };
      }
    }

    // Replace dimension placeholders in widgets
    const widgets = template.widgets.map(widget => {
      const props = { ...widget.properties };
      // Replace dimension values in metrics
      if (props.metrics && Array.isArray(props.metrics)) {
        props.metrics = (props.metrics as unknown[][]).map(metric => {
          return metric.map(item => {
            if (typeof item === 'string') {
              let result = item;
              for (const [key, value] of Object.entries(dimensions)) {
                result = result.replace(`{{${key}}}`, value);
              }
              return result;
            }
            return item;
          });
        });
      }
      return { ...widget, properties: props };
    });

    return this.putDashboard({
      dashboardName,
      dashboardBody: { widgets },
    });
  }

  // ===========================================================================
  // CloudWatch Logs Operations
  // ===========================================================================

  /**
   * List log groups
   */
  async listLogGroups(options: ListLogGroupsOptions = {}): Promise<LogGroupInfo[]> {
    const command = new DescribeLogGroupsCommand({
      logGroupNamePrefix: options.logGroupNamePrefix,
      logGroupNamePattern: options.logGroupNamePattern,
      includeLinkedAccounts: options.includeLinkedAccounts,
      logGroupClass: options.logGroupClass,
      limit: options.maxResults,
    });

    const response = await this.logsClient.send(command);
    return (response.logGroups ?? []).map(this.mapLogGroup);
  }

  /**
   * Get log group details
   */
  async getLogGroup(logGroupName: string): Promise<ObservabilityOperationResult<LogGroupInfo>> {
    try {
      const command = new DescribeLogGroupsCommand({
        logGroupNamePrefix: logGroupName,
        limit: 1,
      });

      const response = await this.logsClient.send(command);
      const logGroup = response.logGroups?.find(lg => lg.logGroupName === logGroupName);

      if (!logGroup) {
        return { success: false, error: `Log group ${logGroupName} not found` };
      }

      return { success: true, data: this.mapLogGroup(logGroup) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Create log group
   */
  async createLogGroup(
    logGroupName: string,
    kmsKeyId?: string,
    tags?: Record<string, string>
  ): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new CreateLogGroupCommand({
        logGroupName,
        kmsKeyId,
        tags,
      });

      await this.logsClient.send(command);
      return { success: true, message: `Log group ${logGroupName} created` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete log group
   */
  async deleteLogGroup(logGroupName: string): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new DeleteLogGroupCommand({
        logGroupName,
      });

      await this.logsClient.send(command);
      return { success: true, message: `Log group ${logGroupName} deleted` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Set log group retention
   */
  async setLogGroupRetention(logGroupName: string, retentionInDays: number): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new PutRetentionPolicyCommand({
        logGroupName,
        retentionInDays,
      });

      await this.logsClient.send(command);
      return { success: true, message: `Retention set to ${retentionInDays} days` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * List log streams
   */
  async listLogStreams(options: ListLogStreamsOptions): Promise<LogStreamInfo[]> {
    const command = new DescribeLogStreamsCommand({
      logGroupName: options.logGroupName,
      logStreamNamePrefix: options.logStreamNamePrefix,
      orderBy: options.orderBy,
      descending: options.descending,
      limit: options.maxResults,
    });

    const response = await this.logsClient.send(command);
    return (response.logStreams ?? []).map(this.mapLogStream);
  }

  /**
   * Filter log events (search logs)
   */
  async filterLogEvents(options: FilterLogEventsOptions): Promise<LogEvent[]> {
    const command = new FilterLogEventsCommand({
      logGroupName: options.logGroupName,
      logStreamNames: options.logStreamNames,
      logStreamNamePrefix: options.logStreamNamePrefix,
      startTime: options.startTime?.getTime(),
      endTime: options.endTime?.getTime(),
      filterPattern: options.filterPattern,
      limit: options.limit,
      interleaved: options.interleaved,
      unmask: options.unmask,
    });

    const response = await this.logsClient.send(command);
    return (response.events ?? []).map(this.mapFilteredLogEvent);
  }

  /**
   * Get log events from a specific stream
   */
  async getLogEvents(
    logGroupName: string,
    logStreamName: string,
    startTime?: Date,
    endTime?: Date,
    startFromHead?: boolean,
    limit?: number
  ): Promise<LogEvent[]> {
    const command = new GetLogEventsCommand({
      logGroupName,
      logStreamName,
      startTime: startTime?.getTime(),
      endTime: endTime?.getTime(),
      startFromHead,
      limit,
    });

    const response = await this.logsClient.send(command);
    return (response.events ?? []).map(this.mapOutputLogEvent);
  }

  /**
   * Start Log Insights query
   */
  async startLogInsightsQuery(options: StartLogInsightsQueryOptions): Promise<ObservabilityOperationResult<string>> {
    try {
      const command = new StartQueryCommand({
        logGroupNames: options.logGroupNames,
        queryString: options.queryString,
        startTime: Math.floor(options.startTime.getTime() / 1000),
        endTime: Math.floor(options.endTime.getTime() / 1000),
        limit: options.limit,
      });

      const response = await this.logsClient.send(command);

      if (!response.queryId) {
        return { success: false, error: 'Failed to start query' };
      }

      return { success: true, data: response.queryId, message: 'Query started' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get Log Insights query results
   */
  async getLogInsightsQueryResults(queryId: string): Promise<ObservabilityOperationResult<LogInsightsQueryResult>> {
    try {
      const command = new GetQueryResultsCommand({
        queryId,
      });

      const response = await this.logsClient.send(command);

      return {
        success: true,
        data: {
          queryId,
          status: (response.status ?? 'Unknown') as QueryStatus,
          statistics: response.statistics ? {
            recordsMatched: response.statistics.recordsMatched,
            recordsScanned: response.statistics.recordsScanned,
            bytesScanned: response.statistics.bytesScanned,
          } : undefined,
          results: (response.results ?? []).map(row =>
            row.map(field => ({ field: field.field, value: field.value }))
          ),
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Execute Log Insights query and wait for results
   */
  async executeLogInsightsQuery(
    options: StartLogInsightsQueryOptions,
    timeoutMs: number = 60000,
    pollIntervalMs: number = 1000
  ): Promise<ObservabilityOperationResult<LogInsightsQueryResult>> {
    const startResult = await this.startLogInsightsQuery(options);
    if (!startResult.success || !startResult.data) {
      return { success: false, error: startResult.error };
    }

    const queryId = startResult.data;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.getLogInsightsQueryResults(queryId);
      if (!result.success) {
        return result;
      }

      if (result.data?.status === 'Complete') {
        return result;
      }

      if (result.data?.status === 'Failed' || result.data?.status === 'Cancelled') {
        return { success: false, error: `Query ${result.data.status.toLowerCase()}` };
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    // Stop the query if timed out
    await this.logsClient.send(new StopQueryCommand({ queryId }));
    return { success: false, error: 'Query timed out' };
  }

  /**
   * List metric filters
   */
  async listMetricFilters(logGroupName?: string, filterNamePrefix?: string): Promise<MetricFilterInfo[]> {
    const command = new DescribeMetricFiltersCommand({
      logGroupName,
      filterNamePrefix,
    });

    const response = await this.logsClient.send(command);
    return (response.metricFilters ?? []).map(this.mapMetricFilter);
  }

  /**
   * Create metric filter
   */
  async createMetricFilter(options: CreateMetricFilterOptions): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new PutMetricFilterCommand({
        filterName: options.filterName,
        filterPattern: options.filterPattern,
        logGroupName: options.logGroupName,
        metricTransformations: options.metricTransformations.map(mt => ({
          metricName: mt.metricName,
          metricNamespace: mt.metricNamespace,
          metricValue: mt.metricValue,
          defaultValue: mt.defaultValue,
          dimensions: mt.dimensions,
          unit: mt.unit,
        })),
      });

      await this.logsClient.send(command);
      return { success: true, message: `Metric filter ${options.filterName} created` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete metric filter
   */
  async deleteMetricFilter(logGroupName: string, filterName: string): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new DeleteMetricFilterCommand({
        logGroupName,
        filterName,
      });

      await this.logsClient.send(command);
      return { success: true, message: `Metric filter ${filterName} deleted` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // X-Ray Operations
  // ===========================================================================

  /**
   * Get trace summaries
   */
  async getTraceSummaries(options: GetTraceSummariesOptions): Promise<TraceSummary[]> {
    const command = new GetTraceSummariesCommand({
      StartTime: options.startTime,
      EndTime: options.endTime,
      TimeRangeType: options.timeRangeType,
      Sampling: options.sampling,
      SamplingStrategy: options.samplingStrategy ? {
        Name: options.samplingStrategy.name,
        Value: options.samplingStrategy.value,
      } : undefined,
      FilterExpression: options.filterExpression,
    });

    const response = await this.xrayClient.send(command);
    return (response.TraceSummaries ?? []).map(this.mapTraceSummary);
  }

  /**
   * Get trace details
   */
  async getTraces(traceIds: string[]): Promise<ObservabilityOperationResult<TraceDetail[]>> {
    try {
      const command = new BatchGetTracesCommand({
        TraceIds: traceIds,
      });

      const response = await this.xrayClient.send(command);
      const traces = (response.Traces ?? []).map(trace => ({
        id: trace.Id,
        duration: trace.Duration,
        limitExceeded: trace.LimitExceeded,
        segments: (trace.Segments ?? []).map(s => ({
          id: s.Id,
          document: s.Document,
        })),
      }));

      return { success: true, data: traces };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get service map
   */
  async getServiceMap(startTime: Date, endTime: Date, groupName?: string): Promise<ObservabilityOperationResult<ServiceMap>> {
    try {
      const command = new GetServiceGraphCommand({
        StartTime: startTime,
        EndTime: endTime,
        GroupName: groupName,
      });

      const response = await this.xrayClient.send(command);

      return {
        success: true,
        data: {
          startTime: response.StartTime,
          endTime: response.EndTime,
          services: (response.Services ?? []).map(this.mapServiceMapNode),
          containsOldGroupVersions: response.ContainsOldGroupVersions,
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * List X-Ray groups
   */
  async listXRayGroups(): Promise<XRayGroupInfo[]> {
    const command = new GetGroupsCommand({});
    const response = await this.xrayClient.send(command);
    return (response.Groups ?? []).map(g => ({
      groupName: g.GroupName,
      groupARN: g.GroupARN,
      filterExpression: g.FilterExpression,
      insightsConfiguration: g.InsightsConfiguration ? {
        insightsEnabled: g.InsightsConfiguration.InsightsEnabled,
        notificationsEnabled: g.InsightsConfiguration.NotificationsEnabled,
      } : undefined,
    }));
  }

  /**
   * Create X-Ray group
   */
  async createXRayGroup(
    groupName: string,
    filterExpression?: string,
    insightsEnabled?: boolean
  ): Promise<ObservabilityOperationResult<XRayGroupInfo>> {
    try {
      const command = new CreateGroupCommand({
        GroupName: groupName,
        FilterExpression: filterExpression,
        InsightsConfiguration: insightsEnabled !== undefined ? {
          InsightsEnabled: insightsEnabled,
          NotificationsEnabled: false,
        } : undefined,
      });

      const response = await this.xrayClient.send(command);

      if (!response.Group) {
        return { success: false, error: 'Failed to create group' };
      }

      return {
        success: true,
        data: {
          groupName: response.Group.GroupName,
          groupARN: response.Group.GroupARN,
          filterExpression: response.Group.FilterExpression,
          insightsConfiguration: response.Group.InsightsConfiguration ? {
            insightsEnabled: response.Group.InsightsConfiguration.InsightsEnabled,
            notificationsEnabled: response.Group.InsightsConfiguration.NotificationsEnabled,
          } : undefined,
        },
        message: `Group ${groupName} created`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete X-Ray group
   */
  async deleteXRayGroup(groupName: string): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new DeleteGroupCommand({
        GroupName: groupName,
      });

      await this.xrayClient.send(command);
      return { success: true, message: `Group ${groupName} deleted` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get X-Ray insights
   */
  async getInsightSummaries(
    groupName: string,
    startTime: Date,
    endTime: Date,
    states?: ('ACTIVE' | 'CLOSED')[]
  ): Promise<InsightSummary[]> {
    const command = new GetInsightSummariesCommand({
      GroupName: groupName,
      StartTime: startTime,
      EndTime: endTime,
      States: states,
    });

    const response = await this.xrayClient.send(command);
    return (response.InsightSummaries ?? []).map(this.mapInsightSummary);
  }

  // ===========================================================================
  // CloudWatch Synthetics Operations
  // ===========================================================================

  /**
   * List canaries
   */
  async listCanaries(): Promise<CanaryInfo[]> {
    const command = new DescribeCanariesCommand({});
    const response = await this.syntheticsClient.send(command);
    return (response.Canaries ?? []).map(this.mapCanary);
  }

  /**
   * Get canary details
   */
  async getCanary(name: string): Promise<ObservabilityOperationResult<CanaryInfo>> {
    try {
      const command = new GetCanaryCommand({
        Name: name,
      });

      const response = await this.syntheticsClient.send(command);

      if (!response.Canary) {
        return { success: false, error: `Canary ${name} not found` };
      }

      return { success: true, data: this.mapCanary(response.Canary) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Create canary
   */
  async createCanary(options: CreateCanaryOptions): Promise<ObservabilityOperationResult<CanaryInfo>> {
    try {
      const command = new CreateCanaryCommand({
        Name: options.name,
        Code: {
          S3Bucket: options.code.s3Bucket,
          S3Key: options.code.s3Key,
          S3Version: options.code.s3Version,
          ZipFile: options.code.zipFile,
          Handler: options.code.handler,
        },
        ArtifactS3Location: options.artifactS3Location,
        ExecutionRoleArn: options.executionRoleArn,
        Schedule: {
          Expression: options.schedule.expression,
          DurationInSeconds: options.schedule.durationInSeconds,
        },
        RunConfig: options.runConfig ? {
          TimeoutInSeconds: options.runConfig.timeoutInSeconds,
          MemoryInMB: options.runConfig.memoryInMB,
          ActiveTracing: options.runConfig.activeTracing,
          EnvironmentVariables: options.runConfig.environmentVariables,
        } : undefined,
        SuccessRetentionPeriodInDays: options.successRetentionPeriodInDays,
        FailureRetentionPeriodInDays: options.failureRetentionPeriodInDays,
        RuntimeVersion: options.runtimeVersion,
        VpcConfig: options.vpcConfig ? {
          SubnetIds: options.vpcConfig.subnetIds,
          SecurityGroupIds: options.vpcConfig.securityGroupIds,
        } : undefined,
        Tags: options.tags,
      });

      const response = await this.syntheticsClient.send(command);

      if (!response.Canary) {
        return { success: false, error: 'Failed to create canary' };
      }

      return {
        success: true,
        data: this.mapCanary(response.Canary),
        message: `Canary ${options.name} created`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update canary
   */
  async updateCanary(options: UpdateCanaryOptions): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new UpdateCanaryCommand({
        Name: options.name,
        Code: options.code ? {
          S3Bucket: options.code.s3Bucket,
          S3Key: options.code.s3Key,
          S3Version: options.code.s3Version,
          ZipFile: options.code.zipFile,
          Handler: options.code.handler,
        } : undefined,
        ExecutionRoleArn: options.executionRoleArn,
        RuntimeVersion: options.runtimeVersion,
        Schedule: options.schedule ? {
          Expression: options.schedule.expression,
          DurationInSeconds: options.schedule.durationInSeconds,
        } : undefined,
        RunConfig: options.runConfig ? {
          TimeoutInSeconds: options.runConfig.timeoutInSeconds,
          MemoryInMB: options.runConfig.memoryInMB,
          ActiveTracing: options.runConfig.activeTracing,
          EnvironmentVariables: options.runConfig.environmentVariables,
        } : undefined,
        SuccessRetentionPeriodInDays: options.successRetentionPeriodInDays,
        FailureRetentionPeriodInDays: options.failureRetentionPeriodInDays,
        VpcConfig: options.vpcConfig ? {
          SubnetIds: options.vpcConfig.subnetIds,
          SecurityGroupIds: options.vpcConfig.securityGroupIds,
        } : undefined,
        ArtifactS3Location: options.artifactS3Location,
      });

      await this.syntheticsClient.send(command);
      return { success: true, message: `Canary ${options.name} updated` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete canary
   */
  async deleteCanary(name: string, deleteLambda?: boolean): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new DeleteCanaryCommand({
        Name: name,
        DeleteLambda: deleteLambda,
      });

      await this.syntheticsClient.send(command);
      return { success: true, message: `Canary ${name} deleted` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Start canary
   */
  async startCanary(name: string): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new StartCanaryCommand({
        Name: name,
      });

      await this.syntheticsClient.send(command);
      return { success: true, message: `Canary ${name} started` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Stop canary
   */
  async stopCanary(name: string): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new StopCanaryCommand({
        Name: name,
      });

      await this.syntheticsClient.send(command);
      return { success: true, message: `Canary ${name} stopped` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get canary runs
   */
  async getCanaryRuns(name: string, maxResults?: number): Promise<CanaryRunInfo[]> {
    const command = new GetCanaryRunsCommand({
      Name: name,
      MaxResults: maxResults,
    });

    const response = await this.syntheticsClient.send(command);
    return (response.CanaryRuns ?? []).map(this.mapCanaryRun);
  }

  /**
   * Get canaries last run status
   */
  async getCanariesLastRun(): Promise<{ canary: CanaryInfo; lastRun?: CanaryRunInfo }[]> {
    const command = new DescribeCanariesLastRunCommand({});
    const response = await this.syntheticsClient.send(command);

    return (response.CanariesLastRun ?? []).map(clr => ({
      canary: this.mapCanary(clr.CanaryName ? { Name: clr.CanaryName } as Canary : {} as Canary),
      lastRun: clr.LastRun ? this.mapCanaryRun(clr.LastRun) : undefined,
    }));
  }

  // ===========================================================================
  // Anomaly Detection Operations
  // ===========================================================================

  /**
   * Put anomaly detector
   */
  async putAnomalyDetector(options: PutAnomalyDetectorOptions): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new PutAnomalyDetectorCommand({
        SingleMetricAnomalyDetector: {
          Namespace: options.namespace,
          MetricName: options.metricName,
          Dimensions: options.dimensions?.map(d => ({ Name: d.name, Value: d.value })),
          Stat: options.stat,
        },
        Configuration: options.configuration ? {
          ExcludedTimeRanges: options.configuration.excludedTimeRanges?.map(tr => ({
            StartTime: tr.startTime,
            EndTime: tr.endTime,
          })),
          MetricTimezone: options.configuration.metricTimezone,
        } : undefined,
      });

      await this.cloudWatchClient.send(command);
      return { success: true, message: 'Anomaly detector created' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete anomaly detector
   */
  async deleteAnomalyDetector(
    namespace: string,
    metricName: string,
    stat: string,
    dimensions?: MetricDimension[]
  ): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new DeleteAnomalyDetectorCommand({
        SingleMetricAnomalyDetector: {
          Namespace: namespace,
          MetricName: metricName,
          Dimensions: dimensions?.map(d => ({ Name: d.name, Value: d.value })),
          Stat: stat,
        },
      });

      await this.cloudWatchClient.send(command);
      return { success: true, message: 'Anomaly detector deleted' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * List anomaly detectors
   */
  async listAnomalyDetectors(
    namespace?: string,
    metricName?: string,
    dimensions?: MetricDimension[]
  ): Promise<AnomalyDetectorInfo[]> {
    const command = new DescribeAnomalyDetectorsCommand({
      Namespace: namespace,
      MetricName: metricName,
      Dimensions: dimensions?.map(d => ({ Name: d.name, Value: d.value })),
    });

    const response = await this.cloudWatchClient.send(command);
    return (response.AnomalyDetectors ?? []).map(this.mapAnomalyDetector);
  }

  // ===========================================================================
  // Composite Alarms Operations
  // ===========================================================================

  /**
   * Create composite alarm
   */
  async createCompositeAlarm(options: CreateCompositeAlarmOptions): Promise<ObservabilityOperationResult<void>> {
    try {
      const command = new PutCompositeAlarmCommand({
        AlarmName: options.alarmName,
        AlarmDescription: options.alarmDescription,
        AlarmRule: options.alarmRule,
        ActionsEnabled: options.actionsEnabled ?? true,
        AlarmActions: options.alarmActions,
        OKActions: options.okActions,
        InsufficientDataActions: options.insufficientDataActions,
        ActionsSuppressor: options.actionsSuppressor,
        ActionsSuppressorExtensionPeriod: options.actionsSuppressorExtensionPeriod,
        ActionsSuppressorWaitPeriod: options.actionsSuppressorWaitPeriod,
        Tags: options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
      });

      await this.cloudWatchClient.send(command);
      return { success: true, message: `Composite alarm ${options.alarmName} created` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * List composite alarms
   */
  async listCompositeAlarms(alarmNamePrefix?: string): Promise<CompositeAlarmInfo[]> {
    const command = new DescribeAlarmsCommand({
      AlarmTypes: ['CompositeAlarm'],
      AlarmNamePrefix: alarmNamePrefix,
    });

    const response = await this.cloudWatchClient.send(command);
    return (response.CompositeAlarms ?? []).map(this.mapCompositeAlarm);
  }

  // ===========================================================================
  // Health Summary Operations
  // ===========================================================================

  /**
   * Get observability health summary
   */
  async getObservabilityHealthSummary(): Promise<ObservabilityOperationResult<ObservabilityHealthSummary>> {
    try {
      // Get alarm summary
      const [alarmsOk, alarmsInAlarm, alarmsInsufficient] = await Promise.all([
        this.listAlarms({ stateValue: 'OK', maxResults: 100 }),
        this.listAlarms({ stateValue: 'ALARM', maxResults: 100 }),
        this.listAlarms({ stateValue: 'INSUFFICIENT_DATA', maxResults: 100 }),
      ]);

      // Get log groups
      const logGroups = await this.listLogGroups({ maxResults: 100 });
      const totalStoredBytes = logGroups.reduce((sum, lg) => sum + (lg.storedBytes ?? 0), 0);

      // Get canary status
      const canaries = await this.listCanaries();
      const canariesLastRun = await this.getCanariesLastRun();
      const passingCanaries = canariesLastRun.filter(c => c.lastRun?.status?.state === 'PASSED').length;
      const failingCanaries = canariesLastRun.filter(c => c.lastRun?.status?.state === 'FAILED').length;

      // Get anomaly detectors
      const anomalyDetectors = await this.listAnomalyDetectors();

      // Get recent traces
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      let traceSummaries: TraceSummary[] = [];
      try {
        traceSummaries = await this.getTraceSummaries({
          startTime: oneHourAgo,
          endTime: now,
        });
      } catch {
        // X-Ray might not be enabled
      }

      const totalTraces = traceSummaries.length;
      const faultTraces = traceSummaries.filter(t => t.hasFault).length;
      const errorTraces = traceSummaries.filter(t => t.hasError).length;
      const avgLatency = totalTraces > 0
        ? traceSummaries.reduce((sum, t) => sum + (t.responseTime ?? 0), 0) / totalTraces
        : 0;

      return {
        success: true,
        data: {
          timestamp: now,
          alarms: {
            total: alarmsOk.length + alarmsInAlarm.length + alarmsInsufficient.length,
            inAlarm: alarmsInAlarm.length,
            ok: alarmsOk.length,
            insufficientData: alarmsInsufficient.length,
            topAlarms: alarmsInAlarm.slice(0, 5),
          },
          logs: {
            totalGroups: logGroups.length,
            totalStoredBytes,
            recentErrors: 0, // Would need Log Insights query
            topLogGroups: logGroups.sort((a, b) => (b.storedBytes ?? 0) - (a.storedBytes ?? 0)).slice(0, 5),
          },
          traces: {
            totalTraces,
            faultPercentage: totalTraces > 0 ? (faultTraces / totalTraces) * 100 : 0,
            errorPercentage: totalTraces > 0 ? (errorTraces / totalTraces) * 100 : 0,
            averageLatency: avgLatency,
          },
          synthetics: {
            totalCanaries: canaries.length,
            passing: passingCanaries,
            failing: failingCanaries,
            recentRuns: canariesLastRun.slice(0, 5).map(c => c.lastRun).filter((r): r is CanaryRunInfo => r !== undefined),
          },
          anomalies: {
            totalDetectors: anomalyDetectors.length,
            activeAnomalies: 0, // Would need to query anomaly bands
          },
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // Templates
  // ===========================================================================

  /**
   * Get alarm template by ID
   */
  getAlarmTemplate(templateId: string): AlarmTemplate | undefined {
    return ALARM_TEMPLATES.find(t => t.id === templateId);
  }

  /**
   * List available alarm templates
   */
  listAlarmTemplates(category?: AlarmTemplate['category']): AlarmTemplate[] {
    if (category) {
      return ALARM_TEMPLATES.filter(t => t.category === category);
    }
    return ALARM_TEMPLATES;
  }

  /**
   * Get dashboard template by ID
   */
  getDashboardTemplate(templateId: string): DashboardTemplate | undefined {
    return DASHBOARD_TEMPLATES.find(t => t.id === templateId);
  }

  /**
   * List available dashboard templates
   */
  listDashboardTemplates(category?: DashboardTemplate['category']): DashboardTemplate[] {
    if (category) {
      return DASHBOARD_TEMPLATES.filter(t => t.category === category);
    }
    return DASHBOARD_TEMPLATES;
  }

  /**
   * Get canary blueprint by ID
   */
  getCanaryBlueprint(blueprintId: string): CanaryBlueprint | undefined {
    return CANARY_BLUEPRINTS.find(b => b.id === blueprintId);
  }

  /**
   * List available canary blueprints
   */
  listCanaryBlueprints(): CanaryBlueprint[] {
    return CANARY_BLUEPRINTS;
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private mapAlarm = (alarm: MetricAlarm): AlarmInfo => ({
    alarmName: alarm.AlarmName ?? '',
    alarmArn: alarm.AlarmArn ?? '',
    alarmDescription: alarm.AlarmDescription,
    stateValue: (alarm.StateValue ?? 'INSUFFICIENT_DATA') as AlarmState,
    stateReason: alarm.StateReason,
    stateReasonData: alarm.StateReasonData,
    stateUpdatedTimestamp: alarm.StateUpdatedTimestamp,
    metricName: alarm.MetricName,
    namespace: alarm.Namespace,
    statistic: alarm.Statistic as AlarmInfo['statistic'],
    extendedStatistic: alarm.ExtendedStatistic,
    dimensions: (alarm.Dimensions ?? []).map(d => ({ name: d.Name ?? '', value: d.Value ?? '' })),
    period: alarm.Period,
    evaluationPeriods: alarm.EvaluationPeriods ?? 1,
    datapointsToAlarm: alarm.DatapointsToAlarm,
    threshold: alarm.Threshold,
    comparisonOperator: alarm.ComparisonOperator as AlarmInfo['comparisonOperator'],
    treatMissingData: alarm.TreatMissingData as AlarmInfo['treatMissingData'],
    actionsEnabled: alarm.ActionsEnabled ?? false,
    alarmActions: alarm.AlarmActions ?? [],
    okActions: alarm.OKActions ?? [],
    insufficientDataActions: alarm.InsufficientDataActions ?? [],
    unit: alarm.Unit as AlarmInfo['unit'],
    alarmConfigurationUpdatedTimestamp: alarm.AlarmConfigurationUpdatedTimestamp,
  });

  private mapAlarmHistoryItem = (item: CWAlarmHistoryItem): AlarmHistoryItem => ({
    alarmName: item.AlarmName ?? '',
    alarmType: item.AlarmType,
    timestamp: item.Timestamp,
    historyItemType: item.HistoryItemType as AlarmHistoryItem['historyItemType'],
    historySummary: item.HistorySummary,
    historyData: item.HistoryData,
  });

  private mapDatapoint = (dp: Datapoint): MetricDataPoint => ({
    timestamp: dp.Timestamp,
    sampleCount: dp.SampleCount,
    average: dp.Average,
    sum: dp.Sum,
    minimum: dp.Minimum,
    maximum: dp.Maximum,
    unit: dp.Unit as MetricDataPoint['unit'],
    extendedStatistics: dp.ExtendedStatistics,
  });

  private mapMetricDataResult = (result: CWMetricDataResult): MetricDataResult => ({
    id: result.Id ?? '',
    label: result.Label,
    timestamps: result.Timestamps ?? [],
    values: result.Values ?? [],
    statusCode: result.StatusCode as MetricDataResult['statusCode'],
    messages: result.Messages?.map(m => ({ code: m.Code, value: m.Value })),
  });

  private mapMetric = (metric: Metric): MetricInfo => ({
    namespace: metric.Namespace ?? '',
    metricName: metric.MetricName ?? '',
    dimensions: (metric.Dimensions ?? []).map(d => ({ name: d.Name ?? '', value: d.Value ?? '' })),
  });

  private mapDashboardEntry = (entry: DashboardEntry): DashboardInfo => ({
    dashboardName: entry.DashboardName ?? '',
    dashboardArn: entry.DashboardArn,
    lastModified: entry.LastModified,
    size: entry.Size,
  });

  private mapLogGroup = (lg: LogGroup): LogGroupInfo => ({
    logGroupName: lg.logGroupName ?? '',
    logGroupArn: lg.arn,
    creationTime: lg.creationTime ? new Date(lg.creationTime) : undefined,
    retentionInDays: lg.retentionInDays,
    metricFilterCount: lg.metricFilterCount,
    storedBytes: lg.storedBytes,
    kmsKeyId: lg.kmsKeyId,
    dataProtectionStatus: lg.dataProtectionStatus as LogGroupInfo['dataProtectionStatus'],
  });

  private mapLogStream = (ls: LogStream): LogStreamInfo => ({
    logStreamName: ls.logStreamName ?? '',
    creationTime: ls.creationTime ? new Date(ls.creationTime) : undefined,
    firstEventTimestamp: ls.firstEventTimestamp ? new Date(ls.firstEventTimestamp) : undefined,
    lastEventTimestamp: ls.lastEventTimestamp ? new Date(ls.lastEventTimestamp) : undefined,
    lastIngestionTime: ls.lastIngestionTime ? new Date(ls.lastIngestionTime) : undefined,
    uploadSequenceToken: ls.uploadSequenceToken,
    arn: ls.arn,
    storedBytes: ls.storedBytes,
  });

  private mapFilteredLogEvent = (event: FilteredLogEvent): LogEvent => ({
    timestamp: event.timestamp ? new Date(event.timestamp) : undefined,
    message: event.message ?? '',
    ingestionTime: event.ingestionTime ? new Date(event.ingestionTime) : undefined,
    logStreamName: event.logStreamName,
    eventId: event.eventId,
  });

  private mapOutputLogEvent = (event: OutputLogEvent): LogEvent => ({
    timestamp: event.timestamp ? new Date(event.timestamp) : undefined,
    message: event.message ?? '',
    ingestionTime: event.ingestionTime ? new Date(event.ingestionTime) : undefined,
  });

  private mapMetricFilter = (mf: MetricFilter): MetricFilterInfo => ({
    filterName: mf.filterName ?? '',
    filterPattern: mf.filterPattern ?? '',
    metricTransformations: (mf.metricTransformations ?? []).map(mt => ({
      metricName: mt.metricName ?? '',
      metricNamespace: mt.metricNamespace ?? '',
      metricValue: mt.metricValue ?? '',
      defaultValue: mt.defaultValue,
      dimensions: mt.dimensions,
      unit: mt.unit as MetricFilterInfo['metricTransformations'][0]['unit'],
    })),
    creationTime: mf.creationTime ? new Date(mf.creationTime) : undefined,
    logGroupName: mf.logGroupName,
  });

  private mapTraceSummary = (ts: XRayTraceSummary): TraceSummary => ({
    id: ts.Id,
    duration: ts.Duration,
    responseTime: ts.ResponseTime,
    hasFault: ts.HasFault,
    hasError: ts.HasError,
    hasThrottle: ts.HasThrottle,
    isPartial: ts.IsPartial,
    http: ts.Http ? {
      httpURL: ts.Http.HttpURL,
      httpStatus: ts.Http.HttpStatus,
      httpMethod: ts.Http.HttpMethod,
      userAgent: ts.Http.UserAgent,
      clientIp: ts.Http.ClientIp,
    } : undefined,
    serviceIds: ts.ServiceIds?.map(s => ({
      name: s.Name,
      names: s.Names,
      accountId: s.AccountId,
      type: s.Type,
    })),
    resourceARNs: ts.ResourceARNs?.map(r => ({ arn: r.ARN })),
    matchedEventTime: ts.MatchedEventTime,
    availabilityZones: ts.AvailabilityZones?.map(az => ({ name: az.Name })),
    entryPoint: ts.EntryPoint ? {
      name: ts.EntryPoint.Name,
      names: ts.EntryPoint.Names,
      accountId: ts.EntryPoint.AccountId,
      type: ts.EntryPoint.Type,
    } : undefined,
  });

  private mapServiceMapNode = (service: Service): ServiceMapNode => ({
    referenceId: service.ReferenceId,
    name: service.Name,
    names: service.Names,
    root: service.Root,
    accountId: service.AccountId,
    type: service.Type,
    state: service.State,
    startTime: service.StartTime,
    endTime: service.EndTime,
    edges: service.Edges?.map(e => ({
      referenceId: e.ReferenceId,
      startTime: e.StartTime,
      endTime: e.EndTime,
      summaryStatistics: e.SummaryStatistics ? {
        okCount: e.SummaryStatistics.OkCount,
        errorStatistics: e.SummaryStatistics.ErrorStatistics ? {
          throttleCount: e.SummaryStatistics.ErrorStatistics.ThrottleCount,
          otherCount: e.SummaryStatistics.ErrorStatistics.OtherCount,
          totalCount: e.SummaryStatistics.ErrorStatistics.TotalCount,
        } : undefined,
        faultStatistics: e.SummaryStatistics.FaultStatistics ? {
          otherCount: e.SummaryStatistics.FaultStatistics.OtherCount,
          totalCount: e.SummaryStatistics.FaultStatistics.TotalCount,
        } : undefined,
        totalCount: e.SummaryStatistics.TotalCount,
        totalResponseTime: e.SummaryStatistics.TotalResponseTime,
      } : undefined,
      responseTimeHistogram: e.ResponseTimeHistogram?.map(h => ({ value: h.Value, count: h.Count })),
      aliases: e.Aliases?.map(a => ({ name: a.Name, names: a.Names, type: a.Type })),
    })),
    summaryStatistics: service.SummaryStatistics ? {
      okCount: service.SummaryStatistics.OkCount,
      errorStatistics: service.SummaryStatistics.ErrorStatistics ? {
        throttleCount: service.SummaryStatistics.ErrorStatistics.ThrottleCount,
        otherCount: service.SummaryStatistics.ErrorStatistics.OtherCount,
        totalCount: service.SummaryStatistics.ErrorStatistics.TotalCount,
      } : undefined,
      faultStatistics: service.SummaryStatistics.FaultStatistics ? {
        otherCount: service.SummaryStatistics.FaultStatistics.OtherCount,
        totalCount: service.SummaryStatistics.FaultStatistics.TotalCount,
      } : undefined,
      totalCount: service.SummaryStatistics.TotalCount,
      totalResponseTime: service.SummaryStatistics.TotalResponseTime,
    } : undefined,
    durationHistogram: service.DurationHistogram?.map(h => ({ value: h.Value, count: h.Count })),
    responseTimeHistogram: service.ResponseTimeHistogram?.map(h => ({ value: h.Value, count: h.Count })),
  });

  private mapInsightSummary = (insight: XRayInsightSummary): InsightSummary => ({
    insightId: insight.InsightId,
    groupARN: insight.GroupARN,
    groupName: insight.GroupName,
    rootCauseServiceId: insight.RootCauseServiceId ? {
      name: insight.RootCauseServiceId.Name,
      names: insight.RootCauseServiceId.Names,
      accountId: insight.RootCauseServiceId.AccountId,
      type: insight.RootCauseServiceId.Type,
    } : undefined,
    categories: insight.Categories as InsightSummary['categories'],
    state: insight.State as InsightSummary['state'],
    startTime: insight.StartTime,
    endTime: insight.EndTime,
    summary: insight.Summary,
    clientRequestImpactStatistics: insight.ClientRequestImpactStatistics ? {
      faultCount: insight.ClientRequestImpactStatistics.FaultCount,
      okCount: insight.ClientRequestImpactStatistics.OkCount,
      totalCount: insight.ClientRequestImpactStatistics.TotalCount,
    } : undefined,
    rootCauseServiceRequestImpactStatistics: insight.RootCauseServiceRequestImpactStatistics ? {
      faultCount: insight.RootCauseServiceRequestImpactStatistics.FaultCount,
      okCount: insight.RootCauseServiceRequestImpactStatistics.OkCount,
      totalCount: insight.RootCauseServiceRequestImpactStatistics.TotalCount,
    } : undefined,
    topAnomalousServices: insight.TopAnomalousServices?.map(s => ({
      serviceId: s.ServiceId ? {
        name: s.ServiceId.Name,
        names: s.ServiceId.Names,
        accountId: s.ServiceId.AccountId,
        type: s.ServiceId.Type,
      } : undefined,
    })),
    lastUpdateTime: insight.LastUpdateTime,
  });

  private mapCanary = (canary: Canary): CanaryInfo => ({
    id: canary.Id,
    name: canary.Name ?? '',
    status: canary.Status ? {
      state: canary.Status.State as CanaryInfo['status'] extends { state?: infer S } ? S : undefined,
      stateReason: canary.Status.StateReason,
      stateReasonCode: canary.Status.StateReasonCode as CanaryInfo['status'] extends { stateReasonCode?: infer T } ? T : undefined,
    } : undefined,
    schedule: canary.Schedule ? {
      expression: canary.Schedule.Expression,
      durationInSeconds: canary.Schedule.DurationInSeconds,
    } : undefined,
    runConfig: canary.RunConfig ? {
      timeoutInSeconds: canary.RunConfig.TimeoutInSeconds,
      memoryInMB: canary.RunConfig.MemoryInMB,
      activeTracing: canary.RunConfig.ActiveTracing,
    } : undefined,
    successRetentionPeriodInDays: canary.SuccessRetentionPeriodInDays,
    failureRetentionPeriodInDays: canary.FailureRetentionPeriodInDays,
    code: canary.Code ? {
      sourceLocationArn: canary.Code.SourceLocationArn,
      handler: canary.Code.Handler,
    } : undefined,
    executionRoleArn: canary.ExecutionRoleArn,
    runtimeVersion: canary.RuntimeVersion,
    vpcConfig: canary.VpcConfig ? {
      vpcId: canary.VpcConfig.VpcId,
      subnetIds: canary.VpcConfig.SubnetIds,
      securityGroupIds: canary.VpcConfig.SecurityGroupIds,
    } : undefined,
    artifactS3Location: canary.ArtifactS3Location,
    engineArn: canary.EngineArn,
    tags: canary.Tags,
  });

  private mapCanaryRun = (run: CanaryRun): CanaryRunInfo => ({
    id: run.Id,
    name: run.Name,
    status: run.Status ? {
      state: run.Status.State as CanaryRunInfo['status'] extends { state?: infer S } ? S : undefined,
      stateReason: run.Status.StateReason,
      stateReasonCode: run.Status.StateReasonCode as CanaryRunInfo['status'] extends { stateReasonCode?: infer T } ? T : undefined,
    } : undefined,
    timeline: run.Timeline ? {
      started: run.Timeline.Started,
      completed: run.Timeline.Completed,
    } : undefined,
    artifactS3Location: run.ArtifactS3Location,
  });

  private mapAnomalyDetector = (ad: AnomalyDetector): AnomalyDetectorInfo => ({
    namespace: ad.SingleMetricAnomalyDetector?.Namespace,
    metricName: ad.SingleMetricAnomalyDetector?.MetricName,
    dimensions: (ad.SingleMetricAnomalyDetector?.Dimensions ?? []).map(d => ({
      name: d.Name ?? '',
      value: d.Value ?? '',
    })),
    stat: ad.SingleMetricAnomalyDetector?.Stat,
    configuration: ad.Configuration ? {
      excludedTimeRanges: ad.Configuration.ExcludedTimeRanges?.map(tr => ({
        startTime: tr.StartTime ?? new Date(),
        endTime: tr.EndTime ?? new Date(),
      })),
      metricTimezone: ad.Configuration.MetricTimezone,
    } : undefined,
    stateValue: ad.StateValue as AnomalyDetectorInfo['stateValue'],
    singleMetricAnomalyDetector: ad.SingleMetricAnomalyDetector ? {
      namespace: ad.SingleMetricAnomalyDetector.Namespace,
      metricName: ad.SingleMetricAnomalyDetector.MetricName,
      dimensions: ad.SingleMetricAnomalyDetector.Dimensions?.map(d => ({
        name: d.Name ?? '',
        value: d.Value ?? '',
      })),
      stat: ad.SingleMetricAnomalyDetector.Stat,
    } : undefined,
  });

  private mapCompositeAlarm = (alarm: CompositeAlarm): CompositeAlarmInfo => ({
    alarmName: alarm.AlarmName ?? '',
    alarmArn: alarm.AlarmArn,
    alarmDescription: alarm.AlarmDescription,
    alarmRule: alarm.AlarmRule ?? '',
    stateValue: (alarm.StateValue ?? 'INSUFFICIENT_DATA') as AlarmState,
    stateReason: alarm.StateReason,
    stateReasonData: alarm.StateReasonData,
    stateUpdatedTimestamp: alarm.StateUpdatedTimestamp,
    stateTransitionedTimestamp: alarm.StateTransitionedTimestamp,
    actionsEnabled: alarm.ActionsEnabled ?? false,
    alarmActions: alarm.AlarmActions ?? [],
    okActions: alarm.OKActions ?? [],
    insufficientDataActions: alarm.InsufficientDataActions ?? [],
    alarmConfigurationUpdatedTimestamp: alarm.AlarmConfigurationUpdatedTimestamp,
    actionsSuppressedBy: alarm.ActionsSuppressedBy as CompositeAlarmInfo['actionsSuppressedBy'],
    actionsSuppressedReason: alarm.ActionsSuppressedReason,
    actionsSuppressor: alarm.ActionsSuppressor,
    actionsSuppressorExtensionPeriod: alarm.ActionsSuppressorExtensionPeriod,
    actionsSuppressorWaitPeriod: alarm.ActionsSuppressorWaitPeriod,
  });
}

// ===========================================================================
// Predefined Templates
// ===========================================================================

const ALARM_TEMPLATES: AlarmTemplate[] = [
  // EC2 Templates
  {
    id: 'ec2-cpu-high',
    name: 'EC2 High CPU',
    description: 'Alarm when EC2 CPU exceeds threshold',
    category: 'ec2',
    metricName: 'CPUUtilization',
    namespace: 'AWS/EC2',
    statistic: 'Average',
    period: 300,
    evaluationPeriods: 3,
    threshold: 80,
    comparisonOperator: 'GreaterThanThreshold',
    requiredDimensions: ['InstanceId'],
    treatMissingData: 'missing',
  },
  {
    id: 'ec2-status-check-failed',
    name: 'EC2 Status Check Failed',
    description: 'Alarm when EC2 status check fails',
    category: 'ec2',
    metricName: 'StatusCheckFailed',
    namespace: 'AWS/EC2',
    statistic: 'Maximum',
    period: 60,
    evaluationPeriods: 2,
    threshold: 1,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    requiredDimensions: ['InstanceId'],
    treatMissingData: 'breaching',
  },
  // RDS Templates
  {
    id: 'rds-cpu-high',
    name: 'RDS High CPU',
    description: 'Alarm when RDS CPU exceeds threshold',
    category: 'rds',
    metricName: 'CPUUtilization',
    namespace: 'AWS/RDS',
    statistic: 'Average',
    period: 300,
    evaluationPeriods: 3,
    threshold: 80,
    comparisonOperator: 'GreaterThanThreshold',
    requiredDimensions: ['DBInstanceIdentifier'],
    treatMissingData: 'missing',
  },
  {
    id: 'rds-connections-high',
    name: 'RDS High Connections',
    description: 'Alarm when RDS connections are high',
    category: 'rds',
    metricName: 'DatabaseConnections',
    namespace: 'AWS/RDS',
    statistic: 'Average',
    period: 300,
    evaluationPeriods: 2,
    threshold: 100,
    comparisonOperator: 'GreaterThanThreshold',
    requiredDimensions: ['DBInstanceIdentifier'],
    treatMissingData: 'missing',
  },
  {
    id: 'rds-freeable-memory-low',
    name: 'RDS Low Freeable Memory',
    description: 'Alarm when RDS freeable memory is low',
    category: 'rds',
    metricName: 'FreeableMemory',
    namespace: 'AWS/RDS',
    statistic: 'Average',
    period: 300,
    evaluationPeriods: 3,
    threshold: 1073741824, // 1GB
    comparisonOperator: 'LessThanThreshold',
    requiredDimensions: ['DBInstanceIdentifier'],
    treatMissingData: 'missing',
  },
  // Lambda Templates
  {
    id: 'lambda-errors',
    name: 'Lambda Errors',
    description: 'Alarm when Lambda function has errors',
    category: 'lambda',
    metricName: 'Errors',
    namespace: 'AWS/Lambda',
    statistic: 'Sum',
    period: 60,
    evaluationPeriods: 1,
    threshold: 1,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    requiredDimensions: ['FunctionName'],
    treatMissingData: 'notBreaching',
  },
  {
    id: 'lambda-duration-high',
    name: 'Lambda High Duration',
    description: 'Alarm when Lambda duration is high',
    category: 'lambda',
    metricName: 'Duration',
    namespace: 'AWS/Lambda',
    statistic: 'Average',
    period: 300,
    evaluationPeriods: 3,
    threshold: 5000, // 5 seconds
    comparisonOperator: 'GreaterThanThreshold',
    requiredDimensions: ['FunctionName'],
    treatMissingData: 'missing',
  },
  {
    id: 'lambda-throttles',
    name: 'Lambda Throttles',
    description: 'Alarm when Lambda is throttled',
    category: 'lambda',
    metricName: 'Throttles',
    namespace: 'AWS/Lambda',
    statistic: 'Sum',
    period: 60,
    evaluationPeriods: 1,
    threshold: 1,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    requiredDimensions: ['FunctionName'],
    treatMissingData: 'notBreaching',
  },
  // ECS Templates
  {
    id: 'ecs-cpu-high',
    name: 'ECS High CPU',
    description: 'Alarm when ECS service CPU is high',
    category: 'ecs',
    metricName: 'CPUUtilization',
    namespace: 'AWS/ECS',
    statistic: 'Average',
    period: 300,
    evaluationPeriods: 3,
    threshold: 80,
    comparisonOperator: 'GreaterThanThreshold',
    requiredDimensions: ['ClusterName', 'ServiceName'],
    treatMissingData: 'missing',
  },
  {
    id: 'ecs-memory-high',
    name: 'ECS High Memory',
    description: 'Alarm when ECS service memory is high',
    category: 'ecs',
    metricName: 'MemoryUtilization',
    namespace: 'AWS/ECS',
    statistic: 'Average',
    period: 300,
    evaluationPeriods: 3,
    threshold: 80,
    comparisonOperator: 'GreaterThanThreshold',
    requiredDimensions: ['ClusterName', 'ServiceName'],
    treatMissingData: 'missing',
  },
  // ELB Templates
  {
    id: 'elb-5xx-errors',
    name: 'ELB 5XX Errors',
    description: 'Alarm when ELB has 5XX errors',
    category: 'elb',
    metricName: 'HTTPCode_ELB_5XX_Count',
    namespace: 'AWS/ApplicationELB',
    statistic: 'Sum',
    period: 60,
    evaluationPeriods: 3,
    threshold: 10,
    comparisonOperator: 'GreaterThanThreshold',
    requiredDimensions: ['LoadBalancer'],
    treatMissingData: 'notBreaching',
  },
  {
    id: 'elb-latency-high',
    name: 'ELB High Latency',
    description: 'Alarm when ELB latency is high',
    category: 'elb',
    metricName: 'TargetResponseTime',
    namespace: 'AWS/ApplicationELB',
    statistic: 'Average',
    period: 60,
    evaluationPeriods: 3,
    threshold: 1, // 1 second
    comparisonOperator: 'GreaterThanThreshold',
    requiredDimensions: ['LoadBalancer'],
    treatMissingData: 'missing',
  },
  // API Gateway Templates
  {
    id: 'apigateway-5xx-errors',
    name: 'API Gateway 5XX Errors',
    description: 'Alarm when API Gateway has 5XX errors',
    category: 'apigateway',
    metricName: '5XXError',
    namespace: 'AWS/ApiGateway',
    statistic: 'Sum',
    period: 60,
    evaluationPeriods: 3,
    threshold: 10,
    comparisonOperator: 'GreaterThanThreshold',
    requiredDimensions: ['ApiName'],
    treatMissingData: 'notBreaching',
  },
  {
    id: 'apigateway-latency-high',
    name: 'API Gateway High Latency',
    description: 'Alarm when API Gateway latency is high',
    category: 'apigateway',
    metricName: 'Latency',
    namespace: 'AWS/ApiGateway',
    statistic: 'Average',
    period: 60,
    evaluationPeriods: 3,
    threshold: 1000, // 1 second
    comparisonOperator: 'GreaterThanThreshold',
    requiredDimensions: ['ApiName'],
    treatMissingData: 'missing',
  },
  // DynamoDB Templates
  {
    id: 'dynamodb-throttled-requests',
    name: 'DynamoDB Throttled Requests',
    description: 'Alarm when DynamoDB has throttled requests',
    category: 'dynamodb',
    metricName: 'ThrottledRequests',
    namespace: 'AWS/DynamoDB',
    statistic: 'Sum',
    period: 60,
    evaluationPeriods: 1,
    threshold: 1,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    requiredDimensions: ['TableName'],
    treatMissingData: 'notBreaching',
  },
  // SQS Templates
  {
    id: 'sqs-messages-visible',
    name: 'SQS Messages Visible',
    description: 'Alarm when SQS has many visible messages',
    category: 'sqs',
    metricName: 'ApproximateNumberOfMessagesVisible',
    namespace: 'AWS/SQS',
    statistic: 'Average',
    period: 300,
    evaluationPeriods: 3,
    threshold: 1000,
    comparisonOperator: 'GreaterThanThreshold',
    requiredDimensions: ['QueueName'],
    treatMissingData: 'missing',
  },
  {
    id: 'sqs-age-oldest-message',
    name: 'SQS Oldest Message Age',
    description: 'Alarm when SQS messages are too old',
    category: 'sqs',
    metricName: 'ApproximateAgeOfOldestMessage',
    namespace: 'AWS/SQS',
    statistic: 'Maximum',
    period: 300,
    evaluationPeriods: 3,
    threshold: 3600, // 1 hour
    comparisonOperator: 'GreaterThanThreshold',
    requiredDimensions: ['QueueName'],
    treatMissingData: 'missing',
  },
];

const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: 'ec2-overview',
    name: 'EC2 Instance Overview',
    description: 'Dashboard for monitoring EC2 instance metrics',
    category: 'ec2',
    requiredDimensions: ['InstanceId'],
    widgets: [
      {
        type: 'metric',
        x: 0,
        y: 0,
        width: 12,
        height: 6,
        properties: {
          title: 'CPU Utilization',
          metrics: [['AWS/EC2', 'CPUUtilization', 'InstanceId', '{{InstanceId}}']],
          period: 300,
          stat: 'Average',
          region: 'us-east-1',
        },
      },
      {
        type: 'metric',
        x: 12,
        y: 0,
        width: 12,
        height: 6,
        properties: {
          title: 'Network In/Out',
          metrics: [
            ['AWS/EC2', 'NetworkIn', 'InstanceId', '{{InstanceId}}'],
            ['AWS/EC2', 'NetworkOut', 'InstanceId', '{{InstanceId}}'],
          ],
          period: 300,
          stat: 'Sum',
          region: 'us-east-1',
        },
      },
      {
        type: 'metric',
        x: 0,
        y: 6,
        width: 12,
        height: 6,
        properties: {
          title: 'Disk Read/Write',
          metrics: [
            ['AWS/EC2', 'DiskReadBytes', 'InstanceId', '{{InstanceId}}'],
            ['AWS/EC2', 'DiskWriteBytes', 'InstanceId', '{{InstanceId}}'],
          ],
          period: 300,
          stat: 'Sum',
          region: 'us-east-1',
        },
      },
      {
        type: 'metric',
        x: 12,
        y: 6,
        width: 12,
        height: 6,
        properties: {
          title: 'Status Checks',
          metrics: [
            ['AWS/EC2', 'StatusCheckFailed_Instance', 'InstanceId', '{{InstanceId}}'],
            ['AWS/EC2', 'StatusCheckFailed_System', 'InstanceId', '{{InstanceId}}'],
          ],
          period: 60,
          stat: 'Maximum',
          region: 'us-east-1',
        },
      },
    ],
  },
  {
    id: 'lambda-overview',
    name: 'Lambda Function Overview',
    description: 'Dashboard for monitoring Lambda function metrics',
    category: 'lambda',
    requiredDimensions: ['FunctionName'],
    widgets: [
      {
        type: 'metric',
        x: 0,
        y: 0,
        width: 8,
        height: 6,
        properties: {
          title: 'Invocations',
          metrics: [['AWS/Lambda', 'Invocations', 'FunctionName', '{{FunctionName}}']],
          period: 60,
          stat: 'Sum',
          region: 'us-east-1',
        },
      },
      {
        type: 'metric',
        x: 8,
        y: 0,
        width: 8,
        height: 6,
        properties: {
          title: 'Errors',
          metrics: [['AWS/Lambda', 'Errors', 'FunctionName', '{{FunctionName}}']],
          period: 60,
          stat: 'Sum',
          region: 'us-east-1',
        },
      },
      {
        type: 'metric',
        x: 16,
        y: 0,
        width: 8,
        height: 6,
        properties: {
          title: 'Duration',
          metrics: [['AWS/Lambda', 'Duration', 'FunctionName', '{{FunctionName}}']],
          period: 60,
          stat: 'Average',
          region: 'us-east-1',
        },
      },
      {
        type: 'metric',
        x: 0,
        y: 6,
        width: 12,
        height: 6,
        properties: {
          title: 'Concurrent Executions',
          metrics: [['AWS/Lambda', 'ConcurrentExecutions', 'FunctionName', '{{FunctionName}}']],
          period: 60,
          stat: 'Maximum',
          region: 'us-east-1',
        },
      },
      {
        type: 'metric',
        x: 12,
        y: 6,
        width: 12,
        height: 6,
        properties: {
          title: 'Throttles',
          metrics: [['AWS/Lambda', 'Throttles', 'FunctionName', '{{FunctionName}}']],
          period: 60,
          stat: 'Sum',
          region: 'us-east-1',
        },
      },
    ],
  },
  {
    id: 'rds-overview',
    name: 'RDS Instance Overview',
    description: 'Dashboard for monitoring RDS instance metrics',
    category: 'rds',
    requiredDimensions: ['DBInstanceIdentifier'],
    widgets: [
      {
        type: 'metric',
        x: 0,
        y: 0,
        width: 12,
        height: 6,
        properties: {
          title: 'CPU Utilization',
          metrics: [['AWS/RDS', 'CPUUtilization', 'DBInstanceIdentifier', '{{DBInstanceIdentifier}}']],
          period: 300,
          stat: 'Average',
          region: 'us-east-1',
        },
      },
      {
        type: 'metric',
        x: 12,
        y: 0,
        width: 12,
        height: 6,
        properties: {
          title: 'Database Connections',
          metrics: [['AWS/RDS', 'DatabaseConnections', 'DBInstanceIdentifier', '{{DBInstanceIdentifier}}']],
          period: 300,
          stat: 'Average',
          region: 'us-east-1',
        },
      },
      {
        type: 'metric',
        x: 0,
        y: 6,
        width: 8,
        height: 6,
        properties: {
          title: 'Freeable Memory',
          metrics: [['AWS/RDS', 'FreeableMemory', 'DBInstanceIdentifier', '{{DBInstanceIdentifier}}']],
          period: 300,
          stat: 'Average',
          region: 'us-east-1',
        },
      },
      {
        type: 'metric',
        x: 8,
        y: 6,
        width: 8,
        height: 6,
        properties: {
          title: 'Free Storage Space',
          metrics: [['AWS/RDS', 'FreeStorageSpace', 'DBInstanceIdentifier', '{{DBInstanceIdentifier}}']],
          period: 300,
          stat: 'Average',
          region: 'us-east-1',
        },
      },
      {
        type: 'metric',
        x: 16,
        y: 6,
        width: 8,
        height: 6,
        properties: {
          title: 'Read/Write IOPS',
          metrics: [
            ['AWS/RDS', 'ReadIOPS', 'DBInstanceIdentifier', '{{DBInstanceIdentifier}}'],
            ['AWS/RDS', 'WriteIOPS', 'DBInstanceIdentifier', '{{DBInstanceIdentifier}}'],
          ],
          period: 300,
          stat: 'Average',
          region: 'us-east-1',
        },
      },
    ],
  },
];

const CANARY_BLUEPRINTS: CanaryBlueprint[] = [
  {
    id: 'heartbeat',
    name: 'Heartbeat Monitor',
    description: 'Simple heartbeat monitoring for URL availability',
    type: 'heartbeat',
    runtime: 'syn-nodejs-puppeteer-6.2',
    requiredParameters: ['url'],
    codeTemplate: `
const { URL } = require('url');
const synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const heartbeatBlueprint = async function () {
  const url = '{{url}}';
  
  const page = await synthetics.getPage();
  const response = await page.goto(url, { waitUntil: ['domcontentloaded'], timeout: 30000 });
  
  if (!response || response.status() !== 200) {
    throw new Error(\`Failed to load \${url} with status \${response ? response.status() : 'unknown'}\`);
  }
  
  log.info(\`Successfully loaded \${url}\`);
};

exports.handler = async () => {
  return await heartbeatBlueprint();
};
`,
  },
  {
    id: 'api-canary',
    name: 'API Canary',
    description: 'Monitor API endpoints for availability and response',
    type: 'api',
    runtime: 'syn-nodejs-puppeteer-6.2',
    requiredParameters: ['apiEndpoint', 'expectedStatusCode'],
    codeTemplate: `
const synthetics = require('Synthetics');
const log = require('SyntheticsLogger');
const https = require('https');
const http = require('http');

const apiCanary = async function () {
  const apiEndpoint = '{{apiEndpoint}}';
  const expectedStatusCode = {{expectedStatusCode}};
  
  return new Promise((resolve, reject) => {
    const protocol = apiEndpoint.startsWith('https') ? https : http;
    
    const req = protocol.get(apiEndpoint, (res) => {
      if (res.statusCode === expectedStatusCode) {
        log.info(\`API returned expected status code: \${res.statusCode}\`);
        resolve();
      } else {
        reject(new Error(\`Expected status \${expectedStatusCode}, got \${res.statusCode}\`));
      }
    });
    
    req.on('error', (e) => {
      reject(new Error(\`Request failed: \${e.message}\`));
    });
    
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
};

exports.handler = async () => {
  return await apiCanary();
};
`,
  },
  {
    id: 'broken-link-checker',
    name: 'Broken Link Checker',
    description: 'Check for broken links on a webpage',
    type: 'broken-link',
    runtime: 'syn-nodejs-puppeteer-6.2',
    requiredParameters: ['url'],
    codeTemplate: `
const synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const brokenLinkChecker = async function () {
  const url = '{{url}}';
  
  const page = await synthetics.getPage();
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  
  const links = await page.$$eval('a[href]', anchors => 
    anchors.map(anchor => anchor.href).filter(href => href.startsWith('http'))
  );
  
  log.info(\`Found \${links.length} links to check\`);
  
  const brokenLinks = [];
  for (const link of links.slice(0, 20)) { // Check first 20 links
    try {
      const response = await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 10000 });
      if (!response || response.status() >= 400) {
        brokenLinks.push({ url: link, status: response ? response.status() : 'unknown' });
      }
    } catch (e) {
      brokenLinks.push({ url: link, error: e.message });
    }
  }
  
  if (brokenLinks.length > 0) {
    log.error('Broken links found:', JSON.stringify(brokenLinks));
    throw new Error(\`Found \${brokenLinks.length} broken links\`);
  }
  
  log.info('All links are valid');
};

exports.handler = async () => {
  return await brokenLinkChecker();
};
`,
  },
];

/**
 * Create ObservabilityManager instance
 */
export function createObservabilityManager(config?: ObservabilityManagerConfig): ObservabilityManager {
  return new ObservabilityManager(config);
}
