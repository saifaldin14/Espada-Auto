/**
 * Tests for the interactive parameter prompter.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createPromptSession, createPromptSessionForBlueprint, resolveParams, applyAnswers } from "./prompter.js";
import type { DeployRecommendation, BlueprintMatch, ProjectAnalysis } from "./types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeAnalysis(overrides?: Partial<ProjectAnalysis>): ProjectAnalysis {
  return {
    projectPath: "/tmp/test-project",
    language: "node",
    framework: "express",
    archetype: "api",
    dependencies: [],
    hasDockerfile: false,
    hasDockerCompose: false,
    hasTests: true,
    envVars: [],
    configFiles: [],
    confidence: 0.8,
    notes: [],
    ...overrides,
  };
}

function makeRecommendation(blueprint?: BlueprintMatch): DeployRecommendation {
  return {
    analysis: makeAnalysis(),
    services: [],
    blueprint,
    alternativeBlueprints: [],
    confidence: "medium",
    summary: "Test",
    actionItems: [],
  };
}

function makeBlueprintMatch(overrides?: Partial<BlueprintMatch>): BlueprintMatch {
  return {
    blueprintId: "web-app-with-sql",
    name: "Web App with SQL Backend",
    matchScore: 0.7,
    inferredParams: { projectName: "test-app", location: "eastus" },
    missingParams: ["sqlAdminLogin", "sqlAdminPassword"],
    ...overrides,
  };
}

// =============================================================================
// createPromptSession
// =============================================================================

describe("createPromptSession", () => {
  it("returns null when no blueprint match", () => {
    const rec = makeRecommendation(undefined);
    expect(createPromptSession(rec)).toBeNull();
  });

  it("creates a session with questions for missing params", () => {
    const match = makeBlueprintMatch();
    const rec = makeRecommendation(match);
    const session = createPromptSession(rec);

    expect(session).not.toBeNull();
    expect(session!.blueprintId).toBe("web-app-with-sql");
    expect(session!.ready).toBe(false);
    expect(session!.questions.length).toBeGreaterThan(0);

    const paramNames = session!.questions.map((q) => q.param);
    expect(paramNames).toContain("sqlAdminLogin");
    expect(paramNames).toContain("sqlAdminPassword");
  });

  it("marks session as ready when all required params are inferred", () => {
    const match = makeBlueprintMatch({
      inferredParams: {
        projectName: "test-app",
        location: "eastus",
        sqlAdminLogin: "adminuser",
        sqlAdminPassword: "P@ssw0rd!",
      },
      missingParams: [],
    });
    const rec = makeRecommendation(match);
    const session = createPromptSession(rec);

    expect(session).not.toBeNull();
    expect(session!.ready).toBe(true);
    expect(session!.questions.filter((q) => q.required)).toHaveLength(0);
  });

  it("includes human-friendly questions from templates", () => {
    const match = makeBlueprintMatch({ missingParams: ["sqlAdminLogin"] });
    const rec = makeRecommendation(match);
    const session = createPromptSession(rec);

    const loginQ = session!.questions.find((q) => q.param === "sqlAdminLogin");
    expect(loginQ).toBeDefined();
    expect(loginQ!.question).toContain("username");
    expect(loginQ!.hint).toBeDefined();
  });

  it("generates a descriptive message", () => {
    const match = makeBlueprintMatch({ missingParams: ["sqlAdminLogin", "sqlAdminPassword"] });
    const rec = makeRecommendation(match);
    const session = createPromptSession(rec);

    expect(session!.message).toContain("2 required parameter");
    expect(session!.message).toContain("sqlAdminLogin");
  });
});

// =============================================================================
// createPromptSessionForBlueprint
// =============================================================================

describe("createPromptSessionForBlueprint", () => {
  it("works with a direct blueprint match", () => {
    const match = makeBlueprintMatch();
    const session = createPromptSessionForBlueprint(match);

    expect(session).not.toBeNull();
    expect(session!.blueprintId).toBe("web-app-with-sql");
  });

  it("returns null for unknown blueprint", () => {
    const match = makeBlueprintMatch({ blueprintId: "nonexistent-blueprint" });
    const session = createPromptSessionForBlueprint(match);

    expect(session).toBeNull();
  });

  it("sorts required params before optional ones", () => {
    const match = makeBlueprintMatch({
      inferredParams: {}, // nothing inferred, so all params appear
      missingParams: ["projectName", "location", "sqlAdminLogin", "sqlAdminPassword"],
    });
    const session = createPromptSessionForBlueprint(match);

    expect(session).not.toBeNull();
    const requiredQ = session!.questions.filter((q) => q.required);
    const optionalQ = session!.questions.filter((q) => !q.required);

    // All required questions should come before optional
    if (requiredQ.length > 0 && optionalQ.length > 0) {
      const lastRequiredIdx = session!.questions.findLastIndex((q) => q.required);
      const firstOptionalIdx = session!.questions.findIndex((q) => !q.required);
      expect(lastRequiredIdx).toBeLessThan(firstOptionalIdx);
    }
  });
});

// =============================================================================
// resolveParams
// =============================================================================

describe("resolveParams", () => {
  it("merges inferred params with user answers", () => {
    const match = makeBlueprintMatch();
    const session = createPromptSessionForBlueprint(match)!;

    const result = resolveParams(session, {
      sqlAdminLogin: "myadmin",
      sqlAdminPassword: "MyP@ss123!",
    });

    expect(result.valid).toBe(true);
    expect(result.stillMissing).toHaveLength(0);
    expect(result.params.projectName).toBe("test-app");
    expect(result.params.location).toBe("eastus");
    expect(result.params.sqlAdminLogin).toBe("myadmin");
    expect(result.params.sqlAdminPassword).toBe("MyP@ss123!");
  });

  it("reports still-missing params when answers are incomplete", () => {
    const match = makeBlueprintMatch();
    const session = createPromptSessionForBlueprint(match)!;

    const result = resolveParams(session, { sqlAdminLogin: "admin" });

    expect(result.valid).toBe(false);
    expect(result.stillMissing).toContain("sqlAdminPassword");
  });

  it("fills in defaults for optional params", () => {
    const match = makeBlueprintMatch();
    const session = createPromptSessionForBlueprint(match)!;

    const result = resolveParams(session, {
      sqlAdminLogin: "admin",
      sqlAdminPassword: "P@ss123!",
    });

    // runtime has a default of "NODE|18-lts"
    expect(result.params.runtime).toBe("NODE|18-lts");
  });

  it("coerces boolean string values", () => {
    const match = makeBlueprintMatch({
      blueprintId: "serverless-functions",
      name: "Serverless Functions",
      inferredParams: { projectName: "test", location: "eastus" },
      missingParams: [],
    });
    const session = createPromptSessionForBlueprint(match)!;

    const result = resolveParams(session, {
      includeServiceBus: "true",
    });

    expect(result.params.includeServiceBus).toBe(true);
  });

  it("coerces number string values", () => {
    const match = makeBlueprintMatch({
      blueprintId: "microservices-backbone",
      name: "Microservices Backbone",
      inferredParams: { projectName: "test", location: "eastus", tenantId: "abc-123" },
      missingParams: [],
    });
    const session = createPromptSessionForBlueprint(match)!;

    const result = resolveParams(session, {
      redisCapacity: "2",
    });

    expect(result.params.redisCapacity).toBe(2);
  });

  it("user answers override inferred params", () => {
    const match = makeBlueprintMatch({
      inferredParams: { projectName: "auto-detected", location: "eastus", sqlAdminLogin: "oldadmin", sqlAdminPassword: "old" },
    });
    const session = createPromptSessionForBlueprint(match)!;

    const result = resolveParams(session, {
      projectName: "user-chosen",
    });

    expect(result.params.projectName).toBe("user-chosen");
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// applyAnswers
// =============================================================================

describe("applyAnswers", () => {
  it("returns null when no blueprint match", () => {
    const rec = makeRecommendation(undefined);
    expect(applyAnswers(rec, {})).toBeNull();
  });

  it("combines session creation and resolution", () => {
    const match = makeBlueprintMatch();
    const rec = makeRecommendation(match);

    const result = applyAnswers(rec, {
      sqlAdminLogin: "admin",
      sqlAdminPassword: "P@ss123!",
    });

    expect(result).not.toBeNull();
    expect(result!.valid).toBe(true);
    expect(result!.params.projectName).toBe("test-app");
  });
});

// =============================================================================
// New blueprint prompter integration
// =============================================================================

describe("prompter with new blueprints", () => {
  it("handles serverless-functions blueprint", () => {
    const match = makeBlueprintMatch({
      blueprintId: "serverless-functions",
      name: "Serverless Functions",
      inferredParams: { projectName: "my-func", location: "westus2" },
      missingParams: [],
    });
    const session = createPromptSessionForBlueprint(match);

    expect(session).not.toBeNull();
    expect(session!.blueprintId).toBe("serverless-functions");
    // All required params provided (projectName + location)
    expect(session!.ready).toBe(true);
  });

  it("handles ai-workload blueprint with missing tenantId", () => {
    const match = makeBlueprintMatch({
      blueprintId: "ai-workload",
      name: "AI Workload",
      inferredParams: { projectName: "my-ai", location: "eastus" },
      missingParams: ["tenantId"],
    });
    const session = createPromptSessionForBlueprint(match);

    expect(session).not.toBeNull();
    expect(session!.ready).toBe(false);

    const tenantQ = session!.questions.find((q) => q.param === "tenantId");
    expect(tenantQ).toBeDefined();
    expect(tenantQ!.required).toBe(true);
    expect(tenantQ!.hint).toContain("Azure Portal");
  });

  it("handles event-driven-pipeline blueprint", () => {
    const match = makeBlueprintMatch({
      blueprintId: "event-driven-pipeline",
      name: "Event-Driven Pipeline",
      inferredParams: { projectName: "my-events", location: "eastus" },
      missingParams: [],
    });
    const session = createPromptSessionForBlueprint(match);

    expect(session).not.toBeNull();
    expect(session!.ready).toBe(true);
  });

  it("handles containerized-api blueprint with missing tenantId", () => {
    const match = makeBlueprintMatch({
      blueprintId: "containerized-api",
      name: "Containerized API",
      inferredParams: { projectName: "my-api", location: "westeurope" },
      missingParams: ["tenantId"],
    });
    const session = createPromptSessionForBlueprint(match);

    expect(session).not.toBeNull();
    expect(session!.ready).toBe(false);

    const tenantQ = session!.questions.find((q) => q.param === "tenantId");
    expect(tenantQ).toBeDefined();
    expect(tenantQ!.required).toBe(true);
  });
});
