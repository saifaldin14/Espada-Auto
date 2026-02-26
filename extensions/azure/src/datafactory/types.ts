/**
 * Azure Data Factory types.
 */

/** Data Factory instance. */
export interface DataFactory {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  provisioningState?: string;
  createTime?: string;
  version?: string;
  publicNetworkAccess?: string;
  repoConfiguration?: DataFactoryRepoConfig;
  globalParameters?: Record<string, DataFactoryGlobalParam>;
  tags?: Record<string, string>;
}

export interface DataFactoryRepoConfig {
  type?: string;
  accountName?: string;
  repositoryName?: string;
  collaborationBranch?: string;
  rootFolder?: string;
  projectName?: string;
}

export interface DataFactoryGlobalParam {
  type?: string;
  value?: unknown;
}

/** Data Factory pipeline. */
export interface DataFactoryPipeline {
  id: string;
  name: string;
  description?: string;
  activitiesCount: number;
  parameters?: Record<string, unknown>;
  concurrency?: number;
  folderName?: string;
}

/** Data Factory pipeline run. */
export interface DataFactoryPipelineRun {
  runId: string;
  pipelineName?: string;
  status?: string;
  message?: string;
  runStart?: string;
  runEnd?: string;
  durationInMs?: number;
  invokedByName?: string;
  invokedByType?: string;
  lastUpdated?: string;
  parameters?: Record<string, string>;
}

/** Data Factory dataset. */
export interface DataFactoryDataset {
  id: string;
  name: string;
  type?: string;
  description?: string;
  linkedServiceName?: string;
  folderName?: string;
}

/** Data Factory linked service. */
export interface DataFactoryLinkedService {
  id: string;
  name: string;
  type?: string;
  connectVia?: string;
  description?: string;
}
