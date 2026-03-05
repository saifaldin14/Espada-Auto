/**
 * Service Mesh Integration — Istio & Linkerd Observability + Management
 *
 * Provides tools and gateway methods for managing service mesh
 * configurations, observing traffic flow, and enforcing policies.
 *
 * Features:
 * - Traffic routing rules (VirtualService / TrafficSplit)
 * - mTLS policy management
 * - Circuit breaker configuration
 * - Canary deployment support
 * - Traffic observability (metrics proxy)
 * - Service discovery integration
 * - Authorization policy management
 *
 */

import { randomUUID } from "node:crypto";

// =============================================================================
// Types
// =============================================================================

export type MeshProvider = "istio" | "linkerd" | "consul-connect";

export type ProtocolType = "HTTP" | "HTTPS" | "gRPC" | "TCP" | "TLS";

/**
 * A service in the mesh.
 */
export interface MeshService {
  /** Service name */
  name: string;

  /** Namespace */
  namespace: string;

  /** Service mesh provider */
  mesh: MeshProvider;

  /** Endpoints/pods count */
  endpoints: number;

  /** Protocol */
  protocol: ProtocolType;

  /** mTLS status */
  mtls: "strict" | "permissive" | "disabled";

  /** Labels */
  labels: Record<string, string>;

  /** Health status */
  healthy: boolean;

  /** Version (from Istio DestinationRule or Linkerd annotation) */
  versions?: string[];
}

/**
 * Traffic routing rule.
 */
export interface TrafficRoute {
  /** Unique ID */
  id: string;

  /** Rule name */
  name: string;

  /** Target service */
  service: string;

  /** Namespace */
  namespace: string;

  /** Mesh provider */
  mesh: MeshProvider;

  /** Route matches */
  matches: RouteMatch[];

  /** Destination weights (for canary/split traffic) */
  destinations: WeightedDestination[];

  /** Retry policy */
  retries?: RetryPolicy;

  /** Timeout */
  timeout?: string;

  /** Fault injection (for chaos testing) */
  fault?: FaultInjection;

  /** Created timestamp */
  createdAt: string;
}

export interface RouteMatch {
  /** URI match */
  uri?: { exact?: string; prefix?: string; regex?: string };

  /** Header matches */
  headers?: Record<string, { exact?: string; prefix?: string; regex?: string }>;

  /** HTTP method */
  method?: string;

  /** Source labels */
  sourceLabels?: Record<string, string>;
}

export interface WeightedDestination {
  /** Subset/version */
  subset: string;

  /** Traffic weight (0-100) */
  weight: number;

  /** Port */
  port?: number;
}

export interface RetryPolicy {
  /** Number of retries */
  attempts: number;

  /** Per-retry timeout */
  perTryTimeout: string;

  /** Retry on specific conditions */
  retryOn?: string;
}

export interface FaultInjection {
  /** Delay injection */
  delay?: {
    /** Fixed delay duration */
    fixedDelay: string;
    /** Percentage of requests to delay */
    percentage: number;
  };

  /** Abort injection */
  abort?: {
    /** HTTP status code to return */
    httpStatus: number;
    /** Percentage of requests to abort */
    percentage: number;
  };
}

/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerConfig {
  /** Maximum connections */
  maxConnections: number;

  /** Maximum pending requests */
  maxPendingRequests: number;

  /** Maximum requests per connection */
  maxRequestsPerConnection: number;

  /** Maximum retries */
  maxRetries: number;

  /** Outlier detection */
  outlierDetection?: {
    /** Consecutive errors before ejection */
    consecutiveErrors: number;
    /** Ejection time */
    interval: string;
    /** Base ejection duration */
    baseEjectionTime: string;
    /** Maximum ejection percentage */
    maxEjectionPercent: number;
  };
}

/**
 * Authorization policy.
 */
export interface AuthorizationPolicy {
  /** Policy name */
  name: string;

  /** Namespace */
  namespace: string;

  /** Action */
  action: "ALLOW" | "DENY" | "CUSTOM";

  /** Rules */
  rules: AuthzRule[];

  /** Selector (workload labels) */
  selector?: Record<string, string>;
}

export interface AuthzRule {
  /** Source conditions */
  from?: Array<{
    principals?: string[];
    namespaces?: string[];
    ipBlocks?: string[];
  }>;

  /** Operation conditions */
  to?: Array<{
    methods?: string[];
    paths?: string[];
    ports?: string[];
  }>;

  /** Additional conditions */
  when?: Array<{
    key: string;
    values: string[];
  }>;
}

/**
 * Traffic metrics snapshot.
 */
export interface TrafficMetrics {
  /** Service */
  service: string;

  /** Namespace */
  namespace: string;

  /** Time window */
  window: string;

  /** Request rate (req/s) */
  requestRate: number;

  /** Success rate (0-1) */
  successRate: number;

  /** Latency percentiles (ms) */
  latency: {
    p50: number;
    p90: number;
    p99: number;
  };

  /** Bytes in/out */
  bytesIn: number;
  bytesOut: number;
}

/**
 * Canary deployment configuration.
 */
export interface CanaryDeployment {
  /** Deployment ID */
  id: string;

  /** Service being deployed */
  service: string;

  /** Namespace */
  namespace: string;

  /** Mesh provider */
  mesh: MeshProvider;

  /** Canary version (subset) */
  canaryVersion: string;

  /** Stable version (subset) */
  stableVersion: string;

  /** Current canary weight (0-100) */
  canaryWeight: number;

  /** Target canary weight */
  targetWeight: number;

  /** Step size for progressive rollout */
  stepWeight: number;

  /** Interval between steps */
  stepInterval: string;

  /** Success criteria */
  successCriteria: {
    /** Minimum success rate */
    successRate: number;
    /** Maximum P99 latency (ms) */
    maxLatencyP99: number;
  };

  /** Deployment status */
  status: "in-progress" | "promoting" | "rolling-back" | "completed" | "failed";

  /** Created timestamp */
  createdAt: string;
}

// =============================================================================
// Service Mesh Manager
// =============================================================================

/**
 * Mesh provider adapter interface.
 *
 * Each mesh implementor (Istio, Linkerd) provides an adapter that
 * translates between the unified model and provider-specific CRDs.
 */
export interface MeshAdapter {
  /** Provider type */
  readonly provider: MeshProvider;

  /** List services in the mesh */
  listServices(namespace?: string): Promise<MeshService[]>;

  /** Get a specific service's details */
  getService(name: string, namespace: string): Promise<MeshService | null>;

  /** Create/update a traffic routing rule */
  applyRoute(route: TrafficRoute): Promise<void>;

  /** Delete a traffic routing rule */
  deleteRoute(name: string, namespace: string): Promise<void>;

  /** List traffic routes */
  listRoutes(namespace?: string): Promise<TrafficRoute[]>;

  /** Apply a circuit breaker configuration */
  applyCircuitBreaker(
    service: string,
    namespace: string,
    config: CircuitBreakerConfig,
  ): Promise<void>;

  /** Apply an authorization policy */
  applyAuthorizationPolicy(policy: AuthorizationPolicy): Promise<void>;

  /** Delete an authorization policy */
  deleteAuthorizationPolicy(name: string, namespace: string): Promise<void>;

  /** Get traffic metrics for a service */
  getMetrics(service: string, namespace: string, window?: string): Promise<TrafficMetrics>;

  /** Check mTLS status */
  getMtlsStatus(
    namespace?: string,
  ): Promise<Array<{ service: string; namespace: string; mtls: string }>>;
}

/**
 * Unified Service Mesh Manager that provides a high-level API
 * for managing mesh infrastructure across multiple providers.
 */
export class ServiceMeshManager {
  private adapters = new Map<MeshProvider, MeshAdapter>();
  private canaryDeployments = new Map<string, CanaryDeployment>();
  private canaryTimers = new Map<string, ReturnType<typeof setInterval>>();

  /**
   * Register a mesh adapter.
   */
  registerAdapter(adapter: MeshAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  /**
   * Get the adapter for a specific provider.
   */
  getAdapter(provider: MeshProvider): MeshAdapter | undefined {
    return this.adapters.get(provider);
  }

  /**
   * List all services across all registered mesh providers.
   */
  async listAllServices(namespace?: string): Promise<MeshService[]> {
    const services: MeshService[] = [];

    for (const adapter of this.adapters.values()) {
      try {
        const s = await adapter.listServices(namespace);
        services.push(...s);
      } catch {
        // Skip unavailable adapters
      }
    }

    return services;
  }

  // ===========================================================================
  // Traffic Management
  // ===========================================================================

  /**
   * Create a traffic split for A/B testing or canary deployments.
   */
  async createTrafficSplit(params: {
    mesh: MeshProvider;
    service: string;
    namespace: string;
    splits: Array<{ subset: string; weight: number }>;
    name?: string;
  }): Promise<TrafficRoute> {
    const adapter = this.getAdapterOrThrow(params.mesh);

    const route: TrafficRoute = {
      id: randomUUID(),
      name: params.name ?? `${params.service}-split`,
      service: params.service,
      namespace: params.namespace,
      mesh: params.mesh,
      matches: [],
      destinations: params.splits.map((s) => ({
        subset: s.subset,
        weight: s.weight,
      })),
      createdAt: new Date().toISOString(),
    };

    await adapter.applyRoute(route);
    return route;
  }

  /**
   * Apply a circuit breaker to a service.
   */
  async applyCircuitBreaker(params: {
    mesh: MeshProvider;
    service: string;
    namespace: string;
    config: CircuitBreakerConfig;
  }): Promise<void> {
    const adapter = this.getAdapterOrThrow(params.mesh);
    await adapter.applyCircuitBreaker(params.service, params.namespace, params.config);
  }

  /**
   * Inject a fault for chaos testing.
   */
  async injectFault(params: {
    mesh: MeshProvider;
    service: string;
    namespace: string;
    fault: FaultInjection;
    duration?: string;
  }): Promise<TrafficRoute> {
    const adapter = this.getAdapterOrThrow(params.mesh);

    const route: TrafficRoute = {
      id: randomUUID(),
      name: `${params.service}-fault-injection`,
      service: params.service,
      namespace: params.namespace,
      mesh: params.mesh,
      matches: [],
      destinations: [{ subset: "primary", weight: 100 }],
      fault: params.fault,
      createdAt: new Date().toISOString(),
    };

    await adapter.applyRoute(route);
    return route;
  }

  // ===========================================================================
  // Canary Deployments
  // ===========================================================================

  /**
   * Start a progressive canary deployment.
   */
  async startCanary(params: {
    mesh: MeshProvider;
    service: string;
    namespace: string;
    canaryVersion: string;
    stableVersion: string;
    initialWeight?: number;
    targetWeight?: number;
    stepWeight?: number;
    stepIntervalMs?: number;
    successCriteria?: {
      successRate?: number;
      maxLatencyP99?: number;
    };
  }): Promise<CanaryDeployment> {
    const adapter = this.getAdapterOrThrow(params.mesh);

    const canary: CanaryDeployment = {
      id: randomUUID(),
      service: params.service,
      namespace: params.namespace,
      mesh: params.mesh,
      canaryVersion: params.canaryVersion,
      stableVersion: params.stableVersion,
      canaryWeight: params.initialWeight ?? 5,
      targetWeight: params.targetWeight ?? 100,
      stepWeight: params.stepWeight ?? 10,
      stepInterval: `${params.stepIntervalMs ?? 300_000}ms`,
      successCriteria: {
        successRate: params.successCriteria?.successRate ?? 0.99,
        maxLatencyP99: params.successCriteria?.maxLatencyP99 ?? 500,
      },
      status: "in-progress",
      createdAt: new Date().toISOString(),
    };

    // Apply initial traffic split
    await adapter.applyRoute({
      id: canary.id,
      name: `${params.service}-canary`,
      service: params.service,
      namespace: params.namespace,
      mesh: params.mesh,
      matches: [],
      destinations: [
        { subset: params.stableVersion, weight: 100 - canary.canaryWeight },
        { subset: params.canaryVersion, weight: canary.canaryWeight },
      ],
      createdAt: canary.createdAt,
    });

    this.canaryDeployments.set(canary.id, canary);

    // Start progressive rollout timer
    const timer = setInterval(async () => {
      try {
        await this.stepCanary(canary.id);
      } catch {
        // Step failures are non-fatal; next interval will retry
      }
    }, params.stepIntervalMs ?? 300_000);

    this.canaryTimers.set(canary.id, timer);

    return canary;
  }

  /**
   * Advance a canary deployment by one step.
   */
  private async stepCanary(canaryId: string): Promise<void> {
    const canary = this.canaryDeployments.get(canaryId);
    if (!canary || canary.status !== "in-progress") return;

    const adapter = this.getAdapterOrThrow(canary.mesh);

    // Check metrics
    try {
      const metrics = await adapter.getMetrics(canary.service, canary.namespace, "5m");

      if (
        metrics.successRate < canary.successCriteria.successRate ||
        metrics.latency.p99 > canary.successCriteria.maxLatencyP99
      ) {
        // Rollback
        await this.rollbackCanary(canaryId);
        return;
      }
    } catch {
      // Can't get metrics — pause, don't advance
      return;
    }

    // Advance weight
    canary.canaryWeight = Math.min(canary.canaryWeight + canary.stepWeight, canary.targetWeight);

    if (canary.canaryWeight >= canary.targetWeight) {
      // Promote
      canary.status = "promoting";
      await adapter.applyRoute({
        id: canary.id,
        name: `${canary.service}-canary`,
        service: canary.service,
        namespace: canary.namespace,
        mesh: canary.mesh,
        matches: [],
        destinations: [{ subset: canary.canaryVersion, weight: 100 }],
        createdAt: canary.createdAt,
      });

      canary.status = "completed";
      this.stopCanaryTimer(canaryId);
    } else {
      // Apply updated weights
      await adapter.applyRoute({
        id: canary.id,
        name: `${canary.service}-canary`,
        service: canary.service,
        namespace: canary.namespace,
        mesh: canary.mesh,
        matches: [],
        destinations: [
          { subset: canary.stableVersion, weight: 100 - canary.canaryWeight },
          { subset: canary.canaryVersion, weight: canary.canaryWeight },
        ],
        createdAt: canary.createdAt,
      });
    }
  }

  /**
   * Rollback a canary deployment to stable.
   */
  async rollbackCanary(canaryId: string): Promise<void> {
    const canary = this.canaryDeployments.get(canaryId);
    if (!canary) return;

    const adapter = this.getAdapterOrThrow(canary.mesh);

    canary.status = "rolling-back";

    await adapter.applyRoute({
      id: canary.id,
      name: `${canary.service}-canary`,
      service: canary.service,
      namespace: canary.namespace,
      mesh: canary.mesh,
      matches: [],
      destinations: [{ subset: canary.stableVersion, weight: 100 }],
      createdAt: canary.createdAt,
    });

    canary.canaryWeight = 0;
    canary.status = "failed";
    this.stopCanaryTimer(canaryId);
  }

  /**
   * Get active canary deployments.
   */
  getCanaryDeployments(): CanaryDeployment[] {
    return Array.from(this.canaryDeployments.values());
  }

  private stopCanaryTimer(canaryId: string): void {
    const timer = this.canaryTimers.get(canaryId);
    if (timer) {
      clearInterval(timer);
      this.canaryTimers.delete(canaryId);
    }
  }

  // ===========================================================================
  // Observability
  // ===========================================================================

  /**
   * Get a unified traffic dashboard across all mesh providers.
   */
  async getTrafficDashboard(namespace?: string): Promise<{
    services: MeshService[];
    metrics: TrafficMetrics[];
    routes: TrafficRoute[];
  }> {
    const services = await this.listAllServices(namespace);

    const metrics: TrafficMetrics[] = [];
    const routes: TrafficRoute[] = [];

    for (const adapter of this.adapters.values()) {
      try {
        const r = await adapter.listRoutes(namespace);
        routes.push(...r);
      } catch {
        /* skip */
      }

      for (const svc of services.filter((s) => s.mesh === adapter.provider)) {
        try {
          const m = await adapter.getMetrics(svc.name, svc.namespace, "5m");
          metrics.push(m);
        } catch {
          /* skip */
        }
      }
    }

    return { services, metrics, routes };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private getAdapterOrThrow(provider: MeshProvider): MeshAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`No mesh adapter registered for provider: ${provider}`);
    }
    return adapter;
  }

  /**
   * Close and clean up all timers.
   */
  close(): void {
    for (const timer of this.canaryTimers.values()) {
      clearInterval(timer);
    }
    this.canaryTimers.clear();
    this.canaryDeployments.clear();
  }
}
