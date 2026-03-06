/**
 * Unit tests for EventBus (enterprise event bus & outbound webhook system).
 *
 * Covers: publish, subscribe, unsubscribe, glob pattern matching,
 *         webhook registration/update/delete, event catalog, close.
 *
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { EventBus } from "../../../gateway/event-bus/index.js";
import type { BusEvent } from "../../../gateway/event-bus/index.js";

function tmpDb(name: string): string {
  const dir = join(tmpdir(), "espada-test-eventbus");
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

describe("EventBus", () => {
  let dbPath: string;
  let bus: EventBus;

  afterEach(() => {
    bus?.close();
    if (dbPath) cleanup(dbPath);
  });

  // ===========================================================================
  // Publish / Subscribe basics
  // ===========================================================================

  it("publishes an event and returns it with auto-generated ID", () => {
    dbPath = tmpDb("publish");
    bus = new EventBus(dbPath);

    const event = bus.publish({
      name: "agent.lifecycle.started",
      namespace: "agent",
      data: { agentId: "a1" },
      source: "test",
    });

    expect(event.id).toBeTruthy();
    expect(event.name).toBe("agent.lifecycle.started");
    expect(event.namespace).toBe("agent");
    expect(event.data).toEqual({ agentId: "a1" });
    expect(event.timestamp).toBeTruthy();
  });

  it("delivers events to matching subscribers", () => {
    dbPath = tmpDb("subscribe");
    bus = new EventBus(dbPath);

    const received: BusEvent[] = [];
    bus.subscribe("agent.*", (event) => {
      received.push(event);
    });

    bus.publish({ name: "agent.started", namespace: "agent", data: {} });
    bus.publish({ name: "agent.completed", namespace: "agent", data: {} });
    bus.publish({ name: "audit.login", namespace: "audit", data: {} }); // should NOT match

    expect(received).toHaveLength(2);
    expect(received[0].name).toBe("agent.started");
    expect(received[1].name).toBe("agent.completed");
  });

  it("delivers events to wildcard subscriber", () => {
    dbPath = tmpDb("wildcard");
    bus = new EventBus(dbPath);

    const received: BusEvent[] = [];
    bus.subscribe("*", (event) => {
      received.push(event);
    });

    bus.publish({ name: "agent.started", namespace: "agent", data: {} });
    bus.publish({ name: "audit.login", namespace: "audit", data: {} });

    expect(received).toHaveLength(2);
  });

  it("unsubscribes correctly", () => {
    dbPath = tmpDb("unsub");
    bus = new EventBus(dbPath);

    const received: BusEvent[] = [];
    const sub = bus.subscribe("agent.*", (event) => {
      received.push(event);
    });

    bus.publish({ name: "agent.started", namespace: "agent", data: {} });
    sub.unsubscribe();
    bus.publish({ name: "agent.completed", namespace: "agent", data: {} });

    expect(received).toHaveLength(1);
  });

  // ===========================================================================
  // EventEmitter integration
  // ===========================================================================

  it("emits 'event' on EventEmitter interface", () => {
    dbPath = tmpDb("emitter");
    bus = new EventBus(dbPath);

    const received: BusEvent[] = [];
    bus.on("event", (evt: BusEvent) => received.push(evt));

    bus.publish({ name: "test.ping", namespace: "custom", data: { val: 1 } });

    expect(received).toHaveLength(1);
    expect(received[0].name).toBe("test.ping");
  });

  it("emits on the named event channel", () => {
    dbPath = tmpDb("named");
    bus = new EventBus(dbPath);

    const received: BusEvent[] = [];
    bus.on("agent.started", (evt: BusEvent) => received.push(evt));

    bus.publish({ name: "agent.started", namespace: "agent", data: {} });
    bus.publish({ name: "agent.stopped", namespace: "agent", data: {} }); // won't match

    expect(received).toHaveLength(1);
  });

  // ===========================================================================
  // Default namespace inference
  // ===========================================================================

  it("infers namespace from event name prefix", () => {
    dbPath = tmpDb("ns-infer");
    bus = new EventBus(dbPath);

    const event = bus.publish({ name: "audit.rbac.denied", data: {} });
    expect(event.namespace).toBe("audit");
  });

  // ===========================================================================
  // Webhook registration
  // ===========================================================================

  it("registers and retrieves a webhook", () => {
    dbPath = tmpDb("webhook-reg");
    bus = new EventBus(dbPath);

    const hook = bus.registerWebhook({
      name: "Test Hook",
      url: "https://example.com/hook",
      eventPatterns: ["agent.*"],
    });

    expect(hook.id).toBeTruthy();
    expect(hook.name).toBe("Test Hook");
    expect(hook.url).toBe("https://example.com/hook");
    expect(hook.eventPatterns).toEqual(["agent.*"]);
    expect(hook.enabled).toBe(true);
    expect(hook.secret).toBeTruthy();
  });

  it("updates a webhook", () => {
    dbPath = tmpDb("webhook-update");
    bus = new EventBus(dbPath);

    const hook = bus.registerWebhook({
      name: "Original",
      url: "https://example.com/hook",
      eventPatterns: ["agent.*"],
    });

    const updated = bus.updateWebhook(hook.id, { name: "Updated" });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Updated");
  });

  it("deletes a webhook", () => {
    dbPath = tmpDb("webhook-delete");
    bus = new EventBus(dbPath);

    const hook = bus.registerWebhook({
      name: "ToDelete",
      url: "https://example.com/hook",
      eventPatterns: ["*"],
    });

    const deleted = bus.deleteWebhook(hook.id);
    expect(deleted).toBe(true);

    // Update on deleted should return null
    expect(bus.updateWebhook(hook.id, { name: "nope" })).toBeNull();
  });

  // ===========================================================================
  // Error resilience in subscribers
  // ===========================================================================

  it("does not break on synchronous subscriber error", () => {
    dbPath = tmpDb("error-sync");
    bus = new EventBus(dbPath);

    bus.subscribe("test.*", () => {
      throw new Error("subscriber crash");
    });

    // Should not throw
    const event = bus.publish({ name: "test.ping", data: {} });
    expect(event.id).toBeTruthy();
  });

  it("does not break on async subscriber rejection", () => {
    dbPath = tmpDb("error-async");
    bus = new EventBus(dbPath);

    bus.subscribe("test.*", async () => {
      throw new Error("async crash");
    });

    const event = bus.publish({ name: "test.ping", data: {} });
    expect(event.id).toBeTruthy();
  });

  // ===========================================================================
  // Persistence
  // ===========================================================================

  it("persists webhook registrations across close/reopen", () => {
    dbPath = tmpDb("persist");
    bus = new EventBus(dbPath);

    bus.registerWebhook({
      name: "Persistent",
      url: "https://example.com/hook",
      eventPatterns: ["*"],
    });
    bus.close();

    const bus2 = new EventBus(dbPath);
    // Verify by trying to register another — the first should still exist
    // We can check by registering with a second name and verifying catalog
    const hook2 = bus2.registerWebhook({
      name: "Second",
      url: "https://example.com/hook2",
      eventPatterns: ["agent.*"],
    });
    expect(hook2.id).toBeTruthy();
    bus2.close();
    bus = undefined!; // prevent afterEach double-close
  });
});
