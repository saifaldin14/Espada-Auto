/**
 * Infrastructure Configuration Validation
 *
 * This module provides schema-based validation for infrastructure
 * configuration using Zod.
 */

import { z } from "zod";
import type {
  InfrastructureConfigSchema,
} from "../types.js";

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Provider authentication config schema
 */
export const providerAuthConfigSchema = z.object({
  method: z.enum([
    "api-key",
    "oauth2",
    "service-account",
    "iam-role",
    "certificate",
    "token",
    "custom",
  ]),
  credentials: z.record(z.string(), z.string()).optional(),
  profile: z.string().optional(),
  region: z.string().optional(),
  endpoint: z.string().url().optional(),
  timeout: z.number().positive().optional(),
});

/**
 * Provider config entry schema
 */
export const providerConfigEntrySchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  auth: providerAuthConfigSchema,
  settings: z.record(z.string(), z.unknown()),
  resourceDefaults: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

/**
 * Session config schema
 */
export const sessionConfigSchema = z.object({
  timeout: z.number().positive().default(3600000),
  maxConcurrent: z.number().positive().default(10),
  persistState: z.boolean().default(true),
  stateDirectory: z.string().optional(),
  cleanupInterval: z.number().positive().default(300000),
});

/**
 * Command config schema
 */
export const commandConfigSchema = z.object({
  validation: z.object({
    strict: z.boolean().default(true),
    allowDryRun: z.boolean().default(true),
    requireConfirmation: z.boolean().default(false),
    dangerousCommandsRequireExplicit: z.boolean().default(true),
  }),
  execution: z.object({
    defaultTimeout: z.number().positive().default(60000),
    maxRetries: z.number().nonnegative().default(3),
    retryDelay: z.number().nonnegative().default(1000),
    parallelLimit: z.number().positive().default(5),
  }),
  history: z.object({
    enabled: z.boolean().default(true),
    maxEntries: z.number().positive().default(1000),
    retentionDays: z.number().positive().default(30),
  }),
});

/**
 * Log destination schema
 */
export const logDestinationSchema = z.object({
  type: z.enum(["console", "file", "remote"]),
  config: z.record(z.string(), z.unknown()),
  filter: z
    .object({
      minLevel: z.string().optional(),
      includeProviders: z.array(z.string()).optional(),
      excludeProviders: z.array(z.string()).optional(),
    })
    .optional(),
});

/**
 * Logging config schema
 */
export const loggingConfigSchema = z.object({
  level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  includeTimestamps: z.boolean().default(true),
  includeMetadata: z.boolean().default(true),
  destinations: z.array(logDestinationSchema).default([{ type: "console", config: {} }]),
  redactPatterns: z.array(z.string()).default([]),
});

/**
 * Security config schema
 */
export const securityConfigSchema = z.object({
  encryption: z.object({
    enabled: z.boolean().default(false),
    algorithm: z.string().default("aes-256-gcm"),
    keyRotationDays: z.number().positive().default(90),
  }),
  audit: z.object({
    enabled: z.boolean().default(true),
    logAllCommands: z.boolean().default(true),
    logSensitiveData: z.boolean().default(false),
  }),
  access: z.object({
    allowedUsers: z.array(z.string()).optional(),
    allowedGroups: z.array(z.string()).optional(),
    requireMfa: z.boolean().default(false),
  }),
});

/**
 * Full infrastructure config schema
 */
export const infrastructureConfigSchema = z.object({
  providers: z.array(providerConfigEntrySchema).default([]),
  defaultProvider: z.string().optional(),
  sessionConfig: sessionConfigSchema,
  commandConfig: commandConfigSchema,
  loggingConfig: loggingConfigSchema,
  securityConfig: securityConfigSchema,
});

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate infrastructure configuration
 */
export function validateInfrastructureConfig(
  config: unknown,
): ReturnType<typeof infrastructureConfigSchema.safeParse> {
  return infrastructureConfigSchema.safeParse(config);
}

/**
 * Validate provider configuration
 */
export function validateProviderConfig(
  config: unknown,
): ReturnType<typeof providerConfigEntrySchema.safeParse> {
  return providerConfigEntrySchema.safeParse(config);
}

/**
 * Validate session configuration
 */
export function validateSessionConfig(
  config: unknown,
): ReturnType<typeof sessionConfigSchema.safeParse> {
  return sessionConfigSchema.safeParse(config);
}

/**
 * Validate command configuration
 */
export function validateCommandConfig(
  config: unknown,
): ReturnType<typeof commandConfigSchema.safeParse> {
  return commandConfigSchema.safeParse(config);
}

/**
 * Validate logging configuration
 */
export function validateLoggingConfig(
  config: unknown,
): ReturnType<typeof loggingConfigSchema.safeParse> {
  return loggingConfigSchema.safeParse(config);
}

/**
 * Validate security configuration
 */
export function validateSecurityConfig(
  config: unknown,
): ReturnType<typeof securityConfigSchema.safeParse> {
  return securityConfigSchema.safeParse(config);
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Get default infrastructure configuration
 */
export function getDefaultInfrastructureConfig(): InfrastructureConfigSchema {
  return infrastructureConfigSchema.parse({});
}

/**
 * Merge partial config with defaults
 */
export function mergeWithDefaults(
  partial: Partial<InfrastructureConfigSchema>,
): InfrastructureConfigSchema {
  const defaults = getDefaultInfrastructureConfig();
  return {
    ...defaults,
    ...partial,
    sessionConfig: { ...defaults.sessionConfig, ...partial.sessionConfig },
    commandConfig: {
      ...defaults.commandConfig,
      ...partial.commandConfig,
      validation: { ...defaults.commandConfig.validation, ...partial.commandConfig?.validation },
      execution: { ...defaults.commandConfig.execution, ...partial.commandConfig?.execution },
      history: { ...defaults.commandConfig.history, ...partial.commandConfig?.history },
    },
    loggingConfig: { ...defaults.loggingConfig, ...partial.loggingConfig },
    securityConfig: {
      ...defaults.securityConfig,
      ...partial.securityConfig,
      encryption: { ...defaults.securityConfig.encryption, ...partial.securityConfig?.encryption },
      audit: { ...defaults.securityConfig.audit, ...partial.securityConfig?.audit },
      access: { ...defaults.securityConfig.access, ...partial.securityConfig?.access },
    },
  };
}

// =============================================================================
// JSON Schema Export
// =============================================================================

/**
 * Get JSON schema for infrastructure configuration
 * (for use in plugin manifests and documentation)
 */
export function getInfrastructureConfigJsonSchema(): Record<string, unknown> {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      providers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
            enabled: { type: "boolean" },
            auth: {
              type: "object",
              properties: {
                method: {
                  type: "string",
                  enum: [
                    "api-key",
                    "oauth2",
                    "service-account",
                    "iam-role",
                    "certificate",
                    "token",
                    "custom",
                  ],
                },
                credentials: { type: "object", additionalProperties: { type: "string" } },
                profile: { type: "string" },
                region: { type: "string" },
                endpoint: { type: "string", format: "uri" },
                timeout: { type: "number", minimum: 0 },
              },
              required: ["method"],
            },
            settings: { type: "object" },
            resourceDefaults: { type: "object" },
          },
          required: ["id", "enabled", "auth", "settings"],
        },
      },
      defaultProvider: { type: "string" },
      sessionConfig: {
        type: "object",
        properties: {
          timeout: { type: "number", minimum: 0, default: 3600000 },
          maxConcurrent: { type: "number", minimum: 1, default: 10 },
          persistState: { type: "boolean", default: true },
          stateDirectory: { type: "string" },
          cleanupInterval: { type: "number", minimum: 0, default: 300000 },
        },
      },
      commandConfig: {
        type: "object",
        properties: {
          validation: {
            type: "object",
            properties: {
              strict: { type: "boolean", default: true },
              allowDryRun: { type: "boolean", default: true },
              requireConfirmation: { type: "boolean", default: false },
              dangerousCommandsRequireExplicit: { type: "boolean", default: true },
            },
          },
          execution: {
            type: "object",
            properties: {
              defaultTimeout: { type: "number", minimum: 0, default: 60000 },
              maxRetries: { type: "number", minimum: 0, default: 3 },
              retryDelay: { type: "number", minimum: 0, default: 1000 },
              parallelLimit: { type: "number", minimum: 1, default: 5 },
            },
          },
          history: {
            type: "object",
            properties: {
              enabled: { type: "boolean", default: true },
              maxEntries: { type: "number", minimum: 1, default: 1000 },
              retentionDays: { type: "number", minimum: 1, default: 30 },
            },
          },
        },
      },
      loggingConfig: {
        type: "object",
        properties: {
          level: {
            type: "string",
            enum: ["trace", "debug", "info", "warn", "error", "fatal"],
            default: "info",
          },
          includeTimestamps: { type: "boolean", default: true },
          includeMetadata: { type: "boolean", default: true },
          destinations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["console", "file", "remote"] },
                config: { type: "object" },
                filter: {
                  type: "object",
                  properties: {
                    minLevel: { type: "string" },
                    includeProviders: { type: "array", items: { type: "string" } },
                    excludeProviders: { type: "array", items: { type: "string" } },
                  },
                },
              },
              required: ["type", "config"],
            },
          },
          redactPatterns: { type: "array", items: { type: "string" } },
        },
      },
      securityConfig: {
        type: "object",
        properties: {
          encryption: {
            type: "object",
            properties: {
              enabled: { type: "boolean", default: false },
              algorithm: { type: "string", default: "aes-256-gcm" },
              keyRotationDays: { type: "number", minimum: 1, default: 90 },
            },
          },
          audit: {
            type: "object",
            properties: {
              enabled: { type: "boolean", default: true },
              logAllCommands: { type: "boolean", default: true },
              logSensitiveData: { type: "boolean", default: false },
            },
          },
          access: {
            type: "object",
            properties: {
              allowedUsers: { type: "array", items: { type: "string" } },
              allowedGroups: { type: "array", items: { type: "string" } },
              requireMfa: { type: "boolean", default: false },
            },
          },
        },
      },
    },
  };
}
