/**
 * Comprehensive tests for AWS Observability Manager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObservabilityManager, createObservabilityManager } from './manager.js';

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: vi.fn(() => ({
    send: vi.fn(),
  })),
  PutMetricAlarmCommand: vi.fn(),
  DeleteAlarmsCommand: vi.fn(),
  DescribeAlarmsCommand: vi.fn(),
  DescribeAlarmHistoryCommand: vi.fn(),
  SetAlarmStateCommand: vi.fn(),
  EnableAlarmActionsCommand: vi.fn(),
  DisableAlarmActionsCommand: vi.fn(),
  GetMetricStatisticsCommand: vi.fn(),
  GetMetricDataCommand: vi.fn(),
  ListMetricsCommand: vi.fn(),
  PutMetricDataCommand: vi.fn(),
  PutDashboardCommand: vi.fn(),
  GetDashboardCommand: vi.fn(),
  DeleteDashboardsCommand: vi.fn(),
  ListDashboardsCommand: vi.fn(),
  PutAnomalyDetectorCommand: vi.fn(),
  DeleteAnomalyDetectorCommand: vi.fn(),
  DescribeAnomalyDetectorsCommand: vi.fn(),
  PutCompositeAlarmCommand: vi.fn(),
  DescribeAlarmsForMetricCommand: vi.fn(),
  TagResourceCommand: vi.fn(),
  UntagResourceCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: vi.fn(() => ({
    send: vi.fn(),
  })),
  DescribeLogGroupsCommand: vi.fn(),
  DescribeLogStreamsCommand: vi.fn(),
  CreateLogGroupCommand: vi.fn(),
  DeleteLogGroupCommand: vi.fn(),
  PutRetentionPolicyCommand: vi.fn(),
  FilterLogEventsCommand: vi.fn(),
  GetLogEventsCommand: vi.fn(),
  StartQueryCommand: vi.fn(),
  GetQueryResultsCommand: vi.fn(),
  StopQueryCommand: vi.fn(),
  DescribeQueriesCommand: vi.fn(),
  PutMetricFilterCommand: vi.fn(),
  DeleteMetricFilterCommand: vi.fn(),
  DescribeMetricFiltersCommand: vi.fn(),
  CreateLogStreamCommand: vi.fn(),
  PutLogEventsCommand: vi.fn(),
  TagLogGroupCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-xray', () => ({
  XRayClient: vi.fn(() => ({
    send: vi.fn(),
  })),
  GetTraceSummariesCommand: vi.fn(),
  BatchGetTracesCommand: vi.fn(),
  GetServiceGraphCommand: vi.fn(),
  GetGroupsCommand: vi.fn(),
  CreateGroupCommand: vi.fn(),
  DeleteGroupCommand: vi.fn(),
  UpdateGroupCommand: vi.fn(),
  GetInsightSummariesCommand: vi.fn(),
  GetInsightCommand: vi.fn(),
  GetTimeSeriesServiceStatisticsCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-synthetics', () => ({
  SyntheticsClient: vi.fn(() => ({
    send: vi.fn(),
  })),
  CreateCanaryCommand: vi.fn(),
  UpdateCanaryCommand: vi.fn(),
  DeleteCanaryCommand: vi.fn(),
  GetCanaryCommand: vi.fn(),
  GetCanaryRunsCommand: vi.fn(),
  DescribeCanariesCommand: vi.fn(),
  DescribeCanariesLastRunCommand: vi.fn(),
  StartCanaryCommand: vi.fn(),
  StopCanaryCommand: vi.fn(),
  DescribeRuntimeVersionsCommand: vi.fn(),
  TagResourceCommand: vi.fn(),
}));

// Get mock client instances
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { XRayClient } from '@aws-sdk/client-xray';
import { SyntheticsClient } from '@aws-sdk/client-synthetics';

describe('ObservabilityManager', () => {
  let manager: ObservabilityManager;
  let mockCloudWatchSend: ReturnType<typeof vi.fn>;
  let mockLogsSend: ReturnType<typeof vi.fn>;
  let mockXRaySend: ReturnType<typeof vi.fn>;
  let mockSyntheticsSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock send functions
    mockCloudWatchSend = vi.fn();
    mockLogsSend = vi.fn();
    mockXRaySend = vi.fn();
    mockSyntheticsSend = vi.fn();

    vi.mocked(CloudWatchClient).mockImplementation(() => ({
      send: mockCloudWatchSend,
    }) as unknown as CloudWatchClient);

    vi.mocked(CloudWatchLogsClient).mockImplementation(() => ({
      send: mockLogsSend,
    }) as unknown as CloudWatchLogsClient);

    vi.mocked(XRayClient).mockImplementation(() => ({
      send: mockXRaySend,
    }) as unknown as XRayClient);

    vi.mocked(SyntheticsClient).mockImplementation(() => ({
      send: mockSyntheticsSend,
    }) as unknown as SyntheticsClient);

    manager = new ObservabilityManager({ defaultRegion: 'us-east-1' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // CloudWatch Alarms Tests
  // ===========================================================================

  describe('CloudWatch Alarms', () => {
    describe('listAlarms', () => {
      it('should list all alarms', async () => {
        mockCloudWatchSend.mockResolvedValue({
          MetricAlarms: [
            {
              AlarmName: 'test-alarm-1',
              AlarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:test-alarm-1',
              StateValue: 'OK',
              MetricName: 'CPUUtilization',
              Namespace: 'AWS/EC2',
              Statistic: 'Average',
              Period: 300,
              EvaluationPeriods: 3,
              Threshold: 80,
              ComparisonOperator: 'GreaterThanThreshold',
              ActionsEnabled: true,
              Dimensions: [{ Name: 'InstanceId', Value: 'i-12345' }],
            },
            {
              AlarmName: 'test-alarm-2',
              AlarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:test-alarm-2',
              StateValue: 'ALARM',
              MetricName: 'MemoryUtilization',
              Namespace: 'AWS/EC2',
              Statistic: 'Maximum',
              Period: 60,
              EvaluationPeriods: 1,
              Threshold: 90,
              ComparisonOperator: 'GreaterThanOrEqualToThreshold',
              ActionsEnabled: false,
            },
          ],
        });

        const alarms = await manager.listAlarms();

        expect(alarms).toHaveLength(2);
        expect(alarms[0].alarmName).toBe('test-alarm-1');
        expect(alarms[0].stateValue).toBe('OK');
        expect(alarms[1].alarmName).toBe('test-alarm-2');
        expect(alarms[1].stateValue).toBe('ALARM');
      });

      it('should filter alarms by state', async () => {
        mockCloudWatchSend.mockResolvedValue({
          MetricAlarms: [
            {
              AlarmName: 'alarm-in-alarm',
              StateValue: 'ALARM',
              EvaluationPeriods: 1,
            },
          ],
        });

        const alarms = await manager.listAlarms({ stateValue: 'ALARM' });

        expect(alarms).toHaveLength(1);
        expect(alarms[0].stateValue).toBe('ALARM');
      });

      it('should filter alarms by name prefix', async () => {
        mockCloudWatchSend.mockResolvedValue({
          MetricAlarms: [
            {
              AlarmName: 'production-cpu-alarm',
              StateValue: 'OK',
              EvaluationPeriods: 1,
            },
          ],
        });

        const alarms = await manager.listAlarms({ alarmNamePrefix: 'production' });

        expect(alarms).toHaveLength(1);
        expect(alarms[0].alarmName).toBe('production-cpu-alarm');
      });

      it('should return empty array when no alarms exist', async () => {
        mockCloudWatchSend.mockResolvedValue({ MetricAlarms: [] });

        const alarms = await manager.listAlarms();

        expect(alarms).toHaveLength(0);
      });
    });

    describe('getAlarm', () => {
      it('should get alarm details', async () => {
        mockCloudWatchSend.mockResolvedValue({
          MetricAlarms: [
            {
              AlarmName: 'test-alarm',
              AlarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:test-alarm',
              StateValue: 'OK',
              StateReason: 'Threshold Crossed',
              MetricName: 'CPUUtilization',
              Namespace: 'AWS/EC2',
              Period: 300,
              EvaluationPeriods: 3,
              Threshold: 80,
              ComparisonOperator: 'GreaterThanThreshold',
              ActionsEnabled: true,
              AlarmActions: ['arn:aws:sns:us-east-1:123456789012:alerts'],
            },
          ],
        });

        const result = await manager.getAlarm('test-alarm');

        expect(result.success).toBe(true);
        expect(result.data?.alarmName).toBe('test-alarm');
        expect(result.data?.stateValue).toBe('OK');
        expect(result.data?.alarmActions).toEqual(['arn:aws:sns:us-east-1:123456789012:alerts']);
      });

      it('should return error when alarm not found', async () => {
        mockCloudWatchSend.mockResolvedValue({ MetricAlarms: [] });

        const result = await manager.getAlarm('nonexistent-alarm');

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });
    });

    describe('createAlarm', () => {
      it('should create alarm with basic options', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.createAlarm({
          alarmName: 'new-alarm',
          metricName: 'CPUUtilization',
          namespace: 'AWS/EC2',
          statistic: 'Average',
          period: 300,
          evaluationPeriods: 3,
          threshold: 80,
          comparisonOperator: 'GreaterThanThreshold',
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('created successfully');
      });

      it('should create alarm with all options', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.createAlarm({
          alarmName: 'full-alarm',
          alarmDescription: 'Test alarm with all options',
          metricName: 'CPUUtilization',
          namespace: 'AWS/EC2',
          statistic: 'Average',
          period: 300,
          evaluationPeriods: 3,
          datapointsToAlarm: 2,
          threshold: 80,
          comparisonOperator: 'GreaterThanThreshold',
          treatMissingData: 'notBreaching',
          actionsEnabled: true,
          alarmActions: ['arn:aws:sns:us-east-1:123456789012:alerts'],
          okActions: ['arn:aws:sns:us-east-1:123456789012:ok'],
          insufficientDataActions: ['arn:aws:sns:us-east-1:123456789012:insufficient'],
          dimensions: [{ name: 'InstanceId', value: 'i-12345' }],
          unit: 'Percent',
          tags: { Environment: 'Production' },
        });

        expect(result.success).toBe(true);
      });

      it('should handle create alarm error', async () => {
        mockCloudWatchSend.mockRejectedValue(new Error('Access denied'));

        const result = await manager.createAlarm({
          alarmName: 'new-alarm',
          metricName: 'CPUUtilization',
          namespace: 'AWS/EC2',
          statistic: 'Average',
          period: 300,
          evaluationPeriods: 3,
          threshold: 80,
          comparisonOperator: 'GreaterThanThreshold',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Access denied');
      });
    });

    describe('deleteAlarms', () => {
      it('should delete alarms', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.deleteAlarms(['alarm-1', 'alarm-2']);

        expect(result.success).toBe(true);
        expect(result.message).toContain('Deleted 2 alarm(s)');
      });

      it('should handle delete error', async () => {
        mockCloudWatchSend.mockRejectedValue(new Error('Alarm not found'));

        const result = await manager.deleteAlarms(['nonexistent']);

        expect(result.success).toBe(false);
      });
    });

    describe('getAlarmHistory', () => {
      it('should get alarm history', async () => {
        mockCloudWatchSend.mockResolvedValue({
          AlarmHistoryItems: [
            {
              AlarmName: 'test-alarm',
              Timestamp: new Date('2024-01-15'),
              HistoryItemType: 'StateUpdate',
              HistorySummary: 'Alarm transitioned to ALARM',
            },
            {
              AlarmName: 'test-alarm',
              Timestamp: new Date('2024-01-14'),
              HistoryItemType: 'ConfigurationUpdate',
              HistorySummary: 'Threshold updated',
            },
          ],
        });

        const history = await manager.getAlarmHistory('test-alarm');

        expect(history).toHaveLength(2);
        expect(history[0].historyItemType).toBe('StateUpdate');
        expect(history[1].historyItemType).toBe('ConfigurationUpdate');
      });
    });

    describe('setAlarmState', () => {
      it('should set alarm state', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.setAlarmState(
          'test-alarm',
          'ALARM',
          'Testing alarm state'
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain('state set to ALARM');
      });
    });

    describe('enableAlarmActions', () => {
      it('should enable alarm actions', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.enableAlarmActions(['alarm-1', 'alarm-2']);

        expect(result.success).toBe(true);
        expect(result.message).toContain('Enabled actions');
      });
    });

    describe('disableAlarmActions', () => {
      it('should disable alarm actions', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.disableAlarmActions(['alarm-1']);

        expect(result.success).toBe(true);
        expect(result.message).toContain('Disabled actions');
      });
    });

    describe('getAlarmsForMetric', () => {
      it('should get alarms for specific metric', async () => {
        mockCloudWatchSend.mockResolvedValue({
          MetricAlarms: [
            {
              AlarmName: 'cpu-alarm',
              StateValue: 'OK',
              MetricName: 'CPUUtilization',
              Namespace: 'AWS/EC2',
              EvaluationPeriods: 1,
            },
          ],
        });

        const alarms = await manager.getAlarmsForMetric('AWS/EC2', 'CPUUtilization');

        expect(alarms).toHaveLength(1);
        expect(alarms[0].metricName).toBe('CPUUtilization');
      });
    });

    describe('createAlarmFromTemplate', () => {
      it('should create alarm from template', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.createAlarmFromTemplate(
          'ec2-cpu-high',
          'my-ec2-cpu-alarm',
          [{ name: 'InstanceId', value: 'i-12345' }],
          ['arn:aws:sns:us-east-1:123456789012:alerts']
        );

        expect(result.success).toBe(true);
      });

      it('should return error for unknown template', async () => {
        const result = await manager.createAlarmFromTemplate(
          'unknown-template',
          'my-alarm',
          []
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });

      it('should validate required dimensions', async () => {
        const result = await manager.createAlarmFromTemplate(
          'ec2-cpu-high',
          'my-alarm',
          [] // Missing InstanceId dimension
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Missing required dimension');
      });
    });
  });

  // ===========================================================================
  // CloudWatch Metrics Tests
  // ===========================================================================

  describe('CloudWatch Metrics', () => {
    describe('getMetricStatistics', () => {
      it('should get metric statistics', async () => {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        mockCloudWatchSend.mockResolvedValue({
          Datapoints: [
            {
              Timestamp: oneHourAgo,
              Average: 25.5,
              Sum: 510,
              Minimum: 10,
              Maximum: 40,
              SampleCount: 20,
              Unit: 'Percent',
            },
            {
              Timestamp: now,
              Average: 30.2,
              Sum: 604,
              Minimum: 15,
              Maximum: 45,
              SampleCount: 20,
              Unit: 'Percent',
            },
          ],
        });

        const stats = await manager.getMetricStatistics({
          namespace: 'AWS/EC2',
          metricName: 'CPUUtilization',
          startTime: oneHourAgo,
          endTime: now,
          period: 300,
          statistics: ['Average', 'Sum', 'Minimum', 'Maximum'],
        });

        expect(stats).toHaveLength(2);
        expect(stats[0].average).toBe(25.5);
        expect(stats[1].average).toBe(30.2);
      });
    });

    describe('getMetricData', () => {
      it('should get metric data with expressions', async () => {
        mockCloudWatchSend.mockResolvedValue({
          MetricDataResults: [
            {
              Id: 'm1',
              Label: 'CPU',
              Timestamps: [new Date('2024-01-15T10:00:00Z'), new Date('2024-01-15T10:05:00Z')],
              Values: [25.5, 30.2],
              StatusCode: 'Complete',
            },
            {
              Id: 'e1',
              Label: 'CPU Trend',
              Timestamps: [new Date('2024-01-15T10:00:00Z'), new Date('2024-01-15T10:05:00Z')],
              Values: [27.85, 27.85],
              StatusCode: 'Complete',
            },
          ],
        });

        const results = await manager.getMetricData(
          [
            {
              id: 'm1',
              metricStat: {
                metric: {
                  namespace: 'AWS/EC2',
                  metricName: 'CPUUtilization',
                },
                period: 300,
                stat: 'Average',
              },
            },
            {
              id: 'e1',
              expression: 'AVG(m1)',
              label: 'CPU Trend',
            },
          ],
          new Date('2024-01-15T10:00:00Z'),
          new Date('2024-01-15T10:10:00Z')
        );

        expect(results).toHaveLength(2);
        expect(results[0].id).toBe('m1');
        expect(results[1].id).toBe('e1');
      });
    });

    describe('listMetrics', () => {
      it('should list metrics', async () => {
        mockCloudWatchSend.mockResolvedValue({
          Metrics: [
            {
              Namespace: 'AWS/EC2',
              MetricName: 'CPUUtilization',
              Dimensions: [{ Name: 'InstanceId', Value: 'i-12345' }],
            },
            {
              Namespace: 'AWS/EC2',
              MetricName: 'NetworkIn',
              Dimensions: [{ Name: 'InstanceId', Value: 'i-12345' }],
            },
          ],
        });

        const metrics = await manager.listMetrics({ namespace: 'AWS/EC2' });

        expect(metrics).toHaveLength(2);
        expect(metrics[0].metricName).toBe('CPUUtilization');
        expect(metrics[1].metricName).toBe('NetworkIn');
      });
    });

    describe('putMetricData', () => {
      it('should put custom metric data', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.putMetricData({
          namespace: 'MyApp',
          metricData: [
            {
              metricName: 'RequestCount',
              value: 100,
              unit: 'Count',
              timestamp: new Date(),
              dimensions: [{ name: 'Environment', value: 'Production' }],
            },
          ],
        });

        expect(result.success).toBe(true);
      });

      it('should put metric with statistic values', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.putMetricData({
          namespace: 'MyApp',
          metricData: [
            {
              metricName: 'ResponseTime',
              statisticValues: {
                sampleCount: 100,
                sum: 5000,
                minimum: 10,
                maximum: 200,
              },
              unit: 'Milliseconds',
            },
          ],
        });

        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // CloudWatch Dashboards Tests
  // ===========================================================================

  describe('CloudWatch Dashboards', () => {
    describe('listDashboards', () => {
      it('should list dashboards', async () => {
        mockCloudWatchSend.mockResolvedValue({
          DashboardEntries: [
            {
              DashboardName: 'dashboard-1',
              DashboardArn: 'arn:aws:cloudwatch::123456789012:dashboard/dashboard-1',
              LastModified: new Date('2024-01-15'),
              Size: 1024,
            },
            {
              DashboardName: 'dashboard-2',
              DashboardArn: 'arn:aws:cloudwatch::123456789012:dashboard/dashboard-2',
              LastModified: new Date('2024-01-14'),
              Size: 2048,
            },
          ],
        });

        const dashboards = await manager.listDashboards();

        expect(dashboards).toHaveLength(2);
        expect(dashboards[0].dashboardName).toBe('dashboard-1');
        expect(dashboards[1].dashboardName).toBe('dashboard-2');
      });
    });

    describe('getDashboard', () => {
      it('should get dashboard with body', async () => {
        const dashboardBody = {
          widgets: [
            {
              type: 'metric',
              x: 0,
              y: 0,
              width: 12,
              height: 6,
              properties: {
                title: 'CPU',
                metrics: [['AWS/EC2', 'CPUUtilization']],
              },
            },
          ],
        };

        mockCloudWatchSend.mockResolvedValue({
          DashboardName: 'my-dashboard',
          DashboardArn: 'arn:aws:cloudwatch::123456789012:dashboard/my-dashboard',
          DashboardBody: JSON.stringify(dashboardBody),
        });

        const result = await manager.getDashboard('my-dashboard');

        expect(result.success).toBe(true);
        expect(result.data?.info.dashboardName).toBe('my-dashboard');
        expect(result.data?.body.widgets).toHaveLength(1);
      });

      it('should return error when dashboard not found', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.getDashboard('nonexistent');

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });
    });

    describe('putDashboard', () => {
      it('should create dashboard', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.putDashboard({
          dashboardName: 'new-dashboard',
          dashboardBody: {
            widgets: [
              {
                type: 'metric',
                x: 0,
                y: 0,
                width: 12,
                height: 6,
                properties: {},
              },
            ],
          },
        });

        expect(result.success).toBe(true);
      });

      it('should return validation errors', async () => {
        mockCloudWatchSend.mockResolvedValue({
          DashboardValidationMessages: [
            { Message: 'Invalid widget type' },
          ],
        });

        const result = await manager.putDashboard({
          dashboardName: 'invalid-dashboard',
          dashboardBody: { widgets: [] },
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('validation errors');
      });
    });

    describe('deleteDashboards', () => {
      it('should delete dashboards', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.deleteDashboards(['dashboard-1', 'dashboard-2']);

        expect(result.success).toBe(true);
        expect(result.message).toContain('Deleted 2 dashboard(s)');
      });
    });

    describe('createDashboardFromTemplate', () => {
      it('should create dashboard from template', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.createDashboardFromTemplate(
          'ec2-overview',
          'my-ec2-dashboard',
          { InstanceId: 'i-12345' }
        );

        expect(result.success).toBe(true);
      });

      it('should return error for unknown template', async () => {
        const result = await manager.createDashboardFromTemplate(
          'unknown-template',
          'my-dashboard',
          {}
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });

      it('should validate required dimensions', async () => {
        const result = await manager.createDashboardFromTemplate(
          'ec2-overview',
          'my-dashboard',
          {} // Missing InstanceId
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Missing required dimension');
      });
    });
  });

  // ===========================================================================
  // CloudWatch Logs Tests
  // ===========================================================================

  describe('CloudWatch Logs', () => {
    describe('listLogGroups', () => {
      it('should list log groups', async () => {
        mockLogsSend.mockResolvedValue({
          logGroups: [
            {
              logGroupName: '/aws/lambda/my-function',
              arn: 'arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/my-function',
              creationTime: Date.now(),
              retentionInDays: 14,
              storedBytes: 1024000,
            },
            {
              logGroupName: '/ecs/my-service',
              arn: 'arn:aws:logs:us-east-1:123456789012:log-group:/ecs/my-service',
              creationTime: Date.now(),
              retentionInDays: 7,
              storedBytes: 512000,
            },
          ],
        });

        const logGroups = await manager.listLogGroups();

        expect(logGroups).toHaveLength(2);
        expect(logGroups[0].logGroupName).toBe('/aws/lambda/my-function');
        expect(logGroups[1].logGroupName).toBe('/ecs/my-service');
      });
    });

    describe('getLogGroup', () => {
      it('should get log group details', async () => {
        mockLogsSend.mockResolvedValue({
          logGroups: [
            {
              logGroupName: '/aws/lambda/my-function',
              arn: 'arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/my-function',
              creationTime: Date.now(),
              retentionInDays: 14,
              storedBytes: 1024000,
              metricFilterCount: 2,
            },
          ],
        });

        const result = await manager.getLogGroup('/aws/lambda/my-function');

        expect(result.success).toBe(true);
        expect(result.data?.logGroupName).toBe('/aws/lambda/my-function');
        expect(result.data?.retentionInDays).toBe(14);
      });

      it('should return error when log group not found', async () => {
        mockLogsSend.mockResolvedValue({ logGroups: [] });

        const result = await manager.getLogGroup('/nonexistent');

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });
    });

    describe('createLogGroup', () => {
      it('should create log group', async () => {
        mockLogsSend.mockResolvedValue({});

        const result = await manager.createLogGroup('/my-app/logs');

        expect(result.success).toBe(true);
        expect(result.message).toContain('created');
      });

      it('should create log group with KMS key', async () => {
        mockLogsSend.mockResolvedValue({});

        const result = await manager.createLogGroup(
          '/my-app/logs',
          'arn:aws:kms:us-east-1:123456789012:key/my-key',
          { Environment: 'Production' }
        );

        expect(result.success).toBe(true);
      });
    });

    describe('deleteLogGroup', () => {
      it('should delete log group', async () => {
        mockLogsSend.mockResolvedValue({});

        const result = await manager.deleteLogGroup('/my-app/logs');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deleted');
      });
    });

    describe('setLogGroupRetention', () => {
      it('should set retention policy', async () => {
        mockLogsSend.mockResolvedValue({});

        const result = await manager.setLogGroupRetention('/my-app/logs', 30);

        expect(result.success).toBe(true);
        expect(result.message).toContain('30 days');
      });
    });

    describe('listLogStreams', () => {
      it('should list log streams', async () => {
        mockLogsSend.mockResolvedValue({
          logStreams: [
            {
              logStreamName: '2024/01/15/[$LATEST]abc123',
              creationTime: Date.now(),
              firstEventTimestamp: Date.now() - 3600000,
              lastEventTimestamp: Date.now(),
              storedBytes: 5000,
            },
          ],
        });

        const streams = await manager.listLogStreams({
          logGroupName: '/aws/lambda/my-function',
        });

        expect(streams).toHaveLength(1);
        expect(streams[0].logStreamName).toBe('2024/01/15/[$LATEST]abc123');
      });
    });

    describe('filterLogEvents', () => {
      it('should filter log events', async () => {
        mockLogsSend.mockResolvedValue({
          events: [
            {
              timestamp: Date.now() - 60000,
              message: 'Error: Connection timeout',
              logStreamName: 'stream-1',
              eventId: 'event-1',
            },
            {
              timestamp: Date.now(),
              message: 'Error: Database unavailable',
              logStreamName: 'stream-1',
              eventId: 'event-2',
            },
          ],
        });

        const events = await manager.filterLogEvents({
          logGroupName: '/my-app/logs',
          filterPattern: 'Error',
          startTime: new Date(Date.now() - 3600000),
          endTime: new Date(),
        });

        expect(events).toHaveLength(2);
        expect(events[0].message).toContain('Connection timeout');
      });
    });

    describe('getLogEvents', () => {
      it('should get log events from stream', async () => {
        mockLogsSend.mockResolvedValue({
          events: [
            { timestamp: Date.now() - 1000, message: 'Starting...' },
            { timestamp: Date.now(), message: 'Complete' },
          ],
        });

        const events = await manager.getLogEvents(
          '/my-app/logs',
          'stream-1'
        );

        expect(events).toHaveLength(2);
      });
    });

    describe('Log Insights', () => {
      describe('startLogInsightsQuery', () => {
        it('should start query', async () => {
          mockLogsSend.mockResolvedValue({ queryId: 'query-123' });

          const result = await manager.startLogInsightsQuery({
            logGroupNames: ['/my-app/logs'],
            queryString: 'fields @timestamp, @message | limit 100',
            startTime: new Date(Date.now() - 3600000),
            endTime: new Date(),
          });

          expect(result.success).toBe(true);
          expect(result.data).toBe('query-123');
        });
      });

      describe('getLogInsightsQueryResults', () => {
        it('should get query results', async () => {
          mockLogsSend.mockResolvedValue({
            status: 'Complete',
            statistics: {
              recordsMatched: 50,
              recordsScanned: 1000,
              bytesScanned: 1024000,
            },
            results: [
              [
                { field: '@timestamp', value: '2024-01-15 10:00:00' },
                { field: '@message', value: 'Test message' },
              ],
            ],
          });

          const result = await manager.getLogInsightsQueryResults('query-123');

          expect(result.success).toBe(true);
          expect(result.data?.status).toBe('Complete');
          expect(result.data?.results).toHaveLength(1);
        });
      });

      describe('executeLogInsightsQuery', () => {
        it('should execute query and wait for results', async () => {
          mockLogsSend
            .mockResolvedValueOnce({ queryId: 'query-123' })
            .mockResolvedValueOnce({
              status: 'Running',
              results: [],
            })
            .mockResolvedValueOnce({
              status: 'Complete',
              statistics: { recordsMatched: 10 },
              results: [[{ field: '@message', value: 'test' }]],
            });

          const result = await manager.executeLogInsightsQuery(
            {
              logGroupNames: ['/my-app/logs'],
              queryString: 'fields @message | limit 10',
              startTime: new Date(Date.now() - 3600000),
              endTime: new Date(),
            },
            5000,
            100
          );

          expect(result.success).toBe(true);
          expect(result.data?.status).toBe('Complete');
        });

        it('should handle query timeout', async () => {
          mockLogsSend
            .mockResolvedValueOnce({ queryId: 'query-123' })
            .mockResolvedValue({ status: 'Running', results: [] });

          const result = await manager.executeLogInsightsQuery(
            {
              logGroupNames: ['/my-app/logs'],
              queryString: 'fields @message | limit 10',
              startTime: new Date(Date.now() - 3600000),
              endTime: new Date(),
            },
            200, // Short timeout
            50
          );

          expect(result.success).toBe(false);
          expect(result.error).toContain('timed out');
        });
      });
    });

    describe('Metric Filters', () => {
      describe('listMetricFilters', () => {
        it('should list metric filters', async () => {
          mockLogsSend.mockResolvedValue({
            metricFilters: [
              {
                filterName: 'error-filter',
                filterPattern: 'ERROR',
                logGroupName: '/my-app/logs',
                metricTransformations: [
                  {
                    metricName: 'ErrorCount',
                    metricNamespace: 'MyApp',
                    metricValue: '1',
                  },
                ],
              },
            ],
          });

          const filters = await manager.listMetricFilters('/my-app/logs');

          expect(filters).toHaveLength(1);
          expect(filters[0].filterName).toBe('error-filter');
        });
      });

      describe('createMetricFilter', () => {
        it('should create metric filter', async () => {
          mockLogsSend.mockResolvedValue({});

          const result = await manager.createMetricFilter({
            filterName: 'error-filter',
            filterPattern: 'ERROR',
            logGroupName: '/my-app/logs',
            metricTransformations: [
              {
                metricName: 'ErrorCount',
                metricNamespace: 'MyApp',
                metricValue: '1',
              },
            ],
          });

          expect(result.success).toBe(true);
        });
      });

      describe('deleteMetricFilter', () => {
        it('should delete metric filter', async () => {
          mockLogsSend.mockResolvedValue({});

          const result = await manager.deleteMetricFilter('/my-app/logs', 'error-filter');

          expect(result.success).toBe(true);
        });
      });
    });
  });

  // ===========================================================================
  // X-Ray Tests
  // ===========================================================================

  describe('X-Ray', () => {
    describe('getTraceSummaries', () => {
      it('should get trace summaries', async () => {
        mockXRaySend.mockResolvedValue({
          TraceSummaries: [
            {
              Id: '1-abc123-def456',
              Duration: 0.5,
              ResponseTime: 0.4,
              HasFault: false,
              HasError: false,
              HasThrottle: false,
              Http: {
                HttpURL: 'https://api.example.com/users',
                HttpStatus: 200,
                HttpMethod: 'GET',
              },
              ServiceIds: [
                { Name: 'api-gateway', Type: 'AWS::ApiGateway::Stage' },
              ],
            },
            {
              Id: '1-abc124-def457',
              Duration: 2.5,
              ResponseTime: 2.4,
              HasFault: true,
              HasError: false,
              Http: {
                HttpURL: 'https://api.example.com/orders',
                HttpStatus: 500,
                HttpMethod: 'POST',
              },
            },
          ],
        });

        const traces = await manager.getTraceSummaries({
          startTime: new Date(Date.now() - 3600000),
          endTime: new Date(),
        });

        expect(traces).toHaveLength(2);
        expect(traces[0].hasFault).toBe(false);
        expect(traces[1].hasFault).toBe(true);
      });

      it('should filter traces by expression', async () => {
        mockXRaySend.mockResolvedValue({
          TraceSummaries: [
            {
              Id: '1-abc123-def456',
              Duration: 2.5,
              HasFault: true,
            },
          ],
        });

        const traces = await manager.getTraceSummaries({
          startTime: new Date(Date.now() - 3600000),
          endTime: new Date(),
          filterExpression: 'fault = true',
        });

        expect(traces).toHaveLength(1);
        expect(traces[0].hasFault).toBe(true);
      });
    });

    describe('getTraces', () => {
      it('should get trace details', async () => {
        mockXRaySend.mockResolvedValue({
          Traces: [
            {
              Id: '1-abc123-def456',
              Duration: 0.5,
              Segments: [
                { Id: 'seg-1', Document: '{"name":"api-gateway"}' },
                { Id: 'seg-2', Document: '{"name":"lambda"}' },
              ],
            },
          ],
        });

        const result = await manager.getTraces(['1-abc123-def456']);

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data?.[0].segments).toHaveLength(2);
      });
    });

    describe('getServiceMap', () => {
      it('should get service map', async () => {
        mockXRaySend.mockResolvedValue({
          StartTime: new Date(Date.now() - 3600000),
          EndTime: new Date(),
          Services: [
            {
              ReferenceId: 0,
              Name: 'api-gateway',
              Names: ['api-gateway'],
              Type: 'AWS::ApiGateway::Stage',
              Root: true,
              SummaryStatistics: {
                OkCount: 100,
                TotalCount: 105,
              },
              Edges: [
                {
                  ReferenceId: 1,
                  SummaryStatistics: {
                    OkCount: 100,
                    TotalCount: 105,
                  },
                },
              ],
            },
            {
              ReferenceId: 1,
              Name: 'my-lambda',
              Names: ['my-lambda'],
              Type: 'AWS::Lambda::Function',
              Root: false,
            },
          ],
        });

        const result = await manager.getServiceMap(
          new Date(Date.now() - 3600000),
          new Date()
        );

        expect(result.success).toBe(true);
        expect(result.data?.services).toHaveLength(2);
        expect(result.data?.services[0].root).toBe(true);
      });
    });

    describe('X-Ray Groups', () => {
      describe('listXRayGroups', () => {
        it('should list groups', async () => {
          mockXRaySend.mockResolvedValue({
            Groups: [
              {
                GroupName: 'production',
                GroupARN: 'arn:aws:xray:us-east-1:123456789012:group/production',
                FilterExpression: 'service("api")',
              },
            ],
          });

          const groups = await manager.listXRayGroups();

          expect(groups).toHaveLength(1);
          expect(groups[0].groupName).toBe('production');
        });
      });

      describe('createXRayGroup', () => {
        it('should create group', async () => {
          mockXRaySend.mockResolvedValue({
            Group: {
              GroupName: 'my-group',
              GroupARN: 'arn:aws:xray:us-east-1:123456789012:group/my-group',
              FilterExpression: 'fault = true',
            },
          });

          const result = await manager.createXRayGroup(
            'my-group',
            'fault = true',
            true
          );

          expect(result.success).toBe(true);
          expect(result.data?.groupName).toBe('my-group');
        });
      });

      describe('deleteXRayGroup', () => {
        it('should delete group', async () => {
          mockXRaySend.mockResolvedValue({});

          const result = await manager.deleteXRayGroup('my-group');

          expect(result.success).toBe(true);
        });
      });
    });

    describe('getInsightSummaries', () => {
      it('should get insight summaries', async () => {
        mockXRaySend.mockResolvedValue({
          InsightSummaries: [
            {
              InsightId: 'insight-123',
              GroupName: 'production',
              RootCauseServiceId: { Name: 'database' },
              Categories: ['FAULT'],
              State: 'ACTIVE',
              StartTime: new Date(Date.now() - 3600000),
              Summary: 'Increased fault rate detected',
            },
          ],
        });

        const insights = await manager.getInsightSummaries(
          'production',
          new Date(Date.now() - 86400000),
          new Date()
        );

        expect(insights).toHaveLength(1);
        expect(insights[0].state).toBe('ACTIVE');
      });
    });
  });

  // ===========================================================================
  // CloudWatch Synthetics Tests
  // ===========================================================================

  describe('CloudWatch Synthetics', () => {
    describe('listCanaries', () => {
      it('should list canaries', async () => {
        mockSyntheticsSend.mockResolvedValue({
          Canaries: [
            {
              Id: 'canary-123',
              Name: 'api-monitor',
              Status: { State: 'RUNNING' },
              Schedule: { Expression: 'rate(5 minutes)' },
              RuntimeVersion: 'syn-nodejs-puppeteer-6.2',
            },
            {
              Id: 'canary-124',
              Name: 'website-monitor',
              Status: { State: 'STOPPED' },
              Schedule: { Expression: 'rate(1 hour)' },
              RuntimeVersion: 'syn-nodejs-puppeteer-6.2',
            },
          ],
        });

        const canaries = await manager.listCanaries();

        expect(canaries).toHaveLength(2);
        expect(canaries[0].name).toBe('api-monitor');
        expect(canaries[1].name).toBe('website-monitor');
      });
    });

    describe('getCanary', () => {
      it('should get canary details', async () => {
        mockSyntheticsSend.mockResolvedValue({
          Canary: {
            Id: 'canary-123',
            Name: 'api-monitor',
            Status: { State: 'RUNNING', StateReason: '' },
            Schedule: { Expression: 'rate(5 minutes)', DurationInSeconds: 0 },
            RuntimeVersion: 'syn-nodejs-puppeteer-6.2',
            Code: { Handler: 'index.handler' },
            ExecutionRoleArn: 'arn:aws:iam::123456789012:role/canary-role',
            ArtifactS3Location: 's3://my-bucket/canary/',
            SuccessRetentionPeriodInDays: 31,
            FailureRetentionPeriodInDays: 31,
          },
        });

        const result = await manager.getCanary('api-monitor');

        expect(result.success).toBe(true);
        expect(result.data?.name).toBe('api-monitor');
        expect(result.data?.runtimeVersion).toBe('syn-nodejs-puppeteer-6.2');
      });

      it('should return error when canary not found', async () => {
        mockSyntheticsSend.mockResolvedValue({});

        const result = await manager.getCanary('nonexistent');

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });
    });

    describe('createCanary', () => {
      it('should create canary', async () => {
        mockSyntheticsSend.mockResolvedValue({
          Canary: {
            Id: 'canary-new',
            Name: 'new-canary',
            Status: { State: 'CREATING' },
          },
        });

        const result = await manager.createCanary({
          name: 'new-canary',
          code: {
            s3Bucket: 'my-bucket',
            s3Key: 'canary-code.zip',
            handler: 'index.handler',
          },
          artifactS3Location: 's3://my-bucket/canary-artifacts/',
          executionRoleArn: 'arn:aws:iam::123456789012:role/canary-role',
          schedule: { expression: 'rate(5 minutes)' },
          runtimeVersion: 'syn-nodejs-puppeteer-6.2',
        });

        expect(result.success).toBe(true);
        expect(result.data?.name).toBe('new-canary');
      });

      it('should create canary with VPC config', async () => {
        mockSyntheticsSend.mockResolvedValue({
          Canary: {
            Id: 'canary-vpc',
            Name: 'vpc-canary',
            Status: { State: 'CREATING' },
          },
        });

        const result = await manager.createCanary({
          name: 'vpc-canary',
          code: {
            s3Bucket: 'my-bucket',
            s3Key: 'canary-code.zip',
            handler: 'index.handler',
          },
          artifactS3Location: 's3://my-bucket/canary-artifacts/',
          executionRoleArn: 'arn:aws:iam::123456789012:role/canary-role',
          schedule: { expression: 'rate(5 minutes)' },
          runtimeVersion: 'syn-nodejs-puppeteer-6.2',
          vpcConfig: {
            subnetIds: ['subnet-123', 'subnet-456'],
            securityGroupIds: ['sg-123'],
          },
        });

        expect(result.success).toBe(true);
      });
    });

    describe('updateCanary', () => {
      it('should update canary', async () => {
        mockSyntheticsSend.mockResolvedValue({});

        const result = await manager.updateCanary({
          name: 'api-monitor',
          schedule: { expression: 'rate(10 minutes)' },
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('updated');
      });
    });

    describe('deleteCanary', () => {
      it('should delete canary', async () => {
        mockSyntheticsSend.mockResolvedValue({});

        const result = await manager.deleteCanary('api-monitor');

        expect(result.success).toBe(true);
      });

      it('should delete canary with lambda', async () => {
        mockSyntheticsSend.mockResolvedValue({});

        const result = await manager.deleteCanary('api-monitor', true);

        expect(result.success).toBe(true);
      });
    });

    describe('startCanary', () => {
      it('should start canary', async () => {
        mockSyntheticsSend.mockResolvedValue({});

        const result = await manager.startCanary('api-monitor');

        expect(result.success).toBe(true);
        expect(result.message).toContain('started');
      });
    });

    describe('stopCanary', () => {
      it('should stop canary', async () => {
        mockSyntheticsSend.mockResolvedValue({});

        const result = await manager.stopCanary('api-monitor');

        expect(result.success).toBe(true);
        expect(result.message).toContain('stopped');
      });
    });

    describe('getCanaryRuns', () => {
      it('should get canary runs', async () => {
        mockSyntheticsSend.mockResolvedValue({
          CanaryRuns: [
            {
              Id: 'run-1',
              Name: 'api-monitor',
              Status: { State: 'PASSED' },
              Timeline: {
                Started: new Date(Date.now() - 300000),
                Completed: new Date(Date.now() - 280000),
              },
            },
            {
              Id: 'run-2',
              Name: 'api-monitor',
              Status: { State: 'FAILED', StateReason: 'Timeout' },
              Timeline: {
                Started: new Date(Date.now() - 600000),
                Completed: new Date(Date.now() - 580000),
              },
            },
          ],
        });

        const runs = await manager.getCanaryRuns('api-monitor');

        expect(runs).toHaveLength(2);
        expect(runs[0].status).toEqual({ state: 'PASSED' });
        expect(runs[1].status).toEqual({ state: 'FAILED', stateReason: 'Timeout' });
      });
    });

    describe('getCanariesLastRun', () => {
      it('should get last run status for all canaries', async () => {
        mockSyntheticsSend.mockResolvedValue({
          CanariesLastRun: [
            {
              CanaryName: 'api-monitor',
              LastRun: {
                Id: 'run-1',
                Status: { State: 'PASSED' },
              },
            },
            {
              CanaryName: 'website-monitor',
              LastRun: {
                Id: 'run-2',
                Status: { State: 'FAILED' },
              },
            },
          ],
        });

        const lastRuns = await manager.getCanariesLastRun();

        expect(lastRuns).toHaveLength(2);
        expect(lastRuns[0].lastRun?.status).toEqual({ state: 'PASSED' });
      });
    });
  });

  // ===========================================================================
  // Anomaly Detection Tests
  // ===========================================================================

  describe('Anomaly Detection', () => {
    describe('putAnomalyDetector', () => {
      it('should create anomaly detector', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.putAnomalyDetector({
          namespace: 'AWS/EC2',
          metricName: 'CPUUtilization',
          stat: 'Average',
          dimensions: [{ name: 'InstanceId', value: 'i-12345' }],
        });

        expect(result.success).toBe(true);
      });

      it('should create anomaly detector with excluded time ranges', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.putAnomalyDetector({
          namespace: 'AWS/EC2',
          metricName: 'CPUUtilization',
          stat: 'Average',
          configuration: {
            excludedTimeRanges: [
              {
                startTime: new Date('2024-01-15T02:00:00Z'),
                endTime: new Date('2024-01-15T06:00:00Z'),
              },
            ],
            metricTimezone: 'UTC',
          },
        });

        expect(result.success).toBe(true);
      });
    });

    describe('deleteAnomalyDetector', () => {
      it('should delete anomaly detector', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.deleteAnomalyDetector(
          'AWS/EC2',
          'CPUUtilization',
          'Average',
          [{ name: 'InstanceId', value: 'i-12345' }]
        );

        expect(result.success).toBe(true);
      });
    });

    describe('listAnomalyDetectors', () => {
      it('should list anomaly detectors', async () => {
        mockCloudWatchSend.mockResolvedValue({
          AnomalyDetectors: [
            {
              SingleMetricAnomalyDetector: {
                Namespace: 'AWS/EC2',
                MetricName: 'CPUUtilization',
                Stat: 'Average',
                Dimensions: [{ Name: 'InstanceId', Value: 'i-12345' }],
              },
              StateValue: 'TRAINED_INSUFFICIENT_DATA',
            },
            {
              SingleMetricAnomalyDetector: {
                Namespace: 'AWS/RDS',
                MetricName: 'DatabaseConnections',
                Stat: 'Average',
              },
              StateValue: 'TRAINED',
            },
          ],
        });

        const detectors = await manager.listAnomalyDetectors();

        expect(detectors).toHaveLength(2);
        expect(detectors[0].metricName).toBe('CPUUtilization');
        expect(detectors[1].stateValue).toBe('TRAINED');
      });
    });
  });

  // ===========================================================================
  // Composite Alarms Tests
  // ===========================================================================

  describe('Composite Alarms', () => {
    describe('createCompositeAlarm', () => {
      it('should create composite alarm', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.createCompositeAlarm({
          alarmName: 'service-health',
          alarmDescription: 'Composite alarm for service health',
          alarmRule: 'ALARM(cpu-alarm) OR ALARM(memory-alarm)',
          alarmActions: ['arn:aws:sns:us-east-1:123456789012:alerts'],
        });

        expect(result.success).toBe(true);
      });

      it('should create composite alarm with suppression', async () => {
        mockCloudWatchSend.mockResolvedValue({});

        const result = await manager.createCompositeAlarm({
          alarmName: 'service-health',
          alarmRule: 'ALARM(cpu-alarm) OR ALARM(memory-alarm)',
          actionsSuppressor: 'maintenance-window',
          actionsSuppressorWaitPeriod: 60,
          actionsSuppressorExtensionPeriod: 120,
        });

        expect(result.success).toBe(true);
      });
    });

    describe('listCompositeAlarms', () => {
      it('should list composite alarms', async () => {
        mockCloudWatchSend.mockResolvedValue({
          CompositeAlarms: [
            {
              AlarmName: 'service-health',
              AlarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:service-health',
              AlarmRule: 'ALARM(cpu-alarm) OR ALARM(memory-alarm)',
              StateValue: 'OK',
              ActionsEnabled: true,
            },
          ],
        });

        const alarms = await manager.listCompositeAlarms();

        expect(alarms).toHaveLength(1);
        expect(alarms[0].alarmName).toBe('service-health');
        expect(alarms[0].alarmRule).toContain('cpu-alarm');
      });
    });
  });

  // ===========================================================================
  // Health Summary Tests
  // ===========================================================================

  describe('getObservabilityHealthSummary', () => {
    it('should get health summary', async () => {
      // Mock alarm responses
      mockCloudWatchSend
        .mockResolvedValueOnce({
          MetricAlarms: [{ AlarmName: 'ok-alarm', StateValue: 'OK', EvaluationPeriods: 1 }],
        })
        .mockResolvedValueOnce({
          MetricAlarms: [{ AlarmName: 'alarm-alarm', StateValue: 'ALARM', EvaluationPeriods: 1 }],
        })
        .mockResolvedValueOnce({
          MetricAlarms: [],
        })
        .mockResolvedValueOnce({
          AnomalyDetectors: [],
        });

      // Mock logs response
      mockLogsSend.mockResolvedValue({
        logGroups: [
          { logGroupName: '/aws/lambda/func1', storedBytes: 1000000 },
          { logGroupName: '/aws/lambda/func2', storedBytes: 500000 },
        ],
      });

      // Mock synthetics responses
      mockSyntheticsSend
        .mockResolvedValueOnce({
          Canaries: [
            { Name: 'canary-1', Status: { State: 'RUNNING' } },
          ],
        })
        .mockResolvedValueOnce({
          CanariesLastRun: [
            {
              CanaryName: 'canary-1',
              LastRun: { Status: { State: 'PASSED' } },
            },
          ],
        });

      // Mock X-Ray response
      mockXRaySend.mockResolvedValue({
        TraceSummaries: [
          { Id: 'trace-1', ResponseTime: 0.5, HasFault: false, HasError: false },
          { Id: 'trace-2', ResponseTime: 1.5, HasFault: true, HasError: false },
        ],
      });

      const result = await manager.getObservabilityHealthSummary();

      expect(result.success).toBe(true);
      expect(result.data?.alarms.ok).toBe(1);
      expect(result.data?.alarms.inAlarm).toBe(1);
      expect(result.data?.logs.totalGroups).toBe(2);
      expect(result.data?.synthetics.totalCanaries).toBe(1);
      expect(result.data?.traces.totalTraces).toBe(2);
      expect(result.data?.traces.faultPercentage).toBe(50);
    });
  });

  // ===========================================================================
  // Templates Tests
  // ===========================================================================

  describe('Templates', () => {
    describe('Alarm Templates', () => {
      it('should get alarm template by id', () => {
        const template = manager.getAlarmTemplate('ec2-cpu-high');

        expect(template).toBeDefined();
        expect(template?.name).toBe('EC2 High CPU');
        expect(template?.metricName).toBe('CPUUtilization');
      });

      it('should return undefined for unknown template', () => {
        const template = manager.getAlarmTemplate('unknown');

        expect(template).toBeUndefined();
      });

      it('should list all alarm templates', () => {
        const templates = manager.listAlarmTemplates();

        expect(templates.length).toBeGreaterThan(0);
        expect(templates.some(t => t.category === 'ec2')).toBe(true);
        expect(templates.some(t => t.category === 'lambda')).toBe(true);
      });

      it('should filter alarm templates by category', () => {
        const ec2Templates = manager.listAlarmTemplates('ec2');

        expect(ec2Templates.every(t => t.category === 'ec2')).toBe(true);
      });
    });

    describe('Dashboard Templates', () => {
      it('should get dashboard template by id', () => {
        const template = manager.getDashboardTemplate('ec2-overview');

        expect(template).toBeDefined();
        expect(template?.name).toBe('EC2 Instance Overview');
        expect(template?.widgets.length).toBeGreaterThan(0);
      });

      it('should return undefined for unknown template', () => {
        const template = manager.getDashboardTemplate('unknown');

        expect(template).toBeUndefined();
      });

      it('should list all dashboard templates', () => {
        const templates = manager.listDashboardTemplates();

        expect(templates.length).toBeGreaterThan(0);
      });

      it('should filter dashboard templates by category', () => {
        const lambdaTemplates = manager.listDashboardTemplates('lambda');

        expect(lambdaTemplates.every(t => t.category === 'lambda')).toBe(true);
      });
    });

    describe('Canary Blueprints', () => {
      it('should get canary blueprint by id', () => {
        const blueprint = manager.getCanaryBlueprint('heartbeat');

        expect(blueprint).toBeDefined();
        expect(blueprint?.name).toBe('Heartbeat Monitor');
        expect(blueprint?.codeTemplate).toContain('synthetics');
      });

      it('should return undefined for unknown blueprint', () => {
        const blueprint = manager.getCanaryBlueprint('unknown');

        expect(blueprint).toBeUndefined();
      });

      it('should list all canary blueprints', () => {
        const blueprints = manager.listCanaryBlueprints();

        expect(blueprints.length).toBeGreaterThan(0);
        expect(blueprints.some(b => b.type === 'heartbeat')).toBe(true);
        expect(blueprints.some(b => b.type === 'api')).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe('createObservabilityManager', () => {
    it('should create manager with default config', () => {
      const mgr = createObservabilityManager();

      expect(mgr).toBeInstanceOf(ObservabilityManager);
    });

    it('should create manager with custom region', () => {
      const mgr = createObservabilityManager({ defaultRegion: 'eu-west-1' });

      expect(mgr).toBeInstanceOf(ObservabilityManager);
    });
  });
});
