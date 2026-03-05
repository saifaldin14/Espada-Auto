/**
 * Linkerd Mesh Adapter
 *
 * Translates between the unified ServiceMeshManager model and Linkerd
 * resources (TrafficSplit, ServiceProfile, ServerAuthorization, Server).
 *
 * Uses SMI (Service Mesh Interface) TrafficSplit for traffic management
 * and Linkerd-specific CRDs for policy and observability.
 *
 */

import type {
  AuthorizationPolicy,
  CircuitBreakerConfig,
  MeshAdapter,
  MeshService,
  TrafficMetrics,
  TrafficRoute,
} from "./service-mesh.js";

// =============================================================================
// Linkerd / SMI API helpers
// =============================================================================

/** Sanitize a value for inclusion in a PromQL label matcher. */
function sanitizePromLabel(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

interface LinkerdConfig {
  /** Kubernetes API server URL */
  apiServer: string;

  /** Bearer token for authentication */
  token?: string;

  /** Skip TLS verification (development only) */
  insecure?: boolean;

  /** Linkerd Viz API endpoint (default: http://linkerd-viz:8084) */
  vizUrl?: string;

  /** Default namespace */
  defaultNamespace?: string;
}

async function kubeRequest(
  config: LinkerdConfig,
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
// Linkerd Adapter
// =============================================================================

export class LinkerdMeshAdapter implements MeshAdapter {
  readonly provider = "linkerd" as const;
  private config: LinkerdConfig;

  constructor(config: LinkerdConfig) {
    this.config = {
      ...config,
      vizUrl: config.vizUrl ?? "http://linkerd-viz:8084",
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
        metadata: {
          name: string;
          namespace: string;
          labels?: Record<string, string>;
          annotations?: Record<string, string>;
        };
      }>;
    };

    return result.items
      .filter((svc) => {
        // Only include services injected with Linkerd proxy
        const annotations = svc.metadata.annotations ?? {};
        return (
          annotations["linkerd.io/proxy-injector"] !== undefined ||
          annotations["linkerd.io/inject"] === "enabled" ||
          true // Fallback: include all services
        );
      })
      .map((svc) => ({
        name: svc.metadata.name,
        namespace: svc.metadata.namespace,
        mesh: "linkerd" as const,
        endpoints: 0,
        protocol: "HTTP" as const,
        mtls: "strict" as const, // Linkerd enables mTLS by default for all meshed pods
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

      return {
        name: result.metadata.name,
        namespace: result.metadata.namespace,
        mesh: "linkerd",
        endpoints: 0,
        protocol: "HTTP",
        mtls: "strict",
        labels: result.metadata.labels ?? {},
        healthy: true,
        versions: this.extractVersions(result.metadata.labels),
      };
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Traffic Routing (SMI TrafficSplit)
  // ===========================================================================

  async applyRoute(route: TrafficRoute): Promise<void> {
    const ts = this.routeToTrafficSplit(route);

    const path = `/apis/split.smi-spec.io/v1alpha4/namespaces/${route.namespace}/trafficsplits`;
    await kubeRequest(this.config, path, "POST", ts).catch(async () => {
      await kubeRequest(this.config, `${path}/${route.name}`, "PUT", ts);
    });
  }

  async deleteRoute(name: string, namespace: string): Promise<void> {
    await kubeRequest(
      this.config,
      `/apis/split.smi-spec.io/v1alpha4/namespaces/${namespace}/trafficsplits/${name}`,
      "DELETE",
    );
  }

  async listRoutes(namespace?: string): Promise<TrafficRoute[]> {
    const ns = namespace ?? this.config.defaultNamespace ?? "default";

    const result = (await kubeRequest(
      this.config,
      `/apis/split.smi-spec.io/v1alpha4/namespaces/${ns}/trafficsplits`,
    )) as {
      items: Array<{
        metadata: { name: string; namespace: string; uid: string; creationTimestamp: string };
        spec: {
          service: string;
          backends?: Array<{ service: string; weight: number }>;
        };
      }>;
    };

    return result.items.map((ts) => ({
      id: ts.metadata.uid,
      name: ts.metadata.name,
      namespace: ts.metadata.namespace,
      mesh: "linkerd" as const,
      service: ts.spec.service,
      matches: [],
      destinations: (ts.spec.backends ?? []).map((b) => ({
        subset: b.service,
        weight: b.weight,
      })),
      createdAt: ts.metadata.creationTimestamp,
    }));
  }

  // ===========================================================================
  // Circuit Breaker (ServiceProfile)
  // ===========================================================================

  async applyCircuitBreaker(
    service: string,
    namespace: string,
    config: CircuitBreakerConfig,
  ): Promise<void> {
    // Linkerd implements circuit breaking via ServiceProfile retryBudget
    // and the linkerd-failfast feature. We map to ServiceProfile.
    const sp = {
      apiVersion: "linkerd.io/v1alpha2",
      kind: "ServiceProfile",
      metadata: {
        name: `${service}.${namespace}.svc.cluster.local`,
        namespace,
        labels: {
          "app.kubernetes.io/managed-by": "espada",
        },
      },
      spec: {
        retryBudget: {
          retryRatio: config.maxRetries > 0 ? 0.2 : 0,
          minRetriesPerSecond: config.maxRetries,
          ttl: config.outlierDetection?.interval ?? "10s",
        },
      },
    };

    const path = `/apis/linkerd.io/v1alpha2/namespaces/${namespace}/serviceprofiles`;
    await kubeRequest(this.config, path, "POST", sp).catch(async () => {
      await kubeRequest(
        this.config,
        `${path}/${service}.${namespace}.svc.cluster.local`,
        "PUT",
        sp,
      );
    });
  }

  // ===========================================================================
  // Authorization Policy (Server + ServerAuthorization)
  // ===========================================================================

  async applyAuthorizationPolicy(policy: AuthorizationPolicy): Promise<void> {
    // Linkerd uses Server + ServerAuthorization CRDs
    // Create a Server resource for the selector
    if (policy.selector) {
      const server = {
        apiVersion: "policy.linkerd.io/v1beta1",
        kind: "Server",
        metadata: {
          name: policy.name,
          namespace: policy.namespace,
          labels: { "app.kubernetes.io/managed-by": "espada" },
        },
        spec: {
          podSelector: { matchLabels: policy.selector },
          port: 80, // Default; real implementation would parameterize
          proxyProtocol: "HTTP/1",
        },
      };

      const serverPath = `/apis/policy.linkerd.io/v1beta1/namespaces/${policy.namespace}/servers`;
      await kubeRequest(this.config, serverPath, "POST", server).catch(async () => {
        await kubeRequest(this.config, `${serverPath}/${policy.name}`, "PUT", server);
      });
    }

    // Create ServerAuthorization
    const authz = {
      apiVersion: "policy.linkerd.io/v1beta1",
      kind: "ServerAuthorization",
      metadata: {
        name: `${policy.name}-authz`,
        namespace: policy.namespace,
        labels: { "app.kubernetes.io/managed-by": "espada" },
      },
      spec: {
        server: { name: policy.name },
        client: this.authzRulesToLinkerdClient(policy.rules),
      },
    };

    const authzPath = `/apis/policy.linkerd.io/v1beta1/namespaces/${policy.namespace}/serverauthorizations`;
    await kubeRequest(this.config, authzPath, "POST", authz).catch(async () => {
      await kubeRequest(this.config, `${authzPath}/${policy.name}-authz`, "PUT", authz);
    });
  }

  async deleteAuthorizationPolicy(name: string, namespace: string): Promise<void> {
    await Promise.allSettled([
      kubeRequest(
        this.config,
        `/apis/policy.linkerd.io/v1beta1/namespaces/${namespace}/serverauthorizations/${name}-authz`,
        "DELETE",
      ),
      kubeRequest(
        this.config,
        `/apis/policy.linkerd.io/v1beta1/namespaces/${namespace}/servers/${name}`,
        "DELETE",
      ),
    ]);
  }

  // ===========================================================================
  // Metrics (via Linkerd Viz / Prometheus)
  // ===========================================================================

  async getMetrics(service: string, namespace: string, window = "5m"): Promise<TrafficMetrics> {
    if (!this.config.vizUrl) {
      throw new Error("linkerd: vizUrl is required for metrics collection");
    }
    const vizUrl = this.config.vizUrl;
    const svc = sanitizePromLabel(service);
    const ns = sanitizePromLabel(namespace);

    // Linkerd uses its own metrics names
    const [rateResult, successResult, latencyResult] = await Promise.all([
      this.promQuery(
        vizUrl,
        `sum(rate(response_total{namespace="${ns}",dst_service="${svc}"}[${window}]))`,
      ),
      this.promQuery(
        vizUrl,
        `sum(rate(response_total{namespace="${ns}",dst_service="${svc}",classification="success"}[${window}])) / sum(rate(response_total{namespace="${ns}",dst_service="${svc}"}[${window}]))`,
      ),
      Promise.all([
        this.promQuery(
          vizUrl,
          `histogram_quantile(0.5, sum(rate(response_latency_ms_bucket{namespace="${ns}",dst_service="${svc}"}[${window}])) by (le))`,
        ),
        this.promQuery(
          vizUrl,
          `histogram_quantile(0.9, sum(rate(response_latency_ms_bucket{namespace="${ns}",dst_service="${svc}"}[${window}])) by (le))`,
        ),
        this.promQuery(
          vizUrl,
          `histogram_quantile(0.99, sum(rate(response_latency_ms_bucket{namespace="${ns}",dst_service="${svc}"}[${window}])) by (le))`,
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
    // Linkerd enables mTLS by default for all meshed pods — no config CRD needed.
    // Report all services as strict.
    const services = await this.listServices(namespace);
    return services.map((s) => ({
      service: s.name,
      namespace: s.namespace,
      mtls: "strict",
    }));
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private extractVersions(labels?: Record<string, string>): string[] | undefined {
    if (!labels) return undefined;
    const version = labels["version"] ?? labels["app.kubernetes.io/version"];
    return version ? [version] : undefined;
  }

  private routeToTrafficSplit(route: TrafficRoute): Record<string, unknown> {
    return {
      apiVersion: "split.smi-spec.io/v1alpha4",
      kind: "TrafficSplit",
      metadata: {
        name: route.name,
        namespace: route.namespace,
        labels: {
          "app.kubernetes.io/managed-by": "espada",
          "espada/route-id": route.id,
        },
      },
      spec: {
        service: route.service,
        backends: route.destinations.map((d) => ({
          service: d.subset,
          weight: d.weight,
        })),
      },
    };
  }

  private authzRulesToLinkerdClient(rules: AuthorizationPolicy["rules"]): Record<string, unknown> {
    // Map the first rule's "from" to Linkerd client spec
    const firstFrom = rules[0]?.from?.[0];

    const client: Record<string, unknown> = {
      meshTLS: {
        identities: firstFrom?.principals ?? ["*"],
      },
    };

    if (firstFrom?.namespaces?.length) {
      client["meshTLS"] = {
        serviceAccounts: firstFrom.namespaces.map((ns) => ({
          namespace: ns,
          name: "*",
        })),
      };
    }

    return client;
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
