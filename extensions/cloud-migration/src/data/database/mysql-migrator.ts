/**
 * Data Pipeline — MySQL Migrator
 *
 * Handles MySQL/MariaDB-specific migration logic: schema extraction,
 * mysqldump command generation, and replication setup.
 */

import type { DatabaseSchema, DatabaseConnection, DatabaseMigrationResult } from "../types.js";

// =============================================================================
// Schema Extraction
// =============================================================================

/**
 * Extract schema information from a MySQL/MariaDB database.
 */
export async function extractMySQLSchema(
  _connection: Omit<DatabaseConnection, "password">,
): Promise<DatabaseSchema> {
  // Real impl would execute:
  // SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY
  // FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ?
  return {
    database: _connection.database,
    tables: [],
    views: [],
    functions: [],
    sequences: [], // MySQL uses AUTO_INCREMENT instead
    extensions: [], // MySQL has no extension system
  };
}

// =============================================================================
// Dump/Restore Commands
// =============================================================================

export interface MySQLDumpOptions {
  connection: Omit<DatabaseConnection, "password">;
  tables?: string[];
  excludeTables?: string[];
  schemaOnly?: boolean;
  dataOnly?: boolean;
  singleTransaction?: boolean;
  routines?: boolean;
  triggers?: boolean;
  events?: boolean;
  outputPath: string;
}

/**
 * Build a mysqldump command string.
 */
export function buildMySQLDumpCommand(opts: MySQLDumpOptions): string {
  const args: string[] = [
    "mysqldump",
    `--host=${opts.connection.host}`,
    `--port=${opts.connection.port}`,
    `--user=${opts.connection.username}`,
    opts.connection.database,
  ];

  if (opts.schemaOnly) args.push("--no-data");
  if (opts.dataOnly) args.push("--no-create-info");
  if (opts.singleTransaction !== false) args.push("--single-transaction");
  if (opts.routines !== false) args.push("--routines");
  if (opts.triggers !== false) args.push("--triggers");
  if (opts.events) args.push("--events");

  for (const table of opts.excludeTables ?? []) {
    args.push(`--ignore-table=${opts.connection.database}.${table}`);
  }

  if (opts.tables?.length) {
    args.push(...opts.tables);
  }

  if (opts.connection.ssl) args.push("--ssl-mode=REQUIRED");

  args.push(`--result-file=${opts.outputPath}`);

  return args.join(" ");
}

export interface MySQLImportOptions {
  connection: Omit<DatabaseConnection, "password">;
  inputPath: string;
  database?: string;
}

/**
 * Build a mysql import command string.
 */
export function buildMySQLImportCommand(opts: MySQLImportOptions): string {
  const db = opts.database ?? opts.connection.database;
  return [
    "mysql",
    `--host=${opts.connection.host}`,
    `--port=${opts.connection.port}`,
    `--user=${opts.connection.username}`,
    db,
    `< ${opts.inputPath}`,
  ].join(" ");
}

// =============================================================================
// Replication Setup
// =============================================================================

/**
 * Generate SQL for MySQL GTID-based replication.
 */
export function generateMySQLReplicationSetup(params: {
  sourceHost: string;
  sourcePort: number;
  replicationUser: string;
  channelName?: string;
}): { sourceSQL: string; targetSQL: string } {
  const channel = params.channelName ? ` FOR CHANNEL '${params.channelName}'` : "";

  const sourceSQL = [
    "-- Run on source database",
    `CREATE USER IF NOT EXISTS '${params.replicationUser}'@'%' IDENTIFIED BY '<password>';`,
    `GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO '${params.replicationUser}'@'%';`,
    "FLUSH PRIVILEGES;",
  ].join("\n");

  const targetSQL = [
    "-- Run on target database",
    `CHANGE REPLICATION SOURCE TO`,
    `  SOURCE_HOST='${params.sourceHost}',`,
    `  SOURCE_PORT=${params.sourcePort},`,
    `  SOURCE_USER='${params.replicationUser}',`,
    `  SOURCE_PASSWORD='<password>',`,
    `  SOURCE_AUTO_POSITION=1${channel};`,
    `START REPLICA${channel};`,
  ].join("\n");

  return { sourceSQL, targetSQL };
}

/**
 * Generate SQL to tear down MySQL replication.
 */
export function generateMySQLReplicationTeardown(params: {
  replicationUser: string;
  channelName?: string;
}): { sourceSQL: string; targetSQL: string } {
  const channel = params.channelName ? ` FOR CHANNEL '${params.channelName}'` : "";

  return {
    sourceSQL: `DROP USER IF EXISTS '${params.replicationUser}'@'%';`,
    targetSQL: [
      `STOP REPLICA${channel};`,
      `RESET REPLICA ALL${channel};`,
    ].join("\n"),
  };
}

// =============================================================================
// Migration Execution (Simulated)
// =============================================================================

/**
 * Execute a MySQL migration (simulated for design purposes).
 */
export async function migrateMySQL(params: {
  source: Omit<DatabaseConnection, "password">;
  target: Omit<DatabaseConnection, "password">;
  tables: string[];
  strategy: "full-dump" | "streaming" | "cdc";
  log: (msg: string) => void;
}): Promise<DatabaseMigrationResult> {
  const { log } = params;
  const startTime = Date.now();

  log(`Starting MySQL migration (${params.strategy})`);
  log(`  Source: ${params.source.host}:${params.source.port}/${params.source.database}`);
  log(`  Target: ${params.target.host}:${params.target.port}/${params.target.database}`);
  log(`  Tables: ${params.tables.length || "all"}`);

  // In real impl:
  // full-dump: mysqldump → transfer → mysql import
  // streaming: mydumper → myloader (parallel)
  // cdc: GTID replication setup → initial sync → ongoing → cutover

  return {
    tablesTransferred: params.tables.length,
    rowsTransferred: 0,
    bytesTransferred: 0,
    durationMs: Date.now() - startTime,
    schemaChangesApplied: 0,
    errors: [],
    verificationPassed: true,
  };
}
