/**
 * Azure Policy Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzurePolicyManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockPolicyDefinitions = { list: vi.fn() };
const mockPolicyAssignments = {
  list: vi.fn(),
  listForResource: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
};

const mockPolicyStates = {
  listQueryResultsForSubscription: vi.fn(),
};

vi.mock("@azure/arm-policy", () => ({
  PolicyClient: vi.fn().mockImplementation(function() { return {
    policyDefinitions: mockPolicyDefinitions,
    policyAssignments: mockPolicyAssignments,
  }; }),
}));

vi.mock("@azure/arm-policyinsights", () => ({
  PolicyInsightsClient: vi.fn().mockImplementation(function() { return {
    policyStates: mockPolicyStates,
  }; }),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzurePolicyManager", () => {
  let mgr: AzurePolicyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzurePolicyManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("listDefinitions", () => {
    it("lists policy definitions", async () => {
      mockPolicyDefinitions.list.mockReturnValue(asyncIter([
        { id: "pd-1", name: "allowed-locations", properties: { displayName: "Allowed locations", description: "Restrict locations", policyType: "BuiltIn", mode: "Indexed" } },
      ]));
      const defs = await mgr.listDefinitions();
      expect(defs).toHaveLength(1);
    });
  });

  describe("listAssignments", () => {
    it("lists all assignments when no scope given", async () => {
      mockPolicyAssignments.list.mockReturnValue(asyncIter([
        { id: "pa-1", name: "assign-1", properties: { displayName: "Enforce tagging", policyDefinitionId: "pd-1", scope: "/subscriptions/sub-1" } },
      ]));
      const assignments = await mgr.listAssignments();
      expect(assignments).toHaveLength(1);
    });
  });

  describe("createAssignment", () => {
    it("creates a policy assignment", async () => {
      mockPolicyAssignments.create.mockResolvedValue({
        id: "pa-new", name: "tag-policy",
        properties: { displayName: "Enforce tags", policyDefinitionId: "pd-1", scope: "/subscriptions/sub-1" },
      });
      const result = await mgr.createAssignment("tag-policy", {
        policyDefinitionId: "pd-1",
        scope: "/subscriptions/sub-1",
        displayName: "Enforce tags",
      });
      expect(result.name).toBe("tag-policy");
    });
  });

  describe("deleteAssignment", () => {
    it("deletes a policy assignment", async () => {
      mockPolicyAssignments.delete.mockResolvedValue(undefined);
      await expect(mgr.deleteAssignment("/subscriptions/sub-1", "old-policy")).resolves.toBeUndefined();
    });
  });

  describe("getComplianceState", () => {
    it("returns compliance states", async () => {
      mockPolicyStates.listQueryResultsForSubscription.mockReturnValue(asyncIter([
        { policyAssignmentId: "pa-1", complianceState: "NonCompliant", resourceId: "res-1", policyDefinitionId: "pd-1", timestamp: new Date() },
      ]));
      const states = await mgr.getComplianceState();
      expect(states).toHaveLength(1);
    });
  });
});
