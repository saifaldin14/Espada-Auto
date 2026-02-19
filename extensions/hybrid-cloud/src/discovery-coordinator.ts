/**
 * Hybrid Discovery Coordinator
 *
 * Orchestrates multi-provider hybrid/edge discovery: registers adapters,
 * runs discovery across all providers, aggregates results into a unified
 * HybridTopology, and syncs into the Knowledge Graph.
 */

import type {
  CloudProvider,
  HybridDiscoveryAdapter,
  HybridSite,
  FleetCluster,
  HybridTopology,
  HybridConnection,
  GraphNodeInput,
  GraphEdgeInput,
} from "./types.js";
import {
  createEdgeSiteNode,
  createClusterNode,
  createHybridEdge,
} from "./graph-model.js";

// ── Types ───────────────────────────────────────────────────────────────────────

/** Lightweight graph-engine interface so we can accept any implementation. */
export interface GraphSyncTarget {
  upsertNode(node: GraphNodeInput): Promise<void>;
  upsertNodes(nodes: GraphNodeInput[]): Promise<void>;
  upsertEdge(edge: GraphEdgeInput): Promise<void>;
  upsertEdges(edges: GraphEdgeInput[]): Promise<void>;
}

export type SyncResult = {
  sitesDiscovered: number;
  clustersDiscovered: number;
  resourcesDiscovered: number;
  edgesCreated: number;
};

// ── Coordinator ─────────────────────────────────────────────────────────────────

export class HybridDiscoveryCoordinator {
  private adapters = new Map<CloudProvider, HybridDiscoveryAdapter>();

  /** Register a provider-specific discovery adapter. */
  registerAdapter(provider: CloudProvider, adapter: HybridDiscoveryAdapter): void {
    this.adapters.set(provider, adapter);
  }

  /** Unregister an adapter. */
  removeAdapter(provider: CloudProvider): void {
    this.adapters.delete(provider);
  }

  /** Get registered providers. */
  getRegisteredProviders(): CloudProvider[] {
    return [...this.adapters.keys()];
  }

  // ── Discovery ──────────────────────────────────────────────────────────

  /** Discover edge sites from all registered adapters. */
  async discoverEdgeSites(): Promise<HybridSite[]> {
    const allSites: HybridSite[] = [];
    for (const adapter of this.adapters.values()) {
      try {
        const sites = await adapter.discoverSites();
        allSites.push(...sites);
      } catch {
        // Adapter failure is non-fatal; continue with others.
      }
    }
    return allSites;
  }

  /** Discover Kubernetes fleet clusters from all adapters. */
  async discoverFleet(): Promise<FleetCluster[]> {
    const allClusters: FleetCluster[] = [];
    for (const adapter of this.adapters.values()) {
      try {
        const clusters = await adapter.discoverFleetClusters();
        allClusters.push(...clusters);
      } catch {
        // Continue on failure.
      }
    }
    return allClusters;
  }

  /** Full discovery producing a HybridTopology snapshot. */
  async discoverAll(): Promise<HybridTopology> {
    const sites = await this.discoverEdgeSites();
    const clusters = await this.discoverFleet();
    const connections = inferConnections(sites);

    return buildTopology(sites, clusters, connections);
  }

  // ── Graph Sync ─────────────────────────────────────────────────────────

  /**
   * Sync discovered hybrid topology into the Knowledge Graph.
   * Creates nodes for sites, clusters, and hybrid resources,
   * and edges for relationships (deployed-at, connected-to, member-of-fleet).
   */
  async syncToGraph(target: GraphSyncTarget): Promise<SyncResult> {
    const sites = await this.discoverEdgeSites();
    const clusters = await this.discoverFleet();

    // Gather raw resources from all adapters
    const resources: GraphNodeInput[] = [];
    for (const adapter of this.adapters.values()) {
      try {
        const res = await adapter.discoverHybridResources();
        resources.push(...res);
      } catch {
        // Continue.
      }
    }

    // Build graph nodes for sites and clusters
    const siteNodes = sites.map(createEdgeSiteNode);
    const clusterNodes = clusters.map(createClusterNode);
    const allNodes = [...siteNodes, ...clusterNodes, ...resources];

    if (allNodes.length > 0) {
      await target.upsertNodes(allNodes);
    }

    // Build edges
    const edges: GraphEdgeInput[] = [];

    // Site → parent cloud region
    for (const site of sites) {
      const siteNode = siteNodes.find((n) => n.nativeId === site.id);
      if (siteNode) {
        edges.push(
          createHybridEdge(siteNode.id, `cloud-region:${site.parentCloudRegion}`, "connected-to"),
        );
      }
    }

    // Cluster → fleet (member-of-fleet)
    for (const cluster of clusters) {
      const clusterNode = clusterNodes.find((n) => n.nativeId === cluster.id);
      if (clusterNode && cluster.fleetId) {
        edges.push(
          createHybridEdge(clusterNode.id, cluster.fleetId, "member-of-fleet"),
        );
      }
    }

    if (edges.length > 0) {
      await target.upsertEdges(edges);
    }

    return {
      sitesDiscovered: sites.length,
      clustersDiscovered: clusters.length,
      resourcesDiscovered: resources.length,
      edgesCreated: edges.length,
    };
  }

  // ── Health Check ───────────────────────────────────────────────────────

  /** Health-check all adapters. Returns map of provider → reachable. */
  async healthCheckAll(): Promise<Map<CloudProvider, boolean>> {
    const results = new Map<CloudProvider, boolean>();
    for (const [provider, adapter] of this.adapters) {
      try {
        results.set(provider, await adapter.healthCheck());
      } catch {
        results.set(provider, false);
      }
    }
    return results;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Infer connections between edge sites and their parent cloud regions. */
function inferConnections(sites: HybridSite[]): HybridConnection[] {
  return sites.map((site) => ({
    from: site.id,
    to: `cloud-region:${site.parentCloudRegion}`,
    status: site.status,
  }));
}

/** Build a HybridTopology snapshot from discovered sites and clusters. */
function buildTopology(
  sites: HybridSite[],
  clusters: FleetCluster[],
  connections: HybridConnection[],
): HybridTopology {
  // Group sites by their parent cloud region
  const regionMap = new Map<string, { provider: CloudProvider; region: string; sites: HybridSite[] }>();
  for (const site of sites) {
    const key = `${site.provider}:${site.parentCloudRegion}`;
    if (!regionMap.has(key)) {
      regionMap.set(key, { provider: site.provider, region: site.parentCloudRegion, sites: [] });
    }
    regionMap.get(key)!.sites.push(site);
  }

  const cloudRegions = [...regionMap.values()].map(({ provider, region, sites: regionSites }) => ({
    provider,
    region,
    resourceCount: regionSites.reduce((sum, s) => sum + s.resourceCount, 0),
    edgeSites: regionSites,
  }));

  const connectedSites = sites.filter((s) => s.status === "connected").length;

  return {
    cloudRegions,
    edgeSites: sites,
    fleetClusters: clusters,
    connections,
    summary: {
      totalCloudResources: 0, // Filled by full sync
      totalEdgeResources: sites.reduce((sum, s) => sum + s.resourceCount, 0),
      totalSites: sites.length,
      totalClusters: clusters.length,
      connectedSites,
      disconnectedSites: sites.length - connectedSites,
    },
  };
}
