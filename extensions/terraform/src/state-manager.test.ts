/**
 * Terraform State Manager — Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TerraformStateManager, type StateDiffResult } from "./state-manager.js";
import type {
  TerraformState,
  TerraformStorage,
  TerraformWorkspace,
  StateLock,
  DriftResult,
} from "./types.js";

// ── Mock Storage ────────────────────────────────────────────────────────────────

function createMockStorage(): TerraformStorage {
  const workspaces = new Map<string, TerraformWorkspace>();
  const locks = new Map<string, StateLock>();
  const driftHistory = new Map<string, DriftResult[]>();

  return {
    initialize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    saveWorkspace: vi.fn(async (ws: TerraformWorkspace) => {
      workspaces.set(ws.id, ws);
    }),
    getWorkspace: vi.fn(async (id: string) => workspaces.get(id) ?? null),
    listWorkspaces: vi.fn(async () => [...workspaces.values()]),
    deleteWorkspace: vi.fn(async (id: string) => workspaces.delete(id) || true),
    acquireLock: vi.fn(async (lock: StateLock) => {
      if (locks.has(lock.stateId)) return false;
      locks.set(lock.stateId, lock);
      return true;
    }),
    releaseLock: vi.fn(async (stateId: string, _lockId: string) => {
      return locks.delete(stateId);
    }),
    getLock: vi.fn(async (stateId: string) => locks.get(stateId) ?? null),
    saveDriftResult: vi.fn(async (result: DriftResult) => {
      const history = driftHistory.get(result.stateId) ?? [];
      history.push(result);
      driftHistory.set(result.stateId, history);
    }),
    getDriftHistory: vi.fn(async (stateId: string, limit?: number) => {
      const history = driftHistory.get(stateId) ?? [];
      return limit ? history.slice(0, limit) : history;
    }),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<TerraformState> = {}): TerraformState {
  return {
    version: 4,
    terraform_version: "1.6.0",
    serial: 1,
    lineage: "abc-123",
    outputs: {},
    resources: [],
    ...overrides,
  };
}

function makeStateWithResources(
  resources: Array<{ type: string; name: string; attrs?: Record<string, unknown> }>,
  serial = 1,
): TerraformState {
  return makeState({
    serial,
    resources: resources.map((r) => ({
      mode: "managed" as const,
      type: r.type,
      name: r.name,
      provider: `provider["registry.terraform.io/hashicorp/${r.type.split("_")[0]}"]`,
      instances: [
        {
          schema_version: 0,
          attributes: r.attrs ?? { id: `${r.name}-id` },
        },
      ],
    })),
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("TerraformStateManager", () => {
  let storage: TerraformStorage;
  let manager: TerraformStateManager;

  beforeEach(() => {
    storage = createMockStorage();
    manager = new TerraformStateManager(storage);
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  describe("initialize / close", () => {
    it("delegates to storage", async () => {
      await manager.initialize();
      expect(storage.initialize).toHaveBeenCalled();
      await manager.close();
      expect(storage.close).toHaveBeenCalled();
    });
  });

  // ── State Parsing ─────────────────────────────────────────────────────────

  describe("parseStateJson", () => {
    it("parses state JSON and returns typed resources", () => {
      const state = makeStateWithResources([
        { type: "aws_instance", name: "web" },
        { type: "aws_s3_bucket", name: "data" },
      ]);

      const { state: parsed, resources } = manager.parseStateJson(JSON.stringify(state));
      expect(parsed.serial).toBe(1);
      expect(resources).toHaveLength(2);
      expect(resources[0]!.address).toBe("aws_instance.web");
      expect(resources[1]!.address).toBe("aws_s3_bucket.data");
    });
  });

  describe("parsePlanJson", () => {
    it("parses plan JSON and returns a summary", () => {
      const plan = {
        format_version: "1.2",
        terraform_version: "1.6.0",
        resource_changes: [
          {
            address: "aws_instance.web",
            type: "aws_instance",
            name: "web",
            provider_name: "aws",
            mode: "managed" as const,
            change: { actions: ["create" as const], before: null, after: {} },
          },
          {
            address: "aws_s3_bucket.data",
            type: "aws_s3_bucket",
            name: "data",
            provider_name: "aws",
            mode: "managed" as const,
            change: { actions: ["delete" as const], before: {}, after: null },
          },
        ],
      };

      const { summary } = manager.parsePlanJson(JSON.stringify(plan));
      expect(summary.creates).toBe(1);
      expect(summary.deletes).toBe(1);
      expect(summary.totalChanges).toBeGreaterThanOrEqual(2);
      expect(summary.hasDestructiveChanges).toBe(true);
    });
  });

  // ── State Diffing ─────────────────────────────────────────────────────────

  describe("diffStates", () => {
    it("detects added resources", () => {
      const before = makeStateWithResources([{ type: "aws_instance", name: "web" }], 1);
      const after = makeStateWithResources(
        [
          { type: "aws_instance", name: "web" },
          { type: "aws_s3_bucket", name: "data" },
        ],
        2,
      );

      const diff = manager.diffStates(before, after);
      expect(diff.additions).toBe(1);
      expect(diff.removals).toBe(0);
      expect(diff.entries.find((e) => e.action === "added")?.address).toBe("aws_s3_bucket.data");
    });

    it("detects removed resources", () => {
      const before = makeStateWithResources(
        [
          { type: "aws_instance", name: "web" },
          { type: "aws_s3_bucket", name: "data" },
        ],
        1,
      );
      const after = makeStateWithResources([{ type: "aws_instance", name: "web" }], 2);

      const diff = manager.diffStates(before, after);
      expect(diff.removals).toBe(1);
      expect(diff.entries.find((e) => e.action === "removed")?.address).toBe("aws_s3_bucket.data");
    });

    it("detects attribute changes", () => {
      const before = makeStateWithResources(
        [{ type: "aws_instance", name: "web", attrs: { id: "i-123", instance_type: "t2.micro" } }],
        1,
      );
      const after = makeStateWithResources(
        [{ type: "aws_instance", name: "web", attrs: { id: "i-123", instance_type: "t3.large" } }],
        2,
      );

      const diff = manager.diffStates(before, after);
      expect(diff.changes).toBe(1);
      const changed = diff.entries.find((e) => e.action === "changed");
      expect(changed?.changedAttributes).toBeDefined();
      expect(changed?.changedAttributes?.some((a) => a.path === "instance_type")).toBe(true);
    });

    it("returns correct serial versions", () => {
      const before = makeStateWithResources([], 5);
      const after = makeStateWithResources([], 8);

      const diff = manager.diffStates(before, after);
      expect(diff.beforeSerial).toBe(5);
      expect(diff.afterSerial).toBe(8);
    });

    it("returns empty entries for identical states", () => {
      const state = makeStateWithResources([{ type: "aws_instance", name: "web" }]);
      const diff = manager.diffStates(state, state);

      expect(diff.additions).toBe(0);
      expect(diff.removals).toBe(0);
      expect(diff.changes).toBe(0);
      expect(diff.entries).toHaveLength(0);
    });
  });

  // ── Workspace Management ──────────────────────────────────────────────────

  describe("workspace CRUD", () => {
    it("creates a workspace with defaults", async () => {
      const ws = await manager.createWorkspace({ name: "prod", statePath: "/state/prod.tfstate" });

      expect(ws.name).toBe("prod");
      expect(ws.backend).toBe("local");
      expect(ws.environment).toBe("default");
      expect(ws.id).toBeTruthy();
      expect(ws.createdAt).toBeTruthy();
      expect(storage.saveWorkspace).toHaveBeenCalled();
    });

    it("creates a workspace with custom backend", async () => {
      const ws = await manager.createWorkspace({
        name: "staging",
        statePath: "s3://bucket/staging",
        backend: "s3",
        environment: "staging",
      });

      expect(ws.backend).toBe("s3");
      expect(ws.environment).toBe("staging");
    });

    it("retrieves a workspace by ID", async () => {
      const ws = await manager.createWorkspace({ name: "dev", statePath: "/dev.tfstate" });
      const found = await manager.getWorkspace(ws.id);

      expect(found?.name).toBe("dev");
    });

    it("returns null for unknown workspace", async () => {
      const found = await manager.getWorkspace("nonexistent");
      expect(found).toBeNull();
    });

    it("lists all workspaces", async () => {
      await manager.createWorkspace({ name: "prod", statePath: "/prod" });
      await manager.createWorkspace({ name: "staging", statePath: "/staging" });

      const all = await manager.listWorkspaces();
      expect(all).toHaveLength(2);
    });

    it("deletes a workspace", async () => {
      const ws = await manager.createWorkspace({ name: "temp", statePath: "/temp" });
      await manager.deleteWorkspace(ws.id);

      expect(storage.deleteWorkspace).toHaveBeenCalledWith(ws.id);
    });
  });

  describe("touchWorkspace", () => {
    it("updates timestamps and resource count", async () => {
      const ws = await manager.createWorkspace({ name: "prod", statePath: "/prod" });
      const now = new Date().toISOString();

      const updated = await manager.touchWorkspace(ws.id, {
        lastPlanAt: now,
        resourceCount: 42,
      });

      expect(updated?.lastPlanAt).toBe(now);
      expect(updated?.resourceCount).toBe(42);
      expect(updated?.updatedAt).toBeTruthy();
    });

    it("returns null for unknown workspace", async () => {
      const result = await manager.touchWorkspace("unknown", { lastPlanAt: "now" });
      expect(result).toBeNull();
    });
  });

  // ── State Locking ─────────────────────────────────────────────────────────

  describe("state locking", () => {
    it("acquires a lock successfully", async () => {
      const lock = await manager.lockState("workspace-1", "plan", "user-1");

      expect(lock).not.toBeNull();
      expect(lock!.stateId).toBe("workspace-1");
      expect(lock!.operation).toBe("plan");
      expect(lock!.lockedBy).toBe("user-1");
    });

    it("returns null when already locked", async () => {
      await manager.lockState("workspace-1", "plan", "user-1");
      const second = await manager.lockState("workspace-1", "apply", "user-2");

      expect(second).toBeNull();
    });

    it("releases a lock", async () => {
      const lock = await manager.lockState("workspace-1", "plan", "user-1");
      const released = await manager.unlockState("workspace-1", lock!.id);

      expect(released).toBe(true);
    });

    it("gets current lock", async () => {
      const lock = await manager.lockState("workspace-1", "plan", "user-1");
      const current = await manager.getStateLock("workspace-1");

      expect(current?.id).toBe(lock!.id);
    });

    it("returns null when no lock exists", async () => {
      const current = await manager.getStateLock("unlocked-workspace");
      expect(current).toBeNull();
    });
  });

  // ── Drift Detection ───────────────────────────────────────────────────────

  describe("drift detection", () => {
    it("records drift result and updates workspace", async () => {
      const ws = await manager.createWorkspace({ name: "prod", statePath: "/prod" });

      const drift: DriftResult = {
        stateId: ws.id,
        detectedAt: new Date().toISOString(),
        totalResources: 10,
        driftedResources: [],
        errorResources: [],
        summary: {
          totalDrifted: 0,
          totalErrors: 0,
          totalClean: 10,
          byProvider: {},
          byType: {},
        },
      };

      await manager.recordDriftResult(ws.id, drift);
      expect(storage.saveDriftResult).toHaveBeenCalledWith(drift);
    });

    it("retrieves drift history", async () => {
      const drift: DriftResult = {
        stateId: "ws-1",
        detectedAt: new Date().toISOString(),
        totalResources: 5,
        driftedResources: [],
        errorResources: [],
        summary: {
          totalDrifted: 0,
          totalErrors: 0,
          totalClean: 5,
          byProvider: {},
          byType: {},
        },
      };

      await (storage as any).saveDriftResult(drift);
      const history = await manager.getDriftHistory("ws-1");
      expect(history).toHaveLength(1);
    });
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  describe("getSummary", () => {
    it("returns aggregate workspace statistics", async () => {
      await manager.createWorkspace({ name: "prod", statePath: "/prod", backend: "s3", environment: "production" });
      await manager.createWorkspace({ name: "staging", statePath: "/staging", backend: "s3", environment: "staging" });
      await manager.createWorkspace({ name: "dev", statePath: "/dev", backend: "local", environment: "development" });

      const summary = await manager.getSummary();

      expect(summary.totalWorkspaces).toBe(3);
      expect(summary.byBackend["s3"]).toBe(2);
      expect(summary.byBackend["local"]).toBe(1);
      expect(summary.workspaces).toHaveLength(3);
    });

    it("returns empty summary with no workspaces", async () => {
      const summary = await manager.getSummary();

      expect(summary.totalWorkspaces).toBe(0);
      expect(summary.totalResources).toBe(0);
      expect(summary.workspaces).toHaveLength(0);
    });
  });
});
