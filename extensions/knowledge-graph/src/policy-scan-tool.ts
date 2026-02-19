/**
 * Knowledge Graph × Policy Engine — Cross-Extension Scanning Tool
 *
 * Walks KG nodes through the policy engine and reports violations.
 * Bridges the Knowledge Graph and Policy Engine extensions so an agent
 * can ask "which infrastructure resources violate my policies?"
 */

import { Type } from "@sinclair/typebox";
import type { EspadaPluginApi } from "espada/plugin-sdk";
import { stringEnum } from "espada/plugin-sdk";
import type { GraphStorage, NodeFilter, CloudProvider, GraphResourceType } from "./types.js";

// ── Local type mirrors (avoids cross-extension rootDir violations) ───────────

type PolicySeverity = "critical" | "high" | "medium" | "low" | "info";

type RuleCondition =
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

type PolicyRule = {
  id: string;
  description: string;
  condition: RuleCondition;
  action: "deny" | "warn" | "require_approval" | "notify";
  message: string;
};

type PolicyDefinition = {
  id: string;
  name: string;
  description: string;
  type: string;
  enabled: boolean;
  severity: PolicySeverity;
  labels: string[];
  autoAttachPatterns: string[];
  rules: PolicyRule[];
  createdAt: string;
  updatedAt: string;
};

type ResourceInput = {
  id: string;
  type: string;
  provider: string;
  region: string;
  name: string;
  status: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
};

type PolicyViolation = {
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

const PROVIDERS = ["aws", "azure", "gcp", "kubernetes", "custom"] as const;

/**
 * Convert a KG GraphNode into a PolicyEngine ResourceInput.
 */
function nodeToResourceInput(node: {
  id: string;
  name: string;
  provider: string;
  resourceType: string;
  region: string;
  status: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  account?: string;
}): ResourceInput {
  return {
    id: node.id,
    type: node.resourceType,
    provider: node.provider,
    region: node.region,
    name: node.name,
    status: node.status,
    tags: node.tags ?? {},
    metadata: node.metadata ?? {},
  };
}

/**
 * Register the `kg_policy_scan` tool that scans KG nodes against policies.
 *
 * @param api - Plugin API for tool registration
 * @param storage - Knowledge Graph storage for querying nodes
 * @param getPolicies - Callback that returns current policy list
 */
export function registerPolicyScanTool(
  api: EspadaPluginApi,
  storage: GraphStorage,
  getPolicies: () => Promise<PolicyDefinition[]>,
): void {
  api.registerTool(
    {
      name: "kg_policy_scan",
      label: "KG Policy Scan",
      description:
        "Scan infrastructure resources in the Knowledge Graph against registered policies. " +
        "Returns violations grouped by severity. Use to audit infrastructure compliance " +
        "with organizational policies (tag requirements, region restrictions, cost limits, etc.).",
      parameters: Type.Object({
        provider: Type.Optional(
          stringEnum(PROVIDERS, {
            description: "Filter nodes by cloud provider",
          }),
        ),
        resourceType: Type.Optional(
          Type.String({
            description: "Filter nodes by resource type (e.g. compute, database, storage)",
          }),
        ),
        policyType: Type.Optional(
          Type.String({
            description: "Filter policies by type (e.g. access, cost, drift, deployment)",
          }),
        ),
        severity: Type.Optional(
          Type.String({
            description: "Minimum severity to report (critical, high, medium, low, info)",
          }),
        ),
        limit: Type.Optional(
          Type.Number({
            description: "Max number of nodes to scan (default: 500)",
          }),
        ),
      }),

      async execute(_toolCallId, params) {
        const {
          provider,
          resourceType,
          policyType,
          severity,
          limit,
        } = params as {
          provider?: string;
          resourceType?: string;
          policyType?: string;
          severity?: string;
          limit?: number;
        };

        // 1. Query KG nodes with optional filters
        const filter: NodeFilter = {};
        if (provider) filter.provider = provider as CloudProvider;
        if (resourceType) filter.resourceType = resourceType as GraphResourceType;

        const nodes = await storage.queryNodes(filter);
        const scanLimit = Math.min(limit ?? 500, 1000);
        const nodesToScan = nodes.slice(0, scanLimit);

        // 2. Get policies, optionally filtered by type
        let policies = await getPolicies();
        if (policyType) {
          policies = policies.filter((p) => p.type === policyType);
        }

        if (policies.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No policies found to evaluate." }],
            details: { nodesScanned: 0, violations: 0 },
          };
        }

        if (nodesToScan.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No resources found matching the specified filters." }],
            details: { nodesScanned: 0, violations: 0 },
          };
        }

        // 3. Convert KG nodes to policy-engine ResourceInputs
        const resources = nodesToScan.map(nodeToResourceInput);

        // 4. Scan all resources against all policies
        const violations = scanResources(policies, resources);

        // 5. Filter by severity if specified
        const severityOrder = ["critical", "high", "medium", "low", "info"];
        let filtered = violations;
        if (severity) {
          const minIndex = severityOrder.indexOf(severity);
          if (minIndex >= 0) {
            filtered = violations.filter((v) => {
              const idx = severityOrder.indexOf(v.severity);
              return idx >= 0 && idx <= minIndex;
            });
          }
        }

        // 6. Group violations by severity for reporting
        const bySeverity: Record<string, PolicyViolation[]> = {};
        for (const v of filtered) {
          (bySeverity[v.severity] ??= []).push(v);
        }

        // 7. Build summary
        const lines: string[] = [
          `## Policy Scan Results`,
          "",
          `**Nodes scanned:** ${nodesToScan.length}`,
          `**Policies evaluated:** ${policies.length}`,
          `**Total violations:** ${filtered.length}`,
          "",
        ];

        if (filtered.length === 0) {
          lines.push("All resources passed policy checks.");
        } else {
          lines.push("### Violations by Severity", "");

          for (const sev of severityOrder) {
            const group = bySeverity[sev];
            if (!group || group.length === 0) continue;

            const icon = sev === "critical" ? "🔴"
              : sev === "high" ? "🟠"
              : sev === "medium" ? "🟡"
              : sev === "low" ? "🔵"
              : "⚪";

            lines.push(`#### ${icon} ${sev.toUpperCase()} (${group.length})`, "");
            lines.push("| Resource | Type | Policy | Rule | Message |");
            lines.push("|----------|------|--------|------|---------|");

            for (const v of group.slice(0, 20)) {
              lines.push(
                `| ${v.resourceName} | ${v.resourceType} | ${v.policyName} | ${v.ruleDescription} | ${v.message} |`,
              );
            }

            if (group.length > 20) {
              lines.push(`| ... | ... | ... | ... | +${group.length - 20} more |`);
            }

            lines.push("");
          }

          // Top violated policies
          const policyViolationCount = new Map<string, number>();
          for (const v of filtered) {
            policyViolationCount.set(v.policyName, (policyViolationCount.get(v.policyName) ?? 0) + 1);
          }
          const topPolicies = [...policyViolationCount.entries()]
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);

          if (topPolicies.length > 0) {
            lines.push("### Top Violated Policies", "");
            for (const [name, count] of topPolicies) {
              lines.push(`- **${name}**: ${count} violation${count > 1 ? "s" : ""}`);
            }
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            nodesScanned: nodesToScan.length,
            policiesEvaluated: policies.length,
            totalViolations: filtered.length,
            bySeverity: Object.fromEntries(
              Object.entries(bySeverity).map(([k, v]) => [k, v.length]),
            ),
          },
        };
      },
    },
    { names: ["kg_policy_scan"] },
  );
}

// ─── Inline policy scanning (avoids cross-extension import) ────────────────

function getField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateCondition(
  cond: RuleCondition,
  flat: Record<string, unknown>,
  resource: ResourceInput,
): boolean {
  switch (cond.type) {
    case "field_equals": return getField(flat, cond.field) === cond.value;
    case "field_not_equals": return getField(flat, cond.field) !== cond.value;
    case "field_contains": return String(getField(flat, cond.field) ?? "").includes(cond.value);
    case "field_matches": return new RegExp(cond.pattern).test(String(getField(flat, cond.field) ?? ""));
    case "field_gt": return Number(getField(flat, cond.field)) > cond.value;
    case "field_lt": return Number(getField(flat, cond.field)) < cond.value;
    case "field_exists": return getField(flat, cond.field) !== undefined;
    case "field_not_exists": return getField(flat, cond.field) === undefined;
    case "field_in": return (cond.values as unknown[]).includes(getField(flat, cond.field));
    case "field_not_in": return !(cond.values as unknown[]).includes(getField(flat, cond.field));
    case "tag_missing": return !(cond.tag in resource.tags);
    case "tag_equals": return resource.tags[cond.tag] === cond.value;
    case "and": return cond.conditions.every((c) => evaluateCondition(c, flat, resource));
    case "or": return cond.conditions.some((c) => evaluateCondition(c, flat, resource));
    case "not": return !evaluateCondition(cond.condition, flat, resource);
    case "resource_type": return resource.type === cond.resourceType;
    case "provider": return resource.provider === cond.provider;
    case "region": return resource.region === cond.region;
    case "custom": return false; // Custom evaluators not supported in inline mode
  }
}

function flattenResource(resource: ResourceInput): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    resource,
    "resource.id": resource.id,
    "resource.type": resource.type,
    "resource.provider": resource.provider,
    "resource.region": resource.region,
    "resource.name": resource.name,
    "resource.status": resource.status,
    "resource.tags": resource.tags,
    "resource.metadata": resource.metadata,
  };
  for (const [k, v] of Object.entries(resource.tags)) flat[`resource.tags.${k}`] = v;
  for (const [k, v] of Object.entries(resource.metadata)) flat[`resource.metadata.${k}`] = v;
  return flat;
}

function policyApplies(policy: PolicyDefinition, resource: ResourceInput): boolean {
  if (policy.autoAttachPatterns.length === 0) return true;
  for (const pattern of policy.autoAttachPatterns) {
    if (pattern === "*") return true;
    const [key, value] = pattern.split(":");
    if (key === "provider" && resource.provider === value) return true;
    if (key === "type" && resource.type === value) return true;
    if (key === "region" && resource.region === value) return true;
    if (key === "tag") {
      const [tagKey, tagValue] = (value ?? "").split("=");
      if (tagValue ? resource.tags[tagKey!] === tagValue : tagKey! in resource.tags) return true;
    }
  }
  return false;
}

function scanResources(policies: PolicyDefinition[], resources: ResourceInput[]): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  for (const resource of resources) {
    const flat = flattenResource(resource);
    for (const policy of policies) {
      if (!policy.enabled || !policyApplies(policy, resource)) continue;
      for (const rule of policy.rules) {
        if (evaluateCondition(rule.condition, flat, resource)) {
          violations.push({
            policyId: policy.id,
            policyName: policy.name,
            ruleId: rule.id,
            ruleDescription: rule.description,
            severity: policy.severity,
            action: rule.action,
            message: rule.message,
            resourceId: resource.id,
            resourceType: resource.type,
            resourceName: resource.name,
            provider: resource.provider,
          });
        }
      }
    }
  }
  return violations;
}
