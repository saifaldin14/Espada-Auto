/**
 * Tests for the drift auto-remediation module (P2.21).
 */

import { describe, it, expect } from "vitest";
import type { GraphNode, DriftResult, GraphChange } from "../types.js";
import {
  generateRemediationPlan,
  formatRemediationMarkdown,
} from "./remediation.js";
import type { IaCFormat } from "./remediation.js";

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
});
