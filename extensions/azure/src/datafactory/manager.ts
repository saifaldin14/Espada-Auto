/**
 * Azure Data Factory Manager
 *
 * Manages Data Factory instances, pipelines, datasets, and
 * linked services via @azure/arm-datafactory.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  DataFactory,
  DataFactoryPipeline,
  DataFactoryPipelineRun,
  DataFactoryDataset,
  DataFactoryLinkedService,
} from "./types.js";

export class AzureDataFactoryManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    retryOptions?: AzureRetryOptions,
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions ?? {};
  }

  private async getClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { DataFactoryManagementClient } = await import("@azure/arm-datafactory");
    return new DataFactoryManagementClient(credential, this.subscriptionId);
  }

  private extractResourceGroup(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i);
    return match ? match[1] : "";
  }

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /** List Data Factory instances. */
  async listFactories(resourceGroup?: string): Promise<DataFactory[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const factories: DataFactory[] = [];
      const iter = resourceGroup
        ? client.factories.listByResourceGroup(resourceGroup)
        : client.factories.list();

      for await (const f of iter) {
        factories.push(this.mapFactory(f));
      }
      return factories;
    }, this.retryOptions);
  }

  /** Get a specific Data Factory. */
  async getFactory(resourceGroup: string, name: string): Promise<DataFactory | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const f = await client.factories.get(resourceGroup, name);
        return this.mapFactory(f, resourceGroup);
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete a Data Factory. */
  async deleteFactory(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.factories.delete(resourceGroup, name),
      this.retryOptions,
    );
  }

  // ---------------------------------------------------------------------------
  // Pipelines
  // ---------------------------------------------------------------------------

  /** List pipelines in a Data Factory. */
  async listPipelines(resourceGroup: string, factoryName: string): Promise<DataFactoryPipeline[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const pipelines: DataFactoryPipeline[] = [];
      for await (const p of client.pipelines.listByFactory(resourceGroup, factoryName)) {
        const raw = p as {
          id?: string; name?: string; description?: string;
          activities?: unknown[]; parameters?: Record<string, unknown>;
          concurrency?: number; folder?: { name?: string };
        };
        pipelines.push({
          id: raw.id ?? "",
          name: raw.name ?? "",
          description: raw.description,
          activitiesCount: raw.activities?.length ?? 0,
          parameters: raw.parameters,
          concurrency: raw.concurrency,
          folderName: raw.folder?.name,
        });
      }
      return pipelines;
    }, this.retryOptions);
  }

  /** List recent pipeline runs. */
  async listPipelineRuns(
    resourceGroup: string,
    factoryName: string,
    lastUpdatedAfter: Date,
    lastUpdatedBefore: Date,
  ): Promise<DataFactoryPipelineRun[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const resp = await client.pipelineRuns.queryByFactory(resourceGroup, factoryName, {
        lastUpdatedAfter,
        lastUpdatedBefore,
      });
      return (resp.value ?? []).map((r) => {
        const run = r as {
          runId?: string; pipelineName?: string; status?: string;
          message?: string; runStart?: Date; runEnd?: Date;
          durationInMs?: number; lastUpdated?: Date;
          invokedBy?: { name?: string; invokedByType?: string };
          parameters?: Record<string, string>;
        };
        return {
          runId: run.runId ?? "",
          pipelineName: run.pipelineName,
          status: run.status,
          message: run.message,
          runStart: run.runStart?.toISOString(),
          runEnd: run.runEnd?.toISOString(),
          durationInMs: run.durationInMs,
          invokedByName: run.invokedBy?.name,
          invokedByType: run.invokedBy?.invokedByType,
          lastUpdated: run.lastUpdated?.toISOString(),
          parameters: run.parameters,
        };
      });
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Datasets
  // ---------------------------------------------------------------------------

  /** List datasets in a Data Factory. */
  async listDatasets(resourceGroup: string, factoryName: string): Promise<DataFactoryDataset[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const datasets: DataFactoryDataset[] = [];
      for await (const d of client.datasets.listByFactory(resourceGroup, factoryName)) {
        const raw = d as {
          id?: string; name?: string;
          properties?: {
            type?: string; description?: string;
            linkedServiceName?: { referenceName?: string };
            folder?: { name?: string };
          };
        };
        datasets.push({
          id: raw.id ?? "",
          name: raw.name ?? "",
          type: raw.properties?.type,
          description: raw.properties?.description,
          linkedServiceName: raw.properties?.linkedServiceName?.referenceName,
          folderName: raw.properties?.folder?.name,
        });
      }
      return datasets;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Linked Services
  // ---------------------------------------------------------------------------

  /** List linked services in a Data Factory. */
  async listLinkedServices(resourceGroup: string, factoryName: string): Promise<DataFactoryLinkedService[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const services: DataFactoryLinkedService[] = [];
      for await (const ls of client.linkedServices.listByFactory(resourceGroup, factoryName)) {
        const raw = ls as {
          id?: string; name?: string;
          properties?: {
            type?: string; description?: string;
            connectVia?: { referenceName?: string };
          };
        };
        services.push({
          id: raw.id ?? "",
          name: raw.name ?? "",
          type: raw.properties?.type,
          description: raw.properties?.description,
          connectVia: raw.properties?.connectVia?.referenceName,
        });
      }
      return services;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private mapFactory(f: unknown, rg?: string): DataFactory {
    const factory = f as {
      id?: string; name?: string; location?: string;
      provisioningState?: string; createTime?: Date; version?: string;
      publicNetworkAccess?: string;
      repoConfiguration?: {
        type?: string; accountName?: string; repositoryName?: string;
        collaborationBranch?: string; rootFolder?: string; projectName?: string;
      };
      globalParameters?: Record<string, { type?: string; value?: unknown }>;
      tags?: Record<string, string>;
    };

    return {
      id: factory.id ?? "",
      name: factory.name ?? "",
      resourceGroup: rg ?? this.extractResourceGroup(factory.id ?? ""),
      location: factory.location ?? "",
      provisioningState: factory.provisioningState,
      createTime: factory.createTime?.toISOString(),
      version: factory.version,
      publicNetworkAccess: factory.publicNetworkAccess,
      repoConfiguration: factory.repoConfiguration
        ? {
            type: factory.repoConfiguration.type,
            accountName: factory.repoConfiguration.accountName,
            repositoryName: factory.repoConfiguration.repositoryName,
            collaborationBranch: factory.repoConfiguration.collaborationBranch,
            rootFolder: factory.repoConfiguration.rootFolder,
            projectName: factory.repoConfiguration.projectName,
          }
        : undefined,
      globalParameters: factory.globalParameters
        ? Object.fromEntries(
            Object.entries(factory.globalParameters).map(([k, v]) => [k, { type: v.type, value: v.value }]),
          )
        : undefined,
      tags: factory.tags as Record<string, string>,
    };
  }
}

export function createDataFactoryManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureDataFactoryManager {
  return new AzureDataFactoryManager(credentialsManager, subscriptionId, retryOptions);
}
