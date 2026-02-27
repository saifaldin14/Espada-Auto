/**
 * Infrastructure Knowledge Graph — SQLite Temporal Storage
 *
 * Persistent implementation of TemporalGraphStorage backed by SQLite.
 * Stores snapshots, node versions, and edge versions in dedicated tables
 * within the same database used by SQLiteGraphStorage. Supports:
 *
 *   - Point-in-time graph snapshots
 *   - Fast snapshot lookup by timestamp via indexed created_at
 *   - Node/edge history queries across snapshots
 *   - Snapshot diffing with field-level change detection
 *   - Configurable retention with age + count pruning
 *
 * Schema tables:
 *   temporal_snapshots      — snapshot metadata (id, trigger, label, counts, cost)
 *   temporal_node_versions  — full node state per snapshot (snapshot_id × node_id)
 *   temporal_edge_versions  — full edge state per snapshot (snapshot_id × edge_id)
 */

import Database from "better-sqlite3";
import type {
  GraphStorage,
  GraphNode,
  GraphEdge,
  NodeFilter,
  CloudProvider,
} from "../types.js";
import type {
  TemporalGraphStorage,
  GraphSnapshot,
  NodeVersion,
  EdgeVersion,
  SnapshotDiff,
  SnapshotRetentionConfig,
} from "../core/temporal.js";

// =============================================================================
// Schema DDL — Temporal Tables
// =============================================================================

const TEMPORAL_SCHEMA_DDL = `
-- Temporal schema version tracking
CREATE TABLE IF NOT EXISTS temporal_schema_version (
  version INTEGER NOT NULL
);

-- Graph snapshots (metadata)
CREATE TABLE IF NOT EXISTS temporal_snapshots (
  id                  TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL,
  trigger_type        TEXT NOT NULL,
  provider            TEXT,
  label               TEXT,
  node_count          INTEGER NOT NULL DEFAULT 0,
  edge_count          INTEGER NOT NULL DEFAULT 0,
  total_cost_monthly  REAL NOT NULL DEFAULT 0,
  seq                 INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tsnap_created_at ON temporal_snapshots(created_at);
CREATE INDEX IF NOT EXISTS idx_tsnap_trigger ON temporal_snapshots(trigger_type);
CREATE INDEX IF NOT EXISTS idx_tsnap_provider ON temporal_snapshots(provider);
CREATE INDEX IF NOT EXISTS idx_tsnap_seq ON temporal_snapshots(seq);

-- Node versions: full node state at each snapshot
CREATE TABLE IF NOT EXISTS temporal_node_versions (
  snapshot_id     TEXT NOT NULL,
  node_id         TEXT NOT NULL,
  provider        TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  native_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  region          TEXT NOT NULL DEFAULT '',
  account         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'unknown',
  tags            TEXT NOT NULL DEFAULT '{}',
  metadata        TEXT NOT NULL DEFAULT '{}',
  cost_monthly    REAL,
  owner           TEXT,
  discovered_at   TEXT NOT NULL,
  created_at      TEXT,
  updated_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, node_id),
  FOREIGN KEY (snapshot_id) REFERENCES temporal_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tnv_node_id ON temporal_node_versions(node_id);
CREATE INDEX IF NOT EXISTS idx_tnv_provider ON temporal_node_versions(provider);
CREATE INDEX IF NOT EXISTS idx_tnv_resource_type ON temporal_node_versions(resource_type);
CREATE INDEX IF NOT EXISTS idx_tnv_status ON temporal_node_versions(status);

-- Edge versions: full edge state at each snapshot
CREATE TABLE IF NOT EXISTS temporal_edge_versions (
  snapshot_id       TEXT NOT NULL,
  edge_id           TEXT NOT NULL,
  source_node_id    TEXT NOT NULL,
  target_node_id    TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  confidence        REAL NOT NULL DEFAULT 1.0,
  discovered_via    TEXT NOT NULL DEFAULT 'config-scan',
  metadata          TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, edge_id),
  FOREIGN KEY (snapshot_id) REFERENCES temporal_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tev_edge_id ON temporal_edge_versions(edge_id);
`;

const TEMPORAL_SCHEMA_VERSION = 1;

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

function jsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// =============================================================================
// Raw Row Types
// =============================================================================

type RawSnapshotRow = {
  id: string;
  created_at: string;
  trigger_type: string;
  provider: string | null;
  label: string | null;
  node_count: number;
  edge_count: number;
  total_cost_monthly: number;
  seq: number;
};

type RawNodeVersionRow = {
  snapshot_id: string;
  node_id: string;
  provider: string;
  resource_type: string;
  native_id: string;
  name: string;
  region: string;
  account: string;
  status: string;
  tags: string;
  metadata: string;
  cost_monthly: number | null;
  owner: string | null;
  discovered_at: string;
  created_at: string | null;
  updated_at: string;
  last_seen_at: string;
};

type RawEdgeVersionRow = {
  snapshot_id: string;
  edge_id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: string;
  confidence: number;
  discovered_via: string;
  metadata: string;
  created_at: string;
  last_seen_at: string;
};

// =============================================================================
// Row → Domain Mappers
// =============================================================================

function rowToSnapshot(row: RawSnapshotRow): GraphSnapshot {
  return {
    id: row.id,
    createdAt: row.created_at,
    trigger: row.trigger_type as GraphSnapshot["trigger"],
    provider: row.provider as CloudProvider | null,
    label: row.label,
    nodeCount: row.node_count,
    edgeCount: row.edge_count,
    totalCostMonthly: row.total_cost_monthly,
  };
}

function rowToNode(row: RawNodeVersionRow): GraphNode {
  return {
    id: row.node_id,
    provider: row.provider as GraphNode["provider"],
    resourceType: row.resource_type as GraphNode["resourceType"],
    nativeId: row.native_id,
    name: row.name,
    region: row.region,
    account: row.account,
    status: row.status as GraphNode["status"],
    tags: jsonParse(row.tags, {}),
    metadata: jsonParse(row.metadata, {}),
    costMonthly: row.cost_monthly,
    owner: row.owner,
    discoveredAt: row.discovered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  };
}

function rowToEdge(row: RawEdgeVersionRow): GraphEdge {
  return {
    id: row.edge_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    relationshipType: row.relationship_type as GraphEdge["relationshipType"],
    confidence: row.confidence,
    discoveredVia: row.discovered_via as GraphEdge["discoveredVia"],
    metadata: jsonParse(row.metadata, {}),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

// =============================================================================
// SQLite Temporal Storage
// =============================================================================

/**
 * Persistent implementation of TemporalGraphStorage using SQLite.
 *
 * Wraps an existing GraphStorage and stores snapshots in the same SQLite
 * database (or a separate db file). Snapshot creation captures the full
 * graph state into temporal_node_versions / temporal_edge_versions tables.
 *
 * @example
 * ```ts
 * import Database from "better-sqlite3";
 * const db = new Database("graph.db");
 * const temporal = new SQLiteTemporalStorage(storage, db);
 * await temporal.initializeTemporal();
 * const snap = await temporal.createSnapshot("manual", "baseline");
 * ```
 */
export class SQLiteTemporalStorage implements TemporalGraphStorage {
  private db: Database.Database;
  private storage: GraphStorage;

  constructor(storage: GraphStorage, db: Database.Database) {
    this.storage = storage;
    this.db = db;
  }

  // ---------- Lifecycle ----------

  async initializeTemporal(): Promise<void> {
    this.db.pragma("foreign_keys = ON");
    this.db.exec(TEMPORAL_SCHEMA_DDL);

    const versionRow = this.db
      .prepare("SELECT version FROM temporal_schema_version LIMIT 1")
      .get() as { version: number } | undefined;

    if (!versionRow) {
      this.db
        .prepare("INSERT INTO temporal_schema_version (version) VALUES (?)")
        .run(TEMPORAL_SCHEMA_VERSION);
    }
    // Future migrations would go here:
    // if (versionRow && versionRow.version < 2) { ... }
  }

  // ---------- Snapshot CRUD ----------

  async createSnapshot(
    trigger: GraphSnapshot["trigger"],
    label?: string | null,
    provider?: CloudProvider | null,
  ): Promise<GraphSnapshot> {
    const id = generateId();
    const createdAt = nowISO();

    // Capture current graph state
    const nodes = await this.storage.queryNodes({});

    // Gather all edges (deduplicated)
    const edgesMap = new Map<string, GraphEdge>();
    for (const node of nodes) {
      const edges = await this.storage.getEdgesForNode(node.id, "both");
      for (const e of edges) {
        if (!edgesMap.has(e.id)) {
          edgesMap.set(e.id, e);
        }
      }
    }

    const totalCost = nodes.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0);

    // Get next sequence number
    const maxSeqRow = this.db
      .prepare("SELECT COALESCE(MAX(seq), -1) as max_seq FROM temporal_snapshots")
      .get() as { max_seq: number };
    const seq = maxSeqRow.max_seq + 1;

    // Insert everything in a single transaction
    const insertAll = this.db.transaction(() => {
      // Insert snapshot metadata
      this.db
        .prepare(
          `INSERT INTO temporal_snapshots (id, created_at, trigger_type, provider, label, node_count, edge_count, total_cost_monthly, seq)
           VALUES (@id, @createdAt, @trigger, @provider, @label, @nodeCount, @edgeCount, @totalCostMonthly, @seq)`,
        )
        .run({
          id,
          createdAt,
          trigger,
          provider: provider ?? null,
          label: label ?? null,
          nodeCount: nodes.length,
          edgeCount: edgesMap.size,
          totalCostMonthly: totalCost,
          seq,
        });

      // Insert node versions
      const nodeStmt = this.db.prepare(
        `INSERT INTO temporal_node_versions
           (snapshot_id, node_id, provider, resource_type, native_id, name, region, account, status, tags, metadata, cost_monthly, owner, discovered_at, created_at, updated_at, last_seen_at)
         VALUES
           (@snapshotId, @nodeId, @provider, @resourceType, @nativeId, @name, @region, @account, @status, @tags, @metadata, @costMonthly, @owner, @discoveredAt, @createdAt, @updatedAt, @lastSeenAt)`,
      );

      for (const node of nodes) {
        nodeStmt.run({
          snapshotId: id,
          nodeId: node.id,
          provider: node.provider,
          resourceType: node.resourceType,
          nativeId: node.nativeId,
          name: node.name,
          region: node.region,
          account: node.account,
          status: node.status,
          tags: JSON.stringify(node.tags),
          metadata: JSON.stringify(node.metadata),
          costMonthly: node.costMonthly,
          owner: node.owner,
          discoveredAt: node.discoveredAt,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
          lastSeenAt: node.lastSeenAt,
        });
      }

      // Insert edge versions
      const edgeStmt = this.db.prepare(
        `INSERT INTO temporal_edge_versions
           (snapshot_id, edge_id, source_node_id, target_node_id, relationship_type, confidence, discovered_via, metadata, created_at, last_seen_at)
         VALUES
           (@snapshotId, @edgeId, @sourceNodeId, @targetNodeId, @relationshipType, @confidence, @discoveredVia, @metadata, @createdAt, @lastSeenAt)`,
      );

      for (const edge of edgesMap.values()) {
        edgeStmt.run({
          snapshotId: id,
          edgeId: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          relationshipType: edge.relationshipType,
          confidence: edge.confidence,
          discoveredVia: edge.discoveredVia,
          metadata: JSON.stringify(edge.metadata),
          createdAt: edge.createdAt,
          lastSeenAt: edge.lastSeenAt,
        });
      }
    });

    insertAll();

    return {
      id,
      createdAt,
      trigger,
      provider: provider ?? null,
      label: label ?? null,
      nodeCount: nodes.length,
      edgeCount: edgesMap.size,
      totalCostMonthly: totalCost,
    };
  }

  async getSnapshot(id: string): Promise<GraphSnapshot | null> {
    const row = this.db
      .prepare("SELECT * FROM temporal_snapshots WHERE id = ?")
      .get(id) as RawSnapshotRow | undefined;
    return row ? rowToSnapshot(row) : null;
  }

  async listSnapshots(filter?: {
    since?: string;
    until?: string;
    trigger?: GraphSnapshot["trigger"];
    provider?: CloudProvider | null;
    limit?: number;
  }): Promise<GraphSnapshot[]> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter?.since) {
      clauses.push("created_at >= @since");
      params.since = filter.since;
    }
    if (filter?.until) {
      clauses.push("created_at <= @until");
      params.until = filter.until;
    }
    if (filter?.trigger) {
      clauses.push("trigger_type = @trigger");
      params.trigger = filter.trigger;
    }
    if (filter?.provider !== undefined) {
      if (filter.provider === null) {
        clauses.push("provider IS NULL");
      } else {
        clauses.push("provider = @provider");
        params.provider = filter.provider;
      }
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    // Newest first; use seq as tiebreaker for same-timestamp snapshots
    let sql = `SELECT * FROM temporal_snapshots ${where} ORDER BY created_at DESC, seq DESC`;

    if (filter?.limit) {
      // Parameterize LIMIT to prevent injection
      const limitVal = Math.max(1, Math.floor(Number(filter.limit)));
      if (!Number.isFinite(limitVal)) {
        throw new Error(`Invalid limit value: ${filter.limit}`);
      }
      sql += ` LIMIT @_limit`;
      params._limit = limitVal;
    }

    const rows = this.db.prepare(sql).all(params) as RawSnapshotRow[];
    return rows.map(rowToSnapshot);
  }

  async deleteSnapshot(id: string): Promise<void> {
    // CASCADE handles node_versions and edge_versions
    this.db.prepare("DELETE FROM temporal_snapshots WHERE id = ?").run(id);
  }

  // ---------- Point-in-Time Queries ----------

  async getNodesAtSnapshot(snapshotId: string, filter?: NodeFilter): Promise<GraphNode[]> {
    const clauses: string[] = ["snapshot_id = @snapshotId"];
    const params: Record<string, unknown> = { snapshotId };

    if (filter) {
      if (filter.provider) {
        clauses.push("provider = @provider");
        params.provider = filter.provider;
      }
      if (filter.resourceType) {
        if (Array.isArray(filter.resourceType)) {
          const placeholders = filter.resourceType.map((_, i) => `@rt${i}`);
          clauses.push(`resource_type IN (${placeholders.join(", ")})`);
          filter.resourceType.forEach((rt, i) => {
            params[`rt${i}`] = rt;
          });
        } else {
          clauses.push("resource_type = @resourceType");
          params.resourceType = filter.resourceType;
        }
      }
      if (filter.status) {
        if (Array.isArray(filter.status)) {
          const placeholders = filter.status.map((_, i) => `@st${i}`);
          clauses.push(`status IN (${placeholders.join(", ")})`);
          filter.status.forEach((s, i) => {
            params[`st${i}`] = s;
          });
        } else {
          clauses.push("status = @status");
          params.status = filter.status;
        }
      }
      if (filter.region) {
        clauses.push("region = @region");
        params.region = filter.region;
      }
      if (filter.account) {
        clauses.push("account = @account");
        params.account = filter.account;
      }
      if (filter.namePattern) {
        clauses.push("name LIKE @namePattern");
        params.namePattern = `%${filter.namePattern}%`;
      }
      if (filter.owner) {
        clauses.push("owner = @owner");
        params.owner = filter.owner;
      }
      if (filter.minCost != null) {
        clauses.push("cost_monthly >= @minCost");
        params.minCost = filter.minCost;
      }
      if (filter.maxCost != null) {
        clauses.push("cost_monthly <= @maxCost");
        params.maxCost = filter.maxCost;
      }
      if (filter.tags) {
        for (const [key, value] of Object.entries(filter.tags)) {
          // Validate tag key to prevent SQL injection in json_extract path
          if (!/^[a-zA-Z0-9_\-:.]+$/.test(key)) {
            throw new Error(`Invalid tag key: ${key}`);
          }
          const paramKey = `tag_${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
          clauses.push(`json_extract(tags, '$.${key}') = @${paramKey}`);
          params[paramKey] = value;
        }
      }
    }

    const where = clauses.join(" AND ");
    const rows = this.db
      .prepare(`SELECT * FROM temporal_node_versions WHERE ${where} ORDER BY name`)
      .all(params) as RawNodeVersionRow[];
    return rows.map(rowToNode);
  }

  async getEdgesAtSnapshot(snapshotId: string): Promise<GraphEdge[]> {
    const rows = this.db
      .prepare("SELECT * FROM temporal_edge_versions WHERE snapshot_id = ?")
      .all(snapshotId) as RawEdgeVersionRow[];
    return rows.map(rowToEdge);
  }

  // ---------- History Queries ----------

  async getNodeHistory(nodeId: string, limit = 50): Promise<NodeVersion[]> {
    const rows = this.db
      .prepare(
        `SELECT nv.*, ts.created_at AS snapshot_created_at
         FROM temporal_node_versions nv
         JOIN temporal_snapshots ts ON nv.snapshot_id = ts.id
         WHERE nv.node_id = ?
         ORDER BY ts.created_at DESC, ts.seq DESC
         LIMIT ?`,
      )
      .all(nodeId, limit) as Array<RawNodeVersionRow & { snapshot_created_at: string }>;

    return rows.map((row) => ({
      nodeId: row.node_id,
      snapshotId: row.snapshot_id,
      snapshotCreatedAt: row.snapshot_created_at,
      node: rowToNode(row),
    }));
  }

  async getEdgeHistory(edgeId: string, limit = 50): Promise<EdgeVersion[]> {
    const rows = this.db
      .prepare(
        `SELECT ev.*, ts.created_at AS snapshot_created_at
         FROM temporal_edge_versions ev
         JOIN temporal_snapshots ts ON ev.snapshot_id = ts.id
         WHERE ev.edge_id = ?
         ORDER BY ts.created_at DESC, ts.seq DESC
         LIMIT ?`,
      )
      .all(edgeId, limit) as Array<RawEdgeVersionRow & { snapshot_created_at: string }>;

    return rows.map((row) => ({
      edgeId: row.edge_id,
      snapshotId: row.snapshot_id,
      snapshotCreatedAt: row.snapshot_created_at,
      edge: rowToEdge(row),
    }));
  }

  // ---------- Diffing ----------

  async diffSnapshots(fromId: string, toId: string): Promise<SnapshotDiff> {
    const fromSnap = await this.getSnapshot(fromId);
    const toSnap = await this.getSnapshot(toId);
    if (!fromSnap) throw new Error(`Snapshot not found: ${fromId}`);
    if (!toSnap) throw new Error(`Snapshot not found: ${toId}`);

    // Load all node versions for both snapshots
    const fromNodeRows = this.db
      .prepare("SELECT * FROM temporal_node_versions WHERE snapshot_id = ?")
      .all(fromId) as RawNodeVersionRow[];
    const toNodeRows = this.db
      .prepare("SELECT * FROM temporal_node_versions WHERE snapshot_id = ?")
      .all(toId) as RawNodeVersionRow[];

    const fromNodes = new Map<string, GraphNode>();
    for (const row of fromNodeRows) {
      fromNodes.set(row.node_id, rowToNode(row));
    }
    const toNodes = new Map<string, GraphNode>();
    for (const row of toNodeRows) {
      toNodes.set(row.node_id, rowToNode(row));
    }

    // Load all edge versions for both snapshots
    const fromEdgeRows = this.db
      .prepare("SELECT * FROM temporal_edge_versions WHERE snapshot_id = ?")
      .all(fromId) as RawEdgeVersionRow[];
    const toEdgeRows = this.db
      .prepare("SELECT * FROM temporal_edge_versions WHERE snapshot_id = ?")
      .all(toId) as RawEdgeVersionRow[];

    const fromEdges = new Map<string, GraphEdge>();
    for (const row of fromEdgeRows) {
      fromEdges.set(row.edge_id, rowToEdge(row));
    }
    const toEdges = new Map<string, GraphEdge>();
    for (const row of toEdgeRows) {
      toEdges.set(row.edge_id, rowToEdge(row));
    }

    return computeDiff(fromSnap, toSnap, fromNodes, toNodes, fromEdges, toEdges);
  }

  // ---------- Retention ----------

  async pruneSnapshots(retention: SnapshotRetentionConfig): Promise<number> {
    let pruned = 0;

    // Get sorted snapshots (newest first)
    const sorted = this.db
      .prepare("SELECT * FROM temporal_snapshots ORDER BY created_at DESC, seq DESC")
      .all() as RawSnapshotRow[];

    const cutoffDate = retention.maxAgeMs
      ? new Date(Date.now() - retention.maxAgeMs).toISOString()
      : null;

    const deleteTx = this.db.transaction((ids: string[]) => {
      const stmt = this.db.prepare("DELETE FROM temporal_snapshots WHERE id = ?");
      for (const id of ids) {
        stmt.run(id);
      }
    });

    const toDelete: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const snap = sorted[i]!;
      const overLimit = retention.maxSnapshots != null && i >= retention.maxSnapshots;
      const tooOld = cutoffDate != null && snap.created_at < cutoffDate;

      if (overLimit || tooOld) {
        toDelete.push(snap.id);
        pruned++;
      }
    }

    if (toDelete.length > 0) {
      deleteTx(toDelete);
    }

    return pruned;
  }

  // ---------- Timestamp Lookup ----------

  async getSnapshotAt(timestamp: string): Promise<GraphSnapshot | null> {
    // Find the closest snapshot at or before the given timestamp
    const row = this.db
      .prepare(
        `SELECT * FROM temporal_snapshots
         WHERE created_at <= ?
         ORDER BY created_at DESC, seq DESC
         LIMIT 1`,
      )
      .get(timestamp) as RawSnapshotRow | undefined;

    if (row) return rowToSnapshot(row);

    // Fallback: return the oldest snapshot if all are after the timestamp
    const oldest = this.db
      .prepare(
        "SELECT * FROM temporal_snapshots ORDER BY created_at ASC, seq ASC LIMIT 1",
      )
      .get() as RawSnapshotRow | undefined;

    return oldest ? rowToSnapshot(oldest) : null;
  }
}

// =============================================================================
// Diff Logic (shared with InMemoryTemporalStorage)
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
