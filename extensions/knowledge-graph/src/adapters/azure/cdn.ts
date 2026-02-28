/**
 * Azure Adapter — CDN Domain Module
 *
 * Discovers CDN profiles and endpoints via AzureCDNManager.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge, mapAzureStatus, findNodeByNativeId, pushEdgeIfNew } from "./utils.js";

/**
 * Discover deeper CDN resources via AzureCDNManager.
 */
export async function discoverCDNDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getCDNManager();
  if (!mgr) return;

  const m = mgr as {
    listProfiles: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      sku?: string;
      provisioningState?: string;
      resourceState?: string;
      tags?: Record<string, string>;
    }>>;
    listEndpoints: (rg: string, profileName: string) => Promise<Array<{
      id?: string;
      name: string;
      hostName?: string;
      originHostHeader?: string;
      isHttpAllowed?: boolean;
      isHttpsAllowed?: boolean;
      provisioningState?: string;
    }>>;
  };

  try {
    const profiles = await m.listProfiles();
    for (const profile of profiles) {
      if (!profile.id) continue;

      const existing = findNodeByNativeId(nodes, profile.id);
      const nodeId = existing?.id ?? buildAzureNodeId(ctx.subscriptionId, "cdn", profile.id);

      if (existing) {
        if (profile.sku) existing.metadata.cdnSku = profile.sku;
        existing.metadata.resourceState = profile.resourceState;
        existing.metadata.discoverySource = "cdn-manager";
      } else {
        const tags = profile.tags ?? {};
        nodes.push({
          id: nodeId,
          name: profile.name,
          resourceType: "cdn",
          provider: "azure",
          region: profile.location,
          account: ctx.subscriptionId,
          nativeId: profile.id,
          status: mapAzureStatus(profile.provisioningState),
          tags,
          metadata: {
            resourceGroup: profile.resourceGroup,
            cdnSku: profile.sku,
            resourceState: profile.resourceState,
            discoverySource: "cdn-manager",
          },
          costMonthly: null,
          owner: tags["Owner"] ?? tags["owner"] ?? null,
          createdAt: null,
        });
      }

      // Discover endpoints
      try {
        const endpoints = await m.listEndpoints(profile.resourceGroup, profile.name);
        for (const ep of endpoints) {
          const epId = ep.id ?? `${profile.id}/endpoints/${ep.name}`;
          if (findNodeByNativeId(nodes, epId)) continue;

          const epNodeId = buildAzureNodeId(ctx.subscriptionId, "cdn", epId);
          nodes.push({
            id: epNodeId,
            name: ep.name,
            resourceType: "cdn",
            provider: "azure",
            region: profile.location,
            account: ctx.subscriptionId,
            nativeId: epId,
            status: mapAzureStatus(ep.provisioningState),
            tags: {},
            metadata: {
              resourceGroup: profile.resourceGroup,
              resourceSubtype: "cdn-endpoint",
              hostName: ep.hostName,
              originHostHeader: ep.originHostHeader,
              isHttpAllowed: ep.isHttpAllowed,
              isHttpsAllowed: ep.isHttpsAllowed,
              discoverySource: "cdn-manager",
            },
            costMonthly: null,
            owner: null,
            createdAt: null,
          });

          pushEdgeIfNew(edges, makeAzureEdge(epNodeId, nodeId, "runs-in", { field: "cdnProfile" }));
        }
      } catch {
        // CDN endpoint enumeration failed
      }
    }
  } catch {
    // CDN discovery failed
  }
}
