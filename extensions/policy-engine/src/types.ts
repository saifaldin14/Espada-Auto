/**
 * Policy Engine — Core Types
 *
 * Defines the policy model: definitions, evaluation inputs/outputs,
 * storage, and rule types. The engine evaluates policies expressed as
 * declarative rules (TypeScript-native, OPA-style semantics).
 */

// ─── Policy Definition ─────────────────────────────────────────────────────────

export type PolicyType =
  | "plan"
  | "access"
  | "approval"
  | "notification"
  | "drift"
  | "cost"
  | "deployment";

export type PolicySeverity = "critical" | "high" | "medium" | "low" | "info";

export type PolicyDefinition = {
  id: string;
  name: string;
  description: string;
  type: PolicyType;
  enabled: boolean;
  severity: PolicySeverity;
  labels: string[];
  autoAttachPatterns: string[];
  rules: PolicyRule[];
  createdAt: string;
  updatedAt: string;
};

export type PolicyDefinitionInput = {
  id?: string;
  name: string;
  description?: string;
  type: PolicyType;
  enabled?: boolean;
  severity?: PolicySeverity;
  labels?: string[];
  autoAttachPatterns?: string[];
  rules: PolicyRule[];
};

// ─── Policy Rules ──────────────────────────────────────────────────────────────

export type PolicyRule = {
  id: string;
  description: string;
  condition: RuleCondition;
  action: "deny" | "warn" | "require_approval" | "notify";
  message: string;
};

export type RuleCondition =
  | { type: "field_equals"; field: string; value: unknown }
  | { type: "field_not_equals"; field: string; value: unknown }
  | { type: "field_contains"; field: string; value: string }
  | { type: "field_matches"; field: string; pattern: string }
  | { type: "field_gt"; field: string; value: number }
  | { type: "field_lt"; field: string; value: number }
  | { type: "field_exists"; field: string }
  | { type: "field_not_exists"; field: string }
  | { type: "field_in"; field: string; values: unknown[] }
  | { type: "field_not_in"; field: string; values: unknown[] }
  | { type: "tag_missing"; tag: string }
  | { type: "tag_equals"; tag: string; value: string }
  | { type: "and"; conditions: RuleCondition[] }
  | { type: "or"; conditions: RuleCondition[] }
  | { type: "not"; condition: RuleCondition }
  | { type: "resource_type"; resourceType: string }
  | { type: "provider"; provider: string }
  | { type: "region"; region: string }
  | { type: "custom"; evaluator: string; args?: Record<string, unknown> };

// ─── Evaluation Types ──────────────────────────────────────────────────────────

export type PolicyEvaluationInput = {
  resource?: ResourceInput;
  plan?: PlanInput;
  actor?: ActorInput;
  environment?: string;
  graph?: GraphContextInput;
  cost?: CostInput;
  metadata?: Record<string, unknown>;
};

export type ResourceInput = {
  id: string;
  type: string;
  provider: string;
  region: string;
  name: string;
  status: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
};

export type PlanInput = {
  resourceChanges?: PlanResourceChange[];
  resources?: ResourceInput[];
  totalCreates: number;
  totalUpdates: number;
  totalDeletes: number;
};

export type PlanResourceChange = {
  address: string;
  type: string;
  action: "create" | "update" | "delete" | "no-op";
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

export type ActorInput = {
  id: string;
  roles: string[];
  groups: string[];
};

export type GraphContextInput = {
  neighbors: ResourceInput[];
  blastRadius: number;
  dependencyDepth: number;
};

export type CostInput = {
  current: number;
  projected: number;
  delta: number;
  currency: string;
};

// ─── Evaluation Output ─────────────────────────────────────────────────────────

export type PolicyEvaluationResult = {
  policyId: string;
  policyName: string;
  allowed: boolean;
  denied: boolean;
  warnings: string[];
  denials: string[];
  approvalRequired: boolean;
  notifications: string[];
  evaluatedRules: RuleResult[];
  evaluatedAt: string;
  durationMs: number;
};

export type RuleResult = {
  ruleId: string;
  description: string;
  passed: boolean;
  action: "deny" | "warn" | "require_approval" | "notify";
  message: string;
};

export type AggregatedPolicyResult = {
  allowed: boolean;
  denied: boolean;
  warnings: string[];
  denials: string[];
  approvalRequired: boolean;
  notifications: string[];
  results: PolicyEvaluationResult[];
  totalPolicies: number;
  passedPolicies: number;
  failedPolicies: number;
  evaluatedAt: string;
  totalDurationMs: number;
};

// ─── Violation Types ───────────────────────────────────────────────────────────

export type PolicyViolation = {
  policyId: string;
  policyName: string;
  ruleId: string;
  ruleDescription: string;
  severity: PolicySeverity;
  action: string;
  message: string;
  resourceId: string;
  resourceType: string;
  resourceName: string;
  provider: string;
};

// ─── Storage Interface ─────────────────────────────────────────────────────────

export interface PolicyStorage {
  initialize(): Promise<void>;
  save(policy: PolicyDefinition): Promise<void>;
  getById(id: string): Promise<PolicyDefinition | null>;
  list(filter?: { type?: string; enabled?: boolean; severity?: string }): Promise<PolicyDefinition[]>;
  delete(id: string): Promise<boolean>;
  close(): Promise<void>;
}
