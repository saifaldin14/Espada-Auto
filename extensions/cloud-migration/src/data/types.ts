/**
 * Data Pipeline — Types
 *
 * Types specific to the data/storage migration pipeline including
 * object storage, databases, and file systems.
 */

import type {
  MigrationProvider,
  NormalizedBucket,
  TransferManifest,
  IntegrityReport,
} from "../types.js";

// =============================================================================
// Object Storage
// =============================================================================

export interface ObjectInventory {
  bucketName: string;
  provider: MigrationProvider;
  region: string;
  totalObjects: number;
  totalSizeBytes: number;
  breakdown: {
    byStorageClass: Record<string, { count: number; sizeBytes: number }>;
    byPrefix: Record<string, { count: number; sizeBytes: number }>;
    byExtension: Record<string, { count: number; sizeBytes: number }>;
  };
  largestObjectBytes: number;
  inventoryDate: string;
}

export interface ObjectTransferConfig {
  sourceBucket: string;
  sourceProvider: MigrationProvider;
  sourceRegion: string;
  targetBucket: string;
  targetProvider: MigrationProvider;
  targetRegion: string;
  concurrency: number;
  chunkSizeMB: number;
  prefixFilter?: string;
  excludePatterns?: string[];
  storageClassMapping?: Record<string, string>;
  metadataPreserve: boolean;
  aclPreserve: boolean;
  encryptionConfig?: {
    sourceKmsKeyId?: string;
    targetKmsKeyId?: string;
  };
}

export interface ObjectTransferProgress {
  taskId: string;
  status: "inventorying" | "transferring" | "verifying" | "complete" | "failed";
  objectsTransferred: number;
  objectsTotal: number;
  bytesTransferred: number;
  bytesTotal: number;
  objectsFailed: number;
  currentRate: number; // bytes/sec
  estimatedRemainingMs: number;
  errors: Array<{ key: string; error: string }>;
}

export interface ObjectTransferResult {
  taskId: string;
  sourceBucket: string;
  targetBucket: string;
  objectsTransferred: number;
  bytesTransferred: number;
  objectsFailed: number;
  durationMs: number;
  manifest: TransferManifest;
  integrityReport: IntegrityReport;
  /** SHA-256 hashes computed inline during transfer, keyed by object key. */
  inlineChecksums?: Map<string, string>;
}

// =============================================================================
// Storage Class Mapping
// =============================================================================

/** Maps source storage classes to equivalent target classes */
export const STORAGE_CLASS_MAP: Record<string, Record<string, string>> = {
  // AWS → Azure
  "aws→azure": {
    STANDARD: "Hot",
    STANDARD_IA: "Cool",
    ONEZONE_IA: "Cool",
    GLACIER: "Archive",
    GLACIER_DEEP_ARCHIVE: "Archive",
    INTELLIGENT_TIERING: "Hot",
  },
  // AWS → GCP
  "aws→gcp": {
    STANDARD: "STANDARD",
    STANDARD_IA: "NEARLINE",
    ONEZONE_IA: "NEARLINE",
    GLACIER: "COLDLINE",
    GLACIER_DEEP_ARCHIVE: "ARCHIVE",
    INTELLIGENT_TIERING: "STANDARD",
  },
  // Azure → AWS
  "azure→aws": {
    Hot: "STANDARD",
    Cool: "STANDARD_IA",
    Archive: "GLACIER",
  },
  // Azure → GCP
  "azure→gcp": {
    Hot: "STANDARD",
    Cool: "NEARLINE",
    Archive: "COLDLINE",
  },
  // GCP → AWS
  "gcp→aws": {
    STANDARD: "STANDARD",
    NEARLINE: "STANDARD_IA",
    COLDLINE: "GLACIER",
    ARCHIVE: "GLACIER_DEEP_ARCHIVE",
  },
  // GCP → Azure
  "gcp→azure": {
    STANDARD: "Hot",
    NEARLINE: "Cool",
    COLDLINE: "Archive",
    ARCHIVE: "Archive",
  },
  // On-Premises → AWS
  "on-premises→aws": {
    STANDARD: "STANDARD",
    COLD: "STANDARD_IA",
    ARCHIVE: "GLACIER",
  },
  // On-Premises → Azure
  "on-premises→azure": {
    STANDARD: "Hot",
    COLD: "Cool",
    ARCHIVE: "Archive",
  },
  // On-Premises → GCP
  "on-premises→gcp": {
    STANDARD: "STANDARD",
    COLD: "NEARLINE",
    ARCHIVE: "COLDLINE",
  },
  // AWS → On-Premises
  "aws→on-premises": {
    STANDARD: "STANDARD",
    STANDARD_IA: "COLD",
    ONEZONE_IA: "COLD",
    GLACIER: "ARCHIVE",
    GLACIER_DEEP_ARCHIVE: "ARCHIVE",
    INTELLIGENT_TIERING: "STANDARD",
  },
  // Azure → On-Premises
  "azure→on-premises": {
    Hot: "STANDARD",
    Cool: "COLD",
    Archive: "ARCHIVE",
  },
  // GCP → On-Premises
  "gcp→on-premises": {
    STANDARD: "STANDARD",
    NEARLINE: "COLD",
    COLDLINE: "ARCHIVE",
    ARCHIVE: "ARCHIVE",
  },
  // VMware ↔ cloud (same as on-premises)
  "vmware→aws": {
    STANDARD: "STANDARD",
    COLD: "STANDARD_IA",
    ARCHIVE: "GLACIER",
  },
  "vmware→azure": {
    STANDARD: "Hot",
    COLD: "Cool",
    ARCHIVE: "Archive",
  },
  "vmware→gcp": {
    STANDARD: "STANDARD",
    COLD: "NEARLINE",
    ARCHIVE: "COLDLINE",
  },
  "aws→vmware": {
    STANDARD: "STANDARD",
    STANDARD_IA: "COLD",
    GLACIER: "ARCHIVE",
    GLACIER_DEEP_ARCHIVE: "ARCHIVE",
    INTELLIGENT_TIERING: "STANDARD",
  },
  "azure→vmware": {
    Hot: "STANDARD",
    Cool: "COLD",
    Archive: "ARCHIVE",
  },
  "gcp→vmware": {
    STANDARD: "STANDARD",
    NEARLINE: "COLD",
    COLDLINE: "ARCHIVE",
    ARCHIVE: "ARCHIVE",
  },
  // Nutanix ↔ cloud
  "nutanix→aws": {
    STANDARD: "STANDARD",
    COLD: "STANDARD_IA",
    ARCHIVE: "GLACIER",
  },
  "nutanix→azure": {
    STANDARD: "Hot",
    COLD: "Cool",
    ARCHIVE: "Archive",
  },
  "nutanix→gcp": {
    STANDARD: "STANDARD",
    COLD: "NEARLINE",
    ARCHIVE: "COLDLINE",
  },
  "aws→nutanix": {
    STANDARD: "STANDARD",
    STANDARD_IA: "COLD",
    GLACIER: "ARCHIVE",
    GLACIER_DEEP_ARCHIVE: "ARCHIVE",
    INTELLIGENT_TIERING: "STANDARD",
  },
  "azure→nutanix": {
    Hot: "STANDARD",
    Cool: "COLD",
    Archive: "ARCHIVE",
  },
  "gcp→nutanix": {
    STANDARD: "STANDARD",
    NEARLINE: "COLD",
    COLDLINE: "ARCHIVE",
    ARCHIVE: "ARCHIVE",
  },
  // On-Prem ↔ On-Prem (identity)
  "on-premises→on-premises": { STANDARD: "STANDARD", COLD: "COLD", ARCHIVE: "ARCHIVE" },
  "vmware→vmware": { STANDARD: "STANDARD", COLD: "COLD", ARCHIVE: "ARCHIVE" },
  "nutanix→nutanix": { STANDARD: "STANDARD", COLD: "COLD", ARCHIVE: "ARCHIVE" },
  "vmware→on-premises": { STANDARD: "STANDARD", COLD: "COLD", ARCHIVE: "ARCHIVE" },
  "on-premises→vmware": { STANDARD: "STANDARD", COLD: "COLD", ARCHIVE: "ARCHIVE" },
  "nutanix→on-premises": { STANDARD: "STANDARD", COLD: "COLD", ARCHIVE: "ARCHIVE" },
  "on-premises→nutanix": { STANDARD: "STANDARD", COLD: "COLD", ARCHIVE: "ARCHIVE" },
  "vmware→nutanix": { STANDARD: "STANDARD", COLD: "COLD", ARCHIVE: "ARCHIVE" },
  "nutanix→vmware": { STANDARD: "STANDARD", COLD: "COLD", ARCHIVE: "ARCHIVE" },
};

/**
 * Map a storage class from source to target provider.
 */
export function mapStorageClass(
  sourceClass: string,
  sourceProvider: MigrationProvider,
  targetProvider: MigrationProvider,
): string {
  const key = `${sourceProvider}→${targetProvider}`;
  const mapping = STORAGE_CLASS_MAP[key];
  if (!mapping) return sourceClass;
  return mapping[sourceClass] ?? sourceClass;
}

// =============================================================================
// Database Migration
// =============================================================================

export interface DatabaseConnection {
  engine: "postgresql" | "mysql" | "mariadb";
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  sslCa?: string;
}

export interface DatabaseSchema {
  database: string;
  tables: DatabaseTable[];
  views: string[];
  functions: string[];
  sequences: string[];
  extensions: string[];
}

export interface DatabaseTable {
  name: string;
  schema: string;
  columns: DatabaseColumn[];
  rowCount: number;
  sizeBytes: number;
  indexes: string[];
  constraints: string[];
  partitioned: boolean;
}

export interface DatabaseColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: { table: string; column: string };
}

export interface DatabaseMigrationPlan {
  sourceConnection: Omit<DatabaseConnection, "password">;
  targetConnection: Omit<DatabaseConnection, "password">;
  tables: Array<{
    name: string;
    strategy: "full-dump" | "streaming" | "cdc";
    estimatedRows: number;
    estimatedSizeBytes: number;
    partitionKey?: string;
  }>;
  schemaChanges: SchemaChange[];
  estimatedDurationMs: number;
}

export interface SchemaChange {
  type: "type-mapping" | "index-rebuild" | "constraint-adjust" | "extension-replace";
  table: string;
  column?: string;
  sourceType: string;
  targetType: string;
  reason: string;
  automatic: boolean;
}

export interface DatabaseMigrationResult {
  tablesTransferred: number;
  rowsTransferred: number;
  bytesTransferred: number;
  durationMs: number;
  schemaChangesApplied: number;
  errors: Array<{ table: string; error: string }>;
  verificationPassed: boolean;
}

// Re-export common types
export type { NormalizedBucket, TransferManifest, IntegrityReport };
