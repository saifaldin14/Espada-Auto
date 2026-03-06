/**
 * Cloud Provider Adapter — Unified Interface Types
 *
 * Defines the provider-agnostic adapter interface that normalizes operations
 * across AWS, Azure, and GCP. Each adapter wraps the real SDK managers from
 * the existing cloud extensions (extensions/aws, extensions/azure, extensions/gcp).
 *
 * This layer bridges the cloud-migration engine's step handlers to real
 * provider APIs without requiring step handlers to know provider details.
 */

import type {
  MigrationProvider,
  NormalizedVM,
  NormalizedBucket,
  NormalizedSecurityRule,
  NormalizedDNSRecord,
} from "../types.js";

// =============================================================================
// Provider Adapter — Core Interface
// =============================================================================

/**
 * Unified cloud provider adapter.
 *
 * Every cloud provider (AWS, Azure, GCP) implements this interface.
 * Step handlers call these methods without knowing which cloud SDK is beneath.
 */
export interface CloudProviderAdapter {
  /** Which provider this adapter wraps. */
  readonly provider: MigrationProvider;

  /** Compute operations (VMs, images, snapshots). */
  readonly compute: ComputeAdapter;

  /** Object storage operations (buckets, objects). */
  readonly storage: StorageAdapter;

  /** DNS operations (zones, records). */
  readonly dns: DNSAdapter;

  /** Network/security operations (VPCs, security groups, firewall rules). */
  readonly network: NetworkAdapter;

  /** Test provider connectivity / credentials. */
  healthCheck(): Promise<ProviderHealthResult>;
}

export interface ProviderHealthResult {
  provider: MigrationProvider;
  reachable: boolean;
  authenticated: boolean;
  region?: string;
  accountId?: string;
  latencyMs: number;
  error?: string;
}

// =============================================================================
// Compute Adapter
// =============================================================================

export interface ComputeAdapter {
  /**
   * List VMs in a region, optionally filtered by IDs.
   */
  listVMs(region: string, opts?: { ids?: string[] }): Promise<NormalizedVM[]>;

  /**
   * Get a single VM by ID.
   */
  getVM(vmId: string, region: string): Promise<NormalizedVM | null>;

  /**
   * Create a snapshot of a VM's boot/data volumes.
   * Returns the snapshot IDs and sizes.
   */
  createSnapshot(params: CreateSnapshotParams): Promise<SnapshotOutput>;

  /**
   * Delete a snapshot.
   */
  deleteSnapshot(snapshotId: string, region: string): Promise<void>;

  /**
   * Export a snapshot/disk to a staging object storage location.
   * AWS: CreateStoreImageTask / export-image
   * Azure: Grant disk access → SAS URL
   * GCP: images.export
   */
  exportImage(params: ExportImageParams): Promise<ExportImageOutput>;

  /**
   * Import a disk image as a machine image on this provider.
   * AWS: ImportImage → AMI
   * Azure: Create Managed Disk from VHD → Managed Image
   * GCP: images.insert from GCS
   */
  importImage(params: ImportImageParams): Promise<ImportImageOutput>;

  /**
   * Delete a machine image.
   * AWS: DeregisterImage
   * Azure: Delete managed image
   * GCP: images.delete
   */
  deleteImage(imageId: string, region: string): Promise<void>;

  /**
   * Launch a new VM from an image.
   */
  provisionVM(params: ProvisionVMParams): Promise<ProvisionVMOutput>;

  /**
   * Get instance status (running, stopped, etc).
   */
  getInstanceStatus(instanceId: string, region: string): Promise<InstanceStatusOutput>;

  /**
   * Stop a VM instance.
   */
  stopInstance(instanceId: string, region: string): Promise<void>;

  /**
   * Terminate/delete a VM instance.
   */
  terminateInstance(instanceId: string, region: string): Promise<void>;
}

export interface CreateSnapshotParams {
  vmId: string;
  region: string;
  volumeIds: string[];
  consistent?: boolean;
  tags?: Record<string, string>;
}

export interface SnapshotOutput {
  snapshots: Array<{
    volumeId: string;
    snapshotId: string;
    sizeGB: number;
    state: "pending" | "completed" | "error";
  }>;
  createdAt: string;
}

export interface ExportImageParams {
  snapshotId: string;
  region: string;
  format: "vmdk" | "vhd" | "raw" | "qcow2";
  stagingBucket: string;
  stagingKey: string;
}

export interface ExportImageOutput {
  exportTaskId: string;
  exportPath: string;
  exportSizeBytes: number;
  format: string;
}

export interface ImportImageParams {
  sourceUri: string;
  format: string;
  region: string;
  imageName: string;
  description?: string;
  tags?: Record<string, string>;
}

export interface ImportImageOutput {
  imageId: string;
  imageName: string;
  status: "available" | "pending" | "error";
  importTaskId?: string;
}

export interface ProvisionVMParams {
  imageId: string;
  region: string;
  zone?: string;
  instanceType: string;
  subnetId?: string;
  securityGroupIds?: string[];
  keyName?: string;
  userData?: string;
  tags?: Record<string, string>;
}

export interface ProvisionVMOutput {
  instanceId: string;
  privateIp: string;
  publicIp?: string;
  state: "running" | "pending";
}

export interface InstanceStatusOutput {
  instanceId: string;
  state: "running" | "stopped" | "terminated" | "pending" | "unknown";
  systemStatus: "ok" | "impaired" | "unknown";
  instanceStatus: "ok" | "impaired" | "unknown";
}

// =============================================================================
// Storage Adapter
// =============================================================================

export interface StorageAdapter {
  /**
   * List all buckets/containers in a region.
   */
  listBuckets(region?: string): Promise<NormalizedBucket[]>;

  /**
   * Get a single bucket by name.
   */
  getBucket(bucketName: string): Promise<NormalizedBucket | null>;

  /**
   * Create a new bucket/container.
   */
  createBucket(params: CreateBucketParams): Promise<CreateBucketOutput>;

  /**
   * Delete a bucket/container (must be empty).
   */
  deleteBucket(bucketName: string, region?: string): Promise<void>;

  /**
   * List objects in a bucket with optional prefix filter.
   */
  listObjects(bucketName: string, opts?: ListObjectsOpts): Promise<ListObjectsOutput>;

  /**
   * Get a presigned/SAS URL for downloading an object.
   */
  getObjectUrl(bucketName: string, key: string, expiresInSec?: number): Promise<string>;

  /**
   * Copy an object from this provider's bucket to a staging location.
   * For cross-provider transfer, the transfer engine reads from source
   * and writes to target adapter.
   */
  getObject(bucketName: string, key: string): Promise<ObjectDataOutput>;

  /**
   * Upload an object to a bucket.
   */
  putObject(bucketName: string, key: string, data: Buffer | Uint8Array, metadata?: Record<string, string>): Promise<PutObjectOutput>;

  /**
   * Delete an object.
   */
  deleteObject(bucketName: string, key: string): Promise<void>;

  /**
   * Set bucket versioning.
   */
  setBucketVersioning(bucketName: string, enabled: boolean): Promise<void>;

  /**
   * Set bucket tags.
   */
  setBucketTags(bucketName: string, tags: Record<string, string>): Promise<void>;

  // =========================================================================
  // Multi-part Upload Operations
  // =========================================================================

  /**
   * Initiate a multi-part upload for a large object.
   * Returns an uploadId that must be passed to subsequent part uploads
   * and the complete/abort calls.
   *
   * - **AWS**: CreateMultipartUpload
   * - **Azure**: Each staged block acts as a part; the "uploadId" is a synthetic token
   * - **GCP**: Resumable upload (initiateResumableUpload)
   */
  initiateMultipartUpload(bucketName: string, key: string, metadata?: Record<string, string>): Promise<MultipartUploadInit>;

  /**
   * Upload a single part of a multi-part upload.
   * Parts are 1-indexed. Each part must be at least 5 MB (except the last).
   *
   * Returns the ETag / block ID needed for the complete call.
   */
  uploadPart(params: UploadPartParams): Promise<UploadPartOutput>;

  /**
   * Finalise the multi-part upload by combining all uploaded parts.
   * After this call the object becomes available under the target key.
   */
  completeMultipartUpload(params: CompleteMultipartUploadParams): Promise<PutObjectOutput>;

  /**
   * Abort a multi-part upload and discard all uploaded parts.
   */
  abortMultipartUpload(bucketName: string, key: string, uploadId: string): Promise<void>;
}

export interface MultipartUploadInit {
  uploadId: string;
  bucketName: string;
  key: string;
}

export interface UploadPartParams {
  bucketName: string;
  key: string;
  uploadId: string;
  partNumber: number;
  data: Buffer | Uint8Array;
}

export interface UploadPartOutput {
  partNumber: number;
  etag: string;
}

export interface CompleteMultipartUploadParams {
  bucketName: string;
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}

export interface CreateBucketParams {
  name: string;
  region: string;
  storageClass?: string;
  versioning?: boolean;
  encryption?: {
    type: "provider-managed" | "customer-managed";
    keyId?: string;
  };
  tags?: Record<string, string>;
}

export interface CreateBucketOutput {
  name: string;
  region: string;
  created: boolean;
}

export interface ListObjectsOpts {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface ListObjectsOutput {
  objects: Array<{
    key: string;
    sizeBytes: number;
    lastModified: string;
    etag?: string;
    storageClass?: string;
  }>;
  truncated: boolean;
  continuationToken?: string;
  totalCount?: number;
}

export interface ObjectDataOutput {
  data: Buffer;
  contentType?: string;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface PutObjectOutput {
  etag?: string;
  versionId?: string;
}

// =============================================================================
// DNS Adapter
// =============================================================================

export interface DNSAdapter {
  /**
   * List all DNS zones.
   */
  listZones(): Promise<DNSZoneInfo[]>;

  /**
   * Get a zone by ID or name.
   */
  getZone(zoneId: string): Promise<DNSZoneInfo | null>;

  /**
   * Create a new DNS zone.
   */
  createZone(params: CreateDNSZoneParams): Promise<DNSZoneInfo>;

  /**
   * Delete a DNS zone.
   */
  deleteZone(zoneId: string): Promise<void>;

  /**
   * List records in a zone.
   */
  listRecords(zoneId: string): Promise<NormalizedDNSRecord[]>;

  /**
   * Create a DNS record.
   */
  createRecord(zoneId: string, record: NormalizedDNSRecord): Promise<void>;

  /**
   * Update a DNS record.
   */
  updateRecord(zoneId: string, record: NormalizedDNSRecord): Promise<void>;

  /**
   * Delete a DNS record.
   */
  deleteRecord(zoneId: string, recordName: string, recordType: string): Promise<void>;
}

export interface DNSZoneInfo {
  id: string;
  name: string;
  type: "public" | "private";
  nameServers: string[];
  recordCount: number;
}

export interface CreateDNSZoneParams {
  name: string;
  type?: "public" | "private";
  description?: string;
  tags?: Record<string, string>;
}

// =============================================================================
// Network Adapter
// =============================================================================

export interface NetworkAdapter {
  /**
   * List VPCs/VNets/Networks in a region.
   */
  listVPCs(region?: string): Promise<NetworkVPCInfo[]>;

  /**
   * List subnets in a VPC.
   */
  listSubnets(vpcId: string, region?: string): Promise<NetworkSubnetInfo[]>;

  /**
   * List security groups / NSGs / firewall rules.
   */
  listSecurityGroups(region?: string): Promise<SecurityGroupInfo[]>;

  /**
   * Create a security group / NSG.
   */
  createSecurityGroup(params: CreateSecurityGroupParams): Promise<SecurityGroupInfo>;

  /**
   * Delete a security group.
   */
  deleteSecurityGroup(groupId: string, region?: string): Promise<void>;

  /**
   * Add rules to a security group.
   */
  addSecurityRules(groupId: string, rules: NormalizedSecurityRule[], region?: string): Promise<void>;

  /**
   * List load balancers.
   */
  listLoadBalancers(region?: string): Promise<LoadBalancerInfo[]>;
}

export interface NetworkVPCInfo {
  id: string;
  name: string;
  cidrBlocks: string[];
  region: string;
  subnets: NetworkSubnetInfo[];
  tags?: Record<string, string>;
}

export interface NetworkSubnetInfo {
  id: string;
  name: string;
  cidrBlock: string;
  availabilityZone?: string;
  public: boolean;
}

export interface SecurityGroupInfo {
  id: string;
  name: string;
  description?: string;
  vpcId?: string;
  rules: NormalizedSecurityRule[];
  tags?: Record<string, string>;
}

export interface CreateSecurityGroupParams {
  name: string;
  description?: string;
  vpcId?: string;
  region?: string;
  tags?: Record<string, string>;
}

export interface LoadBalancerInfo {
  id: string;
  name: string;
  type: "application" | "network" | "classic" | "gateway";
  scheme: "internal" | "external";
  dnsName?: string;
}

// =============================================================================
// Provider Adapter Factory
// =============================================================================

/**
 * Credential configuration for initializing a provider adapter.
 */
export type ProviderCredentialConfig =
  | AWSCredentialConfig
  | AzureCredentialConfig
  | GCPCredentialConfig;

export interface AWSCredentialConfig {
  provider: "aws";
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  profile?: string;
}

export interface AzureCredentialConfig {
  provider: "azure";
  subscriptionId: string;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  region?: string;
}

export interface GCPCredentialConfig {
  provider: "gcp";
  projectId: string;
  region?: string;
  keyFilePath?: string;
  serviceAccountKey?: string;
}

/**
 * Factory function type for creating a provider adapter.
 */
export type ProviderAdapterFactory = (config: ProviderCredentialConfig) => Promise<CloudProviderAdapter>;
