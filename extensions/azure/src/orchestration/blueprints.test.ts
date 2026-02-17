/**
 * IDIO — Blueprints Unit Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { clearStepRegistry } from "./registry.js";
import { registerBuiltinStepsDryRun } from "./steps.js";
import { validatePlan } from "./planner.js";
import {
  getBlueprint,
  listBlueprints,
  registerBlueprint,
  webAppWithSqlBlueprint,
  staticWebWithCdnBlueprint,
  apiBackendBlueprint,
  microservicesBackboneBlueprint,
  dataPlatformBlueprint,
  BUILTIN_BLUEPRINTS,
} from "./blueprints.js";
import type { Blueprint } from "./types.js";

describe("Blueprint Registry", () => {
  it("lists all built-in blueprints", () => {
    const list = listBlueprints();
    expect(list.length).toBe(5);
    const ids = list.map((b) => b.id);
    expect(ids).toContain("web-app-with-sql");
    expect(ids).toContain("static-web-with-cdn");
    expect(ids).toContain("api-backend");
    expect(ids).toContain("microservices-backbone");
    expect(ids).toContain("data-platform");
  });

  it("retrieves a blueprint by ID", () => {
    const bp = getBlueprint("web-app-with-sql");
    expect(bp).toBeDefined();
    expect(bp!.name).toBe("Web App with SQL Backend");
  });

  it("returns undefined for unknown blueprint", () => {
    expect(getBlueprint("nonexistent")).toBeUndefined();
  });

  it("registers a custom blueprint", () => {
    const custom: Blueprint = {
      id: "custom",
      name: "Custom",
      description: "Custom blueprint",
      category: "custom",
      parameters: [],
      generate: () => ({ id: "p", name: "P", description: "", steps: [], globalParams: {}, createdAt: new Date().toISOString() }),
    };
    registerBlueprint(custom);
    expect(getBlueprint("custom")).toBeDefined();
  });
});

describe("Blueprint Plan Generation", () => {
  beforeEach(() => {
    clearStepRegistry();
    registerBuiltinStepsDryRun();
  });

  it("web-app-with-sql generates a valid plan", () => {
    const plan = webAppWithSqlBlueprint.generate({
      projectName: "TestProject",
      location: "eastus",
      sqlAdminLogin: "admin",
      sqlAdminPassword: "P@ssw0rd123!",
    });

    expect(plan.name).toContain("TestProject");
    expect(plan.steps.length).toBeGreaterThanOrEqual(4);
    expect(plan.steps.map((s) => s.type)).toContain("create-resource-group");
    expect(plan.steps.map((s) => s.type)).toContain("create-app-service-plan");
    expect(plan.steps.map((s) => s.type)).toContain("create-sql-server");
    expect(plan.steps.map((s) => s.type)).toContain("create-web-app");

    const validation = validatePlan(plan);
    expect(validation.valid).toBe(true);
  });

  it("web-app-with-sql includes Key Vault when requested", () => {
    const plan = webAppWithSqlBlueprint.generate({
      projectName: "KvTest",
      location: "eastus",
      sqlAdminLogin: "admin",
      sqlAdminPassword: "P@ss123!",
      includeKeyVault: true,
      tenantId: "00000000-0000-0000-0000-000000000000",
    });

    expect(plan.steps.map((s) => s.type)).toContain("create-keyvault");
  });

  it("static-web-with-cdn generates a valid plan", () => {
    const plan = staticWebWithCdnBlueprint.generate({
      projectName: "StaticSite",
      location: "westus2",
    });

    expect(plan.steps).toHaveLength(3);
    expect(plan.steps.map((s) => s.type)).toContain("create-resource-group");
    expect(plan.steps.map((s) => s.type)).toContain("create-storage-account");
    expect(plan.steps.map((s) => s.type)).toContain("create-cdn-profile");

    const validation = validatePlan(plan);
    expect(validation.valid).toBe(true);
  });

  it("api-backend generates a valid plan", () => {
    const plan = apiBackendBlueprint.generate({
      projectName: "MyApi",
      location: "northeurope",
      sqlAdminLogin: "admin",
      sqlAdminPassword: "P@ss123!",
      tenantId: "00000000-0000-0000-0000-000000000000",
    });

    expect(plan.steps.length).toBeGreaterThanOrEqual(7);
    const types = plan.steps.map((s) => s.type);
    expect(types).toContain("create-vnet");
    expect(types).toContain("create-nsg");
    expect(types).toContain("create-keyvault");
    expect(types).toContain("create-app-insights");
    expect(types).toContain("create-sql-server");
    expect(types).toContain("create-web-app");

    const validation = validatePlan(plan);
    expect(validation.valid).toBe(true);
  });

  it("microservices-backbone generates a valid plan", () => {
    const plan = microservicesBackboneBlueprint.generate({
      projectName: "MicroSvc",
      location: "eastus2",
      tenantId: "00000000-0000-0000-0000-000000000000",
    });

    expect(plan.steps.length).toBeGreaterThanOrEqual(5);
    const types = plan.steps.map((s) => s.type);
    expect(types).toContain("create-vnet");
    expect(types).toContain("create-servicebus-namespace");
    expect(types).toContain("create-redis-cache");
    expect(types).toContain("create-keyvault");
    expect(types).toContain("create-app-insights");

    const validation = validatePlan(plan);
    expect(validation.valid).toBe(true);
  });

  it("data-platform generates a valid plan", () => {
    const plan = dataPlatformBlueprint.generate({
      projectName: "DataProj",
      location: "westeurope",
    });

    expect(plan.steps.length).toBeGreaterThanOrEqual(4);
    const types = plan.steps.map((s) => s.type);
    expect(types).toContain("create-cosmosdb-account");
    expect(types).toContain("create-storage-account");
    expect(types).toContain("create-redis-cache");

    const validation = validatePlan(plan);
    expect(validation.valid).toBe(true);
  });

  it("all built-in blueprints have required metadata", () => {
    for (const bp of BUILTIN_BLUEPRINTS) {
      expect(bp.id).toBeTruthy();
      expect(bp.name).toBeTruthy();
      expect(bp.description).toBeTruthy();
      expect(bp.category).toBeTruthy();
      expect(typeof bp.generate).toBe("function");
    }
  });
});
