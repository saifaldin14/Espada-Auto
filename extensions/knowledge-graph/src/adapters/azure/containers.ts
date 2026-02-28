/**
 * Azure Adapter — Containers Domain Module
 *
 * Discovers AKS clusters, ACI container groups, and ACR registries
 * via AzureContainerManager for deeper enrichment (node pools,
 * container details, registry info).
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge, mapAzureStatus, findNodeByNativeId, pushEdgeIfNew } from "./utils.js";

/**
 * Discover deeper container resources via AzureContainerManager.
 */
export async function discoverContainersDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getContainerManager();
  if (!mgr) return;

  const m = mgr as {
    listAKSClusters: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      kubernetesVersion?: string;
      provisioningState?: string;
      powerState?: string;
      nodeCount?: number;
      fqdn?: string;
      agentPoolProfiles?: Array<{
        name?: string;
        count?: number;
        vmSize?: string;
        osType?: string;
        mode?: string;
      }>;
      tags?: Record<string, string>;
    }>>;
    listContainerInstances: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      osType?: string;
      state?: string;
      containers?: Array<{
        name?: string;
        image?: string;
        cpu?: number;
        memoryInGB?: number;
      }>;
      ipAddress?: string;
      tags?: Record<string, string>;
    }>>;
    listContainerRegistries: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      sku?: string;
      loginServer?: string;
      adminUserEnabled?: boolean;
      tags?: Record<string, string>;
    }>>;
  };

  // --- AKS Clusters ---
  try {
    const clusters = await m.listAKSClusters();
    for (const cluster of clusters) {
      if (!cluster.id) continue;

      const existing = findNodeByNativeId(nodes, cluster.id);
      if (existing) {
        // Enrich existing AKS node
        if (cluster.kubernetesVersion) existing.metadata.k8sVersion = cluster.kubernetesVersion;
        if (cluster.fqdn) existing.metadata.fqdn = cluster.fqdn;
        if (cluster.agentPoolProfiles) {
          existing.metadata.nodePoolCount = cluster.agentPoolProfiles.length;
          existing.metadata.totalNodes = cluster.agentPoolProfiles.reduce(
            (sum, p) => sum + (p.count ?? 0), 0,
          );
          existing.metadata.agentPoolProfiles = cluster.agentPoolProfiles;
        }
        existing.metadata.discoverySource = "container-manager";
        continue;
      }

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "cluster", cluster.id);
      const tags = cluster.tags ?? {};
      const totalNodes = cluster.agentPoolProfiles?.reduce((sum, p) => sum + (p.count ?? 0), 0) ?? 0;

      nodes.push({
        id: nodeId,
        name: cluster.name,
        resourceType: "cluster",
        provider: "azure",
        region: cluster.location,
        account: ctx.subscriptionId,
        nativeId: cluster.id,
        status: mapAzureStatus(cluster.provisioningState, cluster.powerState),
        tags,
        metadata: {
          resourceGroup: cluster.resourceGroup,
          k8sVersion: cluster.kubernetesVersion,
          fqdn: cluster.fqdn,
          nodePoolCount: cluster.agentPoolProfiles?.length,
          totalNodes,
          agentPoolProfiles: cluster.agentPoolProfiles,
          discoverySource: "container-manager",
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });
    }
  } catch {
    // AKS discovery failed — skip silently
  }

  // --- Container Instances ---
  try {
    const instances = await m.listContainerInstances();
    for (const ci of instances) {
      if (!ci.id) continue;

      const existing = findNodeByNativeId(nodes, ci.id);
      if (existing) {
        if (ci.containers) existing.metadata.containers = ci.containers;
        if (ci.ipAddress) existing.metadata.ipAddress = ci.ipAddress;
        existing.metadata.discoverySource = "container-manager";
        continue;
      }

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "container", ci.id);
      const tags = ci.tags ?? {};

      nodes.push({
        id: nodeId,
        name: ci.name,
        resourceType: "container",
        provider: "azure",
        region: ci.location,
        account: ctx.subscriptionId,
        nativeId: ci.id,
        status: ci.state === "Running" ? "running" : ci.state === "Stopped" ? "stopped" : "unknown",
        tags,
        metadata: {
          resourceGroup: ci.resourceGroup,
          osType: ci.osType,
          containers: ci.containers,
          ipAddress: ci.ipAddress,
          discoverySource: "container-manager",
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });
    }
  } catch {
    // ACI discovery failed — skip silently
  }

  // --- Container Registries ---
  try {
    const registries = await m.listContainerRegistries();
    for (const reg of registries) {
      if (!reg.id) continue;

      const existing = findNodeByNativeId(nodes, reg.id);
      if (existing) {
        if (reg.loginServer) existing.metadata.loginServer = reg.loginServer;
        if (reg.sku) existing.metadata.registrySku = reg.sku;
        existing.metadata.adminUserEnabled = reg.adminUserEnabled;
        existing.metadata.discoverySource = "container-manager";
        continue;
      }

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "custom", reg.id);
      const tags = reg.tags ?? {};

      nodes.push({
        id: nodeId,
        name: reg.name,
        resourceType: "custom",
        provider: "azure",
        region: reg.location,
        account: ctx.subscriptionId,
        nativeId: reg.id,
        status: "running",
        tags,
        metadata: {
          resourceGroup: reg.resourceGroup,
          resourceSubtype: "container-registry",
          loginServer: reg.loginServer,
          registrySku: reg.sku,
          adminUserEnabled: reg.adminUserEnabled,
          discoverySource: "container-manager",
        },
        costMonthly: null,
        owner: tags["Owner"] ?? tags["owner"] ?? null,
        createdAt: null,
      });

      // Link registry → AKS clusters that may pull from it
      for (const node of nodes) {
        if (node.resourceType === "cluster" && node.provider === "azure") {
          pushEdgeIfNew(edges, makeAzureEdge(node.id, nodeId, "uses", { field: "containerRegistry" }));
        }
      }
    }
  } catch {
    // ACR discovery failed — skip silently
  }
}
