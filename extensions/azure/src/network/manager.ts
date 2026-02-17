/**
 * Azure Network Manager
 *
 * Manages Azure networking resources via @azure/arm-network.
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { VirtualNetwork, Subnet, NetworkSecurityGroup, NSGRule, LoadBalancer, PublicIPAddress } from "./types.js";

// =============================================================================
// AzureNetworkManager
// =============================================================================

export class AzureNetworkManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions: AzureRetryOptions;

  constructor(credentialsManager: AzureCredentialsManager, subscriptionId: string, retryOptions?: AzureRetryOptions) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions ?? {};
  }

  private async getClient() {
    const { credential } = await this.credentialsManager.getCredential();
    const { NetworkManagementClient } = await import("@azure/arm-network");
    return new NetworkManagementClient(credential, this.subscriptionId);
  }

  /**
   * List virtual networks.
   */
  async listVNets(resourceGroup?: string): Promise<VirtualNetwork[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const vnets: VirtualNetwork[] = [];
      const iter = resourceGroup
        ? client.virtualNetworks.list(resourceGroup)
        : client.virtualNetworks.listAll();
      for await (const v of iter) {
        vnets.push({
          id: v.id ?? "", name: v.name ?? "",
          resourceGroup: (v.id ?? "").match(/resourceGroups\/([^/]+)/i)?.[1] ?? "",
          location: v.location ?? "",
          addressSpace: v.addressSpace?.addressPrefixes ?? [],
          provisioningState: v.provisioningState,
          enableDdosProtection: v.enableDdosProtection,
          subnets: (v.subnets ?? []).map((s) => ({
            id: s.id ?? "", name: s.name ?? "",
            addressPrefix: s.addressPrefix ?? "",
            networkSecurityGroupId: s.networkSecurityGroup?.id,
            routeTableId: s.routeTable?.id,
            provisioningState: s.provisioningState,
            privateEndpointNetworkPolicies: s.privateEndpointNetworkPolicies,
            delegations: s.delegations?.map((d) => d.serviceName ?? ""),
          })),
          tags: v.tags as Record<string, string>,
        });
      }
      return vnets;
    }, this.retryOptions);
  }

  /**
   * Get a specific virtual network.
   */
  async getVNet(resourceGroup: string, vnetName: string): Promise<VirtualNetwork | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const v = await client.virtualNetworks.get(resourceGroup, vnetName);
        return {
          id: v.id ?? "", name: v.name ?? "", resourceGroup, location: v.location ?? "",
          addressSpace: v.addressSpace?.addressPrefixes ?? [],
          provisioningState: v.provisioningState,
          enableDdosProtection: v.enableDdosProtection,
          subnets: (v.subnets ?? []).map((s) => ({
            id: s.id ?? "", name: s.name ?? "",
            addressPrefix: s.addressPrefix ?? "",
            networkSecurityGroupId: s.networkSecurityGroup?.id,
            routeTableId: s.routeTable?.id,
            provisioningState: s.provisioningState,
          })),
          tags: v.tags as Record<string, string>,
        };
      } catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return null; throw e; }
    }, this.retryOptions);
  }

  /**
   * List subnets in a virtual network.
   */
  async listSubnets(resourceGroup: string, vnetName: string): Promise<Subnet[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const subnets: Subnet[] = [];
      for await (const s of client.subnets.list(resourceGroup, vnetName)) {
        subnets.push({
          id: s.id ?? "", name: s.name ?? "",
          addressPrefix: s.addressPrefix ?? "",
          networkSecurityGroupId: s.networkSecurityGroup?.id,
          routeTableId: s.routeTable?.id,
          provisioningState: s.provisioningState,
          privateEndpointNetworkPolicies: s.privateEndpointNetworkPolicies,
          delegations: s.delegations?.map((d) => d.serviceName ?? ""),
        });
      }
      return subnets;
    }, this.retryOptions);
  }

  /**
   * List network security groups.
   */
  async listNSGs(resourceGroup?: string): Promise<NetworkSecurityGroup[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const nsgs: NetworkSecurityGroup[] = [];
      const iter = resourceGroup
        ? client.networkSecurityGroups.list(resourceGroup)
        : client.networkSecurityGroups.listAll();
      for await (const n of iter) {
        nsgs.push({
          id: n.id ?? "", name: n.name ?? "",
          resourceGroup: (n.id ?? "").match(/resourceGroups\/([^/]+)/i)?.[1] ?? "",
          location: n.location ?? "", provisioningState: n.provisioningState,
          securityRules: (n.securityRules ?? []).map((r) => ({
            id: r.id ?? "", name: r.name ?? "",
            priority: r.priority ?? 0,
            direction: (r.direction ?? "Inbound") as NSGRule["direction"],
            access: (r.access ?? "Allow") as NSGRule["access"],
            protocol: r.protocol ?? "*",
            sourceAddressPrefix: r.sourceAddressPrefix,
            destinationAddressPrefix: r.destinationAddressPrefix,
            sourcePortRange: r.sourcePortRange,
            destinationPortRange: r.destinationPortRange,
            description: r.description,
          })),
          tags: n.tags as Record<string, string>,
        });
      }
      return nsgs;
    }, this.retryOptions);
  }

  /**
   * Get a specific NSG.
   */
  async getNSG(resourceGroup: string, nsgName: string): Promise<NetworkSecurityGroup | null> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      try {
        const n = await client.networkSecurityGroups.get(resourceGroup, nsgName);
        return {
          id: n.id ?? "", name: n.name ?? "", resourceGroup, location: n.location ?? "",
          provisioningState: n.provisioningState,
          securityRules: (n.securityRules ?? []).map((r) => ({
            id: r.id ?? "", name: r.name ?? "",
            priority: r.priority ?? 0,
            direction: (r.direction ?? "Inbound") as NSGRule["direction"],
            access: (r.access ?? "Allow") as NSGRule["access"],
            protocol: r.protocol ?? "*",
            sourceAddressPrefix: r.sourceAddressPrefix,
            destinationAddressPrefix: r.destinationAddressPrefix,
            sourcePortRange: r.sourcePortRange,
            destinationPortRange: r.destinationPortRange,
            description: r.description,
          })),
          tags: n.tags as Record<string, string>,
        };
      } catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return null; throw e; }
    }, this.retryOptions);
  }

  /**
   * List NSG rules for a security group.
   */
  async listNSGRules(resourceGroup: string, nsgName: string): Promise<NSGRule[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const rules: NSGRule[] = [];
      for await (const r of client.securityRules.list(resourceGroup, nsgName)) {
        rules.push({
          id: r.id ?? "", name: r.name ?? "",
          priority: r.priority ?? 0,
          direction: (r.direction ?? "Inbound") as NSGRule["direction"],
          access: (r.access ?? "Allow") as NSGRule["access"],
          protocol: r.protocol ?? "*",
          sourceAddressPrefix: r.sourceAddressPrefix,
          destinationAddressPrefix: r.destinationAddressPrefix,
          sourcePortRange: r.sourcePortRange,
          destinationPortRange: r.destinationPortRange,
          description: r.description,
        });
      }
      return rules;
    }, this.retryOptions);
  }

  /**
   * List load balancers.
   */
  async listLoadBalancers(resourceGroup?: string): Promise<LoadBalancer[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const lbs: LoadBalancer[] = [];
      const iter = resourceGroup
        ? client.loadBalancers.list(resourceGroup)
        : client.loadBalancers.listAll();
      for await (const lb of iter) {
        lbs.push({
          id: lb.id ?? "", name: lb.name ?? "",
          resourceGroup: (lb.id ?? "").match(/resourceGroups\/([^/]+)/i)?.[1] ?? "",
          location: lb.location ?? "", sku: lb.sku?.name,
          provisioningState: lb.provisioningState,
          frontendIPConfigurations: (lb.frontendIPConfigurations ?? []).map((f) => f.id ?? ""),
          backendAddressPools: (lb.backendAddressPools ?? []).map((b) => b.id ?? ""),
          tags: lb.tags as Record<string, string>,
        });
      }
      return lbs;
    }, this.retryOptions);
  }

  /**
   * List public IP addresses.
   */
  async listPublicIPs(resourceGroup?: string): Promise<PublicIPAddress[]> {
    const client = await this.getClient();
    return withAzureRetry(async () => {
      const ips: PublicIPAddress[] = [];
      const iter = resourceGroup
        ? client.publicIPAddresses.list(resourceGroup)
        : client.publicIPAddresses.listAll();
      for await (const ip of iter) {
        ips.push({
          id: ip.id ?? "", name: ip.name ?? "",
          resourceGroup: (ip.id ?? "").match(/resourceGroups\/([^/]+)/i)?.[1] ?? "",
          location: ip.location ?? "", ipAddress: ip.ipAddress,
          allocationMethod: ip.publicIPAllocationMethod,
          sku: ip.sku?.name, dnsLabel: ip.dnsSettings?.domainNameLabel,
          provisioningState: ip.provisioningState,
          tags: ip.tags as Record<string, string>,
        });
      }
      return ips;
    }, this.retryOptions);
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createNetworkManager(
  credentialsManager: AzureCredentialsManager, subscriptionId: string, retryOptions?: AzureRetryOptions,
): AzureNetworkManager {
  return new AzureNetworkManager(credentialsManager, subscriptionId, retryOptions);
}
