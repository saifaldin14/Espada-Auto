import { describe, it, expect } from "vitest";
import { IntentCompiler, createIntentCompiler } from "./compiler.js";
import type { ApplicationIntent } from "./types.js";

function makeMinimalIntent(overrides: Partial<ApplicationIntent> = {}): ApplicationIntent {
  return {
    name: "test-app",
    environment: "production",
    region: "eastus",
    tiers: [
      {
        name: "web",
        type: "web",
        compute: { platform: "app-service", runtime: "node", size: "small" },
      },
    ],
    ...overrides,
  };
}

describe("IntentCompiler", () => {
  it("creates via factory", () => {
    const compiler = createIntentCompiler({ defaultRegion: 'westus2' });
    expect(compiler).toBeInstanceOf(IntentCompiler);
  });

  it("compiles a minimal intent into a plan", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const intent = makeMinimalIntent();
    const plan = compiler.compile(intent);
    expect(plan).toBeDefined();
    expect(plan.resources.length).toBeGreaterThan(0);
    expect(plan.estimatedMonthlyCostUsd).toBeGreaterThanOrEqual(0);
    expect(plan.executionOrder).toBeDefined();
    expect(plan.executionOrder.length).toBeGreaterThan(0);
    expect(plan.rollbackPlan).toBeDefined();
  });

  it("includes resource group in compiled resources", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const plan = compiler.compile(makeMinimalIntent());
    const rgResource = plan.resources.find((r) => r.type === "Microsoft.Resources/resourceGroups");
    expect(rgResource).toBeDefined();
  });

  it("includes compute resource for app-service tier", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const plan = compiler.compile(makeMinimalIntent());
    const computeResource = plan.resources.find((r) => r.type === "Microsoft.Web/serverfarms" || r.type === "Microsoft.Web/sites");
    expect(computeResource).toBeDefined();
  });

  it("compiles intent with data tier", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const intent = makeMinimalIntent({
      tiers: [
        {
          name: "api",
          type: "api",
          compute: { platform: "container-app", runtime: "python", size: "medium" },
        },
        {
          name: "database",
          type: "data",
          dataStore: { engine: "postgresql", tier: "standard", sizeGb: 100 },
        },
      ],
    });
    const plan = compiler.compile(intent);
    const dbResource = plan.resources.find((r) => r.type.includes("DBforPostgreSQL") || r.type.includes("flexibleServers"));
    expect(dbResource).toBeDefined();
  });

  it("compiles intent with networking", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const intent = makeMinimalIntent({
      tiers: [
        {
          name: "web",
          type: "web",
          compute: { platform: "app-service", runtime: "node", size: "small" },
          networking: { vnet: true, publicAccess: true, ssl: true },
        },
      ],
    });
    const plan = compiler.compile(intent);
    const vnetResource = plan.resources.find((r) => r.type === "Microsoft.Network/virtualNetworks");
    expect(vnetResource).toBeDefined();
  });

  it("compiles intent with security requirements", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const intent = makeMinimalIntent({
      security: { encryptionAtRest: true, waf: true },
    });
    const plan = compiler.compile(intent);
    const kvResource = plan.resources.find((r) => r.type === "Microsoft.KeyVault/vaults");
    expect(kvResource).toBeDefined();
  });

  it("validates a valid intent", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const result = compiler.validateIntent(makeMinimalIntent());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects intent without name", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const result = compiler.validateIntent({ environment: "production", tiers: [] } as never);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects intent without tiers", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const result = compiler.validateIntent({ name: "test", environment: "prod" } as never);
    expect(result.valid).toBe(false);
  });

  it("estimates cost", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const estimate = compiler.estimateCost(makeMinimalIntent());
    expect(estimate.estimatedMonthlyCostUsd).toBeGreaterThan(0);
    expect(estimate.breakdown.length).toBeGreaterThan(0);
    for (const item of estimate.breakdown) {
      expect(item.resourceName).toBeTruthy();
      expect(item.monthlyCostUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it("generates rollback plan", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const plan = compiler.compile(makeMinimalIntent());
    expect(plan.rollbackPlan.steps.length).toBeGreaterThan(0);
    for (const step of plan.rollbackPlan.steps) {
      expect(step.action).toBeTruthy();
      expect(step.resourceId).toBeTruthy();
    }
  });

  it("performs guardrail checks", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const plan = compiler.compile(makeMinimalIntent());
    expect(plan.guardrailChecks).toBeDefined();
    expect(Array.isArray(plan.guardrailChecks)).toBe(true);
  });

  it("handles AKS compute platform", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const intent = makeMinimalIntent({
      tiers: [
        {
          name: "k8s",
          type: "web",
          compute: { platform: "aks", runtime: "dotnet", size: "large" },
        },
      ],
    });
    const plan = compiler.compile(intent);
    const aksResource = plan.resources.find((r) => r.type === "Microsoft.ContainerService/managedClusters");
    expect(aksResource).toBeDefined();
  });

  it("handles functions compute platform", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const intent = makeMinimalIntent({
      tiers: [
        {
          name: "serverless",
          type: "api",
          compute: { platform: "functions", runtime: "node", size: "small" },
        },
      ],
    });
    const plan = compiler.compile(intent);
    const fnResource = plan.resources.find((r) => r.type === "Microsoft.Web/sites" && r.properties?.kind === "functionapp");
    expect(fnResource).toBeDefined();
  });

  it("compiles intent with multiple data store engines", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const intent = makeMinimalIntent({
      tiers: [
        {
          name: "api",
          type: "api",
          compute: { platform: "app-service", runtime: "java", size: "medium" },
        },
        {
          name: "cosmosdb",
          type: "data",
          dataStore: { engine: "cosmosdb", tier: "standard" },
        },
        {
          name: "cache",
          type: "cache",
          dataStore: { engine: "redis", tier: "standard" },
        },
      ],
    });
    const plan = compiler.compile(intent);
    const cosmosResource = plan.resources.find((r) => r.type.includes("DocumentDB") || r.type.includes("cosmos"));
    const redisResource = plan.resources.find((r) => r.type.includes("Cache/Redis") || r.type.includes("redis"));
    expect(cosmosResource).toBeDefined();
    expect(redisResource).toBeDefined();
  });

  it("generates monitoring resources", () => {
    const compiler = createIntentCompiler({ defaultRegion: "eastus" });
    const plan = compiler.compile(makeMinimalIntent());
    const monitorResource = plan.resources.find((r) => r.type.includes("Insights") || r.type.includes("insights"));
    expect(monitorResource).toBeDefined();
  });
});
