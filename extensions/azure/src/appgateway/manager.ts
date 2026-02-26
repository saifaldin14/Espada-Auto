/**
 * Azure Application Gateway Manager
 *
 * Manages Application Gateway resources via @azure/arm-network.
 * Covers gateways, backend pools, HTTP listeners, and WAF configuration.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { ApplicationGateway, WAFConfiguration } from "./types.js";

export class AzureAppGatewayManager {
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

  private async getClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { NetworkManagementClient } = await import("@azure/arm-network");
    return new NetworkManagementClient(credential, this.subscriptionId);
  }

  private extractResourceGroup(resourceId: string): string {
    const match = resourceId.match(/resourceGroups\/([^/]+)/i);
    return match ? match[1] : "";
  }

  // ---------------------------------------------------------------------------
  // Application Gateways
  // ---------------------------------------------------------------------------

  /** List Application Gateways. */
  async listGateways(resourceGroup?: string): Promise<ApplicationGateway[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const gateways: ApplicationGateway[] = [];
      const iter = resourceGroup
        ? client.applicationGateways.list(resourceGroup)
        : client.applicationGateways.listAll();

      for await (const gw of iter) {
        gateways.push(this.mapGateway(gw));
      }
      return gateways;
    }, this.retryOptions);
  }

  /** Get a specific Application Gateway. */
  async getGateway(resourceGroup: string, name: string): Promise<ApplicationGateway | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const gw = await client.applicationGateways.get(resourceGroup, name);
        return this.mapGateway(gw, resourceGroup);
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Start an Application Gateway. */
  async startGateway(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.applicationGateways.beginStartAndWait(resourceGroup, name),
      this.retryOptions,
    );
  }

  /** Stop an Application Gateway. */
  async stopGateway(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.applicationGateways.beginStopAndWait(resourceGroup, name),
      this.retryOptions,
    );
  }

  /** Delete an Application Gateway. */
  async deleteGateway(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.applicationGateways.beginDeleteAndWait(resourceGroup, name),
      this.retryOptions,
    );
  }

  /** Get WAF configuration for an Application Gateway. */
  async getWAFConfig(resourceGroup: string, name: string): Promise<WAFConfiguration | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const gw = await client.applicationGateways.get(resourceGroup, name);
        if (!gw.webApplicationFirewallConfiguration) return null;
        const waf = gw.webApplicationFirewallConfiguration;
        return {
          enabled: waf.enabled ?? false,
          firewallMode: waf.firewallMode,
          ruleSetType: waf.ruleSetType,
          ruleSetVersion: waf.ruleSetVersion,
          maxRequestBodySizeInKb: waf.maxRequestBodySizeInKb,
          fileUploadLimitInMb: waf.fileUploadLimitInMb,
          requestBodyCheck: waf.requestBodyCheck,
        };
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private mapGateway(gw: unknown, rg?: string): ApplicationGateway {
    const gwTyped = gw as {
      id?: string; name?: string; location?: string;
      provisioningState?: string; operationalState?: string;
      sku?: { name?: string; tier?: string; capacity?: number };
      enableHttp2?: boolean; enableFips?: boolean;
      firewallPolicy?: { id?: string };
      frontendIPConfigurations?: Array<{
        id?: string; name?: string;
        properties?: { privateIPAddress?: string; publicIPAddress?: { id?: string }; subnet?: { id?: string } };
        privateIPAddress?: string; publicIPAddress?: { id?: string }; subnet?: { id?: string };
      }>;
      backendAddressPools?: Array<{
        id?: string; name?: string;
        properties?: { backendAddresses?: Array<{ fqdn?: string; ipAddress?: string }> };
        backendAddresses?: Array<{ fqdn?: string; ipAddress?: string }>;
      }>;
      httpListeners?: Array<{
        id?: string; name?: string;
        properties?: { protocol?: string; hostName?: string; frontendPort?: { id?: string } };
        protocol?: string; hostName?: string; frontendPort?: { id?: string };
      }>;
      tags?: Record<string, string>;
    };

    return {
      id: gwTyped.id ?? "",
      name: gwTyped.name ?? "",
      resourceGroup: rg ?? this.extractResourceGroup(gwTyped.id ?? ""),
      location: gwTyped.location ?? "",
      provisioningState: gwTyped.provisioningState,
      operationalState: gwTyped.operationalState,
      skuName: gwTyped.sku?.name,
      skuTier: gwTyped.sku?.tier as ApplicationGateway["skuTier"],
      skuCapacity: gwTyped.sku?.capacity,
      enableHttp2: gwTyped.enableHttp2,
      enableFips: gwTyped.enableFips,
      firewallPolicyId: gwTyped.firewallPolicy?.id,
      frontendIPConfigurations: (gwTyped.frontendIPConfigurations ?? []).map((f) => ({
        id: f.id ?? "",
        name: f.name ?? "",
        privateIpAddress: f.privateIPAddress,
        publicIpAddressId: f.publicIPAddress?.id,
        subnetId: f.subnet?.id,
      })),
      backendAddressPools: (gwTyped.backendAddressPools ?? []).map((b) => ({
        id: b.id ?? "",
        name: b.name ?? "",
        backendAddresses: (b.backendAddresses ?? []).map((a) => ({
          fqdn: a.fqdn,
          ipAddress: a.ipAddress,
        })),
      })),
      httpListeners: (gwTyped.httpListeners ?? []).map((h) => ({
        id: h.id ?? "",
        name: h.name ?? "",
        protocol: h.protocol,
        hostName: h.hostName,
        frontendPort: h.frontendPort?.id,
      })),
      tags: gwTyped.tags as Record<string, string>,
    };
  }
}

export function createAppGatewayManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureAppGatewayManager {
  return new AzureAppGatewayManager(credentialsManager, subscriptionId, retryOptions);
}
