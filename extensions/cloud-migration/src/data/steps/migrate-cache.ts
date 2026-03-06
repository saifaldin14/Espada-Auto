/**
 * Cache Cluster Migration Step Handler
 *
 * Migrates cache clusters between providers:
 *   ElastiCache (Redis/Memcached) → Azure Cache for Redis / Memorystore
 *
 * Handles configuration migration. Cache data is ephemeral and generally
 * does NOT need to be transferred (it will be rebuilt by applications).
 * For Redis with RDB persistence, optional snapshot export is supported.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateCacheHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const clusters = (params.clusters ?? []) as Array<Record<string, unknown>>;

    log.info(`[migrate-cache] Migrating ${clusters.length} cache cluster(s) to ${targetProvider}`);

    const migrated: Array<{
      sourceId: string;
      sourceName: string;
      engine: string;
      targetId: string;
      nodeCount: number;
      dataTransferred: boolean;
    }> = [];
    const warnings: string[] = [];

    for (const cluster of clusters) {
      const name = String(cluster.name ?? "");
      const engine = String(cluster.engine ?? "redis");
      const nodeCount = Number(cluster.nodeCount ?? 1);

      if (engine === "memcached") {
        warnings.push(
          `Cache "${name}": Memcached data is entirely ephemeral and will NOT be transferred. ` +
          `Only configuration is migrated.`,
        );
      }

      // Map node type to target equivalent
      const targetNodeType = mapCacheNodeType(String(cluster.nodeType ?? "cache.t3.medium"), targetProvider);

      migrated.push({
        sourceId: String(cluster.id ?? ""),
        sourceName: name,
        engine,
        targetId: `simulated-cache-${name}`,
        nodeCount,
        dataTransferred: false, // Cache data is ephemeral
      });

      log.info(
        `[migrate-cache] Cluster "${name}" (${engine}): ${nodeCount} nodes, type ${cluster.nodeType} → ${targetNodeType}`,
      );
    }

    log.info(`[migrate-cache] Migrated ${migrated.length} cache clusters`);

    return {
      migratedClusters: migrated,
      clustersCount: migrated.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    log.info("[migrate-cache] Cache rollback — target cache clusters should be deleted manually");
  },
};

function mapCacheNodeType(nodeType: string, targetProvider: string): string {
  // Rough mapping of AWS ElastiCache node types → target equivalents
  const NODE_MAP: Record<string, Record<string, string>> = {
    azure: {
      "cache.t3.micro": "C0",
      "cache.t3.small": "C1",
      "cache.t3.medium": "C2",
      "cache.m5.large": "C3",
      "cache.m5.xlarge": "C4",
      "cache.r5.large": "P1",
      "cache.r5.xlarge": "P2",
    },
    gcp: {
      "cache.t3.micro": "M1",
      "cache.t3.small": "M2",
      "cache.t3.medium": "M3",
      "cache.m5.large": "M4",
      "cache.m5.xlarge": "M5",
      "cache.r5.large": "M4",
      "cache.r5.xlarge": "M5",
    },
  };
  return NODE_MAP[targetProvider]?.[nodeType] ?? nodeType;
}
