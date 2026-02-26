/**
 * Azure Resource Manager
 *
 * Manages resource groups and ARM deployments via @azure/arm-resources.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions, AzurePaginationOptions, AzurePagedResult } from "../types.js";
import { withAzureRetry } from "../retry.js";
import { collectPaged, collectAll } from "../pagination.js";
import type { ResourceGroup, ARMDeployment, DeploymentOperation, GenericResource } from "./types.js";

export class AzureResourceManager {
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
    const { ResourceManagementClient } = await import("@azure/arm-resources");
    const { credential } = await this.credentialsManager.getCredential();
    return new ResourceManagementClient(credential, this.subscriptionId);
  }

  /**
   * List resource groups with optional pagination.
   */
  async listResourceGroups(pagination: AzurePaginationOptions & { limit: number }): Promise<AzurePagedResult<ResourceGroup>>;
  async listResourceGroups(pagination?: AzurePaginationOptions): Promise<ResourceGroup[]>;
  async listResourceGroups(pagination?: AzurePaginationOptions): Promise<ResourceGroup[] | AzurePagedResult<ResourceGroup>> {
    return withAzureRetry(async () => {
      const client = await this.getClient();

      const mapFn = (rg: any): ResourceGroup => ({
        id: rg.id ?? "",
        name: rg.name ?? "",
        location: rg.location ?? "",
        tags: rg.tags,
        provisioningState: rg.properties?.provisioningState,
        managedBy: rg.managedBy,
      });

      if (pagination?.limit !== undefined) {
        return collectPaged(client.resourceGroups.list(), mapFn, undefined, pagination);
      }

      return collectAll(client.resourceGroups.list(), mapFn);
    }, this.retryOptions);
  }

  async getResourceGroup(name: string): Promise<ResourceGroup> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const rg = await client.resourceGroups.get(name);
      return {
        id: rg.id ?? "",
        name: rg.name ?? "",
        location: rg.location ?? "",
        tags: rg.tags,
        provisioningState: rg.properties?.provisioningState,
        managedBy: rg.managedBy,
      };
    }, this.retryOptions);
  }

  async createResourceGroup(
    name: string,
    location: string,
    tags?: Record<string, string>
  ): Promise<ResourceGroup> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const rg = await client.resourceGroups.createOrUpdate(name, { location, tags });
      return {
        id: rg.id ?? "",
        name: rg.name ?? "",
        location: rg.location ?? "",
        tags: rg.tags,
        provisioningState: rg.properties?.provisioningState,
      };
    }, this.retryOptions);
  }

  async deleteResourceGroup(name: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.resourceGroups.beginDeleteAndWait(name);
    }, this.retryOptions);
  }

  async listDeployments(resourceGroup: string): Promise<ARMDeployment[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: ARMDeployment[] = [];
      for await (const d of client.deployments.listByResourceGroup(resourceGroup)) {
        results.push({
          id: d.id ?? "",
          name: d.name ?? "",
          resourceGroup,
          provisioningState: (d.properties?.provisioningState as any) ?? "Succeeded",
          timestamp: d.properties?.timestamp?.toISOString(),
          duration: d.properties?.duration,
          mode: d.properties?.mode,
          correlationId: d.properties?.correlationId,
          outputs: d.properties?.outputs as Record<string, unknown>,
          parameters: d.properties?.parameters as Record<string, unknown>,
          error: d.properties?.error
            ? { code: d.properties.error.code ?? "", message: d.properties.error.message ?? "" }
            : undefined,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async createDeployment(
    resourceGroup: string,
    deploymentName: string,
    template: Record<string, unknown>,
    parameters?: Record<string, unknown>
  ): Promise<ARMDeployment> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const result = await client.deployments.beginCreateOrUpdateAndWait(
        resourceGroup,
        deploymentName,
        {
          properties: {
            mode: "Incremental",
            template,
            parameters,
          },
        }
      );
      return {
        id: result.id ?? "",
        name: result.name ?? "",
        resourceGroup,
        provisioningState:
          (result.properties?.provisioningState as any) ?? "Succeeded",
        timestamp: result.properties?.timestamp?.toISOString(),
        duration: result.properties?.duration,
        outputs: result.properties?.outputs as Record<string, unknown>,
      };
    }, this.retryOptions);
  }

  async validateDeployment(
    resourceGroup: string,
    deploymentName: string,
    template: Record<string, unknown>,
    parameters?: Record<string, unknown>
  ): Promise<{ isValid: boolean; error?: { code: string; message: string } }> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const result = await client.deployments.beginValidateAndWait(
        resourceGroup,
        deploymentName,
        {
          properties: { mode: "Incremental", template, parameters },
        }
      );
      return {
        isValid: !result.error,
        error: result.error
          ? { code: result.error.code ?? "", message: result.error.message ?? "" }
          : undefined,
      };
    }, this.retryOptions);
  }

  /**
   * List resources with optional pagination.
   */
  async listResources(resourceGroup: string | undefined, pagination: AzurePaginationOptions & { limit: number }): Promise<AzurePagedResult<GenericResource>>;
  async listResources(resourceGroup?: string, pagination?: AzurePaginationOptions): Promise<GenericResource[]>;
  async listResources(resourceGroup?: string, pagination?: AzurePaginationOptions): Promise<GenericResource[] | AzurePagedResult<GenericResource>> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const iter = resourceGroup
        ? client.resources.listByResourceGroup(resourceGroup)
        : client.resources.list();

      const mapFn = (r: any): GenericResource => ({
        id: r.id ?? "",
        name: r.name ?? "",
        type: r.type ?? "",
        resourceGroup: r.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
        location: r.location ?? "",
        tags: r.tags,
        kind: r.kind,
        sku: r.sku ? { name: r.sku.name ?? "", tier: r.sku.tier, capacity: r.sku.capacity } : undefined,
      });

      if (pagination?.limit !== undefined) {
        return collectPaged(iter, mapFn, undefined, pagination);
      }

      return collectAll(iter, mapFn);
    }, this.retryOptions);
  }
}

export function createResourceManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureResourceManager {
  return new AzureResourceManager(credentialsManager, subscriptionId, retryOptions);
}
