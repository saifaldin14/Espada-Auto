/**
 * Azure Container Manager — AKS, ACI, ACR
 */

import type { AzureCredentialsManager } from "../credentials/manager.js";
import type { AzureRetryOptions } from "../types.js";
import { withAzureRetry } from "../retry.js";
import type { AKSCluster, ContainerInstance, ContainerRegistry, AKSClusterCreateOptions } from "./types.js";

export class AzureContainerManager {
  private credentialsManager: AzureCredentialsManager;
  private subscriptionId: string;
  private retryOptions: AzureRetryOptions;

  constructor(credentialsManager: AzureCredentialsManager, subscriptionId: string, retryOptions?: AzureRetryOptions) {
    this.credentialsManager = credentialsManager;
    this.subscriptionId = subscriptionId;
    this.retryOptions = retryOptions ?? {};
  }

  async listAKSClusters(resourceGroup?: string): Promise<AKSCluster[]> {
    const { credential } = await this.credentialsManager.getCredential();
    const { ContainerServiceClient } = await import("@azure/arm-containerservice");
    const client = new ContainerServiceClient(credential, this.subscriptionId);

    return withAzureRetry(async () => {
      const clusters: AKSCluster[] = [];
      const iter = resourceGroup
        ? client.managedClusters.listByResourceGroup(resourceGroup)
        : client.managedClusters.list();

      for await (const c of iter) {
        clusters.push({
          id: c.id ?? "", name: c.name ?? "",
          resourceGroup: this.extractRG(c.id ?? ""),
          location: c.location ?? "",
          kubernetesVersion: c.kubernetesVersion ?? "",
          provisioningState: c.provisioningState ?? "",
          powerState: c.powerState?.code ?? "unknown",
          nodeCount: (c.agentPoolProfiles ?? []).reduce((sum, p) => sum + (p.count ?? 0), 0),
          fqdn: c.fqdn,
          agentPoolProfiles: (c.agentPoolProfiles ?? []).map(p => ({
            name: p.name ?? "", count: p.count ?? 0, vmSize: p.vmSize ?? "",
            osType: p.osType ?? "Linux", mode: (p.mode as "System" | "User") ?? "System",
            enableAutoScaling: p.enableAutoScaling ?? false,
            minCount: p.minCount, maxCount: p.maxCount,
          })),
          tags: c.tags as Record<string, string>,
        });
      }
      return clusters;
    }, this.retryOptions);
  }

  async listContainerInstances(resourceGroup?: string): Promise<ContainerInstance[]> {
    const { credential } = await this.credentialsManager.getCredential();
    const { ContainerInstanceManagementClient } = await import("@azure/arm-containerinstance");
    const client = new ContainerInstanceManagementClient(credential, this.subscriptionId);

    return withAzureRetry(async () => {
      const instances: ContainerInstance[] = [];
      const iter = resourceGroup
        ? client.containerGroups.listByResourceGroup(resourceGroup)
        : client.containerGroups.list();

      for await (const cg of iter) {
        instances.push({
          id: cg.id ?? "", name: cg.name ?? "",
          resourceGroup: this.extractRG(cg.id ?? ""),
          location: cg.location ?? "", osType: cg.osType ?? "",
          state: cg.provisioningState ?? "",
          containers: (cg.containers ?? []).map(c => ({
            name: c.name, image: c.image,
            cpu: c.resources?.requests?.cpu ?? 0,
            memoryInGB: c.resources?.requests?.memoryInGB ?? 0,
            ports: (c.ports ?? []).map(p => p.port),
          })),
          ipAddress: cg.ipAddress?.ip,
          tags: cg.tags as Record<string, string>,
        });
      }
      return instances;
    }, this.retryOptions);
  }

  async listContainerRegistries(resourceGroup?: string): Promise<ContainerRegistry[]> {
    const { credential } = await this.credentialsManager.getCredential();
    const { ContainerRegistryManagementClient } = await import("@azure/arm-containerregistry");
    const client = new ContainerRegistryManagementClient(credential, this.subscriptionId);

    return withAzureRetry(async () => {
      const registries: ContainerRegistry[] = [];
      const iter = resourceGroup
        ? client.registries.listByResourceGroup(resourceGroup)
        : client.registries.list();

      for await (const r of iter) {
        registries.push({
          id: r.id ?? "", name: r.name ?? "",
          resourceGroup: this.extractRG(r.id ?? ""),
          location: r.location ?? "", sku: r.sku?.name ?? "",
          loginServer: r.loginServer ?? "",
          adminUserEnabled: r.adminUserEnabled ?? false,
          tags: r.tags as Record<string, string>,
        });
      }
      return registries;
    }, this.retryOptions);
  }

  private extractRG(id: string): string {
    return id.match(/resourceGroups\/([^/]+)/i)?.[1] ?? "";
  }

  /**
   * Create an AKS cluster.
   */
  async createAKSCluster(options: AKSClusterCreateOptions): Promise<AKSCluster> {
    const { credential } = await this.credentialsManager.getCredential();
    const { ContainerServiceClient } = await import("@azure/arm-containerservice");
    const client = new ContainerServiceClient(credential, this.subscriptionId);

    return withAzureRetry(async () => {
      const c = await client.managedClusters.beginCreateOrUpdateAndWait(
        options.resourceGroup, options.name,
        {
          location: options.location,
          kubernetesVersion: options.kubernetesVersion ?? "1.29",
          dnsPrefix: options.dnsPrefix ?? options.name,
          agentPoolProfiles: [{
            name: options.nodePoolName ?? "nodepool1",
            count: options.nodeCount ?? 3,
            vmSize: options.vmSize ?? "Standard_D2s_v5",
            osType: "Linux",
            mode: "System",
            enableAutoScaling: options.enableAutoScaling ?? false,
            minCount: options.minCount,
            maxCount: options.maxCount,
          }],
          identity: { type: "SystemAssigned" },
          tags: options.tags,
        },
      );
      return {
        id: c.id ?? "", name: c.name ?? "", resourceGroup: options.resourceGroup,
        location: c.location ?? "", kubernetesVersion: c.kubernetesVersion ?? "",
        provisioningState: c.provisioningState ?? "", powerState: c.powerState?.code ?? "unknown",
        nodeCount: (c.agentPoolProfiles ?? []).reduce((sum, p) => sum + (p.count ?? 0), 0),
        fqdn: c.fqdn,
        agentPoolProfiles: (c.agentPoolProfiles ?? []).map(p => ({
          name: p.name ?? "", count: p.count ?? 0, vmSize: p.vmSize ?? "",
          osType: p.osType ?? "Linux", mode: (p.mode as "System" | "User") ?? "System",
          enableAutoScaling: p.enableAutoScaling ?? false, minCount: p.minCount, maxCount: p.maxCount,
        })),
        tags: c.tags as Record<string, string>,
      };
    }, this.retryOptions);
  }

  /**
   * Delete an AKS cluster.
   */
  async deleteAKSCluster(resourceGroup: string, name: string): Promise<void> {
    const { credential } = await this.credentialsManager.getCredential();
    const { ContainerServiceClient } = await import("@azure/arm-containerservice");
    const client = new ContainerServiceClient(credential, this.subscriptionId);
    await withAzureRetry(() => client.managedClusters.beginDeleteAndWait(resourceGroup, name), this.retryOptions);
  }

  /**
   * Scale an AKS node pool.
   */
  async scaleNodePool(resourceGroup: string, clusterName: string, nodePoolName: string, count: number): Promise<void> {
    const { credential } = await this.credentialsManager.getCredential();
    const { ContainerServiceClient } = await import("@azure/arm-containerservice");
    const client = new ContainerServiceClient(credential, this.subscriptionId);
    await withAzureRetry(async () => {
      await client.agentPools.beginCreateOrUpdateAndWait(resourceGroup, clusterName, nodePoolName, {
        count,
      });
    }, this.retryOptions);
  }

  /**
   * Get AKS cluster credentials (kubeconfig).
   */
  async getClusterCredentials(resourceGroup: string, clusterName: string): Promise<string> {
    const { credential } = await this.credentialsManager.getCredential();
    const { ContainerServiceClient } = await import("@azure/arm-containerservice");
    const client = new ContainerServiceClient(credential, this.subscriptionId);
    return withAzureRetry(async () => {
      const result = await client.managedClusters.listClusterUserCredentials(resourceGroup, clusterName);
      const kubeconfigs = result.kubeconfigs ?? [];
      if (kubeconfigs.length === 0) return "";
      const buf = kubeconfigs[0].value;
      if (!buf) return "";
      return new TextDecoder().decode(buf);
    }, this.retryOptions);
  }
}

export function createContainerManager(
  credentialsManager: AzureCredentialsManager, subscriptionId: string, retryOptions?: AzureRetryOptions,
): AzureContainerManager {
  return new AzureContainerManager(credentialsManager, subscriptionId, retryOptions);
}
