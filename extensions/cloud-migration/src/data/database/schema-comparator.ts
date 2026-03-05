/**
 * Data Pipeline — Schema Comparator
 *
 * Compares database schemas between source and target, identifying
 * type mappings, missing extensions, and required adjustments.
 */

import type { DatabaseSchema, DatabaseColumn, SchemaChange } from "../types.js";

// =============================================================================
// Comparator-Specific Types
// =============================================================================

/**
 * Detailed schema comparison result (distinct from the integrity-level
 * `SchemaComparison` in types.ts which is used by the integrity verifier).
 */
export interface SchemaComparisonResult {
  sourceDatabase: string;
  targetDatabase: string;
  addedTables: string[];
  removedTables: string[];
  modifiedTables: Array<{
    name: string;
    addedColumns: string[];
    removedColumns: string[];
    typeChanges: Array<{ column: string; sourceType: string; targetType: string }>;
  }>;
  sourceRowCount: number;
  targetRowCount: number;
  compatible: boolean;
}

// =============================================================================
// Type Mapping Tables
// =============================================================================

/** PostgreSQL → MySQL type mappings */
const PG_TO_MYSQL: Record<string, string> = {
  serial: "INT AUTO_INCREMENT",
  bigserial: "BIGINT AUTO_INCREMENT",
  smallserial: "SMALLINT AUTO_INCREMENT",
  boolean: "TINYINT(1)",
  bytea: "LONGBLOB",
  "character varying": "VARCHAR",
  text: "LONGTEXT",
  uuid: "CHAR(36)",
  json: "JSON",
  jsonb: "JSON",
  inet: "VARCHAR(45)",
  cidr: "VARCHAR(45)",
  macaddr: "VARCHAR(17)",
  timestamp: "DATETIME",
  "timestamp with time zone": "DATETIME",
  interval: "VARCHAR(255)",
  "double precision": "DOUBLE",
  real: "FLOAT",
  numeric: "DECIMAL",
  "integer[]": "JSON",
  "text[]": "JSON",
  tsvector: "TEXT", // no FTS equivalent
  tsquery: "TEXT",
  point: "POINT",
  polygon: "POLYGON",
  hstore: "JSON",
};

/** MySQL → PostgreSQL type mappings */
const MYSQL_TO_PG: Record<string, string> = {
  tinyint: "smallint",
  "tinyint(1)": "boolean",
  mediumint: "integer",
  "int auto_increment": "serial",
  "bigint auto_increment": "bigserial",
  datetime: "timestamp",
  longtext: "text",
  mediumtext: "text",
  tinytext: "text",
  longblob: "bytea",
  mediumblob: "bytea",
  tinyblob: "bytea",
  blob: "bytea",
  "double": "double precision",
  float: "real",
  decimal: "numeric",
  enum: "text", // with CHECK constraint
  set: "text[]",
};

// =============================================================================
// Schema Comparison
// =============================================================================

/**
 * Compare two database schemas and produce a diff + change plan.
 */
export function compareSchemas(
  source: DatabaseSchema,
  target: DatabaseSchema,
): SchemaComparisonResult {
  const sourceTableNames = new Set(source.tables.map((t) => t.name));
  const targetTableNames = new Set(target.tables.map((t) => t.name));

  const addedTables = source.tables.filter((t) => !targetTableNames.has(t.name)).map((t) => t.name);
  const removedTables = target.tables.filter((t) => !sourceTableNames.has(t.name)).map((t) => t.name);

  const modifiedTables: SchemaComparisonResult["modifiedTables"] = [];
  const totalSourceRows = source.tables.reduce((sum, t) => sum + t.rowCount, 0);
  const totalTargetRows = target.tables.reduce((sum, t) => sum + t.rowCount, 0);

  for (const srcTable of source.tables) {
    const tgtTable = target.tables.find((t) => t.name === srcTable.name);
    if (!tgtTable) continue;

    const srcColNames = new Set(srcTable.columns.map((c) => c.name));
    const tgtColNames = new Set(tgtTable.columns.map((c) => c.name));

    const addedCols = srcTable.columns.filter((c) => !tgtColNames.has(c.name)).map((c) => c.name);
    const removedCols = tgtTable.columns.filter((c) => !srcColNames.has(c.name)).map((c) => c.name);

    const typeChanges: Array<{ column: string; sourceType: string; targetType: string }> = [];
    for (const srcCol of srcTable.columns) {
      const tgtCol = tgtTable.columns.find((c) => c.name === srcCol.name);
      if (tgtCol && srcCol.type !== tgtCol.type) {
        typeChanges.push({
          column: srcCol.name,
          sourceType: srcCol.type,
          targetType: tgtCol.type,
        });
      }
    }

    if (addedCols.length > 0 || removedCols.length > 0 || typeChanges.length > 0) {
      modifiedTables.push({
        name: srcTable.name,
        addedColumns: addedCols,
        removedColumns: removedCols,
        typeChanges,
      });
    }
  }

  return {
    sourceDatabase: source.database,
    targetDatabase: target.database,
    addedTables,
    removedTables,
    modifiedTables,
    sourceRowCount: totalSourceRows,
    targetRowCount: totalTargetRows,
    compatible: removedTables.length === 0 && modifiedTables.every(
      (t) => t.removedColumns.length === 0,
    ),
  };
}

/**
 * Generate required schema changes for a cross-engine migration.
 */
export function generateSchemaChanges(
  source: DatabaseSchema,
  sourceEngine: "postgresql" | "mysql" | "mariadb",
  targetEngine: "postgresql" | "mysql" | "mariadb",
): SchemaChange[] {
  if (sourceEngine === targetEngine) return [];

  const changes: SchemaChange[] = [];
  const typeMap = getTypeMap(sourceEngine, targetEngine);

  for (const table of source.tables) {
    for (const col of table.columns) {
      const normalizedType = col.type.toLowerCase();
      const mapped = findTypeMapping(normalizedType, typeMap);
      if (mapped && mapped !== normalizedType) {
        changes.push({
          type: "type-mapping",
          table: table.name,
          column: col.name,
          sourceType: col.type,
          targetType: mapped,
          reason: `${sourceEngine} type "${col.type}" maps to "${mapped}" in ${targetEngine}`,
          automatic: true,
        });
      }
    }
  }

  // Extension checks (PostgreSQL-specific)
  if (sourceEngine === "postgresql" && targetEngine !== "postgresql") {
    for (const ext of source.extensions) {
      changes.push({
        type: "extension-replace",
        table: "*",
        sourceType: ext,
        targetType: "n/a",
        reason: `PostgreSQL extension "${ext}" has no equivalent in ${targetEngine}`,
        automatic: false,
      });
    }
  }

  return changes;
}

// =============================================================================
// Helpers
// =============================================================================

function getTypeMap(source: string, target: string): Record<string, string> {
  if (source === "postgresql" && (target === "mysql" || target === "mariadb")) {
    return PG_TO_MYSQL;
  }
  if ((source === "mysql" || source === "mariadb") && target === "postgresql") {
    return MYSQL_TO_PG;
  }
  return {};
}

function findTypeMapping(type: string, typeMap: Record<string, string>): string | undefined {
  // Exact match
  if (typeMap[type]) return typeMap[type];

  // Try without precision/length specifier
  const base = type.replace(/\(.*\)/, "").trim();
  if (typeMap[base]) return typeMap[base];

  return undefined;
}
