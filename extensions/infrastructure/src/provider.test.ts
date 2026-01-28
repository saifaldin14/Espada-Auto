/**
 * Infrastructure Provider Interface Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BaseInfrastructureProvider,
  type HealthCheckItem,
  type InfrastructureProvider,
} from "../src/provider.js";
import type {
  CommandExecutionContext,
  CommandExecutionResult,
  InfrastructureCommand,
  InfrastructureProviderMeta,
  ProviderAuthConfig,
  ValidationResult,
} from "../src/types.js";
import { createInfrastructureLogger } from "../src/logging/logger.js";

// Test implementation of BaseInfrastructureProvider
class TestProvider extends BaseInfrastructureProvider {
  readonly meta: InfrastructureProviderMeta = {
    id: "test-provider",
    name: "Test Provider",
    displayName: "Test Provider",
    description: "A test infrastructure provider",
    version: "1.0.0",
    category: "custom",
    capabilities: ["provision", "deprovision", "monitor"],
    supportedResources: ["compute", "storage"],
    authMethods: ["api-key"],
  };

  initializeCalled = false;
  startCalled = false;
  stopCalled = false;
  destroyCalled = false;
  lastAuth: ProviderAuthConfig | null = null;

  constructor() {
    super(createInfrastructureLogger("test"));
  }

  protected async onInitialize(auth: ProviderAuthConfig): Promise<void> {
    this.initializeCalled = true;
    this.lastAuth = auth;
  }

  protected async onStart(): Promise<void> {
    this.startCalled = true;
  }

  protected async onStop(): Promise<void> {
    this.stopCalled = true;
  }

  protected async onDestroy(): Promise<void> {
    this.destroyCalled = true;
  }

  protected async performHealthChecks(): Promise<HealthCheckItem[]> {
    return [
      { name: "connectivity", status: "healthy" },
      { name: "auth", status: "healthy" },
    ];
  }

  protected async onValidateConfig(_config: Record<string, unknown>): Promise<ValidationResult> {
    return { valid: true, errors: [], warnings: [] };
  }

  protected async onExecuteCommand<T>(
    command: InfrastructureCommand,
    _parameters: Record<string, unknown>,
    _context: CommandExecutionContext,
    _log: (entry: { level: "trace" | "debug" | "info" | "warn" | "error"; message: string }) => void,
  ): Promise<Omit<CommandExecutionResult<T>, "duration" | "logs">> {
    return {
      success: true,
      data: { commandId: command.id } as T,
      resourcesAffected: [],
      rollbackAvailable: false,
    };
  }
}

describe("BaseInfrastructureProvider", () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
  });

  describe("lifecycle", () => {
    it("should start in uninitialized state", () => {
      expect(provider.state).toBe("uninitialized");
    });

    it("should initialize successfully", async () => {
      const auth: ProviderAuthConfig = {
        method: "api-key",
        credentials: { apiKey: "test-key" },
      };

      await provider.initialize(auth);

      expect(provider.state).toBe("ready");
      expect(provider.initializeCalled).toBe(true);
      expect(provider.lastAuth).toEqual(auth);
    });

    it("should not allow double initialization", async () => {
      const auth: ProviderAuthConfig = { method: "api-key" };
      await provider.initialize(auth);

      await expect(provider.initialize(auth)).rejects.toThrow(
        "Cannot initialize provider in state: ready",
      );
    });

    it("should start after initialization", async () => {
      await provider.initialize({ method: "api-key" });
      await provider.start();

      expect(provider.state).toBe("active");
      expect(provider.startCalled).toBe(true);
    });

    it("should not allow start without initialization", async () => {
      await expect(provider.start()).rejects.toThrow(
        "Cannot start provider in state: uninitialized",
      );
    });

    it("should stop an active provider", async () => {
      await provider.initialize({ method: "api-key" });
      await provider.start();
      await provider.stop();

      expect(provider.state).toBe("suspended");
      expect(provider.stopCalled).toBe(true);
    });

    it("should destroy a provider", async () => {
      await provider.initialize({ method: "api-key" });
      await provider.start();
      await provider.stop();
      await provider.destroy();

      expect(provider.state).toBe("terminated");
      expect(provider.destroyCalled).toBe(true);
    });
  });

  describe("health checks", () => {
    it("should perform health checks", async () => {
      await provider.initialize({ method: "api-key" });
      const health = await provider.healthCheck();

      expect(health.status).toBe("healthy");
      expect(health.checks).toHaveLength(2);
      expect(health.checks[0].name).toBe("connectivity");
      expect(health.timestamp).toBeInstanceOf(Date);
    });
  });

  describe("capabilities", () => {
    it("should return capabilities", () => {
      const capabilities = provider.getCapabilities();
      expect(capabilities).toContain("provision");
      expect(capabilities).toContain("deprovision");
      expect(capabilities).toContain("monitor");
    });

    it("should check capability existence", () => {
      expect(provider.hasCapability("provision")).toBe(true);
      expect(provider.hasCapability("backup")).toBe(false);
    });
  });

  describe("resources", () => {
    it("should return supported resources", () => {
      const resources = provider.getSupportedResources();
      expect(resources).toContain("compute");
      expect(resources).toContain("storage");
    });
  });

  describe("lifecycle hooks", () => {
    it("should register and trigger lifecycle hooks", async () => {
      const hookFn = vi.fn();
      provider.onLifecycle("afterInit", hookFn);

      await provider.initialize({ method: "api-key" });

      expect(hookFn).toHaveBeenCalledTimes(1);
      expect(hookFn).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: "test-provider",
          state: "ready",
        }),
      );
    });

    it("should allow unregistering hooks", async () => {
      const hookFn = vi.fn();
      const unregister = provider.onLifecycle("afterInit", hookFn);

      unregister();
      await provider.initialize({ method: "api-key" });

      expect(hookFn).not.toHaveBeenCalled();
    });
  });
});
