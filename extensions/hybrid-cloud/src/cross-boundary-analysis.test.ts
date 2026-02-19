/**
 * Tests for hybrid-cloud cross-boundary-analysis.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CrossBoundaryAnalyzer,
  type GraphQueryTarget,
} from "../src/cross-boundary-analysis.js";
import type { HybridSite, FleetCluster, GraphNode, GraphEdge } from "../src/types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────────

function makeSite(overrides: Partial<HybridSite> = {}): HybridSite {
  return {
    id: "site-1",
    name: "Test Site",
    provider: "azure-arc",
    location: {
      type: "edge-site",
      name: "Test",
      provider: "azure-arc",
      region: "eastus",
    },
    status: "connected",
    parentCloudRegion: "eastus",
    resourceCount: 5,
    managedClusters: ["cluster-1"],
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

function makeGraphNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "node-1",
    provider: "azure-arc",
    resourceType: "compute",
    nativeId: "n-1",
    name: "Node 1",
    region: "eastus",
    account: "",
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: null,
    owner: null,
    createdAt: null,
    discoveredAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    lastSeenAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeGraphEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: "edge-1",
    sourceNodeId: "node-1",
    targetNodeId: "node-2",
    relationshipType: "routes-to",
    confidence: 1.0,
    discoveredVia: "api-field",
    metadata: {},
    createdAt: "2024-01-01T00:00:00Z",
    lastSeenAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeGraphTarget(
  overrides: Partial<GraphQueryTarget> = {},
): GraphQueryTarget {
  return {
    queryNodes: vi.fn().mockResolvedValue([]),
    getEdgesForNode: vi.fn().mockResolvedValue([]),
    getNeighbors: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("CrossBoundaryAnalyzer", () => {
  let analyzer: CrossBoundaryAnalyzer;
  let graph: GraphQueryTarget;

  beforeEach(() => {
    graph = makeGraphTarget();
    analyzer = new CrossBoundaryAnalyzer(graph);
  });

  describe("cloudRegionImpact", () => {
    it("identifies affected sites and clusters in a region", async () => {
      const sites = [
        makeSite({ id: "s1", provider: "azure-arc", parentCloudRegion: "eastus" }),
        makeSite({ id: "s2", provider: "azure-arc", parentCloudRegion: "eastus" }),
        makeSite({ id: "s3", provider: "azure-arc", parentCloudRegion: "westus" }),
      ];
      const clusters = [
        makeCluster({ id: "c1", provider: "azure-arc", location: { type: "edge-site", name: "Test", provider: "azure-arc", region: "eastus", parentRegion: "eastus" } }),
        makeCluster({ id: "c2", provider: "azure-arc", location: { type: "edge-site", name: "Test", provider: "azure-arc", region: "westus", parentRegion: "westus" } }),
      ];

      const impact = await analyzer.cloudRegionImpact("eastus", "azure-arc", sites, clusters);

      expect(impact.region).toBe("eastus");
      expect(impact.provider).toBe("azure-arc");
      expect(impact.affectedSites).toHaveLength(2);
      expect(impact.affectedClusters).toHaveLength(1);
    });

    it("separates disconnected-ops capable sites from failures", async () => {
      const sites = [
        makeSite({ id: "s1", capabilities: ["compute", "disconnected-ops"], parentCloudRegion: "eastus", provider: "azure-arc" }),
        makeSite({ id: "s2", capabilities: ["compute"], parentCloudRegion: "eastus", provider: "azure-arc" }),
      ];

      const impact = await analyzer.cloudRegionImpact("eastus", "azure-arc", sites, []);

      expect(impact.canOperateDisconnected).toHaveLength(1);
      expect(impact.canOperateDisconnected[0].id).toBe("s1");
      expect(impact.willFail).toHaveLength(1);
      expect(impact.willFail[0].id).toBe("s2");
    });

    it("sums resource counts", async () => {
      const sites = [
        makeSite({ id: "s1", resourceCount: 10, parentCloudRegion: "eastus", provider: "azure-arc" }),
        makeSite({ id: "s2", resourceCount: 7, parentCloudRegion: "eastus", provider: "azure-arc" }),
      ];

      const impact = await analyzer.cloudRegionImpact("eastus", "azure-arc", sites, []);
      expect(impact.affectedResources).toBe(17);
    });

    it("returns empty arrays for unaffected region", async () => {
      const sites = [
        makeSite({ parentCloudRegion: "westus", provider: "azure-arc" }),
      ];

      const impact = await analyzer.cloudRegionImpact("eastus", "azure-arc", sites, []);
      expect(impact.affectedSites).toHaveLength(0);
      expect(impact.affectedResources).toBe(0);
    });
  });

  describe("edgeSiteImpact", () => {
    it("finds cloud dependencies from graph neighbors", async () => {
      const cloudNode = makeGraphNode({ id: "cloud-db", provider: "aws", resourceType: "database" });
      const edgeNode = makeGraphNode({ id: "edge-worker", provider: "azure-arc" });
      const edge = makeGraphEdge({
        sourceNodeId: "site-1",
        targetNodeId: "cloud-db",
        relationshipType: "depends-on",
      });

      graph = makeGraphTarget({
        getNeighbors: vi.fn().mockResolvedValue({
          nodes: [cloudNode, edgeNode],
          edges: [edge],
        }),
      });
      analyzer = new CrossBoundaryAnalyzer(graph);

      const impact = await analyzer.edgeSiteImpact("site-1");

      expect(impact.siteId).toBe("site-1");
      expect(impact.cloudDependencies).toHaveLength(1);
      expect(impact.cloudDependencies[0].provider).toBe("aws");
      expect(impact.blastRadius).toBe(2);
    });

    it("identifies data flow impact from edge types", async () => {
      const targetNode = makeGraphNode({ id: "logs-db", resourceType: "database", name: "Logs DB" });
      const routeEdge = makeGraphEdge({
        sourceNodeId: "site-1",
        targetNodeId: "logs-db",
        relationshipType: "routes-to",
      });

      graph = makeGraphTarget({
        getNeighbors: vi.fn().mockResolvedValue({
          nodes: [targetNode],
          edges: [routeEdge],
        }),
      });
      analyzer = new CrossBoundaryAnalyzer(graph);

      const impact = await analyzer.edgeSiteImpact("site-1");
      expect(impact.dataFlowImpact).toHaveLength(1);
      expect(impact.dataFlowImpact[0]).toContain("routes-to");
      expect(impact.dataFlowImpact[0]).toContain("Logs DB");
    });
  });

  describe("disconnectedOperationAssessment", () => {
    it("classifies cluster with no cloud deps as fully disconnectable", async () => {
      graph = makeGraphTarget({
        getNeighbors: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      });
      analyzer = new CrossBoundaryAnalyzer(graph);

      const result = await analyzer.disconnectedOperationAssessment([makeCluster()]);
      expect(result.fullyDisconnectable).toHaveLength(1);
      expect(result.requiresConnectivity).toHaveLength(0);
    });

    it("classifies cluster with critical cloud deps as requires connectivity", async () => {
      const secretNode = makeGraphNode({ provider: "aws", resourceType: "secret" });

      graph = makeGraphTarget({
        getNeighbors: vi.fn().mockResolvedValue({
          nodes: [secretNode],
          edges: [],
        }),
      });
      analyzer = new CrossBoundaryAnalyzer(graph);

      const result = await analyzer.disconnectedOperationAssessment([makeCluster()]);
      expect(result.requiresConnectivity).toHaveLength(1);
    });

    it("classifies cluster with non-critical cloud deps as partially disconnectable", async () => {
      const monitorNode = makeGraphNode({ provider: "azure", resourceType: "compute" });

      graph = makeGraphTarget({
        getNeighbors: vi.fn().mockResolvedValue({
          nodes: [monitorNode],
          edges: [],
        }),
      });
      analyzer = new CrossBoundaryAnalyzer(graph);

      const result = await analyzer.disconnectedOperationAssessment([makeCluster()]);
      expect(result.partiallyDisconnectable).toHaveLength(1);
      expect(result.partiallyDisconnectable[0].cloudDependencies).toHaveLength(1);
    });

    it("classifies unreachable clusters as requires connectivity", async () => {
      graph = makeGraphTarget({
        getNeighbors: vi.fn().mockRejectedValue(new Error("not found")),
      });
      analyzer = new CrossBoundaryAnalyzer(graph);

      const result = await analyzer.disconnectedOperationAssessment([makeCluster()]);
      expect(result.requiresConnectivity).toHaveLength(1);
    });
  });

  describe("fleetDriftAnalysis", () => {
    it("returns perfect score for empty fleet", () => {
      const result = analyzer.fleetDriftAnalysis([]);
      expect(result.score).toBe(100);
      expect(result.clusterCount).toBe(0);
    });

    it("returns perfect score for uniform fleet", () => {
      const clusters = [
        makeCluster({ id: "c1", kubernetesVersion: "1.28.4", status: "running", connectivity: "connected" }),
        makeCluster({ id: "c2", kubernetesVersion: "1.28.4", status: "running", connectivity: "connected" }),
        makeCluster({ id: "c3", kubernetesVersion: "1.28.4", status: "running", connectivity: "connected" }),
      ];

      const result = analyzer.fleetDriftAnalysis(clusters);
      expect(result.score).toBe(100);
      expect(result.versionSkew).toHaveLength(0);
    });

    it("detects version skew", () => {
      const clusters = [
        makeCluster({ id: "c1", name: "C1", kubernetesVersion: "1.28.4" }),
        makeCluster({ id: "c2", name: "C2", kubernetesVersion: "1.28.4" }),
        makeCluster({ id: "c3", name: "C3", kubernetesVersion: "1.27.1" }),
      ];

      const result = analyzer.fleetDriftAnalysis(clusters);
      expect(result.versionSkew).toHaveLength(1);
      expect(result.versionSkew[0].cluster).toBe("C3");
      expect(result.versionSkew[0].version).toBe("1.27.1");
      expect(result.score).toBeLessThan(100);
    });

    it("penalizes disconnected clusters", () => {
      const clusters = [
        makeCluster({ id: "c1", connectivity: "disconnected" }),
        makeCluster({ id: "c2", connectivity: "connected" }),
      ];

      const result = analyzer.fleetDriftAnalysis(clusters);
      expect(result.score).toBeLessThan(100);
    });

    it("penalizes degraded clusters", () => {
      const clusters = [
        makeCluster({ id: "c1", status: "degraded" }),
      ];

      const result = analyzer.fleetDriftAnalysis(clusters);
      expect(result.score).toBeLessThan(100);
    });

    it("score never goes below 0", () => {
      const clusters = Array.from({ length: 10 }, (_, i) =>
        makeCluster({
          id: `c${i}`,
          kubernetesVersion: `1.${20 + i}.0`,
          status: "degraded",
          connectivity: "disconnected",
        }),
      );

      const result = analyzer.fleetDriftAnalysis(clusters);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe("hybridDRPosture", () => {
    it("returns perfect score for healthy setup", () => {
      const sites = [
        makeSite({
          id: "s1",
          capabilities: ["compute", "disconnected-ops"],
          managedClusters: ["c1", "c2"],
          status: "connected",
        }),
      ];
      const clusters = [
        makeCluster({ id: "c1", status: "running" }),
        makeCluster({ id: "c2", status: "running" }),
      ];

      const result = analyzer.hybridDRPosture(sites, clusters);
      expect(result.overallScore).toBe(100);
      expect(result.recommendations).toHaveLength(0);
    });

    it("recommends disconnected-ops for vulnerable regions", () => {
      const sites = [
        makeSite({ id: "s1", capabilities: ["compute"], parentCloudRegion: "eastus", provider: "azure-arc" }),
        makeSite({ id: "s2", capabilities: ["compute"], parentCloudRegion: "eastus", provider: "azure-arc" }),
      ];

      const result = analyzer.hybridDRPosture(sites, []);
      expect(result.recommendations.some((r) => r.includes("disconnected-ops"))).toBe(true);
    });

    it("recommends backup for sites without redundancy", () => {
      const sites = [
        makeSite({ id: "s1", capabilities: ["compute"], managedClusters: ["c1"] }),
      ];

      const result = analyzer.hybridDRPosture(sites, []);
      expect(result.recommendations.some((r) => r.includes("backup"))).toBe(true);
    });

    it("penalizes disconnected sites", () => {
      const sites = [
        makeSite({ id: "s1", status: "disconnected", capabilities: ["compute", "disconnected-ops"], managedClusters: ["c1", "c2"] }),
      ];

      const result1 = analyzer.hybridDRPosture(sites, []);

      const connectedSites = [
        makeSite({ id: "s1", status: "connected", capabilities: ["compute", "disconnected-ops"], managedClusters: ["c1", "c2"] }),
      ];
      const result2 = analyzer.hybridDRPosture(connectedSites, []);

      expect(result1.overallScore).toBeLessThan(result2.overallScore);
    });

    it("identifies single-region risks", () => {
      const sites = [
        makeSite({ id: "s1", parentCloudRegion: "eastus", provider: "azure-arc" }),
        makeSite({ id: "s2", parentCloudRegion: "eastus", provider: "azure-arc" }),
        makeSite({ id: "s3", parentCloudRegion: "westus", provider: "azure-arc" }),
      ];

      const result = analyzer.hybridDRPosture(sites, []);
      expect(result.singleRegionRisks).toHaveLength(2);

      const eastus = result.singleRegionRisks.find((r) => r.region === "eastus");
      expect(eastus?.edgeSites).toBe(2);
    });

    it("sets RTO based on failover capability", () => {
      const sites = [
        makeSite({ id: "s1", capabilities: ["compute", "disconnected-ops"], managedClusters: ["c1", "c2"] }),
        makeSite({ id: "s2", capabilities: ["compute"], managedClusters: ["c1"] }),
      ];

      const result = analyzer.hybridDRPosture(sites, []);
      const failoverSite = result.edgeSiteRisks.find((r) => r.site === "Test Site");
      // Site with both backup and failover → rto = 0
      expect(result.edgeSiteRisks[0].rto).toBe(0);
    });
  });
});
