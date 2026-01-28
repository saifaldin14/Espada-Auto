/**
 * Infrastructure SDK Tests
 */

import { describe, it, expect } from "vitest";
import {
  defineProvider,
  defineCommand,
  createSimpleProvider,
  success,
  failure,
  validation,
} from "../src/sdk/index.js";
import { createInfrastructureLogger } from "../src/logging/logger.js";

describe("SDK Builders", () => {
  describe("defineProvider", () => {
    it("should build provider metadata", () => {
      const meta = defineProvider()
        .id("my-provider")
        .name("My Provider")
        .displayName("My Provider Display")
        .description("A custom provider")
        .version("2.0.0")
        .category("cloud")
        .capabilities("provision", "monitor")
        .supportedResources("compute", "storage")
        .authMethods("api-key", "oauth2")
        .documentation("https://docs.example.com")
        .build();

      expect(meta.id).toBe("my-provider");
      expect(meta.name).toBe("My Provider");
      expect(meta.displayName).toBe("My Provider Display");
      expect(meta.description).toBe("A custom provider");
      expect(meta.version).toBe("2.0.0");
      expect(meta.category).toBe("cloud");
      expect(meta.capabilities).toEqual(["provision", "monitor"]);
      expect(meta.supportedResources).toEqual(["compute", "storage"]);
      expect(meta.authMethods).toEqual(["api-key", "oauth2"]);
      expect(meta.documentation).toBe("https://docs.example.com");
    });

    it("should require id", () => {
      expect(() => defineProvider().name("Test").build()).toThrow("Provider ID is required");
    });

    it("should require name", () => {
      expect(() => defineProvider().id("test").build()).toThrow("Provider name is required");
    });

    it("should use defaults for optional fields", () => {
      const meta = defineProvider().id("simple").name("Simple Provider").build();

      expect(meta.displayName).toBe("Simple Provider");
      expect(meta.description).toBe("");
      expect(meta.version).toBe("1.0.0");
      expect(meta.category).toBe("custom");
      expect(meta.capabilities).toEqual([]);
      expect(meta.supportedResources).toEqual([]);
      expect(meta.authMethods).toEqual(["api-key"]);
    });
  });

  describe("defineCommand", () => {
    it("should build command definition", () => {
      const command = defineCommand()
        .id("create-instance")
        .name("Create Instance")
        .description("Create a new compute instance")
        .category("provision")
        .stringParam("name", "Instance name", { required: true })
        .numberParam("memory", "Memory in GB", { default: 4, validation: { min: 1, max: 64 } })
        .booleanParam("autoStart", "Auto-start instance", { default: true })
        .requiredCapabilities("provision")
        .supportsDryRun()
        .dangerous()
        .example("Create basic instance", { name: "my-instance", memory: 4 })
        .build();

      expect(command.id).toBe("create-instance");
      expect(command.name).toBe("Create Instance");
      expect(command.description).toBe("Create a new compute instance");
      expect(command.category).toBe("provision");
      expect(command.parameters).toHaveLength(3);
      expect(command.requiredCapabilities).toEqual(["provision"]);
      expect(command.supportsDryRun).toBe(true);
      expect(command.dangerous).toBe(true);
      expect(command.examples).toHaveLength(1);
    });

    it("should require id", () => {
      expect(() => defineCommand().name("Test").build()).toThrow("Command ID is required");
    });

    it("should require name", () => {
      expect(() => defineCommand().id("test").build()).toThrow("Command name is required");
    });

    it("should create proper parameter definitions", () => {
      const command = defineCommand()
        .id("test")
        .name("Test")
        .stringParam("str", "String param", { required: true, sensitive: true })
        .numberParam("num", "Number param", { validation: { min: 0, max: 100 } })
        .booleanParam("bool", "Boolean param", { default: false })
        .parameter({
          name: "custom",
          type: "object",
          description: "Custom param",
          required: false,
        })
        .build();

      expect(command.parameters).toHaveLength(4);

      const strParam = command.parameters.find((p) => p.name === "str");
      expect(strParam?.type).toBe("string");
      expect(strParam?.required).toBe(true);
      expect(strParam?.sensitive).toBe(true);

      const numParam = command.parameters.find((p) => p.name === "num");
      expect(numParam?.type).toBe("number");
      expect(numParam?.validation?.min).toBe(0);
      expect(numParam?.validation?.max).toBe(100);

      const boolParam = command.parameters.find((p) => p.name === "bool");
      expect(boolParam?.type).toBe("boolean");
      expect(boolParam?.default).toBe(false);
    });
  });
});

describe("SimpleInfrastructureProvider", () => {
  it("should create a working provider", async () => {
    const meta = defineProvider()
      .id("simple-test")
      .name("Simple Test Provider")
      .category("custom")
      .capabilities("provision")
      .build();

    const command = defineCommand()
      .id("test-command")
      .name("Test Command")
      .stringParam("input", "Input value", { required: true })
      .build();

    let initialized = false;
    let started = false;

    const provider = createSimpleProvider(
      {
        meta,
        commands: [command],
        async onInitialize(_auth, logger) {
          logger.info("Initializing simple provider");
          initialized = true;
        },
        async onStart(logger) {
          logger.info("Starting simple provider");
          started = true;
        },
        async onHealthCheck() {
          return [{ name: "test", status: "healthy" }];
        },
        async onExecuteCommand(cmd, params) {
          if (cmd.id === "test-command") {
            return success({ echo: params.input }, []);
          }
          return failure("UNKNOWN_COMMAND", "Unknown command");
        },
      },
      createInfrastructureLogger("simple-test"),
    );

    // Test lifecycle
    await provider.initialize({ method: "api-key" });
    expect(initialized).toBe(true);
    expect(provider.state).toBe("ready");

    await provider.start();
    expect(started).toBe(true);
    expect(provider.state).toBe("active");

    // Test health check
    const health = await provider.healthCheck();
    expect(health.status).toBe("healthy");

    // Test command execution
    const result = await provider.executeCommand(
      "test-command",
      { input: "hello" },
      {
        sessionId: "test",
        providerId: "simple-test",
        dryRun: false,
        timeout: 30000,
        environment: {},
        variables: {},
      },
    );

    expect(result.success).toBe(true);
    expect((result.data as { echo: string }).echo).toBe("hello");

    // Test cleanup
    await provider.stop();
    expect(provider.state).toBe("suspended");

    await provider.destroy();
    expect(provider.state).toBe("terminated");
  });

  it("should return registered commands", () => {
    const command1 = defineCommand().id("cmd1").name("Command 1").build();
    const command2 = defineCommand().id("cmd2").name("Command 2").build();

    const provider = createSimpleProvider({
      meta: defineProvider().id("test").name("Test").build(),
      commands: [command1, command2],
    });

    const commands = provider.getCommands();
    expect(commands).toHaveLength(2);
    expect(commands.map((c) => c.id)).toContain("cmd1");
    expect(commands.map((c) => c.id)).toContain("cmd2");
  });
});

describe("Result Helpers", () => {
  describe("success", () => {
    it("should create success result", () => {
      const result = success({ value: 42 }, ["resource-1"]);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ value: 42 });
      expect(result.resourcesAffected).toEqual(["resource-1"]);
      expect(result.error).toBeUndefined();
    });
  });

  describe("failure", () => {
    it("should create failure result", () => {
      const result = failure("TEST_ERROR", "Something went wrong", {
        details: { field: "value" },
        recoverable: true,
        rollbackAvailable: true,
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TEST_ERROR");
      expect(result.error?.message).toBe("Something went wrong");
      expect(result.error?.details).toEqual({ field: "value" });
      expect(result.error?.recoverable).toBe(true);
      expect(result.rollbackAvailable).toBe(true);
    });
  });

  describe("validation", () => {
    it("should create ok validation result", () => {
      const result = validation.ok();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should create error validation result", () => {
      const result = validation.error("INVALID", "Invalid value", ["field"]);
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("INVALID");
      expect(result.errors[0].message).toBe("Invalid value");
      expect(result.errors[0].path).toEqual(["field"]);
    });

    it("should create warning validation result", () => {
      const result = validation.warning("DEPRECATED", "Deprecated field", ["oldField"]);
      expect(result.valid).toBe(true);
      expect(result.warnings[0].code).toBe("DEPRECATED");
    });
  });
});
