/**
 * Container Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContainerManager, createContainerManager } from './manager.js';

// Mock ECS Client
const mockEcsSend = vi.fn();
vi.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: vi.fn(() => ({ send: mockEcsSend })),
  ListClustersCommand: vi.fn((input) => ({ input, _type: 'ListClustersCommand' })),
  DescribeClustersCommand: vi.fn((input) => ({ input, _type: 'DescribeClustersCommand' })),
  CreateClusterCommand: vi.fn((input) => ({ input, _type: 'CreateClusterCommand' })),
  DeleteClusterCommand: vi.fn((input) => ({ input, _type: 'DeleteClusterCommand' })),
  UpdateClusterCommand: vi.fn((input) => ({ input, _type: 'UpdateClusterCommand' })),
  ListServicesCommand: vi.fn((input) => ({ input, _type: 'ListServicesCommand' })),
  DescribeServicesCommand: vi.fn((input) => ({ input, _type: 'DescribeServicesCommand' })),
  CreateServiceCommand: vi.fn((input) => ({ input, _type: 'CreateServiceCommand' })),
  UpdateServiceCommand: vi.fn((input) => ({ input, _type: 'UpdateServiceCommand' })),
  DeleteServiceCommand: vi.fn((input) => ({ input, _type: 'DeleteServiceCommand' })),
  ListTasksCommand: vi.fn((input) => ({ input, _type: 'ListTasksCommand' })),
  DescribeTasksCommand: vi.fn((input) => ({ input, _type: 'DescribeTasksCommand' })),
  RunTaskCommand: vi.fn((input) => ({ input, _type: 'RunTaskCommand' })),
  StopTaskCommand: vi.fn((input) => ({ input, _type: 'StopTaskCommand' })),
  ListTaskDefinitionsCommand: vi.fn((input) => ({ input, _type: 'ListTaskDefinitionsCommand' })),
  DescribeTaskDefinitionCommand: vi.fn((input) => ({ input, _type: 'DescribeTaskDefinitionCommand' })),
  RegisterTaskDefinitionCommand: vi.fn((input) => ({ input, _type: 'RegisterTaskDefinitionCommand' })),
  DeregisterTaskDefinitionCommand: vi.fn((input) => ({ input, _type: 'DeregisterTaskDefinitionCommand' })),
  ListContainerInstancesCommand: vi.fn((input) => ({ input, _type: 'ListContainerInstancesCommand' })),
  DescribeContainerInstancesCommand: vi.fn((input) => ({ input, _type: 'DescribeContainerInstancesCommand' })),
  UpdateContainerInstancesStateCommand: vi.fn((input) => ({ input, _type: 'UpdateContainerInstancesStateCommand' })),
  ListTagsForResourceCommand: vi.fn((input) => ({ input, _type: 'ListTagsForResourceCommand' })),
  TagResourceCommand: vi.fn((input) => ({ input, _type: 'TagResourceCommand' })),
  UntagResourceCommand: vi.fn((input) => ({ input, _type: 'UntagResourceCommand' })),
}));

// Mock EKS Client
const mockEksSend = vi.fn();
vi.mock('@aws-sdk/client-eks', () => ({
  EKSClient: vi.fn(() => ({ send: mockEksSend })),
  ListClustersCommand: vi.fn((input) => ({ input, _type: 'EKSListClustersCommand' })),
  DescribeClusterCommand: vi.fn((input) => ({ input, _type: 'EKSDescribeClusterCommand' })),
  CreateClusterCommand: vi.fn((input) => ({ input, _type: 'EKSCreateClusterCommand' })),
  DeleteClusterCommand: vi.fn((input) => ({ input, _type: 'EKSDeleteClusterCommand' })),
  UpdateClusterConfigCommand: vi.fn((input) => ({ input, _type: 'UpdateClusterConfigCommand' })),
  UpdateClusterVersionCommand: vi.fn((input) => ({ input, _type: 'UpdateClusterVersionCommand' })),
  ListNodegroupsCommand: vi.fn((input) => ({ input, _type: 'ListNodegroupsCommand' })),
  DescribeNodegroupCommand: vi.fn((input) => ({ input, _type: 'DescribeNodegroupCommand' })),
  CreateNodegroupCommand: vi.fn((input) => ({ input, _type: 'CreateNodegroupCommand' })),
  UpdateNodegroupConfigCommand: vi.fn((input) => ({ input, _type: 'UpdateNodegroupConfigCommand' })),
  UpdateNodegroupVersionCommand: vi.fn((input) => ({ input, _type: 'UpdateNodegroupVersionCommand' })),
  DeleteNodegroupCommand: vi.fn((input) => ({ input, _type: 'DeleteNodegroupCommand' })),
  ListFargateProfilesCommand: vi.fn((input) => ({ input, _type: 'ListFargateProfilesCommand' })),
  DescribeFargateProfileCommand: vi.fn((input) => ({ input, _type: 'DescribeFargateProfileCommand' })),
  CreateFargateProfileCommand: vi.fn((input) => ({ input, _type: 'CreateFargateProfileCommand' })),
  DeleteFargateProfileCommand: vi.fn((input) => ({ input, _type: 'DeleteFargateProfileCommand' })),
  ListTagsForResourceCommand: vi.fn((input) => ({ input, _type: 'EKSListTagsForResourceCommand' })),
  TagResourceCommand: vi.fn((input) => ({ input, _type: 'EKSTagResourceCommand' })),
  UntagResourceCommand: vi.fn((input) => ({ input, _type: 'EKSUntagResourceCommand' })),
}));

// Mock ECR Client
const mockEcrSend = vi.fn();
vi.mock('@aws-sdk/client-ecr', () => ({
  ECRClient: vi.fn(() => ({ send: mockEcrSend })),
  DescribeRepositoriesCommand: vi.fn((input) => ({ input, _type: 'DescribeRepositoriesCommand' })),
  CreateRepositoryCommand: vi.fn((input) => ({ input, _type: 'CreateRepositoryCommand' })),
  DeleteRepositoryCommand: vi.fn((input) => ({ input, _type: 'DeleteRepositoryCommand' })),
  DescribeImagesCommand: vi.fn((input) => ({ input, _type: 'DescribeImagesCommand' })),
  BatchDeleteImageCommand: vi.fn((input) => ({ input, _type: 'BatchDeleteImageCommand' })),
  GetLifecyclePolicyCommand: vi.fn((input) => ({ input, _type: 'GetLifecyclePolicyCommand' })),
  PutLifecyclePolicyCommand: vi.fn((input) => ({ input, _type: 'PutLifecyclePolicyCommand' })),
  DeleteLifecyclePolicyCommand: vi.fn((input) => ({ input, _type: 'DeleteLifecyclePolicyCommand' })),
  StartImageScanCommand: vi.fn((input) => ({ input, _type: 'StartImageScanCommand' })),
  DescribeImageScanFindingsCommand: vi.fn((input) => ({ input, _type: 'DescribeImageScanFindingsCommand' })),
  GetAuthorizationTokenCommand: vi.fn((input) => ({ input, _type: 'GetAuthorizationTokenCommand' })),
  ListTagsForResourceCommand: vi.fn((input) => ({ input, _type: 'ECRListTagsForResourceCommand' })),
  TagResourceCommand: vi.fn((input) => ({ input, _type: 'ECRTagResourceCommand' })),
  UntagResourceCommand: vi.fn((input) => ({ input, _type: 'ECRUntagResourceCommand' })),
}));

// Mock CloudWatch Logs Client
const mockLogsSend = vi.fn();
vi.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: vi.fn(() => ({ send: mockLogsSend })),
  GetLogEventsCommand: vi.fn((input) => ({ input, _type: 'GetLogEventsCommand' })),
  FilterLogEventsCommand: vi.fn((input) => ({ input, _type: 'FilterLogEventsCommand' })),
  DescribeLogGroupsCommand: vi.fn((input) => ({ input, _type: 'DescribeLogGroupsCommand' })),
  DescribeLogStreamsCommand: vi.fn((input) => ({ input, _type: 'DescribeLogStreamsCommand' })),
}));

// Mock CloudWatch Client
const mockCloudWatchSend = vi.fn();
vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: vi.fn(() => ({ send: mockCloudWatchSend })),
  GetMetricDataCommand: vi.fn((input) => ({ input, _type: 'GetMetricDataCommand' })),
}));

// Mock Auto Scaling Client
const mockAutoScalingSend = vi.fn();
vi.mock('@aws-sdk/client-application-auto-scaling', () => ({
  ApplicationAutoScalingClient: vi.fn(() => ({ send: mockAutoScalingSend })),
  RegisterScalableTargetCommand: vi.fn((input) => ({ input, _type: 'RegisterScalableTargetCommand' })),
  DeregisterScalableTargetCommand: vi.fn((input) => ({ input, _type: 'DeregisterScalableTargetCommand' })),
  DescribeScalableTargetsCommand: vi.fn((input) => ({ input, _type: 'DescribeScalableTargetsCommand' })),
  PutScalingPolicyCommand: vi.fn((input) => ({ input, _type: 'PutScalingPolicyCommand' })),
  DeleteScalingPolicyCommand: vi.fn((input) => ({ input, _type: 'DeleteScalingPolicyCommand' })),
  DescribeScalingPoliciesCommand: vi.fn((input) => ({ input, _type: 'DescribeScalingPoliciesCommand' })),
}));

describe('ContainerManager', () => {
  let manager: ContainerManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ContainerManager({ defaultRegion: 'us-east-1' });
  });

  describe('createContainerManager', () => {
    it('should create a ContainerManager instance', () => {
      const instance = createContainerManager({ defaultRegion: 'us-west-2' });
      expect(instance).toBeInstanceOf(ContainerManager);
    });

    it('should create with default config', () => {
      const instance = createContainerManager();
      expect(instance).toBeInstanceOf(ContainerManager);
    });
  });

  // ===========================================================================
  // ECS Cluster Tests
  // ===========================================================================

  describe('ECS Cluster Operations', () => {
    describe('listECSClusters', () => {
      it('should list clusters with details', async () => {
        mockEcsSend
          .mockResolvedValueOnce({ clusterArns: ['arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster'] })
          .mockResolvedValueOnce({
            clusters: [{
              clusterName: 'test-cluster',
              clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
              status: 'ACTIVE',
              registeredContainerInstancesCount: 2,
              runningTasksCount: 5,
              pendingTasksCount: 1,
              activeServicesCount: 3,
              capacityProviders: ['FARGATE'],
              settings: [{ name: 'containerInsights', value: 'enabled' }],
              tags: [{ key: 'Environment', value: 'production' }],
            }],
          });

        const clusters = await manager.listECSClusters();

        expect(clusters).toHaveLength(1);
        expect(clusters[0].clusterName).toBe('test-cluster');
        expect(clusters[0].status).toBe('ACTIVE');
        expect(clusters[0].runningTasksCount).toBe(5);
      });

      it('should return empty array when no clusters exist', async () => {
        mockEcsSend.mockResolvedValueOnce({ clusterArns: [] });

        const clusters = await manager.listECSClusters();

        expect(clusters).toHaveLength(0);
      });

      it('should list clusters without details when includeDetails is false', async () => {
        mockEcsSend.mockResolvedValueOnce({
          clusterArns: ['arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster'],
        });

        const clusters = await manager.listECSClusters({ includeDetails: false });

        expect(clusters).toHaveLength(1);
        expect(clusters[0].clusterName).toBe('test-cluster');
        expect(clusters[0].status).toBe('UNKNOWN');
      });
    });

    describe('getECSCluster', () => {
      it('should get cluster details', async () => {
        mockEcsSend.mockResolvedValueOnce({
          clusters: [{
            clusterName: 'test-cluster',
            clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
            status: 'ACTIVE',
            registeredContainerInstancesCount: 2,
            runningTasksCount: 5,
            pendingTasksCount: 0,
            activeServicesCount: 3,
          }],
        });

        const result = await manager.getECSCluster('test-cluster');

        expect(result.success).toBe(true);
        expect(result.data?.clusterName).toBe('test-cluster');
      });

      it('should return error when cluster not found', async () => {
        mockEcsSend.mockResolvedValueOnce({ clusters: [] });

        const result = await manager.getECSCluster('nonexistent');

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });

      it('should handle errors', async () => {
        mockEcsSend.mockRejectedValueOnce(new Error('Access denied'));

        const result = await manager.getECSCluster('test-cluster');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Access denied');
      });
    });

    describe('createECSCluster', () => {
      it('should create a cluster', async () => {
        mockEcsSend.mockResolvedValueOnce({
          cluster: {
            clusterName: 'new-cluster',
            clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/new-cluster',
            status: 'ACTIVE',
          },
        });

        const result = await manager.createECSCluster({ clusterName: 'new-cluster' });

        expect(result.success).toBe(true);
        expect(result.data?.clusterName).toBe('new-cluster');
        expect(result.message).toContain('created successfully');
      });

      it('should create cluster with capacity providers', async () => {
        mockEcsSend.mockResolvedValueOnce({
          cluster: {
            clusterName: 'new-cluster',
            clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/new-cluster',
            status: 'ACTIVE',
            capacityProviders: ['FARGATE', 'FARGATE_SPOT'],
          },
        });

        const result = await manager.createECSCluster({
          clusterName: 'new-cluster',
          capacityProviders: ['FARGATE', 'FARGATE_SPOT'],
          defaultCapacityProviderStrategy: [{
            capacityProvider: 'FARGATE', weight: 1,
            base: 0
          }],
        });

        expect(result.success).toBe(true);
      });

      it('should handle creation failure', async () => {
        mockEcsSend.mockResolvedValueOnce({ cluster: null });

        const result = await manager.createECSCluster({ clusterName: 'new-cluster' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to create cluster');
      });
    });

    describe('deleteECSCluster', () => {
      it('should delete a cluster', async () => {
        mockEcsSend.mockResolvedValueOnce({});

        const result = await manager.deleteECSCluster('test-cluster');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deleted successfully');
      });

      it('should handle deletion errors', async () => {
        mockEcsSend.mockRejectedValueOnce(new Error('Cluster has active services'));

        const result = await manager.deleteECSCluster('test-cluster');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Cluster has active services');
      });
    });

    describe('updateECSCluster', () => {
      it('should update cluster settings', async () => {
        mockEcsSend.mockResolvedValueOnce({
          cluster: {
            clusterName: 'test-cluster',
            clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
            status: 'ACTIVE',
            settings: [{ name: 'containerInsights', value: 'enabled' }],
          },
        });

        const result = await manager.updateECSCluster('test-cluster', [
          { name: 'containerInsights', value: 'enabled' },
        ]);

        expect(result.success).toBe(true);
        expect(result.message).toContain('updated successfully');
      });
    });
  });

  // ===========================================================================
  // ECS Service Tests
  // ===========================================================================

  describe('ECS Service Operations', () => {
    describe('listECSServices', () => {
      it('should list services with details', async () => {
        mockEcsSend
          .mockResolvedValueOnce({ serviceArns: ['arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service'] })
          .mockResolvedValueOnce({
            services: [{
              serviceName: 'test-service',
              serviceArn: 'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service',
              clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
              status: 'ACTIVE',
              desiredCount: 3,
              runningCount: 3,
              pendingCount: 0,
              taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:1',
            }],
          });

        const services = await manager.listECSServices({ cluster: 'test-cluster' });

        expect(services).toHaveLength(1);
        expect(services[0].serviceName).toBe('test-service');
        expect(services[0].runningCount).toBe(3);
      });

      it('should return empty array when no services exist', async () => {
        mockEcsSend.mockResolvedValueOnce({ serviceArns: [] });

        const services = await manager.listECSServices({ cluster: 'test-cluster' });

        expect(services).toHaveLength(0);
      });
    });

    describe('getECSService', () => {
      it('should get service details', async () => {
        mockEcsSend.mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            serviceArn: 'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service',
            status: 'ACTIVE',
            desiredCount: 3,
            runningCount: 3,
          }],
        });

        const result = await manager.getECSService('test-cluster', 'test-service');

        expect(result.success).toBe(true);
        expect(result.data?.serviceName).toBe('test-service');
      });

      it('should return error when service not found', async () => {
        mockEcsSend.mockResolvedValueOnce({ services: [] });

        const result = await manager.getECSService('test-cluster', 'nonexistent');

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });
    });

    describe('createECSService', () => {
      it('should create a service', async () => {
        mockEcsSend.mockResolvedValueOnce({
          service: {
            serviceName: 'new-service',
            serviceArn: 'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/new-service',
            status: 'ACTIVE',
            desiredCount: 2,
          },
        });

        const result = await manager.createECSService({
          cluster: 'test-cluster',
          serviceName: 'new-service',
          taskDefinition: 'my-task:1',
          desiredCount: 2,
        });

        expect(result.success).toBe(true);
        expect(result.data?.serviceName).toBe('new-service');
      });

      it('should create service with network configuration', async () => {
        mockEcsSend.mockResolvedValueOnce({
          service: {
            serviceName: 'new-service',
            status: 'ACTIVE',
          },
        });

        const result = await manager.createECSService({
          cluster: 'test-cluster',
          serviceName: 'new-service',
          taskDefinition: 'my-task:1',
          desiredCount: 2,
          launchType: 'FARGATE',
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: ['subnet-123'],
              securityGroups: ['sg-123'],
              assignPublicIp: 'ENABLED',
            },
          },
        });

        expect(result.success).toBe(true);
      });
    });

    describe('updateECSService', () => {
      it('should update service', async () => {
        mockEcsSend.mockResolvedValueOnce({
          service: {
            serviceName: 'test-service',
            desiredCount: 5,
          },
        });

        const result = await manager.updateECSService({
          cluster: 'test-cluster',
          service: 'test-service',
          desiredCount: 5,
        });

        expect(result.success).toBe(true);
      });
    });

    describe('scaleECSService', () => {
      it('should scale service', async () => {
        mockEcsSend.mockResolvedValueOnce({
          service: {
            serviceName: 'test-service',
            desiredCount: 10,
          },
        });

        const result = await manager.scaleECSService({
          cluster: 'test-cluster',
          service: 'test-service',
          desiredCount: 10,
        });

        expect(result.success).toBe(true);
      });
    });

    describe('deleteECSService', () => {
      it('should delete a service', async () => {
        mockEcsSend.mockResolvedValueOnce({});

        const result = await manager.deleteECSService('test-cluster', 'test-service');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deleted successfully');
      });

      it('should scale down and delete with force', async () => {
        mockEcsSend
          .mockResolvedValueOnce({ service: { serviceName: 'test-service', desiredCount: 0 } })
          .mockResolvedValueOnce({});

        const result = await manager.deleteECSService('test-cluster', 'test-service', true);

        expect(result.success).toBe(true);
      });
    });

    describe('deployService', () => {
      it('should deploy new task definition', async () => {
        mockEcsSend.mockResolvedValueOnce({
          service: {
            serviceName: 'test-service',
            taskDefinition: 'my-task:2',
          },
        });

        const result = await manager.deployService('test-cluster', 'test-service', 'my-task:2');

        expect(result.success).toBe(true);
      });
    });

    describe('rollbackService', () => {
      it('should rollback to previous revision', async () => {
        mockEcsSend
          .mockResolvedValueOnce({
            services: [{
              serviceName: 'test-service',
              taskDefinition: 'my-task:5',
            }],
          })
          .mockResolvedValueOnce({
            service: {
              serviceName: 'test-service',
              taskDefinition: 'my-task:4',
            },
          });

        const result = await manager.rollbackService({
          cluster: 'test-cluster',
          service: 'test-service',
        });

        expect(result.success).toBe(true);
        expect(result.data?.newTaskDefinition).toBe('my-task:4');
      });

      it('should rollback to specified task definition', async () => {
        mockEcsSend
          .mockResolvedValueOnce({
            services: [{
              serviceName: 'test-service',
              taskDefinition: 'my-task:5',
            }],
          })
          .mockResolvedValueOnce({
            service: { serviceName: 'test-service', taskDefinition: 'my-task:2' },
          });

        const result = await manager.rollbackService({
          cluster: 'test-cluster',
          service: 'test-service',
          taskDefinition: 'my-task:2',
        });

        expect(result.success).toBe(true);
        expect(result.data?.newTaskDefinition).toBe('my-task:2');
      });

      it('should fail rollback when at revision 1', async () => {
        mockEcsSend.mockResolvedValueOnce({
          services: [{
            serviceName: 'test-service',
            taskDefinition: 'my-task:1',
          }],
        });

        const result = await manager.rollbackService({
          cluster: 'test-cluster',
          service: 'test-service',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('No previous revision');
      });
    });
  });

  // ===========================================================================
  // ECS Task Tests
  // ===========================================================================

  describe('ECS Task Operations', () => {
    describe('listECSTasks', () => {
      it('should list tasks with details', async () => {
        mockEcsSend
          .mockResolvedValueOnce({ taskArns: ['arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123'] })
          .mockResolvedValueOnce({
            tasks: [{
              taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
              taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:1',
              lastStatus: 'RUNNING',
              desiredStatus: 'RUNNING',
              containers: [{ name: 'app', lastStatus: 'RUNNING' }],
            }],
          });

        const tasks = await manager.listECSTasks({ cluster: 'test-cluster' });

        expect(tasks).toHaveLength(1);
        expect(tasks[0].lastStatus).toBe('RUNNING');
      });

      it('should return empty array when no tasks exist', async () => {
        mockEcsSend.mockResolvedValueOnce({ taskArns: [] });

        const tasks = await manager.listECSTasks({ cluster: 'test-cluster' });

        expect(tasks).toHaveLength(0);
      });

      it('should list tasks without details', async () => {
        mockEcsSend.mockResolvedValueOnce({
          taskArns: ['arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123'],
        });

        const tasks = await manager.listECSTasks({ cluster: 'test-cluster', includeDetails: false });

        expect(tasks).toHaveLength(1);
        expect(tasks[0].lastStatus).toBe('UNKNOWN');
      });
    });

    describe('getECSTask', () => {
      it('should get task details', async () => {
        mockEcsSend.mockResolvedValueOnce({
          tasks: [{
            taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
            taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:1',
            clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
            lastStatus: 'RUNNING',
            desiredStatus: 'RUNNING',
            containers: [{ name: 'app', lastStatus: 'RUNNING' }],
          }],
        });

        const result = await manager.getECSTask('test-cluster', 'abc123');

        expect(result.success).toBe(true);
        expect(result.data?.lastStatus).toBe('RUNNING');
      });

      it('should return error when task not found', async () => {
        mockEcsSend.mockResolvedValueOnce({ tasks: [] });

        const result = await manager.getECSTask('test-cluster', 'nonexistent');

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });

      it('should handle errors', async () => {
        mockEcsSend.mockRejectedValueOnce(new Error('Access denied'));

        const result = await manager.getECSTask('test-cluster', 'abc123');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Access denied');
      });
    });

    describe('runECSTask', () => {
      it('should run a task', async () => {
        mockEcsSend.mockResolvedValueOnce({
          tasks: [{
            taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
            lastStatus: 'PENDING',
          }],
        });

        const result = await manager.runECSTask({
          cluster: 'test-cluster',
          taskDefinition: 'my-task:1',
          count: 1,
        });

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
      });

      it('should handle task failures', async () => {
        mockEcsSend.mockResolvedValueOnce({
          tasks: [],
          failures: [{ arn: 'some-arn', reason: 'RESOURCE:MEMORY' }],
        });

        const result = await manager.runECSTask({
          cluster: 'test-cluster',
          taskDefinition: 'my-task:1',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('RESOURCE:MEMORY');
      });
    });

    describe('stopECSTask', () => {
      it('should stop a task', async () => {
        mockEcsSend.mockResolvedValueOnce({
          task: {
            taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
            lastStatus: 'STOPPED',
          },
        });

        const result = await manager.stopECSTask('test-cluster', 'abc123', 'Manual stop');

        expect(result.success).toBe(true);
        expect(result.message).toContain('stopped');
      });
    });
  });

  // ===========================================================================
  // Task Definition Tests
  // ===========================================================================

  describe('Task Definition Operations', () => {
    describe('listTaskDefinitions', () => {
      it('should list task definitions', async () => {
        mockEcsSend
          .mockResolvedValueOnce({
            taskDefinitionArns: ['arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:1'],
          })
          .mockResolvedValueOnce({
            taskDefinition: {
              taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:1',
              family: 'my-task',
              revision: 1,
              status: 'ACTIVE',
              containerDefinitions: [{ name: 'app', image: 'nginx:latest' }],
            },
          });

        const definitions = await manager.listTaskDefinitions();

        expect(definitions).toHaveLength(1);
        expect(definitions[0].family).toBe('my-task');
      });
    });

    describe('getTaskDefinition', () => {
      it('should get task definition details', async () => {
        mockEcsSend.mockResolvedValueOnce({
          taskDefinition: {
            taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:1',
            family: 'my-task',
            revision: 1,
            status: 'ACTIVE',
            containerDefinitions: [{ name: 'app', image: 'nginx:latest' }],
          },
        });

        const result = await manager.getTaskDefinition('my-task:1');

        expect(result.success).toBe(true);
        expect(result.data?.family).toBe('my-task');
      });
    });

    describe('registerTaskDefinition', () => {
      it('should register a task definition', async () => {
        mockEcsSend.mockResolvedValueOnce({
          taskDefinition: {
            taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:1',
            family: 'my-task',
            revision: 1,
            containerDefinitions: [{ name: 'app', image: 'nginx:latest' }],
          },
        });

        const result = await manager.registerTaskDefinition({
          family: 'my-task',
          containerDefinitions: [{ name: 'app', image: 'nginx:latest' }],
        });

        expect(result.success).toBe(true);
        expect(result.data?.family).toBe('my-task');
      });
    });

    describe('deregisterTaskDefinition', () => {
      it('should deregister a task definition', async () => {
        mockEcsSend.mockResolvedValueOnce({});

        const result = await manager.deregisterTaskDefinition('my-task:1');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deregistered');
      });
    });
  });

  // ===========================================================================
  // Container Instance Tests
  // ===========================================================================

  describe('Container Instance Operations', () => {
    describe('listContainerInstances', () => {
      it('should list container instances', async () => {
        mockEcsSend
          .mockResolvedValueOnce({
            containerInstanceArns: ['arn:aws:ecs:us-east-1:123456789012:container-instance/test-cluster/abc123'],
          })
          .mockResolvedValueOnce({
            containerInstances: [{
              containerInstanceArn: 'arn:aws:ecs:us-east-1:123456789012:container-instance/test-cluster/abc123',
              ec2InstanceId: 'i-12345678',
              status: 'ACTIVE',
              agentConnected: true,
              runningTasksCount: 2,
              pendingTasksCount: 0,
            }],
          });

        const instances = await manager.listContainerInstances({ cluster: 'test-cluster' });

        expect(instances).toHaveLength(1);
        expect(instances[0].ec2InstanceId).toBe('i-12345678');
      });
    });

    describe('drainContainerInstance', () => {
      it('should drain a container instance', async () => {
        mockEcsSend.mockResolvedValueOnce({
          containerInstances: [{
            containerInstanceArn: 'arn:aws:ecs:us-east-1:123456789012:container-instance/test-cluster/abc123',
            status: 'DRAINING',
          }],
        });

        const result = await manager.drainContainerInstance('test-cluster', 'abc123');

        expect(result.success).toBe(true);
        expect(result.message).toContain('draining');
      });
    });
  });

  // ===========================================================================
  // EKS Cluster Tests
  // ===========================================================================

  describe('EKS Cluster Operations', () => {
    describe('listEKSClusters', () => {
      it('should list EKS clusters with details', async () => {
        mockEksSend
          .mockResolvedValueOnce({ clusters: ['test-eks-cluster'] })
          .mockResolvedValueOnce({
            cluster: {
              name: 'test-eks-cluster',
              arn: 'arn:aws:eks:us-east-1:123456789012:cluster/test-eks-cluster',
              version: '1.27',
              status: 'ACTIVE',
              roleArn: 'arn:aws:iam::123456789012:role/eks-role',
              resourcesVpcConfig: { subnetIds: ['subnet-123'] },
            },
          });

        const clusters = await manager.listEKSClusters();

        expect(clusters).toHaveLength(1);
        expect(clusters[0].name).toBe('test-eks-cluster');
        expect(clusters[0].version).toBe('1.27');
      });
    });

    describe('getEKSCluster', () => {
      it('should get EKS cluster details', async () => {
        mockEksSend.mockResolvedValueOnce({
          cluster: {
            name: 'test-eks-cluster',
            arn: 'arn:aws:eks:us-east-1:123456789012:cluster/test-eks-cluster',
            version: '1.27',
            status: 'ACTIVE',
            roleArn: 'arn:aws:iam::123456789012:role/eks-role',
            resourcesVpcConfig: { subnetIds: ['subnet-123'] },
          },
        });

        const result = await manager.getEKSCluster('test-eks-cluster');

        expect(result.success).toBe(true);
        expect(result.data?.name).toBe('test-eks-cluster');
      });
    });

    describe('createEKSCluster', () => {
      it('should create an EKS cluster', async () => {
        mockEksSend.mockResolvedValueOnce({
          cluster: {
            name: 'new-eks-cluster',
            arn: 'arn:aws:eks:us-east-1:123456789012:cluster/new-eks-cluster',
            status: 'CREATING',
            roleArn: 'arn:aws:iam::123456789012:role/eks-role',
            resourcesVpcConfig: { subnetIds: ['subnet-123'] },
          },
        });

        const result = await manager.createEKSCluster({
          name: 'new-eks-cluster',
          roleArn: 'arn:aws:iam::123456789012:role/eks-role',
          resourcesVpcConfig: { subnetIds: ['subnet-123'] },
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('creation initiated');
      });
    });

    describe('deleteEKSCluster', () => {
      it('should delete an EKS cluster', async () => {
        mockEksSend.mockResolvedValueOnce({});

        const result = await manager.deleteEKSCluster('test-eks-cluster');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deletion initiated');
      });
    });

    describe('updateEKSCluster', () => {
      it('should update EKS cluster configuration', async () => {
        mockEksSend.mockResolvedValueOnce({});

        const result = await manager.updateEKSCluster({
          name: 'test-eks-cluster',
          resourcesVpcConfig: {
            endpointPublicAccess: false,
            endpointPrivateAccess: true,
          },
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('update initiated');
      });

      it('should update cluster logging', async () => {
        mockEksSend.mockResolvedValueOnce({});

        const result = await manager.updateEKSCluster({
          name: 'test-eks-cluster',
          logging: {
            clusterLogging: [{ types: ['api', 'audit'], enabled: true }],
          },
        });

        expect(result.success).toBe(true);
      });

      it('should handle update errors', async () => {
        mockEksSend.mockRejectedValueOnce(new Error('Cluster not found'));

        const result = await manager.updateEKSCluster({
          name: 'nonexistent-cluster',
          resourcesVpcConfig: { endpointPrivateAccess: true },
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Cluster not found');
      });
    });

    describe('updateEKSClusterVersion', () => {
      it('should update cluster version', async () => {
        mockEksSend.mockResolvedValueOnce({});

        const result = await manager.updateEKSClusterVersion('test-eks-cluster', '1.28');

        expect(result.success).toBe(true);
        expect(result.message).toContain('version update');
      });

      it('should handle version update errors', async () => {
        mockEksSend.mockRejectedValueOnce(new Error('Invalid version'));

        const result = await manager.updateEKSClusterVersion('test-eks-cluster', '999.0');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid version');
      });
    });
  });

  // ===========================================================================
  // EKS Node Group Tests
  // ===========================================================================

  describe('EKS Node Group Operations', () => {
    describe('listEKSNodeGroups', () => {
      it('should list node groups', async () => {
        mockEksSend
          .mockResolvedValueOnce({ nodegroups: ['test-nodegroup'] })
          .mockResolvedValueOnce({
            nodegroup: {
              nodegroupName: 'test-nodegroup',
              nodegroupArn: 'arn:aws:eks:us-east-1:123456789012:nodegroup/test-cluster/test-nodegroup/abc123',
              clusterName: 'test-cluster',
              status: 'ACTIVE',
              subnets: ['subnet-123'],
              nodeRole: 'arn:aws:iam::123456789012:role/node-role',
            },
          });

        const nodegroups = await manager.listEKSNodeGroups({ clusterName: 'test-cluster' });

        expect(nodegroups).toHaveLength(1);
        expect(nodegroups[0].nodegroupName).toBe('test-nodegroup');
      });
    });

    describe('getEKSNodeGroup', () => {
      it('should get node group details', async () => {
        mockEksSend.mockResolvedValueOnce({
          nodegroup: {
            nodegroupName: 'test-nodegroup',
            nodegroupArn: 'arn:aws:eks:us-east-1:123456789012:nodegroup/test-cluster/test-nodegroup/abc123',
            clusterName: 'test-cluster',
            status: 'ACTIVE',
            subnets: ['subnet-123'],
            nodeRole: 'arn:aws:iam::123456789012:role/node-role',
            scalingConfig: { minSize: 1, maxSize: 5, desiredSize: 2 },
          },
        });

        const result = await manager.getEKSNodeGroup('test-cluster', 'test-nodegroup');

        expect(result.success).toBe(true);
        expect(result.data?.nodegroupName).toBe('test-nodegroup');
        expect(result.data?.status).toBe('ACTIVE');
      });

      it('should return error when node group not found', async () => {
        mockEksSend.mockResolvedValueOnce({ nodegroup: null });

        const result = await manager.getEKSNodeGroup('test-cluster', 'nonexistent');

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });

      it('should handle errors', async () => {
        mockEksSend.mockRejectedValueOnce(new Error('Access denied'));

        const result = await manager.getEKSNodeGroup('test-cluster', 'test-nodegroup');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Access denied');
      });
    });

    describe('createEKSNodeGroup', () => {
      it('should create a node group', async () => {
        mockEksSend.mockResolvedValueOnce({
          nodegroup: {
            nodegroupName: 'new-nodegroup',
            status: 'CREATING',
            clusterName: 'test-cluster',
            subnets: ['subnet-123'],
            nodeRole: 'arn:aws:iam::123456789012:role/node-role',
          },
        });

        const result = await manager.createEKSNodeGroup({
          clusterName: 'test-cluster',
          nodegroupName: 'new-nodegroup',
          nodeRole: 'arn:aws:iam::123456789012:role/node-role',
          subnets: ['subnet-123'],
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('creation initiated');
      });

      it('should create node group with scaling config', async () => {
        mockEksSend.mockResolvedValueOnce({
          nodegroup: {
            nodegroupName: 'new-nodegroup',
            status: 'CREATING',
            clusterName: 'test-cluster',
            subnets: ['subnet-123'],
            nodeRole: 'arn:aws:iam::123456789012:role/node-role',
            scalingConfig: { minSize: 1, maxSize: 10, desiredSize: 3 },
          },
        });

        const result = await manager.createEKSNodeGroup({
          clusterName: 'test-cluster',
          nodegroupName: 'new-nodegroup',
          nodeRole: 'arn:aws:iam::123456789012:role/node-role',
          subnets: ['subnet-123'],
          scalingConfig: { minSize: 1, maxSize: 10, desiredSize: 3 },
          instanceTypes: ['t3.medium'],
        });

        expect(result.success).toBe(true);
      });

      it('should handle creation failure', async () => {
        mockEksSend.mockResolvedValueOnce({ nodegroup: null });

        const result = await manager.createEKSNodeGroup({
          clusterName: 'test-cluster',
          nodegroupName: 'new-nodegroup',
          nodeRole: 'arn:aws:iam::123456789012:role/node-role',
          subnets: ['subnet-123'],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to create node group');
      });
    });

    describe('updateEKSNodeGroup', () => {
      it('should update node group config', async () => {
        mockEksSend.mockResolvedValueOnce({});

        const result = await manager.updateEKSNodeGroup({
          clusterName: 'test-cluster',
          nodegroupName: 'test-nodegroup',
          scalingConfig: { minSize: 2, maxSize: 10, desiredSize: 5 },
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('update initiated');
      });

      it('should update node group labels', async () => {
        mockEksSend.mockResolvedValueOnce({});

        const result = await manager.updateEKSNodeGroup({
          clusterName: 'test-cluster',
          nodegroupName: 'test-nodegroup',
          labels: { addOrUpdateLabels: { environment: 'production' } },
        });

        expect(result.success).toBe(true);
      });

      it('should handle update errors', async () => {
        mockEksSend.mockRejectedValueOnce(new Error('Node group not found'));

        const result = await manager.updateEKSNodeGroup({
          clusterName: 'test-cluster',
          nodegroupName: 'nonexistent',
          scalingConfig: { minSize: 1, maxSize: 5, desiredSize: 2 },
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Node group not found');
      });
    });

    describe('updateEKSNodeGroupVersion', () => {
      it('should update node group version', async () => {
        mockEksSend.mockResolvedValueOnce({});

        const result = await manager.updateEKSNodeGroupVersion(
          'test-cluster',
          'test-nodegroup',
          '1.28'
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain('version update initiated');
      });

      it('should update with release version', async () => {
        mockEksSend.mockResolvedValueOnce({});

        const result = await manager.updateEKSNodeGroupVersion(
          'test-cluster',
          'test-nodegroup',
          undefined,
          '1.28.0-20231001'
        );

        expect(result.success).toBe(true);
      });

      it('should update with launch template', async () => {
        mockEksSend.mockResolvedValueOnce({});

        const result = await manager.updateEKSNodeGroupVersion(
          'test-cluster',
          'test-nodegroup',
          '1.28',
          undefined,
          { name: 'my-template', version: '2' }
        );

        expect(result.success).toBe(true);
      });

      it('should handle version update errors', async () => {
        mockEksSend.mockRejectedValueOnce(new Error('Invalid version'));

        const result = await manager.updateEKSNodeGroupVersion(
          'test-cluster',
          'test-nodegroup',
          '999.0'
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid version');
      });
    });

    describe('deleteEKSNodeGroup', () => {
      it('should delete a node group', async () => {
        mockEksSend.mockResolvedValueOnce({});

        const result = await manager.deleteEKSNodeGroup('test-cluster', 'test-nodegroup');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deletion initiated');
      });

      it('should handle deletion errors', async () => {
        mockEksSend.mockRejectedValueOnce(new Error('Node group has active nodes'));

        const result = await manager.deleteEKSNodeGroup('test-cluster', 'test-nodegroup');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Node group has active nodes');
      });
    });
  });

  // ===========================================================================
  // EKS Fargate Profile Tests
  // ===========================================================================

  describe('EKS Fargate Profile Operations', () => {
    describe('listEKSFargateProfiles', () => {
      it('should list Fargate profiles', async () => {
        mockEksSend
          .mockResolvedValueOnce({ fargateProfileNames: ['test-profile'] })
          .mockResolvedValueOnce({
            fargateProfile: {
              fargateProfileName: 'test-profile',
              fargateProfileArn: 'arn:aws:eks:us-east-1:123456789012:fargateprofile/test-cluster/test-profile/abc123',
              clusterName: 'test-cluster',
              podExecutionRoleArn: 'arn:aws:iam::123456789012:role/fargate-role',
              status: 'ACTIVE',
              subnets: ['subnet-123'],
              selectors: [{ namespace: 'default' }],
            },
          });

        const profiles = await manager.listEKSFargateProfiles({ clusterName: 'test-cluster' });

        expect(profiles).toHaveLength(1);
        expect(profiles[0].fargateProfileName).toBe('test-profile');
      });
    });

    describe('createEKSFargateProfile', () => {
      it('should create a Fargate profile', async () => {
        mockEksSend.mockResolvedValueOnce({
          fargateProfile: {
            fargateProfileName: 'new-profile',
            status: 'CREATING',
            clusterName: 'test-cluster',
            podExecutionRoleArn: 'arn:aws:iam::123456789012:role/fargate-role',
            subnets: ['subnet-123'],
            selectors: [{ namespace: 'default' }],
          },
        });

        const result = await manager.createEKSFargateProfile({
          clusterName: 'test-cluster',
          fargateProfileName: 'new-profile',
          podExecutionRoleArn: 'arn:aws:iam::123456789012:role/fargate-role',
          subnets: ['subnet-123'],
          selectors: [{ namespace: 'default' }],
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('creation initiated');
      });
    });

    describe('deleteEKSFargateProfile', () => {
      it('should delete a Fargate profile', async () => {
        mockEksSend.mockResolvedValueOnce({});

        const result = await manager.deleteEKSFargateProfile('test-cluster', 'test-profile');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deletion initiated');
      });
    });
  });

  // ===========================================================================
  // ECR Repository Tests
  // ===========================================================================

  describe('ECR Repository Operations', () => {
    describe('listECRRepositories', () => {
      it('should list repositories', async () => {
        mockEcrSend.mockResolvedValueOnce({
          repositories: [{
            repositoryName: 'my-repo',
            repositoryArn: 'arn:aws:ecr:us-east-1:123456789012:repository/my-repo',
            repositoryUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo',
            registryId: '123456789012',
            imageTagMutability: 'MUTABLE',
          }],
        });

        const repos = await manager.listECRRepositories();

        expect(repos).toHaveLength(1);
        expect(repos[0].repositoryName).toBe('my-repo');
      });
    });

    describe('getECRRepository', () => {
      it('should get repository details', async () => {
        mockEcrSend.mockResolvedValueOnce({
          repositories: [{
            repositoryName: 'my-repo',
            repositoryArn: 'arn:aws:ecr:us-east-1:123456789012:repository/my-repo',
            repositoryUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo',
          }],
        });

        const result = await manager.getECRRepository('my-repo');

        expect(result.success).toBe(true);
        expect(result.data?.repositoryName).toBe('my-repo');
      });
    });

    describe('createECRRepository', () => {
      it('should create a repository', async () => {
        mockEcrSend.mockResolvedValueOnce({
          repository: {
            repositoryName: 'new-repo',
            repositoryArn: 'arn:aws:ecr:us-east-1:123456789012:repository/new-repo',
            repositoryUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/new-repo',
          },
        });

        const result = await manager.createECRRepository({
          repositoryName: 'new-repo',
          imageTagMutability: 'IMMUTABLE',
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('created');
      });
    });

    describe('deleteECRRepository', () => {
      it('should delete a repository', async () => {
        mockEcrSend.mockResolvedValueOnce({});

        const result = await manager.deleteECRRepository('my-repo');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deleted');
      });

      it('should force delete repository with images', async () => {
        mockEcrSend.mockResolvedValueOnce({});

        const result = await manager.deleteECRRepository('my-repo', true);

        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // ECR Image Tests
  // ===========================================================================

  describe('ECR Image Operations', () => {
    describe('listECRImages', () => {
      it('should list images', async () => {
        mockEcrSend.mockResolvedValueOnce({
          imageDetails: [{
            repositoryName: 'my-repo',
            imageDigest: 'sha256:abc123',
            imageTags: ['latest', 'v1.0.0'],
            imageSizeInBytes: 50000000,
            imagePushedAt: new Date(),
          }],
        });

        const images = await manager.listECRImages({ repositoryName: 'my-repo' });

        expect(images).toHaveLength(1);
        expect(images[0].imageTags).toContain('latest');
      });
    });

    describe('deleteECRImages', () => {
      it('should delete images', async () => {
        mockEcrSend.mockResolvedValueOnce({
          imageIds: [{ imageDigest: 'sha256:abc123' }],
          failures: [],
        });

        const result = await manager.deleteECRImages('my-repo', [{ imageDigest: 'sha256:abc123' }]);

        expect(result.success).toBe(true);
      });

      it('should report failures', async () => {
        mockEcrSend.mockResolvedValueOnce({
          imageIds: [],
          failures: [{ imageId: { imageTag: 'latest' }, failureReason: 'ImageNotFound' }],
        });

        const result = await manager.deleteECRImages('my-repo', [{ imageTag: 'latest' }]);

        expect(result.success).toBe(false);
        expect(result.error).toContain('ImageNotFound');
      });
    });

    describe('startECRImageScan', () => {
      it('should start image scan', async () => {
        mockEcrSend.mockResolvedValueOnce({});

        const result = await manager.startECRImageScan('my-repo', { imageTag: 'latest' });

        expect(result.success).toBe(true);
        expect(result.message).toContain('scan started');
      });
    });

    describe('getECRImageScanFindings', () => {
      it('should get scan findings', async () => {
        mockEcrSend.mockResolvedValueOnce({
          imageScanFindings: {
            findingSeverityCounts: { HIGH: 2, MEDIUM: 5 },
            findings: [
              { name: 'CVE-2023-1234', severity: 'HIGH', description: 'Test vulnerability' },
            ],
          },
        });

        const result = await manager.getECRImageScanFindings({
          repositoryName: 'my-repo',
          imageId: { imageTag: 'latest' },
        });

        expect(result.success).toBe(true);
        expect(result.data?.findingSeverityCounts?.HIGH).toBe(2);
      });
    });
  });

  // ===========================================================================
  // ECR Lifecycle Policy Tests
  // ===========================================================================

  describe('ECR Lifecycle Policy Operations', () => {
    describe('getECRLifecyclePolicy', () => {
      it('should get lifecycle policy', async () => {
        mockEcrSend.mockResolvedValueOnce({
          repositoryName: 'my-repo',
          lifecyclePolicyText: '{"rules":[]}',
          registryId: '123456789012',
        });

        const result = await manager.getECRLifecyclePolicy('my-repo');

        expect(result.success).toBe(true);
        expect(result.data?.lifecyclePolicyText).toBe('{"rules":[]}');
      });
    });

    describe('setECRLifecyclePolicy', () => {
      it('should set lifecycle policy', async () => {
        mockEcrSend.mockResolvedValueOnce({});

        const result = await manager.setECRLifecyclePolicy({
          repositoryName: 'my-repo',
          lifecyclePolicyText: '{"rules":[]}',
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('Lifecycle policy set');
      });
    });

    describe('deleteECRLifecyclePolicy', () => {
      it('should delete lifecycle policy', async () => {
        mockEcrSend.mockResolvedValueOnce({});

        const result = await manager.deleteECRLifecyclePolicy('my-repo');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deleted');
      });
    });

    describe('getECRAuthorizationToken', () => {
      it('should get authorization token', async () => {
        mockEcrSend.mockResolvedValueOnce({
          authorizationData: [{
            authorizationToken: 'dG9rZW4=',
            proxyEndpoint: 'https://123456789012.dkr.ecr.us-east-1.amazonaws.com',
            expiresAt: new Date(),
          }],
        });

        const result = await manager.getECRAuthorizationToken();

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data?.[0].token).toBe('dG9rZW4=');
      });
    });
  });

  // ===========================================================================
  // Container Logs Tests
  // ===========================================================================

  describe('Container Logs Operations', () => {
    describe('getContainerLogs', () => {
      it('should get container logs', async () => {
        // Mock getting task details
        mockEcsSend.mockResolvedValueOnce({
          tasks: [{
            taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
            taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:1',
          }],
        });

        // Mock getting task definition
        mockEcsSend.mockResolvedValueOnce({
          taskDefinition: {
            containerDefinitions: [{
              name: 'app',
              logConfiguration: {
                logDriver: 'awslogs',
                options: { 'awslogs-group': '/ecs/my-task' },
              },
            }],
          },
        });

        // Mock describing log streams
        mockLogsSend.mockResolvedValueOnce({
          logStreams: [{ logStreamName: 'app/abc123' }],
        });

        // Mock getting log events
        mockLogsSend.mockResolvedValueOnce({
          events: [
            { timestamp: Date.now(), message: 'Log message 1', ingestionTime: Date.now() },
            { timestamp: Date.now(), message: 'Log message 2', ingestionTime: Date.now() },
          ],
        });

        const result = await manager.getContainerLogs({
          cluster: 'test-cluster',
          taskId: 'abc123',
          containerName: 'app',
        });

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(2);
      });

      it('should get logs with explicit log group name', async () => {
        mockLogsSend.mockResolvedValueOnce({
          logStreams: [{ logStreamName: 'app/abc123' }],
        });

        mockLogsSend.mockResolvedValueOnce({
          events: [
            { timestamp: Date.now(), message: 'Test log', ingestionTime: Date.now() },
          ],
        });

        const result = await manager.getContainerLogs({
          cluster: 'test-cluster',
          taskId: 'abc123',
          containerName: 'app',
          logGroupName: '/ecs/my-task',
        });

        expect(result.success).toBe(true);
      });

      it('should filter logs with pattern', async () => {
        mockEcsSend.mockResolvedValueOnce({
          tasks: [{
            taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
            taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:1',
          }],
        });

        mockEcsSend.mockResolvedValueOnce({
          taskDefinition: {
            containerDefinitions: [{
              name: 'app',
              logConfiguration: {
                logDriver: 'awslogs',
                options: { 'awslogs-group': '/ecs/my-task' },
              },
            }],
          },
        });

        mockLogsSend.mockResolvedValueOnce({
          logStreams: [{ logStreamName: 'app/abc123' }],
        });

        mockLogsSend.mockResolvedValueOnce({
          events: [
            { timestamp: Date.now(), message: 'ERROR: Something failed', logStreamName: 'app/abc123' },
          ],
        });

        const result = await manager.getContainerLogs({
          cluster: 'test-cluster',
          taskId: 'abc123',
          containerName: 'app',
          filterPattern: 'ERROR',
        });

        expect(result.success).toBe(true);
        expect(result.data?.[0].message).toContain('ERROR');
      });

      it('should return empty when no log streams found', async () => {
        mockLogsSend.mockResolvedValueOnce({
          logStreams: [],
        });

        const result = await manager.getContainerLogs({
          cluster: 'test-cluster',
          taskId: 'abc123',
          containerName: 'app',
          logGroupName: '/ecs/my-task',
        });

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(0);
      });

      it('should return error when log group not determinable', async () => {
        mockEcsSend.mockResolvedValueOnce({ tasks: [] });

        const result = await manager.getContainerLogs({
          cluster: 'test-cluster',
          taskId: 'abc123',
          containerName: 'app',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Could not determine log group');
      });

      it('should handle errors', async () => {
        mockLogsSend.mockRejectedValueOnce(new Error('Access denied'));

        const result = await manager.getContainerLogs({
          cluster: 'test-cluster',
          taskId: 'abc123',
          containerName: 'app',
          logGroupName: '/ecs/my-task',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Access denied');
      });
    });
  });

  // ===========================================================================
  // Auto Scaling Tests
  // ===========================================================================

  describe('Auto Scaling Operations', () => {
    describe('registerScalableTarget', () => {
      it('should register a scalable target', async () => {
        mockAutoScalingSend.mockResolvedValueOnce({});

        const result = await manager.registerScalableTarget({
          serviceNamespace: 'ecs',
          resourceId: 'service/test-cluster/test-service',
          scalableDimension: 'ecs:service:DesiredCount',
          minCapacity: 1,
          maxCapacity: 10,
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('registered');
      });
    });

    describe('deregisterScalableTarget', () => {
      it('should deregister a scalable target', async () => {
        mockAutoScalingSend.mockResolvedValueOnce({});

        const result = await manager.deregisterScalableTarget('service/test-cluster/test-service');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deregistered');
      });
    });

    describe('listScalableTargets', () => {
      it('should list scalable targets', async () => {
        mockAutoScalingSend.mockResolvedValueOnce({
          ScalableTargets: [{
            ResourceId: 'service/test-cluster/test-service',
            ServiceNamespace: 'ecs',
            ScalableDimension: 'ecs:service:DesiredCount',
            MinCapacity: 1,
            MaxCapacity: 10,
          }],
        });

        const targets = await manager.listScalableTargets();

        expect(targets).toHaveLength(1);
        expect(targets[0].resourceId).toBe('service/test-cluster/test-service');
      });
    });

    describe('putScalingPolicy', () => {
      it('should create a scaling policy', async () => {
        mockAutoScalingSend.mockResolvedValueOnce({
          PolicyARN: 'arn:aws:autoscaling:us-east-1:123456789012:scalingPolicy:abc123',
          Alarms: [{ AlarmName: 'test-alarm', AlarmARN: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:test-alarm' }],
        });

        const result = await manager.putScalingPolicy({
          policyName: 'test-policy',
          serviceNamespace: 'ecs',
          resourceId: 'service/test-cluster/test-service',
          scalableDimension: 'ecs:service:DesiredCount',
          policyType: 'TargetTrackingScaling',
          targetTrackingScalingPolicyConfiguration: {
            targetValue: 75,
            predefinedMetricSpecification: {
              predefinedMetricType: 'ECSServiceAverageCPUUtilization',
            },
          },
        });

        expect(result.success).toBe(true);
        expect(result.data?.policyName).toBe('test-policy');
      });
    });

    describe('deleteScalingPolicy', () => {
      it('should delete a scaling policy', async () => {
        mockAutoScalingSend.mockResolvedValueOnce({});

        const result = await manager.deleteScalingPolicy('test-policy', 'service/test-cluster/test-service');

        expect(result.success).toBe(true);
        expect(result.message).toContain('deleted');
      });
    });

    describe('listScalingPolicies', () => {
      it('should list scaling policies', async () => {
        mockAutoScalingSend.mockResolvedValueOnce({
          ScalingPolicies: [{
            PolicyName: 'test-policy',
            PolicyARN: 'arn:aws:autoscaling:us-east-1:123456789012:scalingPolicy:abc123',
            ServiceNamespace: 'ecs',
            ResourceId: 'service/test-cluster/test-service',
            ScalableDimension: 'ecs:service:DesiredCount',
            PolicyType: 'TargetTrackingScaling',
          }],
        });

        const policies = await manager.listScalingPolicies();

        expect(policies).toHaveLength(1);
        expect(policies[0].policyName).toBe('test-policy');
      });
    });
  });

  // ===========================================================================
  // Container Insights Tests
  // ===========================================================================

  describe('Container Insights Operations', () => {
    describe('getContainerInsights', () => {
      it('should get container insights metrics', async () => {
        const now = new Date();
        mockCloudWatchSend.mockResolvedValueOnce({
          MetricDataResults: [
            { Id: 'm0', Timestamps: [now], Values: [50] },
            { Id: 'm1', Timestamps: [now], Values: [1024] },
          ],
        });

        const result = await manager.getContainerInsights({
          cluster: 'test-cluster',
          serviceName: 'test-service',
        });

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data?.[0].metrics.cpuUtilization).toBe(50);
      });

      it('should handle empty metrics', async () => {
        mockCloudWatchSend.mockResolvedValueOnce({
          MetricDataResults: [],
        });

        const result = await manager.getContainerInsights({
          cluster: 'test-cluster',
        });

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(0);
      });
    });
  });

  // ===========================================================================
  // Tagging Tests
  // ===========================================================================

  describe('Tagging Operations', () => {
    describe('tagECSResource', () => {
      it('should tag an ECS resource', async () => {
        mockEcsSend.mockResolvedValueOnce({});

        const result = await manager.tagECSResource(
          'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          { Environment: 'production' }
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain('Tags added');
      });
    });

    describe('untagECSResource', () => {
      it('should untag an ECS resource', async () => {
        mockEcsSend.mockResolvedValueOnce({});

        const result = await manager.untagECSResource(
          'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          ['Environment']
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain('Tags removed');
      });
    });

    describe('tagEKSResource', () => {
      it('should tag an EKS resource', async () => {
        mockEksSend.mockResolvedValueOnce({});

        const result = await manager.tagEKSResource(
          'arn:aws:eks:us-east-1:123456789012:cluster/test-cluster',
          { Environment: 'production' }
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain('Tags added');
      });
    });

    describe('untagEKSResource', () => {
      it('should untag an EKS resource', async () => {
        mockEksSend.mockResolvedValueOnce({});

        const result = await manager.untagEKSResource(
          'arn:aws:eks:us-east-1:123456789012:cluster/test-cluster',
          ['Environment']
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain('Tags removed');
      });
    });
  });
});