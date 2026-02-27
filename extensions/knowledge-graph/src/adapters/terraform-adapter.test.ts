/**
 * Infrastructure Knowledge Graph — Terraform Adapter Tests
 *
 * Tests Terraform state parsing, type mapping, relationship extraction,
 * cost estimation, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TerraformDiscoveryAdapter,
  parseTerraformState,
  TERRAFORM_TYPE_MAP,
  ATTRIBUTE_RELATIONSHIP_RULES,
} from "./terraform.js";

// =============================================================================
// Test Fixtures
// =============================================================================

/** Minimal valid Terraform v4 state with a realistic AWS stack */
const SAMPLE_STATE = {
  version: 4,
  terraform_version: "1.7.5",
  serial: 42,
  lineage: "test-lineage-001",
  outputs: {
    vpc_id: { value: "vpc-abc123", type: "string" },
  },
  resources: [
    {
      mode: "managed",
      type: "aws_vpc",
      name: "main",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [
        {
          schema_version: 1,
          attributes: {
            id: "vpc-abc123",
            cidr_block: "10.0.0.0/16",
            tags: { Name: "main-vpc", Environment: "production" },
            enable_dns_hostnames: true,
            enable_dns_support: true,
          },
        },
      ],
    },
    {
      mode: "managed",
      type: "aws_subnet",
      name: "public_a",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [
        {
          schema_version: 1,
          attributes: {
            id: "subnet-pub-a",
            vpc_id: "vpc-abc123",
            cidr_block: "10.0.1.0/24",
            availability_zone: "us-east-1a",
            map_public_ip_on_launch: true,
            tags: { Name: "public-a", Environment: "production" },
          },
        },
      ],
    },
    {
      mode: "managed",
      type: "aws_instance",
      name: "web",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [
        {
          schema_version: 1,
          attributes: {
            id: "i-web001",
            instance_type: "t3.large",
            ami: "ami-12345678",
            subnet_id: "subnet-pub-a",
            vpc_security_group_ids: ["sg-web001"],
            iam_instance_profile: "web-profile",
            availability_zone: "us-east-1a",
            tags: { Name: "web-server", Environment: "production", Team: "platform" },
          },
        },
      ],
    },
    {
      mode: "managed",
      type: "aws_security_group",
      name: "web_sg",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [
        {
          schema_version: 1,
          attributes: {
            id: "sg-web001",
            vpc_id: "vpc-abc123",
            name: "web-sg",
            tags: { Name: "web-sg" },
          },
        },
      ],
    },
    {
      mode: "managed",
      type: "aws_db_instance",
      name: "primary",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [
        {
          schema_version: 2,
          attributes: {
            id: "mydb",
            identifier: "mydb",
            instance_class: "db.r6g.xlarge",
            engine: "postgres",
            engine_version: "15.4",
            db_subnet_group_name: "db-subnets",
            vpc_security_group_ids: ["sg-db001"],
            allocated_storage: 100,
            multi_az: true,
            tags: { Name: "primary-db", Environment: "production" },
          },
        },
      ],
    },
    {
      mode: "managed",
      type: "aws_s3_bucket",
      name: "assets",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [
        {
          schema_version: 0,
          attributes: {
            id: "my-assets-bucket",
            bucket: "my-assets-bucket",
            tags: { Name: "assets" },
          },
        },
      ],
    },
    {
      mode: "managed",
      type: "aws_lambda_function",
      name: "api",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [
        {
          schema_version: 0,
          attributes: {
            id: "api-handler",
            function_name: "api-handler",
            role: "arn:aws:iam::123456789012:role/lambda-exec",
            runtime: "nodejs20.x",
            handler: "index.handler",
            vpc_config: [
              {
                subnet_ids: ["subnet-pub-a"],
                security_group_ids: ["sg-web001"],
              },
            ],
            tags: {},
          },
        },
      ],
    },
    // Data source — should be skipped
    {
      mode: "data",
      type: "aws_ami",
      name: "ubuntu",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [
        {
          schema_version: 0,
          attributes: {
            id: "ami-ubuntu-latest",
            name: "ubuntu/images/hvm-ssd/ubuntu-focal-20.04-amd64-server-*",
          },
        },
      ],
    },
  ],
};

/** Terraform state with Azure resources */
const AZURE_STATE = {
  version: 4,
  terraform_version: "1.7.5",
  serial: 1,
  lineage: "azure-lineage",
  outputs: {},
  resources: [
    {
      mode: "managed",
      type: "azurerm_resource_group",
      name: "main",
      provider: 'provider["registry.terraform.io/hashicorp/azurerm"]',
      instances: [
        {
          schema_version: 0,
          attributes: {
            id: "/subscriptions/sub-123/resourceGroups/my-rg",
            name: "my-rg",
            location: "eastus",
            tags: { Environment: "staging" },
          },
        },
      ],
    },
    {
      mode: "managed",
      type: "azurerm_virtual_network",
      name: "main",
      provider: 'provider["registry.terraform.io/hashicorp/azurerm"]',
      instances: [
        {
          schema_version: 0,
          attributes: {
            id: "/subscriptions/sub-123/resourceGroups/my-rg/providers/Microsoft.Network/virtualNetworks/main-vnet",
            name: "main-vnet",
            resource_group_name: "my-rg",
            location: "eastus",
            address_space: ["10.0.0.0/16"],
            tags: {},
          },
        },
      ],
    },
  ],
};

/** State with depends_on */
const DEPENDS_ON_STATE = {
  version: 4,
  terraform_version: "1.6.0",
  serial: 5,
  lineage: "deps-lineage",
  outputs: {},
  resources: [
    {
      mode: "managed",
      type: "aws_iam_role",
      name: "lambda_role",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      instances: [
        {
          schema_version: 0,
          attributes: {
            id: "lambda-exec-role",
            name: "lambda-exec-role",
            arn: "arn:aws:iam::123:role/lambda-exec-role",
            tags: {},
          },
        },
      ],
    },
    {
      mode: "managed",
      type: "aws_lambda_function",
      name: "worker",
      provider: 'provider["registry.terraform.io/hashicorp/aws"]',
      depends_on: ["aws_iam_role.lambda_role"],
      instances: [
        {
          schema_version: 0,
          attributes: {
            id: "worker-fn",
            function_name: "worker-fn",
            role: "arn:aws:iam::123:role/lambda-exec-role",
            runtime: "python3.12",
            handler: "handler.main",
            tags: { Name: "worker" },
          },
        },
      ],
    },
  ],
};

// =============================================================================
// Helpers
// =============================================================================

let tmpDir: string;

function writeTmpState(state: object, filename = "terraform.tfstate"): string {
  const path = join(tmpDir, filename);
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
  return path;
}

beforeEach(() => {
  tmpDir = join(tmpdir(), `espada-tf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// =============================================================================
// TERRAFORM_TYPE_MAP
// =============================================================================

describe("TERRAFORM_TYPE_MAP", () => {
  it("should have entries for common AWS resource types", () => {
    const awsTypes = [
      "aws_instance",
      "aws_vpc",
      "aws_subnet",
      "aws_security_group",
      "aws_s3_bucket",
      "aws_lambda_function",
      "aws_rds_cluster",
      "aws_db_instance",
      "aws_ecs_cluster",
      "aws_eks_cluster",
      "aws_lb",
      "aws_iam_role",
      "aws_cloudfront_distribution",
      "aws_route53_zone",
      "aws_sqs_queue",
      "aws_sns_topic",
      "aws_dynamodb_table",
      "aws_ebs_volume",
      "aws_nat_gateway",
    ];
    for (const t of awsTypes) {
      expect(TERRAFORM_TYPE_MAP[t], `Missing mapping for ${t}`).toBeDefined();
    }
  });

  it("should have entries for common Azure resource types", () => {
    const azureTypes = [
      "azurerm_virtual_machine",
      "azurerm_virtual_network",
      "azurerm_subnet",
      "azurerm_network_security_group",
      "azurerm_storage_account",
      "azurerm_kubernetes_cluster",
    ];
    for (const t of azureTypes) {
      expect(TERRAFORM_TYPE_MAP[t], `Missing mapping for ${t}`).toBeDefined();
    }
  });

  it("should have entries for common GCP resource types", () => {
    const gcpTypes = [
      "google_compute_instance",
      "google_compute_network",
      "google_compute_subnetwork",
      "google_storage_bucket",
      "google_container_cluster",
    ];
    for (const t of gcpTypes) {
      expect(TERRAFORM_TYPE_MAP[t], `Missing mapping for ${t}`).toBeDefined();
    }
  });

  it("should have Kubernetes resource types", () => {
    const k8sTypes = [
      "kubernetes_deployment",
      "kubernetes_service",
      "kubernetes_namespace",
    ];
    for (const t of k8sTypes) {
      expect(TERRAFORM_TYPE_MAP[t], `Missing mapping for ${t}`).toBeDefined();
    }
  });

  it("should map aws_instance to compute + aws provider", () => {
    const mapping = TERRAFORM_TYPE_MAP["aws_instance"];
    expect(mapping).toEqual({ graphType: "compute", provider: "aws" });
  });

  it("should map azurerm_virtual_network to vpc + azure provider", () => {
    const mapping = TERRAFORM_TYPE_MAP["azurerm_virtual_network"];
    expect(mapping).toEqual({ graphType: "vpc", provider: "azure" });
  });
});

// =============================================================================
// ATTRIBUTE_RELATIONSHIP_RULES
// =============================================================================

describe("ATTRIBUTE_RELATIONSHIP_RULES", () => {
  it("should have rules for common relationship attributes", () => {
    const attrs = ["vpc_id", "subnet_id", "security_group_ids", "role"];
    for (const attr of attrs) {
      const rule = ATTRIBUTE_RELATIONSHIP_RULES.find((r) => r.attribute === attr);
      expect(rule, `Missing rule for ${attr}`).toBeDefined();
    }
  });

  it("should have bidirectional VPC relationship", () => {
    const vpcRule = ATTRIBUTE_RELATIONSHIP_RULES.find((r) => r.attribute === "vpc_id");
    expect(vpcRule?.relationship).toBe("runs-in");
  });
});

// =============================================================================
// TerraformDiscoveryAdapter — discover()
// =============================================================================

describe("TerraformDiscoveryAdapter", () => {
  describe("discover()", () => {
    it("should discover all managed resources from sample state", async () => {
      const path = writeTmpState(SAMPLE_STATE);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      expect(result.provider).toBe("aws"); // Primary provider detected from resources
      expect(result.errors).toHaveLength(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // 7 managed resources (data source excluded)
      expect(result.nodes).toHaveLength(7);
    });

    it("should skip data sources", async () => {
      const path = writeTmpState(SAMPLE_STATE);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      const dataNodes = result.nodes.filter((n) => n.id.includes("data."));
      expect(dataNodes).toHaveLength(0);
    });

    it("should map resource types correctly", async () => {
      const path = writeTmpState(SAMPLE_STATE);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      const vpc = result.nodes.find((n) => n.nativeId === "vpc-abc123");
      expect(vpc?.resourceType).toBe("vpc");
      expect(vpc?.provider).toBe("aws");

      const instance = result.nodes.find((n) => n.nativeId === "i-web001");
      expect(instance?.resourceType).toBe("compute");
      expect(instance?.provider).toBe("aws");

      const sg = result.nodes.find((n) => n.nativeId === "sg-web001");
      expect(sg?.resourceType).toBe("security-group");

      const bucket = result.nodes.find((n) => n.nativeId === "my-assets-bucket");
      expect(bucket?.resourceType).toBe("storage");

      const lambda = result.nodes.find((n) => n.nativeId === "api-handler");
      expect(lambda?.resourceType).toBe("serverless-function");

      const db = result.nodes.find((n) => n.nativeId === "mydb");
      expect(db?.resourceType).toBe("database");
    });

    it("should extract tags from resources", async () => {
      const path = writeTmpState(SAMPLE_STATE);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      const instance = result.nodes.find((n) => n.nativeId === "i-web001");
      expect(instance?.tags?.Name).toBe("web-server");
      expect(instance?.tags?.Environment).toBe("production");
      expect(instance?.tags?.Team).toBe("platform");
    });

    it("should extract name from tags or attributes", async () => {
      const path = writeTmpState(SAMPLE_STATE);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      const instance = result.nodes.find((n) => n.nativeId === "i-web001");
      expect(instance?.name).toBe("web-server");

      // Lambda uses function_name
      const lambda = result.nodes.find((n) => n.nativeId === "api-handler");
      expect(lambda?.name).toMatch(/api-handler/);

      // S3 uses bucket
      const bucket = result.nodes.find((n) => n.nativeId === "my-assets-bucket");
      expect(bucket?.name).toMatch(/my-assets-bucket|assets/);
    });

    it("should estimate costs for compute instances", async () => {
      const path = writeTmpState(SAMPLE_STATE);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      const instance = result.nodes.find((n) => n.nativeId === "i-web001");
      // t3.large should have a cost estimate
      expect(instance?.costMonthly).toBeGreaterThan(0);
    });

    it("should estimate costs for RDS instances", async () => {
      const path = writeTmpState(SAMPLE_STATE);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      const db = result.nodes.find((n) => n.nativeId === "mydb");
      expect(db?.costMonthly).toBeGreaterThan(0);
    });

    it("should extract relationships from attributes", async () => {
      const path = writeTmpState(SAMPLE_STATE);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      // Build nativeId → nodeId lookup for assertions
      const nodeById = new Map(result.nodes.map((n) => [n.nativeId, n.id]));

      // Subnet → VPC (via vpc_id)
      const subnetId = nodeById.get("subnet-pub-a")!;
      const vpcId = nodeById.get("vpc-abc123")!;
      const subnetToVpc = result.edges.find(
        (e) => e.sourceNodeId === subnetId && e.targetNodeId === vpcId,
      );
      expect(subnetToVpc).toBeDefined();
      expect(subnetToVpc?.relationshipType).toBe("runs-in");

      // Instance → Subnet (via subnet_id)
      const instanceId = nodeById.get("i-web001")!;
      const instanceToSubnet = result.edges.find(
        (e) => e.sourceNodeId === instanceId && e.targetNodeId === subnetId,
      );
      expect(instanceToSubnet).toBeDefined();
      expect(instanceToSubnet?.relationshipType).toBe("runs-in");

      // Instance → SG (via vpc_security_group_ids)
      const sgId = nodeById.get("sg-web001")!;
      const instanceToSg = result.edges.find(
        (e) => e.sourceNodeId === instanceId && e.targetNodeId === sgId,
      );
      expect(instanceToSg).toBeDefined();
      expect(instanceToSg?.relationshipType).toBe("secured-by");
    });

    it("should not create duplicate edges", async () => {
      const path = writeTmpState(SAMPLE_STATE);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      // Check for duplicate edges (same source + target + relationship)
      const edgeKeys = new Set<string>();
      for (const edge of result.edges) {
        const key = `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.relationshipType}`;
        expect(edgeKeys.has(key), `Duplicate edge: ${key}`).toBe(false);
        edgeKeys.add(key);
      }
    });

    it("should store Terraform address in metadata", async () => {
      const path = writeTmpState(SAMPLE_STATE);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      const vpc = result.nodes.find((n) => n.nativeId === "vpc-abc123");
      expect(vpc?.metadata?.terraformType).toBe("aws_vpc");
      expect(vpc?.metadata?.terraformName).toBe("main");
      expect(vpc?.metadata?.terraformProvider).toContain("aws");
    });

    it("should handle Azure resources", async () => {
      const path = writeTmpState(AZURE_STATE);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      expect(result.nodes).toHaveLength(2);

      const rg = result.nodes.find((n) => n.name === "my-rg");
      expect(rg?.provider).toBe("azure");
      expect(rg?.tags?.Environment).toBe("staging");

      const vnet = result.nodes.find((n) => n.name === "main-vnet");
      expect(vnet?.provider).toBe("azure");
      expect(vnet?.resourceType).toBe("vpc");
    });

    it("should handle depends_on relationships", async () => {
      const path = writeTmpState(DEPENDS_ON_STATE);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      expect(result.nodes).toHaveLength(2);

      // Lambda depends_on IAM role — node IDs use nativeId, not terraform address
      const lambdaNode = result.nodes.find((n) => n.name === "worker");
      const iamNode = result.nodes.find((n) => n.name === "lambda-exec-role");
      expect(lambdaNode).toBeDefined();
      expect(iamNode).toBeDefined();

      // Phase 2 may create a "uses" edge from attribute-level role ARN reference.
      // Phase 3 creates a "depends-on" edge from explicit depends_on.
      // If both point to the same source→target, only the first survives dedup.
      const depsOnEdge = result.edges.find(
        (e) =>
          e.sourceNodeId === lambdaNode!.id &&
          e.targetNodeId === iamNode!.id,
      );
      expect(depsOnEdge).toBeDefined();
      expect(["depends-on", "uses"]).toContain(depsOnEdge?.relationshipType);
    });
  });

  // ===========================================================================
  // healthCheck
  // ===========================================================================

  describe("healthCheck()", () => {
    it("should return true when state file exists", async () => {
      const path = writeTmpState(SAMPLE_STATE);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      expect(await adapter.healthCheck()).toBe(true);
    });

    it("should return false when state file does not exist", async () => {
      const adapter = new TerraformDiscoveryAdapter({
        statePath: join(tmpDir, "nonexistent.tfstate"),
      });
      expect(await adapter.healthCheck()).toBe(false);
    });
  });

  // ===========================================================================
  // supportedResourceTypes
  // ===========================================================================

  describe("supportedResourceTypes()", () => {
    it("should return a non-empty list of resource types", () => {
      const adapter = new TerraformDiscoveryAdapter({ statePath: "/dev/null" });
      const types = adapter.supportedResourceTypes();
      expect(types.length).toBeGreaterThan(20);
      expect(types).toContain("compute");
      expect(types).toContain("vpc");
      expect(types).toContain("storage");
    });
  });

  // ===========================================================================
  // supportsIncrementalSync
  // ===========================================================================

  describe("supportsIncrementalSync()", () => {
    it("should return false (Terraform state is always full scan)", () => {
      const adapter = new TerraformDiscoveryAdapter({ statePath: "/dev/null" });
      expect(adapter.supportsIncrementalSync()).toBe(false);
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe("error handling", () => {
    it("should handle invalid JSON gracefully", async () => {
      const path = join(tmpDir, "bad.tfstate");
      writeFileSync(path, "not json", "utf-8");
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it("should handle empty state", async () => {
      const emptyState = { version: 4, terraform_version: "1.7.0", serial: 1, lineage: "x", outputs: {}, resources: [] };
      const path = writeTmpState(emptyState);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      expect(result.errors).toHaveLength(0);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it("should handle missing file gracefully", async () => {
      const adapter = new TerraformDiscoveryAdapter({ statePath: join(tmpDir, "nope.tfstate") });
      const result = await adapter.discover();

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.nodes).toHaveLength(0);
    });

    it("should handle resources with missing attributes", async () => {
      const state = {
        version: 4,
        terraform_version: "1.7.0",
        serial: 1,
        lineage: "x",
        outputs: {},
        resources: [
          {
            mode: "managed",
            type: "aws_instance",
            name: "bare",
            provider: 'provider["registry.terraform.io/hashicorp/aws"]',
            instances: [{ schema_version: 1, attributes: { id: "i-bare" } }],
          },
        ],
      };
      const path = writeTmpState(state);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].nativeId).toBe("i-bare");
    });

    it("should handle unknown resource types", async () => {
      const state = {
        version: 4,
        terraform_version: "1.7.0",
        serial: 1,
        lineage: "x",
        outputs: {},
        resources: [
          {
            mode: "managed",
            type: "aws_unknown_service_thing",
            name: "mystery",
            provider: 'provider["registry.terraform.io/hashicorp/aws"]',
            instances: [{ schema_version: 0, attributes: { id: "mystery-1", tags: {} } }],
          },
        ],
      };
      const path = writeTmpState(state);
      const adapter = new TerraformDiscoveryAdapter({ statePath: path });
      const result = await adapter.discover();

      // Should still produce a node with fallback type
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].provider).toBe("aws");
    });
  });
});

// =============================================================================
// terraform_remote_state cross-state dependencies
// =============================================================================

describe("terraform_remote_state", () => {
  /** State that consumes outputs from a remote state. */
  const REMOTE_STATE_CONSUMER = {
    version: 4,
    terraform_version: "1.7.5",
    serial: 10,
    lineage: "consumer-lineage",
    outputs: {},
    resources: [
      // The VPC that's consumed from the remote state
      {
        mode: "managed",
        type: "aws_vpc",
        name: "main",
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [
          {
            schema_version: 1,
            attributes: {
              id: "vpc-local-001",
              cidr_block: "10.0.0.0/16",
              tags: { Name: "local-vpc" },
            },
          },
        ],
      },
      // A subnet that references the VPC
      {
        mode: "managed",
        type: "aws_subnet",
        name: "app",
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [
          {
            schema_version: 1,
            attributes: {
              id: "subnet-app-001",
              vpc_id: "vpc-local-001",
              cidr_block: "10.0.1.0/24",
              tags: { Name: "app-subnet" },
            },
          },
        ],
      },
      // terraform_remote_state — references outputs from another state file
      {
        mode: "data",
        type: "terraform_remote_state",
        name: "shared_infra",
        provider: 'provider["terraform.io/builtin/terraform"]',
        instances: [
          {
            schema_version: 0,
            attributes: {
              backend: "s3",
              config: {
                bucket: "terraform-state-bucket",
                key: "shared/terraform.tfstate",
                region: "us-east-1",
              },
              outputs: {
                value: {
                  db_endpoint: "mydb.cluster-abc.us-east-1.rds.amazonaws.com",
                  db_security_group_id: "sg-db-remote-001",
                  redis_endpoint: "redis.abc.0001.use1.cache.amazonaws.com",
                  // This one references a local resource ID
                  shared_vpc_id: "vpc-local-001",
                },
              },
            },
          },
        ],
      },
    ],
  };

  it("should create cross-state dependency edges for matching local resources", async () => {
    const path = writeTmpState(REMOTE_STATE_CONSUMER);
    const adapter = new TerraformDiscoveryAdapter({ statePath: path });
    const result = await adapter.discover();

    // The VPC "vpc-local-001" appears as an output in the remote state
    // and also exists locally — should create a depends-on edge
    const crossStateEdges = result.edges.filter(
      (e) => e.metadata?.["source"] === "terraform_remote_state",
    );
    expect(crossStateEdges.length).toBeGreaterThan(0);
  });

  it("should create placeholder nodes for remote IDs not found locally", async () => {
    const path = writeTmpState(REMOTE_STATE_CONSUMER);
    const adapter = new TerraformDiscoveryAdapter({ statePath: path });
    const result = await adapter.discover();

    // "sg-db-remote-001" is a remote resource ID that doesn't exist locally
    // The adapter should create a placeholder node for it
    const placeholder = result.nodes.find(
      (n) => n.nativeId === "sg-db-remote-001",
    );
    expect(placeholder).toBeDefined();
    if (placeholder) {
      expect(placeholder.metadata?.["placeholder"]).toBe(true);
    }
  });

  it("should NOT treat data sources as regular nodes", async () => {
    const path = writeTmpState(REMOTE_STATE_CONSUMER);
    const adapter = new TerraformDiscoveryAdapter({ statePath: path });
    const result = await adapter.discover();

    // terraform_remote_state is a data source — should not appear as a regular node
    const remoteStateNode = result.nodes.find(
      (n) => n.name === "shared_infra" && n.metadata?.["terraformType"] === "terraform_remote_state",
    );
    // It may appear as a placeholder but not as a managed resource node
    const managedRemoteState = result.nodes.filter(
      (n) => n.metadata?.["terraformType"] === "terraform_remote_state" && !n.metadata?.["placeholder"],
    );
    expect(managedRemoteState).toHaveLength(0);
  });

  it("should still discover regular managed resources", async () => {
    const path = writeTmpState(REMOTE_STATE_CONSUMER);
    const adapter = new TerraformDiscoveryAdapter({ statePath: path });
    const result = await adapter.discover();

    // VPC and subnet should be discovered as normal
    const vpc = result.nodes.find((n) => n.nativeId === "vpc-local-001");
    const subnet = result.nodes.find((n) => n.nativeId === "subnet-app-001");
    expect(vpc).toBeDefined();
    expect(subnet).toBeDefined();
    expect(vpc?.resourceType).toBe("vpc");
    expect(subnet?.resourceType).toBe("subnet");
  });

  it("should handle remote state with no outputs", async () => {
    const stateNoOutputs = {
      ...REMOTE_STATE_CONSUMER,
      resources: [
        ...REMOTE_STATE_CONSUMER.resources.filter((r) => r.type !== "terraform_remote_state"),
        {
          mode: "data" as const,
          type: "terraform_remote_state",
          name: "empty_remote",
          provider: 'provider["terraform.io/builtin/terraform"]',
          instances: [
            {
              schema_version: 0,
              attributes: {
                backend: "s3",
                config: {},
                outputs: { value: {} },
              },
            },
          ],
        },
      ],
    };

    const path = writeTmpState(stateNoOutputs);
    const adapter = new TerraformDiscoveryAdapter({ statePath: path });
    const result = await adapter.discover();

    // Should not crash, still discover managed resources
    expect(result.nodes.length).toBeGreaterThanOrEqual(2); // VPC + subnet
    expect(result.errors).toHaveLength(0);
  });
});

// =============================================================================
// parseTerraformState() convenience function
// =============================================================================

describe("parseTerraformState()", () => {
  it("should return nodes and edges from state file path", async () => {
    const path = writeTmpState(SAMPLE_STATE);
    const result = await parseTerraformState(path);

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);
    expect(result.provider).toBe("aws"); // Detected primary provider
  });
});

// =============================================================================
// Integration: Full pipeline (scan → engine → queries)
// =============================================================================

describe("Terraform → Engine integration", () => {
  it("should sync Terraform state into the graph engine", async () => {
    // Lazy import to avoid circular issues
    const { GraphEngine } = await import("../core/engine.js");
    const { InMemoryGraphStorage } = await import("../storage/index.js");

    const path = writeTmpState(SAMPLE_STATE);
    const storage = new InMemoryGraphStorage();
    await storage.initialize();

    const engine = new GraphEngine({ storage });
    const adapter = new TerraformDiscoveryAdapter({ statePath: path });
    engine.registerAdapter(adapter);

    const records = await engine.sync();
    expect(records).toHaveLength(1);
    expect(records[0].nodesDiscovered).toBe(7);
    expect(records[0].edgesDiscovered).toBeGreaterThan(0);

    // Verify nodes are queryable
    const stats = await storage.getStats();
    expect(stats.totalNodes).toBe(7);
    expect(stats.totalEdges).toBeGreaterThan(0);

    // Verify cost attribution
    const nodes = await storage.queryNodes({});
    const totalCost = nodes
      .filter((n: { costMonthly: number | null }) => n.costMonthly != null)
      .reduce((sum: number, n: { costMonthly: number | null }) => sum + (n.costMonthly ?? 0), 0);
    expect(totalCost).toBeGreaterThan(0);

    await storage.close();
  });
});
