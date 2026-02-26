/**
 * Azure Cost Manager — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AzureCostManager } from "./manager.js";
import type { AzureCredentialsManager } from "../credentials/manager.js";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { async next() { return i < items.length ? { value: items[i++], done: false } : { value: undefined as any, done: true }; } };
    },
  };
}

const mockQuery = { usage: vi.fn() };
const mockForecast = { usage: vi.fn() };
const mockBudgets = { list: vi.fn() };

vi.mock("@azure/arm-costmanagement", () => ({
  CostManagementClient: vi.fn().mockImplementation(function() { return {
    query: mockQuery,
    forecast: mockForecast,
  }; }),
}));

vi.mock("@azure/arm-consumption", () => ({
  ConsumptionManagementClient: vi.fn().mockImplementation(function() { return {
    budgets: mockBudgets,
  }; }),
}));

const mockCreds = {
  getCredential: vi.fn().mockResolvedValue({ credential: { getToken: vi.fn() }, method: "default" }),
} as unknown as AzureCredentialsManager;

describe("AzureCostManager", () => {
  let mgr: AzureCostManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AzureCostManager(mockCreds, "sub-1", { maxAttempts: 1, minDelayMs: 0, maxDelayMs: 0 });
  });

  describe("queryCosts", () => {
    it("queries costs with default options", async () => {
      mockQuery.usage.mockResolvedValue({
        columns: [{ name: "Cost", type: "Number" }, { name: "Currency", type: "String" }],
        rows: [[123.45, "USD"], [67.89, "USD"]],
      });
      const result = await mgr.queryCosts();
      expect(result.rows).toHaveLength(2);
      expect(result.columns).toHaveLength(2);
    });

    it("queries costs with specific timeframe", async () => {
      mockQuery.usage.mockResolvedValue({ columns: [], rows: [] });
      await mgr.queryCosts({ timeframe: "MonthToDate" });
      expect(mockQuery.usage).toHaveBeenCalled();
    });
  });

  describe("getForecast", () => {
    it("returns forecast data", async () => {
      mockForecast.usage.mockResolvedValue({
        columns: [{ name: "Cost", type: "Number" }],
        rows: [[200.00]],
      });
      const forecast = await mgr.getForecast();
      expect(forecast.rows).toHaveLength(1);
    });
  });

  describe("listBudgets", () => {
    it("lists all budgets", async () => {
      mockBudgets.list.mockReturnValue(asyncIter([
        { id: "b-id", name: "monthly-100", properties: { amount: 100, timeGrain: "Monthly", timePeriod: { startDate: new Date(), endDate: new Date() }, currentSpend: { amount: 55, unit: "USD" }, category: "Cost" } },
      ]));
      const budgets = await mgr.listBudgets();
      expect(budgets).toHaveLength(1);
      expect(budgets[0].name).toBe("monthly-100");
    });

    it("scopes to resource group", async () => {
      mockBudgets.list.mockReturnValue(asyncIter([]));
      await mgr.listBudgets("rg-1");
      expect(mockBudgets.list).toHaveBeenCalled();
    });

    it("returns empty when no budgets", async () => {
      mockBudgets.list.mockReturnValue(asyncIter([]));
      expect(await mgr.listBudgets()).toEqual([]);
    });
  });
});
