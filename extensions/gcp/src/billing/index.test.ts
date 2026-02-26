import { describe, it, expect, vi, beforeEach } from "vitest";
import { GcpBillingManager } from "./index.js";
import { gcpRequest, gcpList } from "../api.js";

vi.mock("../api.js", () => ({
  gcpRequest: vi.fn(),
  gcpList: vi.fn(),
  gcpAggregatedList: vi.fn(),
  gcpMutate: vi.fn(),
  shortName: (s: string) => s.split("/").pop() ?? s,
}));

vi.mock("../retry.js", () => ({
  withGcpRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

const PROJECT = "test-project";
const TOKEN = "tok_test";
const getToken = vi.fn(async () => TOKEN);

function makeManager() {
  return new GcpBillingManager(PROJECT, getToken);
}

describe("GcpBillingManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Billing Accounts
  // ---------------------------------------------------------------------------

  describe("listBillingAccounts", () => {
    it("returns billing accounts via gcpList", async () => {
      const accounts = [
        { name: "billingAccounts/012345-ABCDEF-678910", displayName: "My Billing", open: true, masterBillingAccount: "" },
        { name: "billingAccounts/AAAAAA-BBBBBB-CCCCCC", displayName: "Sub Billing", open: false, masterBillingAccount: "billingAccounts/012345" },
      ];
      vi.mocked(gcpList).mockResolvedValueOnce(accounts);

      const result = await makeManager().listBillingAccounts();

      expect(gcpList).toHaveBeenCalledWith(
        "https://cloudbilling.googleapis.com/v1/billingAccounts",
        TOKEN,
        "billingAccounts",
      );
      expect(result).toHaveLength(2);
      expect(result[0].displayName).toBe("My Billing");
      expect(result[1].open).toBe(false);
    });

    it("returns empty array when no accounts exist", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([]);
      const result = await makeManager().listBillingAccounts();
      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Project Billing Info
  // ---------------------------------------------------------------------------

  describe("getBillingInfo", () => {
    it("fetches billing info for the project", async () => {
      const info = { projectId: PROJECT, billingAccountName: "billingAccounts/012345-ABCDEF-678910", billingEnabled: true };
      vi.mocked(gcpRequest).mockResolvedValueOnce(info);

      const result = await makeManager().getBillingInfo();

      expect(gcpRequest).toHaveBeenCalledWith(
        `https://cloudbilling.googleapis.com/v1/projects/${PROJECT}/billingInfo`,
        TOKEN,
      );
      expect(result.billingEnabled).toBe(true);
      expect(result.projectId).toBe(PROJECT);
    });

    it("returns disabled billing when no account linked", async () => {
      vi.mocked(gcpRequest).mockResolvedValueOnce({ projectId: PROJECT, billingAccountName: "", billingEnabled: false });
      const result = await makeManager().getBillingInfo();
      expect(result.billingEnabled).toBe(false);
      expect(result.billingAccountName).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // Budgets
  // ---------------------------------------------------------------------------

  describe("listBudgets", () => {
    it("returns budgets for a billing account", async () => {
      const budgets = [
        {
          name: "billingAccounts/012345/budgets/budget-1",
          displayName: "Monthly Budget",
          amount: { specifiedAmount: { currencyCode: "USD", units: "1000" } },
          thresholdRules: [{ thresholdPercent: 0.5, spendBasis: "CURRENT_SPEND" }],
          budgetFilter: {},
        },
      ];
      vi.mocked(gcpList).mockResolvedValueOnce(budgets);

      const result = await makeManager().listBudgets("billingAccounts/012345");

      expect(gcpList).toHaveBeenCalledWith(
        "https://billingbudgets.googleapis.com/v1/billingAccounts/012345/budgets",
        TOKEN,
        "budgets",
      );
      expect(result).toHaveLength(1);
      expect(result[0].displayName).toBe("Monthly Budget");
      expect(result[0].thresholdRules[0].thresholdPercent).toBe(0.5);
    });

    it("returns empty array when no budgets configured", async () => {
      vi.mocked(gcpList).mockResolvedValueOnce([]);
      const result = await makeManager().listBudgets("billingAccounts/012345");
      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Cost Breakdown
  // ---------------------------------------------------------------------------

  describe("getCostBreakdown", () => {
    it("returns empty breakdown with date range", async () => {
      vi.mocked(gcpRequest).mockResolvedValueOnce({ projectId: PROJECT, billingEnabled: true });

      const result = await makeManager().getCostBreakdown({ startDate: "2024-01-01", endDate: "2024-01-31" });

      expect(gcpRequest).toHaveBeenCalledWith(
        `https://cloudbilling.googleapis.com/v1/projects/${PROJECT}/billingInfo`,
        TOKEN,
      );
      expect(result).toEqual({
        totalCost: 0,
        currency: "USD",
        serviceCosts: [],
        period: { startDate: "2024-01-01", endDate: "2024-01-31" },
      });
    });

    it("uses empty strings when no dates provided", async () => {
      vi.mocked(gcpRequest).mockResolvedValueOnce({ projectId: PROJECT, billingEnabled: true });

      const result = await makeManager().getCostBreakdown();

      expect(result.period).toEqual({ startDate: "", endDate: "" });
    });

    it("validates project billing before returning breakdown", async () => {
      vi.mocked(gcpRequest).mockResolvedValueOnce({});
      await makeManager().getCostBreakdown();
      expect(gcpRequest).toHaveBeenCalledTimes(1);
    });
  });
});
