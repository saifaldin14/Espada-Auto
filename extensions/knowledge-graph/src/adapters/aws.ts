/**
 * Infrastructure Knowledge Graph — AWS Adapter
 *
 * Maps AWS resource API responses into the universal graph model.
 * Discovers resources via the AWS SDK, extracts relationships using
 * rule-based field mappings, and supports multi-region + cross-account
 * discovery through standard credential chains.
 *
 * Deep integration with `@espada/aws` extension:
 * - **CredentialsManager** — Unified credential resolution (env, profile,
 *   SSO, instance metadata, assumed roles) replaces manual fromIni/STS code.
 * - **ClientPoolManager** — Connection pooling with LRU eviction and TTL
 *   replaces per-call client creation for supported services.
 * - **ServiceDiscovery** — Region enumeration replaces manual EC2
 *   DescribeRegions calls.
 * - **CostManager** — Cost Explorer queries, forecasting, optimization
 *   recommendations, and unused resource detection.
 * - **CloudTrailManager** — Incremental sync via infrastructure change events.
 * - **SecurityManager** — Security posture enrichment for discovered nodes.
 * - Static pricing tables remain as fallback when CE is unavailable.
 *
 * All @espada/aws managers are lazy-loaded at runtime — the adapter works
 * standalone (with direct AWS SDK dynamic imports) when the extension
 * package is unavailable. When `clientFactory` is provided (tests),
 * all manager delegation is bypassed.
 */

import type {
  GraphNodeInput,
  GraphEdgeInput,
  GraphResourceType,
  GraphRelationshipType,
  CloudProvider,
} from "../types.js";
import type {
  GraphDiscoveryAdapter,
  DiscoverOptions,
  DiscoveryResult,
  DiscoveryError,
} from "./types.js";

// =============================================================================
// AWS Relationship Extraction Mappings
// =============================================================================

/**
 * Defines how AWS resources refer to each other and what relationship type
 * to infer. Each entry maps a source resource field to a target resource
 * type and relationship.
 *
 * These mappings are used by the discovery logic to automatically create
 * edges from raw API response fields.
 */
export type AwsRelationshipRule = {
  /** Source resource type that holds the reference. */
  sourceType: GraphResourceType;
  /** Field path in the AWS API response that holds the target reference. */
  field: string;
  /** Target resource type being referenced. */
  targetType: GraphResourceType;
  /** Relationship type for the edge. */
  relationship: GraphRelationshipType;
  /** Whether the field holds an array of references. */
  isArray: boolean;
  /** Whether to infer the reverse edge as well. */
  bidirectional: boolean;
};

/**
 * Comprehensive AWS relationship rules covering primary services.
 *
 * These rules encode the implicit relationships between AWS resources
 * that are surfaced in API responses but not in any single "relationship" API.
 */
export const AWS_RELATIONSHIP_RULES: AwsRelationshipRule[] = [
  // --- EC2 ---
  { sourceType: "compute", field: "VpcId", targetType: "vpc", relationship: "runs-in", isArray: false, bidirectional: false },
  { sourceType: "compute", field: "SubnetId", targetType: "subnet", relationship: "runs-in", isArray: false, bidirectional: false },
  { sourceType: "compute", field: "SecurityGroups[].GroupId", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },
  { sourceType: "compute", field: "IamInstanceProfile.Arn", targetType: "iam-role", relationship: "uses", isArray: false, bidirectional: false },
  { sourceType: "compute", field: "BlockDeviceMappings[].Ebs.VolumeId", targetType: "storage", relationship: "attached-to", isArray: true, bidirectional: true },

  // --- VPC ---
  { sourceType: "subnet", field: "VpcId", targetType: "vpc", relationship: "runs-in", isArray: false, bidirectional: false },
  { sourceType: "security-group", field: "VpcId", targetType: "vpc", relationship: "runs-in", isArray: false, bidirectional: false },

  // --- RDS ---
  { sourceType: "database", field: "DBSubnetGroup.Subnets[].SubnetIdentifier", targetType: "subnet", relationship: "runs-in", isArray: true, bidirectional: false },
  { sourceType: "database", field: "VpcSecurityGroups[].VpcSecurityGroupId", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },
  { sourceType: "database", field: "ReadReplicaSourceDBInstanceIdentifier", targetType: "database", relationship: "replicates", isArray: false, bidirectional: false },

  // --- Lambda ---
  { sourceType: "serverless-function", field: "VpcConfig.SubnetIds[]", targetType: "subnet", relationship: "runs-in", isArray: true, bidirectional: false },
  { sourceType: "serverless-function", field: "VpcConfig.SecurityGroupIds[]", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },
  { sourceType: "serverless-function", field: "Role", targetType: "iam-role", relationship: "uses", isArray: false, bidirectional: false },
  { sourceType: "serverless-function", field: "DeadLetterConfig.TargetArn", targetType: "queue", relationship: "publishes-to", isArray: false, bidirectional: false },

  // --- ALB/NLB ---
  { sourceType: "load-balancer", field: "VpcId", targetType: "vpc", relationship: "runs-in", isArray: false, bidirectional: false },
  { sourceType: "load-balancer", field: "SecurityGroups[]", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },
  { sourceType: "load-balancer", field: "AvailabilityZones[].SubnetId", targetType: "subnet", relationship: "runs-in", isArray: true, bidirectional: false },

  // --- S3 → Lambda triggers ---
  { sourceType: "storage", field: "NotificationConfiguration.LambdaFunctionConfigurations[].LambdaFunctionArn", targetType: "serverless-function", relationship: "triggers", isArray: true, bidirectional: false },

  // --- SQS ---
  { sourceType: "queue", field: "RedrivePolicy.deadLetterTargetArn", targetType: "queue", relationship: "publishes-to", isArray: false, bidirectional: false },

  // --- SNS -> SQS / Lambda ---
  { sourceType: "topic", field: "Subscriptions[].Endpoint", targetType: "queue", relationship: "publishes-to", isArray: true, bidirectional: false },

  // --- API Gateway ---
  { sourceType: "api-gateway", field: "Integrations[].Uri", targetType: "serverless-function", relationship: "routes-to", isArray: true, bidirectional: false },

  // --- CloudFront ---
  { sourceType: "cdn", field: "Origins[].DomainName", targetType: "storage", relationship: "routes-to", isArray: true, bidirectional: false },
  { sourceType: "cdn", field: "Origins[].DomainName", targetType: "load-balancer", relationship: "routes-to", isArray: true, bidirectional: false },

  // --- ECS ---
  { sourceType: "container", field: "networkConfiguration.awsvpcConfiguration.subnets[]", targetType: "subnet", relationship: "runs-in", isArray: true, bidirectional: false },
  { sourceType: "container", field: "networkConfiguration.awsvpcConfiguration.securityGroups[]", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },
  { sourceType: "container", field: "taskDefinition.executionRoleArn", targetType: "iam-role", relationship: "uses", isArray: false, bidirectional: false },
  { sourceType: "container", field: "loadBalancers[].targetGroupArn", targetType: "load-balancer", relationship: "receives-from", isArray: true, bidirectional: false },

  // --- DynamoDB ---
  { sourceType: "database", field: "GlobalSecondaryIndexes[].IndexArn", targetType: "database", relationship: "replicates", isArray: true, bidirectional: false },

  // --- ElastiCache ---
  { sourceType: "cache", field: "CacheSubnetGroupName.Subnets[].SubnetIdentifier", targetType: "subnet", relationship: "runs-in", isArray: true, bidirectional: false },
  { sourceType: "cache", field: "SecurityGroups[].SecurityGroupId", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },

  // --- EKS ---
  { sourceType: "cluster", field: "resourcesVpcConfig.subnetIds[]", targetType: "subnet", relationship: "runs-in", isArray: true, bidirectional: false },
  { sourceType: "cluster", field: "resourcesVpcConfig.securityGroupIds[]", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },
  { sourceType: "cluster", field: "roleArn", targetType: "iam-role", relationship: "uses", isArray: false, bidirectional: false },
  { sourceType: "cluster", field: "resourcesVpcConfig.vpcId", targetType: "vpc", relationship: "runs-in", isArray: false, bidirectional: false },

  // --- SageMaker ---
  { sourceType: "custom", field: "ProductionVariants[].ModelName", targetType: "custom", relationship: "depends-on", isArray: true, bidirectional: false },
  { sourceType: "custom", field: "RoleArn", targetType: "iam-role", relationship: "uses", isArray: false, bidirectional: false },
  { sourceType: "custom", field: "SubnetId", targetType: "subnet", relationship: "runs-in", isArray: false, bidirectional: false },
  { sourceType: "custom", field: "SecurityGroupIds[]", targetType: "security-group", relationship: "secured-by", isArray: true, bidirectional: false },

  // --- Lambda Event Source Mappings ---
  { sourceType: "serverless-function", field: "EventSourceArn", targetType: "queue", relationship: "receives-from", isArray: false, bidirectional: false },
  { sourceType: "serverless-function", field: "EventSourceArn", targetType: "stream", relationship: "receives-from", isArray: false, bidirectional: false },
];

// =============================================================================
// AWS Resource Type → API Mapping
// =============================================================================

/**
 * Maps graph resource types to the AWS SDK client and method
 * needed to discover them. This table drives the discovery loop.
 */
export type AwsServiceMapping = {
  graphType: GraphResourceType;
  awsService: string;
  listMethod: string;
  describeMethod?: string;
  /** The response key that holds the resource array. */
  responseKey: string;
  /** How to extract the native resource ID from the response item. */
  idField: string;
  /** How to extract the resource name from the response item. */
  nameField: string;
  /** How to extract the ARN. */
  arnField: string;
  /** Whether this resource is regional (true) or global (false). */
  regional: boolean;
};

export const AWS_SERVICE_MAPPINGS: AwsServiceMapping[] = [
  { graphType: "compute", awsService: "EC2", listMethod: "describeInstances", responseKey: "Reservations[].Instances[]", idField: "InstanceId", nameField: "Tags[Name]", arnField: "InstanceId", regional: true },
  { graphType: "vpc", awsService: "EC2", listMethod: "describeVpcs", responseKey: "Vpcs", idField: "VpcId", nameField: "Tags[Name]", arnField: "VpcId", regional: true },
  { graphType: "subnet", awsService: "EC2", listMethod: "describeSubnets", responseKey: "Subnets", idField: "SubnetId", nameField: "Tags[Name]", arnField: "SubnetId", regional: true },
  { graphType: "security-group", awsService: "EC2", listMethod: "describeSecurityGroups", responseKey: "SecurityGroups", idField: "GroupId", nameField: "GroupName", arnField: "GroupId", regional: true },
  { graphType: "database", awsService: "RDS", listMethod: "describeDBInstances", responseKey: "DBInstances", idField: "DBInstanceIdentifier", nameField: "DBInstanceIdentifier", arnField: "DBInstanceArn", regional: true },
  { graphType: "serverless-function", awsService: "Lambda", listMethod: "listFunctions", responseKey: "Functions", idField: "FunctionName", nameField: "FunctionName", arnField: "FunctionArn", regional: true },
  { graphType: "storage", awsService: "S3", listMethod: "listBuckets", responseKey: "Buckets", idField: "Name", nameField: "Name", arnField: "Name", regional: false },
  { graphType: "load-balancer", awsService: "ELBv2", listMethod: "describeLoadBalancers", responseKey: "LoadBalancers", idField: "LoadBalancerArn", nameField: "LoadBalancerName", arnField: "LoadBalancerArn", regional: true },
  { graphType: "queue", awsService: "SQS", listMethod: "listQueues", responseKey: "QueueUrls", idField: "QueueUrl", nameField: "QueueUrl", arnField: "QueueUrl", regional: true },
  { graphType: "topic", awsService: "SNS", listMethod: "listTopics", responseKey: "Topics", idField: "TopicArn", nameField: "TopicArn", arnField: "TopicArn", regional: true },
  { graphType: "cache", awsService: "ElastiCache", listMethod: "describeCacheClusters", responseKey: "CacheClusters", idField: "CacheClusterId", nameField: "CacheClusterId", arnField: "ARN", regional: true },
  { graphType: "container", awsService: "ECS", listMethod: "listServices", responseKey: "serviceArns", idField: "serviceArn", nameField: "serviceName", arnField: "serviceArn", regional: true },
  { graphType: "api-gateway", awsService: "APIGateway", listMethod: "getRestApis", responseKey: "items", idField: "id", nameField: "name", arnField: "id", regional: true },
  { graphType: "cdn", awsService: "CloudFront", listMethod: "listDistributions", responseKey: "DistributionList.Items", idField: "Id", nameField: "DomainName", arnField: "ARN", regional: false },
  { graphType: "dns", awsService: "Route53", listMethod: "listHostedZones", responseKey: "HostedZones", idField: "Id", nameField: "Name", arnField: "Id", regional: false },
  { graphType: "iam-role", awsService: "IAM", listMethod: "listRoles", responseKey: "Roles", idField: "RoleName", nameField: "RoleName", arnField: "Arn", regional: false },
  { graphType: "secret", awsService: "SecretsManager", listMethod: "listSecrets", responseKey: "SecretList", idField: "Name", nameField: "Name", arnField: "ARN", regional: true },

  // EKS
  { graphType: "cluster", awsService: "EKS", listMethod: "describeClusters", responseKey: "clusters", idField: "name", nameField: "name", arnField: "arn", regional: true },

  // SageMaker — AI workloads
  { graphType: "custom", awsService: "SageMaker", listMethod: "listEndpoints", responseKey: "Endpoints", idField: "EndpointName", nameField: "EndpointName", arnField: "EndpointArn", regional: true },
  { graphType: "custom", awsService: "SageMaker", listMethod: "listNotebookInstances", responseKey: "NotebookInstances", idField: "NotebookInstanceName", nameField: "NotebookInstanceName", arnField: "NotebookInstanceArn", regional: true },

  // Bedrock — AI workloads
  { graphType: "custom", awsService: "Bedrock", listMethod: "listProvisionedModelThroughputs", responseKey: "provisionedModelSummaries", idField: "provisionedModelName", nameField: "provisionedModelName", arnField: "provisionedModelArn", regional: true },
];

// =============================================================================
// Node ID Construction
// =============================================================================

/**
 * Build a deterministic graph node ID from AWS resource identifiers.
 * Format: aws:<account>:<region>:<resourceType>:<nativeId>
 */
export function buildAwsNodeId(
  accountId: string,
  region: string,
  resourceType: GraphResourceType,
  nativeId: string,
): string {
  return `aws:${accountId}:${region}:${resourceType}:${nativeId}`;
}

// =============================================================================
// AWS Discovery Adapter (Skeleton)
// =============================================================================

export type AwsAdapterConfig = {
  /** AWS account ID. */
  accountId: string;
  /** Regions to discover (defaults to all enabled regions). */
  regions?: string[];
  /** AWS profile name (for credential chain). */
  profile?: string;
  /** Assume role ARN for cross-account discovery. */
  assumeRoleArn?: string;
  /** External ID for assume role (optional). */
  externalId?: string;
  /** Discovery parallelism per region. */
  concurrency?: number;
  /**
   * Optional SDK client factory for dependency injection.
   * If provided, the adapter uses this instead of dynamic imports
   * AND bypasses all @espada/aws manager delegation. Used by tests.
   * Signature: (service: string, region: string) => client
   */
  clientFactory?: AwsClientFactory;
  /**
   * Enable AWS Cost Explorer API for real billing data.
   * When enabled, discovered nodes are enriched with actual cost data
   * from the last N days of billing. Falls back to static pricing
   * tables when Cost Explorer is unavailable or returns no data.
   * Default: true.
   */
  enableCostExplorer?: boolean;
  /**
   * Cost lookback period in days for Cost Explorer queries.
   * Default: 30.
   */
  costLookbackDays?: number;
  /**
   * Pre-built @espada/aws managers for dependency injection.
   * When omitted, managers are lazy-loaded from the extension at runtime.
   * Ignored when `clientFactory` is provided (test mode).
   */
  managers?: AwsManagerOverrides;
};

/**
 * Optional pre-built @espada/aws manager instances.
 * The adapter lazy-loads any that aren't provided.
 */
export type AwsManagerOverrides = {
  credentials?: unknown;
  clientPool?: unknown;
  discovery?: unknown;
  cost?: unknown;
  cloudtrail?: unknown;
  security?: unknown;
};

/**
 * Factory that creates AWS SDK v3-style clients.
 * The returned client must have a `send(command)` method.
 */
export type AwsClientFactory = (
  service: string,
  region: string,
  config?: { credentials?: unknown },
) => AwsClient;

/** Minimal interface for an AWS SDK v3 client. */
export type AwsClient = {
  send: (command: unknown) => Promise<unknown>;
  destroy?: () => void;
};

// =============================================================================
// Extended Capability Result Types
// =============================================================================

/** Cost forecast result from CostManager.forecastCosts(). */
export type AwsForecastResult = {
  totalForecastedCost: number;
  forecastPeriods: Array<{ start: string; end: string; amount: number }>;
  currency: string;
  confidenceLevel?: number;
};

/** Optimization recommendation result from CostManager. */
export type AwsOptimizationResult = {
  rightsizing: Array<{ instanceId: string; currentType: string; recommendedType: string; estimatedSavings: number }>;
  reservedInstances: Array<{ service: string; recommendedCount: number; estimatedSavings: number }>;
  savingsPlans: Array<{ type: string; commitment: number; estimatedSavings: number }>;
  totalEstimatedSavings: number;
};

/** Unused resources result from CostManager.findUnusedResources(). */
export type AwsUnusedResourcesResult = {
  resources: Array<{
    resourceId: string;
    resourceType: string;
    reason: string;
    estimatedMonthlyCost: number;
    region?: string;
    lastUsed?: string;
  }>;
  totalWastedCost: number;
};

/** A single infrastructure change event from CloudTrail. */
export type AwsChangeEvent = {
  eventId: string;
  eventName: string;
  eventTime: string;
  region: string;
  service: string;
  actor: string;
  resources: Array<{ type: string; id: string }>;
};

/** Incremental changes since a given time from CloudTrail. */
export type AwsIncrementalChanges = {
  creates: AwsChangeEvent[];
  modifies: AwsChangeEvent[];
  deletes: AwsChangeEvent[];
  since: string;
  until: string;
};

/** Security posture summary from SecurityManager. */
export type AwsSecurityPosture = {
  iamRoles: number;
  securityFindings: Array<{ title: string; severity: string; resourceId?: string }>;
  guardDutyFindings: Array<{ title: string; severity: string; type?: string }>;
  scannedAt: string;
};

// =============================================================================
// GPU / AI Instance Type Detection
// =============================================================================

/** Regex matching GPU and AI-optimized EC2 instance families. */
const GPU_INSTANCE_REGEX = /^(p[3-5]|g[4-6]|inf[12]|trn[12]|dl[12])/;

/** Known AI/ML service prefixes in ARNs. */
const AI_SERVICE_PREFIXES = ["sagemaker", "bedrock", "comprehend", "rekognition", "textract", "forecast"];

/**
 * AWS Discovery Adapter.
 *
 * Discovers AWS resources and their relationships. Uses AWS_RELATIONSHIP_RULES
 * to infer edges from API response fields. Supports:
 *
 * - Standard AWS credential chain (env vars, ~/.aws/credentials, IAM role, SSO)
 * - Cross-account discovery via STS AssumeRole
 * - Multi-region parallel discovery
 * - GPU/AI workload detection and tagging
 * - Dynamic AWS SDK loading (optional dependency)
 */
export class AwsDiscoveryAdapter implements GraphDiscoveryAdapter {
  readonly provider: CloudProvider = "aws";
  readonly displayName = "Amazon Web Services";

  private config: AwsAdapterConfig;
  /**
   * Cached credentials from AssumeRole (if cross-account is configured).
   * Null means "use default credential chain".
   */
  private assumedCredentials: unknown | null = null;
  private sdkAvailable: boolean | null = null;

  // ---- @espada/aws lazy-loaded manager instances ----
  // `undefined` = not yet initialized. `null` = unavailable.
  private _credentialsManager: unknown | undefined = undefined;
  private _clientPoolManager: unknown | undefined = undefined;
  private _discoveryManager: unknown | undefined = undefined;
  private _costManager: unknown | undefined = undefined;
  private _cloudTrailManager: unknown | undefined = undefined;
  private _securityManager: unknown | undefined = undefined;

  constructor(config: AwsAdapterConfig) {
    this.config = config;
  }

  supportedResourceTypes(): GraphResourceType[] {
    return AWS_SERVICE_MAPPINGS.map((m) => m.graphType);
  }

  /**
   * Discover all AWS resources and relationships.
   *
   * For each service mapping:
   *   1. Create an SDK client for the region
   *   2. Call the list/describe method
   *   3. Extract nodes from the response
   *   4. Apply AWS_RELATIONSHIP_RULES to infer edges
   */
  async discover(options?: DiscoverOptions): Promise<DiscoveryResult> {
    const startMs = Date.now();
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    const errors: DiscoveryError[] = [];

    // Ensure SDK is available
    if (!(await this.ensureSdkAvailable())) {
      return {
        provider: "aws",
        nodes: [],
        edges: [],
        errors: [{
          resourceType: "custom",
          message: "AWS SDK (@aws-sdk/client-ec2, etc.) is not installed. Install AWS SDK v3 packages to enable live discovery.",
        }],
        durationMs: Date.now() - startMs,
      };
    }

    // Resolve credentials for cross-account if needed
    if (this.config.assumeRoleArn && !this.assumedCredentials) {
      try {
        this.assumedCredentials = await this.resolveAssumeRole(this.config.assumeRoleArn, this.config.externalId);
      } catch (error) {
        return {
          provider: "aws",
          nodes: [],
          edges: [],
          errors: [{
            resourceType: "custom",
            message: `Failed to assume role ${this.config.assumeRoleArn}: ${error instanceof Error ? error.message : String(error)}`,
          }],
          durationMs: Date.now() - startMs,
        };
      }
    }

    // Filter service mappings by requested resource types
    const mappings = options?.resourceTypes
      ? AWS_SERVICE_MAPPINGS.filter((m) => options.resourceTypes!.includes(m.graphType))
      : AWS_SERVICE_MAPPINGS;

    // Determine target regions (ServiceDiscovery → EC2 fallback → defaults)
    const regions = options?.regions ?? this.config.regions ?? await this.resolveRegions();

    for (const region of regions) {
      for (const mapping of mappings) {
        if (!mapping.regional && region !== regions[0]) continue; // Global resources: discover once

        // Respect abort signal
        if (options?.signal?.aborted) break;

        try {
          const { discoveredNodes, discoveredEdges } = await this.discoverService(
            mapping,
            region,
            options,
          );
          nodes.push(...discoveredNodes);
          edges.push(...discoveredEdges);
        } catch (error) {
          errors.push({
            resourceType: mapping.graphType,
            region,
            message: error instanceof Error ? error.message : String(error),
            code: (error as { code?: string })?.code,
          });
        }
      }
    }

    // Enrich nodes with real cost data from AWS Cost Explorer.
    // Falls back to static pricing tables when CE is unavailable.
    const enableCE = this.config.enableCostExplorer !== false;
    if (enableCE && nodes.length > 0) {
      try {
        await this.enrichWithCostExplorer(nodes, errors);
      } catch {
        // Cost enrichment is best-effort; don't fail the whole discovery
      }
    }

    // Static fallback: fill in any nodes still missing cost estimates
    for (const node of nodes) {
      if (node.costMonthly == null) {
        const fallback = this.estimateCostStatic(node.resourceType, node.metadata);
        if (fallback != null) {
          node.costMonthly = fallback;
          node.metadata["costSource"] = "static-estimate";
        }
      }
    }

    // Apply limit
    const limitedNodes = options?.limit ? nodes.slice(0, options.limit) : nodes;

    return {
      provider: "aws",
      nodes: limitedNodes,
      edges,
      errors,
      durationMs: Date.now() - startMs,
    };
  }

  /**
   * Discover a single AWS service in a single region.
   *
   * Creates an SDK client, calls the list method, extracts nodes and edges.
   */
  private async discoverService(
    mapping: AwsServiceMapping,
    region: string,
    _options?: DiscoverOptions,
  ): Promise<{ discoveredNodes: GraphNodeInput[]; discoveredEdges: GraphEdgeInput[] }> {
    const discoveredNodes: GraphNodeInput[] = [];
    const discoveredEdges: GraphEdgeInput[] = [];

    const client = await this.createClient(mapping.awsService, region);
    if (!client) {
      return { discoveredNodes, discoveredEdges };
    }

    try {
      // Build and send the list/describe command
      const command = await this.buildCommand(mapping.awsService, mapping.listMethod);
      if (!command) {
        return { discoveredNodes, discoveredEdges };
      }

      const response = await client.send(command) as Record<string, unknown>;

      // Extract raw resource items from the response
      const items = this.extractResponseItems(response, mapping.responseKey);

      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const rawItem = item as Record<string, unknown>;

        // Extract resource identifiers
        const nativeId = this.extractField(rawItem, mapping.idField);
        if (!nativeId) continue;

        const name = this.extractField(rawItem, mapping.nameField) ?? nativeId;
        const arn = this.extractField(rawItem, mapping.arnField);

        // Detect GPU/AI workload
        const instanceType = (rawItem["InstanceType"] ?? rawItem["instanceType"]) as string | undefined;
        const isGpu = instanceType ? GPU_INSTANCE_REGEX.test(instanceType) : false;
        const isAiService = arn ? AI_SERVICE_PREFIXES.some((p) => arn.includes(`:${p}:`)) : false;

        // Extract tags from AWS Tag format: [{Key, Value}] or {key: value}
        const tags = this.extractAwsTags(rawItem);

        const nodeId = buildAwsNodeId(this.config.accountId, region, mapping.graphType, nativeId);

        const node: GraphNodeInput = {
          id: nodeId,
          provider: "aws",
          resourceType: mapping.graphType,
          nativeId,
          name: tags["Name"] ?? name,
          region: mapping.regional ? region : "global",
          account: this.config.accountId,
          status: this.inferStatus(rawItem),
          tags,
          metadata: {
            ...this.extractServiceMetadata(mapping.graphType, rawItem),
            ...(isGpu ? { isGpuInstance: true, aiWorkload: true } : {}),
            ...(isAiService ? { aiWorkload: true } : {}),
          },
          costMonthly: this.estimateCost(mapping.graphType, rawItem),
          owner: tags["Owner"] ?? tags["owner"] ?? tags["Team"] ?? tags["team"] ?? null,
          createdAt: (rawItem["LaunchTime"] ?? rawItem["CreatedTime"] ?? rawItem["CreationDate"] ?? rawItem["CreateDate"]) as string | null,
        };

        discoveredNodes.push(node);

        // Extract relationship edges
        const nodeEdges = this.extractRelationships(
          nodeId,
          mapping.graphType,
          rawItem,
          this.config.accountId,
          region,
        );
        discoveredEdges.push(...nodeEdges);
      }
    } finally {
      client.destroy?.();
    }

    return { discoveredNodes, discoveredEdges };
  }

  /**
   * Apply relationship rules to extract edges from a raw API response.
   *
   * Uses AWS_RELATIONSHIP_RULES to map source resource fields to graph edges.
   */
  extractRelationships(
    sourceNodeId: string,
    sourceType: GraphResourceType,
    rawResponse: Record<string, unknown>,
    accountId: string,
    region: string,
  ): GraphEdgeInput[] {
    const edges: GraphEdgeInput[] = [];
    const rules = AWS_RELATIONSHIP_RULES.filter((r) => r.sourceType === sourceType);

    for (const rule of rules) {
      const values = resolveFieldPath(rawResponse, rule.field);
      if (!values || values.length === 0) continue;

      for (const value of values) {
        if (!value) continue;
        const targetNativeId = extractResourceId(String(value));
        const targetNodeId = buildAwsNodeId(accountId, region, rule.targetType, targetNativeId);
        const edgeId = `${sourceNodeId}--${rule.relationship}--${targetNodeId}`;

        edges.push({
          id: edgeId,
          sourceNodeId,
          targetNodeId,
          relationshipType: rule.relationship,
          confidence: 0.95, // API-derived relationships are high confidence
          discoveredVia: "api-field",
          metadata: { field: rule.field },
        });

        if (rule.bidirectional) {
          const reverseRelation = reverseRelationship(rule.relationship);
          edges.push({
            id: `${targetNodeId}--${reverseRelation}--${sourceNodeId}`,
            sourceNodeId: targetNodeId,
            targetNodeId: sourceNodeId,
            relationshipType: reverseRelation,
            confidence: 0.95,
            discoveredVia: "api-field",
            metadata: { field: rule.field, inferred: true },
          });
        }
      }
    }

    return edges;
  }

  supportsIncrementalSync(): boolean {
    // Incremental sync is supported via CloudTrail when @espada/aws is available.
    // The adapter checks at runtime via getIncrementalChanges().
    return !this.config.clientFactory;
  }

  /**
   * Verify AWS credentials by calling STS GetCallerIdentity.
   * Delegates to CredentialsManager when available, falls back to direct STS.
   */
  async healthCheck(): Promise<boolean> {
    // Try CredentialsManager first (richer, validates + caches)
    if (!this.config.clientFactory) {
      const cm = await this.getCredentialsManager();
      if (cm) {
        try {
          const result = await (cm as { healthCheck: (p?: string) => Promise<{ ok: boolean }> }).healthCheck(this.config.profile);
          return result.ok;
        } catch {
          // Fall through to direct STS
        }
      }
    }

    // Direct STS fallback
    try {
      const client = await this.createClient("STS", "us-east-1");
      if (!client) return false;

      try {
        const command = await this.buildCommand("STS", "getCallerIdentity");
        if (!command) return false;

        const response = await client.send(command) as Record<string, unknown>;
        return typeof response["Account"] === "string";
      } finally {
        client.destroy?.();
      }
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // AWS SDK Dynamic Loading
  // ===========================================================================

  /**
   * Check if the AWS SDK v3 is available.
   * Uses dynamic import to avoid hard dependency.
   */
  private async ensureSdkAvailable(): Promise<boolean> {
    if (this.config.clientFactory) {
      this.sdkAvailable = true;
      return true;
    }

    if (this.sdkAvailable !== null) return this.sdkAvailable;

    try {
      await import("@aws-sdk/client-sts");
      this.sdkAvailable = true;
    } catch {
      this.sdkAvailable = false;
    }

    return this.sdkAvailable;
  }

  /**
   * Create an AWS SDK client for the given service and region.
   *
   * Resolution order:
   * 1. `clientFactory` (test injection) — bypasses everything.
   * 2. `AWSClientPoolManager` from @espada/aws — connection pooling + TTL.
   * 3. Direct dynamic import fallback — per-call client creation.
   */
  private async createClient(service: string, region: string): Promise<AwsClient | null> {
    const credentials = this.assumedCredentials ?? undefined;

    // 1. Test injection
    if (this.config.clientFactory) {
      return this.config.clientFactory(service, region, { credentials });
    }

    // 2. Try ClientPoolManager for supported services
    const poolServiceName = AWS_SERVICE_TO_POOL_NAME[service];
    if (poolServiceName) {
      const pool = await this.getClientPoolManager();
      if (pool) {
        try {
          const creds = await this.resolveCredentials();
          if (creds) {
            const poolClient = await (pool as {
              getClient: <T>(s: string, r: string, c: unknown, p?: string) => Promise<T>;
            }).getClient(poolServiceName, region, creds, this.config.profile);
            // Pool-managed clients should NOT be destroyed by the caller
            return { send: (cmd: unknown) => (poolClient as { send: (c: unknown) => Promise<unknown> }).send(cmd) };
          }
        } catch {
          // Fall through to manual creation
        }
      }
    }

    // 3. Direct dynamic import fallback
    try {
      const clientConfig: Record<string, unknown> = { region };
      if (this.config.profile) {
        const { fromIni } = await import("@aws-sdk/credential-provider-ini");
        clientConfig["credentials"] = fromIni({ profile: this.config.profile });
      }
      if (credentials) {
        clientConfig["credentials"] = credentials;
      }

      const packageName = AWS_SDK_PACKAGES[service];
      if (!packageName) return null;

      const module = await import(packageName);

      // SDK v3 client class name follows pattern: {Service}Client
      const clientClassName = `${service}Client`;
      const ClientClass = module[clientClassName];
      if (!ClientClass) return null;

      return new ClientClass(clientConfig) as AwsClient;
    } catch {
      return null;
    }
  }

  /**
   * Build a command object for the given service method.
   * SDK v3 uses command classes like DescribeInstancesCommand.
   */
  private async buildCommand(service: string, method: string): Promise<unknown | null> {
    if (this.config.clientFactory) {
      // With a custom factory, return the method name as the "command"
      // The factory's client.send() is responsible for interpreting it.
      return { __method: method };
    }

    try {
      const packageName = AWS_SDK_PACKAGES[service];
      if (!packageName) return null;

      const module = await import(packageName);

      // Convert camelCase method to PascalCase command class
      // e.g. "describeInstances" → "DescribeInstancesCommand"
      const commandName = method.charAt(0).toUpperCase() + method.slice(1) + "Command";
      const CommandClass = module[commandName];
      if (!CommandClass) return null;

      return new CommandClass({});
    } catch {
      return null;
    }
  }

  /**
   * Assume an IAM role for cross-account discovery.
   * Delegates to CredentialsManager when available, falls back to direct STS.
   */
  private async resolveAssumeRole(roleArn: string, externalId?: string): Promise<unknown> {
    // Try CredentialsManager first
    if (!this.config.clientFactory) {
      const cm = await this.getCredentialsManager();
      if (cm) {
        try {
          const creds = await (cm as {
            assumeRole: (arn: string, opts?: Record<string, unknown>) => Promise<unknown>;
          }).assumeRole(roleArn, {
            sessionName: `espada-kg-discovery-${Date.now()}`,
            duration: 3600,
            ...(externalId ? { externalId } : {}),
          });
          return creds;
        } catch {
          // Fall through to direct STS
        }
      }
    }

    // Direct STS fallback
    const client = await this.createClient("STS", "us-east-1");
    if (!client) {
      throw new Error("STS client unavailable — cannot assume role");
    }

    try {
      const params = {
        RoleArn: roleArn,
        RoleSessionName: `espada-kg-discovery-${Date.now()}`,
        DurationSeconds: 3600,
        ...(externalId ? { ExternalId: externalId } : {}),
      };

      const module = await import("@aws-sdk/client-sts");
      const command = new module.AssumeRoleCommand(params);
      const response = await client.send(command) as Record<string, unknown>;
      const creds = response["Credentials"] as Record<string, unknown>;

      if (!creds) throw new Error("AssumeRole response missing Credentials");

      return {
        accessKeyId: creds["AccessKeyId"],
        secretAccessKey: creds["SecretAccessKey"],
        sessionToken: creds["SessionToken"],
        expiration: creds["Expiration"],
      };
    } finally {
      client.destroy?.();
    }
  }

  /**
   * Resolve current credentials via CredentialsManager.
   * Returns null if the manager is unavailable.
   */
  private async resolveCredentials(): Promise<unknown | null> {
    if (this.assumedCredentials) return this.assumedCredentials;

    const cm = await this.getCredentialsManager();
    if (!cm) return null;

    try {
      const result = await (cm as {
        getCredentials: (profile?: string) => Promise<{ credentials: unknown }>;
      }).getCredentials(this.config.profile);
      return result.credentials;
    } catch {
      return null;
    }
  }

  /**
   * Get list of enabled regions for the account.
   *
   * Resolution order:
   * 1. ServiceDiscovery from @espada/aws (cached, comprehensive).
   * 2. Direct EC2 DescribeRegions call.
   * 3. Hardcoded defaults.
   */
  private async resolveRegions(): Promise<string[]> {
    // 1. Try ServiceDiscovery
    if (!this.config.clientFactory) {
      const sd = await this.getServiceDiscovery();
      if (sd) {
        try {
          const regions = await (sd as {
            discoverRegions: () => Promise<Array<{ regionName: string; available: boolean }>>;
          }).discoverRegions();
          const enabled = regions.filter((r) => r.available).map((r) => r.regionName);
          if (enabled.length > 0) return enabled;
        } catch {
          // Fall through
        }
      }
    }

    // 2. Direct EC2 DescribeRegions fallback
    try {
      const client = await this.createClient("EC2", "us-east-1");
      if (!client) return DEFAULT_REGIONS;

      try {
        const command = await this.buildCommand("EC2", "describeRegions");
        if (!command) return DEFAULT_REGIONS;

        const response = await client.send(command) as Record<string, unknown>;
        const regions = response["Regions"] as Array<Record<string, unknown>> | undefined;
        if (regions && regions.length > 0) {
          return regions
            .filter((r) => r["OptInStatus"] !== "not-opted-in")
            .map((r) => r["RegionName"] as string)
            .filter(Boolean);
        }
      } finally {
        client.destroy?.();
      }
    } catch {
      // Fall through to defaults
    }

    return DEFAULT_REGIONS;
  }

  // ===========================================================================
  // Response Parsing Helpers
  // ===========================================================================

  /**
   * Extract items from an API response using a dot/bracket path.
   * Handles nested paths like "Reservations[].Instances[]".
   */
  private extractResponseItems(response: Record<string, unknown>, responseKey: string): unknown[] {
    return resolveFieldPathRaw(response, responseKey).flat();
  }

  /**
   * Extract a single field value from a raw item.
   * Handles dot paths and Tag lookups like "Tags[Name]".
   */
  private extractField(item: Record<string, unknown>, field: string): string | null {
    // Direct field
    if (!field.includes("[") && !field.includes(".")) {
      const value = item[field];
      return typeof value === "string" ? value : null;
    }

    // Use field path resolver
    const values = resolveFieldPath(item, field);
    return values[0] ?? null;
  }

  /**
   * Extract tags from AWS SDK response format.
   * AWS uses [{Key, Value}] arrays; some services use flat {key: value}.
   */
  private extractAwsTags(item: Record<string, unknown>): Record<string, string> {
    const tags: Record<string, string> = {};

    // [{Key, Value}] format (most services)
    const tagArray = item["Tags"] ?? item["tags"] ?? item["TagList"];
    if (Array.isArray(tagArray)) {
      for (const tag of tagArray) {
        if (tag && typeof tag === "object") {
          const key = (tag as Record<string, unknown>)["Key"] ?? (tag as Record<string, unknown>)["key"];
          const value = (tag as Record<string, unknown>)["Value"] ?? (tag as Record<string, unknown>)["value"];
          if (typeof key === "string" && typeof value === "string") {
            tags[key] = value;
          }
        }
      }
    }

    // Flat {key: value} format (some services)
    const flatTags = item["TagSet"] ?? item["tags"];
    if (flatTags && typeof flatTags === "object" && !Array.isArray(flatTags)) {
      for (const [k, v] of Object.entries(flatTags as Record<string, unknown>)) {
        if (typeof v === "string") tags[k] = v;
      }
    }

    return tags;
  }

  /**
   * Infer resource status from raw API response.
   */
  private inferStatus(item: Record<string, unknown>): GraphNodeInput["status"] {
    const stateField =
      (item["State"] as Record<string, unknown>)?.["Name"] ??
      item["Status"] ??
      item["State"] ??
      item["DBInstanceStatus"] ??
      item["HealthStatus"];

    if (typeof stateField === "string") {
      const s = stateField.toLowerCase();
      if (s === "running" || s === "available" || s === "active" || s === "in-service" || s === "enabled") return "running";
      if (s === "stopped" || s === "inactive") return "stopped";
      if (s === "pending" || s === "starting" || s === "creating" || s === "modifying") return "pending";
      if (s === "terminating" || s === "shutting-down" || s === "deleting") return "deleting";
      if (s === "terminated" || s === "deleted") return "deleted";
      if (s === "error" || s === "failed" || s === "unhealthy") return "error";
    }

    return "running";
  }

  /**
   * Extract service-specific metadata from raw API response.
   */
  private extractServiceMetadata(resourceType: GraphResourceType, item: Record<string, unknown>): Record<string, unknown> {
    const meta: Record<string, unknown> = {};

    switch (resourceType) {
      case "compute": {
        const instanceType = item["InstanceType"] as string;
        if (instanceType) {
          meta["instanceType"] = instanceType;
          if (GPU_INSTANCE_REGEX.test(instanceType)) {
            meta["isGpuInstance"] = true;
            meta["aiWorkload"] = true;
          }
        }
        if (item["ImageId"]) meta["ami"] = item["ImageId"];
        if (item["PublicIpAddress"]) meta["publicIp"] = item["PublicIpAddress"];
        if (item["PrivateIpAddress"]) meta["privateIp"] = item["PrivateIpAddress"];
        if (item["Platform"]) meta["platform"] = item["Platform"];
        const placement = item["Placement"] as Record<string, unknown> | undefined;
        if (placement?.["AvailabilityZone"]) meta["availabilityZone"] = placement["AvailabilityZone"];
        break;
      }
      case "database": {
        if (item["Engine"]) meta["engine"] = item["Engine"];
        if (item["EngineVersion"]) meta["engineVersion"] = item["EngineVersion"];
        if (item["DBInstanceClass"]) meta["instanceClass"] = item["DBInstanceClass"];
        if (item["MultiAZ"]) meta["multiAz"] = item["MultiAZ"];
        if (item["AllocatedStorage"]) meta["allocatedStorage"] = item["AllocatedStorage"];
        if (item["StorageEncrypted"]) meta["encrypted"] = item["StorageEncrypted"];
        break;
      }
      case "serverless-function": {
        if (item["Runtime"]) meta["runtime"] = item["Runtime"];
        if (item["MemorySize"]) meta["memorySize"] = item["MemorySize"];
        if (item["Timeout"]) meta["timeout"] = item["Timeout"];
        if (item["Handler"]) meta["handler"] = item["Handler"];
        if (item["CodeSize"]) meta["codeSize"] = item["CodeSize"];
        if (item["Architectures"]) meta["architectures"] = item["Architectures"];
        break;
      }
      case "storage": {
        if (item["CreationDate"]) meta["created"] = item["CreationDate"];
        break;
      }
      case "load-balancer": {
        if (item["Type"]) meta["lbType"] = item["Type"];
        if (item["Scheme"]) meta["scheme"] = item["Scheme"];
        if (item["DNSName"]) meta["dnsName"] = item["DNSName"];
        break;
      }
      case "cluster": {
        if (item["Version"]) meta["version"] = item["Version"];
        if (item["PlatformVersion"]) meta["platformVersion"] = item["PlatformVersion"];
        if (item["Status"]) meta["clusterStatus"] = item["Status"];
        break;
      }
      case "vpc": {
        if (item["CidrBlock"]) meta["cidrBlock"] = item["CidrBlock"];
        if (item["IsDefault"]) meta["isDefault"] = item["IsDefault"];
        break;
      }
      case "subnet": {
        if (item["CidrBlock"]) meta["cidrBlock"] = item["CidrBlock"];
        if (item["AvailabilityZone"]) meta["availabilityZone"] = item["AvailabilityZone"];
        if (item["MapPublicIpOnLaunch"]) meta["publicSubnet"] = item["MapPublicIpOnLaunch"];
        break;
      }
    }

    return meta;
  }

  /**
   * Rough cost estimation from resource attributes (inline, during discovery).
   * Used as the primary estimate; Cost Explorer enrichment overrides later.
   */
  private estimateCost(resourceType: GraphResourceType, item: Record<string, unknown>): number | null {
    switch (resourceType) {
      case "compute": {
        const instanceType = item["InstanceType"] as string;
        return instanceType ? (EC2_COSTS[instanceType] ?? null) : null;
      }
      case "database": {
        const instanceClass = item["DBInstanceClass"] as string;
        return instanceClass ? (RDS_COSTS[instanceClass] ?? null) : null;
      }
      case "cache": {
        const nodeType = item["CacheNodeType"] as string;
        return nodeType ? (ELASTICACHE_COSTS_AWS[nodeType] ?? null) : null;
      }
      case "load-balancer":
        return 16.20; // Base ALB cost
      case "nat-gateway":
        return 32.40;
    }

    return null;
  }

  /**
   * Static cost estimation fallback using resource metadata.
   * Called for nodes that Cost Explorer didn't cover (or when CE is unavailable).
   * Uses service-specific heuristics based on configuration attributes.
   */
  private estimateCostStatic(
    resourceType: GraphResourceType,
    metadata: Record<string, unknown>,
  ): number | null {
    switch (resourceType) {
      case "serverless-function": {
        // Lambda: estimate based on memory allocation and assumed invocations.
        // Free tier: 1M requests + 400K GB-seconds/month. Beyond that:
        // $0.20/1M requests + $0.0000166667/GB-second.
        // Conservative estimate: 100K invocations/month, 200ms avg duration.
        const memoryMb = (metadata["memorySize"] as number) ?? 128;
        const assumedInvocations = 100_000;
        const avgDurationMs = 200;
        const gbSeconds = (memoryMb / 1024) * (avgDurationMs / 1000) * assumedInvocations;
        const computeCost = Math.max(0, gbSeconds - 400_000) * 0.0000166667;
        const requestCost = Math.max(0, assumedInvocations - 1_000_000) * 0.0000002;
        const total = computeCost + requestCost;
        // Return small estimated cost even in free tier to show activity
        return total < 0.01 ? 0.01 : Math.round(total * 100) / 100;
      }

      case "storage": {
        // S3: estimate based on storage class. Assume modest bucket size.
        // Standard: $0.023/GB. Typical small bucket: ~1 GB = ~$0.02/mo.
        // We can't see bucket size from listBuckets, so use a conservative floor.
        return STORAGE_COSTS["s3-standard"];
      }

      case "queue": {
        // SQS: $0.40/1M requests after free tier (1M free).
        // Assume modest usage: 500K messages/month → free tier → $0.00.
        return STORAGE_COSTS["sqs"];
      }

      case "topic": {
        // SNS: $0.50/1M publishes. Assume modest usage.
        return STORAGE_COSTS["sns"];
      }

      case "api-gateway": {
        // API Gateway: $3.50/1M REST API calls. Assume 100K calls/month.
        return STORAGE_COSTS["api-gateway"];
      }

      case "cdn": {
        // CloudFront: varies by traffic. Base monthly cost for a distribution.
        return STORAGE_COSTS["cloudfront"];
      }

      case "dns": {
        // Route 53: $0.50/hosted zone + $0.40/1M queries.
        return STORAGE_COSTS["route53-zone"];
      }

      case "secret": {
        // Secrets Manager: $0.40/secret/month + $0.05/10K API calls.
        return STORAGE_COSTS["secrets-manager"];
      }

      case "cluster": {
        // EKS: $0.10/hour = $73/month for the control plane.
        return STORAGE_COSTS["eks-cluster"];
      }

      case "container": {
        // ECS service: cost depends on underlying compute (Fargate/EC2).
        // Fargate base estimate: 0.5 vCPU, 1GB = ~$18/month.
        return STORAGE_COSTS["ecs-fargate-task"];
      }

      case "iam-role":
      case "security-group":
      case "vpc":
      case "subnet":
      case "policy":
        // Free-tier / no-cost resources. Mark as $0 explicitly.
        return 0;

      default:
        return null;
    }
  }

  // ===========================================================================
  // @espada/aws Manager Lazy-Loading
  // ===========================================================================

  /**
   * Lazily get or create an AWSCredentialsManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getCredentialsManager(): Promise<unknown | null> {
    if (this._credentialsManager !== undefined) return this._credentialsManager as unknown | null;

    if (this.config.managers?.credentials) {
      this._credentialsManager = this.config.managers.credentials;
      return this._credentialsManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/credentials");
      const cm = mod.createCredentialsManager({
        defaultProfile: this.config.profile,
        defaultRegion: "us-east-1",
      });
      await (cm as { initialize: () => Promise<void> }).initialize();
      this._credentialsManager = cm;
      return cm;
    } catch {
      this._credentialsManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create an AWSClientPoolManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getClientPoolManager(): Promise<unknown | null> {
    if (this._clientPoolManager !== undefined) return this._clientPoolManager as unknown | null;

    if (this.config.managers?.clientPool) {
      this._clientPoolManager = this.config.managers.clientPool;
      return this._clientPoolManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/client-pool");
      const pool = mod.createClientPool({
        maxClientsPerService: 5,
        maxTotalClients: 50,
        clientTTL: 3600000,
        defaultRegion: "us-east-1",
      });

      // Initialize pool with credentials if available
      const creds = await this.resolveCredentials();
      if (creds) {
        await (pool as { initialize: (c: unknown) => Promise<void> }).initialize(creds);
      }

      this._clientPoolManager = pool;
      return pool;
    } catch {
      this._clientPoolManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create an AWSServiceDiscovery from @espada/aws.
   * Returns null if the extension or CredentialsManager is unavailable.
   */
  private async getServiceDiscovery(): Promise<unknown | null> {
    if (this._discoveryManager !== undefined) return this._discoveryManager as unknown | null;

    if (this.config.managers?.discovery) {
      this._discoveryManager = this.config.managers.discovery;
      return this._discoveryManager as unknown;
    }

    try {
      const cm = await this.getCredentialsManager();
      if (!cm) { this._discoveryManager = null; return null; }

      const pool = await this.getClientPoolManager();
      const mod = await import("@espada/aws/discovery");
      // eslint-disable-next-line -- dynamic import loses type info; runtime validated
      this._discoveryManager = mod.createServiceDiscovery(cm as never, (pool ?? undefined) as never);
      return this._discoveryManager as unknown;
    } catch {
      this._discoveryManager = null;
      return null;
    }
  }

  /**
   * Get or lazily create a CostManager instance from `@espada/aws`.
   *
   * Returns null if the aws extension package is not available (e.g. standalone
   * deployment without the workspace). In that case the static pricing
   * tables are used as fallback.
   */
  private async getCostManagerInstance(): Promise<unknown | null> {
    if (this._costManager !== undefined) return this._costManager as unknown | null;

    if (this.config.managers?.cost) {
      this._costManager = this.config.managers.cost;
      return this._costManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/cost");
      const config: Record<string, unknown> = { defaultRegion: "us-east-1" };

      // Forward credentials when explicitly available
      if (this.assumedCredentials) {
        const creds = this.assumedCredentials as Record<string, unknown>;
        config["credentials"] = {
          accessKeyId: creds["accessKeyId"],
          secretAccessKey: creds["secretAccessKey"],
          sessionToken: creds["sessionToken"],
        };
      } else if (this.config.profile) {
        try {
          const { fromIni } = await import("@aws-sdk/credential-provider-ini");
          const resolved = await fromIni({ profile: this.config.profile })();
          config["credentials"] = {
            accessKeyId: resolved.accessKeyId,
            secretAccessKey: resolved.secretAccessKey,
            sessionToken: resolved.sessionToken,
          };
        } catch {
          // profile resolution failed — let CostManager try default chain
        }
      }

      this._costManager = mod.createCostManager(config);
      return this._costManager as unknown;
    } catch {
      this._costManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create a CloudTrailManager from @espada/aws.
   * Returns null if the extension or CredentialsManager is unavailable.
   */
  private async getCloudTrailManager(): Promise<unknown | null> {
    if (this._cloudTrailManager !== undefined) return this._cloudTrailManager as unknown | null;

    if (this.config.managers?.cloudtrail) {
      this._cloudTrailManager = this.config.managers.cloudtrail;
      return this._cloudTrailManager as unknown;
    }

    try {
      const cm = await this.getCredentialsManager();
      if (!cm) { this._cloudTrailManager = null; return null; }

      const mod = await import("@espada/aws/cloudtrail");
      // eslint-disable-next-line -- dynamic import loses type info; runtime validated
      this._cloudTrailManager = mod.createCloudTrailManager(cm as never, "us-east-1");
      return this._cloudTrailManager as unknown;
    } catch {
      this._cloudTrailManager = null;
      return null;
    }
  }

  /**
   * Lazily get or create a SecurityManager from @espada/aws.
   * Returns null if the extension is unavailable.
   */
  private async getSecurityManager(): Promise<unknown | null> {
    if (this._securityManager !== undefined) return this._securityManager as unknown | null;

    if (this.config.managers?.security) {
      this._securityManager = this.config.managers.security;
      return this._securityManager as unknown;
    }

    try {
      const mod = await import("@espada/aws/security");
      const config: Record<string, unknown> = { defaultRegion: "us-east-1" };

      // Forward credentials
      if (this.assumedCredentials) {
        const creds = this.assumedCredentials as Record<string, unknown>;
        config["credentials"] = {
          accessKeyId: creds["accessKeyId"],
          secretAccessKey: creds["secretAccessKey"],
          sessionToken: creds["sessionToken"],
        };
      }

      this._securityManager = mod.createSecurityManager(config);
      return this._securityManager as unknown;
    } catch {
      this._securityManager = null;
      return null;
    }
  }

  /**
   * Enrich discovered nodes with real cost data from AWS Cost Explorer.
   *
   * Delegates to the `@espada/aws` CostManager for CE queries, then
   * applies KG-specific distribution logic to map costs to graph nodes.
   *
   * Strategy:
   * 1. Query `GetCostAndUsage` grouped by SERVICE for the last N days.
   * 2. Map AWS service names to graph resource types.
   * 3. Distribute per-service costs proportionally across discovered nodes
   *    of that type (weighted by static estimates when available).
   * 4. For services with resource-level granularity (EC2, RDS, Lambda),
   *    also query `GetCostAndUsage` with RESOURCE dimension.
   *
   * Sets `metadata.costSource = "cost-explorer"` on enriched nodes.
   */
  async enrichWithCostExplorer(
    nodes: GraphNodeInput[],
    errors: DiscoveryError[],
  ): Promise<void> {
    const lookbackDays = this.config.costLookbackDays ?? 30;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const formatDate = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const timePeriod = {
      Start: formatDate(startDate),
      End: formatDate(endDate),
    };

    try {
      // Step 1: Get per-service cost totals (delegates to CostManager)
      const serviceCosts = await this.queryServiceCosts(timePeriod, lookbackDays);
      if (!serviceCosts || serviceCosts.size === 0) return;

      // Step 2: Try resource-level cost data for supported services
      const resourceCosts = await this.queryResourceCosts(timePeriod, lookbackDays);

      // Step 3: Match resource-level costs to nodes by ARN/ID
      if (resourceCosts && resourceCosts.size > 0) {
        this.applyResourceCosts(nodes, resourceCosts);
      }

      // Step 4: Distribute remaining service-level costs to uncosted nodes
      this.distributeServiceCosts(nodes, serviceCosts);
    } catch (error) {
      errors.push({
        resourceType: "custom",
        message: `Cost Explorer enrichment failed: ${error instanceof Error ? error.message : String(error)}`,
        code: (error as { code?: string })?.code,
      });
    }
  }

  /**
   * Query AWS Cost Explorer for per-service monthly costs.
   * Delegates to `@espada/aws` CostManager.getCostSummary().
   *
   * Returns a map of AWS service name → monthly cost in USD.
   */
  private async queryServiceCosts(
    timePeriod: { Start: string; End: string },
    lookbackDays: number,
  ): Promise<Map<string, number> | null> {
    const cm = await this.getCostManagerInstance();
    if (!cm) return null;

    try {
      // Use CostManager.getCostSummary() grouped by SERVICE
      const result = await (cm as { getCostSummary: (opts: unknown) => Promise<{ success: boolean; data?: { groups?: Array<{ key: string; total: number }> } }> }).getCostSummary({
        timePeriod: { start: timePeriod.Start, end: timePeriod.End },
        granularity: "MONTHLY",
        groupBy: [{ type: "DIMENSION", key: "SERVICE" }],
        metrics: ["UnblendedCost"],
      });

      if (!result.success || !result.data?.groups) return null;

      const serviceCosts = new Map<string, number>();
      for (const group of result.data.groups) {
        if (group.total > 0) {
          serviceCosts.set(group.key, group.total);
        }
      }

      // Normalize to monthly if lookback > 30 days
      if (lookbackDays > 30) {
        const factor = 30 / lookbackDays;
        for (const [k, v] of serviceCosts.entries()) {
          serviceCosts.set(k, Math.round(v * factor * 100) / 100);
        }
      }

      return serviceCosts.size > 0 ? serviceCosts : null;
    } catch {
      return null;
    }
  }

  /**
   * Query Cost Explorer for resource-level costs via CostManager.
   * Uses DAILY granularity over the last 14 days, then extrapolates to monthly.
   *
   * Returns a map of resource ARN/ID → monthly cost in USD.
   */
  private async queryResourceCosts(
    _timePeriod: { Start: string; End: string },
    _lookbackDays: number,
  ): Promise<Map<string, number> | null> {
    const cm = await this.getCostManagerInstance();
    if (!cm) return null;

    try {
      // Resource-level data requires DAILY granularity and max 14 days
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 14 * 24 * 60 * 60 * 1000);
      const formatDate = (d: Date): string =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      const result = await (cm as { getCostSummary: (opts: unknown) => Promise<{ success: boolean; data?: { groups?: Array<{ key: string; total: number }> } }> }).getCostSummary({
        timePeriod: { start: formatDate(startDate), end: formatDate(endDate) },
        granularity: "DAILY",
        groupBy: [{ type: "DIMENSION", key: "RESOURCE" }],
        metrics: ["UnblendedCost"],
        filter: {
          dimension: "SERVICE",
          values: [
            "Amazon Elastic Compute Cloud - Compute",
            "Amazon Relational Database Service",
            "AWS Lambda",
            "Amazon Simple Storage Service",
            "Amazon ElastiCache",
            "Amazon Elastic Container Service",
            "Amazon Elastic Kubernetes Service",
            "Amazon SageMaker",
          ],
        },
      });

      if (!result.success || !result.data?.groups) return null;

      const resourceCosts = new Map<string, number>();
      for (const group of result.data.groups) {
        if (group.total > 0) {
          resourceCosts.set(group.key, group.total);
        }
      }

      // Extrapolate 14 days to monthly (×30/14)
      const factor = 30 / 14;
      for (const [k, v] of resourceCosts.entries()) {
        resourceCosts.set(k, Math.round(v * factor * 100) / 100);
      }

      return resourceCosts.size > 0 ? resourceCosts : null;
    } catch {
      return null;
    }
  }

  /**
   * Apply resource-level Cost Explorer data to matching nodes.
   * Matches by ARN substring or native resource ID.
   */
  private applyResourceCosts(
    nodes: GraphNodeInput[],
    resourceCosts: Map<string, number>,
  ): void {
    for (const node of nodes) {
      for (const [arn, cost] of resourceCosts.entries()) {
        // Match by nativeId (contained in the ARN) or by full ARN match
        if (
          arn.includes(node.nativeId) ||
          (node.metadata["arn"] && arn === node.metadata["arn"]) ||
          arn.endsWith(`/${node.nativeId}`) ||
          arn.endsWith(`:${node.nativeId}`)
        ) {
          node.costMonthly = cost;
          node.metadata["costSource"] = "cost-explorer";
          node.metadata["costArn"] = arn;
          break;
        }
      }
    }
  }

  /**
   * Distribute service-level costs from Cost Explorer to discovered nodes
   * that don't already have resource-level cost data.
   *
   * Strategy: for each AWS service bucket, find matching uncosted nodes
   * and divide the service cost among them (weighted by static estimate
   * if available, otherwise equal split).
   */
  private distributeServiceCosts(
    nodes: GraphNodeInput[],
    serviceCosts: Map<string, number>,
  ): void {
    for (const [awsService, totalCost] of serviceCosts.entries()) {
      const resourceTypes = AWS_SERVICE_TO_RESOURCE_TYPE[awsService];
      if (!resourceTypes) continue;

      // Find nodes of this resource type that don't have CE cost yet
      const uncostdNodes = nodes.filter(
        (n) =>
          resourceTypes.includes(n.resourceType) &&
          n.metadata["costSource"] !== "cost-explorer",
      );
      if (uncostdNodes.length === 0) continue;

      // Weighted distribution: use existing static estimates as weights
      const totalStaticWeight = uncostdNodes.reduce(
        (sum, n) => sum + (n.costMonthly ?? 1),
        0,
      );

      for (const node of uncostdNodes) {
        const weight = (node.costMonthly ?? 1) / totalStaticWeight;
        node.costMonthly = Math.round(totalCost * weight * 100) / 100;
        node.metadata["costSource"] = "cost-explorer-distributed";
      }
    }
  }

  // ===========================================================================
  // Extended Capabilities — via @espada/aws
  // ===========================================================================

  /**
   * Forecast future AWS costs using CostManager.forecastCosts().
   *
   * Returns a forecast result or null if the CostManager is unavailable
   * or the forecast fails. This is a new capability enabled by the
   * @espada/aws integration.
   */
  async forecastCosts(options?: {
    /** Forecast horizon in days (default: 30). */
    days?: number;
    /** Granularity: "MONTHLY" | "DAILY" (default: "MONTHLY"). */
    granularity?: string;
  }): Promise<AwsForecastResult | null> {
    const cm = await this.getCostManagerInstance();
    if (!cm) return null;

    try {
      const days = options?.days ?? 30;
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
      const formatDate = (d: Date): string =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      const result = await (cm as {
        forecastCosts: (opts: unknown) => Promise<{
          success: boolean;
          data?: {
            totalForecastedCost: number;
            forecastPeriods?: Array<{ start: string; end: string; amount: number }>;
            currency?: string;
            confidenceLevel?: number;
          };
          error?: string;
        }>;
      }).forecastCosts({
        timePeriod: { start: formatDate(startDate), end: formatDate(endDate) },
        granularity: options?.granularity ?? "MONTHLY",
        metric: "UNBLENDED_COST",
      });

      if (!result.success || !result.data) return null;

      return {
        totalForecastedCost: result.data.totalForecastedCost,
        forecastPeriods: result.data.forecastPeriods ?? [],
        currency: result.data.currency ?? "USD",
        confidenceLevel: result.data.confidenceLevel,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get optimization recommendations via CostManager.
   *
   * Covers rightsizing, reserved instance, and savings plan opportunities.
   * Returns null if the CostManager is unavailable.
   */
  async getOptimizationRecommendations(): Promise<AwsOptimizationResult | null> {
    const cm = await this.getCostManagerInstance();
    if (!cm) return null;

    try {
      const result = await (cm as {
        getOptimizationRecommendations: (opts?: unknown) => Promise<{
          success: boolean;
          data?: {
            rightsizing?: Array<{ instanceId: string; currentType: string; recommendedType: string; estimatedSavings: number }>;
            reservedInstances?: Array<{ service: string; recommendedCount: number; estimatedSavings: number }>;
            savingsPlans?: Array<{ type: string; commitment: number; estimatedSavings: number }>;
            totalEstimatedSavings?: number;
          };
          error?: string;
        }>;
      }).getOptimizationRecommendations();

      if (!result.success || !result.data) return null;

      return {
        rightsizing: result.data.rightsizing ?? [],
        reservedInstances: result.data.reservedInstances ?? [],
        savingsPlans: result.data.savingsPlans ?? [],
        totalEstimatedSavings: result.data.totalEstimatedSavings ?? 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Detect unused AWS resources via CostManager.findUnusedResources().
   *
   * Identifies idle EBS volumes, unused EIPs, stale snapshots, cold Lambda
   * functions, idle instances, and unused load balancers.
   */
  async findUnusedResources(): Promise<AwsUnusedResourcesResult | null> {
    const cm = await this.getCostManagerInstance();
    if (!cm) return null;

    try {
      const result = await (cm as {
        findUnusedResources: (opts?: unknown) => Promise<{
          success: boolean;
          data?: {
            resources: Array<{
              resourceId: string;
              resourceType: string;
              reason: string;
              estimatedMonthlyCost: number;
              region?: string;
              lastUsed?: string;
            }>;
            totalWastedCost: number;
          };
          error?: string;
        }>;
      }).findUnusedResources();

      if (!result.success || !result.data) return null;

      return {
        resources: result.data.resources,
        totalWastedCost: result.data.totalWastedCost,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get incremental infrastructure changes since a given time via CloudTrail.
   *
   * Returns changed resources as partial graph updates: creates, modifies,
   * and deletes detected from CloudTrail infrastructure events.
   */
  async getIncrementalChanges(since: Date): Promise<AwsIncrementalChanges | null> {
    if (this.config.clientFactory) return null; // Not available in test mode

    const ct = await this.getCloudTrailManager();
    if (!ct) return null;

    try {
      const events = await (ct as {
        getInfrastructureEvents: (opts?: { startTime?: Date; endTime?: Date; maxResults?: number }) => Promise<Array<{
          eventId: string;
          eventName: string;
          eventTime: Date;
          eventSource: string;
          awsRegion: string;
          userIdentity: { type?: string; userName?: string; arn?: string };
          requestParameters?: Record<string, unknown>;
          responseElements?: Record<string, unknown>;
          errorCode?: string;
          resources?: Array<{ resourceType?: string; resourceName?: string }>;
        }>>;
      }).getInfrastructureEvents({
        startTime: since,
        endTime: new Date(),
        maxResults: 500,
      });

      const creates: AwsChangeEvent[] = [];
      const modifies: AwsChangeEvent[] = [];
      const deletes: AwsChangeEvent[] = [];

      for (const event of events) {
        if (event.errorCode) continue; // Skip failed actions

        const changeEvent: AwsChangeEvent = {
          eventId: event.eventId,
          eventName: event.eventName,
          eventTime: event.eventTime instanceof Date ? event.eventTime.toISOString() : String(event.eventTime),
          region: event.awsRegion,
          service: event.eventSource.replace(".amazonaws.com", ""),
          actor: event.userIdentity?.userName ?? event.userIdentity?.arn ?? "unknown",
          resources: event.resources?.map((r) => ({
            type: r.resourceType ?? "unknown",
            id: r.resourceName ?? "unknown",
          })) ?? [],
        };

        const name = event.eventName.toLowerCase();
        if (name.startsWith("create") || name.startsWith("run") || name.startsWith("launch")) {
          creates.push(changeEvent);
        } else if (name.startsWith("delete") || name.startsWith("terminate") || name.startsWith("remove")) {
          deletes.push(changeEvent);
        } else if (name.startsWith("modify") || name.startsWith("update") || name.startsWith("put") || name.startsWith("attach") || name.startsWith("detach")) {
          modifies.push(changeEvent);
        }
      }

      return { creates, modifies, deletes, since: since.toISOString(), until: new Date().toISOString() };
    } catch {
      return null;
    }
  }

  /**
   * Get security posture summary via SecurityManager.
   *
   * Collects IAM findings, Security Hub results, GuardDuty alerts, and
   * access analyzer findings. Returns null if SecurityManager is unavailable.
   */
  async getSecurityPosture(): Promise<AwsSecurityPosture | null> {
    if (this.config.clientFactory) return null; // Not available in test mode

    const sm = await this.getSecurityManager();
    if (!sm) return null;

    try {
      // Collect IAM roles for policy analysis
      const rolesResult = await (sm as {
        listRoles: (opts?: unknown) => Promise<{ success: boolean; data?: { roles: Array<{ roleName: string; arn: string; createDate?: string }> } }>;
      }).listRoles();

      // Collect security findings if Security Hub is enabled
      let securityFindings: Array<{ title: string; severity: string; resourceId?: string }> = [];
      try {
        const findingsResult = await (sm as {
          listSecurityFindings: (opts?: unknown) => Promise<{
            success: boolean;
            data?: { findings: Array<{ title: string; severity: string; resources?: Array<{ id?: string }> }> };
          }>;
        }).listSecurityFindings({ maxResults: 100 });

        if (findingsResult.success && findingsResult.data?.findings) {
          securityFindings = findingsResult.data.findings.map((f) => ({
            title: f.title,
            severity: f.severity,
            resourceId: f.resources?.[0]?.id,
          }));
        }
      } catch {
        // Security Hub might not be enabled — non-fatal
      }

      // Collect GuardDuty findings
      let guardDutyFindings: Array<{ title: string; severity: string; type?: string }> = [];
      try {
        const gdResult = await (sm as {
          listGuardDutyFindings: (opts?: unknown) => Promise<{
            success: boolean;
            data?: { findings: Array<{ title: string; severity: string; type?: string }> };
          }>;
        }).listGuardDutyFindings({ maxResults: 50 });

        if (gdResult.success && gdResult.data?.findings) {
          guardDutyFindings = gdResult.data.findings.map((f) => ({
            title: f.title,
            severity: f.severity,
            type: f.type,
          }));
        }
      } catch {
        // GuardDuty might not be enabled — non-fatal
      }

      return {
        iamRoles: rolesResult.success ? (rolesResult.data?.roles.length ?? 0) : 0,
        securityFindings,
        guardDutyFindings,
        scannedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Enrich discovered nodes with security metadata from SecurityManager.
   * Attaches findings to matching nodes by resource ARN/ID.
   */
  async enrichWithSecurity(nodes: GraphNodeInput[]): Promise<void> {
    const posture = await this.getSecurityPosture();
    if (!posture) return;

    // Attach security findings to matching nodes
    for (const finding of posture.securityFindings) {
      if (!finding.resourceId) continue;
      for (const node of nodes) {
        if (
          finding.resourceId.includes(node.nativeId) ||
          node.nativeId.includes(finding.resourceId)
        ) {
          const existing = (node.metadata["securityFindings"] as string[] | undefined) ?? [];
          existing.push(`[${finding.severity}] ${finding.title}`);
          node.metadata["securityFindings"] = existing;
          node.metadata["hasSecurityIssues"] = true;
        }
      }
    }
  }

  /**
   * Clean up resources held by lazy-loaded managers.
   * Call when the adapter is no longer needed.
   */
  async dispose(): Promise<void> {
    if (this._clientPoolManager && typeof this._clientPoolManager === "object") {
      try {
        await (this._clientPoolManager as { destroy?: () => void }).destroy?.();
      } catch {
        // Ignore cleanup errors
      }
    }
    this._credentialsManager = undefined;
    this._clientPoolManager = undefined;
    this._discoveryManager = undefined;
    this._costManager = undefined;
    this._cloudTrailManager = undefined;
    this._securityManager = undefined;
  }
}

// =============================================================================
// Cost Tables (us-east-1 pricing, rough estimates)
// =============================================================================

const EC2_COSTS: Record<string, number> = {
  // General purpose — T family
  "t3.nano": 3.80, "t3.micro": 7.59, "t3.small": 15.18, "t3.medium": 30.37, "t3.large": 60.74, "t3.xlarge": 121.47, "t3.2xlarge": 242.94,
  "t3a.nano": 3.43, "t3a.micro": 6.86, "t3a.small": 13.72, "t3a.medium": 27.45, "t3a.large": 54.90, "t3a.xlarge": 109.79, "t3a.2xlarge": 219.58,
  "t4g.nano": 3.07, "t4g.micro": 6.13, "t4g.small": 12.26, "t4g.medium": 24.53, "t4g.large": 49.06, "t4g.xlarge": 98.11,
  // General purpose — M family
  "m5.large": 70.08, "m5.xlarge": 140.16, "m5.2xlarge": 280.32, "m5.4xlarge": 560.64, "m5.8xlarge": 1121.28, "m5.12xlarge": 1681.92,
  "m5a.large": 63.22, "m5a.xlarge": 126.44,
  "m6i.large": 69.35, "m6i.xlarge": 138.70, "m6i.2xlarge": 277.40, "m6i.4xlarge": 554.80, "m6i.8xlarge": 1109.60,
  "m6g.large": 56.21, "m6g.xlarge": 112.42, "m6g.2xlarge": 224.84,
  "m7i.large": 72.82, "m7i.xlarge": 145.64, "m7i.2xlarge": 291.28, "m7i.4xlarge": 582.56,
  "m7g.large": 59.57, "m7g.xlarge": 119.14,
  // Compute-optimized — C family
  "c5.large": 62.05, "c5.xlarge": 124.10, "c5.2xlarge": 248.20, "c5.4xlarge": 496.40, "c5.9xlarge": 1116.90,
  "c6i.large": 61.32, "c6i.xlarge": 122.64, "c6i.2xlarge": 245.28, "c6i.4xlarge": 490.56,
  "c6g.large": 49.06, "c6g.xlarge": 98.11, "c6g.2xlarge": 196.22,
  "c7g.large": 52.34, "c7g.xlarge": 104.68,
  // Memory-optimized — R family
  "r5.large": 91.98, "r5.xlarge": 183.96, "r5.2xlarge": 367.92, "r5.4xlarge": 735.84,
  "r6i.large": 91.25, "r6i.xlarge": 182.50, "r6i.2xlarge": 365.00, "r6i.4xlarge": 730.00,
  "r6g.large": 73.00, "r6g.xlarge": 146.00,
  "r7g.large": 77.38, "r7g.xlarge": 154.75,
  // Storage-optimized
  "i3.large": 114.61, "i3.xlarge": 229.22, "i3.2xlarge": 458.44,
  "d3.xlarge": 363.05, "d3.2xlarge": 726.10,
  // GPU / AI instances
  "p3.2xlarge": 2203.20, "p3.8xlarge": 8812.80, "p3.16xlarge": 17625.60,
  "p4d.24xlarge": 23689.44, "p4de.24xlarge": 28675.20,
  "p5.48xlarge": 70560.00,
  "g4dn.xlarge": 381.24, "g4dn.2xlarge": 546.36, "g4dn.4xlarge": 876.00, "g4dn.8xlarge": 1580.76, "g4dn.12xlarge": 2838.24,
  "g5.xlarge": 766.44, "g5.2xlarge": 876.00, "g5.4xlarge": 1168.08, "g5.12xlarge": 4088.88, "g5.48xlarge": 11785.92,
  "g6.xlarge": 488.76, "g6.2xlarge": 586.87, "g6.4xlarge": 878.40,
  "inf1.xlarge": 268.66, "inf1.2xlarge": 426.32, "inf1.6xlarge": 1381.08, "inf1.24xlarge": 5524.32,
  "inf2.xlarge": 546.72, "inf2.8xlarge": 1433.52, "inf2.24xlarge": 4584.48, "inf2.48xlarge": 9168.96,
  "trn1.2xlarge": 965.81, "trn1.32xlarge": 15453.00,
  "trn1n.32xlarge": 17496.00,
  "dl1.24xlarge": 9661.92,
};

const RDS_COSTS: Record<string, number> = {
  "db.t3.micro": 11.68, "db.t3.small": 23.36, "db.t3.medium": 46.72, "db.t3.large": 93.44,
  "db.t4g.micro": 11.83, "db.t4g.small": 23.65, "db.t4g.medium": 47.30,
  "db.r5.large": 124.10, "db.r5.xlarge": 248.20, "db.r5.2xlarge": 496.40, "db.r5.4xlarge": 992.80,
  "db.r6g.large": 118.26, "db.r6g.xlarge": 236.52, "db.r6g.2xlarge": 473.04, "db.r6g.4xlarge": 946.08,
  "db.r6i.large": 124.10, "db.r6i.xlarge": 248.20, "db.r6i.2xlarge": 496.40,
  "db.r7g.large": 125.56, "db.r7g.xlarge": 251.12,
  "db.m5.large": 94.17, "db.m5.xlarge": 188.34, "db.m5.2xlarge": 376.68, "db.m5.4xlarge": 753.36,
  "db.m6g.large": 86.58, "db.m6g.xlarge": 173.16, "db.m6g.2xlarge": 346.32,
  "db.m6i.large": 94.17, "db.m6i.xlarge": 188.34,
  "db.serverless": 0.12, // Aurora Serverless per-ACU-hour (placeholder)
};

const ELASTICACHE_COSTS_AWS: Record<string, number> = {
  "cache.t3.micro": 9.50, "cache.t3.small": 19.00, "cache.t3.medium": 38.00,
  "cache.t4g.micro": 9.50, "cache.t4g.small": 19.00, "cache.t4g.medium": 38.00,
  "cache.r5.large": 120.72, "cache.r5.xlarge": 241.44, "cache.r5.2xlarge": 482.88,
  "cache.r6g.large": 115.34, "cache.r6g.xlarge": 230.69, "cache.r6g.2xlarge": 461.38,
  "cache.r7g.large": 121.91, "cache.r7g.xlarge": 243.82,
  "cache.m5.large": 109.50, "cache.m5.xlarge": 219.00, "cache.m5.2xlarge": 438.00,
  "cache.m6g.large": 104.40, "cache.m6g.xlarge": 208.80,
};

/**
 * Static cost estimates for services not covered by instance-type lookups.
 * Values are conservative monthly estimates in USD (us-east-1 pricing).
 */
const STORAGE_COSTS: Record<string, number> = {
  // S3: assumes ~1 GB Standard storage + modest requests
  "s3-standard": 0.02,
  // SQS: first 1M requests free, then $0.40/1M
  "sqs": 0.01,
  // SNS: first 1M publishes free, then $0.50/1M
  "sns": 0.01,
  // API Gateway: ~$3.50/1M REST API calls, assume 100K calls/month
  "api-gateway": 0.35,
  // CloudFront: base pricing for a distribution with modest traffic (~10 GB)
  "cloudfront": 0.85,
  // Route 53: $0.50/hosted zone/month
  "route53-zone": 0.50,
  // Secrets Manager: $0.40/secret/month
  "secrets-manager": 0.40,
  // EKS: control plane = $0.10/hour
  "eks-cluster": 73.00,
  // ECS Fargate: minimal task (0.25 vCPU, 0.5 GB) running 24/7
  "ecs-fargate-task": 9.15,
};

/**
 * Maps AWS Cost Explorer service names to graph resource types.
 * Used to distribute service-level costs to discovered nodes.
 */
const AWS_SERVICE_TO_RESOURCE_TYPE: Record<string, GraphResourceType[]> = {
  "Amazon Elastic Compute Cloud - Compute": ["compute"],
  "EC2 - Other": ["compute", "vpc", "subnet", "security-group", "nat-gateway"],
  "Amazon Relational Database Service": ["database"],
  "AWS Lambda": ["serverless-function"],
  "Amazon Simple Storage Service": ["storage"],
  "Amazon ElastiCache": ["cache"],
  "Amazon Simple Queue Service": ["queue"],
  "Amazon Simple Notification Service (SNS)": ["topic"],
  "Amazon API Gateway": ["api-gateway"],
  "Amazon CloudFront": ["cdn"],
  "Amazon Route 53": ["dns"],
  "AWS Secrets Manager": ["secret"],
  "Amazon Elastic Container Service": ["container"],
  "Amazon Elastic Kubernetes Service": ["cluster"],
  "Amazon SageMaker": ["custom"],
  "Amazon Bedrock": ["custom"],
  "Elastic Load Balancing": ["load-balancer"],
  "AWS Identity and Access Management": ["iam-role"],
  "Amazon Virtual Private Cloud": ["vpc", "subnet", "security-group", "nat-gateway"],
};

/** Default regions to scan when region list can't be obtained dynamically. */
const DEFAULT_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-central-1",
  "ap-southeast-1", "ap-northeast-1",
];

/**
 * Maps adapter service names (e.g. "EC2") to AWSServiceName values
 * used by the ClientPoolManager. Services not in this map are not
 * supported by the pool and fall back to direct SDK creation.
 */
const AWS_SERVICE_TO_POOL_NAME: Record<string, string> = {
  EC2: "ec2",
  RDS: "rds",
  Lambda: "lambda",
  S3: "s3",
  SQS: "sqs",
  SNS: "sns",
  ElastiCache: "elasticache",
  ECS: "ecs",
  EKS: "eks",
  Route53: "route53",
  IAM: "iam",
  SecretsManager: "secretsmanager",
  STS: "sts",
  CloudFront: "cloudfront", // Not in pool — will fall through
  // Note: ELBv2, APIGateway, SageMaker, Bedrock, CostExplorer are NOT in
  // the ClientPoolManager's factory map, so they're omitted here and will
  // fall back to direct SDK creation.
};

/**
 * Shared map of AWS service names to SDK package names.
 * Used by both `createClient()` and `buildCommand()` — consolidated
 * to eliminate prior duplication.
 */
const AWS_SDK_PACKAGES: Record<string, string> = {
  EC2: "@aws-sdk/client-ec2",
  RDS: "@aws-sdk/client-rds",
  Lambda: "@aws-sdk/client-lambda",
  S3: "@aws-sdk/client-s3",
  ELBv2: "@aws-sdk/client-elastic-load-balancing-v2",
  SQS: "@aws-sdk/client-sqs",
  SNS: "@aws-sdk/client-sns",
  ElastiCache: "@aws-sdk/client-elasticache",
  ECS: "@aws-sdk/client-ecs",
  EKS: "@aws-sdk/client-eks",
  APIGateway: "@aws-sdk/client-api-gateway",
  CloudFront: "@aws-sdk/client-cloudfront",
  Route53: "@aws-sdk/client-route-53",
  IAM: "@aws-sdk/client-iam",
  SecretsManager: "@aws-sdk/client-secrets-manager",
  STS: "@aws-sdk/client-sts",
  SageMaker: "@aws-sdk/client-sagemaker",
  Bedrock: "@aws-sdk/client-bedrock",
  CostExplorer: "@aws-sdk/client-cost-explorer",
};

// =============================================================================
// Field Path Resolution Utilities
// =============================================================================

/**
 * Resolve a dot-separated field path with array notation from a raw object.
 * Returns raw (uncoerced) values — use resolveFieldPath() when you need strings.
 *
 * Supports:
 *   "VpcId"                              → [value]
 *   "SecurityGroups[].GroupId"            → [value, value]
 *   "Tags[Name]"                         → [value]
 *   "VpcConfig.SubnetIds[]"              → [value, value]
 *   "RedrivePolicy.deadLetterTargetArn"  → [value]
 */
export function resolveFieldPathRaw(obj: unknown, path: string): unknown[] {
  if (obj == null || typeof obj !== "object") return [];

  const parts = path.split(".");
  let current: unknown[] = [obj];

  for (const part of parts) {
    const next: unknown[] = [];

    // Handle array indexing: "SecurityGroups[]" or "Tags[Name]"
    const arrayMatch = part.match(/^(.+?)\[(.*)?\]$/);

    if (arrayMatch) {
      const [, key, indexOrKey] = arrayMatch;

      for (const item of current) {
        if (item == null || typeof item !== "object") continue;
        const value = (item as Record<string, unknown>)[key!];

        if (Array.isArray(value)) {
          if (indexOrKey === "" || indexOrKey === undefined) {
            // [] → flatten array elements
            next.push(...value);
          } else {
            // [Name] → find an item by tag key or use as index
            for (const v of value) {
              if (v && typeof v === "object" && "Key" in v && (v as Record<string, unknown>).Key === indexOrKey) {
                next.push((v as Record<string, unknown>).Value);
              }
            }
          }
        }
      }
    } else {
      // Simple field access
      for (const item of current) {
        if (item == null || typeof item !== "object") continue;
        const value = (item as Record<string, unknown>)[part];
        if (value !== undefined && value !== null) {
          next.push(value);
        }
      }
    }

    current = next;
    if (current.length === 0) break;
  }

  return current;
}

/**
 * Resolve a dot-separated field path with array notation from a raw object.
 * Returns all leaf values as strings (flattened).
 */
export function resolveFieldPath(obj: unknown, path: string): string[] {
  return resolveFieldPathRaw(obj, path)
    .flat(Infinity)
    .filter((v) => v != null)
    .map((v) => String(v));
}

/**
 * Extract the resource ID from an ARN or direct ID.
 *
 * - "arn:aws:ec2:us-east-1:123456:instance/i-abc123" → "i-abc123"
 * - "arn:aws:iam::123456:role/MyRole" → "MyRole"
 * - "sg-abc123" → "sg-abc123"
 * - "https://sqs.us-east-1.amazonaws.com/123456/my-queue" → "my-queue"
 */
export function extractResourceId(value: string): string {
  // ARN format: arn:partition:service:region:account:resource-type/resource-id
  if (value.startsWith("arn:")) {
    const parts = value.split(":");
    const resource = parts.slice(5).join(":");
    // Handle resource-type/resource-id and resource-type:resource-id
    const slashIdx = resource.indexOf("/");
    return slashIdx >= 0 ? resource.slice(slashIdx + 1) : resource;
  }

  // SQS URL format
  if (value.startsWith("https://sqs.")) {
    const parts = value.split("/");
    return parts[parts.length - 1] ?? value;
  }

  // Direct ID (e.g. "vpc-abc123", "sg-abc123")
  return value;
}

/**
 * Get the reverse relationship type for bidirectional edges.
 */
function reverseRelationship(rel: GraphRelationshipType): GraphRelationshipType {
  const reverseMap: Partial<Record<GraphRelationshipType, GraphRelationshipType>> = {
    "attached-to": "attached-to",
    "runs-in": "contains",
    "contains": "runs-in",
    "routes-to": "receives-from",
    "receives-from": "routes-to",
    "publishes-to": "subscribes-to",
    "subscribes-to": "publishes-to",
    "secured-by": "secures",
    "secures": "secured-by",
    "triggers": "triggered-by",
    "triggered-by": "triggers",
    "depends-on": "depended-on-by",
    "depended-on-by": "depends-on",
    "replicates": "replicates",
    "peers-with": "peers-with",
    "uses": "used-by",
    "used-by": "uses",
    "monitors": "monitored-by",
    "monitored-by": "monitors",
    "logs-to": "receives-logs-from",
    "receives-logs-from": "logs-to",
    "backed-by": "backs",
    "backs": "backed-by",
    "aliases": "aliases",
  };
  return reverseMap[rel] ?? rel;
}
