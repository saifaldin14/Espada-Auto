/**
 * Azure Conversational UX Types
 *
 * Types for natural-language infrastructure queries, proactive insights,
 * and wizard-mode resource creation.
 */

// =============================================================================
// Infrastructure Context
// =============================================================================

export interface InfrastructureContext {
  subscriptionId: string;
  resources: TrackedResource[];
  lastUpdated: string;
}

export interface TrackedResource {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  region: string;
  tags: Record<string, string>;
  status: string;
  properties: Record<string, unknown>;
  trackedAt: string;
}

// =============================================================================
// Natural Language Queries
// =============================================================================

export type QueryCategory =
  | "list"
  | "count"
  | "status"
  | "cost"
  | "security"
  | "compliance"
  | "networking"
  | "performance"
  | "recommendation"
  | "general";

export interface ParsedQuery {
  original: string;
  category: QueryCategory;
  resourceTypes: string[];
  filters: QueryFilter[];
  intent: string;
}

export interface QueryFilter {
  field: string;
  operator: "eq" | "ne" | "gt" | "lt" | "contains" | "in";
  value: string | string[];
}

export interface QueryResult {
  query: ParsedQuery;
  answer: string;
  data: unknown[];
  suggestions: string[];
  confidence: number;
}

// =============================================================================
// Proactive Insights
// =============================================================================

export type InsightSeverity = "info" | "warning" | "critical";
export type InsightCategory = "cost" | "security" | "performance" | "reliability" | "compliance" | "best-practice";

export interface ProactiveInsight {
  id: string;
  title: string;
  description: string;
  severity: InsightSeverity;
  category: InsightCategory;
  affectedResources: string[];
  recommendation: string;
  estimatedImpact?: string;
  autoFixAvailable: boolean;
  createdAt: string;
}

// =============================================================================
// Wizard Mode
// =============================================================================

export interface WizardTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  steps: WizardStep[];
}

export interface WizardStep {
  id: string;
  title: string;
  description: string;
  fields: WizardField[];
  validation?: WizardStepValidation;
}

export interface WizardField {
  name: string;
  label: string;
  type: "text" | "select" | "number" | "boolean" | "tags";
  required: boolean;
  default?: unknown;
  options?: Array<{ label: string; value: string }>;
  help?: string;
  placeholder?: string;
}

export interface WizardStepValidation {
  requiredFields: string[];
  customValidation?: string;
}

export interface WizardState {
  sessionId: string;
  templateId: string;
  currentStep: number;
  totalSteps: number;
  values: Record<string, unknown>;
  completed: boolean;
  createdAt: string;
}

// =============================================================================
// Infrastructure Summary
// =============================================================================

export interface InfrastructureSummary {
  totalResources: number;
  byType: Record<string, number>;
  byRegion: Record<string, number>;
  byResourceGroup: Record<string, number>;
  estimatedMonthlyCostUsd: number;
  healthStatus: {
    healthy: number;
    degraded: number;
    unhealthy: number;
    unknown: number;
  };
  insights: ProactiveInsight[];
}
