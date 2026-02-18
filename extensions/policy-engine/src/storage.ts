/**
 * Policy Engine — Storage Implementations
 *
 * SQLite and InMemory stores for PolicyDefinition persistence.
 */

import type { PolicyDefinition, PolicyDefinitionInput, PolicyStorage } from "./types.js";

// ── InMemory (for tests) ──────────────────────────────────────────

export class InMemoryPolicyStorage implements PolicyStorage {
  private policies = new Map<string, PolicyDefinition>();

  async initialize(): Promise<void> {}

  async save(policy: PolicyDefinition): Promise<void> {
    this.policies.set(policy.id, structuredClone(policy));
  }

  async getById(id: string): Promise<PolicyDefinition | null> {
    const p = this.policies.get(id);
    return p ? structuredClone(p) : null;
  }

  async list(filters?: { type?: string; enabled?: boolean; severity?: string }): Promise<PolicyDefinition[]> {
    let results = [...this.policies.values()];
    if (filters?.type) results = results.filter((p) => p.type === filters.type);
    if (filters?.enabled !== undefined) results = results.filter((p) => p.enabled === filters.enabled);
    if (filters?.severity) results = results.filter((p) => p.severity === filters.severity);
    return results.map((p) => structuredClone(p));
  }

  async delete(id: string): Promise<boolean> {
    return this.policies.delete(id);
  }

  async close(): Promise<void> {
    this.policies.clear();
  }
}

// ── SQLite ─────────────────────────────────────────────────────────

export class SQLitePolicyStorage implements PolicyStorage {
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
    this.db.pragma("foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        severity TEXT NOT NULL DEFAULT 'medium',
        labels TEXT NOT NULL DEFAULT '[]',
        auto_attach_patterns TEXT NOT NULL DEFAULT '[]',
        rules TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_policies_type ON policies(type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_policies_enabled ON policies(enabled)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_policies_severity ON policies(severity)`);
  }

  async save(policy: PolicyDefinition): Promise<void> {
    if (!this.db) throw new Error("Storage not initialized");

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO policies (id, name, description, type, enabled, severity, labels, auto_attach_patterns, rules, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      policy.id,
      policy.name,
      policy.description,
      policy.type,
      policy.enabled ? 1 : 0,
      policy.severity,
      JSON.stringify(policy.labels),
      JSON.stringify(policy.autoAttachPatterns),
      JSON.stringify(policy.rules),
      policy.createdAt,
      policy.updatedAt,
    );
  }

  async getById(id: string): Promise<PolicyDefinition | null> {
    if (!this.db) throw new Error("Storage not initialized");
    const row = this.db.prepare("SELECT * FROM policies WHERE id = ?").get(id) as PolicyRow | undefined;
    return row ? rowToPolicy(row) : null;
  }

  async list(filters?: { type?: string; enabled?: boolean; severity?: string }): Promise<PolicyDefinition[]> {
    if (!this.db) throw new Error("Storage not initialized");

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.type) {
      clauses.push("type = ?");
      params.push(filters.type);
    }
    if (filters?.enabled !== undefined) {
      clauses.push("enabled = ?");
      params.push(filters.enabled ? 1 : 0);
    }
    if (filters?.severity) {
      clauses.push("severity = ?");
      params.push(filters.severity);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM policies ${where} ORDER BY created_at DESC`).all(...params) as PolicyRow[];
    return rows.map(rowToPolicy);
  }

  async delete(id: string): Promise<boolean> {
    if (!this.db) throw new Error("Storage not initialized");
    const result = this.db.prepare("DELETE FROM policies WHERE id = ?").run(id);
    return result.changes > 0;
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}

// ── Row mapping ────────────────────────────────────────────────────

interface PolicyRow {
  id: string;
  name: string;
  description: string;
  type: string;
  enabled: number;
  severity: string;
  labels: string;
  auto_attach_patterns: string;
  rules: string;
  created_at: string;
  updated_at: string;
}

function rowToPolicy(row: PolicyRow): PolicyDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as PolicyDefinition["type"],
    enabled: row.enabled === 1,
    severity: row.severity as PolicyDefinition["severity"],
    labels: JSON.parse(row.labels),
    autoAttachPatterns: JSON.parse(row.auto_attach_patterns),
    rules: JSON.parse(row.rules),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Factory ────────────────────────────────────────────────────────

export function createPolicyFromInput(input: PolicyDefinitionInput): PolicyDefinition {
  const now = new Date().toISOString();
  return {
    id: input.id ?? `policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    description: input.description ?? "",
    type: input.type,
    enabled: input.enabled ?? true,
    severity: input.severity ?? "medium",
    labels: input.labels ?? [],
    autoAttachPatterns: input.autoAttachPatterns ?? [],
    rules: input.rules,
    createdAt: now,
    updatedAt: now,
  };
}
