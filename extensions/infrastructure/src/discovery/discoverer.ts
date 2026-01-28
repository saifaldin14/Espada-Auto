/**
 * Infrastructure Plugin Discovery System
 *
 * This module provides automatic discovery of infrastructure plugins
 * from various sources including bundled, installed, and local plugins.
 */

import type {
  DiscoveredPlugin,
  InfrastructurePluginManifest,
  PluginDiscoveryError,
  PluginDiscoveryResult,
} from "../types.js";
import type { InfrastructureLogger } from "../logging/logger.js";

// =============================================================================
// Discovery Types
// =============================================================================

/**
 * Plugin source type
 */
export type PluginSource = "bundled" | "installed" | "local" | "remote";

/**
 * Discovery options
 */
export type PluginDiscoveryOptions = {
  /** Directories to search for bundled plugins */
  bundledDirs?: string[];
  /** Directories to search for installed plugins */
  installedDirs?: string[];
  /** Directories to search for local plugins */
  localDirs?: string[];
  /** Remote registry URLs */
  remoteRegistries?: string[];
  /** File patterns to match for plugin manifests */
  manifestPatterns?: string[];
  /** Whether to validate manifests during discovery */
  validateManifests?: boolean;
  /** Whether to include disabled plugins */
  includeDisabled?: boolean;
  /** Cache discovered plugins */
  cache?: boolean;
};

/**
 * Plugin manifest file names
 */
const MANIFEST_FILE_NAMES = [
  "infrastructure.plugin.json",
  "espada-infrastructure.json",
  "plugin.json",
  "package.json",
];

// =============================================================================
// Plugin Discovery Implementation
// =============================================================================

/**
 * Infrastructure plugin discoverer
 */
export class InfrastructurePluginDiscoverer {
  private options: Required<PluginDiscoveryOptions>;
  private logger: InfrastructureLogger;
  private cache: Map<string, DiscoveredPlugin> = new Map();
  private cacheTime: number = 0;
  private cacheTtl: number = 60000; // 1 minute

  constructor(options: PluginDiscoveryOptions, logger: InfrastructureLogger) {
    this.options = {
      bundledDirs: options.bundledDirs ?? [],
      installedDirs: options.installedDirs ?? [],
      localDirs: options.localDirs ?? [],
      remoteRegistries: options.remoteRegistries ?? [],
      manifestPatterns: options.manifestPatterns ?? MANIFEST_FILE_NAMES,
      validateManifests: options.validateManifests ?? true,
      includeDisabled: options.includeDisabled ?? false,
      cache: options.cache ?? true,
    };
    this.logger = logger;
  }

  /**
   * Discover all plugins from configured sources
   */
  async discover(): Promise<PluginDiscoveryResult> {
    // Check cache
    if (this.options.cache && this.isCacheValid()) {
      return {
        plugins: Array.from(this.cache.values()),
        errors: [],
      };
    }

    const plugins: DiscoveredPlugin[] = [];
    const errors: PluginDiscoveryError[] = [];

    // Discover from all sources
    const bundled = await this.discoverFromDirectories(this.options.bundledDirs, "bundled");
    plugins.push(...bundled.plugins);
    errors.push(...bundled.errors);

    const installed = await this.discoverFromDirectories(this.options.installedDirs, "installed");
    plugins.push(...installed.plugins);
    errors.push(...installed.errors);

    const local = await this.discoverFromDirectories(this.options.localDirs, "local");
    plugins.push(...local.plugins);
    errors.push(...local.errors);

    // Discover from remote registries
    for (const registry of this.options.remoteRegistries) {
      const remote = await this.discoverFromRegistry(registry);
      plugins.push(...remote.plugins);
      errors.push(...remote.errors);
    }

    // Deduplicate by plugin ID (prefer local > installed > bundled > remote)
    const deduplicated = this.deduplicatePlugins(plugins);

    // Update cache
    if (this.options.cache) {
      this.cache.clear();
      for (const plugin of deduplicated) {
        this.cache.set(plugin.manifest.id, plugin);
      }
      this.cacheTime = Date.now();
    }

    this.logger.info(`Discovered ${deduplicated.length} infrastructure plugins`, {
      bundled: bundled.plugins.length,
      installed: installed.plugins.length,
      local: local.plugins.length,
      errors: errors.length,
    });

    return { plugins: deduplicated, errors };
  }

  /**
   * Discover plugins from directories
   */
  private async discoverFromDirectories(
    directories: string[],
    source: PluginSource,
  ): Promise<PluginDiscoveryResult> {
    const plugins: DiscoveredPlugin[] = [];
    const errors: PluginDiscoveryError[] = [];

    for (const dir of directories) {
      try {
        const result = await this.scanDirectory(dir, source);
        plugins.push(...result.plugins);
        errors.push(...result.errors);
      } catch (error) {
        errors.push({
          path: dir,
          error: `Failed to scan directory: ${error}`,
          recoverable: true,
        });
      }
    }

    return { plugins, errors };
  }

  /**
   * Scan a directory for plugins
   */
  private async scanDirectory(
    directory: string,
    source: PluginSource,
  ): Promise<PluginDiscoveryResult> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const plugins: DiscoveredPlugin[] = [];
    const errors: PluginDiscoveryError[] = [];

    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          // Check for manifest in subdirectory
          const result = await this.loadPluginFromDirectory(fullPath, source);
          if (result.plugin) {
            plugins.push(result.plugin);
          }
          if (result.error) {
            errors.push(result.error);
          }
        } else if (entry.isFile() && this.isManifestFile(entry.name)) {
          // Direct manifest file
          const result = await this.loadManifest(fullPath, directory, source);
          if (result.plugin) {
            plugins.push(result.plugin);
          }
          if (result.error) {
            errors.push(result.error);
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        errors.push({
          path: directory,
          error: `Failed to read directory: ${error}`,
          recoverable: true,
        });
      }
    }

    return { plugins, errors };
  }

  /**
   * Load a plugin from a directory
   */
  private async loadPluginFromDirectory(
    directory: string,
    source: PluginSource,
  ): Promise<{ plugin?: DiscoveredPlugin; error?: PluginDiscoveryError }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    for (const manifestName of this.options.manifestPatterns) {
      const manifestPath = path.join(directory, manifestName);
      try {
        await fs.access(manifestPath);
        return this.loadManifest(manifestPath, directory, source);
      } catch {
        // Manifest not found, try next pattern
      }
    }

    return {};
  }

  /**
   * Load a manifest file
   */
  private async loadManifest(
    manifestPath: string,
    pluginDir: string,
    source: PluginSource,
  ): Promise<{ plugin?: DiscoveredPlugin; error?: PluginDiscoveryError }> {
    const fs = await import("node:fs/promises");

    try {
      const content = await fs.readFile(manifestPath, "utf-8");
      const rawManifest = JSON.parse(content);

      // Extract infrastructure plugin manifest
      const manifest = this.extractInfrastructureManifest(rawManifest, pluginDir);
      if (!manifest) {
        return {}; // Not an infrastructure plugin
      }

      // Validate manifest if enabled
      if (this.options.validateManifests) {
        const validationErrors = this.validateManifest(manifest);
        if (validationErrors.length > 0) {
          return {
            error: {
              path: manifestPath,
              error: `Invalid manifest: ${validationErrors.join(", ")}`,
              recoverable: true,
            },
          };
        }
      }

      return {
        plugin: {
          manifest,
          path: pluginDir,
          source,
          loadedAt: new Date(),
        },
      };
    } catch (error) {
      return {
        error: {
          path: manifestPath,
          error: `Failed to load manifest: ${error}`,
          recoverable: true,
        },
      };
    }
  }

  /**
   * Extract infrastructure manifest from raw JSON
   */
  private extractInfrastructureManifest(
    raw: Record<string, unknown>,
    pluginDir: string,
  ): InfrastructurePluginManifest | null {
    // Type guard for espada field
    const espada = raw.espada as Record<string, unknown> | undefined;
    
    // Check for explicit infrastructure plugin format
    if (raw.type === "infrastructure-plugin" || espada?.type === "infrastructure") {
      return {
        id: (raw.id as string) ?? (raw.name as string) ?? pluginDir.split("/").pop() ?? "unknown",
        name: (raw.name as string) ?? (raw.id as string) ?? "Unknown Plugin",
        version: (raw.version as string) ?? "0.0.0",
        description: (raw.description as string) ?? "",
        author: raw.author as string | undefined,
        license: raw.license as string | undefined,
        homepage: raw.homepage as string | undefined,
        repository: raw.repository as string | undefined,
        providers: (raw.providers as InfrastructurePluginManifest["providers"]) ?? [],
        commands: (raw.commands as InfrastructurePluginManifest["commands"]) ?? [],
        dependencies: raw.dependencies as Record<string, string> | undefined,
        peerDependencies: raw.peerDependencies as Record<string, string> | undefined,
      };
    }

    // Check for infrastructure section in package.json
    const infraSection = espada?.infrastructure ?? raw.infrastructure;
    if (infraSection && typeof infraSection === "object") {
      const infra = infraSection as Record<string, unknown>;
      return {
        id: (infra.id as string) ?? (raw.name as string) ?? "unknown",
        name: (infra.name as string) ?? (raw.name as string) ?? "Unknown Plugin",
        version: (raw.version as string) ?? "0.0.0",
        description: (infra.description as string) ?? (raw.description as string) ?? "",
        author: raw.author as string | undefined,
        license: raw.license as string | undefined,
        homepage: raw.homepage as string | undefined,
        repository: raw.repository as string | undefined,
        providers: (infra.providers as InfrastructurePluginManifest["providers"]) ?? [],
        commands: (infra.commands as InfrastructurePluginManifest["commands"]) ?? [],
        dependencies: raw.dependencies as Record<string, string> | undefined,
        peerDependencies: raw.peerDependencies as Record<string, string> | undefined,
      };
    }

    return null;
  }

  /**
   * Validate a manifest
   */
  private validateManifest(manifest: InfrastructurePluginManifest): string[] {
    const errors: string[] = [];

    if (!manifest.id || typeof manifest.id !== "string") {
      errors.push("Missing or invalid plugin ID");
    }

    if (!manifest.name || typeof manifest.name !== "string") {
      errors.push("Missing or invalid plugin name");
    }

    if (!manifest.version || typeof manifest.version !== "string") {
      errors.push("Missing or invalid plugin version");
    }

    // Validate providers
    if (manifest.providers) {
      for (const provider of manifest.providers) {
        if (!provider.id) errors.push("Provider missing ID");
        if (!provider.name) errors.push("Provider missing name");
      }
    }

    // Validate commands
    if (manifest.commands) {
      for (const command of manifest.commands) {
        if (!command.id) errors.push("Command missing ID");
        if (!command.name) errors.push("Command missing name");
      }
    }

    return errors;
  }

  /**
   * Check if a filename is a manifest file
   */
  private isManifestFile(filename: string): boolean {
    return this.options.manifestPatterns.includes(filename);
  }

  /**
   * Discover plugins from a remote registry
   */
  private async discoverFromRegistry(registryUrl: string): Promise<PluginDiscoveryResult> {
    const plugins: DiscoveredPlugin[] = [];
    const errors: PluginDiscoveryError[] = [];

    try {
      const response = await fetch(`${registryUrl}/infrastructure-plugins`);
      if (!response.ok) {
        throw new Error(`Registry returned ${response.status}`);
      }

      const data = (await response.json()) as { plugins?: InfrastructurePluginManifest[] };
      if (data.plugins && Array.isArray(data.plugins)) {
        for (const manifest of data.plugins) {
          if (this.options.validateManifests) {
            const validationErrors = this.validateManifest(manifest);
            if (validationErrors.length > 0) {
              errors.push({
                path: `${registryUrl}/${manifest.id}`,
                error: `Invalid manifest: ${validationErrors.join(", ")}`,
                recoverable: true,
              });
              continue;
            }
          }

          plugins.push({
            manifest,
            path: registryUrl,
            source: "remote",
            loadedAt: new Date(),
          });
        }
      }
    } catch (error) {
      errors.push({
        path: registryUrl,
        error: `Failed to fetch from registry: ${error}`,
        recoverable: true,
      });
    }

    return { plugins, errors };
  }

  /**
   * Deduplicate plugins by ID
   */
  private deduplicatePlugins(plugins: DiscoveredPlugin[]): DiscoveredPlugin[] {
    const byId = new Map<string, DiscoveredPlugin>();
    const priority: Record<PluginSource, number> = {
      local: 3,
      installed: 2,
      bundled: 1,
      remote: 0,
    };

    for (const plugin of plugins) {
      const existing = byId.get(plugin.manifest.id);
      if (!existing || priority[plugin.source] > priority[existing.source]) {
        byId.set(plugin.manifest.id, plugin);
      }
    }

    return Array.from(byId.values());
  }

  /**
   * Check if cache is valid
   */
  private isCacheValid(): boolean {
    return this.cache.size > 0 && Date.now() - this.cacheTime < this.cacheTtl;
  }

  /**
   * Clear the discovery cache
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheTime = 0;
  }

  /**
   * Get a specific plugin by ID
   */
  async getPlugin(pluginId: string): Promise<DiscoveredPlugin | null> {
    const result = await this.discover();
    return result.plugins.find((p) => p.manifest.id === pluginId) ?? null;
  }

  /**
   * Search plugins by query
   */
  async searchPlugins(query: string): Promise<DiscoveredPlugin[]> {
    const result = await this.discover();
    const lowerQuery = query.toLowerCase();

    return result.plugins.filter((p) => {
      const manifest = p.manifest;
      return (
        manifest.id.toLowerCase().includes(lowerQuery) ||
        manifest.name.toLowerCase().includes(lowerQuery) ||
        manifest.description.toLowerCase().includes(lowerQuery) ||
        manifest.providers.some(
          (pr) =>
            pr.id.toLowerCase().includes(lowerQuery) || pr.name.toLowerCase().includes(lowerQuery),
        )
      );
    });
  }
}

/**
 * Create a plugin discoverer
 */
export function createPluginDiscoverer(
  options: PluginDiscoveryOptions,
  logger: InfrastructureLogger,
): InfrastructurePluginDiscoverer {
  return new InfrastructurePluginDiscoverer(options, logger);
}

/**
 * Discover infrastructure plugins with default options
 */
export async function discoverInfrastructurePlugins(
  options?: Partial<PluginDiscoveryOptions>,
  logger?: InfrastructureLogger,
): Promise<PluginDiscoveryResult> {
  const log =
    logger ?? (await import("../logging/logger.js")).getInfrastructureLogger("discovery");
  const discoverer = createPluginDiscoverer(options ?? {}, log);
  return discoverer.discover();
}
