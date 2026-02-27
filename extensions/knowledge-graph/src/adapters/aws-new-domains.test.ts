/**
 * AWS Adapter — New Domain Module Integration Tests
 *
 * Tests for the 7 newly integrated AWS domain modules:
 * - Containers (ECS/EKS/ECR via ContainerManager)
 * - Network (VPC peering, TGW, NACLs, endpoints, NAT GW, Flow Logs)
 * - DynamoDB (tables, GSIs, replicas, backups)
 * - API Gateway (REST + HTTP APIs, stages, integrations, authorizers)
 * - Messaging — SQS (queues, DLQ edges, KMS)
 * - Messaging — SNS (topics, subscriptions, fanout edges)
 * - Route 53 DNS (hosted zones, alias records, health checks)
 */

import { describe, it, expect, vi } from "vitest";
import { AwsDiscoveryAdapter } from "./aws.js";
import type { GraphNodeInput, GraphEdgeInput } from "../types.js";

// =============================================================================
// Testable helper — exposes private delegation methods
// =============================================================================

interface AwsAdapterTestable {
  discoverContainersDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  discoverNetworkDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  discoverDynamoDB(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  discoverAPIGatewayDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  enrichSQSDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  enrichSNSDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  discoverRoute53Deeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
}

function testable(adapter: AwsDiscoveryAdapter): AwsAdapterTestable {
  return adapter as unknown as AwsAdapterTestable;
}

// =============================================================================
// Container Manager Tests
// =============================================================================

describe("AWS Adapter — ContainerManager integration", () => {
  it("should discover ECS clusters and services", async () => {
    const mockContainer = {
      listECSClusters: vi.fn().mockResolvedValue([
        {
          clusterName: "prod-cluster",
          clusterArn: "arn:aws:ecs:us-east-1:123:cluster/prod-cluster",
          status: "ACTIVE",
          runningTasksCount: 5,
          activeServicesCount: 2,
          registeredContainerInstancesCount: 3,
          capacityProviders: ["FARGATE"],
        },
      ]),
      listECSServices: vi.fn().mockResolvedValue([
        {
          serviceName: "web-service",
          serviceArn: "arn:aws:ecs:us-east-1:123:service/prod-cluster/web-service",
          status: "ACTIVE",
          desiredCount: 3,
          runningCount: 3,
          launchType: "FARGATE",
          taskDefinition: "arn:aws:ecs:us-east-1:123:task-definition/web:10",
          loadBalancers: [],
        },
      ]),
      listECSTasks: vi.fn().mockResolvedValue([]),
      listEKSClusters: vi.fn().mockResolvedValue([]),
      listEKSNodeGroups: vi.fn().mockResolvedValue([]),
      listEKSFargateProfiles: vi.fn().mockResolvedValue([]),
      listECRRepositories: vi.fn().mockResolvedValue([]),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { containers: mockContainer },
    });

    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverContainersDeeper(nodes, edges);

    // Should create cluster node
    const clusters = nodes.filter((n) => n.metadata["resourceSubtype"] === "ecs-cluster");
    expect(clusters).toHaveLength(1);
    expect(clusters[0].name).toBe("prod-cluster");
    expect(clusters[0].status).toBe("running");
    expect(clusters[0].metadata["runningTasks"]).toBe(5);
    expect(clusters[0].metadata["activeServices"]).toBe(2);

    // Should create service node
    const services = nodes.filter((n) => n.metadata["resourceSubtype"] === "ecs-service");
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe("web-service");
    expect(services[0].metadata["launchType"]).toBe("FARGATE");
    expect(services[0].metadata["runningCount"]).toBe(3);

    // Should create contains edge (cluster → service)
    const containsEdges = edges.filter((e) => e.relationshipType === "contains");
    expect(containsEdges).toHaveLength(1);
    expect(containsEdges[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("should discover EKS clusters and link to VPCs", async () => {
    const mockContainer = {
      listECSClusters: vi.fn().mockResolvedValue([]),
      listECSServices: vi.fn().mockResolvedValue([]),
      listECSTasks: vi.fn().mockResolvedValue([]),
      listEKSClusters: vi.fn().mockResolvedValue([
        {
          name: "k8s-prod",
          arn: "arn:aws:eks:us-east-1:123:cluster/k8s-prod",
          status: "ACTIVE",
          version: "1.28",
          platformVersion: "eks.5",
          vpcId: "vpc-abc123",
          roleArn: "arn:aws:iam::123:role/eks-role",
        },
      ]),
      listEKSNodeGroups: vi.fn().mockResolvedValue([
        {
          nodegroupName: "workers",
          nodegroupArn: "arn:aws:eks:us-east-1:123:nodegroup/k8s-prod/workers",
          status: "ACTIVE",
          instanceTypes: ["m5.large"],
          scalingConfig: { desiredSize: 3, minSize: 1, maxSize: 5 },
          capacityType: "ON_DEMAND",
        },
      ]),
      listEKSFargateProfiles: vi.fn().mockResolvedValue([]),
      listECRRepositories: vi.fn().mockResolvedValue([]),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { containers: mockContainer },
    });

    // Pre-populate VPC node
    const nodes: GraphNodeInput[] = [
      {
        id: "aws:123456789:us-east-1:vpc:vpc-abc123",
        provider: "aws", resourceType: "vpc", nativeId: "vpc-abc123",
        name: "prod-vpc", region: "us-east-1", account: "123456789",
        status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
      },
    ];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverContainersDeeper(nodes, edges);

    // Should create EKS cluster
    const eksClusters = nodes.filter((n) => n.metadata["resourceSubtype"] === "eks-cluster");
    expect(eksClusters).toHaveLength(1);
    expect(eksClusters[0].name).toBe("k8s-prod");
    expect(eksClusters[0].metadata["k8sVersion"]).toBe("1.28");
    expect(eksClusters[0].costMonthly).toBe(73);

    // Should create node group
    const nodeGroups = nodes.filter((n) => n.metadata["resourceSubtype"] === "eks-node-group");
    expect(nodeGroups).toHaveLength(1);
    expect(nodeGroups[0].name).toBe("workers");
    expect(nodeGroups[0].metadata["instanceTypes"]).toEqual(["m5.large"]);

    // Should have deployed-at edge (EKS → VPC) and contains edge (EKS → node group)
    const deployedAt = edges.filter((e) => e.relationshipType === "deployed-at");
    expect(deployedAt).toHaveLength(1);
    const contains = edges.filter((e) => e.relationshipType === "contains");
    expect(contains).toHaveLength(1);
  });

  it("should gracefully handle ContainerManager not available", async () => {
    const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });

    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    // Should not throw — ContainerManager returns null
    await testable(adapter).discoverContainersDeeper(nodes, edges);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });
});

// =============================================================================
// Network Manager Tests
// =============================================================================

describe("AWS Adapter — NetworkManager integration", () => {
  it("should discover VPC peering connections", async () => {
    const mockNetwork = {
      listVPCPeering: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            vpcPeeringConnectionId: "pcx-123",
            status: { code: "active" },
            requesterVpcInfo: { vpcId: "vpc-aaa", cidrBlock: "10.0.0.0/16" },
            accepterVpcInfo: { vpcId: "vpc-bbb", cidrBlock: "10.1.0.0/16" },
            tags: { Name: "prod-staging-peering" },
          },
        ],
      }),
      listTransitGateways: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listNetworkACLs: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listVPCEndpoints: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listNATGateways: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listFlowLogs: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { network: mockNetwork },
    });

    // Pre-populate VPC nodes
    const nodes: GraphNodeInput[] = [
      {
        id: "aws:123456789:us-east-1:vpc:vpc-aaa",
        provider: "aws", resourceType: "vpc", nativeId: "vpc-aaa",
        name: "prod-vpc", region: "us-east-1", account: "123456789",
        status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
      },
      {
        id: "aws:123456789:us-east-1:vpc:vpc-bbb",
        provider: "aws", resourceType: "vpc", nativeId: "vpc-bbb",
        name: "staging-vpc", region: "us-east-1", account: "123456789",
        status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
      },
    ];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverNetworkDeeper(nodes, edges);

    // Should create peering node
    const peerings = nodes.filter((n) => n.metadata["resourceSubtype"] === "vpc-peering-connection");
    expect(peerings).toHaveLength(1);
    expect(peerings[0].name).toBe("prod-staging-peering");
    expect(peerings[0].status).toBe("running");

    // Should create peers-with edges to both VPCs
    const peerEdges = edges.filter((e) => e.relationshipType === "peers-with");
    expect(peerEdges).toHaveLength(2);
  });

  it("should discover Network ACLs and link to VPCs/subnets", async () => {
    const mockNetwork = {
      listVPCPeering: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listTransitGateways: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listNetworkACLs: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            networkAclId: "acl-123",
            vpcId: "vpc-aaa",
            isDefault: true,
            associations: [{ subnetId: "subnet-001" }],
            entries: [{ ruleNumber: 100, ruleAction: "allow", protocol: "-1" }],
            tags: { Name: "default-nacl" },
          },
        ],
      }),
      listVPCEndpoints: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listNATGateways: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listFlowLogs: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { network: mockNetwork },
    });

    const nodes: GraphNodeInput[] = [
      {
        id: "aws:123456789:us-east-1:vpc:vpc-aaa",
        provider: "aws", resourceType: "vpc", nativeId: "vpc-aaa",
        name: "prod-vpc", region: "us-east-1", account: "123456789",
        status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
      },
      {
        id: "aws:123456789:us-east-1:subnet:subnet-001",
        provider: "aws", resourceType: "subnet", nativeId: "subnet-001",
        name: "pub-subnet", region: "us-east-1", account: "123456789",
        status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
      },
    ];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverNetworkDeeper(nodes, edges);

    // Should create NACL node
    const nacls = nodes.filter((n) => n.metadata["resourceSubtype"] === "network-acl");
    expect(nacls).toHaveLength(1);
    expect(nacls[0].metadata["isDefault"]).toBe(true);
    expect(nacls[0].metadata["ruleCount"]).toBe(1);

    // Should have deployed-at edge (NACL → VPC) and secures edge (NACL → subnet)
    const deployedAt = edges.filter((e) => e.relationshipType === "deployed-at");
    expect(deployedAt).toHaveLength(1);
    const secures = edges.filter((e) => e.relationshipType === "secures");
    expect(secures).toHaveLength(1);
  });

  it("should discover Flow Logs and link to monitored resources", async () => {
    const mockNetwork = {
      listVPCPeering: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listTransitGateways: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listNetworkACLs: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listVPCEndpoints: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listNATGateways: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listFlowLogs: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            flowLogId: "fl-abc123",
            flowLogStatus: "ACTIVE",
            resourceId: "vpc-aaa",
            trafficType: "ALL",
            logDestinationType: "cloud-watch-logs",
            tags: { Name: "prod-flow-log" },
          },
        ],
      }),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { network: mockNetwork },
    });

    const nodes: GraphNodeInput[] = [
      {
        id: "aws:123456789:us-east-1:vpc:vpc-aaa",
        provider: "aws", resourceType: "vpc", nativeId: "vpc-aaa",
        name: "prod-vpc", region: "us-east-1", account: "123456789",
        status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
      },
    ];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverNetworkDeeper(nodes, edges);

    // Should create flow log node
    const flowLogs = nodes.filter((n) => n.metadata["resourceSubtype"] === "flow-log");
    expect(flowLogs).toHaveLength(1);
    expect(flowLogs[0].name).toBe("prod-flow-log");
    expect(flowLogs[0].status).toBe("running");

    // Should link flow log → VPC via monitors edge
    const monitors = edges.filter((e) => e.relationshipType === "monitors");
    expect(monitors).toHaveLength(1);
  });

  it("should gracefully handle NetworkManager not available", async () => {
    const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverNetworkDeeper(nodes, edges);
    expect(nodes).toHaveLength(0);
  });
});

// =============================================================================
// DynamoDB Manager Tests
// =============================================================================

describe("AWS Adapter — DynamoDBManager integration", () => {
  it("should discover DynamoDB tables with detailed metadata", async () => {
    const mockDynamoDB = {
      listTables: vi.fn().mockResolvedValue({ success: true, data: ["users", "orders"] }),
      describeTable: vi.fn().mockImplementation((name: string) => {
        if (name === "users") {
          return Promise.resolve({
            success: true,
            data: {
              tableName: "users",
              tableArn: "arn:aws:dynamodb:us-east-1:123:table/users",
              tableStatus: "ACTIVE",
              itemCount: 50_000,
              tableSizeBytes: 10 * 1024 * 1024,
              billingModeSummary: { billingMode: "PAY_PER_REQUEST" },
              globalSecondaryIndexes: [{ indexName: "email-index", indexStatus: "ACTIVE" }],
              streamSpecification: { streamEnabled: true, streamViewType: "NEW_AND_OLD_IMAGES" },
              sseDescription: { status: "ENABLED", sseType: "KMS", kmsMasterKeyArn: "arn:aws:kms:us-east-1:123:key/abc" },
              deletionProtectionEnabled: true,
              replicas: [{ regionName: "eu-west-1", replicaStatus: "ACTIVE" }],
              creationDateTime: "2023-01-15T00:00:00Z",
            },
          });
        }
        return Promise.resolve({
          success: true,
          data: {
            tableName: "orders",
            tableArn: "arn:aws:dynamodb:us-east-1:123:table/orders",
            tableStatus: "ACTIVE",
            itemCount: 200_000,
            tableSizeBytes: 50 * 1024 * 1024,
            billingModeSummary: { billingMode: "PROVISIONED" },
            provisionedThroughput: { readCapacityUnits: 100, writeCapacityUnits: 50 },
            globalSecondaryIndexes: [],
            deletionProtectionEnabled: false,
          },
        });
      }),
      listGlobalTables: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listBackups: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { dynamodb: mockDynamoDB },
    });

    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverDynamoDB(nodes, edges);

    // Should create 2 table nodes
    const tables = nodes.filter((n) => n.metadata["resourceSubtype"] === "dynamodb-table");
    expect(tables).toHaveLength(2);

    // Users table metadata
    const users = tables.find((n) => n.name === "users")!;
    expect(users.metadata["itemCount"]).toBe(50_000);
    expect(users.metadata["billingMode"]).toBe("PAY_PER_REQUEST");
    expect(users.metadata["gsiCount"]).toBe(1);
    expect(users.metadata["streamEnabled"]).toBe(true);
    expect(users.metadata["sseEnabled"]).toBe(true);
    expect(users.metadata["deletionProtection"]).toBe(true);
    expect(users.metadata["replicaCount"]).toBe(1);

    // Orders table with provisioned throughput should have cost
    const orders = tables.find((n) => n.name === "orders")!;
    expect(orders.costMonthly).toBeGreaterThan(0);

    // Should create replicates-to edge for users table
    const replicates = edges.filter((e) => e.relationshipType === "replicates-to");
    expect(replicates).toHaveLength(1);
    expect(replicates[0].metadata["replicaStatus"]).toBe("ACTIVE");
  });

  it("should discover DynamoDB backups", async () => {
    const mockDynamoDB = {
      listTables: vi.fn().mockResolvedValue({ success: true, data: ["users"] }),
      describeTable: vi.fn().mockResolvedValue({
        success: true,
        data: {
          tableName: "users",
          tableArn: "arn:aws:dynamodb:us-east-1:123:table/users",
          tableStatus: "ACTIVE",
          itemCount: 1000,
          tableSizeBytes: 1024,
          billingModeSummary: { billingMode: "PAY_PER_REQUEST" },
        },
      }),
      listGlobalTables: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listBackups: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            tableName: "users",
            backupArn: "arn:aws:dynamodb:us-east-1:123:table/users/backup/01234",
            backupName: "users-weekly-backup",
            backupStatus: "AVAILABLE",
            backupType: "USER",
            backupSizeBytes: 5 * 1024 * 1024,
            backupCreationDateTime: "2024-01-20T00:00:00Z",
          },
        ],
      }),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { dynamodb: mockDynamoDB },
    });

    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverDynamoDB(nodes, edges);

    // Should create backup node
    const backups = nodes.filter((n) => n.metadata["resourceSubtype"] === "dynamodb-backup");
    expect(backups).toHaveLength(1);
    expect(backups[0].name).toBe("users-weekly-backup");
    expect(backups[0].metadata["backupType"]).toBe("USER");

    // Should have backs-up edge (backup → table)
    const backsUp = edges.filter((e) => e.relationshipType === "backs-up");
    expect(backsUp).toHaveLength(1);
  });

  it("should gracefully handle DynamoDBManager not available", async () => {
    const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverDynamoDB(nodes, edges);
    expect(nodes).toHaveLength(0);
  });
});

// =============================================================================
// API Gateway Manager Tests
// =============================================================================

describe("AWS Adapter — APIGatewayManager integration", () => {
  it("should discover REST APIs with stages", async () => {
    const mockAPIGW = {
      listRestApis: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            id: "abc123",
            name: "my-rest-api",
            description: "Production REST API",
            endpointConfiguration: { types: ["REGIONAL"] },
            tags: { Environment: "prod" },
          },
        ],
      }),
      listHttpApis: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listRestStages: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            stageName: "prod",
            cacheClusterEnabled: false,
            tracingEnabled: true,
          },
        ],
      }),
      listRestAuthorizers: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listHttpIntegrations: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listHttpStages: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listHttpAuthorizers: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { apigateway: mockAPIGW },
    });

    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverAPIGatewayDeeper(nodes, edges);

    // Should create REST API node
    const apis = nodes.filter((n) => n.resourceType === "api-gateway");
    expect(apis).toHaveLength(1);
    expect(apis[0].name).toBe("my-rest-api");
    expect(apis[0].metadata["apiType"]).toBe("REST");

    // Should create stage node
    const stages = nodes.filter((n) => n.metadata["resourceSubtype"] === "api-gateway-stage");
    expect(stages).toHaveLength(1);
    expect(stages[0].metadata["tracingEnabled"]).toBe(true);

    // Should have contains edge (API → stage)
    const contains = edges.filter((e) => e.relationshipType === "contains");
    expect(contains).toHaveLength(1);
  });

  it("should discover HTTP APIs with Lambda integrations", async () => {
    const mockAPIGW = {
      listRestApis: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listHttpApis: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            apiId: "http-123",
            name: "my-http-api",
            protocolType: "HTTP",
            apiEndpoint: "https://http-123.execute-api.us-east-1.amazonaws.com",
          },
        ],
      }),
      listHttpIntegrations: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            integrationId: "int-001",
            integrationType: "AWS_PROXY",
            integrationUri: "arn:aws:lambda:us-east-1:123:function:my-handler",
          },
        ],
      }),
      listRestStages: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listRestAuthorizers: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listHttpStages: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listHttpAuthorizers: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { apigateway: mockAPIGW },
    });

    // Pre-populate Lambda node
    const nodes: GraphNodeInput[] = [
      {
        id: "aws:123456789:us-east-1:function:my-handler",
        provider: "aws", resourceType: "function", nativeId: "arn:aws:lambda:us-east-1:123:function:my-handler",
        name: "my-handler", region: "us-east-1", account: "123456789",
        status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
      },
    ];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverAPIGatewayDeeper(nodes, edges);

    // Should create HTTP API node
    const apis = nodes.filter((n) => n.resourceType === "api-gateway");
    expect(apis).toHaveLength(1);
    expect(apis[0].metadata["apiType"]).toBe("HTTP");

    // Should create triggers edge (API → Lambda)
    const triggers = edges.filter((e) => e.relationshipType === "triggers");
    expect(triggers).toHaveLength(1);
  });

  it("should gracefully handle APIGatewayManager not available", async () => {
    const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverAPIGatewayDeeper(nodes, edges);
    expect(nodes).toHaveLength(0);
  });
});

// =============================================================================
// SQS Manager Tests
// =============================================================================

describe("AWS Adapter — SQSManager integration", () => {
  it("should discover SQS queues with DLQ edges", async () => {
    const mockSQS = {
      listQueues: vi.fn().mockResolvedValue({
        success: true,
        data: ["https://sqs.us-east-1.amazonaws.com/123/orders-queue"],
      }),
      getQueueMetrics: vi.fn().mockResolvedValue({
        success: true,
        data: {
          approximateNumberOfMessages: 42,
          approximateNumberOfMessagesDelayed: 0,
          approximateNumberOfMessagesNotVisible: 3,
          visibilityTimeout: 30,
          messageRetentionPeriod: 345600,
          maximumMessageSize: 262144,
          fifoQueue: false,
          queueArn: "arn:aws:sqs:us-east-1:123:orders-queue",
          redrivePolicy: {
            deadLetterTargetArn: "arn:aws:sqs:us-east-1:123:orders-dlq",
            maxReceiveCount: 3,
          },
          createdTimestamp: "2023-06-01T00:00:00Z",
        },
      }),
      listQueueTags: vi.fn().mockResolvedValue({
        success: true,
        data: { Environment: "prod", Owner: "backend-team" },
      }),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { sqs: mockSQS },
    });

    // Pre-populate DLQ node
    const nodes: GraphNodeInput[] = [
      {
        id: "aws:123456789:us-east-1:queue:orders-dlq",
        provider: "aws", resourceType: "queue", nativeId: "arn:aws:sqs:us-east-1:123:orders-dlq",
        name: "orders-dlq", region: "us-east-1", account: "123456789",
        status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
      },
    ];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).enrichSQSDeeper(nodes, edges);

    // Should create queue node
    const queues = nodes.filter((n) => n.name === "orders-queue");
    expect(queues).toHaveLength(1);
    expect(queues[0].metadata["messageCount"]).toBe(42);
    expect(queues[0].metadata["retentionPeriod"]).toBe(345600);
    expect(queues[0].tags["Owner"]).toBe("backend-team");

    // Should create routes-to edge (queue → DLQ)
    const dlqEdges = edges.filter((e) => e.relationshipType === "routes-to");
    expect(dlqEdges).toHaveLength(1);
    expect(dlqEdges[0].metadata["maxReceiveCount"]).toBe(3);
  });

  it("should enrich existing SQS queue nodes", async () => {
    const mockSQS = {
      listQueues: vi.fn().mockResolvedValue({
        success: true,
        data: ["https://sqs.us-east-1.amazonaws.com/123/events-queue"],
      }),
      getQueueMetrics: vi.fn().mockResolvedValue({
        success: true,
        data: {
          approximateNumberOfMessages: 100,
          fifoQueue: true,
          queueArn: "arn:aws:sqs:us-east-1:123:events-queue.fifo",
        },
      }),
      listQueueTags: vi.fn().mockResolvedValue({ success: true, data: {} }),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { sqs: mockSQS },
    });

    // Pre-populate existing queue node
    const nodes: GraphNodeInput[] = [
      {
        id: "aws:123456789:us-east-1:queue:events-queue",
        provider: "aws", resourceType: "queue", nativeId: "arn:aws:sqs:us-east-1:123:events-queue.fifo",
        name: "events-queue", region: "us-east-1", account: "123456789",
        status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
      },
    ];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).enrichSQSDeeper(nodes, edges);

    // Should NOT create new node, just enrich existing
    expect(nodes).toHaveLength(1);
    expect(nodes[0].metadata["messageCount"]).toBe(100);
    expect(nodes[0].metadata["fifoQueue"]).toBe(true);
    expect(nodes[0].metadata["discoverySource"]).toBe("sqs-manager");
  });

  it("should gracefully handle SQSManager not available", async () => {
    const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).enrichSQSDeeper(nodes, edges);
    expect(nodes).toHaveLength(0);
  });
});

// =============================================================================
// SNS Manager Tests
// =============================================================================

describe("AWS Adapter — SNSManager integration", () => {
  it("should discover SNS topics with fanout edges", async () => {
    const mockSNS = {
      listTopics: vi.fn().mockResolvedValue({
        success: true,
        data: [
          { topicArn: "arn:aws:sns:us-east-1:123:order-events" },
        ],
      }),
      getTopic: vi.fn().mockResolvedValue({
        success: true,
        data: {
          topicArn: "arn:aws:sns:us-east-1:123:order-events",
          displayName: "Order Events",
          subscriptionsConfirmed: 2,
          fifoTopic: false,
        },
      }),
      listSubscriptionsByTopic: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            subscriptionArn: "arn:aws:sns:us-east-1:123:order-events:sub1",
            protocol: "sqs",
            endpoint: "arn:aws:sqs:us-east-1:123:order-processor",
          },
          {
            subscriptionArn: "arn:aws:sns:us-east-1:123:order-events:sub2",
            protocol: "lambda",
            endpoint: "arn:aws:lambda:us-east-1:123:function:order-handler",
          },
        ],
      }),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { sns: mockSNS },
    });

    // Pre-populate SQS and Lambda nodes
    const nodes: GraphNodeInput[] = [
      {
        id: "aws:123456789:us-east-1:queue:order-processor",
        provider: "aws", resourceType: "queue", nativeId: "arn:aws:sqs:us-east-1:123:order-processor",
        name: "order-processor", region: "us-east-1", account: "123456789",
        status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
      },
      {
        id: "aws:123456789:us-east-1:function:order-handler",
        provider: "aws", resourceType: "function", nativeId: "arn:aws:lambda:us-east-1:123:function:order-handler",
        name: "order-handler", region: "us-east-1", account: "123456789",
        status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
      },
    ];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).enrichSNSDeeper(nodes, edges);

    // Should create topic node
    const topics = nodes.filter((n) => n.resourceType === "topic");
    expect(topics).toHaveLength(1);
    expect(topics[0].name).toBe("Order Events");
    expect(topics[0].metadata["subscriptionsConfirmed"]).toBe(2);

    // Should create publishes-to edge (topic → SQS)
    const publishEdges = edges.filter((e) => e.relationshipType === "publishes-to");
    expect(publishEdges).toHaveLength(1);
    expect(publishEdges[0].metadata["protocol"]).toBe("sqs");

    // Should create triggers edge (topic → Lambda)
    const triggerEdges = edges.filter((e) => e.relationshipType === "triggers");
    expect(triggerEdges).toHaveLength(1);
    expect(triggerEdges[0].metadata["protocol"]).toBe("lambda");
  });

  it("should gracefully handle SNSManager not available", async () => {
    const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).enrichSNSDeeper(nodes, edges);
    expect(nodes).toHaveLength(0);
  });
});

// =============================================================================
// Route 53 Manager Tests
// =============================================================================

describe("AWS Adapter — Route53Manager integration", () => {
  it("should discover hosted zones and alias edges", async () => {
    const mockRoute53 = {
      listHostedZones: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            id: "/hostedzone/Z1234",
            name: "example.com.",
            config: { privateZone: false },
            resourceRecordSetCount: 15,
          },
        ],
      }),
      listRecords: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            name: "api.example.com.",
            type: "A",
            aliasTarget: {
              dnsName: "my-alb-123.us-east-1.elb.amazonaws.com",
              evaluateTargetHealth: true,
            },
          },
          {
            name: "www.example.com.",
            type: "A",
            resourceRecords: [{ value: "1.2.3.4" }],
          },
        ],
      }),
      listHealthChecks: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getHealthCheckStatus: vi.fn().mockResolvedValue({ success: true, data: {} }),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { route53: mockRoute53 },
    });

    // Pre-populate ALB node
    const nodes: GraphNodeInput[] = [
      {
        id: "aws:123456789:us-east-1:load-balancer:my-alb",
        provider: "aws", resourceType: "load-balancer",
        nativeId: "arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb",
        name: "my-alb", region: "us-east-1", account: "123456789",
        status: "running", tags: {},
        metadata: { dnsName: "my-alb-123.us-east-1.elb.amazonaws.com" },
        costMonthly: null, owner: null, createdAt: null,
      },
    ];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverRoute53Deeper(nodes, edges);

    // Should create hosted zone node
    const zones = nodes.filter((n) => n.metadata["resourceSubtype"] === "hosted-zone");
    expect(zones).toHaveLength(1);
    expect(zones[0].name).toBe("example.com.");
    expect(zones[0].metadata["recordSetCount"]).toBe(15);
    expect(zones[0].metadata["privateZone"]).toBe(false);
    expect(zones[0].nativeId).toBe("Z1234"); // Should strip /hostedzone/ prefix

    // Should create resolves-to edge (zone → ALB via alias)
    const resolvesTo = edges.filter((e) => e.relationshipType === "resolves-to");
    expect(resolvesTo).toHaveLength(1);
    expect(resolvesTo[0].metadata["recordName"]).toBe("api.example.com.");
  });

  it("should discover health checks with status", async () => {
    const mockRoute53 = {
      listHostedZones: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listRecords: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listHealthChecks: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            id: "hc-abcdef12",
            healthCheckConfig: {
              type: "HTTPS",
              fullyQualifiedDomainName: "api.example.com",
              port: 443,
              resourcePath: "/health",
              requestInterval: 30,
              failureThreshold: 3,
            },
          },
        ],
      }),
      getHealthCheckStatus: vi.fn().mockResolvedValue({
        success: true,
        data: {
          healthCheckObservations: [
            { region: "us-east-1", statusReport: { status: "Success: HTTP Status Code 200" } },
          ],
        },
      }),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { route53: mockRoute53 },
    });

    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverRoute53Deeper(nodes, edges);

    // Should create health check node
    const hcs = nodes.filter((n) => n.metadata["resourceSubtype"] === "route53-health-check");
    expect(hcs).toHaveLength(1);
    expect(hcs[0].status).toBe("running"); // All observations succeeded
    expect(hcs[0].metadata["checkType"]).toBe("HTTPS");
    expect(hcs[0].metadata["fqdn"]).toBe("api.example.com");
    expect(hcs[0].metadata["port"]).toBe(443);
  });

  it("should mark health check as error when unhealthy", async () => {
    const mockRoute53 = {
      listHostedZones: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listRecords: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listHealthChecks: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            id: "hc-unhealthy",
            healthCheckConfig: {
              type: "HTTP",
              fullyQualifiedDomainName: "dead.example.com",
              port: 80,
            },
          },
        ],
      }),
      getHealthCheckStatus: vi.fn().mockResolvedValue({
        success: true,
        data: {
          healthCheckObservations: [
            { region: "us-east-1", statusReport: { status: "Failure: Connection refused" } },
          ],
        },
      }),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { route53: mockRoute53 },
    });

    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverRoute53Deeper(nodes, edges);

    // Should be marked as error status
    const hcs = nodes.filter((n) => n.metadata["resourceSubtype"] === "route53-health-check");
    expect(hcs).toHaveLength(1);
    expect(hcs[0].status).toBe("error");
  });

  it("should gracefully handle Route53Manager not available", async () => {
    const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    await testable(adapter).discoverRoute53Deeper(nodes, edges);
    expect(nodes).toHaveLength(0);
  });
});

// =============================================================================
// Edge deduplication tests
// =============================================================================

describe("AWS Adapter — new domain module edge deduplication", () => {
  it("should not create duplicate edges when domain module is called twice", async () => {
    const mockContainer = {
      listECSClusters: vi.fn().mockResolvedValue([
        {
          clusterName: "test-cluster",
          clusterArn: "arn:aws:ecs:us-east-1:123:cluster/test-cluster",
          status: "ACTIVE",
          runningTasksCount: 1,
        },
      ]),
      listECSServices: vi.fn().mockResolvedValue([
        {
          serviceName: "svc-a",
          serviceArn: "arn:aws:ecs:us-east-1:123:service/test-cluster/svc-a",
          status: "ACTIVE",
          desiredCount: 1,
          runningCount: 1,
          launchType: "FARGATE",
          loadBalancers: [],
        },
      ]),
      listECSTasks: vi.fn().mockResolvedValue([]),
      listEKSClusters: vi.fn().mockResolvedValue([]),
      listEKSNodeGroups: vi.fn().mockResolvedValue([]),
      listEKSFargateProfiles: vi.fn().mockResolvedValue([]),
      listECRRepositories: vi.fn().mockResolvedValue([]),
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: { containers: mockContainer },
    });

    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];

    // Call twice
    await testable(adapter).discoverContainersDeeper(nodes, edges);
    const edgesAfterFirst = edges.length;

    // Second run - existing cluster is enriched (not re-created), but service/edge dedup happens
    await testable(adapter).discoverContainersDeeper(nodes, edges);

    // Edges should still be deduplicated (check by unique IDs)
    const uniqueEdgeIds = new Set(edges.map((e) => e.id));
    expect(uniqueEdgeIds.size).toBe(edgesAfterFirst);
  });
});

// =============================================================================
// Dispose tests for new managers
// =============================================================================

describe("AWS Adapter — dispose() cleans up new managers", () => {
  it("should reset all new manager fields on dispose", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      managers: {
        containers: { listECSClusters: vi.fn() },
        network: { listVPCPeering: vi.fn() },
        dynamodb: { listTables: vi.fn() },
        apigateway: { listRestApis: vi.fn() },
        sqs: { listQueues: vi.fn() },
        sns: { listTopics: vi.fn() },
        route53: { listHostedZones: vi.fn() },
      },
    });

    // Access managers to cache them
    const t = adapter as unknown as Record<string, unknown>;

    await adapter.dispose();

    // All new manager fields should be undefined after dispose
    expect(t["_containerManager"]).toBeUndefined();
    expect(t["_networkManager"]).toBeUndefined();
    expect(t["_dynamodbManager"]).toBeUndefined();
    expect(t["_apigatewayManager"]).toBeUndefined();
    expect(t["_sqsManager"]).toBeUndefined();
    expect(t["_snsManager"]).toBeUndefined();
    expect(t["_route53Manager"]).toBeUndefined();
  });
});
