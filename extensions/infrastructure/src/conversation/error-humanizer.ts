/**
 * Infrastructure Error Message Humanization
 */

import type {
  ErrorContext,
  HumanizedError,
  SuggestedAction,
} from "./types.js";
import type { Environment } from "../security/types.js";

export type ErrorPattern = {
  pattern: RegExp;
  code?: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  humanMessage: string;
  explanation: string;
  suggestedActions: string[];
  relatedDocs?: string[];
};

export type ErrorHumanizerConfig = {
  includeOriginalError: boolean;
  includeTechnicalDetails: boolean;
  maxSuggestions: number;
  includeDocLinks: boolean;
  verboseMode: boolean;
};

export const defaultErrorConfig: ErrorHumanizerConfig = {
  includeOriginalError: false,
  includeTechnicalDetails: true,
  maxSuggestions: 5,
  includeDocLinks: true,
  verboseMode: false,
};

// Common infrastructure error patterns
const ERROR_PATTERNS: ErrorPattern[] = [
  // Authentication/Authorization
  {
    pattern: /(?:access denied|unauthorized|forbidden|not authorized|permission denied)/i,
    code: "AUTH_DENIED",
    category: "authentication",
    severity: "high",
    humanMessage: "You don't have permission to perform this operation.",
    explanation: "Your current credentials or role don't have the necessary permissions for this action.",
    suggestedActions: [
      "Check that you're logged in with the correct account",
      "Verify your IAM role has the required permissions",
      "Contact your administrator to request access",
    ],
    relatedDocs: ["iam-permissions", "authentication-setup"],
  },
  {
    pattern: /(?:credentials|token)\s+(?:expired|invalid|missing)/i,
    code: "AUTH_EXPIRED",
    category: "authentication",
    severity: "medium",
    humanMessage: "Your authentication has expired or is invalid.",
    explanation: "The credentials used for this operation are no longer valid.",
    suggestedActions: [
      "Re-authenticate using 'espada login'",
      "Refresh your access tokens",
      "Check if MFA is required",
    ],
    relatedDocs: ["authentication-refresh"],
  },

  // Resource errors
  {
    pattern: /(?:resource|instance|server|service)\s+(?:not found|does not exist|doesn't exist)/i,
    code: "RESOURCE_NOT_FOUND",
    category: "resource",
    severity: "medium",
    humanMessage: "The requested resource could not be found.",
    explanation: "The resource you're trying to access doesn't exist or may have been deleted.",
    suggestedActions: [
      "Verify the resource name or ID is correct",
      "Check if the resource exists in the current environment",
      "Use 'list' command to see available resources",
    ],
    relatedDocs: ["resource-management"],
  },
  {
    pattern: /(?:resource|instance)\s+already exists/i,
    code: "RESOURCE_EXISTS",
    category: "resource",
    severity: "low",
    humanMessage: "A resource with this name already exists.",
    explanation: "You're trying to create a resource, but one with the same identifier already exists.",
    suggestedActions: [
      "Choose a different name for the new resource",
      "Delete the existing resource first if it's no longer needed",
      "Use 'update' instead to modify the existing resource",
    ],
    relatedDocs: ["resource-naming"],
  },
  {
    pattern: /(?:resource|instance)\s+(?:in use|busy|locked)/i,
    code: "RESOURCE_BUSY",
    category: "resource",
    severity: "medium",
    humanMessage: "The resource is currently in use and cannot be modified.",
    explanation: "Another operation is currently using this resource, preventing your action.",
    suggestedActions: [
      "Wait for the current operation to complete",
      "Check for any running deployments or updates",
      "Use '--force' with caution if you need to override",
    ],
    relatedDocs: ["resource-locking"],
  },

  // Quota/Limit errors
  {
    pattern: /(?:quota|limit)\s+(?:exceeded|reached|exhausted)/i,
    code: "QUOTA_EXCEEDED",
    category: "quota",
    severity: "high",
    humanMessage: "You've reached the limit for this type of resource.",
    explanation: "Your account or region has hit the maximum allowed quota for this resource type.",
    suggestedActions: [
      "Request a quota increase from your cloud provider",
      "Delete unused resources to free up quota",
      "Consider using a different region with available capacity",
    ],
    relatedDocs: ["quota-management", "cost-optimization"],
  },
  {
    pattern: /(?:insufficient|not enough)\s+(?:capacity|resources|memory|cpu|storage)/i,
    code: "INSUFFICIENT_CAPACITY",
    category: "quota",
    severity: "high",
    humanMessage: "There isn't enough capacity to complete this operation.",
    explanation: "The requested resources exceed what's currently available.",
    suggestedActions: [
      "Try a smaller instance size or fewer replicas",
      "Request resources in a different availability zone",
      "Wait and retry - capacity may become available",
    ],
    relatedDocs: ["capacity-planning"],
  },

  // Network errors
  {
    pattern: /(?:connection|network)\s+(?:refused|timeout|timed out|failed)/i,
    code: "NETWORK_ERROR",
    category: "network",
    severity: "medium",
    humanMessage: "Unable to connect to the infrastructure service.",
    explanation: "A network issue is preventing communication with the service.",
    suggestedActions: [
      "Check your internet connection",
      "Verify the service endpoint is correct",
      "Check if the service is experiencing an outage",
      "Verify firewall/security group settings",
    ],
    relatedDocs: ["network-troubleshooting"],
  },
  {
    pattern: /(?:dns|domain)\s+(?:resolution|lookup)\s+(?:failed|error)/i,
    code: "DNS_ERROR",
    category: "network",
    severity: "medium",
    humanMessage: "Unable to resolve the service address.",
    explanation: "DNS lookup failed for the requested endpoint.",
    suggestedActions: [
      "Check if the domain name is correct",
      "Verify DNS configuration in your network",
      "Try using the IP address directly",
    ],
    relatedDocs: ["dns-configuration"],
  },

  // Configuration errors
  {
    pattern: /(?:invalid|malformed)\s+(?:configuration|config|parameter|argument)/i,
    code: "INVALID_CONFIG",
    category: "configuration",
    severity: "medium",
    humanMessage: "The configuration provided is invalid.",
    explanation: "One or more configuration values don't meet the required format or constraints.",
    suggestedActions: [
      "Review the parameter requirements in documentation",
      "Check for typos in configuration values",
      "Validate your configuration file syntax",
    ],
    relatedDocs: ["configuration-reference"],
  },
  {
    pattern: /(?:missing|required)\s+(?:parameter|argument|field|value)/i,
    code: "MISSING_PARAM",
    category: "configuration",
    severity: "medium",
    humanMessage: "A required parameter is missing.",
    explanation: "The operation requires additional information that wasn't provided.",
    suggestedActions: [
      "Review the command syntax and required parameters",
      "Check if environment variables need to be set",
      "Use '--help' to see all required options",
    ],
    relatedDocs: ["cli-reference"],
  },

  // State errors
  {
    pattern: /(?:invalid|wrong)\s+(?:state|status)/i,
    code: "INVALID_STATE",
    category: "state",
    severity: "medium",
    humanMessage: "The resource is not in the correct state for this operation.",
    explanation: "The operation you requested can't be performed on a resource in its current state.",
    suggestedActions: [
      "Check the current state of the resource",
      "Wait for any pending operations to complete",
      "You may need to perform a different operation first",
    ],
    relatedDocs: ["resource-lifecycle"],
  },
  {
    pattern: /(?:dependency|dependent)\s+(?:error|failed|conflict)/i,
    code: "DEPENDENCY_ERROR",
    category: "state",
    severity: "high",
    humanMessage: "This operation is blocked by dependencies.",
    explanation: "Other resources depend on this one, preventing the requested operation.",
    suggestedActions: [
      "Identify and handle dependent resources first",
      "Use '--cascade' to handle dependencies automatically",
      "Check the dependency graph for this resource",
    ],
    relatedDocs: ["resource-dependencies"],
  },

  // Rate limiting
  {
    pattern: /(?:rate|throttl|too many requests)/i,
    code: "RATE_LIMITED",
    category: "throttling",
    severity: "low",
    humanMessage: "Too many requests - please slow down.",
    explanation: "You've made too many requests in a short period and have been temporarily throttled.",
    suggestedActions: [
      "Wait a few moments and try again",
      "Reduce the frequency of your requests",
      "Use batch operations when possible",
    ],
    relatedDocs: ["rate-limits"],
  },

  // Service errors
  {
    pattern: /(?:service|server)\s+(?:unavailable|error|down)/i,
    code: "SERVICE_ERROR",
    category: "service",
    severity: "high",
    humanMessage: "The infrastructure service is temporarily unavailable.",
    explanation: "There's an issue with the service itself, not your request.",
    suggestedActions: [
      "Check the service status page",
      "Wait a few minutes and retry",
      "Contact support if the issue persists",
    ],
    relatedDocs: ["service-status"],
  },
  {
    pattern: /(?:internal|unexpected)\s+(?:error|exception)/i,
    code: "INTERNAL_ERROR",
    category: "service",
    severity: "high",
    humanMessage: "An unexpected error occurred.",
    explanation: "Something went wrong on the service side that wasn't expected.",
    suggestedActions: [
      "Retry the operation",
      "Check service status for known issues",
      "Contact support with the error details",
    ],
    relatedDocs: ["troubleshooting"],
  },

  // Validation errors
  {
    pattern: /(?:validation|constraint)\s+(?:failed|error|violated)/i,
    code: "VALIDATION_ERROR",
    category: "validation",
    severity: "medium",
    humanMessage: "The input doesn't meet the validation requirements.",
    explanation: "One or more values don't meet the required validation rules.",
    suggestedActions: [
      "Review the allowed values and formats",
      "Check for special character restrictions",
      "Verify numeric values are within allowed ranges",
    ],
    relatedDocs: ["input-validation"],
  },

  // Timeout errors
  {
    pattern: /(?:operation|request)\s+(?:timed out|timeout)/i,
    code: "TIMEOUT",
    category: "timeout",
    severity: "medium",
    humanMessage: "The operation took too long and was cancelled.",
    explanation: "The requested operation didn't complete within the allowed time.",
    suggestedActions: [
      "Retry the operation",
      "Break the operation into smaller steps",
      "Check if the target resource is responding",
      "Increase timeout settings if possible",
    ],
    relatedDocs: ["timeout-configuration"],
  },
];

// Environment-specific message additions
const ENVIRONMENT_CONTEXT: Partial<Record<Environment, string>> = {
  production: "This is a PRODUCTION environment. Extra caution is advised.",
  staging: "This is a staging environment. Changes should be tested before promoting to production.",
  development: "This is a development environment. You have more flexibility for experimentation.",
};

export class InfrastructureErrorHumanizer {
  private config: ErrorHumanizerConfig;
  private customPatterns: ErrorPattern[];

  constructor(config?: Partial<ErrorHumanizerConfig>) {
    this.config = { ...defaultErrorConfig, ...config };
    this.customPatterns = [];
  }

  addCustomPattern(pattern: ErrorPattern): void {
    this.customPatterns.push(pattern);
  }

  humanize(error: ErrorContext): HumanizedError {
    // Try to match against known patterns
    const allPatterns = [...this.customPatterns, ...ERROR_PATTERNS];
    const matchedPattern = this.findMatchingPattern(error, allPatterns);

    if (matchedPattern) {
      return this.createHumanizedError(error, matchedPattern);
    }

    // Fallback for unrecognized errors
    return this.createGenericHumanizedError(error);
  }

  private findMatchingPattern(error: ErrorContext, patterns: ErrorPattern[]): ErrorPattern | undefined {
    const errorText = this.getErrorText(error);

    // First try to match by error code if available
    if (error.errorCode) {
      const codeMatch = patterns.find(p => p.code === error.errorCode);
      if (codeMatch) return codeMatch;
    }

    // Then try pattern matching on the message
    for (const pattern of patterns) {
      if (pattern.pattern.test(errorText)) {
        return pattern;
      }
    }

    return undefined;
  }

  private getErrorText(error: ErrorContext): string {
    if (typeof error.originalError === "string") {
      return error.originalError;
    }
    if (error.originalError instanceof Error) {
      return error.originalError.message;
    }
    return String(error.originalError);
  }

  private createHumanizedError(error: ErrorContext, pattern: ErrorPattern): HumanizedError {
    const suggestedActions = this.createSuggestedActions(pattern, error);
    
    const humanized: HumanizedError = {
      summary: pattern.humanMessage,
      explanation: this.enrichExplanation(pattern.explanation, error),
      severity: pattern.severity,
      category: pattern.category,
      suggestedActions,
    };

    // Add original error if configured
    if (this.config.includeOriginalError) {
      humanized.originalError = error.originalError;
    }

    // Add technical details if configured
    if (this.config.includeTechnicalDetails) {
      humanized.technicalDetails = this.formatTechnicalDetails(error);
    }

    // Add related documentation
    if (this.config.includeDocLinks && pattern.relatedDocs) {
      humanized.relatedDocumentation = pattern.relatedDocs.map(doc => ({
        title: this.formatDocTitle(doc),
        url: `https://docs.example.com/${doc}`,
      }));
    }

    // Add context-specific information
    if (error.environment) {
      humanized.environmentContext = ENVIRONMENT_CONTEXT[error.environment];
    }

    // Add error code if available
    if (pattern.code) {
      humanized.errorCode = pattern.code;
    }

    return humanized;
  }

  private createGenericHumanizedError(error: ErrorContext): HumanizedError {
    const errorText = this.getErrorText(error);

    return {
      summary: "An error occurred while performing the operation.",
      explanation: `The operation failed with the following message: ${errorText}`,
      severity: "medium",
      category: "unknown",
      suggestedActions: [
        {
          action: "Retry the operation",
          description: "The error might be temporary",
          command: error.suggestedRetry,
          isAutomatable: true,
          riskLevel: "low",
        },
        {
          action: "Check resource status",
          description: "Verify the target resource is available",
          isAutomatable: false,
          riskLevel: "minimal",
        },
        {
          action: "Review the logs",
          description: "Check logs for more detailed error information",
          isAutomatable: false,
          riskLevel: "minimal",
        },
      ],
      originalError: this.config.includeOriginalError ? error.originalError : undefined,
      technicalDetails: this.config.includeTechnicalDetails
        ? this.formatTechnicalDetails(error)
        : undefined,
    };
  }

  private enrichExplanation(baseExplanation: string, error: ErrorContext): string {
    let explanation = baseExplanation;

    if (this.config.verboseMode) {
      if (error.resourceId) {
        explanation += ` (Resource: ${error.resourceId})`;
      }
      if (error.operation) {
        explanation += ` during ${error.operation} operation`;
      }
    }

    return explanation;
  }

  private createSuggestedActions(pattern: ErrorPattern, error: ErrorContext): SuggestedAction[] {
    const actions: SuggestedAction[] = pattern.suggestedActions.map((action, index) => ({
      action,
      description: `Step ${index + 1} to resolve this issue`,
      priority: index + 1,
      isAutomatable: false,
      riskLevel: "low" as const,
    }));

    // Add context-specific actions
    if (error.operation) {
      actions.push({
        action: `Retry: ${error.operation}`,
        description: "Retry the failed operation",
        command: error.suggestedRetry,
        priority: actions.length + 1,
        isAutomatable: true,
        riskLevel: "low",
      });
    }

    // Limit suggestions
    return actions.slice(0, this.config.maxSuggestions);
  }

  private formatTechnicalDetails(error: ErrorContext): string {
    const details: string[] = [];

    if (error.errorCode) {
      details.push(`Error Code: ${error.errorCode}`);
    }
    if (error.resourceId) {
      details.push(`Resource ID: ${error.resourceId}`);
    }
    if (error.operation) {
      details.push(`Operation: ${error.operation}`);
    }
    if (error.timestamp) {
      details.push(`Timestamp: ${error.timestamp.toISOString()}`);
    }
    if (error.requestId) {
      details.push(`Request ID: ${error.requestId}`);
    }

    return details.join("\n");
  }

  private formatDocTitle(doc: string): string {
    return doc
      .split("-")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  // Batch humanization for multiple errors
  humanizeAll(errors: ErrorContext[]): HumanizedError[] {
    return errors.map(error => this.humanize(error));
  }

  // Get summary of multiple errors
  summarizeErrors(errors: ErrorContext[]): {
    total: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    mostCommon: string;
  } {
    const humanized = this.humanizeAll(errors);

    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const error of humanized) {
      const category = error.category ?? "unknown";
      const severity = error.severity ?? "medium";
      byCategory[category] = (byCategory[category] ?? 0) + 1;
      bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    }

    const mostCommon = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";

    return {
      total: errors.length,
      byCategory,
      bySeverity,
      mostCommon,
    };
  }

  // Format humanized error for display
  formatForDisplay(error: HumanizedError): string {
    let output = "";

    // Header with severity
    const severityEmoji: Record<string, string> = {
      low: "ℹ️",
      medium: "⚠️",
      high: "🔴",
      critical: "🚨",
    };
    const severity = error.severity ?? "medium";
    output += `${severityEmoji[severity] ?? "❓"} ${error.summary}\n\n`;

    // Explanation
    output += `${error.explanation}\n\n`;

    // Environment context
    if (error.environmentContext) {
      output += `📍 ${error.environmentContext}\n\n`;
    }

    // Suggested actions
    if (error.suggestedActions.length > 0) {
      output += "💡 Suggested actions:\n";
      for (const action of error.suggestedActions) {
        output += `  • ${action.action}`;
        if (action.command) {
          output += ` - \`${action.command}\``;
        }
        output += "\n";
      }
      output += "\n";
    }

    // Related documentation
    if (error.relatedDocumentation && error.relatedDocumentation.length > 0) {
      output += "📚 Related documentation:\n";
      for (const doc of error.relatedDocumentation) {
        output += `  • ${doc.title}: ${doc.url}\n`;
      }
      output += "\n";
    }

    // Technical details
    if (error.technicalDetails) {
      output += `🔧 Technical details:\n${error.technicalDetails}\n`;
    }

    return output.trim();
  }
}

export function createErrorHumanizer(config?: Partial<ErrorHumanizerConfig>): InfrastructureErrorHumanizer {
  return new InfrastructureErrorHumanizer(config);
}

export function humanizeError(error: ErrorContext, config?: Partial<ErrorHumanizerConfig>): HumanizedError {
  return createErrorHumanizer(config).humanize(error);
}

export function formatError(error: ErrorContext, config?: Partial<ErrorHumanizerConfig>): string {
  const humanizer = createErrorHumanizer(config);
  const humanized = humanizer.humanize(error);
  return humanizer.formatForDisplay(humanized);
}
