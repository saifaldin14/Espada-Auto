/**
 * Integration Types — Shared interfaces for cross-extension bridges
 *
 * These types define the contracts between the Knowledge Graph and sibling
 * Espada extensions. Each bridge uses optional dynamic imports so the KG
 * degrades gracefully when a dependency is not installed.
 */

import type {
  GraphNode,
  GraphNodeInput,
  GraphEdgeInput,
  GraphStorage,
} from "../types.js";
import type { GraphEngine } from "../core/engine.js";

// =============================================================================
// Extension Availability — runtime feature flags
// =============================================================================

/**
 * Tracks which sibling extensions are available at runtime.
 * Populated during plugin initialization by probing gateway methods.
 */
export type ExtensionAvailability = {
  enterpriseAuth: boolean;
  auditTrail: boolean;
  compliance: boolean;
  policyEngine: boolean;
  costGovernance: boolean;
  terraform: boolean;
  alertingIntegration: boolean;
};

export const NO_EXTENSIONS: ExtensionAvailability = {
  enterpriseAuth: false,
  auditTrail: false,
  compliance: false,
  policyEngine: false,
  costGovernance: false,
  terraform: false,
  alertingIntegration: false,
};

// =============================================================================
// Bridge Logger — minimal logging interface to avoid coupling to plugin SDK
// =============================================================================

export interface BridgeLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug?(msg: string): void;
}

export const NOOP_LOGGER: BridgeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// =============================================================================
// Auth Bridge Types (enterprise-auth)
// =============================================================================

/**
 * Mirrors the enterprise-auth Permission type.
 * Kept as a union so KG doesn't need a runtime dependency on enterprise-auth.
 */
export type EnterprisePermission =
  | "infra.read"
  | "infra.write"
  | "infra.delete"
  | "infra.admin"
  | "policy.read"
  | "policy.write"
  | "policy.evaluate"
  | "audit.read"
  | "audit.export"
  | "terraform.plan"
  | "terraform.apply"
  | "terraform.destroy"
  | "cost.read"
  | "cost.approve"
  | "vcs.read"
  | "vcs.write"
  | "blueprint.read"
  | "blueprint.deploy"
  | "user.read"
  | "user.write"
  | "user.admin"
  | "role.read"
  | "role.write"
  | "apikey.create"
  | "apikey.revoke"
  | "gateway.admin";

/**
 * Minimal interface for the enterprise-auth RbacEngine.
 * Allows the auth bridge to work without importing the full extension.
 */
export interface AuthEngine {
  authorize(userId: string, permission: EnterprisePermission): Promise<AuthResult>;
  getUserPermissions(userId: string): Promise<EnterprisePermission[]>;
}

export interface AuthResult {
  allowed: boolean;
  reason: string;
  missingPermissions: EnterprisePermission[];
  matchedRole?: string;
}

// =============================================================================
// Audit Bridge Types (audit-trail)
// =============================================================================

/**
 * Minimal interface for the audit-trail AuditLogger.
 */
export interface AuditLoggerLike {
  log(event: AuditEventInput): void;
}

export type AuditEventInput = {
  eventType: string;
  severity: "info" | "warn" | "error" | "critical";
  actor: { id: string; name: string; roles: string[]; agentId?: string };
  operation: string;
  resource?: { type: string; id: string; provider?: string };
  parameters?: Record<string, unknown>;
  result: "success" | "failure" | "pending" | "denied";
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

// =============================================================================
// Compliance Bridge Types (compliance)
// =============================================================================

/**
 * ControlEvalNode from the compliance extension — the shape it expects
 * for evaluating controls. KG's GraphNode maps 1:1 to this.
 */
export type ControlEvalNode = {
  id: string;
  name: string;
  provider: string;
  resourceType: string;
  region: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  account?: string;
  status?: string;
};

export type ComplianceFrameworkId =
  | "soc2"
  | "cis"
  | "hipaa"
  | "pci-dss"
  | "gdpr"
  | "nist-800-53";

export type ComplianceViolation = {
  controlId: string;
  controlTitle: string;
  framework: ComplianceFrameworkId;
  resourceNodeId: string;
  resourceName: string;
  resourceType: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  description: string;
  remediation: string;
  status: "open" | "remediated" | "waived" | "accepted";
  detectedAt: string;
};

export type ComplianceEvaluationResult = {
  framework: ComplianceFrameworkId;
  frameworkVersion: string;
  totalControls: number;
  passedControls: number;
  failedControls: number;
  waivedControls: number;
  notApplicable: number;
  score: number;
  violations: ComplianceViolation[];
  byCategory: Record<string, { passed: number; failed: number; total: number }>;
  bySeverity: Record<string, number>;
};

/**
 * Minimal interface to the compliance extension's evaluator.
 */
export interface ComplianceEvaluator {
  evaluate(
    frameworkId: ComplianceFrameworkId,
    nodes: ControlEvalNode[],
    waiverLookup?: { isWaived: (controlId: string, resourceId: string) => boolean },
  ): ComplianceEvaluationResult;
}

/**
 * Minimal interface for a waiver store.
 */
export interface WaiverStore {
  create(waiver: {
    controlId: string;
    resourceId: string;
    reason: string;
    approvedBy: string;
    expiresAt: string;
  }): { id: string };
  list(): Array<{
    id: string;
    controlId: string;
    resourceId: string;
    reason: string;
    approvedBy: string;
    expiresAt: string;
  }>;
  isWaived(controlId: string, resourceId: string): boolean;
}

// =============================================================================
// Policy Bridge Types (policy-engine)
// =============================================================================

/** ResourceInput as expected by the policy-engine. */
export type PolicyResourceInput = {
  id: string;
  type: string;
  provider: string;
  region: string;
  name: string;
  status: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
};

export type PolicyGraphContext = {
  neighbors: PolicyResourceInput[];
  blastRadius: number;
  dependencyDepth: number;
};

export type PolicyEvaluationInput = {
  resource?: PolicyResourceInput;
  plan?: {
    resourceChanges?: unknown[];
    resources?: PolicyResourceInput[];
    totalCreates: number;
    totalUpdates: number;
    totalDeletes: number;
  };
  actor?: { id: string; roles: string[]; groups: string[] };
  environment?: string;
  graph?: PolicyGraphContext;
  cost?: { current: number; projected: number; delta: number; currency: string };
  metadata?: Record<string, unknown>;
};

export type PolicyResult = {
  policyId: string;
  policyName: string;
  allowed: boolean;
  denied: boolean;
  warnings: string[];
  denials: string[];
  approvalRequired: boolean;
  notifications: string[];
  evaluatedAt: string;
  durationMs: number;
};

export type AggregatedPolicyResult = {
  allowed: boolean;
  denied: boolean;
  warnings: string[];
  denials: string[];
  approvalRequired: boolean;
  notifications: string[];
  results: PolicyResult[];
  totalPolicies: number;
  passedPolicies: number;
  failedPolicies: number;
  evaluatedAt: string;
  totalDurationMs: number;
};

/**
 * Minimal interface for the policy-engine's evaluation engine.
 */
export interface PolicyEvaluationEngine {
  evaluateAll(input: PolicyEvaluationInput): Promise<AggregatedPolicyResult>;
  evaluate(policyId: string, input: PolicyEvaluationInput): Promise<PolicyResult>;
}

// =============================================================================
// Cost Bridge Types (cost-governance)
// =============================================================================

export type BudgetScope = "team" | "project" | "environment" | "global";
export type BudgetStatus = "ok" | "warning" | "critical" | "exceeded";

export type Budget = {
  id: string;
  name: string;
  scope: BudgetScope;
  scopeId: string;
  monthlyLimit: number;
  warningThreshold: number;
  criticalThreshold: number;
  currentSpend: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
};

export interface BudgetManagerLike {
  list(): Budget[];
  getStatus(id: string): BudgetStatus | null;
  updateSpend(id: string, amount: number): void;
}

// =============================================================================
// Terraform Bridge Types (terraform)
// =============================================================================

export type ParsedResource = {
  address: string;
  type: string;
  name: string;
  provider: string;
  providerShort: string;
  mode: "managed" | "data";
  module?: string;
  dependencies: string[];
  attributes: Record<string, unknown>;
};

/**
 * Interface for the terraform graph bridge functions.
 */
export interface TerraformGraphBridge {
  stateToGraphNodes(resources: ParsedResource[]): GraphNodeInput[];
  dependenciesToGraphEdges(resources: ParsedResource[]): GraphEdgeInput[];
  syncStateToGraph(
    storage: GraphStorage,
    resources: ParsedResource[],
  ): Promise<{ nodesUpserted: number; edgesUpserted: number }>;
  diffGraphVsState(
    storage: GraphStorage,
    resources: ParsedResource[],
  ): Promise<{
    newInTerraform: ParsedResource[];
    removedFromTerraform: string[];
    shared: string[];
  }>;
}

// =============================================================================
// Alerting Bridge Types (alerting-integration)
// =============================================================================

export type AlertSeverity = "critical" | "high" | "medium" | "low" | "info";

export type NormalisedAlert = {
  id: string;
  externalId: string;
  provider: string;
  severity: AlertSeverity;
  status: string;
  title: string;
  description: string;
  service: string;
  environment: string;
  raisedAt: string;
  receivedAt: string;
  sourceUrl: string;
  details: Record<string, unknown>;
  tags: string[];
};

export interface AlertIngestor {
  ingestAlert(alert: NormalisedAlert): Promise<{ alertId: string; dispatched: number }>;
}

// =============================================================================
// Integration Context — passed to all bridges
// =============================================================================

/**
 * Shared context for all integration bridges.
 * Holds references to KG internals + external extension interfaces.
 */
export type IntegrationContext = {
  /** The KG graph engine. */
  engine: GraphEngine;
  /** The underlying graph storage. */
  storage: GraphStorage;
  /** Logger. */
  logger: BridgeLogger;
  /** Which extensions are available. */
  available: ExtensionAvailability;
  /** External extension interfaces (populated during init). */
  ext: {
    authEngine?: AuthEngine;
    auditLogger?: AuditLoggerLike;
    complianceEvaluator?: ComplianceEvaluator;
    waiverStore?: WaiverStore;
    policyEngine?: PolicyEvaluationEngine;
    budgetManager?: BudgetManagerLike;
    terraformBridge?: TerraformGraphBridge;
    alertIngestor?: AlertIngestor;
  };
};

// =============================================================================
// Utility — GraphNode → extension type mappers
// =============================================================================

/** Convert a GraphNode to a ControlEvalNode for the compliance extension. */
export function graphNodeToControlEvalNode(node: GraphNode): ControlEvalNode {
  return {
    id: node.id,
    name: node.name,
    provider: node.provider,
    resourceType: node.resourceType,
    region: node.region,
    tags: node.tags,
    metadata: node.metadata,
    account: node.account,
    status: node.status,
  };
}

/** Convert a GraphNode to a PolicyResourceInput for the policy engine. */
export function graphNodeToPolicyResource(node: GraphNode): PolicyResourceInput {
  return {
    id: node.id,
    type: node.resourceType,
    provider: node.provider,
    region: node.region,
    name: node.name,
    status: node.status,
    tags: node.tags,
    metadata: node.metadata,
  };
}

/** Build a PolicyGraphContext from a blast radius query result. */
export function buildGraphContext(
  neighbors: GraphNode[],
  blastRadius: number,
  dependencyDepth: number,
): PolicyGraphContext {
  return {
    neighbors: neighbors.map(graphNodeToPolicyResource),
    blastRadius,
    dependencyDepth,
  };
}
