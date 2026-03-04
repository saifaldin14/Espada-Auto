/**
 * GCP Policy Manager
 *
 * Manages Organization Policy constraints and custom policies
 * using the Organization Policy API v2.
 */

import type { GcpRetryOptions, GcpOperationResult } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

export type PolicyConstraintType = "boolean" | "list";

export type PolicyConstraint = {
  name: string;
  displayName: string;
  description: string;
  constraintType: PolicyConstraintType;
  listConstraint?: {
    supportsIn: boolean;
    supportsUnder: boolean;
  };
  booleanConstraint?: Record<string, never>;
};

export type PolicyRuleEnforce = {
  enforce: boolean;
};

export type PolicyRuleValues = {
  allowedValues?: string[];
  deniedValues?: string[];
};

export type PolicyCondition = {
  expression: string;
  title?: string;
  description?: string;
};

export type PolicyRule = {
  values?: PolicyRuleValues;
  enforce?: boolean;
  condition?: PolicyCondition;
};

export type OrgPolicy = {
  name: string;
  constraint: string;
  rules: PolicyRule[];
  dryRunRules?: PolicyRule[];
  etag: string;
};

export type SetPolicyOptions = {
  constraint: string;
  rules: PolicyRule[];
  dryRunRules?: PolicyRule[];
};

export type PolicyViolation = {
  constraint: string;
  resource: string;
  resourceType: string;
  violationMessage: string;
  severity: "critical" | "high" | "medium" | "low";
};

export type PolicyComplianceReport = {
  projectId: string;
  timestamp: string;
  totalPolicies: number;
  compliant: number;
  nonCompliant: number;
  violations: PolicyViolation[];
};

export type CustomConstraint = {
  name: string;
  resourceTypes: string[];
  methodTypes: Array<"CREATE" | "UPDATE" | "DELETE">;
  condition: string;
  actionType: "ALLOW" | "DENY";
  displayName: string;
  description: string;
};

// =============================================================================
// Manager
// =============================================================================

const POLICY_BASE = "https://orgpolicy.googleapis.com/v2";

export class GcpPolicyManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(
    projectId: string,
    getAccessToken: () => Promise<string>,
    retryOptions?: GcpRetryOptions,
  ) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = {
      ...(retryOptions ?? {}),
      service: "policy",
      projectId: this.projectId,
    };
  }

  // ---------------------------------------------------------------------------
  // Constraints
  // ---------------------------------------------------------------------------

  async listConstraints(): Promise<PolicyConstraint[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${POLICY_BASE}/projects/${this.projectId}/constraints`;
      const items = await gcpList<Record<string, unknown>>(url, token, "constraints");
      return items.map((c) => ({
        name: String(c.name ?? ""),
        displayName: String(c.displayName ?? ""),
        description: String(c.description ?? ""),
        constraintType: c.listConstraint ? "list" as const : "boolean" as const,
        listConstraint: c.listConstraint
          ? {
              supportsIn: Boolean((c.listConstraint as Record<string, unknown>).supportsIn),
              supportsUnder: Boolean((c.listConstraint as Record<string, unknown>).supportsUnder),
            }
          : undefined,
        booleanConstraint: c.booleanConstraint ? {} : undefined,
      }));
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Policies
  // ---------------------------------------------------------------------------

  async listPolicies(): Promise<OrgPolicy[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${POLICY_BASE}/projects/${this.projectId}/policies`;
      const items = await gcpList<Record<string, unknown>>(url, token, "policies");
      return items.map((p) => this.mapPolicy(p));
    }, this.retryOptions);
  }

  async getPolicy(constraintName: string): Promise<OrgPolicy> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const encoded = encodeURIComponent(constraintName);
      const url = `${POLICY_BASE}/projects/${this.projectId}/policies/${encoded}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapPolicy(raw);
    }, this.retryOptions);
  }

  async setPolicy(opts: SetPolicyOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const encoded = encodeURIComponent(opts.constraint);
      const url = `${POLICY_BASE}/projects/${this.projectId}/policies/${encoded}`;
      const body = {
        policy: {
          name: `projects/${this.projectId}/policies/${opts.constraint}`,
          spec: {
            rules: opts.rules.map((r) => this.serializeRule(r)),
          },
        },
      };
      if (opts.dryRunRules?.length) {
        (body.policy as Record<string, unknown>).dryRunSpec = {
          rules: opts.dryRunRules.map((r) => this.serializeRule(r)),
        };
      }
      await gcpMutate(url, token, body, "PATCH");
      return {
        success: true,
        message: `Policy for constraint "${opts.constraint}" updated`,
      };
    }, this.retryOptions);
  }

  async deletePolicy(constraintName: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const encoded = encodeURIComponent(constraintName);
      const url = `${POLICY_BASE}/projects/${this.projectId}/policies/${encoded}`;
      const result = await gcpMutate(url, token, undefined, "DELETE");
      return { success: true, message: result.message };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Custom constraints
  // ---------------------------------------------------------------------------

  async listCustomConstraints(organizationId: string): Promise<CustomConstraint[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${POLICY_BASE}/organizations/${organizationId}/customConstraints`;
      const items = await gcpList<Record<string, unknown>>(url, token, "customConstraints");
      return items.map((c) => ({
        name: String(c.name ?? ""),
        resourceTypes: (c.resourceTypes ?? []) as string[],
        methodTypes: (c.methodTypes ?? []) as CustomConstraint["methodTypes"],
        condition: String(c.condition ?? ""),
        actionType: (c.actionType as CustomConstraint["actionType"]) ?? "DENY",
        displayName: String(c.displayName ?? ""),
        description: String(c.description ?? ""),
      }));
    }, this.retryOptions);
  }

  async createCustomConstraint(
    organizationId: string,
    constraint: Omit<CustomConstraint, "name">,
  ): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${POLICY_BASE}/organizations/${organizationId}/customConstraints`;
      const result = await gcpMutate(url, token, constraint);
      return { success: true, message: "Custom constraint created", operationId: result.operationId };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Compliance check
  // ---------------------------------------------------------------------------

  /**
   * Evaluate effective policies for the project and report potential violations.
   *
   * For **boolean** constraints, checks whether the constraint is enforced
   * vs. not enforced. For **list** constraints, queries the effective policy
   * from the API (which resolves the entire resource hierarchy) and then
   * reports any deny-list entries that are actively blocking values.
   *
   * > NOTE: This reports *policy-level* warnings — it does NOT inspect every
   * > individual resource in the project to see if it violates a constraint.
   * > Full resource-level compliance scanning requires Security Command Center
   * > or Config Validator and is out of scope for this module.
   */
  async checkCompliance(): Promise<PolicyComplianceReport> {
    const policies = await this.listPolicies();
    const constraints = await this.listConstraints();
    const constraintMap = new Map(constraints.map((c) => [c.name, c]));
    const violations: PolicyViolation[] = [];

    for (const policy of policies) {
      const constraint = constraintMap.get(policy.constraint);

      // Boolean constraint — flag if enforcement is set (potential blocker)
      if (constraint?.constraintType === "boolean") {
        const enforced = policy.rules.some((r) => r.enforce === true);
        if (enforced) {
          violations.push({
            constraint: policy.constraint,
            resource: `projects/${this.projectId}`,
            resourceType: "project",
            violationMessage: `Boolean constraint "${policy.constraint}" is enforced — resources violating this constraint will be blocked`,
            severity: "high",
          });
        }
        continue;
      }

      // List constraint — query the effective policy for hierarchy-resolved values
      try {
        const effective = await this.getEffectivePolicy(policy.constraint);
        for (const rule of effective.rules) {
          if (rule.values?.deniedValues?.length) {
            violations.push({
              constraint: policy.constraint,
              resource: `projects/${this.projectId}`,
              resourceType: "project",
              violationMessage: `Effective policy for "${policy.constraint}" actively denies values: [${rule.values.deniedValues.join(", ")}]`,
              severity: "medium",
            });
          }
        }
      } catch {
        // Fall back to inspecting the policy directly when effective policy
        // endpoint is unavailable (e.g. missing permissions).
        for (const rule of policy.rules) {
          if (rule.values?.deniedValues?.length) {
            violations.push({
              constraint: policy.constraint,
              resource: `projects/${this.projectId}`,
              resourceType: "project",
              violationMessage: `Constraint "${policy.constraint}" has deny rules — verify that denied values [${rule.values.deniedValues.join(", ")}] are not in use`,
              severity: "medium",
            });
          }
        }
      }
    }

    return {
      projectId: this.projectId,
      timestamp: new Date().toISOString(),
      totalPolicies: policies.length,
      compliant: policies.length - violations.length,
      nonCompliant: violations.length,
      violations,
    };
  }

  // ---------------------------------------------------------------------------
  // Effective policy (hierarchy-resolved)
  // ---------------------------------------------------------------------------

  async getEffectivePolicy(constraintName: string): Promise<OrgPolicy> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const encoded = encodeURIComponent(constraintName);
      const url = `${POLICY_BASE}/projects/${this.projectId}/policies/${encoded}:getEffectivePolicy`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapPolicy(raw);
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private mapPolicy(raw: Record<string, unknown>): OrgPolicy {
    const spec = (raw.spec ?? raw) as Record<string, unknown>;
    const dryRunSpec = raw.dryRunSpec as Record<string, unknown> | undefined;

    const mapRules = (rules: unknown[]): PolicyRule[] =>
      (rules as Array<Record<string, unknown>>).map((r) => {
        const values = r.values as Record<string, unknown> | undefined;
        return {
          enforce: r.enforce !== undefined ? Boolean(r.enforce) : undefined,
          values: values
            ? {
                allowedValues: (values.allowedValues ?? []) as string[],
                deniedValues: (values.deniedValues ?? []) as string[],
              }
            : undefined,
          condition: r.condition
            ? {
                expression: String((r.condition as Record<string, unknown>).expression ?? ""),
                title: (r.condition as Record<string, unknown>).title
                  ? String((r.condition as Record<string, unknown>).title)
                  : undefined,
                description: (r.condition as Record<string, unknown>).description
                  ? String((r.condition as Record<string, unknown>).description)
                  : undefined,
              }
            : undefined,
        };
      });

    return {
      name: String(raw.name ?? ""),
      constraint: String(raw.name ?? "").split("/").pop() ?? "",
      rules: mapRules((spec.rules ?? []) as unknown[]),
      dryRunRules: dryRunSpec
        ? mapRules((dryRunSpec.rules ?? []) as unknown[])
        : undefined,
      etag: String(spec.etag ?? raw.etag ?? ""),
    };
  }

  private serializeRule(rule: PolicyRule): Record<string, unknown> {
    const serialized: Record<string, unknown> = {};
    if (rule.enforce !== undefined) serialized.enforce = rule.enforce;
    if (rule.values) serialized.values = rule.values;
    if (rule.condition) serialized.condition = rule.condition;
    return serialized;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createPolicyManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpPolicyManager {
  return new GcpPolicyManager(projectId, getAccessToken, retryOptions);
}
