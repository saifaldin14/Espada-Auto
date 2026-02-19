/**
 * Infrastructure Knowledge Graph — Core Types
 *
 * Universal data model for resources, relationships, changes, and groupings
 * across all connected cloud providers. Every type here is provider-agnostic;
 * provider-specific adapters normalize into these shapes.
 */

// =============================================================================
// Provider Identity
// =============================================================================

/** Canonical cloud provider identifiers. */
export type CloudProvider =
  | "aws"
  | "azure"
  | "gcp"
  | "kubernetes"
  | "custom"
  // Hybrid/edge providers:
  | "azure-arc"
  | "gdc"
  | "vmware"
  | "nutanix";

// =============================================================================
// Graph Node — Universal Resource Representation
// =============================================================================

/**
 * Abstract resource categories, aligned with InfrastructureResourceType from
 * @espada/infrastructure but extended with graph-specific entries.
 */
export type GraphResourceType =
  | "compute"
  | "storage"
  | "network"
  | "database"
  | "cache"
  | "queue"
  | "function"
  | "serverless-function"
  | "container"
  | "cluster"
  | "load-balancer"
  | "dns"
  | "certificate"
  | "secret"
  | "policy"
  | "identity"
  | "vpc"
  | "subnet"
  | "security-group"
  | "iam-role"
  | "nat-gateway"
  | "api-gateway"
  | "cdn"
  | "topic"
  | "stream"
  | "custom"
  // Hybrid/edge resource types:
  | "hybrid-machine"
  | "connected-cluster"
  | "custom-location"
  | "outpost"
  | "edge-site"
  | "hci-cluster"
  | "fleet";

/** Canonical resource status. */
export type GraphNodeStatus =
  | "running"
  | "stopped"
  | "pending"
  | "creating"
  | "deleting"
  | "deleted"
  | "error"
  | "unknown"
  | "disappeared";

/**
 * A single resource node in the knowledge graph.
 *
 * `id` is deterministic: `{provider}:{account}:{region}:{resourceType}:{nativeId}`
 * so the same resource always maps to the same node across syncs.
 */
export type GraphNode = {
  /** Deterministic graph-wide unique ID. */
  id: string;

  /** Cloud provider that owns this resource. */
  provider: CloudProvider;

  /** Abstract resource category. */
  resourceType: GraphResourceType;

  /**
   * Provider-native identifier.
   * AWS: ARN. Azure: full resource ID. GCP: self-link. K8s: namespace/kind/name.
   */
  nativeId: string;

  /** Human-readable name (often the Name tag or resource name). */
  name: string;

  /** Region / location / zone. */
  region: string;

  /** Account ID, subscription ID, or project ID. */
  account: string;

  /** Current status. */
  status: GraphNodeStatus;

  /** Resource tags (key→value). */
  tags: Record<string, string>;

  /**
   * Provider-specific metadata that doesn't map to a standard field.
   * Examples: instance type, engine version, storage class.
   */
  metadata: Record<string, unknown>;

  /** Estimated monthly cost in USD (null if unknown). */
  costMonthly: number | null;

  /** Inferred owner — from tags, IAM, or org structure. */
  owner: string | null;

  /** When this resource was first discovered by the graph. */
  discoveredAt: string;

  /** When this resource was first created (provider-reported, if available). */
  createdAt: string | null;

  /** When any field on this node was last updated in the graph. */
  updatedAt: string;

  /** When the last sync confirmed this resource still exists. */
  lastSeenAt: string;
};

/**
 * Fields required to insert/upsert a node. Timestamps are auto-managed.
 */
export type GraphNodeInput = Omit<GraphNode, "discoveredAt" | "updatedAt" | "lastSeenAt"> & {
  discoveredAt?: string;
  updatedAt?: string;
  lastSeenAt?: string;
};

// =============================================================================
// Graph Edge — Relationship Between Resources
// =============================================================================

/**
 * Relationship types between infrastructure resources.
 *
 * Naming convention: source → verb → target.
 *   e.g. EC2 --runs-in--> VPC, ALB --routes-to--> TargetGroup
 */
export type GraphRelationshipType =
  | "runs-in"
  | "contains"
  | "secured-by"
  | "secures"
  | "routes-to"
  | "receives-from"
  | "triggers"
  | "triggered-by"
  | "reads-from"
  | "writes-to"
  | "stores-in"
  | "uses"
  | "used-by"
  | "attached-to"
  | "depends-on"
  | "depended-on-by"
  | "replicates-to"
  | "replicates"
  | "peers-with"
  | "member-of"
  | "load-balances"
  | "resolves-to"
  | "encrypts-with"
  | "authenticated-by"
  | "publishes-to"
  | "subscribes-to"
  | "monitors"
  | "monitored-by"
  | "logs-to"
  | "receives-logs-from"
  | "backed-by"
  | "backs"
  | "aliases"
  | "backs-up"
  | "connects-via"
  | "exposes"
  | "inherits-from"
  | "custom"
  // Hybrid/edge relationship types:
  | "managed-by"
  | "hosted-on"
  | "member-of-fleet"
  | "deployed-at"
  | "connected-to";

/** How a relationship was discovered. */
export type EdgeDiscoveryMethod =
  | "config-scan"
  | "api-field"
  | "runtime-trace"
  | "iac-parse"
  | "event-stream"
  | "manual";

/**
 * A directed edge between two graph nodes.
 */
export type GraphEdge = {
  /** Unique edge ID. */
  id: string;

  /** Source node ID. */
  sourceNodeId: string;

  /** Target node ID. */
  targetNodeId: string;

  /** Relationship type (source → verb → target). */
  relationshipType: GraphRelationshipType;

  /**
   * Confidence score: 1.0 for config-derived, 0.7 for runtime traces,
   * 0.5 for heuristic/manual.
   */
  confidence: number;

  /** How this edge was discovered. */
  discoveredVia: EdgeDiscoveryMethod;

  /** Extra context (port, protocol, IAM role ARN, etc.). */
  metadata: Record<string, unknown>;

  /** When this edge was first created. */
  createdAt: string;

  /** When the last sync confirmed this edge still exists. */
  lastSeenAt: string;
};

export type GraphEdgeInput = Omit<GraphEdge, "createdAt" | "lastSeenAt"> & {
  createdAt?: string;
  lastSeenAt?: string;
};

// =============================================================================
// Change Tracking — Append-Only Changelog
// =============================================================================

/** Types of changes the graph can record. */
export type GraphChangeType =
  | "node-created"
  | "node-updated"
  | "node-deleted"
  | "node-disappeared"
  | "node-drifted"
  | "edge-created"
  | "edge-deleted"
  | "cost-changed";

/** How a change was detected. */
export type ChangeDetectionMethod =
  | "sync"
  | "webhook"
  | "drift-scan"
  | "event-stream"
  | "manual";

/**
 * An immutable record of a state change in the graph.
 * Append-only — never deleted, never mutated.
 */
export type GraphChange = {
  /** Unique change ID. */
  id: string;

  /** ID of the affected node (or edge, prefixed with `edge:`). */
  targetId: string;

  /** What kind of change occurred. */
  changeType: GraphChangeType;

  /** Which field changed (e.g. "status", "tags.Environment", "costMonthly"). */
  field: string | null;

  /** Value before the change (JSON-serialized for complex values). */
  previousValue: string | null;

  /** Value after the change (JSON-serialized for complex values). */
  newValue: string | null;

  /** When the change was detected. */
  detectedAt: string;

  /** How the change was detected. */
  detectedVia: ChangeDetectionMethod;

  /** Links to audit logger events, operation IDs, etc. */
  correlationId: string | null;

  /** Additional context. */
  metadata: Record<string, unknown>;
};

// =============================================================================
// Resource Grouping
// =============================================================================

/** Types of logical groupings. */
export type GraphGroupType =
  | "application"
  | "service"
  | "stack"
  | "team"
  | "environment"
  | "cost-center"
  | "vpc"
  | "region"
  | "account"
  | "custom";

/**
 * A logical grouping of graph nodes (e.g. "payments service",
 * "production environment", "platform team").
 */
export type GraphGroup = {
  /** Unique group ID. */
  id: string;

  /** Human-readable name. */
  name: string;

  /** What kind of grouping this represents. */
  groupType: GraphGroupType;

  /** Cloud provider (optional — groups can span providers). */
  provider?: CloudProvider;

  /** Description. */
  description?: string;

  /** Owner. */
  owner?: string | null;

  /** Tags. */
  tags?: Record<string, string>;

  /** Aggregated monthly cost of all member nodes (computed). */
  costMonthly?: number | null;

  createdAt: string;
  updatedAt: string;
};

/**
 * Junction record linking a group to its member nodes.
 */
export type GraphGroupMember = {
  groupId: string;
  nodeId: string;
  addedAt: string;
};

// =============================================================================
// Sync State
// =============================================================================

/** Status of a sync run. */
export type SyncStatus = "running" | "completed" | "failed" | "partial";

/** Record of a graph sync operation. */
export type SyncRecord = {
  id: string;
  provider: CloudProvider | "all";
  status: SyncStatus;
  startedAt: string;
  completedAt: string | null;
  nodesDiscovered: number;
  nodesCreated: number;
  nodesUpdated: number;
  nodesDisappeared: number;
  edgesDiscovered: number;
  edgesCreated: number;
  edgesRemoved: number;
  changesRecorded: number;
  errors: string[];
  durationMs: number | null;
};

// =============================================================================
// Query Types
// =============================================================================

/** Filter for querying nodes. */
export type NodeFilter = {
  provider?: CloudProvider;
  resourceType?: GraphResourceType | GraphResourceType[];
  region?: string;
  account?: string;
  status?: GraphNodeStatus | GraphNodeStatus[];
  tags?: Record<string, string>;
  namePattern?: string;
  owner?: string;
  minCost?: number;
  maxCost?: number;
};

/** Filter for querying edges. */
export type EdgeFilter = {
  sourceNodeId?: string;
  targetNodeId?: string;
  relationshipType?: GraphRelationshipType | GraphRelationshipType[];
  minConfidence?: number;
  discoveredVia?: EdgeDiscoveryMethod;
};

/** Filter for querying changes. */
export type ChangeFilter = {
  targetId?: string;
  changeType?: GraphChangeType | GraphChangeType[];
  since?: string;
  until?: string;
  detectedVia?: ChangeDetectionMethod;
  correlationId?: string;
};

/** Direction for dependency chain traversal. */
export type TraversalDirection = "upstream" | "downstream" | "both";

/**
 * Result of a blast-radius or dependency-chain query.
 * Nodes are grouped by hop distance from the starting node.
 */
export type SubgraphResult = {
  /** The starting node. */
  rootNodeId: string;
  /** All nodes in the subgraph, keyed by ID. */
  nodes: Map<string, GraphNode>;
  /** All edges in the subgraph. */
  edges: GraphEdge[];
  /** Nodes grouped by hop distance from root (0 = root itself). */
  hops: Map<number, string[]>;
  /** Total estimated monthly cost of all nodes. */
  totalCostMonthly: number;
};

/**
 * Result of a drift detection scan.
 */
export type DriftResult = {
  /** Nodes that changed since last sync. */
  driftedNodes: Array<{
    node: GraphNode;
    changes: GraphChange[];
  }>;
  /** Nodes that disappeared (existed before, not found now). */
  disappearedNodes: GraphNode[];
  /** New nodes not previously tracked. */
  newNodes: GraphNode[];
  /** When the scan was performed. */
  scannedAt: string;
};

/**
 * Cost attribution result.
 */
export type CostAttribution = {
  /** Root entity (node, group, or filter). */
  label: string;
  /** Total monthly cost. */
  totalMonthly: number;
  /** Breakdown by resource type. */
  byResourceType: Record<string, number>;
  /** Breakdown by provider. */
  byProvider: Record<string, number>;
  /** Individual node costs. */
  nodes: Array<{ nodeId: string; name: string; resourceType: GraphResourceType; costMonthly: number }>;
};

// =============================================================================
// Graph Storage Interface
// =============================================================================

/**
 * Abstract storage backend for the knowledge graph.
 * Implementations: SQLiteGraphStorage (production), InMemoryGraphStorage (tests).
 */
export interface GraphStorage {
  // -- Lifecycle --
  initialize(): Promise<void>;
  close(): Promise<void>;

  // -- Nodes --
  upsertNode(node: GraphNodeInput): Promise<void>;
  upsertNodes(nodes: GraphNodeInput[]): Promise<void>;
  getNode(id: string): Promise<GraphNode | null>;
  getNodeByNativeId(provider: CloudProvider, nativeId: string): Promise<GraphNode | null>;
  queryNodes(filter: NodeFilter): Promise<GraphNode[]>;
  deleteNode(id: string): Promise<void>;
  markNodesDisappeared(olderThan: string, provider?: CloudProvider): Promise<string[]>;

  // -- Edges --
  upsertEdge(edge: GraphEdgeInput): Promise<void>;
  upsertEdges(edges: GraphEdgeInput[]): Promise<void>;
  getEdge(id: string): Promise<GraphEdge | null>;
  getEdgesForNode(nodeId: string, direction: TraversalDirection, relationshipType?: GraphRelationshipType): Promise<GraphEdge[]>;
  queryEdges(filter: EdgeFilter): Promise<GraphEdge[]>;
  deleteEdge(id: string): Promise<void>;
  deleteStaleEdges(olderThan: string): Promise<number>;

  // -- Changes (append-only) --
  appendChange(change: GraphChange): Promise<void>;
  appendChanges(changes: GraphChange[]): Promise<void>;
  getChanges(filter: ChangeFilter): Promise<GraphChange[]>;
  getNodeTimeline(nodeId: string, limit?: number): Promise<GraphChange[]>;

  // -- Groups --
  upsertGroup(group: GraphGroup): Promise<void>;
  getGroup(id: string): Promise<GraphGroup | null>;
  listGroups(groupType?: GraphGroupType): Promise<GraphGroup[]>;
  deleteGroup(id: string): Promise<void>;
  addGroupMember(groupId: string, nodeId: string): Promise<void>;
  removeGroupMember(groupId: string, nodeId: string): Promise<void>;
  getGroupMembers(groupId: string): Promise<GraphNode[]>;
  getNodeGroups(nodeId: string): Promise<GraphGroup[]>;

  // -- Sync records --
  saveSyncRecord(record: SyncRecord): Promise<void>;
  getLastSyncRecord(provider?: CloudProvider): Promise<SyncRecord | null>;
  listSyncRecords(limit?: number): Promise<SyncRecord[]>;

  // -- Graph traversal (implemented via recursive queries) --
  getNeighbors(nodeId: string, depth: number, direction: TraversalDirection, edgeTypes?: GraphRelationshipType[]): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;

  // -- Stats --
  getStats(): Promise<GraphStats>;
}

/** Summary statistics about the graph. */
export type GraphStats = {
  totalNodes: number;
  totalEdges: number;
  totalChanges: number;
  totalGroups: number;
  nodesByProvider: Record<string, number>;
  nodesByResourceType: Record<string, number>;
  edgesByRelationshipType: Record<string, number>;
  totalCostMonthly: number;
  lastSyncAt: string | null;
  oldestChange: string | null;
  newestChange: string | null;
};

// =============================================================================
// Hybrid/Edge Location Types
// =============================================================================

/** Classification of a resource's physical or logical location. */
export type GraphNodeLocationType =
  | "cloud-region"
  | "availability-zone"
  | "edge-site"
  | "on-premises"
  | "custom-location";

/** Connectivity status for hybrid/edge resources. */
export type ConnectivityStatus =
  | "connected"
  | "degraded"
  | "disconnected"
  | "unknown";

/**
 * Generalised location for graph nodes — extends "region" to include
 * physical sites, edge locations, and on-premises data centres.
 */
export type GraphNodeLocation = {
  /** Location classification. */
  type: GraphNodeLocationType;
  /** Human-readable name (e.g. "Seattle Warehouse 3"). */
  name: string;
  /** Cloud provider managing this location. */
  provider: CloudProvider;
  /** Cloud region (for cloud-region / availability-zone types). */
  region?: string;
  /** Parent cloud region this edge site connects to. */
  parentRegion?: string;
  /** Geographic coordinates. */
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  /** Physical address. */
  address?: {
    city?: string;
    state?: string;
    country: string;
    postalCode?: string;
  };
  /** Current connectivity status. */
  connectivityStatus?: ConnectivityStatus;
};
