/**
 * AWS S3 Manager Tests
 * Comprehensive test suite for S3 operations
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { S3Manager, createS3Manager } from './manager.js';

// Mock AWS SDK S3 Client
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  CreateBucketCommand: vi.fn(),
  DeleteBucketCommand: vi.fn(),
  HeadBucketCommand: vi.fn(),
  ListBucketsCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  DeleteObjectsCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
  CopyObjectCommand: vi.fn(),
  ListObjectsV2Command: vi.fn(),
  ListObjectVersionsCommand: vi.fn(),
  GetBucketVersioningCommand: vi.fn(),
  PutBucketVersioningCommand: vi.fn(),
  GetBucketEncryptionCommand: vi.fn(),
  PutBucketEncryptionCommand: vi.fn(),
  DeleteBucketEncryptionCommand: vi.fn(),
  GetPublicAccessBlockCommand: vi.fn(),
  PutPublicAccessBlockCommand: vi.fn(),
  DeletePublicAccessBlockCommand: vi.fn(),
  GetBucketLifecycleConfigurationCommand: vi.fn(),
  PutBucketLifecycleConfigurationCommand: vi.fn(),
  DeleteBucketLifecycleCommand: vi.fn(),
  GetBucketWebsiteCommand: vi.fn(),
  PutBucketWebsiteCommand: vi.fn(),
  DeleteBucketWebsiteCommand: vi.fn(),
  GetBucketCorsCommand: vi.fn(),
  PutBucketCorsCommand: vi.fn(),
  DeleteBucketCorsCommand: vi.fn(),
  GetBucketLoggingCommand: vi.fn(),
  PutBucketLoggingCommand: vi.fn(),
  GetBucketReplicationCommand: vi.fn(),
  PutBucketReplicationCommand: vi.fn(),
  DeleteBucketReplicationCommand: vi.fn(),
  GetBucketNotificationConfigurationCommand: vi.fn(),
  PutBucketNotificationConfigurationCommand: vi.fn(),
  GetBucketTaggingCommand: vi.fn(),
  PutBucketTaggingCommand: vi.fn(),
  DeleteBucketTaggingCommand: vi.fn(),
  GetBucketLocationCommand: vi.fn(),
  GetBucketAccelerateConfigurationCommand: vi.fn(),
  PutBucketAccelerateConfigurationCommand: vi.fn(),
  GetBucketRequestPaymentCommand: vi.fn(),
  PutBucketRequestPaymentCommand: vi.fn(),
  GetObjectLockConfigurationCommand: vi.fn(),
  PutObjectLockConfigurationCommand: vi.fn(),
  ListMultipartUploadsCommand: vi.fn(),
  AbortMultipartUploadCommand: vi.fn(),
  GetBucketPolicyCommand: vi.fn(),
  PutBucketPolicyCommand: vi.fn(),
  DeleteBucketPolicyCommand: vi.fn(),
  GetObjectTaggingCommand: vi.fn(),
  PutObjectTaggingCommand: vi.fn(),
  DeleteObjectTaggingCommand: vi.fn(),
  GetObjectAclCommand: vi.fn(),
  PutObjectAclCommand: vi.fn(),
}));

// Mock AWS SDK CloudFront Client
vi.mock('@aws-sdk/client-cloudfront', () => ({
  CloudFrontClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  CreateDistributionCommand: vi.fn(),
  GetDistributionCommand: vi.fn(),
  DeleteDistributionCommand: vi.fn(),
  ListDistributionsCommand: vi.fn(),
  CreateOriginAccessControlCommand: vi.fn(),
  GetOriginAccessControlCommand: vi.fn(),
  DeleteOriginAccessControlCommand: vi.fn(),
  ListOriginAccessControlsCommand: vi.fn(),
}));

// Mock presigner
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://presigned-url.example.com'),
}));

import { S3Client } from '@aws-sdk/client-s3';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

describe('S3Manager', () => {
  let manager: S3Manager;
  let mockS3Send: Mock;
  let mockCloudFrontSend: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock send functions
    mockS3Send = vi.fn();
    mockCloudFrontSend = vi.fn();

    (S3Client as Mock).mockImplementation(() => ({
      send: mockS3Send,
    }));

    (CloudFrontClient as Mock).mockImplementation(() => ({
      send: mockCloudFrontSend,
    }));

    manager = new S3Manager({ region: 'us-east-1' });
  });

  // ==========================================================================
  // 1. S3 Bucket Creation and Configuration Tests
  // ==========================================================================

  describe('Bucket Operations', () => {
    it('should list all buckets', async () => {
      mockS3Send.mockResolvedValue({
        Buckets: [
          { Name: 'bucket-1', CreationDate: new Date('2024-01-01') },
          { Name: 'bucket-2', CreationDate: new Date('2024-01-02') },
        ],
      });

      const buckets = await manager.listBuckets();

      expect(buckets).toHaveLength(2);
      expect(buckets[0].name).toBe('bucket-1');
      expect(buckets[1].name).toBe('bucket-2');
    });

    it('should check if bucket exists', async () => {
      mockS3Send.mockResolvedValue({});

      const exists = await manager.bucketExists('my-bucket');

      expect(exists).toBe(true);
    });

    it('should return false for non-existent bucket', async () => {
      mockS3Send.mockRejectedValue(new Error('NotFound'));

      const exists = await manager.bucketExists('non-existent-bucket');

      expect(exists).toBe(false);
    });

    it('should get bucket location', async () => {
      mockS3Send.mockResolvedValue({ LocationConstraint: 'us-west-2' });

      const location = await manager.getBucketLocation('my-bucket');

      expect(location).toBe('us-west-2');
    });

    it('should return us-east-1 for empty location', async () => {
      mockS3Send.mockResolvedValue({ LocationConstraint: null });

      const location = await manager.getBucketLocation('my-bucket');

      expect(location).toBe('us-east-1');
    });

    it('should create a bucket', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.createBucket({
        bucketName: 'new-bucket',
        region: 'us-west-2',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('new-bucket');
    });

    it('should handle bucket creation failure', async () => {
      mockS3Send.mockRejectedValue(new Error('BucketAlreadyExists'));

      const result = await manager.createBucket({ bucketName: 'existing-bucket' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('BucketAlreadyExists');
    });

    it('should delete a bucket', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.deleteBucket('my-bucket');

      expect(result.success).toBe(true);
    });

    it('should get bucket details', async () => {
      // Mock multiple calls for bucket details
      mockS3Send
        .mockResolvedValueOnce({}) // HeadBucket
        .mockResolvedValueOnce({ LocationConstraint: 'us-east-1' }) // GetBucketLocation
        .mockResolvedValueOnce({ Status: 'Enabled' }) // GetBucketVersioning
        .mockResolvedValueOnce({ // GetBucketEncryption
          ServerSideEncryptionConfiguration: {
            Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
          },
        })
        .mockResolvedValueOnce({ // GetPublicAccessBlock
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
          },
        })
        .mockResolvedValueOnce({ LoggingEnabled: null }) // GetBucketLogging
        .mockRejectedValueOnce({ name: 'NoSuchWebsiteConfiguration' }) // GetBucketWebsite
        .mockRejectedValueOnce({ name: 'NoSuchCORSConfiguration' }) // GetBucketCors
        .mockRejectedValueOnce({ name: 'NoSuchLifecycleConfiguration' }) // GetBucketLifecycle
        .mockResolvedValueOnce({ TagSet: [{ Key: 'env', Value: 'prod' }] }); // GetBucketTagging

      const details = await manager.getBucketDetails('my-bucket');

      expect(details).not.toBeNull();
      expect(details?.name).toBe('my-bucket');
      expect(details?.versioning).toBe('Enabled');
    });

    it('should return null for non-existent bucket details', async () => {
      const error = new Error('NoSuchBucket');
      (error as Error & { name: string }).name = 'NoSuchBucket';
      mockS3Send.mockRejectedValue(error);

      const details = await manager.getBucketDetails('non-existent');

      expect(details).toBeNull();
    });
  });

  // ==========================================================================
  // 2. S3 Object Upload/Download Operations Tests
  // ==========================================================================

  describe('Object Operations', () => {
    it('should upload an object', async () => {
      mockS3Send.mockResolvedValue({
        ETag: '"abc123"',
        VersionId: 'v1',
      });

      const result = await manager.uploadObject({
        bucketName: 'my-bucket',
        key: 'test-file.txt',
        body: Buffer.from('Hello World'),
        contentType: 'text/plain',
      });

      expect(result.success).toBe(true);
      expect((result.data as { eTag?: string })?.eTag).toBe('"abc123"');
    });

    it('should handle upload failure', async () => {
      mockS3Send.mockRejectedValue(new Error('AccessDenied'));

      const result = await manager.uploadObject({
        bucketName: 'my-bucket',
        key: 'test.txt',
        body: 'content',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('AccessDenied');
    });

    it('should download an object', async () => {
      const mockBody = {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('Hello');
          yield Buffer.from(' World');
        },
      };

      mockS3Send.mockResolvedValue({
        Body: mockBody,
        ContentType: 'text/plain',
        ContentLength: 11,
        ETag: '"abc123"',
        LastModified: new Date('2024-01-01'),
      });

      const result = await manager.downloadObject({
        bucketName: 'my-bucket',
        key: 'test-file.txt',
      });

      expect(result.body.toString()).toBe('Hello World');
      expect(result.contentType).toBe('text/plain');
    });

    it('should get object metadata', async () => {
      mockS3Send.mockResolvedValue({
        ContentType: 'application/json',
        ContentLength: 1024,
        ETag: '"xyz789"',
        LastModified: new Date('2024-01-15'),
        StorageClass: 'STANDARD',
        VersionId: 'v2',
      });

      const metadata = await manager.getObjectMetadata('my-bucket', 'data.json');

      expect(metadata).not.toBeNull();
      expect(metadata?.contentType).toBe('application/json');
      expect(metadata?.size).toBe(1024);
    });

    it('should return null for non-existent object metadata', async () => {
      const error = new Error('NotFound');
      (error as Error & { name: string }).name = 'NotFound';
      mockS3Send.mockRejectedValue(error);

      const metadata = await manager.getObjectMetadata('my-bucket', 'missing.txt');

      expect(metadata).toBeNull();
    });

    it('should copy an object', async () => {
      mockS3Send.mockResolvedValue({
        CopyObjectResult: {
          ETag: '"copied"',
          LastModified: new Date(),
        },
        VersionId: 'v3',
      });

      const result = await manager.copyObject({
        sourceBucket: 'source-bucket',
        sourceKey: 'original.txt',
        destinationBucket: 'dest-bucket',
        destinationKey: 'copy.txt',
      });

      expect(result.success).toBe(true);
      expect((result.data as { eTag?: string })?.eTag).toBe('"copied"');
    });

    it('should delete an object', async () => {
      mockS3Send.mockResolvedValue({
        DeleteMarker: false,
        VersionId: 'v1',
      });

      const result = await manager.deleteObject({
        bucketName: 'my-bucket',
        key: 'to-delete.txt',
      });

      expect(result.success).toBe(true);
    });

    it('should delete multiple objects', async () => {
      mockS3Send.mockResolvedValue({
        Deleted: [
          { Key: 'file1.txt' },
          { Key: 'file2.txt' },
        ],
        Errors: [],
      });

      const result = await manager.deleteObjects({
        bucketName: 'my-bucket',
        objects: [{ key: 'file1.txt' }, { key: 'file2.txt' }],
      });

      expect(result.success).toBe(true);
      expect((result.data as { deleted?: unknown[] })?.deleted).toHaveLength(2);
    });

    it('should list objects', async () => {
      mockS3Send.mockResolvedValue({
        Contents: [
          { Key: 'file1.txt', Size: 100, LastModified: new Date() },
          { Key: 'file2.txt', Size: 200, LastModified: new Date() },
        ],
        IsTruncated: false,
        KeyCount: 2,
      });

      const result = await manager.listObjects({ bucketName: 'my-bucket' });

      expect(result.objects).toHaveLength(2);
      expect(result.objects[0].key).toBe('file1.txt');
    });

    it('should list objects with prefix', async () => {
      mockS3Send.mockResolvedValue({
        Contents: [{ Key: 'folder/file.txt', Size: 50 }],
        CommonPrefixes: [{ Prefix: 'folder/subfolder/' }],
        IsTruncated: false,
      });

      const result = await manager.listObjects({
        bucketName: 'my-bucket',
        prefix: 'folder/',
        delimiter: '/',
      });

      expect(result.objects).toHaveLength(1);
      expect(result.commonPrefixes).toContain('folder/subfolder/');
    });

    it('should list object versions', async () => {
      mockS3Send.mockResolvedValue({
        Versions: [
          { Key: 'file.txt', VersionId: 'v2', IsLatest: true, Size: 100 },
          { Key: 'file.txt', VersionId: 'v1', IsLatest: false, Size: 90 },
        ],
        DeleteMarkers: [
          { Key: 'deleted.txt', VersionId: 'v1', IsLatest: true },
        ],
        IsTruncated: false,
      });

      const result = await manager.listObjectVersions({ bucketName: 'my-bucket' });

      expect(result.versions).toHaveLength(2);
      expect(result.deleteMarkers).toHaveLength(1);
    });

    it('should generate presigned URL for download', async () => {
      const result = await manager.getPresignedUrl({
        bucketName: 'my-bucket',
        key: 'file.txt',
        operation: 'getObject',
        expiresIn: 3600,
      });

      expect(result.url).toBe('https://presigned-url.example.com');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(getSignedUrl).toHaveBeenCalled();
    });

    it('should generate presigned URL for upload', async () => {
      const result = await manager.getPresignedUrl({
        bucketName: 'my-bucket',
        key: 'new-file.txt',
        operation: 'putObject',
        contentType: 'text/plain',
      });

      expect(result.url).toBe('https://presigned-url.example.com');
    });
  });

  // ==========================================================================
  // 3. S3 Lifecycle Policy Management Tests
  // ==========================================================================

  describe('Lifecycle Configuration', () => {
    it('should get lifecycle configuration', async () => {
      mockS3Send.mockResolvedValue({
        Rules: [
          {
            ID: 'archive-rule',
            Status: 'Enabled',
            Filter: { Prefix: 'logs/' },
            Transitions: [{ Days: 30, StorageClass: 'GLACIER' }],
            Expiration: { Days: 365 },
          },
        ],
      });

      const config = await manager.getLifecycleConfiguration('my-bucket');

      expect(config).not.toBeNull();
      expect(config?.rules).toHaveLength(1);
      expect(config?.rules[0].id).toBe('archive-rule');
    });

    it('should return null when no lifecycle config', async () => {
      const error = new Error('NoSuchLifecycleConfiguration');
      (error as Error & { name: string }).name = 'NoSuchLifecycleConfiguration';
      mockS3Send.mockRejectedValue(error);

      const config = await manager.getLifecycleConfiguration('my-bucket');

      expect(config).toBeNull();
    });

    it('should set lifecycle configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setLifecycleConfiguration({
        bucketName: 'my-bucket',
        rules: [
          {
            id: 'transition-rule',
            status: 'Enabled',
            filter: { prefix: 'archive/' },
            transitions: [{ days: 90, storageClass: 'GLACIER' }],
          },
        ],
      });

      expect(result.success).toBe(true);
      expect((result.data as { rulesCount?: number })?.rulesCount).toBe(1);
    });

    it('should delete lifecycle configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.deleteLifecycleConfiguration('my-bucket');

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // 4. S3 Versioning and Encryption Tests
  // ==========================================================================

  describe('Versioning', () => {
    it('should get versioning status - enabled', async () => {
      mockS3Send.mockResolvedValue({ Status: 'Enabled' });

      const status = await manager.getVersioning('my-bucket');

      expect(status).toBe('Enabled');
    });

    it('should get versioning status - disabled', async () => {
      mockS3Send.mockResolvedValue({ Status: null });

      const status = await manager.getVersioning('my-bucket');

      expect(status).toBe('Disabled');
    });

    it('should enable versioning', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setVersioning({
        bucketName: 'my-bucket',
        status: 'Enabled',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('enabled');
    });

    it('should suspend versioning', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setVersioning({
        bucketName: 'my-bucket',
        status: 'Suspended',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('suspended');
    });
  });

  describe('Encryption', () => {
    it('should get encryption configuration', async () => {
      mockS3Send.mockResolvedValue({
        ServerSideEncryptionConfiguration: {
          Rules: [
            {
              ApplyServerSideEncryptionByDefault: {
                SSEAlgorithm: 'aws:kms',
                KMSMasterKeyID: 'key-id-123',
              },
              BucketKeyEnabled: true,
            },
          ],
        },
      });

      const encryption = await manager.getEncryption('my-bucket');

      expect(encryption).not.toBeNull();
      expect(encryption?.rules[0].applyServerSideEncryptionByDefault?.sseAlgorithm).toBe('aws:kms');
    });

    it('should return null when no encryption config', async () => {
      const error = new Error('ServerSideEncryptionConfigurationNotFoundError');
      (error as Error & { name: string }).name = 'ServerSideEncryptionConfigurationNotFoundError';
      mockS3Send.mockRejectedValue(error);

      const encryption = await manager.getEncryption('my-bucket');

      expect(encryption).toBeNull();
    });

    it('should set encryption configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setEncryption({
        bucketName: 'my-bucket',
        sseAlgorithm: 'AES256',
      });

      expect(result.success).toBe(true);
    });

    it('should set KMS encryption', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setEncryption({
        bucketName: 'my-bucket',
        sseAlgorithm: 'aws:kms',
        kmsMasterKeyId: 'arn:aws:kms:us-east-1:123456789:key/abc',
        bucketKeyEnabled: true,
      });

      expect(result.success).toBe(true);
    });

    it('should delete encryption configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.deleteEncryption('my-bucket');

      expect(result.success).toBe(true);
    });
  });

  describe('Public Access Block', () => {
    it('should get public access block', async () => {
      mockS3Send.mockResolvedValue({
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      });

      const config = await manager.getPublicAccessBlock('my-bucket');

      expect(config).not.toBeNull();
      expect(config?.blockPublicAcls).toBe(true);
      expect(config?.blockPublicPolicy).toBe(true);
    });

    it('should set public access block', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setPublicAccessBlock({
        bucketName: 'my-bucket',
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: true,
        restrictPublicBuckets: true,
      });

      expect(result.success).toBe(true);
    });

    it('should delete public access block', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.deletePublicAccessBlock('my-bucket');

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // 5. S3 Static Website Hosting Tests
  // ==========================================================================

  describe('Website Configuration', () => {
    it('should get website configuration', async () => {
      mockS3Send.mockResolvedValue({
        IndexDocument: { Suffix: 'index.html' },
        ErrorDocument: { Key: 'error.html' },
        RoutingRules: [
          {
            Condition: { HttpErrorCodeReturnedEquals: '404' },
            Redirect: { ReplaceKeyWith: 'not-found.html' },
          },
        ],
      });

      const config = await manager.getWebsiteConfiguration('my-bucket');

      expect(config).not.toBeNull();
      expect(config?.indexDocument?.suffix).toBe('index.html');
      expect(config?.errorDocument?.key).toBe('error.html');
    });

    it('should return null when no website config', async () => {
      const error = new Error('NoSuchWebsiteConfiguration');
      (error as Error & { name: string }).name = 'NoSuchWebsiteConfiguration';
      mockS3Send.mockRejectedValue(error);

      const config = await manager.getWebsiteConfiguration('my-bucket');

      expect(config).toBeNull();
    });

    it('should set website configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setWebsiteConfiguration({
        bucketName: 'my-bucket',
        indexDocument: 'index.html',
        errorDocument: '404.html',
      });

      expect(result.success).toBe(true);
      expect((result.data as { websiteUrl?: string })?.websiteUrl).toContain('my-bucket');
    });

    it('should delete website configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.deleteWebsiteConfiguration('my-bucket');

      expect(result.success).toBe(true);
    });
  });

  describe('CORS Configuration', () => {
    it('should get CORS configuration', async () => {
      mockS3Send.mockResolvedValue({
        CORSRules: [
          {
            ID: 'rule1',
            AllowedOrigins: ['https://example.com'],
            AllowedMethods: ['GET', 'PUT'],
            AllowedHeaders: ['*'],
            MaxAgeSeconds: 3600,
          },
        ],
      });

      const config = await manager.getCors('my-bucket');

      expect(config).not.toBeNull();
      expect(config?.corsRules).toHaveLength(1);
      expect(config?.corsRules[0].allowedOrigins).toContain('https://example.com');
    });

    it('should set CORS configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setCors({
        bucketName: 'my-bucket',
        corsRules: [
          {
            allowedOrigins: ['*'],
            allowedMethods: ['GET', 'HEAD'],
            maxAgeSeconds: 3000,
          },
        ],
      });

      expect(result.success).toBe(true);
    });

    it('should delete CORS configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.deleteCors('my-bucket');

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // 6. S3 CloudFront Integration Tests
  // ==========================================================================

  describe('CloudFront Integration', () => {
    it('should list CloudFront distributions', async () => {
      mockCloudFrontSend.mockResolvedValue({
        DistributionList: {
          Items: [
            {
              Id: 'dist-1',
              ARN: 'arn:aws:cloudfront::123:distribution/dist-1',
              DomainName: 'abc123.cloudfront.net',
              Status: 'Deployed',
              Enabled: true,
            },
          ],
        },
      });

      const distributions = await manager.listCloudFrontDistributions();

      expect(distributions).toHaveLength(1);
      expect(distributions[0].id).toBe('dist-1');
      expect(distributions[0].domainName).toBe('abc123.cloudfront.net');
    });

    it('should get CloudFront distribution', async () => {
      mockCloudFrontSend.mockResolvedValue({
        Distribution: {
          Id: 'dist-123',
          ARN: 'arn:aws:cloudfront::123:distribution/dist-123',
          DomainName: 'xyz.cloudfront.net',
          Status: 'Deployed',
          DistributionConfig: {
            Enabled: true,
            Comment: 'My distribution',
            PriceClass: 'PriceClass_All',
          },
        },
      });

      const dist = await manager.getCloudFrontDistribution('dist-123');

      expect(dist).not.toBeNull();
      expect(dist?.id).toBe('dist-123');
      expect(dist?.enabled).toBe(true);
    });

    it('should return null for non-existent distribution', async () => {
      const error = new Error('NoSuchDistribution');
      (error as Error & { name: string }).name = 'NoSuchDistribution';
      mockCloudFrontSend.mockRejectedValue(error);

      const dist = await manager.getCloudFrontDistribution('non-existent');

      expect(dist).toBeNull();
    });

    it('should create CloudFront distribution for S3', async () => {
      mockCloudFrontSend
        .mockResolvedValueOnce({
          OriginAccessControl: { Id: 'oac-123' },
        })
        .mockResolvedValueOnce({
          Distribution: {
            Id: 'new-dist',
            DomainName: 'new.cloudfront.net',
            ARN: 'arn:aws:cloudfront::123:distribution/new-dist',
          },
        });

      const result = await manager.createCloudFrontDistribution({
        bucketName: 'my-website-bucket',
        comment: 'Website distribution',
      });

      expect(result.success).toBe(true);
      expect((result.data as { distributionId?: string })?.distributionId).toBe('new-dist');
      expect((result.data as { originAccessControlId?: string })?.originAccessControlId).toBe('oac-123');
    });

    it('should list Origin Access Controls', async () => {
      mockCloudFrontSend.mockResolvedValue({
        OriginAccessControlList: {
          Items: [
            {
              Id: 'oac-1',
              Name: 'OAC-mybucket',
              SigningBehavior: 'always',
              OriginAccessControlOriginType: 's3',
            },
          ],
        },
      });

      const oacs = await manager.listOriginAccessControls();

      expect(oacs).toHaveLength(1);
      expect(oacs[0].name).toBe('OAC-mybucket');
    });
  });

  // ==========================================================================
  // 7. S3 Cross-Region Replication Tests
  // ==========================================================================

  describe('Replication Configuration', () => {
    it('should get replication configuration', async () => {
      mockS3Send.mockResolvedValue({
        ReplicationConfiguration: {
          Role: 'arn:aws:iam::123:role/replication-role',
          Rules: [
            {
              ID: 'replicate-all',
              Status: 'Enabled',
              Priority: 1,
              Filter: { Prefix: '' },
              Destination: {
                Bucket: 'arn:aws:s3:::dest-bucket',
                StorageClass: 'STANDARD',
              },
            },
          ],
        },
      });

      const config = await manager.getReplicationConfiguration('source-bucket');

      expect(config).not.toBeNull();
      expect(config?.role).toContain('replication-role');
      expect(config?.rules).toHaveLength(1);
    });

    it('should return null when no replication config', async () => {
      const error = new Error('ReplicationConfigurationNotFoundError');
      (error as Error & { name: string }).name = 'ReplicationConfigurationNotFoundError';
      mockS3Send.mockRejectedValue(error);

      const config = await manager.getReplicationConfiguration('my-bucket');

      expect(config).toBeNull();
    });

    it('should set replication configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setReplicationConfiguration({
        bucketName: 'source-bucket',
        role: 'arn:aws:iam::123:role/replication-role',
        rules: [
          {
            id: 'replicate-rule',
            status: 'Enabled',
            priority: 1,
            destination: {
              bucket: 'arn:aws:s3:::dest-bucket',
            },
          },
        ],
      });

      expect(result.success).toBe(true);
      expect((result.data as { rulesCount?: number })?.rulesCount).toBe(1);
    });

    it('should delete replication configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.deleteReplicationConfiguration('my-bucket');

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // 8. S3 Event Notification Configuration Tests
  // ==========================================================================

  describe('Notification Configuration', () => {
    it('should get notification configuration', async () => {
      mockS3Send.mockResolvedValue({
        TopicConfigurations: [
          {
            Id: 'sns-notify',
            TopicArn: 'arn:aws:sns:us-east-1:123:my-topic',
            Events: ['s3:ObjectCreated:*'],
          },
        ],
        QueueConfigurations: [
          {
            Id: 'sqs-notify',
            QueueArn: 'arn:aws:sqs:us-east-1:123:my-queue',
            Events: ['s3:ObjectRemoved:*'],
          },
        ],
        LambdaFunctionConfigurations: [
          {
            Id: 'lambda-notify',
            LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123:function:processor',
            Events: ['s3:ObjectCreated:Put'],
            Filter: {
              Key: { FilterRules: [{ Name: 'suffix', Value: '.jpg' }] },
            },
          },
        ],
      });

      const config = await manager.getNotificationConfiguration('my-bucket');

      expect(config.topicConfigurations).toHaveLength(1);
      expect(config.queueConfigurations).toHaveLength(1);
      expect(config.lambdaFunctionConfigurations).toHaveLength(1);
    });

    it('should set notification configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setNotificationConfiguration({
        bucketName: 'my-bucket',
        lambdaFunctionConfigurations: [
          {
            id: 'process-images',
            lambdaFunctionArn: 'arn:aws:lambda:us-east-1:123:function:image-processor',
            events: ['s3:ObjectCreated:*'],
            filter: {
              key: {
                filterRules: [{ name: 'suffix', value: '.png' }],
              },
            },
          },
        ],
      });

      expect(result.success).toBe(true);
      expect((result.data as { configurationsCount?: number })?.configurationsCount).toBe(1);
    });

    it('should set EventBridge notification', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setNotificationConfiguration({
        bucketName: 'my-bucket',
        eventBridgeEnabled: true,
      });

      expect(result.success).toBe(true);
    });

    it('should clear notification configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.clearNotificationConfiguration('my-bucket');

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Additional Operations Tests
  // ==========================================================================

  describe('Additional Operations', () => {
    it('should get bucket logging', async () => {
      mockS3Send.mockResolvedValue({
        LoggingEnabled: {
          TargetBucket: 'logs-bucket',
          TargetPrefix: 'access-logs/',
        },
      });

      const logging = await manager.getLogging('my-bucket');

      expect(logging).not.toBeNull();
      expect(logging?.targetBucket).toBe('logs-bucket');
    });

    it('should set bucket logging', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setLogging({
        bucketName: 'my-bucket',
        targetBucket: 'logs-bucket',
        targetPrefix: 'logs/',
      });

      expect(result.success).toBe(true);
    });

    it('should get bucket tags', async () => {
      mockS3Send.mockResolvedValue({
        TagSet: [
          { Key: 'Environment', Value: 'Production' },
          { Key: 'Project', Value: 'MyApp' },
        ],
      });

      const tags = await manager.getBucketTags('my-bucket');

      expect(tags.Environment).toBe('Production');
      expect(tags.Project).toBe('MyApp');
    });

    it('should set bucket tags', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setBucketTags('my-bucket', {
        Environment: 'Test',
        Team: 'DevOps',
      });

      expect(result.success).toBe(true);
    });

    it('should delete bucket tags', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.deleteBucketTags('my-bucket');

      expect(result.success).toBe(true);
    });

    it('should get bucket policy', async () => {
      mockS3Send.mockResolvedValue({
        Policy: '{"Version":"2012-10-17","Statement":[]}',
      });

      const policy = await manager.getBucketPolicy('my-bucket');

      expect(policy).not.toBeNull();
      expect(policy).toContain('Statement');
    });

    it('should set bucket policy', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setBucketPolicy(
        'my-bucket',
        '{"Version":"2012-10-17","Statement":[]}'
      );

      expect(result.success).toBe(true);
    });

    it('should delete bucket policy', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.deleteBucketPolicy('my-bucket');

      expect(result.success).toBe(true);
    });

    it('should list multipart uploads', async () => {
      mockS3Send.mockResolvedValue({
        Uploads: [
          {
            UploadId: 'upload-1',
            Key: 'large-file.zip',
            Initiated: new Date(),
            StorageClass: 'STANDARD',
          },
        ],
        IsTruncated: false,
      });

      const result = await manager.listMultipartUploads({ bucketName: 'my-bucket' });

      expect(result.uploads).toHaveLength(1);
      expect(result.uploads[0].key).toBe('large-file.zip');
    });

    it('should abort multipart upload', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.abortMultipartUpload({
        bucketName: 'my-bucket',
        key: 'large-file.zip',
        uploadId: 'upload-123',
      });

      expect(result.success).toBe(true);
    });

    it('should get accelerate configuration', async () => {
      mockS3Send.mockResolvedValue({ Status: 'Enabled' });

      const status = await manager.getAccelerateConfiguration('my-bucket');

      expect(status).toBe('Enabled');
    });

    it('should set accelerate configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setAccelerateConfiguration('my-bucket', 'Enabled');

      expect(result.success).toBe(true);
    });

    it('should get request payment configuration', async () => {
      mockS3Send.mockResolvedValue({ Payer: 'Requester' });

      const payer = await manager.getRequestPayment('my-bucket');

      expect(payer).toBe('Requester');
    });

    it('should set request payment configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setRequestPayment('my-bucket', 'Requester');

      expect(result.success).toBe(true);
    });

    it('should get object lock configuration', async () => {
      mockS3Send.mockResolvedValue({
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: {
            DefaultRetention: {
              Mode: 'GOVERNANCE',
              Days: 30,
            },
          },
        },
      });

      const config = await manager.getObjectLockConfiguration('my-bucket');

      expect(config).not.toBeNull();
      expect(config?.enabled).toBe(true);
      expect(config?.mode).toBe('GOVERNANCE');
      expect(config?.days).toBe(30);
    });

    it('should set object lock configuration', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setObjectLockConfiguration({
        bucketName: 'my-bucket',
        mode: 'COMPLIANCE',
        days: 90,
      });

      expect(result.success).toBe(true);
    });

    it('should empty a bucket', async () => {
      mockS3Send
        .mockResolvedValueOnce({
          Versions: [
            { Key: 'file1.txt', VersionId: 'v1' },
            { Key: 'file2.txt', VersionId: 'v2' },
          ],
          DeleteMarkers: [],
          IsTruncated: false,
        })
        .mockResolvedValueOnce({
          Deleted: [{ Key: 'file1.txt' }, { Key: 'file2.txt' }],
        });

      const result = await manager.emptyBucket('my-bucket');

      expect(result.success).toBe(true);
      expect((result.data as { deletedCount?: number })?.deletedCount).toBe(2);
    });

    it('should get object tags', async () => {
      mockS3Send.mockResolvedValue({
        TagSet: [{ Key: 'Category', Value: 'Images' }],
      });

      const tags = await manager.getObjectTags('my-bucket', 'photo.jpg');

      expect(tags.Category).toBe('Images');
    });

    it('should set object tags', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setObjectTags('my-bucket', 'file.txt', {
        Status: 'Archived',
      });

      expect(result.success).toBe(true);
    });

    it('should delete object tags', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.deleteObjectTags('my-bucket', 'file.txt');

      expect(result.success).toBe(true);
    });

    it('should get object ACL', async () => {
      mockS3Send.mockResolvedValue({
        Owner: { ID: 'owner-id', DisplayName: 'owner' },
        Grants: [
          {
            Grantee: { Type: 'CanonicalUser', ID: 'user-id' },
            Permission: 'FULL_CONTROL',
          },
        ],
      });

      const acl = await manager.getObjectAcl('my-bucket', 'file.txt');

      expect(acl.owner).toBeDefined();
      expect(acl.grants).toHaveLength(1);
    });

    it('should set object ACL', async () => {
      mockS3Send.mockResolvedValue({});

      const result = await manager.setObjectAcl('my-bucket', 'file.txt', 'public-read');

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Factory Function Test
  // ==========================================================================

  describe('Factory Function', () => {
    it('should create S3Manager instance', () => {
      const instance = createS3Manager({ region: 'eu-west-1' });

      expect(instance).toBeInstanceOf(S3Manager);
    });

    it('should create S3Manager with default config', () => {
      const instance = createS3Manager();

      expect(instance).toBeInstanceOf(S3Manager);
    });
  });
});
