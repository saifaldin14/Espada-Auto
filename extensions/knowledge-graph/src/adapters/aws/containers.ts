/**
 * AWS Adapter — Containers Domain Module
 *
 * Discovers deeper container resources: ECS clusters, services, tasks,
 * EKS clusters, node groups, Fargate profiles, and ECR repositories
 * via the ContainerManager from @espada/aws.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AwsAdapterContext } from "./context.js";
import { buildAwsNodeId, findNodeByArnOrId, extractResourceId } from "./utils.js";

/**
 * Discover deeper container resources via ContainerManager.
 *
 * Discovers ECS clusters/services/tasks, EKS clusters/node groups/Fargate
 * profiles, and ECR repositories. Creates nodes and edges linking:
 * - ECS cluster → services → tasks
 * - EKS cluster → node groups / Fargate profiles
 * - ECR repo nodes with image count metadata
 */
export async function discoverContainersDeeper(
  ctx: AwsAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getContainerManager();
  if (!mgr) return;

  const m = mgr as {
    listECSClusters: (opts?: { maxResults?: number }) => Promise<Array<{
      clusterName?: string;
      clusterArn?: string;
      status?: string;
      registeredContainerInstancesCount?: number;
      runningTasksCount?: number;
      pendingTasksCount?: number;
      activeServicesCount?: number;
      capacityProviders?: string[];
    }>>;
    listECSServices: (opts: { cluster: string; maxResults?: number }) => Promise<Array<{
      serviceName?: string;
      serviceArn?: string;
      clusterArn?: string;
      status?: string;
      desiredCount?: number;
      runningCount?: number;
      pendingCount?: number;
      launchType?: string;
      taskDefinition?: string;
      loadBalancers?: Array<{ targetGroupArn?: string; containerName?: string; containerPort?: number }>;
      createdAt?: string;
    }>>;
    listECSTasks: (opts: { cluster: string; maxResults?: number }) => Promise<Array<{
      taskArn?: string;
      taskDefinitionArn?: string;
      clusterArn?: string;
      lastStatus?: string;
      desiredStatus?: string;
      launchType?: string;
      cpu?: string;
      memory?: string;
      startedAt?: string;
      containers?: Array<{ name?: string; lastStatus?: string; image?: string }>;
    }>>;
    listEKSClusters: (opts?: { maxResults?: number }) => Promise<Array<{
      name?: string;
      arn?: string;
      status?: string;
      version?: string;
      platformVersion?: string;
      endpoint?: string;
      roleArn?: string;
      vpcId?: string;
      subnetIds?: string[];
      securityGroupIds?: string[];
      createdAt?: string;
    }>>;
    listEKSNodeGroups: (opts: { clusterName: string }) => Promise<Array<{
      nodegroupName?: string;
      nodegroupArn?: string;
      clusterName?: string;
      status?: string;
      instanceTypes?: string[];
      scalingConfig?: { desiredSize?: number; minSize?: number; maxSize?: number };
      amiType?: string;
      capacityType?: string;
      diskSize?: number;
      subnets?: string[];
    }>>;
    listEKSFargateProfiles: (opts: { clusterName: string }) => Promise<Array<{
      fargateProfileName?: string;
      fargateProfileArn?: string;
      clusterName?: string;
      status?: string;
      podExecutionRoleArn?: string;
      subnets?: string[];
      selectors?: Array<{ namespace?: string; labels?: Record<string, string> }>;
    }>>;
    listECRRepositories: (opts?: { maxResults?: number }) => Promise<Array<{
      repositoryName?: string;
      repositoryArn?: string;
      repositoryUri?: string;
      registryId?: string;
      imageTagMutability?: string;
      imageScanningConfiguration?: { scanOnPush?: boolean };
      encryptionConfiguration?: { encryptionType?: string };
      createdAt?: string;
    }>>;
  };

  // --- ECS Clusters ---
  try {
    const clusters = await m.listECSClusters({ maxResults: 100 });
    for (const cluster of clusters) {
      if (!cluster.clusterName) continue;

      const existingCluster = nodes.find(
        (n) =>
          n.resourceType === "cluster" &&
          (n.nativeId === cluster.clusterArn || n.name === cluster.clusterName),
      );

      if (existingCluster) {
        // Enrich existing cluster node
        existingCluster.metadata["registeredInstances"] = cluster.registeredContainerInstancesCount;
        existingCluster.metadata["runningTasks"] = cluster.runningTasksCount;
        existingCluster.metadata["activeServices"] = cluster.activeServicesCount;
        existingCluster.metadata["capacityProviders"] = cluster.capacityProviders;
        existingCluster.metadata["discoverySource"] = "container-manager";
        continue;
      }

      const clusterNodeId = buildAwsNodeId(
        ctx.accountId,
        "us-east-1",
        "cluster",
        cluster.clusterName,
      );

      nodes.push({
        id: clusterNodeId,
        name: cluster.clusterName,
        resourceType: "cluster",
        provider: "aws",
        region: "us-east-1",
        account: ctx.accountId,
        nativeId: cluster.clusterArn ?? cluster.clusterName,
        status: cluster.status === "ACTIVE" ? "running" : "stopped",
        tags: {},
        metadata: {
          resourceSubtype: "ecs-cluster",
          registeredInstances: cluster.registeredContainerInstancesCount,
          runningTasks: cluster.runningTasksCount,
          pendingTasks: cluster.pendingTasksCount,
          activeServices: cluster.activeServicesCount,
          capacityProviders: cluster.capacityProviders,
          discoverySource: "container-manager",
        },
        costMonthly: 0, // ECS cluster itself is free; cost is in tasks
        owner: null,
        createdAt: null,
      });

      // Discover ECS Services for this cluster
      try {
        const services = await m.listECSServices({ cluster: cluster.clusterName, maxResults: 100 });
        for (const svc of services) {
          if (!svc.serviceName) continue;

          const svcNodeId = buildAwsNodeId(
            ctx.accountId,
            "us-east-1",
            "container",
            `ecs-svc-${cluster.clusterName}-${svc.serviceName}`,
          );

          nodes.push({
            id: svcNodeId,
            name: svc.serviceName,
            resourceType: "container",
            provider: "aws",
            region: "us-east-1",
            account: ctx.accountId,
            nativeId: svc.serviceArn ?? svc.serviceName,
            status: svc.status === "ACTIVE" ? "running" : "stopped",
            tags: {},
            metadata: {
              resourceSubtype: "ecs-service",
              desiredCount: svc.desiredCount,
              runningCount: svc.runningCount,
              pendingCount: svc.pendingCount,
              launchType: svc.launchType,
              taskDefinition: svc.taskDefinition,
              discoverySource: "container-manager",
            },
            costMonthly: svc.launchType === "FARGATE" ? 18 * (svc.runningCount ?? 1) : 0,
            owner: null,
            createdAt: svc.createdAt ?? null,
          });

          // ECS cluster → service (contains)
          const containsEdgeId = `${clusterNodeId}--contains--${svcNodeId}`;
          if (!edges.some((e) => e.id === containsEdgeId)) {
            edges.push({
              id: containsEdgeId,
              sourceNodeId: clusterNodeId,
              targetNodeId: svcNodeId,
              relationshipType: "contains",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: {},
            });
          }

          // Service → load balancer target groups
          if (svc.loadBalancers) {
            for (const lb of svc.loadBalancers) {
              if (!lb.targetGroupArn) continue;
              const tgNode = findNodeByArnOrId(nodes, lb.targetGroupArn, extractResourceId(lb.targetGroupArn));
              if (!tgNode) continue;
              const edgeId = `${svcNodeId}--attached-to--${tgNode.id}`;
              if (!edges.some((e) => e.id === edgeId)) {
                edges.push({
                  id: edgeId,
                  sourceNodeId: svcNodeId,
                  targetNodeId: tgNode.id,
                  relationshipType: "attached-to",
                  confidence: 0.9,
                  discoveredVia: "api-field",
                  metadata: { containerPort: lb.containerPort },
                });
              }
            }
          }
        }
      } catch {
        // ECS services discovery is best-effort per cluster
      }

      // Discover ECS Tasks for this cluster
      try {
        const tasks = await m.listECSTasks({ cluster: cluster.clusterName, maxResults: 50 });
        for (const task of tasks) {
          if (!task.taskArn) continue;

          const taskId = extractResourceId(task.taskArn);
          const taskNodeId = buildAwsNodeId(
            ctx.accountId,
            "us-east-1",
            "container",
            `ecs-task-${taskId}`,
          );

          nodes.push({
            id: taskNodeId,
            name: `task-${taskId.slice(0, 8)}`,
            resourceType: "container",
            provider: "aws",
            region: "us-east-1",
            account: ctx.accountId,
            nativeId: task.taskArn,
            status: task.lastStatus === "RUNNING" ? "running" : "stopped",
            tags: {},
            metadata: {
              resourceSubtype: "ecs-task",
              lastStatus: task.lastStatus,
              desiredStatus: task.desiredStatus,
              launchType: task.launchType,
              cpu: task.cpu,
              memory: task.memory,
              containerCount: task.containers?.length ?? 0,
              discoverySource: "container-manager",
            },
            costMonthly: 0, // Cost tracked at service level
            owner: null,
            createdAt: task.startedAt ?? null,
          });

          // Cluster → task (contains)
          const taskEdgeId = `${clusterNodeId}--contains--${taskNodeId}`;
          if (!edges.some((e) => e.id === taskEdgeId)) {
            edges.push({
              id: taskEdgeId,
              sourceNodeId: clusterNodeId,
              targetNodeId: taskNodeId,
              relationshipType: "contains",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: {},
            });
          }
        }
      } catch {
        // ECS task discovery is best-effort per cluster
      }
    }
  } catch {
    // ECS cluster discovery is best-effort
  }

  // --- EKS Clusters ---
  try {
    const eksClusters = await m.listEKSClusters({ maxResults: 50 });
    for (const eks of eksClusters) {
      if (!eks.name) continue;

      const existingEks = nodes.find(
        (n) =>
          n.resourceType === "cluster" &&
          (n.nativeId === eks.arn || n.name === eks.name),
      );

      const eksNodeId = existingEks?.id ?? buildAwsNodeId(
        ctx.accountId,
        "us-east-1",
        "cluster",
        `eks-${eks.name}`,
      );

      if (existingEks) {
        existingEks.metadata["k8sVersion"] = eks.version;
        existingEks.metadata["platformVersion"] = eks.platformVersion;
        existingEks.metadata["endpoint"] = eks.endpoint;
        existingEks.metadata["discoverySource"] = "container-manager";
      } else {
        nodes.push({
          id: eksNodeId,
          name: eks.name,
          resourceType: "cluster",
          provider: "aws",
          region: "us-east-1",
          account: ctx.accountId,
          nativeId: eks.arn ?? eks.name,
          status: eks.status === "ACTIVE" ? "running" : "stopped",
          tags: {},
          metadata: {
            resourceSubtype: "eks-cluster",
            k8sVersion: eks.version,
            platformVersion: eks.platformVersion,
            endpoint: eks.endpoint,
            discoverySource: "container-manager",
          },
          costMonthly: 73, // EKS control plane: ~$0.10/hr
          owner: null,
          createdAt: eks.createdAt ?? null,
        });
      }

      // Link EKS → VPC
      if (eks.vpcId) {
        const vpcNode = nodes.find((n) => n.resourceType === "vpc" && n.nativeId === eks.vpcId);
        if (vpcNode) {
          const edgeId = `${eksNodeId}--deployed-at--${vpcNode.id}`;
          if (!edges.some((e) => e.id === edgeId)) {
            edges.push({
              id: edgeId,
              sourceNodeId: eksNodeId,
              targetNodeId: vpcNode.id,
              relationshipType: "deployed-at",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: {},
            });
          }
        }
      }

      // Link EKS → IAM role
      if (eks.roleArn) {
        const roleNode = findNodeByArnOrId(nodes, eks.roleArn, extractResourceId(eks.roleArn));
        if (roleNode) {
          const edgeId = `${eksNodeId}--uses--${roleNode.id}`;
          if (!edges.some((e) => e.id === edgeId)) {
            edges.push({
              id: edgeId,
              sourceNodeId: eksNodeId,
              targetNodeId: roleNode.id,
              relationshipType: "uses",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: {},
            });
          }
        }
      }

      // Discover Node Groups
      try {
        const nodeGroups = await m.listEKSNodeGroups({ clusterName: eks.name });
        for (const ng of nodeGroups) {
          if (!ng.nodegroupName) continue;

          const ngNodeId = buildAwsNodeId(
            ctx.accountId,
            "us-east-1",
            "custom",
            `eks-ng-${eks.name}-${ng.nodegroupName}`,
          );

          nodes.push({
            id: ngNodeId,
            name: ng.nodegroupName,
            resourceType: "custom",
            provider: "aws",
            region: "us-east-1",
            account: ctx.accountId,
            nativeId: ng.nodegroupArn ?? ng.nodegroupName,
            status: ng.status === "ACTIVE" ? "running" : "stopped",
            tags: {},
            metadata: {
              resourceSubtype: "eks-node-group",
              instanceTypes: ng.instanceTypes,
              desiredSize: ng.scalingConfig?.desiredSize,
              minSize: ng.scalingConfig?.minSize,
              maxSize: ng.scalingConfig?.maxSize,
              amiType: ng.amiType,
              capacityType: ng.capacityType,
              diskSize: ng.diskSize,
              discoverySource: "container-manager",
            },
            costMonthly: 0, // Cost is in underlying EC2 instances
            owner: null,
            createdAt: null,
          });

          // EKS cluster → node group (contains)
          const edgeId = `${eksNodeId}--contains--${ngNodeId}`;
          if (!edges.some((e) => e.id === edgeId)) {
            edges.push({
              id: edgeId,
              sourceNodeId: eksNodeId,
              targetNodeId: ngNodeId,
              relationshipType: "contains",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: {},
            });
          }
        }
      } catch {
        // Node group discovery is best-effort
      }

      // Discover Fargate Profiles
      try {
        const fargateProfiles = await m.listEKSFargateProfiles({ clusterName: eks.name });
        for (const fp of fargateProfiles) {
          if (!fp.fargateProfileName) continue;

          const fpNodeId = buildAwsNodeId(
            ctx.accountId,
            "us-east-1",
            "custom",
            `eks-fp-${eks.name}-${fp.fargateProfileName}`,
          );

          nodes.push({
            id: fpNodeId,
            name: fp.fargateProfileName,
            resourceType: "custom",
            provider: "aws",
            region: "us-east-1",
            account: ctx.accountId,
            nativeId: fp.fargateProfileArn ?? fp.fargateProfileName,
            status: fp.status === "ACTIVE" ? "running" : "stopped",
            tags: {},
            metadata: {
              resourceSubtype: "eks-fargate-profile",
              selectors: fp.selectors,
              discoverySource: "container-manager",
            },
            costMonthly: 0,
            owner: null,
            createdAt: null,
          });

          // EKS cluster → Fargate profile (contains)
          const edgeId = `${eksNodeId}--contains--${fpNodeId}`;
          if (!edges.some((e) => e.id === edgeId)) {
            edges.push({
              id: edgeId,
              sourceNodeId: eksNodeId,
              targetNodeId: fpNodeId,
              relationshipType: "contains",
              confidence: 0.95,
              discoveredVia: "api-field",
              metadata: {},
            });
          }
        }
      } catch {
        // Fargate profile discovery is best-effort
      }
    }
  } catch {
    // EKS discovery is best-effort
  }

  // --- ECR Repositories ---
  try {
    const repos = await m.listECRRepositories({ maxResults: 100 });
    for (const repo of repos) {
      if (!repo.repositoryName) continue;

      const repoNodeId = buildAwsNodeId(
        ctx.accountId,
        "us-east-1",
        "custom",
        `ecr-${repo.repositoryName}`,
      );

      nodes.push({
        id: repoNodeId,
        name: repo.repositoryName,
        resourceType: "custom",
        provider: "aws",
        region: "us-east-1",
        account: ctx.accountId,
        nativeId: repo.repositoryArn ?? repo.repositoryName,
        status: "running",
        tags: {},
        metadata: {
          resourceSubtype: "ecr-repository",
          repositoryUri: repo.repositoryUri,
          imageTagMutability: repo.imageTagMutability,
          scanOnPush: repo.imageScanningConfiguration?.scanOnPush,
          encryptionType: repo.encryptionConfiguration?.encryptionType,
          discoverySource: "container-manager",
        },
        costMonthly: 0.10, // ~$0.10/GB/month for ECR storage
        owner: null,
        createdAt: repo.createdAt ?? null,
      });
    }
  } catch {
    // ECR discovery is best-effort
  }
}
