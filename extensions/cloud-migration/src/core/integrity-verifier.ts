/**
 * Cross-Cloud Migration Engine — Integrity Verifier
 *
 * SHA-256 checksums at every transfer boundary.
 * Operates at three levels:
 * - Object-level: Each transferred file/object
 * - Volume-level: Block volume content (raw disk image checksum)
 * - Schema-level: Database table count, row count, schema DDL comparison
 */

import { createHash, randomUUID } from "node:crypto";

import type {
  IntegrityReport,
  IntegrityCheck,
  IntegrityLevel,
  MigrationResourceType,
  NormalizedObject,
  SchemaComparison,
} from "../types.js";
import { getPluginState } from "../state.js";

// =============================================================================
// SHA-256 Helpers
// =============================================================================

/**
 * Compute SHA-256 hash of a buffer or string.
 */
export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Compute SHA-256 hash incrementally from a stream-like iterable.
 */
export async function sha256Stream(
  chunks: AsyncIterable<Buffer>,
): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of chunks) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

// =============================================================================
// Object-Level Verification
// =============================================================================

/**
 * Verify integrity of individual objects by comparing source and target checksums.
 */
export function verifyObjectIntegrity(params: {
  jobId: string;
  sourceObjects: NormalizedObject[];
  targetObjects: NormalizedObject[];
}): IntegrityReport {
  const { jobId, sourceObjects, targetObjects } = params;
  const diag = getPluginState().diagnostics;
  const startMs = Date.now();
  const checks: IntegrityCheck[] = [];

  // Build target lookup
  const targetMap = new Map(targetObjects.map((obj) => [obj.key, obj]));

  // Count check
  checks.push({
    name: "object-count",
    passed: sourceObjects.length === targetObjects.length,
    expected: sourceObjects.length,
    actual: targetObjects.length,
    details: sourceObjects.length !== targetObjects.length
      ? `Missing ${sourceObjects.length - targetObjects.length} objects`
      : undefined,
  });

  // Total size check
  const sourceSize = sourceObjects.reduce((sum, o) => sum + o.sizeBytes, 0);
  const targetSize = targetObjects.reduce((sum, o) => sum + o.sizeBytes, 0);
  checks.push({
    name: "total-size-bytes",
    passed: sourceSize === targetSize,
    expected: sourceSize,
    actual: targetSize,
  });

  // Per-object SHA-256 check
  let checksumMatches = 0;
  let checksumMismatches = 0;
  let checksumMissing = 0;

  for (const sourceObj of sourceObjects) {
    const targetObj = targetMap.get(sourceObj.key);
    if (!targetObj) {
      checksumMissing++;
      continue;
    }

    if (sourceObj.sha256 && targetObj.sha256) {
      if (sourceObj.sha256 === targetObj.sha256) {
        checksumMatches++;
      } else {
        checksumMismatches++;
        // Include first few mismatches in details
        if (checksumMismatches <= 5) {
          checks.push({
            name: `checksum:${sourceObj.key}`,
            passed: false,
            expected: sourceObj.sha256,
            actual: targetObj.sha256,
            details: `SHA-256 mismatch for object: ${sourceObj.key}`,
          });
        }
      }
    }
  }

  checks.push({
    name: "checksum-matches",
    passed: checksumMismatches === 0 && checksumMissing === 0,
    expected: sourceObjects.length,
    actual: checksumMatches,
    details: checksumMismatches > 0
      ? `${checksumMismatches} checksum mismatches`
      : checksumMissing > 0
        ? `${checksumMissing} objects missing in target`
        : undefined,
  });

  const passed = checks.every((c) => c.passed);
  const durationMs = Date.now() - startMs;

  diag.integrityChecks++;
  if (passed) diag.integrityPassed++;
  else diag.integrityFailed++;

  return {
    jobId,
    resourceId: `objects:${sourceObjects.length}`,
    resourceType: "object-storage",
    level: "object-level",
    passed,
    checks,
    checkedAt: new Date().toISOString(),
    durationMs,
  };
}

// =============================================================================
// Volume-Level Verification
// =============================================================================

/**
 * Verify integrity of a block volume by comparing raw disk image checksums.
 */
export function verifyVolumeIntegrity(params: {
  jobId: string;
  volumeId: string;
  sourceChecksum: string;
  targetChecksum: string;
  sourceSizeBytes: number;
  targetSizeBytes: number;
}): IntegrityReport {
  const { jobId, volumeId, sourceChecksum, targetChecksum, sourceSizeBytes, targetSizeBytes } = params;
  const diag = getPluginState().diagnostics;
  const startMs = Date.now();
  const checks: IntegrityCheck[] = [];

  checks.push({
    name: "volume-checksum",
    passed: sourceChecksum === targetChecksum,
    expected: sourceChecksum,
    actual: targetChecksum,
    details: sourceChecksum !== targetChecksum ? "Volume SHA-256 mismatch after transfer/conversion" : undefined,
  });

  checks.push({
    name: "volume-size",
    passed: sourceSizeBytes === targetSizeBytes,
    expected: sourceSizeBytes,
    actual: targetSizeBytes,
    details: sourceSizeBytes !== targetSizeBytes
      ? `Size difference: ${Math.abs(sourceSizeBytes - targetSizeBytes)} bytes`
      : undefined,
  });

  const passed = checks.every((c) => c.passed);
  const durationMs = Date.now() - startMs;

  diag.integrityChecks++;
  if (passed) diag.integrityPassed++;
  else diag.integrityFailed++;

  return {
    jobId,
    resourceId: volumeId,
    resourceType: "disk",
    level: "volume-level",
    passed,
    checks,
    checkedAt: new Date().toISOString(),
    durationMs,
  };
}

// =============================================================================
// Schema-Level Verification
// =============================================================================

/**
 * Verify database migration integrity by comparing schemas and row counts.
 */
export function verifySchemaIntegrity(params: {
  jobId: string;
  databaseId: string;
  comparison: SchemaComparison;
}): IntegrityReport {
  const { jobId, databaseId, comparison } = params;
  const diag = getPluginState().diagnostics;
  const startMs = Date.now();
  const checks: IntegrityCheck[] = [];

  // Tables matched
  checks.push({
    name: "tables-matched",
    passed: comparison.tablesMissing.length === 0 && comparison.tablesExtra.length === 0,
    expected: comparison.tablesMatched + comparison.tablesMissing.length,
    actual: comparison.tablesMatched + comparison.tablesExtra.length,
    details: comparison.tablesMissing.length > 0
      ? `Missing tables: ${comparison.tablesMissing.join(", ")}`
      : comparison.tablesExtra.length > 0
        ? `Extra tables: ${comparison.tablesExtra.join(", ")}`
        : undefined,
  });

  // Row counts
  for (const diff of comparison.rowCountDiffs) {
    checks.push({
      name: `row-count:${diff.table}`,
      passed: diff.sourceCount === diff.targetCount,
      expected: diff.sourceCount,
      actual: diff.targetCount,
      details: diff.sourceCount !== diff.targetCount
        ? `Row count mismatch in ${diff.table}: ${diff.sourceCount} vs ${diff.targetCount}`
        : undefined,
    });
  }

  // Schema diffs
  if (comparison.schemaDiffs.length > 0) {
    checks.push({
      name: "schema-diffs",
      passed: false,
      expected: 0,
      actual: comparison.schemaDiffs.length,
      details: `Schema differences in: ${comparison.schemaDiffs.map((d) => d.table).join(", ")}`,
    });
  } else {
    checks.push({
      name: "schema-diffs",
      passed: true,
      expected: 0,
      actual: 0,
    });
  }

  const passed = checks.every((c) => c.passed);
  const durationMs = Date.now() - startMs;

  diag.integrityChecks++;
  if (passed) diag.integrityPassed++;
  else diag.integrityFailed++;

  return {
    jobId,
    resourceId: databaseId,
    resourceType: "database",
    level: "schema-level",
    passed,
    checks,
    checkedAt: new Date().toISOString(),
    durationMs,
  };
}

// =============================================================================
// Row-Level Verification (Enterprise SLA)
// =============================================================================

/**
 * A single row's checksum for cross-comparison between source and target.
 */
export interface RowChecksum {
  table: string;
  /** Primary key value(s) serialized as a string. */
  primaryKey: string;
  /** SHA-256 of the concatenated column values. */
  checksum: string;
}

/**
 * Result of row-level checksum verification for a table.
 */
export interface RowIntegrityResult {
  table: string;
  totalRows: number;
  sampledRows: number;
  matchedRows: number;
  mismatchedRows: number;
  missingInTarget: number;
  extraInTarget: number;
  passed: boolean;
  mismatches: Array<{ primaryKey: string; sourceChecksum: string; targetChecksum: string }>;
}

/**
 * Compute SHA-256 checksum for a row (all column values concatenated).
 *
 * @param columnValues - The ordered values of the row's columns.
 * @returns SHA-256 hex string.
 */
export function computeRowChecksum(columnValues: unknown[]): string {
  const serialized = columnValues.map((v) => (v === null || v === undefined ? "\\0" : String(v))).join("|");
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Verify row-level integrity between source and target databases.
 *
 * Compares SHA-256 checksums of individual rows (or a sample) from source
 * and target tables. This catches corruption, truncation, and encoding
 * issues that row-count and schema checks miss.
 *
 * @param params.jobId - Migration job ID.
 * @param params.databaseId - Identifier for the database being migrated.
 * @param params.sourceRows - Row checksums from the source database.
 * @param params.targetRows - Row checksums from the target database.
 * @param params.sampleRate - Fraction of rows to verify (0-1, default 1.0).
 * @returns IntegrityReport with row-level verification results.
 */
export function verifyRowIntegrity(params: {
  jobId: string;
  databaseId: string;
  sourceRows: RowChecksum[];
  targetRows: RowChecksum[];
  sampleRate?: number;
}): IntegrityReport {
  const { jobId, databaseId, sourceRows, targetRows, sampleRate = 1.0 } = params;
  const diag = getPluginState().diagnostics;
  const startMs = Date.now();
  const checks: IntegrityCheck[] = [];

  // Group by table
  const sourceByTable = groupRowsByTable(sourceRows);
  const targetByTable = groupRowsByTable(targetRows);

  const allTables = new Set([...sourceByTable.keys(), ...targetByTable.keys()]);
  const tableResults: RowIntegrityResult[] = [];

  for (const table of allTables) {
    const srcRows = sourceByTable.get(table) ?? [];
    const tgtRows = targetByTable.get(table) ?? [];

    // Sample source rows if sampleRate < 1
    const sampled = sampleRate < 1.0
      ? srcRows.filter(() => Math.random() < sampleRate)
      : srcRows;

    // Build target lookup
    const targetMap = new Map(tgtRows.map((r) => [r.primaryKey, r.checksum]));

    let matched = 0;
    let mismatched = 0;
    let missingInTarget = 0;
    const mismatches: Array<{ primaryKey: string; sourceChecksum: string; targetChecksum: string }> = [];

    for (const row of sampled) {
      const targetChecksum = targetMap.get(row.primaryKey);
      if (targetChecksum === undefined) {
        missingInTarget++;
      } else if (targetChecksum === row.checksum) {
        matched++;
      } else {
        mismatched++;
        if (mismatches.length < 10) {
          mismatches.push({
            primaryKey: row.primaryKey,
            sourceChecksum: row.checksum,
            targetChecksum,
          });
        }
      }
    }

    // Check for extra rows in target
    const sourceKeySet = new Set(srcRows.map((r) => r.primaryKey));
    const extraInTarget = tgtRows.filter((r) => !sourceKeySet.has(r.primaryKey)).length;

    const result: RowIntegrityResult = {
      table,
      totalRows: srcRows.length,
      sampledRows: sampled.length,
      matchedRows: matched,
      mismatchedRows: mismatched,
      missingInTarget,
      extraInTarget,
      passed: mismatched === 0 && missingInTarget === 0 && extraInTarget === 0,
      mismatches,
    };
    tableResults.push(result);

    checks.push({
      name: `row-checksum:${table}`,
      passed: result.passed,
      expected: sampled.length,
      actual: matched,
      details: !result.passed
        ? `${mismatched} mismatches, ${missingInTarget} missing, ${extraInTarget} extra in ${table}`
        : `All ${matched} sampled rows match in ${table}`,
    });
  }

  // Aggregate check
  const allPassed = tableResults.every((r) => r.passed);
  checks.push({
    name: "row-integrity-overall",
    passed: allPassed,
    expected: tableResults.length,
    actual: tableResults.filter((r) => r.passed).length,
    details: allPassed
      ? `All ${tableResults.length} tables passed row-level verification`
      : `${tableResults.filter((r) => !r.passed).length} tables failed row-level verification`,
  });

  const durationMs = Date.now() - startMs;

  diag.integrityChecks++;
  if (allPassed) diag.integrityPassed++;
  else diag.integrityFailed++;

  return {
    jobId,
    resourceId: databaseId,
    resourceType: "database",
    level: "row-level" as IntegrityLevel,
    passed: allPassed,
    checks,
    checkedAt: new Date().toISOString(),
    durationMs,
  };
}

/**
 * Group row checksums by table name.
 */
function groupRowsByTable(rows: RowChecksum[]): Map<string, RowChecksum[]> {
  const map = new Map<string, RowChecksum[]>();
  for (const row of rows) {
    const existing = map.get(row.table);
    if (existing) {
      existing.push(row);
    } else {
      map.set(row.table, [row]);
    }
  }
  return map;
}

// =============================================================================
// Aggregate Verification
// =============================================================================

/**
 * Run all applicable integrity checks for a job.
 */
export function createIntegrityReport(params: {
  jobId: string;
  resourceId: string;
  resourceType: MigrationResourceType;
  level: IntegrityLevel;
  checks: IntegrityCheck[];
}): IntegrityReport {
  const { jobId, resourceId, resourceType, level, checks } = params;
  const diag = getPluginState().diagnostics;

  const passed = checks.every((c) => c.passed);
  diag.integrityChecks++;
  if (passed) diag.integrityPassed++;
  else diag.integrityFailed++;

  return {
    jobId,
    resourceId,
    resourceType,
    level,
    passed,
    checks,
    checkedAt: new Date().toISOString(),
    durationMs: 0,
  };
}
