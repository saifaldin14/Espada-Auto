/**
 * Azure Bastion Manager
 *
 * Manages Bastion hosts via @azure/arm-network. Azure Bastion uses the
 * NetworkManagementClient (same SDK as Network/Firewall/AppGateway).
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { BastionHost } from "./types.js";

export class AzureBastionManager {
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
  // Bastion Hosts
  // ---------------------------------------------------------------------------

  /** List Bastion hosts. */
  async listBastionHosts(resourceGroup?: string): Promise<BastionHost[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const hosts: BastionHost[] = [];
      const iter = resourceGroup
        ? client.bastionHosts.listByResourceGroup(resourceGroup)
        : client.bastionHosts.list();

      for await (const bh of iter) {
        hosts.push(this.mapBastionHost(bh));
      }
      return hosts;
    }, this.retryOptions);
  }

  /** Get a specific Bastion host. */
  async getBastionHost(resourceGroup: string, name: string): Promise<BastionHost | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const bh = await client.bastionHosts.get(resourceGroup, name);
        return this.mapBastionHost(bh, resourceGroup);
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete a Bastion host. */
  async deleteBastionHost(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.bastionHosts.beginDeleteAndWait(resourceGroup, name),
      this.retryOptions,
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private mapBastionHost(bh: unknown, rg?: string): BastionHost {
    const host = bh as {
      id?: string; name?: string; location?: string;
      provisioningState?: string; dnsName?: string;
      scaleUnits?: number;
      disableCopyPaste?: boolean; enableFileCopy?: boolean;
      enableIpConnect?: boolean; enableShareableLink?: boolean;
      enableTunneling?: boolean; enableKerberos?: boolean;
      sku?: { name?: string };
      ipConfigurations?: Array<{
        id?: string; name?: string;
        subnet?: { id?: string };
        publicIPAddress?: { id?: string };
        privateIPAllocationMethod?: string;
        provisioningState?: string;
      }>;
      tags?: Record<string, string>;
    };

    return {
      id: host.id ?? "",
      name: host.name ?? "",
      resourceGroup: rg ?? this.extractResourceGroup(host.id ?? ""),
      location: host.location ?? "",
      provisioningState: host.provisioningState,
      dnsName: host.dnsName,
      scaleUnits: host.scaleUnits,
      disableCopyPaste: host.disableCopyPaste,
      enableFileCopy: host.enableFileCopy,
      enableIpConnect: host.enableIpConnect,
      enableShareableLink: host.enableShareableLink,
      enableTunneling: host.enableTunneling,
      enableKerberos: host.enableKerberos,
      skuName: host.sku?.name as BastionHost["skuName"],
      ipConfigurations: (host.ipConfigurations ?? []).map((ip) => ({
        id: ip.id ?? "",
        name: ip.name ?? "",
        subnetId: ip.subnet?.id,
        publicIpAddressId: ip.publicIPAddress?.id,
        privateIpAllocationMethod: ip.privateIPAllocationMethod,
        provisioningState: ip.provisioningState,
      })),
      tags: host.tags as Record<string, string>,
    };
  }
}

export function createBastionManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureBastionManager {
  return new AzureBastionManager(credentialsManager, subscriptionId, retryOptions);
}
