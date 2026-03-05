/**
 * Governance — Policy Checker
 *
 * Evaluates migration plans against organizational policies using
 * a rule-based engine. Integrates with the policy-engine extension
 * for OPA-style policy evaluation.
 */

import type {
  MigrationProvider,
  MigrationExecutionPlan,
  MigrationStep,
  NormalizedVM,
  NormalizedBucket,
} from "../types.js";

// =============================================================================
// Policy Types
// =============================================================================

export interface MigrationPolicy {
  id: string;
  name: string;
  description: string;
  severity: "info" | "warning" | "error" | "block";
  evaluate: (context: PolicyContext) => PolicyViolation | null;
}

export interface PolicyContext {
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  plan: MigrationExecutionPlan;
  vms: NormalizedVM[];
  buckets: NormalizedBucket[];
  estimatedCostUSD: number;
  tags: Record<string, string>;
}

export interface PolicyViolation {
  policyId: string;
  policyName: string;
  severity: MigrationPolicy["severity"];
  message: string;
  resource?: string;
  remediation?: string;
}

export interface PolicyEvaluationResult {
  passed: boolean;
  violations: PolicyViolation[];
  blockers: PolicyViolation[];
  warnings: PolicyViolation[];
  info: PolicyViolation[];
  evaluatedAt: string;
}

// =============================================================================
// Built-in Policies
// =============================================================================

const BUILTIN_POLICIES: MigrationPolicy[] = [
  {
    id: "require-encryption",
    name: "Require Encryption",
    description: "All data at rest must be encrypted",
    severity: "block",
    evaluate: (ctx) => {
      const unencrypted = ctx.buckets.filter((b) => !b.encryption.enabled);
      if (unencrypted.length > 0) {
        return {
          policyId: "require-encryption",
          policyName: "Require Encryption",
          severity: "block",
          message: `${unencrypted.length} bucket(s) have no encryption: ${unencrypted.map((b) => b.name).join(", ")}`,
          remediation: "Enable encryption on target buckets (SSE or KMS)",
        };
      }
      return null;
    },
  },
  {
    id: "require-tags",
    name: "Require Migration Tags",
    description: "All migrated resources must have owner and environment tags",
    severity: "warning",
    evaluate: (ctx) => {
      const requiredTags = ["owner", "environment"];
      const missing = requiredTags.filter((t) => !ctx.tags[t]);
      if (missing.length > 0) {
        return {
          policyId: "require-tags",
          policyName: "Require Migration Tags",
          severity: "warning",
          message: `Missing required tags: ${missing.join(", ")}`,
          remediation: "Add 'owner' and 'environment' tags to migration configuration",
        };
      }
      return null;
    },
  },
  {
    id: "cost-limit",
    name: "Cost Limit",
    description: "Migration cost must not exceed $50,000",
    severity: "block",
    evaluate: (ctx) => {
      if (ctx.estimatedCostUSD > 50000) {
        return {
          policyId: "cost-limit",
          policyName: "Cost Limit",
          severity: "block",
          message: `Estimated cost $${ctx.estimatedCostUSD.toLocaleString()} exceeds $50,000 limit`,
          remediation: "Reduce migration scope or request budget exception",
        };
      }
      return null;
    },
  },
  {
    id: "no-public-ingress",
    name: "No Public Ingress on Sensitive VMs",
    description: "VMs tagged 'sensitivity=high' must not allow 0.0.0.0/0 ingress",
    severity: "error",
    evaluate: (ctx) => {
      const sensitiveVMs = ctx.vms.filter((vm) => vm.tags?.sensitivity === "high");
      if (sensitiveVMs.length > 0) {
        return {
          policyId: "no-public-ingress",
          policyName: "No Public Ingress on Sensitive VMs",
          severity: "error",
          message: `${sensitiveVMs.length} high-sensitivity VM(s) detected — verify no 0.0.0.0/0 ingress rules`,
          remediation: "Review and restrict security group rules for sensitive workloads",
        };
      }
      return null;
    },
  },
  {
    id: "region-restriction",
    name: "Region Restriction",
    description: "Data must not leave approved regions (US, EU)",
    severity: "block",
    evaluate: (ctx) => {
      // Simple region check — real impl would use a configurable approved-regions list
      const targetRegion = ctx.plan.steps[0]?.params?.targetRegion as string | undefined;
      if (targetRegion) {
        const isApproved = /^(us-|eu-|europe-|westus|eastus|westeurope|northeurope)/.test(targetRegion);
        if (!isApproved) {
          return {
            policyId: "region-restriction",
            policyName: "Region Restriction",
            severity: "block",
            message: `Target region "${targetRegion}" may not be in an approved geography`,
            resource: targetRegion,
            remediation: "Use an approved region (US or EU)",
          };
        }
      }
      return null;
    },
  },
  {
    id: "max-concurrent-vms",
    name: "Maximum Concurrent VM Migrations",
    description: "No more than 20 VMs should be migrated in a single plan",
    severity: "warning",
    evaluate: (ctx) => {
      if (ctx.vms.length > 20) {
        return {
          policyId: "max-concurrent-vms",
          policyName: "Maximum Concurrent VM Migrations",
          severity: "warning",
          message: `Plan includes ${ctx.vms.length} VMs — consider splitting into batches of ≤20`,
          remediation: "Split large migrations into multiple waves",
        };
      }
      return null;
    },
  },
];

// =============================================================================
// Policy Evaluation Engine
// =============================================================================

/**
 * Evaluate all policies against a migration context.
 */
export function evaluatePolicies(
  context: PolicyContext,
  additionalPolicies: MigrationPolicy[] = [],
): PolicyEvaluationResult {
  const allPolicies = [...BUILTIN_POLICIES, ...additionalPolicies];
  const violations: PolicyViolation[] = [];

  for (const policy of allPolicies) {
    const violation = policy.evaluate(context);
    if (violation) {
      violations.push(violation);
    }
  }

  const blockers = violations.filter((v) => v.severity === "block");
  const warnings = violations.filter((v) => v.severity === "warning");
  const info = violations.filter((v) => v.severity === "info");

  return {
    passed: blockers.length === 0,
    violations,
    blockers,
    warnings,
    info,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Get all builtin policies.
 */
export function getBuiltinPolicies(): MigrationPolicy[] {
  return [...BUILTIN_POLICIES];
}

/**
 * Create a custom policy.
 */
export function createPolicy(
  id: string,
  name: string,
  description: string,
  severity: MigrationPolicy["severity"],
  evaluate: MigrationPolicy["evaluate"],
): MigrationPolicy {
  return { id, name, description, severity, evaluate };
}
