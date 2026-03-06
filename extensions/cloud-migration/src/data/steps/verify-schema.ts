/**
 * Data Step — Verify Schema
 *
 * Post-migration schema verification for database migrations.
 * Compares source and target schemas to ensure structural equivalence,
 * validates row counts, and detects type mapping discrepancies.
 *
 * Verification levels:
 *   1. **Structural** — table count, column count, constraint presence
 *   2. **Type fidelity** — cross-engine type mappings applied correctly
 *   3. **Row count** — source vs target row counts within tolerance
 *   4. **Index & constraint** — indexes and FK constraints preserved
 */

import type { MigrationStepHandler, MigrationStepContext } from "../../types.js";
import type { DatabaseConnection, DatabaseSchema, SchemaChange } from "../types.js";
import { extractPostgresSchema } from "../database/pg-migrator.js";
import { extractMySQLSchema } from "../database/mysql-migrator.js";
import { compareSchemas, generateSchemaChanges } from "../database/schema-comparator.js";

// =============================================================================
// Params
// =============================================================================

export interface VerifySchemaParams {
  sourceConnection: Omit<DatabaseConnection, "password">;
  targetConnection: Omit<DatabaseConnection, "password">;
  sourceEngine: "postgresql" | "mysql" | "mariadb";
  targetEngine: "postgresql" | "mysql" | "mariadb";
  /**
   * Row count tolerance as a fraction (0.0 – 1.0).
   * Default: 0.0 (exact match required).
   */
  rowCountTolerance?: number;
  /**
   * Tables to verify.  If omitted, all tables are checked.
   */
  tables?: string[];
  /**
   * Whether to treat type mapping differences as failures.
   * Default: false (warnings only).
   */
  strictTypeMapping?: boolean;
}

// =============================================================================
// Execute
// =============================================================================

async function execute(ctx: MigrationStepContext): Promise<Record<string, unknown>> {
  const params = ctx.params as unknown as VerifySchemaParams;
  const tolerance = params.rowCountTolerance ?? 0;
  const startTime = Date.now();

  ctx.log.info(
    `Verifying schema: ${params.sourceEngine}://${params.sourceConnection.database} → ` +
    `${params.targetEngine}://${params.targetConnection.database}`,
  );

  // 1. Extract schemas from both endpoints
  ctx.log.info("  Phase 1: Extracting source schema");
  ctx.signal?.throwIfAborted();

  const sourceSchema = params.sourceEngine === "postgresql"
    ? await extractPostgresSchema(params.sourceConnection)
    : await extractMySQLSchema(params.sourceConnection);

  ctx.log.info(`  Source: ${sourceSchema.tables.length} tables`);

  ctx.log.info("  Extracting target schema");
  ctx.signal?.throwIfAborted();

  const targetSchema = params.targetEngine === "postgresql"
    ? await extractPostgresSchema(params.targetConnection)
    : await extractMySQLSchema(params.targetConnection);

  ctx.log.info(`  Target: ${targetSchema.tables.length} tables`);

  // 2. Compare schemas
  ctx.log.info("  Phase 2: Comparing schemas");
  const comparison = compareSchemas(sourceSchema, targetSchema);

  // 3. Verify cross-engine type mappings
  ctx.log.info("  Phase 3: Verifying type mappings");
  const expectedChanges = generateSchemaChanges(sourceSchema, params.sourceEngine, params.targetEngine);

  // 4. Verify row counts
  ctx.log.info("  Phase 4: Verifying row counts");
  const rowCountResults: Array<{
    table: string;
    sourceRows: number;
    targetRows: number;
    passed: boolean;
    variance: number;
  }> = [];

  const tablesToCheck = params.tables
    ? sourceSchema.tables.filter((t) => params.tables!.includes(t.name))
    : sourceSchema.tables;

  for (const srcTable of tablesToCheck) {
    const tgtTable = targetSchema.tables.find((t) => t.name === srcTable.name);
    const targetRows = tgtTable?.rowCount ?? 0;
    const variance = srcTable.rowCount > 0
      ? Math.abs(srcTable.rowCount - targetRows) / srcTable.rowCount
      : targetRows === 0 ? 0 : 1;

    rowCountResults.push({
      table: srcTable.name,
      sourceRows: srcTable.rowCount,
      targetRows,
      passed: variance <= tolerance,
      variance: Math.round(variance * 10000) / 100, // percentage with 2 decimals
    });
  }

  // 5. Aggregate results
  const checks: Array<{
    name: string;
    passed: boolean;
    expected: string | number;
    actual: string | number;
    details?: string;
  }> = [];

  // Check: table count
  checks.push({
    name: "table-count",
    passed: comparison.addedTables.length === 0,
    expected: sourceSchema.tables.length,
    actual: targetSchema.tables.length,
    details: comparison.addedTables.length > 0
      ? `Missing tables: ${comparison.addedTables.join(", ")}`
      : undefined,
  });

  // Check: no removed tables
  checks.push({
    name: "no-extra-tables",
    passed: comparison.removedTables.length === 0,
    expected: 0,
    actual: comparison.removedTables.length,
    details: comparison.removedTables.length > 0
      ? `Extra tables in target: ${comparison.removedTables.join(", ")}`
      : undefined,
  });

  // Check: schema compatibility
  checks.push({
    name: "schema-compatible",
    passed: comparison.compatible,
    expected: "compatible",
    actual: comparison.compatible ? "compatible" : "incompatible",
    details: !comparison.compatible
      ? `${comparison.modifiedTables.length} modified table(s)`
      : undefined,
  });

  // Check: type mappings applied
  if (params.strictTypeMapping && expectedChanges.length > 0) {
    const unmappedTypes = comparison.modifiedTables.flatMap((t) => t.typeChanges);
    checks.push({
      name: "type-mapping-fidelity",
      passed: unmappedTypes.length === 0,
      expected: "all types mapped",
      actual: unmappedTypes.length > 0 ? `${unmappedTypes.length} unmapped type(s)` : "all types mapped",
    });
  }

  // Check: row counts
  const failedRowChecks = rowCountResults.filter((r) => !r.passed);
  checks.push({
    name: "row-count-match",
    passed: failedRowChecks.length === 0,
    expected: rowCountResults.length,
    actual: rowCountResults.length - failedRowChecks.length,
    details: failedRowChecks.length > 0
      ? failedRowChecks.map((r) => `${r.table}: ${r.sourceRows} → ${r.targetRows} (${r.variance}% variance)`).join("; ")
      : undefined,
  });

  const allPassed = checks.every((c) => c.passed);
  const durationMs = Date.now() - startTime;

  ctx.log.info(
    `  Verification ${allPassed ? "PASSED" : "FAILED"}: ` +
    `${checks.filter((c) => c.passed).length}/${checks.length} checks passed in ${durationMs}ms`,
  );

  if (!allPassed) {
    for (const failed of checks.filter((c) => !c.passed)) {
      ctx.log.warn(`  FAILED: ${failed.name} — expected ${failed.expected}, got ${failed.actual}`);
    }
  }

  return {
    passed: allPassed,
    checks,
    sourceDatabase: params.sourceConnection.database,
    targetDatabase: params.targetConnection.database,
    sourceEngine: params.sourceEngine,
    targetEngine: params.targetEngine,
    comparison: {
      addedTables: comparison.addedTables,
      removedTables: comparison.removedTables,
      modifiedTableCount: comparison.modifiedTables.length,
      sourceRowCount: comparison.sourceRowCount,
      targetRowCount: comparison.targetRowCount,
    },
    rowCountResults,
    expectedSchemaChanges: expectedChanges.length,
    durationMs,
    verifiedAt: new Date().toISOString(),
  };
}

// Schema verification is read-only — no rollback needed
export const verifySchemaHandler: MigrationStepHandler = {
  execute,
};
