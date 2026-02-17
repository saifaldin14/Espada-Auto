/**
 * Azure Logic Apps Manager
 *
 * Manages Logic App workflows, runs, and triggers via @azure/arm-logic.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { LogicAppWorkflow, LogicAppRun, LogicAppTrigger } from "./types.js";

export class AzureLogicAppsManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions?: AzureRetryOptions;

  constructor(
    credentialsManager: AzureCredentialsManager,
    subscriptionId: string,
    retryOptions?: AzureRetryOptions
  ) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions;
  }

  private async getClient() {
    const { LogicManagementClient } = await import("@azure/arm-logic");
    const { credential } = await this.credentialsManager.getCredential();
    return new LogicManagementClient(credential, this.subscriptionId);
  }

  async listWorkflows(resourceGroup?: string): Promise<LogicAppWorkflow[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: LogicAppWorkflow[] = [];
      const iter = resourceGroup
        ? client.workflows.listByResourceGroup(resourceGroup)
        : client.workflows.listBySubscription();
      for await (const w of iter) {
        results.push({
          id: w.id ?? "",
          name: w.name ?? "",
          resourceGroup: w.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: w.location ?? "",
          state: (w.state as any) ?? "Enabled",
          version: w.version,
          accessEndpoint: w.accessEndpoint,
          provisioningState: w.provisioningState,
          createdTime: w.createdTime?.toISOString(),
          changedTime: w.changedTime?.toISOString(),
          sku: w.sku?.name,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async getWorkflow(resourceGroup: string, workflowName: string): Promise<LogicAppWorkflow> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const w = await client.workflows.get(resourceGroup, workflowName);
      return {
        id: w.id ?? "",
        name: w.name ?? "",
        resourceGroup,
        location: w.location ?? "",
        state: (w.state as any) ?? "Enabled",
        version: w.version,
        accessEndpoint: w.accessEndpoint,
        provisioningState: w.provisioningState,
        createdTime: w.createdTime?.toISOString(),
        changedTime: w.changedTime?.toISOString(),
        sku: w.sku?.name,
      };
    }, this.retryOptions);
  }

  async listRuns(resourceGroup: string, workflowName: string): Promise<LogicAppRun[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: LogicAppRun[] = [];
      for await (const r of client.workflowRuns.list(resourceGroup, workflowName)) {
        results.push({
          id: r.id ?? "",
          name: r.name ?? "",
          workflowName,
          status: r.status ?? "",
          startTime: r.startTime?.toISOString(),
          endTime: r.endTime?.toISOString(),
          error: r.error ? { code: r.error.code ?? "", message: r.error.message ?? "" } : undefined,
          correlation: r.correlation
            ? { clientTrackingId: r.correlation.clientTrackingId ?? "" }
            : undefined,
          trigger: r.trigger
            ? {
                name: r.trigger.name ?? "",
                startTime: r.trigger.startTime?.toISOString(),
                endTime: r.trigger.endTime?.toISOString(),
                status: r.trigger.status,
              }
            : undefined,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listTriggers(resourceGroup: string, workflowName: string): Promise<LogicAppTrigger[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: LogicAppTrigger[] = [];
      for await (const t of client.workflowTriggers.list(resourceGroup, workflowName)) {
        results.push({
          id: t.id ?? "",
          name: t.name ?? "",
          workflowName,
          type: t.type ?? "",
          state: (t.state as any) ?? "Enabled",
          provisioningState: t.provisioningState,
          createdTime: t.createdTime?.toISOString(),
          changedTime: t.changedTime?.toISOString(),
          lastExecutionTime: t.lastExecutionTime?.toISOString(),
          nextExecutionTime: t.nextExecutionTime?.toISOString(),
          recurrence: t.recurrence
            ? { frequency: t.recurrence.frequency ?? "", interval: t.recurrence.interval ?? 0 }
            : undefined,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async enableWorkflow(resourceGroup: string, workflowName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.workflows.enable(resourceGroup, workflowName);
    }, this.retryOptions);
  }

  async disableWorkflow(resourceGroup: string, workflowName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.workflows.disable(resourceGroup, workflowName);
    }, this.retryOptions);
  }
}

export function createLogicAppsManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureLogicAppsManager {
  return new AzureLogicAppsManager(credentialsManager, subscriptionId, retryOptions);
}
