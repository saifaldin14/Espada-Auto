// ─── API response types ───────────────────────────────────────

export interface HealthResponse {
  status: string;
  version: string;
  nodes: number;
  edges: number;
  storage: string;
}

export interface GraphNode {
  id: string;
  name: string;
  provider: string;
  resourceType: string;
  region: string;
  account: string;
  nativeId: string;
  status: string;
  costMonthly: number;
  metadata: Record<string, unknown>;
  tags: Record<string, string>;
  createdAt: string;
  lastSeenAt: string;
}

export interface GraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: string;
  confidence: number;
  discoveredVia: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  lastSeenAt: string;
}

export interface TopologyResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface CostResponse {
  totalMonthly: number;
  byProvider: Record<string, number>;
  byResourceType: Record<string, number>;
  byRegion: Record<string, number>;
  topResources: Array<{
    id: string;
    name: string;
    type: string;
    costMonthly: number;
  }>;
}

export interface DriftItem {
  nodeId: string;
  nodeName: string;
  resourceType: string;
  provider: string;
  field: string;
  expected: string;
  actual: string;
  lastCheckedAt: string;
}

export interface DriftResponse {
  driftedCount: number;
  items: DriftItem[];
}

export interface StatsResponse {
  totalNodes: number;
  totalEdges: number;
  totalChanges: number;
  totalGroups: number;
  nodesByProvider: Record<string, number>;
  nodesByResourceType: Record<string, number>;
  edgesByRelationshipType: Record<string, number>;
  totalCostMonthly: number;
  lastSyncAt: string | null;
}

export interface ComplianceResult {
  framework: string;
  totalControls: number;
  passed: number;
  failed: number;
  skipped: number;
  findings: Array<{
    controlId: string;
    title: string;
    status: "pass" | "fail" | "skip";
    severity: "critical" | "high" | "medium" | "low" | "info";
    resourceIds: string[];
    message: string;
  }>;
}

export type ViewId = "graph" | "resources" | "query" | "cost" | "drift" | "compliance";

export const RESOURCE_TYPE_COLORS: Record<string, string> = {
  vpc: "#2ea043",
  subnet: "#388bfd",
  "security-group": "#e3b341",
  "iam-role": "#a371f7",
  storage: "#f47067",
  "internet-gateway": "#57ab5a",
  "route-table": "#6cb6ff",
  compute: "#f692ce",
  database: "#c4a5f7",
  "load-balancer": "#46c252",
  container: "#ff8a7a",
  "nat-gateway": "#f0b050",
  "elastic-ip": "#91cbff",
  custom: "#768390",
};

/** Secondary (darker) color for each resource type — used for gradient fills */
export const RESOURCE_TYPE_COLORS_DARK: Record<string, string> = {
  vpc: "#196c2e",
  subnet: "#1a5aad",
  "security-group": "#9e7a18",
  "iam-role": "#6e40a5",
  storage: "#c24040",
  "internet-gateway": "#2d6a3a",
  "route-table": "#3d7ebd",
  compute: "#c06098",
  database: "#8c68c5",
  "load-balancer": "#2d8839",
  container: "#cc5d52",
  "nat-gateway": "#b8832a",
  "elastic-ip": "#5898cc",
  custom: "#555d66",
};

/** Icon glyph for each resource type — shown inside the node */
export const RESOURCE_TYPE_ICONS: Record<string, string> = {
  vpc: "\u{1F310}",        // globe
  subnet: "\u{1F5A7}",     // network
  "security-group": "\u{1F6E1}",  // shield
  "iam-role": "\u{1F511}",        // key
  storage: "\u{1F4BE}",           // floppy
  "internet-gateway": "\u{1F6AA}", // door
  "route-table": "\u{1F5FA}",     // map
  compute: "\u{1F5A5}",           // desktop
  database: "\u{1F4CB}",          // clipboard
  "load-balancer": "\u{2696}",    // balance
  container: "\u{1F4E6}",         // package
  "nat-gateway": "\u{1F504}",     // arrows
  "elastic-ip": "\u{1F4CD}",      // pin
  custom: "\u{2699}",             // gear
};

export const RESOURCE_TYPE_SHAPES: Record<string, string> = {
  vpc: "round-rectangle",
  subnet: "ellipse",
  "security-group": "diamond",
  "iam-role": "hexagon",
  storage: "barrel",
  "internet-gateway": "round-triangle",
  "route-table": "round-rectangle",
  compute: "round-rectangle",
  database: "barrel",
  "load-balancer": "round-diamond",
  container: "round-hexagon",
  "nat-gateway": "round-rectangle",
  "elastic-ip": "ellipse",
  custom: "round-pentagon",
};
