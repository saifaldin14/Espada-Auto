/**
 * Infrastructure Knowledge Graph — SQLite Temporal Storage Tests
 *
 * Tests for the persistent SQLite-backed temporal storage implementation.
 * Uses :memory: SQLite database to avoid filesystem side effects.
 * Mirrors the InMemoryTemporalStorage test coverage:
 *   - Snapshot creation with metadata
 *   - Snapshot listing/filtering
 *   - Point-in-time node/edge queries
 *   - Node/edge history across snapshots
 *   - Snapshot diffing with field-level change detection
 *   - Retention/pruning
 *   - Timestamp-based snapshot lookup
 *   - Integration with sync workflow
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { GraphNode, GraphEdge, GraphNodeStatus } from "../types.js";
import { InMemoryGraphStorage } from "../storage/memory-store.js";
import { GraphEngine } from "./engine.js";
import {
  takeSnapshot,
  getTopologyAt,
  getNodeHistory as getNodeHistoryHelper,
  diffSnapshots as diffSnapshotsHelper,
  diffTimestamps,
  getEvolutionSummary,
  syncWithSnapshot,
  DEFAULT_RETENTION,
} from "./temporal.js";
import type {
  GraphSnapshot,
  SnapshotDiff,
  SnapshotRetentionConfig,
} from "./temporal.js";

// =============================================================================
// Dynamic Import + Native Module Probe (graceful skip if unavailable)
// =============================================================================

let SQLiteTemporalStorageClass:
  | typeof import("../storage/sqlite-temporal-store.js")["SQLiteTemporalStorage"]
  | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- CJS/ESM interop: better-sqlite3 exports vary by bundler
let DatabaseClass: any;
let hasSQLite = false;

try {
  const dbMod = await import("better-sqlite3");
  DatabaseClass = (dbMod as any).default ?? dbMod;
  // Probe: create a :memory: database and verify it works
  const probe = new DatabaseClass!(":memory:");
  probe.close();

  const tsMod = await import("../storage/sqlite-temporal-store.js");
  SQLiteTemporalStorageClass = tsMod.SQLiteTemporalStorage;
  hasSQLite = true;
} catch {
  // Native module not available — tests will be skipped
}

// =============================================================================
// Helpers
// =============================================================================

function makeNode(id: string, overrides?: Partial<GraphNode>): GraphNode {
  return {
    id,
    name: overrides?.name ?? id,
    provider: overrides?.provider ?? "aws",
    resourceType: overrides?.resourceType ?? "compute",
    status: (overrides?.status ?? "running") as GraphNodeStatus,
    region: overrides?.region ?? "us-east-1",
    account: overrides?.account ?? "111111111111",
    nativeId: overrides?.nativeId ?? id,
    discoveredAt: overrides?.discoveredAt ?? "2024-01-01T00:00:00.000Z",
    updatedAt: overrides?.updatedAt ?? "2024-01-01T00:00:00.000Z",
    lastSeenAt: overrides?.lastSeenAt ?? "2024-01-01T00:00:00.000Z",
    tags: overrides?.tags ?? {},
    metadata: overrides?.metadata ?? {},
    costMonthly: overrides?.costMonthly ?? 10,
    owner: overrides?.owner ?? null,
    createdAt: overrides?.createdAt ?? "2024-01-01T00:00:00.000Z",
  };
}

async function seedGraphState(
  storage: InMemoryGraphStorage,
  nodes: GraphNode[],
  edges?: Array<{ id: string; sourceNodeId: string; targetNodeId: string }>,
): Promise<void> {
  await storage.upsertNodes(
    nodes.map((n) => ({
      ...n,
      discoveredAt: n.discoveredAt,
      updatedAt: n.updatedAt,
      lastSeenAt: n.lastSeenAt,
    })),
  );
  if (edges) {
    await storage.upsertEdges(
      edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        relationshipType: "depends-on" as const,
        confidence: 1.0,
        discoveredVia: "config-scan" as const,
        metadata: {},
      })),
    );
  }
}

// Small delay to ensure different timestamps
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Tests
// =============================================================================

if (hasSQLite && SQLiteTemporalStorageClass && DatabaseClass) {
  const SQLiteTemporal = SQLiteTemporalStorageClass;
  const Database = DatabaseClass;

  describe("SQLiteTemporalStorage", () => {
    let storage: InMemoryGraphStorage;
    let temporal: InstanceType<typeof SQLiteTemporal>;
    let db: InstanceType<typeof Database>;

    beforeEach(async () => {
      storage = new InMemoryGraphStorage();
      await storage.initialize();
      db = new Database(":memory:");
      temporal = new SQLiteTemporal(storage, db);
      await temporal.initializeTemporal();
    });

    // -------------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------------

    describe("initializeTemporal", () => {
      it("should create temporal tables", () => {
        // Verify tables exist by querying sqlite_master
        const tables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'temporal_%' ORDER BY name",
          )
          .all() as Array<{ name: string }>;
        const names = tables.map((t) => t.name);
        expect(names).toContain("temporal_snapshots");
        expect(names).toContain("temporal_node_versions");
        expect(names).toContain("temporal_edge_versions");
        expect(names).toContain("temporal_schema_version");
      });

      it("should set schema version", () => {
        const row = db
          .prepare("SELECT version FROM temporal_schema_version LIMIT 1")
          .get() as { version: number };
        expect(row.version).toBe(1);
      });

      it("should be idempotent", async () => {
        // Calling initializeTemporal again should not throw
        await temporal.initializeTemporal();
        const row = db
          .prepare("SELECT version FROM temporal_schema_version LIMIT 1")
          .get() as { version: number };
        expect(row.version).toBe(1);
      });
    });

    // -------------------------------------------------------------------------
    // Snapshot Creation
    // -------------------------------------------------------------------------

    describe("createSnapshot", () => {
      it("should create a snapshot with correct metadata", async () => {
        await seedGraphState(
          storage,
          [makeNode("n1", { costMonthly: 100 }), makeNode("n2", { costMonthly: 50 })],
          [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
        );

        const snap = await temporal.createSnapshot("manual", "initial state");

        expect(snap.id).toMatch(/^snap-/);
        expect(snap.trigger).toBe("manual");
        expect(snap.label).toBe("initial state");
        expect(snap.nodeCount).toBe(2);
        expect(snap.edgeCount).toBe(1);
        expect(snap.totalCostMonthly).toBe(150);
        expect(snap.provider).toBeNull();
      });

      it("should store provider when specified", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        const snap = await temporal.createSnapshot("sync", "aws sync", "aws");
        expect(snap.provider).toBe("aws");
      });

      it("should persist to database", async () => {
        await seedGraphState(storage, [makeNode("n1"), makeNode("n2")]);
        const snap = await temporal.createSnapshot("manual");

        // Verify in DB
        const row = db
          .prepare("SELECT * FROM temporal_snapshots WHERE id = ?")
          .get(snap.id) as Record<string, unknown>;
        expect(row).toBeDefined();
        expect(row.node_count).toBe(2);

        // Verify node versions are stored
        const nodeCount = (
          db
            .prepare("SELECT COUNT(*) as c FROM temporal_node_versions WHERE snapshot_id = ?")
            .get(snap.id) as { c: number }
        ).c;
        expect(nodeCount).toBe(2);
      });

      it("should capture empty graph state", async () => {
        const snap = await temporal.createSnapshot("manual", "empty");
        expect(snap.nodeCount).toBe(0);
        expect(snap.edgeCount).toBe(0);
        expect(snap.totalCostMonthly).toBe(0);
      });

      it("should assign incrementing sequence numbers", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        const snap1 = await temporal.createSnapshot("manual");
        const snap2 = await temporal.createSnapshot("manual");

        const seq1 = (
          db.prepare("SELECT seq FROM temporal_snapshots WHERE id = ?").get(snap1.id) as {
            seq: number;
          }
        ).seq;
        const seq2 = (
          db.prepare("SELECT seq FROM temporal_snapshots WHERE id = ?").get(snap2.id) as {
            seq: number;
          }
        ).seq;

        expect(seq2).toBeGreaterThan(seq1);
      });
    });

    // -------------------------------------------------------------------------
    // getSnapshot
    // -------------------------------------------------------------------------

    describe("getSnapshot", () => {
      it("should return snapshot by ID", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        const snap = await temporal.createSnapshot("manual", "test");

        const retrieved = await temporal.getSnapshot(snap.id);
        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe(snap.id);
        expect(retrieved!.label).toBe("test");
      });

      it("should return null for non-existent ID", async () => {
        const result = await temporal.getSnapshot("nonexistent");
        expect(result).toBeNull();
      });
    });

    // -------------------------------------------------------------------------
    // listSnapshots
    // -------------------------------------------------------------------------

    describe("listSnapshots", () => {
      it("should list all snapshots newest-first", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        const snap1 = await temporal.createSnapshot("manual", "first");
        await delay(10);
        const snap2 = await temporal.createSnapshot("sync", "second");
        await delay(10);
        const snap3 = await temporal.createSnapshot("scheduled", "third");

        const all = await temporal.listSnapshots();
        expect(all).toHaveLength(3);
        expect(all[0]!.id).toBe(snap3.id);
        expect(all[2]!.id).toBe(snap1.id);
      });

      it("should filter by trigger type", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        await temporal.createSnapshot("manual");
        await temporal.createSnapshot("sync");
        await temporal.createSnapshot("manual");

        const syncs = await temporal.listSnapshots({ trigger: "sync" });
        expect(syncs).toHaveLength(1);
      });

      it("should filter by provider", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        await temporal.createSnapshot("sync", null, "aws");
        await temporal.createSnapshot("sync", null, "azure");
        await temporal.createSnapshot("sync", null, "aws");

        const aws = await temporal.listSnapshots({ provider: "aws" });
        expect(aws).toHaveLength(2);
      });

      it("should filter by null provider", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        await temporal.createSnapshot("manual", null, null);
        await temporal.createSnapshot("sync", null, "aws");

        const noProvider = await temporal.listSnapshots({ provider: null });
        expect(noProvider).toHaveLength(1);
      });

      it("should respect limit", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        for (let i = 0; i < 5; i++) {
          await temporal.createSnapshot("manual");
        }

        const limited = await temporal.listSnapshots({ limit: 3 });
        expect(limited).toHaveLength(3);
      });

      it("should filter by since/until", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        const snap1 = await temporal.createSnapshot("manual");
        await delay(50);
        const midpoint = new Date().toISOString();
        await delay(50);
        const snap2 = await temporal.createSnapshot("manual");

        const after = await temporal.listSnapshots({ since: midpoint });
        expect(after).toHaveLength(1);
        expect(after[0]!.id).toBe(snap2.id);
      });
    });

    // -------------------------------------------------------------------------
    // deleteSnapshot
    // -------------------------------------------------------------------------

    describe("deleteSnapshot", () => {
      it("should delete snapshot and all associated data", async () => {
        await seedGraphState(
          storage,
          [makeNode("n1"), makeNode("n2")],
          [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
        );
        const snap = await temporal.createSnapshot("manual");

        await temporal.deleteSnapshot(snap.id);

        expect(await temporal.getSnapshot(snap.id)).toBeNull();

        // Verify cascade
        const nodeCount = (
          db
            .prepare("SELECT COUNT(*) as c FROM temporal_node_versions WHERE snapshot_id = ?")
            .get(snap.id) as { c: number }
        ).c;
        expect(nodeCount).toBe(0);

        const edgeCount = (
          db
            .prepare("SELECT COUNT(*) as c FROM temporal_edge_versions WHERE snapshot_id = ?")
            .get(snap.id) as { c: number }
        ).c;
        expect(edgeCount).toBe(0);
      });
    });

    // -------------------------------------------------------------------------
    // Point-in-Time Queries
    // -------------------------------------------------------------------------

    describe("getNodesAtSnapshot", () => {
      it("should return all nodes at a snapshot", async () => {
        await seedGraphState(storage, [
          makeNode("n1", { provider: "aws" }),
          makeNode("n2", { provider: "azure" }),
        ]);
        const snap = await temporal.createSnapshot("manual");

        const nodes = await temporal.getNodesAtSnapshot(snap.id);
        expect(nodes).toHaveLength(2);
        expect(nodes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
      });

      it("should filter by provider", async () => {
        await seedGraphState(storage, [
          makeNode("n1", { provider: "aws" }),
          makeNode("n2", { provider: "azure" }),
        ]);
        const snap = await temporal.createSnapshot("manual");

        const awsNodes = await temporal.getNodesAtSnapshot(snap.id, { provider: "aws" });
        expect(awsNodes).toHaveLength(1);
        expect(awsNodes[0]!.provider).toBe("aws");
      });

      it("should filter by resource type", async () => {
        await seedGraphState(storage, [
          makeNode("n1", { resourceType: "compute" }),
          makeNode("n2", { resourceType: "database" }),
        ]);
        const snap = await temporal.createSnapshot("manual");

        const computes = await temporal.getNodesAtSnapshot(snap.id, {
          resourceType: "compute",
        });
        expect(computes).toHaveLength(1);
      });

      it("should filter by status array", async () => {
        await seedGraphState(storage, [
          makeNode("n1", { status: "running" }),
          makeNode("n2", { status: "stopped" }),
          makeNode("n3", { status: "deleted" }),
        ]);
        const snap = await temporal.createSnapshot("manual");

        const active = await temporal.getNodesAtSnapshot(snap.id, {
          status: ["running", "stopped"],
        });
        expect(active).toHaveLength(2);
      });

      it("should filter by region and account", async () => {
        await seedGraphState(storage, [
          makeNode("n1", { region: "us-east-1", account: "111" }),
          makeNode("n2", { region: "eu-west-1", account: "222" }),
        ]);
        const snap = await temporal.createSnapshot("manual");

        const filtered = await temporal.getNodesAtSnapshot(snap.id, {
          region: "us-east-1",
        });
        expect(filtered).toHaveLength(1);
        expect(filtered[0]!.id).toBe("n1");
      });

      it("should return empty for non-existent snapshot", async () => {
        const nodes = await temporal.getNodesAtSnapshot("nonexistent");
        expect(nodes).toHaveLength(0);
      });

      it("should preserve node data across graph mutations", async () => {
        await seedGraphState(storage, [makeNode("n1", { name: "original", costMonthly: 100 })]);
        const snap = await temporal.createSnapshot("manual");

        // Mutate the live graph
        await storage.upsertNode({
          ...makeNode("n1"),
          name: "modified",
          costMonthly: 200,
        });

        // Snapshot should still have original data
        const nodes = await temporal.getNodesAtSnapshot(snap.id);
        expect(nodes[0]!.name).toBe("original");
        expect(nodes[0]!.costMonthly).toBe(100);
      });
    });

    describe("getEdgesAtSnapshot", () => {
      it("should return all edges at a snapshot", async () => {
        await seedGraphState(
          storage,
          [makeNode("n1"), makeNode("n2"), makeNode("n3")],
          [
            { id: "e1", sourceNodeId: "n1", targetNodeId: "n2" },
            { id: "e2", sourceNodeId: "n2", targetNodeId: "n3" },
          ],
        );
        const snap = await temporal.createSnapshot("manual");

        const edges = await temporal.getEdgesAtSnapshot(snap.id);
        expect(edges).toHaveLength(2);
      });

      it("should return empty for non-existent snapshot", async () => {
        const edges = await temporal.getEdgesAtSnapshot("nonexistent");
        expect(edges).toHaveLength(0);
      });
    });

    // -------------------------------------------------------------------------
    // History Queries
    // -------------------------------------------------------------------------

    describe("getNodeHistory", () => {
      it("should return node state across multiple snapshots", async () => {
        // T1: node exists with cost=100
        await seedGraphState(storage, [makeNode("n1", { costMonthly: 100 })]);
        const snap1 = await temporal.createSnapshot("manual");

        // T2: cost changes
        await delay(10);
        await storage.upsertNode({ ...makeNode("n1"), costMonthly: 200 });
        const snap2 = await temporal.createSnapshot("manual");

        // T3: cost changes again
        await delay(10);
        await storage.upsertNode({ ...makeNode("n1"), costMonthly: 300 });
        const snap3 = await temporal.createSnapshot("manual");

        const history = await temporal.getNodeHistory("n1");
        expect(history).toHaveLength(3);

        // Newest first
        expect(history[0]!.snapshotId).toBe(snap3.id);
        expect(history[0]!.node.costMonthly).toBe(300);

        expect(history[1]!.snapshotId).toBe(snap2.id);
        expect(history[1]!.node.costMonthly).toBe(200);

        expect(history[2]!.snapshotId).toBe(snap1.id);
        expect(history[2]!.node.costMonthly).toBe(100);
      });

      it("should respect limit parameter", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        for (let i = 0; i < 5; i++) {
          await temporal.createSnapshot("manual");
        }

        const history = await temporal.getNodeHistory("n1", 2);
        expect(history).toHaveLength(2);
      });

      it("should return empty for unknown node", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        await temporal.createSnapshot("manual");

        const history = await temporal.getNodeHistory("unknown");
        expect(history).toHaveLength(0);
      });
    });

    describe("getEdgeHistory", () => {
      it("should return edge state across multiple snapshots", async () => {
        await seedGraphState(
          storage,
          [makeNode("n1"), makeNode("n2")],
          [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
        );
        const snap1 = await temporal.createSnapshot("manual");
        await delay(10);
        const snap2 = await temporal.createSnapshot("manual");

        const history = await temporal.getEdgeHistory("e1");
        expect(history).toHaveLength(2);
        expect(history[0]!.snapshotId).toBe(snap2.id);
        expect(history[1]!.snapshotId).toBe(snap1.id);
      });
    });

    // -------------------------------------------------------------------------
    // Diffing
    // -------------------------------------------------------------------------

    describe("diffSnapshots", () => {
      it("should detect added nodes", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        const snap1 = await temporal.createSnapshot("manual");

        // Add a node
        await storage.upsertNode(makeNode("n2"));
        const snap2 = await temporal.createSnapshot("manual");

        const diff = await temporal.diffSnapshots(snap1.id, snap2.id);
        expect(diff.addedNodes).toHaveLength(1);
        expect(diff.addedNodes[0]!.id).toBe("n2");
        expect(diff.removedNodes).toHaveLength(0);
      });

      it("should detect removed nodes", async () => {
        await seedGraphState(storage, [makeNode("n1"), makeNode("n2")]);
        const snap1 = await temporal.createSnapshot("manual");

        await storage.deleteNode("n2");
        const snap2 = await temporal.createSnapshot("manual");

        const diff = await temporal.diffSnapshots(snap1.id, snap2.id);
        expect(diff.removedNodes).toHaveLength(1);
        expect(diff.removedNodes[0]!.id).toBe("n2");
      });

      it("should detect changed nodes with field-level detail", async () => {
        await seedGraphState(storage, [
          makeNode("n1", { status: "running", costMonthly: 100 }),
        ]);
        const snap1 = await temporal.createSnapshot("manual");

        await storage.upsertNode({
          ...makeNode("n1"),
          status: "stopped",
          costMonthly: 0,
        });
        const snap2 = await temporal.createSnapshot("manual");

        const diff = await temporal.diffSnapshots(snap1.id, snap2.id);
        expect(diff.changedNodes).toHaveLength(1);
        expect(diff.changedNodes[0]!.changedFields).toContain("status");
        expect(diff.changedNodes[0]!.changedFields).toContain("costMonthly");
        expect(diff.changedNodes[0]!.before.status).toBe("running");
        expect(diff.changedNodes[0]!.after.status).toBe("stopped");
      });

      it("should detect added and removed edges", async () => {
        await seedGraphState(
          storage,
          [makeNode("n1"), makeNode("n2"), makeNode("n3")],
          [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
        );
        const snap1 = await temporal.createSnapshot("manual");

        // Remove e1, add e2
        await storage.deleteEdge("e1");
        await storage.upsertEdge({
          id: "e2",
          sourceNodeId: "n2",
          targetNodeId: "n3",
          relationshipType: "depends-on",
          confidence: 1.0,
          discoveredVia: "config-scan",
          metadata: {},
        });
        const snap2 = await temporal.createSnapshot("manual");

        const diff = await temporal.diffSnapshots(snap1.id, snap2.id);
        expect(diff.addedEdges).toHaveLength(1);
        expect(diff.addedEdges[0]!.id).toBe("e2");
        expect(diff.removedEdges).toHaveLength(1);
        expect(diff.removedEdges[0]!.id).toBe("e1");
      });

      it("should calculate cost delta", async () => {
        await seedGraphState(storage, [makeNode("n1", { costMonthly: 100 })]);
        const snap1 = await temporal.createSnapshot("manual");

        await storage.upsertNode({ ...makeNode("n1"), costMonthly: 250 });
        const snap2 = await temporal.createSnapshot("manual");

        const diff = await temporal.diffSnapshots(snap1.id, snap2.id);
        expect(diff.costDelta).toBe(150);
      });

      it("should throw for non-existent snapshot IDs", async () => {
        await expect(temporal.diffSnapshots("bad1", "bad2")).rejects.toThrow(
          "Snapshot not found: bad1",
        );
      });
    });

    // -------------------------------------------------------------------------
    // Retention / Pruning
    // -------------------------------------------------------------------------

    describe("pruneSnapshots", () => {
      it("should prune snapshots over the max count", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        for (let i = 0; i < 5; i++) {
          await temporal.createSnapshot("manual");
          await delay(5);
        }

        const pruned = await temporal.pruneSnapshots({ maxSnapshots: 3 });
        expect(pruned).toBe(2);

        const remaining = await temporal.listSnapshots();
        expect(remaining).toHaveLength(3);
      });

      it("should prune snapshots older than maxAgeMs", async () => {
        await seedGraphState(storage, [makeNode("n1")]);

        // Create an "old" snapshot by manipulating the DB directly
        db.prepare(
          `INSERT INTO temporal_snapshots (id, created_at, trigger_type, provider, label, node_count, edge_count, total_cost_monthly, seq)
           VALUES ('old-snap', '2020-01-01T00:00:00.000Z', 'manual', NULL, NULL, 0, 0, 0, 0)`,
        ).run();

        const snap2 = await temporal.createSnapshot("manual");

        const pruned = await temporal.pruneSnapshots({
          maxAgeMs: 1000, // 1 second — the old snap is way older
        });
        expect(pruned).toBe(1);

        const remaining = await temporal.listSnapshots();
        expect(remaining).toHaveLength(1);
        expect(remaining[0]!.id).toBe(snap2.id);
      });

      it("should cascade delete node/edge versions on prune", async () => {
        await seedGraphState(
          storage,
          [makeNode("n1")],
          [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n1" }],
        );
        const snap = await temporal.createSnapshot("manual");

        await temporal.pruneSnapshots({ maxSnapshots: 0 });

        const nodeCount = (
          db
            .prepare("SELECT COUNT(*) as c FROM temporal_node_versions WHERE snapshot_id = ?")
            .get(snap.id) as { c: number }
        ).c;
        expect(nodeCount).toBe(0);
      });
    });

    // -------------------------------------------------------------------------
    // getSnapshotAt
    // -------------------------------------------------------------------------

    describe("getSnapshotAt", () => {
      it("should return closest snapshot at or before timestamp", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        const snap1 = await temporal.createSnapshot("manual");
        await delay(50);
        const midpoint = new Date().toISOString();
        await delay(50);
        const snap2 = await temporal.createSnapshot("manual");

        const found = await temporal.getSnapshotAt(midpoint);
        expect(found).toBeDefined();
        expect(found!.id).toBe(snap1.id);
      });

      it("should return latest snapshot when timestamp is in the future", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        const snap = await temporal.createSnapshot("manual");

        const found = await temporal.getSnapshotAt("2099-01-01T00:00:00.000Z");
        expect(found).toBeDefined();
        expect(found!.id).toBe(snap.id);
      });

      it("should return oldest snapshot when all are newer", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        const snap = await temporal.createSnapshot("manual");

        const found = await temporal.getSnapshotAt("1900-01-01T00:00:00.000Z");
        expect(found).toBeDefined();
        expect(found!.id).toBe(snap.id);
      });

      it("should return null when no snapshots exist", async () => {
        const found = await temporal.getSnapshotAt(new Date().toISOString());
        expect(found).toBeNull();
      });
    });

    // -------------------------------------------------------------------------
    // Integration with temporal.ts helper functions
    // -------------------------------------------------------------------------

    describe("integration with temporal helpers", () => {
      it("takeSnapshot should work with SQLiteTemporalStorage", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        const snap = await takeSnapshot(temporal, "manual", "via helper");
        expect(snap.label).toBe("via helper");
        expect(snap.nodeCount).toBe(1);
      });

      it("getTopologyAt should return snapshot + nodes + edges", async () => {
        await seedGraphState(
          storage,
          [makeNode("n1"), makeNode("n2")],
          [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
        );
        await temporal.createSnapshot("manual");
        await delay(10);

        const result = await getTopologyAt(temporal, new Date().toISOString());
        expect(result).toBeDefined();
        expect(result!.nodes).toHaveLength(2);
        expect(result!.edges).toHaveLength(1);
      });

      it("getNodeHistory helper should return via SQLite", async () => {
        await seedGraphState(storage, [makeNode("n1", { costMonthly: 100 })]);
        await temporal.createSnapshot("manual");

        await storage.upsertNode({ ...makeNode("n1"), costMonthly: 200 });
        await temporal.createSnapshot("manual");

        const history = await getNodeHistoryHelper(temporal, "n1");
        expect(history).toHaveLength(2);
      });

      it("diffTimestamps should diff between two timestamps", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        const snap1 = await temporal.createSnapshot("manual");
        await delay(10);
        const mid = new Date().toISOString();
        await delay(10);

        // Add a node
        await storage.upsertNode(makeNode("n2"));
        const snap2 = await temporal.createSnapshot("manual");
        await delay(10);
        const end = new Date().toISOString();

        const diff = await diffTimestamps(temporal, snap1.createdAt, end);
        expect(diff).toBeDefined();
        expect(diff!.addedNodes).toHaveLength(1);
      });

      it("getEvolutionSummary should summarize trends", async () => {
        await seedGraphState(storage, [makeNode("n1", { costMonthly: 100 })]);
        await temporal.createSnapshot("manual");
        await delay(10);

        await storage.upsertNode(makeNode("n2", { costMonthly: 50 }));
        await temporal.createSnapshot("sync");
        await delay(10);

        await storage.upsertNode(makeNode("n3", { costMonthly: 75 }));
        await temporal.createSnapshot("scheduled");

        const summary = await getEvolutionSummary(temporal);
        expect(summary.snapshots).toHaveLength(3);
        expect(summary.nodeCountTrend).toHaveLength(3);
        expect(summary.costTrend).toHaveLength(3);

        // Oldest first in trend arrays
        expect(summary.nodeCountTrend[0]!.count).toBe(1);
        expect(summary.nodeCountTrend[2]!.count).toBe(3);
      });
    });

    // -------------------------------------------------------------------------
    // Edge Cases
    // -------------------------------------------------------------------------

    describe("edge cases", () => {
      it("should handle nodes with null optional fields", async () => {
        await seedGraphState(storage, [
          makeNode("n1", { costMonthly: undefined, owner: null, createdAt: undefined }),
        ]);
        const snap = await temporal.createSnapshot("manual");
        const nodes = await temporal.getNodesAtSnapshot(snap.id);
        expect(nodes).toHaveLength(1);
        expect(nodes[0]!.costMonthly).toBeNull();
      });

      it("should handle nodes with complex tags and metadata", async () => {
        const tags = { env: "prod", team: "infra", "cost-center": "eng-123" };
        const metadata = {
          instanceType: "m5.xlarge",
          nested: { key: "value" },
          list: [1, 2, 3],
        };
        await seedGraphState(storage, [makeNode("n1", { tags, metadata })]);
        const snap = await temporal.createSnapshot("manual");
        const nodes = await temporal.getNodesAtSnapshot(snap.id);
        expect(nodes[0]!.tags).toEqual(tags);
        expect(nodes[0]!.metadata).toEqual(metadata);
      });

      it("should handle many snapshots efficiently", async () => {
        await seedGraphState(storage, [makeNode("n1")]);
        for (let i = 0; i < 20; i++) {
          await temporal.createSnapshot("manual");
        }
        const all = await temporal.listSnapshots();
        expect(all).toHaveLength(20);
      });

      it("should filter by tag in getNodesAtSnapshot", async () => {
        await seedGraphState(storage, [
          makeNode("n1", { tags: { env: "prod" } }),
          makeNode("n2", { tags: { env: "dev" } }),
        ]);
        const snap = await temporal.createSnapshot("manual");
        const prodNodes = await temporal.getNodesAtSnapshot(snap.id, {
          tags: { env: "prod" },
        });
        expect(prodNodes).toHaveLength(1);
        expect(prodNodes[0]!.id).toBe("n1");
      });
    });
  });
} else {
  describe("SQLiteTemporalStorage", () => {
    it.skip("better-sqlite3 native module not available — skipping SQLite temporal tests", () => {});
  });
}
