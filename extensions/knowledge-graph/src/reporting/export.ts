/**
 * Infrastructure Knowledge Graph — Export Module
 *
 * Exports graph topology in multiple formats:
 * - JSON: full topology with nodes + edges
 * - DOT:  Graphviz/DOT format for visualization
 * - Mermaid: Mermaid.js flowchart syntax
 */

import type { GraphNode, GraphEdge, NodeFilter, GraphStorage } from "../types.js";

// =============================================================================
// Types
// =============================================================================

export type ExportFormat = "json" | "dot" | "mermaid";

export type ExportResult = {
  format: ExportFormat;
  content: string;
  nodeCount: number;
  edgeCount: number;
};

export type ExportOptions = {
  /** Filter nodes to include. */
  filter?: NodeFilter;
  /** Whether to include metadata in export. */
  includeMetadata?: boolean;
  /** Whether to include cost info. */
  includeCost?: boolean;
  /** Max nodes to export (safety limit). */
  maxNodes?: number;
};

// =============================================================================
// Helpers
// =============================================================================

/** Sanitize a string for use as a DOT/Mermaid node ID. */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Truncate long labels. */
function truncate(s: string, max = 40): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Build a human-readable label for a node. */
function nodeLabel(node: GraphNode, includeCost: boolean): string {
  const parts = [node.name || node.nativeId, `(${node.resourceType})`];
  if (includeCost && node.costMonthly != null) {
    parts.push(`$${node.costMonthly.toFixed(0)}/mo`);
  }
  return parts.join(" ");
}

// =============================================================================
// Export Functions
// =============================================================================

/**
 * Export topology as structured JSON.
 */
function exportJson(nodes: GraphNode[], edges: GraphEdge[], options: ExportOptions): string {
  const data = {
    exportedAt: new Date().toISOString(),
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      provider: n.provider,
      resourceType: n.resourceType,
      region: n.region,
      status: n.status,
      ...(options.includeCost && n.costMonthly != null ? { costMonthly: n.costMonthly } : {}),
      ...(options.includeMetadata ? { tags: n.tags, metadata: n.metadata } : {}),
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      relationship: e.relationshipType,
      confidence: e.confidence,
      discoveredVia: e.discoveredVia,
    })),
  };

  return JSON.stringify(data, null, 2);
}

/**
 * Export topology as Graphviz DOT format.
 */
function exportDot(nodes: GraphNode[], edges: GraphEdge[], options: ExportOptions): string {
  const lines: string[] = [];
  lines.push("digraph InfrastructureGraph {");
  lines.push("  rankdir=LR;");
  lines.push("  node [shape=box, style=filled, fontsize=10];");
  lines.push("");

  // Color mapping by resource type
  const typeColors: Record<string, string> = {
    compute: "#FF9900",
    database: "#3B48CC",
    storage: "#3F8624",
    network: "#8C4FFF",
    "load-balancer": "#E7157B",
    function: "#FF9900",
    "serverless-function": "#FF9900",
    container: "#FF9900",
    "security-group": "#DD344C",
    "api-gateway": "#E7157B",
    vpc: "#8C4FFF",
    subnet: "#8C4FFF",
    queue: "#FF4F8B",
    topic: "#FF4F8B",
    cache: "#C925D1",
    cdn: "#8C4FFF",
    dns: "#8C4FFF",
  };

  // Group by provider
  const byProvider = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const list = byProvider.get(node.provider) ?? [];
    list.push(node);
    byProvider.set(node.provider, list);
  }

  for (const [provider, providerNodes] of byProvider) {
    lines.push(`  subgraph cluster_${sanitizeId(provider)} {`);
    lines.push(`    label="${provider.toUpperCase()}";`);
    lines.push(`    style=dashed;`);
    lines.push(`    color="#666666";`);

    for (const node of providerNodes) {
      const color = typeColors[node.resourceType] ?? "#999999";
      const label = truncate(nodeLabel(node, options.includeCost ?? false));
      lines.push(`    "${sanitizeId(node.id)}" [label="${label}", fillcolor="${color}", fontcolor="white"];`);
    }

    lines.push("  }");
    lines.push("");
  }

  // Edges
  for (const edge of edges) {
    const style = edge.confidence < 0.8 ? ", style=dashed" : "";
    lines.push(`  "${sanitizeId(edge.sourceNodeId)}" -> "${sanitizeId(edge.targetNodeId)}" [label="${edge.relationshipType}"${style}];`);
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Export topology as Mermaid.js flowchart.
 */
function exportMermaid(nodes: GraphNode[], edges: GraphEdge[], options: ExportOptions): string {
  const lines: string[] = [];
  lines.push("flowchart LR");

  // Build node ID map for short Mermaid node IDs
  const nodeIds = new Map<string, string>();
  let counter = 0;
  for (const node of nodes) {
    nodeIds.set(node.id, `n${counter++}`);
  }

  // Group by provider using subgraphs
  const byProvider = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const list = byProvider.get(node.provider) ?? [];
    list.push(node);
    byProvider.set(node.provider, list);
  }

  for (const [provider, providerNodes] of byProvider) {
    lines.push(`  subgraph ${provider.toUpperCase()}`);

    for (const node of providerNodes) {
      const mId = nodeIds.get(node.id)!;
      const label = truncate(nodeLabel(node, options.includeCost ?? false));
      // Use different shapes for different resource categories
      const shape = getNodeShape(node.resourceType);
      lines.push(`    ${mId}${shape[0]}"${label}"${shape[1]}`);
    }

    lines.push("  end");
  }

  // Edges
  for (const edge of edges) {
    const src = nodeIds.get(edge.sourceNodeId);
    const tgt = nodeIds.get(edge.targetNodeId);
    if (src && tgt) {
      const arrow = edge.confidence < 0.8 ? "-.->" : "-->";
      lines.push(`  ${src} ${arrow}|${edge.relationshipType}| ${tgt}`);
    }
  }

  return lines.join("\n");
}

/** Return Mermaid shape delimiters by resource type category. */
function getNodeShape(resourceType: string): [string, string] {
  switch (resourceType) {
    case "database":
    case "cache":
    case "storage":
      return ["[(", ")]"]; // cylindrical (database)
    case "function":
    case "serverless-function":
      return [">", "]"]; // asymmetric
    case "load-balancer":
    case "api-gateway":
    case "cdn":
      return ["{{", "}}"]; // hexagon
    case "vpc":
    case "subnet":
    case "network":
      return ["([", "])"]; // stadium
    case "security-group":
    case "policy":
    case "identity":
    case "iam-role":
      return ["[[", "]]"]; // subroutine
    default:
      return ["[", "]"]; // rectangle
  }
}

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Export the graph topology in the requested format.
 */
export async function exportTopology(
  storage: GraphStorage,
  format: ExportFormat,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const maxNodes = options.maxNodes ?? 5000;

  // Fetch nodes (with optional filter)
  const nodes = options.filter
    ? await storage.queryNodes(options.filter)
    : await storage.queryNodes({});

  const limitedNodes = nodes.slice(0, maxNodes);
  const nodeIdSet = new Set(limitedNodes.map((n) => n.id));

  // Fetch all edges and filter to those connecting included nodes
  const allEdges: GraphEdge[] = [];
  for (const node of limitedNodes) {
    const edges = await storage.getEdgesForNode(node.id, "both");
    for (const edge of edges) {
      if (nodeIdSet.has(edge.sourceNodeId) && nodeIdSet.has(edge.targetNodeId)) {
        allEdges.push(edge);
      }
    }
  }

  // Deduplicate edges
  const edgeMap = new Map<string, GraphEdge>();
  for (const edge of allEdges) {
    edgeMap.set(edge.id, edge);
  }
  const edges = [...edgeMap.values()];

  let content: string;
  switch (format) {
    case "json":
      content = exportJson(limitedNodes, edges, options);
      break;
    case "dot":
      content = exportDot(limitedNodes, edges, options);
      break;
    case "mermaid":
      content = exportMermaid(limitedNodes, edges, options);
      break;
  }

  return { format, content, nodeCount: limitedNodes.length, edgeCount: edges.length };
}
