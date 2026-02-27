/**
 * Infrastructure Knowledge Graph — Multi-Format Export (P3.29)
 *
 * Additional export formats beyond the existing JSON/DOT/Mermaid:
 *   - YAML:         Human-readable, diff-friendly topology dump
 *   - CSV:          Spreadsheet-compatible node/edge tables
 *   - OpenLineage:  Data lineage standard (https://openlineage.io)
 *
 * Uses the existing ExportOptions interface for consistency.
 */

import type { GraphNode, GraphEdge, NodeFilter, GraphStorage } from "../types.js";

// =============================================================================
// Types
// =============================================================================

/** Extended export formats including the new ones. */
export type ExtendedExportFormat = "yaml" | "csv" | "openlineage";

/** Result of an extended export. */
export type ExtendedExportResult = {
  format: ExtendedExportFormat;
  content: string;
  nodeCount: number;
  edgeCount: number;
};

/** Options for extended export (mirrors ExportOptions). */
export type ExtendedExportOptions = {
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
// YAML Export
// =============================================================================

/** Escape a YAML string value. */
function yamlEscape(value: string): string {
  // If the string contains special chars, wrap in quotes
  if (/[:#\[\]{}&*!|>'"`,@?\\]/.test(value) || value.includes("\n")) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/** Convert a value to a YAML-safe representation. */
function toYamlValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return yamlEscape(value);
  return yamlEscape(JSON.stringify(value));
}

/**
 * Export topology as YAML.
 */
function exportYaml(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: ExtendedExportOptions,
): string {
  const lines: string[] = [
    "# Infrastructure Knowledge Graph — Topology Export",
    `# Generated: ${new Date().toISOString()}`,
    `# Nodes: ${nodes.length}`,
    `# Edges: ${edges.length}`,
    "",
    "nodes:",
  ];

  for (const node of nodes) {
    lines.push(`  - id: ${toYamlValue(node.id)}`);
    lines.push(`    name: ${toYamlValue(node.name)}`);
    lines.push(`    provider: ${node.provider}`);
    lines.push(`    resourceType: ${node.resourceType}`);
    lines.push(`    region: ${node.region}`);
    lines.push(`    account: ${toYamlValue(node.account)}`);
    lines.push(`    status: ${node.status}`);

    if (options.includeCost && node.costMonthly != null) {
      lines.push(`    costMonthly: ${node.costMonthly}`);
    }

    if (options.includeMetadata) {
      // Tags
      const tagEntries = Object.entries(node.tags);
      if (tagEntries.length > 0) {
        lines.push("    tags:");
        for (const [k, v] of tagEntries) {
          lines.push(`      ${toYamlValue(k)}: ${toYamlValue(v)}`);
        }
      }

      // Metadata (selected fields)
      const metaEntries = Object.entries(node.metadata).filter(
        ([, v]) => v !== undefined && v !== null,
      );
      if (metaEntries.length > 0) {
        lines.push("    metadata:");
        for (const [k, v] of metaEntries) {
          lines.push(`      ${toYamlValue(k)}: ${toYamlValue(v)}`);
        }
      }
    }
  }

  lines.push("");
  lines.push("edges:");

  for (const edge of edges) {
    lines.push(`  - id: ${toYamlValue(edge.id)}`);
    lines.push(`    source: ${toYamlValue(edge.sourceNodeId)}`);
    lines.push(`    target: ${toYamlValue(edge.targetNodeId)}`);
    lines.push(`    relationship: ${edge.relationshipType}`);
    lines.push(`    confidence: ${edge.confidence}`);
    lines.push(`    discoveredVia: ${edge.discoveredVia}`);
  }

  return lines.join("\n");
}

// =============================================================================
// CSV Export
// =============================================================================

/** Escape a CSV field value. */
function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Export topology as CSV (two sections: nodes and edges).
 */
function exportCsv(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: ExtendedExportOptions,
): string {
  const sections: string[] = [];

  // Nodes CSV
  const nodeHeaders = ["id", "name", "provider", "resourceType", "region", "account", "status"];
  if (options.includeCost) nodeHeaders.push("costMonthly");
  if (options.includeMetadata) nodeHeaders.push("tags");

  const nodeRows = [nodeHeaders.join(",")];
  for (const node of nodes) {
    const row: string[] = [
      csvEscape(node.id),
      csvEscape(node.name),
      csvEscape(node.provider),
      csvEscape(node.resourceType),
      csvEscape(node.region),
      csvEscape(node.account),
      csvEscape(node.status),
    ];
    if (options.includeCost) {
      row.push(node.costMonthly != null ? String(node.costMonthly) : "");
    }
    if (options.includeMetadata) {
      const tagStr = Object.entries(node.tags)
        .map(([k, v]) => `${k}=${v}`)
        .join(";");
      row.push(csvEscape(tagStr));
    }
    nodeRows.push(row.join(","));
  }

  sections.push("# NODES");
  sections.push(nodeRows.join("\n"));

  // Edges CSV
  const edgeHeaders = ["id", "source", "target", "relationship", "confidence", "discoveredVia"];
  const edgeRows = [edgeHeaders.join(",")];
  for (const edge of edges) {
    edgeRows.push([
      csvEscape(edge.id),
      csvEscape(edge.sourceNodeId),
      csvEscape(edge.targetNodeId),
      csvEscape(edge.relationshipType),
      String(edge.confidence),
      csvEscape(edge.discoveredVia),
    ].join(","));
  }

  sections.push("");
  sections.push("# EDGES");
  sections.push(edgeRows.join("\n"));

  return sections.join("\n");
}

// =============================================================================
// OpenLineage Export
// =============================================================================

/**
 * Export topology in OpenLineage-compatible JSON.
 *
 * Maps infrastructure nodes to OpenLineage datasets/jobs and edges to
 * lineage relationships. This enables integration with data lineage tools
 * like Marquez, Atlan, and DataHub.
 *
 * See: https://openlineage.io/spec/2-0-2/OpenLineage.json
 */
function exportOpenLineage(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: ExtendedExportOptions,
): string {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Build OpenLineage events from edges
  const events: Array<Record<string, unknown>> = [];
  const processedPairs = new Set<string>();

  for (const edge of edges) {
    const source = nodeMap.get(edge.sourceNodeId);
    const target = nodeMap.get(edge.targetNodeId);
    if (!source || !target) continue;

    // Avoid duplicate events for the same pair
    const pairKey = `${edge.sourceNodeId}:${edge.targetNodeId}`;
    if (processedPairs.has(pairKey)) continue;
    processedPairs.add(pairKey);

    const event: Record<string, unknown> = {
      eventType: "COMPLETE",
      eventTime: new Date().toISOString(),
      producer: `https://espada.dev/knowledge-graph`,
      schemaURL: "https://openlineage.io/spec/2-0-2/OpenLineage.json",
      job: {
        namespace: source.provider,
        name: `${source.resourceType}:${source.name}`,
        facets: {
          sourceCodeLocation: {
            type: "infrastructure",
            provider: source.provider,
            region: source.region,
            account: source.account,
          },
        },
      },
      inputs: [{
        namespace: source.provider,
        name: source.id,
        facets: {
          schema: {
            fields: [
              { name: "resourceType", type: source.resourceType },
              { name: "status", type: source.status },
              ...(options.includeCost && source.costMonthly != null
                ? [{ name: "costMonthly", type: "number" }]
                : []),
            ],
          },
          ...(options.includeMetadata ? { custom: source.metadata } : {}),
        },
      }],
      outputs: [{
        namespace: target.provider,
        name: target.id,
        facets: {
          schema: {
            fields: [
              { name: "resourceType", type: target.resourceType },
              { name: "status", type: target.status },
            ],
          },
        },
      }],
    };

    events.push(event);
  }

  // Also include standalone nodes (with no edges) as datasets
  const nodesWithEdges = new Set<string>();
  for (const edge of edges) {
    nodesWithEdges.add(edge.sourceNodeId);
    nodesWithEdges.add(edge.targetNodeId);
  }

  const standaloneNodes = nodes.filter((n) => !nodesWithEdges.has(n.id));
  const datasets = standaloneNodes.map((node) => ({
    namespace: node.provider,
    name: node.id,
    facets: {
      schema: {
        fields: [
          { name: "resourceType", type: node.resourceType },
          { name: "region", type: node.region },
          { name: "status", type: node.status },
        ],
      },
      ...(options.includeCost && node.costMonthly != null
        ? { cost: { monthly: node.costMonthly } }
        : {}),
    },
  }));

  const result = {
    _type: "openlineage-export",
    _producer: "espada-knowledge-graph",
    _exportedAt: new Date().toISOString(),
    events,
    datasets,
    summary: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      totalEvents: events.length,
      totalStandaloneDatasets: datasets.length,
    },
  };

  return JSON.stringify(result, null, 2);
}

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Export the graph topology in an extended format (YAML, CSV, or OpenLineage).
 */
export async function exportExtended(
  storage: GraphStorage,
  format: ExtendedExportFormat,
  options: ExtendedExportOptions = {},
): Promise<ExtendedExportResult> {
  const maxNodes = options.maxNodes ?? 5000;

  // Fetch nodes
  const allNodes = options.filter
    ? await storage.queryNodes(options.filter)
    : await storage.queryNodes({});
  const nodes = allNodes.slice(0, maxNodes);
  const nodeIdSet = new Set(nodes.map((n) => n.id));

  // Fetch edges in a single batch query
  const allEdges = await storage.queryEdges({});
  const edges = allEdges.filter(
    (e) => nodeIdSet.has(e.sourceNodeId) && nodeIdSet.has(e.targetNodeId),
  );

  let content: string;
  switch (format) {
    case "yaml":
      content = exportYaml(nodes, edges, options);
      break;
    case "csv":
      content = exportCsv(nodes, edges, options);
      break;
    case "openlineage":
      content = exportOpenLineage(nodes, edges, options);
      break;
  }

  return { format, content, nodeCount: nodes.length, edgeCount: edges.length };
}
