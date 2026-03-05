/**
 * Cross-Cloud Migration Engine — Governance Tests
 * (Approval Gate, Policy Checker, Audit Logger, Rollback Manager)
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  requiresApproval,
  requiresPhaseApproval,
  requiresCostApproval,
  createApprovalRequest,
  evaluateRiskLevel,
  DEFAULT_APPROVAL_POLICY,
} from "../src/governance/approval-gate.js";

import {
  evaluatePolicies,
  getBuiltinPolicies,
  createPolicy,
} from "../src/governance/policy-checker.js";

import {
  MigrationAuditLogger,
  getAuditLogger,
  resetAuditLogger,
} from "../src/governance/audit-logger.js";

import {
  RollbackStack,
  generateRollbackPlan,
  executeRollback,
} from "../src/governance/rollback-manager.js";

import type { MigrationStep, MigrationPhase } from "../src/types.js";

// =============================================================================
// Approval Gate
// =============================================================================
describe("governance/approval-gate", () => {
  describe("DEFAULT_APPROVAL_POLICY", () => {
    it("has reasonable defaults", () => {
      expect(Array.isArray(DEFAULT_APPROVAL_POLICY.alwaysRequire)).toBe(true);
      expect(DEFAULT_APPROVAL_POLICY.alwaysRequire.length).toBeGreaterThan(0);
      expect(Array.isArray(DEFAULT_APPROVAL_POLICY.phaseGates)).toBe(true);
      expect(DEFAULT_APPROVAL_POLICY.costThreshold).toBeGreaterThan(0);
    });
  });

  describe("requiresApproval", () => {
    it("returns true for a step type in alwaysRequire", () => {
      const step = { id: "s1", type: "cutover", name: "Cutover", params: {}, dependsOn: [] } as unknown as MigrationStep;
      expect(requiresApproval(step, DEFAULT_APPROVAL_POLICY)).toBe(true);
    });

    it("returns false for a step type NOT in alwaysRequire", () => {
      const step = { id: "s1", type: "snapshot-source", name: "Snap", params: {}, dependsOn: [] } as unknown as MigrationStep;
      expect(requiresApproval(step, DEFAULT_APPROVAL_POLICY)).toBe(false);
    });
  });

  describe("requiresPhaseApproval", () => {
    it("returns true for phases in phaseGates", () => {
      expect(requiresPhaseApproval("executing", DEFAULT_APPROVAL_POLICY)).toBe(true);
      expect(requiresPhaseApproval("cutting-over", DEFAULT_APPROVAL_POLICY)).toBe(true);
    });

    it("returns false for phases NOT in phaseGates", () => {
      expect(requiresPhaseApproval("planning" as MigrationPhase, DEFAULT_APPROVAL_POLICY)).toBe(false);
    });
  });

  describe("requiresCostApproval", () => {
    it("returns true when cost exceeds threshold", () => {
      expect(requiresCostApproval(50000, DEFAULT_APPROVAL_POLICY)).toBe(true);
    });

    it("returns false when cost is under threshold", () => {
      expect(requiresCostApproval(10, DEFAULT_APPROVAL_POLICY)).toBe(false);
    });
  });

  describe("createApprovalRequest", () => {
    it("creates a request with all fields", () => {
      const request = createApprovalRequest({
        jobId: "job-1",
        phase: "executing",
        type: "phase-transition",
        description: "Start migration execution",
        riskLevel: "medium",
        requestedBy: "user-1",
      });

      expect(request).toHaveProperty("id");
      expect(request.jobId).toBe("job-1");
      expect(request.requestedBy).toBe("user-1");
      expect(request).toHaveProperty("requestedAt");
      expect(request.type).toBe("phase-transition");
    });
  });

  describe("evaluateRiskLevel", () => {
    it("returns low for small migrations", () => {
      const risk = evaluateRiskLevel({
        vmCount: 1,
        dataVolumeGB: 10,
        hasDatabase: false,
        isProduction: false,
        estimatedCostUSD: 5,
      });
      expect(risk).toBe("low");
    });

    it("returns high for expensive migrations", () => {
      const risk = evaluateRiskLevel({
        vmCount: 2,
        dataVolumeGB: 5000,
        hasDatabase: false,
        isProduction: false,
        estimatedCostUSD: 50000,
      });
      expect(risk).toBe("high");
    });

    it("returns critical for large production migrations", () => {
      const risk = evaluateRiskLevel({
        vmCount: 50,
        dataVolumeGB: 10000,
        hasDatabase: true,
        isProduction: true,
        estimatedCostUSD: 50000,
      });
      expect(risk).toBe("critical");
    });
  });
});

// =============================================================================
// Policy Checker
// =============================================================================
describe("governance/policy-checker", () => {
  const dummyPlan = { id: "plan-1", steps: [], sourceProvider: "aws", targetProvider: "azure" } as any;

  describe("getBuiltinPolicies", () => {
    it("returns a non-empty array of policies", () => {
      const policies = getBuiltinPolicies();
      expect(policies.length).toBeGreaterThan(0);
    });

    it("each policy has required fields", () => {
      for (const p of getBuiltinPolicies()) {
        expect(p.id).toBeTruthy();
        expect(p.name).toBeTruthy();
        expect(typeof p.evaluate).toBe("function");
      }
    });
  });

  describe("evaluatePolicies", () => {
    it("evaluates all builtin policies without errors", () => {
      const result = evaluatePolicies({
        sourceProvider: "aws",
        targetProvider: "azure",
        plan: dummyPlan,
        vms: [],
        buckets: [],
        estimatedCostUSD: 100,
        tags: { owner: "team-a", environment: "staging" },
      });

      expect(result).toHaveProperty("passed");
      expect(result).toHaveProperty("violations");
      expect(typeof result.passed).toBe("boolean");
      expect(Array.isArray(result.violations)).toBe(true);
    });

    it("flags missing tags", () => {
      const result = evaluatePolicies({
        sourceProvider: "aws",
        targetProvider: "azure",
        plan: dummyPlan,
        vms: [],
        buckets: [],
        estimatedCostUSD: 100,
        tags: {},
      });

      const tagViolation = result.violations.find((v) => v.policyId === "require-tags");
      expect(tagViolation).toBeDefined();
    });

    it("flags excessive cost", () => {
      const costPolicy = createPolicy(
        "test-cost-limit",
        "Cost Limit",
        "Blocks above $100",
        "error",
        (ctx) => ctx.estimatedCostUSD > 100 ? {
          policyId: "test-cost-limit",
          policyName: "Cost Limit",
          severity: "error",
          message: "Too expensive",
        } : null,
      );

      const result = evaluatePolicies(
        {
          sourceProvider: "aws",
          targetProvider: "azure",
          plan: dummyPlan,
          vms: [],
          buckets: [],
          estimatedCostUSD: 500,
          tags: {},
        },
        [costPolicy],
      );

      expect(result.violations.some((v) => v.policyId === "test-cost-limit")).toBe(true);
    });
  });

  describe("createPolicy", () => {
    it("creates a custom policy", () => {
      const policy = createPolicy(
        "custom-1",
        "Custom Policy",
        "A custom test policy",
        "warning",
        () => null,
      );

      expect(policy.id).toBe("custom-1");
      expect(policy.name).toBe("Custom Policy");
    });
  });
});

// =============================================================================
// Audit Logger
// =============================================================================
describe("governance/audit-logger", () => {
  beforeEach(() => {
    resetAuditLogger();
  });

  describe("MigrationAuditLogger", () => {
    it("logs entries with integrity hashes", () => {
      const logger = new MigrationAuditLogger();
      logger.log({
        jobId: "job-1",
        action: "execute",
        actor: "user-1",
        phase: "executing",
        stepId: "step-1",
        details: {},
      });

      const chain = logger.getChain();
      expect(chain.entries.length).toBe(1);
      expect(chain.entries[0].hash).toBeTruthy();
      expect(chain.entries[0].hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("chains entries cryptographically", () => {
      const logger = new MigrationAuditLogger();
      logger.log({
        jobId: "job-1", action: "execute", phase: "executing",
        actor: "a", stepId: "s1", details: {},
      });
      logger.log({
        jobId: "job-1", action: "verify", phase: "verifying",
        actor: "a", stepId: "s2", details: {},
      });

      const chain = logger.getChain();
      expect(chain.entries.length).toBe(2);
      expect(chain.entries[0].hash).not.toBe(chain.entries[1].hash);
      expect(chain.entries[1].previousHash).toBe(chain.entries[0].hash);
    });

    it("verify() detects intact chains", () => {
      const logger = new MigrationAuditLogger();
      logger.log({
        jobId: "j1", action: "plan", phase: "planning",
        actor: "a", stepId: "s1", details: {},
      });
      logger.log({
        jobId: "j1", action: "execute", phase: "executing",
        actor: "a", stepId: "s2", details: {},
      });

      const result = logger.verify();
      expect(result.valid).toBe(true);
    });

    it("getJobEntries filters by jobId", () => {
      const logger = new MigrationAuditLogger();
      logger.log({
        jobId: "job-A", action: "execute", phase: "executing",
        actor: "a", stepId: "s1", details: {},
      });
      logger.log({
        jobId: "job-B", action: "execute", phase: "executing",
        actor: "a", stepId: "s1", details: {},
      });

      expect(logger.getJobEntries("job-A").length).toBe(1);
      expect(logger.getJobEntries("job-B").length).toBe(1);
      expect(logger.getJobEntries("job-C").length).toBe(0);
    });

    it("export() returns JSON string", () => {
      const logger = new MigrationAuditLogger();
      logger.log({
        jobId: "j1", action: "plan", phase: "planning",
        actor: "a", stepId: "s1", details: {},
      });

      const exported = logger.export();
      expect(typeof exported).toBe("string");
      const parsed = JSON.parse(exported);
      expect(parsed).toHaveProperty("entries");
    });
  });

  describe("getAuditLogger / resetAuditLogger", () => {
    it("returns a singleton", () => {
      const a = getAuditLogger();
      const b = getAuditLogger();
      expect(a).toBe(b);
    });

    it("resetAuditLogger clears the singleton", () => {
      const a = getAuditLogger();
      a.log({
        jobId: "j", action: "execute", phase: "executing",
        actor: "a", details: {},
      });
      expect(a.getChain().entries.length).toBe(1);

      resetAuditLogger();
      const b = getAuditLogger();
      expect(b.getChain().entries.length).toBe(0);
    });
  });
});

// =============================================================================
// Rollback Manager
// =============================================================================
describe("governance/rollback-manager", () => {
  describe("RollbackStack", () => {
    it("pushes and pops entries in LIFO order", () => {
      const stack = new RollbackStack();
      stack.push("job-1", { stepId: "s1", stepType: "snapshot-source", outputs: {}, completedAt: new Date().toISOString() });
      stack.push("job-1", { stepId: "s2", stepType: "export-image", outputs: {}, completedAt: new Date().toISOString() });

      expect(stack.depth("job-1")).toBe(2);
      const top = stack.pop("job-1");
      expect(top?.stepId).toBe("s2");
      expect(stack.depth("job-1")).toBe(1);
    });

    it("returns undefined on empty stack", () => {
      const stack = new RollbackStack();
      expect(stack.depth("job-empty")).toBe(0);
      expect(stack.pop("job-empty")).toBeUndefined();
    });

    it("peek returns all entries without removing them", () => {
      const stack = new RollbackStack();
      stack.push("job-1", { stepId: "s1", stepType: "snapshot-source", outputs: {}, completedAt: new Date().toISOString() });
      stack.push("job-1", { stepId: "s2", stepType: "export-image", outputs: {}, completedAt: new Date().toISOString() });

      const entries = stack.peek("job-1");
      expect(entries.length).toBe(2);
      expect(stack.depth("job-1")).toBe(2); // not removed
    });

    it("clear removes all entries for a job", () => {
      const stack = new RollbackStack();
      stack.push("job-1", { stepId: "s1", stepType: "snapshot-source", outputs: {}, completedAt: new Date().toISOString() });
      stack.clear("job-1");
      expect(stack.depth("job-1")).toBe(0);
    });
  });

  describe("generateRollbackPlan", () => {
    it("generates a plan from the rollback stack", () => {
      const stack = new RollbackStack();
      stack.push("job-1", { stepId: "s1", stepType: "snapshot-source", outputs: {}, completedAt: new Date().toISOString() });
      stack.push("job-1", { stepId: "s2", stepType: "export-image", outputs: {}, completedAt: new Date().toISOString() });

      const handlers = new Map<string, any>();
      handlers.set("snapshot-source", { execute: async () => {}, rollback: async () => {} });
      handlers.set("export-image", { execute: async () => {}, rollback: async () => {} });

      const plan = generateRollbackPlan("job-1", stack, handlers);
      expect(plan).toHaveProperty("stepsToRollback");
      expect(plan.jobId).toBe("job-1");
      expect(plan.stepsToRollback.length).toBe(2);
      // Should be in reverse order
      expect(plan.stepsToRollback[0].id).toBe("s2");
      expect(plan.stepsToRollback[1].id).toBe("s1");
    });

    it("returns empty plan for empty stack", () => {
      const stack = new RollbackStack();
      const handlers = new Map<string, any>();
      const plan = generateRollbackPlan("job-1", stack, handlers);
      expect(plan.stepsToRollback.length).toBe(0);
    });

    it("warns for steps without rollback handlers", () => {
      const stack = new RollbackStack();
      stack.push("job-1", { stepId: "s1", stepType: "snapshot-source", outputs: {}, completedAt: new Date().toISOString() });

      const handlers = new Map<string, any>();
      // no handler for snapshot-source
      const plan = generateRollbackPlan("job-1", stack, handlers);
      expect(plan.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("executeRollback", () => {
    it("returns success for empty rollback plan", async () => {
      const stack = new RollbackStack();
      const result = await executeRollback({
        plan: { jobId: "job-1", stepsToRollback: [], estimatedDurationMs: 0, riskLevel: "low", warnings: [] },
        stack,
        resolveHandler: () => undefined,
        log: () => {},
      });
      expect(result.complete).toBe(true);
      expect(result.stepsRolledBack).toBe(0);
    });
  });
});
