/**
 * Azure Adapter — Hybrid Domain Module
 *
 * Discovers Azure Arc machines/clusters, HCI clusters, Bastion hosts,
 * and Traffic Manager profiles, mapping them into the knowledge graph.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge } from "./utils.js";

// =============================================================================
// Hybrid / Arc Discovery
// =============================================================================

/**
 * Discover Azure Arc-enabled servers, Arc K8s clusters, and HCI clusters.
 */
export async function discoverHybridDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getHybridManager();
  if (!mgr) return;

  const m = mgr as {
    listArcServers?: () => Promise<unknown[]>;
    listArcKubernetesClusters?: () => Promise<unknown[]>;
    listHCIClusters?: () => Promise<unknown[]>;
  };

  // Arc-enabled servers
  const arcServers = await m.listArcServers?.() ?? [];
  for (const raw of arcServers) {
    const s = raw as Record<string, unknown>;
    const id = (s["id"] as string) ?? "";
    const name = (s["name"] as string) ?? "arc-server";
    const location = (s["location"] as string) ?? "unknown";
    const status = (s["status"] as string) ?? "";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "hybrid-machine", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "hybrid-machine",
      nativeId: id,
      name,
      region: location,
      account: ctx.subscriptionId,
      status: status.toLowerCase() === "connected" ? "running" : "stopped",
      tags: (s["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.hybridcompute/machines",
        osType: (s["osType"] as string) ?? null,
        osSku: (s["osSku"] as string) ?? null,
        agentVersion: (s["agentVersion"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });
  }

  // Arc-enabled Kubernetes clusters
  const arcK8s = await m.listArcKubernetesClusters?.() ?? [];
  for (const raw of arcK8s) {
    const k = raw as Record<string, unknown>;
    const id = (k["id"] as string) ?? "";
    const name = (k["name"] as string) ?? "arc-k8s";
    const location = (k["location"] as string) ?? "unknown";
    const connState = (k["connectivityStatus"] as string) ?? "";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "connected-cluster", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "connected-cluster",
      nativeId: id,
      name,
      region: location,
      account: ctx.subscriptionId,
      status: connState.toLowerCase() === "connected" ? "running" : "stopped",
      tags: (k["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.kubernetes/connectedclusters",
        kubernetesVersion: (k["kubernetesVersion"] as string) ?? null,
        distribution: (k["distribution"] as string) ?? null,
        totalNodeCount: (k["totalNodeCount"] as number) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });
  }

  // HCI clusters
  const hciClusters = await m.listHCIClusters?.() ?? [];
  for (const raw of hciClusters) {
    const h = raw as Record<string, unknown>;
    const id = (h["id"] as string) ?? "";
    const name = (h["name"] as string) ?? "hci-cluster";
    const location = (h["location"] as string) ?? "unknown";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "hci-cluster", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "hci-cluster",
      nativeId: id,
      name,
      region: location,
      account: ctx.subscriptionId,
      status: "running",
      tags: (h["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.azurestackhci/clusters",
        cloudManagementEndpoint: (h["cloudManagementEndpoint"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });
  }
}

// =============================================================================
// Bastion Discovery
// =============================================================================

/**
 * Discover Azure Bastion hosts for secure RDP/SSH access.
 */
export async function discoverBastionDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getBastionManager();
  if (!mgr) return;

  const m = mgr as {
    listBastionHosts?: () => Promise<unknown[]>;
  };

  const bastions = await m.listBastionHosts?.() ?? [];
  for (const raw of bastions) {
    const b = raw as Record<string, unknown>;
    const id = (b["id"] as string) ?? "";
    const name = (b["name"] as string) ?? "bastion-host";
    const location = (b["location"] as string) ?? "unknown";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "custom", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "custom",
      nativeId: id,
      name,
      region: location,
      account: ctx.subscriptionId,
      status: "running",
      tags: (b["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.network/bastionhosts",
        sku: (b["sku"] as Record<string, unknown>)?.["name"] ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });

    // Link Bastion to its VNet
    const ipConfigs = (b["ipConfigurations"] as unknown[]) ?? [];
    for (const ipRaw of ipConfigs) {
      const ip = ipRaw as Record<string, unknown>;
      const subnetId = ((ip["subnet"] as Record<string, unknown>)?.["id"] as string) ?? "";
      if (subnetId) {
        // Extract VNet from subnet ID
        const vnetMatch = subnetId.match(
          /\/virtualNetworks\/([^/]+)/i,
        );
        if (vnetMatch) {
          const vnetNode = nodes.find(
            (n) =>
              n.nativeId?.toLowerCase().includes(
                `/virtualnetworks/${vnetMatch[1].toLowerCase()}`,
              ) && n.resourceType === "vpc",
          );
          if (vnetNode) {
            edges.push(makeAzureEdge(nodeId, vnetNode.id, "connected-to"));
          }
        }
      }
    }
  }
}

// =============================================================================
// Traffic Manager Discovery
// =============================================================================

/**
 * Discover Azure Traffic Manager profiles and endpoints.
 */
export async function discoverTrafficManagerDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getTrafficManagerManager();
  if (!mgr) return;

  const m = mgr as {
    listProfiles?: () => Promise<unknown[]>;
  };

  const profiles = await m.listProfiles?.() ?? [];
  for (const raw of profiles) {
    const p = raw as Record<string, unknown>;
    const id = (p["id"] as string) ?? "";
    const name = (p["name"] as string) ?? "traffic-manager";
    const location = (p["location"] as string) ?? "global";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "load-balancer", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "load-balancer",
      nativeId: id,
      name,
      region: location,
      account: ctx.subscriptionId,
      status:
        (p["profileStatus"] as string)?.toLowerCase() === "disabled"
          ? "stopped"
          : "running",
      tags: (p["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.network/trafficmanagerprofiles",
        routingMethod: (p["trafficRoutingMethod"] as string) ?? null,
        dnsName:
          ((p["dnsConfig"] as Record<string, unknown>)?.["relativeName"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });

    // Discover endpoints and link them
    const endpoints = (p["endpoints"] as unknown[]) ?? [];
    for (const rawEp of endpoints) {
      const ep = rawEp as Record<string, unknown>;
      const targetResourceId = (ep["targetResourceId"] as string) ?? "";

      if (targetResourceId) {
        const target = nodes.find(
          (n) => n.nativeId?.toLowerCase() === targetResourceId.toLowerCase(),
        );
        if (target) {
          edges.push(makeAzureEdge(nodeId, target.id, "load-balances"));
        }
      }
    }
  }
}
