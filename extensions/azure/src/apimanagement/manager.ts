/**
 * Azure API Management Manager
 *
 * Manages APIM services, APIs, products, and subscriptions via @azure/arm-apimanagement.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { APIMService, APIProduct, APIDefinition, APIMSubscription, APIMSkuName } from "./types.js";

export class AzureAPIManagementManager {
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
    const { ApiManagementClient } = await import("@azure/arm-apimanagement");
    const { credential } = await this.credentialsManager.getCredential();
    return new ApiManagementClient(credential, this.subscriptionId);
  }

  async listServices(resourceGroup?: string): Promise<APIMService[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: APIMService[] = [];
      const iter = resourceGroup
        ? client.apiManagementService.listByResourceGroup(resourceGroup)
        : client.apiManagementService.list();
      for await (const s of iter) {
        results.push({
          id: s.id ?? "",
          name: s.name ?? "",
          resourceGroup: s.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: s.location ?? "",
          sku: {
            name: ((s.sku?.name ?? "Developer") as string as APIMSkuName),
            capacity: s.sku?.capacity ?? 0,
          },
          gatewayUrl: s.gatewayUrl,
          portalUrl: s.portalUrl,
          managementApiUrl: s.managementApiUrl,
          publisherEmail: s.publisherEmail,
          publisherName: s.publisherName,
          provisioningState: s.provisioningState,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listAPIs(resourceGroup: string, serviceName: string): Promise<APIDefinition[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: APIDefinition[] = [];
      for await (const a of client.api.listByService(resourceGroup, serviceName)) {
        results.push({
          id: a.id ?? "",
          name: a.name ?? "",
          displayName: a.displayName ?? "",
          description: a.description,
          path: a.path ?? "",
          protocols: a.protocols ?? [],
          serviceUrl: a.serviceUrl,
          apiType: a.apiType,
          apiVersion: a.apiVersion,
          isCurrent: a.isCurrent,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listProducts(resourceGroup: string, serviceName: string): Promise<APIProduct[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: APIProduct[] = [];
      for await (const p of client.product.listByService(resourceGroup, serviceName)) {
        results.push({
          id: p.id ?? "",
          name: p.name ?? "",
          displayName: p.displayName ?? "",
          description: p.description,
          state: p.state ?? "",
          subscriptionRequired: p.subscriptionRequired,
          approvalRequired: p.approvalRequired,
          subscriptionsLimit: p.subscriptionsLimit,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listSubscriptions(
    resourceGroup: string,
    serviceName: string
  ): Promise<APIMSubscription[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: APIMSubscription[] = [];
      for await (const s of client.subscription.list(resourceGroup, serviceName)) {
        results.push({
          id: s.id ?? "",
          name: s.name ?? "",
          displayName: s.displayName,
          ownerId: s.ownerId,
          scope: s.scope ?? "",
          state: s.state ?? "",
          createdDate: s.createdDate?.toISOString(),
          expirationDate: s.expirationDate?.toISOString(),
        });
      }
      return results;
    }, this.retryOptions);
  }
}

export function createAPIManagementManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureAPIManagementManager {
  return new AzureAPIManagementManager(credentialsManager, subscriptionId, retryOptions);
}
