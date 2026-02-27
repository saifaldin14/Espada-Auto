/**
 * Infrastructure Knowledge Graph — Temporal Knowledge Graph Tests
 *
 * Tests for snapshot creation, diffing, time-travel queries,
 * node history, evolution summary, retention/pruning, and
 * the sync-with-snapshot workflow.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStorage } from "../storage/memory-store.js";
import { GraphEngine } from "./engine.js";
import {
  InMemoryTemporalStorage,
  takeSnapshot,
  getTopologyAt,
  getNodeHistory,
  diffSnapshots,
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
import type { GraphNode, GraphEdge, GraphNodeStatus } from "../types.js";

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
  await storage.upsertNodes(nodes.map((n) => ({
    ...n,
    discoveredAt: n.discoveredAt,
    updatedAt: n.updatedAt,
    lastSeenAt: n.lastSeenAt,
  })));
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

// =============================================================================
// Tests
// =============================================================================

describe("Temporal Knowledge Graph", () => {
  let storage: InMemoryGraphStorage;
  let temporal: InMemoryTemporalStorage;

  beforeEach(async () => {
    storage = new InMemoryGraphStorage();
    await storage.initialize();
    temporal = new InMemoryTemporalStorage(storage);
    await temporal.initializeTemporal();
  });

  // ---------------------------------------------------------------------------
  // Snapshot creation
  // ---------------------------------------------------------------------------

  describe("createSnapshot", () => {
    it("should create a snapshot with correct metadata", async () => {
      await seedGraphState(storage, [
        makeNode("n1", { costMonthly: 100 }),
        makeNode("n2", { costMonthly: 50 }),
      ], [
        { id: "e1", sourceNodeId: "n1", targetNodeId: "n2" },
      ]);

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
      const snap = await temporal.createSnapshot("sync", null, "aws");
      expect(snap.provider).toBe("aws");
    });

    it("should create an empty snapshot when graph is empty", async () => {
      const snap = await temporal.createSnapshot("manual");
      expect(snap.nodeCount).toBe(0);
      expect(snap.edgeCount).toBe(0);
      expect(snap.totalCostMonthly).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Snapshot retrieval
  // ---------------------------------------------------------------------------

  describe("getSnapshot", () => {
    it("should retrieve a snapshot by ID", async () => {
      await seedGraphState(storage, [makeNode("n1")]);
      const snap = await temporal.createSnapshot("manual");
      const retrieved = await temporal.getSnapshot(snap.id);
      expect(retrieved).toEqual(snap);
    });

    it("should return null for unknown ID", async () => {
      const result = await temporal.getSnapshot("nonexistent");
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // listSnapshots
  // ---------------------------------------------------------------------------

  describe("listSnapshots", () => {
    it("should list all snapshots in reverse chronological order", async () => {
      await seedGraphState(storage, [makeNode("n1")]);

      const s1 = await temporal.createSnapshot("manual", "first");
      const s2 = await temporal.createSnapshot("sync", "second");
      const s3 = await temporal.createSnapshot("scheduled", "third");

      const list = await temporal.listSnapshots();
      expect(list).toHaveLength(3);
      expect(list[0]!.id).toBe(s3.id);
      expect(list[2]!.id).toBe(s1.id);
    });

    it("should filter by trigger", async () => {
      await seedGraphState(storage, [makeNode("n1")]);
      await temporal.createSnapshot("manual");
      await temporal.createSnapshot("sync");
      await temporal.createSnapshot("sync");

      const list = await temporal.listSnapshots({ trigger: "sync" });
      expect(list).toHaveLength(2);
      expect(list.every((s) => s.trigger === "sync")).toBe(true);
    });

    it("should respect limit", async () => {
      await seedGraphState(storage, [makeNode("n1")]);
      for (let i = 0; i < 5; i++) {
        await temporal.createSnapshot("manual");
      }

      const list = await temporal.listSnapshots({ limit: 2 });
      expect(list).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteSnapshot
  // ---------------------------------------------------------------------------

  describe("deleteSnapshot", () => {
    it("should remove snapshot and all versioned data", async () => {
      await seedGraphState(storage, [makeNode("n1")]);
      const snap = await temporal.createSnapshot("manual");

      await temporal.deleteSnapshot(snap.id);

      expect(await temporal.getSnapshot(snap.id)).toBeNull();
      expect(await temporal.getNodesAtSnapshot(snap.id)).toEqual([]);
      expect(await temporal.getEdgesAtSnapshot(snap.id)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Point-in-time queries
  // ---------------------------------------------------------------------------

  describe("getNodesAtSnapshot", () => {
    it("should return nodes from snapshot, not current state", async () => {
      await seedGraphState(storage, [makeNode("n1"), makeNode("n2")]);
      const snap = await temporal.createSnapshot("manual");

      // Add more nodes after snapshot
      await seedGraphState(storage, [
        makeNode("n1"),
        makeNode("n2"),
        makeNode("n3"),
      ]);

      const nodesAtSnap = await temporal.getNodesAtSnapshot(snap.id);
      expect(nodesAtSnap).toHaveLength(2);
      expect(nodesAtSnap.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    });

    it("should apply provider filter", async () => {
      await seedGraphState(storage, [
        makeNode("n1", { provider: "aws" }),
        makeNode("n2", { provider: "azure" }),
      ]);
      const snap = await temporal.createSnapshot("manual");

      const awsOnly = await temporal.getNodesAtSnapshot(snap.id, { provider: "aws" });
      expect(awsOnly).toHaveLength(1);
      expect(awsOnly[0]!.provider).toBe("aws");
    });

    it("should apply resourceType filter", async () => {
      await seedGraphState(storage, [
        makeNode("n1", { resourceType: "compute" }),
        makeNode("n2", { resourceType: "database" }),
      ]);
      const snap = await temporal.createSnapshot("manual");

      const dbs = await temporal.getNodesAtSnapshot(snap.id, { resourceType: "database" });
      expect(dbs).toHaveLength(1);
      expect(dbs[0]!.resourceType).toBe("database");
    });
  });

  // ---------------------------------------------------------------------------
  // getSnapshotAt (closest-to-timestamp)
  // ---------------------------------------------------------------------------

  describe("getSnapshotAt", () => {
    it("should return closest snapshot at or before timestamp", async () => {
      await seedGraphState(storage, [makeNode("n1")]);

      // Create snapshots with known times
      const s1 = await temporal.createSnapshot("manual", "old");
      // s2 will be created slightly later
      const s2 = await temporal.createSnapshot("manual", "new");

      // Timestamp after both → should get latest (s2)
      const result = await temporal.getSnapshotAt(new Date(Date.now() + 10000).toISOString());
      expect(result?.id).toBe(s2.id);
    });

    it("should return null when no snapshots exist", async () => {
      const result = await temporal.getSnapshotAt(new Date().toISOString());
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // diffSnapshots
  // ---------------------------------------------------------------------------

  describe("diffSnapshots", () => {
    it("should detect added nodes", async () => {
      await seedGraphState(storage, [makeNode("n1")]);
      const s1 = await temporal.createSnapshot("manual");

      await seedGraphState(storage, [makeNode("n1"), makeNode("n2")]);
      const s2 = await temporal.createSnapshot("manual");

      const diff = await temporal.diffSnapshots(s1.id, s2.id);
      expect(diff.addedNodes).toHaveLength(1);
      expect(diff.addedNodes[0]!.id).toBe("n2");
      expect(diff.removedNodes).toHaveLength(0);
    });

    it("should detect removed nodes", async () => {
      await seedGraphState(storage, [makeNode("n1"), makeNode("n2")]);
      const s1 = await temporal.createSnapshot("manual");

      // Rebuild graph without n2
      await storage.close();
      await storage.initialize();
      await seedGraphState(storage, [makeNode("n1")]);
      const s2 = await temporal.createSnapshot("manual");

      const diff = await temporal.diffSnapshots(s1.id, s2.id);
      expect(diff.removedNodes).toHaveLength(1);
      expect(diff.removedNodes[0]!.id).toBe("n2");
      expect(diff.addedNodes).toHaveLength(0);
    });

    it("should detect changed nodes", async () => {
      await seedGraphState(storage, [makeNode("n1", { costMonthly: 100, status: "running" as GraphNodeStatus })]);
      const s1 = await temporal.createSnapshot("manual");

      await seedGraphState(storage, [makeNode("n1", { costMonthly: 200, status: "error" as GraphNodeStatus })]);
      const s2 = await temporal.createSnapshot("manual");

      const diff = await temporal.diffSnapshots(s1.id, s2.id);
      expect(diff.changedNodes).toHaveLength(1);
      expect(diff.changedNodes[0]!.nodeId).toBe("n1");
      expect(diff.changedNodes[0]!.changedFields).toContain("costMonthly");
      expect(diff.changedNodes[0]!.changedFields).toContain("status");
    });

    it("should detect edge changes", async () => {
      await seedGraphState(storage, [makeNode("n1"), makeNode("n2")]);
      const s1 = await temporal.createSnapshot("manual");

      await seedGraphState(storage, [makeNode("n1"), makeNode("n2")], [
        { id: "e1", sourceNodeId: "n1", targetNodeId: "n2" },
      ]);
      const s2 = await temporal.createSnapshot("manual");

      const diff = await temporal.diffSnapshots(s1.id, s2.id);
      expect(diff.addedEdges).toHaveLength(1);
      expect(diff.removedEdges).toHaveLength(0);
    });

    it("should compute cost delta", async () => {
      await seedGraphState(storage, [makeNode("n1", { costMonthly: 100 })]);
      const s1 = await temporal.createSnapshot("manual");

      await seedGraphState(storage, [makeNode("n1", { costMonthly: 300 })]);
      const s2 = await temporal.createSnapshot("manual");

      const diff = await temporal.diffSnapshots(s1.id, s2.id);
      expect(diff.costDelta).toBe(200);
    });

    it("should throw for unknown snapshot IDs", async () => {
      await expect(temporal.diffSnapshots("bad1", "bad2")).rejects.toThrow("Snapshot not found");
    });
  });

  // ---------------------------------------------------------------------------
  // Node history
  // ---------------------------------------------------------------------------

  describe("getNodeHistory", () => {
    it("should return history of a node across snapshots", async () => {
      // First state
      await seedGraphState(storage, [makeNode("n1", { costMonthly: 50, status: "running" as GraphNodeStatus })]);
      await temporal.createSnapshot("manual");

      // Second state
      await seedGraphState(storage, [makeNode("n1", { costMonthly: 100, status: "error" as GraphNodeStatus })]);
      await temporal.createSnapshot("manual");

      // Third state
      await seedGraphState(storage, [makeNode("n1", { costMonthly: 200, status: "error" })]);
      await temporal.createSnapshot("manual");

      const history = await temporal.getNodeHistory("n1");
      expect(history).toHaveLength(3);
      // Newest first
      expect(history[0]!.node.costMonthly).toBe(200);
      expect(history[1]!.node.costMonthly).toBe(100);
      expect(history[2]!.node.costMonthly).toBe(50);
    });

    it("should respect limit", async () => {
      for (let i = 0; i < 5; i++) {
        await seedGraphState(storage, [makeNode("n1", { costMonthly: i * 10 })]);
        await temporal.createSnapshot("manual");
      }

      const history = await temporal.getNodeHistory("n1", 2);
      expect(history).toHaveLength(2);
    });

    it("should return empty for unknown node", async () => {
      await seedGraphState(storage, [makeNode("n1")]);
      await temporal.createSnapshot("manual");

      const history = await temporal.getNodeHistory("nonexistent");
      expect(history).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Standalone functions
  // ---------------------------------------------------------------------------

  describe("takeSnapshot()", () => {
    it("should delegate to temporal storage", async () => {
      await seedGraphState(storage, [makeNode("n1")]);
      const snap = await takeSnapshot(temporal, "sync", "test label", "aws");
      expect(snap.trigger).toBe("sync");
      expect(snap.label).toBe("test label");
      expect(snap.provider).toBe("aws");
    });
  });

  describe("getTopologyAt()", () => {
    it("should return graph state at a timestamp", async () => {
      await seedGraphState(storage, [makeNode("n1"), makeNode("n2")], [
        { id: "e1", sourceNodeId: "n1", targetNodeId: "n2" },
      ]);
      await temporal.createSnapshot("manual");

      const result = await getTopologyAt(temporal, new Date(Date.now() + 1000).toISOString());
      expect(result).not.toBeNull();
      expect(result!.nodes).toHaveLength(2);
      expect(result!.edges).toHaveLength(1);
    });

    it("should filter edges to match filtered nodes", async () => {
      await seedGraphState(storage, [
        makeNode("n1", { provider: "aws" }),
        makeNode("n2", { provider: "azure" }),
      ], [
        { id: "e1", sourceNodeId: "n1", targetNodeId: "n2" },
      ]);
      await temporal.createSnapshot("manual");

      const result = await getTopologyAt(
        temporal,
        new Date(Date.now() + 1000).toISOString(),
        { provider: "aws" },
      );
      expect(result!.nodes).toHaveLength(1);
      // Edge crosses providers, so it should be filtered out
      expect(result!.edges).toHaveLength(0);
    });

    it("should return null when no snapshots exist", async () => {
      const result = await getTopologyAt(temporal, new Date().toISOString());
      expect(result).toBeNull();
    });
  });

  describe("getNodeHistory()", () => {
    it("should return node versions across snapshots", async () => {
      await seedGraphState(storage, [makeNode("n1", { costMonthly: 10 })]);
      await temporal.createSnapshot("manual");
      await seedGraphState(storage, [makeNode("n1", { costMonthly: 20 })]);
      await temporal.createSnapshot("manual");

      const history = await getNodeHistory(temporal, "n1");
      expect(history).toHaveLength(2);
    });
  });

  describe("diffSnapshots()", () => {
    it("should compute diff between two snapshot IDs", async () => {
      await seedGraphState(storage, [makeNode("n1")]);
      const s1 = await temporal.createSnapshot("manual");
      await seedGraphState(storage, [makeNode("n1"), makeNode("n2")]);
      const s2 = await temporal.createSnapshot("manual");

      const diff = await diffSnapshots(temporal, s1.id, s2.id);
      expect(diff.addedNodes).toHaveLength(1);
    });
  });

  describe("diffTimestamps()", () => {
    it("should diff between two timestamps", async () => {
      await seedGraphState(storage, [makeNode("n1")]);
      await temporal.createSnapshot("manual");

      await seedGraphState(storage, [makeNode("n1"), makeNode("n2")]);
      await temporal.createSnapshot("manual");

      const diff = await diffTimestamps(
        temporal,
        new Date(0).toISOString(),
        new Date(Date.now() + 1000).toISOString(),
      );
      expect(diff).not.toBeNull();
    });

    it("should return no-change diff for same timestamp", async () => {
      await seedGraphState(storage, [makeNode("n1")]);
      await temporal.createSnapshot("manual");

      // Both timestamps before the single snapshot → same snap
      const ts = new Date(Date.now() + 1000).toISOString();
      const diff = await diffTimestamps(temporal, ts, ts);
      expect(diff).not.toBeNull();
      expect(diff!.addedNodes).toHaveLength(0);
      expect(diff!.removedNodes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Evolution summary
  // ---------------------------------------------------------------------------

  describe("getEvolutionSummary()", () => {
    it("should return trend data across snapshots", async () => {
      // Create 3 snapshots with increasing size
      await seedGraphState(storage, [makeNode("n1", { costMonthly: 100 })]);
      await temporal.createSnapshot("manual");

      await seedGraphState(storage, [
        makeNode("n1", { costMonthly: 100 }),
        makeNode("n2", { costMonthly: 200 }),
      ]);
      await temporal.createSnapshot("sync");

      await seedGraphState(storage, [
        makeNode("n1", { costMonthly: 100 }),
        makeNode("n2", { costMonthly: 200 }),
        makeNode("n3", { costMonthly: 50 }),
      ]);
      await temporal.createSnapshot("scheduled");

      const summary = await getEvolutionSummary(temporal);

      expect(summary.snapshots).toHaveLength(3);
      expect(summary.nodeCountTrend).toHaveLength(3);
      expect(summary.costTrend).toHaveLength(3);

      // Should show net increase
      expect(summary.netChange.nodesAdded).toBe(2); // 3 - 1
      expect(summary.netChange.costDelta).toBe(250); // 350 - 100
    });

    it("should return empty trends when no snapshots", async () => {
      const summary = await getEvolutionSummary(temporal);
      expect(summary.snapshots).toHaveLength(0);
      expect(summary.netChange.nodesAdded).toBe(0);
      expect(summary.netChange.costDelta).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Retention / pruning
  // ---------------------------------------------------------------------------

  describe("pruneSnapshots", () => {
    it("should prune when exceeding maxSnapshots", async () => {
      await seedGraphState(storage, [makeNode("n1")]);

      for (let i = 0; i < 5; i++) {
        await temporal.createSnapshot("manual");
      }

      const pruned = await temporal.pruneSnapshots({ maxSnapshots: 3 });
      expect(pruned).toBe(2);

      const remaining = await temporal.listSnapshots();
      expect(remaining).toHaveLength(3);
    });

    it("should not prune when under maxSnapshots", async () => {
      await seedGraphState(storage, [makeNode("n1")]);
      await temporal.createSnapshot("manual");
      await temporal.createSnapshot("manual");

      const pruned = await temporal.pruneSnapshots({ maxSnapshots: 10 });
      expect(pruned).toBe(0);
    });

    it("should prune by age (maxAgeMs)", async () => {
      await seedGraphState(storage, [makeNode("n1")]);

      // All created "now" so nothing should be pruned with a large window
      await temporal.createSnapshot("manual");
      await temporal.createSnapshot("manual");

      const pruned = await temporal.pruneSnapshots({ maxAgeMs: 10 * 60 * 1000 }); // 10 minutes
      // Snapshots are very recent, so none pruned
      expect(pruned).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // DEFAULT_RETENTION
  // ---------------------------------------------------------------------------

  describe("DEFAULT_RETENTION", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_RETENTION.maxSnapshots).toBe(500);
      expect(DEFAULT_RETENTION.maxAgeMs).toBe(90 * 24 * 60 * 60 * 1000);
      expect(DEFAULT_RETENTION.compaction).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // syncWithSnapshot
  // ---------------------------------------------------------------------------

  describe("syncWithSnapshot()", () => {
    it("should sync, snapshot, and apply retention", async () => {
      const engine = new GraphEngine({ storage });

      const result = await syncWithSnapshot(engine, temporal, {
        label: "post-sync",
        retention: { maxSnapshots: 100 },
      });

      expect(result.snapshot.trigger).toBe("sync");
      expect(result.snapshot.label).toBe("post-sync");
      expect(result.pruned).toBe(0);
      expect(result.syncRecords).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Edge history
  // ---------------------------------------------------------------------------

  describe("getEdgeHistory", () => {
    it("should return edge history across snapshots", async () => {
      await seedGraphState(storage, [makeNode("n1"), makeNode("n2")], [
        { id: "e1", sourceNodeId: "n1", targetNodeId: "n2" },
      ]);
      await temporal.createSnapshot("manual");

      // Second snapshot (edge still present)
      await temporal.createSnapshot("manual");

      const history = await temporal.getEdgeHistory("e1");
      expect(history).toHaveLength(2);
      expect(history[0]!.edgeId).toBe("e1");
    });

    it("should return empty for unknown edge", async () => {
      const history = await temporal.getEdgeHistory("nonexistent");
      expect(history).toHaveLength(0);
    });
  });
});
