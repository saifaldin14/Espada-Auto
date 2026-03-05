/**
 * Cross-Cloud Migration Engine — Dependency Analyzer & Graph Integration Tests
 */
import { describe, it, expect } from "vitest";

import {
  computeMigrationOrder,
  generateMigrationWaves,
  computeBlastRadius,
  inferDependencyGraph,
  type DependencyGraph,
  type ResourceNode,
  type ResourceEdge,
} from "../src/graph/dependency-analyzer.js";

import {
  MigrationGraphAdapter,
  getMigrationGraphAdapter,
} from "../src/graph/migration-adapter.js";

import {
  generatePostMigrationUpdates,
  generateLineageReport,
  type ResourceMapping,
} from "../src/graph/post-migration-sync.js";

import type { NormalizedVM, NormalizedBucket, MigrationJob } from "../src/types.js";

// =============================================================================
// Dependency Analyzer
// =============================================================================
describe("graph/dependency-analyzer", () => {
  const sampleGraph: DependencyGraph = {
    nodes: [
      { id: "web", type: "vm", name: "web-server", provider: "aws", region: "us-east-1", metadata: {} },
      { id: "api", type: "vm", name: "api-server", provider: "aws", region: "us-east-1", metadata: {} },
      { id: "db", type: "database", name: "main-db", provider: "aws", region: "us-east-1", metadata: {} },
      { id: "cache", type: "vm", name: "cache-node", provider: "aws", region: "us-east-1", metadata: {} },
    ],
    edges: [
      { source: "web", target: "api", type: "depends-on", weight: 0.9 },
      { source: "api", target: "db", type: "depends-on", weight: 1.0 },
      { source: "api", target: "cache", type: "depends-on", weight: 0.5 },
    ],
  };

  describe("computeMigrationOrder", () => {
    it("returns layers in topological order", () => {
      const layers = computeMigrationOrder(sampleGraph);
      expect(layers.length).toBeGreaterThan(0);

      // db and cache should be before api, which should be before web
      const flatIds = layers.flat().map((n) => n.id);
      const dbIdx = flatIds.indexOf("db");
      const cacheIdx = flatIds.indexOf("cache");
      const apiIdx = flatIds.indexOf("api");
      const webIdx = flatIds.indexOf("web");

      expect(dbIdx).toBeLessThan(apiIdx);
      expect(cacheIdx).toBeLessThan(apiIdx);
      expect(apiIdx).toBeLessThan(webIdx);
    });

    it("handles empty graph", () => {
      expect(computeMigrationOrder({ nodes: [], edges: [] })).toEqual([]);
    });

    it("handles single node", () => {
      const layers = computeMigrationOrder({
        nodes: [{ id: "solo", type: "vm", name: "solo-vm", provider: "aws", region: "us-east-1", metadata: {} }],
        edges: [],
      });
      expect(layers.length).toBe(1);
      expect(layers[0][0].id).toBe("solo");
    });
  });

  describe("generateMigrationWaves", () => {
    it("generates waves with resource groups", () => {
      const waves = generateMigrationWaves(sampleGraph);
      expect(waves.length).toBeGreaterThan(0);

      for (const wave of waves) {
        expect(wave).toHaveProperty("id");
        expect(wave).toHaveProperty("name");
        expect(wave).toHaveProperty("resources");
        expect(wave.resources.length).toBeGreaterThan(0);
      }
    });

    it("first wave contains leaf nodes (db, cache)", () => {
      const waves = generateMigrationWaves(sampleGraph);
      const firstWaveIds = waves[0].resources.map((r) => r.id);
      expect(firstWaveIds).toContain("db");
      expect(firstWaveIds).toContain("cache");
    });
  });

  describe("computeBlastRadius", () => {
    it("computes blast radius for a given node", () => {
      const radius = computeBlastRadius(sampleGraph, "db");
      expect(radius).toHaveProperty("directlyAffected");
      expect(radius).toHaveProperty("transitivelyAffected");
      expect(radius).toHaveProperty("totalAffected");
      expect(radius.totalAffected).toBeGreaterThan(0);
    });

    it("leaf node has larger blast radius than root (db affects api→web)", () => {
      const dbRadius = computeBlastRadius(sampleGraph, "db");
      const webRadius = computeBlastRadius(sampleGraph, "web");
      // db failure affects api and web; web failure affects nothing downstream
      expect(dbRadius.totalAffected).toBeGreaterThanOrEqual(webRadius.totalAffected);
    });

    it("returns zero totalAffected for isolated node", () => {
      const graph: DependencyGraph = {
        nodes: [{ id: "solo", type: "vm", name: "solo-vm", provider: "aws", region: "us-east-1", metadata: {} }],
        edges: [],
      };
      const radius = computeBlastRadius(graph, "solo");
      expect(radius.totalAffected).toBe(0);
    });
  });

  describe("inferDependencyGraph", () => {
    it("infers edges from shared subnet", () => {
      const vms: NormalizedVM[] = [
        {
          id: "vm-1", name: "web", provider: "aws", region: "us-east-1",
          cpuCores: 2, memoryGB: 4, osType: "linux", architecture: "x86_64",
          disks: [], tags: { app: "web" },
          networkInterfaces: [{ id: "eni-1", privateIp: "10.0.0.1", subnetId: "subnet-1", securityGroupIds: [] }],
        } as NormalizedVM,
        {
          id: "vm-2", name: "api", provider: "aws", region: "us-east-1",
          cpuCores: 4, memoryGB: 8, osType: "linux", architecture: "x86_64",
          disks: [], tags: { app: "api" },
          networkInterfaces: [{ id: "eni-2", privateIp: "10.0.0.2", subnetId: "subnet-1", securityGroupIds: [] }],
        } as NormalizedVM,
        {
          id: "vm-3", name: "other", provider: "aws", region: "us-east-1",
          cpuCores: 2, memoryGB: 4, osType: "linux", architecture: "x86_64",
          disks: [], tags: { app: "other" },
          networkInterfaces: [{ id: "eni-3", privateIp: "10.0.1.1", subnetId: "subnet-2", securityGroupIds: [] }],
        } as NormalizedVM,
      ];

      const graph = inferDependencyGraph({ vms, buckets: [] });

      expect(graph.nodes.length).toBe(3);
      // vm-1 and vm-2 share subnet-1, so there should be an edge
      const hasEdge = graph.edges.some(
        (e) =>
          (e.source === "vm-1" && e.target === "vm-2") ||
          (e.source === "vm-2" && e.target === "vm-1"),
      );
      expect(hasEdge).toBe(true);
    });
  });
});

// =============================================================================
// Migration Graph Adapter
// =============================================================================
describe("graph/migration-adapter", () => {
  describe("MigrationGraphAdapter", () => {
    it("has the required interface", () => {
      const adapter = new MigrationGraphAdapter();
      expect(adapter.provider).toBe("cloud-migration");
      expect(typeof adapter.displayName).toBe("string");
      expect(typeof adapter.supportedResourceTypes).toBe("function");
      expect(typeof adapter.discover).toBe("function");
      expect(typeof adapter.supportsIncrementalSync).toBe("function");
      expect(typeof adapter.healthCheck).toBe("function");
    });

    it("supportedResourceTypes returns known types", () => {
      const adapter = new MigrationGraphAdapter();
      const types = adapter.supportedResourceTypes();
      expect(types.length).toBeGreaterThan(0);
    });

    it("discover returns nodes and edges", async () => {
      const adapter = new MigrationGraphAdapter();
      const result = adapter.discover({ vms: [], buckets: [], securityRules: [], jobs: [] });
      expect(result).toHaveProperty("nodes");
      expect(result).toHaveProperty("edges");
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(Array.isArray(result.edges)).toBe(true);
    });

    it("healthCheck returns a result", async () => {
      const adapter = new MigrationGraphAdapter();
      const health = await adapter.healthCheck();
      expect(health).toHaveProperty("healthy");
    });
  });

  describe("getMigrationGraphAdapter", () => {
    it("returns a singleton", () => {
      const a = getMigrationGraphAdapter();
      const b = getMigrationGraphAdapter();
      expect(a).toBe(b);
    });
  });
});

// =============================================================================
// Post-Migration Sync
// =============================================================================
describe("graph/post-migration-sync", () => {
  describe("generatePostMigrationUpdates", () => {
    it("generates updates for migrated resources", () => {
      const job = {
        id: "job-1",
        phase: "completed",
        source: { provider: "aws", region: "us-east-1" },
        target: { provider: "azure", region: "eastus" },
      } as unknown as MigrationJob;

      const resourceMappings: ResourceMapping[] = [
        { sourceId: "i-old", targetId: "vm-new", sourceProvider: "aws", targetProvider: "azure", resourceType: "vm", migratedAt: new Date().toISOString() },
      ];

      const targetVMs: NormalizedVM[] = [
        {
          id: "vm-new", name: "web-server", provider: "azure", region: "eastus",
          cpuCores: 4, memoryGB: 16, osType: "linux", architecture: "x86_64",
          disks: [], networkInterfaces: [], tags: {},
        } as NormalizedVM,
      ];

      const updates = generatePostMigrationUpdates({
        job,
        resourceMappings,
        targetVMs,
        targetBuckets: [],
      });

      expect(updates).toHaveProperty("newNodes");
      expect(updates).toHaveProperty("newEdges");
      expect(updates).toHaveProperty("deprecatedNodeIds");
      expect(updates.newNodes.length).toBeGreaterThan(0);
    });
  });

  describe("generateLineageReport", () => {
    it("generates a lineage report for mappings", () => {
      const now = new Date().toISOString();
      const report = generateLineageReport([
        { sourceId: "i-old", targetId: "vm-new", sourceProvider: "aws", targetProvider: "azure", resourceType: "vm", migratedAt: now },
        { sourceId: "bucket-old", targetId: "container-new", sourceProvider: "aws", targetProvider: "azure", resourceType: "bucket", migratedAt: now },
      ]);

      expect(report.totalMigrated).toBe(2);
      expect(report).toHaveProperty("byType");
      expect(report).toHaveProperty("bySourceProvider");
      expect(report).toHaveProperty("byTargetProvider");
    });
  });
});
