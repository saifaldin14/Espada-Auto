/**
 * Infrastructure Parameter Extraction from Natural Language
 */

import type {
  ExtractedParameter,
  ExtractedParameters,
  ParameterType,
  AmbiguousParameter,
  SuggestedDefault,
  IntentCategory,
} from "./types.js";
import type { Environment } from "../security/types.js";

export type ParameterPattern = {
  name: string;
  patterns: RegExp[];
  type: ParameterType;
  required: boolean;
  defaultValue?: unknown;
  validator?: (value: unknown) => boolean;
  normalizer?: (value: string) => unknown;
  aliases?: string[];
};

export type ParameterExtractionConfig = {
  enableUnitConversion: boolean;
  enableRelativeValues: boolean;
  defaultEnvironment: Environment;
  customPatterns?: ParameterPattern[];
  strictValidation: boolean;
};

export const defaultExtractionConfig: ParameterExtractionConfig = {
  enableUnitConversion: true,
  enableRelativeValues: true,
  defaultEnvironment: "development",
  strictValidation: false,
};

// Common parameter patterns
const PARAMETER_PATTERNS: ParameterPattern[] = [
  // Resource identifiers
  {
    name: "resourceName",
    patterns: [
      /(?:named?|called?)\s+["']?([a-z][a-z0-9-_]+)["']?/i,
      /["']([a-z][a-z0-9-_]+)["']/i,
      /resource\s+([a-z][a-z0-9-_]+)/i,
    ],
    type: "string",
    required: false,
    normalizer: (v) => v.toLowerCase().replace(/[^a-z0-9-_]/g, "-"),
  },
  {
    name: "resourceId",
    patterns: [
      /\b(i-[a-f0-9]+)\b/i, // EC2 instance ID
      /\b(arn:aws:[a-z0-9-]+:[a-z0-9-]*:[0-9]*:[a-z0-9-_/]+)\b/i, // AWS ARN
      /\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i, // UUID
      /\bid[:\s]+["']?([a-z0-9-_]+)["']?/i,
    ],
    type: "string",
    required: false,
  },

  // Counts and quantities
  {
    name: "count",
    patterns: [
      /(\d+)\s*(?:instances?|replicas?|nodes?|servers?|copies)/i,
      /(?:instances?|replicas?|nodes?|servers?|copies)[:\s]+(\d+)/i,
      /(?:set|scale)\s+(?:to\s+)?(\d+)/i,
    ],
    type: "count",
    required: false,
    normalizer: (v) => parseInt(v, 10),
    validator: (v) => typeof v === "number" && v > 0 && v <= 1000,
  },
  {
    name: "minCount",
    patterns: [
      /(?:min(?:imum)?|at least|no less than)\s*[:\s]?\s*(\d+)/i,
    ],
    type: "count",
    required: false,
    normalizer: (v) => parseInt(v, 10),
  },
  {
    name: "maxCount",
    patterns: [
      /(?:max(?:imum)?|at most|no more than|up to)\s*[:\s]?\s*(\d+)/i,
    ],
    type: "count",
    required: false,
    normalizer: (v) => parseInt(v, 10),
  },

  // Sizes
  {
    name: "size",
    patterns: [
      /(\d+(?:\.\d+)?)\s*(gb|mb|tb|gib|mib|tib|g|m|t)/i,
      /(?:size|storage|capacity|disk)[:\s]+(\d+(?:\.\d+)?)\s*(gb|mb|tb|gib|mib|tib|g|m|t)?/i,
    ],
    type: "size",
    required: false,
    normalizer: (v) => normalizeSize(v),
  },
  {
    name: "memory",
    patterns: [
      /(?:memory|ram|mem)[:\s]+(\d+(?:\.\d+)?)\s*(gb|mb|gib|mib|g|m)?/i,
      /(\d+(?:\.\d+)?)\s*(gb|mb|gib|mib|g|m)\s+(?:memory|ram|mem)/i,
    ],
    type: "size",
    required: false,
    normalizer: (v) => normalizeSize(v),
  },
  {
    name: "cpu",
    patterns: [
      /(?:cpu|vcpu|cores?)[:\s]+(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s*(?:cpu|vcpu|cores?)/i,
    ],
    type: "number",
    required: false,
    normalizer: (v) => parseFloat(v),
  },

  // Time and duration
  {
    name: "duration",
    patterns: [
      /(?:for|duration|timeout)[:\s]+(\d+)\s*(seconds?|minutes?|hours?|days?|s|m|h|d)/i,
      /(\d+)\s*(seconds?|minutes?|hours?|days?|s|m|h|d)\s+(?:timeout|duration)/i,
    ],
    type: "time-duration",
    required: false,
    normalizer: (v) => normalizeDuration(v),
  },
  {
    name: "schedule",
    patterns: [
      /(?:at|scheduled? for)\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)/i,
      /(?:every|each)\s+(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?)/i,
      /cron[:\s]+["']?([*\d,/-]+\s+[*\d,/-]+\s+[*\d,/-]+\s+[*\d,/-]+\s+[*\d,/-]+)["']?/i,
    ],
    type: "string",
    required: false,
  },

  // Environment
  {
    name: "environment",
    patterns: [
      /(?:in|on|to|for)\s+(production|prod|staging|stage|development|dev|test)/i,
      /(?:environment|env)[:\s]+["']?(production|prod|staging|stage|development|dev|test)["']?/i,
    ],
    type: "environment",
    required: false,
    normalizer: (v) => normalizeEnvironment(v),
  },

  // Region
  {
    name: "region",
    patterns: [
      /(?:in|to)\s+(us-east-1|us-west-2|eu-west-1|ap-northeast-1|[a-z]+-[a-z]+-\d+)/i,
      /(?:region)[:\s]+["']?([a-z]+-[a-z]+-\d+|[a-z]{2}-[a-z]+-\d+)["']?/i,
    ],
    type: "region",
    required: false,
  },

  // Tags
  {
    name: "tags",
    patterns: [
      /(?:tags?|labels?)[:\s]+({[^}]+})/i,
      /(?:tagged?|labeled?)\s+(?:with\s+)?["']?([a-z0-9-_]+)["']?\s*[=:]\s*["']?([a-z0-9-_]+)["']?/i,
    ],
    type: "tag",
    required: false,
    normalizer: (v) => parseTags(v),
  },

  // Boolean flags
  {
    name: "dryRun",
    patterns: [
      /(?:dry[- ]?run|preview|simulate|what[- ]?if)/i,
      /(?:without|don't|do not)\s+(?:actually|really)\s+(?:do|execute|run)/i,
    ],
    type: "boolean",
    required: false,
    normalizer: () => true,
  },
  {
    name: "force",
    patterns: [
      /(?:force|forcefully|forced)/i,
      /(?:skip|ignore|bypass)\s+(?:checks?|validations?|confirmations?)/i,
    ],
    type: "boolean",
    required: false,
    normalizer: () => true,
  },
  {
    name: "cascade",
    patterns: [
      /(?:cascade|cascading|recursive|recursively)/i,
      /(?:including?|with)\s+(?:all\s+)?(?:dependencies|dependents|children)/i,
    ],
    type: "boolean",
    required: false,
    normalizer: () => true,
  },

  // Instance types
  {
    name: "instanceType",
    patterns: [
      /(?:type|size|instance)[:\s]+["']?(t[23]\.\w+|m[456]\.\w+|c[567]\.\w+|r[567]\.\w+|[a-z][0-9]+\.[a-z0-9]+)["']?/i,
      /(?:using?|on)\s+(?:a\s+)?(t[23]\.\w+|m[456]\.\w+|c[567]\.\w+|r[567]\.\w+)/i,
    ],
    type: "string",
    required: false,
  },

  // Version
  {
    name: "version",
    patterns: [
      /(?:version|v)[:\s]+["']?(\d+(?:\.\d+)*(?:-[a-z0-9]+)?)["']?/i,
      /(?:to|at)\s+version\s+["']?(\d+(?:\.\d+)*(?:-[a-z0-9]+)?)["']?/i,
    ],
    type: "string",
    required: false,
  },

  // Image/AMI
  {
    name: "image",
    patterns: [
      /(?:image|ami|base)[:\s]+["']?(ami-[a-f0-9]+|[a-z0-9._/-]+:[a-z0-9._-]+)["']?/i,
      /(?:from|using)\s+(?:image\s+)?["']?([a-z0-9._/-]+:[a-z0-9._-]+)["']?/i,
    ],
    type: "string",
    required: false,
  },

  // Percentage
  {
    name: "percentage",
    patterns: [
      /(\d+(?:\.\d+)?)\s*%/,
      /(?:percent|percentage)[:\s]+(\d+(?:\.\d+)?)/i,
    ],
    type: "percentage",
    required: false,
    normalizer: (v) => parseFloat(v),
    validator: (v) => typeof v === "number" && v >= 0 && v <= 100,
  },
];

// Intent-specific required parameters
const INTENT_REQUIRED_PARAMS: Partial<Record<IntentCategory, string[]>> = {
  create: ["resourceName"],
  delete: ["resourceName"],
  scale: ["count"],
  update: ["resourceName"],
  deploy: ["version"],
  rollback: ["version"],
  restore: ["resourceName"],
  migrate: ["resourceName", "region"],
};

export class InfrastructureParameterExtractor {
  private config: ParameterExtractionConfig;
  private patterns: ParameterPattern[];

  constructor(config?: Partial<ParameterExtractionConfig>) {
    this.config = { ...defaultExtractionConfig, ...config };
    this.patterns = [...PARAMETER_PATTERNS, ...(this.config.customPatterns ?? [])];
  }

  extract(input: string, intent?: IntentCategory): ExtractedParameters {
    const normalizedInput = input.trim();
    const parameters: ExtractedParameter[] = [];
    const ambiguousParameters: AmbiguousParameter[] = [];

    // Extract parameters using patterns
    for (const pattern of this.patterns) {
      const extracted = this.extractParameter(normalizedInput, pattern);
      if (extracted.length > 0) {
        if (extracted.length === 1) {
          parameters.push(extracted[0]);
        } else {
          // Multiple matches - might be ambiguous
          const bestMatch = extracted.reduce((best, curr) =>
            curr.confidence > best.confidence ? curr : best
          );
          parameters.push(bestMatch);

          if (extracted.length > 1 && extracted[1].confidence > 0.5) {
            ambiguousParameters.push({
              name: pattern.name,
              possibleValues: extracted.map(e => e.value),
              sourceText: extracted.map(e => e.sourceText).join(", "),
              clarificationQuestion: this.generateClarificationQuestion(pattern.name, extracted),
            });
          }
        }
      }
    }

    // Determine missing required parameters
    const requiredParams = intent ? (INTENT_REQUIRED_PARAMS[intent] ?? []) : [];
    const extractedNames = new Set(parameters.map(p => p.name));
    const missingRequired = requiredParams.filter(p => !extractedNames.has(p));

    // Generate suggested defaults
    const suggestedDefaults = this.generateSuggestedDefaults(missingRequired, intent, parameters);

    return {
      parameters,
      missingRequired,
      ambiguousParameters,
      suggestedDefaults,
    };
  }

  private extractParameter(input: string, pattern: ParameterPattern): ExtractedParameter[] {
    const results: ExtractedParameter[] = [];

    for (const regex of pattern.patterns) {
      const matches = input.matchAll(new RegExp(regex, "gi"));
      for (const match of matches) {
        // For boolean types, we just need to detect the pattern match (no capture group needed)
        // For other types, we need a capture group
        const rawValue = match[1] ?? match[0];
        
        // Skip if no value and not a boolean type
        if (!rawValue && pattern.type !== "boolean") {
          continue;
        }

        let normalizedValue: unknown = rawValue;

        if (pattern.normalizer) {
          try {
            normalizedValue = pattern.normalizer(rawValue);
          } catch {
            normalizedValue = rawValue;
          }
        }

        let validationStatus: "valid" | "invalid" | "needs-clarification" = "valid";
        let validationMessage: string | undefined;

        if (pattern.validator && this.config.strictValidation) {
          if (!pattern.validator(normalizedValue)) {
            validationStatus = "invalid";
            validationMessage = `Value "${rawValue}" is not valid for ${pattern.name}`;
          }
        }

        results.push({
          name: pattern.name,
          value: normalizedValue,
          type: pattern.type,
          confidence: this.calculateConfidence(match, input),
          sourceText: match[0],
          startIndex: match.index ?? 0,
          endIndex: (match.index ?? 0) + match[0].length,
          normalized: normalizedValue !== rawValue,
          validationStatus,
          validationMessage,
        });
      }
    }

    return results;
  }

  private calculateConfidence(match: RegExpMatchArray, input: string): number {
    let confidence = 0.7;

    // Boost for longer matches
    const matchRatio = match[0].length / input.length;
    confidence += matchRatio * 0.2;

    // Boost for matches with explicit labels (e.g., "name: value")
    if (/[=:]/.test(match[0])) {
      confidence += 0.1;
    }

    return Math.min(1, confidence);
  }

  private generateClarificationQuestion(paramName: string, extracted: ExtractedParameter[]): string {
    const values = extracted.map(e => `"${e.sourceText}"`).join(" or ");
    return `I found multiple possible values for ${paramName}: ${values}. Which one did you mean?`;
  }

  private generateSuggestedDefaults(
    missingParams: string[],
    intent: IntentCategory | undefined,
    _existingParams: ExtractedParameter[]
  ): SuggestedDefault[] {
    const defaults: SuggestedDefault[] = [];

    for (const paramName of missingParams) {
      const pattern = this.patterns.find(p => p.name === paramName);
      if (pattern?.defaultValue !== undefined) {
        defaults.push({
          name: paramName,
          suggestedValue: pattern.defaultValue,
          reason: "Default value",
          confidence: 0.5,
        });
        continue;
      }

      // Context-aware defaults
      switch (paramName) {
        case "environment":
          defaults.push({
            name: paramName,
            suggestedValue: this.config.defaultEnvironment,
            reason: "Using default environment",
            confidence: 0.6,
          });
          break;
        case "count":
          if (intent === "scale") {
            defaults.push({
              name: paramName,
              suggestedValue: 1,
              reason: "Default scale increment",
              confidence: 0.4,
            });
          }
          break;
        case "dryRun":
          if (intent === "delete" || intent === "migrate") {
            defaults.push({
              name: paramName,
              suggestedValue: true,
              reason: "Recommended for safety on destructive operations",
              confidence: 0.7,
            });
          }
          break;
      }
    }

    return defaults;
  }
}

// Helper functions
function normalizeSize(value: string): { value: number; unit: string } {
  const match = value.match(/(\d+(?:\.\d+)?)\s*(gb|mb|tb|gib|mib|tib|g|m|t)?/i);
  if (!match) return { value: 0, unit: "GB" };

  const num = parseFloat(match[1]);
  const unit = (match[2] || "GB").toUpperCase();

  // Normalize to GB
  const unitMap: Record<string, number> = {
    "TB": 1024, "TIB": 1024, "T": 1024,
    "GB": 1, "GIB": 1, "G": 1,
    "MB": 1 / 1024, "MIB": 1 / 1024, "M": 1 / 1024,
  };

  return {
    value: num * (unitMap[unit] ?? 1),
    unit: "GB",
  };
}

function normalizeDuration(value: string): { value: number; unit: string } {
  const match = value.match(/(\d+)\s*(seconds?|minutes?|hours?|days?|s|m|h|d)/i);
  if (!match) return { value: 0, unit: "seconds" };

  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const unitMap: Record<string, string> = {
    "s": "seconds", "second": "seconds", "seconds": "seconds",
    "m": "minutes", "minute": "minutes", "minutes": "minutes",
    "h": "hours", "hour": "hours", "hours": "hours",
    "d": "days", "day": "days", "days": "days",
  };

  return {
    value: num,
    unit: unitMap[unit] ?? "seconds",
  };
}

function normalizeEnvironment(value: string): Environment {
  const envMap: Record<string, Environment> = {
    "prod": "production", "production": "production",
    "stage": "staging", "staging": "staging",
    "dev": "development", "development": "development",
    "test": "development",
  };
  return envMap[value.toLowerCase()] ?? "development";
}

function parseTags(value: string): Record<string, string> {
  try {
    // Try JSON format first
    if (value.startsWith("{")) {
      return JSON.parse(value);
    }
    // Key=value format
    const tags: Record<string, string> = {};
    const pairs = value.split(/[,;]/);
    for (const pair of pairs) {
      const [key, val] = pair.split(/[=:]/);
      if (key && val) {
        tags[key.trim()] = val.trim();
      }
    }
    return tags;
  } catch {
    return {};
  }
}

export function createParameterExtractor(config?: Partial<ParameterExtractionConfig>): InfrastructureParameterExtractor {
  return new InfrastructureParameterExtractor(config);
}

export function extractParameters(input: string, intent?: IntentCategory, config?: Partial<ParameterExtractionConfig>): ExtractedParameters {
  return createParameterExtractor(config).extract(input, intent);
}
