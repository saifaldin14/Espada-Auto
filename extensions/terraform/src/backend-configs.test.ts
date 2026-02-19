/**
 * Terraform Backend Configs — Tests
 */

import { describe, it, expect } from "vitest";
import {
  generateBackendHCL,
  createS3Backend,
  createAzureRMBackend,
  createGCSBackend,
  validateBackendConfig,
} from "./backend-configs.js";
import type { AzureRMBackendConfig, GCSBackendConfig } from "./backend-configs.js";

// ── S3 Backend ───────────────────────────────────────────────────

describe("S3 backend", () => {
  it("generates valid HCL", () => {
    const hcl = generateBackendHCL({
      type: "s3",
      bucket: "my-tf-state",
      key: "prod/terraform.tfstate",
      region: "us-east-1",
    });

    expect(hcl).toContain('backend "s3"');
    expect(hcl).toContain('bucket = "my-tf-state"');
    expect(hcl).toContain('key    = "prod/terraform.tfstate"');
    expect(hcl).toContain('region = "us-east-1"');
  });

  it("includes optional DynamoDB table for locking", () => {
    const hcl = generateBackendHCL({
      type: "s3",
      bucket: "state",
      key: "app.tfstate",
      region: "us-west-2",
      dynamodb_table: "tf-locks",
    });

    expect(hcl).toContain('dynamodb_table = "tf-locks"');
  });

  it("includes encrypt by default", () => {
    const hcl = generateBackendHCL(createS3Backend("bucket", "key", "us-east-1"));
    expect(hcl).toContain("encrypt = true");
  });

  it("includes role_arn when specified", () => {
    const config = createS3Backend("bucket", "key", "us-east-1", {
      role_arn: "arn:aws:iam::123:role/deploy",
    });
    const hcl = generateBackendHCL(config);
    expect(hcl).toContain('role_arn = "arn:aws:iam::123:role/deploy"');
  });
});

// ── AzureRM Backend ──────────────────────────────────────────────

describe("AzureRM backend", () => {
  it("generates valid HCL", () => {
    const hcl = generateBackendHCL({
      type: "azurerm",
      storage_account_name: "mystorageacct",
      container_name: "tfstate",
      key: "prod.terraform.tfstate",
    });

    expect(hcl).toContain('backend "azurerm"');
    expect(hcl).toContain('storage_account_name = "mystorageacct"');
    expect(hcl).toContain('container_name       = "tfstate"');
    expect(hcl).toContain('key                  = "prod.terraform.tfstate"');
  });

  it("includes resource group when specified", () => {
    const config = createAzureRMBackend("acct", "container", "key", {
      resource_group_name: "rg-terraform",
    });
    const hcl = generateBackendHCL(config);
    expect(hcl).toContain('resource_group_name = "rg-terraform"');
  });

  it("includes OIDC when enabled", () => {
    const config = createAzureRMBackend("acct", "container", "key", {
      use_oidc: true,
    });
    const hcl = generateBackendHCL(config);
    expect(hcl).toContain("use_oidc = true");
  });
});

// ── GCS Backend ──────────────────────────────────────────────────

describe("GCS backend", () => {
  it("generates valid HCL", () => {
    const hcl = generateBackendHCL({
      type: "gcs",
      bucket: "my-gcs-state",
    });

    expect(hcl).toContain('backend "gcs"');
    expect(hcl).toContain('bucket = "my-gcs-state"');
  });

  it("includes default prefix", () => {
    const config = createGCSBackend("bucket");
    const hcl = generateBackendHCL(config);
    expect(hcl).toContain('prefix = "terraform/state"');
  });

  it("includes project when specified", () => {
    const config = createGCSBackend("bucket", { project: "my-project" });
    const hcl = generateBackendHCL(config);
    expect(hcl).toContain('project = "my-project"');
  });
});

// ── Validation ───────────────────────────────────────────────────

describe("validateBackendConfig", () => {
  it("validates a correct S3 config", () => {
    const result = validateBackendConfig(createS3Backend("b", "k", "us-east-1"));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects S3 config missing bucket", () => {
    const result = validateBackendConfig({ type: "s3", bucket: "", key: "k", region: "r" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("S3 backend requires 'bucket'");
  });

  it("validates a correct AzureRM config", () => {
    const result = validateBackendConfig(createAzureRMBackend("acct", "container", "key"));
    expect(result.valid).toBe(true);
  });

  it("rejects AzureRM config missing key", () => {
    const result = validateBackendConfig({
      type: "azurerm",
      storage_account_name: "acct",
      container_name: "c",
      key: "",
    } as AzureRMBackendConfig);
    expect(result.valid).toBe(false);
  });

  it("validates a correct GCS config", () => {
    const result = validateBackendConfig(createGCSBackend("bucket"));
    expect(result.valid).toBe(true);
  });

  it("rejects GCS config missing bucket", () => {
    const result = validateBackendConfig({ type: "gcs", bucket: "" } as GCSBackendConfig);
    expect(result.valid).toBe(false);
  });
});
