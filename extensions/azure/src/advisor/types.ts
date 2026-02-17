/**
 * Advisor — Type Definitions
 *
 * Types for the project analyzer, recommendation engine, and deploy advisor
 * that maps detected technology stacks to Azure services and blueprints.
 */

// =============================================================================
// Project Analysis
// =============================================================================

/** Detected programming language / runtime. */
export type DetectedLanguage =
  | "node"
  | "typescript"
  | "python"
  | "dotnet"
  | "java"
  | "go"
  | "rust"
  | "php"
  | "ruby"
  | "unknown";

/** Detected application framework. */
export type DetectedFramework =
  | "express"
  | "fastify"
  | "nestjs"
  | "nextjs"
  | "nuxt"
  | "react"
  | "angular"
  | "vue"
  | "svelte"
  | "django"
  | "flask"
  | "fastapi"
  | "aspnet"
  | "spring-boot"
  | "gin"
  | "rails"
  | "laravel"
  | "none"
  | "unknown";

/** Type of application architecture. */
export type AppArchetype =
  | "api"
  | "web-app"
  | "static-site"
  | "worker"
  | "fullstack"
  | "microservices"
  | "function"
  | "data-pipeline"
  | "monolith"
  | "unknown";

/** A detected dependency that influences Azure recommendations. */
export type DetectedDependency = {
  name: string;
  version?: string;
  /** What category this dependency signals. */
  signal: DependencySignal;
};

export type DependencySignal =
  | "sql-database"
  | "nosql-database"
  | "redis-cache"
  | "messaging-queue"
  | "messaging-pubsub"
  | "storage-blob"
  | "search"
  | "auth"
  | "ai-ml"
  | "monitoring"
  | "containerization"
  | "orm"
  | "web-framework"
  | "api-framework"
  | "static-site-generator"
  | "test-framework"
  | "none";

/** Result of analyzing a project directory. */
export type ProjectAnalysis = {
  /** Root path that was analyzed. */
  projectPath: string;
  /** Detected primary language. */
  language: DetectedLanguage;
  /** Detected framework (if any). */
  framework: DetectedFramework;
  /** Inferred application archetype. */
  archetype: AppArchetype;
  /** Entry point file (e.g. "src/index.ts", "app.py"). */
  entryPoint?: string;
  /** Detected port the app listens on. */
  port?: number;
  /** Dependencies that signal Azure service needs. */
  dependencies: DetectedDependency[];
  /** Whether a Dockerfile was found. */
  hasDockerfile: boolean;
  /** Whether Docker Compose was found. */
  hasDockerCompose: boolean;
  /** Package manager used. */
  packageManager?: "npm" | "yarn" | "pnpm" | "bun" | "pip" | "poetry" | "pipenv" | "dotnet" | "maven" | "gradle" | "cargo" | "go-mod";
  /** Detected test framework. */
  hasTests: boolean;
  /** Environment variable names found in config or code. */
  envVars: string[];
  /** Raw config file contents for deeper inspection. */
  configFiles: AnalyzedConfigFile[];
  /** Confidence in the analysis (0–1). */
  confidence: number;
  /** Human-readable notes about the analysis. */
  notes: string[];
};

export type AnalyzedConfigFile = {
  path: string;
  type: "package.json" | "requirements.txt" | "pyproject.toml" | "Pipfile" | "Cargo.toml" | "go.mod" | "pom.xml" | "build.gradle" | "Dockerfile" | "docker-compose.yml" | ".csproj" | ".env" | "tsconfig.json" | "other";
};

// =============================================================================
// Azure Service Recommendations
// =============================================================================

/** An Azure service recommendation derived from analysis. */
export type ServiceRecommendation = {
  /** Azure service name (e.g. "App Service", "Azure SQL Database"). */
  service: AzureServiceName;
  /** Why this service is recommended. */
  reason: string;
  /** SKU or tier suggestion. */
  suggestedSku?: string;
  /** How strongly this is recommended. */
  confidence: RecommendationConfidence;
  /** Is this required or optional? */
  required: boolean;
  /** The signal(s) that triggered this recommendation. */
  triggers: string[];
};

export type RecommendationConfidence = "high" | "medium" | "low";

export type AzureServiceName =
  | "App Service"
  | "Azure Functions"
  | "Container Apps"
  | "Static Web Apps"
  | "Azure SQL Database"
  | "Cosmos DB"
  | "Azure Database for PostgreSQL"
  | "Azure Database for MySQL"
  | "Azure Cache for Redis"
  | "Azure Blob Storage"
  | "Azure Service Bus"
  | "Azure Event Grid"
  | "Azure Key Vault"
  | "Application Insights"
  | "Azure CDN"
  | "Azure Virtual Network"
  | "Azure AI Services"
  | "Azure Container Registry";

/** The recommended blueprint (if one matches). */
export type BlueprintMatch = {
  /** Blueprint ID from the IDIO system. */
  blueprintId: string;
  /** Blueprint name. */
  name: string;
  /** How well it matches (0–1). */
  matchScore: number;
  /** Auto-populated parameters from the analysis. */
  inferredParams: Record<string, unknown>;
  /** Parameters that still need user input. */
  missingParams: string[];
};

/** Complete recommendation output from the advisor. */
export type DeployRecommendation = {
  /** The analyzed project. */
  analysis: ProjectAnalysis;
  /** Recommended Azure services. */
  services: ServiceRecommendation[];
  /** Best-matching blueprint (if any). */
  blueprint?: BlueprintMatch;
  /** Additional blueprint matches, ranked. */
  alternativeBlueprints: BlueprintMatch[];
  /** Overall confidence in the recommendation. */
  confidence: RecommendationConfidence;
  /** Summary for display. */
  summary: string;
  /** Steps the user should take. */
  actionItems: string[];
};

// =============================================================================
// Advisor Options
// =============================================================================

export type AdvisorOptions = {
  /** Default Azure region for recommendations. */
  defaultRegion?: string;
  /** Default project name (overrides detection). */
  projectName?: string;
  /** Prefer containers over App Service. */
  preferContainers?: boolean;
  /** Azure AD tenant ID (for Key Vault blueprints). */
  tenantId?: string;
};
