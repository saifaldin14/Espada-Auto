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

import { describe, it, expect } from "vitest";
import {
  resolveFieldPath,
  extractResourceId,
  buildAwsNodeId,
  AwsDiscoveryAdapter,
} from "./adapters/aws.js";
import type { AwsClient, AwsClientFactory } from "./adapters/aws.js";

// =============================================================================
// resolveFieldPath
// =============================================================================

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

    const result = await adapter.discover({ resourceTypes: ["compute"] });
    // Without the real AWS SDK, should get an error
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].message).toContain("AWS SDK");
    expect(result.nodes).toHaveLength(0);
  });
});
