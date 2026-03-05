/**
 * Gateway HA/Clustering — Leader Election & Instance Coordination
 *
 * Enables multiple gateway instances to coordinate via a shared
 * SQLite database (for single-host multi-process) or file-based
 * locks (for simple deployments). For multi-host clustering,
 * a Redis-based implementation can be plugged in.
 *
 * Features:
 * - Leader election with heartbeat-based lease renewal
 * - Instance registry with health status
 * - Fencing tokens to prevent split-brain writes
 * - Graceful leader handoff on shutdown
 * - HTTP health/ready endpoints for load balancer integration
 *
 */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { EventEmitter } from "node:events";

// =============================================================================
// Types
// =============================================================================

export type InstanceRole = "leader" | "follower" | "candidate";
export type InstanceHealth = "healthy" | "degraded" | "unhealthy" | "draining";

export interface ClusterInstance {
  /** Unique instance ID (UUID) */
  id: string;

  /** Human-readable instance name */
  name: string;

  /** Hostname */
  hostname: string;

  /** Bind address + port */
  address: string;

  /** Current role */
  role: InstanceRole;

  /** Health status */
  health: InstanceHealth;

  /** Monotonically increasing fencing token (only valid for leader) */
  fencingToken: number;

  /** ISO timestamp of last heartbeat */
  lastHeartbeat: string;

  /** ISO timestamp of registration */
  registeredAt: string;

  /** Metadata tags */
  metadata: Record<string, string>;
}

export interface LeaderLease {
  /** Instance ID holding the lease */
  instanceId: string;

  /** Fencing token for this lease term */
  fencingToken: number;

  /** Lease acquired at */
  acquiredAt: string;

  /** Lease expires at (must be renewed before this) */
  expiresAt: string;
}

export interface ClusterConfig {
  /** Unique instance ID (auto-generated if omitted) */
  instanceId?: string;

  /** Instance name (defaults to hostname) */
  instanceName?: string;

  /** Bind address for this instance */
  address: string;

  /** Heartbeat interval in ms (default: 5000) */
  heartbeatIntervalMs?: number;

  /** Leader lease TTL in ms (default: 15000) */
  leaseTtlMs?: number;

  /** How long to wait before declaring an instance dead (default: 30000) */
  instanceTimeoutMs?: number;

  /** Additional metadata for this instance */
  metadata?: Record<string, string>;
}

export type ClusterEvent =
  | { type: "leader-elected"; instanceId: string; fencingToken: number }
  | { type: "leader-lost"; instanceId: string }
  | { type: "instance-joined"; instance: ClusterInstance }
  | { type: "instance-left"; instanceId: string }
  | { type: "instance-unhealthy"; instanceId: string }
  | { type: "role-changed"; instanceId: string; from: InstanceRole; to: InstanceRole };

// =============================================================================
// ClusterCoordinator
// =============================================================================

export class ClusterCoordinator extends EventEmitter {
  private db: Database.Database;
  private config: Required<Omit<ClusterConfig, "metadata">> & { metadata: Record<string, string> };
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private electionTimer: ReturnType<typeof setInterval> | null = null;
  private isClosing = false;
  private _role: InstanceRole = "follower";
  private _fencingToken = 0;

  constructor(dbPath: string, config: ClusterConfig) {
    super();

    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.config = {
      instanceId: config.instanceId ?? randomUUID(),
      instanceName: config.instanceName ?? hostname(),
      address: config.address,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 5_000,
      leaseTtlMs: config.leaseTtlMs ?? 15_000,
      instanceTimeoutMs: config.instanceTimeoutMs ?? 30_000,
      metadata: config.metadata ?? {},
    };

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");

    this.createTables();
  }

  get instanceId(): string {
    return this.config.instanceId;
  }

  get role(): InstanceRole {
    return this._role;
  }

  get isLeader(): boolean {
    return this._role === "leader";
  }

  get fencingToken(): number {
    return this._fencingToken;
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cluster_instances (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        hostname        TEXT NOT NULL,
        address         TEXT NOT NULL,
        role            TEXT NOT NULL DEFAULT 'follower',
        health          TEXT NOT NULL DEFAULT 'healthy',
        fencing_token   INTEGER NOT NULL DEFAULT 0,
        last_heartbeat  TEXT NOT NULL,
        registered_at   TEXT NOT NULL,
        metadata        TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS leader_lease (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        instance_id     TEXT NOT NULL,
        fencing_token   INTEGER NOT NULL,
        acquired_at     TEXT NOT NULL,
        expires_at      TEXT NOT NULL,
        FOREIGN KEY (instance_id) REFERENCES cluster_instances(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS cluster_fencing_seq (
        id    INTEGER PRIMARY KEY CHECK (id = 1),
        value INTEGER NOT NULL DEFAULT 0
      );

      INSERT OR IGNORE INTO cluster_fencing_seq (id, value) VALUES (1, 0);
    `);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the cluster coordinator. Registers this instance and begins
   * heartbeat + election loops.
   */
  async start(): Promise<void> {
    const now = new Date().toISOString();

    // Register this instance
    this.db
      .prepare(`
        INSERT INTO cluster_instances (id, name, hostname, address, role, health, last_heartbeat, registered_at, metadata)
        VALUES (?, ?, ?, ?, 'follower', 'healthy', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          hostname = excluded.hostname,
          address = excluded.address,
          health = 'healthy',
          last_heartbeat = excluded.last_heartbeat,
          metadata = excluded.metadata
      `)
      .run(
        this.config.instanceId,
        this.config.instanceName,
        hostname(),
        this.config.address,
        now,
        now,
        JSON.stringify(this.config.metadata),
      );

    this.emit("event", {
      type: "instance-joined",
      instance: this.getSelf()!,
    } satisfies ClusterEvent);

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatIntervalMs);

    // Start election loop
    this.electionTimer = setInterval(() => {
      this.runElection();
    }, this.config.heartbeatIntervalMs * 2);

    // Run initial election immediately
    this.runElection();
  }

  /**
   * Gracefully leave the cluster.
   */
  async stop(): Promise<void> {
    this.isClosing = true;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.electionTimer) {
      clearInterval(this.electionTimer);
      this.electionTimer = null;
    }

    // If we're the leader, release the lease
    if (this._role === "leader") {
      this.db.prepare("DELETE FROM leader_lease WHERE instance_id = ?").run(this.config.instanceId);
      this.emit("event", {
        type: "leader-lost",
        instanceId: this.config.instanceId,
      } satisfies ClusterEvent);
    }

    // Mark as draining, then remove
    this.db
      .prepare("UPDATE cluster_instances SET health = 'draining', role = 'follower' WHERE id = ?")
      .run(this.config.instanceId);

    // Deregister after a short delay to allow others to see the draining state
    this.db.prepare("DELETE FROM cluster_instances WHERE id = ?").run(this.config.instanceId);

    this.emit("event", {
      type: "instance-left",
      instanceId: this.config.instanceId,
    } satisfies ClusterEvent);

    this.db.close();
  }

  // ===========================================================================
  // Heartbeat
  // ===========================================================================

  private sendHeartbeat(): void {
    if (this.isClosing) return;

    const now = new Date().toISOString();

    this.db
      .prepare("UPDATE cluster_instances SET last_heartbeat = ?, health = 'healthy' WHERE id = ?")
      .run(now, this.config.instanceId);

    // Prune dead instances
    this.pruneDeadInstances();
  }

  private pruneDeadInstances(): void {
    const cutoff = new Date(Date.now() - this.config.instanceTimeoutMs).toISOString();

    const dead = this.db
      .prepare("SELECT id FROM cluster_instances WHERE last_heartbeat < ? AND id != ?")
      .all(cutoff, this.config.instanceId) as Array<{ id: string }>;

    for (const { id } of dead) {
      this.db.prepare("DELETE FROM cluster_instances WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM leader_lease WHERE instance_id = ?").run(id);

      this.emit("event", {
        type: "instance-left",
        instanceId: id,
      } satisfies ClusterEvent);
    }
  }

  // ===========================================================================
  // Leader Election
  // ===========================================================================

  private runElection(): void {
    if (this.isClosing) return;

    const now = new Date().toISOString();

    // Check current lease
    const lease = this.db.prepare("SELECT * FROM leader_lease WHERE id = 1").get() as
      | LeaseRow
      | undefined;

    if (lease && lease.expires_at > now) {
      // Lease is valid
      if (lease.instance_id === this.config.instanceId) {
        // We're the leader — renew lease
        this.renewLease();
      } else {
        // Someone else is leader
        if (this._role !== "follower") {
          const prev = this._role;
          this._role = "follower";
          this.updateRole("follower");
          this.emit("event", {
            type: "role-changed",
            instanceId: this.config.instanceId,
            from: prev,
            to: "follower",
          } satisfies ClusterEvent);
        }
      }
    } else {
      // No valid lease — attempt to acquire
      this.attemptAcquireLease(now);
    }
  }

  private renewLease(): void {
    const expiresAt = new Date(Date.now() + this.config.leaseTtlMs).toISOString();

    this.db
      .prepare("UPDATE leader_lease SET expires_at = ? WHERE id = 1 AND instance_id = ?")
      .run(expiresAt, this.config.instanceId);
  }

  private attemptAcquireLease(now: string): void {
    // Use a transaction to atomically grab the lease
    const txn = this.db.transaction(() => {
      // Increment fencing token
      this.db.prepare("UPDATE cluster_fencing_seq SET value = value + 1 WHERE id = 1").run();
      const tokenRow = this.db
        .prepare("SELECT value FROM cluster_fencing_seq WHERE id = 1")
        .get() as { value: number };
      const fencingToken = tokenRow.value;

      const expiresAt = new Date(Date.now() + this.config.leaseTtlMs).toISOString();

      // Upsert lease (only if expired or doesn't exist)
      const existing = this.db.prepare("SELECT expires_at FROM leader_lease WHERE id = 1").get() as
        | { expires_at: string }
        | undefined;

      if (existing && existing.expires_at > now) {
        // Someone else grabbed it first (race condition) — stay follower
        return null;
      }

      this.db
        .prepare(`
          INSERT INTO leader_lease (id, instance_id, fencing_token, acquired_at, expires_at)
          VALUES (1, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            instance_id = excluded.instance_id,
            fencing_token = excluded.fencing_token,
            acquired_at = excluded.acquired_at,
            expires_at = excluded.expires_at
        `)
        .run(this.config.instanceId, fencingToken, now, expiresAt);

      return fencingToken;
    });

    const newToken = txn();
    if (newToken !== null) {
      const prevRole = this._role;
      this._role = "leader";
      this._fencingToken = newToken;
      this.updateRole("leader");

      this.emit("event", {
        type: "leader-elected",
        instanceId: this.config.instanceId,
        fencingToken: newToken,
      } satisfies ClusterEvent);

      if (prevRole !== "leader") {
        this.emit("event", {
          type: "role-changed",
          instanceId: this.config.instanceId,
          from: prevRole,
          to: "leader",
        } satisfies ClusterEvent);
      }
    }
  }

  private updateRole(role: InstanceRole): void {
    this.db
      .prepare("UPDATE cluster_instances SET role = ?, fencing_token = ? WHERE id = ?")
      .run(role, this._fencingToken, this.config.instanceId);
  }

  // ===========================================================================
  // Query
  // ===========================================================================

  /** Get information about this instance. */
  getSelf(): ClusterInstance | null {
    const row = this.db
      .prepare("SELECT * FROM cluster_instances WHERE id = ?")
      .get(this.config.instanceId) as InstanceRow | undefined;
    return row ? rowToInstance(row) : null;
  }

  /** Get all instances in the cluster. */
  getInstances(): ClusterInstance[] {
    const rows = this.db
      .prepare("SELECT * FROM cluster_instances ORDER BY registered_at ASC")
      .all() as InstanceRow[];
    return rows.map(rowToInstance);
  }

  /** Get the current leader (if any). */
  getLeader(): ClusterInstance | null {
    const lease = this.db.prepare("SELECT * FROM leader_lease WHERE id = 1").get() as
      | LeaseRow
      | undefined;

    if (!lease || lease.expires_at <= new Date().toISOString()) {
      return null;
    }

    const row = this.db
      .prepare("SELECT * FROM cluster_instances WHERE id = ?")
      .get(lease.instance_id) as InstanceRow | undefined;

    return row ? rowToInstance(row) : null;
  }

  /** Get the current lease. */
  getLease(): LeaderLease | null {
    const row = this.db.prepare("SELECT * FROM leader_lease WHERE id = 1").get() as
      | LeaseRow
      | undefined;

    if (!row) return null;

    return {
      instanceId: row.instance_id,
      fencingToken: row.fencing_token,
      acquiredAt: row.acquired_at,
      expiresAt: row.expires_at,
    };
  }

  /** Update this instance's health status. */
  setHealth(health: InstanceHealth): void {
    this.db
      .prepare("UPDATE cluster_instances SET health = ? WHERE id = ?")
      .run(health, this.config.instanceId);

    if (health === "unhealthy") {
      this.emit("event", {
        type: "instance-unhealthy",
        instanceId: this.config.instanceId,
      } satisfies ClusterEvent);
    }
  }

  // ===========================================================================
  // HTTP Health Endpoints
  // ===========================================================================

  /**
   * Generate a health check response suitable for load balancer probes.
   * Returns `{ status, statusCode, body }`.
   */
  healthCheck(): {
    status: "ok" | "degraded" | "unhealthy";
    statusCode: number;
    body: Record<string, unknown>;
  } {
    const self = this.getSelf();
    const instances = this.getInstances();
    const leader = this.getLeader();

    const healthyCount = instances.filter((i) => i.health === "healthy").length;
    const status =
      !self || self.health === "unhealthy"
        ? "unhealthy"
        : self.health === "degraded" || healthyCount < instances.length
          ? "degraded"
          : "ok";

    return {
      status,
      statusCode: status === "unhealthy" ? 503 : 200,
      body: {
        status,
        instanceId: this.config.instanceId,
        role: this._role,
        fencingToken: this._fencingToken,
        leader: leader ? { id: leader.id, name: leader.name, address: leader.address } : null,
        cluster: {
          total: instances.length,
          healthy: healthyCount,
          instances: instances.map((i) => ({
            id: i.id,
            name: i.name,
            role: i.role,
            health: i.health,
            address: i.address,
          })),
        },
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Readiness check — returns true only if this instance is registered,
   * healthy, and the cluster has a valid leader.
   */
  readinessCheck(): { ready: boolean; statusCode: number; reason?: string } {
    const self = this.getSelf();
    if (!self) return { ready: false, statusCode: 503, reason: "not registered" };
    if (self.health === "unhealthy") return { ready: false, statusCode: 503, reason: "unhealthy" };
    if (self.health === "draining") return { ready: false, statusCode: 503, reason: "draining" };

    const leader = this.getLeader();
    if (!leader) return { ready: false, statusCode: 503, reason: "no leader" };

    return { ready: true, statusCode: 200 };
  }
}

// =============================================================================
// Row types
// =============================================================================

type InstanceRow = {
  id: string;
  name: string;
  hostname: string;
  address: string;
  role: string;
  health: string;
  fencing_token: number;
  last_heartbeat: string;
  registered_at: string;
  metadata: string;
};

type LeaseRow = {
  id: number;
  instance_id: string;
  fencing_token: number;
  acquired_at: string;
  expires_at: string;
};

function rowToInstance(row: InstanceRow): ClusterInstance {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    address: row.address,
    role: row.role as InstanceRole,
    health: row.health as InstanceHealth,
    fencingToken: row.fencing_token,
    lastHeartbeat: row.last_heartbeat,
    registeredAt: row.registered_at,
    metadata: (() => {
      try {
        return JSON.parse(row.metadata) as Record<string, string>;
      } catch {
        return {};
      }
    })(),
  };
}
