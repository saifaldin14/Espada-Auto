/**
 * IaC Generation tests — HCL generation, codify, import planning.
 */

import { describe, expect, it } from "vitest";
import {
  resolveTerraformType,
  sanitizeName,
  extractAttributes,
  generateResourceBlock,
  generateProviderBlock,
  generateImportCommand,
  generateImportBlock,
  generateVariableBlock,
  generateOutputBlock,
  formatValue,
  codifyNodes,
} from "./hcl-generator.js";
import type { CodifyNode } from "./hcl-generator.js";
import {
  filterNodes,
  codifySubgraph,
  planImportOrder,
  generateOrderedImports,
} from "./codify.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeNode = (overrides?: Partial<CodifyNode>): CodifyNode => ({
  id: "aws:123:us-east-1:compute:i-abc",
  name: "web-server",
  provider: "aws",
  resourceType: "compute",
  nativeId: "i-abc123",
  region: "us-east-1",
  account: "123456",
  tags: { env: "prod" },
  metadata: { instance_type: "t3.micro", ami: "ami-12345" },
  ...overrides,
});

// ---------------------------------------------------------------------------
// resolveTerraformType
// ---------------------------------------------------------------------------
describe("resolveTerraformType", () => {
  it("resolves aws compute", () => {
    expect(resolveTerraformType("compute", "aws")).toBe("aws_instance");
  });

  it("resolves azure database", () => {
    expect(resolveTerraformType("database", "azure")).toBe("azurerm_postgresql_server");
  });

  it("resolves gcp storage", () => {
    expect(resolveTerraformType("storage", "gcp")).toBe("google_storage_bucket");
  });

  it("returns null for unknown type", () => {
    expect(resolveTerraformType("unknown-type", "aws")).toBeNull();
  });

  it("resolves load-balancer", () => {
    expect(resolveTerraformType("load-balancer", "aws")).toBe("aws_lb");
  });

  it("resolves cluster", () => {
    expect(resolveTerraformType("cluster", "gcp")).toBe("google_container_cluster");
  });
});

// ---------------------------------------------------------------------------
// sanitizeName
// ---------------------------------------------------------------------------
describe("sanitizeName", () => {
  it("lowercases and replaces special chars", () => {
    expect(sanitizeName("My-Web-Server")).toBe("my_web_server");
  });

  it("collapses multiple underscores", () => {
    expect(sanitizeName("test--name__here")).toBe("test_name_here");
  });

  it("strips leading/trailing underscores", () => {
    expect(sanitizeName("-leading-")).toBe("leading");
  });

  it("truncates to 64 chars", () => {
    const long = "a".repeat(100);
    expect(sanitizeName(long).length).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// extractAttributes
// ---------------------------------------------------------------------------
describe("extractAttributes", () => {
  it("extracts known metadata keys", () => {
    const node = makeNode({ metadata: { instance_type: "t3.large", ami: "ami-xxx" } });
    const attrs = extractAttributes(node);
    expect(attrs.instance_type).toBe("t3.large");
    expect(attrs.ami).toBe("ami-xxx");
  });

  it("includes tags", () => {
    const node = makeNode({ tags: { Name: "test" } });
    const attrs = extractAttributes(node);
    expect(attrs.tags).toEqual({ Name: "test" });
  });

  it("omits unknown metadata keys", () => {
    const node = makeNode({ metadata: { custom_field: "value" } });
    const attrs = extractAttributes(node);
    expect(attrs.custom_field).toBeUndefined();
  });

  it("omits empty tags", () => {
    const node = makeNode({ tags: {} });
    const attrs = extractAttributes(node);
    expect(attrs.tags).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateResourceBlock
// ---------------------------------------------------------------------------
describe("generateResourceBlock", () => {
  it("generates a resource block", () => {
    const node = makeNode();
    const block = generateResourceBlock(node);
    expect(block).not.toBeNull();
    expect(block!.type).toBe("aws_instance");
    expect(block!.name).toBe("web_server");
    expect(block!.address).toBe("aws_instance.web_server");
  });

  it("returns null for unsupported type", () => {
    const node = makeNode({ resourceType: "custom" });
    const block = generateResourceBlock(node);
    expect(block).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// generateProviderBlock
// ---------------------------------------------------------------------------
describe("generateProviderBlock", () => {
  it("generates AWS provider", () => {
    const block = generateProviderBlock("aws", "us-east-1");
    expect(block).toContain('provider "aws"');
    expect(block).toContain("us-east-1");
  });

  it("generates Azure provider", () => {
    const block = generateProviderBlock("azure", "eastus");
    expect(block).toContain('provider "azurerm"');
    expect(block).toContain("features");
  });

  it("generates GCP provider", () => {
    const block = generateProviderBlock("gcp", "us-central1");
    expect(block).toContain('provider "google"');
  });
});

// ---------------------------------------------------------------------------
// generateImportCommand / generateImportBlock
// ---------------------------------------------------------------------------
describe("import generation", () => {
  const resource = { address: "aws_instance.web", type: "aws_instance", name: "web", attributes: {}, provider: "aws" as const };

  it("generates import command", () => {
    const cmd = generateImportCommand(resource, "i-abc123");
    expect(cmd).toBe("terraform import aws_instance.web i-abc123");
  });

  it("generates import block", () => {
    const block = generateImportBlock(resource, "i-abc123");
    expect(block).toContain("import {");
    expect(block).toContain("to = aws_instance.web");
    expect(block).toContain('id = "i-abc123"');
  });
});

// ---------------------------------------------------------------------------
// generateVariableBlock / generateOutputBlock
// ---------------------------------------------------------------------------
describe("variable and output blocks", () => {
  it("generates variable block", () => {
    const block = generateVariableBlock({ name: "region", type: "string", description: "AWS region", default: "us-east-1" });
    expect(block).toContain('variable "region"');
    expect(block).toContain('"us-east-1"');
  });

  it("generates output block", () => {
    const block = generateOutputBlock({ name: "instance_id", value: "aws_instance.web.id", description: "Instance ID" });
    expect(block).toContain('output "instance_id"');
    expect(block).toContain("aws_instance.web.id");
  });
});

// ---------------------------------------------------------------------------
// formatValue
// ---------------------------------------------------------------------------
describe("formatValue", () => {
  it("formats string", () => expect(formatValue("hello")).toBe('"hello"'));
  it("formats number", () => expect(formatValue(42)).toBe("42"));
  it("formats boolean", () => expect(formatValue(true)).toBe("true"));
  it("formats array", () => expect(formatValue(["a", "b"])).toBe('["a", "b"]'));
  it("formats null", () => expect(formatValue(null)).toBe("null"));
});

// ---------------------------------------------------------------------------
// codifyNodes (integration)
// ---------------------------------------------------------------------------
describe("codifyNodes", () => {
  it("generates full HCL for multiple nodes", () => {
    const nodes = [
      makeNode({ id: "n1", name: "web", resourceType: "compute", provider: "aws" }),
      makeNode({ id: "n2", name: "db", resourceType: "database", provider: "aws" }),
    ];
    const result = codifyNodes(nodes);
    expect(result.resources).toHaveLength(2);
    expect(result.hclContent).toContain("aws_instance");
    expect(result.hclContent).toContain("aws_db_instance");
    expect(result.importCommands).toHaveLength(2);
    expect(result.providerBlocks).toHaveLength(1);
  });

  it("skips unsupported resource types", () => {
    const nodes = [makeNode({ resourceType: "custom" })];
    const result = codifyNodes(nodes);
    expect(result.resources).toHaveLength(0);
  });

  it("generates separate provider blocks for different regions", () => {
    const nodes = [
      makeNode({ id: "n1", region: "us-east-1" }),
      makeNode({ id: "n2", region: "us-west-2" }),
    ];
    const result = codifyNodes(nodes);
    expect(result.providerBlocks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// filterNodes
// ---------------------------------------------------------------------------
describe("filterNodes", () => {
  const nodes = [
    makeNode({ id: "1", provider: "aws", resourceType: "compute", region: "us-east-1", tags: { env: "prod" } }),
    makeNode({ id: "2", provider: "gcp", resourceType: "database", region: "us-central1", tags: {} }),
    makeNode({ id: "3", provider: "aws", resourceType: "database", region: "us-east-1", tags: { env: "dev" } }),
  ];

  it("filters by provider", () => {
    expect(filterNodes(nodes, { provider: "aws" })).toHaveLength(2);
  });

  it("filters by resourceType", () => {
    expect(filterNodes(nodes, { resourceType: "database" })).toHaveLength(2);
  });

  it("filters by region", () => {
    expect(filterNodes(nodes, { region: "us-east-1" })).toHaveLength(2);
  });

  it("filters by tag", () => {
    expect(filterNodes(nodes, { tag: "env" })).toHaveLength(2);
  });

  it("combines filters", () => {
    expect(filterNodes(nodes, { provider: "aws", resourceType: "database" })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// codifySubgraph
// ---------------------------------------------------------------------------
describe("codifySubgraph", () => {
  it("codifies root and 1-hop dependencies", () => {
    const nodes = [
      makeNode({ id: "a", name: "web", resourceType: "compute" }),
      makeNode({ id: "b", name: "db", resourceType: "database" }),
      makeNode({ id: "c", name: "cache", resourceType: "cache" }),
    ];
    const edges = [
      { sourceId: "a", targetId: "b" },
      { sourceId: "b", targetId: "c" },
    ];
    const result = codifySubgraph(nodes, edges, "a", 1);
    expect(result.resources).toHaveLength(2); // a + b
  });

  it("codifies root and 2-hop dependencies", () => {
    const nodes = [
      makeNode({ id: "a", name: "web", resourceType: "compute" }),
      makeNode({ id: "b", name: "db", resourceType: "database" }),
      makeNode({ id: "c", name: "cache", resourceType: "cache" }),
    ];
    const edges = [
      { sourceId: "a", targetId: "b" },
      { sourceId: "b", targetId: "c" },
    ];
    const result = codifySubgraph(nodes, edges, "a", 2);
    expect(result.resources).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// planImportOrder
// ---------------------------------------------------------------------------
describe("planImportOrder", () => {
  it("orders dependencies before dependents", () => {
    const nodes = [
      makeNode({ id: "web", name: "web", resourceType: "compute" }),
      makeNode({ id: "vpc", name: "vpc", resourceType: "vpc" }),
    ];
    const edges = [
      { sourceId: "web", targetId: "vpc", relationshipType: "depends-on" },
    ];
    const ordered = planImportOrder(nodes, edges);
    const vpcIdx = ordered.findIndex((n) => n.id === "vpc");
    const webIdx = ordered.findIndex((n) => n.id === "web");
    expect(vpcIdx).toBeLessThan(webIdx);
  });

  it("handles nodes without dependencies", () => {
    const nodes = [makeNode({ id: "a" }), makeNode({ id: "b" })];
    const ordered = planImportOrder(nodes, []);
    expect(ordered).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// generateOrderedImports
// ---------------------------------------------------------------------------
describe("generateOrderedImports", () => {
  it("generates import commands in dependency order", () => {
    const nodes = [
      makeNode({ id: "web", name: "web", resourceType: "compute", nativeId: "i-web" }),
      makeNode({ id: "vpc", name: "vpc", resourceType: "vpc", nativeId: "vpc-123" }),
    ];
    const edges = [
      { sourceId: "web", targetId: "vpc", relationshipType: "depends-on" },
    ];
    const cmds = generateOrderedImports(nodes, edges);
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toContain("vpc-123");
    expect(cmds[1]).toContain("i-web");
  });
});
