/**
 * Graph — Post-Migration Sync
 *
 * After migration completes, syncs the final state of resources
 * back to the knowledge graph: new provider locations, updated
 * IDs, dependency updates, and migration metadata.
 */

import type { MigrationJob, NormalizedVM, NormalizedBucket } from "../types.js";
import type { GraphNodeInput, GraphEdgeInput } from "./migration-adapter.js";
import { getResolvedExtensions } from "../integrations/extension-bridge.js";

// =============================================================================
// Types
// =============================================================================

export interface PostMigrationSyncResult {
  nodesUpdated: number;
  nodesCreated: number;
  edgesCreated: number;
  edgesRemoved: number;
  durationMs: number;
}

export interface ResourceMapping {
  sourceId: string;
  targetId: string;
  sourceProvider: string;
  targetProvider: string;
  resourceType: string;
  migratedAt: string;
}

// =============================================================================
// Post-Migration Graph Updates
// =============================================================================

/**
 * Generate graph updates for post-migration state.
 */
export function generatePostMigrationUpdates(params: {
  job: MigrationJob;
  resourceMappings: ResourceMapping[];
  targetVMs: NormalizedVM[];
  targetBuckets: NormalizedBucket[];
}): {
  newNodes: GraphNodeInput[];
  newEdges: GraphEdgeInput[];
  deprecatedNodeIds: string[];
} {
  const newNodes: GraphNodeInput[] = [];
  const newEdges: GraphEdgeInput[] = [];
  const deprecatedNodeIds: string[] = [];

  // Create nodes for target resources
  for (const vm of params.targetVMs) {
    newNodes.push({
      id: `migration:vm:${vm.id}`,
      type: "compute-instance",
      label: vm.name,
      properties: {
        provider: vm.provider,
        region: vm.region,
        cpuCores: vm.cpuCores,
        memoryGB: vm.memoryGB,
        osType: vm.osType,
        migratedFrom: params.job.source.provider,
        migrationJobId: params.job.id,
      },
      provider: vm.provider,
    });
  }

  for (const bucket of params.targetBuckets) {
    newNodes.push({
      id: `migration:bucket:${bucket.id}`,
      type: "object-storage",
      label: bucket.name,
      properties: {
        provider: bucket.provider,
        region: bucket.region,
        migratedFrom: params.job.source.provider,
        migrationJobId: params.job.id,
      },
      provider: bucket.provider,
    });
  }

  // Create migration relationship edges (source → target)
  for (const mapping of params.resourceMappings) {
    const sourceNodeId = `migration:${mapping.resourceType}:${mapping.sourceId}`;
    const targetNodeId = `migration:${mapping.resourceType}:${mapping.targetId}`;

    newEdges.push({
      source: sourceNodeId,
      target: targetNodeId,
      type: "migrated-to",
      properties: {
        migratedAt: mapping.migratedAt,
        migrationJobId: params.job.id,
        sourceProvider: mapping.sourceProvider,
        targetProvider: mapping.targetProvider,
      },
    });

    // Mark source as deprecated
    deprecatedNodeIds.push(sourceNodeId);
  }

  // Job completion node update
  newNodes.push({
    id: `migration:job:${params.job.id}`,
    type: "migration-job",
    label: `Migration: ${params.job.source.provider} → ${params.job.target.provider}`,
    properties: {
      phase: params.job.phase,
      sourceProvider: params.job.source.provider,
      targetProvider: params.job.target.provider,
      completedAt: new Date().toISOString(),
      resourcesMigrated: params.resourceMappings.length,
    },
    provider: "cloud-migration",
  });

  return { newNodes, newEdges, deprecatedNodeIds };
}

/**
 * Generate a migration lineage report from graph data.
 */
export function generateLineageReport(
  resourceMappings: ResourceMapping[],
): {
  totalMigrated: number;
  byType: Record<string, number>;
  bySourceProvider: Record<string, number>;
  byTargetProvider: Record<string, number>;
  timeline: Array<{ date: string; count: number }>;
} {
  const byType: Record<string, number> = {};
  const bySourceProvider: Record<string, number> = {};
  const byTargetProvider: Record<string, number> = {};
  const dateCount: Record<string, number> = {};

  for (const mapping of resourceMappings) {
    byType[mapping.resourceType] = (byType[mapping.resourceType] ?? 0) + 1;
    bySourceProvider[mapping.sourceProvider] = (bySourceProvider[mapping.sourceProvider] ?? 0) + 1;
    byTargetProvider[mapping.targetProvider] = (byTargetProvider[mapping.targetProvider] ?? 0) + 1;

    const date = mapping.migratedAt.split("T")[0];
    dateCount[date] = (dateCount[date] ?? 0) + 1;
  }

  const timeline = Object.entries(dateCount)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalMigrated: resourceMappings.length,
    byType,
    bySourceProvider,
    byTargetProvider,
    timeline,
  };
}

// =============================================================================
// Knowledge Graph Integration
// =============================================================================

/**
 * Push post-migration graph updates into the knowledge-graph extension.
 *
 * Creates new target-side nodes, migration relationship edges,
 * and deprecates source-side nodes that have been migrated.
 *
 * Returns sync stats, or null if knowledge-graph is unavailable.
 */
export async function syncPostMigrationToKnowledgeGraph(params: {
  job: MigrationJob;
  resourceMappings: ResourceMapping[];
  targetVMs: NormalizedVM[];
  targetBuckets: NormalizedBucket[];
}): Promise<PostMigrationSyncResult | null> {
  try {
    const ext = getResolvedExtensions();
    if (!ext?.knowledgeGraph) return null;

    const startTime = Date.now();
    const { newNodes, newEdges, deprecatedNodeIds } =
      generatePostMigrationUpdates(params);

    // Upsert new target-side nodes and migration edges
    await ext.knowledgeGraph.upsertNodes(newNodes);
    await ext.knowledgeGraph.upsertEdges(newEdges);

    // Remove deprecated source-side nodes
    for (const nodeId of deprecatedNodeIds) {
      await ext.knowledgeGraph.deleteNode(nodeId);
    }

    return {
      nodesCreated: newNodes.length,
      nodesUpdated: 0,
      edgesCreated: newEdges.length,
      edgesRemoved: deprecatedNodeIds.length,
      durationMs: Date.now() - startTime,
    };
  } catch {
    // Graceful degradation — don't block post-migration on KG failures
    return null;
  }
}
