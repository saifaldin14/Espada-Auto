/**
 * Cloud Extensions — Shared Input Validation Utilities
 *
 * Prevents path traversal, command injection, and malformed resource names
 * across all cloud extension gateway methods.
 *
 * @module
 */

// =============================================================================
// Path Validation (for cwd params in Terraform, Pulumi, etc.)
// =============================================================================

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,          // ../
  /\.\.\\/,          // ..\
  /^\/etc\b/,        // /etc/...
  /^\/proc\b/,       // /proc/...
  /^\/sys\b/,        // /sys/...
  /^\/dev\b/,        // /dev/...
  /^~\//,            // ~/... (home dir)
  /\0/,              // null bytes
];

export type PathValidationResult = { valid: true } | { valid: false; reason: string };

/**
 * Validate a working directory path for safe CLI execution.
 * Rejects path traversal, system paths, and null bytes.
 */
export function validateCwdPath(cwd: string): PathValidationResult {
  if (!cwd || typeof cwd !== "string") {
    return { valid: false, reason: "cwd must be a non-empty string" };
  }

  if (cwd.length > 4096) {
    return { valid: false, reason: "cwd path exceeds maximum length (4096)" };
  }

  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
    if (pattern.test(cwd)) {
      return { valid: false, reason: `cwd contains forbidden pattern: ${pattern.source}` };
    }
  }

  return { valid: true };
}

// =============================================================================
// Resource Name Validation
// =============================================================================

/**
 * Kubernetes resource naming: lowercase alphanumeric + hyphens, max 253 chars.
 * RFC 1123 DNS subdomain names.
 */
const K8S_NAME_PATTERN = /^[a-z0-9]([a-z0-9\-.]*[a-z0-9])?$/;
const K8S_NAMESPACE_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * AWS resource naming: alphanumeric + hyphens + underscores, max 255 chars.
 */
const AWS_RESOURCE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_\-./]*$/;

/**
 * Azure resource naming: alphanumeric + hyphens + underscores + dots.
 */
const AZURE_RESOURCE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_\-.]*$/;

/**
 * GCP resource naming: lowercase alphanumeric + hyphens, max 63 chars.
 */
const GCP_RESOURCE_NAME_PATTERN = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;

export type ResourceNameValidationResult = { valid: true } | { valid: false; reason: string };

/**
 * Validate a Kubernetes resource name per RFC 1123.
 */
export function validateK8sResourceName(name: string, type: "name" | "namespace" = "name"): ResourceNameValidationResult {
  if (!name || typeof name !== "string") {
    return { valid: false, reason: "resource name must be a non-empty string" };
  }

  const maxLen = type === "namespace" ? 63 : 253;
  if (name.length > maxLen) {
    return { valid: false, reason: `${type} exceeds maximum length (${maxLen})` };
  }

  const pattern = type === "namespace" ? K8S_NAMESPACE_PATTERN : K8S_NAME_PATTERN;
  if (!pattern.test(name)) {
    return { valid: false, reason: `${type} must match RFC 1123: lowercase alphanumeric and hyphens, start/end with alphanumeric` };
  }

  return { valid: true };
}

/**
 * Validate an AWS resource name.
 */
export function validateAwsResourceName(name: string, maxLen = 255): ResourceNameValidationResult {
  if (!name || typeof name !== "string") {
    return { valid: false, reason: "resource name must be a non-empty string" };
  }

  if (name.length > maxLen) {
    return { valid: false, reason: `resource name exceeds maximum length (${maxLen})` };
  }

  if (!AWS_RESOURCE_NAME_PATTERN.test(name)) {
    return { valid: false, reason: "resource name must start with alphanumeric and contain only alphanumeric, hyphens, underscores, dots, slashes" };
  }

  return { valid: true };
}

/**
 * Validate an Azure resource name.
 */
export function validateAzureResourceName(name: string, maxLen = 260): ResourceNameValidationResult {
  if (!name || typeof name !== "string") {
    return { valid: false, reason: "resource name must be a non-empty string" };
  }

  if (name.length > maxLen) {
    return { valid: false, reason: `resource name exceeds maximum length (${maxLen})` };
  }

  if (!AZURE_RESOURCE_NAME_PATTERN.test(name)) {
    return { valid: false, reason: "resource name must start with alphanumeric and contain only alphanumeric, hyphens, underscores, dots" };
  }

  return { valid: true };
}

/**
 * Validate a GCP resource name.
 */
export function validateGcpResourceName(name: string, maxLen = 63): ResourceNameValidationResult {
  if (!name || typeof name !== "string") {
    return { valid: false, reason: "resource name must be a non-empty string" };
  }

  if (name.length > maxLen) {
    return { valid: false, reason: `resource name exceeds maximum length (${maxLen})` };
  }

  if (!GCP_RESOURCE_NAME_PATTERN.test(name)) {
    return { valid: false, reason: "resource name must start with lowercase letter, contain only lowercase alphanumeric and hyphens" };
  }

  return { valid: true };
}

// =============================================================================
// CLI Argument Sanitization
// =============================================================================

/**
 * Ensure a CLI argument doesn't start with a dash (prevents flag injection).
 * Returns the name as-is if safe, or prefixes with "./" if it looks like a flag.
 */
export function sanitizeCliArg(arg: string): string {
  if (typeof arg !== "string") return "";
  // Strip null bytes
  const clean = arg.replace(/\0/g, "");
  // Prevent flag injection: if arg starts with -, it could be interpreted as a CLI flag
  if (clean.startsWith("-")) {
    return `./${clean}`;
  }
  return clean;
}

/**
 * Validate an AWS profile/session name to prevent shell injection.
 * Only allows alphanumeric, hyphens, underscores, and dots.
 */
const SAFE_PROFILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_\-.]*$/;

export function validateAwsProfileName(name: string): ResourceNameValidationResult {
  if (!name || typeof name !== "string") {
    return { valid: false, reason: "profile name must be a non-empty string" };
  }

  if (name.length > 128) {
    return { valid: false, reason: "profile name exceeds maximum length (128)" };
  }

  if (!SAFE_PROFILE_PATTERN.test(name)) {
    return { valid: false, reason: "profile name must contain only alphanumeric, hyphens, underscores, and dots" };
  }

  return { valid: true };
}
