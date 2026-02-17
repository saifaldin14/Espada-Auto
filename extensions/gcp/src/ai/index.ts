/**
 * GCP Extension — Vertex AI Manager
 *
 * Manages AI models, endpoints, and datasets via Vertex AI.
 * No real SDK imports — placeholder methods mirror the Azure extension pattern.
 */

import type { GcpRetryOptions } from "../types.js";
import { withGcpRetry } from "../retry.js";

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
  private retryOptions: GcpRetryOptions;

  constructor(projectId: string, retryOptions?: GcpRetryOptions) {
    this.projectId = projectId;
    this.retryOptions = retryOptions ?? {};
  }

  /** List AI models, optionally in a specific location. */
  async listModels(opts?: { location?: string }): Promise<GcpAIModel[]> {
    return withGcpRetry(async () => {
      const loc = opts?.location ?? "us-central1";
      const _endpoint = `https://${loc}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${loc}/models`;
      return [] as GcpAIModel[];
    }, this.retryOptions);
  }

  /** Get a single AI model by location and model ID. */
  async getModel(location: string, modelId: string): Promise<GcpAIModel> {
    return withGcpRetry(async () => {
      const _endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${location}/models/${modelId}`;
      throw new Error(`Model ${modelId} not found in ${location} (placeholder)`);
    }, this.retryOptions);
  }

  /** List AI endpoints, optionally in a specific location. */
  async listEndpoints(opts?: { location?: string }): Promise<GcpAIEndpoint[]> {
    return withGcpRetry(async () => {
      const loc = opts?.location ?? "us-central1";
      const _endpoint = `https://${loc}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${loc}/endpoints`;
      return [] as GcpAIEndpoint[];
    }, this.retryOptions);
  }

  /** Get a single AI endpoint by location and endpoint ID. */
  async getEndpoint(location: string, endpointId: string): Promise<GcpAIEndpoint> {
    return withGcpRetry(async () => {
      const _endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${location}/endpoints/${endpointId}`;
      throw new Error(`Endpoint ${endpointId} not found in ${location} (placeholder)`);
    }, this.retryOptions);
  }

  /** List AI datasets, optionally in a specific location. */
  async listDatasets(opts?: { location?: string }): Promise<GcpAIDataset[]> {
    return withGcpRetry(async () => {
      const loc = opts?.location ?? "us-central1";
      const _endpoint = `https://${loc}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${loc}/datasets`;
      return [] as GcpAIDataset[];
    }, this.retryOptions);
  }
}
