/**
 * Azure Security Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureSecurityManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockSecureScores = { list: vi.fn() };
const mockAssessments = { list: vi.fn() };
const mockAlerts = {
  list: vi.fn(),
  listByResourceGroup: vi.fn(),
};

vi.mock("@azure/arm-security", () => ({
  SecurityCenter: vi.fn().mockImplementation(() => ({
    secureScores: mockSecureScores,
    assessments: mockAssessments,
    alerts: mockAlerts,
  })),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureSecurityManager", () => {
  let mgr: AzureSecurityManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureSecurityManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("getSecureScores", () => {
    it("returns secure scores", async () => {
      mockSecureScores.list.mockReturnValue(asyncIter([
        { id: "ss-1", name: "ascScore", properties: { score: { current: 72, max: 100, percentage: 0.72 }, displayName: "Secure score", weight: 100 } },
      ]));
      const scores = await mgr.getSecureScores();
      expect(scores).toHaveLength(1);
    });

    it("returns empty when no scores", async () => {
      mockSecureScores.list.mockReturnValue(asyncIter([]));
      expect(await mgr.getSecureScores()).toEqual([]);
    });
  });

  describe("listAssessments", () => {
    it("lists assessments", async () => {
      mockAssessments.list.mockReturnValue(asyncIter([
        { id: "a-1", name: "assess-1", properties: { status: { code: "Unhealthy" }, displayName: "Enable MFA", resourceDetails: { source: "Azure" } } },
      ]));
      const assessments = await mgr.listAssessments();
      expect(assessments).toHaveLength(1);
    });
  });

  describe("listAlerts", () => {
    it("lists security alerts", async () => {
      mockAlerts.list.mockReturnValue(asyncIter([
        { id: "alert-1", name: "a-1", properties: { alertDisplayName: "Suspicious activity", severity: "High", status: "Active", alertType: "VM_SuspiciousActivity", compromisedEntity: "vm-1", timeGeneratedUtc: new Date() } },
      ]));
      // needs listByResourceGroup mock too since code creates (but doesn't use) the iter
      mockAlerts.listByResourceGroup.mockReturnValue(asyncIter([]));
      const alerts = await mgr.listAlerts();
      expect(alerts).toHaveLength(1);
    });
  });

  describe("listRecommendations", () => {
    it("returns assessments with metadata", async () => {
      mockAssessments.list.mockReturnValue(asyncIter([
        { id: "r-1", name: "rec-1", properties: { status: { code: "Unhealthy" }, displayName: "Enable encryption" }, metadata: { severity: "High", description: "Encrypt data at rest" } },
        { id: "r-2", name: "rec-2", properties: { status: { code: "Healthy" }, displayName: "Skip" } }, // no metadata → filtered
      ]));
      const recs = await mgr.listRecommendations();
      expect(recs).toHaveLength(1);
    });
  });
});
