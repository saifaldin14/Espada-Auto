/**
 * Azure Adapter — Analytics Domain Module
 *
 * Discovers Azure Synapse workspaces/pools and Purview accounts,
 * mapping them into the knowledge graph.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";
import { buildAzureNodeId, makeAzureEdge } from "./utils.js";

// =============================================================================
// Synapse Analytics Discovery
// =============================================================================

/**
 * Discover Azure Synapse workspaces, SQL pools, and Spark pools.
 */
export async function discoverSynapseDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getSynapseManager();
  if (!mgr) return;

  const m = mgr as {
    listWorkspaces?: () => Promise<unknown[]>;
    listSqlPools?: (rgName: string, wsName: string) => Promise<unknown[]>;
    listSparkPools?: (rgName: string, wsName: string) => Promise<unknown[]>;
  };

  const workspaces = await m.listWorkspaces?.() ?? [];
  for (const raw of workspaces) {
    const w = raw as Record<string, unknown>;
    const id = (w["id"] as string) ?? "";
    const name = (w["name"] as string) ?? "synapse-workspace";
    const location = (w["location"] as string) ?? "unknown";

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
      tags: (w["tags"] as Record<string, string>) ?? {},
      metadata: {
        azureResourceType: "microsoft.synapse/workspaces",
        sqlAdminLogin: (w["sqlAdministratorLogin"] as string) ?? null,
        managedResourceGroupName:
          (w["managedResourceGroupName"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });

    // Discover SQL pools
    const rgMatch = id.match(/resourceGroups\/([^/]+)/i);
    const rgName = rgMatch?.[1] ?? "";
    if (rgName && name) {
      const sqlPools = await m.listSqlPools?.(rgName, name) ?? [];
      for (const rawPool of sqlPools) {
        const pool = rawPool as Record<string, unknown>;
        const poolId = (pool["id"] as string) ?? "";
        const poolName = (pool["name"] as string) ?? "sql-pool";

        const poolNodeId = buildAzureNodeId(
          ctx.subscriptionId,
          "database",
          poolId,
        );
        nodes.push({
          id: poolNodeId,
          provider: "azure",
          resourceType: "database",
          nativeId: poolId,
          name: poolName,
          region: location,
          account: ctx.subscriptionId,
          status: (pool["status"] as string) === "Paused" ? "stopped" : "running",
          tags: {},
          metadata: {
            azureResourceType: "microsoft.synapse/workspaces/sqlpools",
            sku: (pool["sku"] as Record<string, unknown>)?.["name"] ?? null,
            maxSizeBytes: (pool["maxSizeBytes"] as number) ?? null,
          },
          costMonthly: null,
          owner: null,
          createdAt: null,
        });
        edges.push(makeAzureEdge(poolNodeId, nodeId, "contains"));
      }

      // Discover Spark pools
      const sparkPools = await m.listSparkPools?.(rgName, name) ?? [];
      for (const rawSpark of sparkPools) {
        const spark = rawSpark as Record<string, unknown>;
        const sparkId = (spark["id"] as string) ?? "";
        const sparkName = (spark["name"] as string) ?? "spark-pool";

        const sparkNodeId = buildAzureNodeId(
          ctx.subscriptionId,
          "cluster",
          sparkId,
        );
        nodes.push({
          id: sparkNodeId,
          provider: "azure",
          resourceType: "cluster",
          nativeId: sparkId,
          name: sparkName,
          region: location,
          account: ctx.subscriptionId,
          status: "running",
          tags: {},
          metadata: {
            azureResourceType: "microsoft.synapse/workspaces/bigdatapools",
            nodeCount: (spark["nodeCount"] as number) ?? null,
            nodeSize: (spark["nodeSize"] as string) ?? null,
            autoScale: (spark["autoScale"] as Record<string, unknown>)?.["enabled"] ?? false,
          },
          costMonthly: null,
          owner: null,
          createdAt: null,
        });
        edges.push(makeAzureEdge(sparkNodeId, nodeId, "contains"));
      }
    }
  }
}

// =============================================================================
// Purview Discovery
// =============================================================================

/**
 * Discover Azure Purview (Microsoft Purview) governance accounts.
 */
export async function discoverPurviewDeeper(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getPurviewManager();
  if (!mgr) return;

  const m = mgr as {
    listAccounts?: () => Promise<unknown[]>;
  };

  const accounts = await m.listAccounts?.() ?? [];
  for (const raw of accounts) {
    const a = raw as Record<string, unknown>;
    const id = (a["id"] as string) ?? "";
    const name = (a["name"] as string) ?? "purview-account";
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
        azureResourceType: "microsoft.purview/accounts",
        sku: (a["sku"] as Record<string, unknown>)?.["name"] ?? null,
        publicNetworkAccess: (a["publicNetworkAccess"] as string) ?? null,
      },
      costMonthly: null,
      owner: null,
      createdAt: null,
    });
  }
}
