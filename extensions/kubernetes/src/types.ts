/**
 * Kubernetes extension types — resources, manifests, clusters, namespaces.
 */

/* ---------- K8s Resource ---------- */

export type K8sResourceKind =
  | "Pod"
  | "Service"
  | "Deployment"
  | "StatefulSet"
  | "DaemonSet"
  | "ReplicaSet"
  | "Ingress"
  | "ConfigMap"
  | "Secret"
  | "Namespace"
  | "PersistentVolumeClaim"
  | "PersistentVolume"
  | "ServiceAccount"
  | "Role"
  | "ClusterRole"
  | "RoleBinding"
  | "ClusterRoleBinding"
  | "CronJob"
  | "Job"
  | "HorizontalPodAutoscaler"
  | "NetworkPolicy"
  | string;

export interface K8sMetadata {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  uid?: string;
  creationTimestamp?: string;
  ownerReferences?: K8sOwnerReference[];
}

export interface K8sOwnerReference {
  apiVersion: string;
  kind: string;
  name: string;
  uid: string;
}

export interface K8sResource {
  apiVersion: string;
  kind: K8sResourceKind;
  metadata: K8sMetadata;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  data?: Record<string, unknown>; // ConfigMap/Secret
}

/* ---------- Manifest ---------- */

export interface K8sManifest {
  /** File path the manifest was loaded from. */
  filePath?: string;
  resources: K8sResource[];
}

/* ---------- Cluster / Namespace ---------- */

export interface K8sCluster {
  name: string;
  server: string;
  currentContext?: string;
}

export interface K8sNamespace {
  name: string;
  status: "Active" | "Terminating";
  labels?: Record<string, string>;
}

/* ---------- Parsed / Normalized ---------- */

export interface ParsedK8sResource {
  kind: K8sResourceKind;
  name: string;
  namespace: string;
  apiVersion: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  uid?: string;
  creationTimestamp?: string;
  spec: Record<string, unknown>;
  /** Resolved relationships to other resources. */
  relations: K8sRelation[];
}

export interface K8sRelation {
  targetKind: string;
  targetName: string;
  targetNamespace?: string;
  type: K8sEdgeType;
}

export type K8sEdgeType =
  | "routes-to"
  | "manages"
  | "uses"
  | "mounts"
  | "selects"
  | "binds-to"
  | "exposes";

/* ---------- Diff result ---------- */

export interface K8sDiffResult {
  resource: string;
  kind: string;
  namespace: string;
  diff: string;
  hasDiff: boolean;
}
