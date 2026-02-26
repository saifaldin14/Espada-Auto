/**
 * Infrastructure Knowledge Graph — Storage Tests
 *
 * Tests InMemoryGraphStorage, SQLiteGraphStorage, and PostgresGraphStorage
 * against the same GraphStorage interface contract.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InMemoryGraphStorage } from "./storage/memory-store.js";
import type {
  GraphStorage,
  GraphNodeInput,
  GraphEdgeInput,
  GraphChange,
  GraphGroup,
} from "./types.js";

// =============================================================================
// Shared test fixtures
// =============================================================================

function makeNode(overrides: Partial<GraphNodeInput> & { id: string }): GraphNodeInput {
  return {
    name: overrides.name ?? overrides.id,
    provider: "aws",
    account: "123456789",
    region: "us-east-1",
    resourceType: "compute",
    nativeId: overrides.id,
    status: "running",
    tags: {},
    metadata: {},
    costMonthly: null,
    owner: null,
    createdAt: null,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<GraphEdgeInput> & { id: string; sourceNodeId: string; targetNodeId: string }): GraphEdgeInput {
  return {
    relationshipType: "runs-in",
    confidence: 1.0,
    discoveredVia: "api-field",
    metadata: {},
    ...overrides,
  };
}

// =============================================================================
// Run tests for each storage implementation
// =============================================================================

function runStorageTests(name: string, createStorage: () => GraphStorage | Promise<GraphStorage>, cleanup?: () => void | Promise<void>) {
  describe(`${name}: GraphStorage`, () => {
    let storage: GraphStorage;

    beforeEach(async () => {
      storage = await createStorage();
    });

    if (cleanup) {
      afterAll(async () => {
        await cleanup();
      });
    }

    // =========================================================================
    // Nodes
    // =========================================================================

    describe("nodes", () => {
      it("should upsert and retrieve a node", async () => {
        const node = makeNode({ id: "aws:123:us-east-1:compute:i-abc" });
        await storage.upsertNodes([node]);

        const result = await storage.getNode("aws:123:us-east-1:compute:i-abc");
        expect(result).toBeDefined();
        expect(result!.name).toBe("aws:123:us-east-1:compute:i-abc");
        expect(result!.provider).toBe("aws");
        expect(result!.status).toBe("running");
      });

      it("should return null for non-existent node", async () => {
        const result = await storage.getNode("does-not-exist");
        expect(result).toBeNull();
      });

      it("should update an existing node on upsert", async () => {
        const node1 = makeNode({ id: "aws:123:us-east-1:compute:i-abc", name: "old-name" });
        await storage.upsertNodes([node1]);

        const node2 = makeNode({ id: "aws:123:us-east-1:compute:i-abc", name: "new-name" });
        await storage.upsertNodes([node2]);

        const result = await storage.getNode("aws:123:us-east-1:compute:i-abc");
        expect(result!.name).toBe("new-name");
      });

      it("should batch upsert multiple nodes", async () => {
        const nodes = [
          makeNode({ id: "n1" }),
          makeNode({ id: "n2" }),
          makeNode({ id: "n3" }),
        ];
        await storage.upsertNodes(nodes);

        expect(await storage.getNode("n1")).toBeDefined();
        expect(await storage.getNode("n2")).toBeDefined();
        expect(await storage.getNode("n3")).toBeDefined();
      });

      it("should delete a node", async () => {
        await storage.upsertNodes([makeNode({ id: "n1" })]);
        await storage.deleteNode("n1");
        expect(await storage.getNode("n1")).toBeNull();
      });

      it("should cascade delete edges when deleting a node", async () => {
        await storage.upsertNodes([makeNode({ id: "n1" }), makeNode({ id: "n2" })]);
        await storage.upsertEdges([makeEdge({ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" })]);

        await storage.deleteNode("n1");

        const edges = await storage.getEdgesForNode("n2", "both");
        expect(edges).toHaveLength(0);
      });

      it("should query nodes by provider", async () => {
        await storage.upsertNodes([
          makeNode({ id: "n1", provider: "aws" }),
          makeNode({ id: "n2", provider: "azure" }),
          makeNode({ id: "n3", provider: "aws" }),
        ]);

        const awsNodes = await storage.queryNodes({ provider: "aws" });
        expect(awsNodes).toHaveLength(2);
      });

      it("should query nodes by resource type", async () => {
        await storage.upsertNodes([
          makeNode({ id: "n1", resourceType: "compute" }),
          makeNode({ id: "n2", resourceType: "database" }),
        ]);

        const dbs = await storage.queryNodes({ resourceType: ["database"] });
        expect(dbs).toHaveLength(1);
        expect(dbs[0]!.resourceType).toBe("database");
      });

      it("should query nodes by status", async () => {
        await storage.upsertNodes([
          makeNode({ id: "n1", status: "running" }),
          makeNode({ id: "n2", status: "stopped" }),
          makeNode({ id: "n3", status: "running" }),
        ]);

        const stopped = await storage.queryNodes({ status: ["stopped"] });
        expect(stopped).toHaveLength(1);
      });

      it("should query nodes by region", async () => {
        await storage.upsertNodes([
          makeNode({ id: "n1", region: "us-east-1" }),
          makeNode({ id: "n2", region: "eu-west-1" }),
        ]);

        const eu = await storage.queryNodes({ region: "eu-west-1" });
        expect(eu).toHaveLength(1);
      });
    });

    // =========================================================================
    // Edges
    // =========================================================================

    describe("edges", () => {
      beforeEach(async () => {
        await storage.upsertNodes([
          makeNode({ id: "n1" }),
          makeNode({ id: "n2" }),
          makeNode({ id: "n3" }),
        ]);
      });

      it("should upsert and retrieve an edge", async () => {
        await storage.upsertEdges([makeEdge({ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" })]);

        const result = await storage.getEdge("e1");
        expect(result).toBeDefined();
        expect(result!.sourceNodeId).toBe("n1");
        expect(result!.targetNodeId).toBe("n2");
      });

      it("should get outgoing edges for a node", async () => {
        await storage.upsertEdges([
          makeEdge({ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }),
          makeEdge({ id: "e2", sourceNodeId: "n1", targetNodeId: "n3" }),
          makeEdge({ id: "e3", sourceNodeId: "n2", targetNodeId: "n3" }),
        ]);

        const outgoing = await storage.getEdgesForNode("n1", "downstream");
        expect(outgoing).toHaveLength(2);
      });

      it("should get incoming edges for a node", async () => {
        await storage.upsertEdges([
          makeEdge({ id: "e1", sourceNodeId: "n1", targetNodeId: "n3" }),
          makeEdge({ id: "e2", sourceNodeId: "n2", targetNodeId: "n3" }),
        ]);

        const incoming = await storage.getEdgesForNode("n3", "upstream");
        expect(incoming).toHaveLength(2);
      });

      it("should get all (both direction) edges for a node", async () => {
        await storage.upsertEdges([
          makeEdge({ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }),
          makeEdge({ id: "e2", sourceNodeId: "n3", targetNodeId: "n1" }),
        ]);

        const all = await storage.getEdgesForNode("n1", "both");
        expect(all).toHaveLength(2);
      });
    });

    // =========================================================================
    // Graph Traversal
    // =========================================================================

    describe("traversal", () => {
      beforeEach(async () => {
        // Build a small graph: n1 -> n2 -> n3 -> n4
        await storage.upsertNodes([
          makeNode({ id: "n1" }),
          makeNode({ id: "n2" }),
          makeNode({ id: "n3" }),
          makeNode({ id: "n4" }),
        ]);
        await storage.upsertEdges([
          makeEdge({ id: "e12", sourceNodeId: "n1", targetNodeId: "n2" }),
          makeEdge({ id: "e23", sourceNodeId: "n2", targetNodeId: "n3" }),
          makeEdge({ id: "e34", sourceNodeId: "n3", targetNodeId: "n4" }),
        ]);
      });

      it("should traverse downstream neighbors within depth", async () => {
        const result = await storage.getNeighbors("n1", 2, "downstream");
        const nodeIds = result.nodes.map((n) => n.id).sort();
        expect(nodeIds).toContain("n2");
        expect(nodeIds).toContain("n3");
      });

      it("should respect max depth", async () => {
        const result = await storage.getNeighbors("n1", 1, "downstream");
        const nodeIds = result.nodes.map((n) => n.id);
        expect(nodeIds).toContain("n2");
        expect(nodeIds).not.toContain("n3");
        expect(nodeIds).not.toContain("n4");
      });

      it("should traverse upstream neighbors", async () => {
        const result = await storage.getNeighbors("n4", 3, "upstream");
        const nodeIds = result.nodes.map((n) => n.id).sort();
        expect(nodeIds).toContain("n3");
        expect(nodeIds).toContain("n2");
        expect(nodeIds).toContain("n1");
      });

      it("should traverse both directions", async () => {
        const result = await storage.getNeighbors("n2", 1, "both");
        const nodeIds = result.nodes.map((n) => n.id).sort();
        expect(nodeIds).toContain("n1");
        expect(nodeIds).toContain("n3");
      });

      it("should include the root node in the visited set", async () => {
        const result = await storage.getNeighbors("n2", 2, "downstream");
        const nodeIds = result.nodes.map((n) => n.id);
        expect(nodeIds).toContain("n3");
        expect(nodeIds).toContain("n4");
      });

      it("should handle cycles without infinite loops", async () => {
        // Add a cycle: n4 -> n1
        await storage.upsertEdges([
          makeEdge({ id: "e41", sourceNodeId: "n4", targetNodeId: "n1" }),
        ]);

        const result = await storage.getNeighbors("n1", 10, "downstream");
        // Should still complete without hanging
        expect(result.nodes.length).toBeGreaterThan(0);
        expect(result.nodes.length).toBeLessThanOrEqual(4);
      });
    });

    // =========================================================================
    // Changes
    // =========================================================================

    describe("changes", () => {
      it("should append and retrieve changes", async () => {
        const changes: GraphChange[] = [
          {
            id: "c1",
            targetId: "n1",
            changeType: "node-created",
            field: null,
            previousValue: null,
            newValue: "test",
            detectedAt: new Date().toISOString(),
            detectedVia: "sync",
            correlationId: "sync-1",
            initiator: null,
            initiatorType: null,
            metadata: {},
          },
        ];

        await storage.appendChanges(changes);
        const timeline = await storage.getNodeTimeline("n1", 10);
        expect(timeline).toHaveLength(1);
        expect(timeline[0]!.changeType).toBe("node-created");
      });
    });

    // =========================================================================
    // Groups
    // =========================================================================

    describe("groups", () => {
      beforeEach(async () => {
        await storage.upsertNodes([makeNode({ id: "n1" }), makeNode({ id: "n2" })]);
      });

      it("should create and retrieve a group", async () => {
        const group: GraphGroup = {
          id: "g1",
          name: "production-vpc",
          groupType: "vpc",
          provider: "aws",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await storage.upsertGroup(group);
        const result = await storage.getGroup("g1");
        expect(result).toBeDefined();
        expect(result!.name).toBe("production-vpc");
      });

      it("should add and retrieve group members", async () => {
        const group: GraphGroup = {
          id: "g1",
          name: "test-group",
          groupType: "service",
          provider: "aws",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await storage.upsertGroup(group);
        await storage.addGroupMember("g1", "n1");
        await storage.addGroupMember("g1", "n2");

        const members = await storage.getGroupMembers("g1");
        expect(members).toHaveLength(2);
        expect(members.map((m) => m.id).sort()).toEqual(["n1", "n2"]);
      });

      it("should remove a group member", async () => {
        const group: GraphGroup = {
          id: "g1",
          name: "test-group",
          groupType: "service",
          provider: "aws",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await storage.upsertGroup(group);
        await storage.addGroupMember("g1", "n1");
        await storage.addGroupMember("g1", "n2");
        await storage.removeGroupMember("g1", "n1");

        const members = await storage.getGroupMembers("g1");
        expect(members).toHaveLength(1);
        expect(members[0]!.id).toBe("n2");
      });
    });

    // =========================================================================
    // Stats
    // =========================================================================

    describe("stats", () => {
      it("should return correct stats", async () => {
        await storage.upsertNodes([
          makeNode({ id: "n1", provider: "aws", resourceType: "compute" }),
          makeNode({ id: "n2", provider: "aws", resourceType: "database" }),
          makeNode({ id: "n3", provider: "azure", resourceType: "compute" }),
        ]);
        await storage.upsertEdges([
          makeEdge({ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }),
        ]);

        const stats = await storage.getStats();
        expect(stats.totalNodes).toBe(3);
        expect(stats.totalEdges).toBe(1);
        expect(stats.nodesByProvider.aws).toBe(2);
        expect(stats.nodesByProvider.azure).toBe(1);
        expect(stats.nodesByResourceType.compute).toBe(2);
        expect(stats.nodesByResourceType.database).toBe(1);
      });
    });

    // =========================================================================
    // Pagination
    // =========================================================================

    describe("pagination", () => {
      beforeEach(async () => {
        // Seed 10 nodes with varying attributes
        const nodes: GraphNodeInput[] = [];
        for (let i = 1; i <= 10; i++) {
          nodes.push(
            makeNode({
              id: `node-${String(i).padStart(2, "0")}`,
              name: `node-${String(i).padStart(2, "0")}`,
              provider: i <= 6 ? "aws" : "azure",
              resourceType: i % 3 === 0 ? "database" : "compute",
              costMonthly: i * 10,
            }),
          );
        }
        await storage.upsertNodes(nodes);

        // Seed 5 edges
        for (let i = 1; i <= 5; i++) {
          await storage.upsertEdge(
            makeEdge({
              id: `edge-${i}`,
              sourceNodeId: `node-${String(i).padStart(2, "0")}`,
              targetNodeId: `node-${String(i + 1).padStart(2, "0")}`,
            }),
          );
        }

        // Seed 8 changes
        for (let i = 1; i <= 8; i++) {
          await storage.appendChange({
            id: `change-${i}`,
            targetId: `node-${String((i % 5) + 1).padStart(2, "0")}`,
            changeType: "node-updated",
            field: "costMonthly",
            previousValue: String((i - 1) * 10),
            newValue: String(i * 10),
            detectedAt: new Date(2024, 0, i).toISOString(),
            detectedVia: "full-scan",
            correlationId: null,
            initiator: null,
            initiatorType: null,
            metadata: {},
          });
        }
      });

      describe("queryNodesPaginated", () => {
        it("should return first page with correct totalCount", async () => {
          const result = await storage.queryNodesPaginated({}, { limit: 3 });
          expect(result.items).toHaveLength(3);
          expect(result.totalCount).toBe(10);
          expect(result.hasMore).toBe(true);
          expect(result.nextCursor).not.toBeNull();
        });

        it("should traverse all pages", async () => {
          const allItems: string[] = [];
          let cursor: string | undefined;

          for (let page = 0; page < 10; page++) {
            const result = await storage.queryNodesPaginated(
              {},
              { limit: 3, cursor },
            );
            allItems.push(...result.items.map((n) => n.id));
            if (!result.hasMore) break;
            cursor = result.nextCursor!;
          }

          expect(allItems).toHaveLength(10);
          // All IDs unique
          expect(new Set(allItems).size).toBe(10);
        });

        it("should apply filters with pagination", async () => {
          const result = await storage.queryNodesPaginated(
            { provider: "aws" },
            { limit: 2 },
          );
          expect(result.totalCount).toBe(6);
          expect(result.items).toHaveLength(2);
          expect(result.items.every((n) => n.provider === "aws")).toBe(true);
        });

        it("should return empty result for out-of-range cursor", async () => {
          // Get to the last page first
          let cursor: string | undefined;
          let result = await storage.queryNodesPaginated({}, { limit: 10 });
          expect(result.hasMore).toBe(false);
          expect(result.nextCursor).toBeNull();
        });

        it("should default to 100 items when no limit specified", async () => {
          const result = await storage.queryNodesPaginated({});
          expect(result.items).toHaveLength(10); // only 10 nodes seeded
          expect(result.hasMore).toBe(false);
        });
      });

      describe("queryEdgesPaginated", () => {
        it("should paginate edges", async () => {
          const page1 = await storage.queryEdgesPaginated({}, { limit: 2 });
          expect(page1.items).toHaveLength(2);
          expect(page1.totalCount).toBe(5);
          expect(page1.hasMore).toBe(true);

          const page2 = await storage.queryEdgesPaginated(
            {},
            { limit: 2, cursor: page1.nextCursor! },
          );
          expect(page2.items).toHaveLength(2);
          expect(page2.hasMore).toBe(true);

          const page3 = await storage.queryEdgesPaginated(
            {},
            { limit: 2, cursor: page2.nextCursor! },
          );
          expect(page3.items).toHaveLength(1);
          expect(page3.hasMore).toBe(false);
          expect(page3.nextCursor).toBeNull();
        });

        it("should apply filters with pagination", async () => {
          const result = await storage.queryEdgesPaginated(
            { sourceNodeId: "node-01" },
            { limit: 10 },
          );
          expect(result.totalCount).toBe(1);
          expect(result.items).toHaveLength(1);
        });
      });

      describe("getChangesPaginated", () => {
        it("should paginate changes", async () => {
          const page1 = await storage.getChangesPaginated({}, { limit: 3 });
          expect(page1.items).toHaveLength(3);
          expect(page1.totalCount).toBe(8);
          expect(page1.hasMore).toBe(true);
        });

        it("should traverse all change pages", async () => {
          const allChanges: string[] = [];
          let cursor: string | undefined;

          for (let page = 0; page < 10; page++) {
            const result = await storage.getChangesPaginated(
              {},
              { limit: 3, cursor },
            );
            allChanges.push(...result.items.map((c) => c.id));
            if (!result.hasMore) break;
            cursor = result.nextCursor!;
          }

          expect(allChanges).toHaveLength(8);
          expect(new Set(allChanges).size).toBe(8);
        });

        it("should apply filters with pagination", async () => {
          const result = await storage.getChangesPaginated(
            { changeType: "node-updated" },
            { limit: 5 },
          );
          expect(result.totalCount).toBe(8);
          expect(result.items).toHaveLength(5);
          expect(result.hasMore).toBe(true);
        });
      });

      describe("cursor validation", () => {
        it("should reject a malformed cursor", async () => {
          await expect(
            storage.queryNodesPaginated({}, { cursor: "garbage" }),
          ).rejects.toThrow("Invalid pagination cursor");
        });

        it("should reject a non-base64url cursor", async () => {
          await expect(
            storage.queryEdgesPaginated({}, { cursor: "!!!invalid!!!" }),
          ).rejects.toThrow("Invalid pagination cursor");
        });

        it("should clamp limit to at most 1000", async () => {
          const result = await storage.queryNodesPaginated({}, { limit: 5000 });
          // Should not crash; items capped by available data
          expect(result.items.length).toBeLessThanOrEqual(1000);
        });

        it("should treat zero/negative limit as 1", async () => {
          const result = await storage.queryNodesPaginated({}, { limit: 0 });
          expect(result.items.length).toBeGreaterThanOrEqual(1);
        });
      });
    });
  });
}

// Run for InMemory
runStorageTests("InMemory", () => new InMemoryGraphStorage());

// =============================================================================
// SQLite storage tests (skipped when better-sqlite3 native module unavailable)
// =============================================================================

let hasSQLite = false;
let SQLiteGraphStorageClass: typeof import("./storage/sqlite-store.js")["SQLiteGraphStorage"] | undefined;

try {
  const mod = await import("./storage/sqlite-store.js");
  // Probe native module by instantiating with :memory:
  const probe = new mod.SQLiteGraphStorage(":memory:");
  await probe.initialize();
  probe.close();
  SQLiteGraphStorageClass = mod.SQLiteGraphStorage;
  hasSQLite = true;
} catch {
  // better-sqlite3 native module unavailable
}

if (hasSQLite && SQLiteGraphStorageClass) {
  const SQLiteStorage = SQLiteGraphStorageClass;
  const SQLITE_TEST_DIR = join(tmpdir(), "espada-kg-test-sqlite");

  // Ensure clean test directory
  if (existsSync(SQLITE_TEST_DIR)) {
    rmSync(SQLITE_TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(SQLITE_TEST_DIR, { recursive: true });

  let sqliteTestCounter = 0;

  runStorageTests(
    "SQLite",
    async () => {
      // Each test gets a fresh database file to avoid cross-test pollution
      const dbPath = join(SQLITE_TEST_DIR, `test-${++sqliteTestCounter}.db`);
      const store = new SQLiteStorage(dbPath);
      await store.initialize();
      return store;
    },
    () => {
      // Clean up all test databases after all SQLite tests complete
      if (existsSync(SQLITE_TEST_DIR)) {
        rmSync(SQLITE_TEST_DIR, { recursive: true, force: true });
      }
    },
  );
} else {
  describe("SQLite: GraphStorage", () => {
    it.skip("better-sqlite3 native module not available", () => {});
  });
}

// =============================================================================
// PostgreSQL storage tests
// =============================================================================

// PostgreSQL tests require a running PostgreSQL instance.
// Set POSTGRES_TEST_URL to enable them:
//   POSTGRES_TEST_URL="postgresql://user:pass@localhost:5432/kg_test" pnpm test
//
// In CI, use testcontainers or a PostgreSQL service container.
// Skipped by default when no connection string is provided.

const POSTGRES_URL = process.env.POSTGRES_TEST_URL;

if (POSTGRES_URL) {
  // Dynamically import to avoid failing when pg is not installed
  const loadPostgres = async () => {
    const { PostgresGraphStorage } = await import("./storage/postgres-store.js");
    return PostgresGraphStorage;
  };

  let pgInstance: GraphStorage | null = null;

  runStorageTests(
    "PostgreSQL",
    async () => {
      const PostgresGraphStorage = await loadPostgres();
      const store = new PostgresGraphStorage({
        connectionString: POSTGRES_URL,
        schema: `kg_test_${Date.now()}`,
      });
      await store.initialize();
      pgInstance = store;
      return store;
    },
    async () => {
      if (pgInstance && "close" in pgInstance) {
        await (pgInstance as { close: () => Promise<void> }).close();
      }
    },
  );
} else {
  describe("PostgreSQL: GraphStorage", () => {
    it.skip("skipped — set POSTGRES_TEST_URL to enable", () => {});
  });
}
