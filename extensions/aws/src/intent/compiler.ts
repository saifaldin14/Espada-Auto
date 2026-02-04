/**
 * Intent Compiler - Transforms high-level intents into executable infrastructure plans
 * 
 * This compiler analyzes application intents and generates optimized infrastructure
 * plans using existing AWS service managers.
 */

import { randomUUID } from 'node:crypto';
import type {
  ApplicationIntent,
  ApplicationTierIntent,
  InfrastructurePlan,
  PlannedResource,
  CostBreakdownItem,
  PolicyValidationResult,
  GuardrailCheckResult,
} from './types.js';

export interface CompilerConfig {
  /** Default region if not specified */
  defaultRegion: string;
  /** Enable cost optimization */
  enableCostOptimization: boolean;
  /** Enable guardrails */
  enableGuardrails: boolean;
  /** Dry run mode */
  dryRun: boolean;
}

export interface CompilerContext {
  /** Execution ID for tracking */
  executionId: string;
  /** Timestamp */
  timestamp: string;
  /** User/agent identifier */
  userId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Intent Compiler - Core orchestration logic
 */
export class IntentCompiler {
  constructor(private config: CompilerConfig) {}

  /**
   * Compile an application intent into an executable infrastructure plan
   */
  async compile(
    intent: ApplicationIntent,
    context: CompilerContext,
  ): Promise<InfrastructurePlan> {
    const planId = randomUUID();
    const resources: PlannedResource[] = [];
    const executionOrder: string[][] = [];

    // Execute compilation phases in order
    const phases = [
      { name: 'Network Infrastructure', compiler: () => this.compileNetworkInfrastructure(intent) },
      { name: 'Security & IAM', compiler: () => this.compileSecurityInfrastructure(intent) },
      { name: 'Data Layer', compiler: () => this.compileDataLayer(intent) },
      { name: 'Application Layer', compiler: () => this.compileApplicationLayer(intent) },
      { name: 'Monitoring', compiler: () => this.compileMonitoring(intent) },
    ];

    // Add DR phase conditionally
    if (intent.disasterRecovery) {
      phases.push({ name: 'Disaster Recovery', compiler: () => this.compileDisasterRecovery(intent) });
    }

    // Execute all phases and collect resources
    for (const phase of phases) {
      const phaseResources = await this.executeCompilationPhase(phase.name, phase.compiler);
      resources.push(...phaseResources);
      if (phaseResources.length > 0) {
        executionOrder.push(phaseResources.map(r => r.id));
      }
    }

    // Cost estimation
    const { totalCost, breakdown } = await this.estimateCost(resources, intent);

    // Policy validation
    const policyValidation = await this.validatePolicies(resources, intent);

    // Guardrail checks
    const guardrailChecks = await this.runGuardrailChecks(resources, intent);

    // Build plan
    const plan: InfrastructurePlan = {
      id: planId,
      intent,
      resources,
      estimatedMonthlyCostUsd: totalCost,
      costBreakdown: breakdown,
      policyValidation,
      guardrailChecks,
      executionOrder,
      createdAt: context.timestamp,
    };

    return plan;
  }

  /**
   * Compile network infrastructure (VPC, subnets, security groups)
   */
  private async compileNetworkInfrastructure(
    intent: ApplicationIntent,
  ): Promise<PlannedResource[]> {
    const resources: PlannedResource[] = [];
    const vpcId = `vpc-${randomUUID().slice(0, 8)}`;
    const region = intent.primaryRegion;

    // VPC
    resources.push({
      id: vpcId,
      type: 'vpc',
      service: 'ec2',
      properties: {
        cidrBlock: '10.0.0.0/16',
        enableDnsHostnames: true,
        enableDnsSupport: true,
        tags: {
          Name: `${intent.name}-vpc`,
          Environment: intent.environment,
          ...intent.tags,
        },
      },
      dependencies: [],
      estimatedCostUsd: 0, // VPCs are free
      region,
      tags: { ...intent.tags, Resource: 'VPC' },
      rationale: 'VPC provides network isolation as required by security policy',
    });

    // Determine subnet strategy based on availability requirements
    const subnetCount = this.getRequiredSubnetCount(intent.availability);
    const azs = this.getAvailabilityZones(region, subnetCount);

    // Public subnets (for load balancers)
    const publicSubnetIds: string[] = [];
    for (let i = 0; i < azs.length; i++) {
      const subnetId = `subnet-public-${randomUUID().slice(0, 8)}`;
      publicSubnetIds.push(subnetId);
      
      resources.push({
        id: subnetId,
        type: 'subnet',
        service: 'ec2',
        properties: {
          vpcId,
          cidrBlock: `10.0.${i}.0/24`,
          availabilityZone: azs[i],
          mapPublicIpOnLaunch: true,
          tags: {
            Name: `${intent.name}-public-${azs[i]}`,
            Tier: 'public',
          },
        },
        dependencies: [vpcId],
        estimatedCostUsd: 0,
        region,
        tags: { ...intent.tags, Tier: 'public' },
      });
    }

    // Private subnets (for application and database tiers)
    const privateSubnetIds: string[] = [];
    for (let i = 0; i < azs.length; i++) {
      const subnetId = `subnet-private-${randomUUID().slice(0, 8)}`;
      privateSubnetIds.push(subnetId);
      
      resources.push({
        id: subnetId,
        type: 'subnet',
        service: 'ec2',
        properties: {
          vpcId,
          cidrBlock: `10.0.${i + 10}.0/24`,
          availabilityZone: azs[i],
          mapPublicIpOnLaunch: false,
          tags: {
            Name: `${intent.name}-private-${azs[i]}`,
            Tier: 'private',
          },
        },
        dependencies: [vpcId],
        estimatedCostUsd: 0,
        region,
        tags: { ...intent.tags, Tier: 'private' },
      });
    }

    // Internet Gateway (for public subnets)
    const igwId = `igw-${randomUUID().slice(0, 8)}`;
    resources.push({
      id: igwId,
      type: 'internet_gateway',
      service: 'ec2',
      properties: {
        vpcId,
        tags: { Name: `${intent.name}-igw` },
      },
      dependencies: [vpcId],
      estimatedCostUsd: 0,
      region,
      tags: { ...intent.tags },
    });

    // NAT Gateways (for private subnet internet access)
    if (intent.security.networkIsolation !== 'airgapped') {
      for (let i = 0; i < azs.length; i++) {
        const natId = `nat-${randomUUID().slice(0, 8)}`;
        resources.push({
          id: natId,
          type: 'nat_gateway',
          service: 'ec2',
          properties: {
            subnetId: publicSubnetIds[i],
            tags: { Name: `${intent.name}-nat-${azs[i]}` },
          },
          dependencies: [publicSubnetIds[i]],
          estimatedCostUsd: 32.85, // ~$0.045/hr
          region,
          tags: { ...intent.tags },
          rationale: `NAT Gateway for high availability in ${azs[i]}`,
        });
      }
    }

    return resources;
  }

  /**
   * Compile security infrastructure (security groups, IAM roles)
   */
  private async compileSecurityInfrastructure(
    intent: ApplicationIntent,
  ): Promise<PlannedResource[]> {
    const resources: PlannedResource[] = [];
    const region = intent.primaryRegion;

    // Web tier security group
    if (intent.tiers.some(t => t.type === 'web')) {
      resources.push({
        id: `sg-web-${randomUUID().slice(0, 8)}`,
        type: 'security_group',
        service: 'ec2',
        properties: {
          name: `${intent.name}-web-sg`,
          description: 'Security group for web tier',
          ingressRules: [
            { protocol: 'tcp', port: 80, cidr: '0.0.0.0/0', description: 'HTTP' },
            { protocol: 'tcp', port: 443, cidr: '0.0.0.0/0', description: 'HTTPS' },
          ],
          egressRules: [
            { protocol: '-1', port: -1, cidr: '0.0.0.0/0', description: 'All outbound' },
          ],
        },
        dependencies: [],
        estimatedCostUsd: 0,
        region,
        tags: { ...intent.tags, Tier: 'web' },
      });
    }

    // Application tier security group
    if (intent.tiers.some(t => t.type === 'api')) {
      resources.push({
        id: `sg-app-${randomUUID().slice(0, 8)}`,
        type: 'security_group',
        service: 'ec2',
        properties: {
          name: `${intent.name}-app-sg`,
          description: 'Security group for application tier',
          ingressRules: [
            { protocol: 'tcp', port: 8080, sourceSecurityGroup: 'sg-web', description: 'From web tier' },
          ],
          egressRules: [
            { protocol: '-1', port: -1, cidr: '0.0.0.0/0', description: 'All outbound' },
          ],
        },
        dependencies: [],
        estimatedCostUsd: 0,
        region,
        tags: { ...intent.tags, Tier: 'api' },
      });
    }

    // Database tier security group
    if (intent.tiers.some(t => t.type === 'database')) {
      resources.push({
        id: `sg-db-${randomUUID().slice(0, 8)}`,
        type: 'security_group',
        service: 'ec2',
        properties: {
          name: `${intent.name}-db-sg`,
          description: 'Security group for database tier',
          ingressRules: [
            { protocol: 'tcp', port: 5432, sourceSecurityGroup: 'sg-app', description: 'PostgreSQL from app' },
          ],
          egressRules: [],
        },
        dependencies: [],
        estimatedCostUsd: 0,
        region,
        tags: { ...intent.tags, Tier: 'database' },
        rationale: 'Restrict database access to application tier only',
      });
    }

    // IAM roles for services
    for (const tier of intent.tiers) {
      if (tier.type === 'web' || tier.type === 'api') {
        resources.push({
          id: `role-${tier.type}-${randomUUID().slice(0, 8)}`,
          type: 'iam_role',
          service: 'iam',
          properties: {
            name: `${intent.name}-${tier.type}-role`,
            assumeRolePolicy: {
              Version: '2012-10-17',
              Statement: [{
                Effect: 'Allow',
                Principal: { Service: 'ec2.amazonaws.com' },
                Action: 'sts:AssumeRole',
              }],
            },
            managedPolicies: [
              'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy',
            ],
          },
          dependencies: [],
          estimatedCostUsd: 0,
          region,
          tags: { ...intent.tags, Tier: tier.type },
        });
      }
    }

    // KMS key for encryption at rest
    if (intent.security.encryptionAtRest) {
      resources.push({
        id: `kms-${randomUUID().slice(0, 8)}`,
        type: 'kms_key',
        service: 'kms',
        properties: {
          description: `Encryption key for ${intent.name}`,
          keyPolicy: {
            Version: '2012-10-17',
            Statement: [{
              Sid: 'Enable IAM policies',
              Effect: 'Allow',
              Principal: { AWS: '*' },
              Action: 'kms:*',
              Resource: '*',
            }],
          },
          enableKeyRotation: true,
        },
        dependencies: [],
        estimatedCostUsd: 1.0, // $1/month
        region,
        tags: { ...intent.tags },
        rationale: 'KMS key for encryption at rest as required by compliance',
      });
    }

    return resources;
  }

  /**
   * Compile data layer (databases, caches, storage)
   */
  private async compileDataLayer(
    intent: ApplicationIntent,
  ): Promise<PlannedResource[]> {
    const resources: PlannedResource[] = [];
    const region = intent.primaryRegion;

    for (const tier of intent.tiers) {
      if (tier.type === 'database') {
        const dbResources = await this.compileDatabaseTier(tier, intent);
        resources.push(...dbResources);
      } else if (tier.type === 'cache') {
        const cacheResources = await this.compileCacheTier(tier, intent);
        resources.push(...cacheResources);
      } else if (tier.type === 'storage') {
        const storageResources = await this.compileStorageTier(tier, intent);
        resources.push(...storageResources);
      } else if (tier.type === 'queue') {
        const queueResources = await this.compileQueueTier(tier, intent);
        resources.push(...queueResources);
      }
    }

    return resources;
  }

  /**
   * Compile database tier (RDS)
   */
  private async compileDatabaseTier(
    tier: ApplicationTierIntent,
    intent: ApplicationIntent,
  ): Promise<PlannedResource[]> {
    const resources: PlannedResource[] = [];
    const region = intent.primaryRegion;
    
    // Choose instance size based on traffic and data size
    const instanceClass = this.selectDatabaseInstanceClass(tier, intent);
    const storageSize = tier.dataSizeGb ? Math.max(tier.dataSizeGb, 20) : 100;
    
    // Multi-AZ for high availability
    const multiAz = intent.availability >= '99.95';
    
    const dbId = `rds-${randomUUID().slice(0, 8)}`;
    resources.push({
      id: dbId,
      type: 'rds_instance',
      service: 'rds',
      properties: {
        identifier: `${intent.name}-db`,
        engine: 'postgres',
        engineVersion: '15.4',
        instanceClass,
        allocatedStorage: storageSize,
        storageType: 'gp3',
        storageEncrypted: intent.security.encryptionAtRest,
        multiAz,
        backupRetentionPeriod: intent.disasterRecovery?.backupRetentionDays || 7,
        preferredBackupWindow: '03:00-04:00',
        preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
        deletionProtection: intent.environment === 'production',
        enabledCloudwatchLogsExports: ['postgresql'],
        tags: {
          Name: `${intent.name}-db`,
          Environment: intent.environment,
          ...intent.tags,
        },
      },
      dependencies: ['sg-db'],
      estimatedCostUsd: this.estimateRDSCost(instanceClass, storageSize, multiAz),
      region,
      tags: { ...intent.tags, Tier: 'database' },
      rationale: `${instanceClass} provides sufficient capacity for ${tier.expectedRps || 'standard'} RPS workload`,
    });

    // Read replicas for high availability
    if (intent.availability >= '99.99') {
      resources.push({
        id: `rds-replica-${randomUUID().slice(0, 8)}`,
        type: 'rds_read_replica',
        service: 'rds',
        properties: {
          sourceInstanceId: dbId,
          instanceClass,
          storageEncrypted: intent.security.encryptionAtRest,
        },
        dependencies: [dbId],
        estimatedCostUsd: this.estimateRDSCost(instanceClass, storageSize, false) * 0.9,
        region,
        tags: { ...intent.tags, Tier: 'database', Role: 'replica' },
      });
    }

    return resources;
  }

  /**
   * Compile cache tier (ElastiCache Redis)
   */
  private async compileCacheTier(
    tier: ApplicationTierIntent,
    intent: ApplicationIntent,
  ): Promise<PlannedResource[]> {
    const resources: PlannedResource[] = [];
    const region = intent.primaryRegion;
    
    const nodeType = this.selectCacheNodeType(tier, intent);
    const numNodes = intent.availability >= '99.95' ? 2 : 1;

    resources.push({
      id: `elasticache-${randomUUID().slice(0, 8)}`,
      type: 'elasticache_cluster',
      service: 'elasticache',
      properties: {
        clusterId: `${intent.name}-cache`,
        engine: 'redis',
        engineVersion: '7.0',
        nodeType,
        numCacheNodes: numNodes,
        automaticFailoverEnabled: numNodes > 1,
        atRestEncryptionEnabled: intent.security.encryptionAtRest,
        transitEncryptionEnabled: intent.security.encryptionInTransit,
      },
      dependencies: [],
      estimatedCostUsd: this.estimateCacheCost(nodeType, numNodes),
      region,
      tags: { ...intent.tags, Tier: 'cache' },
    });

    return resources;
  }

  /**
   * Compile storage tier (S3)
   */
  private async compileStorageTier(
    tier: ApplicationTierIntent,
    intent: ApplicationIntent,
  ): Promise<PlannedResource[]> {
    const resources: PlannedResource[] = [];
    const region = intent.primaryRegion;

    resources.push({
      id: `s3-${randomUUID().slice(0, 8)}`,
      type: 's3_bucket',
      service: 's3',
      properties: {
        bucketName: `${intent.name}-storage-${Date.now()}`,
        versioning: intent.disasterRecovery?.backupRetentionDays ? true : false,
        encryption: intent.security.encryptionAtRest ? 'AES256' : 'none',
        lifecycleRules: [
          {
            id: 'transition-to-ia',
            transitions: [
              { days: 30, storageClass: 'STANDARD_IA' },
              { days: 90, storageClass: 'GLACIER' },
            ],
          },
        ],
      },
      dependencies: [],
      estimatedCostUsd: this.estimateS3Cost(tier.dataSizeGb || 100),
      region,
      tags: { ...intent.tags, Tier: 'storage' },
    });

    return resources;
  }

  /**
   * Compile queue tier (SQS)
   */
  private async compileQueueTier(
    tier: ApplicationTierIntent,
    intent: ApplicationIntent,
  ): Promise<PlannedResource[]> {
    const resources: PlannedResource[] = [];
    const region = intent.primaryRegion;

    resources.push({
      id: `sqs-${randomUUID().slice(0, 8)}`,
      type: 'sqs_queue',
      service: 'sqs',
      properties: {
        queueName: `${intent.name}-queue`,
        messageRetentionPeriod: 345600, // 4 days
        visibilityTimeout: 30,
        encryption: intent.security.encryptionAtRest,
      },
      dependencies: [],
      estimatedCostUsd: 5.0, // Estimated based on typical usage
      region,
      tags: { ...intent.tags, Tier: 'queue' },
    });

    return resources;
  }

  /**
   * Compile application layer (compute resources)
   */
  private async compileApplicationLayer(
    intent: ApplicationIntent,
  ): Promise<PlannedResource[]> {
    const resources: PlannedResource[] = [];

    for (const tier of intent.tiers) {
      if (tier.type === 'web' || tier.type === 'api') {
        const computeResources = await this.compileComputeTier(tier, intent);
        resources.push(...computeResources);
      }
    }

    return resources;
  }

  /**
   * Compile compute tier (EC2, ECS, Lambda based on traffic pattern)
   */
  private async compileComputeTier(
    tier: ApplicationTierIntent,
    intent: ApplicationIntent,
  ): Promise<PlannedResource[]> {
    const resources: PlannedResource[] = [];
    const region = intent.primaryRegion;

    // Choose compute platform based on traffic pattern and scaling requirements
    const useLambda = tier.trafficPattern === 'burst' || tier.trafficPattern === 'unpredictable';
    const useECS = tier.runtime?.containerImage !== undefined;
    const useEC2 = !useLambda && !useECS;

    if (useLambda) {
      // Lambda for burst/unpredictable traffic
      resources.push({
        id: `lambda-${tier.type}-${randomUUID().slice(0, 8)}`,
        type: 'lambda_function',
        service: 'lambda',
        properties: {
          functionName: `${intent.name}-${tier.type}`,
          runtime: this.mapRuntimeToLambda(tier.runtime?.language),
          handler: tier.runtime?.entryPoint || 'index.handler',
          memorySize: 1024,
          timeout: 30,
          environment: tier.runtime?.environmentVariables,
        },
        dependencies: [],
        estimatedCostUsd: this.estimateLambdaCost(tier.expectedRps || 100),
        region,
        tags: { ...intent.tags, Tier: tier.type },
        rationale: 'Lambda selected for burst traffic pattern and cost efficiency',
      });
    } else if (useECS) {
      // ECS Fargate for containerized workloads
      const taskDefId = `ecs-task-${randomUUID().slice(0, 8)}`;
      const serviceId = `ecs-service-${randomUUID().slice(0, 8)}`;
      
      resources.push({
        id: taskDefId,
        type: 'ecs_task_definition',
        service: 'ecs',
        properties: {
          family: `${intent.name}-${tier.type}`,
          cpu: '256',
          memory: '512',
          requiresCompatibilities: ['FARGATE'],
          containerDefinitions: [{
            name: tier.type,
            image: tier.runtime?.containerImage,
            portMappings: [{ containerPort: 8080, protocol: 'tcp' }],
            environment: tier.runtime?.environmentVariables,
          }],
        },
        dependencies: [],
        estimatedCostUsd: 15.0,
        region,
        tags: { ...intent.tags, Tier: tier.type },
      });

      resources.push({
        id: serviceId,
        type: 'ecs_service',
        service: 'ecs',
        properties: {
          serviceName: `${intent.name}-${tier.type}`,
          taskDefinition: taskDefId,
          desiredCount: tier.scaling?.min || 2,
          launchType: 'FARGATE',
        },
        dependencies: [taskDefId],
        estimatedCostUsd: 30.0 * (tier.scaling?.min || 2),
        region,
        tags: { ...intent.tags, Tier: tier.type },
      });
    } else {
      // EC2 with Auto Scaling
      const launchTemplateId = `lt-${randomUUID().slice(0, 8)}`;
      const asgId = `asg-${randomUUID().slice(0, 8)}`;
      
      const instanceType = this.selectInstanceType(tier, intent);
      
      resources.push({
        id: launchTemplateId,
        type: 'launch_template',
        service: 'ec2',
        properties: {
          name: `${intent.name}-${tier.type}-lt`,
          instanceType,
          imageId: 'ami-latest-amazon-linux-2',
          userData: this.generateUserData(tier),
        },
        dependencies: [],
        estimatedCostUsd: 0,
        region,
        tags: { ...intent.tags },
      });

      resources.push({
        id: asgId,
        type: 'autoscaling_group',
        service: 'autoscaling',
        properties: {
          name: `${intent.name}-${tier.type}-asg`,
          launchTemplate: launchTemplateId,
          minSize: tier.scaling?.min || 2,
          maxSize: tier.scaling?.max || 10,
          desiredCapacity: tier.scaling?.min || 2,
          healthCheckType: 'ELB',
          healthCheckGracePeriod: 300,
        },
        dependencies: [launchTemplateId],
        estimatedCostUsd: this.estimateEC2Cost(instanceType, tier.scaling?.min || 2),
        region,
        tags: { ...intent.tags, Tier: tier.type },
        rationale: `Auto Scaling Group for ${tier.type} tier with ${tier.scaling?.min || 2}-${tier.scaling?.max || 10} instances`,
      });

      // Application Load Balancer
      const albId = `alb-${randomUUID().slice(0, 8)}`;
      resources.push({
        id: albId,
        type: 'application_load_balancer',
        service: 'elbv2',
        properties: {
          name: `${intent.name}-${tier.type}-alb`,
          scheme: 'internet-facing',
          ipAddressType: 'ipv4',
        },
        dependencies: [],
        estimatedCostUsd: 16.2, // ~$0.0225/hr
        region,
        tags: { ...intent.tags, Tier: tier.type },
      });
    }

    return resources;
  }

  /**
   * Compile monitoring and observability stack
   */
  private async compileMonitoring(
    intent: ApplicationIntent,
  ): Promise<PlannedResource[]> {
    const resources: PlannedResource[] = [];
    const region = intent.primaryRegion;

    // CloudWatch Dashboard
    resources.push({
      id: `dashboard-${randomUUID().slice(0, 8)}`,
      type: 'cloudwatch_dashboard',
      service: 'cloudwatch',
      properties: {
        dashboardName: `${intent.name}-dashboard`,
        dashboardBody: JSON.stringify({
          widgets: [
            { type: 'metric', properties: { metrics: ['AWS/EC2', 'CPUUtilization'] } },
            { type: 'metric', properties: { metrics: ['AWS/RDS', 'DatabaseConnections'] } },
          ],
        }),
      },
      dependencies: [],
      estimatedCostUsd: 3.0,
      region,
      tags: { ...intent.tags },
    });

    // CloudWatch Alarms for critical metrics
    const alarms = [
      { metric: 'CPUUtilization', threshold: 80, service: 'ec2' },
      { metric: 'DatabaseConnections', threshold: 80, service: 'rds' },
    ];

    for (const alarm of alarms) {
      resources.push({
        id: `alarm-${alarm.metric.toLowerCase()}-${randomUUID().slice(0, 8)}`,
        type: 'cloudwatch_alarm',
        service: 'cloudwatch',
        properties: {
          alarmName: `${intent.name}-${alarm.metric}`,
          metricName: alarm.metric,
          namespace: `AWS/${alarm.service.toUpperCase()}`,
          threshold: alarm.threshold,
          comparisonOperator: 'GreaterThanThreshold',
          evaluationPeriods: 2,
          period: 300,
        },
        dependencies: [],
        estimatedCostUsd: 0.10,
        region,
        tags: { ...intent.tags },
      });
    }

    return resources;
  }

  /**
   * Compile disaster recovery infrastructure
   */
  private async compileDisasterRecovery(
    intent: ApplicationIntent,
  ): Promise<PlannedResource[]> {
    const resources: PlannedResource[] = [];

    if (!intent.disasterRecovery) return resources;

    const { crossRegionReplication, backupRetentionDays } = intent.disasterRecovery;

    // AWS Backup plan
    resources.push({
      id: `backup-plan-${randomUUID().slice(0, 8)}`,
      type: 'backup_plan',
      service: 'backup',
      properties: {
        backupPlanName: `${intent.name}-backup`,
        rules: [
          {
            ruleName: 'daily-backup',
            scheduleExpression: 'cron(0 3 * * ? *)',
            lifecycle: {
              deleteAfterDays: backupRetentionDays,
            },
          },
        ],
      },
      dependencies: [],
      estimatedCostUsd: 5.0,
      region: intent.primaryRegion,
      tags: { ...intent.tags },
    });

    // Cross-region replication if required
    if (crossRegionReplication && intent.additionalRegions) {
      for (const region of intent.additionalRegions) {
        resources.push({
          id: `backup-copy-${region}-${randomUUID().slice(0, 8)}`,
          type: 'backup_copy_action',
          service: 'backup',
          properties: {
            destinationBackupVaultArn: `arn:aws:backup:${region}:*:backup-vault:*`,
            lifecycle: {
              deleteAfterDays: backupRetentionDays,
            },
          },
          dependencies: [],
          estimatedCostUsd: 2.0,
          region,
          tags: { ...intent.tags },
        });
      }
    }

    return resources;
  }

  /**
   * Estimate total cost and generate breakdown
   */
  private async estimateCost(
    resources: PlannedResource[],
    intent: ApplicationIntent,
  ): Promise<{ totalCost: number; breakdown: CostBreakdownItem[] }> {
    const breakdown: CostBreakdownItem[] = [];
    const serviceMap = new Map<string, CostBreakdownItem>();

    for (const resource of resources) {
      const key = `${resource.service}-${resource.type}`;
      
      if (!serviceMap.has(key)) {
        serviceMap.set(key, {
          service: resource.service,
          resourceType: resource.type,
          monthlyCostUsd: 0,
          drivers: [],
        });
      }
      
      const item = serviceMap.get(key)!;
      item.monthlyCostUsd += resource.estimatedCostUsd;
    }

    breakdown.push(...Array.from(serviceMap.values()));
    const totalCost = breakdown.reduce((sum, item) => sum + item.monthlyCostUsd, 0);

    // Add optimization suggestions if over budget
    if (totalCost > intent.cost.monthlyBudgetUsd) {
      breakdown.forEach(item => {
        item.optimizations = this.generateCostOptimizations(item, intent);
      });
    }

    return { totalCost, breakdown };
  }

  /**
   * Validate infrastructure against compliance policies
   */
  private async validatePolicies(
    resources: PlannedResource[],
    intent: ApplicationIntent,
  ): Promise<PolicyValidationResult> {
    const violations = [];
    const warnings = [];
    const policiesEvaluated = ['encryption', 'network-isolation', 'backup', 'multi-az'];

    // Encryption policy
    if (intent.security.encryptionAtRest) {
      const unencryptedResources = resources.filter(r => 
        (r.type === 'rds_instance' || r.type === 's3_bucket') &&
        !r.properties.storageEncrypted &&
        !r.properties.encryption
      );
      
      if (unencryptedResources.length > 0) {
        violations.push({
          severity: 'critical' as const,
          policy: 'encryption-at-rest',
          resourceId: unencryptedResources[0].id,
          message: 'Encryption at rest is required but not enabled',
          remediation: 'Enable encryption for all data resources',
          autoFixable: true,
        });
      }
    }

    // Multi-AZ policy for high availability
    if (intent.availability >= '99.99') {
      const singleAzDatabases = resources.filter(r =>
        r.type === 'rds_instance' && !r.properties.multiAz
      );
      
      if (singleAzDatabases.length > 0) {
        violations.push({
          severity: 'high' as const,
          policy: 'high-availability',
          resourceId: singleAzDatabases[0].id,
          message: '99.99% availability requires Multi-AZ deployment',
          remediation: 'Enable Multi-AZ for RDS instances',
          autoFixable: true,
        });
      }
    }

    // Backup policy
    if (intent.disasterRecovery) {
      const dbWithoutBackup = resources.filter(r =>
        r.type === 'rds_instance' && 
        (!r.properties.backupRetentionPeriod || (r.properties.backupRetentionPeriod as number) < intent.disasterRecovery!.backupRetentionDays)
      );
      
      if (dbWithoutBackup.length > 0) {
        warnings.push({
          message: 'Backup retention period is less than DR requirement',
          resourceId: dbWithoutBackup[0].id,
          recommendation: `Set backup retention to ${intent.disasterRecovery.backupRetentionDays} days`,
        });
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      warnings,
      policiesEvaluated,
    };
  }

  /**
   * Run guardrail checks
   */
  private async runGuardrailChecks(
    resources: PlannedResource[],
    intent: ApplicationIntent,
  ): Promise<GuardrailCheckResult[]> {
    const checks: GuardrailCheckResult[] = [];

    // Budget check
    const totalCost = resources.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
    checks.push({
      check: 'budget-compliance',
      passed: totalCost <= intent.cost.monthlyBudgetUsd,
      message: totalCost <= intent.cost.monthlyBudgetUsd
        ? `Estimated cost $${totalCost.toFixed(2)} is within budget $${intent.cost.monthlyBudgetUsd}`
        : `Estimated cost $${totalCost.toFixed(2)} exceeds budget $${intent.cost.monthlyBudgetUsd}`,
      approvalLevel: totalCost > intent.cost.monthlyBudgetUsd ? 'architect' : 'none',
    });

    // Production environment check
    if (intent.environment === 'production') {
      checks.push({
        check: 'production-deployment',
        passed: true,
        message: 'Production deployment requires architect approval',
        approvalLevel: 'architect',
      });
    }

    // Compliance check
    if (intent.compliance.length > 0 && !intent.compliance.includes('none')) {
      checks.push({
        check: 'compliance-review',
        passed: true,
        message: `Compliance frameworks: ${intent.compliance.join(', ')} - requires security team review`,
        approvalLevel: 'security-team',
      });
    }

    return checks;
  }

  // Helper methods

  private getRequiredSubnetCount(availability: string): number {
    if (availability >= '99.99') return 3;
    if (availability >= '99.95') return 2;
    return 1;
  }

  private getAvailabilityZones(region: string, count: number): string[] {
    // Simplified - in production, fetch from AWS API
    const azSuffixes = ['a', 'b', 'c', 'd', 'e', 'f'];
    return azSuffixes.slice(0, count).map(suffix => `${region}${suffix}`);
  }

  private selectDatabaseInstanceClass(tier: ApplicationTierIntent, intent: ApplicationIntent): string {
    const rps = tier.expectedRps || 100;
    const dataSizeGb = tier.dataSizeGb || 100;
    
    if (intent.cost.prioritizeCost) {
      if (rps < 500 && (dataSizeGb as number) < 100) return 'db.t4g.small';
      if (rps < 2000 && (dataSizeGb as number) < 500) return 'db.t4g.medium';
      return 'db.t4g.large';
    }
    
    if (rps < 500) return 'db.r6g.large';
    if (rps < 2000) return 'db.r6g.xlarge';
    return 'db.r6g.2xlarge';
  }

  /**
   * Execute a compilation phase with error handling
   */
  private async executeCompilationPhase(
    phaseName: string,
    compiler: () => Promise<PlannedResource[]>,
  ): Promise<PlannedResource[]> {
    try {
      return await compiler();
    } catch (error) {
      console.error(`Compilation phase "${phaseName}" failed:`, error);
      throw new Error(`Failed to compile ${phaseName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private selectCacheNodeType(tier: ApplicationTierIntent, intent: ApplicationIntent): string {
    const rps = tier.expectedRps || 100;
    
    if (intent.cost.prioritizeCost) {
      if (rps < 1000) return 'cache.t4g.micro';
      if (rps < 5000) return 'cache.t4g.small';
      return 'cache.t4g.medium';
    }
    
    if (rps < 1000) return 'cache.r6g.large';
    if (rps < 5000) return 'cache.r6g.xlarge';
    return 'cache.r6g.2xlarge';
  }

  private selectInstanceType(tier: ApplicationTierIntent, intent: ApplicationIntent): string {
    const rps = tier.expectedRps || 100;
    
    if (intent.cost.prioritizeCost) {
      if (rps < 100) return 't4g.small';
      if (rps < 500) return 't4g.medium';
      return 't4g.large';
    }
    
    if (rps < 100) return 'c6g.large';
    if (rps < 500) return 'c6g.xlarge';
    return 'c6g.2xlarge';
  }

  private mapRuntimeToLambda(language?: string): string {
    const map: Record<string, string> = {
      nodejs: 'nodejs20.x',
      python: 'python3.12',
      java: 'java21',
      go: 'provided.al2023',
      dotnet: 'dotnet8',
      ruby: 'ruby3.2',
    };
    return map[language || 'nodejs'] || 'nodejs20.x';
  }

  private generateUserData(tier: ApplicationTierIntent): string {
    return `#!/bin/bash
yum update -y
yum install -y docker
systemctl start docker
systemctl enable docker
# Additional setup based on tier configuration
`;
  }

  private estimateRDSCost(instanceClass: string, storageGb: number, multiAz: boolean): number {
    const instanceCosts: Record<string, number> = {
      'db.t4g.small': 29,
      'db.t4g.medium': 58,
      'db.t4g.large': 116,
      'db.r6g.large': 155,
      'db.r6g.xlarge': 310,
      'db.r6g.2xlarge': 620,
    };
    const storageCost = storageGb * 0.115; // gp3 pricing
    const instanceCost = instanceCosts[instanceClass] || 100;
    return (multiAz ? instanceCost * 2 : instanceCost) + storageCost;
  }

  private estimateCacheCost(nodeType: string, numNodes: number): number {
    const nodeCosts: Record<string, number> = {
      'cache.t4g.micro': 12,
      'cache.t4g.small': 24,
      'cache.t4g.medium': 49,
      'cache.r6g.large': 138,
      'cache.r6g.xlarge': 277,
      'cache.r6g.2xlarge': 554,
    };
    return (nodeCosts[nodeType] || 50) * numNodes;
  }

  private estimateS3Cost(sizeGb: number): number {
    return sizeGb * 0.023; // Standard storage pricing
  }

  private estimateLambdaCost(rps: number): number {
    // Simplified: 1ms per request, 1GB memory
    const requestsPerMonth = rps * 60 * 60 * 24 * 30;
    const requestCost = (requestsPerMonth / 1000000) * 0.20;
    const computeCost = (requestsPerMonth * 0.001 * 1024 / 1024 / 1024) * 0.0000166667;
    return requestCost + computeCost;
  }

  private estimateEC2Cost(instanceType: string, count: number): number {
    const instanceCosts: Record<string, number> = {
      't4g.small': 12,
      't4g.medium': 24,
      't4g.large': 49,
      'c6g.large': 50,
      'c6g.xlarge': 100,
      'c6g.2xlarge': 200,
    };
    return (instanceCosts[instanceType] || 50) * count;
  }

  private generateCostOptimizations(item: CostBreakdownItem, intent: ApplicationIntent): string[] {
    const optimizations: string[] = [];
    
    if (item.service === 'ec2') {
      optimizations.push('Consider Reserved Instances for 40% savings');
      optimizations.push('Use Spot Instances for non-critical workloads');
    }
    
    if (item.service === 'rds') {
      optimizations.push('Consider Aurora Serverless for variable workloads');
      optimizations.push('Use smaller instance for development environments');
    }
    
    if (item.service === 's3') {
      optimizations.push('Enable Intelligent-Tiering for automatic cost optimization');
    }
    
    return optimizations;
  }
}

/**
 * Create a compiler instance with default configuration
 */
export function createIntentCompiler(config?: Partial<CompilerConfig>): IntentCompiler {
  const defaultConfig: CompilerConfig = {
    defaultRegion: 'us-east-1',
    enableCostOptimization: true,
    enableGuardrails: true,
    dryRun: false,
  };
  
  return new IntentCompiler({ ...defaultConfig, ...config });
}
