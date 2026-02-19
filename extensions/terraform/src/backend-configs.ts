/**
 * Terraform — Backend Configuration Helpers
 *
 * Generates Terraform backend configuration blocks for S3, AzureRM, and GCS.
 * Produces HCL `backend {}` blocks that can be written to `backend.tf`.
 */

// ── Backend Types ──────────────────────────────────────────────────────────────

export interface S3BackendConfig {
  type: "s3";
  bucket: string;
  key: string;
  region: string;
  dynamodb_table?: string;
  encrypt?: boolean;
  profile?: string;
  role_arn?: string;
}

export interface AzureRMBackendConfig {
  type: "azurerm";
  storage_account_name: string;
  container_name: string;
  key: string;
  resource_group_name?: string;
  subscription_id?: string;
  tenant_id?: string;
  use_oidc?: boolean;
}

export interface GCSBackendConfig {
  type: "gcs";
  bucket: string;
  prefix?: string;
  project?: string;
  credentials?: string;
}

export type BackendConfig = S3BackendConfig | AzureRMBackendConfig | GCSBackendConfig;

// ── Defaults ───────────────────────────────────────────────────────────────────

const S3_DEFAULTS: Partial<S3BackendConfig> = {
  encrypt: true,
};

const AZURERM_DEFAULTS: Partial<AzureRMBackendConfig> = {
  use_oidc: false,
};

const GCS_DEFAULTS: Partial<GCSBackendConfig> = {
  prefix: "terraform/state",
};

// ── HCL Generation ─────────────────────────────────────────────────────────────

/**
 * Generate HCL for an S3 backend block.
 */
function generateS3Backend(config: S3BackendConfig): string {
  const merged = { ...S3_DEFAULTS, ...config };
  const lines: string[] = [
    `terraform {`,
    `  backend "s3" {`,
    `    bucket = "${merged.bucket}"`,
    `    key    = "${merged.key}"`,
    `    region = "${merged.region}"`,
  ];

  if (merged.dynamodb_table) {
    lines.push(`    dynamodb_table = "${merged.dynamodb_table}"`);
  }
  if (merged.encrypt !== undefined) {
    lines.push(`    encrypt = ${merged.encrypt}`);
  }
  if (merged.profile) {
    lines.push(`    profile = "${merged.profile}"`);
  }
  if (merged.role_arn) {
    lines.push(`    role_arn = "${merged.role_arn}"`);
  }

  lines.push(`  }`, `}`);
  return lines.join("\n");
}

/**
 * Generate HCL for an AzureRM backend block.
 */
function generateAzureRMBackend(config: AzureRMBackendConfig): string {
  const merged = { ...AZURERM_DEFAULTS, ...config };
  const lines: string[] = [
    `terraform {`,
    `  backend "azurerm" {`,
    `    storage_account_name = "${merged.storage_account_name}"`,
    `    container_name       = "${merged.container_name}"`,
    `    key                  = "${merged.key}"`,
  ];

  if (merged.resource_group_name) {
    lines.push(`    resource_group_name = "${merged.resource_group_name}"`);
  }
  if (merged.subscription_id) {
    lines.push(`    subscription_id = "${merged.subscription_id}"`);
  }
  if (merged.tenant_id) {
    lines.push(`    tenant_id = "${merged.tenant_id}"`);
  }
  if (merged.use_oidc) {
    lines.push(`    use_oidc = ${merged.use_oidc}`);
  }

  lines.push(`  }`, `}`);
  return lines.join("\n");
}

/**
 * Generate HCL for a GCS backend block.
 */
function generateGCSBackend(config: GCSBackendConfig): string {
  const merged = { ...GCS_DEFAULTS, ...config };
  const lines: string[] = [
    `terraform {`,
    `  backend "gcs" {`,
    `    bucket = "${merged.bucket}"`,
  ];

  if (merged.prefix) {
    lines.push(`    prefix = "${merged.prefix}"`);
  }
  if (merged.project) {
    lines.push(`    project = "${merged.project}"`);
  }
  if (merged.credentials) {
    lines.push(`    credentials = "${merged.credentials}"`);
  }

  lines.push(`  }`, `}`);
  return lines.join("\n");
}

/**
 * Generate a Terraform backend HCL block from a typed backend configuration.
 *
 * @example
 * ```ts
 * const hcl = generateBackendHCL({
 *   type: "s3",
 *   bucket: "my-tf-state",
 *   key: "prod/terraform.tfstate",
 *   region: "us-east-1",
 *   dynamodb_table: "tf-locks",
 *   encrypt: true,
 * });
 * ```
 */
export function generateBackendHCL(config: BackendConfig): string {
  switch (config.type) {
    case "s3": return generateS3Backend(config);
    case "azurerm": return generateAzureRMBackend(config);
    case "gcs": return generateGCSBackend(config);
  }
}

/**
 * Create a default S3 backend configuration.
 */
export function createS3Backend(
  bucket: string,
  key: string,
  region: string,
  options?: Partial<Omit<S3BackendConfig, "type" | "bucket" | "key" | "region">>,
): S3BackendConfig {
  return { type: "s3", bucket, key, region, ...S3_DEFAULTS, ...options };
}

/**
 * Create a default AzureRM backend configuration.
 */
export function createAzureRMBackend(
  storageAccountName: string,
  containerName: string,
  key: string,
  options?: Partial<Omit<AzureRMBackendConfig, "type" | "storage_account_name" | "container_name" | "key">>,
): AzureRMBackendConfig {
  return {
    type: "azurerm",
    storage_account_name: storageAccountName,
    container_name: containerName,
    key,
    ...AZURERM_DEFAULTS,
    ...options,
  };
}

/**
 * Create a default GCS backend configuration.
 */
export function createGCSBackend(
  bucket: string,
  options?: Partial<Omit<GCSBackendConfig, "type" | "bucket">>,
): GCSBackendConfig {
  return { type: "gcs", bucket, ...GCS_DEFAULTS, ...options };
}

/**
 * Validate a backend configuration — check required fields are non-empty.
 */
export function validateBackendConfig(config: BackendConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  switch (config.type) {
    case "s3":
      if (!config.bucket) errors.push("S3 backend requires 'bucket'");
      if (!config.key) errors.push("S3 backend requires 'key'");
      if (!config.region) errors.push("S3 backend requires 'region'");
      break;
    case "azurerm":
      if (!config.storage_account_name) errors.push("AzureRM backend requires 'storage_account_name'");
      if (!config.container_name) errors.push("AzureRM backend requires 'container_name'");
      if (!config.key) errors.push("AzureRM backend requires 'key'");
      break;
    case "gcs":
      if (!config.bucket) errors.push("GCS backend requires 'bucket'");
      break;
  }

  return { valid: errors.length === 0, errors };
}
