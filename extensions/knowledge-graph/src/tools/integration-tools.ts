/**
 * Integration Agent Tools — MCP tools that expose integration bridges
 *
 * These tools allow the AI agent to leverage enterprise capabilities from
 * sibling extensions via the Knowledge Graph's integration layer.
 */

import { Type } from "@sinclair/typebox";
import type { EspadaPluginApi } from "espada/plugin-sdk";
import { stringEnum } from "espada/plugin-sdk";
import type { IntegrationManager } from "../integrations/index.js";
import { formatComplianceBridgeMarkdown } from "../integrations/compliance-bridge.js";
import { formatTerraformBridgeMarkdown } from "../integrations/terraform-bridge.js";
import type { ComplianceFrameworkId } from "../integrations/types.js";

// =============================================================================
// Constants
// =============================================================================

const COMPLIANCE_FRAMEWORKS = [
  "soc2", "cis", "hipaa", "pci-dss", "gdpr", "nist-800-53",
] as const;

const PROVIDERS = ["aws", "azure", "gcp", "k8s", "custom"] as const;

// =============================================================================
// Tool Registration
// =============================================================================

export function registerIntegrationTools(
  api: EspadaPluginApi,
  mgr: IntegrationManager,
): void {

  // ---------------------------------------------------------------------------
  // 1. Integration Status
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_integration_status",
      label: "Integration Status",
      description:
        "Show which enterprise extensions are available and integrated with " +
        "the Knowledge Graph (auth, audit, compliance, policy, cost, terraform, alerting).",
      parameters: Type.Object({}),
      async execute() {
        const a = mgr.available;
        const lines = [
          "## Knowledge Graph — Enterprise Integrations",
          "",
          "| Extension | Available | Description |",
          "|-----------|-----------|-------------|",
          `| Enterprise Auth | ${a.enterpriseAuth ? "✅" : "❌"} | RBAC permission enforcement on all graph operations |`,
          `| Audit Trail | ${a.auditTrail ? "✅" : "❌"} | Immutable audit log with buffered writes & redaction |`,
          `| Compliance | ${a.compliance ? "✅" : "❌"} | Multi-framework compliance evaluation (SOC2, CIS, HIPAA, etc.) |`,
          `| Policy Engine | ${a.policyEngine ? "✅" : "❌"} | Topology-aware policy evaluation with graph context |`,
          `| Cost Governance | ${a.costGovernance ? "✅" : "❌"} | Budget tracking, cost attribution & anomaly detection |`,
          `| Terraform | ${a.terraform ? "✅" : "❌"} | 130+ resource type mappings, state sync & diff |`,
          `| Alerting | ${a.alertingIntegration ? "✅" : "❌"} | Alert routing to Slack, PagerDuty, OpsGenie, etc. |`,
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: { available: a, summary: mgr.availableSummary },
        };
      },
    },
    { names: ["kg_integration_status"] },
  );

  // ---------------------------------------------------------------------------
  // 2. Enterprise Compliance
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_enterprise_compliance",
      label: "Enterprise Compliance",
      description:
        "Evaluate infrastructure compliance against enterprise frameworks " +
        "(SOC2, CIS, HIPAA, PCI-DSS, GDPR, NIST-800-53). " +
        "Uses the compliance extension if available, falls back to built-in rules.",
      parameters: Type.Object({
        framework: Type.Optional(
          stringEnum(COMPLIANCE_FRAMEWORKS, {
            description: "Specific framework to evaluate. Omit to evaluate all.",
          }),
        ),
        provider: Type.Optional(
          stringEnum(PROVIDERS, {
            description: "Filter resources by cloud provider",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { framework, provider } = params as {
          framework?: ComplianceFrameworkId;
          provider?: string;
        };

        const filter = provider ? { provider: provider as import("../../src/types.js").CloudProvider } : undefined;

        if (framework) {
          const result = await mgr.compliance.evaluate(framework, filter);
          return {
            content: [{ type: "text" as const, text: formatComplianceBridgeMarkdown(result) }],
            details: result,
          };
        }

        const results = await mgr.compliance.evaluateAll(filter);
        const resultsArr = [...results.values()];
        const combined = resultsArr.map(formatComplianceBridgeMarkdown).join("\n\n---\n\n");
        return {
          content: [{ type: "text" as const, text: combined }],
          details: { frameworks: resultsArr.length, results: resultsArr },
        };
      },
    },
    { names: ["kg_enterprise_compliance"] },
  );

  // ---------------------------------------------------------------------------
  // 3. Policy Check
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_policy_check",
      label: "Policy Check",
      description:
        "Evaluate policies against a specific resource in the knowledge graph. " +
        "Automatically enriches the evaluation with graph context (neighbors, " +
        "blast radius, dependency depth) for topology-aware decisions.",
      parameters: Type.Object({
        nodeId: Type.String({
          description: "The graph node ID of the resource to evaluate",
        }),
        blastRadiusDepth: Type.Optional(
          Type.Number({
            description: "Blast radius depth for graph context (default: 3)",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { nodeId, blastRadiusDepth } = params as {
          nodeId: string;
          blastRadiusDepth?: number;
        };

        const result = await mgr.policy.evaluateNode(nodeId, {
          blastRadiusDepth: blastRadiusDepth ?? 3,
        });

        if (!result) {
          return {
            content: [{
              type: "text" as const,
              text: `Node \`${nodeId}\` not found or policy engine not available.`,
            }],
            details: null,
          };
        }

        const status = result.denied ? "DENIED" : result.approvalRequired ? "APPROVAL REQUIRED" : "ALLOWED";
        const lines = [
          `## Policy Check: ${nodeId}`,
          "",
          `**Status:** ${status}`,
          `**Policies evaluated:** ${result.totalPolicies}`,
          `**Passed:** ${result.passedPolicies} | **Failed:** ${result.failedPolicies}`,
          "",
          ...(result.denials.length > 0 ? ["### Denials", ...result.denials.map((d: string) => `- ${d}`), ""] : []),
          ...(result.warnings.length > 0 ? ["### Warnings", ...result.warnings.map((w: string) => `- ${w}`), ""] : []),
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: result,
        };
      },
    },
    { names: ["kg_policy_check"] },
  );

  // ---------------------------------------------------------------------------
  // 4. Pre-Mutation Policy Check
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_pre_mutation_check",
      label: "Pre-Mutation Check",
      description:
        "Check if a proposed mutation (create, update, delete) on a resource " +
        "would be allowed by the policy engine. For deletes, automatically " +
        "includes blast radius context.",
      parameters: Type.Object({
        nodeId: Type.String({
          description: "The graph node ID of the target resource",
        }),
        operation: stringEnum(["create", "update", "delete"], {
          description: "The proposed operation",
        }),
        actor: Type.Optional(
          Type.String({
            description: "Actor performing the mutation (user ID)",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { nodeId, operation, actor } = params as {
          nodeId: string;
          operation: "create" | "update" | "delete";
          actor?: string;
        };

        const actorObj = actor ? { id: actor, roles: [], groups: [] } : undefined;
        const result = await mgr.policy.preMutationCheck(nodeId, operation, actorObj);

        if (!result) {
          return {
            content: [{
              type: "text" as const,
              text: `Policy engine not available or node \`${nodeId}\` not found.`,
            }],
            details: null,
          };
        }

        const hasDenials = result.denials.length > 0;
        const status = hasDenials ? "🚫 DENIED" : result.approvalRequired ? "⚠️ APPROVAL REQUIRED" : "✅ ALLOWED";
        const lines = [
          `## Pre-Mutation Check: ${operation} on ${nodeId}`,
          "",
          `**Status:** ${status}`,
          `**Allowed:** ${result.allowed}`,
          "",
          ...(result.denials.length > 0
            ? ["### Denials", ...result.denials.map((d: string) => `- ${d}`), ""]
            : []),
          ...(result.warnings.length > 0
            ? ["### Warnings", ...result.warnings.map((w: string) => `- ${w}`), ""]
            : []),
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: result,
        };
      },
    },
    { names: ["kg_pre_mutation_check"] },
  );

  // ---------------------------------------------------------------------------
  // 5. Cost Impact
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_cost_impact",
      label: "Cost Impact Analysis",
      description:
        "Analyze the cost impact of a resource and its blast radius. " +
        "Shows direct cost, downstream cost, and links to budget status.",
      parameters: Type.Object({
        nodeId: Type.String({
          description: "The graph node ID of the resource",
        }),
        depth: Type.Optional(
          Type.Number({
            description: "Blast radius depth for cost analysis (default: 3)",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { nodeId, depth } = params as { nodeId: string; depth?: number };
        const result = await mgr.cost.getCostImpact(nodeId, depth ?? 3);

        if (!result) {
          return {
            content: [{
              type: "text" as const,
              text: `Node \`${nodeId}\` not found.`,
            }],
            details: null,
          };
        }

        const lines = [
          `## Cost Impact: ${nodeId}`,
          "",
          `**Direct cost:** $${result.directCost.toFixed(2)}/mo`,
          `**Blast radius cost:** $${result.blastRadiusCost.toFixed(2)}/mo`,
          `**Total impact:** $${result.totalImpact.toFixed(2)}/mo`,
          "",
          "### Affected Resources",
          "| Resource | Cost/mo | Hop |",
          "|----------|---------|-----|",
          ...result.affectedNodes.map(
            (n: { id: string; name: string; cost: number; hop: number }) =>
              `| ${n.name} | $${n.cost.toFixed(2)} | ${n.hop} |`,
          ),
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: result,
        };
      },
    },
    { names: ["kg_cost_impact"] },
  );

  // ---------------------------------------------------------------------------
  // 6. Cost Summary
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_cost_summary",
      label: "Cost Summary",
      description:
        "Get a cost summary across all infrastructure in the knowledge graph, " +
        "broken down by provider, resource type, account, and region. " +
        "Also shows budget status if the cost-governance extension is available.",
      parameters: Type.Object({
        provider: Type.Optional(
          stringEnum(PROVIDERS, {
            description: "Filter by cloud provider",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { provider } = params as { provider?: string };
        const filter = provider ? { provider: provider as import("../../src/types.js").CloudProvider } : undefined;
        const summary = await mgr.cost.getCostSummary(filter);

        const lines = [
          "## Cost Summary",
          "",
          `**Total monthly cost:** $${summary.totalMonthly.toFixed(2)}`,
          `**Resources tracked:** ${summary.nodeCount}`,
          "",
          "### By Provider",
          "| Provider | Cost/mo |",
          "|----------|---------|",
          ...Object.entries(summary.byProvider).map(
            ([p, cost]) => `| ${p} | $${cost.toFixed(2)} |`,
          ),
        ];

        // Add budget status if available
        const budgets = mgr.cost.getBudgets();
        if (budgets.length > 0) {
          lines.push("", "### Budget Status", "| Budget | Limit | Spend | Status |", "|--------|-------|-------|--------|");
          for (const b of budgets) {
            const pct = ((b.currentSpend / b.monthlyLimit) * 100).toFixed(0);
            const icon = b.status === "exceeded" ? "🔴" : b.status === "critical" ? "🟠" : b.status === "warning" ? "🟡" : "🟢";
            lines.push(`| ${b.name} | $${b.monthlyLimit.toFixed(0)} | $${b.currentSpend.toFixed(0)} (${pct}%) | ${icon} ${b.status.toUpperCase()} |`);
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: summary,
        };
      },
    },
    { names: ["kg_cost_summary"] },
  );

  // ---------------------------------------------------------------------------
  // 7. Terraform State Diff
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_terraform_diff",
      label: "Terraform State Diff",
      description:
        "Compare knowledge graph state with Terraform state to find resources " +
        "that exist in Terraform but not the graph, or vice versa.",
      parameters: Type.Object({
        resources: Type.Optional(
          Type.Array(Type.Any(), {
            description: "Terraform parsed resources array. If omitted, " +
              "uses existing terraform-managed nodes in the graph.",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { resources } = params as { resources?: any[] };

        if (!resources || resources.length === 0) {
          const managed = await mgr.terraform.getTerraformManagedNodes();
          const lines = [
            "## Terraform-Managed Resources in Graph",
            "",
            `**Count:** ${managed.length}`,
            "",
            "| Resource | Type | Provider | TF Address |",
            "|----------|------|----------|------------|",
            ...managed.slice(0, 50).map(
              (n) => `| ${n.name} | ${n.resourceType} | ${n.provider} | ${n.metadata.terraformAddress ?? "—"} |`,
            ),
            ...(managed.length > 50 ? [`\n*...and ${managed.length - 50} more*`] : []),
          ];

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            details: { count: managed.length },
          };
        }

        const diff = await mgr.terraform.diffState(resources);
        return {
          content: [{ type: "text" as const, text: formatTerraformBridgeMarkdown(undefined, diff) }],
          details: diff,
        };
      },
    },
    { names: ["kg_terraform_diff"] },
  );

  // ---------------------------------------------------------------------------
  // 8. Drift Detection + Alerting
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_drift_alert",
      label: "Drift Detection & Alert",
      description:
        "Run drift detection on the knowledge graph and automatically send " +
        "alerts (if alerting extension is available). Returns drift summary " +
        "and alert dispatch status.",
      parameters: Type.Object({}),
      async execute() {
        const result = await mgr.detectDriftAndAlert();

        const lines = [
          "## Drift Detection Result",
          "",
          `**Drifted resources:** ${result.driftedCount}`,
          `**Disappeared resources:** ${result.disappearedCount}`,
          `**Alerts sent:** ${result.alertsSent}`,
          "",
          result.driftedCount === 0 && result.disappearedCount === 0
            ? "✅ No drift detected — infrastructure matches expected state."
            : "⚠️ Drift detected — review drifted resources and consider remediation.",
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: result,
        };
      },
    },
    { names: ["kg_drift_alert"] },
  );

  // ---------------------------------------------------------------------------
  // 9. Full Enterprise Compliance + Alerting
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_compliance_audit",
      label: "Compliance Audit",
      description:
        "Run a full compliance audit across all frameworks, optionally " +
        "sending alerts for critical/high violations. Returns a comprehensive " +
        "compliance report with scores, violations, and remediation guidance.",
      parameters: Type.Object({
        alertOnViolations: Type.Optional(
          Type.Boolean({
            description: "Send alerts for critical/high violations (default: true)",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { alertOnViolations } = params as { alertOnViolations?: boolean };

        const { results, alertsSent } = await mgr.evaluateComplianceAndAlert({
          alertOnViolations: alertOnViolations ?? true,
        });

        const resultsArr = [...results.values()];

        const summary = mgr.compliance.getComplianceSummary
          ? await mgr.compliance.getComplianceSummary()
          : null;

        const lines = [
          "## Compliance Audit Report",
          "",
          `**Frameworks evaluated:** ${resultsArr.length}`,
          `**Alerts sent:** ${alertsSent}`,
          "",
          "### Framework Scores",
          "| Framework | Score | Passed | Failed | Waived |",
          "|-----------|-------|--------|--------|--------|",
          ...resultsArr.map(
            (r) => `| ${r.framework} | ${r.score.toFixed(0)}% | ${r.passedControls} | ${r.failedControls} | ${r.waivedControls} |`,
          ),
        ];

        if (summary) {
          lines.push(
            "",
            "### Summary",
            `**Average score:** ${summary.averageScore?.toFixed(0) ?? "—"}%`,
            `**Total violations:** ${summary.totalViolations ?? "—"}`,
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: { results: resultsArr, alertsSent, summary },
        };
      },
    },
    { names: ["kg_compliance_audit"] },
  );
}
