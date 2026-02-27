/**
 * Infrastructure Knowledge Graph — SQLite Graph Storage
 *
 * Production-grade persistent storage using better-sqlite3 (synchronous,
 * embedded, zero-config). Supports graph traversal via recursive CTEs,
 * full-text node search, and append-only change tracking.
 *
 * Schema:
 *   nodes          — resource nodes with universal schema
 *   edges          — directed relationships between nodes
 *   changes        — append-only changelog (never deleted)
 *   groups         — logical resource groupings
 *   group_members  — junction table
 *   sync_records   — history of sync operations
 */

import Database from "better-sqlite3";
import type {
  GraphStorage,
  GraphNode,
  GraphNodeInput,
  GraphEdge,
  GraphEdgeInput,
  GraphChange,
  GraphGroup,
  GraphGroupType,
  GraphStats,
  NodeFilter,
  EdgeFilter,
  ChangeFilter,
  PaginationOptions,
  PaginatedResult,
  SyncRecord,
  TraversalDirection,
  GraphRelationshipType,
  CloudProvider,
} from "../types.js";

// =============================================================================
// Schema DDL
// =============================================================================

const SCHEMA_VERSION = 2;

const SCHEMA_DDL = `
-- Version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

-- Resource nodes
CREATE TABLE IF NOT EXISTS nodes (
  id               TEXT PRIMARY KEY,
  provider         TEXT NOT NULL,
  resource_type    TEXT NOT NULL,
  native_id        TEXT NOT NULL,
  name             TEXT NOT NULL,
  region           TEXT NOT NULL DEFAULT '',
  account          TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'unknown',
  tags             TEXT NOT NULL DEFAULT '{}',
  metadata         TEXT NOT NULL DEFAULT '{}',
  cost_monthly     REAL,
  owner            TEXT,
  discovered_at    TEXT NOT NULL,
  created_at       TEXT,
  updated_at       TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_provider ON nodes(provider);
CREATE INDEX IF NOT EXISTS idx_nodes_resource_type ON nodes(resource_type);
CREATE INDEX IF NOT EXISTS idx_nodes_native_id ON nodes(provider, native_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_last_seen ON nodes(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_nodes_account ON nodes(account);
CREATE INDEX IF NOT EXISTS idx_nodes_region ON nodes(region);
CREATE INDEX IF NOT EXISTS idx_nodes_owner ON nodes(owner);

-- Directed edges (relationships)
CREATE TABLE IF NOT EXISTS edges (
  id                TEXT PRIMARY KEY,
  source_node_id    TEXT NOT NULL,
  target_node_id    TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  confidence        REAL NOT NULL DEFAULT 1.0,
  discovered_via    TEXT NOT NULL DEFAULT 'config-scan',
  metadata          TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  FOREIGN KEY (source_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_node_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_node_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(relationship_type);
CREATE INDEX IF NOT EXISTS idx_edges_last_seen ON edges(last_seen_at);

-- Append-only changelog
CREATE TABLE IF NOT EXISTS changes (
  id              TEXT PRIMARY KEY,
  target_id       TEXT NOT NULL,
  change_type     TEXT NOT NULL,
  field           TEXT,
  previous_value  TEXT,
  new_value       TEXT,
  detected_at     TEXT NOT NULL,
  detected_via    TEXT NOT NULL DEFAULT 'sync',
  correlation_id  TEXT,
  initiator       TEXT,
  initiator_type  TEXT,
  metadata        TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_changes_target ON changes(target_id);
CREATE INDEX IF NOT EXISTS idx_changes_type ON changes(change_type);
CREATE INDEX IF NOT EXISTS idx_changes_detected_at ON changes(detected_at);
CREATE INDEX IF NOT EXISTS idx_changes_correlation ON changes(correlation_id);
CREATE INDEX IF NOT EXISTS idx_changes_initiator ON changes(initiator);
CREATE INDEX IF NOT EXISTS idx_changes_initiator_type ON changes(initiator_type);

-- Logical groupings
CREATE TABLE IF NOT EXISTS groups_ (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  group_type   TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  owner        TEXT,
  tags         TEXT NOT NULL DEFAULT '{}',
  cost_monthly REAL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_groups_type ON groups_(group_type);

-- Group membership junction
CREATE TABLE IF NOT EXISTS group_members (
  group_id  TEXT NOT NULL,
  node_id   TEXT NOT NULL,
  added_at  TEXT NOT NULL,
  PRIMARY KEY (group_id, node_id),
  FOREIGN KEY (group_id) REFERENCES groups_(id) ON DELETE CASCADE,
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- Sync operation history
CREATE TABLE IF NOT EXISTS sync_records (
  id                 TEXT PRIMARY KEY,
  provider           TEXT NOT NULL,
  status             TEXT NOT NULL,
  started_at         TEXT NOT NULL,
  completed_at       TEXT,
  nodes_discovered   INTEGER NOT NULL DEFAULT 0,
  nodes_created      INTEGER NOT NULL DEFAULT 0,
  nodes_updated      INTEGER NOT NULL DEFAULT 0,
  nodes_disappeared  INTEGER NOT NULL DEFAULT 0,
  edges_discovered   INTEGER NOT NULL DEFAULT 0,
  edges_created      INTEGER NOT NULL DEFAULT 0,
  edges_removed      INTEGER NOT NULL DEFAULT 0,
  changes_recorded   INTEGER NOT NULL DEFAULT 0,
  errors             TEXT NOT NULL DEFAULT '[]',
  duration_ms        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sync_provider ON sync_records(provider);
CREATE INDEX IF NOT EXISTS idx_sync_started ON sync_records(started_at);
`;

// =============================================================================
// Helpers
// =============================================================================

function now(): string {
  return new Date().toISOString();
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
// SQLite Graph Storage
// =============================================================================

export class SQLiteGraphStorage implements GraphStorage {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  // ---------- Lifecycle ----------

  async initialize(): Promise<void> {
    // WAL mode for concurrent reads + write performance
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(SCHEMA_DDL);

    // Check / set schema version
    const versionRow = this.db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
      | { version: number }
      | undefined;
    if (!versionRow) {
      this.db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
    } else if (versionRow.version < SCHEMA_VERSION) {
      // Migration: v1 → v2: add initiator columns to changes
      if (versionRow.version < 2) {
        this.db.exec(`
          ALTER TABLE changes ADD COLUMN initiator TEXT;
          ALTER TABLE changes ADD COLUMN initiator_type TEXT;
          CREATE INDEX IF NOT EXISTS idx_changes_initiator ON changes(initiator);
          CREATE INDEX IF NOT EXISTS idx_changes_initiator_type ON changes(initiator_type);
        `);
      }
      this.db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // ---------- Nodes ----------

  async upsertNode(node: GraphNodeInput): Promise<void> {
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO nodes (id, provider, resource_type, native_id, name, region, account, status, tags, metadata, cost_monthly, owner, discovered_at, created_at, updated_at, last_seen_at)
         VALUES (@id, @provider, @resourceType, @nativeId, @name, @region, @account, @status, @tags, @metadata, @costMonthly, @owner, @discoveredAt, @createdAt, @updatedAt, @lastSeenAt)
         ON CONFLICT(id) DO UPDATE SET
           name = @name,
           status = @status,
           tags = @tags,
           metadata = @metadata,
           cost_monthly = @costMonthly,
           owner = @owner,
           updated_at = @updatedAt,
           last_seen_at = @lastSeenAt`,
      )
      .run({
        id: node.id,
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
        discoveredAt: node.discoveredAt ?? ts,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt ?? ts,
        lastSeenAt: node.lastSeenAt ?? ts,
      });
  }

  async upsertNodes(nodes: GraphNodeInput[]): Promise<void> {
    const upsert = this.db.transaction((batch: GraphNodeInput[]) => {
      for (const node of batch) {
        // Inline for transaction performance — avoid async overhead
        const ts = now();
        this.db
          .prepare(
            `INSERT INTO nodes (id, provider, resource_type, native_id, name, region, account, status, tags, metadata, cost_monthly, owner, discovered_at, created_at, updated_at, last_seen_at)
             VALUES (@id, @provider, @resourceType, @nativeId, @name, @region, @account, @status, @tags, @metadata, @costMonthly, @owner, @discoveredAt, @createdAt, @updatedAt, @lastSeenAt)
             ON CONFLICT(id) DO UPDATE SET
               name = @name,
               status = @status,
               tags = @tags,
               metadata = @metadata,
               cost_monthly = @costMonthly,
               owner = @owner,
               updated_at = @updatedAt,
               last_seen_at = @lastSeenAt`,
          )
          .run({
            id: node.id,
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
            discoveredAt: node.discoveredAt ?? ts,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt ?? ts,
            lastSeenAt: node.lastSeenAt ?? ts,
          });
      }
    });
    upsert(nodes);
  }

  async getNode(id: string): Promise<GraphNode | null> {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as RawNodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  async getNodeByNativeId(provider: CloudProvider, nativeId: string): Promise<GraphNode | null> {
    const row = this.db
      .prepare("SELECT * FROM nodes WHERE provider = ? AND native_id = ?")
      .get(provider, nativeId) as RawNodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  async queryNodes(filter: NodeFilter): Promise<GraphNode[]> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

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
    if (filter.region) {
      clauses.push("region = @region");
      params.region = filter.region;
    }
    if (filter.account) {
      clauses.push("account = @account");
      params.account = filter.account;
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
      // JSON-based tag filtering: each tag key=value must match
      for (const [key, value] of Object.entries(filter.tags)) {
        // Validate tag key to prevent SQL injection via json_extract path
        if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
          throw new Error(`Invalid tag key: ${key}`);
        }
        const paramKey = `tag_${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
        clauses.push(`json_extract(tags, '$.${key}') = @${paramKey}`);
        params[paramKey] = value;
      }
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM nodes ${where} ORDER BY name`).all(params) as RawNodeRow[];
    return rows.map(rowToNode);
  }

  async queryNodesPaginated(
    filter: NodeFilter,
    pagination: PaginationOptions = {},
  ): Promise<PaginatedResult<GraphNode>> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    // Reuse the same filter-building logic
    if (filter.provider) { clauses.push("provider = @provider"); params.provider = filter.provider; }
    if (filter.resourceType) {
      if (Array.isArray(filter.resourceType)) {
        const ph = filter.resourceType.map((_, i) => `@rt${i}`);
        clauses.push(`resource_type IN (${ph.join(", ")})`);
        filter.resourceType.forEach((rt, i) => { params[`rt${i}`] = rt; });
      } else { clauses.push("resource_type = @resourceType"); params.resourceType = filter.resourceType; }
    }
    if (filter.region) { clauses.push("region = @region"); params.region = filter.region; }
    if (filter.account) { clauses.push("account = @account"); params.account = filter.account; }
    if (filter.status) {
      if (Array.isArray(filter.status)) {
        const ph = filter.status.map((_, i) => `@st${i}`);
        clauses.push(`status IN (${ph.join(", ")})`);
        filter.status.forEach((s, i) => { params[`st${i}`] = s; });
      } else { clauses.push("status = @status"); params.status = filter.status; }
    }
    if (filter.namePattern) { clauses.push("name LIKE @namePattern"); params.namePattern = `%${filter.namePattern}%`; }
    if (filter.owner) { clauses.push("owner = @owner"); params.owner = filter.owner; }
    if (filter.minCost != null) { clauses.push("cost_monthly >= @minCost"); params.minCost = filter.minCost; }
    if (filter.maxCost != null) { clauses.push("cost_monthly <= @maxCost"); params.maxCost = filter.maxCost; }
    if (filter.tags) {
      for (const [key, value] of Object.entries(filter.tags)) {
        // Validate tag key to prevent SQL injection via json_extract path
        if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
          throw new Error(`Invalid tag key: ${key}`);
        }
        const paramKey = `tag_${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
        clauses.push(`json_extract(tags, '$.${key}') = @${paramKey}`);
        params[paramKey] = value;
      }
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(pagination.limit ?? 100, 1000));
    const offset = pagination.cursor ? decodeCursorSqlite(pagination.cursor) : 0;

    const countRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM nodes ${where}`).get(params) as { cnt: number };
    const totalCount = countRow.cnt;

    params._limit = limit;
    params._offset = offset;
    const rows = this.db
      .prepare(`SELECT * FROM nodes ${where} ORDER BY name LIMIT @_limit OFFSET @_offset`)
      .all(params) as RawNodeRow[];

    const hasMore = offset + limit < totalCount;
    return {
      items: rows.map(rowToNode),
      totalCount,
      nextCursor: hasMore ? encodeCursorSqlite(offset + limit) : null,
      hasMore,
    };
  }

  async deleteNode(id: string): Promise<void> {
    this.db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
  }

  async markNodesDisappeared(olderThan: string, provider?: CloudProvider): Promise<string[]> {
    const clause = provider
      ? "WHERE last_seen_at < @olderThan AND provider = @provider AND status != 'disappeared'"
      : "WHERE last_seen_at < @olderThan AND status != 'disappeared'";

    const rows = this.db
      .prepare(`SELECT id FROM nodes ${clause}`)
      .all({ olderThan, provider }) as Array<{ id: string }>;

    if (rows.length > 0) {
      this.db
        .prepare(`UPDATE nodes SET status = 'disappeared', updated_at = @now ${clause.replace("WHERE", "WHERE")}`)
        .run({ olderThan, provider, now: now() });
    }

    return rows.map((r) => r.id);
  }

  // ---------- Edges ----------

  async upsertEdge(edge: GraphEdgeInput): Promise<void> {
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO edges (id, source_node_id, target_node_id, relationship_type, confidence, discovered_via, metadata, created_at, last_seen_at)
         VALUES (@id, @sourceNodeId, @targetNodeId, @relationshipType, @confidence, @discoveredVia, @metadata, @createdAt, @lastSeenAt)
         ON CONFLICT(id) DO UPDATE SET
           confidence = @confidence,
           metadata = @metadata,
           last_seen_at = @lastSeenAt`,
      )
      .run({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        relationshipType: edge.relationshipType,
        confidence: edge.confidence,
        discoveredVia: edge.discoveredVia,
        metadata: JSON.stringify(edge.metadata),
        createdAt: edge.createdAt ?? ts,
        lastSeenAt: edge.lastSeenAt ?? ts,
      });
  }

  async upsertEdges(edges: GraphEdgeInput[]): Promise<void> {
    const upsert = this.db.transaction((batch: GraphEdgeInput[]) => {
      const ts = now();
      const stmt = this.db.prepare(
        `INSERT INTO edges (id, source_node_id, target_node_id, relationship_type, confidence, discovered_via, metadata, created_at, last_seen_at)
         VALUES (@id, @sourceNodeId, @targetNodeId, @relationshipType, @confidence, @discoveredVia, @metadata, @createdAt, @lastSeenAt)
         ON CONFLICT(id) DO UPDATE SET
           confidence = @confidence,
           metadata = @metadata,
           last_seen_at = @lastSeenAt`,
      );
      for (const edge of batch) {
        stmt.run({
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          relationshipType: edge.relationshipType,
          confidence: edge.confidence,
          discoveredVia: edge.discoveredVia,
          metadata: JSON.stringify(edge.metadata),
          createdAt: edge.createdAt ?? ts,
          lastSeenAt: edge.lastSeenAt ?? ts,
        });
      }
    });
    upsert(edges);
  }

  async getEdge(id: string): Promise<GraphEdge | null> {
    const row = this.db.prepare("SELECT * FROM edges WHERE id = ?").get(id) as RawEdgeRow | undefined;
    return row ? rowToEdge(row) : null;
  }

  async getEdgesForNode(
    nodeId: string,
    direction: TraversalDirection,
    relationshipType?: GraphRelationshipType,
  ): Promise<GraphEdge[]> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (direction === "downstream" || direction === "both") {
      clauses.push("source_node_id = @nodeId");
    }
    if (direction === "upstream" || direction === "both") {
      clauses.push("target_node_id = @nodeId");
    }
    params.nodeId = nodeId;

    const dirClause = clauses.length === 2 ? `(${clauses.join(" OR ")})` : clauses[0];
    const typeClause = relationshipType ? " AND relationship_type = @relType" : "";
    if (relationshipType) params.relType = relationshipType;

    const rows = this.db
      .prepare(`SELECT * FROM edges WHERE ${dirClause}${typeClause}`)
      .all(params) as RawEdgeRow[];
    return rows.map(rowToEdge);
  }

  async queryEdges(filter: EdgeFilter): Promise<GraphEdge[]> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.sourceNodeId) {
      clauses.push("source_node_id = @sourceNodeId");
      params.sourceNodeId = filter.sourceNodeId;
    }
    if (filter.targetNodeId) {
      clauses.push("target_node_id = @targetNodeId");
      params.targetNodeId = filter.targetNodeId;
    }
    if (filter.relationshipType) {
      if (Array.isArray(filter.relationshipType)) {
        const placeholders = filter.relationshipType.map((_, i) => `@rt${i}`);
        clauses.push(`relationship_type IN (${placeholders.join(", ")})`);
        filter.relationshipType.forEach((rt, i) => {
          params[`rt${i}`] = rt;
        });
      } else {
        clauses.push("relationship_type = @relType");
        params.relType = filter.relationshipType;
      }
    }
    if (filter.minConfidence != null) {
      clauses.push("confidence >= @minConfidence");
      params.minConfidence = filter.minConfidence;
    }
    if (filter.discoveredVia) {
      clauses.push("discovered_via = @discoveredVia");
      params.discoveredVia = filter.discoveredVia;
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM edges ${where}`).all(params) as RawEdgeRow[];
    return rows.map(rowToEdge);
  }

  async queryEdgesPaginated(
    filter: EdgeFilter,
    pagination: PaginationOptions = {},
  ): Promise<PaginatedResult<GraphEdge>> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.sourceNodeId) { clauses.push("source_node_id = @sourceNodeId"); params.sourceNodeId = filter.sourceNodeId; }
    if (filter.targetNodeId) { clauses.push("target_node_id = @targetNodeId"); params.targetNodeId = filter.targetNodeId; }
    if (filter.relationshipType) {
      if (Array.isArray(filter.relationshipType)) {
        const ph = filter.relationshipType.map((_, i) => `@rt${i}`);
        clauses.push(`relationship_type IN (${ph.join(", ")})`);
        filter.relationshipType.forEach((rt, i) => { params[`rt${i}`] = rt; });
      } else { clauses.push("relationship_type = @relType"); params.relType = filter.relationshipType; }
    }
    if (filter.minConfidence != null) { clauses.push("confidence >= @minConfidence"); params.minConfidence = filter.minConfidence; }
    if (filter.discoveredVia) { clauses.push("discovered_via = @discoveredVia"); params.discoveredVia = filter.discoveredVia; }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(pagination.limit ?? 100, 1000));
    const offset = pagination.cursor ? decodeCursorSqlite(pagination.cursor) : 0;

    const countRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM edges ${where}`).get(params) as { cnt: number };
    const totalCount = countRow.cnt;

    params._limit = limit;
    params._offset = offset;
    const rows = this.db
      .prepare(`SELECT * FROM edges ${where} ORDER BY id LIMIT @_limit OFFSET @_offset`)
      .all(params) as RawEdgeRow[];

    const hasMore = offset + limit < totalCount;
    return {
      items: rows.map(rowToEdge),
      totalCount,
      nextCursor: hasMore ? encodeCursorSqlite(offset + limit) : null,
      hasMore,
    };
  }

  async deleteEdge(id: string): Promise<void> {
    this.db.prepare("DELETE FROM edges WHERE id = ?").run(id);
  }

  async deleteStaleEdges(olderThan: string): Promise<number> {
    const result = this.db
      .prepare("DELETE FROM edges WHERE last_seen_at < ?")
      .run(olderThan);
    return result.changes;
  }

  // ---------- Changes (append-only) ----------

  async appendChange(change: GraphChange): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO changes (id, target_id, change_type, field, previous_value, new_value, detected_at, detected_via, correlation_id, initiator, initiator_type, metadata)
         VALUES (@id, @targetId, @changeType, @field, @previousValue, @newValue, @detectedAt, @detectedVia, @correlationId, @initiator, @initiatorType, @metadata)`,
      )
      .run({
        id: change.id,
        targetId: change.targetId,
        changeType: change.changeType,
        field: change.field,
        previousValue: change.previousValue,
        newValue: change.newValue,
        detectedAt: change.detectedAt,
        detectedVia: change.detectedVia,
        correlationId: change.correlationId,
        initiator: change.initiator ?? null,
        initiatorType: change.initiatorType ?? null,
        metadata: JSON.stringify(change.metadata),
      });
  }

  async appendChanges(changes: GraphChange[]): Promise<void> {
    const insert = this.db.transaction((batch: GraphChange[]) => {
      const stmt = this.db.prepare(
        `INSERT INTO changes (id, target_id, change_type, field, previous_value, new_value, detected_at, detected_via, correlation_id, initiator, initiator_type, metadata)
         VALUES (@id, @targetId, @changeType, @field, @previousValue, @newValue, @detectedAt, @detectedVia, @correlationId, @initiator, @initiatorType, @metadata)`,
      );
      for (const change of batch) {
        stmt.run({
          id: change.id,
          targetId: change.targetId,
          changeType: change.changeType,
          field: change.field,
          previousValue: change.previousValue,
          newValue: change.newValue,
          detectedAt: change.detectedAt,
          detectedVia: change.detectedVia,
          correlationId: change.correlationId,
          initiator: change.initiator ?? null,
          initiatorType: change.initiatorType ?? null,
          metadata: JSON.stringify(change.metadata),
        });
      }
    });
    insert(changes);
  }

  async getChanges(filter: ChangeFilter): Promise<GraphChange[]> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.targetId) {
      clauses.push("target_id = @targetId");
      params.targetId = filter.targetId;
    }
    if (filter.changeType) {
      if (Array.isArray(filter.changeType)) {
        const placeholders = filter.changeType.map((_, i) => `@ct${i}`);
        clauses.push(`change_type IN (${placeholders.join(", ")})`);
        filter.changeType.forEach((ct, i) => {
          params[`ct${i}`] = ct;
        });
      } else {
        clauses.push("change_type = @changeType");
        params.changeType = filter.changeType;
      }
    }
    if (filter.since) {
      clauses.push("detected_at >= @since");
      params.since = filter.since;
    }
    if (filter.until) {
      clauses.push("detected_at <= @until");
      params.until = filter.until;
    }
    if (filter.detectedVia) {
      clauses.push("detected_via = @detectedVia");
      params.detectedVia = filter.detectedVia;
    }
    if (filter.correlationId) {
      clauses.push("correlation_id = @correlationId");
      params.correlationId = filter.correlationId;
    }
    if (filter.initiator) {
      clauses.push("initiator = @initiator");
      params.initiator = filter.initiator;
    }
    if (filter.initiatorType) {
      clauses.push("initiator_type = @initiatorType");
      params.initiatorType = filter.initiatorType;
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM changes ${where} ORDER BY detected_at DESC`)
      .all(params) as RawChangeRow[];
    return rows.map(rowToChange);
  }

  async getChangesPaginated(
    filter: ChangeFilter,
    pagination: PaginationOptions = {},
  ): Promise<PaginatedResult<GraphChange>> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.targetId) { clauses.push("target_id = @targetId"); params.targetId = filter.targetId; }
    if (filter.changeType) {
      if (Array.isArray(filter.changeType)) {
        const ph = filter.changeType.map((_, i) => `@ct${i}`);
        clauses.push(`change_type IN (${ph.join(", ")})`);
        filter.changeType.forEach((ct, i) => { params[`ct${i}`] = ct; });
      } else { clauses.push("change_type = @changeType"); params.changeType = filter.changeType; }
    }
    if (filter.since) { clauses.push("detected_at >= @since"); params.since = filter.since; }
    if (filter.until) { clauses.push("detected_at <= @until"); params.until = filter.until; }
    if (filter.detectedVia) { clauses.push("detected_via = @detectedVia"); params.detectedVia = filter.detectedVia; }
    if (filter.correlationId) { clauses.push("correlation_id = @correlationId"); params.correlationId = filter.correlationId; }
    if (filter.initiator) { clauses.push("initiator = @initiator"); params.initiator = filter.initiator; }
    if (filter.initiatorType) { clauses.push("initiator_type = @initiatorType"); params.initiatorType = filter.initiatorType; }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(pagination.limit ?? 100, 1000));
    const offset = pagination.cursor ? decodeCursorSqlite(pagination.cursor) : 0;

    const countRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM changes ${where}`).get(params) as { cnt: number };
    const totalCount = countRow.cnt;

    params._limit = limit;
    params._offset = offset;
    const rows = this.db
      .prepare(`SELECT * FROM changes ${where} ORDER BY detected_at DESC LIMIT @_limit OFFSET @_offset`)
      .all(params) as RawChangeRow[];

    const hasMore = offset + limit < totalCount;
    return {
      items: rows.map(rowToChange),
      totalCount,
      nextCursor: hasMore ? encodeCursorSqlite(offset + limit) : null,
      hasMore,
    };
  }

  async getNodeTimeline(nodeId: string, limit = 100): Promise<GraphChange[]> {
    const rows = this.db
      .prepare("SELECT * FROM changes WHERE target_id = ? ORDER BY detected_at DESC LIMIT ?")
      .all(nodeId, limit) as RawChangeRow[];
    return rows.map(rowToChange);
  }

  // ---------- Groups ----------

  async upsertGroup(group: GraphGroup): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO groups_ (id, name, group_type, description, owner, tags, cost_monthly, created_at, updated_at)
         VALUES (@id, @name, @groupType, @description, @owner, @tags, @costMonthly, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           name = @name,
           description = @description,
           owner = @owner,
           tags = @tags,
           cost_monthly = @costMonthly,
           updated_at = @updatedAt`,
      )
      .run({
        id: group.id,
        name: group.name,
        groupType: group.groupType,
        description: group.description,
        owner: group.owner,
        tags: JSON.stringify(group.tags),
        costMonthly: group.costMonthly,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      });
  }

  async getGroup(id: string): Promise<GraphGroup | null> {
    const row = this.db.prepare("SELECT * FROM groups_ WHERE id = ?").get(id) as RawGroupRow | undefined;
    return row ? rowToGroup(row) : null;
  }

  async listGroups(groupType?: GraphGroupType): Promise<GraphGroup[]> {
    const rows = groupType
      ? (this.db.prepare("SELECT * FROM groups_ WHERE group_type = ? ORDER BY name").all(groupType) as RawGroupRow[])
      : (this.db.prepare("SELECT * FROM groups_ ORDER BY name").all() as RawGroupRow[]);
    return rows.map(rowToGroup);
  }

  async deleteGroup(id: string): Promise<void> {
    this.db.prepare("DELETE FROM groups_ WHERE id = ?").run(id);
  }

  async addGroupMember(groupId: string, nodeId: string): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO group_members (group_id, node_id, added_at)
         VALUES (?, ?, ?)`,
      )
      .run(groupId, nodeId, now());
  }

  async removeGroupMember(groupId: string, nodeId: string): Promise<void> {
    this.db
      .prepare("DELETE FROM group_members WHERE group_id = ? AND node_id = ?")
      .run(groupId, nodeId);
  }

  async getGroupMembers(groupId: string): Promise<GraphNode[]> {
    const rows = this.db
      .prepare(
        `SELECT n.* FROM nodes n
         INNER JOIN group_members gm ON n.id = gm.node_id
         WHERE gm.group_id = ?
         ORDER BY n.name`,
      )
      .all(groupId) as RawNodeRow[];
    return rows.map(rowToNode);
  }

  async getNodeGroups(nodeId: string): Promise<GraphGroup[]> {
    const rows = this.db
      .prepare(
        `SELECT g.* FROM groups_ g
         INNER JOIN group_members gm ON g.id = gm.group_id
         WHERE gm.node_id = ?
         ORDER BY g.name`,
      )
      .all(nodeId) as RawGroupRow[];
    return rows.map(rowToGroup);
  }

  // ---------- Sync Records ----------

  async saveSyncRecord(record: SyncRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO sync_records (id, provider, status, started_at, completed_at, nodes_discovered, nodes_created, nodes_updated, nodes_disappeared, edges_discovered, edges_created, edges_removed, changes_recorded, errors, duration_ms)
         VALUES (@id, @provider, @status, @startedAt, @completedAt, @nodesDiscovered, @nodesCreated, @nodesUpdated, @nodesDisappeared, @edgesDiscovered, @edgesCreated, @edgesRemoved, @changesRecorded, @errors, @durationMs)`,
      )
      .run({
        id: record.id,
        provider: record.provider,
        status: record.status,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        nodesDiscovered: record.nodesDiscovered,
        nodesCreated: record.nodesCreated,
        nodesUpdated: record.nodesUpdated,
        nodesDisappeared: record.nodesDisappeared,
        edgesDiscovered: record.edgesDiscovered,
        edgesCreated: record.edgesCreated,
        edgesRemoved: record.edgesRemoved,
        changesRecorded: record.changesRecorded,
        errors: JSON.stringify(record.errors),
        durationMs: record.durationMs,
      });
  }

  async getLastSyncRecord(provider?: CloudProvider): Promise<SyncRecord | null> {
    const row = provider
      ? (this.db
          .prepare("SELECT * FROM sync_records WHERE provider = ? ORDER BY started_at DESC LIMIT 1")
          .get(provider) as RawSyncRow | undefined)
      : (this.db
          .prepare("SELECT * FROM sync_records ORDER BY started_at DESC LIMIT 1")
          .get() as RawSyncRow | undefined);
    return row ? rowToSync(row) : null;
  }

  async listSyncRecords(limit = 50): Promise<SyncRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM sync_records ORDER BY started_at DESC LIMIT ?")
      .all(limit) as RawSyncRow[];
    return rows.map(rowToSync);
  }

  // ---------- Graph Traversal (Recursive CTE) ----------

  async getNeighbors(
    nodeId: string,
    depth: number,
    direction: TraversalDirection,
    edgeTypes?: GraphRelationshipType[],
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const maxDepth = Math.min(depth, 10); // Safety cap

    // Build the edge direction clause for the recursive CTE
    let joinClause: string;
    if (direction === "downstream") {
      joinClause = "e.source_node_id = r.node_id";
    } else if (direction === "upstream") {
      joinClause = "e.target_node_id = r.node_id";
    } else {
      joinClause = "(e.source_node_id = r.node_id OR e.target_node_id = r.node_id)";
    }

    // Next node extraction based on direction
    let nextNodeExpr: string;
    if (direction === "downstream") {
      nextNodeExpr = "e.target_node_id";
    } else if (direction === "upstream") {
      nextNodeExpr = "e.source_node_id";
    } else {
      nextNodeExpr = "CASE WHEN e.source_node_id = r.node_id THEN e.target_node_id ELSE e.source_node_id END";
    }

    const edgeTypeFilter = edgeTypes && edgeTypes.length > 0
      ? `AND e.relationship_type IN (${edgeTypes.map(() => `?`).join(", ")})`
      : "";

    const params: unknown[] = [nodeId];
    if (edgeTypes) params.push(...edgeTypes);

    const sql = `
      WITH RECURSIVE reachable(node_id, depth, path) AS (
        SELECT ?, 0, ?
        UNION
        SELECT
          ${nextNodeExpr},
          r.depth + 1,
          r.path || ',' || ${nextNodeExpr}
        FROM reachable r
        JOIN edges e ON ${joinClause} ${edgeTypeFilter}
        WHERE r.depth < ${maxDepth}
          AND INSTR(',' || r.path || ',', ',' || ${nextNodeExpr} || ',') = 0
      )
      SELECT DISTINCT node_id, depth FROM reachable
    `;

    // For path tracking, initial path = the starting nodeId
    params.splice(1, 0, nodeId);

    const reachableRows = this.db.prepare(sql).all(...params) as Array<{ node_id: string; depth: number }>;

    // Fetch all reached nodes
    const nodeIds = reachableRows.map((r) => r.node_id);
    if (nodeIds.length === 0) return { nodes: [], edges: [] };

    const placeholders = nodeIds.map(() => "?").join(", ");
    const nodeRows = this.db
      .prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`)
      .all(...nodeIds) as RawNodeRow[];

    // Fetch edges between reached nodes
    const edgeSql = `
      SELECT * FROM edges
      WHERE source_node_id IN (${placeholders})
        AND target_node_id IN (${placeholders})
    `;
    const edgeRows = this.db
      .prepare(edgeSql)
      .all(...nodeIds, ...nodeIds) as RawEdgeRow[];

    return {
      nodes: nodeRows.map(rowToNode),
      edges: edgeRows.map(rowToEdge),
    };
  }

  // ---------- Stats ----------

  async getStats(): Promise<GraphStats> {
    const totalNodes = (this.db.prepare("SELECT COUNT(*) as c FROM nodes").get() as { c: number }).c;
    const totalEdges = (this.db.prepare("SELECT COUNT(*) as c FROM edges").get() as { c: number }).c;
    const totalChanges = (this.db.prepare("SELECT COUNT(*) as c FROM changes").get() as { c: number }).c;
    const totalGroups = (this.db.prepare("SELECT COUNT(*) as c FROM groups_").get() as { c: number }).c;

    const byProvider = this.db
      .prepare("SELECT provider, COUNT(*) as c FROM nodes GROUP BY provider")
      .all() as Array<{ provider: string; c: number }>;
    const byResourceType = this.db
      .prepare("SELECT resource_type, COUNT(*) as c FROM nodes GROUP BY resource_type")
      .all() as Array<{ resource_type: string; c: number }>;
    const byRelType = this.db
      .prepare("SELECT relationship_type, COUNT(*) as c FROM edges GROUP BY relationship_type")
      .all() as Array<{ relationship_type: string; c: number }>;

    const costRow = this.db
      .prepare("SELECT COALESCE(SUM(cost_monthly), 0) as total FROM nodes WHERE cost_monthly IS NOT NULL")
      .get() as { total: number };

    const lastSync = this.db
      .prepare("SELECT started_at FROM sync_records ORDER BY started_at DESC LIMIT 1")
      .get() as { started_at: string } | undefined;

    const oldestChange = this.db
      .prepare("SELECT detected_at FROM changes ORDER BY detected_at ASC LIMIT 1")
      .get() as { detected_at: string } | undefined;

    const newestChange = this.db
      .prepare("SELECT detected_at FROM changes ORDER BY detected_at DESC LIMIT 1")
      .get() as { detected_at: string } | undefined;

    return {
      totalNodes,
      totalEdges,
      totalChanges,
      totalGroups,
      nodesByProvider: Object.fromEntries(byProvider.map((r) => [r.provider, r.c])),
      nodesByResourceType: Object.fromEntries(byResourceType.map((r) => [r.resource_type, r.c])),
      edgesByRelationshipType: Object.fromEntries(byRelType.map((r) => [r.relationship_type, r.c])),
      totalCostMonthly: costRow.total,
      lastSyncAt: lastSync?.started_at ?? null,
      oldestChange: oldestChange?.detected_at ?? null,
      newestChange: newestChange?.detected_at ?? null,
    };
  }
}

// =============================================================================
// Raw Row Types & Row-to-Domain Mappers
// =============================================================================

type RawNodeRow = {
  id: string;
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

function rowToNode(row: RawNodeRow): GraphNode {
  return {
    id: row.id,
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

type RawEdgeRow = {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: string;
  confidence: number;
  discovered_via: string;
  metadata: string;
  created_at: string;
  last_seen_at: string;
};

function rowToEdge(row: RawEdgeRow): GraphEdge {
  return {
    id: row.id,
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

type RawChangeRow = {
  id: string;
  target_id: string;
  change_type: string;
  field: string | null;
  previous_value: string | null;
  new_value: string | null;
  detected_at: string;
  detected_via: string;
  correlation_id: string | null;
  initiator: string | null;
  initiator_type: string | null;
  metadata: string;
};

function rowToChange(row: RawChangeRow): GraphChange {
  return {
    id: row.id,
    targetId: row.target_id,
    changeType: row.change_type as GraphChange["changeType"],
    field: row.field,
    previousValue: row.previous_value,
    newValue: row.new_value,
    detectedAt: row.detected_at,
    detectedVia: row.detected_via as GraphChange["detectedVia"],
    correlationId: row.correlation_id,
    initiator: row.initiator,
    initiatorType: row.initiator_type as GraphChange["initiatorType"],
    metadata: jsonParse(row.metadata, {}),
  };
}

type RawGroupRow = {
  id: string;
  name: string;
  group_type: string;
  description: string;
  owner: string | null;
  tags: string;
  cost_monthly: number | null;
  created_at: string;
  updated_at: string;
};

function rowToGroup(row: RawGroupRow): GraphGroup {
  return {
    id: row.id,
    name: row.name,
    groupType: row.group_type as GraphGroup["groupType"],
    description: row.description,
    owner: row.owner,
    tags: jsonParse(row.tags, {}),
    costMonthly: row.cost_monthly,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type RawSyncRow = {
  id: string;
  provider: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  nodes_discovered: number;
  nodes_created: number;
  nodes_updated: number;
  nodes_disappeared: number;
  edges_discovered: number;
  edges_created: number;
  edges_removed: number;
  changes_recorded: number;
  errors: string;
  duration_ms: number | null;
};

function rowToSync(row: RawSyncRow): SyncRecord {
  return {
    id: row.id,
    provider: row.provider as SyncRecord["provider"],
    status: row.status as SyncRecord["status"],
    startedAt: row.started_at,
    completedAt: row.completed_at,
    nodesDiscovered: row.nodes_discovered,
    nodesCreated: row.nodes_created,
    nodesUpdated: row.nodes_updated,
    nodesDisappeared: row.nodes_disappeared,
    edgesDiscovered: row.edges_discovered,
    edgesCreated: row.edges_created,
    edgesRemoved: row.edges_removed,
    changesRecorded: row.changes_recorded,
    errors: jsonParse(row.errors, []),
    durationMs: row.duration_ms,
  };
}

// =============================================================================
// Pagination cursor helpers
// =============================================================================

/** Encode an offset-based cursor as a base64url string. */
function encodeCursorSqlite(offset: number): string {
  return Buffer.from(`off:${offset}`).toString("base64url");
}

/** Decode a base64url cursor back to a numeric offset. */
function decodeCursorSqlite(cursor: string): number {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const match = decoded.match(/^off:(\d+)$/);
  if (!match) throw new Error(`Invalid pagination cursor: ${cursor}`);
  const offset = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error(`Invalid pagination cursor offset: ${offset}`);
  }
  return offset;
}

export { generateId, now };
