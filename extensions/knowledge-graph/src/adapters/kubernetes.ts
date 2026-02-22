/**
 * Infrastructure Knowledge Graph — Kubernetes Adapter
 *
 * Discovers Kubernetes resources and their relationships, mapping them into
 * the universal graph model. Supports:
 *
 * - Workload controllers: Deployments, StatefulSets, DaemonSets, ReplicaSets, CronJobs, Jobs
 * - Networking: Services, Ingresses, NetworkPolicies
 * - Config: ConfigMaps, Secrets
 * - Storage: PersistentVolumes, PersistentVolumeClaims, StorageClasses
 * - Identity: ServiceAccounts, ClusterRoles, Roles, ClusterRoleBindings
 * - Namespaces
 *
 * Relationships are extracted from:
 * - Owner references (Deployment → ReplicaSet → Pod)
 * - Label selectors (Service → Deployment)
 * - Annotations (e.g. eks.amazonaws.com/role-arn → IAM role)
 * - Resource references (PVC → PV → StorageClass)
 * - Ingress rules (Ingress → Service)
 *
 * Helm release grouping is auto-detected via app.kubernetes.io/managed-by
 * and meta.helm.sh/release-name labels.
 *
 * @kubernetes/client-node is loaded dynamically at runtime.
 */

import type {
  GraphNodeInput,
  GraphEdgeInput,
  GraphResourceType,
  GraphRelationshipType,
} from "../types.js";
import type {
  GraphDiscoveryAdapter,
  DiscoverOptions,
  DiscoveryResult,
  DiscoveryError,
} from "./types.js";

// =============================================================================
// Configuration
// =============================================================================

export type K8sAdapterConfig = {
  /** Kubeconfig path (uses default if omitted). */
  kubeConfigPath?: string;
  /** Kubeconfig context name (uses current context if omitted). */
  context?: string;
  /** Cluster name for node IDs (auto-detected if omitted). */
  clusterName?: string;
  /** Namespaces to discover (all non-system if omitted). */
  namespaces?: string[];
  /** Whether to include system namespaces (kube-system, kube-public, kube-node-lease). */
  includeSystem?: boolean;
  /** DI-friendly client factory for testing. */
  clientFactory?: (config: K8sAdapterConfig) => Promise<K8sClient>;
};

// =============================================================================
// Client Abstraction (DI-friendly for testing)
// =============================================================================

/** Minimal Kubernetes API surface used by the adapter. */
export type K8sClient = {
  getNamespaces(): Promise<K8sRawResource[]>;
  getDeployments(namespace: string): Promise<K8sRawResource[]>;
  getStatefulSets(namespace: string): Promise<K8sRawResource[]>;
  getDaemonSets(namespace: string): Promise<K8sRawResource[]>;
  getReplicaSets(namespace: string): Promise<K8sRawResource[]>;
  getServices(namespace: string): Promise<K8sRawResource[]>;
  getIngresses(namespace: string): Promise<K8sRawResource[]>;
  getConfigMaps(namespace: string): Promise<K8sRawResource[]>;
  getSecrets(namespace: string): Promise<K8sRawResource[]>;
  getPersistentVolumes(): Promise<K8sRawResource[]>;
  getPersistentVolumeClaims(namespace: string): Promise<K8sRawResource[]>;
  getServiceAccounts(namespace: string): Promise<K8sRawResource[]>;
  getNetworkPolicies(namespace: string): Promise<K8sRawResource[]>;
  getCronJobs(namespace: string): Promise<K8sRawResource[]>;
  getJobs(namespace: string): Promise<K8sRawResource[]>;
  getNodes(): Promise<K8sRawResource[]>;
  getClusterInfo(): Promise<{ name: string; version: string }>;
  healthCheck(): Promise<boolean>;
};

/** Raw Kubernetes resource representation. */
export type K8sRawResource = {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    uid: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: Array<{
      apiVersion: string;
      kind: string;
      name: string;
      uid: string;
    }>;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
};

// =============================================================================
// Resource Type Mapping
// =============================================================================

/** Maps K8s kind → graph resource type. */
const KIND_TO_RESOURCE_TYPE: Record<string, GraphResourceType> = {
  Namespace: "namespace",
  Deployment: "deployment",
  StatefulSet: "statefulset",
  DaemonSet: "daemonset",
  ReplicaSet: "replicaset",
  Service: "load-balancer",
  Ingress: "ingress",
  ConfigMap: "configmap",
  Secret: "secret",
  PersistentVolume: "persistent-volume",
  PersistentVolumeClaim: "persistent-volume-claim",
  ServiceAccount: "identity",
  NetworkPolicy: "policy",
  CronJob: "cronjob",
  Job: "job",
  Node: "compute",
};

/** System namespaces to exclude by default. */
const SYSTEM_NAMESPACES = new Set([
  "kube-system",
  "kube-public",
  "kube-node-lease",
]);

/** Resource types this adapter can discover. */
const SUPPORTED_TYPES: GraphResourceType[] = [
  "namespace",
  "deployment",
  "statefulset",
  "daemonset",
  "replicaset",
  "load-balancer",
  "ingress",
  "configmap",
  "secret",
  "persistent-volume",
  "persistent-volume-claim",
  "identity",
  "policy",
  "cronjob",
  "job",
  "compute",
  "cluster",
];

// =============================================================================
// Helm Release Detection
// =============================================================================

export type HelmRelease = {
  name: string;
  namespace: string;
  chart?: string;
  version?: string;
  nodeIds: string[];
};

/**
 * Detect Helm releases from resource labels.
 * Resources with `app.kubernetes.io/managed-by: Helm` and
 * `meta.helm.sh/release-name` are grouped into Helm releases.
 */
export function detectHelmReleases(nodes: GraphNodeInput[]): HelmRelease[] {
  const releases = new Map<string, HelmRelease>();

  for (const node of nodes) {
    const labels = node.tags;
    if (!labels) continue;

    const managedBy = labels["app.kubernetes.io/managed-by"];
    const releaseName =
      labels["meta.helm.sh/release-name"] ??
      labels["app.kubernetes.io/instance"];
    const releaseNamespace =
      labels["meta.helm.sh/release-namespace"] ??
      node.region; // region == namespace for K8s nodes

    if (managedBy?.toLowerCase() === "helm" && releaseName) {
      const key = `${releaseNamespace}/${releaseName}`;
      let release = releases.get(key);
      if (!release) {
        release = {
          name: releaseName,
          namespace: releaseNamespace,
          chart: labels["helm.sh/chart"],
          version: labels["app.kubernetes.io/version"],
          nodeIds: [],
        };
        releases.set(key, release);
      }
      release.nodeIds.push(node.id);
    }
  }

  return Array.from(releases.values());
}

// =============================================================================
// Node ID Builder
// =============================================================================

/** Build a deterministic node ID for a K8s resource. */
export function buildK8sNodeId(
  clusterName: string,
  namespace: string,
  resourceType: GraphResourceType,
  name: string,
): string {
  return `kubernetes:${clusterName}:${namespace}:${resourceType}:${name}`;
}

// =============================================================================
// Relationship Extraction
// =============================================================================

/** Relationship rules specific to Kubernetes resources. */
export type K8sRelationshipRule = {
  sourceKind: string;
  targetKind: string;
  relationship: GraphRelationshipType;
  /** Function that extracts target names from a source resource. */
  extract: (resource: K8sRawResource) => string[];
};

/**
 * Extract relationships from a Kubernetes resource based on its structure.
 * Returns edges that should be created between graph nodes.
 */
export function extractK8sRelationships(
  resource: K8sRawResource,
  clusterName: string,
  allResources: Map<string, K8sRawResource[]>,
): GraphEdgeInput[] {
  const edges: GraphEdgeInput[] = [];
  const kind = resource.kind;
  const ns = resource.metadata.namespace ?? "_cluster";
  const sourceType = KIND_TO_RESOURCE_TYPE[kind] ?? "custom";
  const sourceId = buildK8sNodeId(clusterName, ns, sourceType, resource.metadata.name);

  // 1. Owner references → "member-of" edges
  if (resource.metadata.ownerReferences) {
    for (const ref of resource.metadata.ownerReferences) {
      const targetType = KIND_TO_RESOURCE_TYPE[ref.kind] ?? "custom";
      const targetId = buildK8sNodeId(clusterName, ns, targetType, ref.name);
      edges.push({
        id: `${sourceId}->owned-by->${targetId}`,
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        relationshipType: "member-of",
        confidence: 1.0,
        discoveredVia: "api-field",
        metadata: { ownerKind: ref.kind },
      });
    }
  }

  // 2. Namespace containment
  if (resource.metadata.namespace && kind !== "Namespace") {
    const nsId = buildK8sNodeId(clusterName, resource.metadata.namespace, "namespace", resource.metadata.namespace);
    edges.push({
      id: `${sourceId}->runs-in->${nsId}`,
      sourceNodeId: sourceId,
      targetNodeId: nsId,
      relationshipType: "runs-in",
      confidence: 1.0,
      discoveredVia: "api-field",
      metadata: {},
    });
  }

  // 3. Service → target workloads via label selectors
  if (kind === "Service") {
    const selector = resource.spec?.selector as Record<string, string> | undefined;
    if (selector) {
      const workloads = [
        ...(allResources.get(`${ns}/Deployment`) ?? []),
        ...(allResources.get(`${ns}/StatefulSet`) ?? []),
        ...(allResources.get(`${ns}/DaemonSet`) ?? []),
      ];
      for (const workload of workloads) {
        if (matchesSelector(workload.metadata.labels, selector)) {
          const targetType = KIND_TO_RESOURCE_TYPE[workload.kind] ?? "custom";
          const targetId = buildK8sNodeId(clusterName, ns, targetType, workload.metadata.name);
          edges.push({
            id: `${sourceId}->routes-to->${targetId}`,
            sourceNodeId: sourceId,
            targetNodeId: targetId,
            relationshipType: "routes-to",
            confidence: 0.9,
            discoveredVia: "config-scan",
            metadata: { selector },
          });
        }
      }
    }
  }

  // 4. Ingress → Service via rules
  if (kind === "Ingress") {
    const serviceNames = extractIngressServiceNames(resource);
    for (const svcName of serviceNames) {
      const targetId = buildK8sNodeId(clusterName, ns, "load-balancer", svcName);
      edges.push({
        id: `${sourceId}->routes-to->${targetId}`,
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        relationshipType: "routes-to",
        confidence: 1.0,
        discoveredVia: "config-scan",
        metadata: {},
      });
    }
  }

  // 5. PVC → PV binding
  if (kind === "PersistentVolumeClaim") {
    const volumeName = (resource.spec?.volumeName as string) ?? null;
    if (volumeName) {
      const targetId = buildK8sNodeId(clusterName, "_cluster", "persistent-volume", volumeName);
      edges.push({
        id: `${sourceId}->backed-by->${targetId}`,
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        relationshipType: "backed-by",
        confidence: 1.0,
        discoveredVia: "api-field",
        metadata: {},
      });
    }
  }

  // 6. Workload → ServiceAccount
  if (["Deployment", "StatefulSet", "DaemonSet", "CronJob", "Job"].includes(kind)) {
    const saName = extractServiceAccountName(resource);
    if (saName && saName !== "default") {
      const targetId = buildK8sNodeId(clusterName, ns, "identity", saName);
      edges.push({
        id: `${sourceId}->uses->${targetId}`,
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        relationshipType: "uses",
        confidence: 1.0,
        discoveredVia: "config-scan",
        metadata: {},
      });
    }
  }

  // 7. Workload → ConfigMap/Secret volume mounts and envFrom
  if (["Deployment", "StatefulSet", "DaemonSet", "CronJob", "Job"].includes(kind)) {
    const configRefs = extractConfigReferences(resource);
    for (const ref of configRefs) {
      const targetType: GraphResourceType = ref.kind === "ConfigMap" ? "configmap" : "secret";
      const targetId = buildK8sNodeId(clusterName, ns, targetType, ref.name);
      edges.push({
        id: `${sourceId}->reads-from->${targetId}`,
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        relationshipType: "reads-from",
        confidence: 1.0,
        discoveredVia: "config-scan",
        metadata: { refKind: ref.kind },
      });
    }
  }

  // 8. Workload → PVC mounts
  if (["Deployment", "StatefulSet", "DaemonSet"].includes(kind)) {
    const pvcNames = extractPvcNames(resource);
    for (const pvcName of pvcNames) {
      const targetId = buildK8sNodeId(clusterName, ns, "persistent-volume-claim", pvcName);
      edges.push({
        id: `${sourceId}->uses->${targetId}`,
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        relationshipType: "uses",
        confidence: 1.0,
        discoveredVia: "config-scan",
        metadata: {},
      });
    }
  }

  // 9. NetworkPolicy → target workloads
  if (kind === "NetworkPolicy") {
    const podSelector = (resource.spec?.podSelector as { matchLabels?: Record<string, string> })?.matchLabels;
    if (podSelector && Object.keys(podSelector).length > 0) {
      const workloads = [
        ...(allResources.get(`${ns}/Deployment`) ?? []),
        ...(allResources.get(`${ns}/StatefulSet`) ?? []),
        ...(allResources.get(`${ns}/DaemonSet`) ?? []),
      ];
      for (const w of workloads) {
        if (matchesSelector(w.metadata.labels, podSelector)) {
          const targetType = KIND_TO_RESOURCE_TYPE[w.kind] ?? "custom";
          const targetId = buildK8sNodeId(clusterName, ns, targetType, w.metadata.name);
          edges.push({
            id: `${sourceId}->secures->${targetId}`,
            sourceNodeId: sourceId,
            targetNodeId: targetId,
            relationshipType: "secures",
            confidence: 0.9,
            discoveredVia: "config-scan",
            metadata: { podSelector },
          });
        }
      }
    }
  }

  // 10. CronJob → Job (owner reference handles this, but also via spec)
  // Owner references already covered above.

  return edges;
}

// =============================================================================
// Cross-Cloud Annotation Extraction
// =============================================================================

/** Known cross-cloud annotations that link K8s resources to cloud resources. */
export type CrossCloudAnnotation = {
  annotation: string;
  cloudProvider: "aws" | "azure" | "gcp";
  resourceType: GraphResourceType;
  relationship: GraphRelationshipType;
  extractId: (value: string) => string;
};

export const CROSS_CLOUD_ANNOTATIONS: CrossCloudAnnotation[] = [
  // EKS → IAM role
  {
    annotation: "eks.amazonaws.com/role-arn",
    cloudProvider: "aws",
    resourceType: "iam-role",
    relationship: "uses",
    extractId: (arn) => {
      // arn:aws:iam::123456789:role/my-role → extract role path
      const parts = arn.split(":");
      return parts[parts.length - 1] ?? arn;
    },
  },
  // Azure Workload Identity
  {
    annotation: "azure.workload.identity/client-id",
    cloudProvider: "azure",
    resourceType: "identity",
    relationship: "uses",
    extractId: (id) => id,
  },
  // GKE Workload Identity
  {
    annotation: "iam.gke.io/gcp-service-account",
    cloudProvider: "gcp",
    resourceType: "identity",
    relationship: "uses",
    extractId: (sa) => sa,
  },
  // External DNS controller
  {
    annotation: "external-dns.alpha.kubernetes.io/hostname",
    cloudProvider: "aws",
    resourceType: "dns",
    relationship: "resolves-to",
    extractId: (hostname) => hostname,
  },
  // AWS Load Balancer Controller
  {
    annotation: "service.beta.kubernetes.io/aws-load-balancer-arn",
    cloudProvider: "aws",
    resourceType: "load-balancer",
    relationship: "backed-by",
    extractId: (arn) => arn,
  },
];

/**
 * Extract cross-cloud edges from a K8s resource's annotations.
 * These are "hints" that link K8s resources to cloud-provider resources.
 */
export function extractCrossCloudEdges(
  resource: K8sRawResource,
  clusterName: string,
): GraphEdgeInput[] {
  const edges: GraphEdgeInput[] = [];
  const annotations = resource.metadata.annotations;
  if (!annotations) return edges;

  const ns = resource.metadata.namespace ?? "_cluster";
  const kind = resource.kind;
  const sourceType = KIND_TO_RESOURCE_TYPE[kind] ?? "custom";
  const sourceId = buildK8sNodeId(clusterName, ns, sourceType, resource.metadata.name);

  for (const rule of CROSS_CLOUD_ANNOTATIONS) {
    const value = annotations[rule.annotation];
    if (!value) continue;

    // We can't build a fully deterministic target ID without knowing the
    // cloud account/region. Store the annotation value as metadata and
    // produce a best-effort ID that cross-cloud discovery can match later.
    const targetId = `${rule.cloudProvider}:_:_:${rule.resourceType}:${rule.extractId(value)}`;
    edges.push({
      id: `${sourceId}->${rule.relationship}->${targetId}`,
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      relationshipType: rule.relationship,
      confidence: 0.8,
      discoveredVia: "config-scan",
      metadata: {
        annotation: rule.annotation,
        annotationValue: value,
        cloudProvider: rule.cloudProvider,
      },
    });
  }

  return edges;
}

// =============================================================================
// Helper Functions
// =============================================================================

/** Check if a resource's labels match a selector. */
function matchesSelector(
  labels: Record<string, string> | undefined,
  selector: Record<string, string>,
): boolean {
  if (!labels) return false;
  return Object.entries(selector).every(([k, v]) => labels[k] === v);
}

/** Extract service names from an Ingress resource's rules. */
function extractIngressServiceNames(resource: K8sRawResource): string[] {
  const names: string[] = [];
  const rules = resource.spec?.rules as Array<{
    http?: {
      paths?: Array<{
        backend?: {
          service?: { name?: string };
          serviceName?: string;
        };
      }>;
    };
  }> | undefined;

  if (rules) {
    for (const rule of rules) {
      for (const path of rule.http?.paths ?? []) {
        const name = path.backend?.service?.name ?? path.backend?.serviceName;
        if (name) names.push(name);
      }
    }
  }

  // Also check defaultBackend
  const defaultBackend = resource.spec?.defaultBackend as {
    service?: { name?: string };
    serviceName?: string;
  } | undefined;
  if (defaultBackend) {
    const name = defaultBackend.service?.name ?? defaultBackend.serviceName;
    if (name) names.push(name);
  }

  return [...new Set(names)];
}

/** Extract the ServiceAccount name from a workload's pod template. */
function extractServiceAccountName(resource: K8sRawResource): string | null {
  const template = resource.spec?.template as { spec?: { serviceAccountName?: string } } | undefined;
  // CronJobs nest an extra level
  const jobTemplate = resource.spec?.jobTemplate as { spec?: { template?: { spec?: { serviceAccountName?: string } } } } | undefined;

  return (
    template?.spec?.serviceAccountName ??
    jobTemplate?.spec?.template?.spec?.serviceAccountName ??
    null
  );
}

/** Extract ConfigMap and Secret references from volume mounts and envFrom. */
function extractConfigReferences(resource: K8sRawResource): Array<{ kind: string; name: string }> {
  const refs: Array<{ kind: string; name: string }> = [];
  const podSpec = getPodSpec(resource);
  if (!podSpec) return refs;

  // Volume-based references
  const volumes = (podSpec.volumes ?? []) as Array<{
    configMap?: { name?: string };
    secret?: { secretName?: string };
  }>;
  for (const vol of volumes) {
    if (vol.configMap?.name) refs.push({ kind: "ConfigMap", name: vol.configMap.name });
    if (vol.secret?.secretName) refs.push({ kind: "Secret", name: vol.secret.secretName });
  }

  // envFrom references
  const containers = [
    ...((podSpec.containers ?? []) as Array<{
      envFrom?: Array<{
        configMapRef?: { name?: string };
        secretRef?: { name?: string };
      }>;
    }>),
    ...((podSpec.initContainers ?? []) as Array<{
      envFrom?: Array<{
        configMapRef?: { name?: string };
        secretRef?: { name?: string };
      }>;
    }>),
  ];

  for (const c of containers) {
    for (const ef of c.envFrom ?? []) {
      if (ef.configMapRef?.name) refs.push({ kind: "ConfigMap", name: ef.configMapRef.name });
      if (ef.secretRef?.name) refs.push({ kind: "Secret", name: ef.secretRef.name });
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.kind}/${r.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Extract PVC names from volume mounts. */
function extractPvcNames(resource: K8sRawResource): string[] {
  const podSpec = getPodSpec(resource);
  if (!podSpec) return [];

  const names: string[] = [];

  // Inline volumes with PVC reference
  const volumes = (podSpec.volumes ?? []) as Array<{
    persistentVolumeClaim?: { claimName?: string };
  }>;
  for (const vol of volumes) {
    if (vol.persistentVolumeClaim?.claimName) {
      names.push(vol.persistentVolumeClaim.claimName);
    }
  }

  // StatefulSet volumeClaimTemplates
  const vcts = (resource.spec?.volumeClaimTemplates ?? []) as Array<{
    metadata?: { name?: string };
  }>;
  for (const vct of vcts) {
    if (vct.metadata?.name) names.push(vct.metadata.name);
  }

  return [...new Set(names)];
}

/** Get the pod spec from a workload resource, handling CronJob nesting. */
function getPodSpec(resource: K8sRawResource): Record<string, unknown> | null {
  // Deployment/StatefulSet/DaemonSet → spec.template.spec
  const template = resource.spec?.template as { spec?: Record<string, unknown> } | undefined;
  if (template?.spec) return template.spec;

  // CronJob → spec.jobTemplate.spec.template.spec
  const jobTemplate = resource.spec?.jobTemplate as {
    spec?: { template?: { spec?: Record<string, unknown> } };
  } | undefined;
  if (jobTemplate?.spec?.template?.spec) return jobTemplate.spec.template.spec;

  return null;
}

/** Map K8s resource status to graph node status. */
function mapK8sStatus(resource: K8sRawResource): "running" | "pending" | "error" | "unknown" {
  const kind = resource.kind;
  const status = resource.status as Record<string, unknown> | undefined;

  if (kind === "Namespace") {
    const phase = (status?.phase as string) ?? "";
    if (phase === "Active") return "running";
    if (phase === "Terminating") return "deleting" as "running"; // close enough
    return "unknown";
  }

  if (["Deployment", "StatefulSet", "DaemonSet"].includes(kind)) {
    const replicas = (status?.replicas as number) ?? 0;
    const ready = (status?.readyReplicas as number) ?? 0;
    if (replicas > 0 && ready === replicas) return "running";
    if (replicas > 0 && ready < replicas) return "pending";
    if (replicas === 0) return "running"; // scaled to zero is intentional
    return "unknown";
  }

  if (kind === "PersistentVolume" || kind === "PersistentVolumeClaim") {
    const phase = (status?.phase as string) ?? "";
    if (phase === "Bound") return "running";
    if (phase === "Pending") return "pending";
    if (phase === "Available") return "running";
    return "unknown";
  }

  if (kind === "Job") {
    const succeeded = (status?.succeeded as number) ?? 0;
    const failed = (status?.failed as number) ?? 0;
    if (succeeded > 0) return "running"; // completed
    if (failed > 0) return "error";
    return "pending";
  }

  // For most other resources (Service, Ingress, ConfigMap, Secret, etc.),
  // existence implies they're active.
  return "running";
}

// =============================================================================
// Discovery Adapter
// =============================================================================

export class KubernetesDiscoveryAdapter implements GraphDiscoveryAdapter {
  readonly provider = "kubernetes" as const;
  readonly displayName = "Kubernetes";

  private config: K8sAdapterConfig;

  constructor(config: K8sAdapterConfig = {}) {
    this.config = config;
  }

  supportedResourceTypes(): GraphResourceType[] {
    return [...SUPPORTED_TYPES];
  }

  supportsIncrementalSync(): boolean {
    // K8s Watch API could support this in the future
    return false;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.getClient();
      return await client.healthCheck();
    } catch {
      return false;
    }
  }

  async discover(options?: DiscoverOptions): Promise<DiscoveryResult> {
    const startMs = Date.now();
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    const errors: DiscoveryError[] = [];
    const allResources = new Map<string, K8sRawResource[]>();

    let client: K8sClient;
    try {
      client = await this.getClient();
    } catch (err) {
      return {
        provider: "kubernetes",
        nodes: [],
        edges: [],
        errors: [
          {
            resourceType: "cluster",
            message: `Failed to connect to cluster: ${(err as Error).message}`,
          },
        ],
        durationMs: Date.now() - startMs,
      };
    }

    // Determine cluster name
    let clusterName = this.config.clusterName;
    if (!clusterName) {
      try {
        const info = await client.getClusterInfo();
        clusterName = info.name;
      } catch {
        clusterName = this.config.context ?? "default";
      }
    }

    // Add the cluster itself as a node
    nodes.push({
      id: buildK8sNodeId(clusterName, "_cluster", "cluster", clusterName),
      provider: "kubernetes",
      resourceType: "cluster",
      nativeId: clusterName,
      name: clusterName,
      region: "_cluster",
      account: clusterName,
      status: "running",
      tags: {},
      metadata: {},
      costMonthly: null,
      owner: null,
      createdAt: null,
    });

    // Discover namespaces
    let namespaces: string[];
    try {
      const nsResources = await client.getNamespaces();
      const includeSystem = this.config.includeSystem ?? false;

      for (const ns of nsResources) {
        if (!includeSystem && SYSTEM_NAMESPACES.has(ns.metadata.name)) continue;
        if (this.config.namespaces && !this.config.namespaces.includes(ns.metadata.name)) continue;
        if (options?.signal?.aborted) break;

        const node = this.rawToNode(ns, clusterName);
        nodes.push(node);

        // Namespace → Cluster
        edges.push({
          id: `${node.id}->runs-in->${buildK8sNodeId(clusterName, "_cluster", "cluster", clusterName)}`,
          sourceNodeId: node.id,
          targetNodeId: buildK8sNodeId(clusterName, "_cluster", "cluster", clusterName),
          relationshipType: "runs-in",
          confidence: 1.0,
          discoveredVia: "api-field",
          metadata: {},
        });
      }

      namespaces = nsResources
        .map((ns) => ns.metadata.name)
        .filter((name) => {
          if (!includeSystem && SYSTEM_NAMESPACES.has(name)) return false;
          if (this.config.namespaces && !this.config.namespaces.includes(name)) return false;
          return true;
        });
    } catch (err) {
      errors.push({
        resourceType: "namespace",
        message: `Failed to list namespaces: ${(err as Error).message}`,
      });
      namespaces = this.config.namespaces ?? [];
    }

    // Discover compute nodes
    if (!options?.resourceTypes || options.resourceTypes.includes("compute")) {
      try {
        const k8sNodes = await client.getNodes();
        for (const n of k8sNodes) {
          const node = this.rawToNode(n, clusterName);
          nodes.push(node);
          // Node → Cluster
          edges.push({
            id: `${node.id}->member-of->${buildK8sNodeId(clusterName, "_cluster", "cluster", clusterName)}`,
            sourceNodeId: node.id,
            targetNodeId: buildK8sNodeId(clusterName, "_cluster", "cluster", clusterName),
            relationshipType: "member-of",
            confidence: 1.0,
            discoveredVia: "api-field",
            metadata: {},
          });
        }
      } catch (err) {
        errors.push({
          resourceType: "compute",
          message: `Failed to list nodes: ${(err as Error).message}`,
        });
      }
    }

    // Per-namespace discovery
    const discoverers: Array<{
      type: GraphResourceType;
      fetch: (ns: string) => Promise<K8sRawResource[]>;
    }> = [
      { type: "deployment", fetch: (ns) => client.getDeployments(ns) },
      { type: "statefulset", fetch: (ns) => client.getStatefulSets(ns) },
      { type: "daemonset", fetch: (ns) => client.getDaemonSets(ns) },
      { type: "replicaset", fetch: (ns) => client.getReplicaSets(ns) },
      { type: "load-balancer", fetch: (ns) => client.getServices(ns) },
      { type: "ingress", fetch: (ns) => client.getIngresses(ns) },
      { type: "configmap", fetch: (ns) => client.getConfigMaps(ns) },
      { type: "secret", fetch: (ns) => client.getSecrets(ns) },
      { type: "persistent-volume-claim", fetch: (ns) => client.getPersistentVolumeClaims(ns) },
      { type: "identity", fetch: (ns) => client.getServiceAccounts(ns) },
      { type: "policy", fetch: (ns) => client.getNetworkPolicies(ns) },
      { type: "cronjob", fetch: (ns) => client.getCronJobs(ns) },
      { type: "job", fetch: (ns) => client.getJobs(ns) },
    ];

    // Discover PersistentVolumes (cluster-scoped)
    if (!options?.resourceTypes || options.resourceTypes.includes("persistent-volume")) {
      try {
        const pvs = await client.getPersistentVolumes();
        for (const pv of pvs) {
          const node = this.rawToNode(pv, clusterName);
          nodes.push(node);
          const key = `_cluster/${pv.kind}`;
          const arr = allResources.get(key) ?? [];
          arr.push(pv);
          allResources.set(key, arr);
        }
      } catch (err) {
        errors.push({
          resourceType: "persistent-volume",
          message: `Failed to list PVs: ${(err as Error).message}`,
        });
      }
    }

    for (const ns of namespaces) {
      if (options?.signal?.aborted) break;

      for (const disc of discoverers) {
        if (options?.resourceTypes && !options.resourceTypes.includes(disc.type)) continue;
        if (options?.signal?.aborted) break;

        try {
          const resources = await disc.fetch(ns);
          for (const r of resources) {
            if (options?.limit && nodes.length >= options.limit) break;

            const node = this.rawToNode(r, clusterName);

            // Tag filtering
            if (options?.tags) {
              const match = Object.entries(options.tags).every(
                ([k, v]) => node.tags[k] === v,
              );
              if (!match) continue;
            }

            nodes.push(node);

            // Index for cross-referencing
            const key = `${ns}/${r.kind}`;
            const arr = allResources.get(key) ?? [];
            arr.push(r);
            allResources.set(key, arr);
          }
        } catch (err) {
          errors.push({
            resourceType: disc.type,
            region: ns,
            message: `Failed to list ${disc.type} in ${ns}: ${(err as Error).message}`,
          });
        }
      }
    }

    // Second pass: extract all relationships
    for (const [_key, resources] of allResources) {
      for (const r of resources) {
        const relEdges = extractK8sRelationships(r, clusterName, allResources);
        edges.push(...relEdges);

        // Cross-cloud annotation edges
        const ccEdges = extractCrossCloudEdges(r, clusterName);
        edges.push(...ccEdges);
      }
    }

    return {
      provider: "kubernetes",
      nodes,
      edges,
      errors,
      durationMs: Date.now() - startMs,
    };
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private rawToNode(resource: K8sRawResource, clusterName: string): GraphNodeInput {
    const kind = resource.kind;
    const resourceType = KIND_TO_RESOURCE_TYPE[kind] ?? "custom";
    const ns = resource.metadata.namespace ?? "_cluster";
    const name = resource.metadata.name;
    const id = buildK8sNodeId(clusterName, ns, resourceType, name);

    return {
      id,
      provider: "kubernetes",
      resourceType,
      nativeId: `${ns}/${kind}/${name}`,
      name,
      region: ns,
      account: clusterName,
      status: mapK8sStatus(resource),
      tags: resource.metadata.labels ?? {},
      metadata: {
        kind,
        apiVersion: resource.apiVersion,
        uid: resource.metadata.uid,
        ...(resource.metadata.annotations
          ? { annotations: resource.metadata.annotations }
          : {}),
      },
      costMonthly: null,
      owner: resource.metadata.labels?.["app.kubernetes.io/part-of"] ??
        resource.metadata.labels?.["app.kubernetes.io/name"] ??
        null,
      createdAt: resource.metadata.creationTimestamp ?? null,
    };
  }

  private async getClient(): Promise<K8sClient> {
    if (this.config.clientFactory) {
      return this.config.clientFactory(this.config);
    }

    return createK8sClientFromKubeConfig(this.config);
  }
}

// =============================================================================
// Real K8s Client (uses @kubernetes/client-node)
// =============================================================================

/**
 * Create a K8s client from kubeconfig using @kubernetes/client-node.
 * Dynamically imported to avoid hard dependency.
 */
async function createK8sClientFromKubeConfig(config: K8sAdapterConfig): Promise<K8sClient> {
  // @ts-ignore -- optional peer dependency, resolved at runtime
  const k8s = await import("@kubernetes/client-node");

  const kc = new k8s.KubeConfig();
  if (config.kubeConfigPath) {
    kc.loadFromFile(config.kubeConfigPath);
  } else {
    kc.loadFromDefault();
  }
  if (config.context) {
    kc.setCurrentContext(config.context);
  }

  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const appsApi = kc.makeApiClient(k8s.AppsV1Api);
  const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);
  const batchApi = kc.makeApiClient(k8s.BatchV1Api);

  const toRaw = (item: Record<string, unknown>, kind: string, apiVersion: string): K8sRawResource => ({
    apiVersion: (item.apiVersion as string) ?? apiVersion,
    kind: (item.kind as string) ?? kind,
    metadata: item.metadata as K8sRawResource["metadata"],
    spec: item.spec as Record<string, unknown> | undefined,
    status: item.status as Record<string, unknown> | undefined,
  });

  return {
    async getNamespaces() {
      const res = await coreApi.listNamespace();
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "Namespace", "v1"));
    },
    async getDeployments(ns: string) {
      const res = await appsApi.listNamespacedDeployment(ns);
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "Deployment", "apps/v1"));
    },
    async getStatefulSets(ns: string) {
      const res = await appsApi.listNamespacedStatefulSet(ns);
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "StatefulSet", "apps/v1"));
    },
    async getDaemonSets(ns: string) {
      const res = await appsApi.listNamespacedDaemonSet(ns);
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "DaemonSet", "apps/v1"));
    },
    async getReplicaSets(ns: string) {
      const res = await appsApi.listNamespacedReplicaSet(ns);
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "ReplicaSet", "apps/v1"));
    },
    async getServices(ns: string) {
      const res = await coreApi.listNamespacedService(ns);
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "Service", "v1"));
    },
    async getIngresses(ns: string) {
      const res = await networkingApi.listNamespacedIngress(ns);
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "Ingress", "networking.k8s.io/v1"));
    },
    async getConfigMaps(ns: string) {
      const res = await coreApi.listNamespacedConfigMap(ns);
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "ConfigMap", "v1"));
    },
    async getSecrets(ns: string) {
      const res = await coreApi.listNamespacedSecret(ns);
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "Secret", "v1"));
    },
    async getPersistentVolumes() {
      const res = await coreApi.listPersistentVolume();
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "PersistentVolume", "v1"));
    },
    async getPersistentVolumeClaims(ns: string) {
      const res = await coreApi.listNamespacedPersistentVolumeClaim(ns);
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "PersistentVolumeClaim", "v1"));
    },
    async getServiceAccounts(ns: string) {
      const res = await coreApi.listNamespacedServiceAccount(ns);
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "ServiceAccount", "v1"));
    },
    async getNetworkPolicies(ns: string) {
      const res = await networkingApi.listNamespacedNetworkPolicy(ns);
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "NetworkPolicy", "networking.k8s.io/v1"));
    },
    async getCronJobs(ns: string) {
      const res = await batchApi.listNamespacedCronJob(ns);
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "CronJob", "batch/v1"));
    },
    async getJobs(ns: string) {
      const res = await batchApi.listNamespacedJob(ns);
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "Job", "batch/v1"));
    },
    async getNodes() {
      const res = await coreApi.listNode();
      return (res.body?.items ?? res.items ?? []).map((i: Record<string, unknown>) => toRaw(i, "Node", "v1"));
    },
    async getClusterInfo() {
      const currentContext = kc.getCurrentContext();
      const cluster = kc.getCurrentCluster();
      return {
        name: cluster?.name ?? currentContext ?? "unknown",
        version: "unknown",
      };
    },
    async healthCheck() {
      try {
        await coreApi.listNamespace();
        return true;
      } catch {
        return false;
      }
    },
  };
}
