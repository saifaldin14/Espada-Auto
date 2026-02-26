/**
 * Azure API Management Manager
 *
 * Manages APIM services, APIs, products, and subscriptions via @azure/arm-apimanagement.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { APIMService, APIProduct, APIDefinition, APIMSubscription, APIMSkuName, APIMPolicy, APIMServiceCreateOptions, APIMApiCreateOptions } from "./types.js";

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

  /**
   * Get a specific API Management service.
   */
  async getService(resourceGroup: string, serviceName: string): Promise<APIMService | null> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      try {
        const s = await client.apiManagementService.get(resourceGroup, serviceName);
        return {
          id: s.id ?? "", name: s.name ?? "",
          resourceGroup: s.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: s.location ?? "",
          sku: { name: ((s.sku?.name ?? "Developer") as string as APIMSkuName), capacity: s.sku?.capacity ?? 0 },
          gatewayUrl: s.gatewayUrl, portalUrl: s.portalUrl, managementApiUrl: s.managementApiUrl,
          publisherEmail: s.publisherEmail, publisherName: s.publisherName,
          provisioningState: s.provisioningState,
        };
      } catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return null; throw e; }
    }, this.retryOptions);
  }

  /**
   * Create or update an API Management service.
   */
  async createService(options: APIMServiceCreateOptions): Promise<APIMService> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const s = await client.apiManagementService.beginCreateOrUpdateAndWait(
        options.resourceGroup, options.name,
        {
          location: options.location,
          publisherEmail: options.publisherEmail,
          publisherName: options.publisherName,
          sku: { name: options.skuName ?? "Consumption", capacity: options.skuCapacity ?? 0 },
          tags: options.tags,
        },
      );
      return {
        id: s.id ?? "", name: s.name ?? "",
        resourceGroup: s.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
        location: s.location ?? "",
        sku: { name: ((s.sku?.name ?? "Developer") as string as APIMSkuName), capacity: s.sku?.capacity ?? 0 },
        gatewayUrl: s.gatewayUrl, portalUrl: s.portalUrl, managementApiUrl: s.managementApiUrl,
        publisherEmail: s.publisherEmail, publisherName: s.publisherName,
        provisioningState: s.provisioningState,
      };
    }, this.retryOptions);
  }

  /**
   * Delete an API Management service.
   */
  async deleteService(resourceGroup: string, serviceName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.apiManagementService.beginDeleteAndWait(resourceGroup, serviceName);
    }, this.retryOptions);
  }

  /**
   * Create or update an API.
   */
  async createApi(resourceGroup: string, serviceName: string, options: APIMApiCreateOptions): Promise<APIDefinition> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const a = await client.api.beginCreateOrUpdateAndWait(
        resourceGroup, serviceName, options.name,
        {
          displayName: options.displayName, path: options.path,
          serviceUrl: options.serviceUrl, protocols: options.protocols ?? ["https"],
          subscriptionRequired: options.subscriptionRequired ?? false,
        },
      );
      return {
        id: a.id ?? "", name: a.name ?? "", displayName: a.displayName ?? "",
        path: a.path ?? "", protocols: a.protocols ?? [], serviceUrl: a.serviceUrl,
        apiVersion: a.apiVersion, isCurrent: a.isCurrent,
      };
    }, this.retryOptions);
  }

  /**
   * Delete an API.
   */
  async deleteApi(resourceGroup: string, serviceName: string, apiId: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.api.delete(resourceGroup, serviceName, apiId, "*");
    }, this.retryOptions);
  }

  /**
   * Create or update a product.
   */
  async createProduct(
    resourceGroup: string, serviceName: string, productId: string, displayName: string,
    options?: { description?: string; state?: string; subscriptionRequired?: boolean; approvalRequired?: boolean; subscriptionsLimit?: number },
  ): Promise<APIProduct> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const p = await client.product.createOrUpdate(
        resourceGroup, serviceName, productId,
        {
          displayName, description: options?.description,
          state: (options?.state ?? "notPublished") as any,
          subscriptionRequired: options?.subscriptionRequired ?? true,
          approvalRequired: options?.approvalRequired ?? false,
          subscriptionsLimit: options?.subscriptionsLimit,
        },
      );
      return {
        id: p.id ?? "", name: p.name ?? "", displayName: p.displayName ?? "",
        description: p.description, state: p.state ?? "",
        subscriptionRequired: p.subscriptionRequired, approvalRequired: p.approvalRequired,
        subscriptionsLimit: p.subscriptionsLimit,
      };
    }, this.retryOptions);
  }

  /**
   * Get the policy for an API.
   */
  async getApiPolicy(resourceGroup: string, serviceName: string, apiId: string): Promise<APIMPolicy | null> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      try {
        const p = await client.apiPolicy.get(resourceGroup, serviceName, apiId, "policy");
        return { id: p.id ?? "", name: p.name ?? "", value: p.value ?? "", format: p.format };
      } catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return null; throw e; }
    }, this.retryOptions);
  }

  /**
   * Set the policy for an API.
   */
  async setApiPolicy(
    resourceGroup: string, serviceName: string, apiId: string,
    policyXml: string, format?: string,
  ): Promise<APIMPolicy> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const p = await client.apiPolicy.createOrUpdate(
        resourceGroup, serviceName, apiId, "policy",
        { value: policyXml, format: format ?? "xml" },
        { ifMatch: "*" },
      );
      return { id: p.id ?? "", name: p.name ?? "", value: p.value ?? "", format: p.format };
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
