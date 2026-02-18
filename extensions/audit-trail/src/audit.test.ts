/**
 * Persistent Audit Trail — Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AuditLogger } from "./logger.js";
import { InMemoryAuditStorage } from "./memory-store.js";
import type { AuditEvent, AuditEventInput, AuditActor, AuditStorage } from "./types.js";
import { REDACTED } from "./types.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeActor(overrides?: Partial<AuditActor>): AuditActor {
  return { id: "user-1", name: "Test User", roles: ["admin"], ...overrides };
}

function makeEvent(overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    eventType: "command_executed",
    severity: "info",
    actor: makeActor(),
    operation: "test:command",
    result: "success",
    ...overrides,
  };
}

function createLogger(config?: { retentionDays?: number; flushIntervalMs?: number }): {
  logger: AuditLogger;
  storage: AuditStorage;
} {
  const storage = new InMemoryAuditStorage();
  const logger = new AuditLogger(storage, {
    storage: { type: "memory" },
    retentionDays: config?.retentionDays ?? 90,
    flushIntervalMs: config?.flushIntervalMs ?? 0, // Disable timer in tests
    maxBufferSize: 100,
    sensitiveFields: ["password", "secret", "token", "apiKey", "authorization"],
  });
  return { logger, storage };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AuditLogger", () => {
  let logger: AuditLogger;
  let storage: AuditStorage;

  beforeEach(async () => {
    const created = createLogger();
    logger = created.logger;
    storage = created.storage;
    await storage.initialize();
  });

  afterEach(() => {
    logger.close();
  });

  // ─── Core logging ──────────────────────────────────────────────────────

  it("logs an event and assigns id + timestamp", () => {
    const event = logger.log(makeEvent());
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeDefined();
    expect(event.eventType).toBe("command_executed");
    expect(event.result).toBe("success");
  });

  it("persists events after flush", () => {
    logger.log(makeEvent());
    logger.log(makeEvent({ operation: "test:second" }));
    logger.flush();

    const events = logger.query({});
    expect(events.length).toBe(2);
  });

  it("auto-flushes when buffer is full", () => {
    const { logger: smallLogger, storage: smallStorage } = createLogger();
    // Override maxBufferSize to be small
    const tinyLogger = new AuditLogger(smallStorage, {
      storage: { type: "memory" },
      retentionDays: 90,
      flushIntervalMs: 0,
      maxBufferSize: 3,
      sensitiveFields: ["password"],
    });

    tinyLogger.log(makeEvent());
    tinyLogger.log(makeEvent());
    tinyLogger.log(makeEvent()); // Should trigger auto-flush at 3

    // The buffer should have been flushed to storage
    expect(smallStorage.getEventCount()).toBe(3);
    tinyLogger.close();
  });

  // ─── Convenience methods ───────────────────────────────────────────────

  it("logs tool invocations", () => {
    const event = logger.logToolInvocation(
      makeActor(),
      "kg_blast_radius",
      { resourceId: "aws:123:us-east-1:ec2:i-abc" },
      "success",
      150,
    );
    logger.flush();

    expect(event.eventType).toBe("tool_invoked");
    expect(event.operation).toBe("tool:kg_blast_radius");
    expect(event.durationMs).toBe(150);
  });

  it("logs commands", () => {
    const event = logger.logCommand(makeActor(), "graph status", { verbose: true }, "success", 42);
    logger.flush();

    expect(event.eventType).toBe("command_executed");
    expect(event.operation).toBe("command:graph status");
  });

  it("logs auth events", () => {
    const loginEvent = logger.logAuth(makeActor(), "login", "oidc");
    expect(loginEvent.eventType).toBe("auth_login");
    expect(loginEvent.result).toBe("success");

    const failEvent = logger.logAuth(makeActor(), "failed", "password");
    expect(failEvent.eventType).toBe("auth_failed");
    expect(failEvent.severity).toBe("warn");
    expect(failEvent.result).toBe("failure");
  });

  it("logs resource changes", () => {
    const event = logger.logResourceChange(
      makeActor(),
      "created",
      { type: "ec2-instance", id: "i-abc123", provider: "aws" },
      { instanceType: "t3.medium" },
    );
    logger.flush();

    expect(event.eventType).toBe("resource_created");
    expect(event.resource?.type).toBe("ec2-instance");
  });

  it("logs policy evaluations", () => {
    const event = logger.logPolicyEvaluation(
      makeActor(),
      "deny-public-s3",
      { type: "s3-bucket", id: "my-bucket", provider: "aws" },
      "denied",
      { violations: ["public access enabled"] },
    );
    logger.flush();

    expect(event.eventType).toBe("policy_evaluated");
    expect(event.result).toBe("denied");
    expect(event.severity).toBe("warn");
  });

  it("logs config changes", () => {
    const event = logger.logConfigChange(makeActor(), "gateway.port", 8080, 9090);
    logger.flush();

    expect(event.eventType).toBe("config_changed");
    expect(event.severity).toBe("warn");
  });

  it("logs terraform operations", () => {
    const event = logger.logTerraform(
      makeActor(),
      "apply",
      { resourceCount: 5, plan: "plan-123" },
      "success",
      3200,
    );
    logger.flush();

    expect(event.eventType).toBe("terraform_apply");
    expect(event.severity).toBe("warn");
    expect(event.durationMs).toBe(3200);
  });

  // ─── Sensitive field redaction ─────────────────────────────────────────

  it("redacts sensitive fields in parameters", () => {
    const event = logger.log(
      makeEvent({
        parameters: {
          username: "admin",
          password: "supersecret",
          apiKey: "key-12345",
          normalField: "visible",
        },
      }),
    );

    expect(event.parameters?.username).toBe("admin");
    expect(event.parameters?.password).toBe(REDACTED);
    expect(event.parameters?.apiKey).toBe(REDACTED);
    expect(event.parameters?.normalField).toBe("visible");
  });

  it("redacts nested sensitive fields", () => {
    const event = logger.log(
      makeEvent({
        parameters: {
          config: {
            host: "db.example.com",
            secretKey: "my-secret",
          },
        },
      }),
    );

    const config = event.parameters?.config as Record<string, unknown>;
    expect(config.host).toBe("db.example.com");
    expect(config.secretKey).toBe(REDACTED);
  });

  it("redacts sensitive metadata", () => {
    const event = logger.log(
      makeEvent({
        metadata: {
          authorization: "Bearer xxx",
          source: "webhook",
        },
      }),
    );

    expect(event.metadata?.authorization).toBe(REDACTED);
    expect(event.metadata?.source).toBe("webhook");
  });

  // ─── Querying ──────────────────────────────────────────────────────────

  it("queries by event type", () => {
    logger.log(makeEvent({ eventType: "command_executed" }));
    logger.log(makeEvent({ eventType: "tool_invoked" }));
    logger.log(makeEvent({ eventType: "auth_login" }));
    logger.flush();

    const tools = logger.query({ eventTypes: ["tool_invoked"] });
    expect(tools.length).toBe(1);
    expect(tools[0].eventType).toBe("tool_invoked");
  });

  it("queries by severity", () => {
    logger.log(makeEvent({ severity: "info" }));
    logger.log(makeEvent({ severity: "warn" }));
    logger.log(makeEvent({ severity: "critical" }));
    logger.flush();

    const critical = logger.query({ severity: ["critical"] });
    expect(critical.length).toBe(1);
  });

  it("queries by actor", () => {
    logger.log(makeEvent({ actor: makeActor({ id: "alice" }) }));
    logger.log(makeEvent({ actor: makeActor({ id: "bob" }) }));
    logger.log(makeEvent({ actor: makeActor({ id: "alice" }) }));
    logger.flush();

    const alice = logger.query({ actorIds: ["alice"] });
    expect(alice.length).toBe(2);
  });

  it("queries by date range", () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400_000);
    const twoDaysAgo = new Date(now.getTime() - 172800_000);

    logger.log(makeEvent({ timestamp: twoDaysAgo.toISOString() }));
    logger.log(makeEvent({ timestamp: yesterday.toISOString() }));
    logger.log(makeEvent({ timestamp: now.toISOString() }));
    logger.flush();

    const recent = logger.query({
      startDate: yesterday.toISOString(),
    });
    expect(recent.length).toBe(2);
  });

  it("queries by correlation ID", () => {
    logger.log(makeEvent({ correlationId: "corr-1" }));
    logger.log(makeEvent({ correlationId: "corr-2" }));
    logger.log(makeEvent({ correlationId: "corr-1" }));
    logger.flush();

    const correlated = logger.query({ correlationId: "corr-1" });
    expect(correlated.length).toBe(2);
  });

  it("queries by result", () => {
    logger.log(makeEvent({ result: "success" }));
    logger.log(makeEvent({ result: "failure" }));
    logger.log(makeEvent({ result: "denied" }));
    logger.flush();

    const failures = logger.query({ result: ["failure", "denied"] });
    expect(failures.length).toBe(2);
  });

  it("queries with operation search", () => {
    logger.log(makeEvent({ operation: "terraform:plan" }));
    logger.log(makeEvent({ operation: "terraform:apply" }));
    logger.log(makeEvent({ operation: "graph:status" }));
    logger.flush();

    const tf = logger.query({ operation: "terraform" });
    expect(tf.length).toBe(2);
  });

  it("limits results", () => {
    for (let i = 0; i < 10; i++) {
      logger.log(makeEvent({ operation: `op-${i}` }));
    }
    logger.flush();

    const limited = logger.query({ limit: 5 });
    expect(limited.length).toBe(5);
  });

  it("returns events in descending timestamp order", () => {
    const t1 = "2025-01-01T00:00:00Z";
    const t2 = "2025-01-02T00:00:00Z";
    const t3 = "2025-01-03T00:00:00Z";

    logger.log(makeEvent({ timestamp: t2 }));
    logger.log(makeEvent({ timestamp: t1 }));
    logger.log(makeEvent({ timestamp: t3 }));
    logger.flush();

    const events = logger.query({});
    expect(events[0].timestamp).toBe(t3);
    expect(events[1].timestamp).toBe(t2);
    expect(events[2].timestamp).toBe(t1);
  });

  // ─── Timeline ──────────────────────────────────────────────────────────

  it("returns resource timeline", () => {
    const resource = { type: "ec2", id: "i-abc", provider: "aws" };
    logger.logResourceChange(makeActor(), "created", resource);
    logger.logResourceChange(makeActor(), "updated", resource);
    logger.logResourceChange(makeActor(), "updated", resource);
    logger.log(makeEvent({ resource: { type: "s3", id: "other-bucket" } }));
    logger.flush();

    const timeline = logger.getTimeline("i-abc");
    expect(timeline.events.length).toBe(3);
    expect(timeline.resourceId).toBe("i-abc");
    expect(timeline.resourceType).toBe("ec2");
    expect(timeline.firstSeen).toBeDefined();
    expect(timeline.lastSeen).toBeDefined();
  });

  // ─── Actor Activity ────────────────────────────────────────────────────

  it("returns actor activity", () => {
    logger.log(makeEvent({ actor: makeActor({ id: "alice", name: "Alice" }) }));
    logger.log(makeEvent({ actor: makeActor({ id: "alice", name: "Alice" }) }));
    logger.log(makeEvent({ actor: makeActor({ id: "bob", name: "Bob" }) }));
    logger.flush();

    const activity = logger.getActorActivity("alice");
    expect(activity.length).toBe(2);
  });

  // ─── Summary ───────────────────────────────────────────────────────────

  it("generates accurate summary", () => {
    const start = "2025-01-01T00:00:00Z";
    const end = "2025-12-31T23:59:59Z";

    logger.log(makeEvent({ timestamp: "2025-06-01T00:00:00Z", eventType: "command_executed", severity: "info", result: "success" }));
    logger.log(makeEvent({ timestamp: "2025-06-02T00:00:00Z", eventType: "tool_invoked", severity: "info", result: "success" }));
    logger.log(makeEvent({ timestamp: "2025-06-03T00:00:00Z", eventType: "auth_failed", severity: "warn", result: "failure" }));
    logger.log(makeEvent({ timestamp: "2025-06-04T00:00:00Z", eventType: "break_glass_activated", severity: "critical", result: "success" }));
    logger.flush();

    const summary = logger.getSummary(start, end);
    expect(summary.totalEvents).toBe(4);
    expect(summary.bySeverity.info).toBe(2);
    expect(summary.bySeverity.warn).toBe(1);
    expect(summary.bySeverity.critical).toBe(1);
    expect(summary.byResult.success).toBe(3);
    expect(summary.byResult.failure).toBe(1);
    expect(summary.byType.command_executed).toBe(1);
    expect(summary.byType.tool_invoked).toBe(1);
  });

  // ─── Event Count ───────────────────────────────────────────────────────

  it("tracks event count including buffer", () => {
    expect(logger.getEventCount()).toBe(0);
    logger.log(makeEvent());
    logger.log(makeEvent());
    // Before flush, buffer count included
    expect(logger.getEventCount()).toBe(2);
    logger.flush();
    expect(logger.getEventCount()).toBe(2);
  });

  // ─── Get by ID ─────────────────────────────────────────────────────────

  it("retrieves event by ID", () => {
    const event = logger.log(makeEvent({ operation: "special-op" }));
    logger.flush();

    const found = logger.getById(event.id);
    expect(found).toBeDefined();
    expect(found?.operation).toBe("special-op");
  });

  it("returns undefined for non-existent event", () => {
    logger.flush();
    const found = logger.getById("non-existent-id");
    expect(found).toBeUndefined();
  });

  // ─── Pruning ───────────────────────────────────────────────────────────

  it("prunes old events", () => {
    const old = new Date(Date.now() - 200 * 86400_000); // 200 days ago
    const recent = new Date();

    logger.log(makeEvent({ timestamp: old.toISOString() }));
    logger.log(makeEvent({ timestamp: old.toISOString() }));
    logger.log(makeEvent({ timestamp: recent.toISOString() }));
    logger.flush();

    expect(logger.getEventCount()).toBe(3);

    const pruned = logger.prune();
    expect(pruned).toBe(2);
    expect(logger.getEventCount()).toBe(1);
  });

  // ─── Export ────────────────────────────────────────────────────────────

  it("exports events as JSON", () => {
    logger.log(makeEvent({ operation: "op-1" }));
    logger.log(makeEvent({ operation: "op-2" }));
    logger.flush();

    const json = logger.exportEvents({});
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].operation).toBeDefined();
  });

  it("exports events as CSV", () => {
    logger.log(makeEvent({ operation: "op-1" }));
    logger.log(makeEvent({ operation: "op-2" }));
    logger.flush();

    const csv = logger.exportCSV({});
    const lines = csv.split("\n");
    expect(lines.length).toBe(3); // header + 2 rows
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("timestamp");
    expect(lines[0]).toContain("eventType");
  });

  // ─── Custom timestamp ─────────────────────────────────────────────────

  it("uses provided timestamp when given", () => {
    const customTime = "2024-06-15T12:00:00Z";
    const event = logger.log(makeEvent({ timestamp: customTime }));
    expect(event.timestamp).toBe(customTime);
  });
});

describe("InMemoryAuditStorage", () => {
  let storage: InMemoryAuditStorage;

  beforeEach(async () => {
    storage = new InMemoryAuditStorage();
    await storage.initialize();
  });

  afterEach(() => {
    storage.close();
  });

  it("stores and retrieves events", () => {
    const event: AuditEvent = {
      id: "evt-1",
      timestamp: new Date().toISOString(),
      eventType: "command_executed",
      severity: "info",
      actor: { id: "u1", name: "User", roles: [] },
      operation: "test",
      result: "success",
    };

    storage.save(event);
    expect(storage.getEventCount()).toBe(1);
    expect(storage.getById("evt-1")).toEqual(event);
  });

  it("saves batch of events", () => {
    const events: AuditEvent[] = Array.from({ length: 5 }, (_, i) => ({
      id: `evt-${i}`,
      timestamp: new Date().toISOString(),
      eventType: "tool_invoked" as const,
      severity: "info" as const,
      actor: { id: "u1", name: "User", roles: [] },
      operation: `op-${i}`,
      result: "success" as const,
    }));

    storage.saveBatch(events);
    expect(storage.getEventCount()).toBe(5);
  });

  it("queries with multiple combined filters", () => {
    storage.save({
      id: "e1",
      timestamp: "2025-06-01T00:00:00Z",
      eventType: "command_executed",
      severity: "info",
      actor: { id: "alice", name: "Alice", roles: ["admin"] },
      operation: "deploy",
      result: "success",
    });
    storage.save({
      id: "e2",
      timestamp: "2025-06-02T00:00:00Z",
      eventType: "auth_failed",
      severity: "warn",
      actor: { id: "bob", name: "Bob", roles: [] },
      operation: "login",
      result: "failure",
    });
    storage.save({
      id: "e3",
      timestamp: "2025-06-03T00:00:00Z",
      eventType: "command_executed",
      severity: "info",
      actor: { id: "alice", name: "Alice", roles: ["admin"] },
      operation: "status",
      result: "success",
    });

    const results = storage.query({
      actorIds: ["alice"],
      eventTypes: ["command_executed"],
    });
    expect(results.length).toBe(2);
  });
});
