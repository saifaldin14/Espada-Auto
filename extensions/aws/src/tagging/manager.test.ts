/**
 * AWS Tag Validator & Tagging Manager - Comprehensive Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AWSTagValidator, AWSTaggingManager, createTagValidator, createTaggingManager } from "./manager.js";
import { AWSCredentialsManager } from "../credentials/manager.js";
import type { AWSTag } from "../types.js";

// Mock credentials manager
const mockCredentialsManager = {
  getCredentials: vi.fn().mockResolvedValue({
    credentials: {
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      source: "profile",
    },
    profile: "default",
    region: "us-east-1",
    accountId: "123456789012",
  }),
} as unknown as AWSCredentialsManager;

// Mock Resource Groups Tagging API client
vi.mock("@aws-sdk/client-resource-groups-tagging-api", () => {
  const mockTaggingSend = vi.fn().mockImplementation((command) => {
    if (command?.input?.ResourceARNList) {
      // TagResources or UntagResources
      return Promise.resolve({
        FailedResourcesMap: {},
      });
    }
    if (command?.input?.TagFilters !== undefined || command?.input?.ResourceTypeFilters !== undefined) {
      // GetResources
      return Promise.resolve({
        ResourceTagMappingList: [
          {
            ResourceARN: "arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0",
            Tags: [
              { Key: "Name", Value: "test-instance" },
              { Key: "Environment", Value: "production" },
            ],
          },
        ],
        PaginationToken: undefined,
      });
    }
    return Promise.resolve({});
  });

  const MockResourceGroupsTaggingAPIClient = class {
    send = mockTaggingSend;
    destroy = vi.fn();
    constructor(public config: unknown) {}
  };

  return {
    ResourceGroupsTaggingAPIClient: MockResourceGroupsTaggingAPIClient,
    TagResourcesCommand: vi.fn().mockImplementation((input) => ({ input })),
    UntagResourcesCommand: vi.fn().mockImplementation((input) => ({ input })),
    GetResourcesCommand: vi.fn().mockImplementation((input) => ({ input })),
  };
});

describe("AWSTagValidator", () => {
  describe("constructor", () => {
    it("should create with default config", () => {
      const validator = new AWSTagValidator();
      expect(validator).toBeInstanceOf(AWSTagValidator);
    });

    it("should accept required tags", () => {
      const validator = new AWSTagValidator({
        required: [{ key: "Environment", value: "production" }],
      });
      expect(validator).toBeInstanceOf(AWSTagValidator);
    });

    it("should accept optional tags", () => {
      const validator = new AWSTagValidator({
        optional: [{ key: "CostCenter", value: "" }],
      });
      expect(validator).toBeInstanceOf(AWSTagValidator);
    });

    it("should accept prohibited tags", () => {
      const validator = new AWSTagValidator({
        prohibited: ["TemporaryTag", "DoNotUse"],
      });
      expect(validator).toBeInstanceOf(AWSTagValidator);
    });

    it("should accept key prefix requirement", () => {
      const validator = new AWSTagValidator({
        keyPrefix: "mycompany:",
      });
      expect(validator).toBeInstanceOf(AWSTagValidator);
    });

    it("should accept key pattern as regex", () => {
      const validator = new AWSTagValidator({
        keyPattern: /^[A-Z][a-zA-Z0-9]*$/,
      });
      expect(validator).toBeInstanceOf(AWSTagValidator);
    });

    it("should accept value pattern as regex", () => {
      const validator = new AWSTagValidator({
        valuePattern: /^[a-z0-9-]+$/,
      });
      expect(validator).toBeInstanceOf(AWSTagValidator);
    });

    it("should accept custom max key length", () => {
      const validator = new AWSTagValidator({
        maxKeyLength: 64,
      });
      expect(validator).toBeInstanceOf(AWSTagValidator);
    });

    it("should accept custom max value length", () => {
      const validator = new AWSTagValidator({
        maxValueLength: 128,
      });
      expect(validator).toBeInstanceOf(AWSTagValidator);
    });

    it("should accept custom max tags per resource", () => {
      const validator = new AWSTagValidator({
        maxTagsPerResource: 25,
      });
      expect(validator).toBeInstanceOf(AWSTagValidator);
    });

    it("should accept case sensitivity setting", () => {
      const validator = new AWSTagValidator({
        caseSensitive: false,
      });
      expect(validator).toBeInstanceOf(AWSTagValidator);
    });
  });

  describe("validate", () => {
    it("should validate valid tags", () => {
      const validator = new AWSTagValidator();
      const result = validator.validate([
        { key: "Name", value: "my-resource" },
        { key: "Environment", value: "production" },
      ]);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect missing required tags", () => {
      const validator = new AWSTagValidator({
        required: [
          { key: "Environment", value: "" },
          { key: "Owner", value: "" },
        ],
      });
      
      const result = validator.validate([
        { key: "Name", value: "my-resource" },
      ]);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === "missing-required")).toBe(true);
    });

    it("should detect prohibited tags", () => {
      const validator = new AWSTagValidator({
        prohibited: ["TemporaryTag"],
      });
      
      const result = validator.validate([
        { key: "TemporaryTag", value: "some-value" },
      ]);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === "prohibited-key")).toBe(true);
    });

    it("should detect AWS reserved prefixes", () => {
      const validator = new AWSTagValidator();
      const result = validator.validate([
        { key: "aws:cloudformation:stack-name", value: "my-stack" },
      ]);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("reserved prefix"))).toBe(true);
    });

    it("should detect too long keys", () => {
      const validator = new AWSTagValidator({ maxKeyLength: 10 });
      const result = validator.validate([
        { key: "ThisKeyIsTooLong", value: "value" },
      ]);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === "too-long")).toBe(true);
    });

    it("should detect too long values", () => {
      const validator = new AWSTagValidator({ maxValueLength: 10 });
      const result = validator.validate([
        { key: "Name", value: "This value is way too long for the validator" },
      ]);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === "too-long")).toBe(true);
    });

    it("should detect too many tags", () => {
      const validator = new AWSTagValidator({ maxTagsPerResource: 3 });
      const result = validator.validate([
        { key: "Tag1", value: "value1" },
        { key: "Tag2", value: "value2" },
        { key: "Tag3", value: "value3" },
        { key: "Tag4", value: "value4" },
      ]);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === "too-many-tags")).toBe(true);
    });

    it("should warn about empty values", () => {
      const validator = new AWSTagValidator();
      const result = validator.validate([
        { key: "Name", value: "" },
      ]);
      
      expect(result.warnings.some((w) => w.type === "empty-value")).toBe(true);
    });

    it("should suggest common tags", () => {
      const validator = new AWSTagValidator({
        required: [{ key: "Environment", value: "" }],
      });
      const result = validator.validate([]);
      
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it("should validate with key prefix", () => {
      const validator = new AWSTagValidator({ keyPrefix: "mycompany:" });
      
      const valid = validator.validate([
        { key: "mycompany:Environment", value: "prod" },
      ]);
      expect(valid.valid).toBe(true);
      // May have warnings for non-standard key names, but valid
      
      const invalid = validator.validate([
        { key: "Environment", value: "prod" },
      ]);
      // keyPrefix mismatch creates a warning
      expect(invalid.warnings.some((w) => w.type === "non-standard-key")).toBe(true);
    });

    it("should validate with key pattern", () => {
      const validator = new AWSTagValidator({
        keyPattern: /^[A-Z][a-zA-Z]+$/,
      });
      
      const valid = validator.validate([
        { key: "Environment", value: "prod" },
      ]);
      expect(valid.valid).toBe(true);
      
      const invalid = validator.validate([
        { key: "invalid-key", value: "value" },
      ]);
      expect(invalid.valid).toBe(false);
    });

    it("should validate with value pattern", () => {
      const validator = new AWSTagValidator({
        valuePattern: /^[a-z0-9-]+$/,
      });
      
      const valid = validator.validate([
        { key: "Name", value: "my-resource-123" },
      ]);
      expect(valid.valid).toBe(true);
      
      const invalid = validator.validate([
        { key: "Name", value: "Invalid Value With Spaces" },
      ]);
      expect(invalid.valid).toBe(false);
    });

    it("should handle case insensitivity", () => {
      const validator = new AWSTagValidator({
        required: [{ key: "environment", value: "" }],
        caseSensitive: false,
      });
      
      const result = validator.validate([
        { key: "ENVIRONMENT", value: "prod" },
      ]);
      expect(result.valid).toBe(true);
    });

    it("should detect sensitive tag keys", () => {
      const validator = new AWSTagValidator();
      const result = validator.validate([
        { key: "DatabasePassword", value: "secret123" },
      ]);
      
      // Sensitive tag keys trigger a non-standard-key warning
      expect(result.warnings.some((w) => w.message.includes("sensitive"))).toBe(true);
    });

    it("should handle empty tags array", () => {
      const validator = new AWSTagValidator();
      const result = validator.validate([]);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect non-standard keys", () => {
      const validator = new AWSTagValidator();
      const result = validator.validate([
        { key: "NonStandardTag", value: "value" },
      ]);
      
      // Non-standard keys generate a warning
      expect(result.warnings.some((w) => w.type === "non-standard-key")).toBe(true);
    });
  });

  describe("getRequiredTags", () => {
    it("should return required tags", () => {
      const validator = new AWSTagValidator({
        required: [
          { key: "Environment", value: "" },
          { key: "Owner", value: "" },
        ],
      });
      
      const required = validator.getRequiredTags();
      expect(required).toHaveLength(2);
    });

    it("should return empty array when no required tags", () => {
      const validator = new AWSTagValidator();
      const required = validator.getRequiredTags();
      expect(required).toEqual([]);
    });
  });

  describe("getOptionalTags", () => {
    it("should return optional tags", () => {
      const validator = new AWSTagValidator({
        optional: [
          { key: "CostCenter", value: "" },
          { key: "Project", value: "" },
        ],
      });
      
      const optional = validator.getOptionalTags();
      expect(optional).toHaveLength(2);
    });

    it("should return empty array when no optional tags", () => {
      const validator = new AWSTagValidator();
      const optional = validator.getOptionalTags();
      expect(optional).toEqual([]);
    });
  });

  describe("updateConfig", () => {
    it("should update configuration", () => {
      const validator = new AWSTagValidator();
      validator.updateConfig({
        required: [{ key: "NewRequired", value: "" }],
        maxKeyLength: 64,
      });
      
      const required = validator.getRequiredTags();
      expect(required.some((t) => t.key === "NewRequired")).toBe(true);
    });

    it("should merge with existing config", () => {
      const validator = new AWSTagValidator({
        required: [{ key: "Original", value: "" }],
        maxKeyLength: 128,
      });
      
      validator.updateConfig({
        maxKeyLength: 64,
      });
      
      const required = validator.getRequiredTags();
      expect(required.some((t) => t.key === "Original")).toBe(true);
    });
  });
});

describe("AWSTaggingManager", () => {
  let manager: AWSTaggingManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AWSTaggingManager(mockCredentialsManager);
  });

  describe("constructor", () => {
    it("should create with credentials manager", () => {
      const m = new AWSTaggingManager(mockCredentialsManager);
      expect(m).toBeInstanceOf(AWSTaggingManager);
    });

    it("should accept config", () => {
      const m = new AWSTaggingManager(mockCredentialsManager, {
        required: [{ key: "Environment", value: "" }],
      });
      expect(m).toBeInstanceOf(AWSTaggingManager);
    });

    it("should accept default tags", () => {
      const m = new AWSTaggingManager(mockCredentialsManager, undefined, [
        { key: "ManagedBy", value: "Terraform" },
      ]);
      expect(m).toBeInstanceOf(AWSTaggingManager);
    });

    it("should accept config and default tags together", () => {
      const m = new AWSTaggingManager(
        mockCredentialsManager,
        { required: [{ key: "Environment", value: "" }] },
        [{ key: "ManagedBy", value: "Terraform" }]
      );
      expect(m).toBeInstanceOf(AWSTaggingManager);
    });
  });

  describe("tagResources", () => {
    it("should tag resources", async () => {
      const result = await manager.tagResources(
        ["arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0"],
        [{ key: "Environment", value: "production" }]
      );
      
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty("success");
      expect(result[0]).toHaveProperty("resourceArn");
    });

    it("should include default tags", async () => {
      const m = new AWSTaggingManager(mockCredentialsManager, undefined, [
        { key: "ManagedBy", value: "AWS-Plugin" },
      ]);
      
      const result = await m.tagResources(
        ["arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0"],
        [{ key: "Environment", value: "production" }]
      );
      
      expect(result).toBeInstanceOf(Array);
    });

    it("should validate tags before applying", async () => {
      const m = new AWSTaggingManager(mockCredentialsManager, {
        required: [{ key: "Owner", value: "" }],
      });
      
      const result = await m.tagResources(
        ["arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0"],
        [{ key: "Environment", value: "production" }],
        { validateFirst: true }
      );
      
      // Validation should fail due to missing required tag - returns error in results
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].success).toBe(false);
    });

    it("should skip validation when requested", async () => {
      const m = new AWSTaggingManager(mockCredentialsManager, {
        required: [{ key: "Owner", value: "" }],
      });
      
      const result = await m.tagResources(
        ["arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0"],
        [{ key: "Environment", value: "production" }],
        { validateFirst: false }
      );
      
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBe(1);
    });

    it("should tag multiple resources", async () => {
      const result = await manager.tagResources(
        [
          "arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0",
          "arn:aws:ec2:us-east-1:123456789012:instance/i-0987654321fedcba0",
        ],
        [{ key: "Environment", value: "production" }]
      );
      
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBe(2);
    });

    it("should handle empty resource list", async () => {
      const result = await manager.tagResources(
        [],
        [{ key: "Environment", value: "production" }]
      );
      
      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(0);
    });

    it("should handle empty tags list", async () => {
      const result = await manager.tagResources(
        ["arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0"],
        []
      );
      
      expect(result).toBeInstanceOf(Array);
    });
  });

  describe("untagResources", () => {
    it("should remove tags from resources", async () => {
      const result = await manager.untagResources(
        ["arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0"],
        ["Environment", "Project"]
      );
      
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBe(1);
      expect(result[0]).toHaveProperty("success");
      expect(result[0].operation).toBe("remove");
    });

    it("should handle single tag key removal", async () => {
      const result = await manager.untagResources(
        ["arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0"],
        ["Environment"]
      );
      
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBe(1);
    });
  });

  describe("getResourceTags", () => {
    it("should get tags for a resource", async () => {
      const tags = await manager.getResourceTags(
        "arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0"
      );
      
      expect(tags).toBeInstanceOf(Array);
    });
  });

  describe("validateTags", () => {
    it("should validate tags without applying", () => {
      const result = manager.validateTags([
        { key: "Environment", value: "production" },
        { key: "Owner", value: "team-a" },
      ]);
      
      expect(result).toHaveProperty("valid");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("warnings");
    });
  });

  describe("setDefaultTags", () => {
    it("should update default tags", () => {
      manager.setDefaultTags([
        { key: "ManagedBy", value: "Terraform" },
        { key: "Project", value: "MyProject" },
      ]);
      
      const defaults = manager.getDefaultTags();
      expect(defaults).toHaveLength(2);
    });
  });

  describe("getDefaultTags", () => {
    it("should return default tags", () => {
      const m = new AWSTaggingManager(mockCredentialsManager, undefined, [
        { key: "ManagedBy", value: "AWS-Plugin" },
      ]);
      
      const defaults = m.getDefaultTags();
      expect(defaults).toHaveLength(1);
      expect(defaults[0].key).toBe("ManagedBy");
    });

    it("should return empty array when no defaults", () => {
      const defaults = manager.getDefaultTags();
      expect(defaults).toEqual([]);
    });
  });

  describe("getValidator", () => {
    it("should return the validator", () => {
      const validator = manager.getValidator();
      expect(validator).toBeInstanceOf(AWSTagValidator);
    });
  });
});

describe("createTagValidator", () => {
  it("should create a tag validator instance", () => {
    const validator = createTagValidator();
    expect(validator).toBeInstanceOf(AWSTagValidator);
  });

  it("should pass config to the validator", () => {
    const validator = createTagValidator({
      required: [{ key: "Environment", value: "" }],
      maxKeyLength: 64,
    });
    expect(validator).toBeInstanceOf(AWSTagValidator);
  });
});

describe("createTaggingManager", () => {
  it("should create a tagging manager instance", () => {
    const manager = createTaggingManager(mockCredentialsManager);
    expect(manager).toBeInstanceOf(AWSTaggingManager);
  });

  it("should pass config and default tags", () => {
    const manager = createTaggingManager(
      mockCredentialsManager,
      { required: [{ key: "Environment", value: "" }] },
      [{ key: "ManagedBy", value: "Terraform" }]
    );
    expect(manager).toBeInstanceOf(AWSTaggingManager);
  });
});
