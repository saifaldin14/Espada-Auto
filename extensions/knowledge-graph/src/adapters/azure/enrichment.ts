/**
 * Azure Adapter — Enrichment Domain Module
 *
 * Post-discovery enrichment: cost data, monitoring metrics,
 * activity log events, and resource tagging.
 */

import type { GraphNodeInput, GraphEdgeInput } from "../../types.js";
import type { AzureAdapterContext } from "./context.js";

/**
 * Enrich nodes with cost data from Azure Cost Management.
 */
export async function enrichWithCostData(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getCostManager();
  if (!mgr) return;

  const m = mgr as {
    queryCosts: (options?: {
      timeframe?: string;
      granularity?: string;
      groupBy?: string[];
    }) => Promise<{
      columns: Array<{ name: string; type: string }>;
      rows: unknown[][];
    }>;
  };

  try {
    // Query costs grouped by resource ID for the last 30 days
    const result = await m.queryCosts({
      timeframe: "MonthToDate",
      granularity: "None",
      groupBy: ["ResourceId"],
    });

    if (!result.rows || !result.columns) return;

    // Find column indices
    const resourceIdCol = result.columns.findIndex((c) => c.name.toLowerCase() === "resourceid");
    const costCol = result.columns.findIndex((c) => c.name.toLowerCase().includes("cost") || c.name.toLowerCase().includes("amount"));
    if (resourceIdCol === -1 || costCol === -1) return;

    // Build resourceId → cost map
    const costMap = new Map<string, number>();
    for (const row of result.rows) {
      const resourceId = String(row[resourceIdCol] ?? "").toLowerCase();
      const cost = Number(row[costCol] ?? 0);
      if (resourceId && cost > 0) {
        costMap.set(resourceId, cost);
      }
    }

    // Apply costs to nodes
    for (const node of nodes) {
      if (node.provider !== "azure") continue;
      const cost = costMap.get(node.nativeId.toLowerCase());
      if (cost !== undefined) {
        node.costMonthly = cost;
        node.metadata.costSource = "cost-manager";
      }
    }
  } catch {
    // Cost enrichment failed — static estimates remain as fallback
  }
}

/**
 * Enrich nodes with monitoring data (alert rules, diagnostic settings).
 */
export async function enrichWithMonitoring(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getMonitorManager();
  if (!mgr) return;

  const m = mgr as {
    listLogAnalyticsWorkspaces: (rg?: string) => Promise<Array<{
      id: string;
      name: string;
      resourceGroup: string;
      location: string;
      retentionInDays?: number;
      customerId?: string;
    }>>;
  };

  // Discover Log Analytics workspaces
  try {
    const workspaces = await m.listLogAnalyticsWorkspaces();
    for (const ws of workspaces) {
      if (!ws.id) continue;

      // Only enrich if not already discovered
      const existing = nodes.find((n) => n.nativeId.toLowerCase() === ws.id.toLowerCase());
      if (existing) {
        existing.metadata.retentionInDays = ws.retentionInDays;
        existing.metadata.workspaceId = ws.customerId;
        existing.metadata.discoverySource = "monitor-manager";
        continue;
      }

      // Create Log Analytics workspace node — it links to monitored resources
      const { buildAzureNodeId } = await import("./utils.js");
      const nodeId = buildAzureNodeId(ctx.subscriptionId, "custom", ws.id);

      nodes.push({
        id: nodeId,
        name: ws.name,
        resourceType: "custom",
        provider: "azure",
        region: ws.location,
        account: ctx.subscriptionId,
        nativeId: ws.id,
        status: "running",
        tags: {},
        metadata: {
          resourceGroup: ws.resourceGroup,
          resourceSubtype: "log-analytics-workspace",
          retentionInDays: ws.retentionInDays,
          workspaceId: ws.customerId,
          discoverySource: "monitor-manager",
        },
        costMonthly: null,
        owner: null,
        createdAt: null,
      });
    }
  } catch {
    // Log Analytics discovery failed
  }
}

/**
 * Enrich nodes with activity log events for change tracking.
 */
export async function enrichWithActivityLog(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getActivityLogManager();
  if (!mgr) return;

  const m = mgr as {
    getEvents: (filter?: { startTime?: string; endTime?: string }) => Promise<Array<{
      operationName?: string;
      status?: string;
      caller?: string;
      timestamp?: string;
      resourceId?: string;
      level?: string;
    }>>;
  };

  try {
    // Get recent activity (last 24 hours)
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const events = await m.getEvents({
      startTime: dayAgo.toISOString(),
      endTime: now.toISOString(),
    });

    // Track recent changes per resource
    const changeMap = new Map<string, { count: number; lastCaller?: string; lastOp?: string }>();
    for (const event of events) {
      if (!event.resourceId) continue;
      const key = event.resourceId.toLowerCase();
      const existing = changeMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        changeMap.set(key, {
          count: 1,
          lastCaller: event.caller,
          lastOp: event.operationName,
        });
      }
    }

    // Enrich nodes with change data
    for (const node of nodes) {
      if (node.provider !== "azure") continue;
      const changes = changeMap.get(node.nativeId.toLowerCase());
      if (changes) {
        node.metadata.recentChangeCount = changes.count;
        node.metadata.lastChangeCaller = changes.lastCaller;
        node.metadata.lastChangeOperation = changes.lastOp;
      }
    }
  } catch {
    // Activity log enrichment failed
  }
}

/**
 * Enrich nodes with tag-based metadata from the Tagging manager.
 * Fills in missing tags by querying the Azure resource tagging API.
 */
export async function enrichWithTagData(
  ctx: AzureAdapterContext,
  nodes: GraphNodeInput[],
  _edges: GraphEdgeInput[],
): Promise<void> {
  const mgr = await ctx.getTaggingManager();
  if (!mgr) return;

  const m = mgr as {
    listTags?: (resourceId?: string) => Promise<unknown[]>;
    getTagsForResource?: (resourceId: string) => Promise<Record<string, string> | null>;
  };

  try {
    // For nodes missing tags, try to backfill from tagging API
    for (const node of nodes) {
      if (node.provider !== "azure" || !node.nativeId) continue;
      // Only backfill if the node has no tags
      if (node.tags && Object.keys(node.tags).length > 0) continue;

      const tags = await m.getTagsForResource?.(node.nativeId);
      if (tags && Object.keys(tags).length > 0) {
        node.tags = { ...node.tags, ...tags };
        // Also attempt to set owner from common tag keys
        if (!node.owner) {
          node.owner =
            tags["Owner"] ?? tags["owner"] ?? tags["CreatedBy"] ?? tags["createdBy"] ?? null;
        }
      }
    }
  } catch {
    // Tag enrichment failed
  }
}
