/**
 * Azure Adapter — Storage Domain Module
 *
 * Discovers Storage Accounts and blob containers via AzureStorageManager.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge, mapAzureStatus, findNodeByNativeId, pushEdgeIfNew } from "./utils.js";

/**
 * Discover deeper storage resources via AzureStorageManager.
 */
export async function discoverStorageDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getStorageManager();
  if (!mgr) return;

  const m = mgr as {
    listStorageAccounts: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      kind?: string;
      sku?: string;
      provisioningState?: string;
      primaryEndpoints?: Record<string, string>;
      httpsOnly?: boolean;
      tags?: Record<string, string>;
    }>>;
    listContainers: (rg: string, accountName: string) => Promise<Array<{
      id?: string;
      name: string;
      publicAccess?: string;
      leaseState?: string;
    }>>;
  };

  try {
    const accounts = await m.listStorageAccounts();
    for (const acct of accounts) {
      if (!acct.id) continue;

      const existing = findNodeByNativeId(nodes, acct.id);
      const nodeId = existing?.id ?? buildAzureNodeId(ctx.subscriptionId, "storage", acct.id);

      if (existing) {
        if (acct.kind) existing.metadata.storageKind = acct.kind;
        if (acct.sku) existing.metadata.storageSku = acct.sku;
        if (acct.primaryEndpoints) existing.metadata.endpoints = acct.primaryEndpoints;
        if (acct.httpsOnly === false) existing.metadata.httpOnly = true;
        existing.metadata.discoverySource = "storage-manager";
      } else {
        const tags = acct.tags ?? {};
        nodes.push({
          id: nodeId,
          name: acct.name,
          resourceType: "storage",
          provider: "azure",
          region: acct.location,
          account: ctx.subscriptionId,
          nativeId: acct.id,
          status: mapAzureStatus(acct.provisioningState),
          tags,
          metadata: {
            resourceGroup: acct.resourceGroup,
            storageKind: acct.kind,
            storageSku: acct.sku,
            endpoints: acct.primaryEndpoints,
            httpOnly: acct.httpsOnly === false,
            discoverySource: "storage-manager",
          },
          costMonthly: null,
          owner: tags["Owner"] ?? tags["owner"] ?? null,
          createdAt: null,
        });
      }

      // Discover blob containers within this account
      try {
        const containers = await m.listContainers(acct.resourceGroup, acct.name);
        for (const container of containers) {
          const containerId = container.id ?? `${acct.id}/blobServices/default/containers/${container.name}`;
          const containerNodeId = buildAzureNodeId(ctx.subscriptionId, "storage", containerId);

          // Skip if already discovered
          if (findNodeByNativeId(nodes, containerId)) continue;

          nodes.push({
            id: containerNodeId,
            name: container.name,
            resourceType: "storage",
            provider: "azure",
            region: acct.location,
            account: ctx.subscriptionId,
            nativeId: containerId,
            status: "running",
            tags: {},
            metadata: {
              resourceGroup: acct.resourceGroup,
              resourceSubtype: "blob-container",
              publicAccess: container.publicAccess,
              leaseState: container.leaseState,
              storageAccount: acct.name,
              discoverySource: "storage-manager",
            },
            costMonthly: null,
            owner: null,
            createdAt: null,
          });

          pushEdgeIfNew(edges, makeAzureEdge(containerNodeId, nodeId, "runs-in", { field: "storageAccount" }));
        }
      } catch {
        // Container listing failed for this account
      }
    }
  } catch {
    // Storage discovery failed
  }
}
