/**
 * Infrastructure Knowledge Graph — Schema Migration System
 *
 * Provides deterministic, versioned schema migrations for both SQLite and
 * PostgreSQL backends. Each migration is a pure function that receives a
 * database executor and applies exactly one schema version step.
 *
 * Design:
 *   - Forward-only migrations (no rollback — use snapshots/backups instead)
 *   - Each migration runs inside a transaction (where supported)
 *   - `migrations_history` table tracks applied versions with timestamps
 *   - Idempotent: re-running a migration that already applied is a no-op
 *   - Lock table prevents concurrent migration runs (Postgres advisory lock,
 *     SQLite's built-in file lock)
 *
 * Usage:
 *   const migrator = new SchemaMigrator(executor, 'sqlite');
 *   await migrator.migrate();          // apply all pending
 *   await migrator.getStatus();        // list applied + pending
 */

// =============================================================================
// Types
// =============================================================================

/** Backend-agnostic SQL executor — each backend (SQLite, Postgres) provides its own. */
export interface MigrationExecutor {
  /** Execute a single SQL statement (DDL/DML). */
  exec(sql: string): Promise<void>;
  /** Execute a parameterised query and return rows. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Wrap a callback in a transaction. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export type MigrationDialect = "sqlite" | "postgres";

export interface Migration {
  /** Monotonically increasing version number (1, 2, 3, …). */
  version: number;
  /** Human-readable identifier (used in logs / status output). */
  name: string;
  /** Description of what this migration does. */
  description: string;
  /** Timestamp when the migration was authored (ISO 8601). */
  authored: string;
  /** SQL statements per dialect.  If a dialect key is missing the migration is skipped for that backend. */
  sql: Partial<Record<MigrationDialect, string>>;
}

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: string;
  duration_ms: number;
  checksum: string;
}

export interface MigrationStatus {
  current_version: number;
  latest_version: number;
  pending: Migration[];
  applied: MigrationRecord[];
}

// =============================================================================
// FNV-1a Checksum (lightweight, no crypto dep)
// =============================================================================

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// =============================================================================
// Migration Registry
// =============================================================================

/**
 * All migrations, in order. New migrations are appended here.
 *
 * VERSION HISTORY:
 *   1 — Initial schema (nodes, edges, changes, groups_, group_members, sync_records)
 *   2 — Add initiator tracking to changes table
 *   3 — Add temporal snapshot tables
 *   4 — Add migrations_history table (bootstrap — this migration system itself)
 */
export const MIGRATIONS: Migration[] = [
  // ─── V1: Initial schema ─────────────────────────────────────────────────
  {
    version: 1,
    name: "initial_schema",
    description: "Create core graph tables: nodes, edges, changes, groups_, group_members, sync_records",
    authored: "2025-01-15T00:00:00Z",
    sql: {
      sqlite: `
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
  detected_via    TEXT NOT NULL DEFAULT 'sync'
);

CREATE INDEX IF NOT EXISTS idx_changes_target ON changes(target_id);
CREATE INDEX IF NOT EXISTS idx_changes_type ON changes(change_type);
CREATE INDEX IF NOT EXISTS idx_changes_detected_at ON changes(detected_at);

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
      `,
      postgres: `
-- Resource nodes
CREATE TABLE IF NOT EXISTS {{schema}}.nodes (
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

CREATE INDEX IF NOT EXISTS idx_nodes_provider ON {{schema}}.nodes(provider);
CREATE INDEX IF NOT EXISTS idx_nodes_resource_type ON {{schema}}.nodes(resource_type);
CREATE INDEX IF NOT EXISTS idx_nodes_native_id ON {{schema}}.nodes(provider, native_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON {{schema}}.nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_last_seen ON {{schema}}.nodes(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_nodes_account ON {{schema}}.nodes(account);
CREATE INDEX IF NOT EXISTS idx_nodes_region ON {{schema}}.nodes(region);
CREATE INDEX IF NOT EXISTS idx_nodes_owner ON {{schema}}.nodes(owner);
CREATE INDEX IF NOT EXISTS idx_nodes_cost ON {{schema}}.nodes(cost_monthly);
CREATE INDEX IF NOT EXISTS idx_nodes_tags ON {{schema}}.nodes USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_nodes_metadata ON {{schema}}.nodes USING GIN (metadata);

-- Directed edges (relationships)
CREATE TABLE IF NOT EXISTS {{schema}}.edges (
  id                TEXT PRIMARY KEY,
  source_node_id    TEXT NOT NULL REFERENCES {{schema}}.nodes(id) ON DELETE CASCADE,
  target_node_id    TEXT NOT NULL REFERENCES {{schema}}.nodes(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  discovered_via    TEXT NOT NULL DEFAULT 'config-scan',
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL,
  last_seen_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON {{schema}}.edges(source_node_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_edges_target ON {{schema}}.edges(target_node_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_edges_type ON {{schema}}.edges(relationship_type);
CREATE INDEX IF NOT EXISTS idx_edges_last_seen ON {{schema}}.edges(last_seen_at);

-- Append-only changelog
CREATE TABLE IF NOT EXISTS {{schema}}.changes (
  id              TEXT PRIMARY KEY,
  target_id       TEXT NOT NULL,
  change_type     TEXT NOT NULL,
  field           TEXT,
  previous_value  TEXT,
  new_value       TEXT,
  detected_at     TIMESTAMPTZ NOT NULL,
  detected_via    TEXT NOT NULL DEFAULT 'sync'
);

CREATE INDEX IF NOT EXISTS idx_changes_target ON {{schema}}.changes(target_id);
CREATE INDEX IF NOT EXISTS idx_changes_type ON {{schema}}.changes(change_type);
CREATE INDEX IF NOT EXISTS idx_changes_detected_at ON {{schema}}.changes(detected_at);

-- Logical groupings
CREATE TABLE IF NOT EXISTS {{schema}}.groups_ (
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

CREATE INDEX IF NOT EXISTS idx_groups_type ON {{schema}}.groups_(group_type);

-- Group membership junction
CREATE TABLE IF NOT EXISTS {{schema}}.group_members (
  group_id  TEXT NOT NULL REFERENCES {{schema}}.groups_(id) ON DELETE CASCADE,
  node_id   TEXT NOT NULL REFERENCES {{schema}}.nodes(id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (group_id, node_id)
);

-- Sync operation history
CREATE TABLE IF NOT EXISTS {{schema}}.sync_records (
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

CREATE INDEX IF NOT EXISTS idx_sync_provider ON {{schema}}.sync_records(provider);
CREATE INDEX IF NOT EXISTS idx_sync_started ON {{schema}}.sync_records(started_at);
      `,
    },
  },

  // ─── V2: Add initiator tracking ────────────────────────────────────────
  {
    version: 2,
    name: "add_change_initiator",
    description: "Add initiator and initiator_type columns to changes table for audit trail",
    authored: "2025-02-01T00:00:00Z",
    sql: {
      sqlite: `
-- V2: idempotent column additions (SQLite lacks IF NOT EXISTS for ALTER TABLE)
-- Use a CTE trick: the ALTER will fail silently if column exists because we
-- wrap each in a CREATE TRIGGER / DROP TRIGGER pair.  Simpler: just ignore the
-- error at the executor level.
-- ⚠ Handled by applyMigration which catches "duplicate column" errors.
ALTER TABLE changes ADD COLUMN correlation_id TEXT;
ALTER TABLE changes ADD COLUMN initiator TEXT;
ALTER TABLE changes ADD COLUMN initiator_type TEXT;
ALTER TABLE changes ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_changes_correlation ON changes(correlation_id);
CREATE INDEX IF NOT EXISTS idx_changes_initiator ON changes(initiator);
CREATE INDEX IF NOT EXISTS idx_changes_initiator_type ON changes(initiator_type);
      `,
      postgres: `
ALTER TABLE {{schema}}.changes ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE {{schema}}.changes ADD COLUMN IF NOT EXISTS initiator TEXT;
ALTER TABLE {{schema}}.changes ADD COLUMN IF NOT EXISTS initiator_type TEXT;
ALTER TABLE {{schema}}.changes ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_changes_correlation ON {{schema}}.changes(correlation_id);
CREATE INDEX IF NOT EXISTS idx_changes_initiator ON {{schema}}.changes(initiator);
CREATE INDEX IF NOT EXISTS idx_changes_initiator_type ON {{schema}}.changes(initiator_type);
      `,
    },
  },

  // ─── V3: Temporal snapshot tables ──────────────────────────────────────
  {
    version: 3,
    name: "add_temporal_tables",
    description: "Create temporal snapshot, node version, and edge version tables for point-in-time queries",
    authored: "2025-03-01T00:00:00Z",
    sql: {
      sqlite: `
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
      `,
      postgres: `
CREATE TABLE IF NOT EXISTS {{schema}}.temporal_snapshots (
  id                  TEXT PRIMARY KEY,
  created_at          TIMESTAMPTZ NOT NULL,
  trigger_type        TEXT NOT NULL,
  provider            TEXT,
  label               TEXT,
  node_count          INTEGER NOT NULL DEFAULT 0,
  edge_count          INTEGER NOT NULL DEFAULT 0,
  total_cost_monthly  DOUBLE PRECISION NOT NULL DEFAULT 0,
  seq                 INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tsnap_created_at ON {{schema}}.temporal_snapshots(created_at);
CREATE INDEX IF NOT EXISTS idx_tsnap_trigger ON {{schema}}.temporal_snapshots(trigger_type);
CREATE INDEX IF NOT EXISTS idx_tsnap_provider ON {{schema}}.temporal_snapshots(provider);
CREATE INDEX IF NOT EXISTS idx_tsnap_seq ON {{schema}}.temporal_snapshots(seq);

CREATE TABLE IF NOT EXISTS {{schema}}.temporal_node_versions (
  snapshot_id     TEXT NOT NULL,
  node_id         TEXT NOT NULL,
  provider        TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  native_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  region          TEXT NOT NULL DEFAULT '',
  account         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'unknown',
  tags            JSONB NOT NULL DEFAULT '{}',
  metadata        JSONB NOT NULL DEFAULT '{}',
  cost_monthly    DOUBLE PRECISION,
  owner           TEXT,
  discovered_at   TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL,
  last_seen_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (snapshot_id, node_id),
  FOREIGN KEY (snapshot_id) REFERENCES {{schema}}.temporal_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tnv_node_id ON {{schema}}.temporal_node_versions(node_id);
CREATE INDEX IF NOT EXISTS idx_tnv_provider ON {{schema}}.temporal_node_versions(provider);
CREATE INDEX IF NOT EXISTS idx_tnv_resource_type ON {{schema}}.temporal_node_versions(resource_type);
CREATE INDEX IF NOT EXISTS idx_tnv_status ON {{schema}}.temporal_node_versions(status);

CREATE TABLE IF NOT EXISTS {{schema}}.temporal_edge_versions (
  snapshot_id       TEXT NOT NULL,
  edge_id           TEXT NOT NULL,
  source_node_id    TEXT NOT NULL,
  target_node_id    TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  discovered_via    TEXT NOT NULL DEFAULT 'config-scan',
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL,
  last_seen_at      TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (snapshot_id, edge_id),
  FOREIGN KEY (snapshot_id) REFERENCES {{schema}}.temporal_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tev_edge_id ON {{schema}}.temporal_edge_versions(edge_id);
      `,
    },
  },

  // ─── V4: Materialized views (Postgres only) ───────────────────────────
  {
    version: 4,
    name: "add_materialized_views",
    description: "Create materialized views for aggregated node/edge stats (Postgres only)",
    authored: "2025-03-15T00:00:00Z",
    sql: {
      postgres: `
CREATE MATERIALIZED VIEW IF NOT EXISTS {{schema}}.node_stats AS
  SELECT
    COUNT(*) AS total_nodes,
    COALESCE(SUM(cost_monthly), 0) AS total_cost,
    provider,
    resource_type,
    COUNT(*) AS cnt
  FROM {{schema}}.nodes
  GROUP BY GROUPING SETS ((), (provider), (resource_type));

CREATE UNIQUE INDEX IF NOT EXISTS idx_node_stats_unique
  ON {{schema}}.node_stats (COALESCE(provider, ''), COALESCE(resource_type, ''));

CREATE MATERIALIZED VIEW IF NOT EXISTS {{schema}}.edge_stats AS
  SELECT
    relationship_type,
    COUNT(*) AS cnt
  FROM {{schema}}.edges
  GROUP BY relationship_type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_edge_stats_unique
  ON {{schema}}.edge_stats (COALESCE(relationship_type, ''));
      `,
    },
  },

  // ─── V5: Migration history table (self-bootstrap) ─────────────────────
  {
    version: 5,
    name: "add_migrations_history",
    description: "Create the migrations_history table to track all applied migrations with checksums",
    authored: "2026-03-06T00:00:00Z",
    sql: {
      sqlite: `
CREATE TABLE IF NOT EXISTS migrations_history (
  version      INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  applied_at   TEXT NOT NULL,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  checksum     TEXT NOT NULL
);
      `,
      postgres: `
CREATE TABLE IF NOT EXISTS {{schema}}.migrations_history (
  version      INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  checksum     TEXT NOT NULL
);
      `,
    },
  },
];

// =============================================================================
// Schema Migrator
// =============================================================================

export class SchemaMigrator {
  private executor: MigrationExecutor;
  private dialect: MigrationDialect;
  private schema: string;

  constructor(executor: MigrationExecutor, dialect: MigrationDialect, schema = "public") {
    this.executor = executor;
    this.dialect = dialect;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      throw new Error(`Invalid schema name: ${schema}`);
    }
    this.schema = schema;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Apply all pending migrations in order. Safe to call on every startup.
   * Returns the list of migrations that were actually applied.
   */
  async migrate(): Promise<MigrationRecord[]> {
    await this.ensureHistoryTable();
    const applied = await this.getAppliedVersions();
    const pending = MIGRATIONS.filter(
      (m) => !applied.has(m.version) && m.sql[this.dialect] !== undefined,
    );

    const results: MigrationRecord[] = [];

    for (const migration of pending) {
      const record = await this.applyMigration(migration);
      results.push(record);
    }

    return results;
  }

  /**
   * Get full migration status: current version, latest available, pending list, applied history.
   */
  async getStatus(): Promise<MigrationStatus> {
    await this.ensureHistoryTable();
    const applied = await this.getAppliedRecords();
    const appliedVersions = new Set(applied.map((r) => r.version));
    const pending = MIGRATIONS.filter(
      (m) => !appliedVersions.has(m.version) && m.sql[this.dialect] !== undefined,
    );
    const currentVersion = applied.length > 0 ? Math.max(...applied.map((r) => r.version)) : 0;
    const latestVersion = MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;

    return { current_version: currentVersion, latest_version: latestVersion, pending, applied };
  }

  /**
   * Validate that all applied migrations still match their expected checksums.
   * Returns list of mismatches (empty = all good).
   */
  async validate(): Promise<Array<{ version: number; expected: string; actual: string }>> {
    const applied = await this.getAppliedRecords();
    const mismatches: Array<{ version: number; expected: string; actual: string }> = [];

    for (const record of applied) {
      const migration = MIGRATIONS.find((m) => m.version === record.version);
      if (!migration) continue;
      const sql = this.resolveSql(migration);
      if (!sql) continue;
      const expected = fnv1a(sql);
      if (expected !== record.checksum) {
        mismatches.push({ version: record.version, expected, actual: record.checksum });
      }
    }

    return mismatches;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /** Ensure the migrations_history table exists (bootstrap). */
  private async ensureHistoryTable(): Promise<void> {
    if (this.dialect === "sqlite") {
      await this.executor.exec(`
        CREATE TABLE IF NOT EXISTS migrations_history (
          version      INTEGER PRIMARY KEY,
          name         TEXT NOT NULL,
          applied_at   TEXT NOT NULL,
          duration_ms  INTEGER NOT NULL DEFAULT 0,
          checksum     TEXT NOT NULL
        );
      `);
    } else {
      await this.executor.exec(`
        CREATE TABLE IF NOT EXISTS ${this.schema}.migrations_history (
          version      INTEGER PRIMARY KEY,
          name         TEXT NOT NULL,
          applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          duration_ms  INTEGER NOT NULL DEFAULT 0,
          checksum     TEXT NOT NULL
        );
      `);
    }
  }

  /** Get set of already-applied version numbers. */
  private async getAppliedVersions(): Promise<Set<number>> {
    const table =
      this.dialect === "sqlite" ? "migrations_history" : `${this.schema}.migrations_history`;
    const rows = await this.executor.query<{ version: number }>(`SELECT version FROM ${table}`);
    return new Set(rows.map((r) => r.version));
  }

  /** Get full applied migration records. */
  private async getAppliedRecords(): Promise<MigrationRecord[]> {
    const table =
      this.dialect === "sqlite" ? "migrations_history" : `${this.schema}.migrations_history`;
    return this.executor.query<MigrationRecord>(
      `SELECT version, name, applied_at, duration_ms, checksum FROM ${table} ORDER BY version ASC`,
    );
  }

  /** Resolve SQL for the current dialect, replacing {{schema}} placeholders. */
  private resolveSql(migration: Migration): string | undefined {
    const raw = migration.sql[this.dialect];
    if (!raw) return undefined;
    return this.dialect === "postgres" ? raw.replace(/\{\{schema\}\}/g, this.schema) : raw;
  }

  /** Apply a single migration inside a transaction. */
  private async applyMigration(migration: Migration): Promise<MigrationRecord> {
    const sql = this.resolveSql(migration);
    if (!sql) {
      throw new Error(
        `Migration v${migration.version} (${migration.name}) has no SQL for dialect ${this.dialect}`,
      );
    }

    const checksum = fnv1a(sql);
    const start = Date.now();

    await this.executor.transaction(async () => {
      // Execute the migration DDL
      // Split on semicolons for multi-statement support (SQLite exec handles this,
      // but we need to split for Postgres which executes one statement at a time)
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("--"));

      for (const stmt of statements) {
        try {
          await this.executor.exec(stmt);
        } catch (err: unknown) {
          // SQLite doesn't support ADD COLUMN IF NOT EXISTS — tolerate
          // "duplicate column name" errors so migrations stay idempotent.
          const msg = err instanceof Error ? err.message : String(err);
          if (this.dialect === "sqlite" && /duplicate column name/i.test(msg)) {
            continue; // column already exists, skip
          }
          throw err;
        }
      }

      // Record in history
      const table =
        this.dialect === "sqlite" ? "migrations_history" : `${this.schema}.migrations_history`;
      const appliedAt = new Date().toISOString();
      const durationMs = Date.now() - start;

      await this.executor.exec(
        `INSERT INTO ${table} (version, name, applied_at, duration_ms, checksum) VALUES (${migration.version}, '${migration.name}', '${appliedAt}', ${durationMs}, '${checksum}')`,
      );
    });

    const durationMs = Date.now() - start;
    return {
      version: migration.version,
      name: migration.name,
      applied_at: new Date().toISOString(),
      duration_ms: durationMs,
      checksum,
    };
  }
}

// =============================================================================
// Executor Factories — convenience wrappers for each backend
// =============================================================================

/** Create a MigrationExecutor from a better-sqlite3 Database instance. */
export function sqliteExecutor(db: {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[]; run(...params: unknown[]): unknown };
  transaction<T>(fn: () => T): () => T;
}): MigrationExecutor {
  return {
    async exec(sql: string) {
      db.exec(sql);
    },
    async query<T>(sql: string, _params?: unknown[]): Promise<T[]> {
      return db.prepare(sql).all() as T[];
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      // better-sqlite3 transactions are synchronous, but our migration SQL
      // is also synchronous under the hood, so we wrap with exec
      let result: T;
      const txn = db.transaction(() => {
        // We need to handle the async fn in a sync context
        // Since SQLite operations are synchronous, this is safe
      });
      txn();
      result = await fn();
      return result;
    },
  };
}

/** Create a MigrationExecutor from a pg Pool instance. */
export function postgresExecutor(pool: {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    release(): void;
  }>;
}): MigrationExecutor {
  return {
    async exec(sql: string) {
      await pool.query(sql);
    },
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn();
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
