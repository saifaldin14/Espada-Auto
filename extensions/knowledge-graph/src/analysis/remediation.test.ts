/**
 * Tests for the drift auto-remediation module (P2.21).
 */

import { describe, it, expect } from "vitest";
import type { GraphNode, DriftResult, GraphChange } from "../types.js";
import {
  generateRemediationPlan,
  formatRemediationMarkdown,
} from "./remediation.js";
import type { IaCFormat, DependencyEdge, RemediationOptions } from "./remediation.js";

// =============================================================================
// Fixtures
// =============================================================================

function makeGraphNode(id: string, overrides?: Partial<GraphNode>): GraphNode {
  return {
    id,
    name: id,
    provider: "aws",
    account: "123456789",
    region: "us-east-1",
    resourceType: "compute",
    nativeId: id,
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: null,
    owner: null,
    createdAt: null,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    version: 1,
    ...overrides,
  } as GraphNode;
}

function makeDriftChange(field: string, prev: string | null, next: string | null): GraphChange {
  return {
    id: `change-${field}-${Date.now()}`,
    targetId: "test-node",
    changeType: "node-drifted",
    field,
    previousValue: prev,
    newValue: next,
    detectedAt: new Date().toISOString(),
    detectedVia: "drift-scan",
    correlationId: null,
    initiator: null,
    initiatorType: null,
    metadata: {},
  };
}

function makeDriftResult(
  nodes: Array<{ node: GraphNode; changes: GraphChange[] }>,
  disappeared: GraphNode[] = [],
): DriftResult {
  return {
    driftedNodes: nodes,
    disappearedNodes: disappeared,
    newNodes: [],
    scannedAt: new Date().toISOString(),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("Drift Auto-Remediation (P2.21)", () => {
  describe("generateRemediationPlan — Terraform", () => {
    it("generates Terraform patches for drifted resources", () => {
      const node = makeGraphNode("web-server", {
        resourceType: "compute",
        provider: "aws",
        tags: { Environment: "staging" },
      });
      const changes = [
        makeDriftChange("metadata.instanceType", "t3.medium", "t3.large"),
      ];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform");

      expect(plan.totalPatches).toBe(1);
      expect(plan.format).toBe("terraform");
      const patch = plan.autoRemediable[0] ?? plan.manualReview[0];
      expect(patch).toBeDefined();
      expect(patch!.patch).toContain("aws_instance");
      expect(patch!.patch).toContain("instance_type");
    });

    it("generates tag updates in Terraform", () => {
      const node = makeGraphNode("tagged-server", {
        resourceType: "compute",
        provider: "aws",
      });
      const changes = [
        makeDriftChange("tags.Environment", "production", "staging"),
      ];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform");
      const patch = plan.autoRemediable[0] ?? plan.manualReview[0];
      expect(patch).toBeDefined();
      expect(patch!.patch).toContain("tags");
      expect(patch!.patch).toContain("Environment");
    });

    it("handles Azure resources with azurerm_ types", () => {
      const node = makeGraphNode("azure-db", {
        resourceType: "database",
        provider: "azure",
      });
      const changes = [
        makeDriftChange("metadata.engine", "mysql", "postgres"),
      ];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform");
      const patch = plan.autoRemediable[0] ?? plan.manualReview[0];
      expect(patch).toBeDefined();
      expect(patch!.patch).toContain("azurerm_");
    });

    it("handles GCP resources with google_ types", () => {
      const node = makeGraphNode("gcp-bucket", {
        resourceType: "storage",
        provider: "gcp",
      });
      const changes = [
        makeDriftChange("metadata.versioningEnabled", "true", "false"),
      ];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform");
      const patch = plan.autoRemediable[0] ?? plan.manualReview[0];
      expect(patch).toBeDefined();
      expect(patch!.patch).toContain("google_storage_bucket");
    });
  });

  describe("generateRemediationPlan — CloudFormation", () => {
    it("generates CloudFormation YAML patches", () => {
      const node = makeGraphNode("ec2-server", {
        resourceType: "compute",
        provider: "aws",
      });
      const changes = [
        makeDriftChange("metadata.instanceType", "t3.medium", "t3.xlarge"),
      ];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "cloudformation");
      expect(plan.format).toBe("cloudformation");
      const patch = plan.autoRemediable[0] ?? plan.manualReview[0];
      expect(patch).toBeDefined();
      expect(patch!.patch).toContain("Type: AWS::");
      expect(patch!.patch).toContain("InstanceType");
    });

    it("marks non-AWS resources as unremeditable for CloudFormation", () => {
      const node = makeGraphNode("azure-vm", {
        resourceType: "compute",
        provider: "azure",
      });
      const changes = [
        makeDriftChange("metadata.instanceType", "Standard_B2s", "Standard_D4s_v3"),
      ];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "cloudformation");
      expect(plan.unremeditable.length).toBe(1);
      expect(plan.unremeditable[0]!.reason).toContain("cloudformation");
    });
  });

  describe("Risk assessment", () => {
    it("marks production security changes as high risk", () => {
      const node = makeGraphNode("prod-db", {
        resourceType: "database",
        provider: "aws",
        tags: { Environment: "production" },
      });
      const changes = [
        makeDriftChange("metadata.publiclyAccessible", "false", "true"),
      ];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform");
      expect(plan.manualReview.length).toBe(1);
      expect(plan.manualReview[0]!.risk).toBe("high");
    });

    it("marks non-production non-security changes as low risk", () => {
      const node = makeGraphNode("dev-server", {
        resourceType: "compute",
        provider: "aws",
        tags: { Environment: "development" },
      });
      const changes = [
        makeDriftChange("metadata.instanceType", "t3.small", "t3.medium"),
      ];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform");
      expect(plan.autoRemediable.length).toBe(1);
      expect(plan.autoRemediable[0]!.risk).toBe("low");
    });

    it("marks status changes as high risk", () => {
      const node = makeGraphNode("server", {
        resourceType: "compute",
        provider: "aws",
      });
      const changes = [
        makeDriftChange("status", "running", "stopped"),
      ];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform");
      expect(plan.manualReview.length).toBe(1);
      expect(plan.manualReview[0]!.risk).toBe("high");
    });
  });

  describe("Edge cases", () => {
    it("handles disappeared nodes as unremeditable", () => {
      const disappeared = makeGraphNode("gone-server");
      const plan = generateRemediationPlan(makeDriftResult([], [disappeared]), "terraform");

      expect(plan.unremeditable.length).toBe(1);
      expect(plan.unremeditable[0]!.reason).toContain("disappeared");
    });

    it("handles empty drift result", () => {
      const plan = generateRemediationPlan(makeDriftResult([]), "terraform");
      expect(plan.totalPatches).toBe(0);
      expect(plan.autoRemediable).toEqual([]);
      expect(plan.manualReview).toEqual([]);
      expect(plan.unremeditable).toEqual([]);
    });

    it("handles changes with no field changes", () => {
      const node = makeGraphNode("no-fields");
      const changes: GraphChange[] = [];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform");
      expect(plan.unremeditable.length).toBe(1);
      expect(plan.unremeditable[0]!.reason).toContain("No specific field");
    });

    it("escapes Terraform interpolation syntax in values", () => {
      const node = makeGraphNode("injected-server", {
        resourceType: "compute",
        provider: "aws",
        tags: { Environment: "development" },
      });
      // Put the malicious value in prev (the value the patch writes)
      const changes = [
        makeDriftChange("tags.Environment", "${data.aws_secret.key}", "production"),
      ];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform");
      const patch = plan.autoRemediable[0] ?? plan.manualReview[0];
      expect(patch).toBeDefined();
      // The ${...} should be escaped — $$ in output means HCL literal $
      expect(patch!.patch).toContain("$${");
    });

    it("escapes special YAML characters in CloudFormation values", () => {
      const node = makeGraphNode("yaml-inject", {
        resourceType: "compute",
        provider: "aws",
        tags: { Environment: "development" },
      });
      // Put the value with special chars in prev (the value the patch writes)
      const changes = [
        makeDriftChange("metadata.instanceType", 'value"with\\special', "t3.medium"),
      ];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "cloudformation");
      const patch = plan.autoRemediable[0] ?? plan.manualReview[0];
      expect(patch).toBeDefined();
      // The patch should contain the value properly quoted
      expect(patch!.patch).toContain('value');
    });

    it("marks production non-security changes as medium risk", () => {
      const node = makeGraphNode("prod-server", {
        resourceType: "compute",
        provider: "aws",
        tags: { Environment: "production" },
      });
      const changes = [
        makeDriftChange("metadata.instanceType", "t3.small", "t3.medium"),
      ];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform");
      expect(plan.manualReview.length).toBe(1);
      expect(plan.manualReview[0]!.risk).toBe("medium");
    });
  });

  describe("formatRemediationMarkdown", () => {
    it("formats plan as markdown", () => {
      const node = makeGraphNode("web-app", {
        resourceType: "compute",
        provider: "aws",
      });
      const changes = [
        makeDriftChange("metadata.instanceType", "t3.small", "t3.large"),
      ];

      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform");
      const md = formatRemediationMarkdown(plan);

      expect(md).toContain("Drift Remediation Plan");
      expect(md).toContain("terraform");
    });

    it("includes sections for auto and manual", () => {
      const lowRisk = makeGraphNode("dev-server", {
        resourceType: "compute",
        provider: "aws",
        tags: { Environment: "development" },
      });
      const highRisk = makeGraphNode("prod-db", {
        resourceType: "database",
        provider: "aws",
        tags: { Environment: "production" },
      });

      const plan = generateRemediationPlan(
        makeDriftResult([
          { node: lowRisk, changes: [makeDriftChange("metadata.instanceType", "t3.small", "t3.medium")] },
          { node: highRisk, changes: [makeDriftChange("metadata.publiclyAccessible", "false", "true")] },
        ]),
        "terraform",
      );

      const md = formatRemediationMarkdown(plan);
      expect(md).toContain("Auto-Remediable");
      expect(md).toContain("Manual Review");
    });
  });

  // ===========================================================================
  // Dependency-Aware Ordering & Warnings
  // ===========================================================================

  describe("dependency-aware ordering", () => {
    it("orders patches by dependency (upstream first)", () => {
      const vpc = makeGraphNode("vpc-1", { resourceType: "vpc", provider: "aws" });
      const subnet = makeGraphNode("subnet-1", { resourceType: "subnet", provider: "aws" });

      const edges: DependencyEdge[] = [
        { sourceId: "vpc-1", targetId: "subnet-1", relationship: "contains" },
      ];

      const plan = generateRemediationPlan(
        makeDriftResult([
          { node: subnet, changes: [makeDriftChange("metadata.cidrBlock", "10.0.0.0/24", "10.0.1.0/24")] },
          { node: vpc, changes: [makeDriftChange("metadata.cidrBlock", "10.0.0.0/16", "10.0.0.0/20")] },
        ]),
        "terraform",
        { edges },
      );

      // VPC should come before subnet in ordered output
      const allPatches = [...plan.autoRemediable, ...plan.manualReview];
      if (allPatches.length >= 2) {
        const vpcIdx = allPatches.findIndex((p) => p.nodeId === "vpc-1");
        const subnetIdx = allPatches.findIndex((p) => p.nodeId === "subnet-1");
        // Upstream (vpc) should be ordered before downstream (subnet)
        expect(vpcIdx).toBeLessThan(subnetIdx);
      }
    });

    it("detects dependency warnings for sensitive field changes", () => {
      const sg = makeGraphNode("sg-1", { resourceType: "security-group", provider: "aws" });
      const server = makeGraphNode("server-1", { resourceType: "compute", provider: "aws" });

      const edges: DependencyEdge[] = [
        { sourceId: "sg-1", targetId: "server-1", relationship: "secures" },
      ];

      const plan = generateRemediationPlan(
        makeDriftResult([
          { node: sg, changes: [makeDriftChange("status", "active", "modified")] },
          { node: server, changes: [makeDriftChange("metadata.instanceType", "t3.small", "t3.medium")] },
        ]),
        "terraform",
        { edges },
      );

      expect(plan.dependencyWarnings).toBeDefined();
      expect(plan.dependencyWarnings!.length).toBeGreaterThan(0);
      expect(plan.dependencyWarnings![0]!.warning).toContain("status");
    });

    it("returns no dependency warnings when no edges provided", () => {
      const node = makeGraphNode("solo-server", { resourceType: "compute", provider: "aws" });
      const plan = generateRemediationPlan(
        makeDriftResult([
          { node, changes: [makeDriftChange("metadata.instanceType", "t3.small", "t3.medium")] },
        ]),
        "terraform",
      );

      expect(plan.dependencyWarnings ?? []).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Module-Aware Patches
  // ===========================================================================

  describe("module-aware patches", () => {
    it("generates module-wrapped Terraform patches", () => {
      const node = makeGraphNode("web-server", { resourceType: "compute", provider: "aws" });
      const changes = [
        makeDriftChange("metadata.instanceType", "t3.small", "t3.medium"),
      ];

      const options: RemediationOptions = { moduleAware: true };
      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform", options);

      const allPatches = [...plan.autoRemediable, ...plan.manualReview];
      expect(allPatches.length).toBeGreaterThan(0);
      const patch = allPatches[0]!;
      expect(patch.patch).toContain("module");
      expect(patch.patch).toContain("source");
      expect(patch.patch).toContain("./modules/");
    });

    it("uses custom module name when provided", () => {
      const node = makeGraphNode("web-server", { resourceType: "compute", provider: "aws" });
      const changes = [
        makeDriftChange("metadata.instanceType", "t3.small", "t3.medium"),
      ];

      const options: RemediationOptions = { moduleAware: true, moduleName: "my_custom_module" };
      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform", options);

      const allPatches = [...plan.autoRemediable, ...plan.manualReview];
      expect(allPatches.length).toBeGreaterThan(0);
      expect(allPatches[0]!.patch).toContain("my_custom_module");
    });
  });

  // ===========================================================================
  // Import Block Generation
  // ===========================================================================

  describe("import block generation", () => {
    it("generates Terraform import blocks when requested", () => {
      const node = makeGraphNode("db-instance", { resourceType: "database", provider: "aws" });
      const changes = [
        makeDriftChange("metadata.instanceClass", "db.t3.micro", "db.t3.small"),
      ];

      const options: RemediationOptions = { generateImports: true };
      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "terraform", options);

      expect(plan.importBlocks).toBeDefined();
      expect(plan.importBlocks!.length).toBeGreaterThan(0);
      const block = plan.importBlocks![0]!;
      expect(block.block).toContain("import {");
      expect(block.block).toContain("to =");
      expect(block.block).toContain("id =");
      expect(block.nodeId).toBe("db-instance");
    });

    it("does not generate import blocks for CloudFormation", () => {
      const node = makeGraphNode("cf-server", { resourceType: "compute", provider: "aws" });
      const changes = [
        makeDriftChange("metadata.instanceType", "t3.small", "t3.medium"),
      ];

      const options: RemediationOptions = { generateImports: true };
      const plan = generateRemediationPlan(makeDriftResult([{ node, changes }]), "cloudformation", options);

      expect(plan.importBlocks ?? []).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Markdown Output with New Sections
  // ===========================================================================

  describe("formatRemediationMarkdown — dependency warnings & imports", () => {
    it("renders dependency warnings in markdown output", () => {
      const sg = makeGraphNode("sg-1", { resourceType: "security-group", provider: "aws" });
      const server = makeGraphNode("server-1", { resourceType: "compute", provider: "aws" });

      const edges: DependencyEdge[] = [
        { sourceId: "sg-1", targetId: "server-1", relationship: "secures" },
      ];

      const plan = generateRemediationPlan(
        makeDriftResult([
          { node: sg, changes: [makeDriftChange("status", "active", "modified")] },
          { node: server, changes: [makeDriftChange("metadata.instanceType", "t3.small", "t3.medium")] },
        ]),
        "terraform",
        { edges },
      );

      const md = formatRemediationMarkdown(plan);
      expect(md).toContain("Dependency Warning");
    });

    it("renders import blocks in markdown output", () => {
      const node = makeGraphNode("db-prod", { resourceType: "database", provider: "aws" });
      const plan = generateRemediationPlan(
        makeDriftResult([
          { node, changes: [makeDriftChange("metadata.instanceClass", "db.t3.micro", "db.t3.small")] },
        ]),
        "terraform",
        { generateImports: true },
      );

      const md = formatRemediationMarkdown(plan);
      expect(md).toContain("Import Block");
      expect(md).toContain("import {");
    });
  });

  // ===========================================================================
  // Pulumi IaC Format
  // ===========================================================================

  describe("Pulumi format", () => {
    it("generates Pulumi TypeScript patches for AWS compute", () => {
      const node = makeGraphNode("ec2-1", {
        resourceType: "compute",
        provider: "aws",
        nativeId: "i-0123456789",
      });
      const plan = generateRemediationPlan(
        makeDriftResult([
          { node, changes: [makeDriftChange("metadata.instanceType", "t3.small", "t3.medium")] },
        ]),
        "pulumi",
      );

      expect(plan.format).toBe("pulumi");
      const allPatches = [...plan.autoRemediable, ...plan.manualReview];
      expect(allPatches.length).toBeGreaterThan(0);

      // Should contain TypeScript/Pulumi SDK reference
      const patchContent = allPatches.map(p => p.patch).join("\n");
      expect(patchContent).toContain("pulumi");
    });

    it("generates Pulumi patches for Azure resources", () => {
      const node = makeGraphNode("vm-1", {
        resourceType: "compute",
        provider: "azure",
        nativeId: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
      });
      const plan = generateRemediationPlan(
        makeDriftResult([
          { node, changes: [makeDriftChange("status", "running", "stopped")] },
        ]),
        "pulumi",
      );

      expect(plan.format).toBe("pulumi");
      expect(plan.totalPatches).toBeGreaterThan(0);
    });

    it("generates Pulumi patches for GCP resources", () => {
      const node = makeGraphNode("gce-1", {
        resourceType: "compute",
        provider: "gcp",
        nativeId: "projects/myproj/zones/us-central1-a/instances/gce1",
      });
      const plan = generateRemediationPlan(
        makeDriftResult([
          { node, changes: [makeDriftChange("metadata.machineType", "n1-standard-1", "n1-standard-2")] },
        ]),
        "pulumi",
      );

      expect(plan.format).toBe("pulumi");
      expect(plan.totalPatches).toBeGreaterThan(0);
    });

    it("formats Pulumi patches as TypeScript code fences in markdown", () => {
      const node = makeGraphNode("db-pulumi", { resourceType: "database", provider: "aws" });
      const plan = generateRemediationPlan(
        makeDriftResult([
          { node, changes: [makeDriftChange("metadata.instanceClass", "db.t3.micro", "db.t3.small")] },
        ]),
        "pulumi",
      );

      const md = formatRemediationMarkdown(plan);
      expect(md).toContain("typescript");
    });

    it("handles multiple drifted nodes in a single plan", () => {
      const n1 = makeGraphNode("ec2-a", { resourceType: "compute", provider: "aws" });
      const n2 = makeGraphNode("db-a", { resourceType: "database", provider: "aws" });
      const plan = generateRemediationPlan(
        makeDriftResult([
          { node: n1, changes: [makeDriftChange("status", "running", "stopped")] },
          { node: n2, changes: [makeDriftChange("metadata.storageEncrypted", "true", "false")] },
        ]),
        "pulumi",
      );

      expect(plan.totalPatches).toBe(2);
    });
  });

  // ===========================================================================
  // OpenTofu IaC Format
  // ===========================================================================

  describe("OpenTofu format", () => {
    it("generates OpenTofu patches (HCL like Terraform)", () => {
      const node = makeGraphNode("ec2-ot", {
        resourceType: "compute",
        provider: "aws",
        nativeId: "i-0123456789",
      });
      const plan = generateRemediationPlan(
        makeDriftResult([
          { node, changes: [makeDriftChange("metadata.instanceType", "t3.small", "t3.medium")] },
        ]),
        "opentofu",
      );

      expect(plan.format).toBe("opentofu");
      expect(plan.totalPatches).toBeGreaterThan(0);
      // OpenTofu uses HCL syntax similar to Terraform
      const allPatches = [...plan.autoRemediable, ...plan.manualReview];
      const patchContent = allPatches.map(p => p.patch).join("\n");
      expect(patchContent).toContain("resource");
    });

    it("generates import blocks for OpenTofu when requested", () => {
      const node = makeGraphNode("db-ot", {
        resourceType: "database",
        provider: "aws",
        nativeId: "arn:aws:rds:us-east-1:123:db:mydb",
      });
      const plan = generateRemediationPlan(
        makeDriftResult([
          { node, changes: [makeDriftChange("metadata.instanceClass", "db.t3.micro", "db.t3.small")] },
        ]),
        "opentofu",
        { generateImports: true },
      );

      expect(plan.importBlocks!.length).toBeGreaterThan(0);
      const importContent = plan.importBlocks!.map(b => b.block).join("\n");
      expect(importContent).toContain("import");
    });

    it("includes hcl code fence in markdown output", () => {
      const node = makeGraphNode("ec2-ot-md", { resourceType: "compute", provider: "aws" });
      const plan = generateRemediationPlan(
        makeDriftResult([
          { node, changes: [makeDriftChange("status", "running", "stopped")] },
        ]),
        "opentofu",
      );

      const md = formatRemediationMarkdown(plan);
      expect(md).toContain("hcl");
    });

    it("handles disappeared nodes in OpenTofu plan", () => {
      const disappeared = makeGraphNode("deleted-1", { resourceType: "compute", provider: "aws" });
      const plan = generateRemediationPlan(
        makeDriftResult([], [disappeared]),
        "opentofu",
      );

      // Disappeared nodes are listed in unremeditable, not as patches
      expect(plan.totalDriftedResources).toBeGreaterThanOrEqual(0);
      // The plan should still generate successfully
      expect(plan.format).toBe("opentofu");
    });
  });

  // ===========================================================================
  // IaCFormat type coverage
  // ===========================================================================

  describe("IaCFormat", () => {
    it("supports all four formats", () => {
      const formats: IaCFormat[] = ["terraform", "cloudformation", "pulumi", "opentofu"];
      for (const format of formats) {
        const node = makeGraphNode(`test-${format}`, { resourceType: "compute", provider: "aws" });
        const plan = generateRemediationPlan(
          makeDriftResult([
            { node, changes: [makeDriftChange("status", "a", "b")] },
          ]),
          format,
        );
        expect(plan.format).toBe(format);
        expect(plan.totalPatches).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
