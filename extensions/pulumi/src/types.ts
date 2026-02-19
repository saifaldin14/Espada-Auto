/**
 * Pulumi extension types — stacks, resources, state, outputs.
 */

/* ---------- Resource / State ---------- */

export type PulumiResourceType = string; // e.g. "aws:s3/bucket:Bucket"

export interface PulumiResource {
  urn: string;
  type: PulumiResourceType;
  custom: boolean;
  id?: string;
  parent?: string;
  provider?: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  dependencies?: string[];
}

export interface PulumiState {
  version: number;
  deployment: {
    manifest: {
      time: string;
      magic: string;
      version: string;
    };
    resources: PulumiResource[];
  };
}

/* ---------- Stack ---------- */

export interface PulumiStack {
  name: string;
  current: boolean;
  updateInProgress: boolean;
  lastUpdate?: string;
  resourceCount?: number;
  url?: string;
}

export interface PulumiOutput {
  name: string;
  value: unknown;
  secret: boolean;
}

/* ---------- Parsed / Normalized ---------- */

export interface ParsedPulumiResource {
  urn: string;
  type: string;
  name: string;
  provider: string;
  id?: string;
  parent?: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  dependencies: string[];
}

/* ---------- Preview / Up ---------- */

export type PulumiAction = "create" | "update" | "delete" | "replace" | "same";

export interface PulumiPreviewStep {
  urn: string;
  type: string;
  action: PulumiAction;
  oldState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
}

export interface PulumiPreviewSummary {
  creates: number;
  updates: number;
  deletes: number;
  replaces: number;
  sames: number;
  totalChanges: number;
  steps: PulumiPreviewStep[];
}

/* ---------- Drift ---------- */

export interface PulumiDriftField {
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface PulumiDriftedResource {
  urn: string;
  type: string;
  fields: PulumiDriftField[];
}

export interface PulumiDriftResult {
  stackName: string;
  timestamp: string;
  totalResources: number;
  driftedCount: number;
  driftedResources: PulumiDriftedResource[];
}

// ── Knowledge Graph Type Mirrors (avoid cross-extension rootDir imports) ────

export type CloudProvider = "aws" | "azure" | "gcp" | "kubernetes" | "custom";

export type GraphResourceType =
  | "compute" | "storage" | "network" | "database" | "cache"
  | "queue" | "function" | "serverless-function" | "container"
  | "cluster" | "load-balancer" | "dns" | "certificate" | "secret"
  | "policy" | "identity" | "vpc" | "subnet" | "security-group"
  | "iam-role" | "nat-gateway" | "api-gateway" | "cdn" | "topic"
  | "stream" | "custom";

export type GraphNodeStatus =
  | "running" | "stopped" | "pending" | "creating" | "deleting"
  | "deleted" | "error" | "unknown" | "disappeared";

export type GraphRelationshipType =
  | "runs-in" | "contains" | "secured-by" | "secures" | "routes-to"
  | "receives-from" | "triggers" | "triggered-by" | "reads-from"
  | "writes-to" | "stores-in" | "uses" | "used-by" | "attached-to"
  | "depends-on" | "depended-on-by" | "replicates-to" | "replicates"
  | "peers-with" | "member-of" | "load-balances" | "resolves-to"
  | "encrypts-with" | "authenticated-by" | "publishes-to"
  | "subscribes-to" | "monitors" | "monitored-by" | "logs-to"
  | "receives-logs-from" | "backed-by" | "backs" | "aliases"
  | "backs-up" | "connects-via" | "exposes" | "inherits-from" | "custom";

export type EdgeDiscoveryMethod =
  | "config-scan" | "api-field" | "runtime-trace" | "iac-parse"
  | "event-stream" | "manual";

export interface GraphNode {
  id: string;
  provider: CloudProvider;
  resourceType: GraphResourceType;
  nativeId: string;
  name: string;
  region: string;
  account: string;
  status: GraphNodeStatus;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  costMonthly: number | null;
  owner: string | null;
  discoveredAt: string;
  createdAt: string | null;
  updatedAt: string;
  lastSeenAt: string;
}

export type GraphNodeInput = Omit<GraphNode, "discoveredAt" | "updatedAt" | "lastSeenAt"> & {
  discoveredAt?: string;
  updatedAt?: string;
  lastSeenAt?: string;
};

export interface GraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: GraphRelationshipType;
  confidence: number;
  discoveredVia: EdgeDiscoveryMethod;
  metadata: Record<string, unknown>;
  createdAt: string;
  lastSeenAt: string;
}

export type GraphEdgeInput = Omit<GraphEdge, "createdAt" | "lastSeenAt"> & {
  createdAt?: string;
  lastSeenAt?: string;
};

export interface GraphStorage {
  initialize(): Promise<void>;
  close(): Promise<void>;
  upsertNode(node: GraphNodeInput): Promise<void>;
  upsertNodes(nodes: GraphNodeInput[]): Promise<void>;
  getNode(id: string): Promise<GraphNode | null>;
  getNodeByNativeId(provider: CloudProvider, nativeId: string): Promise<GraphNode | null>;
  queryNodes(filter: Record<string, unknown>): Promise<GraphNode[]>;
  deleteNode(id: string): Promise<void>;
  upsertEdge(edge: GraphEdgeInput): Promise<void>;
  upsertEdges(edges: GraphEdgeInput[]): Promise<void>;
  getEdge(id: string): Promise<GraphEdge | null>;
  queryEdges(filter: Record<string, unknown>): Promise<GraphEdge[]>;
  deleteEdge(id: string): Promise<void>;
}
