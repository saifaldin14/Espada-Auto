/**
 * Reconciliation Engine - Continuous drift detection and auto-remediation
 * 
 * Monitors deployed infrastructure for configuration drift, compliance violations,
 * and cost anomalies. Automatically remediates issues when possible.
 */

import type {
  InfrastructurePlan,
  IntentExecutionResult,
  ReconciliationResult,
  ResourceDrift,
  CostAnomaly,
  RemediationAction,
  PlannedResource,
} from '../intent/types.js';
import type { PolicyEngine } from '../policy/engine.js';

// AWS SDK clients for real resource inspection & remediation
import {
  EC2Client,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  DescribeInstancesCommand,
  DescribeNatGatewaysCommand,
  ModifyInstanceAttributeCommand,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2';
import {
  RDSClient,
  DescribeDBInstancesCommand,
  DescribeDBClustersCommand,
  ModifyDBInstanceCommand,
  DeleteDBInstanceCommand,
} from '@aws-sdk/client-rds';
import {
  S3Client,
  GetBucketEncryptionCommand,
  GetBucketVersioningCommand,
  GetBucketPolicyCommand,
  PutBucketEncryptionCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
import {
  ECSClient,
  DescribeServicesCommand,
  DescribeClustersCommand,
  UpdateServiceCommand,
  DeleteServiceCommand,
} from '@aws-sdk/client-ecs';
import {
  ElastiCacheClient,
  DescribeCacheClustersCommand,
} from '@aws-sdk/client-elasticache';
import {
  LambdaClient,
  GetFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommand,
  DeleteFunctionCommand,
  type Runtime,
} from '@aws-sdk/client-lambda';
import {
  IAMClient,
  GetRoleCommand,
} from '@aws-sdk/client-iam';
import {
  SNSClient,
  PublishCommand,
} from '@aws-sdk/client-sns';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from '@aws-sdk/client-cost-explorer';
import {
  EventBridgeClient,
  PutRuleCommand,
  PutTargetsCommand,
  RemoveTargetsCommand,
  DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import {
  SFNClient,
  CreateStateMachineCommand,
  DeleteStateMachineCommand,
} from '@aws-sdk/client-sfn';

export interface ReconciliationConfig {
  /** Reconciliation interval in minutes */
  intervalMinutes: number;
  /** Enable auto-remediation */
  enableAutoRemediation: boolean;
  /** Cost anomaly threshold percentage */
  costAnomalyThreshold: number;
  /** SNS topic for alerts */
  alertTopicArn?: string;
  /** Maximum auto-remediation attempts */
  maxRemediationAttempts: number;
  /** AWS region for SDK clients */
  region?: string;
  /** AWS credentials provider */
  credentials?: () => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }>;
}

export interface ReconciliationContext {
  /** Plan being monitored */
  plan: InfrastructurePlan;
  /** Execution result */
  execution: IntentExecutionResult;
  /** AWS region */
  region: string;
  /** AWS account ID */
  accountId?: string;
  /** Per-call override for auto-remediation (takes precedence over config) */
  autoRemediate?: boolean;
}

/**
 * Reconciliation Engine - Monitors and auto-remediates infrastructure
 */
export class ReconciliationEngine {
  private readonly ec2: EC2Client;
  private readonly rds: RDSClient;
  private readonly s3: S3Client;
  private readonly ecs: ECSClient;
  private readonly elasticache: ElastiCacheClient;
  private readonly lambda: LambdaClient;
  private readonly iam: IAMClient;
  private readonly sns: SNSClient;
  private readonly costExplorer: CostExplorerClient;

  constructor(
    private config: ReconciliationConfig,
    private policyEngine: PolicyEngine,
  ) {
    const clientConfig = {
      region: config.region ?? 'us-east-1',
      ...(config.credentials ? { credentials: config.credentials } : {}),
    };
    this.ec2 = new EC2Client(clientConfig);
    this.rds = new RDSClient(clientConfig);
    this.s3 = new S3Client(clientConfig);
    this.ecs = new ECSClient(clientConfig);
    this.elasticache = new ElastiCacheClient(clientConfig);
    this.lambda = new LambdaClient(clientConfig);
    this.iam = new IAMClient(clientConfig);
    this.sns = new SNSClient(clientConfig);
    // Cost Explorer always targets us-east-1
    this.costExplorer = new CostExplorerClient({
      ...clientConfig,
      region: 'us-east-1',
    });
  }

  /**
   * Perform full reconciliation check
   */
  async reconcile(context: ReconciliationContext): Promise<ReconciliationResult> {
    const timestamp = new Date().toISOString();
    
    // Drift detection
    const drifts = await this.detectDrift(context);
    
    // Compliance checks
    const complianceViolations = await this.checkCompliance(context);
    
    // Cost anomaly detection
    const costAnomalies = await this.detectCostAnomalies(context);
    
    // Generate remediation actions
    const recommendedActions = await this.generateRemediationActions(
      drifts,
      complianceViolations,
      costAnomalies,
      context,
    );
    
    // Auto-remediate if enabled (per-call override takes precedence)
    let autoRemediationApplied = false;
    const shouldRemediate = context.autoRemediate ?? this.config.enableAutoRemediation;
    if (shouldRemediate) {
      autoRemediationApplied = await this.executeAutoRemediation(
        recommendedActions,
        context,
      );
    }
    
    // Send alerts if configured
    if (this.config.alertTopicArn) {
      await this.sendAlerts(
        drifts,
        complianceViolations,
        costAnomalies,
        context,
      );
    }

    return {
      id: `reconcile-${Date.now()}`,
      planId: context.plan.id,
      executionId: context.execution.executionId,
      timestamp,
      driftDetected: drifts.length > 0,
      drifts,
      complianceViolations,
      costAnomalies,
      recommendedActions,
      autoRemediationApplied,
    };
  }

  /**
   * Detect configuration drift between planned and actual state
   */
  private async detectDrift(context: ReconciliationContext): Promise<ResourceDrift[]> {
    const drifts: ResourceDrift[] = [];
    
    for (const provisionedResource of context.execution.provisionedResources) {
      const plannedResource = context.plan.resources.find(
        r => r.id === provisionedResource.plannedId
      );
      
      if (!plannedResource) continue;
      
      // Fetch actual resource configuration from AWS
      const actualConfig = await this.fetchResourceConfiguration(
        provisionedResource.awsId,
        provisionedResource.type,
        context.region,
      );
      
      if (!actualConfig) {
        // Resource was deleted outside of management
        drifts.push({
          resourceId: provisionedResource.plannedId,
          awsArn: provisionedResource.awsId,
          driftType: 'deleted',
          expected: plannedResource.properties,
          actual: {},
          differences: [],
          lastChecked: new Date().toISOString(),
        });
        continue;
      }
      
      // Compare configurations
      const differences = this.compareConfigurations(
        plannedResource.properties,
        actualConfig,
        provisionedResource.type,
      );
      
      if (differences.length > 0) {
        drifts.push({
          resourceId: provisionedResource.plannedId,
          awsArn: provisionedResource.awsId,
          driftType: 'configuration',
          expected: plannedResource.properties,
          actual: actualConfig,
          differences,
          lastChecked: new Date().toISOString(),
        });
      }
    }
    
    return drifts;
  }

  /**
   * Check compliance against current policy state
   */
  private async checkCompliance(context: ReconciliationContext): Promise<any[]> {
    const policyValidation = await this.policyEngine.validatePlan(
      context.plan.resources,
      context.plan.intent,
    );
    
    return policyValidation.violations;
  }

  /**
   * Detect cost anomalies
   */
  private async detectCostAnomalies(context: ReconciliationContext): Promise<CostAnomaly[]> {
    const anomalies: CostAnomaly[] = [];
    
    // Fetch actual costs from Cost Explorer
    const actualCosts = await this.fetchActualCosts(
      context.execution.provisionedResources.map(r => r.awsId),
      context.region,
    );
    
    // Compare against estimated costs
    for (const [resourceId, actualCost] of Object.entries(actualCosts)) {
      const plannedResource = context.plan.resources.find(r => r.id === resourceId);
      if (!plannedResource) continue;
      
      const expectedCost = plannedResource.estimatedCostUsd;
      const percentageDiff = ((actualCost - expectedCost) / expectedCost) * 100;
      
      if (Math.abs(percentageDiff) > this.config.costAnomalyThreshold) {
        anomalies.push({
          service: plannedResource.service,
          resourceId,
          type: percentageDiff > 0 ? 'spike' : 'trend',
          expectedCostUsd: expectedCost,
          actualCostUsd: actualCost,
          percentageDifference: percentageDiff,
          detectedAt: new Date().toISOString(),
          possibleCauses: this.analyzeCostAnomaly(plannedResource, actualCost, expectedCost),
        });
      }
    }
    
    return anomalies;
  }

  /**
   * Generate remediation actions
   */
  private async generateRemediationActions(
    drifts: ResourceDrift[],
    violations: any[],
    anomalies: CostAnomaly[],
    context: ReconciliationContext,
  ): Promise<RemediationAction[]> {
    return [
      ...this.generateDriftRemediationActions(drifts),
      ...this.generateComplianceRemediationActions(violations),
      ...this.generateCostRemediationActions(anomalies),
    ];
  }

  /**
   * Generate drift remediation actions
   */
  private generateDriftRemediationActions(drifts: ResourceDrift[]): RemediationAction[] {
    return drifts.flatMap((drift): RemediationAction[] => {
      if (drift.driftType === 'deleted') {
        return [{
          id: `remediate-${drift.resourceId}-deleted`,
          type: 'recreate' as const,
          priority: 'critical' as const,
          description: `Recreate deleted resource ${drift.resourceId}`,
          resourceIds: [drift.resourceId],
          autoExecutable: false,
          estimatedImpact: 'Resource will be recreated with original configuration',
          approvalRequired: true,
        }];
      }
      
      if (drift.driftType === 'configuration') {
        const criticalDiffs = drift.differences.filter(d => d.severity === 'critical');
        if (criticalDiffs.length > 0) {
          return [{
            id: `remediate-${drift.resourceId}-config`,
            type: 'update' as const,
            priority: 'high' as const,
            description: `Update configuration for ${drift.resourceId}`,
            resourceIds: [drift.resourceId],
            autoExecutable: true,
            estimatedImpact: 'Resource configuration will be updated to match intent',
            approvalRequired: false,
          }];
        }
      }
      
      return [];
    });
  }

  /**
   * Generate compliance remediation actions
   */
  private generateComplianceRemediationActions(violations: any[]): RemediationAction[] {
    return violations
      .filter(v => v.autoFixable)
      .map(violation => ({
        id: `remediate-${violation.resourceId}-compliance`,
        type: 'update' as const,
        priority: (violation.severity === 'critical' ? 'critical' : 'high') as 'critical' | 'high',
        description: violation.remediation || `Fix ${violation.policy} violation`,
        resourceIds: [violation.resourceId],
        autoExecutable: true,
        estimatedImpact: violation.remediation || 'Resource will be updated to comply with policy',
        approvalRequired: violation.severity === 'critical',
      }));
  }

  /**
   * Generate cost remediation actions
   */
  private generateCostRemediationActions(anomalies: CostAnomaly[]): RemediationAction[] {
    return anomalies
      .filter(anomaly => anomaly.percentageDifference > this.config.costAnomalyThreshold * 2)
      .map(anomaly => ({
        id: `remediate-${anomaly.resourceId}-cost`,
        type: 'scale' as const,
        priority: 'medium' as const,
        description: `Investigate and optimize ${anomaly.service} costs`,
        resourceIds: anomaly.resourceId ? [anomaly.resourceId] : [],
        autoExecutable: false,
        estimatedImpact: `Cost is ${anomaly.percentageDifference.toFixed(1)}% higher than expected`,
        approvalRequired: true,
      }));
  }

  /**
   * Execute auto-remediation for eligible actions
   */
  private async executeAutoRemediation(
    actions: RemediationAction[],
    context: ReconciliationContext,
  ): Promise<boolean> {
    const autoExecutableActions = actions.filter(
      a => a.autoExecutable && !a.approvalRequired
    );
    
    if (autoExecutableActions.length === 0) {
      return false;
    }
    
    let remediationApplied = false;
    
    for (const action of autoExecutableActions) {
      try {
        await this.executeRemediationAction(action, context);
        remediationApplied = true;
      } catch (error) {
        console.error(`Failed to execute remediation ${action.id}:`, error);
      }
    }
    
    return remediationApplied;
  }

  /**
   * Execute a specific remediation action against real AWS resources.
   */
  private async executeRemediationAction(
    action: RemediationAction,
    context: ReconciliationContext,
  ): Promise<void> {
    for (const resourceId of action.resourceIds) {
      const provisioned = context.execution.provisionedResources.find(
        r => r.plannedId === resourceId,
      );
      if (!provisioned) continue;

      const planned = context.plan.resources.find(r => r.id === resourceId);

      switch (action.type) {
        case 'update': {
          // Restore the resource to its intended configuration
          if (!planned) break;
          await this.updateResource(provisioned.awsId, provisioned.type, planned.properties, context.region);
          break;
        }
        case 'delete': {
          await this.deleteResource(provisioned.awsId, provisioned.type, context.region);
          break;
        }
        case 'recreate': {
          // Delete then fall through — the execution engine should re-create
          // from the plan; for now we delete the drifted/broken resource so a
          // subsequent plan-execute cycle brings it back.
          await this.deleteResource(provisioned.awsId, provisioned.type, context.region);
          break;
        }
        case 'scale': {
          // Scale operations are advisory — log and move on; the recommended
          // action description already tells the operator what to do.
          break;
        }
        case 'alert': {
          // Publish a targeted alert for this specific resource
          if (this.config.alertTopicArn) {
            await this.sns.send(new PublishCommand({
              TopicArn: this.config.alertTopicArn,
              Subject: `Remediation Alert: ${resourceId}`,
              Message: JSON.stringify({ action, resourceId, awsId: provisioned.awsId }),
            }));
          }
          break;
        }
      }
    }
  }

  /**
   * Update a single resource toward its intended configuration.
   * Covers the most common modify-in-place resources.
   */
  private async updateResource(
    awsId: string,
    resourceType: string,
    properties: Record<string, unknown>,
    _region: string,
  ): Promise<void> {
    switch (resourceType) {
      case 'rds-instance': {
        const id = awsId.includes(':') ? awsId.split(':').pop()! : awsId;
        await this.rds.send(new ModifyDBInstanceCommand({
          DBInstanceIdentifier: id,
          PubliclyAccessible: properties.publiclyAccessible as boolean | undefined,
          DeletionProtection: properties.deletionProtection as boolean | undefined,
          MultiAZ: properties.multiAz as boolean | undefined,
          ApplyImmediately: true,
        }));
        break;
      }
      case 'lambda-function': {
        const fnName = awsId.includes(':') ? awsId.split(':').pop()! : awsId;
        await this.lambda.send(new UpdateFunctionConfigurationCommand({
          FunctionName: fnName,
          MemorySize: properties.memorySize as number | undefined,
          Timeout: properties.timeout as number | undefined,
          Runtime: properties.runtime as Runtime | undefined,
        }));
        break;
      }
      case 'ecs-service': {
        // awsId is an ARN — extract cluster and service name
        const arnParts = awsId.split('/');
        const clusterName = arnParts[1];
        const serviceName = arnParts[2] ?? arnParts[1];
        await this.ecs.send(new UpdateServiceCommand({
          cluster: clusterName,
          service: serviceName,
          desiredCount: properties.desiredCount as number | undefined,
        }));
        break;
      }
      case 's3-bucket': {
        const bucket = properties.bucketName as string ?? awsId;
        if (properties.encryption !== false) {
          await this.s3.send(new PutBucketEncryptionCommand({
            Bucket: bucket,
            ServerSideEncryptionConfiguration: {
              Rules: [{
                ApplyServerSideEncryptionByDefault: {
                  SSEAlgorithm: properties.kmsKeyId ? 'aws:kms' : 'AES256',
                  KMSMasterKeyID: properties.kmsKeyId as string | undefined,
                },
              }],
            },
          }));
        }
        break;
      }
      // For resource types that don't support modify-in-place, this is a no-op;
      // the caller should use 'recreate' instead.
      default:
        break;
    }
  }

  /**
   * Delete a single resource by type.
   */
  private async deleteResource(
    awsId: string,
    resourceType: string,
    _region: string,
  ): Promise<void> {
    switch (resourceType) {
      case 'rds-instance': {
        const id = awsId.includes(':') ? awsId.split(':').pop()! : awsId;
        await this.rds.send(new DeleteDBInstanceCommand({
          DBInstanceIdentifier: id,
          SkipFinalSnapshot: false,
          FinalDBSnapshotIdentifier: `${id}-remediation-${Date.now()}`,
        }));
        break;
      }
      case 'lambda-function': {
        const fnName = awsId.includes(':') ? awsId.split(':').pop()! : awsId;
        await this.lambda.send(new DeleteFunctionCommand({ FunctionName: fnName }));
        break;
      }
      case 'ecs-service': {
        const parts = awsId.split('/');
        const cluster = parts[1];
        const service = parts[2] ?? parts[1];
        // Must scale to 0 before delete
        await this.ecs.send(new UpdateServiceCommand({ cluster, service, desiredCount: 0 }));
        await this.ecs.send(new DeleteServiceCommand({ cluster, service }));
        break;
      }
      case 's3-bucket': {
        await this.s3.send(new DeleteBucketCommand({ Bucket: awsId }));
        break;
      }
      case 'ec2-instance': {
        await this.ec2.send(new TerminateInstancesCommand({ InstanceIds: [awsId] }));
        break;
      }
      default:
        break;
    }
  }

  /**
   * Fetch actual resource configuration from AWS using per-type describe calls.
   * Returns `null` if the resource no longer exists.
   */
  private async fetchResourceConfiguration(
    awsId: string,
    resourceType: string,
    _region: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      switch (resourceType) {
        case 'vpc': {
          const res = await this.ec2.send(new DescribeVpcsCommand({ VpcIds: [awsId] }));
          const vpc = res.Vpcs?.[0];
          if (!vpc) return null;
          return {
            cidrBlock: vpc.CidrBlock,
            enableDnsHostnames: vpc.IsDefault,
            state: vpc.State,
            vpcId: vpc.VpcId,
          };
        }
        case 'subnet': {
          const res = await this.ec2.send(new DescribeSubnetsCommand({ SubnetIds: [awsId] }));
          const subnet = res.Subnets?.[0];
          if (!subnet) return null;
          return {
            cidrBlock: subnet.CidrBlock,
            availabilityZone: subnet.AvailabilityZone,
            vpcId: subnet.VpcId,
            mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch,
            state: subnet.State,
          };
        }
        case 'security-group': {
          const res = await this.ec2.send(new DescribeSecurityGroupsCommand({ GroupIds: [awsId] }));
          const sg = res.SecurityGroups?.[0];
          if (!sg) return null;
          return {
            name: sg.GroupName,
            description: sg.Description,
            vpcId: sg.VpcId,
            ingressRules: sg.IpPermissions?.map(p => ({
              protocol: p.IpProtocol,
              fromPort: p.FromPort,
              toPort: p.ToPort,
              cidrIp: p.IpRanges?.map(r => r.CidrIp),
            })),
          };
        }
        case 'ec2-instance': {
          const res = await this.ec2.send(new DescribeInstancesCommand({ InstanceIds: [awsId] }));
          const inst = res.Reservations?.[0]?.Instances?.[0];
          if (!inst) return null;
          return {
            instanceType: inst.InstanceType,
            state: inst.State?.Name,
            subnetId: inst.SubnetId,
            vpcId: inst.VpcId,
            publicIpAddress: inst.PublicIpAddress,
            imageId: inst.ImageId,
          };
        }
        case 'nat-gateway': {
          const res = await this.ec2.send(new DescribeNatGatewaysCommand({
            NatGatewayIds: [awsId],
          }));
          const ngw = res.NatGateways?.[0];
          if (!ngw) return null;
          return {
            state: ngw.State,
            subnetId: ngw.SubnetId,
            vpcId: ngw.VpcId,
          };
        }
        case 'rds-instance':
        case 'rds-read-replica': {
          const id = awsId.includes(':') ? awsId.split(':').pop()! : awsId;
          const res = await this.rds.send(new DescribeDBInstancesCommand({
            DBInstanceIdentifier: id,
          }));
          const db = res.DBInstances?.[0];
          if (!db) return null;
          return {
            instanceClass: db.DBInstanceClass,
            engine: db.Engine,
            engineVersion: db.EngineVersion,
            encrypted: db.StorageEncrypted,
            multiAz: db.MultiAZ,
            publiclyAccessible: db.PubliclyAccessible,
            deletionProtection: db.DeletionProtection,
            storageType: db.StorageType,
            allocatedStorage: db.AllocatedStorage,
          };
        }
        case 'rds-cluster': {
          const id = awsId.includes(':') ? awsId.split(':').pop()! : awsId;
          const res = await this.rds.send(new DescribeDBClustersCommand({
            DBClusterIdentifier: id,
          }));
          const cluster = res.DBClusters?.[0];
          if (!cluster) return null;
          return {
            engine: cluster.Engine,
            engineVersion: cluster.EngineVersion,
            encrypted: cluster.StorageEncrypted,
            multiAz: cluster.MultiAZ,
            deletionProtection: cluster.DeletionProtection,
            status: cluster.Status,
          };
        }
        case 's3-bucket': {
          const bucket = awsId;
          const config: Record<string, unknown> = { bucketName: bucket };
          try {
            const enc = await this.s3.send(new GetBucketEncryptionCommand({ Bucket: bucket }));
            const rule = enc.ServerSideEncryptionConfiguration?.Rules?.[0];
            config.encryptionAtRest = true;
            config.sseAlgorithm = rule?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;
          } catch {
            config.encryptionAtRest = false;
          }
          try {
            const ver = await this.s3.send(new GetBucketVersioningCommand({ Bucket: bucket }));
            config.versioning = ver.Status === 'Enabled';
          } catch {
            config.versioning = false;
          }
          return config;
        }
        case 'ecs-cluster': {
          const res = await this.ecs.send(new DescribeClustersCommand({ clusters: [awsId] }));
          const cluster = res.clusters?.[0];
          if (!cluster || cluster.status === 'INACTIVE') return null;
          return {
            clusterName: cluster.clusterName,
            status: cluster.status,
            registeredContainerInstancesCount: cluster.registeredContainerInstancesCount,
            runningTasksCount: cluster.runningTasksCount,
          };
        }
        case 'ecs-service': {
          // awsId is an ARN — extract cluster from it
          const parts = awsId.split('/');
          const clusterName = parts[1];
          const serviceName = parts[2] ?? parts[1];
          const res = await this.ecs.send(new DescribeServicesCommand({
            cluster: clusterName,
            services: [serviceName],
          }));
          const svc = res.services?.[0];
          if (!svc || svc.status === 'INACTIVE') return null;
          return {
            desiredCount: svc.desiredCount,
            runningCount: svc.runningCount,
            status: svc.status,
            launchType: svc.launchType,
          };
        }
        case 'elasticache-cluster': {
          const res = await this.elasticache.send(new DescribeCacheClustersCommand({
            CacheClusterId: awsId,
            ShowCacheNodeInfo: true,
          }));
          const cc = res.CacheClusters?.[0];
          if (!cc) return null;
          return {
            engine: cc.Engine,
            engineVersion: cc.EngineVersion,
            cacheNodeType: cc.CacheNodeType,
            numCacheNodes: cc.NumCacheNodes,
            cacheClusterStatus: cc.CacheClusterStatus,
          };
        }
        case 'lambda-function': {
          const fnName = awsId.includes(':') ? awsId.split(':').pop()! : awsId;
          const res = await this.lambda.send(new GetFunctionConfigurationCommand({
            FunctionName: fnName,
          }));
          return {
            runtime: res.Runtime,
            handler: res.Handler,
            memorySize: res.MemorySize,
            timeout: res.Timeout,
            state: res.State,
          };
        }
        case 'iam-role': {
          const roleName = awsId.includes('/') ? awsId.split('/').pop()! : awsId;
          const res = await this.iam.send(new GetRoleCommand({ RoleName: roleName }));
          const role = res.Role;
          if (!role) return null;
          return {
            roleName: role.RoleName,
            path: role.Path,
            arn: role.Arn,
          };
        }
        default:
          // Unsupported type — return empty config so we can still compare keys
          return {};
      }
    } catch (err: any) {
      // "Not found" errors mean the resource was deleted
      const code: string = err.name ?? '';
      const notFoundCodes = [
        'NotFoundException', 'ResourceNotFoundException', 'NoSuchEntity',
        'InvalidParameterValue', 'DBInstanceNotFound', 'DBClusterNotFoundFault',
        'CacheClusterNotFound', 'InvalidSubnetID.NotFound',
        'InvalidGroup.NotFound', 'InvalidVpcID.NotFound',
        'InvalidInstanceID.NotFound', 'NatGatewayNotFound',
        'NoSuchBucket', 'ResourceNotFoundFault',
      ];
      if (notFoundCodes.some(c => code.includes(c))) {
        return null;
      }
      // Re-throw unexpected errors so callers can decide
      throw err;
    }
  }

  /**
   * Compare planned vs actual configurations
   */
  private compareConfigurations(
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
    resourceType: string,
  ): Array<{
    path: string;
    expectedValue: unknown;
    actualValue: unknown;
    severity: 'critical' | 'high' | 'medium' | 'low';
  }> {
    const differences = [];
    
    // Simplified comparison - production would use deep diff
    for (const [key, expectedValue] of Object.entries(expected)) {
      const actualValue = actual[key];
      
      if (JSON.stringify(expectedValue) !== JSON.stringify(actualValue)) {
        differences.push({
          path: key,
          expectedValue,
          actualValue,
          severity: this.determineDiffSeverity(key, resourceType),
        });
      }
    }
    
    return differences;
  }

  /**
   * Determine severity of a configuration difference
   */
  private determineDiffSeverity(
    propertyPath: string,
    resourceType: string,
  ): 'critical' | 'high' | 'medium' | 'low' {
    const criticalProperties = [
      'encryptionAtRest',
      'encryptionInTransit',
      'publiclyAccessible',
      'deletionProtection',
    ];
    
    if (criticalProperties.some(p => propertyPath.includes(p))) {
      return 'critical';
    }
    
    return 'medium';
  }

  /**
   * Fetch actual costs from AWS Cost Explorer for the last 30 days.
   * Returns a map of resource planned-ID → monthly USD cost.
   */
  private async fetchActualCosts(
    resourceArns: string[],
    _region: string,
  ): Promise<Record<string, number>> {
    if (resourceArns.length === 0) return {};

    const now = new Date();
    const end = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    try {
      const res = await this.costExplorer.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: start, End: end },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        // Group by individual resource so we can map back to plan IDs
        GroupBy: [{ Type: 'DIMENSION', Key: 'RESOURCE_ID' }],
        // Filter to only the resources we care about
        Filter: {
          Dimensions: {
            Key: 'RESOURCE_ID',
            Values: resourceArns,
          },
        },
      }));

      const costMap: Record<string, number> = {};
      for (const period of res.ResultsByTime ?? []) {
        for (const group of period.Groups ?? []) {
          const arn = group.Keys?.[0];
          if (!arn) continue;
          const amount = parseFloat(group.Metrics?.UnblendedCost?.Amount ?? '0');
          costMap[arn] = (costMap[arn] ?? 0) + amount;
        }
      }
      return costMap;
    } catch (err: any) {
      // Cost Explorer may not be enabled, or the account may lack permissions.
      // Return empty so drift detection still works; cost anomalies just won't fire.
      console.warn(`Cost Explorer query failed (costs will be skipped): ${err.message ?? err}`);
      return {};
    }
  }

  /**
   * Analyze possible causes of cost anomalies
   */
  private analyzeCostAnomaly(
    resource: PlannedResource,
    actualCost: number,
    expectedCost: number,
  ): string[] {
    const causes: string[] = [];
    
    if (actualCost > expectedCost * 1.5) {
      if (resource.type.includes('instance') || resource.type.includes('cluster')) {
        causes.push('Higher than expected instance utilization');
        causes.push('Additional instances may have been launched');
      }
      
      if (resource.type.includes('storage') || resource.type.includes('bucket')) {
        causes.push('Storage usage exceeded estimates');
        causes.push('Data transfer costs may be higher than expected');
      }
      
      if (resource.type.includes('database')) {
        causes.push('Database I/O operations exceeded estimates');
        causes.push('Backup storage costs may be higher');
      }
    }
    
    return causes;
  }

  /**
   * Send alerts via SNS
   */
  private async sendAlerts(
    drifts: ResourceDrift[],
    violations: any[],
    anomalies: CostAnomaly[],
    context: ReconciliationContext,
  ): Promise<void> {
    if (!this.config.alertTopicArn) return;
    
    const alertMessage = this.formatAlertMessage(drifts, violations, anomalies, context);

    await this.sns.send(new PublishCommand({
      TopicArn: this.config.alertTopicArn,
      Subject: `IDIO Reconciliation: ${context.plan.intent.name} [${drifts.length} drifts, ${violations.length} violations, ${anomalies.length} cost anomalies]`.slice(0, 100),
      Message: alertMessage,
      MessageAttributes: {
        planId: { DataType: 'String', StringValue: context.plan.id },
        executionId: { DataType: 'String', StringValue: context.execution.executionId },
        driftCount: { DataType: 'Number', StringValue: String(drifts.length) },
        violationCount: { DataType: 'Number', StringValue: String(violations.length) },
        anomalyCount: { DataType: 'Number', StringValue: String(anomalies.length) },
      },
    }));
  }

  /**
   * Format alert message
   */
  private formatAlertMessage(
    drifts: ResourceDrift[],
    violations: any[],
    anomalies: CostAnomaly[],
    context: ReconciliationContext,
  ): string {
    const sections = [];
    
    sections.push(`Reconciliation Report for ${context.plan.intent.name}`);
    sections.push(`Plan ID: ${context.plan.id}`);
    sections.push(`Execution ID: ${context.execution.executionId}`);
    sections.push('');
    
    if (drifts.length > 0) {
      sections.push(`🔄 Configuration Drift: ${drifts.length} resource(s)`);
      for (const drift of drifts) {
        sections.push(`  - ${drift.resourceId}: ${drift.driftType}`);
      }
      sections.push('');
    }
    
    if (violations.length > 0) {
      sections.push(`⚠️  Compliance Violations: ${violations.length}`);
      for (const violation of violations) {
        sections.push(`  - ${violation.policy}: ${violation.message}`);
      }
      sections.push('');
    }
    
    if (anomalies.length > 0) {
      sections.push(`💰 Cost Anomalies: ${anomalies.length}`);
      for (const anomaly of anomalies) {
        sections.push(`  - ${anomaly.service}: ${anomaly.percentageDifference.toFixed(1)}% ${anomaly.type}`);
      }
      sections.push('');
    }
    
    return sections.join('\n');
  }
}

/**
 * Create EventBridge rule for continuous reconciliation.
 * The rule triggers a Lambda function at the specified interval.
 */
export async function createReconciliationSchedule(
  planId: string,
  executionId: string,
  intervalMinutes: number,
  region: string,
  credentials?: () => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }>,
): Promise<{
  ruleArn: string;
  targetArn: string;
}> {
  const clientConfig = { region, ...(credentials ? { credentials } : {}) };
  const eb = new EventBridgeClient(clientConfig);

  const ruleName = `idio-reconcile-${planId}`;
  const scheduleExpression = `rate(${intervalMinutes} minutes)`;

  const ruleResult = await eb.send(new PutRuleCommand({
    Name: ruleName,
    ScheduleExpression: scheduleExpression,
    State: 'ENABLED',
    Description: `IDIO reconciliation for plan ${planId} (execution ${executionId})`,
  }));

  // The target Lambda must already exist; here we wire the rule → function.
  const targetLambdaArn = `arn:aws:lambda:${region}:*:function:idio-reconcile-handler`;
  await eb.send(new PutTargetsCommand({
    Rule: ruleName,
    Targets: [{
      Id: `idio-target-${planId}`,
      Arn: targetLambdaArn,
      Input: JSON.stringify({ planId, executionId }),
    }],
  }));

  return {
    ruleArn: ruleResult.RuleArn!,
    targetArn: targetLambdaArn,
  };
}

/**
 * Create Step Functions state machine for reconciliation workflow.
 * Deploys the full state machine definition to AWS.
 */
export async function createReconciliationWorkflow(
  planId: string,
  config: ReconciliationConfig,
  region: string,
  roleArn: string,
  credentials?: () => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }>,
): Promise<{
  stateMachineArn: string;
  definition: string;
}> {
  const definition = {
    Comment: 'Infrastructure Reconciliation Workflow',
    StartAt: 'CheckDrift',
    States: {
      CheckDrift: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'drift-checker',
          Payload: {
            planId,
            'timestamp.$': '$$.State.EnteredTime',
          },
        },
        Next: 'EvaluateDrift',
      },
      EvaluateDrift: {
        Type: 'Choice',
        Choices: [
          {
            Variable: '$.driftDetected',
            BooleanEquals: true,
            Next: 'GenerateRemediationPlan',
          },
        ],
        Default: 'CheckCompliance',
      },
      GenerateRemediationPlan: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'remediation-planner',
          'Payload.$': '$',
        },
        Next: 'ApprovalRequired',
      },
      ApprovalRequired: {
        Type: 'Choice',
        Choices: [
          {
            Variable: '$.requiresApproval',
            BooleanEquals: false,
            Next: 'ExecuteRemediation',
          },
        ],
        Default: 'WaitForApproval',
      },
      WaitForApproval: {
        Type: 'Task',
        Resource: 'arn:aws:states:::sqs:sendMessage.waitForTaskToken',
        Parameters: {
          QueueUrl: 'approval-queue-url',
          MessageBody: {
            'TaskToken.$': '$$.Task.Token',
            'Plan.$': '$.remediationPlan',
          },
        },
        Next: 'ExecuteRemediation',
      },
      ExecuteRemediation: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'remediation-executor',
          'Payload.$': '$',
        },
        Next: 'CheckCompliance',
      },
      CheckCompliance: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'compliance-checker',
          'Payload.$': '$',
        },
        Next: 'CheckCostAnomalies',
      },
      CheckCostAnomalies: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'cost-anomaly-detector',
          'Payload.$': '$',
        },
        Next: 'SendReport',
      },
      SendReport: {
        Type: 'Task',
        Resource: 'arn:aws:states:::sns:publish',
        Parameters: {
          TopicArn: config.alertTopicArn,
          'Message.$': '$.reportMessage',
        },
        End: true,
      },
    },
  };

  const definitionStr = JSON.stringify(definition, null, 2);
  const clientConfig = { region, ...(credentials ? { credentials } : {}) };
  const sfn = new SFNClient(clientConfig);

  const result = await sfn.send(new CreateStateMachineCommand({
    name: `idio-reconcile-${planId}`,
    definition: definitionStr,
    roleArn,
    type: 'STANDARD',
  }));

  return {
    stateMachineArn: result.stateMachineArn!,
    definition: definitionStr,
  };
}

/**
 * Create reconciliation engine instance
 */
export function createReconciliationEngine(
  config: Partial<ReconciliationConfig>,
  policyEngine: PolicyEngine,
): ReconciliationEngine {
  const defaultConfig: ReconciliationConfig = {
    intervalMinutes: 15,
    enableAutoRemediation: false,
    costAnomalyThreshold: 20,
    maxRemediationAttempts: 3,
  };
  
  return new ReconciliationEngine({ ...defaultConfig, ...config }, policyEngine);
}
