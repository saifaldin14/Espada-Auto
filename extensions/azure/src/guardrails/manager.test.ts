/**
 * Azure Guardrails Manager — Unit Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AzureGuardrailsManager, createGuardrailsManager } from "./manager.js";
import type { GuardrailRule, OperationContext, ResourceProtection } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<GuardrailRule> = {}): GuardrailRule {
  return {
    id: "rule-1",
    name: "Test Rule",
    description: "A test guardrail rule",
    severity: "high",
    enabled: true,
    environments: [],
    ...overrides,
  };
}

function makeContext(overrides: Partial<OperationContext> = {}): OperationContext {
  return {
    action: "delete",
    resourceType: "Microsoft.Compute/virtualMachines",
    resourceGroup: "rg-prod",
    environment: "production",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AzureGuardrailsManager", () => {
  let mgr: AzureGuardrailsManager;

  beforeEach(() => {
    mgr = new AzureGuardrailsManager();
  });

  // -------------------------------------------------------------------------
  // addRule / getAllRules / getActiveRules
  // -------------------------------------------------------------------------
  describe("rule management", () => {
    it("adds and retrieves rules", () => {
      mgr.addRule(makeRule({ id: "r1" }));
      mgr.addRule(makeRule({ id: "r2" }));

      expect(mgr.getAllRules()).toHaveLength(2);
    });

    it("getActiveRules returns only enabled rules", () => {
      mgr.addRule(makeRule({ id: "r1", enabled: true }));
      mgr.addRule(makeRule({ id: "r2", enabled: false }));

      const active = mgr.getActiveRules();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe("r1");
    });

    it("removeRule removes an existing rule", () => {
      mgr.addRule(makeRule({ id: "r1" }));
      const removed = mgr.removeRule("r1");
      expect(removed).toBe(true);
      expect(mgr.getAllRules()).toHaveLength(0);
    });

    it("removeRule returns false for non-existing rule", () => {
      const removed = mgr.removeRule("nonexistent");
      expect(removed).toBe(false);
    });

    it("overwrites rule with same id", () => {
      mgr.addRule(makeRule({ id: "r1", name: "First" }));
      mgr.addRule(makeRule({ id: "r1", name: "Updated" }));

      expect(mgr.getAllRules()).toHaveLength(1);
      expect(mgr.getAllRules()[0].name).toBe("Updated");
    });
  });

  // -------------------------------------------------------------------------
  // validateOperation — blocked actions
  // -------------------------------------------------------------------------
  describe("validateOperation — blocked actions", () => {
    it("detects blocked action", () => {
      mgr.addRule(makeRule({ blockedActions: ["delete"] }));

      const violations = mgr.validateOperation(makeContext({ action: "delete" }));
      expect(violations).toHaveLength(1);
      expect(violations[0].blocked).toBe(true);
      expect(violations[0].message).toContain("blocked");
    });

    it("allows non-blocked action", () => {
      mgr.addRule(makeRule({ blockedActions: ["delete"] }));

      const violations = mgr.validateOperation(makeContext({ action: "create" }));
      expect(violations).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // validateOperation — environment filtering
  // -------------------------------------------------------------------------
  describe("validateOperation — environment filtering", () => {
    it("skips rule when environment does not match", () => {
      mgr.addRule(makeRule({ environments: ["staging"], blockedActions: ["delete"] }));

      const violations = mgr.validateOperation(makeContext({ environment: "production" }));
      expect(violations).toHaveLength(0);
    });

    it("applies rule when environment matches", () => {
      mgr.addRule(makeRule({ environments: ["production"], blockedActions: ["delete"] }));

      const violations = mgr.validateOperation(makeContext({ environment: "production" }));
      expect(violations).toHaveLength(1);
    });

    it("applies rule when environments list is empty (matches all)", () => {
      mgr.addRule(makeRule({ environments: [], blockedActions: ["delete"] }));

      const violations = mgr.validateOperation(makeContext({ environment: "production" }));
      expect(violations).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // validateOperation — protected resource types
  // -------------------------------------------------------------------------
  describe("validateOperation — protected resource types", () => {
    it("detects protected resource type", () => {
      mgr.addRule(makeRule({
        protectedResourceTypes: ["Microsoft.Compute/virtualMachines"],
        requireApproval: true,
      }));

      const violations = mgr.validateOperation(makeContext({ resourceType: "Microsoft.Compute/virtualMachines" }));
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("protected");
      expect(violations[0].blocked).toBe(true);
    });

    it("does not flag unprotected resource type", () => {
      mgr.addRule(makeRule({
        protectedResourceTypes: ["Microsoft.Compute/virtualMachines"],
      }));

      const violations = mgr.validateOperation(makeContext({ resourceType: "Microsoft.Storage/storageAccounts" }));
      expect(violations).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // validateOperation — protected resource groups
  // -------------------------------------------------------------------------
  describe("validateOperation — protected resource groups", () => {
    it("detects protected resource group", () => {
      mgr.addRule(makeRule({ protectedResourceGroups: ["rg-prod"] }));

      const violations = mgr.validateOperation(makeContext({ resourceGroup: "rg-prod" }));
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("rg-prod");
    });

    it("does not flag unprotected resource group", () => {
      mgr.addRule(makeRule({ protectedResourceGroups: ["rg-prod"] }));

      const violations = mgr.validateOperation(makeContext({ resourceGroup: "rg-dev" }));
      expect(violations).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // validateOperation — protected tags
  // -------------------------------------------------------------------------
  describe("validateOperation — protected tags", () => {
    it("detects matching protected tag", () => {
      mgr.addRule(makeRule({ protectedTags: { env: "production" } }));

      const violations = mgr.validateOperation(makeContext({ tags: { env: "production" } }));
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("env=production");
    });

    it("ignores non-matching tags", () => {
      mgr.addRule(makeRule({ protectedTags: { env: "production" } }));

      const violations = mgr.validateOperation(makeContext({ tags: { env: "staging" } }));
      expect(violations).toHaveLength(0);
    });

    it("no violation when context has no tags", () => {
      mgr.addRule(makeRule({ protectedTags: { env: "production" } }));

      const violations = mgr.validateOperation(makeContext());
      expect(violations).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // validateOperation — schedule (activeHours)
  // -------------------------------------------------------------------------
  describe("validateOperation — schedule", () => {
    it("blocks during active hours", () => {
      const currentHour = new Date().getUTCHours();
      mgr.addRule(makeRule({
        schedule: { activeHours: { start: String(currentHour), end: String(currentHour + 1) } },
      }));

      const violations = mgr.validateOperation(makeContext());
      expect(violations).toHaveLength(1);
      expect(violations[0].blocked).toBe(true);
      expect(violations[0].message).toContain("active hours");
    });

    it("does not block outside active hours", () => {
      const currentHour = new Date().getUTCHours();
      const outsideStart = (currentHour + 2) % 24;
      const outsideEnd = (currentHour + 3) % 24;
      mgr.addRule(makeRule({
        schedule: { activeHours: { start: String(outsideStart), end: String(outsideEnd) } },
      }));

      const violations = mgr.validateOperation(makeContext());
      expect(violations).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // validateOperation — disabled rules
  // -------------------------------------------------------------------------
  describe("validateOperation — disabled rules", () => {
    it("ignores disabled rules", () => {
      mgr.addRule(makeRule({ enabled: false, blockedActions: ["delete"] }));

      const violations = mgr.validateOperation(makeContext({ action: "delete" }));
      expect(violations).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Protection management
  // -------------------------------------------------------------------------
  describe("resource protections", () => {
    const protection: ResourceProtection = {
      resourceId: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm1",
      resourceType: "Microsoft.Compute/virtualMachines",
      resourceGroup: "rg-prod",
      protectionLevel: "full",
      protectedBy: ["admin"],
    };

    it("sets and retrieves a protection", () => {
      mgr.setProtection(protection);
      const result = mgr.checkProtection(protection.resourceId);
      expect(result).toEqual(protection);
    });

    it("returns undefined for non-protected resource", () => {
      const result = mgr.checkProtection("/some/other/resource");
      expect(result).toBeUndefined();
    });

    it("lists all protections", () => {
      mgr.setProtection(protection);
      mgr.setProtection({ ...protection, resourceId: "/other", protectionLevel: "delete-only" });

      const list = mgr.listProtections();
      expect(list).toHaveLength(2);
    });

    it("removes a protection", () => {
      mgr.setProtection(protection);
      const removed = mgr.removeProtection(protection.resourceId);
      expect(removed).toBe(true);
      expect(mgr.checkProtection(protection.resourceId)).toBeUndefined();
    });

    it("removeProtection returns false for non-existing", () => {
      const removed = mgr.removeProtection("/nonexistent");
      expect(removed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isOperationAllowed
  // -------------------------------------------------------------------------
  describe("isOperationAllowed", () => {
    it("returns true when no violations block", () => {
      mgr.addRule(makeRule({
        protectedResourceTypes: ["Microsoft.Compute/virtualMachines"],
        requireApproval: false,
      }));

      const allowed = mgr.isOperationAllowed(makeContext());
      expect(allowed).toBe(true);
    });

    it("returns false when a violation blocks", () => {
      mgr.addRule(makeRule({ blockedActions: ["delete"] }));

      const allowed = mgr.isOperationAllowed(makeContext({ action: "delete" }));
      expect(allowed).toBe(false);
    });

    it("returns true when no rules exist", () => {
      const allowed = mgr.isOperationAllowed(makeContext());
      expect(allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------
  describe("createGuardrailsManager", () => {
    it("creates an AzureGuardrailsManager instance", () => {
      const instance = createGuardrailsManager();
      expect(instance).toBeInstanceOf(AzureGuardrailsManager);
    });
  });
});
