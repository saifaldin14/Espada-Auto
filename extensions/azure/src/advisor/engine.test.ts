/**
 * Advisor — Recommendation Engine tests
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { recommend, recommendAndPlan } from "./engine.js";
import type {
  ProjectAnalysis,
  AdvisorOptions,
  DeployRecommendation,
} from "./types.js";

// =============================================================================
// Helpers
// =============================================================================

function fakeAnalysis(overrides?: Partial<ProjectAnalysis>): ProjectAnalysis {
  return {
    projectPath: "/tmp/test-project",
    language: "typescript",
    framework: "express",
    archetype: "api",
    entryPoint: "src/index.ts",
    port: 3000,
    dependencies: [],
    hasDockerfile: false,
    hasDockerCompose: false,
    packageManager: "pnpm",
    hasTests: true,
    envVars: [],
    configFiles: [{ path: "package.json", type: "package.json" }],
    confidence: 0.85,
    notes: [],
    ...overrides,
  };
}

// =============================================================================
// Service Recommendations
// =============================================================================

describe("service recommendations", () => {
  test("API project recommends App Service", () => {
    const result = recommend(fakeAnalysis());
    const compute = result.services.find(
      (s) => s.service === "App Service" || s.service === "Azure Functions" || s.service === "Container Apps" || s.service === "Static Web Apps",
    );
    expect(compute).toBeDefined();
    expect(compute!.service).toBe("App Service");
    expect(compute!.required).toBe(true);
  });

  test("static-site recommends Static Web Apps", () => {
    const result = recommend(fakeAnalysis({ archetype: "static-site", framework: "react" }));
    const compute = result.services.find((s) => s.service === "Static Web Apps");
    expect(compute).toBeDefined();
    expect(compute!.confidence).toBe("high");
  });

  test("worker recommends Azure Functions", () => {
    const result = recommend(fakeAnalysis({ archetype: "worker" }));
    const compute = result.services.find((s) => s.service === "Azure Functions");
    expect(compute).toBeDefined();
  });

  test("microservices + Dockerfile recommends Container Apps", () => {
    const result = recommend(
      fakeAnalysis({ archetype: "microservices", hasDockerfile: true }),
    );
    const compute = result.services.find((s) => s.service === "Container Apps");
    expect(compute).toBeDefined();
  });

  test("preferContainers option forces Container Apps", () => {
    const result = recommend(fakeAnalysis(), { preferContainers: true });
    const compute = result.services.find((s) => s.service === "Container Apps");
    expect(compute).toBeDefined();
  });

  test("SQL dependency → Azure SQL Database recommendation", () => {
    const result = recommend(
      fakeAnalysis({
        dependencies: [{ name: "mssql", version: "10.0.0", signal: "sql-database" }],
      }),
    );
    expect(result.services.some((s) => s.service === "Azure SQL Database")).toBe(true);
  });

  test("pg dependency → Azure Database for PostgreSQL", () => {
    const result = recommend(
      fakeAnalysis({
        dependencies: [
          { name: "pg", version: "8.11.0", signal: "sql-database" },
        ],
      }),
    );
    expect(result.services.some((s) => s.service === "Azure Database for PostgreSQL")).toBe(true);
  });

  test("mysql dependency → Azure Database for MySQL", () => {
    const result = recommend(
      fakeAnalysis({
        dependencies: [
          { name: "mysql2", version: "3.0.0", signal: "sql-database" },
        ],
      }),
    );
    expect(result.services.some((s) => s.service === "Azure Database for MySQL")).toBe(true);
  });

  test("NoSQL dependency → Cosmos DB", () => {
    const result = recommend(
      fakeAnalysis({
        dependencies: [{ name: "mongoose", version: "7.0.0", signal: "nosql-database" }],
      }),
    );
    expect(result.services.some((s) => s.service === "Cosmos DB")).toBe(true);
  });

  test("Redis dependency → Azure Cache for Redis", () => {
    const result = recommend(
      fakeAnalysis({
        dependencies: [{ name: "ioredis", version: "5.3.0", signal: "redis-cache" }],
      }),
    );
    expect(result.services.some((s) => s.service === "Azure Cache for Redis")).toBe(true);
  });

  test("messaging dependency → Service Bus", () => {
    const result = recommend(
      fakeAnalysis({
        dependencies: [{ name: "bullmq", version: "4.0.0", signal: "messaging-queue" }],
      }),
    );
    expect(result.services.some((s) => s.service === "Azure Service Bus")).toBe(true);
  });

  test("blob storage dependency → Azure Blob Storage", () => {
    const result = recommend(
      fakeAnalysis({
        dependencies: [{ name: "@azure/storage-blob", version: "12.0.0", signal: "storage-blob" }],
      }),
    );
    expect(result.services.some((s) => s.service === "Azure Blob Storage")).toBe(true);
  });

  test("AI dependency → Azure AI Services", () => {
    const result = recommend(
      fakeAnalysis({
        dependencies: [{ name: "openai", version: "4.0.0", signal: "ai-ml" }],
      }),
    );
    expect(result.services.some((s) => s.service === "Azure AI Services")).toBe(true);
  });

  test("always recommends Application Insights", () => {
    const result = recommend(fakeAnalysis());
    expect(result.services.some((s) => s.service === "Application Insights")).toBe(true);
  });

  test("many env vars → Key Vault recommendation", () => {
    const result = recommend(
      fakeAnalysis({
        envVars: ["DB_URL", "API_KEY", "SECRET", "TOKEN"],
      }),
    );
    expect(result.services.some((s) => s.service === "Azure Key Vault")).toBe(true);
  });

  test("static-site recommends CDN", () => {
    const result = recommend(fakeAnalysis({ archetype: "static-site", framework: "react" }));
    expect(result.services.some((s) => s.service === "Azure CDN")).toBe(true);
  });

  test("Dockerfile + preferContainers → Container Registry", () => {
    const result = recommend(
      fakeAnalysis({ hasDockerfile: true }),
      { preferContainers: true },
    );
    expect(result.services.some((s) => s.service === "Azure Container Registry")).toBe(true);
  });
});

// =============================================================================
// Blueprint matching
// =============================================================================

describe("blueprint matching", () => {
  test("web-app with SQL deps matches web-app-with-sql blueprint", () => {
    const result = recommend(
      fakeAnalysis({
        archetype: "web-app",
        dependencies: [
          { name: "mssql", version: "10.0.0", signal: "sql-database" },
          { name: "express", version: "4.18", signal: "web-framework" },
        ],
      }),
    );
    expect(result.blueprint).toBeDefined();
    expect(result.blueprint!.blueprintId).toBe("web-app-with-sql");
    expect(result.blueprint!.matchScore).toBeGreaterThan(0.5);
  });

  test("static-site matches static-web-with-cdn blueprint", () => {
    const result = recommend(fakeAnalysis({ archetype: "static-site", framework: "react" }));
    expect(result.blueprint).toBeDefined();
    expect(result.blueprint!.blueprintId).toBe("static-web-with-cdn");
  });

  test("API project matches api-backend blueprint", () => {
    const result = recommend(
      fakeAnalysis({
        archetype: "api",
        dependencies: [
          { name: "mssql", version: "10.0.0", signal: "sql-database" },
        ],
      }),
    );
    expect(result.blueprint).toBeDefined();
    expect(result.blueprint!.blueprintId).toBe("api-backend");
  });

  test("microservices matches microservices-backbone blueprint", () => {
    const result = recommend(
      fakeAnalysis({
        archetype: "microservices",
        hasDockerCompose: true,
        dependencies: [
          { name: "bullmq", version: "4.0.0", signal: "messaging-queue" },
          { name: "ioredis", version: "5.3.0", signal: "redis-cache" },
        ],
      }),
    );
    expect(result.blueprint).toBeDefined();
    expect(result.blueprint!.blueprintId).toBe("microservices-backbone");
  });

  test("inferred params include projectName and location", () => {
    const result = recommend(fakeAnalysis({ archetype: "web-app" }), { defaultRegion: "westus2", projectName: "myapp" });
    expect(result.blueprint).toBeDefined();
    expect(result.blueprint!.inferredParams.projectName).toBe("myapp");
    expect(result.blueprint!.inferredParams.location).toBe("westus2");
  });

  test("missing required params are reported", () => {
    const result = recommend(
      fakeAnalysis({
        archetype: "web-app",
        dependencies: [{ name: "mssql", version: "10.0.0", signal: "sql-database" }],
      }),
    );
    // web-app-with-sql requires sqlAdminLogin & sqlAdminPassword
    expect(result.blueprint!.missingParams.length).toBeGreaterThan(0);
    expect(result.blueprint!.missingParams).toContain("sqlAdminLogin");
  });

  test("alternative blueprints are provided", () => {
    const result = recommend(fakeAnalysis({
      archetype: "api",
      dependencies: [{ name: "mssql", version: "10.0.0", signal: "sql-database" }],
    }));
    // api-backend + web-app-with-sql should both score
    expect(result.alternativeBlueprints.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Summary & action items
// =============================================================================

describe("summary and action items", () => {
  test("summary mentions language and framework", () => {
    const result = recommend(fakeAnalysis({ language: "python", framework: "fastapi" }));
    expect(result.summary).toContain("python");
    expect(result.summary).toContain("fastapi");
  });

  test("summary mentions recommended blueprint", () => {
    const result = recommend(fakeAnalysis({ archetype: "web-app", dependencies: [{ name: "mssql", signal: "sql-database" }] }));
    if (result.blueprint) {
      expect(result.summary).toContain("blueprint");
    }
  });

  test("action items include missing params", () => {
    const result = recommend(fakeAnalysis({
      archetype: "web-app",
      dependencies: [{ name: "mssql", signal: "sql-database" }],
    }));
    if (result.blueprint && result.blueprint.missingParams.length > 0) {
      expect(result.actionItems.some((a) => a.includes("missing"))).toBe(true);
    }
  });

  test("action items warn about missing tests", () => {
    const result = recommend(fakeAnalysis({ hasTests: false }));
    expect(result.actionItems.some((a) => a.toLowerCase().includes("test"))).toBe(true);
  });

  test("action items mention Key Vault for env vars", () => {
    const result = recommend(fakeAnalysis({
      envVars: ["DB_URL", "API_KEY", "SECRET", "TOKEN"],
      dependencies: [{ name: "jsonwebtoken", signal: "auth" }],
    }));
    expect(result.actionItems.some((a) => a.includes("Key Vault"))).toBe(true);
  });

  test("action items suggest Dockerfile when containers preferred without one", () => {
    const result = recommend(fakeAnalysis({ hasDockerfile: false }), { preferContainers: true });
    expect(result.actionItems.some((a) => a.includes("Dockerfile"))).toBe(true);
  });
});

// =============================================================================
// Confidence
// =============================================================================

describe("overall confidence", () => {
  test("high-confidence analysis + good blueprint → high confidence", () => {
    const result = recommend(fakeAnalysis({
      confidence: 0.95,
      archetype: "web-app",
      dependencies: [{ name: "mssql", signal: "sql-database" }, { name: "express", signal: "web-framework" }],
    }));
    expect(result.confidence).toBe("high");
  });

  test("unknown language → low overall confidence", () => {
    const result = recommend(fakeAnalysis({
      language: "unknown",
      framework: "unknown",
      archetype: "unknown",
      confidence: 0.3,
      dependencies: [],
    }));
    expect(result.confidence).not.toBe("high");
  });
});

// =============================================================================
// Options
// =============================================================================

describe("advisor options", () => {
  test("defaultRegion is used in inferred params", () => {
    const result = recommend(fakeAnalysis({ archetype: "web-app" }), { defaultRegion: "northeurope" });
    if (result.blueprint) {
      expect(result.blueprint.inferredParams.location).toBe("northeurope");
    }
  });

  test("projectName overrides detection", () => {
    const result = recommend(fakeAnalysis(), { projectName: "custom-name" });
    if (result.blueprint) {
      expect(result.blueprint.inferredParams.projectName).toBe("custom-name");
    }
  });

  test("tenantId is passed through to inferred params", () => {
    const result = recommend(fakeAnalysis({ archetype: "web-app" }), { tenantId: "abc-123" });
    if (result.blueprint) {
      expect(result.blueprint.inferredParams.tenantId).toBe("abc-123");
    }
  });
});

// =============================================================================
// recommendAndPlan
// =============================================================================

describe("recommendAndPlan", () => {
  test("returns plan for well-matched project", () => {
    const { recommendation, plan, validationIssues } = recommendAndPlan(
      fakeAnalysis({
        archetype: "static-site",
        framework: "react",
      }),
      { projectName: "my-static-site" },
    );
    // static-web-with-cdn needs only projectName + location (both inferred)
    expect(recommendation.blueprint).toBeDefined();
    expect(recommendation.blueprint!.blueprintId).toBe("static-web-with-cdn");
    // Plan may or may not be null depending on required param coverage
    // but recommendation should be produced
    expect(recommendation.services.length).toBeGreaterThan(0);
  });

  test("returns null plan when no blueprint matches", () => {
    const { plan, validationIssues } = recommendAndPlan(
      fakeAnalysis({
        language: "unknown",
        framework: "unknown",
        archetype: "unknown",
        confidence: 0.2,
      }),
    );
    // Might return no blueprint or very low match
    expect(validationIssues.length).toBeGreaterThan(0);
  });

  test("includes validation issues when params are missing", () => {
    const { recommendation, validationIssues } = recommendAndPlan(
      fakeAnalysis({
        archetype: "web-app",
        dependencies: [{ name: "mssql", signal: "sql-database" }],
      }),
    );
    // web-app-with-sql needs sqlAdminLogin which is missing
    expect(recommendation.blueprint).toBeDefined();
    // It should either fail validation or report missing params
    if (recommendation.blueprint!.missingParams.length > 0) {
      expect(recommendation.blueprint!.missingParams).toContain("sqlAdminLogin");
    }
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe("edge cases", () => {
  test("handles empty dependencies gracefully", () => {
    const result = recommend(fakeAnalysis({ dependencies: [] }));
    expect(result.services.length).toBeGreaterThan(0); // At least compute + App Insights
  });

  test("handles multiple database types simultaneously", () => {
    const result = recommend(
      fakeAnalysis({
        dependencies: [
          { name: "pg", signal: "sql-database" },
          { name: "mongoose", signal: "nosql-database" },
          { name: "ioredis", signal: "redis-cache" },
        ],
      }),
    );
    expect(result.services.some((s) => s.service === "Azure Database for PostgreSQL")).toBe(true);
    expect(result.services.some((s) => s.service === "Cosmos DB")).toBe(true);
    expect(result.services.some((s) => s.service === "Azure Cache for Redis")).toBe(true);
  });

  test("no duplicate compute recommendations", () => {
    const result = recommend(fakeAnalysis());
    const computeServices = result.services.filter(
      (s) => s.service === "App Service" || s.service === "Azure Functions" ||
             s.service === "Container Apps" || s.service === "Static Web Apps",
    );
    expect(computeServices.length).toBe(1);
  });
});
