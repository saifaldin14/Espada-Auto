/**
 * Tests for the deployment impact analysis module.
 */

import { describe, it, expect } from "vitest";
import {
  parseTerraformPlan,
  formatDeploymentImpactMarkdown,
} from "./deployment-impact.js";
import type {
  TerraformPlan,
  PlannedChange,
  ChangeImpact,
  DeploymentImpactReport,
  DeploymentImpactSummary,
} from "./deployment-impact.js";

// =============================================================================
// Tests
// =============================================================================

describe("Deployment Impact Analysis", () => {
  describe("parseTerraformPlan", () => {
    it("parses create action", () => {
      const plan: TerraformPlan = {
        resource_changes: [{
          address: "aws_instance.web",
          type: "aws_instance",
          name: "web",
          provider_name: "registry.terraform.io/hashicorp/aws",
          change: {
            actions: ["create"],
            before: null,
            after: { instance_type: "t3.micro", ami: "ami-123" },
          },
        }],
      };
      const changes = parseTerraformPlan(plan);
      expect(changes).toHaveLength(1);
      expect(changes[0]!.action).toBe("create");
      expect(changes[0]!.provider).toBe("aws");
      expect(changes[0]!.resourceType).toBe("aws_instance");
    });

    it("parses delete action", () => {
      const plan: TerraformPlan = {
        resource_changes: [{
          address: "aws_s3_bucket.old",
          type: "aws_s3_bucket",
          name: "old",
          provider_name: "registry.terraform.io/hashicorp/aws",
          change: {
            actions: ["delete"],
            before: { bucket: "my-old-bucket" },
            after: null,
          },
        }],
      };
      const changes = parseTerraformPlan(plan);
      expect(changes).toHaveLength(1);
      expect(changes[0]!.action).toBe("delete");
    });

    it("parses update action with changed attributes", () => {
      const plan: TerraformPlan = {
        resource_changes: [{
          address: "aws_instance.web",
          type: "aws_instance",
          name: "web",
          provider_name: "registry.terraform.io/hashicorp/aws",
          change: {
            actions: ["update"],
            before: { instance_type: "t3.micro", ami: "ami-123" },
            after: { instance_type: "t3.large", ami: "ami-123" },
          },
        }],
      };
      const changes = parseTerraformPlan(plan);
      expect(changes).toHaveLength(1);
      expect(changes[0]!.action).toBe("update");
      expect(changes[0]!.changedAttributes).toContain("instance_type");
      expect(changes[0]!.changedAttributes).not.toContain("ami");
    });

    it("parses replace (create+delete) action", () => {
      const plan: TerraformPlan = {
        resource_changes: [{
          address: "aws_instance.web",
          type: "aws_instance",
          name: "web",
          provider_name: "registry.terraform.io/hashicorp/aws",
          change: {
            actions: ["delete", "create"],
            before: { instance_type: "t3.micro" },
            after: { instance_type: "t3.large" },
          },
        }],
      };
      const changes = parseTerraformPlan(plan);
      expect(changes).toHaveLength(1);
      expect(changes[0]!.action).toBe("replace");
    });

    it("skips no-op and read actions", () => {
      const plan: TerraformPlan = {
        resource_changes: [
          {
            address: "aws_instance.web",
            type: "aws_instance",
            name: "web",
            provider_name: "registry.terraform.io/hashicorp/aws",
            change: { actions: ["no-op"], before: {}, after: {} },
          },
          {
            address: "data.aws_ami.latest",
            type: "aws_ami",
            name: "latest",
            provider_name: "registry.terraform.io/hashicorp/aws",
            change: { actions: ["read"], before: null, after: {} },
          },
        ],
      };
      const changes = parseTerraformPlan(plan);
      expect(changes).toHaveLength(0);
    });

    it("handles empty plan", () => {
      const changes = parseTerraformPlan({});
      expect(changes).toHaveLength(0);
    });

    it("maps Azure provider correctly", () => {
      const plan: TerraformPlan = {
        resource_changes: [{
          address: "azurerm_resource_group.rg",
          type: "azurerm_resource_group",
          name: "rg",
          provider_name: "registry.terraform.io/hashicorp/azurerm",
          change: { actions: ["create"], before: null, after: { name: "rg" } },
        }],
      };
      const changes = parseTerraformPlan(plan);
      expect(changes[0]!.provider).toBe("azure");
    });

    it("maps GCP provider correctly", () => {
      const plan: TerraformPlan = {
        resource_changes: [{
          address: "google_compute_instance.vm",
          type: "google_compute_instance",
          name: "vm",
          provider_name: "registry.terraform.io/hashicorp/google",
          change: { actions: ["create"], before: null, after: { name: "vm" } },
        }],
      };
      const changes = parseTerraformPlan(plan);
      expect(changes[0]!.provider).toBe("gcp");
    });
  });

  describe("formatDeploymentImpactMarkdown", () => {
    it("renders a report", () => {
      const change: PlannedChange = {
        address: "aws_instance.web",
        action: "update",
        resourceType: "aws_instance",
        provider: "aws",
        before: { instance_type: "t3.micro" },
        after: { instance_type: "t3.large" },
        changedAttributes: ["instance_type"],
      };

      const impact: ChangeImpact = {
        change,
        graphNodeId: "node-web",
        downstreamNodes: [],
        upstreamNodes: [],
        blastRadius: 3,
        affectedEdges: [],
        costDelta: 50,
        riskScore: 45,
        riskFactors: ["production environment"],
        riskLevel: "medium",
      };

      const report: DeploymentImpactReport = {
        generatedAt: new Date().toISOString(),
        planSource: "terraform plan",
        impacts: [impact],
        overallRisk: {
          score: 45,
          level: "medium",
          factors: ["production environment"],
        },
        summary: {
          totalChanges: 1,
          creates: 0,
          updates: 1,
          deletes: 0,
          replaces: 0,
          totalBlastRadius: 3,
          totalCostDelta: 50,
          criticalResources: 0,
          complianceImpacts: 0,
          byResourceType: {},
        },
      };

      const md = formatDeploymentImpactMarkdown(report);
      expect(md).toContain("Deployment Impact");
      expect(md).toContain("aws_instance.web");
      expect(md).toContain("medium");
    });

    it("renders empty report", () => {
      const report: DeploymentImpactReport = {
        generatedAt: new Date().toISOString(),
        planSource: "empty plan",
        impacts: [],
        overallRisk: { score: 0, level: "low", factors: [] },
        summary: {
          totalChanges: 0,
          creates: 0,
          updates: 0,
          deletes: 0,
          replaces: 0,
          totalBlastRadius: 0,
          totalCostDelta: 0,
          criticalResources: 0,
          complianceImpacts: 0,
          byResourceType: {},
        },
      };

      const md = formatDeploymentImpactMarkdown(report);
      expect(md).toContain("Deployment Impact");
    });

    it("renders dependency paths section when edges are present", () => {
      const change: PlannedChange = {
        address: "aws_instance.web",
        action: "delete",
        resourceType: "aws_instance",
        provider: "aws",
        before: { instance_type: "t3.micro" },
        after: null,
        changedAttributes: [],
      };

      const impact: ChangeImpact = {
        change,
        graphNodeId: "node-web",
        downstreamNodes: [],
        upstreamNodes: [],
        blastRadius: 2,
        affectedEdges: [
          {
            id: "edge-1",
            sourceNodeId: "node-web",
            targetNodeId: "node-db",
            relationshipType: "connects-to",
            confidence: 1.0,
            discoveredVia: "config",
            metadata: {},
            createdAt: "2024-01-01T00:00:00Z",
            lastSeenAt: "2024-01-01T00:00:00Z",
          },
          {
            id: "edge-2",
            sourceNodeId: "node-web",
            targetNodeId: "node-cache",
            relationshipType: "connects-to",
            confidence: 0.9,
            discoveredVia: "config",
            metadata: {},
            createdAt: "2024-01-01T00:00:00Z",
            lastSeenAt: "2024-01-01T00:00:00Z",
          },
        ] as any,
        costDelta: -100,
        riskScore: 60,
        riskFactors: ["Destructive action"],
        riskLevel: "high",
      };

      const report: DeploymentImpactReport = {
        generatedAt: new Date().toISOString(),
        planSource: "test",
        impacts: [impact],
        overallRisk: { score: 60, level: "high", factors: [] },
        summary: {
          totalChanges: 1,
          creates: 0,
          updates: 0,
          deletes: 1,
          replaces: 0,
          totalBlastRadius: 2,
          totalCostDelta: -100,
          criticalResources: 0,
          complianceImpacts: 0,
          byResourceType: {},
        },
      };

      const md = formatDeploymentImpactMarkdown(report);
      expect(md).toContain("Dependency Paths");
      expect(md).toContain("connects-to");
    });

    it("renders changes by resource type breakdown", () => {
      const report: DeploymentImpactReport = {
        generatedAt: new Date().toISOString(),
        planSource: "test",
        impacts: [],
        overallRisk: { score: 20, level: "low", factors: [] },
        summary: {
          totalChanges: 3,
          creates: 1,
          updates: 2,
          deletes: 0,
          replaces: 0,
          totalBlastRadius: 5,
          totalCostDelta: 0,
          criticalResources: 0,
          complianceImpacts: 0,
          byResourceType: { compute: 3, database: 2, storage: 1 },
        },
      };

      const md = formatDeploymentImpactMarkdown(report);
      expect(md).toContain("Changes by Resource Type");
      expect(md).toContain("compute");
      expect(md).toContain("database");
      expect(md).toContain("storage");
    });
  });
});
