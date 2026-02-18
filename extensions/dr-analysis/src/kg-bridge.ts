/**
 * DR Analysis ↔ Knowledge Graph Bridge
 *
 * Converts Knowledge Graph topology (GraphNode/GraphEdge) into the
 * simplified DR types (DRNode/DREdge) and populates the tool cache.
 */

import type { DRNode, DREdge, CloudProvider } from "./types.js";
import { setGraphData } from "./tools.js";
import { analyzePosture, generateRecoveryPlan, findUnprotectedCritical } from "./analyzer.js";
import type { DRAnalysis, RecoveryPlan, FailureScenario } from "./types.js";

// =============================================================================
// Type Bridge — KG → DR
// =============================================================================

/** Loose shape of a KG GraphNode (avoids hard import from the KG extension). */
export interface KGNode {
  id: string;
  name: string;
  provider: string;
  resourceType: string;
  region: string;
  status: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  costMonthly: number | null;
}

/** Loose shape of a KG GraphEdge. */
export interface KGEdge {
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: string;
}

/** DR-supported providers. KG may send "kubernetes" or "custom", which we skip. */
const DR_PROVIDERS = new Set<string>(["aws", "azure", "gcp"]);

/**
 * Convert a KG GraphNode array to DRNode array.
 * Nodes with unsupported providers are filtered out.
 */
export function kgNodesToDR(nodes: KGNode[]): DRNode[] {
  const result: DRNode[] = [];
  for (const n of nodes) {
    if (!DR_PROVIDERS.has(n.provider)) continue;
    result.push({
      id: n.id,
      name: n.name,
      provider: n.provider as CloudProvider,
      resourceType: n.resourceType,
      region: n.region,
      status: n.status,
      tags: n.tags ?? {},
      metadata: n.metadata ?? {},
      costMonthly: n.costMonthly ?? null,
    });
  }
  return result;
}

/**
 * Convert KG GraphEdge array to DREdge array.
 * Only includes edges where both endpoints are in the given node set.
 */
export function kgEdgesToDR(edges: KGEdge[], nodeIds: Set<string>): DREdge[] {
  const result: DREdge[] = [];
  for (const e of edges) {
    if (!nodeIds.has(e.sourceNodeId) || !nodeIds.has(e.targetNodeId)) continue;
    result.push({
      sourceId: e.sourceNodeId,
      targetId: e.targetNodeId,
      relationshipType: e.relationshipType,
    });
  }
  return result;
}

// =============================================================================
// KG Bridge — Sync + Analysis Facade
// =============================================================================

/**
 * Bridge that fetches topology from the Knowledge Graph engine and runs
 * DR analysis. Provides both push (syncFromKG) and pull (analyze*) semantics.
 */
export class KnowledgeGraphBridge {
  /** Current DR node snapshot. */
  private nodes: DRNode[] = [];
  /** Current DR edge snapshot. */
  private edges: DREdge[] = [];
  /** Timestamp of last successful sync. */
  private lastSyncAt: string | null = null;

  /**
   * @param fetchTopology Callback that returns the KG topology.
   *   Typically `(filter?) => engine.getTopology(filter)`.
   */
  constructor(
    private fetchTopology: (filter?: Record<string, unknown>) => Promise<{
      nodes: KGNode[];
      edges: KGEdge[];
    }>,
  ) {}

  /** Pull latest topology from the Knowledge Graph and populate tool cache. */
  async sync(filter?: { provider?: string; region?: string }): Promise<{
    nodeCount: number;
    edgeCount: number;
    filteredOut: number;
  }> {
    const kgFilter: Record<string, unknown> = {};
    if (filter?.provider) kgFilter.provider = filter.provider;
    if (filter?.region) kgFilter.region = filter.region;

    const topo = await this.fetchTopology(
      Object.keys(kgFilter).length > 0 ? kgFilter : undefined,
    );

    const drNodes = kgNodesToDR(topo.nodes);
    const nodeIds = new Set(drNodes.map((n) => n.id));
    const drEdges = kgEdgesToDR(topo.edges, nodeIds);

    this.nodes = drNodes;
    this.edges = drEdges;
    this.lastSyncAt = new Date().toISOString();

    // Push into the tool cache so agent tools get live data
    setGraphData(drNodes, drEdges);

    return {
      nodeCount: drNodes.length,
      edgeCount: drEdges.length,
      filteredOut: topo.nodes.length - drNodes.length,
    };
  }

  /** Analyze overall DR posture using current snapshot. */
  analyzePosture(): DRAnalysis | null {
    if (this.nodes.length === 0) return null;
    return analyzePosture(this.nodes, this.edges);
  }

  /** Generate a recovery plan for a failure scenario. */
  generatePlan(
    scenario: FailureScenario,
    targetRegion?: string,
  ): RecoveryPlan | null {
    if (this.nodes.length === 0) return null;
    return generateRecoveryPlan(scenario, this.nodes, this.edges, targetRegion);
  }

  /** Find resources lacking DR protection. */
  findGaps(resourceType?: string): DRNode[] {
    if (this.nodes.length === 0) return [];
    let gaps = findUnprotectedCritical(this.nodes, this.edges);
    if (resourceType) {
      gaps = gaps.filter((n) => n.resourceType === resourceType);
    }
    return gaps;
  }

  /** Get bridge metadata for status reporting. */
  getStatus(): { synced: boolean; lastSyncAt: string | null; nodeCount: number; edgeCount: number } {
    return {
      synced: this.nodes.length > 0,
      lastSyncAt: this.lastSyncAt,
      nodeCount: this.nodes.length,
      edgeCount: this.edges.length,
    };
  }
}
