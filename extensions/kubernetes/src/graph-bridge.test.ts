/**
 * Kubernetes → Knowledge Graph Bridge — Unit Tests
 */

import { describe, it, expect, vi } from "vitest";
import {
  k8sKindToGraphType,
  resourcesToGraphNodes,
  relationsToGraphEdges,
  syncResourcesToGraph,
  diffGraphVsResources,
} from "./graph-bridge.js";
import type { ParsedK8sResource, GraphStorage, GraphNode } from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────────

function makeK8sResource(overrides: Partial<ParsedK8sResource> = {}): ParsedK8sResource {
  return {
    kind: "Deployment",
    name: "web-app",
    namespace: "default",
    apiVersion: "apps/v1",
    labels: { app: "web", tier: "frontend" },
    annotations: {},
    uid: "uid-1234-abcd",
    creationTimestamp: "2024-01-15T10:00:00Z",
    spec: {},
    relations: [],
    ...overrides,
  };
}

function createMockGraphStorage(existingNodes: GraphNode[] = []): GraphStorage {
  return {
    initialize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    upsertNode: vi.fn(async () => {}),
    upsertNodes: vi.fn(async () => {}),
    getNode: vi.fn(async () => null),
    getNodeByNativeId: vi.fn(async () => null),
    queryNodes: vi.fn(async () => existingNodes),
    deleteNode: vi.fn(async () => {}),
    upsertEdge: vi.fn(async () => {}),
    upsertEdges: vi.fn(async () => {}),
    getEdge: vi.fn(async () => null),
    queryEdges: vi.fn(async () => []),
    deleteEdge: vi.fn(async () => {}),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("k8sKindToGraphType", () => {
  it("maps Pod to compute", () => {
    expect(k8sKindToGraphType("Pod")).toBe("compute");
  });

  it("maps Deployment to compute", () => {
    expect(k8sKindToGraphType("Deployment")).toBe("compute");
  });

  it("maps Service to load-balancer", () => {
    expect(k8sKindToGraphType("Service")).toBe("load-balancer");
  });

  it("maps Ingress to network", () => {
    expect(k8sKindToGraphType("Ingress")).toBe("network");
  });

  it("maps ConfigMap to custom", () => {
    expect(k8sKindToGraphType("ConfigMap")).toBe("custom");
  });

  it("maps Secret to secret", () => {
    expect(k8sKindToGraphType("Secret")).toBe("secret");
  });

  it("maps Namespace to vpc", () => {
    expect(k8sKindToGraphType("Namespace")).toBe("vpc");
  });

  it("maps PersistentVolumeClaim to storage", () => {
    expect(k8sKindToGraphType("PersistentVolumeClaim")).toBe("storage");
  });

  it("maps ServiceAccount to identity", () => {
    expect(k8sKindToGraphType("ServiceAccount")).toBe("identity");
  });

  it("maps NetworkPolicy to security-group", () => {
    expect(k8sKindToGraphType("NetworkPolicy")).toBe("security-group");
  });

  it("returns custom for unknown kind", () => {
    expect(k8sKindToGraphType("CustomResourceDef")).toBe("custom");
  });
});

describe("resourcesToGraphNodes", () => {
  it("converts K8s resources to graph nodes", () => {
    const resources = [makeK8sResource()];
    const nodes = resourcesToGraphNodes(resources);

    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.provider).toBe("kubernetes");
    expect(node.resourceType).toBe("compute");
    expect(node.name).toBe("web-app");
    expect(node.account).toBe("default"); // namespace
    expect(node.nativeId).toBe("uid-1234-abcd");
  });

  it("uses labels as tags", () => {
    const nodes = resourcesToGraphNodes([makeK8sResource()]);
    expect(nodes[0]!.tags).toEqual({ app: "web", tier: "frontend" });
  });

  it("sets managedBy and k8sKind in metadata", () => {
    const nodes = resourcesToGraphNodes([makeK8sResource()]);
    const meta = nodes[0]!.metadata as Record<string, unknown>;

    expect(meta.managedBy).toBe("kubernetes");
    expect(meta.k8sKind).toBe("Deployment");
    expect(meta.k8sApiVersion).toBe("apps/v1");
    expect(meta.k8sNamespace).toBe("default");
  });

  it("uses cluster name as region", () => {
    const nodes = resourcesToGraphNodes([makeK8sResource()], "prod-cluster");
    expect(nodes[0]!.region).toBe("prod-cluster");
    const meta = nodes[0]!.metadata as Record<string, unknown>;
    expect(meta.k8sCluster).toBe("prod-cluster");
  });

  it("defaults cluster name to 'default'", () => {
    const nodes = resourcesToGraphNodes([makeK8sResource()]);
    expect(nodes[0]!.region).toBe("default");
  });

  it("builds deterministic node ID in format kubernetes:ns:kind:name", () => {
    const nodes = resourcesToGraphNodes([makeK8sResource()]);
    expect(nodes[0]!.id).toBe("kubernetes:default:Deployment:web-app");
  });

  it("constructs fallback nativeId when uid is missing", () => {
    const resource = makeK8sResource({ uid: undefined });
    const nodes = resourcesToGraphNodes([resource]);
    expect(nodes[0]!.nativeId).toBe("default/Deployment/web-app");
  });

  it("extracts creation timestamp", () => {
    const nodes = resourcesToGraphNodes([makeK8sResource()]);
    expect(nodes[0]!.createdAt).toBe("2024-01-15T10:00:00Z");
  });

  it("extracts owner from managed-by annotation", () => {
    const resource = makeK8sResource({
      annotations: { "app.kubernetes.io/managed-by": "helm" },
    });
    const nodes = resourcesToGraphNodes([resource]);
    expect(nodes[0]!.owner).toBe("helm");
  });

  it("defaults status to running", () => {
    const nodes = resourcesToGraphNodes([makeK8sResource()]);
    expect(nodes[0]!.status).toBe("running");
  });
});

describe("relationsToGraphEdges", () => {
  it("converts K8s relations to graph edges", () => {
    const service = makeK8sResource({
      kind: "Service",
      name: "web-svc",
      relations: [
        { targetKind: "Deployment", targetName: "web-app", type: "routes-to" },
      ],
    });
    const deployment = makeK8sResource();

    const edges = relationsToGraphEdges([service, deployment]);
    const routesTo = edges.filter((e) => e.relationshipType === "routes-to");

    expect(routesTo).toHaveLength(1);
    expect(routesTo[0]!.sourceNodeId).toBe("kubernetes:default:Service:web-svc");
    expect(routesTo[0]!.targetNodeId).toBe("kubernetes:default:Deployment:web-app");
    expect(routesTo[0]!.discoveredVia).toBe("iac-parse");
    expect(routesTo[0]!.confidence).toBe(0.9);
  });

  it("maps manages edge type to contains", () => {
    const rs = makeK8sResource({
      kind: "ReplicaSet",
      name: "web-rs",
      relations: [
        { targetKind: "Deployment", targetName: "web-app", type: "manages" },
      ],
    });
    const deployment = makeK8sResource();

    const edges = relationsToGraphEdges([rs, deployment]);
    const containsEdges = edges.filter((e) => e.relationshipType === "contains");

    // At least one from the manages relation
    expect(containsEdges.length).toBeGreaterThanOrEqual(1);
  });

  it("maps mounts edge type to attached-to", () => {
    const pod = makeK8sResource({
      kind: "Pod",
      name: "web-pod",
      relations: [
        { targetKind: "PersistentVolumeClaim", targetName: "data-pvc", type: "mounts" },
      ],
    });
    const pvc = makeK8sResource({
      kind: "PersistentVolumeClaim",
      name: "data-pvc",
    });

    const edges = relationsToGraphEdges([pod, pvc]);
    const attached = edges.filter((e) => e.relationshipType === "attached-to");
    expect(attached).toHaveLength(1);
  });

  it("maps binds-to edge type to authenticated-by", () => {
    const rb = makeK8sResource({
      kind: "RoleBinding",
      name: "admin-binding",
      relations: [
        { targetKind: "ServiceAccount", targetName: "admin-sa", type: "binds-to" },
      ],
    });
    const sa = makeK8sResource({
      kind: "ServiceAccount",
      name: "admin-sa",
    });

    const edges = relationsToGraphEdges([rb, sa]);
    const authEdges = edges.filter((e) => e.relationshipType === "authenticated-by");
    expect(authEdges).toHaveLength(1);
  });

  it("adds namespace containment edges for non-Namespace resources", () => {
    const ns = makeK8sResource({
      kind: "Namespace",
      name: "default",
      namespace: "default",
    });
    const deployment = makeK8sResource();

    const edges = relationsToGraphEdges([ns, deployment]);
    const containsEdges = edges.filter((e) => e.relationshipType === "contains");

    // deployment should have a namespace containment edge
    expect(containsEdges.some((e) =>
      e.sourceNodeId === "kubernetes:default:Namespace:default" &&
      e.targetNodeId === "kubernetes:default:Deployment:web-app",
    )).toBe(true);
  });

  it("skips namespace containment for Namespace kind itself", () => {
    const ns = makeK8sResource({
      kind: "Namespace",
      name: "default",
      namespace: "default",
    });

    const edges = relationsToGraphEdges([ns]);
    const containsEdges = edges.filter((e) =>
      e.sourceNodeId.includes("Namespace") && e.targetNodeId.includes("Namespace"),
    );
    expect(containsEdges).toHaveLength(0);
  });

  it("skips relations to resources not in the parsed set", () => {
    const service = makeK8sResource({
      kind: "Service",
      name: "web-svc",
      relations: [
        { targetKind: "Deployment", targetName: "missing-deployment", type: "routes-to" },
      ],
    });

    const edges = relationsToGraphEdges([service]);
    const routesTo = edges.filter((e) => e.relationshipType === "routes-to");
    expect(routesTo).toHaveLength(0);
  });

  it("handles cross-namespace relations", () => {
    const service = makeK8sResource({
      kind: "Service",
      name: "external-svc",
      namespace: "kube-system",
      relations: [
        { targetKind: "Deployment", targetName: "web-app", targetNamespace: "default", type: "routes-to" },
      ],
    });
    const deployment = makeK8sResource();

    const edges = relationsToGraphEdges([service, deployment]);
    const routesTo = edges.filter((e) => e.relationshipType === "routes-to");
    expect(routesTo).toHaveLength(1);
  });
});

describe("syncResourcesToGraph", () => {
  it("upserts nodes and edges to storage", async () => {
    const storage = createMockGraphStorage();
    const ns = makeK8sResource({ kind: "Namespace", name: "default", namespace: "default" });
    const deployment = makeK8sResource();

    const result = await syncResourcesToGraph(storage, [ns, deployment], "test-cluster");

    expect(result.nodesUpserted).toBe(2);
    expect(result.edgesUpserted).toBeGreaterThanOrEqual(1); // namespace containment
    expect(storage.upsertNodes).toHaveBeenCalled();
    expect(storage.upsertEdges).toHaveBeenCalled();
  });

  it("skips upsert calls for empty resources", async () => {
    const storage = createMockGraphStorage();
    const result = await syncResourcesToGraph(storage, []);

    expect(result.nodesUpserted).toBe(0);
    expect(result.edgesUpserted).toBe(0);
    expect(storage.upsertNodes).not.toHaveBeenCalled();
  });
});

describe("diffGraphVsResources", () => {
  it("identifies new resources in K8s not yet in KG", async () => {
    const storage = createMockGraphStorage([]);
    const resources = [makeK8sResource()];

    const diff = await diffGraphVsResources(storage, resources);
    expect(diff.newInK8s).toHaveLength(1);
    expect(diff.removedFromK8s).toHaveLength(0);
    expect(diff.shared).toHaveLength(0);
  });

  it("identifies resources removed from K8s but still in KG", async () => {
    const existingNode: GraphNode = {
      id: "kubernetes:default:Pod:old-pod",
      provider: "kubernetes",
      resourceType: "compute",
      nativeId: "uid-old",
      name: "old-pod",
      region: "default",
      account: "default",
      status: "running",
      tags: {},
      metadata: { managedBy: "kubernetes" },
      costMonthly: null,
      owner: null,
      discoveredAt: new Date().toISOString(),
      createdAt: null,
      updatedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const storage = createMockGraphStorage([existingNode]);
    const resources = [makeK8sResource()]; // doesn't include old-pod

    const diff = await diffGraphVsResources(storage, resources);
    expect(diff.removedFromK8s).toHaveLength(1);
    expect(diff.removedFromK8s[0]).toBe("kubernetes:default:Pod:old-pod");
  });

  it("identifies shared resources", async () => {
    const resource = makeK8sResource();
    const expectedId = "kubernetes:default:Deployment:web-app";

    const existingNode: GraphNode = {
      id: expectedId,
      provider: "kubernetes",
      resourceType: "compute",
      nativeId: "uid-1234-abcd",
      name: "web-app",
      region: "default",
      account: "default",
      status: "running",
      tags: {},
      metadata: { managedBy: "kubernetes" },
      costMonthly: null,
      owner: null,
      discoveredAt: new Date().toISOString(),
      createdAt: null,
      updatedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const storage = createMockGraphStorage([existingNode]);
    const diff = await diffGraphVsResources(storage, [resource]);

    expect(diff.shared).toHaveLength(1);
    expect(diff.newInK8s).toHaveLength(0);
  });
});
