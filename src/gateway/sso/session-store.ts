/**
 * Enterprise SSO — Session Store
 *
 * Manages SSO session lifecycle: creation, validation, refresh, expiry.
 * Provides both an in-memory store (dev/test) and a file-based store
 * (production, persists across gateway restarts).
 */

import type { SSOSession, SessionStore } from "./types.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";

// =============================================================================
// Session Token (JWT-like)
// =============================================================================

type SessionTokenOptions = {
  signingSecret?: string;
  allowUnsignedTokens?: boolean;
};

type SessionTokenPayload = {
  sid: string;
  sub: string;
  email: string;
  roles: string[];
  iat: number;
  exp: number;
};

function buildPayload(session: SSOSession): SessionTokenPayload {
  return {
    sid: session.id,
    sub: session.userId,
    email: session.email,
    roles: session.roles,
    iat: new Date(session.issuedAt).getTime(),
    exp: new Date(session.expiresAt).getTime(),
  };
}

function parsePayloadToResult(payload: SessionTokenPayload): {
  sessionId: string;
  userId: string;
  email: string;
  roles: string[];
  expired: boolean;
} | null {
  if (!payload.sid || !payload.sub) return null;

  return {
    sessionId: payload.sid,
    userId: payload.sub,
    email: payload.email ?? "",
    roles: payload.roles ?? [],
    expired: payload.exp < Date.now(),
  };
}

function decodePayload(payloadB64: string): SessionTokenPayload | null {
  try {
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    return JSON.parse(payloadJson) as SessionTokenPayload;
  } catch {
    return null;
  }
}

function signToken(payloadB64: string, signingSecret: string): string {
  const headerB64 = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = createHmac("sha256", signingSecret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

function verifySignedToken(token: string, signingSecret: string): SessionTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  let header: { alg?: string; typ?: string };
  try {
    const headerJson = Buffer.from(headerB64, "base64url").toString("utf8");
    header = JSON.parse(headerJson) as { alg?: string; typ?: string };
  } catch {
    return null;
  }

  if (header.alg !== "HS256" || header.typ !== "JWT") return null;

  const signingInput = `${headerB64}.${payloadB64}`;
  const expected = createHmac("sha256", signingSecret).update(signingInput).digest();
  const provided = Buffer.from(signatureB64, "base64url");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  return decodePayload(payloadB64);
}

/**
 * Create a session token from a session object.
 * Uses HMAC-SHA256 signed JWT-like tokens when signingSecret is configured.
 * Falls back to unsigned legacy payload tokens for compatibility.
 */
export function createSessionToken(session: SSOSession, opts?: SessionTokenOptions): string {
  const payloadB64 = Buffer.from(JSON.stringify(buildPayload(session))).toString("base64url");
  if (opts?.signingSecret) {
    return signToken(payloadB64, opts.signingSecret);
  }

  // Legacy compatibility format
  return payloadB64;
}

/**
 * Decode a session token and extract identity claims.
 * Supports signed JWT-like tokens and optional legacy unsigned token compatibility.
 */
export function decodeSessionToken(
  token: string,
  opts?: SessionTokenOptions,
): { sessionId: string; userId: string; email: string; roles: string[]; expired: boolean } | null {
  const signingSecret = opts?.signingSecret;
  const allowUnsignedTokens = opts?.allowUnsignedTokens ?? !signingSecret;

  if (signingSecret && token.includes(".")) {
    const payload = verifySignedToken(token, signingSecret);
    if (payload) {
      return parsePayloadToResult(payload);
    }
    if (!allowUnsignedTokens) {
      return null;
    }
  }

  if (!allowUnsignedTokens) {
    return null;
  }

  const payload = decodePayload(token);
  if (!payload) return null;
  return parsePayloadToResult(payload);
}

// =============================================================================
// In-Memory Session Store (dev/test)
// =============================================================================

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SSOSession>();

  async save(session: SSOSession): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async get(id: string): Promise<SSOSession | null> {
    const session = this.sessions.get(id);
    if (!session) return null;

    // Check expiry
    if (new Date(session.expiresAt) < new Date()) {
      this.sessions.delete(id);
      return null;
    }

    return { ...session };
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async listActive(): Promise<SSOSession[]> {
    const now = new Date();
    const active: SSOSession[] = [];

    for (const [id, session] of this.sessions) {
      if (new Date(session.expiresAt) < now) {
        this.sessions.delete(id);
      } else {
        active.push({ ...session });
      }
    }

    return active;
  }

  async getUserSessions(userId: string): Promise<SSOSession[]> {
    const sessions: SSOSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        sessions.push({ ...session });
      }
    }
    return sessions;
  }

  async deleteUserSessions(userId: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(id);
      }
    }
  }

  async prune(): Promise<number> {
    const now = new Date();
    let pruned = 0;

    for (const [id, session] of this.sessions) {
      if (new Date(session.expiresAt) < now) {
        this.sessions.delete(id);
        pruned++;
      }
    }

    return pruned;
  }
}

// =============================================================================
// File-Based Session Store (production)
// =============================================================================

/**
 * Persists sessions to a JSON file at `~/.espada/sso-sessions.json`.
 * Pruning happens on load and on explicit prune() calls.
 */
export class FileSessionStore implements SessionStore {
  private filePath: string;
  private sessions: Map<string, SSOSession>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.sessions = this.load();
  }

  private load(): Map<string, SSOSession> {
    if (!existsSync(this.filePath)) {
      return new Map();
    }

    try {
      const raw = readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw) as SSOSession[];
      const now = new Date();
      const map = new Map<string, SSOSession>();

      // Filter out expired on load
      for (const session of data) {
        if (new Date(session.expiresAt) >= now) {
          map.set(session.id, session);
        }
      }

      return map;
    } catch {
      return new Map();
    }
  }

  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const data = [...this.sessions.values()];
    const tmpPath = this.filePath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(tmpPath, this.filePath);
  }

  async save(session: SSOSession): Promise<void> {
    this.sessions.set(session.id, { ...session });
    this.persist();
  }

  async get(id: string): Promise<SSOSession | null> {
    const session = this.sessions.get(id);
    if (!session) return null;

    if (new Date(session.expiresAt) < new Date()) {
      this.sessions.delete(id);
      this.persist();
      return null;
    }

    return { ...session };
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
    this.persist();
  }

  async listActive(): Promise<SSOSession[]> {
    const now = new Date();
    const active: SSOSession[] = [];
    let changed = false;

    for (const [id, session] of this.sessions) {
      if (new Date(session.expiresAt) < now) {
        this.sessions.delete(id);
        changed = true;
      } else {
        active.push({ ...session });
      }
    }

    if (changed) this.persist();
    return active;
  }

  async getUserSessions(userId: string): Promise<SSOSession[]> {
    const sessions: SSOSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        sessions.push({ ...session });
      }
    }
    return sessions;
  }

  async deleteUserSessions(userId: string): Promise<void> {
    let changed = false;
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  async prune(): Promise<number> {
    const now = new Date();
    let pruned = 0;

    for (const [id, session] of this.sessions) {
      if (new Date(session.expiresAt) < now) {
        this.sessions.delete(id);
        pruned++;
      }
    }

    if (pruned > 0) this.persist();
    return pruned;
  }
}

// =============================================================================
// Session Manager (high-level API)
// =============================================================================

/**
 * High-level session management: validates tokens, touches sessions,
 * handles refresh, and provides session summary.
 */
export class SessionManager {
  private signingSecret?: string;
  private allowUnsignedTokens: boolean;

  constructor(
    private store: SessionStore,
    opts?: SessionTokenOptions,
  ) {
    this.signingSecret = opts?.signingSecret;
    this.allowUnsignedTokens = opts?.allowUnsignedTokens ?? !this.signingSecret;
  }

  decodeToken(token: string): {
    sessionId: string;
    userId: string;
    email: string;
    roles: string[];
    expired: boolean;
  } | null {
    return decodeSessionToken(token, {
      signingSecret: this.signingSecret,
      allowUnsignedTokens: this.allowUnsignedTokens,
    });
  }

  /**
   * Get a session by ID (raw lookup, no token parsing).
   * Returns null if session not found or expired.
   */
  async getSession(sessionId: string): Promise<SSOSession | null> {
    return this.store.get(sessionId);
  }

  /**
   * Update last activity timestamp for a session.
   */
  async touchSession(sessionId: string): Promise<void> {
    const session = await this.store.get(sessionId);
    if (session) {
      session.lastActivityAt = new Date().toISOString();
      await this.store.save(session);
    }
  }

  /**
   * Validate a session token and return the active session.
   * Returns null if token is invalid, expired, or session not found.
   */
  async validateToken(token: string): Promise<SSOSession | null> {
    const decoded = this.decodeToken(token);
    if (!decoded || decoded.expired) return null;

    const session = await this.store.get(decoded.sessionId);
    if (!session) return null;

    // Update last activity
    session.lastActivityAt = new Date().toISOString();
    await this.store.save(session);

    return session;
  }

  /**
   * Create a new session and return the session + token.
   */
  async createSession(session: SSOSession): Promise<{ session: SSOSession; token: string }> {
    await this.store.save(session);
    const token = createSessionToken(session, {
      signingSecret: this.signingSecret,
      allowUnsignedTokens: this.allowUnsignedTokens,
    });
    return { session, token };
  }

  /**
   * End a session (logout).
   */
  async endSession(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
  }

  /**
   * End all sessions for a user (force logout everywhere).
   */
  async endAllUserSessions(userId: string): Promise<void> {
    await this.store.deleteUserSessions(userId);
  }

  /**
   * Get session summary for CLI/admin display.
   */
  async getSummary(): Promise<{
    activeSessions: number;
    users: { userId: string; email: string; sessionCount: number; lastActivity: string }[];
  }> {
    const active = await this.store.listActive();
    const userMap = new Map<string, { email: string; count: number; lastActivity: string }>();

    for (const session of active) {
      const existing = userMap.get(session.userId);
      if (existing) {
        existing.count++;
        if (session.lastActivityAt > existing.lastActivity) {
          existing.lastActivity = session.lastActivityAt;
        }
      } else {
        userMap.set(session.userId, {
          email: session.email,
          count: 1,
          lastActivity: session.lastActivityAt,
        });
      }
    }

    return {
      activeSessions: active.length,
      users: [...userMap.entries()].map(([userId, info]) => ({
        userId,
        email: info.email,
        sessionCount: info.count,
        lastActivity: info.lastActivity,
      })),
    };
  }

  /** Prune expired sessions. */
  async prune(): Promise<number> {
    return this.store.prune();
  }
}
