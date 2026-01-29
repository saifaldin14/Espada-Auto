/**
 * Infrastructure Operation Intent Classifier
 */

import type {
  IntentCategory,
  InfrastructureIntent,
  IntentClassificationResult,
  ConversationContext,
} from "./types.js";
import type { RiskLevel } from "../security/types.js";

export type IntentPattern = {
  pattern: RegExp;
  category: IntentCategory;
  subIntent?: string;
  targetResourceType?: string;
  weight: number;
  riskLevel: RiskLevel;
};

export type IntentClassifierConfig = {
  confidenceThreshold: number;
  ambiguityThreshold: number;
  maxAlternatives: number;
  customPatterns?: IntentPattern[];
  enableFuzzyMatching: boolean;
  contextWeight: number;
};

export const defaultIntentClassifierConfig: IntentClassifierConfig = {
  confidenceThreshold: 0.6,
  ambiguityThreshold: 0.15,
  maxAlternatives: 3,
  enableFuzzyMatching: true,
  contextWeight: 0.2,
};

// Built-in intent patterns
const INTENT_PATTERNS: IntentPattern[] = [
  // Create operations
  { pattern: /\b(create|make|provision|spin up|launch|start|deploy|add|new)\b/i, category: "create", weight: 1.0, riskLevel: "medium" },
  { pattern: /\b(create|make|add)\s+(a\s+)?(new\s+)?(\w+\s+)?(server|instance|vm|container|pod)/i, category: "create", subIntent: "compute", targetResourceType: "compute", weight: 1.2, riskLevel: "medium" },
  { pattern: /\b(create|make|add)\s+(a\s+)?(new\s+)?(\w+\s+)?(database|db|rds|sql)/i, category: "create", subIntent: "database", targetResourceType: "database", weight: 1.2, riskLevel: "high" },
  { pattern: /\b(create|make|add)\s+(a\s+)?(new\s+)?(\w+\s+)?(bucket|storage|s3)/i, category: "create", subIntent: "storage", targetResourceType: "storage", weight: 1.2, riskLevel: "low" },

  // Read/Describe operations
  { pattern: /\b(show|display|get|describe|what is|what are|tell me about|info|information|details)\b/i, category: "describe", weight: 1.0, riskLevel: "minimal" },
  { pattern: /\b(list|show all|display all|get all|enumerate)\b/i, category: "list", weight: 1.0, riskLevel: "minimal" },
  { pattern: /\b(search|find|look for|locate|where is)\b/i, category: "search", weight: 1.0, riskLevel: "minimal" },
  { pattern: /\b(compare|diff|difference|versus|vs)\b/i, category: "compare", weight: 1.0, riskLevel: "minimal" },

  // Update operations
  { pattern: /\b(update|modify|change|edit|alter|patch|reconfigure)\b/i, category: "update", weight: 1.0, riskLevel: "medium" },
  { pattern: /\b(configure|set|adjust|tune)\b/i, category: "configure", weight: 0.9, riskLevel: "medium" },
  { pattern: /\b(resize|expand|shrink|grow)\b/i, category: "scale", subIntent: "resize", weight: 1.1, riskLevel: "medium" },

  // Delete operations
  { pattern: /\b(delete|remove|destroy|terminate|kill|drop|tear down|decommission)\b/i, category: "delete", weight: 1.0, riskLevel: "high" },
  { pattern: /\b(purge|wipe|clean up|cleanup)\b/i, category: "delete", subIntent: "purge", weight: 1.1, riskLevel: "critical" },

  // Scale operations
  { pattern: /\b(scale|scale up|scale down|scale out|scale in|autoscale)\b/i, category: "scale", weight: 1.0, riskLevel: "medium" },
  { pattern: /\b(increase|decrease|add more|reduce)\s+(capacity|instances|replicas|nodes)/i, category: "scale", weight: 1.1, riskLevel: "medium" },

  // Deploy operations
  { pattern: /\b(deploy|release|push|ship|publish)\b/i, category: "deploy", weight: 1.0, riskLevel: "high" },
  { pattern: /\b(rollback|revert|undo|roll back)\b/i, category: "rollback", weight: 1.0, riskLevel: "high" },

  // Backup/Restore operations
  { pattern: /\b(backup|snapshot|archive|save state)\b/i, category: "backup", weight: 1.0, riskLevel: "low" },
  { pattern: /\b(restore|recover|bring back|resurrect)\b/i, category: "restore", weight: 1.0, riskLevel: "high" },

  // Monitor/Diagnose operations
  { pattern: /\b(monitor|watch|observe|track)\b/i, category: "monitor", weight: 1.0, riskLevel: "minimal" },
  { pattern: /\b(diagnose|debug|troubleshoot|investigate|check health|health check)\b/i, category: "diagnose", weight: 1.0, riskLevel: "minimal" },
  { pattern: /\b(logs|metrics|status|state)\b/i, category: "monitor", subIntent: "logs", weight: 0.8, riskLevel: "minimal" },

  // Migrate operations
  { pattern: /\b(migrate|move|transfer|relocate|shift)\b/i, category: "migrate", weight: 1.0, riskLevel: "high" },

  // Control operations
  { pattern: /\b(stop|halt|pause|freeze|suspend)\b/i, category: "update", subIntent: "stop", weight: 1.0, riskLevel: "medium" },
  { pattern: /\b(start|resume|unpause|unfreeze|activate)\b/i, category: "update", subIntent: "start", weight: 1.0, riskLevel: "low" },
  { pattern: /\b(restart|reboot|recycle)\b/i, category: "update", subIntent: "restart", weight: 1.0, riskLevel: "medium" },

  // Help and control
  { pattern: /\b(help|how to|how do i|what can|guide|tutorial)\b/i, category: "help", weight: 1.0, riskLevel: "minimal" },
  { pattern: /\b(cancel|abort|stop operation|nevermind|forget it)\b/i, category: "cancel", weight: 1.0, riskLevel: "minimal" },
  { pattern: /\b(yes|confirm|proceed|go ahead|do it|approved|ok|okay)\b/i, category: "confirm", weight: 0.8, riskLevel: "minimal" },
  { pattern: /\b(no|deny|reject|don't|stop|wait)\b/i, category: "cancel", weight: 0.7, riskLevel: "minimal" },
  { pattern: /\b(what do you mean|clarify|explain|which one|be more specific)\b/i, category: "clarify", weight: 1.0, riskLevel: "minimal" },
];

// Resource type patterns
const RESOURCE_TYPE_PATTERNS: { pattern: RegExp; type: string }[] = [
  { pattern: /\b(server|instance|vm|virtual machine|ec2|compute)\b/i, type: "compute" },
  { pattern: /\b(container|pod|docker|kubernetes|k8s|ecs)\b/i, type: "container" },
  { pattern: /\b(database|db|rds|sql|mysql|postgres|mongodb|dynamodb)\b/i, type: "database" },
  { pattern: /\b(bucket|storage|s3|blob|file system|efs|gcs)\b/i, type: "storage" },
  { pattern: /\b(function|lambda|serverless|cloud function)\b/i, type: "function" },
  { pattern: /\b(load balancer|lb|alb|elb|nlb)\b/i, type: "loadbalancer" },
  { pattern: /\b(vpc|network|subnet|vnet|firewall|security group)\b/i, type: "network" },
  { pattern: /\b(queue|sqs|sns|pubsub|message|kafka)\b/i, type: "messaging" },
  { pattern: /\b(cache|redis|memcached|elasticache)\b/i, type: "cache" },
  { pattern: /\b(cdn|cloudfront|distribution)\b/i, type: "cdn" },
  { pattern: /\b(dns|route53|domain)\b/i, type: "dns" },
  { pattern: /\b(secret|vault|ssm|parameter|credential)\b/i, type: "secrets" },
  { pattern: /\b(log|cloudwatch|monitoring|metrics|alarm)\b/i, type: "monitoring" },
  { pattern: /\b(iam|role|policy|permission|user|group)\b/i, type: "iam" },
  { pattern: /\b(api|gateway|endpoint|rest|graphql)\b/i, type: "api" },
  { pattern: /\b(cluster|service|deployment|app)\b/i, type: "service" },
];

export type ConversationHistoryContext = {
  recentIntents: IntentCategory[];
  mentionedResources: string[];
  activeOperation?: string;
  pendingConfirmation?: boolean;
};

export class InfrastructureIntentClassifier {
  private config: IntentClassifierConfig;
  private patterns: IntentPattern[];

  constructor(config?: Partial<IntentClassifierConfig>) {
    this.config = { ...defaultIntentClassifierConfig, ...config };
    this.patterns = [...INTENT_PATTERNS, ...(this.config.customPatterns ?? [])];
  }

  classify(input: string, context?: ConversationContext): IntentClassificationResult {
    const normalizedInput = this.normalizeInput(input);
    const matches = this.findPatternMatches(normalizedInput);
    const resourceType = this.detectResourceType(normalizedInput);

    // Convert context to history context format
    const historyContext = context ? this.extractHistoryContext(context) : undefined;

    // Apply context boosting
    if (historyContext) {
      this.applyContextBoost(matches, historyContext);
    }

    // Sort by score and get top matches
    matches.sort((a, b) => b.score - a.score);

    if (matches.length === 0) {
      return this.createUnknownResult(normalizedInput);
    }

    const topMatch = matches[0];
    const alternatives = matches.slice(1, this.config.maxAlternatives + 1);

    // Check for ambiguity
    const isAmbiguous = alternatives.length > 0 &&
      (topMatch.score - alternatives[0].score) < this.config.ambiguityThreshold;

    // Check if clarification is needed
    const clarificationNeeded = topMatch.score < this.config.confidenceThreshold || isAmbiguous;

    const intent: InfrastructureIntent = {
      category: topMatch.category,
      confidence: topMatch.score,
      riskLevel: topMatch.riskLevel,
      subIntent: topMatch.subIntent,
      targetResourceType: resourceType ?? topMatch.targetResourceType,
    };

    const alternativeIntents: InfrastructureIntent[] = alternatives.map(a => ({
      category: a.category,
      confidence: a.score,
      riskLevel: a.riskLevel,
      subIntent: a.subIntent,
      targetResourceType: a.targetResourceType,
    }));

    return {
      intent,
      confidence: topMatch.score,
      alternatives: alternativeIntents,
      clarificationNeeded,
      clarificationQuestion: clarificationNeeded ? this.generateClarification(topMatch, alternatives, normalizedInput) : undefined,
    };
  }

  private extractHistoryContext(context: ConversationContext): HistoryContext {
    const recentIntents: IntentCategory[] = [];
    const mentionedResources: string[] = [];

    // Extract recent intents from conversation history
    if (context.conversationHistory) {
      for (const msg of context.conversationHistory.slice(-5)) {
        if (msg.role === "user") {
          const result = this.findPatternMatches(this.normalizeInput(msg.content));
          if (result.length > 0) {
            recentIntents.push(result[0].category);
          }
        }
      }
    }

    // Extract mentioned resources
    if (context.mentionedResources) {
      for (const resource of context.mentionedResources) {
        mentionedResources.push(resource.name);
      }
    }

    return {
      recentIntents,
      mentionedResources,
      pendingConfirmation: context.pendingConfirmation !== undefined,
    };
  }

  private normalizeInput(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^\w\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private findPatternMatches(input: string): PatternMatch[] {
    const matches: PatternMatch[] = [];

    for (const pattern of this.patterns) {
      const match = input.match(pattern.pattern);
      if (match) {
        const score = this.calculateScore(pattern, match, input);
        matches.push({
          category: pattern.category,
          subIntent: pattern.subIntent,
          targetResourceType: pattern.targetResourceType,
          score,
          patternText: match[0],
          riskLevel: pattern.riskLevel,
        });
      }
    }

    // Deduplicate by category, keeping highest score
    const categoryMap = new Map<IntentCategory, PatternMatch>();
    for (const match of matches) {
      const existing = categoryMap.get(match.category);
      if (!existing || match.score > existing.score) {
        categoryMap.set(match.category, match);
      }
    }

    return Array.from(categoryMap.values());
  }

  private calculateScore(pattern: IntentPattern, match: RegExpMatchArray, input: string): number {
    let score = pattern.weight;

    // Boost for longer matches (more specific)
    const matchRatio = match[0].length / input.length;
    score *= (0.5 + matchRatio * 0.5);

    // Boost for matches at the start of input
    if (input.indexOf(match[0]) < 10) {
      score *= 1.1;
    }

    // Normalize to 0-1 range
    return Math.min(1, Math.max(0, score));
  }

  private detectResourceType(input: string): string | undefined {
    for (const { pattern, type } of RESOURCE_TYPE_PATTERNS) {
      if (pattern.test(input)) {
        return type;
      }
    }
    return undefined;
  }

  private applyContextBoost(matches: PatternMatch[], context: HistoryContext): void {
    const boost = this.config.contextWeight;

    for (const match of matches) {
      // Boost if this intent follows logically from recent intents
      if (this.isLogicalFollowUp(match.category, context.recentIntents)) {
        match.score *= (1 + boost);
      }

      // Boost confirm/cancel if there's a pending confirmation
      if (context.pendingConfirmation && (match.category === "confirm" || match.category === "cancel")) {
        match.score *= (1 + boost * 2);
      }

      // Boost cancel if there's an active operation
      if (context.activeOperation && match.category === "cancel") {
        match.score *= (1 + boost);
      }
    }
  }

  private isLogicalFollowUp(intent: IntentCategory, recentIntents: IntentCategory[]): boolean {
    if (recentIntents.length === 0) return false;

    const lastIntent = recentIntents[recentIntents.length - 1];
    const logicalFollowUps: Record<IntentCategory, IntentCategory[]> = {
      list: ["describe", "delete", "update", "scale"],
      describe: ["update", "delete", "scale", "backup"],
      create: ["describe", "configure", "deploy"],
      read: ["update", "delete", "describe"],
      search: ["describe", "delete", "update"],
      diagnose: ["update", "restart", "scale"],
      restart: ["monitor", "describe", "diagnose"],
      backup: ["restore", "delete"],
      deploy: ["monitor", "rollback", "scale"],
      scale: ["monitor", "describe"],
      update: ["describe", "monitor"],
      delete: ["list", "create"],
      configure: ["deploy", "describe"],
      migrate: ["monitor", "rollback"],
      monitor: ["scale", "diagnose"],
      restore: ["describe", "monitor"],
      rollback: ["describe", "monitor"],
      help: ["create", "list", "describe"],
      confirm: ["monitor", "describe"],
      cancel: ["list", "help"],
      clarify: ["confirm", "cancel"],
      compare: ["update", "migrate"],
      unknown: [],
    };

    return logicalFollowUps[lastIntent]?.includes(intent) ?? false;
  }

  private generateClarification(topMatch: PatternMatch, alternatives: PatternMatch[], _input: string): string {
    if (alternatives.length === 0) {
      return `I'm not entirely sure what you want to do. Did you mean to ${this.categoryToAction(topMatch.category)}?`;
    }

    const options = [topMatch, ...alternatives.slice(0, 2)]
      .map(m => this.categoryToAction(m.category))
      .join(", or ");

    return `I understood a few possible actions from your request. Did you want to ${options}?`;
  }

  private categoryToAction(category: IntentCategory): string {
    const actions: Record<IntentCategory, string> = {
      create: "create a new resource",
      read: "view resource information",
      update: "update a resource",
      delete: "delete a resource",
      scale: "scale a resource",
      deploy: "deploy changes",
      rollback: "rollback to a previous version",
      backup: "create a backup",
      restore: "restore from a backup",
      monitor: "monitor resources",
      diagnose: "diagnose an issue",
      configure: "configure settings",
      migrate: "migrate resources",
      list: "list resources",
      describe: "get details about a resource",
      compare: "compare resources",
      search: "search for resources",
      restart: "restart a resource",
      help: "get help",
      cancel: "cancel the operation",
      confirm: "confirm the operation",
      clarify: "get clarification",
      unknown: "perform an action",
    };
    return actions[category];
  }

  private createUnknownResult(_input: string): IntentClassificationResult {
    return {
      intent: {
        category: "unknown",
        confidence: 0,
        riskLevel: "minimal",
      },
      confidence: 0,
      alternatives: [],
      clarificationNeeded: true,
      clarificationQuestion: "I couldn't understand your request. Could you please rephrase it? For example, you can say 'create a new server' or 'show me all databases'.",
    };
  }
}

type PatternMatch = {
  category: IntentCategory;
  subIntent?: string;
  targetResourceType?: string;
  score: number;
  patternText: string;
  riskLevel: RiskLevel;
};

type HistoryContext = {
  recentIntents: IntentCategory[];
  mentionedResources: string[];
  activeOperation?: string;
  pendingConfirmation?: boolean;
};

export function createIntentClassifier(config?: Partial<IntentClassifierConfig>): InfrastructureIntentClassifier {
  return new InfrastructureIntentClassifier(config);
}

export function classifyIntent(input: string, context?: ConversationContext, config?: Partial<IntentClassifierConfig>): IntentClassificationResult {
  return createIntentClassifier(config).classify(input, context);
}
