/**
 * AWS Organization Manager Tests
 *
 * Comprehensive test suite for multi-account and organization management.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { createOrganizationManager, type OrganizationManager } from './manager.js';

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-organizations', () => ({
  OrganizationsClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  DescribeOrganizationCommand: vi.fn(),
  ListAccountsCommand: vi.fn(),
  ListAccountsForParentCommand: vi.fn(),
  DescribeAccountCommand: vi.fn(),
  CreateAccountCommand: vi.fn(),
  DescribeCreateAccountStatusCommand: vi.fn(),
  MoveAccountCommand: vi.fn(),
  RemoveAccountFromOrganizationCommand: vi.fn(),
  ListRootsCommand: vi.fn(),
  ListOrganizationalUnitsForParentCommand: vi.fn(),
  DescribeOrganizationalUnitCommand: vi.fn(),
  CreateOrganizationalUnitCommand: vi.fn(),
  UpdateOrganizationalUnitCommand: vi.fn(),
  DeleteOrganizationalUnitCommand: vi.fn(),
  ListPoliciesCommand: vi.fn(),
  DescribePolicyCommand: vi.fn(),
  CreatePolicyCommand: vi.fn(),
  UpdatePolicyCommand: vi.fn(),
  DeletePolicyCommand: vi.fn(),
  AttachPolicyCommand: vi.fn(),
  DetachPolicyCommand: vi.fn(),
  ListPoliciesForTargetCommand: vi.fn(),
  ListTargetsForPolicyCommand: vi.fn(),
  ListParentsCommand: vi.fn(),
  ListDelegatedAdministratorsCommand: vi.fn(),
  ListDelegatedServicesForAccountCommand: vi.fn(),
  RegisterDelegatedAdministratorCommand: vi.fn(),
  DeregisterDelegatedAdministratorCommand: vi.fn(),
  EnablePolicyTypeCommand: vi.fn(),
  DisablePolicyTypeCommand: vi.fn(),
  ListHandshakesForOrganizationCommand: vi.fn(),
  InviteAccountToOrganizationCommand: vi.fn(),
  AcceptHandshakeCommand: vi.fn(),
  DeclineHandshakeCommand: vi.fn(),
  CancelHandshakeCommand: vi.fn(),
  ListTagsForResourceCommand: vi.fn(),
  TagResourceCommand: vi.fn(),
  UntagResourceCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  AssumeRoleCommand: vi.fn(),
  GetCallerIdentityCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-ram', () => ({
  RAMClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  CreateResourceShareCommand: vi.fn(),
  DeleteResourceShareCommand: vi.fn(),
  GetResourceSharesCommand: vi.fn(),
  AssociateResourceShareCommand: vi.fn(),
  DisassociateResourceShareCommand: vi.fn(),
  ListResourcesCommand: vi.fn(),
  ListPrincipalsCommand: vi.fn(),
  GetResourceShareAssociationsCommand: vi.fn(),
  ListResourceTypesCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-cost-explorer', () => ({
  CostExplorerClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  GetCostAndUsageCommand: vi.fn(),
}));

import { OrganizationsClient } from '@aws-sdk/client-organizations';
import { STSClient } from '@aws-sdk/client-sts';
import { RAMClient } from '@aws-sdk/client-ram';
import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';

describe('OrganizationManager', () => {
  let manager: OrganizationManager;
  let mockOrgClient: { send: Mock };
  let mockStsClient: { send: Mock };
  let mockRamClient: { send: Mock };
  let mockCostClient: { send: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockOrgClient = { send: vi.fn() };
    mockStsClient = { send: vi.fn() };
    mockRamClient = { send: vi.fn() };
    mockCostClient = { send: vi.fn() };
    
    (OrganizationsClient as Mock).mockImplementation(() => mockOrgClient);
    (STSClient as Mock).mockImplementation(() => mockStsClient);
    (RAMClient as Mock).mockImplementation(() => mockRamClient);
    (CostExplorerClient as Mock).mockImplementation(() => mockCostClient);
    
    manager = createOrganizationManager({
      defaultRegion: 'us-east-1',
    });
  });

  describe('Organization Operations', () => {
    it('should get organization details', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        Organization: {
          Id: 'o-abc123',
          Arn: 'arn:aws:organizations::123456789012:organization/o-abc123',
          MasterAccountId: '123456789012',
          MasterAccountEmail: 'admin@example.com',
          MasterAccountArn: 'arn:aws:organizations::123456789012:account/o-abc123/123456789012',
          FeatureSet: 'ALL_FEATURES',
          AvailablePolicyTypes: [
            { Type: 'SERVICE_CONTROL_POLICY', Status: 'ENABLED' },
          ],
        },
      });
      
      // Mock list roots
      mockOrgClient.send.mockResolvedValueOnce({
        Roots: [
          { Id: 'r-abc1', Arn: 'arn:aws:organizations::123456789012:root/o-abc123/r-abc1', Name: 'Root' },
        ],
      });

      const result = await manager.getOrganization();

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('o-abc123');
      expect(result.data?.masterAccountId).toBe('123456789012');
      expect(result.data?.featureSet).toBe('ALL_FEATURES');
    });

    it('should list organization roots', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        Roots: [
          {
            Id: 'r-abc1',
            Arn: 'arn:aws:organizations::123456789012:root/o-abc123/r-abc1',
            Name: 'Root',
            PolicyTypes: [
              { Type: 'SERVICE_CONTROL_POLICY', Status: 'ENABLED' },
            ],
          },
        ],
      });

      const result = await manager.getRoots();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].id).toBe('r-abc1');
      expect(result.data?.[0].policyTypes).toHaveLength(1);
    });
  });

  describe('Account Operations', () => {
    it('should list all accounts', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        Accounts: [
          {
            Id: '111111111111',
            Arn: 'arn:aws:organizations::123456789012:account/o-abc123/111111111111',
            Name: 'Production',
            Email: 'prod@example.com',
            Status: 'ACTIVE',
            JoinedMethod: 'CREATED',
            JoinedTimestamp: new Date('2023-01-01'),
          },
          {
            Id: '222222222222',
            Arn: 'arn:aws:organizations::123456789012:account/o-abc123/222222222222',
            Name: 'Development',
            Email: 'dev@example.com',
            Status: 'ACTIVE',
            JoinedMethod: 'INVITED',
            JoinedTimestamp: new Date('2023-06-15'),
          },
        ],
      });

      const result = await manager.listAccounts();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0].name).toBe('Production');
      expect(result.data?.[1].name).toBe('Development');
    });

    it('should get account details', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        Account: {
          Id: '111111111111',
          Arn: 'arn:aws:organizations::123456789012:account/o-abc123/111111111111',
          Name: 'Production',
          Email: 'prod@example.com',
          Status: 'ACTIVE',
          JoinedMethod: 'CREATED',
          JoinedTimestamp: new Date('2023-01-01'),
        },
      });
      
      // Mock parents lookup
      mockOrgClient.send.mockResolvedValueOnce({
        Parents: [{ Id: 'ou-abc1-xyz', Type: 'ORGANIZATIONAL_UNIT' }],
      });
      
      // Mock tags lookup
      mockOrgClient.send.mockResolvedValueOnce({
        Tags: [{ Key: 'Environment', Value: 'Production' }],
      });
      
      // Mock organization lookup for isManagementAccount check
      mockOrgClient.send.mockResolvedValueOnce({
        Organization: { MasterAccountId: '123456789012' },
      });
      mockOrgClient.send.mockResolvedValueOnce({ Roots: [] });
      
      // Mock delegated services lookup
      mockOrgClient.send.mockResolvedValueOnce({
        DelegatedServices: [],
      });

      const result = await manager.getAccount('111111111111');

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Production');
      expect(result.data?.organizationalUnitId).toBe('ou-abc1-xyz');
    });

    it('should create a new account', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        CreateAccountStatus: {
          Id: 'car-abc123',
          AccountName: 'New Account',
          State: 'IN_PROGRESS',
          RequestedTimestamp: new Date(),
        },
      });

      const result = await manager.createAccount({
        accountName: 'New Account',
        email: 'newaccount@example.com',
      });

      expect(result.success).toBe(true);
      expect(result.data?.accountName).toBe('New Account');
      expect(result.data?.state).toBe('IN_PROGRESS');
    });

    it('should move an account to a different OU', async () => {
      mockOrgClient.send.mockResolvedValueOnce({});

      const result = await manager.moveAccount({
        accountId: '111111111111',
        sourceParentId: 'r-abc1',
        destinationParentId: 'ou-abc1-xyz',
      });

      expect(result.success).toBe(true);
    });

    it('should filter accounts by status', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        Accounts: [
          { Id: '111111111111', Name: 'Active', Status: 'ACTIVE', JoinedTimestamp: new Date() },
          { Id: '222222222222', Name: 'Suspended', Status: 'SUSPENDED', JoinedTimestamp: new Date() },
        ],
      });

      const result = await manager.listAccounts({ status: 'ACTIVE' });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].name).toBe('Active');
    });
  });

  describe('Organizational Unit Operations', () => {
    it('should list organizational units', async () => {
      // Mock roots
      mockOrgClient.send.mockResolvedValueOnce({
        Roots: [{ Id: 'r-abc1' }],
      });
      
      // Mock OUs
      mockOrgClient.send.mockResolvedValueOnce({
        OrganizationalUnits: [
          { Id: 'ou-abc1-prod', Arn: 'arn:aws:organizations::123456789012:ou/o-abc123/ou-abc1-prod', Name: 'Production' },
          { Id: 'ou-abc1-dev', Arn: 'arn:aws:organizations::123456789012:ou/o-abc123/ou-abc1-dev', Name: 'Development' },
        ],
      });

      const result = await manager.listOrganizationalUnits();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should create an organizational unit', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        OrganizationalUnit: {
          Id: 'ou-abc1-new',
          Arn: 'arn:aws:organizations::123456789012:ou/o-abc123/ou-abc1-new',
          Name: 'New OU',
        },
      });

      const result = await manager.createOrganizationalUnit({
        parentId: 'r-abc1',
        name: 'New OU',
      });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('New OU');
    });

    it('should update an organizational unit', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        OrganizationalUnit: {
          Id: 'ou-abc1-prod',
          Arn: 'arn:aws:organizations::123456789012:ou/o-abc123/ou-abc1-prod',
          Name: 'Production-Updated',
        },
      });

      const result = await manager.updateOrganizationalUnit('ou-abc1-prod', 'Production-Updated');

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Production-Updated');
    });

    it('should delete an organizational unit', async () => {
      mockOrgClient.send.mockResolvedValueOnce({});

      const result = await manager.deleteOrganizationalUnit('ou-abc1-empty');

      expect(result.success).toBe(true);
    });
  });

  describe('Service Control Policy Operations', () => {
    it('should list policies', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        Policies: [
          { Id: 'p-abc123', Name: 'DenyRootUser', Type: 'SERVICE_CONTROL_POLICY', AwsManaged: false },
          { Id: 'p-FullAWSAccess', Name: 'FullAWSAccess', Type: 'SERVICE_CONTROL_POLICY', AwsManaged: true },
        ],
      });

      const result = await manager.listPolicies();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should get policy details with content', async () => {
      const policyDocument = {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }],
      };
      
      mockOrgClient.send.mockResolvedValueOnce({
        Policy: {
          PolicySummary: {
            Id: 'p-abc123',
            Arn: 'arn:aws:organizations::123456789012:policy/o-abc123/service_control_policy/p-abc123',
            Name: 'DenyRootUser',
            Description: 'Denies root user actions',
            Type: 'SERVICE_CONTROL_POLICY',
            AwsManaged: false,
          },
          Content: JSON.stringify(policyDocument),
        },
      });
      
      // Mock targets
      mockOrgClient.send.mockResolvedValueOnce({
        Targets: [
          { TargetId: 'r-abc1', Name: 'Root', Type: 'ROOT' },
        ],
      });

      const result = await manager.getPolicy('p-abc123');

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('DenyRootUser');
      expect(result.data?.policyDocument?.Statement).toHaveLength(1);
      expect(result.data?.targets).toHaveLength(1);
    });

    it('should create a policy', async () => {
      const policyDocument = {
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Deny' as const,
          Action: 'organizations:LeaveOrganization',
          Resource: '*',
        }],
      };
      
      mockOrgClient.send.mockResolvedValueOnce({
        Policy: {
          PolicySummary: {
            Id: 'p-new123',
            Name: 'DenyLeaveOrg',
            Type: 'SERVICE_CONTROL_POLICY',
          },
          Content: JSON.stringify(policyDocument),
        },
      });

      const result = await manager.createPolicy({
        name: 'DenyLeaveOrg',
        description: 'Prevents accounts from leaving the organization',
        content: policyDocument,
      });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('DenyLeaveOrg');
    });

    it('should attach policy to target', async () => {
      mockOrgClient.send.mockResolvedValueOnce({});

      const result = await manager.attachPolicy('p-abc123', 'ou-abc1-prod');

      expect(result.success).toBe(true);
    });

    it('should detach policy from target', async () => {
      mockOrgClient.send.mockResolvedValueOnce({});

      const result = await manager.detachPolicy('p-abc123', 'ou-abc1-prod');

      expect(result.success).toBe(true);
    });

    it('should enable policy type', async () => {
      mockOrgClient.send.mockResolvedValueOnce({});

      const result = await manager.enablePolicyType('r-abc1', 'SERVICE_CONTROL_POLICY');

      expect(result.success).toBe(true);
    });
  });

  describe('SCP Templates', () => {
    it('should return all SCP templates', () => {
      const templates = manager.getSCPTemplates();

      expect(templates.length).toBeGreaterThan(0);
      expect(templates.some(t => t.id === 'deny-root-user')).toBe(true);
    });

    it('should filter templates by category', () => {
      const securityTemplates = manager.getSCPTemplates('security');

      expect(securityTemplates.every(t => t.category === 'security')).toBe(true);
    });

    it('should get specific template by ID', () => {
      const template = manager.getSCPTemplate('deny-root-user');

      expect(template).toBeDefined();
      expect(template?.name).toBe('Deny Root User Actions');
      expect(template?.document.Statement).toBeDefined();
    });

    it('should return undefined for non-existent template', () => {
      const template = manager.getSCPTemplate('non-existent');

      expect(template).toBeUndefined();
    });
  });

  describe('Cross-Account Operations', () => {
    it('should assume role in another account', async () => {
      mockStsClient.send.mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: 'ASIA...',
          SecretAccessKey: 'secret...',
          SessionToken: 'token...',
          Expiration: new Date(Date.now() + 3600000),
        },
        AssumedRoleUser: {
          Arn: 'arn:aws:sts::111111111111:assumed-role/OrganizationAccountAccessRole/session',
        },
      });

      const result = await manager.assumeRole({
        accountId: '111111111111',
        roleName: 'OrganizationAccountAccessRole',
        sessionName: 'test-session',
      });

      expect(result.success).toBe(true);
      expect(result.data?.accountId).toBe('111111111111');
      expect(result.data?.accessKeyId).toBe('ASIA...');
    });

    it('should switch account context', async () => {
      // Mock account lookup
      mockOrgClient.send.mockResolvedValueOnce({
        Account: {
          Id: '111111111111',
          Name: 'Production',
          Email: 'prod@example.com',
          Status: 'ACTIVE',
          JoinedTimestamp: new Date(),
        },
      });
      mockOrgClient.send.mockResolvedValueOnce({ Parents: [] });
      mockOrgClient.send.mockResolvedValueOnce({ Tags: [] });
      mockOrgClient.send.mockResolvedValueOnce({ Organization: { MasterAccountId: '123456789012' } });
      mockOrgClient.send.mockResolvedValueOnce({ Roots: [] });
      mockOrgClient.send.mockResolvedValueOnce({ DelegatedServices: [] });
      
      // Mock assume role
      mockStsClient.send.mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: 'ASIA...',
          SecretAccessKey: 'secret...',
          SessionToken: 'token...',
          Expiration: new Date(Date.now() + 3600000),
        },
        AssumedRoleUser: {
          Arn: 'arn:aws:sts::111111111111:assumed-role/OrganizationAccountAccessRole/session',
        },
      });

      const result = await manager.switchAccount('111111111111');

      expect(result.success).toBe(true);
      expect(result.data?.accountId).toBe('111111111111');
      expect(result.data?.isActive).toBe(true);
    });

    it('should get current context', () => {
      const context = manager.getCurrentContext();

      expect(context.currentRegion).toBe('us-east-1');
      expect(context.availableRegions).toContain('us-east-1');
    });

    it('should track active sessions', async () => {
      // Setup a session first
      mockOrgClient.send.mockResolvedValueOnce({
        Account: { Id: '111111111111', Name: 'Test', Status: 'ACTIVE', JoinedTimestamp: new Date() },
      });
      mockOrgClient.send.mockResolvedValueOnce({ Parents: [] });
      mockOrgClient.send.mockResolvedValueOnce({ Tags: [] });
      mockOrgClient.send.mockResolvedValueOnce({ Organization: { MasterAccountId: '000' } });
      mockOrgClient.send.mockResolvedValueOnce({ Roots: [] });
      mockOrgClient.send.mockResolvedValueOnce({ DelegatedServices: [] });
      mockStsClient.send.mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: 'ASIA...',
          SecretAccessKey: 'secret...',
          SessionToken: 'token...',
          Expiration: new Date(Date.now() + 3600000),
        },
        AssumedRoleUser: { Arn: 'arn:aws:sts::111111111111:assumed-role/Role/session' },
      });
      
      await manager.switchAccount('111111111111');
      const sessions = manager.getActiveSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].accountId).toBe('111111111111');
    });

    it('should reset context', async () => {
      manager.resetContext();
      const context = manager.getCurrentContext();

      expect(context.accountId).toBe('');
    });
  });

  describe('Resource Sharing (RAM) Operations', () => {
    it('should create a resource share', async () => {
      mockRamClient.send.mockResolvedValueOnce({
        resourceShare: {
          resourceShareArn: 'arn:aws:ram:us-east-1:123456789012:resource-share/abc123',
          name: 'VPC Share',
          owningAccountId: '123456789012',
          allowExternalPrincipals: false,
          status: 'ACTIVE',
          creationTime: new Date(),
          lastUpdatedTime: new Date(),
        },
      });

      const result = await manager.createResourceShare({
        name: 'VPC Share',
        resourceArns: ['arn:aws:ec2:us-east-1:123456789012:subnet/subnet-abc123'],
        principals: ['111111111111'],
      });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('VPC Share');
    });

    it('should list resource shares', async () => {
      mockRamClient.send.mockResolvedValueOnce({
        resourceShares: [
          {
            resourceShareArn: 'arn:aws:ram:us-east-1:123456789012:resource-share/abc123',
            name: 'VPC Share',
            owningAccountId: '123456789012',
            status: 'ACTIVE',
            creationTime: new Date(),
            lastUpdatedTime: new Date(),
          },
        ],
      });

      const result = await manager.listResourceShares({ resourceOwner: 'SELF' });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('should add resources to share', async () => {
      mockRamClient.send.mockResolvedValueOnce({});

      const result = await manager.addResourceToShare(
        'arn:aws:ram:us-east-1:123456789012:resource-share/abc123',
        ['arn:aws:ec2:us-east-1:123456789012:subnet/subnet-xyz789']
      );

      expect(result.success).toBe(true);
    });

    it('should list shareable resource types', async () => {
      mockRamClient.send.mockResolvedValueOnce({
        resourceTypes: [
          { resourceType: 'ec2:Subnet' },
          { resourceType: 'ec2:TransitGateway' },
          { resourceType: 'rds:Cluster' },
        ],
      });

      const result = await manager.listShareableResourceTypes();

      expect(result.success).toBe(true);
      expect(result.data).toContain('ec2:Subnet');
    });
  });

  describe('Consolidated Billing Operations', () => {
    it('should get consolidated billing summary', async () => {
      mockCostClient.send.mockResolvedValueOnce({
        ResultsByTime: [
          {
            Groups: [
              { Keys: ['111111111111', 'Amazon EC2'], Metrics: { UnblendedCost: { Amount: '1000.00' } } },
              { Keys: ['111111111111', 'Amazon S3'], Metrics: { UnblendedCost: { Amount: '250.00' } } },
              { Keys: ['222222222222', 'Amazon EC2'], Metrics: { UnblendedCost: { Amount: '500.00' } } },
            ],
          },
        ],
      });
      
      // Mock account list for names
      mockOrgClient.send.mockResolvedValueOnce({
        Accounts: [
          { Id: '111111111111', Name: 'Production', Status: 'ACTIVE', JoinedTimestamp: new Date() },
          { Id: '222222222222', Name: 'Development', Status: 'ACTIVE', JoinedTimestamp: new Date() },
        ],
      });

      const result = await manager.getConsolidatedBilling({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      });

      expect(result.success).toBe(true);
      expect(result.data?.totalCost).toBe(1750);
      expect(result.data?.linkedAccountCount).toBe(2);
      expect(result.data?.accountBreakdown).toHaveLength(2);
      expect(result.data?.serviceBreakdown).toHaveLength(2);
    });
  });

  describe('Delegated Administrator Operations', () => {
    it('should list delegated administrators', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        DelegatedAdministrators: [
          {
            Id: '111111111111',
            Arn: 'arn:aws:organizations::123456789012:account/o-abc123/111111111111',
            Name: 'Security Account',
            Email: 'security@example.com',
            Status: 'ACTIVE',
            DelegationEnabledDate: new Date(),
          },
        ],
      });

      const result = await manager.listDelegatedAdministrators('securityhub.amazonaws.com');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].name).toBe('Security Account');
    });

    it('should register delegated administrator', async () => {
      mockOrgClient.send.mockResolvedValueOnce({});

      const result = await manager.registerDelegatedAdministrator(
        '111111111111',
        'securityhub.amazonaws.com'
      );

      expect(result.success).toBe(true);
    });

    it('should get delegated services for account', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        DelegatedServices: [
          { ServicePrincipal: 'securityhub.amazonaws.com', DelegationEnabledDate: new Date() },
          { ServicePrincipal: 'guardduty.amazonaws.com', DelegationEnabledDate: new Date() },
        ],
      });

      const result = await manager.getDelegatedServices('111111111111');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  describe('Handshake Operations', () => {
    it('should list handshakes', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        Handshakes: [
          {
            Id: 'h-abc123',
            Arn: 'arn:aws:organizations::123456789012:handshake/o-abc123/invite/h-abc123',
            Parties: [
              { Id: '123456789012', Type: 'ACCOUNT' },
              { Id: 'invited@example.com', Type: 'EMAIL' },
            ],
            State: 'OPEN',
            RequestedTimestamp: new Date(),
            ExpirationTimestamp: new Date(Date.now() + 86400000),
            Action: 'INVITE',
          },
        ],
      });

      const result = await manager.listHandshakes();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].state).toBe('OPEN');
    });

    it('should invite account to organization', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        Handshake: {
          Id: 'h-new123',
          State: 'OPEN',
          Action: 'INVITE',
          Parties: [{ Id: 'newaccount@example.com', Type: 'EMAIL' }],
          RequestedTimestamp: new Date(),
          ExpirationTimestamp: new Date(Date.now() + 86400000),
        },
      });

      const result = await manager.inviteAccount({
        target: 'newaccount@example.com',
        targetType: 'EMAIL',
        notes: 'Welcome to the organization!',
      });

      expect(result.success).toBe(true);
      expect(result.data?.action).toBe('INVITE');
    });

    it('should accept handshake', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        Handshake: {
          Id: 'h-abc123',
          State: 'ACCEPTED',
          Action: 'INVITE',
          RequestedTimestamp: new Date(),
          ExpirationTimestamp: new Date(),
        },
      });

      const result = await manager.acceptHandshake('h-abc123');

      expect(result.success).toBe(true);
      expect(result.data?.state).toBe('ACCEPTED');
    });
  });

  describe('Tag Operations', () => {
    it('should get resource tags', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        Tags: [
          { Key: 'Environment', Value: 'Production' },
          { Key: 'CostCenter', Value: '12345' },
        ],
      });

      const result = await manager.getResourceTags('111111111111');

      expect(result.success).toBe(true);
      expect(result.data?.Environment).toBe('Production');
      expect(result.data?.CostCenter).toBe('12345');
    });

    it('should tag a resource', async () => {
      mockOrgClient.send.mockResolvedValueOnce({});

      const result = await manager.tagResource('111111111111', {
        Environment: 'Production',
        Team: 'Platform',
      });

      expect(result.success).toBe(true);
    });

    it('should untag a resource', async () => {
      mockOrgClient.send.mockResolvedValueOnce({});

      const result = await manager.untagResource('111111111111', ['OldTag']);

      expect(result.success).toBe(true);
    });
  });

  describe('Cross-Account Resource Discovery', () => {
    it('should discover cross-account resources', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        Accounts: [
          { Id: '111111111111', Name: 'Prod', Status: 'ACTIVE', JoinedTimestamp: new Date() },
        ],
      });

      const result = await manager.discoverCrossAccountResources({
        regions: ['us-east-1'],
      });

      expect(result.success).toBe(true);
    });

    it('should get cross-account resource summary', async () => {
      mockOrgClient.send.mockResolvedValueOnce({
        Accounts: [
          { Id: '111111111111', Name: 'Prod', Status: 'ACTIVE', JoinedTimestamp: new Date() },
          { Id: '222222222222', Name: 'Dev', Status: 'ACTIVE', JoinedTimestamp: new Date() },
        ],
      });

      const result = await manager.getCrossAccountResourceSummary();

      expect(result.success).toBe(true);
      expect(result.data?.byAccount).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle organization API errors', async () => {
      mockOrgClient.send.mockRejectedValueOnce(new Error('Access Denied'));

      const result = await manager.getOrganization();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Access Denied');
    });

    it('should handle STS assume role errors', async () => {
      mockStsClient.send.mockRejectedValueOnce(new Error('The security token included in the request is invalid'));

      const result = await manager.assumeRole({
        accountId: '111111111111',
        roleName: 'NonExistentRole',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('security token');
    });

    it('should handle RAM errors', async () => {
      mockRamClient.send.mockRejectedValueOnce(new Error('Resource share not found'));

      const result = await manager.deleteResourceShare('arn:aws:ram:us-east-1:123:resource-share/invalid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle Cost Explorer errors', async () => {
      mockCostClient.send.mockRejectedValueOnce(new Error('Cost Explorer is not enabled'));

      const result = await manager.getConsolidatedBilling({
        startDate: new Date(),
        endDate: new Date(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cost Explorer');
    });
  });
});
