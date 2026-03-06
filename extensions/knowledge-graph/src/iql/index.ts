/**
 * IQL (Infrastructure Query Language) — Public API
 *
 * A purpose-built query language for infrastructure resources.
 * Supports FIND, SUMMARIZE, WHERE, AT, DIFF, PATH, and LIMIT.
 *
 * Usage:
 *   import { parseIQL, executeQuery } from './iql/index.js';
 *
 *   const ast = parseIQL("FIND resources WHERE provider = 'aws' AND cost > 100");
 *   const result = await executeQuery(ast, { storage });
 */

// Lexer
export { IQLLexer, IQLSyntaxError, IQLLimitError } from "./lexer.js";

// Parser
export { IQLParser, parseIQL } from "./parser.js";

// Executor
export { executeQuery } from "./executor.js";
export type { IQLExecutorOptions } from "./executor.js";

// Types
export type {
  // Tokens
  Token,
  TokenType,
  // AST
  IQLQuery,
  FindQuery,
  SummarizeQuery,
  AggregateMetric,
  FindTarget,
  Condition,
  FieldCondition,
  FunctionCondition,
  NotCondition,
  AndCondition,
  OrCondition,
  ComparisonOp,
  IQLValue,
  DiffTarget,
  // Results
  IQLResult,
  IQLFindResult,
  IQLSummarizeResult,
  IQLDiffResult,
  IQLPathResult,
  // Limits
  IQLLimits,
  ResolvedIQLLimits,
} from "./types.js";

export { DEFAULT_IQL_LIMITS, resolveIQLLimits } from "./types.js";
