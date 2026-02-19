/**
 * Terraform State Manager
 *
 * High-level state operations: parsing, diffing, workspace management,
 * state locking, and Knowledge Graph synchronization. Orchestrates
 * between parser.ts (low-level parsing), graph-bridge.ts (KG sync),
 * and storage.ts (persistence).
 */

import type {
  TerraformState,
  TerraformWorkspace,
  WorkspaceInput,
  ParsedResource,
  DriftResult,
  StateLock,
  TerraformStorage,
  PlanSummary,
  TerraformPlan,
} from "./types.js";
import { parseState, parsePlan, buildDriftResult } from "./parser.js";
import { randomUUID } from "node:crypto";

// =============================================================================
// State Diff
// =============================================================================

/** A resource-level change between two states. */
export interface StateDiffEntry {
  address: string;
  type: string;
  provider: string;
  action: "added" | "removed" | "changed";
  changedAttributes?: Array<{
    path: string;
    before: unknown;
    after: unknown;
  }>;
}

/** Result of comparing two Terraform states. */
export interface StateDiffResult {
  beforeSerial: number;
  afterSerial: number;
  beforeVersion: string;
  afterVersion: string;
  additions: number;
  removals: number;
  changes: number;
  entries: StateDiffEntry[];
}

// =============================================================================
// TerraformStateManager
// =============================================================================

export class TerraformStateManager {
  private storage: TerraformStorage;

  constructor(storage: TerraformStorage) {
    this.storage = storage;
  }

  /** Initialize the storage backend. */
  async initialize(): Promise<void> {
    await this.storage.initialize();
  }

  /** Close storage connections. */
  async close(): Promise<void> {
    await this.storage.close();
  }

  // ---------------------------------------------------------------------------
  // State Parsing
  // ---------------------------------------------------------------------------

  /**
   * Parse a raw Terraform state JSON string into typed resources.
   */
  parseStateJson(stateJson: string): { state: TerraformState; resources: ParsedResource[] } {
    const state: TerraformState = JSON.parse(stateJson);
    const resources = parseState(state);
    return { state, resources };
  }

  /**
   * Parse and summarize a Terraform plan JSON.
   */
  parsePlanJson(planJson: string): { plan: TerraformPlan; summary: PlanSummary } {
    const plan: TerraformPlan = JSON.parse(planJson);
    const summary = parsePlan(plan);
    return { plan, summary };
  }

  // ---------------------------------------------------------------------------
  // State Diffing
  // ---------------------------------------------------------------------------

  /**
   * Compare two Terraform states and return resource-level differences.
   */
  diffStates(before: TerraformState, after: TerraformState): StateDiffResult {
    const beforeResources = parseState(before);
    const afterResources = parseState(after);

    const beforeMap = new Map(beforeResources.map((r) => [r.address, r]));
    const afterMap = new Map(afterResources.map((r) => [r.address, r]));

    const entries: StateDiffEntry[] = [];

    // Resources added in after
    for (const [addr, resource] of afterMap) {
      if (!beforeMap.has(addr)) {
        entries.push({
          address: addr,
          type: resource.type,
          provider: resource.providerShort,
          action: "added",
        });
      }
    }

    // Resources removed from before
    for (const [addr, resource] of beforeMap) {
      if (!afterMap.has(addr)) {
        entries.push({
          address: addr,
          type: resource.type,
          provider: resource.providerShort,
          action: "removed",
        });
      }
    }

    // Resources in both — check for attribute changes
    for (const [addr, beforeRes] of beforeMap) {
      const afterRes = afterMap.get(addr);
      if (!afterRes) continue;

      const changedAttrs = diffAttributes(beforeRes.attributes, afterRes.attributes);
      if (changedAttrs.length > 0) {
        entries.push({
          address: addr,
          type: beforeRes.type,
          provider: beforeRes.providerShort,
          action: "changed",
          changedAttributes: changedAttrs,
        });
      }
    }

    return {
      beforeSerial: before.serial,
      afterSerial: after.serial,
      beforeVersion: before.terraform_version,
      afterVersion: after.terraform_version,
      additions: entries.filter((e) => e.action === "added").length,
      removals: entries.filter((e) => e.action === "removed").length,
      changes: entries.filter((e) => e.action === "changed").length,
      entries,
    };
  }

  // ---------------------------------------------------------------------------
  // Workspace Management
  // ---------------------------------------------------------------------------

  /**
   * Register a new workspace.
   */
  async createWorkspace(input: WorkspaceInput): Promise<TerraformWorkspace> {
    const workspace: TerraformWorkspace = {
      id: input.id ?? randomUUID(),
      name: input.name,
      statePath: input.statePath,
      backend: input.backend ?? "local",
      environment: input.environment ?? "default",
      resourceCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.storage.saveWorkspace(workspace);
    return workspace;
  }

  /**
   * Get a workspace by ID.
   */
  async getWorkspace(id: string): Promise<TerraformWorkspace | null> {
    return this.storage.getWorkspace(id);
  }

  /**
   * List all registered workspaces.
   */
  async listWorkspaces(): Promise<TerraformWorkspace[]> {
    return this.storage.listWorkspaces();
  }

  /**
   * Delete a workspace.
   */
  async deleteWorkspace(id: string): Promise<boolean> {
    return this.storage.deleteWorkspace(id);
  }

  /**
   * Update a workspace after a plan/apply/drift check.
   */
  async touchWorkspace(
    id: string,
    update: { lastPlanAt?: string; lastApplyAt?: string; lastDriftCheckAt?: string; resourceCount?: number },
  ): Promise<TerraformWorkspace | null> {
    const workspace = await this.storage.getWorkspace(id);
    if (!workspace) return null;

    const updated: TerraformWorkspace = {
      ...workspace,
      ...update,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.saveWorkspace(updated);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // State Locking
  // ---------------------------------------------------------------------------

  /**
   * Acquire a state lock for a workspace (prevents concurrent modifications).
   */
  async lockState(
    stateId: string,
    operation: string,
    lockedBy: string,
  ): Promise<StateLock | null> {
    const existing = await this.storage.getLock(stateId);
    if (existing) return null; // Already locked

    const lock: StateLock = {
      id: randomUUID(),
      stateId,
      operation,
      lockedBy,
      lockedAt: new Date().toISOString(),
    };

    const acquired = await this.storage.acquireLock(lock);
    return acquired ? lock : null;
  }

  /**
   * Release a state lock.
   */
  async unlockState(stateId: string, lockId: string): Promise<boolean> {
    return this.storage.releaseLock(stateId, lockId);
  }

  /**
   * Get the current lock for a state (if any).
   */
  async getStateLock(stateId: string): Promise<StateLock | null> {
    return this.storage.getLock(stateId);
  }

  // ---------------------------------------------------------------------------
  // Drift Detection
  // ---------------------------------------------------------------------------

  /**
   * Record a drift detection result and update the workspace.
   */
  async recordDriftResult(
    workspaceId: string,
    result: DriftResult,
  ): Promise<void> {
    await this.storage.saveDriftResult(result);
    await this.touchWorkspace(workspaceId, {
      lastDriftCheckAt: result.detectedAt,
    });
  }

  /**
   * Get drift history for a workspace.
   */
  async getDriftHistory(stateId: string, limit?: number): Promise<DriftResult[]> {
    return this.storage.getDriftHistory(stateId, limit);
  }

  /**
   * Build a drift result by comparing expected resources to actual attributes.
   */
  buildDriftResult(
    stateId: string,
    expectedResources: ParsedResource[],
    actualAttributes: Map<string, Record<string, unknown>>,
  ): DriftResult {
    return buildDriftResult(stateId, expectedResources, actualAttributes);
  }

  // ---------------------------------------------------------------------------
  // Summary & Statistics
  // ---------------------------------------------------------------------------

  /**
   * Generate a summary of all workspaces and their state.
   */
  async getSummary(): Promise<WorkspaceSummary> {
    const workspaces = await this.storage.listWorkspaces();

    let totalResources = 0;
    const byBackend: Record<string, number> = {};
    const byEnvironment: Record<string, number> = {};

    for (const ws of workspaces) {
      totalResources += ws.resourceCount;
      byBackend[ws.backend] = (byBackend[ws.backend] ?? 0) + 1;
      byEnvironment[ws.environment] = (byEnvironment[ws.environment] ?? 0) + 1;
    }

    return {
      totalWorkspaces: workspaces.length,
      totalResources,
      byBackend,
      byEnvironment,
      workspaces: workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        backend: ws.backend,
        environment: ws.environment,
        resourceCount: ws.resourceCount,
        lastPlanAt: ws.lastPlanAt,
        lastApplyAt: ws.lastApplyAt,
        lastDriftCheckAt: ws.lastDriftCheckAt,
      })),
    };
  }
}

// =============================================================================
// Types
// =============================================================================

export interface WorkspaceSummary {
  totalWorkspaces: number;
  totalResources: number;
  byBackend: Record<string, number>;
  byEnvironment: Record<string, number>;
  workspaces: Array<{
    id: string;
    name: string;
    backend: string;
    environment: string;
    resourceCount: number;
    lastPlanAt?: string;
    lastApplyAt?: string;
    lastDriftCheckAt?: string;
  }>;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Diff two attribute objects and return changed fields.
 */
function diffAttributes(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  prefix = "",
): Array<{ path: string; before: unknown; after: unknown }> {
  const diffs: Array<{ path: string; before: unknown; after: unknown }> = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const bVal = before[key];
    const aVal = after[key];

    if (bVal === aVal) continue;

    if (
      typeof bVal === "object" &&
      typeof aVal === "object" &&
      bVal !== null &&
      aVal !== null &&
      !Array.isArray(bVal) &&
      !Array.isArray(aVal)
    ) {
      diffs.push(
        ...diffAttributes(
          bVal as Record<string, unknown>,
          aVal as Record<string, unknown>,
          path,
        ),
      );
    } else if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
      diffs.push({ path, before: bVal, after: aVal });
    }
  }

  return diffs;
}
