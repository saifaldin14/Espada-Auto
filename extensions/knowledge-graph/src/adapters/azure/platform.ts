/**
 * Azure Adapter — Platform Domain Module
 *
 * Discovers Azure resource groups, subscriptions/locations,
 * and enterprise management groups, mapping them into the knowledge graph.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge } from "./utils.js";

// =============================================================================
// Resource Groups Discovery
// =============================================================================

/**
 * Discover ARM resource groups and deployments.
 */
export async function discoverResourceGroupsDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getResourcesManager();
  if (!mgr) return;

  const m = mgr as {
    listResourceGroups?: () => Promise<unknown[]>;
    listDeployments?: (rgName: string) => Promise<unknown[]>;
  };

  const rgs = await m.listResourceGroups?.() ?? [];
  for (const raw of rgs) {
    const rg = raw as Record<string, unknown>;
    const id = (rg["id"] as string) ?? "";
    const name = (rg["name"] as string) ?? "resource-group";
    const location = (rg["location"] as string) ?? "unknown";

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
      tags: (rg["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.resources/resourcegroups",
        provisioningState: (rg["provisioningState"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });

    // Link resource group to its subscription
    const subNodeId = buildAzureNodeId(
      ctx.subscriptionId,
      "custom",
      ctx.subscriptionId,
    );
    const subNode = nodes.find((n) => n.id === subNodeId);
    if (subNode) {
      edges.push(makeAzureEdge(subNodeId, nodeId, "contains"));
    }

    // Link existing nodes to their resource groups
    for (const n of nodes) {
      if (
        n.nativeId &&
        n.nativeId.toLowerCase().includes(`/resourcegroups/${name.toLowerCase()}/`) &&
        n.id !== nodeId
      ) {
        edges.push(makeAzureEdge(nodeId, n.id, "contains"));
      }
    }
  }
}

// =============================================================================
// Subscriptions Discovery
// =============================================================================

/**
 * Discover Azure subscriptions and available locations.
 */
export async function discoverSubscriptionsDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getSubscriptionsManager();
  if (!mgr) return;

  const m = mgr as {
    listSubscriptions?: () => Promise<unknown[]>;
    listLocations?: (subscriptionId: string) => Promise<unknown[]>;
  };

  const subs = await m.listSubscriptions?.() ?? [];
  for (const raw of subs) {
    const s = raw as Record<string, unknown>;
    const subId = (s["subscriptionId"] as string) ?? "";
    const name = (s["displayName"] as string) ?? "subscription";
    const state = (s["state"] as string) ?? "";

    const nodeId = buildAzureNodeId(subId, "custom", subId);
    // Avoid duplicating if we already created a subscription node
    if (nodes.some((n) => n.id === nodeId)) continue;

    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "custom",
      nativeId: `/subscriptions/${subId}`,
      name,
      region: "global",
      account: subId,
      status: state.toLowerCase() === "disabled" ? "stopped" : "running",
      tags: {},
      metadata: {
        azureResourceType: "microsoft.resources/subscriptions",
        state,
        tenantId: (s["tenantId"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });
  }
}

// =============================================================================
// Enterprise / Management Groups Discovery
// =============================================================================

/**
 * Discover Azure management groups (enterprise hierarchy).
 */
export async function discoverEnterpriseDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getEnterpriseManager();
  if (!mgr) return;

  const m = mgr as {
    listManagementGroups?: () => Promise<unknown[]>;
  };

  const groups = await m.listManagementGroups?.() ?? [];
  for (const raw of groups) {
    const g = raw as Record<string, unknown>;
    const id = (g["id"] as string) ?? "";
    const name = (g["displayName"] as string) ?? (g["name"] as string) ?? "mgmt-group";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "custom", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "custom",
      nativeId: id,
      name,
      region: "global",
      account: ctx.subscriptionId,
      status: "running",
      tags: {},
      metadata: {
        azureResourceType: "microsoft.management/managementgroups",
        tenantId: (g["tenantId"] as string) ?? null,
        parentId:
          ((g["details"] as Record<string, unknown>)?.["parent"] as Record<string, unknown>)?.["id"] ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });

    // Link child management groups / subscriptions via parentId
    const parentId =
      ((g["details"] as Record<string, unknown>)?.["parent"] as Record<string, unknown>)?.["id"];
    if (typeof parentId === "string") {
      const parentNode = nodes.find(
        (n) => n.nativeId?.toLowerCase() === parentId.toLowerCase(),
      );
      if (parentNode) {
        edges.push(makeAzureEdge(parentNode.id, nodeId, "contains"));
      }
    }
  }
}
