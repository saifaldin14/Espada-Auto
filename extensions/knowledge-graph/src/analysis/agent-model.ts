/**
 * Infrastructure Knowledge Graph — Agent Action Modeling (P2.19)
 *
 * Models AI agent nodes and their actions within the infrastructure graph.
 * Tracks which agents touch which resources, detects conflicts between
 * concurrent agent operations, and attributes cost/change per agent.
 */

import type {
  GraphStorage,
  GraphNode,
  GraphNodeInput,
  GraphEdge,
  GraphEdgeInput,
  GraphChange,
  GraphResourceType,
  CloudProvider,
  ChangeFilter,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

/** An AI agent modeled as a graph node. */
export type AgentNode = {
  /** Agent ID (used as nativeId). */
  agentId: string;
  /** Human-readable agent name. */
  name: string;
  /** Agent type/role. */
  role: string;
  /** Whether the agent is currently active. */
  active: boolean;
  /** Capabilities this agent has. */
  capabilities: string[];
  /** Provider scope (if any). */
  provider?: CloudProvider;
  /** Additional metadata. */
  metadata?: Record<string, unknown>;
};

/** An action performed by an agent on a resource. */
export type AgentAction = {
  /** Agent graph node ID. */
  agentNodeId: string;
  /** Target resource graph node ID. */
  targetNodeId: string;
  /** What the agent did. */
  actionType: AgentActionType;
  /** When the action occurred. */
  timestamp: string;
  /** Was the action successful? */
  success: boolean;
  /** Duration in milliseconds. */
  durationMs?: number;
  /** Cost incurred by this action (API costs, etc.). */
  costUsd?: number;
  /** Additional context. */
  metadata?: Record<string, unknown>;
};

/** Types of agent actions. */
export type AgentActionType =
  | "query"
  | "create"
  | "update"
  | "delete"
  | "scale"
  | "monitor"
  | "remediate"
  | "analyze";

/** Conflict between two agents operating on the same resource. */
export type AgentConflict = {
  /** First agent node ID. */
  agent1Id: string;
  /** Second agent node ID. */
  agent2Id: string;
  /** Target resource node ID. */
  targetNodeId: string;
  /** Target resource name. */
  targetName: string;
  /** What kind of conflict. */
  conflictType: "concurrent-modify" | "contradictory-action" | "resource-contention";
  /** Human-readable explanation. */
  description: string;
  /** When the conflict was detected. */
  detectedAt: string;
};

/** Per-agent activity summary. */
export type AgentActivitySummary = {
  /** Agent node ID. */
  agentNodeId: string;
  /** Agent name. */
  agentName: string;
  /** Total actions performed. */
  totalActions: number;
  /** Actions by type. */
  actionsByType: Record<string, number>;
  /** Unique resources touched. */
  uniqueResourcesTouched: number;
  /** Resources touched (IDs). */
  resourceIds: string[];
  /** Total cost attributed to this agent's actions. */
  totalCostUsd: number;
  /** Number of changes initiated. */
  changesInitiated: number;
  /** Success rate (0–1). */
  successRate: number;
};

/** Full agent activity report. */
export type AgentReport = {
  generatedAt: string;
  totalAgents: number;
  totalActions: number;
  /** Per-agent summaries. */
  agents: AgentActivitySummary[];
  /** Detected conflicts. */
  conflicts: AgentConflict[];
};

// =============================================================================
// Agent Graph Modeling
// =============================================================================

/** The resource type used for agent nodes in the graph. */
const AGENT_RESOURCE_TYPE: GraphResourceType = "custom";

/** Build a deterministic graph node ID for an agent. */
export function buildAgentNodeId(agentId: string): string {
  return `custom:agents:global:custom:${agentId}`;
}

/**
 * Register an AI agent as a graph node.
 */
export async function registerAgent(
  storage: GraphStorage,
  agent: AgentNode,
): Promise<GraphNode> {
  const now = new Date().toISOString();
  const nodeId = buildAgentNodeId(agent.agentId);
  const input: GraphNodeInput = {
    id: nodeId,
    provider: agent.provider ?? "custom",
    resourceType: AGENT_RESOURCE_TYPE,
    nativeId: agent.agentId,
    name: agent.name,
    region: "global",
    account: "agents",
    status: agent.active ? "running" : "stopped",
    tags: {
      "agent-role": agent.role,
      "agent-type": "ai-agent",
      ...(agent.capabilities.length > 0
        ? { capabilities: agent.capabilities.join(",") }
        : {}),
    },
    metadata: {
      isAgent: true,
      role: agent.role,
      capabilities: agent.capabilities,
      ...(agent.metadata ?? {}),
    },
    costMonthly: null,
    owner: null,
    createdAt: now,
  };

  await storage.upsertNode(input);
  const result = await storage.getNode(nodeId);
  if (!result) {
    throw new Error(`Failed to retrieve agent node after upsert: ${nodeId}`);
  }
  return result;
}

/**
 * Record an agent action by creating edges and changelog entries.
 */
export async function recordAgentAction(
  storage: GraphStorage,
  action: AgentAction,
): Promise<void> {
  // Validate that referenced nodes exist
  const agentNode = await storage.getNode(action.agentNodeId);
  if (!agentNode) {
    throw new Error(`Agent node not found: ${action.agentNodeId}`);
  }
  const targetNode = await storage.getNode(action.targetNodeId);
  if (!targetNode) {
    throw new Error(`Target node not found: ${action.targetNodeId}`);
  }

  const now = action.timestamp || new Date().toISOString();

  // Create/update edge between agent and target resource
  const edgeId = `${action.agentNodeId}:${action.actionType}:${action.targetNodeId}`;
  const edge: GraphEdgeInput = {
    id: edgeId,
    sourceNodeId: action.agentNodeId,
    targetNodeId: action.targetNodeId,
    relationshipType: actionTypeToRelationship(action.actionType),
    confidence: 1.0,
    discoveredVia: "runtime-trace",
    metadata: {
      actionType: action.actionType,
      lastActionAt: now,
      success: action.success,
      ...(action.durationMs != null ? { durationMs: action.durationMs } : {}),
      ...(action.costUsd != null ? { costUsd: action.costUsd } : {}),
      ...(action.metadata ?? {}),
    },
  };
  await storage.upsertEdge(edge);

  // Record as a graph change
  const change: GraphChange = {
    id: `agent-action:${edgeId}:${Date.now()}`,
    targetId: action.targetNodeId,
    changeType: actionTypeToChangeType(action.actionType),
    field: "agent-action",
    previousValue: null,
    newValue: JSON.stringify({
      actionType: action.actionType,
      success: action.success,
      durationMs: action.durationMs,
    }),
    detectedAt: now,
    detectedVia: "manual",
    correlationId: null,
    initiator: action.agentNodeId,
    initiatorType: "agent",
    metadata: action.metadata ?? {},
  };
  await storage.appendChange(change);
}

/**
 * Map agent action type to graph relationship type.
 */
function actionTypeToRelationship(
  actionType: AgentActionType,
): GraphEdge["relationshipType"] {
  switch (actionType) {
    case "query":
    case "analyze":
      return "reads-from";
    case "create":
      return "triggers";
    case "update":
    case "scale":
    case "remediate":
      return "writes-to";
    case "delete":
      return "triggers";
    case "monitor":
      return "monitors";
    default:
      return "uses";
  }
}

/**
 * Map agent action type to graph change type.
 */
function actionTypeToChangeType(
  actionType: AgentActionType,
): GraphChange["changeType"] {
  switch (actionType) {
    case "create":
      return "node-created";
    case "delete":
      return "node-deleted";
    case "update":
    case "scale":
    case "remediate":
      return "node-updated";
    default:
      return "node-updated";
  }
}

// =============================================================================
// Agent Query & Analysis
// =============================================================================

/**
 * Get all registered agents from the graph.
 */
export async function getAgents(storage: GraphStorage): Promise<GraphNode[]> {
  const allCustom = await storage.queryNodes({
    resourceType: AGENT_RESOURCE_TYPE,
  });
  return allCustom.filter(
    (n) => n.metadata.isAgent === true,
  );
}

/**
 * Get resources touched by a specific agent.
 */
export async function getAgentResources(
  storage: GraphStorage,
  agentNodeId: string,
): Promise<GraphNode[]> {
  const edges = await storage.getEdgesForNode(agentNodeId, "downstream");
  const nodeIds = new Set(edges.map((e) => e.targetNodeId));
  const nodes: GraphNode[] = [];
  for (const id of nodeIds) {
    const node = await storage.getNode(id);
    if (node && node.metadata.isAgent !== true) nodes.push(node);
  }
  return nodes;
}

/**
 * Detect conflicts between agents operating on the same resources.
 */
export async function detectAgentConflicts(
  storage: GraphStorage,
): Promise<AgentConflict[]> {
  const agents = await getAgents(storage);
  if (agents.length < 2) return [];

  const conflicts: AgentConflict[] = [];
  const now = new Date().toISOString();

  // Build a map of resource → agents that write to it
  const resourceWriters = new Map<string, Array<{ agentId: string; edge: GraphEdge }>>();

  for (const agent of agents) {
    const edges = await storage.getEdgesForNode(agent.id, "downstream");
    for (const edge of edges) {
      // Only consider write-like relationships
      const rel = edge.relationshipType;
      if (
        rel === "writes-to" ||
        rel === "triggers"
      ) {
        const list = resourceWriters.get(edge.targetNodeId) ?? [];
        list.push({ agentId: agent.id, edge });
        resourceWriters.set(edge.targetNodeId, list);
      }
    }
  }

  // Check for resources with multiple writing agents
  for (const [targetId, writers] of resourceWriters) {
    if (writers.length < 2) continue;

    const target = await storage.getNode(targetId);
    const targetName = target?.name ?? targetId;

    // Each pair of agents writing to the same resource is a conflict
    for (let i = 0; i < writers.length; i++) {
      for (let j = i + 1; j < writers.length; j++) {
        conflicts.push({
          agent1Id: writers[i]!.agentId,
          agent2Id: writers[j]!.agentId,
          targetNodeId: targetId,
          targetName,
          conflictType: "concurrent-modify",
          description: `Both agents have write access to ${targetName}`,
          detectedAt: now,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Generate per-agent activity summaries from the change log.
 */
export async function getAgentActivity(
  storage: GraphStorage,
  since?: string,
): Promise<AgentActivitySummary[]> {
  const agents = await getAgents(storage);
  const summaries: AgentActivitySummary[] = [];

  for (const agent of agents) {
    const filter: ChangeFilter = {
      initiator: agent.id,
      initiatorType: "agent",
      ...(since ? { since } : {}),
    };
    const changes = await storage.getChanges(filter);
    const edges = await storage.getEdgesForNode(agent.id, "downstream");
    const resourceIds = [
      ...new Set(edges.map((e) => e.targetNodeId)),
    ];

    const actionsByType: Record<string, number> = {};
    let totalCost = 0;
    let successCount = 0;

    for (const edge of edges) {
      const action = typeof edge.metadata.actionType === "string"
        ? edge.metadata.actionType
        : "unknown";
      actionsByType[action] = (actionsByType[action] ?? 0) + 1;
      if (typeof edge.metadata.costUsd === "number") {
        totalCost += edge.metadata.costUsd;
      }
      if (edge.metadata.success === true) successCount++;
    }

    summaries.push({
      agentNodeId: agent.id,
      agentName: agent.name,
      totalActions: edges.length,
      actionsByType,
      uniqueResourcesTouched: resourceIds.length,
      resourceIds,
      totalCostUsd: totalCost,
      changesInitiated: changes.length,
      successRate:
        edges.length > 0 ? successCount / edges.length : 0,
    });
  }

  return summaries;
}

/**
 * Generate a full agent activity report.
 */
export async function generateAgentReport(
  storage: GraphStorage,
  since?: string,
): Promise<AgentReport> {
  const [agents, conflicts] = await Promise.all([
    getAgentActivity(storage, since),
    detectAgentConflicts(storage),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    totalAgents: agents.length,
    totalActions: agents.reduce((sum, a) => sum + a.totalActions, 0),
    agents,
    conflicts,
  };
}

/**
 * Format an agent report as markdown.
 */
export function formatAgentReportMarkdown(report: AgentReport): string {
  const lines: string[] = [
    "# Agent Activity Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Total agents: ${report.totalAgents}`,
    `Total actions: ${report.totalActions}`,
    `Conflicts: ${report.conflicts.length}`,
    "",
  ];

  if (report.agents.length > 0) {
    lines.push(
      "## Agent Summary",
      "",
      "| Agent | Actions | Resources | Changes | Cost | Success Rate |",
      "|-------|---------|-----------|---------|------|-------------|",
      ...report.agents.map(
        (a) =>
          `| ${a.agentName} | ${a.totalActions} | ${a.uniqueResourcesTouched} | ${a.changesInitiated} | $${a.totalCostUsd.toFixed(2)} | ${(a.successRate * 100).toFixed(0)}% |`,
      ),
      "",
    );
  }

  if (report.conflicts.length > 0) {
    lines.push(
      "## Conflicts",
      "",
      "| Resource | Type | Description |",
      "|----------|------|-------------|",
      ...report.conflicts.map(
        (c) =>
          `| ${c.targetName} | ${c.conflictType} | ${c.description} |`,
      ),
    );
  }

  return lines.join("\n");
}
