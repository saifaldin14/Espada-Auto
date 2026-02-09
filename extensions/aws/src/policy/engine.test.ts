/**
 * Policy Engine Tests
 *
 * Validates that the policy engine correctly evaluates built-in rules
 * against infrastructure plans, classifies violations, and applies auto-fixes.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  PolicyEngine,
  createPolicyEngine,
  COMPLIANCE_POLICY_SETS,
  type PolicyRule,
} from "./engine.js";
import type {
  ApplicationIntent,
  PlannedResource,
} from "../intent/types.js";

// =============================================================================
// Fixtures
// =============================================================================

function makeIntent(overrides?: Partial<ApplicationIntent>): ApplicationIntent {
  return {
    name: "test-app",
    tiers: [],
    environment: "production",
    availability: "99.95",
    cost: { monthlyBudgetUsd: 1000 },
    compliance: ["hipaa"],
    security: {
      encryptionAtRest: true,
      encryptionInTransit: true,
      networkIsolation: "private-subnet",
    },
    primaryRegion: "us-east-1",
    ...overrides,
  };
}

function makeResource(
  type: string,
  props: Record<string, unknown> = {},
  id?: string,
): PlannedResource {
  return {
    id: id ?? `${type}-1`,
    type,
    service: type.split("_")[0],
    properties: props,
    dependencies: [],
    estimatedCostUsd: 50,
    region: "us-east-1",
    tags: {},
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = createPolicyEngine();
  });

  // ---------- Encryption at rest ----------

  describe("encryption-at-rest", () => {
    it("should pass when RDS has storageEncrypted=true", async () => {
      const intent = makeIntent();
      const resource = makeResource("rds_instance", { storageEncrypted: true });
      const result = await engine.validatePlan([resource], intent);
      const encViolations = result.violations.filter((v) => v.policy === "encryption-at-rest");
      expect(encViolations).toHaveLength(0);
    });

    it("should fail when RDS lacks encryption", async () => {
      const intent = makeIntent();
      const resource = makeResource("rds_instance", { storageEncrypted: false });
      const result = await engine.validatePlan([resource], intent);
      const encViolations = result.violations.filter((v) => v.policy === "encryption-at-rest");
      expect(encViolations.length).toBeGreaterThan(0);
    });

    it("should skip when intent disables encryption at rest", async () => {
      const intent = makeIntent({
        security: { encryptionAtRest: false, encryptionInTransit: false, networkIsolation: "none" },
      });
      const resource = makeResource("rds_instance", { storageEncrypted: false });
      const result = await engine.validatePlan([resource], intent);
      const encViolations = result.violations.filter((v) => v.policy === "encryption-at-rest");
      expect(encViolations).toHaveLength(0);
    });

    it("should pass for S3 bucket with AES256 encryption", async () => {
      const intent = makeIntent();
      const resource = makeResource("s3_bucket", { encryption: "AES256" });
      const result = await engine.validatePlan([resource], intent);
      const violations = result.violations.filter((v) => v.policy === "encryption-at-rest");
      expect(violations).toHaveLength(0);
    });
  });

  // ---------- No public databases ----------

  describe("no-public-databases", () => {
    it("should fail when RDS is publicly accessible", async () => {
      const intent = makeIntent();
      const resource = makeResource("rds_instance", {
        publiclyAccessible: true,
        storageEncrypted: true,
      });
      const result = await engine.validatePlan([resource], intent);
      const violations = result.violations.filter((v) => v.policy === "no-public-databases");
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].severity).toBe("critical");
    });

    it("should pass when RDS is private", async () => {
      const intent = makeIntent();
      const resource = makeResource("rds_instance", {
        publiclyAccessible: false,
        storageEncrypted: true,
      });
      const result = await engine.validatePlan([resource], intent);
      const violations = result.violations.filter((v) => v.policy === "no-public-databases");
      expect(violations).toHaveLength(0);
    });
  });

  // ---------- Multi-AZ ----------

  describe("multi-az-required", () => {
    it("should fail for production RDS without multi-AZ", async () => {
      const intent = makeIntent({ environment: "production", availability: "99.99" });
      const resource = makeResource("rds_instance", {
        multiAz: false,
        storageEncrypted: true,
      });
      const result = await engine.validatePlan([resource], intent);
      // multi-az is severity 'high' which ends up as a violation
      const violations = result.violations.filter((v) => v.policy === "multi-az-required");
      expect(violations.length).toBeGreaterThan(0);
    });

    it("should skip for non-production", async () => {
      const intent = makeIntent({ environment: "development" });
      const resource = makeResource("rds_instance", { multiAz: false });
      const result = await engine.validatePlan([resource], intent);
      const violations = result.violations.filter((v) => v.policy === "multi-az-required");
      expect(violations).toHaveLength(0);
    });
  });

  // ---------- S3 block public access ----------

  describe("s3-block-public-access", () => {
    it("should fail when S3 allows public access", async () => {
      const intent = makeIntent();
      const resource = makeResource("s3_bucket", { blockPublicAccess: false });
      const result = await engine.validatePlan([resource], intent);
      const violations = result.violations.filter((v) => v.policy === "s3-block-public-access");
      expect(violations.length).toBeGreaterThan(0);
    });

    it("should pass when blockPublicAccess is true", async () => {
      const intent = makeIntent();
      const resource = makeResource("s3_bucket", { blockPublicAccess: true });
      const result = await engine.validatePlan([resource], intent);
      const violations = result.violations.filter((v) => v.policy === "s3-block-public-access");
      expect(violations).toHaveLength(0);
    });
  });

  // ---------- IAM least privilege ----------

  describe("iam-least-privilege", () => {
    it("should fail when IAM role has AdministratorAccess", async () => {
      const intent = makeIntent({ compliance: ["soc2"] });
      const resource = makeResource("iam_role", {
        managedPolicies: ["arn:aws:iam::aws:policy/AdministratorAccess"],
      });
      const result = await engine.validatePlan([resource], intent);
      // iam-least-privilege is severity 'medium' → goes to warnings
      expect(result.warnings.some((w) => w.message.includes("overly permissive"))).toBe(true);
    });
  });

  // ---------- Required tags ----------

  describe("required-tags", () => {
    it("should warn when required tags are missing", async () => {
      const intent = makeIntent();
      const resource = makeResource("ec2_instance", {});
      resource.tags = {};
      const result = await engine.validatePlan([resource], intent);
      expect(result.warnings.some((w) => w.message.includes("missing required tags"))).toBe(true);
    });

    it("should pass when all required tags are present", async () => {
      const intent = makeIntent();
      const resource = makeResource("ec2_instance", {});
      resource.tags = { Environment: "prod", Owner: "team", CostCenter: "cc-1" };
      const result = await engine.validatePlan([resource], intent);
      expect(result.warnings.filter((w) => w.message.includes("missing required tags"))).toHaveLength(0);
    });
  });

  // ---------- Auto-fix ----------

  describe("auto-fix", () => {
    it("should auto-fix RDS encryption when enabled", async () => {
      const autoFixEngine = createPolicyEngine({ enableAutoFix: true });
      const intent = makeIntent();
      const resources = [makeResource("rds_instance", { storageEncrypted: false })];
      await autoFixEngine.validatePlan(resources, intent);
      expect(resources[0].properties.storageEncrypted).toBe(true);
    });

    it("should auto-fix S3 public access when enabled", async () => {
      const autoFixEngine = createPolicyEngine({ enableAutoFix: true });
      const intent = makeIntent();
      const resources = [makeResource("s3_bucket", { blockPublicAccess: false })];
      await autoFixEngine.validatePlan(resources, intent);
      expect(resources[0].properties.blockPublicAccess).toBe(true);
    });

    it("should add required tags via auto-fix", async () => {
      const autoFixEngine = createPolicyEngine({ enableAutoFix: true });
      const intent = makeIntent();
      const resources = [makeResource("ec2_instance")];
      resources[0].tags = {};
      await autoFixEngine.validatePlan(resources, intent);
      expect(resources[0].tags.Environment).toBeDefined();
      expect(resources[0].tags.Owner).toBeDefined();
      expect(resources[0].tags.CostCenter).toBeDefined();
    });
  });

  // ---------- Custom rules ----------

  describe("custom rules", () => {
    it("should accept and evaluate custom rules", async () => {
      const custom: PolicyRule = {
        id: "custom-test",
        name: "Custom Test Rule",
        description: "test",
        severity: "high",
        frameworks: ["none"],
        resourceTypes: ["ec2_instance"],
        evaluate: () => ({ passed: false, message: "custom fail", autoFixable: false }),
      };
      const eng = createPolicyEngine({ customRules: [custom] });
      const result = await eng.validatePlan(
        [makeResource("ec2_instance")],
        makeIntent(),
      );
      expect(result.violations.some((v) => v.policy === "custom-test")).toBe(true);
    });

    it("should support addRule/removeRule", async () => {
      const rule: PolicyRule = {
        id: "dynamic",
        name: "Dynamic",
        description: "d",
        severity: "critical",
        frameworks: ["none"],
        resourceTypes: [],
        evaluate: () => ({ passed: false, message: "nope", autoFixable: false }),
      };
      engine.addRule(rule);
      const before = await engine.validatePlan([makeResource("ec2_instance")], makeIntent());
      expect(before.violations.some((v) => v.policy === "dynamic")).toBe(true);

      engine.removeRule("dynamic");
      const after = await engine.validatePlan([makeResource("ec2_instance")], makeIntent());
      expect(after.violations.some((v) => v.policy === "dynamic")).toBe(false);
    });
  });

  // ---------- Validate single resource ----------

  describe("validateResource", () => {
    it("should return evaluations for a single resource", async () => {
      const results = await engine.validateResource(
        makeResource("rds_instance", { storageEncrypted: true }),
        makeIntent(),
      );
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  // ---------- Compliance policy sets ----------

  describe("COMPLIANCE_POLICY_SETS", () => {
    it("should have entries for major frameworks", () => {
      expect(COMPLIANCE_POLICY_SETS.hipaa.length).toBeGreaterThan(0);
      expect(COMPLIANCE_POLICY_SETS["pci-dss"].length).toBeGreaterThan(0);
      expect(COMPLIANCE_POLICY_SETS.soc2.length).toBeGreaterThan(0);
      expect(COMPLIANCE_POLICY_SETS.gdpr.length).toBeGreaterThan(0);
    });
  });

  // ---------- Plan-level pass/fail ----------

  describe("plan-level result", () => {
    it("should fail when critical violation exists and failOnCritical is true", async () => {
      const eng = createPolicyEngine({ failOnCritical: true });
      const result = await eng.validatePlan(
        [makeResource("rds_instance", { publiclyAccessible: true, storageEncrypted: false })],
        makeIntent(),
      );
      expect(result.passed).toBe(false);
    });

    it("should pass when only non-critical violations exist", async () => {
      const eng = createPolicyEngine({ failOnCritical: true });
      const result = await eng.validatePlan(
        [makeResource("ec2_instance", { vpcId: "vpc-123" })],
        makeIntent({ compliance: ["none"] }),
      );
      // with compliance: none, few rules apply; should have no critical violations
      expect(result.violations.filter((v) => v.severity === "critical")).toHaveLength(0);
    });
  });
});
