/**
 * Advisor — Recommendation Engine
 *
 * Maps a ProjectAnalysis to Azure service recommendations, selects the best
 * IDIO blueprint, and auto-populates parameters. This is the "brain" that
 * turns "set up a server for this app" into a concrete deployment plan.
 */

import { getBlueprint, listBlueprints } from "../orchestration/index.js";
import type { Blueprint, ExecutionPlan } from "../orchestration/types.js";
import { validatePlan } from "../orchestration/index.js";
import type {
  ProjectAnalysis,
  ServiceRecommendation,
  BlueprintMatch,
  DeployRecommendation,
  AdvisorOptions,
  AzureServiceName,
  RecommendationConfidence,
  AppArchetype,
  DetectedFramework,
  DependencySignal,
} from "./types.js";

// =============================================================================
// Public API
// =============================================================================

/**
 * Generate Azure deployment recommendations from a project analysis.
 */
export function recommend(analysis: ProjectAnalysis, options?: AdvisorOptions): DeployRecommendation {
  const region = options?.defaultRegion ?? "eastus";
  const projectName = options?.projectName ?? deriveProjectName(analysis);

  // 1. Map dependencies + archetype → Azure services
  const services = recommendServices(analysis, options);

  // 2. Match against available blueprints
  const blueprintMatches = matchBlueprints(analysis, services, projectName, region, options);
  const bestBlueprint = blueprintMatches[0];
  const alternativeBlueprints = blueprintMatches.slice(1);

  // 3. Compute overall confidence
  const confidence = computeOverallConfidence(analysis, services, bestBlueprint);

  // 4. Generate summary
  const summary = generateSummary(analysis, services, bestBlueprint);

  // 5. Action items
  const actionItems = generateActionItems(analysis, services, bestBlueprint, options);

  return {
    analysis,
    services,
    blueprint: bestBlueprint,
    alternativeBlueprints,
    confidence,
    summary,
    actionItems,
  };
}

/**
 * Generate a recommendation and, if a blueprint matches well enough,
 * produce a validated ExecutionPlan ready for the orchestrator.
 *
 * Returns null plan if no blueprint matches with >= 0.5 score.
 */
export function recommendAndPlan(
  analysis: ProjectAnalysis,
  options?: AdvisorOptions,
): { recommendation: DeployRecommendation; plan: ExecutionPlan | null; validationIssues: string[] } {
  const recommendation = recommend(analysis, options);

  if (!recommendation.blueprint || recommendation.blueprint.matchScore < 0.5) {
    return { recommendation, plan: null, validationIssues: ["No blueprint matched with sufficient confidence (≥0.5)"] };
  }

  const bp = getBlueprint(recommendation.blueprint.blueprintId);
  if (!bp) {
    return { recommendation, plan: null, validationIssues: [`Blueprint "${recommendation.blueprint.blueprintId}" not found in registry`] };
  }

  // Fill in defaults for missing params
  const params = { ...recommendation.blueprint.inferredParams };
  for (const p of bp.parameters) {
    if (!(p.name in params) && p.default !== undefined) {
      params[p.name] = p.default;
    }
  }

  try {
    const plan = bp.generate(params);
    const validation = validatePlan(plan);
    return {
      recommendation,
      plan: validation.valid ? plan : null,
      validationIssues: validation.issues.map((i) => `[${i.severity}] ${i.message}`),
    };
  } catch (err) {
    return {
      recommendation,
      plan: null,
      validationIssues: [`Plan generation failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

// =============================================================================
// Service recommendation
// =============================================================================

function recommendServices(analysis: ProjectAnalysis, options?: AdvisorOptions): ServiceRecommendation[] {
  const services: ServiceRecommendation[] = [];
  const dependencySignals = new Set(analysis.dependencies.map((d) => d.signal));

  // --- Compute ---
  services.push(recommendCompute(analysis, options));

  // --- Database ---
  if (dependencySignals.has("sql-database") || dependencySignals.has("orm")) {
    const ormDeps = analysis.dependencies.filter((d) => d.signal === "orm" || d.signal === "sql-database");
    const triggersStr = ormDeps.map((d) => d.name);

    // Detect specific DB type
    const hasMssql = analysis.dependencies.some((d) => ["mssql", "tedious", "Microsoft.EntityFrameworkCore.SqlServer"].includes(d.name));
    const hasPg = analysis.dependencies.some((d) => ["pg", "pg-promise", "psycopg2", "psycopg2-binary", "Npgsql.EntityFrameworkCore.PostgreSQL"].includes(d.name));
    const hasMysql = analysis.dependencies.some((d) => ["mysql2", "mysql", "pymysql"].includes(d.name));

    if (hasMssql || (!hasPg && !hasMysql)) {
      services.push({
        service: "Azure SQL Database",
        reason: "SQL database dependency detected — Azure SQL provides managed, scalable SQL Server",
        suggestedSku: "Basic",
        confidence: "high",
        required: true,
        triggers: triggersStr,
      });
    }
    if (hasPg) {
      services.push({
        service: "Azure Database for PostgreSQL",
        reason: "PostgreSQL driver detected",
        suggestedSku: "Burstable B1ms",
        confidence: "high",
        required: true,
        triggers: triggersStr,
      });
    }
    if (hasMysql) {
      services.push({
        service: "Azure Database for MySQL",
        reason: "MySQL driver detected",
        suggestedSku: "Burstable B1ms",
        confidence: "high",
        required: true,
        triggers: triggersStr,
      });
    }
  }

  if (dependencySignals.has("nosql-database")) {
    services.push({
      service: "Cosmos DB",
      reason: "NoSQL database dependency detected — Cosmos DB provides globally distributed, multi-model database",
      suggestedSku: "Serverless",
      confidence: "high",
      required: true,
      triggers: analysis.dependencies.filter((d) => d.signal === "nosql-database").map((d) => d.name),
    });
  }

  // --- Cache ---
  if (dependencySignals.has("redis-cache")) {
    services.push({
      service: "Azure Cache for Redis",
      reason: "Redis dependency detected — Azure Cache for Redis provides managed in-memory caching",
      suggestedSku: "Basic C0",
      confidence: "high",
      required: true,
      triggers: analysis.dependencies.filter((d) => d.signal === "redis-cache").map((d) => d.name),
    });
  }

  // --- Messaging ---
  if (dependencySignals.has("messaging-queue") || dependencySignals.has("messaging-pubsub")) {
    services.push({
      service: "Azure Service Bus",
      reason: "Message queue / pub-sub dependency detected — Service Bus provides enterprise messaging",
      suggestedSku: "Standard",
      confidence: dependencySignals.has("messaging-queue") ? "high" : "medium",
      required: true,
      triggers: analysis.dependencies.filter((d) => d.signal === "messaging-queue" || d.signal === "messaging-pubsub").map((d) => d.name),
    });
  }

  // --- Storage ---
  if (dependencySignals.has("storage-blob") || analysis.envVars.some((v) => /STORAGE|BLOB|UPLOAD|S3/i.test(v))) {
    services.push({
      service: "Azure Blob Storage",
      reason: "Blob storage / file upload dependency detected",
      suggestedSku: "Standard_LRS",
      confidence: dependencySignals.has("storage-blob") ? "high" : "medium",
      required: dependencySignals.has("storage-blob"),
      triggers: analysis.dependencies.filter((d) => d.signal === "storage-blob").map((d) => d.name),
    });
  }

  // --- AI ---
  if (dependencySignals.has("ai-ml")) {
    services.push({
      service: "Azure AI Services",
      reason: "AI/ML dependency detected — Azure provides managed AI model hosting",
      confidence: "high",
      required: true,
      triggers: analysis.dependencies.filter((d) => d.signal === "ai-ml").map((d) => d.name),
    });
  }

  // --- Cross-cutting: Monitoring ---
  services.push({
    service: "Application Insights",
    reason: "Recommended for all production workloads — provides APM, logging, and metrics",
    confidence: dependencySignals.has("monitoring") ? "high" : "medium",
    required: false,
    triggers: analysis.dependencies.filter((d) => d.signal === "monitoring").map((d) => d.name),
  });

  // --- Cross-cutting: Key Vault ---
  if (analysis.envVars.length > 3 || dependencySignals.has("auth")) {
    services.push({
      service: "Azure Key Vault",
      reason: `${analysis.envVars.length} environment variables detected — Key Vault provides secure secret management`,
      confidence: "medium",
      required: false,
      triggers: ["environment variables", ...analysis.dependencies.filter((d) => d.signal === "auth").map((d) => d.name)],
    });
  }

  // --- CDN for static sites ---
  if (analysis.archetype === "static-site") {
    services.push({
      service: "Azure CDN",
      reason: "Static site detected — CDN accelerates content delivery globally",
      suggestedSku: "Standard_Microsoft",
      confidence: "high",
      required: false,
      triggers: ["static-site archetype"],
    });
  }

  // --- Container Registry if Dockerfile ---
  if (analysis.hasDockerfile && (options?.preferContainers || analysis.archetype === "microservices")) {
    services.push({
      service: "Azure Container Registry",
      reason: "Dockerfile present — ACR stores container images for Azure deployments",
      suggestedSku: "Basic",
      confidence: "high",
      required: true,
      triggers: ["Dockerfile"],
    });
  }

  return services;
}

function recommendCompute(analysis: ProjectAnalysis, options?: AdvisorOptions): ServiceRecommendation {
  const { archetype, hasDockerfile, framework } = analysis;

  // Static sites → Static Web Apps > App Service
  if (archetype === "static-site") {
    return {
      service: "Static Web Apps",
      reason: `Static site (${framework}) detected — Static Web Apps provides free hosting with CI/CD`,
      suggestedSku: "Free",
      confidence: "high",
      required: true,
      triggers: [framework, archetype],
    };
  }

  // Prefer containers if requested or Docker found with multi-service
  if (options?.preferContainers || (hasDockerfile && archetype === "microservices")) {
    return {
      service: "Container Apps",
      reason: `${archetype === "microservices" ? "Multi-service architecture" : "Container preference"} detected — Container Apps provides managed Kubernetes-lite hosting`,
      suggestedSku: "Consumption",
      confidence: "high",
      required: true,
      triggers: [hasDockerfile ? "Dockerfile" : "preferContainers", archetype],
    };
  }

  // Workers / event-driven → Azure Functions
  if (archetype === "worker" || archetype === "function") {
    return {
      service: "Azure Functions",
      reason: "Event-driven / worker architecture — Functions provides serverless compute",
      suggestedSku: "Consumption",
      confidence: "high",
      required: true,
      triggers: [archetype],
    };
  }

  // Default: App Service for APIs, web apps, fullstack
  const runtimeHint = getAppServiceRuntime(analysis);
  return {
    service: "App Service",
    reason: `${archetype} application detected — App Service provides managed web hosting with ${runtimeHint}`,
    suggestedSku: "B1",
    confidence: "high",
    required: true,
    triggers: [archetype, analysis.language],
  };
}

function getAppServiceRuntime(analysis: ProjectAnalysis): string {
  switch (analysis.language) {
    case "node":
    case "typescript":
      return "NODE|18-lts";
    case "python":
      return "PYTHON|3.11";
    case "dotnet":
      return "DOTNETCORE|8.0";
    case "java":
      return "JAVA|17-java17";
    default:
      return "NODE|18-lts";
  }
}

// =============================================================================
// Blueprint matching
// =============================================================================

function matchBlueprints(
  analysis: ProjectAnalysis,
  services: ServiceRecommendation[],
  projectName: string,
  region: string,
  options?: AdvisorOptions,
): BlueprintMatch[] {
  const available = listBlueprints();
  const matches: BlueprintMatch[] = [];
  const serviceNames = new Set(services.map((s) => s.service));

  for (const bpInfo of available) {
    const bp = getBlueprint(bpInfo.id);
    if (!bp) continue;

    const { score, inferredParams, missingParams } = scoreBlueprint(bp, analysis, serviceNames, projectName, region, options);

    if (score > 0.2) {
      matches.push({
        blueprintId: bp.id,
        name: bp.name,
        matchScore: Math.round(score * 100) / 100,
        inferredParams,
        missingParams,
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.matchScore - a.matchScore);
  return matches;
}

function scoreBlueprint(
  bp: Blueprint,
  analysis: ProjectAnalysis,
  serviceNames: Set<AzureServiceName>,
  projectName: string,
  region: string,
  options?: AdvisorOptions,
): { score: number; inferredParams: Record<string, unknown>; missingParams: string[] } {
  const inferredParams: Record<string, unknown> = {};
  const missingParams: string[] = [];
  let score = 0;

  // --- Archetype alignment ---
  const archetypeScores: Record<string, Record<AppArchetype, number>> = {
    "web-app-with-sql": { "web-app": 0.9, fullstack: 0.7, api: 0.5, monolith: 0.4, "static-site": 0.1, worker: 0, microservices: 0.2, function: 0, "data-pipeline": 0.1, unknown: 0.3 },
    "api-backend": { api: 0.9, "web-app": 0.6, fullstack: 0.5, monolith: 0.4, "static-site": 0, worker: 0.1, microservices: 0.3, function: 0.1, "data-pipeline": 0.1, unknown: 0.3 },
    "static-web-with-cdn": { "static-site": 0.95, fullstack: 0.2, "web-app": 0.1, api: 0, worker: 0, microservices: 0, function: 0, monolith: 0, "data-pipeline": 0, unknown: 0.15 },
    "microservices-backbone": { microservices: 0.9, "data-pipeline": 0.3, api: 0.2, "web-app": 0.1, fullstack: 0.15, "static-site": 0, worker: 0.3, function: 0.1, monolith: 0.1, unknown: 0.2 },
    "data-platform": { "data-pipeline": 0.9, microservices: 0.2, api: 0.15, "web-app": 0.1, fullstack: 0.1, "static-site": 0, worker: 0.2, function: 0.1, monolith: 0.1, unknown: 0.2 },
    "serverless-functions": { function: 0.95, worker: 0.7, api: 0.4, "data-pipeline": 0.3, microservices: 0.2, "web-app": 0.1, fullstack: 0.1, "static-site": 0, monolith: 0, unknown: 0.2 },
    "ai-workload": { "data-pipeline": 0.5, api: 0.5, "web-app": 0.4, fullstack: 0.4, function: 0.2, worker: 0.3, microservices: 0.1, "static-site": 0, monolith: 0.2, unknown: 0.25 },
    "event-driven-pipeline": { worker: 0.8, function: 0.7, "data-pipeline": 0.6, microservices: 0.4, api: 0.2, "web-app": 0, fullstack: 0.1, "static-site": 0, monolith: 0, unknown: 0.15 },
    "containerized-api": { api: 0.7, microservices: 0.8, "web-app": 0.4, fullstack: 0.4, worker: 0.3, "data-pipeline": 0.2, function: 0.05, "static-site": 0, monolith: 0.3, unknown: 0.25 },
  };

  const archetypeMap = archetypeScores[bp.id];
  if (archetypeMap) {
    score += (archetypeMap[analysis.archetype] ?? 0) * 0.5;
  }

  // --- Service overlap ---
  const bpServices = getBlueprintServices(bp.id);
  let overlap = 0;
  let total = bpServices.length;
  for (const svc of bpServices) {
    if (serviceNames.has(svc)) overlap++;
  }
  if (total > 0) score += (overlap / total) * 0.3;

  // --- Parameter coverage ---
  // Auto-fill common params
  inferredParams.projectName = projectName;
  inferredParams.location = region;

  if (options?.tenantId) inferredParams.tenantId = options.tenantId;

  // Runtime
  if (bp.parameters.some((p) => p.name === "runtime")) {
    inferredParams.runtime = getAppServiceRuntime(analysis);
  }

  // Count coverage
  const required = bp.parameters.filter((p) => p.required !== false);
  let covered = 0;
  for (const p of required) {
    if (p.name in inferredParams) {
      covered++;
    } else if (p.default !== undefined) {
      covered++;
    } else {
      missingParams.push(p.name);
    }
  }
  if (required.length > 0) score += (covered / required.length) * 0.2;

  return { score, inferredParams, missingParams };
}

/** Returns the set of Azure services a blueprint provisions. */
function getBlueprintServices(blueprintId: string): AzureServiceName[] {
  const map: Record<string, AzureServiceName[]> = {
    "web-app-with-sql": ["App Service", "Azure SQL Database", "Application Insights", "Azure Key Vault"],
    "api-backend": ["App Service", "Azure SQL Database", "Application Insights", "Azure Key Vault", "Azure Virtual Network"],
    "static-web-with-cdn": ["Azure Blob Storage", "Azure CDN"],
    "microservices-backbone": ["Azure Virtual Network", "Azure Service Bus", "Azure Cache for Redis", "Azure Key Vault", "Application Insights"],
    "data-platform": ["Cosmos DB", "Azure Blob Storage", "Azure Cache for Redis", "Application Insights"],
    "serverless-functions": ["Azure Functions", "Azure Blob Storage", "Application Insights", "Azure Service Bus"],
    "ai-workload": ["App Service", "Azure AI Services", "Cosmos DB", "Azure Key Vault", "Application Insights"],
    "event-driven-pipeline": ["Azure Functions", "Azure Service Bus", "Azure Blob Storage", "Azure Event Grid", "Application Insights"],
    "containerized-api": ["Container Apps", "Azure Container Registry", "Azure Key Vault", "Application Insights"],
  };
  return map[blueprintId] ?? [];
}

// =============================================================================
// Summary & action items
// =============================================================================

function deriveProjectName(analysis: ProjectAnalysis): string {
  // Try to get from package.json name
  const pkgFile = analysis.configFiles.find((c) => c.type === "package.json");
  if (pkgFile) {
    try {
      const { readFileSync } = require("node:fs");
      const { join } = require("node:path");
      const pkg = JSON.parse(readFileSync(join(analysis.projectPath, pkgFile.path), "utf-8"));
      if (pkg.name && typeof pkg.name === "string") return pkg.name.replace(/^@[^/]+\//, "");
    } catch { /* ignore */ }
  }
  // Fall back to directory name
  const { basename } = require("node:path");
  return basename(analysis.projectPath) || "my-app";
}

function computeOverallConfidence(
  analysis: ProjectAnalysis,
  services: ServiceRecommendation[],
  blueprint?: BlueprintMatch,
): RecommendationConfidence {
  const analysisConf = analysis.confidence;
  const blueprintConf = blueprint?.matchScore ?? 0;
  const serviceConf = services.length > 0 ? services.reduce((sum, s) => sum + (s.confidence === "high" ? 1 : s.confidence === "medium" ? 0.6 : 0.3), 0) / services.length : 0;

  const avg = (analysisConf * 0.4 + blueprintConf * 0.3 + serviceConf * 0.3);
  if (avg >= 0.7) return "high";
  if (avg >= 0.4) return "medium";
  return "low";
}

function generateSummary(
  analysis: ProjectAnalysis,
  services: ServiceRecommendation[],
  blueprint?: BlueprintMatch,
): string {
  const lang = analysis.language === "unknown" ? "project" : analysis.language;
  const fw = analysis.framework !== "unknown" && analysis.framework !== "none" ? ` (${analysis.framework})` : "";
  const arch = analysis.archetype !== "unknown" ? ` — ${analysis.archetype}` : "";
  const svcList = services.filter((s) => s.required).map((s) => s.service).join(", ");
  const bpNote = blueprint ? `\nRecommended blueprint: "${blueprint.name}" (${Math.round(blueprint.matchScore * 100)}% match)` : "\nNo exact blueprint match — custom plan recommended";

  return `Detected: ${lang}${fw}${arch}\nRequired Azure services: ${svcList}${bpNote}`;
}

function generateActionItems(
  analysis: ProjectAnalysis,
  services: ServiceRecommendation[],
  blueprint?: BlueprintMatch,
  options?: AdvisorOptions,
): string[] {
  const items: string[] = [];

  if (blueprint && blueprint.missingParams.length > 0) {
    items.push(`Provide missing blueprint parameters: ${blueprint.missingParams.join(", ")}`);
  }

  if (!analysis.hasDockerfile && (options?.preferContainers || analysis.archetype === "microservices")) {
    items.push("Create a Dockerfile for container deployment");
  }

  if (!analysis.hasTests) {
    items.push("Add tests before deploying to production");
  }

  if (analysis.envVars.length > 0 && services.some((s) => s.service === "Azure Key Vault")) {
    items.push(`Move ${analysis.envVars.length} environment variables to Azure Key Vault`);
  }

  const dbServices = services.filter((s) =>
    s.service === "Azure SQL Database" || s.service === "Azure Database for PostgreSQL" ||
    s.service === "Azure Database for MySQL" || s.service === "Cosmos DB",
  );
  if (dbServices.length > 0) {
    items.push("Configure database connection strings in app settings after deployment");
  }

  if (!options?.tenantId && services.some((s) => s.service === "Azure Key Vault")) {
    items.push("Provide Azure AD tenant ID for Key Vault configuration");
  }

  if (blueprint) {
    items.push(`Review and execute blueprint: espada azure orchestration run-blueprint --id ${blueprint.blueprintId}`);
  } else {
    items.push("Create a custom IDIO blueprint or use individual service CLI commands");
  }

  return items;
}
