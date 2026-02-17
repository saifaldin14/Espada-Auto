/**
 * Azure Cost Management — Type Definitions
 */

export type CostGranularity = "Daily" | "Monthly" | "None";

export type CostDimension = "ResourceGroup" | "ResourceType" | "ServiceName" | "MeterCategory" | "TagKey";

export type CostQueryResult = {
  columns: Array<{ name: string; type: string }>;
  rows: Array<Array<string | number>>;
  nextLink?: string;
};

export type CostSummary = {
  totalCost: number;
  currency: string;
  timeframe: string;
  breakdown: Array<{
    name: string;
    cost: number;
    percentage: number;
  }>;
};

export type CostForecast = {
  totalCost: number;
  currency: string;
  confidenceLevel: string;
  timePeriod: { from: string; to: string };
  breakdown: Array<{
    date: string;
    cost: number;
  }>;
};

export type Budget = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  timeGrain: "Monthly" | "Quarterly" | "Annually";
  currentSpend: number;
  notifications: Array<{
    threshold: number;
    operator: string;
    contactEmails: string[];
    enabled: boolean;
  }>;
  startDate?: string;
  endDate?: string;
};

export type CostRecommendation = {
  id: string;
  category: string;
  impact: string;
  impactedField: string;
  impactedValue: string;
  shortDescription: string;
  extendedProperties?: Record<string, string>;
  annualSavingsAmount?: number;
  currency?: string;
};

export type CostQueryOptions = {
  timeframe?: string;
  timePeriod?: { from: string; to: string };
  granularity?: CostGranularity;
  groupBy?: CostDimension[];
  filter?: string;
};
