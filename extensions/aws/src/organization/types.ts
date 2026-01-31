/**
 * AWS Multi-Account & Organization Management Types
 *
 * Type definitions for AWS Organizations, cross-account operations,
 * Service Control Policies (SCPs), Resource Access Manager (RAM),
 * and consolidated billing operations.
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Organization operation result
 */
export interface OrganizationOperationResult<T = void> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/**
 * Organization Manager configuration
 */
export interface OrganizationManagerConfig {
  /** Default AWS region */
  defaultRegion?: string;
  /** AWS credentials */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** Management account ID */
  managementAccountId?: string;
  /** Default role name for cross-account access */
  defaultCrossAccountRoleName?: string;
  /** Default session duration in seconds */
  defaultSessionDurationSeconds?: number;
}

// =============================================================================
// Organization Types
// =============================================================================

/**
 * Organization status
 */
export type OrganizationStatus = 'ALL_FEATURES' | 'CONSOLIDATED_BILLING';

/**
 * Account status in organization
 */
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING_CLOSURE';

/**
 * Account join method
 */
export type AccountJoinMethod = 'INVITED' | 'CREATED';

/**
 * Organizational unit (OU) information
 */
export interface OrganizationalUnitInfo {
  /** OU ID */
  id: string;
  /** OU ARN */
  arn: string;
  /** OU name */
  name: string;
  /** Parent ID (organization root or parent OU) */
  parentId: string;
  /** Child OUs */
  childOUs?: OrganizationalUnitInfo[];
  /** Accounts in this OU */
  accounts?: AccountInfo[];
  /** Attached policies */
  attachedPolicies?: PolicyAttachment[];
  /** Tags */
  tags?: Record<string, string>;
}

/**
 * Organization root information
 */
export interface OrganizationRootInfo {
  /** Root ID */
  id: string;
  /** Root ARN */
  arn: string;
  /** Root name */
  name: string;
  /** Policy types enabled */
  policyTypes: PolicyTypeSummary[];
}

/**
 * Policy type summary
 */
export interface PolicyTypeSummary {
  /** Policy type */
  type: PolicyType;
  /** Status */
  status: 'ENABLED' | 'PENDING_ENABLE' | 'PENDING_DISABLE';
}

/**
 * Organization information
 */
export interface OrganizationInfo {
  /** Organization ID */
  id: string;
  /** Organization ARN */
  arn: string;
  /** Master account ID */
  masterAccountId: string;
  /** Master account email */
  masterAccountEmail: string;
  /** Master account ARN */
  masterAccountArn: string;
  /** Feature set (ALL_FEATURES or CONSOLIDATED_BILLING) */
  featureSet: OrganizationStatus;
  /** Available policy types */
  availablePolicyTypes: PolicyTypeSummary[];
  /** Organization roots */
  roots?: OrganizationRootInfo[];
}

/**
 * AWS account information
 */
export interface AccountInfo {
  /** Account ID (12-digit) */
  id: string;
  /** Account ARN */
  arn: string;
  /** Account name */
  name: string;
  /** Account email */
  email: string;
  /** Account status */
  status: AccountStatus;
  /** Join method */
  joinedMethod: AccountJoinMethod;
  /** Join timestamp */
  joinedTimestamp: Date;
  /** Organizational unit ID */
  organizationalUnitId?: string;
  /** Organizational unit name */
  organizationalUnitName?: string;
  /** Parent ID */
  parentId?: string;
  /** Tags */
  tags?: Record<string, string>;
  /** Is management account */
  isManagementAccount?: boolean;
  /** Is delegated administrator */
  isDelegatedAdmin?: boolean;
  /** Delegated services */
  delegatedServices?: string[];
}

/**
 * Detailed account information with extended data
 */
export interface DetailedAccountInfo extends AccountInfo {
  /** Alias for the account */
  alias?: string;
  /** IAM users count */
  iamUsersCount?: number;
  /** IAM roles count */
  iamRolesCount?: number;
  /** Regions in use */
  regionsInUse?: string[];
  /** Active services */
  activeServices?: string[];
  /** Cost data (if available) */
  costData?: {
    currentMonth: number;
    previousMonth: number;
    currency: string;
  };
}

/**
 * Options for listing accounts
 */
export interface ListAccountsOptions {
  /** Filter by status */
  status?: AccountStatus;
  /** Filter by OU ID */
  organizationalUnitId?: string;
  /** Include tags */
  includeTags?: boolean;
  /** Include cost data */
  includeCostData?: boolean;
  /** Maximum results */
  maxResults?: number;
  /** Next token for pagination */
  nextToken?: string;
}

/**
 * Options for creating an account
 */
export interface CreateAccountOptions {
  /** Account name */
  accountName: string;
  /** Account email (must be unique) */
  email: string;
  /** IAM user access to billing */
  iamUserAccessToBilling?: 'ALLOW' | 'DENY';
  /** Role name for cross-account access */
  roleName?: string;
  /** Tags to apply */
  tags?: Record<string, string>;
  /** Target OU ID */
  destinationParentId?: string;
}

/**
 * Account creation status
 */
export interface CreateAccountStatus {
  /** Request ID */
  id: string;
  /** Account ID (available when completed) */
  accountId?: string;
  /** Account name */
  accountName: string;
  /** State */
  state: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
  /** Failure reason (if failed) */
  failureReason?: string;
  /** Requested timestamp */
  requestedTimestamp: Date;
  /** Completed timestamp */
  completedTimestamp?: Date;
}

/**
 * Options for moving an account
 */
export interface MoveAccountOptions {
  /** Account ID to move */
  accountId: string;
  /** Source parent ID */
  sourceParentId: string;
  /** Destination parent ID (OU or root) */
  destinationParentId: string;
}

// =============================================================================
// Service Control Policy (SCP) Types
// =============================================================================

/**
 * Policy type
 */
export type PolicyType = 
  | 'SERVICE_CONTROL_POLICY'
  | 'TAG_POLICY'
  | 'BACKUP_POLICY'
  | 'AISERVICES_OPT_OUT_POLICY';

/**
 * Policy summary
 */
export interface PolicySummary {
  /** Policy ID */
  id: string;
  /** Policy ARN */
  arn: string;
  /** Policy name */
  name: string;
  /** Policy description */
  description?: string;
  /** Policy type */
  type: PolicyType;
  /** Is AWS managed policy */
  awsManaged: boolean;
}

/**
 * Service Control Policy information
 */
export interface SCPInfo extends PolicySummary {
  /** Policy document (JSON) */
  content: string;
  /** Parsed policy document */
  policyDocument?: SCPDocument;
  /** Targets attached to */
  targets?: PolicyTargetInfo[];
}

/**
 * SCP policy document
 */
export interface SCPDocument {
  /** Version */
  Version: string;
  /** Statements */
  Statement: SCPStatement[];
}

/**
 * SCP statement
 */
export interface SCPStatement {
  /** Statement ID */
  Sid?: string;
  /** Effect (Allow or Deny) */
  Effect: 'Allow' | 'Deny';
  /** Actions (or NotAction) */
  Action?: string | string[];
  NotAction?: string | string[];
  /** Resources (or NotResource) */
  Resource?: string | string[];
  NotResource?: string | string[];
  /** Conditions */
  Condition?: Record<string, Record<string, string | string[]>>;
}

/**
 * Policy target information
 */
export interface PolicyTargetInfo {
  /** Target ID (account, OU, or root) */
  targetId: string;
  /** Target ARN */
  arn: string;
  /** Target name */
  name: string;
  /** Target type */
  type: 'ACCOUNT' | 'ORGANIZATIONAL_UNIT' | 'ROOT';
}

/**
 * Policy attachment
 */
export interface PolicyAttachment {
  /** Policy ID */
  policyId: string;
  /** Policy name */
  policyName: string;
  /** Policy type */
  policyType: PolicyType;
  /** Is AWS managed */
  awsManaged: boolean;
}

/**
 * Options for creating an SCP
 */
export interface CreateSCPOptions {
  /** Policy name */
  name: string;
  /** Policy description */
  description?: string;
  /** Policy document (JSON string or object) */
  content: string | SCPDocument;
  /** Tags to apply */
  tags?: Record<string, string>;
  /** Policy type */
  type?: PolicyType;
}

/**
 * Options for updating an SCP
 */
export interface UpdateSCPOptions {
  /** Policy ID */
  policyId: string;
  /** New name */
  name?: string;
  /** New description */
  description?: string;
  /** New content */
  content?: string | SCPDocument;
}

/**
 * Options for listing policies
 */
export interface ListPoliciesOptions {
  /** Policy type filter */
  type?: PolicyType;
  /** Include full content */
  includeContent?: boolean;
  /** Maximum results */
  maxResults?: number;
  /** Next token */
  nextToken?: string;
}

// =============================================================================
// Cross-Account Access Types
// =============================================================================

/**
 * Assumed role credentials
 */
export interface AssumedRoleCredentials {
  /** Access key ID */
  accessKeyId: string;
  /** Secret access key */
  secretAccessKey: string;
  /** Session token */
  sessionToken: string;
  /** Expiration timestamp */
  expiration: Date;
  /** Assumed role ARN */
  assumedRoleArn: string;
  /** Account ID */
  accountId: string;
  /** Session name */
  sessionName: string;
}

/**
 * Options for assuming a role
 */
export interface AssumeRoleOptions {
  /** Target account ID */
  accountId: string;
  /** Role name to assume */
  roleName?: string;
  /** Role ARN (alternative to accountId + roleName) */
  roleArn?: string;
  /** Session name */
  sessionName?: string;
  /** Duration in seconds (900-43200) */
  durationSeconds?: number;
  /** External ID (if required by trust policy) */
  externalId?: string;
  /** Session tags */
  tags?: Record<string, string>;
  /** Policy to further restrict permissions */
  inlinePolicy?: string;
  /** MFA serial number */
  mfaSerialNumber?: string;
  /** MFA token code */
  mfaTokenCode?: string;
}

/**
 * Cross-account session
 */
export interface CrossAccountSession {
  /** Session ID */
  sessionId: string;
  /** Target account ID */
  accountId: string;
  /** Target account name */
  accountName?: string;
  /** Assumed role ARN */
  roleArn: string;
  /** Session name */
  sessionName: string;
  /** Credentials */
  credentials: AssumedRoleCredentials;
  /** Session start time */
  startTime: Date;
  /** Session expiration */
  expirationTime: Date;
  /** Is session active */
  isActive: boolean;
}

/**
 * Account context for operations
 */
export interface AccountContext {
  /** Current account ID */
  accountId: string;
  /** Current account name */
  accountName?: string;
  /** Current session */
  session?: CrossAccountSession;
  /** Is management account */
  isManagementAccount: boolean;
  /** Available regions */
  availableRegions: string[];
  /** Current region */
  currentRegion: string;
}

// =============================================================================
// Resource Access Manager (RAM) Types
// =============================================================================

/**
 * Resource share status
 */
export type ResourceShareStatus = 
  | 'PENDING'
  | 'ACTIVE'
  | 'FAILED'
  | 'DELETING'
  | 'DELETED';

/**
 * Resource share association status
 */
export type AssociationStatus =
  | 'ASSOCIATING'
  | 'ASSOCIATED'
  | 'FAILED'
  | 'DISASSOCIATING'
  | 'DISASSOCIATED';

/**
 * Resource share information
 */
export interface ResourceShareInfo {
  /** Resource share ARN */
  resourceShareArn: string;
  /** Resource share name */
  name: string;
  /** Owning account ID */
  owningAccountId: string;
  /** Allow external principals */
  allowExternalPrincipals: boolean;
  /** Status */
  status: ResourceShareStatus;
  /** Status message */
  statusMessage?: string;
  /** Creation time */
  creationTime: Date;
  /** Last updated time */
  lastUpdatedTime: Date;
  /** Feature set */
  featureSet?: 'CREATED_FROM_POLICY' | 'PROMOTING_TO_STANDARD' | 'STANDARD';
  /** Tags */
  tags?: Record<string, string>;
  /** Shared resources */
  resources?: SharedResourceInfo[];
  /** Principals */
  principals?: string[];
}

/**
 * Shared resource information
 */
export interface SharedResourceInfo {
  /** Resource ARN */
  arn: string;
  /** Resource type */
  type: string;
  /** Resource share ARN */
  resourceShareArn: string;
  /** Resource group ARN */
  resourceGroupArn?: string;
  /** Status */
  status: AssociationStatus;
  /** Status message */
  statusMessage?: string;
  /** Creation time */
  creationTime: Date;
  /** Last updated time */
  lastUpdatedTime: Date;
}

/**
 * Shareable resource types
 */
export type ShareableResourceType =
  | 'ec2:Subnet'
  | 'ec2:TransitGateway'
  | 'ec2:TrafficMirrorTarget'
  | 'ec2:CapacityReservation'
  | 'ec2:PrefixList'
  | 'ec2:LocalGatewayRouteTable'
  | 'ec2:DedicatedHost'
  | 'rds:Cluster'
  | 'rds:DBSnapshot'
  | 'rds:ClusterSnapshot'
  | 'route53resolver:ResolverRule'
  | 'license-manager:License'
  | 'network-firewall:FirewallPolicy'
  | 'network-firewall:RuleGroup'
  | 'outposts:Outpost'
  | 's3-outposts:Outpost'
  | 'glue:Database'
  | 'glue:Table'
  | 'resource-groups:Group'
  | 'codebuild:Project'
  | 'codebuild:ReportGroup'
  | string;

/**
 * Options for creating a resource share
 */
export interface CreateResourceShareOptions {
  /** Resource share name */
  name: string;
  /** Resource ARNs to share */
  resourceArns?: string[];
  /** Principals (account IDs, OU ARNs, or organization ARN) */
  principals?: string[];
  /** Allow external principals (outside organization) */
  allowExternalPrincipals?: boolean;
  /** Tags */
  tags?: Record<string, string>;
  /** Permission ARNs */
  permissionArns?: string[];
}

/**
 * Options for listing resource shares
 */
export interface ListResourceSharesOptions {
  /** Resource owner (SELF or OTHER-ACCOUNTS) */
  resourceOwner: 'SELF' | 'OTHER-ACCOUNTS';
  /** Filter by name */
  name?: string;
  /** Filter by status */
  status?: ResourceShareStatus;
  /** Maximum results */
  maxResults?: number;
  /** Next token */
  nextToken?: string;
}

// =============================================================================
// Consolidated Billing Types
// =============================================================================

/**
 * Consolidated billing summary
 */
export interface ConsolidatedBillingSummary {
  /** Billing period start */
  periodStart: Date;
  /** Billing period end */
  periodEnd: Date;
  /** Total cost */
  totalCost: number;
  /** Currency */
  currency: string;
  /** Account breakdown */
  accountBreakdown: AccountCostBreakdown[];
  /** Service breakdown */
  serviceBreakdown: ServiceCostBreakdown[];
  /** Linked account count */
  linkedAccountCount: number;
  /** Credits applied */
  creditsApplied?: number;
  /** Tax */
  tax?: number;
}

/**
 * Account cost breakdown
 */
export interface AccountCostBreakdown {
  /** Account ID */
  accountId: string;
  /** Account name */
  accountName: string;
  /** Total cost */
  cost: number;
  /** Percentage of total */
  percentage: number;
  /** Currency */
  currency: string;
  /** Month-over-month change */
  monthOverMonthChange?: number;
  /** Top services */
  topServices?: {
    service: string;
    cost: number;
  }[];
}

/**
 * Service cost breakdown
 */
export interface ServiceCostBreakdown {
  /** Service name */
  service: string;
  /** Total cost across all accounts */
  totalCost: number;
  /** Currency */
  currency: string;
  /** Account-level breakdown */
  accountCosts?: {
    accountId: string;
    accountName: string;
    cost: number;
  }[];
}

/**
 * Options for getting consolidated billing
 */
export interface GetConsolidatedBillingOptions {
  /** Start date */
  startDate: Date;
  /** End date */
  endDate: Date;
  /** Granularity */
  granularity?: 'DAILY' | 'MONTHLY';
  /** Group by dimension */
  groupBy?: ('ACCOUNT' | 'SERVICE' | 'REGION')[];
  /** Filter by account IDs */
  accountIds?: string[];
  /** Filter by services */
  services?: string[];
  /** Include forecasts */
  includeForecasts?: boolean;
}

// =============================================================================
// Organizational Unit Types
// =============================================================================

/**
 * Options for creating an OU
 */
export interface CreateOUOptions {
  /** Parent ID (root or OU) */
  parentId: string;
  /** OU name */
  name: string;
  /** Tags */
  tags?: Record<string, string>;
}

/**
 * Options for listing OUs
 */
export interface ListOUsOptions {
  /** Parent ID to list children of */
  parentId?: string;
  /** Include nested OUs recursively */
  recursive?: boolean;
  /** Include accounts in each OU */
  includeAccounts?: boolean;
  /** Include attached policies */
  includeAttachedPolicies?: boolean;
  /** Maximum results */
  maxResults?: number;
  /** Next token */
  nextToken?: string;
}

// =============================================================================
// Cross-Account Resource Discovery Types
// =============================================================================

/**
 * Cross-account resource
 */
export interface CrossAccountResource {
  /** Resource ID */
  resourceId: string;
  /** Resource ARN */
  arn: string;
  /** Resource type */
  resourceType: string;
  /** Account ID */
  accountId: string;
  /** Account name */
  accountName?: string;
  /** Region */
  region: string;
  /** Resource name (if available) */
  name?: string;
  /** Tags */
  tags?: Record<string, string>;
  /** Additional properties */
  properties?: Record<string, unknown>;
}

/**
 * Options for cross-account resource discovery
 */
export interface CrossAccountResourceOptions {
  /** Account IDs to search (empty = all) */
  accountIds?: string[];
  /** Resource types to search */
  resourceTypes?: string[];
  /** Regions to search */
  regions?: string[];
  /** Tag filters */
  tagFilters?: Record<string, string[]>;
  /** Maximum results per account */
  maxResultsPerAccount?: number;
  /** Include resource details */
  includeDetails?: boolean;
}

/**
 * Cross-account resource summary
 */
export interface CrossAccountResourceSummary {
  /** Total resources found */
  totalResources: number;
  /** Resources by account */
  byAccount: {
    accountId: string;
    accountName?: string;
    resourceCount: number;
    resourceTypes: Record<string, number>;
  }[];
  /** Resources by type */
  byType: {
    resourceType: string;
    count: number;
    accounts: string[];
  }[];
  /** Resources by region */
  byRegion: {
    region: string;
    count: number;
    accounts: string[];
  }[];
}

// =============================================================================
// Delegated Administrator Types
// =============================================================================

/**
 * Delegated administrator info
 */
export interface DelegatedAdministratorInfo {
  /** Account ID */
  accountId: string;
  /** Account ARN */
  arn: string;
  /** Account name */
  name: string;
  /** Account email */
  email: string;
  /** Account status */
  status: AccountStatus;
  /** Delegated timestamp */
  delegationEnabledDate: Date;
  /** Service principal */
  servicePrincipal: string;
}

/**
 * Delegated service
 */
export interface DelegatedServiceInfo {
  /** Service principal */
  servicePrincipal: string;
  /** Delegation enabled date */
  delegationEnabledDate: Date;
}

// =============================================================================
// Account Handshake Types
// =============================================================================

/**
 * Handshake state
 */
export type HandshakeState =
  | 'REQUESTED'
  | 'OPEN'
  | 'CANCELED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED';

/**
 * Handshake information
 */
export interface HandshakeInfo {
  /** Handshake ID */
  id: string;
  /** Handshake ARN */
  arn: string;
  /** Parties involved */
  parties: {
    id: string;
    type: 'ACCOUNT' | 'ORGANIZATION' | 'EMAIL';
  }[];
  /** State */
  state: HandshakeState;
  /** Request timestamp */
  requestedTimestamp: Date;
  /** Expiration timestamp */
  expirationTimestamp: Date;
  /** Action */
  action: 'INVITE' | 'ENABLE_ALL_FEATURES' | 'APPROVE_ALL_FEATURES' | 'ADD_ORGANIZATIONS_SERVICE_LINKED_ROLE';
  /** Resources involved */
  resources?: {
    type: string;
    value: string;
  }[];
}

/**
 * Options for inviting an account
 */
export interface InviteAccountOptions {
  /** Target account ID or email */
  target: string;
  /** Target type */
  targetType: 'ACCOUNT' | 'EMAIL';
  /** Notes */
  notes?: string;
  /** Tags */
  tags?: Record<string, string>;
}

// =============================================================================
// SCP Template Types
// =============================================================================

/**
 * Pre-built SCP template
 */
export interface SCPTemplate {
  /** Template ID */
  id: string;
  /** Template name */
  name: string;
  /** Description */
  description: string;
  /** Category */
  category: SCPCategory;
  /** Policy document */
  document: SCPDocument;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high';
  /** Best practice compliance */
  bestPractice: boolean;
  /** CIS benchmark reference */
  cisBenchmark?: string;
}

/**
 * SCP category
 */
export type SCPCategory =
  | 'security'
  | 'data-protection'
  | 'cost-management'
  | 'compliance'
  | 'networking'
  | 'logging'
  | 'identity';

// =============================================================================
// Event Types
// =============================================================================

/**
 * Organization event
 */
export interface OrganizationEvent {
  /** Event ID */
  eventId: string;
  /** Event type */
  eventType: OrganizationEventType;
  /** Timestamp */
  timestamp: Date;
  /** Actor (who initiated) */
  actor?: string;
  /** Target account ID */
  targetAccountId?: string;
  /** Target OU ID */
  targetOuId?: string;
  /** Policy ID */
  policyId?: string;
  /** Details */
  details?: Record<string, unknown>;
}

/**
 * Organization event type
 */
export type OrganizationEventType =
  | 'ACCOUNT_CREATED'
  | 'ACCOUNT_INVITED'
  | 'ACCOUNT_JOINED'
  | 'ACCOUNT_REMOVED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_MOVED'
  | 'OU_CREATED'
  | 'OU_DELETED'
  | 'OU_RENAMED'
  | 'POLICY_CREATED'
  | 'POLICY_UPDATED'
  | 'POLICY_DELETED'
  | 'POLICY_ATTACHED'
  | 'POLICY_DETACHED'
  | 'DELEGATED_ADMIN_REGISTERED'
  | 'DELEGATED_ADMIN_DEREGISTERED';
