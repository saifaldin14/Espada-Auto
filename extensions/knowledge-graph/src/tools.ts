/**
 * Infrastructure Knowledge Graph — Agent Tools
 *
 * Espada agent tools for querying the knowledge graph.
 * These allow the AI agent to analyze infrastructure topology,
 * blast radius, dependencies, costs, drift, and structural weaknesses.
 */

import { Type } from "@sinclair/typebox";
import type { EspadaPluginApi } from "espada/plugin-sdk";
import { stringEnum } from "espada/plugin-sdk";
import type { GraphEngine } from "./engine.js";
import type { CloudProvider, GraphStorage } from "./types.js";
import {
  shortestPath,
  findOrphans,
  findSinglePointsOfFailure,
} from "./queries.js";
import { exportTopology } from "./export.js";
import type { TemporalGraphStorage } from "./temporal.js";
import {
  takeSnapshot,
  getTopologyAt,
  getNodeHistory as getNodeHistoryFn,
  diffSnapshots as diffSnapshotsFn,
  diffTimestamps,
  getEvolutionSummary,
} from "./temporal.js";
import { parseIQL, executeQuery, IQLSyntaxError } from "./iql/index.js";
import type { IQLExecutorOptions } from "./iql/index.js";

// P2 imports
import {
  runComplianceAssessment,
  formatComplianceMarkdown,
  SUPPORTED_FRAMEWORKS,
} from "./compliance.js";
import type { ComplianceFramework } from "./compliance.js";
import {
  generateRecommendations,
  formatRecommendationsMarkdown,
} from "./recommendations.js";
import {
  generateAgentReport,
  formatAgentReportMarkdown,
  buildAgentNodeId,
} from "./agent-model.js";
import { translateNLToIQL, getExampleQueries } from "./nl-translator.js";
import {
  generateRemediationPlan,
  formatRemediationMarkdown,
} from "./remediation.js";
import type { IaCFormat } from "./remediation.js";
import {
  generateSupplyChainReport,
  formatSupplyChainMarkdown,
} from "./supply-chain.js";
import { exportVisualization } from "./visualization.js";
import type { VisualizationFormat, LayoutStrategy } from "./visualization.js";

// =============================================================================
// Constants
// =============================================================================

const DIRECTIONS = ["upstream", "downstream", "both"] as const;
const EXPORT_FORMATS = ["json", "dot", "mermaid"] as const;
const PROVIDERS = ["aws", "azure", "gcp", "k8s", "custom"] as const;

// =============================================================================
// Tool Registration
// =============================================================================

/**
 * Register all knowledge graph agent tools with the Espada plugin API.
 */
export function registerGraphTools(
  api: EspadaPluginApi,
  engine: GraphEngine,
  storage: GraphStorage,
): void {
  // ---------------------------------------------------------------------------
  // 1. Blast Radius
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_blast_radius",
      label: "Blast Radius Analysis",
      description:
        "Analyze the blast radius of changing or removing a cloud resource. " +
        "Shows all directly and transitively affected resources, their types, " +
        "cost at risk, and hop distances. Use when planning infrastructure changes.",
      parameters: Type.Object({
        resourceId: Type.String({
          description:
            "The graph node ID of the resource (format: provider:account:region:type:nativeId)",
        }),
        depth: Type.Optional(
          Type.Number({
            description: "Max traversal depth (default: 3, max: 8)",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
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
          ...[...result.hops.entries()]
            .sort(([a], [b]) => a - b)
            .map(([hop, ids]) => `- **Hop ${hop}:** ${ids.length} resources`),
          "",
          "### Affected Resources",
          "| Resource | Type | Provider | Cost/mo |",
          "|----------|------|----------|---------|",
          ...nodeList.map(
            (n) =>
              `| ${n.name} | ${n.resourceType} | ${n.provider} | ${n.costMonthly != null ? "$" + n.costMonthly.toFixed(2) : "—"} |`,
          ),
        ];

        return {
          content: [{ type: "text" as const, text: summary.join("\n") }],
          details: {
            resourceId,
            depth: maxDepth,
            affectedCount: nodeList.length,
            costAtRisk: result.totalCostMonthly,
            hopDistribution: Object.fromEntries(
              [...result.hops.entries()].map(([k, v]) => [k, v.length]),
            ),
          },
        };
      },
    },
    { names: ["kg_blast_radius"] },
  );

  // ---------------------------------------------------------------------------
  // 2. Dependency Chain
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_dependencies",
      label: "Dependency Chain",
      description:
        "Find upstream or downstream dependencies of a cloud resource. " +
        "Upstream: what this resource depends on. " +
        "Downstream: what depends on this resource.",
      parameters: Type.Object({
        resourceId: Type.String({
          description: "The graph node ID of the resource",
        }),
        direction: stringEnum(DIRECTIONS, {
          description: "upstream (what it depends on), downstream (what depends on it), or both",
        }),
        depth: Type.Optional(
          Type.Number({ description: "Max traversal depth (default: 3)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { resourceId, direction, depth } = params as {
          resourceId: string;
          direction: "upstream" | "downstream" | "both";
          depth?: number;
        };

        const result = await engine.getDependencyChain(resourceId, direction, depth ?? 3);
        const nodeList = [...result.nodes.values()];

        const summary = [
          `## ${direction.charAt(0).toUpperCase() + direction.slice(1)} Dependencies: ${resourceId}`,
          "",
          `**Total dependencies:** ${nodeList.length}`,
          `**Total cost:** $${result.totalCostMonthly.toFixed(2)}/mo`,
          "",
          "### Dependency Graph",
          ...nodeList.map((n) => `- ${n.name} (${n.resourceType}, ${n.provider}:${n.region})`),
          "",
          "### Edges",
          ...result.edges.map(
            (e) => `- ${e.sourceNodeId} —[${e.relationshipType}]→ ${e.targetNodeId}`,
          ),
        ];

        return {
          content: [{ type: "text" as const, text: summary.join("\n") }],
          details: {
            resourceId,
            direction,
            dependencyCount: nodeList.length,
            cost: result.totalCostMonthly,
          },
        };
      },
    },
    { names: ["kg_dependencies"] },
  );

  // ---------------------------------------------------------------------------
  // 3. Infrastructure Cost
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_cost",
      label: "Infrastructure Cost",
      description:
        "Get cost attribution for infrastructure. Query by resource ID, group ID, " +
        "or provider. Shows total cost, breakdown by type and provider, and per-node costs.",
      parameters: Type.Object({
        resourceId: Type.Optional(
          Type.String({ description: "Specific resource node ID" }),
        ),
        groupId: Type.Optional(
          Type.String({ description: "Group ID for aggregate cost" }),
        ),
        provider: Type.Optional(
          stringEnum(PROVIDERS, { description: "Filter by cloud provider" }),
        ),
        includeDownstream: Type.Optional(
          Type.Boolean({
            description: "Include downstream resource costs (default: false)",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { resourceId, groupId, provider, includeDownstream } = params as {
          resourceId?: string;
          groupId?: string;
          provider?: string;
          includeDownstream?: boolean;
        };

        let cost;
        if (groupId) {
          cost = await engine.getGroupCost(groupId);
        } else if (resourceId) {
          cost = await engine.getNodeCost(resourceId, includeDownstream ?? false);
        } else if (provider) {
          cost = await engine.getCostByFilter(
            { provider: provider as "aws" | "azure" | "gcp" },
            `Provider: ${provider}`,
          );
        } else {
          cost = await engine.getCostByFilter({}, "All Infrastructure");
        }

        const summary = [
          `## Cost Attribution: ${cost.label}`,
          "",
          `**Total:** $${cost.totalMonthly.toFixed(2)}/mo`,
          "",
          "### By Resource Type",
          ...Object.entries(cost.byResourceType)
            .sort(([, a], [, b]) => b - a)
            .map(([type, c]) => `- ${type}: $${c.toFixed(2)}/mo`),
          "",
          "### Top Resources",
          "| Resource | Type | Cost/mo |",
          "|----------|------|---------|",
          ...cost.nodes
            .sort((a, b) => b.costMonthly - a.costMonthly)
            .slice(0, 20)
            .map((n) => `| ${n.name} | ${n.resourceType} | $${n.costMonthly.toFixed(2)} |`),
        ];

        return {
          content: [{ type: "text" as const, text: summary.join("\n") }],
          details: {
            totalMonthly: cost.totalMonthly,
            byResourceType: cost.byResourceType,
            byProvider: cost.byProvider,
            nodeCount: cost.nodes.length,
          },
        };
      },
    },
    { names: ["kg_cost"] },
  );

  // ---------------------------------------------------------------------------
  // 4. Drift Detection
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_drift",
      label: "Drift Detection",
      description:
        "Detect configuration drift in infrastructure. Finds resources that changed " +
        "since the last sync, disappeared resources, and newly discovered resources.",
      parameters: Type.Object({
        provider: Type.Optional(
          stringEnum(PROVIDERS, { description: "Filter drift to a specific provider" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { provider } = params as { provider?: "aws" | "azure" | "gcp" };

        const drift = await engine.detectDrift(provider);

        const summary = [
          `## Drift Detection Report`,
          `*Scanned at: ${drift.scannedAt}*`,
          "",
          `**Drifted resources:** ${drift.driftedNodes.length}`,
          `**Disappeared resources:** ${drift.disappearedNodes.length}`,
          `**New resources:** ${drift.newNodes.length}`,
        ];

        if (drift.driftedNodes.length > 0) {
          summary.push("", "### Drifted Resources");
          for (const { node, changes } of drift.driftedNodes) {
            summary.push(`\n**${node.name}** (${node.resourceType})`);
            for (const change of changes) {
              summary.push(
                `- ${change.field}: \`${change.previousValue}\` → \`${change.newValue}\``,
              );
            }
          }
        }

        if (drift.disappearedNodes.length > 0) {
          summary.push("", "### Disappeared Resources");
          for (const node of drift.disappearedNodes) {
            summary.push(`- ${node.name} (${node.resourceType}, ${node.provider}:${node.region})`);
          }
        }

        if (drift.newNodes.length > 0) {
          summary.push("", "### New Resources");
          for (const node of drift.newNodes) {
            summary.push(`- ${node.name} (${node.resourceType}, ${node.provider}:${node.region})`);
          }
        }

        return {
          content: [{ type: "text" as const, text: summary.join("\n") }],
          details: {
            driftedCount: drift.driftedNodes.length,
            disappearedCount: drift.disappearedNodes.length,
            newCount: drift.newNodes.length,
            scannedAt: drift.scannedAt,
          },
        };
      },
    },
    { names: ["kg_drift"] },
  );

  // ---------------------------------------------------------------------------
  // 5. SPOF Analysis
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_spof_analysis",
      label: "SPOF Analysis",
      description:
        "Find single points of failure (SPOFs) in the infrastructure topology. " +
        "Uses Tarjan's algorithm to detect articulation points — resources whose " +
        "removal would disconnect parts of the graph.",
      parameters: Type.Object({}),
      async execute() {
        const spofs = await findSinglePointsOfFailure(storage);

        if (spofs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No single points of failure detected. The infrastructure topology has no articulation points.",
              },
            ],
            details: { count: 0, spofs: [] },
          };
        }

        // spofs is already GraphNode[] — map directly
        const enriched = spofs.map((node) => ({
          id: node.id,
          name: node.name,
          type: node.resourceType,
          provider: node.provider,
          region: node.region,
        }));

        const summary = [
          `## Single Points of Failure`,
          "",
          `**${spofs.length}** articulation points detected.`,
          "These resources, if removed, would disconnect parts of the infrastructure graph.",
          "",
          "| Resource | Type | Provider | Region |",
          "|----------|------|----------|--------|",
          ...enriched.map((s) => `| ${s.name} | ${s.type} | ${s.provider} | ${s.region} |`),
        ];

        return {
          content: [{ type: "text" as const, text: summary.join("\n") }],
          details: { count: spofs.length, spofs: enriched },
        };
      },
    },
    { names: ["kg_spof_analysis"] },
  );

  // ---------------------------------------------------------------------------
  // 6. Shortest Path
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_path",
      label: "Shortest Path",
      description:
        "Find the shortest path between two infrastructure resources in the graph. " +
        "Shows each hop and the relationship type connecting them.",
      parameters: Type.Object({
        fromResourceId: Type.String({ description: "Source resource node ID" }),
        toResourceId: Type.String({ description: "Target resource node ID" }),
      }),
      async execute(_toolCallId, params) {
        const { fromResourceId, toResourceId } = params as {
          fromResourceId: string;
          toResourceId: string;
        };

        const result = await shortestPath(storage, fromResourceId, toResourceId);

        if (!result) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No path found between \`${fromResourceId}\` and \`${toResourceId}\`. The resources may be in disconnected graph components.`,
              },
            ],
            details: { found: false },
          };
        }

        // Enrich with node names
        const nodeNames = new Map<string, string>();
        for (const id of result.path) {
          const node = await storage.getNode(id);
          nodeNames.set(id, node?.name ?? id);
        }

        const pathStr = result.path.map((id) => nodeNames.get(id) ?? id).join(" → ");
        const summary = [
          `## Shortest Path (${result.hops} hops)`,
          "",
          `**Path:** ${pathStr}`,
          "",
          "### Hops",
          ...result.edges.map(
            (e) =>
              `- ${nodeNames.get(e.sourceNodeId)} —[${e.relationshipType}]→ ${nodeNames.get(e.targetNodeId)}`,
          ),
        ];

        return {
          content: [{ type: "text" as const, text: summary.join("\n") }],
          details: {
            found: true,
            hops: result.hops,
            path: result.path,
          },
        };
      },
    },
    { names: ["kg_path"] },
  );

  // ---------------------------------------------------------------------------
  // 7. Orphan Detection
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_orphans",
      label: "Orphan Detection",
      description:
        "Find unconnected (orphaned) infrastructure resources — resources with no " +
        "edges to any other resource. These are cleanup candidates or may indicate " +
        "missing relationship discovery.",
      parameters: Type.Object({}),
      async execute() {
        const orphans = await findOrphans(storage);

        if (orphans.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No orphaned resources found. All resources are connected in the graph.",
              },
            ],
            details: { count: 0 },
          };
        }

        const totalCost = orphans.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0);

        const summary = [
          `## Orphaned Resources`,
          "",
          `**${orphans.length}** unconnected resources found.`,
          `**Potential savings:** $${totalCost.toFixed(2)}/mo`,
          "",
          "| Resource | Type | Provider | Region | Status | Cost/mo |",
          "|----------|------|----------|--------|--------|---------|",
          ...orphans.map(
            (n) =>
              `| ${n.name} | ${n.resourceType} | ${n.provider} | ${n.region} | ${n.status} | ${n.costMonthly != null ? "$" + n.costMonthly.toFixed(2) : "—"} |`,
          ),
        ];

        return {
          content: [{ type: "text" as const, text: summary.join("\n") }],
          details: { count: orphans.length, potentialSavings: totalCost },
        };
      },
    },
    { names: ["kg_orphans"] },
  );

  // ---------------------------------------------------------------------------
  // 8. Graph Status / Stats
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_status",
      label: "Graph Status",
      description:
        "Get statistics about the infrastructure knowledge graph: total nodes, edges, " +
        "cost, breakdowns by provider and resource type, and last sync info.",
      parameters: Type.Object({}),
      async execute() {
        const stats = await engine.getStats();

        const summary = [
          `## Infrastructure Knowledge Graph Status`,
          "",
          `| Metric | Value |`,
          `|--------|-------|`,
          `| Total nodes | ${stats.totalNodes} |`,
          `| Total edges | ${stats.totalEdges} |`,
          `| Total changes | ${stats.totalChanges} |`,
          `| Total groups | ${stats.totalGroups} |`,
          `| Total cost | $${stats.totalCostMonthly.toFixed(2)}/mo |`,
          `| Last sync | ${stats.lastSyncAt ?? "never"} |`,
          "",
          "### Nodes by Provider",
          ...Object.entries(stats.nodesByProvider).map(([p, c]) => `- ${p}: ${c}`),
          "",
          "### Nodes by Type",
          ...Object.entries(stats.nodesByResourceType)
            .sort(([, a], [, b]) => b - a)
            .map(([t, c]) => `- ${t}: ${c}`),
          "",
          "### Edges by Relationship",
          ...Object.entries(stats.edgesByRelationshipType)
            .sort(([, a], [, b]) => b - a)
            .map(([t, c]) => `- ${t}: ${c}`),
        ];

        return {
          content: [{ type: "text" as const, text: summary.join("\n") }],
          details: stats,
        };
      },
    },
    { names: ["kg_status"] },
  );

  // ---------------------------------------------------------------------------
  // 9. Graph Export
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_export",
      label: "Export Topology",
      description:
        "Export the infrastructure graph topology in JSON, DOT (Graphviz), or Mermaid format. " +
        "Use JSON for data analysis, DOT for Graphviz visualization, Mermaid for docs/diagrams.",
      parameters: Type.Object({
        format: stringEnum(EXPORT_FORMATS, {
          description: "Export format: json, dot, or mermaid",
        }),
        provider: Type.Optional(
          stringEnum(PROVIDERS, { description: "Filter to a specific provider" }),
        ),
        includeCost: Type.Optional(
          Type.Boolean({ description: "Include cost data in export (default: true)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { format, provider, includeCost } = params as {
          format: "json" | "dot" | "mermaid";
          provider?: string;
          includeCost?: boolean;
        };

        const filter = provider
          ? { provider: provider as "aws" | "azure" | "gcp" }
          : {};

        const result = await exportTopology(storage, format, {
          filter,
          includeCost: includeCost ?? true,
          maxNodes: 500, // safety limit for agent context
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Exported ${result.nodeCount} nodes and ${result.edgeCount} edges as ${format}:\n\n\`\`\`${format === "json" ? "json" : format === "mermaid" ? "mermaid" : "dot"}\n${result.content}\n\`\`\``,
            },
          ],
          details: {
            format,
            nodeCount: result.nodeCount,
            edgeCount: result.edgeCount,
          },
        };
      },
    },
    { names: ["kg_export"] },
  );
}

// =============================================================================
// Governance Tools
// =============================================================================

const CHANGE_ACTIONS = ["create", "update", "delete", "scale", "reconfigure"] as const;
const INITIATOR_TYPES = ["human", "agent", "system"] as const;
const APPROVAL_STATUSES = ["pending", "approved", "rejected", "auto-approved"] as const;

/**
 * Register governance/audit agent tools with the Espada plugin API.
 */
export function registerGovernanceTools(
  api: EspadaPluginApi,
  governor: import("./governance.js").ChangeGovernor,
  _storage: GraphStorage,
): void {
  // ---------------------------------------------------------------------------
  // 10. Audit Trail
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_audit_trail",
      label: "Audit Trail",
      description:
        "Query the infrastructure change audit trail. " +
        "Shows who changed what, when, risk scores, and approval status. " +
        "Filter by initiator (human/agent), time range, resource, or status.",
      parameters: Type.Object({
        initiator: Type.Optional(
          Type.String({ description: "Filter by initiator name (human username or agent ID)" }),
        ),
        initiatorType: Type.Optional(
          stringEnum(INITIATOR_TYPES, { description: "Filter by initiator type" }),
        ),
        targetResourceId: Type.Optional(
          Type.String({ description: "Filter by target resource ID" }),
        ),
        status: Type.Optional(
          stringEnum(APPROVAL_STATUSES, { description: "Filter by approval status" }),
        ),
        since: Type.Optional(
          Type.String({ description: "Show changes after this ISO 8601 date" }),
        ),
        limit: Type.Optional(
          Type.Number({ description: "Maximum results (default: 25)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const p = params as {
          initiator?: string;
          initiatorType?: "human" | "agent" | "system";
          targetResourceId?: string;
          status?: "pending" | "approved" | "rejected" | "auto-approved";
          since?: string;
          limit?: number;
        };

        const trail = governor.getAuditTrail({
          initiator: p.initiator,
          initiatorType: p.initiatorType,
          targetResourceId: p.targetResourceId,
          status: p.status,
          since: p.since,
          limit: p.limit ?? 25,
        });

        if (trail.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No change requests found matching the filters." }],
            details: { count: 0 },
          };
        }

        const rows = trail.map((r) =>
          `| ${r.createdAt.slice(0, 19)} | ${r.initiator} (${r.initiatorType}) | ${r.action} | ${r.resourceType} | ${r.risk.level} (${r.risk.score}) | ${r.status} |`,
        );

        const summary = [
          `## Audit Trail (${trail.length} results)`,
          "",
          "| Time | Initiator | Action | Resource Type | Risk | Status |",
          "|------|-----------|--------|---------------|------|--------|",
          ...rows,
        ];

        return {
          content: [{ type: "text" as const, text: summary.join("\n") }],
          details: { count: trail.length, requests: trail },
        };
      },
    },
    { names: ["kg_audit_trail"] },
  );

  // ---------------------------------------------------------------------------
  // 11. Request Approval
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_request_change",
      label: "Request Infrastructure Change",
      description:
        "Submit an infrastructure change for governance review. " +
        "The change will be risk-scored and either auto-approved or queued for manual approval. " +
        "Use before making any infrastructure modifications.",
      parameters: Type.Object({
        targetResourceId: Type.String({
          description: "Graph node ID of the resource to modify",
        }),
        resourceType: Type.String({
          description: "Resource type (e.g. ec2-instance, s3-bucket, rds-instance)",
        }),
        provider: stringEnum(PROVIDERS, {
          description: "Cloud provider",
        }),
        action: stringEnum(CHANGE_ACTIONS, {
          description: "The action to perform",
        }),
        description: Type.String({
          description: "Description of the intended change",
        }),
      }),
      async execute(_toolCallId, params) {
        const p = params as {
          targetResourceId: string;
          resourceType: string;
          provider: string;
          action: "create" | "update" | "delete" | "scale" | "reconfigure";
          description: string;
        };

        const request = await governor.interceptChange({
          initiator: "agent",
          initiatorType: "agent",
          targetResourceId: p.targetResourceId,
          resourceType: p.resourceType as import("./types.js").GraphResourceType,
          provider: p.provider as import("./types.js").CloudProvider,
          action: p.action,
          description: p.description,
        });

        const statusEmoji =
          request.status === "auto-approved" ? "✓" :
          request.status === "pending" ? "⏳" :
          request.status === "approved" ? "✓" :
          "✗";

        const summary = [
          `## Change Request: ${statusEmoji} ${request.status.toUpperCase()}`,
          "",
          `**Request ID:** ${request.id}`,
          `**Action:** ${request.action} ${request.resourceType}`,
          `**Target:** ${request.targetResourceId}`,
          `**Risk:** ${request.risk.level} (score: ${request.risk.score}/100)`,
          "",
          "### Risk Factors",
          ...request.risk.factors.map((f) => `- ${f}`),
          "",
        ];

        if (request.policyViolations.length > 0) {
          summary.push(
            "### Policy Violations",
            ...request.policyViolations.map((v) => `- ⚠ ${v}`),
            "",
          );
        }

        if (request.status === "pending") {
          summary.push(
            "**Action required:** This change needs manual approval before proceeding.",
          );
        }

        return {
          content: [{ type: "text" as const, text: summary.join("\n") }],
          details: request,
        };
      },
    },
    { names: ["kg_request_change"] },
  );

  // ---------------------------------------------------------------------------
  // 12. Governance Summary
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_governance_summary",
      label: "Governance Summary",
      description:
        "Get a dashboard summary of infrastructure governance activity: " +
        "changes per agent, approval rates, risk distribution, and policy violations.",
      parameters: Type.Object({
        since: Type.Optional(
          Type.String({ description: "Start of period (ISO 8601). Default: last 7 days." }),
        ),
        until: Type.Optional(
          Type.String({ description: "End of period (ISO 8601). Default: now." }),
        ),
      }),
      async execute(_toolCallId, params) {
        const p = params as { since?: string; until?: string };

        const summary = governor.getSummary(p.since, p.until);

        const lines = [
          "## Infrastructure Governance Summary",
          "",
          `**Period:** ${summary.period.since.slice(0, 10)} to ${summary.period.until.slice(0, 10)}`,
          `**Total requests:** ${summary.totalRequests}`,
          `**Avg risk score:** ${summary.avgRiskScore}/100`,
          `**Policy violations:** ${summary.policyViolationCount}`,
          "",
          "### By Status",
          ...Object.entries(summary.byStatus).map(([s, c]) => `- ${s}: ${c}`),
          "",
          "### By Initiator",
          ...Object.entries(summary.byInitiator)
            .sort(([, a], [, b]) => b - a)
            .map(([name, c]) => `- ${name}: ${c} changes`),
          "",
          "### By Risk Level",
          ...Object.entries(summary.byRiskLevel).map(([l, c]) => `- ${l}: ${c}`),
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: summary,
        };
      },
    },
    { names: ["kg_governance_summary"] },
  );

  // ---------------------------------------------------------------------------
  // 13. Check Pending Approvals
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_pending_approvals",
      label: "Pending Approvals",
      description:
        "List all infrastructure changes currently awaiting manual approval. " +
        "Shows risk assessment and policy violations for each pending request.",
      parameters: Type.Object({}),
      async execute() {
        const pending = governor.getPendingRequests();

        if (pending.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No pending approval requests." }],
            details: { count: 0 },
          };
        }

        const lines = [
          `## Pending Approvals (${pending.length})`,
          "",
          "| ID | Initiator | Action | Resource | Risk | Violations |",
          "|----|-----------|--------|----------|------|------------|",
          ...pending.map((r) =>
            `| ${r.id.slice(-8)} | ${r.initiator} | ${r.action} | ${r.resourceType} | ${r.risk.level} (${r.risk.score}) | ${r.policyViolations.length} |`,
          ),
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: { count: pending.length, requests: pending },
        };
      },
    },
    { names: ["kg_pending_approvals"] },
  );
}

// =============================================================================
// Temporal Knowledge Graph Tools
// =============================================================================

const SNAPSHOT_TRIGGERS = ["sync", "manual", "scheduled"] as const;

/**
 * Register temporal / time-travel agent tools with the Espada plugin API.
 */
export function registerTemporalTools(
  api: EspadaPluginApi,
  temporal: TemporalGraphStorage,
): void {
  // ---------------------------------------------------------------------------
  // 14. Time Travel — view graph at a point in time
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_time_travel",
      label: "Time Travel",
      description:
        "View the infrastructure graph as it existed at a specific point in time. " +
        "Shows nodes, edges, and costs from a historical snapshot. " +
        "Use when investigating past incidents or tracking infrastructure evolution.",
      parameters: Type.Object({
        timestamp: Type.String({
          description:
            "ISO 8601 timestamp to travel to (e.g. 2024-11-15T10:00:00Z). " +
            "Returns the closest snapshot at or before this time.",
        }),
        provider: Type.Optional(
          stringEnum(PROVIDERS, {
            description: "Filter by cloud provider",
          }),
        ),
        resourceType: Type.Optional(
          Type.String({
            description: "Filter by resource type (e.g. compute, database, storage)",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { timestamp, provider, resourceType } = params as {
          timestamp: string;
          provider?: string;
          resourceType?: string;
        };

        const filter: import("./types.js").NodeFilter = {};
        if (provider) filter.provider = provider as import("./types.js").CloudProvider;
        if (resourceType) filter.resourceType = resourceType as import("./types.js").GraphResourceType;

        const result = await getTopologyAt(temporal, timestamp, filter);

        if (!result) {
          return {
            content: [{ type: "text" as const, text: "No snapshots found at or before the given timestamp." }],
            details: { timestamp, found: false },
          };
        }

        const totalCost = result.nodes.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0);

        const lines = [
          `## Infrastructure at ${result.snapshot.createdAt}`,
          "",
          `**Snapshot:** ${result.snapshot.id}`,
          `**Trigger:** ${result.snapshot.trigger}`,
          `**Nodes:** ${result.nodes.length}`,
          `**Edges:** ${result.edges.length}`,
          `**Total cost:** $${totalCost.toFixed(2)}/mo`,
          "",
          "### Resources",
          "| Name | Type | Provider | Region | Status | Cost/mo |",
          "|------|------|----------|--------|--------|---------|",
          ...result.nodes.slice(0, 50).map((n) =>
            `| ${n.name} | ${n.resourceType} | ${n.provider} | ${n.region} | ${n.status} | ${n.costMonthly != null ? "$" + n.costMonthly.toFixed(2) : "—"} |`,
          ),
        ];

        if (result.nodes.length > 50) {
          lines.push(`\n*...and ${result.nodes.length - 50} more resources*`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            snapshotId: result.snapshot.id,
            snapshotTime: result.snapshot.createdAt,
            nodeCount: result.nodes.length,
            edgeCount: result.edges.length,
            totalCost,
          },
        };
      },
    },
    { names: ["kg_time_travel"] },
  );

  // ---------------------------------------------------------------------------
  // 15. Snapshot Diff — compare two points in time
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_diff",
      label: "Snapshot Diff",
      description:
        "Compare the infrastructure graph between two points in time. " +
        "Shows added, removed, and changed resources plus cost delta. " +
        "Use to understand what changed between incidents, deployments, or time periods.",
      parameters: Type.Object({
        from: Type.String({
          description:
            "Start timestamp (ISO 8601) or snapshot ID. " +
            "If a timestamp, uses the closest snapshot at or before that time.",
        }),
        to: Type.String({
          description:
            "End timestamp (ISO 8601) or snapshot ID. " +
            "If a timestamp, uses the closest snapshot at or before that time.",
        }),
      }),
      async execute(_toolCallId, params) {
        const { from, to } = params as { from: string; to: string };

        // Determine if IDs or timestamps
        const isSnapshotId = (s: string) => s.startsWith("snap-");
        let diff: import("./temporal.js").SnapshotDiff | null;

        if (isSnapshotId(from) && isSnapshotId(to)) {
          diff = await diffSnapshotsFn(temporal, from, to);
        } else {
          diff = await diffTimestamps(temporal, from, to);
        }

        if (!diff) {
          return {
            content: [{ type: "text" as const, text: "Could not find snapshots for the specified time range." }],
            details: { from, to, found: false },
          };
        }

        const lines = [
          `## Infrastructure Diff`,
          "",
          `**From:** ${diff.fromSnapshot.createdAt} (${diff.fromSnapshot.id})`,
          `**To:** ${diff.toSnapshot.createdAt} (${diff.toSnapshot.id})`,
          `**Cost delta:** ${diff.costDelta >= 0 ? "+" : ""}$${diff.costDelta.toFixed(2)}/mo`,
          "",
        ];

        if (diff.addedNodes.length > 0) {
          lines.push(
            `### Added Resources (+${diff.addedNodes.length})`,
            "| Name | Type | Provider | Cost/mo |",
            "|------|------|----------|---------|",
            ...diff.addedNodes.slice(0, 25).map((n) =>
              `| ${n.name} | ${n.resourceType} | ${n.provider} | ${n.costMonthly != null ? "$" + n.costMonthly.toFixed(2) : "—"} |`,
            ),
            "",
          );
        }

        if (diff.removedNodes.length > 0) {
          lines.push(
            `### Removed Resources (-${diff.removedNodes.length})`,
            "| Name | Type | Provider | Cost/mo |",
            "|------|------|----------|---------|",
            ...diff.removedNodes.slice(0, 25).map((n) =>
              `| ${n.name} | ${n.resourceType} | ${n.provider} | ${n.costMonthly != null ? "$" + n.costMonthly.toFixed(2) : "—"} |`,
            ),
            "",
          );
        }

        if (diff.changedNodes.length > 0) {
          lines.push(
            `### Changed Resources (~${diff.changedNodes.length})`,
            "| Resource | Changed Fields |",
            "|----------|----------------|",
            ...diff.changedNodes.slice(0, 25).map((c) =>
              `| ${c.before.name} | ${c.changedFields.join(", ")} |`,
            ),
            "",
          );
        }

        if (diff.addedEdges.length > 0 || diff.removedEdges.length > 0) {
          lines.push(
            `### Relationship Changes`,
            `- Added: ${diff.addedEdges.length}`,
            `- Removed: ${diff.removedEdges.length}`,
            "",
          );
        }

        if (
          diff.addedNodes.length === 0 &&
          diff.removedNodes.length === 0 &&
          diff.changedNodes.length === 0
        ) {
          lines.push("No changes between these snapshots.");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            fromSnapshot: diff.fromSnapshot.id,
            toSnapshot: diff.toSnapshot.id,
            addedCount: diff.addedNodes.length,
            removedCount: diff.removedNodes.length,
            changedCount: diff.changedNodes.length,
            addedEdges: diff.addedEdges.length,
            removedEdges: diff.removedEdges.length,
            costDelta: diff.costDelta,
          },
        };
      },
    },
    { names: ["kg_diff"] },
  );

  // ---------------------------------------------------------------------------
  // 16. Node History — track changes to a specific resource over time
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_node_history",
      label: "Node History",
      description:
        "View the history of a specific infrastructure resource across snapshots. " +
        "Shows how its status, cost, tags, and metadata changed over time. " +
        "Use when investigating a resource's lifecycle or debugging drift.",
      parameters: Type.Object({
        nodeId: Type.String({
          description: "The graph node ID of the resource to track",
        }),
        limit: Type.Optional(
          Type.Number({
            description: "Max number of history entries to return (default: 20)",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { nodeId, limit } = params as { nodeId: string; limit?: number };
        const maxEntries = Math.min(limit ?? 20, 100);

        const history = await getNodeHistoryFn(temporal, nodeId, maxEntries);

        if (history.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No history found for node: ${nodeId}` }],
            details: { nodeId, entries: 0 },
          };
        }

        const lines = [
          `## History: ${history[0]!.node.name} (${nodeId})`,
          "",
          `**Snapshots:** ${history.length}`,
          "",
          "### Timeline",
        ];

        // Show changes between consecutive entries
        for (let i = 0; i < history.length; i++) {
          const entry = history[i]!;
          const prev = i + 1 < history.length ? history[i + 1]! : null;

          lines.push(`\n#### ${entry.snapshotCreatedAt}`);
          lines.push(`Status: ${entry.node.status} | Cost: $${entry.node.costMonthly?.toFixed(2) ?? "—"}/mo`);

          if (prev) {
            const changes: string[] = [];
            if (prev.node.status !== entry.node.status) {
              changes.push(`status: ${prev.node.status} → ${entry.node.status}`);
            }
            if (prev.node.costMonthly !== entry.node.costMonthly) {
              changes.push(
                `cost: $${prev.node.costMonthly?.toFixed(2) ?? "—"} → $${entry.node.costMonthly?.toFixed(2) ?? "—"}`,
              );
            }
            if (JSON.stringify(prev.node.tags) !== JSON.stringify(entry.node.tags)) {
              changes.push("tags changed");
            }
            if (JSON.stringify(prev.node.metadata) !== JSON.stringify(entry.node.metadata)) {
              changes.push("metadata changed");
            }
            if (changes.length > 0) {
              lines.push(`Changes: ${changes.join("; ")}`);
            }
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            nodeId,
            entries: history.length,
            currentStatus: history[0]!.node.status,
            currentCost: history[0]!.node.costMonthly,
          },
        };
      },
    },
    { names: ["kg_node_history"] },
  );

  // ---------------------------------------------------------------------------
  // 17. Evolution Summary — graph trends over time
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_evolution",
      label: "Infrastructure Evolution",
      description:
        "Get an overview of how infrastructure has evolved over time. " +
        "Shows node count trends, cost trends, and net changes. " +
        "Use for executive summaries or reporting on infrastructure growth.",
      parameters: Type.Object({
        since: Type.Optional(
          Type.String({
            description: "Start of period (ISO 8601). Default: all history.",
          }),
        ),
        until: Type.Optional(
          Type.String({
            description: "End of period (ISO 8601). Default: now.",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { since, until } = params as { since?: string; until?: string };

        const summary = await getEvolutionSummary(temporal, since, until);

        if (summary.snapshots.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No snapshots found for the specified period." }],
            details: { snapshots: 0 },
          };
        }

        const lines = [
          "## Infrastructure Evolution",
          "",
          `**Snapshots:** ${summary.snapshots.length}`,
          `**Net nodes added:** ${summary.netChange.nodesAdded}`,
          `**Net nodes removed:** ${summary.netChange.nodesRemoved}`,
          `**Cost delta:** ${summary.netChange.costDelta >= 0 ? "+" : ""}$${summary.netChange.costDelta.toFixed(2)}/mo`,
          "",
          "### Node Count Trend",
          ...summary.nodeCountTrend.map((p) => `- ${p.timestamp.slice(0, 16)}: ${p.count} nodes`),
          "",
          "### Cost Trend",
          ...summary.costTrend.map((p) => `- ${p.timestamp.slice(0, 16)}: $${p.cost.toFixed(2)}/mo`),
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: summary,
        };
      },
    },
    { names: ["kg_evolution"] },
  );

  // ---------------------------------------------------------------------------
  // 18. Create Snapshot — manually capture current state
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_snapshot",
      label: "Create Snapshot",
      description:
        "Take a manual snapshot of the current infrastructure graph. " +
        "Useful before making changes, as a checkpoint, or for periodic archival. " +
        "Snapshots enable time-travel queries and diffing.",
      parameters: Type.Object({
        label: Type.Optional(
          Type.String({
            description:
              "Human-readable label for this snapshot (e.g. 'pre-deployment', 'quarterly-review')",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { label } = params as { label?: string };

        const snapshot = await takeSnapshot(temporal, "manual", label);

        const lines = [
          "## Snapshot Created",
          "",
          `**ID:** ${snapshot.id}`,
          `**Time:** ${snapshot.createdAt}`,
          `**Label:** ${snapshot.label ?? "(none)"}`,
          `**Nodes:** ${snapshot.nodeCount}`,
          `**Edges:** ${snapshot.edgeCount}`,
          `**Total cost:** $${snapshot.totalCostMonthly.toFixed(2)}/mo`,
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: snapshot,
        };
      },
    },
    { names: ["kg_snapshot"] },
  );

  // ---------------------------------------------------------------------------
  // 19. List Snapshots — browse available snapshots
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_list_snapshots",
      label: "List Snapshots",
      description:
        "List available infrastructure graph snapshots. " +
        "Shows snapshot IDs, timestamps, trigger types, and resource counts. " +
        "Use to find snapshot IDs for time-travel or diff queries.",
      parameters: Type.Object({
        trigger: Type.Optional(
          stringEnum(SNAPSHOT_TRIGGERS, {
            description: "Filter by trigger type",
          }),
        ),
        limit: Type.Optional(
          Type.Number({
            description: "Max number of snapshots to list (default: 20)",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { trigger, limit } = params as {
          trigger?: "sync" | "manual" | "scheduled";
          limit?: number;
        };

        const snapshots = await temporal.listSnapshots({
          trigger,
          limit: Math.min(limit ?? 20, 100),
        });

        if (snapshots.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No snapshots found." }],
            details: { count: 0 },
          };
        }

        const lines = [
          `## Snapshots (${snapshots.length})`,
          "",
          "| ID | Time | Trigger | Nodes | Edges | Cost/mo | Label |",
          "|----|------|---------|-------|-------|---------|-------|",
          ...snapshots.map((s) =>
            `| ${s.id} | ${s.createdAt.slice(0, 19)} | ${s.trigger} | ${s.nodeCount} | ${s.edgeCount} | $${s.totalCostMonthly.toFixed(2)} | ${s.label ?? "—"} |`,
          ),
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: { count: snapshots.length, snapshots },
        };
      },
    },
    { names: ["kg_list_snapshots"] },
  );
}

// =============================================================================
// IQL (Infrastructure Query Language) Tools — Tool 20
// =============================================================================

/**
 * Register IQL tools with the Espada plugin API.
 */
export function registerIQLTools(
  api: EspadaPluginApi,
  storage: GraphStorage,
  temporal?: TemporalGraphStorage,
): void {
  // ---------------------------------------------------------------------------
  // 20. IQL Query
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_query",
      label: "Infrastructure Query (IQL)",
      description:
        "Execute an Infrastructure Query Language (IQL) query against the knowledge graph. " +
        "IQL is a purpose-built language for querying infrastructure resources.\n\n" +
        "Query types:\n" +
        "- FIND resources WHERE provider = 'aws' AND cost > $1000/mo\n" +
        "- FIND downstream OF '<nodeId>' WHERE depth <= 3\n" +
        "- FIND PATH FROM '<pattern>' TO '<pattern>'\n" +
        "- SUMMARIZE cost BY provider, resourceType WHERE ...\n" +
        "- FIND resources AT '<timestamp>' DIFF WITH NOW\n\n" +
        "WHERE supports: =, !=, >, <, >=, <=, LIKE, IN, MATCHES, AND, OR, NOT\n" +
        "Functions: tagged('<key>'), drifted_since('<date>'), has_edge('<type>'), " +
        "created_after('<date>'), created_before('<date>')\n" +
        "Fields: provider, resourceType, region, account, status, name, owner, cost, " +
        "tag.<Key>, metadata.<key>",
      parameters: Type.Object({
        query: Type.String({
          description:
            "IQL query string. Examples:\n" +
            "  FIND resources WHERE provider = 'aws'\n" +
            "  FIND resources WHERE cost > $500/mo AND NOT tagged('Owner')\n" +
            "  FIND PATH FROM 'aws:*:*:load-balancer:*' TO 'aws:*:*:database:*'\n" +
            "  SUMMARIZE cost BY provider, resourceType",
        }),
      }),
      async execute(_toolCallId, params) {
        const { query } = params as { query: string };

        try {
          const ast = parseIQL(query);
          const execOpts: IQLExecutorOptions = {
            storage,
            temporal,
            defaultLimit: 200,
            maxTraversalDepth: 8,
          };
          const result = await executeQuery(ast, execOpts);

          if (result.type === "find") {
            const lines = [
              `## IQL Results (${result.totalCount} resources, $${result.totalCost.toFixed(2)}/mo)`,
              "",
            ];
            if (result.nodes.length > 0) {
              lines.push(
                "| Name | Provider | Type | Region | Status | Cost/mo |",
                "|------|----------|------|--------|--------|---------|",
                ...result.nodes.map(
                  (n) =>
                    `| ${n.name} | ${n.provider} | ${n.resourceType} | ${n.region} | ${n.status} | ${n.costMonthly != null ? "$" + n.costMonthly.toFixed(2) : "—"} |`,
                ),
              );
            } else {
              lines.push("No matching resources found.");
            }
            return {
              content: [{ type: "text" as const, text: lines.join("\n") }],
              details: result,
            };
          }

          if (result.type === "summarize") {
            const lines = [
              `## IQL Summary (total: ${result.total})`,
              "",
            ];
            if (result.groups.length > 0) {
              const keys = Object.keys(result.groups[0].key);
              lines.push(
                `| ${keys.join(" | ")} | Value |`,
                `| ${keys.map(() => "---").join(" | ")} | ----- |`,
                ...result.groups.map(
                  (g) =>
                    `| ${keys.map((k) => g.key[k]).join(" | ")} | ${g.value.toFixed(2)} |`,
                ),
              );
            }
            return {
              content: [{ type: "text" as const, text: lines.join("\n") }],
              details: result,
            };
          }

          if (result.type === "path") {
            const lines = result.found
              ? [
                  `## Path Found (${result.hops} hops)`,
                  "",
                  ...result.path.map(
                    (n, i) =>
                      `${i + 1}. **${n.name}** (${n.resourceType})` +
                      (i < result.edges.length
                        ? ` → _${result.edges[i].relationshipType}_`
                        : ""),
                  ),
                ]
              : ["## No Path Found", "", "No path exists between the given resources."];
            return {
              content: [{ type: "text" as const, text: lines.join("\n") }],
              details: result,
            };
          }

          if (result.type === "diff") {
            const lines = [
              `## Infrastructure Diff`,
              `From: ${result.fromTimestamp} → To: ${result.toTimestamp}`,
              "",
              `- Added: ${result.added}`,
              `- Removed: ${result.removed}`,
              `- Changed: ${result.changed}`,
              `- Cost delta: $${result.costDelta.toFixed(2)}/mo`,
            ];
            if (result.details.length > 0) {
              lines.push(
                "",
                "| Node | Change | Fields |",
                "|------|--------|--------|",
                ...result.details.slice(0, 50).map(
                  (d) =>
                    `| ${d.name} | ${d.change} | ${d.changedFields?.join(", ") ?? "—"} |`,
                ),
              );
            }
            return {
              content: [{ type: "text" as const, text: lines.join("\n") }],
              details: result,
            };
          }

          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        } catch (err) {
          const msg =
            err instanceof IQLSyntaxError
              ? `**IQL Syntax Error:** ${err.message}`
              : `**Query Error:** ${err instanceof Error ? err.message : String(err)}`;
          return {
            content: [{ type: "text" as const, text: msg }],
            details: { error: true },
          };
        }
      },
    },
    { names: ["kg_query"] },
  );
}

// =============================================================================
// P2 Tool Registration
// =============================================================================

const COMPLIANCE_FRAMEWORKS = ["soc2", "hipaa", "pci-dss", "iso-27001"] as const;
const IAC_FORMATS = ["terraform", "cloudformation"] as const;
const VIZ_FORMATS = ["cytoscape", "d3-force"] as const;
const LAYOUT_STRATEGIES = ["force-directed", "hierarchical", "circular", "grid", "concentric"] as const;

/**
 * Register P2 knowledge graph tools (compliance, recommendations, agents,
 * NL query, remediation, supply chain, visualization).
 */
export function registerP2Tools(
  api: EspadaPluginApi,
  engine: GraphEngine,
  storage: GraphStorage,
): void {
  // ---------------------------------------------------------------------------
  // Compliance Assessment
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_compliance",
      label: "Compliance Check",
      description:
        "Run a compliance assessment against infrastructure resources. " +
        "Evaluates SOC2, HIPAA, PCI-DSS, ISO 27001, CIS, and NIST 800-53 controls. " +
        "Returns pass/fail for each control with remediation guidance.",
      parameters: Type.Object({
        framework: Type.Optional(
          stringEnum(COMPLIANCE_FRAMEWORKS, {
            description: "Specific framework to evaluate (default: all)",
          }),
        ),
        provider: Type.Optional(
          stringEnum(PROVIDERS, { description: "Filter by cloud provider" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { framework, provider } = params as {
          framework?: string;
          provider?: string;
        };

        try {
          const frameworks = framework
            ? [framework as ComplianceFramework]
            : (SUPPORTED_FRAMEWORKS as unknown as ComplianceFramework[]);

          const filter = provider ? { provider: provider as CloudProvider } : undefined;
          const report = await runComplianceAssessment(frameworks, storage, filter);
          const md = formatComplianceMarkdown(report);

          return {
            content: [{ type: "text" as const, text: md }],
            details: {
              frameworks: report.frameworks.map((f) => f.framework),
              totalResources: report.totalResources,
              frameworkCount: report.frameworks.length,
            },
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Compliance assessment failed: ${err instanceof Error ? err.message : String(err)}` }],
            details: { error: true },
          };
        }
      },
    },
    { names: ["kg_compliance"] },
  );

  // ---------------------------------------------------------------------------
  // Recommendations
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_recommendations",
      label: "Recommendations",
      description:
        "Analyze infrastructure for optimization recommendations. " +
        "Detects unused resources, idle resources, missing tags, security issues, " +
        "reliability weaknesses, right-sizing opportunities, and architecture problems.",
      parameters: Type.Object({
        provider: Type.Optional(
          stringEnum(PROVIDERS, { description: "Filter by cloud provider" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { provider } = params as { provider?: string };
        try {
          const filter = provider ? { provider: provider as CloudProvider } : undefined;
          const report = await generateRecommendations(engine, storage, filter);
          const md = formatRecommendationsMarkdown(report);

          return {
            content: [{ type: "text" as const, text: md }],
            details: {
              totalRecommendations: report.totalRecommendations,
              estimatedSavings: report.totalEstimatedSavings,
              byCategory: report.byCategory,
            },
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Recommendations analysis failed: ${err instanceof Error ? err.message : String(err)}` }],
            details: { error: true },
          };
        }
      },
    },
    { names: ["kg_recommendations"] },
  );

  // ---------------------------------------------------------------------------
  // Agent Activity Report
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_agents",
      label: "Agent Activity",
      description:
        "Review AI agent activity on infrastructure. Shows which agents are " +
        "modifying which resources, detects conflicts between agents, and " +
        "provides activity summaries.",
      parameters: Type.Object({
        agentId: Type.Optional(
          Type.String({ description: "Filter to a specific agent ID" }),
        ),
        since: Type.Optional(
          Type.String({ description: "ISO 8601 timestamp to filter recent activity (e.g. 2024-01-01T00:00:00Z)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { agentId, since } = params as { agentId?: string; since?: string };
        try {
          const report = await generateAgentReport(storage, since);

          // Filter to specific agent if requested
          if (agentId) {
            const agentNodeId = buildAgentNodeId(agentId);
            report.agents = report.agents.filter(
              (a) => a.agentNodeId === agentNodeId,
            );
            report.conflicts = report.conflicts.filter(
              (c) => c.agent1Id === agentNodeId || c.agent2Id === agentNodeId,
            );
            report.totalAgents = report.agents.length;
            report.totalActions = report.agents.reduce(
              (sum, a) => sum + a.totalActions,
              0,
            );
          }

          const md = formatAgentReportMarkdown(report);

          return {
            content: [{ type: "text" as const, text: md }],
            details: {
              totalAgents: report.totalAgents,
              totalActions: report.totalActions,
              conflicts: report.conflicts.length,
            },
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Agent activity report failed: ${err instanceof Error ? err.message : String(err)}` }],
            details: { error: true },
          };
        }
      },
    },
    { names: ["kg_agents"] },
  );

  // ---------------------------------------------------------------------------
  // Natural Language Query
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_ask",
      label: "Ask Infrastructure",
      description:
        "Ask a natural language question about your infrastructure. " +
        "Translates the question to IQL and runs it. " +
        "Examples: 'show all databases', 'what depends on my load balancer', " +
        "'how much do compute resources cost'.",
      parameters: Type.Object({
        question: Type.String({
          description: "Natural language question about infrastructure",
        }),
      }),
      async execute(_toolCallId, params) {
        const { question } = params as { question: string };
        const translation = translateNLToIQL(question);

        if (!translation.success || !translation.iql) {
          const examples = getExampleQueries();
          const text = [
            "Could not translate the question to a query.",
            translation.explanation ? `Reason: ${translation.explanation}` : "",
            "",
            "**Try questions like:**",
            ...examples.slice(0, 5).map((e) => `- ${e.natural}`),
          ]
            .filter(Boolean)
            .join("\n");

          return {
            content: [{ type: "text" as const, text }],
            details: { success: false, suggestions: translation.suggestions },
          };
        }

        // Execute the translated query
        try {
          const ast = translation.ast!;
          const result = await executeQuery(ast, { storage });

          const lines = [
            `**Question:** ${question}`,
            `**IQL:** \`${translation.iql}\``,
            `**Confidence:** ${(translation.confidence * 100).toFixed(0)}%`,
            "",
          ];

          if (result.type === "find") {
            lines.push(
              `Found ${result.nodes.length} resources:`,
              "",
              "| Name | Type | Provider | Status |",
              "|------|------|----------|--------|",
              ...result.nodes.slice(0, 50).map(
                (n) => `| ${n.name} | ${n.resourceType} | ${n.provider} | ${n.status} |`,
              ),
            );
          } else {
            lines.push("```json", JSON.stringify(result, null, 2), "```");
          }

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            details: {
              success: true,
              iql: translation.iql,
              confidence: translation.confidence,
              resultType: result.type,
            },
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Translated to IQL: \`${translation.iql}\` but execution failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            details: { success: false, iql: translation.iql },
          };
        }
      },
    },
    { names: ["kg_ask"] },
  );

  // ---------------------------------------------------------------------------
  // Drift Remediation
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_remediation",
      label: "Drift Remediation",
      description:
        "Generate IaC patches (Terraform HCL or CloudFormation YAML) to fix " +
        "infrastructure drift. Scans for drift and generates corrective patches.",
      parameters: Type.Object({
        iacFormat: Type.Optional(
          stringEnum(IAC_FORMATS, {
            description: "Output format: terraform (default) or cloudformation",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { iacFormat } = params as { iacFormat?: string };
        const fmt = (iacFormat ?? "terraform") as IaCFormat;

        try {
          // Run drift scan first
          const drift = await engine.detectDrift();
          if (drift.driftedNodes.length === 0 && drift.disappearedNodes.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No drift detected — infrastructure matches the graph state.",
                },
              ],
              details: { drifted: 0 },
            };
          }

          const plan = generateRemediationPlan(drift, fmt);
          const md = formatRemediationMarkdown(plan);

          return {
            content: [{ type: "text" as const, text: md }],
            details: {
              totalPatches: plan.totalPatches,
              autoRemediable: plan.autoRemediable.length,
              manualReview: plan.manualReview.length,
              unremeditable: plan.unremeditable.length,
            },
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Drift remediation failed: ${err instanceof Error ? err.message : String(err)}` }],
            details: { error: true },
          };
        }
      },
    },
    { names: ["kg_remediation"] },
  );

  // ---------------------------------------------------------------------------
  // Supply Chain Report
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_supply_chain",
      label: "Supply Chain",
      description:
        "Generate a software supply chain security report. Shows container images, " +
        "packages, and known vulnerabilities (CVEs) across the infrastructure.",
      parameters: Type.Object({
        provider: Type.Optional(
          stringEnum(PROVIDERS, { description: "Filter by cloud provider" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { provider } = params as { provider?: string };
        try {
          const report = await generateSupplyChainReport(
            storage,
            provider as CloudProvider | undefined,
          );
          const md = formatSupplyChainMarkdown(report);

          return {
            content: [{ type: "text" as const, text: md }],
            details: {
              totalImages: report.totalImages,
              totalPackages: report.totalPackages,
              totalVulnerabilities: report.totalVulnerabilities,
              criticalVulnerabilities: report.criticalVulnerabilities,
            },
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Supply chain report failed: ${err instanceof Error ? err.message : String(err)}` }],
            details: { error: true },
          };
        }
      },
    },
    { names: ["kg_supply_chain"] },
  );

  // ---------------------------------------------------------------------------
  // Graph Visualization
  // ---------------------------------------------------------------------------
  api.registerTool(
    {
      name: "kg_visualize",
      label: "Visualize Graph",
      description:
        "Export infrastructure graph in a visualization-ready format (Cytoscape.js or D3). " +
        "Returns JSON data with nodes, edges, styling, and layout configuration.",
      parameters: Type.Object({
        vizFormat: Type.Optional(
          stringEnum(VIZ_FORMATS, {
            description: "Visualization format: cytoscape (default) or d3-force",
          }),
        ),
        layout: Type.Optional(
          stringEnum(LAYOUT_STRATEGIES, {
            description: "Layout strategy (default: force-directed)",
          }),
        ),
        provider: Type.Optional(
          stringEnum(PROVIDERS, { description: "Filter by cloud provider" }),
        ),
        highlightNodeId: Type.Optional(
          Type.String({
            description: "Highlight a specific node and its neighborhood",
          }),
        ),
        maxNodes: Type.Optional(
          Type.Number({ description: "Max nodes to include (default: 500)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { vizFormat, layout, provider, highlightNodeId, maxNodes } =
          params as {
            vizFormat?: string;
            layout?: string;
            provider?: string;
            highlightNodeId?: string;
            maxNodes?: number;
          };

        try {
          const result = await exportVisualization(
            storage,
            (vizFormat ?? "cytoscape") as VisualizationFormat,
            {
              filter: provider ? { provider: provider as CloudProvider } : undefined,
              layout: (layout ?? "force-directed") as LayoutStrategy,
              highlightNodeId,
              maxNodes,
              includeCost: true,
              includeMetadata: true,
              groupByProvider: true,
            },
          );

          const summary = [
            `## Graph Visualization (${result.format})`,
            "",
            `- **Nodes:** ${result.nodeCount}`,
            `- **Edges:** ${result.edgeCount}`,
            `- **Groups:** ${result.groupCount}`,
            "",
            "Graph data exported. Use the attached JSON with a " +
              (result.format === "cytoscape" ? "Cytoscape.js" : "D3.js") +
              " renderer to view the interactive graph.",
          ];

          return {
            content: [
              { type: "text" as const, text: summary.join("\n") },
              { type: "text" as const, text: result.content },
            ],
            details: {
              format: result.format,
              nodeCount: result.nodeCount,
              edgeCount: result.edgeCount,
              groupCount: result.groupCount,
            },
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Graph visualization failed: ${err instanceof Error ? err.message : String(err)}` }],
            details: { error: true },
          };
        }
      },
    },
    { names: ["kg_visualize"] },
  );
}
