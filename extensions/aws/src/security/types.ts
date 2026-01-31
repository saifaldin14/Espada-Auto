/**
 * AWS Security & IAM Types
 *
 * Type definitions for IAM, Security Hub, GuardDuty, KMS,
 * Secrets Manager, and Access Analyzer operations.
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Security operation result
 */
export interface SecurityOperationResult<T = void> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/**
 * Security Manager configuration
 */
export interface SecurityManagerConfig {
  /** Default AWS region */
  defaultRegion?: string;
  /** AWS credentials */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

// =============================================================================
// IAM Types
// =============================================================================

/**
 * IAM role information
 */
export interface IAMRoleInfo {
  roleName: string;
  roleId: string;
  arn: string;
  path: string;
  description?: string;
  createDate: Date;
  maxSessionDuration: number;
  assumeRolePolicyDocument: string;
  tags: Record<string, string>;
  attachedPolicies: AttachedPolicy[];
  inlinePolicies: string[];
  permissionsBoundary?: string;
}

/**
 * Attached policy information
 */
export interface AttachedPolicy {
  policyName: string;
  policyArn: string;
}

/**
 * IAM user information
 */
export interface IAMUserInfo {
  userName: string;
  userId: string;
  arn: string;
  path: string;
  createDate: Date;
  passwordLastUsed?: Date;
  tags: Record<string, string>;
  attachedPolicies: AttachedPolicy[];
  inlinePolicies: string[];
  groups: string[];
  accessKeys: AccessKeyInfo[];
  mfaDevices: MFADeviceInfo[];
  permissionsBoundary?: string;
}

/**
 * Access key information
 */
export interface AccessKeyInfo {
  accessKeyId: string;
  status: 'Active' | 'Inactive';
  createDate: Date;
  lastUsedDate?: Date;
  lastUsedService?: string;
  lastUsedRegion?: string;
}

/**
 * MFA device information
 */
export interface MFADeviceInfo {
  serialNumber: string;
  enableDate: Date;
  type: 'virtual' | 'hardware' | 'u2f';
}

/**
 * IAM policy information
 */
export interface IAMPolicyInfo {
  policyName: string;
  policyId: string;
  arn: string;
  path: string;
  description?: string;
  createDate: Date;
  updateDate: Date;
  defaultVersionId: string;
  attachmentCount: number;
  permissionsBoundaryUsageCount: number;
  isAttachable: boolean;
  tags: Record<string, string>;
}

/**
 * Policy document structure
 */
export interface PolicyDocument {
  Version: '2012-10-17' | '2008-10-17';
  Statement: PolicyStatement[];
}

/**
 * Policy statement structure
 */
export interface PolicyStatement {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Principal?: PolicyPrincipal;
  NotPrincipal?: PolicyPrincipal;
  Action: string | string[];
  NotAction?: string | string[];
  Resource?: string | string[];
  NotResource?: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}

/**
 * Policy principal types
 */
export type PolicyPrincipal =
  | '*'
  | {
      AWS?: string | string[];
      Service?: string | string[];
      Federated?: string | string[];
    };

/**
 * Trust policy for IAM roles
 */
export interface TrustPolicy {
  Version: '2012-10-17';
  Statement: TrustPolicyStatement[];
}

/**
 * Trust policy statement
 */
export interface TrustPolicyStatement {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Principal: PolicyPrincipal;
  Action: 'sts:AssumeRole' | 'sts:AssumeRoleWithSAML' | 'sts:AssumeRoleWithWebIdentity' | string;
  Condition?: Record<string, Record<string, string | string[]>>;
}

/**
 * Options for listing IAM roles
 */
export interface ListRolesOptions {
  pathPrefix?: string;
  maxItems?: number;
  includeAttachedPolicies?: boolean;
  includeInlinePolicies?: boolean;
  tag?: { key: string; value: string };
}

/**
 * Options for listing IAM users
 */
export interface ListUsersOptions {
  pathPrefix?: string;
  maxItems?: number;
  includeAttachedPolicies?: boolean;
  includeInlinePolicies?: boolean;
  includeAccessKeys?: boolean;
  includeMFADevices?: boolean;
}

/**
 * Options for listing IAM policies
 */
export interface ListPoliciesOptions {
  scope?: 'All' | 'AWS' | 'Local';
  onlyAttached?: boolean;
  pathPrefix?: string;
  policyUsageFilter?: 'PermissionsPolicy' | 'PermissionsBoundary';
  maxItems?: number;
}

/**
 * Options for creating IAM role
 */
export interface CreateRoleOptions {
  roleName: string;
  trustPolicy: TrustPolicy;
  description?: string;
  path?: string;
  maxSessionDuration?: number;
  permissionsBoundary?: string;
  tags?: Record<string, string>;
  managedPolicyArns?: string[];
  inlinePolicies?: { name: string; document: PolicyDocument }[];
}

/**
 * Options for creating IAM policy
 */
export interface CreatePolicyOptions {
  policyName: string;
  policyDocument: PolicyDocument;
  description?: string;
  path?: string;
  tags?: Record<string, string>;
}

/**
 * Options for creating IAM user
 */
export interface CreateUserOptions {
  userName: string;
  path?: string;
  permissionsBoundary?: string;
  tags?: Record<string, string>;
  createAccessKey?: boolean;
  createLoginProfile?: boolean;
  passwordResetRequired?: boolean;
}

/**
 * Created user result
 */
export interface CreateUserResult {
  user: IAMUserInfo;
  accessKey?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  loginProfile?: {
    password: string;
    passwordResetRequired: boolean;
  };
}

/**
 * Common AWS service principals for trust policies
 */
export type AWSServicePrincipal =
  | 'ec2.amazonaws.com'
  | 'lambda.amazonaws.com'
  | 'ecs.amazonaws.com'
  | 'ecs-tasks.amazonaws.com'
  | 'eks.amazonaws.com'
  | 'rds.amazonaws.com'
  | 'elasticmapreduce.amazonaws.com'
  | 's3.amazonaws.com'
  | 'sns.amazonaws.com'
  | 'sqs.amazonaws.com'
  | 'events.amazonaws.com'
  | 'states.amazonaws.com'
  | 'codebuild.amazonaws.com'
  | 'codepipeline.amazonaws.com'
  | 'cloudformation.amazonaws.com'
  | 'apigateway.amazonaws.com'
  | 'firehose.amazonaws.com'
  | 'glue.amazonaws.com'
  | 'application-autoscaling.amazonaws.com';

// =============================================================================
// Security Hub Types
// =============================================================================

/**
 * Security Hub finding severity
 */
export type SecurityFindingSeverity = 'INFORMATIONAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Security Hub finding status
 */
export type SecurityFindingStatus = 'NEW' | 'NOTIFIED' | 'RESOLVED' | 'SUPPRESSED';

/**
 * Security Hub workflow status
 */
export type WorkflowStatus = 'NEW' | 'NOTIFIED' | 'RESOLVED' | 'SUPPRESSED';

/**
 * Security Hub compliance status
 */
export type ComplianceStatus = 'PASSED' | 'WARNING' | 'FAILED' | 'NOT_AVAILABLE';

/**
 * Security Hub finding
 */
export interface SecurityFinding {
  id: string;
  productArn: string;
  generatorId: string;
  awsAccountId: string;
  title: string;
  description: string;
  severity: {
    label: SecurityFindingSeverity;
    normalized: number;
  };
  confidence?: number;
  criticality?: number;
  types: string[];
  firstObservedAt?: Date;
  lastObservedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  resources: SecurityFindingResource[];
  compliance?: {
    status: ComplianceStatus;
    relatedRequirements?: string[];
  };
  workflow?: {
    status: WorkflowStatus;
  };
  recordState: 'ACTIVE' | 'ARCHIVED';
  remediation?: {
    recommendation?: {
      text?: string;
      url?: string;
    };
  };
  productFields?: Record<string, string>;
  region: string;
}

/**
 * Security finding resource
 */
export interface SecurityFindingResource {
  type: string;
  id: string;
  partition: string;
  region: string;
  tags?: Record<string, string>;
  details?: Record<string, unknown>;
}

/**
 * Options for listing Security Hub findings
 */
export interface ListSecurityFindingsOptions {
  region?: string;
  severities?: SecurityFindingSeverity[];
  statuses?: SecurityFindingStatus[];
  resourceTypes?: string[];
  complianceStatus?: ComplianceStatus;
  recordState?: 'ACTIVE' | 'ARCHIVED';
  productArn?: string;
  maxResults?: number;
  sortField?: 'Title' | 'Severity' | 'CreatedAt' | 'UpdatedAt';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Security Hub standard
 */
export interface SecurityStandard {
  standardsArn: string;
  name: string;
  description?: string;
  enabledByDefault: boolean;
  subscriptionArn?: string;
  enabled: boolean;
}

/**
 * Security Hub control
 */
export interface SecurityControl {
  controlId: string;
  title: string;
  description: string;
  remediationUrl?: string;
  severityRating: SecurityFindingSeverity;
  currentStatus: 'ENABLED' | 'DISABLED';
  statusReasons?: string[];
}

// =============================================================================
// GuardDuty Types
// =============================================================================

/**
 * GuardDuty finding severity level
 */
export type GuardDutySeverity = 'Low' | 'Medium' | 'High';

/**
 * GuardDuty finding
 */
export interface GuardDutyFinding {
  id: string;
  accountId: string;
  arn: string;
  type: string;
  title: string;
  description: string;
  severity: number;
  severityLabel: GuardDutySeverity;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
  region: string;
  resourceType: string;
  resource: GuardDutyResource;
  service: GuardDutyService;
}

/**
 * GuardDuty resource details
 */
export interface GuardDutyResource {
  resourceType: string;
  instanceDetails?: {
    instanceId?: string;
    instanceType?: string;
    launchTime?: Date;
    platform?: string;
    availabilityZone?: string;
    imageId?: string;
    imageDescription?: string;
    networkInterfaces?: Array<{
      networkInterfaceId?: string;
      privateDnsName?: string;
      privateIpAddress?: string;
      publicDnsName?: string;
      publicIp?: string;
      securityGroups?: Array<{ groupId?: string; groupName?: string }>;
      subnetId?: string;
      vpcId?: string;
    }>;
    tags?: Array<{ key: string; value: string }>;
  };
  accessKeyDetails?: {
    accessKeyId?: string;
    principalId?: string;
    userName?: string;
    userType?: string;
  };
  s3BucketDetails?: Array<{
    arn?: string;
    name?: string;
    type?: string;
    createdAt?: Date;
    owner?: { id?: string };
    tags?: Array<{ key: string; value: string }>;
    publicAccess?: {
      permissionConfiguration?: {
        bucketLevelPermissions?: unknown;
        accountLevelPermissions?: unknown;
      };
      effectivePermission?: string;
    };
  }>;
  containerDetails?: {
    containerRuntime?: string;
    id?: string;
    name?: string;
    image?: string;
    imagePrefix?: string;
    securityContext?: unknown;
  };
  eksClusterDetails?: {
    name?: string;
    arn?: string;
    vpcId?: string;
    status?: string;
    tags?: Array<{ key: string; value: string }>;
    createdAt?: Date;
  };
  rdsDbInstanceDetails?: {
    dbInstanceIdentifier?: string;
    engine?: string;
    engineVersion?: string;
    dbClusterIdentifier?: string;
    dbInstanceArn?: string;
    tags?: Array<{ key: string; value: string }>;
  };
}

/**
 * GuardDuty service details
 */
export interface GuardDutyService {
  action?: {
    actionType?: string;
    awsApiCallAction?: {
      api?: string;
      serviceName?: string;
      callerType?: string;
      remoteIpDetails?: RemoteIpDetails;
      errorCode?: string;
    };
    networkConnectionAction?: {
      connectionDirection?: string;
      protocol?: string;
      localPortDetails?: { port?: number; portName?: string };
      remotePortDetails?: { port?: number; portName?: string };
      remoteIpDetails?: RemoteIpDetails;
      blocked?: boolean;
      localIpDetails?: { ipAddressV4?: string };
    };
    dnsRequestAction?: {
      domain?: string;
      protocol?: string;
      blocked?: boolean;
    };
    portProbeAction?: {
      blocked?: boolean;
      portProbeDetails?: Array<{
        localPortDetails?: { port?: number; portName?: string };
        remoteIpDetails?: RemoteIpDetails;
      }>;
    };
    kubernetesApiCallAction?: {
      requestUri?: string;
      verb?: string;
      userAgent?: string;
      remoteIpDetails?: RemoteIpDetails;
      statusCode?: number;
      parameters?: string;
    };
  };
  evidence?: {
    threatIntelligenceDetails?: Array<{
      threatListName?: string;
      threatNames?: string[];
    }>;
  };
  archived?: boolean;
  count?: number;
  detectorId?: string;
  eventFirstSeen?: string;
  eventLastSeen?: string;
  resourceRole?: string;
  serviceName?: string;
  userFeedback?: string;
  additionalInfo?: unknown;
}

/**
 * Remote IP details
 */
export interface RemoteIpDetails {
  ipAddressV4?: string;
  organization?: {
    asn?: string;
    asnOrg?: string;
    isp?: string;
    org?: string;
  };
  country?: {
    countryCode?: string;
    countryName?: string;
  };
  city?: {
    cityName?: string;
  };
  geoLocation?: {
    lat?: number;
    lon?: number;
  };
}

/**
 * Options for listing GuardDuty findings
 */
export interface ListGuardDutyFindingsOptions {
  region?: string;
  detectorId?: string;
  severities?: GuardDutySeverity[];
  types?: string[];
  archived?: boolean;
  maxResults?: number;
  sortBy?: 'Severity' | 'CreatedAt' | 'UpdatedAt';
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * GuardDuty detector information
 */
export interface GuardDutyDetector {
  detectorId: string;
  status: 'ENABLED' | 'DISABLED';
  createdAt: Date;
  updatedAt: Date;
  findingPublishingFrequency: 'FIFTEEN_MINUTES' | 'ONE_HOUR' | 'SIX_HOURS';
  dataSources: {
    cloudTrail: { status: 'ENABLED' | 'DISABLED' };
    dnsLogs: { status: 'ENABLED' | 'DISABLED' };
    flowLogs: { status: 'ENABLED' | 'DISABLED' };
    s3Logs: { status: 'ENABLED' | 'DISABLED' };
    kubernetes?: { auditLogs: { status: 'ENABLED' | 'DISABLED' } };
    malwareProtection?: { scanEc2InstanceWithFindings: { ebsVolumes: { status: 'ENABLED' | 'DISABLED' } } };
  };
  tags: Record<string, string>;
  region: string;
}

// =============================================================================
// KMS Types
// =============================================================================

/**
 * KMS key state
 */
export type KMSKeyState =
  | 'Creating'
  | 'Enabled'
  | 'Disabled'
  | 'PendingDeletion'
  | 'PendingImport'
  | 'PendingReplicaDeletion'
  | 'Unavailable'
  | 'Updating';

/**
 * KMS key spec
 */
export type KMSKeySpec =
  | 'SYMMETRIC_DEFAULT'
  | 'RSA_2048'
  | 'RSA_3072'
  | 'RSA_4096'
  | 'ECC_NIST_P256'
  | 'ECC_NIST_P384'
  | 'ECC_NIST_P521'
  | 'ECC_SECG_P256K1'
  | 'HMAC_224'
  | 'HMAC_256'
  | 'HMAC_384'
  | 'HMAC_512'
  | 'SM2';

/**
 * KMS key usage
 */
export type KMSKeyUsage = 'SIGN_VERIFY' | 'ENCRYPT_DECRYPT' | 'GENERATE_VERIFY_MAC';

/**
 * KMS key origin
 */
export type KMSKeyOrigin = 'AWS_KMS' | 'EXTERNAL' | 'AWS_CLOUDHSM' | 'EXTERNAL_KEY_STORE';

/**
 * KMS key information
 */
export interface KMSKeyInfo {
  keyId: string;
  arn: string;
  description?: string;
  keyState: KMSKeyState;
  keyUsage: KMSKeyUsage;
  keySpec: KMSKeySpec;
  origin: KMSKeyOrigin;
  creationDate: Date;
  enabled: boolean;
  deletionDate?: Date;
  keyManager: 'AWS' | 'CUSTOMER';
  customerMasterKeySpec?: string;
  encryptionAlgorithms?: string[];
  signingAlgorithms?: string[];
  multiRegion: boolean;
  multiRegionConfiguration?: {
    multiRegionKeyType: 'PRIMARY' | 'REPLICA';
    primaryKey?: { arn: string; region: string };
    replicaKeys?: Array<{ arn: string; region: string }>;
  };
  pendingDeletionWindowInDays?: number;
  macAlgorithms?: string[];
  xksKeyConfiguration?: unknown;
  aliases: string[];
  tags: Record<string, string>;
  rotationEnabled?: boolean;
  policy?: string;
  region: string;
}

/**
 * Options for listing KMS keys
 */
export interface ListKMSKeysOptions {
  region?: string;
  includeAliases?: boolean;
  includeTags?: boolean;
  includePolicy?: boolean;
  includeRotationStatus?: boolean;
  keyManager?: 'AWS' | 'CUSTOMER';
  maxResults?: number;
}

/**
 * Options for creating KMS key
 */
export interface CreateKMSKeyOptions {
  region?: string;
  description?: string;
  keyUsage?: KMSKeyUsage;
  keySpec?: KMSKeySpec;
  origin?: KMSKeyOrigin;
  multiRegion?: boolean;
  bypassPolicyLockoutSafetyCheck?: boolean;
  policy?: string;
  tags?: Record<string, string>;
  enableKeyRotation?: boolean;
}

/**
 * KMS key policy
 */
export interface KMSKeyPolicy {
  Version: '2012-10-17';
  Id?: string;
  Statement: KMSPolicyStatement[];
}

/**
 * KMS policy statement
 */
export interface KMSPolicyStatement {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Principal: PolicyPrincipal;
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}

// =============================================================================
// Secrets Manager Types
// =============================================================================

/**
 * Secret information
 */
export interface SecretInfo {
  arn: string;
  name: string;
  description?: string;
  kmsKeyId?: string;
  rotationEnabled: boolean;
  rotationLambdaArn?: string;
  rotationRules?: {
    automaticallyAfterDays?: number;
    scheduleExpression?: string;
  };
  lastRotatedDate?: Date;
  lastChangedDate?: Date;
  lastAccessedDate?: Date;
  deletedDate?: Date;
  createdDate: Date;
  primaryRegion?: string;
  replicationStatus?: Array<{
    region: string;
    kmsKeyId?: string;
    status: 'InSync' | 'Failed' | 'InProgress';
    statusMessage?: string;
    lastAccessedDate?: Date;
  }>;
  tags: Record<string, string>;
  owningService?: string;
  region: string;
}

/**
 * Secret version information
 */
export interface SecretVersionInfo {
  versionId: string;
  versionStages: string[];
  createdDate: Date;
  lastAccessedDate?: Date;
  kmsKeyIds?: string[];
}

/**
 * Options for listing secrets
 */
export interface ListSecretsOptions {
  region?: string;
  maxResults?: number;
  includePlannedDeletion?: boolean;
  filters?: Array<{
    key: 'description' | 'name' | 'tag-key' | 'tag-value' | 'primary-region' | 'owning-service' | 'all';
    values: string[];
  }>;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Options for creating secret
 */
export interface CreateSecretOptions {
  region?: string;
  name: string;
  description?: string;
  kmsKeyId?: string;
  secretString?: string;
  secretBinary?: Uint8Array;
  tags?: Record<string, string>;
  addReplicaRegions?: Array<{
    region: string;
    kmsKeyId?: string;
  }>;
  forceOverwriteReplicaSecret?: boolean;
}

/**
 * Options for updating secret
 */
export interface UpdateSecretOptions {
  secretId: string;
  region?: string;
  description?: string;
  kmsKeyId?: string;
  secretString?: string;
  secretBinary?: Uint8Array;
}

/**
 * Options for rotating secret
 */
export interface RotateSecretOptions {
  secretId: string;
  region?: string;
  rotationLambdaArn?: string;
  rotationRules?: {
    automaticallyAfterDays?: number;
    scheduleExpression?: string;
  };
  rotateImmediately?: boolean;
}

/**
 * Secret value result
 */
export interface SecretValue {
  arn: string;
  name: string;
  versionId: string;
  versionStages: string[];
  secretString?: string;
  secretBinary?: Uint8Array;
  createdDate: Date;
}

// =============================================================================
// Access Analyzer Types
// =============================================================================

/**
 * Access Analyzer finding status
 */
export type AccessAnalyzerFindingStatus = 'ACTIVE' | 'ARCHIVED' | 'RESOLVED';

/**
 * Access Analyzer resource type
 */
export type AccessAnalyzerResourceType =
  | 'AWS::S3::Bucket'
  | 'AWS::IAM::Role'
  | 'AWS::SQS::Queue'
  | 'AWS::Lambda::Function'
  | 'AWS::Lambda::LayerVersion'
  | 'AWS::KMS::Key'
  | 'AWS::SecretsManager::Secret'
  | 'AWS::EFS::FileSystem'
  | 'AWS::EC2::Snapshot'
  | 'AWS::ECR::Repository'
  | 'AWS::RDS::DBSnapshot'
  | 'AWS::RDS::DBClusterSnapshot'
  | 'AWS::SNS::Topic';

/**
 * Access Analyzer finding
 */
export interface AccessAnalyzerFinding {
  id: string;
  analyzerArn: string;
  analyzedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  status: AccessAnalyzerFindingStatus;
  resourceType: AccessAnalyzerResourceType;
  resource: string;
  resourceOwnerAccount: string;
  isPublic: boolean;
  principal?: Record<string, string>;
  action?: string[];
  condition?: Record<string, Record<string, string | string[]>>;
  error?: string;
  sources?: Array<{
    type: 'POLICY' | 'BUCKET_ACL' | 'S3_ACCESS_POINT' | 'S3_ACCESS_POINT_ACCOUNT';
    detail?: {
      accessPointArn?: string;
      accessPointAccount?: string;
    };
  }>;
  region: string;
}

/**
 * Options for listing Access Analyzer findings
 */
export interface ListAccessAnalyzerFindingsOptions {
  region?: string;
  analyzerArn?: string;
  status?: AccessAnalyzerFindingStatus;
  resourceType?: AccessAnalyzerResourceType;
  maxResults?: number;
  sortBy?: 'resource' | 'analyzedAt' | 'updatedAt' | 'createdAt';
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * Access Analyzer information
 */
export interface AccessAnalyzerInfo {
  analyzerArn: string;
  analyzerName: string;
  type: 'ACCOUNT' | 'ORGANIZATION';
  createdAt: Date;
  lastResourceAnalyzed?: string;
  lastResourceAnalyzedAt?: Date;
  status: 'ACTIVE' | 'CREATING' | 'DISABLED' | 'FAILED';
  statusReason?: string;
  tags: Record<string, string>;
  region: string;
}

/**
 * Options for creating Access Analyzer
 */
export interface CreateAccessAnalyzerOptions {
  region?: string;
  analyzerName: string;
  type: 'ACCOUNT' | 'ORGANIZATION';
  archiveRules?: Array<{
    ruleName: string;
    filter: Record<string, {
      eq?: string[];
      neq?: string[];
      contains?: string[];
      exists?: boolean;
    }>;
  }>;
  tags?: Record<string, string>;
}

// =============================================================================
// Policy Simulation Types
// =============================================================================

/**
 * Policy simulation result
 */
export interface PolicySimulationResult {
  evalActionName: string;
  evalResourceName?: string;
  evalDecision: 'allowed' | 'explicitDeny' | 'implicitDeny';
  matchedStatements: Array<{
    sourcePolicyId?: string;
    sourcePolicyType?: string;
    startPosition?: { line: number; column: number };
    endPosition?: { line: number; column: number };
  }>;
  missingContextValues: string[];
  organizationsDecisionDetail?: {
    allowedByOrganizations?: boolean;
  };
  permissionsBoundaryDecisionDetail?: {
    allowedByPermissionsBoundary?: boolean;
  };
  evalDecisionDetails?: Record<string, string>;
  resourceSpecificResults?: Array<{
    evalResourceName: string;
    evalResourceDecision: 'allowed' | 'explicitDeny' | 'implicitDeny';
    matchedStatements: unknown[];
    missingContextValues: string[];
    evalDecisionDetails?: Record<string, string>;
  }>;
}

/**
 * Options for policy simulation
 */
export interface SimulatePolicyOptions {
  policySourceArn?: string;
  policyInputList?: string[];
  permissionsBoundaryPolicyInputList?: string[];
  actionNames: string[];
  resourceArns?: string[];
  resourcePolicy?: string;
  resourceOwner?: string;
  callerArn?: string;
  contextEntries?: Array<{
    contextKeyName: string;
    contextKeyValues: string[];
    contextKeyType: 'string' | 'stringList' | 'numeric' | 'numericList' | 'boolean' | 'booleanList' | 'ip' | 'ipList' | 'binary' | 'binaryList' | 'date' | 'dateList';
  }>;
  resourceHandlingOption?: 'SINGLE_RESOURCE' | 'MULTIPLE_RESOURCES';
}

// =============================================================================
// Security Summary Types
// =============================================================================

/**
 * Security posture summary
 */
export interface SecurityPostureSummary {
  timestamp: Date;
  region: string;
  iamSummary: {
    totalRoles: number;
    totalUsers: number;
    totalPolicies: number;
    usersWithoutMFA: number;
    accessKeysOlderThan90Days: number;
    unusedRoles: number;
    overprivilegedEntities: number;
  };
  securityHubSummary: {
    enabled: boolean;
    criticalFindings: number;
    highFindings: number;
    mediumFindings: number;
    lowFindings: number;
    informationalFindings: number;
    enabledStandards: string[];
    complianceScore?: number;
  };
  guardDutySummary: {
    enabled: boolean;
    highSeverityFindings: number;
    mediumSeverityFindings: number;
    lowSeverityFindings: number;
    totalFindings: number;
  };
  accessAnalyzerSummary: {
    enabled: boolean;
    activeFindings: number;
    publicResources: number;
    crossAccountAccess: number;
  };
  kmsSummary: {
    totalKeys: number;
    customerManagedKeys: number;
    keysWithoutRotation: number;
    keysInPendingDeletion: number;
  };
  secretsManagerSummary: {
    totalSecrets: number;
    secretsWithRotation: number;
    secretsWithoutRotation: number;
    secretsLastAccessedOver90Days: number;
  };
}

/**
 * Compliance framework
 */
export type ComplianceFramework =
  | 'AWS-Foundational-Security-Best-Practices'
  | 'CIS-AWS-Foundations-Benchmark'
  | 'PCI-DSS'
  | 'SOC-2'
  | 'NIST-800-53'
  | 'HIPAA'
  | 'ISO-27001';

/**
 * Compliance check result
 */
export interface ComplianceCheckResult {
  framework: ComplianceFramework;
  controlId: string;
  controlTitle: string;
  status: 'PASSED' | 'FAILED' | 'WARNING' | 'NOT_AVAILABLE';
  severity: SecurityFindingSeverity;
  resources: Array<{
    resourceId: string;
    resourceType: string;
    status: 'PASSED' | 'FAILED' | 'WARNING';
    detail?: string;
  }>;
  remediation?: string;
  remediationUrl?: string;
}

// =============================================================================
// Predefined Policy Templates
// =============================================================================

/**
 * Predefined IAM policy templates
 */
export type PolicyTemplate =
  | 'lambda-basic'
  | 'lambda-vpc'
  | 'lambda-s3-read'
  | 'lambda-s3-write'
  | 'lambda-dynamodb'
  | 'lambda-sqs'
  | 'lambda-sns'
  | 'ec2-ssm'
  | 'ecs-task'
  | 'eks-node'
  | 's3-read-only'
  | 's3-full-access'
  | 'dynamodb-read-only'
  | 'dynamodb-full-access'
  | 'cloudwatch-logs'
  | 'xray-tracing'
  | 'secrets-read'
  | 'kms-encrypt-decrypt'
  | 'assume-role'
  | 'cross-account-access';

/**
 * Policy template definition
 */
export interface PolicyTemplateDefinition {
  name: PolicyTemplate;
  description: string;
  document: PolicyDocument;
  variables?: string[];
}
