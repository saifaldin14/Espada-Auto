/**
 * Extension Bridge — Unit Tests
 *
 * Tests the runtime extension bridge that lazy-resolves sibling extensions
 * (audit-trail, policy-engine, cost-governance, knowledge-graph) and the
 * wiring into audit-logger, policy-checker, cost-estimator, and graph modules.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  resolveExtensions,
  getResolvedExtensions,
  resetExtensionBridge,
  type ResolvedExtensions,
  type BridgeLogger,
  type AuditLoggerLike,
  type PolicyEngineLike,
  type BudgetManagerLike,
  type KnowledgeGraphLike,
} from "../src/integrations/extension-bridge.js";

import {
  checkMigrationBudget,
  type BudgetCheckResult,
} from "../src/core/cost-estimator.js";

import {
  pushDiscoveryToKnowledgeGraph,
  MigrationGraphAdapter,
  type DiscoveryResult,
} from "../src/graph/migration-adapter.js";

import {
  syncPostMigrationToKnowledgeGraph,
  generatePostMigrationUpdates,
  type ResourceMapping,
} from "../src/graph/post-migration-sync.js";

import type { MigrationJob, NormalizedVM, NormalizedBucket } from "../src/types.js";

// =============================================================================
// Helpers
// =============================================================================

function createTestLogger(): BridgeLogger & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    info: (...args: unknown[]) => messages.push(`INFO: ${args.join(" ")}`),
    warn: (...args: unknown[]) => messages.push(`WARN: ${args.join(" ")}`),
    error: (...args: unknown[]) => messages.push(`ERROR: ${args.join(" ")}`),
  };
}

function createMockBudgetManager(budgets: Record<string, { id: string; monthlyLimit: number; currentSpend: number }>): BudgetManagerLike {
  return {
    getAllStatuses() {
      return Object.values(budgets).map((b) => ({
        ...b,
        name: b.id,
        status: b.currentSpend <= b.monthlyLimit ? "ok" : "exceeded",
        utilization: b.monthlyLimit > 0 ? Math.round((b.currentSpend / b.monthlyLimit) * 100) : 0,
      }));
    },
    findBudget(scope: string, scopeId: string) {
      const key = `${scope}:${scopeId}`;
      return budgets[key] ?? null;
    },
  };
}

function createMockKnowledgeGraph(): KnowledgeGraphLike & { _nodes: unknown[]; _edges: unknown[]; _deleted: string[] } {
  const _nodes: unknown[] = [];
  const _edges: unknown[] = [];
  const _deleted: string[] = [];
  return {
    _nodes,
    _edges,
    _deleted,
    async upsertNodes(nodes) {
      _nodes.push(...nodes);
    },
    async upsertEdges(edges) {
      _edges.push(...edges);
    },
    async deleteNode(id) {
      _deleted.push(id);
    },
  };
}

function makeMinimalJob(overrides?: Partial<MigrationJob>): MigrationJob {
  return {
    id: "job-1",
    phase: "completed",
    source: { provider: "aws", region: "us-east-1", credentials: { type: "env" } },
    target: { provider: "azure", region: "eastus", credentials: { type: "env" } },
    plan: { steps: [], estimatedDurationMs: 0, resourceTypes: ["vm"], direction: "aws-to-azure" },
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as MigrationJob;
}

function makeMinimalVM(id: string, provider: string): NormalizedVM {
  return {
    id,
    name: `vm-${id}`,
    provider: provider as NormalizedVM["provider"],
    region: "us-east-1",
    cpuCores: 4,
    memoryGB: 16,
    osType: "linux",
    architecture: "x86_64",
    disks: [{ id: `disk-${id}`, sizeGB: 100, type: "ssd", deviceName: "/dev/sda1", encrypted: false }],
    networkInterfaces: [
      { id: `nic-${id}`, privateIp: "10.0.0.1", subnetId: "subnet-1", securityGroupIds: [] },
    ],
    tags: {},
  } as NormalizedVM;
}

function makeMinimalBucket(id: string, provider: string): NormalizedBucket {
  return {
    id,
    name: `bucket-${id}`,
    provider: provider as NormalizedBucket["provider"],
    region: "us-east-1",
    encryption: "AES256",
    versioning: false,
    totalSizeBytes: 1024 * 1024,
    objectCount: 10,
    tags: {},
  } as NormalizedBucket;
}

// =============================================================================
// Tests — Extension Bridge Lifecycle
// =============================================================================

describe("extension bridge — lifecycle", () => {
  beforeEach(() => {
    resetExtensionBridge();
  });

  it("getResolvedExtensions returns null before resolveExtensions is called", () => {
    expect(getResolvedExtensions()).toBeNull();
  });

  it("resolveExtensions resolves and caches the result", async () => {
    const log = createTestLogger();
    const ext = await resolveExtensions(log);
    expect(ext).toBeDefined();
    expect(ext).toHaveProperty("auditLogger");
    expect(ext).toHaveProperty("policyEngine");
    expect(ext).toHaveProperty("budgetManager");
    expect(ext).toHaveProperty("knowledgeGraph");
    // Second call returns the same cached instance
    const ext2 = await resolveExtensions(log);
    expect(ext2).toBe(ext);
  });

  it("getResolvedExtensions returns the resolved extensions after resolve", async () => {
    const ext = await resolveExtensions();
    expect(getResolvedExtensions()).toBe(ext);
  });

  it("resetExtensionBridge clears the cache", async () => {
    await resolveExtensions();
    expect(getResolvedExtensions()).not.toBeNull();
    resetExtensionBridge();
    expect(getResolvedExtensions()).toBeNull();
  });

  it("each resolved extension field is either an object or null", async () => {
    const ext = await resolveExtensions();
    for (const key of ["auditLogger", "policyEngine", "budgetManager", "knowledgeGraph"] as const) {
      const val = ext[key];
      expect(val === null || typeof val === "object").toBe(true);
    }
  });
});

// =============================================================================
// Tests — Budget Check (cost-governance bridge)
// =============================================================================

describe("extension bridge — budget check", () => {
  beforeEach(() => {
    resetExtensionBridge();
  });

  it("returns withinBudget=true with a warning when bridge is not resolved", () => {
    const result = checkMigrationBudget(5000);
    expect(result.withinBudget).toBe(true);
    expect(result.warning).toContain("not available");
  });

  it("returns withinBudget=true when no matching budget is found", async () => {
    // Inject a mock via the bridge
    const ext = await resolveExtensions();
    // Override the budgetManager property
    (ext as { budgetManager: BudgetManagerLike }).budgetManager = createMockBudgetManager({});
    const result = checkMigrationBudget(5000, "project", "nonexistent");
    expect(result.withinBudget).toBe(true);
    expect(result.warning).toContain("No budget found");
  });

  it("checks budget when cost fits within limit", async () => {
    const ext = await resolveExtensions();
    (ext as { budgetManager: BudgetManagerLike }).budgetManager = createMockBudgetManager({
      "project:cloud-migration": { id: "budget-1", monthlyLimit: 10000, currentSpend: 2000 },
    });
    const result = checkMigrationBudget(3000);
    expect(result.withinBudget).toBe(true);
    expect(result.projectedSpend).toBe(5000);
    expect(result.utilization).toBe(50);
    expect(result.budgetId).toBe("budget-1");
  });

  it("detects budget exceeded", async () => {
    const ext = await resolveExtensions();
    (ext as { budgetManager: BudgetManagerLike }).budgetManager = createMockBudgetManager({
      "project:cloud-migration": { id: "budget-2", monthlyLimit: 5000, currentSpend: 3000 },
    });
    const result = checkMigrationBudget(5000);
    expect(result.withinBudget).toBe(false);
    expect(result.projectedSpend).toBe(8000);
    expect(result.warning).toContain("exceed budget");
  });

  it("warns when utilization exceeds 80%", async () => {
    const ext = await resolveExtensions();
    (ext as { budgetManager: BudgetManagerLike }).budgetManager = createMockBudgetManager({
      "project:cloud-migration": { id: "budget-3", monthlyLimit: 10000, currentSpend: 7500 },
    });
    const result = checkMigrationBudget(1000);
    expect(result.withinBudget).toBe(true);
    expect(result.utilization).toBe(85);
    expect(result.warning).toContain("85%");
  });

  it("handles budget manager errors gracefully", async () => {
    const ext = await resolveExtensions();
    (ext as { budgetManager: BudgetManagerLike }).budgetManager = {
      getAllStatuses: () => { throw new Error("DB error"); },
      findBudget: () => { throw new Error("DB error"); },
    };
    const result = checkMigrationBudget(5000);
    expect(result.withinBudget).toBe(true);
    expect(result.warning).toContain("Budget check failed");
  });
});

// =============================================================================
// Tests — Knowledge Graph Push (migration adapter bridge)
// =============================================================================

describe("extension bridge — knowledge graph push (migration adapter)", () => {
  beforeEach(() => {
    resetExtensionBridge();
  });

  it("returns null when KG is not available", async () => {
    const result = await pushDiscoveryToKnowledgeGraph({
      provider: "cloud-migration",
      nodes: [],
      edges: [],
      errors: [],
      durationMs: 0,
    });
    expect(result).toBeNull();
  });

  it("pushes discovery nodes and edges to KG", async () => {
    const ext = await resolveExtensions();
    const mockKG = createMockKnowledgeGraph();
    (ext as { knowledgeGraph: KnowledgeGraphLike }).knowledgeGraph = mockKG;

    const adapter = new MigrationGraphAdapter();
    const discovery = adapter.discover({
      vms: [makeMinimalVM("vm-1", "aws")],
      buckets: [makeMinimalBucket("b-1", "aws")],
      securityRules: [],
      jobs: [makeMinimalJob()],
    });

    const result = await pushDiscoveryToKnowledgeGraph(discovery);
    expect(result).not.toBeNull();
    expect(result!.nodesUpserted).toBeGreaterThan(0);
    expect(mockKG._nodes.length).toBe(discovery.nodes.length);
    expect(mockKG._edges.length).toBe(discovery.edges.length);
  });

  it("gracefully degrades on KG upsert error", async () => {
    const ext = await resolveExtensions();
    (ext as { knowledgeGraph: KnowledgeGraphLike }).knowledgeGraph = {
      upsertNodes: async () => { throw new Error("storage full"); },
      upsertEdges: async () => {},
      deleteNode: async () => {},
    };

    const result = await pushDiscoveryToKnowledgeGraph({
      provider: "cloud-migration",
      nodes: [{ id: "n1", type: "vm", label: "test", properties: {}, provider: "aws" }],
      edges: [],
      errors: [],
      durationMs: 100,
    });
    expect(result).toBeNull();
  });
});

// =============================================================================
// Tests — Knowledge Graph Post-Migration Sync
// =============================================================================

describe("extension bridge — knowledge graph post-migration sync", () => {
  beforeEach(() => {
    resetExtensionBridge();
  });

  it("returns null when KG is not available", async () => {
    const result = await syncPostMigrationToKnowledgeGraph({
      job: makeMinimalJob(),
      resourceMappings: [],
      targetVMs: [],
      targetBuckets: [],
    });
    expect(result).toBeNull();
  });

  it("syncs post-migration updates to KG", async () => {
    const ext = await resolveExtensions();
    const mockKG = createMockKnowledgeGraph();
    (ext as { knowledgeGraph: KnowledgeGraphLike }).knowledgeGraph = mockKG;

    const mappings: ResourceMapping[] = [
      {
        sourceId: "vm-src-1",
        targetId: "vm-tgt-1",
        sourceProvider: "aws",
        targetProvider: "azure",
        resourceType: "vm",
        migratedAt: new Date().toISOString(),
      },
    ];

    const result = await syncPostMigrationToKnowledgeGraph({
      job: makeMinimalJob(),
      resourceMappings: mappings,
      targetVMs: [makeMinimalVM("vm-tgt-1", "azure")],
      targetBuckets: [],
    });

    expect(result).not.toBeNull();
    expect(result!.nodesCreated).toBeGreaterThan(0);
    expect(result!.edgesCreated).toBe(mappings.length);
    expect(result!.edgesRemoved).toBe(mappings.length); // deprecated source nodes
    expect(mockKG._nodes.length).toBeGreaterThan(0);
    expect(mockKG._edges.length).toBe(mappings.length);
    expect(mockKG._deleted.length).toBe(mappings.length);
  });

  it("gracefully degrades on KG sync error", async () => {
    const ext = await resolveExtensions();
    (ext as { knowledgeGraph: KnowledgeGraphLike }).knowledgeGraph = {
      upsertNodes: async () => { throw new Error("KG offline"); },
      upsertEdges: async () => {},
      deleteNode: async () => {},
    };

    const result = await syncPostMigrationToKnowledgeGraph({
      job: makeMinimalJob(),
      resourceMappings: [
        { sourceId: "s1", targetId: "t1", sourceProvider: "aws", targetProvider: "gcp", resourceType: "vm", migratedAt: new Date().toISOString() },
      ],
      targetVMs: [makeMinimalVM("t1", "gcp")],
      targetBuckets: [],
    });
    expect(result).toBeNull();
  });
});

// =============================================================================
// Tests — Bridge Logger
// =============================================================================

describe("extension bridge — logger integration", () => {
  beforeEach(() => {
    resetExtensionBridge();
  });

  it("logs resolution messages through the provided logger", async () => {
    const log = createTestLogger();
    await resolveExtensions(log);
    // Should have logged something about each extension (either resolved or not available)
    const bridgeMessages = log.messages.filter((m) => m.includes("[extension-bridge]"));
    // 4 extensions → at least 4 messages
    expect(bridgeMessages.length).toBeGreaterThanOrEqual(4);
  });
});

// =============================================================================
// Tests — espada.plugin.json dependencies
// =============================================================================

describe("espada.plugin.json — dependency declarations", () => {
  it("declares aws, azure, gcp as required dependencies", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const pluginJson = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "..", "espada.plugin.json"),
        "utf-8",
      ),
    );
    expect(pluginJson.dependencies).toEqual(["aws", "azure", "gcp"]);
  });

  it("declares knowledge-graph, cost-governance, policy-engine, audit-trail as optional", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const pluginJson = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "..", "espada.plugin.json"),
        "utf-8",
      ),
    );
    expect(pluginJson.optionalDependencies).toEqual(
      expect.arrayContaining(["knowledge-graph", "cost-governance", "policy-engine", "audit-trail"]),
    );
    expect(pluginJson.optionalDependencies).toHaveLength(4);
  });
});

// =============================================================================
// Tests — Re-exports from index.ts
// =============================================================================

describe("index.ts — bridge re-exports", () => {
  it("exports resolveExtensions from the entry point", async () => {
    const mod = await import("../index.js");
    expect(typeof mod.resolveExtensions).toBe("function");
    expect(typeof mod.getResolvedExtensions).toBe("function");
    expect(typeof mod.resetExtensionBridge).toBe("function");
  });

  it("exports checkMigrationBudget from the entry point", async () => {
    const mod = await import("../index.js");
    expect(typeof mod.checkMigrationBudget).toBe("function");
  });

  it("exports pushDiscoveryToKnowledgeGraph from the entry point", async () => {
    const mod = await import("../index.js");
    expect(typeof mod.pushDiscoveryToKnowledgeGraph).toBe("function");
  });

  it("exports syncPostMigrationToKnowledgeGraph from the entry point", async () => {
    const mod = await import("../index.js");
    expect(typeof mod.syncPostMigrationToKnowledgeGraph).toBe("function");
  });
});
