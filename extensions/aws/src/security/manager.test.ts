/**
 * SecurityManager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSecurityManager, SecurityManager } from './manager.js';

// Global mock send functions
const mockIAMSend = vi.fn();
const mockSecurityHubSend = vi.fn();
const mockGuardDutySend = vi.fn();
const mockKMSSend = vi.fn();
const mockSecretsManagerSend = vi.fn();
const mockAccessAnalyzerSend = vi.fn();

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-iam', () => ({
  IAMClient: vi.fn(() => ({ send: mockIAMSend })),
  ListRolesCommand: vi.fn(),
  GetRoleCommand: vi.fn(),
  CreateRoleCommand: vi.fn(),
  DeleteRoleCommand: vi.fn(),
  AttachRolePolicyCommand: vi.fn(),
  DetachRolePolicyCommand: vi.fn(),
  PutRolePolicyCommand: vi.fn(),
  DeleteRolePolicyCommand: vi.fn(),
  ListAttachedRolePoliciesCommand: vi.fn(),
  ListRolePoliciesCommand: vi.fn(),
  ListUsersCommand: vi.fn(),
  GetUserCommand: vi.fn(),
  CreateUserCommand: vi.fn(),
  DeleteUserCommand: vi.fn(),
  AttachUserPolicyCommand: vi.fn(),
  DetachUserPolicyCommand: vi.fn(),
  ListAttachedUserPoliciesCommand: vi.fn(),
  ListUserPoliciesCommand: vi.fn(),
  ListGroupsForUserCommand: vi.fn(),
  ListAccessKeysCommand: vi.fn(),
  GetAccessKeyLastUsedCommand: vi.fn(),
  CreateAccessKeyCommand: vi.fn(),
  DeleteAccessKeyCommand: vi.fn(),
  UpdateAccessKeyCommand: vi.fn(),
  ListMFADevicesCommand: vi.fn(),
  CreateLoginProfileCommand: vi.fn(),
  ListPoliciesCommand: vi.fn(),
  GetPolicyCommand: vi.fn(),
  CreatePolicyCommand: vi.fn(),
  DeletePolicyCommand: vi.fn(),
  GetPolicyVersionCommand: vi.fn(),
  CreatePolicyVersionCommand: vi.fn(),
  SimulatePrincipalPolicyCommand: vi.fn(),
  SimulateCustomPolicyCommand: vi.fn(),
  ListRoleTagsCommand: vi.fn(),
  ListUserTagsCommand: vi.fn(),
  ListPolicyTagsCommand: vi.fn(),
  TagRoleCommand: vi.fn(),
  TagUserCommand: vi.fn(),
  TagPolicyCommand: vi.fn(),
  GetCredentialReportCommand: vi.fn(),
  GenerateCredentialReportCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-securityhub', () => ({
  SecurityHubClient: vi.fn(() => ({ send: mockSecurityHubSend })),
  GetFindingsCommand: vi.fn(),
  BatchUpdateFindingsCommand: vi.fn(),
  GetEnabledStandardsCommand: vi.fn(),
  EnableSecurityHubCommand: vi.fn(),
  DisableSecurityHubCommand: vi.fn(),
  DescribeHubCommand: vi.fn(),
  DescribeStandardsCommand: vi.fn(),
  BatchEnableStandardsCommand: vi.fn(),
  BatchDisableStandardsCommand: vi.fn(),
  GetInsightsCommand: vi.fn(),
  GetInsightResultsCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-guardduty', () => ({
  GuardDutyClient: vi.fn(() => ({ send: mockGuardDutySend })),
  ListDetectorsCommand: vi.fn(),
  GetDetectorCommand: vi.fn(),
  CreateDetectorCommand: vi.fn(),
  DeleteDetectorCommand: vi.fn(),
  UpdateDetectorCommand: vi.fn(),
  ListFindingsCommand: vi.fn(),
  GetFindingsCommand: vi.fn(),
  ArchiveFindingsCommand: vi.fn(),
  UnarchiveFindingsCommand: vi.fn(),
  GetFindingsStatisticsCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-kms', () => ({
  KMSClient: vi.fn(() => ({ send: mockKMSSend })),
  ListKeysCommand: vi.fn(),
  DescribeKeyCommand: vi.fn(),
  CreateKeyCommand: vi.fn(),
  ScheduleKeyDeletionCommand: vi.fn(),
  CancelKeyDeletionCommand: vi.fn(),
  EnableKeyCommand: vi.fn(),
  DisableKeyCommand: vi.fn(),
  EnableKeyRotationCommand: vi.fn(),
  DisableKeyRotationCommand: vi.fn(),
  GetKeyRotationStatusCommand: vi.fn(),
  GetKeyPolicyCommand: vi.fn(),
  PutKeyPolicyCommand: vi.fn(),
  ListAliasesCommand: vi.fn(),
  CreateAliasCommand: vi.fn(),
  DeleteAliasCommand: vi.fn(),
  ListResourceTagsCommand: vi.fn(),
  TagResourceCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn(() => ({ send: mockSecretsManagerSend })),
  ListSecretsCommand: vi.fn(),
  DescribeSecretCommand: vi.fn(),
  CreateSecretCommand: vi.fn(),
  DeleteSecretCommand: vi.fn(),
  UpdateSecretCommand: vi.fn(),
  GetSecretValueCommand: vi.fn(),
  PutSecretValueCommand: vi.fn(),
  RotateSecretCommand: vi.fn(),
  RestoreSecretCommand: vi.fn(),
  TagResourceCommand: vi.fn(),
  ListSecretVersionIdsCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-accessanalyzer', () => ({
  AccessAnalyzerClient: vi.fn(() => ({ send: mockAccessAnalyzerSend })),
  ListAnalyzersCommand: vi.fn(),
  CreateAnalyzerCommand: vi.fn(),
  DeleteAnalyzerCommand: vi.fn(),
  ListFindingsCommand: vi.fn(),
  GetFindingCommand: vi.fn(),
  UpdateFindingsCommand: vi.fn(),
}));

describe('SecurityManager', () => {
  let manager: SecurityManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createSecurityManager({
      defaultRegion: 'us-east-1',
    });
  });

  describe('IAM Role Operations', () => {
    it('should list IAM roles', async () => {
      mockIAMSend.mockResolvedValueOnce({
        Roles: [
          {
            RoleName: 'TestRole',
            RoleId: 'AIDATEST123',
            Arn: 'arn:aws:iam::123456789012:role/TestRole',
            Path: '/',
            CreateDate: new Date('2024-01-01'),
            AssumeRolePolicyDocument: encodeURIComponent(JSON.stringify({
              Version: '2012-10-17',
              Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
            })),
          },
        ],
      });
      mockIAMSend.mockResolvedValueOnce({ Tags: [] }); // ListRoleTagsCommand

      const result = await manager.listRoles();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].roleName).toBe('TestRole');
    });

    it('should get a specific IAM role', async () => {
      mockIAMSend.mockResolvedValueOnce({
        Role: {
          RoleName: 'TestRole',
          RoleId: 'AIDATEST123',
          Arn: 'arn:aws:iam::123456789012:role/TestRole',
          Path: '/',
          CreateDate: new Date('2024-01-01'),
          MaxSessionDuration: 3600,
          AssumeRolePolicyDocument: encodeURIComponent(JSON.stringify({
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
          })),
        },
      });
      mockIAMSend.mockResolvedValueOnce({ AttachedPolicies: [] });
      mockIAMSend.mockResolvedValueOnce({ PolicyNames: [] });
      mockIAMSend.mockResolvedValueOnce({ Tags: [{ Key: 'Environment', Value: 'test' }] });

      const result = await manager.getRole('TestRole');

      expect(result.success).toBe(true);
      expect(result.data!.roleName).toBe('TestRole');
      expect(result.data!.tags).toEqual({ Environment: 'test' });
    });

    it('should create an IAM role', async () => {
      mockIAMSend.mockResolvedValueOnce({
        Role: {
          RoleName: 'NewRole',
          RoleId: 'AIDANEW123',
          Arn: 'arn:aws:iam::123456789012:role/NewRole',
          Path: '/',
          CreateDate: new Date('2024-01-01'),
          AssumeRolePolicyDocument: encodeURIComponent(JSON.stringify({
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
          })),
        },
      });
      mockIAMSend.mockResolvedValueOnce({ AttachedPolicies: [] });
      mockIAMSend.mockResolvedValueOnce({ PolicyNames: [] });
      mockIAMSend.mockResolvedValueOnce({ Tags: [] });

      const result = await manager.createRole({
        roleName: 'NewRole',
        trustPolicy: {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
        },
        description: 'Test role',
      });

      expect(result.success).toBe(true);
      expect(result.data!.roleName).toBe('NewRole');
    });

    it('should delete an IAM role', async () => {
      mockIAMSend.mockResolvedValueOnce({ AttachedPolicies: [] });
      mockIAMSend.mockResolvedValueOnce({ PolicyNames: [] });
      mockIAMSend.mockResolvedValueOnce({});

      const result = await manager.deleteRole('TestRole');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Deleted IAM role TestRole');
    });

    it('should attach policy to role', async () => {
      mockIAMSend.mockResolvedValueOnce({});

      const result = await manager.attachRolePolicy('TestRole', 'arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Attached policy');
    });

    it('should detach policy from role', async () => {
      mockIAMSend.mockResolvedValueOnce({});

      const result = await manager.detachRolePolicy('TestRole', 'arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Detached policy');
    });
  });

  describe('IAM User Operations', () => {
    it('should list IAM users', async () => {
      mockIAMSend.mockResolvedValueOnce({
        Users: [
          {
            UserName: 'TestUser',
            UserId: 'AIDAUSER123',
            Arn: 'arn:aws:iam::123456789012:user/TestUser',
            Path: '/',
            CreateDate: new Date('2024-01-01'),
          },
        ],
      });
      mockIAMSend.mockResolvedValueOnce({ Groups: [] });
      mockIAMSend.mockResolvedValueOnce({ Tags: [] });

      const result = await manager.listUsers();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].userName).toBe('TestUser');
    });

    it('should get a specific IAM user', async () => {
      mockIAMSend.mockResolvedValueOnce({
        User: {
          UserName: 'TestUser',
          UserId: 'AIDAUSER123',
          Arn: 'arn:aws:iam::123456789012:user/TestUser',
          Path: '/',
          CreateDate: new Date('2024-01-01'),
        },
      });
      mockIAMSend.mockResolvedValueOnce({ AttachedPolicies: [] });
      mockIAMSend.mockResolvedValueOnce({ PolicyNames: [] });
      mockIAMSend.mockResolvedValueOnce({ Groups: [] });
      mockIAMSend.mockResolvedValueOnce({ AccessKeyMetadata: [] });
      mockIAMSend.mockResolvedValueOnce({ MFADevices: [] });
      mockIAMSend.mockResolvedValueOnce({ Tags: [] });

      const result = await manager.getUser('TestUser');

      expect(result.success).toBe(true);
      expect(result.data!.userName).toBe('TestUser');
    });

    it('should create an IAM user', async () => {
      mockIAMSend.mockResolvedValueOnce({
        User: {
          UserName: 'NewUser',
          UserId: 'AIDANEWUSER',
          Arn: 'arn:aws:iam::123456789012:user/NewUser',
          Path: '/',
          CreateDate: new Date('2024-01-01'),
        },
      });
      mockIAMSend.mockResolvedValueOnce({ Groups: [] });
      mockIAMSend.mockResolvedValueOnce({ Tags: [] });

      const result = await manager.createUser({
        userName: 'NewUser',
      });

      expect(result.success).toBe(true);
      expect(result.data!.user.userName).toBe('NewUser');
    });

    it('should delete an IAM user', async () => {
      mockIAMSend.mockResolvedValueOnce({ AccessKeyMetadata: [] });
      mockIAMSend.mockResolvedValueOnce({ AttachedPolicies: [] });
      mockIAMSend.mockResolvedValueOnce({});

      const result = await manager.deleteUser('TestUser');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Deleted IAM user TestUser');
    });
  });

  describe('IAM Policy Operations', () => {
    it('should list IAM policies', async () => {
      mockIAMSend.mockResolvedValueOnce({
        Policies: [
          {
            PolicyName: 'TestPolicy',
            PolicyId: 'ANPATEST123',
            Arn: 'arn:aws:iam::123456789012:policy/TestPolicy',
            Path: '/',
            CreateDate: new Date('2024-01-01'),
            UpdateDate: new Date('2024-01-01'),
            DefaultVersionId: 'v1',
            AttachmentCount: 1,
            IsAttachable: true,
          },
        ],
      });
      mockIAMSend.mockResolvedValueOnce({ Tags: [] });

      const result = await manager.listPolicies();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].policyName).toBe('TestPolicy');
    });

    it('should get a specific IAM policy with document', async () => {
      mockIAMSend.mockResolvedValueOnce({
        Policy: {
          PolicyName: 'TestPolicy',
          PolicyId: 'ANPATEST123',
          Arn: 'arn:aws:iam::123456789012:policy/TestPolicy',
          Path: '/',
          CreateDate: new Date('2024-01-01'),
          UpdateDate: new Date('2024-01-01'),
          DefaultVersionId: 'v1',
          AttachmentCount: 1,
          IsAttachable: true,
        },
      });
      mockIAMSend.mockResolvedValueOnce({ Tags: [] });
      mockIAMSend.mockResolvedValueOnce({
        PolicyVersion: {
          Document: encodeURIComponent(JSON.stringify({
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }],
          })),
        },
      });

      const result = await manager.getPolicy('arn:aws:iam::123456789012:policy/TestPolicy');

      expect(result.success).toBe(true);
      expect(result.data!.policyName).toBe('TestPolicy');
      expect(result.data!.document.Version).toBe('2012-10-17');
    });

    it('should create an IAM policy', async () => {
      mockIAMSend.mockResolvedValueOnce({
        Policy: {
          PolicyName: 'NewPolicy',
          PolicyId: 'ANPANEW123',
          Arn: 'arn:aws:iam::123456789012:policy/NewPolicy',
          Path: '/',
          CreateDate: new Date('2024-01-01'),
          UpdateDate: new Date('2024-01-01'),
          DefaultVersionId: 'v1',
          AttachmentCount: 0,
          IsAttachable: true,
        },
      });
      mockIAMSend.mockResolvedValueOnce({ Tags: [] });

      const result = await manager.createPolicy({
        policyName: 'NewPolicy',
        policyDocument: {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }],
        },
      });

      expect(result.success).toBe(true);
      expect(result.data!.policyName).toBe('NewPolicy');
    });

    it('should delete an IAM policy', async () => {
      mockIAMSend.mockResolvedValueOnce({});

      const result = await manager.deletePolicy('arn:aws:iam::123456789012:policy/TestPolicy');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Deleted IAM policy');
    });
  });

  describe('Policy Templates', () => {
    it('should get lambda-basic policy template', () => {
      const policy = manager.getPolicyTemplate('lambda-basic');

      expect(policy.Version).toBe('2012-10-17');
      expect(policy.Statement).toHaveLength(1);
      expect(policy.Statement[0].Action).toContain('logs:CreateLogGroup');
    });

    it('should substitute variables in policy template', () => {
      const policy = manager.getPolicyTemplate('lambda-s3-read', { BUCKET_NAME: 'my-bucket' });

      expect(policy.Version).toBe('2012-10-17');
      expect(JSON.stringify(policy)).toContain('my-bucket');
    });

    it('should get lambda-dynamodb policy template', () => {
      const policy = manager.getPolicyTemplate('lambda-dynamodb', { TABLE_NAME: 'MyTable' });

      expect(policy.Version).toBe('2012-10-17');
      expect(JSON.stringify(policy)).toContain('MyTable');
      expect(JSON.stringify(policy)).toContain('dynamodb:GetItem');
    });

    it('should throw error for unknown template', () => {
      expect(() => manager.getPolicyTemplate('unknown' as any)).toThrow('Unknown policy template');
    });
  });

  describe('Policy Simulation', () => {
    it('should simulate custom policy', async () => {
      mockIAMSend.mockResolvedValueOnce({
        EvaluationResults: [
          {
            EvalActionName: 's3:GetObject',
            EvalDecision: 'allowed',
            MatchedStatements: [],
            MissingContextValues: [],
          },
        ],
      });

      const result = await manager.simulatePolicy({
        policyInputList: [JSON.stringify({
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }],
        })],
        actionNames: ['s3:GetObject'],
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].evalDecision).toBe('allowed');
    });
  });

  describe('Security Hub Operations', () => {
    it('should list Security Hub findings', async () => {
      mockSecurityHubSend.mockResolvedValueOnce({
        Findings: [
          {
            Id: 'finding-1',
            ProductArn: 'arn:aws:securityhub:us-east-1::product/aws/securityhub',
            GeneratorId: 'aws-foundational-security-best-practices',
            AwsAccountId: '123456789012',
            Title: 'S3 buckets should require SSL',
            Description: 'Test finding',
            Severity: { Label: 'MEDIUM', Normalized: 40 },
            Types: ['Software and Configuration Checks'],
            CreatedAt: '2024-01-01T00:00:00Z',
            UpdatedAt: '2024-01-01T00:00:00Z',
            Resources: [],
            RecordState: 'ACTIVE',
          },
        ],
      });

      const result = await manager.listSecurityFindings();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].title).toBe('S3 buckets should require SSL');
    });

    it('should enable Security Hub', async () => {
      mockSecurityHubSend.mockResolvedValueOnce({});

      const result = await manager.enableSecurityHub();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Security Hub enabled');
    });

    it('should disable Security Hub', async () => {
      mockSecurityHubSend.mockResolvedValueOnce({});

      const result = await manager.disableSecurityHub();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Security Hub disabled');
    });

    it('should list security standards', async () => {
      mockSecurityHubSend.mockResolvedValueOnce({
        Standards: [
          {
            StandardsArn: 'arn:aws:securityhub:::ruleset/cis-aws-foundations-benchmark/v/1.2.0',
            Name: 'CIS AWS Foundations Benchmark',
            EnabledByDefault: false,
          },
        ],
      });
      mockSecurityHubSend.mockResolvedValueOnce({
        StandardsSubscriptions: [],
      });

      const result = await manager.listSecurityStandards();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].name).toBe('CIS AWS Foundations Benchmark');
    });
  });

  describe('GuardDuty Operations', () => {
    it('should list GuardDuty findings', async () => {
      mockGuardDutySend.mockResolvedValueOnce({ DetectorIds: ['detector-123'] });
      mockGuardDutySend.mockResolvedValueOnce({ FindingIds: ['finding-1'] });
      mockGuardDutySend.mockResolvedValueOnce({
        Findings: [
          {
            Id: 'finding-1',
            AccountId: '123456789012',
            Arn: 'arn:aws:guardduty:us-east-1:123456789012:detector/detector-123/finding/finding-1',
            Type: 'UnauthorizedAccess:IAMUser/MaliciousIPCaller',
            Title: 'Malicious IP accessing resources',
            Description: 'Test finding',
            Severity: 8,
            Confidence: 95,
            CreatedAt: '2024-01-01T00:00:00Z',
            UpdatedAt: '2024-01-01T00:00:00Z',
            Resource: { ResourceType: 'AccessKey' },
            Service: {},
          },
        ],
      });

      const result = await manager.listGuardDutyFindings();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].severityLabel).toBe('High');
    });

    it('should enable GuardDuty', async () => {
      mockGuardDutySend.mockResolvedValueOnce({ DetectorId: 'new-detector-123' });

      const result = await manager.enableGuardDuty();

      expect(result.success).toBe(true);
      expect(result.data).toBe('new-detector-123');
    });

    it('should disable GuardDuty', async () => {
      mockGuardDutySend.mockResolvedValueOnce({});

      const result = await manager.disableGuardDuty('detector-123');

      expect(result.success).toBe(true);
      expect(result.message).toContain('deleted');
    });

    it('should archive GuardDuty findings', async () => {
      mockGuardDutySend.mockResolvedValueOnce({});

      const result = await manager.archiveGuardDutyFindings('detector-123', ['finding-1', 'finding-2']);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Archived 2');
    });
  });

  describe('KMS Operations', () => {
    it('should list KMS keys', async () => {
      mockKMSSend.mockResolvedValueOnce({
        Keys: [{ KeyId: 'key-123', KeyArn: 'arn:aws:kms:us-east-1:123456789012:key/key-123' }],
      });
      mockKMSSend.mockResolvedValueOnce({
        KeyMetadata: {
          KeyId: 'key-123',
          Arn: 'arn:aws:kms:us-east-1:123456789012:key/key-123',
          KeyState: 'Enabled',
          KeyUsage: 'ENCRYPT_DECRYPT',
          KeySpec: 'SYMMETRIC_DEFAULT',
          Origin: 'AWS_KMS',
          CreationDate: new Date('2024-01-01'),
          Enabled: true,
          KeyManager: 'CUSTOMER',
          MultiRegion: false,
        },
      });

      const result = await manager.listKMSKeys();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].keyId).toBe('key-123');
    });

    it('should create KMS key', async () => {
      mockKMSSend.mockResolvedValueOnce({
        KeyMetadata: {
          KeyId: 'new-key-123',
          Arn: 'arn:aws:kms:us-east-1:123456789012:key/new-key-123',
          KeyState: 'Enabled',
          KeyUsage: 'ENCRYPT_DECRYPT',
          KeySpec: 'SYMMETRIC_DEFAULT',
          Origin: 'AWS_KMS',
          CreationDate: new Date('2024-01-01'),
          Enabled: true,
          KeyManager: 'CUSTOMER',
          MultiRegion: false,
        },
      });
      mockKMSSend.mockResolvedValueOnce({
        KeyMetadata: {
          KeyId: 'new-key-123',
          Arn: 'arn:aws:kms:us-east-1:123456789012:key/new-key-123',
          KeyState: 'Enabled',
          KeyUsage: 'ENCRYPT_DECRYPT',
          KeySpec: 'SYMMETRIC_DEFAULT',
          Origin: 'AWS_KMS',
          CreationDate: new Date('2024-01-01'),
          Enabled: true,
          KeyManager: 'CUSTOMER',
          MultiRegion: false,
        },
      });
      mockKMSSend.mockResolvedValueOnce({ Aliases: [] });
      mockKMSSend.mockResolvedValueOnce({ Tags: [] });
      mockKMSSend.mockResolvedValueOnce({ Policy: '{}' });
      mockKMSSend.mockResolvedValueOnce({ KeyRotationEnabled: false });

      const result = await manager.createKMSKey({
        description: 'Test key',
      });

      expect(result.success).toBe(true);
      expect(result.data!.keyId).toBe('new-key-123');
    });

    it('should schedule key deletion', async () => {
      const deletionDate = new Date('2024-02-01');
      mockKMSSend.mockResolvedValueOnce({
        KeyId: 'key-123',
        DeletionDate: deletionDate,
      });

      const result = await manager.scheduleKeyDeletion('key-123', 30);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(deletionDate);
    });

    it('should enable key rotation', async () => {
      mockKMSSend.mockResolvedValueOnce({});

      const result = await manager.enableKeyRotation('key-123');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Enabled rotation');
    });
  });

  describe('Secrets Manager Operations', () => {
    it('should list secrets', async () => {
      mockSecretsManagerSend.mockResolvedValueOnce({
        SecretList: [
          {
            ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret',
            Name: 'test-secret',
            CreatedDate: new Date('2024-01-01'),
            RotationEnabled: false,
            Tags: [],
          },
        ],
      });

      const result = await manager.listSecrets();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].name).toBe('test-secret');
    });

    it('should get secret value', async () => {
      mockSecretsManagerSend.mockResolvedValueOnce({
        ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret',
        Name: 'test-secret',
        VersionId: 'version-1',
        VersionStages: ['AWSCURRENT'],
        SecretString: '{"password": "secret123"}',
        CreatedDate: new Date('2024-01-01'),
      });

      const result = await manager.getSecretValue('test-secret');

      expect(result.success).toBe(true);
      expect(result.data!.secretString).toBe('{"password": "secret123"}');
    });

    it('should create secret', async () => {
      mockSecretsManagerSend.mockResolvedValueOnce({
        ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:new-secret',
        Name: 'new-secret',
        VersionId: 'version-1',
      });
      mockSecretsManagerSend.mockResolvedValueOnce({
        ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:new-secret',
        Name: 'new-secret',
        CreatedDate: new Date('2024-01-01'),
        Tags: [],
      });

      const result = await manager.createSecret({
        name: 'new-secret',
        secretString: '{"password": "secret123"}',
      });

      expect(result.success).toBe(true);
      expect(result.data!.name).toBe('new-secret');
    });

    it('should delete secret', async () => {
      mockSecretsManagerSend.mockResolvedValueOnce({});

      const result = await manager.deleteSecret('test-secret');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Scheduled deletion');
    });

    it('should rotate secret', async () => {
      mockSecretsManagerSend.mockResolvedValueOnce({});

      const result = await manager.rotateSecret({
        secretId: 'test-secret',
        rotateImmediately: true,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Initiated rotation');
    });
  });

  describe('Access Analyzer Operations', () => {
    it('should list Access Analyzers', async () => {
      mockAccessAnalyzerSend.mockResolvedValueOnce({
        analyzers: [
          {
            arn: 'arn:aws:access-analyzer:us-east-1:123456789012:analyzer/test-analyzer',
            name: 'test-analyzer',
            type: 'ACCOUNT',
            createdAt: new Date('2024-01-01'),
            status: 'ACTIVE',
            tags: {},
          },
        ],
      });

      const result = await manager.listAccessAnalyzers();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].analyzerName).toBe('test-analyzer');
    });

    it('should list Access Analyzer findings', async () => {
      mockAccessAnalyzerSend.mockResolvedValueOnce({
        analyzers: [
          {
            arn: 'arn:aws:access-analyzer:us-east-1:123456789012:analyzer/test-analyzer',
            name: 'test-analyzer',
          },
        ],
      });
      mockAccessAnalyzerSend.mockResolvedValueOnce({
        findings: [
          {
            id: 'finding-1',
            analyzerArn: 'arn:aws:access-analyzer:us-east-1:123456789012:analyzer/test-analyzer',
            analyzedAt: new Date('2024-01-01'),
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-01'),
            status: 'ACTIVE',
            resourceType: 'AWS::S3::Bucket',
            resource: 'arn:aws:s3:::public-bucket',
            resourceOwnerAccount: '123456789012',
            isPublic: true,
          },
        ],
      });

      const result = await manager.listAccessAnalyzerFindings();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].isPublic).toBe(true);
    });

    it('should create Access Analyzer', async () => {
      mockAccessAnalyzerSend.mockResolvedValueOnce({
        arn: 'arn:aws:access-analyzer:us-east-1:123456789012:analyzer/new-analyzer',
      });

      const result = await manager.createAccessAnalyzer({
        analyzerName: 'new-analyzer',
        type: 'ACCOUNT',
      });

      expect(result.success).toBe(true);
      expect(result.data!.analyzerName).toBe('new-analyzer');
    });

    it('should delete Access Analyzer', async () => {
      mockAccessAnalyzerSend.mockResolvedValueOnce({});

      const result = await manager.deleteAccessAnalyzer('test-analyzer');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Deleted Access Analyzer');
    });
  });

  describe('Error Handling', () => {
    it('should handle IAM errors gracefully', async () => {
      mockIAMSend.mockRejectedValueOnce(new Error('Access Denied'));

      const result = await manager.listRoles();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access Denied');
    });

    it('should handle Security Hub errors gracefully', async () => {
      mockSecurityHubSend.mockRejectedValueOnce(new Error('Security Hub not enabled'));

      const result = await manager.listSecurityFindings();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Security Hub not enabled');
    });

    it('should handle GuardDuty not enabled', async () => {
      mockGuardDutySend.mockResolvedValueOnce({ DetectorIds: [] });

      const result = await manager.listGuardDutyFindings();

      expect(result.success).toBe(false);
      expect(result.error).toContain('not enabled');
    });

    it('should handle KMS errors gracefully', async () => {
      mockKMSSend.mockRejectedValueOnce(new Error('Key not found'));

      const result = await manager.getKMSKey('invalid-key');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Key not found');
    });
  });
});
