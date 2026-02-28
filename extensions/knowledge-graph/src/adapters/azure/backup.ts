/**
 * Azure Adapter — Backup Domain Module
 *
 * Discovers Recovery Services vaults, backup policies, and protected items
 * via AzureBackupManager.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge, mapAzureStatus, findNodeByNativeId, pushEdgeIfNew } from "./utils.js";

/**
 * Discover deeper backup resources via AzureBackupManager.
 */
export async function discoverBackupDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getBackupManager();
  if (!mgr) return;

  const m = mgr as {
    listVaults: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      sku?: string;
      provisioningState?: string;
      tags?: Record<string, string>;
    }>>;
    listBackupItems: (rg: string, vaultName: string) => Promise<Array<{
      id?: string;
      name?: string;
      sourceResourceId?: string;
      protectionStatus?: string;
      lastBackupTime?: string;
      policyId?: string;
    }>>;
    listBackupPolicies: (rg: string, vaultName: string) => Promise<Array<{
      id?: string;
      name?: string;
      backupManagementType?: string;
    }>>;
  };

  try {
    const vaults = await m.listVaults();
    for (const vault of vaults) {
      if (!vault.id) continue;

      const nodeId = buildAzureNodeId(ctx.subscriptionId, "custom", vault.id);
      const tags = vault.tags ?? {};

      // Recovery Services Vaults don't have a direct graph type — use custom
      const existing = findNodeByNativeId(nodes, vault.id);
      if (!existing) {
        nodes.push({
          id: nodeId,
          name: vault.name,
          resourceType: "custom",
          provider: "azure",
          region: vault.location,
          account: ctx.subscriptionId,
          nativeId: vault.id,
          status: mapAzureStatus(vault.provisioningState),
          tags,
          metadata: {
            resourceGroup: vault.resourceGroup,
            resourceSubtype: "recovery-services-vault",
            vaultSku: vault.sku,
            discoverySource: "backup-manager",
          },
          costMonthly: null,
          owner: tags["Owner"] ?? tags["owner"] ?? null,
          createdAt: null,
        });
      }

      const vaultNodeId = existing?.id ?? nodeId;

      // Discover backup items and link to their source resources
      try {
        const items = await m.listBackupItems(vault.resourceGroup, vault.name);
        for (const item of items) {
          if (!item.sourceResourceId) continue;

          const sourceNode = findNodeByNativeId(nodes, item.sourceResourceId);
          if (sourceNode) {
            pushEdgeIfNew(edges, makeAzureEdge(vaultNodeId, sourceNode.id, "backs-up", {
              field: "backupItem",
              protectionStatus: item.protectionStatus,
              lastBackupTime: item.lastBackupTime,
            }));
          }
        }
      } catch {
        // Backup items enumeration failed
      }
    }
  } catch {
    // Backup vault discovery failed
  }
}
