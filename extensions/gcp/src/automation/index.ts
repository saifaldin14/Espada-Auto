/**
 * GCP Automation Manager
 *
 * Manages Cloud Workflows, Eventarc triggers, and Cloud Scheduler jobs
 * for event-driven automation.
 */

import type { GcpRetryOptions, GcpOperationResult } from "../types.js";
import { withGcpRetry } from "../retry.js";
import { gcpRequest, gcpList, gcpMutate } from "../api.js";

// =============================================================================
// Types
// =============================================================================

export type WorkflowState = "ACTIVE" | "UNAVAILABLE" | "STATE_UNSPECIFIED";

export type WorkflowInfo = {
  name: string;
  description: string;
  state: WorkflowState;
  revisionId: string;
  serviceAccount: string;
  sourceContents?: string;
  createTime: string;
  updateTime: string;
  labels: Record<string, string>;
};

export type CreateWorkflowOptions = {
  location: string;
  workflowId: string;
  description?: string;
  serviceAccount?: string;
  sourceContents: string;
  labels?: Record<string, string>;
};

export type WorkflowExecutionState = "ACTIVE" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNAVAILABLE";

export type WorkflowExecution = {
  name: string;
  state: WorkflowExecutionState;
  startTime: string;
  endTime?: string;
  duration?: string;
  result?: string;
  error?: { message: string; context: string };
  argument?: string;
  workflowRevisionId: string;
};

export type EventarcTriggerState = "ACTIVE" | "PENDING" | "STATE_UNSPECIFIED";

export type EventFilter = {
  attribute: string;
  value: string;
  operator?: string;
};

export type EventarcTrigger = {
  name: string;
  eventType: string;
  filters: EventFilter[];
  serviceAccount: string;
  destination: string;
  state: EventarcTriggerState;
  createTime: string;
  updateTime: string;
  labels: Record<string, string>;
};

export type CreateTriggerOptions = {
  location: string;
  triggerId: string;
  eventType: string;
  filters?: EventFilter[];
  destination: {
    type: "workflow" | "cloud-run" | "cloud-function" | "gke";
    resource: string;
  };
  serviceAccount?: string;
  labels?: Record<string, string>;
};

export type SchedulerJobState = "ENABLED" | "PAUSED" | "DISABLED" | "UPDATE_FAILED";

export type SchedulerJob = {
  name: string;
  description: string;
  schedule: string;
  timeZone: string;
  state: SchedulerJobState;
  lastAttemptTime?: string;
  nextRunTime?: string;
  target: {
    type: "http" | "pubsub" | "appengine";
    uri?: string;
    topicName?: string;
    httpMethod?: string;
  };
  retryConfig?: {
    retryCount: number;
    maxRetryDuration: string;
    minBackoff: string;
    maxBackoff: string;
  };
};

export type CreateSchedulerJobOptions = {
  location: string;
  jobId: string;
  description?: string;
  schedule: string;
  timeZone?: string;
  target: {
    type: "http" | "pubsub";
    uri?: string;
    topicName?: string;
    httpMethod?: string;
    body?: string;
    headers?: Record<string, string>;
  };
  retryCount?: number;
};

// =============================================================================
// Manager
// =============================================================================

const WORKFLOWS_BASE = "https://workflowexecutions.googleapis.com/v1";
const WORKFLOWS_DEF_BASE = "https://workflows.googleapis.com/v1";
const EVENTARC_BASE = "https://eventarc.googleapis.com/v1";
const SCHEDULER_BASE = "https://cloudscheduler.googleapis.com/v1";

export class GcpAutomationManager {
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
      service: "automation",
      projectId: this.projectId,
    };
  }

  // ---------------------------------------------------------------------------
  // Cloud Workflows
  // ---------------------------------------------------------------------------

  async listWorkflows(location: string): Promise<WorkflowInfo[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${WORKFLOWS_DEF_BASE}/projects/${this.projectId}/locations/${location}/workflows`;
      const items = await gcpList<Record<string, unknown>>(url, token, "workflows");
      return items.map((w) => this.mapWorkflow(w));
    }, this.retryOptions);
  }

  async getWorkflow(location: string, workflowId: string): Promise<WorkflowInfo> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${WORKFLOWS_DEF_BASE}/projects/${this.projectId}/locations/${location}/workflows/${workflowId}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapWorkflow(raw);
    }, this.retryOptions);
  }

  async createWorkflow(opts: CreateWorkflowOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${WORKFLOWS_DEF_BASE}/projects/${this.projectId}/locations/${opts.location}/workflows?workflowId=${encodeURIComponent(opts.workflowId)}`;
      const body = {
        description: opts.description ?? "",
        serviceAccount: opts.serviceAccount,
        sourceContents: opts.sourceContents,
        labels: opts.labels ?? {},
      };
      const result = await gcpMutate(url, token, body);
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  async deleteWorkflow(location: string, workflowId: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${WORKFLOWS_DEF_BASE}/projects/${this.projectId}/locations/${location}/workflows/${workflowId}`;
      const result = await gcpMutate(url, token, undefined, "DELETE");
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  async executeWorkflow(
    location: string,
    workflowId: string,
    argument?: Record<string, unknown>,
  ): Promise<WorkflowExecution> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${WORKFLOWS_BASE}/projects/${this.projectId}/locations/${location}/workflows/${workflowId}/executions`;
      const body = argument ? { argument: JSON.stringify(argument) } : {};
      const raw = await gcpRequest<Record<string, unknown>>(url, token, { method: "POST", body });
      return this.mapExecution(raw);
    }, this.retryOptions);
  }

  async listExecutions(location: string, workflowId: string): Promise<WorkflowExecution[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${WORKFLOWS_BASE}/projects/${this.projectId}/locations/${location}/workflows/${workflowId}/executions`;
      const items = await gcpList<Record<string, unknown>>(url, token, "executions");
      return items.map((e) => this.mapExecution(e));
    }, this.retryOptions);
  }

  async getExecution(executionName: string): Promise<WorkflowExecution> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${WORKFLOWS_BASE}/${executionName}`;
      const raw = await gcpRequest<Record<string, unknown>>(url, token);
      return this.mapExecution(raw);
    }, this.retryOptions);
  }

  async cancelExecution(executionName: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${WORKFLOWS_BASE}/${executionName}:cancel`;
      await gcpRequest(url, token, { method: "POST", body: {} });
      return { success: true, message: "Execution cancelled" };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Eventarc Triggers
  // ---------------------------------------------------------------------------

  async listTriggers(location: string): Promise<EventarcTrigger[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${EVENTARC_BASE}/projects/${this.projectId}/locations/${location}/triggers`;
      const items = await gcpList<Record<string, unknown>>(url, token, "triggers");
      return items.map((t) => this.mapTrigger(t));
    }, this.retryOptions);
  }

  async createTrigger(opts: CreateTriggerOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${EVENTARC_BASE}/projects/${this.projectId}/locations/${opts.location}/triggers?triggerId=${encodeURIComponent(opts.triggerId)}`;
      const destination = this.buildDestination(opts.destination);
      const body = {
        eventFilters: [
          { attribute: "type", value: opts.eventType },
          ...(opts.filters ?? []),
        ],
        destination,
        serviceAccount: opts.serviceAccount,
        labels: opts.labels ?? {},
      };
      const result = await gcpMutate(url, token, body);
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  async deleteTrigger(location: string, triggerId: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${EVENTARC_BASE}/projects/${this.projectId}/locations/${location}/triggers/${triggerId}`;
      const result = await gcpMutate(url, token, undefined, "DELETE");
      return { success: true, message: result.message, operationId: result.operationId };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Cloud Scheduler
  // ---------------------------------------------------------------------------

  async listSchedulerJobs(location: string): Promise<SchedulerJob[]> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SCHEDULER_BASE}/projects/${this.projectId}/locations/${location}/jobs`;
      const items = await gcpList<Record<string, unknown>>(url, token, "jobs");
      return items.map((j) => this.mapSchedulerJob(j));
    }, this.retryOptions);
  }

  async createSchedulerJob(opts: CreateSchedulerJobOptions): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SCHEDULER_BASE}/projects/${this.projectId}/locations/${opts.location}/jobs`;
      const body: Record<string, unknown> = {
        name: `projects/${this.projectId}/locations/${opts.location}/jobs/${opts.jobId}`,
        description: opts.description ?? "",
        schedule: opts.schedule,
        timeZone: opts.timeZone ?? "UTC",
      };

      if (opts.target.type === "http") {
        body.httpTarget = {
          uri: opts.target.uri,
          httpMethod: opts.target.httpMethod ?? "POST",
          body: opts.target.body ? btoa(opts.target.body) : undefined,
          headers: opts.target.headers,
        };
      } else if (opts.target.type === "pubsub") {
        body.pubsubTarget = {
          topicName: opts.target.topicName,
          data: opts.target.body ? btoa(opts.target.body) : undefined,
        };
      }

      if (opts.retryCount) {
        body.retryConfig = { retryCount: opts.retryCount };
      }

      const result = await gcpMutate(url, token, body);
      return { success: true, message: `Scheduler job "${opts.jobId}" created`, operationId: result.operationId };
    }, this.retryOptions);
  }

  async pauseSchedulerJob(location: string, jobId: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SCHEDULER_BASE}/projects/${this.projectId}/locations/${location}/jobs/${jobId}:pause`;
      await gcpRequest(url, token, { method: "POST", body: {} });
      return { success: true, message: `Job "${jobId}" paused` };
    }, this.retryOptions);
  }

  async resumeSchedulerJob(location: string, jobId: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SCHEDULER_BASE}/projects/${this.projectId}/locations/${location}/jobs/${jobId}:resume`;
      await gcpRequest(url, token, { method: "POST", body: {} });
      return { success: true, message: `Job "${jobId}" resumed` };
    }, this.retryOptions);
  }

  async deleteSchedulerJob(location: string, jobId: string): Promise<GcpOperationResult> {
    return withGcpRetry(async () => {
      const token = await this.getAccessToken();
      const url = `${SCHEDULER_BASE}/projects/${this.projectId}/locations/${location}/jobs/${jobId}`;
      await gcpRequest(url, token, { method: "DELETE" });
      return { success: true, message: `Job "${jobId}" deleted` };
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Private mapping helpers
  // ---------------------------------------------------------------------------

  private mapWorkflow(raw: Record<string, unknown>): WorkflowInfo {
    return {
      name: String(raw.name ?? ""),
      description: String(raw.description ?? ""),
      state: (raw.state as WorkflowState) ?? "STATE_UNSPECIFIED",
      revisionId: String(raw.revisionId ?? ""),
      serviceAccount: String(raw.serviceAccount ?? ""),
      sourceContents: raw.sourceContents ? String(raw.sourceContents) : undefined,
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      labels: (raw.labels as Record<string, string>) ?? {},
    };
  }

  private mapExecution(raw: Record<string, unknown>): WorkflowExecution {
    const error = raw.error as Record<string, unknown> | undefined;
    return {
      name: String(raw.name ?? ""),
      state: (raw.state as WorkflowExecutionState) ?? "UNAVAILABLE",
      startTime: String(raw.startTime ?? ""),
      endTime: raw.endTime ? String(raw.endTime) : undefined,
      duration: raw.duration ? String(raw.duration) : undefined,
      result: raw.result ? String(raw.result) : undefined,
      error: error ? { message: String(error.message ?? ""), context: String(error.context ?? "") } : undefined,
      argument: raw.argument ? String(raw.argument) : undefined,
      workflowRevisionId: String(raw.workflowRevisionId ?? ""),
    };
  }

  private mapTrigger(raw: Record<string, unknown>): EventarcTrigger {
    const filters = (raw.eventFilters ?? []) as Array<Record<string, unknown>>;
    const destination = raw.destination as Record<string, unknown> | undefined;

    return {
      name: String(raw.name ?? ""),
      eventType: filters.find((f) => f.attribute === "type")?.value as string ?? "",
      filters: filters.map((f) => ({
        attribute: String(f.attribute ?? ""),
        value: String(f.value ?? ""),
        operator: f.operator ? String(f.operator) : undefined,
      })),
      serviceAccount: String(raw.serviceAccount ?? ""),
      destination: String(destination?.workflow ?? destination?.cloudRun ?? destination?.cloudFunction ?? ""),
      state: (raw.state as EventarcTriggerState) ?? "STATE_UNSPECIFIED",
      createTime: String(raw.createTime ?? ""),
      updateTime: String(raw.updateTime ?? ""),
      labels: (raw.labels as Record<string, string>) ?? {},
    };
  }

  private mapSchedulerJob(raw: Record<string, unknown>): SchedulerJob {
    const httpTarget = raw.httpTarget as Record<string, unknown> | undefined;
    const pubsubTarget = raw.pubsubTarget as Record<string, unknown> | undefined;
    const retryConfig = raw.retryConfig as Record<string, unknown> | undefined;

    let target: SchedulerJob["target"];
    if (httpTarget) {
      target = { type: "http", uri: String(httpTarget.uri ?? ""), httpMethod: String(httpTarget.httpMethod ?? "POST") };
    } else if (pubsubTarget) {
      target = { type: "pubsub", topicName: String(pubsubTarget.topicName ?? "") };
    } else {
      target = { type: "http" };
    }

    return {
      name: String(raw.name ?? ""),
      description: String(raw.description ?? ""),
      schedule: String(raw.schedule ?? ""),
      timeZone: String(raw.timeZone ?? "UTC"),
      state: (raw.state as SchedulerJobState) ?? "ENABLED",
      lastAttemptTime: raw.lastAttemptTime ? String(raw.lastAttemptTime) : undefined,
      nextRunTime: raw.scheduleTime ? String(raw.scheduleTime) : undefined,
      target,
      retryConfig: retryConfig
        ? {
            retryCount: Number(retryConfig.retryCount ?? 0),
            maxRetryDuration: String(retryConfig.maxRetryDuration ?? ""),
            minBackoff: String(retryConfig.minBackoffDuration ?? ""),
            maxBackoff: String(retryConfig.maxBackoffDuration ?? ""),
          }
        : undefined,
    };
  }

  private buildDestination(dest: CreateTriggerOptions["destination"]): Record<string, unknown> {
    switch (dest.type) {
      case "workflow":
        return { workflow: dest.resource };
      case "cloud-run":
        return { cloudRun: { service: dest.resource } };
      case "cloud-function":
        return { cloudFunction: dest.resource };
      case "gke":
        return { gke: { cluster: dest.resource } };
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createAutomationManager(
  projectId: string,
  getAccessToken: () => Promise<string>,
  retryOptions?: GcpRetryOptions,
): GcpAutomationManager {
  return new GcpAutomationManager(projectId, getAccessToken, retryOptions);
}
