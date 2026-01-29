/**
 * Infrastructure Extension Framework - Integration Tests
 *
 * These tests verify that multiple components work together correctly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { InfrastructureProviderRegistry, type RegistryOptions } from "./registry.js";
import { InfrastructureLifecycleManager } from "./lifecycle/manager.js";
import { InfrastructureSessionManager, InMemorySessionStorage } from "./session/index.js";
import { createInfrastructureLogger, type InfrastructureLogger } from "./logging/index.js";
import { BaseInfrastructureProvider, type HealthCheckItem } from "./provider.js";
import type {
  InfrastructureCommand,
  InfrastructureProviderMeta,
  CommandExecutionContext,
  CommandExecutionResult,
  ValidationResult,
  ProviderAuthConfig,
} from "./types.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestLogger(): InfrastructureLogger {
  return {
    subsystem: "test",
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => createTestLogger(),
    withContext: () => createTestLogger(),
    setLevel: vi.fn(),
    getLevel: () => "info",
    isLevelEnabled: () => true,
  } as InfrastructureLogger;
}

/**
 * Simple test provider that implements the correct interfaces
 */
class TestProvider extends BaseInfrastructureProvider {
  private _started = false;
  private _initialized = false;
  public executedCommands: Array<{ commandId: string; parameters: Record<string, unknown> }> = [];

  readonly meta: InfrastructureProviderMeta;

  constructor(id: string) {
    super(createInfrastructureLogger(id));
    this.meta = {
      id,
      name: `Test Provider ${id}`,
      displayName: `Test Provider ${id}`,
      description: `Integration test provider ${id}`,
      version: "1.0.0",
      category: "cloud",
      capabilities: ["provision", "deprovision", "monitor"],
      supportedResources: ["compute", "storage", "network"],
      authMethods: ["api-key"],
    };
    this.registerTestCommands();
  }

  private registerTestCommands(): void {
    this.registerCommand({
      id: "create-vm",
      name: "Create VM",
      description: "Create a virtual machine",
      category: "provision",
      parameters: [
        { name: "name", type: "string", required: true, description: "VM name" },
        { name: "size", type: "string", required: true, description: "VM size" },
      ],
      requiredCapabilities: ["provision"],
      supportsDryRun: true,
      dangerous: false,
      examples: [],
    });

    this.registerCommand({
      id: "delete-vm",
      name: "Delete VM",
      description: "Delete a virtual machine",
      category: "provision",
      parameters: [
        { name: "vmId", type: "string", required: true, description: "VM ID" },
      ],
      requiredCapabilities: ["deprovision"],
      supportsDryRun: true,
      dangerous: true,
      examples: [],
    });

    this.registerCommand({
      id: "list-vms",
      name: "List VMs",
      description: "List all virtual machines",
      category: "monitor",
      parameters: [],
      requiredCapabilities: ["monitor"],
      supportsDryRun: false,
      dangerous: false,
      examples: [],
    });
  }

  protected async onInitialize(_auth: ProviderAuthConfig): Promise<void> {
    this._initialized = true;
  }

  protected async onStart(): Promise<void> {
    if (!this._initialized) throw new Error("Not initialized");
    this._started = true;
  }

  protected async onStop(): Promise<void> {
    this._started = false;
  }

  protected async onDestroy(): Promise<void> {
    this._started = false;
    this._initialized = false;
  }

  protected async performHealthChecks(): Promise<HealthCheckItem[]> {
    return [
      { name: "status", status: this._started ? "healthy" : "unhealthy" },
    ];
  }

  protected async onValidateConfig(): Promise<ValidationResult> {
    return { valid: true, errors: [], warnings: [] };
  }

  protected async onExecuteCommand<T>(
    command: InfrastructureCommand,
    parameters: Record<string, unknown>,
    _context: CommandExecutionContext,
    _log: (entry: Omit<CommandExecutionResult["logs"][0], "timestamp">) => void,
  ): Promise<Omit<CommandExecutionResult<T>, "duration" | "logs">> {
    this.executedCommands.push({ commandId: command.id, parameters });
    
    switch (command.id) {
      case "create-vm":
        return {
          success: true,
          data: { vmId: `vm-${Date.now()}`, name: parameters.name } as T,
          resourcesAffected: [],
          rollbackAvailable: true,
        };
      case "delete-vm":
        return {
          success: true,
          data: { deleted: true } as T,
          resourcesAffected: [parameters.vmId as string],
          rollbackAvailable: false,
        };
      case "list-vms":
        return {
          success: true,
          data: { vms: [{ id: "vm-1", name: "test-vm" }] } as T,
          resourcesAffected: [],
          rollbackAvailable: false,
        };
      default:
        return { 
          success: false, 
          error: { code: "UNKNOWN", message: "Unknown command", recoverable: false },
          resourcesAffected: [],
          rollbackAvailable: false,
        };
    }
  }

  get isStarted(): boolean {
    return this._started;
  }

  get isInitialized(): boolean {
    return this._initialized;
  }
}

// =============================================================================
// Integration Tests
// =============================================================================

describe("Infrastructure Integration Tests", () => {
  let logger: InfrastructureLogger;
  let registry: InfrastructureProviderRegistry;
  let lifecycleManager: InfrastructureLifecycleManager;
  let sessionManager: InfrastructureSessionManager;

  const defaultRegistryOptions: RegistryOptions = {
    autoDiscover: false,
    autoStart: false,
  };

  beforeEach(() => {
    logger = createTestLogger();
    registry = new InfrastructureProviderRegistry(defaultRegistryOptions, logger);
    lifecycleManager = new InfrastructureLifecycleManager(
      {
        healthCheckInterval: 60000,
        autoRestart: false,
        maxRestartAttempts: 3,
        restartDelay: 1000,
        shutdownTimeout: 5000,
      },
      logger,
    );
    sessionManager = new InfrastructureSessionManager({
      storage: new InMemorySessionStorage(),
      config: {
        timeout: 3600000,
        maxConcurrent: 10,
        cleanupInterval: 60000,
        persistState: false,
      },
      logger,
    });
  });

  describe("Provider Registration and Lifecycle", () => {
    it("should register provider factory and create instance", async () => {
      const provider = new TestProvider("test-provider");
      
      registry.registerFactory(provider.meta, async () => provider);
      
      const factory = registry.getFactory("test-provider");
      expect(factory).toBeDefined();
      expect(factory?.meta.id).toBe("test-provider");
    });

    it("should initialize and start provider through lifecycle manager", async () => {
      const provider = new TestProvider("test-provider");
      
      lifecycleManager.registerProvider(provider);
      await lifecycleManager.initializeProvider("test-provider", { method: "api-key" });
      await lifecycleManager.startProvider("test-provider");
      
      expect(provider.isInitialized).toBe(true);
      expect(provider.isStarted).toBe(true);
      expect(lifecycleManager.getProviderState("test-provider")).toBe("active");
    });

    it("should stop provider through lifecycle manager", async () => {
      const provider = new TestProvider("test-provider");
      
      lifecycleManager.registerProvider(provider);
      await lifecycleManager.initializeProvider("test-provider", { method: "api-key" });
      await lifecycleManager.startProvider("test-provider");
      await lifecycleManager.stopProvider("test-provider");
      
      expect(lifecycleManager.getProviderState("test-provider")).toBe("suspended");
    });

    it("should unregister provider", async () => {
      const provider = new TestProvider("test-provider");
      
      lifecycleManager.registerProvider(provider);
      await lifecycleManager.initializeProvider("test-provider", { method: "api-key" });
      await lifecycleManager.unregisterProvider("test-provider");
      
      expect(lifecycleManager.getProviderState("test-provider")).toBeNull();
    });
  });

  describe("Session Management", () => {
    it("should create session with provider metadata", async () => {
      const provider = new TestProvider("test-provider");
      
      const session = await sessionManager.createSession({
        providerId: "test-provider",
        providerMeta: provider.meta,
        auth: { method: "api-key" },
        userId: "user-1",
      });
      
      expect(session.id).toBeDefined();
      expect(session.providerId).toBe("test-provider");
      expect(session.state).toBe("active");
    });

    it("should retrieve existing session", async () => {
      const provider = new TestProvider("test-provider");
      
      const created = await sessionManager.createSession({
        providerId: "test-provider",
        providerMeta: provider.meta,
        auth: { method: "api-key" },
        userId: "user-1",
      });
      
      const retrieved = await sessionManager.getSession(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it("should terminate session", async () => {
      const provider = new TestProvider("test-provider");
      
      const session = await sessionManager.createSession({
        providerId: "test-provider",
        providerMeta: provider.meta,
        auth: { method: "api-key" },
      });
      
      await sessionManager.terminateSession(session.id);
      const terminated = await sessionManager.getSession(session.id);
      expect(terminated?.state).toBe("terminated");
    });
  });

  describe("Command Execution", () => {
    it("should execute command through provider", async () => {
      const provider = new TestProvider("test-provider");
      
      lifecycleManager.registerProvider(provider);
      await lifecycleManager.initializeProvider("test-provider", { method: "api-key" });
      await lifecycleManager.startProvider("test-provider");
      
      const context: CommandExecutionContext = {
        sessionId: "test-session",
        userId: "user-1",
        providerId: "test-provider",
        dryRun: false,
        timeout: 30000,
        environment: {},
        variables: {},
      };
      
      const result = await provider.executeCommand("create-vm", { name: "test-vm", size: "small" }, context);
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(provider.executedCommands).toHaveLength(1);
      expect(provider.executedCommands[0].commandId).toBe("create-vm");
    });

    it("should list available commands", async () => {
      const provider = new TestProvider("test-provider");
      
      const commands = provider.getCommands();
      
      expect(commands).toHaveLength(3);
      expect(commands.map(c => c.id)).toContain("create-vm");
      expect(commands.map(c => c.id)).toContain("delete-vm");
      expect(commands.map(c => c.id)).toContain("list-vms");
    });
  });

  describe("Health Checks", () => {
    it("should perform health check on active provider", async () => {
      const provider = new TestProvider("test-provider");
      
      lifecycleManager.registerProvider(provider);
      await lifecycleManager.initializeProvider("test-provider", { method: "api-key" });
      await lifecycleManager.startProvider("test-provider");
      
      const health = await provider.healthCheck();
      
      expect(health.status).toBe("healthy");
      expect(health.checks).toHaveLength(1);
      expect(health.checks[0].name).toBe("status");
    });
  });

  describe("Multi-Provider Scenarios", () => {
    it("should manage multiple providers independently", async () => {
      const provider1 = new TestProvider("provider-1");
      const provider2 = new TestProvider("provider-2");
      
      lifecycleManager.registerProvider(provider1);
      lifecycleManager.registerProvider(provider2);
      
      await lifecycleManager.initializeProvider("provider-1", { method: "api-key" });
      await lifecycleManager.initializeProvider("provider-2", { method: "api-key" });
      
      await lifecycleManager.startProvider("provider-1");
      // provider-2 stays in ready state
      
      expect(lifecycleManager.getProviderState("provider-1")).toBe("active");
      expect(lifecycleManager.getProviderState("provider-2")).toBe("ready");
    });

    it("should track statistics for multiple providers", async () => {
      const provider1 = new TestProvider("provider-1");
      const provider2 = new TestProvider("provider-2");
      
      lifecycleManager.registerProvider(provider1);
      lifecycleManager.registerProvider(provider2);
      
      const stats = lifecycleManager.getStatistics();
      
      expect(stats.totalProviders).toBe(2);
    });
  });

  describe("Error Handling", () => {
    it("should handle initialization failure gracefully", async () => {
      const provider = new TestProvider("failing-provider");
      
      // Override initialize to fail
      vi.spyOn(provider as any, "onInitialize").mockRejectedValue(new Error("Init failed"));
      
      lifecycleManager.registerProvider(provider);
      
      await expect(
        lifecycleManager.initializeProvider("failing-provider", { method: "api-key" })
      ).rejects.toThrow();
      
      expect(lifecycleManager.getProviderState("failing-provider")).toBe("error");
    });

    it("should return error for unknown command", async () => {
      const provider = new TestProvider("test-provider");
      
      lifecycleManager.registerProvider(provider);
      await lifecycleManager.initializeProvider("test-provider", { method: "api-key" });
      await lifecycleManager.startProvider("test-provider");
      
      const context: CommandExecutionContext = {
        sessionId: "test-session",
        providerId: "test-provider",
        dryRun: false,
        timeout: 30000,
        environment: {},
        variables: {},
      };
      
      const result = await provider.executeCommand("non-existent", {}, context);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
