/**
 * Pulumi → Knowledge Graph Bridge — Unit Tests
 */

import { describe, it, expect, vi } from "vitest";
import {
  pulumiTypeToGraphType,
  stateToGraphNodes,
  dependenciesToGraphEdges,
  syncStateToGraph,
  diffGraphVsState,
} from "./graph-bridge.js";
import type { ParsedPulumiResource, GraphStorage, GraphNode } from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────────

function makeResource(overrides: Partial<ParsedPulumiResource> = {}): ParsedPulumiResource {
  return {
    urn: "urn:pulumi:dev::project::aws:ec2/instance:Instance::web-server",
    type: "aws:ec2/instance:Instance",
    name: "web-server",
    provider: "aws",
    id: "i-1234567890abcdef0",
    inputs: {},
    outputs: {
      arn: "arn:aws:ec2:us-east-1:123456789:instance/i-1234567890abcdef0",
      id: "i-1234567890abcdef0",
      name: "web-server",
      region: "us-east-1",
      tags: { env: "dev", app: "web" },
      status: "running",
    },
    dependencies: [],
    ...overrides,
  };
}

function createMockGraphStorage(existingNodes: GraphNode[] = []): GraphStorage {
  return {
    initialize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    upsertNode: vi.fn(async () => {}),
    upsertNodes: vi.fn(async () => {}),
    getNode: vi.fn(async () => null),
    getNodeByNativeId: vi.fn(async () => null),
    queryNodes: vi.fn(async () => existingNodes),
    deleteNode: vi.fn(async () => {}),
    upsertEdge: vi.fn(async () => {}),
    upsertEdges: vi.fn(async () => {}),
    getEdge: vi.fn(async () => null),
    queryEdges: vi.fn(async () => []),
    deleteEdge: vi.fn(async () => {}),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("pulumiTypeToGraphType", () => {
  it("maps known AWS EC2 instance type", () => {
    expect(pulumiTypeToGraphType("aws:ec2/instance:Instance")).toBe("compute");
  });

  it("maps AWS S3 bucket to storage", () => {
    expect(pulumiTypeToGraphType("aws:s3/bucket:Bucket")).toBe("storage");
  });

  it("maps AWS Lambda function to serverless-function", () => {
    expect(pulumiTypeToGraphType("aws:lambda/function:Function")).toBe("serverless-function");
  });

  it("maps AWS VPC to vpc", () => {
    expect(pulumiTypeToGraphType("aws:ec2/vpc:Vpc")).toBe("vpc");
  });

  it("maps Azure VM to compute", () => {
    expect(pulumiTypeToGraphType("azure:compute/virtualMachine:VirtualMachine")).toBe("compute");
  });

  it("maps GCP compute instance to compute", () => {
    expect(pulumiTypeToGraphType("gcp:compute/instance:Instance")).toBe("compute");
  });

  it("maps AWS EKS cluster to cluster", () => {
    expect(pulumiTypeToGraphType("aws:eks/cluster:Cluster")).toBe("cluster");
  });

  it("maps AWS RDS to database", () => {
    expect(pulumiTypeToGraphType("aws:rds/instance:Instance")).toBe("database");
  });

  it("maps AWS SQS to queue", () => {
    expect(pulumiTypeToGraphType("aws:sqs/queue:Queue")).toBe("queue");
  });

  it("returns custom for unknown type", () => {
    expect(pulumiTypeToGraphType("custom:something:Unknown")).toBe("custom");
  });
});

describe("stateToGraphNodes", () => {
  it("converts resources to graph nodes", () => {
    const resources = [makeResource()];
    const nodes = stateToGraphNodes(resources);

    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.provider).toBe("aws");
    expect(node.resourceType).toBe("compute");
    expect(node.name).toBe("web-server");
    expect(node.region).toBe("us-east-1");
    expect(node.status).toBe("running");
    expect(node.nativeId).toBe("arn:aws:ec2:us-east-1:123456789:instance/i-1234567890abcdef0");
  });

  it("sets managedBy and pulumiUrn in metadata", () => {
    const nodes = stateToGraphNodes([makeResource()]);
    const meta = nodes[0]!.metadata as Record<string, unknown>;

    expect(meta.managedBy).toBe("pulumi");
    expect(meta.pulumiUrn).toContain("urn:pulumi:");
    expect(meta.pulumiType).toBe("aws:ec2/instance:Instance");
    expect(meta.pulumiProvider).toBe("aws");
  });

  it("extracts tags from outputs", () => {
    const nodes = stateToGraphNodes([makeResource()]);
    expect(nodes[0]!.tags).toEqual({ env: "dev", app: "web" });
  });

  it("filters out pulumi:providers:* resources", () => {
    const resources = [
      makeResource({ type: "pulumi:providers:*", urn: "urn:pulumi:dev::project::pulumi:providers:aws::default" }),
      makeResource(),
    ];

    const nodes = stateToGraphNodes(resources);
    // The provider resource should be filtered out
    expect(nodes.every((n) => !(n.metadata as Record<string, unknown>).pulumiType?.toString().includes("providers:"))).toBe(true);
  });

  it("maps Azure provider correctly", () => {
    const resource = makeResource({
      type: "azure:compute/virtualMachine:VirtualMachine",
      provider: "azure",
      urn: "urn:pulumi:dev::project::azure:compute/virtualMachine:VirtualMachine::vm1",
      outputs: { id: "vm-123", location: "eastus" },
    });

    const nodes = stateToGraphNodes([resource]);
    expect(nodes[0]!.provider).toBe("azure");
    expect(nodes[0]!.region).toBe("eastus");
  });

  it("maps GCP provider correctly", () => {
    const resource = makeResource({
      type: "gcp:compute/instance:Instance",
      provider: "gcp",
      urn: "urn:pulumi:dev::project::gcp:compute/instance:Instance::vm1",
      outputs: { selfLink: "https://...", project: "my-project", region: "us-central1" },
    });

    const nodes = stateToGraphNodes([resource]);
    expect(nodes[0]!.provider).toBe("gcp");
    expect(nodes[0]!.account).toBe("my-project");
  });

  it("infers stopped status", () => {
    const resource = makeResource({
      outputs: { id: "i-123", status: "stopped" },
    });

    const nodes = stateToGraphNodes([resource]);
    expect(nodes[0]!.status).toBe("stopped");
  });

  it("defaults to running when no status field", () => {
    const resource = makeResource({
      outputs: { id: "i-123" },
    });

    const nodes = stateToGraphNodes([resource]);
    expect(nodes[0]!.status).toBe("running");
  });
});

describe("dependenciesToGraphEdges", () => {
  it("creates depends-on edges from explicit dependencies", () => {
    const parent = makeResource({
      urn: "urn:pulumi:dev::project::aws:ec2/vpc:Vpc::main-vpc",
      type: "aws:ec2/vpc:Vpc",
    });
    const child = makeResource({
      urn: "urn:pulumi:dev::project::aws:ec2/subnet:Subnet::subnet-a",
      type: "aws:ec2/subnet:Subnet",
      dependencies: ["urn:pulumi:dev::project::aws:ec2/vpc:Vpc::main-vpc"],
    });

    const edges = dependenciesToGraphEdges([parent, child]);
    const dependsOnEdges = edges.filter((e) => e.relationshipType === "depends-on");

    expect(dependsOnEdges).toHaveLength(1);
    expect(dependsOnEdges[0]!.discoveredVia).toBe("iac-parse");
    expect(dependsOnEdges[0]!.confidence).toBe(1.0);
  });

  it("creates contains edges from parent relationships", () => {
    const parent = makeResource({
      urn: "urn:pulumi:dev::project::aws:ec2/vpc:Vpc::main-vpc",
      type: "aws:ec2/vpc:Vpc",
    });
    const child = makeResource({
      urn: "urn:pulumi:dev::project::aws:ec2/subnet:Subnet::subnet-a",
      type: "aws:ec2/subnet:Subnet",
      parent: "urn:pulumi:dev::project::aws:ec2/vpc:Vpc::main-vpc",
    });

    const edges = dependenciesToGraphEdges([parent, child]);
    const containsEdges = edges.filter((e) => e.relationshipType === "contains");

    expect(containsEdges).toHaveLength(1);
    expect(containsEdges[0]!.sourceNodeId).toContain("vpc");
  });

  it("skips dependency edges for unknown URNs", () => {
    const resource = makeResource({
      dependencies: ["urn:pulumi:dev::project::unknown:Type::missing"],
    });

    const edges = dependenciesToGraphEdges([resource]);
    const dependsOnEdges = edges.filter((e) => e.relationshipType === "depends-on");
    expect(dependsOnEdges).toHaveLength(0);
  });

  it("returns empty edges for resources with no dependencies", () => {
    const edges = dependenciesToGraphEdges([makeResource()]);
    expect(edges).toHaveLength(0);
  });
});

describe("syncStateToGraph", () => {
  it("upserts nodes and edges to storage", async () => {
    const storage = createMockGraphStorage();
    const parent = makeResource({
      urn: "urn:pulumi:dev::project::aws:ec2/vpc:Vpc::main-vpc",
      type: "aws:ec2/vpc:Vpc",
    });
    const child = makeResource({
      dependencies: [parent.urn],
    });

    const result = await syncStateToGraph(storage, [parent, child]);

    expect(result.nodesUpserted).toBe(2);
    expect(result.edgesUpserted).toBeGreaterThanOrEqual(1);
    expect(storage.upsertNodes).toHaveBeenCalled();
    expect(storage.upsertEdges).toHaveBeenCalled();
  });

  it("skips upsert calls for empty resources", async () => {
    const storage = createMockGraphStorage();
    const result = await syncStateToGraph(storage, []);

    expect(result.nodesUpserted).toBe(0);
    expect(result.edgesUpserted).toBe(0);
    expect(storage.upsertNodes).not.toHaveBeenCalled();
  });
});

describe("diffGraphVsState", () => {
  it("identifies new resources in Pulumi not yet in KG", async () => {
    const storage = createMockGraphStorage([]); // no existing nodes
    const resources = [makeResource()];

    const diff = await diffGraphVsState(storage, resources);
    expect(diff.newInPulumi).toHaveLength(1);
    expect(diff.removedFromPulumi).toHaveLength(0);
    expect(diff.shared).toHaveLength(0);
  });

  it("identifies resources removed from Pulumi but still in KG", async () => {
    const existingNode = {
      id: "aws:compute:dev::project::aws:ec2/instance:Instance::old-server",
      provider: "aws" as const,
      resourceType: "compute" as const,
      nativeId: "i-old",
      name: "old-server",
      region: "us-east-1",
      account: "default",
      status: "running" as const,
      tags: {},
      metadata: { managedBy: "pulumi" },
      costMonthly: null,
      owner: null,
      discoveredAt: new Date().toISOString(),
      createdAt: null,
      updatedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const storage = createMockGraphStorage([existingNode]);
    const resources = [makeResource()]; // doesn't include old-server

    const diff = await diffGraphVsState(storage, resources);
    expect(diff.removedFromPulumi).toHaveLength(1);
  });

  it("identifies shared resources", async () => {
    // Get the node ID that would be generated for our test resource
    const resource = makeResource();
    const nodes = stateToGraphNodes([resource]);
    const expectedId = nodes[0]!.id;

    const existingNode = {
      id: expectedId,
      provider: "aws" as const,
      resourceType: "compute" as const,
      nativeId: "arn:aws:ec2:us-east-1:123456789:instance/i-1234567890abcdef0",
      name: "web-server",
      region: "us-east-1",
      account: "default",
      status: "running" as const,
      tags: {},
      metadata: { managedBy: "pulumi" },
      costMonthly: null,
      owner: null,
      discoveredAt: new Date().toISOString(),
      createdAt: null,
      updatedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const storage = createMockGraphStorage([existingNode]);
    const diff = await diffGraphVsState(storage, [resource]);

    expect(diff.shared).toHaveLength(1);
    expect(diff.newInPulumi).toHaveLength(0);
  });
});
