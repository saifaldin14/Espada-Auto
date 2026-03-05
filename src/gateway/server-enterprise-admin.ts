/**
 * Enterprise Admin HTTP Handler
 *
 * Centralized request handler for all enterprise admin endpoints.
 * Mounted early in the HTTP chain to serve `/health`, `/ready`,
 * and `/admin/*` routes for cluster, DR, secrets, drift, and mesh.
 *
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { EnterpriseRuntime } from "./enterprise/index.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import type { SessionManager } from "./sso/session-store.js";
import type { GatewayRBACManager } from "./rbac/manager.js";
import { authorizeGatewayConnect, authorizeGatewayPermission } from "./auth.js";
import { getBearerToken } from "./http-utils.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { buildOpenApiSpec, buildRouteSummary } from "./enterprise/admin-openapi.js";

const log = createSubsystemLogger("enterprise").child("admin-http");

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const maxBytes = 1_048_576; // 1 MB
    let settled = false;
    const settle = (value: unknown) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        settle(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (totalBytes > maxBytes) {
        settle(null);
        return;
      }
      try {
        settle(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        settle(null);
      }
    });
    req.on("error", () => settle(null));
    req.on("close", () => settle(null));
  });
}

/** Auth context for RBAC-gated admin endpoints. */
export interface AdminAuthContext {
  auth: ResolvedGatewayAuth;
  trustedProxies?: string[];
  sessionManager?: SessionManager | null;
  rbacManager?: GatewayRBACManager | null;
}

/**
 * Create the enterprise admin HTTP request handler.
 * Returns an async handler that returns `true` if it handled the request.
 *
 * When `authCtx` is provided, all `/admin/*` endpoints require
 * `operator.admin` permission. `/health` and `/ready` remain open.
 */
export function createEnterpriseAdminHandler(
  enterprise: EnterpriseRuntime | null,
  authCtx?: AdminAuthContext | null,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    if (!enterprise) return false;

    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    // ── Health & Ready (Gap #1) ────────────────────────────────────
    if (pathname === "/health" && req.method === "GET") {
      return handleHealthCheck(enterprise, res);
    }

    if (pathname === "/ready" && req.method === "GET") {
      return handleReadinessCheck(enterprise, res);
    }

    // All admin endpoints under /admin/*
    if (!pathname.startsWith("/admin/")) return false;

    // ── RBAC gate — require operator.admin for all /admin/* routes ──
    if (authCtx) {
      const token = getBearerToken(req);
      const authResult = await authorizeGatewayConnect({
        auth: authCtx.auth,
        connectAuth: token ? { token, password: token } : null,
        req,
        trustedProxies: authCtx.trustedProxies,
        sessionManager: authCtx.sessionManager,
        rbacManager: authCtx.rbacManager,
      });
      if (!authResult.ok) {
        log.warn("admin access denied: unauthorized", {
          path: pathname,
          reason: authResult.reason,
        });
        sendJson(res, 401, { error: "Unauthorized", reason: authResult.reason });
        return true;
      }
      const perm = await authorizeGatewayPermission({
        authResult,
        permission: "operator.admin",
        rbacManager: authCtx.rbacManager,
      });
      if (!perm.ok) {
        log.warn("admin access denied: forbidden", { path: pathname, reason: perm.reason });
        sendJson(res, 403, { error: "Forbidden", reason: perm.reason });
        return true;
      }
    }

    const adminPath = pathname.slice("/admin".length); // e.g. "/cluster/instances"

    // ── Cluster Admin (Gap #1) ───────────────────────────────────
    if (adminPath === "/cluster/instances" && req.method === "GET") {
      return handleClusterInstances(enterprise, res);
    }
    if (adminPath === "/cluster/leader" && req.method === "GET") {
      return handleClusterLeader(enterprise, res);
    }

    // ── DR Admin (Gap #5) ────────────────────────────────────────
    if (adminPath === "/backup" && req.method === "POST") {
      return handleCreateBackup(enterprise, req, res);
    }
    if (adminPath === "/backups" && req.method === "GET") {
      return handleListBackups(enterprise, url, res);
    }
    // Schedule routes MUST come before the generic /backup/{id} GET
    if (adminPath === "/backup/schedule" && req.method === "POST") {
      return handleBackupScheduleStart(enterprise, req, res);
    }
    if (adminPath === "/backup/schedule" && req.method === "DELETE") {
      return handleBackupScheduleStop(enterprise, res);
    }
    if (
      adminPath.startsWith("/backup/") &&
      adminPath.endsWith("/verify") &&
      req.method === "POST"
    ) {
      return handleVerifyBackup(enterprise, adminPath, res);
    }
    if (adminPath.startsWith("/backup/") && req.method === "GET") {
      return handleGetBackup(enterprise, adminPath, res);
    }
    if (adminPath === "/restore" && req.method === "POST") {
      return handleRestore(enterprise, req, res);
    }

    // ── Secrets Admin (Gap #8) ───────────────────────────────────
    if (adminPath === "/secrets" && req.method === "GET") {
      return handleListSecrets(enterprise, res);
    }
    if (adminPath.startsWith("/secrets/") && req.method === "GET") {
      return handleGetSecret(enterprise, adminPath, res);
    }
    if (adminPath.startsWith("/secrets/") && req.method === "PUT") {
      return handleSetSecret(enterprise, adminPath, req, res);
    }
    if (adminPath.startsWith("/secrets/") && req.method === "DELETE") {
      return handleDeleteSecret(enterprise, adminPath, res);
    }

    // ── Drift Admin (Gap #9) ─────────────────────────────────────
    if (adminPath === "/drift/scan" && req.method === "POST") {
      return handleDriftScan(enterprise, res);
    }
    if (adminPath === "/drift/results" && req.method === "GET") {
      return handleDriftResults(enterprise, url, res);
    }
    if (adminPath === "/drift/stats" && req.method === "GET") {
      return handleDriftStats(enterprise, res);
    }
    if (adminPath === "/drift/policies" && req.method === "GET") {
      return handleDriftPolicies(enterprise, res);
    }
    if (adminPath === "/drift/policies" && req.method === "POST") {
      return handleAddDriftPolicy(enterprise, req, res);
    }
    if (adminPath.startsWith("/drift/policies/") && req.method === "DELETE") {
      return handleDeleteDriftPolicy(enterprise, adminPath, res);
    }

    // ── Mesh Admin (Gap #10) ─────────────────────────────────────
    if (adminPath === "/mesh/services" && req.method === "GET") {
      return handleMeshServices(enterprise, url, res);
    }
    if (adminPath === "/mesh/dashboard" && req.method === "GET") {
      return handleMeshDashboard(enterprise, url, res);
    }
    if (adminPath === "/mesh/canary" && req.method === "GET") {
      return handleMeshCanaries(enterprise, res);
    }

    // ── Meta: OpenAPI & Routes (Phase 4) ─────────────────────────
    if (adminPath === "/openapi.json" && req.method === "GET") {
      sendJson(res, 200, buildOpenApiSpec());
      return true;
    }
    if (adminPath === "/routes" && req.method === "GET") {
      sendJson(res, 200, buildRouteSummary());
      return true;
    }

    return false;
  };
}

// =============================================================================
// Health / Ready (Gap #1)
// =============================================================================

function handleHealthCheck(ent: EnterpriseRuntime, res: ServerResponse): boolean {
  if (ent.cluster) {
    const check = ent.cluster.healthCheck();
    sendJson(res, check.statusCode, check.body);
  } else {
    sendJson(res, 200, { status: "ok", cluster: false });
  }
  return true;
}

function handleReadinessCheck(ent: EnterpriseRuntime, res: ServerResponse): boolean {
  if (ent.cluster) {
    const check = ent.cluster.readinessCheck();
    sendJson(res, check.statusCode, {
      ready: check.ready,
      reason: check.reason,
    });
  } else {
    sendJson(res, 200, { ready: true, cluster: false });
  }
  return true;
}

// =============================================================================
// Cluster (Gap #1)
// =============================================================================

function handleClusterInstances(ent: EnterpriseRuntime, res: ServerResponse): boolean {
  if (!ent.cluster) {
    sendJson(res, 404, { error: "Cluster coordination not enabled" });
    return true;
  }
  const instances = ent.cluster.getInstances();
  sendJson(res, 200, { instances });
  return true;
}

function handleClusterLeader(ent: EnterpriseRuntime, res: ServerResponse): boolean {
  if (!ent.cluster) {
    sendJson(res, 404, { error: "Cluster coordination not enabled" });
    return true;
  }
  const leader = ent.cluster.getLeader();
  const lease = ent.cluster.getLease();
  sendJson(res, 200, { leader, lease });
  return true;
}

// =============================================================================
// Disaster Recovery (Gap #5)
// =============================================================================

async function handleCreateBackup(
  ent: EnterpriseRuntime,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!ent.dr) {
    sendJson(res, 404, { error: "Disaster recovery not enabled" });
    return true;
  }
  const body = (await readJsonBody(req)) as Record<string, unknown> | null;
  try {
    const manifest = ent.dr.createBackup({
      label: typeof body?.label === "string" ? body.label : undefined,
    });
    ent.audit?.record({
      action: "infra.resource_created",
      outcome: "success",
      severity: "info",
      actor: { type: "system", id: "admin-api" },
      resource: { type: "backup", id: manifest.id },
      context: { label: manifest.label },
    });
    ent.eventBus?.publish({
      name: "dr.backup.created",
      namespace: "infra",
      data: { backupId: manifest.id, status: manifest.status },
      source: "admin-api",
    });
    sendJson(res, 201, manifest);
  } catch (err) {
    ent.audit?.record({
      action: "infra.resource_created",
      outcome: "error",
      severity: "error",
      actor: { type: "system", id: "admin-api" },
      resource: { type: "backup", id: "unknown" },
      context: { error: String(err) },
    });
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}

function handleListBackups(ent: EnterpriseRuntime, url: URL, res: ServerResponse): boolean {
  if (!ent.dr) {
    sendJson(res, 404, { error: "Disaster recovery not enabled" });
    return true;
  }
  const limit = Number(url.searchParams.get("limit")) || 50;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const statusRaw = url.searchParams.get("status");
  const VALID_BACKUP_STATUSES = new Set([
    "pending",
    "in-progress",
    "completed",
    "failed",
    "verified",
  ]);
  if (statusRaw && !VALID_BACKUP_STATUSES.has(statusRaw)) {
    sendJson(res, 400, { error: `Invalid status filter: ${statusRaw}` });
    return true;
  }
  const status = statusRaw as import("./dr/index.js").BackupStatus | null;
  const manifests = ent.dr.listManifests({
    status: status ?? undefined,
    limit,
    offset,
  });
  sendJson(res, 200, { manifests, limit, offset });
  return true;
}

function handleGetBackup(ent: EnterpriseRuntime, adminPath: string, res: ServerResponse): boolean {
  if (!ent.dr) {
    sendJson(res, 404, { error: "Disaster recovery not enabled" });
    return true;
  }
  const backupId = adminPath.slice("/backup/".length);
  if (!backupId) {
    sendJson(res, 400, { error: "Missing backup ID" });
    return true;
  }
  const manifest = ent.dr.getManifest(backupId);
  if (!manifest) {
    sendJson(res, 404, { error: "Backup not found" });
    return true;
  }
  sendJson(res, 200, manifest);
  return true;
}

async function handleRestore(
  ent: EnterpriseRuntime,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!ent.dr) {
    sendJson(res, 404, { error: "Disaster recovery not enabled" });
    return true;
  }
  const body = (await readJsonBody(req)) as Record<string, unknown> | null;
  if (!body?.backupId || typeof body.backupId !== "string") {
    sendJson(res, 400, { error: "Missing backupId in request body" });
    return true;
  }

  // Mark instance degraded during restore
  ent.cluster?.setHealth("degraded");

  try {
    const result = ent.dr.restore({
      backupId: body.backupId as string,
      targetDir: typeof body.targetDir === "string" ? body.targetDir : undefined,
    });
    ent.audit?.record({
      action: "infra.resource_updated",
      outcome: result.success ? "success" : "failure",
      severity: result.success ? "warn" : "error",
      actor: { type: "system", id: "admin-api" },
      resource: { type: "backup", id: body.backupId as string },
      context: { filesRestored: result.filesRestored, errors: result.errors },
    });
    ent.eventBus?.publish({
      name: "dr.restore.completed",
      namespace: "infra",
      data: { backupId: body.backupId, success: result.success },
      source: "admin-api",
    });
    sendJson(res, result.success ? 200 : 500, result);
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  } finally {
    ent.cluster?.setHealth("healthy");
  }
  return true;
}

async function handleVerifyBackup(
  ent: EnterpriseRuntime,
  adminPath: string,
  res: ServerResponse,
): Promise<boolean> {
  if (!ent.dr) {
    sendJson(res, 404, { error: "Disaster recovery not enabled" });
    return true;
  }
  // adminPath = "/backup/<id>/verify"
  const idPart = adminPath.slice("/backup/".length, adminPath.lastIndexOf("/verify"));
  if (!idPart) {
    sendJson(res, 400, { error: "Missing backup ID" });
    return true;
  }
  try {
    const result = ent.dr.verifyBackup(idPart);
    sendJson(res, result.valid ? 200 : 422, result);
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}

// =============================================================================
// DR Schedule Control
// =============================================================================

async function handleBackupScheduleStart(
  ent: EnterpriseRuntime,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!ent.dr) {
    sendJson(res, 404, { error: "Disaster recovery not enabled" });
    return true;
  }
  const body = (await readJsonBody(req)) as Record<string, unknown> | null;
  const intervalMs =
    typeof body?.intervalMs === "number" && body.intervalMs > 0
      ? body.intervalMs
      : 24 * 60 * 60 * 1000; // default 24h
  try {
    ent.dr.startSchedule(intervalMs);
    ent.audit?.record({
      action: "config.updated",
      outcome: "success",
      severity: "info",
      actor: { type: "system", id: "admin-api" },
      resource: { type: "backup-schedule", id: "default" },
      context: { intervalMs },
    });
    ent.eventBus?.publish({
      name: "dr.schedule.started",
      namespace: "infra",
      data: { intervalMs },
      source: "admin-api",
    });
    sendJson(res, 200, { status: "started", intervalMs });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}

function handleBackupScheduleStop(ent: EnterpriseRuntime, res: ServerResponse): boolean {
  if (!ent.dr) {
    sendJson(res, 404, { error: "Disaster recovery not enabled" });
    return true;
  }
  try {
    ent.dr.stopSchedule();
    ent.audit?.record({
      action: "config.updated",
      outcome: "success",
      severity: "info",
      actor: { type: "system", id: "admin-api" },
      resource: { type: "backup-schedule", id: "default" },
      context: {},
    });
    ent.eventBus?.publish({
      name: "dr.schedule.stopped",
      namespace: "infra",
      data: {},
      source: "admin-api",
    });
    sendJson(res, 200, { status: "stopped" });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}

// =============================================================================
// Secrets (Gap #8)
// =============================================================================

async function handleListSecrets(ent: EnterpriseRuntime, res: ServerResponse): Promise<boolean> {
  if (!ent.secrets) {
    sendJson(res, 404, { error: "Secrets management not enabled" });
    return true;
  }
  try {
    const keys = await ent.secrets.list();
    sendJson(res, 200, { keys });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}

async function handleGetSecret(
  ent: EnterpriseRuntime,
  adminPath: string,
  res: ServerResponse,
): Promise<boolean> {
  if (!ent.secrets) {
    sendJson(res, 404, { error: "Secrets management not enabled" });
    return true;
  }
  const key = decodeURIComponent(adminPath.slice("/secrets/".length));
  if (!key) {
    sendJson(res, 400, { error: "Missing secret key" });
    return true;
  }
  try {
    const secret = await ent.secrets.get(key);
    if (!secret) {
      sendJson(res, 404, { error: "Secret not found" });
      return true;
    }
    // Return masked value — fixed-length mask to avoid leaking secret length
    sendJson(res, 200, {
      key: secret.key,
      backend: secret.backend,
      metadata: secret.metadata,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
      value: secret.value ? "****" : null,
    });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}

async function handleSetSecret(
  ent: EnterpriseRuntime,
  adminPath: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!ent.secrets) {
    sendJson(res, 404, { error: "Secrets management not enabled" });
    return true;
  }
  const key = decodeURIComponent(adminPath.slice("/secrets/".length));
  if (!key) {
    sendJson(res, 400, { error: "Missing secret key" });
    return true;
  }
  const body = (await readJsonBody(req)) as Record<string, unknown> | null;
  if (!body?.value || typeof body.value !== "string") {
    sendJson(res, 400, { error: "Missing 'value' in request body" });
    return true;
  }
  try {
    const secret = await ent.secrets.set(key, body.value, {
      metadata:
        typeof body.metadata === "object" && body.metadata !== null
          ? (body.metadata as Record<string, string>)
          : undefined,
    });
    ent.audit?.record({
      action: "config.updated",
      outcome: "success",
      severity: "warn",
      actor: { type: "system", id: "admin-api" },
      resource: { type: "secret", id: key },
      context: { backend: secret.backend },
    });
    sendJson(res, 200, { key: secret.key, backend: secret.backend });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}

async function handleDeleteSecret(
  ent: EnterpriseRuntime,
  adminPath: string,
  res: ServerResponse,
): Promise<boolean> {
  if (!ent.secrets) {
    sendJson(res, 404, { error: "Secrets management not enabled" });
    return true;
  }
  const key = decodeURIComponent(adminPath.slice("/secrets/".length));
  if (!key) {
    sendJson(res, 400, { error: "Missing secret key" });
    return true;
  }
  try {
    const deleted = await ent.secrets.delete(key);
    if (!deleted) {
      sendJson(res, 404, { error: "Secret not found" });
      return true;
    }
    ent.audit?.record({
      action: "infra.resource_deleted",
      outcome: "success",
      severity: "warn",
      actor: { type: "system", id: "admin-api" },
      resource: { type: "secret", id: key },
      context: {},
    });
    sendJson(res, 200, { deleted: true });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}

// =============================================================================
// Drift Reconciliation (Gap #9)
// =============================================================================

async function handleDriftScan(ent: EnterpriseRuntime, res: ServerResponse): Promise<boolean> {
  if (!ent.drift) {
    sendJson(res, 404, { error: "Drift reconciliation not enabled" });
    return true;
  }
  try {
    const results = await ent.drift.runAllScans();
    ent.audit?.record({
      action: "infra.drift_detected",
      outcome: "success",
      severity: "info",
      actor: { type: "system", id: "admin-api" },
      resource: { type: "drift-scan", id: "manual" },
      context: { resultCount: results.length },
    });
    sendJson(res, 200, { results });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}

function handleDriftResults(ent: EnterpriseRuntime, url: URL, res: ServerResponse): boolean {
  if (!ent.drift) {
    sendJson(res, 404, { error: "Drift reconciliation not enabled" });
    return true;
  }
  const limit = Number(url.searchParams.get("limit")) || 50;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const provider = url.searchParams.get("provider") ?? undefined;
  const statusRaw2 = url.searchParams.get("status") ?? undefined;
  const VALID_DRIFT_STATUSES = new Set([
    "detected",
    "acknowledged",
    "remediating",
    "resolved",
    "ignored",
    "failed",
  ]);
  if (statusRaw2 && !VALID_DRIFT_STATUSES.has(statusRaw2)) {
    sendJson(res, 400, { error: `Invalid drift status filter: ${statusRaw2}` });
    return true;
  }
  const drifts = ent.drift.listDrifts({
    provider: provider as import("./drift/index.js").ProviderType | undefined,
    status: statusRaw2 as import("./drift/index.js").DriftStatus | undefined,
    limit,
    offset,
  });
  sendJson(res, 200, { drifts, limit, offset });
  return true;
}

function handleDriftStats(ent: EnterpriseRuntime, res: ServerResponse): boolean {
  if (!ent.drift) {
    sendJson(res, 404, { error: "Drift reconciliation not enabled" });
    return true;
  }
  const stats = ent.drift.getStats();
  sendJson(res, 200, stats);
  return true;
}

function handleDriftPolicies(ent: EnterpriseRuntime, res: ServerResponse): boolean {
  if (!ent.drift) {
    sendJson(res, 404, { error: "Drift reconciliation not enabled" });
    return true;
  }
  const policies = ent.drift.listPolicies();
  sendJson(res, 200, { policies });
  return true;
}

async function handleAddDriftPolicy(
  ent: EnterpriseRuntime,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!ent.drift) {
    sendJson(res, 404, { error: "Drift reconciliation not enabled" });
    return true;
  }
  const body = (await readJsonBody(req)) as Record<string, unknown> | null;
  if (!body?.name || !body?.provider || !body?.action) {
    sendJson(res, 400, { error: "Missing required fields: name, provider, action" });
    return true;
  }
  try {
    const policy = ent.drift.addPolicy(body as Parameters<typeof ent.drift.addPolicy>[0]);
    sendJson(res, 201, policy);
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}

function handleDeleteDriftPolicy(
  ent: EnterpriseRuntime,
  adminPath: string,
  res: ServerResponse,
): boolean {
  if (!ent.drift) {
    sendJson(res, 404, { error: "Drift reconciliation not enabled" });
    return true;
  }
  const policyId = adminPath.slice("/drift/policies/".length);
  if (!policyId) {
    sendJson(res, 400, { error: "Missing policy ID" });
    return true;
  }
  const deleted = ent.drift.deletePolicy(policyId);
  if (!deleted) {
    sendJson(res, 404, { error: "Policy not found" });
    return true;
  }
  sendJson(res, 200, { deleted: true });
  return true;
}

// =============================================================================
// Service Mesh (Gap #10)
// =============================================================================

async function handleMeshServices(
  ent: EnterpriseRuntime,
  url: URL,
  res: ServerResponse,
): Promise<boolean> {
  if (!ent.serviceMesh) {
    sendJson(res, 404, { error: "Service mesh not enabled" });
    return true;
  }
  try {
    const namespace = url.searchParams.get("namespace") ?? undefined;
    const services = await ent.serviceMesh.listAllServices(namespace);
    sendJson(res, 200, { services });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}

async function handleMeshDashboard(
  ent: EnterpriseRuntime,
  url: URL,
  res: ServerResponse,
): Promise<boolean> {
  if (!ent.serviceMesh) {
    sendJson(res, 404, { error: "Service mesh not enabled" });
    return true;
  }
  try {
    const namespace = url.searchParams.get("namespace") ?? undefined;
    const dashboard = await ent.serviceMesh.getTrafficDashboard(namespace);
    sendJson(res, 200, dashboard);
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}

function handleMeshCanaries(ent: EnterpriseRuntime, res: ServerResponse): boolean {
  if (!ent.serviceMesh) {
    sendJson(res, 404, { error: "Service mesh not enabled" });
    return true;
  }
  const deployments = ent.serviceMesh.getCanaryDeployments();
  sendJson(res, 200, { deployments });
  return true;
}
