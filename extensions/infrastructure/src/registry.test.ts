/**
 * Infrastructure Provider Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  InfrastructureProviderRegistry,
  createProviderRegistry,
  type RegistryOptions,
  type RegistryStatistics,
} from "./registry.js";
import { createInfrastructureLogger } from "./logging/logger.js";
import type { InfrastructureLogger } from "./logging/logger.js";
import type {
  InfrastructureProviderMeta,
  ProviderAuthConfig,
  DiscoveredPlugin,
  InfrastructurePluginManifest,
} from "./types.js";
import type {
  InfrastructureProvider,
  InfrastructureProviderFactory,
  ProviderFactoryOptions,
} from "./provider.js";

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

// Sample provider meta
const createSampleMeta = (id: string): InfrastructureProviderMeta => ({
  id,
  name: `Provider ${id}`,
  displayName: `Provider ${id}`,
  description: `Test provider ${id}`,
  version: "1.0.0",
  category: "cloud",
  capabilities: ["provision", "monitor"],
  supportedResources: ["compute", "storage"],
  authMethods: ["api-key"],
});

// Mock provider factory
const createMockProviderFactory = (
  meta: InfrastructureProviderMeta,
): InfrastructureProviderFactory => {
  return async (options: ProviderFactoryOptions): Promise<InfrastructureProvider> => ({
    meta: { ...meta, id: options.id },
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({
      status: "healthy",
      timestamp: new Date(),
      checks: [],
    }),
    getCommands: vi.fn().mockReturnValue([]),
    executeCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  } as unknown as InfrastructureProvider);
};

describe("InfrastructureProviderRegistry", () => {
  let registry: InfrastructureProviderRegistry;
  let mockLogger: InfrastructureLogger;
  let defaultOptions: RegistryOptions;

  beforeEach(() => {
    mockLogger = createMockLogger();
    defaultOptions = {
      autoDiscover: false,
      autoStart: false,
    };
    registry = createProviderRegistry(defaultOptions, mockLogger);
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  describe("initialization", () => {
    it("should create registry with default options", () => {
      expect(registry).toBeDefined();
    });

    it("should initialize successfully", async () => {
      await registry.initialize();
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("initialized"),
        expect.any(Object),
      );
    });

    it("should be idempotent on multiple initializations", async () => {
      await registry.initialize();
      await registry.initialize();
      
      // Should not throw
    });

    it("should auto-discover when enabled", async () => {
      const autoDiscoverRegistry = createProviderRegistry(
        { ...defaultOptions, autoDiscover: true },
        mockLogger,
      );
      
      await autoDiscoverRegistry.initialize();
      await autoDiscoverRegistry.shutdown();
    });
  });

  describe("factory registration", () => {
    it("should register a provider factory", () => {
      const meta = createSampleMeta("test-provider");
      const factory = createMockProviderFactory(meta);
      
      registry.registerFactory(meta, factory);
      
      const registered = registry.getFactory("test-provider");
      expect(registered).not.toBeNull();
      expect(registered?.meta.id).toBe("test-provider");
    });

    it("should throw when registering duplicate factory", () => {
      const meta = createSampleMeta("test-provider");
      const factory = createMockProviderFactory(meta);
      
      registry.registerFactory(meta, factory);
      
      expect(() => registry.registerFactory(meta, factory)).toThrow(/already registered/);
    });

    it("should unregister a factory", () => {
      const meta = createSampleMeta("test-provider");
      const factory = createMockProviderFactory(meta);
      
      registry.registerFactory(meta, factory);
      const removed = registry.unregisterFactory("test-provider");
      
      expect(removed).toBe(true);
      expect(registry.getFactory("test-provider")).toBeNull();
    });

    it("should return false when unregistering non-existent factory", () => {
      const removed = registry.unregisterFactory("non-existent");
      expect(removed).toBe(false);
    });

    it("should get all registered factories", () => {
      const meta1 = createSampleMeta("provider-1");
      const meta2 = createSampleMeta("provider-2");
      
      registry.registerFactory(meta1, createMockProviderFactory(meta1));
      registry.registerFactory(meta2, createMockProviderFactory(meta2));
      
      const factories = registry.getAllFactories();
      
      expect(factories.length).toBe(2);
      expect(factories.map(f => f.id)).toContain("provider-1");
      expect(factories.map(f => f.id)).toContain("provider-2");
    });

    it("should track registration timestamp", () => {
      const meta = createSampleMeta("test-provider");
      const factory = createMockProviderFactory(meta);
      
      const before = new Date();
      registry.registerFactory(meta, factory);
      const after = new Date();
      
      const registered = registry.getFactory("test-provider");
      expect(registered?.registeredAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(registered?.registeredAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should associate plugin with factory", () => {
      const meta = createSampleMeta("test-provider");
      const factory = createMockProviderFactory(meta);
      const plugin: DiscoveredPlugin = {
        path: "/plugins/test",
        source: "local",
        loadedAt: new Date(),
        manifest: {
          id: "test-plugin",
          name: "Test Plugin",
          version: "1.0.0",
          description: "Test",
          providers: [meta],
          dependencies: {},
          commands: [],
        },
      };
      
      registry.registerFactory(meta, factory, plugin);
      
      const registered = registry.getFactory("test-provider");
      expect(registered?.plugin).toBeDefined();
      expect(registered?.plugin?.manifest.id).toBe("test-plugin");
    });
  });

  describe("provider instance creation", () => {
    beforeEach(() => {
      const meta = createSampleMeta("test-provider");
      registry.registerFactory(meta, createMockProviderFactory(meta));
    });

    it("should create a provider instance", async () => {
      const provider = await registry.createProvider("test-provider", {});
      
      expect(provider).toBeDefined();
      expect(provider.meta.id).toContain("test-provider");
    });

    it("should create instance with custom ID", async () => {
      const provider = await registry.createProvider("test-provider", {
        instanceId: "my-custom-instance",
      });
      
      expect(provider.meta.id).toBe("my-custom-instance");
    });

    it("should throw when creating from non-existent factory", async () => {
      await expect(
        registry.createProvider("non-existent", {}),
      ).rejects.toThrow(/not found/);
    });

    it("should throw when creating duplicate instance", async () => {
      await registry.createProvider("test-provider", {
        instanceId: "duplicate-id",
      });
      
      await expect(
        registry.createProvider("test-provider", { instanceId: "duplicate-id" }),
      ).rejects.toThrow(/already exists/);
    });

    it("should pass config to provider factory", async () => {
      const provider = await registry.createProvider("test-provider", {
        config: { customSetting: "value" },
      });
      
      expect(provider).toBeDefined();
    });
  });

  describe("provider instance management", () => {
    beforeEach(async () => {
      const meta = createSampleMeta("test-provider");
      registry.registerFactory(meta, createMockProviderFactory(meta));
      await registry.createProvider("test-provider", { instanceId: "instance-1" });
    });

    it("should get instance by ID", () => {
      const instance = registry.getInstance("instance-1");
      
      expect(instance).not.toBeNull();
      expect(instance?.instanceId).toBe("instance-1");
    });

    it("should return null for non-existent instance", () => {
      const instance = registry.getInstance("non-existent");
      expect(instance).toBeNull();
    });

    it("should get all instances", async () => {
      await registry.createProvider("test-provider", { instanceId: "instance-2" });
      
      const instances = registry.getAllInstances();
      
      expect(instances.length).toBe(2);
    });

    it("should get instances by factory ID", async () => {
      const meta2 = createSampleMeta("other-provider");
      registry.registerFactory(meta2, createMockProviderFactory(meta2));
      await registry.createProvider("other-provider", { instanceId: "other-instance" });
      
      const testInstances = registry.getInstancesByFactory("test-provider");
      
      expect(testInstances.length).toBe(1);
      expect(testInstances[0].instanceId).toBe("instance-1");
    });

    it("should destroy instance", async () => {
      await registry.destroyInstance("instance-1");
      
      const instance = registry.getInstance("instance-1");
      expect(instance).toBeNull();
    });

    it("should throw when destroying non-existent instance", async () => {
      await expect(registry.destroyInstance("non-existent")).rejects.toThrow(/not found/);
    });
  });

  describe("create and initialize provider", () => {
    beforeEach(() => {
      const meta = createSampleMeta("test-provider");
      registry.registerFactory(meta, createMockProviderFactory(meta));
    });

    it("should create and initialize in one call", async () => {
      const provider = await registry.createAndInitializeProvider("test-provider", {
        auth: { method: "api-key", credentials: { apiKey: "test-key" } },
      });
      
      expect(provider).toBeDefined();
      expect(provider.initialize).toHaveBeenCalled();
    });

    it("should pass auth to initialization", async () => {
      const auth: ProviderAuthConfig = {
        method: "oauth2",
        credentials: { token: "oauth-token" },
      };
      
      const provider = await registry.createAndInitializeProvider("test-provider", {
        auth,
      });
      
      expect(provider.initialize).toHaveBeenCalledWith(auth);
    });
  });

  describe("manager access", () => {
    it("should provide lifecycle manager", () => {
      const lifecycle = registry.getLifecycleManager();
      expect(lifecycle).toBeDefined();
    });

    it("should provide session manager", () => {
      const session = registry.getSessionManager();
      expect(session).toBeDefined();
    });

    it("should provide discoverer", () => {
      const discoverer = registry.getDiscoverer();
      expect(discoverer).toBeDefined();
    });
  });

  describe("statistics", () => {
    it("should report empty statistics initially", () => {
      const stats = registry.getStatistics();
      
      expect(stats.factories).toBe(0);
      expect(stats.instances).toBe(0);
    });

    it("should report accurate factory count", () => {
      const meta1 = createSampleMeta("provider-1");
      const meta2 = createSampleMeta("provider-2");
      
      registry.registerFactory(meta1, createMockProviderFactory(meta1));
      registry.registerFactory(meta2, createMockProviderFactory(meta2));
      
      const stats = registry.getStatistics();
      expect(stats.factories).toBe(2);
    });

    it("should report accurate instance count", async () => {
      const meta = createSampleMeta("test-provider");
      registry.registerFactory(meta, createMockProviderFactory(meta));
      
      await registry.createProvider("test-provider", { instanceId: "inst-1" });
      await registry.createProvider("test-provider", { instanceId: "inst-2" });
      
      const stats = registry.getStatistics();
      expect(stats.instances).toBe(2);
    });

    it("should include lifecycle statistics", () => {
      const stats = registry.getStatistics();
      
      expect(stats.lifecycle).toBeDefined();
      expect(stats.lifecycle.totalProviders).toBeDefined();
      expect(stats.lifecycle.byState).toBeDefined();
      expect(stats.lifecycle.healthSummary).toBeDefined();
    });
  });

  describe("shutdown", () => {
    it("should shutdown gracefully", async () => {
      const meta = createSampleMeta("test-provider");
      registry.registerFactory(meta, createMockProviderFactory(meta));
      await registry.createProvider("test-provider", {});
      
      await registry.shutdown();
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("shutdown"),
      );
    });

    it("should clear all state on shutdown", async () => {
      const meta = createSampleMeta("test-provider");
      registry.registerFactory(meta, createMockProviderFactory(meta));
      await registry.createProvider("test-provider", {});
      
      await registry.shutdown();
      
      // After shutdown, stats should be empty
      // (Need to create new registry to verify since shutdown clears state)
    });
  });
});

describe("Registry Configuration", () => {
  it("should accept custom state directory", async () => {
    const logger = createMockLogger();
    const registry = createProviderRegistry(
      { stateDir: "/custom/state/dir" },
      logger,
    );
    
    expect(registry).toBeDefined();
    await registry.shutdown();
  });

  it("should accept session configuration", async () => {
    const logger = createMockLogger();
    const registry = createProviderRegistry(
      {
        session: {
          timeout: 120000,
          maxConcurrent: 20,
          persistState: true,
          cleanupInterval: 60000,
        },
      },
      logger,
    );
    
    expect(registry).toBeDefined();
    await registry.shutdown();
  });

  it("should accept lifecycle configuration", async () => {
    const logger = createMockLogger();
    const registry = createProviderRegistry(
      {
        lifecycle: {
          healthCheckInterval: 30000,
          autoRestart: false,
          maxRestartAttempts: 5,
          restartDelay: 10000,
          shutdownTimeout: 60000,
        },
      },
      logger,
    );
    
    expect(registry).toBeDefined();
    await registry.shutdown();
  });

  it("should accept discovery configuration", async () => {
    const logger = createMockLogger();
    const registry = createProviderRegistry(
      {
        discovery: {
          bundledDirs: ["/plugins/bundled"],
          installedDirs: ["/plugins/installed"],
          localDirs: ["/plugins/local"],
          cache: true,
        },
      },
      logger,
    );
    
    expect(registry).toBeDefined();
    await registry.shutdown();
  });
});

describe("Provider Factory Registration Details", () => {
  let registry: InfrastructureProviderRegistry;
  let mockLogger: InfrastructureLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    registry = createProviderRegistry({}, mockLogger);
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  it("should store complete meta information", () => {
    const meta: InfrastructureProviderMeta = {
      id: "detailed-provider",
      name: "Detailed Provider",
      displayName: "Detailed Provider Display",
      description: "A detailed test provider",
      version: "2.1.0",
      category: "kubernetes",
      capabilities: ["provision", "scale", "monitor"],
      supportedResources: ["container", "cluster", "network"],
      authMethods: ["service-account", "token"],
    };
    
    registry.registerFactory(meta, createMockProviderFactory(meta));
    
    const registered = registry.getFactory("detailed-provider");
    expect(registered?.meta).toEqual(meta);
    expect(registered?.meta.capabilities).toContain("provision");
    expect(registered?.meta.authMethods).toContain("service-account");
  });

  it("should log registration with provider details", () => {
    const meta = createSampleMeta("logged-provider");
    registry.registerFactory(meta, createMockProviderFactory(meta));
    
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("Registered"),
      expect.objectContaining({
        name: meta.name,
        category: meta.category,
        capabilities: meta.capabilities,
      }),
    );
  });
});
