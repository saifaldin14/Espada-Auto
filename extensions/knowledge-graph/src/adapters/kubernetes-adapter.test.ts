/**
 * Kubernetes Adapter — Test Suite
 *
 * Covers:
 * - Node ID building
 * - Namespace discovery
 * - Workload discovery (Deployments, StatefulSets, DaemonSets)
 * - Service → workload routing via label selectors
 * - Ingress → Service routing
 * - PVC → PV binding
 * - Workload → ServiceAccount
 * - Workload → ConfigMap/Secret references
 * - NetworkPolicy → workload edges
 * - Owner reference edges
 * - Cross-cloud annotation edges
 * - Helm release detection
 * - Health check and error handling
 */

import { describe, it, expect, vi } from "vitest";
import {
  KubernetesDiscoveryAdapter,
  buildK8sNodeId,
  extractK8sRelationships,
  extractCrossCloudEdges,
  detectHelmReleases,
  CROSS_CLOUD_ANNOTATIONS,
} from "./kubernetes.js";
import type { K8sClient, K8sRawResource } from "./kubernetes.js";
import type { GraphNodeInput } from "../types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeResource(overrides: Partial<K8sRawResource> & { kind: string }): K8sRawResource {
  return {
    apiVersion: "v1",
    kind: overrides.kind,
    metadata: {
      name: overrides.metadata?.name ?? "test-resource",
      namespace: overrides.metadata?.namespace ?? "default",
      uid: overrides.metadata?.uid ?? "uid-" + Math.random().toString(36).slice(2, 8),
      creationTimestamp: overrides.metadata?.creationTimestamp ?? "2026-01-15T10:00:00Z",
      labels: overrides.metadata?.labels,
      annotations: overrides.metadata?.annotations,
      ownerReferences: overrides.metadata?.ownerReferences,
    },
    spec: overrides.spec,
    status: overrides.status,
  };
}

function makeDeployment(name: string, ns: string, opts: {
  labels?: Record<string, string>;
  replicas?: number;
  readyReplicas?: number;
  selectorLabels?: Record<string, string>;
  serviceAccountName?: string;
  volumes?: Array<Record<string, unknown>>;
  annotations?: Record<string, string>;
  ownerReferences?: K8sRawResource["metadata"]["ownerReferences"];
} = {}): K8sRawResource {
  return makeResource({
    kind: "Deployment",
    metadata: {
      name,
      namespace: ns,
      uid: `uid-deploy-${name}`,
      creationTimestamp: "2026-01-15T10:00:00Z",
      labels: { app: name, ...(opts.labels ?? {}), ...(opts.selectorLabels ?? {}) },
      annotations: opts.annotations,
      ownerReferences: opts.ownerReferences,
    },
    spec: {
      replicas: opts.replicas ?? 1,
      selector: { matchLabels: opts.selectorLabels ?? { app: name } },
      template: {
        spec: {
          serviceAccountName: opts.serviceAccountName,
          containers: [{ name: "main", image: "nginx" }],
          volumes: opts.volumes ?? [],
        },
      },
    },
    status: {
      replicas: opts.replicas ?? 1,
      readyReplicas: opts.readyReplicas ?? (opts.replicas ?? 1),
    },
  });
}

function makeService(name: string, ns: string, selector?: Record<string, string>): K8sRawResource {
  return makeResource({
    kind: "Service",
    metadata: {
      name,
      namespace: ns,
      uid: `uid-svc-${name}`,
      creationTimestamp: "2026-01-15T10:00:00Z",
    },
    spec: { selector: selector ?? { app: name } },
  });
}

function createMockClient(resources: {
  namespaces?: K8sRawResource[];
  deployments?: Record<string, K8sRawResource[]>;
  statefulSets?: Record<string, K8sRawResource[]>;
  daemonSets?: Record<string, K8sRawResource[]>;
  replicaSets?: Record<string, K8sRawResource[]>;
  services?: Record<string, K8sRawResource[]>;
  ingresses?: Record<string, K8sRawResource[]>;
  configMaps?: Record<string, K8sRawResource[]>;
  secrets?: Record<string, K8sRawResource[]>;
  pvs?: K8sRawResource[];
  pvcs?: Record<string, K8sRawResource[]>;
  serviceAccounts?: Record<string, K8sRawResource[]>;
  networkPolicies?: Record<string, K8sRawResource[]>;
  cronJobs?: Record<string, K8sRawResource[]>;
  jobs?: Record<string, K8sRawResource[]>;
  nodes?: K8sRawResource[];
}): K8sClient {
  return {
    getNamespaces: vi.fn(async () => resources.namespaces ?? []),
    getDeployments: vi.fn(async (ns) => resources.deployments?.[ns] ?? []),
    getStatefulSets: vi.fn(async (ns) => resources.statefulSets?.[ns] ?? []),
    getDaemonSets: vi.fn(async (ns) => resources.daemonSets?.[ns] ?? []),
    getReplicaSets: vi.fn(async (ns) => resources.replicaSets?.[ns] ?? []),
    getServices: vi.fn(async (ns) => resources.services?.[ns] ?? []),
    getIngresses: vi.fn(async (ns) => resources.ingresses?.[ns] ?? []),
    getConfigMaps: vi.fn(async (ns) => resources.configMaps?.[ns] ?? []),
    getSecrets: vi.fn(async (ns) => resources.secrets?.[ns] ?? []),
    getPersistentVolumes: vi.fn(async () => resources.pvs ?? []),
    getPersistentVolumeClaims: vi.fn(async (ns) => resources.pvcs?.[ns] ?? []),
    getServiceAccounts: vi.fn(async (ns) => resources.serviceAccounts?.[ns] ?? []),
    getNetworkPolicies: vi.fn(async (ns) => resources.networkPolicies?.[ns] ?? []),
    getCronJobs: vi.fn(async (ns) => resources.cronJobs?.[ns] ?? []),
    getJobs: vi.fn(async (ns) => resources.jobs?.[ns] ?? []),
    getNodes: vi.fn(async () => resources.nodes ?? []),
    getClusterInfo: vi.fn(async () => ({ name: "test-cluster", version: "1.29" })),
    healthCheck: vi.fn(async () => true),
  };
}

// =============================================================================
// Tests — buildK8sNodeId
// =============================================================================

describe("buildK8sNodeId", () => {
  it("builds deterministic IDs", () => {
    expect(buildK8sNodeId("my-cluster", "default", "deployment", "nginx")).toBe(
      "kubernetes:my-cluster:default:deployment:nginx",
    );
  });

  it("handles cluster-scoped resources", () => {
    expect(buildK8sNodeId("prod", "_cluster", "persistent-volume", "pv-1")).toBe(
      "kubernetes:prod:_cluster:persistent-volume:pv-1",
    );
  });
});

// =============================================================================
// Tests — KubernetesDiscoveryAdapter
// =============================================================================

describe("KubernetesDiscoveryAdapter", () => {
  it("returns provider and display name", () => {
    const adapter = new KubernetesDiscoveryAdapter();
    expect(adapter.provider).toBe("kubernetes");
    expect(adapter.displayName).toBe("Kubernetes");
    expect(adapter.supportedResourceTypes().length).toBeGreaterThan(10);
    expect(adapter.supportsIncrementalSync()).toBe(false);
  });

  it("discovers namespaces and creates cluster node", async () => {
    const client = createMockClient({
      namespaces: [
        makeResource({ kind: "Namespace", metadata: { name: "default", uid: "uid-ns-default", creationTimestamp: "2026-01-01T00:00:00Z" } }),
        makeResource({ kind: "Namespace", metadata: { name: "app", uid: "uid-ns-app", creationTimestamp: "2026-01-02T00:00:00Z" } }),
      ],
    });

    const adapter = new KubernetesDiscoveryAdapter({
      clusterName: "test-cluster",
      clientFactory: async () => client,
    });

    const result = await adapter.discover();
    expect(result.provider).toBe("kubernetes");
    expect(result.errors).toHaveLength(0);

    // Should have: cluster + 2 namespaces + default nodes for other resources
    const clusterNode = result.nodes.find((n) => n.resourceType === "cluster");
    expect(clusterNode).toBeDefined();
    expect(clusterNode!.name).toBe("test-cluster");

    const nsNodes = result.nodes.filter((n) => n.resourceType === "namespace");
    expect(nsNodes).toHaveLength(2);

    // Namespace → Cluster edges
    const nsEdges = result.edges.filter((e) => e.relationshipType === "runs-in" && e.targetNodeId.includes("cluster"));
    expect(nsEdges).toHaveLength(2);
  });

  it("excludes system namespaces by default", async () => {
    const client = createMockClient({
      namespaces: [
        makeResource({ kind: "Namespace", metadata: { name: "default", uid: "uid-1", creationTimestamp: "2026-01-01T00:00:00Z" } }),
        makeResource({ kind: "Namespace", metadata: { name: "kube-system", uid: "uid-2", creationTimestamp: "2026-01-01T00:00:00Z" } }),
        makeResource({ kind: "Namespace", metadata: { name: "kube-public", uid: "uid-3", creationTimestamp: "2026-01-01T00:00:00Z" } }),
      ],
    });

    const adapter = new KubernetesDiscoveryAdapter({
      clusterName: "test",
      clientFactory: async () => client,
    });

    const result = await adapter.discover();
    const nsNodes = result.nodes.filter((n) => n.resourceType === "namespace");
    expect(nsNodes).toHaveLength(1);
    expect(nsNodes[0]!.name).toBe("default");
  });

  it("includes system namespaces when configured", async () => {
    const client = createMockClient({
      namespaces: [
        makeResource({ kind: "Namespace", metadata: { name: "default", uid: "uid-1", creationTimestamp: "2026-01-01T00:00:00Z" } }),
        makeResource({ kind: "Namespace", metadata: { name: "kube-system", uid: "uid-2", creationTimestamp: "2026-01-01T00:00:00Z" } }),
      ],
    });

    const adapter = new KubernetesDiscoveryAdapter({
      clusterName: "test",
      includeSystem: true,
      clientFactory: async () => client,
    });

    const result = await adapter.discover();
    const nsNodes = result.nodes.filter((n) => n.resourceType === "namespace");
    expect(nsNodes).toHaveLength(2);
  });

  it("discovers deployments with relationships", async () => {
    const deploy = makeDeployment("web-api", "default", {
      serviceAccountName: "web-sa",
      selectorLabels: { app: "web-api" },
    });

    const svc = makeService("web-api", "default", { app: "web-api" });

    const client = createMockClient({
      namespaces: [
        makeResource({ kind: "Namespace", metadata: { name: "default", uid: "uid-ns", creationTimestamp: "2026-01-01T00:00:00Z" } }),
      ],
      deployments: { default: [deploy] },
      services: { default: [svc] },
    });

    const adapter = new KubernetesDiscoveryAdapter({
      clusterName: "prod",
      clientFactory: async () => client,
    });

    const result = await adapter.discover();

    // Should have deployment node
    const deployNode = result.nodes.find((n) => n.resourceType === "deployment");
    expect(deployNode).toBeDefined();
    expect(deployNode!.name).toBe("web-api");
    expect(deployNode!.status).toBe("running");

    // Deployment → Namespace edge
    const nsEdge = result.edges.find(
      (e) => e.sourceNodeId.includes("deployment:web-api") && e.relationshipType === "runs-in",
    );
    expect(nsEdge).toBeDefined();

    // Service → Deployment edge (via label selector)
    const routeEdge = result.edges.find(
      (e) => e.sourceNodeId.includes("load-balancer:web-api") && e.relationshipType === "routes-to",
    );
    expect(routeEdge).toBeDefined();
    expect(routeEdge!.targetNodeId).toContain("deployment:web-api");
  });

  it("discovers Ingress → Service edges", async () => {
    const ingress = makeResource({
      kind: "Ingress",
      metadata: { name: "main-ingress", namespace: "default", uid: "uid-ing", creationTimestamp: "2026-01-15T10:00:00Z" },
      spec: {
        rules: [
          {
            host: "api.example.com",
            http: {
              paths: [
                { path: "/", backend: { service: { name: "web-svc" } } },
                { path: "/admin", backend: { service: { name: "admin-svc" } } },
              ],
            },
          },
        ],
      },
    });

    const client = createMockClient({
      namespaces: [
        makeResource({ kind: "Namespace", metadata: { name: "default", uid: "uid-ns", creationTimestamp: "2026-01-01T00:00:00Z" } }),
      ],
      ingresses: { default: [ingress] },
    });

    const adapter = new KubernetesDiscoveryAdapter({
      clusterName: "prod",
      clientFactory: async () => client,
    });

    const result = await adapter.discover();

    const ingressEdges = result.edges.filter(
      (e) => e.sourceNodeId.includes("ingress:main-ingress") && e.relationshipType === "routes-to",
    );
    expect(ingressEdges).toHaveLength(2);
    expect(ingressEdges.map((e) => e.targetNodeId)).toContain(
      buildK8sNodeId("prod", "default", "load-balancer", "web-svc"),
    );
    expect(ingressEdges.map((e) => e.targetNodeId)).toContain(
      buildK8sNodeId("prod", "default", "load-balancer", "admin-svc"),
    );
  });

  it("discovers PVC → PV binding", async () => {
    const pvc = makeResource({
      kind: "PersistentVolumeClaim",
      metadata: { name: "data-pvc", namespace: "default", uid: "uid-pvc", creationTimestamp: "2026-01-15T10:00:00Z" },
      spec: { volumeName: "pv-data-001" },
      status: { phase: "Bound" },
    });
    const pv = makeResource({
      kind: "PersistentVolume",
      metadata: { name: "pv-data-001", uid: "uid-pv", creationTimestamp: "2026-01-15T10:00:00Z" },
      status: { phase: "Bound" },
    });

    const client = createMockClient({
      namespaces: [
        makeResource({ kind: "Namespace", metadata: { name: "default", uid: "uid-ns", creationTimestamp: "2026-01-01T00:00:00Z" } }),
      ],
      pvcs: { default: [pvc] },
      pvs: [pv],
    });

    const adapter = new KubernetesDiscoveryAdapter({
      clusterName: "prod",
      clientFactory: async () => client,
    });

    const result = await adapter.discover();

    const pvcNode = result.nodes.find((n) => n.resourceType === "persistent-volume-claim");
    expect(pvcNode).toBeDefined();
    expect(pvcNode!.status).toBe("running"); // Bound → running

    const pvNode = result.nodes.find((n) => n.resourceType === "persistent-volume");
    expect(pvNode).toBeDefined();

    const bindEdge = result.edges.find(
      (e) => e.sourceNodeId.includes("persistent-volume-claim:data-pvc") && e.relationshipType === "backed-by",
    );
    expect(bindEdge).toBeDefined();
    expect(bindEdge!.targetNodeId).toContain("persistent-volume:pv-data-001");
  });

  it("discovers Deployment → ConfigMap/Secret references", async () => {
    const deploy = makeDeployment("app", "default", {
      volumes: [
        { name: "config-vol", configMap: { name: "app-config" } },
        { name: "secret-vol", secret: { secretName: "app-secret" } },
      ],
    });

    const client = createMockClient({
      namespaces: [
        makeResource({ kind: "Namespace", metadata: { name: "default", uid: "uid-ns", creationTimestamp: "2026-01-01T00:00:00Z" } }),
      ],
      deployments: { default: [deploy] },
      configMaps: {
        default: [
          makeResource({ kind: "ConfigMap", metadata: { name: "app-config", namespace: "default", uid: "uid-cm", creationTimestamp: "2026-01-15T10:00:00Z" } }),
        ],
      },
      secrets: {
        default: [
          makeResource({ kind: "Secret", metadata: { name: "app-secret", namespace: "default", uid: "uid-s", creationTimestamp: "2026-01-15T10:00:00Z" } }),
        ],
      },
    });

    const adapter = new KubernetesDiscoveryAdapter({
      clusterName: "prod",
      clientFactory: async () => client,
    });

    const result = await adapter.discover();

    const configEdges = result.edges.filter(
      (e) => e.sourceNodeId.includes("deployment:app") && e.relationshipType === "reads-from",
    );
    expect(configEdges).toHaveLength(2);
    expect(configEdges.find((e) => e.targetNodeId.includes("configmap:app-config"))).toBeDefined();
    expect(configEdges.find((e) => e.targetNodeId.includes("secret:app-secret"))).toBeDefined();
  });

  it("discovers NetworkPolicy → workload edges", async () => {
    const netpol = makeResource({
      kind: "NetworkPolicy",
      metadata: { name: "deny-all", namespace: "default", uid: "uid-np", creationTimestamp: "2026-01-15T10:00:00Z" },
      spec: {
        podSelector: { matchLabels: { app: "web" } },
        ingress: [],
      },
    });

    const deploy = makeDeployment("web", "default", {
      selectorLabels: { app: "web" },
    });

    const client = createMockClient({
      namespaces: [
        makeResource({ kind: "Namespace", metadata: { name: "default", uid: "uid-ns", creationTimestamp: "2026-01-01T00:00:00Z" } }),
      ],
      networkPolicies: { default: [netpol] },
      deployments: { default: [deploy] },
    });

    const adapter = new KubernetesDiscoveryAdapter({
      clusterName: "prod",
      clientFactory: async () => client,
    });

    const result = await adapter.discover();

    const secureEdge = result.edges.find(
      (e) => e.sourceNodeId.includes("policy:deny-all") && e.relationshipType === "secures",
    );
    expect(secureEdge).toBeDefined();
    expect(secureEdge!.targetNodeId).toContain("deployment:web");
  });

  it("discovers owner reference edges", async () => {
    const rs = makeResource({
      kind: "ReplicaSet",
      metadata: {
        name: "web-rs-abc",
        namespace: "default",
        uid: "uid-rs",
        creationTimestamp: "2026-01-15T10:00:00Z",
        ownerReferences: [
          { apiVersion: "apps/v1", kind: "Deployment", name: "web", uid: "uid-deploy-web" },
        ],
      },
    });

    const client = createMockClient({
      namespaces: [
        makeResource({ kind: "Namespace", metadata: { name: "default", uid: "uid-ns", creationTimestamp: "2026-01-01T00:00:00Z" } }),
      ],
      replicaSets: { default: [rs] },
    });

    const adapter = new KubernetesDiscoveryAdapter({
      clusterName: "prod",
      clientFactory: async () => client,
    });

    const result = await adapter.discover();

    const ownerEdge = result.edges.find(
      (e) => e.sourceNodeId.includes("replicaset:web-rs-abc") && e.relationshipType === "member-of",
    );
    expect(ownerEdge).toBeDefined();
    expect(ownerEdge!.targetNodeId).toContain("deployment:web");
  });

  it("handles connection failure gracefully", async () => {
    const adapter = new KubernetesDiscoveryAdapter({
      clientFactory: async () => {
        throw new Error("connection refused");
      },
    });

    const result = await adapter.discover();
    expect(result.nodes).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.message).toContain("connection refused");
  });

  it("health check delegates to client", async () => {
    const client = createMockClient({});
    const adapter = new KubernetesDiscoveryAdapter({ clientFactory: async () => client });
    expect(await adapter.healthCheck()).toBe(true);
  });

  it("supports resource type filtering", async () => {
    const client = createMockClient({
      namespaces: [
        makeResource({ kind: "Namespace", metadata: { name: "default", uid: "uid-ns", creationTimestamp: "2026-01-01T00:00:00Z" } }),
      ],
      deployments: {
        default: [makeDeployment("web", "default")],
      },
      services: {
        default: [makeService("web", "default")],
      },
    });

    const adapter = new KubernetesDiscoveryAdapter({
      clusterName: "test",
      clientFactory: async () => client,
    });

    const result = await adapter.discover({ resourceTypes: ["deployment"] });
    const deploys = result.nodes.filter((n) => n.resourceType === "deployment");
    const svcs = result.nodes.filter((n) => n.resourceType === "load-balancer");
    expect(deploys.length).toBeGreaterThan(0);
    expect(svcs).toHaveLength(0);
  });

  it("supports tag filtering", async () => {
    const client = createMockClient({
      namespaces: [
        makeResource({ kind: "Namespace", metadata: { name: "default", uid: "uid-ns", creationTimestamp: "2026-01-01T00:00:00Z" } }),
      ],
      deployments: {
        default: [
          makeDeployment("web", "default", { labels: { env: "prod" } }),
          makeDeployment("test-app", "default", { labels: { env: "staging" } }),
        ],
      },
    });

    const adapter = new KubernetesDiscoveryAdapter({
      clusterName: "test",
      clientFactory: async () => client,
    });

    const result = await adapter.discover({ tags: { env: "prod" } });
    const deploys = result.nodes.filter((n) => n.resourceType === "deployment");
    expect(deploys).toHaveLength(1);
    expect(deploys[0]!.name).toBe("web");
  });
});

// =============================================================================
// Tests — extractCrossCloudEdges
// =============================================================================

describe("extractCrossCloudEdges", () => {
  it("extracts EKS IAM role annotation", () => {
    const resource = makeResource({
      kind: "ServiceAccount",
      metadata: {
        name: "my-sa",
        namespace: "default",
        uid: "uid-sa",
        creationTimestamp: "2026-01-15T10:00:00Z",
        annotations: {
          "eks.amazonaws.com/role-arn": "arn:aws:iam::123456789:role/my-role",
        },
      },
    });

    const edges = extractCrossCloudEdges(resource, "eks-cluster");
    expect(edges).toHaveLength(1);
    expect(edges[0]!.relationshipType).toBe("uses");
    expect(edges[0]!.targetNodeId).toContain("aws:");
    expect(edges[0]!.targetNodeId).toContain("iam-role");
    expect(edges[0]!.confidence).toBe(0.8);
  });

  it("extracts Azure Workload Identity annotation", () => {
    const resource = makeResource({
      kind: "ServiceAccount",
      metadata: {
        name: "az-sa",
        namespace: "default",
        uid: "uid-sa-az",
        creationTimestamp: "2026-01-15T10:00:00Z",
        annotations: {
          "azure.workload.identity/client-id": "abc-123-def",
        },
      },
    });

    const edges = extractCrossCloudEdges(resource, "aks-cluster");
    expect(edges).toHaveLength(1);
    expect(edges[0]!.targetNodeId).toContain("azure:");
    expect(edges[0]!.targetNodeId).toContain("identity");
  });

  it("extracts GKE workload identity annotation", () => {
    const resource = makeResource({
      kind: "ServiceAccount",
      metadata: {
        name: "gke-sa",
        namespace: "default",
        uid: "uid-sa-gke",
        creationTimestamp: "2026-01-15T10:00:00Z",
        annotations: {
          "iam.gke.io/gcp-service-account": "my-sa@my-project.iam.gserviceaccount.com",
        },
      },
    });

    const edges = extractCrossCloudEdges(resource, "gke-cluster");
    expect(edges).toHaveLength(1);
    expect(edges[0]!.targetNodeId).toContain("gcp:");
  });

  it("returns empty for resources without annotations", () => {
    const resource = makeResource({
      kind: "Deployment",
      metadata: { name: "web", namespace: "default", uid: "uid-1", creationTimestamp: "2026-01-15T10:00:00Z" },
    });

    const edges = extractCrossCloudEdges(resource, "test");
    expect(edges).toHaveLength(0);
  });
});

// =============================================================================
// Tests — detectHelmReleases
// =============================================================================

describe("detectHelmReleases", () => {
  it("groups resources by Helm release", () => {
    const nodes: GraphNodeInput[] = [
      {
        id: "kubernetes:prod:default:deployment:redis-master",
        provider: "kubernetes",
        resourceType: "deployment",
        nativeId: "default/Deployment/redis-master",
        name: "redis-master",
        region: "default",
        account: "prod",
        status: "running",
        tags: {
          "app.kubernetes.io/managed-by": "Helm",
          "meta.helm.sh/release-name": "redis",
          "meta.helm.sh/release-namespace": "default",
          "helm.sh/chart": "redis-18.0.0",
          "app.kubernetes.io/version": "7.2.0",
        },
        metadata: {},
        costMonthly: null,
        owner: null,
        createdAt: null,
      },
      {
        id: "kubernetes:prod:default:load-balancer:redis",
        provider: "kubernetes",
        resourceType: "load-balancer",
        nativeId: "default/Service/redis",
        name: "redis",
        region: "default",
        account: "prod",
        status: "running",
        tags: {
          "app.kubernetes.io/managed-by": "Helm",
          "meta.helm.sh/release-name": "redis",
          "meta.helm.sh/release-namespace": "default",
        },
        metadata: {},
        costMonthly: null,
        owner: null,
        createdAt: null,
      },
      {
        id: "kubernetes:prod:default:deployment:nginx",
        provider: "kubernetes",
        resourceType: "deployment",
        nativeId: "default/Deployment/nginx",
        name: "nginx",
        region: "default",
        account: "prod",
        status: "running",
        tags: {}, // Not Helm-managed
        metadata: {},
        costMonthly: null,
        owner: null,
        createdAt: null,
      },
    ];

    const releases = detectHelmReleases(nodes);
    expect(releases).toHaveLength(1);
    expect(releases[0]!.name).toBe("redis");
    expect(releases[0]!.namespace).toBe("default");
    expect(releases[0]!.chart).toBe("redis-18.0.0");
    expect(releases[0]!.version).toBe("7.2.0");
    expect(releases[0]!.nodeIds).toHaveLength(2);
  });

  it("groups multiple releases across namespaces", () => {
    const nodes: GraphNodeInput[] = [
      {
        id: "k8s:a:default:deployment:redis",
        provider: "kubernetes",
        resourceType: "deployment",
        nativeId: "default/Deployment/redis",
        name: "redis",
        region: "default",
        account: "a",
        status: "running",
        tags: {
          "app.kubernetes.io/managed-by": "Helm",
          "meta.helm.sh/release-name": "redis",
          "meta.helm.sh/release-namespace": "default",
        },
        metadata: {},
        costMonthly: null,
        owner: null,
        createdAt: null,
      },
      {
        id: "k8s:a:monitoring:deployment:prometheus",
        provider: "kubernetes",
        resourceType: "deployment",
        nativeId: "monitoring/Deployment/prometheus",
        name: "prometheus",
        region: "monitoring",
        account: "a",
        status: "running",
        tags: {
          "app.kubernetes.io/managed-by": "Helm",
          "meta.helm.sh/release-name": "prometheus",
          "meta.helm.sh/release-namespace": "monitoring",
        },
        metadata: {},
        costMonthly: null,
        owner: null,
        createdAt: null,
      },
    ];

    const releases = detectHelmReleases(nodes);
    expect(releases).toHaveLength(2);
    expect(releases.map((r) => r.name).sort()).toEqual(["prometheus", "redis"]);
  });

  it("returns empty for non-Helm resources", () => {
    const nodes: GraphNodeInput[] = [
      {
        id: "k8s:a:default:deployment:web",
        provider: "kubernetes",
        resourceType: "deployment",
        nativeId: "default/Deployment/web",
        name: "web",
        region: "default",
        account: "a",
        status: "running",
        tags: {},
        metadata: {},
        costMonthly: null,
        owner: null,
        createdAt: null,
      },
    ];

    expect(detectHelmReleases(nodes)).toHaveLength(0);
  });
});

// =============================================================================
// Tests — CROSS_CLOUD_ANNOTATIONS
// =============================================================================

describe("CROSS_CLOUD_ANNOTATIONS", () => {
  it("covers AWS, Azure, and GCP", () => {
    const providers = new Set(CROSS_CLOUD_ANNOTATIONS.map((a) => a.cloudProvider));
    expect(providers.has("aws")).toBe(true);
    expect(providers.has("azure")).toBe(true);
    expect(providers.has("gcp")).toBe(true);
  });

  it("has at least 5 rules", () => {
    expect(CROSS_CLOUD_ANNOTATIONS.length).toBeGreaterThanOrEqual(5);
  });
});

// =============================================================================
// Tests — extractK8sRelationships (unit)
// =============================================================================

describe("extractK8sRelationships", () => {
  it("creates Deployment → ServiceAccount edge", () => {
    const deploy = makeDeployment("web", "default", {
      serviceAccountName: "web-sa",
    });

    const allResources = new Map<string, K8sRawResource[]>();
    allResources.set("default/Deployment", [deploy]);

    const edges = extractK8sRelationships(deploy, "test", allResources);
    const saEdge = edges.find((e) => e.relationshipType === "uses" && e.targetNodeId.includes("identity:web-sa"));
    expect(saEdge).toBeDefined();
  });

  it("skips default service account", () => {
    const deploy = makeDeployment("web", "default", {
      serviceAccountName: "default",
    });

    const allResources = new Map<string, K8sRawResource[]>();
    const edges = extractK8sRelationships(deploy, "test", allResources);
    const saEdge = edges.find((e) => e.relationshipType === "uses" && e.targetNodeId.includes("identity"));
    expect(saEdge).toBeUndefined();
  });

  it("creates PVC → PV edges", () => {
    const pvc = makeResource({
      kind: "PersistentVolumeClaim",
      metadata: { name: "data", namespace: "default", uid: "uid-pvc", creationTimestamp: "2026-01-15T10:00:00Z" },
      spec: { volumeName: "pv-001" },
    });

    const allResources = new Map<string, K8sRawResource[]>();
    allResources.set("default/PersistentVolumeClaim", [pvc]);

    const edges = extractK8sRelationships(pvc, "test", allResources);
    const pvEdge = edges.find((e) => e.relationshipType === "backed-by");
    expect(pvEdge).toBeDefined();
    expect(pvEdge!.targetNodeId).toContain("persistent-volume:pv-001");
  });
});
