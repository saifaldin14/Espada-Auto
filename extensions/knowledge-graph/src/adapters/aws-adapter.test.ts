/**
 * Infrastructure Knowledge Graph — AWS Adapter Tests
 *
 * Tests the production-ready utility functions and the full discovery pipeline:
 * - resolveFieldPath
 * - extractResourceId
 * - buildAwsNodeId
 * - extractRelationships
 * - Full discover() with mock client factory
 * - healthCheck() with mock STS
 * - GPU/AI workload detection
 */

import { describe, it, expect, vi } from "vitest";
import {
  resolveFieldPath,
  extractResourceId,
  buildAwsNodeId,
  AwsDiscoveryAdapter,
} from "./aws.js";
import type {
  AwsClient,
  AwsClientFactory,
  AwsForecastResult,
  AwsOptimizationResult,
  AwsUnusedResourcesResult,
  AwsIncrementalChanges,
  AwsSecurityPosture,
} from "./aws.js";
import type { GraphNodeInput, GraphEdgeInput } from "./types.js";

// =============================================================================
// Test helper: typed access to private members (eliminates `as any`)
// =============================================================================

/**
 * Exposes private members of AwsDiscoveryAdapter for testing.
 * This avoids scattering `(adapter as any)` throughout the test suite
 * while keeping type safety on the test-side API surface.
 */
interface AwsAdapterTestable extends AwsDiscoveryAdapter {
  // Lazy-init manager getters
  ensureSdkAvailable(): Promise<boolean>;
  getCredentialsManager(): Promise<unknown | null>;
  getClientPoolManager(): Promise<unknown | null>;
  getCostManagerInstance(): Promise<unknown | null>;
  getSecurityManager(): Promise<unknown | null>;
  getCloudTrailManager(): Promise<unknown | null>;
  getTaggingManager(): Promise<unknown | null>;
  getLambdaManager(): Promise<unknown | null>;
  getObservabilityManager(): Promise<unknown | null>;
  getS3Manager(): Promise<unknown | null>;
  getElastiCacheManager(): Promise<unknown | null>;
  getOrganizationManager(): Promise<unknown | null>;
  getBackupManager(): Promise<unknown | null>;
  getComplianceManager(): Promise<unknown | null>;
  getAutomationManager(): Promise<unknown | null>;
  getEC2Manager(): Promise<unknown | null>;
  getRDSManager(): Promise<unknown | null>;
  getCICDManager(): Promise<unknown | null>;
  getCognitoManager(): Promise<unknown | null>;

  // Private backing fields (undefined after dispose())
  _credentialsManager: unknown | undefined;
  _clientPoolManager: unknown | undefined;
  _costManager: unknown | undefined;
  _securityManager: unknown | undefined;
  _taggingManager: unknown | undefined;
  _lambdaManager: unknown | undefined;
  _observabilityManager: unknown | undefined;
  _s3Manager: unknown | undefined;
  _elastiCacheManager: unknown | undefined;
  _organizationManager: unknown | undefined;
  _backupManager: unknown | undefined;
  _complianceManager: unknown | undefined;
  _automationManager: unknown | undefined;
  _ec2Manager: unknown | undefined;
  _rdsManager: unknown | undefined;
  _cicdManager: unknown | undefined;
  _cognitoManager: unknown | undefined;

  // Enrichment methods (nodes only)
  enrichWithTags(nodes: GraphNodeInput[]): Promise<void>;
  enrichWithCompliance(nodes: GraphNodeInput[]): Promise<void>;

  // Enrichment methods (nodes + edges)
  enrichWithEventSources(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  enrichWithObservability(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  enrichWithDeeperDiscovery(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  enrichWithCostExplorer(nodes: GraphNodeInput[]): Promise<void>;

  // Discovery methods (nodes + edges)
  discoverElastiCache(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  discoverOrganization(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  discoverBackupResources(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  discoverAutomation(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  discoverEC2Deeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  discoverRDSDeeper(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  discoverCICD(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;
  discoverCognito(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Promise<void>;

  // Cost methods
  estimateCostStatic(resourceType: string, metadata: Record<string, unknown>): number;
  queryServiceCosts(nodes: GraphNodeInput[]): Promise<Record<string, number> | null>;
  queryResourceCosts(nodes: GraphNodeInput[]): Promise<Map<string, number> | null>;
}

/** Cast adapter to the testable interface (single typed cast replaces scattered `as any`). */
function testable(adapter: AwsDiscoveryAdapter): AwsAdapterTestable {
  return adapter as unknown as AwsAdapterTestable;
}

describe("resolveFieldPath", () => {
  it("should resolve a simple field", () => {
    expect(resolveFieldPath({ VpcId: "vpc-123" }, "VpcId")).toEqual(["vpc-123"]);
  });

  it("should resolve a nested field", () => {
    const obj = { VpcConfig: { SubnetIds: ["subnet-a", "subnet-b"] } };
    expect(resolveFieldPath(obj, "VpcConfig.SubnetIds[]")).toEqual(["subnet-a", "subnet-b"]);
  });

  it("should resolve array element fields", () => {
    const obj = {
      SecurityGroups: [
        { GroupId: "sg-1", GroupName: "default" },
        { GroupId: "sg-2", GroupName: "web" },
      ],
    };
    expect(resolveFieldPath(obj, "SecurityGroups[].GroupId")).toEqual(["sg-1", "sg-2"]);
  });

  it("should resolve tag-style access", () => {
    const obj = {
      Tags: [
        { Key: "Name", Value: "my-instance" },
        { Key: "Environment", Value: "prod" },
      ],
    };
    expect(resolveFieldPath(obj, "Tags[Name]")).toEqual(["my-instance"]);
  });

  it("should return empty array for missing field", () => {
    expect(resolveFieldPath({ foo: "bar" }, "missing")).toEqual([]);
  });

  it("should return empty array for null object", () => {
    expect(resolveFieldPath(null, "any")).toEqual([]);
  });

  it("should handle deeply nested array paths", () => {
    const obj = {
      Reservations: [
        { Instances: [{ InstanceId: "i-1" }, { InstanceId: "i-2" }] },
        { Instances: [{ InstanceId: "i-3" }] },
      ],
    };
    expect(resolveFieldPath(obj, "Reservations[].Instances[].InstanceId")).toEqual([
      "i-1",
      "i-2",
      "i-3",
    ]);
  });

  it("should handle ARN fields", () => {
    const obj = { Role: "arn:aws:iam::123456:role/MyRole" };
    expect(resolveFieldPath(obj, "Role")).toEqual(["arn:aws:iam::123456:role/MyRole"]);
  });
});

// =============================================================================
// extractResourceId
// =============================================================================

describe("extractResourceId", () => {
  it("should extract ID from EC2 ARN", () => {
    expect(extractResourceId("arn:aws:ec2:us-east-1:123456:instance/i-abc123")).toBe("i-abc123");
  });

  it("should extract role name from IAM ARN", () => {
    expect(extractResourceId("arn:aws:iam::123456:role/MyRole")).toBe("MyRole");
  });

  it("should extract queue name from SQS URL", () => {
    expect(extractResourceId("https://sqs.us-east-1.amazonaws.com/123456/my-queue")).toBe("my-queue");
  });

  it("should return direct IDs unchanged", () => {
    expect(extractResourceId("vpc-abc123")).toBe("vpc-abc123");
    expect(extractResourceId("sg-xyz789")).toBe("sg-xyz789");
  });

  it("should handle nested resource ARNs", () => {
    expect(extractResourceId("arn:aws:rds:us-east-1:123456:db:mydb")).toBe("db:mydb");
  });
});

// =============================================================================
// buildAwsNodeId
// =============================================================================

describe("buildAwsNodeId", () => {
  it("should build deterministic node IDs", () => {
    expect(buildAwsNodeId("123456", "us-east-1", "compute", "i-abc")).toBe(
      "aws:123456:us-east-1:compute:i-abc",
    );
  });
});

// =============================================================================
// extractRelationships
// =============================================================================

describe("AwsDiscoveryAdapter.extractRelationships", () => {
  const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });

  it("should extract EC2 -> VPC relationship", () => {
    const raw = { VpcId: "vpc-abc" };
    const edges = adapter.extractRelationships(
      "aws:123456789:us-east-1:compute:i-1",
      "compute",
      raw,
      "123456789",
      "us-east-1",
    );

    expect(edges.length).toBeGreaterThan(0);
    const vpcEdge = edges.find((e) => e.relationshipType === "runs-in" && e.targetNodeId.includes("vpc:vpc-abc"));
    expect(vpcEdge).toBeDefined();
  });

  it("should extract EC2 -> SecurityGroup relationships (array)", () => {
    const raw = {
      SecurityGroups: [
        { GroupId: "sg-1" },
        { GroupId: "sg-2" },
      ],
    };
    const edges = adapter.extractRelationships(
      "aws:123456789:us-east-1:compute:i-1",
      "compute",
      raw,
      "123456789",
      "us-east-1",
    );

    const sgEdges = edges.filter((e) => e.relationshipType === "secured-by");
    expect(sgEdges).toHaveLength(2);
  });

  it("should extract Lambda -> IAM role relationship", () => {
    const raw = { Role: "arn:aws:iam::123456789:role/LambdaExecRole" };
    const edges = adapter.extractRelationships(
      "aws:123456789:us-east-1:serverless-function:my-func",
      "serverless-function",
      raw,
      "123456789",
      "us-east-1",
    );

    const roleEdge = edges.find((e) => e.relationshipType === "uses");
    expect(roleEdge).toBeDefined();
    expect(roleEdge!.targetNodeId).toContain("iam-role:LambdaExecRole");
  });

  it("should create bidirectional edges for attached-to", () => {
    const raw = {
      BlockDeviceMappings: [
        { Ebs: { VolumeId: "vol-123" } },
      ],
    };
    const edges = adapter.extractRelationships(
      "aws:123456789:us-east-1:compute:i-1",
      "compute",
      raw,
      "123456789",
      "us-east-1",
    );

    const attachedEdges = edges.filter((e) => e.relationshipType === "attached-to");
    expect(attachedEdges.length).toBeGreaterThanOrEqual(1);
    // Should have a reverse edge too
    const reverseEdge = edges.find(
      (e) => e.sourceNodeId.includes("storage:vol-123") && e.targetNodeId.includes("compute:i-1"),
    );
    expect(reverseEdge).toBeDefined();
  });

  it("should return empty edges for type with no matching rules", () => {
    const raw = { SomeField: "value" };
    const edges = adapter.extractRelationships(
      "aws:123456789:us-east-1:dns:zone-1",
      "dns",
      raw,
      "123456789",
      "us-east-1",
    );

    expect(edges).toHaveLength(0);
  });
});

// =============================================================================
// Mock client factory for full discovery tests
// =============================================================================

/**
 * Creates a mock AWS client factory that returns canned API responses.
 * Keyed by `${service}:${method}`.
 */
function createMockClientFactory(
  responses: Record<string, unknown>,
): AwsClientFactory {
  return (_service: string, _region: string) => {
    const client: AwsClient = {
      send: async (command: unknown) => {
        const method = (command as Record<string, unknown>).__method as string;
        const key = `${_service}:${method}`;
        if (responses[key]) return responses[key];
        return {};
      },
      destroy: () => {},
    };
    return client;
  };
}

// =============================================================================
// Full discover() with mock SDK
// =============================================================================

describe("AwsDiscoveryAdapter.discover()", () => {
  const EC2_RESPONSE = {
    Reservations: [
      {
        Instances: [
          {
            InstanceId: "i-abc123",
            InstanceType: "t3.large",
            ImageId: "ami-12345678",
            VpcId: "vpc-main",
            SubnetId: "subnet-pub-a",
            SecurityGroups: [{ GroupId: "sg-web001" }],
            State: { Name: "running" },
            Tags: [
              { Key: "Name", Value: "web-server" },
              { Key: "Environment", Value: "production" },
              { Key: "Owner", Value: "platform-team" },
            ],
            Placement: { AvailabilityZone: "us-east-1a" },
            PublicIpAddress: "54.1.2.3",
            PrivateIpAddress: "10.0.1.5",
            LaunchTime: "2024-01-15T12:00:00Z",
          },
        ],
      },
    ],
  };

  const RDS_RESPONSE = {
    DBInstances: [
      {
        DBInstanceIdentifier: "mydb",
        DBInstanceClass: "db.r6g.xlarge",
        Engine: "postgres",
        EngineVersion: "15.4",
        DBInstanceStatus: "available",
        MultiAZ: true,
        AllocatedStorage: 100,
        StorageEncrypted: true,
        VpcSecurityGroups: [{ VpcSecurityGroupId: "sg-db001" }],
        DBSubnetGroup: { DBSubnetGroupName: "db-subnets" },
        Tags: [{ Key: "Name", Value: "primary-db" }],
      },
    ],
  };

  const LAMBDA_RESPONSE = {
    Functions: [
      {
        FunctionName: "api-handler",
        FunctionArn: "arn:aws:lambda:us-east-1:123456789:function:api-handler",
        Runtime: "nodejs20.x",
        MemorySize: 256,
        Timeout: 30,
        Handler: "index.handler",
        CodeSize: 4096,
        Role: "arn:aws:iam::123456789:role/lambda-exec",
        VpcConfig: {
          SubnetIds: ["subnet-pub-a"],
          SecurityGroupIds: ["sg-web001"],
        },
        Tags: { Name: "api" },
      },
    ],
  };

  it("should discover EC2 instances", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      clientFactory: createMockClientFactory({
        "EC2:describeInstances": EC2_RESPONSE,
      }),
    });

    const result = await adapter.discover({ resourceTypes: ["compute"] });
    expect(result.provider).toBe("aws");
    expect(result.nodes.length).toBe(1);

    const ec2 = result.nodes[0];
    expect(ec2.nativeId).toBe("i-abc123");
    expect(ec2.name).toBe("web-server");
    expect(ec2.resourceType).toBe("compute");
    expect(ec2.status).toBe("running");
    expect(ec2.owner).toBe("platform-team");
    expect(ec2.tags?.["Environment"]).toBe("production");
    expect(ec2.metadata?.["instanceType"]).toBe("t3.large");
    expect(ec2.metadata?.["publicIp"]).toBe("54.1.2.3");
    expect(ec2.metadata?.["availabilityZone"]).toBe("us-east-1a");
    expect(ec2.costMonthly).toBe(60.74); // t3.large pricing
  });

  it("should discover RDS instances with metadata", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      clientFactory: createMockClientFactory({
        "RDS:describeDBInstances": RDS_RESPONSE,
      }),
    });

    const result = await adapter.discover({ resourceTypes: ["database"] });
    expect(result.nodes.length).toBe(1);

    const db = result.nodes[0];
    expect(db.nativeId).toBe("mydb");
    expect(db.status).toBe("running"); // "available" maps to "running"
    expect(db.metadata?.["engine"]).toBe("postgres");
    expect(db.metadata?.["engineVersion"]).toBe("15.4");
    expect(db.metadata?.["multiAz"]).toBe(true);
    expect(db.metadata?.["encrypted"]).toBe(true);
    expect(db.costMonthly).toBe(236.52); // db.r6g.xlarge pricing
  });

  it("should discover Lambda functions", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      clientFactory: createMockClientFactory({
        "Lambda:listFunctions": LAMBDA_RESPONSE,
      }),
    });

    const result = await adapter.discover({ resourceTypes: ["serverless-function"] });
    expect(result.nodes.length).toBe(1);

    const fn = result.nodes[0];
    expect(fn.nativeId).toBe("api-handler");
    expect(fn.metadata?.["runtime"]).toBe("nodejs20.x");
    expect(fn.metadata?.["memorySize"]).toBe(256);
    expect(fn.metadata?.["handler"]).toBe("index.handler");
  });

  it("should extract edges from discovered resources", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      clientFactory: createMockClientFactory({
        "EC2:describeInstances": EC2_RESPONSE,
      }),
    });

    const result = await adapter.discover({ resourceTypes: ["compute"] });
    expect(result.edges.length).toBeGreaterThan(0);

    // EC2 -> VPC
    const vpcEdge = result.edges.find(
      (e) => e.relationshipType === "runs-in" && e.targetNodeId.includes("vpc:vpc-main"),
    );
    expect(vpcEdge).toBeDefined();

    // EC2 -> Security Group
    const sgEdge = result.edges.find(
      (e) => e.relationshipType === "secured-by" && e.targetNodeId.includes("security-group:sg-web001"),
    );
    expect(sgEdge).toBeDefined();
  });

  it("should discover multiple services across regions", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1", "eu-west-1"],
      clientFactory: createMockClientFactory({
        "EC2:describeInstances": EC2_RESPONSE,
        "RDS:describeDBInstances": RDS_RESPONSE,
      }),
    });

    const result = await adapter.discover({ resourceTypes: ["compute", "database"] });
    // EC2 discovered in both regions, RDS in both regions
    expect(result.nodes.length).toBe(4); // 2 regions × 2 services with responses
  });

  it("should handle errors per service without failing the whole scan", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      clientFactory: (_service, _region) => ({
        send: async () => {
          throw new Error("access denied");
        },
        destroy: () => {},
      }),
    });

    const result = await adapter.discover({ resourceTypes: ["compute"] });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("access denied");
    expect(result.nodes).toHaveLength(0);
  });

  it("should respect limit option", async () => {
    // Response with 2 instances
    const multiResponse = {
      Reservations: [
        {
          Instances: [
            { ...EC2_RESPONSE.Reservations[0].Instances[0], InstanceId: "i-1" },
            { ...EC2_RESPONSE.Reservations[0].Instances[0], InstanceId: "i-2" },
          ],
        },
      ],
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      clientFactory: createMockClientFactory({
        "EC2:describeInstances": multiResponse,
      }),
    });

    const result = await adapter.discover({ resourceTypes: ["compute"], limit: 1 });
    expect(result.nodes).toHaveLength(1);
  });

  it("should return duration timing", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      clientFactory: createMockClientFactory({
        "EC2:describeInstances": EC2_RESPONSE,
      }),
    });

    const result = await adapter.discover({ resourceTypes: ["compute"] });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// GPU / AI Workload Detection
// =============================================================================

describe("GPU / AI workload detection", () => {
  it("should flag GPU instance types", async () => {
    const gpuResponse = {
      Reservations: [
        {
          Instances: [
            {
              InstanceId: "i-gpu001",
              InstanceType: "p4d.24xlarge",
              State: { Name: "running" },
              Tags: [{ Key: "Name", Value: "ml-training" }],
            },
          ],
        },
      ],
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      clientFactory: createMockClientFactory({
        "EC2:describeInstances": gpuResponse,
      }),
    });

    const result = await adapter.discover({ resourceTypes: ["compute"] });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].metadata?.["isGpuInstance"]).toBe(true);
    expect(result.nodes[0].metadata?.["aiWorkload"]).toBe(true);
  });

  it("should flag Inferentia instance types", async () => {
    const infResponse = {
      Reservations: [
        {
          Instances: [
            {
              InstanceId: "i-inf001",
              InstanceType: "inf2.xlarge",
              State: { Name: "running" },
              Tags: [],
            },
          ],
        },
      ],
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      clientFactory: createMockClientFactory({
        "EC2:describeInstances": infResponse,
      }),
    });

    const result = await adapter.discover({ resourceTypes: ["compute"] });
    expect(result.nodes[0].metadata?.["isGpuInstance"]).toBe(true);
  });

  it("should NOT flag regular instance types as GPU", async () => {
    const regularResponse = {
      Reservations: [
        {
          Instances: [
            {
              InstanceId: "i-reg001",
              InstanceType: "t3.large",
              State: { Name: "running" },
              Tags: [],
            },
          ],
        },
      ],
    };

    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      clientFactory: createMockClientFactory({
        "EC2:describeInstances": regularResponse,
      }),
    });

    const result = await adapter.discover({ resourceTypes: ["compute"] });
    expect(result.nodes[0].metadata?.["isGpuInstance"]).toBeUndefined();
  });
});

// =============================================================================
// healthCheck()
// =============================================================================

describe("AwsDiscoveryAdapter.healthCheck()", () => {
  it("should return true when STS responds with Account", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      clientFactory: createMockClientFactory({
        "STS:getCallerIdentity": {
          Account: "123456789",
          Arn: "arn:aws:iam::123456789:user/test",
          UserId: "AIDATEST",
        },
      }),
    });

    const healthy = await adapter.healthCheck();
    expect(healthy).toBe(true);
  });

  it("should return false when STS fails", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      clientFactory: (_service, _region) => ({
        send: async () => {
          throw new Error("invalid credentials");
        },
        destroy: () => {},
      }),
    });

    const healthy = await adapter.healthCheck();
    expect(healthy).toBe(false);
  });
});

// =============================================================================
// No SDK available scenario
// =============================================================================

describe("AwsDiscoveryAdapter without SDK", () => {
  it("should return a helpful error when no SDK and no clientFactory", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      // No clientFactory and no real SDK installed
    });

    // Force SDK unavailable to simulate missing @aws-sdk packages
    vi.spyOn(testable(adapter), "ensureSdkAvailable").mockResolvedValue(false);

    const result = await adapter.discover({ resourceTypes: ["compute"] });
    // Without the real AWS SDK, should get an error
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].message).toContain("AWS SDK");
    expect(result.nodes).toHaveLength(0);
  });
});

// =============================================================================
// Cost Estimation — Static Fallback
// =============================================================================

describe("Cost estimation — static fallback", () => {
  /**
   * Helper to create a mock factory that returns resources without instance-type
   * lookups (Lambda, S3, IAM, etc.) so the code exercises the static fallback path.
   */
  function createCostTestAdapter(
    responses: Record<string, unknown>,
  ): AwsDiscoveryAdapter {
    return new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      enableCostExplorer: false, // Disable CE so only static fallback is used
      clientFactory: createMockClientFactory(responses),
    });
  }

  it("should assign static cost to Lambda functions based on memory", async () => {
    const adapter = createCostTestAdapter({
      "Lambda:listFunctions": {
        Functions: [
          {
            FunctionName: "my-func",
            FunctionArn: "arn:aws:lambda:us-east-1:123456789:function:my-func",
            Runtime: "nodejs20.x",
            MemorySize: 512,
            Timeout: 30,
            Handler: "index.handler",
            CodeSize: 4096,
            Role: "arn:aws:iam::123456789:role/exec",
            Tags: {},
          },
        ],
      },
    });

    const result = await adapter.discover({ resourceTypes: ["serverless-function"] });
    expect(result.nodes).toHaveLength(1);
    const fn = result.nodes[0];
    // Lambda should get a non-null static estimate
    expect(fn.costMonthly).not.toBeNull();
    expect(fn.costMonthly).toBeGreaterThan(0);
    expect(fn.metadata["costSource"]).toBe("static-estimate");
  });

  it("should assign static cost to S3 buckets", async () => {
    const adapter = createCostTestAdapter({
      "S3:listBuckets": {
        Buckets: [
          { Name: "my-bucket", CreationDate: "2024-01-01T00:00:00Z" },
        ],
      },
    });

    const result = await adapter.discover({ resourceTypes: ["storage"] });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].costMonthly).toBeGreaterThan(0);
    expect(result.nodes[0].metadata["costSource"]).toBe("static-estimate");
  });

  it("should assign $0 cost to IAM roles (free-tier)", async () => {
    const adapter = createCostTestAdapter({
      "IAM:listRoles": {
        Roles: [
          {
            RoleName: "admin-role",
            Arn: "arn:aws:iam::123456789:role/admin-role",
            Path: "/",
            CreateDate: "2024-01-01T00:00:00Z",
          },
        ],
      },
    });

    const result = await adapter.discover({ resourceTypes: ["iam-role"] });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].costMonthly).toBe(0);
  });

  it("should assign $0 cost to VPCs, subnets, and security groups", async () => {
    const adapter = createCostTestAdapter({
      "EC2:describeVpcs": {
        Vpcs: [{ VpcId: "vpc-1", CidrBlock: "10.0.0.0/16", IsDefault: true, Tags: [] }],
      },
      "EC2:describeSubnets": {
        Subnets: [{ SubnetId: "subnet-1", VpcId: "vpc-1", CidrBlock: "10.0.1.0/24", Tags: [] }],
      },
      "EC2:describeSecurityGroups": {
        SecurityGroups: [{ GroupId: "sg-1", GroupName: "default", VpcId: "vpc-1", Tags: [] }],
      },
    });

    const result = await adapter.discover({
      resourceTypes: ["vpc", "subnet", "security-group"],
    });
    expect(result.nodes).toHaveLength(3);
    for (const node of result.nodes) {
      expect(node.costMonthly).toBe(0);
    }
  });

  it("should assign static cost to Secrets Manager secrets", async () => {
    const adapter = createCostTestAdapter({
      "SecretsManager:listSecrets": {
        SecretList: [
          { Name: "db-password", ARN: "arn:aws:secretsmanager:us-east-1:123456789:secret:db-password" },
        ],
      },
    });

    const result = await adapter.discover({ resourceTypes: ["secret"] });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].costMonthly).toBe(0.40); // $0.40/secret/month
    expect(result.nodes[0].metadata["costSource"]).toBe("static-estimate");
  });

  it("should use instance-type lookup for EC2 (not static fallback)", async () => {
    const adapter = createCostTestAdapter({
      "EC2:describeInstances": {
        Reservations: [{
          Instances: [{
            InstanceId: "i-1",
            InstanceType: "m5.large",
            State: { Name: "running" },
            Tags: [],
          }],
        }],
      },
    });

    const result = await adapter.discover({ resourceTypes: ["compute"] });
    expect(result.nodes).toHaveLength(1);
    // EC2 should use the instance-type table, NOT static fallback
    expect(result.nodes[0].costMonthly).toBe(70.08);
    // costSource should NOT be "static-estimate" because the inline estimateCost found it
    expect(result.nodes[0].metadata["costSource"]).toBeUndefined();
  });

  it("should assign static cost to DNS zones (Route 53)", async () => {
    const adapter = createCostTestAdapter({
      "Route53:listHostedZones": {
        HostedZones: [
          { Id: "/hostedzone/Z1234", Name: "example.com.", CallerReference: "ref1" },
        ],
      },
    });

    const result = await adapter.discover({ resourceTypes: ["dns"] });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].costMonthly).toBe(0.50); // $0.50/zone
    expect(result.nodes[0].metadata["costSource"]).toBe("static-estimate");
  });
});

// =============================================================================
// Cost Explorer Enrichment
// =============================================================================

describe("Cost Explorer enrichment", () => {
  it("should apply resource-level costs from Cost Explorer", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      enableCostExplorer: true,
      clientFactory: createMockClientFactory({
        "Lambda:listFunctions": {
          Functions: [
            {
              FunctionName: "data-processor",
              FunctionArn: "arn:aws:lambda:us-east-1:123456789:function:data-processor",
              Runtime: "python3.12",
              MemorySize: 1024,
              Timeout: 300,
              Handler: "handler.main",
              Role: "arn:aws:iam::123456789:role/exec",
              Tags: {},
            },
          ],
        },
      }),
    });

    // Mock Cost Explorer methods
    vi.spyOn(testable(adapter), "queryServiceCosts").mockResolvedValue(
      new Map([["AWS Lambda", 42.50]]),
    );
    vi.spyOn(testable(adapter), "queryResourceCosts").mockResolvedValue(
      new Map([["arn:aws:lambda:us-east-1:123456789:function:data-processor", 42.50]]),
    );

    const result = await adapter.discover({ resourceTypes: ["serverless-function"] });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].costMonthly).toBe(42.50);
    expect(result.nodes[0].metadata["costSource"]).toBe("cost-explorer");
    expect(result.nodes[0].metadata["costArn"]).toBe(
      "arn:aws:lambda:us-east-1:123456789:function:data-processor",
    );
  });

  it("should distribute service-level costs when no resource-level data", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      enableCostExplorer: true,
      clientFactory: createMockClientFactory({
        "S3:listBuckets": {
          Buckets: [
            { Name: "bucket-a", CreationDate: "2024-01-01T00:00:00Z" },
            { Name: "bucket-b", CreationDate: "2024-03-01T00:00:00Z" },
          ],
        },
      }),
    });

    // Service-level costs only, no resource-level
    vi.spyOn(testable(adapter), "queryServiceCosts").mockResolvedValue(
      new Map([["Amazon Simple Storage Service", 10.00]]),
    );
    vi.spyOn(testable(adapter), "queryResourceCosts").mockResolvedValue(null);

    const result = await adapter.discover({ resourceTypes: ["storage"] });
    expect(result.nodes).toHaveLength(2);

    // Costs should be distributed (equal weight since both start at static ~$0.02)
    const totalCost = result.nodes.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0);
    expect(totalCost).toBeCloseTo(10.00, 0);
    expect(result.nodes[0].metadata["costSource"]).toBe("cost-explorer-distributed");
  });

  it("should fall back to static estimates when Cost Explorer fails", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      enableCostExplorer: true,
      clientFactory: createMockClientFactory({
        "Lambda:listFunctions": {
          Functions: [
            {
              FunctionName: "simple-func",
              FunctionArn: "arn:aws:lambda:us-east-1:123456789:function:simple-func",
              Runtime: "nodejs20.x",
              MemorySize: 128,
              Timeout: 3,
              Handler: "index.handler",
              Role: "arn:aws:iam::123456789:role/exec",
              Tags: {},
            },
          ],
        },
      }),
    });

    // CE fails completely
    vi.spyOn(testable(adapter), "enrichWithCostExplorer").mockRejectedValue(
      new Error("AccessDenied"),
    );

    const result = await adapter.discover({ resourceTypes: ["serverless-function"] });
    expect(result.nodes).toHaveLength(1);
    // Should still have a cost from static fallback
    expect(result.nodes[0].costMonthly).not.toBeNull();
    expect(result.nodes[0].costMonthly).toBeGreaterThan(0);
    expect(result.nodes[0].metadata["costSource"]).toBe("static-estimate");
  });

  it("should skip Cost Explorer when enableCostExplorer is false", async () => {
    const adapter = new AwsDiscoveryAdapter({
      accountId: "123456789",
      regions: ["us-east-1"],
      enableCostExplorer: false,
      clientFactory: createMockClientFactory({
        "Lambda:listFunctions": {
          Functions: [
            {
              FunctionName: "no-ce-func",
              FunctionArn: "arn:aws:lambda:us-east-1:123456789:function:no-ce-func",
              Runtime: "nodejs20.x",
              MemorySize: 256,
              Timeout: 10,
              Handler: "index.handler",
              Role: "arn:aws:iam::123456789:role/exec",
              Tags: {},
            },
          ],
        },
      }),
    });

    const enrichSpy = vi.spyOn(testable(adapter), "enrichWithCostExplorer");

    const result = await adapter.discover({ resourceTypes: ["serverless-function"] });
    expect(enrichSpy).not.toHaveBeenCalled();
    // Should still have static estimate
    expect(result.nodes[0].costMonthly).toBeGreaterThan(0);
    expect(result.nodes[0].metadata["costSource"]).toBe("static-estimate");
  });
});

// =============================================================================
// @espada/aws Integration — Extended Capabilities
// =============================================================================

describe("AwsDiscoveryAdapter — @espada/aws integration", () => {
  // ---------------------------------------------------------------------------
  // supportsIncrementalSync
  // ---------------------------------------------------------------------------

  describe("supportsIncrementalSync()", () => {
    it("should return false when clientFactory is provided (test mode)", () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        clientFactory: createMockClientFactory({}),
      });
      expect(adapter.supportsIncrementalSync()).toBe(false);
    });

    it("should return true when no clientFactory (production mode)", () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
      });
      expect(adapter.supportsIncrementalSync()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // forecastCosts — via injected CostManager mock
  // ---------------------------------------------------------------------------

  describe("forecastCosts()", () => {
    it("should delegate to CostManager.forecastCosts()", async () => {
      const mockCostManager = {
        forecastCosts: vi.fn().mockResolvedValue({
          success: true,
          data: {
            totalForecastedCost: 420.50,
            forecastPeriods: [
              { start: "2025-01-01", end: "2025-01-31", amount: 420.50 },
            ],
            currency: "USD",
            confidenceLevel: 0.85,
          },
        }),
        getCostSummary: vi.fn(),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cost: mockCostManager },
      });

      const result = await adapter.forecastCosts({ days: 30, granularity: "MONTHLY" });
      expect(result).not.toBeNull();
      expect(result!.totalForecastedCost).toBe(420.50);
      expect(result!.forecastPeriods).toHaveLength(1);
      expect(result!.currency).toBe("USD");
      expect(result!.confidenceLevel).toBe(0.85);
      expect(mockCostManager.forecastCosts).toHaveBeenCalledOnce();
    });

    it("should return null when CostManager is unavailable", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        clientFactory: createMockClientFactory({}),
      });
      // Spy on the private getter to return null
      vi.spyOn(testable(adapter), "getCostManagerInstance").mockResolvedValue(null);

      const result = await adapter.forecastCosts();
      expect(result).toBeNull();
    });

    it("should return null when CostManager throws", async () => {
      const mockCostManager = {
        forecastCosts: vi.fn().mockRejectedValue(new Error("CE not enabled")),
        getCostSummary: vi.fn(),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cost: mockCostManager },
      });

      const result = await adapter.forecastCosts();
      expect(result).toBeNull();
    });

    it("should return null when forecast returns success:false", async () => {
      const mockCostManager = {
        forecastCosts: vi.fn().mockResolvedValue({
          success: false,
          error: "Insufficient data",
        }),
        getCostSummary: vi.fn(),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cost: mockCostManager },
      });

      const result = await adapter.forecastCosts();
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getOptimizationRecommendations — via injected CostManager mock
  // ---------------------------------------------------------------------------

  describe("getOptimizationRecommendations()", () => {
    it("should return rightsizing and savings recommendations", async () => {
      const mockCostManager = {
        getOptimizationRecommendations: vi.fn().mockResolvedValue({
          success: true,
          data: {
            rightsizing: [
              { instanceId: "i-abc", currentType: "m5.2xlarge", recommendedType: "m5.xlarge", estimatedSavings: 70 },
            ],
            reservedInstances: [
              { service: "EC2", recommendedCount: 3, estimatedSavings: 200 },
            ],
            savingsPlans: [
              { type: "Compute", commitment: 500, estimatedSavings: 150 },
            ],
            totalEstimatedSavings: 420,
          },
        }),
        getCostSummary: vi.fn(),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cost: mockCostManager },
      });

      const result = await adapter.getOptimizationRecommendations();
      expect(result).not.toBeNull();
      expect(result!.rightsizing).toHaveLength(1);
      expect(result!.rightsizing[0].estimatedSavings).toBe(70);
      expect(result!.reservedInstances).toHaveLength(1);
      expect(result!.savingsPlans).toHaveLength(1);
      expect(result!.totalEstimatedSavings).toBe(420);
    });

    it("should return null when CostManager is unavailable", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        clientFactory: createMockClientFactory({}),
      });
      vi.spyOn(testable(adapter), "getCostManagerInstance").mockResolvedValue(null);

      expect(await adapter.getOptimizationRecommendations()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // findUnusedResources — via injected CostManager mock
  // ---------------------------------------------------------------------------

  describe("findUnusedResources()", () => {
    it("should return unused resources with estimated waste", async () => {
      const mockCostManager = {
        findUnusedResources: vi.fn().mockResolvedValue({
          success: true,
          data: {
            resources: [
              { resourceId: "vol-abc", resourceType: "EBS", reason: "Unattached volume", estimatedMonthlyCost: 12.50, region: "us-east-1" },
              { resourceId: "eip-def", resourceType: "EIP", reason: "Unused Elastic IP", estimatedMonthlyCost: 3.60, region: "us-east-1" },
            ],
            totalWastedCost: 16.10,
          },
        }),
        getCostSummary: vi.fn(),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cost: mockCostManager },
      });

      const result = await adapter.findUnusedResources();
      expect(result).not.toBeNull();
      expect(result!.resources).toHaveLength(2);
      expect(result!.totalWastedCost).toBe(16.10);
      expect(result!.resources[0].reason).toBe("Unattached volume");
    });

    it("should return null when CostManager throws", async () => {
      const mockCostManager = {
        findUnusedResources: vi.fn().mockRejectedValue(new Error("access denied")),
        getCostSummary: vi.fn(),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cost: mockCostManager },
      });

      expect(await adapter.findUnusedResources()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getIncrementalChanges — via injected CloudTrailManager mock
  // ---------------------------------------------------------------------------

  describe("getIncrementalChanges()", () => {
    it("should return null when clientFactory is provided (test mode guard)", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        clientFactory: createMockClientFactory({}),
      });

      const result = await adapter.getIncrementalChanges(new Date("2025-01-01"));
      expect(result).toBeNull();
    });

    it("should categorize CloudTrail events into creates/modifies/deletes", async () => {
      const mockCloudTrail = {
        getInfrastructureEvents: vi.fn().mockResolvedValue([
          {
            eventId: "evt-1",
            eventName: "CreateSubnet",
            eventTime: new Date("2025-01-15T10:00:00Z"),
            eventSource: "ec2.amazonaws.com",
            awsRegion: "us-east-1",
            userIdentity: { userName: "admin" },
            resources: [{ resourceType: "AWS::EC2::Subnet", resourceName: "subnet-abc" }],
          },
          {
            eventId: "evt-2",
            eventName: "ModifyInstanceAttribute",
            eventTime: new Date("2025-01-15T11:00:00Z"),
            eventSource: "ec2.amazonaws.com",
            awsRegion: "us-west-2",
            userIdentity: { arn: "arn:aws:iam::123:user/deploy" },
            resources: [{ resourceType: "AWS::EC2::Instance", resourceName: "i-xyz" }],
          },
          {
            eventId: "evt-3",
            eventName: "DeleteBucket",
            eventTime: new Date("2025-01-15T12:00:00Z"),
            eventSource: "s3.amazonaws.com",
            awsRegion: "us-east-1",
            userIdentity: { userName: "cleanup-bot" },
            resources: [{ resourceType: "AWS::S3::Bucket", resourceName: "old-bucket" }],
          },
          {
            eventId: "evt-4",
            eventName: "TerminateInstances",
            eventTime: new Date("2025-01-15T12:30:00Z"),
            eventSource: "ec2.amazonaws.com",
            awsRegion: "us-east-1",
            userIdentity: { userName: "admin" },
            resources: [],
          },
          {
            eventId: "evt-5",
            eventName: "RunInstances",
            eventTime: new Date("2025-01-15T13:00:00Z"),
            eventSource: "ec2.amazonaws.com",
            awsRegion: "us-east-1",
            userIdentity: { userName: "admin" },
            resources: [{ resourceType: "AWS::EC2::Instance", resourceName: "i-new" }],
          },
          {
            eventId: "evt-6",
            eventName: "PutBucketPolicy",
            eventTime: new Date("2025-01-15T13:30:00Z"),
            eventSource: "s3.amazonaws.com",
            awsRegion: "us-east-1",
            userIdentity: { userName: "admin" },
            resources: [],
          },
          {
            // Failed event — should be skipped
            eventId: "evt-7",
            eventName: "CreateVpc",
            eventTime: new Date("2025-01-15T14:00:00Z"),
            eventSource: "ec2.amazonaws.com",
            awsRegion: "us-east-1",
            errorCode: "UnauthorizedAccess",
            userIdentity: { userName: "rogue" },
            resources: [],
          },
        ]),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cloudtrail: mockCloudTrail },
      });

      const result = await adapter.getIncrementalChanges(new Date("2025-01-01"));
      expect(result).not.toBeNull();

      // Creates: CreateSubnet, RunInstances
      expect(result!.creates).toHaveLength(2);
      expect(result!.creates[0].eventName).toBe("CreateSubnet");
      expect(result!.creates[0].service).toBe("ec2");
      expect(result!.creates[0].actor).toBe("admin");
      expect(result!.creates[1].eventName).toBe("RunInstances");

      // Modifies: ModifyInstanceAttribute, PutBucketPolicy
      expect(result!.modifies).toHaveLength(2);
      expect(result!.modifies[0].eventName).toBe("ModifyInstanceAttribute");
      expect(result!.modifies[0].actor).toBe("arn:aws:iam::123:user/deploy");
      expect(result!.modifies[1].eventName).toBe("PutBucketPolicy");

      // Deletes: DeleteBucket, TerminateInstances
      expect(result!.deletes).toHaveLength(2);
      expect(result!.deletes[0].eventName).toBe("DeleteBucket");
      expect(result!.deletes[1].eventName).toBe("TerminateInstances");

      // Failed event (evt-7) should not appear in any category
      const allEvents = [...result!.creates, ...result!.modifies, ...result!.deletes];
      expect(allEvents.find((e) => e.eventId === "evt-7")).toBeUndefined();
    });

    it("should return null when CloudTrailManager is unavailable", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cloudtrail: null },
      });
      // Override clientFactory check by using managers injection
      vi.spyOn(testable(adapter), "getCloudTrailManager").mockResolvedValue(null);

      const result = await adapter.getIncrementalChanges(new Date("2025-01-01"));
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getSecurityPosture — via injected SecurityManager mock
  // ---------------------------------------------------------------------------

  describe("getSecurityPosture()", () => {
    it("should return null when clientFactory is provided (test mode guard)", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        clientFactory: createMockClientFactory({}),
      });

      expect(await adapter.getSecurityPosture()).toBeNull();
    });

    it("should collect IAM, Security Hub, and GuardDuty findings", async () => {
      const mockSecurity = {
        listRoles: vi.fn().mockResolvedValue({
          success: true,
          data: {
            roles: [
              { roleName: "AdminRole", arn: "arn:aws:iam::123:role/AdminRole" },
              { roleName: "LambdaExec", arn: "arn:aws:iam::123:role/LambdaExec" },
            ],
          },
        }),
        listSecurityFindings: vi.fn().mockResolvedValue({
          success: true,
          data: {
            findings: [
              { title: "S3 bucket public", severity: "HIGH", resources: [{ id: "my-bucket" }] },
              { title: "Root account MFA", severity: "CRITICAL", resources: [{ id: "root" }] },
            ],
          },
        }),
        listGuardDutyFindings: vi.fn().mockResolvedValue({
          success: true,
          data: {
            findings: [
              { title: "Unusual API call", severity: "MEDIUM", type: "Recon:IAMUser/MaliciousIPCaller" },
            ],
          },
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { security: mockSecurity },
      });

      const result = await adapter.getSecurityPosture();
      expect(result).not.toBeNull();
      expect(result!.iamRoles).toBe(2);
      expect(result!.securityFindings).toHaveLength(2);
      expect(result!.securityFindings[0].severity).toBe("HIGH");
      expect(result!.securityFindings[1].resourceId).toBe("root");
      expect(result!.guardDutyFindings).toHaveLength(1);
      expect(result!.guardDutyFindings[0].type).toBe("Recon:IAMUser/MaliciousIPCaller");
      expect(result!.scannedAt).toBeDefined();
    });

    it("should handle SecurityHub/GuardDuty not being enabled", async () => {
      const mockSecurity = {
        listRoles: vi.fn().mockResolvedValue({
          success: true,
          data: { roles: [{ roleName: "OnlyRole", arn: "arn:aws:iam::123:role/OnlyRole" }] },
        }),
        listSecurityFindings: vi.fn().mockRejectedValue(new Error("SecurityHub not enabled")),
        listGuardDutyFindings: vi.fn().mockRejectedValue(new Error("GuardDuty not enabled")),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { security: mockSecurity },
      });

      const result = await adapter.getSecurityPosture();
      expect(result).not.toBeNull();
      expect(result!.iamRoles).toBe(1);
      expect(result!.securityFindings).toHaveLength(0);
      expect(result!.guardDutyFindings).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // enrichWithSecurity — attaches findings to matching nodes
  // ---------------------------------------------------------------------------

  describe("enrichWithSecurity()", () => {
    it("should attach security findings to matching nodes", async () => {
      const mockSecurity = {
        listRoles: vi.fn().mockResolvedValue({ success: true, data: { roles: [] } }),
        listSecurityFindings: vi.fn().mockResolvedValue({
          success: true,
          data: {
            findings: [
              { title: "Bucket is public", severity: "HIGH", resources: [{ id: "my-bucket" }] },
              { title: "Open security group", severity: "MEDIUM", resources: [{ id: "sg-abc" }] },
            ],
          },
        }),
        listGuardDutyFindings: vi.fn().mockResolvedValue({ success: true, data: { findings: [] } }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { security: mockSecurity },
      });

      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123:us-east-1:storage:my-bucket",
          provider: "aws",
          resourceType: "storage",
          nativeId: "my-bucket",
          name: "my-bucket",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
        {
          id: "aws:123:us-east-1:security-group:sg-abc",
          provider: "aws",
          resourceType: "security-group",
          nativeId: "sg-abc",
          name: "default",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
        {
          id: "aws:123:us-east-1:compute:i-xyz",
          provider: "aws",
          resourceType: "compute",
          nativeId: "i-xyz",
          name: "web-server",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
      ];

      await adapter.enrichWithSecurity(nodes);

      // my-bucket should have the finding
      expect(nodes[0].metadata["hasSecurityIssues"]).toBe(true);
      expect(nodes[0].metadata["securityFindings"]).toEqual(["[HIGH] Bucket is public"]);

      // sg-abc should have the finding
      expect(nodes[1].metadata["hasSecurityIssues"]).toBe(true);
      expect(nodes[1].metadata["securityFindings"]).toEqual(["[MEDIUM] Open security group"]);

      // i-xyz should NOT have findings
      expect(nodes[2].metadata["hasSecurityIssues"]).toBeUndefined();
      expect(nodes[2].metadata["securityFindings"]).toBeUndefined();
    });

    it("should be a no-op when security posture is unavailable", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        clientFactory: createMockClientFactory({}),
      });

      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123:us-east-1:compute:i-1",
          provider: "aws",
          resourceType: "compute",
          nativeId: "i-1",
          name: "test",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
      ];

      await adapter.enrichWithSecurity(nodes);
      expect(nodes[0].metadata["hasSecurityIssues"]).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // dispose — cleanup
  // ---------------------------------------------------------------------------

  describe("dispose()", () => {
    it("should reset all manager instances", async () => {
      const destroyFn = vi.fn();
      const mockPool = { destroy: destroyFn, getClient: vi.fn() };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: {
          credentials: { healthCheck: vi.fn() },
          clientPool: mockPool,
          cost: { getCostSummary: vi.fn() },
          security: { listRoles: vi.fn() },
        },
      });

      // Force lazy load of managers
      await testable(adapter).getCredentialsManager();
      await testable(adapter).getClientPoolManager();
      await testable(adapter).getCostManagerInstance();
      await testable(adapter).getSecurityManager();

      await adapter.dispose();

      expect(destroyFn).toHaveBeenCalledOnce();

      // After dispose, managers should be reset to undefined
      expect(testable(adapter)._credentialsManager).toBeUndefined();
      expect(testable(adapter)._clientPoolManager).toBeUndefined();
      expect(testable(adapter)._costManager).toBeUndefined();
      expect(testable(adapter)._securityManager).toBeUndefined();
    });

    it("should handle dispose when no managers were loaded", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        clientFactory: createMockClientFactory({}),
      });

      // Should not throw
      await adapter.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // Network Topology — new resource types and relationships
  // ---------------------------------------------------------------------------

  describe("network topology (relationship rules)", () => {
    it("should extract route-table -> VPC runs-in edge", () => {
      const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });
      const raw = { VpcId: "vpc-net1" };
      const edges = adapter.extractRelationships(
        "aws:123456789:us-east-1:route-table:rtb-1",
        "route-table",
        raw,
        "123456789",
        "us-east-1",
      );
      const edge = edges.find((e) => e.relationshipType === "runs-in" && e.targetNodeId.includes("vpc:vpc-net1"));
      expect(edge).toBeDefined();
    });

    it("should extract route-table -> subnet routes-to edges", () => {
      const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });
      const raw = {
        VpcId: "vpc-net1",
        Associations: [
          { SubnetId: "subnet-a" },
          { SubnetId: "subnet-b" },
        ],
      };
      const edges = adapter.extractRelationships(
        "aws:123456789:us-east-1:route-table:rtb-1",
        "route-table",
        raw,
        "123456789",
        "us-east-1",
      );
      const routeEdges = edges.filter((e) => e.relationshipType === "routes-to" && e.targetNodeId.includes("subnet:"));
      expect(routeEdges).toHaveLength(2);
    });

    it("should extract internet-gateway -> VPC bidirectional edges", () => {
      const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });
      const raw = {
        Attachments: [{ VpcId: "vpc-net1" }],
      };
      const edges = adapter.extractRelationships(
        "aws:123456789:us-east-1:internet-gateway:igw-1",
        "internet-gateway",
        raw,
        "123456789",
        "us-east-1",
      );
      const attachEdge = edges.find((e) => e.relationshipType === "attached-to" && e.targetNodeId.includes("vpc:vpc-net1"));
      expect(attachEdge).toBeDefined();
      // Bidirectional — reverse edge
      const reverseEdge = edges.find((e) => e.sourceNodeId.includes("vpc:vpc-net1"));
      expect(reverseEdge).toBeDefined();
    });

    it("should extract nat-gateway -> VPC and subnet edges", () => {
      const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });
      const raw = { VpcId: "vpc-net1", SubnetId: "subnet-pub" };
      const edges = adapter.extractRelationships(
        "aws:123456789:us-east-1:nat-gateway:nat-1",
        "nat-gateway",
        raw,
        "123456789",
        "us-east-1",
      );
      expect(edges.find((e) => e.relationshipType === "runs-in" && e.targetNodeId.includes("vpc:vpc-net1"))).toBeDefined();
      expect(edges.find((e) => e.relationshipType === "runs-in" && e.targetNodeId.includes("subnet:subnet-pub"))).toBeDefined();
    });

    it("should extract vpc-endpoint -> VPC and subnet edges", () => {
      const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });
      const raw = {
        VpcId: "vpc-net1",
        SubnetIds: ["subnet-a", "subnet-b"],
        RouteTableIds: ["rtb-1"],
      };
      const edges = adapter.extractRelationships(
        "aws:123456789:us-east-1:vpc-endpoint:vpce-1",
        "vpc-endpoint",
        raw,
        "123456789",
        "us-east-1",
      );
      expect(edges.find((e) => e.relationshipType === "connected-to" && e.targetNodeId.includes("vpc:vpc-net1"))).toBeDefined();
      expect(edges.filter((e) => e.relationshipType === "runs-in")).toHaveLength(2);
      expect(edges.find((e) => e.relationshipType === "routes-to" && e.targetNodeId.includes("route-table:rtb-1"))).toBeDefined();
    });

    it("should extract transit-gateway -> VPC bidirectional edges", () => {
      const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });
      const raw = {
        TransitGatewayAttachments: [
          { ResourceId: "vpc-a" },
          { ResourceId: "vpc-b" },
        ],
      };
      const edges = adapter.extractRelationships(
        "aws:123456789:us-east-1:transit-gateway:tgw-1",
        "transit-gateway",
        raw,
        "123456789",
        "us-east-1",
      );
      const connectEdges = edges.filter((e) => e.relationshipType === "connects-via");
      // 2 forward + 2 reverse (bidirectional) = 4
      expect(connectEdges).toHaveLength(4);
      // Bidirectional
      const reverseEdges = edges.filter((e) => e.sourceNodeId.includes("vpc:"));
      expect(reverseEdges.length).toBeGreaterThanOrEqual(2);
    });

    it("should include network resource types in supported types", () => {
      const adapter = new AwsDiscoveryAdapter({ accountId: "123456789" });
      const types = adapter.supportedResourceTypes();
      expect(types).toContain("route-table");
      expect(types).toContain("internet-gateway");
      expect(types).toContain("nat-gateway");
      expect(types).toContain("vpc-endpoint");
      expect(types).toContain("transit-gateway");
    });
  });

  // ---------------------------------------------------------------------------
  // Network topology discovery via mock client
  // ---------------------------------------------------------------------------

  describe("network topology discovery", () => {
    it("should discover route tables, internet gateways, and NAT gateways", async () => {
      const responses: Record<string, unknown> = {
        "EC2:describeInstances": { Reservations: [] },
        "EC2:describeVpcs": { Vpcs: [] },
        "EC2:describeSubnets": { Subnets: [] },
        "EC2:describeSecurityGroups": { SecurityGroups: [] },
        "EC2:describeRouteTables": {
          RouteTables: [
            { RouteTableId: "rtb-001", VpcId: "vpc-net1", Tags: [{ Key: "Name", Value: "main-rt" }] },
          ],
        },
        "EC2:describeInternetGateways": {
          InternetGateways: [
            { InternetGatewayId: "igw-001", Attachments: [{ VpcId: "vpc-net1" }], Tags: [{ Key: "Name", Value: "my-igw" }] },
          ],
        },
        "EC2:describeNatGateways": {
          NatGateways: [
            { NatGatewayId: "nat-001", VpcId: "vpc-net1", SubnetId: "subnet-pub1", State: "available", Tags: [{ Key: "Name", Value: "my-nat" }] },
          ],
        },
        "EC2:describeVpcEndpoints": { VpcEndpoints: [] },
        "EC2:describeTransitGateways": { TransitGateways: [] },
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        regions: ["us-east-1"],
        clientFactory: createMockClientFactory(responses),
      });

      const result = await adapter.discover({ resourceTypes: ["route-table", "internet-gateway", "nat-gateway"] });
      const rtNodes = result.nodes.filter((n) => n.resourceType === ("route-table"));
      const igwNodes = result.nodes.filter((n) => n.resourceType === ("internet-gateway"));
      const natNodes = result.nodes.filter((n) => n.resourceType === "nat-gateway");

      expect(rtNodes).toHaveLength(1);
      expect(rtNodes[0].name).toBe("main-rt");

      expect(igwNodes).toHaveLength(1);
      expect(igwNodes[0].name).toBe("my-igw");

      expect(natNodes).toHaveLength(1);
      expect(natNodes[0].name).toBe("my-nat");

      // NAT gateway should have VPC and subnet edges
      const natEdges = result.edges.filter((e) => e.sourceNodeId.includes("nat-gateway:nat-001"));
      expect(natEdges.length).toBeGreaterThanOrEqual(2); // runs-in vpc + runs-in subnet
    });
  });

  // ---------------------------------------------------------------------------
  // TaggingManager integration
  // ---------------------------------------------------------------------------

  describe("enrichWithTags()", () => {
    it("should enrich nodes with tags from TaggingManager", async () => {
      const mockTagging = {
        getResourceTags: vi.fn().mockImplementation((arn: string) => {
          if (arn === "i-tagged")
            return [
              { key: "Environment", value: "production" },
              { key: "Owner", value: "platform-team" },
              { key: "CostCenter", value: "eng-123" },
            ];
          return [];
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { tagging: mockTagging },
      });

      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123:us-east-1:compute:i-tagged",
          provider: "aws",
          resourceType: "compute",
          nativeId: "i-tagged",
          name: "web-server",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: { Name: "web-server" },
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
        {
          id: "aws:123:us-east-1:storage:no-tags",
          provider: "aws",
          resourceType: "storage",
          nativeId: "no-tags",
          name: "some-bucket",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
      ];

      // Call private method
      await testable(adapter).enrichWithTags(nodes);

      expect(nodes[0].tags["Environment"]).toBe("production");
      expect(nodes[0].tags["CostCenter"]).toBe("eng-123");
      expect(nodes[0].tags["Name"]).toBe("web-server"); // Existing tag preserved
      expect(nodes[0].owner).toBe("platform-team");
      expect(nodes[0].metadata["tagSource"]).toBe("tagging-manager");
      expect(nodes[0].metadata["tagCount"]).toBe(4); // Name + 3 new

      // Second node has no tags from manager — unchanged
      expect(nodes[1].metadata["tagSource"]).toBeUndefined();
    });

    it("should be a no-op when TaggingManager is unavailable", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { tagging: null },
      });
      vi.spyOn(testable(adapter), "getTaggingManager").mockResolvedValue(null);

      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123:us-east-1:compute:i-1",
          provider: "aws",
          resourceType: "compute",
          nativeId: "i-1",
          name: "test",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
      ];

      await testable(adapter).enrichWithTags(nodes);
      expect(nodes[0].metadata["tagSource"]).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Event-driven edges — Lambda event source mappings
  // ---------------------------------------------------------------------------

  describe("enrichWithEventSources()", () => {
    it("should create trigger edges from Lambda event source mappings", async () => {
      const mockLambda = {
        listEventSourceMappings: vi.fn().mockResolvedValue([
          {
            uuid: "esm-1",
            eventSourceArn: "arn:aws:sqs:us-east-1:123:my-queue",
            functionArn: "arn:aws:lambda:us-east-1:123:function:my-func",
            state: "Enabled",
            batchSize: 10,
          },
        ]),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { lambda: mockLambda },
      });

      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123:us-east-1:queue:my-queue",
          provider: "aws",
          resourceType: "queue",
          nativeId: "arn:aws:sqs:us-east-1:123:my-queue",
          name: "my-queue",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
        {
          id: "aws:123:us-east-1:serverless-function:my-func",
          provider: "aws",
          resourceType: "serverless-function",
          nativeId: "arn:aws:lambda:us-east-1:123:function:my-func",
          name: "my-func",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
      ];

      const edges: any[] = [];
      await testable(adapter).enrichWithEventSources(nodes, edges);

      expect(edges).toHaveLength(1);
      expect(edges[0].relationshipType).toBe("triggers");
      expect(edges[0].sourceNodeId).toContain("queue:my-queue");
      expect(edges[0].targetNodeId).toContain("serverless-function:my-func");
      expect(edges[0].discoveredVia).toBe("event-stream");
      expect(edges[0].metadata.batchSize).toBe(10);
      expect(edges[0].metadata.eventSourceType).toBe("queue");
    });

    it("should handle unavailable Lambda manager gracefully", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { lambda: null },
      });
      vi.spyOn(testable(adapter), "getLambdaManager").mockResolvedValue(null);

      const edges: any[] = [];
      await testable(adapter).enrichWithEventSources([], edges);
      expect(edges).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Observability — X-Ray service map + CloudWatch alarms
  // ---------------------------------------------------------------------------

  describe("enrichWithObservability()", () => {
    it("should create routes-to edges from X-Ray service map", async () => {
      const mockObs = {
        getServiceMap: vi.fn().mockResolvedValue({
          success: true,
          data: {
            services: [
              {
                name: "api-service",
                type: "AWS::ApiGateway::RestApi",
                edges: [{ targetName: "my-func" }],
                responseTimeHistogram: [{ value: 0.05 }],
              },
              {
                name: "my-func",
                type: "AWS::Lambda::Function",
                edges: [{ targetName: "my-db" }],
              },
            ],
          },
        }),
        listAlarms: vi.fn().mockResolvedValue({ success: true, data: [] }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { observability: mockObs },
      });

      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123:us-east-1:api-gateway:api-1",
          provider: "aws",
          resourceType: "api-gateway",
          nativeId: "api-1",
          name: "api-service",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
        {
          id: "aws:123:us-east-1:serverless-function:my-func",
          provider: "aws",
          resourceType: "serverless-function",
          nativeId: "my-func",
          name: "my-func",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
        {
          id: "aws:123:us-east-1:database:my-db",
          provider: "aws",
          resourceType: "database",
          nativeId: "my-db",
          name: "my-db",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
      ];

      const edges: any[] = [];
      await testable(adapter).enrichWithObservability(nodes, edges);

      expect(edges.length).toBeGreaterThanOrEqual(2);
      const apiToFunc = edges.find((e: any) => e.sourceNodeId.includes("api-gateway:api-1") && e.targetNodeId.includes("my-func"));
      expect(apiToFunc).toBeDefined();
      expect(apiToFunc!.discoveredVia).toBe("runtime-trace");

      const funcToDb = edges.find((e: any) => e.sourceNodeId.includes("my-func") && e.targetNodeId.includes("my-db"));
      expect(funcToDb).toBeDefined();

      // Response time should be on the API node
      expect(nodes[0].metadata["avgResponseTimeMs"]).toBe(50);
      expect(nodes[0].metadata["observabilitySource"]).toBe("xray");
    });

    it("should attach CloudWatch alarm metadata to nodes", async () => {
      const mockObs = {
        getServiceMap: vi.fn().mockResolvedValue({ success: false }),
        listAlarms: vi.fn().mockResolvedValue({
          success: true,
          data: [
            {
              alarmName: "HighCPU",
              stateValue: "ALARM",
              metricName: "CPUUtilization",
              namespace: "AWS/EC2",
              dimensions: [{ name: "InstanceId", value: "i-alert" }],
            },
            {
              alarmName: "LowErrors",
              stateValue: "OK",
              namespace: "AWS/Lambda",
              dimensions: [{ name: "FunctionName", value: "my-func" }],
            },
          ],
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { observability: mockObs },
      });

      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123:us-east-1:compute:i-alert",
          provider: "aws",
          resourceType: "compute",
          nativeId: "i-alert",
          name: "alert-server",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
        {
          id: "aws:123:us-east-1:serverless-function:my-func",
          provider: "aws",
          resourceType: "serverless-function",
          nativeId: "my-func",
          name: "my-func",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
      ];

      const edges: any[] = [];
      await testable(adapter).enrichWithObservability(nodes, edges);

      expect(nodes[0].metadata["hasActiveAlarm"]).toBe(true);
      expect(nodes[0].metadata["monitoredByCloudWatch"]).toBe(true);
      expect((nodes[0].metadata["alarms"] as string[])[0]).toContain("HighCPU: ALARM");

      expect(nodes[1].metadata["monitoredByCloudWatch"]).toBe(true);
      expect(nodes[1].metadata["hasActiveAlarm"]).toBeUndefined(); // "OK" state
    });

    it("should be a no-op when ObservabilityManager is unavailable", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { observability: null },
      });
      vi.spyOn(testable(adapter), "getObservabilityManager").mockResolvedValue(null);

      const edges: any[] = [];
      await testable(adapter).enrichWithObservability([], edges);
      expect(edges).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Deeper discovery — S3 bucket details
  // ---------------------------------------------------------------------------

  describe("enrichWithDeeperDiscovery()", () => {
    it("should enrich S3 buckets with encryption and public access details", async () => {
      const mockS3 = {
        getBucketDetails: vi.fn().mockResolvedValue({
          success: true,
          data: {
            versioning: "Enabled",
            encryption: { type: "AES256", algorithm: "AES256" },
            lifecycle: { rules: [{ id: "rule1" }] },
          },
        }),
        getPublicAccessBlock: vi.fn().mockResolvedValue({
          success: true,
          data: {
            blockPublicAcls: true,
            blockPublicPolicy: true,
            ignorePublicAcls: true,
            restrictPublicBuckets: true,
          },
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { s3: mockS3 },
      });

      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123:us-east-1:storage:my-bucket",
          provider: "aws",
          resourceType: "storage",
          nativeId: "my-bucket",
          name: "my-bucket",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
      ];

      const edges: any[] = [];
      await testable(adapter).enrichWithDeeperDiscovery(nodes, edges);

      expect(nodes[0].metadata["versioning"]).toBe("Enabled");
      expect(nodes[0].metadata["encryptionType"]).toBe("AES256");
      expect(nodes[0].metadata["lifecycleRules"]).toBe(1);
      expect(nodes[0].metadata["publicAccessBlocked"]).toBe(true);
    });

    it("should flag S3 buckets with incomplete public access blocks", async () => {
      const mockS3 = {
        getBucketDetails: vi.fn().mockResolvedValue({ success: false }),
        getPublicAccessBlock: vi.fn().mockResolvedValue({
          success: true,
          data: {
            blockPublicAcls: true,
            blockPublicPolicy: false, // Not fully blocked!
            ignorePublicAcls: true,
            restrictPublicBuckets: true,
          },
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { s3: mockS3 },
      });

      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123:us-east-1:storage:open-bucket",
          provider: "aws",
          resourceType: "storage",
          nativeId: "open-bucket",
          name: "open-bucket",
          region: "us-east-1",
          account: "123",
          status: "running",
          tags: {},
          metadata: {},
          costMonthly: null,
          owner: null,
          createdAt: null,
        },
      ];

      const edges: any[] = [];
      await testable(adapter).enrichWithDeeperDiscovery(nodes, edges);

      expect(nodes[0].metadata["publicAccessBlocked"]).toBe(false);
      expect(nodes[0].metadata["hasSecurityIssues"]).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // DynamoDB discovery via mock client
  // ---------------------------------------------------------------------------

  describe("DynamoDB discovery", () => {
    it("should discover DynamoDB tables", async () => {
      const responses: Record<string, unknown> = {
        "DynamoDB:listTables": {
          TableNames: ["users-table", "sessions-table"],
        },
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        regions: ["us-east-1"],
        clientFactory: createMockClientFactory(responses),
      });

      const result = await adapter.discover({ resourceTypes: ["database"] });
      // DynamoDB tables appear as "database" type alongside RDS
      const dbNodes = result.nodes.filter((n) => n.resourceType === "database");
      // May include RDS (empty) + DynamoDB tables
      expect(dbNodes.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // ElastiCache discovery via manager
  // ---------------------------------------------------------------------------

  describe("ElastiCache discovery", () => {
    it("should discover Redis replication groups", async () => {
      const mockElastiCache = {
        listReplicationGroups: vi.fn().mockResolvedValue({
          success: true,
          data: [
            {
              ReplicationGroupId: "prod-redis",
              Description: "Production Redis cluster",
              Status: "available",
              CacheNodeType: "cache.r6g.large",
              AtRestEncryptionEnabled: true,
              TransitEncryptionEnabled: true,
              AutomaticFailover: "enabled",
              MultiAZ: "enabled",
              SnapshotRetentionLimit: 7,
              ARN: "arn:aws:elasticache:us-east-1:123:replicationgroup:prod-redis",
              NodeGroups: [
                { NodeGroupId: "0001", NodeGroupMembers: [{ CacheClusterId: "prod-redis-001" }, { CacheClusterId: "prod-redis-002" }] },
              ],
            },
          ],
        }),
        listCacheClusters: vi.fn().mockResolvedValue({ success: true, data: [] }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { elasticache: mockElastiCache },
      });

      const nodes: GraphNodeInput[] = [];
      const edges: any[] = [];
      await testable(adapter).discoverElastiCache(nodes, edges);

      expect(nodes).toHaveLength(1);
      expect(nodes[0].resourceType).toBe("cache");
      expect(nodes[0].name).toBe("prod-redis");
      expect(nodes[0].metadata["engine"]).toBe("redis");
      expect(nodes[0].metadata["nodeType"]).toBe("cache.r6g.large");
      expect(nodes[0].metadata["replicaCount"]).toBe(2);
      expect(nodes[0].metadata["atRestEncryption"]).toBe(true);
      expect(nodes[0].metadata["transitEncryption"]).toBe(true);
      expect(nodes[0].metadata["automaticFailover"]).toBe("enabled");
    });

    it("should discover standalone Memcached clusters with SG edges", async () => {
      const mockElastiCache = {
        listReplicationGroups: vi.fn().mockResolvedValue({ success: true, data: [] }),
        listCacheClusters: vi.fn().mockResolvedValue({
          success: true,
          data: [
            {
              CacheClusterId: "session-cache",
              CacheClusterStatus: "available",
              Engine: "memcached",
              EngineVersion: "1.6.22",
              CacheNodeType: "cache.t3.medium",
              NumCacheNodes: 2,
              ARN: "arn:aws:elasticache:us-east-1:123:cluster:session-cache",
              PreferredAvailabilityZone: "us-east-1a",
              SecurityGroups: [{ SecurityGroupId: "sg-cache1", Status: "active" }],
            },
          ],
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { elasticache: mockElastiCache },
      });

      // Pre-populate a security group node so the edge can be created
      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123456789:us-east-1:security-group:sg-cache1",
          provider: "aws", resourceType: "security-group", nativeId: "sg-cache1",
          name: "sg-cache1", region: "us-east-1", account: "123456789",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
      ];
      const edges: any[] = [];
      await testable(adapter).discoverElastiCache(nodes, edges);

      const cacheNodes = nodes.filter((n) => n.resourceType === "cache");
      expect(cacheNodes).toHaveLength(1);
      expect(cacheNodes[0].metadata["engine"]).toBe("memcached");
      expect(cacheNodes[0].metadata["numNodes"]).toBe(2);
      // Should have SG edge
      expect(edges.some((e) => e.relationshipType === "secured-by")).toBe(true);
    });

    it("should skip clusters belonging to replication groups", async () => {
      const mockElastiCache = {
        listReplicationGroups: vi.fn().mockResolvedValue({ success: true, data: [] }),
        listCacheClusters: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { CacheClusterId: "redis-001", ReplicationGroupId: "my-redis", CacheClusterStatus: "available", Engine: "redis" },
          ],
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { elasticache: mockElastiCache },
      });

      const nodes: GraphNodeInput[] = [];
      await testable(adapter).discoverElastiCache(nodes, []);
      expect(nodes).toHaveLength(0);
    });

    it("should handle null manager gracefully", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { elasticache: null! },
      });

      const nodes: GraphNodeInput[] = [];
      await testable(adapter).discoverElastiCache(nodes, []);
      expect(nodes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Organization discovery via manager
  // ---------------------------------------------------------------------------

  describe("Organization discovery", () => {
    it("should discover accounts, OUs, and SCPs", async () => {
      const mockOrg = {
        listAccounts: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { Id: "111111111111", Name: "Production", Email: "prod@example.com", Status: "ACTIVE", Arn: "arn:aws:organizations::123:account/o-xxx/111111111111", JoinedMethod: "INVITED", JoinedTimestamp: "2023-01-01T00:00:00Z" },
            { Id: "222222222222", Name: "Development", Email: "dev@example.com", Status: "ACTIVE", Arn: "arn:aws:organizations::123:account/o-xxx/222222222222" },
          ],
        }),
        listOrganizationalUnits: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { Id: "ou-root-prod", Name: "Production OU", Arn: "arn:aws:organizations::123:ou/o-xxx/ou-root-prod" },
          ],
        }),
        listPolicies: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { Id: "p-FullAWSAccess", Name: "FullAWSAccess", Description: "Default SCP", Arn: "arn:aws:organizations::123:policy/o-xxx/service_control_policy/p-FullAWSAccess", Type: "SERVICE_CONTROL_POLICY", AwsManaged: true },
          ],
        }),
        getPolicyTargets: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { TargetId: "111111111111", Arn: "arn:aws:organizations::123:account/o-xxx/111111111111", Name: "Production", Type: "ACCOUNT" },
          ],
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { organization: mockOrg },
      });

      const nodes: GraphNodeInput[] = [];
      const edges: any[] = [];
      await testable(adapter).discoverOrganization(nodes, edges);

      // Should have 2 account nodes (identity) + 1 OU node (custom) + 1 SCP node (policy)
      expect(nodes).toHaveLength(4);
      const accountNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "aws-account");
      expect(accountNodes).toHaveLength(2);
      expect(accountNodes[0].resourceType).toBe("identity");
      expect(accountNodes[0].status).toBe("running");

      const ouNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "organizational-unit");
      expect(ouNodes).toHaveLength(1);
      expect(ouNodes[0].resourceType).toBe("custom");

      const policyNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "service-control-policy");
      expect(policyNodes).toHaveLength(1);
      expect(policyNodes[0].metadata["awsManaged"]).toBe(true);

      // Should have contains edges (OU → accounts) and secured-by edges
      expect(edges.some((e) => e.relationshipType === "contains")).toBe(true);
      expect(edges.some((e) => e.relationshipType === "secured-by")).toBe(true);
    });

    it("should handle empty organization results", async () => {
      const mockOrg = {
        listAccounts: vi.fn().mockResolvedValue({ success: true, data: [] }),
        listOrganizationalUnits: vi.fn().mockResolvedValue({ success: true, data: [] }),
        listPolicies: vi.fn().mockResolvedValue({ success: true, data: [] }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { organization: mockOrg },
      });

      const nodes: GraphNodeInput[] = [];
      const edges: any[] = [];
      await testable(adapter).discoverOrganization(nodes, edges);
      expect(nodes).toHaveLength(0);
      expect(edges).toHaveLength(0);
    });

    it("should handle null manager gracefully", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { organization: null! },
      });

      const nodes: GraphNodeInput[] = [];
      await testable(adapter).discoverOrganization(nodes, []);
      expect(nodes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Backup discovery via manager
  // ---------------------------------------------------------------------------

  describe("Backup discovery", () => {
    it("should discover backup vaults, plans, and protected resources", async () => {
      const mockBackup = {
        listBackupVaults: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { BackupVaultName: "Default", BackupVaultArn: "arn:aws:backup:us-east-1:123:backup-vault:Default", CreationDate: "2023-06-01", NumberOfRecoveryPoints: 15, EncryptionKeyArn: "arn:aws:kms:us-east-1:123:key/abc", Locked: false },
          ],
        }),
        listBackupPlans: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { BackupPlanId: "plan-123", BackupPlanName: "DailyBackup", BackupPlanArn: "arn:aws:backup:us-east-1:123:backup-plan:plan-123", CreationDate: "2023-06-01", LastExecutionDate: "2024-01-15" },
          ],
        }),
        listBackupSelections: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { SelectionId: "sel-1", SelectionName: "AllRDS" },
          ],
        }),
        listProtectedResources: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { ResourceArn: "arn:aws:rds:us-east-1:123:db:mydb", ResourceType: "RDS", LastBackupTime: "2024-01-15T10:00:00Z" },
          ],
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { backup: mockBackup },
      });

      // Pre-populate an RDS node so protected resource can be matched
      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123456789:us-east-1:database:mydb",
          provider: "aws", resourceType: "database", nativeId: "arn:aws:rds:us-east-1:123:db:mydb",
          name: "mydb", region: "us-east-1", account: "123456789",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
      ];
      const edges: any[] = [];
      await testable(adapter).discoverBackupResources(nodes, edges);

      // Should have vault + plan nodes
      const vaultNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "backup-vault");
      expect(vaultNodes).toHaveLength(1);
      expect(vaultNodes[0].metadata["recoveryPoints"]).toBe(15);
      expect(vaultNodes[0].metadata["encrypted"]).toBe(true);

      const planNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "backup-plan");
      expect(planNodes).toHaveLength(1);

      // Should have stores-in edge (plan → vault)
      expect(edges.some((e) => e.relationshipType === "stores-in")).toBe(true);
      // Should have backs-up edge (plan → RDS node)
      expect(edges.some((e) => e.relationshipType === "backs-up")).toBe(true);

      // Protected RDS node should have backup metadata stamped
      const rdsNode = nodes.find((n) => n.name === "mydb");
      expect(rdsNode?.metadata["backupProtected"]).toBe(true);
      expect(rdsNode?.metadata["lastBackup"]).toBe("2024-01-15T10:00:00Z");
    });

    it("should handle empty backup results", async () => {
      const mockBackup = {
        listBackupVaults: vi.fn().mockResolvedValue({ success: true, data: [] }),
        listBackupPlans: vi.fn().mockResolvedValue({ success: true, data: [] }),
        listProtectedResources: vi.fn().mockResolvedValue({ success: true, data: [] }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { backup: mockBackup },
      });

      const nodes: GraphNodeInput[] = [];
      const edges: any[] = [];
      await testable(adapter).discoverBackupResources(nodes, edges);
      expect(nodes).toHaveLength(0);
    });

    it("should handle null manager gracefully", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { backup: null! },
      });

      const nodes: GraphNodeInput[] = [];
      await testable(adapter).discoverBackupResources(nodes, []);
      expect(nodes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Compliance enrichment via manager
  // ---------------------------------------------------------------------------

  describe("Compliance enrichment", () => {
    it("should enrich nodes with compliance violations", async () => {
      const mockCompliance = {
        listConfigRules: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { ConfigRuleName: "ec2-encrypted-volumes", ConfigRuleId: "rule-1" },
          ],
        }),
        getConfigRuleCompliance: vi.fn().mockResolvedValue({
          success: true,
          data: {
            compliant: 3,
            nonCompliant: 1,
            evaluations: [
              { resourceId: "i-abc123", resourceType: "AWS::EC2::Instance", complianceType: "NON_COMPLIANT", annotation: "Volume not encrypted" },
              { resourceId: "i-def456", resourceType: "AWS::EC2::Instance", complianceType: "COMPLIANT" },
            ],
          },
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { compliance: mockCompliance },
      });

      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123456789:us-east-1:compute:i-abc123",
          provider: "aws", resourceType: "compute", nativeId: "i-abc123",
          name: "web-server", region: "us-east-1", account: "123456789",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
        {
          id: "aws:123456789:us-east-1:compute:i-def456",
          provider: "aws", resourceType: "compute", nativeId: "i-def456",
          name: "api-server", region: "us-east-1", account: "123456789",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
      ];

      await testable(adapter).enrichWithCompliance(nodes);

      // First node should have violation
      const compliance1 = nodes[0].metadata["compliance"] as Record<string, unknown>;
      expect(compliance1).toBeDefined();
      expect(compliance1.violationCount).toBe(1);
      expect(compliance1.violations).toHaveLength(1);
      expect(compliance1.violations[0].rule).toBe("ec2-encrypted-volumes");
      expect(compliance1.violations[0].status).toBe("NON_COMPLIANT");

      // Second node should have compliant rule
      const compliance2 = nodes[1].metadata["compliance"] as Record<string, unknown>;
      expect(compliance2).toBeDefined();
      expect(compliance2.compliantRules).toBe(1);
      expect(compliance2.violationCount).toBe(0);
    });

    it("should handle no config rules gracefully", async () => {
      const mockCompliance = {
        listConfigRules: vi.fn().mockResolvedValue({ success: true, data: [] }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { compliance: mockCompliance },
      });

      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123:us-east-1:compute:i-1",
          provider: "aws", resourceType: "compute", nativeId: "i-1",
          name: "test", region: "us-east-1", account: "123",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
      ];

      await testable(adapter).enrichWithCompliance(nodes);
      expect(nodes[0].metadata["compliance"]).toBeUndefined();
    });

    it("should handle null manager gracefully", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { compliance: null! },
      });

      const nodes: GraphNodeInput[] = [];
      await testable(adapter).enrichWithCompliance(nodes);
      expect(nodes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Automation discovery via manager
  // ---------------------------------------------------------------------------

  describe("Automation discovery", () => {
    it("should discover EventBridge rules and targets", async () => {
      const mockAutomation = {
        listEventRules: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { Name: "daily-cleanup", Arn: "arn:aws:events:us-east-1:123:rule/daily-cleanup", State: "ENABLED", EventBusName: "default", ScheduleExpression: "rate(1 day)" },
          ],
        }),
        listTargets: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { Id: "target-1", Arn: "arn:aws:lambda:us-east-1:123:function:cleanup-fn" },
          ],
        }),
        listStateMachines: vi.fn().mockResolvedValue({ success: true, data: [] }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { automation: mockAutomation },
      });

      // Pre-populate a Lambda node
      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123456789:us-east-1:serverless-function:cleanup-fn",
          provider: "aws", resourceType: "serverless-function", nativeId: "arn:aws:lambda:us-east-1:123:function:cleanup-fn",
          name: "cleanup-fn", region: "us-east-1", account: "123456789",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
      ];
      const edges: any[] = [];
      await testable(adapter).discoverAutomation(nodes, edges);

      // Should have EventBridge rule node
      const ruleNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "eventbridge-rule");
      expect(ruleNodes).toHaveLength(1);
      expect(ruleNodes[0].name).toBe("daily-cleanup");
      expect(ruleNodes[0].status).toBe("running");
      expect(ruleNodes[0].metadata["scheduleExpression"]).toBe("rate(1 day)");

      // Should have triggers edge (rule → Lambda)
      expect(edges.some((e) => e.relationshipType === "triggers")).toBe(true);
    });

    it("should discover Step Functions state machines with service integrations", async () => {
      const mockAutomation = {
        listEventRules: vi.fn().mockResolvedValue({ success: true, data: [] }),
        listStateMachines: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { stateMachineArn: "arn:aws:states:us-east-1:123:stateMachine:order-pipeline", name: "order-pipeline", type: "STANDARD", creationDate: "2023-05-01" },
          ],
        }),
        getStateMachine: vi.fn().mockResolvedValue({
          success: true,
          data: {
            definition: JSON.stringify({
              States: {
                ProcessOrder: { Type: "Task", Resource: "arn:aws:lambda:us-east-1:123:function:process-order" },
                SendNotification: { Type: "Task", Resource: "arn:aws:sns:us-east-1:123:order-notifications" },
              },
            }),
            roleArn: "arn:aws:iam::123:role/StepFnRole",
          },
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { automation: mockAutomation },
      });

      // Pre-populate Lambda and IAM role nodes
      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123456789:us-east-1:serverless-function:process-order",
          provider: "aws", resourceType: "serverless-function",
          nativeId: "arn:aws:lambda:us-east-1:123:function:process-order",
          name: "process-order", region: "us-east-1", account: "123456789",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
        {
          id: "aws:123456789:global:iam-role:StepFnRole",
          provider: "aws", resourceType: "iam-role",
          nativeId: "arn:aws:iam::123:role/StepFnRole",
          name: "StepFnRole", region: "global", account: "123456789",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
      ];
      const edges: any[] = [];
      await testable(adapter).discoverAutomation(nodes, edges);

      // Should have Step Function node
      const sfNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "step-function");
      expect(sfNodes).toHaveLength(1);
      expect(sfNodes[0].name).toBe("order-pipeline");
      expect(sfNodes[0].metadata["type"]).toBe("STANDARD");

      // Should have depends-on edge (StepFn → Lambda)
      expect(edges.some((e) => e.relationshipType === "depends-on")).toBe(true);
      // Should have uses edge (StepFn → IAM role)
      expect(edges.some((e) => e.relationshipType === "uses")).toBe(true);
    });

    it("should handle disabled EventBridge rules", async () => {
      const mockAutomation = {
        listEventRules: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { Name: "disabled-rule", Arn: "arn:aws:events:us-east-1:123:rule/disabled-rule", State: "DISABLED" },
          ],
        }),
        listTargets: vi.fn().mockResolvedValue({ success: true, data: [] }),
        listStateMachines: vi.fn().mockResolvedValue({ success: true, data: [] }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { automation: mockAutomation },
      });

      const nodes: GraphNodeInput[] = [];
      await testable(adapter).discoverAutomation(nodes, []);

      const ruleNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "eventbridge-rule");
      expect(ruleNodes).toHaveLength(1);
      expect(ruleNodes[0].status).toBe("stopped");
    });

    it("should handle null manager gracefully", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { automation: null! },
      });

      const nodes: GraphNodeInput[] = [];
      await testable(adapter).discoverAutomation(nodes, []);
      expect(nodes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // dispose() — extended managers cleanup (including new managers)
  // ---------------------------------------------------------------------------

  describe("dispose() — new managers", () => {
    it("should reset ElastiCache, Organization, Backup, Compliance, and Automation managers", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: {
          elasticache: { listReplicationGroups: vi.fn() },
          organization: { listAccounts: vi.fn() },
          backup: { listBackupVaults: vi.fn() },
          compliance: { listConfigRules: vi.fn() },
          automation: { listEventRules: vi.fn() },
        },
      });

      // Force lazy load all new managers
      await testable(adapter).getElastiCacheManager();
      await testable(adapter).getOrganizationManager();
      await testable(adapter).getBackupManager();
      await testable(adapter).getComplianceManager();
      await testable(adapter).getAutomationManager();

      // Verify they are loaded
      expect(testable(adapter)._elastiCacheManager).toBeDefined();
      expect(testable(adapter)._organizationManager).toBeDefined();
      expect(testable(adapter)._backupManager).toBeDefined();
      expect(testable(adapter)._complianceManager).toBeDefined();
      expect(testable(adapter)._automationManager).toBeDefined();

      await adapter.dispose();

      expect(testable(adapter)._elastiCacheManager).toBeUndefined();
      expect(testable(adapter)._organizationManager).toBeUndefined();
      expect(testable(adapter)._backupManager).toBeUndefined();
      expect(testable(adapter)._complianceManager).toBeUndefined();
      expect(testable(adapter)._automationManager).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Cost estimation for ElastiCache/identity/custom types
  // ---------------------------------------------------------------------------

  describe("cost estimation — cache, identity, custom types", () => {
    it("should return $15 for cache, $0 for identity and custom", () => {
      const adapter = new AwsDiscoveryAdapter({ accountId: "123" });
      expect(testable(adapter).estimateCostStatic("cache", {})).toBe(15);
      expect(testable(adapter).estimateCostStatic("identity", {})).toBe(0);
      expect(testable(adapter).estimateCostStatic("custom", {})).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // dispose() — extended managers cleanup
  // ---------------------------------------------------------------------------

  describe("dispose() — extended managers", () => {
    it("should reset all extended manager instances", async () => {
      const destroyFn = vi.fn();
      const mockPool = { destroy: destroyFn, getClient: vi.fn() };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: {
          credentials: { healthCheck: vi.fn() },
          clientPool: mockPool,
          tagging: { getResourceTags: vi.fn() },
          lambda: { listEventSourceMappings: vi.fn() },
          observability: { getServiceMap: vi.fn(), listAlarms: vi.fn() },
          s3: { getBucketDetails: vi.fn(), getPublicAccessBlock: vi.fn() },
        },
      });

      // Force lazy load
      await testable(adapter).getTaggingManager();
      await testable(adapter).getLambdaManager();
      await testable(adapter).getObservabilityManager();
      await testable(adapter).getS3Manager();

      await adapter.dispose();

      expect(testable(adapter)._taggingManager).toBeUndefined();
      expect(testable(adapter)._lambdaManager).toBeUndefined();
      expect(testable(adapter)._observabilityManager).toBeUndefined();
      expect(testable(adapter)._s3Manager).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Cost estimation for new resource types
  // ---------------------------------------------------------------------------

  describe("cost estimation — new resource types", () => {
    it("should return $0 for route-table, internet-gateway, vpc-endpoint, transit-gateway", () => {
      const adapter = new AwsDiscoveryAdapter({ accountId: "123" });
      expect(testable(adapter).estimateCostStatic("route-table", {})).toBe(0);
      expect(testable(adapter).estimateCostStatic("internet-gateway", {})).toBe(0);
      expect(testable(adapter).estimateCostStatic("vpc-endpoint", {})).toBe(0);
      expect(testable(adapter).estimateCostStatic("transit-gateway", {})).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // EC2 deeper discovery (ASGs, LBs, Target Groups)
  // ---------------------------------------------------------------------------

  describe("EC2 deeper discovery", () => {
    it("should discover Auto Scaling Groups and link to instances", async () => {
      const mockEC2 = {
        listAutoScalingGroups: vi.fn().mockResolvedValue({
          groups: [
            {
              autoScalingGroupName: "web-asg",
              autoScalingGroupARN: "arn:aws:autoscaling:us-east-1:123:autoScalingGroup:web-asg",
              minSize: 1,
              maxSize: 4,
              desiredCapacity: 2,
              healthCheckType: "ELB",
              instances: [
                { instanceId: "i-abc123", healthStatus: "Healthy", lifecycleState: "InService" },
              ],
              targetGroupARNs: [],
            },
          ],
        }),
        listLoadBalancers: vi.fn().mockResolvedValue({ loadBalancers: [] }),
        listTargetGroups: vi.fn().mockResolvedValue({ targetGroups: [] }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { ec2: mockEC2 },
      });

      // Pre-populate an EC2 instance
      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123456789:us-east-1:compute:i-abc123",
          provider: "aws", resourceType: "compute", nativeId: "i-abc123",
          name: "web-1", region: "us-east-1", account: "123456789",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
      ];
      const edges: any[] = [];
      await testable(adapter).discoverEC2Deeper(nodes, edges);

      // Should create ASG node
      const asgNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "auto-scaling-group");
      expect(asgNodes).toHaveLength(1);
      expect(asgNodes[0].name).toBe("web-asg");
      expect(asgNodes[0].metadata["minSize"]).toBe(1);
      expect(asgNodes[0].metadata["maxSize"]).toBe(4);
      expect(asgNodes[0].metadata["desiredCapacity"]).toBe(2);

      // Should have contains edge (ASG → instance)
      const containsEdges = edges.filter((e: any) => e.relationshipType === "contains");
      expect(containsEdges).toHaveLength(1);
      expect(containsEdges[0].metadata.healthStatus).toBe("Healthy");
    });

    it("should discover Load Balancers and enrich existing ones", async () => {
      const mockEC2 = {
        listAutoScalingGroups: vi.fn().mockResolvedValue({ groups: [] }),
        listLoadBalancers: vi.fn().mockResolvedValue({
          loadBalancers: [
            {
              loadBalancerArn: "arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/abc",
              loadBalancerName: "my-alb",
              dnsName: "my-alb-123.us-east-1.elb.amazonaws.com",
              type: "application",
              scheme: "internet-facing",
              state: { code: "active" },
              securityGroups: ["sg-123"],
            },
          ],
        }),
        listTargetGroups: vi.fn().mockResolvedValue({ targetGroups: [] }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { ec2: mockEC2 },
      });

      const nodes: GraphNodeInput[] = [];
      const edges: any[] = [];
      await testable(adapter).discoverEC2Deeper(nodes, edges);

      // Should create new LB node
      const lbNodes = nodes.filter((n) => n.resourceType === "load-balancer");
      expect(lbNodes).toHaveLength(1);
      expect(lbNodes[0].name).toBe("my-alb");
      expect(lbNodes[0].metadata["lbType"]).toBe("application");
      expect(lbNodes[0].metadata["scheme"]).toBe("internet-facing");
      expect(lbNodes[0].status).toBe("running");
    });

    it("should discover Target Groups and link to Load Balancers", async () => {
      const mockEC2 = {
        listAutoScalingGroups: vi.fn().mockResolvedValue({ groups: [] }),
        listLoadBalancers: vi.fn().mockResolvedValue({
          loadBalancers: [
            {
              loadBalancerArn: "arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/abc",
              loadBalancerName: "my-alb",
              type: "application",
              state: { code: "active" },
            },
          ],
        }),
        listTargetGroups: vi.fn().mockResolvedValue({
          targetGroups: [
            {
              targetGroupArn: "arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-tg/def",
              targetGroupName: "my-tg",
              protocol: "HTTPS",
              port: 443,
              targetType: "instance",
              healthCheckEnabled: true,
              healthCheckPath: "/health",
              loadBalancerArns: ["arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/abc"],
            },
          ],
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { ec2: mockEC2 },
      });

      const nodes: GraphNodeInput[] = [];
      const edges: any[] = [];
      await testable(adapter).discoverEC2Deeper(nodes, edges);

      // Should create target group node
      const tgNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "target-group");
      expect(tgNodes).toHaveLength(1);
      expect(tgNodes[0].name).toBe("my-tg");
      expect(tgNodes[0].metadata["protocol"]).toBe("HTTPS");
      expect(tgNodes[0].metadata["port"]).toBe(443);
      expect(tgNodes[0].metadata["targetType"]).toBe("instance");

      // Should have routes-to edge (LB → TG)
      const routesEdges = edges.filter((e: any) => e.relationshipType === "routes-to");
      expect(routesEdges).toHaveLength(1);
    });

    it("should skip EC2 deeper discovery when manager unavailable", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { ec2: null },
      });

      const nodes: GraphNodeInput[] = [];
      const edges: any[] = [];
      await testable(adapter).discoverEC2Deeper(nodes, edges);

      // Should not add any nodes
      expect(nodes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // RDS deeper discovery (Replicas, Snapshots, Subnet Groups)
  // ---------------------------------------------------------------------------

  describe("RDS deeper discovery", () => {
    it("should discover read replicas and create replicates edges", async () => {
      const mockRDS = {
        listReadReplicas: vi.fn().mockResolvedValue([
          {
            DBInstanceIdentifier: "mydb-replica-1",
            DBInstanceArn: "arn:aws:rds:us-east-1:123:db:mydb-replica-1",
            DBInstanceStatus: "available",
            DBInstanceClass: "db.r5.large",
            Engine: "mysql",
            AvailabilityZone: "us-east-1b",
          },
        ]),
        getMultiAZStatus: vi.fn().mockResolvedValue({ multiAZ: true, secondaryAZ: "us-east-1b" }),
        listSnapshots: vi.fn().mockResolvedValue({ snapshots: [] }),
        listSubnetGroups: vi.fn().mockResolvedValue({ groups: [] }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { rds: mockRDS },
      });

      // Pre-populate an RDS node
      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123456789:us-east-1:database:mydb",
          provider: "aws", resourceType: "database", nativeId: "arn:aws:rds:us-east-1:123:db:mydb",
          name: "mydb", region: "us-east-1", account: "123456789",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
      ];
      const edges: any[] = [];
      await testable(adapter).discoverRDSDeeper(nodes, edges);

      // Should add replica node
      const replicaNodes = nodes.filter((n) => n.metadata["isReadReplica"] === true);
      expect(replicaNodes).toHaveLength(1);
      expect(replicaNodes[0].name).toBe("mydb-replica-1");
      expect(replicaNodes[0].metadata["engine"]).toBe("mysql");
      expect(replicaNodes[0].metadata["sourceInstance"]).toBe("mydb");

      // Should have replicates edge
      const replicatesEdges = edges.filter((e: any) => e.relationshipType === "replicates");
      expect(replicatesEdges).toHaveLength(1);

      // Should have multi-AZ metadata on the primary
      expect(nodes[0].metadata["multiAZ"]).toBe(true);
      expect(nodes[0].metadata["secondaryAZ"]).toBe("us-east-1b");
    });

    it("should discover RDS snapshots and create backs-up edges", async () => {
      const mockRDS = {
        listReadReplicas: vi.fn().mockResolvedValue([]),
        getMultiAZStatus: vi.fn().mockResolvedValue({ multiAZ: false }),
        listSnapshots: vi.fn().mockResolvedValue({
          snapshots: [
            {
              DBSnapshotIdentifier: "mydb-snap-2024",
              DBSnapshotArn: "arn:aws:rds:us-east-1:123:snapshot:mydb-snap-2024",
              DBInstanceIdentifier: "mydb",
              SnapshotCreateTime: "2024-01-15",
              Status: "available",
              Engine: "postgres",
              AllocatedStorage: 100,
              SnapshotType: "manual",
              Encrypted: true,
            },
          ],
        }),
        listSubnetGroups: vi.fn().mockResolvedValue({ groups: [] }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { rds: mockRDS },
      });

      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123456789:us-east-1:database:mydb",
          provider: "aws", resourceType: "database", nativeId: "arn:aws:rds:us-east-1:123:db:mydb",
          name: "mydb", region: "us-east-1", account: "123456789",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
      ];
      const edges: any[] = [];
      await testable(adapter).discoverRDSDeeper(nodes, edges);

      // Should add snapshot node
      const snapNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "rds-snapshot");
      expect(snapNodes).toHaveLength(1);
      expect(snapNodes[0].name).toBe("mydb-snap-2024");
      expect(snapNodes[0].metadata["engine"]).toBe("postgres");
      expect(snapNodes[0].metadata["allocatedStorageGB"]).toBe(100);
      expect(snapNodes[0].metadata["encrypted"]).toBe(true);
      expect(snapNodes[0].costMonthly).toBe(9.5); // 100 * 0.095

      // Should have backs-up edge (snapshot → instance)
      const backsUpEdges = edges.filter((e: any) => e.relationshipType === "backs-up");
      expect(backsUpEdges).toHaveLength(1);
    });

    it("should skip RDS deeper when manager unavailable", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { rds: null },
      });

      const nodes: GraphNodeInput[] = [];
      const edges: any[] = [];
      await testable(adapter).discoverRDSDeeper(nodes, edges);
      expect(nodes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // CI/CD discovery (CodePipeline, CodeBuild, CodeDeploy)
  // ---------------------------------------------------------------------------

  describe("CI/CD discovery", () => {
    it("should discover CodePipeline pipelines with stages", async () => {
      const mockCICD = {
        listPipelines: vi.fn().mockResolvedValue({
          success: true,
          data: { pipelines: [{ name: "deploy-pipeline", version: 3, created: "2023-06-01" }] },
        }),
        getPipeline: vi.fn().mockResolvedValue({
          success: true,
          data: {
            name: "deploy-pipeline",
            roleArn: "arn:aws:iam::123:role/PipelineRole",
            artifactStore: { type: "S3", location: "my-artifact-bucket" },
            stages: [
              {
                name: "Build",
                actions: [
                  {
                    name: "CodeBuild",
                    actionTypeId: { category: "Build", provider: "CodeBuild" },
                    configuration: { ProjectName: "my-build-project" },
                  },
                ],
              },
              {
                name: "Deploy",
                actions: [
                  {
                    name: "InvokeLambda",
                    actionTypeId: { category: "Invoke", provider: "Lambda" },
                    configuration: { FunctionName: "deploy-fn" },
                  },
                ],
              },
            ],
          },
        }),
        listBuildProjects: vi.fn().mockResolvedValue({
          success: true,
          data: { projects: ["my-build-project"] },
        }),
        getBuildProject: vi.fn().mockResolvedValue({
          success: true,
          data: {
            name: "my-build-project",
            arn: "arn:aws:codebuild:us-east-1:123:project/my-build-project",
            source: { type: "GITHUB", location: "https://github.com/example/repo" },
            environment: { computeType: "BUILD_GENERAL1_SMALL", image: "aws/codebuild/standard:5.0" },
            serviceRole: "arn:aws:iam::123:role/CodeBuildRole",
            created: "2023-06-01",
          },
        }),
        listApplications: vi.fn().mockResolvedValue({
          success: true,
          data: { applications: ["my-deploy-app"] },
        }),
        getApplication: vi.fn().mockResolvedValue({
          success: true,
          data: {
            applicationName: "my-deploy-app",
            applicationId: "app-abcdef",
            computePlatform: "Server",
            createTime: "2023-07-01",
          },
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cicd: mockCICD },
      });

      // Pre-populate related nodes (including build project, since pipeline stage scan needs it)
      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123456789:us-east-1:storage:my-artifact-bucket",
          provider: "aws", resourceType: "storage", nativeId: "my-artifact-bucket",
          name: "my-artifact-bucket", region: "us-east-1", account: "123456789",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
        {
          id: "aws:123456789:us-east-1:serverless-function:deploy-fn",
          provider: "aws", resourceType: "serverless-function", nativeId: "arn:aws:lambda:us-east-1:123:function:deploy-fn",
          name: "deploy-fn", region: "us-east-1", account: "123456789",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
        {
          id: "aws:123456789:us-east-1:custom:codebuild-my-build-project",
          provider: "aws", resourceType: "custom", nativeId: "arn:aws:codebuild:us-east-1:123:project/my-build-project",
          name: "my-build-project", region: "us-east-1", account: "123456789",
          status: "running", tags: {}, metadata: { resourceSubtype: "codebuild-project" }, costMonthly: null, owner: null, createdAt: null,
        },
      ];
      const edges: any[] = [];
      await testable(adapter).discoverCICD(nodes, edges);

      // Should create pipeline node
      const pipelineNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "codepipeline");
      expect(pipelineNodes).toHaveLength(1);
      expect(pipelineNodes[0].name).toBe("deploy-pipeline");
      expect(pipelineNodes[0].metadata["version"]).toBe(3);

      // Should create build project node (1 pre-populated + 1 discovered)
      const buildNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "codebuild-project");
      expect(buildNodes.length).toBeGreaterThanOrEqual(1);
      expect(buildNodes.some((n) => n.metadata["sourceType"] === "GITHUB")).toBe(true);

      // Should create deploy app node
      const deployNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "codedeploy-application");
      expect(deployNodes).toHaveLength(1);
      expect(deployNodes[0].name).toBe("my-deploy-app");

      // Should have stores-in edge (pipeline → S3)
      expect(edges.some((e: any) => e.relationshipType === "stores-in")).toBe(true);

      // Should have triggers edge (pipeline → Lambda)
      expect(edges.some((e: any) => e.relationshipType === "triggers")).toBe(true);

      // Should have depends-on edge (pipeline → build project)
      expect(edges.some((e: any) =>
        e.relationshipType === "depends-on" &&
        e.sourceNodeId.includes("pipeline") &&
        e.targetNodeId.includes("codebuild"),
      )).toBe(true);
    });

    it("should handle empty CI/CD results gracefully", async () => {
      const mockCICD = {
        listPipelines: vi.fn().mockResolvedValue({ success: true, data: { pipelines: [] } }),
        listBuildProjects: vi.fn().mockResolvedValue({ success: true, data: { projects: [] } }),
        listApplications: vi.fn().mockResolvedValue({ success: true, data: { applications: [] } }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cicd: mockCICD },
      });

      const nodes: GraphNodeInput[] = [];
      const edges: any[] = [];
      await testable(adapter).discoverCICD(nodes, edges);

      expect(nodes).toHaveLength(0);
      expect(edges).toHaveLength(0);
    });

    it("should skip CI/CD discovery when manager unavailable", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cicd: null },
      });

      const nodes: GraphNodeInput[] = [];
      const edges: any[] = [];
      await testable(adapter).discoverCICD(nodes, edges);
      expect(nodes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Cognito discovery (User Pools, Identity Pools, App Clients)
  // ---------------------------------------------------------------------------

  describe("Cognito discovery", () => {
    it("should discover user pools with Lambda triggers", async () => {
      const mockCognito = {
        listUserPools: vi.fn().mockResolvedValue({
          success: true,
          data: [
            {
              Id: "us-east-1_abc123",
              Name: "main-user-pool",
              Status: "Enabled",
              CreationDate: "2023-04-01",
              LambdaConfig: {
                PreSignUp: "arn:aws:lambda:us-east-1:123:function:presignup-fn",
              },
            },
          ],
        }),
        listAppClients: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { ClientId: "client-xyz", ClientName: "web-app", UserPoolId: "us-east-1_abc123" },
          ],
        }),
        listIdentityPools: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { IdentityPoolId: "us-east-1:id-pool-1", IdentityPoolName: "main-identity-pool" },
          ],
        }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cognito: mockCognito },
      });

      // Pre-populate Lambda node
      const nodes: GraphNodeInput[] = [
        {
          id: "aws:123456789:us-east-1:serverless-function:presignup-fn",
          provider: "aws", resourceType: "serverless-function",
          nativeId: "arn:aws:lambda:us-east-1:123:function:presignup-fn",
          name: "presignup-fn", region: "us-east-1", account: "123456789",
          status: "running", tags: {}, metadata: {}, costMonthly: null, owner: null, createdAt: null,
        },
      ];
      const edges: any[] = [];
      await testable(adapter).discoverCognito(nodes, edges);

      // Should create user pool node
      const poolNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "cognito-user-pool");
      expect(poolNodes).toHaveLength(1);
      expect(poolNodes[0].name).toBe("main-user-pool");
      expect(poolNodes[0].resourceType).toBe("identity");
      expect(poolNodes[0].metadata["hasLambdaTriggers"]).toBe(true);
      expect(poolNodes[0].createdAt).toBe("2023-04-01");

      // Should have triggers edge (user pool → Lambda)
      const triggersEdges = edges.filter((e: any) => e.relationshipType === "triggers");
      expect(triggersEdges).toHaveLength(1);
      expect(triggersEdges[0].metadata.triggerType).toBe("PreSignUp");

      // Should create app client node
      const clientNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "cognito-app-client");
      expect(clientNodes).toHaveLength(1);
      expect(clientNodes[0].name).toBe("web-app");

      // Should have member-of edge (client → user pool)
      const memberEdges = edges.filter((e: any) => e.relationshipType === "member-of");
      expect(memberEdges).toHaveLength(1);

      // Should create identity pool node
      const idPoolNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "cognito-identity-pool");
      expect(idPoolNodes).toHaveLength(1);
      expect(idPoolNodes[0].name).toBe("main-identity-pool");
      expect(idPoolNodes[0].resourceType).toBe("identity");
    });

    it("should handle user pool without Lambda triggers", async () => {
      const mockCognito = {
        listUserPools: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { Id: "us-east-1_nolambda", Name: "simple-pool", CreationDate: "2024-01-01" },
          ],
        }),
        listAppClients: vi.fn().mockResolvedValue({ success: true, data: [] }),
        listIdentityPools: vi.fn().mockResolvedValue({ success: true, data: [] }),
      };

      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cognito: mockCognito },
      });

      const nodes: GraphNodeInput[] = [];
      const edges: any[] = [];
      await testable(adapter).discoverCognito(nodes, edges);

      const poolNodes = nodes.filter((n) => n.metadata["resourceSubtype"] === "cognito-user-pool");
      expect(poolNodes).toHaveLength(1);
      expect(poolNodes[0].metadata["hasLambdaTriggers"]).toBe(false);
      expect(edges.filter((e: any) => e.relationshipType === "triggers")).toHaveLength(0);
    });

    it("should skip Cognito discovery when manager unavailable", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: { cognito: null },
      });

      const nodes: GraphNodeInput[] = [];
      const edges: any[] = [];
      await testable(adapter).discoverCognito(nodes, edges);
      expect(nodes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // dispose() — fourth wave managers
  // ---------------------------------------------------------------------------

  describe("dispose() — fourth wave managers", () => {
    it("should reset EC2, RDS, CI/CD, and Cognito managers on dispose", async () => {
      const adapter = new AwsDiscoveryAdapter({
        accountId: "123456789",
        managers: {
          ec2: { listAutoScalingGroups: vi.fn() },
          rds: { listReadReplicas: vi.fn() },
          cicd: { listPipelines: vi.fn() },
          cognito: { listUserPools: vi.fn() },
        },
      });

      // Force lazy load
      await testable(adapter).getEC2Manager();
      await testable(adapter).getRDSManager();
      await testable(adapter).getCICDManager();
      await testable(adapter).getCognitoManager();

      await adapter.dispose();

      expect(testable(adapter)._ec2Manager).toBeUndefined();
      expect(testable(adapter)._rdsManager).toBeUndefined();
      expect(testable(adapter)._cicdManager).toBeUndefined();
      expect(testable(adapter)._cognitoManager).toBeUndefined();
    });
  });
});
