/**
 * Cross-Boundary Analysis
 *
 * Analysis that spans the cloud ↔ edge boundary — blast radius across
 * regions and sites, disconnected-operation assessment, fleet drift,
 * and hybrid DR posture.
 */

import type {
  CloudProvider,
  HybridSite,
  FleetCluster,
  GraphNode,
  GraphEdge,
} from "./types.js";

// ── Lightweight Graph Query Interface ────────────────────────────────────────────

/**
 * Minimal query interface the analyzer needs. Decoupled from the full
 * GraphEngine so this module stays testable with simple mocks.
 */
export interface GraphQueryTarget {
  queryNodes(filter: { provider?: CloudProvider; resourceType?: string; region?: string }): Promise<GraphNode[]>;
  getEdgesForNode(nodeId: string, direction: "upstream" | "downstream" | "both"): Promise<GraphEdge[]>;
  getNeighbors(nodeId: string, depth: number, direction: "upstream" | "downstream" | "both"): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
}

// ── Result Types ────────────────────────────────────────────────────────────────

export type CloudRegionImpact = {
  region: string;
  provider: CloudProvider;
  affectedSites: HybridSite[];
  affectedClusters: FleetCluster[];
  affectedResources: number;
  canOperateDisconnected: HybridSite[];
  willFail: HybridSite[];
};

export type EdgeSiteImpact = {
  siteId: string;
  cloudDependencies: GraphNode[];
  dataFlowImpact: string[];
  blastRadius: number;
};

export type DisconnectedAssessment = {
  fullyDisconnectable: FleetCluster[];
  partiallyDisconnectable: {
    cluster: FleetCluster;
    cloudDependencies: GraphNode[];
  }[];
  requiresConnectivity: FleetCluster[];
};

export type FleetDriftResult = {
  clusterCount: number;
  versionSkew: { cluster: string; version: string }[];
  policyDrift: { cluster: string; missingPolicies: string[] }[];
  configDrift: { cluster: string; diffs: string[] }[];
  score: number; // 0–100
};

export type HybridDRPosture = {
  overallScore: number;
  singleRegionRisks: {
    region: string;
    edgeSites: number;
    canFailover: boolean;
  }[];
  edgeSiteRisks: {
    site: string;
    hasBackup: boolean;
    hasFailover: boolean;
    rto: number | null;
  }[];
  recommendations: string[];
};

// ── Analyzer ────────────────────────────────────────────────────────────────────

export class CrossBoundaryAnalyzer {
  constructor(
    private graph: GraphQueryTarget,
  ) {}

  // ── Cloud Region Impact ───────────────────────────────────────────────

  /**
   * If a cloud region goes down, which edge sites lose their
   * management plane and which can operate disconnected?
   */
  async cloudRegionImpact(
    region: string,
    provider: CloudProvider,
    sites: HybridSite[],
    clusters: FleetCluster[],
  ): Promise<CloudRegionImpact> {
    const affectedSites = sites.filter(
      (s) => s.parentCloudRegion === region && s.provider === provider,
    );

    const affectedClusters = clusters.filter(
      (c) => c.location.parentRegion === region && c.provider === provider,
    );

    const canOperateDisconnected = affectedSites.filter((s) =>
      s.capabilities.includes("disconnected-ops"),
    );

    const willFail = affectedSites.filter(
      (s) => !s.capabilities.includes("disconnected-ops"),
    );

    const affectedResources = affectedSites.reduce(
      (sum, s) => sum + s.resourceCount,
      0,
    );

    return {
      region,
      provider,
      affectedSites,
      affectedClusters,
      affectedResources,
      canOperateDisconnected,
      willFail,
    };
  }

  // ── Edge Site Impact ──────────────────────────────────────────────────

  /**
   * If an edge site goes offline, what cloud dependencies break?
   */
  async edgeSiteImpact(siteId: string): Promise<EdgeSiteImpact> {
    const { nodes, edges } = await this.graph.getNeighbors(siteId, 3, "both");

    // Cloud dependencies: nodes managed by a major cloud provider
    const cloudProviders = new Set<CloudProvider>(["aws", "azure", "gcp"]);
    const cloudDependencies = nodes.filter((n) => cloudProviders.has(n.provider));

    // Infer data flow impact from edge types
    const dataFlowImpact: string[] = [];
    for (const edge of edges) {
      if (["routes-to", "depends-on", "uses"].includes(edge.relationshipType)) {
        const target = nodes.find((n) => n.id === edge.targetNodeId);
        if (target) {
          dataFlowImpact.push(
            `${edge.relationshipType}: ${target.name} (${target.resourceType})`,
          );
        }
      }
    }

    return {
      siteId,
      cloudDependencies,
      dataFlowImpact,
      blastRadius: nodes.length,
    };
  }

  // ── Disconnected-Operation Assessment ─────────────────────────────────

  /**
   * Classify fleet clusters by their ability to operate without cloud.
   */
  async disconnectedOperationAssessment(
    clusters: FleetCluster[],
  ): Promise<DisconnectedAssessment> {
    const fullyDisconnectable: FleetCluster[] = [];
    const partiallyDisconnectable: { cluster: FleetCluster; cloudDependencies: GraphNode[] }[] = [];
    const requiresConnectivity: FleetCluster[] = [];

    for (const cluster of clusters) {
      const nodeId = `${cluster.provider}::${cluster.location.region ?? "edge"}:connected-cluster:${cluster.id}`;
      let neighbors: { nodes: GraphNode[]; edges: GraphEdge[] };
      try {
        neighbors = await this.graph.getNeighbors(nodeId, 2, "downstream");
      } catch {
        // If the node isn't in the graph yet, classify as unknown
        requiresConnectivity.push(cluster);
        continue;
      }

      const cloudProviders = new Set<CloudProvider>(["aws", "azure", "gcp"]);
      const cloudDeps = neighbors.nodes.filter((n) => cloudProviders.has(n.provider));

      if (cloudDeps.length === 0) {
        fullyDisconnectable.push(cluster);
      } else {
        // Check if any cloud dep is critical (database, secret, identity)
        const criticalTypes = new Set(["database", "secret", "identity", "iam-role"]);
        const hasCritical = cloudDeps.some((n) => criticalTypes.has(n.resourceType));
        if (hasCritical) {
          requiresConnectivity.push(cluster);
        } else {
          partiallyDisconnectable.push({ cluster, cloudDependencies: cloudDeps });
        }
      }
    }

    return { fullyDisconnectable, partiallyDisconnectable, requiresConnectivity };
  }

  // ── Fleet Drift ───────────────────────────────────────────────────────

  /**
   * Analyse version/policy/config consistency across fleet clusters.
   */
  fleetDriftAnalysis(clusters: FleetCluster[]): FleetDriftResult {
    if (clusters.length === 0) {
      return { clusterCount: 0, versionSkew: [], policyDrift: [], configDrift: [], score: 100 };
    }

    // Version skew: find the most common version, flag outliers
    const versionCounts = new Map<string, number>();
    for (const c of clusters) {
      versionCounts.set(c.kubernetesVersion, (versionCounts.get(c.kubernetesVersion) ?? 0) + 1);
    }

    let majorityVersion = "";
    let majorityCount = 0;
    for (const [v, count] of versionCounts) {
      if (count > majorityCount) {
        majorityVersion = v;
        majorityCount = count;
      }
    }

    const versionSkew = clusters
      .filter((c) => c.kubernetesVersion !== majorityVersion)
      .map((c) => ({ cluster: c.name, version: c.kubernetesVersion }));

    // Score: start at 100, deduct for each inconsistency
    let score = 100;
    const skewPenalty = Math.min(40, versionSkew.length * 10);
    score -= skewPenalty;

    // Connectivity penalty
    const disconnected = clusters.filter((c) => c.connectivity === "disconnected").length;
    score -= Math.min(30, disconnected * 10);

    // Degraded penalty
    const degraded = clusters.filter((c) => c.status === "degraded").length;
    score -= Math.min(20, degraded * 5);

    score = Math.max(0, score);

    return {
      clusterCount: clusters.length,
      versionSkew,
      policyDrift: [], // Requires policy-engine integration (future)
      configDrift: [], // Requires config-sync integration (future)
      score,
    };
  }

  // ── Hybrid DR Posture ─────────────────────────────────────────────────

  /**
   * Evaluate disaster recovery posture across all hybrid infrastructure.
   */
  hybridDRPosture(sites: HybridSite[], clusters: FleetCluster[]): HybridDRPosture {
    const recommendations: string[] = [];

    // Group sites by parent cloud region
    const regionSites = new Map<string, HybridSite[]>();
    for (const site of sites) {
      const key = `${site.provider}:${site.parentCloudRegion}`;
      if (!regionSites.has(key)) {
        regionSites.set(key, []);
      }
      regionSites.get(key)!.push(site);
    }

    // Single-region risk: all edge sites under one region
    const singleRegionRisks: HybridDRPosture["singleRegionRisks"] = [];
    for (const [key, keySites] of regionSites) {
      const region = key.split(":")[1] ?? key;
      const canFailover = keySites.some((s) => s.capabilities.includes("disconnected-ops"));
      singleRegionRisks.push({
        region,
        edgeSites: keySites.length,
        canFailover,
      });

      if (!canFailover && keySites.length > 1) {
        recommendations.push(
          `Add disconnected-ops capability for sites in ${region} (${keySites.length} sites at risk)`,
        );
      }
    }

    // Edge site risks
    const edgeSiteRisks: HybridDRPosture["edgeSiteRisks"] = sites.map((site) => {
      const hasBackup = site.managedClusters.length > 1;
      const hasFailover = site.capabilities.includes("disconnected-ops");
      return {
        site: site.name,
        hasBackup,
        hasFailover,
        rto: hasFailover ? 0 : hasBackup ? 300 : null,
      };
    });

    // Sites without any backup
    const noBackup = edgeSiteRisks.filter((r) => !r.hasBackup && !r.hasFailover);
    for (const risk of noBackup) {
      recommendations.push(`Deploy backup cluster at ${risk.site}`);
    }

    // Overall score
    let overallScore = 100;
    const noFailoverRegions = singleRegionRisks.filter((r) => !r.canFailover).length;
    overallScore -= noFailoverRegions * 15;
    overallScore -= noBackup.length * 10;
    const disconnectedCount = sites.filter((s) => s.status === "disconnected").length;
    overallScore -= disconnectedCount * 5;
    const degradedClusters = clusters.filter((c) => c.status === "degraded").length;
    overallScore -= degradedClusters * 5;
    overallScore = Math.max(0, Math.min(100, overallScore));

    return {
      overallScore,
      singleRegionRisks,
      edgeSiteRisks,
      recommendations,
    };
  }
}
