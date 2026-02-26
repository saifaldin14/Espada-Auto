/**
 * AWS Adapter — Type Definitions
 *
 * All exported types used by the AWS discovery adapter and its sub-modules.
 */

import type {
  GraphResourceType,
  GraphRelationshipType,
} from "../../types.js";

// =============================================================================
// Relationship Rules
// =============================================================================

/**
 * Defines how AWS resources refer to each other and what relationship type
 * to infer. Each entry maps a source resource field to a target resource
 * type and relationship.
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

// =============================================================================
// Service Mapping
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

// =============================================================================
// Adapter Configuration
// =============================================================================

/** Configuration for the AWS discovery adapter. */
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
   */
  clientFactory?: AwsClientFactory;
  /**
   * Enable AWS Cost Explorer API for real billing data.
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
  tagging?: unknown;
  network?: unknown;
  lambda?: unknown;
  sns?: unknown;
  sqs?: unknown;
  observability?: unknown;
  containers?: unknown;
  s3?: unknown;
  route53?: unknown;
  apigateway?: unknown;
  dynamodb?: unknown;
  organization?: unknown;
  backup?: unknown;
  elasticache?: unknown;
  compliance?: unknown;
  automation?: unknown;
  ec2?: unknown;
  rds?: unknown;
  cicd?: unknown;
  cognito?: unknown;
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
