/**
 * AWS Event-Driven Automation Manager
 *
 * Manages EventBridge rules, Step Functions workflows, automated remediation,
 * scheduling, and event archives/replay.
 */

import {
  EventBridgeClient,
  ListEventBusesCommand,
  CreateEventBusCommand,
  DeleteEventBusCommand,
  ListRulesCommand,
  DescribeRuleCommand,
  PutRuleCommand,
  DeleteRuleCommand,
  EnableRuleCommand,
  DisableRuleCommand,
  ListTargetsByRuleCommand,
  PutTargetsCommand,
  RemoveTargetsCommand,
  ListArchivesCommand,
  CreateArchiveCommand,
  DeleteArchiveCommand,
  DescribeArchiveCommand,
  StartReplayCommand,
  CancelReplayCommand,
  DescribeReplayCommand,
  TagResourceCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-eventbridge';

import {
  SchedulerClient,
  ListSchedulesCommand,
  GetScheduleCommand,
  CreateScheduleCommand,
  UpdateScheduleCommand,
  DeleteScheduleCommand,
  ListScheduleGroupsCommand,
} from '@aws-sdk/client-scheduler';

import {
  SFNClient,
  ListStateMachinesCommand,
  DescribeStateMachineCommand,
  CreateStateMachineCommand,
  UpdateStateMachineCommand,
  DeleteStateMachineCommand,
  StartExecutionCommand,
  StopExecutionCommand,
  ListExecutionsCommand,
  DescribeExecutionCommand,
} from '@aws-sdk/client-sfn';

import {
  ConfigServiceClient,
  PutRemediationConfigurationsCommand,
  DeleteRemediationConfigurationCommand,
  DescribeRemediationConfigurationsCommand,
  StartRemediationExecutionCommand,
  DescribeRemediationExecutionStatusCommand,
} from '@aws-sdk/client-config-service';

import type {
  AutomationManager,
  AutomationManagerConfig,
  AutomationOperationResult,
  EventBusInfo,
  EventRuleInfo,
  EventRuleState,
  EventTargetInfo,
  EventPattern,
  CreateEventRuleOptions,
  AddTargetOptions,
  ListEventRulesOptions,
  ScheduleInfo,
  ScheduleState,
  CreateScheduleOptions,
  ListSchedulesOptions,
  StateMachineInfo,
  StateMachineType,
  ExecutionInfo,
  ExecutionStatus,
  CreateStateMachineOptions,
  StartExecutionOptions,
  ListExecutionsOptions,
  ListStateMachinesOptions,
  ASLDefinition,
  ASLState,
  WorkflowDefinition,
  WorkflowStep,
  WorkflowCondition,
  BuildWorkflowOptions,
  RemediationConfig,
  RemediationTriggerType,
  RemediationExecution,
  SetupRemediationOptions,
  ListRemediationsOptions,
  EventArchiveInfo,
  EventReplayInfo,
  CreateEventArchiveOptions,
  StartEventReplayOptions,
  ListEventArchivesOptions,
} from './types.js';

import {
  PREDEFINED_EVENT_PATTERNS,
  SCHEDULE_EXPRESSIONS,
  WORKFLOW_TEMPLATES,
} from './types.js';

/**
 * AWS Event-Driven Automation Manager Implementation
 */
export class AWSAutomationManager implements AutomationManager {
  private eventBridgeClient: EventBridgeClient;
  private schedulerClient: SchedulerClient;
  private sfnClient: SFNClient;
  private configClient: ConfigServiceClient;
  private config: AutomationManagerConfig;
  private remediationStore: Map<string, RemediationConfig> = new Map();

  constructor(config: AutomationManagerConfig = {}) {
    this.config = config;

    const clientConfig = {
      region: config.defaultRegion || 'us-east-1',
      ...(config.credentials && { credentials: config.credentials }),
    };

    this.eventBridgeClient = new EventBridgeClient(clientConfig);
    this.schedulerClient = new SchedulerClient(clientConfig);
    this.sfnClient = new SFNClient(clientConfig);
    this.configClient = new ConfigServiceClient(clientConfig);
  }

  // =============================================================================
  // Event Buses
  // =============================================================================

  /**
   * List all event buses
   */
  async listEventBuses(): Promise<AutomationOperationResult<EventBusInfo[]>> {
    try {
      const command = new ListEventBusesCommand({});
      const response = await this.eventBridgeClient.send(command);

      const buses: EventBusInfo[] = (response.EventBuses || []).map(bus => ({
        name: bus.Name || '',
        arn: bus.Arn || '',
        description: undefined,
        policy: bus.Policy,
        isDefault: bus.Name === 'default',
      }));

      return {
        success: true,
        data: buses,
        message: `Found ${buses.length} event bus(es)`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list event buses: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Create a new event bus
   */
  async createEventBus(
    name: string,
    description?: string
  ): Promise<AutomationOperationResult<EventBusInfo>> {
    try {
      const command = new CreateEventBusCommand({
        Name: name,
        Tags: description ? [{ Key: 'Description', Value: description }] : undefined,
      });
      const response = await this.eventBridgeClient.send(command);

      const bus: EventBusInfo = {
        name,
        arn: response.EventBusArn || '',
        description,
        isDefault: false,
        createdAt: new Date(),
      };

      return {
        success: true,
        data: bus,
        message: `Event bus '${name}' created successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create event bus: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Delete an event bus
   */
  async deleteEventBus(name: string): Promise<AutomationOperationResult<void>> {
    try {
      // Cannot delete the default event bus
      if (name === 'default') {
        return {
          success: false,
          error: 'Cannot delete the default event bus',
        };
      }

      const command = new DeleteEventBusCommand({ Name: name });
      await this.eventBridgeClient.send(command);

      return {
        success: true,
        message: `Event bus '${name}' deleted successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete event bus: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // =============================================================================
  // Event Rules
  // =============================================================================

  /**
   * List event rules
   */
  async listEventRules(
    options: ListEventRulesOptions = {}
  ): Promise<AutomationOperationResult<EventRuleInfo[]>> {
    try {
      const command = new ListRulesCommand({
        EventBusName: options.eventBusName || this.config.defaultEventBus || 'default',
        NamePrefix: options.namePrefix,
        Limit: options.limit,
        NextToken: options.nextToken,
      });
      const response = await this.eventBridgeClient.send(command);

      const rules: EventRuleInfo[] = (response.Rules || []).map(rule => ({
        name: rule.Name || '',
        arn: rule.Arn || '',
        description: rule.Description,
        eventBusName: rule.EventBusName || 'default',
        eventPattern: rule.EventPattern,
        scheduleExpression: rule.ScheduleExpression,
        state: (rule.State as EventRuleState) || 'DISABLED',
        managedBy: rule.ManagedBy,
        roleArn: rule.RoleArn,
      }));

      return {
        success: true,
        data: rules,
        message: `Found ${rules.length} event rule(s)`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list event rules: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get details of a specific event rule
   */
  async getEventRule(
    name: string,
    eventBusName?: string
  ): Promise<AutomationOperationResult<EventRuleInfo>> {
    try {
      const command = new DescribeRuleCommand({
        Name: name,
        EventBusName: eventBusName || this.config.defaultEventBus || 'default',
      });
      const response = await this.eventBridgeClient.send(command);

      const rule: EventRuleInfo = {
        name: response.Name || name,
        arn: response.Arn || '',
        description: response.Description,
        eventBusName: response.EventBusName || 'default',
        eventPattern: response.EventPattern,
        scheduleExpression: response.ScheduleExpression,
        state: (response.State as EventRuleState) || 'DISABLED',
        managedBy: response.ManagedBy,
        roleArn: response.RoleArn,
      };

      return {
        success: true,
        data: rule,
        message: `Retrieved event rule '${name}'`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get event rule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Create an event rule
   */
  async createEventRule(
    options: CreateEventRuleOptions
  ): Promise<AutomationOperationResult<EventRuleInfo>> {
    try {
      // Validate that either eventPattern or scheduleExpression is provided
      if (!options.eventPattern && !options.scheduleExpression) {
        return {
          success: false,
          error: 'Either eventPattern or scheduleExpression must be provided',
        };
      }

      const command = new PutRuleCommand({
        Name: options.name,
        Description: options.description,
        EventBusName: options.eventBusName || this.config.defaultEventBus || 'default',
        EventPattern: options.eventPattern ? JSON.stringify(options.eventPattern) : undefined,
        ScheduleExpression: options.scheduleExpression,
        State: options.state || 'ENABLED',
        RoleArn: options.roleArn,
        Tags: options.tags
          ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value }))
          : undefined,
      });
      const response = await this.eventBridgeClient.send(command);

      const rule: EventRuleInfo = {
        name: options.name,
        arn: response.RuleArn || '',
        description: options.description,
        eventBusName: options.eventBusName || 'default',
        eventPattern: options.eventPattern ? JSON.stringify(options.eventPattern) : undefined,
        scheduleExpression: options.scheduleExpression,
        state: options.state || 'ENABLED',
        roleArn: options.roleArn,
        createdAt: new Date(),
        tags: options.tags,
      };

      return {
        success: true,
        data: rule,
        message: `Event rule '${options.name}' created successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create event rule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Update an event rule
   */
  async updateEventRule(
    name: string,
    updates: Partial<CreateEventRuleOptions>
  ): Promise<AutomationOperationResult<EventRuleInfo>> {
    try {
      // Get existing rule first
      const existingResult = await this.getEventRule(name, updates.eventBusName);
      if (!existingResult.success || !existingResult.data) {
        return {
          success: false,
          error: existingResult.error || 'Rule not found',
        };
      }

      const mergedOptions: CreateEventRuleOptions = {
        name,
        description: updates.description ?? existingResult.data.description,
        eventBusName: updates.eventBusName ?? existingResult.data.eventBusName,
        eventPattern: updates.eventPattern ?? (existingResult.data.eventPattern ? JSON.parse(existingResult.data.eventPattern) : undefined),
        scheduleExpression: updates.scheduleExpression ?? existingResult.data.scheduleExpression,
        state: updates.state ?? existingResult.data.state,
        roleArn: updates.roleArn ?? existingResult.data.roleArn,
        tags: updates.tags ?? existingResult.data.tags,
      };

      return await this.createEventRule(mergedOptions);
    } catch (error) {
      return {
        success: false,
        error: `Failed to update event rule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Delete an event rule
   */
  async deleteEventRule(
    name: string,
    eventBusName?: string
  ): Promise<AutomationOperationResult<void>> {
    try {
      // First, remove all targets
      const targetsResult = await this.listTargets(name, eventBusName);
      if (targetsResult.success && targetsResult.data && targetsResult.data.length > 0) {
        for (const target of targetsResult.data) {
          await this.removeTarget(name, target.id, eventBusName);
        }
      }

      const command = new DeleteRuleCommand({
        Name: name,
        EventBusName: eventBusName || this.config.defaultEventBus || 'default',
      });
      await this.eventBridgeClient.send(command);

      return {
        success: true,
        message: `Event rule '${name}' deleted successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete event rule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Enable an event rule
   */
  async enableEventRule(
    name: string,
    eventBusName?: string
  ): Promise<AutomationOperationResult<void>> {
    try {
      const command = new EnableRuleCommand({
        Name: name,
        EventBusName: eventBusName || this.config.defaultEventBus || 'default',
      });
      await this.eventBridgeClient.send(command);

      return {
        success: true,
        message: `Event rule '${name}' enabled successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to enable event rule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Disable an event rule
   */
  async disableEventRule(
    name: string,
    eventBusName?: string
  ): Promise<AutomationOperationResult<void>> {
    try {
      const command = new DisableRuleCommand({
        Name: name,
        EventBusName: eventBusName || this.config.defaultEventBus || 'default',
      });
      await this.eventBridgeClient.send(command);

      return {
        success: true,
        message: `Event rule '${name}' disabled successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to disable event rule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // =============================================================================
  // Event Targets
  // =============================================================================

  /**
   * List targets for a rule
   */
  async listTargets(
    ruleName: string,
    eventBusName?: string
  ): Promise<AutomationOperationResult<EventTargetInfo[]>> {
    try {
      const command = new ListTargetsByRuleCommand({
        Rule: ruleName,
        EventBusName: eventBusName || this.config.defaultEventBus || 'default',
      });
      const response = await this.eventBridgeClient.send(command);

      const targets: EventTargetInfo[] = (response.Targets || []).map(target => ({
        id: target.Id || '',
        arn: target.Arn || '',
        roleArn: target.RoleArn,
        input: target.Input,
        inputPath: target.InputPath,
        inputTransformer: target.InputTransformer
          ? {
              inputPathsMap: target.InputTransformer.InputPathsMap,
              inputTemplate: target.InputTransformer.InputTemplate || '',
            }
          : undefined,
        retryPolicy: target.RetryPolicy
          ? {
              maximumRetryAttempts: target.RetryPolicy.MaximumRetryAttempts,
              maximumEventAgeInSeconds: target.RetryPolicy.MaximumEventAgeInSeconds,
            }
          : undefined,
        deadLetterConfig: target.DeadLetterConfig?.Arn
          ? { arn: target.DeadLetterConfig.Arn }
          : undefined,
      }));

      return {
        success: true,
        data: targets,
        message: `Found ${targets.length} target(s) for rule '${ruleName}'`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list targets: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Add a target to a rule
   */
  async addTarget(options: AddTargetOptions): Promise<AutomationOperationResult<void>> {
    try {
      const target: Record<string, unknown> = {
        Id: options.targetId,
        Arn: options.targetArn,
        RoleArn: options.roleArn,
        Input: options.input,
      };

      if (options.inputTransformer) {
        target.InputTransformer = {
          InputPathsMap: options.inputTransformer.inputPathsMap,
          InputTemplate: options.inputTransformer.inputTemplate,
        };
      }

      if (options.retryPolicy) {
        target.RetryPolicy = {
          MaximumRetryAttempts: options.retryPolicy.maximumRetryAttempts,
          MaximumEventAgeInSeconds: options.retryPolicy.maximumEventAgeInSeconds,
        };
      }

      if (options.deadLetterQueueArn) {
        target.DeadLetterConfig = {
          Arn: options.deadLetterQueueArn,
        };
      }

      const command = new PutTargetsCommand({
        Rule: options.ruleName,
        EventBusName: options.eventBusName || this.config.defaultEventBus || 'default',
        Targets: [target as never],
      });
      const response = await this.eventBridgeClient.send(command);

      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        const failedEntry = response.FailedEntries?.[0];
        return {
          success: false,
          error: `Failed to add target: ${failedEntry?.ErrorMessage || 'Unknown error'}`,
        };
      }

      return {
        success: true,
        message: `Target '${options.targetId}' added to rule '${options.ruleName}'`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add target: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Remove a target from a rule
   */
  async removeTarget(
    ruleName: string,
    targetId: string,
    eventBusName?: string
  ): Promise<AutomationOperationResult<void>> {
    try {
      const command = new RemoveTargetsCommand({
        Rule: ruleName,
        EventBusName: eventBusName || this.config.defaultEventBus || 'default',
        Ids: [targetId],
      });
      const response = await this.eventBridgeClient.send(command);

      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        const failedEntry = response.FailedEntries?.[0];
        return {
          success: false,
          error: `Failed to remove target: ${failedEntry?.ErrorMessage || 'Unknown error'}`,
        };
      }

      return {
        success: true,
        message: `Target '${targetId}' removed from rule '${ruleName}'`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to remove target: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // =============================================================================
  // Schedules (EventBridge Scheduler)
  // =============================================================================

  /**
   * List schedules
   */
  async listSchedules(
    options: ListSchedulesOptions = {}
  ): Promise<AutomationOperationResult<ScheduleInfo[]>> {
    try {
      const command = new ListSchedulesCommand({
        GroupName: options.groupName,
        NamePrefix: options.namePrefix,
        State: options.state,
        MaxResults: options.maxResults,
        NextToken: options.nextToken,
      });
      const response = await this.schedulerClient.send(command);

      const schedules: ScheduleInfo[] = (response.Schedules || []).map(schedule => ({
        name: schedule.Name || '',
        arn: schedule.Arn || '',
        groupName: schedule.GroupName || 'default',
        scheduleExpression: '',
        state: (schedule.State as ScheduleState) || 'DISABLED',
        target: {
          arn: schedule.Target?.Arn || '',
          roleArn: '',
        },
      }));

      return {
        success: true,
        data: schedules,
        message: `Found ${schedules.length} schedule(s)`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list schedules: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get schedule details
   */
  async getSchedule(
    name: string,
    groupName?: string
  ): Promise<AutomationOperationResult<ScheduleInfo>> {
    try {
      const command = new GetScheduleCommand({
        Name: name,
        GroupName: groupName || 'default',
      });
      const response = await this.schedulerClient.send(command);

      const schedule: ScheduleInfo = {
        name: response.Name || name,
        arn: response.Arn || '',
        groupName: response.GroupName || 'default',
        description: response.Description,
        scheduleExpression: response.ScheduleExpression || '',
        scheduleExpressionTimezone: response.ScheduleExpressionTimezone,
        state: (response.State as ScheduleState) || 'DISABLED',
        startDate: response.StartDate,
        endDate: response.EndDate,
        flexibleTimeWindow: response.FlexibleTimeWindow
          ? {
              mode: response.FlexibleTimeWindow.Mode as 'OFF' | 'FLEXIBLE',
              maximumWindowInMinutes: response.FlexibleTimeWindow.MaximumWindowInMinutes,
            }
          : undefined,
        target: {
          arn: response.Target?.Arn || '',
          roleArn: response.Target?.RoleArn || '',
          input: response.Target?.Input,
        },
        creationDate: response.CreationDate,
        lastModificationDate: response.LastModificationDate,
      };

      return {
        success: true,
        data: schedule,
        message: `Retrieved schedule '${name}'`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get schedule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Create a schedule
   */
  async createSchedule(
    options: CreateScheduleOptions
  ): Promise<AutomationOperationResult<ScheduleInfo>> {
    try {
      const command = new CreateScheduleCommand({
        Name: options.name,
        GroupName: options.groupName || 'default',
        Description: options.description,
        ScheduleExpression: options.scheduleExpression,
        ScheduleExpressionTimezone: options.timezone,
        State: options.state || 'ENABLED',
        StartDate: options.startDate,
        EndDate: options.endDate,
        FlexibleTimeWindow: options.flexibleTimeWindow
          ? {
              Mode: options.flexibleTimeWindow.mode,
              MaximumWindowInMinutes: options.flexibleTimeWindow.maximumWindowInMinutes,
            }
          : { Mode: 'OFF' },
        Target: {
          Arn: options.targetArn,
          RoleArn: options.targetRoleArn,
          Input: options.targetInput,
          RetryPolicy: options.retryPolicy
            ? {
                MaximumRetryAttempts: options.retryPolicy.maximumRetryAttempts,
                MaximumEventAgeInSeconds: options.retryPolicy.maximumEventAgeInSeconds,
              }
            : undefined,
          DeadLetterConfig: options.deadLetterConfig
            ? { Arn: options.deadLetterConfig.arn }
            : undefined,
        },
      });
      const response = await this.schedulerClient.send(command);

      const schedule: ScheduleInfo = {
        name: options.name,
        arn: response.ScheduleArn || '',
        groupName: options.groupName || 'default',
        description: options.description,
        scheduleExpression: options.scheduleExpression,
        scheduleExpressionTimezone: options.timezone,
        state: options.state || 'ENABLED',
        startDate: options.startDate,
        endDate: options.endDate,
        flexibleTimeWindow: options.flexibleTimeWindow || { mode: 'OFF' },
        target: {
          arn: options.targetArn,
          roleArn: options.targetRoleArn,
          input: options.targetInput,
        },
        creationDate: new Date(),
      };

      return {
        success: true,
        data: schedule,
        message: `Schedule '${options.name}' created successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create schedule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Update a schedule
   */
  async updateSchedule(
    name: string,
    updates: Partial<CreateScheduleOptions>
  ): Promise<AutomationOperationResult<ScheduleInfo>> {
    try {
      // Get existing schedule first
      const existingResult = await this.getSchedule(name, updates.groupName);
      if (!existingResult.success || !existingResult.data) {
        return {
          success: false,
          error: existingResult.error || 'Schedule not found',
        };
      }

      const existing = existingResult.data;

      const flexWindow = updates.flexibleTimeWindow ?? existing.flexibleTimeWindow;
      const command = new UpdateScheduleCommand({
        Name: name,
        GroupName: updates.groupName || existing.groupName,
        Description: updates.description ?? existing.description,
        ScheduleExpression: updates.scheduleExpression ?? existing.scheduleExpression,
        ScheduleExpressionTimezone: updates.timezone ?? existing.scheduleExpressionTimezone,
        State: updates.state ?? existing.state,
        StartDate: updates.startDate ?? existing.startDate,
        EndDate: updates.endDate ?? existing.endDate,
        FlexibleTimeWindow: flexWindow
          ? {
              Mode: flexWindow.mode,
              MaximumWindowInMinutes: flexWindow.maximumWindowInMinutes,
            }
          : { Mode: 'OFF' },
        Target: {
          Arn: updates.targetArn ?? existing.target.arn,
          RoleArn: updates.targetRoleArn ?? existing.target.roleArn,
          Input: updates.targetInput ?? existing.target.input,
        },
      });
      const response = await this.schedulerClient.send(command);

      const schedule: ScheduleInfo = {
        name,
        arn: response.ScheduleArn || existing.arn,
        groupName: updates.groupName || existing.groupName,
        description: updates.description ?? existing.description,
        scheduleExpression: updates.scheduleExpression ?? existing.scheduleExpression,
        scheduleExpressionTimezone: updates.timezone ?? existing.scheduleExpressionTimezone,
        state: updates.state ?? existing.state,
        startDate: updates.startDate ?? existing.startDate,
        endDate: updates.endDate ?? existing.endDate,
        flexibleTimeWindow: updates.flexibleTimeWindow ?? existing.flexibleTimeWindow,
        target: {
          arn: updates.targetArn ?? existing.target.arn,
          roleArn: updates.targetRoleArn ?? existing.target.roleArn,
          input: updates.targetInput ?? existing.target.input,
        },
        lastModificationDate: new Date(),
      };

      return {
        success: true,
        data: schedule,
        message: `Schedule '${name}' updated successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update schedule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Delete a schedule
   */
  async deleteSchedule(
    name: string,
    groupName?: string
  ): Promise<AutomationOperationResult<void>> {
    try {
      const command = new DeleteScheduleCommand({
        Name: name,
        GroupName: groupName || 'default',
      });
      await this.schedulerClient.send(command);

      return {
        success: true,
        message: `Schedule '${name}' deleted successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete schedule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // =============================================================================
  // State Machines
  // =============================================================================

  /**
   * List state machines
   */
  async listStateMachines(
    options: ListStateMachinesOptions = {}
  ): Promise<AutomationOperationResult<StateMachineInfo[]>> {
    try {
      const command = new ListStateMachinesCommand({
        maxResults: options.maxResults,
        nextToken: options.nextToken,
      });
      const response = await this.sfnClient.send(command);

      const stateMachines: StateMachineInfo[] = (response.stateMachines || []).map(sm => ({
        arn: sm.stateMachineArn || '',
        name: sm.name || '',
        type: (sm.type as StateMachineType) || 'STANDARD',
        status: 'ACTIVE',
        roleArn: '',
        creationDate: sm.creationDate || new Date(),
      }));

      return {
        success: true,
        data: stateMachines,
        message: `Found ${stateMachines.length} state machine(s)`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list state machines: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get state machine details
   */
  async getStateMachine(arn: string): Promise<AutomationOperationResult<StateMachineInfo>> {
    try {
      const command = new DescribeStateMachineCommand({
        stateMachineArn: arn,
      });
      const response = await this.sfnClient.send(command);

      const stateMachine: StateMachineInfo = {
        arn: response.stateMachineArn || arn,
        name: response.name || '',
        type: (response.type as StateMachineType) || 'STANDARD',
        status: (response.status as 'ACTIVE' | 'DELETING') || 'ACTIVE',
        definition: response.definition,
        roleArn: response.roleArn || '',
        description: response.description,
        creationDate: response.creationDate || new Date(),
        loggingConfiguration: response.loggingConfiguration
          ? {
              level: response.loggingConfiguration.level as 'ALL' | 'ERROR' | 'FATAL' | 'OFF',
              includeExecutionData: response.loggingConfiguration.includeExecutionData || false,
              destinations: response.loggingConfiguration.destinations?.map(d => ({
                logGroupArn: d.cloudWatchLogsLogGroup?.logGroupArn || '',
              })),
            }
          : undefined,
        tracingConfiguration: response.tracingConfiguration
          ? { enabled: response.tracingConfiguration.enabled || false }
          : undefined,
      };

      return {
        success: true,
        data: stateMachine,
        message: `Retrieved state machine '${response.name}'`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get state machine: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Create a state machine
   */
  async createStateMachine(
    options: CreateStateMachineOptions
  ): Promise<AutomationOperationResult<StateMachineInfo>> {
    try {
      const command = new CreateStateMachineCommand({
        name: options.name,
        definition: JSON.stringify(options.definition),
        roleArn: options.roleArn,
        type: options.type || 'STANDARD',
        loggingConfiguration: options.loggingConfiguration
          ? {
              level: options.loggingConfiguration.level,
              includeExecutionData: options.loggingConfiguration.includeExecutionData,
              destinations: options.loggingConfiguration.logGroupArn
                ? [
                    {
                      cloudWatchLogsLogGroup: {
                        logGroupArn: options.loggingConfiguration.logGroupArn,
                      },
                    },
                  ]
                : undefined,
            }
          : undefined,
        tracingConfiguration: options.enableTracing ? { enabled: true } : undefined,
        tags: options.tags
          ? Object.entries(options.tags).map(([key, value]) => ({ key, value }))
          : undefined,
      });
      const response = await this.sfnClient.send(command);

      const stateMachine: StateMachineInfo = {
        arn: response.stateMachineArn || '',
        name: options.name,
        type: options.type || 'STANDARD',
        status: 'ACTIVE',
        definition: JSON.stringify(options.definition),
        roleArn: options.roleArn,
        description: options.description,
        creationDate: response.creationDate || new Date(),
        tracingConfiguration: options.enableTracing ? { enabled: true } : undefined,
        tags: options.tags,
      };

      return {
        success: true,
        data: stateMachine,
        message: `State machine '${options.name}' created successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create state machine: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Update a state machine
   */
  async updateStateMachine(
    arn: string,
    updates: Partial<CreateStateMachineOptions>
  ): Promise<AutomationOperationResult<StateMachineInfo>> {
    try {
      const command = new UpdateStateMachineCommand({
        stateMachineArn: arn,
        definition: updates.definition ? JSON.stringify(updates.definition) : undefined,
        roleArn: updates.roleArn,
        loggingConfiguration: updates.loggingConfiguration
          ? {
              level: updates.loggingConfiguration.level,
              includeExecutionData: updates.loggingConfiguration.includeExecutionData,
              destinations: updates.loggingConfiguration.logGroupArn
                ? [
                    {
                      cloudWatchLogsLogGroup: {
                        logGroupArn: updates.loggingConfiguration.logGroupArn,
                      },
                    },
                  ]
                : undefined,
            }
          : undefined,
        tracingConfiguration: updates.enableTracing !== undefined
          ? { enabled: updates.enableTracing }
          : undefined,
      });
      const response = await this.sfnClient.send(command);

      // Get updated state machine details
      const getResult = await this.getStateMachine(arn);
      if (!getResult.success || !getResult.data) {
        return {
          success: true,
          data: {
            arn,
            name: updates.name || '',
            type: updates.type || 'STANDARD',
            status: 'ACTIVE',
            roleArn: updates.roleArn || '',
            creationDate: new Date(),
          },
          message: `State machine updated successfully`,
        };
      }

      return {
        success: true,
        data: getResult.data,
        message: `State machine updated successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update state machine: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Delete a state machine
   */
  async deleteStateMachine(arn: string): Promise<AutomationOperationResult<void>> {
    try {
      const command = new DeleteStateMachineCommand({
        stateMachineArn: arn,
      });
      await this.sfnClient.send(command);

      return {
        success: true,
        message: `State machine deleted successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete state machine: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // =============================================================================
  // Executions
  // =============================================================================

  /**
   * Start a state machine execution
   */
  async startExecution(
    options: StartExecutionOptions
  ): Promise<AutomationOperationResult<ExecutionInfo>> {
    try {
      const command = new StartExecutionCommand({
        stateMachineArn: options.stateMachineArn,
        name: options.name,
        input: options.input ? JSON.stringify(options.input) : undefined,
        traceHeader: options.traceHeader,
      });
      const response = await this.sfnClient.send(command);

      const execution: ExecutionInfo = {
        executionArn: response.executionArn || '',
        stateMachineArn: options.stateMachineArn,
        name: options.name || '',
        status: 'RUNNING',
        startDate: response.startDate || new Date(),
        input: options.input ? JSON.stringify(options.input) : undefined,
      };

      return {
        success: true,
        data: execution,
        message: `Execution started successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to start execution: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Stop a state machine execution
   */
  async stopExecution(
    executionArn: string,
    error?: string,
    cause?: string
  ): Promise<AutomationOperationResult<void>> {
    try {
      const command = new StopExecutionCommand({
        executionArn,
        error,
        cause,
      });
      await this.sfnClient.send(command);

      return {
        success: true,
        message: `Execution stopped successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to stop execution: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * List state machine executions
   */
  async listExecutions(
    options: ListExecutionsOptions
  ): Promise<AutomationOperationResult<ExecutionInfo[]>> {
    try {
      const command = new ListExecutionsCommand({
        stateMachineArn: options.stateMachineArn,
        statusFilter: options.statusFilter,
        maxResults: options.maxResults,
        nextToken: options.nextToken,
      });
      const response = await this.sfnClient.send(command);

      const executions: ExecutionInfo[] = (response.executions || []).map(exec => ({
        executionArn: exec.executionArn || '',
        stateMachineArn: exec.stateMachineArn || options.stateMachineArn,
        name: exec.name || '',
        status: (exec.status as ExecutionStatus) || 'RUNNING',
        startDate: exec.startDate || new Date(),
        stopDate: exec.stopDate,
      }));

      return {
        success: true,
        data: executions,
        message: `Found ${executions.length} execution(s)`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list executions: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get execution details
   */
  async getExecution(executionArn: string): Promise<AutomationOperationResult<ExecutionInfo>> {
    try {
      const command = new DescribeExecutionCommand({
        executionArn,
      });
      const response = await this.sfnClient.send(command);

      const execution: ExecutionInfo = {
        executionArn: response.executionArn || executionArn,
        stateMachineArn: response.stateMachineArn || '',
        name: response.name || '',
        status: (response.status as ExecutionStatus) || 'RUNNING',
        startDate: response.startDate || new Date(),
        stopDate: response.stopDate,
        input: response.input,
        output: response.output,
        error: response.error,
        cause: response.cause,
      };

      return {
        success: true,
        data: execution,
        message: `Retrieved execution details`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get execution: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // =============================================================================
  // Workflow Builder
  // =============================================================================

  /**
   * Build and create a workflow from a high-level definition
   */
  async buildWorkflow(
    options: BuildWorkflowOptions
  ): Promise<AutomationOperationResult<StateMachineInfo>> {
    try {
      // Convert high-level workflow to ASL
      const aslDefinition = this.convertToASL(options.workflow);

      // Create the state machine
      return await this.createStateMachine({
        name: options.workflow.name,
        definition: aslDefinition,
        roleArn: options.roleArn,
        type: options.type || 'STANDARD',
        description: options.workflow.description,
        loggingConfiguration: options.enableLogging
          ? {
              level: 'ALL',
              includeExecutionData: true,
              logGroupArn: options.logGroupArn,
            }
          : undefined,
        enableTracing: options.enableTracing,
        tags: options.tags,
      });
    } catch (error) {
      return {
        success: false,
        error: `Failed to build workflow: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Convert a high-level workflow definition to ASL
   */
  convertToASL(workflow: WorkflowDefinition): ASLDefinition {
    const states: Record<string, ASLState> = {};

    for (const step of workflow.steps) {
      states[step.name] = this.convertStepToASLState(step);
    }

    return {
      Comment: workflow.description,
      StartAt: workflow.startAt,
      States: states,
      Version: workflow.version || '1.0',
      TimeoutSeconds: workflow.timeoutSeconds,
    };
  }

  /**
   * Convert a workflow step to an ASL state
   */
  private convertStepToASLState(step: WorkflowStep): ASLState {
    const baseState: Partial<ASLState> = {
      Comment: step.description,
    };

    // Handle next/end
    if (step.isEnd) {
      baseState.End = true;
    } else if (step.next) {
      baseState.Next = step.next;
    }

    // Handle retry
    if (step.retry) {
      baseState.Retry = [
        {
          ErrorEquals: step.retry.errors || ['States.ALL'],
          IntervalSeconds: step.retry.intervalSeconds,
          MaxAttempts: step.retry.maxAttempts,
          BackoffRate: step.retry.backoffRate,
        },
      ];
    }

    // Handle catch
    if (step.catch) {
      baseState.Catch = step.catch.map(c => ({
        ErrorEquals: c.errors,
        Next: c.next,
      }));
    }

    switch (step.type) {
      case 'lambda':
        return {
          Type: 'Task',
          Resource: step.resourceArn || 'arn:aws:states:::lambda:invoke',
          Parameters: step.parameters || {
            FunctionName: step.resourceArn,
            'Payload.$': '$',
          },
          ...baseState,
        } as ASLState;

      case 'ecs-task':
        return {
          Type: 'Task',
          Resource: 'arn:aws:states:::ecs:runTask.sync',
          Parameters: step.parameters,
          ...baseState,
        } as ASLState;

      case 'sns-publish':
        return {
          Type: 'Task',
          Resource: 'arn:aws:states:::sns:publish',
          Parameters: step.parameters,
          ...baseState,
        } as ASLState;

      case 'sqs-send':
        return {
          Type: 'Task',
          Resource: 'arn:aws:states:::sqs:sendMessage',
          Parameters: step.parameters,
          ...baseState,
        } as ASLState;

      case 'dynamodb-get':
        return {
          Type: 'Task',
          Resource: 'arn:aws:states:::dynamodb:getItem',
          Parameters: step.parameters,
          ...baseState,
        } as ASLState;

      case 'dynamodb-put':
        return {
          Type: 'Task',
          Resource: 'arn:aws:states:::dynamodb:putItem',
          Parameters: step.parameters,
          ...baseState,
        } as ASLState;

      case 's3-get':
        return {
          Type: 'Task',
          Resource: 'arn:aws:states:::s3:getObject',
          Parameters: step.parameters,
          ...baseState,
        } as ASLState;

      case 's3-put':
        return {
          Type: 'Task',
          Resource: 'arn:aws:states:::s3:putObject',
          Parameters: step.parameters,
          ...baseState,
        } as ASLState;

      case 'wait':
        return {
          Type: 'Wait',
          Seconds: step.waitSeconds,
          Timestamp: step.waitTimestamp,
          ...baseState,
        } as ASLState;

      case 'choice': {
        const choices = (step.conditions || []).map(cond =>
          this.convertConditionToASLChoice(cond)
        );
        return {
          Type: 'Choice',
          Choices: choices,
          Default: step.defaultNext,
          ...baseState,
        } as ASLState;
      }

      case 'parallel':
        return {
          Type: 'Parallel',
          Branches: (step.branches || []).map(branch => ({
            StartAt: branch[0]?.name || '',
            States: Object.fromEntries(
              branch.map(s => [s.name, this.convertStepToASLState(s)])
            ),
          })),
          ...baseState,
        } as ASLState;

      case 'map':
        return {
          Type: 'Map',
          ItemsPath: step.itemsPath,
          MaxConcurrency: step.maxConcurrency,
          Iterator: step.iterator
            ? {
                StartAt: step.iterator[0]?.name || '',
                States: Object.fromEntries(
                  step.iterator.map(s => [s.name, this.convertStepToASLState(s)])
                ),
              }
            : undefined,
          ...baseState,
        } as ASLState;

      case 'pass':
        return {
          Type: 'Pass',
          Result: step.result,
          ...baseState,
        } as ASLState;

      case 'fail':
        return {
          Type: 'Fail',
          Error: step.error,
          Cause: step.cause,
        } as ASLState;

      case 'succeed':
        return {
          Type: 'Succeed',
        } as ASLState;

      default:
        return {
          Type: 'Pass',
          ...baseState,
        } as ASLState;
    }
  }

  /**
   * Convert a workflow condition to an ASL choice
   */
  private convertConditionToASLChoice(condition: WorkflowCondition): Record<string, unknown> {
    const choice: Record<string, unknown> = {
      Variable: condition.variable,
      Next: condition.next,
    };

    switch (condition.operator) {
      case 'equals':
        if (typeof condition.value === 'number') {
          choice.NumericEquals = condition.value;
        } else if (typeof condition.value === 'boolean') {
          choice.BooleanEquals = condition.value;
        } else {
          choice.StringEquals = condition.value;
        }
        break;
      case 'not-equals':
        if (typeof condition.value === 'number') {
          choice.NumericEqualsPath = condition.value;
          choice.Not = { NumericEquals: condition.value };
        } else {
          choice.Not = { StringEquals: condition.value };
        }
        break;
      case 'greater-than':
        choice.NumericGreaterThan = condition.value;
        break;
      case 'greater-than-or-equal':
        choice.NumericGreaterThanEquals = condition.value;
        break;
      case 'less-than':
        choice.NumericLessThan = condition.value;
        break;
      case 'less-than-or-equal':
        choice.NumericLessThanEquals = condition.value;
        break;
      case 'string-equals':
        choice.StringEquals = condition.value;
        break;
      case 'string-not-equals':
        choice.Not = { StringEquals: condition.value };
        break;
      case 'string-matches':
        choice.StringMatches = condition.value;
        break;
      case 'is-present':
        choice.IsPresent = true;
        break;
      case 'is-not-present':
        choice.IsPresent = false;
        break;
      case 'is-null':
        choice.IsNull = true;
        break;
      case 'is-not-null':
        choice.IsNull = false;
        break;
      case 'is-string':
        choice.IsString = true;
        break;
      case 'is-numeric':
        choice.IsNumeric = true;
        break;
      case 'is-boolean':
        choice.IsBoolean = true;
        break;
    }

    return choice;
  }

  // =============================================================================
  // Automated Remediation
  // =============================================================================

  /**
   * List remediation configurations
   */
  async listRemediations(
    options: ListRemediationsOptions = {}
  ): Promise<AutomationOperationResult<RemediationConfig[]>> {
    try {
      let remediations = Array.from(this.remediationStore.values());

      // Apply filters
      if (options.triggerType) {
        remediations = remediations.filter(r => r.triggerType === options.triggerType);
      }
      if (options.enabled !== undefined) {
        remediations = remediations.filter(r => r.enabled === options.enabled);
      }
      if (options.limit) {
        remediations = remediations.slice(0, options.limit);
      }

      return {
        success: true,
        data: remediations,
        message: `Found ${remediations.length} remediation configuration(s)`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list remediations: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get a specific remediation configuration
   */
  async getRemediation(id: string): Promise<AutomationOperationResult<RemediationConfig>> {
    try {
      const remediation = this.remediationStore.get(id);
      if (!remediation) {
        return {
          success: false,
          error: `Remediation configuration '${id}' not found`,
        };
      }

      return {
        success: true,
        data: remediation,
        message: `Retrieved remediation configuration '${id}'`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get remediation: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Set up automated remediation
   */
  async setupRemediation(
    options: SetupRemediationOptions
  ): Promise<AutomationOperationResult<RemediationConfig>> {
    try {
      const id = `rem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create EventBridge rule for the trigger
      let ruleArn: string | undefined;

      if (options.triggerType === 'config-rule' && options.triggerConfig.configRuleName) {
        // Create rule for Config compliance changes
        const ruleResult = await this.createEventRule({
          name: `${options.name}-trigger`,
          description: `Trigger for remediation: ${options.description || options.name}`,
          eventPattern: {
            source: ['aws.config'],
            'detail-type': ['Config Rules Compliance Change'],
            detail: {
              configRuleName: [options.triggerConfig.configRuleName],
              newEvaluationResult: {
                complianceType: ['NON_COMPLIANT'],
              },
            },
          },
          state: options.automatic ? 'ENABLED' : 'DISABLED',
        });

        if (ruleResult.success && ruleResult.data) {
          ruleArn = ruleResult.data.arn;

          // Add target based on action type
          if (options.actionType === 'lambda' && options.actionConfig.lambdaArn) {
            await this.addTarget({
              ruleName: `${options.name}-trigger`,
              targetId: `${options.name}-target`,
              targetArn: options.actionConfig.lambdaArn,
              targetType: 'lambda',
            });
          } else if (options.actionType === 'step-functions' && options.actionConfig.stateMachineArn) {
            await this.addTarget({
              ruleName: `${options.name}-trigger`,
              targetId: `${options.name}-target`,
              targetArn: options.actionConfig.stateMachineArn,
              targetType: 'step-functions',
            });
          } else if (options.actionType === 'ssm-automation' && options.actionConfig.documentName) {
            await this.addTarget({
              ruleName: `${options.name}-trigger`,
              targetId: `${options.name}-target`,
              targetArn: `arn:aws:ssm:${this.config.defaultRegion || 'us-east-1'}::automation-definition/${options.actionConfig.documentName}`,
              targetType: 'ssm-automation',
            });
          }
        }
      } else if (options.triggerType === 'guardduty-finding') {
        // Create rule for GuardDuty findings
        const ruleResult = await this.createEventRule({
          name: `${options.name}-trigger`,
          description: `Trigger for remediation: ${options.description || options.name}`,
          eventPattern: {
            source: ['aws.guardduty'],
            'detail-type': ['GuardDuty Finding'],
            ...(options.triggerConfig.guardDutyFindingType && {
              detail: {
                type: [options.triggerConfig.guardDutyFindingType],
              },
            }),
          },
          state: options.automatic ? 'ENABLED' : 'DISABLED',
        });

        if (ruleResult.success && ruleResult.data) {
          ruleArn = ruleResult.data.arn;
        }
      } else if (options.triggerType === 'securityhub-finding') {
        // Create rule for Security Hub findings
        const ruleResult = await this.createEventRule({
          name: `${options.name}-trigger`,
          description: `Trigger for remediation: ${options.description || options.name}`,
          eventPattern: {
            source: ['aws.securityhub'],
            'detail-type': ['Security Hub Findings - Imported'],
            ...(options.triggerConfig.securityHubFindingType && {
              detail: {
                findings: {
                  Types: [options.triggerConfig.securityHubFindingType],
                },
              },
            }),
          },
          state: options.automatic ? 'ENABLED' : 'DISABLED',
        });

        if (ruleResult.success && ruleResult.data) {
          ruleArn = ruleResult.data.arn;
        }
      } else if (options.triggerType === 'cloudwatch-alarm' && options.triggerConfig.alarmName) {
        // Create rule for CloudWatch alarms
        const ruleResult = await this.createEventRule({
          name: `${options.name}-trigger`,
          description: `Trigger for remediation: ${options.description || options.name}`,
          eventPattern: {
            source: ['aws.cloudwatch'],
            'detail-type': ['CloudWatch Alarm State Change'],
            detail: {
              alarmName: [options.triggerConfig.alarmName],
              state: {
                value: ['ALARM'],
              },
            },
          },
          state: options.automatic ? 'ENABLED' : 'DISABLED',
        });

        if (ruleResult.success && ruleResult.data) {
          ruleArn = ruleResult.data.arn;
        }
      } else if (options.triggerType === 'custom-event' && options.triggerConfig.eventPattern) {
        // Create rule for custom events
        const ruleResult = await this.createEventRule({
          name: `${options.name}-trigger`,
          description: `Trigger for remediation: ${options.description || options.name}`,
          eventPattern: options.triggerConfig.eventPattern,
          state: options.automatic ? 'ENABLED' : 'DISABLED',
        });

        if (ruleResult.success && ruleResult.data) {
          ruleArn = ruleResult.data.arn;
        }
      }

      const remediation: RemediationConfig = {
        id,
        name: options.name,
        description: options.description,
        triggerType: options.triggerType,
        triggerConfig: options.triggerConfig,
        actionType: options.actionType,
        actionConfig: options.actionConfig,
        automatic: options.automatic,
        maxConcurrency: options.maxConcurrency,
        maxErrors: options.maxErrors,
        resourceTypeFilter: options.resourceTypeFilter,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.remediationStore.set(id, remediation);

      return {
        success: true,
        data: remediation,
        message: `Remediation '${options.name}' configured successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to setup remediation: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Update a remediation configuration
   */
  async updateRemediation(
    id: string,
    updates: Partial<SetupRemediationOptions>
  ): Promise<AutomationOperationResult<RemediationConfig>> {
    try {
      const existing = this.remediationStore.get(id);
      if (!existing) {
        return {
          success: false,
          error: `Remediation configuration '${id}' not found`,
        };
      }

      const updated: RemediationConfig = {
        ...existing,
        name: updates.name ?? existing.name,
        description: updates.description ?? existing.description,
        triggerType: updates.triggerType ?? existing.triggerType,
        triggerConfig: updates.triggerConfig ?? existing.triggerConfig,
        actionType: updates.actionType ?? existing.actionType,
        actionConfig: updates.actionConfig ?? existing.actionConfig,
        automatic: updates.automatic ?? existing.automatic,
        maxConcurrency: updates.maxConcurrency ?? existing.maxConcurrency,
        maxErrors: updates.maxErrors ?? existing.maxErrors,
        resourceTypeFilter: updates.resourceTypeFilter ?? existing.resourceTypeFilter,
        updatedAt: new Date(),
      };

      this.remediationStore.set(id, updated);

      // Update the associated EventBridge rule state
      if (updates.automatic !== undefined) {
        const ruleName = `${existing.name}-trigger`;
        if (updates.automatic) {
          await this.enableEventRule(ruleName);
        } else {
          await this.disableEventRule(ruleName);
        }
      }

      return {
        success: true,
        data: updated,
        message: `Remediation '${updated.name}' updated successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update remediation: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Delete a remediation configuration
   */
  async deleteRemediation(id: string): Promise<AutomationOperationResult<void>> {
    try {
      const existing = this.remediationStore.get(id);
      if (!existing) {
        return {
          success: false,
          error: `Remediation configuration '${id}' not found`,
        };
      }

      // Delete the associated EventBridge rule
      const ruleName = `${existing.name}-trigger`;
      await this.deleteEventRule(ruleName);

      this.remediationStore.delete(id);

      return {
        success: true,
        message: `Remediation '${existing.name}' deleted successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete remediation: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Enable a remediation configuration
   */
  async enableRemediation(id: string): Promise<AutomationOperationResult<void>> {
    try {
      const existing = this.remediationStore.get(id);
      if (!existing) {
        return {
          success: false,
          error: `Remediation configuration '${id}' not found`,
        };
      }

      existing.enabled = true;
      existing.updatedAt = new Date();
      this.remediationStore.set(id, existing);

      // Enable the associated EventBridge rule
      const ruleName = `${existing.name}-trigger`;
      await this.enableEventRule(ruleName);

      return {
        success: true,
        message: `Remediation '${existing.name}' enabled`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to enable remediation: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Disable a remediation configuration
   */
  async disableRemediation(id: string): Promise<AutomationOperationResult<void>> {
    try {
      const existing = this.remediationStore.get(id);
      if (!existing) {
        return {
          success: false,
          error: `Remediation configuration '${id}' not found`,
        };
      }

      existing.enabled = false;
      existing.updatedAt = new Date();
      this.remediationStore.set(id, existing);

      // Disable the associated EventBridge rule
      const ruleName = `${existing.name}-trigger`;
      await this.disableEventRule(ruleName);

      return {
        success: true,
        message: `Remediation '${existing.name}' disabled`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to disable remediation: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Manually trigger a remediation for a specific resource
   */
  async triggerRemediation(
    id: string,
    resourceId: string
  ): Promise<AutomationOperationResult<RemediationExecution>> {
    try {
      const remediation = this.remediationStore.get(id);
      if (!remediation) {
        return {
          success: false,
          error: `Remediation configuration '${id}' not found`,
        };
      }

      const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Execute based on action type
      if (remediation.actionType === 'lambda' && remediation.actionConfig.lambdaArn) {
        // Would invoke Lambda here
        // For now, just return execution info
      } else if (remediation.actionType === 'step-functions' && remediation.actionConfig.stateMachineArn) {
        await this.startExecution({
          stateMachineArn: remediation.actionConfig.stateMachineArn,
          input: {
            remediationId: id,
            resourceId,
            triggeredAt: new Date().toISOString(),
          },
        });
      }

      const execution: RemediationExecution = {
        executionId,
        remediationConfigId: id,
        resourceId,
        resourceType: remediation.resourceTypeFilter?.[0] || 'Unknown',
        status: 'IN_PROGRESS',
        startTime: new Date(),
      };

      return {
        success: true,
        data: execution,
        message: `Remediation triggered for resource '${resourceId}'`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to trigger remediation: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // =============================================================================
  // Event Archives and Replay
  // =============================================================================

  /**
   * List event archives
   */
  async listEventArchives(
    options: ListEventArchivesOptions = {}
  ): Promise<AutomationOperationResult<EventArchiveInfo[]>> {
    try {
      const command = new ListArchivesCommand({
        EventSourceArn: options.eventSourceArn,
        NamePrefix: options.namePrefix,
        State: options.state,
        Limit: options.limit,
        NextToken: options.nextToken,
      });
      const response = await this.eventBridgeClient.send(command);

      const archives: EventArchiveInfo[] = (response.Archives || []).map(archive => ({
        archiveName: archive.ArchiveName || '',
        archiveArn: '',
        eventSourceArn: archive.EventSourceArn || '',
        state: archive.State as EventArchiveInfo['state'],
        retentionDays: archive.RetentionDays,
        sizeBytes: archive.SizeBytes || 0,
        eventCount: archive.EventCount || 0,
        creationTime: archive.CreationTime || new Date(),
      }));

      return {
        success: true,
        data: archives,
        message: `Found ${archives.length} archive(s)`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list archives: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Create an event archive
   */
  async createEventArchive(
    options: CreateEventArchiveOptions
  ): Promise<AutomationOperationResult<EventArchiveInfo>> {
    try {
      const command = new CreateArchiveCommand({
        ArchiveName: options.archiveName,
        EventSourceArn: options.eventSourceArn,
        Description: options.description,
        EventPattern: options.eventPattern ? JSON.stringify(options.eventPattern) : undefined,
        RetentionDays: options.retentionDays,
      });
      const response = await this.eventBridgeClient.send(command);

      const archive: EventArchiveInfo = {
        archiveName: options.archiveName,
        archiveArn: response.ArchiveArn || '',
        eventSourceArn: options.eventSourceArn,
        description: options.description,
        eventPattern: options.eventPattern ? JSON.stringify(options.eventPattern) : undefined,
        state: (response.State as EventArchiveInfo['state']) || 'ENABLED',
        retentionDays: options.retentionDays,
        sizeBytes: 0,
        eventCount: 0,
        creationTime: response.CreationTime || new Date(),
      };

      return {
        success: true,
        data: archive,
        message: `Archive '${options.archiveName}' created successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create archive: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Delete an event archive
   */
  async deleteEventArchive(archiveName: string): Promise<AutomationOperationResult<void>> {
    try {
      const command = new DeleteArchiveCommand({
        ArchiveName: archiveName,
      });
      await this.eventBridgeClient.send(command);

      return {
        success: true,
        message: `Archive '${archiveName}' deleted successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete archive: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Start an event replay
   */
  async startReplay(
    options: StartEventReplayOptions
  ): Promise<AutomationOperationResult<EventReplayInfo>> {
    try {
      const command = new StartReplayCommand({
        ReplayName: options.replayName,
        EventSourceArn: options.eventSourceArn,
        Destination: {
          Arn: options.destinationArn,
          FilterArns: options.filterArns,
        },
        EventStartTime: options.eventStartTime,
        EventEndTime: options.eventEndTime,
        Description: options.description,
      });
      const response = await this.eventBridgeClient.send(command);

      const replay: EventReplayInfo = {
        replayName: options.replayName,
        replayArn: response.ReplayArn || '',
        eventSourceArn: options.eventSourceArn,
        destination: {
          arn: options.destinationArn,
          filterArns: options.filterArns,
        },
        state: (response.State as EventReplayInfo['state']) || 'STARTING',
        stateReason: response.StateReason,
        eventStartTime: options.eventStartTime,
        eventEndTime: options.eventEndTime,
        replayStartTime: response.ReplayStartTime,
      };

      return {
        success: true,
        data: replay,
        message: `Replay '${options.replayName}' started`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to start replay: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Cancel an event replay
   */
  async cancelReplay(replayName: string): Promise<AutomationOperationResult<void>> {
    try {
      const command = new CancelReplayCommand({
        ReplayName: replayName,
      });
      await this.eventBridgeClient.send(command);

      return {
        success: true,
        message: `Replay '${replayName}' cancelled`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to cancel replay: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get replay status
   */
  async getReplayStatus(replayName: string): Promise<AutomationOperationResult<EventReplayInfo>> {
    try {
      const command = new DescribeReplayCommand({
        ReplayName: replayName,
      });
      const response = await this.eventBridgeClient.send(command);

      const replay: EventReplayInfo = {
        replayName: response.ReplayName || replayName,
        replayArn: response.ReplayArn || '',
        eventSourceArn: response.EventSourceArn || '',
        destination: {
          arn: response.Destination?.Arn || '',
          filterArns: response.Destination?.FilterArns,
        },
        state: (response.State as EventReplayInfo['state']) || 'STARTING',
        stateReason: response.StateReason,
        eventStartTime: response.EventStartTime || new Date(),
        eventEndTime: response.EventEndTime || new Date(),
        replayStartTime: response.ReplayStartTime,
        replayEndTime: response.ReplayEndTime,
        eventsReplayedCount: 0,
        eventsLastReplayedTime: response.EventLastReplayedTime,
      };

      return {
        success: true,
        data: replay,
        message: `Replay '${replayName}' status: ${replay.state}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get replay status: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // =============================================================================
  // Utility Methods
  // =============================================================================

  /**
   * Get a predefined event pattern by ID
   */
  getPredefinedPattern(patternId: string): EventPattern | null {
    const pattern = PREDEFINED_EVENT_PATTERNS[patternId];
    return pattern ? pattern.pattern : null;
  }

  /**
   * List all predefined event patterns
   */
  listPredefinedPatterns(): Array<{ id: string; name: string; description: string }> {
    return Object.entries(PREDEFINED_EVENT_PATTERNS).map(([id, info]) => ({
      id,
      name: info.name,
      description: info.description,
    }));
  }

  /**
   * Get a schedule expression by ID
   */
  getScheduleExpression(expressionId: string): string | null {
    const expr = SCHEDULE_EXPRESSIONS[expressionId];
    return expr ? expr.expression : null;
  }

  /**
   * List all schedule expressions
   */
  listScheduleExpressions(): Array<{ id: string; name: string; description: string; expression: string }> {
    return Object.entries(SCHEDULE_EXPRESSIONS).map(([id, info]) => ({
      id,
      name: info.name,
      description: info.description,
      expression: info.expression,
    }));
  }

  /**
   * Get a workflow template by ID
   */
  getWorkflowTemplate(templateId: string): WorkflowDefinition | null {
    const template = WORKFLOW_TEMPLATES[templateId];
    return template ? template.workflow : null;
  }

  /**
   * List all workflow templates
   */
  listWorkflowTemplates(): Array<{ id: string; name: string; description: string }> {
    return Object.entries(WORKFLOW_TEMPLATES).map(([id, info]) => ({
      id,
      name: info.name,
      description: info.description,
    }));
  }
}

/**
 * Create an Automation Manager instance
 */
export function createAutomationManager(config?: AutomationManagerConfig): AWSAutomationManager {
  return new AWSAutomationManager(config);
}
