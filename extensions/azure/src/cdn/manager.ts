/**
 * Azure CDN Manager
 *
 * Manages CDN profiles, endpoints, and custom domains via @azure/arm-cdn.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { CDNProfile, CDNEndpoint, CDNCustomDomain, CDNSkuName, CDNOrigin } from "./types.js";

export class AzureCDNManager {
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
    const { CdnManagementClient } = await import("@azure/arm-cdn");
    const { credential } = await this.credentialsManager.getCredential();
    return new CdnManagementClient(credential, this.subscriptionId);
  }

  async listProfiles(resourceGroup?: string): Promise<CDNProfile[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: CDNProfile[] = [];
      const iter = resourceGroup
        ? client.profiles.listByResourceGroup(resourceGroup)
        : client.profiles.list();
      for await (const p of iter) {
        results.push({
          id: p.id ?? "",
          name: p.name ?? "",
          resourceGroup: p.id?.split("/resourceGroups/")[1]?.split("/")[0] ?? "",
          location: p.location ?? "",
          sku: ((p.sku?.name ?? "Standard_Microsoft") as string as CDNSkuName),
          provisioningState: p.provisioningState,
          resourceState: p.resourceState,
          frontDoorId: p.frontDoorId,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listEndpoints(resourceGroup: string, profileName: string): Promise<CDNEndpoint[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: CDNEndpoint[] = [];
      for await (const e of client.endpoints.listByProfile(resourceGroup, profileName)) {
        results.push({
          id: e.id ?? "",
          name: e.name ?? "",
          profileName,
          hostName: e.hostName,
          originHostHeader: e.originHostHeader,
          isHttpAllowed: e.isHttpAllowed,
          isHttpsAllowed: e.isHttpsAllowed,
          isCompressionEnabled: e.isCompressionEnabled,
          provisioningState: e.provisioningState,
          resourceState: e.resourceState,
          origins: (e.origins ?? []).map((o) => ({
            name: o.name ?? "",
            hostName: o.hostName ?? "",
          })),
        });
      }
      return results;
    }, this.retryOptions);
  }

  async listCustomDomains(
    resourceGroup: string,
    profileName: string,
    endpointName: string
  ): Promise<CDNCustomDomain[]> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const results: CDNCustomDomain[] = [];
      for await (const cd of client.customDomains.listByEndpoint(
        resourceGroup,
        profileName,
        endpointName
      )) {
        results.push({
          id: cd.id ?? "",
          name: cd.name ?? "",
          endpointName,
          hostName: cd.hostName ?? "",
          validationData: cd.validationData,
          provisioningState: cd.provisioningState,
          resourceState: cd.resourceState,
          customHttpsProvisioningState: cd.customHttpsProvisioningState,
        });
      }
      return results;
    }, this.retryOptions);
  }

  async purgeContent(
    resourceGroup: string,
    profileName: string,
    endpointName: string,
    contentPaths: string[]
  ): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.endpoints.beginPurgeContentAndWait(resourceGroup, profileName, endpointName, {
        contentPaths,
      });
    }, this.retryOptions);
  }

  /**
   * Create a CDN profile.
   */
  async createProfile(
    resourceGroup: string,
    name: string,
    location: string,
    sku: CDNSkuName,
    tags?: Record<string, string>
  ): Promise<CDNProfile> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const p = await client.profiles.beginCreateAndWait(resourceGroup, name, {
        location,
        sku: { name: sku },
        tags,
      });
      return {
        id: p.id ?? "",
        name: p.name ?? "",
        resourceGroup,
        location: p.location ?? "",
        sku: ((p.sku?.name ?? "Standard_Microsoft") as string as CDNSkuName),
        provisioningState: p.provisioningState,
        resourceState: p.resourceState,
        frontDoorId: p.frontDoorId,
      };
    }, this.retryOptions);
  }

  /**
   * Delete a CDN profile.
   */
  async deleteProfile(resourceGroup: string, profileName: string): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.profiles.beginDeleteAndWait(resourceGroup, profileName);
    }, this.retryOptions);
  }

  /**
   * Create a CDN endpoint.
   */
  async createEndpoint(
    resourceGroup: string,
    profileName: string,
    name: string,
    origins: Array<{ name: string; hostName: string }>,
    options?: {
      originHostHeader?: string;
      isHttpAllowed?: boolean;
      isHttpsAllowed?: boolean;
      isCompressionEnabled?: boolean;
      tags?: Record<string, string>;
    }
  ): Promise<CDNEndpoint> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      const e = await client.endpoints.beginCreateAndWait(resourceGroup, profileName, name, {
        location: "global",
        origins: origins.map(o => ({ name: o.name, hostName: o.hostName })),
        originHostHeader: options?.originHostHeader,
        isHttpAllowed: options?.isHttpAllowed ?? true,
        isHttpsAllowed: options?.isHttpsAllowed ?? true,
        isCompressionEnabled: options?.isCompressionEnabled ?? false,
        tags: options?.tags,
      });
      return {
        id: e.id ?? "",
        name: e.name ?? "",
        profileName,
        hostName: e.hostName,
        originHostHeader: e.originHostHeader,
        isHttpAllowed: e.isHttpAllowed,
        isHttpsAllowed: e.isHttpsAllowed,
        isCompressionEnabled: e.isCompressionEnabled,
        provisioningState: e.provisioningState,
        resourceState: e.resourceState,
        origins: (e.origins ?? []).map(o => ({
          name: o.name ?? "",
          hostName: o.hostName ?? "",
        })),
      };
    }, this.retryOptions);
  }

  /**
   * Delete a CDN endpoint.
   */
  async deleteEndpoint(
    resourceGroup: string,
    profileName: string,
    endpointName: string
  ): Promise<void> {
    return withAzureRetry(async () => {
      const client = await this.getClient();
      await client.endpoints.beginDeleteAndWait(resourceGroup, profileName, endpointName);
    }, this.retryOptions);
  }
}

export function createCDNManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions
): AzureCDNManager {
  return new AzureCDNManager(credentialsManager, subscriptionId, retryOptions);
}
