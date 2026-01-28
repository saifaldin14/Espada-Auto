/**
 * Infrastructure Command Validation Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  InfrastructureCommandValidator,
  validateCommand,
} from "../src/validation/command-validator.js";
import type { CommandExecutionContext, InfrastructureCommand } from "../src/types.js";
import { createInfrastructureLogger } from "../src/logging/logger.js";

describe("InfrastructureCommandValidator", () => {
  let validator: InfrastructureCommandValidator;

  const testCommand: InfrastructureCommand = {
    id: "test-command",
    name: "Test Command",
    description: "A test command",
    category: "utility",
    parameters: [
      {
        name: "name",
        type: "string",
        description: "Resource name",
        required: true,
      },
      {
        name: "count",
        type: "number",
        description: "Instance count",
        required: false,
        default: 1,
        validation: {
          min: 1,
          max: 100,
        },
      },
      {
        name: "region",
        type: "string",
        description: "Region",
        required: false,
        validation: {
          enum: ["us-east-1", "us-west-2", "eu-west-1"],
        },
      },
      {
        name: "tags",
        type: "object",
        description: "Resource tags",
        required: false,
      },
    ],
    requiredCapabilities: ["provision"],
    supportsDryRun: true,
    dangerous: false,
    examples: [],
  };

  const validContext: CommandExecutionContext = {
    sessionId: "test-session",
    providerId: "test-provider",
    dryRun: false,
    timeout: 30000,
    environment: {},
    variables: {},
  };

  beforeEach(() => {
    const logger = createInfrastructureLogger("test-validation");
    validator = new InfrastructureCommandValidator({}, logger);
  });

  describe("parameter validation", () => {
    it("should pass with valid required parameters", async () => {
      const result = await validator.validate(testCommand, { name: "my-resource" }, validContext);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.coercedParameters.name).toBe("my-resource");
    });

    it("should fail when required parameter is missing", async () => {
      const result = await validator.validate(testCommand, {}, validContext);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("PARAMETER_VALIDATION_FAILED");
      expect(result.errors[0].path).toContain("name");
    });

    it("should use default values for optional parameters", async () => {
      const result = await validator.validate(testCommand, { name: "my-resource" }, validContext);

      expect(result.valid).toBe(true);
      expect(result.coercedParameters.count).toBe(1);
    });

    it("should validate number range", async () => {
      const result = await validator.validate(
        testCommand,
        { name: "my-resource", count: 150 },
        validContext,
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes("count"))).toBe(true);
    });

    it("should validate enum values", async () => {
      const result = await validator.validate(
        testCommand,
        { name: "my-resource", region: "invalid-region" },
        validContext,
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes("region"))).toBe(true);
    });

    it("should accept valid enum values", async () => {
      const result = await validator.validate(
        testCommand,
        { name: "my-resource", region: "us-east-1" },
        validContext,
      );

      expect(result.valid).toBe(true);
      expect(result.coercedParameters.region).toBe("us-east-1");
    });

    it("should fail on unknown parameters in strict mode", async () => {
      const result = await validator.validate(
        testCommand,
        { name: "my-resource", unknownParam: "value" },
        validContext,
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "UNKNOWN_PARAMETER")).toBe(true);
    });
  });

  describe("context validation", () => {
    it("should fail when session ID is missing", async () => {
      const invalidContext = { ...validContext, sessionId: "" };
      const result = await validator.validate(testCommand, { name: "test" }, invalidContext);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_SESSION")).toBe(true);
    });

    it("should fail when timeout is invalid", async () => {
      const invalidContext = { ...validContext, timeout: -1 };
      const result = await validator.validate(testCommand, { name: "test" }, invalidContext);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_TIMEOUT")).toBe(true);
    });

    it("should warn when dry-run is requested but not supported", async () => {
      const noDryRunCommand = { ...testCommand, supportsDryRun: false };
      const dryRunContext = { ...validContext, dryRun: true };

      const result = await validator.validate(noDryRunCommand, { name: "test" }, dryRunContext);

      expect(result.warnings.some((w) => w.code === "DRY_RUN_NOT_SUPPORTED")).toBe(true);
    });
  });

  describe("dangerous command validation", () => {
    const dangerousCommand: InfrastructureCommand = {
      ...testCommand,
      id: "dangerous-command",
      dangerous: true,
    };

    it("should warn about dangerous commands", async () => {
      const context = { ...validContext, variables: { __confirm_dangerous__: true } };
      const result = await validator.validate(dangerousCommand, { name: "test" }, context);

      expect(result.warnings.some((w) => w.code === "DANGEROUS_COMMAND")).toBe(true);
    });

    it("should fail dangerous commands without explicit confirmation", async () => {
      const strictValidator = new InfrastructureCommandValidator(
        { dangerousCommandsRequireExplicit: true },
        createInfrastructureLogger("test"),
      );

      const result = await strictValidator.validate(
        dangerousCommand,
        { name: "test" },
        validContext,
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "DANGEROUS_COMMAND_NOT_CONFIRMED")).toBe(true);
    });
  });
});

describe("validateCommand helper", () => {
  it("should validate command with default options", async () => {
    const command: InfrastructureCommand = {
      id: "simple-command",
      name: "Simple Command",
      description: "A simple command",
      category: "utility",
      parameters: [
        { name: "value", type: "string", description: "A value", required: true },
      ],
      requiredCapabilities: [],
      supportsDryRun: false,
      dangerous: false,
      examples: [],
    };

    const context: CommandExecutionContext = {
      sessionId: "test",
      providerId: "test",
      dryRun: false,
      timeout: 30000,
      environment: {},
      variables: {},
    };

    const result = await validateCommand(command, { value: "test" }, context);
    expect(result.valid).toBe(true);
  });
});
