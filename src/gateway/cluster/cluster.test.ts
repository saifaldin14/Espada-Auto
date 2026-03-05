/**
 * Unit tests for ClusterCoordinator (enterprise HA/clustering).
 *
 * Covers: instance registration, leader election, fencing tokens,
 *         heartbeat, health status, graceful shutdown.
 *
 */

import { describe, it, expect, afterEach } from "vitest";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ClusterCoordinator } from "./index.js";
import type { ClusterEvent } from "./index.js";

function tmpDb(name: string): string {
  const dir = join(tmpdir(), "espada-test-cluster");
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

describe("ClusterCoordinator", () => {
  let dbPath: string;
  const coordinators: ClusterCoordinator[] = [];

  afterEach(async () => {
    for (const c of coordinators) {
      try {
        await c.stop();
      } catch {
        /* already stopped */
      }
    }
    coordinators.length = 0;
    if (dbPath) cleanup(dbPath);
  });

  function createCoordinator(opts?: { instanceId?: string; name?: string }): ClusterCoordinator {
    const c = new ClusterCoordinator(dbPath, {
      instanceId: opts?.instanceId ?? randomUUID(),
      instanceName: opts?.name ?? "test-instance",
      address: "127.0.0.1:3000",
      heartbeatIntervalMs: 60_000, // very long to prevent timer interference
      leaseTtlMs: 15_000,
      instanceTimeoutMs: 30_000,
    });
    coordinators.push(c);
    return c;
  }

  // ===========================================================================
  // Registration
  // ===========================================================================

  it("registers instance and returns self", async () => {
    dbPath = tmpDb("register");
    const coord = createCoordinator({ name: "node-1" });
    await coord.start();

    const self = coord.getSelf();
    expect(self).not.toBeNull();
    expect(self!.id).toBe(coord.instanceId);
    expect(self!.name).toBe("node-1");
    expect(self!.health).toBe("healthy");
    expect(self!.address).toBe("127.0.0.1:3000");
  });

  it("lists all instances", async () => {
    dbPath = tmpDb("list-instances");
    const c1 = createCoordinator({ instanceId: "inst-1", name: "node-1" });
    const c2 = createCoordinator({ instanceId: "inst-2", name: "node-2" });

    await c1.start();
    await c2.start();

    const instances = c1.getInstances();
    expect(instances).toHaveLength(2);
    expect(instances.map((i) => i.id).sort()).toEqual(["inst-1", "inst-2"]);
  });

  // ===========================================================================
  // Leader election
  // ===========================================================================

  it("elects itself as leader when sole instance", async () => {
    dbPath = tmpDb("leader-sole");
    const coord = createCoordinator();
    await coord.start();

    expect(coord.isLeader).toBe(true);
    expect(coord.role).toBe("leader");
    expect(coord.fencingToken).toBeGreaterThan(0);
  });

  it("provides fencing token after election", async () => {
    dbPath = tmpDb("fencing-token");
    const coord = createCoordinator();
    await coord.start();

    const lease = coord.getLease();
    expect(lease).not.toBeNull();
    expect(lease!.instanceId).toBe(coord.instanceId);
    expect(lease!.fencingToken).toBe(coord.fencingToken);
  });

  it("returns leader through getLeader()", async () => {
    dbPath = tmpDb("get-leader");
    const coord = createCoordinator();
    await coord.start();

    const leader = coord.getLeader();
    expect(leader).not.toBeNull();
    expect(leader!.id).toBe(coord.instanceId);
    expect(leader!.role).toBe("leader");
  });

  // ===========================================================================
  // Events
  // ===========================================================================

  it("emits leader-elected event", async () => {
    dbPath = tmpDb("event-elected");
    const coord = createCoordinator();

    const events: ClusterEvent[] = [];
    coord.on("event", (evt: ClusterEvent) => events.push(evt));

    await coord.start();

    const leaderEvent = events.find((e) => e.type === "leader-elected");
    expect(leaderEvent).toBeDefined();
    expect(leaderEvent && leaderEvent.type === "leader-elected" && leaderEvent.instanceId).toBe(
      coord.instanceId,
    );
  });

  it("emits instance-joined event on start", async () => {
    dbPath = tmpDb("event-joined");
    const coord = createCoordinator();

    const events: ClusterEvent[] = [];
    coord.on("event", (evt: ClusterEvent) => events.push(evt));

    await coord.start();

    const joinEvent = events.find((e) => e.type === "instance-joined");
    expect(joinEvent).toBeDefined();
  });

  it("emits instance-left event on stop", async () => {
    dbPath = tmpDb("event-left");
    const coord = createCoordinator();

    const events: ClusterEvent[] = [];
    coord.on("event", (evt: ClusterEvent) => events.push(evt));

    await coord.start();
    await coord.stop();
    coordinators.length = 0; // already stopped

    const leftEvent = events.find((e) => e.type === "instance-left");
    expect(leftEvent).toBeDefined();
  });

  // ===========================================================================
  // Health
  // ===========================================================================

  it("updates health status", async () => {
    dbPath = tmpDb("health");
    const coord = createCoordinator();
    await coord.start();

    coord.setHealth("degraded");
    const self = coord.getSelf();
    expect(self!.health).toBe("degraded");
  });

  it("emits instance-unhealthy event", async () => {
    dbPath = tmpDb("unhealthy-event");
    const coord = createCoordinator();

    const events: ClusterEvent[] = [];
    coord.on("event", (evt: ClusterEvent) => events.push(evt));

    await coord.start();
    coord.setHealth("unhealthy");

    const unhealthyEvent = events.find((e) => e.type === "instance-unhealthy");
    expect(unhealthyEvent).toBeDefined();
  });

  // ===========================================================================
  // Graceful shutdown
  // ===========================================================================

  it("releases leader lease on stop", async () => {
    dbPath = tmpDb("release-lease");
    const c1 = createCoordinator({ instanceId: "leader-1" });
    await c1.start();

    expect(c1.isLeader).toBe(true);
    await c1.stop();
    coordinators.length = 0;

    // New instance should be able to become leader
    const c2 = createCoordinator({ instanceId: "leader-2" });
    coordinators.push(c2);
    await c2.start();

    expect(c2.isLeader).toBe(true);
    expect(c2.fencingToken).toBeGreaterThan(0);
  });
});
