/**
 * Policy Engine — Engine Tests
 *
 * Covers: evaluateAll aggregation, scanResources violations,
 * complex condition combinators, plan/cost/graph inputs, policyApplies patterns.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEvaluationEngine } from "./engine.js";
import type { PolicyDefinition, PolicyEvaluationInput, ResourceInput } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────

function makePolicy(overrides: Partial<PolicyDefinition> = {}): PolicyDefinition {
  return {
    id: "pol-1",
    name: "Test Policy",
    description: "A test policy",
    type: "plan",
    enabled: true,
    severity: "medium",
    labels: [],
    autoAttachPatterns: [],
    rules: [],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeResource(overrides: Partial<ResourceInput> = {}): ResourceInput {
  return {
    id: "res-1",
    type: "aws_s3_bucket",
    name: "my-bucket",
    provider: "aws",
    region: "us-east-1",
    status: "active",
    tags: {},
    metadata: {},
    ...overrides,
  };
}

// ── evaluateAll ──────────────────────────────────────────────────

describe("PolicyEvaluationEngine.evaluateAll", () => {
  let engine: PolicyEvaluationEngine;

  beforeEach(() => {
    engine = new PolicyEvaluationEngine();
  });

  it("returns allowed when all policies pass", () => {
    const policies = [
      makePolicy({ id: "p1", rules: [] }),
      makePolicy({ id: "p2", rules: [] }),
    ];
    const result = engine.evaluateAll(policies, { resource: makeResource() });
    expect(result.allowed).toBe(true);
    expect(result.denied).toBe(false);
    expect(result.totalPolicies).toBe(2);
    expect(result.passedPolicies).toBe(2);
    expect(result.failedPolicies).toBe(0);
  });

  it("deny wins when one policy denies", () => {
    const policies = [
      makePolicy({ id: "p1", rules: [] }),
      makePolicy({
        id: "p2",
        rules: [{
          id: "r1",
          description: "deny all S3",
          condition: { type: "resource_type", resourceType: "aws_s3_bucket" },
          action: "deny",
          message: "No S3",
        }],
      }),
    ];
    const result = engine.evaluateAll(policies, { resource: makeResource() });
    expect(result.allowed).toBe(false);
    expect(result.denied).toBe(true);
    expect(result.failedPolicies).toBe(1);
    expect(result.passedPolicies).toBe(1);
    expect(result.denials).toContain("No S3");
  });

  it("aggregates warnings and notifications across policies", () => {
    const policies = [
      makePolicy({
        id: "p1",
        rules: [{
          id: "r1", description: "w", action: "warn", message: "warning-A",
          condition: { type: "provider", provider: "aws" },
        }],
      }),
      makePolicy({
        id: "p2",
        rules: [{
          id: "r2", description: "n", action: "notify", message: "notif-B",
          condition: { type: "region", region: "us-east-1" },
        }],
      }),
    ];
    const result = engine.evaluateAll(policies, { resource: makeResource() });
    expect(result.warnings).toContain("warning-A");
    expect(result.notifications).toContain("notif-B");
    expect(result.allowed).toBe(true);
  });

  it("tracks approvalRequired across policies", () => {
    const policies = [
      makePolicy({ id: "p1", rules: [] }),
      makePolicy({
        id: "p2",
        rules: [{
          id: "r1", description: "approval", action: "require_approval", message: "needs approval",
          condition: { type: "provider", provider: "aws" },
        }],
      }),
    ];
    const result = engine.evaluateAll(policies, { resource: makeResource() });
    expect(result.approvalRequired).toBe(true);
    expect(result.allowed).toBe(true);
  });

  it("handles empty policy list", () => {
    const result = engine.evaluateAll([], { resource: makeResource() });
    expect(result.allowed).toBe(true);
    expect(result.totalPolicies).toBe(0);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ── Complex conditions (and/or/not) ─────────────────────────────

describe("Complex condition combinators", () => {
  let engine: PolicyEvaluationEngine;

  beforeEach(() => {
    engine = new PolicyEvaluationEngine();
  });

  it("and: triggers only when all sub-conditions match", () => {
    const policy = makePolicy({
      rules: [{
        id: "r1", description: "and-rule", action: "deny", message: "denied",
        condition: {
          type: "and",
          conditions: [
            { type: "provider", provider: "aws" },
            { type: "region", region: "eu-west-1" },
          ],
        },
      }],
    });
    // Region doesn't match → should pass
    const result = engine.evaluate(policy, { resource: makeResource({ region: "us-east-1" }) });
    expect(result.denied).toBe(false);

    // Both match → should deny
    const result2 = engine.evaluate(policy, { resource: makeResource({ region: "eu-west-1" }) });
    expect(result2.denied).toBe(true);
  });

  it("or: triggers when any sub-condition matches", () => {
    const policy = makePolicy({
      rules: [{
        id: "r1", description: "or-rule", action: "deny", message: "denied",
        condition: {
          type: "or",
          conditions: [
            { type: "region", region: "us-east-1" },
            { type: "region", region: "eu-west-1" },
          ],
        },
      }],
    });
    const result = engine.evaluate(policy, { resource: makeResource({ region: "us-east-1" }) });
    expect(result.denied).toBe(true);

    const result2 = engine.evaluate(policy, { resource: makeResource({ region: "ap-south-1" }) });
    expect(result2.denied).toBe(false);
  });

  it("not: inverts a condition", () => {
    const policy = makePolicy({
      rules: [{
        id: "r1", description: "not-rule", action: "deny", message: "non-aws denied",
        condition: {
          type: "not",
          condition: { type: "provider", provider: "aws" },
        },
      }],
    });
    // aws → not triggers = false → allowed
    const result = engine.evaluate(policy, { resource: makeResource({ provider: "aws" }) });
    expect(result.denied).toBe(false);

    // gcp → not triggers = true → denied
    const result2 = engine.evaluate(policy, { resource: makeResource({ provider: "gcp" }) });
    expect(result2.denied).toBe(true);
  });
});

// ── Plan, cost, and graph inputs ─────────────────────────────────

describe("Plan/cost/graph input evaluation", () => {
  let engine: PolicyEvaluationEngine;

  beforeEach(() => {
    engine = new PolicyEvaluationEngine();
  });

  it("field_gt matches plan.totalDeletes", () => {
    const policy = makePolicy({
      rules: [{
        id: "r1", description: "too many deletes", action: "deny", message: "too many deletes",
        condition: { type: "field_gt", field: "plan.totalDeletes", value: 5 },
      }],
    });
    const result = engine.evaluate(policy, {
      resource: makeResource(),
      plan: { totalCreates: 0, totalUpdates: 0, totalDeletes: 10 },
    });
    expect(result.denied).toBe(true);
  });

  it("field_lt matches cost.delta", () => {
    const policy = makePolicy({
      rules: [{
        id: "r1", description: "low cost", action: "notify", message: "low cost change",
        condition: { type: "field_lt", field: "cost.delta", value: 10 },
      }],
    });
    const result = engine.evaluate(policy, {
      resource: makeResource(),
      cost: { current: 100, projected: 105, delta: 5, currency: "USD" },
    });
    expect(result.notifications).toContain("low cost change");
  });

  it("field_gt on graph.blastRadius", () => {
    const policy = makePolicy({
      rules: [{
        id: "r1", description: "blast radius", action: "warn", message: "high blast radius",
        condition: { type: "field_gt", field: "graph.blastRadius", value: 20 },
      }],
    });
    const result = engine.evaluate(policy, {
      resource: makeResource(),
      graph: { neighbors: [], blastRadius: 30, dependencyDepth: 3 },
    });
    expect(result.warnings).toContain("high blast radius");
  });
});

// ── Tag conditions ──────────────────────────────────────────────

describe("Tag conditions", () => {
  let engine: PolicyEvaluationEngine;

  beforeEach(() => {
    engine = new PolicyEvaluationEngine();
  });

  it("tag_missing denies when tag absent", () => {
    const policy = makePolicy({
      rules: [{
        id: "r1", description: "require env tag", action: "deny", message: "missing env",
        condition: { type: "tag_missing", tag: "environment" },
      }],
    });
    const result = engine.evaluate(policy, { resource: makeResource({ tags: {} }) });
    expect(result.denied).toBe(true);
  });

  it("tag_missing passes when tag present", () => {
    const policy = makePolicy({
      rules: [{
        id: "r1", description: "require env tag", action: "deny", message: "missing env",
        condition: { type: "tag_missing", tag: "environment" },
      }],
    });
    const result = engine.evaluate(policy, {
      resource: makeResource({ tags: { environment: "prod" } }),
    });
    expect(result.denied).toBe(false);
  });

  it("tag_equals matches correct value", () => {
    const policy = makePolicy({
      rules: [{
        id: "r1", description: "prod only", action: "deny", message: "prod denied",
        condition: { type: "tag_equals", tag: "environment", value: "production" },
      }],
    });
    const result = engine.evaluate(policy, {
      resource: makeResource({ tags: { environment: "production" } }),
    });
    expect(result.denied).toBe(true);
  });
});

// ── scanResources ───────────────────────────────────────────────

describe("PolicyEvaluationEngine.scanResources", () => {
  let engine: PolicyEvaluationEngine;

  beforeEach(() => {
    engine = new PolicyEvaluationEngine();
  });

  it("returns violations for failing resources", () => {
    const policies = [makePolicy({
      id: "deny-s3",
      name: "No S3",
      severity: "critical",
      autoAttachPatterns: ["type:aws_s3_bucket"],
      rules: [{
        id: "r1", description: "deny s3", action: "deny", message: "No S3",
        condition: { type: "resource_type", resourceType: "aws_s3_bucket" },
      }],
    })];
    const resources = [
      makeResource({ id: "r1", type: "aws_s3_bucket", name: "bucket-a" }),
      makeResource({ id: "r2", type: "aws_instance", name: "server-1" }),
    ];
    const violations = engine.scanResources(policies, resources);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.resourceId).toBe("r1");
    expect(violations[0]!.severity).toBe("critical");
    expect(violations[0]!.message).toBe("No S3");
  });

  it("returns empty array when no violations", () => {
    const policies = [makePolicy({
      autoAttachPatterns: ["type:aws_rds_instance"],
      rules: [{
        id: "r1", description: "deny rds", action: "deny", message: "No RDS",
        condition: { type: "resource_type", resourceType: "aws_rds_instance" },
      }],
    })];
    const resources = [makeResource({ type: "aws_s3_bucket" })];
    const violations = engine.scanResources(policies, resources);
    expect(violations).toHaveLength(0);
  });

  it("skips disabled policies in scan", () => {
    const policies = [makePolicy({
      enabled: false,
      autoAttachPatterns: ["*"],
      rules: [{
        id: "r1", description: "deny all", action: "deny", message: "denied",
        condition: { type: "provider", provider: "aws" },
      }],
    })];
    const violations = engine.scanResources(policies, [makeResource()]);
    expect(violations).toHaveLength(0);
  });

  it("matches wildcard auto-attach pattern", () => {
    const policies = [makePolicy({
      autoAttachPatterns: ["*"],
      rules: [{
        id: "r1", description: "warn all", action: "warn", message: "heads up",
        condition: { type: "provider", provider: "aws" },
      }],
    })];
    const violations = engine.scanResources(policies, [makeResource()]);
    // warn action triggers a rule result with passed=false
    expect(violations).toHaveLength(1);
    expect(violations[0]!.action).toBe("warn");
  });

  it("matches tag-based auto-attach pattern", () => {
    const policies = [makePolicy({
      autoAttachPatterns: ["tag:environment=production"],
      rules: [{
        id: "r1", description: "deny prod", action: "deny", message: "prod denied",
        condition: { type: "tag_equals", tag: "environment", value: "production" },
      }],
    })];
    const resources = [
      makeResource({ id: "prod-r", tags: { environment: "production" } }),
      makeResource({ id: "dev-r", tags: { environment: "dev" } }),
    ];
    const violations = engine.scanResources(policies, resources);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.resourceId).toBe("prod-r");
  });
});
