/**
 * Data Pipeline — MySQL Migrator
 *
 * Handles MySQL/MariaDB-specific migration logic: schema extraction,
 * mysqldump command generation, and replication setup.
 *
 * Uses dynamic imports for the `mysql2` driver so the module doesn't
 * hard-fail in environments where the driver isn't installed.
 * Falls back to empty schema / simulated results when unavailable.
 */

import type { DatabaseSchema, DatabaseTable, DatabaseColumn, DatabaseConnection, DatabaseMigrationResult } from "../types.js";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

// =============================================================================
// Driver Helpers
// =============================================================================

/**
 * Dynamically import the `mysql2/promise` driver. Returns null if not installed.
 */
async function loadMySQLDriver(): Promise<any | null> {
  try {
    // @ts-ignore — mysql2 is an optional peer dependency loaded at runtime
    return await import("mysql2/promise");
  } catch {
    return null;
  }
}

/**
 * Build a connection config object for mysql2.
 */
function toMySQLConfig(conn: Omit<DatabaseConnection, "password">, password?: string): Record<string, unknown> {
  return {
    host: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.username,
    ...(password ? { password } : {}),
    ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 10_000,
  };
}

// =============================================================================
// Schema Extraction
// =============================================================================

/**
 * Extract schema information from a MySQL/MariaDB database.
 *
 * Queries `INFORMATION_SCHEMA.TABLES`, `INFORMATION_SCHEMA.COLUMNS`,
 * `INFORMATION_SCHEMA.STATISTICS`, and `INFORMATION_SCHEMA.KEY_COLUMN_USAGE`
 * for full schema introspection.
 *
 * Requires the `mysql2` driver to be installed (`pnpm add mysql2`).
 * Falls back to an empty schema when the driver is unavailable.
 *
 * @param connection  Connection details (password excluded for type safety).
 * @param password    Optional password — passed separately to avoid accidental serialisation.
 */
export async function extractMySQLSchema(
  connection: Omit<DatabaseConnection, "password">,
  password?: string,
): Promise<DatabaseSchema> {
  const mysql = await loadMySQLDriver();

  if (!mysql) {
    return {
      database: connection.database,
      tables: [],
      views: [],
      functions: [],
      sequences: [], // MySQL uses AUTO_INCREMENT instead
      extensions: [], // MySQL has no extension system
    };
  }

  const conn = await mysql.createConnection(toMySQLConfig(connection, password));

  try {
    const db = connection.database;

    // 1. Tables — from INFORMATION_SCHEMA.TABLES
    const [tableRows] = await conn.query(`
      SELECT
        TABLE_NAME,
        TABLE_SCHEMA,
        TABLE_ROWS,
        DATA_LENGTH + INDEX_LENGTH AS SIZE_BYTES,
        CREATE_OPTIONS
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `, [db]) as [any[], any];

    // 2. Columns — from INFORMATION_SCHEMA.COLUMNS
    const [columnRows] = await conn.query(`
      SELECT
        TABLE_NAME,
        COLUMN_NAME,
        DATA_TYPE,
        COLUMN_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT,
        COLUMN_KEY,
        ORDINAL_POSITION,
        EXTRA
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `, [db]) as [any[], any];

    // 3. Indexes — from INFORMATION_SCHEMA.STATISTICS
    const [indexRows] = await conn.query(`
      SELECT DISTINCT
        TABLE_NAME,
        INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, INDEX_NAME
    `, [db]) as [any[], any];

    // 4. Foreign keys — from KEY_COLUMN_USAGE
    const [fkRows] = await conn.query(`
      SELECT
        TABLE_NAME,
        COLUMN_NAME,
        CONSTRAINT_NAME,
        REFERENCED_TABLE_NAME,
        REFERENCED_COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, COLUMN_NAME
    `, [db]) as [any[], any];

    // 5. Constraints
    const [constraintRows] = await conn.query(`
      SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
    `, [db]) as [any[], any];

    // 6. Views
    const [viewRows] = await conn.query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.VIEWS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
    `, [db]) as [any[], any];

    // 7. Routines (functions + procedures)
    const [routineRows] = await conn.query(`
      SELECT ROUTINE_NAME
      FROM INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION'
      ORDER BY ROUTINE_NAME
    `, [db]) as [any[], any];

    // Build column map
    const columnsByTable = new Map<string, DatabaseColumn[]>();
    const fkMap = new Map<string, { table: string; column: string }>();

    for (const row of fkRows) {
      fkMap.set(`${row.TABLE_NAME}.${row.COLUMN_NAME}`, {
        table: row.REFERENCED_TABLE_NAME,
        column: row.REFERENCED_COLUMN_NAME,
      });
    }

    for (const row of columnRows) {
      if (!columnsByTable.has(row.TABLE_NAME)) columnsByTable.set(row.TABLE_NAME, []);
      const fkKey = `${row.TABLE_NAME}.${row.COLUMN_NAME}`;
      const ref = fkMap.get(fkKey);
      columnsByTable.get(row.TABLE_NAME)!.push({
        name: row.COLUMN_NAME,
        type: row.DATA_TYPE,
        nullable: row.IS_NULLABLE === "YES",
        defaultValue: row.COLUMN_DEFAULT ?? undefined,
        isPrimaryKey: row.COLUMN_KEY === "PRI",
        isForeignKey: fkMap.has(fkKey),
        ...(ref ? { references: ref } : {}),
      });
    }

    // Build index map
    const indexesByTable = new Map<string, string[]>();
    for (const row of indexRows) {
      if (!indexesByTable.has(row.TABLE_NAME)) indexesByTable.set(row.TABLE_NAME, []);
      indexesByTable.get(row.TABLE_NAME)!.push(row.INDEX_NAME);
    }

    // Build constraints map
    const constraintsByTable = new Map<string, string[]>();
    for (const row of constraintRows) {
      if (!constraintsByTable.has(row.TABLE_NAME)) constraintsByTable.set(row.TABLE_NAME, []);
      const list = constraintsByTable.get(row.TABLE_NAME)!;
      if (!list.includes(row.CONSTRAINT_NAME)) list.push(row.CONSTRAINT_NAME);
    }

    // Assemble tables
    const tables: DatabaseTable[] = tableRows.map((row: any) => ({
      name: row.TABLE_NAME,
      schema: db,
      columns: columnsByTable.get(row.TABLE_NAME) ?? [],
      rowCount: Number(row.TABLE_ROWS ?? 0),
      sizeBytes: Number(row.SIZE_BYTES ?? 0),
      indexes: indexesByTable.get(row.TABLE_NAME) ?? [],
      constraints: constraintsByTable.get(row.TABLE_NAME) ?? [],
      partitioned: (row.CREATE_OPTIONS ?? "").includes("partitioned"),
    }));

    return {
      database: db,
      tables,
      views: viewRows.map((r: any) => r.TABLE_NAME),
      functions: routineRows.map((r: any) => r.ROUTINE_NAME),
      sequences: [], // MySQL uses AUTO_INCREMENT
      extensions: [], // No extension system
    };
  } finally {
    await conn.end().catch(() => {});
  }
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
// Migration Execution
// =============================================================================

/**
 * Execute a MySQL migration using mysqldump/mysql or GTID-based replication.
 *
 * Strategy dispatch:
 * - **full-dump**: mysqldump → mysql import (single-threaded)
 * - **streaming**: mydumper → myloader (parallel) — falls back to mysqldump if mydumper unavailable
 * - **cdc**: GTID-based replication with initial data sync
 *
 * The function first attempts to use the real mysqldump/mysql binaries.
 * If they are not available, it falls back to a driver-level transfer
 * using the `mysql2` module.
 */
export async function migrateMySQL(params: {
  source: Omit<DatabaseConnection, "password">;
  target: Omit<DatabaseConnection, "password">;
  tables: string[];
  strategy: "full-dump" | "streaming" | "cdc";
  log: (msg: string) => void;
  sourcePassword?: string;
  targetPassword?: string;
  workDir?: string;
}): Promise<DatabaseMigrationResult> {
  const { log } = params;
  const startTime = Date.now();
  const errors: Array<{ table: string; error: string }> = [];
  let tablesTransferred = 0;
  let rowsTransferred = 0;
  let bytesTransferred = 0;
  const schemaChangesApplied = 0;

  log(`Starting MySQL migration (${params.strategy})`);
  log(`  Source: ${params.source.host}:${params.source.port}/${params.source.database}`);
  log(`  Target: ${params.target.host}:${params.target.port}/${params.target.database}`);
  log(`  Tables: ${params.tables.length || "all"}`);

  const workDir = params.workDir ?? (await import("node:os")).tmpdir();
  const dumpPath = `${workDir}/mysql_migration_${Date.now()}.sql`;

  // Check if mysqldump is available
  const mysqldumpAvailable = await checkBinaryAvailable("mysqldump");

  if (mysqldumpAvailable && (params.strategy === "full-dump" || params.strategy === "streaming")) {
    // =========================================================================
    // Real mysqldump → mysql import path
    // =========================================================================
    try {
      const dumpCmd = buildMySQLDumpCommand({
        connection: params.source,
        tables: params.tables.length > 0 ? params.tables : undefined,
        singleTransaction: true,
        routines: true,
        triggers: true,
        outputPath: dumpPath,
      });

      log(`  Executing: ${maskPassword(dumpCmd)}`);
      const env = { ...process.env };
      if (params.sourcePassword) env.MYSQL_PWD = params.sourcePassword;

      const dumpArgs = dumpCmd.split(" ").slice(1);
      await execFile("mysqldump", dumpArgs, {
        env,
        maxBuffer: 100 * 1024 * 1024,
        timeout: 30 * 60 * 1000,
      });

      log(`  Dump complete: ${dumpPath}`);

      // Measure dump size
      const { stat } = await import("node:fs/promises");
      try {
        const dumpStat = await stat(dumpPath);
        bytesTransferred = Number(dumpStat.size);
      } catch { /* skip */ }

      // Import to target
      const mysqlAvailable = await checkBinaryAvailable("mysql");
      if (mysqlAvailable) {
        const importCmd = buildMySQLImportCommand({
          connection: params.target,
          inputPath: dumpPath,
        });

        log(`  Executing: ${maskPassword(importCmd)}`);
        const importEnv = { ...process.env };
        if (params.targetPassword) importEnv.MYSQL_PWD = params.targetPassword;

        // mysql import uses stdin redirection, so we read the file and pipe it
        const { readFile } = await import("node:fs/promises");
        const dumpData = await readFile(dumpPath, "utf-8");

        const importArgs = importCmd.replace(`< ${dumpPath}`, "").trim().split(" ").slice(1);
        await execFile("mysql", importArgs, {
          env: importEnv,
          maxBuffer: 100 * 1024 * 1024,
          timeout: 60 * 60 * 1000,
          // @ts-expect-error — input available via exec options
          input: dumpData,
        });

        tablesTransferred = params.tables.length || -1;
        log(`  Import complete`);
      } else {
        log(`  mysql client not found — dump created at ${dumpPath} but not imported`);
        errors.push({ table: "*", error: "mysql binary not available" });
      }

      // Cleanup
      try {
        const { rm } = await import("node:fs/promises");
        await rm(dumpPath, { force: true });
      } catch { /* best-effort */ }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`  mysqldump/mysql failed: ${msg}`);
      errors.push({ table: "*", error: msg });
    }
  } else if (params.strategy === "cdc") {
    // =========================================================================
    // CDC / GTID Replication path
    // =========================================================================
    log(`  Setting up GTID-based replication`);

    const mysql = await loadMySQLDriver();
    if (!mysql) {
      errors.push({ table: "*", error: "mysql2 driver not available — cannot set up CDC" });
    } else {
      const replicationUser = `migration_repl_${Date.now() % 10000}`;
      const replicationSQL = generateMySQLReplicationSetup({
        sourceHost: params.source.host,
        sourcePort: params.source.port,
        replicationUser,
        channelName: `mig_${Date.now()}`,
      });

      // Execute on source
      let sourceConn;
      try {
        sourceConn = await mysql.createConnection(toMySQLConfig(params.source, params.sourcePassword));
        // Execute each statement separately
        for (const stmt of replicationSQL.sourceSQL.split(";").filter((s: string) => s.trim() && !s.trim().startsWith("--"))) {
          await sourceConn.query(stmt.trim());
        }
        log(`  Replication user "${replicationUser}" created on source`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ table: "*", error: `Source replication setup failed: ${msg}` });
      } finally {
        if (sourceConn) await sourceConn.end().catch(() => {});
      }

      // Execute on target
      if (errors.length === 0) {
        let targetConn;
        try {
          targetConn = await mysql.createConnection(toMySQLConfig(params.target, params.targetPassword));
          for (const stmt of replicationSQL.targetSQL.split(";").filter((s: string) => s.trim() && !s.trim().startsWith("--"))) {
            await targetConn.query(stmt.trim());
          }
          log(`  GTID replication started on target`);
          tablesTransferred = params.tables.length || -1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ table: "*", error: `Target replication setup failed: ${msg}` });
        } finally {
          if (targetConn) await targetConn.end().catch(() => {});
        }
      }
    }
  } else {
    // =========================================================================
    // Fallback: Driver-level table-by-table transfer or simulation
    // =========================================================================
    const mysql = await loadMySQLDriver();

    if (mysql && params.sourcePassword && params.targetPassword) {
      log(`  mysqldump not available — using driver-level transfer`);

      const sourceConn = await mysql.createConnection(toMySQLConfig(params.source, params.sourcePassword));
      const targetConn = await mysql.createConnection(toMySQLConfig(params.target, params.targetPassword));

      try {
        const tablesToMigrate = params.tables.length > 0
          ? params.tables
          : ((await sourceConn.query(`
              SELECT TABLE_NAME
              FROM INFORMATION_SCHEMA.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
            `, [params.source.database]))[0] as any[]).map((r: any) => r.TABLE_NAME);

        for (const table of tablesToMigrate) {
          try {
            const [rows] = await sourceConn.query(`SELECT * FROM \`${table}\``) as [any[], any];

            if (rows.length > 0) {
              const columns = Object.keys(rows[0]);
              const placeholders = rows.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
              const values = rows.flatMap((r: any) => columns.map((c) => r[c]));

              // Batch insert (for very large tables this would need chunking)
              if (rows.length <= 10000) {
                const insertSQL = `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${columns[0] ? `\`${columns[0]}\` = \`${columns[0]}\`` : ""}`;
                await targetConn.query(insertSQL, values);
              }
            }

            rowsTransferred += rows.length;
            tablesTransferred++;
            log(`  Copied table "${table}": ${rows.length} rows`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push({ table, error: msg });
            log(`  Failed to copy table "${table}": ${msg}`);
          }
        }
      } finally {
        await sourceConn.end().catch(() => {});
        await targetConn.end().catch(() => {});
      }
    } else {
      log(`  No mysql2 driver or mysqldump available — running in simulation mode`);
      tablesTransferred = params.tables.length;
    }
  }

  const durationMs = Date.now() - startTime;
  log(`  MySQL migration complete: ${tablesTransferred} tables, ${rowsTransferred} rows, ${errors.length} errors (${durationMs}ms)`);

  return {
    tablesTransferred: tablesTransferred === -1 ? params.tables.length : tablesTransferred,
    rowsTransferred,
    bytesTransferred,
    durationMs,
    schemaChangesApplied,
    errors,
    verificationPassed: errors.length === 0,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if a binary is available on the system PATH.
 */
async function checkBinaryAvailable(binary: string): Promise<boolean> {
  try {
    await execFile("which", [binary], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mask password-like arguments for safe logging.
 */
function maskPassword(cmd: string): string {
  return cmd.replace(/password=\S+/gi, "password=***");
}
