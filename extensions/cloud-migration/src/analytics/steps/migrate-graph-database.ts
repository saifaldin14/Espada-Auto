/**
 * Analytics Step — Migrate Graph Database
 *
 * Migrates Neptune / Cosmos DB Gremlin / Neo4j graph databases including
 * cluster configuration and data to the target provider.
 * Handles:
 *   - Cluster and instance creation
 *   - Query language compatibility checks
 *   - Storage and encryption configuration
 *   - Replica configuration
 *   - Data export and import
 *   - Tag migration
 *
 * Note: Query language compatibility varies (SPARQL not widely supported
 * outside Neptune); clusterMode may not be available; property graph → RDF
 * conversion is lossy.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

export const migrateGraphDatabaseHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;
    const transferData = (params.transferData ?? false) as boolean;

    log.info(`[migrate-graph-database] Migrating graph databases → ${targetProvider}`);

    const graphDatabases = (params.graphDatabases ?? []) as Array<{
      id: string;
      name: string;
      engine: string;
      queryLanguages: string[];
      instanceClass: string;
      storageGB: number;
      encrypted: boolean;
      clusterMode: boolean;
      replicaCount: number;
      tags?: Record<string, string>;
    }>;

    const migratedDatabases: Array<{
      sourceId: string;
      sourceName: string;
      targetId: string;
      engine: string;
      dataImported: boolean;
      storageGB: number;
      replicaCount: number;
    }> = [];
    const warnings: string[] = [];

    const targetAdapter = ctx.targetCredentials as
      | {
          analytics?: {
            createGraphDatabase: (db: unknown) => Promise<{ id: string }>;
            importGraphData: (dbId: string, data: unknown) => Promise<void>;
            deleteGraphDatabase: (id: string) => Promise<void>;
          };
        }
      | undefined;

    const sourceAdapter = ctx.sourceCredentials as
      | {
          analytics?: {
            exportGraphData: (dbId: string) => Promise<unknown>;
          };
        }
      | undefined;

    for (const db of graphDatabases) {
      const name = String(db.name ?? "");

      // SPARQL not widely supported outside Neptune
      if ((db.queryLanguages ?? []).includes("SPARQL") && targetProvider !== "aws") {
        warnings.push(
          `Graph database "${name}": SPARQL is not widely supported outside Neptune — queries may need rewriting`,
        );
      }

      // Property graph → RDF conversion is lossy
      const hasRDF = (db.queryLanguages ?? []).includes("SPARQL");
      const hasPropertyGraph = (db.queryLanguages ?? []).some(
        (ql) => ql === "Gremlin" || ql === "openCypher",
      );
      if (hasRDF && hasPropertyGraph) {
        warnings.push(
          `Graph database "${name}": Property graph ↔ RDF conversion is lossy — data fidelity may be affected`,
        );
      }

      // clusterMode may not be available
      if (db.clusterMode && targetProvider !== "aws") {
        warnings.push(
          `Graph database "${name}": Cluster mode may not be available on ${targetProvider}`,
        );
      }

      let dataImported = false;

      if (targetAdapter?.analytics) {
        const result = await targetAdapter.analytics.createGraphDatabase({
          name,
          engine: db.engine,
          queryLanguages: db.queryLanguages,
          instanceClass: db.instanceClass,
          storageGB: db.storageGB,
          encrypted: db.encrypted,
          clusterMode: db.clusterMode,
          replicaCount: db.replicaCount,
          tags: db.tags,
        });

        if (transferData && sourceAdapter?.analytics) {
          const exportedData = await sourceAdapter.analytics.exportGraphData(db.id);
          await targetAdapter.analytics.importGraphData(result.id, exportedData);
          dataImported = true;
        }

        migratedDatabases.push({
          sourceId: db.id,
          sourceName: name,
          targetId: result.id,
          engine: db.engine,
          dataImported,
          storageGB: db.storageGB,
          replicaCount: db.replicaCount,
        });
      } else {
        migratedDatabases.push({
          sourceId: db.id,
          sourceName: name,
          targetId: `simulated-${name}`,
          engine: db.engine,
          dataImported: false,
          storageGB: db.storageGB,
          replicaCount: db.replicaCount,
        });
      }
    }

    log.info(`[migrate-graph-database] Migrated ${migratedDatabases.length} graph databases`);

    return {
      migratedDatabases,
      databaseCount: migratedDatabases.length,
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    const migratedDatabases = (outputs.migratedDatabases ?? []) as Array<{ targetId: string }>;

    log.info(`[migrate-graph-database] Rolling back ${migratedDatabases.length} graph databases`);

    const targetAdapter = ctx.targetCredentials as
      | { analytics?: { deleteGraphDatabase: (id: string) => Promise<void> } }
      | undefined;

    if (targetAdapter?.analytics) {
      for (const db of migratedDatabases) {
        await targetAdapter.analytics.deleteGraphDatabase(db.targetId);
      }
    }

    log.info("[migrate-graph-database] Rollback complete");
  },
};
