/**
 * AWS Backup & Disaster Recovery Module
 *
 * Provides backup plan management, recovery point operations,
 * cross-region replication, DR runbook generation, failover
 * orchestration, and compliance reporting capabilities.
 */

export { createBackupManager, type BackupManager } from './manager.js';
export type {
  // Configuration
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
} from './types.js';

// Re-export templates for direct access
export { BACKUP_PLAN_TEMPLATES, RESOURCE_TYPE_ARN_PREFIXES } from './types.js';
