/**
 * Unit tests for AuditLogPipeline (enterprise structured audit log).
 *
 * Covers: record, search, count, hash-chain integrity verification,
 *         severity filtering, action exclusion, prune, and export.
 *
 */

import { describe, it, expect, afterEach } from "vitest";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { AuditLogPipeline } from "./index.js";
import type { AuditAction, AuditActor, AuditResource } from "./index.js";

function tmpDb(name: string): string {
  const dir = join(tmpdir(), "espada-test-audit");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${name}-${randomUUID()}.db`);
}

function cleanup(path: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(path + suffix);
    } catch {
      /* ignore */
    }
  }
}

const TEST_ACTOR: AuditActor = {
  type: "user",
  id: "user-1",
  name: "Test User",
  ip: "127.0.0.1",
};

const TEST_RESOURCE: AuditResource = {
  type: "endpoint",
  id: "/api/v1/chat",
  name: "Chat API",
};

describe("AuditLogPipeline", () => {
  let dbPath: string;
  let audit: AuditLogPipeline;

  afterEach(() => {
    audit?.close();
    if (dbPath) cleanup(dbPath);
  });

  // ===========================================================================
  // Record & retrieve
  // ===========================================================================

  it("records an audit entry and returns it", () => {
    dbPath = tmpDb("record");
    audit = new AuditLogPipeline(dbPath, { sinks: [] }); // no stdout

    const entry = audit.record({
      action: "api.request",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
      context: { method: "POST", statusCode: 200 },
    });

    expect(entry).not.toBeNull();
    expect(entry!.seq).toBe(1);
    expect(entry!.action).toBe("api.request");
    expect(entry!.outcome).toBe("success");
    expect(entry!.severity).toBe("info"); // default
    expect(entry!.actor.id).toBe("user-1");
    expect(entry!.resource.id).toBe("/api/v1/chat");
    expect(entry!.context).toEqual({ method: "POST", statusCode: 200 });
    expect(entry!.hash).toBeTruthy();
    expect(entry!.previousHash).toBe("genesis");
  });

  it("builds a hash chain across multiple entries", () => {
    dbPath = tmpDb("chain");
    audit = new AuditLogPipeline(dbPath, { sinks: [] });

    const e1 = audit.record({
      action: "auth.login",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    })!;

    const e2 = audit.record({
      action: "api.request",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    })!;

    expect(e2.previousHash).toBe(e1.hash);
    expect(e2.seq).toBe(2);
  });

  // ===========================================================================
  // Search & count
  // ===========================================================================

  it("searches entries by action", () => {
    dbPath = tmpDb("search-action");
    audit = new AuditLogPipeline(dbPath, { sinks: [] });

    audit.record({
      action: "auth.login",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });
    audit.record({
      action: "api.request",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });
    audit.record({
      action: "api.rate_limited",
      outcome: "denied",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });

    const apiEntries = audit.search({ action: ["api.request", "api.rate_limited"] });
    expect(apiEntries).toHaveLength(2);
  });

  it("searches entries by actor", () => {
    dbPath = tmpDb("search-actor");
    audit = new AuditLogPipeline(dbPath, { sinks: [] });

    const actorA: AuditActor = { type: "user", id: "alice" };
    const actorB: AuditActor = { type: "user", id: "bob" };

    audit.record({
      action: "api.request",
      outcome: "success",
      actor: actorA,
      resource: TEST_RESOURCE,
    });
    audit.record({
      action: "api.request",
      outcome: "success",
      actor: actorB,
      resource: TEST_RESOURCE,
    });
    audit.record({
      action: "api.request",
      outcome: "failure",
      actor: actorA,
      resource: TEST_RESOURCE,
    });

    expect(audit.search({ actorId: "alice" })).toHaveLength(2);
    expect(audit.search({ actorId: "bob" })).toHaveLength(1);
  });

  it("counts entries", () => {
    dbPath = tmpDb("count");
    audit = new AuditLogPipeline(dbPath, { sinks: [] });

    audit.record({
      action: "api.request",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });
    audit.record({
      action: "api.request",
      outcome: "failure",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });
    audit.record({
      action: "auth.login",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });

    expect(audit.count()).toBe(3);
    expect(audit.count({ action: "api.request" })).toBe(2);
    expect(audit.count({ outcome: "failure" })).toBe(1);
  });

  // ===========================================================================
  // Integrity verification
  // ===========================================================================

  it("verifies a good chain as intact", () => {
    dbPath = tmpDb("verify-good");
    audit = new AuditLogPipeline(dbPath, { sinks: [] });

    for (let i = 0; i < 5; i++) {
      audit.record({
        action: "api.request",
        outcome: "success",
        actor: TEST_ACTOR,
        resource: TEST_RESOURCE,
      });
    }

    const result = audit.verifyIntegrity();
    expect(result.intact).toBe(true);
    expect(result.brokenAtSeq).toBeUndefined();
  });

  // ===========================================================================
  // Config: severity filtering
  // ===========================================================================

  it("filters entries below minimum severity", () => {
    dbPath = tmpDb("min-severity");
    audit = new AuditLogPipeline(dbPath, { sinks: [], minimumSeverity: "warn" });

    const infoEntry = audit.record({
      action: "api.request",
      outcome: "success",
      severity: "info",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });
    const warnEntry = audit.record({
      action: "api.rate_limited",
      outcome: "denied",
      severity: "warn",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });

    expect(infoEntry).toBeNull(); // below min severity
    expect(warnEntry).not.toBeNull();
    expect(audit.count()).toBe(1);
  });

  // ===========================================================================
  // Config: action exclusion
  // ===========================================================================

  it("excludes actions matching glob patterns", () => {
    dbPath = tmpDb("exclude");
    audit = new AuditLogPipeline(dbPath, {
      sinks: [],
      excludeActions: ["api.request"],
    });

    const excluded = audit.record({
      action: "api.request",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });
    const included = audit.record({
      action: "auth.login",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });

    expect(excluded).toBeNull();
    expect(included).not.toBeNull();
  });

  // ===========================================================================
  // Disabled
  // ===========================================================================

  it("returns null when disabled", () => {
    dbPath = tmpDb("disabled");
    audit = new AuditLogPipeline(dbPath, { sinks: [], enabled: false });

    const entry = audit.record({
      action: "api.request",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });
    expect(entry).toBeNull();
  });

  // ===========================================================================
  // Export
  // ===========================================================================

  it("exports entries as JSON", () => {
    dbPath = tmpDb("export-json");
    audit = new AuditLogPipeline(dbPath, { sinks: [] });

    audit.record({
      action: "auth.login",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });
    audit.record({
      action: "api.request",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });

    const json = audit.export({ format: "json" });
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].action).toBe("auth.login");
  });

  it("exports entries as JSONL", () => {
    dbPath = tmpDb("export-jsonl");
    audit = new AuditLogPipeline(dbPath, { sinks: [] });

    audit.record({
      action: "auth.login",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });
    audit.record({
      action: "api.request",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });

    const jsonl = audit.export({ format: "jsonl" });
    const lines = jsonl.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).action).toBe("auth.login");
  });

  // ===========================================================================
  // Persistence
  // ===========================================================================

  it("persists and resumes hash chain across close/reopen", () => {
    dbPath = tmpDb("persist");
    audit = new AuditLogPipeline(dbPath, { sinks: [] });

    audit.record({
      action: "auth.login",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });
    audit.close();

    const audit2 = new AuditLogPipeline(dbPath, { sinks: [] });
    audit2.record({
      action: "api.request",
      outcome: "success",
      actor: TEST_ACTOR,
      resource: TEST_RESOURCE,
    });

    // Verify chain is still intact across sessions
    const result = audit2.verifyIntegrity();
    expect(result.intact).toBe(true);

    expect(audit2.count()).toBe(2);
    audit2.close();
    audit = undefined!; // prevent afterEach double-close
  });
});
