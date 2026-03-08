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

export type ViewId = "graph" | "resources" | "cost" | "drift" | "compliance";

export const RESOURCE_TYPE_COLORS: Record<string, string> = {
  vpc: "#238636",
  subnet: "#1f6feb",
  "security-group": "#d29922",
  "iam-role": "#8957e5",
  storage: "#f85149",
  "internet-gateway": "#3fb950",
  "route-table": "#79c0ff",
  compute: "#f778ba",
  database: "#d2a8ff",
  "load-balancer": "#56d364",
  container: "#ff7b72",
  "nat-gateway": "#ffa657",
  "elastic-ip": "#a5d6ff",
  custom: "#8b949e",
};

export const RESOURCE_TYPE_SHAPES: Record<string, string> = {
  vpc: "roundrectangle",
  subnet: "ellipse",
  "security-group": "diamond",
  "iam-role": "hexagon",
  storage: "barrel",
  "internet-gateway": "triangle",
  "route-table": "rectangle",
  compute: "star",
  database: "octagon",
  "load-balancer": "vee",
  custom: "pentagon",
};
