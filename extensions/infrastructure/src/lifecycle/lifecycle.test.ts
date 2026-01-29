/**
 * Infrastructure Lifecycle Manager Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  InfrastructureLifecycleManager,
  type LifecycleManagerOptions,
} from "./manager.js";
import type { InfrastructureLogger } from "../logging/logger.js";
import type {
  InfrastructureProvider,
  ProviderHealthCheck,
} from "../provider.js";
import type {
  InfrastructureProviderMeta,
  LifecycleHookName,
} from "../types.js";

// Mock logger
const createMockLogger = (): InfrastructureLogger => ({
  subsystem: "test",
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: () => createMockLogger(),
  withContext: () => createMockLogger(),
  setLevel: vi.fn(),
  getLevel: () => "info",
  isLevelEnabled: () => true,
});

// Mock provider
const createMockProvider = (
  id: string,
  options: {
    initializeSuccess?: boolean;
    startSuccess?: boolean;
    stopSuccess?: boolean;
    healthStatus?: "healthy" | "degraded" | "unhealthy";
    initDelay?: number;
    startDelay?: number;
  } = {},
): InfrastructureProvider => {
  const {
    initializeSuccess = true,
    startSuccess = true,
    stopSuccess = true,
    healthStatus = "healthy",
    initDelay = 0,
    startDelay = 0,
  } = options;

  const meta: InfrastructureProviderMeta = {
    id,
    name: `Provider ${id}`,
    displayName: `Provider ${id}`,
    description: `Test provider ${id}`,
    version: "1.0.0",
    category: "cloud",
    capabilities: ["provision", "monitor"],
    supportedResources: ["compute", "storage"],
    authMethods: ["api-key"],
  };

  return {
    meta,
    initialize: vi.fn().mockImplementation(async () => {
      if (initDelay > 0) await new Promise(r => setTimeout(r, initDelay));
      if (!initializeSuccess) throw new Error("Initialize failed");
    }),
    start: vi.fn().mockImplementation(async () => {
      if (startDelay > 0) await new Promise(r => setTimeout(r, startDelay));
      if (!startSuccess) throw new Error("Start failed");
    }),
    stop: vi.fn().mockImplementation(async () => {
      if (!stopSuccess) throw new Error("Stop failed");
    }),
    destroy: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({
      status: healthStatus,
      timestamp: new Date(),
      checks: [],
    } as ProviderHealthCheck),
    getCommands: vi.fn().mockReturnValue([]),
    executeCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  };
};

describe("InfrastructureLifecycleManager", () => {
  let manager: InfrastructureLifecycleManager;
  let mockLogger: InfrastructureLogger;
  let defaultOptions: LifecycleManagerOptions;

  beforeEach(() => {
    mockLogger = createMockLogger();
    defaultOptions = {
      healthCheckInterval: 60000,
      autoRestart: false, // Disable for tests to avoid background operations
      maxRestartAttempts: 3,
      restartDelay: 1000,
      shutdownTimeout: 5000,
    };
    manager = new InfrastructureLifecycleManager(defaultOptions, mockLogger);
  });

  describe("provider registration", () => {
    it("should register a provider", () => {
      const provider = createMockProvider("test-1");
      
      manager.registerProvider(provider);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Provider registered"),
        expect.any(Object),
      );
    });

    it("should throw when registering duplicate provider", () => {
      const provider = createMockProvider("test-1");
      
      manager.registerProvider(provider);
      
      expect(() => manager.registerProvider(provider)).toThrow(/already registered/);
    });

    it("should set initial state to uninitialized", () => {
      const provider = createMockProvider("test-1");
      
      manager.registerProvider(provider);
      
      const state = manager.getProviderState("test-1");
      expect(state).toBe("uninitialized");
    });

    it("should track registration via statistics", () => {
      const provider = createMockProvider("test-1");
      
      manager.registerProvider(provider);
      
      const stats = manager.getStatistics();
      expect(stats.totalProviders).toBe(1);
    });
  });

  describe("provider unregistration", () => {
    it("should unregister a provider", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      
      await manager.unregisterProvider("test-1");
      
      const state = manager.getProviderState("test-1");
      expect(state).toBeNull();
    });

    it("should throw when unregistering non-existent provider", async () => {
      await expect(manager.unregisterProvider("non-existent")).rejects.toThrow(/not found/);
    });

    it("should stop running provider before unregistering", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      
      await manager.initializeProvider("test-1", { method: "api-key" });
      await manager.startProvider("test-1");
      
      await manager.unregisterProvider("test-1");
      
      expect(provider.stop).toHaveBeenCalled();
    });
  });

  describe("provider initialization", () => {
    it("should initialize a provider", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      
      await manager.initializeProvider("test-1", { method: "api-key" });
      
      expect(provider.initialize).toHaveBeenCalled();
      expect(manager.getProviderState("test-1")).toBe("ready");
    });

    it("should throw when initializing non-existent provider", async () => {
      await expect(
        manager.initializeProvider("non-existent", { method: "api-key" }),
      ).rejects.toThrow(/not found/);
    });

    it("should throw when initializing already initialized provider", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      
      await manager.initializeProvider("test-1", { method: "api-key" });
      
      await expect(
        manager.initializeProvider("test-1", { method: "api-key" }),
      ).rejects.toThrow(/already initialized/);
    });

    it("should handle initialization failure", async () => {
      const provider = createMockProvider("test-1", { initializeSuccess: false });
      manager.registerProvider(provider);
      
      await expect(
        manager.initializeProvider("test-1", { method: "api-key" }),
      ).rejects.toThrow();
      
      expect(manager.getProviderState("test-1")).toBe("error");
    });

    it("should transition through initializing state", async () => {
      const provider = createMockProvider("test-1", { initDelay: 10 });
      manager.registerProvider(provider);
      
      const initPromise = manager.initializeProvider("test-1", { method: "api-key" });
      
      await initPromise;
      const stateAfter = manager.getProviderState("test-1");
      
      expect(stateAfter).toBe("ready");
    });
  });

  describe("provider start/stop", () => {
    it("should start an initialized provider", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      await manager.initializeProvider("test-1", { method: "api-key" });
      
      await manager.startProvider("test-1");
      
      expect(manager.getProviderState("test-1")).toBe("active");
    });

    it("should stop a running provider", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      await manager.initializeProvider("test-1", { method: "api-key" });
      await manager.startProvider("test-1");
      
      await manager.stopProvider("test-1");
      
      expect(manager.getProviderState("test-1")).toBe("suspended");
    });

    it("should handle start failure", async () => {
      const provider = createMockProvider("test-1", { startSuccess: false });
      manager.registerProvider(provider);
      await manager.initializeProvider("test-1", { method: "api-key" });
      
      await expect(manager.startProvider("test-1")).rejects.toThrow();
      
      expect(manager.getProviderState("test-1")).toBe("error");
    });

    it("should restart a provider", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      await manager.initializeProvider("test-1", { method: "api-key" });
      await manager.startProvider("test-1");
      
      await manager.restartProvider("test-1");
      
      expect(manager.getProviderState("test-1")).toBe("active");
    });
  });

  describe("provider destruction", () => {
    it("should destroy a provider", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      await manager.initializeProvider("test-1", { method: "api-key" });
      
      await manager.destroyProvider("test-1");
      
      expect(provider.destroy).toHaveBeenCalled();
      expect(manager.getProviderState("test-1")).toBe("terminated");
    });

    it("should stop running provider before destroying", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      await manager.initializeProvider("test-1", { method: "api-key" });
      await manager.startProvider("test-1");
      
      await manager.destroyProvider("test-1");
      
      expect(provider.stop).toHaveBeenCalled();
      expect(provider.destroy).toHaveBeenCalled();
    });
  });

  describe("lifecycle hooks", () => {
    it("should register and execute hooks", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      
      const hookFn = vi.fn();
      manager.registerHook("beforeInit", hookFn);
      
      await manager.initializeProvider("test-1", { method: "api-key" });
      
      expect(hookFn).toHaveBeenCalled();
    });

    it("should execute hooks in priority order", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      
      const order: number[] = [];
      
      manager.registerHook("beforeInit", async () => { order.push(2); }, { priority: 50 });
      manager.registerHook("beforeInit", async () => { order.push(1); }, { priority: 100 });
      
      await manager.initializeProvider("test-1", { method: "api-key" });
      
      // Higher priority runs first
      expect(order).toEqual([1, 2]);
    });

    it("should unregister hooks", async () => {
      const hookFn = vi.fn();
      const unregister = manager.registerHook("beforeInit", hookFn);
      
      unregister();
      
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      await manager.initializeProvider("test-1", { method: "api-key" });
      
      expect(hookFn).not.toHaveBeenCalled();
    });

    it("should support all lifecycle hook points", () => {
      const hookNames: LifecycleHookName[] = [
        "beforeInit",
        "afterInit",
        "beforeStart",
        "afterStart",
        "beforeStop",
        "afterStop",
        "beforeDestroy",
        "afterDestroy",
        "onError",
        "onHealthCheck",
      ];
      
      hookNames.forEach(name => {
        expect(() => manager.registerHook(name, vi.fn())).not.toThrow();
      });
    });
  });

  describe("event handling", () => {
    it("should emit and handle events", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      
      const eventHandler = vi.fn();
      manager.on("provider:initialized", eventHandler);
      
      await manager.initializeProvider("test-1", { method: "api-key" });
      
      // Events are emitted asynchronously
      await new Promise(r => setTimeout(r, 10));
      expect(eventHandler).toHaveBeenCalled();
    });

    it("should remove event handlers", async () => {
      const handler = vi.fn();
      const unregister = manager.on("provider:ready", handler);
      unregister();
      
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      await manager.initializeProvider("test-1", { method: "api-key" });
      await manager.startProvider("test-1");
      
      await new Promise(r => setTimeout(r, 10));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("health monitoring", () => {
    it("should check provider health", async () => {
      const provider = createMockProvider("test-1", { healthStatus: "healthy" });
      manager.registerProvider(provider);
      await manager.initializeProvider("test-1", { method: "api-key" });
      await manager.startProvider("test-1");
      
      const health = await manager.checkProviderHealth("test-1");
      
      expect(health).toBeDefined();
      expect(health.status).toBe("healthy");
    });

    it("should store health check result", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      await manager.initializeProvider("test-1", { method: "api-key" });
      await manager.startProvider("test-1");
      
      await manager.checkProviderHealth("test-1");
      
      expect(provider.healthCheck).toHaveBeenCalled();
      
      const registration = manager.getProvider("test-1");
      expect(registration?.lastHealthCheck).toBeDefined();
    });
  });

  describe("bulk operations", () => {
    it("should start all ready providers", async () => {
      for (let i = 1; i <= 3; i++) {
        const provider = createMockProvider(`test-${i}`);
        manager.registerProvider(provider);
        await manager.initializeProvider(`test-${i}`, { method: "api-key" });
      }
      
      await manager.startAll();
      
      for (let i = 1; i <= 3; i++) {
        expect(manager.getProviderState(`test-${i}`)).toBe("active");
      }
    });

    it("should stop all active providers", async () => {
      for (let i = 1; i <= 3; i++) {
        const provider = createMockProvider(`test-${i}`);
        manager.registerProvider(provider);
        await manager.initializeProvider(`test-${i}`, { method: "api-key" });
      }
      await manager.startAll();
      
      await manager.stopAll();
      
      for (let i = 1; i <= 3; i++) {
        expect(manager.getProviderState(`test-${i}`)).toBe("suspended");
      }
    });
  });

  describe("statistics", () => {
    it("should return lifecycle statistics", async () => {
      const p1 = createMockProvider("test-1");
      const p2 = createMockProvider("test-2");
      manager.registerProvider(p1);
      manager.registerProvider(p2);
      
      await manager.initializeProvider("test-1", { method: "api-key" });
      await manager.startProvider("test-1");
      
      const stats = manager.getStatistics();
      
      expect(stats.totalProviders).toBe(2);
      expect(stats.byState).toBeDefined();
      expect(stats.healthSummary).toBeDefined();
    });

    it("should track hooks in statistics", () => {
      manager.registerHook("beforeInit", vi.fn());
      manager.registerHook("afterInit", vi.fn());
      
      const stats = manager.getStatistics();
      
      expect(stats.totalHooks).toBe(2);
    });

    it("should track event handlers in statistics", () => {
      manager.on("provider:registered", vi.fn());
      manager.on("provider:ready", vi.fn());
      
      const stats = manager.getStatistics();
      
      expect(stats.totalEventHandlers).toBe(2);
    });
  });

  describe("shutdown", () => {
    it("should shutdown cleanly", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      await manager.initializeProvider("test-1", { method: "api-key" });
      await manager.startProvider("test-1");
      
      await manager.shutdown();
      
      expect(provider.stop).toHaveBeenCalled();
      expect(manager.getAllProviders()).toHaveLength(0);
    });

    it("should clear all state on shutdown", async () => {
      manager.registerHook("beforeInit", vi.fn());
      manager.on("provider:registered", vi.fn());
      
      await manager.shutdown();
      
      const stats = manager.getStatistics();
      expect(stats.totalProviders).toBe(0);
      expect(stats.totalHooks).toBe(0);
      expect(stats.totalEventHandlers).toBe(0);
    });
  });

  describe("query methods", () => {
    beforeEach(async () => {
      for (let i = 1; i <= 3; i++) {
        const provider = createMockProvider(`test-${i}`);
        manager.registerProvider(provider);
        await manager.initializeProvider(`test-${i}`, { method: "api-key" });
      }
      await manager.startProvider("test-1");
    });

    it("should get all providers", () => {
      const providers = manager.getAllProviders();
      expect(providers).toHaveLength(3);
    });

    it("should get providers by state", () => {
      const active = manager.getProvidersByState("active");
      const ready = manager.getProvidersByState("ready");
      
      expect(active).toHaveLength(1);
      expect(ready).toHaveLength(2);
    });

    it("should get provider registration", () => {
      const reg = manager.getProvider("test-1");
      
      expect(reg).not.toBeNull();
      expect(reg?.provider.meta.id).toBe("test-1");
    });

    it("should return null for unknown provider", () => {
      expect(manager.getProvider("unknown")).toBeNull();
      expect(manager.getProviderState("unknown")).toBeNull();
    });
  });

  describe("lifecycle state transitions", () => {
    it("should transition through full lifecycle", async () => {
      const provider = createMockProvider("test-1");
      manager.registerProvider(provider);
      
      expect(manager.getProviderState("test-1")).toBe("uninitialized");
      
      await manager.initializeProvider("test-1", { method: "api-key" });
      expect(manager.getProviderState("test-1")).toBe("ready");
      
      await manager.startProvider("test-1");
      expect(manager.getProviderState("test-1")).toBe("active");
      
      await manager.stopProvider("test-1");
      expect(manager.getProviderState("test-1")).toBe("suspended");
      
      await manager.startProvider("test-1");
      expect(manager.getProviderState("test-1")).toBe("active");
      
      await manager.destroyProvider("test-1");
      expect(manager.getProviderState("test-1")).toBe("terminated");
    });
  });
});
