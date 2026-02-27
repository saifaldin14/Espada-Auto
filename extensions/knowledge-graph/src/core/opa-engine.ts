/**
 * Infrastructure Knowledge Graph — OPA/Rego Policy Engine Integration
 *
 * Evaluates infrastructure change requests against Open Policy Agent (OPA)
 * policies written in Rego. Supports:
 *
 *   1. **Remote OPA server** — HTTP REST API evaluation (v1 Data API)
 *   2. **Local Rego bundles** — in-memory rule evaluation for offline/embedded use
 *   3. **Mock mode** — deterministic responses for testing
 *
 * Design:
 *   - The `OpaEngine` interface defines the contract for any OPA backend.
 *   - `RemoteOpaEngine` talks to a running OPA server (typically :8181).
 *   - `LocalOpaEngine` evaluates a set of Rego rules directly, without
 *     needing a running server, by matching rule conditions against input.
 *   - `MockOpaEngine` returns canned results for test scenarios.
 *   - The engine is injected into `ChangeGovernor` via config; if absent,
 *     the governor falls back to inline policy pre-checks only.
 */

import type { ChangeRequest, RiskLevel } from "./governance.js";

// =============================================================================
// Types
// =============================================================================

/** Severity levels for OPA policy violations (aligns with policy-engine). */
export type OpaSeverity = "critical" | "high" | "medium" | "low" | "info";

/** A single violation returned by the OPA evaluation. */
export type OpaPolicyViolation = {
  /** The Rego rule/package that triggered. */
  ruleId: string;
  /** Human-readable violation message. */
  message: string;
  /** Severity of this violation. */
  severity: OpaSeverity;
  /** What action the policy prescribes. */
  action: "deny" | "warn" | "require_approval" | "notify";
  /** The Rego package path that produced this result. */
  package: string;
  /** Optional structured metadata from the Rego decision. */
  metadata?: Record<string, unknown>;
};

/** Result of evaluating a change request against OPA policies. */
export type OpaEvaluationResult = {
  /** Whether the evaluation succeeded (network/parse errors = false). */
  ok: boolean;
  /** Violations found (empty = change is compliant). */
  violations: OpaPolicyViolation[];
  /** Wall-clock time for the evaluation in milliseconds. */
  durationMs: number;
  /** If not ok, the error message. */
  error?: string;
};

/** Input document sent to OPA for evaluation. */
export type OpaInput = {
  /** The change request being evaluated. */
  changeRequest: {
    id: string;
    initiator: string;
    initiatorType: "human" | "agent" | "system";
    targetResourceId: string;
    resourceType: string;
    provider: string;
    action: string;
    description: string;
    riskScore: number;
    riskLevel: RiskLevel;
    riskFactors: string[];
    metadata: Record<string, unknown>;
  };
  /** Current timestamp (ISO-8601). */
  timestamp: string;
};

/** Configuration for a remote OPA server connection. */
export type RemoteOpaConfig = {
  /** Base URL of the OPA server (e.g. "http://localhost:8181"). */
  baseUrl: string;
  /** Rego policy path to query (e.g. "v1/data/espada/infra/deny"). */
  policyPath: string;
  /** Optional auth token (Bearer). */
  authToken?: string;
  /** Request timeout in milliseconds (default: 5000). */
  timeoutMs?: number;
  /** Whether to fail-open (allow) or fail-closed (deny) on OPA errors. */
  failMode?: "open" | "closed";
};

/** A local Rego rule for in-memory evaluation (no OPA server needed). */
export type LocalRegoRule = {
  /** Unique rule identifier. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Rego package this rule belongs to. */
  package: string;
  /** The condition to evaluate. */
  condition: LocalRegoCondition;
  /** Severity if the condition matches. */
  severity: OpaSeverity;
  /** Action to take. */
  action: "deny" | "warn" | "require_approval" | "notify";
  /** Message template (supports {{field}} interpolation). */
  message: string;
};

/** Condition types supported by the local Rego evaluator. */
export type LocalRegoCondition =
  | { type: "field_equals"; field: string; value: unknown }
  | { type: "field_not_equals"; field: string; value: unknown }
  | { type: "field_contains"; field: string; value: string }
  | { type: "field_matches"; field: string; pattern: string }
  | { type: "field_gt"; field: string; value: number }
  | { type: "field_lt"; field: string; value: number }
  | { type: "field_in"; field: string; values: unknown[] }
  | { type: "field_not_in"; field: string; values: unknown[] }
  | { type: "and"; conditions: LocalRegoCondition[] }
  | { type: "or"; conditions: LocalRegoCondition[] }
  | { type: "not"; condition: LocalRegoCondition };

/** Configuration for the local Rego evaluator. */
export type LocalOpaConfig = {
  /** Set of rules to evaluate. */
  rules: LocalRegoRule[];
};

// =============================================================================
// OPA Engine Interface
// =============================================================================

/**
 * Contract for any OPA evaluation backend.
 * Implementations must be stateless per-evaluation call.
 */
export interface OpaEngine {
  /** A label identifying the engine type (for logging). */
  readonly type: string;

  /**
   * Evaluate the given change request against loaded OPA policies.
   * Must never throw — errors are captured in `OpaEvaluationResult.error`.
   */
  evaluate(input: OpaInput): Promise<OpaEvaluationResult>;

  /**
   * Health check — verifies the engine is reachable and has policies loaded.
   * Returns true if healthy.
   */
  healthCheck(): Promise<boolean>;
}

// =============================================================================
// Remote OPA Engine (HTTP REST API)
// =============================================================================

/**
 * Evaluates policies against a running OPA server via its REST API.
 *
 * Expected OPA response shape:
 *   POST /v1/data/espada/infra/deny
 *   { "result": [{ "rule_id": "...", "message": "...", "severity": "...", ... }] }
 *
 * Or for a boolean deny:
 *   { "result": true }
 */
export class RemoteOpaEngine implements OpaEngine {
  readonly type = "remote";

  private config: Required<RemoteOpaConfig>;

  constructor(config: RemoteOpaConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      policyPath: config.policyPath.replace(/^\/+/, ""),
      authToken: config.authToken ?? "",
      timeoutMs: config.timeoutMs ?? 5000,
      failMode: config.failMode ?? "open",
    };
  }

  async evaluate(input: OpaInput): Promise<OpaEvaluationResult> {
    const start = Date.now();

    try {
      const url = `${this.config.baseUrl}/${this.config.policyPath}`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.config.authToken) {
        headers["Authorization"] = `Bearer ${this.config.authToken}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ input }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return this.handleError(
          `OPA returned HTTP ${response.status}: ${body}`,
          start,
        );
      }

      const data = (await response.json()) as {
        result?: unknown;
      };

      const violations = this.parseOpaResult(data.result);
      return {
        ok: true,
        violations,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      return this.handleError(message, start);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      let response: Response;
      try {
        response = await fetch(`${this.config.baseUrl}/health`, {
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Parse the OPA result into a list of violations.
   *
   * Handles multiple OPA response shapes:
   *   - Array of violation objects: [{ rule_id, message, severity, action, package }]
   *   - Boolean deny: true = blocked, false = allowed
   *   - Object with nested deny: { deny: [...] }
   */
  private parseOpaResult(result: unknown): OpaPolicyViolation[] {
    if (result == null) return [];

    // Boolean deny
    if (typeof result === "boolean") {
      return result
        ? [
            {
              ruleId: "opa.deny",
              message: "Change denied by OPA policy",
              severity: "high",
              action: "deny",
              package: this.config.policyPath,
            },
          ]
        : [];
    }

    // Array of violation objects
    if (Array.isArray(result)) {
      return result
        .filter((v): v is Record<string, unknown> => v != null && typeof v === "object")
        .map((v) => ({
          ruleId: String(v.rule_id ?? v.ruleId ?? "unknown"),
          message: String(v.message ?? v.msg ?? "Policy violation"),
          severity: normalizeSeverity(v.severity),
          action: normalizeAction(v.action),
          package: String(v.package ?? this.config.policyPath),
          metadata: typeof v.metadata === "object" && v.metadata != null
            ? (v.metadata as Record<string, unknown>)
            : undefined,
        }));
    }

    // Object with deny array
    if (typeof result === "object") {
      const obj = result as Record<string, unknown>;
      if (Array.isArray(obj.deny)) {
        return this.parseOpaResult(obj.deny);
      }
      // Single violation object
      if (obj.rule_id || obj.ruleId || obj.message) {
        return this.parseOpaResult([obj]);
      }
    }

    return [];
  }

  /**
   * Handle an error from the OPA server.
   * Fail-open returns no violations; fail-closed returns a synthetic violation.
   */
  private handleError(
    message: string,
    startTime: number,
  ): OpaEvaluationResult {
    if (this.config.failMode === "closed") {
      return {
        ok: false,
        violations: [
          {
            ruleId: "opa.error",
            message: `OPA evaluation failed (fail-closed): ${message}`,
            severity: "critical",
            action: "deny",
            package: this.config.policyPath,
          },
        ],
        durationMs: Date.now() - startTime,
        error: message,
      };
    }

    // Fail-open: log error but allow the change
    return {
      ok: false,
      violations: [],
      durationMs: Date.now() - startTime,
      error: message,
    };
  }
}

// =============================================================================
// Local OPA Engine (In-Memory Rego Rule Evaluation)
// =============================================================================

/**
 * Evaluates a set of Rego-like rules locally, without requiring a running
 * OPA server. Useful for testing, offline evaluation, and simple policy sets.
 *
 * This is not a full Rego interpreter — it evaluates structured conditions
 * against the OPA input document using the same field-path syntax as the
 * policy-scan-tool.
 */
export class LocalOpaEngine implements OpaEngine {
  readonly type = "local";

  private rules: LocalRegoRule[];

  constructor(config: LocalOpaConfig) {
    this.rules = config.rules;
  }

  /** Add a rule at runtime. */
  addRule(rule: LocalRegoRule): void {
    this.rules.push(rule);
  }

  /** Remove a rule by ID. */
  removeRule(ruleId: string): boolean {
    const idx = this.rules.findIndex((r) => r.id === ruleId);
    if (idx < 0) return false;
    this.rules.splice(idx, 1);
    return true;
  }

  /** Get all loaded rules. */
  getRules(): readonly LocalRegoRule[] {
    return this.rules;
  }

  async evaluate(input: OpaInput): Promise<OpaEvaluationResult> {
    const start = Date.now();

    try {
      const flat = flattenInput(input);
      const violations: OpaPolicyViolation[] = [];

      for (const rule of this.rules) {
        if (evaluateCondition(rule.condition, flat)) {
          violations.push({
            ruleId: rule.id,
            message: interpolateMessage(rule.message, flat),
            severity: rule.severity,
            action: rule.action,
            package: rule.package,
          });
        }
      }

      return {
        ok: true,
        violations,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        violations: [],
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

// =============================================================================
// Mock OPA Engine (Testing)
// =============================================================================

/**
 * Mock OPA engine for deterministic testing.
 * Returns pre-configured responses based on predicate functions.
 */
export class MockOpaEngine implements OpaEngine {
  readonly type = "mock";

  private responses: Array<{
    predicate: (input: OpaInput) => boolean;
    result: OpaEvaluationResult;
  }> = [];

  private defaultResult: OpaEvaluationResult = {
    ok: true,
    violations: [],
    durationMs: 1,
  };

  private evaluationLog: OpaInput[] = [];

  /** Set the default result when no predicate matches. */
  setDefault(result: OpaEvaluationResult): void {
    this.defaultResult = result;
  }

  /**
   * Register a canned response for inputs matching a predicate.
   * Predicates are checked in registration order; first match wins.
   */
  when(
    predicate: (input: OpaInput) => boolean,
    result: OpaEvaluationResult,
  ): void {
    this.responses.push({ predicate, result });
  }

  /** Convenience: return violations when a specific action is requested. */
  whenAction(
    action: string,
    violations: OpaPolicyViolation[],
  ): void {
    this.when(
      (input) => input.changeRequest.action === action,
      { ok: true, violations, durationMs: 1 },
    );
  }

  /** Convenience: return violations when targeting a specific resource type. */
  whenResourceType(
    resourceType: string,
    violations: OpaPolicyViolation[],
  ): void {
    this.when(
      (input) => input.changeRequest.resourceType === resourceType,
      { ok: true, violations, durationMs: 1 },
    );
  }

  /** Convenience: return violations when risk score exceeds a threshold. */
  whenRiskAbove(
    threshold: number,
    violations: OpaPolicyViolation[],
  ): void {
    this.when(
      (input) => input.changeRequest.riskScore > threshold,
      { ok: true, violations, durationMs: 1 },
    );
  }

  /** Get all inputs that were evaluated (for assertions). */
  getEvaluationLog(): readonly OpaInput[] {
    return this.evaluationLog;
  }

  /** Clear the evaluation log. */
  clearLog(): void {
    this.evaluationLog = [];
  }

  async evaluate(input: OpaInput): Promise<OpaEvaluationResult> {
    this.evaluationLog.push(input);

    for (const { predicate, result } of this.responses) {
      if (predicate(input)) return result;
    }

    return this.defaultResult;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Normalize a severity value from OPA responses. */
function normalizeSeverity(value: unknown): OpaSeverity {
  const s = String(value ?? "medium").toLowerCase();
  const valid: OpaSeverity[] = ["critical", "high", "medium", "low", "info"];
  return valid.includes(s as OpaSeverity) ? (s as OpaSeverity) : "medium";
}

/** Normalize an action value from OPA responses. */
function normalizeAction(
  value: unknown,
): "deny" | "warn" | "require_approval" | "notify" {
  const a = String(value ?? "deny").toLowerCase();
  const valid = ["deny", "warn", "require_approval", "notify"];
  return valid.includes(a) ? (a as "deny" | "warn" | "require_approval" | "notify") : "deny";
}

/** Flatten the OPA input into dot-path accessible fields. */
function flattenInput(input: OpaInput): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const cr = input.changeRequest;

  flat["changeRequest"] = cr;
  flat["changeRequest.id"] = cr.id;
  flat["changeRequest.initiator"] = cr.initiator;
  flat["changeRequest.initiatorType"] = cr.initiatorType;
  flat["changeRequest.targetResourceId"] = cr.targetResourceId;
  flat["changeRequest.resourceType"] = cr.resourceType;
  flat["changeRequest.provider"] = cr.provider;
  flat["changeRequest.action"] = cr.action;
  flat["changeRequest.description"] = cr.description;
  flat["changeRequest.riskScore"] = cr.riskScore;
  flat["changeRequest.riskLevel"] = cr.riskLevel;
  flat["changeRequest.riskFactors"] = cr.riskFactors;
  flat["changeRequest.metadata"] = cr.metadata;
  flat["timestamp"] = input.timestamp;

  // Flatten metadata
  if (cr.metadata) {
    for (const [k, v] of Object.entries(cr.metadata)) {
      flat[`changeRequest.metadata.${k}`] = v;
    }
  }

  return flat;
}

/** Resolve a dot-path field from a flat record. */
function getField(flat: Record<string, unknown>, path: string): unknown {
  return flat[path];
}

/** Evaluate a local Rego condition against flattened input. */
function evaluateCondition(
  cond: LocalRegoCondition,
  flat: Record<string, unknown>,
): boolean {
  switch (cond.type) {
    case "field_equals":
      return getField(flat, cond.field) === cond.value;
    case "field_not_equals":
      return getField(flat, cond.field) !== cond.value;
    case "field_contains":
      return String(getField(flat, cond.field) ?? "").includes(cond.value);
    case "field_matches":
      return new RegExp(cond.pattern).test(
        String(getField(flat, cond.field) ?? ""),
      );
    case "field_gt":
      return Number(getField(flat, cond.field)) > cond.value;
    case "field_lt":
      return Number(getField(flat, cond.field)) < cond.value;
    case "field_in":
      return (cond.values as unknown[]).includes(getField(flat, cond.field));
    case "field_not_in":
      return !(cond.values as unknown[]).includes(getField(flat, cond.field));
    case "and":
      return cond.conditions.every((c) => evaluateCondition(c, flat));
    case "or":
      return cond.conditions.some((c) => evaluateCondition(c, flat));
    case "not":
      return !evaluateCondition(cond.condition, flat);
  }
}

/** Interpolate {{field}} placeholders in a message template. */
function interpolateMessage(
  template: string,
  flat: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\S+?)\}\}/g, (_match, field: string) => {
    const value = getField(flat, field);
    return value != null ? String(value) : `<${field}>`;
  });
}

// =============================================================================
// Factory
// =============================================================================

/** Configuration union for creating an OPA engine. */
export type OpaEngineConfig =
  | { type: "remote"; config: RemoteOpaConfig }
  | { type: "local"; config: LocalOpaConfig }
  | { type: "mock" };

/** Create an OPA engine from a typed configuration. */
export function createOpaEngine(engineConfig: OpaEngineConfig): OpaEngine {
  switch (engineConfig.type) {
    case "remote":
      return new RemoteOpaEngine(engineConfig.config);
    case "local":
      return new LocalOpaEngine(engineConfig.config);
    case "mock":
      return new MockOpaEngine();
  }
}

/**
 * Build the OPA input document from a ChangeRequest.
 * Used by the ChangeGovernor to prepare data for OPA evaluation.
 */
export function buildOpaInput(request: ChangeRequest): OpaInput {
  return {
    changeRequest: {
      id: request.id,
      initiator: request.initiator,
      initiatorType: request.initiatorType,
      targetResourceId: request.targetResourceId,
      resourceType: request.resourceType,
      provider: request.provider,
      action: request.action,
      description: request.description,
      riskScore: request.risk.score,
      riskLevel: request.risk.level,
      riskFactors: request.risk.factors,
      metadata: request.metadata,
    },
    timestamp: new Date().toISOString(),
  };
}
