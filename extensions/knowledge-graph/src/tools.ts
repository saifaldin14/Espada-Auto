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
import type { GraphStorage } from "./types.js";
import {
  shortestPath,
  findOrphans,
  findSinglePointsOfFailure,
} from "./queries.js";
import { exportTopology } from "./export.js";

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
