/**
 * GCP Extension — Shared Types
 *
 * Core type definitions used across all GCP service modules.
 */

// =============================================================================
// GCP Resource Types
// =============================================================================

export type GcpResourceType =
  | "compute.googleapis.com/Instance"
  | "compute.googleapis.com/Disk"
  | "compute.googleapis.com/Network"
  | "compute.googleapis.com/Subnetwork"
  | "compute.googleapis.com/Firewall"
  | "compute.googleapis.com/Address"
  | "compute.googleapis.com/ForwardingRule"
  | "compute.googleapis.com/HealthCheck"
  | "storage.googleapis.com/Bucket"
  | "container.googleapis.com/Cluster"
  | "sqladmin.googleapis.com/Instance"
  | "firestore.googleapis.com/Database"
  | "bigquery.googleapis.com/Dataset"
  | "cloudfunctions.googleapis.com/Function"
  | "run.googleapis.com/Service"
  | "appengine.googleapis.com/Application"
  | "pubsub.googleapis.com/Topic"
  | "pubsub.googleapis.com/Subscription"
  | "dns.googleapis.com/ManagedZone"
  | "redis.googleapis.com/Instance"
  | "cloudkms.googleapis.com/KeyRing"
  | "secretmanager.googleapis.com/Secret"
  | "monitoring.googleapis.com/AlertPolicy"
  | "logging.googleapis.com/LogSink"
  | "cloudscheduler.googleapis.com/Job"
  | "cloudtasks.googleapis.com/Queue"
  | "aiplatform.googleapis.com/Model"
  | "cloudresourcemanager.googleapis.com/Project";

// =============================================================================
// GCP Regions
// =============================================================================

export type GcpRegion =
  | "us-central1"
  | "us-east1"
  | "us-east4"
  | "us-east5"
  | "us-south1"
  | "us-west1"
  | "us-west2"
  | "us-west3"
  | "us-west4"
  | "northamerica-northeast1"
  | "northamerica-northeast2"
  | "southamerica-east1"
  | "southamerica-west1"
  | "europe-central2"
  | "europe-north1"
  | "europe-southwest1"
  | "europe-west1"
  | "europe-west2"
  | "europe-west3"
  | "europe-west4"
  | "europe-west6"
  | "europe-west8"
  | "europe-west9"
  | "asia-east1"
  | "asia-east2"
  | "asia-northeast1"
  | "asia-northeast2"
  | "asia-northeast3"
  | "asia-south1"
  | "asia-south2"
  | "asia-southeast1"
  | "asia-southeast2"
  | "australia-southeast1"
  | "australia-southeast2"
  | "me-central1"
  | "me-west1"
  | "africa-south1"
  | string; // Allow custom regions

// =============================================================================
// Common Configuration
// =============================================================================

export type GcpRetryOptions = {
  maxAttempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
};

export type GcpPluginConfig = {
  defaultProject?: string;
  defaultRegion?: string;
  defaultZone?: string;
  credentialMethod?: "default" | "service-account" | "gcloud-cli" | "workload-identity";
  serviceAccountKeyFile?: string;
  retry?: GcpRetryOptions;
  diagnostics?: {
    enabled?: boolean;
    verbose?: boolean;
  };
  labelConfig?: {
    requiredLabels?: string[];
    optionalLabels?: string[];
  };
  defaultLabels?: Array<{ key: string; value: string }>;
};

// =============================================================================
// Common Result Types
// =============================================================================

export type GcpOperationResult<T = unknown> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  operationId?: string;
};

export type GcpResource = {
  id: string;
  name: string;
  selfLink?: string;
  type: string;
  location: string;
  project: string;
  labels?: Record<string, string>;
  status?: string;
  createdAt?: string;
  modifiedAt?: string;
};

export type GcpResourceFilter = {
  project?: string;
  location?: string;
  labels?: Record<string, string>;
  type?: GcpResourceType;
  namePattern?: string;
};

// =============================================================================
// Pagination
// =============================================================================

export type GcpPagedResult<T> = {
  items: T[];
  nextPageToken?: string;
  totalCount?: number;
};

// =============================================================================
// Labels
// =============================================================================

export type GcpLabelSet = Record<string, string>;

export type GcpLabelOperation = {
  action: "add" | "remove" | "replace";
  labels: GcpLabelSet;
};
