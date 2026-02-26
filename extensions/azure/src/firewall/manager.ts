/**
 * Azure Firewall Manager
 *
 * Manages Azure Firewall resources, firewall policies, and IP groups
 * via @azure/arm-network (same SDK as the Network manager).
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type {
  AzureFirewall,
  FirewallPolicy,
  FirewallRuleCollectionGroup,
  IPGroup,
} from "./types.js";

export class AzureFirewallManager {
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
  // Azure Firewalls
  // ---------------------------------------------------------------------------

  /** List Azure Firewalls. */
  async listFirewalls(resourceGroup?: string): Promise<AzureFirewall[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const firewalls: AzureFirewall[] = [];
      const iter = resourceGroup
        ? client.azureFirewalls.list(resourceGroup)
        : client.azureFirewalls.listAll();

      for await (const fw of iter) {
        firewalls.push({
          id: fw.id ?? "",
          name: fw.name ?? "",
          resourceGroup: this.extractResourceGroup(fw.id ?? ""),
          location: fw.location ?? "",
          provisioningState: fw.provisioningState,
          threatIntelMode: fw.threatIntelMode,
          skuTier: fw.sku?.tier as AzureFirewall["skuTier"],
          firewallPolicyId: fw.firewallPolicy?.id,
          ipConfigurations: (fw.ipConfigurations ?? []).map((ip) => ({
            id: ip.id ?? "",
            name: ip.name ?? "",
            privateIpAddress: ip.privateIPAddress,
            publicIpAddressId: ip.publicIPAddress?.id,
            subnetId: ip.subnet?.id,
          })),
          tags: fw.tags as Record<string, string>,
        });
      }
      return firewalls;
    }, this.retryOptions);
  }

  /** Get a specific Azure Firewall. */
  async getFirewall(resourceGroup: string, name: string): Promise<AzureFirewall | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const fw = await client.azureFirewalls.get(resourceGroup, name);
        return {
          id: fw.id ?? "",
          name: fw.name ?? "",
          resourceGroup,
          location: fw.location ?? "",
          provisioningState: fw.provisioningState,
          threatIntelMode: fw.threatIntelMode,
          skuTier: fw.sku?.tier as AzureFirewall["skuTier"],
          firewallPolicyId: fw.firewallPolicy?.id,
          ipConfigurations: (fw.ipConfigurations ?? []).map((ip) => ({
            id: ip.id ?? "",
            name: ip.name ?? "",
            privateIpAddress: ip.privateIPAddress,
            publicIpAddressId: ip.publicIPAddress?.id,
            subnetId: ip.subnet?.id,
          })),
          tags: fw.tags as Record<string, string>,
        };
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  /** Delete an Azure Firewall. */
  async deleteFirewall(resourceGroup: string, name: string): Promise<void> {
    const client = await this.getClient();
    await withAzureRetry(
      () => client.azureFirewalls.beginDeleteAndWait(resourceGroup, name),
      this.retryOptions,
    );
  }

  // ---------------------------------------------------------------------------
  // Firewall Policies
  // ---------------------------------------------------------------------------

  /** List Firewall Policies. */
  async listPolicies(resourceGroup?: string): Promise<FirewallPolicy[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const policies: FirewallPolicy[] = [];
      const iter = resourceGroup
        ? client.firewallPolicies.list(resourceGroup)
        : client.firewallPolicies.listAll();

      for await (const p of iter) {
        policies.push({
          id: p.id ?? "",
          name: p.name ?? "",
          resourceGroup: this.extractResourceGroup(p.id ?? ""),
          location: p.location ?? "",
          provisioningState: p.provisioningState,
          threatIntelMode: p.threatIntelMode,
          dnsSettings: p.dnsSettings
            ? { enableProxy: p.dnsSettings.enableProxy, servers: p.dnsSettings.servers }
            : undefined,
          tags: p.tags as Record<string, string>,
        });
      }
      return policies;
    }, this.retryOptions);
  }

  /** Get a specific Firewall Policy. */
  async getPolicy(resourceGroup: string, name: string): Promise<FirewallPolicy | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const p = await client.firewallPolicies.get(resourceGroup, name);
        return {
          id: p.id ?? "",
          name: p.name ?? "",
          resourceGroup,
          location: p.location ?? "",
          provisioningState: p.provisioningState,
          threatIntelMode: p.threatIntelMode,
          dnsSettings: p.dnsSettings
            ? { enableProxy: p.dnsSettings.enableProxy, servers: p.dnsSettings.servers }
            : undefined,
          tags: p.tags as Record<string, string>,
        };
      } catch (error) {
        const err = error as { statusCode?: number };
        if (err.statusCode === 404) return null;
        throw error;
      }
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // Rule Collection Groups
  // ---------------------------------------------------------------------------

  /** List rule collection groups for a firewall policy. */
  async listRuleCollectionGroups(
    resourceGroup: string,
    policyName: string,
  ): Promise<FirewallRuleCollectionGroup[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const groups: FirewallRuleCollectionGroup[] = [];
      for await (const g of client.firewallPolicyRuleCollectionGroups.list(resourceGroup, policyName)) {
        groups.push({
          id: g.id ?? "",
          name: g.name ?? "",
          priority: g.priority ?? 0,
          provisioningState: g.provisioningState,
          ruleCollectionCount: g.ruleCollections?.length ?? 0,
        });
      }
      return groups;
    }, this.retryOptions);
  }

  // ---------------------------------------------------------------------------
  // IP Groups
  // ---------------------------------------------------------------------------

  /** List IP Groups. */
  async listIPGroups(resourceGroup?: string): Promise<IPGroup[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const groups: IPGroup[] = [];
      const iter = resourceGroup
        ? client.ipGroups.listByResourceGroup(resourceGroup)
        : client.ipGroups.list();

      for await (const g of iter) {
        groups.push({
          id: g.id ?? "",
          name: g.name ?? "",
          resourceGroup: this.extractResourceGroup(g.id ?? ""),
          location: g.location ?? "",
          provisioningState: g.provisioningState,
          ipAddresses: g.ipAddresses ?? [],
          firewalls: (g.firewalls ?? []).map((f) => f.id ?? ""),
          tags: g.tags as Record<string, string>,
        });
      }
      return groups;
    }, this.retryOptions);
  }
}

export function createFirewallManager(
  credentialsManager: AzureCredentialsManager,
  subscriptionId: string,
  retryOptions?: AzureRetryOptions,
): AzureFirewallManager {
  return new AzureFirewallManager(credentialsManager, subscriptionId, retryOptions);
}
