/**
 * Infrastructure Knowledge Graph — LLM-Powered IQL Translation
 *
 * Extends the template-based NL→IQL translator with an LLM provider
 * interface for translating arbitrary natural language infrastructure
 * queries into IQL. Uses existing templates as few-shot examples and
 * falls back to template matching when the LLM is unavailable.
 *
 * Supports:
 *   - Pluggable LLM provider interface
 *   - Few-shot prompt construction from existing examples
 *   - IQL validation on LLM output
 *   - Confidence scoring with template vs LLM attribution
 *   - Graceful degradation to template-based translation
 */

import { parseIQL } from "../iql/index.js";
import type { IQLQuery } from "../iql/index.js";
import {
  translateNLToIQL,
  getExampleQueries,
  getAvailableResourceTypes,
  getAvailableProviders,
} from "./nl-translator.js";
import type { NLTranslationResult } from "./nl-translator.js";

// =============================================================================
// Types
// =============================================================================

/** LLM provider interface for IQL translation. */
export interface IQLLLMProvider {
  /** Provider name (e.g., "openai", "anthropic", "ollama"). */
  readonly name: string;

  /**
   * Send a prompt and receive a text completion.
   * Must never throw; errors return { ok: false, error }.
   */
  complete(prompt: string): Promise<LLMCompletionResult>;
}

/** Result from an LLM completion. */
export type LLMCompletionResult = {
  ok: boolean;
  text?: string;
  error?: string;
  /** Token usage (if available). */
  tokensUsed?: number;
};

/** Enhanced translation result with LLM attribution. */
export type LLMTranslationResult = NLTranslationResult & {
  /** Whether the LLM was used. */
  usedLLM: boolean;
  /** Token usage (if LLM was used). */
  tokensUsed?: number;
  /** Raw LLM response (for debugging). */
  rawLLMResponse?: string;
};

/** Options for LLM-powered translation. */
export type LLMTranslationOptions = {
  /** Prefer template matching over LLM (default: true). */
  preferTemplates?: boolean;
  /** Minimum template confidence to skip LLM (default: 0.8). */
  templateConfidenceThreshold?: number;
  /** Whether to validate generated IQL (default: true). */
  validateIQL?: boolean;
  /** Maximum retries for LLM parsing failures (default: 1). */
  maxRetries?: number;
  /** Additional schema context to include in the prompt. */
  schemaContext?: string;
};

// =============================================================================
// System Prompt
// =============================================================================

function buildSystemPrompt(schemaContext?: string): string {
  const resourceTypes = getAvailableResourceTypes().join(", ");
  const providers = getAvailableProviders().join(", ");

  return `You are an IQL (Infrastructure Query Language) translator. Convert natural language queries about cloud infrastructure into IQL queries.

## IQL Syntax

IQL supports these query forms:

1. **FIND resources** — find infrastructure resources with optional filters
   \`FIND resources WHERE <conditions> [LIMIT <n>]\`

2. **FIND downstream/upstream** — find dependency chains
   \`FIND downstream OF "<resource-name>"\`
   \`FIND upstream OF "<resource-name>"\`

3. **FIND PATH** — find connection path between resources
   \`FIND PATH FROM "<source>" TO "<target>"\`

4. **SUMMARIZE** — aggregate data
   \`SUMMARIZE <aggregation> BY <dimension> [WHERE <conditions>]\`
   Aggregations: count, sum(costMonthly)
   Dimensions: resourceType, provider, region, status

## Filter Conditions

WHERE clause supports:
- \`field = "value"\` — equality
- \`field != "value"\` — inequality  
- \`field > number\` — greater than
- \`field < number\` — less than
- \`field AND field\` — conjunction
- \`NOT condition\` — negation
- \`tagged("tagName")\` — tag existence check
- \`tags.TagName = "value"\` — tag value check

## Available Resource Types
${resourceTypes}

## Available Providers
${providers}

## Common Fields
- resourceType — the type of infrastructure resource
- provider — cloud provider (aws, azure, gcp, kubernetes)
- status — resource status (running, stopped, pending, error, etc.)
- costMonthly — monthly cost in USD
- region — deployment region
- tags.* — resource tags (e.g., tags.Environment, tags.Owner)

${schemaContext ? `## Additional Schema Context\n${schemaContext}\n` : ""}
## IMPORTANT RULES
1. Output ONLY the IQL query, no explanation
2. Use double quotes for string values
3. Field names are camelCase
4. Resource type values must be lowercase with hyphens`;
}

function buildFewShotExamples(): string {
  const examples = getExampleQueries();
  const lines = examples.map(
    (e) => `User: ${e.natural}\nIQL: ${e.iql}`,
  );
  return lines.join("\n\n");
}

function buildPrompt(userQuery: string, schemaContext?: string): string {
  return `${buildSystemPrompt(schemaContext)}

## Examples

${buildFewShotExamples()}

## Your Task

User: ${userQuery}
IQL:`;
}

// =============================================================================
// IQL Extraction
// =============================================================================

/**
 * Extract an IQL query from the LLM's raw text response.
 * Handles cases where the LLM adds explanation text around the query.
 */
function extractIQLFromResponse(text: string): string | null {
  const trimmed = text.trim();

  // If the whole response parses as IQL, use it directly
  try {
    parseIQL(trimmed);
    return trimmed;
  } catch {
    // Not direct IQL, try extraction
  }

  // Try to find IQL in code blocks
  const codeBlockMatch = trimmed.match(/```(?:iql|sql)?\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    const candidate = codeBlockMatch[1]!.trim();
    try {
      parseIQL(candidate);
      return candidate;
    } catch {
      // Not valid IQL
    }
  }

  // Try to find a line that starts with FIND or SUMMARIZE
  const lines = trimmed.split("\n");
  for (const line of lines) {
    const candidate = line.trim();
    if (/^(?:FIND|SUMMARIZE)\b/i.test(candidate)) {
      try {
        parseIQL(candidate);
        return candidate;
      } catch {
        // Not valid IQL
      }
    }
  }

  // Last resort: trim common conversational prefixes
  const prefixes = [
    /^(?:Here(?:'s| is) (?:the|your) (?:IQL )?query:?\s*)/i,
    /^(?:The IQL (?:query|translation) (?:is|would be):?\s*)/i,
    /^(?:IQL:?\s*)/i,
  ];
  for (const prefix of prefixes) {
    const stripped = trimmed.replace(prefix, "").trim();
    if (stripped !== trimmed) {
      try {
        parseIQL(stripped);
        return stripped;
      } catch {
        // Not valid IQL
      }
    }
  }

  return null;
}

// =============================================================================
// Main Translation Engine
// =============================================================================

/**
 * Translate a natural language query to IQL using LLM with template fallback.
 *
 * Strategy:
 * 1. If `preferTemplates` is true (default), try template matching first.
 * 2. If the template match has high enough confidence, return it.
 * 3. Otherwise, use the LLM for translation.
 * 4. Validate the LLM output and retry once if invalid.
 * 5. If LLM fails, fall back to template result (even if low confidence).
 */
export async function translateWithLLM(
  input: string,
  llmProvider: IQLLLMProvider,
  options: LLMTranslationOptions = {},
): Promise<LLMTranslationResult> {
  const {
    preferTemplates = true,
    templateConfidenceThreshold = 0.8,
    validateIQL = true,
    maxRetries = 1,
    schemaContext,
  } = options;

  // Step 1: Try template-based translation
  const templateResult = translateNLToIQL(input);

  if (
    preferTemplates &&
    templateResult.success &&
    templateResult.confidence >= templateConfidenceThreshold
  ) {
    return {
      ...templateResult,
      usedLLM: false,
    };
  }

  // Step 2: Use LLM
  const prompt = buildPrompt(input, schemaContext);
  let totalTokens = 0;
  let lastRawResponse: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const retryPrompt = attempt === 0
      ? prompt
      : `${prompt}\n\n(Previous attempt was not valid IQL. Please output ONLY a valid IQL query.)`;

    const result = await llmProvider.complete(retryPrompt);
    if (result.tokensUsed) totalTokens += result.tokensUsed;

    if (!result.ok || !result.text) {
      // LLM failed — fall back to template
      return {
        ...templateResult,
        usedLLM: false,
        explanation: templateResult.success
          ? templateResult.explanation
          : `LLM failed (${result.error ?? "unknown error"}), template match also failed`,
      };
    }

    lastRawResponse = result.text;
    const extracted = extractIQLFromResponse(result.text);

    if (extracted) {
      if (validateIQL) {
        try {
          const ast: IQLQuery = parseIQL(extracted);
          return {
            success: true,
            iql: extracted,
            ast,
            matchedTemplate: null,
            confidence: 0.7, // LLM translations get base 0.7 confidence
            explanation: `LLM translated "${input}" → ${extracted}`,
            usedLLM: true,
            tokensUsed: totalTokens,
            rawLLMResponse: lastRawResponse,
          };
        } catch {
          // Invalid IQL — retry
          continue;
        }
      } else {
        return {
          success: true,
          iql: extracted,
          ast: null,
          matchedTemplate: null,
          confidence: 0.6, // Unvalidated = lower confidence
          explanation: `LLM translated (unvalidated) "${input}" → ${extracted}`,
          usedLLM: true,
          tokensUsed: totalTokens,
          rawLLMResponse: lastRawResponse,
        };
      }
    }
  }

  // All retries exhausted — fall back to template result
  if (templateResult.success) {
    return {
      ...templateResult,
      usedLLM: false,
      tokensUsed: totalTokens,
      rawLLMResponse: lastRawResponse,
      explanation: `LLM output was not valid IQL; fell back to template: ${templateResult.explanation}`,
    };
  }

  return {
    success: false,
    iql: null,
    ast: null,
    matchedTemplate: null,
    confidence: 0,
    explanation: `LLM output was not valid IQL and no template matched: "${input}"`,
    suggestions: templateResult.suggestions,
    usedLLM: true,
    tokensUsed: totalTokens,
    rawLLMResponse: lastRawResponse,
  };
}

// =============================================================================
// Mock LLM Provider (for testing)
// =============================================================================

/** Canned responses for common queries (testing only). */
const MOCK_RESPONSES: Record<string, string> = {
  "show me databases that are failing":
    'FIND resources WHERE resourceType = "database" AND status = "error"',
  "which load balancers cost more than $200":
    'FIND resources WHERE resourceType = "load-balancer" AND costMonthly > 200',
  "find all unencrypted storage buckets":
    'FIND resources WHERE resourceType = "storage" AND NOT tagged("encryption")',
  "what resources would be affected if the main vpc goes down":
    'FIND downstream OF "main-vpc"',
  "compare costs between aws and azure":
    "SUMMARIZE sum(costMonthly) BY provider",
};

/**
 * A mock LLM provider that returns canned responses.
 * Useful for testing the LLM translation pipeline.
 */
export class MockLLMProvider implements IQLLLMProvider {
  readonly name = "mock";

  private responses: Map<string, string>;
  private defaultResponse: string | null;

  constructor(
    extraResponses: Record<string, string> = {},
    defaultResponse: string | null = null,
  ) {
    this.responses = new Map([
      ...Object.entries(MOCK_RESPONSES),
      ...Object.entries(extraResponses),
    ]);
    this.defaultResponse = defaultResponse;
  }

  async complete(prompt: string): Promise<LLMCompletionResult> {
    // Extract user query from the prompt
    const userMatch = prompt.match(/User: (.+?)$/m);
    const userQuery = userMatch ? userMatch[1]!.trim().toLowerCase() : "";

    // Try exact match
    for (const [query, response] of this.responses) {
      if (userQuery === query.toLowerCase()) {
        return { ok: true, text: response, tokensUsed: 50 };
      }
    }

    // Try partial match
    for (const [query, response] of this.responses) {
      if (userQuery.includes(query.toLowerCase()) || query.toLowerCase().includes(userQuery)) {
        return { ok: true, text: response, tokensUsed: 50 };
      }
    }

    // Default response or error
    if (this.defaultResponse) {
      return { ok: true, text: this.defaultResponse, tokensUsed: 50 };
    }

    return { ok: false, error: "No matching mock response" };
  }
}

/**
 * Validate an IQL string and classify the query type.
 *
 * Returns structured metadata extracted from the parsed AST — useful
 * for post-processing or logging LLM-generated queries.
 */
export function validateAndClassifyIQL(iqlString: string): {
  valid: boolean;
  queryType: "find" | "summarize" | null;
  target: string | null;
  hasFilter: boolean;
  hasLimit: boolean;
  error: string | null;
} {
  try {
    const ast: IQLQuery = parseIQL(iqlString);
    if (ast.type === "find") {
      return {
        valid: true,
        queryType: "find",
        target: ast.target.kind,
        hasFilter: ast.where !== null,
        hasLimit: ast.limit !== null,
        error: null,
      };
    }
    // summarize
    return {
      valid: true,
      queryType: "summarize",
      target: `${ast.metric.fn}(${"field" in ast.metric ? ast.metric.field : "*"})`,
      hasFilter: ast.where !== null,
      hasLimit: false,
      error: null,
    };
  } catch (err) {
    return {
      valid: false,
      queryType: null,
      target: null,
      hasFilter: false,
      hasLimit: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Get the system prompt for external LLM integration.
 * Useful for constructing prompts outside this module.
 */
export function getIQLSystemPrompt(schemaContext?: string): string {
  return buildSystemPrompt(schemaContext);
}

/**
 * Get the few-shot examples as a formatted string.
 */
export function getIQLFewShotExamples(): string {
  return buildFewShotExamples();
}
