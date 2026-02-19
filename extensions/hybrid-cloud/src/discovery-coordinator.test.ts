/**
 * Tests for hybrid-cloud discovery-coordinator.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HybridDiscoveryCoordinator } from "../src/discovery-coordinator.js";
import type { GraphSyncTarget } from "../src/discovery-coordinator.js";
import type {
  HybridDiscoveryAdapter,
  HybridSite,
  FleetCluster,
  GraphNodeInput,
  CloudProvider,
} from "../src/types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────────

function makeSite(overrides: Partial<HybridSite> = {}): HybridSite {
  return {
    id: "site-1",
    name: "Test Site",
    provider: "azure-arc",
    location: {
      type: "edge-site",
      name: "Test Location",
      provider: "azure-arc",
      region: "eastus",
    },
    status: "connected",
    parentCloudRegion: "eastus",
    resourceCount: 5,
    managedClusters: [],
    managedMachines: [],
    capabilities: ["compute"],
    lastSyncAt: "2024-01-01T00:00:00Z",
    metadata: {},
    ...overrides,
  };
}

function makeCluster(overrides: Partial<FleetCluster> = {}): FleetCluster {
  return {
    id: "cluster-1",
    name: "Test Cluster",
    provider: "azure-arc",
    fleetId: "fleet-1",
    location: {
      type: "edge-site",
      name: "Test",
      provider: "azure-arc",
      region: "eastus",
    },
    kubernetesVersion: "1.28.4",
    nodeCount: 3,
    status: "running",
    managedBy: "arc",
    connectivity: "connected",
    ...overrides,
  };
}

function makeAdapter(
  provider: CloudProvider,
  overrides: Partial<HybridDiscoveryAdapter> = {},
): HybridDiscoveryAdapter {
  return {
    provider,
    discoverSites: vi.fn().mockResolvedValue([]),
    discoverFleetClusters: vi.fn().mockResolvedValue([]),
    discoverHybridResources: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeGraphTarget(): GraphSyncTarget & {
  upsertNode: ReturnType<typeof vi.fn>;
  upsertNodes: ReturnType<typeof vi.fn>;
  upsertEdge: ReturnType<typeof vi.fn>;
  upsertEdges: ReturnType<typeof vi.fn>;
} {
  return {
    upsertNode: vi.fn().mockResolvedValue(undefined),
    upsertNodes: vi.fn().mockResolvedValue(undefined),
    upsertEdge: vi.fn().mockResolvedValue(undefined),
    upsertEdges: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("HybridDiscoveryCoordinator", () => {
  let coordinator: HybridDiscoveryCoordinator;

  beforeEach(() => {
    coordinator = new HybridDiscoveryCoordinator();
  });

  describe("adapter registration", () => {
    it("starts with no registered providers", () => {
      expect(coordinator.getRegisteredProviders()).toEqual([]);
    });

    it("registers an adapter", () => {
      coordinator.registerAdapter("azure-arc", makeAdapter("azure-arc"));
      expect(coordinator.getRegisteredProviders()).toEqual(["azure-arc"]);
    });

    it("registers multiple adapters", () => {
      coordinator.registerAdapter("azure-arc", makeAdapter("azure-arc"));
      coordinator.registerAdapter("aws", makeAdapter("aws"));
      coordinator.registerAdapter("gcp", makeAdapter("gcp"));
      expect(coordinator.getRegisteredProviders()).toHaveLength(3);
    });

    it("removes an adapter", () => {
      coordinator.registerAdapter("azure-arc", makeAdapter("azure-arc"));
      coordinator.removeAdapter("azure-arc");
      expect(coordinator.getRegisteredProviders()).toEqual([]);
    });

    it("replaces existing adapter for same provider", () => {
      const adapter1 = makeAdapter("aws");
      const adapter2 = makeAdapter("aws");
      coordinator.registerAdapter("aws", adapter1);
      coordinator.registerAdapter("aws", adapter2);
      expect(coordinator.getRegisteredProviders()).toEqual(["aws"]);
    });
  });

  describe("discoverEdgeSites", () => {
    it("returns empty array with no adapters", async () => {
      const sites = await coordinator.discoverEdgeSites();
      expect(sites).toEqual([]);
    });

    it("aggregates sites from all adapters", async () => {
      const site1 = makeSite({ id: "site-1", provider: "azure-arc" });
      const site2 = makeSite({ id: "site-2", provider: "aws" });

      coordinator.registerAdapter("azure-arc", makeAdapter("azure-arc", {
        discoverSites: vi.fn().mockResolvedValue([site1]),
      }));
      coordinator.registerAdapter("aws", makeAdapter("aws", {
        discoverSites: vi.fn().mockResolvedValue([site2]),
      }));

      const sites = await coordinator.discoverEdgeSites();
      expect(sites).toHaveLength(2);
      expect(sites.map((s) => s.id)).toContain("site-1");
      expect(sites.map((s) => s.id)).toContain("site-2");
    });

    it("continues on adapter failure (non-fatal)", async () => {
      const goodSite = makeSite({ id: "good-site" });

      coordinator.registerAdapter("azure-arc", makeAdapter("azure-arc", {
        discoverSites: vi.fn().mockRejectedValue(new Error("Auth failed")),
      }));
      coordinator.registerAdapter("gcp", makeAdapter("gcp", {
        discoverSites: vi.fn().mockResolvedValue([goodSite]),
      }));

      const sites = await coordinator.discoverEdgeSites();
      expect(sites).toHaveLength(1);
      expect(sites[0].id).toBe("good-site");
    });
  });

  describe("discoverFleet", () => {
    it("returns empty array with no adapters", async () => {
      const clusters = await coordinator.discoverFleet();
      expect(clusters).toEqual([]);
    });

    it("aggregates clusters from all adapters", async () => {
      const c1 = makeCluster({ id: "c1" });
      const c2 = makeCluster({ id: "c2" });

      coordinator.registerAdapter("azure-arc", makeAdapter("azure-arc", {
        discoverFleetClusters: vi.fn().mockResolvedValue([c1]),
      }));
      coordinator.registerAdapter("gcp", makeAdapter("gcp", {
        discoverFleetClusters: vi.fn().mockResolvedValue([c2]),
      }));

      const clusters = await coordinator.discoverFleet();
      expect(clusters).toHaveLength(2);
    });

    it("tolerates adapter failures", async () => {
      coordinator.registerAdapter("aws", makeAdapter("aws", {
        discoverFleetClusters: vi.fn().mockRejectedValue(new Error("boom")),
      }));
      coordinator.registerAdapter("gcp", makeAdapter("gcp", {
        discoverFleetClusters: vi.fn().mockResolvedValue([makeCluster()]),
      }));

      const clusters = await coordinator.discoverFleet();
      expect(clusters).toHaveLength(1);
    });
  });

  describe("discoverAll", () => {
    it("produces a topology snapshot", async () => {
      const site = makeSite({ resourceCount: 8 });
      const cluster = makeCluster();

      coordinator.registerAdapter("azure-arc", makeAdapter("azure-arc", {
        discoverSites: vi.fn().mockResolvedValue([site]),
        discoverFleetClusters: vi.fn().mockResolvedValue([cluster]),
      }));

      const topology = await coordinator.discoverAll();
      expect(topology.edgeSites).toHaveLength(1);
      expect(topology.fleetClusters).toHaveLength(1);
      expect(topology.summary.totalSites).toBe(1);
      expect(topology.summary.totalClusters).toBe(1);
      expect(topology.summary.connectedSites).toBe(1);
      expect(topology.summary.disconnectedSites).toBe(0);
      expect(topology.summary.totalEdgeResources).toBe(8);
    });

    it("groups sites under cloud regions", async () => {
      const site1 = makeSite({ id: "s1", parentCloudRegion: "eastus", provider: "azure-arc" });
      const site2 = makeSite({ id: "s2", parentCloudRegion: "eastus", provider: "azure-arc" });
      const site3 = makeSite({ id: "s3", parentCloudRegion: "westus", provider: "azure-arc" });

      coordinator.registerAdapter("azure-arc", makeAdapter("azure-arc", {
        discoverSites: vi.fn().mockResolvedValue([site1, site2, site3]),
      }));

      const topology = await coordinator.discoverAll();
      expect(topology.cloudRegions).toHaveLength(2);
      const eastus = topology.cloudRegions.find((r) => r.region === "eastus");
      expect(eastus?.edgeSites).toHaveLength(2);
    });

    it("includes connections for each site", async () => {
      coordinator.registerAdapter("aws", makeAdapter("aws", {
        discoverSites: vi.fn().mockResolvedValue([makeSite(), makeSite({ id: "site-2" })]),
      }));

      const topology = await coordinator.discoverAll();
      expect(topology.connections).toHaveLength(2);
    });
  });

  describe("syncToGraph", () => {
    it("syncs nodes and edges into graph target", async () => {
      const site = makeSite({ managedClusters: ["c1"] });
      const cluster = makeCluster({ fleetId: "fleet-prod" });
      const resource: GraphNodeInput = {
        id: "res-1",
        provider: "azure-arc",
        resourceType: "hybrid-machine",
        nativeId: "machine-01",
        name: "Machine 1",
        region: "eastus",
        account: "",
        status: "running",
        tags: {},
        metadata: {},
        costMonthly: null,
        owner: null,
        createdAt: null,
      };

      coordinator.registerAdapter("azure-arc", makeAdapter("azure-arc", {
        discoverSites: vi.fn().mockResolvedValue([site]),
        discoverFleetClusters: vi.fn().mockResolvedValue([cluster]),
        discoverHybridResources: vi.fn().mockResolvedValue([resource]),
      }));

      const target = makeGraphTarget();
      const result = await coordinator.syncToGraph(target);

      expect(result.sitesDiscovered).toBe(1);
      expect(result.clustersDiscovered).toBe(1);
      expect(result.resourcesDiscovered).toBe(1);
      expect(result.edgesCreated).toBeGreaterThan(0);

      // Nodes should be upserted
      expect(target.upsertNodes).toHaveBeenCalledTimes(1);
      const upsertedNodes = target.upsertNodes.mock.calls[0][0] as GraphNodeInput[];
      expect(upsertedNodes.length).toBe(3); // site + cluster + resource

      // Edges should be upserted
      expect(target.upsertEdges).toHaveBeenCalledTimes(1);
    });

    it("does not upsert if no nodes found", async () => {
      // No adapters = no data
      const target = makeGraphTarget();
      const result = await coordinator.syncToGraph(target);

      expect(result.sitesDiscovered).toBe(0);
      expect(target.upsertNodes).not.toHaveBeenCalled();
    });
  });

  describe("healthCheckAll", () => {
    it("returns health for each adapter", async () => {
      coordinator.registerAdapter("azure-arc", makeAdapter("azure-arc", {
        healthCheck: vi.fn().mockResolvedValue(true),
      }));
      coordinator.registerAdapter("aws", makeAdapter("aws", {
        healthCheck: vi.fn().mockResolvedValue(false),
      }));

      const health = await coordinator.healthCheckAll();
      expect(health.get("azure-arc")).toBe(true);
      expect(health.get("aws")).toBe(false);
    });

    it("marks failed health checks as false", async () => {
      coordinator.registerAdapter("gcp", makeAdapter("gcp", {
        healthCheck: vi.fn().mockRejectedValue(new Error("network")),
      }));

      const health = await coordinator.healthCheckAll();
      expect(health.get("gcp")).toBe(false);
    });
  });
});
