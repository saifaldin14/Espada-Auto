/**
 * Cross-Cloud Migration Engine — Input Validation
 *
 * Runtime validation guards for gateway and tool params.
 * Every external entry point must pass through these validators
 * before touching domain logic.
 */

import type { MigrationProvider, MigrationResourceType } from "./types.js";

// =============================================================================
// Validation Result
// =============================================================================

export type ValidationError = {
  field: string;
  message: string;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

/** Build a successful validation result. */
export function valid(): ValidationResult {
  return { ok: true };
}

/** Build a failed validation result. */
export function invalid(...errors: ValidationError[]): ValidationResult {
  return { ok: false, errors };
}

/** Merge multiple validation results. */
export function mergeValidations(...results: ValidationResult[]): ValidationResult {
  const errors: ValidationError[] = [];
  for (const r of results) {
    if (!r.ok) errors.push(...r.errors);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** Format validation errors into a human-readable string. */
export function formatErrors(result: ValidationResult): string {
  if (result.ok) return "";
  return result.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
}

// =============================================================================
// Primitive Validators
// =============================================================================

const VALID_PROVIDERS = new Set<string>([
  "aws", "azure", "gcp", "on-premises", "vmware", "nutanix",
]);

const VALID_RESOURCE_TYPES = new Set<string>([
  "vm", "disk", "object-storage", "database", "dns", "security-rules", "load-balancer",
  "iam-role", "iam-policy", "secret", "kms-key", "lambda-function", "api-gateway",
  "container-service", "container-registry", "vpc", "subnet", "route-table",
  "queue", "notification-topic", "cdn", "certificate", "waf-rule",
  "nosql-database", "cache", "auto-scaling-group",
  "step-function", "event-bus", "file-system", "transit-gateway", "vpn-connection",
  "vpc-endpoint", "parameter-store", "iam-user", "iam-group", "identity-provider",
  "log-group", "alarm", "data-pipeline", "stream", "graph-database",
  "data-warehouse", "bucket-policy", "listener-rule", "network-acl",
]);

const VALID_PHASES = new Set<string>([
  "created", "assessing", "planning", "awaiting-approval", "executing",
  "verifying", "cutting-over", "completed", "rolling-back", "rolled-back", "failed",
]);

/**
 * Validate that a value is a non-empty string.
 */
export function validateRequiredString(field: string, value: unknown): ValidationResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalid({ field, message: "must be a non-empty string" });
  }
  return valid();
}

/**
 * Validate that a value is an optional string (can be undefined/null, but if present must be non-empty).
 */
export function validateOptionalString(field: string, value: unknown): ValidationResult {
  if (value === undefined || value === null) return valid();
  return validateRequiredString(field, value);
}

/**
 * Validate a migration provider string.
 */
export function validateProvider(field: string, value: unknown): ValidationResult {
  if (typeof value !== "string" || !VALID_PROVIDERS.has(value)) {
    return invalid({
      field,
      message: `must be one of: ${[...VALID_PROVIDERS].join(", ")} (got ${JSON.stringify(value)})`,
    });
  }
  return valid();
}

/**
 * Validate an optional migration provider string.
 */
export function validateOptionalProvider(field: string, value: unknown): ValidationResult {
  if (value === undefined || value === null) return valid();
  return validateProvider(field, value);
}

/**
 * Validate a resource type string.
 */
export function validateResourceType(field: string, value: unknown): ValidationResult {
  if (typeof value !== "string" || !VALID_RESOURCE_TYPES.has(value)) {
    return invalid({
      field,
      message: `must be a valid resource type (got ${JSON.stringify(value)})`,
    });
  }
  return valid();
}

/**
 * Validate an array of resource types.
 */
export function validateResourceTypes(field: string, value: unknown): ValidationResult {
  if (!Array.isArray(value)) {
    return invalid({ field, message: "must be an array of resource types" });
  }
  const errors: ValidationError[] = [];
  for (let i = 0; i < value.length; i++) {
    const r = validateResourceType(`${field}[${i}]`, value[i]);
    if (!r.ok) errors.push(...r.errors);
  }
  return errors.length > 0 ? { ok: false, errors } : valid();
}

/**
 * Validate a phase string.
 */
export function validatePhase(field: string, value: unknown): ValidationResult {
  if (typeof value !== "string" || !VALID_PHASES.has(value)) {
    return invalid({
      field,
      message: `must be a valid phase (got ${JSON.stringify(value)})`,
    });
  }
  return valid();
}

/**
 * Validate a positive number within bounds.
 */
export function validateNumber(
  field: string,
  value: unknown,
  opts: { min?: number; max?: number; required?: boolean } = {},
): ValidationResult {
  const { min, max, required = false } = opts;
  if (value === undefined || value === null) {
    return required ? invalid({ field, message: "is required" }) : valid();
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid({ field, message: "must be a finite number" });
  }
  if (min !== undefined && value < min) {
    return invalid({ field, message: `must be >= ${min} (got ${value})` });
  }
  if (max !== undefined && value > max) {
    return invalid({ field, message: `must be <= ${max} (got ${value})` });
  }
  return valid();
}

/**
 * Validate a UUID-like job ID string (non-empty, reasonable length).
 */
export function validateJobId(field: string, value: unknown): ValidationResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalid({ field, message: "must be a non-empty string" });
  }
  if (value.length > 256) {
    return invalid({ field, message: "exceeds maximum length of 256 characters" });
  }
  return valid();
}

/**
 * Validate an optional boolean.
 */
export function validateOptionalBoolean(field: string, value: unknown): ValidationResult {
  if (value === undefined || value === null) return valid();
  if (typeof value !== "boolean") {
    return invalid({ field, message: "must be a boolean" });
  }
  return valid();
}

// =============================================================================
// Composite validators for common param shapes
// =============================================================================

/**
 * Validate the assess migration params.
 */
export function validateAssessParams(params: Record<string, unknown>): ValidationResult {
  return mergeValidations(
    validateProvider("sourceProvider", params.sourceProvider),
    validateProvider("targetProvider", params.targetProvider),
    validateRequiredString("targetRegion", params.targetRegion),
  );
}

/**
 * Validate the plan migration params.
 */
export function validatePlanParams(params: Record<string, unknown>): ValidationResult {
  return mergeValidations(
    validateProvider("sourceProvider", params.sourceProvider),
    validateProvider("targetProvider", params.targetProvider),
    validateRequiredString("targetRegion", params.targetRegion),
    validateOptionalString("name", params.name),
    validateOptionalString("description", params.description),
    validateOptionalBoolean("autoRollback", params.autoRollback),
    validateOptionalBoolean("requireApproval", params.requireApproval),
    validateNumber("maxConcurrency", params.maxConcurrency, { min: 1, max: 64 }),
  );
}

/**
 * Validate the execute migration params.
 */
export function validateExecuteParams(params: Record<string, unknown>): ValidationResult {
  return mergeValidations(
    validateJobId("jobId", params.jobId),
    validateOptionalBoolean("dryRun", params.dryRun),
  );
}

/**
 * Validate params that require only a jobId.
 */
export function validateJobIdParams(params: Record<string, unknown>): ValidationResult {
  return validateJobId("jobId", params.jobId);
}

/**
 * Validate cost estimation params.
 */
export function validateCostParams(params: Record<string, unknown>): ValidationResult {
  return mergeValidations(
    validateProvider("sourceProvider", params.sourceProvider),
    validateProvider("targetProvider", params.targetProvider),
    validateNumber("vmCount", params.vmCount, { min: 0, max: 100_000 }),
    validateNumber("totalStorageGB", params.totalStorageGB, { min: 0, max: 100_000_000 }),
    validateNumber("totalDiskGB", params.totalDiskGB, { min: 0, max: 100_000_000 }),
    validateNumber("objectCount", params.objectCount, { min: 0, max: 1_000_000_000 }),
  );
}

// =============================================================================
// Credential Scrubbing
// =============================================================================

/** Fields whose values should be redacted in logs and responses. */
const SENSITIVE_FIELDS = new Set([
  "secretAccessKey", "clientSecret", "password", "privateKey",
  "secret", "token", "apiKey", "apiSecret", "credential",
  "accessToken", "refreshToken", "connectionString",
]);

/**
 * Extract a human-readable error message from an unknown catch value.
 * Preserves the original Error message; falls back to String() for non-Error values.
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try { return String(err); } catch { return "Unknown error"; }
}

/**
 * Deep-clone an object, replacing sensitive field values with "[REDACTED]".
 * Safe for audit logging and error responses.
 */
export function scrubCredentials<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.map((item) => scrubCredentials(item)) as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.has(key) && typeof value === "string") {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = scrubCredentials(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
