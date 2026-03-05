/**
 * Enterprise Feature Bootstrap
 *
 * Single initialization point for all enterprise gateway subsystems.
 * Called from startGatewayServer() after the base runtime is configured.
 *
 * Each subsystem is opt-in via config (gateway.enterprise.*).
 * When a subsystem is not configured, its field is null.
 *
 */

import { join } from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("enterprise");
import { AuditLogPipeline, type AuditSinkConfig } from "../audit/index.js";
import { EventBus } from "../event-bus/index.js";
import { ClusterCoordinator } from "../cluster/index.js";
import { DisasterRecoveryManager } from "../dr/index.js";
import { VersionedRouter, type ApiVersion } from "../api-version/index.js";
import { createSecretsManager, type SecretsManager } from "../secrets/index.js";
import { DriftReconciliationEngine } from "../drift/index.js";
import { ConfigFileDriftScanner, EnvVarDriftScanner } from "../drift/index.js";
import { ServiceMeshManager } from "../mesh/index.js";
import { LocalMeshAdapter } from "../mesh/index.js";
import { DurableTaskQueue } from "../task-queue/index.js";
import { SQLiteRateLimitStore } from "../state/index.js";
import { SQLiteDedupStore } from "../state/index.js";
import { validateEnterpriseConfig } from "./validate-config.js";

// =============================================================================
// Config Types
// =============================================================================

export interface EnterpriseConfig {
  /** Enable persistent SQLite backends for rate-limit and dedup */
  persistentState?: {
    enabled?: boolean;
    /** SQLite DB directory (default: <stateDir>/enterprise/) */
    dbDir?: string;
  };

  /** Audit log pipeline */
  audit?: {
    enabled?: boolean;
    /** Minimum severity to log (default: "info") */
    minSeverity?: "info" | "warn" | "error" | "critical";
    /** Sinks configuration */
    sinks?: AuditSinkConfig[];
    /** Max days to retain (0 = unlimited) */
    retentionDays?: number;
  };

  /** Event bus / webhook delivery */
  eventBus?: {
    enabled?: boolean;
  };

  /** Cluster coordination / HA */
  cluster?: {
    enabled?: boolean;
    /** Gateway address (host:port) advertised to peers */
    address?: string;
    /** Instance name (default: hostname) */
    instanceName?: string;
    /** Lease TTL in ms (default: 15000) */
    leaseTtlMs?: number;
  };

  /** Disaster recovery / backup */
  dr?: {
    enabled?: boolean;
    /** Source paths to back up */
    sourcePaths?: string[];
    /** Backup directory */
    backupDir?: string;
    /** Encryption key (32-byte hex) */
    encryptionKey?: string;
    /** Automated schedule interval in ms (0 = disabled) */
    scheduleIntervalMs?: number;
    /** Max backups to retain */
    maxBackups?: number;
  };

  /** API versioning */
  apiVersioning?: {
    enabled?: boolean;
    /** Default API version (default: "v1") */
    defaultVersion?: string;
  };

  /** Secrets management */
  secrets?: {
    enabled?: boolean;
    /** Backends: "env" | "file" | "vault" */
    backends?: Array<{
      type: "env" | "file" | "vault";
      priority?: number;
      /** File backend settings */
      file?: { path?: string; encryptionKey?: string };
      /** Vault backend settings */
      vault?: { address?: string; token?: string; mountPath?: string };
    }>;
  };

  /** Drift reconciliation */
  drift?: {
    enabled?: boolean;
    /** Scan interval in ms (default: 3600000 = 1hr) */
    scanIntervalMs?: number;
  };

  /** Service mesh integration */
  serviceMesh?: {
    enabled?: boolean;
  };

  /** Durable task queue */
  taskQueue?: {
    enabled?: boolean;
    /** Poll interval in ms */
    pollIntervalMs?: number;
  };
}

// =============================================================================
// Enterprise Runtime
// =============================================================================

export interface EnterpriseRuntime {
  /** Audit log pipeline — null if not enabled */
  audit: AuditLogPipeline | null;

  /** Event bus — null if not enabled */
  eventBus: EventBus | null;

  /** Cluster coordinator — null if not enabled */
  cluster: ClusterCoordinator | null;

  /** Disaster recovery manager — null if not enabled */
  dr: DisasterRecoveryManager | null;

  /** Versioned API router — null if not enabled */
  versionedRouter: VersionedRouter | null;

  /** Secrets manager — null if not enabled */
  secrets: SecretsManager | null;

  /** Drift reconciliation engine — null if not enabled */
  drift: DriftReconciliationEngine | null;

  /** Service mesh manager — null if not enabled */
  serviceMesh: ServiceMeshManager | null;

  /** Durable task queue — null if not enabled */
  taskQueue: DurableTaskQueue | null;

  /** SQLite rate-limit store — null if persistent state not enabled */
  rateLimitStore: SQLiteRateLimitStore | null;

  /** SQLite dedup store — null if persistent state not enabled */
  dedupStore: SQLiteDedupStore | null;

  /** Close all enterprise subsystems */
  close(): Promise<void>;
}

// =============================================================================
// Bootstrap
// =============================================================================

/**
 * Initialize all enterprise subsystems based on config.
 * Safe to call even with empty config — all subsystems default to disabled.
 */
export async function bootstrapEnterprise(
  config: EnterpriseConfig = {},
): Promise<EnterpriseRuntime> {
  const stateDir = resolveStateDir();
  const enterpriseDir = config.persistentState?.dbDir ?? join(stateDir, "enterprise");

  // Validate config before proceeding
  const { errors, warnings } = validateEnterpriseConfig(config);
  for (const w of warnings) log.warn(`enterprise config: ${w}`);
  if (errors.length > 0) {
    const msg = `enterprise config validation failed:\n  ${errors.join("\n  ")}`;
    log.error(msg);
    throw new Error(msg);
  }

  // Ensure directory exists
  const { mkdirSync } = await import("node:fs");
  try {
    mkdirSync(enterpriseDir, { recursive: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  log.info("initializing enterprise subsystems", { dir: enterpriseDir });

  // ── Persistent State (Gap #2) ───────────────────────────────
  let rateLimitStore: SQLiteRateLimitStore | null = null;
  let dedupStore: SQLiteDedupStore | null = null;

  if (config.persistentState?.enabled) {
    rateLimitStore = new SQLiteRateLimitStore(join(enterpriseDir, "rate-limit.db"));
    dedupStore = new SQLiteDedupStore(join(enterpriseDir, "dedup.db"));
    log.info("persistent state stores initialized");
  }

  // ── Audit Log (Gap #4) ─────────────────────────────────────
  let audit: AuditLogPipeline | null = null;

  if (config.audit?.enabled) {
    audit = new AuditLogPipeline(join(enterpriseDir, "audit.db"), {
      minimumSeverity: config.audit.minSeverity ?? "info",
      sinks: config.audit.sinks ?? [],
      retentionDays: config.audit.retentionDays ?? 90,
    });
    log.info("audit pipeline initialized", { minSeverity: config.audit.minSeverity ?? "info" });
  }

  // ── Event Bus (Gap #6) ──────────────────────────────────────
  let eventBus: EventBus | null = null;

  if (config.eventBus?.enabled) {
    eventBus = new EventBus(join(enterpriseDir, "events.db"));
    log.info("event bus initialized");
  }

  // ── Cluster Coordinator (Gap #1) ───────────────────────────
  let cluster: ClusterCoordinator | null = null;

  if (config.cluster?.enabled && config.cluster.address) {
    cluster = new ClusterCoordinator(join(enterpriseDir, "cluster.db"), {
      address: config.cluster.address,
      instanceName: config.cluster.instanceName,
      leaseTtlMs: config.cluster.leaseTtlMs,
    });
    await cluster.start();
    log.info("cluster coordinator started", { address: config.cluster.address });
  }

  // ── Disaster Recovery (Gap #5) ──────────────────────────────
  let dr: DisasterRecoveryManager | null = null;

  if (config.dr?.enabled) {
    const sourcePaths = config.dr.sourcePaths ?? [stateDir];
    dr = new DisasterRecoveryManager(join(enterpriseDir, "dr-manifest.db"), {
      sourcePaths,
      targets: [
        { type: "local", localPath: config.dr.backupDir ?? join(enterpriseDir, "backups") },
      ],
      encryptionKey: config.dr.encryptionKey,
      encrypted: !!config.dr.encryptionKey,
      maxBackups: config.dr.maxBackups ?? 30,
      maxAgeDays: 365,
    });

    if (config.dr.scheduleIntervalMs && config.dr.scheduleIntervalMs > 0) {
      dr.startSchedule(config.dr.scheduleIntervalMs);
      log.info("DR backup schedule started", { intervalMs: config.dr.scheduleIntervalMs });
    }
    log.info("disaster recovery initialized", { encrypted: !!config.dr.encryptionKey });
  }

  // ── API Versioning (Gap #7) ─────────────────────────────────
  let versionedRouter: VersionedRouter | null = null;

  if (config.apiVersioning?.enabled) {
    versionedRouter = new VersionedRouter({
      defaultVersion: config.apiVersioning.defaultVersion ?? "v1",
    });

    // Register default v1 version
    const v1: ApiVersion = {
      version: "v1",
      major: 1,
      status: "active",
      releasedAt: new Date().toISOString(),
    };
    versionedRouter.addVersion(v1);

    // Register built-in spec + versions endpoints
    versionedRouter.registerSpecEndpoint();
    versionedRouter.registerVersionsEndpoint();
    log.info("API versioning initialized", {
      defaultVersion: config.apiVersioning.defaultVersion ?? "v1",
    });
  }

  // ── Secrets Management (Gap #8) ─────────────────────────────
  let secrets: SecretsManager | null = null;

  if (config.secrets?.enabled) {
    secrets = createSecretsManager({
      backends: (config.secrets.backends ?? [{ type: "env" as const }]).map((b, i) => {
        const base = { type: b.type, priority: b.priority ?? i } as const;
        if (b.file?.path)
          return { ...base, file: { path: b.file.path, encryptionKey: b.file.encryptionKey } };
        if (b.vault?.address)
          return {
            ...base,
            vault: { address: b.vault.address, token: b.vault.token, mountPath: b.vault.mountPath },
          };
        return base;
      }) as import("../secrets/index.js").SecretBackendConfig[],
      cacheTtlSeconds: 300,
    });
    log.info("secrets manager initialized", {
      backends: (config.secrets.backends ?? []).map((b) => b.type),
    });
  }

  // ── Drift Reconciliation (Gap #9) ──────────────────────────
  let drift: DriftReconciliationEngine | null = null;

  if (config.drift?.enabled) {
    drift = new DriftReconciliationEngine(join(enterpriseDir, "drift.db"), {
      scanIntervalMinutes: Math.round((config.drift.scanIntervalMs ?? 3_600_000) / 60_000),
    });

    // Register built-in scanners (Phase 3)
    drift.registerScanner(new ConfigFileDriftScanner());
    drift.registerScanner(new EnvVarDriftScanner());
    log.info("drift reconciliation initialized (2 built-in scanners)");
  }

  // ── Service Mesh (Gap #10) ──────────────────────────────────
  let serviceMesh: ServiceMeshManager | null = null;

  if (config.serviceMesh?.enabled) {
    serviceMesh = new ServiceMeshManager();

    // Register local/stub adapter so mesh endpoints return data (Phase 3)
    serviceMesh.registerAdapter(new LocalMeshAdapter());
    log.info("service mesh initialized (local adapter)");
  }

  // ── Task Queue (Gap #3) ─────────────────────────────────────
  let taskQueue: DurableTaskQueue | null = null;

  if (config.taskQueue?.enabled) {
    taskQueue = new DurableTaskQueue(join(enterpriseDir, "task-queue.db"), {
      pollIntervalMs: config.taskQueue.pollIntervalMs,
    });
    taskQueue.start();
    log.info("durable task queue started", { pollIntervalMs: config.taskQueue.pollIntervalMs });
  }

  // ── Return runtime ─────────────────────────────────────────

  const enabledModules = [
    rateLimitStore && "state",
    audit && "audit",
    eventBus && "eventBus",
    cluster && "cluster",
    dr && "dr",
    versionedRouter && "apiVersioning",
    secrets && "secrets",
    drift && "drift",
    serviceMesh && "mesh",
    taskQueue && "taskQueue",
  ].filter(Boolean);

  if (enabledModules.length > 0) {
    log.info("enterprise bootstrap complete", { modules: enabledModules });
  }

  return {
    audit,
    eventBus,
    cluster,
    dr,
    versionedRouter,
    secrets,
    drift,
    serviceMesh,
    taskQueue,
    rateLimitStore,
    dedupStore,

    close: async () => {
      const safe = async (name: string, fn: () => unknown) => {
        try {
          await fn();
        } catch (err) {
          log.warn(`enterprise: close ${name} failed: ${err}`);
        }
      };
      await safe("taskQueue", () => taskQueue?.stop());
      await safe("cluster", () => cluster?.stop());
      await safe("drift", () => drift?.stop());
      await safe("dr", () => dr?.stopSchedule());
      await safe("eventBus", () => eventBus?.close());
      await safe("audit", () => audit?.close());
      await safe("secrets", () => secrets?.close());
      await safe("mesh", () => serviceMesh?.close());
      await safe("rateLimitStore", () => rateLimitStore?.close());
      await safe("dedupStore", () => dedupStore?.close());
    },
  };
}
