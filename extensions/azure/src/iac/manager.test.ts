import { describe, it, expect } from "vitest";
import { AzureIaCManager, createIaCManager } from "./manager.js";
import type { ResourceDefinition } from "./types.js";

function makeSampleDefinitions(): ResourceDefinition[] {
  return [
    {
      name: "test-rg",
      type: "Microsoft.Resources/resourceGroups",
      resourceGroup: "test-rg",
      region: "eastus",
      properties: {},
      dependsOn: [],
      tags: {},
    },
    {
      name: "test-vnet",
      type: "Microsoft.Network/virtualNetworks",
      resourceGroup: "test-rg",
      region: "eastus",
      properties: { addressSpace: { addressPrefixes: ["10.0.0.0/16"] } },
      dependsOn: ["test-rg"],
      tags: {},
    },
    {
      name: "test-kv",
      type: "Microsoft.KeyVault/vaults",
      resourceGroup: "test-rg",
      region: "eastus",
      properties: { sku: { name: "standard" }, tenantId: "tenant-123" },
      dependsOn: ["test-rg"],
      tags: {},
    },
    {
      name: "test-app",
      type: "Microsoft.Web/sites",
      resourceGroup: "test-rg",
      region: "eastus",
      properties: { serverFarmId: "plan-1", httpsOnly: true },
      dependsOn: ["test-vnet", "test-kv"],
      tags: {},
    },
  ];
}

describe("AzureIaCManager", () => {
  it("creates via factory", () => {
    const mgr = createIaCManager();
    expect(mgr).toBeInstanceOf(AzureIaCManager);
  });

  it("generates Terraform from definitions", () => {
    const mgr = createIaCManager();
    const result = mgr.generateFromDefinitions(makeSampleDefinitions(), { format: "terraform" });
    expect(result.format).toBe("terraform");
    expect(result.content).toContain("terraform");
    expect(result.content).toContain("azurerm");
    expect(result.resourceCount).toBeGreaterThan(0);
  });

  it("generates Bicep from definitions", () => {
    const mgr = createIaCManager();
    const result = mgr.generateFromDefinitions(makeSampleDefinitions(), { format: "bicep" });
    expect(result.format).toBe("bicep");
    expect(result.content).toContain("param");
    expect(result.content).toContain("resource");
    expect(result.resourceCount).toBeGreaterThan(0);
  });

  it("generates ARM template from definitions", () => {
    const mgr = createIaCManager();
    const result = mgr.generateFromDefinitions(makeSampleDefinitions(), { format: "arm" });
    expect(result.format).toBe("arm");
    const parsed = JSON.parse(result.content);
    expect(parsed.$schema).toBeTruthy();
    expect(parsed.resources).toBeDefined();
    expect(parsed.resources.length).toBeGreaterThan(0);
  });

  it("generates from infrastructure plan resources", () => {
    const mgr = createIaCManager();
    const resources = [
      { id: "rg", name: "test-rg", type: "Microsoft.Resources/resourceGroups", region: "eastus", resourceGroup: "test-rg", sku: "n/a", properties: {}, dependsOn: [], estimatedMonthlyCostUsd: 0, tier: "rg", tags: {} },
      { id: "sa", name: "testsa", type: "Microsoft.Storage/storageAccounts", region: "eastus", resourceGroup: "test-rg", sku: "Standard_LRS", properties: { kind: "StorageV2" }, dependsOn: ["rg"], estimatedMonthlyCostUsd: 20, tier: "data", tags: {} },
    ];
    const result = mgr.generate(resources as never[], { format: "terraform" });
    expect(result.format).toBe("terraform");
    expect(result.content).toContain("azurerm");
    expect(result.resourceCount).toBeGreaterThan(0);
  });

  it("detects drift between desired and actual", () => {
    const mgr = createIaCManager();
    const desired: ResourceDefinition = {
      name: "test-resource",
      type: "Microsoft.Web/sites",
      resourceGroup: "rg-test",
      region: "eastus",
      properties: { httpsOnly: true, minTlsVersion: "1.2" },
      dependsOn: [],
      tags: { env: "prod" },
    };
    const actual: ResourceDefinition = {
      name: "test-resource",
      type: "Microsoft.Web/sites",
      resourceGroup: "rg-test",
      region: "eastus",
      properties: { httpsOnly: false, minTlsVersion: "1.0" },
      dependsOn: [],
      tags: { env: "staging" },
    };
    const drift = mgr.detectDrift(desired, actual);
    expect(drift.driftDetected).toBe(true);
    expect(drift.changes.length).toBeGreaterThan(0);
  });

  it("detects no drift for identical resources", () => {
    const mgr = createIaCManager();
    const resource: ResourceDefinition = {
      name: "test-resource",
      type: "Microsoft.Web/sites",
      resourceGroup: "rg-test",
      region: "eastus",
      properties: { httpsOnly: true },
      dependsOn: [],
      tags: { env: "prod" },
    };
    const drift = mgr.detectDrift(resource, resource);
    expect(drift.driftDetected).toBe(false);
    expect(drift.changes).toHaveLength(0);
  });

  it("exports state from resources", () => {
    const mgr = createIaCManager();
    const resources: ResourceDefinition[] = [
      { name: "app1", type: "Microsoft.Web/sites", resourceGroup: "rg-test", region: "eastus", properties: { httpsOnly: true }, dependsOn: [], tags: {} },
      { name: "sa1", type: "Microsoft.Storage/storageAccounts", resourceGroup: "rg-test", region: "eastus", properties: {}, dependsOn: [], tags: {} },
    ];
    const exported = mgr.exportState(resources, "terraform");
    expect(exported.resources.length).toBe(2);
    expect(exported.exportedAt).toBeTruthy();
  });

  it("includes Terraform variables when option is set", () => {
    const mgr = createIaCManager();
    const result = mgr.generateFromDefinitions(makeSampleDefinitions(), { format: "terraform", includeVariables: true });
    expect(result.content).toContain("variable");
  });

  it("includes Terraform outputs when option is set", () => {
    const mgr = createIaCManager();
    const result = mgr.generateFromDefinitions(makeSampleDefinitions(), { format: "terraform", includeOutputs: true });
    expect(result.content).toContain("output");
  });
});
