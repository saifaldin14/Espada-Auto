/**
 * GCP Infrastructure as Code (IaC) Manager
 *
 * Manages Deployment Manager deployments and Infrastructure Manager (Terraform)
 * configurations via GCP REST APIs.
 */

import type { GcpRetryOptions, GcpOperationResult } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

export type DeploymentState = "PENDING" | "RUNNING" | "DONE" | "CANCELLED" | "UNKNOWN";

export type DeploymentInfo = {
  name: string;
  id: string;
  description: string;
  operation: string;
  manifest: string;
  insertTime: string;
  updateTime: string;
  fingerprint: string;
  labels: Record<string, string>;
};

export type DeploymentResource = {
  name: string;
  type: string;
  id: string;
  insertTime: string;
  updateTime: string;
  url: string;
  warnings: string[];
};

export type CreateDeploymentOptions = {
  name: string;
  description?: string;
  config: string;
  labels?: Record<string, string>;
  preview?: boolean;
};

export type UpdateDeploymentOptions = {
  name: string;
  config: string;
  preview?: boolean;
  deletePolicy?: "DELETE" | "ABANDON";
};

export type DeploymentTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  config: string;
  parameters: TemplateParameter[];
};

export type TemplateParameter = {
  name: string;
  description: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  default?: string;
};

export type InfraRevision = {
  name: string;
  state: "APPLYING" | "APPLIED" | "FAILED";
  createTime: string;
  updateTime: string;
  terraformBlueprint?: {
    gcsSource: string;
    inputValues: Record<string, string>;
  };
  errorCode?: string;
  errorLogs?: string;
};

export type InfraDeployment = {
  name: string;
  description: string;
  state: "CREATING" | "ACTIVE" | "UPDATING" | "DELETING" | "FAILED";
  createTime: string;
  updateTime: string;
  latestRevision: string;
  serviceAccount: string;
  labels: Record<string, string>;
};

export type CreateInfraDeploymentOptions = {
  location: string;
  deploymentId: string;
  description?: string;
  serviceAccount: string;
  terraformBlueprint: {
    gcsSource: string;
    inputValues?: Record<string, string>;
  };
  labels?: Record<string, string>;
};

// =============================================================================
// Built-in Templates
// =============================================================================

const BUILTIN_TEMPLATES: DeploymentTemplate[] = [
  {
    id: "gcp-web-app",
    name: "Web Application Stack",
    description: "GCE instance with load balancer and Cloud SQL database",
    category: "web",
    config: `resources:
- name: web-instance
  type: compute.v1.instance
  properties:
    zone: {{ zone }}
    machineType: zones/{{ zone }}/machineTypes/{{ machineType }}
    disks:
    - deviceName: boot
      type: PERSISTENT
      boot: true
      initializeParams:
        sourceImage: projects/debian-cloud/global/images/family/debian-12
    networkInterfaces:
    - network: global/networks/default
      accessConfigs:
      - name: External NAT
        type: ONE_TO_ONE_NAT`,
    parameters: [
      { name: "zone", description: "GCE zone", type: "string", required: true, default: "us-central1-a" },
      { name: "machineType", description: "Machine type", type: "string", required: true, default: "e2-medium" },
    ],
  },
  {
    id: "gcp-serverless-api",
    name: "Serverless API",
    description: "Cloud Run service with Cloud SQL and Pub/Sub",
    category: "serverless",
    config: `resources:
- name: api-service
  type: gcp-types/run-v1:namespaces.services
  properties:
    parent: namespaces/{{ project }}
    apiVersion: serving.knative.dev/v1
    kind: Service
    metadata:
      name: {{ serviceName }}
    spec:
      template:
        spec:
          containers:
          - image: {{ image }}`,
    parameters: [
      { name: "project", description: "GCP project ID", type: "string", required: true },
      { name: "serviceName", description: "Cloud Run service name", type: "string", required: true },
      { name: "image", description: "Container image URL", type: "string", required: true },
    ],
  },
  {
    id: "gcp-data-pipeline",
    name: "Data Pipeline",
    description: "BigQuery dataset with Pub/Sub and Dataflow job template",
    category: "data",
    config: `resources:
- name: dataset
  type: gcp-types/bigquery-v2:datasets
  properties:
    datasetReference:
      datasetId: {{ datasetId }}
    location: {{ location }}
- name: ingestion-topic
  type: gcp-types/pubsub-v1:projects.topics
  properties:
    topic: {{ topicName }}`,
    parameters: [
      { name: "datasetId", description: "BigQuery dataset ID", type: "string", required: true },
      { name: "location", description: "Dataset location", type: "string", required: true, default: "US" },
      { name: "topicName", description: "Pub/Sub topic name", type: "string", required: true },
    ],
  },
  {
    id: "gcp-gke-cluster",
    name: "GKE Cluster",
    description: "GKE Autopilot cluster with private networking",
    category: "kubernetes",
    config: `resources:
- name: {{ clusterName }}-cluster
  type: container.v1.cluster
  properties:
    zone: {{ zone }}
    cluster:
      name: {{ clusterName }}
      autopilot:
        enabled: true
      networkConfig:
        enableIntraNodeVisibility: true
      privateClusterConfig:
        enablePrivateNodes: true
        masterIpv4CidrBlock: 172.16.0.0/28`,
    parameters: [
      { name: "clusterName", description: "GKE cluster name", type: "string", required: true },
      { name: "zone", description: "GKE zone", type: "string", required: true, default: "us-central1" },
    ],
  },
];

// =============================================================================
// Manager
// =============================================================================

const DM_BASE = "https://deploymentmanager.googleapis.com/v2";
const INFRA_BASE = "https://config.googleapis.com/v1";

export class GcpIacManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(
    projectId: string,
    getAccessToken: () => Promise<string>,
    retryOptions?: GcpRetryOptions,
  ) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = {
      ...(retryOptions ?? {}),
      service: "iac",
      projectId: this.projectId,
    };
  }

  // ---------------------------------------------------------------------------
  // Deployment Manager
  // ---------------------------------------------------------------------------

  async listDeployments(): Promise<DeploymentInfo[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${DM_BASE}/projects/${this.projectId}/global/deployments`;
      const items = await gcpList<Record<string, unknown>>(url, token, "deployments");
      return items.map((d) => this.mapDeployment(d));
    }, this.retryOptions);
  }

  async getDeployment(name: string): Promise<DeploymentInfo> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${DM_BASE}/projects/${this.projectId}/global/deployments/${name}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapDeployment(raw);
    }, this.retryOptions);
  }

  async getDeploymentResources(name: string): Promise<DeploymentResource[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${DM_BASE}/projects/${this.projectId}/global/deployments/${name}/resources`;
      const items = await gcpList<Record<string, unknown>>(url, token, "resources");
      return items.map((r) => ({
        name: String(r.name ?? ""),
        type: String(r.type ?? ""),
        id: String(r.id ?? ""),
        insertTime: String(r.insertTime ?? ""),
        updateTime: String(r.updateTime ?? ""),
        url: String(r.url ?? ""),
        warnings: ((r.warnings ?? []) as Array<Record<string, unknown>>).map((w) => String(w.message ?? "")),
      }));
    }, this.retryOptions);
  }

  async createDeployment(opts: CreateDeploymentOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${DM_BASE}/projects/${this.projectId}/global/deployments${opts.preview ? "?preview=true" : ""}`;
      const body = {
        name: opts.name,
        description: opts.description ?? "",
        target: {
          config: {
            content: opts.config,
          },
        },
        labels: Object.entries(opts.labels ?? {}).map(([key, value]) => ({ key, value })),
      };
      const result = await gcpMutate(url, token, body);
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  async updateDeployment(opts: UpdateDeploymentOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${DM_BASE}/projects/${this.projectId}/global/deployments/${opts.name}${opts.preview ? "?preview=true" : ""}`;
      const body = {
        name: opts.name,
        target: {
          config: {
            content: opts.config,
          },
        },
      };
      const result = await gcpMutate(url, token, body, "PUT");
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  async deleteDeployment(name: string, deletePolicy?: "DELETE" | "ABANDON"): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const params = deletePolicy ? `?deletePolicy=${deletePolicy}` : "";
      const url = `${DM_BASE}/projects/${this.projectId}/global/deployments/${name}${params}`;
      const result = await gcpMutate(url, token, undefined, "DELETE");
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Infrastructure Manager (Terraform)
  // ---------------------------------------------------------------------------

  async listInfraDeployments(location: string): Promise<InfraDeployment[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${INFRA_BASE}/projects/${this.projectId}/locations/${location}/deployments`;
      const items = await gcpList<Record<string, unknown>>(url, token, "deployments");
      return items.map((d) => this.mapInfraDeployment(d));
    }, this.retryOptions);
  }

  async createInfraDeployment(opts: CreateInfraDeploymentOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${INFRA_BASE}/projects/${this.projectId}/locations/${opts.location}/deployments?deploymentId=${encodeURIComponent(opts.deploymentId)}`;
      const body = {
        description: opts.description ?? "",
        serviceAccount: opts.serviceAccount,
        terraformBlueprint: {
          gcsSource: opts.terraformBlueprint.gcsSource,
          inputValues: Object.fromEntries(
            Object.entries(opts.terraformBlueprint.inputValues ?? {}).map(([k, v]) => [k, { inputValue: v }]),
          ),
        },
        labels: opts.labels ?? {},
      };
      const result = await gcpMutate(url, token, body);
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  async listRevisions(location: string, deploymentId: string): Promise<InfraRevision[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${INFRA_BASE}/projects/${this.projectId}/locations/${location}/deployments/${deploymentId}/revisions`;
      const items = await gcpList<Record<string, unknown>>(url, token, "revisions");
      return items.map((r) => this.mapRevision(r));
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  getTemplates(): DeploymentTemplate[] {
    return [...BUILTIN_TEMPLATES];
  }

  getTemplate(id: string): DeploymentTemplate | undefined {
    return BUILTIN_TEMPLATES.find((t) => t.id === id);
  }

  renderTemplate(id: string, variables: Record<string, string>): string | undefined {
    const template = this.getTemplate(id);
    if (!template) return undefined;

    let config = template.config;
    for (const [key, value] of Object.entries(variables)) {
      config = config.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"), value);
    }
    return config;
  }

  // ---------------------------------------------------------------------------
  // Private mapping helpers
  // ---------------------------------------------------------------------------

  private mapDeployment(raw: Record<string, unknown>): DeploymentInfo {
    const labels = (raw.labels ?? []) as Array<Record<string, string>>;
    return {
      name: String(raw.name ?? ""),
      id: String(raw.id ?? ""),
      description: String(raw.description ?? ""),
      operation: String((raw.operation as Record<string, unknown>)?.name ?? ""),
      manifest: String(raw.manifest ?? ""),
      insertTime: String(raw.insertTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      fingerprint: String(raw.fingerprint ?? ""),
      labels: Object.fromEntries(labels.map((l) => [l.key, l.value])),
    };
  }

  private mapInfraDeployment(raw: Record<string, unknown>): InfraDeployment {
    return {
      name: String(raw.name ?? ""),
      description: String(raw.description ?? ""),
      state: (raw.state as InfraDeployment["state"]) ?? "ACTIVE",
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      latestRevision: String(raw.latestRevision ?? ""),
      serviceAccount: String(raw.serviceAccount ?? ""),
      labels: (raw.labels as Record<string, string>) ?? {},
    };
  }

  private mapRevision(raw: Record<string, unknown>): InfraRevision {
    const blueprint = raw.terraformBlueprint as Record<string, unknown> | undefined;
    return {
      name: String(raw.name ?? ""),
      state: (raw.state as InfraRevision["state"]) ?? "FAILED",
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      terraformBlueprint: blueprint
        ? {
            gcsSource: String(blueprint.gcsSource ?? ""),
            inputValues: (blueprint.inputValues as Record<string, string>) ?? {},
          }
        : undefined,
      errorCode: raw.errorCode ? String(raw.errorCode) : undefined,
      errorLogs: raw.errorLogs ? String(raw.errorLogs) : undefined,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createIacManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpIacManager {
  return new GcpIacManager(projectId, getAccessToken, retryOptions);
}
