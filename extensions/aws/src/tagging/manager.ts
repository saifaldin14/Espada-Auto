/**
 * AWS Resource Tagging Manager
 *
 * Provides standardized resource tagging with:
 * - Tag validation and enforcement
 * - Standard tag templates
 * - Bulk tagging operations
 * - Tag compliance checking
 */

import { ResourceGroupsTaggingAPIClient, TagResourcesCommand, UntagResourcesCommand, GetResourcesCommand } from "@aws-sdk/client-resource-groups-tagging-api";
import type { AWSCredentialsManager } from "../credentials/manager.js";
import type {
  AWSTag,
  StandardTagConfig,
  TagValidationResult,
  TagValidationError,
  TagValidationWarning,
  TagSuggestion,
  TaggingOperation,
  TaggingOperationResult,
  AWSCredentials,
} from "../types.js";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_KEY_LENGTH = 128;
const DEFAULT_MAX_VALUE_LENGTH = 256;
const DEFAULT_MAX_TAGS_PER_RESOURCE = 50;

const AWS_RESERVED_PREFIXES = ["aws:", "AWS:"];

const COMMON_TAG_KEYS = [
  "Name",
  "Environment",
  "Project",
  "Owner",
  "CostCenter",
  "Application",
  "Team",
  "Department",
  "Service",
  "Version",
  "ManagedBy",
  "CreatedBy",
  "CreatedAt",
  "UpdatedAt",
];

const SENSITIVE_TAG_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /key/i,
  /credential/i,
  /api[_-]?key/i,
];

// =============================================================================
// Tag Validator
// =============================================================================

type ResolvedTagConfig = {
  required: AWSTag[];
  optional: AWSTag[];
  prohibited: string[];
  keyPrefix?: string;
  keyPattern?: RegExp;
  valuePattern?: RegExp;
  maxKeyLength: number;
  maxValueLength: number;
  maxTagsPerResource: number;
  caseSensitive: boolean;
};

export class AWSTagValidator {
  private config: ResolvedTagConfig;

  constructor(config: Partial<StandardTagConfig> = {}) {
    this.config = {
      required: config.required ?? [],
      optional: config.optional ?? [],
      prohibited: config.prohibited ?? [],
      keyPrefix: config.keyPrefix,
      keyPattern: config.keyPattern,
      valuePattern: config.valuePattern,
      maxKeyLength: config.maxKeyLength ?? DEFAULT_MAX_KEY_LENGTH,
      maxValueLength: config.maxValueLength ?? DEFAULT_MAX_VALUE_LENGTH,
      maxTagsPerResource: config.maxTagsPerResource ?? DEFAULT_MAX_TAGS_PER_RESOURCE,
      caseSensitive: config.caseSensitive ?? true,
    };
  }

  /**
   * Validate a set of tags against the configuration
   */
  validate(tags: AWSTag[]): TagValidationResult {
    const errors: TagValidationError[] = [];
    const warnings: TagValidationWarning[] = [];
    const suggestions: TagSuggestion[] = [];

    // Check tag count
    if (tags.length > this.config.maxTagsPerResource) {
      errors.push({
        type: "too-many-tags",
        message: `Too many tags: ${tags.length} (max: ${this.config.maxTagsPerResource})`,
      });
    }

    // Check required tags
    for (const required of this.config.required) {
      const found = this.findTag(tags, required.key);
      if (!found) {
        errors.push({
          type: "missing-required",
          key: required.key,
          message: `Required tag "${required.key}" is missing`,
        });
        suggestions.push({
          key: required.key,
          suggestedValue: required.value,
          reason: "Required tag",
        });
      }
    }

    // Validate each tag
    for (const tag of tags) {
      // Check prohibited keys
      if (this.isProhibited(tag.key)) {
        errors.push({
          type: "prohibited-key",
          key: tag.key,
          message: `Tag key "${tag.key}" is prohibited`,
        });
        continue;
      }

      // Check AWS reserved prefixes
      if (AWS_RESERVED_PREFIXES.some((p) => tag.key.startsWith(p))) {
        errors.push({
          type: "prohibited-key",
          key: tag.key,
          message: `Tag key "${tag.key}" uses AWS reserved prefix`,
        });
        continue;
      }

      // Check key length
      if (tag.key.length > this.config.maxKeyLength) {
        errors.push({
          type: "too-long",
          key: tag.key,
          message: `Tag key "${tag.key}" exceeds max length (${this.config.maxKeyLength})`,
        });
      }

      // Check value length
      if (tag.value.length > this.config.maxValueLength) {
        errors.push({
          type: "too-long",
          key: tag.key,
          value: tag.value,
          message: `Tag value for "${tag.key}" exceeds max length (${this.config.maxValueLength})`,
        });
      }

      // Check key pattern
      if (this.config.keyPattern && !this.config.keyPattern.test(tag.key)) {
        errors.push({
          type: "invalid-format",
          key: tag.key,
          message: `Tag key "${tag.key}" does not match required pattern`,
        });
      }

      // Check value pattern
      if (this.config.valuePattern && !this.config.valuePattern.test(tag.value)) {
        errors.push({
          type: "invalid-format",
          key: tag.key,
          value: tag.value,
          message: `Tag value for "${tag.key}" does not match required pattern`,
        });
      }

      // Check key prefix
      if (this.config.keyPrefix && !tag.key.startsWith(this.config.keyPrefix)) {
        warnings.push({
          type: "non-standard-key",
          key: tag.key,
          message: `Tag key "${tag.key}" does not start with prefix "${this.config.keyPrefix}"`,
          suggestion: `${this.config.keyPrefix}${tag.key}`,
        });
      }

      // Check for empty value
      if (!tag.value || tag.value.trim() === "") {
        warnings.push({
          type: "empty-value",
          key: tag.key,
          value: tag.value,
          message: `Tag "${tag.key}" has an empty value`,
        });
      }

      // Check for non-standard keys
      if (!this.isStandardKey(tag.key)) {
        warnings.push({
          type: "non-standard-key",
          key: tag.key,
          message: `Tag key "${tag.key}" is not a standard tag key`,
        });
      }

      // Check for sensitive data in values
      for (const pattern of SENSITIVE_TAG_PATTERNS) {
        if (pattern.test(tag.key)) {
          warnings.push({
            type: "non-standard-key",
            key: tag.key,
            message: `Tag key "${tag.key}" may contain sensitive information`,
          });
          break;
        }
      }
    }

    // Suggest common missing tags
    for (const commonKey of COMMON_TAG_KEYS) {
      if (!this.findTag(tags, commonKey) && !this.config.required.some((r) => r.key === commonKey)) {
        suggestions.push({
          key: commonKey,
          reason: "Common best practice tag",
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions: suggestions.slice(0, 5), // Limit suggestions
    };
  }

  /**
   * Find a tag by key
   */
  private findTag(tags: AWSTag[], key: string): AWSTag | undefined {
    if (this.config.caseSensitive) {
      return tags.find((t) => t.key === key);
    }
    const lowerKey = key.toLowerCase();
    return tags.find((t) => t.key.toLowerCase() === lowerKey);
  }

  /**
   * Check if a key is prohibited
   */
  private isProhibited(key: string): boolean {
    if (this.config.caseSensitive) {
      return this.config.prohibited.includes(key);
    }
    const lowerKey = key.toLowerCase();
    return this.config.prohibited.some((p) => p.toLowerCase() === lowerKey);
  }

  /**
   * Check if a key is a standard tag key
   */
  private isStandardKey(key: string): boolean {
    if (this.config.caseSensitive) {
      return COMMON_TAG_KEYS.includes(key);
    }
    const lowerKey = key.toLowerCase();
    return COMMON_TAG_KEYS.some((k) => k.toLowerCase() === lowerKey);
  }

  /**
   * Get required tags
   */
  getRequiredTags(): AWSTag[] {
    return [...this.config.required];
  }

  /**
   * Get optional tags
   */
  getOptionalTags(): AWSTag[] {
    return [...this.config.optional];
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<StandardTagConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      required: config.required ?? this.config.required,
      optional: config.optional ?? this.config.optional,
      prohibited: config.prohibited ?? this.config.prohibited,
    };
  }
}

// =============================================================================
// Tagging Manager
// =============================================================================

export class AWSTaggingManager {
  private credentialsManager: AWSCredentialsManager;
  private validator: AWSTagValidator;
  private defaultTags: AWSTag[];

  constructor(
    credentialsManager: AWSCredentialsManager,
    config?: Partial<StandardTagConfig>,
    defaultTags?: AWSTag[],
  ) {
    this.credentialsManager = credentialsManager;
    this.validator = new AWSTagValidator(config);
    this.defaultTags = defaultTags ?? [];
  }

  /**
   * Apply tags to resources
   */
  async tagResources(
    resourceArns: string[],
    tags: AWSTag[],
    options: {
      region?: string;
      validateFirst?: boolean;
      includeDefaultTags?: boolean;
    } = {},
  ): Promise<TaggingOperationResult[]> {
    const results: TaggingOperationResult[] = [];
    const { validateFirst = true, includeDefaultTags = true } = options;

    // Merge with default tags
    let finalTags = includeDefaultTags
      ? this.mergeTags(this.defaultTags, tags)
      : tags;

    // Validate tags if requested
    if (validateFirst) {
      const validation = this.validator.validate(finalTags);
      if (!validation.valid) {
        return resourceArns.map((arn) => ({
          success: false,
          resourceArn: arn,
          operation: "add" as const,
          error: `Tag validation failed: ${validation.errors.map((e) => e.message).join("; ")}`,
        }));
      }
    }

    // Get credentials
    const credentials = await this.credentialsManager.getCredentials();
    const region = options.region ?? credentials.region;

    // Create client
    const client = new ResourceGroupsTaggingAPIClient({
      region,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    // Apply tags in batches (API supports up to 20 resources per call)
    const batchSize = 20;
    for (let i = 0; i < resourceArns.length; i += batchSize) {
      const batch = resourceArns.slice(i, i + batchSize);
      
      try {
        await client.send(new TagResourcesCommand({
          ResourceARNList: batch,
          Tags: Object.fromEntries(finalTags.map((t) => [t.key, t.value])),
        }));

        for (const arn of batch) {
          results.push({
            success: true,
            resourceArn: arn,
            operation: "add",
            tagsApplied: finalTags,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        for (const arn of batch) {
          results.push({
            success: false,
            resourceArn: arn,
            operation: "add",
            error: errorMessage,
          });
        }
      }
    }

    return results;
  }

  /**
   * Remove tags from resources
   */
  async untagResources(
    resourceArns: string[],
    tagKeys: string[],
    options: { region?: string } = {},
  ): Promise<TaggingOperationResult[]> {
    const results: TaggingOperationResult[] = [];

    // Get credentials
    const credentials = await this.credentialsManager.getCredentials();
    const region = options.region ?? credentials.region;

    // Create client
    const client = new ResourceGroupsTaggingAPIClient({
      region,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    // Remove tags in batches
    const batchSize = 20;
    for (let i = 0; i < resourceArns.length; i += batchSize) {
      const batch = resourceArns.slice(i, i + batchSize);
      
      try {
        await client.send(new UntagResourcesCommand({
          ResourceARNList: batch,
          TagKeys: tagKeys,
        }));

        for (const arn of batch) {
          results.push({
            success: true,
            resourceArn: arn,
            operation: "remove",
            tagsRemoved: tagKeys,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        for (const arn of batch) {
          results.push({
            success: false,
            resourceArn: arn,
            operation: "remove",
            error: errorMessage,
          });
        }
      }
    }

    return results;
  }

  /**
   * Update tags on resources (add/update and optionally remove others)
   */
  async updateTags(
    resourceArns: string[],
    tags: AWSTag[],
    options: {
      region?: string;
      removeOtherTags?: boolean;
      preserveKeys?: string[];
    } = {},
  ): Promise<TaggingOperationResult[]> {
    const { removeOtherTags = false, preserveKeys = [] } = options;
    const results: TaggingOperationResult[] = [];

    // First, apply new tags
    const addResults = await this.tagResources(resourceArns, tags, {
      region: options.region,
      validateFirst: true,
      includeDefaultTags: false,
    });
    results.push(...addResults);

    // Optionally remove other tags
    if (removeOtherTags) {
      const credentials = await this.credentialsManager.getCredentials();
      const region = options.region ?? credentials.region;

      const client = new ResourceGroupsTaggingAPIClient({
        region,
        credentials: {
          accessKeyId: credentials.credentials.accessKeyId,
          secretAccessKey: credentials.credentials.secretAccessKey,
          sessionToken: credentials.credentials.sessionToken,
        },
      });

      // Get current tags for each resource
      for (const arn of resourceArns) {
        try {
          const response = await client.send(new GetResourcesCommand({
            ResourceARNList: [arn],
          }));

          const resource = response.ResourceTagMappingList?.[0];
          if (!resource?.Tags) continue;

          // Find tags to remove
          const newTagKeys = new Set(tags.map((t) => t.key));
          const preserveSet = new Set(preserveKeys);
          const tagsToRemove = resource.Tags
            .filter((t) => t.Key && !newTagKeys.has(t.Key) && !preserveSet.has(t.Key))
            .map((t) => t.Key!)
            .filter((k) => !k.startsWith("aws:"));

          if (tagsToRemove.length > 0) {
            const removeResults = await this.untagResources([arn], tagsToRemove, {
              region: options.region,
            });
            results.push(...removeResults);
          }
        } catch {
          // Continue with other resources
        }
      }
    }

    return results;
  }

  /**
   * Execute a batch of tagging operations
   */
  async executeBatch(
    operations: TaggingOperation[],
    options: { region?: string } = {},
  ): Promise<TaggingOperationResult[]> {
    const results: TaggingOperationResult[] = [];

    // Group operations by action
    const addOps = operations.filter((o) => o.action === "add" || o.action === "update");
    const removeOps = operations.filter((o) => o.action === "remove");

    // Execute add/update operations
    for (const op of addOps) {
      const opResults = await this.tagResources([op.resourceArn], op.tags, {
        region: options.region,
        validateFirst: true,
        includeDefaultTags: false,
      });
      results.push(...opResults);
    }

    // Execute remove operations
    for (const op of removeOps) {
      const opResults = await this.untagResources(
        [op.resourceArn],
        op.tags.map((t) => t.key),
        { region: options.region },
      );
      results.push(...opResults);
    }

    return results;
  }

  /**
   * Get tags for a resource
   */
  async getResourceTags(
    resourceArn: string,
    options: { region?: string } = {},
  ): Promise<AWSTag[]> {
    const credentials = await this.credentialsManager.getCredentials();
    const region = options.region ?? credentials.region;

    const client = new ResourceGroupsTaggingAPIClient({
      region,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    const response = await client.send(new GetResourcesCommand({
      ResourceARNList: [resourceArn],
    }));

    const resource = response.ResourceTagMappingList?.[0];
    if (!resource?.Tags) return [];

    return resource.Tags
      .filter((t) => t.Key !== undefined && t.Value !== undefined)
      .map((t) => ({ key: t.Key!, value: t.Value! }));
  }

  /**
   * Validate tags without applying
   */
  validateTags(tags: AWSTag[]): TagValidationResult {
    return this.validator.validate(tags);
  }

  /**
   * Merge two tag sets (second takes precedence)
   */
  private mergeTags(base: AWSTag[], overlay: AWSTag[]): AWSTag[] {
    const tagMap = new Map<string, string>();
    
    for (const tag of base) {
      tagMap.set(tag.key, tag.value);
    }
    
    for (const tag of overlay) {
      tagMap.set(tag.key, tag.value);
    }
    
    return Array.from(tagMap.entries()).map(([key, value]) => ({ key, value }));
  }

  /**
   * Set default tags
   */
  setDefaultTags(tags: AWSTag[]): void {
    this.defaultTags = tags;
  }

  /**
   * Get default tags
   */
  getDefaultTags(): AWSTag[] {
    return [...this.defaultTags];
  }

  /**
   * Get the validator
   */
  getValidator(): AWSTagValidator {
    return this.validator;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an AWS tag validator
 */
export function createTagValidator(config?: Partial<StandardTagConfig>): AWSTagValidator {
  return new AWSTagValidator(config);
}

/**
 * Create an AWS tagging manager
 */
export function createTaggingManager(
  credentialsManager: AWSCredentialsManager,
  config?: Partial<StandardTagConfig>,
  defaultTags?: AWSTag[],
): AWSTaggingManager {
  return new AWSTaggingManager(credentialsManager, config, defaultTags);
}
