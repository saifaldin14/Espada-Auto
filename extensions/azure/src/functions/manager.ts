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

  /**
   * Create a function app.
   */
  async createFunctionApp(options: FunctionCreateOptions): Promise<FunctionApp> {
    const client = await this.getWebClient();
    return withAzureRetry(async () => {
      const app = await client.webApps.beginCreateOrUpdateAndWait(
        options.resourceGroup,
        options.name,
        {
          location: options.location,
          kind: "functionapp",
          siteConfig: {
            appSettings: [
              { name: "FUNCTIONS_WORKER_RUNTIME", value: options.runtime },
              { name: "FUNCTIONS_EXTENSION_VERSION", value: options.runtimeVersion ?? "~4" },
              { name: "AzureWebJobsStorage", value: `DefaultEndpointsProtocol=https;AccountName=${options.storageAccountName}` },
            ],
          },
          httpsOnly: true,
          tags: options.tags,
        },
      );
      return {
        id: app.id ?? "", name: app.name ?? "",
        resourceGroup: options.resourceGroup, location: app.location ?? "",
        state: app.state ?? "Unknown", defaultHostName: app.defaultHostName ?? "",
        httpsOnly: app.httpsOnly ?? true, runtime: options.runtime, functions: [],
        tags: app.tags as Record<string, string>,
      };
    }, this.retryOptions);
  }

  /**
   * List functions within a function app.
   */
  async listFunctions(resourceGroup: string, name: string): Promise<string[]> {
    const client = await this.getWebClient();
    return withAzureRetry(async () => {
      const functions: string[] = [];
      for await (const fn of client.webApps.listFunctions(resourceGroup, name)) {
        functions.push(fn.name ?? "");
      }
      return functions;
    }, this.retryOptions);
  }

  /**
   * Get app settings for a function app.
   */
  async getAppSettings(resourceGroup: string, name: string): Promise<Record<string, string>> {
    const client = await this.getWebClient();
    return withAzureRetry(async () => {
      const settings = await client.webApps.listApplicationSettings(resourceGroup, name);
      return (settings.properties ?? {}) as Record<string, string>;
    }, this.retryOptions);
  }

  /**
   * Update app settings for a function app (merge with existing).
   */
  async updateAppSettings(resourceGroup: string, name: string, settings: Record<string, string>): Promise<Record<string, string>> {
    const client = await this.getWebClient();
    return withAzureRetry(async () => {
      const existing = await client.webApps.listApplicationSettings(resourceGroup, name);
      const merged = { ...existing.properties, ...settings };
      const result = await client.webApps.updateApplicationSettings(resourceGroup, name, {
        properties: merged,
      });
      return (result.properties ?? {}) as Record<string, string>;
    }, this.retryOptions);
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
