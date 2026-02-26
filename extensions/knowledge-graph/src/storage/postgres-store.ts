/**
 * Infrastructure Knowledge Graph — PostgreSQL Graph Storage
 *
 * Enterprise-grade storage backend using PostgreSQL for large deployments
 * (100K+ resources). Features:
 *   - Connection pooling via pg Pool
 *   - JSONB for tags/metadata with GIN indexes
 *   - Recursive CTEs for graph traversal
 *   - Concurrent reads/writes
 *   - Schema migration support
 *
 * Requires the `pg` package to be installed (`npm install pg @types/pg`).
 * The pg dependency is dynamically imported so the module is not required
 * unless PostgresGraphStorage is actually instantiated.
 */

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
// Configuration
// =============================================================================

export type PostgresConfig = {
  /** PostgreSQL connection string (e.g. `postgres://user:pass@host:5432/db`). */
  connectionString?: string;
  /** Individual connection params (used if connectionString is not set). */
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  /** Connection pool configuration. */
  pool?: {
    /** Minimum pool size (default: 2). */
    min?: number;
    /** Maximum pool size (default: 20). */
    max?: number;
    /** Idle timeout in ms (default: 30000). */
    idleTimeoutMs?: number;
    /** Connection timeout in ms (default: 5000). */
    connectionTimeoutMs?: number;
  };
  /** SSL configuration. */
  ssl?: boolean | { rejectUnauthorized?: boolean };
  /** Schema name for multi-tenant isolation (default: 'public'). */
  schema?: string;
};

// =============================================================================
// Schema DDL
// =============================================================================

const SCHEMA_VERSION = 2;

function schemaDDL(schema: string): string {
  return `
-- Version tracking
CREATE TABLE IF NOT EXISTS ${schema}.schema_version (
  version INTEGER NOT NULL
);

-- Resource nodes
CREATE TABLE IF NOT EXISTS ${schema}.nodes (
  id               TEXT PRIMARY KEY,
  provider         TEXT NOT NULL,
  resource_type    TEXT NOT NULL,
  native_id        TEXT NOT NULL,
  name             TEXT NOT NULL,
  region           TEXT NOT NULL DEFAULT '',
  account          TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'unknown',
  tags             JSONB NOT NULL DEFAULT '{}',
  metadata         JSONB NOT NULL DEFAULT '{}',
  cost_monthly     DOUBLE PRECISION,
  owner            TEXT,
  discovered_at    TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL,
  last_seen_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_provider ON ${schema}.nodes(provider);
CREATE INDEX IF NOT EXISTS idx_nodes_resource_type ON ${schema}.nodes(resource_type);
CREATE INDEX IF NOT EXISTS idx_nodes_native_id ON ${schema}.nodes(provider, native_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON ${schema}.nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_last_seen ON ${schema}.nodes(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_nodes_account ON ${schema}.nodes(account);
CREATE INDEX IF NOT EXISTS idx_nodes_region ON ${schema}.nodes(region);
CREATE INDEX IF NOT EXISTS idx_nodes_owner ON ${schema}.nodes(owner);
CREATE INDEX IF NOT EXISTS idx_nodes_cost ON ${schema}.nodes(cost_monthly);
CREATE INDEX IF NOT EXISTS idx_nodes_tags ON ${schema}.nodes USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_nodes_metadata ON ${schema}.nodes USING GIN (metadata);

-- Directed edges (relationships)
CREATE TABLE IF NOT EXISTS ${schema}.edges (
  id                TEXT PRIMARY KEY,
  source_node_id    TEXT NOT NULL REFERENCES ${schema}.nodes(id) ON DELETE CASCADE,
  target_node_id    TEXT NOT NULL REFERENCES ${schema}.nodes(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  discovered_via    TEXT NOT NULL DEFAULT 'config-scan',
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL,
  last_seen_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON ${schema}.edges(source_node_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_edges_target ON ${schema}.edges(target_node_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_edges_type ON ${schema}.edges(relationship_type);
CREATE INDEX IF NOT EXISTS idx_edges_last_seen ON ${schema}.edges(last_seen_at);

-- Append-only changelog
CREATE TABLE IF NOT EXISTS ${schema}.changes (
  id              TEXT PRIMARY KEY,
  target_id       TEXT NOT NULL,
  change_type     TEXT NOT NULL,
  field           TEXT,
  previous_value  TEXT,
  new_value       TEXT,
  detected_at     TIMESTAMPTZ NOT NULL,
  detected_via    TEXT NOT NULL DEFAULT 'sync',
  correlation_id  TEXT,
  initiator       TEXT,
  initiator_type  TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_changes_target ON ${schema}.changes(target_id);
CREATE INDEX IF NOT EXISTS idx_changes_type ON ${schema}.changes(change_type);
CREATE INDEX IF NOT EXISTS idx_changes_detected_at ON ${schema}.changes(detected_at);
CREATE INDEX IF NOT EXISTS idx_changes_correlation ON ${schema}.changes(correlation_id);
CREATE INDEX IF NOT EXISTS idx_changes_initiator ON ${schema}.changes(initiator);
CREATE INDEX IF NOT EXISTS idx_changes_initiator_type ON ${schema}.changes(initiator_type);

-- Logical groupings
CREATE TABLE IF NOT EXISTS ${schema}.groups_ (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  group_type   TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  owner        TEXT,
  tags         JSONB NOT NULL DEFAULT '{}',
  cost_monthly DOUBLE PRECISION,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_groups_type ON ${schema}.groups_(group_type);

-- Group membership junction
CREATE TABLE IF NOT EXISTS ${schema}.group_members (
  group_id  TEXT NOT NULL REFERENCES ${schema}.groups_(id) ON DELETE CASCADE,
  node_id   TEXT NOT NULL REFERENCES ${schema}.nodes(id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (group_id, node_id)
);

-- Sync operation history
CREATE TABLE IF NOT EXISTS ${schema}.sync_records (
  id                 TEXT PRIMARY KEY,
  provider           TEXT NOT NULL,
  status             TEXT NOT NULL,
  started_at         TIMESTAMPTZ NOT NULL,
  completed_at       TIMESTAMPTZ,
  nodes_discovered   INTEGER NOT NULL DEFAULT 0,
  nodes_created      INTEGER NOT NULL DEFAULT 0,
  nodes_updated      INTEGER NOT NULL DEFAULT 0,
  nodes_disappeared  INTEGER NOT NULL DEFAULT 0,
  edges_discovered   INTEGER NOT NULL DEFAULT 0,
  edges_created      INTEGER NOT NULL DEFAULT 0,
  edges_removed      INTEGER NOT NULL DEFAULT 0,
  changes_recorded   INTEGER NOT NULL DEFAULT 0,
  errors             JSONB NOT NULL DEFAULT '[]',
  duration_ms        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sync_provider ON ${schema}.sync_records(provider);
CREATE INDEX IF NOT EXISTS idx_sync_started ON ${schema}.sync_records(started_at);

-- Materialized view for stats (refreshed on demand)
CREATE MATERIALIZED VIEW IF NOT EXISTS ${schema}.node_stats AS
  SELECT
    COUNT(*) AS total_nodes,
    COALESCE(SUM(cost_monthly), 0) AS total_cost,
    provider,
    resource_type,
    COUNT(*) AS cnt
  FROM ${schema}.nodes
  GROUP BY GROUPING SETS ((), (provider), (resource_type));

CREATE MATERIALIZED VIEW IF NOT EXISTS ${schema}.edge_stats AS
  SELECT
    relationship_type,
    COUNT(*) AS cnt
  FROM ${schema}.edges
  GROUP BY relationship_type;
`;
}

// =============================================================================
// Helpers
// =============================================================================

function now(): string {
  return new Date().toISOString();
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// pg Pool/Client type placeholders (dynamically imported)
type PgPool = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  connect(): Promise<PgPoolClient>;
  end(): Promise<void>;
};

type PgPoolClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
};

// =============================================================================
// PostgreSQL Graph Storage
// =============================================================================

export class PostgresGraphStorage implements GraphStorage {
  private pool: PgPool | null = null;
  private config: PostgresConfig;
  private schema: string;

  constructor(config: PostgresConfig) {
    this.config = config;
    this.schema = config.schema ?? "public";
  }

  // ---------- Lifecycle ----------

  async initialize(): Promise<void> {
    // Dynamic import so pg is not required at module load time
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error — pg is an optional peer dependency
    const pg = await import("pg");
    const Pool = pg.default?.Pool ?? pg.Pool;

    this.pool = new Pool({
      connectionString: this.config.connectionString,
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      min: this.config.pool?.min ?? 2,
      max: this.config.pool?.max ?? 20,
      idleTimeoutMillis: this.config.pool?.idleTimeoutMs ?? 30_000,
      connectionTimeoutMillis: this.config.pool?.connectionTimeoutMs ?? 5_000,
      ssl: this.config.ssl,
    }) as unknown as PgPool;

    // Create schema if not public
    if (this.schema !== "public") {
      await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
    }

    // Run DDL
    await this.pool.query(schemaDDL(this.schema));

    // Check / set schema version
    const versionResult = await this.pool.query(
      `SELECT version FROM ${this.schema}.schema_version LIMIT 1`,
    );
    if (versionResult.rows.length === 0) {
      await this.pool.query(
        `INSERT INTO ${this.schema}.schema_version (version) VALUES ($1)`,
        [SCHEMA_VERSION],
      );
    } else {
      const currentVersion = versionResult.rows[0].version as number;
      if (currentVersion < SCHEMA_VERSION) {
        if (currentVersion < 2) {
          await this.pool.query(`
            ALTER TABLE ${this.schema}.changes ADD COLUMN IF NOT EXISTS initiator TEXT;
            ALTER TABLE ${this.schema}.changes ADD COLUMN IF NOT EXISTS initiator_type TEXT;
            CREATE INDEX IF NOT EXISTS idx_changes_initiator ON ${this.schema}.changes(initiator);
            CREATE INDEX IF NOT EXISTS idx_changes_initiator_type ON ${this.schema}.changes(initiator_type);
          `);
        }
        await this.pool.query(
          `UPDATE ${this.schema}.schema_version SET version = $1`,
          [SCHEMA_VERSION],
        );
      }
    }

    // Refresh materialized views (ignore errors if empty)
    try {
      await this.pool.query(`REFRESH MATERIALIZED VIEW ${this.schema}.node_stats`);
      await this.pool.query(`REFRESH MATERIALIZED VIEW ${this.schema}.edge_stats`);
    } catch {
      // Views may be empty on first init — safe to ignore
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  private get db(): PgPool {
    if (!this.pool) throw new Error("PostgresGraphStorage not initialized — call initialize() first");
    return this.pool;
  }

  // ---------- Nodes ----------

  async upsertNode(node: GraphNodeInput): Promise<void> {
    const ts = now();
    await this.db.query(
      `INSERT INTO ${this.schema}.nodes
        (id, provider, resource_type, native_id, name, region, account, status, tags, metadata, cost_monthly, owner, discovered_at, created_at, updated_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         status = EXCLUDED.status,
         tags = EXCLUDED.tags,
         metadata = EXCLUDED.metadata,
         cost_monthly = EXCLUDED.cost_monthly,
         owner = EXCLUDED.owner,
         updated_at = EXCLUDED.updated_at,
         last_seen_at = EXCLUDED.last_seen_at`,
      [
        node.id, node.provider, node.resourceType, node.nativeId,
        node.name, node.region, node.account, node.status,
        JSON.stringify(node.tags), JSON.stringify(node.metadata),
        node.costMonthly, node.owner,
        node.discoveredAt ?? ts, node.createdAt,
        node.updatedAt ?? ts, node.lastSeenAt ?? ts,
      ],
    );
  }

  async upsertNodes(nodes: GraphNodeInput[]): Promise<void> {
    if (nodes.length === 0) return;

    // Use a single transaction for batch upsert
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const ts = now();
      for (const node of nodes) {
        await client.query(
          `INSERT INTO ${this.schema}.nodes
            (id, provider, resource_type, native_id, name, region, account, status, tags, metadata, cost_monthly, owner, discovered_at, created_at, updated_at, last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             status = EXCLUDED.status,
             tags = EXCLUDED.tags,
             metadata = EXCLUDED.metadata,
             cost_monthly = EXCLUDED.cost_monthly,
             owner = EXCLUDED.owner,
             updated_at = EXCLUDED.updated_at,
             last_seen_at = EXCLUDED.last_seen_at`,
          [
            node.id, node.provider, node.resourceType, node.nativeId,
            node.name, node.region, node.account, node.status,
            JSON.stringify(node.tags), JSON.stringify(node.metadata),
            node.costMonthly, node.owner,
            node.discoveredAt ?? ts, node.createdAt,
            node.updatedAt ?? ts, node.lastSeenAt ?? ts,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getNode(id: string): Promise<GraphNode | null> {
    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.nodes WHERE id = $1`,
      [id],
    );
    return result.rows.length > 0 ? rowToNode(result.rows[0]) : null;
  }

  async getNodeByNativeId(provider: CloudProvider, nativeId: string): Promise<GraphNode | null> {
    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.nodes WHERE provider = $1 AND native_id = $2`,
      [provider, nativeId],
    );
    return result.rows.length > 0 ? rowToNode(result.rows[0]) : null;
  }

  async queryNodes(filter: NodeFilter): Promise<GraphNode[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter.provider) {
      clauses.push(`provider = $${paramIdx++}`);
      params.push(filter.provider);
    }
    if (filter.resourceType) {
      if (Array.isArray(filter.resourceType)) {
        clauses.push(`resource_type = ANY($${paramIdx++})`);
        params.push(filter.resourceType);
      } else {
        clauses.push(`resource_type = $${paramIdx++}`);
        params.push(filter.resourceType);
      }
    }
    if (filter.region) {
      clauses.push(`region = $${paramIdx++}`);
      params.push(filter.region);
    }
    if (filter.account) {
      clauses.push(`account = $${paramIdx++}`);
      params.push(filter.account);
    }
    if (filter.status) {
      if (Array.isArray(filter.status)) {
        clauses.push(`status = ANY($${paramIdx++})`);
        params.push(filter.status);
      } else {
        clauses.push(`status = $${paramIdx++}`);
        params.push(filter.status);
      }
    }
    if (filter.namePattern) {
      clauses.push(`name ILIKE $${paramIdx++}`);
      params.push(`%${filter.namePattern}%`);
    }
    if (filter.owner) {
      clauses.push(`owner = $${paramIdx++}`);
      params.push(filter.owner);
    }
    if (filter.minCost != null) {
      clauses.push(`cost_monthly >= $${paramIdx++}`);
      params.push(filter.minCost);
    }
    if (filter.maxCost != null) {
      clauses.push(`cost_monthly <= $${paramIdx++}`);
      params.push(filter.maxCost);
    }
    if (filter.tags) {
      // JSONB containment operator for tag filtering
      clauses.push(`tags @> $${paramIdx++}::jsonb`);
      params.push(JSON.stringify(filter.tags));
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.nodes ${where} ORDER BY name`,
      params,
    );
    return result.rows.map(rowToNode);
  }

  async queryNodesPaginated(
    filter: NodeFilter,
    pagination: PaginationOptions = {},
  ): Promise<PaginatedResult<GraphNode>> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter.provider) { clauses.push(`provider = $${paramIdx++}`); params.push(filter.provider); }
    if (filter.resourceType) {
      if (Array.isArray(filter.resourceType)) { clauses.push(`resource_type = ANY($${paramIdx++})`); params.push(filter.resourceType); }
      else { clauses.push(`resource_type = $${paramIdx++}`); params.push(filter.resourceType); }
    }
    if (filter.region) { clauses.push(`region = $${paramIdx++}`); params.push(filter.region); }
    if (filter.account) { clauses.push(`account = $${paramIdx++}`); params.push(filter.account); }
    if (filter.status) {
      if (Array.isArray(filter.status)) { clauses.push(`status = ANY($${paramIdx++})`); params.push(filter.status); }
      else { clauses.push(`status = $${paramIdx++}`); params.push(filter.status); }
    }
    if (filter.namePattern) { clauses.push(`name ILIKE $${paramIdx++}`); params.push(`%${filter.namePattern}%`); }
    if (filter.owner) { clauses.push(`owner = $${paramIdx++}`); params.push(filter.owner); }
    if (filter.minCost != null) { clauses.push(`cost_monthly >= $${paramIdx++}`); params.push(filter.minCost); }
    if (filter.maxCost != null) { clauses.push(`cost_monthly <= $${paramIdx++}`); params.push(filter.maxCost); }
    if (filter.tags) { clauses.push(`tags @> $${paramIdx++}::jsonb`); params.push(JSON.stringify(filter.tags)); }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(pagination.limit ?? 100, 1000));
    const offset = pagination.cursor ? decodeCursorPg(pagination.cursor) : 0;

    const countResult = await this.db.query(
      `SELECT COUNT(*)::int as cnt FROM ${this.schema}.nodes ${where}`,
      params,
    );
    const totalCount = Number(countResult.rows[0].cnt);

    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.nodes ${where} ORDER BY name LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset],
    );

    const hasMore = offset + limit < totalCount;
    return {
      items: result.rows.map(rowToNode),
      totalCount,
      nextCursor: hasMore ? encodeCursorPg(offset + limit) : null,
      hasMore,
    };
  }

  async deleteNode(id: string): Promise<void> {
    await this.db.query(`DELETE FROM ${this.schema}.nodes WHERE id = $1`, [id]);
  }

  async markNodesDisappeared(olderThan: string, provider?: CloudProvider): Promise<string[]> {
    const params: unknown[] = [olderThan, now()];
    let providerClause = "";
    if (provider) {
      providerClause = " AND provider = $3";
      params.push(provider);
    }

    // Use RETURNING to get affected IDs in a single round-trip
    const result = await this.db.query(
      `UPDATE ${this.schema}.nodes
       SET status = 'disappeared', updated_at = $2
       WHERE last_seen_at < $1 AND status != 'disappeared'${providerClause}
       RETURNING id`,
      params,
    );
    return result.rows.map((r) => r.id as string);
  }

  // ---------- Edges ----------

  async upsertEdge(edge: GraphEdgeInput): Promise<void> {
    const ts = now();
    await this.db.query(
      `INSERT INTO ${this.schema}.edges
        (id, source_node_id, target_node_id, relationship_type, confidence, discovered_via, metadata, created_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         confidence = EXCLUDED.confidence,
         metadata = EXCLUDED.metadata,
         last_seen_at = EXCLUDED.last_seen_at`,
      [
        edge.id, edge.sourceNodeId, edge.targetNodeId,
        edge.relationshipType, edge.confidence, edge.discoveredVia,
        JSON.stringify(edge.metadata), edge.createdAt ?? ts, edge.lastSeenAt ?? ts,
      ],
    );
  }

  async upsertEdges(edges: GraphEdgeInput[]): Promise<void> {
    if (edges.length === 0) return;
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const ts = now();
      for (const edge of edges) {
        await client.query(
          `INSERT INTO ${this.schema}.edges
            (id, source_node_id, target_node_id, relationship_type, confidence, discovered_via, metadata, created_at, last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET
             confidence = EXCLUDED.confidence,
             metadata = EXCLUDED.metadata,
             last_seen_at = EXCLUDED.last_seen_at`,
          [
            edge.id, edge.sourceNodeId, edge.targetNodeId,
            edge.relationshipType, edge.confidence, edge.discoveredVia,
            JSON.stringify(edge.metadata), edge.createdAt ?? ts, edge.lastSeenAt ?? ts,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getEdge(id: string): Promise<GraphEdge | null> {
    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.edges WHERE id = $1`,
      [id],
    );
    return result.rows.length > 0 ? rowToEdge(result.rows[0]) : null;
  }

  async getEdgesForNode(
    nodeId: string,
    direction: TraversalDirection,
    relationshipType?: GraphRelationshipType,
  ): Promise<GraphEdge[]> {
    const params: unknown[] = [nodeId];
    let dirClause: string;
    if (direction === "downstream") {
      dirClause = "source_node_id = $1";
    } else if (direction === "upstream") {
      dirClause = "target_node_id = $1";
    } else {
      dirClause = "(source_node_id = $1 OR target_node_id = $1)";
    }

    let typeClause = "";
    if (relationshipType) {
      typeClause = ` AND relationship_type = $2`;
      params.push(relationshipType);
    }

    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.edges WHERE ${dirClause}${typeClause}`,
      params,
    );
    return result.rows.map(rowToEdge);
  }

  async queryEdges(filter: EdgeFilter): Promise<GraphEdge[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter.sourceNodeId) {
      clauses.push(`source_node_id = $${paramIdx++}`);
      params.push(filter.sourceNodeId);
    }
    if (filter.targetNodeId) {
      clauses.push(`target_node_id = $${paramIdx++}`);
      params.push(filter.targetNodeId);
    }
    if (filter.relationshipType) {
      if (Array.isArray(filter.relationshipType)) {
        clauses.push(`relationship_type = ANY($${paramIdx++})`);
        params.push(filter.relationshipType);
      } else {
        clauses.push(`relationship_type = $${paramIdx++}`);
        params.push(filter.relationshipType);
      }
    }
    if (filter.minConfidence != null) {
      clauses.push(`confidence >= $${paramIdx++}`);
      params.push(filter.minConfidence);
    }
    if (filter.discoveredVia) {
      clauses.push(`discovered_via = $${paramIdx++}`);
      params.push(filter.discoveredVia);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.edges ${where}`,
      params,
    );
    return result.rows.map(rowToEdge);
  }

  async queryEdgesPaginated(
    filter: EdgeFilter,
    pagination: PaginationOptions = {},
  ): Promise<PaginatedResult<GraphEdge>> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter.sourceNodeId) { clauses.push(`source_node_id = $${paramIdx++}`); params.push(filter.sourceNodeId); }
    if (filter.targetNodeId) { clauses.push(`target_node_id = $${paramIdx++}`); params.push(filter.targetNodeId); }
    if (filter.relationshipType) {
      if (Array.isArray(filter.relationshipType)) { clauses.push(`relationship_type = ANY($${paramIdx++})`); params.push(filter.relationshipType); }
      else { clauses.push(`relationship_type = $${paramIdx++}`); params.push(filter.relationshipType); }
    }
    if (filter.minConfidence != null) { clauses.push(`confidence >= $${paramIdx++}`); params.push(filter.minConfidence); }
    if (filter.discoveredVia) { clauses.push(`discovered_via = $${paramIdx++}`); params.push(filter.discoveredVia); }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(pagination.limit ?? 100, 1000));
    const offset = pagination.cursor ? decodeCursorPg(pagination.cursor) : 0;

    const countResult = await this.db.query(
      `SELECT COUNT(*)::int as cnt FROM ${this.schema}.edges ${where}`,
      params,
    );
    const totalCount = Number(countResult.rows[0].cnt);

    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.edges ${where} ORDER BY id LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset],
    );

    const hasMore = offset + limit < totalCount;
    return {
      items: result.rows.map(rowToEdge),
      totalCount,
      nextCursor: hasMore ? encodeCursorPg(offset + limit) : null,
      hasMore,
    };
  }

  async deleteEdge(id: string): Promise<void> {
    await this.db.query(`DELETE FROM ${this.schema}.edges WHERE id = $1`, [id]);
  }

  async deleteStaleEdges(olderThan: string): Promise<number> {
    const result = await this.db.query(
      `DELETE FROM ${this.schema}.edges WHERE last_seen_at < $1`,
      [olderThan],
    );
    return (result as unknown as { rowCount: number }).rowCount ?? 0;
  }

  // ---------- Changes (append-only) ----------

  async appendChange(change: GraphChange): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.schema}.changes
        (id, target_id, change_type, field, previous_value, new_value, detected_at, detected_via, correlation_id, initiator, initiator_type, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        change.id, change.targetId, change.changeType,
        change.field, change.previousValue, change.newValue,
        change.detectedAt, change.detectedVia, change.correlationId,
        change.initiator ?? null, change.initiatorType ?? null,
        JSON.stringify(change.metadata),
      ],
    );
  }

  async appendChanges(changes: GraphChange[]): Promise<void> {
    if (changes.length === 0) return;
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      for (const change of changes) {
        await client.query(
          `INSERT INTO ${this.schema}.changes
            (id, target_id, change_type, field, previous_value, new_value, detected_at, detected_via, correlation_id, initiator, initiator_type, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            change.id, change.targetId, change.changeType,
            change.field, change.previousValue, change.newValue,
            change.detectedAt, change.detectedVia, change.correlationId,
            change.initiator ?? null, change.initiatorType ?? null,
            JSON.stringify(change.metadata),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getChanges(filter: ChangeFilter): Promise<GraphChange[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter.targetId) {
      clauses.push(`target_id = $${paramIdx++}`);
      params.push(filter.targetId);
    }
    if (filter.changeType) {
      if (Array.isArray(filter.changeType)) {
        clauses.push(`change_type = ANY($${paramIdx++})`);
        params.push(filter.changeType);
      } else {
        clauses.push(`change_type = $${paramIdx++}`);
        params.push(filter.changeType);
      }
    }
    if (filter.since) {
      clauses.push(`detected_at >= $${paramIdx++}`);
      params.push(filter.since);
    }
    if (filter.until) {
      clauses.push(`detected_at <= $${paramIdx++}`);
      params.push(filter.until);
    }
    if (filter.detectedVia) {
      clauses.push(`detected_via = $${paramIdx++}`);
      params.push(filter.detectedVia);
    }
    if (filter.correlationId) {
      clauses.push(`correlation_id = $${paramIdx++}`);
      params.push(filter.correlationId);
    }
    if (filter.initiator) {
      clauses.push(`initiator = $${paramIdx++}`);
      params.push(filter.initiator);
    }
    if (filter.initiatorType) {
      clauses.push(`initiator_type = $${paramIdx++}`);
      params.push(filter.initiatorType);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.changes ${where} ORDER BY detected_at DESC`,
      params,
    );
    return result.rows.map(rowToChange);
  }

  async getChangesPaginated(
    filter: ChangeFilter,
    pagination: PaginationOptions = {},
  ): Promise<PaginatedResult<GraphChange>> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter.targetId) { clauses.push(`target_id = $${paramIdx++}`); params.push(filter.targetId); }
    if (filter.changeType) {
      if (Array.isArray(filter.changeType)) { clauses.push(`change_type = ANY($${paramIdx++})`); params.push(filter.changeType); }
      else { clauses.push(`change_type = $${paramIdx++}`); params.push(filter.changeType); }
    }
    if (filter.since) { clauses.push(`detected_at >= $${paramIdx++}`); params.push(filter.since); }
    if (filter.until) { clauses.push(`detected_at <= $${paramIdx++}`); params.push(filter.until); }
    if (filter.detectedVia) { clauses.push(`detected_via = $${paramIdx++}`); params.push(filter.detectedVia); }
    if (filter.correlationId) { clauses.push(`correlation_id = $${paramIdx++}`); params.push(filter.correlationId); }
    if (filter.initiator) { clauses.push(`initiator = $${paramIdx++}`); params.push(filter.initiator); }
    if (filter.initiatorType) { clauses.push(`initiator_type = $${paramIdx++}`); params.push(filter.initiatorType); }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(pagination.limit ?? 100, 1000));
    const offset = pagination.cursor ? decodeCursorPg(pagination.cursor) : 0;

    const countResult = await this.db.query(
      `SELECT COUNT(*)::int as cnt FROM ${this.schema}.changes ${where}`,
      params,
    );
    const totalCount = Number(countResult.rows[0].cnt);

    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.changes ${where} ORDER BY detected_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset],
    );

    const hasMore = offset + limit < totalCount;
    return {
      items: result.rows.map(rowToChange),
      totalCount,
      nextCursor: hasMore ? encodeCursorPg(offset + limit) : null,
      hasMore,
    };
  }

  async getNodeTimeline(nodeId: string, limit = 100): Promise<GraphChange[]> {
    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.changes WHERE target_id = $1 ORDER BY detected_at DESC LIMIT $2`,
      [nodeId, limit],
    );
    return result.rows.map(rowToChange);
  }

  // ---------- Groups ----------

  async upsertGroup(group: GraphGroup): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.schema}.groups_
        (id, name, group_type, description, owner, tags, cost_monthly, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         owner = EXCLUDED.owner,
         tags = EXCLUDED.tags,
         cost_monthly = EXCLUDED.cost_monthly,
         updated_at = EXCLUDED.updated_at`,
      [
        group.id, group.name, group.groupType,
        group.description, group.owner,
        JSON.stringify(group.tags), group.costMonthly,
        group.createdAt, group.updatedAt,
      ],
    );
  }

  async getGroup(id: string): Promise<GraphGroup | null> {
    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.groups_ WHERE id = $1`,
      [id],
    );
    return result.rows.length > 0 ? rowToGroup(result.rows[0]) : null;
  }

  async listGroups(groupType?: GraphGroupType): Promise<GraphGroup[]> {
    if (groupType) {
      const result = await this.db.query(
        `SELECT * FROM ${this.schema}.groups_ WHERE group_type = $1 ORDER BY name`,
        [groupType],
      );
      return result.rows.map(rowToGroup);
    }
    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.groups_ ORDER BY name`,
    );
    return result.rows.map(rowToGroup);
  }

  async deleteGroup(id: string): Promise<void> {
    await this.db.query(`DELETE FROM ${this.schema}.groups_ WHERE id = $1`, [id]);
  }

  async addGroupMember(groupId: string, nodeId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.schema}.group_members (group_id, node_id, added_at)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [groupId, nodeId, now()],
    );
  }

  async removeGroupMember(groupId: string, nodeId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM ${this.schema}.group_members WHERE group_id = $1 AND node_id = $2`,
      [groupId, nodeId],
    );
  }

  async getGroupMembers(groupId: string): Promise<GraphNode[]> {
    const result = await this.db.query(
      `SELECT n.* FROM ${this.schema}.nodes n
       INNER JOIN ${this.schema}.group_members gm ON n.id = gm.node_id
       WHERE gm.group_id = $1
       ORDER BY n.name`,
      [groupId],
    );
    return result.rows.map(rowToNode);
  }

  async getNodeGroups(nodeId: string): Promise<GraphGroup[]> {
    const result = await this.db.query(
      `SELECT g.* FROM ${this.schema}.groups_ g
       INNER JOIN ${this.schema}.group_members gm ON g.id = gm.group_id
       WHERE gm.node_id = $1
       ORDER BY g.name`,
      [nodeId],
    );
    return result.rows.map(rowToGroup);
  }

  // ---------- Sync Records ----------

  async saveSyncRecord(record: SyncRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.schema}.sync_records
        (id, provider, status, started_at, completed_at, nodes_discovered, nodes_created, nodes_updated, nodes_disappeared, edges_discovered, edges_created, edges_removed, changes_recorded, errors, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        record.id, record.provider, record.status,
        record.startedAt, record.completedAt,
        record.nodesDiscovered, record.nodesCreated, record.nodesUpdated, record.nodesDisappeared,
        record.edgesDiscovered, record.edgesCreated, record.edgesRemoved,
        record.changesRecorded, JSON.stringify(record.errors), record.durationMs,
      ],
    );
  }

  async getLastSyncRecord(provider?: CloudProvider): Promise<SyncRecord | null> {
    const result = provider
      ? await this.db.query(
          `SELECT * FROM ${this.schema}.sync_records WHERE provider = $1 ORDER BY started_at DESC LIMIT 1`,
          [provider],
        )
      : await this.db.query(
          `SELECT * FROM ${this.schema}.sync_records ORDER BY started_at DESC LIMIT 1`,
        );
    return result.rows.length > 0 ? rowToSync(result.rows[0]) : null;
  }

  async listSyncRecords(limit = 50): Promise<SyncRecord[]> {
    const result = await this.db.query(
      `SELECT * FROM ${this.schema}.sync_records ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map(rowToSync);
  }

  // ---------- Graph Traversal (Recursive CTE) ----------

  async getNeighbors(
    nodeId: string,
    depth: number,
    direction: TraversalDirection,
    edgeTypes?: GraphRelationshipType[],
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const maxDepth = Math.min(depth, 10); // Safety cap

    // Build the edge direction clause
    let joinClause: string;
    let nextNodeExpr: string;
    if (direction === "downstream") {
      joinClause = "e.source_node_id = r.node_id";
      nextNodeExpr = "e.target_node_id";
    } else if (direction === "upstream") {
      joinClause = "e.target_node_id = r.node_id";
      nextNodeExpr = "e.source_node_id";
    } else {
      joinClause = "(e.source_node_id = r.node_id OR e.target_node_id = r.node_id)";
      nextNodeExpr = "CASE WHEN e.source_node_id = r.node_id THEN e.target_node_id ELSE e.source_node_id END";
    }

    let edgeTypeFilter = "";
    const params: unknown[] = [nodeId];
    if (edgeTypes && edgeTypes.length > 0) {
      edgeTypeFilter = ` AND e.relationship_type = ANY($2)`;
      params.push(edgeTypes);
    }

    const sql = `
      WITH RECURSIVE reachable(node_id, depth, path) AS (
        SELECT $1::text, 0, ARRAY[$1::text]
        UNION ALL
        SELECT
          ${nextNodeExpr},
          r.depth + 1,
          r.path || ${nextNodeExpr}
        FROM reachable r
        JOIN ${this.schema}.edges e ON ${joinClause}${edgeTypeFilter}
        WHERE r.depth < ${maxDepth}
          AND NOT (${nextNodeExpr} = ANY(r.path))
      )
      SELECT DISTINCT node_id FROM reachable
    `;

    const reachableResult = await this.db.query(sql, params);
    const nodeIds = reachableResult.rows.map((r) => r.node_id as string);
    if (nodeIds.length === 0) return { nodes: [], edges: [] };

    // Fetch all reached nodes
    const nodeResult = await this.db.query(
      `SELECT * FROM ${this.schema}.nodes WHERE id = ANY($1)`,
      [nodeIds],
    );

    // Fetch edges between reached nodes
    const edgeResult = await this.db.query(
      `SELECT * FROM ${this.schema}.edges
       WHERE source_node_id = ANY($1) AND target_node_id = ANY($1)`,
      [nodeIds],
    );

    return {
      nodes: nodeResult.rows.map(rowToNode),
      edges: edgeResult.rows.map(rowToEdge),
    };
  }

  // ---------- Stats ----------

  async getStats(): Promise<GraphStats> {
    // Try materialized views first for performance, fallback to direct queries
    let totalNodes = 0;
    let totalCost = 0;
    const nodesByProvider: Record<string, number> = {};
    const nodesByResourceType: Record<string, number> = {};

    try {
      const statsResult = await this.db.query(
        `SELECT total_nodes, total_cost, provider, resource_type, cnt FROM ${this.schema}.node_stats`,
      );
      for (const row of statsResult.rows) {
        if (row.provider == null && row.resource_type == null) {
          totalNodes = row.total_nodes as number;
          totalCost = row.total_cost as number;
        } else if (row.provider != null && row.resource_type == null) {
          nodesByProvider[row.provider as string] = row.cnt as number;
        } else if (row.resource_type != null && row.provider == null) {
          nodesByResourceType[row.resource_type as string] = row.cnt as number;
        }
      }
    } catch {
      // Materialized view not available — fallback to direct queries
      const countResult = await this.db.query(`SELECT COUNT(*) AS c FROM ${this.schema}.nodes`);
      totalNodes = Number(countResult.rows[0].c);

      const costResult = await this.db.query(
        `SELECT COALESCE(SUM(cost_monthly), 0) AS total FROM ${this.schema}.nodes WHERE cost_monthly IS NOT NULL`,
      );
      totalCost = Number(costResult.rows[0].total);

      const byProvider = await this.db.query(
        `SELECT provider, COUNT(*) AS c FROM ${this.schema}.nodes GROUP BY provider`,
      );
      for (const r of byProvider.rows) {
        nodesByProvider[r.provider as string] = Number(r.c);
      }

      const byType = await this.db.query(
        `SELECT resource_type, COUNT(*) AS c FROM ${this.schema}.nodes GROUP BY resource_type`,
      );
      for (const r of byType.rows) {
        nodesByResourceType[r.resource_type as string] = Number(r.c);
      }
    }

    const edgesByRelationshipType: Record<string, number> = {};
    try {
      const edgeStatsResult = await this.db.query(
        `SELECT relationship_type, cnt FROM ${this.schema}.edge_stats`,
      );
      for (const row of edgeStatsResult.rows) {
        edgesByRelationshipType[row.relationship_type as string] = row.cnt as number;
      }
    } catch {
      const byRelType = await this.db.query(
        `SELECT relationship_type, COUNT(*) AS c FROM ${this.schema}.edges GROUP BY relationship_type`,
      );
      for (const r of byRelType.rows) {
        edgesByRelationshipType[r.relationship_type as string] = Number(r.c);
      }
    }

    const edgeCountResult = await this.db.query(`SELECT COUNT(*) AS c FROM ${this.schema}.edges`);
    const changeCountResult = await this.db.query(`SELECT COUNT(*) AS c FROM ${this.schema}.changes`);
    const groupCountResult = await this.db.query(`SELECT COUNT(*) AS c FROM ${this.schema}.groups_`);

    const lastSync = await this.db.query(
      `SELECT started_at FROM ${this.schema}.sync_records ORDER BY started_at DESC LIMIT 1`,
    );
    const oldestChange = await this.db.query(
      `SELECT detected_at FROM ${this.schema}.changes ORDER BY detected_at ASC LIMIT 1`,
    );
    const newestChange = await this.db.query(
      `SELECT detected_at FROM ${this.schema}.changes ORDER BY detected_at DESC LIMIT 1`,
    );

    return {
      totalNodes,
      totalEdges: Number(edgeCountResult.rows[0].c),
      totalChanges: Number(changeCountResult.rows[0].c),
      totalGroups: Number(groupCountResult.rows[0].c),
      nodesByProvider,
      nodesByResourceType,
      edgesByRelationshipType,
      totalCostMonthly: totalCost,
      lastSyncAt: lastSync.rows[0]?.started_at as string ?? null,
      oldestChange: oldestChange.rows[0]?.detected_at as string ?? null,
      newestChange: newestChange.rows[0]?.detected_at as string ?? null,
    };
  }

  // ---------- Maintenance Operations ----------

  /**
   * Refresh materialized views. Call after large batch operations.
   */
  async refreshStats(): Promise<void> {
    await this.db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${this.schema}.node_stats`);
    await this.db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${this.schema}.edge_stats`);
  }

  /**
   * Vacuum and analyze tables for query plan optimization.
   */
  async optimize(): Promise<void> {
    await this.db.query(`ANALYZE ${this.schema}.nodes`);
    await this.db.query(`ANALYZE ${this.schema}.edges`);
    await this.db.query(`ANALYZE ${this.schema}.changes`);
  }
}

// =============================================================================
// Row-to-Domain Mappers
// =============================================================================

function toStr(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  return String(val ?? "");
}

function toStrOrNull(val: unknown): string | null {
  if (val == null) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function toJsonObj(val: unknown): Record<string, unknown> {
  if (typeof val === "object" && val !== null) return val as Record<string, unknown>;
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return {}; }
  }
  return {};
}

function toStringRecord(val: unknown): Record<string, string> {
  const obj = toJsonObj(val);
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = String(v ?? "");
  }
  return result;
}

function rowToNode(row: Record<string, unknown>): GraphNode {
  return {
    id: toStr(row.id),
    provider: toStr(row.provider) as GraphNode["provider"],
    resourceType: toStr(row.resource_type) as GraphNode["resourceType"],
    nativeId: toStr(row.native_id),
    name: toStr(row.name),
    region: toStr(row.region),
    account: toStr(row.account),
    status: toStr(row.status) as GraphNode["status"],
    tags: toStringRecord(row.tags),
    metadata: toJsonObj(row.metadata),
    costMonthly: row.cost_monthly != null ? Number(row.cost_monthly) : null,
    owner: toStrOrNull(row.owner),
    discoveredAt: toStr(row.discovered_at),
    createdAt: toStrOrNull(row.created_at),
    updatedAt: toStr(row.updated_at),
    lastSeenAt: toStr(row.last_seen_at),
  };
}

function rowToEdge(row: Record<string, unknown>): GraphEdge {
  return {
    id: toStr(row.id),
    sourceNodeId: toStr(row.source_node_id),
    targetNodeId: toStr(row.target_node_id),
    relationshipType: toStr(row.relationship_type) as GraphEdge["relationshipType"],
    confidence: Number(row.confidence),
    discoveredVia: toStr(row.discovered_via) as GraphEdge["discoveredVia"],
    metadata: toJsonObj(row.metadata),
    createdAt: toStr(row.created_at),
    lastSeenAt: toStr(row.last_seen_at),
  };
}

function rowToChange(row: Record<string, unknown>): GraphChange {
  return {
    id: toStr(row.id),
    targetId: toStr(row.target_id),
    changeType: toStr(row.change_type) as GraphChange["changeType"],
    field: toStrOrNull(row.field),
    previousValue: toStrOrNull(row.previous_value),
    newValue: toStrOrNull(row.new_value),
    detectedAt: toStr(row.detected_at),
    detectedVia: toStr(row.detected_via) as GraphChange["detectedVia"],
    correlationId: toStrOrNull(row.correlation_id),
    initiator: toStrOrNull(row.initiator),
    initiatorType: toStrOrNull(row.initiator_type) as GraphChange["initiatorType"],
    metadata: toJsonObj(row.metadata),
  };
}

function rowToGroup(row: Record<string, unknown>): GraphGroup {
  return {
    id: toStr(row.id),
    name: toStr(row.name),
    groupType: toStr(row.group_type) as GraphGroup["groupType"],
    description: toStr(row.description),
    owner: toStrOrNull(row.owner),
    tags: toStringRecord(row.tags),
    costMonthly: row.cost_monthly != null ? Number(row.cost_monthly) : null,
    createdAt: toStr(row.created_at),
    updatedAt: toStr(row.updated_at),
  };
}

function rowToSync(row: Record<string, unknown>): SyncRecord {
  const errors = Array.isArray(row.errors)
    ? (row.errors as string[])
    : typeof row.errors === "string"
      ? (() => { try { return JSON.parse(row.errors); } catch { return []; } })()
      : [];

  return {
    id: toStr(row.id),
    provider: toStr(row.provider) as SyncRecord["provider"],
    status: toStr(row.status) as SyncRecord["status"],
    startedAt: toStr(row.started_at),
    completedAt: toStrOrNull(row.completed_at),
    nodesDiscovered: Number(row.nodes_discovered),
    nodesCreated: Number(row.nodes_created),
    nodesUpdated: Number(row.nodes_updated),
    nodesDisappeared: Number(row.nodes_disappeared),
    edgesDiscovered: Number(row.edges_discovered),
    edgesCreated: Number(row.edges_created),
    edgesRemoved: Number(row.edges_removed),
    changesRecorded: Number(row.changes_recorded),
    errors,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
  };
}

// =============================================================================
// Pagination cursor helpers
// =============================================================================

function encodeCursorPg(offset: number): string {
  return Buffer.from(`off:${offset}`).toString("base64url");
}

function decodeCursorPg(cursor: string): number {
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
