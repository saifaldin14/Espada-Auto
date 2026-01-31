/**
 * AWS S3 Manager
 * Comprehensive S3 operations implementation
 */

import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  GetBucketVersioningCommand,
  PutBucketVersioningCommand,
  GetBucketEncryptionCommand,
  PutBucketEncryptionCommand,
  DeleteBucketEncryptionCommand,
  GetPublicAccessBlockCommand,
  PutPublicAccessBlockCommand,
  DeletePublicAccessBlockCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  DeleteBucketLifecycleCommand,
  GetBucketWebsiteCommand,
  PutBucketWebsiteCommand,
  DeleteBucketWebsiteCommand,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  DeleteBucketCorsCommand,
  GetBucketLoggingCommand,
  PutBucketLoggingCommand,
  GetBucketReplicationCommand,
  PutBucketReplicationCommand,
  DeleteBucketReplicationCommand,
  GetBucketNotificationConfigurationCommand,
  PutBucketNotificationConfigurationCommand,
  GetBucketTaggingCommand,
  PutBucketTaggingCommand,
  DeleteBucketTaggingCommand,
  GetBucketLocationCommand,
  GetBucketAccelerateConfigurationCommand,
  PutBucketAccelerateConfigurationCommand,
  GetBucketRequestPaymentCommand,
  PutBucketRequestPaymentCommand,
  GetObjectLockConfigurationCommand,
  PutObjectLockConfigurationCommand,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
  GetBucketPolicyCommand,
  PutBucketPolicyCommand,
  DeleteBucketPolicyCommand,
  GetObjectTaggingCommand,
  PutObjectTaggingCommand,
  DeleteObjectTaggingCommand,
  GetObjectAclCommand,
  PutObjectAclCommand,
  type Owner,
  type ObjectVersion,
  type DeleteMarkerEntry,
  type LifecycleRule,
  type CORSRule,
  type ReplicationRule,
  type TopicConfiguration,
  type QueueConfiguration,
  type LambdaFunctionConfiguration,
  type MultipartUpload,
  type BucketLocationConstraint,
  type TransitionStorageClass,
  type Event as S3Event,
} from '@aws-sdk/client-s3';

import {
  CloudFrontClient,
  CreateDistributionCommand,
  GetDistributionCommand,
  DeleteDistributionCommand,
  ListDistributionsCommand,
  CreateOriginAccessControlCommand,
  GetOriginAccessControlCommand,
  DeleteOriginAccessControlCommand,
  ListOriginAccessControlsCommand,
  type Distribution,
  type DistributionSummary,
  type OriginAccessControlSummary,
} from '@aws-sdk/client-cloudfront';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  S3ClientConfig,
  S3OperationResult,
  S3Bucket,
  S3BucketDetails,
  S3CreateBucketOptions,
  S3Object,
  S3ObjectDetails,
  S3UploadOptions,
  S3DownloadOptions,
  S3DownloadResult,
  S3CopyOptions,
  S3DeleteOptions,
  S3DeleteMultipleOptions,
  S3ListObjectsOptions,
  S3ListObjectsResult,
  S3ListObjectVersionsOptions,
  S3ObjectVersion,
  S3DeleteMarker,
  S3VersioningStatus,
  S3SetVersioningOptions,
  S3BucketEncryption,
  S3SetEncryptionOptions,
  S3PublicAccessBlock,
  S3SetPublicAccessBlockOptions,
  S3LifecycleConfiguration,
  S3LifecycleRule,
  S3SetLifecycleOptions,
  S3WebsiteConfiguration,
  S3SetWebsiteOptions,
  S3CorsConfiguration,
  S3CorsRule,
  S3SetCorsOptions,
  S3BucketLogging,
  S3SetLoggingOptions,
  S3ReplicationConfiguration,
  S3SetReplicationOptions,
  S3NotificationConfiguration,
  S3TopicConfiguration,
  S3QueueConfiguration,
  S3LambdaFunctionConfiguration,
  S3EventType,
  S3SetNotificationOptions,
  S3SetObjectLockOptions,
  S3GetPresignedUrlOptions,
  S3PresignedUrlResult,
  S3MultipartUpload,
  S3ListMultipartUploadsOptions,
  S3AbortMultipartUploadOptions,
  S3StorageClass,
  CloudFrontDistribution,
  CloudFrontOriginAccessControl,
  S3CreateCloudFrontDistributionOptions,
  S3ObjectAcl,
} from './types.js';

// ============================================================================
// S3 Manager Class
// ============================================================================

export class S3Manager {
  private config: S3ClientConfig;
  private defaultRegion: string;

  constructor(config: S3ClientConfig = {}) {
    this.config = config;
    this.defaultRegion = config.region || process.env.AWS_REGION || 'us-east-1';
  }

  // --------------------------------------------------------------------------
  // Client Factory Methods
  // --------------------------------------------------------------------------

  private getS3Client(region?: string): S3Client {
    return new S3Client({
      region: region || this.defaultRegion,
      credentials: this.config.credentials,
    });
  }

  private getCloudFrontClient(region?: string): CloudFrontClient {
    // CloudFront is a global service, but we use us-east-1 for API calls
    return new CloudFrontClient({
      region: region || 'us-east-1',
      credentials: this.config.credentials,
    });
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  private mapOwner(owner?: Owner): { displayName?: string; id?: string } | undefined {
    if (!owner) return undefined;
    return {
      displayName: owner.DisplayName,
      id: owner.ID,
    };
  }

  private mapObjectVersion(version: ObjectVersion): S3ObjectVersion {
    return {
      key: version.Key || '',
      versionId: version.VersionId || '',
      isLatest: version.IsLatest,
      lastModified: version.LastModified,
      eTag: version.ETag,
      size: version.Size,
      storageClass: version.StorageClass as S3StorageClass,
      owner: this.mapOwner(version.Owner),
    };
  }

  private mapDeleteMarker(marker: DeleteMarkerEntry): S3DeleteMarker {
    return {
      key: marker.Key || '',
      versionId: marker.VersionId || '',
      isLatest: marker.IsLatest,
      lastModified: marker.LastModified,
      owner: this.mapOwner(marker.Owner),
    };
  }

  private mapLifecycleRule(rule: LifecycleRule): S3LifecycleRule {
    return {
      id: rule.ID,
      status: rule.Status as 'Enabled' | 'Disabled',
      filter: rule.Filter
        ? {
            prefix: rule.Filter.Prefix,
            tag: rule.Filter.Tag
              ? { key: rule.Filter.Tag.Key || '', value: rule.Filter.Tag.Value || '' }
              : undefined,
            and: rule.Filter.And
              ? {
                  prefix: rule.Filter.And.Prefix,
                  tags: rule.Filter.And.Tags?.map((t) => ({
                    key: t.Key || '',
                    value: t.Value || '',
                  })),
                  objectSizeGreaterThan: rule.Filter.And.ObjectSizeGreaterThan,
                  objectSizeLessThan: rule.Filter.And.ObjectSizeLessThan,
                }
              : undefined,
            objectSizeGreaterThan: rule.Filter.ObjectSizeGreaterThan,
            objectSizeLessThan: rule.Filter.ObjectSizeLessThan,
          }
        : undefined,
      prefix: rule.Prefix,
      expiration: rule.Expiration
        ? {
            date: rule.Expiration.Date,
            days: rule.Expiration.Days,
            expiredObjectDeleteMarker: rule.Expiration.ExpiredObjectDeleteMarker,
          }
        : undefined,
      transitions: rule.Transitions?.map((t) => ({
        date: t.Date,
        days: t.Days,
        storageClass: t.StorageClass as S3StorageClass,
      })),
      noncurrentVersionExpiration: rule.NoncurrentVersionExpiration
        ? {
            noncurrentDays: rule.NoncurrentVersionExpiration.NoncurrentDays,
            newerNoncurrentVersions: rule.NoncurrentVersionExpiration.NewerNoncurrentVersions,
          }
        : undefined,
      noncurrentVersionTransitions: rule.NoncurrentVersionTransitions?.map((t) => ({
        noncurrentDays: t.NoncurrentDays,
        storageClass: t.StorageClass as S3StorageClass,
        newerNoncurrentVersions: t.NewerNoncurrentVersions,
      })),
      abortIncompleteMultipartUpload: rule.AbortIncompleteMultipartUpload
        ? { daysAfterInitiation: rule.AbortIncompleteMultipartUpload.DaysAfterInitiation || 0 }
        : undefined,
    };
  }

  private mapCorsRule(rule: CORSRule): S3CorsRule {
    return {
      id: rule.ID,
      allowedHeaders: rule.AllowedHeaders,
      allowedMethods: (rule.AllowedMethods || []) as Array<
        'GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD'
      >,
      allowedOrigins: rule.AllowedOrigins || [],
      exposeHeaders: rule.ExposeHeaders,
      maxAgeSeconds: rule.MaxAgeSeconds,
    };
  }

  private mapReplicationRule(
    rule: ReplicationRule
  ): S3ReplicationConfiguration['rules'][number] {
    return {
      id: rule.ID,
      priority: rule.Priority,
      status: rule.Status as 'Enabled' | 'Disabled',
      filter: rule.Filter
        ? {
            prefix: rule.Filter.Prefix,
            tag: rule.Filter.Tag
              ? { key: rule.Filter.Tag.Key || '', value: rule.Filter.Tag.Value || '' }
              : undefined,
            and: rule.Filter.And
              ? {
                  prefix: rule.Filter.And.Prefix,
                  tags: rule.Filter.And.Tags?.map((t) => ({
                    key: t.Key || '',
                    value: t.Value || '',
                  })),
                }
              : undefined,
          }
        : undefined,
      prefix: rule.Prefix,
      destination: {
        bucket: rule.Destination?.Bucket || '',
        account: rule.Destination?.Account,
        storageClass: rule.Destination?.StorageClass as S3StorageClass,
        accessControlTranslation: rule.Destination?.AccessControlTranslation
          ? { owner: 'Destination' as const }
          : undefined,
        encryptionConfiguration: rule.Destination?.EncryptionConfiguration
          ? { replicaKmsKeyId: rule.Destination.EncryptionConfiguration.ReplicaKmsKeyID }
          : undefined,
        replicationTime: rule.Destination?.ReplicationTime
          ? {
              status: rule.Destination.ReplicationTime.Status as 'Enabled' | 'Disabled',
              time: { minutes: rule.Destination.ReplicationTime.Time?.Minutes || 0 },
            }
          : undefined,
        metrics: rule.Destination?.Metrics
          ? {
              status: rule.Destination.Metrics.Status as 'Enabled' | 'Disabled',
              eventThreshold: rule.Destination.Metrics.EventThreshold
                ? { minutes: rule.Destination.Metrics.EventThreshold.Minutes || 0 }
                : undefined,
            }
          : undefined,
      },
      deleteMarkerReplication: rule.DeleteMarkerReplication
        ? { status: rule.DeleteMarkerReplication.Status as 'Enabled' | 'Disabled' }
        : undefined,
      sourceSelectionCriteria: rule.SourceSelectionCriteria
        ? {
            sseKmsEncryptedObjects: rule.SourceSelectionCriteria.SseKmsEncryptedObjects
              ? {
                  status: rule.SourceSelectionCriteria.SseKmsEncryptedObjects
                    .Status as 'Enabled' | 'Disabled',
                }
              : undefined,
            replicaModifications: rule.SourceSelectionCriteria.ReplicaModifications
              ? {
                  status: rule.SourceSelectionCriteria.ReplicaModifications
                    .Status as 'Enabled' | 'Disabled',
                }
              : undefined,
          }
        : undefined,
      existingObjectReplication: rule.ExistingObjectReplication
        ? { status: rule.ExistingObjectReplication.Status as 'Enabled' | 'Disabled' }
        : undefined,
    };
  }

  private mapTopicConfiguration(
    config: TopicConfiguration
  ): S3TopicConfiguration {
    return {
      id: config.Id,
      topicArn: config.TopicArn || '',
      events: (config.Events || []) as S3EventType[],
      filter: config.Filter?.Key
        ? {
            key: {
              filterRules: (config.Filter.Key.FilterRules || []).map((r) => ({
                name: r.Name as 'prefix' | 'suffix',
                value: r.Value || '',
              })),
            },
          }
        : undefined,
    };
  }

  private mapQueueConfiguration(
    config: QueueConfiguration
  ): S3QueueConfiguration {
    return {
      id: config.Id,
      queueArn: config.QueueArn || '',
      events: (config.Events || []) as S3EventType[],
      filter: config.Filter?.Key
        ? {
            key: {
              filterRules: (config.Filter.Key.FilterRules || []).map((r) => ({
                name: r.Name as 'prefix' | 'suffix',
                value: r.Value || '',
              })),
            },
          }
        : undefined,
    };
  }

  private mapLambdaConfiguration(
    config: LambdaFunctionConfiguration
  ): S3LambdaFunctionConfiguration {
    return {
      id: config.Id,
      lambdaFunctionArn: config.LambdaFunctionArn || '',
      events: (config.Events || []) as S3EventType[],
      filter: config.Filter?.Key
        ? {
            key: {
              filterRules: (config.Filter.Key.FilterRules || []).map((r) => ({
                name: r.Name as 'prefix' | 'suffix',
                value: r.Value || '',
              })),
            },
          }
        : undefined,
    };
  }

  private mapMultipartUpload(upload: MultipartUpload): S3MultipartUpload {
    return {
      uploadId: upload.UploadId || '',
      key: upload.Key || '',
      initiated: upload.Initiated,
      storageClass: upload.StorageClass as S3StorageClass,
      owner: this.mapOwner(upload.Owner),
      initiator: upload.Initiator
        ? {
            displayName: upload.Initiator.DisplayName,
            id: upload.Initiator.ID,
          }
        : undefined,
    };
  }

  private mapDistribution(dist: Distribution | DistributionSummary): CloudFrontDistribution {
    const config = 'DistributionConfig' in dist ? dist.DistributionConfig : undefined;
    return {
      id: dist.Id || '',
      arn: dist.ARN || '',
      domainName: dist.DomainName || '',
      status: dist.Status || '',
      lastModifiedTime: dist.LastModifiedTime,
      enabled: config?.Enabled ?? ('Enabled' in dist ? (dist as DistributionSummary).Enabled : false) ?? false,
      comment: config?.Comment ?? ('Comment' in dist ? (dist as DistributionSummary).Comment : undefined),
      priceClass: config?.PriceClass ?? ('PriceClass' in dist ? (dist as DistributionSummary).PriceClass : undefined),
      aliases: config?.Aliases?.Items ?? ('Aliases' in dist ? (dist as DistributionSummary).Aliases?.Items : undefined),
    };
  }

  private mapOriginAccessControl(oac: OriginAccessControlSummary): CloudFrontOriginAccessControl {
    return {
      id: oac.Id || '',
      name: oac.Name || '',
      description: oac.Description,
      signingProtocol: 'sigv4',
      signingBehavior: (oac.SigningBehavior as 'always' | 'never' | 'no-override') || 'always',
      originAccessControlOriginType:
        (oac.OriginAccessControlOriginType as 's3' | 'mediastore') || 's3',
    };
  }

  // ==========================================================================
  // 1. S3 Bucket Creation and Configuration
  // ==========================================================================

  /**
   * List all S3 buckets
   */
  async listBuckets(region?: string): Promise<S3Bucket[]> {
    const client = this.getS3Client(region);

    const command = new ListBucketsCommand({});
    const response = await client.send(command);

    return (response.Buckets || []).map((bucket) => ({
      name: bucket.Name || '',
      creationDate: bucket.CreationDate,
    }));
  }

  /**
   * Check if a bucket exists
   */
  async bucketExists(bucketName: string, region?: string): Promise<boolean> {
    const client = this.getS3Client(region);

    try {
      await client.send(new HeadBucketCommand({ Bucket: bucketName }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get bucket location/region
   */
  async getBucketLocation(bucketName: string, region?: string): Promise<string> {
    const client = this.getS3Client(region);

    const command = new GetBucketLocationCommand({ Bucket: bucketName });
    const response = await client.send(command);

    // Empty string means us-east-1
    return response.LocationConstraint || 'us-east-1';
  }

  /**
   * Create a new S3 bucket
   */
  async createBucket(options: S3CreateBucketOptions): Promise<S3OperationResult> {
    const region = options.region || this.defaultRegion;
    const client = this.getS3Client(region);

    try {
      const command = new CreateBucketCommand({
        Bucket: options.bucketName,
        ACL: options.acl,
        ObjectOwnership: options.objectOwnership,
        ObjectLockEnabledForBucket: options.objectLockEnabledForBucket,
        // LocationConstraint is required for regions other than us-east-1
        CreateBucketConfiguration:
          region !== 'us-east-1' ? { LocationConstraint: region as BucketLocationConstraint } : undefined,
      });

      await client.send(command);

      return {
        success: true,
        message: `Bucket '${options.bucketName}' created in ${region}`,
        data: { bucketName: options.bucketName, region },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create bucket '${options.bucketName}'`,
        error: message,
      };
    }
  }

  /**
   * Delete an S3 bucket (must be empty)
   */
  async deleteBucket(bucketName: string, region?: string): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      await client.send(new DeleteBucketCommand({ Bucket: bucketName }));

      return {
        success: true,
        message: `Bucket '${bucketName}' deleted`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete bucket '${bucketName}'`,
        error: message,
      };
    }
  }

  /**
   * Get comprehensive bucket details
   */
  async getBucketDetails(bucketName: string, region?: string): Promise<S3BucketDetails | null> {
    const client = this.getS3Client(region);

    try {
      // Check if bucket exists
      await client.send(new HeadBucketCommand({ Bucket: bucketName }));

      const details: S3BucketDetails = {
        name: bucketName,
      };

      // Get bucket location
      try {
        const location = await this.getBucketLocation(bucketName, region);
        details.region = location;
      } catch {
        // Ignore
      }

      // Get versioning
      try {
        const versioning = await this.getVersioning(bucketName, region);
        details.versioning = versioning;
      } catch {
        // Ignore
      }

      // Get encryption
      try {
        const encryption = await this.getEncryption(bucketName, region);
        details.encryption = encryption ?? undefined;
      } catch {
        // Ignore - may not be configured
      }

      // Get public access block
      try {
        const publicAccess = await this.getPublicAccessBlock(bucketName, region);
        details.publicAccessBlock = publicAccess ?? undefined;
      } catch {
        // Ignore
      }

      // Get logging
      try {
        const logging = await this.getLogging(bucketName, region);
        details.logging = logging ?? undefined;
      } catch {
        // Ignore
      }

      // Get website configuration
      try {
        const website = await this.getWebsiteConfiguration(bucketName, region);
        details.website = website ?? undefined;
      } catch {
        // Ignore - may not be configured
      }

      // Get CORS
      try {
        const cors = await this.getCors(bucketName, region);
        details.cors = cors ?? undefined;
      } catch {
        // Ignore - may not be configured
      }

      // Get lifecycle
      try {
        const lifecycle = await this.getLifecycleConfiguration(bucketName, region);
        details.lifecycle = lifecycle ?? undefined;
      } catch {
        // Ignore - may not be configured
      }

      // Get tags
      try {
        const tags = await this.getBucketTags(bucketName, region);
        details.tags = tags;
      } catch {
        // Ignore
      }

      return details;
    } catch (error) {
      if ((error as Error).name === 'NotFound' || (error as Error).name === 'NoSuchBucket') {
        return null;
      }
      throw error;
    }
  }

  // ==========================================================================
  // 2. S3 Object Upload/Download Operations
  // ==========================================================================

  /**
   * Upload an object to S3
   */
  async uploadObject(options: S3UploadOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const command = new PutObjectCommand({
        Bucket: options.bucketName,
        Key: options.key,
        Body: options.body,
        ContentType: options.contentType,
        ContentEncoding: options.contentEncoding,
        ContentDisposition: options.contentDisposition,
        ContentLanguage: options.contentLanguage,
        CacheControl: options.cacheControl,
        Expires: options.expires,
        Metadata: options.metadata,
        ACL: options.acl,
        StorageClass: options.storageClass,
        ServerSideEncryption: options.serverSideEncryption,
        SSEKMSKeyId: options.sseKmsKeyId,
        BucketKeyEnabled: options.bucketKeyEnabled,
        Tagging: options.tagging,
        ObjectLockMode: options.objectLockMode,
        ObjectLockRetainUntilDate: options.objectLockRetainUntilDate,
        ObjectLockLegalHoldStatus: options.objectLockLegalHoldStatus,
        ChecksumAlgorithm: options.checksumAlgorithm,
      });

      const response = await client.send(command);

      return {
        success: true,
        message: `Object '${options.key}' uploaded to '${options.bucketName}'`,
        data: {
          eTag: response.ETag,
          versionId: response.VersionId,
          serverSideEncryption: response.ServerSideEncryption,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to upload '${options.key}'`,
        error: message,
      };
    }
  }

  /**
   * Download an object from S3
   */
  async downloadObject(options: S3DownloadOptions): Promise<S3DownloadResult> {
    const client = this.getS3Client(options.region);

    const command = new GetObjectCommand({
      Bucket: options.bucketName,
      Key: options.key,
      VersionId: options.versionId,
      Range: options.range,
      IfMatch: options.ifMatch,
      IfNoneMatch: options.ifNoneMatch,
      IfModifiedSince: options.ifModifiedSince,
      IfUnmodifiedSince: options.ifUnmodifiedSince,
    });

    const response = await client.send(command);

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    if (response.Body) {
      const stream = response.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
    }
    const body = Buffer.concat(chunks);

    return {
      body,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      contentEncoding: response.ContentEncoding,
      contentDisposition: response.ContentDisposition,
      eTag: response.ETag,
      lastModified: response.LastModified,
      versionId: response.VersionId,
      metadata: response.Metadata,
      serverSideEncryption: response.ServerSideEncryption,
      cacheControl: response.CacheControl,
      expires: response.Expires,
    };
  }

  /**
   * Get object metadata without downloading
   */
  async getObjectMetadata(
    bucketName: string,
    key: string,
    versionId?: string,
    region?: string
  ): Promise<S3ObjectDetails | null> {
    const client = this.getS3Client(region);

    try {
      const command = new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
        VersionId: versionId,
      });

      const response = await client.send(command);

      return {
        key,
        lastModified: response.LastModified,
        eTag: response.ETag,
        size: response.ContentLength,
        storageClass: response.StorageClass as S3StorageClass,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        contentEncoding: response.ContentEncoding,
        contentDisposition: response.ContentDisposition,
        contentLanguage: response.ContentLanguage,
        cacheControl: response.CacheControl,
        expires: response.Expires,
        metadata: response.Metadata,
        versionId: response.VersionId,
        deleteMarker: response.DeleteMarker,
        serverSideEncryption: response.ServerSideEncryption as 'AES256' | 'aws:kms' | 'aws:kms:dsse',
        sseKmsKeyId: response.SSEKMSKeyId,
        bucketKeyEnabled: response.BucketKeyEnabled,
        objectLockMode: response.ObjectLockMode as 'GOVERNANCE' | 'COMPLIANCE',
        objectLockRetainUntilDate: response.ObjectLockRetainUntilDate,
        objectLockLegalHoldStatus: response.ObjectLockLegalHoldStatus as 'ON' | 'OFF',
        replicationStatus: response.ReplicationStatus as 'COMPLETE' | 'PENDING' | 'FAILED' | 'REPLICA',
        partsCount: response.PartsCount,
        tagCount: response.TagCount,
      };
    } catch (error) {
      if ((error as Error).name === 'NotFound' || (error as Error).name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Copy an object
   */
  async copyObject(options: S3CopyOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const copySource = options.sourceVersionId
        ? `${options.sourceBucket}/${options.sourceKey}?versionId=${options.sourceVersionId}`
        : `${options.sourceBucket}/${options.sourceKey}`;

      const command = new CopyObjectCommand({
        Bucket: options.destinationBucket,
        Key: options.destinationKey,
        CopySource: copySource,
        ACL: options.acl,
        StorageClass: options.storageClass,
        ServerSideEncryption: options.serverSideEncryption,
        SSEKMSKeyId: options.sseKmsKeyId,
        Metadata: options.metadata,
        MetadataDirective: options.metadataDirective,
        Tagging: options.tagging,
        TaggingDirective: options.taggingDirective,
      });

      const response = await client.send(command);

      return {
        success: true,
        message: `Object copied to '${options.destinationBucket}/${options.destinationKey}'`,
        data: {
          eTag: response.CopyObjectResult?.ETag,
          lastModified: response.CopyObjectResult?.LastModified,
          versionId: response.VersionId,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to copy object`,
        error: message,
      };
    }
  }

  /**
   * Delete an object
   */
  async deleteObject(options: S3DeleteOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const command = new DeleteObjectCommand({
        Bucket: options.bucketName,
        Key: options.key,
        VersionId: options.versionId,
        BypassGovernanceRetention: options.bypassGovernanceRetention,
      });

      const response = await client.send(command);

      return {
        success: true,
        message: `Object '${options.key}' deleted`,
        data: {
          deleteMarker: response.DeleteMarker,
          versionId: response.VersionId,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete '${options.key}'`,
        error: message,
      };
    }
  }

  /**
   * Delete multiple objects
   */
  async deleteObjects(options: S3DeleteMultipleOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const command = new DeleteObjectsCommand({
        Bucket: options.bucketName,
        Delete: {
          Objects: options.objects.map((o) => ({
            Key: o.key,
            VersionId: o.versionId,
          })),
          Quiet: options.quiet,
        },
        BypassGovernanceRetention: options.bypassGovernanceRetention,
      });

      const response = await client.send(command);

      return {
        success: true,
        message: `Deleted ${response.Deleted?.length || 0} objects`,
        data: {
          deleted: response.Deleted?.map((d) => ({
            key: d.Key,
            versionId: d.VersionId,
            deleteMarker: d.DeleteMarker,
          })),
          errors: response.Errors?.map((e) => ({
            key: e.Key,
            versionId: e.VersionId,
            code: e.Code,
            message: e.Message,
          })),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete objects`,
        error: message,
      };
    }
  }

  /**
   * List objects in a bucket
   */
  async listObjects(options: S3ListObjectsOptions): Promise<S3ListObjectsResult> {
    const client = this.getS3Client(options.region);

    const command = new ListObjectsV2Command({
      Bucket: options.bucketName,
      Prefix: options.prefix,
      Delimiter: options.delimiter,
      MaxKeys: options.maxKeys,
      StartAfter: options.startAfter,
      ContinuationToken: options.continuationToken,
      FetchOwner: options.fetchOwner,
    });

    const response = await client.send(command);

    return {
      objects: (response.Contents || []).map((obj) => ({
        key: obj.Key || '',
        lastModified: obj.LastModified,
        eTag: obj.ETag,
        size: obj.Size,
        storageClass: obj.StorageClass as S3StorageClass,
        owner: this.mapOwner(obj.Owner),
        checksumAlgorithm: obj.ChecksumAlgorithm as S3Object['checksumAlgorithm'],
      })),
      commonPrefixes: response.CommonPrefixes?.map((p) => p.Prefix || ''),
      isTruncated: response.IsTruncated,
      continuationToken: response.ContinuationToken,
      nextContinuationToken: response.NextContinuationToken,
      keyCount: response.KeyCount,
    };
  }

  /**
   * List object versions
   */
  async listObjectVersions(
    options: S3ListObjectVersionsOptions
  ): Promise<{
    versions: S3ObjectVersion[];
    deleteMarkers: S3DeleteMarker[];
    isTruncated?: boolean;
    nextKeyMarker?: string;
    nextVersionIdMarker?: string;
  }> {
    const client = this.getS3Client(options.region);

    const command = new ListObjectVersionsCommand({
      Bucket: options.bucketName,
      Prefix: options.prefix,
      Delimiter: options.delimiter,
      MaxKeys: options.maxKeys,
      KeyMarker: options.keyMarker,
      VersionIdMarker: options.versionIdMarker,
    });

    const response = await client.send(command);

    return {
      versions: (response.Versions || []).map((v) => this.mapObjectVersion(v)),
      deleteMarkers: (response.DeleteMarkers || []).map((m) => this.mapDeleteMarker(m)),
      isTruncated: response.IsTruncated,
      nextKeyMarker: response.NextKeyMarker,
      nextVersionIdMarker: response.NextVersionIdMarker,
    };
  }

  /**
   * Generate presigned URL for upload or download
   */
  async getPresignedUrl(options: S3GetPresignedUrlOptions): Promise<S3PresignedUrlResult> {
    const client = this.getS3Client(options.region);
    const expiresIn = options.expiresIn || 3600; // Default 1 hour

    let command;
    if (options.operation === 'getObject') {
      command = new GetObjectCommand({
        Bucket: options.bucketName,
        Key: options.key,
        VersionId: options.versionId,
      });
    } else {
      command = new PutObjectCommand({
        Bucket: options.bucketName,
        Key: options.key,
        ContentType: options.contentType,
        ContentDisposition: options.contentDisposition,
      });
    }

    const url = await getSignedUrl(client, command, { expiresIn });

    return {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  // ==========================================================================
  // 3. S3 Lifecycle Policy Management
  // ==========================================================================

  /**
   * Get lifecycle configuration
   */
  async getLifecycleConfiguration(
    bucketName: string,
    region?: string
  ): Promise<S3LifecycleConfiguration | null> {
    const client = this.getS3Client(region);

    try {
      const command = new GetBucketLifecycleConfigurationCommand({ Bucket: bucketName });
      const response = await client.send(command);

      return {
        rules: (response.Rules || []).map((r) => this.mapLifecycleRule(r)),
      };
    } catch (error) {
      if ((error as Error).name === 'NoSuchLifecycleConfiguration') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Set lifecycle configuration
   */
  async setLifecycleConfiguration(options: S3SetLifecycleOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const command = new PutBucketLifecycleConfigurationCommand({
        Bucket: options.bucketName,
        LifecycleConfiguration: {
          Rules: options.rules.map((rule) => ({
            ID: rule.id,
            Status: rule.status,
            Filter: rule.filter
              ? {
                  Prefix: rule.filter.prefix,
                  Tag: rule.filter.tag
                    ? { Key: rule.filter.tag.key, Value: rule.filter.tag.value }
                    : undefined,
                  And: rule.filter.and
                    ? {
                        Prefix: rule.filter.and.prefix,
                        Tags: rule.filter.and.tags?.map((t) => ({
                          Key: t.key,
                          Value: t.value,
                        })),
                        ObjectSizeGreaterThan: rule.filter.and.objectSizeGreaterThan,
                        ObjectSizeLessThan: rule.filter.and.objectSizeLessThan,
                      }
                    : undefined,
                  ObjectSizeGreaterThan: rule.filter.objectSizeGreaterThan,
                  ObjectSizeLessThan: rule.filter.objectSizeLessThan,
                }
              : undefined,
            Prefix: rule.prefix,
            Expiration: rule.expiration
              ? {
                  Date: rule.expiration.date,
                  Days: rule.expiration.days,
                  ExpiredObjectDeleteMarker: rule.expiration.expiredObjectDeleteMarker,
                }
              : undefined,
            Transitions: rule.transitions?.map((t) => ({
              Date: t.date,
              Days: t.days,
              StorageClass: t.storageClass as TransitionStorageClass,
            })),
            NoncurrentVersionExpiration: rule.noncurrentVersionExpiration
              ? {
                  NoncurrentDays: rule.noncurrentVersionExpiration.noncurrentDays,
                  NewerNoncurrentVersions:
                    rule.noncurrentVersionExpiration.newerNoncurrentVersions,
                }
              : undefined,
            NoncurrentVersionTransitions: rule.noncurrentVersionTransitions?.map((t) => ({
              NoncurrentDays: t.noncurrentDays,
              StorageClass: t.storageClass as TransitionStorageClass,
              NewerNoncurrentVersions: t.newerNoncurrentVersions,
            })),
            AbortIncompleteMultipartUpload: rule.abortIncompleteMultipartUpload
              ? { DaysAfterInitiation: rule.abortIncompleteMultipartUpload.daysAfterInitiation }
              : undefined,
          })),
        },
      });

      await client.send(command);

      return {
        success: true,
        message: `Lifecycle configuration set for '${options.bucketName}'`,
        data: { rulesCount: options.rules.length },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set lifecycle configuration`,
        error: message,
      };
    }
  }

  /**
   * Delete lifecycle configuration
   */
  async deleteLifecycleConfiguration(
    bucketName: string,
    region?: string
  ): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      await client.send(new DeleteBucketLifecycleCommand({ Bucket: bucketName }));

      return {
        success: true,
        message: `Lifecycle configuration deleted from '${bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete lifecycle configuration`,
        error: message,
      };
    }
  }

  // ==========================================================================
  // 4. S3 Versioning and Encryption
  // ==========================================================================

  /**
   * Get versioning status
   */
  async getVersioning(bucketName: string, region?: string): Promise<S3VersioningStatus> {
    const client = this.getS3Client(region);

    const command = new GetBucketVersioningCommand({ Bucket: bucketName });
    const response = await client.send(command);

    if (!response.Status) {
      return 'Disabled';
    }
    return response.Status as S3VersioningStatus;
  }

  /**
   * Set versioning
   */
  async setVersioning(options: S3SetVersioningOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const command = new PutBucketVersioningCommand({
        Bucket: options.bucketName,
        VersioningConfiguration: {
          Status: options.status,
          MFADelete: options.mfaDelete,
        },
      });

      await client.send(command);

      return {
        success: true,
        message: `Versioning ${options.status.toLowerCase()} for '${options.bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set versioning`,
        error: message,
      };
    }
  }

  /**
   * Get encryption configuration
   */
  async getEncryption(bucketName: string, region?: string): Promise<S3BucketEncryption | null> {
    const client = this.getS3Client(region);

    try {
      const command = new GetBucketEncryptionCommand({ Bucket: bucketName });
      const response = await client.send(command);

      return {
        rules:
          response.ServerSideEncryptionConfiguration?.Rules?.map((rule) => ({
            applyServerSideEncryptionByDefault: rule.ApplyServerSideEncryptionByDefault
              ? {
                  sseAlgorithm: rule.ApplyServerSideEncryptionByDefault
                    .SSEAlgorithm as 'AES256' | 'aws:kms' | 'aws:kms:dsse',
                  kmsMasterKeyId: rule.ApplyServerSideEncryptionByDefault.KMSMasterKeyID,
                }
              : undefined,
            bucketKeyEnabled: rule.BucketKeyEnabled,
          })) || [],
      };
    } catch (error) {
      if (
        (error as Error).name === 'ServerSideEncryptionConfigurationNotFoundError'
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Set encryption configuration
   */
  async setEncryption(options: S3SetEncryptionOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const command = new PutBucketEncryptionCommand({
        Bucket: options.bucketName,
        ServerSideEncryptionConfiguration: {
          Rules: [
            {
              ApplyServerSideEncryptionByDefault: {
                SSEAlgorithm: options.sseAlgorithm,
                KMSMasterKeyID: options.kmsMasterKeyId,
              },
              BucketKeyEnabled: options.bucketKeyEnabled,
            },
          ],
        },
      });

      await client.send(command);

      return {
        success: true,
        message: `Encryption configured for '${options.bucketName}' (${options.sseAlgorithm})`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set encryption`,
        error: message,
      };
    }
  }

  /**
   * Delete encryption configuration
   */
  async deleteEncryption(bucketName: string, region?: string): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      await client.send(new DeleteBucketEncryptionCommand({ Bucket: bucketName }));

      return {
        success: true,
        message: `Encryption configuration deleted from '${bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete encryption`,
        error: message,
      };
    }
  }

  /**
   * Get public access block
   */
  async getPublicAccessBlock(
    bucketName: string,
    region?: string
  ): Promise<S3PublicAccessBlock | null> {
    const client = this.getS3Client(region);

    try {
      const command = new GetPublicAccessBlockCommand({ Bucket: bucketName });
      const response = await client.send(command);

      return {
        blockPublicAcls: response.PublicAccessBlockConfiguration?.BlockPublicAcls,
        ignorePublicAcls: response.PublicAccessBlockConfiguration?.IgnorePublicAcls,
        blockPublicPolicy: response.PublicAccessBlockConfiguration?.BlockPublicPolicy,
        restrictPublicBuckets: response.PublicAccessBlockConfiguration?.RestrictPublicBuckets,
      };
    } catch (error) {
      if ((error as Error).name === 'NoSuchPublicAccessBlockConfiguration') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Set public access block
   */
  async setPublicAccessBlock(options: S3SetPublicAccessBlockOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const command = new PutPublicAccessBlockCommand({
        Bucket: options.bucketName,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: options.blockPublicAcls,
          IgnorePublicAcls: options.ignorePublicAcls,
          BlockPublicPolicy: options.blockPublicPolicy,
          RestrictPublicBuckets: options.restrictPublicBuckets,
        },
      });

      await client.send(command);

      return {
        success: true,
        message: `Public access block configured for '${options.bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set public access block`,
        error: message,
      };
    }
  }

  /**
   * Delete public access block
   */
  async deletePublicAccessBlock(bucketName: string, region?: string): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      await client.send(new DeletePublicAccessBlockCommand({ Bucket: bucketName }));

      return {
        success: true,
        message: `Public access block deleted from '${bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete public access block`,
        error: message,
      };
    }
  }

  // ==========================================================================
  // 5. S3 Static Website Hosting Setup
  // ==========================================================================

  /**
   * Get website configuration
   */
  async getWebsiteConfiguration(
    bucketName: string,
    region?: string
  ): Promise<S3WebsiteConfiguration | null> {
    const client = this.getS3Client(region);

    try {
      const command = new GetBucketWebsiteCommand({ Bucket: bucketName });
      const response = await client.send(command);

      return {
        indexDocument: response.IndexDocument
          ? { suffix: response.IndexDocument.Suffix || '' }
          : undefined,
        errorDocument: response.ErrorDocument
          ? { key: response.ErrorDocument.Key || '' }
          : undefined,
        redirectAllRequestsTo: response.RedirectAllRequestsTo
          ? {
              hostName: response.RedirectAllRequestsTo.HostName || '',
              protocol: response.RedirectAllRequestsTo.Protocol as 'http' | 'https',
            }
          : undefined,
        routingRules: response.RoutingRules?.map((rule) => ({
          condition: rule.Condition
            ? {
                httpErrorCodeReturnedEquals: rule.Condition.HttpErrorCodeReturnedEquals,
                keyPrefixEquals: rule.Condition.KeyPrefixEquals,
              }
            : undefined,
          redirect: {
            hostName: rule.Redirect?.HostName,
            httpRedirectCode: rule.Redirect?.HttpRedirectCode,
            protocol: rule.Redirect?.Protocol as 'http' | 'https' | undefined,
            replaceKeyPrefixWith: rule.Redirect?.ReplaceKeyPrefixWith,
            replaceKeyWith: rule.Redirect?.ReplaceKeyWith,
          },
        })),
      };
    } catch (error) {
      if ((error as Error).name === 'NoSuchWebsiteConfiguration') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Set website configuration
   */
  async setWebsiteConfiguration(options: S3SetWebsiteOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const command = new PutBucketWebsiteCommand({
        Bucket: options.bucketName,
        WebsiteConfiguration: {
          IndexDocument: { Suffix: options.indexDocument },
          ErrorDocument: options.errorDocument ? { Key: options.errorDocument } : undefined,
          RedirectAllRequestsTo: options.redirectAllRequestsTo
            ? {
                HostName: options.redirectAllRequestsTo.hostName,
                Protocol: options.redirectAllRequestsTo.protocol,
              }
            : undefined,
          RoutingRules: options.routingRules?.map((rule) => ({
            Condition: rule.condition
              ? {
                  HttpErrorCodeReturnedEquals: rule.condition.httpErrorCodeReturnedEquals,
                  KeyPrefixEquals: rule.condition.keyPrefixEquals,
                }
              : undefined,
            Redirect: {
              HostName: rule.redirect.hostName,
              HttpRedirectCode: rule.redirect.httpRedirectCode,
              Protocol: rule.redirect.protocol,
              ReplaceKeyPrefixWith: rule.redirect.replaceKeyPrefixWith,
              ReplaceKeyWith: rule.redirect.replaceKeyWith,
            },
          })),
        },
      });

      await client.send(command);

      const websiteUrl = `http://${options.bucketName}.s3-website-${options.region || this.defaultRegion}.amazonaws.com`;

      return {
        success: true,
        message: `Website hosting enabled for '${options.bucketName}'`,
        data: { websiteUrl },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set website configuration`,
        error: message,
      };
    }
  }

  /**
   * Delete website configuration
   */
  async deleteWebsiteConfiguration(
    bucketName: string,
    region?: string
  ): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      await client.send(new DeleteBucketWebsiteCommand({ Bucket: bucketName }));

      return {
        success: true,
        message: `Website configuration deleted from '${bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete website configuration`,
        error: message,
      };
    }
  }

  /**
   * Get CORS configuration
   */
  async getCors(bucketName: string, region?: string): Promise<S3CorsConfiguration | null> {
    const client = this.getS3Client(region);

    try {
      const command = new GetBucketCorsCommand({ Bucket: bucketName });
      const response = await client.send(command);

      return {
        corsRules: (response.CORSRules || []).map((r) => this.mapCorsRule(r)),
      };
    } catch (error) {
      if ((error as Error).name === 'NoSuchCORSConfiguration') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Set CORS configuration
   */
  async setCors(options: S3SetCorsOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const command = new PutBucketCorsCommand({
        Bucket: options.bucketName,
        CORSConfiguration: {
          CORSRules: options.corsRules.map((rule) => ({
            ID: rule.id,
            AllowedHeaders: rule.allowedHeaders,
            AllowedMethods: rule.allowedMethods,
            AllowedOrigins: rule.allowedOrigins,
            ExposeHeaders: rule.exposeHeaders,
            MaxAgeSeconds: rule.maxAgeSeconds,
          })),
        },
      });

      await client.send(command);

      return {
        success: true,
        message: `CORS configuration set for '${options.bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set CORS configuration`,
        error: message,
      };
    }
  }

  /**
   * Delete CORS configuration
   */
  async deleteCors(bucketName: string, region?: string): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      await client.send(new DeleteBucketCorsCommand({ Bucket: bucketName }));

      return {
        success: true,
        message: `CORS configuration deleted from '${bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete CORS configuration`,
        error: message,
      };
    }
  }

  // ==========================================================================
  // 6. S3 CloudFront Integration
  // ==========================================================================

  /**
   * List CloudFront distributions
   */
  async listCloudFrontDistributions(region?: string): Promise<CloudFrontDistribution[]> {
    const client = this.getCloudFrontClient(region);

    const command = new ListDistributionsCommand({});
    const response = await client.send(command);

    return (response.DistributionList?.Items || []).map((d) => this.mapDistribution(d));
  }

  /**
   * Get CloudFront distribution
   */
  async getCloudFrontDistribution(
    distributionId: string,
    region?: string
  ): Promise<CloudFrontDistribution | null> {
    const client = this.getCloudFrontClient(region);

    try {
      const command = new GetDistributionCommand({ Id: distributionId });
      const response = await client.send(command);

      if (!response.Distribution) return null;
      return this.mapDistribution(response.Distribution);
    } catch (error) {
      if ((error as Error).name === 'NoSuchDistribution') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create CloudFront distribution for S3 bucket
   */
  async createCloudFrontDistribution(
    options: S3CreateCloudFrontDistributionOptions
  ): Promise<S3OperationResult> {
    const client = this.getCloudFrontClient(options.region);
    const bucketRegion = options.region || this.defaultRegion;

    try {
      // First create an Origin Access Control
      const oacCommand = new CreateOriginAccessControlCommand({
        OriginAccessControlConfig: {
          Name: `OAC-${options.bucketName}-${Date.now()}`,
          Description: `OAC for ${options.bucketName}`,
          SigningProtocol: 'sigv4',
          SigningBehavior: 'always',
          OriginAccessControlOriginType: 's3',
        },
      });

      const oacResponse = await client.send(oacCommand);
      const oacId = oacResponse.OriginAccessControl?.Id;

      // Create the distribution
      const callerReference = `${options.bucketName}-${Date.now()}`;
      const s3DomainName = `${options.bucketName}.s3.${bucketRegion}.amazonaws.com`;

      const command = new CreateDistributionCommand({
        DistributionConfig: {
          CallerReference: callerReference,
          Comment: options.comment || `Distribution for ${options.bucketName}`,
          DefaultRootObject: options.defaultRootObject || 'index.html',
          Enabled: true,
          Origins: {
            Quantity: 1,
            Items: [
              {
                Id: `S3-${options.bucketName}`,
                DomainName: s3DomainName,
                OriginAccessControlId: oacId,
                S3OriginConfig: {
                  OriginAccessIdentity: '',
                },
              },
            ],
          },
          DefaultCacheBehavior: {
            TargetOriginId: `S3-${options.bucketName}`,
            ViewerProtocolPolicy: options.viewerProtocolPolicy || 'redirect-to-https',
            AllowedMethods: {
              Quantity: 2,
              Items: ['GET', 'HEAD'],
              CachedMethods: {
                Quantity: 2,
                Items: ['GET', 'HEAD'],
              },
            },
            Compress: options.compress ?? true,
            CachePolicyId: options.cachePolicyId || '658327ea-f89d-4fab-a63d-7e88639e58f6', // CachingOptimized
            OriginRequestPolicyId: options.originRequestPolicyId,
            ForwardedValues: undefined,
          },
          Aliases: options.aliases
            ? {
                Quantity: options.aliases.length,
                Items: options.aliases,
              }
            : { Quantity: 0, Items: [] },
          ViewerCertificate: options.acmCertificateArn
            ? {
                ACMCertificateArn: options.acmCertificateArn,
                SSLSupportMethod: 'sni-only',
                MinimumProtocolVersion: 'TLSv1.2_2021',
              }
            : {
                CloudFrontDefaultCertificate: true,
              },
          PriceClass: options.priceClass || 'PriceClass_All',
          HttpVersion: options.httpVersion || 'http2and3',
          IsIPV6Enabled: true,
          Restrictions: {
            GeoRestriction: {
              RestrictionType: 'none',
              Quantity: 0,
            },
          },
        },
      });

      const response = await client.send(command);

      return {
        success: true,
        message: `CloudFront distribution created for '${options.bucketName}'`,
        data: {
          distributionId: response.Distribution?.Id,
          domainName: response.Distribution?.DomainName,
          arn: response.Distribution?.ARN,
          originAccessControlId: oacId,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create CloudFront distribution`,
        error: message,
      };
    }
  }

  /**
   * Delete CloudFront distribution (must be disabled first)
   */
  async deleteCloudFrontDistribution(
    distributionId: string,
    etag: string,
    region?: string
  ): Promise<S3OperationResult> {
    const client = this.getCloudFrontClient(region);

    try {
      await client.send(
        new DeleteDistributionCommand({
          Id: distributionId,
          IfMatch: etag,
        })
      );

      return {
        success: true,
        message: `CloudFront distribution '${distributionId}' deleted`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete distribution`,
        error: message,
      };
    }
  }

  /**
   * List Origin Access Controls
   */
  async listOriginAccessControls(region?: string): Promise<CloudFrontOriginAccessControl[]> {
    const client = this.getCloudFrontClient(region);

    const command = new ListOriginAccessControlsCommand({});
    const response = await client.send(command);

    return (response.OriginAccessControlList?.Items || []).map((oac) =>
      this.mapOriginAccessControl(oac)
    );
  }

  /**
   * Get Origin Access Control
   */
  async getOriginAccessControl(
    id: string,
    region?: string
  ): Promise<CloudFrontOriginAccessControl | null> {
    const client = this.getCloudFrontClient(region);

    try {
      const command = new GetOriginAccessControlCommand({ Id: id });
      const response = await client.send(command);

      if (!response.OriginAccessControl) return null;

      return {
        id: response.OriginAccessControl.Id || '',
        name: response.OriginAccessControl.OriginAccessControlConfig?.Name || '',
        description: response.OriginAccessControl.OriginAccessControlConfig?.Description,
        signingProtocol: 'sigv4',
        signingBehavior:
          (response.OriginAccessControl.OriginAccessControlConfig
            ?.SigningBehavior as 'always' | 'never' | 'no-override') || 'always',
        originAccessControlOriginType:
          (response.OriginAccessControl.OriginAccessControlConfig
            ?.OriginAccessControlOriginType as 's3' | 'mediastore') || 's3',
      };
    } catch (error) {
      if ((error as Error).name === 'NoSuchOriginAccessControl') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete Origin Access Control
   */
  async deleteOriginAccessControl(
    id: string,
    etag: string,
    region?: string
  ): Promise<S3OperationResult> {
    const client = this.getCloudFrontClient(region);

    try {
      await client.send(new DeleteOriginAccessControlCommand({ Id: id, IfMatch: etag }));

      return {
        success: true,
        message: `Origin Access Control '${id}' deleted`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete OAC`,
        error: message,
      };
    }
  }

  // ==========================================================================
  // 7. S3 Cross-Region Replication
  // ==========================================================================

  /**
   * Get replication configuration
   */
  async getReplicationConfiguration(
    bucketName: string,
    region?: string
  ): Promise<S3ReplicationConfiguration | null> {
    const client = this.getS3Client(region);

    try {
      const command = new GetBucketReplicationCommand({ Bucket: bucketName });
      const response = await client.send(command);

      return {
        role: response.ReplicationConfiguration?.Role || '',
        rules: (response.ReplicationConfiguration?.Rules || []).map((r) =>
          this.mapReplicationRule(r)
        ),
      };
    } catch (error) {
      if ((error as Error).name === 'ReplicationConfigurationNotFoundError') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Set replication configuration
   */
  async setReplicationConfiguration(options: S3SetReplicationOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const command = new PutBucketReplicationCommand({
        Bucket: options.bucketName,
        ReplicationConfiguration: {
          Role: options.role,
          Rules: options.rules.map((rule) => ({
            ID: rule.id,
            Priority: rule.priority,
            Status: rule.status,
            Filter: rule.filter
              ? {
                  Prefix: rule.filter.prefix,
                  Tag: rule.filter.tag
                    ? { Key: rule.filter.tag.key, Value: rule.filter.tag.value }
                    : undefined,
                  And: rule.filter.and
                    ? {
                        Prefix: rule.filter.and.prefix,
                        Tags: rule.filter.and.tags?.map((t) => ({
                          Key: t.key,
                          Value: t.value,
                        })),
                      }
                    : undefined,
                }
              : undefined,
            Prefix: rule.prefix,
            Destination: {
              Bucket: rule.destination.bucket,
              Account: rule.destination.account,
              StorageClass: rule.destination.storageClass,
              AccessControlTranslation: rule.destination.accessControlTranslation
                ? { Owner: 'Destination' }
                : undefined,
              EncryptionConfiguration: rule.destination.encryptionConfiguration
                ? { ReplicaKmsKeyID: rule.destination.encryptionConfiguration.replicaKmsKeyId }
                : undefined,
              ReplicationTime: rule.destination.replicationTime
                ? {
                    Status: rule.destination.replicationTime.status,
                    Time: { Minutes: rule.destination.replicationTime.time.minutes },
                  }
                : undefined,
              Metrics: rule.destination.metrics
                ? {
                    Status: rule.destination.metrics.status,
                    EventThreshold: rule.destination.metrics.eventThreshold
                      ? { Minutes: rule.destination.metrics.eventThreshold.minutes }
                      : undefined,
                  }
                : undefined,
            },
            DeleteMarkerReplication: rule.deleteMarkerReplication
              ? { Status: rule.deleteMarkerReplication.status }
              : undefined,
            SourceSelectionCriteria: rule.sourceSelectionCriteria
              ? {
                  SseKmsEncryptedObjects: rule.sourceSelectionCriteria.sseKmsEncryptedObjects
                    ? { Status: rule.sourceSelectionCriteria.sseKmsEncryptedObjects.status }
                    : undefined,
                  ReplicaModifications: rule.sourceSelectionCriteria.replicaModifications
                    ? { Status: rule.sourceSelectionCriteria.replicaModifications.status }
                    : undefined,
                }
              : undefined,
            ExistingObjectReplication: rule.existingObjectReplication
              ? { Status: rule.existingObjectReplication.status }
              : undefined,
          })),
        },
      });

      await client.send(command);

      return {
        success: true,
        message: `Replication configured for '${options.bucketName}'`,
        data: { rulesCount: options.rules.length },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set replication configuration`,
        error: message,
      };
    }
  }

  /**
   * Delete replication configuration
   */
  async deleteReplicationConfiguration(
    bucketName: string,
    region?: string
  ): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      await client.send(new DeleteBucketReplicationCommand({ Bucket: bucketName }));

      return {
        success: true,
        message: `Replication configuration deleted from '${bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete replication configuration`,
        error: message,
      };
    }
  }

  // ==========================================================================
  // 8. S3 Event Notification Configuration
  // ==========================================================================

  /**
   * Get notification configuration
   */
  async getNotificationConfiguration(
    bucketName: string,
    region?: string
  ): Promise<S3NotificationConfiguration> {
    const client = this.getS3Client(region);

    const command = new GetBucketNotificationConfigurationCommand({ Bucket: bucketName });
    const response = await client.send(command);

    return {
      topicConfigurations: response.TopicConfigurations?.map((c) =>
        this.mapTopicConfiguration(c)
      ),
      queueConfigurations: response.QueueConfigurations?.map((c) =>
        this.mapQueueConfiguration(c)
      ),
      lambdaFunctionConfigurations: response.LambdaFunctionConfigurations?.map((c) =>
        this.mapLambdaConfiguration(c)
      ),
      eventBridgeConfiguration: response.EventBridgeConfiguration
        ? { eventBridgeEnabled: true }
        : undefined,
    };
  }

  /**
   * Set notification configuration
   */
  async setNotificationConfiguration(
    options: S3SetNotificationOptions
  ): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const command = new PutBucketNotificationConfigurationCommand({
        Bucket: options.bucketName,
        NotificationConfiguration: {
          TopicConfigurations: options.topicConfigurations?.map((c) => ({
            Id: c.id,
            TopicArn: c.topicArn,
            Events: c.events as S3Event[],
            Filter: c.filter?.key
              ? {
                  Key: {
                    FilterRules: c.filter.key.filterRules.map((r) => ({
                      Name: r.name,
                      Value: r.value,
                    })),
                  },
                }
              : undefined,
          })),
          QueueConfigurations: options.queueConfigurations?.map((c) => ({
            Id: c.id,
            QueueArn: c.queueArn,
            Events: c.events as S3Event[],
            Filter: c.filter?.key
              ? {
                  Key: {
                    FilterRules: c.filter.key.filterRules.map((r) => ({
                      Name: r.name,
                      Value: r.value,
                    })),
                  },
                }
              : undefined,
          })),
          LambdaFunctionConfigurations: options.lambdaFunctionConfigurations?.map((c) => ({
            Id: c.id,
            LambdaFunctionArn: c.lambdaFunctionArn,
            Events: c.events as S3Event[],
            Filter: c.filter?.key
              ? {
                  Key: {
                    FilterRules: c.filter.key.filterRules.map((r) => ({
                      Name: r.name,
                      Value: r.value,
                    })),
                  },
                }
              : undefined,
          })),
          EventBridgeConfiguration: options.eventBridgeEnabled ? {} : undefined,
        },
      });

      await client.send(command);

      const configCount =
        (options.topicConfigurations?.length || 0) +
        (options.queueConfigurations?.length || 0) +
        (options.lambdaFunctionConfigurations?.length || 0);

      return {
        success: true,
        message: `Notification configuration set for '${options.bucketName}'`,
        data: { configurationsCount: configCount },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set notification configuration`,
        error: message,
      };
    }
  }

  /**
   * Clear notification configuration
   */
  async clearNotificationConfiguration(
    bucketName: string,
    region?: string
  ): Promise<S3OperationResult> {
    return this.setNotificationConfiguration({
      bucketName,
      region,
    });
  }

  // ==========================================================================
  // Additional Operations
  // ==========================================================================

  /**
   * Get bucket logging
   */
  async getLogging(bucketName: string, region?: string): Promise<S3BucketLogging | null> {
    const client = this.getS3Client(region);

    const command = new GetBucketLoggingCommand({ Bucket: bucketName });
    const response = await client.send(command);

    if (!response.LoggingEnabled) {
      return null;
    }

    return {
      targetBucket: response.LoggingEnabled.TargetBucket,
      targetPrefix: response.LoggingEnabled.TargetPrefix,
      targetGrants: response.LoggingEnabled.TargetGrants?.map((g) => ({
        grantee: {
          type: g.Grantee?.Type as 'CanonicalUser' | 'AmazonCustomerByEmail' | 'Group',
          id: g.Grantee?.ID,
          emailAddress: g.Grantee?.EmailAddress,
          uri: g.Grantee?.URI,
          displayName: g.Grantee?.DisplayName,
        },
        permission: g.Permission as 'FULL_CONTROL' | 'READ' | 'WRITE',
      })),
    };
  }

  /**
   * Set bucket logging
   */
  async setLogging(options: S3SetLoggingOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const command = new PutBucketLoggingCommand({
        Bucket: options.bucketName,
        BucketLoggingStatus: {
          LoggingEnabled: {
            TargetBucket: options.targetBucket,
            TargetPrefix: options.targetPrefix || '',
          },
        },
      });

      await client.send(command);

      return {
        success: true,
        message: `Logging enabled for '${options.bucketName}' to '${options.targetBucket}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set logging`,
        error: message,
      };
    }
  }

  /**
   * Get bucket tags
   */
  async getBucketTags(bucketName: string, region?: string): Promise<Record<string, string>> {
    const client = this.getS3Client(region);

    try {
      const command = new GetBucketTaggingCommand({ Bucket: bucketName });
      const response = await client.send(command);

      const tags: Record<string, string> = {};
      for (const tag of response.TagSet || []) {
        if (tag.Key) {
          tags[tag.Key] = tag.Value || '';
        }
      }
      return tags;
    } catch (error) {
      if ((error as Error).name === 'NoSuchTagSet') {
        return {};
      }
      throw error;
    }
  }

  /**
   * Set bucket tags
   */
  async setBucketTags(
    bucketName: string,
    tags: Record<string, string>,
    region?: string
  ): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      const command = new PutBucketTaggingCommand({
        Bucket: bucketName,
        Tagging: {
          TagSet: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
        },
      });

      await client.send(command);

      return {
        success: true,
        message: `Tags set for '${bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set tags`,
        error: message,
      };
    }
  }

  /**
   * Delete bucket tags
   */
  async deleteBucketTags(bucketName: string, region?: string): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      await client.send(new DeleteBucketTaggingCommand({ Bucket: bucketName }));

      return {
        success: true,
        message: `Tags deleted from '${bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete tags`,
        error: message,
      };
    }
  }

  /**
   * Get object tags
   */
  async getObjectTags(
    bucketName: string,
    key: string,
    versionId?: string,
    region?: string
  ): Promise<Record<string, string>> {
    const client = this.getS3Client(region);

    const command = new GetObjectTaggingCommand({
      Bucket: bucketName,
      Key: key,
      VersionId: versionId,
    });

    const response = await client.send(command);

    const tags: Record<string, string> = {};
    for (const tag of response.TagSet || []) {
      if (tag.Key) {
        tags[tag.Key] = tag.Value || '';
      }
    }
    return tags;
  }

  /**
   * Set object tags
   */
  async setObjectTags(
    bucketName: string,
    key: string,
    tags: Record<string, string>,
    versionId?: string,
    region?: string
  ): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      const command = new PutObjectTaggingCommand({
        Bucket: bucketName,
        Key: key,
        VersionId: versionId,
        Tagging: {
          TagSet: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
        },
      });

      await client.send(command);

      return {
        success: true,
        message: `Tags set for '${key}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set object tags`,
        error: message,
      };
    }
  }

  /**
   * Delete object tags
   */
  async deleteObjectTags(
    bucketName: string,
    key: string,
    versionId?: string,
    region?: string
  ): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      await client.send(
        new DeleteObjectTaggingCommand({
          Bucket: bucketName,
          Key: key,
          VersionId: versionId,
        })
      );

      return {
        success: true,
        message: `Tags deleted from '${key}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete object tags`,
        error: message,
      };
    }
  }

  /**
   * Get bucket policy
   */
  async getBucketPolicy(bucketName: string, region?: string): Promise<string | null> {
    const client = this.getS3Client(region);

    try {
      const command = new GetBucketPolicyCommand({ Bucket: bucketName });
      const response = await client.send(command);

      return response.Policy || null;
    } catch (error) {
      if ((error as Error).name === 'NoSuchBucketPolicy') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Set bucket policy
   */
  async setBucketPolicy(
    bucketName: string,
    policy: string,
    region?: string
  ): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      const command = new PutBucketPolicyCommand({
        Bucket: bucketName,
        Policy: policy,
      });

      await client.send(command);

      return {
        success: true,
        message: `Policy set for '${bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set bucket policy`,
        error: message,
      };
    }
  }

  /**
   * Delete bucket policy
   */
  async deleteBucketPolicy(bucketName: string, region?: string): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      await client.send(new DeleteBucketPolicyCommand({ Bucket: bucketName }));

      return {
        success: true,
        message: `Policy deleted from '${bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete bucket policy`,
        error: message,
      };
    }
  }

  /**
   * Get object ACL
   */
  async getObjectAcl(
    bucketName: string,
    key: string,
    versionId?: string,
    region?: string
  ): Promise<{ owner?: { displayName?: string; id?: string }; grants: Array<{ grantee: { type: string; id?: string; uri?: string }; permission: string }> }> {
    const client = this.getS3Client(region);

    const command = new GetObjectAclCommand({
      Bucket: bucketName,
      Key: key,
      VersionId: versionId,
    });

    const response = await client.send(command);

    return {
      owner: this.mapOwner(response.Owner),
      grants: (response.Grants || []).map((g) => ({
        grantee: {
          type: g.Grantee?.Type || '',
          id: g.Grantee?.ID,
          uri: g.Grantee?.URI,
        },
        permission: g.Permission || '',
      })),
    };
  }

  /**
   * Set object ACL
   */
  async setObjectAcl(
    bucketName: string,
    key: string,
    acl: S3ObjectAcl,
    versionId?: string,
    region?: string
  ): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      const command = new PutObjectAclCommand({
        Bucket: bucketName,
        Key: key,
        ACL: acl,
        VersionId: versionId,
      });

      await client.send(command);

      return {
        success: true,
        message: `ACL set for '${key}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set object ACL`,
        error: message,
      };
    }
  }

  /**
   * List multipart uploads
   */
  async listMultipartUploads(options: S3ListMultipartUploadsOptions): Promise<{
    uploads: S3MultipartUpload[];
    isTruncated?: boolean;
    nextKeyMarker?: string;
    nextUploadIdMarker?: string;
  }> {
    const client = this.getS3Client(options.region);

    const command = new ListMultipartUploadsCommand({
      Bucket: options.bucketName,
      Prefix: options.prefix,
      Delimiter: options.delimiter,
      MaxUploads: options.maxUploads,
      KeyMarker: options.keyMarker,
      UploadIdMarker: options.uploadIdMarker,
    });

    const response = await client.send(command);

    return {
      uploads: (response.Uploads || []).map((u) => this.mapMultipartUpload(u)),
      isTruncated: response.IsTruncated,
      nextKeyMarker: response.NextKeyMarker,
      nextUploadIdMarker: response.NextUploadIdMarker,
    };
  }

  /**
   * Abort multipart upload
   */
  async abortMultipartUpload(options: S3AbortMultipartUploadOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: options.bucketName,
          Key: options.key,
          UploadId: options.uploadId,
        })
      );

      return {
        success: true,
        message: `Multipart upload aborted for '${options.key}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to abort multipart upload`,
        error: message,
      };
    }
  }

  /**
   * Get accelerate configuration
   */
  async getAccelerateConfiguration(
    bucketName: string,
    region?: string
  ): Promise<'Enabled' | 'Suspended' | null> {
    const client = this.getS3Client(region);

    const command = new GetBucketAccelerateConfigurationCommand({ Bucket: bucketName });
    const response = await client.send(command);

    return (response.Status as 'Enabled' | 'Suspended') || null;
  }

  /**
   * Set accelerate configuration
   */
  async setAccelerateConfiguration(
    bucketName: string,
    status: 'Enabled' | 'Suspended',
    region?: string
  ): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      await client.send(
        new PutBucketAccelerateConfigurationCommand({
          Bucket: bucketName,
          AccelerateConfiguration: { Status: status },
        })
      );

      return {
        success: true,
        message: `Transfer Acceleration ${status.toLowerCase()} for '${bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set accelerate configuration`,
        error: message,
      };
    }
  }

  /**
   * Get request payment configuration
   */
  async getRequestPayment(
    bucketName: string,
    region?: string
  ): Promise<'BucketOwner' | 'Requester'> {
    const client = this.getS3Client(region);

    const command = new GetBucketRequestPaymentCommand({ Bucket: bucketName });
    const response = await client.send(command);

    return (response.Payer as 'BucketOwner' | 'Requester') || 'BucketOwner';
  }

  /**
   * Set request payment configuration
   */
  async setRequestPayment(
    bucketName: string,
    payer: 'BucketOwner' | 'Requester',
    region?: string
  ): Promise<S3OperationResult> {
    const client = this.getS3Client(region);

    try {
      await client.send(
        new PutBucketRequestPaymentCommand({
          Bucket: bucketName,
          RequestPaymentConfiguration: { Payer: payer },
        })
      );

      return {
        success: true,
        message: `Request payment set to '${payer}' for '${bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set request payment`,
        error: message,
      };
    }
  }

  /**
   * Get object lock configuration
   */
  async getObjectLockConfiguration(
    bucketName: string,
    region?: string
  ): Promise<{ enabled: boolean; mode?: 'GOVERNANCE' | 'COMPLIANCE'; days?: number; years?: number } | null> {
    const client = this.getS3Client(region);

    try {
      const command = new GetObjectLockConfigurationCommand({ Bucket: bucketName });
      const response = await client.send(command);

      if (!response.ObjectLockConfiguration) return null;

      return {
        enabled: response.ObjectLockConfiguration.ObjectLockEnabled === 'Enabled',
        mode: response.ObjectLockConfiguration.Rule?.DefaultRetention
          ?.Mode as 'GOVERNANCE' | 'COMPLIANCE' | undefined,
        days: response.ObjectLockConfiguration.Rule?.DefaultRetention?.Days,
        years: response.ObjectLockConfiguration.Rule?.DefaultRetention?.Years,
      };
    } catch (error) {
      if ((error as Error).name === 'ObjectLockConfigurationNotFoundError') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Set object lock configuration
   */
  async setObjectLockConfiguration(options: S3SetObjectLockOptions): Promise<S3OperationResult> {
    const client = this.getS3Client(options.region);

    try {
      const command = new PutObjectLockConfigurationCommand({
        Bucket: options.bucketName,
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule:
            options.mode || options.days || options.years
              ? {
                  DefaultRetention: {
                    Mode: options.mode,
                    Days: options.days,
                    Years: options.years,
                  },
                }
              : undefined,
        },
      });

      await client.send(command);

      return {
        success: true,
        message: `Object lock configured for '${options.bucketName}'`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to set object lock configuration`,
        error: message,
      };
    }
  }

  /**
   * Empty a bucket (delete all objects)
   */
  async emptyBucket(bucketName: string, region?: string): Promise<S3OperationResult> {
    try {
      let totalDeleted = 0;

      // Delete all object versions
      let versionKeyMarker: string | undefined;
      let versionIdMarker: string | undefined;

      do {
        const versions = await this.listObjectVersions({
          bucketName,
          keyMarker: versionKeyMarker,
          versionIdMarker,
          region,
        });

        const objectsToDelete = [
          ...versions.versions.map((v) => ({ key: v.key, versionId: v.versionId })),
          ...versions.deleteMarkers.map((m) => ({ key: m.key, versionId: m.versionId })),
        ];

        if (objectsToDelete.length > 0) {
          await this.deleteObjects({
            bucketName,
            objects: objectsToDelete,
            region,
          });
          totalDeleted += objectsToDelete.length;
        }

        versionKeyMarker = versions.nextKeyMarker;
        versionIdMarker = versions.nextVersionIdMarker;
      } while (versionKeyMarker);

      return {
        success: true,
        message: `Bucket '${bucketName}' emptied (${totalDeleted} objects deleted)`,
        data: { deletedCount: totalDeleted },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to empty bucket`,
        error: message,
      };
    }
  }
}

// Export singleton factory
export function createS3Manager(config?: S3ClientConfig): S3Manager {
  return new S3Manager(config);
}
