/**
 * AWS Core Services Plugin - Type Definitions
 *
 * Core type definitions for AWS plugin components including credentials,
 * client management, context switching, and service discovery.
 */

// =============================================================================
// Credentials Types
// =============================================================================

/**
 * AWS credential source types
 */
export type AWSCredentialSource =
  | "environment"
  | "profile"
  | "sso"
  | "instance-metadata"
  | "container-credentials"
  | "web-identity"
  | "assumed-role"
  | "credential-process";

/**
 * AWS credentials configuration
 */
export type AWSCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
  source: AWSCredentialSource;
};

/**
 * AWS profile configuration
 */
export type AWSProfile = {
  name: string;
  region?: string;
  output?: string;
  roleArn?: string;
  sourceProfile?: string;
  mfaSerial?: string;
  ssoStartUrl?: string;
  ssoRegion?: string;
  ssoAccountId?: string;
  ssoRoleName?: string;
  externalId?: string;
  credentialProcess?: string;
  durationSeconds?: number;
};

/**
 * SSO session configuration
 */
export type AWSSSOSession = {
  name: string;
  startUrl: string;
  region: string;
  registrationScopes?: string[];
};

/**
 * Credentials manager options
 */
export type CredentialsManagerOptions = {
  defaultProfile?: string;
  defaultRegion?: string;
  credentialsFile?: string;
  configFile?: string;
  cacheCredentials?: boolean;
  cacheTTL?: number;
  autoRefresh?: boolean;
  refreshThreshold?: number;
};

/**
 * Credential resolution result
 */
export type CredentialResolutionResult = {
  credentials: AWSCredentials;
  profile?: string;
  region: string;
  accountId?: string;
  resolvedAt: Date;
  expiresAt?: Date;
};

// =============================================================================
// CLI Types
// =============================================================================

/**
 * AWS CLI execution options
 */
export type AWSCLIOptions = {
  profile?: string;
  region?: string;
  output?: "json" | "yaml" | "text" | "table";
  timeout?: number;
  retries?: number;
  debug?: boolean;
  dryRun?: boolean;
  noVerifySSL?: boolean;
  endpointUrl?: string;
};

/**
 * AWS CLI command result
 */
export type AWSCLIResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: AWSCLIError;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  command: string;
};

/**
 * AWS CLI error details
 */
export type AWSCLIError = {
  code: string;
  message: string;
  requestId?: string;
  service?: string;
  operation?: string;
  retryable: boolean;
  statusCode?: number;
};

/**
 * AWS CLI wrapper configuration
 */
export type AWSCLIConfig = {
  cliPath?: string;
  defaultOptions?: AWSCLIOptions;
  maxRetries?: number;
  retryDelay?: number;
  commandTimeout?: number;
};

// =============================================================================
// Client Pool Types
// =============================================================================

/**
 * Supported AWS service names
 */
export type AWSServiceName =
  | "ec2"
  | "s3"
  | "iam"
  | "sts"
  | "lambda"
  | "dynamodb"
  | "rds"
  | "cloudformation"
  | "cloudwatch"
  | "cloudtrail"
  | "sns"
  | "sqs"
  | "ecs"
  | "eks"
  | "ecr"
  | "secretsmanager"
  | "ssm"
  | "kms"
  | "route53"
  | "elasticache"
  | "organizations"
  | "resourcegroupstaggingapi";

/**
 * Client pool configuration
 */
export type ClientPoolConfig = {
  maxClientsPerService?: number;
  maxTotalClients?: number;
  clientTTL?: number;
  cleanupInterval?: number;
  preloadServices?: AWSServiceName[];
  defaultRegion?: string;
};

/**
 * Client pool entry
 */
export type ClientPoolEntry = {
  service: AWSServiceName;
  region: string;
  profile?: string;
  client: unknown;
  createdAt: Date;
  lastUsedAt: Date;
  useCount: number;
};

/**
 * Client pool statistics
 */
export type ClientPoolStats = {
  totalClients: number;
  clientsByService: Record<string, number>;
  clientsByRegion: Record<string, number>;
  activeClients: number;
  idleClients: number;
  evictedClients: number;
  cacheHits: number;
  cacheMisses: number;
};

// =============================================================================
// Context Types
// =============================================================================

/**
 * AWS context configuration
 */
export type AWSContext = {
  profile?: string;
  region: string;
  accountId?: string;
  accountAlias?: string;
  partition?: "aws" | "aws-cn" | "aws-us-gov";
  userId?: string;
  arn?: string;
};

/**
 * Context switch options
 */
export type ContextSwitchOptions = {
  validateAccess?: boolean;
  refreshCredentials?: boolean;
  updateDefaultRegion?: boolean;
};

/**
 * Account information
 */
export type AWSAccountInfo = {
  accountId: string;
  accountAlias?: string;
  accountName?: string;
  accountEmail?: string;
  organizationId?: string;
  organizationalUnitId?: string;
  status?: "ACTIVE" | "SUSPENDED" | "PENDING_CLOSURE";
};

/**
 * Region information
 */
export type AWSRegionInfo = {
  regionName: string;
  endpoint: string;
  optInStatus?: "opt-in-not-required" | "opted-in" | "not-opted-in";
  available: boolean;
};

// =============================================================================
// Service Discovery Types
// =============================================================================

/**
 * AWS service category
 */
export type AWSServiceCategory =
  | "compute"
  | "storage"
  | "database"
  | "networking"
  | "security"
  | "analytics"
  | "machine-learning"
  | "management"
  | "developer-tools"
  | "application-integration"
  | "containers"
  | "serverless"
  | "other";

/**
 * AWS service metadata
 */
export type AWSServiceMetadata = {
  serviceName: string;
  serviceCode: string;
  category: AWSServiceCategory;
  description: string;
  regions: string[];
  globalService: boolean;
  pricing?: {
    freeTier?: boolean;
    pricingUrl?: string;
  };
  endpoints: Record<string, string>;
  quotas?: AWSServiceQuota[];
};

/**
 * AWS service quota
 */
export type AWSServiceQuota = {
  quotaName: string;
  quotaCode: string;
  value: number;
  unit: string;
  adjustable: boolean;
  globalQuota: boolean;
};

/**
 * Resource enumeration options
 */
export type ResourceEnumerationOptions = {
  services?: AWSServiceName[];
  regions?: string[];
  resourceTypes?: string[];
  tags?: Record<string, string>;
  maxResults?: number;
  includeGlobalResources?: boolean;
};

/**
 * Discovered AWS resource
 */
export type AWSResource = {
  resourceArn: string;
  resourceType: string;
  service: string;
  region: string;
  accountId: string;
  resourceId: string;
  resourceName?: string;
  tags: Record<string, string>;
  createdAt?: Date;
  state?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Service discovery result
 */
export type ServiceDiscoveryResult = {
  services: AWSServiceMetadata[];
  availableRegions: AWSRegionInfo[];
  accountInfo: AWSAccountInfo;
  discoveredAt: Date;
};

// =============================================================================
// Tagging Types
// =============================================================================

/**
 * Tag key-value pair
 */
export type AWSTag = {
  key: string;
  value: string;
};

/**
 * Standard tag configuration
 */
export type StandardTagConfig = {
  required: AWSTag[];
  optional: AWSTag[];
  prohibited: string[];
  keyPrefix?: string;
  keyPattern?: RegExp;
  valuePattern?: RegExp;
  maxKeyLength?: number;
  maxValueLength?: number;
  maxTagsPerResource?: number;
  caseSensitive?: boolean;
};

/**
 * Tag validation result
 */
export type TagValidationResult = {
  valid: boolean;
  errors: TagValidationError[];
  warnings: TagValidationWarning[];
  suggestions: TagSuggestion[];
};

/**
 * Tag validation error
 */
export type TagValidationError = {
  type: "missing-required" | "prohibited-key" | "invalid-format" | "too-long" | "too-many-tags";
  key?: string;
  value?: string;
  message: string;
};

/**
 * Tag validation warning
 */
export type TagValidationWarning = {
  type: "non-standard-key" | "empty-value" | "case-mismatch";
  key: string;
  value?: string;
  message: string;
  suggestion?: string;
};

/**
 * Tag suggestion
 */
export type TagSuggestion = {
  key: string;
  suggestedValue?: string;
  reason: string;
};

/**
 * Tagging operation
 */
export type TaggingOperation = {
  action: "add" | "update" | "remove";
  resourceArn: string;
  tags: AWSTag[];
};

/**
 * Tagging operation result
 */
export type TaggingOperationResult = {
  success: boolean;
  resourceArn: string;
  operation: "add" | "update" | "remove";
  tagsApplied?: AWSTag[];
  tagsRemoved?: string[];
  error?: string;
};

// =============================================================================
// CloudTrail Types
// =============================================================================

/**
 * CloudTrail event category
 */
export type CloudTrailEventCategory =
  | "Management"
  | "Data"
  | "Insights";

/**
 * CloudTrail event
 */
export type CloudTrailEvent = {
  eventId: string;
  eventName: string;
  eventTime: Date;
  eventSource: string;
  eventType?: string;
  eventCategory?: CloudTrailEventCategory;
  awsRegion: string;
  sourceIPAddress?: string;
  userAgent?: string;
  userIdentity: CloudTrailUserIdentity;
  requestParameters?: Record<string, unknown>;
  responseElements?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  readOnly?: boolean;
  resources?: CloudTrailResource[];
  recipientAccountId?: string;
  managementEvent?: boolean;
  sharedEventId?: string;
  vpcEndpointId?: string;
};

/**
 * CloudTrail user identity
 */
export type CloudTrailUserIdentity = {
  type: string;
  principalId?: string;
  arn?: string;
  accountId?: string;
  accessKeyId?: string;
  userName?: string;
  sessionContext?: {
    sessionIssuer?: {
      type?: string;
      principalId?: string;
      arn?: string;
      accountId?: string;
      userName?: string;
    };
    webIdFederationData?: Record<string, unknown>;
    attributes?: {
      mfaAuthenticated?: string;
      creationDate?: string;
    };
  };
  invokedBy?: string;
};

/**
 * CloudTrail resource
 */
export type CloudTrailResource = {
  resourceType?: string;
  resourceName?: string;
  resourceArn?: string;
};

/**
 * CloudTrail query options
 */
export type CloudTrailQueryOptions = {
  startTime?: Date;
  endTime?: Date;
  region?: string;
  eventName?: string;
  eventNames?: string[];
  eventSource?: string;
  eventSources?: string[];
  eventId?: string;
  username?: string;
  resourceType?: string;
  resourceName?: string;
  userIdentity?: {
    type?: string;
    userName?: string;
    principalId?: string;
  };
  resources?: {
    resourceType?: string;
    resourceName?: string;
  };
  readOnly?: boolean;
  maxResults?: number;
  lookupAttributes?: Array<{
    attributeKey: string;
    attributeValue: string;
  }>;
};

/**
 * CloudTrail trail info
 */
export type CloudTrailTrailInfo = {
  name: string;
  arn?: string;
  homeRegion?: string;
  s3BucketName?: string;
  s3KeyPrefix?: string;
  isMultiRegion: boolean;
  isOrganizationTrail: boolean;
  includeGlobalServiceEvents: boolean;
  hasLogFileValidation: boolean;
  isLogging: boolean;
  latestDeliveryTime?: Date;
  hasDataEvents: boolean;
  hasManagementEvents: boolean;
  cloudWatchLogsLogGroupArn?: string;
  cloudWatchLogsRoleArn?: string;
  kmsKeyId?: string;
};

/**
 * CloudTrail audit summary
 */
export type CloudTrailAuditSummary = {
  totalEvents: number;
  timeRange: {
    start: Date;
    end: Date;
  };
  readOnlyCount: number;
  writeCount: number;
  errorCount: number;
  infrastructureChangeCount: number;
  securityEventCount: number;
  topEvents: Array<{ name: string; count: number }>;
  topUsers: Array<{ name: string; count: number }>;
  topServices: Array<{ name: string; count: number }>;
  topErrors: Array<{ name: string; count: number }>;
  topRegions: Array<{ name: string; count: number }>;
};

/**
 * CloudTrail trail configuration
 */
export type CloudTrailConfig = {
  trailArn?: string;
  defaultLookbackDays?: number;
  includeGlobalServiceEvents?: boolean;
  isMultiRegionTrail?: boolean;
  eventSelectors?: Array<{
    readWriteType: "ReadOnly" | "WriteOnly" | "All";
    includeManagementEvents: boolean;
    dataResources?: Array<{
      type: string;
      values: string[];
    }>;
  }>;
};

/**
 * Audit event for infrastructure operations
 */
export type AWSAuditEvent = {
  eventId: string;
  timestamp: Date;
  action: string;
  service: string;
  region: string;
  accountId: string;
  actor: {
    type: string;
    identity: string;
    ipAddress?: string;
  };
  resources: Array<{
    type: string;
    id: string;
    arn?: string;
  }>;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
};

// =============================================================================
// Plugin Types
// =============================================================================

/**
 * AWS plugin configuration
 */
export type AWSPluginConfig = {
  credentials?: CredentialsManagerOptions;
  cli?: AWSCLIConfig;
  clientPool?: ClientPoolConfig;
  tagging?: StandardTagConfig;
  cloudtrail?: CloudTrailConfig;
  defaultRegion?: string;
  defaultProfile?: string;
};

/**
 * AWS plugin status
 */
export type AWSPluginStatus = {
  initialized: boolean;
  credentialsValid: boolean;
  currentContext: AWSContext | null;
  clientPoolStats: ClientPoolStats;
  lastError?: string;
};
