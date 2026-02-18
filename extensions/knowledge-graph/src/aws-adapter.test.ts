/**
 * Infrastructure Knowledge Graph — AWS Adapter Utility Tests
 *
 * Tests the production-ready utility functions:
 * - resolveFieldPath
 * - extractResourceId
 * - buildAwsNodeId
 * - extractRelationships
 */

import { describe, it, expect } from "vitest";
import {
  resolveFieldPath,
  extractResourceId,
  buildAwsNodeId,
  AwsDiscoveryAdapter,
} from "./adapters/aws.js";

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
