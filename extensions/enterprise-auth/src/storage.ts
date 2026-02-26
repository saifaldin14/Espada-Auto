/**
 * Enterprise Auth — Storage Implementations
 *
 * InMemory storage for testing and SQLite for production.
 */

import type {
  AuthStorage,
  Role,
  User,
  Session,
  ApiKey,
  OidcProviderConfig,
} from "./types.js";

// ── InMemory ────────────────────────────────────────────────────

export class InMemoryAuthStorage implements AuthStorage {
  private roles = new Map<string, Role>();
  private users = new Map<string, User>();
  private sessions = new Map<string, Session>();
  private apiKeys = new Map<string, ApiKey>();
  private oidcProviders = new Map<string, OidcProviderConfig>();

  async initialize(): Promise<void> {}

  // Roles
  async saveRole(role: Role): Promise<void> {
    this.roles.set(role.id, structuredClone(role));
  }
  async getRole(id: string): Promise<Role | null> {
    return this.roles.has(id) ? structuredClone(this.roles.get(id)!) : null;
  }
  async listRoles(): Promise<Role[]> {
    return [...this.roles.values()].map((r) => structuredClone(r));
  }
  async deleteRole(id: string): Promise<boolean> {
    return this.roles.delete(id);
  }

  // Users
  async saveUser(user: User): Promise<void> {
    this.users.set(user.id, structuredClone(user));
  }
  async getUser(id: string): Promise<User | null> {
    return this.users.has(id) ? structuredClone(this.users.get(id)!) : null;
  }
  async getUserByEmail(email: string): Promise<User | null> {
    for (const u of this.users.values()) {
      if (u.email === email) return structuredClone(u);
    }
    return null;
  }
  async getUserByExternalId(providerId: string, externalId: string): Promise<User | null> {
    for (const u of this.users.values()) {
      if (u.ssoProviderId === providerId && u.externalId === externalId) return structuredClone(u);
    }
    return null;
  }
  async listUsers(filters?: { role?: string; disabled?: boolean }): Promise<User[]> {
    let results = [...this.users.values()];
    if (filters?.role) results = results.filter((u) => u.roles.includes(filters.role!));
    if (filters?.disabled !== undefined) results = results.filter((u) => u.disabled === filters.disabled);
    return results.map((u) => structuredClone(u));
  }
  async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }

  // Sessions
  async saveSession(session: Session): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
  }
  async getSession(id: string): Promise<Session | null> {
    return this.sessions.has(id) ? structuredClone(this.sessions.get(id)!) : null;
  }
  async deleteSession(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }
  async deleteUserSessions(userId: string): Promise<number> {
    let count = 0;
    for (const [id, s] of this.sessions) {
      if (s.userId === userId) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }
  async pruneExpiredSessions(): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;
    for (const [id, s] of this.sessions) {
      if (s.expiresAt < now) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  // API Keys
  async saveApiKey(apiKey: ApiKey): Promise<void> {
    this.apiKeys.set(apiKey.id, structuredClone(apiKey));
  }
  async getApiKey(id: string): Promise<ApiKey | null> {
    return this.apiKeys.has(id) ? structuredClone(this.apiKeys.get(id)!) : null;
  }
  async getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    for (const k of this.apiKeys.values()) {
      if (k.keyHash === keyHash) return structuredClone(k);
    }
    return null;
  }
  async listApiKeys(userId: string): Promise<ApiKey[]> {
    return [...this.apiKeys.values()].filter((k) => k.userId === userId).map((k) => structuredClone(k));
  }
  async deleteApiKey(id: string): Promise<boolean> {
    return this.apiKeys.delete(id);
  }

  // OIDC
  async saveOidcProvider(config: OidcProviderConfig): Promise<void> {
    this.oidcProviders.set(config.id, structuredClone(config));
  }
  async getOidcProvider(id: string): Promise<OidcProviderConfig | null> {
    return this.oidcProviders.has(id) ? structuredClone(this.oidcProviders.get(id)!) : null;
  }
  async listOidcProviders(): Promise<OidcProviderConfig[]> {
    return [...this.oidcProviders.values()].map((p) => structuredClone(p));
  }
  async deleteOidcProvider(id: string): Promise<boolean> {
    return this.oidcProviders.delete(id);
  }

  async close(): Promise<void> {
    this.roles.clear();
    this.users.clear();
    this.sessions.clear();
    this.apiKeys.clear();
    this.oidcProviders.clear();
  }
}

// ── SQLite ──────────────────────────────────────────────────────

export class SQLiteAuthStorage implements AuthStorage {
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
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        permissions TEXT NOT NULL DEFAULT '[]',
        built_in INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        roles TEXT NOT NULL DEFAULT '[]',
        sso_provider_id TEXT,
        external_id TEXT,
        mfa_enabled INTEGER NOT NULL DEFAULT 0,
        mfa_secret TEXT,
        last_login_at TEXT,
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        user_id TEXT NOT NULL,
        permissions TEXT NOT NULL DEFAULT '[]',
        expires_at TEXT,
        last_used_at TEXT,
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oidc_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        issuer_url TEXT NOT NULL,
        client_id TEXT NOT NULL,
        client_secret TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '[]',
        callback_url TEXT NOT NULL,
        role_mappings TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_external ON users(sso_provider_id, external_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_apikeys_user ON api_keys(user_id);
    `);
  }

  // Roles
  async saveRole(role: Role): Promise<void> {
    this.db!.prepare(`INSERT OR REPLACE INTO roles (id, name, description, permissions, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(role.id, role.name, role.description, JSON.stringify(role.permissions), role.builtIn ? 1 : 0, role.createdAt, role.updatedAt);
  }
  async getRole(id: string): Promise<Role | null> {
    const row = this.db!.prepare("SELECT * FROM roles WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? { ...row, permissions: JSON.parse(row.permissions as string), builtIn: row.built_in === 1, createdAt: row.created_at, updatedAt: row.updated_at } as unknown as Role : null;
  }
  async listRoles(): Promise<Role[]> {
    const rows = this.db!.prepare("SELECT * FROM roles ORDER BY name").all() as Record<string, unknown>[];
    return rows.map((r) => ({ ...r, permissions: JSON.parse(r.permissions as string), builtIn: r.built_in === 1, createdAt: r.created_at, updatedAt: r.updated_at }) as unknown as Role);
  }
  async deleteRole(id: string): Promise<boolean> {
    return this.db!.prepare("DELETE FROM roles WHERE id = ? AND built_in = 0").run(id).changes > 0;
  }

  // Users
  async saveUser(user: User): Promise<void> {
    this.db!.prepare(`INSERT OR REPLACE INTO users (id, email, name, roles, sso_provider_id, external_id, mfa_enabled, mfa_secret, last_login_at, disabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, user.email, user.name, JSON.stringify(user.roles), user.ssoProviderId ?? null, user.externalId ?? null, user.mfaEnabled ? 1 : 0, user.mfaSecret ?? null, user.lastLoginAt ?? null, user.disabled ? 1 : 0, user.createdAt, user.updatedAt);
  }
  async getUser(id: string): Promise<User | null> {
    const row = this.db!.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToUser(row) : null;
  }
  async getUserByEmail(email: string): Promise<User | null> {
    const row = this.db!.prepare("SELECT * FROM users WHERE email = ?").get(email) as Record<string, unknown> | undefined;
    return row ? rowToUser(row) : null;
  }
  async getUserByExternalId(providerId: string, externalId: string): Promise<User | null> {
    const row = this.db!.prepare("SELECT * FROM users WHERE sso_provider_id = ? AND external_id = ?").get(providerId, externalId) as Record<string, unknown> | undefined;
    return row ? rowToUser(row) : null;
  }
  async listUsers(filters?: { role?: string; disabled?: boolean }): Promise<User[]> {
    let sql = "SELECT * FROM users";
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters?.disabled !== undefined) { clauses.push("disabled = ?"); params.push(filters.disabled ? 1 : 0); }
    if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
    sql += " ORDER BY name";
    let rows = this.db!.prepare(sql).all(...params) as Record<string, unknown>[];
    if (filters?.role) rows = rows.filter((r) => JSON.parse(r.roles as string).includes(filters.role));
    return rows.map(rowToUser);
  }
  async deleteUser(id: string): Promise<boolean> {
    return this.db!.prepare("DELETE FROM users WHERE id = ?").run(id).changes > 0;
  }

  // Sessions
  async saveSession(session: Session): Promise<void> {
    this.db!.prepare(`INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at, last_active_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(session.id, session.userId, session.tokenHash, session.expiresAt, session.createdAt, session.lastActiveAt, session.ipAddress ?? null, session.userAgent ?? null);
  }
  async getSession(id: string): Promise<Session | null> {
    const row = this.db!.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : null;
  }
  async deleteSession(id: string): Promise<boolean> {
    return this.db!.prepare("DELETE FROM sessions WHERE id = ?").run(id).changes > 0;
  }
  async deleteUserSessions(userId: string): Promise<number> {
    return this.db!.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId).changes;
  }
  async pruneExpiredSessions(): Promise<number> {
    return this.db!.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString()).changes;
  }

  // API Keys
  async saveApiKey(apiKey: ApiKey): Promise<void> {
    this.db!.prepare(`INSERT OR REPLACE INTO api_keys (id, name, key_hash, key_prefix, user_id, permissions, expires_at, last_used_at, disabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(apiKey.id, apiKey.name, apiKey.keyHash, apiKey.keyPrefix, apiKey.userId, JSON.stringify(apiKey.permissions), apiKey.expiresAt ?? null, apiKey.lastUsedAt ?? null, apiKey.disabled ? 1 : 0, apiKey.createdAt);
  }
  async getApiKey(id: string): Promise<ApiKey | null> {
    const row = this.db!.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToApiKey(row) : null;
  }
  async getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    const row = this.db!.prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(keyHash) as Record<string, unknown> | undefined;
    return row ? rowToApiKey(row) : null;
  }
  async listApiKeys(userId: string): Promise<ApiKey[]> {
    return (this.db!.prepare("SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Record<string, unknown>[]).map(rowToApiKey);
  }
  async deleteApiKey(id: string): Promise<boolean> {
    return this.db!.prepare("DELETE FROM api_keys WHERE id = ?").run(id).changes > 0;
  }

  // OIDC
  async saveOidcProvider(config: OidcProviderConfig): Promise<void> {
    this.db!.prepare(`INSERT OR REPLACE INTO oidc_providers (id, name, issuer_url, client_id, client_secret, scopes, callback_url, role_mappings, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(config.id, config.name, config.issuerUrl, config.clientId, config.clientSecret, JSON.stringify(config.scopes), config.callbackUrl, JSON.stringify(config.roleMappings), config.enabled ? 1 : 0, config.createdAt, config.updatedAt);
  }
  async getOidcProvider(id: string): Promise<OidcProviderConfig | null> {
    const row = this.db!.prepare("SELECT * FROM oidc_providers WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToOidc(row) : null;
  }
  async listOidcProviders(): Promise<OidcProviderConfig[]> {
    return (this.db!.prepare("SELECT * FROM oidc_providers ORDER BY name").all() as Record<string, unknown>[]).map(rowToOidc);
  }
  async deleteOidcProvider(id: string): Promise<boolean> {
    return this.db!.prepare("DELETE FROM oidc_providers WHERE id = ?").run(id).changes > 0;
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}

// ── Row Mappers ─────────────────────────────────────────────────

function rowToUser(r: Record<string, unknown>): User {
  return {
    id: r.id as string, email: r.email as string, name: r.name as string,
    roles: JSON.parse(r.roles as string),
    ssoProviderId: (r.sso_provider_id as string) ?? undefined,
    externalId: (r.external_id as string) ?? undefined,
    mfaEnabled: r.mfa_enabled === 1,
    mfaSecret: (r.mfa_secret as string) ?? undefined,
    lastLoginAt: (r.last_login_at as string) ?? undefined,
    disabled: r.disabled === 1,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

function rowToSession(r: Record<string, unknown>): Session {
  return {
    id: r.id as string, userId: r.user_id as string, tokenHash: r.token_hash as string,
    expiresAt: r.expires_at as string, createdAt: r.created_at as string,
    lastActiveAt: r.last_active_at as string,
    ipAddress: (r.ip_address as string) ?? undefined,
    userAgent: (r.user_agent as string) ?? undefined,
  };
}

function rowToApiKey(r: Record<string, unknown>): ApiKey {
  return {
    id: r.id as string, name: r.name as string, keyHash: r.key_hash as string,
    keyPrefix: r.key_prefix as string, userId: r.user_id as string,
    permissions: JSON.parse(r.permissions as string),
    expiresAt: (r.expires_at as string) ?? undefined,
    lastUsedAt: (r.last_used_at as string) ?? undefined,
    disabled: r.disabled === 1,
    createdAt: r.created_at as string,
  };
}

function rowToOidc(r: Record<string, unknown>): OidcProviderConfig {
  return {
    id: r.id as string, name: r.name as string, issuerUrl: r.issuer_url as string,
    clientId: r.client_id as string, clientSecret: r.client_secret as string,
    scopes: JSON.parse(r.scopes as string), callbackUrl: r.callback_url as string,
    roleMappings: JSON.parse(r.role_mappings as string),
    enabled: r.enabled === 1,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}
