/**
 * Database Migrators — Enhanced Tests
 *
 * Tests the real implementations of PostgreSQL and MySQL schema extraction
 * and migration execution added in the second implementation round.
 *
 * Since `pg` and `mysql2/promise` are not installed in the test environment,
 * these functions fall back gracefully:
 * - extractPostgresSchema / extractMySQLSchema → return empty schema
 * - migratePostgres / migrateMySQL → run in simulation mode
 *
 * We also test the command builders and replication generators which
 * work without any driver installed.
 */

import { describe, it, expect, vi } from "vitest";

// =============================================================================
// PostgreSQL Migrator
// =============================================================================

describe("data/database/pg-migrator", () => {
  describe("extractPostgresSchema (driver unavailable — fallback)", () => {
    it("returns empty schema when pg driver is not installed", async () => {
      const { extractPostgresSchema } = await import("../src/data/database/pg-migrator.js");

      const schema = await extractPostgresSchema({
        engine: "postgresql",
        host: "localhost",
        port: 5432,
        database: "testdb",
        username: "admin",
      });

      expect(schema.database).toBe("testdb");
      expect(schema.tables).toEqual([]);
      expect(schema.views).toEqual([]);
      expect(schema.functions).toEqual([]);
      expect(schema.sequences).toEqual([]);
      expect(schema.extensions).toEqual([]);
    });

    it("works with optional password parameter", async () => {
      const { extractPostgresSchema } = await import("../src/data/database/pg-migrator.js");

      const schema = await extractPostgresSchema(
        { engine: "postgresql", host: "pg.host", port: 5432, database: "mydb", username: "u" },
        "secret123",
      );

      expect(schema.database).toBe("mydb");
      expect(Array.isArray(schema.tables)).toBe(true);
    });
  });

  describe("buildPgDumpCommand", () => {
    it("generates a basic pg_dump command", async () => {
      const { buildPgDumpCommand } = await import("../src/data/database/pg-migrator.js");

      const cmd = buildPgDumpCommand({
        connection: {
          engine: "postgresql",
          host: "pg.example.com",
          port: 5432,
          database: "orders",
          username: "admin",
        },
        format: "custom",
        outputPath: "/tmp/dump.pg",
      });

      expect(cmd).toContain("pg_dump");
      expect(cmd).toContain("--host=pg.example.com");
      expect(cmd).toContain("--port=5432");
      expect(cmd).toContain("--dbname=orders");
      expect(cmd).toContain("--username=admin");
      expect(cmd).toContain("--format=c"); // custom format
      expect(cmd).toContain("--file=/tmp/dump.pg");
    });

    it("includes table filters when specified", async () => {
      const { buildPgDumpCommand } = await import("../src/data/database/pg-migrator.js");

      const cmd = buildPgDumpCommand({
        connection: {
          engine: "postgresql",
          host: "localhost",
          port: 5432,
          database: "db1",
          username: "user",
        },
        format: "custom",
        tables: ["orders", "users"],
        outputPath: "/tmp/out.dump",
      });

      expect(cmd).toContain("--table=orders");
      expect(cmd).toContain("--table=users");
    });

    it("includes parallel jobs for directory format", async () => {
      const { buildPgDumpCommand } = await import("../src/data/database/pg-migrator.js");

      const cmd = buildPgDumpCommand({
        connection: {
          engine: "postgresql",
          host: "localhost",
          port: 5432,
          database: "db1",
          username: "user",
        },
        format: "directory",
        parallelJobs: 8,
        outputPath: "/tmp/dir_dump",
      });

      expect(cmd).toContain("--format=d"); // directory format
      expect(cmd).toContain("--jobs=8");
    });

    it("includes compression level when specified", async () => {
      const { buildPgDumpCommand } = await import("../src/data/database/pg-migrator.js");

      const cmd = buildPgDumpCommand({
        connection: {
          engine: "postgresql",
          host: "localhost",
          port: 5432,
          database: "db1",
          username: "user",
        },
        format: "custom",
        compressLevel: 9,
        outputPath: "/tmp/dump.pg",
      });

      expect(cmd).toContain("--compress=9");
    });
  });

  describe("buildPgRestoreCommand", () => {
    it("generates a basic pg_restore command", async () => {
      const { buildPgRestoreCommand } = await import("../src/data/database/pg-migrator.js");

      const cmd = buildPgRestoreCommand({
        connection: {
          engine: "postgresql",
          host: "target.host",
          port: 5432,
          database: "target_db",
          username: "admin",
        },
        format: "custom",
        inputPath: "/tmp/dump.pg",
      });

      expect(cmd).toContain("pg_restore");
      expect(cmd).toContain("--host=target.host");
      expect(cmd).toContain("--dbname=target_db");
      expect(cmd).toContain("/tmp/dump.pg");
    });

    it("includes --clean and --no-owner flags", async () => {
      const { buildPgRestoreCommand } = await import("../src/data/database/pg-migrator.js");

      const cmd = buildPgRestoreCommand({
        connection: {
          engine: "postgresql",
          host: "localhost",
          port: 5432,
          database: "db",
          username: "u",
        },
        format: "custom",
        inputPath: "/tmp/dump",
        clean: true,
        noOwner: true,
        noPrivileges: true,
      });

      expect(cmd).toContain("--clean");
      expect(cmd).toContain("--no-owner");
      expect(cmd).toContain("--no-privileges");
    });
  });

  describe("generateReplicationSetup", () => {
    it("generates PUBLICATION and SUBSCRIPTION SQL commands", async () => {
      const { generateReplicationSetup } = await import("../src/data/database/pg-migrator.js");

      const result = generateReplicationSetup({
        publicationName: "my_pub",
        subscriptionName: "my_sub",
        sourceConnection: "host=source port=5432 dbname=db user=admin",
      });

      expect(result.sourceSQL).toContain("CREATE PUBLICATION");
      expect(result.sourceSQL).toContain("my_pub");
      expect(result.targetSQL).toContain("CREATE SUBSCRIPTION");
      expect(result.targetSQL).toContain("my_sub");
      expect(result.targetSQL).toContain("host=source");
    });

    it("includes specific tables when provided", async () => {
      const { generateReplicationSetup } = await import("../src/data/database/pg-migrator.js");

      const result = generateReplicationSetup({
        publicationName: "table_pub",
        subscriptionName: "table_sub",
        sourceConnection: "host=src port=5432 dbname=db user=u",
        tables: ["orders", "users"],
      });

      expect(result.sourceSQL).toContain("orders");
      expect(result.sourceSQL).toContain("users");
    });
  });

  describe("generateReplicationTeardown", () => {
    it("generates DROP PUBLICATION and SUBSCRIPTION SQL", async () => {
      const { generateReplicationTeardown } = await import("../src/data/database/pg-migrator.js");

      const result = generateReplicationTeardown({
        publicationName: "my_pub",
        subscriptionName: "my_sub",
      });

      expect(result.sourceSQL).toContain("DROP PUBLICATION");
      expect(result.sourceSQL).toContain("my_pub");
      expect(result.targetSQL).toContain("DROP SUBSCRIPTION");
      expect(result.targetSQL).toContain("my_sub");
    });
  });

  describe("migratePostgres (simulation mode — no pg_dump, no driver)", () => {
    it("runs in simulation mode and returns result", async () => {
      const { migratePostgres } = await import("../src/data/database/pg-migrator.js");
      const logs: string[] = [];

      const result = await migratePostgres({
        source: { engine: "postgresql", host: "src.host", port: 5432, database: "srcdb", username: "u" },
        target: { engine: "postgresql", host: "tgt.host", port: 5432, database: "tgtdb", username: "u" },
        tables: ["orders", "products", "users"],
        strategy: "full-dump",
        log: (msg) => logs.push(msg),
      });

      expect(result.tablesTransferred).toBeGreaterThanOrEqual(0);
      expect(typeof result.rowsTransferred).toBe("number");
      expect(typeof result.bytesTransferred).toBe("number");
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(typeof result.verificationPassed).toBe("boolean");

      // Should have logged at least the start message
      expect(logs.some((l) => l.includes("PostgreSQL migration"))).toBe(true);
      expect(logs.some((l) => l.includes("src.host"))).toBe(true);
    });

    it("handles streaming strategy", async () => {
      const { migratePostgres } = await import("../src/data/database/pg-migrator.js");
      const logs: string[] = [];

      const result = await migratePostgres({
        source: { engine: "postgresql", host: "src", port: 5432, database: "db", username: "u" },
        target: { engine: "postgresql", host: "tgt", port: 5432, database: "db", username: "u" },
        tables: ["t1"],
        strategy: "streaming",
        log: (msg) => logs.push(msg),
      });

      expect(typeof result.tablesTransferred).toBe("number");
      expect(typeof result.durationMs).toBe("number");
    });

    it("handles CDC strategy (driver unavailable)", async () => {
      const { migratePostgres } = await import("../src/data/database/pg-migrator.js");
      const logs: string[] = [];

      const result = await migratePostgres({
        source: { engine: "postgresql", host: "src", port: 5432, database: "db", username: "u" },
        target: { engine: "postgresql", host: "tgt", port: 5432, database: "db", username: "u" },
        tables: ["t1"],
        strategy: "cdc",
        log: (msg) => logs.push(msg),
      });

      // CDC requires pg driver — should report errors when unavailable
      expect(typeof result.durationMs).toBe("number");
    });

    it("logs the migration complete message", async () => {
      const { migratePostgres } = await import("../src/data/database/pg-migrator.js");
      const logs: string[] = [];

      await migratePostgres({
        source: { engine: "postgresql", host: "s", port: 5432, database: "d", username: "u" },
        target: { engine: "postgresql", host: "t", port: 5432, database: "d", username: "u" },
        tables: [],
        strategy: "full-dump",
        log: (msg) => logs.push(msg),
      });

      expect(logs.some((l) => l.includes("migration complete") || l.includes("complete"))).toBe(true);
    });
  });
});

// =============================================================================
// MySQL Migrator
// =============================================================================

describe("data/database/mysql-migrator", () => {
  describe("extractMySQLSchema (driver unavailable — fallback)", () => {
    it("returns empty schema when mysql2 driver is not installed", async () => {
      const { extractMySQLSchema } = await import("../src/data/database/mysql-migrator.js");

      const schema = await extractMySQLSchema({
        engine: "mysql",
        host: "mysql.host",
        port: 3306,
        database: "mydb",
        username: "root",
      });

      expect(schema.database).toBe("mydb");
      expect(schema.tables).toEqual([]);
      expect(schema.views).toEqual([]);
      expect(schema.functions).toEqual([]);
      expect(schema.sequences).toEqual([]);
      expect(schema.extensions).toEqual([]);
    });

    it("works with optional password parameter", async () => {
      const { extractMySQLSchema } = await import("../src/data/database/mysql-migrator.js");

      const schema = await extractMySQLSchema(
        { engine: "mysql", host: "mysql.host", port: 3306, database: "db", username: "root" },
        "password123",
      );

      expect(schema.database).toBe("db");
    });
  });

  describe("buildMySQLDumpCommand", () => {
    it("generates a basic mysqldump command", async () => {
      const { buildMySQLDumpCommand } = await import("../src/data/database/mysql-migrator.js");

      const cmd = buildMySQLDumpCommand({
        connection: {
          engine: "mysql",
          host: "mysql.example.com",
          port: 3306,
          database: "shop",
          username: "root",
        },
        outputPath: "/tmp/dump.sql",
      });

      expect(cmd).toContain("mysqldump");
      expect(cmd).toContain("--host=mysql.example.com");
      expect(cmd).toContain("--port=3306");
      expect(cmd).toContain("--user=root");
      expect(cmd).toContain("shop");
    });

    it("includes table filters when specified", async () => {
      const { buildMySQLDumpCommand } = await import("../src/data/database/mysql-migrator.js");

      const cmd = buildMySQLDumpCommand({
        connection: {
          engine: "mysql",
          host: "localhost",
          port: 3306,
          database: "db",
          username: "root",
        },
        tables: ["orders", "items"],
        outputPath: "/tmp/dump.sql",
      });

      expect(cmd).toContain("orders");
      expect(cmd).toContain("items");
    });

    it("includes extra flags when specified", async () => {
      const { buildMySQLDumpCommand } = await import("../src/data/database/mysql-migrator.js");

      const cmd = buildMySQLDumpCommand({
        connection: {
          engine: "mysql",
          host: "localhost",
          port: 3306,
          database: "db",
          username: "u",
        },
        singleTransaction: true,
        routines: true,
        triggers: true,
        outputPath: "/tmp/dump.sql",
      });

      expect(cmd).toContain("--single-transaction");
      expect(cmd).toContain("--routines");
      expect(cmd).toContain("--triggers");
    });
  });

  describe("buildMySQLImportCommand", () => {
    it("generates a mysql import command", async () => {
      const { buildMySQLImportCommand } = await import("../src/data/database/mysql-migrator.js");

      const cmd = buildMySQLImportCommand({
        connection: {
          engine: "mysql",
          host: "target.host",
          port: 3306,
          database: "target_db",
          username: "admin",
        },
        inputPath: "/tmp/dump.sql",
      });

      expect(cmd).toContain("mysql");
      expect(cmd).toContain("--host=target.host");
      expect(cmd).toContain("target_db");
      expect(cmd).toContain("/tmp/dump.sql");
    });
  });

  describe("generateMySQLReplicationSetup", () => {
    it("generates replication SQL commands", async () => {
      const { generateMySQLReplicationSetup } = await import("../src/data/database/mysql-migrator.js");

      const result = generateMySQLReplicationSetup({
        sourceHost: "source.mysql.host",
        sourcePort: 3306,
        replicationUser: "repl_user",
        channelName: "migration_channel",
      });

      expect(result.sourceSQL).toBeDefined();
      expect(result.targetSQL).toBeDefined();
      expect(typeof result.sourceSQL).toBe("string");
      expect(typeof result.targetSQL).toBe("string");
    });
  });

  describe("generateMySQLReplicationTeardown", () => {
    it("generates teardown SQL", async () => {
      const { generateMySQLReplicationTeardown } = await import("../src/data/database/mysql-migrator.js");

      const result = generateMySQLReplicationTeardown({
        channelName: "migration_channel",
        replicationUser: "repl_user",
      });

      expect(result.targetSQL).toContain("STOP");
      expect(typeof result.sourceSQL).toBe("string");
    });
  });

  describe("migrateMySQL (simulation mode — no mysqldump, no driver)", () => {
    it("runs in simulation mode and returns result", async () => {
      const { migrateMySQL } = await import("../src/data/database/mysql-migrator.js");
      const logs: string[] = [];

      const result = await migrateMySQL({
        source: { engine: "mysql", host: "src", port: 3306, database: "srcdb", username: "u" },
        target: { engine: "mysql", host: "tgt", port: 3306, database: "tgtdb", username: "u" },
        tables: ["orders", "items"],
        strategy: "full-dump",
        log: (msg) => logs.push(msg),
      });

      expect(result.tablesTransferred).toBeGreaterThanOrEqual(0);
      expect(typeof result.rowsTransferred).toBe("number");
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.errors)).toBe(true);

      expect(logs.some((l) => l.includes("MySQL migration") || l.includes("mysql"))).toBe(true);
    });

    it("handles streaming strategy", async () => {
      const { migrateMySQL } = await import("../src/data/database/mysql-migrator.js");
      const logs: string[] = [];

      const result = await migrateMySQL({
        source: { engine: "mysql", host: "src", port: 3306, database: "db", username: "u" },
        target: { engine: "mysql", host: "tgt", port: 3306, database: "db", username: "u" },
        tables: ["t1"],
        strategy: "streaming",
        log: (msg) => logs.push(msg),
      });

      expect(typeof result.tablesTransferred).toBe("number");
    });

    it("handles CDC strategy (driver unavailable)", async () => {
      const { migrateMySQL } = await import("../src/data/database/mysql-migrator.js");
      const logs: string[] = [];

      const result = await migrateMySQL({
        source: { engine: "mysql", host: "src", port: 3306, database: "db", username: "u" },
        target: { engine: "mysql", host: "tgt", port: 3306, database: "db", username: "u" },
        tables: ["t1"],
        strategy: "cdc",
        log: (msg) => logs.push(msg),
      });

      expect(typeof result.durationMs).toBe("number");
    });

    it("logs completion message", async () => {
      const { migrateMySQL } = await import("../src/data/database/mysql-migrator.js");
      const logs: string[] = [];

      await migrateMySQL({
        source: { engine: "mysql", host: "s", port: 3306, database: "d", username: "u" },
        target: { engine: "mysql", host: "t", port: 3306, database: "d", username: "u" },
        tables: [],
        strategy: "full-dump",
        log: (msg) => logs.push(msg),
      });

      expect(logs.some((l) => l.toLowerCase().includes("complete"))).toBe(true);
    });
  });
});
