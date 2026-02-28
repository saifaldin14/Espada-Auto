/**
 * Standalone Tool Registry
 *
 * Collects all 31 knowledge graph tools into a plain registry
 * without depending on EspadaPluginApi. Used by the MCP server
 * and standalone CLI.
 */

import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import { GraphEngine } from "../core/engine.js";
import type { GraphStorage, CloudProvider } from "../types.js";
import {
  shortestPath,
  findOrphans,
  findSinglePointsOfFailure,
} from "../core/queries.js";
import { exportTopology } from "../reporting/export.js";
import type { TemporalGraphStorage } from "../core/temporal.js";
import {
  takeSnapshot,
  getTopologyAt,
  getNodeHistory as getNodeHistoryFn,
  diffSnapshots as diffSnapshotsFn,
  diffTimestamps,
  getEvolutionSummary,
} from "../core/temporal.js";
import { parseIQL, executeQuery, IQLSyntaxError } from "../iql/index.js";
import type { IQLExecutorOptions } from "../iql/index.js";
import {
  runComplianceAssessment,
  formatComplianceMarkdown,
  SUPPORTED_FRAMEWORKS,
} from "../analysis/compliance.js";
import type { ComplianceFramework } from "../analysis/compliance.js";
import {
  generateRecommendations,
  formatRecommendationsMarkdown,
} from "../analysis/recommendations.js";
import {
  generateAgentReport,
  formatAgentReportMarkdown,
} from "../analysis/agent-model.js";
import { translateNLToIQL, getExampleQueries } from "../analysis/nl-translator.js";
import {
  generateRemediationPlan,
  formatRemediationMarkdown,
} from "../analysis/remediation.js";
import type { IaCFormat } from "../analysis/remediation.js";
import {
  generateSupplyChainReport,
  formatSupplyChainMarkdown,
} from "../analysis/supply-chain.js";
import { exportVisualization } from "../analysis/visualization.js";
import type { VisualizationFormat, LayoutStrategy } from "../analysis/visualization.js";
import {
  createRBACPolicy,
  formatRBACPolicyMarkdown,
  getRolePermissions,
} from "../core/rbac.js";
import type { RBACRole } from "../core/rbac.js";
import {
  runBenchmarks,
  formatBenchmarkMarkdown,
} from "../core/benchmark.js";
import type { BenchmarkScale } from "../core/benchmark.js";
import {
  exportExtended,
} from "../reporting/export-extended.js";
import type { ExtendedExportFormat } from "../reporting/export-extended.js";
import { ChangeGovernor } from "../core/governance.js";

// =============================================================================
// Types
// =============================================================================

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
};

export type ToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
};

// Local stringEnum replacement (avoids espada/plugin-sdk dependency)
function stringEnum<T extends readonly string[]>(
  values: T,
  options: { description?: string; title?: string; default?: T[number] } = {},
) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    ...options,
  });
}

// =============================================================================
// Constants
// =============================================================================

const DIRECTIONS = ["upstream", "downstream", "both"] as const;
const EXPORT_FORMATS = ["json", "dot", "mermaid"] as const;
const EXTENDED_EXPORT_FORMATS = ["yaml", "csv", "openlineage"] as const;
const PROVIDERS = ["aws", "azure", "gcp", "kubernetes", "custom"] as const;
const RBAC_ROLES = ["viewer", "operator", "admin", "superadmin"] as const;
const BENCHMARK_SCALES = ["1k", "10k", "100k"] as const;

// =============================================================================
// Registry Builder
// =============================================================================

export type ToolRegistryDeps = {
  engine: GraphEngine;
  storage: GraphStorage;
  temporal?: TemporalGraphStorage;
};

/**
 * Build the full tool registry. Returns an array of tool definitions
 * with execute functions bound to the provided engine/storage.
 */
export function buildToolRegistry(deps: ToolRegistryDeps): ToolDefinition[] {
  const { engine, storage, temporal } = deps;
  const governor = new ChangeGovernor(engine, storage);
  const tools: ToolDefinition[] = [];

  // Helper
  const add = (tool: ToolDefinition) => tools.push(tool);

  // ─── 1. Blast Radius ────────────────────────────────────────────────
  add({
    name: "kg_blast_radius",
    label: "Blast Radius Analysis",
    description:
      "Analyze the blast radius of changing or removing a cloud resource. " +
      "Shows all directly and transitively affected resources, their types, " +
      "cost at risk, and hop distances.",
    parameters: Type.Object({
      resourceId: Type.String({ description: "The graph node ID of the resource" }),
      depth: Type.Optional(Type.Number({ description: "Max traversal depth (default: 3, max: 8)" })),
    }),
    async execute(params) {
      const { resourceId, depth } = params as { resourceId: string; depth?: number };
      const maxDepth = Math.min(depth ?? 3, 8);
      const result = await engine.getBlastRadius(resourceId, maxDepth);
      const nodeList = [...result.nodes.values()];
      const summary = [
        `## Blast Radius: ${resourceId}`,
        "",
        `**Affected resources:** ${nodeList.length}`,
        `**Cost at risk:** $${result.totalCostMonthly.toFixed(2)}/mo`,
        `**Max depth:** ${maxDepth}`,
        "",
        "### By Hop Distance",
        ...[...result.hops.entries()].sort(([a], [b]) => a - b)
          .map(([hop, ids]) => `- **Hop ${hop}:** ${ids.length} resources`),
        "",
        "### Affected Resources",
        "| Resource | Type | Provider | Cost/mo |",
        "|----------|------|----------|---------|",
        ...nodeList.map(n =>
          `| ${n.name} | ${n.resourceType} | ${n.provider} | ${n.costMonthly != null ? "$" + n.costMonthly.toFixed(2) : "—"} |`),
      ];
      return { content: [{ type: "text", text: summary.join("\n") }], details: { resourceId, depth: maxDepth, affectedCount: nodeList.length, costAtRisk: result.totalCostMonthly } };
    },
  });

  // ─── 2. Dependency Chain ────────────────────────────────────────────
  add({
    name: "kg_dependencies",
    label: "Dependency Chain",
    description: "Find upstream or downstream dependencies of a cloud resource.",
    parameters: Type.Object({
      resourceId: Type.String({ description: "The graph node ID" }),
      direction: stringEnum(DIRECTIONS, { description: "upstream, downstream, or both" }),
      depth: Type.Optional(Type.Number({ description: "Max traversal depth (default: 3)" })),
    }),
    async execute(params) {
      const { resourceId, direction, depth } = params as { resourceId: string; direction: "upstream" | "downstream" | "both"; depth?: number };
      const result = await engine.getDependencyChain(resourceId, direction, depth ?? 3);
      const nodeList = [...result.nodes.values()];
      const summary = [
        `## ${direction.charAt(0).toUpperCase() + direction.slice(1)} Dependencies: ${resourceId}`,
        "", `**Found:** ${nodeList.length} resources`, "",
        "| Resource | Type | Provider | Relationship |",
        "|----------|------|----------|-------------|",
        ...nodeList.map(n => `| ${n.name} | ${n.resourceType} | ${n.provider} | — |`),
      ];
      return { content: [{ type: "text", text: summary.join("\n") }], details: { resourceId, direction, count: nodeList.length } };
    },
  });

  // ─── 3. Cost Attribution ────────────────────────────────────────────
  add({
    name: "kg_cost",
    label: "Cost Attribution",
    description: "Get infrastructure cost breakdown by provider, type, or region.",
    parameters: Type.Object({
      groupBy: Type.Optional(stringEnum(["provider", "resourceType", "region", "account"] as const, { description: "Group costs by dimension" })),
      provider: Type.Optional(stringEnum(PROVIDERS, { description: "Filter by provider" })),
    }),
    async execute(params) {
      const { groupBy, provider } = params as { groupBy?: string; provider?: string };
      const filter = provider ? { provider: provider as CloudProvider } : {};
      const costs = await engine.getCostByFilter(filter);
      const dimension = (groupBy ?? "resourceType") as "provider" | "resourceType" | "region" | "account";
      const byDimension = dimension === "provider" ? costs.byProvider : costs.byResourceType;
      const rows = Object.entries(byDimension).map(([key, amount]) => `| ${key} | $${amount.toFixed(2)} |`);
      const summary = [
        `## Cost Attribution (by ${dimension})`,
        "", `**Total:** $${costs.totalMonthly.toFixed(2)}/mo`, "",
        "| Group | Cost/mo |", "|-------|---------|", ...rows,
      ];
      return { content: [{ type: "text", text: summary.join("\n") }], details: costs };
    },
  });

  // ─── 4. Drift Detection ────────────────────────────────────────────
  add({
    name: "kg_drift",
    label: "Drift Detection",
    description: "Detect configuration drift — resources that changed since last sync or disappeared.",
    parameters: Type.Object({
      provider: Type.Optional(stringEnum(PROVIDERS, { description: "Filter by provider" })),
    }),
    async execute(params) {
      const { provider } = params as { provider?: string };
      const drift = await engine.detectDrift(provider as CloudProvider | undefined);
      const summary = [
        `## Drift Report`,
        "", `**Drifted:** ${drift.driftedNodes.length}`, `**Disappeared:** ${drift.disappearedNodes.length}`, "",
        ...(drift.driftedNodes.length > 0 ? [
          "### Drifted Resources",
          "| Resource | Type | Fields Changed |", "|----------|------|---------------|",
          ...drift.driftedNodes.map(d => `| ${d.node.id} | ${d.node.resourceType} | ${d.changes.map(c => c.field ?? "unknown").join(", ")} |`),
        ] : []),
        ...(drift.disappearedNodes.length > 0 ? [
          "", "### Disappeared Resources",
          ...drift.disappearedNodes.map(d => `- ${d.id} (${d.resourceType})`),
        ] : []),
      ];
      return { content: [{ type: "text", text: summary.join("\n") }], details: drift };
    },
  });

  // ─── 5. SPOF Analysis ──────────────────────────────────────────────
  add({
    name: "kg_spof_analysis",
    label: "Single Point of Failure Analysis",
    description: "Find single points of failure — resources whose removal disconnects the graph.",
    parameters: Type.Object({
      provider: Type.Optional(stringEnum(PROVIDERS, { description: "Filter by provider" })),
    }),
    async execute(params) {
      const { provider } = params as { provider?: string };
      const filter = provider ? { provider: provider as CloudProvider } : undefined;
      const spofs = await findSinglePointsOfFailure(storage, filter);
      const summary = [
        `## Single Points of Failure`, "", `**Found:** ${spofs.length} critical nodes`, "",
        "| Resource | Type | Provider |",
        "|----------|------|----------|",
        ...spofs.map(s => `| ${s.name} | ${s.resourceType} | ${s.provider} |`),
      ];
      return { content: [{ type: "text", text: summary.join("\n") }], details: { count: spofs.length, spofs } };
    },
  });

  // ─── 6. Shortest Path ──────────────────────────────────────────────
  add({
    name: "kg_path",
    label: "Shortest Path",
    description: "Find the shortest path between two resources in the infrastructure graph.",
    parameters: Type.Object({
      from: Type.String({ description: "Source node ID" }),
      to: Type.String({ description: "Target node ID" }),
    }),
    async execute(params) {
      const { from, to } = params as { from: string; to: string };
      const result = await shortestPath(storage, from, to);
      if (!result.found || result.path.length === 0) {
        return { content: [{ type: "text", text: `No path found from \`${from}\` to \`${to}\`.` }] };
      }
      const summary = [
        `## Path: ${from} → ${to}`, "", `**Hops:** ${result.hops}`, "",
        ...result.path.map((nodeId: string, i: number) => `${i + 1}. \`${nodeId}\``),
      ];
      return { content: [{ type: "text", text: summary.join("\n") }], details: { from, to, hops: result.hops, path: result.path } };
    },
  });

  // ─── 7. Orphan Detection ───────────────────────────────────────────
  add({
    name: "kg_orphans",
    label: "Orphan Detection",
    description: "Find orphaned resources — nodes with no relationships.",
    parameters: Type.Object({
      provider: Type.Optional(stringEnum(PROVIDERS, { description: "Filter by provider" })),
    }),
    async execute(params) {
      const { provider } = params as { provider?: string };
      const filter = provider ? { provider: provider as CloudProvider } : undefined;
      const orphans = await findOrphans(storage, filter);
      const summary = [
        `## Orphaned Resources`, "", `**Found:** ${orphans.length}`, "",
        "| Resource | Type | Provider | Cost/mo |",
        "|----------|------|----------|---------|",
        ...orphans.map(o => `| ${o.name} | ${o.resourceType} | ${o.provider} | ${o.costMonthly != null ? "$" + o.costMonthly.toFixed(2) : "—"} |`),
      ];
      return { content: [{ type: "text", text: summary.join("\n") }], details: { count: orphans.length } };
    },
  });

  // ─── 8. Graph Status ───────────────────────────────────────────────
  add({
    name: "kg_status",
    label: "Graph Status",
    description: "Get statistics about the infrastructure knowledge graph.",
    parameters: Type.Object({}),
    async execute() {
      const stats = await engine.getStats();
      const summary = [
        `## Infrastructure Knowledge Graph Status`, "",
        "| Metric | Value |", "|--------|-------|",
        `| Total nodes | ${stats.totalNodes} |`,
        `| Total edges | ${stats.totalEdges} |`,
        `| Total cost | $${stats.totalCostMonthly.toFixed(2)}/mo |`,
        `| Last sync | ${stats.lastSyncAt ?? "never"} |`,
        "", "### By Provider",
        ...Object.entries(stats.nodesByProvider).map(([p, c]) => `- ${p}: ${c}`),
        "", "### By Type",
        ...Object.entries(stats.nodesByResourceType).sort(([, a], [, b]) => b - a).map(([t, c]) => `- ${t}: ${c}`),
      ];
      return { content: [{ type: "text", text: summary.join("\n") }], details: stats };
    },
  });

  // ─── 9. Export ─────────────────────────────────────────────────────
  add({
    name: "kg_export",
    label: "Graph Export",
    description: "Export the graph topology in JSON, DOT (Graphviz), or Mermaid format.",
    parameters: Type.Object({
      format: stringEnum(EXPORT_FORMATS, { description: "Output format" }),
      provider: Type.Optional(stringEnum(PROVIDERS, { description: "Filter by provider" })),
    }),
    async execute(params) {
      const { format, provider } = params as { format: "json" | "dot" | "mermaid"; provider?: string };
      const options = provider ? { filter: { provider: provider as CloudProvider } } : undefined;
      const output = await exportTopology(storage, format, options);
      return { content: [{ type: "text", text: output.content }], details: { format, nodeCount: output.nodeCount, edgeCount: output.edgeCount } };
    },
  });

  // ─── 10. Audit Trail ──────────────────────────────────────────────
  add({
    name: "kg_audit_trail",
    label: "Audit Trail",
    description: "Query the infrastructure change audit trail.",
    parameters: Type.Object({
      resourceId: Type.Optional(Type.String({ description: "Filter by resource ID" })),
      changeType: Type.Optional(stringEnum(["created", "updated", "deleted"] as const, { description: "Filter by change type" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 20)" })),
    }),
    async execute(params) {
      const { resourceId, changeType, limit } = params as { resourceId?: string; changeType?: string; limit?: number };
      const changes = governor.getAuditTrail({
        targetResourceId: resourceId,
        action: changeType as "create" | "update" | "delete" | "scale" | "reconfigure" | undefined,
        limit: limit ?? 20,
      });
      const summary = [
        `## Audit Trail`, "", `**Changes:** ${changes.length}`, "",
        "| Time | Resource | Action | Status |",
        "|------|----------|--------|--------|",
        ...changes.map(c => `| ${c.createdAt} | ${c.targetResourceId} | ${c.action} | ${c.status} |`),
      ];
      return { content: [{ type: "text", text: summary.join("\n") }], details: { count: changes.length } };
    },
  });

  // ─── 11. Change Request ───────────────────────────────────────────
  add({
    name: "kg_request_change",
    label: "Change Request",
    description: "Submit a change request with risk scoring and policy evaluation.",
    parameters: Type.Object({
      resourceId: Type.String({ description: "Target resource ID" }),
      action: stringEnum(["create", "update", "delete", "scale", "reconfigure"] as const, { description: "Type of change" }),
      description: Type.String({ description: "What the change does" }),
      requestedBy: Type.Optional(Type.String({ description: "Who is requesting" })),
    }),
    async execute(params) {
      const { resourceId, action, description, requestedBy } = params as { resourceId: string; action: "create" | "update" | "delete" | "scale" | "reconfigure"; description: string; requestedBy?: string };
      const result = await governor.interceptChange({
        initiator: requestedBy ?? "mcp-user",
        initiatorType: "agent",
        targetResourceId: resourceId,
        resourceType: "custom",
        provider: "custom",
        action,
        description,
      });
      const summary = [
        `## Change Request: ${resourceId}`, "",
        `**Status:** ${result.status}`,
        `**Risk Score:** ${result.risk.score}/100 (${result.risk.level})`,
        "", "### Risk Factors",
        ...result.risk.factors.map((f: string) => `- ${f}`),
      ];
      return { content: [{ type: "text", text: summary.join("\n") }], details: result };
    },
  });

  // ─── 12. Governance Summary ───────────────────────────────────────
  add({
    name: "kg_governance_summary",
    label: "Governance Dashboard",
    description: "Overview of change governance: pending approvals, recent changes, risk distribution.",
    parameters: Type.Object({}),
    async execute() {
      const summary_data = governor.getSummary();
      const summary = [
        `## Governance Dashboard`, "",
        `**Total requests:** ${summary_data.totalRequests}`,
        `**Policy violations:** ${summary_data.policyViolationCount}`,
        `**Avg risk score:** ${summary_data.avgRiskScore.toFixed(1)}`,
        "", "### By Status",
        ...Object.entries(summary_data.byStatus).map(([status, count]) => `- ${status}: ${count}`),
        "", "### By Risk Level",
        ...Object.entries(summary_data.byRiskLevel).map(([level, count]) => `- ${level}: ${count}`),
      ];
      return { content: [{ type: "text", text: summary.join("\n") }], details: summary_data };
    },
  });

  // ─── 13. Pending Approvals ────────────────────────────────────────
  add({
    name: "kg_pending_approvals",
    label: "Pending Approvals",
    description: "List change requests awaiting approval.",
    parameters: Type.Object({}),
    async execute() {
      const pending = governor.getPendingRequests();
      const summary = [
        `## Pending Approvals`, "", `**Count:** ${pending.length}`, "",
        "| ID | Resource | Action | Risk | Initiator |",
        "|----|----------|--------|------|-----------|",
        ...pending.map(p => `| ${p.id} | ${p.targetResourceId} | ${p.action} | ${p.risk.level} | ${p.initiator} |`),
      ];
      return { content: [{ type: "text", text: summary.join("\n") }], details: { count: pending.length, pending } };
    },
  });

  // ─── 14–19. Temporal Tools ────────────────────────────────────────
  if (temporal) {
    add({
      name: "kg_time_travel",
      label: "Time Travel",
      description: "View the infrastructure graph as it existed at a specific point in time.",
      parameters: Type.Object({
        timestamp: Type.String({ description: "ISO 8601 timestamp to travel to" }),
        provider: Type.Optional(stringEnum(PROVIDERS, { description: "Filter by provider" })),
      }),
      async execute(params) {
        const { timestamp, provider } = params as { timestamp: string; provider?: string };
        const filter = provider ? { provider: provider as CloudProvider } : undefined;
        const topo = await getTopologyAt(temporal, timestamp, filter);
        if (!topo) {
          return { content: [{ type: "text", text: `No snapshot data available for timestamp ${timestamp}.` }] };
        }
        const summary = [
          `## Time Travel: ${timestamp}`, "",
          `**Nodes:** ${topo.nodes.length}`, `**Edges:** ${topo.edges.length}`,
        ];
        return { content: [{ type: "text", text: summary.join("\n") }], details: { timestamp, nodeCount: topo.nodes.length, edgeCount: topo.edges.length } };
      },
    });

    add({
      name: "kg_diff",
      label: "Snapshot Diff",
      description: "Compare two snapshots or timestamps to see what changed.",
      parameters: Type.Object({
        from: Type.String({ description: "Start snapshot ID or ISO timestamp" }),
        to: Type.Optional(Type.String({ description: "End snapshot ID or ISO timestamp (default: now)" })),
      }),
      async execute(params) {
        const { from, to } = params as { from: string; to?: string };
        const diff = to
          ? await diffSnapshotsFn(temporal, from, to)
          : await diffTimestamps(temporal, from, new Date().toISOString());
        if (!diff) {
          return { content: [{ type: "text", text: `No diff data available.` }] };
        }
        const summary = [
          `## Infrastructure Diff`, "",
          `**Added:** ${diff.addedNodes.length}`, `**Removed:** ${diff.removedNodes.length}`, `**Modified:** ${diff.changedNodes.length}`,
        ];
        return { content: [{ type: "text", text: summary.join("\n") }], details: diff };
      },
    });

    add({
      name: "kg_node_history",
      label: "Resource History",
      description: "View the change history of a specific resource over time.",
      parameters: Type.Object({
        resourceId: Type.String({ description: "The resource node ID" }),
        limit: Type.Optional(Type.Number({ description: "Max history entries (default: 20)" })),
      }),
      async execute(params) {
        const { resourceId, limit } = params as { resourceId: string; limit?: number };
        const history = await getNodeHistoryFn(temporal, resourceId, limit ?? 20);
        const summary = [
          `## History: ${resourceId}`, "", `**Entries:** ${history.length}`, "",
          ...history.map(h => `- **${h.snapshotCreatedAt}**: \`${h.nodeId}\` — ${h.node.status} (${h.node.resourceType})`),
        ];
        return { content: [{ type: "text", text: summary.join("\n") }], details: { resourceId, history } };
      },
    });

    add({
      name: "kg_evolution",
      label: "Evolution Summary",
      description: "Infrastructure evolution trends over a time period.",
      parameters: Type.Object({
        since: Type.Optional(Type.String({ description: "Start date (ISO 8601, default: 30 days ago)" })),
      }),
      async execute(params) {
        const { since } = params as { since?: string };
        const start = since ?? new Date(Date.now() - 30 * 86400000).toISOString();
        const evo = await getEvolutionSummary(temporal, start);
        const summary = [
          `## Infrastructure Evolution`, "", `**Period:** ${start} → now`,
          `**Snapshots:** ${evo.snapshots.length}`,
          `**Net node change:** ${(evo.netChange.nodesAdded - evo.netChange.nodesRemoved) > 0 ? "+" : ""}${evo.netChange.nodesAdded - evo.netChange.nodesRemoved}`,
        ];
        return { content: [{ type: "text", text: summary.join("\n") }], details: evo };
      },
    });

    add({
      name: "kg_snapshot",
      label: "Take Snapshot",
      description: "Manually take a point-in-time snapshot of the current graph.",
      parameters: Type.Object({
        label: Type.Optional(Type.String({ description: "Snapshot label" })),
      }),
      async execute(params) {
        const { label } = params as { label?: string };
        const snap = await takeSnapshot(temporal, "manual", label);
        return { content: [{ type: "text", text: `Snapshot taken: **${snap.id}** at ${snap.createdAt}${label ? ` (${label})` : ""}` }], details: snap };
      },
    });

    add({
      name: "kg_list_snapshots",
      label: "List Snapshots",
      description: "List available temporal snapshots for time travel and diffing.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: "Max results (default: 20)" })),
      }),
      async execute(params) {
        const { limit } = params as { limit?: number };
        const snapshots = await temporal.listSnapshots({ limit: limit ?? 20 });
        const summary = [
          `## Snapshots`, "", `**Count:** ${snapshots.length}`, "",
          "| ID | Created At | Label | Nodes |",
          "|----|------------|-------|-------|",
          ...snapshots.map(s => `| ${s.id} | ${s.createdAt} | ${s.label ?? "—"} | ${s.nodeCount} |`),
        ];
        return { content: [{ type: "text", text: summary.join("\n") }], details: { count: snapshots.length, snapshots } };
      },
    });
  }

  // ─── 20. IQL Query ─────────────────────────────────────────────────
  add({
    name: "kg_query",
    label: "Infrastructure Query (IQL)",
    description:
      "Execute an Infrastructure Query Language (IQL) query against the knowledge graph.\n\n" +
      "Query types:\n" +
      "- FIND resources WHERE <conditions>\n" +
      "- FIND DOWNSTREAM OF '<id>' [WHERE ...]\n" +
      "- FIND UPSTREAM OF '<id>' [WHERE ...]\n" +
      "- FIND PATH FROM '<id>' TO '<id>'\n" +
      "- SUMMARIZE <field> BY <field>\n\n" +
      "Operators: =, !=, >, <, >=, <=, LIKE, IN, MATCHES, AND, OR, NOT\n" +
      "Functions: tagged('<key>'), drifted_since('<date>'), has_edge('<type>'), created_after/before('<date>')\n" +
      "Examples: FIND resources WHERE type = 'ec2' AND tag.env = 'prod'",
    parameters: Type.Object({
      query: Type.String({ description: "IQL query string" }),
    }),
    async execute(params) {
      const { query } = params as { query: string };
      try {
        const ast = parseIQL(query);
        const opts: IQLExecutorOptions = { storage, temporal };
        const result = await executeQuery(ast, opts);
        // Normalize result to rows for display
        const rows: Record<string, unknown>[] = result.type === "find"
          ? result.nodes
          : result.type === "summarize"
            ? result.groups as unknown as Record<string, unknown>[]
            : [];
        const summary = [
          `## IQL Query Result`, "", `\`${query}\``, "",
          `**Type:** ${result.type}`, `**Results:** ${rows.length}`, "",
        ];
        if (rows.length > 0) {
          const cols = Object.keys(rows[0]!);
          summary.push(
            "| " + cols.join(" | ") + " |",
            "| " + cols.map(() => "---").join(" | ") + " |",
            ...rows.slice(0, 50).map((r: Record<string, unknown>) => "| " + cols.map(c => String(r[c] ?? "")).join(" | ") + " |"),
          );
          if (rows.length > 50) summary.push(`\n_…and ${rows.length - 50} more rows_`);
        }
        return { content: [{ type: "text", text: summary.join("\n") }], details: { query, rowCount: rows.length, rows: rows.slice(0, 100) } };
      } catch (err) {
        if (err instanceof IQLSyntaxError) {
          const examples = getExampleQueries();
          return { content: [{ type: "text", text: `**IQL Syntax Error:** ${err.message}\n\n**Examples:**\n${examples.map(e => `- \`${e}\``).join("\n")}` }] };
        }
        throw err;
      }
    },
  });

  // ─── 21. Compliance ────────────────────────────────────────────────
  add({
    name: "kg_compliance",
    label: "Compliance Check",
    description: "Run a compliance assessment (SOC2, HIPAA, PCI-DSS, ISO 27001).",
    parameters: Type.Object({
      framework: stringEnum([...SUPPORTED_FRAMEWORKS] as [string, ...string[]], { description: "Compliance framework" }),
      provider: Type.Optional(stringEnum(PROVIDERS, { description: "Filter by provider" })),
    }),
    async execute(params) {
      const { framework, provider } = params as { framework: string; provider?: string };
      const filter = provider ? { provider: provider as CloudProvider } : undefined;
      const result = await runComplianceAssessment([framework as ComplianceFramework], storage, filter);
      const markdown = formatComplianceMarkdown(result);
      return { content: [{ type: "text", text: markdown }], details: result };
    },
  });

  // ─── 22. Recommendations ──────────────────────────────────────────
  add({
    name: "kg_recommendations",
    label: "Optimization Recommendations",
    description: "Get infrastructure optimization recommendations (cost, security, unused resources).",
    parameters: Type.Object({
      provider: Type.Optional(stringEnum(PROVIDERS, { description: "Filter by provider" })),
    }),
    async execute(params) {
      const { provider } = params as { provider?: string };
      const filter = provider ? { provider: provider as CloudProvider } : undefined;
      const recs = await generateRecommendations(engine, storage, filter);
      const markdown = formatRecommendationsMarkdown(recs);
      return { content: [{ type: "text", text: markdown }], details: recs };
    },
  });

  // ─── 23. Agent Activity ───────────────────────────────────────────
  add({
    name: "kg_agents",
    label: "Agent Activity",
    description: "View AI agent activity on infrastructure resources.",
    parameters: Type.Object({
      agentId: Type.Optional(Type.String({ description: "Filter by agent ID" })),
    }),
    async execute(params) {
      const { agentId } = params as { agentId?: string };
      const report = await generateAgentReport(storage, agentId);
      const markdown = formatAgentReportMarkdown(report);
      return { content: [{ type: "text", text: markdown }], details: report };
    },
  });

  // ─── 24. Natural Language Query ───────────────────────────────────
  add({
    name: "kg_ask",
    label: "Natural Language Query",
    description: "Ask a question about your infrastructure in natural language. Translates to IQL and executes.",
    parameters: Type.Object({
      question: Type.String({ description: "Natural language question about your infrastructure" }),
    }),
    async execute(params) {
      const { question } = params as { question: string };
      const translated = translateNLToIQL(question);
      if (!translated.success || !translated.iql) {
        const examples = getExampleQueries();
        return { content: [{ type: "text", text: `Could not translate question to IQL.\n\n${translated.explanation}\n\nTry:\n${examples.map(e => `- ${e}`).join("\n")}` }] };
      }
      try {
        const ast = parseIQL(translated.iql);
        const result = await executeQuery(ast, { storage, temporal });
        const rows: Record<string, unknown>[] = result.type === "find"
          ? result.nodes
          : result.type === "summarize"
            ? result.groups as unknown as Record<string, unknown>[]
            : [];
        const summary = [
          `## ${question}`, "", `_Translated to:_ \`${translated.iql}\``, "",
          `**Results:** ${rows.length}`, "",
        ];
        if (rows.length > 0) {
          const cols = Object.keys(rows[0]!);
          summary.push(
            "| " + cols.join(" | ") + " |",
            "| " + cols.map(() => "---").join(" | ") + " |",
            ...rows.slice(0, 30).map((r: Record<string, unknown>) => "| " + cols.map(c => String(r[c] ?? "")).join(" | ") + " |"),
          );
        }
        return { content: [{ type: "text", text: summary.join("\n") }], details: { question, iql: translated.iql, rowCount: rows.length } };
      } catch (err) {
        return { content: [{ type: "text", text: `Translated to \`${translated.iql}\` but execution failed: ${err}` }] };
      }
    },
  });

  // ─── 25. Remediation ──────────────────────────────────────────────
  add({
    name: "kg_remediation",
    label: "Drift Remediation",
    description: "Generate IaC patches (Terraform/CloudFormation) to fix detected drift.",
    parameters: Type.Object({
      resourceId: Type.Optional(Type.String({ description: "Specific resource to remediate" })),
      format: Type.Optional(stringEnum(["terraform", "cloudformation"] as const, { description: "IaC format (default: terraform)" })),
    }),
    async execute(params) {
      const { resourceId: _resourceId, format } = params as { resourceId?: string; format?: string };
      // First detect drift, then generate remediation plan
      const driftResult = await engine.detectDrift();
      const plan = generateRemediationPlan(driftResult, (format ?? "terraform") as IaCFormat);
      const markdown = formatRemediationMarkdown(plan);
      return { content: [{ type: "text", text: markdown }], details: plan };
    },
  });

  // ─── 26. Supply Chain ─────────────────────────────────────────────
  add({
    name: "kg_supply_chain",
    label: "Supply Chain Security",
    description: "Analyze software supply chain — container images, base images, CVE exposure.",
    parameters: Type.Object({
      provider: Type.Optional(stringEnum(PROVIDERS, { description: "Filter by provider" })),
    }),
    async execute(params) {
      const { provider } = params as { provider?: string };
      const report = await generateSupplyChainReport(storage, provider as CloudProvider | undefined);
      const markdown = formatSupplyChainMarkdown(report);
      return { content: [{ type: "text", text: markdown }], details: report };
    },
  });

  // ─── 27. Visualization ────────────────────────────────────────────
  add({
    name: "kg_visualize",
    label: "Graph Visualization",
    description: "Export graph for visualization in Cytoscape.js or D3-force format.",
    parameters: Type.Object({
      format: Type.Optional(stringEnum(["cytoscape", "d3-force"] as const, { description: "Visualization format (default: cytoscape)" })),
      provider: Type.Optional(stringEnum(PROVIDERS, { description: "Filter by provider" })),
      layout: Type.Optional(stringEnum(["force", "hierarchical", "circular", "grid"] as const, { description: "Layout strategy" })),
    }),
    async execute(params) {
      const { format, provider, layout } = params as { format?: string; provider?: string; layout?: string };
      const filter = provider ? { provider: provider as CloudProvider } : undefined;
      const output = await exportVisualization(storage,
        (format ?? "cytoscape") as VisualizationFormat,
        {
          layout: (layout ?? "force") as LayoutStrategy,
          filter,
        },
      );
      return { content: [{ type: "text", text: output.content }], details: { format: format ?? "cytoscape", layout: layout ?? "force", nodeCount: output.nodeCount, edgeCount: output.edgeCount } };
    },
  });

  // ─── 28. RBAC ─────────────────────────────────────────────────────
  add({
    name: "kg_rbac",
    label: "RBAC Policy",
    description: "View or manage RBAC policies for the knowledge graph.",
    parameters: Type.Object({
      action: Type.Optional(stringEnum(["view", "create"] as const, { description: "Action (default: view)" })),
      role: Type.Optional(stringEnum(RBAC_ROLES, { description: "Role for create action" })),
      principalId: Type.Optional(Type.String({ description: "Principal ID for create action" })),
    }),
    async execute(params) {
      const { action, role, principalId } = params as { action?: string; role?: string; principalId?: string };
      if (action === "create" && role && principalId) {
        const principal = { id: principalId, name: principalId, role: role as RBACRole, scope: {} };
        const policy = createRBACPolicy([principal]);
        const markdown = formatRBACPolicyMarkdown(policy);
        return { content: [{ type: "text", text: markdown }], details: policy };
      }
      // Show permissions for all roles
      const allRoles = ["viewer", "operator", "admin", "superadmin"] as const;
      const summary = [
        `## RBAC Policy Overview`, "",
        ...allRoles.map(r => {
          const perms = getRolePermissions(r);
          const granted = Object.entries(perms).filter(([, v]) => v).map(([k]) => k);
          return `### ${r}\n${granted.map(x => `- ${x}`).join("\n")}`;
        }),
      ];
      return { content: [{ type: "text", text: summary.join("\n") }] };
    },
  });

  // ─── 29. Benchmark ────────────────────────────────────────────────
  add({
    name: "kg_benchmark",
    label: "Performance Benchmark",
    description: "Run performance benchmarks at various scales (1K, 10K, 100K nodes).",
    parameters: Type.Object({
      scale: Type.Optional(stringEnum(BENCHMARK_SCALES, { description: "Scale (default: 1k)" })),
    }),
    async execute(params) {
      const { scale } = params as { scale?: string };
      const result = await runBenchmarks(storage, { scale: (scale ?? "1k") as BenchmarkScale });
      const markdown = formatBenchmarkMarkdown(result);
      return { content: [{ type: "text", text: markdown }], details: result };
    },
  });

  // ─── 30. Extended Export ──────────────────────────────────────────
  add({
    name: "kg_export_extended",
    label: "Extended Export",
    description: "Export graph in YAML, CSV, or OpenLineage format.",
    parameters: Type.Object({
      format: stringEnum(EXTENDED_EXPORT_FORMATS, { description: "Export format" }),
      provider: Type.Optional(stringEnum(PROVIDERS, { description: "Filter by provider" })),
    }),
    async execute(params) {
      const { format, provider } = params as { format: string; provider?: string };
      const filter = provider ? { filter: { provider: provider as CloudProvider } } : undefined;
      const output = await exportExtended(storage, format as ExtendedExportFormat, filter);
      return { content: [{ type: "text", text: output.content }], details: { format, nodeCount: output.nodeCount, edgeCount: output.edgeCount } };
    },
  });

  return tools;
}
