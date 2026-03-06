/**
 * Cost Bridge — Cost Governance ↔ Knowledge Graph
 *
 * Bridges the cost-governance extension's budget management, Infracost
 * integration, and cost policy evaluation with KG's resource topology.
 *
 * Capabilities:
 *   - Sync KG node costs to cost-governance budgets
 *   - Budget utilization tracking from graph topology
 *   - Cost impact analysis using blast radius
 *   - Cost-aware policy evaluation via the policy bridge
 */

import type {
  GraphNode,
  NodeFilter,
} from "../types.js";

import type {
  IntegrationContext,
  BudgetStatus,
  Budget,
} from "./types.js";

// =============================================================================
// Cost Bridge
// =============================================================================

export class CostBridge {
  constructor(
    private readonly ctx: IntegrationContext,
  ) {}

  /**
   * Aggregate graph costs by various dimensions and return a summary.
   * Works with or without the cost-governance extension.
   */
  async getCostSummary(filter?: NodeFilter): Promise<CostSummary> {
    const nodes = await this.ctx.storage.queryNodes(filter ?? {});

    let totalMonthly = 0;
    const byProvider: Record<string, number> = {};
    const byResourceType: Record<string, number> = {};
    const byAccount: Record<string, number> = {};
    const byRegion: Record<string, number> = {};
    const topResources: Array<{ id: string; name: string; cost: number; type: string }> = [];

    for (const node of nodes) {
      const cost = node.costMonthly ?? 0;
      if (cost <= 0) continue;

      totalMonthly += cost;
      byProvider[node.provider] = (byProvider[node.provider] ?? 0) + cost;
      byResourceType[node.resourceType] = (byResourceType[node.resourceType] ?? 0) + cost;
      byAccount[node.account] = (byAccount[node.account] ?? 0) + cost;
      byRegion[node.region] = (byRegion[node.region] ?? 0) + cost;

      topResources.push({ id: node.id, name: node.name, cost, type: node.resourceType });
    }

    // Sort top resources by cost descending
    topResources.sort((a, b) => b.cost - a.cost);

    return {
      totalMonthly: Math.round(totalMonthly * 100) / 100,
      nodeCount: nodes.length,
      costlyNodeCount: topResources.length,
      byProvider,
      byResourceType,
      byAccount,
      byRegion,
      topResources: topResources.slice(0, 20),
    };
  }

  /**
   * Get budget status for all budgets from the cost-governance extension.
   * Returns empty array if cost-governance is unavailable.
   */
  getBudgets(): Array<Budget & { status: BudgetStatus }> {
    if (!this.ctx.available.costGovernance || !this.ctx.ext.budgetManager) {
      return [];
    }

    const budgets = this.ctx.ext.budgetManager.listBudgets();
    return budgets.map((b) => ({
      ...b,
      status: this.ctx.ext.budgetManager!.getStatus(b),
    }));
  }

  /**
   * Sync graph costs into cost-governance budgets.
   * Groups costs by the budget's scope dimension (team, project, environment, global).
   */
  async syncCostsToBudgets(): Promise<{
    synced: number;
    budgets: Array<{ id: string; name: string; spend: number; status: BudgetStatus }>;
  }> {
    if (!this.ctx.available.costGovernance || !this.ctx.ext.budgetManager) {
      return { synced: 0, budgets: [] };
    }

    const budgets = this.ctx.ext.budgetManager.listBudgets();
    const syncedBudgets: Array<{ id: string; name: string; spend: number; status: BudgetStatus }> = [];

    for (const budget of budgets) {
      const spend = await this.computeBudgetSpend(budget);
      const updated = this.ctx.ext.budgetManager.updateSpend(budget.id, spend);
      const fullBudget = updated ?? budget;
      const status = this.ctx.ext.budgetManager.getStatus(fullBudget);
      syncedBudgets.push({
        id: budget.id,
        name: budget.name,
        spend: Math.round(spend * 100) / 100,
        status,
      });
    }

    return { synced: syncedBudgets.length, budgets: syncedBudgets };
  }

  /**
   * Calculate the cost impact of removing or modifying a resource,
   * including all resources in its blast radius.
   */
  async getCostImpact(
    nodeId: string,
    depth: number = 3,
  ): Promise<{
    directCost: number;
    blastRadiusCost: number;
    totalImpact: number;
    affectedNodes: Array<{ id: string; name: string; cost: number; hop: number }>;
  }> {
    const node = await this.ctx.storage.getNode(nodeId);
    const directCost = node?.costMonthly ?? 0;

    try {
      const blast = await this.ctx.engine.getBlastRadius(nodeId, depth);
      const affectedNodes: Array<{ id: string; name: string; cost: number; hop: number }> = [];

      for (const [hop, nodeIds] of blast.hops.entries()) {
        for (const nid of nodeIds) {
          if (nid === nodeId) continue; // Skip the root node
          const n = blast.nodes.get(nid);
          if (n && (n.costMonthly ?? 0) > 0) {
            affectedNodes.push({
              id: n.id,
              name: n.name,
              cost: n.costMonthly!,
              hop,
            });
          }
        }
      }

      affectedNodes.sort((a, b) => b.cost - a.cost);

      return {
        directCost,
        blastRadiusCost: blast.totalCostMonthly - directCost,
        totalImpact: blast.totalCostMonthly,
        affectedNodes,
      };
    } catch {
      return {
        directCost,
        blastRadiusCost: 0,
        totalImpact: directCost,
        affectedNodes: [],
      };
    }
  }

  /**
   * Default resource types that typically don't have direct costs.
   */
  static readonly DEFAULT_FREE_RESOURCE_TYPES = [
    "vpc", "subnet", "security-group", "route-table", "internet-gateway",
  ] as const;

  /**
   * Find resources with no cost data (potential untracked spend).
   * @param filter - Optional node filter.
   * @param excludedTypes - Resource types to exclude (defaults to DEFAULT_FREE_RESOURCE_TYPES).
   */
  async findUntrackedResources(
    filter?: NodeFilter,
    excludedTypes?: string[],
  ): Promise<GraphNode[]> {
    const excluded = new Set(excludedTypes ?? CostBridge.DEFAULT_FREE_RESOURCE_TYPES);
    const nodes = await this.ctx.storage.queryNodes(filter ?? {});
    return nodes.filter(
      (n) =>
        n.costMonthly == null &&
        n.status === "running" &&
        !excluded.has(n.resourceType),
    );
  }

  /**
   * Get cost trends from the graph's change log.
   */
  async getCostTrends(days: number = 30): Promise<Array<{
    date: string;
    totalCost: number;
    changes: number;
  }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const changes = await this.ctx.storage.getChanges({
      changeType: ["cost-changed"],
      since,
    });

    // Group by day
    const byDate = new Map<string, { totalDelta: number; count: number }>();
    for (const change of changes) {
      const date = change.detectedAt.split("T")[0]!;
      const entry = byDate.get(date) ?? { totalDelta: 0, count: 0 };
      const delta = parseFloat(change.newValue ?? "0") - parseFloat(change.previousValue ?? "0");
      entry.totalDelta += delta;
      entry.count++;
      byDate.set(date, entry);
    }

    // Build cumulative trend
    const stats = await this.ctx.storage.getStats();
    let runningTotal = stats.totalCostMonthly;

    return [...byDate.entries()]
      .sort(([a], [b]) => b.localeCompare(a)) // newest first
      .map(([date, entry]) => {
        const result = { date, totalCost: Math.max(0, Math.round(runningTotal * 100) / 100), changes: entry.count };
        runningTotal -= entry.totalDelta;
        return result;
      })
      .reverse();
  }

  // -- Private helpers --------------------------------------------------------

  /**
   * Compute the current spend for a budget based on its scope.
   */
  private async computeBudgetSpend(budget: Budget): Promise<number> {
    let filter: NodeFilter = {};

    switch (budget.scope) {
      case "team":
        filter = { owner: budget.scopeId };
        break;
      case "project":
        filter = { tags: { project: budget.scopeId } };
        break;
      case "environment":
        filter = { tags: { environment: budget.scopeId } };
        break;
      case "global":
        // No filter — all nodes
        break;
    }

    const nodes = await this.ctx.storage.queryNodes(filter);
    return nodes.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0);
  }
}

// =============================================================================
// Types
// =============================================================================

export type CostSummary = {
  totalMonthly: number;
  nodeCount: number;
  costlyNodeCount: number;
  byProvider: Record<string, number>;
  byResourceType: Record<string, number>;
  byAccount: Record<string, number>;
  byRegion: Record<string, number>;
  topResources: Array<{ id: string; name: string; cost: number; type: string }>;
};

// =============================================================================
// Format Helper
// =============================================================================

export function formatCostBridgeMarkdown(summary: CostSummary): string {
  const lines: string[] = [
    "# Cost Summary",
    "",
    `**Total Monthly Cost:** $${summary.totalMonthly.toLocaleString()}`,
    `**Resources with Cost:** ${summary.costlyNodeCount} / ${summary.nodeCount}`,
    "",
  ];

  // By provider
  if (Object.keys(summary.byProvider).length > 0) {
    lines.push(
      "## By Provider",
      "",
      "| Provider | Monthly Cost |",
      "|----------|-------------|",
      ...Object.entries(summary.byProvider)
        .sort(([, a], [, b]) => b - a)
        .map(([p, c]) => `| ${p} | $${c.toLocaleString()} |`),
      "",
    );
  }

  // Top resources
  if (summary.topResources.length > 0) {
    lines.push(
      "## Top Resources",
      "",
      "| Name | Type | Monthly Cost |",
      "|------|------|-------------|",
      ...summary.topResources.slice(0, 10).map(
        (r) => `| ${r.name} | ${r.type} | $${r.cost.toLocaleString()} |`,
      ),
      "",
    );
  }

  return lines.join("\n");
}
