/**
 * Data Step — Export Database
 *
 * Extracts schema information and generates a dump of the source database.
 * Supports PostgreSQL (pg_dump) and MySQL/MariaDB (mysqldump) engines.
 *
 * Produces:
 *   - A schema snapshot (tables, columns, types, constraints)
 *   - The dump command string (for verification / audit trail)
 *   - A dump file path reference (for the transfer step)
 *
 * The actual dump execution is delegated to the host environment's CLI tools
 * (pg_dump / mysqldump) which must be available on the migration worker.
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";
import type { DatabaseConnection, DatabaseSchema } from "../types.js";
import { extractPostgresSchema, buildPgDumpCommand } from "../database/pg-migrator.js";
import { extractMySQLSchema, buildMySQLDumpCommand } from "../database/mysql-migrator.js";
import { generateSchemaChanges } from "../database/schema-comparator.js";

// =============================================================================
// Params
// =============================================================================

export interface ExportDatabaseParams {
  sourceConnection: Omit<DatabaseConnection, "password">;
  targetEngine?: "postgresql" | "mysql" | "mariadb";
  tables?: string[];
  excludeTables?: string[];
  schemaOnly?: boolean;
  dataOnly?: boolean;
  parallelJobs?: number;
  outputPath?: string;
  format?: "custom" | "plain" | "directory" | "tar";
}

// =============================================================================
// Execute
// =============================================================================

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as ExportDatabaseParams;
  const { sourceConnection } = params;
  const engine = sourceConnection.engine;

  ctx.log.info(`Exporting ${engine} database: ${sourceConnection.host}:${sourceConnection.port}/${sourceConnection.database}`);

  // 1. Extract schema from the source
  let schema: DatabaseSchema;
  if (engine === "postgresql") {
    schema = await extractPostgresSchema(sourceConnection);
  } else {
    schema = await extractMySQLSchema(sourceConnection);
  }

  ctx.log.info(`  Schema extracted: ${schema.tables.length} tables, ${schema.views.length} views`);

  // 2. Compute cross-engine schema changes (if target engine differs)
  const targetEngine = params.targetEngine ?? engine;
  const schemaChanges = generateSchemaChanges(schema, engine, targetEngine);
  if (schemaChanges.length > 0) {
    ctx.log.info(`  ${schemaChanges.length} cross-engine type mapping(s) required`);
  }

  // 3. Generate the dump command
  const outputPath = params.outputPath ?? `/tmp/espada-migration-${sourceConnection.database}-${Date.now()}.dump`;
  let dumpCommand: string;

  if (engine === "postgresql") {
    dumpCommand = buildPgDumpCommand({
      connection: sourceConnection,
      format: params.format ?? "custom",
      tables: params.tables,
      excludeTables: params.excludeTables,
      schemaOnly: params.schemaOnly,
      dataOnly: params.dataOnly,
      parallelJobs: params.parallelJobs,
      outputPath,
    });
  } else {
    dumpCommand = buildMySQLDumpCommand({
      connection: sourceConnection,
      tables: params.tables,
      excludeTables: params.excludeTables,
      schemaOnly: params.schemaOnly,
      dataOnly: params.dataOnly,
      singleTransaction: true,
      routines: true,
      triggers: true,
      events: false,
      outputPath,
    });
  }

  ctx.log.info(`  Dump command: ${dumpCommand.replace(/--password=\S+/g, "--password=***")}`);

  // 4. Estimate dump size from table metadata
  const estimatedSizeBytes = schema.tables.reduce((sum, t) => sum + t.sizeBytes, 0);

  ctx.log.info(`  Estimated dump size: ${(estimatedSizeBytes / (1024 * 1024)).toFixed(1)} MB`);
  ctx.log.info(`  Output path: ${outputPath}`);

  return {
    engine,
    database: sourceConnection.database,
    schema: {
      tableCount: schema.tables.length,
      viewCount: schema.views.length,
      functionCount: schema.functions.length,
      sequenceCount: schema.sequences.length,
      extensionCount: schema.extensions.length,
      tables: schema.tables.map((t) => ({
        name: t.name,
        columnCount: t.columns.length,
        rowCount: t.rowCount,
        sizeBytes: t.sizeBytes,
        partitioned: t.partitioned,
      })),
    },
    schemaChanges: schemaChanges.map((c) => ({
      type: c.type,
      table: c.table,
      column: c.column,
      sourceType: c.sourceType,
      targetType: c.targetType,
      automatic: c.automatic,
    })),
    dumpCommand,
    outputPath,
    estimatedSizeBytes,
    exportedAt: new Date().toISOString(),
  };
}

// =============================================================================
// Rollback — remove generated dump file reference (actual file cleanup
//            is handled by the worker's temp file manager)
// =============================================================================

async function rollback(ctx: MigrationStepContext, outputs: Record<string, unknown>): Promise<void> {
  const outputPath = outputs?.outputPath as string | undefined;
  ctx.log.info(`Rolling back database export: cleaning up dump at ${outputPath ?? "unknown"}`);
}

export const exportDatabaseHandler: MigrationStepHandler = {
  execute,
  rollback,
};
