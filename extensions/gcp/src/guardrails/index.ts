/**
 * GCP Guardrails / Governance Manager
 *
 * In-memory rule engine for operation approval, resource protection, and policy enforcement.
 * No external deps required — works locally with user-defined rules.
 */

// =============================================================================
// Types
// =============================================================================

export type GcpGuardrailSeverity = "critical" | "high" | "medium" | "low";

export type GcpGuardrailCondition = {
  field: string;
  operator: "equals" | "not-equals" | "contains" | "regex";
  value: string;
};

export type GcpGuardrailRule = {
  id: string;
  name: string;
  description: string;
  resourcePattern: string;
  action: "allow" | "deny" | "warn";
  conditions?: GcpGuardrailCondition[];
  severity: GcpGuardrailSeverity;
};

export type GcpGuardrailOperation = {
  resourceType: string;
  action: string;
  project?: string;
  region?: string;
  labels?: Record<string, string>;
  params?: Record<string, unknown>;
};

export type GcpGuardrailViolation = {
  ruleId: string;
  ruleName: string;
  message: string;
  severity: string;
};

export type GcpGuardrailResult = {
  allowed: boolean;
  violations: GcpGuardrailViolation[];
  warnings: string[];
};

type ProtectionLevel = "strict" | "warn" | "none";

// =============================================================================
// Helpers
// =============================================================================

/** Convert a simple glob pattern (with `*` wildcards) into a RegExp. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Resolve a dotted field path against a flat operation record. */
function resolveField(operation: GcpGuardrailOperation, field: string): string | undefined {
  if (field.startsWith("labels.")) {
    const key = field.slice("labels.".length);
    return operation.labels?.[key];
  }
  if (field.startsWith("params.")) {
    const key = field.slice("params.".length);
    const val = operation.params?.[key];
    return val === undefined ? undefined : String(val);
  }
  const direct = (operation as Record<string, unknown>)[field];
  return direct === undefined ? undefined : String(direct);
}

function evaluateCondition(operation: GcpGuardrailOperation, cond: GcpGuardrailCondition): boolean {
  const actual = resolveField(operation, cond.field);
  if (actual === undefined) return false;

  switch (cond.operator) {
    case "equals":
      return actual === cond.value;
    case "not-equals":
      return actual !== cond.value;
    case "contains":
      return actual.includes(cond.value);
    case "regex":
      return new RegExp(cond.value).test(actual);
  }
}

// =============================================================================
// Manager
// =============================================================================

export class GcpGuardrailsManager {
  private rules: Map<string, GcpGuardrailRule> = new Map();
  private protections: Map<string, ProtectionLevel> = new Map();

  addRule(rule: GcpGuardrailRule): void {
    this.rules.set(rule.id, rule);
  }

  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  listRules(): GcpGuardrailRule[] {
    return [...this.rules.values()];
  }

  setProtection(resourcePattern: string, level: ProtectionLevel): void {
    this.protections.set(resourcePattern, level);
  }

  /** Full validation — returns violations and warnings. */
  validateOperation(operation: GcpGuardrailOperation): GcpGuardrailResult {
    const violations: GcpGuardrailViolation[] = [];
    const warnings: string[] = [];

    // Check protection levels first
    for (const [pattern, level] of this.protections) {
      if (!globToRegex(pattern).test(operation.resourceType)) continue;
      if (level === "strict") {
        violations.push({
          ruleId: `protection:${pattern}`,
          ruleName: "Resource Protection",
          message: `Resource type "${operation.resourceType}" is strictly protected (pattern: ${pattern})`,
          severity: "critical",
        });
      } else if (level === "warn") {
        warnings.push(
          `Resource type "${operation.resourceType}" has a warning-level protection (pattern: ${pattern})`,
        );
      }
    }

    // Evaluate each rule
    for (const rule of this.rules.values()) {
      if (!globToRegex(rule.resourcePattern).test(operation.resourceType)) continue;

      // All conditions must match for the rule to apply
      const conditionsMatch =
        !rule.conditions?.length || rule.conditions.every((c) => evaluateCondition(operation, c));
      if (!conditionsMatch) continue;

      if (rule.action === "deny") {
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          message: `Operation on "${operation.resourceType}" denied by rule "${rule.name}": ${rule.description}`,
          severity: rule.severity,
        });
      } else if (rule.action === "warn") {
        warnings.push(
          `Rule "${rule.name}" warns on "${operation.resourceType}": ${rule.description}`,
        );
      }
      // "allow" rules don't produce output — they act as explicit permits
    }

    return {
      allowed: violations.length === 0,
      violations,
      warnings,
    };
  }

  /** Convenience shorthand — true when no violations exist. */
  isOperationAllowed(operation: GcpGuardrailOperation): boolean {
    return this.validateOperation(operation).allowed;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createGuardrailsManager(): GcpGuardrailsManager {
  return new GcpGuardrailsManager();
}
