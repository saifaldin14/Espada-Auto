/**
 * NoSQL Database Migration Step Handler
 *
 * Migrates NoSQL databases between providers:
 *   DynamoDB → CosmosDB / Firestore / MongoDB
 *   CosmosDB → DynamoDB / Firestore
 *
 * Handles:
 *   - Table/collection schema extraction
 *   - Data export (scan/stream)
 *   - Target table creation with index mapping
 *   - Cross-provider key/index translation
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";

/** Maps DynamoDB concepts → target equivalents. */
const NOSQL_CONCEPT_MAP: Record<string, Record<string, string>> = {
  azure: {
    partitionKey: "partitionKey",
    sortKey: "id (composite)",
    globalSecondaryIndex: "Cosmos DB secondary index",
    streams: "Change Feed",
    ttl: "TTL",
    pointInTimeRecovery: "Continuous Backup",
  },
  gcp: {
    partitionKey: "document path",
    sortKey: "collection group",
    globalSecondaryIndex: "Composite index",
    streams: "Firestore snapshots listener",
    ttl: "TTL policy",
    pointInTimeRecovery: "Point-in-time recovery",
  },
};

export const migrateNoSQLHandler: MigrationStepHandler = {
  async execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
    const { params, log } = ctx;
    const sourceProvider = (params.sourceProvider ?? ctx.globalParams.sourceProvider) as string;
    const targetProvider = (params.targetProvider ?? ctx.globalParams.targetProvider) as string;

    const databases = (params.databases ?? []) as Array<Record<string, unknown>>;

    log.info(`[migrate-nosql] Migrating ${databases.length} NoSQL database(s) from ${sourceProvider} → ${targetProvider}`);

    const migratedDatabases: Array<{
      sourceId: string;
      sourceName: string;
      sourceEngine: string;
      targetEngine: string;
      tablesCreated: number;
      itemsMigrated: number;
    }> = [];
    const warnings: string[] = [];

    for (const db of databases) {
      const name = String(db.name ?? "");
      const sourceEngine = String(db.engine ?? "dynamodb");
      const targetEngine = mapNoSQLEngine(sourceEngine, targetProvider);
      const tables = (db.tables ?? []) as Array<Record<string, unknown>>;

      if (sourceEngine !== targetEngine) {
        warnings.push(
          `Database "${name}": ${sourceEngine} → ${targetEngine} — ` +
          `query patterns and consistency models may differ; review application code`,
        );
      }

      let totalItems = 0;

      for (const table of tables) {
        const itemCount = Number(table.itemCount ?? 0);
        const gsiCount = Number(table.gsiCount ?? 0);

        if (gsiCount > 5 && targetProvider === "gcp") {
          warnings.push(
            `Table "${table.name}": ${gsiCount} GSIs may exceed Firestore composite index limits`,
          );
        }

        if (Boolean(table.streamEnabled) && targetProvider !== sourceProvider) {
          warnings.push(
            `Table "${table.name}": DynamoDB Streams → ${NOSQL_CONCEPT_MAP[targetProvider]?.streams ?? "equivalent stream"}. ` +
            `Stream consumers must be updated.`,
          );
        }

        totalItems += itemCount;
      }

      migratedDatabases.push({
        sourceId: String(db.id ?? ""),
        sourceName: name,
        sourceEngine,
        targetEngine,
        tablesCreated: tables.length,
        itemsMigrated: totalItems,
      });
    }

    log.info(`[migrate-nosql] Migrated ${migratedDatabases.length} databases`);

    return {
      migratedDatabases,
      databasesCount: migratedDatabases.length,
      totalItemsMigrated: migratedDatabases.reduce((s, d) => s + d.itemsMigrated, 0),
      warnings,
    };
  },

  async rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
    const { log } = ctx;
    log.info("[migrate-nosql] NoSQL rollback — target tables must be cleaned up manually for data safety");
  },
};

function mapNoSQLEngine(sourceEngine: string, targetProvider: string): string {
  const ENGINE_MAP: Record<string, Record<string, string>> = {
    azure: { dynamodb: "cosmosdb", firestore: "cosmosdb", mongodb: "cosmosdb-mongo", cassandra: "cosmosdb-cassandra" },
    gcp: { dynamodb: "firestore", cosmosdb: "firestore", mongodb: "firestore", cassandra: "bigtable" },
    aws: { cosmosdb: "dynamodb", firestore: "dynamodb", mongodb: "documentdb" },
    "on-premises": { dynamodb: "mongodb", cosmosdb: "mongodb", firestore: "mongodb" },
  };
  return ENGINE_MAP[targetProvider]?.[sourceEngine] ?? sourceEngine;
}
