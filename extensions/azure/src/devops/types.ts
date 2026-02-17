/**
 * Azure DevOps — Type Definitions
 */

export type DevOpsProject = {
  id: string;
  name: string;
  description?: string;
  url: string;
  state: string;
  visibility: string;
  lastUpdateTime?: string;
};

export type Pipeline = {
  id: number;
  name: string;
  projectId: string;
  folder: string;
  url: string;
  revision?: number;
};

export type PipelineRun = {
  id: number;
  name: string;
  pipelineId: number;
  state: string;
  result?: string;
  createdDate?: string;
  finishedDate?: string;
  url: string;
  templateParameters?: Record<string, string>;
};

export type Repository = {
  id: string;
  name: string;
  projectId: string;
  url: string;
  defaultBranch?: string;
  size?: number;
  remoteUrl?: string;
  sshUrl?: string;
  webUrl?: string;
};

export type BuildDefinition = {
  id: number;
  name: string;
  projectId: string;
  path: string;
  type: string;
  createdDate?: string;
  queueStatus?: string;
};
