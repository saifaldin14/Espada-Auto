/**
 * Advisor — Interactive Parameter Prompter
 *
 * Identifies missing required parameters from a blueprint match and generates
 * structured follow-up questions that an AI agent or CLI can use to collect
 * the remaining inputs before deployment.
 */

import { getBlueprint } from "../orchestration/index.js";
import type { BlueprintParameter } from "../orchestration/types.js";
import type { BlueprintMatch, DeployRecommendation } from "./types.js";

// =============================================================================
// Types
// =============================================================================

/** A single follow-up question for a missing parameter. */
export type ParameterQuestion = {
  /** The parameter name (matches BlueprintParameter.name). */
  param: string;
  /** Human-readable prompt text. */
  question: string;
  /** Expected input type. */
  type: "string" | "number" | "boolean";
  /** Whether this parameter is required. */
  required: boolean;
  /** Default value (if any). */
  default?: unknown;
  /** Suggested choices (if applicable). */
  choices?: unknown[];
  /** Additional hint for AI agents. */
  hint?: string;
  /** The parameter's origin description from the blueprint definition. */
  description: string;
};

/** Result of a prompting session — collected answers. */
export type PromptAnswers = Record<string, unknown>;

/** Outcome of analyzing a recommendation for missing params. */
export type PromptSession = {
  /** The blueprint that was matched. */
  blueprintId: string;
  /** Blueprint display name. */
  blueprintName: string;
  /** Parameters already inferred by the advisor. */
  inferredParams: Record<string, unknown>;
  /** Questions for missing parameters. */
  questions: ParameterQuestion[];
  /** True if all required params are satisfied (no questions needed). */
  ready: boolean;
  /** Summary message for display. */
  message: string;
};

/** Result after applying answers to a prompt session. */
export type ResolvedParams = {
  /** The complete parameter set (inferred + answered + defaults). */
  params: Record<string, unknown>;
  /** Any still-missing required params (should be empty if valid). */
  stillMissing: string[];
  /** Whether the params are complete enough to generate a plan. */
  valid: boolean;
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Analyze a deploy recommendation and generate interactive questions
 * for any missing required parameters.
 *
 * Call this after `recommend()` or `recommendAndPlan()` to determine
 * whether the user needs to provide additional inputs.
 */
export function createPromptSession(recommendation: DeployRecommendation): PromptSession | null {
  const match = recommendation.blueprint;
  if (!match) {
    return null;
  }

  return createPromptSessionForBlueprint(match);
}

/**
 * Create a prompt session directly from a blueprint match.
 */
export function createPromptSessionForBlueprint(match: BlueprintMatch): PromptSession | null {
  const bp = getBlueprint(match.blueprintId);
  if (!bp) return null;

  const questions = generateQuestions(bp.parameters, match.inferredParams);
  const requiredQuestions = questions.filter((q) => q.required);
  const ready = requiredQuestions.length === 0;

  const message = ready
    ? `All required parameters for "${match.name}" are satisfied. Ready to deploy.`
    : `Blueprint "${match.name}" needs ${requiredQuestions.length} required parameter${requiredQuestions.length === 1 ? "" : "s"}: ${requiredQuestions.map((q) => q.param).join(", ")}`;

  return {
    blueprintId: match.blueprintId,
    blueprintName: match.name,
    inferredParams: { ...match.inferredParams },
    questions,
    ready,
    message,
  };
}

/**
 * Apply user answers to a prompt session and determine if params are complete.
 *
 * Returns the merged parameter set (inferred + defaults + user answers)
 * and any still-missing required fields.
 */
export function resolveParams(session: PromptSession, answers: PromptAnswers): ResolvedParams {
  const bp = getBlueprint(session.blueprintId);
  if (!bp) {
    return { params: { ...session.inferredParams, ...answers }, stillMissing: [], valid: false };
  }

  // Merge: inferred → defaults → user answers (answers take priority)
  const params: Record<string, unknown> = { ...session.inferredParams };

  // Fill defaults
  for (const p of bp.parameters) {
    if (!(p.name in params) && p.default !== undefined) {
      params[p.name] = p.default;
    }
  }

  // Apply user answers (with type coercion)
  for (const [key, value] of Object.entries(answers)) {
    const paramDef = bp.parameters.find((p) => p.name === key);
    if (paramDef) {
      params[key] = coerceValue(value, paramDef.type);
    } else {
      params[key] = value;
    }
  }

  // Check for still-missing required params
  const stillMissing: string[] = [];
  for (const p of bp.parameters) {
    if (p.required !== false && !(p.name in params)) {
      stillMissing.push(p.name);
    }
  }

  return {
    params,
    stillMissing,
    valid: stillMissing.length === 0,
  };
}

/**
 * Convenience: given a recommendation and answers, produce the final
 * merged params and indicate readiness. Combines createPromptSession + resolveParams.
 */
export function applyAnswers(
  recommendation: DeployRecommendation,
  answers: PromptAnswers,
): ResolvedParams | null {
  const session = createPromptSession(recommendation);
  if (!session) return null;
  return resolveParams(session, answers);
}

// =============================================================================
// Question Generation
// =============================================================================

/** Human-friendly question templates for common parameter names. */
const QUESTION_TEMPLATES: Record<string, { question: string; hint?: string }> = {
  projectName: { question: "What is the project name?", hint: "Used as a prefix for all Azure resource names" },
  location: { question: "Which Azure region should resources be deployed to?", hint: "e.g. eastus, westus2, westeurope, southeastasia" },
  sqlAdminLogin: { question: "What username should be used for the SQL Server administrator?", hint: "Cannot be 'admin' or 'sa'" },
  sqlAdminPassword: { question: "What password should be used for the SQL Server administrator?", hint: "Must meet Azure complexity requirements (8+ chars, mixed case, numbers, symbols)" },
  tenantId: { question: "What is your Azure AD tenant ID?", hint: "Found in Azure Portal → Azure Active Directory → Overview → Tenant ID" },
  runtime: { question: "Which runtime stack should be used?", hint: "e.g. NODE|18-lts, PYTHON|3.11, DOTNETCORE|8.0, JAVA|17-java17" },
  appServiceSku: { question: "What App Service Plan SKU tier do you want?", hint: "Free, B1 (basic), S1 (standard), P1v3 (premium)" },
  sqlDatabaseSku: { question: "What SQL Database SKU tier do you want?", hint: "Basic, S0, S1, P1" },
  serviceBusSku: { question: "What Service Bus SKU tier do you want?", hint: "Basic, Standard, Premium" },
  redisSku: { question: "What Redis Cache SKU tier do you want?", hint: "Basic, Standard, Premium" },
  acrSku: { question: "What Container Registry SKU tier do you want?", hint: "Basic, Standard, Premium" },
  cosmosApiKind: { question: "Which Cosmos DB API type do you want?", hint: "GlobalDocumentDB (SQL), MongoDB" },
  aiServiceKind: { question: "What type of AI service do you need?", hint: "CognitiveServices (multi-service), OpenAI" },
  includeKeyVault: { question: "Should Azure Key Vault be included for secret management?" },
  includeServiceBus: { question: "Should Azure Service Bus be included for queue triggers?" },
  includeEventGrid: { question: "Should Azure Event Grid be included for pub/sub events?" },
  includePostgres: { question: "Should a PostgreSQL database be included?" },
  includeRedis: { question: "Should a Redis cache be included?" },
  functionsSku: { question: "What Functions hosting plan do you want?", hint: "Consumption (pay-per-execution), Premium, Dedicated" },
  cdnSku: { question: "What CDN SKU should be used?", hint: "Standard_Microsoft, Standard_Akamai, Standard_Verizon, Premium_Verizon" },
};

function generateQuestions(
  parameters: BlueprintParameter[],
  inferredParams: Record<string, unknown>,
): ParameterQuestion[] {
  const questions: ParameterQuestion[] = [];

  for (const param of parameters) {
    // Skip already-inferred params
    if (param.name in inferredParams) continue;
    // Skip params with defaults (they're optional and have fallbacks)
    if (param.default !== undefined && param.required === false) continue;

    const template = QUESTION_TEMPLATES[param.name];
    const question: ParameterQuestion = {
      param: param.name,
      question: template?.question ?? `What value should be used for "${param.name}"?`,
      type: param.type,
      required: param.required !== false,
      description: param.description,
    };

    if (param.default !== undefined) question.default = param.default;
    if (param.choices && param.choices.length > 0) question.choices = param.choices;
    if (template?.hint) question.hint = template.hint;

    questions.push(question);
  }

  // Sort: required first, then by name
  questions.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return a.param.localeCompare(b.param);
  });

  return questions;
}

// =============================================================================
// Helpers
// =============================================================================

function coerceValue(value: unknown, type: "string" | "number" | "boolean"): unknown {
  if (value === null || value === undefined) return value;

  switch (type) {
    case "boolean":
      if (typeof value === "string") return value.toLowerCase() === "true" || value === "1" || value === "yes";
      return Boolean(value);
    case "number":
      if (typeof value === "string") return Number(value);
      return Number(value);
    case "string":
    default:
      return String(value);
  }
}
