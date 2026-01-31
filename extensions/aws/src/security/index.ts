/**
 * AWS Security Module
 *
 * Provides IAM, Security Hub, GuardDuty, KMS, Secrets Manager,
 * and Access Analyzer management capabilities.
 */

export { createSecurityManager, type SecurityManager } from './manager.js';
export type {
  // Configuration
  SecurityManagerConfig,
  SecurityOperationResult,
  
  // IAM Types
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
  
  // Security Hub Types
  SecurityFindingSeverity,
  SecurityFindingStatus,
  WorkflowStatus,
  ComplianceStatus,
  SecurityFinding,
  SecurityFindingResource,
  ListSecurityFindingsOptions,
  SecurityStandard,
  SecurityControl,
  
  // GuardDuty Types
  GuardDutySeverity,
  GuardDutyFinding,
  GuardDutyResource,
  GuardDutyService,
  RemoteIpDetails,
  ListGuardDutyFindingsOptions,
  GuardDutyDetector,
  
  // KMS Types
  KMSKeyState,
  KMSKeySpec,
  KMSKeyUsage,
  KMSKeyOrigin,
  KMSKeyInfo,
  ListKMSKeysOptions,
  CreateKMSKeyOptions,
  KMSKeyPolicy,
  KMSPolicyStatement,
  
  // Secrets Manager Types
  SecretInfo,
  SecretVersionInfo,
  ListSecretsOptions,
  CreateSecretOptions,
  UpdateSecretOptions,
  RotateSecretOptions,
  SecretValue,
  
  // Access Analyzer Types
  AccessAnalyzerFindingStatus,
  AccessAnalyzerResourceType,
  AccessAnalyzerFinding,
  ListAccessAnalyzerFindingsOptions,
  AccessAnalyzerInfo,
  CreateAccessAnalyzerOptions,
  
  // Policy Simulation Types
  PolicySimulationResult,
  SimulatePolicyOptions,
  
  // Security Summary Types
  SecurityPostureSummary,
  ComplianceFramework,
  ComplianceCheckResult,
  
  // Policy Templates
  PolicyTemplate,
  PolicyTemplateDefinition,
} from './types.js';
