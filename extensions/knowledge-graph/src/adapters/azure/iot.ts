/**
 * Azure Adapter — IoT / Realtime Domain Module
 *
 * Discovers Azure SignalR, Digital Twins, Notification Hubs, and Maps accounts,
 * mapping them into the knowledge graph.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId } from "./utils.js";

// =============================================================================
// SignalR Discovery
// =============================================================================

/**
 * Discover Azure SignalR Service instances.
 */
export async function discoverSignalRDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getSignalRManager();
  if (!mgr) return;

  const m = mgr as {
    listInstances?: () => Promise<unknown[]>;
  };

  const instances = await m.listInstances?.() ?? [];
  for (const raw of instances) {
    const s = raw as Record<string, unknown>;
    const id = (s["id"] as string) ?? "";
    const name = (s["name"] as string) ?? "signalr";
    const location = (s["location"] as string) ?? "unknown";

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
      tags: (s["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.signalrservice/signalr",
        sku: (s["sku"] as Record<string, unknown>)?.["name"] ?? null,
        hostName: (s["hostName"] as string) ?? null,
        publicNetworkAccess: (s["publicNetworkAccess"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });
  }
}

// =============================================================================
// Digital Twins Discovery
// =============================================================================

/**
 * Discover Azure Digital Twins instances.
 */
export async function discoverDigitalTwinsDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getDigitalTwinsManager();
  if (!mgr) return;

  const m = mgr as {
    listInstances?: () => Promise<unknown[]>;
  };

  const instances = await m.listInstances?.() ?? [];
  for (const raw of instances) {
    const dt = raw as Record<string, unknown>;
    const id = (dt["id"] as string) ?? "";
    const name = (dt["name"] as string) ?? "digital-twins";
    const location = (dt["location"] as string) ?? "unknown";

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
      tags: (dt["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.digitaltwins/digitaltwinsinstances",
        hostName: (dt["hostName"] as string) ?? null,
        publicNetworkAccess: (dt["publicNetworkAccess"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });
  }
}

// =============================================================================
// Notification Hubs Discovery
// =============================================================================

/**
 * Discover Azure Notification Hub namespaces and hubs.
 */
export async function discoverNotificationHubsDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getNotificationHubsManager();
  if (!mgr) return;

  const m = mgr as {
    listNamespaces?: () => Promise<unknown[]>;
  };

  const namespaces = await m.listNamespaces?.() ?? [];
  for (const raw of namespaces) {
    const ns = raw as Record<string, unknown>;
    const id = (ns["id"] as string) ?? "";
    const name = (ns["name"] as string) ?? "notification-hub-ns";
    const location = (ns["location"] as string) ?? "unknown";

    const nodeId = buildAzureNodeId(ctx.subscriptionId, "topic", id);
    nodes.push({
      id: nodeId,
      provider: "azure",
      resourceType: "topic",
      nativeId: id,
      name,
      region: location,
      account: ctx.subscriptionId,
      status: "running",
      tags: (ns["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.notificationhubs/namespaces",
        sku: (ns["sku"] as Record<string, unknown>)?.["name"] ?? null,
        serviceBusEndpoint: (ns["serviceBusEndpoint"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });
  }
}

// =============================================================================
// Azure Maps Discovery
// =============================================================================

/**
 * Discover Azure Maps accounts.
 */
export async function discoverMapsDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getMapsManager();
  if (!mgr) return;

  const m = mgr as {
    listAccounts?: () => Promise<unknown[]>;
  };

  const accounts = await m.listAccounts?.() ?? [];
  for (const raw of accounts) {
    const a = raw as Record<string, unknown>;
    const id = (a["id"] as string) ?? "";
    const name = (a["name"] as string) ?? "maps-account";
    const location = (a["location"] as string) ?? "unknown";

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
      tags: (a["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.maps/accounts",
        sku: (a["sku"] as Record<string, unknown>)?.["name"] ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });
  }
}
