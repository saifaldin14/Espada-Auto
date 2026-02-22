/**
 * Tests for Hybrid/Edge Infrastructure CLI Commands.
 *
 * Verifies all 7 `espada hybrid` subcommands register correctly
 * and produce expected output for various inputs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerHybridCli, type CliContext } from "./cli.js";
import type { HybridDiscoveryCoordinator } from "./discovery-coordinator.js";
import type { CrossBoundaryAnalyzer } from "./cross-boundary-analysis.js";
import type { HybridSite, FleetCluster, HybridTopology } from "./types.js";

// ── Factories ───────────────────────────────────────────────────────────────

function makeSite(overrides: Partial<HybridSite> = {}): HybridSite {
  return {
    id: "azure::westus2::edge-site::site-1",
    name: "hci-prod",
    provider: "azure",
    type: "datacenter",
    parentCloudRegion: "westus2",
    status: "connected",
    capabilities: ["compute", "storage", "disconnected-ops"],
    resourceCount: 42,
    location: undefined,
    managedClusters: ["cluster-1"],
    managedVMs: [],
    lastSyncAt: "2026-01-15T10:00:00Z",
    metadata: {},
    ...overrides,
  } as HybridSite;
}

function makeCluster(overrides: Partial<FleetCluster> = {}): FleetCluster {
  return {
    id: "aws::us-east-1::kubernetes-cluster::eks-1",
    name: "prod-eks",
    provider: "aws",
    kubernetesVersion: "1.29",
    nodeCount: 6,
    status: "healthy",
    connectivity: "connected",
    location: {
      type: "cloud-region",
      name: "us-east-1",
      provider: "aws",
      region: "us-east-1",
    },
    managedBy: "eks",
    fleetId: undefined,
    ...overrides,
  } as FleetCluster;
}

function makeTopology(overrides: Partial<HybridTopology> = {}): HybridTopology {
  return {
    cloudRegions: [
      {
        provider: "aws",
        region: "us-east-1",
        resourceCount: 120,
        edgeSites: [makeSite({ provider: "aws", parentCloudRegion: "us-east-1" })],
      },
    ],
    edgeSites: [makeSite()],
    fleetClusters: [makeCluster()],
    connections: [
      { from: "site-1", to: "us-east-1", status: "connected", type: "vpn" },
    ],
    summary: {
      totalCloudResources: 120,
      totalEdgeResources: 42,
      totalSites: 1,
      totalClusters: 1,
      connectedSites: 1,
      disconnectedSites: 0,
    },
    ...overrides,
  } as HybridTopology;
}

// ── Mock helpers ────────────────────────────────────────────────────────────

function createMockCoordinator(): HybridDiscoveryCoordinator {
  return {
    discoverAll: vi.fn().mockResolvedValue(makeTopology()),
    discoverEdgeSites: vi.fn().mockResolvedValue([makeSite()]),
    discoverFleet: vi.fn().mockResolvedValue([makeCluster()]),
    healthCheckAll: vi.fn().mockResolvedValue(new Map([["aws", true], ["azure", true]])),
  } as unknown as HybridDiscoveryCoordinator;
}

function createMockAnalyzer(): CrossBoundaryAnalyzer {
  return {
    fleetDriftAnalysis: vi.fn().mockReturnValue({
      clusterCount: 1,
      score: 95,
      versionSkew: [],
      policyDrift: [],
      configDrift: [],
    }),
    cloudRegionImpact: vi.fn().mockResolvedValue({
      provider: "aws",
      affectedSites: [makeSite()],
      affectedClusters: [makeCluster()],
      affectedResources: 42,
      canOperateDisconnected: [makeSite()],
      willFail: [],
    }),
    edgeSiteImpact: vi.fn().mockResolvedValue({
      blastRadius: 12,
      cloudDependencies: [{ name: "rds-prod", resourceType: "database", provider: "aws" }],
      dataFlowImpact: ["IoT pipeline loses source"],
    }),
    disconnectedOperationAssessment: vi.fn().mockResolvedValue({
      fullyDisconnectable: [makeCluster()],
      partiallyDisconnectable: [],
      requiresConnectivity: [],
    }),
    hybridDRPosture: vi.fn().mockReturnValue({
      overallScore: 72,
      singleRegionRisks: [
        { region: "us-east-1", edgeSites: 2, canFailover: false },
      ],
      edgeSiteRisks: [],
      recommendations: ["Add multi-region failover for us-east-1"],
    }),
  } as unknown as CrossBoundaryAnalyzer;
}

function createCliContext(): { ctx: CliContext; program: Command } {
  const program = new Command();
  program.exitOverride(); // don't call process.exit
  const ctx: CliContext = {
    program,
    config: {},
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
  return { ctx, program };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("registerHybridCli", () => {
  let coordinator: HybridDiscoveryCoordinator;
  let analyzer: CrossBoundaryAnalyzer;
  let ctx: CliContext;
  let program: Command;

  beforeEach(() => {
    coordinator = createMockCoordinator();
    analyzer = createMockAnalyzer();
    const result = createCliContext();
    ctx = result.ctx;
    program = result.program;
    registerHybridCli(ctx, coordinator, analyzer);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("registers the hybrid command group", () => {
    const hybrid = program.commands.find((c) => c.name() === "hybrid");
    expect(hybrid).toBeDefined();
  });

  it("registers all 7 subcommands", () => {
    const hybrid = program.commands.find((c) => c.name() === "hybrid")!;
    const subcommands = hybrid.commands.map((c) => c.name());
    expect(subcommands).toContain("status");
    expect(subcommands).toContain("sites");
    expect(subcommands).toContain("fleet");
    expect(subcommands).toContain("topology");
    expect(subcommands).toContain("sync");
    expect(subcommands).toContain("blast-radius");
    expect(subcommands).toContain("assess");
    expect(subcommands).toHaveLength(7);
  });

  // ── status ──────────────────────────────────────────────────────────────

  describe("hybrid status", () => {
    it("calls discoverAll and healthCheckAll", async () => {
      await program.parseAsync(["hybrid", "status"], { from: "user" });
      expect(coordinator.discoverAll).toHaveBeenCalled();
      expect(coordinator.healthCheckAll).toHaveBeenCalled();
    });

    it("outputs topology summary", async () => {
      await program.parseAsync(["hybrid", "status"], { from: "user" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("Hybrid Infrastructure Overview");
    });
  });

  // ── sites ───────────────────────────────────────────────────────────────

  describe("hybrid sites", () => {
    it("calls discoverEdgeSites", async () => {
      await program.parseAsync(["hybrid", "sites"], { from: "user" });
      expect(coordinator.discoverEdgeSites).toHaveBeenCalled();
    });

    it("shows site count in header", async () => {
      await program.parseAsync(["hybrid", "sites"], { from: "user" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("Edge Sites (1)");
    });

    it("filters by provider option", async () => {
      const sites = [
        makeSite({ provider: "aws", name: "aws-site" }),
        makeSite({ provider: "azure", name: "azure-site" }),
      ];
      (coordinator.discoverEdgeSites as ReturnType<typeof vi.fn>).mockResolvedValue(sites);

      await program.parseAsync(["hybrid", "sites", "--provider", "aws"], { from: "user" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("Edge Sites (1)");
      expect(output).toContain("aws-site");
      expect(output).not.toContain("azure-site");
    });

    it("filters by status option", async () => {
      const sites = [
        makeSite({ status: "connected", name: "conn-site" }),
        makeSite({ status: "disconnected", name: "disc-site" }),
      ];
      (coordinator.discoverEdgeSites as ReturnType<typeof vi.fn>).mockResolvedValue(sites);

      await program.parseAsync(["hybrid", "sites", "--status", "disconnected"], { from: "user" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("disc-site");
      expect(output).not.toContain("conn-site");
    });

    it("handles no sites found", async () => {
      (coordinator.discoverEdgeSites as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await program.parseAsync(["hybrid", "sites"], { from: "user" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("No sites found");
    });
  });

  // ── fleet ───────────────────────────────────────────────────────────────

  describe("hybrid fleet", () => {
    it("calls discoverFleet and fleetDriftAnalysis", async () => {
      await program.parseAsync(["hybrid", "fleet"], { from: "user" });
      expect(coordinator.discoverFleet).toHaveBeenCalled();
      expect(analyzer.fleetDriftAnalysis).toHaveBeenCalled();
    });

    it("shows fleet consistency score", async () => {
      await program.parseAsync(["hybrid", "fleet"], { from: "user" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("95/100");
    });

    it("shows version skew warnings", async () => {
      (analyzer.fleetDriftAnalysis as ReturnType<typeof vi.fn>).mockReturnValue({
        clusterCount: 2,
        score: 70,
        versionSkew: [{ cluster: "old-cluster", version: "1.27" }],
        policyDrift: [],
        configDrift: [],
      });

      await program.parseAsync(["hybrid", "fleet"], { from: "user" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("old-cluster");
      expect(output).toContain("1.27");
    });
  });

  // ── topology ────────────────────────────────────────────────────────────

  describe("hybrid topology", () => {
    it("renders text table by default", async () => {
      await program.parseAsync(["hybrid", "topology"], { from: "user" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("Hybrid Topology");
      expect(output).toContain("Cloud Regions");
    });

    it("renders mermaid diagram when --format mermaid", async () => {
      await program.parseAsync(["hybrid", "topology", "--format", "mermaid"], { from: "user" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("graph TD");
    });

    it("filters by provider", async () => {
      const topo = makeTopology({
        cloudRegions: [
          { provider: "aws", region: "us-east-1", resourceCount: 100, edgeSites: [] },
          { provider: "azure", region: "westeurope", resourceCount: 50, edgeSites: [] },
        ],
        edgeSites: [],
      });
      (coordinator.discoverAll as ReturnType<typeof vi.fn>).mockResolvedValue(topo);

      // Clear previous console.log calls before this test
      (console.log as ReturnType<typeof vi.fn>).mockClear();

      await program.parseAsync(["hybrid", "topology", "--provider", "aws"], { from: "user" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("us-east-1");
      expect(output).not.toContain("westeurope");
    });
  });

  // ── sync ────────────────────────────────────────────────────────────────

  describe("hybrid sync", () => {
    it("performs full sync across all providers", async () => {
      await program.parseAsync(["hybrid", "sync"], { from: "user" });
      expect(coordinator.discoverAll).toHaveBeenCalled();
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("Starting hybrid infrastructure sync");
    });

    it("shows discovery counts after sync", async () => {
      await program.parseAsync(["hybrid", "sync"], { from: "user" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("Edge Sites");
      expect(output).toContain("Fleet Clusters");
    });

    it("filters by provider when --provider is given", async () => {
      await program.parseAsync(["hybrid", "sync", "--provider", "aws"], { from: "user" });
      expect(coordinator.discoverEdgeSites).toHaveBeenCalled();
      expect(coordinator.discoverFleet).toHaveBeenCalled();
    });
  });

  // ── blast-radius ────────────────────────────────────────────────────────

  describe("hybrid blast-radius", () => {
    it("analyzes cloud region impact by default", async () => {
      await program.parseAsync(["hybrid", "blast-radius", "us-east-1"], { from: "user" });
      expect(analyzer.cloudRegionImpact).toHaveBeenCalled();
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("Cloud Region Impact");
      expect(output).toContain("us-east-1");
    });

    it("analyzes edge site impact with --type site", async () => {
      await program.parseAsync(
        ["hybrid", "blast-radius", "site-1", "--type", "site"],
        { from: "user" },
      );
      expect(analyzer.edgeSiteImpact).toHaveBeenCalledWith("site-1");
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("Edge Site Impact");
    });

    it("analyzes cluster impact with --type cluster", async () => {
      await program.parseAsync(
        ["hybrid", "blast-radius", "prod-eks", "--type", "cluster"],
        { from: "user" },
      );
      expect(analyzer.disconnectedOperationAssessment).toHaveBeenCalled();
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("Cluster Impact");
      expect(output).toContain("prod-eks");
    });

    it("handles cluster not found", async () => {
      (coordinator.discoverAll as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeTopology({ fleetClusters: [] }),
      );
      await program.parseAsync(
        ["hybrid", "blast-radius", "nonexistent", "--type", "cluster"],
        { from: "user" },
      );
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("not found");
    });
  });

  // ── assess ──────────────────────────────────────────────────────────────

  describe("hybrid assess", () => {
    it("runs disconnected operation assessment", async () => {
      await program.parseAsync(["hybrid", "assess"], { from: "user" });
      expect(coordinator.discoverAll).toHaveBeenCalled();
      expect(analyzer.disconnectedOperationAssessment).toHaveBeenCalled();
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("Disconnected Operation Assessment");
    });

    it("shows fully disconnectable clusters", async () => {
      await program.parseAsync(["hybrid", "assess"], { from: "user" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("Fully Disconnectable");
      expect(output).toContain("prod-eks");
    });

    it("includes DR posture when --dr flag is given", async () => {
      await program.parseAsync(["hybrid", "assess", "--dr"], { from: "user" });
      expect(analyzer.hybridDRPosture).toHaveBeenCalled();
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("DR Posture");
      expect(output).toContain("72/100");
    });

    it("shows DR recommendations", async () => {
      await program.parseAsync(["hybrid", "assess", "--dr"], { from: "user" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0])
        .join("\n");
      expect(output).toContain("Recommendations");
      expect(output).toContain("multi-region failover");
    });
  });
});
