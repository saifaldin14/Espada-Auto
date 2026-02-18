/**
 * Terraform — Codify (IaC Generation) Tools
 *
 * 3 tools: tf_codify, tf_codify_subgraph, tf_generate_imports
 */

import { Type } from "@sinclair/typebox";
import type { CodifyNode } from "./hcl-generator.js";
import { codifyNodes } from "./hcl-generator.js";
import {
  filterNodes,
  codifySubgraph,
  planImportOrder,
  generateOrderedImports,
} from "./codify.js";

/**
 * Resolve graph nodes from the knowledge-graph plugin context.
 * Returns an empty array if unavailable.
 */
function resolveNodes(ctx: Record<string, unknown>): CodifyNode[] {
  if (Array.isArray(ctx.graphNodes)) return ctx.graphNodes as CodifyNode[];
  return [];
}

function resolveEdges(ctx: Record<string, unknown>): Array<{ sourceId: string; targetId: string; relationshipType?: string }> {
  if (Array.isArray(ctx.graphEdges)) return ctx.graphEdges as Array<{ sourceId: string; targetId: string; relationshipType?: string }>;
  return [];
}

export function createCodifyTools(ctx: Record<string, unknown>) {
  return [
    // ── tf_codify ──────────────────────────────────────────────
    {
      name: "tf_codify",
      description:
        "Generate Terraform HCL code from knowledge-graph nodes. " +
        "Optionally filter by provider, resource type, region, or tag.",
      inputSchema: Type.Object({
        provider: Type.Optional(Type.String({ description: "Cloud provider filter (aws, azure, gcp)" })),
        resourceType: Type.Optional(Type.String({ description: "Resource type filter (compute, database, storage, …)" })),
        region: Type.Optional(Type.String({ description: "Region filter" })),
        tag: Type.Optional(Type.String({ description: "Tag key filter — include nodes that have this tag" })),
      }),
      execute: async (input: { provider?: string; resourceType?: string; region?: string; tag?: string }) => {
        const allNodes = resolveNodes(ctx);
        if (allNodes.length === 0) {
          return { content: [{ type: "text" as const, text: "No graph nodes available. Populate the knowledge graph first." }] };
        }

        const filtered = filterNodes(allNodes, input);
        if (filtered.length === 0) {
          return { content: [{ type: "text" as const, text: "No nodes match the provided filters." }] };
        }

        const result = codifyNodes(filtered);
        const output = [
          `# Generated Terraform — ${result.resources.length} resources\n`,
          ...result.providerBlocks,
          "",
          result.hclContent,
          "",
          "# Import commands:",
          ...result.importCommands,
        ].join("\n");

        return { content: [{ type: "text" as const, text: output }] };
      },
    },

    // ── tf_codify_subgraph ─────────────────────────────────────
    {
      name: "tf_codify_subgraph",
      description:
        "Generate Terraform HCL for a resource and its N-hop dependency neighbourhood.",
      inputSchema: Type.Object({
        resourceId: Type.String({ description: "Graph node ID of the root resource" }),
        depth: Type.Optional(Type.Number({ description: "Hop depth (default 1)", minimum: 1, maximum: 5 })),
      }),
      execute: async (input: { resourceId: string; depth?: number }) => {
        const nodes = resolveNodes(ctx);
        const edges = resolveEdges(ctx);
        if (nodes.length === 0) {
          return { content: [{ type: "text" as const, text: "No graph nodes available." }] };
        }

        const result = codifySubgraph(nodes, edges, input.resourceId, input.depth ?? 1);
        if (result.resources.length === 0) {
          return { content: [{ type: "text" as const, text: `No codifiable resources found from root ${input.resourceId}.` }] };
        }

        const output = [
          `# Subgraph from ${input.resourceId} (depth ${input.depth ?? 1}) — ${result.resources.length} resources\n`,
          ...result.providerBlocks,
          "",
          result.hclContent,
          "",
          "# Import commands:",
          ...result.importCommands,
        ].join("\n");

        return { content: [{ type: "text" as const, text: output }] };
      },
    },

    // ── tf_generate_imports ────────────────────────────────────
    {
      name: "tf_generate_imports",
      description:
        "Generate `terraform import` commands in dependency order (topological sort) " +
        "so that resources are imported before their dependents.",
      inputSchema: Type.Object({
        provider: Type.Optional(Type.String({ description: "Cloud provider filter" })),
        resourceType: Type.Optional(Type.String({ description: "Resource type filter" })),
        region: Type.Optional(Type.String({ description: "Region filter" })),
      }),
      execute: async (input: { provider?: string; resourceType?: string; region?: string }) => {
        const allNodes = resolveNodes(ctx);
        const allEdges = resolveEdges(ctx);
        if (allNodes.length === 0) {
          return { content: [{ type: "text" as const, text: "No graph nodes available." }] };
        }

        const filtered = filterNodes(allNodes, input);
        if (filtered.length === 0) {
          return { content: [{ type: "text" as const, text: "No nodes match the provided filters." }] };
        }

        const orderedNodes = planImportOrder(filtered, allEdges);
        const importCommands = generateOrderedImports(orderedNodes, allEdges);

        const output = [
          `# Import plan — ${importCommands.length} resources (dependency order)\n`,
          ...importCommands.map((cmd, i) => `# Step ${i + 1}\n${cmd}`),
        ].join("\n");

        return { content: [{ type: "text" as const, text: output }] };
      },
    },
  ];
}
