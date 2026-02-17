/**
 * Azure Storage — Type Definitions
 */
export type StorageAccountKind = "StorageV2" | "BlobStorage" | "BlockBlobStorage" | "FileStorage" | "Storage";
export type StorageSkuName = "Standard_LRS" | "Standard_GRS" | "Standard_RAGRS" | "Standard_ZRS" | "Premium_LRS" | "Premium_ZRS";
export type BlobAccessTier = "Hot" | "Cool" | "Archive";

export type StorageAccount = {
  id: string; name: string; resourceGroup: string; location: string;
  kind: StorageAccountKind; sku: StorageSkuName; provisioningState: string;
  primaryEndpoints?: { blob?: string; file?: string; queue?: string; table?: string };
  httpsOnly: boolean; tags?: Record<string, string>;
};

export type BlobContainer = {
  name: string; publicAccess: string; lastModified?: string;
  leaseState?: string; hasImmutabilityPolicy: boolean; hasLegalHold: boolean;
};

export type BlobItem = {
  name: string; contentLength: number; contentType?: string;
  lastModified?: string; accessTier?: BlobAccessTier;
  blobType: "BlockBlob" | "AppendBlob" | "PageBlob";
  metadata?: Record<string, string>;
};

export type StorageLifecycleRule = {
  name: string; enabled: boolean; type: string;
  filters?: { blobTypes: string[]; prefixMatch?: string[] };
  actions: Record<string, unknown>;
};
