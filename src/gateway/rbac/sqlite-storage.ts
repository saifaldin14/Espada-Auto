/**
 * Enterprise Persistent State — SQLite RBAC Storage
 *
 * Database-backed RBAC storage using SQLite with WAL mode for concurrent reads.
 * Replaces FileRBACStorage for production deployments requiring durability,
 * concurrent access, and crash safety.
 *
 */

import type { Permission, RoleDefinition, RoleAssignment, RBACStorage } from "./types.js";
import { BUILT_IN_ROLES } from "./types.js";
import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// =============================================================================
// SQLite RBAC Storage
// =============================================================================

/**
 * Persists roles and assignments to a SQLite database.
 * Uses WAL mode for concurrent read access and crash safety.
 * Built-in roles are seeded on initialization but loaded from DB.
 */
export class SQLiteRBACStorage implements RBACStorage {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
  }

  async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rbac_roles (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        permissions TEXT NOT NULL DEFAULT '[]',
        built_in    INTEGER NOT NULL DEFAULT 0,
        environments TEXT DEFAULT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS rbac_assignments (
        user_id     TEXT NOT NULL,
        user_email  TEXT NOT NULL DEFAULT '',
        role_id     TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        assigned_by TEXT NOT NULL DEFAULT '',
        expires_at  TEXT DEFAULT NULL,
        PRIMARY KEY (user_id, role_id),
        FOREIGN KEY (role_id) REFERENCES rbac_roles(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_rbac_assignments_user
        ON rbac_assignments(user_id);
      CREATE INDEX IF NOT EXISTS idx_rbac_assignments_role
        ON rbac_assignments(role_id);
      CREATE INDEX IF NOT EXISTS idx_rbac_assignments_expires
        ON rbac_assignments(expires_at);
    `);

    // Seed built-in roles (upsert to preserve any changes to permissions)
    const upsert = this.db.prepare(`
      INSERT INTO rbac_roles (id, name, description, permissions, built_in, environments)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        permissions = excluded.permissions,
        built_in = 1,
        updated_at = datetime('now')
    `);

    const seedBuiltIn = this.db.transaction(() => {
      for (const role of BUILT_IN_ROLES) {
        upsert.run(
          role.id,
          role.name,
          role.description,
          JSON.stringify(role.permissions),
          role.environments ? JSON.stringify(role.environments) : null,
        );
      }
    });

    seedBuiltIn();
  }

  async getRoles(): Promise<RoleDefinition[]> {
    const rows = this.db
      .prepare("SELECT * FROM rbac_roles ORDER BY built_in DESC, name ASC")
      .all() as RBACRoleRow[];

    return rows.map(rowToRole);
  }

  async getRole(roleId: string): Promise<RoleDefinition | null> {
    const row = this.db.prepare("SELECT * FROM rbac_roles WHERE id = ?").get(roleId) as
      | RBACRoleRow
      | undefined;

    return row ? rowToRole(row) : null;
  }

  async saveRole(role: RoleDefinition): Promise<void> {
    if (role.builtIn) return; // Cannot modify built-in roles

    this.db
      .prepare(`
        INSERT INTO rbac_roles (id, name, description, permissions, built_in, environments)
        VALUES (?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          permissions = excluded.permissions,
          environments = excluded.environments,
          updated_at = datetime('now')
      `)
      .run(
        role.id,
        role.name,
        role.description,
        JSON.stringify(role.permissions),
        role.environments ? JSON.stringify(role.environments) : null,
      );
  }

  async deleteRole(roleId: string): Promise<boolean> {
    const role = this.db.prepare("SELECT built_in FROM rbac_roles WHERE id = ?").get(roleId) as
      | { built_in: number }
      | undefined;

    if (!role || role.built_in) return false;

    const deleteOp = this.db.transaction(() => {
      // Cascade handles assignment deletion but we do it explicitly for clarity
      this.db.prepare("DELETE FROM rbac_assignments WHERE role_id = ?").run(roleId);
      this.db.prepare("DELETE FROM rbac_roles WHERE id = ?").run(roleId);
    });

    deleteOp();
    return true;
  }

  async getAssignments(): Promise<RoleAssignment[]> {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare("SELECT * FROM rbac_assignments WHERE expires_at IS NULL OR expires_at > ?")
      .all(now) as RBACAssignmentRow[];

    return rows.map(rowToAssignment);
  }

  async getUserAssignments(userId: string): Promise<RoleAssignment[]> {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        "SELECT * FROM rbac_assignments WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)",
      )
      .all(userId, now) as RBACAssignmentRow[];

    return rows.map(rowToAssignment);
  }

  async assignRole(assignment: RoleAssignment): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO rbac_assignments (user_id, user_email, role_id, assigned_at, assigned_by, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, role_id) DO UPDATE SET
          user_email = excluded.user_email,
          assigned_at = excluded.assigned_at,
          assigned_by = excluded.assigned_by,
          expires_at = excluded.expires_at
      `)
      .run(
        assignment.userId,
        assignment.userEmail,
        assignment.roleId,
        assignment.assignedAt,
        assignment.assignedBy,
        assignment.expiresAt,
      );
  }

  async removeAssignment(userId: string, roleId: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM rbac_assignments WHERE user_id = ? AND role_id = ?")
      .run(userId, roleId);

    return result.changes > 0;
  }

  /** Prune expired assignments. Returns count of pruned entries. */
  async prune(): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db
      .prepare("DELETE FROM rbac_assignments WHERE expires_at IS NOT NULL AND expires_at <= ?")
      .run(now);

    return result.changes;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}

// =============================================================================
// Row types and converters
// =============================================================================

type RBACRoleRow = {
  id: string;
  name: string;
  description: string;
  permissions: string;
  built_in: number;
  environments: string | null;
  created_at: string;
  updated_at: string;
};

type RBACAssignmentRow = {
  user_id: string;
  user_email: string;
  role_id: string;
  assigned_at: string;
  assigned_by: string;
  expires_at: string | null;
};

function rowToRole(row: RBACRoleRow): RoleDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: JSON.parse(row.permissions) as Permission[],
    builtIn: row.built_in === 1,
    environments: row.environments ? (JSON.parse(row.environments) as string[]) : undefined,
  };
}

function rowToAssignment(row: RBACAssignmentRow): RoleAssignment {
  return {
    userId: row.user_id,
    userEmail: row.user_email,
    roleId: row.role_id,
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by,
    expiresAt: row.expires_at,
  };
}
