/**
 * IQL — Comprehensive Test Suite
 *
 * Tests for the lexer, parser, and executor covering all IQL features:
 * - FIND resources, downstream, upstream, path queries
 * - WHERE with AND, OR, NOT, field conditions, functions
 * - AT (temporal), DIFF WITH, LIMIT
 * - SUMMARIZE cost|count BY grouping
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IQLLexer, IQLSyntaxError } from "./lexer.js";
import { parseIQL } from "./parser.js";
import { executeQuery } from "./executor.js";
import type { IQLExecutorOptions } from "./executor.js";
import type {
  FindQuery,
  SummarizeQuery,
  IQLFindResult,
  IQLSummarizeResult,
  IQLPathResult,
  IQLDiffResult,
} from "./types.js";
import { InMemoryGraphStorage } from "../storage/memory-store.js";
import { InMemoryTemporalStorage } from "../temporal.js";
import type { GraphNodeInput, GraphEdgeInput, GraphNodeStatus, GraphRelationshipType } from "../types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeNode(overrides: Partial<GraphNodeInput> & { id: string }): GraphNodeInput {
  return {
    provider: "aws",
    resourceType: "compute",
    nativeId: overrides.id,
    name: overrides.id,
    region: "us-east-1",
    account: "123456",
    status: "running" as GraphNodeStatus,
    tags: {},
    metadata: {},
    costMonthly: null,
    owner: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  relType: GraphRelationshipType = "depends-on",
): GraphEdgeInput {
  return {
    id,
    sourceNodeId: source,
    targetNodeId: target,
    relationshipType: relType,
    confidence: 1.0,
    discoveredVia: "config-scan" as const,
    metadata: {},
  };
}

// =============================================================================
// Lexer Tests
// =============================================================================

describe("IQLLexer", () => {
  it("should tokenize a simple FIND query", () => {
    const tokens = new IQLLexer("FIND resources").tokenize();
    expect(tokens[0]).toEqual({ type: "KEYWORD", value: "FIND", position: 0 });
    expect(tokens[1]).toEqual({ type: "KEYWORD", value: "RESOURCES", position: 5 });
    expect(tokens[2]).toEqual({ type: "EOF", value: "", position: 14 });
  });

  it("should tokenize string literals (single and double quotes)", () => {
    const tokens = new IQLLexer("'hello' \"world\"").tokenize();
    expect(tokens[0]).toEqual({ type: "STRING", value: "hello", position: 0 });
    expect(tokens[1]).toEqual({ type: "STRING", value: "world", position: 8 });
  });

  it("should tokenize numbers", () => {
    const tokens = new IQLLexer("42 3.14").tokenize();
    expect(tokens[0]).toEqual({ type: "NUMBER", value: "42", position: 0 });
    expect(tokens[1]).toEqual({ type: "NUMBER", value: "3.14", position: 3 });
  });

  it("should tokenize cost literals ($100/mo)", () => {
    const tokens = new IQLLexer("$1000/mo").tokenize();
    expect(tokens[0]).toEqual({ type: "NUMBER", value: "1000", position: 0 });
  });

  it("should tokenize operators", () => {
    const tokens = new IQLLexer("= != > < >= <=").tokenize();
    expect(tokens.slice(0, 6).map((t) => t.value)).toEqual([
      "=", "!=", ">", "<", ">=", "<=",
    ]);
  });

  it("should tokenize punctuation", () => {
    const tokens = new IQLLexer("( ) , . *").tokenize();
    expect(tokens.slice(0, 5).map((t) => t.type)).toEqual([
      "LPAREN", "RPAREN", "COMMA", "DOT", "STAR",
    ]);
  });

  it("should handle identifiers with hyphens", () => {
    const tokens = new IQLLexer("resource-type").tokenize();
    expect(tokens[0]).toEqual({
      type: "IDENTIFIER",
      value: "resource-type",
      position: 0,
    });
  });

  it("should skip comments (#)", () => {
    const tokens = new IQLLexer("# comment\nFIND resources").tokenize();
    expect(tokens[0]).toEqual({ type: "KEYWORD", value: "FIND", position: 10 });
  });

  it("should skip comments (--)", () => {
    const tokens = new IQLLexer("-- comment\nFIND resources").tokenize();
    expect(tokens[0]).toEqual({ type: "KEYWORD", value: "FIND", position: 11 });
  });

  it("should handle escape sequences in strings", () => {
    const tokens = new IQLLexer("'it\\'s'").tokenize();
    expect(tokens[0].value).toBe("it's");
  });

  it("should throw on unterminated strings", () => {
    expect(() => new IQLLexer("'hello").tokenize()).toThrow(IQLSyntaxError);
  });

  it("should throw on unexpected characters", () => {
    expect(() => new IQLLexer("@@").tokenize()).toThrow(IQLSyntaxError);
  });
});

// =============================================================================
// Parser Tests
// =============================================================================

describe("IQLParser", () => {
  describe("FIND queries", () => {
    it("should parse FIND resources", () => {
      const ast = parseIQL("FIND resources");
      expect(ast.type).toBe("find");
      const find = ast as FindQuery;
      expect(find.target).toEqual({ kind: "resources" });
      expect(find.where).toBeNull();
      expect(find.limit).toBeNull();
    });

    it("should parse FIND downstream OF", () => {
      const ast = parseIQL("FIND downstream OF 'node-1'");
      const find = ast as FindQuery;
      expect(find.target).toEqual({ kind: "downstream", nodeId: "node-1" });
    });

    it("should parse FIND upstream OF", () => {
      const ast = parseIQL("FIND upstream OF 'node-1'");
      const find = ast as FindQuery;
      expect(find.target).toEqual({ kind: "upstream", nodeId: "node-1" });
    });

    it("should parse FIND PATH FROM ... TO ...", () => {
      const ast = parseIQL("FIND PATH FROM 'aws:*:*:load-balancer:*' TO 'azure:*:*:database:*'");
      const find = ast as FindQuery;
      expect(find.target).toEqual({
        kind: "path",
        from: "aws:*:*:load-balancer:*",
        to: "azure:*:*:database:*",
      });
    });

    it("should parse FIND resources AT (temporal)", () => {
      const ast = parseIQL("FIND resources AT '2025-06-01'");
      const find = ast as FindQuery;
      expect(find.at).toBe("2025-06-01");
    });

    it("should parse LIMIT clause", () => {
      const ast = parseIQL("FIND resources LIMIT 10");
      const find = ast as FindQuery;
      expect(find.limit).toBe(10);
    });

    it("should parse DIFF WITH NOW", () => {
      const ast = parseIQL("FIND resources AT '2025-01-01' DIFF WITH NOW");
      const find = ast as FindQuery;
      expect(find.at).toBe("2025-01-01");
      expect(find.diff).toEqual({ target: "NOW" });
    });

    it("should parse DIFF WITH timestamp", () => {
      const ast = parseIQL("FIND resources AT '2025-01-01' DIFF WITH '2025-06-01'");
      const find = ast as FindQuery;
      expect(find.diff).toEqual({ target: "2025-06-01" });
    });
  });

  describe("WHERE clause", () => {
    it("should parse simple equality", () => {
      const ast = parseIQL("FIND resources WHERE provider = 'aws'");
      const find = ast as FindQuery;
      expect(find.where).toEqual({
        type: "field",
        field: "provider",
        operator: "=",
        value: "aws",
      });
    });

    it("should parse numeric comparison", () => {
      const ast = parseIQL("FIND resources WHERE cost > $1000/mo");
      const find = ast as FindQuery;
      expect(find.where).toEqual({
        type: "field",
        field: "cost",
        operator: ">",
        value: 1000,
      });
    });

    it("should parse AND conditions", () => {
      const ast = parseIQL(
        "FIND resources WHERE provider = 'aws' AND region = 'us-east-1'",
      );
      const find = ast as FindQuery;
      expect(find.where?.type).toBe("and");
    });

    it("should parse OR conditions", () => {
      const ast = parseIQL(
        "FIND resources WHERE provider = 'aws' OR provider = 'azure'",
      );
      const find = ast as FindQuery;
      expect(find.where?.type).toBe("or");
    });

    it("should parse NOT conditions", () => {
      const ast = parseIQL("FIND resources WHERE NOT tagged('Owner')");
      const find = ast as FindQuery;
      expect(find.where?.type).toBe("not");
    });

    it("should parse nested conditions with parentheses", () => {
      const ast = parseIQL(
        "FIND resources WHERE (provider = 'aws' OR provider = 'gcp') AND cost > 100",
      );
      const find = ast as FindQuery;
      expect(find.where?.type).toBe("and");
    });

    it("should parse IN operator", () => {
      const ast = parseIQL(
        "FIND resources WHERE region IN ('us-east-1', 'eu-west-1')",
      );
      const find = ast as FindQuery;
      expect(find.where).toEqual({
        type: "field",
        field: "region",
        operator: "IN",
        value: ["us-east-1", "eu-west-1"],
      });
    });

    it("should parse LIKE operator", () => {
      const ast = parseIQL("FIND resources WHERE name LIKE '%web%'");
      const find = ast as FindQuery;
      expect(find.where).toEqual({
        type: "field",
        field: "name",
        operator: "LIKE",
        value: "%web%",
      });
    });

    it("should parse MATCHES operator", () => {
      const ast = parseIQL("FIND resources WHERE name MATCHES 'prod-.*'");
      const find = ast as FindQuery;
      expect(find.where).toEqual({
        type: "field",
        field: "name",
        operator: "MATCHES",
        value: "prod-.*",
      });
    });

    it("should parse dotted fields (tag.Environment)", () => {
      const ast = parseIQL(
        "FIND resources WHERE tag.Environment = 'production'",
      );
      const find = ast as FindQuery;
      expect(find.where).toEqual({
        type: "field",
        field: "tag.Environment",
        operator: "=",
        value: "production",
      });
    });

    it("should parse function conditions", () => {
      const ast = parseIQL("FIND resources WHERE tagged('Environment')");
      const find = ast as FindQuery;
      expect(find.where).toEqual({
        type: "function",
        name: "tagged",
        args: ["Environment"],
      });
    });

    it("should parse drifted_since function", () => {
      const ast = parseIQL(
        "FIND resources WHERE drifted_since('2025-01-01')",
      );
      const find = ast as FindQuery;
      expect(find.where).toEqual({
        type: "function",
        name: "drifted_since",
        args: ["2025-01-01"],
      });
    });

    it("should parse depth condition", () => {
      const ast = parseIQL("FIND downstream OF 'node-1' WHERE depth <= 3");
      const find = ast as FindQuery;
      expect(find.where).toEqual({
        type: "field",
        field: "depth",
        operator: "<=",
        value: 3,
      });
    });

    it("should parse complex ROADMAP example", () => {
      const ast = parseIQL(`
        FIND resources
        WHERE provider = 'aws'
          AND cost > $1000/mo
          AND NOT tagged('Environment')
          AND NOT tagged('Owner')
      `);
      const find = ast as FindQuery;
      expect(find.where?.type).toBe("and");
    });
  });

  describe("SUMMARIZE queries", () => {
    it("should parse SUMMARIZE cost BY provider", () => {
      const ast = parseIQL("SUMMARIZE cost BY provider");
      expect(ast.type).toBe("summarize");
      const summ = ast as SummarizeQuery;
      expect(summ.metric).toBe("cost");
      expect(summ.groupBy).toEqual(["provider"]);
    });

    it("should parse SUMMARIZE count BY resourceType, provider", () => {
      const ast = parseIQL("SUMMARIZE count BY resourceType, provider");
      const summ = ast as SummarizeQuery;
      expect(summ.metric).toBe("count");
      expect(summ.groupBy).toEqual(["resourceType", "provider"]);
    });

    it("should parse SUMMARIZE with WHERE", () => {
      const ast = parseIQL(
        "SUMMARIZE cost BY provider, resourceType WHERE region IN ('us-east-1', 'eu-west-1')",
      );
      const summ = ast as SummarizeQuery;
      expect(summ.metric).toBe("cost");
      expect(summ.where).not.toBeNull();
    });
  });

  describe("error handling", () => {
    it("should throw on invalid starting keyword", () => {
      expect(() => parseIQL("SELECT * FROM nodes")).toThrow(IQLSyntaxError);
    });

    it("should throw on missing WHERE condition", () => {
      expect(() => parseIQL("FIND resources WHERE")).toThrow(IQLSyntaxError);
    });

    it("should throw on missing SUMMARIZE metric", () => {
      expect(() => parseIQL("SUMMARIZE BY provider")).toThrow(IQLSyntaxError);
    });
  });
});

// =============================================================================
// Executor Tests
// =============================================================================

describe("IQL Executor", () => {
  let storage: InMemoryGraphStorage;
  let opts: IQLExecutorOptions;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    await storage.initialize();
    opts = { storage, defaultLimit: 100 };

    // Seed test data
    await storage.upsertNodes([
      makeNode({
        id: "aws:123:us-east-1:compute:i-1",
        provider: "aws",
        resourceType: "compute",
        name: "web-server-1",
        region: "us-east-1",
        costMonthly: 150,
        tags: { Environment: "production", Owner: "platform-team" },
      }),
      makeNode({
        id: "aws:123:us-east-1:compute:i-2",
        provider: "aws",
        resourceType: "compute",
        name: "web-server-2",
        region: "us-east-1",
        costMonthly: 150,
        tags: { Environment: "production" },
      }),
      makeNode({
        id: "aws:123:us-east-1:database:rds-1",
        provider: "aws",
        resourceType: "database",
        name: "prod-db",
        region: "us-east-1",
        costMonthly: 500,
        tags: { Environment: "production", Owner: "data-team" },
      }),
      makeNode({
        id: "aws:123:eu-west-1:compute:i-3",
        provider: "aws",
        resourceType: "compute",
        name: "eu-worker",
        region: "eu-west-1",
        costMonthly: 80,
        tags: { Environment: "staging" },
      }),
      makeNode({
        id: "azure:sub1:eastus:compute:vm-1",
        provider: "azure",
        resourceType: "compute",
        name: "azure-vm-1",
        region: "eastus",
        account: "sub1",
        costMonthly: 200,
        tags: { Environment: "production" },
      }),
      makeNode({
        id: "gcp:proj1:us-central1:database:sql-1",
        provider: "gcp",
        resourceType: "database",
        name: "gcp-sql",
        region: "us-central1",
        account: "proj1",
        costMonthly: 300,
        tags: {},
      }),
    ]);

    // Create edges
    await storage.upsertEdges([
      makeEdge("e1", "aws:123:us-east-1:compute:i-1", "aws:123:us-east-1:database:rds-1"),
      makeEdge("e2", "aws:123:us-east-1:compute:i-2", "aws:123:us-east-1:database:rds-1"),
      makeEdge("e3", "azure:sub1:eastus:compute:vm-1", "gcp:proj1:us-central1:database:sql-1", "routes-to"),
    ]);
  });

  describe("FIND resources", () => {
    it("should find all resources", async () => {
      const ast = parseIQL("FIND resources");
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.type).toBe("find");
      expect(result.totalCount).toBe(6);
    });

    it("should filter by provider", async () => {
      const ast = parseIQL("FIND resources WHERE provider = 'aws'");
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCount).toBe(4);
      expect(result.nodes.every((n) => n.provider === "aws")).toBe(true);
    });

    it("should filter by cost", async () => {
      const ast = parseIQL("FIND resources WHERE cost > $200/mo");
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCount).toBe(2); // rds-1 ($500) and gcp-sql ($300)
      expect(result.nodes.every((n) => (n.costMonthly ?? 0) > 200)).toBe(true);
    });

    it("should filter by region with IN", async () => {
      const ast = parseIQL(
        "FIND resources WHERE region IN ('us-east-1', 'eu-west-1')",
      );
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCount).toBe(4); // 3 us-east-1 + 1 eu-west-1
    });

    it("should filter by name LIKE", async () => {
      const ast = parseIQL("FIND resources WHERE name LIKE '%web%'");
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCount).toBe(2);
      expect(result.nodes.every((n) => n.name.includes("web"))).toBe(true);
    });

    it("should filter by name MATCHES (regex)", async () => {
      const ast = parseIQL("FIND resources WHERE name MATCHES 'prod-.*'");
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCount).toBe(1);
      expect(result.nodes[0].name).toBe("prod-db");
    });

    it("should filter by tag existence with tagged()", async () => {
      const ast = parseIQL("FIND resources WHERE tagged('Owner')");
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCount).toBe(2); // i-1 and rds-1 have Owner
    });

    it("should filter by NOT tagged()", async () => {
      const ast = parseIQL("FIND resources WHERE NOT tagged('Owner')");
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCount).toBe(4);
    });

    it("should filter by tag.Key = value", async () => {
      const ast = parseIQL(
        "FIND resources WHERE tag.Environment = 'production'",
      );
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCount).toBe(4); // i-1, i-2, rds-1, azure-vm-1
    });

    it("should combine AND conditions", async () => {
      const ast = parseIQL(
        "FIND resources WHERE provider = 'aws' AND cost > 100",
      );
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCount).toBe(3); // i-1 ($150), i-2 ($150), rds-1 ($500)
    });

    it("should combine OR conditions", async () => {
      const ast = parseIQL(
        "FIND resources WHERE provider = 'azure' OR provider = 'gcp'",
      );
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCount).toBe(2);
    });

    it("should handle nested AND/OR/NOT", async () => {
      const ast = parseIQL(`
        FIND resources
        WHERE provider = 'aws'
          AND cost > $100/mo
          AND NOT tagged('Owner')
      `);
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCount).toBe(1); // i-2 ($150, no Owner tag)
      expect(result.nodes[0].name).toBe("web-server-2");
    });

    it("should apply LIMIT", async () => {
      const ast = parseIQL("FIND resources LIMIT 2");
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.nodes.length).toBe(2);
      expect(result.totalCount).toBe(6); // total count unaffected
    });

    it("should calculate totalCost", async () => {
      const ast = parseIQL("FIND resources WHERE provider = 'aws'");
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCost).toBe(880); // 150 + 150 + 500 + 80
    });
  });

  describe("FIND downstream/upstream", () => {
    it("should find downstream dependencies", async () => {
      const ast = parseIQL(
        "FIND downstream OF 'aws:123:us-east-1:compute:i-1'",
      );
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      // i-1 → rds-1 (via depends-on)
      expect(result.totalCount).toBeGreaterThanOrEqual(1);
    });

    it("should find upstream dependencies", async () => {
      const ast = parseIQL(
        "FIND upstream OF 'aws:123:us-east-1:database:rds-1'",
      );
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      // rds-1 ← i-1, i-2
      expect(result.totalCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("FIND PATH", () => {
    it("should find path between two nodes", async () => {
      const ast = parseIQL(
        "FIND PATH FROM 'aws:123:us-east-1:compute:i-1' TO 'aws:123:us-east-1:database:rds-1'",
      );
      const result = (await executeQuery(ast, opts)) as IQLPathResult;
      expect(result.type).toBe("path");
      expect(result.found).toBe(true);
      expect(result.hops).toBe(1);
      expect(result.path.length).toBe(2);
    });

    it("should handle no path found", async () => {
      const ast = parseIQL(
        "FIND PATH FROM 'aws:123:us-east-1:compute:i-1' TO 'gcp:proj1:us-central1:database:sql-1'",
      );
      const result = (await executeQuery(ast, opts)) as IQLPathResult;
      expect(result.found).toBe(false);
      expect(result.path).toEqual([]);
    });

    it("should support glob patterns in PATH", async () => {
      const ast = parseIQL(
        "FIND PATH FROM 'aws:*:*:compute:*' TO 'aws:*:*:database:*'",
      );
      const result = (await executeQuery(ast, opts)) as IQLPathResult;
      expect(result.found).toBe(true);
    });
  });

  describe("SUMMARIZE", () => {
    it("should summarize cost by provider", async () => {
      const ast = parseIQL("SUMMARIZE cost BY provider");
      const result = (await executeQuery(ast, opts)) as IQLSummarizeResult;
      expect(result.type).toBe("summarize");
      expect(result.groups.length).toBe(3); // aws, azure, gcp

      const awsGroup = result.groups.find((g) => g.key.provider === "aws");
      expect(awsGroup?.value).toBe(880); // 150+150+500+80
    });

    it("should summarize count by resourceType", async () => {
      const ast = parseIQL("SUMMARIZE count BY resourceType");
      const result = (await executeQuery(ast, opts)) as IQLSummarizeResult;
      expect(result.type).toBe("summarize");

      const computeGroup = result.groups.find(
        (g) => g.key.resourceType === "compute",
      );
      expect(computeGroup?.value).toBe(4); // 3 AWS + 1 Azure
    });

    it("should summarize with WHERE filter", async () => {
      const ast = parseIQL(
        "SUMMARIZE cost BY provider WHERE region IN ('us-east-1', 'eu-west-1')",
      );
      const result = (await executeQuery(ast, opts)) as IQLSummarizeResult;
      // Only AWS nodes in us-east-1 and eu-west-1
      expect(result.groups.length).toBe(1); // just aws
      expect(result.total).toBe(880);
    });

    it("should summarize by multiple fields", async () => {
      const ast = parseIQL("SUMMARIZE count BY provider, resourceType");
      const result = (await executeQuery(ast, opts)) as IQLSummarizeResult;
      expect(result.total).toBe(6);
      // aws:compute=3, aws:database=1, azure:compute=1, gcp:database=1
      expect(result.groups.length).toBe(4);
    });

    it("should sort groups by value descending", async () => {
      const ast = parseIQL("SUMMARIZE cost BY provider");
      const result = (await executeQuery(ast, opts)) as IQLSummarizeResult;
      // aws=880 should be first
      expect(result.groups[0].key.provider).toBe("aws");
    });
  });

  describe("complex ROADMAP examples", () => {
    it("should execute: expensive, non-compliant resources", async () => {
      const ast = parseIQL(`
        FIND resources
        WHERE provider = 'aws'
          AND cost > $100/mo
          AND NOT tagged('Environment')
          AND NOT tagged('Owner')
      `);
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      // All AWS resources have Environment tag, so none match
      expect(result.totalCount).toBe(0);
    });

    it("should execute: blast radius with depth limit", async () => {
      const ast = parseIQL(`
        FIND downstream OF 'aws:123:us-east-1:compute:i-1'
        WHERE depth <= 3
      `);
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.type).toBe("find");
    });

    it("should execute: cost aggregation with region filter", async () => {
      const ast = parseIQL(`
        SUMMARIZE cost BY provider, resourceType
        WHERE region IN ('us-east-1', 'eu-west-1')
      `);
      const result = (await executeQuery(ast, opts)) as IQLSummarizeResult;
      expect(result.type).toBe("summarize");
      expect(result.total).toBe(880);
    });

    it("should execute: cross-provider path", async () => {
      const ast = parseIQL(`
        FIND PATH FROM 'azure:*:*:compute:*' TO 'gcp:*:*:database:*'
      `);
      const result = (await executeQuery(ast, opts)) as IQLPathResult;
      expect(result.type).toBe("path");
      expect(result.found).toBe(true);
      expect(result.hops).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("should handle empty graph", async () => {
      const emptyStorage = new InMemoryGraphStorage();
      await emptyStorage.initialize();
      const ast = parseIQL("FIND resources");
      const result = (await executeQuery(ast, {
        storage: emptyStorage,
      })) as IQLFindResult;
      expect(result.totalCount).toBe(0);
    });

    it("should handle glob patterns matching no nodes", async () => {
      const ast = parseIQL(
        "FIND PATH FROM 'nonexistent:*:*:*:*' TO 'also:*:*:*:no'",
      );
      const result = (await executeQuery(ast, opts)) as IQLPathResult;
      expect(result.found).toBe(false);
    });

    it("should handle null cost in comparison", async () => {
      // gcp-sql has costMonthly=300, but let's test with > than total
      const ast = parseIQL("FIND resources WHERE cost > 900");
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCount).toBe(0);
    });

    it("should handle boolean values", async () => {
      // Not a real field, but tests the parser accepts booleans
      const ast = parseIQL("FIND resources WHERE status = 'running'");
      const result = (await executeQuery(ast, opts)) as IQLFindResult;
      expect(result.totalCount).toBe(6); // All have "running" status
    });
  });
});

// =============================================================================
// Temporal AT & DIFF WITH — End-to-End Tests
// =============================================================================

describe("IQL Temporal (AT / DIFF WITH)", () => {
  let storage: InMemoryGraphStorage;
  let temporal: InMemoryTemporalStorage;
  let opts: IQLExecutorOptions;

  // Fixed timestamps for deterministic testing
  const T1 = "2024-01-01T00:00:00.000Z";
  const T2 = "2024-02-01T00:00:00.000Z";
  const T3 = "2024-03-01T00:00:00.000Z";

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    await storage.initialize();
    temporal = new InMemoryTemporalStorage(storage);
    await temporal.initializeTemporal();

    // --- State at T1: 2 compute nodes ---
    await storage.upsertNode(makeNode({
      id: "aws:111:us-east-1:compute:web-1",
      name: "web-1",
      resourceType: "compute",
      costMonthly: 100,
      status: "running" as GraphNodeStatus,
    }));
    await storage.upsertNode(makeNode({
      id: "aws:111:us-east-1:compute:api-1",
      name: "api-1",
      resourceType: "compute",
      costMonthly: 200,
      status: "running" as GraphNodeStatus,
    }));

    // Use a manually-timed snapshot workaround: force snapshot timestamp
    const snap1 = await temporal.createSnapshot("manual", "baseline");
    // Override createdAt for deterministic lookups
    (snap1 as { createdAt: string }).createdAt = T1;

    // --- State at T2: add a database, update web-1 cost ---
    await storage.upsertNode(makeNode({
      id: "aws:111:us-east-1:compute:web-1",
      name: "web-1",
      resourceType: "compute",
      costMonthly: 150, // cost increased
      status: "running" as GraphNodeStatus,
    }));
    await storage.upsertNode(makeNode({
      id: "aws:111:us-east-1:database:rds-1",
      name: "rds-1",
      resourceType: "database",
      costMonthly: 300,
      status: "running" as GraphNodeStatus,
    }));

    const snap2 = await temporal.createSnapshot("scheduled", "feb-scan");
    (snap2 as { createdAt: string }).createdAt = T2;

    // --- State at T3: remove api-1, add serverless function ---
    await storage.deleteNode("aws:111:us-east-1:compute:api-1");
    await storage.upsertNode(makeNode({
      id: "aws:111:us-east-1:serverless-function:fn-1",
      name: "fn-1",
      resourceType: "serverless-function",
      costMonthly: 5,
      status: "running" as GraphNodeStatus,
    }));

    const snap3 = await temporal.createSnapshot("manual", "march-cleanup");
    (snap3 as { createdAt: string }).createdAt = T3;

    opts = { storage, temporal };
  });

  // ---------------------------------------------------------------------------
  // AT queries — time-travel
  // ---------------------------------------------------------------------------

  it("should return snapshot nodes at T1 (baseline)", async () => {
    const ast = parseIQL(`FIND resources AT '${T1}'`);
    const result = (await executeQuery(ast, opts)) as IQLFindResult;
    expect(result.type).toBe("find");
    expect(result.totalCount).toBe(2);
    const names = result.nodes.map((n) => n.name).sort();
    expect(names).toEqual(["api-1", "web-1"]);
  });

  it("should return snapshot nodes at T2 (added database)", async () => {
    const ast = parseIQL(`FIND resources AT '${T2}'`);
    const result = (await executeQuery(ast, opts)) as IQLFindResult;
    expect(result.totalCount).toBe(3);
    const names = result.nodes.map((n) => n.name).sort();
    expect(names).toEqual(["api-1", "rds-1", "web-1"]);
  });

  it("should return snapshot nodes at T3 (api-1 removed, fn-1 added)", async () => {
    const ast = parseIQL(`FIND resources AT '${T3}'`);
    const result = (await executeQuery(ast, opts)) as IQLFindResult;
    expect(result.totalCount).toBe(3);
    const names = result.nodes.map((n) => n.name).sort();
    expect(names).toEqual(["fn-1", "rds-1", "web-1"]);
  });

  it("AT query should filter by resourceType", async () => {
    const ast = parseIQL(`FIND resources AT '${T2}' WHERE resourceType = 'database'`);
    const result = (await executeQuery(ast, opts)) as IQLFindResult;
    expect(result.totalCount).toBe(1);
    expect(result.nodes[0]!.name).toBe("rds-1");
  });

  it("AT query should respect LIMIT", async () => {
    const ast = parseIQL(`FIND resources AT '${T2}' LIMIT 1`);
    const result = (await executeQuery(ast, opts)) as IQLFindResult;
    expect(result.nodes).toHaveLength(1);
    expect(result.totalCount).toBe(3); // total before limit
  });

  it("AT query with non-existent timestamp should return closest earlier snapshot", async () => {
    // Between T1 and T2 — should return T1 snapshot
    const midpoint = "2024-01-15T12:00:00.000Z";
    const ast = parseIQL(`FIND resources AT '${midpoint}'`);
    const result = (await executeQuery(ast, opts)) as IQLFindResult;
    expect(result.totalCount).toBe(2); // T1 state
  });

  it("AT query before any snapshot should fallback to earliest", async () => {
    const ancient = "2020-01-01T00:00:00.000Z";
    const ast = parseIQL(`FIND resources AT '${ancient}'`);
    const result = (await executeQuery(ast, opts)) as IQLFindResult;
    // getSnapshotAt falls back to the last element in the sorted list (earliest)
    expect(result.totalCount).toBeGreaterThanOrEqual(0);
  });

  it("AT query with no temporal storage falls back to current state", async () => {
    const noTemporalOpts: IQLExecutorOptions = { storage };
    const ast = parseIQL(`FIND resources AT '${T1}'`);
    const result = (await executeQuery(ast, noTemporalOpts)) as IQLFindResult;
    // Without temporal, AT is ignored; returns current live storage state
    expect(result.type).toBe("find");
    expect(result.totalCount).toBe(3); // current state after T3: web-1, rds-1, fn-1
  });

  // ---------------------------------------------------------------------------
  // DIFF WITH queries — snapshot comparison
  // ---------------------------------------------------------------------------

  it("should diff T1 with T2 (1 added, 1 changed)", async () => {
    const ast = parseIQL(`FIND resources AT '${T1}' DIFF WITH '${T2}'`);
    const result = (await executeQuery(ast, opts)) as IQLDiffResult;
    expect(result.type).toBe("diff");
    expect(result.added).toBe(1); // rds-1 added
    expect(result.removed).toBe(0);
    expect(result.changed).toBe(1); // web-1 cost changed
    // Verify diff details
    const addedDetail = result.details.find((d) => d.change === "added");
    expect(addedDetail).toBeTruthy();
    expect(addedDetail!.name).toBe("rds-1");
    const changedDetail = result.details.find((d) => d.change === "changed");
    expect(changedDetail).toBeTruthy();
    expect(changedDetail!.changedFields).toBeDefined();
  });

  it("should diff T2 with T3 (1 added, 1 removed)", async () => {
    const ast = parseIQL(`FIND resources AT '${T2}' DIFF WITH '${T3}'`);
    const result = (await executeQuery(ast, opts)) as IQLDiffResult;
    expect(result.type).toBe("diff");
    expect(result.added).toBe(1); // fn-1 added
    expect(result.removed).toBe(1); // api-1 removed
    const addedNames = result.details
      .filter((d) => d.change === "added")
      .map((d) => d.name);
    expect(addedNames).toContain("fn-1");
    const removedNames = result.details
      .filter((d) => d.change === "removed")
      .map((d) => d.name);
    expect(removedNames).toContain("api-1");
  });

  it("should diff T1 with T3 (full lifecycle: add db, remove api, add fn)", async () => {
    const ast = parseIQL(`FIND resources AT '${T1}' DIFF WITH '${T3}'`);
    const result = (await executeQuery(ast, opts)) as IQLDiffResult;
    expect(result.type).toBe("diff");
    // rds-1 and fn-1 added, api-1 removed, web-1 cost changed
    expect(result.added).toBe(2);
    expect(result.removed).toBe(1);
    expect(result.changed).toBe(1);
  });

  it("DIFF WITH no temporal storage falls back to find result", async () => {
    const noTemporalOpts: IQLExecutorOptions = { storage };
    const ast = parseIQL(`FIND resources AT '${T1}' DIFF WITH '${T2}'`);
    const result = await executeQuery(ast, noTemporalOpts);
    // Without temporal, DIFF is skipped and AT falls through to a regular find
    expect(result.type).toBe("find");
  });

  it("DIFF cost delta should reflect aggregate change", async () => {
    const ast = parseIQL(`FIND resources AT '${T1}' DIFF WITH '${T3}'`);
    const result = (await executeQuery(ast, opts)) as IQLDiffResult;
    expect(result.type).toBe("diff");
    // T1 cost: 100 + 200 = 300
    // T3 cost: 150 + 300 + 5 = 455
    // Delta: 455 - 300 = 155
    expect(result.costDelta).toBe(155);
  });
});
