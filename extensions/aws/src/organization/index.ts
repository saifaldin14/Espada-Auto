/**
 * AWS Organization Module
 *
 * Provides multi-account and organization management capabilities including:
 * - Organization and account management
 * - Organizational Unit (OU) operations
 * - Service Control Policies (SCPs)
 * - Cross-account operations via assume role
 * - Resource Access Manager (RAM) for resource sharing
 * - Consolidated billing insights
 * - Delegated administrator management
 */

export { createOrganizationManager, type OrganizationManager } from './manager.js';
export type {
  // Configuration
  OrganizationManagerConfig,
  OrganizationOperationResult,
  
  // Organization types
  OrganizationInfo,
  OrganizationRootInfo,
  OrganizationStatus,
  PolicyTypeSummary,
  
  // Account types
  AccountInfo,
  DetailedAccountInfo,
  AccountStatus,
  AccountJoinMethod,
  ListAccountsOptions,
  CreateAccountOptions,
  CreateAccountStatus,
  MoveAccountOptions,
  
  // Organizational Unit types
  OrganizationalUnitInfo,
  CreateOUOptions,
  ListOUsOptions,
  
  // SCP types
  PolicyType,
  PolicySummary,
  SCPInfo,
  SCPDocument,
  SCPStatement,
  PolicyTargetInfo,
  PolicyAttachment,
  CreateSCPOptions,
  UpdateSCPOptions,
  ListPoliciesOptions,
  SCPTemplate,
  SCPCategory,
  
  // Cross-account types
  AssumedRoleCredentials,
  AssumeRoleOptions,
  CrossAccountSession,
  AccountContext,
  
  // Resource sharing (RAM) types
  ResourceShareStatus,
  AssociationStatus,
  ResourceShareInfo,
  SharedResourceInfo,
  ShareableResourceType,
  CreateResourceShareOptions,
  ListResourceSharesOptions,
  
  // Consolidated billing types
  ConsolidatedBillingSummary,
  AccountCostBreakdown,
  ServiceCostBreakdown,
  GetConsolidatedBillingOptions,
  
  // Delegated administrator types
  DelegatedAdministratorInfo,
  DelegatedServiceInfo,
  
  // Handshake types
  HandshakeState,
  HandshakeInfo,
  InviteAccountOptions,
  
  // Cross-account resource discovery types
  CrossAccountResource,
  CrossAccountResourceOptions,
  CrossAccountResourceSummary,
  
  // Event types
  OrganizationEvent,
  OrganizationEventType,
} from './types.js';
