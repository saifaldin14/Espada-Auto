/**
 * Infrastructure Knowledge Graph — AWS Adapter
 *
 * Maps AWS resource API responses into the universal graph model.
 * This file defines the relationship extraction rules and resource mappings.
 *
 * STATUS: Skeleton — the full SDK wiring is deferred to Phase 4.
 * This file provides production-quality type definitions, mapping tables,
 * and the adapter class with all methods stubbed; the actual AWS SDK calls
 * need to be filled in per-service.
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
  /** Discovery parallelism per region. */
  concurrency?: number;
};

/**
 * AWS Discovery Adapter.
 *
 * Discovers AWS resources and their relationships using the AWS SDK.
 * Uses AWS_RELATIONSHIP_RULES to infer edges from API response fields.
 *
 * ### Implementation Status
 * - [x] Relationship rule definitions (31 rules covering 15 resource types)
 * - [x] Service mapping table (17 resource types)
 * - [x] Node ID construction
 * - [x] Adapter class structure with all interface methods
 * - [ ] AWS SDK client instantiation (deferred — needs @aws-sdk/* imports)
 * - [ ] Per-service discovery implementations (deferred)
 * - [ ] Cross-account assume-role support (deferred)
 * - [ ] X-Ray service map integration (deferred)
 * - [ ] Cost Explorer integration for costMonthly (deferred)
 */
export class AwsDiscoveryAdapter implements GraphDiscoveryAdapter {
  readonly provider: CloudProvider = "aws";
  readonly displayName = "Amazon Web Services";

  private config: AwsAdapterConfig;

  constructor(config: AwsAdapterConfig) {
    this.config = config;
  }

  supportedResourceTypes(): GraphResourceType[] {
    return AWS_SERVICE_MAPPINGS.map((m) => m.graphType);
  }

  /**
   * Discover all AWS resources and relationships.
   *
   * TODO: Implement per-service SDK calls using AWS_SERVICE_MAPPINGS.
   * For each service:
   *   1. Call the list/describe method
   *   2. Extract nodes using the mapping's field definitions
   *   3. Apply AWS_RELATIONSHIP_RULES to infer edges
   */
  async discover(options?: DiscoverOptions): Promise<DiscoveryResult> {
    const startMs = Date.now();
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    const errors: DiscoveryError[] = [];

    // Filter service mappings by requested resource types
    const mappings = options?.resourceTypes
      ? AWS_SERVICE_MAPPINGS.filter((m) => options.resourceTypes!.includes(m.graphType))
      : AWS_SERVICE_MAPPINGS;

    // Determine target regions
    const regions = options?.regions ?? this.config.regions ?? ["us-east-1"];

    for (const region of regions) {
      for (const mapping of mappings) {
        if (!mapping.regional && region !== regions[0]) continue; // Global resources: discover once

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

    return {
      provider: "aws",
      nodes,
      edges,
      errors,
      durationMs: Date.now() - startMs,
    };
  }

  /**
   * Discover a single AWS service in a single region.
   *
   * TODO: Wire up the actual SDK client calls.
   * The structure is ready — implement the body per service.
   */
  private async discoverService(
    _mapping: AwsServiceMapping,
    _region: string,
    _options?: DiscoverOptions,
  ): Promise<{ discoveredNodes: GraphNodeInput[]; discoveredEdges: GraphEdgeInput[] }> {
    // Placeholder — each service needs its own SDK call.
    // See README.md for implementation guide per service.
    return { discoveredNodes: [], discoveredEdges: [] };
  }

  /**
   * Apply relationship rules to extract edges from a raw API response.
   *
   * Uses AWS_RELATIONSHIP_RULES to map source resource fields to graph edges.
   * This is the production-ready relationship extraction engine — it just needs
   * raw API responses to work with.
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

  async healthCheck(): Promise<boolean> {
    // TODO: Call STS GetCallerIdentity to verify credentials
    return false;
  }
}

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
