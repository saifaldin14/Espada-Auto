/**
 * GCP Extension — Vertex AI Manager
 *
 * Manages AI models, endpoints, and datasets via Vertex AI REST API.
 */

import type { GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList } from "../api.js";

// =============================================================================
// Types
// =============================================================================

/** A Vertex AI model. */
export type GcpAIModel = {
  name: string;
  displayName: string;
  description: string;
  createTime: string;
  labels: Record<string, string>;
  supportedDeploymentResourcesTypes: string[];
};

/** A Vertex AI endpoint for serving predictions. */
export type GcpAIEndpoint = {
  name: string;
  displayName: string;
  deployedModels: Array<Record<string, unknown>>;
  createTime: string;
  labels: Record<string, string>;
};

/** A Vertex AI dataset. */
export type GcpAIDataset = {
  name: string;
  displayName: string;
  metadataSchemaUri: string;
  createTime: string;
  labels: Record<string, string>;
};

// =============================================================================
// GcpAIManager
// =============================================================================

/**
 * Manages GCP Vertex AI resources.
 *
 * Provides methods for listing and inspecting AI models, endpoints,
 * and datasets.
 */
export class GcpAIManager {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, getAccessToken: () => Promise<string>, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.getAccessToken = getAccessToken;
    this.retryOptions = retryOptions ?? {};
  }

  /** List AI models, optionally in a specific location. */
  async listModels(opts?: { location?: string }): Promise<GcpAIModel[]> {
    return withGcpRetry(async () => {
      const loc = opts?.location ?? "us-central1";
      const token = await this.getAccessToken();
      const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${loc}/models`;
      return gcpList<GcpAIModel>(url, token, "models");
    }, this.retryOptions);
  }

  /** Get a single AI model by location and model ID. */
  async getModel(location: string, modelId: string): Promise<GcpAIModel> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${location}/models/${modelId}`;
      return gcpRequest(url, token) as Promise<GcpAIModel>;
    }, this.retryOptions);
  }

  /** List AI endpoints, optionally in a specific location. */
  async listEndpoints(opts?: { location?: string }): Promise<GcpAIEndpoint[]> {
    return withGcpRetry(async () => {
      const loc = opts?.location ?? "us-central1";
      const token = await this.getAccessToken();
      const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${loc}/endpoints`;
      return gcpList<GcpAIEndpoint>(url, token, "endpoints");
    }, this.retryOptions);
  }

  /** Get a single AI endpoint by location and endpoint ID. */
  async getEndpoint(location: string, endpointId: string): Promise<GcpAIEndpoint> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${location}/endpoints/${endpointId}`;
      return gcpRequest(url, token) as Promise<GcpAIEndpoint>;
    }, this.retryOptions);
  }

  /** List AI datasets, optionally in a specific location. */
  async listDatasets(opts?: { location?: string }): Promise<GcpAIDataset[]> {
    return withGcpRetry(async () => {
      const loc = opts?.location ?? "us-central1";
      const token = await this.getAccessToken();
      const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${loc}/datasets`;
      return gcpList<GcpAIDataset>(url, token, "datasets");
    }, this.retryOptions);
  }
}
