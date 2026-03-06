/**
 * AWS Provider Adapter
 *
 * Wraps the existing AWS extension managers (AWSEC2Manager, S3Manager,
 * Route53Manager) behind the unified CloudProviderAdapter interface.
 *
 * Import paths reference the existing extensions/aws/ SDK integrations.
 */

import type {
  CloudProviderAdapter,
  ComputeAdapter,
  StorageAdapter,
  DNSAdapter,
  NetworkAdapter,
  ProviderHealthResult,
  CreateSnapshotParams,
  SnapshotOutput,
  ExportImageParams,
  ExportImageOutput,
  ImportImageParams,
  ImportImageOutput,
  ProvisionVMParams,
  ProvisionVMOutput,
  InstanceStatusOutput,
  CreateBucketParams,
  CreateBucketOutput,
  ListObjectsOpts,
  ListObjectsOutput,
  ObjectDataOutput,
  PutObjectOutput,
  MultipartUploadInit,
  UploadPartParams,
  UploadPartOutput,
  CompleteMultipartUploadParams,
  DNSZoneInfo,
  CreateDNSZoneParams,
  NetworkVPCInfo,
  NetworkSubnetInfo,
  SecurityGroupInfo,
  CreateSecurityGroupParams,
  LoadBalancerInfo,
  AWSCredentialConfig,
} from "./types.js";
import type {
  NormalizedVM,
  NormalizedBucket,
  NormalizedDNSRecord,
  NormalizedSecurityRule,
} from "../types.js";

// =============================================================================
// AWS Adapter Implementation
// =============================================================================

/**
 * AWS Cloud Provider Adapter.
 *
 * Delegates to real AWS SDK managers from extensions/aws/:
 * - AWSEC2Manager for compute (EC2, AMI, snapshots)
 * - S3Manager for object storage
 * - Route53Manager for DNS
 * - EC2 Security Groups for network
 *
 * Each manager is lazily instantiated using the provided credentials.
 */
export class AWSProviderAdapter implements CloudProviderAdapter {
  readonly provider = "aws" as const;
  readonly compute: AWSComputeAdapter;
  readonly storage: AWSStorageAdapter;
  readonly dns: AWSDNSAdapter;
  readonly network: AWSNetworkAdapter;

  private config: AWSCredentialConfig;

  // Lazy manager instances — only created when first used
  private _ec2Manager: any = null;
  private _s3Manager: any = null;
  private _route53Manager: any = null;
  private _credentialsManager: any = null;

  constructor(config: AWSCredentialConfig) {
    this.config = config;
    this.compute = new AWSComputeAdapter(this);
    this.storage = new AWSStorageAdapter(this);
    this.dns = new AWSDNSAdapter(this);
    this.network = new AWSNetworkAdapter(this);
  }

  /**
   * Lazily initialize the AWS Credentials Manager.
   */
  async getCredentialsManager(): Promise<any> {
    if (this._credentialsManager) return this._credentialsManager;

    const { AWSCredentialsManager } = await import("../../../aws/src/credentials/manager.js");
    this._credentialsManager = new AWSCredentialsManager({
      defaultRegion: this.config.region,
      ...(this.config.accessKeyId && {
        credentials: {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey!,
          sessionToken: this.config.sessionToken,
        },
      }),
      ...(this.config.profile && { profile: this.config.profile }),
    });
    return this._credentialsManager;
  }

  /**
   * Lazily initialize the EC2 Manager.
   */
  async getEC2Manager(): Promise<any> {
    if (this._ec2Manager) return this._ec2Manager;

    const credManager = await this.getCredentialsManager();
    const { AWSEC2Manager } = await import("../../../aws/src/ec2/manager.js");
    this._ec2Manager = new AWSEC2Manager(credManager, this.config.region);
    return this._ec2Manager;
  }

  /**
   * Lazily initialize the S3 Manager.
   */
  async getS3Manager(): Promise<any> {
    if (this._s3Manager) return this._s3Manager;

    const credManager = await this.getCredentialsManager();
    const creds = await credManager.getCredentials();
    const { S3Manager } = await import("../../../aws/src/s3/manager.js");
    this._s3Manager = new S3Manager({
      region: this.config.region,
      credentials: creds.credentials,
    });
    return this._s3Manager;
  }

  /**
   * Get the raw S3Client for direct multi-part upload operations.
   * The S3Manager wraps common high-level operations, but multi-part
   * requires direct S3Client access for CreateMultipartUpload / UploadPart /
   * CompleteMultipartUpload / AbortMultipartUpload commands.
   */
  private _s3Client: any = null;
  async getS3Client(): Promise<any> {
    if (this._s3Client) return this._s3Client;

    const credManager = await this.getCredentialsManager();
    const creds = await credManager.getCredentials();
    // @ts-ignore — @aws-sdk/client-s3 is dynamically loaded at runtime
    const { S3Client } = await import("@aws-sdk/client-s3");
    this._s3Client = new S3Client({
      region: this.config.region,
      credentials: creds.credentials,
    });
    return this._s3Client;
  }

  /**
   * Lazily initialize the Route53 Manager.
   */
  async getRoute53Manager(): Promise<any> {
    if (this._route53Manager) return this._route53Manager;

    const credManager = await this.getCredentialsManager();
    const creds = await credManager.getCredentials();
    const { Route53Manager } = await import("../../../aws/src/route53/manager.js");
    this._route53Manager = new Route53Manager({
      region: this.config.region,
      credentials: creds.credentials,
    });
    return this._route53Manager;
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      const credManager = await this.getCredentialsManager();
      const creds = await credManager.getCredentials();
      return {
        provider: "aws",
        reachable: true,
        authenticated: true,
        region: this.config.region,
        accountId: creds.accountId,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        provider: "aws",
        reachable: false,
        authenticated: false,
        region: this.config.region,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// =============================================================================
// AWS Compute Adapter
// =============================================================================

class AWSComputeAdapter implements ComputeAdapter {
  constructor(private adapter: AWSProviderAdapter) {}

  async listVMs(region: string, opts?: { ids?: string[] }): Promise<NormalizedVM[]> {
    const ec2 = await this.adapter.getEC2Manager();
    const instances = await ec2.listInstances({ region });
    const filtered = opts?.ids
      ? instances.filter((i: any) => opts.ids!.includes(i.instanceId))
      : instances;

    return filtered.map((i: any) => this.normalizeInstance(i, region));
  }

  async getVM(vmId: string, region: string): Promise<NormalizedVM | null> {
    const ec2 = await this.adapter.getEC2Manager();
    const instance = await ec2.getInstance(vmId, region);
    if (!instance) return null;
    return this.normalizeInstance(instance, region);
  }

  async createSnapshot(params: CreateSnapshotParams): Promise<SnapshotOutput> {
    const ec2 = await this.adapter.getEC2Manager();
    const snapshots: SnapshotOutput["snapshots"] = [];

    for (const volumeId of params.volumeIds) {
      const result = await ec2.createSnapshot({
        volumeId,
        description: `espada-migration-${params.vmId}-${volumeId}`,
        tags: {
          "espada:migration": "true",
          "espada:source-vm": params.vmId,
          ...params.tags,
        },
        region: params.region,
      });

      snapshots.push({
        volumeId,
        snapshotId: result.snapshotId ?? result.data?.snapshotId ?? `snap-${Date.now()}`,
        sizeGB: result.data?.volumeSize ?? 0,
        state: result.success ? "completed" : "error",
      });
    }

    return {
      snapshots,
      createdAt: new Date().toISOString(),
    };
  }

  async deleteSnapshot(snapshotId: string, region: string): Promise<void> {
    const ec2 = await this.adapter.getEC2Manager();
    await ec2.deleteSnapshot(snapshotId, region);
  }

  async exportImage(params: ExportImageParams): Promise<ExportImageOutput> {
    const ec2 = await this.adapter.getEC2Manager();
    // AWS uses ExportImage API to export AMI/snapshot to S3
    const result = await ec2.exportImage({
      imageId: params.snapshotId,
      diskImageFormat: params.format.toUpperCase(),
      s3ExportLocation: {
        s3Bucket: params.stagingBucket,
        s3Prefix: params.stagingKey,
      },
      region: params.region,
    });

    return {
      exportTaskId: result.exportTaskId ?? `export-${Date.now()}`,
      exportPath: `s3://${params.stagingBucket}/${params.stagingKey}`,
      exportSizeBytes: 0, // resolved after export completes
      format: params.format,
    };
  }

  async importImage(params: ImportImageParams): Promise<ImportImageOutput> {
    const ec2 = await this.adapter.getEC2Manager();

    // AWS ImportImage: creates an AMI from a disk image in S3
    const result = await ec2.importImage({
      description: params.description ?? `Migrated: ${params.imageName}`,
      diskContainers: [{
        format: params.format.toUpperCase(),
        userBucket: {
          s3Bucket: params.sourceUri.split("/")[2] ?? params.sourceUri,
          s3Key: params.sourceUri.split("/").slice(3).join("/"),
        },
      }],
      tagSpecifications: params.tags ? [{
        resourceType: "image",
        tags: Object.entries(params.tags).map(([Key, Value]) => ({ Key, Value })),
      }] : undefined,
      region: params.region,
    });

    return {
      imageId: result.imageId ?? result.data?.imageId ?? `ami-${Date.now()}`,
      imageName: params.imageName,
      status: result.success ? "available" : "pending",
      importTaskId: result.importTaskId ?? result.data?.importTaskId,
    };
  }

  async deleteImage(imageId: string, region: string): Promise<void> {
    const ec2 = await this.adapter.getEC2Manager();
    await ec2.deregisterImage(imageId, region);
  }

  async provisionVM(params: ProvisionVMParams): Promise<ProvisionVMOutput> {
    const ec2 = await this.adapter.getEC2Manager();

    const result = await ec2.createInstances({
      imageId: params.imageId,
      instanceType: params.instanceType,
      minCount: 1,
      maxCount: 1,
      region: params.region,
      subnetId: params.subnetId,
      securityGroupIds: params.securityGroupIds,
      keyName: params.keyName,
      userData: params.userData,
      tags: params.tags,
      waitForState: true,
    });

    if (!result.success) {
      throw new Error(`Failed to provision VM on AWS: ${result.error}`);
    }

    const instance = result.instances?.[0];
    return {
      instanceId: result.instanceIds[0] ?? "",
      privateIp: instance?.privateIpAddress ?? "0.0.0.0",
      publicIp: instance?.publicIpAddress,
      state: "running",
    };
  }

  async getInstanceStatus(instanceId: string, region: string): Promise<InstanceStatusOutput> {
    const ec2 = await this.adapter.getEC2Manager();
    const statuses = await ec2.getInstanceStatus([instanceId], region);
    const status = statuses[0];

    if (!status) {
      return {
        instanceId,
        state: "unknown",
        systemStatus: "unknown",
        instanceStatus: "unknown",
      };
    }

    const stateMap: Record<string, InstanceStatusOutput["state"]> = {
      running: "running",
      stopped: "stopped",
      terminated: "terminated",
      pending: "pending",
      stopping: "stopped",
      "shutting-down": "terminated",
    };

    return {
      instanceId: status.instanceId,
      state: stateMap[status.instanceState] ?? "unknown",
      systemStatus: status.systemStatus === "ok" ? "ok" : status.systemStatus === "impaired" ? "impaired" : "unknown",
      instanceStatus: status.instanceStatus === "ok" ? "ok" : status.instanceStatus === "impaired" ? "impaired" : "unknown",
    };
  }

  async stopInstance(instanceId: string, region: string): Promise<void> {
    const ec2 = await this.adapter.getEC2Manager();
    await ec2.stopInstances([instanceId], { region, waitForState: true });
  }

  async terminateInstance(instanceId: string, region: string): Promise<void> {
    const ec2 = await this.adapter.getEC2Manager();
    await ec2.terminateInstances([instanceId], { region });
  }

  private normalizeInstance(i: any, region: string): NormalizedVM {
    return {
      id: i.instanceId ?? i.id ?? "",
      name: i.name ?? i.tags?.Name ?? i.instanceId ?? "",
      provider: "aws",
      region,
      zone: i.availabilityZone ?? i.placement?.availabilityZone,
      cpuCores: i.cpuCores ?? i.vCpuInfo?.defaultVCpus ?? 0,
      memoryGB: i.memoryGB ?? (i.memoryInfo?.sizeInMiB ? i.memoryInfo.sizeInMiB / 1024 : 0),
      osType: i.platform === "windows" ? "windows" : "linux",
      architecture: i.architecture === "arm64" ? "arm64" : "x86_64",
      disks: (i.blockDeviceMappings ?? []).map((bdm: any) => ({
        id: bdm.ebs?.volumeId ?? "",
        name: bdm.deviceName ?? "",
        sizeGB: bdm.ebs?.volumeSize ?? 0,
        type: bdm.ebs?.volumeType === "gp3" || bdm.ebs?.volumeType === "gp2" || bdm.ebs?.volumeType === "io1" || bdm.ebs?.volumeType === "io2" ? "ssd" : "hdd",
        encrypted: bdm.ebs?.encrypted ?? false,
        isBootDisk: bdm.deviceName === i.rootDeviceName,
      })),
      networkInterfaces: (i.networkInterfaces ?? []).map((ni: any) => ({
        id: ni.networkInterfaceId ?? "",
        privateIp: ni.privateIpAddress ?? "",
        publicIp: ni.association?.publicIp,
        subnetId: ni.subnetId,
        securityGroupIds: (ni.groups ?? []).map((g: any) => g.groupId ?? ""),
      })),
      tags: i.tags ?? {},
      raw: i,
    };
  }
}

// =============================================================================
// AWS Storage Adapter
// =============================================================================

class AWSStorageAdapter implements StorageAdapter {
  constructor(private adapter: AWSProviderAdapter) {}

  async listBuckets(region?: string): Promise<NormalizedBucket[]> {
    const s3 = await this.adapter.getS3Manager();
    const buckets = await s3.listBuckets(region);
    return buckets.map((b: any) => ({
      id: b.name,
      name: b.name,
      provider: "aws" as const,
      region: region ?? "us-east-1",
      objectCount: 0,
      totalSizeBytes: 0,
      versioning: false,
      encryption: { enabled: false, type: "none" as const },
      lifecycleRules: [],
      tags: {},
    }));
  }

  async getBucket(bucketName: string): Promise<NormalizedBucket | null> {
    const s3 = await this.adapter.getS3Manager();
    const details = await s3.getBucketDetails(bucketName);
    if (!details) return null;

    return {
      id: bucketName,
      name: bucketName,
      provider: "aws",
      region: details.region ?? "us-east-1",
      objectCount: 0,
      totalSizeBytes: 0,
      versioning: details.versioning?.status === "Enabled",
      encryption: {
        enabled: !!details.encryption,
        type: details.encryption?.sseAlgorithm === "aws:kms" ? "customer-managed" : details.encryption ? "provider-managed" : "none",
        keyId: details.encryption?.kmsMasterKeyID,
      },
      lifecycleRules: [],
      tags: details.tags ?? {},
    };
  }

  async createBucket(params: CreateBucketParams): Promise<CreateBucketOutput> {
    const s3 = await this.adapter.getS3Manager();
    const result = await s3.createBucket({
      bucketName: params.name,
      region: params.region,
    });

    if (!result.success) {
      throw new Error(`Failed to create S3 bucket: ${result.error ?? result.message}`);
    }

    // Set versioning if requested
    if (params.versioning) {
      await s3.setBucketVersioning(params.name, { status: "Enabled" }, params.region);
    }

    // Set tags if provided
    if (params.tags && Object.keys(params.tags).length > 0) {
      await s3.setBucketTagging(params.name, params.tags, params.region);
    }

    return { name: params.name, region: params.region, created: true };
  }

  async deleteBucket(bucketName: string, region?: string): Promise<void> {
    const s3 = await this.adapter.getS3Manager();
    const result = await s3.deleteBucket(bucketName, region);
    if (!result.success) {
      throw new Error(`Failed to delete S3 bucket: ${result.error ?? result.message}`);
    }
  }

  async listObjects(bucketName: string, opts?: ListObjectsOpts): Promise<ListObjectsOutput> {
    const s3 = await this.adapter.getS3Manager();
    const result = await s3.listObjects({
      bucketName,
      prefix: opts?.prefix,
      maxKeys: opts?.maxKeys,
      continuationToken: opts?.continuationToken,
    });

    return {
      objects: result.objects.map((o: any) => ({
        key: o.key,
        sizeBytes: o.size ?? 0,
        lastModified: o.lastModified?.toISOString() ?? "",
        etag: o.eTag,
        storageClass: o.storageClass,
      })),
      truncated: result.isTruncated ?? false,
      continuationToken: result.nextContinuationToken,
    };
  }

  async getObjectUrl(bucketName: string, key: string, expiresInSec?: number): Promise<string> {
    const s3 = await this.adapter.getS3Manager();
    const result = await s3.getPresignedUrl({
      bucketName,
      key,
      expiresIn: expiresInSec ?? 3600,
      operation: "getObject",
    });
    return result.url ?? result;
  }

  async getObject(bucketName: string, key: string): Promise<ObjectDataOutput> {
    const s3 = await this.adapter.getS3Manager();
    const result = await s3.downloadObject({ bucketName, key });
    return {
      data: result.body,
      contentType: result.contentType,
      etag: result.eTag,
      metadata: result.metadata,
    };
  }

  async putObject(
    bucketName: string,
    key: string,
    data: Buffer | Uint8Array,
    metadata?: Record<string, string>,
  ): Promise<PutObjectOutput> {
    const s3 = await this.adapter.getS3Manager();
    const result = await s3.uploadObject({
      bucketName,
      key,
      body: data,
      metadata,
    });

    if (!result.success) {
      throw new Error(`Failed to upload object: ${result.error ?? result.message}`);
    }

    return {
      etag: result.data?.eTag,
      versionId: result.data?.versionId,
    };
  }

  async deleteObject(bucketName: string, key: string): Promise<void> {
    const s3 = await this.adapter.getS3Manager();
    await s3.deleteObject({ bucketName, key });
  }

  async setBucketVersioning(bucketName: string, enabled: boolean): Promise<void> {
    const s3 = await this.adapter.getS3Manager();
    await s3.setBucketVersioning(bucketName, { status: enabled ? "Enabled" : "Suspended" });
  }

  async setBucketTags(bucketName: string, tags: Record<string, string>): Promise<void> {
    const s3 = await this.adapter.getS3Manager();
    await s3.setBucketTagging(bucketName, tags);
  }

  // =========================================================================
  // Multi-part Upload (S3 CreateMultipartUpload API)
  // =========================================================================

  async initiateMultipartUpload(
    bucketName: string,
    key: string,
    metadata?: Record<string, string>,
  ): Promise<MultipartUploadInit> {
    const s3 = await this.adapter.getS3Manager();

    // Use the underlying S3 client from the manager for multipart operations
    const client = await this.adapter.getS3Client();
    // @ts-ignore — @aws-sdk/client-s3 is dynamically loaded at runtime
    const { CreateMultipartUploadCommand } = await import("@aws-sdk/client-s3");

    const contentType = metadata?.["Content-Type"] ?? "application/octet-stream";
    const sanitizedMeta: Record<string, string> = {};
    for (const [k, v] of Object.entries(metadata ?? {})) {
      if (k === "Content-Type") continue;
      sanitizedMeta[k] = v;
    }

    const response = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: contentType,
        Metadata: Object.keys(sanitizedMeta).length > 0 ? sanitizedMeta : undefined,
      }),
    );

    if (!response.UploadId) {
      throw new Error("Failed to initiate multipart upload — no UploadId returned");
    }

    return {
      uploadId: response.UploadId,
      bucketName,
      key,
    };
  }

  async uploadPart(params: UploadPartParams): Promise<UploadPartOutput> {
    const client = await this.adapter.getS3Client();
    // @ts-ignore — @aws-sdk/client-s3 is dynamically loaded at runtime
    const { UploadPartCommand } = await import("@aws-sdk/client-s3");

    const buf = Buffer.isBuffer(params.data) ? params.data : Buffer.from(params.data);

    const response = await client.send(
      new UploadPartCommand({
        Bucket: params.bucketName,
        Key: params.key,
        UploadId: params.uploadId,
        PartNumber: params.partNumber,
        Body: buf,
        ContentLength: buf.length,
      }),
    );

    if (!response.ETag) {
      throw new Error(`Upload part ${params.partNumber} failed — no ETag returned`);
    }

    return {
      partNumber: params.partNumber,
      etag: response.ETag,
    };
  }

  async completeMultipartUpload(params: CompleteMultipartUploadParams): Promise<PutObjectOutput> {
    const client = await this.adapter.getS3Client();
    // @ts-ignore — @aws-sdk/client-s3 is dynamically loaded at runtime
    const { CompleteMultipartUploadCommand } = await import("@aws-sdk/client-s3");

    const response = await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: params.bucketName,
        Key: params.key,
        UploadId: params.uploadId,
        MultipartUpload: {
          Parts: params.parts
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({
              PartNumber: p.partNumber,
              ETag: p.etag,
            })),
        },
      }),
    );

    return {
      etag: response.ETag ?? undefined,
      versionId: response.VersionId ?? undefined,
    };
  }

  async abortMultipartUpload(bucketName: string, key: string, uploadId: string): Promise<void> {
    const client = await this.adapter.getS3Client();
    // @ts-ignore — @aws-sdk/client-s3 is dynamically loaded at runtime
    const { AbortMultipartUploadCommand } = await import("@aws-sdk/client-s3");

    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: bucketName,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }
}

// =============================================================================
// AWS DNS Adapter
// =============================================================================

class AWSDNSAdapter implements DNSAdapter {
  constructor(private adapter: AWSProviderAdapter) {}

  async listZones(): Promise<DNSZoneInfo[]> {
    const r53 = await this.adapter.getRoute53Manager();
    const zones = await r53.listHostedZones();
    return zones.map((z: any) => ({
      id: z.id ?? z.Id?.replace("/hostedzone/", "") ?? "",
      name: z.name ?? z.Name ?? "",
      type: z.config?.privateZone ? "private" as const : "public" as const,
      nameServers: z.nameServers ?? [],
      recordCount: z.resourceRecordSetCount ?? z.recordCount ?? 0,
    }));
  }

  async getZone(zoneId: string): Promise<DNSZoneInfo | null> {
    const r53 = await this.adapter.getRoute53Manager();
    try {
      const zone = await r53.getHostedZone(zoneId);
      if (!zone) return null;
      return {
        id: zone.id ?? zoneId,
        name: zone.name ?? "",
        type: zone.config?.privateZone ? "private" : "public",
        nameServers: zone.delegationSet?.nameServers ?? zone.nameServers ?? [],
        recordCount: zone.resourceRecordSetCount ?? 0,
      };
    } catch {
      return null;
    }
  }

  async createZone(params: CreateDNSZoneParams): Promise<DNSZoneInfo> {
    const r53 = await this.adapter.getRoute53Manager();
    const result = await r53.createHostedZone({
      name: params.name,
      callerReference: `espada-migration-${Date.now()}`,
      comment: params.description ?? `Created by Espada migration`,
      isPrivate: params.type === "private",
      tags: params.tags,
    });

    return {
      id: result.hostedZone?.id ?? result.id ?? "",
      name: params.name,
      type: params.type ?? "public",
      nameServers: result.delegationSet?.nameServers ?? [],
      recordCount: 0,
    };
  }

  async deleteZone(zoneId: string): Promise<void> {
    const r53 = await this.adapter.getRoute53Manager();
    await r53.deleteHostedZone(zoneId);
  }

  async listRecords(zoneId: string): Promise<NormalizedDNSRecord[]> {
    const r53 = await this.adapter.getRoute53Manager();
    const records = await r53.listResourceRecordSets(zoneId);
    return records
      .filter((r: any) => ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "PTR"].includes(r.type ?? r.Type))
      .map((r: any) => ({
        name: r.name ?? r.Name ?? "",
        type: (r.type ?? r.Type) as NormalizedDNSRecord["type"],
        ttl: r.ttl ?? r.TTL ?? 300,
        values: (r.resourceRecords ?? r.ResourceRecords ?? []).map((rr: any) => rr.value ?? rr.Value ?? ""),
        weight: r.weight ?? r.Weight,
      }));
  }

  async createRecord(zoneId: string, record: NormalizedDNSRecord): Promise<void> {
    const r53 = await this.adapter.getRoute53Manager();
    await r53.changeResourceRecordSets(zoneId, {
      changes: [{
        action: "CREATE",
        resourceRecordSet: {
          name: record.name,
          type: record.type,
          ttl: record.ttl,
          resourceRecords: record.values.map((v) => ({ value: v })),
          ...(record.weight != null ? { weight: record.weight, setIdentifier: `${record.name}-${record.type}-${Date.now()}` } : {}),
        },
      }],
    });
  }

  async updateRecord(zoneId: string, record: NormalizedDNSRecord): Promise<void> {
    const r53 = await this.adapter.getRoute53Manager();
    await r53.changeResourceRecordSets(zoneId, {
      changes: [{
        action: "UPSERT",
        resourceRecordSet: {
          name: record.name,
          type: record.type,
          ttl: record.ttl,
          resourceRecords: record.values.map((v) => ({ value: v })),
        },
      }],
    });
  }

  async deleteRecord(zoneId: string, recordName: string, recordType: string): Promise<void> {
    const r53 = await this.adapter.getRoute53Manager();
    // Need to get existing record first for Route53 DELETE
    const records = await this.listRecords(zoneId);
    const existing = records.find((r) => r.name === recordName && r.type === recordType);
    if (!existing) return;

    await r53.changeResourceRecordSets(zoneId, {
      changes: [{
        action: "DELETE",
        resourceRecordSet: {
          name: existing.name,
          type: existing.type,
          ttl: existing.ttl,
          resourceRecords: existing.values.map((v) => ({ value: v })),
        },
      }],
    });
  }
}

// =============================================================================
// AWS Network Adapter
// =============================================================================

class AWSNetworkAdapter implements NetworkAdapter {
  constructor(private adapter: AWSProviderAdapter) {}

  async listVPCs(region?: string): Promise<NetworkVPCInfo[]> {
    const ec2 = await this.adapter.getEC2Manager();
    const vpcs = await ec2.listVPCs(region);
    return vpcs.map((v: any) => ({
      id: v.vpcId ?? v.id ?? "",
      name: v.tags?.Name ?? v.name ?? "",
      cidrBlocks: v.cidrBlockAssociationSet?.map((c: any) => c.cidrBlock) ?? [v.cidrBlock ?? ""],
      region: region ?? "",
      subnets: [],
      tags: v.tags,
    }));
  }

  async listSubnets(vpcId: string, region?: string): Promise<NetworkSubnetInfo[]> {
    const ec2 = await this.adapter.getEC2Manager();
    const subnets = await ec2.listSubnets({ vpcId, region });
    return subnets.map((s: any) => ({
      id: s.subnetId ?? s.id ?? "",
      name: s.tags?.Name ?? s.name ?? "",
      cidrBlock: s.cidrBlock ?? "",
      availabilityZone: s.availabilityZone,
      public: s.mapPublicIpOnLaunch ?? false,
    }));
  }

  async listSecurityGroups(region?: string): Promise<SecurityGroupInfo[]> {
    const ec2 = await this.adapter.getEC2Manager();
    const groups = await ec2.listSecurityGroups(region);
    return groups.map((g: any) => ({
      id: g.groupId ?? g.id ?? "",
      name: g.groupName ?? g.name ?? "",
      description: g.description,
      vpcId: g.vpcId,
      rules: [
        ...(g.ipPermissions ?? []).map((p: any) => this.normalizeIngressRule(p)),
        ...(g.ipPermissionsEgress ?? []).map((p: any) => this.normalizeEgressRule(p)),
      ],
      tags: g.tags,
    }));
  }

  async createSecurityGroup(params: CreateSecurityGroupParams): Promise<SecurityGroupInfo> {
    const ec2 = await this.adapter.getEC2Manager();
    const result = await ec2.createSecurityGroup({
      groupName: params.name,
      description: params.description ?? `Created by Espada migration`,
      vpcId: params.vpcId,
      tags: params.tags,
      region: params.region,
    });

    if (!result.success) {
      throw new Error(`Failed to create security group: ${result.error ?? "unknown error"}`);
    }

    return {
      id: result.securityGroup?.groupId ?? result.groupId ?? "",
      name: params.name,
      description: params.description,
      vpcId: params.vpcId,
      rules: [],
      tags: params.tags,
    };
  }

  async deleteSecurityGroup(groupId: string, region?: string): Promise<void> {
    const ec2 = await this.adapter.getEC2Manager();
    await ec2.deleteSecurityGroup(groupId, region);
  }

  async addSecurityRules(groupId: string, rules: NormalizedSecurityRule[], region?: string): Promise<void> {
    const ec2 = await this.adapter.getEC2Manager();

    const ingressRules = rules.filter((r) => r.direction === "inbound");
    const egressRules = rules.filter((r) => r.direction === "outbound");

    if (ingressRules.length > 0) {
      await ec2.authorizeSecurityGroupIngress(groupId, ingressRules.map((r) => ({
        ipProtocol: r.protocol === "*" ? "-1" : r.protocol,
        fromPort: r.portRange.from,
        toPort: r.portRange.to,
        ipRanges: [{ cidrIp: r.source.value, description: r.description }],
      })), region);
    }

    if (egressRules.length > 0) {
      await ec2.authorizeSecurityGroupEgress(groupId, egressRules.map((r) => ({
        ipProtocol: r.protocol === "*" ? "-1" : r.protocol,
        fromPort: r.portRange.from,
        toPort: r.portRange.to,
        ipRanges: [{ cidrIp: r.destination.value, description: r.description }],
      })), region);
    }
  }

  async listLoadBalancers(region?: string): Promise<LoadBalancerInfo[]> {
    const ec2 = await this.adapter.getEC2Manager();
    try {
      const lbs = await ec2.listLoadBalancers(region);
      return lbs.map((lb: any) => ({
        id: lb.loadBalancerArn ?? lb.id ?? "",
        name: lb.loadBalancerName ?? lb.name ?? "",
        type: lb.type === "application" ? "application" as const : "network" as const,
        scheme: lb.scheme === "internal" ? "internal" as const : "external" as const,
        dnsName: lb.dnsName,
      }));
    } catch {
      return [];
    }
  }

  private normalizeIngressRule(p: any): NormalizedSecurityRule {
    return {
      id: `ingress-${p.fromPort ?? 0}-${p.toPort ?? 0}-${p.ipProtocol ?? "all"}`,
      name: `ingress-${p.fromPort ?? "all"}-${p.toPort ?? "all"}`,
      direction: "inbound",
      action: "allow",
      protocol: p.ipProtocol === "-1" ? "*" : p.ipProtocol ?? "*",
      portRange: { from: p.fromPort ?? -1, to: p.toPort ?? -1 },
      source: {
        type: "cidr",
        value: p.ipRanges?.[0]?.cidrIp ?? p.ipv6Ranges?.[0]?.cidrIpv6 ?? "0.0.0.0/0",
      },
      destination: { type: "any", value: "*" },
      priority: 0,
      description: p.ipRanges?.[0]?.description,
    };
  }

  private normalizeEgressRule(p: any): NormalizedSecurityRule {
    return {
      id: `egress-${p.fromPort ?? 0}-${p.toPort ?? 0}-${p.ipProtocol ?? "all"}`,
      name: `egress-${p.fromPort ?? "all"}-${p.toPort ?? "all"}`,
      direction: "outbound",
      action: "allow",
      protocol: p.ipProtocol === "-1" ? "*" : p.ipProtocol ?? "*",
      portRange: { from: p.fromPort ?? -1, to: p.toPort ?? -1 },
      source: { type: "any", value: "*" },
      destination: {
        type: "cidr",
        value: p.ipRanges?.[0]?.cidrIp ?? p.ipv6Ranges?.[0]?.cidrIpv6 ?? "0.0.0.0/0",
      },
      priority: 0,
      description: p.ipRanges?.[0]?.description,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createAWSAdapter(config: AWSCredentialConfig): AWSProviderAdapter {
  return new AWSProviderAdapter(config);
}
