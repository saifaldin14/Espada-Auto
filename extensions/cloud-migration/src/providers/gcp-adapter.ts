/**
 * GCP Provider Adapter
 *
 * Wraps the existing GCP extension managers (GcpComputeManager, GcpStorageManager,
 * GcpDNSManager, GcpNetworkManager) behind the unified CloudProviderAdapter interface.
 *
 * GCP extension uses REST API-based managers rather than an SDK.
 * Import paths reference the existing extensions/gcp/ implementations.
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
  GCPCredentialConfig,
} from "./types.js";
import type {
  NormalizedVM,
  NormalizedBucket,
  NormalizedDNSRecord,
  NormalizedSecurityRule,
  MigrationProvider,
} from "../types.js";

// Lazy-loaded manager types (avoids hard compile-time dependency on the GCP extension)
type GcpCredentialsManager = InstanceType<typeof import("../../../gcp/src/credentials/index.js").GcpCredentialsManager>;
type GcpComputeManager = InstanceType<typeof import("../../../gcp/src/compute/index.js").GcpComputeManager>;
type GcpStorageManager = InstanceType<typeof import("../../../gcp/src/storage/index.js").GcpStorageManager>;
type GcpDNSManager = InstanceType<typeof import("../../../gcp/src/dns/index.js").GcpDNSManager>;
type GcpNetworkManager = InstanceType<typeof import("../../../gcp/src/network/index.js").GcpNetworkManager>;

// =============================================================================
// GCP Adapter Implementation
// =============================================================================

/**
 * Top-level GCP adapter that lazily initializes real GCP managers
 * and delegates all operations to them via sub-adapters.
 */
export class GCPProviderAdapter implements CloudProviderAdapter {
  readonly provider = "gcp" as const;

  private config: GCPCredentialConfig;
  private credentialsManager?: GcpCredentialsManager;
  private computeManager?: GcpComputeManager;
  private storageManager?: GcpStorageManager;
  private dnsManager?: GcpDNSManager;
  private networkManager?: GcpNetworkManager;

  readonly compute: ComputeAdapter;
  readonly storage: StorageAdapter;
  readonly dns: DNSAdapter;
  readonly network: NetworkAdapter;

  constructor(config: GCPCredentialConfig) {
    this.config = config;
    this.compute = new GCPComputeAdapter(this);
    this.storage = new GCPStorageAdapter(this);
    this.dns = new GCPDNSAdapter(this);
    this.network = new GCPNetworkAdapter(this);
  }

  // ---------------------------------------------------------------------------
  // Lazy manager initialization
  // ---------------------------------------------------------------------------

  async getCredentialsManager(): Promise<GcpCredentialsManager> {
    if (this.credentialsManager) return this.credentialsManager;
    const { GcpCredentialsManager: CredMgr } = await import("../../../gcp/src/credentials/index.js");
    this.credentialsManager = new CredMgr({
      projectId: this.config.projectId,
      credentialMethod: "default",
      serviceAccountKeyFile: this.config.keyFilePath,
    });
    await this.credentialsManager.initialize();
    return this.credentialsManager;
  }

  private async getAccessToken(): Promise<string> {
    const credMgr = await this.getCredentialsManager();
    return credMgr.getAccessToken();
  }

  private getProjectId(): string {
    return this.config.projectId;
  }

  async getComputeManager(): Promise<GcpComputeManager> {
    if (this.computeManager) return this.computeManager;
    const { GcpComputeManager: ComputeMgr } = await import("../../../gcp/src/compute/index.js");
    const credMgr = await this.getCredentialsManager();
    this.computeManager = new ComputeMgr(
      this.getProjectId(),
      () => credMgr.getAccessToken(),
    );
    return this.computeManager;
  }

  async getStorageManager(): Promise<GcpStorageManager> {
    if (this.storageManager) return this.storageManager;
    const { GcpStorageManager: StorageMgr } = await import("../../../gcp/src/storage/index.js");
    const credMgr = await this.getCredentialsManager();
    this.storageManager = new StorageMgr(
      this.getProjectId(),
      () => credMgr.getAccessToken(),
    );
    return this.storageManager;
  }

  async getDNSManager(): Promise<GcpDNSManager> {
    if (this.dnsManager) return this.dnsManager;
    const { GcpDNSManager: DNSMgr } = await import("../../../gcp/src/dns/index.js");
    const credMgr = await this.getCredentialsManager();
    this.dnsManager = new DNSMgr(
      this.getProjectId(),
      () => credMgr.getAccessToken(),
    );
    return this.dnsManager;
  }

  async getNetworkManager(): Promise<GcpNetworkManager> {
    if (this.networkManager) return this.networkManager;
    const { GcpNetworkManager: NetMgr } = await import("../../../gcp/src/network/index.js");
    const credMgr = await this.getCredentialsManager();
    this.networkManager = new NetMgr(
      this.getProjectId(),
      () => credMgr.getAccessToken(),
    );
    return this.networkManager;
  }

  // ---------------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------------

  async healthCheck(): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      const credMgr = await this.getCredentialsManager();
      const token = await credMgr.getAccessToken();
      return {
        provider: "gcp",
        reachable: true,
        authenticated: !!token,
        region: this.config.region,
        accountId: this.getProjectId(),
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        provider: "gcp",
        reachable: false,
        authenticated: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// =============================================================================
// Compute Adapter — wraps GcpComputeManager + direct Compute REST APIs
// =============================================================================

class GCPComputeAdapter implements ComputeAdapter {
  constructor(private parent: GCPProviderAdapter) {}

  async listVMs(region: string, opts?: { ids?: string[] }): Promise<NormalizedVM[]> {
    const compute = await this.parent.getComputeManager();
    // GCP uses zones, not regions. List across all zones or filter by zone
    // The region parameter may be a zone (us-central1-a) or region (us-central1)
    const isZone = /^[a-z]+-[a-z]+\d+-[a-z]$/.test(region);
    const instances = await compute.listInstances(isZone ? { zone: region } : undefined);

    // If region (not zone), filter instances whose zone starts with the region
    const filtered = isZone
      ? instances
      : instances.filter((i) => i.zone.startsWith(region));

    const normalized = filtered.map((inst) => this.normalizeInstance(inst));

    if (opts?.ids?.length) {
      const idSet = new Set(opts.ids);
      return normalized.filter((vm) => idSet.has(vm.id));
    }
    return normalized;
  }

  async getVM(vmId: string, region: string): Promise<NormalizedVM | null> {
    const compute = await this.parent.getComputeManager();
    try {
      // vmId for GCP is "zone/name" or just "name" — try to parse
      const parts = vmId.split("/");
      let zone: string;
      let name: string;
      if (parts.length >= 2) {
        zone = parts[0];
        name = parts[1];
      } else {
        // Assume the region param is actually a zone
        zone = region;
        name = vmId;
      }
      const inst = await compute.getInstance(zone, name);
      return this.normalizeInstance(inst);
    } catch {
      return null;
    }
  }

  async createSnapshot(params: CreateSnapshotParams): Promise<SnapshotOutput> {
    // GCP snapshots are created via the Compute REST API directly:
    // POST /compute/v1/projects/{project}/zones/{zone}/disks/{disk}/createSnapshot
    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();
    const projectId = this.parent["config"].projectId;

    const snapshots: SnapshotOutput["snapshots"] = [];
    const volumeIds = params.volumeIds ?? [];

    // If no volumeIds, look up the VM's disks
    let diskNames = volumeIds;
    if (diskNames.length === 0 && params.vmId) {
      const parts = params.vmId.split("/");
      const zone = parts.length >= 2 ? parts[0] : params.region;
      const name = parts.length >= 2 ? parts[1] : params.vmId;
      const compute = await this.parent.getComputeManager();
      const inst = await compute.getInstance(zone, name);
      diskNames = inst.disks.map((d) => {
        // disk source is a full URL, extract the disk name
        const segments = d.source.split("/");
        return segments[segments.length - 1];
      });
    }

    for (const diskName of diskNames) {
      const zone = params.region; // Assume zone is in region param for GCP
      const snapshotName = `mig-snap-${diskName}-${Date.now()}`;
      const url = `https://compute.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/disks/${diskName}/createSnapshot`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: snapshotName }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`GCP snapshot creation failed for ${diskName}: ${errText}`);
      }
      snapshots.push({
        volumeId: diskName,
        snapshotId: snapshotName,
        sizeGB: 0,
        state: "completed",
      });
    }

    return {
      snapshots,
      createdAt: new Date().toISOString(),
    };
  }

  async deleteSnapshot(snapshotId: string, _region: string): Promise<void> {
    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();
    const projectId = this.parent["config"].projectId;

    // GCP snapshots are global resources
    const url = `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/snapshots/${snapshotId}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GCP snapshot deletion failed for ${snapshotId}: ${errText}`);
    }
  }

  async exportImage(params: ExportImageParams): Promise<ExportImageOutput> {
    // GCP: Export a disk/snapshot to a GCS object using Compute images.export
    // The image export flow creates a GCS-backed image from a snapshot,
    // then exports it to the staging bucket.
    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();
    const projectId = this.parent["config"].projectId;

    // Step 1: Create an image from the snapshot
    const imageName = `export-${params.snapshotId}-${Date.now()}`;
    const createImageUrl = `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/images`;
    const createRes = await fetch(createImageUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: imageName,
        sourceSnapshot: `projects/${projectId}/global/snapshots/${params.snapshotId}`,
      }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`GCP image creation from snapshot failed: ${errText}`);
    }

    // Step 2: Export the image to GCS
    // Uses the cloud build export flow or direct API call
    const exportUri = `gs://${params.stagingBucket}/${params.stagingKey || imageName}.${params.format || "raw.gz"}`;
    const exportUrl = `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/images/${imageName}/export`;
    // Note: The actual export uses a Cloud Build job. We use the beta images.export API.
    const exportRes = await fetch(
      `https://compute.googleapis.com/compute/beta/projects/${projectId}/global/images/${imageName}/export`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          destinationUri: exportUri,
          format: params.format?.toUpperCase() || "RAW",
        }),
      },
    );

    // The export may return an operation reference
    let exportTaskId = imageName;
    if (exportRes.ok) {
      const result = await exportRes.json() as Record<string, unknown>;
      exportTaskId = (result.name as string) || imageName;
    }

    return {
      exportTaskId,
      exportPath: exportUri,
      exportSizeBytes: 0,
      format: params.format || "raw",
    };
  }

  async importImage(params: ImportImageParams): Promise<ImportImageOutput> {
    // GCP: Import a disk image from GCS into a Compute Engine image
    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();
    const projectId = this.parent["config"].projectId;

    const imageName = params.imageName || `imported-${Date.now()}`;
    const url = `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/images`;

    const body: Record<string, unknown> = {
      name: imageName,
      rawDisk: {
        source: params.sourceUri,
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GCP image import failed: ${errText}`);
    }

    const result = await res.json() as Record<string, unknown>;
    const operationName = (result.name as string) || "";

    return {
      imageId: imageName,
      imageName,
      status: "pending",
      importTaskId: operationName,
    };
  }

  async deleteImage(imageId: string, _region: string): Promise<void> {
    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();
    const projectId = this.parent["config"].projectId;

    const url = `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/images/${imageId}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GCP image deletion failed for ${imageId}: ${errText}`);
    }
  }

  async provisionVM(params: ProvisionVMParams): Promise<ProvisionVMOutput> {
    // GCP: Create an instance from an image in a specific zone
    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();
    const projectId = this.parent["config"].projectId;
    const zone = params.zone ?? params.region; // For GCP, must be a zone

    const instanceName = params.tags?.["source-name"]
      ? `mig-${params.tags["source-name"]}-${Date.now()}`
      : `mig-instance-${Date.now()}`;

    const machineType = params.instanceType || "e2-medium";

    const body = {
      name: instanceName,
      machineType: `zones/${zone}/machineTypes/${machineType}`,
      disks: [
        {
          boot: true,
          autoDelete: true,
          initializeParams: {
            sourceImage: `projects/${projectId}/global/images/${params.imageId}`,
            diskSizeGb: "20",
          },
        },
      ],
      networkInterfaces: [
        {
          network: "global/networks/default",
          accessConfigs: [
            {
              name: "External NAT",
              type: "ONE_TO_ONE_NAT",
            },
          ],
        },
      ],
      labels: {
        "managed-by": "cloud-migration",
        ...params.tags,
      },
    };

    const url = `https://compute.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/instances`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GCP VM provisioning failed: ${errText}`);
    }

    return {
      instanceId: `${zone}/${instanceName}`,
      privateIp: "0.0.0.0", // Available after instance starts
      publicIp: undefined,
      state: "pending",
    };
  }

  async getInstanceStatus(instanceId: string, region: string): Promise<InstanceStatusOutput> {
    const compute = await this.parent.getComputeManager();
    const parts = instanceId.split("/");
    const zone = parts.length >= 2 ? parts[0] : region;
    const name = parts.length >= 2 ? parts[1] : instanceId;

    try {
      const inst = await compute.getInstance(zone, name);
      return {
        instanceId,
        state: this.mapGcpStatus(inst.status) as InstanceStatusOutput["state"],
        systemStatus: "ok",
        instanceStatus: "ok",
      };
    } catch {
      return {
        instanceId,
        state: "unknown",
        systemStatus: "unknown",
        instanceStatus: "unknown",
      };
    }
  }

  async stopInstance(instanceId: string, region: string): Promise<void> {
    const compute = await this.parent.getComputeManager();
    const parts = instanceId.split("/");
    const zone = parts.length >= 2 ? parts[0] : region;
    const name = parts.length >= 2 ? parts[1] : instanceId;
    await compute.stopInstance(zone, name);
  }

  async terminateInstance(instanceId: string, region: string): Promise<void> {
    const compute = await this.parent.getComputeManager();
    const parts = instanceId.split("/");
    const zone = parts.length >= 2 ? parts[0] : region;
    const name = parts.length >= 2 ? parts[1] : instanceId;
    await compute.deleteInstance(zone, name);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private normalizeInstance(inst: Awaited<ReturnType<GcpComputeManager["getInstance"]>>): NormalizedVM {
    return {
      id: `${inst.zone}/${inst.name}`,
      name: inst.name,
      provider: "gcp",
      region: inst.zone,
      zone: inst.zone,
      cpuCores: 0, // Would need machine type lookup
      memoryGB: 0,
      osType: "linux",
      architecture: "x86_64" as const,
      disks: inst.disks.map((d) => ({
        id: d.source,
        name: d.deviceName,
        sizeGB: d.sizeGb ?? 0,
        type: "ssd" as const,
        encrypted: false,
        isBootDisk: d.boot,
      })),
      networkInterfaces: inst.networkInterfaces.map((ni) => ({
        id: ni.network,
        privateIp: ni.networkIP ?? "",
        publicIp: ni.accessConfigs?.[0]?.natIP,
        securityGroupIds: [],
      })),
      tags: inst.labels,
      raw: inst,
    };
  }

  private mapGcpStatus(status: string): string {
    const statusMap: Record<string, string> = {
      RUNNING: "running",
      STOPPED: "stopped",
      TERMINATED: "terminated",
      STAGING: "pending",
      PROVISIONING: "pending",
      SUSPENDING: "stopping",
      SUSPENDED: "stopped",
      REPAIRING: "pending",
    };
    return statusMap[status] ?? "unknown";
  }
}

// =============================================================================
// Storage Adapter — wraps GcpStorageManager
// =============================================================================

class GCPStorageAdapter implements StorageAdapter {
  constructor(private parent: GCPProviderAdapter) {}

  async listBuckets(region?: string): Promise<NormalizedBucket[]> {
    const storage = await this.parent.getStorageManager();
    const buckets = await storage.listBuckets();

    const filtered = region
      ? buckets.filter((b) => b.location.toLowerCase() === region.toLowerCase())
      : buckets;

    return filtered.map((b) => ({
      id: b.name,
      name: b.name,
      provider: "gcp" as const,
      region: b.location,
      objectCount: 0,
      totalSizeBytes: 0,
      versioning: b.versioning,
      encryption: { enabled: false, type: "none" as const },
      lifecycleRules: [],
      tags: b.labels,
    }));
  }

  async getBucket(name: string): Promise<NormalizedBucket | null> {
    const storage = await this.parent.getStorageManager();
    try {
      const b = await storage.getBucket(name);
      return {
        id: b.name,
        name: b.name,
        provider: "gcp" as const,
        region: b.location,
        objectCount: 0,
        totalSizeBytes: 0,
        versioning: b.versioning,
        encryption: { enabled: false, type: "none" as const },
        lifecycleRules: [],
        tags: b.labels,
      };
    } catch {
      return null;
    }
  }

  async createBucket(params: CreateBucketParams): Promise<CreateBucketOutput> {
    const storage = await this.parent.getStorageManager();
    const result = await storage.createBucket(params.name, {
      location: params.region,
      storageClass: params.storageClass,
    });
    return {
      name: params.name,
      region: params.region,
      created: result.success,
    };
  }

  async deleteBucket(name: string, _region?: string): Promise<void> {
    const storage = await this.parent.getStorageManager();
    await storage.deleteBucket(name);
  }

  async listObjects(bucket: string, opts?: ListObjectsOpts): Promise<ListObjectsOutput> {
    const storage = await this.parent.getStorageManager();
    const objects = await storage.listObjects(bucket, {
      prefix: opts?.prefix,
    });

    // GcpStorageManager doesn't support pagination natively in its current API
    const maxKeys = opts?.maxKeys ?? 1000;
    const limited = objects.slice(0, maxKeys);

    return {
      objects: limited.map((o) => ({
        key: o.name,
        sizeBytes: o.size,
        lastModified: o.updatedAt,
        etag: "",
        storageClass: "",
      })),
      truncated: objects.length > maxKeys,
      continuationToken: undefined,
    };
  }

  async getObjectUrl(bucket: string, key: string): Promise<string> {
    // Return the direct GCS URL; for signed URLs the caller can use generateSignedUrl
    return `https://storage.googleapis.com/${bucket}/${encodeURIComponent(key)}`;
  }

  async getObject(bucket: string, key: string): Promise<ObjectDataOutput> {
    // Direct object download via the JSON API media endpoint
    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();
    const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(key)}?alt=media`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`GCP object download failed: ${res.status} ${res.statusText}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return {
      data: Buffer.from(arrayBuf),
      contentType: res.headers.get("content-type") || "application/octet-stream",
    };
  }

  async putObject(bucket: string, key: string, body: Buffer | Uint8Array, metadata?: Record<string, string>): Promise<PutObjectOutput> {
    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();

    // Simple upload via the JSON API media upload endpoint
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(key)}`;
    const content = Buffer.isBuffer(body) ? body : Buffer.from(body);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        ...(metadata ? { "X-Goog-Meta-Custom": JSON.stringify(metadata) } : {}),
      },
      body: content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer,
    });

    if (!res.ok) {
      throw new Error(`GCP object upload failed: ${res.status} ${res.statusText}`);
    }

    return {
      etag: res.headers.get("x-goog-hash") || undefined,
    };
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    const storage = await this.parent.getStorageManager();
    await storage.deleteObject(bucket, key);
  }

  async setBucketVersioning(bucket: string, enabled: boolean): Promise<void> {
    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();

    const url = `https://storage.googleapis.com/storage/v1/b/${bucket}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ versioning: { enabled } }),
    });

    if (!res.ok) {
      throw new Error(`GCP set bucket versioning failed: ${res.status} ${res.statusText}`);
    }
  }

  async setBucketTags(bucket: string, tags: Record<string, string>): Promise<void> {
    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();

    const url = `https://storage.googleapis.com/storage/v1/b/${bucket}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ labels: tags }),
    });

    if (!res.ok) {
      throw new Error(`GCP set bucket labels failed: ${res.status} ${res.statusText}`);
    }
  }

  // =========================================================================
  // Multi-part Upload (GCS Resumable Upload API)
  // =========================================================================
  //
  // GCS uses "resumable uploads" as its multi-part upload mechanism:
  //   1. POST to initiate → returns a resumable upload URI
  //   2. PUT chunks to the resumable URI
  //   3. Final PUT completes the upload (no explicit commit step)
  //   4. DELETE the resumable URI to abort
  //
  // For simplicity with the step handler interface, we map:
  //   initiate → POST to get resumable URI (stored as uploadId)
  //   uploadPart → PUT chunk with Content-Range header
  //   complete → PUT final chunk (0-length if all parts sent)
  //   abort → DELETE the resumable URI
  //

  /** Track resumable upload state: uploadId → { uri, totalBytes, uploadedParts } */
  private resumableUploads = new Map<string, { uri: string; parts: Map<number, UploadPartOutput> }>();

  async initiateMultipartUpload(
    bucket: string,
    key: string,
    metadata?: Record<string, string>,
  ): Promise<MultipartUploadInit> {
    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();

    const contentType = metadata?.["Content-Type"] ?? "application/octet-stream";

    // Initiate a resumable upload
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=resumable&name=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": contentType,
      },
      body: JSON.stringify({
        name: key,
        metadata: metadata ? Object.fromEntries(
          Object.entries(metadata).filter(([k]) => k !== "Content-Type"),
        ) : undefined,
      }),
    });

    if (!res.ok) {
      throw new Error(`GCP initiate resumable upload failed: ${res.status} ${res.statusText}`);
    }

    const resumableUri = res.headers.get("Location");
    if (!resumableUri) {
      throw new Error("GCP resumable upload did not return a Location header");
    }

    // Use the resumable URI as the uploadId
    const uploadId = `gcs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.resumableUploads.set(uploadId, { uri: resumableUri, parts: new Map() });

    return {
      uploadId,
      bucketName: bucket,
      key,
    };
  }

  async uploadPart(params: UploadPartParams): Promise<UploadPartOutput> {
    const uploadState = this.resumableUploads.get(params.uploadId);
    if (!uploadState) {
      throw new Error(`No resumable upload found for uploadId: ${params.uploadId}`);
    }

    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();

    const buf = Buffer.isBuffer(params.data) ? params.data : Buffer.from(params.data);

    // For GCS resumable uploads, we upload each part as a separate PUT
    // with Content-Range header. However, for compose-style multipart
    // (which is simpler), we upload each part as a temporary object
    // and then compose them in the complete step.
    //
    // Compose approach: upload as temporary object, then compose
    const tempKey = `__multipart_staging/${params.uploadId}/part-${String(params.partNumber).padStart(6, "0")}`;

    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${params.bucketName}/o?uploadType=media&name=${encodeURIComponent(tempKey)}`;
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    });

    if (!res.ok) {
      throw new Error(`GCP upload part ${params.partNumber} failed: ${res.status} ${res.statusText}`);
    }

    const result: UploadPartOutput = {
      partNumber: params.partNumber,
      etag: tempKey, // Store the temp key as "etag" for compose
    };

    uploadState.parts.set(params.partNumber, result);
    return result;
  }

  async completeMultipartUpload(params: CompleteMultipartUploadParams): Promise<PutObjectOutput> {
    const uploadState = this.resumableUploads.get(params.uploadId);
    if (!uploadState) {
      throw new Error(`No resumable upload found for uploadId: ${params.uploadId}`);
    }

    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();

    // Use GCS compose API to combine all staged parts into the final object
    // GCS compose supports up to 32 source objects per call, so we may
    // need to compose in rounds for very large uploads.
    const sortedParts = params.parts
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((p) => p.etag); // These are temp object keys

    // Compose in batches of 32 (GCS limit)
    let currentSources = sortedParts;
    let round = 0;

    while (currentSources.length > 1) {
      const nextSources: string[] = [];
      const batchSize = 32;

      for (let i = 0; i < currentSources.length; i += batchSize) {
        const batch = currentSources.slice(i, i + batchSize);
        const isLastRound = currentSources.length <= batchSize;
        const destName = isLastRound
          ? params.key
          : `__multipart_staging/${params.uploadId}/compose-round-${round}-${i}`;

        const composeUrl = `https://storage.googleapis.com/storage/v1/b/${params.bucketName}/o/${encodeURIComponent(destName)}/compose`;
        const res = await fetch(composeUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sourceObjects: batch.map((name) => ({ name })),
            destination: { name: destName },
          }),
        });

        if (!res.ok) {
          throw new Error(`GCP compose failed: ${res.status} ${res.statusText}`);
        }

        nextSources.push(destName);
      }

      // Clean up intermediate compose results (not the final one)
      if (currentSources !== sortedParts) {
        for (const src of currentSources) {
          if (src !== params.key) {
            try {
              const delUrl = `https://storage.googleapis.com/storage/v1/b/${params.bucketName}/o/${encodeURIComponent(src)}`;
              await fetch(delUrl, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
              });
            } catch { /* best-effort cleanup */ }
          }
        }
      }

      currentSources = nextSources;
      round++;
    }

    // Clean up original temp parts
    for (const tempKey of sortedParts) {
      if (tempKey !== params.key) {
        try {
          const delUrl = `https://storage.googleapis.com/storage/v1/b/${params.bucketName}/o/${encodeURIComponent(tempKey)}`;
          await fetch(delUrl, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch { /* best-effort cleanup */ }
      }
    }

    this.resumableUploads.delete(params.uploadId);

    return {
      etag: undefined, // GCS compose doesn't return an ETag directly
    };
  }

  async abortMultipartUpload(bucketName: string, _key: string, uploadId: string): Promise<void> {
    const uploadState = this.resumableUploads.get(uploadId);
    if (!uploadState) return;

    const credMgr = await this.parent.getCredentialsManager();
    const token = await credMgr.getAccessToken();

    // Delete all staged temp objects
    for (const [_, part] of uploadState.parts) {
      try {
        const delUrl = `https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(part.etag)}`;
        await fetch(delUrl, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* best-effort cleanup */ }
    }

    this.resumableUploads.delete(uploadId);
  }
}

// =============================================================================
// DNS Adapter — wraps GcpDNSManager
// =============================================================================

class GCPDNSAdapter implements DNSAdapter {
  constructor(private parent: GCPProviderAdapter) {}

  async listZones(): Promise<DNSZoneInfo[]> {
    const dns = await this.parent.getDNSManager();
    const zones = await dns.listManagedZones();
    return zones.map((z) => ({
      id: z.name,
      name: z.dnsName,
      type: z.visibility === "private" ? "private" as const : "public" as const,
      nameServers: z.nameServers,
      recordCount: 0,
    }));
  }

  async getZone(zoneId: string): Promise<DNSZoneInfo | null> {
    const dns = await this.parent.getDNSManager();
    try {
      const z = await dns.getManagedZone(zoneId);
      return {
        id: z.name,
        name: z.dnsName,
        type: z.visibility === "private" ? "private" as const : "public" as const,
        nameServers: z.nameServers,
        recordCount: 0,
      };
    } catch {
      return null;
    }
  }

  async createZone(params: CreateDNSZoneParams): Promise<DNSZoneInfo> {
    const dns = await this.parent.getDNSManager();
    // GCP zone names are derived from the DNS name (dots → dashes)
    const zoneName = params.name.replace(/\./g, "-").replace(/-$/, "");
    await dns.createManagedZone({
      name: zoneName,
      dnsName: params.name.endsWith(".") ? params.name : `${params.name}.`,
      description: `Migrated zone for ${params.name}`,
    });
    return {
      id: zoneName,
      name: params.name,
      type: params.type ?? "public",
      nameServers: [],
      recordCount: 0,
    };
  }

  async deleteZone(zoneId: string): Promise<void> {
    const dns = await this.parent.getDNSManager();
    await dns.deleteManagedZone(zoneId);
  }

  async listRecords(zoneId: string): Promise<NormalizedDNSRecord[]> {
    const dns = await this.parent.getDNSManager();
    const records = await dns.listRecordSets(zoneId);
    return records.map((r) => ({
      name: r.name,
      type: r.type as NormalizedDNSRecord["type"],
      ttl: r.ttl,
      values: r.rrdatas,
      provider: "gcp" as const,
    }));
  }

  async createRecord(zoneId: string, record: NormalizedDNSRecord): Promise<void> {
    const dns = await this.parent.getDNSManager();
    await dns.createRecordSet(zoneId, {
      name: record.name.endsWith(".") ? record.name : `${record.name}.`,
      type: record.type,
      ttl: record.ttl,
      rrdatas: record.values,
    });
  }

  async updateRecord(zoneId: string, record: NormalizedDNSRecord): Promise<void> {
    // GCP Cloud DNS: delete the old record set and recreate with new values
    const dns = await this.parent.getDNSManager();
    try {
      await dns.deleteRecordSet(
        zoneId,
        record.name.endsWith(".") ? record.name : `${record.name}.`,
        record.type,
      );
    } catch {
      // If the record doesn't exist, deletion may fail — continue to create
    }
    await dns.createRecordSet(zoneId, {
      name: record.name.endsWith(".") ? record.name : `${record.name}.`,
      type: record.type,
      ttl: record.ttl,
      rrdatas: record.values,
    });
  }

  async deleteRecord(zoneId: string, recordName: string, recordType: string): Promise<void> {
    const dns = await this.parent.getDNSManager();
    await dns.deleteRecordSet(zoneId, recordName, recordType);
  }
}

// =============================================================================
// Network Adapter — wraps GcpNetworkManager
// =============================================================================

class GCPNetworkAdapter implements NetworkAdapter {
  constructor(private parent: GCPProviderAdapter) {}

  async listVPCs(region?: string): Promise<NetworkVPCInfo[]> {
    const network = await this.parent.getNetworkManager();
    const networks = await network.listNetworks();
    // GCP VPC networks are global; we return all of them
    return networks.map((n) => ({
      id: n.name,
      name: n.name,
      cidrBlocks: [],
      region: "global",
      subnets: [],
      tags: {},
    }));
  }

  async listSubnets(vpcId?: string, region?: string): Promise<NetworkSubnetInfo[]> {
    const network = await this.parent.getNetworkManager();
    const subnets = await network.listSubnetworks(region ? { region } : undefined);

    const filtered = vpcId
      ? subnets.filter((s) => s.network === vpcId)
      : subnets;

    return filtered.map((s) => ({
      id: s.name,
      name: s.name,
      cidrBlock: s.ipCidrRange,
      availabilityZone: s.region,
      public: false,
    }));
  }

  async listSecurityGroups(region?: string): Promise<SecurityGroupInfo[]> {
    // GCP uses firewall rules instead of security groups
    const network = await this.parent.getNetworkManager();
    const rules = await network.listFirewallRules();

    return rules.map((rule) => ({
      id: rule.name,
      name: rule.name,
      description: `${rule.direction} rule, priority ${rule.priority}`,
      vpcId: rule.network,
      rules: rule.allowed.map((a) => ({
        id: `${rule.name}-${a.IPProtocol}`,
        name: `${rule.name}-${a.IPProtocol}`,
        direction: rule.direction === "INGRESS" ? "inbound" as const : "outbound" as const,
        action: "allow" as const,
        protocol: a.IPProtocol as "tcp" | "udp" | "icmp" | "*",
        portRange: {
          from: a.ports?.[0] ? parseInt(a.ports[0]) : -1,
          to: a.ports?.[a.ports.length - 1] ? parseInt(a.ports[a.ports.length - 1]!) : -1,
        },
        source: { type: "cidr" as const, value: rule.sourceRanges[0] ?? "0.0.0.0/0" },
        destination: { type: "any" as const, value: "*" },
        priority: rule.priority,
      })),
      tags: {},
    }));
  }

  async createSecurityGroup(params: CreateSecurityGroupParams): Promise<SecurityGroupInfo> {
    // Create a firewall rule in GCP
    const network = await this.parent.getNetworkManager();
    const ruleName = params.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    await network.createFirewallRule(ruleName, {
      network: params.vpcId ? `global/networks/${params.vpcId}` : "global/networks/default",
      direction: "INGRESS",
      priority: 1000,
      allowed: [{ IPProtocol: "tcp" }],
      sourceRanges: ["0.0.0.0/0"],
      description: params.description,
    });

    return {
      id: ruleName,
      name: ruleName,
      description: params.description,
      vpcId: params.vpcId || "default",
      rules: [],
      tags: params.tags,
    };
  }

  async deleteSecurityGroup(groupId: string, _region?: string): Promise<void> {
    const network = await this.parent.getNetworkManager();
    await network.deleteFirewallRule(groupId);
  }

  async addSecurityRules(
    groupId: string,
    rules: NormalizedSecurityRule[],
    _region?: string,
  ): Promise<void> {
    // GCP: Each firewall rule is an independent resource, so we create new rules
    // for each security rule added. The groupId here acts as a prefix.
    const network = await this.parent.getNetworkManager();

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const ruleName = `${groupId}-rule-${i}-${Date.now()}`;
      await network.createFirewallRule(ruleName, {
        network: "global/networks/default",
        direction: rule.direction === "inbound" ? "INGRESS" : "EGRESS",
        priority: rule.priority ?? 1000,
        allowed: [
          {
            IPProtocol: rule.protocol || "tcp",
            ports: rule.portRange ? [`${rule.portRange.from}-${rule.portRange.to}`] : undefined,
          },
        ],
        sourceRanges: rule.direction === "inbound" && rule.source
          ? [rule.source.value]
          : undefined,
      });
    }
  }

  async listLoadBalancers(region?: string): Promise<LoadBalancerInfo[]> {
    const network = await this.parent.getNetworkManager();
    const lbs = await network.listLoadBalancers();
    return lbs.map((lb) => ({
      id: lb.name,
      name: lb.name,
      type: lb.scheme === "EXTERNAL" ? "application" as const : "network" as const,
      scheme: lb.scheme === "EXTERNAL" ? "external" as const : "internal" as const,
      dnsName: lb.ipAddress,
    }));
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a GCP provider adapter from credential configuration.
 */
export function createGCPAdapter(config: GCPCredentialConfig): GCPProviderAdapter {
  return new GCPProviderAdapter(config);
}
