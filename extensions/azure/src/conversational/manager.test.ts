import { describe, it, expect } from "vitest";
import { AzureConversationalManager, createConversationalManager } from "./manager.js";
import type { TrackedResource } from "./types.js";

function makeResource(id: string, overrides: Partial<TrackedResource> = {}): TrackedResource {
  return {
    id,
    type: "Microsoft.Compute/virtualMachines",
    name: id.split("/").pop() ?? id,
    resourceGroup: "rg-test",
    region: "eastus",
    status: "active",
    tags: {},
    properties: {},
    trackedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("AzureConversationalManager", () => {
  it("creates via factory", () => {
    const mgr = createConversationalManager("sub-123");
    expect(mgr).toBeInstanceOf(AzureConversationalManager);
  });

  it("returns empty context initially", () => {
    const mgr = createConversationalManager("sub-123");
    const ctx = mgr.getContext();
    expect(ctx.subscriptionId).toBe("sub-123");
    expect(ctx.resources).toHaveLength(0);
  });

  it("tracks and untracks resources", () => {
    const mgr = createConversationalManager("sub-123");
    mgr.trackResource(makeResource("r1", { name: "vm1" }));
    const ctx = mgr.getContext();
    expect(ctx.resources).toHaveLength(1);
    expect(ctx.resources[0].name).toBe("vm1");

    mgr.untrackResource("r1");
    const ctx2 = mgr.getContext();
    expect(ctx2.resources).toHaveLength(0);
  });

  it("queries with 'list' category", () => {
    const mgr = createConversationalManager("sub-123");
    const result = mgr.query("list all virtual machines");
    expect(result.query.category).toBe("list");
    expect(result.answer).toBeTruthy();
  });

  it("queries with 'count' category", () => {
    const mgr = createConversationalManager("sub-123");
    const result = mgr.query("how many storage accounts do I have");
    expect(result.query.category).toBe("count");
  });

  it("queries with 'status' category", () => {
    const mgr = createConversationalManager("sub-123");
    const result = mgr.query("what is the status of my resources");
    expect(result.query.category).toBe("status");
  });

  it("queries with 'cost' category", () => {
    const mgr = createConversationalManager("sub-123");
    const result = mgr.query("how much is this costing me");
    expect(result.query.category).toBe("cost");
  });

  it("queries with 'security' category", () => {
    const mgr = createConversationalManager("sub-123");
    const result = mgr.query("are there any security vulnerabilities");
    expect(result.query.category).toBe("security");
  });

  it("detects resource types in queries", () => {
    const mgr = createConversationalManager("sub-123");
    const result = mgr.query("list all databases");
    expect(result).toBeDefined();
    expect(result.answer).toBeTruthy();
  });

  it("provides suggestions on queries", () => {
    const mgr = createConversationalManager("sub-123");
    const result = mgr.query("show me my infrastructure");
    expect(result.suggestions).toBeDefined();
    expect(Array.isArray(result.suggestions)).toBe(true);
  });

  it("generates insights for tracked resources", () => {
    const mgr = createConversationalManager("sub-123");
    mgr.trackResource(makeResource("r1", { name: "vm1", tags: {} }));
    const insights = mgr.getInsights();
    expect(Array.isArray(insights)).toBe(true);
    const tagInsight = insights.find((i) => i.title.toLowerCase().includes("tag"));
    expect(tagInsight).toBeDefined();
  });

  it("returns empty insights with no tracked resources", () => {
    const mgr = createConversationalManager("sub-123");
    const insights = mgr.getInsights();
    expect(insights).toHaveLength(0);
  });

  it("lists wizard templates", () => {
    const mgr = createConversationalManager("sub-123");
    const wizards = mgr.listWizards();
    expect(wizards.length).toBeGreaterThan(0);
    for (const w of wizards) {
      expect(w.id).toBeTruthy();
      expect(w.name).toBeTruthy();
      expect(w.steps.length).toBeGreaterThan(0);
    }
  });

  it("starts and advances wizard", () => {
    const mgr = createConversationalManager("sub-123");
    const wizards = mgr.listWizards();
    const firstWizard = wizards[0];
    const ws = mgr.startWizard(firstWizard.id);
    expect(ws).not.toBeNull();
    expect(ws!.templateId).toBe(firstWizard.id);
    expect(ws!.currentStep).toBe(0);
    expect(ws!.completed).toBe(false);

    // Advance with dummy answers for current step fields
    const answers: Record<string, unknown> = {};
    for (const field of firstWizard.steps[0].fields) {
      answers[field.name] = field.default ?? "test-value";
    }
    const ws2 = mgr.wizardNext(ws!.sessionId, answers);
    expect(ws2).not.toBeNull();
    expect(ws2!.currentStep === 1 || ws2!.completed).toBe(true);
  });

  it("returns null for unknown wizard id", () => {
    const mgr = createConversationalManager("sub-123");
    expect(mgr.startWizard("nonexistent-wizard")).toBeNull();
  });

  it("gets wizard state", () => {
    const mgr = createConversationalManager("sub-123");
    const wizards = mgr.listWizards();
    const ws = mgr.startWizard(wizards[0].id);
    expect(ws).not.toBeNull();
    const fetched = mgr.getWizardState(ws!.sessionId);
    expect(fetched).toBeDefined();
    expect(fetched!.templateId).toBe(wizards[0].id);
  });

  it("generates infrastructure summary", () => {
    const mgr = createConversationalManager("sub-123");
    mgr.trackResource(makeResource("r1", { type: "Microsoft.Compute/virtualMachines", name: "vm1", region: "eastus", status: "healthy" }));
    mgr.trackResource(makeResource("r2", { type: "Microsoft.Storage/storageAccounts", name: "sa1", region: "westus2", status: "warning", tags: { env: "prod" } }));
    const summary = mgr.getSummary();
    expect(summary.totalResources).toBe(2);
    expect(summary.healthStatus.healthy).toBeGreaterThanOrEqual(0);
    expect(summary.healthStatus.degraded).toBeGreaterThanOrEqual(0);
    expect(Object.keys(summary.byRegion)).toContain("eastus");
    expect(Object.keys(summary.byRegion)).toContain("westus2");
  });
});
