/**
 * AWS Organization Manager
 *
 * Provides comprehensive multi-account and organization management including:
 * - Organization and account management
 * - Service Control Policies (SCPs)
 * - Cross-account operations via assume role
 * - Resource Access Manager (RAM) for resource sharing
 * - Consolidated billing insights
 * - Delegated administrator management
 */

import {
  OrganizationsClient,
  DescribeOrganizationCommand,
  ListAccountsCommand,
  ListAccountsForParentCommand,
  DescribeAccountCommand,
  CreateAccountCommand,
  DescribeCreateAccountStatusCommand,
  MoveAccountCommand,
  RemoveAccountFromOrganizationCommand,
  ListRootsCommand,
  ListOrganizationalUnitsForParentCommand,
  DescribeOrganizationalUnitCommand,
  CreateOrganizationalUnitCommand,
  UpdateOrganizationalUnitCommand,
  DeleteOrganizationalUnitCommand,
  ListPoliciesCommand,
  DescribePolicyCommand,
  CreatePolicyCommand,
  UpdatePolicyCommand,
  DeletePolicyCommand,
  AttachPolicyCommand,
  DetachPolicyCommand,
  ListPoliciesForTargetCommand,
  ListTargetsForPolicyCommand,
  ListParentsCommand,
  ListDelegatedAdministratorsCommand,
  ListDelegatedServicesForAccountCommand,
  RegisterDelegatedAdministratorCommand,
  DeregisterDelegatedAdministratorCommand,
  EnablePolicyTypeCommand,
  DisablePolicyTypeCommand,
  ListHandshakesForOrganizationCommand,
  InviteAccountToOrganizationCommand,
  AcceptHandshakeCommand,
  DeclineHandshakeCommand,
  CancelHandshakeCommand,
  ListTagsForResourceCommand,
  TagResourceCommand,
  UntagResourceCommand,
  type Account,
  type Organization,
  type OrganizationalUnit,
  type Policy,
  type PolicySummary as AWSSPolicySummary,
  type Root,
  type Handshake,
} from '@aws-sdk/client-organizations';

import {
  STSClient,
  AssumeRoleCommand,
  GetCallerIdentityCommand,
  type Credentials,
} from '@aws-sdk/client-sts';

import {
  RAMClient,
  CreateResourceShareCommand,
  DeleteResourceShareCommand,
  GetResourceSharesCommand,
  AssociateResourceShareCommand,
  DisassociateResourceShareCommand,
  ListResourcesCommand,
  ListPrincipalsCommand,
  GetResourceShareAssociationsCommand,
  ListResourceTypesCommand,
  type ResourceShare,
  type Resource as RAMResource,
} from '@aws-sdk/client-ram';

import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  Dimension,
} from '@aws-sdk/client-cost-explorer';

import type {
  OrganizationManagerConfig,
  OrganizationOperationResult,
  OrganizationInfo,
  AccountInfo,
  DetailedAccountInfo,
  ListAccountsOptions,
  CreateAccountOptions,
  CreateAccountStatus,
  MoveAccountOptions,
  OrganizationalUnitInfo,
  OrganizationRootInfo,
  CreateOUOptions,
  ListOUsOptions,
  SCPInfo,
  SCPDocument,
  SCPStatement,
  PolicyTargetInfo,
  PolicyAttachment,
  CreateSCPOptions,
  UpdateSCPOptions,
  ListPoliciesOptions,
  PolicyType,
  AssumedRoleCredentials,
  AssumeRoleOptions,
  CrossAccountSession,
  AccountContext,
  ResourceShareInfo,
  SharedResourceInfo,
  CreateResourceShareOptions,
  ListResourceSharesOptions,
  ConsolidatedBillingSummary,
  AccountCostBreakdown,
  ServiceCostBreakdown,
  GetConsolidatedBillingOptions,
  DelegatedAdministratorInfo,
  DelegatedServiceInfo,
  HandshakeInfo,
  InviteAccountOptions,
  CrossAccountResource,
  CrossAccountResourceOptions,
  CrossAccountResourceSummary,
  SCPTemplate,
  SCPCategory,
} from './types.js';

/**
 * Organization Manager interface
 */
export interface OrganizationManager {
  // Organization operations
  getOrganization(): Promise<OrganizationOperationResult<OrganizationInfo>>;
  getRoots(): Promise<OrganizationOperationResult<OrganizationRootInfo[]>>;
  
  // Account operations
  listAccounts(options?: ListAccountsOptions): Promise<OrganizationOperationResult<AccountInfo[]>>;
  getAccount(accountId: string): Promise<OrganizationOperationResult<DetailedAccountInfo>>;
  createAccount(options: CreateAccountOptions): Promise<OrganizationOperationResult<CreateAccountStatus>>;
  getCreateAccountStatus(requestId: string): Promise<OrganizationOperationResult<CreateAccountStatus>>;
  moveAccount(options: MoveAccountOptions): Promise<OrganizationOperationResult<void>>;
  removeAccount(accountId: string): Promise<OrganizationOperationResult<void>>;
  
  // Organizational Unit operations
  listOrganizationalUnits(options?: ListOUsOptions): Promise<OrganizationOperationResult<OrganizationalUnitInfo[]>>;
  getOrganizationalUnit(ouId: string): Promise<OrganizationOperationResult<OrganizationalUnitInfo>>;
  createOrganizationalUnit(options: CreateOUOptions): Promise<OrganizationOperationResult<OrganizationalUnitInfo>>;
  updateOrganizationalUnit(ouId: string, name: string): Promise<OrganizationOperationResult<OrganizationalUnitInfo>>;
  deleteOrganizationalUnit(ouId: string): Promise<OrganizationOperationResult<void>>;
  
  // SCP operations
  listPolicies(options?: ListPoliciesOptions): Promise<OrganizationOperationResult<SCPInfo[]>>;
  getPolicy(policyId: string): Promise<OrganizationOperationResult<SCPInfo>>;
  createPolicy(options: CreateSCPOptions): Promise<OrganizationOperationResult<SCPInfo>>;
  updatePolicy(options: UpdateSCPOptions): Promise<OrganizationOperationResult<SCPInfo>>;
  deletePolicy(policyId: string): Promise<OrganizationOperationResult<void>>;
  attachPolicy(policyId: string, targetId: string): Promise<OrganizationOperationResult<void>>;
  detachPolicy(policyId: string, targetId: string): Promise<OrganizationOperationResult<void>>;
  listPoliciesForTarget(targetId: string, policyType?: PolicyType): Promise<OrganizationOperationResult<PolicyAttachment[]>>;
  getPolicyTargets(policyId: string): Promise<OrganizationOperationResult<PolicyTargetInfo[]>>;
  enablePolicyType(rootId: string, policyType: PolicyType): Promise<OrganizationOperationResult<void>>;
  disablePolicyType(rootId: string, policyType: PolicyType): Promise<OrganizationOperationResult<void>>;
  
  // SCP Templates
  getSCPTemplates(category?: SCPCategory): SCPTemplate[];
  getSCPTemplate(templateId: string): SCPTemplate | undefined;
  
  // Cross-account operations
  assumeRole(options: AssumeRoleOptions): Promise<OrganizationOperationResult<AssumedRoleCredentials>>;
  switchAccount(accountId: string, roleName?: string): Promise<OrganizationOperationResult<CrossAccountSession>>;
  getCurrentContext(): AccountContext;
  resetContext(): void;
  getActiveSessions(): CrossAccountSession[];
  
  // Resource sharing (RAM)
  createResourceShare(options: CreateResourceShareOptions): Promise<OrganizationOperationResult<ResourceShareInfo>>;
  deleteResourceShare(resourceShareArn: string): Promise<OrganizationOperationResult<void>>;
  listResourceShares(options: ListResourceSharesOptions): Promise<OrganizationOperationResult<ResourceShareInfo[]>>;
  addResourceToShare(resourceShareArn: string, resourceArns: string[]): Promise<OrganizationOperationResult<void>>;
  removeResourceFromShare(resourceShareArn: string, resourceArns: string[]): Promise<OrganizationOperationResult<void>>;
  addPrincipalsToShare(resourceShareArn: string, principals: string[]): Promise<OrganizationOperationResult<void>>;
  removePrincipalsFromShare(resourceShareArn: string, principals: string[]): Promise<OrganizationOperationResult<void>>;
  listShareableResourceTypes(): Promise<OrganizationOperationResult<string[]>>;
  
  // Consolidated billing
  getConsolidatedBilling(options: GetConsolidatedBillingOptions): Promise<OrganizationOperationResult<ConsolidatedBillingSummary>>;
  
  // Delegated administrator
  listDelegatedAdministrators(servicePrincipal?: string): Promise<OrganizationOperationResult<DelegatedAdministratorInfo[]>>;
  getDelegatedServices(accountId: string): Promise<OrganizationOperationResult<DelegatedServiceInfo[]>>;
  registerDelegatedAdministrator(accountId: string, servicePrincipal: string): Promise<OrganizationOperationResult<void>>;
  deregisterDelegatedAdministrator(accountId: string, servicePrincipal: string): Promise<OrganizationOperationResult<void>>;
  
  // Handshakes
  listHandshakes(): Promise<OrganizationOperationResult<HandshakeInfo[]>>;
  inviteAccount(options: InviteAccountOptions): Promise<OrganizationOperationResult<HandshakeInfo>>;
  acceptHandshake(handshakeId: string): Promise<OrganizationOperationResult<HandshakeInfo>>;
  declineHandshake(handshakeId: string): Promise<OrganizationOperationResult<HandshakeInfo>>;
  cancelHandshake(handshakeId: string): Promise<OrganizationOperationResult<HandshakeInfo>>;
  
  // Cross-account resource discovery
  discoverCrossAccountResources(options: CrossAccountResourceOptions): Promise<OrganizationOperationResult<CrossAccountResource[]>>;
  getCrossAccountResourceSummary(options?: CrossAccountResourceOptions): Promise<OrganizationOperationResult<CrossAccountResourceSummary>>;
  
  // Tags
  getResourceTags(resourceId: string): Promise<OrganizationOperationResult<Record<string, string>>>;
  tagResource(resourceId: string, tags: Record<string, string>): Promise<OrganizationOperationResult<void>>;
  untagResource(resourceId: string, tagKeys: string[]): Promise<OrganizationOperationResult<void>>;
}

/**
 * Create Organization Manager instance
 */
export function createOrganizationManager(config: OrganizationManagerConfig = {}): OrganizationManager {
  const region = config.defaultRegion ?? 'us-east-1';
  
  // Initialize clients
  const organizationsClient = new OrganizationsClient({
    region: 'us-east-1', // Organizations API is global, always use us-east-1
    credentials: config.credentials,
  });
  
  const stsClient = new STSClient({
    region,
    credentials: config.credentials,
  });
  
  const ramClient = new RAMClient({
    region,
    credentials: config.credentials,
  });
  
  const costExplorerClient = new CostExplorerClient({
    region: 'us-east-1', // Cost Explorer is global
    credentials: config.credentials,
  });
  
  // State management
  let currentAccountId: string | undefined;
  let currentAccountName: string | undefined;
  let isManagementAccount = false;
  const activeSessions = new Map<string, CrossAccountSession>();
  const defaultRoleName = config.defaultCrossAccountRoleName ?? 'OrganizationAccountAccessRole';
  const defaultSessionDuration = config.defaultSessionDurationSeconds ?? 3600;
  
  // ==========================================================================
  // SCP Templates
  // ==========================================================================
  
  const scpTemplates: SCPTemplate[] = [
    // Security templates
    {
      id: 'deny-root-user',
      name: 'Deny Root User Actions',
      description: 'Prevents the root user from performing any actions',
      category: 'security',
      riskLevel: 'low',
      bestPractice: true,
      cisBenchmark: '1.7',
      document: {
        Version: '2012-10-17',
        Statement: [{
          Sid: 'DenyRootUser',
          Effect: 'Deny',
          Action: '*',
          Resource: '*',
          Condition: {
            StringLike: { 'aws:PrincipalArn': 'arn:aws:iam::*:root' }
          }
        }]
      }
    },
    {
      id: 'require-mfa',
      name: 'Require MFA for Sensitive Actions',
      description: 'Requires MFA for sensitive IAM and security actions',
      category: 'security',
      riskLevel: 'low',
      bestPractice: true,
      cisBenchmark: '1.10',
      document: {
        Version: '2012-10-17',
        Statement: [{
          Sid: 'RequireMFAForSensitiveActions',
          Effect: 'Deny',
          Action: [
            'iam:CreateUser',
            'iam:CreateRole',
            'iam:AttachUserPolicy',
            'iam:AttachRolePolicy',
            'iam:DeleteUser',
            'iam:DeleteRole'
          ],
          Resource: '*',
          Condition: {
            BoolIfExists: { 'aws:MultiFactorAuthPresent': 'false' }
          }
        }]
      }
    },
    {
      id: 'deny-leave-organization',
      name: 'Deny Leaving Organization',
      description: 'Prevents accounts from leaving the organization',
      category: 'security',
      riskLevel: 'low',
      bestPractice: true,
      document: {
        Version: '2012-10-17',
        Statement: [{
          Sid: 'DenyLeaveOrganization',
          Effect: 'Deny',
          Action: 'organizations:LeaveOrganization',
          Resource: '*'
        }]
      }
    },
    // Data protection templates
    {
      id: 'require-s3-encryption',
      name: 'Require S3 Encryption',
      description: 'Denies S3 PutObject without encryption',
      category: 'data-protection',
      riskLevel: 'low',
      bestPractice: true,
      document: {
        Version: '2012-10-17',
        Statement: [{
          Sid: 'RequireS3Encryption',
          Effect: 'Deny',
          Action: 's3:PutObject',
          Resource: '*',
          Condition: {
            Null: { 's3:x-amz-server-side-encryption': 'true' }
          }
        }]
      }
    },
    {
      id: 'deny-unencrypted-ebs',
      name: 'Deny Unencrypted EBS Volumes',
      description: 'Prevents creation of unencrypted EBS volumes',
      category: 'data-protection',
      riskLevel: 'low',
      bestPractice: true,
      document: {
        Version: '2012-10-17',
        Statement: [{
          Sid: 'DenyUnencryptedEBS',
          Effect: 'Deny',
          Action: 'ec2:CreateVolume',
          Resource: '*',
          Condition: {
            Bool: { 'ec2:Encrypted': 'false' }
          }
        }]
      }
    },
    // Networking templates
    {
      id: 'deny-public-s3',
      name: 'Deny Public S3 Buckets',
      description: 'Prevents making S3 buckets publicly accessible',
      category: 'networking',
      riskLevel: 'low',
      bestPractice: true,
      document: {
        Version: '2012-10-17',
        Statement: [{
          Sid: 'DenyPublicS3Access',
          Effect: 'Deny',
          Action: [
            's3:PutBucketPublicAccessBlock',
            's3:PutAccountPublicAccessBlock'
          ],
          Resource: '*',
          Condition: {
            StringNotEquals: {
              's3:x-amz-acl': ['private']
            }
          }
        }]
      }
    },
    {
      id: 'restrict-regions',
      name: 'Restrict to Approved Regions',
      description: 'Limits AWS usage to approved regions only',
      category: 'compliance',
      riskLevel: 'medium',
      bestPractice: true,
      document: {
        Version: '2012-10-17',
        Statement: [{
          Sid: 'DenyNonApprovedRegions',
          Effect: 'Deny',
          NotAction: [
            'iam:*',
            'organizations:*',
            'support:*',
            'budgets:*'
          ],
          Resource: '*',
          Condition: {
            StringNotEquals: {
              'aws:RequestedRegion': ['us-east-1', 'us-west-2', 'eu-west-1']
            }
          }
        }]
      }
    },
    // Logging templates
    {
      id: 'protect-cloudtrail',
      name: 'Protect CloudTrail Logs',
      description: 'Prevents modification or deletion of CloudTrail configurations',
      category: 'logging',
      riskLevel: 'low',
      bestPractice: true,
      cisBenchmark: '3.5',
      document: {
        Version: '2012-10-17',
        Statement: [{
          Sid: 'ProtectCloudTrail',
          Effect: 'Deny',
          Action: [
            'cloudtrail:DeleteTrail',
            'cloudtrail:StopLogging',
            'cloudtrail:UpdateTrail'
          ],
          Resource: '*'
        }]
      }
    },
    {
      id: 'protect-config',
      name: 'Protect AWS Config',
      description: 'Prevents modification or deletion of AWS Config',
      category: 'logging',
      riskLevel: 'low',
      bestPractice: true,
      document: {
        Version: '2012-10-17',
        Statement: [{
          Sid: 'ProtectConfig',
          Effect: 'Deny',
          Action: [
            'config:DeleteConfigurationRecorder',
            'config:DeleteDeliveryChannel',
            'config:StopConfigurationRecorder'
          ],
          Resource: '*'
        }]
      }
    },
    // Cost management templates
    {
      id: 'deny-expensive-instances',
      name: 'Deny Expensive EC2 Instance Types',
      description: 'Prevents launching expensive EC2 instance types',
      category: 'cost-management',
      riskLevel: 'medium',
      bestPractice: false,
      document: {
        Version: '2012-10-17',
        Statement: [{
          Sid: 'DenyExpensiveInstances',
          Effect: 'Deny',
          Action: 'ec2:RunInstances',
          Resource: 'arn:aws:ec2:*:*:instance/*',
          Condition: {
            StringLike: {
              'ec2:InstanceType': ['*.metal', '*.24xlarge', '*.16xlarge', '*.12xlarge']
            }
          }
        }]
      }
    },
    // Identity templates
    {
      id: 'deny-iam-user-creation',
      name: 'Deny IAM User Creation',
      description: 'Prevents creation of IAM users (enforces SSO usage)',
      category: 'identity',
      riskLevel: 'medium',
      bestPractice: true,
      document: {
        Version: '2012-10-17',
        Statement: [{
          Sid: 'DenyIAMUserCreation',
          Effect: 'Deny',
          Action: [
            'iam:CreateUser',
            'iam:CreateAccessKey'
          ],
          Resource: '*'
        }]
      }
    },
    {
      id: 'deny-iam-changes-except-roles',
      name: 'Deny IAM Changes Except Roles',
      description: 'Only allows IAM role management, denies user/group changes',
      category: 'identity',
      riskLevel: 'medium',
      bestPractice: false,
      document: {
        Version: '2012-10-17',
        Statement: [{
          Sid: 'DenyIAMUserGroupChanges',
          Effect: 'Deny',
          Action: [
            'iam:CreateUser',
            'iam:DeleteUser',
            'iam:CreateGroup',
            'iam:DeleteGroup',
            'iam:AddUserToGroup',
            'iam:RemoveUserFromGroup'
          ],
          Resource: '*'
        }]
      }
    }
  ];
  
  // ==========================================================================
  // Helper Functions
  // ==========================================================================
  
  function mapAccount(account: Account): AccountInfo {
    return {
      id: account.Id ?? '',
      arn: account.Arn ?? '',
      name: account.Name ?? '',
      email: account.Email ?? '',
      status: (account.Status ?? 'ACTIVE') as AccountInfo['status'],
      joinedMethod: (account.JoinedMethod ?? 'CREATED') as AccountInfo['joinedMethod'],
      joinedTimestamp: account.JoinedTimestamp ?? new Date(),
      tags: {},
    };
  }
  
  function mapOU(ou: OrganizationalUnit): OrganizationalUnitInfo {
    return {
      id: ou.Id ?? '',
      arn: ou.Arn ?? '',
      name: ou.Name ?? '',
      parentId: '',
    };
  }
  
  function mapRoot(root: Root): OrganizationRootInfo {
    return {
      id: root.Id ?? '',
      arn: root.Arn ?? '',
      name: root.Name ?? '',
      policyTypes: (root.PolicyTypes ?? []).map(pt => ({
        type: pt.Type as PolicyType,
        status: pt.Status as 'ENABLED' | 'PENDING_ENABLE' | 'PENDING_DISABLE',
      })),
    };
  }
  
  function mapPolicy(policy: Policy): SCPInfo {
    const content = policy.Content ?? '{}';
    let policyDocument: SCPDocument | undefined;
    try {
      policyDocument = JSON.parse(content) as SCPDocument;
    } catch {
      // Content might not be valid JSON
    }
    
    return {
      id: policy.PolicySummary?.Id ?? '',
      arn: policy.PolicySummary?.Arn ?? '',
      name: policy.PolicySummary?.Name ?? '',
      description: policy.PolicySummary?.Description,
      type: (policy.PolicySummary?.Type ?? 'SERVICE_CONTROL_POLICY') as PolicyType,
      awsManaged: policy.PolicySummary?.AwsManaged ?? false,
      content,
      policyDocument,
    };
  }
  
  function mapHandshake(handshake: Handshake): HandshakeInfo {
    return {
      id: handshake.Id ?? '',
      arn: handshake.Arn ?? '',
      parties: (handshake.Parties ?? []).map(p => ({
        id: p.Id ?? '',
        type: p.Type as 'ACCOUNT' | 'ORGANIZATION' | 'EMAIL',
      })),
      state: (handshake.State ?? 'REQUESTED') as HandshakeInfo['state'],
      requestedTimestamp: handshake.RequestedTimestamp ?? new Date(),
      expirationTimestamp: handshake.ExpirationTimestamp ?? new Date(),
      action: (handshake.Action ?? 'INVITE') as HandshakeInfo['action'],
      resources: handshake.Resources?.map(r => ({
        type: r.Type ?? '',
        value: r.Value ?? '',
      })),
    };
  }
  
  function mapResourceShare(share: ResourceShare): ResourceShareInfo {
    return {
      resourceShareArn: share.resourceShareArn ?? '',
      name: share.name ?? '',
      owningAccountId: share.owningAccountId ?? '',
      allowExternalPrincipals: share.allowExternalPrincipals ?? false,
      status: (share.status ?? 'PENDING') as ResourceShareInfo['status'],
      statusMessage: share.statusMessage,
      creationTime: share.creationTime ?? new Date(),
      lastUpdatedTime: share.lastUpdatedTime ?? new Date(),
      featureSet: share.featureSet as ResourceShareInfo['featureSet'],
      tags: share.tags?.reduce((acc, tag) => {
        if (tag.key && tag.value) acc[tag.key] = tag.value;
        return acc;
      }, {} as Record<string, string>),
    };
  }
  
  // ==========================================================================
  // Organization Operations
  // ==========================================================================
  
  async function getOrganization(): Promise<OrganizationOperationResult<OrganizationInfo>> {
    try {
      const response = await organizationsClient.send(new DescribeOrganizationCommand({}));
      const org = response.Organization;
      
      if (!org) {
        return { success: false, error: 'No organization found' };
      }
      
      const rootsResult = await getRoots();
      
      return {
        success: true,
        data: {
          id: org.Id ?? '',
          arn: org.Arn ?? '',
          masterAccountId: org.MasterAccountId ?? '',
          masterAccountEmail: org.MasterAccountEmail ?? '',
          masterAccountArn: org.MasterAccountArn ?? '',
          featureSet: (org.FeatureSet ?? 'ALL_FEATURES') as OrganizationInfo['featureSet'],
          availablePolicyTypes: (org.AvailablePolicyTypes ?? []).map(pt => ({
            type: pt.Type as PolicyType,
            status: pt.Status as 'ENABLED' | 'PENDING_ENABLE' | 'PENDING_DISABLE',
          })),
          roots: rootsResult.success ? rootsResult.data : undefined,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get organization',
      };
    }
  }
  
  async function getRoots(): Promise<OrganizationOperationResult<OrganizationRootInfo[]>> {
    try {
      const roots: OrganizationRootInfo[] = [];
      let nextToken: string | undefined;
      
      do {
        const response = await organizationsClient.send(new ListRootsCommand({
          NextToken: nextToken,
        }));
        
        for (const root of response.Roots ?? []) {
          roots.push(mapRoot(root));
        }
        
        nextToken = response.NextToken;
      } while (nextToken);
      
      return { success: true, data: roots };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list roots',
      };
    }
  }
  
  // ==========================================================================
  // Account Operations
  // ==========================================================================
  
  async function listAccounts(options: ListAccountsOptions = {}): Promise<OrganizationOperationResult<AccountInfo[]>> {
    try {
      const accounts: AccountInfo[] = [];
      let nextToken: string | undefined = options.nextToken;
      
      if (options.organizationalUnitId) {
        // List accounts for specific OU
        do {
          const response = await organizationsClient.send(new ListAccountsForParentCommand({
            ParentId: options.organizationalUnitId,
            NextToken: nextToken,
            MaxResults: options.maxResults,
          }));
          
          for (const account of response.Accounts ?? []) {
            const mapped = mapAccount(account);
            mapped.organizationalUnitId = options.organizationalUnitId;
            if (!options.status || mapped.status === options.status) {
              accounts.push(mapped);
            }
          }
          
          nextToken = response.NextToken;
        } while (nextToken && (!options.maxResults || accounts.length < options.maxResults));
      } else {
        // List all accounts
        do {
          const response = await organizationsClient.send(new ListAccountsCommand({
            NextToken: nextToken,
            MaxResults: options.maxResults,
          }));
          
          for (const account of response.Accounts ?? []) {
            const mapped = mapAccount(account);
            if (!options.status || mapped.status === options.status) {
              accounts.push(mapped);
            }
          }
          
          nextToken = response.NextToken;
        } while (nextToken && (!options.maxResults || accounts.length < options.maxResults));
      }
      
      // Fetch tags if requested
      if (options.includeTags) {
        for (const account of accounts) {
          try {
            const tagsResult = await getResourceTags(account.id);
            if (tagsResult.success && tagsResult.data) {
              account.tags = tagsResult.data;
            }
          } catch {
            // Continue without tags if fetch fails
          }
        }
      }
      
      // Fetch cost data if requested
      if (options.includeCostData) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const billingResult = await getConsolidatedBilling({
          startDate: startOfMonth,
          endDate: now,
          accountIds: accounts.map(a => a.id),
        });
        
        if (billingResult.success && billingResult.data) {
          for (const account of accounts) {
            const costData = billingResult.data.accountBreakdown.find(
              b => b.accountId === account.id
            );
            if (costData) {
              (account as DetailedAccountInfo).costData = {
                currentMonth: costData.cost,
                previousMonth: 0, // Would need another query
                currency: costData.currency,
              };
            }
          }
        }
      }
      
      return { success: true, data: accounts };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list accounts',
      };
    }
  }
  
  async function getAccount(accountId: string): Promise<OrganizationOperationResult<DetailedAccountInfo>> {
    try {
      const response = await organizationsClient.send(new DescribeAccountCommand({
        AccountId: accountId,
      }));
      
      if (!response.Account) {
        return { success: false, error: 'Account not found' };
      }
      
      const account = mapAccount(response.Account) as DetailedAccountInfo;
      
      // Get parent OU
      try {
        const parentsResponse = await organizationsClient.send(new ListParentsCommand({
          ChildId: accountId,
        }));
        if (parentsResponse.Parents && parentsResponse.Parents.length > 0) {
          const parent = parentsResponse.Parents[0];
          account.parentId = parent.Id;
          account.organizationalUnitId = parent.Type === 'ORGANIZATIONAL_UNIT' ? parent.Id : undefined;
        }
      } catch {
        // Continue without parent info
      }
      
      // Get tags
      try {
        const tagsResult = await getResourceTags(accountId);
        if (tagsResult.success && tagsResult.data) {
          account.tags = tagsResult.data;
        }
      } catch {
        // Continue without tags
      }
      
      // Check if management account
      const orgResult = await getOrganization();
      if (orgResult.success && orgResult.data) {
        account.isManagementAccount = orgResult.data.masterAccountId === accountId;
      }
      
      // Check delegated services
      try {
        const delegatedResult = await getDelegatedServices(accountId);
        if (delegatedResult.success && delegatedResult.data) {
          account.isDelegatedAdmin = delegatedResult.data.length > 0;
          account.delegatedServices = delegatedResult.data.map(s => s.servicePrincipal);
        }
      } catch {
        // Continue without delegated info
      }
      
      return { success: true, data: account };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get account',
      };
    }
  }
  
  async function createAccount(options: CreateAccountOptions): Promise<OrganizationOperationResult<CreateAccountStatus>> {
    try {
      const response = await organizationsClient.send(new CreateAccountCommand({
        AccountName: options.accountName,
        Email: options.email,
        IamUserAccessToBilling: options.iamUserAccessToBilling ?? 'ALLOW',
        RoleName: options.roleName ?? defaultRoleName,
        Tags: options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
      }));
      
      const status = response.CreateAccountStatus;
      if (!status) {
        return { success: false, error: 'No status returned' };
      }
      
      const result: CreateAccountStatus = {
        id: status.Id ?? '',
        accountId: status.AccountId,
        accountName: status.AccountName ?? options.accountName,
        state: (status.State ?? 'IN_PROGRESS') as CreateAccountStatus['state'],
        failureReason: status.FailureReason,
        requestedTimestamp: status.RequestedTimestamp ?? new Date(),
        completedTimestamp: status.CompletedTimestamp,
      };
      
      // Move to destination OU if specified and account creation succeeded
      if (options.destinationParentId && result.state === 'SUCCEEDED' && result.accountId) {
        const rootsResult = await getRoots();
        if (rootsResult.success && rootsResult.data && rootsResult.data.length > 0) {
          await moveAccount({
            accountId: result.accountId,
            sourceParentId: rootsResult.data[0].id,
            destinationParentId: options.destinationParentId,
          });
        }
      }
      
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create account',
      };
    }
  }
  
  async function getCreateAccountStatus(requestId: string): Promise<OrganizationOperationResult<CreateAccountStatus>> {
    try {
      const response = await organizationsClient.send(new DescribeCreateAccountStatusCommand({
        CreateAccountRequestId: requestId,
      }));
      
      const status = response.CreateAccountStatus;
      if (!status) {
        return { success: false, error: 'Status not found' };
      }
      
      return {
        success: true,
        data: {
          id: status.Id ?? '',
          accountId: status.AccountId,
          accountName: status.AccountName ?? '',
          state: (status.State ?? 'IN_PROGRESS') as CreateAccountStatus['state'],
          failureReason: status.FailureReason,
          requestedTimestamp: status.RequestedTimestamp ?? new Date(),
          completedTimestamp: status.CompletedTimestamp,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get account creation status',
      };
    }
  }
  
  async function moveAccount(options: MoveAccountOptions): Promise<OrganizationOperationResult<void>> {
    try {
      await organizationsClient.send(new MoveAccountCommand({
        AccountId: options.accountId,
        SourceParentId: options.sourceParentId,
        DestinationParentId: options.destinationParentId,
      }));
      
      return { success: true, message: `Account ${options.accountId} moved successfully` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to move account',
      };
    }
  }
  
  async function removeAccount(accountId: string): Promise<OrganizationOperationResult<void>> {
    try {
      await organizationsClient.send(new RemoveAccountFromOrganizationCommand({
        AccountId: accountId,
      }));
      
      return { success: true, message: `Account ${accountId} removed from organization` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove account',
      };
    }
  }
  
  // ==========================================================================
  // Organizational Unit Operations
  // ==========================================================================
  
  async function listOrganizationalUnits(options: ListOUsOptions = {}): Promise<OrganizationOperationResult<OrganizationalUnitInfo[]>> {
    try {
      const ous: OrganizationalUnitInfo[] = [];
      
      // If no parent specified, start from roots
      let parentIds: string[] = [];
      if (options.parentId) {
        parentIds = [options.parentId];
      } else {
        const rootsResult = await getRoots();
        if (rootsResult.success && rootsResult.data) {
          parentIds = rootsResult.data.map(r => r.id);
        }
      }
      
      async function fetchOUsForParent(parentId: string, depth: number = 0): Promise<void> {
        let nextToken: string | undefined;
        
        do {
          const response = await organizationsClient.send(new ListOrganizationalUnitsForParentCommand({
            ParentId: parentId,
            NextToken: nextToken,
            MaxResults: options.maxResults,
          }));
          
          for (const ou of response.OrganizationalUnits ?? []) {
            const mapped = mapOU(ou);
            mapped.parentId = parentId;
            
            // Fetch accounts if requested
            if (options.includeAccounts) {
              const accountsResult = await listAccounts({ organizationalUnitId: mapped.id });
              if (accountsResult.success) {
                mapped.accounts = accountsResult.data;
              }
            }
            
            // Fetch attached policies if requested
            if (options.includeAttachedPolicies) {
              const policiesResult = await listPoliciesForTarget(mapped.id);
              if (policiesResult.success) {
                mapped.attachedPolicies = policiesResult.data;
              }
            }
            
            ous.push(mapped);
            
            // Recursively fetch child OUs
            if (options.recursive) {
              await fetchOUsForParent(mapped.id, depth + 1);
            }
          }
          
          nextToken = response.NextToken;
        } while (nextToken);
      }
      
      for (const parentId of parentIds) {
        await fetchOUsForParent(parentId);
      }
      
      return { success: true, data: ous };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list organizational units',
      };
    }
  }
  
  async function getOrganizationalUnit(ouId: string): Promise<OrganizationOperationResult<OrganizationalUnitInfo>> {
    try {
      const response = await organizationsClient.send(new DescribeOrganizationalUnitCommand({
        OrganizationalUnitId: ouId,
      }));
      
      if (!response.OrganizationalUnit) {
        return { success: false, error: 'Organizational unit not found' };
      }
      
      const ou = mapOU(response.OrganizationalUnit);
      
      // Get parent
      try {
        const parentsResponse = await organizationsClient.send(new ListParentsCommand({
          ChildId: ouId,
        }));
        if (parentsResponse.Parents && parentsResponse.Parents.length > 0) {
          ou.parentId = parentsResponse.Parents[0].Id ?? '';
        }
      } catch {
        // Continue without parent
      }
      
      // Get accounts
      const accountsResult = await listAccounts({ organizationalUnitId: ouId });
      if (accountsResult.success) {
        ou.accounts = accountsResult.data;
      }
      
      // Get attached policies
      const policiesResult = await listPoliciesForTarget(ouId);
      if (policiesResult.success) {
        ou.attachedPolicies = policiesResult.data;
      }
      
      // Get child OUs
      const childOUsResult = await listOrganizationalUnits({ parentId: ouId });
      if (childOUsResult.success) {
        ou.childOUs = childOUsResult.data;
      }
      
      return { success: true, data: ou };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get organizational unit',
      };
    }
  }
  
  async function createOrganizationalUnit(options: CreateOUOptions): Promise<OrganizationOperationResult<OrganizationalUnitInfo>> {
    try {
      const response = await organizationsClient.send(new CreateOrganizationalUnitCommand({
        ParentId: options.parentId,
        Name: options.name,
        Tags: options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
      }));
      
      if (!response.OrganizationalUnit) {
        return { success: false, error: 'Failed to create organizational unit' };
      }
      
      const ou = mapOU(response.OrganizationalUnit);
      ou.parentId = options.parentId;
      
      return { success: true, data: ou };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create organizational unit',
      };
    }
  }
  
  async function updateOrganizationalUnit(ouId: string, name: string): Promise<OrganizationOperationResult<OrganizationalUnitInfo>> {
    try {
      const response = await organizationsClient.send(new UpdateOrganizationalUnitCommand({
        OrganizationalUnitId: ouId,
        Name: name,
      }));
      
      if (!response.OrganizationalUnit) {
        return { success: false, error: 'Failed to update organizational unit' };
      }
      
      return { success: true, data: mapOU(response.OrganizationalUnit) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update organizational unit',
      };
    }
  }
  
  async function deleteOrganizationalUnit(ouId: string): Promise<OrganizationOperationResult<void>> {
    try {
      await organizationsClient.send(new DeleteOrganizationalUnitCommand({
        OrganizationalUnitId: ouId,
      }));
      
      return { success: true, message: `Organizational unit ${ouId} deleted` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete organizational unit',
      };
    }
  }
  
  // ==========================================================================
  // SCP Operations
  // ==========================================================================
  
  async function listPolicies(options: ListPoliciesOptions = {}): Promise<OrganizationOperationResult<SCPInfo[]>> {
    try {
      const policies: SCPInfo[] = [];
      let nextToken: string | undefined = options.nextToken;
      
      do {
        const response = await organizationsClient.send(new ListPoliciesCommand({
          Filter: options.type ?? 'SERVICE_CONTROL_POLICY',
          NextToken: nextToken,
          MaxResults: options.maxResults,
        }));
        
        for (const summary of response.Policies ?? []) {
          if (options.includeContent) {
            const policyResult = await getPolicy(summary.Id ?? '');
            if (policyResult.success && policyResult.data) {
              policies.push(policyResult.data);
            }
          } else {
            policies.push({
              id: summary.Id ?? '',
              arn: summary.Arn ?? '',
              name: summary.Name ?? '',
              description: summary.Description,
              type: (summary.Type ?? 'SERVICE_CONTROL_POLICY') as PolicyType,
              awsManaged: summary.AwsManaged ?? false,
              content: '',
            });
          }
        }
        
        nextToken = response.NextToken;
      } while (nextToken && (!options.maxResults || policies.length < options.maxResults));
      
      return { success: true, data: policies };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list policies',
      };
    }
  }
  
  async function getPolicy(policyId: string): Promise<OrganizationOperationResult<SCPInfo>> {
    try {
      const response = await organizationsClient.send(new DescribePolicyCommand({
        PolicyId: policyId,
      }));
      
      if (!response.Policy) {
        return { success: false, error: 'Policy not found' };
      }
      
      const policy = mapPolicy(response.Policy);
      
      // Get targets
      const targetsResult = await getPolicyTargets(policyId);
      if (targetsResult.success) {
        policy.targets = targetsResult.data;
      }
      
      return { success: true, data: policy };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get policy',
      };
    }
  }
  
  async function createPolicy(options: CreateSCPOptions): Promise<OrganizationOperationResult<SCPInfo>> {
    try {
      const content = typeof options.content === 'string' 
        ? options.content 
        : JSON.stringify(options.content);
      
      const response = await organizationsClient.send(new CreatePolicyCommand({
        Name: options.name,
        Description: options.description,
        Content: content,
        Type: options.type ?? 'SERVICE_CONTROL_POLICY',
        Tags: options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
      }));
      
      if (!response.Policy) {
        return { success: false, error: 'Failed to create policy' };
      }
      
      return { success: true, data: mapPolicy(response.Policy) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create policy',
      };
    }
  }
  
  async function updatePolicy(options: UpdateSCPOptions): Promise<OrganizationOperationResult<SCPInfo>> {
    try {
      const content = options.content 
        ? (typeof options.content === 'string' ? options.content : JSON.stringify(options.content))
        : undefined;
      
      const response = await organizationsClient.send(new UpdatePolicyCommand({
        PolicyId: options.policyId,
        Name: options.name,
        Description: options.description,
        Content: content,
      }));
      
      if (!response.Policy) {
        return { success: false, error: 'Failed to update policy' };
      }
      
      return { success: true, data: mapPolicy(response.Policy) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update policy',
      };
    }
  }
  
  async function deletePolicy(policyId: string): Promise<OrganizationOperationResult<void>> {
    try {
      await organizationsClient.send(new DeletePolicyCommand({
        PolicyId: policyId,
      }));
      
      return { success: true, message: `Policy ${policyId} deleted` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete policy',
      };
    }
  }
  
  async function attachPolicy(policyId: string, targetId: string): Promise<OrganizationOperationResult<void>> {
    try {
      await organizationsClient.send(new AttachPolicyCommand({
        PolicyId: policyId,
        TargetId: targetId,
      }));
      
      return { success: true, message: `Policy ${policyId} attached to ${targetId}` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to attach policy',
      };
    }
  }
  
  async function detachPolicy(policyId: string, targetId: string): Promise<OrganizationOperationResult<void>> {
    try {
      await organizationsClient.send(new DetachPolicyCommand({
        PolicyId: policyId,
        TargetId: targetId,
      }));
      
      return { success: true, message: `Policy ${policyId} detached from ${targetId}` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to detach policy',
      };
    }
  }
  
  async function listPoliciesForTarget(targetId: string, policyType?: PolicyType): Promise<OrganizationOperationResult<PolicyAttachment[]>> {
    try {
      const attachments: PolicyAttachment[] = [];
      let nextToken: string | undefined;
      
      do {
        const response = await organizationsClient.send(new ListPoliciesForTargetCommand({
          TargetId: targetId,
          Filter: policyType ?? 'SERVICE_CONTROL_POLICY',
          NextToken: nextToken,
        }));
        
        for (const policy of response.Policies ?? []) {
          attachments.push({
            policyId: policy.Id ?? '',
            policyName: policy.Name ?? '',
            policyType: (policy.Type ?? 'SERVICE_CONTROL_POLICY') as PolicyType,
            awsManaged: policy.AwsManaged ?? false,
          });
        }
        
        nextToken = response.NextToken;
      } while (nextToken);
      
      return { success: true, data: attachments };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list policies for target',
      };
    }
  }
  
  async function getPolicyTargets(policyId: string): Promise<OrganizationOperationResult<PolicyTargetInfo[]>> {
    try {
      const targets: PolicyTargetInfo[] = [];
      let nextToken: string | undefined;
      
      do {
        const response = await organizationsClient.send(new ListTargetsForPolicyCommand({
          PolicyId: policyId,
          NextToken: nextToken,
        }));
        
        for (const target of response.Targets ?? []) {
          targets.push({
            targetId: target.TargetId ?? '',
            arn: target.Arn ?? '',
            name: target.Name ?? '',
            type: (target.Type ?? 'ACCOUNT') as PolicyTargetInfo['type'],
          });
        }
        
        nextToken = response.NextToken;
      } while (nextToken);
      
      return { success: true, data: targets };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get policy targets',
      };
    }
  }
  
  async function enablePolicyType(rootId: string, policyType: PolicyType): Promise<OrganizationOperationResult<void>> {
    try {
      await organizationsClient.send(new EnablePolicyTypeCommand({
        RootId: rootId,
        PolicyType: policyType,
      }));
      
      return { success: true, message: `Policy type ${policyType} enabled for root ${rootId}` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to enable policy type',
      };
    }
  }
  
  async function disablePolicyType(rootId: string, policyType: PolicyType): Promise<OrganizationOperationResult<void>> {
    try {
      await organizationsClient.send(new DisablePolicyTypeCommand({
        RootId: rootId,
        PolicyType: policyType,
      }));
      
      return { success: true, message: `Policy type ${policyType} disabled for root ${rootId}` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disable policy type',
      };
    }
  }
  
  function getSCPTemplates(category?: SCPCategory): SCPTemplate[] {
    if (category) {
      return scpTemplates.filter(t => t.category === category);
    }
    return [...scpTemplates];
  }
  
  function getSCPTemplate(templateId: string): SCPTemplate | undefined {
    return scpTemplates.find(t => t.id === templateId);
  }
  
  // ==========================================================================
  // Cross-Account Operations
  // ==========================================================================
  
  async function assumeRole(options: AssumeRoleOptions): Promise<OrganizationOperationResult<AssumedRoleCredentials>> {
    try {
      const roleArn = options.roleArn ?? `arn:aws:iam::${options.accountId}:role/${options.roleName ?? defaultRoleName}`;
      const sessionName = options.sessionName ?? `espada-session-${Date.now()}`;
      
      const response = await stsClient.send(new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: sessionName,
        DurationSeconds: options.durationSeconds ?? defaultSessionDuration,
        ExternalId: options.externalId,
        Policy: options.inlinePolicy,
        Tags: options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
        SerialNumber: options.mfaSerialNumber,
        TokenCode: options.mfaTokenCode,
      }));
      
      const creds = response.Credentials;
      if (!creds) {
        return { success: false, error: 'No credentials returned' };
      }
      
      return {
        success: true,
        data: {
          accessKeyId: creds.AccessKeyId ?? '',
          secretAccessKey: creds.SecretAccessKey ?? '',
          sessionToken: creds.SessionToken ?? '',
          expiration: creds.Expiration ?? new Date(),
          assumedRoleArn: response.AssumedRoleUser?.Arn ?? roleArn,
          accountId: options.accountId,
          sessionName,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to assume role',
      };
    }
  }
  
  async function switchAccount(accountId: string, roleName?: string): Promise<OrganizationOperationResult<CrossAccountSession>> {
    try {
      // Get account info first
      const accountResult = await getAccount(accountId);
      const accountName = accountResult.success ? accountResult.data?.name : undefined;
      
      // Assume role
      const credsResult = await assumeRole({
        accountId,
        roleName: roleName ?? defaultRoleName,
      });
      
      if (!credsResult.success || !credsResult.data) {
        return { success: false, error: credsResult.error ?? 'Failed to assume role' };
      }
      
      const session: CrossAccountSession = {
        sessionId: `session-${accountId}-${Date.now()}`,
        accountId,
        accountName,
        roleArn: credsResult.data.assumedRoleArn,
        sessionName: credsResult.data.sessionName,
        credentials: credsResult.data,
        startTime: new Date(),
        expirationTime: credsResult.data.expiration,
        isActive: true,
      };
      
      // Store session
      activeSessions.set(session.sessionId, session);
      
      // Update current context
      currentAccountId = accountId;
      currentAccountName = accountName;
      
      return { success: true, data: session };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to switch account',
      };
    }
  }
  
  function getCurrentContext(): AccountContext {
    return {
      accountId: currentAccountId ?? '',
      accountName: currentAccountName,
      isManagementAccount,
      availableRegions: [
        'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
        'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
        'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
        'ap-southeast-1', 'ap-southeast-2', 'ap-south-1',
        'sa-east-1', 'ca-central-1',
      ],
      currentRegion: region,
    };
  }
  
  function resetContext(): void {
    currentAccountId = undefined;
    currentAccountName = undefined;
    isManagementAccount = false;
    activeSessions.clear();
  }
  
  function getActiveSessions(): CrossAccountSession[] {
    const now = new Date();
    const sessions: CrossAccountSession[] = [];
    
    for (const [sessionId, session] of activeSessions) {
      if (session.expirationTime > now) {
        sessions.push({ ...session, isActive: true });
      } else {
        session.isActive = false;
        sessions.push(session);
      }
    }
    
    return sessions;
  }
  
  // ==========================================================================
  // Resource Sharing (RAM) Operations
  // ==========================================================================
  
  async function createResourceShare(options: CreateResourceShareOptions): Promise<OrganizationOperationResult<ResourceShareInfo>> {
    try {
      const response = await ramClient.send(new CreateResourceShareCommand({
        name: options.name,
        resourceArns: options.resourceArns,
        principals: options.principals,
        allowExternalPrincipals: options.allowExternalPrincipals ?? false,
        tags: options.tags ? Object.entries(options.tags).map(([key, value]) => ({ key, value })) : undefined,
        permissionArns: options.permissionArns,
      }));
      
      if (!response.resourceShare) {
        return { success: false, error: 'Failed to create resource share' };
      }
      
      return { success: true, data: mapResourceShare(response.resourceShare) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create resource share',
      };
    }
  }
  
  async function deleteResourceShare(resourceShareArn: string): Promise<OrganizationOperationResult<void>> {
    try {
      await ramClient.send(new DeleteResourceShareCommand({
        resourceShareArn,
      }));
      
      return { success: true, message: 'Resource share deleted' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete resource share',
      };
    }
  }
  
  async function listResourceShares(options: ListResourceSharesOptions): Promise<OrganizationOperationResult<ResourceShareInfo[]>> {
    try {
      const shares: ResourceShareInfo[] = [];
      let nextToken: string | undefined = options.nextToken;
      
      do {
        const response = await ramClient.send(new GetResourceSharesCommand({
          resourceOwner: options.resourceOwner,
          name: options.name,
          resourceShareStatus: options.status,
          nextToken,
          maxResults: options.maxResults,
        }));
        
        for (const share of response.resourceShares ?? []) {
          shares.push(mapResourceShare(share));
        }
        
        nextToken = response.nextToken;
      } while (nextToken && (!options.maxResults || shares.length < options.maxResults));
      
      return { success: true, data: shares };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list resource shares',
      };
    }
  }
  
  async function addResourceToShare(resourceShareArn: string, resourceArns: string[]): Promise<OrganizationOperationResult<void>> {
    try {
      await ramClient.send(new AssociateResourceShareCommand({
        resourceShareArn,
        resourceArns,
      }));
      
      return { success: true, message: 'Resources added to share' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add resources to share',
      };
    }
  }
  
  async function removeResourceFromShare(resourceShareArn: string, resourceArns: string[]): Promise<OrganizationOperationResult<void>> {
    try {
      await ramClient.send(new DisassociateResourceShareCommand({
        resourceShareArn,
        resourceArns,
      }));
      
      return { success: true, message: 'Resources removed from share' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove resources from share',
      };
    }
  }
  
  async function addPrincipalsToShare(resourceShareArn: string, principals: string[]): Promise<OrganizationOperationResult<void>> {
    try {
      await ramClient.send(new AssociateResourceShareCommand({
        resourceShareArn,
        principals,
      }));
      
      return { success: true, message: 'Principals added to share' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add principals to share',
      };
    }
  }
  
  async function removePrincipalsFromShare(resourceShareArn: string, principals: string[]): Promise<OrganizationOperationResult<void>> {
    try {
      await ramClient.send(new DisassociateResourceShareCommand({
        resourceShareArn,
        principals,
      }));
      
      return { success: true, message: 'Principals removed from share' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove principals from share',
      };
    }
  }
  
  async function listShareableResourceTypes(): Promise<OrganizationOperationResult<string[]>> {
    try {
      const types: string[] = [];
      let nextToken: string | undefined;
      
      do {
        const response = await ramClient.send(new ListResourceTypesCommand({
          nextToken,
        }));
        
        for (const resourceType of response.resourceTypes ?? []) {
          if (resourceType.resourceType) {
            types.push(resourceType.resourceType);
          }
        }
        
        nextToken = response.nextToken;
      } while (nextToken);
      
      return { success: true, data: types };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list shareable resource types',
      };
    }
  }
  
  // ==========================================================================
  // Consolidated Billing Operations
  // ==========================================================================
  
  async function getConsolidatedBilling(options: GetConsolidatedBillingOptions): Promise<OrganizationOperationResult<ConsolidatedBillingSummary>> {
    try {
      const groupBy = options.groupBy ?? ['ACCOUNT', 'SERVICE'];
      const granularity = options.granularity ?? 'MONTHLY';
      
      const response = await costExplorerClient.send(new GetCostAndUsageCommand({
        TimePeriod: {
          Start: options.startDate.toISOString().split('T')[0],
          End: options.endDate.toISOString().split('T')[0],
        },
        Granularity: granularity,
        Metrics: ['UnblendedCost', 'BlendedCost'],
        GroupBy: groupBy.map(dim => ({
          Type: 'DIMENSION',
          Key: dim === 'ACCOUNT' ? 'LINKED_ACCOUNT' : dim,
        })),
        Filter: options.accountIds || options.services ? {
          And: [
            ...(options.accountIds ? [{
              Dimensions: {
                Key: Dimension.LINKED_ACCOUNT,
                Values: options.accountIds,
              },
            }] : []),
            ...(options.services ? [{
              Dimensions: {
                Key: Dimension.SERVICE,
                Values: options.services,
              },
            }] : []),
          ],
        } : undefined,
      }));
      
      // Process results
      const accountCosts = new Map<string, { cost: number; services: Map<string, number> }>();
      const serviceCosts = new Map<string, { cost: number; accounts: Set<string> }>();
      let totalCost = 0;
      
      for (const result of response.ResultsByTime ?? []) {
        for (const group of result.Groups ?? []) {
          const keys = group.Keys ?? [];
          const cost = parseFloat(group.Metrics?.UnblendedCost?.Amount ?? '0');
          totalCost += cost;
          
          // Find account and service keys
          let accountId: string | undefined;
          let service: string | undefined;
          
          for (const key of keys) {
            if (key.match(/^\d{12}$/)) {
              accountId = key;
            } else {
              service = key;
            }
          }
          
          if (accountId) {
            const existing = accountCosts.get(accountId) ?? { cost: 0, services: new Map() };
            existing.cost += cost;
            if (service) {
              existing.services.set(service, (existing.services.get(service) ?? 0) + cost);
            }
            accountCosts.set(accountId, existing);
          }
          
          if (service) {
            const existing = serviceCosts.get(service) ?? { cost: 0, accounts: new Set() };
            existing.cost += cost;
            if (accountId) {
              existing.accounts.add(accountId);
            }
            serviceCosts.set(service, existing);
          }
        }
      }
      
      // Get account names
      const accountsResult = await listAccounts();
      const accountNameMap = new Map<string, string>();
      if (accountsResult.success && accountsResult.data) {
        for (const account of accountsResult.data) {
          accountNameMap.set(account.id, account.name);
        }
      }
      
      // Build account breakdown
      const accountBreakdown: AccountCostBreakdown[] = [];
      for (const [accountId, data] of accountCosts) {
        const topServices = Array.from(data.services.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([service, cost]) => ({ service, cost }));
        
        accountBreakdown.push({
          accountId,
          accountName: accountNameMap.get(accountId) ?? accountId,
          cost: data.cost,
          percentage: totalCost > 0 ? (data.cost / totalCost) * 100 : 0,
          currency: 'USD',
          topServices,
        });
      }
      
      // Build service breakdown
      const serviceBreakdown: ServiceCostBreakdown[] = [];
      for (const [service, data] of serviceCosts) {
        serviceBreakdown.push({
          service,
          totalCost: data.cost,
          currency: 'USD',
          accountCosts: Array.from(data.accounts).map(accountId => ({
            accountId,
            accountName: accountNameMap.get(accountId) ?? accountId,
            cost: accountCosts.get(accountId)?.services.get(service) ?? 0,
          })),
        });
      }
      
      // Sort by cost
      accountBreakdown.sort((a, b) => b.cost - a.cost);
      serviceBreakdown.sort((a, b) => b.totalCost - a.totalCost);
      
      return {
        success: true,
        data: {
          periodStart: options.startDate,
          periodEnd: options.endDate,
          totalCost,
          currency: 'USD',
          accountBreakdown,
          serviceBreakdown,
          linkedAccountCount: accountCosts.size,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get consolidated billing',
      };
    }
  }
  
  // ==========================================================================
  // Delegated Administrator Operations
  // ==========================================================================
  
  async function listDelegatedAdministrators(servicePrincipal?: string): Promise<OrganizationOperationResult<DelegatedAdministratorInfo[]>> {
    try {
      const admins: DelegatedAdministratorInfo[] = [];
      let nextToken: string | undefined;
      
      do {
        const response = await organizationsClient.send(new ListDelegatedAdministratorsCommand({
          ServicePrincipal: servicePrincipal,
          NextToken: nextToken,
        }));
        
        for (const admin of response.DelegatedAdministrators ?? []) {
          admins.push({
            accountId: admin.Id ?? '',
            arn: admin.Arn ?? '',
            name: admin.Name ?? '',
            email: admin.Email ?? '',
            status: (admin.Status ?? 'ACTIVE') as AccountInfo['status'],
            delegationEnabledDate: admin.DelegationEnabledDate ?? new Date(),
            servicePrincipal: servicePrincipal ?? '',
          });
        }
        
        nextToken = response.NextToken;
      } while (nextToken);
      
      return { success: true, data: admins };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list delegated administrators',
      };
    }
  }
  
  async function getDelegatedServices(accountId: string): Promise<OrganizationOperationResult<DelegatedServiceInfo[]>> {
    try {
      const services: DelegatedServiceInfo[] = [];
      let nextToken: string | undefined;
      
      do {
        const response = await organizationsClient.send(new ListDelegatedServicesForAccountCommand({
          AccountId: accountId,
          NextToken: nextToken,
        }));
        
        for (const service of response.DelegatedServices ?? []) {
          services.push({
            servicePrincipal: service.ServicePrincipal ?? '',
            delegationEnabledDate: service.DelegationEnabledDate ?? new Date(),
          });
        }
        
        nextToken = response.NextToken;
      } while (nextToken);
      
      return { success: true, data: services };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get delegated services',
      };
    }
  }
  
  async function registerDelegatedAdministrator(accountId: string, servicePrincipal: string): Promise<OrganizationOperationResult<void>> {
    try {
      await organizationsClient.send(new RegisterDelegatedAdministratorCommand({
        AccountId: accountId,
        ServicePrincipal: servicePrincipal,
      }));
      
      return { success: true, message: `Account ${accountId} registered as delegated administrator for ${servicePrincipal}` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to register delegated administrator',
      };
    }
  }
  
  async function deregisterDelegatedAdministrator(accountId: string, servicePrincipal: string): Promise<OrganizationOperationResult<void>> {
    try {
      await organizationsClient.send(new DeregisterDelegatedAdministratorCommand({
        AccountId: accountId,
        ServicePrincipal: servicePrincipal,
      }));
      
      return { success: true, message: `Account ${accountId} deregistered as delegated administrator for ${servicePrincipal}` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to deregister delegated administrator',
      };
    }
  }
  
  // ==========================================================================
  // Handshake Operations
  // ==========================================================================
  
  async function listHandshakes(): Promise<OrganizationOperationResult<HandshakeInfo[]>> {
    try {
      const handshakes: HandshakeInfo[] = [];
      let nextToken: string | undefined;
      
      do {
        const response = await organizationsClient.send(new ListHandshakesForOrganizationCommand({
          NextToken: nextToken,
        }));
        
        for (const handshake of response.Handshakes ?? []) {
          handshakes.push(mapHandshake(handshake));
        }
        
        nextToken = response.NextToken;
      } while (nextToken);
      
      return { success: true, data: handshakes };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list handshakes',
      };
    }
  }
  
  async function inviteAccount(options: InviteAccountOptions): Promise<OrganizationOperationResult<HandshakeInfo>> {
    try {
      const response = await organizationsClient.send(new InviteAccountToOrganizationCommand({
        Target: {
          Id: options.target,
          Type: options.targetType,
        },
        Notes: options.notes,
        Tags: options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
      }));
      
      if (!response.Handshake) {
        return { success: false, error: 'Failed to create invitation' };
      }
      
      return { success: true, data: mapHandshake(response.Handshake) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to invite account',
      };
    }
  }
  
  async function acceptHandshake(handshakeId: string): Promise<OrganizationOperationResult<HandshakeInfo>> {
    try {
      const response = await organizationsClient.send(new AcceptHandshakeCommand({
        HandshakeId: handshakeId,
      }));
      
      if (!response.Handshake) {
        return { success: false, error: 'Failed to accept handshake' };
      }
      
      return { success: true, data: mapHandshake(response.Handshake) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to accept handshake',
      };
    }
  }
  
  async function declineHandshake(handshakeId: string): Promise<OrganizationOperationResult<HandshakeInfo>> {
    try {
      const response = await organizationsClient.send(new DeclineHandshakeCommand({
        HandshakeId: handshakeId,
      }));
      
      if (!response.Handshake) {
        return { success: false, error: 'Failed to decline handshake' };
      }
      
      return { success: true, data: mapHandshake(response.Handshake) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to decline handshake',
      };
    }
  }
  
  async function cancelHandshake(handshakeId: string): Promise<OrganizationOperationResult<HandshakeInfo>> {
    try {
      const response = await organizationsClient.send(new CancelHandshakeCommand({
        HandshakeId: handshakeId,
      }));
      
      if (!response.Handshake) {
        return { success: false, error: 'Failed to cancel handshake' };
      }
      
      return { success: true, data: mapHandshake(response.Handshake) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel handshake',
      };
    }
  }
  
  // ==========================================================================
  // Cross-Account Resource Discovery
  // ==========================================================================
  
  async function discoverCrossAccountResources(options: CrossAccountResourceOptions): Promise<OrganizationOperationResult<CrossAccountResource[]>> {
    try {
      const resources: CrossAccountResource[] = [];
      
      // Get accounts to search
      let accountIds = options.accountIds;
      if (!accountIds || accountIds.length === 0) {
        const accountsResult = await listAccounts({ status: 'ACTIVE' });
        if (accountsResult.success && accountsResult.data) {
          accountIds = accountsResult.data.map(a => a.id);
        }
      }
      
      if (!accountIds || accountIds.length === 0) {
        return { success: true, data: [] };
      }
      
      const regions = options.regions ?? ['us-east-1'];
      
      // Note: Full cross-account resource discovery would require assuming roles
      // and querying each account. This is a simplified version that returns
      // placeholder data indicating the capability.
      
      // For a real implementation, you would:
      // 1. Assume role into each account
      // 2. Use Resource Groups Tagging API or individual service APIs
      // 3. Aggregate results
      
      return {
        success: true,
        data: resources,
        message: `Cross-account resource discovery prepared for ${accountIds.length} accounts across ${regions.length} regions`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to discover cross-account resources',
      };
    }
  }
  
  async function getCrossAccountResourceSummary(options?: CrossAccountResourceOptions): Promise<OrganizationOperationResult<CrossAccountResourceSummary>> {
    try {
      // Get accounts
      const accountsResult = await listAccounts({ status: 'ACTIVE' });
      const accounts = accountsResult.success ? accountsResult.data ?? [] : [];
      
      // Build summary (this would be populated by actual resource discovery)
      const summary: CrossAccountResourceSummary = {
        totalResources: 0,
        byAccount: accounts.map(a => ({
          accountId: a.id,
          accountName: a.name,
          resourceCount: 0,
          resourceTypes: {},
        })),
        byType: [],
        byRegion: [],
      };
      
      return { success: true, data: summary };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get cross-account resource summary',
      };
    }
  }
  
  // ==========================================================================
  // Tag Operations
  // ==========================================================================
  
  async function getResourceTags(resourceId: string): Promise<OrganizationOperationResult<Record<string, string>>> {
    try {
      const response = await organizationsClient.send(new ListTagsForResourceCommand({
        ResourceId: resourceId,
      }));
      
      const tags: Record<string, string> = {};
      for (const tag of response.Tags ?? []) {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      }
      
      return { success: true, data: tags };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get resource tags',
      };
    }
  }
  
  async function tagResource(resourceId: string, tags: Record<string, string>): Promise<OrganizationOperationResult<void>> {
    try {
      await organizationsClient.send(new TagResourceCommand({
        ResourceId: resourceId,
        Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
      }));
      
      return { success: true, message: 'Tags applied successfully' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to tag resource',
      };
    }
  }
  
  async function untagResource(resourceId: string, tagKeys: string[]): Promise<OrganizationOperationResult<void>> {
    try {
      await organizationsClient.send(new UntagResourceCommand({
        ResourceId: resourceId,
        TagKeys: tagKeys,
      }));
      
      return { success: true, message: 'Tags removed successfully' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to untag resource',
      };
    }
  }
  
  // ==========================================================================
  // Return Manager Interface
  // ==========================================================================
  
  return {
    // Organization
    getOrganization,
    getRoots,
    
    // Accounts
    listAccounts,
    getAccount,
    createAccount,
    getCreateAccountStatus,
    moveAccount,
    removeAccount,
    
    // OUs
    listOrganizationalUnits,
    getOrganizationalUnit,
    createOrganizationalUnit,
    updateOrganizationalUnit,
    deleteOrganizationalUnit,
    
    // SCPs
    listPolicies,
    getPolicy,
    createPolicy,
    updatePolicy,
    deletePolicy,
    attachPolicy,
    detachPolicy,
    listPoliciesForTarget,
    getPolicyTargets,
    enablePolicyType,
    disablePolicyType,
    getSCPTemplates,
    getSCPTemplate,
    
    // Cross-account
    assumeRole,
    switchAccount,
    getCurrentContext,
    resetContext,
    getActiveSessions,
    
    // RAM
    createResourceShare,
    deleteResourceShare,
    listResourceShares,
    addResourceToShare,
    removeResourceFromShare,
    addPrincipalsToShare,
    removePrincipalsFromShare,
    listShareableResourceTypes,
    
    // Billing
    getConsolidatedBilling,
    
    // Delegated admin
    listDelegatedAdministrators,
    getDelegatedServices,
    registerDelegatedAdministrator,
    deregisterDelegatedAdministrator,
    
    // Handshakes
    listHandshakes,
    inviteAccount,
    acceptHandshake,
    declineHandshake,
    cancelHandshake,
    
    // Resource discovery
    discoverCrossAccountResources,
    getCrossAccountResourceSummary,
    
    // Tags
    getResourceTags,
    tagResource,
    untagResource,
  };
}
