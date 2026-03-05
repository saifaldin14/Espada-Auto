/**
 * Local Service Mesh Adapter
 *
 * A lightweight in-process mesh adapter that tracks locally registered
 * services without requiring Kubernetes, Istio, or Linkerd. Useful for
 * development, testing, and single-node deployments where the admin
 * mesh endpoints should still return meaningful data.
 *
 */

import { randomUUID } from "node:crypto";
import type {
  AuthorizationPolicy,
  CircuitBreakerConfig,
  MeshAdapter,
  MeshService,
  TrafficMetrics,
  TrafficRoute,
} from "./service-mesh.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("enterprise").child("mesh-local");

export class LocalMeshAdapter implements MeshAdapter {
  readonly provider = "consul-connect" as const;

  private services = new Map<string, MeshService>();
  private routes = new Map<string, TrafficRoute>();
  private circuitBreakers = new Map<string, CircuitBreakerConfig>();
  private policies = new Map<string, AuthorizationPolicy>();
  /** Track last heartbeat per service key for health-status updates. */
  private heartbeats = new Map<string, number>();
  /** Max time between heartbeats before marking a service unhealthy. */
  private readonly heartbeatTtlMs = 30_000;

  constructor() {
    // Register the gateway itself as a baseline service
    const gatewayKey = "default/espada-gateway";
    this.services.set(gatewayKey, {
      name: "espada-gateway",
      namespace: "default",
      mesh: "consul-connect",
      endpoints: 1,
      protocol: "HTTP",
      mtls: "permissive",
      labels: { app: "espada", component: "gateway" },
      healthy: true,
      versions: ["current"],
    });
    this.heartbeats.set(gatewayKey, Date.now());
  }

  /** Register a local service (e.g. called when channels start). */
  addService(service: MeshService): void {
    const key = `${service.namespace}/${service.name}`;
    this.services.set(key, service);
    this.heartbeats.set(key, Date.now());
    log.info("service registered", { name: service.name, namespace: service.namespace });
  }

  /** Remove a local service. */
  removeService(name: string, namespace: string): void {
    const key = `${namespace}/${name}`;
    this.services.delete(key);
    this.heartbeats.delete(key);
    log.info("service removed", { name, namespace });
  }

  /** Record a heartbeat for a service — keeps it marked healthy. */
  heartbeat(name: string, namespace: string): void {
    const key = `${namespace}/${name}`;
    if (this.services.has(key)) {
      this.heartbeats.set(key, Date.now());
    }
  }

  /** Evaluate health of all services based on heartbeat freshness. */
  evaluateHealth(): { marked: number } {
    let marked = 0;
    const now = Date.now();
    for (const [key, svc] of this.services) {
      const lastBeat = this.heartbeats.get(key) ?? 0;
      const stale = now - lastBeat > this.heartbeatTtlMs;
      if (stale && svc.healthy) {
        svc.healthy = false;
        marked++;
        log.warn("service marked unhealthy (heartbeat expired)", {
          name: svc.name,
          namespace: svc.namespace,
        });
      } else if (!stale && !svc.healthy) {
        svc.healthy = true;
        log.info("service recovered (heartbeat fresh)", {
          name: svc.name,
          namespace: svc.namespace,
        });
      }
    }
    return { marked };
  }

  async listServices(namespace?: string): Promise<MeshService[]> {
    const all = Array.from(this.services.values());
    if (!namespace || namespace === "*") return all;
    return all.filter((s) => s.namespace === namespace);
  }

  async getService(name: string, namespace: string): Promise<MeshService | null> {
    return this.services.get(`${namespace}/${name}`) ?? null;
  }

  async applyRoute(route: TrafficRoute): Promise<void> {
    this.routes.set(route.id ?? `${route.namespace}/${route.name}`, route);
    log.debug("route applied", { name: route.name, namespace: route.namespace });
  }

  async deleteRoute(name: string, namespace: string): Promise<void> {
    // Try both keying patterns
    this.routes.delete(`${namespace}/${name}`);
    for (const [key, route] of this.routes) {
      if (route.name === name && route.namespace === namespace) {
        this.routes.delete(key);
        break;
      }
    }
  }

  async listRoutes(namespace?: string): Promise<TrafficRoute[]> {
    const all = Array.from(this.routes.values());
    if (!namespace || namespace === "*") return all;
    return all.filter((r) => r.namespace === namespace);
  }

  async applyCircuitBreaker(
    service: string,
    namespace: string,
    config: CircuitBreakerConfig,
  ): Promise<void> {
    this.circuitBreakers.set(`${namespace}/${service}`, config);
  }

  async applyAuthorizationPolicy(policy: AuthorizationPolicy): Promise<void> {
    this.policies.set(`${policy.namespace}/${policy.name}`, policy);
  }

  async deleteAuthorizationPolicy(name: string, namespace: string): Promise<void> {
    this.policies.delete(`${namespace}/${name}`);
  }

  async getMetrics(service: string, namespace: string, window?: string): Promise<TrafficMetrics> {
    // Return baseline metrics for local services
    return {
      service,
      namespace,
      window: window ?? "5m",
      requestRate: 0,
      successRate: 1.0,
      latency: { p50: 0, p90: 0, p99: 0 },
      bytesIn: 0,
      bytesOut: 0,
    };
  }

  async getMtlsStatus(
    namespace?: string,
  ): Promise<Array<{ service: string; namespace: string; mtls: string }>> {
    const services = await this.listServices(namespace);
    return services.map((s) => ({
      service: s.name,
      namespace: s.namespace,
      mtls: s.mtls,
    }));
  }
}
