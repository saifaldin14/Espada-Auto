/**
 * Policy Engine — Tests
 *
 * Covers: engine evaluation, conditions, storage, library, integration bridges, scan
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEvaluationEngine } from "./engine.js";
import { InMemoryPolicyStorage, createPolicyFromInput } from "./storage.js";
import { getLibraryPolicies, getLibraryPolicy, getLibraryCategories, getLibraryByCategory } from "./library.js";
import {
  buildResourcePolicyInput,
  buildPlanPolicyInput,
  buildCostPolicyInput,
  buildDriftPolicyInput,
  buildAccessPolicyInput,
} from "./integration.js";
import type { PolicyDefinition, PolicyEvaluationInput, ResourceInput, RuleCondition } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────

function makePolicy(overrides: Partial<PolicyDefinition> = {}): PolicyDefinition {
  return {
    id: "test-policy",
    name: "Test Policy",
    description: "A test policy",
    type: "plan",
    enabled: true,
    severity: "medium",
    labels: [],
    autoAttachPatterns: [],
    rules: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

// ── Engine Tests ─────────────────────────────────────────────────

describe("PolicyEvaluationEngine", () => {
  let engine: PolicyEvaluationEngine;

  beforeEach(() => {
    engine = new PolicyEvaluationEngine();
  });

  it("allows when no rules match", () => {
    const policy = makePolicy({
      rules: [
        {
          id: "r1",
          description: "never matches",
          condition: { type: "field_equals", field: "resource.type", value: "nonexistent" },
          action: "deny",
          message: "Should not trigger",
        },
      ],
    });
    const result = engine.evaluate(policy, { resource: makeResource() });
    expect(result.allowed).toBe(true);
    expect(result.denied).toBe(false);
    expect(result.denials).toHaveLength(0);
  });

  it("denies when a deny rule matches", () => {
    const policy = makePolicy({
      rules: [
        {
          id: "r1",
          description: "matches bucket type",
          condition: { type: "field_equals", field: "resource.type", value: "aws_s3_bucket" },
          action: "deny",
          message: "S3 buckets are denied",
        },
      ],
    });
    const result = engine.evaluate(policy, { resource: makeResource() });
    expect(result.allowed).toBe(false);
    expect(result.denied).toBe(true);
    expect(result.denials).toContain("S3 buckets are denied");
  });

  it("emits warning for warn action", () => {
    const policy = makePolicy({
      rules: [
        {
          id: "r1",
          description: "warn on bucket",
          condition: { type: "resource_type", resourceType: "aws_s3_bucket" },
          action: "warn",
          message: "Consider using a different storage type",
        },
      ],
    });
    const result = engine.evaluate(policy, { resource: makeResource() });
    expect(result.allowed).toBe(true);
    expect(result.warnings).toContain("Consider using a different storage type");
  });

  it("sets approvalRequired for require_approval action", () => {
    const policy = makePolicy({
      rules: [
        {
          id: "r1",
          description: "require approval",
          condition: { type: "provider", provider: "aws" },
          action: "require_approval",
          message: "AWS changes need approval",
        },
      ],
    });
    const result = engine.evaluate(policy, { resource: makeResource() });
    expect(result.approvalRequired).toBe(true);
  });

  it("emits notification for notify action", () => {
    const policy = makePolicy({
      rules: [
        {
          id: "r1",
          description: "notify",
          condition: { type: "region", region: "us-east-1" },
          action: "notify",
          message: "Resource created in us-east-1",
        },
      ],
    });
    const result = engine.evaluate(policy, { resource: makeResource() });
    expect(result.notifications).toContain("Resource created in us-east-1");
  });

  it("skips disabled policies", () => {
    const policy = makePolicy({
      enabled: false,
      rules: [
        {
          id: "r1",
          description: "deny all",
          condition: { type: "field_equals", field: "resource.type", value: "aws_s3_bucket" },
          action: "deny",
          message: "Denied",
        },
      ],
    });
    const result = engine.evaluate(policy, { resource: makeResource() });
    expect(result.allowed).toBe(true);
    expect(result.evaluatedRules).toHaveLength(0);
  });

  it("records durationMs", () => {
    const policy = makePolicy();
    const result = engine.evaluate(policy, { resource: makeResource() });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ── Condition Types ──────────────────────────────────────────────

describe("Rule Conditions", () => {
  let engine: PolicyEvaluationEngine;

  beforeEach(() => {
    engine = new PolicyEvaluationEngine();
  });

  function evalCondition(condition: RuleCondition, resource?: Partial<ResourceInput>, extra?: Partial<PolicyEvaluationInput>) {
    const policy = makePolicy({
      rules: [{ id: "test", description: "test", condition, action: "deny", message: "triggered" }],
    });
    const input: PolicyEvaluationInput = {
      resource: makeResource(resource),
      ...extra,
    };
    return engine.evaluate(policy, input);
  }

  it("field_equals matches", () => {
    const result = evalCondition({ type: "field_equals", field: "resource.provider", value: "aws" });
    expect(result.denied).toBe(true);
  });

  it("field_not_equals matches", () => {
    const result = evalCondition({ type: "field_not_equals", field: "resource.provider", value: "gcp" });
    expect(result.denied).toBe(true);
  });

  it("field_contains matches string", () => {
    const result = evalCondition({ type: "field_contains", field: "resource.name", value: "bucket" });
    expect(result.denied).toBe(true);
  });

  it("field_matches matches regex", () => {
    const result = evalCondition({ type: "field_matches", field: "resource.name", pattern: "^my-" });
    expect(result.denied).toBe(true);
  });

  it("field_gt matches", () => {
    const result = evalCondition({ type: "field_gt", field: "cost.delta", value: 50 }, undefined, {
      cost: { current: 100, projected: 200, delta: 100, currency: "USD" },
    });
    expect(result.denied).toBe(true);
  });

  it("field_lt matches", () => {
    const result = evalCondition({ type: "field_lt", field: "cost.delta", value: 200 }, undefined, {
      cost: { current: 100, projected: 200, delta: 100, currency: "USD" },
    });
    expect(result.denied).toBe(true);
  });

  it("field_exists matches", () => {
    const result = evalCondition({ type: "field_exists", field: "resource.region" });
    expect(result.denied).toBe(true);
  });

  it("field_not_exists matches", () => {
    const result = evalCondition({ type: "field_not_exists", field: "resource.metadata.nonexistent" });
    expect(result.denied).toBe(true);
  });

  it("field_in matches", () => {
    const result = evalCondition({ type: "field_in", field: "resource.provider", values: ["aws", "gcp"] });
    expect(result.denied).toBe(true);
  });

  it("field_not_in matches", () => {
    const result = evalCondition({ type: "field_not_in", field: "resource.provider", values: ["gcp", "azure"] });
    expect(result.denied).toBe(true);
  });

  it("tag_missing matches", () => {
    const result = evalCondition({ type: "tag_missing", tag: "environment" }, { tags: {} });
    expect(result.denied).toBe(true);
  });

  it("tag_missing does not match when tag exists", () => {
    const result = evalCondition({ type: "tag_missing", tag: "environment" }, { tags: { environment: "prod" } });
    expect(result.denied).toBe(false);
  });

  it("tag_equals matches", () => {
    const result = evalCondition({ type: "tag_equals", tag: "environment", value: "production" }, { tags: { environment: "production" } });
    expect(result.denied).toBe(true);
  });

  it("and requires all conditions", () => {
    const result = evalCondition({
      type: "and",
      conditions: [
        { type: "provider", provider: "aws" },
        { type: "resource_type", resourceType: "aws_s3_bucket" },
      ],
    });
    expect(result.denied).toBe(true);
  });

  it("and fails if one condition fails", () => {
    const result = evalCondition({
      type: "and",
      conditions: [
        { type: "provider", provider: "aws" },
        { type: "resource_type", resourceType: "aws_ec2_instance" },
      ],
    });
    expect(result.denied).toBe(false);
  });

  it("or matches if any condition matches", () => {
    const result = evalCondition({
      type: "or",
      conditions: [
        { type: "provider", provider: "gcp" },
        { type: "resource_type", resourceType: "aws_s3_bucket" },
      ],
    });
    expect(result.denied).toBe(true);
  });

  it("not inverts condition", () => {
    const result = evalCondition({
      type: "not",
      condition: { type: "provider", provider: "gcp" },
    });
    expect(result.denied).toBe(true);
  });

  it("resource_type matches", () => {
    const result = evalCondition({ type: "resource_type", resourceType: "aws_s3_bucket" });
    expect(result.denied).toBe(true);
  });

  it("provider matches", () => {
    const result = evalCondition({ type: "provider", provider: "aws" });
    expect(result.denied).toBe(true);
  });

  it("region matches", () => {
    const result = evalCondition({ type: "region", region: "us-east-1" });
    expect(result.denied).toBe(true);
  });

  it("custom always passes", () => {
    const result = evalCondition({ type: "custom", evaluator: "my-custom", args: {} });
    // Custom evaluator with no handler defaults to true (pass), so the deny rule triggers
    expect(result.denied).toBe(true);
  });
});

// ── evaluateAll ──────────────────────────────────────────────────

describe("evaluateAll", () => {
  let engine: PolicyEvaluationEngine;

  beforeEach(() => {
    engine = new PolicyEvaluationEngine();
  });

  it("aggregates results across policies", () => {
    const p1 = makePolicy({
      id: "p1",
      rules: [
        {
          id: "r1",
          description: "warn",
          condition: { type: "provider", provider: "aws" },
          action: "warn",
          message: "AWS warning",
        },
      ],
    });
    const p2 = makePolicy({
      id: "p2",
      rules: [
        {
          id: "r2",
          description: "deny",
          condition: { type: "provider", provider: "aws" },
          action: "deny",
          message: "AWS denied",
        },
      ],
    });

    const result = engine.evaluateAll([p1, p2], { resource: makeResource() });
    expect(result.denied).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.warnings).toContain("AWS warning");
    expect(result.denials).toContain("AWS denied");
    expect(result.totalPolicies).toBe(2);
    expect(result.passedPolicies).toBe(1);
    expect(result.failedPolicies).toBe(1);
  });

  it("allows when all policies pass", () => {
    const p1 = makePolicy({ id: "p1", rules: [] });
    const p2 = makePolicy({ id: "p2", rules: [] });
    const result = engine.evaluateAll([p1, p2], { resource: makeResource() });
    expect(result.allowed).toBe(true);
    expect(result.passedPolicies).toBe(2);
  });
});

// ── scanResources ────────────────────────────────────────────────

describe("scanResources", () => {
  let engine: PolicyEvaluationEngine;

  beforeEach(() => {
    engine = new PolicyEvaluationEngine();
  });

  it("detects violations across resources", () => {
    const policy = makePolicy({
      autoAttachPatterns: ["*"],
      rules: [
        {
          id: "r1",
          description: "require env tag",
          condition: { type: "tag_missing", tag: "environment" },
          action: "deny",
          message: "Missing environment tag",
        },
      ],
    });

    const resources = [makeResource({ id: "r1", tags: {} }), makeResource({ id: "r2", tags: { environment: "prod" } })];

    const violations = engine.scanResources([policy], resources);
    expect(violations).toHaveLength(1);
    expect(violations[0].resourceId).toBe("r1");
    expect(violations[0].message).toBe("Missing environment tag");
  });

  it("respects autoAttachPatterns", () => {
    const policy = makePolicy({
      autoAttachPatterns: ["provider:gcp"],
      rules: [
        {
          id: "r1",
          description: "deny all",
          condition: { type: "field_exists", field: "resource.id" },
          action: "deny",
          message: "Denied",
        },
      ],
    });

    const resources = [makeResource({ id: "r1", provider: "aws" }), makeResource({ id: "r2", provider: "gcp" })];

    const violations = engine.scanResources([policy], resources);
    expect(violations).toHaveLength(1);
    expect(violations[0].resourceId).toBe("r2");
  });

  it("auto-attaches by type", () => {
    const policy = makePolicy({
      autoAttachPatterns: ["type:aws_s3_bucket"],
      rules: [
        {
          id: "r1",
          description: "deny",
          condition: { type: "field_exists", field: "resource.id" },
          action: "deny",
          message: "Denied",
        },
      ],
    });

    const resources = [makeResource({ type: "aws_s3_bucket" }), makeResource({ id: "r2", type: "aws_ec2_instance" })];

    const violations = engine.scanResources([policy], resources);
    expect(violations).toHaveLength(1);
  });

  it("auto-attaches by tag", () => {
    const policy = makePolicy({
      autoAttachPatterns: ["tag:environment=production"],
      rules: [
        {
          id: "r1",
          description: "deny",
          condition: { type: "field_exists", field: "resource.id" },
          action: "deny",
          message: "Denied",
        },
      ],
    });

    const resources = [
      makeResource({ tags: { environment: "production" } }),
      makeResource({ id: "r2", tags: { environment: "staging" } }),
    ];

    const violations = engine.scanResources([policy], resources);
    expect(violations).toHaveLength(1);
  });

  it("skips disabled policies", () => {
    const policy = makePolicy({
      enabled: false,
      autoAttachPatterns: ["*"],
      rules: [
        {
          id: "r1",
          description: "deny all",
          condition: { type: "field_exists", field: "resource.id" },
          action: "deny",
          message: "Denied",
        },
      ],
    });

    const violations = engine.scanResources([policy], [makeResource()]);
    expect(violations).toHaveLength(0);
  });
});

// ── Storage ──────────────────────────────────────────────────────

describe("InMemoryPolicyStorage", () => {
  let storage: InMemoryPolicyStorage;

  beforeEach(async () => {
    storage = new InMemoryPolicyStorage();
    await storage.initialize();
  });

  it("saves and retrieves a policy", async () => {
    const p = createPolicyFromInput({ name: "test", type: "plan", rules: [] });
    await storage.save(p);
    const retrieved = await storage.getById(p.id);
    expect(retrieved?.name).toBe("test");
  });

  it("lists policies", async () => {
    await storage.save(createPolicyFromInput({ name: "p1", type: "plan", rules: [] }));
    await storage.save(createPolicyFromInput({ name: "p2", type: "cost", severity: "high", rules: [] }));
    const all = await storage.list();
    expect(all).toHaveLength(2);
  });

  it("filters by type", async () => {
    await storage.save(createPolicyFromInput({ name: "p1", type: "plan", rules: [] }));
    await storage.save(createPolicyFromInput({ name: "p2", type: "cost", rules: [] }));
    const plans = await storage.list({ type: "plan" });
    expect(plans).toHaveLength(1);
    expect(plans[0].type).toBe("plan");
  });

  it("filters by enabled", async () => {
    await storage.save(createPolicyFromInput({ name: "p1", type: "plan", enabled: true, rules: [] }));
    await storage.save(createPolicyFromInput({ name: "p2", type: "plan", enabled: false, rules: [] }));
    const enabled = await storage.list({ enabled: true });
    expect(enabled).toHaveLength(1);
  });

  it("filters by severity", async () => {
    await storage.save(createPolicyFromInput({ name: "p1", type: "plan", severity: "critical", rules: [] }));
    await storage.save(createPolicyFromInput({ name: "p2", type: "plan", severity: "low", rules: [] }));
    const critical = await storage.list({ severity: "critical" });
    expect(critical).toHaveLength(1);
  });

  it("deletes a policy", async () => {
    const p = createPolicyFromInput({ name: "test", type: "plan", rules: [] });
    await storage.save(p);
    const deleted = await storage.delete(p.id);
    expect(deleted).toBe(true);
    expect(await storage.getById(p.id)).toBeNull();
  });

  it("returns false for deleting non-existent policy", async () => {
    const deleted = await storage.delete("nonexistent");
    expect(deleted).toBe(false);
  });

  it("returns null for non-existent policy", async () => {
    const p = await storage.getById("nonexistent");
    expect(p).toBeNull();
  });
});

// ── createPolicyFromInput ────────────────────────────────────────

describe("createPolicyFromInput", () => {
  it("generates id if not provided", () => {
    const p = createPolicyFromInput({ name: "test", type: "plan", rules: [] });
    expect(p.id).toBeTruthy();
    expect(p.id.startsWith("policy-")).toBe(true);
  });

  it("uses provided id", () => {
    const p = createPolicyFromInput({ id: "custom-id", name: "test", type: "plan", rules: [] });
    expect(p.id).toBe("custom-id");
  });

  it("defaults enabled to true", () => {
    const p = createPolicyFromInput({ name: "test", type: "plan", rules: [] });
    expect(p.enabled).toBe(true);
  });

  it("defaults severity to medium", () => {
    const p = createPolicyFromInput({ name: "test", type: "plan", rules: [] });
    expect(p.severity).toBe("medium");
  });

  it("sets timestamps", () => {
    const p = createPolicyFromInput({ name: "test", type: "plan", rules: [] });
    expect(p.createdAt).toBeTruthy();
    expect(p.updatedAt).toBeTruthy();
  });
});

// ── Library ──────────────────────────────────────────────────────

describe("Policy Library", () => {
  it("has built-in templates", () => {
    const templates = getLibraryPolicies();
    expect(templates.length).toBeGreaterThan(5);
  });

  it("has categories", () => {
    const categories = getLibraryCategories();
    expect(categories).toContain("security");
    expect(categories).toContain("governance");
    expect(categories).toContain("cost");
    expect(categories).toContain("operations");
  });

  it("gets a specific template", () => {
    const t = getLibraryPolicy("deny-public-s3");
    expect(t).toBeDefined();
    expect(t!.name).toBe("Deny Public S3 Buckets");
  });

  it("filters by category", () => {
    const security = getLibraryByCategory("security");
    expect(security.length).toBeGreaterThan(0);
    expect(security.every((t) => t.category === "security")).toBe(true);
  });

  it("library templates create valid policies", () => {
    for (const template of getLibraryPolicies()) {
      const p = createPolicyFromInput(template.template);
      expect(p.name).toBeTruthy();
      expect(p.rules.length).toBeGreaterThan(0);
    }
  });

  it("library policies can be evaluated", () => {
    const engine = new PolicyEvaluationEngine();
    const template = getLibraryPolicy("require-tags")!;
    const policy = createPolicyFromInput(template.template);
    const result = engine.evaluate(policy, { resource: makeResource({ tags: {} }) });
    expect(result.denied).toBe(true);
    expect(result.denials.length).toBeGreaterThan(0);
  });
});

// ── Integration Bridges ──────────────────────────────────────────

describe("Integration Bridges", () => {
  it("buildResourcePolicyInput creates valid input", () => {
    const input = buildResourcePolicyInput({
      id: "r1",
      type: "aws_s3_bucket",
      provider: "aws",
      tags: { env: "prod" },
    });
    expect(input.resource).toBeDefined();
    expect(input.resource!.id).toBe("r1");
    expect(input.resource!.tags.env).toBe("prod");
  });

  it("buildPlanPolicyInput creates valid input", () => {
    const input = buildPlanPolicyInput({ creates: 5, updates: 3, deletes: 1 });
    expect(input.plan).toBeDefined();
    expect(input.plan!.totalCreates).toBe(5);
  });

  it("buildCostPolicyInput computes delta", () => {
    const input = buildCostPolicyInput({ current: 100, projected: 250 });
    expect(input.cost).toBeDefined();
    expect(input.cost!.delta).toBe(150);
  });

  it("buildDriftPolicyInput adds drift metadata", () => {
    const input = buildDriftPolicyInput({
      resource: makeResource(),
      driftedFields: ["instance_type", "tags"],
    });
    expect(input.resource!.metadata.drifted).toBe(true);
    expect(input.resource!.metadata.driftFieldCount).toBe(2);
  });

  it("buildAccessPolicyInput adds operation to metadata", () => {
    const input = buildAccessPolicyInput({
      actor: { id: "user-1", roles: ["admin"], groups: [] },
      targetResource: makeResource(),
      operation: "delete",
    });
    expect(input.resource!.metadata.requestedOperation).toBe("delete");
    expect(input.actor!.id).toBe("user-1");
  });
});

// ── Nested field access ──────────────────────────────────────────

describe("Nested field access", () => {
  let engine: PolicyEvaluationEngine;

  beforeEach(() => {
    engine = new PolicyEvaluationEngine();
  });

  it("accesses flattened tag values", () => {
    const policy = makePolicy({
      rules: [
        {
          id: "r1",
          description: "check tag value",
          condition: { type: "field_equals", field: "resource.tags.environment", value: "production" },
          action: "deny",
          message: "Production!",
        },
      ],
    });

    const result = engine.evaluate(policy, {
      resource: makeResource({ tags: { environment: "production" } }),
    });
    expect(result.denied).toBe(true);
  });

  it("accesses nested metadata", () => {
    const policy = makePolicy({
      rules: [
        {
          id: "r1",
          description: "check metadata",
          condition: { type: "field_equals", field: "resource.metadata.encrypted", value: false },
          action: "deny",
          message: "Must encrypt!",
        },
      ],
    });

    const result = engine.evaluate(policy, {
      resource: makeResource({ metadata: { encrypted: false } }),
    });
    expect(result.denied).toBe(true);
  });
});
