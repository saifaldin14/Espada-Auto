/**
 * Comprehensive QA Tests — Local Mesh Adapter
 *
 * Enterprise-grade coverage:
 * - Default gateway service registration
 * - addService / removeService lifecycle
 * - Heartbeat tracking + evaluateHealth (stale → unhealthy, fresh → recover)
 * - Service listing and filtering by namespace
 * - Route CRUD (apply, list, delete)
 * - Circuit breaker storage
 * - Authorization policy CRUD
 * - Baseline metrics
 * - mTLS status reporting
 */

import { describe, it, expect, vi } from "vitest";
import { LocalMeshAdapter } from "./local-adapter.js";
import type { MeshService, TrafficRoute, AuthorizationPolicy } from "./service-mesh.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSvc(overrides?: Partial<MeshService>): MeshService {
  return {
    name: "svc-a",
    namespace: "default",
    mesh: "consul-connect",
    endpoints: 1,
    protocol: "HTTP",
    mtls: "permissive",
    labels: {},
    healthy: true,
    ...overrides,
  };
}

function makeRoute(overrides?: Partial<TrafficRoute>): TrafficRoute {
  return {
    id: "route-1",
    name: "test-route",
    service: "frontend",
    namespace: "default",
    mesh: "consul-connect",
    matches: [],
    destinations: [{ subset: "v1", weight: 100 }],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════

describe("LocalMeshAdapter", () => {
  // ── Default Registration ───────────────────────────────────────────────────

  it("registers the gateway service on construction", async () => {
    const adapter = new LocalMeshAdapter();
    const all = await adapter.listServices();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("espada-gateway");
    expect(all[0].healthy).toBe(true);
  });

  it("has provider 'consul-connect'", () => {
    const adapter = new LocalMeshAdapter();
    expect(adapter.provider).toBe("consul-connect");
  });

  // ── addService / removeService ─────────────────────────────────────────────

  describe("addService / removeService", () => {
    it("adds a service that is then visible in listServices", async () => {
      const adapter = new LocalMeshAdapter();
      adapter.addService(makeSvc({ name: "new-svc", namespace: "prod" }));

      const all = await adapter.listServices();
      expect(all).toHaveLength(2); // gateway + new-svc
    });

    it("removeService removes the service and heartbeat", async () => {
      const adapter = new LocalMeshAdapter();
      adapter.addService(makeSvc({ name: "temp", namespace: "default" }));
      adapter.removeService("temp", "default");

      const all = await adapter.listServices();
      expect(all).toHaveLength(1); // only gateway remains
    });
  });

  // ── Heartbeat & Health ─────────────────────────────────────────────────────

  describe("heartbeat & evaluateHealth", () => {
    it("marks service unhealthy when heartbeat expires", async () => {
      const adapter = new LocalMeshAdapter();
      adapter.addService(makeSvc({ name: "worker", namespace: "default" }));

      // Force the heartbeat timestamp to be very old
      const heartbeats = (adapter as any).heartbeats as Map<string, number>;
      heartbeats.set("default/worker", Date.now() - 60_000);

      const result = adapter.evaluateHealth();
      expect(result.marked).toBeGreaterThanOrEqual(1);

      const svc = await adapter.getService("worker", "default");
      expect(svc!.healthy).toBe(false);
    });

    it("recovers service when heartbeat is fresh again", async () => {
      const adapter = new LocalMeshAdapter();
      adapter.addService(makeSvc({ name: "worker", namespace: "default" }));

      // First mark unhealthy
      const heartbeats = (adapter as any).heartbeats as Map<string, number>;
      heartbeats.set("default/worker", Date.now() - 60_000);
      adapter.evaluateHealth();

      expect((await adapter.getService("worker", "default"))!.healthy).toBe(false);

      // Send a fresh heartbeat
      adapter.heartbeat("worker", "default");
      adapter.evaluateHealth();

      expect((await adapter.getService("worker", "default"))!.healthy).toBe(true);
    });

    it("heartbeat is no-op for unknown service", () => {
      const adapter = new LocalMeshAdapter();
      // Should not throw
      adapter.heartbeat("unknown", "default");
    });
  });

  // ── Service Listing ────────────────────────────────────────────────────────

  describe("listServices / getService", () => {
    it("filters by namespace", async () => {
      const adapter = new LocalMeshAdapter();
      adapter.addService(makeSvc({ name: "a", namespace: "prod" }));
      adapter.addService(makeSvc({ name: "b", namespace: "staging" }));

      const prod = await adapter.listServices("prod");
      expect(prod).toHaveLength(1);
      expect(prod[0].name).toBe("a");
    });

    it("returns all services when namespace is '*'", async () => {
      const adapter = new LocalMeshAdapter();
      adapter.addService(makeSvc({ name: "x", namespace: "ns1" }));

      const all = await adapter.listServices("*");
      expect(all).toHaveLength(2); // gateway + x
    });

    it("getService returns null for unknown service", async () => {
      const adapter = new LocalMeshAdapter();
      expect(await adapter.getService("nope", "default")).toBeNull();
    });
  });

  // ── Route CRUD ─────────────────────────────────────────────────────────────

  describe("route management", () => {
    it("applies and lists routes", async () => {
      const adapter = new LocalMeshAdapter();
      await adapter.applyRoute(makeRoute());

      const routes = await adapter.listRoutes();
      expect(routes).toHaveLength(1);
    });

    it("filters routes by namespace", async () => {
      const adapter = new LocalMeshAdapter();
      await adapter.applyRoute(makeRoute({ namespace: "prod" }));
      await adapter.applyRoute(makeRoute({ id: "r2", name: "r2", namespace: "staging" }));

      expect(await adapter.listRoutes("prod")).toHaveLength(1);
    });

    it("deletes a route", async () => {
      const adapter = new LocalMeshAdapter();
      await adapter.applyRoute(makeRoute({ namespace: "default" }));

      await adapter.deleteRoute("test-route", "default");
      expect(await adapter.listRoutes()).toHaveLength(0);
    });
  });

  // ── Circuit Breaker ────────────────────────────────────────────────────────

  describe("circuit breaker", () => {
    it("stores circuit breaker config", async () => {
      const adapter = new LocalMeshAdapter();
      await adapter.applyCircuitBreaker("svc", "default", {
        maxConnections: 100,
        maxPendingRequests: 50,
        maxRequestsPerConnection: 10,
        maxRetries: 3,
      });
      // No throw — stored internally
    });
  });

  // ── Authorization Policy ───────────────────────────────────────────────────

  describe("authorization policy", () => {
    it("applies and deletes a policy", async () => {
      const adapter = new LocalMeshAdapter();
      const policy: AuthorizationPolicy = {
        name: "deny-external",
        namespace: "default",
        action: "DENY",
        rules: [{ from: [{ ipBlocks: ["0.0.0.0/0"] }] }],
      };

      await adapter.applyAuthorizationPolicy(policy);
      await adapter.deleteAuthorizationPolicy("deny-external", "default");
      // Should not throw
    });
  });

  // ── Metrics ────────────────────────────────────────────────────────────────

  describe("getMetrics", () => {
    it("returns baseline zero metrics", async () => {
      const adapter = new LocalMeshAdapter();
      const metrics = await adapter.getMetrics("svc", "default");

      expect(metrics.requestRate).toBe(0);
      expect(metrics.successRate).toBe(1.0);
      expect(metrics.latency.p50).toBe(0);
      expect(metrics.bytesIn).toBe(0);
      expect(metrics.window).toBe("5m");
    });

    it("uses custom window when provided", async () => {
      const adapter = new LocalMeshAdapter();
      const metrics = await adapter.getMetrics("svc", "default", "1h");
      expect(metrics.window).toBe("1h");
    });
  });

  // ── mTLS Status ────────────────────────────────────────────────────────────

  describe("getMtlsStatus", () => {
    it("returns mTLS status for all services", async () => {
      const adapter = new LocalMeshAdapter();
      const status = await adapter.getMtlsStatus();
      expect(status).toHaveLength(1);
      expect(status[0].mtls).toBe("permissive");
    });

    it("filters by namespace", async () => {
      const adapter = new LocalMeshAdapter();
      adapter.addService(makeSvc({ name: "other", namespace: "prod" }));

      const status = await adapter.getMtlsStatus("prod");
      expect(status).toHaveLength(1);
      expect(status[0].service).toBe("other");
    });
  });
});
