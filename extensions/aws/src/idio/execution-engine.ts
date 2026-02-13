/**
 * AWS Execution Engine - Real Infrastructure Provisioning
 * 
 * Executes compiled IDIO plans using actual AWS SDK calls.
 * Manages resource lifecycle, dependency ordering, and rollback.
 */

import { randomUUID } from 'node:crypto';

// AWS SDK Clients
import {
  EC2Client,
  CreateVpcCommand,
  CreateSubnetCommand,
  CreateInternetGatewayCommand,
  AttachInternetGatewayCommand,
  CreateRouteTableCommand,
  CreateRouteCommand,
  AssociateRouteTableCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  CreateNatGatewayCommand,
  AllocateAddressCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DeleteVpcCommand,
  DeleteSubnetCommand,
  DeleteInternetGatewayCommand,
  DetachInternetGatewayCommand,
  DeleteRouteTableCommand,
  DeleteSecurityGroupCommand,
  DeleteNatGatewayCommand,
  ReleaseAddressCommand,
  RunInstancesCommand,
  TerminateInstancesCommand,
  CreateLaunchTemplateCommand,
  DeleteLaunchTemplateCommand,
  type Tag,
  type _InstanceType,
} from '@aws-sdk/client-ec2';

import {
  ECSClient,
  CreateClusterCommand,
  CreateServiceCommand,
  RegisterTaskDefinitionCommand,
  DeleteClusterCommand,
  DeleteServiceCommand,
  DeregisterTaskDefinitionCommand,
} from '@aws-sdk/client-ecs';

import {
  RDSClient,
  CreateDBInstanceCommand,
  CreateDBClusterCommand,
  CreateDBInstanceReadReplicaCommand,
  DeleteDBInstanceCommand,
  DeleteDBClusterCommand,
} from '@aws-sdk/client-rds';

import {
  ElasticLoadBalancingV2Client,
  CreateLoadBalancerCommand,
  CreateTargetGroupCommand,
  CreateListenerCommand,
  DeleteLoadBalancerCommand,
  DeleteTargetGroupCommand,
  DeleteListenerCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';

import {
  AutoScalingClient,
  CreateAutoScalingGroupCommand,
  CreateAutoScalingGroupCommandInput,
  CreateLaunchConfigurationCommand,
  DeleteAutoScalingGroupCommand,
  DeleteLaunchConfigurationCommand,
} from '@aws-sdk/client-auto-scaling';

import {
  IAMClient,
  CreateRoleCommand,
  PutRolePolicyCommand,
  CreateInstanceProfileCommand,
  AddRoleToInstanceProfileCommand,
  DeleteRoleCommand,
  DeleteRolePolicyCommand,
  DeleteInstanceProfileCommand,
  RemoveRoleFromInstanceProfileCommand,
} from '@aws-sdk/client-iam';

import {
  CloudWatchClient,
  PutMetricAlarmCommand,
  PutDashboardCommand,
  DeleteAlarmsCommand,
  DeleteDashboardsCommand,
} from '@aws-sdk/client-cloudwatch';

import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  PutBucketEncryptionCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
} from '@aws-sdk/client-s3';

import {
  KMSClient,
  CreateKeyCommand,
  ScheduleKeyDeletionCommand,
  type KeySpec,
} from '@aws-sdk/client-kms';

import {
  LambdaClient,
  CreateFunctionCommand,
  DeleteFunctionCommand,
  type Runtime,
} from '@aws-sdk/client-lambda';

import {
  ElastiCacheClient,
  CreateReplicationGroupCommand,
  DeleteReplicationGroupCommand,
} from '@aws-sdk/client-elasticache';

import {
  BackupClient,
  CreateBackupPlanCommand,
  DeleteBackupPlanCommand,
} from '@aws-sdk/client-backup';

// Import from existing managers
import { DynamoDBManager, createDynamoDBManager } from '../dynamodb/manager.js';
import { APIGatewayManager, createAPIGatewayManager } from '../apigateway/manager.js';
import { SQSManager, createSQSManager } from '../sqs/manager.js';
import { Route53Manager, createRoute53Manager } from '../route53/manager.js';
import { CognitoManager, createCognitoManager } from '../cognito/manager.js';
import { SNSManager, createSNSManager } from '../sns/manager.js';

import type {
  InfrastructurePlan,
  PlannedResource,
  IntentExecutionResult,
  ProvisionedResource,
  ExecutionError,
} from '../intent/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended provisioned resource with metadata for internal tracking
 * We cast this to ProvisionedResource when returning to external APIs
 */
interface InternalProvisionedResource extends ProvisionedResource {
  metadata?: Record<string, unknown>;
}

/**
 * Get resource name from PlannedResource (which doesn't have a name field)
 */
function getResourceName(resource: PlannedResource): string {
  return (resource.properties.name as string) || resource.id;
}

/**
 * Create an execution error
 */
function createExecutionError(
  phase: ExecutionError['phase'],
  message: string,
  resourceId?: string,
  code?: string
): ExecutionError {
  return {
    phase,
    resourceId,
    message,
    code,
    timestamp: new Date().toISOString(),
  };
}

export interface ExecutionEngineConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** Lazy credential provider — called before each SDK client is built.
   *  Takes priority over static `credentials` when both are set. */
  credentialProvider?: () => Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  }>;
  maxRetries?: number;
  maxConcurrentOperations?: number;
  enableRollback?: boolean;
  dryRun?: boolean;
  defaultTags?: Record<string, string>;
}

export interface ResourceExecutionContext {
  planId: string;
  executionId: string;
  environment: string;
  tags: Tag[];
  createdResources: Map<string, InternalProvisionedResource>;
  dependencies: Map<string, string>; // plannedId -> awsId mapping
  /** Store metadata for rollback */
  resourceMetadata: Map<string, Record<string, unknown>>;
}

export interface ExecutionStep {
  resource: PlannedResource;
  action: 'create' | 'update' | 'delete';
  dependencies: string[];
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'rolled-back';
  error?: string;
  result?: InternalProvisionedResource;
  startTime?: Date;
  endTime?: Date;
}

export interface ExecutionProgress {
  executionId: string;
  planId: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  currentStep?: string;
  elapsedSeconds: number;
  estimatedRemainingSeconds: number;
  status: 'running' | 'completed' | 'failed' | 'rolled-back';
}

// ============================================================================
// Resource Handlers
// ============================================================================

type ResourceHandler = (
  resource: PlannedResource,
  context: ResourceExecutionContext,
  engine: AWSExecutionEngine
) => Promise<InternalProvisionedResource>;

type RollbackHandler = (
  resource: InternalProvisionedResource,
  context: ResourceExecutionContext,
  engine: AWSExecutionEngine
) => Promise<void>;

// ============================================================================
// AWS Execution Engine
// ============================================================================

export class AWSExecutionEngine {
  private config: ExecutionEngineConfig;
  
  // AWS SDK Clients
  readonly ec2: EC2Client;
  readonly ecs: ECSClient;
  readonly rds: RDSClient;
  readonly elb: ElasticLoadBalancingV2Client;
  readonly autoscaling: AutoScalingClient;
  readonly iam: IAMClient;
  readonly cloudwatch: CloudWatchClient;
  readonly s3: S3Client;
  readonly kms: KMSClient;
  readonly lambda: LambdaClient;
  readonly elasticache: ElastiCacheClient;
  readonly backup: BackupClient;

  // Enterprise Service Managers
  readonly dynamodb: DynamoDBManager;
  readonly apigateway: APIGatewayManager;
  readonly sqs: SQSManager;
  readonly route53: Route53Manager;
  readonly cognito: CognitoManager;
  readonly sns: SNSManager;

  // Resource handlers registry
  private createHandlers: Map<string, ResourceHandler>;
  private rollbackHandlers: Map<string, RollbackHandler>;

  // Active executions
  private executions: Map<string, ExecutionStep[]>;
  private executionProgress: Map<string, ExecutionProgress>;

  constructor(config: ExecutionEngineConfig = {}) {
    this.config = {
      region: config.region ?? 'us-east-1',
      maxRetries: config.maxRetries ?? 3,
      maxConcurrentOperations: config.maxConcurrentOperations ?? 5,
      enableRollback: config.enableRollback ?? true,
      dryRun: config.dryRun ?? false,
      defaultTags: config.defaultTags ?? {},
      ...config,
    };

    const clientConfig = {
      region: this.config.region,
      // Prefer the lazy credential provider over static credentials;
      // the AWS SDK v3 accepts both a static object and a () => Promise<Credentials>
      credentials: this.config.credentialProvider ?? this.config.credentials,
      maxAttempts: this.config.maxRetries,
    };

    // Initialize AWS SDK clients
    this.ec2 = new EC2Client(clientConfig);
    this.ecs = new ECSClient(clientConfig);
    this.rds = new RDSClient(clientConfig);
    this.elb = new ElasticLoadBalancingV2Client(clientConfig);
    this.autoscaling = new AutoScalingClient(clientConfig);
    this.iam = new IAMClient(clientConfig);
    this.cloudwatch = new CloudWatchClient(clientConfig);
    this.s3 = new S3Client(clientConfig);
    this.kms = new KMSClient(clientConfig);
    this.lambda = new LambdaClient(clientConfig);
    this.elasticache = new ElastiCacheClient(clientConfig);
    this.backup = new BackupClient(clientConfig);

    // Initialize enterprise managers
    this.dynamodb = createDynamoDBManager({ region: this.config.region, credentials: this.config.credentials });
    this.apigateway = createAPIGatewayManager({ region: this.config.region, credentials: this.config.credentials });
    this.sqs = createSQSManager({ region: this.config.region, credentials: this.config.credentials });
    this.route53 = createRoute53Manager({ region: this.config.region, credentials: this.config.credentials });
    this.cognito = createCognitoManager({ region: this.config.region, credentials: this.config.credentials });
    this.sns = createSNSManager({ region: this.config.region, credentials: this.config.credentials });

    // Initialize handler registries
    this.createHandlers = new Map();
    this.rollbackHandlers = new Map();
    this.executions = new Map();
    this.executionProgress = new Map();

    // Register all resource handlers
    this.registerHandlers();
  }

  // ==========================================================================
  // Handler Registration
  // ==========================================================================

  private registerHandlers(): void {
    // VPC Resources
    this.createHandlers.set('vpc', this.createVPC.bind(this));
    this.rollbackHandlers.set('vpc', this.deleteVPC.bind(this));

    this.createHandlers.set('subnet', this.createSubnet.bind(this));
    this.rollbackHandlers.set('subnet', this.deleteSubnet.bind(this));

    this.createHandlers.set('internet-gateway', this.createInternetGateway.bind(this));
    this.rollbackHandlers.set('internet-gateway', this.deleteInternetGateway.bind(this));

    this.createHandlers.set('nat-gateway', this.createNATGateway.bind(this));
    this.rollbackHandlers.set('nat-gateway', this.deleteNATGateway.bind(this));

    this.createHandlers.set('route-table', this.createRouteTable.bind(this));
    this.rollbackHandlers.set('route-table', this.deleteRouteTable.bind(this));

    this.createHandlers.set('security-group', this.createSecurityGroup.bind(this));
    this.rollbackHandlers.set('security-group', this.deleteSecurityGroup.bind(this));

    // Compute Resources
    this.createHandlers.set('ec2-instance', this.createEC2Instance.bind(this));
    this.rollbackHandlers.set('ec2-instance', this.terminateEC2Instance.bind(this));

    this.createHandlers.set('ecs-cluster', this.createECSCluster.bind(this));
    this.rollbackHandlers.set('ecs-cluster', this.deleteECSCluster.bind(this));

    this.createHandlers.set('ecs-service', this.createECSService.bind(this));
    this.rollbackHandlers.set('ecs-service', this.deleteECSService.bind(this));

    this.createHandlers.set('ecs-task-definition', this.createTaskDefinition.bind(this));
    this.rollbackHandlers.set('ecs-task-definition', this.deleteTaskDefinition.bind(this));

    // Load Balancing
    this.createHandlers.set('alb', this.createALB.bind(this));
    this.rollbackHandlers.set('alb', this.deleteALB.bind(this));

    this.createHandlers.set('target-group', this.createTargetGroup.bind(this));
    this.rollbackHandlers.set('target-group', this.deleteTargetGroup.bind(this));

    // Database Resources
    this.createHandlers.set('rds-instance', this.createRDSInstance.bind(this));
    this.rollbackHandlers.set('rds-instance', this.deleteRDSInstance.bind(this));

    this.createHandlers.set('rds-cluster', this.createRDSCluster.bind(this));
    this.rollbackHandlers.set('rds-cluster', this.deleteRDSCluster.bind(this));

    this.createHandlers.set('dynamodb-table', this.createDynamoDBTable.bind(this));
    this.rollbackHandlers.set('dynamodb-table', this.deleteDynamoDBTable.bind(this));

    // Storage Resources
    this.createHandlers.set('s3-bucket', this.createS3Bucket.bind(this));
    this.rollbackHandlers.set('s3-bucket', this.deleteS3Bucket.bind(this));

    // Security Resources
    this.createHandlers.set('iam-role', this.createIAMRole.bind(this));
    this.rollbackHandlers.set('iam-role', this.deleteIAMRole.bind(this));

    this.createHandlers.set('kms-key', this.createKMSKey.bind(this));
    this.rollbackHandlers.set('kms-key', this.deleteKMSKey.bind(this));

    // Messaging Resources
    this.createHandlers.set('sqs-queue', this.createSQSQueue.bind(this));
    this.rollbackHandlers.set('sqs-queue', this.deleteSQSQueue.bind(this));

    this.createHandlers.set('sns-topic', this.createSNSTopic.bind(this));
    this.rollbackHandlers.set('sns-topic', this.deleteSNSTopic.bind(this));

    // API Resources
    this.createHandlers.set('api-gateway', this.createAPIGateway.bind(this));
    this.rollbackHandlers.set('api-gateway', this.deleteAPIGateway.bind(this));

    // Monitoring Resources
    this.createHandlers.set('cloudwatch-alarm', this.createCloudWatchAlarm.bind(this));
    this.rollbackHandlers.set('cloudwatch-alarm', this.deleteCloudWatchAlarm.bind(this));

    this.createHandlers.set('cloudwatch-dashboard', this.createCloudWatchDashboard.bind(this));
    this.rollbackHandlers.set('cloudwatch-dashboard', this.deleteCloudWatchDashboard.bind(this));

    // Compute Resources (additional)
    this.createHandlers.set('lambda-function', this.createLambdaFunction.bind(this));
    this.rollbackHandlers.set('lambda-function', this.deleteLambdaFunction.bind(this));

    this.createHandlers.set('launch-template', this.createLaunchTemplate.bind(this));
    this.rollbackHandlers.set('launch-template', this.deleteLaunchTemplate.bind(this));

    this.createHandlers.set('autoscaling-group', this.createAutoScalingGroup.bind(this));
    this.rollbackHandlers.set('autoscaling-group', this.deleteAutoScalingGroup.bind(this));

    // Cache Resources
    this.createHandlers.set('elasticache-cluster', this.createElastiCacheCluster.bind(this));
    this.rollbackHandlers.set('elasticache-cluster', this.deleteElastiCacheCluster.bind(this));

    // Database Resources (additional)
    this.createHandlers.set('rds-read-replica', this.createRDSReadReplica.bind(this));
    this.rollbackHandlers.set('rds-read-replica', this.deleteRDSReadReplica.bind(this));

    // Backup Resources
    this.createHandlers.set('backup-plan', this.createBackupPlan.bind(this));
    this.rollbackHandlers.set('backup-plan', this.deleteBackupPlan.bind(this));

    // Backup copy actions are part of backup plans, registered as no-op for plan completeness
    this.createHandlers.set('backup-copy-action', this.createBackupCopyAction.bind(this));
    this.rollbackHandlers.set('backup-copy-action', this.deleteBackupCopyAction.bind(this));
  }

  // ==========================================================================
  // Main Execution Methods
  // ==========================================================================

  /**
   * Execute an infrastructure plan
   */
  async execute(plan: InfrastructurePlan): Promise<IntentExecutionResult> {
    const executionId = randomUUID();
    const startTime = new Date();

    // Create execution context
    const context: ResourceExecutionContext = {
      planId: plan.id,
      executionId,
      environment: plan.intent.environment,
      tags: this.buildTags(plan),
      createdResources: new Map(),
      dependencies: new Map(),
      resourceMetadata: new Map(),
    };

    // Create execution steps from plan
    const steps = this.createExecutionSteps(plan);
    this.executions.set(executionId, steps);

    // Initialize progress tracking
    this.executionProgress.set(executionId, {
      executionId,
      planId: plan.id,
      totalSteps: steps.length,
      completedSteps: 0,
      failedSteps: 0,
      elapsedSeconds: 0,
      estimatedRemainingSeconds: steps.length * 30, // Rough estimate
      status: 'running',
    });

    const result: IntentExecutionResult = {
      executionId,
      planId: plan.id,
      status: 'in-progress',
      provisionedResources: [],
      errors: [],
      startedAt: startTime.toISOString(),
      rollbackTriggered: false,
    };

    try {
      // Execute steps in dependency order
      await this.executeStepsInOrder(steps, context);

      // Collect results (strip internal metadata before returning)
      result.provisionedResources = Array.from(context.createdResources.values()).map(r => ({
        plannedId: r.plannedId,
        awsId: r.awsId,
        type: r.type,
        status: r.status,
        region: r.region,
        endpoints: r.endpoints,
      }));
      result.status = 'completed';
      result.completedAt = new Date().toISOString();

      // Update progress
      const progress = this.executionProgress.get(executionId)!;
      progress.status = 'completed';
      progress.elapsedSeconds = (Date.now() - startTime.getTime()) / 1000;
      progress.estimatedRemainingSeconds = 0;

    } catch (error) {
      result.status = 'failed';
      result.errors.push(createExecutionError(
        'provisioning',
        error instanceof Error ? error.message : String(error),
        undefined,
        error instanceof Error ? error.name : undefined
      ));

      // Trigger rollback if enabled
      if (this.config.enableRollback) {
        result.rollbackTriggered = true;
        await this.rollback(executionId, context);
      }

      // Update progress
      const progress = this.executionProgress.get(executionId)!;
      progress.status = result.rollbackTriggered ? 'rolled-back' : 'failed';
    }

    return result;
  }

  /**
   * Execute steps respecting dependencies
   */
  private async executeStepsInOrder(
    steps: ExecutionStep[],
    context: ResourceExecutionContext
  ): Promise<void> {
    const completed = new Set<string>();
    const pending = new Set(steps.map(s => s.resource.id));

    while (pending.size > 0) {
      // Find steps ready to execute (all dependencies satisfied)
      const readySteps = steps.filter(s => 
        pending.has(s.resource.id) &&
        s.dependencies.every(dep => completed.has(dep))
      );

      if (readySteps.length === 0 && pending.size > 0) {
        throw new Error('Circular dependency detected in execution plan');
      }

      // Execute ready steps in parallel (up to max concurrent)
      const batch = readySteps.slice(0, this.config.maxConcurrentOperations);
      
      // Use allSettled so we wait for every in-flight operation to finish.
      // If any step fails, resources created by siblings are still tracked
      // and can be rolled back — no orphaned AWS resources.
      const settlements = await Promise.allSettled(batch.map(async step => {
        step.status = 'in-progress';
        step.startTime = new Date();

        try {
          const handler = this.createHandlers.get(step.resource.type);
          
          if (!handler) {
            throw new Error(`No handler for resource type: ${step.resource.type}`);
          }

          if (this.config.dryRun) {
            // Dry run - simulate success
            step.result = {
              plannedId: step.resource.id,
              awsId: `dry-run:${step.resource.type}:${step.resource.id}`,
              type: step.resource.type,
              status: 'available', // Use valid status
              region: step.resource.region,
            };
          } else {
            step.result = await handler(step.resource, context, this);
          }

          if (step.result) {
            context.createdResources.set(step.resource.id, step.result);
            context.dependencies.set(step.resource.id, step.result.awsId);
            // Store metadata for rollback
            if (step.result.metadata) {
              context.resourceMetadata.set(step.resource.id, step.result.metadata);
            }
          }
          
          step.status = 'completed';
          step.endTime = new Date();
          completed.add(step.resource.id);
          pending.delete(step.resource.id);

          // Update progress
          const progress = this.executionProgress.get(context.executionId)!;
          progress.completedSteps++;
          progress.currentStep = undefined;

        } catch (error) {
          step.status = 'failed';
          step.error = error instanceof Error ? error.message : String(error);
          step.endTime = new Date();

          // Update progress
          const progress = this.executionProgress.get(context.executionId)!;
          progress.failedSteps++;

          throw error;
        }
      }));

      // If any step in the batch failed, surface the first error.
      // All sibling resources that succeeded are already tracked in
      // context.createdResources, so rollback will clean them up.
      const firstFailure = settlements.find(
        (s): s is PromiseRejectedResult => s.status === 'rejected'
      );
      if (firstFailure) {
        throw firstFailure.reason;
      }
    }
  }

  /**
   * Rollback created resources.
   * Called internally on execution failure and can be called externally
   * by the orchestrator for user-initiated rollbacks.
   */
  async rollback(
    executionId: string,
    context?: ResourceExecutionContext
  ): Promise<void> {
    const steps = this.executions.get(executionId);
    if (!steps) return;

    // Rollback all resources that produced a result, regardless of step status.
    // This covers both fully completed steps AND resources that were created
    // by in-flight operations that succeeded after a sibling step failed.
    const stepsWithResources = steps
      .filter(s => s.result != null)
      .reverse();

    for (const step of stepsWithResources) {
      try {
        const handler = this.rollbackHandlers.get(step.resource.type);
        
        if (handler && step.result && context) {
          await handler(step.result, context!, this);
          step.status = 'rolled-back';
        }
      } catch (error) {
        // Log rollback error but continue with other resources
        console.error(`Rollback failed for ${step.resource.id}:`, error);
      }
    }
  }

  /**
   * Get execution progress
   */
  getProgress(executionId: string): ExecutionProgress | undefined {
    return this.executionProgress.get(executionId);
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private createExecutionSteps(plan: InfrastructurePlan): ExecutionStep[] {
    return plan.resources.map(resource => ({
      resource,
      action: 'create',
      dependencies: resource.dependencies || [],
      status: 'pending',
    }));
  }

  private buildTags(plan: InfrastructurePlan): Tag[] {
    const tags: Tag[] = [
      { Key: 'Environment', Value: plan.intent.environment },
      { Key: 'Application', Value: plan.intent.name },
      { Key: 'ManagedBy', Value: 'IDIO' },
      { Key: 'PlanId', Value: plan.id },
    ];

    // Add default tags
    for (const [key, value] of Object.entries(this.config.defaultTags ?? {})) {
      tags.push({ Key: key, Value: value });
    }

    return tags;
  }

  private resolveDependency(plannedId: string, context: ResourceExecutionContext): string {
    const awsId = context.dependencies.get(plannedId);
    if (!awsId) {
      throw new Error(`Dependency ${plannedId} not yet created`);
    }
    return awsId;
  }

  // ==========================================================================
  // VPC Resource Handlers
  // ==========================================================================

  private async createVPC(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);
    
    // Validate no CIDR conflicts with existing VPCs in the region
    const existing = await this.ec2.send(new DescribeVpcsCommand({}));
    const conflict = existing.Vpcs?.find(v => v.CidrBlock === (props.cidrBlock as string));
    if (conflict) {
      throw new Error(
        `CIDR block ${props.cidrBlock} conflicts with existing VPC ${conflict.VpcId}`
      );
    }

    const response = await this.ec2.send(new CreateVpcCommand({
      CidrBlock: props.cidrBlock as string,
      TagSpecifications: [{
        ResourceType: 'vpc',
        Tags: [...context.tags, { Key: 'Name', Value: resourceName }],
      }],
    }));

    return {
      plannedId: resource.id,
      awsId: response.Vpc!.VpcId!,
      type: 'vpc',
      status: 'available',
      region: resource.region,
      metadata: {
        cidrBlock: response.Vpc!.CidrBlock,
        state: response.Vpc!.State,
      },
    };
  }

  private async deleteVPC(
    resource: InternalProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    await this.ec2.send(new DeleteVpcCommand({
      VpcId: resource.awsId,
    }));
  }

  private async createSubnet(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const vpcId = this.resolveDependency(props.vpcId as string, context);
    const resourceName = getResourceName(resource);

    // Validate no CIDR conflicts with existing subnets in the target VPC
    const existingSubnets = await this.ec2.send(new DescribeSubnetsCommand({
      Filters: [{ Name: 'vpc-id', Values: [vpcId] }],
    }));
    const conflict = existingSubnets.Subnets?.find(
      s => s.CidrBlock === (props.cidrBlock as string)
    );
    if (conflict) {
      throw new Error(
        `CIDR block ${props.cidrBlock} conflicts with existing subnet ${conflict.SubnetId} in VPC ${vpcId}`
      );
    }

    const response = await this.ec2.send(new CreateSubnetCommand({
      VpcId: vpcId,
      CidrBlock: props.cidrBlock as string,
      AvailabilityZone: props.availabilityZone as string | undefined,
      TagSpecifications: [{
        ResourceType: 'subnet',
        Tags: [...context.tags, { Key: 'Name', Value: resourceName }],
      }],
    }));

    return {
      plannedId: resource.id,
      awsId: response.Subnet!.SubnetId!,
      type: 'subnet',
      status: 'available',
      region: resource.region,
      metadata: {
        vpcId,
        cidrBlock: response.Subnet!.CidrBlock,
        availabilityZone: response.Subnet!.AvailabilityZone,
      },
    };
  }

  private async deleteSubnet(
    resource: InternalProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    await this.ec2.send(new DeleteSubnetCommand({
      SubnetId: resource.awsId,
    }));
  }

  private async createInternetGateway(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);
    
    const response = await this.ec2.send(new CreateInternetGatewayCommand({
      TagSpecifications: [{
        ResourceType: 'internet-gateway',
        Tags: [...context.tags, { Key: 'Name', Value: resourceName }],
      }],
    }));

    const igwId = response.InternetGateway!.InternetGatewayId!;

    // Attach to VPC if specified
    if (props.vpcId) {
      const vpcId = this.resolveDependency(props.vpcId as string, context);
      await this.ec2.send(new AttachInternetGatewayCommand({
        InternetGatewayId: igwId,
        VpcId: vpcId,
      }));
    }

    return {
      plannedId: resource.id,
      awsId: igwId,
      type: 'internet-gateway',
      status: 'available',
      region: resource.region,
    };
  }

  private async deleteInternetGateway(
    resource: InternalProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    // Detach from all VPCs first
    const vpcId = resource.metadata?.vpcId as string | undefined;
    if (vpcId) {
      await this.ec2.send(new DetachInternetGatewayCommand({
        InternetGatewayId: resource.awsId,
        VpcId: vpcId,
      }));
    }

    await this.ec2.send(new DeleteInternetGatewayCommand({
      InternetGatewayId: resource.awsId,
    }));
  }

  private async createNATGateway(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const subnetId = this.resolveDependency(props.subnetId as string, context);
    const resourceName = getResourceName(resource);

    // Allocate Elastic IP
    const eipResponse = await this.ec2.send(new AllocateAddressCommand({
      Domain: 'vpc',
      TagSpecifications: [{
        ResourceType: 'elastic-ip',
        Tags: [...context.tags, { Key: 'Name', Value: `${resourceName}-eip` }],
      }],
    }));

    const response = await this.ec2.send(new CreateNatGatewayCommand({
      SubnetId: subnetId,
      AllocationId: eipResponse.AllocationId!,
      TagSpecifications: [{
        ResourceType: 'natgateway',
        Tags: [...context.tags, { Key: 'Name', Value: resourceName }],
      }],
    }));

    const result: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: response.NatGateway!.NatGatewayId!,
      type: 'nat-gateway',
      status: 'creating',
      region: resource.region,
    };
    context.resourceMetadata.set(resource.id, {
      allocationId: eipResponse.AllocationId,
      subnetId,
    });
    return result;
  }

  private async deleteNATGateway(
    resource: ProvisionedResource,
    context: ResourceExecutionContext
  ): Promise<void> {
    await this.ec2.send(new DeleteNatGatewayCommand({
      NatGatewayId: resource.awsId,
    }));

    // Release Elastic IP
    const metadata = context.resourceMetadata.get(resource.plannedId);
    if (metadata?.allocationId) {
      await this.ec2.send(new ReleaseAddressCommand({
        AllocationId: metadata.allocationId as string,
      }));
    }
  }

  private async createRouteTable(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const vpcId = this.resolveDependency(props.vpcId as string, context);
    const resourceName = getResourceName(resource);

    const response = await this.ec2.send(new CreateRouteTableCommand({
      VpcId: vpcId,
      TagSpecifications: [{
        ResourceType: 'route-table',
        Tags: [...context.tags, { Key: 'Name', Value: resourceName }],
      }],
    }));

    const routeTableId = response.RouteTable!.RouteTableId!;

    // Add routes
    const routes = props.routes as Array<{ destinationCidr: string; targetId: string; targetType: string }> | undefined;
    if (routes) {
      for (const route of routes) {
        const targetId = this.resolveDependency(route.targetId, context);
        
        const routeParams: Record<string, unknown> = {
          RouteTableId: routeTableId,
          DestinationCidrBlock: route.destinationCidr,
        };

        if (route.targetType === 'internet-gateway') {
          routeParams.GatewayId = targetId;
        } else if (route.targetType === 'nat-gateway') {
          routeParams.NatGatewayId = targetId;
        }

        await this.ec2.send(new CreateRouteCommand(routeParams as any));
      }
    }

    // Associate with subnets
    const subnetIds = props.subnetIds as string[] | undefined;
    if (subnetIds) {
      for (const subnetId of subnetIds) {
        const awsSubnetId = this.resolveDependency(subnetId, context);
        await this.ec2.send(new AssociateRouteTableCommand({
          RouteTableId: routeTableId,
          SubnetId: awsSubnetId,
        }));
      }
    }

    const result: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: routeTableId,
      type: 'route-table',
      status: 'available',
      region: resource.region,
    };
    context.resourceMetadata.set(resource.id, { vpcId });
    return result;
  }

  private async deleteRouteTable(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    await this.ec2.send(new DeleteRouteTableCommand({
      RouteTableId: resource.awsId,
    }));
  }

  private async createSecurityGroup(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const vpcId = this.resolveDependency(props.vpcId as string, context);
    const resourceName = getResourceName(resource);

    const response = await this.ec2.send(new CreateSecurityGroupCommand({
      GroupName: resourceName,
      Description: props.description as string || `Security group for ${resourceName}`,
      VpcId: vpcId,
      TagSpecifications: [{
        ResourceType: 'security-group',
        Tags: [...context.tags, { Key: 'Name', Value: resourceName }],
      }],
    }));

    const groupId = response.GroupId!;

    // Add ingress rules
    const ingressRules = props.ingressRules as Array<{
      protocol: string;
      fromPort: number;
      toPort: number;
      cidrBlocks?: string[];
      sourceSecurityGroupId?: string;
    }> | undefined;

    if (ingressRules) {
      for (const rule of ingressRules) {
        await this.ec2.send(new AuthorizeSecurityGroupIngressCommand({
          GroupId: groupId,
          IpProtocol: rule.protocol,
          FromPort: rule.fromPort,
          ToPort: rule.toPort,
          CidrIp: rule.cidrBlocks?.[0],
        }));
      }
    }

    const result: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: groupId,
      type: 'security-group',
      status: 'available',
      region: resource.region,
    };
    context.resourceMetadata.set(resource.id, { vpcId });
    return result;
  }

  private async deleteSecurityGroup(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    await this.ec2.send(new DeleteSecurityGroupCommand({
      GroupId: resource.awsId,
    }));
  }

  // ==========================================================================
  // Compute Resource Handlers
  // ==========================================================================

  private async createEC2Instance(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);
    
    const subnetId = props.subnetId 
      ? this.resolveDependency(props.subnetId as string, context)
      : undefined;
    
    const securityGroupIds = props.securityGroupIds
      ? (props.securityGroupIds as string[]).map(id => this.resolveDependency(id, context))
      : undefined;

    const response = await this.ec2.send(new RunInstancesCommand({
      ImageId: props.imageId as string,
      InstanceType: props.instanceType as _InstanceType,
      MinCount: 1,
      MaxCount: 1,
      SubnetId: subnetId,
      SecurityGroupIds: securityGroupIds,
      KeyName: props.keyName as string | undefined,
      TagSpecifications: [{
        ResourceType: 'instance',
        Tags: [...context.tags, { Key: 'Name', Value: resourceName }],
      }],
    }));

    const result: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: response.Instances![0].InstanceId!,
      type: 'ec2-instance',
      status: 'creating',
      region: resource.region,
    };
    context.resourceMetadata.set(resource.id, {
      instanceType: props.instanceType,
      imageId: props.imageId,
    });
    return result;
  }

  private async terminateEC2Instance(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    await this.ec2.send(new TerminateInstancesCommand({
      InstanceIds: [resource.awsId],
    }));
  }

  private async createECSCluster(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    const response = await this.ecs.send(new CreateClusterCommand({
      clusterName: resourceName,
      capacityProviders: props.capacityProviders as string[] | undefined,
      settings: props.containerInsights ? [{
        name: 'containerInsights',
        value: 'enabled',
      }] : undefined,
      tags: context.tags.map(t => ({ key: t.Key!, value: t.Value! })),
    }));

    const result: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: response.cluster!.clusterArn!,
      type: 'ecs-cluster',
      status: 'available',
      region: resource.region,
    };
    context.resourceMetadata.set(resource.id, {
      clusterName: response.cluster!.clusterName,
    });
    return result;
  }

  private async deleteECSCluster(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    await this.ecs.send(new DeleteClusterCommand({
      cluster: resource.awsId,
    }));
  }

  private async createECSService(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const clusterArn = this.resolveDependency(props.clusterId as string, context);
    const taskDefinitionArn = this.resolveDependency(props.taskDefinitionId as string, context);
    const resourceName = getResourceName(resource);

    const response = await this.ecs.send(new CreateServiceCommand({
      cluster: clusterArn,
      serviceName: resourceName,
      taskDefinition: taskDefinitionArn,
      desiredCount: props.desiredCount as number || 1,
      launchType: props.launchType as 'EC2' | 'FARGATE' | undefined,
      tags: context.tags.map(t => ({ key: t.Key!, value: t.Value! })),
    }));

    const result: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: response.service!.serviceArn!,
      type: 'ecs-service',
      status: 'available',
      region: resource.region,
    };
    context.resourceMetadata.set(resource.id, {
      serviceName: response.service!.serviceName,
      clusterArn,
    });
    return result;
  }

  private async deleteECSService(
    resource: ProvisionedResource,
    context: ResourceExecutionContext
  ): Promise<void> {
    const metadata = context.resourceMetadata.get(resource.plannedId);
    await this.ecs.send(new DeleteServiceCommand({
      cluster: metadata?.clusterArn as string,
      service: resource.awsId,
      force: true,
    }));
  }

  private async createTaskDefinition(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    const response = await this.ecs.send(new RegisterTaskDefinitionCommand({
      family: resourceName,
      containerDefinitions: props.containers as any[],
      cpu: props.cpu as string | undefined,
      memory: props.memory as string | undefined,
      networkMode: props.networkMode as 'awsvpc' | 'bridge' | 'host' | 'none' | undefined,
      requiresCompatibilities: props.requiresCompatibilities as ('EC2' | 'FARGATE')[] | undefined,
      executionRoleArn: props.executionRoleArn as string | undefined,
      taskRoleArn: props.taskRoleArn as string | undefined,
      tags: context.tags.map(t => ({ key: t.Key!, value: t.Value! })),
    }));

    const result: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: response.taskDefinition!.taskDefinitionArn!,
      type: 'ecs-task-definition',
      status: 'available',
      region: resource.region,
    };
    context.resourceMetadata.set(resource.id, {
      family: response.taskDefinition!.family,
      revision: response.taskDefinition!.revision,
    });
    return result;
  }

  private async deleteTaskDefinition(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    await this.ecs.send(new DeregisterTaskDefinitionCommand({
      taskDefinition: resource.awsId,
    }));
  }

  // ==========================================================================
  // Load Balancer Handlers
  // ==========================================================================

  private async createALB(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);
    
    const subnetIds = (props.subnetIds as string[]).map(id => 
      this.resolveDependency(id, context)
    );
    
    const securityGroupIds = props.securityGroupIds
      ? (props.securityGroupIds as string[]).map(id => this.resolveDependency(id, context))
      : undefined;

    const response = await this.elb.send(new CreateLoadBalancerCommand({
      Name: resourceName,
      Subnets: subnetIds,
      SecurityGroups: securityGroupIds,
      Scheme: props.internal ? 'internal' : 'internet-facing',
      Type: 'application',
      Tags: context.tags.map(t => ({ Key: t.Key!, Value: t.Value! })),
    }));

    const albArn = response.LoadBalancers![0].LoadBalancerArn!;

    // Create a default listener if a target group is specified
    let listenerArn: string | undefined;
    const targetGroupArn = props.defaultTargetGroupArn as string | undefined;
    if (targetGroupArn) {
      const resolvedTgArn = this.resolveDependency(targetGroupArn, context);
      const listenerResponse = await this.elb.send(new CreateListenerCommand({
        LoadBalancerArn: albArn,
        Protocol: (props.listenerProtocol as string as 'HTTP' | 'HTTPS') ?? 'HTTP',
        Port: (props.listenerPort as number) ?? 80,
        DefaultActions: [{
          Type: 'forward',
          TargetGroupArn: resolvedTgArn,
        }],
      }));
      listenerArn = listenerResponse.Listeners?.[0]?.ListenerArn;
    }

    const result: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: albArn,
      type: 'alb',
      status: 'creating',
      region: resource.region,
    };
    context.resourceMetadata.set(resource.id, {
      dnsName: response.LoadBalancers![0].DNSName,
      listenerArn,
    });
    return result;
  }

  private async deleteALB(
    resource: ProvisionedResource,
    context: ResourceExecutionContext
  ): Promise<void> {
    // Delete the listener first if one was created
    const metadata = context.resourceMetadata.get(resource.plannedId);
    const listenerArn = metadata?.listenerArn as string | undefined;
    if (listenerArn) {
      await this.elb.send(new DeleteListenerCommand({
        ListenerArn: listenerArn,
      }));
    }

    await this.elb.send(new DeleteLoadBalancerCommand({
      LoadBalancerArn: resource.awsId,
    }));
  }

  private async createTargetGroup(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const vpcId = this.resolveDependency(props.vpcId as string, context);
    const resourceName = getResourceName(resource);

    const response = await this.elb.send(new CreateTargetGroupCommand({
      Name: resourceName,
      Protocol: props.protocol as 'HTTP' | 'HTTPS',
      Port: props.port as number,
      VpcId: vpcId,
      TargetType: props.targetType as 'instance' | 'ip' | 'lambda' | 'alb' | undefined,
      HealthCheckPath: props.healthCheckPath as string | undefined,
      Tags: context.tags.map(t => ({ Key: t.Key!, Value: t.Value! })),
    }));

    return {
      plannedId: resource.id,
      awsId: response.TargetGroups![0].TargetGroupArn!,
      type: 'target-group',
      status: 'available',
      region: resource.region,
    };
  }

  private async deleteTargetGroup(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    await this.elb.send(new DeleteTargetGroupCommand({
      TargetGroupArn: resource.awsId,
    }));
  }

  // ==========================================================================
  // Database Handlers
  // ==========================================================================

  private async createRDSInstance(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    const securityGroupIds = props.securityGroupIds
      ? (props.securityGroupIds as string[]).map(id => this.resolveDependency(id, context))
      : undefined;

    const response = await this.rds.send(new CreateDBInstanceCommand({
      DBInstanceIdentifier: resourceName,
      DBInstanceClass: props.instanceClass as string,
      Engine: props.engine as string,
      EngineVersion: props.engineVersion as string | undefined,
      MasterUsername: props.masterUsername as string,
      MasterUserPassword: props.masterPassword as string,
      AllocatedStorage: props.allocatedStorage as number,
      StorageType: props.storageType as string | undefined,
      VpcSecurityGroupIds: securityGroupIds,
      MultiAZ: props.multiAZ as boolean | undefined,
      StorageEncrypted: props.encrypted as boolean | undefined,
      Tags: context.tags.map(t => ({ Key: t.Key!, Value: t.Value! })),
    }));

    const result: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: response.DBInstance!.DBInstanceArn!,
      type: 'rds-instance',
      status: 'creating',
      region: resource.region,
      endpoints: [response.DBInstance!.Endpoint?.Address || ''],
    };
    context.resourceMetadata.set(resource.id, {
      endpoint: response.DBInstance!.Endpoint?.Address,
      port: response.DBInstance!.Endpoint?.Port,
    });
    return result;
  }

  private async deleteRDSInstance(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    const identifier = resource.awsId.split(':').pop();
    await this.rds.send(new DeleteDBInstanceCommand({
      DBInstanceIdentifier: identifier,
      SkipFinalSnapshot: true,
    }));
  }

  private async createRDSCluster(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    const securityGroupIds = props.securityGroupIds
      ? (props.securityGroupIds as string[]).map(id => this.resolveDependency(id, context))
      : undefined;

    const response = await this.rds.send(new CreateDBClusterCommand({
      DBClusterIdentifier: resourceName,
      Engine: props.engine as string,
      EngineVersion: props.engineVersion as string | undefined,
      MasterUsername: props.masterUsername as string,
      MasterUserPassword: props.masterPassword as string,
      VpcSecurityGroupIds: securityGroupIds,
      StorageEncrypted: props.encrypted as boolean | undefined,
      Tags: context.tags.map(t => ({ Key: t.Key!, Value: t.Value! })),
    }));

    const result: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: response.DBCluster!.DBClusterArn!,
      type: 'rds-cluster',
      status: 'creating',
      region: resource.region,
      endpoints: [response.DBCluster!.Endpoint || ''],
    };
    context.resourceMetadata.set(resource.id, {
      endpoint: response.DBCluster!.Endpoint,
      readerEndpoint: response.DBCluster!.ReaderEndpoint,
    });
    return result;
  }

  private async deleteRDSCluster(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    const identifier = resource.awsId.split(':').pop();
    await this.rds.send(new DeleteDBClusterCommand({
      DBClusterIdentifier: identifier,
      SkipFinalSnapshot: true,
    }));
  }

  private async createDynamoDBTable(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    const result = await this.dynamodb.createTable({
      tableName: resourceName,
      partitionKey: props.partitionKey as { name: string; type: 'S' | 'N' | 'B' },
      sortKey: props.sortKey as { name: string; type: 'S' | 'N' | 'B' } | undefined,
      billingMode: props.billingMode as 'PROVISIONED' | 'PAY_PER_REQUEST' | undefined,
      pointInTimeRecovery: props.pointInTimeRecovery as boolean | undefined,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to create DynamoDB table');
    }

    const res: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: result.data!.TableArn!,
      type: 'dynamodb-table',
      status: 'creating',
      region: resource.region,
    };
    context.resourceMetadata.set(resource.id, {
      tableName: result.data!.TableName,
    });
    return res;
  }

  private async deleteDynamoDBTable(
    resource: ProvisionedResource,
    context: ResourceExecutionContext
  ): Promise<void> {
    const metadata = context.resourceMetadata.get(resource.plannedId);
    const tableName = metadata?.tableName as string;
    await this.dynamodb.deleteTable(tableName);
  }

  // ==========================================================================
  // Storage Handlers
  // ==========================================================================

  private async createS3Bucket(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    await this.s3.send(new CreateBucketCommand({
      Bucket: resourceName,
      CreateBucketConfiguration: this.config.region !== 'us-east-1' ? {
        LocationConstraint: this.config.region as any,
      } : undefined,
    }));

    // Enable encryption
    if (props.encryption !== false) {
      await this.s3.send(new PutBucketEncryptionCommand({
        Bucket: resourceName,
        ServerSideEncryptionConfiguration: {
          Rules: [{
            ApplyServerSideEncryptionByDefault: {
              SSEAlgorithm: props.kmsKeyId ? 'aws:kms' : 'AES256',
              KMSMasterKeyID: props.kmsKeyId as string | undefined,
            },
          }],
        },
      }));
    }

    // Enable versioning
    if (props.versioning) {
      await this.s3.send(new PutBucketVersioningCommand({
        Bucket: resourceName,
        VersioningConfiguration: {
          Status: 'Enabled',
        },
      }));
    }

    // Block public access
    if (props.blockPublicAccess !== false) {
      await this.s3.send(new PutPublicAccessBlockCommand({
        Bucket: resourceName,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      }));
    }

    const result: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: `arn:aws:s3:::${resourceName}`,
      type: 's3-bucket',
      status: 'available',
      region: resource.region,
    };
    context.resourceMetadata.set(resource.id, {
      bucketName: resourceName,
    });
    return result;
  }

  private async deleteS3Bucket(
    resource: ProvisionedResource,
    context: ResourceExecutionContext
  ): Promise<void> {
    const metadata = context.resourceMetadata.get(resource.plannedId);
    const bucketName = metadata?.bucketName as string;
    await this.s3.send(new DeleteBucketCommand({
      Bucket: bucketName,
    }));
  }

  // ==========================================================================
  // Security Handlers
  // ==========================================================================

  private async createIAMRole(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    const response = await this.iam.send(new CreateRoleCommand({
      RoleName: resourceName,
      AssumeRolePolicyDocument: JSON.stringify(props.assumeRolePolicyDocument),
      Description: props.description as string | undefined,
      Path: props.path as string | undefined,
      Tags: context.tags.map(t => ({ Key: t.Key!, Value: t.Value! })),
    }));

    // Attach inline policies
    const policies = props.policies as Array<{ name: string; document: object }> | undefined;
    const policyNames: string[] = [];
    if (policies) {
      for (const policy of policies) {
        await this.iam.send(new PutRolePolicyCommand({
          RoleName: resourceName,
          PolicyName: policy.name,
          PolicyDocument: JSON.stringify(policy.document),
        }));
        policyNames.push(policy.name);
      }
    }

    // Create an instance profile and attach the role if requested
    let instanceProfileArn: string | undefined;
    if (props.createInstanceProfile !== false) {
      const profileResponse = await this.iam.send(new CreateInstanceProfileCommand({
        InstanceProfileName: resourceName,
        Tags: context.tags.map(t => ({ Key: t.Key!, Value: t.Value! })),
      }));
      instanceProfileArn = profileResponse.InstanceProfile?.Arn;

      await this.iam.send(new AddRoleToInstanceProfileCommand({
        InstanceProfileName: resourceName,
        RoleName: resourceName,
      }));
    }

    const result: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: response.Role!.Arn!,
      type: 'iam-role',
      status: 'available',
      region: 'global',
    };
    context.resourceMetadata.set(resource.id, {
      roleName: response.Role!.RoleName,
      policyNames,
      instanceProfileArn,
      instanceProfileName: instanceProfileArn ? resourceName : undefined,
    });
    return result;
  }

  private async deleteIAMRole(
    resource: ProvisionedResource,
    context: ResourceExecutionContext
  ): Promise<void> {
    const metadata = context.resourceMetadata.get(resource.plannedId);
    const roleName = metadata?.roleName as string;
    const policyNames = (metadata?.policyNames as string[]) ?? [];
    const instanceProfileName = metadata?.instanceProfileName as string | undefined;

    // Remove role from instance profile and delete the profile
    if (instanceProfileName) {
      await this.iam.send(new RemoveRoleFromInstanceProfileCommand({
        InstanceProfileName: instanceProfileName,
        RoleName: roleName,
      }));
      await this.iam.send(new DeleteInstanceProfileCommand({
        InstanceProfileName: instanceProfileName,
      }));
    }

    // Delete all inline policies before deleting the role
    for (const policyName of policyNames) {
      await this.iam.send(new DeleteRolePolicyCommand({
        RoleName: roleName,
        PolicyName: policyName,
      }));
    }

    await this.iam.send(new DeleteRoleCommand({
      RoleName: roleName,
    }));
  }

  private async createKMSKey(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    const response = await this.kms.send(new CreateKeyCommand({
      Description: props.description as string || `KMS key for ${resourceName}`,
      KeyUsage: props.keyUsage as 'SIGN_VERIFY' | 'ENCRYPT_DECRYPT' | undefined,
      KeySpec: props.keySpec as KeySpec | undefined,
      Tags: context.tags.map(t => ({ TagKey: t.Key!, TagValue: t.Value! })),
    }));

    const result: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: response.KeyMetadata!.Arn!,
      type: 'kms-key',
      status: 'available',
      region: resource.region,
    };
    context.resourceMetadata.set(resource.id, {
      keyId: response.KeyMetadata!.KeyId,
    });
    return result;
  }

  private async deleteKMSKey(
    resource: ProvisionedResource,
    context: ResourceExecutionContext
  ): Promise<void> {
    const metadata = context.resourceMetadata.get(resource.plannedId);
    const keyId = metadata?.keyId as string;
    await this.kms.send(new ScheduleKeyDeletionCommand({
      KeyId: keyId,
      PendingWindowInDays: 7,
    }));
  }

  // ==========================================================================
  // Messaging Handlers
  // ==========================================================================

  private async createSQSQueue(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    const result = await this.sqs.createQueue({
      queueName: resourceName,
      visibilityTimeout: props.visibilityTimeout as number | undefined,
      messageRetentionPeriod: props.messageRetentionPeriod as number | undefined,
      delaySeconds: props.delaySeconds as number | undefined,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to create SQS queue');
    }

    const res: InternalProvisionedResource = {
      plannedId: resource.id,
      awsId: result.data!.queueArn!,
      type: 'sqs-queue',
      status: 'available',
      region: resource.region,
    };
    context.resourceMetadata.set(resource.id, {
      queueUrl: result.data!.queueUrl,
    });
    return res;
  }

  private async deleteSQSQueue(
    resource: ProvisionedResource,
    context: ResourceExecutionContext
  ): Promise<void> {
    const metadata = context.resourceMetadata.get(resource.plannedId);
    const queueUrl = metadata?.queueUrl as string;
    await this.sqs.deleteQueue(queueUrl);
  }

  private async createSNSTopic(
    resource: PlannedResource,
    _context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    const result = await this.sns.createTopic({
      name: resourceName,
      fifo: props.fifo as boolean | undefined,
      displayName: props.displayName as string | undefined,
      kmsMasterKeyId: props.kmsMasterKeyId as string | undefined,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to create SNS topic');
    }

    return {
      plannedId: resource.id,
      awsId: result.data!.topicArn,
      type: 'sns-topic',
      status: 'available',
      region: resource.region,
    };
  }

  private async deleteSNSTopic(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    await this.sns.deleteTopic(resource.awsId);
  }

  // ==========================================================================
  // API Handlers
  // ==========================================================================

  private async createAPIGateway(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    if (props.apiType === 'http') {
      const result = await this.apigateway.createHttpApi({
        name: resourceName,
        description: props.description as string | undefined,
        protocolType: 'HTTP',
        corsConfiguration: props.cors as any,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create HTTP API');
      }

      const res: InternalProvisionedResource = {
        plannedId: resource.id,
        awsId: result.data!.ApiId!,
        type: 'api-gateway',
        status: 'available',
        region: resource.region,
        endpoints: result.data!.ApiEndpoint ? [result.data!.ApiEndpoint] : undefined,
      };
      context.resourceMetadata.set(resource.id, {
        apiEndpoint: result.data!.ApiEndpoint,
        apiType: 'http',
      });
      return res;
    } else {
      const result = await this.apigateway.createRestApi({
        name: resourceName,
        description: props.description as string | undefined,
        endpointType: props.endpointType as 'REGIONAL' | 'EDGE' | 'PRIVATE' | undefined,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create REST API');
      }

      const res: InternalProvisionedResource = {
        plannedId: resource.id,
        awsId: result.data!.id!,
        type: 'api-gateway',
        status: 'available',
        region: resource.region,
      };
      context.resourceMetadata.set(resource.id, {
        apiType: 'rest',
      });
      return res;
    }
  }

  private async deleteAPIGateway(
    resource: ProvisionedResource,
    context: ResourceExecutionContext
  ): Promise<void> {
    const metadata = context.resourceMetadata.get(resource.plannedId);
    if (metadata?.apiType === 'http') {
      await this.apigateway.deleteHttpApi(resource.awsId);
    } else {
      await this.apigateway.deleteRestApi(resource.awsId);
    }
  }

  // ==========================================================================
  // Monitoring Handlers
  // ==========================================================================

  private async createCloudWatchAlarm(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    await this.cloudwatch.send(new PutMetricAlarmCommand({
      AlarmName: resourceName,
      MetricName: props.metricName as string,
      Namespace: props.namespace as string,
      Statistic: props.statistic as 'Average' | 'Sum' | 'Minimum' | 'Maximum' | 'SampleCount' | undefined,
      Period: props.period as number,
      EvaluationPeriods: props.evaluationPeriods as number,
      Threshold: props.threshold as number,
      ComparisonOperator: props.comparisonOperator as 'GreaterThanOrEqualToThreshold' | 'GreaterThanThreshold' | 'LessThanThreshold' | 'LessThanOrEqualToThreshold' | 'LessThanLowerOrGreaterThanUpperThreshold' | 'LessThanLowerThreshold' | 'GreaterThanUpperThreshold' | undefined,
      AlarmActions: props.alarmActions as string[] | undefined,
      Tags: context.tags.map(t => ({ Key: t.Key!, Value: t.Value! })),
    }));

    return {
      plannedId: resource.id,
      awsId: `arn:aws:cloudwatch:${resource.region}:*:alarm:${resourceName}`,
      type: 'cloudwatch-alarm',
      status: 'available',
      region: resource.region,
    };
  }

  private async deleteCloudWatchAlarm(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    const alarmName = resource.awsId.split(':').pop();
    await this.cloudwatch.send(new DeleteAlarmsCommand({
      AlarmNames: [alarmName!],
    }));
  }

  // ==========================================================================
  // CloudWatch Dashboard Handlers
  // ==========================================================================

  private async createCloudWatchDashboard(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    await this.cloudwatch.send(new PutDashboardCommand({
      DashboardName: resourceName,
      DashboardBody: JSON.stringify(props.dashboardBody ?? {
        widgets: props.widgets ?? [],
      }),
    }));

    return {
      plannedId: resource.id,
      awsId: `arn:aws:cloudwatch::*:dashboard/${resourceName}`,
      type: 'cloudwatch-dashboard',
      status: 'available',
      region: resource.region,
    };
  }

  private async deleteCloudWatchDashboard(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    const dashboardName = resource.awsId.split('/').pop();
    await this.cloudwatch.send(new DeleteDashboardsCommand({
      DashboardNames: [dashboardName!],
    }));
  }

  // ==========================================================================
  // Lambda Handlers
  // ==========================================================================

  private async createLambdaFunction(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    const result = await this.lambda.send(new CreateFunctionCommand({
      FunctionName: resourceName,
      Runtime: (props.runtime as Runtime) ?? 'nodejs20.x',
      Handler: (props.handler as string) ?? 'index.handler',
      Role: props.roleArn as string,
      Code: {
        ZipFile: props.zipFile as Uint8Array | undefined,
        S3Bucket: props.s3Bucket as string | undefined,
        S3Key: props.s3Key as string | undefined,
      },
      MemorySize: (props.memorySize as number) ?? 128,
      Timeout: (props.timeout as number) ?? 30,
      Environment: props.environment ? {
        Variables: props.environment as Record<string, string>,
      } : undefined,
      Tags: Object.fromEntries(context.tags.map(t => [t.Key!, t.Value!])),
    }));

    return {
      plannedId: resource.id,
      awsId: result.FunctionArn!,
      type: 'lambda-function',
      status: 'available',
      region: resource.region,
    };
  }

  private async deleteLambdaFunction(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    const functionName = resource.awsId.split(':').pop();
    await this.lambda.send(new DeleteFunctionCommand({
      FunctionName: functionName!,
    }));
  }

  // ==========================================================================
  // Launch Template Handlers
  // ==========================================================================

  private async createLaunchTemplate(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    const result = await this.ec2.send(new CreateLaunchTemplateCommand({
      LaunchTemplateName: resourceName,
      LaunchTemplateData: {
        ImageId: props.imageId as string | undefined,
        InstanceType: (props.instanceType as _InstanceType) ?? 't3.micro',
        KeyName: props.keyName as string | undefined,
        SecurityGroupIds: props.securityGroupIds as string[] | undefined,
        UserData: props.userData as string | undefined,
        BlockDeviceMappings: props.blockDeviceMappings as any[] | undefined,
      },
      TagSpecifications: [{
        ResourceType: 'launch-template',
        Tags: context.tags,
      }],
    }));

    return {
      plannedId: resource.id,
      awsId: result.LaunchTemplate?.LaunchTemplateId!,
      type: 'launch-template',
      status: 'available',
      region: resource.region,
    };
  }

  private async deleteLaunchTemplate(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    await this.ec2.send(new DeleteLaunchTemplateCommand({
      LaunchTemplateId: resource.awsId,
    }));
  }

  // ==========================================================================
  // Auto Scaling Group Handlers
  // ==========================================================================

  private async createAutoScalingGroup(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    // Support both launch templates (preferred) and legacy launch configurations
    let launchConfigName: string | undefined;
    const asgInput: CreateAutoScalingGroupCommandInput = {
      AutoScalingGroupName: resourceName,
      MinSize: (props.minSize as number) ?? 1,
      MaxSize: (props.maxSize as number) ?? 3,
      DesiredCapacity: (props.desiredCapacity as number) ?? 1,
      VPCZoneIdentifier: (props.subnetIds as string[])?.join(','),
      TargetGroupARNs: props.targetGroupArns as string[] | undefined,
      Tags: context.tags.map(t => ({
        Key: t.Key!,
        Value: t.Value!,
        PropagateAtLaunch: true,
      })),
    };

    if (props.launchTemplateId) {
      asgInput.LaunchTemplate = {
        LaunchTemplateId: props.launchTemplateId as string,
        Version: '$Latest',
      };
    } else if (props.imageId && props.instanceType) {
      // Fallback: create a legacy launch configuration for the ASG
      launchConfigName = `${resourceName}-lc`;
      await this.autoscaling.send(new CreateLaunchConfigurationCommand({
        LaunchConfigurationName: launchConfigName,
        ImageId: props.imageId as string,
        InstanceType: props.instanceType as string,
        KeyName: props.keyName as string | undefined,
        SecurityGroups: props.securityGroupIds as string[] | undefined,
      }));
      asgInput.LaunchConfigurationName = launchConfigName;
    }

    await this.autoscaling.send(new CreateAutoScalingGroupCommand(asgInput as any));

    return {
      plannedId: resource.id,
      awsId: resourceName,
      type: 'autoscaling-group',
      status: 'available',
      region: resource.region,
      metadata: launchConfigName ? { launchConfigName } : undefined,
    };
  }

  private async deleteAutoScalingGroup(
    resource: ProvisionedResource,
    context: ResourceExecutionContext
  ): Promise<void> {
    await this.autoscaling.send(new DeleteAutoScalingGroupCommand({
      AutoScalingGroupName: resource.awsId,
      ForceDelete: true,
    }));

    // Clean up legacy launch configuration if one was created
    const metadata = context.resourceMetadata.get(resource.plannedId);
    const launchConfigName = metadata?.launchConfigName as string | undefined;
    if (launchConfigName) {
      await this.autoscaling.send(new DeleteLaunchConfigurationCommand({
        LaunchConfigurationName: launchConfigName,
      }));
    }
  }

  // ==========================================================================
  // ElastiCache Handlers
  // ==========================================================================

  private async createElastiCacheCluster(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);
    // ElastiCache IDs must be lowercase and max 40 chars
    const replicationGroupId = resourceName.toLowerCase().slice(0, 40);

    const result = await this.elasticache.send(new CreateReplicationGroupCommand({
      ReplicationGroupId: replicationGroupId,
      ReplicationGroupDescription: (props.description as string) ?? `ElastiCache cluster for ${resourceName}`,
      Engine: (props.engine as string) ?? 'redis',
      CacheNodeType: (props.nodeType as string) ?? 'cache.t3.micro',
      NumCacheClusters: (props.numCacheClusters as number) ?? 1,
      AutomaticFailoverEnabled: (props.automaticFailover as boolean) ?? false,
      Tags: context.tags.map(t => ({ Key: t.Key!, Value: t.Value! })),
    }));

    return {
      plannedId: resource.id,
      awsId: result.ReplicationGroup?.ARN!,
      type: 'elasticache-cluster',
      status: 'available',
      region: resource.region,
    };
  }

  private async deleteElastiCacheCluster(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    // Extract the replication group ID from the ARN
    const replicationGroupId = resource.awsId.includes(':')
      ? resource.awsId.split(':').pop()!
      : resource.awsId;
    await this.elasticache.send(new DeleteReplicationGroupCommand({
      ReplicationGroupId: replicationGroupId,
      RetainPrimaryCluster: false,
    }));
  }

  // ==========================================================================
  // RDS Read Replica Handlers
  // ==========================================================================

  private async createRDSReadReplica(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    const result = await this.rds.send(new CreateDBInstanceReadReplicaCommand({
      DBInstanceIdentifier: resourceName,
      SourceDBInstanceIdentifier: props.sourceDBInstanceIdentifier as string,
      DBInstanceClass: (props.instanceClass as string) ?? 'db.t3.micro',
      AvailabilityZone: props.availabilityZone as string | undefined,
      PubliclyAccessible: (props.publiclyAccessible as boolean) ?? false,
      Tags: context.tags.map(t => ({ Key: t.Key!, Value: t.Value! })),
    }));

    return {
      plannedId: resource.id,
      awsId: result.DBInstance?.DBInstanceArn!,
      type: 'rds-read-replica',
      status: 'available',
      region: resource.region,
    };
  }

  private async deleteRDSReadReplica(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    const instanceId = resource.awsId.split(':').pop();
    await this.rds.send(new DeleteDBInstanceCommand({
      DBInstanceIdentifier: instanceId!,
      SkipFinalSnapshot: true,
    }));
  }

  // ==========================================================================
  // Backup Handlers
  // ==========================================================================

  private async createBackupPlan(
    resource: PlannedResource,
    context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    const props = resource.properties;
    const resourceName = getResourceName(resource);

    const result = await this.backup.send(new CreateBackupPlanCommand({
      BackupPlan: {
        BackupPlanName: resourceName,
        Rules: (props.rules as any[]) ?? [{
          RuleName: 'default-rule',
          TargetBackupVaultName: (props.vaultName as string) ?? 'Default',
          ScheduleExpression: (props.schedule as string) ?? 'cron(0 5 ? * * *)',
          Lifecycle: {
            DeleteAfterDays: (props.retentionDays as number) ?? 30,
          },
        }],
      },
      BackupPlanTags: Object.fromEntries(context.tags.map(t => [t.Key!, t.Value!])),
    }));

    return {
      plannedId: resource.id,
      awsId: result.BackupPlanId!,
      type: 'backup-plan',
      status: 'available',
      region: resource.region,
    };
  }

  private async deleteBackupPlan(
    resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    await this.backup.send(new DeleteBackupPlanCommand({
      BackupPlanId: resource.awsId,
    }));
  }

  // ==========================================================================
  // Backup Copy Action Handlers (part of backup plans, thin resource)
  // ==========================================================================

  private async createBackupCopyAction(
    resource: PlannedResource,
    _context: ResourceExecutionContext
  ): Promise<InternalProvisionedResource> {
    // Backup copy actions are configured within backup plan rules.
    // This handler is a thin wrapper — the actual copy action is part
    // of the backup plan rule definition. We track it for plan alignment.
    const resourceName = getResourceName(resource);
    return {
      plannedId: resource.id,
      awsId: `backup-copy-action:${resourceName}`,
      type: 'backup-copy-action',
      status: 'available',
      region: resource.region,
    };
  }

  private async deleteBackupCopyAction(
    _resource: ProvisionedResource,
    _context: ResourceExecutionContext
  ): Promise<void> {
    // Copy actions are removed when the parent backup plan is deleted.
    // No standalone deletion needed.
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createExecutionEngine(config?: ExecutionEngineConfig): AWSExecutionEngine {
  return new AWSExecutionEngine(config);
}
