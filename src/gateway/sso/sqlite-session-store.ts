/**
 * Enterprise Persistent State — SQLite Session Store
 *
 * Database-backed session storage using SQLite with WAL mode.
 * Replaces FileSessionStore for production deployments requiring
 * durability, concurrent access, and efficient session lookups.
 *
 */

import type { SSOProviderType, SSOSession, SessionStore } from "./types.js";
import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// =============================================================================
// SQLite Session Store
// =============================================================================

/**
 * Persists SSO sessions to a SQLite database.
 * Uses WAL mode for concurrent reads and indexed lookups on userId and expiry.
 */
export class SQLiteSessionStore implements SessionStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");

    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sso_sessions (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL,
        email           TEXT NOT NULL DEFAULT '',
        name            TEXT NOT NULL DEFAULT '',
        roles           TEXT NOT NULL DEFAULT '[]',
        idp_groups      TEXT NOT NULL DEFAULT '[]',
        issued_at       TEXT NOT NULL,
        expires_at      TEXT NOT NULL,
        refresh_token   TEXT DEFAULT NULL,
        provider        TEXT NOT NULL DEFAULT '',
        client_ip       TEXT DEFAULT NULL,
        user_agent      TEXT DEFAULT NULL,
        last_activity_at TEXT DEFAULT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sso_sessions_user_id
        ON sso_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sso_sessions_expires_at
        ON sso_sessions(expires_at);
    `);
  }

  async save(session: SSOSession): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO sso_sessions (
          id, user_id, email, name, roles, idp_groups,
          issued_at, expires_at, refresh_token, provider,
          client_ip, user_agent, last_activity_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          user_id = excluded.user_id,
          email = excluded.email,
          name = excluded.name,
          roles = excluded.roles,
          idp_groups = excluded.idp_groups,
          issued_at = excluded.issued_at,
          expires_at = excluded.expires_at,
          refresh_token = excluded.refresh_token,
          provider = excluded.provider,
          client_ip = excluded.client_ip,
          user_agent = excluded.user_agent,
          last_activity_at = excluded.last_activity_at
      `)
      .run(
        session.id,
        session.userId,
        session.email,
        session.name ?? "",
        JSON.stringify(session.roles ?? []),
        JSON.stringify(session.idpGroups ?? []),
        session.issuedAt,
        session.expiresAt,
        session.refreshToken ?? null,
        session.provider ?? "",
        session.clientIp ?? null,
        session.userAgent ?? null,
        session.lastActivityAt ?? null,
      );
  }

  async get(id: string): Promise<SSOSession | null> {
    const row = this.db
      .prepare("SELECT * FROM sso_sessions WHERE id = ? AND expires_at > datetime('now')")
      .get(id) as SessionRow | undefined;

    return row ? rowToSession(row) : null;
  }

  async delete(id: string): Promise<void> {
    this.db.prepare("DELETE FROM sso_sessions WHERE id = ?").run(id);
  }

  async listActive(): Promise<SSOSession[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM sso_sessions WHERE expires_at > datetime('now') ORDER BY issued_at DESC",
      )
      .all() as SessionRow[];

    return rows.map(rowToSession);
  }

  async getUserSessions(userId: string): Promise<SSOSession[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM sso_sessions WHERE user_id = ? AND expires_at > datetime('now') ORDER BY issued_at DESC",
      )
      .all(userId) as SessionRow[];

    return rows.map(rowToSession);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    this.db.prepare("DELETE FROM sso_sessions WHERE user_id = ?").run(userId);
  }

  async prune(): Promise<number> {
    const result = this.db
      .prepare("DELETE FROM sso_sessions WHERE expires_at <= datetime('now')")
      .run();

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

type SessionRow = {
  id: string;
  user_id: string;
  email: string;
  name: string;
  roles: string;
  idp_groups: string;
  issued_at: string;
  expires_at: string;
  refresh_token: string | null;
  provider: string;
  client_ip: string | null;
  user_agent: string | null;
  last_activity_at: string | null;
};

function rowToSession(row: SessionRow): SSOSession {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    roles: JSON.parse(row.roles) as string[],
    idpGroups: JSON.parse(row.idp_groups) as string[],
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    refreshToken: row.refresh_token ?? undefined,
    provider: row.provider as SSOProviderType,
    clientIp: row.client_ip ?? undefined,
    userAgent: row.user_agent ?? undefined,
    lastActivityAt: row.last_activity_at ?? "",
  };
}
