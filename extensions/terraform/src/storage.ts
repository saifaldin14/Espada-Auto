/**
 * Terraform — Storage (InMemory + SQLite)
 */

import type { TerraformStorage, TerraformWorkspace, DriftResult, StateLock, WorkspaceInput } from "./types.js";

// ── InMemory ────────────────────────────────────────────────────

export class InMemoryTerraformStorage implements TerraformStorage {
  private workspaces = new Map<string, TerraformWorkspace>();
  private driftHistory = new Map<string, DriftResult[]>();
  private locks = new Map<string, StateLock>();

  async initialize(): Promise<void> {}

  async saveWorkspace(ws: TerraformWorkspace): Promise<void> {
    this.workspaces.set(ws.id, structuredClone(ws));
  }
  async getWorkspace(id: string): Promise<TerraformWorkspace | null> {
    return this.workspaces.has(id) ? structuredClone(this.workspaces.get(id)!) : null;
  }
  async listWorkspaces(): Promise<TerraformWorkspace[]> {
    return [...this.workspaces.values()].map((w) => structuredClone(w));
  }
  async deleteWorkspace(id: string): Promise<boolean> {
    return this.workspaces.delete(id);
  }

  async saveDriftResult(result: DriftResult): Promise<void> {
    const list = this.driftHistory.get(result.stateId) ?? [];
    list.unshift(structuredClone(result));
    this.driftHistory.set(result.stateId, list);
  }
  async getDriftHistory(stateId: string, limit = 10): Promise<DriftResult[]> {
    const list = this.driftHistory.get(stateId) ?? [];
    return list.slice(0, limit).map((r) => structuredClone(r));
  }

  async acquireLock(lock: StateLock): Promise<boolean> {
    if (this.locks.has(lock.stateId)) return false;
    this.locks.set(lock.stateId, structuredClone(lock));
    return true;
  }
  async releaseLock(stateId: string, lockId: string): Promise<boolean> {
    const existing = this.locks.get(stateId);
    if (!existing || existing.id !== lockId) return false;
    this.locks.delete(stateId);
    return true;
  }
  async getLock(stateId: string): Promise<StateLock | null> {
    return this.locks.has(stateId) ? structuredClone(this.locks.get(stateId)!) : null;
  }

  async close(): Promise<void> {
    this.workspaces.clear();
    this.driftHistory.clear();
    this.locks.clear();
  }
}

// ── SQLite ──────────────────────────────────────────────────────

export class SQLiteTerraformStorage implements TerraformStorage {
  private db: import("better-sqlite3").Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    const Database = (await import("better-sqlite3")).default;
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        state_path TEXT NOT NULL,
        backend TEXT NOT NULL DEFAULT 'local',
        environment TEXT NOT NULL DEFAULT 'default',
        last_plan_at TEXT,
        last_apply_at TEXT,
        last_drift_check_at TEXT,
        resource_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS drift_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state_id TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        total_resources INTEGER NOT NULL,
        result_json TEXT NOT NULL,
        summary_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS state_locks (
        state_id TEXT PRIMARY KEY,
        lock_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        locked_by TEXT NOT NULL,
        locked_at TEXT NOT NULL,
        info TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_drift_state ON drift_results(state_id, detected_at DESC);
    `);
  }

  async saveWorkspace(ws: TerraformWorkspace): Promise<void> {
    this.db!.prepare(`INSERT OR REPLACE INTO workspaces (id, name, state_path, backend, environment, last_plan_at, last_apply_at, last_drift_check_at, resource_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ws.id, ws.name, ws.statePath, ws.backend, ws.environment, ws.lastPlanAt ?? null, ws.lastApplyAt ?? null, ws.lastDriftCheckAt ?? null, ws.resourceCount, ws.createdAt, ws.updatedAt);
  }

  async getWorkspace(id: string): Promise<TerraformWorkspace | null> {
    const row = this.db!.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToWorkspace(row) : null;
  }

  async listWorkspaces(): Promise<TerraformWorkspace[]> {
    return (this.db!.prepare("SELECT * FROM workspaces ORDER BY name").all() as Record<string, unknown>[]).map(rowToWorkspace);
  }

  async deleteWorkspace(id: string): Promise<boolean> {
    return this.db!.prepare("DELETE FROM workspaces WHERE id = ?").run(id).changes > 0;
  }

  async saveDriftResult(result: DriftResult): Promise<void> {
    this.db!.prepare(`INSERT INTO drift_results (state_id, detected_at, total_resources, result_json, summary_json) VALUES (?, ?, ?, ?, ?)`)
      .run(result.stateId, result.detectedAt, result.totalResources, JSON.stringify(result), JSON.stringify(result.summary));
  }

  async getDriftHistory(stateId: string, limit = 10): Promise<DriftResult[]> {
    const rows = this.db!.prepare("SELECT * FROM drift_results WHERE state_id = ? ORDER BY detected_at DESC LIMIT ?").all(stateId, limit) as Record<string, unknown>[];
    return rows.map((r) => JSON.parse(r.result_json as string));
  }

  async acquireLock(lock: StateLock): Promise<boolean> {
    try {
      this.db!.prepare(`INSERT INTO state_locks (state_id, lock_id, operation, locked_by, locked_at, info) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(lock.stateId, lock.id, lock.operation, lock.lockedBy, lock.lockedAt, lock.info ?? null);
      return true;
    } catch {
      return false;
    }
  }

  async releaseLock(stateId: string, lockId: string): Promise<boolean> {
    return this.db!.prepare("DELETE FROM state_locks WHERE state_id = ? AND lock_id = ?").run(stateId, lockId).changes > 0;
  }

  async getLock(stateId: string): Promise<StateLock | null> {
    const row = this.db!.prepare("SELECT * FROM state_locks WHERE state_id = ?").get(stateId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { id: row.lock_id as string, stateId: row.state_id as string, operation: row.operation as string, lockedBy: row.locked_by as string, lockedAt: row.locked_at as string, info: (row.info as string) ?? undefined };
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function rowToWorkspace(r: Record<string, unknown>): TerraformWorkspace {
  return {
    id: r.id as string, name: r.name as string, statePath: r.state_path as string,
    backend: r.backend as string, environment: r.environment as string,
    lastPlanAt: (r.last_plan_at as string) ?? undefined,
    lastApplyAt: (r.last_apply_at as string) ?? undefined,
    lastDriftCheckAt: (r.last_drift_check_at as string) ?? undefined,
    resourceCount: r.resource_count as number,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

export function createWorkspaceFromInput(input: WorkspaceInput): TerraformWorkspace {
  const now = new Date().toISOString();
  return {
    id: input.id ?? `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    statePath: input.statePath,
    backend: input.backend ?? "local",
    environment: input.environment ?? "default",
    resourceCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
