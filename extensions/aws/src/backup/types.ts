/**
 * AWS Backup & Disaster Recovery Types
 *
 * Type definitions for AWS Backup plans, recovery points, cross-region replication,
 * disaster recovery runbooks, and compliance reporting operations.
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Backup operation result
 */
export interface BackupOperationResult<T = void> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/**
 * Backup Manager configuration
 */
export interface BackupManagerConfig {
  /** Default AWS region */
  defaultRegion?: string;
  /** DR region for cross-region operations */
  drRegion?: string;
  /** AWS credentials */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

// =============================================================================
// Backup Plan Types
// =============================================================================

/**
 * Backup plan information
 */
export interface BackupPlanInfo {
  backupPlanId: string;
  backupPlanArn: string;
  backupPlanName: string;
  versionId: string;
  creationDate: Date;
  lastExecutionDate?: Date;
  advancedBackupSettings?: AdvancedBackupSetting[];
  rules: BackupRuleInfo[];
}

/**
 * Backup rule information
 */
export interface BackupRuleInfo {
  ruleName: string;
  ruleId?: string;
  targetBackupVaultName: string;
  scheduleExpression?: string;
  startWindowMinutes?: number;
  completionWindowMinutes?: number;
  lifecycle?: BackupLifecycle;
  recoveryPointTags?: Record<string, string>;
  copyActions?: CopyAction[];
  enableContinuousBackup?: boolean;
}

/**
 * Backup lifecycle settings
 */
export interface BackupLifecycle {
  moveToColdStorageAfterDays?: number;
  deleteAfterDays?: number;
}

/**
 * Copy action for cross-region replication
 */
export interface CopyAction {
  destinationBackupVaultArn: string;
  lifecycle?: BackupLifecycle;
}

/**
 * Advanced backup settings
 */
export interface AdvancedBackupSetting {
  resourceType: string;
  backupOptions: Record<string, string>;
}

/**
 * Options for listing backup plans
 */
export interface ListBackupPlansOptions {
  maxResults?: number;
  includeDeleted?: boolean;
}

/**
 * Options for creating a backup plan
 */
export interface CreateBackupPlanOptions {
  backupPlanName: string;
  rules: CreateBackupRuleOptions[];
  advancedBackupSettings?: AdvancedBackupSetting[];
  tags?: Record<string, string>;
}

/**
 * Options for creating a backup rule
 */
export interface CreateBackupRuleOptions {
  ruleName: string;
  targetBackupVaultName: string;
  scheduleExpression?: string;
  startWindowMinutes?: number;
  completionWindowMinutes?: number;
  lifecycle?: BackupLifecycle;
  recoveryPointTags?: Record<string, string>;
  copyActions?: CopyAction[];
  enableContinuousBackup?: boolean;
}

/**
 * Options for updating a backup plan
 */
export interface UpdateBackupPlanOptions {
  backupPlanId: string;
  backupPlanName?: string;
  rules?: CreateBackupRuleOptions[];
  advancedBackupSettings?: AdvancedBackupSetting[];
}

// =============================================================================
// Backup Vault Types
// =============================================================================

/**
 * Backup vault information
 */
export interface BackupVaultInfo {
  backupVaultName: string;
  backupVaultArn: string;
  creationDate: Date;
  encryptionKeyArn?: string;
  creatorRequestId?: string;
  numberOfRecoveryPoints: number;
  locked: boolean;
  minRetentionDays?: number;
  maxRetentionDays?: number;
  lockDate?: Date;
}

/**
 * Options for listing backup vaults
 */
export interface ListBackupVaultsOptions {
  maxResults?: number;
}

/**
 * Options for creating a backup vault
 */
export interface CreateBackupVaultOptions {
  backupVaultName: string;
  encryptionKeyArn?: string;
  tags?: Record<string, string>;
}

/**
 * Options for locking a backup vault
 */
export interface LockBackupVaultOptions {
  backupVaultName: string;
  minRetentionDays: number;
  maxRetentionDays?: number;
  changeableForDays?: number;
}

// =============================================================================
// Recovery Point Types
// =============================================================================

/**
 * Recovery point information
 */
export interface RecoveryPointInfo {
  recoveryPointArn: string;
  backupVaultName: string;
  backupVaultArn: string;
  sourceBackupVaultArn?: string;
  resourceArn: string;
  resourceType: string;
  createdBy?: RecoveryPointCreator;
  iamRoleArn?: string;
  status: RecoveryPointStatus;
  statusMessage?: string;
  creationDate: Date;
  completionDate?: Date;
  backupSizeInBytes?: number;
  calculatedLifecycle?: CalculatedLifecycle;
  lifecycle?: BackupLifecycle;
  encryptionKeyArn?: string;
  isEncrypted: boolean;
  storageClass?: StorageClass;
  lastRestoreTime?: Date;
  parentRecoveryPointArn?: string;
  compositeMemberIdentifier?: string;
  isParent: boolean;
}

/**
 * Recovery point creator info
 */
export interface RecoveryPointCreator {
  backupPlanId?: string;
  backupPlanArn?: string;
  backupPlanVersion?: string;
  backupRuleId?: string;
}

/**
 * Calculated lifecycle based on rules
 */
export interface CalculatedLifecycle {
  moveToColdStorageAt?: Date;
  deleteAt?: Date;
}

/**
 * Recovery point status
 */
export type RecoveryPointStatus =
  | 'COMPLETED'
  | 'PARTIAL'
  | 'DELETING'
  | 'EXPIRED';

/**
 * Storage class for recovery points
 */
export type StorageClass = 'WARM' | 'COLD' | 'DELETED';

/**
 * Options for listing recovery points
 */
export interface ListRecoveryPointsOptions {
  backupVaultName?: string;
  resourceArn?: string;
  resourceType?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  maxResults?: number;
}

/**
 * Options for getting recovery point details
 */
export interface GetRecoveryPointOptions {
  backupVaultName: string;
  recoveryPointArn: string;
}

// =============================================================================
// Backup Selection Types
// =============================================================================

/**
 * Backup selection information
 */
export interface BackupSelectionInfo {
  selectionId: string;
  selectionName: string;
  backupPlanId: string;
  iamRoleArn: string;
  resources?: string[];
  listOfTags?: TagCondition[];
  notResources?: string[];
  conditions?: BackupConditions;
  creationDate: Date;
  creatorRequestId?: string;
}

/**
 * Tag condition for selection
 */
export interface TagCondition {
  conditionType: 'STRINGEQUALS';
  conditionKey: string;
  conditionValue: string;
}

/**
 * Backup conditions for advanced selection
 */
export interface BackupConditions {
  stringEquals?: ConditionParameter[];
  stringNotEquals?: ConditionParameter[];
  stringLike?: ConditionParameter[];
  stringNotLike?: ConditionParameter[];
}

/**
 * Condition parameter
 */
export interface ConditionParameter {
  conditionKey: string;
  conditionValue: string;
}

/**
 * Options for creating a backup selection
 */
export interface CreateBackupSelectionOptions {
  backupPlanId: string;
  selectionName: string;
  iamRoleArn: string;
  resources?: string[];
  listOfTags?: TagCondition[];
  notResources?: string[];
  conditions?: BackupConditions;
}

// =============================================================================
// Restore Types
// =============================================================================

/**
 * Restore job information
 */
export interface RestoreJobInfo {
  restoreJobId: string;
  accountId: string;
  recoveryPointArn: string;
  creationDate: Date;
  completionDate?: Date;
  status: RestoreJobStatus;
  statusMessage?: string;
  percentDone?: string;
  backupSizeInBytes?: number;
  iamRoleArn?: string;
  expectedCompletionTimeMinutes?: number;
  createdResourceArn?: string;
  resourceType?: string;
}

/**
 * Restore job status
 */
export type RestoreJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'ABORTED'
  | 'FAILED';

/**
 * Options for listing restore jobs
 */
export interface ListRestoreJobsOptions {
  accountId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  status?: RestoreJobStatus;
  maxResults?: number;
}

/**
 * Options for starting a restore job
 */
export interface StartRestoreOptions {
  recoveryPointArn: string;
  resourceType: string;
  iamRoleArn: string;
  metadata: Record<string, string>;
  idempotencyToken?: string;
  copySourceTagsToRestoredResource?: boolean;
}

/**
 * Resource type specific restore metadata
 */
export interface RestoreMetadata {
  // EC2
  instanceType?: string;
  subnetId?: string;
  securityGroupIds?: string[];
  availabilityZone?: string;
  
  // RDS
  dbInstanceClass?: string;
  dbSubnetGroupName?: string;
  multiAz?: boolean;
  publiclyAccessible?: boolean;
  
  // EBS
  volumeType?: string;
  iops?: number;
  throughput?: number;
  
  // S3
  destinationBucketName?: string;
  itemsToRestore?: string[];
  
  // DynamoDB
  tableName?: string;
  encryptionType?: string;
  
  // EFS
  fileSystemId?: string;
  performanceMode?: string;
}

// =============================================================================
// Backup Job Types
// =============================================================================

/**
 * Backup job information
 */
export interface BackupJobInfo {
  backupJobId: string;
  accountId: string;
  backupVaultName: string;
  backupVaultArn: string;
  recoveryPointArn?: string;
  resourceArn: string;
  resourceType: string;
  creationDate: Date;
  completionDate?: Date;
  state: BackupJobState;
  statusMessage?: string;
  percentDone?: string;
  backupSizeInBytes?: number;
  iamRoleArn?: string;
  createdBy?: RecoveryPointCreator;
  expectedCompletionDate?: Date;
  startBy?: Date;
  backupType: string;
  parentJobId?: string;
  isParent: boolean;
}

/**
 * Backup job state
 */
export type BackupJobState =
  | 'CREATED'
  | 'PENDING'
  | 'RUNNING'
  | 'ABORTING'
  | 'ABORTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'
  | 'PARTIAL';

/**
 * Options for listing backup jobs
 */
export interface ListBackupJobsOptions {
  resourceArn?: string;
  resourceType?: string;
  backupVaultName?: string;
  state?: BackupJobState;
  createdAfter?: Date;
  createdBefore?: Date;
  maxResults?: number;
}

/**
 * Options for starting an on-demand backup
 */
export interface StartBackupOptions {
  resourceArn: string;
  backupVaultName: string;
  iamRoleArn: string;
  idempotencyToken?: string;
  startWindowMinutes?: number;
  completeWindowMinutes?: number;
  lifecycle?: BackupLifecycle;
  recoveryPointTags?: Record<string, string>;
  backupOptions?: Record<string, string>;
}

// =============================================================================
// Cross-Region Replication Types
// =============================================================================

/**
 * Cross-region replication configuration
 */
export interface ReplicationConfiguration {
  sourceRegion: string;
  destinationRegion: string;
  sourceVaultName: string;
  destinationVaultArn: string;
  lifecycle?: BackupLifecycle;
  resourceTypes?: string[];
  status: 'ENABLED' | 'DISABLED';
}

/**
 * Options for configuring cross-region replication
 */
export interface ConfigureReplicationOptions {
  sourceVaultName: string;
  destinationRegion: string;
  destinationVaultName?: string;
  lifecycle?: BackupLifecycle;
  resourceTypes?: string[];
  createDestinationVault?: boolean;
}

/**
 * Copy job information
 */
export interface CopyJobInfo {
  copyJobId: string;
  accountId: string;
  sourceBackupVaultArn: string;
  sourceRecoveryPointArn: string;
  destinationBackupVaultArn: string;
  destinationRecoveryPointArn?: string;
  resourceArn: string;
  resourceType: string;
  creationDate: Date;
  completionDate?: Date;
  state: CopyJobState;
  statusMessage?: string;
  backupSizeInBytes?: number;
  iamRoleArn?: string;
  createdBy?: RecoveryPointCreator;
  parentJobId?: string;
  isParent: boolean;
}

/**
 * Copy job state
 */
export type CopyJobState =
  | 'CREATED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'PARTIAL';

/**
 * Options for starting a copy job
 */
export interface StartCopyOptions {
  sourceBackupVaultName: string;
  recoveryPointArn: string;
  destinationBackupVaultArn: string;
  iamRoleArn: string;
  idempotencyToken?: string;
  lifecycle?: BackupLifecycle;
}

// =============================================================================
// DR Runbook Types
// =============================================================================

/**
 * DR Runbook definition
 */
export interface DRRunbook {
  id: string;
  name: string;
  description: string;
  version: string;
  createdDate: Date;
  lastUpdatedDate: Date;
  targetRPO: string;
  targetRTO: string;
  sourceRegion: string;
  drRegion: string;
  steps: DRRunbookStep[];
  resources: DRResource[];
  contacts: DRContact[];
  preConditions: DRPreCondition[];
  postConditions: DRPostCondition[];
  rollbackSteps: DRRunbookStep[];
  testSchedule?: string;
  lastTestDate?: Date;
  lastTestResult?: DRTestResult;
}

/**
 * DR Runbook step
 */
export interface DRRunbookStep {
  stepNumber: number;
  name: string;
  description: string;
  type: DRStepType;
  action: DRStepAction;
  estimatedDurationMinutes: number;
  automated: boolean;
  dependencies?: number[];
  rollbackStep?: number;
}

/**
 * DR step type
 */
export type DRStepType =
  | 'VERIFICATION'
  | 'NOTIFICATION'
  | 'INFRASTRUCTURE'
  | 'DATABASE'
  | 'APPLICATION'
  | 'DNS'
  | 'TESTING'
  | 'ROLLBACK';

/**
 * DR step action configuration
 */
export interface DRStepAction {
  actionType: string;
  resourceType?: string;
  resourceArn?: string;
  command?: string;
  script?: string;
  parameters?: Record<string, string>;
}

/**
 * DR resource tracked in runbook
 */
export interface DRResource {
  resourceArn: string;
  resourceType: string;
  resourceName: string;
  sourceRegion: string;
  drRegion: string;
  replicationMethod: 'BACKUP' | 'NATIVE' | 'MANUAL';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  rpo?: string;
  rto?: string;
  notes?: string;
}

/**
 * DR contact information
 */
export interface DRContact {
  name: string;
  role: string;
  email: string;
  phone?: string;
  isPrimary: boolean;
}

/**
 * DR pre-condition check
 */
export interface DRPreCondition {
  name: string;
  description: string;
  checkType: 'MANUAL' | 'AUTOMATED';
  checkScript?: string;
  expectedResult: string;
}

/**
 * DR post-condition check
 */
export interface DRPostCondition {
  name: string;
  description: string;
  checkType: 'MANUAL' | 'AUTOMATED';
  checkScript?: string;
  expectedResult: string;
}

/**
 * DR test result
 */
export interface DRTestResult {
  testId: string;
  testDate: Date;
  status: 'PASSED' | 'FAILED' | 'PARTIAL';
  actualRTO: string;
  actualRPO: string;
  stepsCompleted: number;
  stepsFailed: number;
  issues: string[];
  recommendations: string[];
}

/**
 * Options for generating a DR runbook
 */
export interface GenerateDRRunbookOptions {
  name: string;
  description?: string;
  sourceRegion: string;
  drRegion: string;
  targetRPO: string;
  targetRTO: string;
  resourceArns?: string[];
  resourceTypes?: string[];
  includeRollback?: boolean;
  contacts?: DRContact[];
}

// =============================================================================
// Failover Types
// =============================================================================

/**
 * Failover execution plan
 */
export interface FailoverPlan {
  planId: string;
  planName: string;
  sourceRegion: string;
  targetRegion: string;
  status: FailoverStatus;
  createdDate: Date;
  executionDate?: Date;
  completedDate?: Date;
  steps: FailoverStep[];
  estimatedDurationMinutes: number;
  actualDurationMinutes?: number;
}

/**
 * Failover status
 */
export type FailoverStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'ROLLED_BACK';

/**
 * Failover step
 */
export interface FailoverStep {
  stepNumber: number;
  name: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  startTime?: Date;
  endTime?: Date;
  error?: string;
  resourceArn?: string;
  actionTaken?: string;
}

/**
 * Options for executing a failover
 */
export interface ExecuteFailoverOptions {
  sourceRegion: string;
  targetRegion: string;
  resourceArns?: string[];
  resourceTypes?: string[];
  runbookId?: string;
  dryRun?: boolean;
  skipHealthChecks?: boolean;
  notifyContacts?: boolean;
}

/**
 * Failover result
 */
export interface FailoverResult {
  success: boolean;
  planId: string;
  status: FailoverStatus;
  stepsCompleted: number;
  stepsFailed: number;
  resourcesFailedOver: ResourceFailoverResult[];
  errors: string[];
  durationMinutes: number;
}

/**
 * Individual resource failover result
 */
export interface ResourceFailoverResult {
  sourceResourceArn: string;
  targetResourceArn?: string;
  resourceType: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  error?: string;
}

// =============================================================================
// Compliance Types
// =============================================================================

/**
 * Backup compliance status
 */
export interface BackupComplianceStatus {
  overallStatus: 'COMPLIANT' | 'NON_COMPLIANT' | 'UNKNOWN';
  lastEvaluatedDate: Date;
  resourcesEvaluated: number;
  resourcesCompliant: number;
  resourcesNonCompliant: number;
  complianceByResourceType: Record<string, ResourceTypeCompliance>;
  complianceByBackupPlan: Record<string, BackupPlanCompliance>;
  issues: ComplianceIssue[];
}

/**
 * Resource type compliance
 */
export interface ResourceTypeCompliance {
  resourceType: string;
  totalResources: number;
  compliantResources: number;
  nonCompliantResources: number;
  percentCompliant: number;
}

/**
 * Backup plan compliance
 */
export interface BackupPlanCompliance {
  backupPlanId: string;
  backupPlanName: string;
  totalSelections: number;
  totalProtectedResources: number;
  missedBackups: number;
  lastSuccessfulBackup?: Date;
}

/**
 * Compliance issue detail
 */
export interface ComplianceIssue {
  resourceArn: string;
  resourceType: string;
  issueType: ComplianceIssueType;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  recommendation: string;
  backupPlanId?: string;
}

/**
 * Compliance issue types
 */
export type ComplianceIssueType =
  | 'NO_BACKUP_PLAN'
  | 'MISSED_BACKUP'
  | 'RETENTION_TOO_SHORT'
  | 'NO_CROSS_REGION_COPY'
  | 'UNENCRYPTED_BACKUP'
  | 'NO_RECOVERY_POINT'
  | 'BACKUP_PLAN_DISABLED'
  | 'VAULT_NOT_LOCKED';

/**
 * Options for getting compliance status
 */
export interface GetComplianceOptions {
  resourceTypes?: string[];
  backupPlanIds?: string[];
  includeResourceDetails?: boolean;
}

/**
 * Framework control information
 */
export interface FrameworkControl {
  controlName: string;
  controlInputParameters?: Record<string, string>;
  controlScope?: ControlScope;
}

/**
 * Control scope
 */
export interface ControlScope {
  complianceResourceIds?: string[];
  complianceResourceTypes?: string[];
  tags?: Record<string, string>;
}

/**
 * Framework information
 */
export interface FrameworkInfo {
  frameworkName: string;
  frameworkArn: string;
  frameworkDescription?: string;
  frameworkControls: FrameworkControl[];
  creationTime: Date;
  deploymentStatus: 'CREATE_IN_PROGRESS' | 'UPDATE_IN_PROGRESS' | 'DELETE_IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  frameworkStatus?: string;
  idempotencyToken?: string;
  numberOfControls: number;
}

/**
 * Options for creating a compliance framework
 */
export interface CreateFrameworkOptions {
  frameworkName: string;
  frameworkDescription?: string;
  frameworkControls: FrameworkControl[];
  tags?: Record<string, string>;
}

// =============================================================================
// Recovery Testing Types
// =============================================================================

/**
 * Recovery test information
 */
export interface RecoveryTestInfo {
  testId: string;
  testName: string;
  testDate: Date;
  status: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  resourceArn: string;
  resourceType: string;
  recoveryPointArn: string;
  restoredResourceArn?: string;
  startTime?: Date;
  endTime?: Date;
  durationMinutes?: number;
  validationSteps: ValidationStep[];
  overallResult?: 'PASSED' | 'FAILED' | 'PARTIAL';
  notes?: string;
}

/**
 * Validation step in recovery test
 */
export interface ValidationStep {
  stepName: string;
  stepType: 'CONNECTIVITY' | 'DATA_INTEGRITY' | 'PERFORMANCE' | 'CUSTOM';
  status: 'PENDING' | 'PASSED' | 'FAILED' | 'SKIPPED';
  expectedResult: string;
  actualResult?: string;
  error?: string;
}

/**
 * Options for running a recovery test
 */
export interface RunRecoveryTestOptions {
  testName: string;
  recoveryPointArn: string;
  resourceType: string;
  restoreMetadata: Record<string, string>;
  iamRoleArn: string;
  validationSteps?: ValidationStep[];
  cleanupAfterTest?: boolean;
  timeoutMinutes?: number;
}

/**
 * Recovery test result
 */
export interface RecoveryTestResult {
  testId: string;
  success: boolean;
  resourceRestored: boolean;
  restoredResourceArn?: string;
  validationsPassed: number;
  validationsFailed: number;
  actualRecoveryTimeMinutes: number;
  errors: string[];
  cleanedUp: boolean;
}

// =============================================================================
// Report Types
// =============================================================================

/**
 * Report plan information
 */
export interface ReportPlanInfo {
  reportPlanArn: string;
  reportPlanName: string;
  reportPlanDescription?: string;
  reportSetting: ReportSetting;
  reportDeliveryChannel: ReportDeliveryChannel;
  creationTime: Date;
  lastAttemptedExecutionTime?: Date;
  lastSuccessfulExecutionTime?: Date;
  deploymentStatus: 'CREATE_IN_PROGRESS' | 'UPDATE_IN_PROGRESS' | 'DELETE_IN_PROGRESS' | 'COMPLETED';
}

/**
 * Report setting
 */
export interface ReportSetting {
  reportTemplate: ReportTemplate;
  frameworkArns?: string[];
  numberOfFrameworks?: number;
  accounts?: string[];
  organizationUnits?: string[];
  regions?: string[];
}

/**
 * Report template types
 */
export type ReportTemplate =
  | 'RESOURCE_COMPLIANCE_REPORT'
  | 'CONTROL_COMPLIANCE_REPORT'
  | 'BACKUP_JOB_REPORT'
  | 'COPY_JOB_REPORT'
  | 'RESTORE_JOB_REPORT';

/**
 * Report delivery channel
 */
export interface ReportDeliveryChannel {
  s3BucketName: string;
  s3KeyPrefix?: string;
  formats?: ('CSV' | 'JSON')[];
}

/**
 * Options for creating a report plan
 */
export interface CreateReportPlanOptions {
  reportPlanName: string;
  reportPlanDescription?: string;
  reportTemplate: ReportTemplate;
  s3BucketName: string;
  s3KeyPrefix?: string;
  formats?: ('CSV' | 'JSON')[];
  frameworkArns?: string[];
  accounts?: string[];
  organizationUnits?: string[];
  regions?: string[];
  tags?: Record<string, string>;
}

// =============================================================================
// Protected Resource Types
// =============================================================================

/**
 * Protected resource information
 */
export interface ProtectedResourceInfo {
  resourceArn: string;
  resourceType: string;
  resourceName?: string;
  lastBackupTime?: Date;
  lastRecoveryPointArn?: string;
  backupPlanId?: string;
  backupPlanName?: string;
}

/**
 * Options for listing protected resources
 */
export interface ListProtectedResourcesOptions {
  maxResults?: number;
}

// =============================================================================
// Supported Resource Types
// =============================================================================

/**
 * AWS Backup supported resource types
 */
export type BackupResourceType =
  | 'EC2'
  | 'EBS'
  | 'RDS'
  | 'Aurora'
  | 'DynamoDB'
  | 'EFS'
  | 'FSx'
  | 'Storage Gateway'
  | 'DocumentDB'
  | 'Neptune'
  | 'Redshift'
  | 'S3'
  | 'CloudFormation'
  | 'SAP HANA on EC2'
  | 'Timestream'
  | 'VirtualMachine';

/**
 * Resource type ARN prefix mapping
 */
export const RESOURCE_TYPE_ARN_PREFIXES: Record<BackupResourceType, string> = {
  'EC2': 'arn:aws:ec2:',
  'EBS': 'arn:aws:ec2:',
  'RDS': 'arn:aws:rds:',
  'Aurora': 'arn:aws:rds:',
  'DynamoDB': 'arn:aws:dynamodb:',
  'EFS': 'arn:aws:elasticfilesystem:',
  'FSx': 'arn:aws:fsx:',
  'Storage Gateway': 'arn:aws:storagegateway:',
  'DocumentDB': 'arn:aws:rds:',
  'Neptune': 'arn:aws:rds:',
  'Redshift': 'arn:aws:redshift:',
  'S3': 'arn:aws:s3:',
  'CloudFormation': 'arn:aws:cloudformation:',
  'SAP HANA on EC2': 'arn:aws:ec2:',
  'Timestream': 'arn:aws:timestream:',
  'VirtualMachine': 'arn:aws:backup-gateway:',
};

// =============================================================================
// Predefined Backup Plan Templates
// =============================================================================

/**
 * Predefined backup plan template
 */
export interface BackupPlanTemplate {
  id: string;
  name: string;
  description: string;
  category: 'daily' | 'weekly' | 'monthly' | 'compliance' | 'enterprise';
  targetRPO: string;
  rules: CreateBackupRuleOptions[];
  tags?: Record<string, string>;
}

/**
 * Available backup plan templates
 */
export const BACKUP_PLAN_TEMPLATES: BackupPlanTemplate[] = [
  {
    id: 'daily-35day-retention',
    name: 'Daily Backup - 35 Day Retention',
    description: 'Daily backups at 5 AM UTC with 35-day retention',
    category: 'daily',
    targetRPO: '24 hours',
    rules: [{
      ruleName: 'DailyBackup',
      targetBackupVaultName: 'Default',
      scheduleExpression: 'cron(0 5 ? * * *)',
      startWindowMinutes: 60,
      completionWindowMinutes: 180,
      lifecycle: { deleteAfterDays: 35 },
    }],
  },
  {
    id: 'weekly-90day-retention',
    name: 'Weekly Backup - 90 Day Retention',
    description: 'Weekly backups on Sunday at 5 AM UTC with 90-day retention',
    category: 'weekly',
    targetRPO: '7 days',
    rules: [{
      ruleName: 'WeeklyBackup',
      targetBackupVaultName: 'Default',
      scheduleExpression: 'cron(0 5 ? * SUN *)',
      startWindowMinutes: 60,
      completionWindowMinutes: 360,
      lifecycle: { deleteAfterDays: 90 },
    }],
  },
  {
    id: 'monthly-1year-retention',
    name: 'Monthly Backup - 1 Year Retention',
    description: 'Monthly backups on the 1st at 5 AM UTC with 1-year retention',
    category: 'monthly',
    targetRPO: '30 days',
    rules: [{
      ruleName: 'MonthlyBackup',
      targetBackupVaultName: 'Default',
      scheduleExpression: 'cron(0 5 1 * ? *)',
      startWindowMinutes: 60,
      completionWindowMinutes: 720,
      lifecycle: { 
        moveToColdStorageAfterDays: 90,
        deleteAfterDays: 365,
      },
    }],
  },
  {
    id: 'production-standard',
    name: 'Production Standard',
    description: 'Daily + Weekly + Monthly with cross-region copy',
    category: 'enterprise',
    targetRPO: '24 hours',
    rules: [
      {
        ruleName: 'DailyBackup',
        targetBackupVaultName: 'Default',
        scheduleExpression: 'cron(0 5 ? * * *)',
        startWindowMinutes: 60,
        completionWindowMinutes: 180,
        lifecycle: { deleteAfterDays: 35 },
      },
      {
        ruleName: 'WeeklyBackup',
        targetBackupVaultName: 'Default',
        scheduleExpression: 'cron(0 5 ? * SUN *)',
        startWindowMinutes: 60,
        completionWindowMinutes: 360,
        lifecycle: { deleteAfterDays: 90 },
      },
      {
        ruleName: 'MonthlyBackup',
        targetBackupVaultName: 'Default',
        scheduleExpression: 'cron(0 5 1 * ? *)',
        startWindowMinutes: 60,
        completionWindowMinutes: 720,
        lifecycle: { 
          moveToColdStorageAfterDays: 90,
          deleteAfterDays: 365,
        },
      },
    ],
  },
  {
    id: 'compliance-hipaa',
    name: 'HIPAA Compliance',
    description: 'HIPAA-compliant backup with 7-year retention',
    category: 'compliance',
    targetRPO: '24 hours',
    rules: [
      {
        ruleName: 'DailyBackup',
        targetBackupVaultName: 'Default',
        scheduleExpression: 'cron(0 5 ? * * *)',
        startWindowMinutes: 60,
        completionWindowMinutes: 180,
        lifecycle: { deleteAfterDays: 35 },
      },
      {
        ruleName: 'MonthlyArchive',
        targetBackupVaultName: 'Default',
        scheduleExpression: 'cron(0 5 1 * ? *)',
        startWindowMinutes: 60,
        completionWindowMinutes: 720,
        lifecycle: { 
          moveToColdStorageAfterDays: 30,
          deleteAfterDays: 2555, // ~7 years
        },
      },
    ],
  },
  {
    id: 'compliance-gdpr',
    name: 'GDPR Compliance',
    description: 'GDPR-compliant backup with retention limits',
    category: 'compliance',
    targetRPO: '24 hours',
    rules: [{
      ruleName: 'DailyBackup',
      targetBackupVaultName: 'Default',
      scheduleExpression: 'cron(0 5 ? * * *)',
      startWindowMinutes: 60,
      completionWindowMinutes: 180,
      lifecycle: { deleteAfterDays: 30 }, // GDPR limits retention
    }],
  },
  {
    id: 'continuous-pit',
    name: 'Continuous Point-in-Time',
    description: 'Continuous backup with point-in-time recovery',
    category: 'enterprise',
    targetRPO: '5 minutes',
    rules: [{
      ruleName: 'ContinuousBackup',
      targetBackupVaultName: 'Default',
      enableContinuousBackup: true,
      lifecycle: { deleteAfterDays: 35 },
    }],
  },
];
