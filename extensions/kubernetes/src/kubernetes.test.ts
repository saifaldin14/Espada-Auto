import { describe, expect, it } from "vitest";
import {
  parseManifestJson,
  normalizeResource,
  parseResources,
  buildResourceGraph,
  resourceKey,
  getResourceKinds,
  getNamespaceDistribution,
  getEdgesByType,
} from "./manifest-parser.js";
import type { K8sResource } from "./types.js";

/* ---------- helpers ---------- */

function makeResource(overrides: Partial<K8sResource> = {}): K8sResource {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: "test-pod", namespace: "default" },
    spec: {},
    ...overrides,
  };
}

/* ================================================================
   parseManifestJson
   ================================================================ */

describe("parseManifestJson", () => {
  it("parses a single resource", () => {
    const json = JSON.stringify(makeResource());
    const manifest = parseManifestJson(json);
    expect(manifest.resources).toHaveLength(1);
    expect(manifest.resources[0]!.kind).toBe("Pod");
  });

  it("parses a List wrapper", () => {
    const json = JSON.stringify({
      kind: "List",
      apiVersion: "v1",
      items: [makeResource({ metadata: { name: "pod-1" } }), makeResource({ metadata: { name: "pod-2" } })],
    });
    const manifest = parseManifestJson(json);
    expect(manifest.resources).toHaveLength(2);
  });
});

/* ================================================================
   normalizeResource
   ================================================================ */

describe("normalizeResource", () => {
  it("normalizes a basic Pod", () => {
    const parsed = normalizeResource(makeResource());
    expect(parsed.kind).toBe("Pod");
    expect(parsed.name).toBe("test-pod");
    expect(parsed.namespace).toBe("default");
    expect(parsed.labels).toEqual({});
    expect(parsed.relations).toEqual([]);
  });

  it("defaults namespace to 'default' when missing", () => {
    const resource = makeResource({ metadata: { name: "no-ns" } });
    const parsed = normalizeResource(resource);
    expect(parsed.namespace).toBe("default");
  });

  it("preserves labels and annotations", () => {
    const resource = makeResource({
      metadata: {
        name: "labeled",
        namespace: "prod",
        labels: { app: "web", tier: "frontend" },
        annotations: { "kubectl.kubernetes.io/last-applied": "{}" },
      },
    });
    const parsed = normalizeResource(resource);
    expect(parsed.labels.app).toBe("web");
    expect(parsed.annotations["kubectl.kubernetes.io/last-applied"]).toBe("{}");
  });
});

/* ================================================================
   Relationship resolution
   ================================================================ */

describe("relationship resolution", () => {
  it("Deployment → manages Pod", () => {
    const deployment = makeResource({
      kind: "Deployment",
      apiVersion: "apps/v1",
      metadata: { name: "web", namespace: "default" },
      spec: {
        selector: { matchLabels: { app: "web" } },
        template: { spec: { containers: [{ name: "web", image: "nginx" }] } },
      },
    });
    const parsed = normalizeResource(deployment);
    expect(parsed.relations.some((r) => r.type === "manages" && r.targetKind === "Pod")).toBe(true);
  });

  it("Service → selects Pods", () => {
    const service = makeResource({
      kind: "Service",
      metadata: { name: "web-svc", namespace: "default" },
      spec: { selector: { app: "web" }, ports: [{ port: 80 }] },
    });
    const parsed = normalizeResource(service);
    expect(parsed.relations.some((r) => r.type === "selects" && r.targetKind === "Pod")).toBe(true);
  });

  it("Ingress → routes-to Service", () => {
    const ingress = makeResource({
      kind: "Ingress",
      apiVersion: "networking.k8s.io/v1",
      metadata: { name: "web-ingress", namespace: "default" },
      spec: {
        rules: [
          {
            http: {
              paths: [
                { path: "/", pathType: "Prefix", backend: { service: { name: "web-svc", port: { number: 80 } } } },
              ],
            },
          },
        ],
      },
    });
    const parsed = normalizeResource(ingress);
    expect(parsed.relations.some((r) => r.type === "routes-to" && r.targetName === "web-svc")).toBe(true);
  });

  it("Pod → mounts PVC", () => {
    const pod = makeResource({
      kind: "Pod",
      metadata: { name: "db", namespace: "default" },
      spec: {
        containers: [{ name: "db", image: "postgres" }],
        volumes: [{ name: "data", persistentVolumeClaim: { claimName: "db-pvc" } }],
      },
    });
    const parsed = normalizeResource(pod);
    expect(parsed.relations.some((r) => r.type === "mounts" && r.targetName === "db-pvc")).toBe(true);
  });

  it("Pod → uses ConfigMap volume", () => {
    const pod = makeResource({
      kind: "Pod",
      metadata: { name: "app", namespace: "default" },
      spec: {
        containers: [{ name: "app", image: "app:1" }],
        volumes: [{ name: "config", configMap: { name: "app-config" } }],
      },
    });
    const parsed = normalizeResource(pod);
    expect(parsed.relations.some((r) => r.type === "uses" && r.targetName === "app-config")).toBe(true);
  });

  it("Pod → uses Secret volume", () => {
    const pod = makeResource({
      kind: "Pod",
      metadata: { name: "app", namespace: "default" },
      spec: {
        containers: [{ name: "app", image: "app:1" }],
        volumes: [{ name: "tls", secret: { secretName: "tls-cert" } }],
      },
    });
    const parsed = normalizeResource(pod);
    expect(parsed.relations.some((r) => r.type === "uses" && r.targetName === "tls-cert")).toBe(true);
  });

  it("Deployment → mounts PVC via template", () => {
    const deployment = makeResource({
      kind: "Deployment",
      apiVersion: "apps/v1",
      metadata: { name: "stateful-web", namespace: "default" },
      spec: {
        template: {
          spec: {
            containers: [{ name: "web", image: "nginx" }],
            volumes: [{ name: "data", persistentVolumeClaim: { claimName: "web-data" } }],
          },
        },
      },
    });
    const parsed = normalizeResource(deployment);
    expect(parsed.relations.some((r) => r.type === "mounts" && r.targetName === "web-data")).toBe(true);
  });

  it("RoleBinding → binds-to Role", () => {
    const rb = makeResource({
      kind: "RoleBinding",
      apiVersion: "rbac.authorization.k8s.io/v1",
      metadata: { name: "admin-binding", namespace: "default" },
      spec: { roleRef: { kind: "ClusterRole", name: "admin" }, subjects: [] } as unknown as Record<string, unknown>,
    });
    const parsed = normalizeResource(rb);
    expect(parsed.relations.some((r) => r.type === "binds-to" && r.targetName === "admin")).toBe(true);
  });

  it("resource with ownerReferences → manages relation", () => {
    const pod = makeResource({
      kind: "Pod",
      metadata: {
        name: "web-abc",
        namespace: "default",
        ownerReferences: [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: "web-rs", uid: "uid-1" }],
      },
    });
    const parsed = normalizeResource(pod);
    expect(parsed.relations.some((r) => r.type === "manages" && r.targetKind === "ReplicaSet")).toBe(true);
  });
});

/* ================================================================
   buildResourceGraph
   ================================================================ */

describe("buildResourceGraph", () => {
  it("returns empty graph for no resources", () => {
    expect(buildResourceGraph([]).size).toBe(0);
  });

  it("builds graph with relationships", () => {
    const resources = parseResources([
      makeResource({ kind: "Service", metadata: { name: "svc", namespace: "default" }, spec: { selector: { app: "web" } } }),
      makeResource({ kind: "Deployment", apiVersion: "apps/v1", metadata: { name: "web", namespace: "default" }, spec: { template: { spec: {} } } }),
    ]);
    const graph = buildResourceGraph(resources);
    expect(graph.size).toBe(2);
    expect(graph.has("Service/default/svc")).toBe(true);
  });
});

/* ================================================================
   resourceKey
   ================================================================ */

describe("resourceKey", () => {
  it("builds kind/namespace/name key", () => {
    const parsed = normalizeResource(makeResource({ metadata: { name: "my-pod", namespace: "prod" } }));
    expect(resourceKey(parsed)).toBe("Pod/prod/my-pod");
  });
});

/* ================================================================
   getResourceKinds / getNamespaceDistribution
   ================================================================ */

describe("utility helpers", () => {
  const resources = parseResources([
    makeResource({ kind: "Pod", metadata: { name: "p1", namespace: "default" } }),
    makeResource({ kind: "Service", metadata: { name: "s1", namespace: "default" } }),
    makeResource({ kind: "Pod", metadata: { name: "p2", namespace: "prod" } }),
  ]);

  it("getResourceKinds returns unique kinds", () => {
    const kinds = getResourceKinds(resources);
    expect(kinds).toContain("Pod");
    expect(kinds).toContain("Service");
    expect(kinds).toHaveLength(2);
  });

  it("getNamespaceDistribution counts correctly", () => {
    const dist = getNamespaceDistribution(resources);
    expect(dist.default).toBe(2);
    expect(dist.prod).toBe(1);
  });
});

/* ================================================================
   getEdgesByType
   ================================================================ */

describe("getEdgesByType", () => {
  it("groups edges by type", () => {
    const resources = parseResources([
      makeResource({
        kind: "Ingress",
        apiVersion: "networking.k8s.io/v1",
        metadata: { name: "ing", namespace: "default" },
        spec: { rules: [{ http: { paths: [{ backend: { service: { name: "svc" } } }] } }] },
      }),
    ]);
    const edges = getEdgesByType(resources);
    expect(edges["routes-to"]).toBeDefined();
    expect(edges["routes-to"]!.length).toBeGreaterThan(0);
  });
});
