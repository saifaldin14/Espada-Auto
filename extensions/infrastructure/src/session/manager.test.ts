/**
 * Infrastructure Session Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  InfrastructureSessionManager,
  InMemorySessionStorage,
  createSessionManager,
} from "./manager.js";
import type { InfrastructureProviderMeta, ProviderAuthConfig, SessionConfig } from "../types.js";
import { createInfrastructureLogger } from "../logging/logger.js";

describe("InfrastructureSessionManager", () => {
  let manager: InfrastructureSessionManager;
  let config: SessionConfig;

  const providerMeta: InfrastructureProviderMeta = {
    id: "test-provider",
    name: "Test Provider",
    displayName: "Test Provider",
    description: "Test",
    version: "1.0.0",
    category: "custom",
    capabilities: [],
    supportedResources: [],
    authMethods: ["api-key"],
  };

  const auth: ProviderAuthConfig = {
    method: "api-key",
    credentials: { apiKey: "test-key" },
  };

  beforeEach(() => {
    config = {
      timeout: 60000, // 1 minute for testing
      maxConcurrent: 5,
      persistState: false,
      cleanupInterval: 10000,
    };

    const logger = createInfrastructureLogger("test-session");
    manager = new InfrastructureSessionManager({
      config,
      logger,
      storage: new InMemorySessionStorage(),
    });
  });

  afterEach(() => {
    manager.stop();
  });

  describe("session creation", () => {
    it("should create a new session", async () => {
      const session = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
        userId: "user-1",
      });

      expect(session.id).toBeDefined();
      expect(session.providerId).toBe("test-provider");
      expect(session.userId).toBe("user-1");
      expect(session.state).toBe("active");
      expect(session.context.provider).toEqual(providerMeta);
    });

    it("should enforce concurrent session limit", async () => {
      // Create max sessions
      for (let i = 0; i < config.maxConcurrent; i++) {
        await manager.createSession({
          providerId: "test-provider",
          providerMeta,
          auth,
        });
      }

      // Should fail on next creation
      await expect(
        manager.createSession({
          providerId: "test-provider",
          providerMeta,
          auth,
        }),
      ).rejects.toThrow(/Maximum concurrent sessions/);
    });

    it("should generate unique session IDs", async () => {
      const session1 = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      const session2 = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      expect(session1.id).not.toBe(session2.id);
    });
  });

  describe("session retrieval", () => {
    it("should retrieve existing session", async () => {
      const created = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      const retrieved = await manager.getSession(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
    });

    it("should return null for non-existent session", async () => {
      const retrieved = await manager.getSession("non-existent");
      expect(retrieved).toBeNull();
    });
  });

  describe("session state management", () => {
    it("should transition to idle state", async () => {
      const session = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      await manager.idleSession(session.id);
      const updated = await manager.getSession(session.id);

      expect(updated!.state).toBe("idle");
    });

    it("should reactivate idle session", async () => {
      const session = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      await manager.idleSession(session.id);
      await manager.activateSession(session.id);
      const updated = await manager.getSession(session.id);

      expect(updated!.state).toBe("active");
    });

    it("should terminate session", async () => {
      const session = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      await manager.terminateSession(session.id);
      const updated = await manager.getSession(session.id);

      expect(updated!.state).toBe("terminated");
    });
  });

  describe("session resources", () => {
    it("should add resource to session", async () => {
      const session = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      await manager.addResource(session.id, {
        id: "resource-1",
        type: "compute",
        name: "test-instance",
        provider: "test-provider",
        status: "running",
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
      });

      const updated = await manager.getSession(session.id);
      expect(updated!.context.resources.has("resource-1")).toBe(true);
    });

    it("should remove resource from session", async () => {
      const session = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      await manager.addResource(session.id, {
        id: "resource-1",
        type: "compute",
        name: "test-instance",
        provider: "test-provider",
        status: "running",
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
      });

      await manager.removeResource(session.id, "resource-1");
      const updated = await manager.getSession(session.id);

      expect(updated!.context.resources.has("resource-1")).toBe(false);
    });
  });

  describe("session history", () => {
    it("should record state changes in history", async () => {
      const session = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      await manager.idleSession(session.id);
      const updated = await manager.getSession(session.id);

      expect(updated!.history.length).toBeGreaterThan(1);
      expect(
        updated!.history.some(
          (h) => h.type === "state-change" && h.data.to === "idle",
        ),
      ).toBe(true);
    });

    it("should add custom history entries", async () => {
      const session = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      await manager.addHistoryEntry(session.id, {
        type: "command",
        data: { commandId: "test-command", parameters: {} },
      });

      const updated = await manager.getSession(session.id);
      expect(
        updated!.history.some((h) => h.type === "command"),
      ).toBe(true);
    });
  });

  describe("session touch", () => {
    it("should update last activity time", async () => {
      const session = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      const originalActivity = session.lastActivityAt;

      // Wait a bit
      await new Promise((r) => setTimeout(r, 10));

      await manager.touchSession(session.id);
      const updated = await manager.getSession(session.id);

      expect(updated!.lastActivityAt.getTime()).toBeGreaterThan(originalActivity.getTime());
    });

    it("should extend expiration when requested", async () => {
      const session = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      const originalExpiry = session.expiresAt;

      // Wait a bit to ensure time has passed
      await new Promise((r) => setTimeout(r, 10));

      await manager.touchSession(session.id, { extend: true });
      const updated = await manager.getSession(session.id);

      expect(updated!.expiresAt.getTime()).toBeGreaterThan(originalExpiry.getTime());
    });
  });

  describe("session queries", () => {
    it("should query sessions by provider", async () => {
      await manager.createSession({
        providerId: "provider-a",
        providerMeta: { ...providerMeta, id: "provider-a" },
        auth,
      });

      await manager.createSession({
        providerId: "provider-b",
        providerMeta: { ...providerMeta, id: "provider-b" },
        auth,
      });

      const results = await manager.querySessions({ providerId: "provider-a" });

      expect(results).toHaveLength(1);
      expect(results[0].providerId).toBe("provider-a");
    });

    it("should query sessions by state", async () => {
      const session1 = await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      await manager.createSession({
        providerId: "test-provider",
        providerMeta,
        auth,
      });

      await manager.idleSession(session1.id);

      const activeResults = await manager.querySessions({ state: "active" });
      const idleResults = await manager.querySessions({ state: "idle" });

      expect(activeResults).toHaveLength(1);
      expect(idleResults).toHaveLength(1);
    });
  });

  describe("statistics", () => {
    it("should report accurate statistics", async () => {
      await manager.createSession({
        providerId: "provider-a",
        providerMeta: { ...providerMeta, id: "provider-a" },
        auth,
      });

      const session2 = await manager.createSession({
        providerId: "provider-b",
        providerMeta: { ...providerMeta, id: "provider-b" },
        auth,
      });

      await manager.idleSession(session2.id);

      const stats = await manager.getStatistics();

      expect(stats.total).toBe(2);
      expect(stats.active).toBe(1);
      expect(stats.idle).toBe(1);
      expect(stats.byProvider["provider-a"]).toBe(1);
      expect(stats.byProvider["provider-b"]).toBe(1);
    });
  });
});
