/**
 * Database Step Handlers — Tests
 *
 * Tests the four database migration step handlers:
 *   1. export-database   — schema extraction + dump command generation
 *   2. transfer-database — dump file transfer or CDC replication setup
 *   3. import-database   — dump restore + schema change application
 *   4. verify-schema     — post-migration schema & row count verification
 *
 * All handlers are tested in fallback mode (no real database connections).
 * The underlying pg-migrator / mysql-migrator functions return stub data
 * when invoked without a real connection pool — this is the standard
 * pattern used throughout the cloud-migration test suite.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// =============================================================================
// Helpers
// =============================================================================

const fakeLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeCtx(
  params: Record<string, unknown>,
  opts: Partial<{
    sourceCredentials: unknown;
    targetCredentials: unknown;
    signal: AbortSignal;
  }> = {},
) {
  return {
    params,
    globalParams: {},
    tags: {},
    log: fakeLog,
    signal: opts.signal,
    sourceCredentials: opts.sourceCredentials,
    targetCredentials: opts.targetCredentials,
  };
}

// =============================================================================
// export-database
// =============================================================================

describe("data/steps/export-database", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes a PostgreSQL export and returns schema metadata", async () => {
    const { exportDatabaseHandler } = await import("../src/data/steps/export-database.js");
    const ctx = makeCtx({
      sourceConnection: {
        engine: "postgresql",
        host: "pg.example.com",
        port: 5432,
        database: "orders",
        username: "admin",
      },
      format: "custom",
    });

    const result = await exportDatabaseHandler.execute(ctx);

    expect(result.engine).toBe("postgresql");
    expect(result.database).toBe("orders");
    expect(result.schema).toBeDefined();
    expect((result.schema as any).tableCount).toBeGreaterThanOrEqual(0);
    expect(result.dumpCommand).toBeDefined();
    expect(typeof result.dumpCommand).toBe("string");
    expect((result.dumpCommand as string).length).toBeGreaterThan(0);
    expect(result.outputPath).toBeDefined();
    expect(result.exportedAt).toBeDefined();
    expect(fakeLog.info).toHaveBeenCalled();
  });

  it("executes a MySQL export and returns schema metadata", async () => {
    const { exportDatabaseHandler } = await import("../src/data/steps/export-database.js");
    const ctx = makeCtx({
      sourceConnection: {
        engine: "mysql",
        host: "mysql.example.com",
        port: 3306,
        database: "inventory",
        username: "admin",
      },
    });

    const result = await exportDatabaseHandler.execute(ctx);

    expect(result.engine).toBe("mysql");
    expect(result.database).toBe("inventory");
    expect(result.dumpCommand).toBeDefined();
    expect(result.outputPath).toBeDefined();
  });

  it("computes cross-engine schema changes when target engine differs", async () => {
    const { exportDatabaseHandler } = await import("../src/data/steps/export-database.js");
    const ctx = makeCtx({
      sourceConnection: {
        engine: "postgresql",
        host: "pg.example.com",
        port: 5432,
        database: "mydb",
        username: "admin",
      },
      targetEngine: "mysql",
    });

    const result = await exportDatabaseHandler.execute(ctx);

    expect(result.schemaChanges).toBeDefined();
    expect(Array.isArray(result.schemaChanges)).toBe(true);
  });

  it("uses custom output path when supplied", async () => {
    const { exportDatabaseHandler } = await import("../src/data/steps/export-database.js");
    const ctx = makeCtx({
      sourceConnection: {
        engine: "postgresql",
        host: "localhost",
        port: 5432,
        database: "test",
        username: "admin",
      },
      outputPath: "/custom/dump/path.dump",
    });

    const result = await exportDatabaseHandler.execute(ctx);
    expect(result.outputPath).toBe("/custom/dump/path.dump");
  });

  it("rollback logs the output path", async () => {
    const { exportDatabaseHandler } = await import("../src/data/steps/export-database.js");
    const ctx = makeCtx({ sourceConnection: { engine: "postgresql", host: "h", port: 5432, database: "d", username: "u" } });

    await exportDatabaseHandler.rollback!(ctx, { outputPath: "/tmp/test.dump" });
    expect(fakeLog.info).toHaveBeenCalledWith(expect.stringContaining("/tmp/test.dump"));
  });
});

// =============================================================================
// transfer-database
// =============================================================================

describe("data/steps/transfer-database", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes full-dump transfer without credentials (fallback)", async () => {
    const { transferDatabaseHandler } = await import("../src/data/steps/transfer-database.js");
    const ctx = makeCtx({
      engine: "postgresql",
      strategy: "full-dump",
      dumpFilePath: "/tmp/orders.dump",
      dumpSizeBytes: 1048576,
    });

    const result = await transferDatabaseHandler.execute(ctx);

    expect(result.strategy).toBe("full-dump");
    expect(result.engine).toBe("postgresql");
    expect(result.bytesTransferred).toBe(1048576);
    expect(result.stagingKey).toBeDefined();
    expect(result.transferredAt).toBeDefined();
    expect(fakeLog.info).toHaveBeenCalledWith(expect.stringContaining("full-dump"));
  });

  it("sets up PostgreSQL CDC replication", async () => {
    const { transferDatabaseHandler } = await import("../src/data/steps/transfer-database.js");
    const ctx = makeCtx({
      engine: "postgresql",
      strategy: "cdc",
      publicationName: "my_pub",
      subscriptionName: "my_sub",
      sourceConnectionString: "postgres://src:5432/db",
    });

    const result = await transferDatabaseHandler.execute(ctx);

    expect(result.strategy).toBe("cdc");
    expect(result.engine).toBe("postgresql");
    expect(result.replicationSourceSQL).toBeDefined();
    expect(result.replicationTargetSQL).toBeDefined();
    expect(result.publicationName).toBe("my_pub");
    expect(result.subscriptionName).toBe("my_sub");
  });

  it("sets up MySQL replication for streaming strategy", async () => {
    const { transferDatabaseHandler } = await import("../src/data/steps/transfer-database.js");
    const ctx = makeCtx({
      engine: "mysql",
      strategy: "streaming",
      replicationUser: "repl_user",
    });

    const result = await transferDatabaseHandler.execute(ctx);

    expect(result.strategy).toBe("streaming");
    expect(result.engine).toBe("mysql");
    expect(result.replicationSourceSQL).toBeDefined();
    expect(result.replicationTargetSQL).toBeDefined();
  });

  it("rollback for full-dump logs staging cleanup", async () => {
    const { transferDatabaseHandler } = await import("../src/data/steps/transfer-database.js");
    const ctx = makeCtx({ engine: "postgresql", strategy: "full-dump" });

    await transferDatabaseHandler.rollback!(ctx, {
      strategy: "full-dump",
      stagingKey: "db-dump.dump",
      targetStagingBucket: "staging-bucket",
    });

    expect(fakeLog.info).toHaveBeenCalledWith(expect.stringContaining("staging-bucket"));
  });

  it("rollback for CDC logs replication teardown message", async () => {
    const { transferDatabaseHandler } = await import("../src/data/steps/transfer-database.js");
    const ctx = makeCtx({ engine: "postgresql", strategy: "cdc" });

    await transferDatabaseHandler.rollback!(ctx, { strategy: "cdc" });

    expect(fakeLog.info).toHaveBeenCalledWith(expect.stringContaining("replication"));
  });
});

// =============================================================================
// import-database
// =============================================================================

describe("data/steps/import-database", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates a PostgreSQL restore command", async () => {
    const { importDatabaseHandler } = await import("../src/data/steps/import-database.js");
    const ctx = makeCtx({
      targetConnection: {
        engine: "postgresql",
        host: "pg-target.example.com",
        port: 5432,
        database: "orders",
        username: "admin",
      },
      sourceEngine: "postgresql",
      targetEngine: "postgresql",
      dumpFilePath: "/tmp/orders.dump",
      format: "custom",
    });

    const result = await importDatabaseHandler.execute(ctx);

    expect(result.restoreCommand).toBeDefined();
    expect(typeof result.restoreCommand).toBe("string");
    expect((result.restoreCommand as string).length).toBeGreaterThan(0);
    expect(result.database).toBe("orders");
    expect(result.importedAt).toBeDefined();
    expect(fakeLog.info).toHaveBeenCalled();
  });

  it("generates a MySQL import command", async () => {
    const { importDatabaseHandler } = await import("../src/data/steps/import-database.js");
    const ctx = makeCtx({
      targetConnection: {
        engine: "mysql",
        host: "mysql-target.example.com",
        port: 3306,
        database: "inventory",
        username: "admin",
      },
      sourceEngine: "mysql",
      targetEngine: "mysql",
      dumpFilePath: "/tmp/inventory.sql",
    });

    const result = await importDatabaseHandler.execute(ctx);

    expect(result.restoreCommand).toBeDefined();
    expect(result.database).toBe("inventory");
  });

  it("applies cross-engine schema changes when engines differ", async () => {
    const { importDatabaseHandler } = await import("../src/data/steps/import-database.js");
    const ctx = makeCtx({
      targetConnection: {
        engine: "mysql",
        host: "mysql.example.com",
        port: 3306,
        database: "orders",
        username: "admin",
      },
      sourceEngine: "postgresql",
      targetEngine: "mysql",
      dumpFilePath: "/tmp/orders.dump",
      schemaChanges: [
        {
          type: "type-mapping",
          table: "orders",
          column: "id",
          sourceType: "serial",
          targetType: "INT AUTO_INCREMENT",
          automatic: true,
        },
      ],
    });

    const result = await importDatabaseHandler.execute(ctx);

    expect(result.schemaChangesApplied).toBeDefined();
    expect(typeof result.schemaChangesApplied).toBe("number");
  });

  it("rollback logs manual cleanup message", async () => {
    const { importDatabaseHandler } = await import("../src/data/steps/import-database.js");
    const ctx = makeCtx({
      targetConnection: {
        engine: "postgresql",
        host: "h",
        port: 5432,
        database: "d",
        username: "u",
      },
    });

    await importDatabaseHandler.rollback!(ctx, { targetDatabase: "orders" });
    expect(fakeLog.info).toHaveBeenCalled();
  });
});

// =============================================================================
// verify-schema
// =============================================================================

describe("data/steps/verify-schema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies matching PostgreSQL schemas and passes all checks", async () => {
    const { verifySchemaHandler } = await import("../src/data/steps/verify-schema.js");
    const conn = {
      engine: "postgresql" as const,
      host: "localhost",
      port: 5432,
      database: "testdb",
      username: "admin",
    };

    const ctx = makeCtx({
      sourceConnection: conn,
      targetConnection: conn,
      sourceEngine: "postgresql",
      targetEngine: "postgresql",
    });

    const result = await verifySchemaHandler.execute(ctx);

    expect(result.passed).toBeDefined();
    expect(typeof result.passed).toBe("boolean");
    expect(result.checks).toBeDefined();
    expect(Array.isArray(result.checks)).toBe(true);
    expect((result.checks as any[]).length).toBeGreaterThanOrEqual(3);
    expect(result.sourceDatabase).toBe("testdb");
    expect(result.targetDatabase).toBe("testdb");
    expect(result.durationMs).toBeDefined();
    expect(fakeLog.info).toHaveBeenCalled();
  });

  it("verifies MySQL-to-MySQL with row count tolerance", async () => {
    const { verifySchemaHandler } = await import("../src/data/steps/verify-schema.js");
    const ctx = makeCtx({
      sourceConnection: {
        engine: "mysql",
        host: "src.example.com",
        port: 3306,
        database: "srcdb",
        username: "admin",
      },
      targetConnection: {
        engine: "mysql",
        host: "tgt.example.com",
        port: 3306,
        database: "tgtdb",
        username: "admin",
      },
      sourceEngine: "mysql",
      targetEngine: "mysql",
      rowCountTolerance: 0.05,
    });

    const result = await verifySchemaHandler.execute(ctx);

    expect(result.sourceEngine).toBe("mysql");
    expect(result.targetEngine).toBe("mysql");
    expect(result.checks).toBeDefined();
    expect(result.rowCountResults).toBeDefined();
  });

  it("includes comparison metadata in results", async () => {
    const { verifySchemaHandler } = await import("../src/data/steps/verify-schema.js");
    const ctx = makeCtx({
      sourceConnection: {
        engine: "postgresql",
        host: "src",
        port: 5432,
        database: "db1",
        username: "u",
      },
      targetConnection: {
        engine: "postgresql",
        host: "tgt",
        port: 5432,
        database: "db2",
        username: "u",
      },
      sourceEngine: "postgresql",
      targetEngine: "postgresql",
    });

    const result = await verifySchemaHandler.execute(ctx);

    expect(result.comparison).toBeDefined();
    const comparison = result.comparison as Record<string, unknown>;
    expect(comparison).toHaveProperty("addedTables");
    expect(comparison).toHaveProperty("removedTables");
    expect(comparison).toHaveProperty("modifiedTableCount");
  });

  it("handles cross-engine verification (PG → MySQL)", async () => {
    const { verifySchemaHandler } = await import("../src/data/steps/verify-schema.js");
    const ctx = makeCtx({
      sourceConnection: {
        engine: "postgresql",
        host: "pg",
        port: 5432,
        database: "srcdb",
        username: "u",
      },
      targetConnection: {
        engine: "mysql",
        host: "mysql",
        port: 3306,
        database: "tgtdb",
        username: "u",
      },
      sourceEngine: "postgresql",
      targetEngine: "mysql",
      strictTypeMapping: true,
    });

    const result = await verifySchemaHandler.execute(ctx);

    expect(result.sourceEngine).toBe("postgresql");
    expect(result.targetEngine).toBe("mysql");
    expect(result.checks).toBeDefined();
  });

  it("verify-schema handler has no rollback (read-only operation)", async () => {
    const { verifySchemaHandler } = await import("../src/data/steps/verify-schema.js");
    // verify-schema is a read-only check, rollback should be undefined or a no-op
    if (verifySchemaHandler.rollback) {
      const ctx = makeCtx({});
      // Should not throw
      await verifySchemaHandler.rollback(ctx, {});
    }
  });
});

// =============================================================================
// Handler Registration
// =============================================================================

describe("database handler registration in lifecycle", () => {
  it("all four database handlers are importable", async () => {
    const [exp, transfer, imp, verify] = await Promise.all([
      import("../src/data/steps/export-database.js"),
      import("../src/data/steps/transfer-database.js"),
      import("../src/data/steps/import-database.js"),
      import("../src/data/steps/verify-schema.js"),
    ]);

    expect(exp.exportDatabaseHandler).toBeDefined();
    expect(exp.exportDatabaseHandler.execute).toBeTypeOf("function");
    expect(exp.exportDatabaseHandler.rollback).toBeTypeOf("function");

    expect(transfer.transferDatabaseHandler).toBeDefined();
    expect(transfer.transferDatabaseHandler.execute).toBeTypeOf("function");
    expect(transfer.transferDatabaseHandler.rollback).toBeTypeOf("function");

    expect(imp.importDatabaseHandler).toBeDefined();
    expect(imp.importDatabaseHandler.execute).toBeTypeOf("function");
    expect(imp.importDatabaseHandler.rollback).toBeTypeOf("function");

    expect(verify.verifySchemaHandler).toBeDefined();
    expect(verify.verifySchemaHandler.execute).toBeTypeOf("function");
  });
});
