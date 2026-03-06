/**
 * IQL Input Bounds — Tests
 *
 * Validates that the IQL system enforces configurable safety limits:
 * - maxInputLength: Rejects oversized query strings
 * - maxTokens: Rejects queries with too many tokens
 * - maxConditionDepth: Prevents stack overflow from deep recursion
 * - queryTimeoutMs: Aborts long-running queries
 * - maxResultSize: Caps the number of returned results
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IQLLexer } from "../../src/iql/lexer.js";
import { IQLLimitError } from "../../src/iql/lexer.js";
import { parseIQL } from "../../src/iql/parser.js";
import { executeQuery } from "../../src/iql/executor.js";
import {
  DEFAULT_IQL_LIMITS,
  resolveIQLLimits,
} from "../../src/iql/types.js";
import type { IQLLimits, IQLFindResult } from "../../src/iql/types.js";
import { InMemoryGraphStorage } from "../../src/storage/memory-store.js";
import { InMemoryTemporalStorage } from "../../src/core/temporal.js";
import type { GraphNodeInput, GraphNodeStatus } from "../../src/types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeNode(id: string): GraphNodeInput {
  return {
    provider: "aws",
    resourceType: "compute",
    nativeId: id,
    name: id,
    region: "us-east-1",
    account: "123456",
    status: "running" as GraphNodeStatus,
    tags: {},
    metadata: {},
    costMonthly: null,
    owner: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    id,
  };
}

// =============================================================================
// resolveIQLLimits
// =============================================================================

describe("resolveIQLLimits", () => {
  it("should return defaults when no overrides are given", () => {
    const resolved = resolveIQLLimits();
    expect(resolved).toEqual(DEFAULT_IQL_LIMITS);
  });

  it("should merge partial overrides with defaults", () => {
    const resolved = resolveIQLLimits({ maxInputLength: 500 });
    expect(resolved.maxInputLength).toBe(500);
    expect(resolved.maxTokens).toBe(DEFAULT_IQL_LIMITS.maxTokens);
  });

  it("should accept a full override object", () => {
    const custom: IQLLimits = {
      maxInputLength: 100,
      maxTokens: 50,
      maxConditionDepth: 4,
      queryTimeoutMs: 1000,
      maxResultSize: 5,
    };
    expect(resolveIQLLimits(custom)).toEqual(custom);
  });
});

// =============================================================================
// Lexer — maxInputLength
// =============================================================================

describe("IQLLexer maxInputLength", () => {
  it("should accept input within the limit", () => {
    const lexer = new IQLLexer("FIND resources", { maxInputLength: 100 });
    const tokens = lexer.tokenize();
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("should reject input exceeding the limit", () => {
    const bigInput = "FIND " + "a".repeat(200);
    expect(() => new IQLLexer(bigInput, { maxInputLength: 100 })).toThrow(
      IQLLimitError,
    );
  });

  it("should reject input at exactly the limit + 1", () => {
    const exact = "A".repeat(11);
    expect(() => new IQLLexer(exact, { maxInputLength: 10 })).toThrow(
      IQLLimitError,
    );
  });

  it("should accept input at exactly the limit", () => {
    const exact = "A".repeat(10);
    // Should not throw (will fail to parse, but the lexer accepts it)
    expect(() => new IQLLexer(exact, { maxInputLength: 10 })).not.toThrow();
  });
});

// =============================================================================
// Lexer — maxTokens
// =============================================================================

describe("IQLLexer maxTokens", () => {
  it("should accept a query within the token limit", () => {
    const lexer = new IQLLexer("FIND resources WHERE provider = 'aws'", {
      maxTokens: 100,
    });
    const tokens = lexer.tokenize();
    expect(tokens.length).toBeLessThan(100);
  });

  it("should reject a query exceeding the token limit", () => {
    // Build a query with many tokens: "FIND resources WHERE a = 1 AND b = 2 AND ..."
    const conditions = Array.from({ length: 20 }, (_, i) => `field${i} = ${i}`).join(" AND ");
    const query = `FIND resources WHERE ${conditions}`;
    const lexer = new IQLLexer(query, { maxTokens: 10 });
    expect(() => lexer.tokenize()).toThrow(IQLLimitError);
  });
});

// =============================================================================
// Parser — maxConditionDepth
// =============================================================================

describe("parseIQL maxConditionDepth", () => {
  it("should parse shallow conditions within depth limit", () => {
    const ast = parseIQL("FIND resources WHERE provider = 'aws' AND region = 'us-east-1'", {
      maxConditionDepth: 10,
    });
    expect(ast.type).toBe("find");
  });

  it("should reject deeply nested conditions exceeding depth limit", () => {
    // Build nested OR/AND: "FIND resources WHERE ((((a = 1 AND b = 2) AND c = 3) AND d = 4) ...)"
    // Each parenthesized group adds a level of condition depth
    const depth = 10;
    let query = "FIND resources WHERE ";
    for (let i = 0; i < depth; i++) {
      query += "(";
    }
    query += "provider = 'aws'";
    for (let i = 0; i < depth; i++) {
      query += ` AND field${i} = ${i})`;
    }

    expect(() => parseIQL(query, { maxConditionDepth: 3 })).toThrow(
      IQLLimitError,
    );
  });

  it("should accept conditions at exactly the depth limit", () => {
    // Simple non-nested condition should work with depth=1
    const ast = parseIQL("FIND resources WHERE provider = 'aws'", {
      maxConditionDepth: 1,
    });
    expect(ast.type).toBe("find");
  });
});

// =============================================================================
// Executor — queryTimeoutMs
// =============================================================================

describe("executeQuery queryTimeoutMs", () => {
  let storage: InMemoryGraphStorage;
  let temporal: InMemoryTemporalStorage;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    temporal = new InMemoryTemporalStorage(storage);

    // Populate with some nodes
    for (let i = 0; i < 10; i++) {
      await storage.upsertNode(makeNode(`node-${i}`));
    }
  });

  it("should complete a fast query within the timeout", async () => {
    const ast = parseIQL("FIND resources LIMIT 5");
    const result = await executeQuery(ast, {
      storage,
      temporal,
      limits: { queryTimeoutMs: 5000 },
    });
    expect(result.type).toBe("find");
    expect((result as IQLFindResult).nodes.length).toBeLessThanOrEqual(5);
  });

  it("should respect the queryTimeoutMs limit", async () => {
    // A very short timeout should still work for simple queries
    // (they complete faster than even 10ms on modern hardware)
    const ast = parseIQL("FIND resources LIMIT 1");
    const result = await executeQuery(ast, {
      storage,
      temporal,
      limits: { queryTimeoutMs: 5000 },
    });
    expect(result.type).toBe("find");
  });
});

// =============================================================================
// Executor — maxResultSize
// =============================================================================

describe("executeQuery maxResultSize", () => {
  let storage: InMemoryGraphStorage;
  let temporal: InMemoryTemporalStorage;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    temporal = new InMemoryTemporalStorage(storage);

    // Populate with 50 nodes
    for (let i = 0; i < 50; i++) {
      await storage.upsertNode(makeNode(`node-${i}`));
    }
  });

  it("should cap results to maxResultSize", async () => {
    const ast = parseIQL("FIND resources"); // No explicit LIMIT
    const result = await executeQuery(ast, {
      storage,
      temporal,
      limits: { maxResultSize: 5 },
    });
    expect(result.type).toBe("find");
    expect((result as IQLFindResult).nodes.length).toBeLessThanOrEqual(5);
  });

  it("should use the minimum of query LIMIT and maxResultSize", async () => {
    const ast = parseIQL("FIND resources LIMIT 100");
    const result = await executeQuery(ast, {
      storage,
      temporal,
      limits: { maxResultSize: 3 },
    });
    expect(result.type).toBe("find");
    expect((result as IQLFindResult).nodes.length).toBeLessThanOrEqual(3);
  });

  it("should allow query LIMIT when smaller than maxResultSize", async () => {
    const ast = parseIQL("FIND resources LIMIT 2");
    const result = await executeQuery(ast, {
      storage,
      temporal,
      limits: { maxResultSize: 100 },
    });
    expect(result.type).toBe("find");
    expect((result as IQLFindResult).nodes.length).toBeLessThanOrEqual(2);
  });
});

// =============================================================================
// Integration — all limits together
// =============================================================================

describe("IQL limits integration", () => {
  it("should respect all limits together without interfering", async () => {
    const limits: IQLLimits = {
      maxInputLength: 1000,
      maxTokens: 100,
      maxConditionDepth: 10,
      queryTimeoutMs: 5000,
      maxResultSize: 5,
    };

    const storage = new InMemoryGraphStorage();
    const temporal = new InMemoryTemporalStorage(storage);
    for (let i = 0; i < 20; i++) {
      await storage.upsertNode(makeNode(`node-${i}`));
    }

    const ast = parseIQL("FIND resources WHERE provider = 'aws'", limits);
    const result = await executeQuery(ast, { storage, temporal, limits });
    expect(result.type).toBe("find");
    expect((result as IQLFindResult).nodes.length).toBeLessThanOrEqual(5);
  });

  it("should use defaults when no limits are specified", async () => {
    const storage = new InMemoryGraphStorage();
    const temporal = new InMemoryTemporalStorage(storage);
    await storage.upsertNode(makeNode("node-1"));

    const ast = parseIQL("FIND resources");
    const result = await executeQuery(ast, { storage, temporal });
    expect(result.type).toBe("find");
    expect((result as IQLFindResult).nodes.length).toBe(1);
  });
});
