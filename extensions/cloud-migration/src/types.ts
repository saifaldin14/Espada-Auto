/**
 * Cross-Cloud Migration Engine — Core Type System
 *
 * All domain types for the migration engine, modeled after:
 * - LifecyclePhase/LifecycleIncident from incident-lifecycle
 * - ExecutionPlan/PlanStep/StepHandler from Azure orchestration
 * - CloudProvider from hybrid-cloud
 * - InfrastructureResourceType from infrastructure framework
 */

// =============================================================================
// Provider & Resource Types
// =============================================================================

/** Supported migration providers. */
export type MigrationProvider =
  | "aws"
  | "azure"
  | "gcp"
  | "on-premises"
  | "vmware"
  | "nutanix";

/** Resource types the migration engine can handle. */
export type MigrationResourceType =
  | "vm"
  | "disk"
  | "object-storage"
  | "database"
  | "dns"
  | "security-rules"
  | "load-balancer"
  // Enterprise resource types
  | "iam-role"
  | "iam-policy"
  | "secret"
  | "kms-key"
  | "lambda-function"
  | "api-gateway"
  | "container-service"
  | "container-registry"
  | "vpc"
  | "subnet"
  | "route-table"
  | "queue"
  | "notification-topic"
  | "cdn"
  | "certificate"
  | "waf-rule"
  | "nosql-database"
  | "cache"
  | "auto-scaling-group"
  // Full-estate enterprise resource types
  | "step-function"
  | "event-bus"
  | "file-system"
  | "transit-gateway"
  | "vpn-connection"
  | "vpc-endpoint"
  | "parameter-store"
  | "iam-user"
  | "iam-group"
  | "identity-provider"
  | "log-group"
  | "alarm"
  | "data-pipeline"
  | "stream"
  | "graph-database"
  | "data-warehouse"
  | "bucket-policy"
  | "listener-rule"
  | "network-acl";

/** A specific migration direction. */
export type MigrationDirection = {
  source: MigrationProvider;
  target: MigrationProvider;
};

// =============================================================================
// Migration Phase State Machine
// =============================================================================

/**
 * State machine phases for a migration job.
 *
 * ```
 * created → assessing → planning → awaiting-approval → executing → verifying → cutting-over → completed
 *                                                          │                        │
 *                                                     rolling-back            rolled-back
 *                                                          │
 *                                                        failed
 * ```
 */
export type MigrationPhase =
  | "created"
  | "assessing"
  | "planning"
  | "awaiting-approval"
  | "executing"
  | "verifying"
  | "cutting-over"
  | "completed"
  | "rolling-back"
  | "rolled-back"
  | "failed";

/** Valid transitions: phase → allowed next phases. */
export const MIGRATION_PHASE_TRANSITIONS: Record<MigrationPhase, MigrationPhase[]> = {
  created: ["assessing"],
  assessing: ["planning", "failed"],
  planning: ["awaiting-approval", "failed"],
  "awaiting-approval": ["executing", "failed"],
  executing: ["verifying", "rolling-back", "failed"],
  verifying: ["cutting-over", "rolling-back", "failed"],
  "cutting-over": ["completed", "rolling-back", "failed"],
  completed: [],
  "rolling-back": ["rolled-back", "failed"],
  "rolled-back": [],
  failed: [],
};

/** Priority ordering for phase — lower = earlier in lifecycle. */
export const MIGRATION_PHASE_ORDER: Record<MigrationPhase, number> = {
  created: 0,
  assessing: 1,
  planning: 2,
  "awaiting-approval": 3,
  executing: 4,
  verifying: 5,
  "cutting-over": 6,
  completed: 7,
  "rolling-back": 8,
  "rolled-back": 9,
  failed: 10,
};

// =============================================================================
// Normalized Resource Types (Provider-Agnostic)
// =============================================================================

/** Provider-agnostic VM representation. */
export type NormalizedVM = {
  id: string;
  name: string;
  provider: MigrationProvider;
  region: string;
  zone?: string;
  cpuCores: number;
  memoryGB: number;
  osType: "linux" | "windows" | "unknown";
  osDistro?: string;
  architecture: "x86_64" | "arm64";
  disks: NormalizedDisk[];
  networkInterfaces: NormalizedNetworkInterface[];
  tags: Record<string, string>;
  /** Original provider-specific data for reference. */
  raw?: Record<string, unknown>;
};

/** Provider-agnostic disk/volume representation. */
export type NormalizedDisk = {
  id: string;
  name: string;
  sizeGB: number;
  type: "ssd" | "hdd" | "nvme" | "standard";
  iops?: number;
  throughputMBps?: number;
  encrypted: boolean;
  isBootDisk: boolean;
  devicePath?: string;
  snapshotId?: string;
};

/** Provider-agnostic network interface. */
export type NormalizedNetworkInterface = {
  id: string;
  privateIp: string;
  publicIp?: string;
  subnetId?: string;
  securityGroupIds: string[];
  macAddress?: string;
};

/** Provider-agnostic object storage bucket. */
export type NormalizedBucket = {
  id: string;
  name: string;
  provider: MigrationProvider;
  region: string;
  objectCount: number;
  totalSizeBytes: number;
  versioning: boolean;
  encryption: BucketEncryption;
  lifecycleRules: LifecycleRule[];
  tags: Record<string, string>;
  raw?: Record<string, unknown>;
};

export type BucketEncryption = {
  enabled: boolean;
  type: "provider-managed" | "customer-managed" | "none";
  keyId?: string;
};

export type LifecycleRule = {
  id: string;
  prefix: string;
  enabled: boolean;
  transitions: Array<{ days: number; storageClass: string }>;
  expiration?: { days: number };
};

/** Provider-agnostic object within a bucket. */
export type NormalizedObject = {
  key: string;
  sizeBytes: number;
  lastModified: string;
  etag?: string;
  sha256?: string;
  storageClass: string;
  contentType?: string;
  metadata: Record<string, string>;
};

/** Provider-agnostic security/firewall rule. */
export type NormalizedSecurityRule = {
  id: string;
  name: string;
  direction: "inbound" | "outbound";
  action: "allow" | "deny";
  protocol: "tcp" | "udp" | "icmp" | "*";
  portRange: { from: number; to: number };
  source: SecurityEndpoint;
  destination: SecurityEndpoint;
  priority: number;
  description?: string;
};

export type SecurityEndpoint = {
  type: "cidr" | "security-group" | "tag" | "service-tag" | "any";
  value: string;
};

/** Provider-agnostic DNS record. */
export type NormalizedDNSRecord = {
  name: string;
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SRV" | "PTR";
  ttl: number;
  values: string[];
  weight?: number;
  healthCheckId?: string;
};

// =============================================================================
// Normalized Enterprise Resource Types (IAM, Secrets, Containers, Serverless)
// =============================================================================

/** Provider-agnostic IAM role. */
export type NormalizedIAMRole = {
  id: string;
  name: string;
  provider: MigrationProvider;
  arn?: string;
  description?: string;
  trustPolicy?: Record<string, unknown>;
  inlinePolicies: NormalizedIAMPolicy[];
  attachedPolicyArns: string[];
  tags: Record<string, string>;
};

/** Provider-agnostic IAM policy. */
export type NormalizedIAMPolicy = {
  id: string;
  name: string;
  provider: MigrationProvider;
  arn?: string;
  description?: string;
  document: Record<string, unknown>;
  isManaged: boolean;
  attachedTo: string[];
  tags: Record<string, string>;
};

/** Provider-agnostic secret. */
export type NormalizedSecret = {
  id: string;
  name: string;
  provider: MigrationProvider;
  description?: string;
  /** The actual value is resolved at runtime, never serialized. */
  valueRef: string;
  rotationEnabled: boolean;
  rotationDays?: number;
  kmsKeyId?: string;
  tags: Record<string, string>;
};

/** Provider-agnostic KMS/encryption key. */
export type NormalizedKMSKey = {
  id: string;
  alias?: string;
  provider: MigrationProvider;
  keyType: "symmetric" | "asymmetric";
  usage: "encrypt-decrypt" | "sign-verify";
  state: "enabled" | "disabled" | "pending-deletion";
  rotationEnabled: boolean;
  /** Key material cannot be transferred; we migrate policy + re-encrypt. */
  policy?: Record<string, unknown>;
  tags: Record<string, string>;
};

/** Provider-agnostic Lambda/Cloud Function. */
export type NormalizedLambdaFunction = {
  id: string;
  name: string;
  provider: MigrationProvider;
  runtime: string;
  handler: string;
  memoryMB: number;
  timeoutSec: number;
  codeUri: string;
  codeSizeBytes: number;
  environment: Record<string, string>;
  layers: string[];
  vpcConfig?: { subnetIds: string[]; securityGroupIds: string[] };
  triggers: Array<{ type: string; sourceArn?: string; config: Record<string, unknown> }>;
  tags: Record<string, string>;
};

/** Provider-agnostic API Gateway. */
export type NormalizedAPIGateway = {
  id: string;
  name: string;
  provider: MigrationProvider;
  type: "rest" | "http" | "websocket";
  endpoint: string;
  routes: Array<{
    path: string;
    method: string;
    integration: string;
    authType?: string;
  }>;
  stages: string[];
  tags: Record<string, string>;
};

/** Provider-agnostic container service (ECS/EKS/AKS/GKE). */
export type NormalizedContainerService = {
  id: string;
  name: string;
  provider: MigrationProvider;
  type: "ecs" | "eks" | "aks" | "gke" | "kubernetes" | "docker-compose";
  region: string;
  clusterArn?: string;
  services: NormalizedContainerServiceDef[];
  nodeGroups: Array<{
    name: string;
    instanceType: string;
    desiredCount: number;
    minCount: number;
    maxCount: number;
  }>;
  tags: Record<string, string>;
};

export type NormalizedContainerServiceDef = {
  name: string;
  image: string;
  cpu: number;
  memoryMB: number;
  desiredCount: number;
  ports: Array<{ containerPort: number; hostPort?: number; protocol: "tcp" | "udp" }>;
  environment: Record<string, string>;
  healthCheck?: { path: string; intervalSec: number };
};

/** Provider-agnostic container registry (ECR/ACR/GCR/Artifact Registry). */
export type NormalizedContainerRegistry = {
  id: string;
  name: string;
  provider: MigrationProvider;
  uri: string;
  repositories: Array<{
    name: string;
    imageCount: number;
    totalSizeBytes: number;
    tags: string[];
  }>;
  scanOnPush: boolean;
  encryption: boolean;
  tags: Record<string, string>;
};

/** Provider-agnostic VPC for migration purposes. */
export type NormalizedVPCResource = {
  id: string;
  name: string;
  provider: MigrationProvider;
  region: string;
  cidrBlocks: string[];
  subnets: Array<{
    id: string;
    name: string;
    cidrBlock: string;
    availabilityZone: string;
    public: boolean;
  }>;
  routeTables: Array<{
    id: string;
    name: string;
    routes: Array<{ destination: string; target: string }>;
  }>;
  internetGateway: boolean;
  natGateway: boolean;
  tags: Record<string, string>;
};

/** Provider-agnostic load balancer for migration. */
export type NormalizedLoadBalancer = {
  id: string;
  name: string;
  provider: MigrationProvider;
  type: "application" | "network" | "classic" | "gateway";
  scheme: "internal" | "external";
  vpcId?: string;
  listeners: Array<{
    port: number;
    protocol: "HTTP" | "HTTPS" | "TCP" | "UDP" | "TLS";
    targetGroupArn?: string;
    certificateArn?: string;
  }>;
  targetGroups: Array<{
    name: string;
    port: number;
    protocol: string;
    healthCheckPath?: string;
    targets: string[];
  }>;
  tags: Record<string, string>;
};

/** Provider-agnostic message queue (SQS/Azure Queue/Cloud Tasks). */
export type NormalizedQueue = {
  id: string;
  name: string;
  provider: MigrationProvider;
  type: "standard" | "fifo";
  visibilityTimeoutSec: number;
  retentionDays: number;
  delaySeconds: number;
  deadLetterQueue?: string;
  encryption: boolean;
  tags: Record<string, string>;
};

/** Provider-agnostic notification topic (SNS/Event Grid/Pub/Sub). */
export type NormalizedNotificationTopic = {
  id: string;
  name: string;
  provider: MigrationProvider;
  subscriptions: Array<{
    protocol: "email" | "sms" | "https" | "sqs" | "lambda" | "http";
    endpoint: string;
  }>;
  encryption: boolean;
  tags: Record<string, string>;
};

/** Provider-agnostic CDN distribution (CloudFront/Azure CDN/Cloud CDN). */
export type NormalizedCDN = {
  id: string;
  name: string;
  provider: MigrationProvider;
  domainName: string;
  origins: Array<{
    id: string;
    domainName: string;
    originPath?: string;
    protocol: "http-only" | "https-only" | "match-viewer";
  }>;
  certificateArn?: string;
  wafAclId?: string;
  priceClass?: string;
  tags: Record<string, string>;
};

/** Provider-agnostic SSL/TLS certificate. */
export type NormalizedCertificate = {
  id: string;
  domainName: string;
  provider: MigrationProvider;
  subjectAlternativeNames: string[];
  issuer: string;
  status: "issued" | "pending" | "expired" | "revoked";
  notBefore: string;
  notAfter: string;
  type: "imported" | "managed";
  tags: Record<string, string>;
};

/** Provider-agnostic WAF rule set. */
export type NormalizedWAFRule = {
  id: string;
  name: string;
  provider: MigrationProvider;
  rules: Array<{
    name: string;
    priority: number;
    action: "allow" | "block" | "count";
    condition: string;
  }>;
  scope: "regional" | "global";
  associatedResources: string[];
  tags: Record<string, string>;
};

/** Provider-agnostic NoSQL database (DynamoDB/CosmosDB/Firestore/Datastore). */
export type NormalizedNoSQLDatabase = {
  id: string;
  name: string;
  provider: MigrationProvider;
  engine: "dynamodb" | "cosmosdb" | "firestore" | "mongodb" | "cassandra";
  tables: Array<{
    name: string;
    partitionKey: string;
    sortKey?: string;
    itemCount: number;
    sizeBytes: number;
    gsiCount: number;
    streamEnabled: boolean;
  }>;
  region: string;
  encryption: boolean;
  backupEnabled: boolean;
  tags: Record<string, string>;
};

/** Provider-agnostic cache cluster (ElastiCache/Azure Cache/Memorystore). */
export type NormalizedCacheCluster = {
  id: string;
  name: string;
  provider: MigrationProvider;
  engine: "redis" | "memcached";
  version: string;
  nodeType: string;
  nodeCount: number;
  port: number;
  endpoint: string;
  encryption: boolean;
  authEnabled: boolean;
  tags: Record<string, string>;
};

/** Provider-agnostic auto scaling group. */
export type NormalizedAutoScalingGroup = {
  id: string;
  name: string;
  provider: MigrationProvider;
  minSize: number;
  maxSize: number;
  desiredSize: number;
  launchTemplate?: string;
  instanceType: string;
  imageId: string;
  subnetIds: string[];
  targetGroupArns: string[];
  healthCheckType: "ec2" | "elb";
  scalingPolicies: Array<{
    name: string;
    type: "target-tracking" | "step" | "simple";
    metric: string;
    targetValue?: number;
  }>;
  tags: Record<string, string>;
};

// =============================================================================
// Normalized Full-Estate Enterprise Resource Types
// =============================================================================

/** Provider-agnostic Step Functions / workflow state machine. */
export type NormalizedStepFunction = {
  id: string;
  name: string;
  provider: MigrationProvider;
  type: "standard" | "express";
  definition: Record<string, unknown>;
  roleArn?: string;
  loggingConfig?: { level: "ALL" | "ERROR" | "FATAL" | "OFF"; destinationArn?: string };
  tracingEnabled: boolean;
  tags: Record<string, string>;
};

/** Provider-agnostic event bus (EventBridge / Event Grid / Eventarc). */
export type NormalizedEventBus = {
  id: string;
  name: string;
  provider: MigrationProvider;
  isDefault: boolean;
  rules: Array<{
    name: string;
    eventPattern: Record<string, unknown>;
    targets: Array<{ id: string; arn: string; inputTransformer?: Record<string, unknown> }>;
    state: "enabled" | "disabled";
    scheduleExpression?: string;
  }>;
  schemaRegistryArn?: string;
  tags: Record<string, string>;
};

/** Provider-agnostic file system (EFS / Azure Files / Filestore). */
export type NormalizedFileSystem = {
  id: string;
  name: string;
  provider: MigrationProvider;
  type: "nfs" | "smb" | "lustre" | "zfs";
  sizeGB: number;
  throughputMode: "bursting" | "provisioned" | "elastic";
  performanceMode: "general-purpose" | "max-io";
  encrypted: boolean;
  mountTargets: Array<{
    subnetId: string;
    securityGroupIds: string[];
    ipAddress: string;
  }>;
  accessPoints: Array<{
    id: string;
    path: string;
    posixUser?: { uid: number; gid: number };
  }>;
  region: string;
  tags: Record<string, string>;
};

/** Provider-agnostic transit gateway. */
export type NormalizedTransitGateway = {
  id: string;
  name: string;
  provider: MigrationProvider;
  region: string;
  asnNumber: number;
  attachments: Array<{
    id: string;
    type: "vpc" | "vpn" | "direct-connect" | "peering";
    resourceId: string;
    state: "available" | "pending" | "deleting";
  }>;
  routeTables: Array<{
    id: string;
    name: string;
    routes: Array<{ destination: string; attachmentId: string; state: "active" | "blackhole" }>;
  }>;
  tags: Record<string, string>;
};

/** Provider-agnostic VPN connection. */
export type NormalizedVPNConnection = {
  id: string;
  name: string;
  provider: MigrationProvider;
  type: "site-to-site" | "client";
  customerGatewayIp: string;
  customerGatewayAsn?: number;
  tunnels: Array<{
    outsideIp: string;
    insideCidr: string;
    preSharedKey?: string;
    status: "up" | "down";
  }>;
  staticRoutes: string[];
  bgpEnabled: boolean;
  transitGatewayId?: string;
  vpcId?: string;
  tags: Record<string, string>;
};

/** Provider-agnostic VPC endpoint (Private Link / interface/gateway endpoint). */
export type NormalizedVPCEndpoint = {
  id: string;
  name: string;
  provider: MigrationProvider;
  type: "interface" | "gateway";
  serviceName: string;
  vpcId: string;
  subnetIds: string[];
  securityGroupIds: string[];
  privateDnsEnabled: boolean;
  policyDocument?: Record<string, unknown>;
  tags: Record<string, string>;
};

/** Provider-agnostic parameter store entry (SSM Parameter Store / App Configuration / Runtime Configurator). */
export type NormalizedParameter = {
  id: string;
  name: string;
  provider: MigrationProvider;
  type: "string" | "secure-string" | "string-list";
  /** Value reference — secure values resolved at runtime, never serialized. */
  valueRef: string;
  version: number;
  tier: "standard" | "advanced";
  kmsKeyId?: string;
  tags: Record<string, string>;
};

/** Provider-agnostic IAM user. */
export type NormalizedIAMUser = {
  id: string;
  name: string;
  provider: MigrationProvider;
  arn?: string;
  groupIds: string[];
  attachedPolicyArns: string[];
  inlinePolicies: NormalizedIAMPolicy[];
  hasConsoleAccess: boolean;
  hasApiKeys: boolean;
  mfaEnabled: boolean;
  tags: Record<string, string>;
};

/** Provider-agnostic IAM group. */
export type NormalizedIAMGroup = {
  id: string;
  name: string;
  provider: MigrationProvider;
  arn?: string;
  memberUserIds: string[];
  attachedPolicyArns: string[];
  inlinePolicies: NormalizedIAMPolicy[];
};

/** Provider-agnostic identity provider (SSO / Cognito / Identity Center / Azure AD B2C). */
export type NormalizedIdentityProvider = {
  id: string;
  name: string;
  provider: MigrationProvider;
  type: "saml" | "oidc" | "user-pool" | "identity-pool";
  metadataUrl?: string;
  clientIds: string[];
  userCount: number;
  userAttributes: string[];
  mfaConfig: "off" | "optional" | "required";
  customDomain?: string;
  triggers: Array<{ event: string; functionArn: string }>;
  tags: Record<string, string>;
};

/** Provider-agnostic log group. */
export type NormalizedLogGroup = {
  id: string;
  name: string;
  provider: MigrationProvider;
  retentionDays: number;
  storedSizeBytes: number;
  kmsKeyId?: string;
  subscriptionFilters: Array<{
    name: string;
    filterPattern: string;
    destinationArn: string;
  }>;
  metricFilters: Array<{
    name: string;
    filterPattern: string;
    metricName: string;
    metricNamespace: string;
  }>;
  tags: Record<string, string>;
};

/** Provider-agnostic monitoring alarm. */
export type NormalizedAlarm = {
  id: string;
  name: string;
  provider: MigrationProvider;
  metricName: string;
  namespace: string;
  statistic: "Average" | "Sum" | "Minimum" | "Maximum" | "SampleCount" | "p99" | "p95" | "p90";
  threshold: number;
  comparisonOperator: "GreaterThanThreshold" | "LessThanThreshold" | "GreaterThanOrEqualToThreshold" | "LessThanOrEqualToThreshold";
  evaluationPeriods: number;
  periodSec: number;
  actions: string[];
  dimensions: Array<{ name: string; value: string }>;
  tags: Record<string, string>;
};

/** Provider-agnostic data pipeline (Glue jobs / Data Factory / Dataflow). */
export type NormalizedDataPipeline = {
  id: string;
  name: string;
  provider: MigrationProvider;
  type: "etl" | "streaming" | "crawler" | "workflow";
  schedule?: string;
  sourceConnections: Array<{
    type: string;
    connectionString: string;
    database?: string;
    table?: string;
  }>;
  targetConnections: Array<{
    type: string;
    connectionString: string;
    database?: string;
    table?: string;
  }>;
  scriptLocation?: string;
  workerType?: string;
  numberOfWorkers?: number;
  glueVersion?: string;
  tags: Record<string, string>;
};

/** Provider-agnostic real-time stream (Kinesis / Event Hubs / Pub/Sub). */
export type NormalizedStream = {
  id: string;
  name: string;
  provider: MigrationProvider;
  type: "data-stream" | "firehose" | "event-hub";
  shardCount: number;
  retentionHours: number;
  consumers: Array<{
    name: string;
    type: "shared" | "enhanced-fan-out";
    destinationArn?: string;
  }>;
  encryption: boolean;
  tags: Record<string, string>;
};

/** Provider-agnostic graph database (Neptune / Cosmos DB Gremlin / Neo4j). */
export type NormalizedGraphDatabase = {
  id: string;
  name: string;
  provider: MigrationProvider;
  engine: "neptune" | "cosmosdb-gremlin" | "neo4j" | "janusgraph";
  queryLanguages: Array<"gremlin" | "sparql" | "opencypher">;
  instanceClass: string;
  storageGB: number;
  encrypted: boolean;
  clusterMode: boolean;
  replicaCount: number;
  tags: Record<string, string>;
};

/** Provider-agnostic data warehouse (Redshift / Synapse / BigQuery). */
export type NormalizedDataWarehouse = {
  id: string;
  name: string;
  provider: MigrationProvider;
  engine: "redshift" | "synapse" | "bigquery" | "snowflake";
  nodeType: string;
  nodeCount: number;
  storageGB: number;
  encrypted: boolean;
  databases: Array<{
    name: string;
    schemas: string[];
    tableCounts: number;
    totalSizeGB: number;
  }>;
  tags: Record<string, string>;
};

/** Provider-agnostic bucket/resource policy. */
export type NormalizedBucketPolicy = {
  id: string;
  bucketName: string;
  provider: MigrationProvider;
  policy: Record<string, unknown>;
  publicAccessBlock: {
    blockPublicAcls: boolean;
    ignorePublicAcls: boolean;
    blockPublicPolicy: boolean;
    restrictPublicBuckets: boolean;
  };
  corsRules: Array<{
    allowedOrigins: string[];
    allowedMethods: string[];
    allowedHeaders: string[];
    maxAgeSeconds: number;
  }>;
  eventNotifications: Array<{
    event: string;
    targetType: "lambda" | "sqs" | "sns" | "eventbridge";
    targetArn: string;
    filterPrefix?: string;
    filterSuffix?: string;
  }>;
};

/** Provider-agnostic load balancer listener rule. */
export type NormalizedListenerRule = {
  id: string;
  listenerArn: string;
  provider: MigrationProvider;
  priority: number;
  conditions: Array<{
    field: "path-pattern" | "host-header" | "http-header" | "source-ip" | "query-string" | "http-request-method";
    values: string[];
    httpHeaderConfig?: { headerName: string; values: string[] };
  }>;
  actions: Array<{
    type: "forward" | "redirect" | "fixed-response" | "authenticate-oidc" | "authenticate-cognito";
    targetGroupArn?: string;
    redirectConfig?: { protocol: string; port: string; host: string; path: string; statusCode: "HTTP_301" | "HTTP_302" };
    fixedResponseConfig?: { statusCode: string; contentType: string; messageBody: string };
  }>;
};

/** Provider-agnostic network ACL. */
export type NormalizedNetworkACL = {
  id: string;
  name: string;
  provider: MigrationProvider;
  vpcId: string;
  subnetAssociations: string[];
  inboundRules: Array<{
    ruleNumber: number;
    protocol: "tcp" | "udp" | "icmp" | "*";
    portRange: { from: number; to: number };
    cidrBlock: string;
    action: "allow" | "deny";
  }>;
  outboundRules: Array<{
    ruleNumber: number;
    protocol: "tcp" | "udp" | "icmp" | "*";
    portRange: { from: number; to: number };
    cidrBlock: string;
    action: "allow" | "deny";
  }>;
  tags: Record<string, string>;
};

// =============================================================================
// Transfer Types
// =============================================================================

/** Manifest tracking individual object transfer status. */
export type TransferManifest = {
  jobId: string;
  sourceBucket: string;
  targetBucket: string;
  objects: TransferObjectEntry[];
  startedAt: string;
  completedAt?: string;
  totalBytes: number;
  transferredBytes: number;
};

export type TransferObjectEntry = {
  key: string;
  sizeBytes: number;
  sourceChecksum: string;
  targetChecksum?: string;
  /** SHA-256 computed inline during transfer (before upload). */
  inlineSha256?: string;
  status: "pending" | "transferring" | "verifying" | "completed" | "failed";
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

// =============================================================================
// Image Format Types
// =============================================================================

/** Supported disk image formats. */
export type ImageFormat = "raw" | "vhd" | "vhdx" | "vmdk" | "qcow2" | "ami";

/** Image conversion request. */
export type ImageConversion = {
  sourceFormat: ImageFormat;
  targetFormat: ImageFormat;
  sourcePath: string;
  targetPath: string;
  sourceChecksum?: string;
};

/** Image format conversion matrix — source → target format for each cloud. */
export const IMAGE_FORMAT_MATRIX: Record<string, { intermediate: ImageFormat; targets: Record<string, ImageFormat> }> = {
  aws: { intermediate: "raw", targets: { azure: "vhd", gcp: "raw", "on-premises": "vmdk", vmware: "vmdk", nutanix: "qcow2" } },
  azure: { intermediate: "raw", targets: { aws: "raw", gcp: "raw", "on-premises": "vmdk", vmware: "vmdk", nutanix: "qcow2" } },
  gcp: { intermediate: "raw", targets: { aws: "raw", azure: "vhd", "on-premises": "vmdk", vmware: "vmdk", nutanix: "qcow2" } },
  "on-premises": { intermediate: "raw", targets: { aws: "raw", azure: "vhd", gcp: "raw", vmware: "vmdk", nutanix: "qcow2" } },
  vmware: { intermediate: "vmdk", targets: { aws: "raw", azure: "vhd", gcp: "raw", "on-premises": "vmdk", nutanix: "qcow2" } },
  nutanix: { intermediate: "qcow2", targets: { aws: "raw", azure: "vhd", gcp: "raw", "on-premises": "vmdk", vmware: "vmdk" } },
};

// =============================================================================
// Compatibility Types
// =============================================================================

/** Result of checking migration compatibility for a resource type between providers. */
export type CompatibilityResult = {
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  resourceType: MigrationResourceType;
  compatible: boolean;
  warnings: CompatibilityWarning[];
  blockers: CompatibilityBlocker[];
  workarounds: CompatibilityWorkaround[];
};

export type CompatibilityWarning = {
  code: string;
  message: string;
  severity: "low" | "medium" | "high";
  affectedFeatures?: string[];
};

export type CompatibilityBlocker = {
  code: string;
  message: string;
  reason: string;
};

export type CompatibilityWorkaround = {
  code: string;
  message: string;
  steps: string[];
  automatable: boolean;
};

// =============================================================================
// Integrity Types
// =============================================================================

/** Per-resource integrity verification report. */
export type IntegrityReport = {
  jobId: string;
  resourceId: string;
  resourceType: MigrationResourceType;
  level: IntegrityLevel;
  passed: boolean;
  checks: IntegrityCheck[];
  checkedAt: string;
  durationMs: number;
};

export type IntegrityLevel = "object-level" | "volume-level" | "schema-level" | "row-level" | "reconciliation";

export type IntegrityCheck = {
  name: string;
  passed: boolean;
  expected: string | number;
  actual: string | number;
  details?: string;
};

// =============================================================================
// Cost Estimation Types
// =============================================================================

/** Cost estimate for a migration. */
export type MigrationCostEstimate = {
  jobId?: string;
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  egressCost: CostLineItem;
  transferCost: CostLineItem;
  targetInfraCost: CostLineItem;
  conversionCost: CostLineItem;
  totalEstimatedCost: number;
  currency: string;
  breakdown: CostLineItem[];
  estimatedDurationHours: number;
  confidenceLevel: "low" | "medium" | "high";
};

export type CostLineItem = {
  category: string;
  description: string;
  amount: number;
  unit: string;
  quantity: number;
};

// =============================================================================
// Migration Step Types (extends Azure Orchestration patterns)
// =============================================================================

/** Output reference using ${stepId}.outputs.${name} pattern from Azure orchestration. */
export type StepOutputRef = `${string}.outputs.${string}`;

/** A single step in the migration execution plan. */
export type MigrationStep = {
  id: string;
  type: MigrationStepType;
  name: string;
  description: string;
  params: Record<string, unknown | StepOutputRef>;
  dependsOn: string[];
  condition?: MigrationStepCondition;
  timeoutMs: number;
  pipeline: "compute" | "data" | "network" | "governance" | "identity" | "container" | "serverless" | "messaging" | "infrastructure" | "monitoring" | "orchestration" | "analytics" | "storage-policy";
  resourceType: MigrationResourceType;
  requiresRollback: boolean;
  tags?: Record<string, string>;
};

/** All supported step types. */
export type MigrationStepType =
  // Compute pipeline
  | "snapshot-source"
  | "export-image"
  | "transfer-image"
  | "convert-image"
  | "import-image"
  | "remediate-boot"
  | "provision-vm"
  | "verify-boot"
  // Data pipeline
  | "inventory-source"
  | "create-target"
  | "transfer-objects"
  | "verify-integrity"
  | "sync-metadata"
  // Database
  | "export-database"
  | "transfer-database"
  | "import-database"
  | "verify-schema"
  // Network pipeline
  | "map-network"
  | "create-security-rules"
  | "migrate-dns"
  | "verify-connectivity"
  // On-premises pipeline
  | "verify-agent"
  | "setup-staging"
  // Cross-cutting
  | "cutover"
  | "approval-gate"
  | "decommission-source"
  // Enterprise SLA
  | "reconcile"
  // IAM & Secrets pipeline
  | "extract-iam"
  | "create-iam"
  | "migrate-secrets"
  | "migrate-kms"
  // Container & Serverless pipeline
  | "migrate-containers"
  | "migrate-serverless"
  | "migrate-api-gateway"
  | "migrate-container-registry"
  // VPC / Infrastructure pipeline
  | "create-vpc"
  | "create-subnet"
  | "create-route-table"
  | "create-load-balancer"
  // Messaging & CDN pipeline
  | "migrate-queues"
  | "migrate-topics"
  | "migrate-cdn"
  | "migrate-certificates"
  | "migrate-waf"
  // NoSQL / Cache pipeline
  | "migrate-nosql"
  | "migrate-cache"
  // Auto Scaling
  | "migrate-auto-scaling"
  // Orchestration / Event-Driven pipeline
  | "migrate-step-functions"
  | "migrate-event-bus"
  // Shared File Storage pipeline
  | "migrate-file-system"
  // Advanced Networking pipeline
  | "migrate-transit-gateway"
  | "migrate-vpn-connection"
  | "migrate-vpc-endpoint"
  | "migrate-network-acl"
  | "migrate-listener-rules"
  // Configuration & Parameters pipeline
  | "migrate-parameters"
  // Identity advanced pipeline
  | "migrate-iam-users"
  | "migrate-iam-groups"
  | "migrate-identity-provider"
  // Monitoring & Observability pipeline
  | "migrate-log-groups"
  | "migrate-alarms"
  // Analytics / Streaming pipeline
  | "migrate-data-pipeline"
  | "migrate-stream"
  | "migrate-graph-database"
  | "migrate-data-warehouse"
  // Storage policies pipeline
  | "migrate-bucket-policies";

export type MigrationStepCondition = {
  stepId: string;
  check: "succeeded" | "failed" | "output-equals" | "output-truthy";
  outputName?: string;
  expectedValue?: unknown;
};

// =============================================================================
// Execution Plan
// =============================================================================

/** Top-level migration execution plan — a DAG of MigrationSteps. */
export type MigrationExecutionPlan = {
  id: string;
  name: string;
  description: string;
  jobId: string;
  steps: MigrationStep[];
  globalParams: Record<string, unknown>;
  createdAt: string;
  estimatedDurationMs: number;
  estimatedCost: MigrationCostEstimate;
  riskAssessment: RiskAssessment;
};

export type RiskAssessment = {
  overallRisk: "low" | "medium" | "high" | "critical";
  factors: RiskFactor[];
};

export type RiskFactor = {
  category: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  mitigation?: string;
};

// =============================================================================
// Step Execution State
// =============================================================================

export type MigrationStepStatus =
  | "pending"
  | "waiting"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "rolled-back";

export type MigrationStepExecutionState = {
  stepId: string;
  status: MigrationStepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  outputs: Record<string, unknown>;
  error?: string;
  rollbackError?: string;
  retryCount: number;
};

export type MigrationExecutionState = {
  planId: string;
  status: "pending" | "running" | "succeeded" | "failed" | "rolling-back" | "rolled-back" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  totalDurationMs?: number;
  steps: Map<string, MigrationStepExecutionState>;
  resolvedOutputs: Map<string, unknown>;
};

// =============================================================================
// Step Handler Contract (matches Azure Orchestration exactly)
// =============================================================================

export type MigrationStepLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export type MigrationStepContext = {
  params: Record<string, unknown>;
  globalParams: Record<string, unknown>;
  tags: Record<string, string>;
  log: MigrationStepLogger;
  signal?: AbortSignal;
  /** Source provider credentials accessor. */
  sourceCredentials?: unknown;
  /** Target provider credentials accessor. */
  targetCredentials?: unknown;
};

export type MigrationStepExecuteFn = (ctx: MigrationStepContext) => Promise<Record<string, unknown>>;
export type MigrationStepRollbackFn = (ctx: MigrationStepContext, outputs: Record<string, unknown>) => Promise<void>;

/**
 * Step handler contract — compatible with Azure Orchestrator's StepHandler.
 * Every mutating step MUST have a rollback handler.
 */
export type MigrationStepHandler = {
  execute: MigrationStepExecuteFn;
  rollback?: MigrationStepRollbackFn;
};

// =============================================================================
// Migration Job (top-level record)
// =============================================================================

/** Top-level migration job record — follows LifecycleIncident pattern from incident-lifecycle. */
export type MigrationJob = {
  id: string;
  name: string;
  description: string;
  phase: MigrationPhase;
  phaseHistory: MigrationPhaseTransition[];
  source: MigrationEndpoint;
  target: MigrationEndpoint;
  resourceIds: string[];
  resourceTypes: MigrationResourceType[];
  plan?: MigrationExecutionPlan;
  executionState?: MigrationExecutionState;
  integrityReports: IntegrityReport[];
  costEstimate?: MigrationCostEstimate;
  compatibilityResults: CompatibilityResult[];
  auditTrail: MigrationAuditEntry[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  initiatedBy: string;
  metadata: Record<string, unknown>;
};

export type MigrationEndpoint = {
  provider: MigrationProvider;
  region: string;
  accountId?: string;
  projectId?: string;
  subscriptionId?: string;
};

export type MigrationPhaseTransition = {
  from: MigrationPhase | "init";
  to: MigrationPhase;
  timestamp: string;
  triggeredBy: string;
  reason: string;
  durationMs?: number;
};

// =============================================================================
// Audit Types
// =============================================================================

/** Structured, cryptographically chained audit entry. */
export type MigrationAuditEntry = {
  timestamp: string;
  jobId: string;
  stepId: string;
  action: MigrationAuditAction;
  actor: string;
  provider: MigrationProvider;
  resourceId: string;
  outcome: "success" | "failure" | "skipped";
  details: Record<string, unknown>;
  integrityHash: string;
};

export type MigrationAuditAction =
  | "plan"
  | "approve"
  | "execute"
  | "verify"
  | "rollback"
  | "cutover"
  | "decommission";

// =============================================================================
// Orchestration Events
// =============================================================================

export type MigrationEventType =
  | "job:created"
  | "job:phase-change"
  | "plan:generated"
  | "plan:approved"
  | "plan:rejected"
  | "execution:start"
  | "execution:complete"
  | "execution:failed"
  | "execution:cancelled"
  | "step:start"
  | "step:complete"
  | "step:failed"
  | "step:skipped"
  | "step:rollback-start"
  | "step:rollback-complete"
  | "step:rollback-failed"
  | "step:retry"
  | "verification:start"
  | "verification:passed"
  | "verification:failed"
  | "cutover:start"
  | "cutover:complete"
  | "cutover:failed";

export type MigrationEvent = {
  type: MigrationEventType;
  jobId: string;
  planId?: string;
  stepId?: string;
  stepName?: string;
  timestamp: string;
  message: string;
  error?: string;
  outputs?: Record<string, unknown>;
  progress?: { completed: number; total: number; percentage: number };
};

export type MigrationEventListener = (event: MigrationEvent) => void;

// =============================================================================
// Orchestration Result
// =============================================================================

export type MigrationOrchestrationResult = {
  planId: string;
  planName: string;
  jobId: string;
  status: MigrationExecutionState["status"];
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  steps: MigrationStepExecutionResult[];
  outputs: Record<string, unknown>;
  errors: string[];
  integrityReports: IntegrityReport[];
};

export type MigrationStepExecutionResult = {
  stepId: string;
  stepName: string;
  stepType: MigrationStepType;
  status: MigrationStepStatus;
  durationMs: number;
  outputs: Record<string, unknown>;
  error?: string;
  rollbackError?: string;
};

// =============================================================================
// Orchestration Options
// =============================================================================

export type MigrationOrchestrationOptions = {
  dryRun?: boolean;
  maxConcurrency?: number;
  failFast?: boolean;
  autoRollback?: boolean;
  timeoutMs?: number;
  stepTimeoutMs?: number;
  maxRetries?: number;
  globalTags?: Record<string, string>;
  signal?: AbortSignal;
};

// =============================================================================
// Network Translation Types
// =============================================================================

export type TranslationReport = {
  sourceProvider: MigrationProvider;
  targetProvider: MigrationProvider;
  translatedRules: NormalizedSecurityRule[];
  warnings: TranslationWarning[];
  untranslatable: UntranslatableRule[];
  semanticDiff: SemanticDiff;
};

export type TranslationWarning = {
  ruleId: string;
  message: string;
  approximation: string;
};

export type UntranslatableRule = {
  originalRule: NormalizedSecurityRule;
  reason: string;
  suggestedAction: string;
};

export type SemanticDiff = {
  addedAccess: string[];
  removedAccess: string[];
  modifiedAccess: string[];
  summary: string;
};

// =============================================================================
// Database Migration Types
// =============================================================================

export type DatabaseType = "postgresql" | "mysql" | "sqlserver" | "oracle" | "mariadb";

export type DatabaseMigrationConfig = {
  sourceType: DatabaseType;
  sourceHost: string;
  sourcePort: number;
  sourceDatabase: string;
  targetHost: string;
  targetPort: number;
  targetDatabase: string;
  useCDC: boolean;
  maxLagMs?: number;
};

export type SchemaComparison = {
  tablesMatched: number;
  tablesMissing: string[];
  tablesExtra: string[];
  rowCountDiffs: Array<{ table: string; sourceCount: number; targetCount: number }>;
  schemaDiffs: Array<{ table: string; diff: string }>;
  passed: boolean;
};

// =============================================================================
// On-Premises Types
// =============================================================================

export type OnPremPlatform = "vmware" | "kvm" | "hyper-v" | "nutanix";

export type OnPremCredentials = {
  platform: OnPremPlatform;
  host: string;
  port: number;
  username: string;
  /** Credentials are resolved at runtime, never stored in plain text. */
  authType: "password" | "ssh-key" | "certificate";
};

export type OnPremDiscoveryResult = {
  platform: OnPremPlatform;
  vms: NormalizedVM[];
  datastores: Array<{ name: string; capacityGB: number; freeGB: number }>;
  networks: Array<{ name: string; vlanId?: number; cidr?: string }>;
};

// =============================================================================
// Plugin State
// =============================================================================

/**
 * Shared plugin state accessible across the extension.
 * Follows PluginState pattern from cloud extensions.
 */
export type CloudMigrationPluginState = {
  jobs: Map<string, MigrationJob>;
  activeJobCount: number;
  diagnostics: MigrationDiagnostics;
  stepHandlers: Map<MigrationStepType, MigrationStepHandler>;
  eventListeners: Set<MigrationEventListener>;
};

export type MigrationDiagnostics = {
  jobsCreated: number;
  jobsCompleted: number;
  jobsFailed: number;
  jobsRolledBack: number;
  stepsExecuted: number;
  stepsSucceeded: number;
  stepsFailed: number;
  integrityChecks: number;
  integrityPassed: number;
  integrityFailed: number;
  totalBytesTransferred: number;
  gatewayAttempts: number;
  gatewaySuccesses: number;
  gatewayFailures: number;
  lastError: string | null;
};

/** Factory for creating a fresh diagnostics object. */
export function createEmptyDiagnostics(): MigrationDiagnostics {
  return {
    jobsCreated: 0,
    jobsCompleted: 0,
    jobsFailed: 0,
    jobsRolledBack: 0,
    stepsExecuted: 0,
    stepsSucceeded: 0,
    stepsFailed: 0,
    integrityChecks: 0,
    integrityPassed: 0,
    integrityFailed: 0,
    totalBytesTransferred: 0,
    gatewayAttempts: 0,
    gatewaySuccesses: 0,
    gatewayFailures: 0,
    lastError: null,
  };
}

/** Factory for creating initial plugin state. */
export function createInitialPluginState(): CloudMigrationPluginState {
  return {
    jobs: new Map(),
    activeJobCount: 0,
    diagnostics: createEmptyDiagnostics(),
    stepHandlers: new Map(),
    eventListeners: new Set(),
  };
}

/**
 * Validate a phase transition. Returns true if the transition is allowed.
 */
export function isValidPhaseTransition(from: MigrationPhase, to: MigrationPhase): boolean {
  return MIGRATION_PHASE_TRANSITIONS[from]?.includes(to) ?? false;
}
