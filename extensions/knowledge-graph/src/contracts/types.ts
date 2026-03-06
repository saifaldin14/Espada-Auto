/**
 * Infrastructure Knowledge Graph — Infrastructure Contracts: Types
 *
 * Contracts are "unit tests for infrastructure relationships." Teams
 * define invariants about their infrastructure that are continuously
 * evaluated against the live graph.
 *
 * The contract system uses IQL as the query substrate, meaning every
 * assertion is expressed as a graph query — no new DSL to learn.
 */

import type { ComplianceFramework } from "../analysis/compliance.js";

// =============================================================================
// Contract Definition
// =============================================================================

/**
 * An infrastructure contract — a set of assertions, dependencies,
 * and guardrails that a team declares about their infrastructure.
 */
export type InfraContract = {
  /** Unique contract ID. */
  id: string;
  /** Human-readable name (e.g. "payment-service"). */
  name: string;
  /** Team or individual who owns this contract. */
  owner: string;
  /** Description of what this contract protects. */
  description: string;
  /** Whether this contract is actively evaluated. */
  enabled: boolean;

  /** Assertions that must hold true. */
  assertions: ContractAssertion[];
  /** Node IDs that this contract declares as dependencies. */
  dependencies: string[];
  /** Guardrails (numeric thresholds on graph properties). */
  guardrails: ContractGuardrail[];

  /** Optional: compliance frameworks this contract maps to. */
  complianceMapping?: ComplianceFramework[];
  /** Optional: notification channels when contract breaks. */
  notificationChannels?: string[];

  /** Tags for filtering/grouping contracts. */
  tags: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

// =============================================================================
// Assertions
// =============================================================================

/**
 * A single assertion within a contract.
 * Uses IQL queries to validate graph state.
 */
export type ContractAssertion = {
  /** Unique assertion ID within the contract. */
  id: string;
  /** Human-readable description ("Our DB must be encrypted and multi-AZ"). */
  description: string;
  /** IQL query to evaluate. */
  query: string;
  /** What we expect from the query result. */
  expectation: AssertionExpectation;
  /** Severity if this assertion fails. */
  severity: ContractSeverity;
};

/** What the assertion expects. */
export type AssertionExpectation =
  | { type: "non-empty" }
  | { type: "empty" }
  | { type: "count"; min?: number; max?: number }
  | { type: "cost"; maxMonthlyCost: number }
  | { type: "all-match" };

/** Contract severity levels. */
export type ContractSeverity = "critical" | "high" | "medium" | "low" | "info";

// =============================================================================
// Guardrails
// =============================================================================

/** A numeric guardrail on a graph property. */
export type ContractGuardrail = {
  /** Unique guardrail ID within the contract. */
  id: string;
  /** Type of guardrail. */
  type: GuardrailType;
  /** Human-readable description. */
  description: string;
  /** For node-specific guardrails, the node ID or IQL pattern. */
  nodePattern?: string;
  /** The threshold value. */
  threshold: number;
  /** Severity if exceeded. */
  severity: ContractSeverity;
};

/** Types of guardrails. */
export type GuardrailType =
  | "max-blast-radius"
  | "max-monthly-cost"
  | "min-replicas"
  | "max-drift-age"
  | "max-dependency-depth"
  | "custom-iql";

// =============================================================================
// Evaluation Results
// =============================================================================

/** Result of evaluating a single assertion. */
export type AssertionResult = {
  assertionId: string;
  description: string;
  query: string;
  status: "pass" | "fail" | "error" | "skipped";
  /** Number of results returned by the query. */
  resultCount: number;
  /** Total cost of matched resources (if applicable). */
  totalCost: number;
  /** Error message if status is "error". */
  error?: string;
  /** Duration of the assertion evaluation in ms. */
  durationMs: number;
};

/** Result of evaluating a single guardrail. */
export type GuardrailResult = {
  guardrailId: string;
  description: string;
  type: GuardrailType;
  status: "pass" | "fail" | "error";
  /** The actual measured value. */
  actualValue: number;
  /** The threshold we're comparing against. */
  threshold: number;
  /** Error message if status is "error". */
  error?: string;
  durationMs: number;
};

/** Result of evaluating a dependency check. */
export type DependencyResult = {
  nodeId: string;
  status: "healthy" | "missing" | "degraded" | "disappeared";
  /** Node name if found. */
  nodeName?: string;
  /** Node status if found. */
  nodeStatus?: string;
};

/** Result of evaluating a complete contract. */
export type ContractEvaluationResult = {
  contractId: string;
  contractName: string;
  owner: string;
  /** Overall status: pass only if all assertions, guardrails, and deps pass. */
  status: "pass" | "fail" | "error" | "degraded";
  /** Timestamp of evaluation. */
  evaluatedAt: string;
  /** How long the full evaluation took. */
  durationMs: number;

  assertions: AssertionResult[];
  guardrails: GuardrailResult[];
  dependencies: DependencyResult[];

  /** Summary counts. */
  summary: {
    totalAssertions: number;
    passedAssertions: number;
    failedAssertions: number;
    errorAssertions: number;
    totalGuardrails: number;
    passedGuardrails: number;
    failedGuardrails: number;
    totalDependencies: number;
    healthyDependencies: number;
    missingDependencies: number;
  };
};

/** Result of evaluating all contracts. */
export type ContractSuiteResult = {
  evaluatedAt: string;
  totalContracts: number;
  passed: number;
  failed: number;
  degraded: number;
  errors: number;
  results: ContractEvaluationResult[];
  durationMs: number;
};

// =============================================================================
// Contract Store Interface
// =============================================================================

/**
 * Persistence interface for infrastructure contracts.
 * Can be backed by the existing GraphStorage or a separate store.
 */
export interface ContractStore {
  /** Add or update a contract. */
  upsert(contract: InfraContract): void;
  /** Get a contract by ID. */
  get(id: string): InfraContract | undefined;
  /** Remove a contract. Returns true if it existed. */
  remove(id: string): boolean;
  /** List all contracts, optionally filtered. */
  list(filter?: ContractFilter): InfraContract[];
  /** List contracts that depend on a specific node. */
  listByDependency(nodeId: string): InfraContract[];
  /** Get contracts owned by a specific team/person. */
  listByOwner(owner: string): InfraContract[];
}

/** Filter for listing contracts. */
export type ContractFilter = {
  owner?: string;
  enabled?: boolean;
  tags?: Record<string, string>;
  hasFailures?: boolean;
};

// =============================================================================
// Event Types
// =============================================================================

/** Emitted when a contract evaluation completes. */
export type ContractEvent =
  | { type: "contract-passed"; contractId: string; evaluatedAt: string }
  | { type: "contract-failed"; contractId: string; evaluatedAt: string; failures: string[] }
  | { type: "contract-broken"; contractId: string; nodeId: string; message: string }
  | { type: "dependency-missing"; contractId: string; nodeId: string }
  | { type: "guardrail-exceeded"; contractId: string; guardrailId: string; actual: number; threshold: number };

/** Callback for contract events. */
export type ContractEventHandler = (event: ContractEvent) => void;
