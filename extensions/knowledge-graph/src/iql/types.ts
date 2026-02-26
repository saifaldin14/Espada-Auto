/**
 * IQL (Infrastructure Query Language) — Type Definitions
 *
 * Token types, AST nodes, and query result shapes.
 */

// =============================================================================
// Tokens
// =============================================================================

export type TokenType =
  | "KEYWORD"
  | "IDENTIFIER"
  | "STRING"
  | "NUMBER"
  | "OPERATOR"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "DOT"
  | "STAR"
  | "EOF";

export type Token = {
  type: TokenType;
  value: string;
  position: number;
};

// =============================================================================
// AST
// =============================================================================

/** Top-level IQL query. */
export type IQLQuery = FindQuery | SummarizeQuery;

/** FIND query — search and filter infrastructure resources. */
export type FindQuery = {
  type: "find";
  target: FindTarget;
  where: Condition | null;
  /** Temporal AT clause — query graph state at this timestamp. */
  at: string | null;
  /** DIFF WITH clause — compare two points in time. */
  diff: DiffTarget | null;
  limit: number | null;
};

/** SUMMARIZE query — aggregate and group resources. */
export type SummarizeQuery = {
  type: "summarize";
  metric: AggregateMetric;
  groupBy: string[];
  where: Condition | null;
};

/** Aggregation metric — what to compute per group. */
export type AggregateMetric =
  | { fn: "count" }
  | { fn: "sum"; field: string }
  | { fn: "avg"; field: string }
  | { fn: "min"; field: string }
  | { fn: "max"; field: string };

/** Target of a FIND query. */
export type FindTarget =
  | { kind: "resources" }
  | { kind: "downstream"; nodeId: string }
  | { kind: "upstream"; nodeId: string }
  | { kind: "path"; from: string; to: string };

/** DIFF WITH target. */
export type DiffTarget = {
  target: string; // ISO timestamp or "NOW"
};

// -- Conditions ---------------------------------------------------------------

export type Condition =
  | FieldCondition
  | FunctionCondition
  | NotCondition
  | AndCondition
  | OrCondition;

export type FieldCondition = {
  type: "field";
  /** e.g. "provider", "tag.Environment", "cost" */
  field: string;
  operator: ComparisonOp;
  value: IQLValue;
};

export type FunctionCondition = {
  type: "function";
  /** e.g. "tagged", "drifted_since", "has_edge" */
  name: string;
  args: IQLValue[];
};

export type NotCondition = {
  type: "not";
  inner: Condition;
};

export type AndCondition = {
  type: "and";
  conditions: Condition[];
};

export type OrCondition = {
  type: "or";
  conditions: Condition[];
};

export type ComparisonOp =
  | "="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "LIKE"
  | "IN"
  | "MATCHES";

/** Scalar or list value in IQL expressions. */
export type IQLValue = string | number | boolean | IQLValue[];

// =============================================================================
// Query Results
// =============================================================================

/** Discriminated union of all possible IQL results. */
export type IQLResult =
  | IQLFindResult
  | IQLSummarizeResult
  | IQLDiffResult
  | IQLPathResult;

export type IQLFindResult = {
  type: "find";
  nodes: Array<{
    id: string;
    name: string;
    provider: string;
    resourceType: string;
    region: string;
    account: string;
    status: string;
    costMonthly: number | null;
    owner: string | null;
    tags: Record<string, string>;
  }>;
  totalCount: number;
  totalCost: number;
};

export type IQLSummarizeResult = {
  type: "summarize";
  groups: Array<{
    key: Record<string, string>;
    value: number;
  }>;
  total: number;
};

export type IQLDiffResult = {
  type: "diff";
  fromTimestamp: string;
  toTimestamp: string;
  added: number;
  removed: number;
  changed: number;
  costDelta: number;
  details: Array<{
    nodeId: string;
    name: string;
    change: "added" | "removed" | "changed";
    changedFields?: string[];
  }>;
};

export type IQLPathResult = {
  type: "path";
  found: boolean;
  path: Array<{
    nodeId: string;
    name: string;
    resourceType: string;
  }>;
  hops: number;
  edges: Array<{
    from: string;
    to: string;
    relationshipType: string;
  }>;
};
