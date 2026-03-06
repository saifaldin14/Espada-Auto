/**
 * Unit tests for the Enterprise Admin HTTP handler (Phase 2).
 *
 * Tests all admin endpoints: /health, /ready, /admin/cluster/*,
 * /admin/backup*, /admin/secrets/*, /admin/drift/*, /admin/mesh/*.
 *
 * Uses minimal mock objects to exercise the handler routing and
 * response serialization without requiring real SQLite databases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createEnterpriseAdminHandler } from "../../../gateway/server-enterprise-admin.js";
import type { EnterpriseRuntime } from "../../../gateway/enterprise/index.js";

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Enterprise Admin HTTP Handler", () => {
  // ==========================================================================
  // Null enterprise → passthrough
  // ==========================================================================
  describe("null enterprise", () => {
    it("returns false for all requests when enterprise is null", async () => {
      const handler = createEnterpriseAdminHandler(null);
      const req = createMockReq("GET", "/health");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(false);
    });
  });

  // ==========================================================================
  // /health endpoint
  // ==========================================================================
  describe("GET /health", () => {
    it("returns cluster health when cluster is present", async () => {
      const cluster = {
        healthCheck: () => ({
          status: "ok" as const,
          statusCode: 200,
          body: { status: "ok", instances: 3, leader: "i-1" },
        }),
      };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ cluster } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/health");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.status).toBe("ok");
      expect(body.instances).toBe(3);
    });

    it("returns simple ok when cluster is not enabled", async () => {
      const handler = createEnterpriseAdminHandler(stubRuntime());
      const req = createMockReq("GET", "/health");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.status).toBe("ok");
      expect(body.cluster).toBe(false);
    });
  });

  // ==========================================================================
  // /ready endpoint
  // ==========================================================================
  describe("GET /ready", () => {
    it("returns ready check from cluster", async () => {
      const cluster = {
        readinessCheck: () => ({
          ready: true,
          statusCode: 200,
          reason: undefined,
        }),
      };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ cluster } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/ready");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.ready).toBe(true);
    });

    it("returns 503 when cluster not ready", async () => {
      const cluster = {
        readinessCheck: () => ({
          ready: false,
          statusCode: 503,
          reason: "Leader election pending",
        }),
      };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ cluster } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/ready");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(503);
      expect((res.json() as Record<string, unknown>).reason).toBe("Leader election pending");
    });

    it("returns ready=true when cluster not enabled", async () => {
      const handler = createEnterpriseAdminHandler(stubRuntime());
      const req = createMockReq("GET", "/ready");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      const body = res.json() as Record<string, unknown>;
      expect(body.ready).toBe(true);
      expect(body.cluster).toBe(false);
    });
  });

  // ==========================================================================
  // /admin/cluster/* endpoints
  // ==========================================================================
  describe("GET /admin/cluster/instances", () => {
    it("returns list of cluster instances", async () => {
      const instances = [
        { id: "i-1", name: "node-1", role: "leader" },
        { id: "i-2", name: "node-2", role: "follower" },
      ];
      const cluster = { getInstances: () => instances };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ cluster } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/cluster/instances");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect((res.json() as Record<string, unknown>).instances).toEqual(instances);
    });

    it("returns 404 when cluster not enabled", async () => {
      const handler = createEnterpriseAdminHandler(stubRuntime());
      const req = createMockReq("GET", "/admin/cluster/instances");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(404);
    });
  });

  describe("GET /admin/cluster/leader", () => {
    it("returns leader info and lease", async () => {
      const cluster = {
        getLeader: () => ({ id: "i-1", name: "leader-node" }),
        getLease: () => ({ holder: "i-1", fencingToken: 42, expiresAt: "2025-01-01T00:00:00Z" }),
      };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ cluster } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/cluster/leader");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.leader).toBeTruthy();
      expect(body.lease).toBeTruthy();
    });
  });

  // ==========================================================================
  // /admin/backup* (DR) endpoints
  // ==========================================================================
  describe("POST /admin/backup", () => {
    it("creates backup and returns manifest", async () => {
      const manifest = { id: "b-1", status: "completed", label: "test" };
      const dr = { createBackup: vi.fn(() => manifest) };
      const audit = { record: vi.fn() };
      const eventBus = { publish: vi.fn() };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ dr, audit, eventBus } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("POST", "/admin/backup", { label: "test" });
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(201);
      expect((res.json() as Record<string, unknown>).id).toBe("b-1");
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(eventBus.publish).toHaveBeenCalledTimes(1);
    });

    it("returns 404 when DR not enabled", async () => {
      const handler = createEnterpriseAdminHandler(stubRuntime());
      const req = createMockReq("POST", "/admin/backup");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(404);
    });

    it("returns 500 when backup creation fails", async () => {
      const dr = {
        createBackup: vi.fn(() => {
          throw new Error("disk full");
        }),
      };
      const audit = { record: vi.fn() };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ dr, audit } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("POST", "/admin/backup", {});
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(500);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error" }));
    });
  });

  describe("GET /admin/backups", () => {
    it("lists backup manifests with pagination", async () => {
      const manifests = [
        { id: "b-1", status: "completed" },
        { id: "b-2", status: "in-progress" },
      ];
      const dr = { listManifests: vi.fn(() => manifests) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ dr } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/backups?limit=10&offset=0");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.manifests).toEqual(manifests);
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(0);
    });
  });

  describe("GET /admin/backup/:id", () => {
    it("returns single backup manifest", async () => {
      const manifest = { id: "b-1", status: "completed" };
      const dr = { getManifest: vi.fn(() => manifest) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ dr } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/backup/b-1");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect((res.json() as Record<string, unknown>).id).toBe("b-1");
    });

    it("returns 404 for unknown backup", async () => {
      const dr = { getManifest: vi.fn(() => null) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ dr } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/backup/missing");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(404);
    });
  });

  describe("POST /admin/restore", () => {
    it("restores backup and logs audit + events", async () => {
      const dr = {
        restore: vi.fn(() => ({ success: true, filesRestored: 12, errors: [] })),
      };
      const audit = { record: vi.fn() };
      const eventBus = { publish: vi.fn() };
      const cluster = {
        setHealth: vi.fn(),
      };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ dr, audit, eventBus, cluster } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("POST", "/admin/restore", { backupId: "b-1" });
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect((res.json() as Record<string, unknown>).success).toBe(true);
      // Should mark cluster degraded during restore and healthy after
      expect(cluster.setHealth).toHaveBeenCalledWith("degraded");
      expect(cluster.setHealth).toHaveBeenCalledWith("healthy");
      expect(audit.record).toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalled();
    });

    it("returns 400 when backupId missing", async () => {
      const dr = { restore: vi.fn() };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ dr } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("POST", "/admin/restore", {});
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(400);
      expect(dr.restore).not.toHaveBeenCalled();
    });
  });

  describe("POST /admin/backup/:id/verify", () => {
    it("verifies backup integrity", async () => {
      const dr = {
        verifyBackup: vi.fn(() => ({ valid: true, errors: [] })),
      };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ dr } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("POST", "/admin/backup/b-1/verify");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect((res.json() as Record<string, unknown>).valid).toBe(true);
    });

    it("returns 422 for invalid backup", async () => {
      const dr = {
        verifyBackup: vi.fn(() => ({ valid: false, errors: ["checksum mismatch"] })),
      };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ dr } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("POST", "/admin/backup/b-bad/verify");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(422);
    });
  });

  // ==========================================================================
  // /admin/secrets/* endpoints
  // ==========================================================================
  describe("GET /admin/secrets", () => {
    it("lists secret keys", async () => {
      const secrets = { list: vi.fn(async () => ["API_KEY", "DB_PASS"]) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ secrets } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/secrets");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect((res.json() as Record<string, unknown>).keys).toEqual(["API_KEY", "DB_PASS"]);
    });
  });

  describe("GET /admin/secrets/:key", () => {
    it("returns masked secret value", async () => {
      const secrets = {
        get: vi.fn(async () => ({
          key: "API_KEY",
          value: "sk-1234567890abcdef",
          backend: "env",
          metadata: {},
          createdAt: "2025-01-01",
          updatedAt: "2025-01-01",
        })),
      };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ secrets } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/secrets/API_KEY");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.key).toBe("API_KEY");
      // Value should be masked with fixed-length mask (no prefix/length leakage)
      expect(body.value).toBe("****");
    });

    it("returns 404 for unknown secret", async () => {
      const secrets = { get: vi.fn(async () => null) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ secrets } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/secrets/MISSING");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(404);
    });
  });

  describe("PUT /admin/secrets/:key", () => {
    it("sets secret and records audit", async () => {
      const secrets = {
        set: vi.fn(async () => ({ key: "NEW_KEY", backend: "env" })),
      };
      const audit = { record: vi.fn() };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ secrets, audit } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("PUT", "/admin/secrets/NEW_KEY", { value: "secret-val" });
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect(secrets.set).toHaveBeenCalledWith("NEW_KEY", "secret-val", expect.anything());
      expect(audit.record).toHaveBeenCalled();
    });

    it("returns 400 when value missing", async () => {
      const secrets = { set: vi.fn() };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ secrets } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("PUT", "/admin/secrets/KEY", {});
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(400);
    });
  });

  describe("DELETE /admin/secrets/:key", () => {
    it("deletes secret and records audit", async () => {
      const secrets = { delete: vi.fn(async () => true) };
      const audit = { record: vi.fn() };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ secrets, audit } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("DELETE", "/admin/secrets/OLD_KEY");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect(audit.record).toHaveBeenCalled();
    });

    it("returns 404 when secret does not exist", async () => {
      const secrets = { delete: vi.fn(async () => false) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ secrets } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("DELETE", "/admin/secrets/NOPE");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(404);
    });
  });

  // ==========================================================================
  // /admin/drift/* endpoints
  // ==========================================================================
  describe("POST /admin/drift/scan", () => {
    it("runs drift scan and logs audit", async () => {
      const results = [{ id: "d-1", type: "terraform", status: "detected" }];
      const drift = { runAllScans: vi.fn(async () => results) };
      const audit = { record: vi.fn() };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ drift, audit } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("POST", "/admin/drift/scan");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect((res.json() as Record<string, unknown>).results).toEqual(results);
      expect(audit.record).toHaveBeenCalled();
    });
  });

  describe("GET /admin/drift/results", () => {
    it("returns filtered drift results", async () => {
      const drifts = [{ id: "d-1" }];
      const drift = { listDrifts: vi.fn(() => drifts) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ drift } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/drift/results?limit=5&status=detected");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect((res.json() as Record<string, unknown>).drifts).toEqual(drifts);
      expect((res.json() as Record<string, unknown>).limit).toBe(5);
    });
  });

  describe("GET /admin/drift/stats", () => {
    it("returns drift statistics", async () => {
      const stats = { total: 10, byStatus: { detected: 5, resolved: 5 } };
      const drift = { getStats: vi.fn(() => stats) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ drift } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/drift/stats");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect((res.json() as Record<string, unknown>).total).toBe(10);
    });
  });

  describe("GET /admin/drift/policies", () => {
    it("returns drift policies", async () => {
      const policies = [{ id: "p-1", name: "no-drift", action: "alert" }];
      const drift = { listPolicies: vi.fn(() => policies) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ drift } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/drift/policies");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect((res.json() as Record<string, unknown>).policies).toEqual(policies);
    });
  });

  describe("POST /admin/drift/policies", () => {
    it("adds a drift policy", async () => {
      const policy = { id: "p-1", name: "block-drift", provider: "terraform", action: "block" };
      const drift = { addPolicy: vi.fn(() => policy) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ drift } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("POST", "/admin/drift/policies", {
        name: "block-drift",
        provider: "terraform",
        action: "block",
      });
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(201);
      expect((res.json() as Record<string, unknown>).id).toBe("p-1");
    });

    it("returns 400 when required fields missing", async () => {
      const drift = { addPolicy: vi.fn() };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ drift } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("POST", "/admin/drift/policies", { name: "only-name" });
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(400);
    });
  });

  describe("DELETE /admin/drift/policies/:id", () => {
    it("deletes a drift policy", async () => {
      const drift = { deletePolicy: vi.fn(() => true) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ drift } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("DELETE", "/admin/drift/policies/p-1");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
    });

    it("returns 404 for unknown policy", async () => {
      const drift = { deletePolicy: vi.fn(() => false) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ drift } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("DELETE", "/admin/drift/policies/missing");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(404);
    });
  });

  // ==========================================================================
  // /admin/mesh/* endpoints
  // ==========================================================================
  describe("GET /admin/mesh/services", () => {
    it("returns mesh services", async () => {
      const services = [{ name: "web", namespace: "default" }];
      const serviceMesh = { listAllServices: vi.fn(async () => services) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ serviceMesh } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/mesh/services");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect((res.json() as Record<string, unknown>).services).toEqual(services);
    });

    it("passes namespace query param", async () => {
      const serviceMesh = { listAllServices: vi.fn(async () => []) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ serviceMesh } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/mesh/services?namespace=prod");
      const res = createMockRes();
      await handler(req, res);
      expect(serviceMesh.listAllServices).toHaveBeenCalledWith("prod");
    });
  });

  describe("GET /admin/mesh/dashboard", () => {
    it("returns traffic dashboard", async () => {
      const dashboard = { services: [], metrics: [], routes: [] };
      const serviceMesh = { getTrafficDashboard: vi.fn(async () => dashboard) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ serviceMesh } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/mesh/dashboard");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect(res.json()).toEqual(dashboard);
    });
  });

  describe("GET /admin/mesh/canary", () => {
    it("returns canary deployments", async () => {
      const deployments = [{ name: "canary-v2", weight: 10 }];
      const serviceMesh = { getCanaryDeployments: vi.fn(() => deployments) };
      const handler = createEnterpriseAdminHandler(
        stubRuntime({ serviceMesh } as unknown as Partial<EnterpriseRuntime>),
      );
      const req = createMockReq("GET", "/admin/mesh/canary");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(200);
      expect((res.json() as Record<string, unknown>).deployments).toEqual(deployments);
    });

    it("returns 404 when mesh not enabled", async () => {
      const handler = createEnterpriseAdminHandler(stubRuntime());
      const req = createMockReq("GET", "/admin/mesh/canary");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(true);
      expect(res._status).toBe(404);
    });
  });

  // ==========================================================================
  // Unknown routes → passthrough
  // ==========================================================================
  describe("unknown routes", () => {
    it("returns false for non-admin paths", async () => {
      const handler = createEnterpriseAdminHandler(stubRuntime());
      const req = createMockReq("GET", "/api/v1/something");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(false);
    });

    it("returns false for unknown /admin/* paths", async () => {
      const handler = createEnterpriseAdminHandler(stubRuntime());
      const req = createMockReq("GET", "/admin/unknown/endpoint");
      const res = createMockRes();
      expect(await handler(req, res)).toBe(false);
    });
  });
});
