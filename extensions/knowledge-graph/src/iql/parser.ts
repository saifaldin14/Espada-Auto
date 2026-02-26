/**
 * IQL — Recursive Descent Parser
 *
 * Transforms a token stream into an AST. Supports:
 * - FIND resources / downstream / upstream / path queries
 * - WHERE clause with AND, OR, NOT, field conditions, function calls
 * - AT clause for temporal queries
 * - DIFF WITH clause for snapshot comparison
 * - LIMIT clause
 * - SUMMARIZE cost|count BY field1, field2 WHERE ...
 *
 * Grammar (simplified):
 *   query       → find_query | summarize_query
 *   find_query  → FIND target at_clause? where_clause? diff_clause? limit_clause?
 *   target      → RESOURCES | DOWNSTREAM OF string | UPSTREAM OF string
 *                | PATH FROM string TO string
 *   at_clause   → AT string
 *   where_clause→ WHERE or_cond
 *   or_cond     → and_cond (OR and_cond)*
 *   and_cond    → unary (AND unary)*
 *   unary       → NOT unary | '(' or_cond ')' | primary
 *   primary     → function_call | field_cond
 *   function_call → ident '(' args ')'
 *   field_cond  → field operator value
 *   diff_clause → DIFF WITH (string | NOW)
 *   limit_clause→ LIMIT number
 *   summarize   → SUMMARIZE metric BY group_list where_clause?
 */

import type {
  Token,
  IQLQuery,
  FindQuery,
  SummarizeQuery,
  FindTarget,
  Condition,
  FieldCondition,
  FunctionCondition,
  ComparisonOp,
  IQLValue,
  DiffTarget,
  AggregateMetric,
} from "./types.js";
import { IQLLexer, IQLSyntaxError } from "./lexer.js";

export class IQLParser {
  private tokens: Token[];
  private pos = 0;
  private source: string;

  constructor(source: string) {
    this.source = source;
    this.tokens = new IQLLexer(source).tokenize();
  }

  parse(): IQLQuery {
    const kw = this.peekKeyword();
    let query: IQLQuery;

    if (kw === "FIND") {
      query = this.parseFindQuery();
    } else if (kw === "SUMMARIZE") {
      query = this.parseSummarizeQuery();
    } else {
      throw this.error(
        `Expected FIND or SUMMARIZE, got '${this.current().value}'`,
      );
    }

    this.expect("EOF");
    return query;
  }

  // ---------------------------------------------------------------------------
  // FIND
  // ---------------------------------------------------------------------------

  private parseFindQuery(): FindQuery {
    this.consumeKeyword("FIND");
    const target = this.parseTarget();

    // AT clause (temporal — only for "resources" target)
    let at: string | null = null;
    if (target.kind === "resources" && this.peekKeyword() === "AT") {
      this.consumeKeyword("AT");
      at = this.consumeString();
    }

    // WHERE clause
    let where: Condition | null = null;
    if (this.peekKeyword() === "WHERE") {
      this.consumeKeyword("WHERE");
      where = this.parseOrCondition();
    }

    // DIFF clause
    let diff: DiffTarget | null = null;
    if (this.peekKeyword() === "DIFF") {
      this.consumeKeyword("DIFF");
      this.consumeKeyword("WITH");
      if (this.peekKeyword() === "NOW") {
        this.consumeKeyword("NOW");
        diff = { target: "NOW" };
      } else {
        diff = { target: this.consumeString() };
      }
    }

    // LIMIT clause
    let limit: number | null = null;
    if (this.peekKeyword() === "LIMIT") {
      this.consumeKeyword("LIMIT");
      limit = this.consumeNumber();
    }

    return { type: "find", target, where, at, diff, limit };
  }

  private parseTarget(): FindTarget {
    const kw = this.peekKeyword();

    if (kw === "RESOURCES") {
      this.consumeKeyword("RESOURCES");
      return { kind: "resources" };
    }
    if (kw === "DOWNSTREAM") {
      this.consumeKeyword("DOWNSTREAM");
      this.consumeKeyword("OF");
      return { kind: "downstream", nodeId: this.consumeString() };
    }
    if (kw === "UPSTREAM") {
      this.consumeKeyword("UPSTREAM");
      this.consumeKeyword("OF");
      return { kind: "upstream", nodeId: this.consumeString() };
    }
    if (kw === "PATH") {
      this.consumeKeyword("PATH");
      this.consumeKeyword("FROM");
      const from = this.consumeString();
      this.consumeKeyword("TO");
      const to = this.consumeString();
      return { kind: "path", from, to };
    }

    throw this.error(
      "Expected RESOURCES, DOWNSTREAM, UPSTREAM, or PATH after FIND",
    );
  }

  // ---------------------------------------------------------------------------
  // SUMMARIZE
  // ---------------------------------------------------------------------------

  private parseSummarizeQuery(): SummarizeQuery {
    this.consumeKeyword("SUMMARIZE");

    const metric = this.parseAggregateMetric();

    this.consumeKeyword("BY");
    const groupBy = this.parseGroupByList();

    let where: Condition | null = null;
    if (this.peekKeyword() === "WHERE") {
      this.consumeKeyword("WHERE");
      where = this.parseOrCondition();
    }

    return {
      type: "summarize",
      metric,
      groupBy,
      where,
    };
  }

  /**
   * Parse an aggregate metric. Supports:
   *   - Bare keywords (backward compat): cost → sum(cost), count → count
   *   - Function form: sum(field), avg(field), min(field), max(field), count
   *   - COUNT keyword (no field argument)
   */
  private parseAggregateMetric(): AggregateMetric {
    const kw = this.peekKeyword();

    // Aggregation function keywords: SUM(field), AVG(field), MIN(field), MAX(field)
    if (kw === "SUM" || kw === "AVG" || kw === "MIN" || kw === "MAX") {
      this.pos++; // consume the keyword
      this.consume("LPAREN");
      const field = this.parseFieldName();
      this.consume("RPAREN");
      return { fn: kw.toLowerCase() as "sum" | "avg" | "min" | "max", field };
    }

    // COUNT keyword (no field argument needed)
    if (kw === "COUNT") {
      this.pos++;
      return { fn: "count" };
    }

    // Backward compat: bare identifier (cost → sum(cost), count → count)
    const metricToken = this.consume("IDENTIFIER");
    const metric = metricToken.value.toLowerCase();
    if (metric === "cost") {
      return { fn: "sum", field: "cost" };
    }
    if (metric === "count") {
      return { fn: "count" };
    }

    throw this.error(
      `Expected aggregation function (SUM, AVG, MIN, MAX, COUNT) or 'cost'/'count' after SUMMARIZE, got '${metric}'`,
    );
  }

  private parseGroupByList(): string[] {
    const fields: string[] = [];
    fields.push(this.parseFieldName());
    while (this.peek().type === "COMMA") {
      this.consume("COMMA");
      fields.push(this.parseFieldName());
    }
    return fields;
  }

  // ---------------------------------------------------------------------------
  // Conditions (WHERE clause)
  // ---------------------------------------------------------------------------

  private parseOrCondition(): Condition {
    let left = this.parseAndCondition();
    while (this.peekKeyword() === "OR") {
      this.consumeKeyword("OR");
      const right = this.parseAndCondition();
      if (left.type === "or") {
        (left as { conditions: Condition[] }).conditions.push(right);
      } else {
        left = { type: "or", conditions: [left, right] };
      }
    }
    return left;
  }

  private parseAndCondition(): Condition {
    let left = this.parseUnaryCondition();
    while (this.peekKeyword() === "AND") {
      this.consumeKeyword("AND");
      const right = this.parseUnaryCondition();
      if (left.type === "and") {
        (left as { conditions: Condition[] }).conditions.push(right);
      } else {
        left = { type: "and", conditions: [left, right] };
      }
    }
    return left;
  }

  private parseUnaryCondition(): Condition {
    // NOT prefix
    if (this.peekKeyword() === "NOT") {
      this.consumeKeyword("NOT");
      const inner = this.parseUnaryCondition();
      return { type: "not", inner };
    }
    // Parenthesized expression
    if (this.peek().type === "LPAREN") {
      this.consume("LPAREN");
      const condition = this.parseOrCondition();
      this.consume("RPAREN");
      return condition;
    }
    return this.parsePrimaryCondition();
  }

  private parsePrimaryCondition(): Condition {
    // Lookahead: identifier followed by '(' → function call
    if (
      this.peek().type === "IDENTIFIER" &&
      this.peekAt(1)?.type === "LPAREN"
    ) {
      return this.parseFunctionCondition();
    }
    return this.parseFieldCondition();
  }

  private parseFunctionCondition(): FunctionCondition {
    const name = this.consume("IDENTIFIER").value;
    this.consume("LPAREN");
    const args: IQLValue[] = [];
    if (this.peek().type !== "RPAREN") {
      args.push(this.parseValue());
      while (this.peek().type === "COMMA") {
        this.consume("COMMA");
        args.push(this.parseValue());
      }
    }
    this.consume("RPAREN");
    return { type: "function", name, args };
  }

  private parseFieldCondition(): FieldCondition {
    const field = this.parseFieldName();
    const operator = this.parseOperator();
    const value = operator === "IN" ? this.parseValueList() : this.parseValue();
    return { type: "field", field, operator, value };
  }

  private parseFieldName(): string {
    const token = this.consume("IDENTIFIER");
    let name = token.value;
    // Dotted field access: tag.Name, metadata.instanceType
    while (this.peek().type === "DOT") {
      this.consume("DOT");
      const part = this.consume("IDENTIFIER");
      name += "." + part.value;
    }
    return name;
  }

  private parseOperator(): ComparisonOp {
    const token = this.peek();
    if (token.type === "OPERATOR") {
      this.pos++;
      return token.value as ComparisonOp;
    }
    // LIKE, IN, MATCHES as keyword operators
    const kw = this.peekKeyword();
    if (kw === "LIKE" || kw === "IN" || kw === "MATCHES") {
      this.pos++;
      return kw as ComparisonOp;
    }
    throw this.error(
      "Expected operator (=, !=, >, <, >=, <=, LIKE, IN, MATCHES)",
    );
  }

  private parseValue(): IQLValue {
    const token = this.peek();
    if (token.type === "STRING") {
      this.pos++;
      return token.value;
    }
    if (token.type === "NUMBER") {
      this.pos++;
      return parseFloat(token.value);
    }
    if (
      token.type === "KEYWORD" &&
      (token.value === "TRUE" || token.value === "FALSE")
    ) {
      this.pos++;
      return token.value === "TRUE";
    }
    if (token.type === "LPAREN") {
      return this.parseValueList();
    }
    throw this.error("Expected value (string, number, boolean, or list)");
  }

  private parseValueList(): IQLValue[] {
    this.consume("LPAREN");
    const values: IQLValue[] = [];
    if (this.peek().type !== "RPAREN") {
      values.push(this.parseValue());
      while (this.peek().type === "COMMA") {
        this.consume("COMMA");
        values.push(this.parseValue());
      }
    }
    this.consume("RPAREN");
    return values;
  }

  // ---------------------------------------------------------------------------
  // Token helpers
  // ---------------------------------------------------------------------------

  private current(): Token {
    return (
      this.tokens[this.pos] ?? {
        type: "EOF" as const,
        value: "",
        position: this.source.length,
      }
    );
  }

  private peek(): Token {
    return this.current();
  }

  private peekAt(offset: number): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private peekKeyword(): string | null {
    const t = this.peek();
    return t.type === "KEYWORD" ? t.value : null;
  }

  private consume(expectedType: string): Token {
    const token = this.current();
    if (token.type !== expectedType) {
      throw this.error(
        `Expected ${expectedType}, got ${token.type} ('${token.value}')`,
      );
    }
    this.pos++;
    return token;
  }

  private consumeKeyword(keyword: string): void {
    const token = this.current();
    if (token.type !== "KEYWORD" || token.value !== keyword) {
      throw this.error(
        `Expected keyword '${keyword}', got '${token.value}'`,
      );
    }
    this.pos++;
  }

  private consumeString(): string {
    return this.consume("STRING").value;
  }

  private consumeNumber(): number {
    return parseFloat(this.consume("NUMBER").value);
  }

  private expect(type: string): void {
    if (this.current().type !== type) {
      throw this.error(
        `Expected ${type}, got ${this.current().type} ('${this.current().value}')`,
      );
    }
  }

  private error(message: string): IQLSyntaxError {
    return new IQLSyntaxError(message, this.current().position, this.source);
  }
}

/**
 * Parse an IQL query string into an AST.
 * @throws IQLSyntaxError on malformed input.
 */
export function parseIQL(source: string): IQLQuery {
  return new IQLParser(source).parse();
}
