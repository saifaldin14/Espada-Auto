/**
 * AWS Automation Manager Tests
 *
 * Comprehensive tests for EventBridge rules, Step Functions workflows,
 * automated remediation, scheduling, and event management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AWSAutomationManager, createAutomationManager } from './manager.js';
import {
  PREDEFINED_EVENT_PATTERNS,
  SCHEDULE_EXPRESSIONS,
  WORKFLOW_TEMPLATES,
} from './types.js';
import type {
  EventPattern,
  CreateEventRuleOptions,
  CreateScheduleOptions,
  CreateStateMachineOptions,
  BuildWorkflowOptions,
  SetupRemediationOptions,
  WorkflowDefinition,
} from './types.js';

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  ListEventBusesCommand: vi.fn(),
  CreateEventBusCommand: vi.fn(),
  DeleteEventBusCommand: vi.fn(),
  ListRulesCommand: vi.fn(),
  DescribeRuleCommand: vi.fn(),
  PutRuleCommand: vi.fn(),
  DeleteRuleCommand: vi.fn(),
  EnableRuleCommand: vi.fn(),
  DisableRuleCommand: vi.fn(),
  ListTargetsByRuleCommand: vi.fn(),
  PutTargetsCommand: vi.fn(),
  RemoveTargetsCommand: vi.fn(),
  ListArchivesCommand: vi.fn(),
  CreateArchiveCommand: vi.fn(),
  DeleteArchiveCommand: vi.fn(),
  DescribeArchiveCommand: vi.fn(),
  StartReplayCommand: vi.fn(),
  CancelReplayCommand: vi.fn(),
  DescribeReplayCommand: vi.fn(),
  TagResourceCommand: vi.fn(),
  ListTagsForResourceCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  ListSchedulesCommand: vi.fn(),
  GetScheduleCommand: vi.fn(),
  CreateScheduleCommand: vi.fn(),
  UpdateScheduleCommand: vi.fn(),
  DeleteScheduleCommand: vi.fn(),
  ListScheduleGroupsCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  ListStateMachinesCommand: vi.fn(),
  DescribeStateMachineCommand: vi.fn(),
  CreateStateMachineCommand: vi.fn(),
  UpdateStateMachineCommand: vi.fn(),
  DeleteStateMachineCommand: vi.fn(),
  StartExecutionCommand: vi.fn(),
  StopExecutionCommand: vi.fn(),
  ListExecutionsCommand: vi.fn(),
  DescribeExecutionCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-config-service', () => ({
  ConfigServiceClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  PutRemediationConfigurationsCommand: vi.fn(),
  DeleteRemediationConfigurationCommand: vi.fn(),
  DescribeRemediationConfigurationsCommand: vi.fn(),
  StartRemediationExecutionCommand: vi.fn(),
  DescribeRemediationExecutionStatusCommand: vi.fn(),
}));

describe('AWSAutomationManager', () => {
  let manager: AWSAutomationManager;
  let mockEventBridgeSend: ReturnType<typeof vi.fn>;
  let mockSchedulerSend: ReturnType<typeof vi.fn>;
  let mockSfnSend: ReturnType<typeof vi.fn>;
  let mockConfigSend: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mocked clients
    const { EventBridgeClient } = await import('@aws-sdk/client-eventbridge');
    const { SchedulerClient } = await import('@aws-sdk/client-scheduler');
    const { SFNClient } = await import('@aws-sdk/client-sfn');
    const { ConfigServiceClient } = await import('@aws-sdk/client-config-service');

    mockEventBridgeSend = vi.fn();
    mockSchedulerSend = vi.fn();
    mockSfnSend = vi.fn();
    mockConfigSend = vi.fn();

    (EventBridgeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      send: mockEventBridgeSend,
    }));

    (SchedulerClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      send: mockSchedulerSend,
    }));

    (SFNClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      send: mockSfnSend,
    }));

    (ConfigServiceClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      send: mockConfigSend,
    }));

    manager = createAutomationManager({
      defaultRegion: 'us-east-1',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // =============================================================================
  // Factory Function Tests
  // =============================================================================

  describe('createAutomationManager', () => {
    it('should create a manager with default configuration', () => {
      const mgr = createAutomationManager();
      expect(mgr).toBeInstanceOf(AWSAutomationManager);
    });

    it('should create a manager with custom configuration', () => {
      const mgr = createAutomationManager({
        defaultRegion: 'eu-west-1',
        defaultEventBus: 'custom-bus',
      });
      expect(mgr).toBeInstanceOf(AWSAutomationManager);
    });

    it('should create a manager with credentials', () => {
      const mgr = createAutomationManager({
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
      });
      expect(mgr).toBeInstanceOf(AWSAutomationManager);
    });
  });

  // =============================================================================
  // Event Bus Tests
  // =============================================================================

  describe('Event Bus Management', () => {
    it('should list event buses', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        EventBuses: [
          { Name: 'default', Arn: 'arn:aws:events:us-east-1:123456789012:event-bus/default' },
          { Name: 'custom-bus', Arn: 'arn:aws:events:us-east-1:123456789012:event-bus/custom-bus' },
        ],
      });

      const result = await manager.listEventBuses();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0].name).toBe('default');
      expect(result.data?.[0].isDefault).toBe(true);
      expect(result.data?.[1].isDefault).toBe(false);
    });

    it('should create an event bus', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        EventBusArn: 'arn:aws:events:us-east-1:123456789012:event-bus/my-bus',
      });

      const result = await manager.createEventBus('my-bus', 'My custom event bus');

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('my-bus');
      expect(result.data?.arn).toContain('my-bus');
    });

    it('should delete an event bus', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({});

      const result = await manager.deleteEventBus('custom-bus');

      expect(result.success).toBe(true);
      expect(result.message).toContain('deleted');
    });

    it('should not allow deleting the default event bus', async () => {
      const result = await manager.deleteEventBus('default');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot delete the default event bus');
    });

    it('should handle list event buses error', async () => {
      mockEventBridgeSend.mockRejectedValueOnce(new Error('Access denied'));

      const result = await manager.listEventBuses();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Access denied');
    });
  });

  // =============================================================================
  // Event Rule Tests
  // =============================================================================

  describe('Event Rule Management', () => {
    it('should list event rules', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        Rules: [
          {
            Name: 'rule-1',
            Arn: 'arn:aws:events:us-east-1:123456789012:rule/rule-1',
            State: 'ENABLED',
            EventBusName: 'default',
          },
          {
            Name: 'rule-2',
            Arn: 'arn:aws:events:us-east-1:123456789012:rule/rule-2',
            State: 'DISABLED',
            EventBusName: 'default',
            ScheduleExpression: 'rate(1 hour)',
          },
        ],
      });

      const result = await manager.listEventRules();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0].state).toBe('ENABLED');
      expect(result.data?.[1].scheduleExpression).toBe('rate(1 hour)');
    });

    it('should get an event rule', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        Name: 'my-rule',
        Arn: 'arn:aws:events:us-east-1:123456789012:rule/my-rule',
        State: 'ENABLED',
        EventPattern: '{"source":["aws.ec2"]}',
        EventBusName: 'default',
      });

      const result = await manager.getEventRule('my-rule');

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('my-rule');
      expect(result.data?.eventPattern).toContain('aws.ec2');
    });

    it('should create an event rule with event pattern', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/new-rule',
      });

      const options: CreateEventRuleOptions = {
        name: 'new-rule',
        description: 'Test rule',
        eventPattern: {
          source: ['aws.ec2'],
          'detail-type': ['EC2 Instance State-change Notification'],
        },
        state: 'ENABLED',
      };

      const result = await manager.createEventRule(options);

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('new-rule');
    });

    it('should create an event rule with schedule expression', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/scheduled-rule',
      });

      const options: CreateEventRuleOptions = {
        name: 'scheduled-rule',
        scheduleExpression: 'rate(1 hour)',
        state: 'ENABLED',
      };

      const result = await manager.createEventRule(options);

      expect(result.success).toBe(true);
      expect(result.data?.scheduleExpression).toBe('rate(1 hour)');
    });

    it('should fail to create rule without pattern or schedule', async () => {
      const options: CreateEventRuleOptions = {
        name: 'invalid-rule',
      };

      const result = await manager.createEventRule(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('eventPattern or scheduleExpression');
    });

    it('should update an event rule', async () => {
      // First call: get existing rule
      mockEventBridgeSend.mockResolvedValueOnce({
        Name: 'my-rule',
        Arn: 'arn:aws:events:us-east-1:123456789012:rule/my-rule',
        State: 'ENABLED',
        EventPattern: '{"source":["aws.ec2"]}',
        EventBusName: 'default',
      });
      // Second call: put updated rule
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/my-rule',
      });

      const result = await manager.updateEventRule('my-rule', {
        description: 'Updated description',
      });

      expect(result.success).toBe(true);
    });

    it('should delete an event rule', async () => {
      // First call: list targets (empty)
      mockEventBridgeSend.mockResolvedValueOnce({ Targets: [] });
      // Second call: delete rule
      mockEventBridgeSend.mockResolvedValueOnce({});

      const result = await manager.deleteEventRule('my-rule');

      expect(result.success).toBe(true);
    });

    it('should enable an event rule', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({});

      const result = await manager.enableEventRule('my-rule');

      expect(result.success).toBe(true);
      expect(result.message).toContain('enabled');
    });

    it('should disable an event rule', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({});

      const result = await manager.disableEventRule('my-rule');

      expect(result.success).toBe(true);
      expect(result.message).toContain('disabled');
    });
  });

  // =============================================================================
  // Event Target Tests
  // =============================================================================

  describe('Event Target Management', () => {
    it('should list targets for a rule', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        Targets: [
          {
            Id: 'target-1',
            Arn: 'arn:aws:lambda:us-east-1:123456789012:function:my-function',
          },
          {
            Id: 'target-2',
            Arn: 'arn:aws:sns:us-east-1:123456789012:my-topic',
            RoleArn: 'arn:aws:iam::123456789012:role/my-role',
          },
        ],
      });

      const result = await manager.listTargets('my-rule');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should add a target to a rule', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({ FailedEntryCount: 0 });

      const result = await manager.addTarget({
        ruleName: 'my-rule',
        targetId: 'my-target',
        targetArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-function',
        targetType: 'lambda',
      });

      expect(result.success).toBe(true);
    });

    it('should add a target with retry policy and DLQ', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({ FailedEntryCount: 0 });

      const result = await manager.addTarget({
        ruleName: 'my-rule',
        targetId: 'my-target',
        targetArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-function',
        targetType: 'lambda',
        retryPolicy: {
          maximumRetryAttempts: 3,
          maximumEventAgeInSeconds: 3600,
        },
        deadLetterQueueArn: 'arn:aws:sqs:us-east-1:123456789012:my-dlq',
      });

      expect(result.success).toBe(true);
    });

    it('should handle target addition failure', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        FailedEntryCount: 1,
        FailedEntries: [{ ErrorMessage: 'Invalid ARN' }],
      });

      const result = await manager.addTarget({
        ruleName: 'my-rule',
        targetId: 'my-target',
        targetArn: 'invalid-arn',
        targetType: 'lambda',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid ARN');
    });

    it('should remove a target from a rule', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({ FailedEntryCount: 0 });

      const result = await manager.removeTarget('my-rule', 'my-target');

      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // Schedule Tests
  // =============================================================================

  describe('Schedule Management', () => {
    it('should list schedules', async () => {
      mockSchedulerSend.mockResolvedValueOnce({
        Schedules: [
          {
            Name: 'schedule-1',
            Arn: 'arn:aws:scheduler:us-east-1:123456789012:schedule/default/schedule-1',
            GroupName: 'default',
            State: 'ENABLED',
            Target: { Arn: 'arn:aws:lambda:us-east-1:123456789012:function:my-function' },
          },
        ],
      });

      const result = await manager.listSchedules();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('should get a schedule', async () => {
      mockSchedulerSend.mockResolvedValueOnce({
        Name: 'my-schedule',
        Arn: 'arn:aws:scheduler:us-east-1:123456789012:schedule/default/my-schedule',
        GroupName: 'default',
        ScheduleExpression: 'rate(1 hour)',
        State: 'ENABLED',
        Target: {
          Arn: 'arn:aws:lambda:us-east-1:123456789012:function:my-function',
          RoleArn: 'arn:aws:iam::123456789012:role/my-role',
        },
        FlexibleTimeWindow: { Mode: 'OFF' },
      });

      const result = await manager.getSchedule('my-schedule');

      expect(result.success).toBe(true);
      expect(result.data?.scheduleExpression).toBe('rate(1 hour)');
    });

    it('should create a schedule', async () => {
      mockSchedulerSend.mockResolvedValueOnce({
        ScheduleArn: 'arn:aws:scheduler:us-east-1:123456789012:schedule/default/new-schedule',
      });

      const options: CreateScheduleOptions = {
        name: 'new-schedule',
        scheduleExpression: 'rate(5 minutes)',
        targetArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-function',
        targetRoleArn: 'arn:aws:iam::123456789012:role/my-role',
      };

      const result = await manager.createSchedule(options);

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('new-schedule');
    });

    it('should update a schedule', async () => {
      // First call: get existing schedule
      mockSchedulerSend.mockResolvedValueOnce({
        Name: 'my-schedule',
        GroupName: 'default',
        ScheduleExpression: 'rate(1 hour)',
        State: 'ENABLED',
        Target: {
          Arn: 'arn:aws:lambda:us-east-1:123456789012:function:my-function',
          RoleArn: 'arn:aws:iam::123456789012:role/my-role',
        },
        FlexibleTimeWindow: { Mode: 'OFF' },
      });
      // Second call: update schedule
      mockSchedulerSend.mockResolvedValueOnce({
        ScheduleArn: 'arn:aws:scheduler:us-east-1:123456789012:schedule/default/my-schedule',
      });

      const result = await manager.updateSchedule('my-schedule', {
        scheduleExpression: 'rate(30 minutes)',
      });

      expect(result.success).toBe(true);
    });

    it('should delete a schedule', async () => {
      mockSchedulerSend.mockResolvedValueOnce({});

      const result = await manager.deleteSchedule('my-schedule');

      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // State Machine Tests
  // =============================================================================

  describe('State Machine Management', () => {
    it('should list state machines', async () => {
      mockSfnSend.mockResolvedValueOnce({
        stateMachines: [
          {
            stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:sm-1',
            name: 'sm-1',
            type: 'STANDARD',
            creationDate: new Date(),
          },
        ],
      });

      const result = await manager.listStateMachines();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('should get a state machine', async () => {
      mockSfnSend.mockResolvedValueOnce({
        stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:my-sm',
        name: 'my-sm',
        type: 'STANDARD',
        status: 'ACTIVE',
        roleArn: 'arn:aws:iam::123456789012:role/my-role',
        definition: '{"StartAt":"Hello","States":{"Hello":{"Type":"Pass","End":true}}}',
        creationDate: new Date(),
      });

      const result = await manager.getStateMachine('arn:aws:states:us-east-1:123456789012:stateMachine:my-sm');

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('my-sm');
      expect(result.data?.definition).toContain('Hello');
    });

    it('should create a state machine', async () => {
      mockSfnSend.mockResolvedValueOnce({
        stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:new-sm',
        creationDate: new Date(),
      });

      const options: CreateStateMachineOptions = {
        name: 'new-sm',
        roleArn: 'arn:aws:iam::123456789012:role/my-role',
        definition: {
          StartAt: 'Hello',
          States: {
            Hello: { Type: 'Pass', End: true },
          },
        },
      };

      const result = await manager.createStateMachine(options);

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('new-sm');
    });

    it('should create a state machine with logging and tracing', async () => {
      mockSfnSend.mockResolvedValueOnce({
        stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:traced-sm',
        creationDate: new Date(),
      });

      const options: CreateStateMachineOptions = {
        name: 'traced-sm',
        roleArn: 'arn:aws:iam::123456789012:role/my-role',
        definition: {
          StartAt: 'Hello',
          States: {
            Hello: { Type: 'Pass', End: true },
          },
        },
        loggingConfiguration: {
          level: 'ALL',
          includeExecutionData: true,
          logGroupArn: 'arn:aws:logs:us-east-1:123456789012:log-group:my-logs',
        },
        enableTracing: true,
      };

      const result = await manager.createStateMachine(options);

      expect(result.success).toBe(true);
    });

    it('should update a state machine', async () => {
      mockSfnSend.mockResolvedValueOnce({
        updateDate: new Date(),
      });
      // Get call for updated state machine
      mockSfnSend.mockResolvedValueOnce({
        stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:my-sm',
        name: 'my-sm',
        type: 'STANDARD',
        status: 'ACTIVE',
        roleArn: 'arn:aws:iam::123456789012:role/my-role',
        creationDate: new Date(),
      });

      const result = await manager.updateStateMachine(
        'arn:aws:states:us-east-1:123456789012:stateMachine:my-sm',
        {
          definition: {
            StartAt: 'Updated',
            States: {
              Updated: { Type: 'Pass', End: true },
            },
          },
        }
      );

      expect(result.success).toBe(true);
    });

    it('should delete a state machine', async () => {
      mockSfnSend.mockResolvedValueOnce({});

      const result = await manager.deleteStateMachine('arn:aws:states:us-east-1:123456789012:stateMachine:my-sm');

      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // Execution Tests
  // =============================================================================

  describe('Execution Management', () => {
    it('should start an execution', async () => {
      mockSfnSend.mockResolvedValueOnce({
        executionArn: 'arn:aws:states:us-east-1:123456789012:execution:my-sm:exec-1',
        startDate: new Date(),
      });

      const result = await manager.startExecution({
        stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:my-sm',
        input: { key: 'value' },
      });

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('RUNNING');
    });

    it('should stop an execution', async () => {
      mockSfnSend.mockResolvedValueOnce({
        stopDate: new Date(),
      });

      const result = await manager.stopExecution(
        'arn:aws:states:us-east-1:123456789012:execution:my-sm:exec-1',
        'ManualStop',
        'Stopped by user'
      );

      expect(result.success).toBe(true);
    });

    it('should list executions', async () => {
      mockSfnSend.mockResolvedValueOnce({
        executions: [
          {
            executionArn: 'arn:aws:states:us-east-1:123456789012:execution:my-sm:exec-1',
            stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:my-sm',
            name: 'exec-1',
            status: 'SUCCEEDED',
            startDate: new Date(),
            stopDate: new Date(),
          },
        ],
      });

      const result = await manager.listExecutions({
        stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:my-sm',
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('should get execution details', async () => {
      mockSfnSend.mockResolvedValueOnce({
        executionArn: 'arn:aws:states:us-east-1:123456789012:execution:my-sm:exec-1',
        stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:my-sm',
        name: 'exec-1',
        status: 'SUCCEEDED',
        startDate: new Date(),
        stopDate: new Date(),
        input: '{"key":"value"}',
        output: '{"result":"success"}',
      });

      const result = await manager.getExecution(
        'arn:aws:states:us-east-1:123456789012:execution:my-sm:exec-1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('SUCCEEDED');
      expect(result.data?.output).toContain('success');
    });
  });

  // =============================================================================
  // Workflow Builder Tests
  // =============================================================================

  describe('Workflow Builder', () => {
    it('should convert a simple workflow to ASL', () => {
      const workflow: WorkflowDefinition = {
        name: 'simple-workflow',
        description: 'A simple test workflow',
        startAt: 'Step1',
        steps: [
          {
            name: 'Step1',
            type: 'pass',
            description: 'First step',
            result: { message: 'Hello' },
            next: 'Step2',
          },
          {
            name: 'Step2',
            type: 'succeed',
          },
        ],
      };

      const asl = manager.convertToASL(workflow);

      expect(asl.StartAt).toBe('Step1');
      expect(asl.States.Step1.Type).toBe('Pass');
      expect(asl.States.Step2.Type).toBe('Succeed');
    });

    it('should convert a workflow with Lambda tasks', () => {
      const workflow: WorkflowDefinition = {
        name: 'lambda-workflow',
        startAt: 'InvokeLambda',
        steps: [
          {
            name: 'InvokeLambda',
            type: 'lambda',
            resourceArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-function',
            retry: {
              maxAttempts: 3,
              intervalSeconds: 5,
              backoffRate: 2,
            },
            isEnd: true,
          },
        ],
      };

      const asl = manager.convertToASL(workflow);

      expect(asl.States.InvokeLambda.Type).toBe('Task');
      expect(asl.States.InvokeLambda.Retry).toBeDefined();
      expect(asl.States.InvokeLambda.Retry?.[0].MaxAttempts).toBe(3);
    });

    it('should convert a workflow with choice state', () => {
      const workflow: WorkflowDefinition = {
        name: 'choice-workflow',
        startAt: 'CheckValue',
        steps: [
          {
            name: 'CheckValue',
            type: 'choice',
            conditions: [
              {
                variable: '$.value',
                operator: 'greater-than',
                value: 10,
                next: 'HighValue',
              },
            ],
            defaultNext: 'LowValue',
          },
          {
            name: 'HighValue',
            type: 'succeed',
          },
          {
            name: 'LowValue',
            type: 'succeed',
          },
        ],
      };

      const asl = manager.convertToASL(workflow);

      expect(asl.States.CheckValue.Type).toBe('Choice');
      expect(asl.States.CheckValue.Choices).toHaveLength(1);
      expect(asl.States.CheckValue.Default).toBe('LowValue');
    });

    it('should convert a workflow with parallel branches', () => {
      const workflow: WorkflowDefinition = {
        name: 'parallel-workflow',
        startAt: 'ParallelStep',
        steps: [
          {
            name: 'ParallelStep',
            type: 'parallel',
            branches: [
              [
                { name: 'Branch1Step', type: 'pass', isEnd: true },
              ],
              [
                { name: 'Branch2Step', type: 'pass', isEnd: true },
              ],
            ],
            isEnd: true,
          },
        ],
      };

      const asl = manager.convertToASL(workflow);

      expect(asl.States.ParallelStep.Type).toBe('Parallel');
      expect(asl.States.ParallelStep.Branches).toHaveLength(2);
    });

    it('should convert a workflow with map state', () => {
      const workflow: WorkflowDefinition = {
        name: 'map-workflow',
        startAt: 'ProcessItems',
        steps: [
          {
            name: 'ProcessItems',
            type: 'map',
            itemsPath: '$.items',
            maxConcurrency: 5,
            iterator: [
              {
                name: 'ProcessItem',
                type: 'lambda',
                resourceArn: 'arn:aws:lambda:us-east-1:123456789012:function:process',
                isEnd: true,
              },
            ],
            isEnd: true,
          },
        ],
      };

      const asl = manager.convertToASL(workflow);

      expect(asl.States.ProcessItems.Type).toBe('Map');
      expect(asl.States.ProcessItems.MaxConcurrency).toBe(5);
    });

    it('should build and create a workflow', async () => {
      mockSfnSend.mockResolvedValueOnce({
        stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:built-workflow',
        creationDate: new Date(),
      });

      const options: BuildWorkflowOptions = {
        workflow: {
          name: 'built-workflow',
          startAt: 'Start',
          steps: [
            { name: 'Start', type: 'pass', isEnd: true },
          ],
        },
        roleArn: 'arn:aws:iam::123456789012:role/my-role',
      };

      const result = await manager.buildWorkflow(options);

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('built-workflow');
    });
  });

  // =============================================================================
  // Automated Remediation Tests
  // =============================================================================

  describe('Automated Remediation', () => {
    it('should setup a remediation for config rule', async () => {
      // Mock event rule creation
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/remediation-trigger',
      });
      // Mock target addition
      mockEventBridgeSend.mockResolvedValueOnce({ FailedEntryCount: 0 });

      const options: SetupRemediationOptions = {
        name: 'fix-public-s3',
        description: 'Block public access on S3 buckets',
        triggerType: 'config-rule',
        triggerConfig: {
          configRuleName: 's3-bucket-public-read-prohibited',
        },
        actionType: 'lambda',
        actionConfig: {
          lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:fix-s3',
        },
        automatic: true,
      };

      const result = await manager.setupRemediation(options);

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('fix-public-s3');
      expect(result.data?.automatic).toBe(true);
    });

    it('should setup a remediation for GuardDuty findings', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/guardduty-remediation',
      });

      const options: SetupRemediationOptions = {
        name: 'fix-guardduty',
        triggerType: 'guardduty-finding',
        triggerConfig: {
          guardDutyFindingType: 'UnauthorizedAccess:EC2/SSHBruteForce',
        },
        actionType: 'step-functions',
        actionConfig: {
          stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:fix-guardduty',
        },
        automatic: false,
      };

      const result = await manager.setupRemediation(options);

      expect(result.success).toBe(true);
      expect(result.data?.triggerType).toBe('guardduty-finding');
    });

    it('should list remediations', async () => {
      // Setup a remediation first
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/test-rule',
      });
      mockEventBridgeSend.mockResolvedValueOnce({ FailedEntryCount: 0 });

      await manager.setupRemediation({
        name: 'test-remediation',
        triggerType: 'config-rule',
        triggerConfig: { configRuleName: 'test-rule' },
        actionType: 'lambda',
        actionConfig: { lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:test' },
        automatic: true,
      });

      const result = await manager.listRemediations();

      expect(result.success).toBe(true);
      expect(result.data?.length).toBeGreaterThan(0);
    });

    it('should get a specific remediation', async () => {
      // Setup a remediation first
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/test-rule',
      });
      mockEventBridgeSend.mockResolvedValueOnce({ FailedEntryCount: 0 });

      const setupResult = await manager.setupRemediation({
        name: 'get-test',
        triggerType: 'config-rule',
        triggerConfig: { configRuleName: 'test-rule' },
        actionType: 'lambda',
        actionConfig: { lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:test' },
        automatic: true,
      });

      const result = await manager.getRemediation(setupResult.data!.id);

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('get-test');
    });

    it('should update a remediation', async () => {
      // Setup a remediation first
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/test-rule',
      });
      mockEventBridgeSend.mockResolvedValueOnce({ FailedEntryCount: 0 });

      const setupResult = await manager.setupRemediation({
        name: 'update-test',
        triggerType: 'config-rule',
        triggerConfig: { configRuleName: 'test-rule' },
        actionType: 'lambda',
        actionConfig: { lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:test' },
        automatic: true,
      });

      // Mock disable rule (automatic: false)
      mockEventBridgeSend.mockResolvedValueOnce({});

      const result = await manager.updateRemediation(setupResult.data!.id, {
        automatic: false,
        description: 'Updated description',
      });

      expect(result.success).toBe(true);
      expect(result.data?.automatic).toBe(false);
    });

    it('should enable a remediation', async () => {
      // Setup a remediation first
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/test-rule',
      });
      mockEventBridgeSend.mockResolvedValueOnce({ FailedEntryCount: 0 });

      const setupResult = await manager.setupRemediation({
        name: 'enable-test',
        triggerType: 'config-rule',
        triggerConfig: { configRuleName: 'test-rule' },
        actionType: 'lambda',
        actionConfig: { lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:test' },
        automatic: true,
      });

      // Mock enable rule
      mockEventBridgeSend.mockResolvedValueOnce({});

      const result = await manager.enableRemediation(setupResult.data!.id);

      expect(result.success).toBe(true);
    });

    it('should disable a remediation', async () => {
      // Setup a remediation first
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/test-rule',
      });
      mockEventBridgeSend.mockResolvedValueOnce({ FailedEntryCount: 0 });

      const setupResult = await manager.setupRemediation({
        name: 'disable-test',
        triggerType: 'config-rule',
        triggerConfig: { configRuleName: 'test-rule' },
        actionType: 'lambda',
        actionConfig: { lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:test' },
        automatic: true,
      });

      // Mock disable rule
      mockEventBridgeSend.mockResolvedValueOnce({});

      const result = await manager.disableRemediation(setupResult.data!.id);

      expect(result.success).toBe(true);
    });

    it('should delete a remediation', async () => {
      // Setup a remediation first
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/test-rule',
      });
      mockEventBridgeSend.mockResolvedValueOnce({ FailedEntryCount: 0 });

      const setupResult = await manager.setupRemediation({
        name: 'delete-test',
        triggerType: 'config-rule',
        triggerConfig: { configRuleName: 'test-rule' },
        actionType: 'lambda',
        actionConfig: { lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:test' },
        automatic: true,
      });

      // Mock list targets (empty), delete rule
      mockEventBridgeSend.mockResolvedValueOnce({ Targets: [] });
      mockEventBridgeSend.mockResolvedValueOnce({});

      const result = await manager.deleteRemediation(setupResult.data!.id);

      expect(result.success).toBe(true);
    });

    it('should trigger a remediation manually', async () => {
      // Setup a remediation first
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/test-rule',
      });
      mockEventBridgeSend.mockResolvedValueOnce({ FailedEntryCount: 0 });

      const setupResult = await manager.setupRemediation({
        name: 'trigger-test',
        triggerType: 'config-rule',
        triggerConfig: { configRuleName: 'test-rule' },
        actionType: 'step-functions',
        actionConfig: { stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:sm' },
        automatic: false,
      });

      // Mock start execution
      mockSfnSend.mockResolvedValueOnce({
        executionArn: 'arn:aws:states:us-east-1:123456789012:execution:sm:exec-1',
        startDate: new Date(),
      });

      const result = await manager.triggerRemediation(setupResult.data!.id, 'resource-123');

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('IN_PROGRESS');
    });
  });

  // =============================================================================
  // Event Archive and Replay Tests
  // =============================================================================

  describe('Event Archive and Replay', () => {
    it('should list event archives', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        Archives: [
          {
            ArchiveName: 'my-archive',
            EventSourceArn: 'arn:aws:events:us-east-1:123456789012:event-bus/default',
            State: 'ENABLED',
            EventCount: 1000,
            SizeBytes: 50000,
            CreationTime: new Date(),
          },
        ],
      });

      const result = await manager.listEventArchives();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].eventCount).toBe(1000);
    });

    it('should create an event archive', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        ArchiveArn: 'arn:aws:events:us-east-1:123456789012:archive/new-archive',
        State: 'CREATING',
        CreationTime: new Date(),
      });

      const result = await manager.createEventArchive({
        archiveName: 'new-archive',
        eventSourceArn: 'arn:aws:events:us-east-1:123456789012:event-bus/default',
        description: 'My archive',
        retentionDays: 90,
      });

      expect(result.success).toBe(true);
      expect(result.data?.archiveName).toBe('new-archive');
    });

    it('should create an event archive with filter pattern', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        ArchiveArn: 'arn:aws:events:us-east-1:123456789012:archive/filtered-archive',
        State: 'CREATING',
        CreationTime: new Date(),
      });

      const result = await manager.createEventArchive({
        archiveName: 'filtered-archive',
        eventSourceArn: 'arn:aws:events:us-east-1:123456789012:event-bus/default',
        eventPattern: {
          source: ['aws.ec2'],
        },
        retentionDays: 30,
      });

      expect(result.success).toBe(true);
    });

    it('should delete an event archive', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({});

      const result = await manager.deleteEventArchive('my-archive');

      expect(result.success).toBe(true);
    });

    it('should start an event replay', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        ReplayArn: 'arn:aws:events:us-east-1:123456789012:replay/my-replay',
        State: 'STARTING',
        ReplayStartTime: new Date(),
      });

      const result = await manager.startReplay({
        replayName: 'my-replay',
        eventSourceArn: 'arn:aws:events:us-east-1:123456789012:archive/my-archive',
        destinationArn: 'arn:aws:events:us-east-1:123456789012:event-bus/default',
        eventStartTime: new Date(Date.now() - 86400000), // 24 hours ago
        eventEndTime: new Date(),
      });

      expect(result.success).toBe(true);
      expect(result.data?.state).toBe('STARTING');
    });

    it('should cancel an event replay', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        State: 'CANCELLING',
      });

      const result = await manager.cancelReplay('my-replay');

      expect(result.success).toBe(true);
    });

    it('should get replay status', async () => {
      mockEventBridgeSend.mockResolvedValueOnce({
        ReplayName: 'my-replay',
        ReplayArn: 'arn:aws:events:us-east-1:123456789012:replay/my-replay',
        EventSourceArn: 'arn:aws:events:us-east-1:123456789012:archive/my-archive',
        State: 'COMPLETED',
        Destination: {
          Arn: 'arn:aws:events:us-east-1:123456789012:event-bus/default',
        },
        EventStartTime: new Date(Date.now() - 86400000),
        EventEndTime: new Date(),
        ReplayStartTime: new Date(),
        ReplayEndTime: new Date(),
      });

      const result = await manager.getReplayStatus('my-replay');

      expect(result.success).toBe(true);
      expect(result.data?.state).toBe('COMPLETED');
    });
  });

  // =============================================================================
  // Utility Method Tests
  // =============================================================================

  describe('Utility Methods', () => {
    describe('Predefined Event Patterns', () => {
      it('should get a predefined event pattern', () => {
        const pattern = manager.getPredefinedPattern('ec2-instance-state-change');

        expect(pattern).not.toBeNull();
        expect(pattern?.source).toContain('aws.ec2');
      });

      it('should return null for unknown pattern', () => {
        const pattern = manager.getPredefinedPattern('unknown-pattern');

        expect(pattern).toBeNull();
      });

      it('should list all predefined patterns', () => {
        const patterns = manager.listPredefinedPatterns();

        expect(patterns.length).toBeGreaterThan(0);
        expect(patterns.some(p => p.id === 'ec2-instance-state-change')).toBe(true);
        expect(patterns.some(p => p.id === 'guardduty-finding')).toBe(true);
        expect(patterns.some(p => p.id === 's3-bucket-created')).toBe(true);
      });
    });

    describe('Schedule Expressions', () => {
      it('should get a schedule expression', () => {
        const expr = manager.getScheduleExpression('every-hour');

        expect(expr).toBe('rate(1 hour)');
      });

      it('should return null for unknown expression', () => {
        const expr = manager.getScheduleExpression('unknown-expression');

        expect(expr).toBeNull();
      });

      it('should list all schedule expressions', () => {
        const expressions = manager.listScheduleExpressions();

        expect(expressions.length).toBeGreaterThan(0);
        expect(expressions.some(e => e.id === 'every-minute')).toBe(true);
        expect(expressions.some(e => e.id === 'weekdays-9am')).toBe(true);
      });
    });

    describe('Workflow Templates', () => {
      it('should get a workflow template', () => {
        const template = manager.getWorkflowTemplate('notify-on-event');

        expect(template).not.toBeNull();
        expect(template?.name).toBe('notify-on-event');
      });

      it('should return null for unknown template', () => {
        const template = manager.getWorkflowTemplate('unknown-template');

        expect(template).toBeNull();
      });

      it('should list all workflow templates', () => {
        const templates = manager.listWorkflowTemplates();

        expect(templates.length).toBeGreaterThan(0);
        expect(templates.some(t => t.id === 'notify-on-event')).toBe(true);
        expect(templates.some(t => t.id === 'retry-with-backoff')).toBe(true);
        expect(templates.some(t => t.id === 'parallel-processing')).toBe(true);
      });
    });
  });

  // =============================================================================
  // Predefined Constants Tests
  // =============================================================================

  describe('Predefined Constants', () => {
    it('should have predefined event patterns defined', () => {
      expect(Object.keys(PREDEFINED_EVENT_PATTERNS).length).toBeGreaterThan(20);
      expect(PREDEFINED_EVENT_PATTERNS['ec2-instance-state-change']).toBeDefined();
      expect(PREDEFINED_EVENT_PATTERNS['guardduty-high-severity']).toBeDefined();
      expect(PREDEFINED_EVENT_PATTERNS['config-non-compliant']).toBeDefined();
    });

    it('should have schedule expressions defined', () => {
      expect(Object.keys(SCHEDULE_EXPRESSIONS).length).toBeGreaterThan(10);
      expect(SCHEDULE_EXPRESSIONS['every-minute']).toBeDefined();
      expect(SCHEDULE_EXPRESSIONS['weekdays-9am']).toBeDefined();
      expect(SCHEDULE_EXPRESSIONS['every-month']).toBeDefined();
    });

    it('should have workflow templates defined', () => {
      expect(Object.keys(WORKFLOW_TEMPLATES).length).toBeGreaterThan(3);
      expect(WORKFLOW_TEMPLATES['notify-on-event']).toBeDefined();
      expect(WORKFLOW_TEMPLATES['approve-and-execute']).toBeDefined();
      expect(WORKFLOW_TEMPLATES['scheduled-cleanup']).toBeDefined();
    });
  });

  // =============================================================================
  // Error Handling Tests
  // =============================================================================

  describe('Error Handling', () => {
    it('should handle EventBridge API errors', async () => {
      mockEventBridgeSend.mockRejectedValueOnce(new Error('Service unavailable'));

      const result = await manager.listEventRules();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Service unavailable');
    });

    it('should handle Scheduler API errors', async () => {
      mockSchedulerSend.mockRejectedValueOnce(new Error('Invalid schedule expression'));

      const result = await manager.createSchedule({
        name: 'invalid-schedule',
        scheduleExpression: 'invalid',
        targetArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
        targetRoleArn: 'arn:aws:iam::123456789012:role/test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid schedule expression');
    });

    it('should handle Step Functions API errors', async () => {
      mockSfnSend.mockRejectedValueOnce(new Error('State machine not found'));

      const result = await manager.getStateMachine('invalid-arn');

      expect(result.success).toBe(false);
      expect(result.error).toContain('State machine not found');
    });

    it('should handle remediation not found', async () => {
      const result = await manager.getRemediation('non-existent-id');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // =============================================================================
  // Integration Scenario Tests
  // =============================================================================

  describe('Integration Scenarios', () => {
    it('should create a complete event-driven automation pipeline', async () => {
      // 1. Create event rule
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/pipeline-rule',
      });

      const ruleResult = await manager.createEventRule({
        name: 'pipeline-rule',
        eventPattern: PREDEFINED_EVENT_PATTERNS['ec2-instance-stopped'].pattern,
        state: 'ENABLED',
      });

      expect(ruleResult.success).toBe(true);

      // 2. Create state machine for processing
      mockSfnSend.mockResolvedValueOnce({
        stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:pipeline-sm',
        creationDate: new Date(),
      });

      const smResult = await manager.createStateMachine({
        name: 'pipeline-sm',
        roleArn: 'arn:aws:iam::123456789012:role/sm-role',
        definition: {
          StartAt: 'ProcessEvent',
          States: {
            ProcessEvent: {
              Type: 'Task',
              Resource: 'arn:aws:lambda:us-east-1:123456789012:function:process',
              End: true,
            },
          },
        },
      });

      expect(smResult.success).toBe(true);

      // 3. Add state machine as target
      mockEventBridgeSend.mockResolvedValueOnce({ FailedEntryCount: 0 });

      const targetResult = await manager.addTarget({
        ruleName: 'pipeline-rule',
        targetId: 'sm-target',
        targetArn: smResult.data!.arn,
        targetType: 'step-functions',
        roleArn: 'arn:aws:iam::123456789012:role/invoke-role',
      });

      expect(targetResult.success).toBe(true);

      // 4. Create archive for event replay
      mockEventBridgeSend.mockResolvedValueOnce({
        ArchiveArn: 'arn:aws:events:us-east-1:123456789012:archive/pipeline-archive',
        State: 'ENABLED',
        CreationTime: new Date(),
      });

      const archiveResult = await manager.createEventArchive({
        archiveName: 'pipeline-archive',
        eventSourceArn: 'arn:aws:events:us-east-1:123456789012:event-bus/default',
        eventPattern: PREDEFINED_EVENT_PATTERNS['ec2-instance-stopped'].pattern,
        retentionDays: 30,
      });

      expect(archiveResult.success).toBe(true);
    });

    it('should set up automated security remediation', async () => {
      // 1. Setup remediation for GuardDuty findings
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/security-remediation',
      });

      const remediation1Result = await manager.setupRemediation({
        name: 'guardduty-auto-remediate',
        description: 'Auto-remediate high severity GuardDuty findings',
        triggerType: 'guardduty-finding',
        triggerConfig: {
          guardDutyFindingType: 'UnauthorizedAccess:EC2/SSHBruteForce',
        },
        actionType: 'ssm-automation',
        actionConfig: {
          documentName: 'AWS-StopEC2Instance',
        },
        automatic: true,
      });

      expect(remediation1Result.success).toBe(true);

      // 2. Setup remediation for Security Hub critical findings
      mockEventBridgeSend.mockResolvedValueOnce({
        RuleArn: 'arn:aws:events:us-east-1:123456789012:rule/securityhub-remediation',
      });

      const remediation2Result = await manager.setupRemediation({
        name: 'securityhub-auto-remediate',
        description: 'Auto-remediate Security Hub critical findings',
        triggerType: 'securityhub-finding',
        triggerConfig: {
          securityHubFindingType: 'Software and Configuration Checks/AWS Security Best Practices',
        },
        actionType: 'lambda',
        actionConfig: {
          lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:remediate-finding',
        },
        automatic: true,
      });

      expect(remediation2Result.success).toBe(true);

      // 3. List all remediations
      const listResult = await manager.listRemediations();

      expect(listResult.success).toBe(true);
      expect(listResult.data?.length).toBeGreaterThanOrEqual(2);
    });

    it('should create scheduled maintenance workflow', async () => {
      // 1. Build maintenance workflow
      mockSfnSend.mockResolvedValueOnce({
        stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:maintenance-workflow',
        creationDate: new Date(),
      });

      const template = manager.getWorkflowTemplate('scheduled-cleanup');
      expect(template).not.toBeNull();

      const workflowResult = await manager.buildWorkflow({
        workflow: template!,
        roleArn: 'arn:aws:iam::123456789012:role/maintenance-role',
        enableLogging: true,
        enableTracing: true,
        tags: {
          Purpose: 'Maintenance',
          Environment: 'Production',
        },
      });

      expect(workflowResult.success).toBe(true);

      // 2. Create schedule to run workflow weekly
      mockSchedulerSend.mockResolvedValueOnce({
        ScheduleArn: 'arn:aws:scheduler:us-east-1:123456789012:schedule/default/weekly-maintenance',
      });

      const scheduleExpr = manager.getScheduleExpression('every-week');
      expect(scheduleExpr).not.toBeNull();

      const scheduleResult = await manager.createSchedule({
        name: 'weekly-maintenance',
        description: 'Run maintenance workflow every week',
        scheduleExpression: scheduleExpr!,
        targetArn: workflowResult.data!.arn,
        targetRoleArn: 'arn:aws:iam::123456789012:role/scheduler-role',
        targetInput: JSON.stringify({ source: 'scheduled' }),
      });

      expect(scheduleResult.success).toBe(true);
    });
  });
});
