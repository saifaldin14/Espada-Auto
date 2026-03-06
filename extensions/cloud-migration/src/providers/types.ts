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
  NormalizedIAMRole,
  NormalizedIAMPolicy,
  NormalizedSecret,
  NormalizedKMSKey,
  NormalizedLambdaFunction,
  NormalizedAPIGateway,
  NormalizedContainerService,
  NormalizedContainerRegistry,
  NormalizedQueue,
  NormalizedNotificationTopic,
  NormalizedCDN,
  NormalizedCertificate,
  NormalizedWAFRule,
  NormalizedNoSQLDatabase,
  NormalizedCacheCluster,
  NormalizedAutoScalingGroup,
  NormalizedLoadBalancer,
  NormalizedVPCResource,
  NormalizedStepFunction,
  NormalizedEventBus,
  NormalizedFileSystem,
  NormalizedTransitGateway,
  NormalizedVPNConnection,
  NormalizedVPCEndpoint,
  NormalizedParameter,
  NormalizedIAMUser,
  NormalizedIAMGroup,
  NormalizedIdentityProvider,
  NormalizedLogGroup,
  NormalizedAlarm,
  NormalizedDataPipeline,
  NormalizedStream,
  NormalizedGraphDatabase,
  NormalizedDataWarehouse,
  NormalizedBucketPolicy,
  NormalizedListenerRule,
  NormalizedNetworkACL,
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

  /** IAM / Identity operations (roles, policies). Optional — not all providers expose this. */
  readonly iam?: IAMAdapter;

  /** Secrets management operations. Optional. */
  readonly secrets?: SecretsAdapter;

  /** Container orchestration operations (ECS/EKS/AKS/GKE). Optional. */
  readonly containers?: ContainerAdapter;

  /** Serverless / FaaS operations (Lambda/Functions/Cloud Functions). Optional. */
  readonly serverless?: ServerlessAdapter;

  /** Messaging operations (queues, topics). Optional. */
  readonly messaging?: MessagingAdapter;

  /** CDN / Edge operations. Optional. */
  readonly cdn?: CDNAdapter;

  /** Orchestration / workflow operations (Step Functions / EventBridge). Optional. */
  readonly orchestration?: OrchestrationAdapter;

  /** Shared file storage operations (EFS / Azure Files / Filestore). Optional. */
  readonly fileStorage?: FileStorageAdapter;

  /** Monitoring and observability operations (CloudWatch / Azure Monitor / Stackdriver). Optional. */
  readonly monitoring?: MonitoringAdapter;

  /** Analytics / data pipeline operations (Glue / Kinesis / Redshift / Neptune). Optional. */
  readonly analytics?: AnalyticsAdapter;

  /** Configuration management (Parameter Store / App Configuration). Optional. */
  readonly configuration?: ConfigurationAdapter;

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
// IAM Adapter
// =============================================================================

export interface IAMAdapter {
  /** List all IAM roles in the account. */
  listRoles(): Promise<NormalizedIAMRole[]>;

  /** List all IAM policies (customer-managed). */
  listPolicies(): Promise<NormalizedIAMPolicy[]>;

  /** Create an IAM role equivalent on the target provider. */
  createRole(role: NormalizedIAMRole): Promise<{ id: string; arn?: string }>;

  /** Create an IAM policy equivalent. */
  createPolicy(policy: NormalizedIAMPolicy): Promise<{ id: string; arn?: string }>;

  /** Attach a policy to a role. */
  attachPolicy(roleId: string, policyId: string): Promise<void>;

  /** Delete an IAM role (for rollback). */
  deleteRole(roleId: string): Promise<void>;

  /** Delete an IAM policy (for rollback). */
  deletePolicy(policyId: string): Promise<void>;
}

// =============================================================================
// Secrets Adapter
// =============================================================================

export interface SecretsAdapter {
  /** List all secrets. */
  listSecrets(): Promise<NormalizedSecret[]>;

  /** Get a secret value (runtime only, not serialized). */
  getSecretValue(secretId: string): Promise<{ value: string; versionId?: string }>;

  /** Create a secret on the target. */
  createSecret(secret: NormalizedSecret, value: string): Promise<{ id: string }>;

  /** Delete a secret (for rollback). */
  deleteSecret(secretId: string): Promise<void>;

  /** List KMS keys. */
  listKMSKeys(): Promise<NormalizedKMSKey[]>;

  /** Create a KMS key equivalent (key material is NOT transferred). */
  createKMSKey(key: NormalizedKMSKey): Promise<{ id: string; arn?: string }>;
}

// =============================================================================
// Container Adapter
// =============================================================================

export interface ContainerAdapter {
  /** List container services/clusters. */
  listServices(): Promise<NormalizedContainerService[]>;

  /** List container registries. */
  listRegistries(): Promise<NormalizedContainerRegistry[]>;

  /** Create a container service/cluster equivalent. */
  createService(service: NormalizedContainerService): Promise<{ id: string; endpoint?: string }>;

  /** Create a container registry. */
  createRegistry(name: string, region: string): Promise<{ id: string; uri: string }>;

  /** Copy an image between registries. */
  copyImage(sourceUri: string, targetRegistryUri: string, targetTag: string): Promise<{ digest: string }>;

  /** Delete a container service (rollback). */
  deleteService(serviceId: string): Promise<void>;

  /** Delete a container registry (rollback). */
  deleteRegistry(registryId: string): Promise<void>;

  /** List auto-scaling groups. */
  listAutoScalingGroups(region?: string): Promise<NormalizedAutoScalingGroup[]>;

  /** Create an auto-scaling group equivalent. */
  createAutoScalingGroup(group: NormalizedAutoScalingGroup): Promise<{ id: string }>;
}

// =============================================================================
// Serverless Adapter
// =============================================================================

export interface ServerlessAdapter {
  /** List Lambda/Cloud Functions. */
  listFunctions(): Promise<NormalizedLambdaFunction[]>;

  /** List API Gateways. */
  listAPIGateways(): Promise<NormalizedAPIGateway[]>;

  /** Deploy a function on the target provider. */
  deployFunction(fn: NormalizedLambdaFunction, codePackage: Buffer): Promise<{ id: string; arn?: string }>;

  /** Create an API Gateway equivalent. */
  createAPIGateway(gw: NormalizedAPIGateway): Promise<{ id: string; endpoint: string }>;

  /** Download function code from source. */
  getFunctionCode(functionId: string): Promise<Buffer>;

  /** Delete a function (rollback). */
  deleteFunction(functionId: string): Promise<void>;

  /** Delete an API Gateway (rollback). */
  deleteAPIGateway(gatewayId: string): Promise<void>;
}

// =============================================================================
// Messaging Adapter
// =============================================================================

export interface MessagingAdapter {
  /** List queues. */
  listQueues(): Promise<NormalizedQueue[]>;

  /** List topics. */
  listTopics(): Promise<NormalizedNotificationTopic[]>;

  /** Create a queue. */
  createQueue(queue: NormalizedQueue): Promise<{ id: string; url: string }>;

  /** Create a topic. */
  createTopic(topic: NormalizedNotificationTopic): Promise<{ id: string; arn?: string }>;

  /** Delete a queue (rollback). */
  deleteQueue(queueId: string): Promise<void>;

  /** Delete a topic (rollback). */
  deleteTopic(topicId: string): Promise<void>;
}

// =============================================================================
// CDN Adapter
// =============================================================================

export interface CDNAdapter {
  /** List CDN distributions. */
  listDistributions(): Promise<NormalizedCDN[]>;

  /** List certificates. */
  listCertificates(): Promise<NormalizedCertificate[]>;

  /** List WAF rule sets. */
  listWAFRules(): Promise<NormalizedWAFRule[]>;

  /** Create a CDN distribution. */
  createDistribution(cdn: NormalizedCDN): Promise<{ id: string; domainName: string }>;

  /** Import a certificate. */
  importCertificate(cert: NormalizedCertificate, privateKey: string, chain: string): Promise<{ id: string; arn?: string }>;

  /** Create a WAF rule set. */
  createWAFRule(rule: NormalizedWAFRule): Promise<{ id: string }>;

  /** Delete a CDN distribution (rollback). */
  deleteDistribution(distributionId: string): Promise<void>;

  /** Delete a certificate (rollback). */
  deleteCertificate(certId: string): Promise<void>;

  /** Delete a WAF rule set (rollback). */
  deleteWAFRule(ruleId: string): Promise<void>;

  /** List NoSQL databases. */
  listNoSQLDatabases?(): Promise<NormalizedNoSQLDatabase[]>;

  /** List cache clusters. */
  listCacheClusters?(): Promise<NormalizedCacheCluster[]>;
}

// =============================================================================
// Extended Network Adapter (VPC/Subnet/RouteTable/LB creation)
// =============================================================================

export interface ExtendedNetworkAdapter extends NetworkAdapter {
  /** Create a VPC/VNet. */
  createVPC(params: CreateVPCParams): Promise<NetworkVPCInfo>;

  /** Create a subnet. */
  createSubnet(params: CreateSubnetParams): Promise<NetworkSubnetInfo>;

  /** Create a route table. */
  createRouteTable(params: CreateRouteTableParams): Promise<{ id: string }>;

  /** Create a load balancer. */
  createLoadBalancer(params: CreateLoadBalancerParams): Promise<LoadBalancerInfo>;

  /** Delete a VPC (rollback). */
  deleteVPC(vpcId: string, region?: string): Promise<void>;

  /** Delete a subnet (rollback). */
  deleteSubnet(subnetId: string, region?: string): Promise<void>;

  /** Delete a load balancer (rollback). */
  deleteLoadBalancer(lbId: string, region?: string): Promise<void>;

  /** Create transit gateway. */
  createTransitGateway(tgw: NormalizedTransitGateway): Promise<{ id: string }>;

  /** Delete a transit gateway (rollback). */
  deleteTransitGateway(tgwId: string, region?: string): Promise<void>;

  /** Create a VPN connection. */
  createVPNConnection(vpn: NormalizedVPNConnection): Promise<{ id: string }>;

  /** Delete a VPN connection (rollback). */
  deleteVPNConnection(vpnId: string, region?: string): Promise<void>;

  /** Create a VPC endpoint. */
  createVPCEndpoint(endpoint: NormalizedVPCEndpoint): Promise<{ id: string }>;

  /** Delete a VPC endpoint (rollback). */
  deleteVPCEndpoint(endpointId: string, region?: string): Promise<void>;

  /** Create a network ACL. */
  createNetworkACL(nacl: NormalizedNetworkACL): Promise<{ id: string }>;

  /** Delete a network ACL (rollback). */
  deleteNetworkACL(naclId: string, region?: string): Promise<void>;

  /** Create listener rules on a load balancer. */
  createListenerRules(listenerArn: string, rules: NormalizedListenerRule[]): Promise<Array<{ id: string }>>;

  /** Delete listener rules (rollback). */
  deleteListenerRules(ruleIds: string[]): Promise<void>;

  /** List transit gateways. */
  listTransitGateways(region?: string): Promise<NormalizedTransitGateway[]>;

  /** List VPN connections. */
  listVPNConnections(region?: string): Promise<NormalizedVPNConnection[]>;

  /** List VPC endpoints. */
  listVPCEndpoints(region?: string): Promise<NormalizedVPCEndpoint[]>;

  /** List network ACLs. */
  listNetworkACLs(region?: string): Promise<NormalizedNetworkACL[]>;
}

export interface CreateVPCParams {
  name: string;
  cidrBlock: string;
  region: string;
  enableDnsHostnames?: boolean;
  enableInternetGateway?: boolean;
  tags?: Record<string, string>;
}

export interface CreateSubnetParams {
  vpcId: string;
  name: string;
  cidrBlock: string;
  availabilityZone: string;
  public?: boolean;
  tags?: Record<string, string>;
}

export interface CreateRouteTableParams {
  vpcId: string;
  name: string;
  routes: Array<{ destination: string; target: string }>;
  tags?: Record<string, string>;
}

export interface CreateLoadBalancerParams {
  name: string;
  type: "application" | "network";
  scheme: "internal" | "external";
  vpcId?: string;
  subnetIds: string[];
  listeners: Array<{
    port: number;
    protocol: "HTTP" | "HTTPS" | "TCP" | "TLS";
    targetPort: number;
    certificateArn?: string;
  }>;
  tags?: Record<string, string>;
}

// =============================================================================
// Orchestration Adapter (Step Functions / EventBridge)
// =============================================================================

export interface OrchestrationAdapter {
  /** List step functions / workflow state machines. */
  listStepFunctions(): Promise<NormalizedStepFunction[]>;

  /** List event buses. */
  listEventBuses(): Promise<NormalizedEventBus[]>;

  /** Create a step function / workflow. */
  createStepFunction(sf: NormalizedStepFunction): Promise<{ id: string; arn?: string }>;

  /** Create an event bus. */
  createEventBus(bus: NormalizedEventBus): Promise<{ id: string; arn?: string }>;

  /** Replicate event bus rules onto a target bus. */
  createEventRules(busId: string, rules: NormalizedEventBus["rules"]): Promise<Array<{ id: string }>>;

  /** Delete a step function (rollback). */
  deleteStepFunction(sfId: string): Promise<void>;

  /** Delete an event bus (rollback). */
  deleteEventBus(busId: string): Promise<void>;
}

// =============================================================================
// File Storage Adapter (EFS / Azure Files / Filestore)
// =============================================================================

export interface FileStorageAdapter {
  /** List shared file systems. */
  listFileSystems(region?: string): Promise<NormalizedFileSystem[]>;

  /** Create a shared file system. */
  createFileSystem(fs: NormalizedFileSystem): Promise<{ id: string; dnsName?: string }>;

  /** Create mount targets in subnets. */
  createMountTargets(fsId: string, targets: NormalizedFileSystem["mountTargets"]): Promise<Array<{ id: string }>>;

  /** Sync files from source FS to target FS. */
  syncFiles(sourcePath: string, targetFsId: string, targetPath: string): Promise<{ filesCopied: number; bytesTransferred: number }>;

  /** Delete a file system (rollback). */
  deleteFileSystem(fsId: string, region?: string): Promise<void>;
}

// =============================================================================
// Monitoring Adapter (CloudWatch / Azure Monitor / Stackdriver)
// =============================================================================

export interface MonitoringAdapter {
  /** List log groups. */
  listLogGroups(): Promise<NormalizedLogGroup[]>;

  /** List alarms. */
  listAlarms(): Promise<NormalizedAlarm[]>;

  /** Create a log group. */
  createLogGroup(lg: NormalizedLogGroup): Promise<{ id: string }>;

  /** Create subscription filters on a log group. */
  createSubscriptionFilters(logGroupId: string, filters: NormalizedLogGroup["subscriptionFilters"]): Promise<void>;

  /** Create metric filters on a log group. */
  createMetricFilters(logGroupId: string, filters: NormalizedLogGroup["metricFilters"]): Promise<void>;

  /** Create an alarm. */
  createAlarm(alarm: NormalizedAlarm): Promise<{ id: string }>;

  /** Delete a log group (rollback). */
  deleteLogGroup(logGroupId: string): Promise<void>;

  /** Delete an alarm (rollback). */
  deleteAlarm(alarmId: string): Promise<void>;
}

// =============================================================================
// Analytics Adapter (Glue / Kinesis / Redshift / Neptune)
// =============================================================================

export interface AnalyticsAdapter {
  /** List data pipelines (Glue jobs / Data Factory / Dataflow). */
  listDataPipelines(): Promise<NormalizedDataPipeline[]>;

  /** List real-time streams (Kinesis / Event Hubs / Pub/Sub). */
  listStreams(): Promise<NormalizedStream[]>;

  /** List graph databases (Neptune / Cosmos Gremlin). */
  listGraphDatabases(): Promise<NormalizedGraphDatabase[]>;

  /** List data warehouses (Redshift / Synapse / BigQuery). */
  listDataWarehouses(): Promise<NormalizedDataWarehouse[]>;

  /** Create a data pipeline. */
  createDataPipeline(pipeline: NormalizedDataPipeline): Promise<{ id: string }>;

  /** Create a real-time stream. */
  createStream(stream: NormalizedStream): Promise<{ id: string; arn?: string }>;

  /** Create a graph database cluster. */
  createGraphDatabase(db: NormalizedGraphDatabase): Promise<{ id: string; endpoint: string }>;

  /** Create a data warehouse cluster. */
  createDataWarehouse(dw: NormalizedDataWarehouse): Promise<{ id: string; endpoint: string }>;

  /** Export graph database data (dump). */
  exportGraphData(dbId: string, format: "nquads" | "csv" | "neptune-csv"): Promise<{ exportPath: string; sizeBytes: number }>;

  /** Import graph database data. */
  importGraphData(dbId: string, sourcePath: string, format: "nquads" | "csv" | "neptune-csv"): Promise<{ importedTriples: number }>;

  /** Export data warehouse schemas and data. */
  exportWarehouseData(dwId: string): Promise<{ exportPath: string; sizeBytes: number; tableCount: number }>;

  /** Import data warehouse schemas and data. */
  importWarehouseData(dwId: string, sourcePath: string): Promise<{ importedTables: number }>;

  /** Delete a data pipeline (rollback). */
  deleteDataPipeline(pipelineId: string): Promise<void>;

  /** Delete a stream (rollback). */
  deleteStream(streamId: string): Promise<void>;

  /** Delete a graph database (rollback). */
  deleteGraphDatabase(dbId: string): Promise<void>;

  /** Delete a data warehouse (rollback). */
  deleteDataWarehouse(dwId: string): Promise<void>;
}

// =============================================================================
// Configuration Adapter (Parameter Store / App Configuration)
// =============================================================================

export interface ConfigurationAdapter {
  /** List all parameters. */
  listParameters(): Promise<NormalizedParameter[]>;

  /** Get a parameter value (resolved at runtime). */
  getParameterValue(paramId: string): Promise<{ value: string; type: string }>;

  /** Create a parameter. */
  createParameter(param: NormalizedParameter, value: string): Promise<{ id: string; version: number }>;

  /** Delete a parameter (rollback). */
  deleteParameter(paramId: string): Promise<void>;
}

// =============================================================================
// Advanced IAM Adapter (Users, Groups, Identity Providers)
// =============================================================================

export interface AdvancedIAMAdapter extends IAMAdapter {
  /** List IAM users. */
  listUsers(): Promise<NormalizedIAMUser[]>;

  /** List IAM groups. */
  listGroups(): Promise<NormalizedIAMGroup[]>;

  /** List identity providers (SAML/OIDC/Cognito). */
  listIdentityProviders(): Promise<NormalizedIdentityProvider[]>;

  /** Create an IAM user. */
  createUser(user: NormalizedIAMUser): Promise<{ id: string; arn?: string }>;

  /** Create an IAM group. */
  createGroup(group: NormalizedIAMGroup): Promise<{ id: string; arn?: string }>;

  /** Add a user to a group. */
  addUserToGroup(userId: string, groupId: string): Promise<void>;

  /** Create an identity provider (SAML/OIDC). */
  createIdentityProvider(idp: NormalizedIdentityProvider): Promise<{ id: string; arn?: string }>;

  /** Delete an IAM user (rollback). */
  deleteUser(userId: string): Promise<void>;

  /** Delete an IAM group (rollback). */
  deleteGroup(groupId: string): Promise<void>;

  /** Delete an identity provider (rollback). */
  deleteIdentityProvider(idpId: string): Promise<void>;

  /** List bucket/resource policies. */
  listBucketPolicies(): Promise<NormalizedBucketPolicy[]>;

  /** Apply a bucket policy on the target. */
  applyBucketPolicy(policy: NormalizedBucketPolicy): Promise<void>;
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
  | GCPCredentialConfig
  | VMwareCredentialConfig
  | NutanixCredentialConfig
  | OnPremCredentialConfig;

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

export interface VMwareCredentialConfig {
  provider: "vmware";
  vcenterHost: string;
  username: string;
  authType: "password" | "certificate";
  password?: string;
  certificatePath?: string;
  datacenter?: string;
  cluster?: string;
  insecure?: boolean;
  /** On-prem migration agent endpoint for snapshot/export operations. */
  agentEndpoint?: {
    host: string;
    port: number;
    protocol: "https" | "grpc";
    apiKey: string;
    tlsVerify?: boolean;
  };
  /** S3-compatible storage endpoint for staging (e.g., MinIO). */
  stagingStorage?: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    region?: string;
    forcePathStyle?: boolean;
  };
}

export interface NutanixCredentialConfig {
  provider: "nutanix";
  prismHost: string;
  port?: number;
  username: string;
  authType: "password" | "certificate";
  password?: string;
  certificatePath?: string;
  clusterUuid?: string;
  insecure?: boolean;
  /** On-prem migration agent endpoint. */
  agentEndpoint?: {
    host: string;
    port: number;
    protocol: "https" | "grpc";
    apiKey: string;
    tlsVerify?: boolean;
  };
  /** S3-compatible storage endpoint for staging (Nutanix Objects or MinIO). */
  stagingStorage?: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    region?: string;
    forcePathStyle?: boolean;
  };
}

export interface OnPremCredentialConfig {
  provider: "on-premises";
  platform: "kvm" | "hyper-v" | "generic";
  /** On-prem migration agent endpoint (required for all on-prem operations). */
  agentEndpoint: {
    host: string;
    port: number;
    protocol: "https" | "grpc";
    apiKey: string;
    tlsVerify?: boolean;
  };
  /** S3-compatible storage endpoint for staging (MinIO, Ceph, etc.). */
  stagingStorage?: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    region?: string;
    forcePathStyle?: boolean;
  };
}

/**
 * Factory function type for creating a provider adapter.
 */
export type ProviderAdapterFactory = (config: ProviderCredentialConfig) => Promise<CloudProviderAdapter>;
