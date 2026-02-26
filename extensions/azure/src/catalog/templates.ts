/**
 * Azure Infrastructure Catalog
 *
 * Searchable, tagged template library of infrastructure patterns.
 * Each template is a pre-configured ApplicationIntent that can be
 * customized and deployed.
 */

import type { ApplicationIntent, ApplicationTierIntent } from "../intent/types.js";

// =============================================================================
// Template Types
// =============================================================================

export interface IntentTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  version: string;
  intentTemplate: ApplicationIntent;
  requiredParameters: string[];
  tags: string[];
  costRangeUsd: { min: number; max: number };
  complexity: "basic" | "intermediate" | "advanced";
}

export type TemplateCategory =
  | "web-application"
  | "api-backend"
  | "microservices"
  | "data-pipeline"
  | "ai-ml"
  | "iot"
  | "static-site"
  | "event-driven";

// =============================================================================
// Template Catalog
// =============================================================================

export const INFRASTRUCTURE_CATALOG: IntentTemplate[] = [
  {
    id: "web-app-sql",
    name: "Web App with SQL Database",
    description: "Standard web application hosted on App Service with Azure SQL backend, Application Insights monitoring, and optional VNet integration.",
    category: "web-application",
    version: "1.0.0",
    intentTemplate: {
      name: "web-app",
      description: "Web application with SQL backend",
      environment: "production",
      region: "eastus",
      tiers: [
        {
          name: "web",
          type: "web",
          compute: { platform: "app-service", runtime: "node20", size: "medium", instanceCount: 2 },
          networking: { publicAccess: true, ssl: true },
          scaling: { minInstances: 2, maxInstances: 10, cpuThreshold: 70 },
          dependsOn: ["database"],
        },
        {
          name: "database",
          type: "data",
          dataStore: { engine: "sql-server", sizeGb: 50, tier: "standard", backupRetentionDays: 35 },
        },
      ],
      availability: { sla: "99.95%", zoneRedundant: true },
      cost: { priority: "balanced" },
      tags: { workload: "web-application" },
    },
    requiredParameters: ["name", "environment", "region"],
    tags: ["web", "sql", "app-service", "production-ready"],
    costRangeUsd: { min: 80, max: 300 },
    complexity: "basic",
  },
  {
    id: "api-cosmosdb",
    name: "API Backend with Cosmos DB",
    description: "Scalable API backend using Container Apps with Cosmos DB for globally distributed data, Redis cache for performance.",
    category: "api-backend",
    version: "1.0.0",
    intentTemplate: {
      name: "api-backend",
      description: "API backend with Cosmos DB and Redis cache",
      environment: "production",
      region: "eastus",
      tiers: [
        {
          name: "api",
          type: "api",
          compute: { platform: "container-app", size: "medium", instanceCount: 2 },
          networking: { publicAccess: true, ssl: true },
          scaling: { minInstances: 2, maxInstances: 20, cpuThreshold: 60 },
          dependsOn: ["datastore", "cache"],
        },
        {
          name: "datastore",
          type: "data",
          dataStore: { engine: "cosmosdb", tier: "standard" },
        },
        {
          name: "cache",
          type: "cache",
          dataStore: { engine: "redis", tier: "standard" },
        },
      ],
      availability: { sla: "99.99%", geoReplication: true },
      cost: { priority: "balanced" },
      tags: { workload: "api-backend" },
    },
    requiredParameters: ["name", "environment", "region"],
    tags: ["api", "cosmosdb", "redis", "container-apps", "globally-distributed"],
    costRangeUsd: { min: 150, max: 600 },
    complexity: "intermediate",
  },
  {
    id: "microservices-aks",
    name: "Microservices on AKS",
    description: "Kubernetes-based microservices architecture with AKS, PostgreSQL, Redis, and Container Registry.",
    category: "microservices",
    version: "1.0.0",
    intentTemplate: {
      name: "microservices",
      description: "AKS-based microservices platform",
      environment: "production",
      region: "eastus",
      tiers: [
        {
          name: "cluster",
          type: "web",
          compute: { platform: "aks", size: "medium", instanceCount: 3 },
          scaling: { minInstances: 3, maxInstances: 15, cpuThreshold: 65 },
          dependsOn: ["database", "cache"],
        },
        {
          name: "database",
          type: "data",
          dataStore: { engine: "postgresql", sizeGb: 100, tier: "standard", backupRetentionDays: 35 },
        },
        {
          name: "cache",
          type: "cache",
          dataStore: { engine: "redis", tier: "standard" },
        },
      ],
      availability: { sla: "99.95%", zoneRedundant: true },
      security: { encryptionAtRest: true, encryptionInTransit: true },
      cost: { priority: "balanced" },
      tags: { workload: "microservices" },
    },
    requiredParameters: ["name", "environment", "region"],
    tags: ["aks", "kubernetes", "microservices", "postgresql", "redis"],
    costRangeUsd: { min: 250, max: 800 },
    complexity: "advanced",
  },
  {
    id: "serverless-api",
    name: "Serverless API",
    description: "Event-driven serverless API using Azure Functions with Cosmos DB and Application Insights.",
    category: "event-driven",
    version: "1.0.0",
    intentTemplate: {
      name: "serverless-api",
      description: "Serverless API with Azure Functions",
      environment: "production",
      region: "eastus",
      tiers: [
        {
          name: "functions",
          type: "api",
          compute: { platform: "functions", runtime: "node20", size: "medium" },
          networking: { publicAccess: true, ssl: true },
          dependsOn: ["datastore"],
        },
        {
          name: "datastore",
          type: "data",
          dataStore: { engine: "cosmosdb", tier: "basic" },
        },
      ],
      cost: { priority: "minimize" },
      tags: { workload: "serverless" },
    },
    requiredParameters: ["name", "environment", "region"],
    tags: ["serverless", "functions", "cosmosdb", "event-driven", "low-cost"],
    costRangeUsd: { min: 25, max: 150 },
    complexity: "basic",
  },
  {
    id: "data-pipeline-postgres",
    name: "Data Pipeline with PostgreSQL",
    description: "Data processing pipeline with worker tier, PostgreSQL for structured data, and blob storage for unstructured data.",
    category: "data-pipeline",
    version: "1.0.0",
    intentTemplate: {
      name: "data-pipeline",
      description: "Data processing pipeline",
      environment: "production",
      region: "eastus",
      tiers: [
        {
          name: "ingestion",
          type: "api",
          compute: { platform: "container-app", size: "small" },
          networking: { publicAccess: true, ssl: true },
          dependsOn: ["storage"],
        },
        {
          name: "processor",
          type: "worker",
          compute: { platform: "container-app", size: "large" },
          scaling: { minInstances: 1, maxInstances: 10, cpuThreshold: 50 },
          dependsOn: ["storage", "database"],
        },
        {
          name: "storage",
          type: "storage",
          dataStore: { engine: "storage-blob", sizeGb: 500, tier: "standard" },
        },
        {
          name: "database",
          type: "data",
          dataStore: { engine: "postgresql", sizeGb: 100, tier: "standard", backupRetentionDays: 30 },
        },
      ],
      cost: { priority: "balanced" },
      tags: { workload: "data-pipeline" },
    },
    requiredParameters: ["name", "environment", "region"],
    tags: ["data-pipeline", "postgresql", "blob-storage", "etl", "batch-processing"],
    costRangeUsd: { min: 100, max: 500 },
    complexity: "intermediate",
  },
  {
    id: "spring-apps-mysql",
    name: "Spring Apps with MySQL",
    description: "Java Spring application on Azure Spring Apps with MySQL database and Redis cache.",
    category: "web-application",
    version: "1.0.0",
    intentTemplate: {
      name: "spring-app",
      description: "Java Spring application",
      environment: "production",
      region: "eastus",
      tiers: [
        {
          name: "app",
          type: "web",
          compute: { platform: "spring-apps", runtime: "java21", size: "medium", instanceCount: 2 },
          scaling: { minInstances: 2, maxInstances: 8, cpuThreshold: 70 },
          dependsOn: ["database", "cache"],
        },
        {
          name: "database",
          type: "data",
          dataStore: { engine: "mysql", sizeGb: 50, tier: "standard", backupRetentionDays: 30 },
        },
        {
          name: "cache",
          type: "cache",
          dataStore: { engine: "redis", tier: "basic" },
        },
      ],
      cost: { priority: "balanced" },
      tags: { workload: "spring-application" },
    },
    requiredParameters: ["name", "environment", "region"],
    tags: ["spring", "java", "mysql", "redis", "spring-apps"],
    costRangeUsd: { min: 120, max: 450 },
    complexity: "intermediate",
  },
  {
    id: "static-web-cdn",
    name: "Static Website with CDN",
    description: "Static website hosted on Azure Storage with CDN for global distribution and custom domain support.",
    category: "static-site",
    version: "1.0.0",
    intentTemplate: {
      name: "static-site",
      description: "Static website with global CDN",
      environment: "production",
      region: "eastus",
      tiers: [
        {
          name: "hosting",
          type: "storage",
          dataStore: { engine: "storage-blob", sizeGb: 10, tier: "standard" },
          networking: { publicAccess: true, cdn: true, ssl: true, customDomain: "custom.example.com" },
        },
      ],
      cost: { priority: "minimize" },
      tags: { workload: "static-site" },
    },
    requiredParameters: ["name", "environment", "region"],
    tags: ["static-site", "cdn", "blob-storage", "low-cost", "global"],
    costRangeUsd: { min: 5, max: 50 },
    complexity: "basic",
  },
];

// =============================================================================
// Indexes
// =============================================================================

const TEMPLATE_INDEX = new Map<string, IntentTemplate>(
  INFRASTRUCTURE_CATALOG.map((t) => [t.id, t]),
);

const CATEGORY_INDEX = new Map<TemplateCategory, IntentTemplate[]>();
for (const template of INFRASTRUCTURE_CATALOG) {
  const list = CATEGORY_INDEX.get(template.category) ?? [];
  list.push(template);
  CATEGORY_INDEX.set(template.category, list);
}

const TAG_INDEX = new Map<string, IntentTemplate[]>();
for (const template of INFRASTRUCTURE_CATALOG) {
  for (const tag of template.tags) {
    const list = TAG_INDEX.get(tag) ?? [];
    list.push(template);
    TAG_INDEX.set(tag, list);
  }
}

// =============================================================================
// Search Functions
// =============================================================================

/** Get a template by ID. */
export function getTemplate(id: string): IntentTemplate | undefined {
  return TEMPLATE_INDEX.get(id);
}

/** List all templates, optionally filtered by category. */
export function listTemplates(category?: TemplateCategory): IntentTemplate[] {
  if (category) return CATEGORY_INDEX.get(category) ?? [];
  return [...INFRASTRUCTURE_CATALOG];
}

/** Get all available template categories. */
export function getCategories(): TemplateCategory[] {
  return [...CATEGORY_INDEX.keys()];
}

/** Search templates by query string (matches name, description, tags). */
export function searchTemplates(query: string): IntentTemplate[] {
  const lower = query.toLowerCase();
  return INFRASTRUCTURE_CATALOG.filter((t) =>
    t.name.toLowerCase().includes(lower) ||
    t.description.toLowerCase().includes(lower) ||
    t.tags.some((tag) => tag.includes(lower)),
  );
}

/** Search templates by tags (returns templates matching ALL given tags). */
export function searchTemplatesByTags(tags: string[]): IntentTemplate[] {
  if (tags.length === 0) return [];
  const lowerTags = tags.map((t) => t.toLowerCase());
  return INFRASTRUCTURE_CATALOG.filter((t) =>
    lowerTags.every((lt) => t.tags.some((tt) => tt.includes(lt))),
  );
}

/**
 * Apply a template with user-provided parameters.
 * Merges the template's intent with user overrides to produce a deployable ApplicationIntent.
 */
export function applyTemplate(
  templateId: string,
  params: {
    name: string;
    environment: string;
    region?: string;
    tags?: Record<string, string>;
    tierOverrides?: Record<string, Partial<ApplicationTierIntent>>;
  },
): ApplicationIntent | null {
  const template = TEMPLATE_INDEX.get(templateId);
  if (!template) return null;

  const validEnvironments = ["production", "staging", "development", "testing"] as const;
  if (!validEnvironments.includes(params.environment as (typeof validEnvironments)[number])) {
    return null;
  }

  const intent: ApplicationIntent = {
    ...template.intentTemplate,
    name: params.name,
    environment: params.environment as ApplicationIntent["environment"],
    region: params.region ?? template.intentTemplate.region,
    tags: { ...template.intentTemplate.tags, ...params.tags },
    tiers: template.intentTemplate.tiers.map((tier) => {
      const override = params.tierOverrides?.[tier.name];
      if (!override) return { ...tier };
      return {
        ...tier,
        ...override,
        compute: override.compute ? { ...tier.compute, ...override.compute } : tier.compute,
        dataStore: override.dataStore ? { ...tier.dataStore, ...override.dataStore } : tier.dataStore,
        networking: override.networking ? { ...tier.networking, ...override.networking } : tier.networking,
        scaling: override.scaling ? { ...tier.scaling, ...override.scaling } : tier.scaling,
      };
    }),
  };

  return intent;
}
