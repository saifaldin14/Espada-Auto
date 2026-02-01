/**
 * AWS Container Manager
 *
 * Provides comprehensive container orchestration support including:
 * - ECS (Elastic Container Service) clusters, services, and tasks
 * - EKS (Elastic Kubernetes Service) clusters and node groups
 * - ECR (Elastic Container Registry) repository management
 * - Container scaling and deployment operations
 * - Container insights and logging
 */

import {
  ECSClient,
  ListClustersCommand,
  DescribeClustersCommand,
  CreateClusterCommand,
  DeleteClusterCommand,
  UpdateClusterCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  CreateServiceCommand,
  UpdateServiceCommand,
  DeleteServiceCommand,
  ListTasksCommand,
  DescribeTasksCommand,
  RunTaskCommand,
  StopTaskCommand,
  ListTaskDefinitionsCommand,
  DescribeTaskDefinitionCommand,
  RegisterTaskDefinitionCommand,
  DeregisterTaskDefinitionCommand,
  ListContainerInstancesCommand,
  DescribeContainerInstancesCommand,
  UpdateContainerInstancesStateCommand,
  ListTagsForResourceCommand,
  TagResourceCommand,
  UntagResourceCommand,
  type Cluster,
  type Service,
  type Task,
  type TaskDefinition,
  type ContainerInstance,
  type KeyValuePair,
  type Tag,
} from '@aws-sdk/client-ecs';

import {
  EKSClient,
  ListClustersCommand as EKSListClustersCommand,
  DescribeClusterCommand as EKSDescribeClusterCommand,
  CreateClusterCommand as EKSCreateClusterCommand,
  DeleteClusterCommand as EKSDeleteClusterCommand,
  UpdateClusterConfigCommand,
  UpdateClusterVersionCommand,
  ListNodegroupsCommand,
  DescribeNodegroupCommand,
  CreateNodegroupCommand,
  UpdateNodegroupConfigCommand,
  UpdateNodegroupVersionCommand,
  DeleteNodegroupCommand,
  ListFargateProfilesCommand,
  DescribeFargateProfileCommand,
  CreateFargateProfileCommand,
  DeleteFargateProfileCommand,
  ListTagsForResourceCommand as EKSListTagsForResourceCommand,
  TagResourceCommand as EKSTagResourceCommand,
  UntagResourceCommand as EKSUntagResourceCommand,
  type Cluster as EKSCluster,
  type Nodegroup,
  type FargateProfile,
} from '@aws-sdk/client-eks';

import {
  ECRClient,
  DescribeRepositoriesCommand,
  CreateRepositoryCommand,
  DeleteRepositoryCommand,
  DescribeImagesCommand,
  BatchDeleteImageCommand,
  GetLifecyclePolicyCommand,
  PutLifecyclePolicyCommand,
  DeleteLifecyclePolicyCommand,
  StartImageScanCommand,
  DescribeImageScanFindingsCommand,
  GetAuthorizationTokenCommand,
  ListTagsForResourceCommand as ECRListTagsForResourceCommand,
  TagResourceCommand as ECRTagResourceCommand,
  UntagResourceCommand as ECRUntagResourceCommand,
  type Repository,
  type ImageDetail,
  type ImageIdentifier,
} from '@aws-sdk/client-ecr';

import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  FilterLogEventsCommand,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
} from '@aws-sdk/client-cloudwatch-logs';

import {
  CloudWatchClient,
  GetMetricDataCommand,
  type MetricDataQuery,
} from '@aws-sdk/client-cloudwatch';

import {
  ApplicationAutoScalingClient,
  RegisterScalableTargetCommand,
  DeregisterScalableTargetCommand,
  DescribeScalableTargetsCommand,
  PutScalingPolicyCommand,
  DeleteScalingPolicyCommand,
  DescribeScalingPoliciesCommand,
} from '@aws-sdk/client-application-auto-scaling';

import type {
  ContainerManagerConfig,
  ContainerOperationResult,
  // ECS Cluster
  ECSClusterInfo,
  ListECSClustersOptions,
  CreateECSClusterOptions,
  CapacityProviderStrategyItem,
  ClusterSetting,
  ClusterConfiguration,
  // ECS Service
  ECSServiceInfo,
  ListECSServicesOptions,
  CreateECSServiceOptions,
  UpdateECSServiceOptions,
  ScaleECSServiceOptions,
  DeploymentConfiguration,
  Deployment,
  ServiceEvent,
  NetworkConfiguration,
  LoadBalancerConfig,
  ServiceRegistry,
  // ECS Task
  ECSTaskInfo,
  ListECSTasksOptions,
  RunECSTaskOptions,
  TaskOverride,
  ContainerInfo,
  TaskAttachment,
  // Task Definition
  TaskDefinitionInfo,
  ListTaskDefinitionsOptions,
  RegisterTaskDefinitionOptions,
  ContainerDefinition,
  Volume,
  PlacementConstraint,
  // Container Instance
  ContainerInstanceInfo,
  ListContainerInstancesOptions,
  Resource,
  // EKS Cluster
  EKSClusterInfo,
  ListEKSClustersOptions,
  CreateEKSClusterOptions,
  UpdateEKSClusterOptions,
  EKSVpcConfig,
  KubernetesNetworkConfig,
  EKSLogging,
  EncryptionConfig,
  // EKS Node Group
  EKSNodeGroupInfo,
  ListEKSNodeGroupsOptions,
  CreateEKSNodeGroupOptions,
  UpdateEKSNodeGroupOptions,
  NodeGroupTaint,
  // EKS Fargate Profile
  EKSFargateProfileInfo,
  ListEKSFargateProfilesOptions,
  CreateEKSFargateProfileOptions,
  FargateProfileSelector,
  // ECR
  ECRRepositoryInfo,
  ECRImageInfo,
  ECRImageScanFindings,
  ListECRRepositoriesOptions,
  CreateECRRepositoryOptions,
  ListECRImagesOptions,
  GetECRImageScanFindingsOptions,
  ECRLifecyclePolicy,
  SetECRLifecyclePolicyOptions,
  // Logs
  GetContainerLogsOptions,
  ContainerLogEntry,
  // Auto Scaling
  ScalableTargetInfo,
  ScalingPolicyInfo,
  RegisterScalableTargetOptions,
  PutScalingPolicyOptions,
  // Rollback
  RollbackServiceOptions,
  RollbackResult,
  // Container Insights
  ContainerInsightsMetrics,
  GetContainerInsightsOptions,
} from './types.js';

/**
 * AWS Container Manager
 */
export class ContainerManager {
  private ecsClient: ECSClient;
  private eksClient: EKSClient;
  private ecrClient: ECRClient;
  private logsClient: CloudWatchLogsClient;
  private cloudWatchClient: CloudWatchClient;
  private autoScalingClient: ApplicationAutoScalingClient;
  private config: ContainerManagerConfig;

  constructor(config: ContainerManagerConfig = {}) {
    this.config = config;
    const clientConfig = {
      region: config.defaultRegion ?? 'us-east-1',
      credentials: config.credentials,
    };

    this.ecsClient = new ECSClient(clientConfig);
    this.eksClient = new EKSClient(clientConfig);
    this.ecrClient = new ECRClient(clientConfig);
    this.logsClient = new CloudWatchLogsClient(clientConfig);
    this.cloudWatchClient = new CloudWatchClient(clientConfig);
    this.autoScalingClient = new ApplicationAutoScalingClient(clientConfig);
  }

  // ===========================================================================
  // ECS Cluster Operations
  // ===========================================================================

  /**
   * List ECS clusters
   */
  async listECSClusters(options: ListECSClustersOptions = {}): Promise<ECSClusterInfo[]> {
    const { maxResults, includeDetails = true } = options;

    const listCommand = new ListClustersCommand({
      maxResults,
    });

    const listResponse = await this.ecsClient.send(listCommand);
    const clusterArns = listResponse.clusterArns ?? [];

    if (clusterArns.length === 0) {
      return [];
    }

    if (!includeDetails) {
      return clusterArns.map(arn => ({
        clusterName: arn.split('/').pop() ?? '',
        clusterArn: arn,
        status: 'UNKNOWN',
        registeredContainerInstancesCount: 0,
        runningTasksCount: 0,
        pendingTasksCount: 0,
        activeServicesCount: 0,
        capacityProviders: [],
        defaultCapacityProviderStrategy: [],
        settings: [],
        tags: {},
        statistics: [],
      }));
    }

    const describeCommand = new DescribeClustersCommand({
      clusters: clusterArns,
      include: ['ATTACHMENTS', 'CONFIGURATIONS', 'SETTINGS', 'STATISTICS', 'TAGS'],
    });

    const describeResponse = await this.ecsClient.send(describeCommand);
    return (describeResponse.clusters ?? []).map(this.mapECSCluster);
  }

  /**
   * Get ECS cluster details
   */
  async getECSCluster(clusterName: string): Promise<ContainerOperationResult<ECSClusterInfo>> {
    try {
      const command = new DescribeClustersCommand({
        clusters: [clusterName],
        include: ['ATTACHMENTS', 'CONFIGURATIONS', 'SETTINGS', 'STATISTICS', 'TAGS'],
      });

      const response = await this.ecsClient.send(command);
      const cluster = response.clusters?.[0];

      if (!cluster) {
        return { success: false, error: `Cluster ${clusterName} not found` };
      }

      return { success: true, data: this.mapECSCluster(cluster) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Create ECS cluster
   */
  async createECSCluster(options: CreateECSClusterOptions): Promise<ContainerOperationResult<ECSClusterInfo>> {
    try {
      const command = new CreateClusterCommand({
        clusterName: options.clusterName,
        capacityProviders: options.capacityProviders,
        defaultCapacityProviderStrategy: options.defaultCapacityProviderStrategy?.map(s => ({
          capacityProvider: s.capacityProvider,
          weight: s.weight,
          base: s.base,
        })),
        settings: options.settings?.map(s => ({
          name: s.name as 'containerInsights',
          value: s.value,
        })),
        configuration: options.configuration ? {
          executeCommandConfiguration: options.configuration.executeCommandConfiguration ? {
            kmsKeyId: options.configuration.executeCommandConfiguration.kmsKeyId,
            logging: options.configuration.executeCommandConfiguration.logging as 'NONE' | 'DEFAULT' | 'OVERRIDE',
            logConfiguration: options.configuration.executeCommandConfiguration.logConfiguration,
          } : undefined,
        } : undefined,
        tags: this.recordToTags(options.tags),
        serviceConnectDefaults: options.serviceConnectDefaults,
      });

      const response = await this.ecsClient.send(command);

      if (!response.cluster) {
        return { success: false, error: 'Failed to create cluster' };
      }

      return {
        success: true,
        data: this.mapECSCluster(response.cluster),
        message: `Cluster ${options.clusterName} created successfully`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete ECS cluster
   */
  async deleteECSCluster(clusterName: string): Promise<ContainerOperationResult<void>> {
    try {
      await this.ecsClient.send(new DeleteClusterCommand({ cluster: clusterName }));
      return { success: true, message: `Cluster ${clusterName} deleted successfully` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update ECS cluster settings
   */
  async updateECSCluster(
    clusterName: string,
    settings?: ClusterSetting[],
    configuration?: ClusterConfiguration
  ): Promise<ContainerOperationResult<ECSClusterInfo>> {
    try {
      const command = new UpdateClusterCommand({
        cluster: clusterName,
        settings: settings?.map(s => ({
          name: s.name as 'containerInsights',
          value: s.value,
        })),
        configuration: configuration ? {
          executeCommandConfiguration: configuration.executeCommandConfiguration ? {
            kmsKeyId: configuration.executeCommandConfiguration.kmsKeyId,
            logging: configuration.executeCommandConfiguration.logging as 'NONE' | 'DEFAULT' | 'OVERRIDE',
            logConfiguration: configuration.executeCommandConfiguration.logConfiguration,
          } : undefined,
        } : undefined,
      });

      const response = await this.ecsClient.send(command);

      if (!response.cluster) {
        return { success: false, error: 'Failed to update cluster' };
      }

      return {
        success: true,
        data: this.mapECSCluster(response.cluster),
        message: `Cluster ${clusterName} updated successfully`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // ECS Service Operations
  // ===========================================================================

  /**
   * List ECS services
   */
  async listECSServices(options: ListECSServicesOptions): Promise<ECSServiceInfo[]> {
    const { cluster, maxResults, launchType, schedulingStrategy, includeDetails = true } = options;

    const listCommand = new ListServicesCommand({
      cluster,
      maxResults,
      launchType,
      schedulingStrategy,
    });

    const listResponse = await this.ecsClient.send(listCommand);
    const serviceArns = listResponse.serviceArns ?? [];

    if (serviceArns.length === 0) {
      return [];
    }

    if (!includeDetails) {
      return serviceArns.map(arn => ({
        serviceName: arn.split('/').pop() ?? '',
        serviceArn: arn,
        clusterArn: '',
        status: 'UNKNOWN',
        desiredCount: 0,
        runningCount: 0,
        pendingCount: 0,
        taskDefinition: '',
        deployments: [],
        events: [],
        enableECSManagedTags: false,
        enableExecuteCommand: false,
        schedulingStrategy: 'REPLICA' as const,
        deploymentController: { type: 'ECS' as const },
        loadBalancers: [],
        serviceRegistries: [],
        tags: {},
      }));
    }

    const describeCommand = new DescribeServicesCommand({
      cluster,
      services: serviceArns,
      include: ['TAGS'],
    });

    const describeResponse = await this.ecsClient.send(describeCommand);
    return (describeResponse.services ?? []).map(this.mapECSService);
  }

  /**
   * Get ECS service details
   */
  async getECSService(cluster: string, serviceName: string): Promise<ContainerOperationResult<ECSServiceInfo>> {
    try {
      const command = new DescribeServicesCommand({
        cluster,
        services: [serviceName],
        include: ['TAGS'],
      });

      const response = await this.ecsClient.send(command);
      const service = response.services?.[0];

      if (!service) {
        return { success: false, error: `Service ${serviceName} not found in cluster ${cluster}` };
      }

      return { success: true, data: this.mapECSService(service) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Create ECS service
   */
  async createECSService(options: CreateECSServiceOptions): Promise<ContainerOperationResult<ECSServiceInfo>> {
    try {
      const command = new CreateServiceCommand({
        cluster: options.cluster,
        serviceName: options.serviceName,
        taskDefinition: options.taskDefinition,
        desiredCount: options.desiredCount,
        launchType: options.launchType,
        capacityProviderStrategy: options.capacityProviderStrategy?.map(s => ({
          capacityProvider: s.capacityProvider,
          weight: s.weight,
          base: s.base,
        })),
        platformVersion: options.platformVersion,
        deploymentConfiguration: options.deploymentConfiguration ? {
          deploymentCircuitBreaker: options.deploymentConfiguration.deploymentCircuitBreaker,
          maximumPercent: options.deploymentConfiguration.maximumPercent,
          minimumHealthyPercent: options.deploymentConfiguration.minimumHealthyPercent,
          alarms: options.deploymentConfiguration.alarms,
        } : undefined,
        networkConfiguration: options.networkConfiguration ? {
          awsvpcConfiguration: options.networkConfiguration.awsvpcConfiguration ? {
            subnets: options.networkConfiguration.awsvpcConfiguration.subnets,
            securityGroups: options.networkConfiguration.awsvpcConfiguration.securityGroups,
            assignPublicIp: options.networkConfiguration.awsvpcConfiguration.assignPublicIp,
          } : undefined,
        } : undefined,
        loadBalancers: options.loadBalancers?.map(lb => ({
          targetGroupArn: lb.targetGroupArn,
          loadBalancerName: lb.loadBalancerName,
          containerName: lb.containerName,
          containerPort: lb.containerPort,
        })),
        serviceRegistries: options.serviceRegistries?.map(sr => ({
          registryArn: sr.registryArn,
          port: sr.port,
          containerName: sr.containerName,
          containerPort: sr.containerPort,
        })),
        healthCheckGracePeriodSeconds: options.healthCheckGracePeriodSeconds,
        schedulingStrategy: options.schedulingStrategy,
        deploymentController: options.deploymentController,
        enableECSManagedTags: options.enableECSManagedTags,
        propagateTags: options.propagateTags,
        enableExecuteCommand: options.enableExecuteCommand,
        tags: this.recordToTags(options.tags),
      });

      const response = await this.ecsClient.send(command);

      if (!response.service) {
        return { success: false, error: 'Failed to create service' };
      }

      return {
        success: true,
        data: this.mapECSService(response.service),
        message: `Service ${options.serviceName} created successfully`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update ECS service
   */
  async updateECSService(options: UpdateECSServiceOptions): Promise<ContainerOperationResult<ECSServiceInfo>> {
    try {
      const command = new UpdateServiceCommand({
        cluster: options.cluster,
        service: options.service,
        desiredCount: options.desiredCount,
        taskDefinition: options.taskDefinition,
        capacityProviderStrategy: options.capacityProviderStrategy?.map(s => ({
          capacityProvider: s.capacityProvider,
          weight: s.weight,
          base: s.base,
        })),
        deploymentConfiguration: options.deploymentConfiguration ? {
          deploymentCircuitBreaker: options.deploymentConfiguration.deploymentCircuitBreaker,
          maximumPercent: options.deploymentConfiguration.maximumPercent,
          minimumHealthyPercent: options.deploymentConfiguration.minimumHealthyPercent,
          alarms: options.deploymentConfiguration.alarms,
        } : undefined,
        networkConfiguration: options.networkConfiguration ? {
          awsvpcConfiguration: options.networkConfiguration.awsvpcConfiguration ? {
            subnets: options.networkConfiguration.awsvpcConfiguration.subnets,
            securityGroups: options.networkConfiguration.awsvpcConfiguration.securityGroups,
            assignPublicIp: options.networkConfiguration.awsvpcConfiguration.assignPublicIp,
          } : undefined,
        } : undefined,
        platformVersion: options.platformVersion,
        forceNewDeployment: options.forceNewDeployment,
        healthCheckGracePeriodSeconds: options.healthCheckGracePeriodSeconds,
        enableExecuteCommand: options.enableExecuteCommand,
        enableECSManagedTags: options.enableECSManagedTags,
        propagateTags: options.propagateTags,
        loadBalancers: options.loadBalancers?.map(lb => ({
          targetGroupArn: lb.targetGroupArn,
          loadBalancerName: lb.loadBalancerName,
          containerName: lb.containerName,
          containerPort: lb.containerPort,
        })),
        serviceRegistries: options.serviceRegistries?.map(sr => ({
          registryArn: sr.registryArn,
          port: sr.port,
          containerName: sr.containerName,
          containerPort: sr.containerPort,
        })),
      });

      const response = await this.ecsClient.send(command);

      if (!response.service) {
        return { success: false, error: 'Failed to update service' };
      }

      return {
        success: true,
        data: this.mapECSService(response.service),
        message: `Service ${options.service} updated successfully`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Scale ECS service
   */
  async scaleECSService(options: ScaleECSServiceOptions): Promise<ContainerOperationResult<ECSServiceInfo>> {
    return this.updateECSService({
      cluster: options.cluster,
      service: options.service,
      desiredCount: options.desiredCount,
    });
  }

  /**
   * Delete ECS service
   */
  async deleteECSService(cluster: string, service: string, force = false): Promise<ContainerOperationResult<void>> {
    try {
      // First scale down to 0 if force is true
      if (force) {
        await this.updateECSService({
          cluster,
          service,
          desiredCount: 0,
        });
      }

      await this.ecsClient.send(new DeleteServiceCommand({
        cluster,
        service,
        force,
      }));

      return { success: true, message: `Service ${service} deleted successfully` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Deploy new version of service (rolling update)
   */
  async deployService(
    cluster: string,
    service: string,
    taskDefinition: string,
    forceNewDeployment = true
  ): Promise<ContainerOperationResult<ECSServiceInfo>> {
    return this.updateECSService({
      cluster,
      service,
      taskDefinition,
      forceNewDeployment,
    });
  }

  /**
   * Rollback service to previous task definition
   */
  async rollbackService(options: RollbackServiceOptions): Promise<ContainerOperationResult<RollbackResult>> {
    try {
      // Get current service
      const serviceResult = await this.getECSService(options.cluster, options.service);
      if (!serviceResult.success || !serviceResult.data) {
        return { success: false, error: serviceResult.error ?? 'Service not found' };
      }

      const currentTaskDef = serviceResult.data.taskDefinition;
      let targetTaskDef = options.taskDefinition;

      if (!targetTaskDef) {
        // Find previous task definition revision
        const family = currentTaskDef.split(':')[0].split('/').pop() ?? '';
        const currentRevision = parseInt(currentTaskDef.split(':').pop() ?? '0', 10);
        
        if (currentRevision <= 1) {
          return { success: false, error: 'No previous revision available for rollback' };
        }

        targetTaskDef = `${family}:${currentRevision - 1}`;
      }

      // Update service with previous task definition
      const updateResult = await this.updateECSService({
        cluster: options.cluster,
        service: options.service,
        taskDefinition: targetTaskDef,
        forceNewDeployment: true,
      });

      if (!updateResult.success) {
        return { success: false, error: updateResult.error };
      }

      return {
        success: true,
        data: {
          service: options.service,
          previousTaskDefinition: currentTaskDef,
          newTaskDefinition: targetTaskDef,
          rollbackInitiated: true,
        },
        message: `Rollback initiated from ${currentTaskDef} to ${targetTaskDef}`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // ECS Task Operations
  // ===========================================================================

  /**
   * List ECS tasks
   */
  async listECSTasks(options: ListECSTasksOptions): Promise<ECSTaskInfo[]> {
    const {
      cluster,
      serviceName,
      containerInstance,
      family,
      startedBy,
      desiredStatus,
      launchType,
      maxResults,
      includeDetails = true,
    } = options;

    const listCommand = new ListTasksCommand({
      cluster,
      serviceName,
      containerInstance,
      family,
      startedBy,
      desiredStatus,
      launchType,
      maxResults,
    });

    const listResponse = await this.ecsClient.send(listCommand);
    const taskArns = listResponse.taskArns ?? [];

    if (taskArns.length === 0) {
      return [];
    }

    if (!includeDetails) {
      return taskArns.map(arn => ({
        taskArn: arn,
        taskDefinitionArn: '',
        clusterArn: '',
        lastStatus: 'UNKNOWN',
        desiredStatus: 'UNKNOWN',
        version: 0,
        containers: [],
        attachments: [],
        enableExecuteCommand: false,
        tags: {},
      }));
    }

    const describeCommand = new DescribeTasksCommand({
      cluster,
      tasks: taskArns,
      include: ['TAGS'],
    });

    const describeResponse = await this.ecsClient.send(describeCommand);
    return (describeResponse.tasks ?? []).map(this.mapECSTask);
  }

  /**
   * Get ECS task details
   */
  async getECSTask(cluster: string, taskId: string): Promise<ContainerOperationResult<ECSTaskInfo>> {
    try {
      const command = new DescribeTasksCommand({
        cluster,
        tasks: [taskId],
        include: ['TAGS'],
      });

      const response = await this.ecsClient.send(command);
      const task = response.tasks?.[0];

      if (!task) {
        return { success: false, error: `Task ${taskId} not found in cluster ${cluster}` };
      }

      return { success: true, data: this.mapECSTask(task) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Run ECS task
   */
  async runECSTask(options: RunECSTaskOptions): Promise<ContainerOperationResult<ECSTaskInfo[]>> {
    try {
      const command = new RunTaskCommand({
        cluster: options.cluster,
        taskDefinition: options.taskDefinition,
        count: options.count ?? 1,
        launchType: options.launchType,
        capacityProviderStrategy: options.capacityProviderStrategy?.map(s => ({
          capacityProvider: s.capacityProvider,
          weight: s.weight,
          base: s.base,
        })),
        platformVersion: options.platformVersion,
        networkConfiguration: options.networkConfiguration ? {
          awsvpcConfiguration: options.networkConfiguration.awsvpcConfiguration ? {
            subnets: options.networkConfiguration.awsvpcConfiguration.subnets,
            securityGroups: options.networkConfiguration.awsvpcConfiguration.securityGroups,
            assignPublicIp: options.networkConfiguration.awsvpcConfiguration.assignPublicIp,
          } : undefined,
        } : undefined,
        overrides: options.overrides ? {
          containerOverrides: options.overrides.containerOverrides?.map(co => ({
            name: co.name,
            command: co.command,
            environment: co.environment?.map(e => ({ name: e.name, value: e.value })),
            environmentFiles: co.environmentFiles?.map(ef => ({ value: ef.value, type: ef.type })),
            cpu: co.cpu,
            memory: co.memory,
            memoryReservation: co.memoryReservation,
            resourceRequirements: co.resourceRequirements?.map(rr => ({ value: rr.value, type: rr.type })),
          })),
          cpu: options.overrides.cpu,
          memory: options.overrides.memory,
          taskRoleArn: options.overrides.taskRoleArn,
          executionRoleArn: options.overrides.executionRoleArn,
          inferenceAcceleratorOverrides: options.overrides.inferenceAcceleratorOverrides,
          ephemeralStorage: options.overrides.ephemeralStorage,
        } : undefined,
        group: options.group,
        startedBy: options.startedBy,
        enableECSManagedTags: options.enableECSManagedTags,
        propagateTags: options.propagateTags,
        referenceId: options.referenceId,
        enableExecuteCommand: options.enableExecuteCommand,
        tags: this.recordToTags(options.tags),
      });

      const response = await this.ecsClient.send(command);
      const tasks = response.tasks ?? [];

      if (tasks.length === 0) {
        const failures = response.failures ?? [];
        if (failures.length > 0) {
          return {
            success: false,
            error: failures.map(f => `${f.arn}: ${f.reason}`).join(', '),
          };
        }
        return { success: false, error: 'No tasks were started' };
      }

      return {
        success: true,
        data: tasks.map(this.mapECSTask),
        message: `Started ${tasks.length} task(s)`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Stop ECS task
   */
  async stopECSTask(cluster: string, taskId: string, reason?: string): Promise<ContainerOperationResult<ECSTaskInfo>> {
    try {
      const command = new StopTaskCommand({
        cluster,
        task: taskId,
        reason,
      });

      const response = await this.ecsClient.send(command);

      if (!response.task) {
        return { success: false, error: 'Failed to stop task' };
      }

      return {
        success: true,
        data: this.mapECSTask(response.task),
        message: `Task ${taskId} stopped`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // ECS Task Definition Operations
  // ===========================================================================

  /**
   * List task definitions
   */
  async listTaskDefinitions(options: ListTaskDefinitionsOptions = {}): Promise<TaskDefinitionInfo[]> {
    const { familyPrefix, status, sort, maxResults } = options;

    const command = new ListTaskDefinitionsCommand({
      familyPrefix,
      status,
      sort,
      maxResults,
    });

    const response = await this.ecsClient.send(command);
    const taskDefinitionArns = response.taskDefinitionArns ?? [];

    // Get details for each task definition
    const taskDefinitions: TaskDefinitionInfo[] = [];
    for (const arn of taskDefinitionArns) {
      const describeCommand = new DescribeTaskDefinitionCommand({
        taskDefinition: arn,
        include: ['TAGS'],
      });

      try {
        const describeResponse = await this.ecsClient.send(describeCommand);
        if (describeResponse.taskDefinition) {
          taskDefinitions.push(this.mapTaskDefinition(describeResponse.taskDefinition, describeResponse.tags));
        }
      } catch {
        // Skip if can't describe
      }
    }

    return taskDefinitions;
  }

  /**
   * Get task definition details
   */
  async getTaskDefinition(taskDefinition: string): Promise<ContainerOperationResult<TaskDefinitionInfo>> {
    try {
      const command = new DescribeTaskDefinitionCommand({
        taskDefinition,
        include: ['TAGS'],
      });

      const response = await this.ecsClient.send(command);

      if (!response.taskDefinition) {
        return { success: false, error: `Task definition ${taskDefinition} not found` };
      }

      return { success: true, data: this.mapTaskDefinition(response.taskDefinition, response.tags) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Register task definition
   */
  async registerTaskDefinition(options: RegisterTaskDefinitionOptions): Promise<ContainerOperationResult<TaskDefinitionInfo>> {
    try {
      const command = new RegisterTaskDefinitionCommand({
        family: options.family,
        containerDefinitions: options.containerDefinitions.map(cd => ({
          name: cd.name,
          image: cd.image,
          repositoryCredentials: cd.repositoryCredentials,
          cpu: cd.cpu,
          memory: cd.memory,
          memoryReservation: cd.memoryReservation,
          links: cd.links,
          portMappings: cd.portMappings?.map(pm => ({
            containerPort: pm.containerPort,
            hostPort: pm.hostPort,
            protocol: pm.protocol,
            name: pm.name,
            appProtocol: pm.appProtocol,
            containerPortRange: pm.containerPortRange,
          })),
          essential: cd.essential,
          entryPoint: cd.entryPoint,
          command: cd.command,
          environment: cd.environment?.map(e => ({ name: e.name, value: e.value })),
          environmentFiles: cd.environmentFiles?.map(ef => ({ value: ef.value, type: ef.type })),
          mountPoints: cd.mountPoints,
          volumesFrom: cd.volumesFrom,
          linuxParameters: cd.linuxParameters ? {
            ...cd.linuxParameters,
            devices: cd.linuxParameters.devices?.map(d => ({
              hostPath: d.hostPath ?? '',
              containerPath: d.containerPath,
              permissions: d.permissions as ('read' | 'write' | 'mknod')[] | undefined,
            })),
            tmpfs: cd.linuxParameters.tmpfs?.map(t => ({
              containerPath: t.containerPath ?? '',
              size: t.size ?? 0,
              mountOptions: t.mountOptions,
            })),
          } : undefined,
          secrets: cd.secrets?.map(s => ({ name: s.name, valueFrom: s.valueFrom })),
          dependsOn: cd.dependsOn?.map(d => ({ containerName: d.containerName, condition: d.condition })),
          startTimeout: cd.startTimeout,
          stopTimeout: cd.stopTimeout,
          hostname: cd.hostname,
          user: cd.user,
          workingDirectory: cd.workingDirectory,
          disableNetworking: cd.disableNetworking,
          privileged: cd.privileged,
          readonlyRootFilesystem: cd.readonlyRootFilesystem,
          dnsServers: cd.dnsServers,
          dnsSearchDomains: cd.dnsSearchDomains,
          extraHosts: cd.extraHosts,
          dockerSecurityOptions: cd.dockerSecurityOptions,
          interactive: cd.interactive,
          pseudoTerminal: cd.pseudoTerminal,
          dockerLabels: cd.dockerLabels,
          ulimits: cd.ulimits?.map(u => ({ name: u.name as 'core', softLimit: u.softLimit, hardLimit: u.hardLimit })),
          logConfiguration: cd.logConfiguration ? {
            logDriver: cd.logConfiguration.logDriver,
            options: cd.logConfiguration.options,
            secretOptions: cd.logConfiguration.secretOptions?.map(s => ({ name: s.name, valueFrom: s.valueFrom })),
          } : undefined,
          healthCheck: cd.healthCheck ? {
            command: cd.healthCheck.command ?? [],
            interval: cd.healthCheck.interval,
            timeout: cd.healthCheck.timeout,
            retries: cd.healthCheck.retries,
            startPeriod: cd.healthCheck.startPeriod,
          } : undefined,
          systemControls: cd.systemControls,
          resourceRequirements: cd.resourceRequirements?.map(rr => ({ value: rr.value, type: rr.type })),
          firelensConfiguration: cd.firelensConfiguration,
        })),
        taskRoleArn: options.taskRoleArn,
        executionRoleArn: options.executionRoleArn,
        networkMode: options.networkMode,
        volumes: options.volumes?.map(v => ({
          name: v.name,
          host: v.host,
          dockerVolumeConfiguration: v.dockerVolumeConfiguration,
          efsVolumeConfiguration: v.efsVolumeConfiguration ? {
            fileSystemId: v.efsVolumeConfiguration.fileSystemId,
            rootDirectory: v.efsVolumeConfiguration.rootDirectory,
            transitEncryption: v.efsVolumeConfiguration.transitEncryption,
            transitEncryptionPort: v.efsVolumeConfiguration.transitEncryptionPort,
            authorizationConfig: v.efsVolumeConfiguration.authorizationConfig,
          } : undefined,
          fsxWindowsFileServerVolumeConfiguration: v.fsxWindowsFileServerVolumeConfiguration,
        })),
        placementConstraints: options.placementConstraints?.map(pc => ({
          type: pc.type as 'memberOf' | undefined,
          expression: pc.expression,
        })),
        requiresCompatibilities: options.requiresCompatibilities,
        cpu: options.cpu,
        memory: options.memory,
        inferenceAccelerators: options.inferenceAccelerators,
        pidMode: options.pidMode,
        ipcMode: options.ipcMode,
        proxyConfiguration: options.proxyConfiguration ? {
          type: options.proxyConfiguration.type,
          containerName: options.proxyConfiguration.containerName,
          properties: options.proxyConfiguration.properties?.map(p => ({ name: p.name, value: p.value })),
        } : undefined,
        ephemeralStorage: options.ephemeralStorage,
        runtimePlatform: options.runtimePlatform ? {
          cpuArchitecture: options.runtimePlatform.cpuArchitecture,
          operatingSystemFamily: options.runtimePlatform.operatingSystemFamily as 'WINDOWS_SERVER_2019_FULL' | 'WINDOWS_SERVER_2019_CORE' | 'WINDOWS_SERVER_2016_FULL' | 'WINDOWS_SERVER_2004_CORE' | 'WINDOWS_SERVER_2022_CORE' | 'WINDOWS_SERVER_2022_FULL' | 'WINDOWS_SERVER_20H2_CORE' | 'LINUX' | undefined,
        } : undefined,
        tags: this.recordToTags(options.tags),
      });

      const response = await this.ecsClient.send(command);

      if (!response.taskDefinition) {
        return { success: false, error: 'Failed to register task definition' };
      }

      return {
        success: true,
        data: this.mapTaskDefinition(response.taskDefinition, response.tags),
        message: `Task definition ${options.family} registered`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Deregister task definition
   */
  async deregisterTaskDefinition(taskDefinition: string): Promise<ContainerOperationResult<void>> {
    try {
      await this.ecsClient.send(new DeregisterTaskDefinitionCommand({ taskDefinition }));
      return { success: true, message: `Task definition ${taskDefinition} deregistered` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // ECS Container Instance Operations
  // ===========================================================================

  /**
   * List container instances
   */
  async listContainerInstances(options: ListContainerInstancesOptions): Promise<ContainerInstanceInfo[]> {
    const { cluster, filter, status, maxResults, includeDetails = true } = options;

    const listCommand = new ListContainerInstancesCommand({
      cluster,
      filter,
      status,
      maxResults,
    });

    const listResponse = await this.ecsClient.send(listCommand);
    const containerInstanceArns = listResponse.containerInstanceArns ?? [];

    if (containerInstanceArns.length === 0) {
      return [];
    }

    if (!includeDetails) {
      return containerInstanceArns.map(arn => ({
        containerInstanceArn: arn,
        version: 0,
        status: 'UNKNOWN',
        agentConnected: false,
        runningTasksCount: 0,
        pendingTasksCount: 0,
        registeredResources: [],
        remainingResources: [],
        attachments: [],
        tags: {},
      }));
    }

    const describeCommand = new DescribeContainerInstancesCommand({
      cluster,
      containerInstances: containerInstanceArns,
      include: ['TAGS', 'CONTAINER_INSTANCE_HEALTH'],
    });

    const describeResponse = await this.ecsClient.send(describeCommand);
    return (describeResponse.containerInstances ?? []).map(this.mapContainerInstance);
  }

  /**
   * Drain container instance
   */
  async drainContainerInstance(cluster: string, containerInstance: string): Promise<ContainerOperationResult<ContainerInstanceInfo>> {
    try {
      const command = new UpdateContainerInstancesStateCommand({
        cluster,
        containerInstances: [containerInstance],
        status: 'DRAINING',
      });

      const response = await this.ecsClient.send(command);
      const instance = response.containerInstances?.[0];

      if (!instance) {
        return { success: false, error: 'Failed to drain container instance' };
      }

      return {
        success: true,
        data: this.mapContainerInstance(instance),
        message: `Container instance ${containerInstance} is now draining`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // EKS Cluster Operations
  // ===========================================================================

  /**
   * List EKS clusters
   */
  async listEKSClusters(options: ListEKSClustersOptions = {}): Promise<EKSClusterInfo[]> {
    const { maxResults, include, includeDetails = true } = options;

    const listCommand = new EKSListClustersCommand({
      maxResults,
      include,
    });

    const listResponse = await this.eksClient.send(listCommand);
    const clusterNames = listResponse.clusters ?? [];

    if (clusterNames.length === 0) {
      return [];
    }

    if (!includeDetails) {
      return clusterNames.map(name => ({
        name,
        arn: '',
        version: '',
        endpoint: '',
        roleArn: '',
        resourcesVpcConfig: { subnetIds: [] },
        status: 'PENDING' as const,
        tags: {},
      }));
    }

    const clusters: EKSClusterInfo[] = [];
    for (const name of clusterNames) {
      const describeCommand = new EKSDescribeClusterCommand({ name });
      try {
        const describeResponse = await this.eksClient.send(describeCommand);
        if (describeResponse.cluster) {
          clusters.push(this.mapEKSCluster(describeResponse.cluster));
        }
      } catch {
        // Skip if can't describe
      }
    }

    return clusters;
  }

  /**
   * Get EKS cluster details
   */
  async getEKSCluster(clusterName: string): Promise<ContainerOperationResult<EKSClusterInfo>> {
    try {
      const command = new EKSDescribeClusterCommand({ name: clusterName });
      const response = await this.eksClient.send(command);

      if (!response.cluster) {
        return { success: false, error: `Cluster ${clusterName} not found` };
      }

      return { success: true, data: this.mapEKSCluster(response.cluster) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Create EKS cluster
   */
  async createEKSCluster(options: CreateEKSClusterOptions): Promise<ContainerOperationResult<EKSClusterInfo>> {
    try {
      const command = new EKSCreateClusterCommand({
        name: options.name,
        roleArn: options.roleArn,
        resourcesVpcConfig: {
          subnetIds: options.resourcesVpcConfig.subnetIds,
          securityGroupIds: options.resourcesVpcConfig.securityGroupIds,
          endpointPublicAccess: options.resourcesVpcConfig.endpointPublicAccess,
          endpointPrivateAccess: options.resourcesVpcConfig.endpointPrivateAccess,
          publicAccessCidrs: options.resourcesVpcConfig.publicAccessCidrs,
        },
        version: options.version,
        kubernetesNetworkConfig: options.kubernetesNetworkConfig,
        logging: options.logging ? {
          clusterLogging: options.logging.clusterLogging?.map(cl => ({
            types: cl.types,
            enabled: cl.enabled,
          })),
        } : undefined,
        encryptionConfig: options.encryptionConfig?.map(ec => ({
          resources: ec.resources,
          provider: ec.provider,
        })),
        outpostConfig: options.outpostConfig ? {
          outpostArns: options.outpostConfig.outpostArns,
          controlPlaneInstanceType: options.outpostConfig.controlPlaneInstanceType,
          controlPlanePlacement: options.outpostConfig.controlPlanePlacement,
        } : undefined,
        accessConfig: options.accessConfig,
        tags: options.tags,
      });

      const response = await this.eksClient.send(command);

      if (!response.cluster) {
        return { success: false, error: 'Failed to create cluster' };
      }

      return {
        success: true,
        data: this.mapEKSCluster(response.cluster),
        message: `Cluster ${options.name} creation initiated`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete EKS cluster
   */
  async deleteEKSCluster(clusterName: string): Promise<ContainerOperationResult<void>> {
    try {
      await this.eksClient.send(new EKSDeleteClusterCommand({ name: clusterName }));
      return { success: true, message: `Cluster ${clusterName} deletion initiated` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update EKS cluster configuration
   */
  async updateEKSCluster(options: UpdateEKSClusterOptions): Promise<ContainerOperationResult<void>> {
    try {
      if (options.resourcesVpcConfig) {
        await this.eksClient.send(new UpdateClusterConfigCommand({
          name: options.name,
          resourcesVpcConfig: options.resourcesVpcConfig,
        }));
      }

      if (options.logging) {
        await this.eksClient.send(new UpdateClusterConfigCommand({
          name: options.name,
          logging: {
            clusterLogging: options.logging.clusterLogging?.map(cl => ({
              types: cl.types,
              enabled: cl.enabled,
            })),
          },
        }));
      }

      if (options.accessConfig) {
        await this.eksClient.send(new UpdateClusterConfigCommand({
          name: options.name,
          accessConfig: options.accessConfig,
        }));
      }

      return { success: true, message: `Cluster ${options.name} update initiated` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update EKS cluster version
   */
  async updateEKSClusterVersion(clusterName: string, version: string): Promise<ContainerOperationResult<void>> {
    try {
      await this.eksClient.send(new UpdateClusterVersionCommand({
        name: clusterName,
        version,
      }));

      return { success: true, message: `Cluster ${clusterName} version update to ${version} initiated` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // EKS Node Group Operations
  // ===========================================================================

  /**
   * List EKS node groups
   */
  async listEKSNodeGroups(options: ListEKSNodeGroupsOptions): Promise<EKSNodeGroupInfo[]> {
    const { clusterName, maxResults, includeDetails = true } = options;

    const listCommand = new ListNodegroupsCommand({
      clusterName,
      maxResults,
    });

    const listResponse = await this.eksClient.send(listCommand);
    const nodegroupNames = listResponse.nodegroups ?? [];

    if (nodegroupNames.length === 0) {
      return [];
    }

    if (!includeDetails) {
      return nodegroupNames.map(name => ({
        nodegroupName: name,
        nodegroupArn: '',
        clusterName,
        status: 'CREATING' as const,
        subnets: [],
        nodeRole: '',
        tags: {},
      }));
    }

    const nodegroups: EKSNodeGroupInfo[] = [];
    for (const name of nodegroupNames) {
      const describeCommand = new DescribeNodegroupCommand({
        clusterName,
        nodegroupName: name,
      });
      try {
        const describeResponse = await this.eksClient.send(describeCommand);
        if (describeResponse.nodegroup) {
          nodegroups.push(this.mapEKSNodeGroup(describeResponse.nodegroup));
        }
      } catch {
        // Skip if can't describe
      }
    }

    return nodegroups;
  }

  /**
   * Get EKS node group details
   */
  async getEKSNodeGroup(clusterName: string, nodegroupName: string): Promise<ContainerOperationResult<EKSNodeGroupInfo>> {
    try {
      const command = new DescribeNodegroupCommand({
        clusterName,
        nodegroupName,
      });

      const response = await this.eksClient.send(command);

      if (!response.nodegroup) {
        return { success: false, error: `Node group ${nodegroupName} not found` };
      }

      return { success: true, data: this.mapEKSNodeGroup(response.nodegroup) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Create EKS node group
   */
  async createEKSNodeGroup(options: CreateEKSNodeGroupOptions): Promise<ContainerOperationResult<EKSNodeGroupInfo>> {
    try {
      const command = new CreateNodegroupCommand({
        clusterName: options.clusterName,
        nodegroupName: options.nodegroupName,
        nodeRole: options.nodeRole,
        subnets: options.subnets,
        scalingConfig: options.scalingConfig,
        diskSize: options.diskSize,
        instanceTypes: options.instanceTypes,
        amiType: options.amiType as 'AL2_x86_64' | undefined,
        remoteAccess: options.remoteAccess,
        labels: options.labels,
        taints: options.taints?.map(t => ({
          key: t.key,
          value: t.value,
          effect: t.effect,
        })),
        capacityType: options.capacityType,
        updateConfig: options.updateConfig,
        launchTemplate: options.launchTemplate,
        version: options.version,
        releaseVersion: options.releaseVersion,
        tags: options.tags,
      });

      const response = await this.eksClient.send(command);

      if (!response.nodegroup) {
        return { success: false, error: 'Failed to create node group' };
      }

      return {
        success: true,
        data: this.mapEKSNodeGroup(response.nodegroup),
        message: `Node group ${options.nodegroupName} creation initiated`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update EKS node group
   */
  async updateEKSNodeGroup(options: UpdateEKSNodeGroupOptions): Promise<ContainerOperationResult<void>> {
    try {
      await this.eksClient.send(new UpdateNodegroupConfigCommand({
        clusterName: options.clusterName,
        nodegroupName: options.nodegroupName,
        scalingConfig: options.scalingConfig,
        updateConfig: options.updateConfig,
        labels: options.labels,
        taints: options.taints,
      }));

      return { success: true, message: `Node group ${options.nodegroupName} update initiated` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update EKS node group version
   */
  async updateEKSNodeGroupVersion(
    clusterName: string,
    nodegroupName: string,
    version?: string,
    releaseVersion?: string,
    launchTemplate?: { name?: string; version?: string; id?: string }
  ): Promise<ContainerOperationResult<void>> {
    try {
      await this.eksClient.send(new UpdateNodegroupVersionCommand({
        clusterName,
        nodegroupName,
        version,
        releaseVersion,
        launchTemplate,
      }));

      return { success: true, message: `Node group ${nodegroupName} version update initiated` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete EKS node group
   */
  async deleteEKSNodeGroup(clusterName: string, nodegroupName: string): Promise<ContainerOperationResult<void>> {
    try {
      await this.eksClient.send(new DeleteNodegroupCommand({
        clusterName,
        nodegroupName,
      }));

      return { success: true, message: `Node group ${nodegroupName} deletion initiated` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // EKS Fargate Profile Operations
  // ===========================================================================

  /**
   * List EKS Fargate profiles
   */
  async listEKSFargateProfiles(options: ListEKSFargateProfilesOptions): Promise<EKSFargateProfileInfo[]> {
    const { clusterName, maxResults, includeDetails = true } = options;

    const listCommand = new ListFargateProfilesCommand({
      clusterName,
      maxResults,
    });

    const listResponse = await this.eksClient.send(listCommand);
    const profileNames = listResponse.fargateProfileNames ?? [];

    if (profileNames.length === 0) {
      return [];
    }

    if (!includeDetails) {
      return profileNames.map(name => ({
        fargateProfileName: name,
        fargateProfileArn: '',
        clusterName,
        podExecutionRoleArn: '',
        subnets: [],
        selectors: [],
        status: 'CREATING' as const,
        tags: {},
      }));
    }

    const profiles: EKSFargateProfileInfo[] = [];
    for (const name of profileNames) {
      const describeCommand = new DescribeFargateProfileCommand({
        clusterName,
        fargateProfileName: name,
      });
      try {
        const describeResponse = await this.eksClient.send(describeCommand);
        if (describeResponse.fargateProfile) {
          profiles.push(this.mapEKSFargateProfile(describeResponse.fargateProfile));
        }
      } catch {
        // Skip if can't describe
      }
    }

    return profiles;
  }

  /**
   * Create EKS Fargate profile
   */
  async createEKSFargateProfile(options: CreateEKSFargateProfileOptions): Promise<ContainerOperationResult<EKSFargateProfileInfo>> {
    try {
      const command = new CreateFargateProfileCommand({
        clusterName: options.clusterName,
        fargateProfileName: options.fargateProfileName,
        podExecutionRoleArn: options.podExecutionRoleArn,
        subnets: options.subnets,
        selectors: options.selectors.map(s => ({
          namespace: s.namespace,
          labels: s.labels,
        })),
        tags: options.tags,
      });

      const response = await this.eksClient.send(command);

      if (!response.fargateProfile) {
        return { success: false, error: 'Failed to create Fargate profile' };
      }

      return {
        success: true,
        data: this.mapEKSFargateProfile(response.fargateProfile),
        message: `Fargate profile ${options.fargateProfileName} creation initiated`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete EKS Fargate profile
   */
  async deleteEKSFargateProfile(clusterName: string, fargateProfileName: string): Promise<ContainerOperationResult<void>> {
    try {
      await this.eksClient.send(new DeleteFargateProfileCommand({
        clusterName,
        fargateProfileName,
      }));

      return { success: true, message: `Fargate profile ${fargateProfileName} deletion initiated` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // ECR Repository Operations
  // ===========================================================================

  /**
   * List ECR repositories
   */
  async listECRRepositories(options: ListECRRepositoriesOptions = {}): Promise<ECRRepositoryInfo[]> {
    const { repositoryNames, registryId, maxResults } = options;

    const command = new DescribeRepositoriesCommand({
      repositoryNames,
      registryId,
      maxResults,
    });

    const response = await this.ecrClient.send(command);
    return (response.repositories ?? []).map(this.mapECRRepository);
  }

  /**
   * Get ECR repository details
   */
  async getECRRepository(repositoryName: string, registryId?: string): Promise<ContainerOperationResult<ECRRepositoryInfo>> {
    try {
      const command = new DescribeRepositoriesCommand({
        repositoryNames: [repositoryName],
        registryId,
      });

      const response = await this.ecrClient.send(command);
      const repository = response.repositories?.[0];

      if (!repository) {
        return { success: false, error: `Repository ${repositoryName} not found` };
      }

      return { success: true, data: this.mapECRRepository(repository) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Create ECR repository
   */
  async createECRRepository(options: CreateECRRepositoryOptions): Promise<ContainerOperationResult<ECRRepositoryInfo>> {
    try {
      const command = new CreateRepositoryCommand({
        repositoryName: options.repositoryName,
        imageTagMutability: options.imageTagMutability,
        imageScanningConfiguration: options.imageScanningConfiguration,
        encryptionConfiguration: options.encryptionConfiguration,
        tags: options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
      });

      const response = await this.ecrClient.send(command);

      if (!response.repository) {
        return { success: false, error: 'Failed to create repository' };
      }

      return {
        success: true,
        data: this.mapECRRepository(response.repository),
        message: `Repository ${options.repositoryName} created`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete ECR repository
   */
  async deleteECRRepository(repositoryName: string, force = false, registryId?: string): Promise<ContainerOperationResult<void>> {
    try {
      await this.ecrClient.send(new DeleteRepositoryCommand({
        repositoryName,
        force,
        registryId,
      }));

      return { success: true, message: `Repository ${repositoryName} deleted` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // ECR Image Operations
  // ===========================================================================

  /**
   * List ECR images
   */
  async listECRImages(options: ListECRImagesOptions): Promise<ECRImageInfo[]> {
    const { repositoryName, registryId, imageIds, filter, maxResults } = options;

    const command = new DescribeImagesCommand({
      repositoryName,
      registryId,
      imageIds: imageIds?.map(id => ({ imageDigest: id.imageDigest, imageTag: id.imageTag })),
      filter,
      maxResults,
    });

    const response = await this.ecrClient.send(command);
    return (response.imageDetails ?? []).map(this.mapECRImage);
  }

  /**
   * Delete ECR images
   */
  async deleteECRImages(
    repositoryName: string,
    imageIds: { imageDigest?: string; imageTag?: string }[],
    registryId?: string
  ): Promise<ContainerOperationResult<void>> {
    try {
      const command = new BatchDeleteImageCommand({
        repositoryName,
        imageIds: imageIds.map(id => ({ imageDigest: id.imageDigest, imageTag: id.imageTag })),
        registryId,
      });

      const response = await this.ecrClient.send(command);
      const failures = response.failures ?? [];

      if (failures.length > 0) {
        return {
          success: false,
          error: failures.map(f => `${f.imageId?.imageTag ?? f.imageId?.imageDigest}: ${f.failureReason}`).join(', '),
        };
      }

      return { success: true, message: `Deleted ${imageIds.length} image(s)` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Start image scan
   */
  async startECRImageScan(
    repositoryName: string,
    imageId: { imageDigest?: string; imageTag?: string },
    registryId?: string
  ): Promise<ContainerOperationResult<void>> {
    try {
      await this.ecrClient.send(new StartImageScanCommand({
        repositoryName,
        imageId: { imageDigest: imageId.imageDigest, imageTag: imageId.imageTag },
        registryId,
      }));

      return { success: true, message: 'Image scan started' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get image scan findings
   */
  async getECRImageScanFindings(options: GetECRImageScanFindingsOptions): Promise<ContainerOperationResult<ECRImageScanFindings>> {
    try {
      const command = new DescribeImageScanFindingsCommand({
        repositoryName: options.repositoryName,
        imageId: { imageDigest: options.imageId.imageDigest, imageTag: options.imageId.imageTag },
        registryId: options.registryId,
        maxResults: options.maxResults,
      });

      const response = await this.ecrClient.send(command);

      return {
        success: true,
        data: {
          imageScanCompletedAt: response.imageScanFindings?.imageScanCompletedAt,
          vulnerabilitySourceUpdatedAt: response.imageScanFindings?.vulnerabilitySourceUpdatedAt,
          findingSeverityCounts: response.imageScanFindings?.findingSeverityCounts,
          findings: response.imageScanFindings?.findings?.map(f => ({
            name: f.name,
            description: f.description,
            uri: f.uri,
            severity: f.severity as 'INFORMATIONAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNDEFINED',
            attributes: f.attributes?.map(a => ({ key: a.key, value: a.value })),
          })),
          enhancedFindings: response.imageScanFindings?.enhancedFindings?.map(f => ({
            awsAccountId: f.awsAccountId,
            description: f.description,
            findingArn: f.findingArn,
            firstObservedAt: f.firstObservedAt,
            lastObservedAt: f.lastObservedAt,
            packageVulnerabilityDetails: f.packageVulnerabilityDetails,
            remediation: f.remediation,
            resources: f.resources?.map(r => ({
              details: r.details,
              id: r.id,
              tags: r.tags,
              type: r.type,
            })),
            score: f.score,
            scoreDetails: f.scoreDetails,
            severity: f.severity,
            status: f.status,
            title: f.title,
            type: f.type,
            updatedAt: f.updatedAt,
          })),
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // ECR Lifecycle Policy Operations
  // ===========================================================================

  /**
   * Get ECR lifecycle policy
   */
  async getECRLifecyclePolicy(repositoryName: string, registryId?: string): Promise<ContainerOperationResult<ECRLifecyclePolicy>> {
    try {
      const command = new GetLifecyclePolicyCommand({
        repositoryName,
        registryId,
      });

      const response = await this.ecrClient.send(command);

      return {
        success: true,
        data: {
          registryId: response.registryId,
          repositoryName: response.repositoryName ?? repositoryName,
          lifecyclePolicyText: response.lifecyclePolicyText ?? '',
          lastEvaluatedAt: response.lastEvaluatedAt,
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Set ECR lifecycle policy
   */
  async setECRLifecyclePolicy(options: SetECRLifecyclePolicyOptions): Promise<ContainerOperationResult<void>> {
    try {
      await this.ecrClient.send(new PutLifecyclePolicyCommand({
        repositoryName: options.repositoryName,
        lifecyclePolicyText: options.lifecyclePolicyText,
        registryId: options.registryId,
      }));

      return { success: true, message: 'Lifecycle policy set' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete ECR lifecycle policy
   */
  async deleteECRLifecyclePolicy(repositoryName: string, registryId?: string): Promise<ContainerOperationResult<void>> {
    try {
      await this.ecrClient.send(new DeleteLifecyclePolicyCommand({
        repositoryName,
        registryId,
      }));

      return { success: true, message: 'Lifecycle policy deleted' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get ECR authorization token
   */
  async getECRAuthorizationToken(registryIds?: string[]): Promise<ContainerOperationResult<{ token: string; endpoint: string; expiresAt: Date }[]>> {
    try {
      const command = new GetAuthorizationTokenCommand({
        registryIds,
      });

      const response = await this.ecrClient.send(command);
      const authData = response.authorizationData ?? [];

      return {
        success: true,
        data: authData.map(auth => ({
          token: auth.authorizationToken ?? '',
          endpoint: auth.proxyEndpoint ?? '',
          expiresAt: auth.expiresAt ?? new Date(),
        })),
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // Container Logs Operations
  // ===========================================================================

  /**
   * Get container logs
   */
  async getContainerLogs(options: GetContainerLogsOptions): Promise<ContainerOperationResult<ContainerLogEntry[]>> {
    try {
      const { cluster, taskId, containerName, logGroupName, startTime, endTime, limit, filterPattern } = options;

      // Determine log group name if not provided
      let logGroup = logGroupName;
      if (!logGroup) {
        // Try to determine from task definition
        const taskResult = await this.getECSTask(cluster, taskId);
        if (taskResult.success && taskResult.data) {
          const taskDefResult = await this.getTaskDefinition(taskResult.data.taskDefinitionArn);
          if (taskDefResult.success && taskDefResult.data) {
            const container = taskDefResult.data.containerDefinitions.find(c => c.name === containerName);
            if (container?.logConfiguration?.options?.['awslogs-group']) {
              logGroup = container.logConfiguration.options['awslogs-group'];
            }
          }
        }
      }

      if (!logGroup) {
        return { success: false, error: 'Could not determine log group name' };
      }

      // Build log stream prefix
      const logStreamPrefix = `${containerName}/${taskId.split('/').pop()}`;

      // Find matching log streams
      const describeStreamsCommand = new DescribeLogStreamsCommand({
        logGroupName: logGroup,
        logStreamNamePrefix: logStreamPrefix,
        orderBy: 'LastEventTime',
        descending: true,
        limit: 5,
      });

      const streamsResponse = await this.logsClient.send(describeStreamsCommand);
      const streams = streamsResponse.logStreams ?? [];

      if (streams.length === 0) {
        return { success: true, data: [], message: 'No log streams found' };
      }

      const logs: ContainerLogEntry[] = [];

      if (filterPattern) {
        // Use filter if pattern provided
        const filterCommand = new FilterLogEventsCommand({
          logGroupName: logGroup,
          logStreamNames: streams.map(s => s.logStreamName!).filter(Boolean),
          startTime: startTime?.getTime(),
          endTime: endTime?.getTime(),
          filterPattern,
          limit: limit ?? 100,
        });

        const filterResponse = await this.logsClient.send(filterCommand);
        for (const event of filterResponse.events ?? []) {
          logs.push({
            timestamp: event.timestamp ? new Date(event.timestamp) : undefined,
            message: event.message ?? '',
            ingestionTime: event.ingestionTime ? new Date(event.ingestionTime) : undefined,
            logStreamName: event.logStreamName,
          });
        }
      } else {
        // Get logs from each stream
        for (const stream of streams) {
          if (!stream.logStreamName) continue;

          const getEventsCommand = new GetLogEventsCommand({
            logGroupName: logGroup,
            logStreamName: stream.logStreamName,
            startTime: startTime?.getTime(),
            endTime: endTime?.getTime(),
            limit: limit ?? 100,
            startFromHead: false,
          });

          const eventsResponse = await this.logsClient.send(getEventsCommand);
          for (const event of eventsResponse.events ?? []) {
            logs.push({
              timestamp: event.timestamp ? new Date(event.timestamp) : undefined,
              message: event.message ?? '',
              ingestionTime: event.ingestionTime ? new Date(event.ingestionTime) : undefined,
              logStreamName: stream.logStreamName,
            });
          }
        }
      }

      // Sort by timestamp
      logs.sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0));

      return { success: true, data: logs.slice(0, limit ?? 100) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // Auto Scaling Operations
  // ===========================================================================

  /**
   * Register scalable target
   */
  async registerScalableTarget(options: RegisterScalableTargetOptions): Promise<ContainerOperationResult<void>> {
    try {
      await this.autoScalingClient.send(new RegisterScalableTargetCommand({
        ServiceNamespace: options.serviceNamespace,
        ResourceId: options.resourceId,
        ScalableDimension: options.scalableDimension,
        MinCapacity: options.minCapacity,
        MaxCapacity: options.maxCapacity,
        RoleARN: options.roleArn,
        SuspendedState: options.suspendedState ? {
          DynamicScalingInSuspended: options.suspendedState.dynamicScalingInSuspended,
          DynamicScalingOutSuspended: options.suspendedState.dynamicScalingOutSuspended,
          ScheduledScalingSuspended: options.suspendedState.scheduledScalingSuspended,
        } : undefined,
      }));

      return { success: true, message: 'Scalable target registered' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Deregister scalable target
   */
  async deregisterScalableTarget(resourceId: string): Promise<ContainerOperationResult<void>> {
    try {
      await this.autoScalingClient.send(new DeregisterScalableTargetCommand({
        ServiceNamespace: 'ecs',
        ResourceId: resourceId,
        ScalableDimension: 'ecs:service:DesiredCount',
      }));

      return { success: true, message: 'Scalable target deregistered' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * List scalable targets
   */
  async listScalableTargets(resourceIds?: string[]): Promise<ScalableTargetInfo[]> {
    const command = new DescribeScalableTargetsCommand({
      ServiceNamespace: 'ecs',
      ResourceIds: resourceIds,
      ScalableDimension: 'ecs:service:DesiredCount',
    });

    const response = await this.autoScalingClient.send(command);
    return (response.ScalableTargets ?? []).map(target => ({
      resourceId: target.ResourceId ?? '',
      serviceNamespace: target.ServiceNamespace ?? '',
      scalableDimension: target.ScalableDimension ?? '',
      minCapacity: target.MinCapacity ?? 0,
      maxCapacity: target.MaxCapacity ?? 0,
      roleArn: target.RoleARN,
      creationTime: target.CreationTime,
      suspendedState: target.SuspendedState ? {
        dynamicScalingInSuspended: target.SuspendedState.DynamicScalingInSuspended,
        dynamicScalingOutSuspended: target.SuspendedState.DynamicScalingOutSuspended,
        scheduledScalingSuspended: target.SuspendedState.ScheduledScalingSuspended,
      } : undefined,
    }));
  }

  /**
   * Put scaling policy
   */
  async putScalingPolicy(options: PutScalingPolicyOptions): Promise<ContainerOperationResult<ScalingPolicyInfo>> {
    try {
      const command = new PutScalingPolicyCommand({
        PolicyName: options.policyName,
        ServiceNamespace: options.serviceNamespace,
        ResourceId: options.resourceId,
        ScalableDimension: options.scalableDimension,
        PolicyType: options.policyType,
        StepScalingPolicyConfiguration: options.stepScalingPolicyConfiguration ? {
          AdjustmentType: options.stepScalingPolicyConfiguration.adjustmentType,
          StepAdjustments: options.stepScalingPolicyConfiguration.stepAdjustments?.map(sa => ({
            MetricIntervalLowerBound: sa.metricIntervalLowerBound,
            MetricIntervalUpperBound: sa.metricIntervalUpperBound,
            ScalingAdjustment: sa.scalingAdjustment,
          })),
          MinAdjustmentMagnitude: options.stepScalingPolicyConfiguration.minAdjustmentMagnitude,
          Cooldown: options.stepScalingPolicyConfiguration.cooldown,
          MetricAggregationType: options.stepScalingPolicyConfiguration.metricAggregationType,
        } : undefined,
        TargetTrackingScalingPolicyConfiguration: options.targetTrackingScalingPolicyConfiguration ? {
          TargetValue: options.targetTrackingScalingPolicyConfiguration.targetValue,
          PredefinedMetricSpecification: options.targetTrackingScalingPolicyConfiguration.predefinedMetricSpecification ? {
            PredefinedMetricType: options.targetTrackingScalingPolicyConfiguration.predefinedMetricSpecification.predefinedMetricType as 'ECSServiceAverageCPUUtilization',
            ResourceLabel: options.targetTrackingScalingPolicyConfiguration.predefinedMetricSpecification.resourceLabel,
          } : undefined,
          ScaleOutCooldown: options.targetTrackingScalingPolicyConfiguration.scaleOutCooldown,
          ScaleInCooldown: options.targetTrackingScalingPolicyConfiguration.scaleInCooldown,
          DisableScaleIn: options.targetTrackingScalingPolicyConfiguration.disableScaleIn,
        } : undefined,
      });

      const response = await this.autoScalingClient.send(command);

      return {
        success: true,
        data: {
          policyArn: response.PolicyARN ?? '',
          policyName: options.policyName,
          serviceNamespace: options.serviceNamespace,
          resourceId: options.resourceId,
          scalableDimension: options.scalableDimension,
          policyType: options.policyType,
          alarms: response.Alarms?.map(a => ({
            alarmName: a.AlarmName ?? '',
            alarmArn: a.AlarmARN ?? '',
          })),
        },
        message: `Scaling policy ${options.policyName} created`,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete scaling policy
   */
  async deleteScalingPolicy(policyName: string, resourceId: string): Promise<ContainerOperationResult<void>> {
    try {
      await this.autoScalingClient.send(new DeleteScalingPolicyCommand({
        PolicyName: policyName,
        ServiceNamespace: 'ecs',
        ResourceId: resourceId,
        ScalableDimension: 'ecs:service:DesiredCount',
      }));

      return { success: true, message: `Scaling policy ${policyName} deleted` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * List scaling policies
   */
  async listScalingPolicies(resourceId?: string, policyNames?: string[]): Promise<ScalingPolicyInfo[]> {
    const command = new DescribeScalingPoliciesCommand({
      ServiceNamespace: 'ecs',
      ResourceId: resourceId,
      ScalableDimension: 'ecs:service:DesiredCount',
      PolicyNames: policyNames,
    });

    const response = await this.autoScalingClient.send(command);
    return (response.ScalingPolicies ?? []).map(policy => ({
      policyArn: policy.PolicyARN ?? '',
      policyName: policy.PolicyName ?? '',
      serviceNamespace: policy.ServiceNamespace ?? '',
      resourceId: policy.ResourceId ?? '',
      scalableDimension: policy.ScalableDimension ?? '',
      policyType: policy.PolicyType as 'StepScaling' | 'TargetTrackingScaling',
      stepScalingPolicyConfiguration: policy.StepScalingPolicyConfiguration ? {
        adjustmentType: policy.StepScalingPolicyConfiguration.AdjustmentType as 'ChangeInCapacity',
        stepAdjustments: policy.StepScalingPolicyConfiguration.StepAdjustments?.map(sa => ({
          metricIntervalLowerBound: sa.MetricIntervalLowerBound,
          metricIntervalUpperBound: sa.MetricIntervalUpperBound,
          scalingAdjustment: sa.ScalingAdjustment ?? 0,
        })),
        minAdjustmentMagnitude: policy.StepScalingPolicyConfiguration.MinAdjustmentMagnitude,
        cooldown: policy.StepScalingPolicyConfiguration.Cooldown,
        metricAggregationType: policy.StepScalingPolicyConfiguration.MetricAggregationType as 'Average',
      } : undefined,
      targetTrackingScalingPolicyConfiguration: policy.TargetTrackingScalingPolicyConfiguration ? {
        targetValue: policy.TargetTrackingScalingPolicyConfiguration.TargetValue ?? 0,
        predefinedMetricSpecification: policy.TargetTrackingScalingPolicyConfiguration.PredefinedMetricSpecification ? {
          predefinedMetricType: policy.TargetTrackingScalingPolicyConfiguration.PredefinedMetricSpecification.PredefinedMetricType ?? '',
          resourceLabel: policy.TargetTrackingScalingPolicyConfiguration.PredefinedMetricSpecification.ResourceLabel,
        } : undefined,
        scaleOutCooldown: policy.TargetTrackingScalingPolicyConfiguration.ScaleOutCooldown,
        scaleInCooldown: policy.TargetTrackingScalingPolicyConfiguration.ScaleInCooldown,
        disableScaleIn: policy.TargetTrackingScalingPolicyConfiguration.DisableScaleIn,
      } : undefined,
      alarms: policy.Alarms?.map(a => ({
        alarmName: a.AlarmName ?? '',
        alarmArn: a.AlarmARN ?? '',
      })),
      creationTime: policy.CreationTime,
    }));
  }

  // ===========================================================================
  // Container Insights Metrics
  // ===========================================================================

  /**
   * Get Container Insights metrics
   */
  async getContainerInsights(options: GetContainerInsightsOptions): Promise<ContainerOperationResult<ContainerInsightsMetrics[]>> {
    try {
      const { cluster, serviceName, taskId, startTime, endTime, period, statistics } = options;

      const now = new Date();
      const start = startTime ?? new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
      const end = endTime ?? now;

      const dimensions: { Name: string; Value: string }[] = [
        { Name: 'ClusterName', Value: cluster },
      ];

      if (serviceName) {
        dimensions.push({ Name: 'ServiceName', Value: serviceName });
      }

      if (taskId) {
        dimensions.push({ Name: 'TaskId', Value: taskId });
      }

      const metrics = [
        { name: 'CpuUtilized', stat: 'Average' },
        { name: 'MemoryUtilized', stat: 'Average' },
        { name: 'NetworkRxBytes', stat: 'Sum' },
        { name: 'NetworkTxBytes', stat: 'Sum' },
        { name: 'StorageReadBytes', stat: 'Sum' },
        { name: 'StorageWriteBytes', stat: 'Sum' },
        { name: 'RunningTaskCount', stat: 'Average' },
        { name: 'PendingTaskCount', stat: 'Average' },
        { name: 'DesiredTaskCount', stat: 'Average' },
      ];

      const queries: MetricDataQuery[] = metrics.map((metric, index) => ({
        Id: `m${index}`,
        MetricStat: {
          Metric: {
            Namespace: 'ECS/ContainerInsights',
            MetricName: metric.name,
            Dimensions: dimensions,
          },
          Period: period ?? 300,
          Stat: statistics?.[0] ?? metric.stat,
        },
      }));

      const command = new GetMetricDataCommand({
        MetricDataQueries: queries,
        StartTime: start,
        EndTime: end,
      });

      const response = await this.cloudWatchClient.send(command);
      const results = response.MetricDataResults ?? [];

      // Group results by timestamp
      const metricsMap = new Map<number, ContainerInsightsMetrics>();

      for (const result of results) {
        const metricName = metrics[parseInt(result.Id?.substring(1) ?? '0', 10)]?.name;
        const timestamps = result.Timestamps ?? [];
        const values = result.Values ?? [];

        for (let i = 0; i < timestamps.length; i++) {
          const ts = timestamps[i].getTime();
          if (!metricsMap.has(ts)) {
            metricsMap.set(ts, {
              clusterName: cluster,
              serviceName,
              taskId,
              metrics: {},
              timestamp: timestamps[i],
            });
          }

          const entry = metricsMap.get(ts)!;
          switch (metricName) {
            case 'CpuUtilized':
              entry.metrics.cpuUtilization = values[i];
              break;
            case 'MemoryUtilized':
              entry.metrics.memoryUtilization = values[i];
              break;
            case 'NetworkRxBytes':
              entry.metrics.networkRxBytes = values[i];
              break;
            case 'NetworkTxBytes':
              entry.metrics.networkTxBytes = values[i];
              break;
            case 'StorageReadBytes':
              entry.metrics.storageReadBytes = values[i];
              break;
            case 'StorageWriteBytes':
              entry.metrics.storageWriteBytes = values[i];
              break;
            case 'RunningTaskCount':
              entry.metrics.runningTaskCount = values[i];
              break;
            case 'PendingTaskCount':
              entry.metrics.pendingTaskCount = values[i];
              break;
            case 'DesiredTaskCount':
              entry.metrics.desiredTaskCount = values[i];
              break;
          }
        }
      }

      return {
        success: true,
        data: Array.from(metricsMap.values()).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // Tagging Operations
  // ===========================================================================

  /**
   * Tag ECS resource
   */
  async tagECSResource(resourceArn: string, tags: Record<string, string>): Promise<ContainerOperationResult<void>> {
    try {
      await this.ecsClient.send(new TagResourceCommand({
        resourceArn,
        tags: this.recordToTags(tags),
      }));

      return { success: true, message: 'Tags added' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Untag ECS resource
   */
  async untagECSResource(resourceArn: string, tagKeys: string[]): Promise<ContainerOperationResult<void>> {
    try {
      await this.ecsClient.send(new UntagResourceCommand({
        resourceArn,
        tagKeys,
      }));

      return { success: true, message: 'Tags removed' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Tag EKS resource
   */
  async tagEKSResource(resourceArn: string, tags: Record<string, string>): Promise<ContainerOperationResult<void>> {
    try {
      await this.eksClient.send(new EKSTagResourceCommand({
        resourceArn,
        tags,
      }));

      return { success: true, message: 'Tags added' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Untag EKS resource
   */
  async untagEKSResource(resourceArn: string, tagKeys: string[]): Promise<ContainerOperationResult<void>> {
    try {
      await this.eksClient.send(new EKSUntagResourceCommand({
        resourceArn,
        tagKeys,
      }));

      return { success: true, message: 'Tags removed' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private recordToTags(record?: Record<string, string>): Tag[] | undefined {
    if (!record) return undefined;
    return Object.entries(record).map(([key, value]) => ({ key, value }));
  }

  private tagsToRecord(tags?: Tag[]): Record<string, string> {
    if (!tags) return {};
    return tags.reduce((acc, tag) => {
      if (tag.key) acc[tag.key] = tag.value ?? '';
      return acc;
    }, {} as Record<string, string>);
  }

  private mapECSCluster = (cluster: Cluster): ECSClusterInfo => ({
    clusterName: cluster.clusterName ?? '',
    clusterArn: cluster.clusterArn ?? '',
    status: cluster.status ?? '',
    registeredContainerInstancesCount: cluster.registeredContainerInstancesCount ?? 0,
    runningTasksCount: cluster.runningTasksCount ?? 0,
    pendingTasksCount: cluster.pendingTasksCount ?? 0,
    activeServicesCount: cluster.activeServicesCount ?? 0,
    capacityProviders: cluster.capacityProviders ?? [],
    defaultCapacityProviderStrategy: (cluster.defaultCapacityProviderStrategy ?? []).map(s => ({
      capacityProvider: s.capacityProvider ?? '',
      weight: s.weight ?? 0,
      base: s.base ?? 0,
    })),
    settings: (cluster.settings ?? []).map(s => ({
      name: s.name ?? '',
      value: s.value ?? '',
    })),
    tags: this.tagsToRecord(cluster.tags),
    configuration: cluster.configuration ? {
      executeCommandConfiguration: cluster.configuration.executeCommandConfiguration ? {
        kmsKeyId: cluster.configuration.executeCommandConfiguration.kmsKeyId,
        logging: cluster.configuration.executeCommandConfiguration.logging as 'NONE' | 'DEFAULT' | 'OVERRIDE',
        logConfiguration: cluster.configuration.executeCommandConfiguration.logConfiguration,
      } : undefined,
    } : undefined,
    statistics: (cluster.statistics ?? []).map(s => ({
      name: s.name ?? '',
      value: s.value ?? '',
    })),
  });

  private mapECSService = (service: Service): ECSServiceInfo => ({
    serviceName: service.serviceName ?? '',
    serviceArn: service.serviceArn ?? '',
    clusterArn: service.clusterArn ?? '',
    status: service.status ?? '',
    desiredCount: service.desiredCount ?? 0,
    runningCount: service.runningCount ?? 0,
    pendingCount: service.pendingCount ?? 0,
    launchType: service.launchType as 'EC2' | 'FARGATE' | 'EXTERNAL' | undefined,
    capacityProviderStrategy: service.capacityProviderStrategy?.map(s => ({
      capacityProvider: s.capacityProvider ?? '',
      weight: s.weight ?? 0,
      base: s.base ?? 0,
    })),
    platformVersion: service.platformVersion,
    platformFamily: service.platformFamily,
    taskDefinition: service.taskDefinition ?? '',
    deploymentConfiguration: service.deploymentConfiguration ? {
      deploymentCircuitBreaker: service.deploymentConfiguration.deploymentCircuitBreaker ? {
        enable: service.deploymentConfiguration.deploymentCircuitBreaker.enable ?? false,
        rollback: service.deploymentConfiguration.deploymentCircuitBreaker.rollback ?? false,
      } : undefined,
      maximumPercent: service.deploymentConfiguration.maximumPercent,
      minimumHealthyPercent: service.deploymentConfiguration.minimumHealthyPercent,
      alarms: service.deploymentConfiguration.alarms ? {
        alarmNames: service.deploymentConfiguration.alarms.alarmNames ?? [],
        enable: service.deploymentConfiguration.alarms.enable ?? false,
        rollback: service.deploymentConfiguration.alarms.rollback ?? false,
      } : undefined,
    } : undefined,
    deployments: (service.deployments ?? []).map(d => ({
      id: d.id ?? '',
      status: d.status ?? '',
      taskDefinition: d.taskDefinition ?? '',
      desiredCount: d.desiredCount ?? 0,
      pendingCount: d.pendingCount ?? 0,
      runningCount: d.runningCount ?? 0,
      failedTasks: d.failedTasks ?? 0,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      capacityProviderStrategy: d.capacityProviderStrategy?.map(s => ({
        capacityProvider: s.capacityProvider ?? '',
        weight: s.weight ?? 0,
        base: s.base ?? 0,
      })),
      launchType: d.launchType as 'EC2' | 'FARGATE' | 'EXTERNAL' | undefined,
      platformVersion: d.platformVersion,
      platformFamily: d.platformFamily,
      networkConfiguration: d.networkConfiguration?.awsvpcConfiguration ? {
        awsvpcConfiguration: {
          subnets: d.networkConfiguration.awsvpcConfiguration.subnets ?? [],
          securityGroups: d.networkConfiguration.awsvpcConfiguration.securityGroups,
          assignPublicIp: d.networkConfiguration.awsvpcConfiguration.assignPublicIp as 'ENABLED' | 'DISABLED' | undefined,
        },
      } : undefined,
      rolloutState: d.rolloutState as 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' | undefined,
      rolloutStateReason: d.rolloutStateReason,
    })),
    roleArn: service.roleArn,
    events: (service.events ?? []).slice(0, 10).map(e => ({
      id: e.id,
      createdAt: e.createdAt,
      message: e.message,
    })),
    createdAt: service.createdAt,
    createdBy: service.createdBy,
    enableECSManagedTags: service.enableECSManagedTags ?? false,
    propagateTags: service.propagateTags as 'TASK_DEFINITION' | 'SERVICE' | 'NONE' | undefined,
    enableExecuteCommand: service.enableExecuteCommand ?? false,
    healthCheckGracePeriodSeconds: service.healthCheckGracePeriodSeconds,
    schedulingStrategy: (service.schedulingStrategy ?? 'REPLICA') as 'REPLICA' | 'DAEMON',
    deploymentController: {
      type: (service.deploymentController?.type ?? 'ECS') as 'ECS' | 'CODE_DEPLOY' | 'EXTERNAL',
    },
    networkConfiguration: service.networkConfiguration?.awsvpcConfiguration ? {
      awsvpcConfiguration: {
        subnets: service.networkConfiguration.awsvpcConfiguration.subnets ?? [],
        securityGroups: service.networkConfiguration.awsvpcConfiguration.securityGroups,
        assignPublicIp: service.networkConfiguration.awsvpcConfiguration.assignPublicIp as 'ENABLED' | 'DISABLED' | undefined,
      },
    } : undefined,
    loadBalancers: (service.loadBalancers ?? []).map(lb => ({
      targetGroupArn: lb.targetGroupArn,
      loadBalancerName: lb.loadBalancerName,
      containerName: lb.containerName ?? '',
      containerPort: lb.containerPort ?? 0,
    })),
    serviceRegistries: (service.serviceRegistries ?? []).map(sr => ({
      registryArn: sr.registryArn,
      port: sr.port,
      containerName: sr.containerName,
      containerPort: sr.containerPort,
    })),
    tags: this.tagsToRecord(service.tags),
  });

  private mapECSTask = (task: Task): ECSTaskInfo => ({
    taskArn: task.taskArn ?? '',
    taskDefinitionArn: task.taskDefinitionArn ?? '',
    clusterArn: task.clusterArn ?? '',
    containerInstanceArn: task.containerInstanceArn,
    lastStatus: task.lastStatus ?? '',
    desiredStatus: task.desiredStatus ?? '',
    cpu: task.cpu,
    memory: task.memory,
    launchType: task.launchType as 'EC2' | 'FARGATE' | 'EXTERNAL' | undefined,
    capacityProviderName: task.capacityProviderName,
    platformVersion: task.platformVersion,
    platformFamily: task.platformFamily,
    connectivity: task.connectivity as 'CONNECTED' | 'DISCONNECTED' | undefined,
    connectivityAt: task.connectivityAt,
    pullStartedAt: task.pullStartedAt,
    pullStoppedAt: task.pullStoppedAt,
    executionStoppedAt: task.executionStoppedAt,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    startedBy: task.startedBy,
    stoppingAt: task.stoppingAt,
    stoppedAt: task.stoppedAt,
    stoppedReason: task.stoppedReason,
    stopCode: task.stopCode,
    group: task.group,
    version: task.version ?? 0,
    containers: (task.containers ?? []).map(c => ({
      containerArn: c.containerArn,
      taskArn: c.taskArn,
      name: c.name ?? '',
      image: c.image,
      imageDigest: c.imageDigest,
      runtimeId: c.runtimeId,
      lastStatus: c.lastStatus,
      exitCode: c.exitCode,
      reason: c.reason,
      healthStatus: c.healthStatus as 'HEALTHY' | 'UNHEALTHY' | 'UNKNOWN' | undefined,
      cpu: c.cpu,
      memory: c.memory,
      memoryReservation: c.memoryReservation,
      gpuIds: c.gpuIds,
      networkBindings: c.networkBindings?.map(nb => ({
        bindIP: nb.bindIP,
        containerPort: nb.containerPort,
        hostPort: nb.hostPort,
        protocol: nb.protocol as 'tcp' | 'udp' | undefined,
        containerPortRange: nb.containerPortRange,
        hostPortRange: nb.hostPortRange,
      })),
      networkInterfaces: c.networkInterfaces?.map(ni => ({
        attachmentId: ni.attachmentId,
        privateIpv4Address: ni.privateIpv4Address,
        ipv6Address: ni.ipv6Address,
      })),
      managedAgents: c.managedAgents?.map(ma => ({
        lastStartedAt: ma.lastStartedAt,
        name: ma.name,
        reason: ma.reason,
        lastStatus: ma.lastStatus,
      })),
    })),
    attachments: (task.attachments ?? []).map(a => ({
      id: a.id,
      type: a.type,
      status: a.status,
      details: a.details?.map(d => ({ name: d.name, value: d.value })),
    })),
    healthStatus: task.healthStatus as 'HEALTHY' | 'UNHEALTHY' | 'UNKNOWN' | undefined,
    availabilityZone: task.availabilityZone,
    enableExecuteCommand: task.enableExecuteCommand ?? false,
    tags: this.tagsToRecord(task.tags),
    ephemeralStorage: task.ephemeralStorage?.sizeInGiB !== undefined
      ? { sizeInGiB: task.ephemeralStorage.sizeInGiB }
      : undefined,
  });

  private mapTaskDefinition = (td: TaskDefinition, tags?: Tag[]): TaskDefinitionInfo => ({
    taskDefinitionArn: td.taskDefinitionArn ?? '',
    family: td.family ?? '',
    revision: td.revision ?? 0,
    status: (td.status ?? 'ACTIVE') as 'ACTIVE' | 'INACTIVE' | 'DELETE_IN_PROGRESS',
    containerDefinitions: (td.containerDefinitions ?? []).map(cd => ({
      name: cd.name ?? '',
      image: cd.image ?? '',
      repositoryCredentials: cd.repositoryCredentials?.credentialsParameter
        ? { credentialsParameter: cd.repositoryCredentials.credentialsParameter }
        : undefined,
      cpu: cd.cpu,
      memory: cd.memory,
      memoryReservation: cd.memoryReservation,
      links: cd.links,
      portMappings: cd.portMappings?.map(pm => ({
        containerPort: pm.containerPort ?? 0,
        hostPort: pm.hostPort,
        protocol: pm.protocol as 'tcp' | 'udp' | undefined,
        name: pm.name,
        appProtocol: pm.appProtocol as 'http' | 'http2' | 'grpc' | undefined,
        containerPortRange: pm.containerPortRange,
      })),
      essential: cd.essential,
      entryPoint: cd.entryPoint,
      command: cd.command,
      environment: cd.environment?.map(e => ({ name: e.name ?? '', value: e.value ?? '' })),
      environmentFiles: cd.environmentFiles?.map(ef => ({ value: ef.value ?? '', type: ef.type as 's3' })),
      mountPoints: cd.mountPoints?.map(mp => ({
        sourceVolume: mp.sourceVolume ?? '',
        containerPath: mp.containerPath ?? '',
        readOnly: mp.readOnly,
      })),
      volumesFrom: cd.volumesFrom?.map(vf => ({
        sourceContainer: vf.sourceContainer ?? '',
        readOnly: vf.readOnly,
      })),
      linuxParameters: cd.linuxParameters ? {
        ...cd.linuxParameters,
        devices: cd.linuxParameters.devices?.map(d => ({
          hostPath: d.hostPath ?? '',
          containerPath: d.containerPath,
          permissions: d.permissions as ('read' | 'write' | 'mknod')[] | undefined,
        })),
        tmpfs: cd.linuxParameters.tmpfs?.map(t => ({
          containerPath: t.containerPath ?? '',
          size: t.size ?? 0,
          mountOptions: t.mountOptions,
        })),
      } : undefined,
      secrets: cd.secrets?.map(s => ({ name: s.name ?? '', valueFrom: s.valueFrom ?? '' })),
      dependsOn: cd.dependsOn?.map(d => ({
        containerName: d.containerName ?? '',
        condition: d.condition as 'START' | 'COMPLETE' | 'SUCCESS' | 'HEALTHY',
      })),
      startTimeout: cd.startTimeout,
      stopTimeout: cd.stopTimeout,
      hostname: cd.hostname,
      user: cd.user,
      workingDirectory: cd.workingDirectory,
      disableNetworking: cd.disableNetworking,
      privileged: cd.privileged,
      readonlyRootFilesystem: cd.readonlyRootFilesystem,
      dnsServers: cd.dnsServers,
      dnsSearchDomains: cd.dnsSearchDomains,
      extraHosts: cd.extraHosts?.map(eh => ({ hostname: eh.hostname ?? '', ipAddress: eh.ipAddress ?? '' })),
      dockerSecurityOptions: cd.dockerSecurityOptions,
      interactive: cd.interactive,
      pseudoTerminal: cd.pseudoTerminal,
      dockerLabels: cd.dockerLabels,
      ulimits: cd.ulimits?.map(u => ({
        name: u.name ?? '',
        softLimit: u.softLimit ?? 0,
        hardLimit: u.hardLimit ?? 0,
      })),
      logConfiguration: cd.logConfiguration ? {
        logDriver: cd.logConfiguration.logDriver as 'awslogs',
        options: cd.logConfiguration.options,
        secretOptions: cd.logConfiguration.secretOptions?.map(s => ({ name: s.name ?? '', valueFrom: s.valueFrom ?? '' })),
      } : undefined,
      healthCheck: cd.healthCheck ? {
        command: cd.healthCheck.command ?? [],
        interval: cd.healthCheck.interval,
        timeout: cd.healthCheck.timeout,
        retries: cd.healthCheck.retries,
        startPeriod: cd.healthCheck.startPeriod,
      } : undefined,
      systemControls: cd.systemControls?.map(sc => ({ namespace: sc.namespace ?? '', value: sc.value ?? '' })),
      resourceRequirements: cd.resourceRequirements?.map(rr => ({
        value: rr.value ?? '',
        type: rr.type as 'GPU' | 'InferenceAccelerator',
      })),
      firelensConfiguration: cd.firelensConfiguration ? {
        type: cd.firelensConfiguration.type as 'fluentd' | 'fluentbit',
        options: cd.firelensConfiguration.options,
      } : undefined,
    })),
    taskRoleArn: td.taskRoleArn,
    executionRoleArn: td.executionRoleArn,
    networkMode: td.networkMode as 'bridge' | 'host' | 'awsvpc' | 'none' | undefined,
    volumes: td.volumes?.map(v => ({
      name: v.name ?? '',
      host: v.host,
      dockerVolumeConfiguration: v.dockerVolumeConfiguration,
      efsVolumeConfiguration: v.efsVolumeConfiguration ? {
        fileSystemId: v.efsVolumeConfiguration.fileSystemId ?? '',
        rootDirectory: v.efsVolumeConfiguration.rootDirectory,
        transitEncryption: v.efsVolumeConfiguration.transitEncryption as 'ENABLED' | 'DISABLED' | undefined,
        transitEncryptionPort: v.efsVolumeConfiguration.transitEncryptionPort,
        authorizationConfig: v.efsVolumeConfiguration.authorizationConfig,
      } : undefined,
      fsxWindowsFileServerVolumeConfiguration: v.fsxWindowsFileServerVolumeConfiguration ? {
        fileSystemId: v.fsxWindowsFileServerVolumeConfiguration.fileSystemId ?? '',
        rootDirectory: v.fsxWindowsFileServerVolumeConfiguration.rootDirectory ?? '',
        authorizationConfig: {
          credentialsParameter: v.fsxWindowsFileServerVolumeConfiguration.authorizationConfig?.credentialsParameter ?? '',
          domain: v.fsxWindowsFileServerVolumeConfiguration.authorizationConfig?.domain ?? '',
        },
      } : undefined,
    })),
    placementConstraints: td.placementConstraints?.map(pc => ({
      type: pc.type as 'distinctInstance' | 'memberOf',
      expression: pc.expression,
    })),
    requiresCompatibilities: td.requiresCompatibilities as ('EC2' | 'FARGATE' | 'EXTERNAL')[] | undefined,
    cpu: td.cpu,
    memory: td.memory,
    inferenceAccelerators: td.inferenceAccelerators?.map(ia => ({
      deviceName: ia.deviceName ?? '',
      deviceType: ia.deviceType ?? '',
    })),
    pidMode: td.pidMode as 'host' | 'task' | undefined,
    ipcMode: td.ipcMode as 'host' | 'task' | 'none' | undefined,
    proxyConfiguration: td.proxyConfiguration ? {
      type: td.proxyConfiguration.type as 'APPMESH' | undefined,
      containerName: td.proxyConfiguration.containerName ?? '',
      properties: td.proxyConfiguration.properties?.map(p => ({ name: p.name ?? '', value: p.value ?? '' })),
    } : undefined,
    registeredAt: td.registeredAt,
    deregisteredAt: td.deregisteredAt,
    registeredBy: td.registeredBy,
    ephemeralStorage: td.ephemeralStorage?.sizeInGiB !== undefined
      ? { sizeInGiB: td.ephemeralStorage.sizeInGiB }
      : undefined,
    runtimePlatform: td.runtimePlatform ? {
      cpuArchitecture: td.runtimePlatform.cpuArchitecture as 'X86_64' | 'ARM64' | undefined,
      operatingSystemFamily: td.runtimePlatform.operatingSystemFamily,
    } : undefined,
    tags: this.tagsToRecord(tags),
  });

  private mapContainerInstance = (instance: ContainerInstance): ContainerInstanceInfo => ({
    containerInstanceArn: instance.containerInstanceArn ?? '',
    ec2InstanceId: instance.ec2InstanceId,
    capacityProviderName: instance.capacityProviderName,
    version: instance.version ?? 0,
    status: instance.status ?? '',
    statusReason: instance.statusReason,
    agentConnected: instance.agentConnected ?? false,
    runningTasksCount: instance.runningTasksCount ?? 0,
    pendingTasksCount: instance.pendingTasksCount ?? 0,
    agentUpdateStatus: instance.agentUpdateStatus,
    registeredResources: (instance.registeredResources ?? []).map(r => ({
      name: r.name,
      type: r.type,
      doubleValue: r.doubleValue,
      longValue: r.longValue,
      integerValue: r.integerValue,
      stringSetValue: r.stringSetValue,
    })),
    remainingResources: (instance.remainingResources ?? []).map(r => ({
      name: r.name,
      type: r.type,
      doubleValue: r.doubleValue,
      longValue: r.longValue,
      integerValue: r.integerValue,
      stringSetValue: r.stringSetValue,
    })),
    registeredAt: instance.registeredAt,
    attachments: (instance.attachments ?? []).map(a => ({
      id: a.id,
      type: a.type,
      status: a.status,
      details: a.details?.map(d => ({ name: d.name, value: d.value })),
    })),
    tags: this.tagsToRecord(instance.tags),
    healthStatus: instance.healthStatus ? {
      overallStatus: instance.healthStatus.overallStatus,
      details: instance.healthStatus.details?.map(d => ({
        type: d.type,
        status: d.status,
        lastUpdated: d.lastUpdated,
        lastStatusChange: d.lastStatusChange,
      })),
    } : undefined,
  });

  private mapEKSCluster = (cluster: EKSCluster): EKSClusterInfo => ({
    name: cluster.name ?? '',
    arn: cluster.arn ?? '',
    createdAt: cluster.createdAt,
    version: cluster.version ?? '',
    endpoint: cluster.endpoint,
    roleArn: cluster.roleArn ?? '',
    resourcesVpcConfig: {
      subnetIds: cluster.resourcesVpcConfig?.subnetIds ?? [],
      securityGroupIds: cluster.resourcesVpcConfig?.securityGroupIds,
      clusterSecurityGroupId: cluster.resourcesVpcConfig?.clusterSecurityGroupId,
      vpcId: cluster.resourcesVpcConfig?.vpcId,
      endpointPublicAccess: cluster.resourcesVpcConfig?.endpointPublicAccess,
      endpointPrivateAccess: cluster.resourcesVpcConfig?.endpointPrivateAccess,
      publicAccessCidrs: cluster.resourcesVpcConfig?.publicAccessCidrs,
    },
    kubernetesNetworkConfig: cluster.kubernetesNetworkConfig ? {
      serviceIpv4Cidr: cluster.kubernetesNetworkConfig.serviceIpv4Cidr,
      serviceIpv6Cidr: cluster.kubernetesNetworkConfig.serviceIpv6Cidr,
      ipFamily: cluster.kubernetesNetworkConfig.ipFamily as 'ipv4' | 'ipv6' | undefined,
    } : undefined,
    logging: cluster.logging ? {
      clusterLogging: cluster.logging.clusterLogging?.map(cl => ({
        types: cl.types as ('api' | 'audit' | 'authenticator' | 'controllerManager' | 'scheduler')[],
        enabled: cl.enabled,
      })),
    } : undefined,
    identity: cluster.identity ? {
      oidc: cluster.identity.oidc ? {
        issuer: cluster.identity.oidc.issuer,
      } : undefined,
    } : undefined,
    status: (cluster.status ?? 'PENDING') as 'CREATING' | 'ACTIVE' | 'DELETING' | 'FAILED' | 'UPDATING' | 'PENDING',
    certificateAuthority: cluster.certificateAuthority ? {
      data: cluster.certificateAuthority.data,
    } : undefined,
    clientRequestToken: cluster.clientRequestToken,
    platformVersion: cluster.platformVersion,
    tags: cluster.tags ?? {},
    encryptionConfig: cluster.encryptionConfig?.map(ec => ({
      resources: ec.resources,
      provider: ec.provider,
    })),
    connectorConfig: cluster.connectorConfig ? {
      activationId: cluster.connectorConfig.activationId,
      activationCode: cluster.connectorConfig.activationCode,
      activationExpiry: cluster.connectorConfig.activationExpiry,
      provider: cluster.connectorConfig.provider,
      roleArn: cluster.connectorConfig.roleArn,
    } : undefined,
    health: cluster.health ? {
      issues: cluster.health.issues?.map(i => ({
        code: i.code,
        message: i.message,
        resourceIds: i.resourceIds,
      })),
    } : undefined,
    outpostConfig: cluster.outpostConfig ? {
      outpostArns: cluster.outpostConfig.outpostArns ?? [],
      controlPlaneInstanceType: cluster.outpostConfig.controlPlaneInstanceType,
      controlPlanePlacement: cluster.outpostConfig.controlPlanePlacement,
    } : undefined,
    accessConfig: cluster.accessConfig,
  });

  private mapEKSNodeGroup = (ng: Nodegroup): EKSNodeGroupInfo => ({
    nodegroupName: ng.nodegroupName ?? '',
    nodegroupArn: ng.nodegroupArn ?? '',
    clusterName: ng.clusterName ?? '',
    version: ng.version,
    releaseVersion: ng.releaseVersion,
    createdAt: ng.createdAt,
    modifiedAt: ng.modifiedAt,
    status: (ng.status ?? 'CREATING') as 'CREATING' | 'ACTIVE' | 'UPDATING' | 'DELETING' | 'CREATE_FAILED' | 'DELETE_FAILED' | 'DEGRADED',
    capacityType: ng.capacityType as 'ON_DEMAND' | 'SPOT' | undefined,
    scalingConfig: ng.scalingConfig,
    instanceTypes: ng.instanceTypes,
    subnets: ng.subnets ?? [],
    remoteAccess: ng.remoteAccess,
    amiType: ng.amiType,
    nodeRole: ng.nodeRole ?? '',
    labels: ng.labels,
    taints: ng.taints?.map(t => ({
      key: t.key,
      value: t.value,
      effect: t.effect as 'NO_SCHEDULE' | 'NO_EXECUTE' | 'PREFER_NO_SCHEDULE' | undefined,
    })),
    resources: ng.resources ? {
      autoScalingGroups: ng.resources.autoScalingGroups?.map(asg => ({ name: asg.name })),
      remoteAccessSecurityGroup: ng.resources.remoteAccessSecurityGroup,
    } : undefined,
    diskSize: ng.diskSize,
    health: ng.health ? {
      issues: ng.health.issues?.map(i => ({
        code: i.code,
        message: i.message,
        resourceIds: i.resourceIds,
      })),
    } : undefined,
    updateConfig: ng.updateConfig,
    launchTemplate: ng.launchTemplate,
    tags: ng.tags ?? {},
  });

  private mapEKSFargateProfile = (fp: FargateProfile): EKSFargateProfileInfo => ({
    fargateProfileName: fp.fargateProfileName ?? '',
    fargateProfileArn: fp.fargateProfileArn ?? '',
    clusterName: fp.clusterName ?? '',
    createdAt: fp.createdAt,
    podExecutionRoleArn: fp.podExecutionRoleArn ?? '',
    subnets: fp.subnets ?? [],
    selectors: (fp.selectors ?? []).map(s => ({
      namespace: s.namespace,
      labels: s.labels,
    })),
    status: (fp.status ?? 'CREATING') as 'CREATING' | 'ACTIVE' | 'DELETING' | 'CREATE_FAILED' | 'DELETE_FAILED',
    tags: fp.tags ?? {},
  });

  private mapECRRepository = (repo: Repository): ECRRepositoryInfo => ({
    repositoryArn: repo.repositoryArn ?? '',
    registryId: repo.registryId ?? '',
    repositoryName: repo.repositoryName ?? '',
    repositoryUri: repo.repositoryUri ?? '',
    createdAt: repo.createdAt,
    imageTagMutability: (repo.imageTagMutability ?? 'MUTABLE') as 'MUTABLE' | 'IMMUTABLE',
    imageScanningConfiguration: repo.imageScanningConfiguration ? {
      scanOnPush: repo.imageScanningConfiguration.scanOnPush ?? false,
    } : undefined,
    encryptionConfiguration: repo.encryptionConfiguration ? {
      encryptionType: (repo.encryptionConfiguration.encryptionType ?? 'AES256') as 'AES256' | 'KMS',
      kmsKey: repo.encryptionConfiguration.kmsKey,
    } : undefined,
    tags: {},
  });

  private mapECRImage = (image: ImageDetail): ECRImageInfo => ({
    registryId: image.registryId,
    repositoryName: image.repositoryName ?? '',
    imageDigest: image.imageDigest,
    imageTags: image.imageTags,
    imageSizeInBytes: image.imageSizeInBytes,
    imagePushedAt: image.imagePushedAt,
    imageScanStatus: image.imageScanStatus ? {
      status: image.imageScanStatus.status as 'IN_PROGRESS' | 'COMPLETE' | 'FAILED' | undefined,
      description: image.imageScanStatus.description,
    } : undefined,
    imageScanFindingsSummary: image.imageScanFindingsSummary ? {
      imageScanCompletedAt: image.imageScanFindingsSummary.imageScanCompletedAt,
      vulnerabilitySourceUpdatedAt: image.imageScanFindingsSummary.vulnerabilitySourceUpdatedAt,
      findingSeverityCounts: image.imageScanFindingsSummary.findingSeverityCounts,
    } : undefined,
    imageManifestMediaType: image.imageManifestMediaType,
    artifactMediaType: image.artifactMediaType,
    lastRecordedPullTime: image.lastRecordedPullTime,
  });
}

/**
 * Create Container Manager instance
 */
export function createContainerManager(config?: ContainerManagerConfig): ContainerManager {
  return new ContainerManager(config);
}
