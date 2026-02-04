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
  InfrastructureTemplate as IaCInfrastructureTemplate,
  TemplateVariable,
  TemplateOutput,
  TerraformGenerationOptions,
  CloudFormationGenerationOptions,
  TerraformGenerationResult,
  CloudFormationGenerationResult,
  DriftDetectionOptions,
  ResourceDrift as IaCResourceDrift,
  DriftDetectionResult,
  StateExportOptions,
  DiscoveredResource,
  StateExportResult,
  ResourceChange,
  InfrastructurePlan as IaCInfrastructurePlan,
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

// =============================================================================
// Organization & Multi-Account Module
// =============================================================================

export {
  OrganizationManager,
  createOrganizationManager,
} from "./organization/index.js";

// Organization Types
export type {
  OrganizationManagerConfig,
  OrganizationOperationResult,
  OrganizationInfo,
  OrganizationRootInfo,
  OrganizationStatus,
  PolicyTypeSummary,
  AccountInfo,
  DetailedAccountInfo,
  AccountStatus,
  AccountJoinMethod,
  ListAccountsOptions,
  CreateAccountOptions,
  CreateAccountStatus,
  MoveAccountOptions,
  OrganizationalUnitInfo,
  CreateOUOptions,
  ListOUsOptions,
  PolicyType,
  PolicySummary,
  SCPInfo,
  SCPDocument,
  SCPStatement,
  PolicyTargetInfo,
  PolicyAttachment,
  CreateSCPOptions,
  UpdateSCPOptions,
  ListPoliciesOptions as ListSCPsOptions,
  SCPTemplate,
  SCPCategory,
  AssumedRoleCredentials,
  AssumeRoleOptions,
  CrossAccountSession,
  AccountContext,
  ResourceShareStatus,
  AssociationStatus,
  ResourceShareInfo,
  SharedResourceInfo,
  ShareableResourceType,
  CreateResourceShareOptions,
  ListResourceSharesOptions,
  ConsolidatedBillingSummary,
  AccountCostBreakdown,
  ServiceCostBreakdown,
  GetConsolidatedBillingOptions,
  DelegatedAdministratorInfo,
  DelegatedServiceInfo,
  HandshakeState,
  HandshakeInfo,
  InviteAccountOptions,
  CrossAccountResource,
  CrossAccountResourceOptions,
  CrossAccountResourceSummary,
  OrganizationEvent,
  OrganizationEventType,
} from "./organization/index.js";

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
// Containers Module
// =============================================================================

export {
  ContainerManager,
  createContainerManager,
} from "./containers/index.js";

// Containers Types
export type {
  ContainerManagerConfig,
  ContainerOperationResult,
  // ECS Types
  ECSClusterInfo,
  ECSServiceInfo,
  ECSTaskInfo,
  TaskDefinitionInfo,
  ContainerInfo,
  NetworkConfiguration,
  Deployment,
  CapacityProviderStrategyItem,
  CreateECSClusterOptions,
  CreateECSServiceOptions,
  UpdateECSServiceOptions,
  RunECSTaskOptions,
  RegisterTaskDefinitionOptions,
  ContainerDefinition,
  ScaleECSServiceOptions,
  // EKS Types
  EKSClusterInfo,
  EKSNodeGroupInfo,
  EKSFargateProfileInfo,
  EKSLogging,
  CreateEKSClusterOptions,
  UpdateEKSClusterOptions,
  CreateEKSNodeGroupOptions,
  UpdateEKSNodeGroupOptions,
  CreateEKSFargateProfileOptions,
  // ECR Types
  ECRRepositoryInfo,
  ECRImageInfo,
  ECRImageScanFinding,
  LifecyclePolicyRule,
  CreateECRRepositoryOptions,
  // Container Insights
  ContainerInsightsMetrics,
  GetContainerInsightsOptions,
} from "./containers/types.js";

// =============================================================================
// Observability Module
// =============================================================================

export {
  ObservabilityManager,
  createObservabilityManager,
} from "./observability/index.js";

// Observability Types
export type {
  ObservabilityManagerConfig,
  ObservabilityOperationResult,
  // Alarms
  AlarmInfo,
  AlarmState,
  CreateAlarmOptions,
  ListAlarmsOptions,
  AlarmHistoryItem,
  AlarmTemplate,
  // Metrics
  MetricInfo,
  MetricDataPoint,
  MetricDataQuery,
  MetricDataResult,
  MetricDimension,
  GetMetricStatisticsOptions,
  PutMetricDataOptions,
  ListMetricsOptions,
  // Dashboards
  DashboardInfo,
  DashboardBody,
  DashboardWidget,
  CreateDashboardOptions,
  DashboardTemplate,
  // Logs
  LogGroupInfo,
  LogStreamInfo,
  LogEvent,
  ListLogGroupsOptions,
  ListLogStreamsOptions,
  FilterLogEventsOptions,
  LogInsightsQueryResult,
  StartLogInsightsQueryOptions,
  MetricFilterInfo,
  CreateMetricFilterOptions,
  QueryStatus,
  // X-Ray
  TraceSummary,
  TraceDetail,
  GetTraceSummariesOptions,
  ServiceMap,
  ServiceMapNode,
  XRayGroupInfo,
  InsightSummary,
  // Synthetics
  CanaryInfo,
  CanaryRunInfo,
  CreateCanaryOptions,
  UpdateCanaryOptions,
  CanaryBlueprint,
  // Anomaly Detection
  AnomalyDetectorInfo,
  PutAnomalyDetectorOptions,
  // Composite Alarms
  CompositeAlarmInfo,
  CreateCompositeAlarmOptions,
  // Summary
  ObservabilityHealthSummary,
} from "./observability/types.js";

// =============================================================================
// Backup & Disaster Recovery Module
// =============================================================================

export {
  BackupManager,
  createBackupManager,
} from "./backup/index.js";

// Backup Types
export type {
  BackupManagerConfig,
  BackupOperationResult,
  // Backup Plan Types
  BackupPlanInfo,
  BackupRuleInfo,
  BackupLifecycle,
  CopyAction,
  AdvancedBackupSetting,
  ListBackupPlansOptions,
  CreateBackupPlanOptions,
  CreateBackupRuleOptions,
  UpdateBackupPlanOptions,
  // Backup Vault Types
  BackupVaultInfo,
  ListBackupVaultsOptions,
  CreateBackupVaultOptions,
  LockBackupVaultOptions,
  // Recovery Point Types
  RecoveryPointInfo,
  RecoveryPointCreator,
  CalculatedLifecycle,
  RecoveryPointStatus,
  StorageClass,
  ListRecoveryPointsOptions,
  GetRecoveryPointOptions,
  // Backup Selection Types
  BackupSelectionInfo,
  TagCondition,
  BackupConditions,
  ConditionParameter,
  CreateBackupSelectionOptions,
  // Restore Types
  RestoreJobInfo,
  RestoreJobStatus,
  ListRestoreJobsOptions,
  StartRestoreOptions,
  RestoreMetadata,
  // Backup Job Types
  BackupJobInfo,
  BackupJobState,
  ListBackupJobsOptions,
  StartBackupOptions,
  // Cross-Region Replication Types
  ReplicationConfiguration,
  ConfigureReplicationOptions,
  CopyJobInfo,
  CopyJobState,
  StartCopyOptions,
  // DR Runbook Types
  DRRunbook,
  DRRunbookStep,
  DRStepType,
  DRStepAction,
  DRResource,
  DRContact,
  DRPreCondition,
  DRPostCondition,
  DRTestResult,
  GenerateDRRunbookOptions,
  // Failover Types
  FailoverPlan,
  FailoverStatus,
  FailoverStep,
  ExecuteFailoverOptions,
  FailoverResult,
  ResourceFailoverResult,
  // Compliance Types
  BackupComplianceStatus,
  ResourceTypeCompliance,
  BackupPlanCompliance,
  ComplianceIssue,
  ComplianceIssueType,
  GetComplianceOptions,
  FrameworkControl,
  ControlScope,
  FrameworkInfo,
  CreateFrameworkOptions,
  // Recovery Testing Types
  RecoveryTestInfo,
  ValidationStep,
  RunRecoveryTestOptions,
  RecoveryTestResult,
  // Report Types
  ReportPlanInfo,
  ReportSetting,
  ReportTemplate,
  ReportDeliveryChannel,
  CreateReportPlanOptions,
  // Protected Resource Types
  ProtectedResourceInfo,
  ListProtectedResourcesOptions,
  // Resource Types
  BackupResourceType,
  // Templates
  BackupPlanTemplate,
} from "./backup/types.js";

// Re-export backup templates
export { BACKUP_PLAN_TEMPLATES, RESOURCE_TYPE_ARN_PREFIXES } from "./backup/types.js";

// =============================================================================
// Conversational UX Module
// =============================================================================

export {
  AWSConversationalManager,
  createConversationalManager,
  WIZARD_TEMPLATES,
  INSIGHT_CHECKS,
  QUERY_PATTERNS,
} from "./conversational/index.js";

// Conversational UX Types
export type {
  // Common types
  ConversationalOperationResult,
  ConversationalManagerConfig,
  // Context types
  EnvironmentType,
  TrackedResourceType,
  ResourceReference,
  OperationRecord,
  InfrastructureContext,
  ResourceFilter,
  // Insight types
  InsightSeverity,
  InsightCategory,
  InsightStatus,
  ProactiveInsight,
  InsightImpact,
  InsightRecommendation,
  InsightCheckConfig,
  GetInsightsOptions,
  // Query types
  QueryIntent,
  TimeRangeType,
  ParsedQuery,
  QueryResult,
  QueryPattern,
  // Wizard types
  WizardType,
  WizardStepType,
  WizardStepOption,
  WizardStep,
  WizardExecutionPlan,
  PlannedResource as ConversationalPlannedResource,
  WizardState,
  WizardTemplate,
  // Summary types
  InfrastructureSummary,
  SessionSummary,
  // Manager interface
  ConversationalManager,
} from "./conversational/index.js";

// =============================================================================
// Compliance & Governance Module
// =============================================================================

export {
  AWSComplianceManager,
  AWS_MANAGED_RULES,
  CONFORMANCE_PACK_TEMPLATES,
  FRAMEWORK_DEFINITIONS,
} from "./compliance/index.js";

// =============================================================================
// Event-Driven Automation Module
// =============================================================================

export {
  AWSAutomationManager,
  createAutomationManager,
  PREDEFINED_EVENT_PATTERNS,
  SCHEDULE_EXPRESSIONS,
  WORKFLOW_TEMPLATES,
} from "./automation/index.js";

// Compliance Types
export type {
  // Common types
  ComplianceOperationResult,
  ComplianceManagerConfig,
  // Framework types
  ComplianceFramework as ComplianceFrameworkType,
  FrameworkInfo as ComplianceFrameworkInfo,
  ComplianceControl,
  // Status types
  ComplianceSeverity,
  ComplianceStatus as ComplianceStatusType,
  ComplianceCheckResult as ComplianceCheckResultType,
  ComplianceSummary,
  ComplianceResource,
  // Config rule types
  ConfigRuleSourceType,
  ConfigRuleTriggerType,
  ConfigRuleComplianceType,
  ConfigRuleInfo,
  ConfigRuleEvaluation,
  ConfigRuleComplianceDetail,
  CreateConfigRuleOptions,
  ListConfigRulesOptions,
  // Conformance pack types
  ConformancePackInfo,
  ConformancePackInputParameter,
  ConformancePackComplianceDetail,
  CreateConformancePackOptions,
  ListConformancePacksOptions,
  // Violation types
  ComplianceViolation,
  ViolationStatus,
  RemediationStep,
  ListViolationsOptions,
  // Tag compliance types
  RequiredTag as ComplianceRequiredTag,
  TagPolicy,
  TagEnforcementMode,
  TagComplianceResult,
  TagValidationError as ComplianceTagValidationError,
  EnforceTagsOptions,
  TagEnforcementResult,
  // Remediation types
  RemediationActionType as ComplianceRemediationActionType,
  RemediationActionConfig,
  RemediationExecutionResult,
  RemediationStepDetail,
  RemediateViolationOptions,
  // Report types
  ReportFormat,
  ReportType,
  ComplianceReport,
  ComplianceReportSummary,
  GenerateReportOptions,
  // Check options
  CheckComplianceOptions,
  // Manager interface
  ComplianceManager,
} from "./compliance/index.js";

// Automation Types
export type {
  // Common types
  AutomationOperationResult,
  AutomationManagerConfig,
  // EventBridge types
  EventBusInfo,
  EventRuleInfo,
  EventRuleState,
  EventTargetInfo,
  EventPattern,
  AWSEventSource,
  TargetType,
  CreateEventRuleOptions,
  AddTargetOptions,
  ListEventRulesOptions,
  // Scheduler types
  ScheduleInfo,
  ScheduleState,
  ScheduleGroupInfo,
  CreateScheduleOptions,
  ListSchedulesOptions,
  // State Machine types
  StateMachineInfo,
  StateMachineType,
  StateMachineStatus,
  ExecutionInfo,
  ExecutionStatus as AutomationExecutionStatus,
  CreateStateMachineOptions,
  StartExecutionOptions,
  ListExecutionsOptions,
  ListStateMachinesOptions,
  // ASL types
  ASLDefinition,
  ASLState,
  ASLStateType,
  // Workflow Builder types
  WorkflowDefinition,
  WorkflowStep,
  WorkflowStepType,
  WorkflowCondition,
  BuildWorkflowOptions,
  // Remediation types
  RemediationConfig,
  RemediationTriggerType,
  RemediationActionType as AutomationRemediationActionType,
  RemediationExecution,
  SetupRemediationOptions,
  ListRemediationsOptions,
  // Archive and Replay types
  EventArchiveInfo,
  EventReplayInfo,
  CreateEventArchiveOptions,
  StartEventReplayOptions,
  ListEventArchivesOptions,
  // Manager interface
  AutomationManager,
} from "./automation/index.js";

// =============================================================================
// Utility Exports
// =============================================================================

export { which } from "./utils/which.js";

// =============================================================================
// Enterprise Services Module (Database, API, Messaging, DNS, Identity)
// =============================================================================

// DynamoDB
export {
  DynamoDBManager,
  createDynamoDBManager,
  dynamoDBToolDefinitions,
} from "./dynamodb/manager.js";

export type {
  DynamoDBManagerConfig,
  TableConfig,
  KeyAttribute,
  GSIConfig,
  LSIConfig,
  AutoScalingConfig,
  GlobalTableConfig,
  BackupConfig,
  RestoreConfig,
  ExportConfig,
  ImportConfig,
  QueryOptions,
  ScanOptions,
  TableMetrics,
  DynamoDBOperationResult,
} from "./dynamodb/manager.js";

// API Gateway
export {
  APIGatewayManager,
  createAPIGatewayManager,
  apiGatewayToolDefinitions,
} from "./apigateway/manager.js";

export type {
  APIGatewayManagerConfig,
  CreateRESTApiConfig,
  CreateHTTPApiConfig,
  ResourceConfig,
  MethodConfig,
  IntegrationConfig,
  RouteConfig,
  HTTPIntegrationConfig,
  StageConfig,
  AuthorizerConfig,
  UsagePlanConfig,
  ApiKeyConfig,
  DomainConfig,
  BasePathMappingConfig,
  OpenApiImportConfig,
  ApiMetrics,
  APIGatewayOperationResult,
} from "./apigateway/manager.js";

// SQS
export {
  SQSManager,
  createSQSManager,
  sqsToolDefinitions,
} from "./sqs/manager.js";

export type {
  SQSManagerConfig,
  CreateQueueConfig,
  UpdateQueueConfig,
  SendMessageConfig,
  ReceiveMessageConfig,
  QueueMetrics,
  SQSOperationResult,
  MessageResult,
  ReceivedMessage,
  BatchResultEntry,
} from "./sqs/manager.js";

// Route 53
export {
  Route53Manager,
  createRoute53Manager,
  route53ToolDefinitions,
} from "./route53/manager.js";

export type {
  Route53ManagerConfig,
  CreateHostedZoneConfig,
  RecordConfig,
  CreateHealthCheckConfig,
  TrafficPolicyConfig,
  TrafficPolicyInstanceConfig,
  QueryLoggingConfigInput,
  HostedZoneMetrics,
  Route53OperationResult,
} from "./route53/manager.js";

// Cognito
export {
  CognitoManager,
  createCognitoManager,
  cognitoToolDefinitions,
} from "./cognito/manager.js";

export type {
  CognitoManagerConfig,
  CreateUserPoolConfig,
  CreateAppClientConfig,
  CreateGroupConfig,
  CreateUserConfig,
  CreateIdentityProviderConfig,
  CreateIdentityPoolConfig,
  IdentityPoolRolesConfig,
  UserPoolMetrics,
  CognitoOperationResult,
} from "./cognito/manager.js";

// SNS
export {
  SNSManager,
  createSNSManager,
  snsToolDefinitions,
} from "./sns/manager.js";

export type {
  SNSManagerConfig,
  CreateTopicConfig,
  SubscriptionConfig,
  PublishMessageConfig,
  BatchPublishConfig,
  CreatePlatformApplicationConfig,
  CreatePlatformEndpointConfig,
  SMSAttributesConfig,
  TopicMetrics,
  SNSOperationResult,
} from "./sns/manager.js";

// Enterprise Services Aggregate
export {
  enterpriseToolDefinitions,
} from "./enterprise-services.js";

// =============================================================================
// Intent-Driven Infrastructure Orchestration (IDIO) System
// =============================================================================

export {
  IntentCompiler,
  createIntentCompiler,
} from "./intent/compiler.js";

export {
  PolicyEngine,
  createPolicyEngine,
} from "./policy/engine.js";

export {
  INFRASTRUCTURE_CATALOG,
  getTemplate,
  getTemplatesByCategory,
  searchTemplatesByTags,
  applyTemplate,
  listTemplates,
  getCategories,
} from "./catalog/templates.js";

export {
  ReconciliationEngine,
  createReconciliationEngine,
} from "./reconciliation/engine.js";

export {
  IDIOOrchestrator,
  createIDIOOrchestrator,
} from "./idio/orchestrator.js";

export type {
  // Intent Types
  ComplianceFramework as IntentComplianceFramework,
  ApplicationTier,
  TrafficPattern,
  Environment as IntentEnvironment,
  AvailabilityRequirement,
  CostConstraint,
  DisasterRecoveryRequirement,
  ScalingRequirement,
  SecurityRequirement,
  ApplicationIntent,
  ApplicationTierIntent,
  RuntimeConfiguration,
  InfrastructurePlan,
  PlannedResource,
  CostBreakdownItem,
  PolicyValidationResult,
  PolicyViolation as IntentPolicyViolation,
  PolicyWarning,
  GuardrailCheckResult,
  GeneratedIaC,
  RollbackPlan,
  RollbackStep,
  IntentExecutionResult,
  ProvisionedResource,
  ExecutionError,
  IntentTemplate,
  TemplateParameter,
  ParameterValidation,
  IntentTemplateExample,
  ReconciliationResult,
  ResourceDrift,
  ConfigurationDifference,
  CostAnomaly,
  RemediationAction as IntentRemediationAction,
} from "./intent/types.js";

export type {
  // Policy Types
  PolicyRule,
  PolicyEvaluationResult,
} from "./policy/engine.js";

export {
  COMPLIANCE_POLICY_SETS,
} from "./policy/engine.js";

export type {
  // Reconciliation Types
  ReconciliationConfig,
  ReconciliationContext,
} from "./reconciliation/engine.js";

export {
  createReconciliationSchedule,
  createReconciliationWorkflow,
} from "./reconciliation/engine.js";

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
import { ContainerManager, createContainerManager } from "./containers/index.js";
import { ObservabilityManager, createObservabilityManager } from "./observability/index.js";
import { AWSConversationalManager, createConversationalManager } from "./conversational/index.js";
import { AWSComplianceManager } from "./compliance/index.js";
import { AWSAutomationManager, createAutomationManager } from "./automation/index.js";
import type { StandardTagConfig, AWSTag, ClientPoolConfig, AWSCredentialSource } from "./types.js";

// Enterprise Services Imports
import { DynamoDBManager, createDynamoDBManager } from "./dynamodb/manager.js";
import { APIGatewayManager, createAPIGatewayManager } from "./apigateway/manager.js";
import { SQSManager, createSQSManager } from "./sqs/manager.js";
import { Route53Manager, createRoute53Manager } from "./route53/manager.js";
import { CognitoManager, createCognitoManager } from "./cognito/manager.js";
import { SNSManager, createSNSManager } from "./sns/manager.js";

// IDIO System Imports
import { IDIOOrchestrator, createIDIOOrchestrator } from "./idio/orchestrator.js";

/**
 * Create an AWS Compliance Manager instance
 */
export function createComplianceManager(config?: import("./compliance/types.js").ComplianceManagerConfig): AWSComplianceManager {
  return new AWSComplianceManager(config);
}

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

  /** Enable IDIO (Intent-Driven Infrastructure Orchestration) */
  enableIDIO?: boolean;
}

/**
 * AWS Plugin
 *
 * Unified interface for AWS operations providing access to all AWS services.
 */
export class AWSPlugin {
  // Core Services
  readonly credentials: AWSCredentialsManager;
  readonly cli: AWSCLIWrapper;
  readonly clientPool: AWSClientPoolManager;
  readonly context: AWSContextManager;
  readonly discovery: AWSServiceDiscovery;
  readonly tagging: AWSTaggingManager;
  readonly cloudtrail: AWSCloudTrailManager;
  readonly ec2: AWSEC2Manager;
  readonly containers: ContainerManager;
  readonly observability: ObservabilityManager;
  readonly conversational: AWSConversationalManager;
  readonly compliance: AWSComplianceManager;
  readonly automation: AWSAutomationManager;

  // Enterprise Services
  readonly dynamodb: DynamoDBManager;
  readonly apigateway: APIGatewayManager;
  readonly sqs: SQSManager;
  readonly route53: Route53Manager;
  readonly cognito: CognitoManager;
  readonly sns: SNSManager;

  // IDIO System (Intent-Driven Infrastructure Orchestration)
  readonly idio: IDIOOrchestrator;

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

    // Initialize Container manager
    this.containers = createContainerManager({
      defaultRegion: options.defaultRegion,
    });

    // Initialize Observability manager
    this.observability = createObservabilityManager({
      defaultRegion: options.defaultRegion,
    });

    // Initialize Conversational UX manager
    this.conversational = createConversationalManager({
      defaultRegion: options.defaultRegion,
    });

    // Initialize Compliance & Governance manager
    this.compliance = createComplianceManager({
      defaultRegion: options.defaultRegion,
    });

    // Initialize Event-Driven Automation manager
    this.automation = createAutomationManager({
      defaultRegion: options.defaultRegion,
    });

    // =========================================================================
    // Enterprise Services Initialization
    // =========================================================================

    // Initialize DynamoDB manager
    this.dynamodb = createDynamoDBManager({
      region: options.defaultRegion,
    });

    // Initialize API Gateway manager
    this.apigateway = createAPIGatewayManager({
      region: options.defaultRegion,
    });

    // Initialize SQS manager
    this.sqs = createSQSManager({
      region: options.defaultRegion,
    });

    // Initialize Route 53 manager
    this.route53 = createRoute53Manager({
      region: options.defaultRegion,
    });

    // Initialize Cognito manager
    this.cognito = createCognitoManager({
      region: options.defaultRegion,
    });

    // Initialize SNS manager
    this.sns = createSNSManager({
      region: options.defaultRegion,
    });

    // =========================================================================
    // IDIO System Initialization (Intent-Driven Infrastructure Orchestration)
    // =========================================================================

    // Initialize IDIO orchestrator for declarative infrastructure management
    this.idio = createIDIOOrchestrator({
      compiler: {},
      policyEngine: {},
      reconciliation: { 
        intervalMinutes: 30, 
        enableAutoRemediation: false, 
        costAnomalyThreshold: 20,
        maxRemediationAttempts: 3,
      },
    });
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

  // ===========================================================================
  // IDIO Convenience Methods
  // ===========================================================================

  /**
   * Create infrastructure plan from a declarative intent specification
   * @example
   * ```ts
   * const result = await plugin.createPlanFromIntent({
   *   name: 'my-api',
   *   environment: 'production',
   *   type: 'web-api',
   *   trafficPattern: 'steady',
   *   tiers: [{ tier: 'web', scaling: { min: 1, max: 4 } }],
   * });
   * ```
   */
  async createPlanFromIntent(intent: import("./intent/types.js").ApplicationIntent): Promise<import("./idio/orchestrator.js").IDIOResult> {
    return this.idio.createPlanFromIntent(intent);
  }

  /**
   * Validate an infrastructure intent without executing
   */
  async validateIntent(intent: import("./intent/types.js").ApplicationIntent): Promise<import("./idio/orchestrator.js").IDIOResult> {
    return this.idio.validateIntent(intent);
  }

  /**
   * Estimate cost for an infrastructure intent
   */
  async estimateIntentCost(intent: import("./intent/types.js").ApplicationIntent): Promise<import("./idio/orchestrator.js").IDIOResult> {
    return this.idio.estimateCost(intent);
  }

  /**
   * Create plan from a pre-built template in the catalog
   * @example
   * ```ts
   * const result = await plugin.createPlanFromTemplate('three-tier-web', {
   *   environment: 'staging',
   *   instanceType: 't3.medium',
   * });
   * ```
   */
  async createPlanFromTemplate(
    templateId: string,
    parameters: Record<string, unknown>,
  ): Promise<import("./idio/orchestrator.js").IDIOResult> {
    return this.idio.createPlanFromTemplate(templateId, parameters);
  }

  /**
   * Execute an infrastructure plan
   */
  async executePlan(
    planId: string, 
    options?: { dryRun?: boolean; skipApproval?: boolean }
  ): Promise<import("./idio/orchestrator.js").IDIOResult> {
    return this.idio.executePlan(planId, options);
  }

  /**
   * Check execution status
   */
  async checkExecutionStatus(executionId: string): Promise<import("./idio/orchestrator.js").IDIOResult> {
    return this.idio.checkStatus(executionId);
  }

  /**
   * Reconcile infrastructure to match desired state
   */
  async reconcileInfrastructure(executionId: string): Promise<import("./idio/orchestrator.js").IDIOResult> {
    return this.idio.reconcile(executionId);
  }

  /**
   * Rollback an execution
   */
  async rollbackExecution(executionId: string): Promise<import("./idio/orchestrator.js").IDIOResult> {
    return this.idio.rollback(executionId);
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
