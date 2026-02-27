/**
 * Infrastructure Knowledge Graph — Agent Cost Allocation
 *
 * Attributes infrastructure costs to individual AI agents based on their
 * resource interactions, actions, and ownership patterns. Provides:
 *
 *   - Per-agent cost breakdown
 *   - Cost allocation by action type (create, scale, monitor, etc.)
 *   - Shared resource cost splitting
 *   - Budget tracking and alerts
 *   - Cost efficiency scoring
 */

import type { GraphStorage, GraphNode, GraphEdge, CloudProvider } from "../types.js";
import {
  getAgents,
  getAgentResources,
  getAgentActivity,
  type AgentActivitySummary,
} from "./agent-model.js";

// =============================================================================
// Types
// =============================================================================

/** Cost allocation method for shared resources. */
export type AllocationMethod =
  | "exclusive"       // Agent is sole writer → 100% allocated
  | "proportional"    // Split by action count
  | "equal-split"     // Split equally among all touching agents
  | "weighted";       // Split by action weight

/** A single cost allocation entry. */
export type CostAllocationEntry = {
  /** Agent node ID. */
  agentNodeId: string;
  /** Agent name. */
  agentName: string;
  /** Resource node ID. */
  resourceNodeId: string;
  /** Resource name. */
  resourceName: string;
  /** Resource type. */
  resourceType: string;
  /** Provider. */
  provider: string;
  /** Monthly infrastructure cost attributed to this agent. */
  allocatedCostMonthly: number;
  /** How the cost was allocated. */
  allocationMethod: AllocationMethod;
  /** Allocation fraction (0–1) of the resource's total cost. */
  fraction: number;
  /** API/action cost incurred by the agent on this resource. */
  actionCostUsd: number;
};

/** Per-agent cost summary. */
export type AgentCostSummary = {
  agentNodeId: string;
  agentName: string;
  /** Total infrastructure cost attributed to this agent. */
  totalInfraCost: number;
  /** Total action (API) cost incurred. */
  totalActionCost: number;
  /** Combined cost. */
  totalCost: number;
  /** Number of resources this agent is allocated costs for. */
  resourceCount: number;
  /** Cost breakdown by resource type. */
  byResourceType: Record<string, number>;
  /** Cost breakdown by provider. */
  byProvider: Record<string, number>;
  /** Top resources by allocated cost. */
  topResources: Array<{ nodeId: string; name: string; resourceType: string; cost: number }>;
  /** Efficiency: cost per action. */
  costPerAction: number;
  /** Efficiency: cost per resource. */
  costPerResource: number;
};

/** Budget definition for an agent. */
export type AgentBudget = {
  agentNodeId: string;
  monthlyLimit: number;
  alertThreshold: number; // fraction (e.g., 0.8 = alert at 80%)
};

/** Budget status for an agent. */
export type AgentBudgetStatus = {
  agentNodeId: string;
  agentName: string;
  budget: number;
  spent: number;
  remaining: number;
  utilization: number;
  status: "under" | "warning" | "over";
};

/** Full cost allocation report. */
export type CostAllocationReport = {
  generatedAt: string;
  /** All individual allocation entries. */
  allocations: CostAllocationEntry[];
  /** Per-agent cost summaries. */
  agentSummaries: AgentCostSummary[];
  /** Budget status (if budgets provided). */
  budgetStatus: AgentBudgetStatus[];
  /** Summary metrics. */
  summary: {
    totalAllocatedCost: number;
    totalUnallocatedCost: number;
    agentCount: number;
    resourceCount: number;
  };
};

/** Options for cost allocation. */
export type CostAllocationOptions = {
  /** Default allocation method (default: "proportional"). */
  defaultMethod?: AllocationMethod;
  /** Agent budgets for tracking. */
  budgets?: AgentBudget[];
  /** Time period for activity analysis. */
  since?: string;
  /** Include resources with zero cost (default: false). */
  includeZeroCost?: boolean;
  /** Filter allocations to a specific cloud provider. */
  provider?: CloudProvider;
};

// =============================================================================
// Cost Allocation Engine
// =============================================================================

/**
 * Compute cost allocations for all agents.
 */
export async function computeCostAllocations(
  storage: GraphStorage,
  options: CostAllocationOptions = {},
): Promise<CostAllocationReport> {
  const {
    defaultMethod = "proportional",
    budgets = [],
    since,
    includeZeroCost = false,
    provider,
  } = options;

  const agents: GraphNode[] = await getAgents(storage);
  const activitySummaries: AgentActivitySummary[] = await getAgentActivity(storage, since);

  // Build agent → resources mapping with edge info
  const agentResourceEdges = new Map<string, Map<string, { edges: GraphEdge[]; actionCount: number }>>();

  for (const agent of agents) {
    const edges = await storage.getEdgesForNode(agent.id, "downstream");
    const resourceMap = new Map<string, { edges: GraphEdge[]; actionCount: number }>();

    for (const edge of edges) {
      const target = await storage.getNode(edge.targetNodeId);
      if (!target || target.metadata.isAgent === true) continue;

      const existing = resourceMap.get(edge.targetNodeId);
      if (existing) {
        existing.edges.push(edge);
        existing.actionCount++;
      } else {
        resourceMap.set(edge.targetNodeId, { edges: [edge], actionCount: 1 });
      }
    }

    agentResourceEdges.set(agent.id, resourceMap);
  }

  // Build resource → agents mapping for shared resource detection
  const resourceAgents = new Map<string, Array<{ agentId: string; actionCount: number }>>();
  for (const [agentId, resources] of agentResourceEdges) {
    for (const [resourceId, info] of resources) {
      const list = resourceAgents.get(resourceId) ?? [];
      list.push({ agentId, actionCount: info.actionCount });
      resourceAgents.set(resourceId, list);
    }
  }

  // Compute allocations
  const allocations: CostAllocationEntry[] = [];
  const allNodes: GraphNode[] = await storage.queryNodes(provider ? { provider } : {});
  const nodeMap = new Map<string, GraphNode>(allNodes.map((n) => [n.id, n]));

  for (const [resourceId, agentList] of resourceAgents) {
    const resource = nodeMap.get(resourceId);
    if (!resource) continue;

    const cost = resource.costMonthly ?? 0;
    if (cost === 0 && !includeZeroCost) continue;

    const totalActions = agentList.reduce((s, a) => s + a.actionCount, 0);
    const isExclusive = agentList.length === 1;

    for (const { agentId, actionCount } of agentList) {
      const agent = nodeMap.get(agentId);
      const agentName = agent?.name ?? agentId;

      let fraction: number;
      let method: AllocationMethod;

      if (isExclusive) {
        fraction = 1.0;
        method = "exclusive";
      } else {
        switch (defaultMethod) {
          case "proportional":
            fraction = totalActions > 0 ? actionCount / totalActions : 1 / agentList.length;
            method = "proportional";
            break;
          case "equal-split":
            fraction = 1 / agentList.length;
            method = "equal-split";
            break;
          default:
            fraction = totalActions > 0 ? actionCount / totalActions : 1 / agentList.length;
            method = "proportional";
        }
      }

      // Get action cost from activity summary
      const activity = activitySummaries.find((a) => a.agentNodeId === agentId);
      const agentTotalActionCost = activity?.totalCostUsd ?? 0;
      const agentTotalResources = activity?.uniqueResourcesTouched ?? 1;
      // Distribute agent's action cost proportionally across resources
      const actionCostForResource = agentTotalResources > 0
        ? agentTotalActionCost / agentTotalResources
        : 0;

      allocations.push({
        agentNodeId: agentId,
        agentName,
        resourceNodeId: resourceId,
        resourceName: resource.name,
        resourceType: resource.resourceType,
        provider: resource.provider,
        allocatedCostMonthly: Math.round(cost * fraction * 100) / 100,
        allocationMethod: method,
        fraction,
        actionCostUsd: Math.round(actionCostForResource * 100) / 100,
      });
    }
  }

  // Build per-agent summaries
  const agentSummaries: AgentCostSummary[] = [];
  for (const agent of agents) {
    const agentAllocs = allocations.filter((a) => a.agentNodeId === agent.id);
    const activity: AgentActivitySummary | undefined = activitySummaries.find((a) => a.agentNodeId === agent.id);

    const totalInfraCost = agentAllocs.reduce((s, a) => s + a.allocatedCostMonthly, 0);
    const totalActionCost = activity?.totalCostUsd ?? 0;
    const totalActions = activity?.totalActions ?? 0;

    const byResourceType: Record<string, number> = {};
    const byProvider: Record<string, number> = {};
    for (const alloc of agentAllocs) {
      byResourceType[alloc.resourceType] = (byResourceType[alloc.resourceType] ?? 0) + alloc.allocatedCostMonthly;
      byProvider[alloc.provider] = (byProvider[alloc.provider] ?? 0) + alloc.allocatedCostMonthly;
    }

    // Use getAgentResources for a full resource inventory, then rank by cost
    const agentResources: GraphNode[] = await getAgentResources(storage, agent.id);
    const topResources = agentResources
      .filter((r) => !provider || r.provider === provider)
      .sort((a, b) => (b.costMonthly ?? 0) - (a.costMonthly ?? 0))
      .slice(0, 5)
      .map((r) => ({
        nodeId: r.id,
        name: r.name,
        resourceType: r.resourceType,
        cost: r.costMonthly ?? 0,
      }));

    agentSummaries.push({
      agentNodeId: agent.id,
      agentName: agent.name,
      totalInfraCost: Math.round(totalInfraCost * 100) / 100,
      totalActionCost: Math.round(totalActionCost * 100) / 100,
      totalCost: Math.round((totalInfraCost + totalActionCost) * 100) / 100,
      resourceCount: agentAllocs.length,
      byResourceType,
      byProvider,
      topResources,
      costPerAction: totalActions > 0 ? Math.round((totalInfraCost + totalActionCost) / totalActions * 100) / 100 : 0,
      costPerResource: agentAllocs.length > 0 ? Math.round((totalInfraCost + totalActionCost) / agentAllocs.length * 100) / 100 : 0,
    });
  }

  // Budget status
  const budgetStatus: AgentBudgetStatus[] = [];
  for (const budget of budgets) {
    const summary = agentSummaries.find((s) => s.agentNodeId === budget.agentNodeId);
    const spent = summary?.totalCost ?? 0;
    const utilization = budget.monthlyLimit > 0 ? spent / budget.monthlyLimit : 0;

    budgetStatus.push({
      agentNodeId: budget.agentNodeId,
      agentName: summary?.agentName ?? budget.agentNodeId,
      budget: budget.monthlyLimit,
      spent: Math.round(spent * 100) / 100,
      remaining: Math.round((budget.monthlyLimit - spent) * 100) / 100,
      utilization: Math.round(utilization * 1000) / 1000,
      status: utilization > 1 ? "over" : utilization >= budget.alertThreshold ? "warning" : "under",
    });
  }

  // Compute unallocated cost
  const totalGraphCost = allNodes.reduce((s, n) => s + (n.costMonthly ?? 0), 0);
  const totalAllocated = allocations.reduce((s, a) => s + a.allocatedCostMonthly, 0);
  const allocatedResourceIds = new Set(allocations.map((a) => a.resourceNodeId));

  return {
    generatedAt: new Date().toISOString(),
    allocations,
    agentSummaries,
    budgetStatus,
    summary: {
      totalAllocatedCost: Math.round(totalAllocated * 100) / 100,
      totalUnallocatedCost: Math.round((totalGraphCost - totalAllocated) * 100) / 100,
      agentCount: agents.length,
      resourceCount: allocatedResourceIds.size,
    },
  };
}

/**
 * Format a cost allocation report as markdown.
 */
export function formatCostAllocationMarkdown(report: CostAllocationReport): string {
  const lines: string[] = [
    "# Agent Cost Allocation Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Agents: ${report.summary.agentCount}`,
    `Resources allocated: ${report.summary.resourceCount}`,
    `Total allocated: $${report.summary.totalAllocatedCost.toFixed(2)}`,
    `Total unallocated: $${report.summary.totalUnallocatedCost.toFixed(2)}`,
    "",
  ];

  if (report.agentSummaries.length > 0) {
    lines.push(
      "## Agent Cost Summary",
      "",
      "| Agent | Infra Cost | Action Cost | Total | Resources | Cost/Action |",
      "|-------|-----------|-------------|-------|-----------|-------------|",
      ...report.agentSummaries
        .sort((a, b) => b.totalCost - a.totalCost)
        .map((s) =>
          `| ${s.agentName} | $${s.totalInfraCost.toFixed(2)} | $${s.totalActionCost.toFixed(2)} | $${s.totalCost.toFixed(2)} | ${s.resourceCount} | $${s.costPerAction.toFixed(4)} |`,
        ),
      "",
    );
  }

  if (report.budgetStatus.length > 0) {
    lines.push(
      "## Top Resources per Agent",
      "",
      ...report.agentSummaries
        .filter((s) => s.topResources.length > 0)
        .flatMap((s) => [
          `### ${s.agentName}`,
          "",
          "| Resource | Type | Monthly Cost |",
          "|----------|------|--------------|",
          ...s.topResources.map(
            (r) => `| ${r.name} | ${r.resourceType} | $${r.cost.toFixed(2)} |`,
          ),
          "",
        ]),
      "## Budget Status",
      "",
      "| Agent | Budget | Spent | Remaining | Utilization | Status |",
      "|-------|--------|-------|-----------|-------------|--------|",
      ...report.budgetStatus.map(
        (b) =>
          `| ${b.agentName} | $${b.budget.toFixed(2)} | $${b.spent.toFixed(2)} | $${b.remaining.toFixed(2)} | ${(b.utilization * 100).toFixed(1)}% | ${b.status} |`,
      ),
      "",
    );
  }

  return lines.join("\n");
}
