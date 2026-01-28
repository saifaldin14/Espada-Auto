/**
 * Infrastructure Session State Management
 *
 * This module provides comprehensive session state management for
 * infrastructure operations, including persistence, lifecycle
 * management, and context tracking.
 */

import type {
  InfrastructureProviderMeta,
  PendingOperation,
  ProviderAuthConfig,
  ResourceState,
  SessionConfig,
  SessionContext,
  SessionHistoryEntry,
  SessionState,
} from "../types.js";
import type { InfrastructureLogger } from "../logging/logger.js";

// =============================================================================
// Session Manager Types
// =============================================================================

/**
 * Session creation options
 */
export type CreateSessionOptions = {
  providerId: string;
  providerMeta: InfrastructureProviderMeta;
  auth: ProviderAuthConfig;
  userId?: string;
  ttl?: number;
  metadata?: Record<string, unknown>;
};

/**
 * Session update options
 */
export type UpdateSessionOptions = {
  extend?: boolean;
  metadata?: Record<string, unknown>;
};

/**
 * Session query options
 */
export type SessionQueryOptions = {
  providerId?: string;
  userId?: string;
  state?: SessionState["state"] | SessionState["state"][];
  includeExpired?: boolean;
};

/**
 * Session storage interface
 */
export interface SessionStorage {
  save(session: SessionState): Promise<void>;
  load(sessionId: string): Promise<SessionState | null>;
  delete(sessionId: string): Promise<void>;
  query(options: SessionQueryOptions): Promise<SessionState[]>;
  clear(): Promise<void>;
}

// =============================================================================
// In-Memory Session Storage
// =============================================================================

/**
 * In-memory session storage implementation
 */
export class InMemorySessionStorage implements SessionStorage {
  private sessions: Map<string, SessionState> = new Map();

  async save(session: SessionState): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async load(sessionId: string): Promise<SessionState | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async query(options: SessionQueryOptions): Promise<SessionState[]> {
    const results: SessionState[] = [];
    const now = new Date();

    for (const session of this.sessions.values()) {
      // Filter by provider
      if (options.providerId && session.providerId !== options.providerId) continue;

      // Filter by user
      if (options.userId && session.userId !== options.userId) continue;

      // Filter by state
      if (options.state) {
        const states = Array.isArray(options.state) ? options.state : [options.state];
        if (!states.includes(session.state)) continue;
      }

      // Filter expired unless explicitly included
      if (!options.includeExpired && session.expiresAt < now) continue;

      results.push(session);
    }

    return results;
  }

  async clear(): Promise<void> {
    this.sessions.clear();
  }
}

// =============================================================================
// File-Based Session Storage
// =============================================================================

/**
 * File-based session storage implementation
 */
export class FileSessionStorage implements SessionStorage {
  private directory: string;
  private initialized = false;

  constructor(directory: string) {
    this.directory = directory;
  }

  private async ensureDirectory(): Promise<void> {
    if (this.initialized) return;
    const fs = await import("node:fs/promises");
    await fs.mkdir(this.directory, { recursive: true });
    this.initialized = true;
  }

  private getFilePath(sessionId: string): string {
    return `${this.directory}/${sessionId}.json`;
  }

  async save(session: SessionState): Promise<void> {
    await this.ensureDirectory();
    const fs = await import("node:fs/promises");
    const data = JSON.stringify(serializeSession(session), null, 2);
    await fs.writeFile(this.getFilePath(session.id), data, "utf-8");
  }

  async load(sessionId: string): Promise<SessionState | null> {
    await this.ensureDirectory();
    const fs = await import("node:fs/promises");
    try {
      const data = await fs.readFile(this.getFilePath(sessionId), "utf-8");
      return deserializeSession(JSON.parse(data));
    } catch {
      return null;
    }
  }

  async delete(sessionId: string): Promise<void> {
    await this.ensureDirectory();
    const fs = await import("node:fs/promises");
    try {
      await fs.unlink(this.getFilePath(sessionId));
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async query(options: SessionQueryOptions): Promise<SessionState[]> {
    await this.ensureDirectory();
    const fs = await import("node:fs/promises");
    const results: SessionState[] = [];
    const now = new Date();

    try {
      const files = await fs.readdir(this.directory);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        const sessionId = file.replace(".json", "");
        const session = await this.load(sessionId);
        if (!session) continue;

        // Apply filters
        if (options.providerId && session.providerId !== options.providerId) continue;
        if (options.userId && session.userId !== options.userId) continue;
        if (options.state) {
          const states = Array.isArray(options.state) ? options.state : [options.state];
          if (!states.includes(session.state)) continue;
        }
        if (!options.includeExpired && session.expiresAt < now) continue;

        results.push(session);
      }
    } catch {
      // Directory might not exist
    }

    return results;
  }

  async clear(): Promise<void> {
    await this.ensureDirectory();
    const fs = await import("node:fs/promises");
    try {
      const files = await fs.readdir(this.directory);
      await Promise.all(
        files.filter((f) => f.endsWith(".json")).map((f) => fs.unlink(`${this.directory}/${f}`)),
      );
    } catch {
      // Ignore errors
    }
  }
}

// =============================================================================
// Session Serialization
// =============================================================================

type SerializedSession = {
  id: string;
  providerId: string;
  userId?: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  state: SessionState["state"];
  context: {
    provider: InfrastructureProviderMeta;
    auth: ProviderAuthConfig;
    resources: Array<[string, ResourceState]>;
    variables: Array<[string, unknown]>;
    pendingOperations: PendingOperation[];
  };
  history: Array<{
    timestamp: string;
    type: SessionHistoryEntry["type"];
    data: Record<string, unknown>;
  }>;
};

function serializeSession(session: SessionState): SerializedSession {
  return {
    ...session,
    createdAt: session.createdAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    context: {
      ...session.context,
      resources: Array.from(session.context.resources.entries()),
      variables: Array.from(session.context.variables.entries()),
    },
    history: session.history.map((h) => ({
      ...h,
      timestamp: h.timestamp.toISOString(),
    })),
  };
}

function deserializeSession(data: SerializedSession): SessionState {
  return {
    ...data,
    createdAt: new Date(data.createdAt),
    lastActivityAt: new Date(data.lastActivityAt),
    expiresAt: new Date(data.expiresAt),
    context: {
      ...data.context,
      resources: new Map(data.context.resources),
      variables: new Map(data.context.variables),
    },
    history: data.history.map((h) => ({
      ...h,
      timestamp: new Date(h.timestamp),
    })),
  };
}

// =============================================================================
// Session Manager Implementation
// =============================================================================

/**
 * Infrastructure session manager
 */
export class InfrastructureSessionManager {
  private storage: SessionStorage;
  private config: SessionConfig;
  private logger: InfrastructureLogger;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: {
    storage?: SessionStorage;
    config: SessionConfig;
    logger: InfrastructureLogger;
  }) {
    this.storage =
      options.storage ??
      (options.config.stateDirectory
        ? new FileSessionStorage(options.config.stateDirectory)
        : new InMemorySessionStorage());
    this.config = options.config;
    this.logger = options.logger;
  }

  /**
   * Start the session manager
   */
  start(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      void this.cleanupExpiredSessions();
    }, this.config.cleanupInterval);

    this.logger.info("Session manager started", {
      cleanupInterval: this.config.cleanupInterval,
    });
  }

  /**
   * Stop the session manager
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.logger.info("Session manager stopped");
  }

  /**
   * Create a new session
   */
  async createSession(options: CreateSessionOptions): Promise<SessionState> {
    // Check concurrent session limit
    const activeSessions = await this.storage.query({
      providerId: options.providerId,
      state: ["active", "idle"],
    });

    if (activeSessions.length >= this.config.maxConcurrent) {
      throw new Error(
        `Maximum concurrent sessions (${this.config.maxConcurrent}) reached for provider ${options.providerId}`,
      );
    }

    const now = new Date();
    const ttl = options.ttl ?? this.config.timeout;
    const sessionId = generateSessionId();

    const session: SessionState = {
      id: sessionId,
      providerId: options.providerId,
      userId: options.userId,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + ttl),
      state: "active",
      context: {
        provider: options.providerMeta,
        auth: options.auth,
        resources: new Map(),
        variables: new Map(Object.entries(options.metadata ?? {})),
        pendingOperations: [],
      },
      history: [
        {
          timestamp: now,
          type: "state-change",
          data: { from: null, to: "active" },
        },
      ],
    };

    await this.storage.save(session);
    this.logger.info(`Session created: ${sessionId}`, {
      providerId: options.providerId,
      userId: options.userId,
    });

    return session;
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<SessionState | null> {
    const session = await this.storage.load(sessionId);
    if (!session) return null;

    // Check if expired
    if (session.expiresAt < new Date() && session.state !== "expired") {
      await this.expireSession(sessionId);
      return this.storage.load(sessionId);
    }

    return session;
  }

  /**
   * Update session activity
   */
  async touchSession(sessionId: string, options?: UpdateSessionOptions): Promise<SessionState | null> {
    const session = await this.getSession(sessionId);
    if (!session || session.state === "expired" || session.state === "terminated") {
      return null;
    }

    const now = new Date();
    session.lastActivityAt = now;

    if (options?.extend) {
      session.expiresAt = new Date(now.getTime() + this.config.timeout);
    }

    if (options?.metadata) {
      for (const [key, value] of Object.entries(options.metadata)) {
        session.context.variables.set(key, value);
      }
    }

    await this.storage.save(session);
    return session;
  }

  /**
   * Add a resource to the session
   */
  async addResource(sessionId: string, resource: ResourceState): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.context.resources.set(resource.id, resource);
    session.lastActivityAt = new Date();
    session.history.push({
      timestamp: new Date(),
      type: "event",
      data: { event: "resource_added", resourceId: resource.id, resourceType: resource.type },
    });

    await this.storage.save(session);
  }

  /**
   * Update a resource in the session
   */
  async updateResource(sessionId: string, resource: ResourceState): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.context.resources.set(resource.id, resource);
    session.lastActivityAt = new Date();

    await this.storage.save(session);
  }

  /**
   * Remove a resource from the session
   */
  async removeResource(sessionId: string, resourceId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.context.resources.delete(resourceId);
    session.lastActivityAt = new Date();
    session.history.push({
      timestamp: new Date(),
      type: "event",
      data: { event: "resource_removed", resourceId },
    });

    await this.storage.save(session);
  }

  /**
   * Add a pending operation
   */
  async addPendingOperation(sessionId: string, operation: PendingOperation): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.context.pendingOperations.push(operation);
    session.lastActivityAt = new Date();

    await this.storage.save(session);
  }

  /**
   * Update a pending operation
   */
  async updatePendingOperation(
    sessionId: string,
    operationId: string,
    updates: Partial<PendingOperation>,
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const operation = session.context.pendingOperations.find((op) => op.id === operationId);
    if (operation) {
      Object.assign(operation, updates);
      session.lastActivityAt = new Date();
      await this.storage.save(session);
    }
  }

  /**
   * Remove a pending operation
   */
  async removePendingOperation(sessionId: string, operationId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.context.pendingOperations = session.context.pendingOperations.filter(
      (op) => op.id !== operationId,
    );
    session.lastActivityAt = new Date();

    await this.storage.save(session);
  }

  /**
   * Add a history entry
   */
  async addHistoryEntry(sessionId: string, entry: Omit<SessionHistoryEntry, "timestamp">): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.history.push({
      ...entry,
      timestamp: new Date(),
    });
    session.lastActivityAt = new Date();

    await this.storage.save(session);
  }

  /**
   * Set session state to idle
   */
  async idleSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session || session.state !== "active") return;

    const previousState = session.state;
    session.state = "idle";
    session.history.push({
      timestamp: new Date(),
      type: "state-change",
      data: { from: previousState, to: "idle" },
    });

    await this.storage.save(session);
    this.logger.debug(`Session set to idle: ${sessionId}`);
  }

  /**
   * Reactivate an idle session
   */
  async activateSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session || (session.state !== "idle" && session.state !== "active")) return;

    const previousState = session.state;
    session.state = "active";
    session.lastActivityAt = new Date();
    session.history.push({
      timestamp: new Date(),
      type: "state-change",
      data: { from: previousState, to: "active" },
    });

    await this.storage.save(session);
    this.logger.debug(`Session activated: ${sessionId}`);
  }

  /**
   * Expire a session
   */
  async expireSession(sessionId: string): Promise<void> {
    const session = await this.storage.load(sessionId);
    if (!session || session.state === "expired" || session.state === "terminated") return;

    const previousState = session.state;
    session.state = "expired";
    session.history.push({
      timestamp: new Date(),
      type: "state-change",
      data: { from: previousState, to: "expired" },
    });

    await this.storage.save(session);
    this.logger.info(`Session expired: ${sessionId}`);
  }

  /**
   * Terminate a session
   */
  async terminateSession(sessionId: string): Promise<void> {
    const session = await this.storage.load(sessionId);
    if (!session || session.state === "terminated") return;

    const previousState = session.state;
    session.state = "terminated";
    session.history.push({
      timestamp: new Date(),
      type: "state-change",
      data: { from: previousState, to: "terminated" },
    });

    await this.storage.save(session);
    this.logger.info(`Session terminated: ${sessionId}`);
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.storage.delete(sessionId);
    this.logger.debug(`Session deleted: ${sessionId}`);
  }

  /**
   * Query sessions
   */
  async querySessions(options: SessionQueryOptions): Promise<SessionState[]> {
    return this.storage.query(options);
  }

  /**
   * Clean up expired sessions
   */
  private async cleanupExpiredSessions(): Promise<void> {
    const expired = await this.storage.query({
      state: "expired",
      includeExpired: true,
    });

    for (const session of expired) {
      if (this.config.persistState) {
        // Keep the session data but mark as terminated
        await this.terminateSession(session.id);
      } else {
        await this.deleteSession(session.id);
      }
    }

    if (expired.length > 0) {
      this.logger.debug(`Cleaned up ${expired.length} expired sessions`);
    }
  }

  /**
   * Get session statistics
   */
  async getStatistics(): Promise<SessionStatistics> {
    const all = await this.storage.query({ includeExpired: true });
    const byState = new Map<SessionState["state"], number>();
    const byProvider = new Map<string, number>();

    for (const session of all) {
      byState.set(session.state, (byState.get(session.state) ?? 0) + 1);
      byProvider.set(session.providerId, (byProvider.get(session.providerId) ?? 0) + 1);
    }

    return {
      total: all.length,
      byState: Object.fromEntries(byState),
      byProvider: Object.fromEntries(byProvider),
      active: byState.get("active") ?? 0,
      idle: byState.get("idle") ?? 0,
      expired: byState.get("expired") ?? 0,
      terminated: byState.get("terminated") ?? 0,
    };
  }
}

/**
 * Session statistics
 */
export type SessionStatistics = {
  total: number;
  byState: Record<string, number>;
  byProvider: Record<string, number>;
  active: number;
  idle: number;
  expired: number;
  terminated: number;
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `sess_${timestamp}_${random}`;
}

/**
 * Create a session manager
 */
export function createSessionManager(options: {
  config: SessionConfig;
  logger: InfrastructureLogger;
  storage?: SessionStorage;
}): InfrastructureSessionManager {
  return new InfrastructureSessionManager(options);
}
