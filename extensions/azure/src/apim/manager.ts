/**
 * Azure API Management Manager
 *
 * Manages API Management services, APIs, products, and policies via @azure/arm-apimanagement.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  ApiManagementService,
  ApiManagementApi,
  ApiManagementProduct,
  ApiManagementPolicy,
  ApiManagementServiceCreateOptions,
  ApiManagementApiCreateOptions,
  ApiManagementSkuName,
} from "./types.js";

export class AzureApiManagementManager {
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

  /**
   * List API Management services, optionally filtered by resource group.
   */
  async listServices(resourceGroup?: string): Promise<ApiManagementService[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: ApiManagementService[] = [];
      const iter = resourceGroup
        ? client.apiManagementService.listByResourceGroup(resourceGroup)
        : client.apiManagementService.list();
      for await (const s of iter) {
        results.push(this.mapService(s));
      }
      return results;
    }, this.retryOptions);
  }

  /**
   * Get a specific API Management service.
   */
  async getService(resourceGroup: string, serviceName: string): Promise<ApiManagementService | null> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      try {
        const s = await client.apiManagementService.get(resourceGroup, serviceName);
        return this.mapService(s);
      } catch (e) {
        if ((e as { statusCode?: number }).statusCode === 404) return null;
        throw e;
      }
    }, this.retryOptions);
  }

  /**
   * Create or update an API Management service.
   */
  async createService(options: ApiManagementServiceCreateOptions): Promise<ApiManagementService> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const s = await client.apiManagementService.beginCreateOrUpdateAndWait(
        options.resourceGroup, options.name,
        {
          location: options.location,
          publisherEmail: options.publisherEmail,
          publisherName: options.publisherName,
          sku: {
            name: options.skuName ?? "Consumption",
            capacity: options.skuCapacity ?? 0,
          },
          tags: options.tags,
        },
      );
      return this.mapService(s);
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
   * List APIs in a service.
   */
  async listApis(resourceGroup: string, serviceName: string): Promise<ApiManagementApi[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: ApiManagementApi[] = [];
      for await (const a of client.api.listByService(resourceGroup, serviceName)) {
        results.push({
          id: a.id ?? "",
          name: a.name ?? "",
          displayName: a.displayName,
          path: a.path ?? "",
          serviceUrl: a.serviceUrl,
          protocols: a.protocols,
          apiRevision: a.apiRevision,
          apiVersion: a.apiVersion,
          isCurrent: a.isCurrent,
          subscriptionRequired: a.subscriptionRequired,
        });
      }
      return results;
    }, this.retryOptions);
  }

  /**
   * Create or update an API.
   */
  async createApi(
    resourceGroup: string,
    serviceName: string,
    options: ApiManagementApiCreateOptions
  ): Promise<ApiManagementApi> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const a = await client.api.beginCreateOrUpdateAndWait(
        resourceGroup, serviceName, options.name,
        {
          displayName: options.displayName,
          path: options.path,
          serviceUrl: options.serviceUrl,
          protocols: options.protocols ?? ["https"],
          subscriptionRequired: options.subscriptionRequired ?? false,
        },
      );
      return {
        id: a.id ?? "",
        name: a.name ?? "",
        displayName: a.displayName,
        path: a.path ?? "",
        serviceUrl: a.serviceUrl,
        protocols: a.protocols,
        apiRevision: a.apiRevision,
        apiVersion: a.apiVersion,
        isCurrent: a.isCurrent,
        subscriptionRequired: a.subscriptionRequired,
      };
    }, this.retryOptions);
  }

  /**
   * Delete an API.
   */
  async deleteApi(
    resourceGroup: string,
    serviceName: string,
    apiId: string
  ): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.api.delete(resourceGroup, serviceName, apiId, "*");
    }, this.retryOptions);
  }

  /**
   * List products in a service.
   */
  async listProducts(resourceGroup: string, serviceName: string): Promise<ApiManagementProduct[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: ApiManagementProduct[] = [];
      for await (const p of client.product.listByService(resourceGroup, serviceName)) {
        results.push({
          id: p.id ?? "",
          name: p.name ?? "",
          displayName: p.displayName,
          description: p.description,
          state: p.state as "notPublished" | "published" | undefined,
          subscriptionRequired: p.subscriptionRequired,
          approvalRequired: p.approvalRequired,
          subscriptionsLimit: p.subscriptionsLimit,
        });
      }
      return results;
    }, this.retryOptions);
  }

  /**
   * Create or update a product.
   */
  async createProduct(
    resourceGroup: string,
    serviceName: string,
    productId: string,
    displayName: string,
    options?: {
      description?: string;
      state?: "notPublished" | "published";
      subscriptionRequired?: boolean;
      approvalRequired?: boolean;
      subscriptionsLimit?: number;
    }
  ): Promise<ApiManagementProduct> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const p = await client.product.createOrUpdate(
        resourceGroup, serviceName, productId,
        {
          displayName,
          description: options?.description,
          state: options?.state ?? "notPublished",
          subscriptionRequired: options?.subscriptionRequired ?? true,
          approvalRequired: options?.approvalRequired ?? false,
          subscriptionsLimit: options?.subscriptionsLimit,
        },
      );
      return {
        id: p.id ?? "",
        name: p.name ?? "",
        displayName: p.displayName,
        description: p.description,
        state: p.state as "notPublished" | "published" | undefined,
        subscriptionRequired: p.subscriptionRequired,
        approvalRequired: p.approvalRequired,
        subscriptionsLimit: p.subscriptionsLimit,
      };
    }, this.retryOptions);
  }

  /**
   * Get the policy for an API.
   */
  async getApiPolicy(
    resourceGroup: string,
    serviceName: string,
    apiId: string
  ): Promise<ApiManagementPolicy | null> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      try {
        const p = await client.apiPolicy.get(resourceGroup, serviceName, apiId, "policy");
        return {
          id: p.id ?? "",
          name: p.name ?? "",
          value: p.value ?? "",
          format: p.format,
        };
      } catch (e) {
        if ((e as { statusCode?: number }).statusCode === 404) return null;
        throw e;
      }
    }, this.retryOptions);
  }

  /**
   * Set the policy for an API.
   */
  async setApiPolicy(
    resourceGroup: string,
    serviceName: string,
    apiId: string,
    policyXml: string,
    format?: string
  ): Promise<ApiManagementPolicy> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const p = await client.apiPolicy.createOrUpdate(
        resourceGroup, serviceName, apiId, "policy",
        {
          value: policyXml,
          format: format ?? "xml",
        },
        { ifMatch: "*" },
      );
      return {
        id: p.id ?? "",
        name: p.name ?? "",
        value: p.value ?? "",
        format: p.format,
      };
    }, this.retryOptions);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapService(s: any): ApiManagementService {
    return {
      id: s.id ?? "",
      name: s.name ?? "",
      resourceGroup: s.id?.match(/resourceGroups\/([^/]+)/i)?.[1] ?? "",
      location: s.location ?? "",
      sku: {
        name: ((s.sku?.name ?? "Consumption") as string as ApiManagementSkuName),
        capacity: s.sku?.capacity ?? 0,
      },
      gatewayUrl: s.gatewayUrl,
      portalUrl: s.portalUrl,
      managementApiUrl: s.managementApiUrl,
      publisherEmail: s.publisherEmail,
      publisherName: s.publisherName,
      provisioningState: s.provisioningState,
      tags: s.tags,
    };
  }
}

export function createApiManagementManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureApiManagementManager {
  return new AzureApiManagementManager(credentialsManager, subscriptionId, retryOptions);
}
