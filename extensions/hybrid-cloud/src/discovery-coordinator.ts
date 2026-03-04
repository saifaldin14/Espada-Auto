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

export type HybridDiscoveryOperation =
  | "discoverSites"
  | "discoverFleetClusters"
  | "discoverHybridResources"
  | "healthCheck";

export type HybridDiscoveryFailureType =
  | "timeout"
  | "authentication"
  | "permission"
  | "network"
  | "validation"
  | "unknown";

export type HybridAdapterFailure = {
  provider: CloudProvider;
  operation: HybridDiscoveryOperation;
  type: HybridDiscoveryFailureType;
  message: string;
  timestamp: string;
  retryable: boolean;
};

export type HybridDiscoveryRunDiagnostics = {
  startedAt: string;
  completedAt: string;
  failures: HybridAdapterFailure[];
  failureCountByProvider: Partial<Record<CloudProvider, number>>;
  failureCountByOperation: Partial<Record<HybridDiscoveryOperation, number>>;
};

export type HybridDiscoveryCoordinatorOptions = {
  maxFailureHistory?: number;
  onAdapterFailure?: (failure: HybridAdapterFailure) => void;
};

// ── Coordinator ─────────────────────────────────────────────────────────────────

export class HybridDiscoveryCoordinator {
  private adapters = new Map<CloudProvider, HybridDiscoveryAdapter>();
  private readonly maxFailureHistory: number;
  private readonly onAdapterFailure?: (failure: HybridAdapterFailure) => void;
  private adapterFailureHistory: HybridAdapterFailure[] = [];
  private lastRunDiagnostics: HybridDiscoveryRunDiagnostics | null = null;
  private activeRunDepth = 0;
  private activeRunFailures: HybridAdapterFailure[] = [];
  private activeRunStartedAt: string | null = null;

  constructor(options: HybridDiscoveryCoordinatorOptions = {}) {
    this.maxFailureHistory = options.maxFailureHistory ?? 200;
    this.onAdapterFailure = options.onAdapterFailure;
  }

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
    return this.runTracked(async () => {
      const allSites: HybridSite[] = [];
      for (const [provider, adapter] of this.adapters) {
        try {
          const sites = await adapter.discoverSites();
          allSites.push(...sites);
        } catch (error) {
          this.recordAdapterFailure(provider, "discoverSites", error);
        }
      }
      return allSites;
    });
  }

  /** Discover Kubernetes fleet clusters from all adapters. */
  async discoverFleet(): Promise<FleetCluster[]> {
    return this.runTracked(async () => {
      const allClusters: FleetCluster[] = [];
      for (const [provider, adapter] of this.adapters) {
        try {
          const clusters = await adapter.discoverFleetClusters();
          allClusters.push(...clusters);
        } catch (error) {
          this.recordAdapterFailure(provider, "discoverFleetClusters", error);
        }
      }
      return allClusters;
    });
  }

  /** Full discovery producing a HybridTopology snapshot. */
  async discoverAll(): Promise<HybridTopology> {
    return this.runTracked(async () => {
      const sites = await this.discoverEdgeSites();
      const clusters = await this.discoverFleet();
      const connections = inferConnections(sites);

      return buildTopology(sites, clusters, connections);
    });
  }

  // ── Graph Sync ─────────────────────────────────────────────────────────

  /**
   * Sync discovered hybrid topology into the Knowledge Graph.
   * Creates nodes for sites, clusters, and hybrid resources,
   * and edges for relationships (deployed-at, connected-to, member-of-fleet).
   */
  async syncToGraph(target: GraphSyncTarget): Promise<SyncResult> {
    return this.runTracked(async () => {
      const sites = await this.discoverEdgeSites();
      const clusters = await this.discoverFleet();

      // Gather raw resources from all adapters
      const resources: GraphNodeInput[] = [];
      for (const [provider, adapter] of this.adapters) {
        try {
          const res = await adapter.discoverHybridResources();
          resources.push(...res);
        } catch (error) {
          this.recordAdapterFailure(provider, "discoverHybridResources", error);
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
    });
  }

  // ── Health Check ───────────────────────────────────────────────────────

  /** Health-check all adapters. Returns map of provider → reachable. */
  async healthCheckAll(): Promise<Map<CloudProvider, boolean>> {
    return this.runTracked(async () => {
      const results = new Map<CloudProvider, boolean>();
      for (const [provider, adapter] of this.adapters) {
        try {
          results.set(provider, await adapter.healthCheck());
        } catch (error) {
          results.set(provider, false);
          this.recordAdapterFailure(provider, "healthCheck", error);
        }
      }
      return results;
    });
  }

  /** Get adapter failures captured in the most recent top-level discovery run. */
  getLastDiscoveryRunDiagnostics(): HybridDiscoveryRunDiagnostics | null {
    if (!this.lastRunDiagnostics) return null;
    return {
      ...this.lastRunDiagnostics,
      failures: [...this.lastRunDiagnostics.failures],
      failureCountByProvider: { ...this.lastRunDiagnostics.failureCountByProvider },
      failureCountByOperation: { ...this.lastRunDiagnostics.failureCountByOperation },
    };
  }

  /** Get recent adapter failure history across runs. */
  getAdapterFailureHistory(): HybridAdapterFailure[] {
    return [...this.adapterFailureHistory];
  }

  /** Clear adapter failure history and last run diagnostics. */
  resetAdapterFailureHistory(): void {
    this.adapterFailureHistory = [];
    this.lastRunDiagnostics = null;
    this.activeRunFailures = [];
    this.activeRunStartedAt = null;
    this.activeRunDepth = 0;
  }

  private async runTracked<T>(operation: () => Promise<T>): Promise<T> {
    const isTopLevelRun = this.activeRunDepth === 0;
    if (isTopLevelRun) {
      this.activeRunStartedAt = new Date().toISOString();
      this.activeRunFailures = [];
    }

    this.activeRunDepth += 1;
    try {
      return await operation();
    } finally {
      this.activeRunDepth -= 1;
      if (isTopLevelRun) {
        const startedAt = this.activeRunStartedAt ?? new Date().toISOString();
        const completedAt = new Date().toISOString();
        const failures = [...this.activeRunFailures];
        const failureCountByProvider: Partial<Record<CloudProvider, number>> = {};
        const failureCountByOperation: Partial<Record<HybridDiscoveryOperation, number>> = {};

        for (const failure of failures) {
          failureCountByProvider[failure.provider] = (failureCountByProvider[failure.provider] ?? 0) + 1;
          failureCountByOperation[failure.operation] = (failureCountByOperation[failure.operation] ?? 0) + 1;
        }

        this.lastRunDiagnostics = {
          startedAt,
          completedAt,
          failures,
          failureCountByProvider,
          failureCountByOperation,
        };
      }
    }
  }

  private recordAdapterFailure(
    provider: CloudProvider,
    operation: HybridDiscoveryOperation,
    error: unknown,
  ): void {
    const failure: HybridAdapterFailure = {
      provider,
      operation,
      type: classifyFailureType(error),
      message: toErrorMessage(error),
      timestamp: new Date().toISOString(),
      retryable: isRetryableFailure(error),
    };

    this.activeRunFailures.push(failure);
    this.adapterFailureHistory.push(failure);
    if (this.adapterFailureHistory.length > this.maxFailureHistory) {
      const overflow = this.adapterFailureHistory.length - this.maxFailureHistory;
      this.adapterFailureHistory.splice(0, overflow);
    }
    this.onAdapterFailure?.(failure);
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function classifyFailureType(error: unknown): HybridDiscoveryFailureType {
  const message = toErrorMessage(error).toLowerCase();
  if (message.includes("timeout") || message.includes("timed out") || message.includes("etimedout")) {
    return "timeout";
  }
  if (
    message.includes("auth")
    || message.includes("token")
    || message.includes("credential")
    || message.includes("unauthorized")
  ) {
    return "authentication";
  }
  if (message.includes("forbidden") || message.includes("permission") || message.includes("access denied")) {
    return "permission";
  }
  if (
    message.includes("network")
    || message.includes("dns")
    || message.includes("econnrefused")
    || message.includes("ehostunreach")
  ) {
    return "network";
  }
  if (message.includes("invalid") || message.includes("validation") || message.includes("bad request")) {
    return "validation";
  }
  return "unknown";
}

function isRetryableFailure(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes("timeout")
    || message.includes("timed out")
    || message.includes("network")
    || message.includes("tempor")
    || message.includes("rate limit")
    || message.includes("too many requests")
    || message.includes("econnrefused")
    || message.includes("ehostunreach")
  );
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
