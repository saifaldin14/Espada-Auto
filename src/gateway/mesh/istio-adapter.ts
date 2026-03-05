/**
 * Istio Mesh Adapter
 *
 * Translates between the unified ServiceMeshManager model and Istio
 * Custom Resource Definitions (VirtualService, DestinationRule,
 * PeerAuthentication, AuthorizationPolicy).
 *
 * Communicates with the Kubernetes API via kubectl or kubeconfig-based
 * fetch for reading/applying Istio CRDs.
 *
 */

import type {
  AuthorizationPolicy,
  AuthzRule,
  CircuitBreakerConfig,
  MeshAdapter,
  MeshService,
  TrafficMetrics,
  TrafficRoute,
  WeightedDestination,
} from "./service-mesh.js";

// =============================================================================
// Kubernetes / Istio API helpers
// =============================================================================

/** Sanitize a value for inclusion in a PromQL label matcher. */
function sanitizePromLabel(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

interface KubeConfig {
  /** Kubernetes API server URL */
  apiServer: string;

  /** Bearer token for authentication */
  token?: string;

  /** Path to kubeconfig file (fallback) */
  kubeconfigPath?: string;

  /** Skip TLS verification (development only) */
  insecure?: boolean;

  /** Prometheus endpoint for metrics (default: http://prometheus:9090) */
  prometheusUrl?: string;

  /** Default namespace */
  defaultNamespace?: string;
}

/**
 * Make an authenticated request to the Kubernetes API.
 */
async function kubeRequest(
  config: KubeConfig,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  const url = `${config.apiServer}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (config.token) {
    headers["Authorization"] = `Bearer ${config.token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kubernetes API ${method} ${path} failed (${response.status}): ${text}`);
  }

  return response.json();
}

// =============================================================================
// Istio Adapter
// =============================================================================

export class IstioMeshAdapter implements MeshAdapter {
  readonly provider = "istio" as const;
  private config: KubeConfig;

  constructor(config: KubeConfig) {
    this.config = {
      ...config,
      prometheusUrl: config.prometheusUrl ?? "http://prometheus:9090",
      defaultNamespace: config.defaultNamespace ?? "default",
    };
  }

  // ===========================================================================
  // Service Discovery
  // ===========================================================================

  async listServices(namespace?: string): Promise<MeshService[]> {
    const ns = namespace ?? this.config.defaultNamespace ?? "default";
    const path = ns === "*" ? "/api/v1/services" : `/api/v1/namespaces/${ns}/services`;

    const result = (await kubeRequest(this.config, path)) as {
      items: Array<{
        metadata: { name: string; namespace: string; labels?: Record<string, string> };
        spec: { ports?: Array<{ protocol: string }> };
      }>;
    };

    // Fetch Istio PeerAuthentication to determine mTLS status
    const mtlsMap = await this.getMtlsMap(ns);

    return result.items.map((svc) => ({
      name: svc.metadata.name,
      namespace: svc.metadata.namespace,
      mesh: "istio" as const,
      endpoints: 0, // Would need Endpoints API call for real count
      protocol: "HTTP" as const,
      mtls: mtlsMap.get(`${svc.metadata.namespace}/${svc.metadata.name}`) ?? "permissive",
      labels: svc.metadata.labels ?? {},
      healthy: true,
      versions: this.extractVersions(svc.metadata.labels),
    }));
  }

  async getService(name: string, namespace: string): Promise<MeshService | null> {
    try {
      const result = (await kubeRequest(
        this.config,
        `/api/v1/namespaces/${namespace}/services/${name}`,
      )) as {
        metadata: { name: string; namespace: string; labels?: Record<string, string> };
      };

      const mtlsMap = await this.getMtlsMap(namespace);

      return {
        name: result.metadata.name,
        namespace: result.metadata.namespace,
        mesh: "istio",
        endpoints: 0,
        protocol: "HTTP",
        mtls: mtlsMap.get(`${namespace}/${name}`) ?? "permissive",
        labels: result.metadata.labels ?? {},
        healthy: true,
        versions: this.extractVersions(result.metadata.labels),
      };
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Traffic Routing (VirtualService)
  // ===========================================================================

  async applyRoute(route: TrafficRoute): Promise<void> {
    const vs = this.routeToVirtualService(route);

    await kubeRequest(
      this.config,
      `/apis/networking.istio.io/v1beta1/namespaces/${route.namespace}/virtualservices`,
      "POST",
      vs,
    ).catch(async () => {
      // If POST fails (already exists), try PUT
      await kubeRequest(
        this.config,
        `/apis/networking.istio.io/v1beta1/namespaces/${route.namespace}/virtualservices/${route.name}`,
        "PUT",
        vs,
      );
    });
  }

  async deleteRoute(name: string, namespace: string): Promise<void> {
    await kubeRequest(
      this.config,
      `/apis/networking.istio.io/v1beta1/namespaces/${namespace}/virtualservices/${name}`,
      "DELETE",
    );
  }

  async listRoutes(namespace?: string): Promise<TrafficRoute[]> {
    const ns = namespace ?? this.config.defaultNamespace ?? "default";
    const result = (await kubeRequest(
      this.config,
      `/apis/networking.istio.io/v1beta1/namespaces/${ns}/virtualservices`,
    )) as {
      items: Array<{
        metadata: { name: string; namespace: string; uid: string; creationTimestamp: string };
        spec: { http?: Array<Record<string, unknown>> };
      }>;
    };

    return result.items.map((vs) => this.virtualServiceToRoute(vs));
  }

  // ===========================================================================
  // Circuit Breaker (DestinationRule)
  // ===========================================================================

  async applyCircuitBreaker(
    service: string,
    namespace: string,
    config: CircuitBreakerConfig,
  ): Promise<void> {
    const dr = {
      apiVersion: "networking.istio.io/v1beta1",
      kind: "DestinationRule",
      metadata: {
        name: `${service}-circuit-breaker`,
        namespace,
      },
      spec: {
        host: service,
        trafficPolicy: {
          connectionPool: {
            tcp: {
              maxConnections: config.maxConnections,
            },
            http: {
              h2UpgradePolicy: "DEFAULT",
              http1MaxPendingRequests: config.maxPendingRequests,
              maxRequestsPerConnection: config.maxRequestsPerConnection,
              maxRetries: config.maxRetries,
            },
          },
          outlierDetection: config.outlierDetection
            ? {
                consecutive5xxErrors: config.outlierDetection.consecutiveErrors,
                interval: config.outlierDetection.interval,
                baseEjectionTime: config.outlierDetection.baseEjectionTime,
                maxEjectionPercent: config.outlierDetection.maxEjectionPercent,
              }
            : undefined,
        },
      },
    };

    const path = `/apis/networking.istio.io/v1beta1/namespaces/${namespace}/destinationrules`;
    await kubeRequest(this.config, path, "POST", dr).catch(async () => {
      await kubeRequest(this.config, `${path}/${service}-circuit-breaker`, "PUT", dr);
    });
  }

  // ===========================================================================
  // Authorization Policy
  // ===========================================================================

  async applyAuthorizationPolicy(policy: AuthorizationPolicy): Promise<void> {
    const ap = this.authzToIstioCrd(policy);

    const path = `/apis/security.istio.io/v1beta1/namespaces/${policy.namespace}/authorizationpolicies`;
    await kubeRequest(this.config, path, "POST", ap).catch(async () => {
      await kubeRequest(this.config, `${path}/${policy.name}`, "PUT", ap);
    });
  }

  async deleteAuthorizationPolicy(name: string, namespace: string): Promise<void> {
    await kubeRequest(
      this.config,
      `/apis/security.istio.io/v1beta1/namespaces/${namespace}/authorizationpolicies/${name}`,
      "DELETE",
    );
  }

  // ===========================================================================
  // Metrics (via Prometheus)
  // ===========================================================================

  async getMetrics(service: string, namespace: string, window = "5m"): Promise<TrafficMetrics> {
    if (!this.config.prometheusUrl) {
      throw new Error("istio: prometheusUrl is required for metrics collection");
    }
    const baseUrl = this.config.prometheusUrl;
    const svc = sanitizePromLabel(service);
    const ns = sanitizePromLabel(namespace);

    const [rateResult, successResult, latencyResult] = await Promise.all([
      this.promQuery(
        baseUrl,
        `sum(rate(istio_requests_total{destination_service_name="${svc}",destination_service_namespace="${ns}"}[${window}]))`,
      ),
      this.promQuery(
        baseUrl,
        `sum(rate(istio_requests_total{destination_service_name="${svc}",destination_service_namespace="${ns}",response_code=~"2.."}[${window}])) / sum(rate(istio_requests_total{destination_service_name="${svc}",destination_service_namespace="${ns}"}[${window}]))`,
      ),
      Promise.all([
        this.promQuery(
          baseUrl,
          `histogram_quantile(0.5, sum(rate(istio_request_duration_milliseconds_bucket{destination_service_name="${svc}",destination_service_namespace="${ns}"}[${window}])) by (le))`,
        ),
        this.promQuery(
          baseUrl,
          `histogram_quantile(0.9, sum(rate(istio_request_duration_milliseconds_bucket{destination_service_name="${svc}",destination_service_namespace="${ns}"}[${window}])) by (le))`,
        ),
        this.promQuery(
          baseUrl,
          `histogram_quantile(0.99, sum(rate(istio_request_duration_milliseconds_bucket{destination_service_name="${svc}",destination_service_namespace="${ns}"}[${window}])) by (le))`,
        ),
      ]),
    ]);

    return {
      service,
      namespace,
      window,
      requestRate: rateResult,
      successRate: successResult,
      latency: {
        p50: latencyResult[0],
        p90: latencyResult[1],
        p99: latencyResult[2],
      },
      bytesIn: 0,
      bytesOut: 0,
    };
  }

  // ===========================================================================
  // mTLS
  // ===========================================================================

  async getMtlsStatus(
    namespace?: string,
  ): Promise<Array<{ service: string; namespace: string; mtls: string }>> {
    const ns = namespace ?? this.config.defaultNamespace ?? "default";

    const result = (await kubeRequest(
      this.config,
      `/apis/security.istio.io/v1beta1/namespaces/${ns}/peerauthentications`,
    )) as {
      items: Array<{
        metadata: { name: string; namespace: string };
        spec: { mtls?: { mode?: string } };
      }>;
    };

    return result.items.map((pa) => ({
      service: pa.metadata.name,
      namespace: pa.metadata.namespace,
      mtls: pa.spec.mtls?.mode?.toLowerCase() ?? "permissive",
    }));
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private async getMtlsMap(
    namespace: string,
  ): Promise<Map<string, "strict" | "permissive" | "disabled">> {
    const map = new Map<string, "strict" | "permissive" | "disabled">();

    try {
      const statuses = await this.getMtlsStatus(namespace);
      for (const s of statuses) {
        map.set(`${s.namespace}/${s.service}`, s.mtls as "strict" | "permissive" | "disabled");
      }
    } catch {
      /* mTLS info unavailable */
    }

    return map;
  }

  private extractVersions(labels?: Record<string, string>): string[] | undefined {
    if (!labels) return undefined;
    const version = labels["version"] ?? labels["app.kubernetes.io/version"];
    return version ? [version] : undefined;
  }

  private routeToVirtualService(route: TrafficRoute): Record<string, unknown> {
    const httpRoutes: Array<Record<string, unknown>> = [];

    const routeEntry: Record<string, unknown> = {
      route: route.destinations.map((d: WeightedDestination) => ({
        destination: {
          host: route.service,
          subset: d.subset,
          ...(d.port ? { port: { number: d.port } } : {}),
        },
        weight: d.weight,
      })),
    };

    if (route.matches.length > 0) {
      routeEntry["match"] = route.matches.map((m) => ({
        ...(m.uri ? { uri: m.uri } : {}),
        ...(m.headers ? { headers: m.headers } : {}),
        ...(m.method ? { method: { exact: m.method } } : {}),
        ...(m.sourceLabels ? { sourceLabels: m.sourceLabels } : {}),
      }));
    }

    if (route.retries) {
      routeEntry["retries"] = {
        attempts: route.retries.attempts,
        perTryTimeout: route.retries.perTryTimeout,
        ...(route.retries.retryOn ? { retryOn: route.retries.retryOn } : {}),
      };
    }

    if (route.timeout) {
      routeEntry["timeout"] = route.timeout;
    }

    if (route.fault) {
      routeEntry["fault"] = {};
      if (route.fault.delay) {
        (routeEntry["fault"] as Record<string, unknown>)["delay"] = {
          fixedDelay: route.fault.delay.fixedDelay,
          percentage: { value: route.fault.delay.percentage },
        };
      }
      if (route.fault.abort) {
        (routeEntry["fault"] as Record<string, unknown>)["abort"] = {
          httpStatus: route.fault.abort.httpStatus,
          percentage: { value: route.fault.abort.percentage },
        };
      }
    }

    httpRoutes.push(routeEntry);

    return {
      apiVersion: "networking.istio.io/v1beta1",
      kind: "VirtualService",
      metadata: {
        name: route.name,
        namespace: route.namespace,
        labels: {
          "app.kubernetes.io/managed-by": "espada",
          "espada/route-id": route.id,
        },
      },
      spec: {
        hosts: [route.service],
        http: httpRoutes,
      },
    };
  }

  private virtualServiceToRoute(vs: {
    metadata: { name: string; namespace: string; uid: string; creationTimestamp: string };
    spec: { http?: Array<Record<string, unknown>> };
  }): TrafficRoute {
    const destinations: WeightedDestination[] = [];
    const httpRoutes = vs.spec.http ?? [];

    for (const hr of httpRoutes) {
      const routeEntries = (hr["route"] as Array<Record<string, unknown>>) ?? [];
      for (const r of routeEntries) {
        const dest = r["destination"] as Record<string, unknown>;
        destinations.push({
          subset: (dest?.["subset"] as string) ?? "default",
          weight: (r["weight"] as number) ?? 100,
          port: (dest?.["port"] as Record<string, number>)?.["number"],
        });
      }
    }

    return {
      id: vs.metadata.uid,
      name: vs.metadata.name,
      service: vs.metadata.name,
      namespace: vs.metadata.namespace,
      mesh: "istio",
      matches: [],
      destinations,
      createdAt: vs.metadata.creationTimestamp,
    };
  }

  private authzToIstioCrd(policy: AuthorizationPolicy): Record<string, unknown> {
    return {
      apiVersion: "security.istio.io/v1beta1",
      kind: "AuthorizationPolicy",
      metadata: {
        name: policy.name,
        namespace: policy.namespace,
        labels: {
          "app.kubernetes.io/managed-by": "espada",
        },
      },
      spec: {
        ...(policy.selector ? { selector: { matchLabels: policy.selector } } : {}),
        action: policy.action,
        rules: policy.rules.map((rule: AuthzRule) => ({
          ...(rule.from
            ? {
                from: rule.from.map((f) => ({
                  source: {
                    ...(f.principals ? { principals: f.principals } : {}),
                    ...(f.namespaces ? { namespaces: f.namespaces } : {}),
                    ...(f.ipBlocks ? { ipBlocks: f.ipBlocks } : {}),
                  },
                })),
              }
            : {}),
          ...(rule.to
            ? {
                to: rule.to.map((t) => ({
                  operation: {
                    ...(t.methods ? { methods: t.methods } : {}),
                    ...(t.paths ? { paths: t.paths } : {}),
                    ...(t.ports ? { ports: t.ports } : {}),
                  },
                })),
              }
            : {}),
          ...(rule.when
            ? {
                when: rule.when.map((w) => ({
                  key: w.key,
                  values: w.values,
                })),
              }
            : {}),
        })),
      },
    };
  }

  private async promQuery(baseUrl: string, query: string): Promise<number> {
    try {
      const response = await fetch(`${baseUrl}/api/v1/query?query=${encodeURIComponent(query)}`);

      if (!response.ok) return 0;

      const data = (await response.json()) as {
        data?: { result?: Array<{ value?: [number, string] }> };
      };

      const value = data?.data?.result?.[0]?.value?.[1];
      return value ? parseFloat(value) : 0;
    } catch {
      return 0;
    }
  }
}
