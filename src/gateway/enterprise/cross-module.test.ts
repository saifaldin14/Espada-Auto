/**
 * Cross-Module Integration Tests (Phase 4)
 *
 * Verifies multi-module flows:
 * - Secrets → provider key resolution
 * - DR → audit + event bus cross-wiring
 * - Drift scan → event emission
 * - RBAC gate → admin endpoint access control
 * - Mesh → admin → metrics
 * - Config validation
 * - Graceful degradation (timeout, circuit-breaker, health)
 *
 * Also includes Phase 3 unit coverage that was lost:
 * - secrets-accessor, builtin-scanners, local-adapter
 *
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Modules under test ──────────────────────────────────────────────────────

import {
  setGatewaySecretsManager,
  getGatewaySecretsManager,
  resolveProviderKeyFromSecrets,
} from "../secrets-accessor.js";

import { ConfigFileDriftScanner, EnvVarDriftScanner } from "../drift/builtin-scanners.js";

import { LocalMeshAdapter } from "../mesh/local-adapter.js";

import { createEnterpriseAdminHandler } from "../server-enterprise-admin.js";
import type { EnterpriseRuntime } from "./index.js";

import { validateEnterpriseConfig } from "./validate-config.js";

// ── Mock Helpers ─────────────────────────────────────────────────────────────

function createMockReq(method: string, url: string, body?: unknown): IncomingMessage {
  const { Readable } = require("node:stream");
  const req = new Readable({
    read() {
      if (body !== undefined) {
        this.push(JSON.stringify(body));
      }
      this.push(null);
    },
  }) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = {};
  return req;
}

function createMockRes(): ServerResponse & {
  _status: number;
  _headers: Record<string, string>;
  _body: string;
  json(): unknown;
} {
  const res: Record<string, unknown> = {
    _status: 0,
    _headers: {} as Record<string, string>,
    _body: "",
    statusCode: 200,
    setHeader(key: string, value: string) {
      (res._headers as Record<string, string>)[key] = value;
    },
    end(data?: string) {
      res._body = data ?? "";
      res._status = res.statusCode as number;
    },
    json() {
      return JSON.parse(res._body as string);
    },
  };
  Object.defineProperty(res, "statusCode", {
    get: () => res._status || 200,
    set: (v: number) => {
      res._status = v;
    },
  });
  return res as unknown as ServerResponse & {
    _status: number;
    _headers: Record<string, string>;
    _body: string;
    json(): unknown;
  };
}

function stubRuntime(overrides?: Partial<EnterpriseRuntime>): EnterpriseRuntime {
  return {
    audit: null,
    eventBus: null,
    cluster: null,
    dr: null,
    versionedRouter: null,
    secrets: null,
    drift: null,
    serviceMesh: null,
    taskQueue: null,
    rateLimitStore: null,
    dedupStore: null,
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

// =============================================================================
// 1. Secrets Accessor (unit)
// =============================================================================

describe("secrets-accessor", () => {
  beforeEach(() => {
    setGatewaySecretsManager(null as unknown as any);
  });

  it("returns null before any manager is set", () => {
    expect(getGatewaySecretsManager()).toBeNull();
  });

  it("stores and returns the secrets manager", () => {
    const fakeMgr = { get: vi.fn() } as any;
    setGatewaySecretsManager(fakeMgr);
    expect(getGatewaySecretsManager()).toBe(fakeMgr);
  });

  it("resolves null when no manager is set", async () => {
    const result = await resolveProviderKeyFromSecrets("openai");
    expect(result).toBeNull();
  });

  it("resolves API key via provider/name/api-key pattern", async () => {
    const fakeMgr = {
      get: vi.fn(async (key: string) => {
        if (key === "provider/anthropic/api-key") return { value: "sk-ant-test123" };
        return null;
      }),
    } as any;
    setGatewaySecretsManager(fakeMgr);
    const result = await resolveProviderKeyFromSecrets("anthropic");
    expect(result).toEqual({
      apiKey: "sk-ant-test123",
      source: "secrets:provider/anthropic/api-key",
    });
  });

  it("tries apiKey pattern when api-key pattern misses", async () => {
    const fakeMgr = {
      get: vi.fn(async (key: string) => {
        if (key === "provider/openai/apiKey") return { value: "sk-openai-test" };
        return null;
      }),
    } as any;
    setGatewaySecretsManager(fakeMgr);
    const result = await resolveProviderKeyFromSecrets("openai");
    expect(result).toEqual({ apiKey: "sk-openai-test", source: "secrets:provider/openai/apiKey" });
  });

  it("tries UPPER_API_KEY pattern as last resort", async () => {
    const fakeMgr = {
      get: vi.fn(async (key: string) => {
        if (key === "GOOGLE_GEMINI_API_KEY") return { value: "gk-test" };
        return null;
      }),
    } as any;
    setGatewaySecretsManager(fakeMgr);
    const result = await resolveProviderKeyFromSecrets("google-gemini");
    expect(result).toEqual({ apiKey: "gk-test", source: "secrets:GOOGLE_GEMINI_API_KEY" });
  });

  it("returns null when all patterns miss", async () => {
    const fakeMgr = { get: vi.fn(async () => null) } as any;
    setGatewaySecretsManager(fakeMgr);
    const result = await resolveProviderKeyFromSecrets("nonexistent");
    expect(result).toBeNull();
    expect(fakeMgr.get).toHaveBeenCalledTimes(3);
  });

  it("handles secrets get() throwing errors gracefully", async () => {
    const fakeMgr = {
      get: vi.fn(async () => {
        throw new Error("backend unavailable");
      }),
    } as any;
    setGatewaySecretsManager(fakeMgr);
    const result = await resolveProviderKeyFromSecrets("openai");
    expect(result).toBeNull();
  });

  // Graceful degradation: timeout
  it("returns null when secrets backend is slow (250ms timeout)", async () => {
    const fakeMgr = {
      get: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ value: "slow" }), 500))),
    } as any;
    setGatewaySecretsManager(fakeMgr);
    const result = await resolveProviderKeyFromSecrets("openai");
    expect(result).toBeNull();
  }, 3000);
});

// =============================================================================
// 2. ConfigFileDriftScanner (unit)
// =============================================================================

describe("ConfigFileDriftScanner", () => {
  let tmpDir: string;
  let scanner: ConfigFileDriftScanner;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "drift-cfg-"));
    scanner = new ConfigFileDriftScanner();
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  });

  it("first scan establishes baseline (no drift)", async () => {
    writeFileSync(join(tmpDir, "config.json"), '{"key":"value"}');
    const result = await scanner.scan(tmpDir);
    expect(result.status).toBe("resolved");
    expect(result.resources).toHaveLength(0);
    expect(result.summary.totalResources).toBe(1);
  });

  it("detects modified config file", async () => {
    writeFileSync(join(tmpDir, "app.yaml"), "key: original");
    await scanner.scan(tmpDir);
    writeFileSync(join(tmpDir, "app.yaml"), "key: changed");
    const result = await scanner.scan(tmpDir);
    expect(result.status).toBe("detected");
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].changeType).toBe("modified");
  });

  it("detects added config file", async () => {
    writeFileSync(join(tmpDir, "base.toml"), "[section]");
    await scanner.scan(tmpDir);
    writeFileSync(join(tmpDir, "extra.conf"), "new=config");
    const result = await scanner.scan(tmpDir);
    expect(
      result.resources.some((r) => r.changeType === "added" && r.resourceId === "extra.conf"),
    ).toBe(true);
  });

  it("detects deleted config file", async () => {
    writeFileSync(join(tmpDir, "temp.env"), "VAR=1");
    await scanner.scan(tmpDir);
    unlinkSync(join(tmpDir, "temp.env"));
    const result = await scanner.scan(tmpDir);
    expect(result.resources.some((r) => r.changeType === "deleted")).toBe(true);
  });

  it("ignores non-config file extensions", async () => {
    writeFileSync(join(tmpDir, "readme.txt"), "hello");
    writeFileSync(join(tmpDir, "config.json"), "{}");
    const result = await scanner.scan(tmpDir);
    expect(result.summary.totalResources).toBe(1);
  });

  it("handles non-existent directory via circuit-breaker (returns empty result)", async () => {
    const result = await scanner.scan("/nonexistent/path/xyz");
    expect(result.status).toBe("resolved");
    expect(result.summary.totalResources).toBe(0);
  });

  it("no drift on identical re-scan", async () => {
    writeFileSync(join(tmpDir, "stable.json"), '{"stable":true}');
    await scanner.scan(tmpDir);
    const result = await scanner.scan(tmpDir);
    expect(result.status).toBe("resolved");
    expect(result.resources).toHaveLength(0);
  });
});

// =============================================================================
// 3. EnvVarDriftScanner (unit)
// =============================================================================

describe("EnvVarDriftScanner", () => {
  let scanner: EnvVarDriftScanner;
  const prefix = `__ESPADA_TEST_DRIFT_${Date.now()}_`;

  beforeEach(() => {
    scanner = new EnvVarDriftScanner();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith(prefix)) delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith(prefix)) delete process.env[key];
    }
  });

  it("first scan establishes baseline (no drift)", async () => {
    process.env[`${prefix}KEY1`] = "val1";
    const result = await scanner.scan(prefix);
    expect(result.status).toBe("resolved");
    expect(result.summary.totalResources).toBe(1);
  });

  it("detects modified env var", async () => {
    process.env[`${prefix}KEY1`] = "original";
    await scanner.scan(prefix);
    process.env[`${prefix}KEY1`] = "changed";
    const result = await scanner.scan(prefix);
    expect(result.status).toBe("detected");
    expect(result.resources[0].changeType).toBe("modified");
    expect(result.resources[0].fields[0].sensitive).toBe(true);
  });

  it("detects added env var", async () => {
    await scanner.scan(prefix);
    process.env[`${prefix}NEW`] = "added";
    const result = await scanner.scan(prefix);
    expect(result.resources.some((r) => r.changeType === "added")).toBe(true);
  });

  it("detects deleted env var", async () => {
    process.env[`${prefix}TEMP`] = "will-be-removed";
    await scanner.scan(prefix);
    delete process.env[`${prefix}TEMP`];
    const result = await scanner.scan(prefix);
    expect(result.resources.some((r) => r.changeType === "deleted")).toBe(true);
    expect(result.resources[0].severity).toBe("high");
  });

  it("no drift when env is stable", async () => {
    process.env[`${prefix}STABLE`] = "unchanged";
    await scanner.scan(prefix);
    const result = await scanner.scan(prefix);
    expect(result.status).toBe("resolved");
  });
});

// =============================================================================
// 4. LocalMeshAdapter (unit + health tracking)
// =============================================================================

describe("LocalMeshAdapter", () => {
  let adapter: LocalMeshAdapter;

  beforeEach(() => {
    adapter = new LocalMeshAdapter();
  });

  it("has gateway service registered by default", async () => {
    const services = await adapter.listServices();
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe("espada-gateway");
  });

  it("adds and retrieves a service", async () => {
    adapter.addService({
      name: "my-api",
      namespace: "prod",
      mesh: "consul-connect",
      endpoints: 3,
      protocol: "HTTP",
      mtls: "strict",
      labels: {},
      healthy: true,
      versions: ["v1"],
    });
    const svc = await adapter.getService("my-api", "prod");
    expect(svc).not.toBeNull();
    expect(svc!.endpoints).toBe(3);
  });

  it("removes a service", async () => {
    adapter.addService({
      name: "temp",
      namespace: "default",
      mesh: "consul-connect",
      endpoints: 1,
      protocol: "HTTP",
      mtls: "permissive",
      labels: {},
      healthy: true,
      versions: ["v1"],
    });
    expect(await adapter.listServices()).toHaveLength(2);
    adapter.removeService("temp", "default");
    expect(await adapter.listServices()).toHaveLength(1);
  });

  it("filters services by namespace", async () => {
    adapter.addService({
      name: "staging-api",
      namespace: "staging",
      mesh: "consul-connect",
      endpoints: 1,
      protocol: "HTTP",
      mtls: "strict",
      labels: {},
      healthy: true,
      versions: ["v1"],
    });
    expect(await adapter.listServices("staging")).toHaveLength(1);
    expect(await adapter.listServices("*")).toHaveLength(2);
  });

  it("applies and lists routes", async () => {
    await adapter.applyRoute({
      id: "canary-1",
      name: "canary",
      namespace: "default",
      service: "api",
      mesh: "consul-connect",
      matches: [],
      destinations: [],
      createdAt: new Date().toISOString(),
    });
    expect(await adapter.listRoutes("default")).toHaveLength(1);
  });

  it("deletes routes", async () => {
    await adapter.applyRoute({
      id: "del-1",
      name: "del",
      namespace: "default",
      service: "api",
      mesh: "consul-connect",
      matches: [],
      destinations: [],
      createdAt: new Date().toISOString(),
    });
    await adapter.deleteRoute("del", "default");
    expect(await adapter.listRoutes()).toHaveLength(0);
  });

  it("returns baseline metrics", async () => {
    const m = await adapter.getMetrics("espada-gateway", "default");
    expect(m.requestRate).toBe(0);
    expect(m.successRate).toBe(1.0);
  });

  it("returns mTLS status", async () => {
    const status = await adapter.getMtlsStatus();
    expect(status[0].mtls).toBe("permissive");
  });

  it("applies and deletes authorization policies", async () => {
    await adapter.applyAuthorizationPolicy({
      name: "deny",
      namespace: "prod",
      action: "DENY",
      rules: [],
    });
    await adapter.deleteAuthorizationPolicy("deny", "prod");
  });

  // Health tracking
  it("marks services unhealthy after heartbeat expiry", async () => {
    adapter.addService({
      name: "fragile",
      namespace: "default",
      mesh: "consul-connect",
      endpoints: 1,
      protocol: "HTTP",
      mtls: "strict",
      labels: {},
      healthy: true,
      versions: ["v1"],
    });

    // Force the heartbeat to be in the past (> heartbeatTtlMs)
    (adapter as any).heartbeats.set("default/fragile", Date.now() - 60_000);

    const { marked } = adapter.evaluateHealth();
    // Only "fragile" should be marked — gateway has a fresh heartbeat
    expect(marked).toBe(1);

    const svc = await adapter.getService("fragile", "default");
    expect(svc!.healthy).toBe(false);

    // Gateway should still be healthy
    const gw = await adapter.getService("espada-gateway", "default");
    expect(gw!.healthy).toBe(true);
  });

  it("recovers services with fresh heartbeat", async () => {
    adapter.addService({
      name: "resilient",
      namespace: "default",
      mesh: "consul-connect",
      endpoints: 1,
      protocol: "HTTP",
      mtls: "strict",
      labels: {},
      healthy: false,
      versions: ["v1"],
    });

    // Fresh heartbeat
    adapter.heartbeat("resilient", "default");
    adapter.evaluateHealth();

    const svc = await adapter.getService("resilient", "default");
    expect(svc!.healthy).toBe(true);
  });
});

// =============================================================================
// 5. DR → Audit + Event Bus Cross-Module
// =============================================================================

describe("DR → audit + event bus cross-module", () => {
  it("backup creation records audit AND publishes event", async () => {
    const auditRecords: unknown[] = [];
    const publishedEvents: unknown[] = [];

    const runtime = stubRuntime({
      dr: {
        createBackup: vi.fn(() => ({ id: "b-001", status: "complete", label: "test" })),
        listBackups: vi.fn(),
        getBackup: vi.fn(),
        verifyBackup: vi.fn(),
        restore: vi.fn(),
        startSchedule: vi.fn(),
        stopSchedule: vi.fn(),
      } as any,
      audit: {
        record: vi.fn((entry: unknown) => auditRecords.push(entry)),
      } as any,
      eventBus: {
        publish: vi.fn((evt: unknown) => publishedEvents.push(evt)),
      } as any,
    });

    const handler = createEnterpriseAdminHandler(runtime);
    const req = createMockReq("POST", "/admin/backup", { label: "test" });
    const res = createMockRes();
    await handler(req, res);

    expect(res._status).toBe(201);

    // Audit trail recorded
    expect(auditRecords).toHaveLength(1);
    expect((auditRecords[0] as any).action).toBe("infra.resource_created");
    expect((auditRecords[0] as any).resource.id).toBe("b-001");

    // Event bus received the event
    expect(publishedEvents).toHaveLength(1);
    expect((publishedEvents[0] as any).name).toBe("dr.backup.created");
    expect((publishedEvents[0] as any).data.backupId).toBe("b-001");
  });

  it("schedule start records audit AND publishes event", async () => {
    const publishedEvents: unknown[] = [];

    const runtime = stubRuntime({
      dr: {
        startSchedule: vi.fn(),
        stopSchedule: vi.fn(),
        createBackup: vi.fn(),
        listBackups: vi.fn(),
        getBackup: vi.fn(),
        verifyBackup: vi.fn(),
        restore: vi.fn(),
      } as any,
      audit: { record: vi.fn() } as any,
      eventBus: {
        publish: vi.fn((evt: unknown) => publishedEvents.push(evt)),
      } as any,
    });

    const handler = createEnterpriseAdminHandler(runtime);
    const req = createMockReq("POST", "/admin/backup/schedule", { intervalMs: 3600000 });
    const res = createMockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(publishedEvents.some((e: any) => e.name === "dr.schedule.started")).toBe(true);
  });
});

// =============================================================================
// 6. RBAC Gate Cross-Module
// =============================================================================

describe("Admin RBAC gate", () => {
  vi.mock("../auth.js", () => ({
    authorizeGatewayConnect: vi.fn(),
    authorizeGatewayPermission: vi.fn(),
  }));

  vi.mock("../http-utils.js", () => ({
    getBearerToken: vi.fn(() => "test-token"),
  }));

  beforeEach(async () => {
    const { authorizeGatewayConnect, authorizeGatewayPermission } = await import("../auth.js");
    (authorizeGatewayConnect as any).mockReset();
    (authorizeGatewayPermission as any).mockReset();
  });

  it("health and ready bypass RBAC", async () => {
    const runtime = stubRuntime({
      cluster: {
        healthCheck: () => ({
          status: "ok",
          statusCode: 200,
          body: { status: "ok", instanceId: "i1", role: "leader" },
        }),
      } as any,
    });
    const authCtx = {
      auth: {
        mode: "token" as const,
        allowTailscale: false,
        ssoEnabled: false,
        ssoAllowFallback: false,
      },
    };
    const handler = createEnterpriseAdminHandler(runtime, authCtx);
    const req = createMockReq("GET", "/health");
    const res = createMockRes();
    expect(await handler(req, res)).toBe(true);
    expect(res._status).toBe(200);
  });

  it("returns 401 when auth fails", async () => {
    const { authorizeGatewayConnect } = await import("../auth.js");
    (authorizeGatewayConnect as any).mockResolvedValue({ ok: false, reason: "no creds" });

    const runtime = stubRuntime({
      cluster: {
        healthCheck: () => ({ status: "ok" as const, instanceId: "i1", role: "leader" as const }),
        getInstances: () => [],
      } as any,
    });

    const handler = createEnterpriseAdminHandler(runtime, {
      auth: {
        mode: "token" as const,
        allowTailscale: false,
        ssoEnabled: false,
        ssoAllowFallback: false,
      },
    });
    const req = createMockReq("GET", "/admin/cluster/instances");
    const res = createMockRes();
    await handler(req, res);
    expect(res._status).toBe(401);
  });

  it("returns 403 when permission denied", async () => {
    const { authorizeGatewayConnect, authorizeGatewayPermission } = await import("../auth.js");
    (authorizeGatewayConnect as any).mockResolvedValue({ ok: true, method: "sso" });
    (authorizeGatewayPermission as any).mockResolvedValue({
      ok: false,
      reason: "missing operator.admin",
    });

    const runtime = stubRuntime({
      cluster: {
        healthCheck: () => ({ status: "ok" as const, instanceId: "i1", role: "leader" as const }),
        getInstances: () => [],
      } as any,
    });

    const handler = createEnterpriseAdminHandler(runtime, {
      auth: {
        mode: "oidc" as const,
        allowTailscale: false,
        ssoEnabled: true,
        ssoAllowFallback: false,
      },
    });
    const req = createMockReq("GET", "/admin/cluster/instances");
    const res = createMockRes();
    await handler(req, res);
    expect(res._status).toBe(403);
  });

  it("allows through when auth + permission pass", async () => {
    const { authorizeGatewayConnect, authorizeGatewayPermission } = await import("../auth.js");
    (authorizeGatewayConnect as any).mockResolvedValue({ ok: true, method: "token" });
    (authorizeGatewayPermission as any).mockResolvedValue({ ok: true });

    const runtime = stubRuntime({
      cluster: {
        healthCheck: () => ({ status: "ok" as const, instanceId: "i1", role: "leader" as const }),
        getInstances: () => [{ id: "i1" }],
      } as any,
    });

    const handler = createEnterpriseAdminHandler(runtime, {
      auth: {
        mode: "token" as const,
        allowTailscale: false,
        ssoEnabled: false,
        ssoAllowFallback: false,
      },
    });
    const req = createMockReq("GET", "/admin/cluster/instances");
    const res = createMockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  it("works without authCtx (backwards compat)", async () => {
    const runtime = stubRuntime({
      cluster: {
        healthCheck: () => ({ status: "ok" as const, instanceId: "i1", role: "leader" as const }),
        getInstances: () => [{ id: "i1" }],
      } as any,
    });
    const handler = createEnterpriseAdminHandler(runtime);
    const req = createMockReq("GET", "/admin/cluster/instances");
    const res = createMockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });
});

// =============================================================================
// 7. Configuration Validation
// =============================================================================

describe("validateEnterpriseConfig", () => {
  it("returns valid for empty config", () => {
    const result = validateEnterpriseConfig({});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("errors when cluster.enabled without address", () => {
    const result = validateEnterpriseConfig({ cluster: { enabled: true } });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("cluster.address");
  });

  it("warns on very low cluster leaseTtlMs", () => {
    const result = validateEnterpriseConfig({
      cluster: { enabled: true, address: "localhost:9000", leaseTtlMs: 500 },
    });
    expect(result.warnings.some((w) => w.includes("leaseTtlMs"))).toBe(true);
  });

  it("errors on bad DR encryption key length", () => {
    const result = validateEnterpriseConfig({
      dr: { enabled: true, encryptionKey: "tooshort" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("64 hex chars");
  });

  it("errors on non-hex DR encryption key", () => {
    const result = validateEnterpriseConfig({
      dr: { enabled: true, encryptionKey: "z".repeat(64) },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("hexadecimal");
  });

  it("warns on aggressive DR schedule", () => {
    const result = validateEnterpriseConfig({
      dr: { enabled: true, scheduleIntervalMs: 5000 },
    });
    expect(result.warnings.some((w) => w.includes("scheduleIntervalMs"))).toBe(true);
  });

  it("errors on maxBackups < 1", () => {
    const result = validateEnterpriseConfig({
      dr: { enabled: true, maxBackups: 0 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("maxBackups");
  });

  it("errors on invalid audit severity", () => {
    const result = validateEnterpriseConfig({
      audit: { enabled: true, minSeverity: "banana" as any },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("minSeverity");
  });

  it("errors on vault backend without address", () => {
    const result = validateEnterpriseConfig({
      secrets: { enabled: true, backends: [{ type: "vault" }] },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("vault.address");
  });

  it("errors on file backend without path", () => {
    const result = validateEnterpriseConfig({
      secrets: { enabled: true, backends: [{ type: "file" }] },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("file.path");
  });

  it("warns about DR encryption without secrets manager", () => {
    const result = validateEnterpriseConfig({
      dr: { enabled: true, encryptionKey: "a".repeat(64) },
    });
    expect(result.warnings.some((w) => w.includes("encryption") && w.includes("secrets"))).toBe(
      true,
    );
  });

  it("passes valid complete config", () => {
    const result = validateEnterpriseConfig({
      persistentState: { enabled: true },
      audit: { enabled: true, minSeverity: "warn" },
      eventBus: { enabled: true },
      cluster: { enabled: true, address: "localhost:9000" },
      dr: { enabled: true, encryptionKey: "a1b2c3d4".repeat(8) },
      secrets: { enabled: true, backends: [{ type: "env" }] },
      drift: { enabled: true },
      serviceMesh: { enabled: true },
      taskQueue: { enabled: true },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// =============================================================================
// 8. Mesh → Admin → Metrics (cross-module)
// =============================================================================

describe("Mesh admin endpoint → metrics", () => {
  it("GET /admin/mesh/services returns registered services", async () => {
    const meshAdapter = new LocalMeshAdapter();
    meshAdapter.addService({
      name: "payments",
      namespace: "prod",
      mesh: "consul-connect",
      endpoints: 2,
      protocol: "gRPC",
      mtls: "strict",
      labels: { tier: "critical" },
      healthy: true,
      versions: ["v3"],
    });

    const runtime = stubRuntime({
      serviceMesh: {
        listAllServices: (ns?: string) => meshAdapter.listServices(ns),
        listServices: (ns?: string) => meshAdapter.listServices(ns),
        getService: (n: string, ns: string) => meshAdapter.getService(n, ns),
        getMetrics: (s: string, ns: string) => meshAdapter.getMetrics(s, ns),
        getMtlsStatus: (ns?: string) => meshAdapter.getMtlsStatus(ns),
        listRoutes: (ns?: string) => meshAdapter.listRoutes(ns),
      } as any,
    });

    const handler = createEnterpriseAdminHandler(runtime);
    const req = createMockReq("GET", "/admin/mesh/services");
    const res = createMockRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    const body = res.json() as any;
    expect(body.services.length).toBeGreaterThanOrEqual(2); // gateway + payments
  });
});

// =============================================================================
// 9. OpenAPI Spec & Routes (meta endpoints)
// =============================================================================

import { buildOpenApiSpec, buildRouteSummary, ADMIN_ROUTES } from "./admin-openapi.js";

describe("Admin OpenAPI spec", () => {
  it("buildOpenApiSpec returns valid 3.1 structure", () => {
    const spec = buildOpenApiSpec() as any;
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toContain("Espada");
    expect(Object.keys(spec.paths).length).toBeGreaterThanOrEqual(20);
  });

  it("every ADMIN_ROUTES entry appears in spec paths", () => {
    const spec = buildOpenApiSpec() as any;
    for (const route of ADMIN_ROUTES) {
      const pathObj = spec.paths[route.path];
      expect(pathObj, `Missing path: ${route.path}`).toBeDefined();
      expect(
        pathObj[route.method.toLowerCase()],
        `Missing ${route.method} ${route.path}`,
      ).toBeDefined();
    }
  });

  it("RBAC endpoints have security in spec", () => {
    const spec = buildOpenApiSpec() as any;
    for (const route of ADMIN_ROUTES.filter((r) => r.auth === "rbac")) {
      const op = spec.paths[route.path][route.method.toLowerCase()];
      expect(op.security).toBeDefined();
      expect(op.security[0]).toHaveProperty("BearerAuth");
    }
  });

  it("health/ready have no security in spec", () => {
    const spec = buildOpenApiSpec() as any;
    expect(spec.paths["/health"].get.security).toBeUndefined();
    expect(spec.paths["/ready"].get.security).toBeUndefined();
  });

  it("buildRouteSummary returns all routes", () => {
    const summary = buildRouteSummary();
    expect(summary.total).toBe(ADMIN_ROUTES.length);
    expect(summary.routes).toEqual(ADMIN_ROUTES);
  });
});

describe("Admin meta endpoints via handler", () => {
  it("GET /admin/openapi.json serves the spec", async () => {
    const runtime = stubRuntime();
    const handler = createEnterpriseAdminHandler(runtime);
    const req = createMockReq("GET", "/admin/openapi.json");
    const res = createMockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    const body = res.json() as any;
    expect(body.openapi).toBe("3.1.0");
  });

  it("GET /admin/routes serves route summary", async () => {
    const runtime = stubRuntime();
    const handler = createEnterpriseAdminHandler(runtime);
    const req = createMockReq("GET", "/admin/routes");
    const res = createMockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    const body = res.json() as any;
    expect(body.total).toBeGreaterThanOrEqual(20);
    expect(Array.isArray(body.routes)).toBe(true);
  });
});
