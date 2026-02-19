/**
 * Tests for hybrid/edge agent tools.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Inline type mirrors (to avoid cross-extension imports) ──────────────────

type ConnectivityStatus = "connected" | "degraded" | "disconnected" | "unknown";
type HybridSiteCapability = "compute" | "containers" | "storage" | "ai-inference" | "disconnected-ops" | "sovereign";
type CloudProvider = "aws" | "azure" | "gcp" | "azure-arc" | "gdc" | "kubernetes" | "custom" | "vmware" | "nutanix";
type GraphNodeLocationType = "cloud-region" | "availability-zone" | "edge-site" | "on-premises" | "custom-location";

type GraphNodeLocation = {
  type: GraphNodeLocationType;
  name: string;
  provider: CloudProvider;
  region?: string;
  parentRegion?: string;
  coordinates?: { latitude: number; longitude: number };
  address?: { city?: string; state?: string; country: string; postalCode?: string };
  connectivityStatus?: ConnectivityStatus;
};

type HybridSite = {
  id: string;
  name: string;
  provider: CloudProvider;
  location: GraphNodeLocation;
  status: ConnectivityStatus;
  parentCloudRegion: string;
  resourceCount: number;
  managedClusters: string[];
  managedMachines: string[];
  capabilities: HybridSiteCapability[];
  lastSyncAt: string;
  metadata: Record<string, unknown>;
};

type FleetCluster = {
  id: string;
  name: string;
  provider: CloudProvider;
  fleetId?: string;
  location: GraphNodeLocation;
  kubernetesVersion: string;
  nodeCount: number;
  status: "running" | "stopped" | "degraded" | "unknown";
  managedBy: "gke" | "aks" | "eks" | "arc" | "self-managed";
  connectivity: ConnectivityStatus;
  workloadCount?: number;
  lastHeartbeat?: string;
};

type HybridTopology = {
  cloudRegions: { provider: CloudProvider; region: string; resourceCount: number; edgeSites: HybridSite[] }[];
  edgeSites: HybridSite[];
  fleetClusters: FleetCluster[];
  connections: { from: string; to: string; status: ConnectivityStatus }[];
  summary: {
    totalCloudResources: number;
    totalEdgeResources: number;
    totalSites: number;
    totalClusters: number;
    connectedSites: number;
    disconnectedSites: number;
  };
};

// ── Factories ───────────────────────────────────────────────────────────────

function makeSite(overrides: Partial<HybridSite> = {}): HybridSite {
  return {
    id: "site-1",
    name: "Seattle Warehouse",
    provider: "aws",
    location: {
      type: "edge-site",
      name: "Seattle Warehouse",
      provider: "aws",
      region: "us-west-2",
      parentRegion: "us-west-2",
    },
    status: "connected",
    parentCloudRegion: "us-west-2",
    resourceCount: 12,
    managedClusters: ["cluster-1"],
    managedMachines: ["machine-1"],
    capabilities: ["compute", "containers"],
    lastSyncAt: "2026-01-01T00:00:00Z",
    metadata: {},
    ...overrides,
  };
}

function makeCluster(overrides: Partial<FleetCluster> = {}): FleetCluster {
  return {
    id: "cluster-1",
    name: "edge-cluster-1",
    provider: "aws",
    kubernetesVersion: "1.29.0",
    nodeCount: 3,
    status: "running",
    managedBy: "eks",
    connectivity: "connected",
    location: {
      type: "edge-site",
      name: "Seattle Warehouse",
      provider: "aws",
      region: "us-west-2",
      parentRegion: "us-west-2",
    },
    ...overrides,
  };
}

function makeTopology(sites: HybridSite[], clusters: FleetCluster[]): HybridTopology {
  const connectedSites = sites.filter((s) => s.status === "connected").length;
  return {
    cloudRegions: [
      {
        provider: "aws",
        region: "us-west-2",
        resourceCount: 30,
        edgeSites: sites.filter((s) => s.parentCloudRegion === "us-west-2"),
      },
    ],
    edgeSites: sites,
    fleetClusters: clusters,
    connections: sites.map((s) => ({ from: s.id, to: `cloud-region:${s.parentCloudRegion}`, status: s.status })),
    summary: {
      totalCloudResources: 30,
      totalEdgeResources: sites.reduce((sum, s) => sum + s.resourceCount, 0),
      totalSites: sites.length,
      totalClusters: clusters.length,
      connectedSites,
      disconnectedSites: sites.length - connectedSites,
    },
  };
}

// ── Mock coordinator & analyzer ─────────────────────────────────────────────

function createMockCoordinator(topology: HybridTopology) {
  return {
    discoverAll: vi.fn().mockResolvedValue(topology),
    discoverEdgeSites: vi.fn().mockResolvedValue(topology.edgeSites),
    discoverFleet: vi.fn().mockResolvedValue(topology.fleetClusters),
    healthCheckAll: vi.fn().mockResolvedValue(new Map([["aws", true]])),
    registerAdapter: vi.fn(),
    removeAdapter: vi.fn(),
    getRegisteredProviders: vi.fn().mockReturnValue(["aws"]),
    syncToGraph: vi.fn().mockResolvedValue({ sitesDiscovered: 0, clustersDiscovered: 0, resourcesDiscovered: 0, edgesCreated: 0 }),
  };
}

function createMockAnalyzer() {
  return {
    cloudRegionImpact: vi.fn().mockImplementation(async (region: string, provider: CloudProvider, sites: HybridSite[], clusters: FleetCluster[]) => {
      const affected = sites.filter((s) => s.parentCloudRegion === region && s.provider === provider);
      return {
        region,
        provider,
        affectedSites: affected,
        affectedClusters: clusters.filter((c) => c.location.parentRegion === region),
        affectedResources: affected.reduce((sum, s) => sum + s.resourceCount, 0),
        canOperateDisconnected: affected.filter((s) => s.capabilities.includes("disconnected-ops")),
        willFail: affected.filter((s) => !s.capabilities.includes("disconnected-ops")),
      };
    }),
    edgeSiteImpact: vi.fn().mockResolvedValue({
      siteId: "site-1",
      cloudDependencies: [],
      dataFlowImpact: [],
      blastRadius: 5,
    }),
    disconnectedOperationAssessment: vi.fn().mockResolvedValue({
      fullyDisconnectable: [],
      partiallyDisconnectable: [],
      requiresConnectivity: [],
    }),
    fleetDriftAnalysis: vi.fn().mockImplementation((clusters: FleetCluster[]) => ({
      clusterCount: clusters.length,
      versionSkew: [],
      policyDrift: [],
      configDrift: [],
      score: 100,
    })),
    hybridDRPosture: vi.fn().mockReturnValue({
      overallScore: 80,
      singleRegionRisks: [],
      edgeSiteRisks: [],
      recommendations: [],
    }),
  };
}

// ── Tool execution helper ───────────────────────────────────────────────────

type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{
    content: { type: string; text: string }[];
    details: Record<string, unknown>;
  }>;
};

/**
 * Captures tools registered via api.registerTool during registerHybridTools.
 */
async function loadTools(
  coordinator: ReturnType<typeof createMockCoordinator>,
  analyzer: ReturnType<typeof createMockAnalyzer>,
): Promise<Map<string, RegisteredTool>> {
  // Dynamically import the registration function
  const { registerHybridTools } = await import("./tools.js");

  const tools = new Map<string, RegisteredTool>();

  const mockApi = {
    registerTool: vi.fn((tool: RegisteredTool) => {
      tools.set(tool.name, tool);
    }),
  };

  registerHybridTools(mockApi as any, coordinator as any, analyzer as any);
  return tools;
}

// =============================================================================
// Tests
// =============================================================================

describe("registerHybridTools", () => {
  let coordinator: ReturnType<typeof createMockCoordinator>;
  let analyzer: ReturnType<typeof createMockAnalyzer>;
  let tools: Map<string, RegisteredTool>;

  const sites = [
    makeSite(),
    makeSite({ id: "site-2", name: "Tokyo Factory", provider: "azure-arc", parentCloudRegion: "japaneast", status: "disconnected", capabilities: ["compute", "disconnected-ops"], location: { type: "edge-site", name: "Tokyo Factory", provider: "azure-arc", region: "japaneast", parentRegion: "japaneast" } }),
  ];
  const clusters = [
    makeCluster(),
    makeCluster({ id: "cluster-2", name: "edge-cluster-2", kubernetesVersion: "1.28.0", status: "degraded", connectivity: "degraded" }),
  ];
  const topology = makeTopology(sites, clusters);

  beforeEach(async () => {
    coordinator = createMockCoordinator(topology);
    analyzer = createMockAnalyzer();
    tools = await loadTools(coordinator, analyzer);
  });

  it("registers 4 tools", () => {
    expect(tools.size).toBe(4);
    expect(tools.has("hybrid_topology")).toBe(true);
    expect(tools.has("hybrid_sites")).toBe(true);
    expect(tools.has("hybrid_fleet")).toBe(true);
    expect(tools.has("hybrid_blast_radius")).toBe(true);
  });

  // ── hybrid_topology ────────────────────────────────────────────────────

  describe("hybrid_topology", () => {
    it("returns topology overview", async () => {
      const tool = tools.get("hybrid_topology")!;
      const result = await tool.execute("call-1", {});

      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.text).toContain("Hybrid Infrastructure Topology");
      expect(result.details.cloudRegions).toBe(1);
      expect(result.details.edgeSites).toBe(2);
      expect(result.details.fleetClusters).toBe(2);
    });

    it("filters by provider", async () => {
      const tool = tools.get("hybrid_topology")!;
      const result = await tool.execute("call-2", { provider: "azure-arc" });

      // Only azure-arc sites remain
      expect(result.details.cloudRegions).toBe(0);
      expect(result.details.edgeSites).toBe(1);
    });

    it("includes fleet clusters when includeResources is true", async () => {
      const tool = tools.get("hybrid_topology")!;
      const result = await tool.execute("call-3", { includeResources: true });

      expect(result.content[0]!.text).toContain("Fleet Clusters");
      expect(result.content[0]!.text).toContain("edge-cluster-1");
    });
  });

  // ── hybrid_sites ──────────────────────────────────────────────────────

  describe("hybrid_sites", () => {
    it("returns all sites", async () => {
      const tool = tools.get("hybrid_sites")!;
      const result = await tool.execute("call-1", {});

      expect(result.content[0]!.text).toContain("Edge/On-Premises Sites (2)");
      expect(result.details.siteCount).toBe(2);
    });

    it("filters by status", async () => {
      const tool = tools.get("hybrid_sites")!;
      const result = await tool.execute("call-2", { status: "disconnected" });

      expect(result.details.siteCount).toBe(1);
      expect(result.content[0]!.text).toContain("Tokyo Factory");
    });

    it("shows no-results message when filtered empty", async () => {
      const tool = tools.get("hybrid_sites")!;
      const result = await tool.execute("call-3", { provider: "gcp" });

      expect(result.details.siteCount).toBe(0);
      expect(result.content[0]!.text).toContain("No sites found");
    });

    it("reports status breakdown in details", async () => {
      const tool = tools.get("hybrid_sites")!;
      const result = await tool.execute("call-4", {});

      const byStatus = result.details.byStatus as Record<string, number>;
      expect(byStatus.connected).toBe(1);
      expect(byStatus.disconnected).toBe(1);
    });
  });

  // ── hybrid_fleet ──────────────────────────────────────────────────────

  describe("hybrid_fleet", () => {
    it("returns all fleet clusters with drift score", async () => {
      const tool = tools.get("hybrid_fleet")!;
      const result = await tool.execute("call-1", {});

      expect(result.content[0]!.text).toContain("Kubernetes Fleet (2 clusters)");
      expect(result.details.clusterCount).toBe(2);
      expect(result.details.consistencyScore).toBe(100);
    });

    it("filters by provider", async () => {
      const tool = tools.get("hybrid_fleet")!;
      // Mock to filter in practice
      const result = await tool.execute("call-2", { provider: "gcp" });

      expect(result.details.clusterCount).toBe(0);
    });

    it("includes version skew if present", async () => {
      analyzer.fleetDriftAnalysis.mockImplementation((cls: FleetCluster[]) => ({
        clusterCount: cls.length,
        versionSkew: [{ cluster: "edge-cluster-2", version: "1.28.0" }],
        policyDrift: [],
        configDrift: [],
        score: 90,
      }));

      tools = await loadTools(coordinator, analyzer);
      const tool = tools.get("hybrid_fleet")!;
      const result = await tool.execute("call-3", {});

      expect(result.content[0]!.text).toContain("Version Skew");
      expect(result.content[0]!.text).toContain("edge-cluster-2");
      expect(result.details.consistencyScore).toBe(90);
    });
  });

  // ── hybrid_blast_radius ───────────────────────────────────────────────

  describe("hybrid_blast_radius", () => {
    it("analyzes region impact", async () => {
      const tool = tools.get("hybrid_blast_radius")!;
      const result = await tool.execute("call-1", {
        target: "us-west-2",
        targetType: "region",
        provider: "aws",
      });

      expect(result.content[0]!.text).toContain("Cloud Region Impact: us-west-2");
      expect(result.details.affectedSites).toBe(1);
      expect(result.details.willFail).toBe(1);
    });

    it("analyzes edge site impact", async () => {
      const tool = tools.get("hybrid_blast_radius")!;
      const result = await tool.execute("call-2", {
        target: "site-1",
        targetType: "site",
      });

      expect(result.content[0]!.text).toContain("Edge Site Impact: site-1");
      expect(result.details.blastRadius).toBe(5);
    });

    it("analyzes cluster impact", async () => {
      analyzer.disconnectedOperationAssessment.mockResolvedValue({
        fullyDisconnectable: [makeCluster()],
        partiallyDisconnectable: [],
        requiresConnectivity: [],
      });

      tools = await loadTools(coordinator, analyzer);
      const tool = tools.get("hybrid_blast_radius")!;
      const result = await tool.execute("call-3", {
        target: "cluster-1",
        targetType: "cluster",
      });

      expect(result.content[0]!.text).toContain("Cluster Impact: edge-cluster-1");
      expect(result.details.category).toBe("fully-disconnectable");
    });

    it("returns not_found for unknown cluster", async () => {
      const tool = tools.get("hybrid_blast_radius")!;
      const result = await tool.execute("call-4", {
        target: "nonexistent",
        targetType: "cluster",
      });

      expect(result.content[0]!.text).toContain("not found");
      expect(result.details.error).toBe("not_found");
    });

    it("shows disconnected-ops capable sites on region impact", async () => {
      const sitesWithDisconnected = [
        makeSite({ capabilities: ["compute", "disconnected-ops"] }),
        makeSite({ id: "site-nope", name: "No Disconnect", capabilities: ["compute"] }),
      ];
      const topo = makeTopology(sitesWithDisconnected, clusters);
      coordinator = createMockCoordinator(topo);
      tools = await loadTools(coordinator, analyzer);

      const tool = tools.get("hybrid_blast_radius")!;
      const result = await tool.execute("call-5", {
        target: "us-west-2",
        targetType: "region",
        provider: "aws",
      });

      expect(result.details.canOperateDisconnected).toBeDefined();
    });
  });
});
