/**
 * Azure Compliance Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureComplianceManager, createComplianceManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock SDK
// ---------------------------------------------------------------------------

const mockPolicyStates = {
  listQueryResultsForSubscription: vi.fn(),
};

vi.mock("@azure/arm-policyinsights", () => ({
  PolicyInsightsClient: vi.fn().mockImplementation(() => ({
    policyStates: mockPolicyStates,
  })),
}));

const mockCredential = { getToken: vi.fn().mockResolvedValue({ token: "t", expiresOnTimestamp: Date.now() + 3600000 }) };
const mockCredentialsManager = {
  getCredential: vi.fn().mockResolvedValue({ credential: mockCredential, method: "default" }),
  getSubscriptionId: () => "sub-1",
  getTenantId: () => undefined,
  clearCache: vi.fn(),
} as unknown as AzureCredentialsManager;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AzureComplianceManager", () => {
  let mgr: AzureComplianceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureComplianceManager(mockCredentialsManager, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  // -------------------------------------------------------------------------
  // listFrameworks
  // -------------------------------------------------------------------------
  describe("listFrameworks", () => {
    it("returns all built-in frameworks", () => {
      const frameworks = mgr.listFrameworks();
      expect(frameworks.length).toBeGreaterThanOrEqual(6);
      const names = frameworks.map((f) => f.name);
      expect(names).toContain("CIS Azure 1.4");
      expect(names).toContain("NIST 800-53");
      expect(names).toContain("PCI DSS 3.2.1");
      expect(names).toContain("HIPAA");
      expect(names).toContain("ISO 27001");
      expect(names).toContain("SOC 2");
    });

    it("returns a copy, not the internal array", () => {
      const f1 = mgr.listFrameworks();
      const f2 = mgr.listFrameworks();
      expect(f1).not.toBe(f2);
      expect(f1).toEqual(f2);
    });
  });

  // -------------------------------------------------------------------------
  // getComplianceStatus
  // -------------------------------------------------------------------------
  describe("getComplianceStatus", () => {
    it("aggregates compliance status from policy states", async () => {
      mockPolicyStates.listQueryResultsForSubscription.mockReturnValue(asyncIter([
        { complianceState: "Compliant" },
        { complianceState: "Compliant" },
        { complianceState: "NonCompliant" },
      ]));

      const statuses = await mgr.getComplianceStatus();
      expect(statuses.length).toBeGreaterThanOrEqual(6);
      // 2 compliant out of 3 = ~67%
      for (const s of statuses) {
        expect(s.percentage).toBe(67);
        expect(s.framework).toBeTruthy();
        expect(s.totalControls).toBeGreaterThan(0);
        expect(s.lastEvaluated).toBeTruthy();
      }
    });

    it("filters by frameworkId when provided", async () => {
      mockPolicyStates.listQueryResultsForSubscription.mockReturnValue(asyncIter([
        { complianceState: "Compliant" },
      ]));

      const statuses = await mgr.getComplianceStatus("hipaa");
      expect(statuses).toHaveLength(1);
      expect(statuses[0].framework).toBe("HIPAA");
      expect(statuses[0].percentage).toBe(100);
    });

    it("returns 0 percentage when no policy states", async () => {
      mockPolicyStates.listQueryResultsForSubscription.mockReturnValue(asyncIter([]));

      const statuses = await mgr.getComplianceStatus();
      for (const s of statuses) {
        expect(s.percentage).toBe(0);
        expect(s.compliantControls).toBe(0);
        expect(s.nonCompliantControls).toBe(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // listViolations
  // -------------------------------------------------------------------------
  describe("listViolations", () => {
    it("lists non-compliant policy states as violations", async () => {
      mockPolicyStates.listQueryResultsForSubscription.mockReturnValue(asyncIter([
        { complianceState: "NonCompliant", policyAssignmentId: "pa1", resourceId: "r1", resourceType: "VM", resourceGroup: "rg-1", policyDefinitionName: "no-public-ip", timestamp: new Date("2024-01-01") },
        { complianceState: "Compliant", resourceGroup: "rg-1" },
      ]));

      const violations = await mgr.listViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0].id).toBe("pa1");
      expect(violations[0].resourceId).toBe("r1");
      expect(violations[0].control).toBe("no-public-ip");
      expect(violations[0].message).toContain("no-public-ip");
    });

    it("filters by resource group", async () => {
      mockPolicyStates.listQueryResultsForSubscription.mockReturnValue(asyncIter([
        { complianceState: "NonCompliant", resourceGroup: "rg-1", policyAssignmentId: "p1", resourceId: "r1", resourceType: "VM", policyDefinitionName: "rule1" },
        { complianceState: "NonCompliant", resourceGroup: "rg-2", policyAssignmentId: "p2", resourceId: "r2", resourceType: "VM", policyDefinitionName: "rule2" },
      ]));

      const violations = await mgr.listViolations("rg-1");
      expect(violations).toHaveLength(1);
      expect(violations[0].id).toBe("p1");
    });

    it("handles nullish fields gracefully", async () => {
      mockPolicyStates.listQueryResultsForSubscription.mockReturnValue(asyncIter([
        { complianceState: "NonCompliant", policyAssignmentId: null, resourceId: null, resourceType: null, resourceGroup: null, policyDefinitionName: null, timestamp: null },
      ]));

      const violations = await mgr.listViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0].id).toBe("");
      expect(violations[0].resourceGroup).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // generateReport
  // -------------------------------------------------------------------------
  describe("generateReport", () => {
    it("generates a full compliance report", async () => {
      // Stub the instance methods directly to avoid shared-iterator issues
      // with concurrent Promise.all calls through dynamic imports
      const statusResult = [
        { framework: "CIS Azure 1.4", totalControls: 10, compliantControls: 8, nonCompliantControls: 2, percentage: 80, lastEvaluated: new Date().toISOString() },
      ];
      const violationResult = [
        { id: "p1", resourceId: "r1", resourceType: "VM", resourceGroup: "rg-1", framework: "Azure Policy", control: "rule1", severity: "medium" as const, message: "Non-compliant", timestamp: new Date().toISOString() },
      ];
      vi.spyOn(mgr, "getComplianceStatus").mockResolvedValue(statusResult);
      vi.spyOn(mgr, "listViolations").mockResolvedValue(violationResult);

      const report = await mgr.generateReport();
      expect(report.id).toMatch(/^report-/);
      expect(report.subscription).toBe("sub-1");
      expect(report.frameworks).toEqual(statusResult);
      expect(report.violations).toEqual(violationResult);
      expect(report.summary.total).toBe(10);
      expect(report.summary.compliant).toBe(8);
      expect(report.summary.nonCompliant).toBe(2);
      expect(report.summary.percentage).toBe(80);
      expect(report.generatedAt).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------
  describe("createComplianceManager", () => {
    it("creates an AzureComplianceManager instance", () => {
      const instance = createComplianceManager(mockCredentialsManager, "sub-1");
      expect(instance).toBeInstanceOf(AzureComplianceManager);
    });
  });
});
