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

// ── Knowledge Graph Type Mirrors (avoid cross-extension rootDir imports) ────

export type CloudProvider = "aws" | "azure" | "gcp" | "kubernetes" | "custom";

export type GraphResourceType =
  | "compute" | "storage" | "network" | "database" | "cache"
  | "queue" | "function" | "serverless-function" | "container"
  | "cluster" | "load-balancer" | "dns" | "certificate" | "secret"
  | "policy" | "identity" | "vpc" | "subnet" | "security-group"
  | "iam-role" | "nat-gateway" | "api-gateway" | "cdn" | "topic"
  | "stream" | "custom";

export type GraphNodeStatus =
  | "running" | "stopped" | "pending" | "creating" | "deleting"
  | "deleted" | "error" | "unknown" | "disappeared";

export type GraphRelationshipType =
  | "runs-in" | "contains" | "secured-by" | "secures" | "routes-to"
  | "receives-from" | "triggers" | "triggered-by" | "reads-from"
  | "writes-to" | "stores-in" | "uses" | "used-by" | "attached-to"
  | "depends-on" | "depended-on-by" | "replicates-to" | "replicates"
  | "peers-with" | "member-of" | "load-balances" | "resolves-to"
  | "encrypts-with" | "authenticated-by" | "publishes-to"
  | "subscribes-to" | "monitors" | "monitored-by" | "logs-to"
  | "receives-logs-from" | "backed-by" | "backs" | "aliases"
  | "backs-up" | "connects-via" | "exposes" | "inherits-from" | "custom";

export type EdgeDiscoveryMethod =
  | "config-scan" | "api-field" | "runtime-trace" | "iac-parse"
  | "event-stream" | "manual";

export interface GraphNode {
  id: string;
  provider: CloudProvider;
  resourceType: GraphResourceType;
  nativeId: string;
  name: string;
  region: string;
  account: string;
  status: GraphNodeStatus;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  costMonthly: number | null;
  owner: string | null;
  discoveredAt: string;
  createdAt: string | null;
  updatedAt: string;
  lastSeenAt: string;
}

export type GraphNodeInput = Omit<GraphNode, "discoveredAt" | "updatedAt" | "lastSeenAt"> & {
  discoveredAt?: string;
  updatedAt?: string;
  lastSeenAt?: string;
};

export interface GraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: GraphRelationshipType;
  confidence: number;
  discoveredVia: EdgeDiscoveryMethod;
  metadata: Record<string, unknown>;
  createdAt: string;
  lastSeenAt: string;
}

export type GraphEdgeInput = Omit<GraphEdge, "createdAt" | "lastSeenAt"> & {
  createdAt?: string;
  lastSeenAt?: string;
};

export interface GraphStorage {
  initialize(): Promise<void>;
  close(): Promise<void>;
  upsertNode(node: GraphNodeInput): Promise<void>;
  upsertNodes(nodes: GraphNodeInput[]): Promise<void>;
  getNode(id: string): Promise<GraphNode | null>;
  getNodeByNativeId(provider: CloudProvider, nativeId: string): Promise<GraphNode | null>;
  queryNodes(filter: Record<string, unknown>): Promise<GraphNode[]>;
  deleteNode(id: string): Promise<void>;
  upsertEdge(edge: GraphEdgeInput): Promise<void>;
  upsertEdges(edges: GraphEdgeInput[]): Promise<void>;
  getEdge(id: string): Promise<GraphEdge | null>;
  queryEdges(filter: Record<string, unknown>): Promise<GraphEdge[]>;
  deleteEdge(id: string): Promise<void>;
}
