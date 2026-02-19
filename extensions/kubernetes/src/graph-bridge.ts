/**
 * Kubernetes → Knowledge Graph Bridge
 *
 * Converts parsed Kubernetes resources into Knowledge Graph nodes and edges,
 * enabling the KG to track K8s-managed workloads, services, and config.
 *
 * Node types: pod, service, deployment, statefulset, ingress, configmap,
 *             secret, namespace, pvc (per roadmap spec).
 * Edge types: routes-to, manages, uses (per roadmap spec).
 */

import type {
  ParsedK8sResource,
  K8sEdgeType,
  GraphNodeInput,
  GraphEdgeInput,
  GraphResourceType,
  GraphRelationshipType,
  GraphStorage,
} from "./types.js";

// ── K8s kind → KG resource type mapping ─────────────────────────────────────

const K8S_KIND_MAP: Record<string, GraphResourceType> = {
  // Compute / workloads
  Pod: "compute",
  Deployment: "compute",
  StatefulSet: "compute",
  DaemonSet: "compute",
  ReplicaSet: "compute",
  Job: "compute",
  CronJob: "compute",
  // Containers
  Container: "container",
  // Network
  Service: "load-balancer",
  Ingress: "network",
  NetworkPolicy: "security-group",
  // Storage
  PersistentVolumeClaim: "storage",
  PersistentVolume: "storage",
  // Config / secrets
  ConfigMap: "custom",
  Secret: "secret",
  // Namespace
  Namespace: "vpc",
  // Auth
  ServiceAccount: "identity",
  Role: "policy",
  ClusterRole: "policy",
  RoleBinding: "policy",
  ClusterRoleBinding: "policy",
  // Scaling
  HorizontalPodAutoscaler: "custom",
};

/** Map a K8s edge type to a KG relationship type. */
function mapEdgeType(k8sEdge: K8sEdgeType): GraphRelationshipType {
  switch (k8sEdge) {
    case "routes-to": return "routes-to";
    case "manages": return "contains";
    case "uses": return "uses";
    case "mounts": return "attached-to";
    case "selects": return "routes-to";
    case "binds-to": return "authenticated-by";
    case "exposes": return "exposes";
    default: return "custom";
  }
}

/** Map a K8s kind to a GraphResourceType. */
export function k8sKindToGraphType(kind: string): GraphResourceType {
  return K8S_KIND_MAP[kind] ?? "custom";
}

/**
 * Build a deterministic KG node ID from a K8s resource.
 * Format: `kubernetes:{namespace}:{kind}:{name}`
 */
function buildNodeId(resource: ParsedK8sResource): string {
  return `kubernetes:${resource.namespace}:${resource.kind}:${resource.name}`;
}

/** Infer status from K8s resource annotations/labels. */
function inferStatus(resource: ParsedK8sResource): "running" | "stopped" | "pending" | "unknown" {
  // Phase annotation is common on Pods
  const phase = resource.annotations["kubectl.kubernetes.io/last-applied-configuration"]
    ? "running"
    : undefined;

  // Check common status indicators
  const statusLabel = resource.labels["status"] ?? resource.labels["app.kubernetes.io/status"];
  const raw = statusLabel ?? phase;
  if (!raw) return "running"; // present in cluster → assume running

  const lower = raw.toLowerCase();
  if (lower === "running" || lower === "active" || lower === "ready") return "running";
  if (lower === "pending" || lower === "creating") return "pending";
  if (lower === "stopped" || lower === "terminated" || lower === "completed") return "stopped";
  return "unknown";
}

// ── Conversion Functions ────────────────────────────────────────────────────────

/**
 * Convert parsed K8s resources into Knowledge Graph node inputs.
 * Nodes are tagged with `managedBy: "kubernetes"` and `k8sKind` in metadata.
 */
export function resourcesToGraphNodes(resources: ParsedK8sResource[], clusterName = "default"): GraphNodeInput[] {
  return resources.map((resource) => {
    const resourceType = k8sKindToGraphType(resource.kind);
    const id = buildNodeId(resource);

    const node: GraphNodeInput = {
      id,
      provider: "kubernetes",
      resourceType,
      nativeId: resource.uid ?? `${resource.namespace}/${resource.kind}/${resource.name}`,
      name: resource.name,
      region: clusterName,
      account: resource.namespace,
      status: inferStatus(resource),
      tags: { ...resource.labels },
      metadata: {
        managedBy: "kubernetes",
        k8sKind: resource.kind,
        k8sApiVersion: resource.apiVersion,
        k8sNamespace: resource.namespace,
        k8sCluster: clusterName,
        ...pickAnnotations(resource),
      },
      costMonthly: null,
      owner: resource.annotations["app.kubernetes.io/managed-by"]
        ?? resource.labels["app.kubernetes.io/managed-by"]
        ?? null,
      createdAt: resource.creationTimestamp ?? null,
    };

    return node;
  });
}

/** Pick relevant annotations (skip large/system ones). */
function pickAnnotations(resource: ParsedK8sResource): Record<string, unknown> {
  const skip = new Set([
    "kubectl.kubernetes.io/last-applied-configuration",
    "control-plane.alpha.kubernetes.io/leader",
  ]);

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resource.annotations)) {
    if (skip.has(key)) continue;
    // Skip very long annotation values
    if (typeof value === "string" && value.length > 500) continue;
    meta[`annotation:${key}`] = value;
  }
  return meta;
}

/**
 * Convert K8s resource relations into Knowledge Graph edges.
 * Maps K8sEdgeType to GraphRelationshipType.
 */
export function relationsToGraphEdges(resources: ParsedK8sResource[]): GraphEdgeInput[] {
  const edges: GraphEdgeInput[] = [];

  // Build lookup from "namespace:kind:name" → node ID
  const nodeIdLookup = new Map<string, string>();
  for (const resource of resources) {
    const key = `${resource.namespace}:${resource.kind}:${resource.name}`;
    nodeIdLookup.set(key, buildNodeId(resource));
  }

  for (const resource of resources) {
    const sourceNodeId = buildNodeId(resource);

    for (const relation of resource.relations) {
      const targetNs = relation.targetNamespace ?? resource.namespace;
      const targetKey = `${targetNs}:${relation.targetKind}:${relation.targetName}`;
      const targetNodeId = nodeIdLookup.get(targetKey);

      // Skip relations to resources not in our parsed set (e.g. selector-based)
      if (!targetNodeId) continue;

      const relType = mapEdgeType(relation.type);

      edges.push({
        id: `edge:${sourceNodeId}->${relType}->${targetNodeId}`,
        sourceNodeId,
        targetNodeId,
        relationshipType: relType,
        confidence: 0.9, // config-derived but some relations are heuristic
        discoveredVia: "iac-parse",
        metadata: {
          k8sEdgeType: relation.type,
          k8sSourceKind: resource.kind,
          k8sTargetKind: relation.targetKind,
        },
      });
    }

    // Namespace containment edge
    if (resource.kind !== "Namespace") {
      const nsNodeId = nodeIdLookup.get(`${resource.namespace}:Namespace:${resource.namespace}`);
      if (nsNodeId) {
        edges.push({
          id: `edge:${nsNodeId}->contains->${sourceNodeId}`,
          sourceNodeId: nsNodeId,
          targetNodeId: sourceNodeId,
          relationshipType: "contains",
          confidence: 1.0,
          discoveredVia: "iac-parse",
          metadata: { k8sNamespace: resource.namespace },
        });
      }
    }
  }

  return edges;
}

/**
 * Sync parsed K8s resources into the Knowledge Graph.
 * Upserts all resources as nodes and their relationships as edges.
 */
export async function syncResourcesToGraph(
  storage: GraphStorage,
  resources: ParsedK8sResource[],
  clusterName?: string,
): Promise<{ nodesUpserted: number; edgesUpserted: number }> {
  const nodes = resourcesToGraphNodes(resources, clusterName);
  const edges = relationsToGraphEdges(resources);

  if (nodes.length > 0) await storage.upsertNodes(nodes);
  if (edges.length > 0) await storage.upsertEdges(edges);

  return { nodesUpserted: nodes.length, edgesUpserted: edges.length };
}

/**
 * Compare Knowledge Graph state with current K8s resources.
 * Returns resources new in K8s, removed from K8s, and shared.
 */
export async function diffGraphVsResources(
  storage: GraphStorage,
  resources: ParsedK8sResource[],
  clusterName?: string,
): Promise<{
  newInK8s: ParsedK8sResource[];
  removedFromK8s: string[];
  shared: string[];
}> {
  const k8sNodes = resourcesToGraphNodes(resources, clusterName);
  const k8sNodeIds = new Set(k8sNodes.map((n) => n.id));

  const kgNodes = await storage.queryNodes({});
  const k8sManagedKgNodes = kgNodes.filter(
    (n) => (n.metadata as Record<string, unknown>).managedBy === "kubernetes",
  );

  const kgNodeIds = new Set(k8sManagedKgNodes.map((n) => n.id));
  const newInK8s: ParsedK8sResource[] = [];
  const shared: string[] = [];

  for (const resource of resources) {
    const nodeId = buildNodeId(resource);
    if (kgNodeIds.has(nodeId)) {
      shared.push(nodeId);
    } else {
      newInK8s.push(resource);
    }
  }

  const removedFromK8s = k8sManagedKgNodes
    .filter((n) => !k8sNodeIds.has(n.id))
    .map((n) => n.id);

  return { newInK8s, removedFromK8s, shared };
}
