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
 * Minimal User type matching enterprise-auth's User interface.
 * Required by RbacEngine.authorize() which needs the full user object
 * to check roles, disabled status, etc.
 */
export type AuthUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  mfaEnabled: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  ssoProviderId?: string;
  externalId?: string;
};

/**
 * Optional interface for resolving a full AuthUser from a user ID.
 * Backed by enterprise-auth's AuthStorage.getUser().
 */
export interface UserResolver {
  getUser(id: string): Promise<AuthUser | null>;
}

/**
 * Minimal interface for the enterprise-auth RbacEngine.
 * Matches the real RbacEngine class signatures.
 */
export interface AuthEngine {
  authorize(user: AuthUser, required: EnterprisePermission | EnterprisePermission[]): Promise<AuthorizationResult>;
  getUserPermissions(user: AuthUser): Promise<Set<EnterprisePermission>>;
}

export interface AuthorizationResult {
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
 * Real log() returns an AuditEvent, but KG bridges don't use the return value.
 */
export interface AuditLoggerLike {
  log(event: AuditEventInput): unknown;
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
 * ComplianceWaiver — matches the real compliance extension's waiver type.
 */
export type ComplianceWaiver = {
  id: string;
  controlId: string;
  resourceId: string;
  reason: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
};

/**
 * Minimal interface for a waiver store.
 * Matches real WaiverStore: add(), remove(), get(), list(), listActive(), isWaived().
 */
export interface WaiverStore {
  add(waiver: ComplianceWaiver): void;
  remove(waiverId: string): boolean;
  get(waiverId: string): ComplianceWaiver | undefined;
  list(): ComplianceWaiver[];
  listActive(): ComplianceWaiver[];
  isWaived(controlId: string, resourceId: string): boolean;
}

/** Generate a unique waiver ID (mirrors compliance extension's generateWaiverId). */
export function generateWaiverId(): string {
  // crypto.randomUUID requires Node ≥ 19; fallback for older runtimes
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `waiver-${uuid}`;
}

/** Helper to construct a full ComplianceWaiver object. */
export function createWaiverObject(opts: {
  controlId: string;
  resourceId: string;
  reason: string;
  approvedBy: string;
  expiresAt: string;
}): ComplianceWaiver {
  return {
    id: generateWaiverId(),
    controlId: opts.controlId,
    resourceId: opts.resourceId,
    reason: opts.reason,
    approvedBy: opts.approvedBy,
    approvedAt: new Date().toISOString(),
    expiresAt: opts.expiresAt,
  };
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

/** PolicyDefinition as expected by the policy-engine extension. */
export type PolicyDefinition = {
  id: string;
  name: string;
  description: string;
  type: string;
  enabled: boolean;
  severity: string;
  labels: string[];
  rules: PolicyRule[];
  createdAt: string;
  updatedAt: string;
};

export type PolicyRule = {
  id: string;
  description: string;
  condition: Record<string, unknown>;
  action: "deny" | "warn" | "require_approval" | "notify";
  message: string;
};

/**
 * Minimal interface for the policy-engine's evaluation engine.
 * Note: real PolicyEvaluationEngine methods are SYNCHRONOUS.
 */
export interface PolicyEvaluationEngine {
  evaluateAll(policies: PolicyDefinition[], input: PolicyEvaluationInput): AggregatedPolicyResult;
  evaluate(policy: PolicyDefinition, input: PolicyEvaluationInput): PolicyResult;
}

/** Storage interface for loading policy definitions. */
export interface PolicyStorageLike {
  list(filter?: { type?: string; enabled?: boolean; severity?: string }): Promise<PolicyDefinition[]>;
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

/**
 * Minimal interface for the cost-governance BudgetManager.
 * All methods are SYNCHRONOUS (real implementation uses readFileSync/writeFileSync).
 */
export interface BudgetManagerLike {
  listBudgets(): Budget[];
  getStatus(budget: Budget): BudgetStatus;
  updateSpend(id: string, currentSpend: number): Budget | null;
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

/** Alert provider — matches real alerting-integration AlertProvider union. */
export type AlertProvider = "pagerduty" | "opsgenie" | "cloudwatch" | "knowledge-graph";

/** Alert status — matches real alerting-integration AlertStatus union. */
export type AlertStatus = "triggered" | "acknowledged" | "resolved" | "suppressed";

/** Match operator for routing rule conditions. */
export type MatchOperator = "equals" | "contains" | "regex" | "any";

/** Dispatch channel type. */
export type DispatchChannelType = "slack" | "discord" | "msteams" | "telegram" | "matrix" | "webhook" | "custom";

/** Dispatch status for delivery records. */
export type DispatchStatus = "pending" | "sent" | "failed" | "suppressed";

export type NormalisedAlert = {
  id: string;
  externalId: string;
  provider: AlertProvider;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  description: string;
  service: string;
  environment: string;
  raisedAt: string;
  receivedAt: string;
  sourceUrl: string;
  details: Record<string, unknown>;
  rawPayload: unknown;
  tags: string[];
};

// -- Alerting routing types -------------------------------------------------

export type RoutingRule = {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: Array<{ field: keyof NormalisedAlert; operator: MatchOperator; value: string }>;
  channelIds: string[];
  template?: string;
  stopOnMatch: boolean;
  createdAt: string;
};

export type DispatchChannel = {
  id: string;
  name: string;
  type: DispatchChannelType;
  config: Record<string, unknown>;
  createdAt: string;
};

export type ChannelSender = (
  channel: DispatchChannel,
  message: string,
) => Promise<{ success: boolean; error?: string }>;

export type DispatchRecord = {
  id: string;
  alertId: string;
  channelId: string;
  ruleId: string;
  status: DispatchStatus;
  message: string;
  dispatchedAt: string;
  error?: string;
};

export type RouteMatch = {
  rule: RoutingRule;
  channels: DispatchChannel[];
};

/**
 * Interface for the alerting-integration extension.
 * Uses the lower-level route resolution + dispatch APIs (not ingestAlert)
 * because our bridge already constructs NormalisedAlert objects.
 */
export interface AlertingExtension {
  resolveRoutes(
    alert: NormalisedAlert,
    rules: RoutingRule[],
    channelMap: Map<string, DispatchChannel>,
  ): RouteMatch[];

  dispatchToChannels(
    alert: NormalisedAlert,
    channels: DispatchChannel[],
    ruleId: string,
    sender: ChannelSender,
    template?: string,
  ): Promise<DispatchRecord[]>;

  defaultSender: ChannelSender;
}

/** Alerting configuration for the KG bridge. */
export type AlertingConfig = {
  rules: RoutingRule[];
  channels: Map<string, DispatchChannel>;
  sender?: ChannelSender;
};

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
    userResolver?: UserResolver;
    auditLogger?: AuditLoggerLike;
    complianceEvaluator?: ComplianceEvaluator;
    waiverStore?: WaiverStore;
    policyEngine?: PolicyEvaluationEngine;
    policyStorage?: PolicyStorageLike;
    budgetManager?: BudgetManagerLike;
    terraformBridge?: TerraformGraphBridge;
    alertingExtension?: AlertingExtension;
  };
  /** Alerting routing configuration (rules, channels, sender). */
  alertingConfig?: AlertingConfig;
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
