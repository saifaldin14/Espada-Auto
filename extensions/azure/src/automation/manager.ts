/**
 * Azure Automation Manager
 *
 * Manages Automation accounts, runbooks, jobs, and schedules via @azure/arm-automation.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { AutomationAccount, Runbook, RunbookJob, Schedule } from "./types.js";

export class AzureAutomationManager {
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
    const { AutomationClient } = await import("@azure/arm-automation");
    const credential = this.credentialsManager.getCredential();
    return new AutomationClient(credential, this.subscriptionId);
  }

  async listAccounts(resourceGroup?: string): Promise<AutomationAccount[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: AutomationAccount[] = [];
      const iter = resourceGroup
        ? client.automationAccountOperations.listByResourceGroup(resourceGroup)
        : client.automationAccountOperations.list();
      for await (const a of iter) {
        results.push({
          id: a.id ?? "",
          name: a.name ?? "",
          resourceGroup: a.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: a.location ?? "",
          state: a.state as any,
          sku: a.sku?.name,
          createdTime: a.creationTime?.toISOString(),
          lastModifiedTime: a.lastModifiedTime?.toISOString(),
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listRunbooks(resourceGroup: string, accountName: string): Promise<Runbook[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: Runbook[] = [];
      for await (const rb of client.runbookOperations.listByAutomationAccount(
        resourceGroup,
        accountName
      )) {
        results.push({
          id: rb.id ?? "",
          name: rb.name ?? "",
          accountName,
          runbookType: rb.runbookType ?? "",
          state: rb.state,
          description: rb.description,
          creationTime: rb.creationTime?.toISOString(),
          lastModifiedTime: rb.lastModifiedTime?.toISOString(),
          logVerbose: rb.logVerbose,
          logProgress: rb.logProgress,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async getRunbook(
    resourceGroup: string,
    accountName: string,
    runbookName: string
  ): Promise<Runbook> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const rb = await client.runbookOperations.get(resourceGroup, accountName, runbookName);
      return {
        id: rb.id ?? "",
        name: rb.name ?? "",
        accountName,
        runbookType: rb.runbookType ?? "",
        state: rb.state,
        description: rb.description,
        creationTime: rb.creationTime?.toISOString(),
        lastModifiedTime: rb.lastModifiedTime?.toISOString(),
      };
    }, this.retryOptions);
  }

  async startRunbook(
    resourceGroup: string,
    accountName: string,
    runbookName: string,
    parameters?: Record<string, string>
  ): Promise<RunbookJob> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const jobName = `${runbookName}-${Date.now()}`;
      const result = await client.jobOperations.create(resourceGroup, accountName, jobName, {
        runbook: { name: runbookName },
        parameters,
      });
      return {
        id: result.id ?? "",
        name: result.name ?? "",
        runbookName,
        status: result.status ?? "",
        startTime: result.startTime?.toISOString(),
        creationTime: result.creationTime?.toISOString(),
        jobId: result.jobId,
      };
    }, this.retryOptions);
  }

  async listJobs(resourceGroup: string, accountName: string): Promise<RunbookJob[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: RunbookJob[] = [];
      for await (const job of client.jobOperations.listByAutomationAccount(
        resourceGroup,
        accountName
      )) {
        results.push({
          id: job.id ?? "",
          name: job.name ?? "",
          runbookName: job.runbook?.name ?? "",
          status: job.status ?? "",
          startTime: job.startTime?.toISOString(),
          endTime: job.endTime?.toISOString(),
          creationTime: job.creationTime?.toISOString(),
          exception: job.exception,
          jobId: job.jobId,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listSchedules(resourceGroup: string, accountName: string): Promise<Schedule[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: Schedule[] = [];
      for await (const s of client.scheduleOperations.listByAutomationAccount(
        resourceGroup,
        accountName
      )) {
        results.push({
          id: s.id ?? "",
          name: s.name ?? "",
          accountName,
          frequency: s.frequency ?? "",
          interval: s.interval,
          startTime: s.startTime?.toISOString(),
          nextRun: s.nextRun?.toISOString(),
          isEnabled: s.isEnabled ?? false,
          description: s.description,
        });
      }
      return results;
    }, this.retryOptions);
  }
}

export function createAutomationManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureAutomationManager {
  return new AzureAutomationManager(credentialsManager, subscriptionId, retryOptions);
}
