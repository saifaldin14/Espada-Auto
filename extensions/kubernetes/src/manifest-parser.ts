/**
 * Kubernetes manifest parser — parse YAML manifests into normalized K8s resources.
 * Uses simple YAML document splitting (---) since we avoid heavy dependencies.
 */

import type {
  K8sResource,
  K8sManifest,
  ParsedK8sResource,
  K8sRelation,
  K8sEdgeType,
} from "./types.js";

/**
 * Parse a multi-document YAML string into K8sResource objects.
 * Uses JSON-parsed kubectl output or simple YAML splitting.
 * For production, pass pre-parsed JSON from `kubectl get -o json`.
 */
export function parseManifestJson(json: string): K8sManifest {
  const parsed = JSON.parse(json);

  // kubectl returns a List wrapper for multiple resources
  if (parsed.kind === "List" && Array.isArray(parsed.items)) {
    return { resources: parsed.items as K8sResource[] };
  }

  // Single resource
  return { resources: [parsed as K8sResource] };
}

/**
 * Normalize a K8sResource into a ParsedK8sResource with resolved relationships.
 */
export function normalizeResource(resource: K8sResource): ParsedK8sResource {
  const relations = resolveRelations(resource);

  return {
    kind: resource.kind,
    name: resource.metadata.name,
    namespace: resource.metadata.namespace ?? "default",
    apiVersion: resource.apiVersion,
    labels: resource.metadata.labels ?? {},
    annotations: resource.metadata.annotations ?? {},
    uid: resource.metadata.uid,
    creationTimestamp: resource.metadata.creationTimestamp,
    spec: resource.spec ?? {},
    relations,
  };
}

/**
 * Parse a full manifest (multiple resources) into normalized resources.
 */
export function parseResources(resources: K8sResource[]): ParsedK8sResource[] {
  return resources.map(normalizeResource);
}

/**
 * Resolve relationships for a single resource based on its kind and spec.
 */
function resolveRelations(resource: K8sResource): K8sRelation[] {
  const relations: K8sRelation[] = [];
  const spec = resource.spec as Record<string, unknown> | undefined;
  if (!spec) return relations;

  switch (resource.kind) {
    case "Service":
      // Service → selects Pods via selector, routes-to Deployment/StatefulSet
      addServiceRelations(resource, spec, relations);
      break;

    case "Deployment":
    case "StatefulSet":
    case "DaemonSet":
    case "ReplicaSet":
      // Workloads → manage Pods
      addWorkloadRelations(resource, spec, relations);
      break;

    case "Ingress":
      // Ingress → routes-to Services
      addIngressRelations(spec, relations);
      break;

    case "Pod":
      // Pod → mounts PVCs, uses ConfigMaps/Secrets
      addPodRelations(resource, spec, relations);
      break;

    case "RoleBinding":
    case "ClusterRoleBinding":
      addBindingRelations(spec, relations);
      break;
  }

  // Owner references
  if (resource.metadata.ownerReferences) {
    for (const ref of resource.metadata.ownerReferences) {
      relations.push({
        targetKind: ref.kind,
        targetName: ref.name,
        targetNamespace: resource.metadata.namespace,
        type: "manages",
      });
    }
  }

  return relations;
}

function addServiceRelations(
  resource: K8sResource,
  spec: Record<string, unknown>,
  relations: K8sRelation[],
): void {
  const selector = spec.selector as Record<string, string> | undefined;
  if (selector && typeof selector === "object") {
    // The service routes to workloads matching the selector
    // We can't resolve exact targets without cluster state, but record the intent
    relations.push({
      targetKind: "Pod",
      targetName: `selector:${JSON.stringify(selector)}`,
      targetNamespace: resource.metadata.namespace,
      type: "selects",
    });
  }
}

function addWorkloadRelations(
  resource: K8sResource,
  spec: Record<string, unknown>,
  relations: K8sRelation[],
): void {
  // Workloads manage pods
  relations.push({
    targetKind: "Pod",
    targetName: resource.metadata.name,
    targetNamespace: resource.metadata.namespace,
    type: "manages",
  });

  // Check for volume mounts
  const template = spec.template as Record<string, unknown> | undefined;
  if (template?.spec) {
    addVolumeRelations(template.spec as Record<string, unknown>, resource.metadata.namespace, relations);
  }
}

function addIngressRelations(
  spec: Record<string, unknown>,
  relations: K8sRelation[],
): void {
  const rules = spec.rules as Array<{ http?: { paths?: Array<{ backend?: { service?: { name?: string } } }> } }> | undefined;
  if (!rules) return;

  for (const rule of rules) {
    const paths = rule.http?.paths ?? [];
    for (const path of paths) {
      const svcName = path.backend?.service?.name;
      if (svcName) {
        relations.push({
          targetKind: "Service",
          targetName: svcName,
          type: "routes-to",
        });
      }
    }
  }
}

function addPodRelations(
  resource: K8sResource,
  spec: Record<string, unknown>,
  relations: K8sRelation[],
): void {
  addVolumeRelations(spec, resource.metadata.namespace, relations);
}

function addVolumeRelations(
  podSpec: Record<string, unknown>,
  namespace: string | undefined,
  relations: K8sRelation[],
): void {
  const volumes = podSpec.volumes as Array<Record<string, unknown>> | undefined;
  if (!volumes) return;

  for (const vol of volumes) {
    if (vol.persistentVolumeClaim) {
      const pvc = vol.persistentVolumeClaim as { claimName?: string };
      if (pvc.claimName) {
        relations.push({
          targetKind: "PersistentVolumeClaim",
          targetName: pvc.claimName,
          targetNamespace: namespace,
          type: "mounts",
        });
      }
    }
    if (vol.configMap) {
      const cm = vol.configMap as { name?: string };
      if (cm.name) {
        relations.push({
          targetKind: "ConfigMap",
          targetName: cm.name,
          targetNamespace: namespace,
          type: "uses",
        });
      }
    }
    if (vol.secret) {
      const sec = vol.secret as { secretName?: string };
      if (sec.secretName) {
        relations.push({
          targetKind: "Secret",
          targetName: sec.secretName,
          targetNamespace: namespace,
          type: "uses",
        });
      }
    }
  }
}

function addBindingRelations(
  spec: Record<string, unknown>,
  relations: K8sRelation[],
): void {
  const roleRef = spec.roleRef as { kind?: string; name?: string } | undefined;
  if (roleRef?.name) {
    relations.push({
      targetKind: roleRef.kind ?? "Role",
      targetName: roleRef.name,
      type: "binds-to",
    });
  }
}

/* ---------- Graph building utilities ---------- */

/**
 * Build a dependency/relationship graph from parsed K8s resources.
 * Returns Map<"kind/namespace/name", relations[]>.
 */
export function buildResourceGraph(
  resources: ParsedK8sResource[],
): Map<string, K8sRelation[]> {
  const graph = new Map<string, K8sRelation[]>();
  for (const r of resources) {
    const key = resourceKey(r);
    graph.set(key, r.relations);
  }
  return graph;
}

/** Compute a stable key for a parsed resource. */
export function resourceKey(r: ParsedK8sResource): string {
  return `${r.kind}/${r.namespace}/${r.name}`;
}

/**
 * Get unique resource kinds from parsed resources.
 */
export function getResourceKinds(resources: ParsedK8sResource[]): string[] {
  return [...new Set(resources.map((r) => r.kind))];
}

/**
 * Get namespace distribution from parsed resources.
 */
export function getNamespaceDistribution(
  resources: ParsedK8sResource[],
): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const r of resources) {
    dist[r.namespace] = (dist[r.namespace] ?? 0) + 1;
  }
  return dist;
}

/**
 * Group resources by edge type for graph visualization.
 */
export function getEdgesByType(
  resources: ParsedK8sResource[],
): Record<K8sEdgeType, Array<{ source: string; target: string }>> {
  const edges: Record<string, Array<{ source: string; target: string }>> = {};

  for (const r of resources) {
    const sourceKey = resourceKey(r);
    for (const rel of r.relations) {
      const edgeType = rel.type;
      if (!edges[edgeType]) edges[edgeType] = [];
      edges[edgeType].push({
        source: sourceKey,
        target: `${rel.targetKind}/${rel.targetNamespace ?? r.namespace}/${rel.targetName}`,
      });
    }
  }

  return edges as Record<K8sEdgeType, Array<{ source: string; target: string }>>;
}
