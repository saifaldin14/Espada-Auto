/**
 * Infrastructure Knowledge Graph — AWS Adapter
 *
 * Maps AWS resource API responses into the universal graph model.
 * Discovers resources via the AWS SDK, extracts relationships using
 * rule-based field mappings, and supports multi-region + cross-account
 * discovery through standard credential chains.
 *
 * AWS SDK dependencies are loaded dynamically at runtime — this module
 * works with both @aws-sdk/client-* v3 packages (if installed) and
 * falls back gracefully when they're unavailable.
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
   * If provided, the adapter uses this instead of dynamic imports.
   * Signature: (service: string, region: string) => client
   */
  clientFactory?: AwsClientFactory;
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
        this.assumedCredentials = await this.assumeRole(this.config.assumeRoleArn, this.config.externalId);
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

    // Determine target regions
    const regions = options?.regions ?? this.config.regions ?? await this.getEnabledRegions();

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
    // CloudTrail integration is Phase 6
    return false;
  }

  /**
   * Verify AWS credentials by calling STS GetCallerIdentity.
   */
  async healthCheck(): Promise<boolean> {
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
   * Uses the client factory if provided, otherwise dynamically imports the SDK.
   */
  private async createClient(service: string, region: string): Promise<AwsClient | null> {
    const credentials = this.assumedCredentials ?? undefined;

    if (this.config.clientFactory) {
      return this.config.clientFactory(service, region, { credentials });
    }

    try {
      const clientConfig: Record<string, unknown> = { region };
      if (this.config.profile) {
        // Use the fromIni credential provider if a profile is specified
        const { fromIni } = await import("@aws-sdk/credential-provider-ini");
        clientConfig["credentials"] = fromIni({ profile: this.config.profile });
      }
      if (credentials) {
        clientConfig["credentials"] = credentials;
      }

      // Map service names to SDK package names
      const packageMap: Record<string, string> = {
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
      };

      const packageName = packageMap[service];
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
      const packageMap: Record<string, string> = {
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
      };

      const packageName = packageMap[service];
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
   */
  private async assumeRole(roleArn: string, externalId?: string): Promise<unknown> {
    const client = await this.createClient("STS", "us-east-1");
    if (!client) {
      throw new Error("STS client unavailable — cannot assume role");
    }

    try {
      const params: Record<string, unknown> = {
        RoleArn: roleArn,
        RoleSessionName: `espada-kg-discovery-${Date.now()}`,
        DurationSeconds: 3600,
      };
      if (externalId) params["ExternalId"] = externalId;

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
   * Get list of enabled regions for the account.
   * Falls back to common regions if the SDK call fails.
   */
  private async getEnabledRegions(): Promise<string[]> {
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
    return resolveFieldPath(response, responseKey).map((v) => {
      // If it's a stringified object reference, return it directly
      if (typeof v === "string") return { __rawValue: v };
      return v;
    });
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
   * Rough cost estimation from resource attributes.
   * Uses the same pricing tables as the Terraform adapter.
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
}

// =============================================================================
// Cost Tables (us-east-1 pricing, rough estimates)
// =============================================================================

const EC2_COSTS: Record<string, number> = {
  "t3.micro": 7.59, "t3.small": 15.18, "t3.medium": 30.37, "t3.large": 60.74, "t3.xlarge": 121.47,
  "t3a.micro": 6.86, "t3a.small": 13.72, "t3a.medium": 27.45, "t3a.large": 54.90,
  "m5.large": 70.08, "m5.xlarge": 140.16, "m5.2xlarge": 280.32, "m5.4xlarge": 560.64,
  "m6i.large": 69.35, "m6i.xlarge": 138.70, "m6i.2xlarge": 277.40, "m6i.4xlarge": 554.80,
  "m7i.large": 72.82, "m7i.xlarge": 145.64, "m7i.2xlarge": 291.28,
  "c5.large": 62.05, "c5.xlarge": 124.10, "c5.2xlarge": 248.20,
  "c6i.large": 61.32, "c6i.xlarge": 122.64, "c6i.2xlarge": 245.28,
  "r5.large": 91.98, "r5.xlarge": 183.96, "r5.2xlarge": 367.92,
  "r6i.large": 91.25, "r6i.xlarge": 182.50, "r6i.2xlarge": 365.00,
  // GPU / AI instances
  "p4d.24xlarge": 23689.44, "p5.48xlarge": 70560.00,
  "g5.xlarge": 766.44, "g5.2xlarge": 876.00, "g5.4xlarge": 1168.08, "g5.12xlarge": 4088.88, "g5.48xlarge": 11785.92,
  "inf2.xlarge": 546.72, "inf2.8xlarge": 1433.52, "inf2.24xlarge": 4584.48, "inf2.48xlarge": 9168.96,
  "trn1.2xlarge": 965.81, "trn1.32xlarge": 15453.00,
};

const RDS_COSTS: Record<string, number> = {
  "db.t3.micro": 11.68, "db.t3.small": 23.36, "db.t3.medium": 46.72, "db.t3.large": 93.44,
  "db.r5.large": 124.10, "db.r5.xlarge": 248.20, "db.r5.2xlarge": 496.40,
  "db.r6g.large": 118.26, "db.r6g.xlarge": 236.52, "db.r6g.2xlarge": 473.04,
  "db.m5.large": 94.17, "db.m5.xlarge": 188.34, "db.m5.2xlarge": 376.68,
};

const ELASTICACHE_COSTS_AWS: Record<string, number> = {
  "cache.t3.micro": 9.50, "cache.t3.small": 19.00, "cache.t3.medium": 38.00,
  "cache.r5.large": 120.72, "cache.r5.xlarge": 241.44, "cache.r5.2xlarge": 482.88,
  "cache.m5.large": 109.50, "cache.m5.xlarge": 219.00,
};

/** Default regions to scan when region list can't be obtained dynamically. */
const DEFAULT_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-central-1",
  "ap-southeast-1", "ap-northeast-1",
];

// =============================================================================
// Field Path Resolution Utilities
// =============================================================================

/**
 * Resolve a dot-separated field path with array notation from a raw object.
 *
 * Supports:
 *   "VpcId"                              → ["vpc-123"]
 *   "SecurityGroups[].GroupId"            → ["sg-1", "sg-2"]
 *   "Tags[Name]"                         → ["my-instance"]
 *   "VpcConfig.SubnetIds[]"              → ["subnet-a", "subnet-b"]
 *   "RedrivePolicy.deadLetterTargetArn"  → ["arn:..."]
 */
export function resolveFieldPath(obj: unknown, path: string): string[] {
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

  // Flatten to strings
  return current
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
