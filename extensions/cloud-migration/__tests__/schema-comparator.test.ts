/**
 * Cross-Cloud Migration Engine — Schema Comparator & Database Migration Tests
 */
import { describe, it, expect } from "vitest";

import {
  compareSchemas,
  generateSchemaChanges,
  type SchemaComparisonResult,
} from "../src/data/database/schema-comparator.js";

import type { DatabaseSchema } from "../src/data/types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeSchema(overrides?: Partial<DatabaseSchema>): DatabaseSchema {
  return {
    database: "testdb",
    tables: [],
    views: [],
    functions: [],
    sequences: [],
    extensions: [],
    ...overrides,
  };
}

function makeColumn(name: string, type: string, opts?: { nullable?: boolean; isPrimaryKey?: boolean }) {
  return {
    name,
    type,
    nullable: opts?.nullable ?? true,
    isPrimaryKey: opts?.isPrimaryKey ?? false,
    isForeignKey: false,
  };
}

function makeTable(name: string, columns: ReturnType<typeof makeColumn>[], rowCount = 100) {
  return {
    name,
    schema: "public",
    columns,
    rowCount,
    sizeBytes: rowCount * 512,
    indexes: [],
    constraints: [],
    partitioned: false,
  };
}

// =============================================================================
// compareSchemas
// =============================================================================
describe("data/database/schema-comparator — compareSchemas", () => {
  it("identical schemas are compatible", () => {
    const cols = [makeColumn("id", "integer", { isPrimaryKey: true }), makeColumn("name", "text")];
    const schema = makeSchema({
      tables: [makeTable("users", cols)],
    });

    const result = compareSchemas(schema, schema);
    expect(result.addedTables).toEqual([]);
    expect(result.removedTables).toEqual([]);
    expect(result.modifiedTables).toEqual([]);
    expect(result.compatible).toBe(true);
  });

  it("detects added tables (source has more than target)", () => {
    const source = makeSchema({
      database: "src",
      tables: [
        makeTable("users", [makeColumn("id", "integer")]),
        makeTable("orders", [makeColumn("id", "integer")]),
      ],
    });
    const target = makeSchema({
      database: "tgt",
      tables: [makeTable("users", [makeColumn("id", "integer")])],
    });

    const result = compareSchemas(source, target);
    expect(result.sourceDatabase).toBe("src");
    expect(result.targetDatabase).toBe("tgt");
    expect(result.addedTables).toContain("orders");
    expect(result.removedTables).toEqual([]);
  });

  it("detects removed tables (target has extra)", () => {
    const source = makeSchema({
      tables: [makeTable("users", [makeColumn("id", "integer")])],
    });
    const target = makeSchema({
      tables: [
        makeTable("users", [makeColumn("id", "integer")]),
        makeTable("legacy", [makeColumn("id", "integer")]),
      ],
    });

    const result = compareSchemas(source, target);
    expect(result.removedTables).toContain("legacy");
    expect(result.compatible).toBe(false);
  });

  it("detects column type changes", () => {
    const source = makeSchema({
      tables: [
        makeTable("users", [
          makeColumn("id", "integer"),
          makeColumn("score", "float"),
        ]),
      ],
    });
    const target = makeSchema({
      tables: [
        makeTable("users", [
          makeColumn("id", "integer"),
          makeColumn("score", "double"),
        ]),
      ],
    });

    const result = compareSchemas(source, target);
    expect(result.modifiedTables.length).toBe(1);
    expect(result.modifiedTables[0].typeChanges.length).toBe(1);
    expect(result.modifiedTables[0].typeChanges[0].column).toBe("score");
    expect(result.modifiedTables[0].typeChanges[0].sourceType).toBe("float");
    expect(result.modifiedTables[0].typeChanges[0].targetType).toBe("double");
  });

  it("detects added and removed columns", () => {
    const source = makeSchema({
      tables: [
        makeTable("users", [
          makeColumn("id", "integer"),
          makeColumn("email", "text"),
        ]),
      ],
    });
    const target = makeSchema({
      tables: [
        makeTable("users", [
          makeColumn("id", "integer"),
          makeColumn("legacy_name", "text"),
        ]),
      ],
    });

    const result = compareSchemas(source, target);
    expect(result.modifiedTables.length).toBe(1);
    expect(result.modifiedTables[0].addedColumns).toContain("email");
    expect(result.modifiedTables[0].removedColumns).toContain("legacy_name");
    expect(result.compatible).toBe(false); // removed columns = incompatible
  });

  it("calculates row counts", () => {
    const source = makeSchema({
      tables: [makeTable("a", [], 500), makeTable("b", [], 300)],
    });
    const target = makeSchema({
      tables: [makeTable("a", [], 400)],
    });

    const result = compareSchemas(source, target);
    expect(result.sourceRowCount).toBe(800);
    expect(result.targetRowCount).toBe(400);
  });

  it("empty schemas are compatible", () => {
    const result = compareSchemas(makeSchema(), makeSchema());
    expect(result.compatible).toBe(true);
    expect(result.addedTables).toEqual([]);
    expect(result.removedTables).toEqual([]);
  });
});

// =============================================================================
// generateSchemaChanges
// =============================================================================
describe("data/database/schema-comparator — generateSchemaChanges", () => {
  it("same engine returns no changes", () => {
    const schema = makeSchema({
      tables: [makeTable("users", [makeColumn("id", "serial")])],
    });
    const changes = generateSchemaChanges(schema, "postgresql", "postgresql");
    expect(changes).toEqual([]);
  });

  it("pg→mysql maps serial to INT AUTO_INCREMENT", () => {
    const schema = makeSchema({
      tables: [
        makeTable("users", [makeColumn("id", "serial"), makeColumn("data", "jsonb")]),
      ],
    });

    const changes = generateSchemaChanges(schema, "postgresql", "mysql");
    expect(changes.length).toBeGreaterThanOrEqual(2);

    const serialChange = changes.find((c) => c.column === "id");
    expect(serialChange).toBeDefined();
    expect(serialChange!.targetType).toBe("INT AUTO_INCREMENT");
    expect(serialChange!.automatic).toBe(true);

    const jsonbChange = changes.find((c) => c.column === "data");
    expect(jsonbChange).toBeDefined();
    expect(jsonbChange!.targetType).toBe("JSON");
  });

  it("mysql→pg maps tinyint(1) to boolean", () => {
    const schema = makeSchema({
      tables: [
        makeTable("users", [makeColumn("active", "tinyint(1)")]),
      ],
    });

    const changes = generateSchemaChanges(schema, "mysql", "postgresql");
    const boolChange = changes.find((c) => c.column === "active");
    expect(boolChange).toBeDefined();
    expect(boolChange!.targetType).toBe("boolean");
  });

  it("pg→mysql detects extension replacements", () => {
    const schema = makeSchema({
      tables: [],
      extensions: ["pg_trgm", "uuid-ossp"],
    });

    const changes = generateSchemaChanges(schema, "postgresql", "mysql");
    const extChanges = changes.filter((c) => c.type === "extension-replace");
    expect(extChanges.length).toBe(2);
    expect(extChanges[0].automatic).toBe(false);
  });

  it("maps multiple pg types correctly", () => {
    const schema = makeSchema({
      tables: [
        makeTable("data", [
          makeColumn("id", "bigserial"),
          makeColumn("active", "boolean"),
          makeColumn("content", "text"),
          makeColumn("avatar", "bytea"),
          makeColumn("ip", "inet"),
          makeColumn("ts", "timestamp with time zone"),
        ]),
      ],
    });

    const changes = generateSchemaChanges(schema, "postgresql", "mysql");
    expect(changes.some((c) => c.column === "id" && c.targetType === "BIGINT AUTO_INCREMENT")).toBe(true);
    expect(changes.some((c) => c.column === "active" && c.targetType === "TINYINT(1)")).toBe(true);
    expect(changes.some((c) => c.column === "content" && c.targetType === "LONGTEXT")).toBe(true);
    expect(changes.some((c) => c.column === "avatar" && c.targetType === "LONGBLOB")).toBe(true);
    expect(changes.some((c) => c.column === "ip" && c.targetType === "VARCHAR(45)")).toBe(true);
    expect(changes.some((c) => c.column === "ts" && c.targetType === "DATETIME")).toBe(true);
  });

  it("mariadb→pg uses same mappings as mysql→pg", () => {
    const schema = makeSchema({
      tables: [
        makeTable("data", [makeColumn("d", "datetime")]),
      ],
    });

    const changes = generateSchemaChanges(schema, "mariadb", "postgresql");
    expect(changes.some((c) => c.column === "d" && c.targetType === "timestamp")).toBe(true);
  });

  it("pg→mariadb uses same mappings as pg→mysql", () => {
    const schema = makeSchema({
      tables: [
        makeTable("data", [makeColumn("b", "boolean")]),
      ],
    });

    const changes = generateSchemaChanges(schema, "postgresql", "mariadb");
    expect(changes.some((c) => c.column === "b" && c.targetType === "TINYINT(1)")).toBe(true);
  });
});
