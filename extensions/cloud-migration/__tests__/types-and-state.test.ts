/**
 * Cross-Cloud Migration Engine — Core Types & State Tests
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  createEmptyDiagnostics,
  createInitialPluginState,
  isValidPhaseTransition,
  MIGRATION_PHASE_TRANSITIONS,
  type MigrationPhase,
} from "../src/types.js";

import {
  getPluginState,
  resetPluginState,
  resetDiagnostics,
  getDiagnosticsSnapshot,
} from "../src/state.js";

// =============================================================================
// types.ts
// =============================================================================
describe("types", () => {
  describe("createEmptyDiagnostics", () => {
    it("returns all counters at zero", () => {
      const d = createEmptyDiagnostics();
      expect(d.jobsCreated).toBe(0);
      expect(d.jobsCompleted).toBe(0);
      expect(d.jobsFailed).toBe(0);
      expect(d.jobsRolledBack).toBe(0);
      expect(d.stepsExecuted).toBe(0);
      expect(d.stepsSucceeded).toBe(0);
      expect(d.stepsFailed).toBe(0);
      expect(d.integrityChecks).toBe(0);
      expect(d.integrityPassed).toBe(0);
      expect(d.integrityFailed).toBe(0);
      expect(d.totalBytesTransferred).toBe(0);
      expect(d.gatewayAttempts).toBe(0);
      expect(d.gatewaySuccesses).toBe(0);
      expect(d.gatewayFailures).toBe(0);
      expect(d.lastError).toBeNull();
    });

    it("returns independent instances", () => {
      const a = createEmptyDiagnostics();
      const b = createEmptyDiagnostics();
      a.jobsCreated = 5;
      expect(b.jobsCreated).toBe(0);
    });
  });

  describe("createInitialPluginState", () => {
    it("returns state with empty collections", () => {
      const s = createInitialPluginState();
      expect(s.jobs.size).toBe(0);
      expect(s.activeJobCount).toBe(0);
      expect(s.stepHandlers.size).toBe(0);
      expect(s.eventListeners.size).toBe(0);
      expect(s.diagnostics.jobsCreated).toBe(0);
    });
  });

  describe("MIGRATION_PHASE_TRANSITIONS", () => {
    it("has entries for all 11 phases", () => {
      const phases: MigrationPhase[] = [
        "created", "assessing", "planning", "awaiting-approval",
        "executing", "verifying", "cutting-over", "completed",
        "rolling-back", "rolled-back", "failed",
      ];
      for (const p of phases) {
        expect(MIGRATION_PHASE_TRANSITIONS[p]).toBeDefined();
      }
    });

    it("completed and rolled-back and failed are terminal", () => {
      expect(MIGRATION_PHASE_TRANSITIONS.completed).toEqual([]);
      expect(MIGRATION_PHASE_TRANSITIONS["rolled-back"]).toEqual([]);
      expect(MIGRATION_PHASE_TRANSITIONS.failed).toEqual([]);
    });

    it("executing can transition to verifying, rolling-back, or failed", () => {
      const allowed = MIGRATION_PHASE_TRANSITIONS.executing;
      expect(allowed).toContain("verifying");
      expect(allowed).toContain("rolling-back");
      expect(allowed).toContain("failed");
    });
  });

  describe("isValidPhaseTransition", () => {
    it("allows created → assessing", () => {
      expect(isValidPhaseTransition("created", "assessing")).toBe(true);
    });

    it("rejects created → executing", () => {
      expect(isValidPhaseTransition("created", "executing")).toBe(false);
    });

    it("rejects completed → anything", () => {
      expect(isValidPhaseTransition("completed", "assessing")).toBe(false);
      expect(isValidPhaseTransition("completed", "failed")).toBe(false);
    });

    it("allows rolling-back → rolled-back", () => {
      expect(isValidPhaseTransition("rolling-back", "rolled-back")).toBe(true);
    });

    it("allows rolling-back → failed", () => {
      expect(isValidPhaseTransition("rolling-back", "failed")).toBe(true);
    });

    it("rejects rolled-back → any phase", () => {
      expect(isValidPhaseTransition("rolled-back", "created")).toBe(false);
    });
  });
});

// =============================================================================
// state.ts
// =============================================================================
describe("state", () => {
  beforeEach(() => {
    resetPluginState();
  });

  describe("getPluginState", () => {
    it("returns the singleton state", () => {
      const s1 = getPluginState();
      const s2 = getPluginState();
      expect(s1).toBe(s2);
    });

    it("has empty collections after reset", () => {
      const s = getPluginState();
      expect(s.jobs.size).toBe(0);
      expect(s.activeJobCount).toBe(0);
    });
  });

  describe("resetPluginState", () => {
    it("clears jobs and diagnostics", () => {
      const s = getPluginState();
      s.jobs.set("test", {} as never);
      s.diagnostics.jobsCreated = 10;
      resetPluginState();
      const fresh = getPluginState();
      expect(fresh.jobs.size).toBe(0);
      expect(fresh.diagnostics.jobsCreated).toBe(0);
    });
  });

  describe("resetDiagnostics", () => {
    it("resets only diagnostics, preserves jobs", () => {
      const s = getPluginState();
      s.jobs.set("test", {} as never);
      s.diagnostics.jobsCreated = 10;
      resetDiagnostics();
      expect(getPluginState().jobs.size).toBe(1);
      expect(getPluginState().diagnostics.jobsCreated).toBe(0);
    });
  });

  describe("getDiagnosticsSnapshot", () => {
    it("returns a copy, not the original", () => {
      const snap = getDiagnosticsSnapshot();
      (snap as any).jobsCreated = 999;
      expect(getPluginState().diagnostics.jobsCreated).toBe(0);
    });
  });
});
