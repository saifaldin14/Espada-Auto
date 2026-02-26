/**
 * Azure AI / Cognitive Services Manager
 *
 * Manages Cognitive Services accounts and deployments via @azure/arm-cognitiveservices.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { CognitiveServicesAccount, CognitiveServicesDeployment, AIModel, CognitiveServicesKind } from "./types.js";

export class AzureAIManager {
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
    const { CognitiveServicesManagementClient } = await import("@azure/arm-cognitiveservices");
    const credentialResult = await this.credentialsManager.getCredential();
    const credential = credentialResult.credential || credentialResult;
    return new CognitiveServicesManagementClient(credential, this.subscriptionId);
  }

  async listAccounts(resourceGroup?: string): Promise<CognitiveServicesAccount[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: CognitiveServicesAccount[] = [];
      const iter = resourceGroup
        ? client.accounts.listByResourceGroup(resourceGroup)
        : client.accounts.list();
      for await (const a of iter) {
        results.push({
          id: a.id ?? "",
          name: a.name ?? "",
          resourceGroup: a.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: a.location ?? "",
          kind: ((a.kind ?? "CognitiveServices") as string as CognitiveServicesKind),
          sku: a.sku?.name,
          endpoint: a.properties?.endpoint,
          provisioningState: a.properties?.provisioningState,
          capabilities: a.properties?.capabilities?.map((c) => c.name ?? ""),
          customSubDomainName: a.properties?.customSubDomainName,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async getAccount(resourceGroup: string, accountName: string): Promise<CognitiveServicesAccount> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const a = await client.accounts.get(resourceGroup, accountName);
      return {
        id: a.id ?? "",
        name: a.name ?? "",
        resourceGroup,
        location: a.location ?? "",
        kind: ((a.kind ?? "CognitiveServices") as string as CognitiveServicesKind),
        sku: a.sku?.name,
        endpoint: a.properties?.endpoint,
        provisioningState: a.properties?.provisioningState,
        capabilities: a.properties?.capabilities?.map((c) => c.name ?? ""),
        customSubDomainName: a.properties?.customSubDomainName,
      };
    }, this.retryOptions);
  }

  async listDeployments(
    resourceGroup: string,
    accountName: string
  ): Promise<CognitiveServicesDeployment[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: CognitiveServicesDeployment[] = [];
      for await (const d of client.deployments.list(resourceGroup, accountName)) {
        results.push({
          id: d.id ?? "",
          name: d.name ?? "",
          accountName,
          model: {
            name: d.properties?.model?.name ?? "",
            version: d.properties?.model?.version ?? "",
            format: d.properties?.model?.format,
          },
          sku: d.sku ? { name: d.sku.name ?? "", capacity: d.sku.capacity ?? 0 } : undefined,
          provisioningState: d.properties?.provisioningState,
          rateLimits: d.properties?.rateLimits?.map((r) => ({
            key: r.key ?? "",
            renewalPeriod: r.renewalPeriod ?? 0,
            count: r.count ?? 0,
          })),
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listModels(location: string): Promise<AIModel[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: AIModel[] = [];
      for await (const m of client.models.list(location)) {
        if (m.model) {
          results.push({
            name: m.model.name ?? "",
            format: m.model.format ?? "",
            version: m.model.version ?? "",
            capabilities: m.model.capabilities as Record<string, string>,
            lifecycleStatus: m.model.lifecycleStatus,
            maxCapacity: m.model.maxCapacity,
          });
        }
      }
      return results;
    }, this.retryOptions);
  }

  async getKeys(
    resourceGroup: string,
    accountName: string
  ): Promise<{ key1: string; key2: string }> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const keys = await client.accounts.listKeys(resourceGroup, accountName);
      return {
        key1: keys.key1 ?? "",
        key2: keys.key2 ?? "",
      };
    }, this.retryOptions);
  }
}

export function createAIManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureAIManager {
  return new AzureAIManager(credentialsManager, subscriptionId, retryOptions);
}
