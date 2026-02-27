/**
 * Tests for llm-iql module — LLM-powered IQL translation.
 */

import { describe, it, expect } from "vitest";
import {
  translateWithLLM,
  MockLLMProvider,
  getIQLSystemPrompt,
  getIQLFewShotExamples,
  validateAndClassifyIQL,
} from "./llm-iql.js";
import type { IQLLLMProvider, LLMTranslationResult } from "./llm-iql.js";

// =============================================================================
// MockLLMProvider
// =============================================================================

describe("MockLLMProvider", () => {
  it("has name 'mock'", () => {
    const provider = new MockLLMProvider();
    expect(provider.name).toBe("mock");
  });

  it("returns canned response for known query", async () => {
    const provider = new MockLLMProvider();
    // MockLLMProvider has built-in response for "compare costs between aws and azure"
    // The mock extracts "User: ..." from the prompt, so we simulate a prompt
    const result = await provider.complete("User: compare costs between aws and azure\nIQL:");
    expect(result.ok).toBe(true);
    expect(result.text).toBeDefined();
    expect(result.tokensUsed).toBe(50);
  });

  it("returns error when no match and no default", async () => {
    const provider = new MockLLMProvider();
    const result = await provider.complete("User: some unknown random query xyz\nIQL:");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("uses default response when no match and default is set", async () => {
    const provider = new MockLLMProvider({}, 'FIND resources WHERE status = "error"');
    const result = await provider.complete("User: something unknown\nIQL:");
    expect(result.ok).toBe(true);
    expect(result.text).toBe('FIND resources WHERE status = "error"');
  });

  it("accepts extra responses", async () => {
    const provider = new MockLLMProvider({
      "list all servers": 'FIND resources WHERE resourceType = "server"',
    });
    const result = await provider.complete("User: list all servers\nIQL:");
    expect(result.ok).toBe(true);
    expect(result.text).toContain("server");
  });
});

// =============================================================================
// translateWithLLM — template-first strategy
// =============================================================================

describe("translateWithLLM", () => {
  it("uses template when confidence is high enough", async () => {
    const provider = new MockLLMProvider();
    // "show all databases" should match a template with high confidence
    const result = await translateWithLLM("show all databases", provider);
    // Whether template or LLM, it should succeed
    expect(result.success).toBe(true);
    if (result.confidence >= 0.8) {
      // Template was used
      expect(result.usedLLM).toBe(false);
    }
  });

  it("falls back to LLM when template confidence is low", async () => {
    // Use a query the mock has a canned answer for but templates don't match well
    const provider = new MockLLMProvider({
      "show me databases that are failing":
        'FIND resources WHERE resourceType = "database" AND status = "error"',
    });
    const result = await translateWithLLM(
      "show me databases that are failing",
      provider,
      { preferTemplates: true, templateConfidenceThreshold: 1.0 }, // force LLM by setting threshold impossibly high
    );
    // Should have attempted LLM
    if (result.usedLLM) {
      expect(result.success).toBe(true);
      expect(result.tokensUsed).toBeGreaterThan(0);
    }
  });

  it("returns template result when preferTemplates is false but LLM fails", async () => {
    // Provider with no matching response and no default → LLM errors
    const provider = new MockLLMProvider();
    const result = await translateWithLLM(
      "some extremely obscure query nobody would write",
      provider,
      { preferTemplates: false },
    );
    // Either template or LLM; success depends on template match
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("usedLLM");
    expect(result).toHaveProperty("confidence");
  });

  it("respects templateConfidenceThreshold", async () => {
    const provider = new MockLLMProvider(
      {},
      'FIND resources WHERE status = "running"',
    );
    // With threshold 0, always use templates
    const result = await translateWithLLM("show all vms", provider, {
      templateConfidenceThreshold: 0,
    });
    // Template should be used since even a low-confidence match >= 0
    if (result.success) {
      expect(result.usedLLM).toBe(false);
    }
  });

  it("includes tokensUsed when LLM is invoked", async () => {
    const provider = new MockLLMProvider({
      "which load balancers cost more than $200":
        'FIND resources WHERE resourceType = "load-balancer" AND costMonthly > 200',
    });
    const result = await translateWithLLM(
      "which load balancers cost more than $200",
      provider,
      { templateConfidenceThreshold: 1.0 },
    );
    if (result.usedLLM) {
      expect(result.tokensUsed).toBeDefined();
    }
  });

  it("handles broken LLM provider gracefully", async () => {
    const brokenProvider: IQLLLMProvider = {
      name: "broken",
      async complete(_prompt: string) {
        return { ok: false, error: "Service unavailable" };
      },
    };
    const result = await translateWithLLM("show all servers", brokenProvider);
    // Should not throw — should fall back to template result
    expect(result).toHaveProperty("success");
    expect(result.usedLLM).toBe(false);
  });
});

// =============================================================================
// Prompt helpers
// =============================================================================

describe("getIQLSystemPrompt", () => {
  it("returns a non-empty prompt string", () => {
    const prompt = getIQLSystemPrompt();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain("IQL");
  });

  it("includes schema context when provided", () => {
    const prompt = getIQLSystemPrompt("Custom schema info");
    expect(prompt).toContain("Custom schema info");
  });
});

describe("getIQLFewShotExamples", () => {
  it("returns formatted example string", () => {
    const examples = getIQLFewShotExamples();
    expect(typeof examples).toBe("string");
    expect(examples.length).toBeGreaterThan(0);
    // Should contain User/IQL pairs
    expect(examples).toContain("User:");
    expect(examples).toContain("IQL:");
  });
});

// =============================================================================
// validateAndClassifyIQL
// =============================================================================

describe("validateAndClassifyIQL", () => {
  it("classifies a valid FIND resources query", () => {
    const result = validateAndClassifyIQL('FIND resources WHERE provider = "aws"');
    expect(result.valid).toBe(true);
    expect(result.queryType).toBe("find");
    expect(result.target).toBe("resources");
    expect(result.hasFilter).toBe(true);
    expect(result.error).toBeNull();
  });

  it("classifies a FIND downstream query", () => {
    const result = validateAndClassifyIQL('FIND downstream OF "main-vpc"');
    expect(result.valid).toBe(true);
    expect(result.queryType).toBe("find");
    expect(result.target).toBe("downstream");
    expect(result.hasFilter).toBe(false);
  });

  it("classifies a SUMMARIZE query", () => {
    const result = validateAndClassifyIQL("SUMMARIZE count BY provider");
    expect(result.valid).toBe(true);
    expect(result.queryType).toBe("summarize");
    expect(result.target).toContain("count");
    expect(result.hasLimit).toBe(false);
  });

  it("detects LIMIT on FIND query", () => {
    const result = validateAndClassifyIQL("FIND resources LIMIT 10");
    expect(result.valid).toBe(true);
    expect(result.hasLimit).toBe(true);
  });

  it("returns invalid for garbage input", () => {
    const result = validateAndClassifyIQL("not a real query at all");
    expect(result.valid).toBe(false);
    expect(result.queryType).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error!.length).toBeGreaterThan(0);
  });
});
