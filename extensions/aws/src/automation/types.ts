/**
 * AWS Event-Driven Automation Types
 *
 * Type definitions for EventBridge rules, Step Functions workflows,
 * automated remediation, scheduling, and event management.
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Automation operation result
 */
export interface AutomationOperationResult<T = void> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/**
 * Automation Manager configuration
 */
export interface AutomationManagerConfig {
  /** Default AWS region */
  defaultRegion?: string;
  /** AWS credentials */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** Default event bus name */
  defaultEventBus?: string;
}

// =============================================================================
// EventBridge Types
// =============================================================================

/**
 * Event bus information
 */
export interface EventBusInfo {
  /** Bus name */
  name: string;
  /** Bus ARN */
  arn: string;
  /** Bus description */
  description?: string;
  /** Policy (JSON) */
  policy?: string;
  /** Is default bus */
  isDefault: boolean;
  /** Creation time */
  createdAt?: Date;
  /** Last modified time */
  lastModifiedAt?: Date;
  /** Tags */
  tags?: Record<string, string>;
}

/**
 * Event rule state
 */
export type EventRuleState = 'ENABLED' | 'DISABLED';

/**
 * Event rule information
 */
export interface EventRuleInfo {
  /** Rule name */
  name: string;
  /** Rule ARN */
  arn: string;
  /** Rule description */
  description?: string;
  /** Event bus name */
  eventBusName: string;
  /** Event pattern (JSON) */
  eventPattern?: string;
  /** Schedule expression (cron/rate) */
  scheduleExpression?: string;
  /** Rule state */
  state: EventRuleState;
  /** Managed by (if managed rule) */
  managedBy?: string;
  /** Role ARN for targets */
  roleArn?: string;
  /** Creation time */
  createdAt?: Date;
  /** Tags */
  tags?: Record<string, string>;
}

/**
 * Event target information
 */
export interface EventTargetInfo {
  /** Target ID */
  id: string;
  /** Target ARN */
  arn: string;
  /** Role ARN for invocation */
  roleArn?: string;
  /** Input to target */
  input?: string;
  /** Input path */
  inputPath?: string;
  /** Input transformer */
  inputTransformer?: {
    inputPathsMap?: Record<string, string>;
    inputTemplate: string;
  };
  /** Retry policy */
  retryPolicy?: {
    maximumRetryAttempts?: number;
    maximumEventAgeInSeconds?: number;
  };
  /** Dead-letter config */
  deadLetterConfig?: {
    arn: string;
  };
}

/**
 * Event pattern for matching events
 */
export interface EventPattern {
  /** Event source */
  source?: string[];
  /** Detail type */
  'detail-type'?: string[];
  /** Account */
  account?: string[];
  /** Region */
  region?: string[];
  /** Resources */
  resources?: string[];
  /** Detail (nested pattern) */
  detail?: Record<string, unknown>;
}

/**
 * Common AWS event sources
 */
export type AWSEventSource =
  | 'aws.ec2'
  | 'aws.rds'
  | 'aws.s3'
  | 'aws.lambda'
  | 'aws.ecs'
  | 'aws.eks'
  | 'aws.autoscaling'
  | 'aws.cloudwatch'
  | 'aws.config'
  | 'aws.guardduty'
  | 'aws.securityhub'
  | 'aws.iam'
  | 'aws.kms'
  | 'aws.health'
  | 'aws.trustedadvisor'
  | 'aws.tag'
  | 'aws.ssm'
  | 'aws.backup'
  | 'aws.codepipeline'
  | 'aws.codebuild'
  | 'aws.cloudformation'
  | 'custom';

/**
 * Target type
 */
export type TargetType =
  | 'lambda'
  | 'sns'
  | 'sqs'
  | 'step-functions'
  | 'ecs-task'
  | 'kinesis'
  | 'firehose'
  | 'ssm-run-command'
  | 'ssm-automation'
  | 'api-gateway'
  | 'http'
  | 'batch';

/**
 * Options for creating an event rule
 */
export interface CreateEventRuleOptions {
  /** Rule name */
  name: string;
  /** Rule description */
  description?: string;
  /** Event bus name */
  eventBusName?: string;
  /** Event pattern */
  eventPattern?: EventPattern;
  /** Schedule expression */
  scheduleExpression?: string;
  /** Initial state */
  state?: EventRuleState;
  /** Role ARN for targets */
  roleArn?: string;
  /** Tags */
  tags?: Record<string, string>;
}

/**
 * Options for adding a target to a rule
 */
export interface AddTargetOptions {
  /** Rule name */
  ruleName: string;
  /** Event bus name */
  eventBusName?: string;
  /** Target ID */
  targetId: string;
  /** Target ARN */
  targetArn: string;
  /** Target type */
  targetType: TargetType;
  /** Role ARN for invocation */
  roleArn?: string;
  /** Input to target */
  input?: string;
  /** Input transformer */
  inputTransformer?: {
    inputPathsMap?: Record<string, string>;
    inputTemplate: string;
  };
  /** Retry policy */
  retryPolicy?: {
    maximumRetryAttempts?: number;
    maximumEventAgeInSeconds?: number;
  };
  /** Dead-letter queue ARN */
  deadLetterQueueArn?: string;
}

/**
 * Options for listing event rules
 */
export interface ListEventRulesOptions {
  /** Event bus name */
  eventBusName?: string;
  /** Name prefix */
  namePrefix?: string;
  /** Maximum results */
  limit?: number;
  /** Next token for pagination */
  nextToken?: string;
}

// =============================================================================
// EventBridge Scheduler Types
// =============================================================================

/**
 * Schedule state
 */
export type ScheduleState = 'ENABLED' | 'DISABLED';

/**
 * Schedule group information
 */
export interface ScheduleGroupInfo {
  /** Group name */
  name: string;
  /** Group ARN */
  arn: string;
  /** State */
  state: 'ACTIVE' | 'DELETING';
  /** Creation date */
  creationDate?: Date;
  /** Last modification date */
  lastModificationDate?: Date;
}

/**
 * Schedule information
 */
export interface ScheduleInfo {
  /** Schedule name */
  name: string;
  /** Schedule ARN */
  arn: string;
  /** Schedule group */
  groupName: string;
  /** Description */
  description?: string;
  /** Schedule expression */
  scheduleExpression: string;
  /** Schedule expression timezone */
  scheduleExpressionTimezone?: string;
  /** State */
  state: ScheduleState;
  /** Start date */
  startDate?: Date;
  /** End date */
  endDate?: Date;
  /** Flexible time window */
  flexibleTimeWindow?: {
    mode: 'OFF' | 'FLEXIBLE';
    maximumWindowInMinutes?: number;
  };
  /** Target */
  target: {
    arn: string;
    roleArn: string;
    input?: string;
  };
  /** Creation date */
  creationDate?: Date;
  /** Last modification date */
  lastModificationDate?: Date;
}

/**
 * Options for creating a schedule
 */
export interface CreateScheduleOptions {
  /** Schedule name */
  name: string;
  /** Schedule group */
  groupName?: string;
  /** Description */
  description?: string;
  /** Schedule expression (cron, rate, or at) */
  scheduleExpression: string;
  /** Timezone */
  timezone?: string;
  /** Initial state */
  state?: ScheduleState;
  /** Start date */
  startDate?: Date;
  /** End date */
  endDate?: Date;
  /** Flexible time window */
  flexibleTimeWindow?: {
    mode: 'OFF' | 'FLEXIBLE';
    maximumWindowInMinutes?: number;
  };
  /** Target ARN */
  targetArn: string;
  /** Target role ARN */
  targetRoleArn: string;
  /** Target input */
  targetInput?: string;
  /** Retry policy */
  retryPolicy?: {
    maximumRetryAttempts?: number;
    maximumEventAgeInSeconds?: number;
  };
  /** Dead-letter config */
  deadLetterConfig?: {
    arn: string;
  };
}

/**
 * Options for listing schedules
 */
export interface ListSchedulesOptions {
  /** Schedule group */
  groupName?: string;
  /** Name prefix */
  namePrefix?: string;
  /** State filter */
  state?: ScheduleState;
  /** Maximum results */
  maxResults?: number;
  /** Next token */
  nextToken?: string;
}

// =============================================================================
// Step Functions Types
// =============================================================================

/**
 * State machine type
 */
export type StateMachineType = 'STANDARD' | 'EXPRESS';

/**
 * State machine status
 */
export type StateMachineStatus = 'ACTIVE' | 'DELETING';

/**
 * State machine information
 */
export interface StateMachineInfo {
  /** State machine ARN */
  arn: string;
  /** State machine name */
  name: string;
  /** Type */
  type: StateMachineType;
  /** Status */
  status: StateMachineStatus;
  /** Definition (ASL JSON) */
  definition?: string;
  /** Role ARN */
  roleArn: string;
  /** Description */
  description?: string;
  /** Creation date */
  creationDate: Date;
  /** Logging configuration */
  loggingConfiguration?: {
    level: 'ALL' | 'ERROR' | 'FATAL' | 'OFF';
    includeExecutionData: boolean;
    destinations?: Array<{
      logGroupArn: string;
    }>;
  };
  /** Tracing configuration */
  tracingConfiguration?: {
    enabled: boolean;
  };
  /** Tags */
  tags?: Record<string, string>;
}

/**
 * Execution status
 */
export type ExecutionStatus =
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'ABORTED'
  | 'PENDING_REDRIVE';

/**
 * Execution information
 */
export interface ExecutionInfo {
  /** Execution ARN */
  executionArn: string;
  /** State machine ARN */
  stateMachineArn: string;
  /** Execution name */
  name: string;
  /** Status */
  status: ExecutionStatus;
  /** Start date */
  startDate: Date;
  /** Stop date */
  stopDate?: Date;
  /** Input */
  input?: string;
  /** Output */
  output?: string;
  /** Error */
  error?: string;
  /** Cause */
  cause?: string;
}

/**
 * ASL State types
 */
export type ASLStateType =
  | 'Task'
  | 'Pass'
  | 'Choice'
  | 'Wait'
  | 'Succeed'
  | 'Fail'
  | 'Parallel'
  | 'Map';

/**
 * ASL State definition
 */
export interface ASLState {
  /** State type */
  Type: ASLStateType;
  /** Comment */
  Comment?: string;
  /** Next state */
  Next?: string;
  /** Is end state */
  End?: boolean;
  /** Resource (for Task) */
  Resource?: string;
  /** Parameters */
  Parameters?: Record<string, unknown>;
  /** Result path */
  ResultPath?: string;
  /** Result selector */
  ResultSelector?: Record<string, unknown>;
  /** Output path */
  OutputPath?: string;
  /** Input path */
  InputPath?: string;
  /** Retry configuration */
  Retry?: Array<{
    ErrorEquals: string[];
    IntervalSeconds?: number;
    MaxAttempts?: number;
    BackoffRate?: number;
  }>;
  /** Catch configuration */
  Catch?: Array<{
    ErrorEquals: string[];
    Next: string;
    ResultPath?: string;
  }>;
  /** Choices (for Choice state) */
  Choices?: Array<{
    Variable: string;
    [key: string]: unknown;
    Next: string;
  }>;
  /** Default (for Choice state) */
  Default?: string;
  /** Branches (for Parallel state) */
  Branches?: ASLDefinition[];
  /** Iterator (for Map state) */
  Iterator?: ASLDefinition;
  /** Items path (for Map state) */
  ItemsPath?: string;
  /** Max concurrency (for Map state) */
  MaxConcurrency?: number;
  /** Seconds (for Wait state) */
  Seconds?: number;
  /** Timestamp (for Wait state) */
  Timestamp?: string;
  /** SecondsPath (for Wait state) */
  SecondsPath?: string;
  /** TimestampPath (for Wait state) */
  TimestampPath?: string;
  /** Result (for Pass state) */
  Result?: unknown;
  /** Error (for Fail state) */
  Error?: string;
  /** Cause (for Fail state) */
  Cause?: string;
}

/**
 * ASL Definition (Amazon States Language)
 */
export interface ASLDefinition {
  /** Comment */
  Comment?: string;
  /** Start state */
  StartAt: string;
  /** States */
  States: Record<string, ASLState>;
  /** Version */
  Version?: string;
  /** Timeout seconds */
  TimeoutSeconds?: number;
}

/**
 * Options for creating a state machine
 */
export interface CreateStateMachineOptions {
  /** State machine name */
  name: string;
  /** State machine type */
  type?: StateMachineType;
  /** ASL definition */
  definition: ASLDefinition;
  /** Role ARN */
  roleArn: string;
  /** Description */
  description?: string;
  /** Logging configuration */
  loggingConfiguration?: {
    level: 'ALL' | 'ERROR' | 'FATAL' | 'OFF';
    includeExecutionData?: boolean;
    logGroupArn?: string;
  };
  /** Enable X-Ray tracing */
  enableTracing?: boolean;
  /** Tags */
  tags?: Record<string, string>;
}

/**
 * Options for starting an execution
 */
export interface StartExecutionOptions {
  /** State machine ARN */
  stateMachineArn: string;
  /** Execution name (optional, auto-generated if not provided) */
  name?: string;
  /** Input (JSON) */
  input?: Record<string, unknown>;
  /** Trace header */
  traceHeader?: string;
}

/**
 * Options for listing executions
 */
export interface ListExecutionsOptions {
  /** State machine ARN */
  stateMachineArn: string;
  /** Status filter */
  statusFilter?: ExecutionStatus;
  /** Maximum results */
  maxResults?: number;
  /** Next token */
  nextToken?: string;
}

/**
 * Options for listing state machines
 */
export interface ListStateMachinesOptions {
  /** Maximum results */
  maxResults?: number;
  /** Next token */
  nextToken?: string;
}

// =============================================================================
// Workflow Builder Types
// =============================================================================

/**
 * Workflow step type
 */
export type WorkflowStepType =
  | 'lambda'
  | 'ecs-task'
  | 'sns-publish'
  | 'sqs-send'
  | 'dynamodb-get'
  | 'dynamodb-put'
  | 's3-get'
  | 's3-put'
  | 'wait'
  | 'choice'
  | 'parallel'
  | 'map'
  | 'pass'
  | 'fail'
  | 'succeed';

/**
 * Workflow step definition
 */
export interface WorkflowStep {
  /** Step name */
  name: string;
  /** Step type */
  type: WorkflowStepType;
  /** Step description */
  description?: string;
  /** Resource ARN (for task steps) */
  resourceArn?: string;
  /** Parameters */
  parameters?: Record<string, unknown>;
  /** Next step name */
  next?: string;
  /** Is end step */
  isEnd?: boolean;
  /** Retry configuration */
  retry?: {
    maxAttempts: number;
    intervalSeconds: number;
    backoffRate: number;
    errors?: string[];
  };
  /** Catch configuration */
  catch?: Array<{
    errors: string[];
    next: string;
  }>;
  /** Condition (for choice steps) */
  conditions?: WorkflowCondition[];
  /** Default next (for choice steps) */
  defaultNext?: string;
  /** Parallel branches */
  branches?: WorkflowStep[][];
  /** Map iterator */
  iterator?: WorkflowStep[];
  /** Items path (for map) */
  itemsPath?: string;
  /** Max concurrency (for map/parallel) */
  maxConcurrency?: number;
  /** Wait duration */
  waitSeconds?: number;
  /** Wait timestamp */
  waitTimestamp?: string;
  /** Error (for fail step) */
  error?: string;
  /** Cause (for fail step) */
  cause?: string;
  /** Result (for pass step) */
  result?: unknown;
}

/**
 * Workflow condition
 */
export interface WorkflowCondition {
  /** Variable to check */
  variable: string;
  /** Comparison operator */
  operator:
    | 'equals'
    | 'not-equals'
    | 'greater-than'
    | 'greater-than-or-equal'
    | 'less-than'
    | 'less-than-or-equal'
    | 'string-equals'
    | 'string-not-equals'
    | 'string-matches'
    | 'is-present'
    | 'is-not-present'
    | 'is-null'
    | 'is-not-null'
    | 'is-string'
    | 'is-numeric'
    | 'is-boolean';
  /** Value to compare */
  value?: unknown;
  /** Next step if condition matches */
  next: string;
}

/**
 * Workflow definition
 */
export interface WorkflowDefinition {
  /** Workflow name */
  name: string;
  /** Workflow description */
  description?: string;
  /** Starting step name */
  startAt: string;
  /** Steps */
  steps: WorkflowStep[];
  /** Timeout in seconds */
  timeoutSeconds?: number;
  /** Version */
  version?: string;
}

/**
 * Options for building a workflow
 */
export interface BuildWorkflowOptions {
  /** Workflow definition */
  workflow: WorkflowDefinition;
  /** Role ARN */
  roleArn: string;
  /** State machine type */
  type?: StateMachineType;
  /** Enable logging */
  enableLogging?: boolean;
  /** Log group ARN */
  logGroupArn?: string;
  /** Enable tracing */
  enableTracing?: boolean;
  /** Tags */
  tags?: Record<string, string>;
}

// =============================================================================
// Automated Remediation Types
// =============================================================================

/**
 * Remediation trigger type
 */
export type RemediationTriggerType =
  | 'config-rule'
  | 'securityhub-finding'
  | 'guardduty-finding'
  | 'cloudwatch-alarm'
  | 'custom-event';

/**
 * Remediation action type
 */
export type RemediationActionType =
  | 'ssm-automation'
  | 'ssm-run-command'
  | 'lambda'
  | 'step-functions';

/**
 * Remediation configuration
 */
export interface RemediationConfig {
  /** Remediation ID */
  id: string;
  /** Remediation name */
  name: string;
  /** Description */
  description?: string;
  /** Trigger type */
  triggerType: RemediationTriggerType;
  /** Trigger configuration */
  triggerConfig: {
    /** Config rule name (for config-rule trigger) */
    configRuleName?: string;
    /** Security Hub finding type (for securityhub-finding trigger) */
    securityHubFindingType?: string;
    /** GuardDuty finding type (for guardduty-finding trigger) */
    guardDutyFindingType?: string;
    /** CloudWatch alarm name (for cloudwatch-alarm trigger) */
    alarmName?: string;
    /** Custom event pattern (for custom-event trigger) */
    eventPattern?: EventPattern;
  };
  /** Action type */
  actionType: RemediationActionType;
  /** Action configuration */
  actionConfig: {
    /** SSM document name (for ssm-automation/ssm-run-command) */
    documentName?: string;
    /** Lambda function ARN (for lambda) */
    lambdaArn?: string;
    /** State machine ARN (for step-functions) */
    stateMachineArn?: string;
    /** Parameters */
    parameters?: Record<string, string[]>;
  };
  /** Automatic remediation */
  automatic: boolean;
  /** Maximum concurrent executions */
  maxConcurrency?: number;
  /** Maximum errors */
  maxErrors?: number;
  /** Resource type filter */
  resourceTypeFilter?: string[];
  /** Is enabled */
  enabled: boolean;
  /** Created at */
  createdAt: Date;
  /** Updated at */
  updatedAt: Date;
}

/**
 * Remediation execution information
 */
export interface RemediationExecution {
  /** Execution ID */
  executionId: string;
  /** Remediation config ID */
  remediationConfigId: string;
  /** Resource ID */
  resourceId: string;
  /** Resource type */
  resourceType: string;
  /** Status */
  status: 'QUEUED' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
  /** Start time */
  startTime: Date;
  /** End time */
  endTime?: Date;
  /** Error message */
  errorMessage?: string;
  /** Execution details */
  executionDetails?: Record<string, unknown>;
}

/**
 * Options for setting up remediation
 */
export interface SetupRemediationOptions {
  /** Remediation name */
  name: string;
  /** Description */
  description?: string;
  /** Trigger type */
  triggerType: RemediationTriggerType;
  /** Trigger configuration */
  triggerConfig: RemediationConfig['triggerConfig'];
  /** Action type */
  actionType: RemediationActionType;
  /** Action configuration */
  actionConfig: RemediationConfig['actionConfig'];
  /** Enable automatic remediation */
  automatic: boolean;
  /** Max concurrent */
  maxConcurrency?: number;
  /** Max errors */
  maxErrors?: number;
  /** Resource type filter */
  resourceTypeFilter?: string[];
}

/**
 * Options for listing remediations
 */
export interface ListRemediationsOptions {
  /** Filter by trigger type */
  triggerType?: RemediationTriggerType;
  /** Filter by enabled */
  enabled?: boolean;
  /** Maximum results */
  limit?: number;
}

// =============================================================================
// Event Archive and Replay Types
// =============================================================================

/**
 * Event archive information
 */
export interface EventArchiveInfo {
  /** Archive name */
  archiveName: string;
  /** Archive ARN */
  archiveArn: string;
  /** Event source ARN */
  eventSourceArn: string;
  /** Description */
  description?: string;
  /** Event pattern filter */
  eventPattern?: string;
  /** State */
  state: 'ENABLED' | 'DISABLED' | 'CREATING' | 'UPDATING' | 'CREATE_FAILED' | 'UPDATE_FAILED';
  /** Retention days */
  retentionDays?: number;
  /** Size in bytes */
  sizeBytes: number;
  /** Event count */
  eventCount: number;
  /** Creation time */
  creationTime: Date;
}

/**
 * Event replay information
 */
export interface EventReplayInfo {
  /** Replay name */
  replayName: string;
  /** Replay ARN */
  replayArn: string;
  /** Event source ARN */
  eventSourceArn: string;
  /** Destination */
  destination: {
    arn: string;
    filterArns?: string[];
  };
  /** State */
  state: 'STARTING' | 'RUNNING' | 'CANCELLING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  /** State reason */
  stateReason?: string;
  /** Event start time (replay from) */
  eventStartTime: Date;
  /** Event end time (replay to) */
  eventEndTime: Date;
  /** Replay start time */
  replayStartTime?: Date;
  /** Replay end time */
  replayEndTime?: Date;
  /** Events replayed count */
  eventsReplayedCount?: number;
  /** Events last replayed time */
  eventsLastReplayedTime?: Date;
}

/**
 * Options for creating an event archive
 */
export interface CreateEventArchiveOptions {
  /** Archive name */
  archiveName: string;
  /** Event source ARN (event bus) */
  eventSourceArn: string;
  /** Description */
  description?: string;
  /** Event pattern filter */
  eventPattern?: EventPattern;
  /** Retention days (0 = indefinite) */
  retentionDays?: number;
}

/**
 * Options for starting an event replay
 */
export interface StartEventReplayOptions {
  /** Replay name */
  replayName: string;
  /** Event source ARN */
  eventSourceArn: string;
  /** Destination ARN */
  destinationArn: string;
  /** Event start time */
  eventStartTime: Date;
  /** Event end time */
  eventEndTime: Date;
  /** Filter ARNs */
  filterArns?: string[];
  /** Description */
  description?: string;
}

/**
 * Options for listing archives
 */
export interface ListEventArchivesOptions {
  /** Event source ARN */
  eventSourceArn?: string;
  /** Name prefix */
  namePrefix?: string;
  /** State filter */
  state?: 'ENABLED' | 'DISABLED' | 'CREATING' | 'UPDATING';
  /** Maximum results */
  limit?: number;
  /** Next token */
  nextToken?: string;
}

// =============================================================================
// Predefined Event Patterns
// =============================================================================

/**
 * Predefined event patterns for common AWS events
 */
export const PREDEFINED_EVENT_PATTERNS: Record<string, {
  name: string;
  description: string;
  pattern: EventPattern;
}> = {
  'ec2-instance-state-change': {
    name: 'EC2 Instance State Change',
    description: 'Triggered when an EC2 instance changes state',
    pattern: {
      source: ['aws.ec2'],
      'detail-type': ['EC2 Instance State-change Notification'],
    },
  },
  'ec2-instance-stopped': {
    name: 'EC2 Instance Stopped',
    description: 'Triggered when an EC2 instance stops',
    pattern: {
      source: ['aws.ec2'],
      'detail-type': ['EC2 Instance State-change Notification'],
      detail: { state: ['stopped'] },
    },
  },
  'ec2-instance-terminated': {
    name: 'EC2 Instance Terminated',
    description: 'Triggered when an EC2 instance is terminated',
    pattern: {
      source: ['aws.ec2'],
      'detail-type': ['EC2 Instance State-change Notification'],
      detail: { state: ['terminated'] },
    },
  },
  's3-bucket-created': {
    name: 'S3 Bucket Created',
    description: 'Triggered when an S3 bucket is created',
    pattern: {
      source: ['aws.s3'],
      'detail-type': ['AWS API Call via CloudTrail'],
      detail: { eventName: ['CreateBucket'] },
    },
  },
  's3-bucket-policy-changed': {
    name: 'S3 Bucket Policy Changed',
    description: 'Triggered when an S3 bucket policy is changed',
    pattern: {
      source: ['aws.s3'],
      'detail-type': ['AWS API Call via CloudTrail'],
      detail: { eventName: ['PutBucketPolicy', 'DeleteBucketPolicy'] },
    },
  },
  's3-bucket-public-access': {
    name: 'S3 Bucket Made Public',
    description: 'Triggered when S3 bucket public access is changed',
    pattern: {
      source: ['aws.s3'],
      'detail-type': ['AWS API Call via CloudTrail'],
      detail: {
        eventName: ['PutBucketPublicAccessBlock', 'DeleteBucketPublicAccessBlock', 'PutBucketAcl'],
      },
    },
  },
  'rds-instance-state-change': {
    name: 'RDS Instance State Change',
    description: 'Triggered when an RDS instance changes state',
    pattern: {
      source: ['aws.rds'],
      'detail-type': ['RDS DB Instance Event'],
    },
  },
  'rds-snapshot-created': {
    name: 'RDS Snapshot Created',
    description: 'Triggered when an RDS snapshot is created',
    pattern: {
      source: ['aws.rds'],
      'detail-type': ['RDS DB Snapshot Event'],
      detail: { EventID: ['RDS-EVENT-0091'] },
    },
  },
  'lambda-function-error': {
    name: 'Lambda Function Error',
    description: 'Triggered when a Lambda function encounters an error',
    pattern: {
      source: ['aws.lambda'],
      'detail-type': ['Lambda Function Invocation Result - Failure'],
    },
  },
  'ecs-task-state-change': {
    name: 'ECS Task State Change',
    description: 'Triggered when an ECS task changes state',
    pattern: {
      source: ['aws.ecs'],
      'detail-type': ['ECS Task State Change'],
    },
  },
  'ecs-deployment-completed': {
    name: 'ECS Deployment Completed',
    description: 'Triggered when an ECS deployment completes',
    pattern: {
      source: ['aws.ecs'],
      'detail-type': ['ECS Deployment State Change'],
      detail: { eventType: ['INFO'], eventName: ['SERVICE_DEPLOYMENT_COMPLETED'] },
    },
  },
  'autoscaling-launch': {
    name: 'Auto Scaling Instance Launch',
    description: 'Triggered when Auto Scaling launches an instance',
    pattern: {
      source: ['aws.autoscaling'],
      'detail-type': ['EC2 Instance Launch Successful'],
    },
  },
  'autoscaling-terminate': {
    name: 'Auto Scaling Instance Terminate',
    description: 'Triggered when Auto Scaling terminates an instance',
    pattern: {
      source: ['aws.autoscaling'],
      'detail-type': ['EC2 Instance Terminate Successful'],
    },
  },
  'config-compliance-change': {
    name: 'Config Compliance Change',
    description: 'Triggered when resource compliance status changes',
    pattern: {
      source: ['aws.config'],
      'detail-type': ['Config Rules Compliance Change'],
    },
  },
  'config-non-compliant': {
    name: 'Config Rule Non-Compliant',
    description: 'Triggered when a resource becomes non-compliant',
    pattern: {
      source: ['aws.config'],
      'detail-type': ['Config Rules Compliance Change'],
      detail: { newEvaluationResult: { complianceType: ['NON_COMPLIANT'] } },
    },
  },
  'guardduty-finding': {
    name: 'GuardDuty Finding',
    description: 'Triggered when GuardDuty detects a finding',
    pattern: {
      source: ['aws.guardduty'],
      'detail-type': ['GuardDuty Finding'],
    },
  },
  'guardduty-high-severity': {
    name: 'GuardDuty High Severity Finding',
    description: 'Triggered when GuardDuty detects a high severity finding',
    pattern: {
      source: ['aws.guardduty'],
      'detail-type': ['GuardDuty Finding'],
      detail: { severity: [{ numeric: ['>=', 7] }] },
    },
  },
  'securityhub-finding': {
    name: 'Security Hub Finding',
    description: 'Triggered when Security Hub receives a finding',
    pattern: {
      source: ['aws.securityhub'],
      'detail-type': ['Security Hub Findings - Imported'],
    },
  },
  'securityhub-critical': {
    name: 'Security Hub Critical Finding',
    description: 'Triggered when Security Hub receives a critical finding',
    pattern: {
      source: ['aws.securityhub'],
      'detail-type': ['Security Hub Findings - Imported'],
      detail: {
        findings: {
          Severity: { Label: ['CRITICAL'] },
        },
      },
    },
  },
  'iam-policy-changed': {
    name: 'IAM Policy Changed',
    description: 'Triggered when an IAM policy is changed',
    pattern: {
      source: ['aws.iam'],
      'detail-type': ['AWS API Call via CloudTrail'],
      detail: {
        eventName: [
          'CreatePolicy', 'DeletePolicy', 'CreatePolicyVersion', 'DeletePolicyVersion',
          'AttachRolePolicy', 'DetachRolePolicy', 'AttachUserPolicy', 'DetachUserPolicy',
          'PutRolePolicy', 'DeleteRolePolicy', 'PutUserPolicy', 'DeleteUserPolicy',
        ],
      },
    },
  },
  'iam-access-key-created': {
    name: 'IAM Access Key Created',
    description: 'Triggered when an IAM access key is created',
    pattern: {
      source: ['aws.iam'],
      'detail-type': ['AWS API Call via CloudTrail'],
      detail: { eventName: ['CreateAccessKey'] },
    },
  },
  'root-account-login': {
    name: 'Root Account Login',
    description: 'Triggered when root account signs in',
    pattern: {
      source: ['aws.signin'],
      'detail-type': ['AWS Console Sign In via CloudTrail'],
      detail: { userIdentity: { type: ['Root'] } },
    },
  },
  'codepipeline-state-change': {
    name: 'CodePipeline State Change',
    description: 'Triggered when a CodePipeline execution changes state',
    pattern: {
      source: ['aws.codepipeline'],
      'detail-type': ['CodePipeline Pipeline Execution State Change'],
    },
  },
  'codepipeline-failed': {
    name: 'CodePipeline Failed',
    description: 'Triggered when a CodePipeline execution fails',
    pattern: {
      source: ['aws.codepipeline'],
      'detail-type': ['CodePipeline Pipeline Execution State Change'],
      detail: { state: ['FAILED'] },
    },
  },
  'codebuild-state-change': {
    name: 'CodeBuild State Change',
    description: 'Triggered when a CodeBuild build changes state',
    pattern: {
      source: ['aws.codebuild'],
      'detail-type': ['CodeBuild Build State Change'],
    },
  },
  'health-event': {
    name: 'AWS Health Event',
    description: 'Triggered when AWS Health reports an event',
    pattern: {
      source: ['aws.health'],
      'detail-type': ['AWS Health Event'],
    },
  },
  'backup-job-completed': {
    name: 'Backup Job Completed',
    description: 'Triggered when an AWS Backup job completes',
    pattern: {
      source: ['aws.backup'],
      'detail-type': ['Backup Job State Change'],
      detail: { state: ['COMPLETED'] },
    },
  },
  'backup-job-failed': {
    name: 'Backup Job Failed',
    description: 'Triggered when an AWS Backup job fails',
    pattern: {
      source: ['aws.backup'],
      'detail-type': ['Backup Job State Change'],
      detail: { state: ['FAILED'] },
    },
  },
};

// =============================================================================
// Predefined Schedule Expressions
// =============================================================================

/**
 * Common schedule expressions
 */
export const SCHEDULE_EXPRESSIONS: Record<string, {
  name: string;
  description: string;
  expression: string;
}> = {
  'every-minute': {
    name: 'Every Minute',
    description: 'Run every minute',
    expression: 'rate(1 minute)',
  },
  'every-5-minutes': {
    name: 'Every 5 Minutes',
    description: 'Run every 5 minutes',
    expression: 'rate(5 minutes)',
  },
  'every-15-minutes': {
    name: 'Every 15 Minutes',
    description: 'Run every 15 minutes',
    expression: 'rate(15 minutes)',
  },
  'every-hour': {
    name: 'Every Hour',
    description: 'Run every hour',
    expression: 'rate(1 hour)',
  },
  'every-day': {
    name: 'Every Day',
    description: 'Run every day at midnight UTC',
    expression: 'cron(0 0 * * ? *)',
  },
  'every-day-9am': {
    name: 'Every Day at 9 AM',
    description: 'Run every day at 9 AM UTC',
    expression: 'cron(0 9 * * ? *)',
  },
  'every-day-6pm': {
    name: 'Every Day at 6 PM',
    description: 'Run every day at 6 PM UTC',
    expression: 'cron(0 18 * * ? *)',
  },
  'weekdays-9am': {
    name: 'Weekdays at 9 AM',
    description: 'Run Monday-Friday at 9 AM UTC',
    expression: 'cron(0 9 ? * MON-FRI *)',
  },
  'weekdays-6pm': {
    name: 'Weekdays at 6 PM',
    description: 'Run Monday-Friday at 6 PM UTC',
    expression: 'cron(0 18 ? * MON-FRI *)',
  },
  'every-week': {
    name: 'Every Week',
    description: 'Run every Sunday at midnight UTC',
    expression: 'cron(0 0 ? * SUN *)',
  },
  'every-month': {
    name: 'Every Month',
    description: 'Run on the 1st of every month at midnight UTC',
    expression: 'cron(0 0 1 * ? *)',
  },
  'first-monday': {
    name: 'First Monday of Month',
    description: 'Run on the first Monday of every month at 9 AM UTC',
    expression: 'cron(0 9 ? * 2#1 *)',
  },
  'last-day-of-month': {
    name: 'Last Day of Month',
    description: 'Run on the last day of every month at midnight UTC',
    expression: 'cron(0 0 L * ? *)',
  },
};

// =============================================================================
// Workflow Templates
// =============================================================================

/**
 * Predefined workflow templates
 */
export const WORKFLOW_TEMPLATES: Record<string, {
  name: string;
  description: string;
  workflow: WorkflowDefinition;
}> = {
  'notify-on-event': {
    name: 'Notify on Event',
    description: 'Send SNS notification when event occurs',
    workflow: {
      name: 'notify-on-event',
      description: 'Send notification when event triggers',
      startAt: 'SendNotification',
      steps: [
        {
          name: 'SendNotification',
          type: 'sns-publish',
          description: 'Send SNS notification',
          parameters: {
            TopicArn: '${SNS_TOPIC_ARN}',
            Message: '$.detail',
          },
          isEnd: true,
        },
      ],
    },
  },
  'approve-and-execute': {
    name: 'Approve and Execute',
    description: 'Wait for approval before executing action',
    workflow: {
      name: 'approve-and-execute',
      description: 'Human approval workflow',
      startAt: 'SendApprovalRequest',
      steps: [
        {
          name: 'SendApprovalRequest',
          type: 'sns-publish',
          description: 'Send approval request',
          parameters: {
            TopicArn: '${APPROVAL_TOPIC_ARN}',
            Message: 'Approval required for: $.action',
          },
          next: 'WaitForApproval',
        },
        {
          name: 'WaitForApproval',
          type: 'wait',
          description: 'Wait for human approval',
          waitSeconds: 86400, // 24 hours
          next: 'CheckApproval',
        },
        {
          name: 'CheckApproval',
          type: 'choice',
          description: 'Check if approved',
          conditions: [
            {
              variable: '$.approved',
              operator: 'equals',
              value: true,
              next: 'ExecuteAction',
            },
          ],
          defaultNext: 'ApprovalDenied',
        },
        {
          name: 'ExecuteAction',
          type: 'lambda',
          description: 'Execute the approved action',
          resourceArn: '${EXECUTE_LAMBDA_ARN}',
          isEnd: true,
        },
        {
          name: 'ApprovalDenied',
          type: 'fail',
          error: 'ApprovalDenied',
          cause: 'The action was not approved',
        },
      ],
    },
  },
  'retry-with-backoff': {
    name: 'Retry with Backoff',
    description: 'Execute action with exponential backoff retry',
    workflow: {
      name: 'retry-with-backoff',
      description: 'Retry action with exponential backoff',
      startAt: 'ExecuteAction',
      steps: [
        {
          name: 'ExecuteAction',
          type: 'lambda',
          description: 'Execute action with retry',
          resourceArn: '${LAMBDA_ARN}',
          retry: {
            maxAttempts: 5,
            intervalSeconds: 5,
            backoffRate: 2,
            errors: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException', 'States.Timeout'],
          },
          catch: [
            {
              errors: ['States.ALL'],
              next: 'HandleError',
            },
          ],
          isEnd: true,
        },
        {
          name: 'HandleError',
          type: 'sns-publish',
          description: 'Send error notification',
          parameters: {
            TopicArn: '${ERROR_TOPIC_ARN}',
            Message: 'Action failed after retries: $.error',
          },
          next: 'MarkFailed',
        },
        {
          name: 'MarkFailed',
          type: 'fail',
          error: 'ActionFailed',
          cause: 'Action failed after all retry attempts',
        },
      ],
    },
  },
  'parallel-processing': {
    name: 'Parallel Processing',
    description: 'Process multiple items in parallel',
    workflow: {
      name: 'parallel-processing',
      description: 'Process items in parallel with error handling',
      startAt: 'ProcessItems',
      steps: [
        {
          name: 'ProcessItems',
          type: 'map',
          description: 'Process each item in parallel',
          itemsPath: '$.items',
          maxConcurrency: 10,
          iterator: [
            {
              name: 'ProcessSingleItem',
              type: 'lambda',
              resourceArn: '${PROCESS_LAMBDA_ARN}',
              isEnd: true,
            },
          ],
          catch: [
            {
              errors: ['States.ALL'],
              next: 'HandleMapError',
            },
          ],
          next: 'AggregateResults',
        },
        {
          name: 'HandleMapError',
          type: 'pass',
          description: 'Handle map error gracefully',
          result: { status: 'partial_failure' },
          next: 'AggregateResults',
        },
        {
          name: 'AggregateResults',
          type: 'lambda',
          description: 'Aggregate processing results',
          resourceArn: '${AGGREGATE_LAMBDA_ARN}',
          isEnd: true,
        },
      ],
    },
  },
  'scheduled-cleanup': {
    name: 'Scheduled Cleanup',
    description: 'Scheduled workflow to clean up old resources',
    workflow: {
      name: 'scheduled-cleanup',
      description: 'Clean up old/unused resources',
      startAt: 'IdentifyResources',
      steps: [
        {
          name: 'IdentifyResources',
          type: 'lambda',
          description: 'Identify resources to clean up',
          resourceArn: '${IDENTIFY_LAMBDA_ARN}',
          next: 'CheckResourcesFound',
        },
        {
          name: 'CheckResourcesFound',
          type: 'choice',
          description: 'Check if any resources found',
          conditions: [
            {
              variable: '$.resourceCount',
              operator: 'greater-than',
              value: 0,
              next: 'CleanupResources',
            },
          ],
          defaultNext: 'NoCleanupNeeded',
        },
        {
          name: 'CleanupResources',
          type: 'map',
          description: 'Clean up each resource',
          itemsPath: '$.resources',
          maxConcurrency: 5,
          iterator: [
            {
              name: 'CleanupSingleResource',
              type: 'lambda',
              resourceArn: '${CLEANUP_LAMBDA_ARN}',
              isEnd: true,
            },
          ],
          next: 'SendReport',
        },
        {
          name: 'NoCleanupNeeded',
          type: 'succeed',
        },
        {
          name: 'SendReport',
          type: 'sns-publish',
          description: 'Send cleanup report',
          parameters: {
            TopicArn: '${REPORT_TOPIC_ARN}',
            Message: 'Cleanup completed. Resources cleaned: $.cleanedCount',
          },
          isEnd: true,
        },
      ],
    },
  },
};

// =============================================================================
// Manager Interface
// =============================================================================

/**
 * Automation Manager interface
 */
export interface AutomationManager {
  // Event Buses
  listEventBuses(): Promise<AutomationOperationResult<EventBusInfo[]>>;
  createEventBus(name: string, description?: string): Promise<AutomationOperationResult<EventBusInfo>>;
  deleteEventBus(name: string): Promise<AutomationOperationResult<void>>;

  // Event Rules
  listEventRules(options?: ListEventRulesOptions): Promise<AutomationOperationResult<EventRuleInfo[]>>;
  getEventRule(name: string, eventBusName?: string): Promise<AutomationOperationResult<EventRuleInfo>>;
  createEventRule(options: CreateEventRuleOptions): Promise<AutomationOperationResult<EventRuleInfo>>;
  updateEventRule(name: string, updates: Partial<CreateEventRuleOptions>): Promise<AutomationOperationResult<EventRuleInfo>>;
  deleteEventRule(name: string, eventBusName?: string): Promise<AutomationOperationResult<void>>;
  enableEventRule(name: string, eventBusName?: string): Promise<AutomationOperationResult<void>>;
  disableEventRule(name: string, eventBusName?: string): Promise<AutomationOperationResult<void>>;

  // Event Targets
  listTargets(ruleName: string, eventBusName?: string): Promise<AutomationOperationResult<EventTargetInfo[]>>;
  addTarget(options: AddTargetOptions): Promise<AutomationOperationResult<void>>;
  removeTarget(ruleName: string, targetId: string, eventBusName?: string): Promise<AutomationOperationResult<void>>;

  // Schedules
  listSchedules(options?: ListSchedulesOptions): Promise<AutomationOperationResult<ScheduleInfo[]>>;
  getSchedule(name: string, groupName?: string): Promise<AutomationOperationResult<ScheduleInfo>>;
  createSchedule(options: CreateScheduleOptions): Promise<AutomationOperationResult<ScheduleInfo>>;
  updateSchedule(name: string, updates: Partial<CreateScheduleOptions>): Promise<AutomationOperationResult<ScheduleInfo>>;
  deleteSchedule(name: string, groupName?: string): Promise<AutomationOperationResult<void>>;

  // State Machines
  listStateMachines(options?: ListStateMachinesOptions): Promise<AutomationOperationResult<StateMachineInfo[]>>;
  getStateMachine(arn: string): Promise<AutomationOperationResult<StateMachineInfo>>;
  createStateMachine(options: CreateStateMachineOptions): Promise<AutomationOperationResult<StateMachineInfo>>;
  updateStateMachine(arn: string, updates: Partial<CreateStateMachineOptions>): Promise<AutomationOperationResult<StateMachineInfo>>;
  deleteStateMachine(arn: string): Promise<AutomationOperationResult<void>>;

  // Executions
  startExecution(options: StartExecutionOptions): Promise<AutomationOperationResult<ExecutionInfo>>;
  stopExecution(executionArn: string, error?: string, cause?: string): Promise<AutomationOperationResult<void>>;
  listExecutions(options: ListExecutionsOptions): Promise<AutomationOperationResult<ExecutionInfo[]>>;
  getExecution(executionArn: string): Promise<AutomationOperationResult<ExecutionInfo>>;

  // Workflow Builder
  buildWorkflow(options: BuildWorkflowOptions): Promise<AutomationOperationResult<StateMachineInfo>>;
  convertToASL(workflow: WorkflowDefinition): ASLDefinition;

  // Automated Remediation
  listRemediations(options?: ListRemediationsOptions): Promise<AutomationOperationResult<RemediationConfig[]>>;
  getRemediation(id: string): Promise<AutomationOperationResult<RemediationConfig>>;
  setupRemediation(options: SetupRemediationOptions): Promise<AutomationOperationResult<RemediationConfig>>;
  updateRemediation(id: string, updates: Partial<SetupRemediationOptions>): Promise<AutomationOperationResult<RemediationConfig>>;
  deleteRemediation(id: string): Promise<AutomationOperationResult<void>>;
  enableRemediation(id: string): Promise<AutomationOperationResult<void>>;
  disableRemediation(id: string): Promise<AutomationOperationResult<void>>;
  triggerRemediation(id: string, resourceId: string): Promise<AutomationOperationResult<RemediationExecution>>;

  // Event Archives and Replay
  listEventArchives(options?: ListEventArchivesOptions): Promise<AutomationOperationResult<EventArchiveInfo[]>>;
  createEventArchive(options: CreateEventArchiveOptions): Promise<AutomationOperationResult<EventArchiveInfo>>;
  deleteEventArchive(archiveName: string): Promise<AutomationOperationResult<void>>;
  startReplay(options: StartEventReplayOptions): Promise<AutomationOperationResult<EventReplayInfo>>;
  cancelReplay(replayName: string): Promise<AutomationOperationResult<void>>;
  getReplayStatus(replayName: string): Promise<AutomationOperationResult<EventReplayInfo>>;

  // Utility Methods
  getPredefinedPattern(patternId: string): EventPattern | null;
  listPredefinedPatterns(): Array<{ id: string; name: string; description: string }>;
  getScheduleExpression(expressionId: string): string | null;
  listScheduleExpressions(): Array<{ id: string; name: string; description: string; expression: string }>;
  getWorkflowTemplate(templateId: string): WorkflowDefinition | null;
  listWorkflowTemplates(): Array<{ id: string; name: string; description: string }>;
}
