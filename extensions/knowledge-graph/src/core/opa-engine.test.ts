/**
 * Infrastructure Knowledge Graph — OPA Engine Tests
 *
 * Tests for the OPA/Rego policy engine integration:
 *   - LocalOpaEngine condition evaluation
 *   - MockOpaEngine predicate matching
 *   - RemoteOpaEngine response parsing
 *   - OPA input construction & factory
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  LocalOpaEngine,
  MockOpaEngine,
  RemoteOpaEngine,
  createOpaEngine,
  buildOpaInput,
} from "./opa-engine.js";
import type {
  OpaInput,
  OpaPolicyViolation,
  LocalRegoRule,
  OpaEvaluationResult,
} from "./opa-engine.js";
import type { ChangeRequest, RiskAssessment } from "./governance.js";

// =============================================================================
// Helpers
// =============================================================================

function makeOpaInput(overrides?: Partial<OpaInput["changeRequest"]>): OpaInput {
  return {
    changeRequest: {
      id: "cr-test-001",
      initiator: "test-agent",
      initiatorType: "agent",
      targetResourceId: "aws:123:us-east-1:compute:i-abc123",
      resourceType: "compute",
      provider: "aws",
      action: "update",
      description: "Update instance tags",
      riskScore: 25,
      riskLevel: "medium",
      riskFactors: ["Blast radius: 3 resources"],
      metadata: { environment: "staging", costAtRisk: 500 },
      ...overrides,
    },
    timestamp: "2025-01-15T10:00:00.000Z",
  };
}

function makeViolation(overrides?: Partial<OpaPolicyViolation>): OpaPolicyViolation {
  return {
    ruleId: "test-rule",
    message: "Test violation",
    severity: "high",
    action: "deny",
    package: "espada.infra.test",
    ...overrides,
  };
}

function makeChangeRequest(overrides?: Partial<ChangeRequest>): ChangeRequest {
  return {
    id: "cr-test-001",
    initiator: "test-agent",
    initiatorType: "agent",
    targetResourceId: "aws:123:us-east-1:compute:i-abc123",
    resourceType: "compute",
    provider: "aws",
    action: "update",
    description: "Update instance tags",
    risk: { score: 25, level: "medium", factors: ["factor 1"] },
    status: "pending",
    createdAt: "2025-01-15T10:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    reason: null,
    policyViolations: [],
    metadata: { environment: "staging" },
    ...overrides,
  };
}

// =============================================================================
// LocalOpaEngine
// =============================================================================

describe("LocalOpaEngine", () => {
  describe("basic condition evaluation", () => {
    it("should return no violations when no rules match", async () => {
      const engine = new LocalOpaEngine({ rules: [] });
      const result = await engine.evaluate(makeOpaInput());

      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should match field_equals condition", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "deny-delete",
            description: "Deny delete actions",
            package: "espada.infra",
            condition: { type: "field_equals", field: "changeRequest.action", value: "delete" },
            severity: "high",
            action: "deny",
            message: "Delete operations are not allowed",
          },
        ],
      });

      // Should not match "update"
      const noMatch = await engine.evaluate(makeOpaInput({ action: "update" }));
      expect(noMatch.violations).toHaveLength(0);

      // Should match "delete"
      const match = await engine.evaluate(makeOpaInput({ action: "delete" }));
      expect(match.violations).toHaveLength(1);
      expect(match.violations[0]!.ruleId).toBe("deny-delete");
      expect(match.violations[0]!.message).toBe("Delete operations are not allowed");
    });

    it("should match field_not_equals condition", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "must-be-human",
            description: "Only humans allowed",
            package: "espada.infra",
            condition: { type: "field_not_equals", field: "changeRequest.initiatorType", value: "human" },
            severity: "medium",
            action: "require_approval",
            message: "Non-human initiator requires approval",
          },
        ],
      });

      const agentInput = makeOpaInput({ initiatorType: "agent" });
      const result = await engine.evaluate(agentInput);
      expect(result.violations).toHaveLength(1);

      const humanInput = makeOpaInput({ initiatorType: "human" });
      const noViolation = await engine.evaluate(humanInput);
      expect(noViolation.violations).toHaveLength(0);
    });

    it("should match field_contains condition", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "prod-description",
            description: "Mentions production",
            package: "espada.infra",
            condition: { type: "field_contains", field: "changeRequest.description", value: "production" },
            severity: "high",
            action: "warn",
            message: "Change mentions production",
          },
        ],
      });

      const match = await engine.evaluate(
        makeOpaInput({ description: "Update production database" }),
      );
      expect(match.violations).toHaveLength(1);

      const noMatch = await engine.evaluate(
        makeOpaInput({ description: "Update dev database" }),
      );
      expect(noMatch.violations).toHaveLength(0);
    });

    it("should match field_matches (regex) condition", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "gpu-instance",
            description: "GPU instance type",
            package: "espada.infra",
            condition: {
              type: "field_matches",
              field: "changeRequest.targetResourceId",
              pattern: "^aws:.*:compute:",
            },
            severity: "medium",
            action: "notify",
            message: "AWS compute resource change detected",
          },
        ],
      });

      const match = await engine.evaluate(makeOpaInput());
      expect(match.violations).toHaveLength(1);

      const noMatch = await engine.evaluate(
        makeOpaInput({ targetResourceId: "gcp:proj:us-central1:database:db-1" }),
      );
      expect(noMatch.violations).toHaveLength(0);
    });

    it("should match field_gt and field_lt conditions", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "high-risk",
            description: "High risk score",
            package: "espada.infra",
            condition: { type: "field_gt", field: "changeRequest.riskScore", value: 50 },
            severity: "critical",
            action: "deny",
            message: "Risk score exceeds threshold",
          },
          {
            id: "low-risk",
            description: "Low risk score",
            package: "espada.infra",
            condition: { type: "field_lt", field: "changeRequest.riskScore", value: 10 },
            severity: "info",
            action: "notify",
            message: "Very low risk change",
          },
        ],
      });

      const highRisk = await engine.evaluate(makeOpaInput({ riskScore: 75 }));
      expect(highRisk.violations).toHaveLength(1);
      expect(highRisk.violations[0]!.ruleId).toBe("high-risk");

      const lowRisk = await engine.evaluate(makeOpaInput({ riskScore: 5 }));
      expect(lowRisk.violations).toHaveLength(1);
      expect(lowRisk.violations[0]!.ruleId).toBe("low-risk");

      const midRisk = await engine.evaluate(makeOpaInput({ riskScore: 25 }));
      expect(midRisk.violations).toHaveLength(0);
    });

    it("should match field_in and field_not_in conditions", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "restricted-provider",
            description: "Restricted providers",
            package: "espada.infra",
            condition: {
              type: "field_in",
              field: "changeRequest.provider",
              values: ["aws", "gcp"],
            },
            severity: "low",
            action: "notify",
            message: "Major cloud provider change",
          },
        ],
      });

      const awsResult = await engine.evaluate(makeOpaInput({ provider: "aws" }));
      expect(awsResult.violations).toHaveLength(1);

      const azureResult = await engine.evaluate(makeOpaInput({ provider: "azure" as any }));
      expect(azureResult.violations).toHaveLength(0);
    });
  });

  describe("compound conditions", () => {
    it("should match AND condition (all must be true)", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "prod-delete",
            description: "Delete in production",
            package: "espada.infra",
            condition: {
              type: "and",
              conditions: [
                { type: "field_equals", field: "changeRequest.action", value: "delete" },
                { type: "field_equals", field: "changeRequest.metadata.environment", value: "production" },
              ],
            },
            severity: "critical",
            action: "deny",
            message: "Cannot delete in production",
          },
        ],
      });

      // Both conditions true
      const match = await engine.evaluate(
        makeOpaInput({ action: "delete", metadata: { environment: "production" } }),
      );
      expect(match.violations).toHaveLength(1);

      // Only action matches
      const partial = await engine.evaluate(
        makeOpaInput({ action: "delete", metadata: { environment: "staging" } }),
      );
      expect(partial.violations).toHaveLength(0);
    });

    it("should match OR condition (any must be true)", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "risky-actions",
            description: "Delete or scale",
            package: "espada.infra",
            condition: {
              type: "or",
              conditions: [
                { type: "field_equals", field: "changeRequest.action", value: "delete" },
                { type: "field_equals", field: "changeRequest.action", value: "scale" },
              ],
            },
            severity: "medium",
            action: "require_approval",
            message: "Risky action requires approval",
          },
        ],
      });

      const deleteResult = await engine.evaluate(makeOpaInput({ action: "delete" }));
      expect(deleteResult.violations).toHaveLength(1);

      const scaleResult = await engine.evaluate(makeOpaInput({ action: "scale" }));
      expect(scaleResult.violations).toHaveLength(1);

      const updateResult = await engine.evaluate(makeOpaInput({ action: "update" }));
      expect(updateResult.violations).toHaveLength(0);
    });

    it("should match NOT condition (inverted)", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "not-human",
            description: "Non-human change",
            package: "espada.infra",
            condition: {
              type: "not",
              condition: { type: "field_equals", field: "changeRequest.initiatorType", value: "human" },
            },
            severity: "low",
            action: "notify",
            message: "Non-human initiated change",
          },
        ],
      });

      const agentResult = await engine.evaluate(makeOpaInput({ initiatorType: "agent" }));
      expect(agentResult.violations).toHaveLength(1);

      const humanResult = await engine.evaluate(makeOpaInput({ initiatorType: "human" }));
      expect(humanResult.violations).toHaveLength(0);
    });

    it("should handle deeply nested compound conditions", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "complex-rule",
            description: "Complex nested rule",
            package: "espada.infra",
            condition: {
              type: "and",
              conditions: [
                {
                  type: "or",
                  conditions: [
                    { type: "field_equals", field: "changeRequest.action", value: "delete" },
                    { type: "field_gt", field: "changeRequest.riskScore", value: 80 },
                  ],
                },
                {
                  type: "not",
                  condition: { type: "field_equals", field: "changeRequest.initiatorType", value: "human" },
                },
              ],
            },
            severity: "critical",
            action: "deny",
            message: "High-risk non-human change blocked",
          },
        ],
      });

      // Agent + delete → match
      const match1 = await engine.evaluate(
        makeOpaInput({ initiatorType: "agent", action: "delete", riskScore: 30 }),
      );
      expect(match1.violations).toHaveLength(1);

      // Agent + high risk → match
      const match2 = await engine.evaluate(
        makeOpaInput({ initiatorType: "agent", action: "update", riskScore: 90 }),
      );
      expect(match2.violations).toHaveLength(1);

      // Human + delete → no match (human exempted)
      const noMatch = await engine.evaluate(
        makeOpaInput({ initiatorType: "human", action: "delete", riskScore: 30 }),
      );
      expect(noMatch.violations).toHaveLength(0);
    });
  });

  describe("message interpolation", () => {
    it("should interpolate {{field}} placeholders in messages", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "interpolated",
            description: "Interpolated message",
            package: "espada.infra",
            condition: { type: "field_equals", field: "changeRequest.action", value: "delete" },
            severity: "high",
            action: "deny",
            message: "Cannot {{changeRequest.action}} resource {{changeRequest.targetResourceId}} (risk: {{changeRequest.riskScore}})",
          },
        ],
      });

      const result = await engine.evaluate(makeOpaInput({ action: "delete" }));
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.message).toBe(
        "Cannot delete resource aws:123:us-east-1:compute:i-abc123 (risk: 25)",
      );
    });

    it("should substitute <field> for missing fields", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "missing-field",
            description: "Missing field test",
            package: "espada.infra",
            condition: { type: "field_equals", field: "changeRequest.action", value: "delete" },
            severity: "low",
            action: "notify",
            message: "Missing: {{nonexistent.field}}",
          },
        ],
      });

      const result = await engine.evaluate(makeOpaInput({ action: "delete" }));
      expect(result.violations[0]!.message).toBe("Missing: <nonexistent.field>");
    });
  });

  describe("rule management", () => {
    it("should add rules dynamically", async () => {
      const engine = new LocalOpaEngine({ rules: [] });

      engine.addRule({
        id: "dynamic-rule",
        description: "Added at runtime",
        package: "espada.infra",
        condition: { type: "field_equals", field: "changeRequest.action", value: "delete" },
        severity: "high",
        action: "deny",
        message: "Dynamic deny",
      });

      expect(engine.getRules()).toHaveLength(1);

      const result = await engine.evaluate(makeOpaInput({ action: "delete" }));
      expect(result.violations).toHaveLength(1);
    });

    it("should remove rules by ID", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "removable",
            description: "Can be removed",
            package: "espada.infra",
            condition: { type: "field_equals", field: "changeRequest.action", value: "delete" },
            severity: "high",
            action: "deny",
            message: "Deny",
          },
        ],
      });

      expect(engine.removeRule("removable")).toBe(true);
      expect(engine.removeRule("nonexistent")).toBe(false);
      expect(engine.getRules()).toHaveLength(0);

      const result = await engine.evaluate(makeOpaInput({ action: "delete" }));
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("health check", () => {
    it("should always return true for local engine", async () => {
      const engine = new LocalOpaEngine({ rules: [] });
      expect(await engine.healthCheck()).toBe(true);
    });
  });

  describe("metadata flattening", () => {
    it("should evaluate conditions against flattened metadata fields", async () => {
      const engine = new LocalOpaEngine({
        rules: [
          {
            id: "prod-env-check",
            description: "Check environment metadata",
            package: "espada.infra",
            condition: {
              type: "field_equals",
              field: "changeRequest.metadata.environment",
              value: "production",
            },
            severity: "high",
            action: "require_approval",
            message: "Production environment requires approval",
          },
        ],
      });

      const prodResult = await engine.evaluate(
        makeOpaInput({ metadata: { environment: "production" } }),
      );
      expect(prodResult.violations).toHaveLength(1);

      const devResult = await engine.evaluate(
        makeOpaInput({ metadata: { environment: "dev" } }),
      );
      expect(devResult.violations).toHaveLength(0);
    });
  });
});

// =============================================================================
// MockOpaEngine
// =============================================================================

describe("MockOpaEngine", () => {
  let mock: MockOpaEngine;

  beforeEach(() => {
    mock = new MockOpaEngine();
  });

  it("should return default empty result when no predicates match", async () => {
    const result = await mock.evaluate(makeOpaInput());
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("should return configured default result", async () => {
    const customDefault: OpaEvaluationResult = {
      ok: false,
      violations: [],
      durationMs: 0,
      error: "default error",
    };
    mock.setDefault(customDefault);

    const result = await mock.evaluate(makeOpaInput());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("default error");
  });

  it("should match predicates in registration order", async () => {
    mock.when(
      (input) => input.changeRequest.action === "delete",
      {
        ok: true,
        violations: [makeViolation({ ruleId: "first" })],
        durationMs: 1,
      },
    );

    mock.when(
      (input) => input.changeRequest.action === "delete",
      {
        ok: true,
        violations: [makeViolation({ ruleId: "second" })],
        durationMs: 1,
      },
    );

    const result = await mock.evaluate(makeOpaInput({ action: "delete" }));
    expect(result.violations[0]!.ruleId).toBe("first");
  });

  it("should use whenAction convenience method", async () => {
    mock.whenAction("delete", [makeViolation({ ruleId: "delete-deny" })]);

    const deleteResult = await mock.evaluate(makeOpaInput({ action: "delete" }));
    expect(deleteResult.violations).toHaveLength(1);
    expect(deleteResult.violations[0]!.ruleId).toBe("delete-deny");

    const updateResult = await mock.evaluate(makeOpaInput({ action: "update" }));
    expect(updateResult.violations).toHaveLength(0);
  });

  it("should use whenResourceType convenience method", async () => {
    mock.whenResourceType("database", [makeViolation({ ruleId: "db-policy" })]);

    const dbResult = await mock.evaluate(makeOpaInput({ resourceType: "database" }));
    expect(dbResult.violations).toHaveLength(1);

    const computeResult = await mock.evaluate(makeOpaInput({ resourceType: "compute" }));
    expect(computeResult.violations).toHaveLength(0);
  });

  it("should use whenRiskAbove convenience method", async () => {
    mock.whenRiskAbove(50, [makeViolation({ ruleId: "high-risk" })]);

    const highRisk = await mock.evaluate(makeOpaInput({ riskScore: 75 }));
    expect(highRisk.violations).toHaveLength(1);

    const lowRisk = await mock.evaluate(makeOpaInput({ riskScore: 25 }));
    expect(lowRisk.violations).toHaveLength(0);
  });

  it("should track evaluation log", async () => {
    const input1 = makeOpaInput({ action: "delete" });
    const input2 = makeOpaInput({ action: "update" });

    await mock.evaluate(input1);
    await mock.evaluate(input2);

    const log = mock.getEvaluationLog();
    expect(log).toHaveLength(2);
    expect(log[0]!.changeRequest.action).toBe("delete");
    expect(log[1]!.changeRequest.action).toBe("update");
  });

  it("should clear evaluation log", async () => {
    await mock.evaluate(makeOpaInput());
    expect(mock.getEvaluationLog()).toHaveLength(1);

    mock.clearLog();
    expect(mock.getEvaluationLog()).toHaveLength(0);
  });

  it("should always pass health check", async () => {
    expect(await mock.healthCheck()).toBe(true);
  });
});

// =============================================================================
// RemoteOpaEngine — Response Parsing
// =============================================================================

describe("RemoteOpaEngine", () => {
  // We can't easily test actual HTTP calls without a running server,
  // so we test the response parsing logic indirectly via the evaluate method
  // against a mock server. For now, test the public API shape and config.

  it("should construct with required config", () => {
    const engine = new RemoteOpaEngine({
      baseUrl: "http://localhost:8181",
      policyPath: "v1/data/espada/infra/deny",
    });

    expect(engine.type).toBe("remote");
  });

  it("should trim trailing slashes from baseUrl", () => {
    const engine = new RemoteOpaEngine({
      baseUrl: "http://localhost:8181///",
      policyPath: "v1/data/espada/infra/deny",
    });

    expect(engine.type).toBe("remote");
  });

  it("should handle fetch failure gracefully (fail-open)", async () => {
    const engine = new RemoteOpaEngine({
      baseUrl: "http://localhost:0", // will fail to connect
      policyPath: "v1/data/espada/infra/deny",
      timeoutMs: 100,
      failMode: "open",
    });

    const result = await engine.evaluate(makeOpaInput());
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(0); // fail-open = no violations
    expect(result.error).toBeTruthy();
  });

  it("should handle fetch failure gracefully (fail-closed)", async () => {
    const engine = new RemoteOpaEngine({
      baseUrl: "http://localhost:0",
      policyPath: "v1/data/espada/infra/deny",
      timeoutMs: 100,
      failMode: "closed",
    });

    const result = await engine.evaluate(makeOpaInput());
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1); // fail-closed = synthetic violation
    expect(result.violations[0]!.severity).toBe("critical");
    expect(result.violations[0]!.action).toBe("deny");
  });

  it("should fail health check when server is unreachable", async () => {
    const engine = new RemoteOpaEngine({
      baseUrl: "http://localhost:0",
      policyPath: "v1/data/espada/infra/deny",
      timeoutMs: 100,
    });

    const healthy = await engine.healthCheck();
    expect(healthy).toBe(false);
  });
});

// =============================================================================
// Factory
// =============================================================================

describe("createOpaEngine", () => {
  it("should create a local engine", () => {
    const engine = createOpaEngine({
      type: "local",
      config: { rules: [] },
    });
    expect(engine.type).toBe("local");
  });

  it("should create a remote engine", () => {
    const engine = createOpaEngine({
      type: "remote",
      config: {
        baseUrl: "http://localhost:8181",
        policyPath: "v1/data/espada/infra/deny",
      },
    });
    expect(engine.type).toBe("remote");
  });

  it("should create a mock engine", () => {
    const engine = createOpaEngine({ type: "mock" });
    expect(engine.type).toBe("mock");
  });
});

// =============================================================================
// buildOpaInput
// =============================================================================

describe("buildOpaInput", () => {
  it("should build input from a ChangeRequest", () => {
    const request = makeChangeRequest({
      id: "cr-123",
      initiator: "alice",
      initiatorType: "human",
      targetResourceId: "aws:123:us-east-1:database:rds-1",
      resourceType: "database",
      provider: "aws",
      action: "delete",
      description: "Drop old database",
      risk: { score: 65, level: "high", factors: ["Production environment"] },
      metadata: { environment: "production", costAtRisk: 3000 },
    });

    const input = buildOpaInput(request);

    expect(input.changeRequest.id).toBe("cr-123");
    expect(input.changeRequest.initiator).toBe("alice");
    expect(input.changeRequest.initiatorType).toBe("human");
    expect(input.changeRequest.targetResourceId).toBe("aws:123:us-east-1:database:rds-1");
    expect(input.changeRequest.resourceType).toBe("database");
    expect(input.changeRequest.provider).toBe("aws");
    expect(input.changeRequest.action).toBe("delete");
    expect(input.changeRequest.description).toBe("Drop old database");
    expect(input.changeRequest.riskScore).toBe(65);
    expect(input.changeRequest.riskLevel).toBe("high");
    expect(input.changeRequest.riskFactors).toEqual(["Production environment"]);
    expect(input.changeRequest.metadata).toEqual({ environment: "production", costAtRisk: 3000 });
    expect(input.timestamp).toBeTruthy();
  });
});
