/**
 * Terraform Graph Bridge — Tests
 */

import { describe, it, expect } from "vitest";
import {
  tfResourceTypeToGraphType,
  stateToGraphNodes,
  dependenciesToGraphEdges,
} from "./graph-bridge.js";
import type { ParsedResource } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────

function makeResource(overrides: Partial<ParsedResource> = {}): ParsedResource {
  return {
    address: "aws_instance.web",
    type: "aws_instance",
    name: "web",
    provider: "registry.terraform.io/hashicorp/aws",
    providerShort: "aws",
    mode: "managed",
    attributes: {
      id: "i-1234567890abcdef0",
      arn: "arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0",
      instance_type: "t3.medium",
      region: "us-east-1",
      account_id: "123456789012",
      tags: { Name: "web-server", Environment: "production" },
    },
    dependencies: [],
    ...overrides,
  };
}

// ── Type Mapping ─────────────────────────────────────────────────

describe("tfResourceTypeToGraphType", () => {
  it("maps known AWS types", () => {
    expect(tfResourceTypeToGraphType("aws_instance")).toBe("compute");
    expect(tfResourceTypeToGraphType("aws_s3_bucket")).toBe("storage");
    expect(tfResourceTypeToGraphType("aws_db_instance")).toBe("database");
    expect(tfResourceTypeToGraphType("aws_lambda_function")).toBe("serverless-function");
    expect(tfResourceTypeToGraphType("aws_vpc")).toBe("vpc");
    expect(tfResourceTypeToGraphType("aws_lb")).toBe("load-balancer");
    expect(tfResourceTypeToGraphType("aws_iam_role")).toBe("iam-role");
    expect(tfResourceTypeToGraphType("aws_sqs_queue")).toBe("queue");
    expect(tfResourceTypeToGraphType("aws_eks_cluster")).toBe("cluster");
  });

  it("maps known Azure types", () => {
    expect(tfResourceTypeToGraphType("azurerm_virtual_machine")).toBe("compute");
    expect(tfResourceTypeToGraphType("azurerm_kubernetes_cluster")).toBe("cluster");
    expect(tfResourceTypeToGraphType("azurerm_storage_account")).toBe("storage");
    expect(tfResourceTypeToGraphType("azurerm_mssql_database")).toBe("database");
  });

  it("maps known GCP types", () => {
    expect(tfResourceTypeToGraphType("google_compute_instance")).toBe("compute");
    expect(tfResourceTypeToGraphType("google_container_cluster")).toBe("cluster");
    expect(tfResourceTypeToGraphType("google_storage_bucket")).toBe("storage");
    expect(tfResourceTypeToGraphType("google_sql_database_instance")).toBe("database");
  });

  it("returns 'custom' for unknown types", () => {
    expect(tfResourceTypeToGraphType("aws_unknown_resource")).toBe("custom");
    expect(tfResourceTypeToGraphType("fancy_widget")).toBe("custom");
  });
});

// ── stateToGraphNodes ────────────────────────────────────────────

describe("stateToGraphNodes", () => {
  it("converts a managed resource into a graph node", () => {
    const resource = makeResource();
    const nodes = stateToGraphNodes([resource]);

    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    expect(node.provider).toBe("aws");
    expect(node.resourceType).toBe("compute");
    expect(node.name).toBe("web-server"); // from tags.Name
    expect(node.region).toBe("us-east-1");
    expect(node.account).toBe("123456789012");
    expect(node.nativeId).toBe("arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0");
    expect(node.status).toBe("running");
    expect(node.metadata).toMatchObject({
      managedBy: "terraform",
      tfAddress: "aws_instance.web",
      tfType: "aws_instance",
    });
  });

  it("skips data sources", () => {
    const resource = makeResource({ mode: "data" });
    const nodes = stateToGraphNodes([resource]);
    expect(nodes).toHaveLength(0);
  });

  it("extracts tags from attributes", () => {
    const resource = makeResource();
    const nodes = stateToGraphNodes([resource]);
    expect(nodes[0].tags).toEqual({ Name: "web-server", Environment: "production" });
  });

  it("handles resources without tags", () => {
    const resource = makeResource({
      attributes: { id: "test-id", region: "us-west-2" },
    });
    const nodes = stateToGraphNodes([resource]);
    expect(nodes[0].tags).toEqual({});
  });

  it("falls back to resource name when no tags.Name", () => {
    const resource = makeResource({
      attributes: { id: "test-id", region: "eu-west-1" },
    });
    const nodes = stateToGraphNodes([resource]);
    expect(nodes[0].name).toBe("web");
  });

  it("maps Azure provider correctly", () => {
    const resource = makeResource({
      type: "azurerm_virtual_machine",
      providerShort: "azurerm",
      attributes: { id: "test", location: "westus2" },
    });
    const nodes = stateToGraphNodes([resource]);
    expect(nodes[0].provider).toBe("azure");
    expect(nodes[0].region).toBe("westus2");
  });

  it("maps GCP provider correctly", () => {
    const resource = makeResource({
      type: "google_compute_instance",
      providerShort: "google",
      attributes: { self_link: "projects/my-proj/zones/us-central1-a/instances/vm1", zone: "us-central1-a", project: "my-proj" },
    });
    const nodes = stateToGraphNodes([resource]);
    expect(nodes[0].provider).toBe("gcp");
    expect(nodes[0].nativeId).toBe("projects/my-proj/zones/us-central1-a/instances/vm1");
    expect(nodes[0].account).toBe("my-proj");
  });
});

// ── dependenciesToGraphEdges ─────────────────────────────────────

describe("dependenciesToGraphEdges", () => {
  it("creates edges for dependencies", () => {
    const vpc = makeResource({
      address: "aws_vpc.main",
      type: "aws_vpc",
      name: "main",
      attributes: { id: "vpc-123", region: "us-east-1", account_id: "123" },
      dependencies: [],
    });
    const instance = makeResource({
      address: "aws_instance.web",
      dependencies: ["aws_vpc.main"],
    });

    const edges = dependenciesToGraphEdges([vpc, instance]);
    expect(edges).toHaveLength(1);
    expect(edges[0].relationshipType).toBe("depends-on");
    expect(edges[0].discoveredVia).toBe("iac-parse");
    expect(edges[0].confidence).toBe(1.0);
    expect(edges[0].metadata).toMatchObject({
      tfSourceAddress: "aws_instance.web",
      tfTargetAddress: "aws_vpc.main",
    });
  });

  it("skips dependencies that reference data sources (not in managed set)", () => {
    const instance = makeResource({
      dependencies: ["data.aws_ami.latest"], // data source, won't be in managed resources
    });
    const edges = dependenciesToGraphEdges([instance]);
    expect(edges).toHaveLength(0);
  });

  it("generates deterministic edge IDs", () => {
    const sg = makeResource({
      address: "aws_security_group.web",
      type: "aws_security_group",
      name: "web",
      attributes: { id: "sg-123", region: "us-east-1", account_id: "123" },
    });
    const instance = makeResource({
      dependencies: ["aws_security_group.web"],
    });

    const edges = dependenciesToGraphEdges([sg, instance]);
    expect(edges[0].id).toContain("edge:");
    expect(edges[0].id).toContain("depends-on");
  });

  it("handles multiple dependencies", () => {
    const vpc = makeResource({
      address: "aws_vpc.main",
      type: "aws_vpc",
      name: "main",
      attributes: { id: "vpc-123", region: "us-east-1", account_id: "123" },
    });
    const subnet = makeResource({
      address: "aws_subnet.main",
      type: "aws_subnet",
      name: "main",
      attributes: { id: "subnet-123", region: "us-east-1", account_id: "123" },
      dependencies: ["aws_vpc.main"],
    });
    const instance = makeResource({
      dependencies: ["aws_vpc.main", "aws_subnet.main"],
    });

    const edges = dependenciesToGraphEdges([vpc, subnet, instance]);
    expect(edges).toHaveLength(3); // subnet→vpc, instance→vpc, instance→subnet
  });
});
