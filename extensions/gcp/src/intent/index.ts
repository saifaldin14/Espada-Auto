/**
 * GCP Intent Manager
 *
 * Classifies natural-language user input into structured GCP
 * operation intents. Maps conversational phrases to specific
 * cloud resource actions, services, and parameters.
 */

// =============================================================================
// Types
// =============================================================================

export type IntentCategory =
  | "compute"
  | "storage"
  | "database"
  | "networking"
  | "containers"
  | "serverless"
  | "security"
  | "iam"
  | "billing"
  | "monitoring"
  | "deployment"
  | "general"
  | "unknown";

export type IntentAction =
  | "list"
  | "get"
  | "create"
  | "update"
  | "delete"
  | "start"
  | "stop"
  | "restart"
  | "scale"
  | "deploy"
  | "describe"
  | "diagnose"
  | "cost"
  | "help"
  | "unknown";

export type ExtractedParameter = {
  name: string;
  value: string;
  confidence: number;
  source: "explicit" | "inferred" | "default";
};

export type ClassifiedIntent = {
  category: IntentCategory;
  action: IntentAction;
  service: string;
  resourceType: string;
  parameters: ExtractedParameter[];
  confidence: number;
  rawInput: string;
  alternatives: Array<{
    category: IntentCategory;
    action: IntentAction;
    confidence: number;
  }>;
};

export type IntentPattern = {
  patterns: RegExp[];
  category: IntentCategory;
  action: IntentAction;
  service: string;
  resourceType: string;
  parameterExtractors?: Array<{
    name: string;
    pattern: RegExp;
    required: boolean;
  }>;
};

// =============================================================================
// Built-in patterns
// =============================================================================

const INTENT_PATTERNS: IntentPattern[] = [
  // Compute
  {
    patterns: [/list\s+(vm|instance|server|machine)s?/i, /show\s+(all\s+)?(vm|instance|server)s?/i, /get\s+(vm|instance)s/i],
    category: "compute",
    action: "list",
    service: "compute",
    resourceType: "Instance",
    parameterExtractors: [{ name: "zone", pattern: /(?:in|zone)\s+([a-z]+-[a-z]+\d-[a-z])/i, required: false }],
  },
  {
    patterns: [/create\s+(a\s+)?(vm|instance|server)/i, /launch\s+(a\s+)?(vm|instance)/i, /spin\s+up\s+(a\s+)?(vm|instance)/i],
    category: "compute",
    action: "create",
    service: "compute",
    resourceType: "Instance",
    parameterExtractors: [
      { name: "name", pattern: /(?:named?|called)\s+["']?(\S+)["']?/i, required: false },
      { name: "machineType", pattern: /(?:type|size)\s+["']?([a-z]\d-\w+)["']?/i, required: false },
      { name: "zone", pattern: /(?:in|zone)\s+([a-z]+-[a-z]+\d-[a-z])/i, required: false },
    ],
  },
  {
    patterns: [/(?:stop|shut\s*down)\s+(the\s+)?(vm|instance|server)/i],
    category: "compute",
    action: "stop",
    service: "compute",
    resourceType: "Instance",
    parameterExtractors: [{ name: "name", pattern: /(?:named?|called)\s+["']?(\S+)["']?/i, required: false }],
  },
  {
    patterns: [/(?:start|boot)\s+(the\s+)?(vm|instance|server)/i],
    category: "compute",
    action: "start",
    service: "compute",
    resourceType: "Instance",
  },
  {
    patterns: [/delete\s+(the\s+)?(vm|instance|server)/i, /remove\s+(the\s+)?(vm|instance|server)/i],
    category: "compute",
    action: "delete",
    service: "compute",
    resourceType: "Instance",
  },

  // Storage
  {
    patterns: [/list\s+(bucket|storage)s?/i, /show\s+(all\s+)?buckets/i],
    category: "storage",
    action: "list",
    service: "storage",
    resourceType: "Bucket",
  },
  {
    patterns: [/create\s+(a\s+)?bucket/i, /make\s+(a\s+)?bucket/i],
    category: "storage",
    action: "create",
    service: "storage",
    resourceType: "Bucket",
    parameterExtractors: [
      { name: "name", pattern: /(?:named?|called)\s+["']?(\S+)["']?/i, required: false },
      { name: "location", pattern: /(?:in|location|region)\s+["']?([A-Z-]+\d?)["']?/i, required: false },
    ],
  },
  {
    patterns: [/delete\s+(the\s+)?bucket/i, /remove\s+(the\s+)?bucket/i],
    category: "storage",
    action: "delete",
    service: "storage",
    resourceType: "Bucket",
  },

  // Database
  {
    patterns: [/list\s+(database|sql|cloudsql)\s*(instance)?s?/i, /show\s+(all\s+)?(database|sql)/i],
    category: "database",
    action: "list",
    service: "sqladmin",
    resourceType: "Instance",
  },
  {
    patterns: [/create\s+(a\s+)?(database|sql|cloudsql)/i],
    category: "database",
    action: "create",
    service: "sqladmin",
    resourceType: "Instance",
  },

  // Containers / GKE
  {
    patterns: [/list\s+(cluster|gke|kubernetes)s?/i, /show\s+(all\s+)?clusters/i],
    category: "containers",
    action: "list",
    service: "container",
    resourceType: "Cluster",
    parameterExtractors: [{ name: "region", pattern: /(?:in|region)\s+([a-z]+-[a-z]+\d)/i, required: false }],
  },
  {
    patterns: [/create\s+(a\s+)?(cluster|gke)/i, /provision\s+(a\s+)?cluster/i],
    category: "containers",
    action: "create",
    service: "container",
    resourceType: "Cluster",
  },
  {
    patterns: [/scale\s+(the\s+)?cluster/i, /resize\s+(the\s+)?cluster/i],
    category: "containers",
    action: "scale",
    service: "container",
    resourceType: "Cluster",
  },

  // Serverless
  {
    patterns: [/list\s+(cloud\s+)?run\s+services?/i, /show\s+(all\s+)?(cloud\s+)?run/i],
    category: "serverless",
    action: "list",
    service: "run",
    resourceType: "Service",
  },
  {
    patterns: [/deploy\s+(?:to\s+)?(cloud\s+)?run/i, /create\s+(a\s+)?cloud\s+run/i],
    category: "serverless",
    action: "deploy",
    service: "run",
    resourceType: "Service",
  },
  {
    patterns: [/list\s+(cloud\s+)?functions?/i, /show\s+(all\s+)?functions/i],
    category: "serverless",
    action: "list",
    service: "cloudfunctions",
    resourceType: "Function",
  },

  // Security
  {
    patterns: [/(?:check|scan|audit)\s+security/i, /security\s+(?:check|scan|audit|posture)/i],
    category: "security",
    action: "diagnose",
    service: "securitycenter",
    resourceType: "Finding",
  },
  {
    patterns: [/list\s+(?:security\s+)?findings?/i, /show\s+(?:security\s+)?vulnerabilit/i],
    category: "security",
    action: "list",
    service: "securitycenter",
    resourceType: "Finding",
  },

  // IAM
  {
    patterns: [/list\s+(?:iam\s+)?(?:role|permission|binding)s?/i, /show\s+(?:iam|access)/i, /who\s+has\s+access/i],
    category: "iam",
    action: "list",
    service: "iam",
    resourceType: "Policy",
  },
  {
    patterns: [/(?:grant|add)\s+(?:iam\s+)?(?:role|access|permission)/i],
    category: "iam",
    action: "create",
    service: "iam",
    resourceType: "Binding",
  },
  {
    patterns: [/(?:revoke|remove)\s+(?:iam\s+)?(?:role|access|permission)/i],
    category: "iam",
    action: "delete",
    service: "iam",
    resourceType: "Binding",
  },

  // Billing
  {
    patterns: [/(?:how much|cost|spend|bill|pricing)/i, /show\s+(?:my\s+)?(?:cost|bill|spend)/i],
    category: "billing",
    action: "cost",
    service: "billing",
    resourceType: "BillingInfo",
  },

  // Monitoring
  {
    patterns: [/(?:check|show|get)\s+(?:metric|monitor|alert|log)s?/i, /what.*(?:status|health)/i],
    category: "monitoring",
    action: "describe",
    service: "monitoring",
    resourceType: "Metric",
  },

  // Deployment
  {
    patterns: [/deploy\s+(?:an?\s+)?(?:app|service|application)/i, /push\s+to\s+(?:prod|production|staging)/i],
    category: "deployment",
    action: "deploy",
    service: "deploy",
    resourceType: "Deployment",
  },

  // Help
  {
    patterns: [/(?:help|what can you do|how do i|show commands)/i],
    category: "general",
    action: "help",
    service: "general",
    resourceType: "",
  },
];

// =============================================================================
// Manager
// =============================================================================

export class GcpIntentManager {
  private patterns: IntentPattern[];
  private confidenceThreshold: number;

  constructor(customPatterns?: IntentPattern[], confidenceThreshold?: number) {
    this.patterns = [...INTENT_PATTERNS, ...(customPatterns ?? [])];
    this.confidenceThreshold = confidenceThreshold ?? 0.3;
  }

  classify(input: string): ClassifiedIntent {
    const normalized = input.trim();
    const matches: Array<{ pattern: IntentPattern; confidence: number }> = [];

    for (const ip of this.patterns) {
      for (const regex of ip.patterns) {
        const match = regex.exec(normalized);
        if (match) {
          const matchLength = match[0].length;
          const confidence = Math.min(0.95, 0.4 + (matchLength / normalized.length) * 0.5);
          matches.push({ pattern: ip, confidence });
          break;
        }
      }
    }

    matches.sort((a, b) => b.confidence - a.confidence);
    const best = matches[0];

    if (!best || best.confidence < this.confidenceThreshold) {
      return {
        category: "unknown",
        action: "unknown",
        service: "",
        resourceType: "",
        parameters: [],
        confidence: 0,
        rawInput: normalized,
        alternatives: [],
      };
    }

    const parameters = this.extractParameters(normalized, best.pattern);
    const alternatives = matches.slice(1, 4).map((m) => ({
      category: m.pattern.category,
      action: m.pattern.action,
      confidence: Math.round(m.confidence * 100) / 100,
    }));

    return {
      category: best.pattern.category,
      action: best.pattern.action,
      service: best.pattern.service,
      resourceType: best.pattern.resourceType,
      parameters,
      confidence: Math.round(best.confidence * 100) / 100,
      rawInput: normalized,
      alternatives,
    };
  }

  addPattern(pattern: IntentPattern): void {
    this.patterns.push(pattern);
  }

  removePatterns(category: IntentCategory): number {
    const before = this.patterns.length;
    this.patterns = this.patterns.filter((p) => p.category !== category);
    return before - this.patterns.length;
  }

  listCategories(): IntentCategory[] {
    return [...new Set(this.patterns.map((p) => p.category))];
  }

  listActions(category?: IntentCategory): IntentAction[] {
    const filtered = category
      ? this.patterns.filter((p) => p.category === category)
      : this.patterns;
    return [...new Set(filtered.map((p) => p.action))];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private extractParameters(input: string, pattern: IntentPattern): ExtractedParameter[] {
    if (!pattern.parameterExtractors) return [];

    const params: ExtractedParameter[] = [];
    for (const extractor of pattern.parameterExtractors) {
      const match = extractor.pattern.exec(input);
      if (match?.[1]) {
        params.push({
          name: extractor.name,
          value: match[1],
          confidence: 0.8,
          source: "explicit",
        });
      }
    }
    return params;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createIntentManager(
  customPatterns?: IntentPattern[],
  confidenceThreshold?: number,
): GcpIntentManager {
  return new GcpIntentManager(customPatterns, confidenceThreshold);
}
