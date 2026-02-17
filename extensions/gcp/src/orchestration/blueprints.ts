/**
 * IDIO — Built-in Blueprints (GCP)
 *
 * Reusable, parameterized templates that generate ExecutionPlans for
 * common multi-resource GCP architectures.
 */

import crypto from "node:crypto";
import type { Blueprint, BlueprintParameter, ExecutionPlan, PlanStep } from "./types.js";

// =============================================================================
// Blueprint Registry
// =============================================================================

const blueprintRegistry = new Map<string, Blueprint>();

/**
 * Register a blueprint in the registry.
 */
export function registerBlueprint(blueprint: Blueprint): void {
  if (blueprintRegistry.has(blueprint.id)) {
    throw new Error(`Blueprint "${blueprint.id}" is already registered`);
  }
  blueprintRegistry.set(blueprint.id, blueprint);
}

/**
 * Get a blueprint by ID.
 */
export function getBlueprint(id: string): Blueprint | undefined {
  return blueprintRegistry.get(id);
}

/**
 * List all registered blueprints.
 */
export function listBlueprints(): Blueprint[] {
  return [...blueprintRegistry.values()];
}

// =============================================================================
// Helpers
// =============================================================================

function bp(
  name: string,
  type: BlueprintParameter["type"],
  description: string,
  required = true,
  defaultVal?: unknown,
  choices?: string[],
): BlueprintParameter {
  return { name, type, description, required, default: defaultVal, choices };
}

function step(
  id: string,
  type: string,
  params: Record<string, unknown>,
  dependsOn?: string[],
  name?: string,
): PlanStep {
  return {
    id,
    type,
    name: name ?? id,
    params,
    dependsOn,
  };
}

// =============================================================================
// Blueprint: Web App with Cloud SQL
// =============================================================================

export const webAppWithSqlBlueprint: Blueprint = {
  id: "web-app-with-sql",
  name: "Web App with Cloud SQL",
  description: "Deploys a Cloud Run service with a Cloud SQL database, GCS bucket for assets, monitoring, and Secret Manager",
  category: "web-app",
  parameters: [
    bp("projectId", "string", "GCP project ID"),
    bp("region", "string", "GCP region (e.g. us-central1)"),
    bp("serviceName", "string", "Cloud Run service name"),
    bp("image", "string", "Container image URL"),
    bp("dbInstanceName", "string", "Cloud SQL instance name", false, "main-db"),
    bp("dbVersion", "string", "Cloud SQL database version", false, "POSTGRES_15", ["POSTGRES_15", "POSTGRES_14", "MYSQL_8_0"]),
    bp("dbTier", "string", "Cloud SQL machine tier", false, "db-f1-micro"),
    bp("bucketName", "string", "GCS bucket name for static assets", false),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as {
      projectId: string; region: string; serviceName: string; image: string;
      dbInstanceName?: string; dbVersion?: string; dbTier?: string; bucketName?: string;
    };
    const prefix = p.serviceName.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const bucketName = p.bucketName ?? `${p.projectId}-${prefix}-assets`;
    const dbInstance = p.dbInstanceName ?? "main-db";

    const steps: PlanStep[] = [
      // 1. GCS bucket for static assets
      step("bucket", "create-gcs-bucket", {
        project: p.projectId,
        bucketName,
        location: p.region,
        storageClass: "STANDARD",
        uniformBucketLevelAccess: true,
      }, [], "Create GCS Bucket"),

      // 2. Cloud SQL instance
      step("sql", "create-cloud-sql", {
        project: p.projectId,
        instanceName: dbInstance,
        region: p.region,
        databaseVersion: p.dbVersion ?? "POSTGRES_15",
        tier: p.dbTier ?? "db-f1-micro",
        databaseName: `${prefix}-db`,
      }, [], "Create Cloud SQL Instance"),

      // 3. Secret for database credentials
      step("db-secret", "create-secret", {
        project: p.projectId,
        secretId: `${prefix}-db-credentials`,
      }, [], "Create DB Credentials Secret"),

      // 4. Cloud Run service (depends on SQL + bucket + secret)
      step("service", "create-cloud-run-service", {
        project: p.projectId,
        region: p.region,
        serviceName: p.serviceName,
        image: p.image,
        envVars: {
          DB_CONNECTION: "$step.sql.connectionString",
          BUCKET_NAME: "$step.bucket.bucketName",
          DB_SECRET: "$step.db-secret.secretName",
        },
      }, ["sql", "bucket", "db-secret"], "Deploy Cloud Run Service"),

      // 5. Monitoring alert
      step("monitoring", "create-monitoring-alert", {
        project: p.projectId,
        displayName: `${prefix}-error-rate`,
        conditions: [{
          displayName: "Error rate > 5%",
          conditionThreshold: {
            filter: `resource.type="cloud_run_revision" AND resource.labels.service_name="${p.serviceName}"`,
            comparison: "COMPARISON_GT",
            thresholdValue: 0.05,
          },
        }],
      }, ["service"], "Create Monitoring Alert"),
    ];

    return {
      id: crypto.randomUUID(),
      name: `Web App with SQL — ${p.serviceName}`,
      description: `Deploy ${p.serviceName} with Cloud SQL backend in ${p.region}`,
      steps,
      params: { projectId: p.projectId, region: p.region },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// Blueprint: Static Site with CDN
// =============================================================================

export const staticSiteWithCdnBlueprint: Blueprint = {
  id: "static-site-with-cdn",
  name: "Static Site with CDN",
  description: "Deploys a GCS bucket configured for static site hosting with a Cloud CDN backend bucket",
  category: "web-app",
  parameters: [
    bp("projectId", "string", "GCP project ID"),
    bp("region", "string", "GCP region"),
    bp("siteName", "string", "Site name used as prefix for resources"),
    bp("storageClass", "string", "GCS storage class", false, "STANDARD", ["STANDARD", "NEARLINE", "COLDLINE"]),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as {
      projectId: string; region: string; siteName: string; storageClass?: string;
    };
    const prefix = p.siteName.toLowerCase().replace(/[^a-z0-9-]/g, "");

    const steps: PlanStep[] = [
      // 1. GCS bucket for static content
      step("bucket", "create-gcs-bucket", {
        project: p.projectId,
        bucketName: `${p.projectId}-${prefix}-site`,
        location: p.region,
        storageClass: p.storageClass ?? "STANDARD",
        uniformBucketLevelAccess: true,
        versioning: false,
      }, [], "Create Static Site Bucket"),

      // 2. Firewall rule for CDN health checks
      step("fw-health", "create-firewall-rule", {
        project: p.projectId,
        ruleName: `${prefix}-allow-health-checks`,
        network: "default",
        direction: "INGRESS",
        sourceRanges: ["130.211.0.0/22", "35.191.0.0/16"],
        allowed: [{ IPProtocol: "tcp", ports: ["80", "443"] }],
      }, [], "Create CDN Health Check Firewall Rule"),
    ];

    return {
      id: crypto.randomUUID(),
      name: `Static Site with CDN — ${p.siteName}`,
      description: `Deploy a static site with CDN for ${p.siteName} in ${p.region}`,
      steps,
      params: { projectId: p.projectId, region: p.region },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// Blueprint: API Backend
// =============================================================================

export const apiBackendBlueprint: Blueprint = {
  id: "api-backend",
  name: "API Backend",
  description: "Deploys a Cloud Run API service with Firestore, Secret Manager, and Cloud Monitoring",
  category: "api",
  parameters: [
    bp("projectId", "string", "GCP project ID"),
    bp("region", "string", "GCP region (e.g. us-central1)"),
    bp("serviceName", "string", "Cloud Run service name"),
    bp("image", "string", "Container image URL"),
    bp("firestoreLocation", "string", "Firestore database location", false, "us-central1"),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as {
      projectId: string; region: string; serviceName: string; image: string;
      firestoreLocation?: string;
    };
    const prefix = p.serviceName.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const firestoreLoc = p.firestoreLocation ?? p.region;

    const steps: PlanStep[] = [
      // 1. Firestore database
      step("firestore", "create-firestore-db", {
        project: p.projectId,
        locationId: firestoreLoc,
        databaseId: "(default)",
        type: "FIRESTORE_NATIVE",
      }, [], "Create Firestore Database"),

      // 2. Secret Manager for API keys
      step("api-secret", "create-secret", {
        project: p.projectId,
        secretId: `${prefix}-api-keys`,
      }, [], "Create API Keys Secret"),

      // 3. Cloud Run API service
      step("api", "create-cloud-run-service", {
        project: p.projectId,
        region: p.region,
        serviceName: p.serviceName,
        image: p.image,
        envVars: {
          FIRESTORE_DATABASE: "$step.firestore.databaseId",
          API_SECRET: "$step.api-secret.secretName",
        },
        allowUnauthenticated: false,
      }, ["firestore", "api-secret"], "Deploy API Service"),

      // 4. Monitoring alert for latency
      step("monitoring", "create-monitoring-alert", {
        project: p.projectId,
        displayName: `${prefix}-latency-alert`,
        conditions: [{
          displayName: "P99 latency > 2s",
          conditionThreshold: {
            filter: `resource.type="cloud_run_revision" AND resource.labels.service_name="${p.serviceName}"`,
            comparison: "COMPARISON_GT",
            thresholdValue: 2000,
          },
        }],
      }, ["api"], "Create Latency Alert"),
    ];

    return {
      id: crypto.randomUUID(),
      name: `API Backend — ${p.serviceName}`,
      description: `Deploy a secure API backend with Firestore in ${p.region}`,
      steps,
      params: { projectId: p.projectId, region: p.region },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// Blueprint: Microservices Backbone
// =============================================================================

export const microservicesBackboneBlueprint: Blueprint = {
  id: "microservices-backbone",
  name: "Microservices Backbone",
  description: "Deploys foundational infrastructure for microservices: VPC, Firewall, GKE, Pub/Sub, Redis, and Secret Manager",
  category: "microservices",
  parameters: [
    bp("projectId", "string", "GCP project ID"),
    bp("region", "string", "GCP region"),
    bp("zone", "string", "GCP zone (e.g. us-central1-a)"),
    bp("clusterName", "string", "GKE cluster name", false, "main-cluster"),
    bp("nodeCount", "number", "Initial node count per zone", false, 3),
    bp("machineType", "string", "GKE node machine type", false, "e2-standard-4"),
    bp("redisTier", "string", "Redis tier", false, "BASIC", ["BASIC", "STANDARD_HA"]),
    bp("redisMemoryGb", "number", "Redis memory size in GB", false, 1),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as {
      projectId: string; region: string; zone: string;
      clusterName?: string; nodeCount?: number; machineType?: string;
      redisTier?: string; redisMemoryGb?: number;
    };
    const prefix = (p.clusterName ?? "main").toLowerCase().replace(/[^a-z0-9-]/g, "");

    const steps: PlanStep[] = [
      // 1. VPC network
      step("vpc", "create-vpc-network", {
        project: p.projectId,
        networkName: `${prefix}-vpc`,
        autoCreateSubnetworks: false,
        routingMode: "REGIONAL",
      }, [], "Create VPC Network"),

      // 2. Firewall rules (depends on VPC)
      step("fw-internal", "create-firewall-rule", {
        project: p.projectId,
        ruleName: `${prefix}-allow-internal`,
        network: "$step.vpc.networkSelfLink",
        direction: "INGRESS",
        sourceRanges: ["10.0.0.0/8"],
        allowed: [{ IPProtocol: "tcp" }, { IPProtocol: "udp" }, { IPProtocol: "icmp" }],
      }, ["vpc"], "Create Internal Firewall Rule"),

      step("fw-health", "create-firewall-rule", {
        project: p.projectId,
        ruleName: `${prefix}-allow-health-checks`,
        network: "$step.vpc.networkSelfLink",
        direction: "INGRESS",
        sourceRanges: ["130.211.0.0/22", "35.191.0.0/16"],
        allowed: [{ IPProtocol: "tcp", ports: ["80", "443", "8080"] }],
      }, ["vpc"], "Create Health Check Firewall Rule"),

      // 3. GKE cluster (depends on VPC + firewall)
      step("gke", "create-gke-cluster", {
        project: p.projectId,
        zone: p.zone,
        clusterName: p.clusterName ?? "main-cluster",
        initialNodeCount: p.nodeCount ?? 3,
        machineType: p.machineType ?? "e2-standard-4",
        network: "$step.vpc.networkSelfLink",
        releaseChannel: "REGULAR",
      }, ["fw-internal", "fw-health"], "Create GKE Cluster"),

      // 4. Pub/Sub topic for event-driven messaging
      step("events-topic", "create-pubsub-topic", {
        project: p.projectId,
        topicName: `${prefix}-events`,
      }, [], "Create Events Pub/Sub Topic"),

      step("commands-topic", "create-pubsub-topic", {
        project: p.projectId,
        topicName: `${prefix}-commands`,
      }, [], "Create Commands Pub/Sub Topic"),

      // 5. Redis for caching / session store
      step("redis", "create-redis-instance", {
        project: p.projectId,
        region: p.region,
        instanceId: `${prefix}-cache`,
        tier: p.redisTier ?? "BASIC",
        memorySizeGb: p.redisMemoryGb ?? 1,
        network: "$step.vpc.networkSelfLink",
      }, ["vpc"], "Create Redis Instance"),

      // 6. Secret Manager
      step("secrets", "create-secret", {
        project: p.projectId,
        secretId: `${prefix}-service-credentials`,
      }, [], "Create Service Credentials Secret"),
    ];

    return {
      id: crypto.randomUUID(),
      name: `Microservices Backbone — ${prefix}`,
      description: `Deploy microservices foundation with GKE, Pub/Sub, Redis in ${p.region}`,
      steps,
      params: { projectId: p.projectId, region: p.region, zone: p.zone },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// Blueprint: Data Platform
// =============================================================================

export const dataPlatformBlueprint: Blueprint = {
  id: "data-platform",
  name: "Data Platform",
  description: "Deploys a data platform with GCS data lake, Cloud SQL warehouse, Firestore for metadata, monitoring, and Secret Manager",
  category: "data",
  parameters: [
    bp("projectId", "string", "GCP project ID"),
    bp("region", "string", "GCP region"),
    bp("platformName", "string", "Platform name used as prefix"),
    bp("sqlTier", "string", "Cloud SQL tier", false, "db-n1-standard-2"),
    bp("sqlVersion", "string", "Cloud SQL database version", false, "POSTGRES_15"),
    bp("firestoreLocation", "string", "Firestore location", false),
  ],

  generate(params: Record<string, unknown>): ExecutionPlan {
    const p = params as {
      projectId: string; region: string; platformName: string;
      sqlTier?: string; sqlVersion?: string; firestoreLocation?: string;
    };
    const prefix = p.platformName.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const firestoreLoc = p.firestoreLocation ?? p.region;

    const steps: PlanStep[] = [
      // 1. GCS data lake bucket
      step("data-lake", "create-gcs-bucket", {
        project: p.projectId,
        bucketName: `${p.projectId}-${prefix}-data-lake`,
        location: p.region,
        storageClass: "STANDARD",
        uniformBucketLevelAccess: true,
        versioning: true,
      }, [], "Create Data Lake Bucket"),

      // 2. Cloud SQL for structured data / warehouse
      step("warehouse", "create-cloud-sql", {
        project: p.projectId,
        instanceName: `${prefix}-warehouse`,
        region: p.region,
        databaseVersion: p.sqlVersion ?? "POSTGRES_15",
        tier: p.sqlTier ?? "db-n1-standard-2",
        databaseName: `${prefix}-warehouse-db`,
        backupEnabled: true,
        highAvailability: true,
      }, [], "Create Data Warehouse (Cloud SQL)"),

      // 3. Firestore for metadata catalog
      step("metadata", "create-firestore-db", {
        project: p.projectId,
        locationId: firestoreLoc,
        databaseId: `${prefix}-metadata`,
        type: "FIRESTORE_NATIVE",
      }, [], "Create Metadata Store (Firestore)"),

      // 4. Monitoring for data pipeline health
      step("monitoring", "create-monitoring-alert", {
        project: p.projectId,
        displayName: `${prefix}-pipeline-health`,
        conditions: [{
          displayName: "Data ingestion errors",
          conditionThreshold: {
            filter: `resource.type="gcs_bucket" AND resource.labels.bucket_name="${p.projectId}-${prefix}-data-lake"`,
            comparison: "COMPARISON_GT",
            thresholdValue: 0,
          },
        }],
      }, ["data-lake"], "Create Pipeline Health Alert"),

      // 5. Secrets for data pipeline credentials
      step("pipeline-secrets", "create-secret", {
        project: p.projectId,
        secretId: `${prefix}-pipeline-credentials`,
      }, [], "Create Pipeline Credentials Secret"),
    ];

    return {
      id: crypto.randomUUID(),
      name: `Data Platform — ${p.platformName}`,
      description: `Deploy data platform with GCS, Cloud SQL, and Firestore in ${p.region}`,
      steps,
      params: { projectId: p.projectId, region: p.region },
      createdAt: new Date().toISOString(),
    };
  },
};

// =============================================================================
// Builtin Blueprints
// =============================================================================

export const BUILTIN_BLUEPRINTS: Blueprint[] = [
  webAppWithSqlBlueprint,
  staticSiteWithCdnBlueprint,
  apiBackendBlueprint,
  microservicesBackboneBlueprint,
  dataPlatformBlueprint,
];

/**
 * Register all built-in blueprints in the registry.
 */
export function registerBuiltinBlueprints(): void {
  for (const bp of BUILTIN_BLUEPRINTS) {
    if (!blueprintRegistry.has(bp.id)) {
      registerBlueprint(bp);
    }
  }
}
