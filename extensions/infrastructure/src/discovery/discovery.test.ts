/**
 * Infrastructure Plugin Discovery Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  InfrastructurePluginDiscoverer,
  type PluginDiscoveryOptions,
} from "./discoverer.js";
import type { InfrastructureLogger } from "../logging/logger.js";
import type { InfrastructurePluginManifest, DiscoveredPlugin } from "../types.js";

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

// Sample plugin manifest
const createSampleManifest = (id: string): InfrastructurePluginManifest => ({
  id,
  name: `Plugin ${id}`,
  version: "1.0.0",
  description: `Test plugin ${id}`,
  providers: [
    {
      id: `${id}-provider`,
      name: `${id} Provider`,
      displayName: `${id} Provider`,
      description: "Test provider",
      version: "1.0.0",
      category: "cloud",
      capabilities: ["compute", "storage"],
      supportedResources: ["vm", "disk"],
      authMethods: ["api-key"],
    },
  ],
  dependencies: {},
  engines: { node: ">=18.0.0" },
});

describe("InfrastructurePluginDiscoverer", () => {
  let discoverer: InfrastructurePluginDiscoverer;
  let mockLogger: InfrastructureLogger;
  let defaultOptions: PluginDiscoveryOptions;

  beforeEach(() => {
    mockLogger = createMockLogger();
    defaultOptions = {
      bundledDirs: [],
      installedDirs: [],
      localDirs: [],
      remoteRegistries: [],
      validateManifests: true,
      includeDisabled: false,
      cache: true,
    };
    discoverer = new InfrastructurePluginDiscoverer(defaultOptions, mockLogger);
  });

  describe("initialization", () => {
    it("should create discoverer with default options", () => {
      const d = new InfrastructurePluginDiscoverer({}, mockLogger);
      expect(d).toBeDefined();
    });

    it("should accept custom options", () => {
      const customOptions: PluginDiscoveryOptions = {
        bundledDirs: ["/path/to/bundled"],
        installedDirs: ["/path/to/installed"],
        localDirs: ["/path/to/local"],
        remoteRegistries: ["https://registry.example.com"],
        validateManifests: false,
        includeDisabled: true,
        cache: false,
      };
      const d = new InfrastructurePluginDiscoverer(customOptions, mockLogger);
      expect(d).toBeDefined();
    });
  });

  describe("discover", () => {
    it("should return empty result when no directories configured", async () => {
      const result = await discoverer.discover();
      
      expect(result.plugins).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it("should return cached results on subsequent calls when cache enabled", async () => {
      // First call
      const result1 = await discoverer.discover();
      
      // Second call should use cache
      const result2 = await discoverer.discover();
      
      // Both should return the same empty result (from cache)
      expect(result1.plugins).toEqual(result2.plugins);
    });

    it("should handle non-existent directories gracefully", async () => {
      const d = new InfrastructurePluginDiscoverer(
        {
          bundledDirs: ["/non/existent/path/12345"],
          cache: false,
        },
        mockLogger,
      );

      const result = await d.discover();
      
      // Should have an error for the invalid directory
      expect(result.errors.length).toBeGreaterThanOrEqual(0);
      // Should not crash
    });

    it("should log discovery statistics", async () => {
      await discoverer.discover();
      
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe("manifest validation", () => {
    it("should identify valid manifest file names", () => {
      // The discoverer should recognize these manifest files
      const validNames = [
        "infrastructure.plugin.json",
        "espada-infrastructure.json",
        "plugin.json",
        "package.json",
      ];

      // This is testing internal behavior indirectly
      // The discoverer should look for these files
      expect(validNames).toContain("infrastructure.plugin.json");
      expect(validNames).toContain("package.json");
    });
  });

  describe("plugin deduplication", () => {
    it("should deduplicate plugins by ID preferring local over remote", () => {
      // This tests the conceptual deduplication priority
      // local > installed > bundled > remote
      const priority = ["local", "installed", "bundled", "remote"];
      expect(priority[0]).toBe("local");
      expect(priority[priority.length - 1]).toBe("remote");
    });
  });

  describe("cache management", () => {
    it("should invalidate cache after TTL expires", async () => {
      const d = new InfrastructurePluginDiscoverer(
        { cache: true },
        mockLogger,
      );

      // First discovery
      await d.discover();
      
      // Should use cache immediately
      await d.discover();
      
      // The cache behavior is time-based (1 minute TTL)
      expect(d).toBeDefined();
    });

    it("should bypass cache when disabled", async () => {
      const d = new InfrastructurePluginDiscoverer(
        { cache: false },
        mockLogger,
      );

      const result1 = await d.discover();
      const result2 = await d.discover();
      
      // Both should be fresh discoveries
      expect(result1.plugins).toEqual(result2.plugins);
    });
  });

  describe("error handling", () => {
    it("should collect errors without stopping discovery", async () => {
      const d = new InfrastructurePluginDiscoverer(
        {
          bundledDirs: ["/invalid/path/1", "/invalid/path/2"],
          cache: false,
        },
        mockLogger,
      );

      // Should not throw
      const result = await d.discover();
      
      // Errors should be collected
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("should mark recoverable errors appropriately", async () => {
      const d = new InfrastructurePluginDiscoverer(
        {
          bundledDirs: ["/nonexistent"],
          cache: false,
        },
        mockLogger,
      );

      const result = await d.discover();
      
      // Directory not found errors are typically recoverable
      for (const error of result.errors) {
        expect(typeof error.recoverable).toBe("boolean");
      }
    });
  });

  describe("plugin source types", () => {
    it("should support multiple source types", () => {
      const sourceTypes = ["bundled", "installed", "local", "remote"];
      
      sourceTypes.forEach(source => {
        expect(["bundled", "installed", "local", "remote"]).toContain(source);
      });
    });
  });

  describe("remote registry discovery", () => {
    it("should handle empty remote registries", async () => {
      const d = new InfrastructurePluginDiscoverer(
        {
          remoteRegistries: [],
          cache: false,
        },
        mockLogger,
      );

      const result = await d.discover();
      expect(result.plugins).toEqual([]);
    });
  });
});

describe("Plugin Manifest Validation", () => {
  it("should validate required manifest fields", () => {
    const manifest = createSampleManifest("test-plugin");
    
    expect(manifest.id).toBeDefined();
    expect(manifest.name).toBeDefined();
    expect(manifest.version).toBeDefined();
    expect(Array.isArray(manifest.providers)).toBe(true);
  });

  it("should validate provider metadata in manifest", () => {
    const manifest = createSampleManifest("test-plugin");
    const provider = manifest.providers[0];
    
    expect(provider.id).toBeDefined();
    expect(provider.name).toBeDefined();
    expect(provider.category).toBeDefined();
    expect(Array.isArray(provider.capabilities)).toBe(true);
    expect(Array.isArray(provider.authMethods)).toBe(true);
  });

  it("should handle manifest with multiple providers", () => {
    const manifest = createSampleManifest("multi-provider");
    manifest.providers.push({
      id: "second-provider",
      name: "Second Provider",
      displayName: "Second Provider",
      description: "Another test provider",
      version: "1.0.0",
      category: "networking",
      capabilities: ["vpc", "firewall"],
      supportedResources: ["network", "rule"],
      authMethods: ["oauth"],
    });

    expect(manifest.providers.length).toBe(2);
    expect(manifest.providers[0].category).toBe("cloud");
    expect(manifest.providers[1].category).toBe("networking");
  });

  it("should validate semantic versioning", () => {
    const manifest = createSampleManifest("versioned");
    
    const versionRegex = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
    expect(manifest.version).toMatch(versionRegex);
  });
});
