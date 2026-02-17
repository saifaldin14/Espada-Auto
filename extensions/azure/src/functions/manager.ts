/**
 * Azure Functions Manager
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { FunctionApp, FunctionCreateOptions } from "./types.js";

export class AzureFunctionsManager {
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

  private async getWebClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { WebSiteManagementClient } = await import("@azure/arm-appservice");
    return new WebSiteManagementClient(credential, this.subscriptionId);
  }

  async listFunctionApps(resourceGroup?: string): Promise<FunctionApp[]> {
    const client = await this.getWebClient();
    return withAzureRetry(async () => {
      const apps: FunctionApp[] = [];
      const iterator = resourceGroup
        ? client.webApps.listByResourceGroup(resourceGroup)
        : client.webApps.list();

      for await (const app of iterator) {
        if (app.kind?.includes("functionapp")) {
          apps.push({
            id: app.id ?? "",
            name: app.name ?? "",
            resourceGroup: this.extractResourceGroup(app.id ?? ""),
            location: app.location ?? "",
            state: app.state ?? "Unknown",
            defaultHostName: app.defaultHostName ?? "",
            httpsOnly: app.httpsOnly ?? false,
            functions: [],
            tags: app.tags as Record<string, string>,
          });
        }
      }
      return apps;
    }, this.retryOptions);
  }

  async getFunctionApp(resourceGroup: string, name: string): Promise<FunctionApp | null> {
    const client = await this.getWebClient();
    return withAzureRetry(async () => {
      try {
        const app = await client.webApps.get(resourceGroup, name);
        return {
          id: app.id ?? "",
          name: app.name ?? "",
          resourceGroup,
          location: app.location ?? "",
          state: app.state ?? "Unknown",
          defaultHostName: app.defaultHostName ?? "",
          httpsOnly: app.httpsOnly ?? false,
          functions: [],
          tags: app.tags as Record<string, string>,
        };
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  async startFunctionApp(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getWebClient();
    await withAzureRetry(() => client.webApps.start(resourceGroup, name), this.retryOptions);
  }

  async stopFunctionApp(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getWebClient();
    await withAzureRetry(() => client.webApps.stop(resourceGroup, name), this.retryOptions);
  }

  async restartFunctionApp(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getWebClient();
    await withAzureRetry(() => client.webApps.restart(resourceGroup, name), this.retryOptions);
  }

  async deleteFunctionApp(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getWebClient();
    await withAzureRetry(
      () => client.webApps.delete(resourceGroup, name),
      this.retryOptions,
    );
  }

  private extractResourceGroup(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i);
    return match ? match[1] : "";
  }
}

export function createFunctionsManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureFunctionsManager {
  return new AzureFunctionsManager(credentialsManager, subscriptionId, retryOptions);
}
