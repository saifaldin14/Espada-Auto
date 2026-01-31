/**
 * AWS Core Services Plugin
 *
 * Comprehensive AWS integration providing:
 * - Credentials management (profiles, SSO, environment variables)
 * - AWS CLI wrapper with error handling and retry logic
 * - SDK client pool management with connection pooling
 * - Region and account context switching
 * - Service discovery and resource enumeration
 * - Resource tagging standardization
 * - CloudTrail integration for audit logging
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Credentials
  AWSCredentials,
  AWSCredentialSource,
  AWSProfile,
  AWSSSOSession,
  CredentialsManagerOptions,
  CredentialResolutionResult,

  // CLI
  AWSCLIOptions,
  AWSCLIResult,
  AWSCLIError,
  AWSCLIConfig,

  // Client Pool
  ClientPoolConfig,
  ClientPoolEntry,
  ClientPoolStats,

  // Context
  AWSContext,
  AWSAccountInfo,
  AWSRegionInfo,
  ContextSwitchOptions,

  // Discovery
  AWSServiceMetadata,
  AWSServiceCategory,
  AWSResource,
  ResourceEnumerationOptions,

  // Tagging
  AWSTag,
  StandardTagConfig,
  TagValidationResult,
  TagValidationError,
  TagValidationWarning,
  TagSuggestion,
  TaggingOperation,
  TaggingOperationResult,

  // CloudTrail
  CloudTrailEvent,
  CloudTrailUserIdentity,
  CloudTrailResource,
  CloudTrailQueryOptions,
  CloudTrailTrailInfo,
  CloudTrailAuditSummary,
} from "./types.js";

// =============================================================================
// Credentials Module
// =============================================================================

export {
  AWSCredentialsManager,
  createCredentialsManager,
} from "./credentials/index.js";

// =============================================================================
// CLI Module
// =============================================================================

export {
  AWSCLIWrapper,
  createCLIWrapper,
} from "./cli/index.js";

// =============================================================================
// Client Pool Module
// =============================================================================

export {
  AWSClientPoolManager,
  createClientPool,
} from "./client-pool/index.js";

// =============================================================================
// Context Module
// =============================================================================

export {
  AWSContextManager,
  createContextManager,
} from "./context/index.js";

// =============================================================================
// Discovery Module
// =============================================================================

export {
  AWSServiceDiscovery,
  createServiceDiscovery,
} from "./discovery/index.js";

// =============================================================================
// Tagging Module
// =============================================================================

export {
  AWSTagValidator,
  AWSTaggingManager,
  createTagValidator,
  createTaggingManager,
} from "./tagging/index.js";

// =============================================================================
// CloudTrail Module
// =============================================================================

export {
  AWSCloudTrailManager,
  createCloudTrailManager,
} from "./cloudtrail/index.js";

// =============================================================================
// EC2 Module
// =============================================================================

export {
  AWSEC2Manager,
  createEC2Manager,
} from "./ec2/index.js";

// =============================================================================
// IaC (Infrastructure as Code) Module
// =============================================================================

export {
  IaCManager,
  createIaCManager,
} from "./iac/index.js";

// IaC Types
export type {
  IaCFormat,
  CloudFormationOutputFormat,
  AWSResourceType,
  DriftStatus,
  ChangeAction,
  IaCManagerConfig,
  IaCResourceDefinition,
  EC2InstanceDefinition,
  VPCDefinition,
  SubnetDefinition,
  SecurityGroupDefinition,
  RDSInstanceDefinition,
  S3BucketDefinition,
  LambdaFunctionDefinition,
  IAMRoleDefinition,
  ALBDefinition,
  ASGDefinition,
  InfrastructureTemplate,
  TemplateVariable,
  TemplateOutput,
  TerraformGenerationOptions,
  CloudFormationGenerationOptions,
  TerraformGenerationResult,
  CloudFormationGenerationResult,
  DriftDetectionOptions,
  ResourceDrift,
  DriftDetectionResult,
  StateExportOptions,
  DiscoveredResource,
  StateExportResult,
  ResourceChange,
  InfrastructurePlan,
  ApplyOptions,
  ApplyResult,
  IaCOperationResult,
} from "./iac/index.js";

// =============================================================================
// Cost Management Module
// =============================================================================

export {
  CostManager,
  createCostManager,
} from "./cost/index.js";

// Cost Types
export type {
  CostManagerConfig,
  CostGranularity,
  CostDimension,
  CostMetric,
  UnusedResourceType,
  RecommendationType,
  ScheduleAction,
  TimePeriod,
  CostFilter,
  GetCostSummaryOptions,
  CostSummaryResult,
  CostDataPoint,
  GroupedCostData,
  ForecastCostOptions,
  CostForecastResult,
  GetOptimizationRecommendationsOptions,
  OptimizationRecommendationsResult,
  RightsizingRecommendation,
  ReservedInstanceRecommendation,
  SavingsPlanRecommendation,
  FindUnusedResourcesOptions,
  UnusedResourcesResult,
  UnusedResource,
  ResourceSchedule,
  ScheduleResourcesOptions,
  ScheduleResourcesResult,
  ScheduledResource,
  BudgetType,
  BudgetTimeUnit,
  AlertThresholdType,
  AlertNotificationType,
  BudgetAlert,
  CreateBudgetOptions,
  CreateBudgetResult,
  BudgetInfo,
  ListBudgetsResult,
  CostOperationResult,
} from "./cost/index.js";

// =============================================================================
// Security Module
// =============================================================================

export {
  SecurityManager,
  createSecurityManager,
} from "./security/index.js";

// Security Types
export type {
  SecurityManagerConfig,
  SecurityOperationResult,
  IAMRoleInfo,
  IAMUserInfo,
  IAMPolicyInfo,
  AttachedPolicy,
  AccessKeyInfo,
  MFADeviceInfo,
  PolicyDocument,
  PolicyStatement,
  PolicyPrincipal,
  TrustPolicy,
  TrustPolicyStatement,
  ListRolesOptions,
  ListUsersOptions,
  ListPoliciesOptions,
  CreateRoleOptions,
  CreatePolicyOptions,
  CreateUserOptions,
  CreateUserResult,
  AWSServicePrincipal,
  SecurityFindingSeverity,
  SecurityFindingStatus,
  WorkflowStatus,
  ComplianceStatus,
  SecurityFinding,
  SecurityFindingResource,
  ListSecurityFindingsOptions,
  SecurityStandard,
  SecurityControl,
  GuardDutySeverity,
  GuardDutyFinding,
  GuardDutyResource,
  GuardDutyService,
  RemoteIpDetails,
  ListGuardDutyFindingsOptions,
  GuardDutyDetector,
  KMSKeyState,
  KMSKeySpec,
  KMSKeyUsage,
  KMSKeyOrigin,
  KMSKeyInfo,
  ListKMSKeysOptions,
  CreateKMSKeyOptions,
  KMSKeyPolicy,
  KMSPolicyStatement,
  SecretInfo,
  SecretVersionInfo,
  ListSecretsOptions,
  CreateSecretOptions,
  UpdateSecretOptions,
  RotateSecretOptions,
  SecretValue,
  AccessAnalyzerFindingStatus,
  AccessAnalyzerResourceType,
  AccessAnalyzerFinding,
  ListAccessAnalyzerFindingsOptions,
  AccessAnalyzerInfo,
  CreateAccessAnalyzerOptions,
  PolicySimulationResult,
  SimulatePolicyOptions,
  SecurityPostureSummary,
  ComplianceFramework,
  ComplianceCheckResult,
  PolicyTemplate,
  PolicyTemplateDefinition,
} from "./security/index.js";

// =============================================================================
// Guardrails & Approval Workflows Module
// =============================================================================

export {
  GuardrailsManager,
  createGuardrailsManager,
  DEFAULT_ACTION_CLASSIFICATIONS,
} from "./guardrails/index.js";

// Guardrails Types
export type {
  GuardrailsOperationResult,
  Environment,
  ActionSeverity,
  ActionType,
  DayOfWeek,
  ApprovalStatus,
  Approver,
  ApprovalRequest,
  ApprovalResponse,
  ImpactAssessment,
  ResourceDependency,
  DryRunResult,
  AffectedResource,
  PlannedChange,
  EnvironmentProtection,
  TimeWindow,
  RequiredTag,
  AuditLogEntry,
  AuditLogQueryOptions,
  AuditLogQueryResult,
  AuditLogSummary,
  RateLimitConfig,
  RateLimitStatus,
  SafetyCheckConfig,
  SafetyCheckResult,
  SafetyCheck,
  TicketingSystem,
  TicketInfo,
  TicketingIntegrationConfig,
  ChangeRequest,
  PlannedAction,
  GuardrailsManagerConfig,
  ActionClassification,
  PreOperationBackup,
  NotificationChannelConfig,
  NotificationEvent,
  NotificationPayload,
  GuardrailsPolicy,
  PolicyCondition,
  PolicyAction,
  OperationContext,
  GuardrailsEvaluationResult,
} from "./guardrails/index.js";

// EC2 Types
export type {
  EC2Instance,
  EC2InstanceState,
  EC2SecurityGroup,
  EC2SecurityGroupRule,
  EC2KeyPair,
  EC2AMI,
  EC2LaunchTemplate,
  EC2LaunchTemplateOptions,
  EC2SecurityGroupOptions,
  EC2KeyPairOptions,
  EC2AMIOptions,
  EC2InstanceMetrics,
  MetricDatapoint,
  EC2MetricOptions,
  EC2CreateInstanceOptions,
  EC2InstanceLifecycleOptions,
  EC2OperationResult,
  AutoScalingGroupInfo,
  AutoScalingGroupOptions,
  LoadBalancerInfo,
  LoadBalancerOptions,
  TargetGroupInfo,
  TargetGroupOptions,
} from "./ec2/types.js";

// =============================================================================
// Utility Exports
// =============================================================================

export { which } from "./utils/which.js";

// =============================================================================
// Plugin Interface
// =============================================================================

import { AWSCredentialsManager, createCredentialsManager } from "./credentials/index.js";
import { AWSCLIWrapper, createCLIWrapper } from "./cli/index.js";
import { AWSClientPoolManager, createClientPool } from "./client-pool/index.js";
import { AWSContextManager, createContextManager } from "./context/index.js";
import { AWSServiceDiscovery, createServiceDiscovery } from "./discovery/index.js";
import { AWSTaggingManager, createTaggingManager } from "./tagging/index.js";
import { AWSCloudTrailManager, createCloudTrailManager } from "./cloudtrail/index.js";
import { AWSEC2Manager, createEC2Manager } from "./ec2/index.js";
import type { StandardTagConfig, AWSTag, ClientPoolConfig, AWSCredentialSource } from "./types.js";

export interface AWSPluginOptions {
  /** Default AWS region */
  defaultRegion?: string;

  /** Default AWS profile name */
  defaultProfile?: string;

  /** Credential sources to use (in order of preference) */
  credentialSources?: AWSCredentialSource[];

  /** Client pool configuration */
  clientPoolConfig?: Partial<ClientPoolConfig>;

  /** Standard tag configuration */
  tagConfig?: Partial<StandardTagConfig>;

  /** Default tags to apply to all resources */
  defaultTags?: AWSTag[];

  /** Path to AWS config file */
  configFilePath?: string;

  /** Path to AWS credentials file */
  credentialsFilePath?: string;
}

/**
 * AWS Plugin
 *
 * Unified interface for AWS operations providing access to all AWS services.
 */
export class AWSPlugin {
  readonly credentials: AWSCredentialsManager;
  readonly cli: AWSCLIWrapper;
  readonly clientPool: AWSClientPoolManager;
  readonly context: AWSContextManager;
  readonly discovery: AWSServiceDiscovery;
  readonly tagging: AWSTaggingManager;
  readonly cloudtrail: AWSCloudTrailManager;
  readonly ec2: AWSEC2Manager;

  private defaultRegion: string;

  constructor(options: AWSPluginOptions = {}) {
    this.defaultRegion = options.defaultRegion ?? "us-east-1";

    // Initialize credentials manager
    this.credentials = createCredentialsManager({
      defaultProfile: options.defaultProfile,
      defaultRegion: options.defaultRegion,
      configFile: options.configFilePath,
      credentialsFile: options.credentialsFilePath,
    });

    // Initialize CLI wrapper
    this.cli = createCLIWrapper({
      defaultOptions: {
        profile: options.defaultProfile,
        region: options.defaultRegion,
      },
    });

    // Initialize client pool
    this.clientPool = createClientPool(options.clientPoolConfig);

    // Initialize context manager
    this.context = createContextManager(this.credentials);

    // Initialize service discovery
    this.discovery = createServiceDiscovery(this.credentials);

    // Initialize tagging manager
    this.tagging = createTaggingManager(
      this.credentials,
      options.tagConfig,
      options.defaultTags,
    );

    // Initialize CloudTrail manager
    this.cloudtrail = createCloudTrailManager(
      this.credentials,
      options.defaultRegion,
    );

    // Initialize EC2 manager
    this.ec2 = createEC2Manager(
      this.credentials,
      options.defaultRegion,
    );
  }

  /**
   * Initialize the plugin and verify AWS connectivity
   */
  async initialize(): Promise<void> {
    // Verify credentials are available
    await this.credentials.getCredentials();

    // Verify CLI is available (optional)
    try {
      await this.cli.execute("sts", "get-caller-identity");
    } catch {
      // CLI not available, but SDK will work
    }
  }

  /**
   * Switch to a different AWS profile
   */
  async switchProfile(profile: string): Promise<void> {
    await this.context.switchProfile(profile);
    const context = this.context.getContext();
    if (context) {
      this.cloudtrail.setDefaultRegion(context.region);
    }
  }

  /**
   * Switch to a different AWS region
   */
  async switchRegion(region: string): Promise<void> {
    await this.context.switchRegion(region);
    this.cloudtrail.setDefaultRegion(region);
  }

  /**
   * Assume a role in another account
   */
  async assumeRole(roleArn: string, sessionName?: string): Promise<void> {
    // Extract account ID from role ARN
    const arnParts = roleArn.split(":");
    const accountId = arnParts[4];
    await this.context.switchAccount(accountId, roleArn, { sessionName });
  }

  /**
   * Get current context information
   */
  getCurrentContext() {
    const context = this.context.getContext();
    return {
      region: context?.region ?? this.defaultRegion,
      accountId: context?.accountId,
      profile: context?.profile,
    };
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    this.clientPool.destroy();
    this.credentials.clearCache();
  }
}

/**
 * Create an AWS plugin instance
 */
export function createAWSPlugin(options?: AWSPluginOptions): AWSPlugin {
  return new AWSPlugin(options);
}
