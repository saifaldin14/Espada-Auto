/**
 * Tests for the natural language → IQL translator (P2.20).
 */

import { describe, it, expect } from "vitest";
import {
  translateNLToIQL,
  getAvailableResourceTypes,
  getAvailableProviders,
  getExampleQueries,
} from "./nl-translator.js";

// =============================================================================
// Tests
// =============================================================================

describe("NL→IQL Translator (P2.20)", () => {
  describe("translateNLToIQL", () => {
    it("translates 'show me all databases'", () => {
      const result = translateNLToIQL("show me all databases");
      expect(result.success).toBe(true);
      expect(result.iql).toContain('resourceType = "database"');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.matchedTemplate).toBeDefined();
    });

    it("translates 'list running servers on AWS'", () => {
      const result = translateNLToIQL("list running servers on AWS");
      expect(result.success).toBe(true);
      expect(result.iql).toContain('resourceType = "compute"');
      expect(result.iql).toContain('provider = "aws"');
      expect(result.iql).toContain('status = "running"');
    });

    it("translates 'how many instances are running'", () => {
      const result = translateNLToIQL("how many instances are running");
      expect(result.success).toBe(true);
      expect(result.iql).toContain("SUMMARIZE");
      expect(result.iql).toContain('resourceType = "compute"');
    });

    it("translates 'what depends on my-vpc'", () => {
      const result = translateNLToIQL('what depends on my-vpc');
      expect(result.success).toBe(true);
      expect(result.iql).toContain("FIND downstream");
      expect(result.iql).toContain("my-vpc");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("translates 'upstream of web-server'", () => {
      const result = translateNLToIQL("upstream of web-server");
      expect(result.success).toBe(true);
      expect(result.iql).toContain("FIND upstream");
      expect(result.iql).toContain("web-server");
    });

    it("translates 'how much do we spend'", () => {
      const result = translateNLToIQL("how much do we spend");
      expect(result.success).toBe(true);
      expect(result.iql).toContain("SUMMARIZE");
      expect(result.iql).toContain("costMonthly");
    });

    it("translates 'most expensive resources'", () => {
      const result = translateNLToIQL("most expensive resources");
      expect(result.success).toBe(true);
      expect(result.iql).toContain("costMonthly > 0");
      expect(result.iql).toContain("LIMIT");
    });

    it("translates 'untagged databases'", () => {
      const result = translateNLToIQL("untagged databases");
      expect(result.success).toBe(true);
      expect(result.iql).toContain("NOT tagged");
      expect(result.iql).toContain('resourceType = "database"');
    });

    it("translates 'path from web-server to database'", () => {
      const result = translateNLToIQL("path from web-server to database");
      expect(result.success).toBe(true);
      expect(result.iql).toContain("FIND PATH FROM");
    });

    it("translates queries with environment filters", () => {
      const result = translateNLToIQL("show me all databases in production");
      expect(result.success).toBe(true);
      expect(result.iql).toContain("production");
    });

    it("translates queries with region filters", () => {
      const result = translateNLToIQL("show me all servers in us-east-1");
      expect(result.success).toBe(true);
      expect(result.iql).toContain("us-east-1");
    });

    it("returns parsed AST on success", () => {
      const result = translateNLToIQL("show me all databases");
      expect(result.success).toBe(true);
      expect(result.ast).not.toBeNull();
    });

    it("returns failure with suggestions for unrecognized queries", () => {
      const result = translateNLToIQL("tell me a joke");
      expect(result.success).toBe(false);
      expect(result.iql).toBeNull();
      expect(result.ast).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
    });

    it("handles cost breakdown queries", () => {
      const result = translateNLToIQL("cost by region");
      expect(result.success).toBe(true);
      expect(result.iql).toContain("SUMMARIZE");
      expect(result.iql).toContain("BY region");
    });

    it("handles blast radius queries", () => {
      const result = translateNLToIQL("blast radius of my-database");
      expect(result.success).toBe(true);
      expect(result.iql).toContain("FIND downstream");
      expect(result.iql).toContain("my-database");
    });
  });

  describe("getAvailableResourceTypes", () => {
    it("returns sorted list of resource types", () => {
      const types = getAvailableResourceTypes();
      expect(types.length).toBeGreaterThan(0);
      expect(types).toContain("compute");
      expect(types).toContain("database");
      expect(types).toContain("storage");
      // Should be sorted
      const sorted = [...types].sort();
      expect(types).toEqual(sorted);
    });
  });

  describe("getAvailableProviders", () => {
    it("returns sorted list of providers", () => {
      const providers = getAvailableProviders();
      expect(providers.length).toBeGreaterThan(0);
      expect(providers).toContain("aws");
      expect(providers).toContain("azure");
      expect(providers).toContain("gcp");
    });
  });

  describe("getExampleQueries", () => {
    it("returns examples with natural and iql properties", () => {
      const examples = getExampleQueries();
      expect(examples.length).toBeGreaterThan(0);
      for (const ex of examples) {
        expect(ex.natural).toBeDefined();
        expect(ex.iql).toBeDefined();
        expect(typeof ex.natural).toBe("string");
        expect(typeof ex.iql).toBe("string");
      }
    });

    it("returns valid IQL in examples", () => {
      const examples = getExampleQueries();
      for (const ex of examples) {
        expect(ex.iql).toMatch(/^(FIND|SUMMARIZE)/);
      }
    });
  });

  describe("edge cases", () => {
    it("returns failure with suggestions for empty input", () => {
      const result = translateNLToIQL("");
      expect(result.success).toBe(false);
      expect(result.iql).toBeNull();
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
    });

    it("returns failure for whitespace-only input", () => {
      const result = translateNLToIQL("   \t\n  ");
      expect(result.success).toBe(false);
      expect(result.iql).toBeNull();
    });

    it("handles case-insensitive input", () => {
      const result = translateNLToIQL("SHOW ME ALL DATABASES");
      expect(result.success).toBe(true);
      expect(result.iql).toContain('resourceType = "database"');
    });

    it("handles input with trailing punctuation", () => {
      // "show me all databases" works; appending ? should too
      const result = translateNLToIQL("show me all databases?");
      expect(result.success).toBe(true);
    });
  });
});
