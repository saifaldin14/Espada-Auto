/**
 * Infrastructure Knowledge Graph — Policy-as-Code Authoring
 *
 * Provides a programmatic interface for authoring OPA/Rego policies via
 * high-level templates. Generates `LocalRegoRule` objects consumable by
 * the `LocalOpaEngine` without requiring direct Rego knowledge.
 *
 * Supports:
 *   - Template-based rule creation from common governance patterns
 *   - Rule composition with AND/OR/NOT combinators
 *   - Rule validation and linting
 *   - Policy pack management (named collections of rules)
 *   - Markdown-formatted policy documentation generation
 */

import type {
  LocalRegoRule,
  LocalRegoCondition,
  OpaSeverity,
} from "../core/opa-engine.js";

// =============================================================================
// Types
// =============================================================================

/** Supported policy template types. */
export type PolicyTemplateType =
  | "require-tags"
  | "require-encryption"
  | "restrict-regions"
  | "cost-limit"
  | "restrict-resource-types"
  | "restrict-providers"
  | "require-approval-for-action"
  | "naming-convention"
  | "restrict-initiator"
  | "custom";

/** Input for the policy builder. */
export type PolicyTemplateInput = {
  /** Unique rule ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Template to use. */
  template: PolicyTemplateType;
  /** Severity of violations. */
  severity: OpaSeverity;
  /** Action on violation. */
  action: "deny" | "warn" | "require_approval" | "notify";
  /** Template-specific parameters. */
  params: Record<string, unknown>;
  /** Rego package (defaults to "espada.policy.custom"). */
  package?: string;
};

/** A named collection of policy rules. */
export type PolicyPack = {
  /** Pack name. */
  name: string;
  /** Pack description. */
  description: string;
  /** Pack version. */
  version: string;
  /** Rules in this pack. */
  rules: LocalRegoRule[];
  /** When the pack was created. */
  createdAt: string;
  /** Tags for categorization. */
  tags: string[];
};

/** Validation result for a rule or pack. */
export type PolicyValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

// =============================================================================
// Template Builders
// =============================================================================

type TemplateFn = (
  input: PolicyTemplateInput,
) => { condition: LocalRegoCondition; message: string };

const TEMPLATE_BUILDERS: Record<string, TemplateFn> = {

  "require-tags": (input) => {
    const requiredTags = input.params.tags as string[] | undefined;
    if (!requiredTags || requiredTags.length === 0) {
      throw new Error("require-tags: 'tags' parameter must be a non-empty array of tag names");
    }
    // Check that resource metadata contains required tags
    const conditions: LocalRegoCondition[] = requiredTags.map((tag) => ({
      type: "field_equals" as const,
      field: `changeRequest.metadata.tags.${tag}`,
      value: undefined,
    }));
    // If any required tag is missing (equals undefined), trigger
    const condition: LocalRegoCondition =
      conditions.length === 1
        ? conditions[0]!
        : { type: "or", conditions };

    return {
      condition,
      message: `Resource must have required tags: ${requiredTags.join(", ")}. Missing tag detected.`,
    };
  },

  "require-encryption": (input) => {
    const resourceTypes = (input.params.resourceTypes as string[]) ?? [
      "database", "storage", "compute",
    ];
    const typeCondition: LocalRegoCondition =
      resourceTypes.length === 1
        ? { type: "field_equals", field: "changeRequest.resourceType", value: resourceTypes[0] }
        : { type: "field_in", field: "changeRequest.resourceType", values: resourceTypes };
    return {
      condition: {
        type: "and",
        conditions: [
          typeCondition,
          { type: "field_not_equals", field: "changeRequest.metadata.encrypted", value: true },
        ],
      },
      message: `Resources of type {{changeRequest.resourceType}} must have encryption enabled.`,
    };
  },

  "restrict-regions": (input) => {
    const allowedRegions = input.params.allowedRegions as string[] | undefined;
    if (!allowedRegions || allowedRegions.length === 0) {
      throw new Error("restrict-regions: 'allowedRegions' parameter is required");
    }
    return {
      condition: {
        type: "field_not_in",
        field: "changeRequest.metadata.region",
        values: allowedRegions,
      },
      message: `Resource deployed to {{changeRequest.metadata.region}} — only allowed regions: ${allowedRegions.join(", ")}.`,
    };
  },

  "cost-limit": (input) => {
    const maxMonthlyCost = input.params.maxMonthlyCost as number | undefined;
    if (maxMonthlyCost === undefined || maxMonthlyCost <= 0) {
      throw new Error("cost-limit: 'maxMonthlyCost' must be a positive number");
    }
    return {
      condition: {
        type: "field_gt",
        field: "changeRequest.metadata.estimatedMonthlyCost",
        value: maxMonthlyCost,
      },
      message: `Estimated monthly cost exceeds limit of $${maxMonthlyCost}.`,
    };
  },

  "restrict-resource-types": (input) => {
    const blockedTypes = input.params.blockedTypes as string[] | undefined;
    if (!blockedTypes || blockedTypes.length === 0) {
      throw new Error("restrict-resource-types: 'blockedTypes' parameter is required");
    }
    return {
      condition: {
        type: "field_in",
        field: "changeRequest.resourceType",
        values: blockedTypes,
      },
      message: `Resource type {{changeRequest.resourceType}} is not allowed by policy.`,
    };
  },

  "restrict-providers": (input) => {
    const allowedProviders = input.params.allowedProviders as string[] | undefined;
    if (!allowedProviders || allowedProviders.length === 0) {
      throw new Error("restrict-providers: 'allowedProviders' parameter is required");
    }
    return {
      condition: {
        type: "field_not_in",
        field: "changeRequest.provider",
        values: allowedProviders,
      },
      message: `Provider {{changeRequest.provider}} is not in the allowed list: ${allowedProviders.join(", ")}.`,
    };
  },

  "require-approval-for-action": (input) => {
    const actions = input.params.actions as string[] | undefined;
    if (!actions || actions.length === 0) {
      throw new Error("require-approval-for-action: 'actions' parameter is required");
    }
    return {
      condition: {
        type: "field_in",
        field: "changeRequest.action",
        values: actions,
      },
      message: `Action {{changeRequest.action}} requires manual approval per policy.`,
    };
  },

  "naming-convention": (input) => {
    const pattern = input.params.pattern as string | undefined;
    if (!pattern) {
      throw new Error("naming-convention: 'pattern' parameter is required (regex)");
    }
    // Negate: trigger when resource name does NOT match the pattern
    return {
      condition: {
        type: "not",
        condition: {
          type: "field_matches",
          field: "changeRequest.metadata.name",
          pattern,
        },
      },
      message: `Resource name does not match required naming convention: /${pattern}/.`,
    };
  },

  "restrict-initiator": (input) => {
    const blockedInitiators = input.params.blockedInitiators as string[] | undefined;
    if (!blockedInitiators || blockedInitiators.length === 0) {
      throw new Error("restrict-initiator: 'blockedInitiators' parameter is required");
    }
    return {
      condition: {
        type: "field_in",
        field: "changeRequest.initiator",
        values: blockedInitiators,
      },
      message: `Initiator {{changeRequest.initiator}} is blocked from making changes by policy.`,
    };
  },

  custom: (input) => {
    const condition = input.params.condition as LocalRegoCondition | undefined;
    const message = input.params.message as string | undefined;
    if (!condition) {
      throw new Error("custom: 'condition' parameter is required");
    }
    return {
      condition,
      message: message ?? "Custom policy violation.",
    };
  },
};

// =============================================================================
// Rule Builder
// =============================================================================

/**
 * Build a `LocalRegoRule` from a policy template input.
 */
export function buildPolicyRule(input: PolicyTemplateInput): LocalRegoRule {
  const builder = TEMPLATE_BUILDERS[input.template];
  if (!builder) {
    throw new Error(`Unknown policy template: ${input.template}`);
  }

  const { condition, message } = builder(input);

  return {
    id: input.id,
    description: input.name,
    package: input.package ?? "espada.policy.custom",
    condition,
    severity: input.severity,
    action: input.action,
    message,
  };
}

/**
 * Build multiple rules from template inputs.
 */
export function buildPolicyRules(inputs: PolicyTemplateInput[]): LocalRegoRule[] {
  return inputs.map(buildPolicyRule);
}

// =============================================================================
// Combinators
// =============================================================================

/**
 * Create a rule that triggers when ALL inner conditions match.
 */
export function allOf(...conditions: LocalRegoCondition[]): LocalRegoCondition {
  if (conditions.length === 1) return conditions[0]!;
  return { type: "and", conditions };
}

/**
 * Create a rule that triggers when ANY inner condition matches.
 */
export function anyOf(...conditions: LocalRegoCondition[]): LocalRegoCondition {
  if (conditions.length === 1) return conditions[0]!;
  return { type: "or", conditions };
}

/**
 * Negate a condition.
 */
export function not(condition: LocalRegoCondition): LocalRegoCondition {
  return { type: "not", condition };
}

/**
 * Field equals value.
 */
export function fieldEquals(field: string, value: unknown): LocalRegoCondition {
  return { type: "field_equals", field, value };
}

/**
 * Field greater than value.
 */
export function fieldGt(field: string, value: number): LocalRegoCondition {
  return { type: "field_gt", field, value };
}

/**
 * Field less than value.
 */
export function fieldLt(field: string, value: number): LocalRegoCondition {
  return { type: "field_lt", field, value };
}

/**
 * Field matches regex pattern.
 */
export function fieldMatches(field: string, pattern: string): LocalRegoCondition {
  return { type: "field_matches", field, pattern };
}

/**
 * Field value is in the given list.
 */
export function fieldIn(field: string, values: unknown[]): LocalRegoCondition {
  return { type: "field_in", field, values };
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a single policy rule for structural correctness.
 */
export function validatePolicyRule(rule: LocalRegoRule): PolicyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!rule.id || rule.id.trim().length === 0) {
    errors.push("Rule ID is required");
  }
  if (rule.id && !/^[\w.-]+$/.test(rule.id)) {
    errors.push("Rule ID must be alphanumeric with dots, hyphens, or underscores");
  }
  if (!rule.description || rule.description.trim().length === 0) {
    warnings.push("Rule description is empty");
  }
  if (!rule.package || !rule.package.startsWith("espada.")) {
    warnings.push("Package should start with 'espada.' by convention");
  }
  if (!rule.message || rule.message.trim().length === 0) {
    errors.push("Rule message is required");
  }

  // Validate condition tree
  const condErrors = validateCondition(rule.condition, "root");
  errors.push(...condErrors);

  return { valid: errors.length === 0, errors, warnings };
}

function validateCondition(cond: LocalRegoCondition, path: string): string[] {
  const errors: string[] = [];

  if (!cond || typeof cond !== "object") {
    errors.push(`${path}: condition is not a valid object`);
    return errors;
  }

  switch (cond.type) {
    case "field_equals":
    case "field_not_equals":
    case "field_contains":
      if (!cond.field) errors.push(`${path}: missing 'field'`);
      break;
    case "field_matches":
      if (!cond.field) errors.push(`${path}: missing 'field'`);
      if (!cond.pattern) errors.push(`${path}: missing 'pattern'`);
      try {
        new RegExp(cond.pattern);
      } catch {
        errors.push(`${path}: invalid regex pattern '${cond.pattern}'`);
      }
      break;
    case "field_gt":
    case "field_lt":
      if (!cond.field) errors.push(`${path}: missing 'field'`);
      if (typeof cond.value !== "number") errors.push(`${path}: 'value' must be a number`);
      break;
    case "field_in":
    case "field_not_in":
      if (!cond.field) errors.push(`${path}: missing 'field'`);
      if (!Array.isArray(cond.values)) errors.push(`${path}: 'values' must be an array`);
      break;
    case "and":
    case "or":
      if (!Array.isArray(cond.conditions) || cond.conditions.length === 0) {
        errors.push(`${path}: '${cond.type}' must have at least one child condition`);
      } else {
        for (let i = 0; i < cond.conditions.length; i++) {
          errors.push(...validateCondition(cond.conditions[i]!, `${path}.${cond.type}[${i}]`));
        }
      }
      break;
    case "not":
      if (!cond.condition) {
        errors.push(`${path}: 'not' must have a child condition`);
      } else {
        errors.push(...validateCondition(cond.condition, `${path}.not`));
      }
      break;
    default:
      errors.push(`${path}: unknown condition type '${(cond as { type: string }).type}'`);
  }

  return errors;
}

/**
 * Validate a policy pack.
 */
export function validatePolicyPack(pack: PolicyPack): PolicyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!pack.name) errors.push("Pack name is required");
  if (!pack.description) warnings.push("Pack description is empty");
  if (pack.rules.length === 0) warnings.push("Pack has no rules");

  // Check for duplicate IDs
  const ids = new Set<string>();
  for (const rule of pack.rules) {
    if (ids.has(rule.id)) {
      errors.push(`Duplicate rule ID: ${rule.id}`);
    }
    ids.add(rule.id);

    const ruleResult = validatePolicyRule(rule);
    errors.push(...ruleResult.errors.map((e) => `Rule '${rule.id}': ${e}`));
    warnings.push(...ruleResult.warnings.map((w) => `Rule '${rule.id}': ${w}`));
  }

  return { valid: errors.length === 0, errors, warnings };
}

// =============================================================================
// Policy Pack Management
// =============================================================================

/**
 * Create a new policy pack.
 */
export function createPolicyPack(
  name: string,
  description: string,
  rules: LocalRegoRule[],
  tags: string[] = [],
): PolicyPack {
  return {
    name,
    description,
    version: "1.0.0",
    rules,
    createdAt: new Date().toISOString(),
    tags,
  };
}

// =============================================================================
// Built-in Policy Packs
// =============================================================================

/**
 * Generate the "security-baseline" policy pack with common governance rules.
 */
export function getSecurityBaselinePack(): PolicyPack {
  const rules = buildPolicyRules([
    {
      id: "sec.require-encryption",
      name: "Require encryption on storage and databases",
      template: "require-encryption",
      severity: "high",
      action: "deny",
      params: { resourceTypes: ["database", "storage"] },
      package: "espada.policy.security",
    },
    {
      id: "sec.require-tags",
      name: "Require environment and owner tags",
      template: "require-tags",
      severity: "medium",
      action: "warn",
      params: { tags: ["Environment", "Owner"] },
      package: "espada.policy.security",
    },
    {
      id: "sec.restrict-regions",
      name: "Restrict to approved regions",
      template: "restrict-regions",
      severity: "high",
      action: "deny",
      params: { allowedRegions: ["us-east-1", "us-west-2", "eu-west-1"] },
      package: "espada.policy.security",
    },
    {
      id: "sec.naming-convention",
      name: "Enforce naming convention",
      template: "naming-convention",
      severity: "low",
      action: "warn",
      params: { pattern: "^[a-z][a-z0-9-]+$" },
      package: "espada.policy.security",
    },
  ]);

  return createPolicyPack(
    "security-baseline",
    "Baseline security policies for infrastructure compliance",
    rules,
    ["security", "baseline", "compliance"],
  );
}

/**
 * Generate the "cost-governance" policy pack.
 */
export function getCostGovernancePack(): PolicyPack {
  const rules = buildPolicyRules([
    {
      id: "cost.monthly-limit",
      name: "Monthly cost limit per resource",
      template: "cost-limit",
      severity: "high",
      action: "require_approval",
      params: { maxMonthlyCost: 500 },
      package: "espada.policy.cost",
    },
    {
      id: "cost.require-tags",
      name: "Require cost center tag",
      template: "require-tags",
      severity: "medium",
      action: "warn",
      params: { tags: ["CostCenter"] },
      package: "espada.policy.cost",
    },
  ]);

  return createPolicyPack(
    "cost-governance",
    "Cost governance policies for budget control",
    rules,
    ["cost", "governance", "budget"],
  );
}

/** List all available template types with descriptions. */
export function getAvailableTemplates(): Array<{
  template: PolicyTemplateType;
  description: string;
  requiredParams: string[];
}> {
  return [
    { template: "require-tags", description: "Require specific tags on resources", requiredParams: ["tags"] },
    { template: "require-encryption", description: "Require encryption on storage/database resources", requiredParams: [] },
    { template: "restrict-regions", description: "Restrict deployments to allowed regions", requiredParams: ["allowedRegions"] },
    { template: "cost-limit", description: "Set maximum monthly cost per resource", requiredParams: ["maxMonthlyCost"] },
    { template: "restrict-resource-types", description: "Block specific resource types", requiredParams: ["blockedTypes"] },
    { template: "restrict-providers", description: "Restrict to allowed cloud providers", requiredParams: ["allowedProviders"] },
    { template: "require-approval-for-action", description: "Require approval for certain actions", requiredParams: ["actions"] },
    { template: "naming-convention", description: "Enforce resource naming conventions (regex)", requiredParams: ["pattern"] },
    { template: "restrict-initiator", description: "Block changes from specific initiators", requiredParams: ["blockedInitiators"] },
    { template: "custom", description: "Custom condition (provide your own)", requiredParams: ["condition"] },
  ];
}

// =============================================================================
// Markdown Documentation
// =============================================================================

/**
 * Format a policy pack as markdown documentation.
 */
export function formatPolicyPackMarkdown(pack: PolicyPack): string {
  const lines: string[] = [
    `# Policy Pack: ${pack.name}`,
    "",
    pack.description,
    "",
    `**Version:** ${pack.version}`,
    `**Created:** ${pack.createdAt}`,
    `**Tags:** ${pack.tags.join(", ") || "none"}`,
    "",
    `## Rules (${pack.rules.length})`,
    "",
    "| ID | Description | Severity | Action |",
    "|----|-------------|----------|--------|",
    ...pack.rules.map(
      (r) => `| ${r.id} | ${r.description} | ${r.severity} | ${r.action} |`,
    ),
    "",
  ];

  // Rule details
  for (const rule of pack.rules) {
    lines.push(
      `### ${rule.id}`,
      "",
      `**Description:** ${rule.description}`,
      `**Package:** ${rule.package}`,
      `**Severity:** ${rule.severity}`,
      `**Action:** ${rule.action}`,
      `**Message:** ${rule.message}`,
      "",
      "**Condition:**",
      "```json",
      JSON.stringify(rule.condition, null, 2),
      "```",
      "",
    );
  }

  return lines.join("\n");
}
