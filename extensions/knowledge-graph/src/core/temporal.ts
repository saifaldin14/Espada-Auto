/**
 * Infrastructure Knowledge Graph — Temporal Knowledge Graph
 *
 * Adds time-travel capabilities to the knowledge graph:
 * - Point-in-time snapshots of the entire graph state
 * - Snapshot comparison / diffing
 * - Node history across snapshots
 * - Configurable retention / compaction
 *
 * Uses additional SQLite tables (snapshots, node_versions, edge_versions)
 * layered on top of the existing storage schema.
 */

import type {
  GraphStorage,
  GraphNode,
  GraphEdge,
  NodeFilter,
  CloudProvider,
} from "../types.js";
import type { GraphEngine } from "./engine.js";

// =============================================================================
// Types
// =============================================================================

/** Metadata for a graph snapshot. */
export type GraphSnapshot = {
  id: string;
  createdAt: string;
  /** What triggered the snapshot (sync, manual, scheduled). */
  trigger: "sync" | "manual" | "scheduled";
  /** Provider that triggered (null for full-graph snapshots). */
  provider: CloudProvider | null;
  /** Label for easy identification. */
  label: string | null;
  nodeCount: number;
  edgeCount: number;
  totalCostMonthly: number;
};

/** A versioned node entry (node at a point in time). */
export type NodeVersion = {
  nodeId: string;
  snapshotId: string;
  snapshotCreatedAt: string;
  node: GraphNode;
};

/** A versioned edge entry. */
export type EdgeVersion = {
  edgeId: string;
  snapshotId: string;
  snapshotCreatedAt: string;
  edge: GraphEdge;
};

/** Result of comparing two snapshots. */
export type SnapshotDiff = {
  fromSnapshot: GraphSnapshot;
  toSnapshot: GraphSnapshot;
  addedNodes: GraphNode[];
  removedNodes: GraphNode[];
  changedNodes: Array<{
    nodeId: string;
    before: GraphNode;
    after: GraphNode;
    changedFields: string[];
  }>;
  addedEdges: GraphEdge[];
  removedEdges: GraphEdge[];
  costDelta: number;
};

/** Retention configuration for snapshots. */
export type SnapshotRetentionConfig = {
  /** Max number of snapshots to keep (oldest pruned first). */
  maxSnapshots?: number;
  /** Max age in milliseconds (snapshots older than this are pruned). */
  maxAgeMs?: number;
  /** Whether to compact old snapshots (daily → weekly → monthly). */
  compaction?: boolean;
};

/** Default retention: keep 90 days, 500 max snapshots. */
export const DEFAULT_RETENTION: SnapshotRetentionConfig = {
  maxSnapshots: 500,
  maxAgeMs: 90 * 24 * 60 * 60 * 1000, // 90 days
  compaction: false,
};

// =============================================================================
// Temporal Storage Interface
// =============================================================================

/**
 * Extension of GraphStorage that supports temporal snapshots.
 * Implementations can layer this on top of the existing SQLite storage.
 */
export interface TemporalGraphStorage {
  /** Create temporal tables if they don't exist. */
  initializeTemporal(): Promise<void>;

  /** Take a snapshot of the current graph state. */
  createSnapshot(trigger: GraphSnapshot["trigger"], label?: string | null, provider?: CloudProvider | null): Promise<GraphSnapshot>;

  /** Get a snapshot by ID. */
  getSnapshot(id: string): Promise<GraphSnapshot | null>;

  /** List snapshots, optionally filtered and limited. */
  listSnapshots(filter?: {
    since?: string;
    until?: string;
    trigger?: GraphSnapshot["trigger"];
    provider?: CloudProvider | null;
    limit?: number;
  }): Promise<GraphSnapshot[]>;

  /** Delete a snapshot and its versioned data. */
  deleteSnapshot(id: string): Promise<void>;

  /** Get all nodes from a specific snapshot. */
  getNodesAtSnapshot(snapshotId: string, filter?: NodeFilter): Promise<GraphNode[]>;

  /** Get all edges from a specific snapshot. */
  getEdgesAtSnapshot(snapshotId: string): Promise<GraphEdge[]>;

  /** Get the full history of a node across snapshots. */
  getNodeHistory(nodeId: string, limit?: number): Promise<NodeVersion[]>;

  /** Get the full history of an edge across snapshots. */
  getEdgeHistory(edgeId: string, limit?: number): Promise<EdgeVersion[]>;

  /** Diff two snapshots. */
  diffSnapshots(fromId: string, toId: string): Promise<SnapshotDiff>;

  /** Prune old snapshots based on retention config. */
  pruneSnapshots(retention: SnapshotRetentionConfig): Promise<number>;

  /** Get the closest snapshot to a given timestamp. */
  getSnapshotAt(timestamp: string): Promise<GraphSnapshot | null>;
}

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

// =============================================================================
// In-Memory Temporal Storage (for tests)
// =============================================================================

/**
 * In-memory implementation of TemporalGraphStorage.
 * Wraps an existing GraphStorage and stores snapshots in-memory.
 */
export class InMemoryTemporalStorage implements TemporalGraphStorage {
  private snapshots: Map<string, GraphSnapshot> = new Map();
  private nodeVersions: Map<string, Map<string, GraphNode>> = new Map(); // snapshotId → nodeId → node
  private edgeVersions: Map<string, Map<string, GraphEdge>> = new Map(); // snapshotId → edgeId → edge
  private storage: GraphStorage;
  private _seq: Map<string, number> = new Map(); // snapshot ID → creation order
  private _nextSeq = 0;

  constructor(storage: GraphStorage) {
    this.storage = storage;
  }

  async initializeTemporal(): Promise<void> {
    // No-op for in-memory
  }

  async createSnapshot(
    trigger: GraphSnapshot["trigger"],
    label?: string | null,
    provider?: CloudProvider | null,
  ): Promise<GraphSnapshot> {
    const id = generateId();
    const createdAt = nowISO();

    // Capture current graph state
    const nodes = await this.storage.queryNodes({});
    const nodesMap = new Map<string, GraphNode>();
    for (const n of nodes) {
      nodesMap.set(n.id, { ...n });
    }

    // Gather edges
    const edgesMap = new Map<string, GraphEdge>();
    const edgeSeen = new Set<string>();
    for (const node of nodes) {
      const edges = await this.storage.getEdgesForNode(node.id, "both");
      for (const e of edges) {
        if (!edgeSeen.has(e.id)) {
          edgeSeen.add(e.id);
          edgesMap.set(e.id, { ...e });
        }
      }
    }

    const totalCost = nodes.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0);

    const snapshot: GraphSnapshot = {
      id,
      createdAt,
      trigger,
      provider: provider ?? null,
      label: label ?? null,
      nodeCount: nodes.length,
      edgeCount: edgesMap.size,
      totalCostMonthly: totalCost,
    };

    this.snapshots.set(id, snapshot);
    this._seq.set(id, this._nextSeq++);
    this.nodeVersions.set(id, nodesMap);
    this.edgeVersions.set(id, edgesMap);

    return snapshot;
  }

  async getSnapshot(id: string): Promise<GraphSnapshot | null> {
    return this.snapshots.get(id) ?? null;
  }

  async listSnapshots(filter?: {
    since?: string;
    until?: string;
    trigger?: GraphSnapshot["trigger"];
    provider?: CloudProvider | null;
    limit?: number;
  }): Promise<GraphSnapshot[]> {
    let results = Array.from(this.snapshots.values());

    if (filter?.since) {
      results = results.filter((s) => s.createdAt >= filter.since!);
    }
    if (filter?.until) {
      results = results.filter((s) => s.createdAt <= filter.until!);
    }
    if (filter?.trigger) {
      results = results.filter((s) => s.trigger === filter.trigger);
    }
    if (filter?.provider !== undefined) {
      results = results.filter((s) => s.provider === filter.provider);
    }

    results.sort((a, b) => {
      const cmp = b.createdAt.localeCompare(a.createdAt);
      if (cmp !== 0) return cmp;
      // Tiebreaker: higher sequence = newer
      return (this._seq.get(b.id) ?? 0) - (this._seq.get(a.id) ?? 0);
    });

    if (filter?.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async deleteSnapshot(id: string): Promise<void> {
    this.snapshots.delete(id);
    this.nodeVersions.delete(id);
    this.edgeVersions.delete(id);
  }

  async getNodesAtSnapshot(snapshotId: string, filter?: NodeFilter): Promise<GraphNode[]> {
    const nodesMap = this.nodeVersions.get(snapshotId);
    if (!nodesMap) return [];

    let nodes = Array.from(nodesMap.values());

    if (filter) {
      if (filter.provider) nodes = nodes.filter((n) => n.provider === filter.provider);
      if (filter.resourceType) {
        const types = Array.isArray(filter.resourceType) ? filter.resourceType : [filter.resourceType];
        nodes = nodes.filter((n) => types.includes(n.resourceType));
      }
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        nodes = nodes.filter((n) => statuses.includes(n.status));
      }
      if (filter.region) nodes = nodes.filter((n) => n.region === filter.region);
      if (filter.account) nodes = nodes.filter((n) => n.account === filter.account);
    }

    return nodes;
  }

  async getEdgesAtSnapshot(snapshotId: string): Promise<GraphEdge[]> {
    const edgesMap = this.edgeVersions.get(snapshotId);
    if (!edgesMap) return [];
    return Array.from(edgesMap.values());
  }

  async getNodeHistory(nodeId: string, limit = 50): Promise<NodeVersion[]> {
    const history: NodeVersion[] = [];

    // Sort snapshots chronologically (newest first)
    const sorted = Array.from(this.snapshots.values()).sort(
      (a, b) => {
        const cmp = b.createdAt.localeCompare(a.createdAt);
        if (cmp !== 0) return cmp;
        return (this._seq.get(b.id) ?? 0) - (this._seq.get(a.id) ?? 0);
      },
    );

    for (const snap of sorted) {
      if (history.length >= limit) break;
      const nodesMap = this.nodeVersions.get(snap.id);
      const node = nodesMap?.get(nodeId);
      if (node) {
        history.push({
          nodeId,
          snapshotId: snap.id,
          snapshotCreatedAt: snap.createdAt,
          node,
        });
      }
    }

    return history;
  }

  async getEdgeHistory(edgeId: string, limit = 50): Promise<EdgeVersion[]> {
    const history: EdgeVersion[] = [];
    const sorted = Array.from(this.snapshots.values()).sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || (this._seq.get(b.id) ?? 0) - (this._seq.get(a.id) ?? 0),
    );

    for (const snap of sorted) {
      if (history.length >= limit) break;
      const edgesMap = this.edgeVersions.get(snap.id);
      const edge = edgesMap?.get(edgeId);
      if (edge) {
        history.push({
          edgeId,
          snapshotId: snap.id,
          snapshotCreatedAt: snap.createdAt,
          edge,
        });
      }
    }

    return history;
  }

  async diffSnapshots(fromId: string, toId: string): Promise<SnapshotDiff> {
    const fromSnap = this.snapshots.get(fromId);
    const toSnap = this.snapshots.get(toId);
    if (!fromSnap) throw new Error(`Snapshot not found: ${fromId}`);
    if (!toSnap) throw new Error(`Snapshot not found: ${toId}`);

    const fromNodes = this.nodeVersions.get(fromId) ?? new Map<string, GraphNode>();
    const toNodes = this.nodeVersions.get(toId) ?? new Map<string, GraphNode>();
    const fromEdges = this.edgeVersions.get(fromId) ?? new Map<string, GraphEdge>();
    const toEdges = this.edgeVersions.get(toId) ?? new Map<string, GraphEdge>();

    return computeDiff(fromSnap, toSnap, fromNodes, toNodes, fromEdges, toEdges);
  }

  async pruneSnapshots(retention: SnapshotRetentionConfig): Promise<number> {
    let pruned = 0;
    const sorted = Array.from(this.snapshots.values()).sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || (this._seq.get(b.id) ?? 0) - (this._seq.get(a.id) ?? 0),
    );

    const cutoffDate = retention.maxAgeMs
      ? new Date(Date.now() - retention.maxAgeMs).toISOString()
      : null;

    for (let i = 0; i < sorted.length; i++) {
      const snap = sorted[i]!;
      const overLimit = retention.maxSnapshots && i >= retention.maxSnapshots;
      const tooOld = cutoffDate && snap.createdAt < cutoffDate;

      if (overLimit || tooOld) {
        await this.deleteSnapshot(snap.id);
        pruned++;
      }
    }

    return pruned;
  }

  async getSnapshotAt(timestamp: string): Promise<GraphSnapshot | null> {
    const sorted = Array.from(this.snapshots.values()).sort(
      (a, b) => {
        const cmp = b.createdAt.localeCompare(a.createdAt);
        if (cmp !== 0) return cmp;
        return (this._seq.get(b.id) ?? 0) - (this._seq.get(a.id) ?? 0);
      },
    );

    // Find closest snapshot at or before the timestamp
    for (const snap of sorted) {
      if (snap.createdAt <= timestamp) return snap;
    }

    return sorted[sorted.length - 1] ?? null;
  }
}

// =============================================================================
// Diff Logic
// =============================================================================

/** Compute the diff between two snapshot states. */
function computeDiff(
  fromSnap: GraphSnapshot,
  toSnap: GraphSnapshot,
  fromNodes: Map<string, GraphNode>,
  toNodes: Map<string, GraphNode>,
  fromEdges: Map<string, GraphEdge>,
  toEdges: Map<string, GraphEdge>,
): SnapshotDiff {
  const addedNodes: GraphNode[] = [];
  const removedNodes: GraphNode[] = [];
  const changedNodes: SnapshotDiff["changedNodes"] = [];
  const addedEdges: GraphEdge[] = [];
  const removedEdges: GraphEdge[] = [];

  // Nodes added & changed
  for (const [id, toNode] of toNodes) {
    const fromNode = fromNodes.get(id);
    if (!fromNode) {
      addedNodes.push(toNode);
    } else {
      const changedFields = diffNodeFields(fromNode, toNode);
      if (changedFields.length > 0) {
        changedNodes.push({
          nodeId: id,
          before: fromNode,
          after: toNode,
          changedFields,
        });
      }
    }
  }

  // Nodes removed
  for (const [id, fromNode] of fromNodes) {
    if (!toNodes.has(id)) {
      removedNodes.push(fromNode);
    }
  }

  // Edges added
  for (const [id, toEdge] of toEdges) {
    if (!fromEdges.has(id)) addedEdges.push(toEdge);
  }

  // Edges removed
  for (const [id, fromEdge] of fromEdges) {
    if (!toEdges.has(id)) removedEdges.push(fromEdge);
  }

  const costDelta = toSnap.totalCostMonthly - fromSnap.totalCostMonthly;

  return {
    fromSnapshot: fromSnap,
    toSnapshot: toSnap,
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges,
    removedEdges,
    costDelta,
  };
}

/** Compare two node snapshots and return changed field names. */
function diffNodeFields(a: GraphNode, b: GraphNode): string[] {
  const changed: string[] = [];

  if (a.status !== b.status) changed.push("status");
  if (a.name !== b.name) changed.push("name");
  if (a.region !== b.region) changed.push("region");
  if (a.account !== b.account) changed.push("account");
  if (a.owner !== b.owner) changed.push("owner");
  if (a.costMonthly !== b.costMonthly) changed.push("costMonthly");

  if (JSON.stringify(a.tags) !== JSON.stringify(b.tags)) changed.push("tags");
  if (JSON.stringify(a.metadata) !== JSON.stringify(b.metadata)) changed.push("metadata");

  return changed;
}

// =============================================================================
// Temporal Engine Methods
// =============================================================================

/**
 * Extends GraphEngine with temporal / time-travel capabilities.
 *
 * Rather than modifying GraphEngine directly, this provides standalone
 * functions that take an engine + temporal storage so they can be used
 * independently without coupling.
 */

/** Take a snapshot of the current graph state. */
export async function takeSnapshot(
  temporal: TemporalGraphStorage,
  trigger: GraphSnapshot["trigger"],
  label?: string,
  provider?: CloudProvider,
): Promise<GraphSnapshot> {
  return temporal.createSnapshot(trigger, label ?? null, provider ?? null);
}

/** Get the graph topology at a specific point in time. */
export async function getTopologyAt(
  temporal: TemporalGraphStorage,
  timestamp: string,
  filter?: NodeFilter,
): Promise<{ snapshot: GraphSnapshot; nodes: GraphNode[]; edges: GraphEdge[] } | null> {
  const snapshot = await temporal.getSnapshotAt(timestamp);
  if (!snapshot) return null;

  const nodes = await temporal.getNodesAtSnapshot(snapshot.id, filter);
  const edges = await temporal.getEdgesAtSnapshot(snapshot.id);

  // Filter edges to only those with both endpoints in the node set
  const nodeIds = new Set(nodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId),
  );

  return { snapshot, nodes, edges: filteredEdges };
}

/** Get the complete history of a node across all snapshots. */
export async function getNodeHistory(
  temporal: TemporalGraphStorage,
  nodeId: string,
  limit = 50,
): Promise<NodeVersion[]> {
  return temporal.getNodeHistory(nodeId, limit);
}

/** Diff two snapshots by ID. */
export async function diffSnapshots(
  temporal: TemporalGraphStorage,
  fromId: string,
  toId: string,
): Promise<SnapshotDiff> {
  return temporal.diffSnapshots(fromId, toId);
}

/**
 * Diff the graph between two timestamps.
 * Finds the closest snapshots and compares them.
 */
export async function diffTimestamps(
  temporal: TemporalGraphStorage,
  from: string,
  to: string,
): Promise<SnapshotDiff | null> {
  const fromSnap = await temporal.getSnapshotAt(from);
  const toSnap = await temporal.getSnapshotAt(to);
  if (!fromSnap || !toSnap) return null;
  if (fromSnap.id === toSnap.id) {
    // Same snapshot — no diff
    return {
      fromSnapshot: fromSnap,
      toSnapshot: toSnap,
      addedNodes: [],
      removedNodes: [],
      changedNodes: [],
      addedEdges: [],
      removedEdges: [],
      costDelta: 0,
    };
  }
  return temporal.diffSnapshots(fromSnap.id, toSnap.id);
}

/**
 * Get a summary of how the graph has evolved over a time range.
 * Useful for dashboards and trend analysis.
 */
export async function getEvolutionSummary(
  temporal: TemporalGraphStorage,
  since?: string,
  until?: string,
): Promise<{
  snapshots: Array<{
    id: string;
    createdAt: string;
    nodeCount: number;
    edgeCount: number;
    totalCostMonthly: number;
    trigger: string;
  }>;
  nodeCountTrend: Array<{ timestamp: string; count: number }>;
  costTrend: Array<{ timestamp: string; cost: number }>;
  netChange: {
    nodesAdded: number;
    nodesRemoved: number;
    costDelta: number;
  };
}> {
  const snapshots = await temporal.listSnapshots({ since, until });

  // listSnapshots returns newest-first (stable); reverse for oldest-first trend
  const sorted = [...snapshots].reverse();

  const summarySnapshots = sorted.map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    nodeCount: s.nodeCount,
    edgeCount: s.edgeCount,
    totalCostMonthly: s.totalCostMonthly,
    trigger: s.trigger,
  }));

  const nodeCountTrend = sorted.map((s) => ({
    timestamp: s.createdAt,
    count: s.nodeCount,
  }));

  const costTrend = sorted.map((s) => ({
    timestamp: s.createdAt,
    cost: s.totalCostMonthly,
  }));

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const netChange = first && last
    ? {
        nodesAdded: Math.max(0, last.nodeCount - first.nodeCount),
        nodesRemoved: Math.max(0, first.nodeCount - last.nodeCount),
        costDelta: last.totalCostMonthly - first.totalCostMonthly,
      }
    : { nodesAdded: 0, nodesRemoved: 0, costDelta: 0 };

  return {
    snapshots: summarySnapshots,
    nodeCountTrend,
    costTrend,
    netChange,
  };
}

/**
 * Auto-snapshot wrapper: take a snapshot after each sync if temporal storage
 * is configured. This integrates with the engine's sync workflow.
 */
export async function syncWithSnapshot(
  engine: GraphEngine,
  temporal: TemporalGraphStorage,
  options?: {
    providers?: CloudProvider[];
    label?: string;
    retention?: SnapshotRetentionConfig;
  },
): Promise<{
  syncRecords: import("../types.js").SyncRecord[];
  snapshot: GraphSnapshot;
  pruned: number;
}> {
  // Run the sync
  const syncRecords = await engine.sync({
    providers: options?.providers,
  });

  // Take a snapshot of the post-sync state
  const snapshot = await takeSnapshot(temporal, "sync", options?.label);

  // Apply retention
  const retention = options?.retention ?? DEFAULT_RETENTION;
  const pruned = await temporal.pruneSnapshots(retention);

  return { syncRecords, snapshot, pruned };
}
