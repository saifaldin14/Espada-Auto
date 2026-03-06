/**
 * Data Pipeline — Bucket Normalizer
 *
 * Normalizes S3, Azure Blob, and GCS bucket metadata into a
 * common NormalizedBucket shape.
 */

import type { NormalizedBucket, BucketEncryption, LifecycleRule, MigrationProvider } from "../types.js";

// =============================================================================
// Provider-Specific Input Types
// =============================================================================

export interface S3BucketInfo {
  name: string;
  region: string;
  creationDate: string;
  versioning: boolean;
  encryption?: {
    algorithm: "AES256" | "aws:kms";
    kmsKeyId?: string;
  };
  lifecycle?: Array<{
    id: string;
    prefix: string;
    transitions: Array<{ days: number; storageClass: string }>;
    expiration?: { days: number };
  }>;
  cors?: Array<{
    allowedOrigins: string[];
    allowedMethods: string[];
    allowedHeaders: string[];
  }>;
  logging?: { targetBucket: string; targetPrefix: string };
  tags?: Record<string, string>;
  objectCount?: number;
  totalSizeBytes?: number;
}

export interface AzureBlobContainerInfo {
  name: string;
  storageAccountName: string;
  region: string;
  accessTier: "Hot" | "Cool" | "Archive";
  encryption: {
    enabled: boolean;
    keySource: "Microsoft.Storage" | "Microsoft.Keyvault";
    keyVaultKeyId?: string;
  };
  immutability?: {
    policyPeriod: number;
    state: "Locked" | "Unlocked";
  };
  publicAccess: "None" | "Blob" | "Container";
  tags?: Record<string, string>;
  objectCount?: number;
  totalSizeBytes?: number;
}

export interface GCSBucketInfo {
  name: string;
  location: string;
  locationType: "region" | "dual-region" | "multi-region";
  storageClass: "STANDARD" | "NEARLINE" | "COLDLINE" | "ARCHIVE";
  versioning: boolean;
  encryption?: {
    defaultKmsKeyName?: string;
  };
  lifecycle?: Array<{
    action: { type: string; storageClass?: string };
    condition: { age?: number; isLive?: boolean; matchesStorageClass?: string[] };
  }>;
  cors?: Array<{
    origin: string[];
    method: string[];
    responseHeader: string[];
    maxAgeSeconds: number;
  }>;
  labels?: Record<string, string>;
  objectCount?: number;
  totalSizeBytes?: number;
}

// =============================================================================
// Normalizers
// =============================================================================

/**
 * On-premises / VMware / Nutanix S3-compatible bucket info.
 * Represents MinIO, Nutanix Objects, or Ceph RGW buckets.
 */
export interface OnPremBucketInfo {
  name: string;
  endpoint: string;
  region?: string;
  versioning?: boolean;
  objectCount?: number;
  totalSizeBytes?: number;
  tags?: Record<string, string>;
}

export function normalizeOnPremBucket(bucket: OnPremBucketInfo, provider: MigrationProvider): NormalizedBucket {
  return {
    id: `${provider}:${bucket.name}`,
    name: bucket.name,
    provider,
    region: bucket.region ?? "on-premises",
    versioning: bucket.versioning ?? false,
    encryption: { enabled: false, type: "none" },
    objectCount: bucket.objectCount ?? 0,
    totalSizeBytes: bucket.totalSizeBytes ?? 0,
    lifecycleRules: [],
    tags: bucket.tags ?? {},
  };
}

export function normalizeS3Bucket(bucket: S3BucketInfo): NormalizedBucket {
  const encryption: BucketEncryption = bucket.encryption?.algorithm === "aws:kms"
    ? { enabled: true, type: "customer-managed", keyId: bucket.encryption.kmsKeyId }
    : bucket.encryption
      ? { enabled: true, type: "provider-managed" }
      : { enabled: false, type: "none" };

  const lifecycleRules: LifecycleRule[] = (bucket.lifecycle ?? []).map((r) => ({
    id: r.id,
    prefix: r.prefix,
    enabled: true,
    transitions: r.transitions,
    expiration: r.expiration,
  }));

  return {
    id: bucket.name,
    name: bucket.name,
    provider: "aws",
    region: bucket.region,
    versioning: bucket.versioning,
    encryption,
    objectCount: bucket.objectCount ?? 0,
    totalSizeBytes: bucket.totalSizeBytes ?? 0,
    lifecycleRules,
    tags: bucket.tags ?? {},
  };
}

export function normalizeAzureBlobContainer(container: AzureBlobContainerInfo): NormalizedBucket {
  const encryption: BucketEncryption = container.encryption.keySource === "Microsoft.Keyvault"
    ? { enabled: true, type: "customer-managed", keyId: container.encryption.keyVaultKeyId }
    : { enabled: true, type: "provider-managed" };

  return {
    id: `${container.storageAccountName}/${container.name}`,
    name: container.name,
    provider: "azure",
    region: container.region,
    versioning: false, // Azure uses soft-delete instead
    encryption,
    objectCount: container.objectCount ?? 0,
    totalSizeBytes: container.totalSizeBytes ?? 0,
    lifecycleRules: [],
    tags: container.tags ?? {},
  };
}

export function normalizeGCSBucket(bucket: GCSBucketInfo): NormalizedBucket {
  const encryption: BucketEncryption = bucket.encryption?.defaultKmsKeyName
    ? { enabled: true, type: "customer-managed", keyId: bucket.encryption.defaultKmsKeyName }
    : { enabled: true, type: "provider-managed" };

  const lifecycleRules: LifecycleRule[] = (bucket.lifecycle ?? []).map((rule, i) => ({
    id: `rule-${i}`,
    prefix: "",
    enabled: true,
    transitions: rule.action.storageClass
      ? [{ days: rule.condition.age ?? 0, storageClass: rule.action.storageClass }]
      : [],
    expiration: rule.condition.age ? { days: rule.condition.age } : undefined,
  }));

  return {
    id: bucket.name,
    name: bucket.name,
    provider: "gcp",
    region: bucket.location,
    versioning: bucket.versioning,
    encryption,
    objectCount: bucket.objectCount ?? 0,
    totalSizeBytes: bucket.totalSizeBytes ?? 0,
    lifecycleRules,
    tags: bucket.labels ?? {},
  };
}

/**
 * Universal normalizer dispatcher.
 */
export function normalizeBucket(
  data: S3BucketInfo | AzureBlobContainerInfo | GCSBucketInfo | OnPremBucketInfo,
  provider: MigrationProvider,
): NormalizedBucket {
  switch (provider) {
    case "aws":
      return normalizeS3Bucket(data as S3BucketInfo);
    case "azure":
      return normalizeAzureBlobContainer(data as AzureBlobContainerInfo);
    case "gcp":
      return normalizeGCSBucket(data as GCSBucketInfo);
    case "on-premises":
    case "vmware":
    case "nutanix":
      return normalizeOnPremBucket(data as OnPremBucketInfo, provider);
    default:
      throw new Error(`Unsupported storage provider: ${provider}`);
  }
}
