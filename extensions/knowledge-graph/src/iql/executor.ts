/**
 * IQL — Query Executor
 *
 * Executes a parsed IQL AST against GraphStorage (and optionally
 * TemporalGraphStorage). Converts IQL conditions into NodeFilter
 * pre-queries, then post-filters with the full condition tree.
 *
 * Supports:
 * - FIND resources with WHERE filters (provider, cost, tags, etc.)
 * - FIND downstream/upstream traversals
 * - FIND PATH with glob-pattern matching
 * - SUMMARIZE cost|count BY field grouping
 * - AT temporal queries + DIFF WITH snapshot comparison
 * - Built-in functions: tagged(), drifted_since(), created_after(),
 *   created_before(), has_edge()
 */

import type {
  IQLQuery,
  FindQuery,
  SummarizeQuery,
  Condition,
  IQLResult,
  IQLFindResult,
  IQLSummarizeResult,
  IQLDiffResult,
  IQLPathResult,
  IQLValue,
  ComparisonOp,
} from "./types.js";
import type {
  GraphStorage,
  GraphNode,
  NodeFilter,
  ChangeFilter,
} from "../types.js";
import type { TemporalGraphStorage } from "../temporal.js";
import { shortestPath } from "../queries.js";

// =============================================================================
// Public API
// =============================================================================

export type IQLExecutorOptions = {
  storage: GraphStorage;
  temporal?: TemporalGraphStorage;
  /** Default max results for FIND queries (default: 500). */
  defaultLimit?: number;
  /** Max depth for downstream/upstream traversals (default: 8). */
  maxTraversalDepth?: number;
};

/**
 * Execute a parsed IQL query and return structured results.
 */
export async function executeQuery(
  query: IQLQuery,
  options: IQLExecutorOptions,
): Promise<IQLResult> {
  if (query.type === "find") {
    return executeFindQuery(query, options);
  }
  return executeSummarizeQuery(query, options);
}

// =============================================================================
// FIND query execution
// =============================================================================

async function executeFindQuery(
  query: FindQuery,
  options: IQLExecutorOptions,
): Promise<IQLResult> {
  const { storage } = options;
  const limit = query.limit ?? options.defaultLimit ?? 500;

  // PATH queries have their own flow
  if (query.target.kind === "path") {
    return executePathQuery(query, options);
  }

  // Gather candidate nodes
  let nodes: GraphNode[];

  if (query.target.kind === "resources") {
    if (query.at && options.temporal) {
      // Temporal AT: get nodes from the closest snapshot
      const snapshot = await options.temporal.getSnapshotAt(query.at);
      if (!snapshot) {
        return emptyFindResult();
      }
      const preFilter = extractNodeFilter(query.where);
      nodes = await options.temporal.getNodesAtSnapshot(snapshot.id, preFilter);
    } else {
      const preFilter = extractNodeFilter(query.where);
      nodes = await storage.queryNodes(preFilter);
    }
  } else {
    // Downstream or upstream traversal
    const direction =
      query.target.kind === "downstream" ? "downstream" : "upstream";
    const maxDepth =
      extractDepthLimit(query.where) ?? options.maxTraversalDepth ?? 8;
    const result = await storage.getNeighbors(
      query.target.nodeId,
      maxDepth,
      direction,
    );
    nodes = result.nodes;
  }

  // Post-filter with full WHERE condition tree
  if (query.where) {
    const ctx: FilterContext = { storage };
    nodes = await filterNodes(nodes, query.where, ctx);
  }

  const totalCount = nodes.length;
  if (nodes.length > limit) {
    nodes = nodes.slice(0, limit);
  }

  // DIFF WITH handling
  if (query.diff && query.at && options.temporal) {
    return executeDiffResult(query.at, query.diff.target, options);
  }

  const totalCost = nodes.reduce((sum, n) => sum + (n.costMonthly ?? 0), 0);

  return {
    type: "find",
    nodes: nodes.map(nodeToResult),
    totalCount,
    totalCost,
  };
}

// =============================================================================
// PATH query
// =============================================================================

async function executePathQuery(
  query: FindQuery,
  options: IQLExecutorOptions,
): Promise<IQLPathResult> {
  const target = query.target;
  if (target.kind !== "path") throw new Error("Expected path target");

  const { storage } = options;

  // Resolve glob patterns to actual nodes
  const fromNodes = await findMatchingNodes(storage, target.from);
  const toNodes = await findMatchingNodes(storage, target.to);

  if (fromNodes.length === 0 || toNodes.length === 0) {
    return { type: "path", found: false, path: [], hops: 0, edges: [] };
  }

  // Try each combination (shortest first pair gets returned)
  for (const fromNode of fromNodes) {
    for (const toNode of toNodes) {
      const result = await shortestPath(storage, fromNode.id, toNode.id);
      if (result.found) {
        const pathNodes: IQLPathResult["path"] = [];
        for (const nid of result.path) {
          const n = await storage.getNode(nid);
          pathNodes.push({
            nodeId: nid,
            name: n?.name ?? nid,
            resourceType: n?.resourceType ?? "custom",
          });
        }
        return {
          type: "path",
          found: true,
          path: pathNodes,
          hops: result.hops,
          edges: result.edges.map((e) => ({
            from: e.sourceNodeId,
            to: e.targetNodeId,
            relationshipType: e.relationshipType,
          })),
        };
      }
    }
  }

  return { type: "path", found: false, path: [], hops: 0, edges: [] };
}

// =============================================================================
// SUMMARIZE query
// =============================================================================

async function executeSummarizeQuery(
  query: SummarizeQuery,
  options: IQLExecutorOptions,
): Promise<IQLSummarizeResult> {
  const { storage } = options;

  const preFilter = extractNodeFilter(query.where);
  let nodes = await storage.queryNodes(preFilter);

  if (query.where) {
    const ctx: FilterContext = { storage };
    nodes = await filterNodes(nodes, query.where, ctx);
  }

  // Group and aggregate
  const groups = new Map<
    string,
    { key: Record<string, string>; value: number }
  >();

  for (const node of nodes) {
    const groupKey: Record<string, string> = {};
    for (const field of query.groupBy) {
      groupKey[field] = getFieldValue(node, field)?.toString() ?? "unknown";
    }
    const keyStr = JSON.stringify(groupKey);
    const existing = groups.get(keyStr);

    if (existing) {
      existing.value +=
        query.metric === "cost" ? (node.costMonthly ?? 0) : 1;
    } else {
      groups.set(keyStr, {
        key: groupKey,
        value: query.metric === "cost" ? (node.costMonthly ?? 0) : 1,
      });
    }
  }

  const groupArray = Array.from(groups.values()).sort(
    (a, b) => b.value - a.value,
  );
  const total = groupArray.reduce((sum, g) => sum + g.value, 0);

  return { type: "summarize", groups: groupArray, total };
}

// =============================================================================
// DIFF execution
// =============================================================================

async function executeDiffResult(
  fromTimestamp: string,
  toTarget: string,
  options: IQLExecutorOptions,
): Promise<IQLDiffResult> {
  const { temporal } = options;
  if (!temporal) {
    return emptyDiffResult(fromTimestamp, toTarget);
  }

  const fromSnapshot = await temporal.getSnapshotAt(fromTimestamp);
  const toSnapshot =
    toTarget === "NOW"
      ? await temporal.getSnapshotAt(new Date().toISOString())
      : await temporal.getSnapshotAt(toTarget);

  if (!fromSnapshot || !toSnapshot) {
    return emptyDiffResult(fromTimestamp, toTarget);
  }

  const diff = await temporal.diffSnapshots(fromSnapshot.id, toSnapshot.id);

  const details: IQLDiffResult["details"] = [
    ...diff.addedNodes.map((n) => ({
      nodeId: n.id,
      name: n.name,
      change: "added" as const,
    })),
    ...diff.removedNodes.map((n) => ({
      nodeId: n.id,
      name: n.name,
      change: "removed" as const,
    })),
    ...diff.changedNodes.map((c) => ({
      nodeId: c.nodeId,
      name: c.after.name,
      change: "changed" as const,
      changedFields: c.changedFields,
    })),
  ];

  return {
    type: "diff",
    fromTimestamp,
    toTimestamp: toTarget === "NOW" ? new Date().toISOString() : toTarget,
    added: diff.addedNodes.length,
    removed: diff.removedNodes.length,
    changed: diff.changedNodes.length,
    costDelta: diff.costDelta,
    details,
  };
}

// =============================================================================
// Node filtering
// =============================================================================

type FilterContext = {
  storage: GraphStorage;
};

/**
 * Extract a NodeFilter from simple equality conditions for pre-filtering.
 * Only handles conditions that map directly to NodeFilter fields.
 */
function extractNodeFilter(condition: Condition | null): NodeFilter {
  if (!condition) return {};
  const filter: NodeFilter = {};

  const extract = (cond: Condition): void => {
    if (cond.type === "and") {
      for (const c of cond.conditions) extract(c);
      return;
    }
    if (cond.type !== "field") return;

    const val = cond.value;
    if (cond.operator === "=" && typeof val === "string") {
      switch (cond.field) {
        case "provider":
          filter.provider = val as NodeFilter["provider"];
          break;
        case "resourceType":
          filter.resourceType = val as NodeFilter["resourceType"];
          break;
        case "region":
          filter.region = val;
          break;
        case "account":
          filter.account = val;
          break;
        case "status":
          filter.status = val as NodeFilter["status"];
          break;
        case "owner":
          filter.owner = val;
          break;
      }
    }

    if (cond.operator === "IN" && Array.isArray(val)) {
      const strs = val.filter((v): v is string => typeof v === "string");
      if (cond.field === "resourceType")
        filter.resourceType = strs as NodeFilter["resourceType"];
      if (cond.field === "status")
        filter.status = strs as NodeFilter["status"];
    }

    if (
      cond.field === "name" &&
      cond.operator === "LIKE" &&
      typeof val === "string"
    ) {
      filter.namePattern = val;
    }

    if (cond.field === "cost" && typeof val === "number") {
      if (cond.operator === ">" || cond.operator === ">=")
        filter.minCost = val;
      if (cond.operator === "<" || cond.operator === "<=")
        filter.maxCost = val;
    }

    if (
      cond.field.startsWith("tag.") &&
      cond.operator === "=" &&
      typeof val === "string"
    ) {
      const tagKey = cond.field.slice(4);
      filter.tags = filter.tags ?? {};
      filter.tags[tagKey] = val;
    }
  };

  extract(condition);
  return filter;
}

/**
 * Extract depth limit from WHERE conditions (for traversal queries).
 */
function extractDepthLimit(condition: Condition | null): number | undefined {
  if (!condition) return undefined;

  if (
    condition.type === "field" &&
    condition.field === "depth" &&
    typeof condition.value === "number"
  ) {
    if (condition.operator === "<=") return condition.value;
    if (condition.operator === "<") return condition.value - 1;
  }
  if (condition.type === "and") {
    for (const c of condition.conditions) {
      const d = extractDepthLimit(c);
      if (d !== undefined) return d;
    }
  }
  return undefined;
}

/**
 * Post-filter nodes by evaluating the full WHERE condition tree.
 */
async function filterNodes(
  nodes: GraphNode[],
  condition: Condition,
  ctx: FilterContext,
): Promise<GraphNode[]> {
  const result: GraphNode[] = [];
  for (const node of nodes) {
    if (await evaluateCondition(node, condition, ctx)) {
      result.push(node);
    }
  }
  return result;
}

async function evaluateCondition(
  node: GraphNode,
  condition: Condition,
  ctx: FilterContext,
): Promise<boolean> {
  switch (condition.type) {
    case "and":
      for (const c of condition.conditions) {
        if (!(await evaluateCondition(node, c, ctx))) return false;
      }
      return true;

    case "or":
      for (const c of condition.conditions) {
        if (await evaluateCondition(node, c, ctx)) return true;
      }
      return false;

    case "not":
      return !(await evaluateCondition(node, condition.inner, ctx));

    case "field":
      return evaluateFieldCondition(node, condition);

    case "function":
      return evaluateFunctionCondition(node, condition, ctx);
  }
}

function evaluateFieldCondition(
  node: GraphNode,
  cond: { field: string; operator: ComparisonOp; value: IQLValue },
): boolean {
  const fieldVal = getFieldValue(node, cond.field);
  return compareValues(fieldVal, cond.operator, cond.value);
}

async function evaluateFunctionCondition(
  node: GraphNode,
  cond: { name: string; args: IQLValue[] },
  ctx: FilterContext,
): Promise<boolean> {
  switch (cond.name) {
    case "tagged": {
      const tagKey = String(cond.args[0] ?? "");
      return tagKey in node.tags;
    }

    case "drifted_since": {
      const since = String(cond.args[0] ?? "");
      const filter: ChangeFilter = {
        targetId: node.id,
        since,
        changeType: ["node-updated", "node-drifted"],
      };
      const changes = await ctx.storage.getChanges(filter);
      return changes.length > 0;
    }

    case "created_after": {
      const ts = String(cond.args[0] ?? "");
      return (node.createdAt ?? "") > ts;
    }

    case "created_before": {
      const ts = String(cond.args[0] ?? "");
      return (node.createdAt ?? "") < ts;
    }

    case "has_edge": {
      const relType = String(cond.args[0] ?? "");
      const edges = await ctx.storage.getEdgesForNode(
        node.id,
        "both",
        relType as Parameters<GraphStorage["getEdgesForNode"]>[2],
      );
      return edges.length > 0;
    }

    default:
      return false;
  }
}

// =============================================================================
// Helpers
// =============================================================================

function getFieldValue(node: GraphNode, field: string): unknown {
  if (field.startsWith("tag.")) {
    return node.tags[field.slice(4)] ?? null;
  }
  if (field.startsWith("metadata.")) {
    return (node.metadata as Record<string, unknown>)[field.slice(9)] ?? null;
  }
  switch (field) {
    case "provider":
      return node.provider;
    case "resourceType":
      return node.resourceType;
    case "region":
      return node.region;
    case "account":
      return node.account;
    case "status":
      return node.status;
    case "name":
      return node.name;
    case "owner":
      return node.owner;
    case "cost":
      return node.costMonthly;
    case "id":
      return node.id;
    case "nativeId":
      return node.nativeId;
    default:
      return null;
  }
}

function compareValues(
  fieldVal: unknown,
  op: ComparisonOp,
  target: IQLValue,
): boolean {
  if (op === "IN") {
    if (!Array.isArray(target)) return false;
    return target.some(
      (t) => fieldVal === t || String(fieldVal) === String(t),
    );
  }

  if (op === "LIKE") {
    if (typeof fieldVal !== "string" || typeof target !== "string") return false;
    // Convert SQL LIKE to regex: % → .*, _ → .
    const escaped = target
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/%/g, ".*")
      .replace(/_/g, ".");
    return new RegExp(`^${escaped}$`, "i").test(fieldVal);
  }

  if (op === "MATCHES") {
    if (typeof fieldVal !== "string" || typeof target !== "string") return false;
    return new RegExp(target, "i").test(fieldVal);
  }

  switch (op) {
    case "=":
      if (fieldVal == null && target == null) return true;
      return fieldVal === target || String(fieldVal) === String(target);
    case "!=":
      return fieldVal !== target && String(fieldVal) !== String(target);
    case ">":
      return Number(fieldVal) > Number(target);
    case "<":
      return Number(fieldVal) < Number(target);
    case ">=":
      return Number(fieldVal) >= Number(target);
    case "<=":
      return Number(fieldVal) <= Number(target);
    default:
      return false;
  }
}

/**
 * Find nodes matching a glob pattern in their ID.
 * Supports * wildcard (matches anything except ':').
 */
async function findMatchingNodes(
  storage: GraphStorage,
  pattern: string,
): Promise<GraphNode[]> {
  if (!pattern.includes("*")) {
    const node = await storage.getNode(pattern);
    return node ? [node] : [];
  }

  // Convert glob to regex (each * matches non-colon chars)
  const regexStr =
    "^" +
    pattern
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\*/g, "[^:]*") +
    "$";
  const regex = new RegExp(regexStr);

  const allNodes = await storage.queryNodes({});
  return allNodes.filter((n) => regex.test(n.id));
}

function nodeToResult(node: GraphNode): IQLFindResult["nodes"][0] {
  return {
    id: node.id,
    name: node.name,
    provider: node.provider,
    resourceType: node.resourceType,
    region: node.region,
    account: node.account,
    status: node.status,
    costMonthly: node.costMonthly,
    owner: node.owner,
    tags: node.tags,
  };
}

function emptyFindResult(): IQLFindResult {
  return { type: "find", nodes: [], totalCount: 0, totalCost: 0 };
}

function emptyDiffResult(from: string, to: string): IQLDiffResult {
  return {
    type: "diff",
    fromTimestamp: from,
    toTimestamp: to,
    added: 0,
    removed: 0,
    changed: 0,
    costDelta: 0,
    details: [],
  };
}
