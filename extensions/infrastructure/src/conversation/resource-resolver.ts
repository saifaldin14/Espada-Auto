/**
 * Infrastructure Resource Name Resolution
 */

import type {
  ResourceReference,
  ResolvedResource,
  ResourceResolutionResult,
  ResolutionContext,
} from "./types.js";
import type { Environment } from "../security/types.js";

export type ResourcePattern = {
  resourceType: string;
  patterns: RegExp[];
  idFormats: RegExp[];
  arnPattern?: RegExp;
  aliases: string[];
  examples: string[];
};

export type ResourceResolverConfig = {
  enableFuzzyMatching: boolean;
  fuzzyThreshold: number;
  maxSuggestions: number;
  enableCaching: boolean;
  cacheMaxAge: number;
  defaultEnvironment: Environment;
};

export const defaultResolverConfig: ResourceResolverConfig = {
  enableFuzzyMatching: true,
  fuzzyThreshold: 0.6,
  maxSuggestions: 5,
  enableCaching: true,
  cacheMaxAge: 300000, // 5 minutes
  defaultEnvironment: "development",
};

// Resource type patterns for identification
const RESOURCE_PATTERNS: ResourcePattern[] = [
  {
    resourceType: "compute",
    patterns: [
      /(?:instance|server|vm|virtual machine|ec2|compute)/i,
    ],
    idFormats: [
      /^i-[a-f0-9]{8,17}$/i, // EC2 instance ID
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, // UUID
    ],
    arnPattern: /arn:aws:ec2:[a-z0-9-]+:[0-9]+:instance\/i-[a-f0-9]+/i,
    aliases: ["server", "box", "machine", "node", "host"],
    examples: ["my-web-server", "i-1234567890abcdef0"],
  },
  {
    resourceType: "container",
    patterns: [
      /(?:container|docker|pod|ecs|fargate|k8s|kubernetes)/i,
    ],
    idFormats: [
      /^[a-f0-9]{12,64}$/i, // Docker container ID
      /^[a-z][a-z0-9-]+$/i, // Named container/pod
    ],
    arnPattern: /arn:aws:ecs:[a-z0-9-]+:[0-9]+:task\/[a-z0-9-]+\/[a-f0-9]+/i,
    aliases: ["pod", "task", "container"],
    examples: ["my-api-container", "web-service-pod"],
  },
  {
    resourceType: "database",
    patterns: [
      /(?:database|db|rds|postgres|mysql|mongo|dynamo|sql)/i,
    ],
    idFormats: [
      /^[a-z][a-z0-9-]+$/i,
    ],
    arnPattern: /arn:aws:rds:[a-z0-9-]+:[0-9]+:db:[a-z0-9-]+/i,
    aliases: ["db", "datastore", "rds", "postgres", "mysql"],
    examples: ["production-db", "users-database"],
  },
  {
    resourceType: "storage",
    patterns: [
      /(?:bucket|s3|storage|blob|file system|efs)/i,
    ],
    idFormats: [
      /^[a-z0-9][a-z0-9.-]+[a-z0-9]$/i, // S3 bucket name
    ],
    arnPattern: /arn:aws:s3:::[a-z0-9.-]+/i,
    aliases: ["bucket", "blob", "object storage"],
    examples: ["my-app-assets", "backup-bucket"],
  },
  {
    resourceType: "function",
    patterns: [
      /(?:lambda|function|serverless|cloud function)/i,
    ],
    idFormats: [
      /^[a-zA-Z][a-zA-Z0-9_-]+$/,
    ],
    arnPattern: /arn:aws:lambda:[a-z0-9-]+:[0-9]+:function:[a-zA-Z0-9_-]+/i,
    aliases: ["lambda", "serverless function"],
    examples: ["process-order", "send-notification"],
  },
  {
    resourceType: "loadbalancer",
    patterns: [
      /(?:load ?balancer|elb|alb|nlb|lb)/i,
    ],
    idFormats: [
      /^[a-z][a-z0-9-]+$/i,
    ],
    arnPattern: /arn:aws:elasticloadbalancing:[a-z0-9-]+:[0-9]+:loadbalancer\/[a-z]+\/[a-z0-9-]+\/[a-f0-9]+/i,
    aliases: ["lb", "balancer", "alb", "elb"],
    examples: ["api-load-balancer", "web-alb"],
  },
  {
    resourceType: "queue",
    patterns: [
      /(?:queue|sqs|message queue|mq)/i,
    ],
    idFormats: [
      /^[a-zA-Z0-9_-]+$/,
    ],
    arnPattern: /arn:aws:sqs:[a-z0-9-]+:[0-9]+:[a-zA-Z0-9_-]+/i,
    aliases: ["message queue", "sqs"],
    examples: ["order-processing-queue", "notification-queue"],
  },
  {
    resourceType: "cache",
    patterns: [
      /(?:cache|redis|memcache|elasticache)/i,
    ],
    idFormats: [
      /^[a-z][a-z0-9-]+$/i,
    ],
    arnPattern: /arn:aws:elasticache:[a-z0-9-]+:[0-9]+:cluster:[a-z0-9-]+/i,
    aliases: ["redis", "memcached", "elasticache"],
    examples: ["session-cache", "api-cache"],
  },
  {
    resourceType: "network",
    patterns: [
      /(?:vpc|network|subnet|security group|sg)/i,
    ],
    idFormats: [
      /^vpc-[a-f0-9]+$/i,
      /^subnet-[a-f0-9]+$/i,
      /^sg-[a-f0-9]+$/i,
    ],
    arnPattern: /arn:aws:ec2:[a-z0-9-]+:[0-9]+:(?:vpc|subnet|security-group)\/[a-z0-9-]+/i,
    aliases: ["vpc", "subnet", "security group"],
    examples: ["main-vpc", "private-subnet"],
  },
  {
    resourceType: "service",
    patterns: [
      /(?:service|app|application|microservice)/i,
    ],
    idFormats: [
      /^[a-z][a-z0-9-]+$/i,
    ],
    arnPattern: /arn:aws:ecs:[a-z0-9-]+:[0-9]+:service\/[a-z0-9-]+\/[a-z0-9-]+/i,
    aliases: ["app", "microservice", "api"],
    examples: ["user-service", "payment-api"],
  },
];

// Reference resolution patterns
const REFERENCE_PATTERNS: { pattern: RegExp; type: string }[] = [
  { pattern: /(?:the|that|this)\s+(\w+(?:\s+\w+)?)\s+(?:we|you|I)\s+(?:just\s+)?(?:created|made|deployed)/i, type: "recent-create" },
  { pattern: /(?:the|that|this)\s+(\w+(?:\s+\w+)?)\s+from\s+(?:earlier|before|last time)/i, type: "temporal" },
  { pattern: /(?:the|that)\s+same\s+(\w+(?:\s+\w+)?)/i, type: "same-as-previous" },
  { pattern: /(?:my|our)\s+(\w+(?:\s+\w+)?)\s+(?:named?|called?)\s+["']?([a-z][a-z0-9-_]+)["']?/i, type: "named" },
  { pattern: /(?:the\s+)?(\w+(?:\s+\w+)?)\s+(?:in|on|at)\s+(\w+)/i, type: "location-scoped" },
];

type CacheEntry = {
  resource: ResolvedResource;
  timestamp: number;
};

export class InfrastructureResourceResolver {
  private config: ResourceResolverConfig;
  private cache: Map<string, CacheEntry>;
  private recentResources: ResolvedResource[];

  constructor(config?: Partial<ResourceResolverConfig>) {
    this.config = { ...defaultResolverConfig, ...config };
    this.cache = new Map();
    this.recentResources = [];
  }

  resolve(reference: ResourceReference, context?: ResolutionContext): ResourceResolutionResult {
    const normalizedRef = this.normalizeReference(reference.rawText);

    // Check cache first
    if (this.config.enableCaching) {
      const cached = this.checkCache(normalizedRef);
      if (cached) {
        return {
          resolved: true,
          resource: cached,
          confidence: 0.95,
          method: "cache",
        };
      }
    }

    // Try exact ID match
    const idMatch = this.resolveById(reference);
    if (idMatch.resolved) {
      this.addToCache(normalizedRef, idMatch.resource!);
      return idMatch;
    }

    // Try contextual resolution (pronouns, references) BEFORE name-based
    // This ensures "it", "that", etc. resolve to context rather than as names
    const contextMatch = this.resolveByContext(reference, context);
    if (contextMatch.resolved) {
      return contextMatch;
    }

    // Try name-based resolution
    const nameMatch = this.resolveByName(reference, context);
    if (nameMatch.resolved) {
      this.addToCache(normalizedRef, nameMatch.resource!);
      return nameMatch;
    }

    // Try fuzzy matching if enabled
    if (this.config.enableFuzzyMatching) {
      const fuzzyMatch = this.resolveFuzzy(reference, context);
      if (fuzzyMatch.resolved) {
        return fuzzyMatch;
      }
    }

    // Generate suggestions for ambiguous references
    const suggestions = this.generateSuggestions(reference, context);
    return {
      resolved: false,
      confidence: 0,
      method: "failed",
      suggestions,
      clarificationQuestion: this.generateClarificationQuestion(reference, suggestions),
    };
  }

  private normalizeReference(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/['"]/g, "")
      .replace(/\s+/g, " ");
  }

  private checkCache(key: string): ResolvedResource | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.config.cacheMaxAge) {
      this.cache.delete(key);
      return null;
    }

    return entry.resource;
  }

  private addToCache(key: string, resource: ResolvedResource): void {
    this.cache.set(key, {
      resource,
      timestamp: Date.now(),
    });
    this.recentResources.unshift(resource);
    if (this.recentResources.length > 10) {
      this.recentResources.pop();
    }
  }

  private resolveById(reference: ResourceReference): ResourceResolutionResult {
    const text = reference.rawText.trim();

    for (const pattern of RESOURCE_PATTERNS) {
      // Check direct ID format
      for (const idFormat of pattern.idFormats) {
        if (idFormat.test(text)) {
          return {
            resolved: true,
            resource: {
              id: text,
              name: text,
              type: pattern.resourceType,
              environment: this.config.defaultEnvironment,
              status: "unknown",
            },
            confidence: 0.95,
            method: "id-match",
          };
        }
      }

      // Check ARN format
      if (pattern.arnPattern?.test(text)) {
        const arnParts = this.parseArn(text);
        return {
          resolved: true,
          resource: {
            id: text,
            name: arnParts?.resourceId ?? text,
            type: pattern.resourceType,
            arn: text,
            region: arnParts?.region,
            environment: this.config.defaultEnvironment,
            status: "unknown",
          },
          confidence: 0.98,
          method: "arn-match",
        };
      }
    }

    return { resolved: false, confidence: 0, method: "id-match" };
  }

  private parseArn(arn: string): { region?: string; accountId?: string; resourceId?: string } | null {
    const parts = arn.split(":");
    if (parts.length < 6) return null;

    return {
      region: parts[3] || undefined,
      accountId: parts[4] || undefined,
      resourceId: parts.slice(5).join(":").split("/").pop(),
    };
  }

  private resolveByName(reference: ResourceReference, context?: ResolutionContext): ResourceResolutionResult {
    const text = this.normalizeReference(reference.rawText);

    // Detect resource type from text
    let detectedType: string | undefined;
    for (const pattern of RESOURCE_PATTERNS) {
      for (const typePattern of pattern.patterns) {
        if (typePattern.test(text)) {
          detectedType = pattern.resourceType;
          break;
        }
      }
      if (!detectedType) {
        for (const alias of pattern.aliases) {
          if (text.includes(alias)) {
            detectedType = pattern.resourceType;
            break;
          }
        }
      }
      if (detectedType) break;
    }

    // Extract name from reference
    const nameMatch = text.match(/(?:named?|called?)\s+["']?([a-z][a-z0-9-_]+)["']?/i) ??
                      text.match(/["']([a-z][a-z0-9-_]+)["']/i) ??
                      text.match(/^([a-z][a-z0-9-_]+)$/i);

    if (nameMatch) {
      const resourceName = nameMatch[1];
      return {
        resolved: true,
        resource: {
          id: resourceName, // In a real system, this would be looked up
          name: resourceName,
          type: detectedType ?? reference.resourceType ?? "unknown",
          environment: context?.environment ?? this.config.defaultEnvironment,
          status: "unknown",
        },
        confidence: 0.75,
        method: "name-match",
      };
    }

    return { resolved: false, confidence: 0, method: "name-match" };
  }

  private resolveByContext(reference: ResourceReference, context?: ResolutionContext): ResourceResolutionResult {
    const text = this.normalizeReference(reference.rawText);

    for (const refPattern of REFERENCE_PATTERNS) {
      const match = text.match(refPattern.pattern);
      if (match) {
        switch (refPattern.type) {
          case "recent-create": {
            // Look in recent resources for matches
            const typeHint = match[1]?.toLowerCase();
            const recent = this.recentResources.find(r =>
              r.type.includes(typeHint) || typeHint.includes(r.type)
            );
            if (recent) {
              return {
                resolved: true,
                resource: recent,
                confidence: 0.8,
                method: "context-recent",
              };
            }
            break;
          }
          case "same-as-previous": {
            if (context?.previousResources?.length) {
              return {
                resolved: true,
                resource: context.previousResources[0],
                confidence: 0.85,
                method: "context-same",
              };
            }
            break;
          }
          case "named": {
            const resourceType = match[1];
            const resourceName = match[2];
            return {
              resolved: true,
              resource: {
                id: resourceName,
                name: resourceName,
                type: this.detectResourceType(resourceType) ?? "unknown",
                environment: context?.environment ?? this.config.defaultEnvironment,
                status: "unknown",
              },
              confidence: 0.85,
              method: "context-named",
            };
          }
          case "location-scoped": {
            const resourceType = match[1];
            const location = match[2];
            // Check if location is an environment
            const env = this.detectEnvironment(location);
            const type = this.detectResourceType(resourceType);
            return {
              resolved: false,
              confidence: 0.5,
              method: "context-location",
              clarificationQuestion: `Which ${type ?? "resource"} in ${env ?? location} are you referring to?`,
            };
          }
        }
      }
    }

    // Check for pronouns referencing recent resources
    if (/^(it|that|this|the same one|that one)$/i.test(text)) {
      if (context?.previousResources?.length) {
        return {
          resolved: true,
          resource: context.previousResources[0],
          confidence: 0.7,
          method: "context-pronoun",
        };
      }
      if (this.recentResources.length > 0) {
        return {
          resolved: true,
          resource: this.recentResources[0],
          confidence: 0.6,
          method: "context-pronoun-recent",
        };
      }
    }

    return { resolved: false, confidence: 0, method: "context" };
  }

  private resolveFuzzy(reference: ResourceReference, context?: ResolutionContext): ResourceResolutionResult {
    const text = this.normalizeReference(reference.rawText);
    const candidates: { resource: ResolvedResource; score: number }[] = [];

    // Compare against recent resources
    for (const recent of this.recentResources) {
      const similarity = this.calculateSimilarity(text, recent.name);
      if (similarity >= this.config.fuzzyThreshold) {
        candidates.push({ resource: recent, score: similarity });
      }
    }

    // Compare against context resources
    if (context?.previousResources) {
      for (const prev of context.previousResources) {
        const similarity = this.calculateSimilarity(text, prev.name);
        if (similarity >= this.config.fuzzyThreshold) {
          candidates.push({ resource: prev, score: similarity });
        }
      }
    }

    if (candidates.length === 0) {
      return { resolved: false, confidence: 0, method: "fuzzy" };
    }

    // Sort by similarity score
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 1 || candidates[0].score - candidates[1].score > 0.2) {
      return {
        resolved: true,
        resource: candidates[0].resource,
        confidence: candidates[0].score * 0.9,
        method: "fuzzy",
      };
    }

    // Multiple close matches - ambiguous
    return {
      resolved: false,
      confidence: candidates[0].score * 0.5,
      method: "fuzzy",
      ambiguousResources: candidates.slice(0, this.config.maxSuggestions).map(c => ({
        resource: c.resource,
        similarity: c.score,
      })),
      clarificationQuestion: this.generateAmbiguityQuestion(candidates.slice(0, 3).map(c => c.resource)),
    };
  }

  private calculateSimilarity(a: string, b: string): number {
    // Levenshtein distance based similarity
    const lenA = a.length;
    const lenB = b.length;
    const maxLen = Math.max(lenA, lenB);
    if (maxLen === 0) return 1;

    const matrix: number[][] = [];
    for (let i = 0; i <= lenA; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= lenB; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= lenA; i++) {
      for (let j = 1; j <= lenB; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return 1 - matrix[lenA][lenB] / maxLen;
  }

  private detectResourceType(text: string): string | undefined {
    const normalized = text.toLowerCase();
    for (const pattern of RESOURCE_PATTERNS) {
      if (pattern.resourceType.includes(normalized) || normalized.includes(pattern.resourceType)) {
        return pattern.resourceType;
      }
      for (const alias of pattern.aliases) {
        if (normalized.includes(alias)) {
          return pattern.resourceType;
        }
      }
    }
    return undefined;
  }

  private detectEnvironment(text: string): Environment | undefined {
    const envMap: Record<string, Environment> = {
      "prod": "production", "production": "production",
      "stage": "staging", "staging": "staging",
      "dev": "development", "development": "development",
      "test": "development",
    };
    return envMap[text.toLowerCase()];
  }

  private generateSuggestions(reference: ResourceReference, _context?: ResolutionContext): ResolvedResource[] {
    const suggestions: ResolvedResource[] = [];
    const typeHint = reference.resourceType ?? this.detectResourceType(reference.rawText);

    // Add recent resources of matching type
    for (const recent of this.recentResources) {
      if (!typeHint || recent.type === typeHint) {
        suggestions.push(recent);
      }
      if (suggestions.length >= this.config.maxSuggestions) break;
    }

    return suggestions;
  }

  private generateClarificationQuestion(reference: ResourceReference, suggestions: ResolvedResource[]): string {
    const typeHint = reference.resourceType ?? "resource";

    if (suggestions.length === 0) {
      return `I couldn't find a ${typeHint} matching "${reference.rawText}". Could you provide the exact name or ID?`;
    }

    const suggestionList = suggestions.map(s => `"${s.name}" (${s.type})`).join(", ");
    return `I found multiple ${typeHint}s that might match: ${suggestionList}. Which one did you mean?`;
  }

  private generateAmbiguityQuestion(resources: ResolvedResource[]): string {
    const list = resources.map(r => `"${r.name}" (${r.type})`).join(", ");
    return `Did you mean: ${list}?`;
  }

  addRecentResource(resource: ResolvedResource): void {
    this.recentResources.unshift(resource);
    if (this.recentResources.length > 10) {
      this.recentResources.pop();
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export function createResourceResolver(config?: Partial<ResourceResolverConfig>): InfrastructureResourceResolver {
  return new InfrastructureResourceResolver(config);
}

export function resolveResource(
  reference: ResourceReference,
  context?: ResolutionContext,
  config?: Partial<ResourceResolverConfig>
): ResourceResolutionResult {
  return createResourceResolver(config).resolve(reference, context);
}
