/**
 * Infrastructure Knowledge Graph — Natural Language → IQL Translation (P2.20)
 *
 * Template-based NL→IQL translator that converts natural language infrastructure
 * queries into IQL without requiring an LLM. Uses pattern matching with
 * predefined templates for common query patterns.
 *
 * For queries that don't match any template, returns a structured error with
 * suggestions. An LLM-based translator can be layered on top for free-form
 * queries.
 */

import { parseIQL } from "../iql/index.js";
import type { IQLQuery } from "../iql/index.js";

// =============================================================================
// Types
// =============================================================================

/** Result of NL→IQL translation. */
export type NLTranslationResult = {
  /** Whether translation succeeded. */
  success: boolean;
  /** The generated IQL query string (null on failure). */
  iql: string | null;
  /** Parsed AST (null on failure). */
  ast: IQLQuery | null;
  /** Which template matched (null if none). */
  matchedTemplate: string | null;
  /** Confidence score (0–1). */
  confidence: number;
  /** Explanation of what was translated. */
  explanation: string;
  /** Suggestions if translation failed. */
  suggestions?: string[];
};

/** A translation template. */
type TranslationTemplate = {
  /** Template name (for debugging). */
  name: string;
  /** Regex patterns that trigger this template (tested against normalized input). */
  patterns: RegExp[];
  /** Function that generates IQL from regex match groups. */
  generate: (match: RegExpMatchArray, input: string) => string;
  /** Confidence score for this template. */
  confidence: number;
};

// =============================================================================
// Vocabulary Maps
// =============================================================================

/** Map natural language resource terms to IQL resource types. */
const RESOURCE_TYPE_MAP: Record<string, string> = {
  // Compute
  server: "compute",
  servers: "compute",
  instance: "compute",
  instances: "compute",
  ec2: "compute",
  vm: "compute",
  vms: "compute",
  "virtual machine": "compute",
  "virtual machines": "compute",
  machine: "compute",
  machines: "compute",
  // Database
  database: "database",
  databases: "database",
  db: "database",
  dbs: "database",
  rds: "database",
  // Storage
  storage: "storage",
  bucket: "storage",
  buckets: "storage",
  s3: "storage",
  blob: "storage",
  disk: "storage",
  disks: "storage",
  volume: "storage",
  volumes: "storage",
  // Network
  network: "network",
  networks: "network",
  vpc: "vpc",
  vpcs: "vpc",
  subnet: "subnet",
  subnets: "subnet",
  "security group": "security-group",
  "security groups": "security-group",
  firewall: "security-group",
  // Load balancer
  "load balancer": "load-balancer",
  "load balancers": "load-balancer",
  lb: "load-balancer",
  lbs: "load-balancer",
  elb: "load-balancer",
  alb: "load-balancer",
  nlb: "load-balancer",
  // Function
  function: "function",
  functions: "function",
  lambda: "function",
  lambdas: "function",
  // Container
  container: "container",
  containers: "container",
  pod: "container",
  pods: "container",
  // Cluster
  cluster: "cluster",
  clusters: "cluster",
  eks: "cluster",
  ecs: "cluster",
  aks: "cluster",
  gke: "cluster",
  kubernetes: "cluster",
  k8s: "cluster",
  // Queue
  queue: "queue",
  queues: "queue",
  sqs: "queue",
  // Cache
  cache: "cache",
  caches: "cache",
  redis: "cache",
  elasticache: "cache",
  memcached: "cache",
  // DNS
  dns: "dns",
  "dns record": "dns",
  "dns records": "dns",
  route53: "dns",
  // API Gateway
  api: "api-gateway",
  apis: "api-gateway",
  "api gateway": "api-gateway",
  "api gateways": "api-gateway",
  // Certificate
  certificate: "certificate",
  certificates: "certificate",
  cert: "certificate",
  certs: "certificate",
  ssl: "certificate",
  tls: "certificate",
  // CDN
  cdn: "cdn",
  cdns: "cdn",
  cloudfront: "cdn",
  // IAM
  role: "iam-role",
  roles: "iam-role",
  "iam role": "iam-role",
  "iam roles": "iam-role",
  // Secret
  secret: "secret",
  secrets: "secret",
};

/** Map natural language status terms to node statuses. */
const STATUS_MAP: Record<string, string> = {
  running: "running",
  active: "running",
  up: "running",
  online: "running",
  live: "running",
  stopped: "stopped",
  inactive: "stopped",
  down: "stopped",
  offline: "stopped",
  pending: "pending",
  starting: "pending",
  creating: "creating",
  deleting: "deleting",
  deleted: "deleted",
  error: "error",
  failed: "error",
  unhealthy: "error",
  missing: "disappeared",
  disappeared: "disappeared",
  gone: "disappeared",
};

/** Map natural language provider terms. */
const PROVIDER_MAP: Record<string, string> = {
  aws: "aws",
  amazon: "aws",
  "amazon web services": "aws",
  azure: "azure",
  microsoft: "azure",
  gcp: "gcp",
  google: "gcp",
  "google cloud": "gcp",
  kubernetes: "kubernetes",
  k8s: "kubernetes",
};

/** Map natural language cost terms. */
const COST_QUALIFIERS: Record<string, { op: string; value: number }> = {
  expensive: { op: ">", value: 100 },
  costly: { op: ">", value: 100 },
  "high cost": { op: ">", value: 100 },
  "high-cost": { op: ">", value: 100 },
  cheap: { op: "<", value: 10 },
  free: { op: "=", value: 0 },
  pricey: { op: ">", value: 50 },
};

// =============================================================================
// Helper Functions
// =============================================================================

/** Normalize input for pattern matching. */
function normalize(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ");
}

/** Escape double quotes in a string for safe IQL interpolation. */
function escapeIQLString(s: string): string {
  return s.replace(/"/g, '\\"');
}

/** Pre-computed sorted entries for longest-match-first resource type extraction. */
const SORTED_RESOURCE_TYPE_ENTRIES = Object.entries(RESOURCE_TYPE_MAP).sort(
  (a, b) => b[0].length - a[0].length,
);

/** Try to extract a resource type from the input. */
function extractResourceType(input: string): string | null {
  const normalized = normalize(input);
  for (const [term, type] of SORTED_RESOURCE_TYPE_ENTRIES) {
    if (normalized.includes(term)) return type;
  }
  return null;
}

/** Try to extract a provider from the input. */
function extractProvider(input: string): string | null {
  const normalized = normalize(input);
  for (const [term, provider] of Object.entries(PROVIDER_MAP)) {
    if (normalized.includes(term)) return provider;
  }
  return null;
}

/** Try to extract a status from the input. */
function extractStatus(input: string): string | null {
  const normalized = normalize(input);
  for (const [term, status] of Object.entries(STATUS_MAP)) {
    if (
      normalized.includes(term) &&
      // Avoid false matches on substrings
      new RegExp(`\\b${term}\\b`).test(normalized)
    ) {
      return status;
    }
  }
  return null;
}

/** Try to extract a cost qualifier from the input. */
function extractCostQualifier(
  input: string,
): { op: string; value: number } | null {
  const normalized = normalize(input);
  for (const [term, qualifier] of Object.entries(COST_QUALIFIERS)) {
    if (normalized.includes(term)) return qualifier;
  }
  // Check for explicit dollar amounts
  const dollarMatch = normalized.match(
    /(?:more than|over|above|greater than|costing? more than)\s*\$?(\d+)/,
  );
  if (dollarMatch) return { op: ">", value: parseInt(dollarMatch[1]!, 10) };

  const underMatch = normalized.match(
    /(?:less than|under|below|cheaper than|costing? less than)\s*\$?(\d+)/,
  );
  if (underMatch) return { op: "<", value: parseInt(underMatch[1]!, 10) };

  return null;
}

/** Try to extract a region from the input. */
function extractRegion(input: string): string | null {
  const normalized = normalize(input);
  // AWS regions
  const awsRegion = normalized.match(
    /\b(us-east-[12]|us-west-[12]|eu-west-[123]|eu-central-1|ap-southeast-[12]|ap-northeast-[123]|sa-east-1|ca-central-1|me-south-1|af-south-1)\b/,
  );
  if (awsRegion) return awsRegion[1]!;
  return null;
}

/** Try to extract an environment tag from the input. */
function extractEnvironment(input: string): string | null {
  const normalized = normalize(input);
  const envMatch = normalized.match(
    /\b(?:in\s+)?(production|prod|staging|stage|development|dev|test|testing|qa)\b/,
  );
  if (envMatch) {
    const env = envMatch[1]!;
    // Normalize to canonical forms
    if (env === "prod") return "production";
    if (env === "stage") return "staging";
    if (env === "dev") return "development";
    if (env === "testing") return "test";
    return env;
  }
  return null;
}

// =============================================================================
// Translation Templates
// =============================================================================

const TEMPLATES: TranslationTemplate[] = [
  // "show me all [resources]"
  {
    name: "list-all-resources",
    patterns: [
      /(?:show|list|find|get|display|what are)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?(.+?)(?:\s+resources?)?$/,
    ],
    generate: (_match, input) => {
      const resourceType = extractResourceType(input);
      const provider = extractProvider(input);
      const status = extractStatus(input);
      const costQ = extractCostQualifier(input);
      const env = extractEnvironment(input);
      const region = extractRegion(input);

      const conditions: string[] = [];
      if (resourceType) conditions.push(`resourceType = "${resourceType}"`);
      if (provider) conditions.push(`provider = "${provider}"`);
      if (status) conditions.push(`status = "${status}"`);
      if (costQ) conditions.push(`costMonthly ${costQ.op} ${costQ.value}`);
      if (env) conditions.push(`tags.Environment = "${env}"`);
      if (region) conditions.push(`region = "${region}"`);

      if (conditions.length === 0 && resourceType) {
        conditions.push(`resourceType = "${resourceType}"`);
      }

      return conditions.length > 0
        ? `FIND resources WHERE ${conditions.join(" AND ")}`
        : "FIND resources";
    },
    confidence: 0.85,
  },

  // "how many [resources] ..."
  {
    name: "count-resources",
    patterns: [
      /(?:how many|count|number of|total)\s+(.+?)(?:\s+(?:are there|do (?:we|i) have|exist))?$/,
    ],
    generate: (_match, input) => {
      const resourceType = extractResourceType(input);
      const provider = extractProvider(input);
      const status = extractStatus(input);
      const env = extractEnvironment(input);

      const conditions: string[] = [];
      if (resourceType) conditions.push(`resourceType = "${resourceType}"`);
      if (provider) conditions.push(`provider = "${provider}"`);
      if (status) conditions.push(`status = "${status}"`);
      if (env) conditions.push(`tags.Environment = "${env}"`);

      return conditions.length > 0
        ? `SUMMARIZE count BY resourceType WHERE ${conditions.join(" AND ")}`
        : "SUMMARIZE count BY resourceType";
    },
    confidence: 0.8,
  },

  // "what depends on [resource]" or "downstream of [resource]"
  {
    name: "downstream-dependencies",
    patterns: [
      /(?:what|which|show)\s+(?:depends on|is downstream (?:of|from)|relies on)\s+["\']?(.+?)["\']?$/,
      /(?:downstream|dependents|dependencies)\s+(?:of|for|from)\s+["\']?(.+?)["\']?$/,
    ],
    generate: (match) => {
      const target = escapeIQLString(match[1]!.trim());
      return `FIND downstream OF "${target}"`;
    },
    confidence: 0.9,
  },

  // "what does [resource] depend on" or "upstream of [resource]"
  {
    name: "upstream-dependencies",
    patterns: [
      /(?:what does|what do)\s+["\']?(.+?)["\']?\s+(?:depend on|rely on|need)/,
      /(?:upstream|dependencies)\s+(?:of|for)\s+["\']?(.+?)["\']?$/,
    ],
    generate: (match) => {
      const target = escapeIQLString(match[1]!.trim());
      return `FIND upstream OF "${target}"`;
    },
    confidence: 0.9,
  },

  // "blast radius of [resource]"
  {
    name: "blast-radius",
    patterns: [
      /(?:blast radius|impact|what (?:would be|is) affected)\s+(?:of|for|if)\s+["\']?(.+?)["\']?\s+(?:goes down|fails|is deleted|breaks)?$/,
      /(?:blast radius|impact)\s+(?:of|for)\s+["\']?(.+?)["\']?$/,
    ],
    generate: (match) => {
      const target = escapeIQLString(match[1]!.trim());
      return `FIND downstream OF "${target}"`;
    },
    confidence: 0.85,
  },

  // "total cost" / "how much do we spend"
  {
    name: "total-cost",
    patterns: [
      /(?:total|overall|monthly)\s+(?:cost|spend|spending|bill|expense)/,
      /(?:how much)\s+(?:do we|does it|are we)\s+(?:spend|cost|pay)/,
    ],
    generate: (_match, input) => {
      const provider = extractProvider(input);
      const env = extractEnvironment(input);
      const resourceType = extractResourceType(input);

      const conditions: string[] = [];
      if (provider) conditions.push(`provider = "${provider}"`);
      if (env) conditions.push(`tags.Environment = "${env}"`);
      if (resourceType) conditions.push(`resourceType = "${resourceType}"`);

      return conditions.length > 0
        ? `SUMMARIZE sum(costMonthly) BY provider WHERE ${conditions.join(" AND ")}`
        : "SUMMARIZE sum(costMonthly) BY provider";
    },
    confidence: 0.85,
  },

  // "cost by [dimension]"
  {
    name: "cost-breakdown",
    patterns: [
      /(?:cost|spend|spending)\s+(?:by|per|grouped by)\s+(provider|type|resource ?type|region|account|team)/,
    ],
    generate: (match) => {
      let groupBy = match[1]!.trim().toLowerCase();
      if (groupBy === "type") groupBy = "resourceType";
      if (groupBy === "resource type") groupBy = "resourceType";
      return `SUMMARIZE sum(costMonthly) BY ${groupBy}`;
    },
    confidence: 0.9,
  },

  // "most expensive [resources]"
  {
    name: "most-expensive",
    patterns: [
      /(?:most expensive|costliest|highest cost|top cost)\s+(.+?)$/,
      /(?:top)\s+(?:\d+\s+)?(?:most expensive|costliest)\s+(.+?)$/,
    ],
    generate: (_match, input) => {
      const resourceType = extractResourceType(input);
      const limitMatch = input.match(/(?:top)\s+(\d+)/);
      const limit = limitMatch ? parseInt(limitMatch[1]!, 10) : 10;

      const conditions: string[] = ["costMonthly > 0"];
      if (resourceType) conditions.push(`resourceType = "${resourceType}"`);

      return `FIND resources WHERE ${conditions.join(" AND ")} LIMIT ${limit}`;
    },
    confidence: 0.8,
  },

  // "untagged resources"
  {
    name: "untagged",
    patterns: [
      /(?:untagged|without tags|missing tags|no tags)\s*(.*)$/,
      /resources?\s+(?:without|missing|lacking)\s+tags/,
    ],
    generate: (_match, input) => {
      const resourceType = extractResourceType(input);
      const conditions = ["NOT tagged(\"Environment\")"];
      if (resourceType) conditions.push(`resourceType = "${resourceType}"`);
      return `FIND resources WHERE ${conditions.join(" AND ")}`;
    },
    confidence: 0.85,
  },

  // "path from [A] to [B]"
  {
    name: "shortest-path",
    patterns: [
      /(?:path|route|connection|how (?:does|do|is))\s+(?:from\s+)?["\']?(.+?)["\']?\s+(?:to|connect(?:ed)? to|reach)\s+["\']?(.+?)["\']?$/,
    ],
    generate: (match) => {
      return `FIND PATH FROM "${escapeIQLString(match[1]!.trim())}" TO "${escapeIQLString(match[2]!.trim())}"`;
    },
    confidence: 0.9,
  },

  // "resources in [environment/provider/region]"
  {
    name: "resources-in-scope",
    patterns: [
      /(?:resources?|infrastructure)\s+(?:in|on|at|for)\s+(.+)$/,
    ],
    generate: (_match, input) => {
      const provider = extractProvider(input);
      const env = extractEnvironment(input);
      const region = extractRegion(input);
      const resourceType = extractResourceType(input);

      const conditions: string[] = [];
      if (provider) conditions.push(`provider = "${provider}"`);
      if (env) conditions.push(`tags.Environment = "${env}"`);
      if (region) conditions.push(`region = "${region}"`);
      if (resourceType) conditions.push(`resourceType = "${resourceType}"`);

      return conditions.length > 0
        ? `FIND resources WHERE ${conditions.join(" AND ")}`
        : "FIND resources";
    },
    confidence: 0.75,
  },
];

// =============================================================================
// Translation Engine
// =============================================================================

/**
 * Translate a natural language query to IQL.
 */
export function translateNLToIQL(input: string): NLTranslationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      success: false,
      iql: null,
      ast: null,
      matchedTemplate: null,
      confidence: 0,
      explanation: "Empty input",
      suggestions: getExampleQueries().map((q) => q.natural),
    };
  }

  const normalized = normalize(trimmed);

  // Try each template
  for (const template of TEMPLATES) {
    for (const pattern of template.patterns) {
      const match = normalized.match(pattern);
      if (match) {
        const iql = template.generate(match, normalized);

        // Validate the generated IQL
        try {
          const ast = parseIQL(iql);
          return {
            success: true,
            iql,
            ast,
            matchedTemplate: template.name,
            confidence: template.confidence,
            explanation: `Translated "${input}" → ${iql}`,
          };
        } catch {
          // Template generated invalid IQL — try next template
          continue;
        }
      }
    }
  }

  // No template matched — provide suggestions
  return {
    success: false,
    iql: null,
    ast: null,
    matchedTemplate: null,
    confidence: 0,
    explanation: `Could not translate: "${input}"`,
    suggestions: [
      'Try: "show me all databases in production"',
      'Try: "how many instances are running on AWS"',
      'Try: "what depends on my-vpc"',
      'Try: "total cost by provider"',
      'Try: "most expensive resources"',
      'Try: "untagged databases"',
      'Try: "path from web-server to database"',
    ],
  };
}

/**
 * Get available resource types for autocomplete/help.
 */
export function getAvailableResourceTypes(): string[] {
  return [...new Set(Object.values(RESOURCE_TYPE_MAP))].sort();
}

/**
 * Get available providers for autocomplete/help.
 */
export function getAvailableProviders(): string[] {
  return [...new Set(Object.values(PROVIDER_MAP))].sort();
}

/**
 * Get example queries for help/onboarding.
 */
export function getExampleQueries(): Array<{
  natural: string;
  iql: string;
}> {
  return [
    {
      natural: "Show me all databases in production",
      iql: 'FIND resources WHERE resourceType = "database" AND tags.Environment = "production"',
    },
    {
      natural: "How many instances are running on AWS?",
      iql: 'SUMMARIZE count BY resourceType WHERE resourceType = "compute" AND provider = "aws" AND status = "running"',
    },
    {
      natural: "What depends on my-vpc?",
      iql: 'FIND downstream OF "my-vpc"',
    },
    {
      natural: "Total cost by provider",
      iql: "SUMMARIZE sum(costMonthly) BY provider",
    },
    {
      natural: "Most expensive resources",
      iql: "FIND resources WHERE costMonthly > 0 LIMIT 10",
    },
    {
      natural: "Show me all stopped EC2 instances",
      iql: 'FIND resources WHERE resourceType = "compute" AND status = "stopped"',
    },
    {
      natural: "Path from web-server to database",
      iql: 'FIND PATH FROM "web-server" TO "database"',
    },
    {
      natural: "Resources in us-east-1",
      iql: 'FIND resources WHERE region = "us-east-1"',
    },
  ];
}
