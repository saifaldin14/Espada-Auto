/**
 * Infrastructure Knowledge Graph — Graph Visualization (P2.16)
 *
 * Generates visualization-ready data export formats for graph rendering:
 * - Cytoscape.js JSON (for interactive web-based visualization)
 * - D3.js force graph JSON
 * - Topology layout hints, color coding, grouping metadata
 */

import type { GraphNode, GraphEdge, NodeFilter, GraphStorage } from "../types.js";

// =============================================================================
// Types
// =============================================================================

/** Supported visualization output format. */
export type VisualizationFormat = "cytoscape" | "d3-force";

/** Color scheme for resource type mapping. */
export type NodeColorScheme = Record<string, string>;

/** Layout strategy hint. */
export type LayoutStrategy =
  | "force-directed"
  | "hierarchical"
  | "circular"
  | "grid"
  | "concentric";

/** Options for visualization export. */
export type VisualizationOptions = {
  /** Filter nodes to include. */
  filter?: NodeFilter;
  /** Layout strategy hint. */
  layout?: LayoutStrategy;
  /** Whether to include metadata for tooltips. */
  includeMetadata?: boolean;
  /** Whether to include cost data. */
  includeCost?: boolean;
  /** Max nodes (safety limit, default 500). */
  maxNodes?: number;
  /** Custom color scheme. */
  colors?: NodeColorScheme;
  /** Whether to group nodes by provider. */
  groupByProvider?: boolean;
  /** Whether to group nodes by resource type. */
  groupByType?: boolean;
  /** Highlight a specific node and its neighborhood. */
  highlightNodeId?: string;
  /** Depth for neighborhood highlighting. */
  highlightDepth?: number;
};

/** Cytoscape.js node element. */
export type CytoscapeNode = {
  data: {
    id: string;
    label: string;
    provider: string;
    resourceType: string;
    region: string;
    status: string;
    costMonthly: number | null;
    parent?: string;
    color: string;
    shape: string;
    size: number;
    opacity: number;
    borderColor: string;
    borderWidth: number;
    [key: string]: unknown;
  };
  classes: string;
  position?: { x: number; y: number };
};

/** Cytoscape.js edge element. */
export type CytoscapeEdge = {
  data: {
    id: string;
    source: string;
    target: string;
    label: string;
    relationship: string;
    confidence: number;
    lineStyle: string;
    width: number;
    color: string;
  };
};

/** Cytoscape.js compound (parent) node for grouping. */
export type CytoscapeGroup = {
  data: {
    id: string;
    label: string;
    groupType: string;
  };
  classes: string;
};

/** Result of a visualization export. */
export type VisualizationResult = {
  format: VisualizationFormat;
  /** Cytoscape or D3 JSON content (serialized). */
  content: string;
  nodeCount: number;
  edgeCount: number;
  groupCount: number;
  /** Suggested layout config. */
  layoutConfig: Record<string, unknown>;
};

/** D3 force graph node. */
export type D3Node = {
  id: string;
  label: string;
  group: string;
  provider: string;
  resourceType: string;
  status: string;
  costMonthly: number | null;
  color: string;
  radius: number;
  [key: string]: unknown;
};

/** D3 force graph link. */
export type D3Link = {
  source: string;
  target: string;
  label: string;
  relationship: string;
  confidence: number;
  strokeWidth: number;
  strokeDasharray: string;
};

// =============================================================================
// Default Color Scheme
// =============================================================================

export const DEFAULT_COLORS: NodeColorScheme = {
  // Compute
  compute: "#FF9900",
  function: "#FF9900",
  "serverless-function": "#FF9900",
  container: "#FF9900",
  cluster: "#ED7100",

  // Data
  database: "#3B48CC",
  cache: "#C925D1",
  storage: "#3F8624",
  stream: "#FF4F8B",

  // Network
  network: "#8C4FFF",
  vpc: "#8C4FFF",
  subnet: "#8C4FFF",
  "load-balancer": "#E7157B",
  "api-gateway": "#E7157B",
  cdn: "#8C4FFF",
  dns: "#8C4FFF",
  "nat-gateway": "#8C4FFF",
  "route-table": "#8C4FFF",
  "internet-gateway": "#8C4FFF",

  // Security
  "security-group": "#DD344C",
  "iam-role": "#DD344C",
  certificate: "#DD344C",
  secret: "#DD344C",
  policy: "#DD344C",
  identity: "#DD344C",

  // Messaging
  queue: "#FF4F8B",
  topic: "#FF4F8B",

  // Custom
  custom: "#666666",
};

/** Shape mapping for Cytoscape.js. */
const NODE_SHAPES: Record<string, string> = {
  compute: "round-rectangle",
  database: "barrel",
  storage: "barrel",
  cache: "barrel",
  function: "diamond",
  "serverless-function": "diamond",
  "load-balancer": "hexagon",
  "api-gateway": "hexagon",
  vpc: "round-rectangle",
  subnet: "round-rectangle",
  "security-group": "pentagon",
  "iam-role": "pentagon",
  queue: "octagon",
  topic: "octagon",
  dns: "star",
  container: "ellipse",
  cluster: "round-rectangle",
  custom: "ellipse",
};

// =============================================================================
// Cytoscape.js Export
// =============================================================================

function buildCytoscapeNode(
  node: GraphNode,
  colors: NodeColorScheme,
  options: VisualizationOptions,
  isHighlighted: boolean,
): CytoscapeNode {
  const color = colors[node.resourceType] ?? colors.custom ?? "#666666";
  const shape = NODE_SHAPES[node.resourceType] ?? "ellipse";

  // Size based on cost (logarithmic scale)
  const baseCost = node.costMonthly ?? 0;
  const size = Math.max(30, Math.min(80, 30 + Math.log2(baseCost + 1) * 5));

  const data: CytoscapeNode["data"] = {
    id: node.id,
    label: truncateLabel(node.name),
    provider: node.provider,
    resourceType: node.resourceType,
    region: node.region,
    status: node.status,
    costMonthly: node.costMonthly,
    color,
    shape,
    size,
    opacity: isHighlighted || !options.highlightNodeId ? 1.0 : 0.3,
    borderColor: node.status === "error" ? "#FF0000" : (node.status === "stopped" ? "#999999" : color),
    borderWidth: node.status === "error" ? 3 : 1,
  };

  if (options.groupByProvider) {
    data.parent = `group:provider:${node.provider}`;
  }

  if (options.includeCost && node.costMonthly != null) {
    data.costLabel = `$${node.costMonthly.toFixed(0)}/mo`;
  }

  if (options.includeMetadata) {
    data.tags = node.tags;
    data.nativeId = node.nativeId;
    data.account = node.account;
    data.owner = node.owner;
  }

  const classes: string[] = [node.resourceType, node.provider, node.status];
  if (isHighlighted) classes.push("highlighted");

  return { data, classes: classes.join(" ") };
}

function buildCytoscapeEdge(
  edge: GraphEdge,
  highlightedNodeIds: Set<string>,
  options: VisualizationOptions,
): CytoscapeEdge {
  const isHighlighted =
    highlightedNodeIds.has(edge.sourceNodeId) && highlightedNodeIds.has(edge.targetNodeId);

  return {
    data: {
      id: edge.id,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      label: edge.relationshipType,
      relationship: edge.relationshipType,
      confidence: edge.confidence,
      lineStyle: edge.confidence < 0.8 ? "dashed" : "solid",
      width: isHighlighted || !options.highlightNodeId ? 2 : 1,
      color: isHighlighted ? "#333333" : (options.highlightNodeId ? "#CCCCCC" : "#666666"),
    },
  };
}

function exportCytoscape(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: VisualizationOptions,
  highlightedNodeIds: Set<string>,
): { content: string; groupCount: number } {
  const colors = { ...DEFAULT_COLORS, ...options.colors };
  const elements: Array<CytoscapeNode | CytoscapeEdge | CytoscapeGroup> = [];
  let groupCount = 0;

  // Add provider groups if requested
  if (options.groupByProvider) {
    const providers = new Set(nodes.map((n) => n.provider));
    for (const provider of providers) {
      elements.push({
        data: {
          id: `group:provider:${provider}`,
          label: provider.toUpperCase(),
          groupType: "provider",
        },
        classes: "group provider-group",
      });
      groupCount++;
    }
  }

  // Add nodes
  for (const node of nodes) {
    const isHighlighted =
      !options.highlightNodeId || highlightedNodeIds.has(node.id);
    elements.push(buildCytoscapeNode(node, colors, options, isHighlighted));
  }

  // Add edges
  for (const edge of edges) {
    elements.push(buildCytoscapeEdge(edge, highlightedNodeIds, options));
  }

  const data = {
    format: "cytoscape" as const,
    elements,
    style: buildDefaultStylesheet(colors),
    layout: getLayoutConfig(options.layout ?? "force-directed", nodes.length),
  };

  return { content: JSON.stringify(data, null, 2), groupCount };
}

// =============================================================================
// D3 Force Graph Export
// =============================================================================

function exportD3Force(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: VisualizationOptions,
  highlightedNodeIds: Set<string>,
): { content: string; groupCount: number } {
  const colors = { ...DEFAULT_COLORS, ...options.colors };

  const d3Nodes: D3Node[] = nodes.map((node) => {
    const isHighlighted =
      !options.highlightNodeId || highlightedNodeIds.has(node.id);
    const baseCost = node.costMonthly ?? 0;

    const d3Node: D3Node = {
      id: node.id,
      label: truncateLabel(node.name),
      group: node.provider,
      provider: node.provider,
      resourceType: node.resourceType,
      status: node.status,
      costMonthly: node.costMonthly,
      color: colors[node.resourceType] ?? "#666666",
      radius: Math.max(5, Math.min(20, 5 + Math.log2(baseCost + 1) * 2)),
      opacity: isHighlighted ? 1.0 : 0.3,
    };

    if (options.includeMetadata) {
      d3Node.tags = node.tags;
      d3Node.region = node.region;
      d3Node.account = node.account;
    }

    return d3Node;
  });

  const d3Links: D3Link[] = edges.map((edge) => {
    const isHighlighted =
      highlightedNodeIds.has(edge.sourceNodeId) && highlightedNodeIds.has(edge.targetNodeId);

    return {
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      label: edge.relationshipType,
      relationship: edge.relationshipType,
      confidence: edge.confidence,
      strokeWidth: isHighlighted || !options.highlightNodeId ? 2 : 1,
      strokeDasharray: edge.confidence < 0.8 ? "5,5" : "",
    };
  });

  const data = {
    format: "d3-force" as const,
    nodes: d3Nodes,
    links: d3Links,
    simulation: {
      forceCharge: -200,
      forceLink: { distance: 80 },
      forceCenter: true,
      alphaDecay: 0.02,
    },
  };

  return { content: JSON.stringify(data, null, 2), groupCount: 0 };
}

// =============================================================================
// Layout Configuration
// =============================================================================

function getLayoutConfig(
  strategy: LayoutStrategy,
  nodeCount: number,
): Record<string, unknown> {
  switch (strategy) {
    case "hierarchical":
      return {
        name: "dagre",
        rankDir: "LR",
        nodeSep: 60,
        rankSep: 100,
        animate: nodeCount < 200,
      };
    case "circular":
      return {
        name: "circle",
        avoidOverlap: true,
        spacingFactor: 1.5,
        animate: nodeCount < 200,
      };
    case "grid":
      return {
        name: "grid",
        avoidOverlap: true,
        condense: true,
        animate: false,
      };
    case "concentric":
      return {
        name: "concentric",
        avoidOverlap: true,
        minNodeSpacing: 40,
        concentric: "data(size)",
        levelWidth: 2, // Constant width per level (serializable)
        animate: nodeCount < 200,
      };
    case "force-directed":
    default:
      return {
        name: "cose",
        idealEdgeLength: 100,
        nodeOverlap: 20,
        gravity: 0.25,
        numIter: 1000,
        animate: nodeCount < 200,
        randomize: false,
      };
  }
}

// =============================================================================
// Stylesheet
// =============================================================================

function buildDefaultStylesheet(
  colors: NodeColorScheme,
): Array<Record<string, unknown>> {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "background-color": "data(color)",
        shape: "data(shape)",
        width: "data(size)",
        height: "data(size)",
        "font-size": 10,
        "text-wrap": "ellipsis",
        "text-max-width": 80,
        "text-valign": "bottom",
        "text-margin-y": 5,
        "border-color": "data(borderColor)",
        "border-width": "data(borderWidth)",
        opacity: "data(opacity)",
      },
    },
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        "target-arrow-shape": "triangle",
        "line-style": "data(lineStyle)",
        width: "data(width)",
        "line-color": "data(color)",
        "target-arrow-color": "data(color)",
        label: "data(label)",
        "font-size": 8,
        "text-rotation": "autorotate",
        "text-outline-width": 2,
        "text-outline-color": "#FFFFFF",
      },
    },
    {
      selector: ".group",
      style: {
        "background-opacity": 0.1,
        "border-width": 2,
        "border-style": "dashed",
        label: "data(label)",
        "font-size": 14,
        "font-weight": "bold",
        "text-valign": "top",
        "text-halign": "center",
      },
    },
    {
      selector: ".highlighted",
      style: {
        "border-width": 3,
        "border-color": "#FFD700",
        "z-index": 999,
      },
    },
    // Provider-specific group colors
    {
      selector: '[groupType = "provider"][label = "AWS"]',
      style: { "background-color": colors.compute ?? "#FF9900", "border-color": colors.compute ?? "#FF9900" },
    },
    {
      selector: '[groupType = "provider"][label = "AZURE"]',
      style: { "background-color": "#0078D4", "border-color": "#0078D4" },
    },
    {
      selector: '[groupType = "provider"][label = "GCP"]',
      style: { "background-color": "#4285F4", "border-color": "#4285F4" },
    },
  ];
}

// =============================================================================
// Helpers
// =============================================================================

function truncateLabel(name: string, max = 30): string {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Export the graph in a visualization-ready format.
 */
export async function exportVisualization(
  storage: GraphStorage,
  format: VisualizationFormat = "cytoscape",
  options: VisualizationOptions = {},
): Promise<VisualizationResult> {
  const maxNodes = options.maxNodes ?? 500;

  // Fetch nodes
  const allNodes = options.filter
    ? await storage.queryNodes(options.filter)
    : await storage.queryNodes({});
  const nodes = allNodes.slice(0, maxNodes);
  const nodeIdSet = new Set(nodes.map((n) => n.id));

  // Fetch edges in a single batch query instead of per-node (avoids N+1)
  const allEdgesRaw = await storage.queryEdges({});
  const edges = allEdgesRaw.filter(
    (e) => nodeIdSet.has(e.sourceNodeId) && nodeIdSet.has(e.targetNodeId),
  );

  // Compute highlighted node set
  let highlightedNodeIds = new Set<string>();
  if (options.highlightNodeId && nodeIdSet.has(options.highlightNodeId)) {
    const depth = options.highlightDepth ?? 2;
    const neighbors = await storage.getNeighbors(
      options.highlightNodeId,
      depth,
      "both",
    );
    highlightedNodeIds = new Set([
      options.highlightNodeId,
      ...neighbors.nodes.map((n) => n.id),
    ]);
  }

  let result: { content: string; groupCount: number };

  switch (format) {
    case "cytoscape":
      result = exportCytoscape(nodes, edges, options, highlightedNodeIds);
      break;
    case "d3-force":
      result = exportD3Force(nodes, edges, options, highlightedNodeIds);
      break;
  }

  return {
    format,
    content: result.content,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    groupCount: result.groupCount,
    layoutConfig: getLayoutConfig(
      options.layout ?? "force-directed",
      nodes.length,
    ),
  };
}
