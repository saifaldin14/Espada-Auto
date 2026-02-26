/**
 * Azure DevOps Manager
 *
 * Manages DevOps projects, pipelines, and pipeline runs via REST API.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { DevOpsProject, Pipeline, PipelineRun, Repository } from "./types.js";

export class AzureDevOpsManager {
  private credentialsManager: AzureCredentialsManager;
  private organization: string;
  private retryOptions?: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    organization: string,
    retryOptions?: AzureRetryOptions
  ) {
    this.credentialsManager = credentialsManager;
    this.organization = organization;
    this.retryOptions = retryOptions;
  }

  private async fetchDevOps<T>(path: string): Promise<T> {
    const { credential } = await this.credentialsManager.getCredential();
    const token = await credential.getToken("499b84ac-1321-427f-aa17-267ca6975798/.default");
    const url = `https://dev.azure.com/${this.organization}/${path}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token?.token}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`DevOps API error: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  async listProjects(): Promise<DevOpsProject[]> {
    return withAzureRetry(async () => {
      const data = await this.fetchDevOps<{ value: Record<string, unknown>[] }>("_apis/projects?api-version=7.1");
      return (data.value ?? []).map((p) => ({
        id: p.id ?? "",
        name: p.name ?? "",
        description: p.description,
        url: p.url ?? "",
        state: p.state ?? "",
        visibility: p.visibility ?? "",
        lastUpdateTime: p.lastUpdateTime,
      }));
    }, this.retryOptions);
  }

  async listPipelines(projectName: string): Promise<Pipeline[]> {
    return withAzureRetry(async () => {
      const data = await this.fetchDevOps<{ value: Record<string, unknown>[] }>(
        `${projectName}/_apis/pipelines?api-version=7.1`
      );
      return (data.value ?? []).map((p) => ({
        id: p.id ?? 0,
        name: p.name ?? "",
        projectId: projectName,
        folder: p.folder ?? "",
        url: p.url ?? "",
        revision: p.revision,
      }));
    }, this.retryOptions);
  }

  async listRuns(projectName: string, pipelineId: number): Promise<PipelineRun[]> {
    return withAzureRetry(async () => {
      const data = await this.fetchDevOps<{ value: Record<string, unknown>[] }>(
        `${projectName}/_apis/pipelines/${pipelineId}/runs?api-version=7.1`
      );
      return (data.value ?? []).map((r) => ({
        id: r.id ?? 0,
        name: r.name ?? "",
        pipelineId,
        state: r.state ?? "",
        result: r.result,
        createdDate: r.createdDate,
        finishedDate: r.finishedDate,
        url: r.url ?? "",
        templateParameters: r.templateParameters,
      }));
    }, this.retryOptions);
  }

  async triggerPipeline(
    projectName: string,
    pipelineId: number,
    options?: { branch?: string; parameters?: Record<string, string> }
  ): Promise<PipelineRun> {
    const { credential } = await this.credentialsManager.getCredential();
    const token = await credential.getToken("499b84ac-1321-427f-aa17-267ca6975798/.default");
    const url = `https://dev.azure.com/${this.organization}/${projectName}/_apis/pipelines/${pipelineId}/runs?api-version=7.1`;
    const body = {
      resources: { repositories: { self: { refName: `refs/heads/${options?.branch ?? "main"}` } } },
      templateParameters: options?.parameters,
    };
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token?.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`DevOps API error: ${response.status} ${response.statusText}`);
    }
    const r = (await response.json()) as Record<string, unknown>;
    return {
      id: (r.id as number) ?? 0,
      name: (r.name as string) ?? "",
      pipelineId,
      state: (r.state as string) ?? "",
      result: r.result as string | undefined,
      createdDate: r.createdDate as string | undefined,
      url: (r.url as string) ?? "",
      templateParameters: r.templateParameters as Record<string, string> | undefined,
    };
  }

  async listRepositories(projectName: string): Promise<Repository[]> {
    return withAzureRetry(async () => {
      const data = await this.fetchDevOps<{ value: Record<string, unknown>[] }>(
        `${projectName}/_apis/git/repositories?api-version=7.1`
      );
      return (data.value ?? []).map((r) => ({
        id: r.id ?? "",
        name: r.name ?? "",
        projectId: projectName,
        url: r.url ?? "",
        defaultBranch: r.defaultBranch,
        size: r.size,
        remoteUrl: r.remoteUrl,
        sshUrl: r.sshUrl,
        webUrl: r.webUrl,
      }));
    }, this.retryOptions);
  }
}

export function createDevOpsManager(
  credentialsManager: AzureCredentialsManager,
  organization: string,
  retryOptions?: AzureRetryOptions
): AzureDevOpsManager {
  return new AzureDevOpsManager(credentialsManager, organization, retryOptions);
}
