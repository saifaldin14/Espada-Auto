/**
 * AWS S3 Types
 * Comprehensive type definitions for S3 operations
 */

import type { AwsCredentialIdentity } from '@smithy/types';

// ============================================================================
// Core S3 Types
// ============================================================================

export interface S3ClientConfig {
  region?: string;
  credentials?: AwsCredentialIdentity;
}

export interface S3OperationResult<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

// ============================================================================
// S3 Bucket Types
// ============================================================================

export interface S3Bucket {
  name: string;
  creationDate?: Date;
  region?: string;
}

export interface S3BucketDetails extends S3Bucket {
  versioning?: S3VersioningStatus;
  encryption?: S3BucketEncryption;
  publicAccessBlock?: S3PublicAccessBlock;
  logging?: S3BucketLogging;
  website?: S3WebsiteConfiguration;
  cors?: S3CorsConfiguration;
  lifecycle?: S3LifecycleConfiguration;
  replication?: S3ReplicationConfiguration;
  notification?: S3NotificationConfiguration;
  tags?: Record<string, string>;
  accelerateConfiguration?: 'Enabled' | 'Suspended';
  requestPayment?: 'BucketOwner' | 'Requester';
  objectLockConfiguration?: S3ObjectLockConfiguration;
}

export interface S3CreateBucketOptions {
  bucketName: string;
  region?: string;
  acl?: S3BucketAcl;
  objectOwnership?: 'BucketOwnerPreferred' | 'ObjectWriter' | 'BucketOwnerEnforced';
  objectLockEnabledForBucket?: boolean;
}

export type S3BucketAcl =
  | 'private'
  | 'public-read'
  | 'public-read-write'
  | 'authenticated-read';

// ============================================================================
// S3 Object Types
// ============================================================================

export interface S3Object {
  key: string;
  lastModified?: Date;
  eTag?: string;
  size?: number;
  storageClass?: S3StorageClass;
  owner?: {
    displayName?: string;
    id?: string;
  };
  checksumAlgorithm?: Array<'CRC32' | 'CRC32C' | 'SHA1' | 'SHA256'>;
}

export interface S3ObjectDetails extends S3Object {
  contentType?: string;
  contentLength?: number;
  contentEncoding?: string;
  contentDisposition?: string;
  contentLanguage?: string;
  cacheControl?: string;
  expires?: Date;
  metadata?: Record<string, string>;
  versionId?: string;
  deleteMarker?: boolean;
  serverSideEncryption?: 'AES256' | 'aws:kms' | 'aws:kms:dsse';
  sseKmsKeyId?: string;
  bucketKeyEnabled?: boolean;
  objectLockMode?: 'GOVERNANCE' | 'COMPLIANCE';
  objectLockRetainUntilDate?: Date;
  objectLockLegalHoldStatus?: 'ON' | 'OFF';
  replicationStatus?: 'COMPLETE' | 'PENDING' | 'FAILED' | 'REPLICA';
  partsCount?: number;
  tagCount?: number;
}

export type S3StorageClass =
  | 'STANDARD'
  | 'REDUCED_REDUNDANCY'
  | 'STANDARD_IA'
  | 'ONEZONE_IA'
  | 'INTELLIGENT_TIERING'
  | 'GLACIER'
  | 'DEEP_ARCHIVE'
  | 'OUTPOSTS'
  | 'GLACIER_IR'
  | 'SNOW'
  | 'EXPRESS_ONEZONE';

export interface S3UploadOptions {
  bucketName: string;
  key: string;
  body: Buffer | string | Uint8Array;
  contentType?: string;
  contentEncoding?: string;
  contentDisposition?: string;
  contentLanguage?: string;
  cacheControl?: string;
  expires?: Date;
  metadata?: Record<string, string>;
  acl?: S3ObjectAcl;
  storageClass?: S3StorageClass;
  serverSideEncryption?: 'AES256' | 'aws:kms' | 'aws:kms:dsse';
  sseKmsKeyId?: string;
  bucketKeyEnabled?: boolean;
  tagging?: string;
  objectLockMode?: 'GOVERNANCE' | 'COMPLIANCE';
  objectLockRetainUntilDate?: Date;
  objectLockLegalHoldStatus?: 'ON' | 'OFF';
  checksumAlgorithm?: 'CRC32' | 'CRC32C' | 'SHA1' | 'SHA256';
  region?: string;
}

export interface S3DownloadOptions {
  bucketName: string;
  key: string;
  versionId?: string;
  range?: string;
  ifMatch?: string;
  ifNoneMatch?: string;
  ifModifiedSince?: Date;
  ifUnmodifiedSince?: Date;
  region?: string;
}

export interface S3DownloadResult {
  body: Buffer;
  contentType?: string;
  contentLength?: number;
  contentEncoding?: string;
  contentDisposition?: string;
  eTag?: string;
  lastModified?: Date;
  versionId?: string;
  metadata?: Record<string, string>;
  serverSideEncryption?: string;
  cacheControl?: string;
  expires?: Date;
}

export interface S3CopyOptions {
  sourceBucket: string;
  sourceKey: string;
  destinationBucket: string;
  destinationKey: string;
  sourceVersionId?: string;
  acl?: S3ObjectAcl;
  storageClass?: S3StorageClass;
  serverSideEncryption?: 'AES256' | 'aws:kms' | 'aws:kms:dsse';
  sseKmsKeyId?: string;
  metadata?: Record<string, string>;
  metadataDirective?: 'COPY' | 'REPLACE';
  tagging?: string;
  taggingDirective?: 'COPY' | 'REPLACE';
  region?: string;
}

export interface S3DeleteOptions {
  bucketName: string;
  key: string;
  versionId?: string;
  bypassGovernanceRetention?: boolean;
  region?: string;
}

export interface S3DeleteMultipleOptions {
  bucketName: string;
  objects: Array<{ key: string; versionId?: string }>;
  quiet?: boolean;
  bypassGovernanceRetention?: boolean;
  region?: string;
}

export type S3ObjectAcl =
  | 'private'
  | 'public-read'
  | 'public-read-write'
  | 'authenticated-read'
  | 'aws-exec-read'
  | 'bucket-owner-read'
  | 'bucket-owner-full-control';

export interface S3ListObjectsOptions {
  bucketName: string;
  prefix?: string;
  delimiter?: string;
  maxKeys?: number;
  startAfter?: string;
  continuationToken?: string;
  fetchOwner?: boolean;
  region?: string;
}

export interface S3ListObjectsResult {
  objects: S3Object[];
  commonPrefixes?: string[];
  isTruncated?: boolean;
  continuationToken?: string;
  nextContinuationToken?: string;
  keyCount?: number;
}

export interface S3ListObjectVersionsOptions {
  bucketName: string;
  prefix?: string;
  delimiter?: string;
  maxKeys?: number;
  keyMarker?: string;
  versionIdMarker?: string;
  region?: string;
}

export interface S3ObjectVersion {
  key: string;
  versionId: string;
  isLatest?: boolean;
  lastModified?: Date;
  eTag?: string;
  size?: number;
  storageClass?: S3StorageClass;
  owner?: {
    displayName?: string;
    id?: string;
  };
}

export interface S3DeleteMarker {
  key: string;
  versionId: string;
  isLatest?: boolean;
  lastModified?: Date;
  owner?: {
    displayName?: string;
    id?: string;
  };
}

// ============================================================================
// S3 Versioning Types
// ============================================================================

export type S3VersioningStatus = 'Enabled' | 'Suspended' | 'Disabled';

export interface S3SetVersioningOptions {
  bucketName: string;
  status: 'Enabled' | 'Suspended';
  mfaDelete?: 'Enabled' | 'Disabled';
  region?: string;
}

// ============================================================================
// S3 Encryption Types
// ============================================================================

export interface S3BucketEncryption {
  rules: S3EncryptionRule[];
}

export interface S3EncryptionRule {
  applyServerSideEncryptionByDefault?: {
    sseAlgorithm: 'AES256' | 'aws:kms' | 'aws:kms:dsse';
    kmsMasterKeyId?: string;
  };
  bucketKeyEnabled?: boolean;
}

export interface S3SetEncryptionOptions {
  bucketName: string;
  sseAlgorithm: 'AES256' | 'aws:kms' | 'aws:kms:dsse';
  kmsMasterKeyId?: string;
  bucketKeyEnabled?: boolean;
  region?: string;
}

// ============================================================================
// S3 Public Access Block Types
// ============================================================================

export interface S3PublicAccessBlock {
  blockPublicAcls?: boolean;
  ignorePublicAcls?: boolean;
  blockPublicPolicy?: boolean;
  restrictPublicBuckets?: boolean;
}

export interface S3SetPublicAccessBlockOptions extends S3PublicAccessBlock {
  bucketName: string;
  region?: string;
}

// ============================================================================
// S3 Lifecycle Types
// ============================================================================

export interface S3LifecycleConfiguration {
  rules: S3LifecycleRule[];
}

export interface S3LifecycleRule {
  id?: string;
  status: 'Enabled' | 'Disabled';
  filter?: S3LifecycleRuleFilter;
  prefix?: string;
  expiration?: S3LifecycleExpiration;
  transitions?: S3LifecycleTransition[];
  noncurrentVersionExpiration?: S3NoncurrentVersionExpiration;
  noncurrentVersionTransitions?: S3NoncurrentVersionTransition[];
  abortIncompleteMultipartUpload?: {
    daysAfterInitiation: number;
  };
}

export interface S3LifecycleRuleFilter {
  prefix?: string;
  tag?: { key: string; value: string };
  and?: {
    prefix?: string;
    tags?: Array<{ key: string; value: string }>;
    objectSizeGreaterThan?: number;
    objectSizeLessThan?: number;
  };
  objectSizeGreaterThan?: number;
  objectSizeLessThan?: number;
}

export interface S3LifecycleExpiration {
  date?: Date;
  days?: number;
  expiredObjectDeleteMarker?: boolean;
}

export interface S3LifecycleTransition {
  date?: Date;
  days?: number;
  storageClass: S3StorageClass;
}

export interface S3NoncurrentVersionExpiration {
  noncurrentDays?: number;
  newerNoncurrentVersions?: number;
}

export interface S3NoncurrentVersionTransition {
  noncurrentDays?: number;
  storageClass: S3StorageClass;
  newerNoncurrentVersions?: number;
}

export interface S3SetLifecycleOptions {
  bucketName: string;
  rules: S3LifecycleRule[];
  region?: string;
}

// ============================================================================
// S3 Website Hosting Types
// ============================================================================

export interface S3WebsiteConfiguration {
  indexDocument?: {
    suffix: string;
  };
  errorDocument?: {
    key: string;
  };
  redirectAllRequestsTo?: {
    hostName: string;
    protocol?: 'http' | 'https';
  };
  routingRules?: S3RoutingRule[];
}

export interface S3RoutingRule {
  condition?: {
    httpErrorCodeReturnedEquals?: string;
    keyPrefixEquals?: string;
  };
  redirect: {
    hostName?: string;
    httpRedirectCode?: string;
    protocol?: 'http' | 'https';
    replaceKeyPrefixWith?: string;
    replaceKeyWith?: string;
  };
}

export interface S3SetWebsiteOptions {
  bucketName: string;
  indexDocument: string;
  errorDocument?: string;
  redirectAllRequestsTo?: {
    hostName: string;
    protocol?: 'http' | 'https';
  };
  routingRules?: S3RoutingRule[];
  region?: string;
}

// ============================================================================
// S3 CORS Types
// ============================================================================

export interface S3CorsConfiguration {
  corsRules: S3CorsRule[];
}

export interface S3CorsRule {
  id?: string;
  allowedHeaders?: string[];
  allowedMethods: Array<'GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD'>;
  allowedOrigins: string[];
  exposeHeaders?: string[];
  maxAgeSeconds?: number;
}

export interface S3SetCorsOptions {
  bucketName: string;
  corsRules: S3CorsRule[];
  region?: string;
}

// ============================================================================
// S3 Logging Types
// ============================================================================

export interface S3BucketLogging {
  targetBucket?: string;
  targetPrefix?: string;
  targetGrants?: S3TargetGrant[];
}

export interface S3TargetGrant {
  grantee: {
    type: 'CanonicalUser' | 'AmazonCustomerByEmail' | 'Group';
    id?: string;
    emailAddress?: string;
    uri?: string;
    displayName?: string;
  };
  permission: 'FULL_CONTROL' | 'READ' | 'WRITE';
}

export interface S3SetLoggingOptions {
  bucketName: string;
  targetBucket: string;
  targetPrefix?: string;
  region?: string;
}

// ============================================================================
// S3 Replication Types
// ============================================================================

export interface S3ReplicationConfiguration {
  role: string;
  rules: S3ReplicationRule[];
}

export interface S3ReplicationRule {
  id?: string;
  priority?: number;
  status: 'Enabled' | 'Disabled';
  filter?: S3ReplicationRuleFilter;
  prefix?: string;
  destination: S3ReplicationDestination;
  deleteMarkerReplication?: {
    status: 'Enabled' | 'Disabled';
  };
  sourceSelectionCriteria?: {
    sseKmsEncryptedObjects?: {
      status: 'Enabled' | 'Disabled';
    };
    replicaModifications?: {
      status: 'Enabled' | 'Disabled';
    };
  };
  existingObjectReplication?: {
    status: 'Enabled' | 'Disabled';
  };
}

export interface S3ReplicationRuleFilter {
  prefix?: string;
  tag?: { key: string; value: string };
  and?: {
    prefix?: string;
    tags?: Array<{ key: string; value: string }>;
  };
}

export interface S3ReplicationDestination {
  bucket: string;
  account?: string;
  storageClass?: S3StorageClass;
  accessControlTranslation?: {
    owner: 'Destination';
  };
  encryptionConfiguration?: {
    replicaKmsKeyId?: string;
  };
  replicationTime?: {
    status: 'Enabled' | 'Disabled';
    time: { minutes: number };
  };
  metrics?: {
    status: 'Enabled' | 'Disabled';
    eventThreshold?: { minutes: number };
  };
}

export interface S3SetReplicationOptions {
  bucketName: string;
  role: string;
  rules: S3ReplicationRule[];
  region?: string;
}

// ============================================================================
// S3 Notification Types
// ============================================================================

export interface S3NotificationConfiguration {
  topicConfigurations?: S3TopicConfiguration[];
  queueConfigurations?: S3QueueConfiguration[];
  lambdaFunctionConfigurations?: S3LambdaFunctionConfiguration[];
  eventBridgeConfiguration?: {
    eventBridgeEnabled: boolean;
  };
}

export interface S3TopicConfiguration {
  id?: string;
  topicArn: string;
  events: S3EventType[];
  filter?: S3NotificationFilter;
}

export interface S3QueueConfiguration {
  id?: string;
  queueArn: string;
  events: S3EventType[];
  filter?: S3NotificationFilter;
}

export interface S3LambdaFunctionConfiguration {
  id?: string;
  lambdaFunctionArn: string;
  events: S3EventType[];
  filter?: S3NotificationFilter;
}

export interface S3NotificationFilter {
  key?: {
    filterRules: Array<{
      name: 'prefix' | 'suffix';
      value: string;
    }>;
  };
}

export type S3EventType =
  | 's3:ObjectCreated:*'
  | 's3:ObjectCreated:Put'
  | 's3:ObjectCreated:Post'
  | 's3:ObjectCreated:Copy'
  | 's3:ObjectCreated:CompleteMultipartUpload'
  | 's3:ObjectRemoved:*'
  | 's3:ObjectRemoved:Delete'
  | 's3:ObjectRemoved:DeleteMarkerCreated'
  | 's3:ObjectRestore:*'
  | 's3:ObjectRestore:Post'
  | 's3:ObjectRestore:Completed'
  | 's3:ObjectRestore:Delete'
  | 's3:ReducedRedundancyLostObject'
  | 's3:Replication:*'
  | 's3:Replication:OperationFailedReplication'
  | 's3:Replication:OperationNotTracked'
  | 's3:Replication:OperationMissedThreshold'
  | 's3:Replication:OperationReplicatedAfterThreshold'
  | 's3:ObjectTagging:*'
  | 's3:ObjectTagging:Put'
  | 's3:ObjectTagging:Delete'
  | 's3:ObjectAcl:Put'
  | 's3:LifecycleExpiration:*'
  | 's3:LifecycleExpiration:Delete'
  | 's3:LifecycleExpiration:DeleteMarkerCreated'
  | 's3:LifecycleTransition'
  | 's3:IntelligentTiering'
  | 's3:ObjectSynced:*'
  | 's3:ObjectSynced:Create'
  | 's3:ObjectSynced:Delete';

export interface S3SetNotificationOptions {
  bucketName: string;
  topicConfigurations?: S3TopicConfiguration[];
  queueConfigurations?: S3QueueConfiguration[];
  lambdaFunctionConfigurations?: S3LambdaFunctionConfiguration[];
  eventBridgeEnabled?: boolean;
  region?: string;
}

// ============================================================================
// S3 Object Lock Types
// ============================================================================

export interface S3ObjectLockConfiguration {
  objectLockEnabled?: 'Enabled';
  rule?: {
    defaultRetention?: {
      mode?: 'GOVERNANCE' | 'COMPLIANCE';
      days?: number;
      years?: number;
    };
  };
}

export interface S3SetObjectLockOptions {
  bucketName: string;
  mode?: 'GOVERNANCE' | 'COMPLIANCE';
  days?: number;
  years?: number;
  region?: string;
}

// ============================================================================
// S3 Presigned URL Types
// ============================================================================

export interface S3GetPresignedUrlOptions {
  bucketName: string;
  key: string;
  operation: 'getObject' | 'putObject';
  expiresIn?: number;
  versionId?: string;
  contentType?: string;
  contentDisposition?: string;
  region?: string;
}

export interface S3PresignedUrlResult {
  url: string;
  expiresAt: Date;
}

// ============================================================================
// S3 Multipart Upload Types
// ============================================================================

export interface S3MultipartUpload {
  uploadId: string;
  key: string;
  initiated?: Date;
  storageClass?: S3StorageClass;
  owner?: {
    displayName?: string;
    id?: string;
  };
  initiator?: {
    displayName?: string;
    id?: string;
  };
}

export interface S3ListMultipartUploadsOptions {
  bucketName: string;
  prefix?: string;
  delimiter?: string;
  maxUploads?: number;
  keyMarker?: string;
  uploadIdMarker?: string;
  region?: string;
}

export interface S3AbortMultipartUploadOptions {
  bucketName: string;
  key: string;
  uploadId: string;
  region?: string;
}

// ============================================================================
// S3 Intelligent Tiering Types
// ============================================================================

export interface S3IntelligentTieringConfiguration {
  id: string;
  status: 'Enabled' | 'Disabled';
  filter?: {
    prefix?: string;
    tag?: { key: string; value: string };
    and?: {
      prefix?: string;
      tags?: Array<{ key: string; value: string }>;
    };
  };
  tierings: Array<{
    accessTier: 'ARCHIVE_ACCESS' | 'DEEP_ARCHIVE_ACCESS';
    days: number;
  }>;
}

// ============================================================================
// S3 Inventory Types
// ============================================================================

export interface S3InventoryConfiguration {
  id: string;
  isEnabled: boolean;
  destination: {
    s3BucketDestination: {
      accountId?: string;
      bucket: string;
      format: 'CSV' | 'ORC' | 'Parquet';
      prefix?: string;
      encryption?: {
        sseKms?: { keyId: string };
        sseS3?: Record<string, never>;
      };
    };
  };
  filter?: {
    prefix: string;
  };
  includedObjectVersions: 'All' | 'Current';
  schedule: {
    frequency: 'Daily' | 'Weekly';
  };
  optionalFields?: Array<
    | 'Size'
    | 'LastModifiedDate'
    | 'StorageClass'
    | 'ETag'
    | 'IsMultipartUploaded'
    | 'ReplicationStatus'
    | 'EncryptionStatus'
    | 'ObjectLockRetainUntilDate'
    | 'ObjectLockMode'
    | 'ObjectLockLegalHoldStatus'
    | 'IntelligentTieringAccessTier'
    | 'BucketKeyStatus'
    | 'ChecksumAlgorithm'
  >;
}

// ============================================================================
// S3 Analytics Types
// ============================================================================

export interface S3AnalyticsConfiguration {
  id: string;
  filter?: {
    prefix?: string;
    tag?: { key: string; value: string };
    and?: {
      prefix?: string;
      tags?: Array<{ key: string; value: string }>;
    };
  };
  storageClassAnalysis: {
    dataExport?: {
      outputSchemaVersion: 'V_1';
      destination: {
        s3BucketDestination: {
          format: 'CSV';
          bucket: string;
          bucketAccountId?: string;
          prefix?: string;
        };
      };
    };
  };
}

// ============================================================================
// S3 Metrics Types
// ============================================================================

export interface S3BucketMetrics {
  bucketName: string;
  numberOfObjects?: number;
  bucketSizeBytes?: number;
  lastUpdated?: Date;
}

// ============================================================================
// CloudFront Types (for S3 integration)
// ============================================================================

export interface CloudFrontDistributionConfig {
  callerReference: string;
  comment?: string;
  defaultRootObject?: string;
  enabled: boolean;
  origins: CloudFrontOrigin[];
  defaultCacheBehavior: CloudFrontCacheBehavior;
  cacheBehaviors?: CloudFrontCacheBehavior[];
  aliases?: string[];
  priceClass?: 'PriceClass_100' | 'PriceClass_200' | 'PriceClass_All';
  viewerCertificate?: CloudFrontViewerCertificate;
  restrictions?: CloudFrontRestrictions;
  webAclId?: string;
  httpVersion?: 'http1.1' | 'http2' | 'http3' | 'http2and3';
  isIPV6Enabled?: boolean;
}

export interface CloudFrontOrigin {
  id: string;
  domainName: string;
  originPath?: string;
  customHeaders?: Array<{ headerName: string; headerValue: string }>;
  s3OriginConfig?: {
    originAccessIdentity: string;
  };
  originAccessControlId?: string;
  connectionAttempts?: number;
  connectionTimeout?: number;
  originShield?: {
    enabled: boolean;
    originShieldRegion?: string;
  };
}

export interface CloudFrontCacheBehavior {
  pathPattern?: string;
  targetOriginId: string;
  viewerProtocolPolicy: 'allow-all' | 'https-only' | 'redirect-to-https';
  allowedMethods?: Array<'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'OPTIONS' | 'DELETE'>;
  cachedMethods?: Array<'GET' | 'HEAD' | 'OPTIONS'>;
  compress?: boolean;
  cachePolicyId?: string;
  originRequestPolicyId?: string;
  responseHeadersPolicyId?: string;
  functionAssociations?: Array<{
    eventType: 'viewer-request' | 'viewer-response';
    functionArn: string;
  }>;
  lambdaFunctionAssociations?: Array<{
    eventType: 'viewer-request' | 'viewer-response' | 'origin-request' | 'origin-response';
    lambdaFunctionArn: string;
    includeBody?: boolean;
  }>;
  defaultTTL?: number;
  minTTL?: number;
  maxTTL?: number;
  smoothStreaming?: boolean;
  realtimeLogConfigArn?: string;
}

export interface CloudFrontViewerCertificate {
  cloudFrontDefaultCertificate?: boolean;
  acmCertificateArn?: string;
  iamCertificateId?: string;
  sslSupportMethod?: 'sni-only' | 'vip' | 'static-ip';
  minimumProtocolVersion?:
    | 'SSLv3'
    | 'TLSv1'
    | 'TLSv1_2016'
    | 'TLSv1.1_2016'
    | 'TLSv1.2_2018'
    | 'TLSv1.2_2019'
    | 'TLSv1.2_2021';
}

export interface CloudFrontRestrictions {
  geoRestriction: {
    restrictionType: 'blacklist' | 'whitelist' | 'none';
    items?: string[];
  };
}

export interface CloudFrontDistribution {
  id: string;
  arn: string;
  domainName: string;
  status: string;
  lastModifiedTime?: Date;
  enabled: boolean;
  comment?: string;
  priceClass?: string;
  aliases?: string[];
  origins?: CloudFrontOrigin[];
  defaultCacheBehavior?: CloudFrontCacheBehavior;
}

export interface CloudFrontOriginAccessControl {
  id: string;
  name: string;
  description?: string;
  signingProtocol: 'sigv4';
  signingBehavior: 'always' | 'never' | 'no-override';
  originAccessControlOriginType: 's3' | 'mediastore';
}

export interface S3CreateCloudFrontDistributionOptions {
  bucketName: string;
  comment?: string;
  defaultRootObject?: string;
  priceClass?: 'PriceClass_100' | 'PriceClass_200' | 'PriceClass_All';
  aliases?: string[];
  acmCertificateArn?: string;
  viewerProtocolPolicy?: 'allow-all' | 'https-only' | 'redirect-to-https';
  compress?: boolean;
  cachePolicyId?: string;
  originRequestPolicyId?: string;
  httpVersion?: 'http1.1' | 'http2' | 'http3' | 'http2and3';
  region?: string;
}
