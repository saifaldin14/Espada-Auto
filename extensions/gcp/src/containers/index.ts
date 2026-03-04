/**
 * GCP Container Management
 *
 * Manages Artifact Registry repositories, container images, and
 * Cloud Run container lifecycle operations.
 */

import type { GcpRetryOptions, GcpOperationResult } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

export type RepositoryFormat = "DOCKER" | "MAVEN" | "NPM" | "PYTHON" | "APT" | "YUM" | "GO";

export type ArtifactRepository = {
  name: string;
  format: RepositoryFormat;
  description: string;
  location: string;
  sizeBytes: string;
  createTime: string;
  updateTime: string;
  labels: Record<string, string>;
  cleanupPolicyDryRun: boolean;
};

export type CreateRepositoryOptions = {
  location: string;
  repositoryId: string;
  format: RepositoryFormat;
  description?: string;
  labels?: Record<string, string>;
};

export type ContainerImage = {
  name: string;
  uri: string;
  tags: string[];
  imageSizeBytes: string;
  mediaType: string;
  uploadTime: string;
  buildTime?: string;
};

export type ContainerImageTag = {
  name: string;
  version: string;
};

export type CloudRunService = {
  name: string;
  description: string;
  uri: string;
  generation: number;
  labels: Record<string, string>;
  createTime: string;
  updateTime: string;
  latestReadyRevision: string;
  latestCreatedRevision: string;
  traffic: TrafficAllocation[];
  conditions: ServiceCondition[];
};

export type TrafficAllocation = {
  type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST" | "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION";
  revision?: string;
  percent: number;
  tag?: string;
};

export type ServiceCondition = {
  type: string;
  state: "CONDITION_SUCCEEDED" | "CONDITION_RECONCILING" | "CONDITION_FAILED" | "CONDITION_PENDING";
  message: string;
  lastTransitionTime: string;
};

export type CloudRunRevision = {
  name: string;
  generation: number;
  labels: Record<string, string>;
  createTime: string;
  containers: ContainerSpec[];
  scaling: { minInstanceCount: number; maxInstanceCount: number };
  serviceAccount: string;
};

export type ContainerSpec = {
  image: string;
  ports: Array<{ name: string; containerPort: number }>;
  env: Array<{ name: string; value?: string; secretRef?: string }>;
  resources: { cpuLimit: string; memoryLimit: string };
};

export type DeployServiceOptions = {
  location: string;
  serviceName: string;
  image: string;
  description?: string;
  env?: Record<string, string>;
  cpu?: string;
  memory?: string;
  minInstances?: number;
  maxInstances?: number;
  port?: number;
  serviceAccount?: string;
  labels?: Record<string, string>;
  allowUnauthenticated?: boolean;
};

// =============================================================================
// Manager
// =============================================================================

const AR_BASE = "https://artifactregistry.googleapis.com/v1";
const RUN_BASE = "https://run.googleapis.com/v2";

export class GcpContainerManager {
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
      service: "containers",
      projectId: this.projectId,
    };
  }

  // ---------------------------------------------------------------------------
  // Artifact Registry
  // ---------------------------------------------------------------------------

  async listRepositories(location: string): Promise<ArtifactRepository[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${AR_BASE}/projects/${this.projectId}/locations/${location}/repositories`;
      const items = await gcpList<Record<string, unknown>>(url, token, "repositories");
      return items.map((r) => this.mapRepository(r));
    }, this.retryOptions);
  }

  async createRepository(opts: CreateRepositoryOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${AR_BASE}/projects/${this.projectId}/locations/${opts.location}/repositories?repositoryId=${encodeURIComponent(opts.repositoryId)}`;
      const body = {
        format: opts.format,
        description: opts.description ?? "",
        labels: opts.labels ?? {},
      };
      const result = await gcpMutate(url, token, body);
      return { success: true, message: `Repository "${opts.repositoryId}" created`, operationId: result.operationId };
    }, this.retryOptions);
  }

  async deleteRepository(location: string, repositoryId: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${AR_BASE}/projects/${this.projectId}/locations/${location}/repositories/${repositoryId}`;
      const result = await gcpMutate(url, token, undefined, "DELETE");
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  async listImages(location: string, repository: string): Promise<ContainerImage[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${AR_BASE}/projects/${this.projectId}/locations/${location}/repositories/${repository}/dockerImages`;
      const items = await gcpList<Record<string, unknown>>(url, token, "dockerImages");
      return items.map((img) => ({
        name: String(img.name ?? ""),
        uri: String(img.uri ?? ""),
        tags: (img.tags ?? []) as string[],
        imageSizeBytes: String(img.imageSizeBytes ?? "0"),
        mediaType: String(img.mediaType ?? ""),
        uploadTime: String(img.uploadTime ?? ""),
        buildTime: img.buildTime ? String(img.buildTime) : undefined,
      }));
    }, this.retryOptions);
  }

  async deleteImage(imageName: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${AR_BASE}/${imageName}`;
      await gcpRequest(url, token, { method: "DELETE" });
      return { success: true, message: "Image deleted" };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Cloud Run Services
  // ---------------------------------------------------------------------------

  async listServices(location: string): Promise<CloudRunService[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${RUN_BASE}/projects/${this.projectId}/locations/${location}/services`;
      const items = await gcpList<Record<string, unknown>>(url, token, "services");
      return items.map((s) => this.mapService(s));
    }, this.retryOptions);
  }

  async getService(location: string, serviceName: string): Promise<CloudRunService> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${RUN_BASE}/projects/${this.projectId}/locations/${location}/services/${serviceName}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapService(raw);
    }, this.retryOptions);
  }

  async deployService(opts: DeployServiceOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const body = {
        description: opts.description ?? "",
        template: {
          containers: [{
            image: opts.image,
            ports: [{ containerPort: opts.port ?? 8080 }],
            env: Object.entries(opts.env ?? {}).map(([name, value]) => ({ name, value })),
            resources: {
              limits: {
                cpu: opts.cpu ?? "1",
                memory: opts.memory ?? "512Mi",
              },
            },
          }],
          scaling: {
            minInstanceCount: opts.minInstances ?? 0,
            maxInstanceCount: opts.maxInstances ?? 100,
          },
          serviceAccount: opts.serviceAccount,
        },
        labels: opts.labels ?? {},
      };

      // Try PATCH (update) first. If the service doesn't exist, fall back to
      // POST (create). This handles the "upsert" pattern cleanly.
      const patchUrl = `${RUN_BASE}/projects/${this.projectId}/locations/${opts.location}/services/${encodeURIComponent(opts.serviceName)}`;
      try {
        const result = await gcpMutate(patchUrl, token, body, "PATCH");
        return { success: true, message: `Service "${opts.serviceName}" updated`, operationId: result.operationId };
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode !== 404) throw err;
      }

      // Service doesn't exist — create it
      const createUrl = `${RUN_BASE}/projects/${this.projectId}/locations/${opts.location}/services?serviceId=${encodeURIComponent(opts.serviceName)}`;
      const result = await gcpMutate(createUrl, token, body);
      return { success: true, message: `Service "${opts.serviceName}" deployed`, operationId: result.operationId };
    }, this.retryOptions);
  }

  async deleteService(location: string, serviceName: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${RUN_BASE}/projects/${this.projectId}/locations/${location}/services/${serviceName}`;
      const result = await gcpMutate(url, token, undefined, "DELETE");
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  async listRevisions(location: string, serviceName: string): Promise<CloudRunRevision[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${RUN_BASE}/projects/${this.projectId}/locations/${location}/services/${serviceName}/revisions`;
      const items = await gcpList<Record<string, unknown>>(url, token, "revisions");
      return items.map((r) => this.mapRevision(r));
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Private mapping helpers
  // ---------------------------------------------------------------------------

  private mapRepository(raw: Record<string, unknown>): ArtifactRepository {
    return {
      name: String(raw.name ?? ""),
      format: (raw.format as RepositoryFormat) ?? "DOCKER",
      description: String(raw.description ?? ""),
      location: String(raw.name ?? "").split("/")[3] ?? "",
      sizeBytes: String(raw.sizeBytes ?? "0"),
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      labels: (raw.labels as Record<string, string>) ?? {},
      cleanupPolicyDryRun: Boolean(raw.cleanupPolicyDryRun),
    };
  }

  private mapService(raw: Record<string, unknown>): CloudRunService {
    const traffic = (raw.traffic ?? []) as Array<Record<string, unknown>>;
    const conditions = (raw.conditions ?? []) as Array<Record<string, unknown>>;

    return {
      name: String(raw.name ?? ""),
      description: String(raw.description ?? ""),
      uri: String(raw.uri ?? ""),
      generation: Number(raw.generation ?? 0),
      labels: (raw.labels as Record<string, string>) ?? {},
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      latestReadyRevision: String(raw.latestReadyRevision ?? ""),
      latestCreatedRevision: String(raw.latestCreatedRevision ?? ""),
      traffic: traffic.map((t) => ({
        type: (t.type as TrafficAllocation["type"]) ?? "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",
        revision: t.revision ? String(t.revision) : undefined,
        percent: Number(t.percent ?? 0),
        tag: t.tag ? String(t.tag) : undefined,
      })),
      conditions: conditions.map((c) => ({
        type: String(c.type ?? ""),
        state: (c.state as ServiceCondition["state"]) ?? "CONDITION_PENDING",
        message: String(c.message ?? ""),
        lastTransitionTime: String(c.lastTransitionTime ?? ""),
      })),
    };
  }

  private mapRevision(raw: Record<string, unknown>): CloudRunRevision {
    const containers = (raw.containers ?? []) as Array<Record<string, unknown>>;
    const scaling = (raw.scaling ?? {}) as Record<string, unknown>;

    return {
      name: String(raw.name ?? ""),
      generation: Number(raw.generation ?? 0),
      labels: (raw.labels as Record<string, string>) ?? {},
      createTime: String(raw.createTime ?? ""),
      containers: containers.map((c) => ({
        image: String(c.image ?? ""),
        ports: ((c.ports ?? []) as Array<Record<string, unknown>>).map((p) => ({
          name: String(p.name ?? ""),
          containerPort: Number(p.containerPort ?? 0),
        })),
        env: ((c.env ?? []) as Array<Record<string, unknown>>).map((e) => ({
          name: String(e.name ?? ""),
          value: e.value ? String(e.value) : undefined,
          secretRef: e.valueSource ? String((e.valueSource as Record<string, unknown>).secretKeyRef ?? "") : undefined,
        })),
        resources: {
          cpuLimit: String((c.resources as Record<string, Record<string, string>>)?.limits?.cpu ?? "1"),
          memoryLimit: String((c.resources as Record<string, Record<string, string>>)?.limits?.memory ?? "512Mi"),
        },
      })),
      scaling: {
        minInstanceCount: Number(scaling.minInstanceCount ?? 0),
        maxInstanceCount: Number(scaling.maxInstanceCount ?? 100),
      },
      serviceAccount: String(raw.serviceAccount ?? ""),
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createContainerManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpContainerManager {
  return new GcpContainerManager(projectId, getAccessToken, retryOptions);
}
