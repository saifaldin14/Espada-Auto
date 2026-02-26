/**
 * AWS Security Manager
 *
 * Provides comprehensive IAM, Security Hub, GuardDuty, KMS,
 * Secrets Manager, and Access Analyzer management.
 */

import {
  IAMClient,
  ListRolesCommand,
  GetRoleCommand,
  CreateRoleCommand,
  DeleteRoleCommand,
  AttachRolePolicyCommand,
  DetachRolePolicyCommand,
  PutRolePolicyCommand,
  DeleteRolePolicyCommand,
  ListAttachedRolePoliciesCommand,
  ListRolePoliciesCommand,
  ListUsersCommand,
  GetUserCommand,
  CreateUserCommand,
  DeleteUserCommand,
  AttachUserPolicyCommand,
  DetachUserPolicyCommand,
  ListAttachedUserPoliciesCommand,
  ListUserPoliciesCommand,
  ListGroupsForUserCommand,
  ListAccessKeysCommand,
  GetAccessKeyLastUsedCommand,
  CreateAccessKeyCommand,
  DeleteAccessKeyCommand,
  UpdateAccessKeyCommand,
  ListMFADevicesCommand,
  CreateLoginProfileCommand,
  ListPoliciesCommand,
  GetPolicyCommand,
  CreatePolicyCommand,
  DeletePolicyCommand,
  GetPolicyVersionCommand,
  CreatePolicyVersionCommand,
  SimulatePrincipalPolicyCommand,
  SimulateCustomPolicyCommand,
  ListRoleTagsCommand,
  ListUserTagsCommand,
  ListPolicyTagsCommand,
  TagRoleCommand,
  TagUserCommand,
  TagPolicyCommand,
  GetCredentialReportCommand,
  GenerateCredentialReportCommand,
  type Role,
  type User,
  type Policy,
  type Tag,
} from '@aws-sdk/client-iam';

import {
  SecurityHubClient,
  GetFindingsCommand,
  BatchUpdateFindingsCommand,
  GetEnabledStandardsCommand,
  EnableSecurityHubCommand,
  DisableSecurityHubCommand,
  DescribeHubCommand,
  DescribeStandardsCommand,
  BatchEnableStandardsCommand,
  BatchDisableStandardsCommand,
  GetInsightsCommand,
  GetInsightResultsCommand,
  type AwsSecurityFinding,
} from '@aws-sdk/client-securityhub';

import {
  GuardDutyClient,
  ListDetectorsCommand,
  GetDetectorCommand,
  CreateDetectorCommand,
  DeleteDetectorCommand,
  UpdateDetectorCommand,
  ListFindingsCommand,
  GetFindingsCommand as GetGuardDutyFindingsCommand,
  ArchiveFindingsCommand,
  UnarchiveFindingsCommand,
  GetFindingsStatisticsCommand,
  type Finding,
} from '@aws-sdk/client-guardduty';

import {
  KMSClient,
  ListKeysCommand,
  DescribeKeyCommand,
  CreateKeyCommand,
  ScheduleKeyDeletionCommand,
  CancelKeyDeletionCommand,
  EnableKeyCommand,
  DisableKeyCommand,
  EnableKeyRotationCommand,
  DisableKeyRotationCommand,
  GetKeyRotationStatusCommand,
  GetKeyPolicyCommand,
  PutKeyPolicyCommand,
  ListAliasesCommand,
  CreateAliasCommand,
  DeleteAliasCommand,
  ListResourceTagsCommand,
  TagResourceCommand,
  type KeyMetadata,
} from '@aws-sdk/client-kms';

import {
  SecretsManagerClient,
  ListSecretsCommand,
  DescribeSecretCommand,
  CreateSecretCommand,
  DeleteSecretCommand,
  UpdateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  RotateSecretCommand,
  RestoreSecretCommand,
  TagResourceCommand as TagSecretCommand,
  ListSecretVersionIdsCommand,
  type SecretListEntry,
} from '@aws-sdk/client-secrets-manager';

import {
  AccessAnalyzerClient,
  ListAnalyzersCommand,
  CreateAnalyzerCommand,
  DeleteAnalyzerCommand,
  ListFindingsCommand as ListAccessAnalyzerFindingsCommand,
  GetFindingCommand,
  UpdateFindingsCommand,
  type AnalyzerSummary,
  type FindingSummary,
} from '@aws-sdk/client-accessanalyzer';

import type {
  SecurityManagerConfig,
  SecurityOperationResult,
  IAMRoleInfo,
  IAMUserInfo,
  IAMPolicyInfo,
  AttachedPolicy,
  AccessKeyInfo,
  MFADeviceInfo,
  ListRolesOptions,
  ListUsersOptions,
  ListPoliciesOptions,
  CreateRoleOptions,
  CreatePolicyOptions,
  CreateUserOptions,
  CreateUserResult,
  PolicyDocument,
  TrustPolicy,
  SecurityFinding,
  SecurityFindingResource,
  ListSecurityFindingsOptions,
  SecurityStandard,
  GuardDutyFinding,
  GuardDutyDetector,
  ListGuardDutyFindingsOptions,
  KMSKeyInfo,
  ListKMSKeysOptions,
  CreateKMSKeyOptions,
  SecretInfo,
  SecretValue,
  ListSecretsOptions,
  CreateSecretOptions,
  UpdateSecretOptions,
  RotateSecretOptions,
  AccessAnalyzerFinding,
  AccessAnalyzerInfo,
  ListAccessAnalyzerFindingsOptions,
  CreateAccessAnalyzerOptions,
  PolicySimulationResult,
  SimulatePolicyOptions,
  SecurityPostureSummary,
  PolicyTemplate,
  PolicyTemplateDefinition,
  ComplianceStatus,
  WorkflowStatus,
} from './types.js';

/**
 * Security Manager interface
 */
export interface SecurityManager {
  // IAM Role operations
  listRoles(options?: ListRolesOptions): Promise<SecurityOperationResult<IAMRoleInfo[]>>;
  getRole(roleName: string): Promise<SecurityOperationResult<IAMRoleInfo>>;
  createRole(options: CreateRoleOptions): Promise<SecurityOperationResult<IAMRoleInfo>>;
  deleteRole(roleName: string): Promise<SecurityOperationResult<void>>;
  attachRolePolicy(roleName: string, policyArn: string): Promise<SecurityOperationResult<void>>;
  detachRolePolicy(roleName: string, policyArn: string): Promise<SecurityOperationResult<void>>;
  
  // IAM User operations
  listUsers(options?: ListUsersOptions): Promise<SecurityOperationResult<IAMUserInfo[]>>;
  getUser(userName: string): Promise<SecurityOperationResult<IAMUserInfo>>;
  createUser(options: CreateUserOptions): Promise<SecurityOperationResult<CreateUserResult>>;
  deleteUser(userName: string): Promise<SecurityOperationResult<void>>;
  
  // IAM Policy operations
  listPolicies(options?: ListPoliciesOptions): Promise<SecurityOperationResult<IAMPolicyInfo[]>>;
  getPolicy(policyArn: string): Promise<SecurityOperationResult<IAMPolicyInfo & { document: PolicyDocument }>>;
  createPolicy(options: CreatePolicyOptions): Promise<SecurityOperationResult<IAMPolicyInfo>>;
  deletePolicy(policyArn: string): Promise<SecurityOperationResult<void>>;
  
  // Policy simulation
  simulatePolicy(options: SimulatePolicyOptions): Promise<SecurityOperationResult<PolicySimulationResult[]>>;
  
  // Policy templates
  getPolicyTemplate(template: PolicyTemplate, variables?: Record<string, string>): PolicyDocument;
  
  // Security Hub operations
  listSecurityFindings(options?: ListSecurityFindingsOptions): Promise<SecurityOperationResult<SecurityFinding[]>>;
  updateSecurityFindings(findingIds: string[], workflow: { status: string }, region?: string): Promise<SecurityOperationResult<void>>;
  enableSecurityHub(region?: string): Promise<SecurityOperationResult<void>>;
  disableSecurityHub(region?: string): Promise<SecurityOperationResult<void>>;
  listSecurityStandards(region?: string): Promise<SecurityOperationResult<SecurityStandard[]>>;
  enableSecurityStandard(standardArn: string, region?: string): Promise<SecurityOperationResult<void>>;
  
  // GuardDuty operations
  listGuardDutyFindings(options?: ListGuardDutyFindingsOptions): Promise<SecurityOperationResult<GuardDutyFinding[]>>;
  getGuardDutyDetector(detectorId?: string, region?: string): Promise<SecurityOperationResult<GuardDutyDetector>>;
  enableGuardDuty(region?: string): Promise<SecurityOperationResult<string>>;
  disableGuardDuty(detectorId: string, region?: string): Promise<SecurityOperationResult<void>>;
  archiveGuardDutyFindings(detectorId: string, findingIds: string[], region?: string): Promise<SecurityOperationResult<void>>;
  
  // KMS operations
  listKMSKeys(options?: ListKMSKeysOptions): Promise<SecurityOperationResult<KMSKeyInfo[]>>;
  getKMSKey(keyId: string, region?: string): Promise<SecurityOperationResult<KMSKeyInfo>>;
  createKMSKey(options: CreateKMSKeyOptions): Promise<SecurityOperationResult<KMSKeyInfo>>;
  scheduleKeyDeletion(keyId: string, pendingWindowDays?: number, region?: string): Promise<SecurityOperationResult<Date>>;
  enableKeyRotation(keyId: string, region?: string): Promise<SecurityOperationResult<void>>;
  disableKeyRotation(keyId: string, region?: string): Promise<SecurityOperationResult<void>>;
  
  // Secrets Manager operations
  listSecrets(options?: ListSecretsOptions): Promise<SecurityOperationResult<SecretInfo[]>>;
  getSecret(secretId: string, region?: string): Promise<SecurityOperationResult<SecretInfo>>;
  getSecretValue(secretId: string, versionId?: string, region?: string): Promise<SecurityOperationResult<SecretValue>>;
  createSecret(options: CreateSecretOptions): Promise<SecurityOperationResult<SecretInfo>>;
  updateSecret(options: UpdateSecretOptions): Promise<SecurityOperationResult<void>>;
  deleteSecret(secretId: string, forceDelete?: boolean, recoveryWindow?: number, region?: string): Promise<SecurityOperationResult<void>>;
  rotateSecret(options: RotateSecretOptions): Promise<SecurityOperationResult<void>>;
  
  // Access Analyzer operations
  listAccessAnalyzers(region?: string): Promise<SecurityOperationResult<AccessAnalyzerInfo[]>>;
  listAccessAnalyzerFindings(options?: ListAccessAnalyzerFindingsOptions): Promise<SecurityOperationResult<AccessAnalyzerFinding[]>>;
  createAccessAnalyzer(options: CreateAccessAnalyzerOptions): Promise<SecurityOperationResult<AccessAnalyzerInfo>>;
  deleteAccessAnalyzer(analyzerName: string, region?: string): Promise<SecurityOperationResult<void>>;
  archiveAccessAnalyzerFinding(analyzerArn: string, findingId: string, region?: string): Promise<SecurityOperationResult<void>>;
  
  // Security posture
  getSecurityPosture(region?: string): Promise<SecurityOperationResult<SecurityPostureSummary>>;
}

/**
 * Create Security Manager instance
 */
export function createSecurityManager(config: SecurityManagerConfig = {}): SecurityManager {
  const defaultRegion = config.defaultRegion || 'us-east-1';

  // Client factory functions
  function createIAMClient(): IAMClient {
    return new IAMClient({
      region: defaultRegion,
      credentials: config.credentials,
    });
  }

  function createSecurityHubClient(region?: string): SecurityHubClient {
    return new SecurityHubClient({
      region: region || defaultRegion,
      credentials: config.credentials,
    });
  }

  function createGuardDutyClient(region?: string): GuardDutyClient {
    return new GuardDutyClient({
      region: region || defaultRegion,
      credentials: config.credentials,
    });
  }

  function createKMSClient(region?: string): KMSClient {
    return new KMSClient({
      region: region || defaultRegion,
      credentials: config.credentials,
    });
  }

  function createSecretsManagerClient(region?: string): SecretsManagerClient {
    return new SecretsManagerClient({
      region: region || defaultRegion,
      credentials: config.credentials,
    });
  }

  function createAccessAnalyzerClient(region?: string): AccessAnalyzerClient {
    return new AccessAnalyzerClient({
      region: region || defaultRegion,
      credentials: config.credentials,
    });
  }

  // Helper functions
  function tagsToRecord(tags?: Tag[]): Record<string, string> {
    if (!tags) return {};
    return tags.reduce((acc, tag) => {
      if (tag.Key && tag.Value) {
        acc[tag.Key] = tag.Value;
      }
      return acc;
    }, {} as Record<string, string>);
  }

  function recordToTags(record?: Record<string, string>): Tag[] {
    if (!record) return [];
    return Object.entries(record).map(([Key, Value]) => ({ Key, Value }));
  }

  // Policy templates
  const policyTemplates: Record<PolicyTemplate, PolicyTemplateDefinition> = {
    'lambda-basic': {
      name: 'lambda-basic',
      description: 'Basic Lambda execution role with CloudWatch Logs',
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents',
            ],
            Resource: 'arn:aws:logs:*:*:*',
          },
        ],
      },
    },
    'lambda-vpc': {
      name: 'lambda-vpc',
      description: 'Lambda VPC execution with ENI management',
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents',
            ],
            Resource: 'arn:aws:logs:*:*:*',
          },
          {
            Effect: 'Allow',
            Action: [
              'ec2:CreateNetworkInterface',
              'ec2:DescribeNetworkInterfaces',
              'ec2:DeleteNetworkInterface',
              'ec2:AssignPrivateIpAddresses',
              'ec2:UnassignPrivateIpAddresses',
            ],
            Resource: '*',
          },
        ],
      },
    },
    'lambda-s3-read': {
      name: 'lambda-s3-read',
      description: 'Lambda with S3 read access',
      variables: ['BUCKET_NAME'],
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents',
            ],
            Resource: 'arn:aws:logs:*:*:*',
          },
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:ListBucket'],
            Resource: [
              'arn:aws:s3:::${BUCKET_NAME}',
              'arn:aws:s3:::${BUCKET_NAME}/*',
            ],
          },
        ],
      },
    },
    'lambda-s3-write': {
      name: 'lambda-s3-write',
      description: 'Lambda with S3 read/write access',
      variables: ['BUCKET_NAME'],
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents',
            ],
            Resource: 'arn:aws:logs:*:*:*',
          },
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
            Resource: [
              'arn:aws:s3:::${BUCKET_NAME}',
              'arn:aws:s3:::${BUCKET_NAME}/*',
            ],
          },
        ],
      },
    },
    'lambda-dynamodb': {
      name: 'lambda-dynamodb',
      description: 'Lambda with DynamoDB access',
      variables: ['TABLE_NAME'],
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents',
            ],
            Resource: 'arn:aws:logs:*:*:*',
          },
          {
            Effect: 'Allow',
            Action: [
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
              'dynamodb:Query',
              'dynamodb:Scan',
              'dynamodb:BatchGetItem',
              'dynamodb:BatchWriteItem',
            ],
            Resource: [
              'arn:aws:dynamodb:*:*:table/${TABLE_NAME}',
              'arn:aws:dynamodb:*:*:table/${TABLE_NAME}/index/*',
            ],
          },
        ],
      },
    },
    'lambda-sqs': {
      name: 'lambda-sqs',
      description: 'Lambda with SQS access',
      variables: ['QUEUE_ARN'],
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents',
            ],
            Resource: 'arn:aws:logs:*:*:*',
          },
          {
            Effect: 'Allow',
            Action: [
              'sqs:ReceiveMessage',
              'sqs:DeleteMessage',
              'sqs:GetQueueAttributes',
              'sqs:SendMessage',
            ],
            Resource: '${QUEUE_ARN}',
          },
        ],
      },
    },
    'lambda-sns': {
      name: 'lambda-sns',
      description: 'Lambda with SNS publish access',
      variables: ['TOPIC_ARN'],
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents',
            ],
            Resource: 'arn:aws:logs:*:*:*',
          },
          {
            Effect: 'Allow',
            Action: ['sns:Publish'],
            Resource: '${TOPIC_ARN}',
          },
        ],
      },
    },
    'ec2-ssm': {
      name: 'ec2-ssm',
      description: 'EC2 instance with SSM Session Manager access',
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'ssm:UpdateInstanceInformation',
              'ssmmessages:CreateControlChannel',
              'ssmmessages:CreateDataChannel',
              'ssmmessages:OpenControlChannel',
              'ssmmessages:OpenDataChannel',
            ],
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: ['s3:GetEncryptionConfiguration'],
            Resource: '*',
          },
        ],
      },
    },
    'ecs-task': {
      name: 'ecs-task',
      description: 'ECS task execution role',
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'ecr:GetAuthorizationToken',
              'ecr:BatchCheckLayerAvailability',
              'ecr:GetDownloadUrlForLayer',
              'ecr:BatchGetImage',
            ],
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: [
              'logs:CreateLogStream',
              'logs:PutLogEvents',
            ],
            Resource: '*',
          },
        ],
      },
    },
    'eks-node': {
      name: 'eks-node',
      description: 'EKS node group role',
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'ec2:DescribeInstances',
              'ec2:DescribeRouteTables',
              'ec2:DescribeSecurityGroups',
              'ec2:DescribeSubnets',
              'ec2:DescribeVolumes',
              'ec2:DescribeVolumesModifications',
              'ec2:DescribeVpcs',
              'eks:DescribeCluster',
            ],
            Resource: '*',
          },
        ],
      },
    },
    's3-read-only': {
      name: 's3-read-only',
      description: 'Read-only access to S3 bucket',
      variables: ['BUCKET_NAME'],
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:GetObjectVersion', 's3:ListBucket'],
            Resource: [
              'arn:aws:s3:::${BUCKET_NAME}',
              'arn:aws:s3:::${BUCKET_NAME}/*',
            ],
          },
        ],
      },
    },
    's3-full-access': {
      name: 's3-full-access',
      description: 'Full access to S3 bucket',
      variables: ['BUCKET_NAME'],
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:*'],
            Resource: [
              'arn:aws:s3:::${BUCKET_NAME}',
              'arn:aws:s3:::${BUCKET_NAME}/*',
            ],
          },
        ],
      },
    },
    'dynamodb-read-only': {
      name: 'dynamodb-read-only',
      description: 'Read-only access to DynamoDB table',
      variables: ['TABLE_NAME'],
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'dynamodb:GetItem',
              'dynamodb:Query',
              'dynamodb:Scan',
              'dynamodb:BatchGetItem',
              'dynamodb:DescribeTable',
            ],
            Resource: [
              'arn:aws:dynamodb:*:*:table/${TABLE_NAME}',
              'arn:aws:dynamodb:*:*:table/${TABLE_NAME}/index/*',
            ],
          },
        ],
      },
    },
    'dynamodb-full-access': {
      name: 'dynamodb-full-access',
      description: 'Full access to DynamoDB table',
      variables: ['TABLE_NAME'],
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['dynamodb:*'],
            Resource: [
              'arn:aws:dynamodb:*:*:table/${TABLE_NAME}',
              'arn:aws:dynamodb:*:*:table/${TABLE_NAME}/index/*',
            ],
          },
        ],
      },
    },
    'cloudwatch-logs': {
      name: 'cloudwatch-logs',
      description: 'CloudWatch Logs access',
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents',
              'logs:DescribeLogGroups',
              'logs:DescribeLogStreams',
            ],
            Resource: 'arn:aws:logs:*:*:*',
          },
        ],
      },
    },
    'xray-tracing': {
      name: 'xray-tracing',
      description: 'X-Ray tracing access',
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'xray:PutTraceSegments',
              'xray:PutTelemetryRecords',
              'xray:GetSamplingRules',
              'xray:GetSamplingTargets',
              'xray:GetSamplingStatisticSummaries',
            ],
            Resource: '*',
          },
        ],
      },
    },
    'secrets-read': {
      name: 'secrets-read',
      description: 'Read secrets from Secrets Manager',
      variables: ['SECRET_ARN'],
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
            Resource: '${SECRET_ARN}',
          },
        ],
      },
    },
    'kms-encrypt-decrypt': {
      name: 'kms-encrypt-decrypt',
      description: 'KMS encrypt/decrypt access',
      variables: ['KEY_ARN'],
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey', 'kms:DescribeKey'],
            Resource: '${KEY_ARN}',
          },
        ],
      },
    },
    'assume-role': {
      name: 'assume-role',
      description: 'Assume role in another account',
      variables: ['ROLE_ARN'],
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['sts:AssumeRole'],
            Resource: '${ROLE_ARN}',
          },
        ],
      },
    },
    'cross-account-access': {
      name: 'cross-account-access',
      description: 'Cross-account access pattern',
      variables: ['ACCOUNT_ID', 'ROLE_NAME'],
      document: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['sts:AssumeRole'],
            Resource: 'arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}',
          },
        ],
      },
    },
  };

  function substituteVariables(doc: PolicyDocument, variables?: Record<string, string>): PolicyDocument {
    if (!variables) return doc;
    let jsonStr = JSON.stringify(doc);
    for (const [key, value] of Object.entries(variables)) {
      jsonStr = jsonStr.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }
    return JSON.parse(jsonStr);
  }

  // Convert AWS SDK role to our type
  async function roleToInfo(role: Role, includeAttached = false, includeInline = false): Promise<IAMRoleInfo> {
    const iamClient = createIAMClient();
    
    let attachedPolicies: AttachedPolicy[] = [];
    let inlinePolicies: string[] = [];
    let tags: Record<string, string> = {};

    if (includeAttached) {
      try {
        const attachedResp = await iamClient.send(new ListAttachedRolePoliciesCommand({
          RoleName: role.RoleName,
        }));
        attachedPolicies = (attachedResp.AttachedPolicies || []).map(p => ({
          policyName: p.PolicyName!,
          policyArn: p.PolicyArn!,
        }));
      } catch {
        // Ignore errors
      }
    }

    if (includeInline) {
      try {
        const inlineResp = await iamClient.send(new ListRolePoliciesCommand({
          RoleName: role.RoleName,
        }));
        inlinePolicies = inlineResp.PolicyNames || [];
      } catch {
        // Ignore errors
      }
    }

    try {
      const tagsResp = await iamClient.send(new ListRoleTagsCommand({
        RoleName: role.RoleName,
      }));
      tags = tagsToRecord(tagsResp.Tags);
    } catch {
      // Ignore errors
    }

    return {
      roleName: role.RoleName!,
      roleId: role.RoleId!,
      arn: role.Arn!,
      path: role.Path!,
      description: role.Description,
      createDate: role.CreateDate!,
      maxSessionDuration: role.MaxSessionDuration || 3600,
      assumeRolePolicyDocument: decodeURIComponent(role.AssumeRolePolicyDocument || ''),
      tags,
      attachedPolicies,
      inlinePolicies,
      permissionsBoundary: role.PermissionsBoundary?.PermissionsBoundaryArn,
    };
  }

  // Convert AWS SDK user to our type
  async function userToInfo(
    user: User,
    includeAttached = false,
    includeInline = false,
    includeAccessKeys = false,
    includeMFA = false
  ): Promise<IAMUserInfo> {
    const iamClient = createIAMClient();
    
    let attachedPolicies: AttachedPolicy[] = [];
    let inlinePolicies: string[] = [];
    let groups: string[] = [];
    let accessKeys: AccessKeyInfo[] = [];
    let mfaDevices: MFADeviceInfo[] = [];
    let tags: Record<string, string> = {};

    if (includeAttached) {
      try {
        const attachedResp = await iamClient.send(new ListAttachedUserPoliciesCommand({
          UserName: user.UserName,
        }));
        attachedPolicies = (attachedResp.AttachedPolicies || []).map(p => ({
          policyName: p.PolicyName!,
          policyArn: p.PolicyArn!,
        }));
      } catch {
        // Ignore errors
      }
    }

    if (includeInline) {
      try {
        const inlineResp = await iamClient.send(new ListUserPoliciesCommand({
          UserName: user.UserName,
        }));
        inlinePolicies = inlineResp.PolicyNames || [];
      } catch {
        // Ignore errors
      }
    }

    try {
      const groupsResp = await iamClient.send(new ListGroupsForUserCommand({
        UserName: user.UserName,
      }));
      groups = (groupsResp.Groups || []).map(g => g.GroupName!);
    } catch {
      // Ignore errors
    }

    if (includeAccessKeys) {
      try {
        const keysResp = await iamClient.send(new ListAccessKeysCommand({
          UserName: user.UserName,
        }));
        for (const key of keysResp.AccessKeyMetadata || []) {
          const lastUsedResp = await iamClient.send(new GetAccessKeyLastUsedCommand({
            AccessKeyId: key.AccessKeyId,
          }));
          accessKeys.push({
            accessKeyId: key.AccessKeyId!,
            status: key.Status as 'Active' | 'Inactive',
            createDate: key.CreateDate!,
            lastUsedDate: lastUsedResp.AccessKeyLastUsed?.LastUsedDate,
            lastUsedService: lastUsedResp.AccessKeyLastUsed?.ServiceName,
            lastUsedRegion: lastUsedResp.AccessKeyLastUsed?.Region,
          });
        }
      } catch {
        // Ignore errors
      }
    }

    if (includeMFA) {
      try {
        const mfaResp = await iamClient.send(new ListMFADevicesCommand({
          UserName: user.UserName,
        }));
        mfaDevices = (mfaResp.MFADevices || []).map(d => ({
          serialNumber: d.SerialNumber!,
          enableDate: d.EnableDate!,
          type: d.SerialNumber!.includes('mfa/') ? 'virtual' as const : 'hardware' as const,
        }));
      } catch {
        // Ignore errors
      }
    }

    try {
      const tagsResp = await iamClient.send(new ListUserTagsCommand({
        UserName: user.UserName,
      }));
      tags = tagsToRecord(tagsResp.Tags);
    } catch {
      // Ignore errors
    }

    return {
      userName: user.UserName!,
      userId: user.UserId!,
      arn: user.Arn!,
      path: user.Path!,
      createDate: user.CreateDate!,
      passwordLastUsed: user.PasswordLastUsed,
      tags,
      attachedPolicies,
      inlinePolicies,
      groups,
      accessKeys,
      mfaDevices,
      permissionsBoundary: user.PermissionsBoundary?.PermissionsBoundaryArn,
    };
  }

  // Convert AWS SDK policy to our type
  async function policyToInfo(policy: Policy): Promise<IAMPolicyInfo> {
    const iamClient = createIAMClient();
    let tags: Record<string, string> = {};

    try {
      const tagsResp = await iamClient.send(new ListPolicyTagsCommand({
        PolicyArn: policy.Arn,
      }));
      tags = tagsToRecord(tagsResp.Tags);
    } catch {
      // Ignore errors
    }

    return {
      policyName: policy.PolicyName!,
      policyId: policy.PolicyId!,
      arn: policy.Arn!,
      path: policy.Path!,
      description: policy.Description,
      createDate: policy.CreateDate!,
      updateDate: policy.UpdateDate!,
      defaultVersionId: policy.DefaultVersionId!,
      attachmentCount: policy.AttachmentCount || 0,
      permissionsBoundaryUsageCount: policy.PermissionsBoundaryUsageCount || 0,
      isAttachable: policy.IsAttachable || false,
      tags,
    };
  }

  // Convert Security Hub finding to our type
  function securityHubFindingToInfo(finding: AwsSecurityFinding, region: string): SecurityFinding {
    return {
      id: finding.Id!,
      productArn: finding.ProductArn!,
      generatorId: finding.GeneratorId!,
      awsAccountId: finding.AwsAccountId!,
      title: finding.Title!,
      description: finding.Description!,
      severity: {
        label: finding.Severity?.Label as SecurityFinding['severity']['label'],
        normalized: finding.Severity?.Normalized || 0,
      },
      confidence: finding.Confidence,
      criticality: finding.Criticality,
      types: finding.Types || [],
      firstObservedAt: finding.FirstObservedAt ? new Date(finding.FirstObservedAt) : undefined,
      lastObservedAt: finding.LastObservedAt ? new Date(finding.LastObservedAt) : undefined,
      createdAt: new Date(finding.CreatedAt!),
      updatedAt: new Date(finding.UpdatedAt!),
      resources: (finding.Resources || []).map((r) => ({
        type: r.Type!,
        id: r.Id!,
        partition: r.Partition!,
        region: r.Region!,
        tags: r.Tags,
        details: r.Details as Record<string, unknown>,
      })),
      compliance: finding.Compliance ? {
        status: finding.Compliance.Status as ComplianceStatus,
        relatedRequirements: finding.Compliance.RelatedRequirements,
      } : undefined,
      workflow: finding.Workflow ? {
        status: finding.Workflow.Status as WorkflowStatus,
      } : undefined,
      recordState: finding.RecordState as 'ACTIVE' | 'ARCHIVED',
      remediation: finding.Remediation ? {
        recommendation: finding.Remediation.Recommendation ? {
          text: finding.Remediation.Recommendation.Text,
          url: finding.Remediation.Recommendation.Url,
        } : undefined,
      } : undefined,
      productFields: finding.ProductFields,
      region,
    };
  }

  // Convert GuardDuty finding to our type
  function guardDutyFindingToInfo(finding: Finding, region: string): GuardDutyFinding {
    return {
      id: finding.Id!,
      accountId: finding.AccountId!,
      arn: finding.Arn!,
      type: finding.Type!,
      title: finding.Title!,
      description: finding.Description!,
      severity: finding.Severity || 0,
      severityLabel: finding.Severity! >= 7 ? 'High' : finding.Severity! >= 4 ? 'Medium' : 'Low',
      confidence: finding.Confidence || 0,
      createdAt: new Date(finding.CreatedAt!),
      updatedAt: new Date(finding.UpdatedAt!),
      region,
      resourceType: finding.Resource?.ResourceType || 'Unknown',
      resource: {
        resourceType: finding.Resource?.ResourceType || 'Unknown',
        instanceDetails: finding.Resource?.InstanceDetails ? {
          instanceId: finding.Resource.InstanceDetails.InstanceId,
          instanceType: finding.Resource.InstanceDetails.InstanceType,
          launchTime: finding.Resource.InstanceDetails.LaunchTime ? new Date(finding.Resource.InstanceDetails.LaunchTime) : undefined,
          platform: finding.Resource.InstanceDetails.Platform,
          availabilityZone: finding.Resource.InstanceDetails.AvailabilityZone,
          imageId: finding.Resource.InstanceDetails.ImageId,
          imageDescription: finding.Resource.InstanceDetails.ImageDescription,
          networkInterfaces: finding.Resource.InstanceDetails.NetworkInterfaces?.map((ni) => ({
            networkInterfaceId: ni.NetworkInterfaceId,
            privateDnsName: ni.PrivateDnsName,
            privateIpAddress: ni.PrivateIpAddress,
            publicDnsName: ni.PublicDnsName,
            publicIp: ni.PublicIp,
            securityGroups: ni.SecurityGroups?.map((sg) => ({ groupId: sg.GroupId, groupName: sg.GroupName })),
            subnetId: ni.SubnetId,
            vpcId: ni.VpcId,
          })),
          tags: finding.Resource.InstanceDetails.Tags?.map((t) => ({ key: t.Key!, value: t.Value! })),
        } : undefined,
        accessKeyDetails: finding.Resource?.AccessKeyDetails ? {
          accessKeyId: finding.Resource.AccessKeyDetails.AccessKeyId,
          principalId: finding.Resource.AccessKeyDetails.PrincipalId,
          userName: finding.Resource.AccessKeyDetails.UserName,
          userType: finding.Resource.AccessKeyDetails.UserType,
        } : undefined,
        s3BucketDetails: finding.Resource?.S3BucketDetails?.map((s3) => ({
          arn: s3.Arn,
          name: s3.Name,
          type: s3.Type,
          createdAt: s3.CreatedAt ? new Date(s3.CreatedAt) : undefined,
          owner: s3.Owner ? { id: s3.Owner.Id } : undefined,
          tags: s3.Tags?.map((t) => ({ key: t.Key!, value: t.Value! })),
          publicAccess: s3.PublicAccess ? {
            permissionConfiguration: s3.PublicAccess.PermissionConfiguration,
            effectivePermission: s3.PublicAccess.EffectivePermission,
          } : undefined,
        })),
      },
      service: {
        action: finding.Service?.Action ? {
          actionType: finding.Service.Action.ActionType,
          awsApiCallAction: finding.Service.Action.AwsApiCallAction ? {
            api: finding.Service.Action.AwsApiCallAction.Api,
            serviceName: finding.Service.Action.AwsApiCallAction.ServiceName,
            callerType: finding.Service.Action.AwsApiCallAction.CallerType,
            remoteIpDetails: finding.Service.Action.AwsApiCallAction.RemoteIpDetails ? {
              ipAddressV4: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.IpAddressV4,
              organization: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.Organization ? {
                asn: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.Organization.Asn,
                asnOrg: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.Organization.AsnOrg,
                isp: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.Organization.Isp,
                org: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.Organization.Org,
              } : undefined,
              country: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.Country ? {
                countryCode: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.Country.CountryCode,
                countryName: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.Country.CountryName,
              } : undefined,
              city: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.City ? {
                cityName: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.City.CityName,
              } : undefined,
              geoLocation: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.GeoLocation ? {
                lat: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.GeoLocation.Lat,
                lon: finding.Service.Action.AwsApiCallAction.RemoteIpDetails.GeoLocation.Lon,
              } : undefined,
            } : undefined,
            errorCode: finding.Service.Action.AwsApiCallAction.ErrorCode,
          } : undefined,
          networkConnectionAction: finding.Service.Action.NetworkConnectionAction ? {
            connectionDirection: finding.Service.Action.NetworkConnectionAction.ConnectionDirection,
            protocol: finding.Service.Action.NetworkConnectionAction.Protocol,
            localPortDetails: finding.Service.Action.NetworkConnectionAction.LocalPortDetails ? {
              port: finding.Service.Action.NetworkConnectionAction.LocalPortDetails.Port,
              portName: finding.Service.Action.NetworkConnectionAction.LocalPortDetails.PortName,
            } : undefined,
            remotePortDetails: finding.Service.Action.NetworkConnectionAction.RemotePortDetails ? {
              port: finding.Service.Action.NetworkConnectionAction.RemotePortDetails.Port,
              portName: finding.Service.Action.NetworkConnectionAction.RemotePortDetails.PortName,
            } : undefined,
            blocked: finding.Service.Action.NetworkConnectionAction.Blocked,
          } : undefined,
          dnsRequestAction: finding.Service.Action.DnsRequestAction ? {
            domain: finding.Service.Action.DnsRequestAction.Domain,
            protocol: finding.Service.Action.DnsRequestAction.Protocol,
            blocked: finding.Service.Action.DnsRequestAction.Blocked,
          } : undefined,
        } : undefined,
        evidence: finding.Service?.Evidence ? {
          threatIntelligenceDetails: finding.Service.Evidence.ThreatIntelligenceDetails?.map((ti) => ({
            threatListName: ti.ThreatListName,
            threatNames: ti.ThreatNames,
          })),
        } : undefined,
        archived: finding.Service?.Archived,
        count: finding.Service?.Count,
        detectorId: finding.Service?.DetectorId,
        eventFirstSeen: finding.Service?.EventFirstSeen,
        eventLastSeen: finding.Service?.EventLastSeen,
        resourceRole: finding.Service?.ResourceRole,
        serviceName: finding.Service?.ServiceName,
        userFeedback: finding.Service?.UserFeedback,
        additionalInfo: finding.Service?.AdditionalInfo,
      },
    };
  }

  // Convert KMS key to our type
  async function kmsKeyToInfo(
    keyId: string,
    region: string,
    includeAliases = false,
    includeTags = false,
    includePolicy = false,
    includeRotation = false
  ): Promise<KMSKeyInfo> {
    const kmsClient = createKMSClient(region);
    
    const keyResp = await kmsClient.send(new DescribeKeyCommand({ KeyId: keyId }));
    const metadata = keyResp.KeyMetadata!;
    
    let aliases: string[] = [];
    let tags: Record<string, string> = {};
    let policy: string | undefined;
    let rotationEnabled: boolean | undefined;

    if (includeAliases) {
      try {
        const aliasResp = await kmsClient.send(new ListAliasesCommand({ KeyId: keyId }));
        aliases = (aliasResp.Aliases || []).map((a) => a.AliasName!);
      } catch {
        // Ignore errors
      }
    }

    if (includeTags) {
      try {
        const tagsResp = await kmsClient.send(new ListResourceTagsCommand({ KeyId: keyId }));
        tags = (tagsResp.Tags || []).reduce((acc: Record<string, string>, t) => {
          if (t.TagKey && t.TagValue) acc[t.TagKey] = t.TagValue;
          return acc;
        }, {} as Record<string, string>);
      } catch {
        // Ignore errors
      }
    }

    if (includePolicy) {
      try {
        const policyResp = await kmsClient.send(new GetKeyPolicyCommand({ KeyId: keyId, PolicyName: 'default' }));
        policy = policyResp.Policy;
      } catch {
        // Ignore errors
      }
    }

    if (includeRotation && metadata.KeySpec === 'SYMMETRIC_DEFAULT') {
      try {
        const rotationResp = await kmsClient.send(new GetKeyRotationStatusCommand({ KeyId: keyId }));
        rotationEnabled = rotationResp.KeyRotationEnabled;
      } catch {
        // Ignore errors
      }
    }

    return {
      keyId: metadata.KeyId!,
      arn: metadata.Arn!,
      description: metadata.Description,
      keyState: metadata.KeyState as KMSKeyInfo['keyState'],
      keyUsage: metadata.KeyUsage as KMSKeyInfo['keyUsage'],
      keySpec: metadata.KeySpec as KMSKeyInfo['keySpec'],
      origin: metadata.Origin as KMSKeyInfo['origin'],
      creationDate: metadata.CreationDate!,
      enabled: metadata.Enabled || false,
      deletionDate: metadata.DeletionDate,
      keyManager: metadata.KeyManager as 'AWS' | 'CUSTOMER',
      encryptionAlgorithms: metadata.EncryptionAlgorithms,
      signingAlgorithms: metadata.SigningAlgorithms,
      multiRegion: metadata.MultiRegion || false,
      multiRegionConfiguration: metadata.MultiRegionConfiguration ? {
        multiRegionKeyType: metadata.MultiRegionConfiguration.MultiRegionKeyType as 'PRIMARY' | 'REPLICA',
        primaryKey: metadata.MultiRegionConfiguration.PrimaryKey ? {
          arn: metadata.MultiRegionConfiguration.PrimaryKey.Arn!,
          region: metadata.MultiRegionConfiguration.PrimaryKey.Region!,
        } : undefined,
        replicaKeys: metadata.MultiRegionConfiguration.ReplicaKeys?.map((r) => ({
          arn: r.Arn!,
          region: r.Region!,
        })),
      } : undefined,
      pendingDeletionWindowInDays: metadata.PendingDeletionWindowInDays,
      macAlgorithms: metadata.MacAlgorithms,
      aliases,
      tags,
      rotationEnabled,
      policy,
      region,
    };
  }

  // Convert secret to our type
  function secretToInfo(secret: SecretListEntry, region: string): SecretInfo {
    return {
      arn: secret.ARN!,
      name: secret.Name!,
      description: secret.Description,
      kmsKeyId: secret.KmsKeyId,
      rotationEnabled: secret.RotationEnabled || false,
      rotationLambdaArn: secret.RotationLambdaARN,
      rotationRules: secret.RotationRules ? {
        automaticallyAfterDays: secret.RotationRules.AutomaticallyAfterDays,
        scheduleExpression: secret.RotationRules.ScheduleExpression,
      } : undefined,
      lastRotatedDate: secret.LastRotatedDate,
      lastChangedDate: secret.LastChangedDate,
      lastAccessedDate: secret.LastAccessedDate,
      deletedDate: secret.DeletedDate,
      createdDate: secret.CreatedDate!,
      primaryRegion: secret.PrimaryRegion,
      tags: (secret.Tags || []).reduce((acc: Record<string, string>, t) => {
        if (t.Key && t.Value) acc[t.Key] = t.Value;
        return acc;
      }, {} as Record<string, string>),
      owningService: secret.OwningService,
      region,
    };
  }

  // Convert Access Analyzer to our type
  function analyzerToInfo(analyzer: AnalyzerSummary, region: string): AccessAnalyzerInfo {
    return {
      analyzerArn: analyzer.arn!,
      analyzerName: analyzer.name!,
      type: analyzer.type as 'ACCOUNT' | 'ORGANIZATION',
      createdAt: analyzer.createdAt!,
      lastResourceAnalyzed: analyzer.lastResourceAnalyzed,
      lastResourceAnalyzedAt: analyzer.lastResourceAnalyzedAt,
      status: analyzer.status as AccessAnalyzerInfo['status'],
      statusReason: analyzer.statusReason?.code,
      tags: analyzer.tags || {},
      region,
    };
  }

  // Convert Access Analyzer finding to our type
  function accessAnalyzerFindingToInfo(finding: FindingSummary, region: string, analyzerArn?: string): AccessAnalyzerFinding {
    return {
      id: finding.id!,
      analyzerArn: analyzerArn || '',
      analyzedAt: finding.analyzedAt!,
      createdAt: finding.createdAt!,
      updatedAt: finding.updatedAt!,
      status: finding.status as AccessAnalyzerFinding['status'],
      resourceType: finding.resourceType as AccessAnalyzerFinding['resourceType'],
      resource: finding.resource!,
      resourceOwnerAccount: finding.resourceOwnerAccount!,
      isPublic: finding.isPublic || false,
      principal: finding.principal,
      action: finding.action,
      condition: finding.condition as AccessAnalyzerFinding['condition'],
      error: finding.error,
      sources: finding.sources?.map((s) => ({
        type: s.type as 'POLICY' | 'BUCKET_ACL' | 'S3_ACCESS_POINT' | 'S3_ACCESS_POINT_ACCOUNT',
        detail: s.detail ? {
          accessPointArn: s.detail.accessPointArn,
          accessPointAccount: s.detail.accessPointAccount,
        } : undefined,
      })),
      region,
    };
  }

  return {
    // IAM Role operations
    async listRoles(options: ListRolesOptions = {}): Promise<SecurityOperationResult<IAMRoleInfo[]>> {
      try {
        const iamClient = createIAMClient();
        const response = await iamClient.send(new ListRolesCommand({
          PathPrefix: options.pathPrefix,
          MaxItems: options.maxItems,
        }));

        const roles: IAMRoleInfo[] = [];
        for (const role of response.Roles || []) {
          const roleInfo = await roleToInfo(
            role,
            options.includeAttachedPolicies,
            options.includeInlinePolicies
          );
          
          // Filter by tag if specified
          if (options.tag) {
            if (roleInfo.tags[options.tag.key] !== options.tag.value) continue;
          }
          
          roles.push(roleInfo);
        }

        return {
          success: true,
          data: roles,
          message: `Found ${roles.length} IAM roles`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to list IAM roles',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getRole(roleName: string): Promise<SecurityOperationResult<IAMRoleInfo>> {
      try {
        const iamClient = createIAMClient();
        const response = await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
        const roleInfo = await roleToInfo(response.Role!, true, true);

        return {
          success: true,
          data: roleInfo,
          message: `Retrieved role ${roleName}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to get IAM role ${roleName}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async createRole(options: CreateRoleOptions): Promise<SecurityOperationResult<IAMRoleInfo>> {
      try {
        const iamClient = createIAMClient();
        
        const response = await iamClient.send(new CreateRoleCommand({
          RoleName: options.roleName,
          AssumeRolePolicyDocument: JSON.stringify(options.trustPolicy),
          Description: options.description,
          Path: options.path,
          MaxSessionDuration: options.maxSessionDuration,
          PermissionsBoundary: options.permissionsBoundary,
          Tags: recordToTags(options.tags),
        }));

        // Attach managed policies
        if (options.managedPolicyArns) {
          for (const policyArn of options.managedPolicyArns) {
            await iamClient.send(new AttachRolePolicyCommand({
              RoleName: options.roleName,
              PolicyArn: policyArn,
            }));
          }
        }

        // Create inline policies
        if (options.inlinePolicies) {
          for (const policy of options.inlinePolicies) {
            await iamClient.send(new PutRolePolicyCommand({
              RoleName: options.roleName,
              PolicyName: policy.name,
              PolicyDocument: JSON.stringify(policy.document),
            }));
          }
        }

        const roleInfo = await roleToInfo(response.Role!, true, true);

        return {
          success: true,
          data: roleInfo,
          message: `Created IAM role ${options.roleName}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create IAM role ${options.roleName}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async deleteRole(roleName: string): Promise<SecurityOperationResult<void>> {
      try {
        const iamClient = createIAMClient();
        
        // Detach all managed policies first
        const attachedResp = await iamClient.send(new ListAttachedRolePoliciesCommand({
          RoleName: roleName,
        }));
        for (const policy of attachedResp.AttachedPolicies || []) {
          await iamClient.send(new DetachRolePolicyCommand({
            RoleName: roleName,
            PolicyArn: policy.PolicyArn,
          }));
        }

        // Delete inline policies
        const inlineResp = await iamClient.send(new ListRolePoliciesCommand({
          RoleName: roleName,
        }));
        for (const policyName of inlineResp.PolicyNames || []) {
          await iamClient.send(new DeleteRolePolicyCommand({
            RoleName: roleName,
            PolicyName: policyName,
          }));
        }

        // Delete the role
        await iamClient.send(new DeleteRoleCommand({ RoleName: roleName }));

        return {
          success: true,
          message: `Deleted IAM role ${roleName}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to delete IAM role ${roleName}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async attachRolePolicy(roleName: string, policyArn: string): Promise<SecurityOperationResult<void>> {
      try {
        const iamClient = createIAMClient();
        await iamClient.send(new AttachRolePolicyCommand({
          RoleName: roleName,
          PolicyArn: policyArn,
        }));

        return {
          success: true,
          message: `Attached policy ${policyArn} to role ${roleName}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to attach policy to role ${roleName}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async detachRolePolicy(roleName: string, policyArn: string): Promise<SecurityOperationResult<void>> {
      try {
        const iamClient = createIAMClient();
        await iamClient.send(new DetachRolePolicyCommand({
          RoleName: roleName,
          PolicyArn: policyArn,
        }));

        return {
          success: true,
          message: `Detached policy ${policyArn} from role ${roleName}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to detach policy from role ${roleName}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    // IAM User operations
    async listUsers(options: ListUsersOptions = {}): Promise<SecurityOperationResult<IAMUserInfo[]>> {
      try {
        const iamClient = createIAMClient();
        const response = await iamClient.send(new ListUsersCommand({
          PathPrefix: options.pathPrefix,
          MaxItems: options.maxItems,
        }));

        const users: IAMUserInfo[] = [];
        for (const user of response.Users || []) {
          const userInfo = await userToInfo(
            user,
            options.includeAttachedPolicies,
            options.includeInlinePolicies,
            options.includeAccessKeys,
            options.includeMFADevices
          );
          users.push(userInfo);
        }

        return {
          success: true,
          data: users,
          message: `Found ${users.length} IAM users`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to list IAM users',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getUser(userName: string): Promise<SecurityOperationResult<IAMUserInfo>> {
      try {
        const iamClient = createIAMClient();
        const response = await iamClient.send(new GetUserCommand({ UserName: userName }));
        const userInfo = await userToInfo(response.User!, true, true, true, true);

        return {
          success: true,
          data: userInfo,
          message: `Retrieved user ${userName}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to get IAM user ${userName}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async createUser(options: CreateUserOptions): Promise<SecurityOperationResult<CreateUserResult>> {
      try {
        const iamClient = createIAMClient();
        
        const response = await iamClient.send(new CreateUserCommand({
          UserName: options.userName,
          Path: options.path,
          PermissionsBoundary: options.permissionsBoundary,
          Tags: recordToTags(options.tags),
        }));

        const result: CreateUserResult = {
          user: await userToInfo(response.User!, false, false, false, false),
        };

        // Create access key if requested
        if (options.createAccessKey) {
          const keyResp = await iamClient.send(new CreateAccessKeyCommand({
            UserName: options.userName,
          }));
          result.accessKey = {
            accessKeyId: keyResp.AccessKey!.AccessKeyId!,
            secretAccessKey: keyResp.AccessKey!.SecretAccessKey!,
          };
        }

        // Create login profile if requested
        if (options.createLoginProfile) {
          const password = generateSecurePassword();
          await iamClient.send(new CreateLoginProfileCommand({
            UserName: options.userName,
            Password: password,
            PasswordResetRequired: options.passwordResetRequired ?? true,
          }));
          result.loginProfile = {
            password,
            passwordResetRequired: options.passwordResetRequired ?? true,
          };
        }

        return {
          success: true,
          data: result,
          message: `Created IAM user ${options.userName}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create IAM user ${options.userName}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async deleteUser(userName: string): Promise<SecurityOperationResult<void>> {
      try {
        const iamClient = createIAMClient();
        
        // Delete access keys
        const keysResp = await iamClient.send(new ListAccessKeysCommand({ UserName: userName }));
        for (const key of keysResp.AccessKeyMetadata || []) {
          await iamClient.send(new DeleteAccessKeyCommand({
            UserName: userName,
            AccessKeyId: key.AccessKeyId,
          }));
        }

        // Detach managed policies
        const attachedResp = await iamClient.send(new ListAttachedUserPoliciesCommand({
          UserName: userName,
        }));
        for (const policy of attachedResp.AttachedPolicies || []) {
          await iamClient.send(new DetachUserPolicyCommand({
            UserName: userName,
            PolicyArn: policy.PolicyArn,
          }));
        }

        // Delete the user
        await iamClient.send(new DeleteUserCommand({ UserName: userName }));

        return {
          success: true,
          message: `Deleted IAM user ${userName}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to delete IAM user ${userName}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    // IAM Policy operations
    async listPolicies(options: ListPoliciesOptions = {}): Promise<SecurityOperationResult<IAMPolicyInfo[]>> {
      try {
        const iamClient = createIAMClient();
        const response = await iamClient.send(new ListPoliciesCommand({
          Scope: options.scope,
          OnlyAttached: options.onlyAttached,
          PathPrefix: options.pathPrefix,
          PolicyUsageFilter: options.policyUsageFilter,
          MaxItems: options.maxItems,
        }));

        const policies: IAMPolicyInfo[] = [];
        for (const policy of response.Policies || []) {
          const policyInfo = await policyToInfo(policy);
          policies.push(policyInfo);
        }

        return {
          success: true,
          data: policies,
          message: `Found ${policies.length} IAM policies`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to list IAM policies',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getPolicy(policyArn: string): Promise<SecurityOperationResult<IAMPolicyInfo & { document: PolicyDocument }>> {
      try {
        const iamClient = createIAMClient();
        const response = await iamClient.send(new GetPolicyCommand({ PolicyArn: policyArn }));
        const policyInfo = await policyToInfo(response.Policy!);

        // Get policy document
        const versionResp = await iamClient.send(new GetPolicyVersionCommand({
          PolicyArn: policyArn,
          VersionId: policyInfo.defaultVersionId,
        }));
        const document = JSON.parse(decodeURIComponent(versionResp.PolicyVersion?.Document || '{}'));

        return {
          success: true,
          data: { ...policyInfo, document },
          message: `Retrieved policy ${policyArn}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to get IAM policy ${policyArn}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async createPolicy(options: CreatePolicyOptions): Promise<SecurityOperationResult<IAMPolicyInfo>> {
      try {
        const iamClient = createIAMClient();
        const response = await iamClient.send(new CreatePolicyCommand({
          PolicyName: options.policyName,
          PolicyDocument: JSON.stringify(options.policyDocument),
          Description: options.description,
          Path: options.path,
          Tags: recordToTags(options.tags),
        }));

        const policyInfo = await policyToInfo(response.Policy!);

        return {
          success: true,
          data: policyInfo,
          message: `Created IAM policy ${options.policyName}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create IAM policy ${options.policyName}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async deletePolicy(policyArn: string): Promise<SecurityOperationResult<void>> {
      try {
        const iamClient = createIAMClient();
        await iamClient.send(new DeletePolicyCommand({ PolicyArn: policyArn }));

        return {
          success: true,
          message: `Deleted IAM policy ${policyArn}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to delete IAM policy ${policyArn}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    // Policy simulation
    async simulatePolicy(options: SimulatePolicyOptions): Promise<SecurityOperationResult<PolicySimulationResult[]>> {
      try {
        const iamClient = createIAMClient();
        
        let response;
        if (options.policySourceArn) {
          response = await iamClient.send(new SimulatePrincipalPolicyCommand({
            PolicySourceArn: options.policySourceArn,
            ActionNames: options.actionNames,
            ResourceArns: options.resourceArns,
            ResourcePolicy: options.resourcePolicy,
            ResourceOwner: options.resourceOwner,
            CallerArn: options.callerArn,
            ContextEntries: options.contextEntries?.map(e => ({
              ContextKeyName: e.contextKeyName,
              ContextKeyValues: e.contextKeyValues,
              ContextKeyType: e.contextKeyType,
            })),
            ResourceHandlingOption: options.resourceHandlingOption,
          }));
        } else {
          response = await iamClient.send(new SimulateCustomPolicyCommand({
            PolicyInputList: options.policyInputList || [],
            PermissionsBoundaryPolicyInputList: options.permissionsBoundaryPolicyInputList,
            ActionNames: options.actionNames,
            ResourceArns: options.resourceArns,
            ResourcePolicy: options.resourcePolicy,
            ResourceOwner: options.resourceOwner,
            CallerArn: options.callerArn,
            ContextEntries: options.contextEntries?.map(e => ({
              ContextKeyName: e.contextKeyName,
              ContextKeyValues: e.contextKeyValues,
              ContextKeyType: e.contextKeyType,
            })),
            ResourceHandlingOption: options.resourceHandlingOption,
          }));
        }

        const results: PolicySimulationResult[] = (response.EvaluationResults || []).map(r => ({
          evalActionName: r.EvalActionName!,
          evalResourceName: r.EvalResourceName,
          evalDecision: r.EvalDecision as 'allowed' | 'explicitDeny' | 'implicitDeny',
          matchedStatements: (r.MatchedStatements || []).map(s => ({
            sourcePolicyId: s.SourcePolicyId,
            sourcePolicyType: s.SourcePolicyType,
            startPosition: s.StartPosition ? { line: s.StartPosition.Line || 0, column: s.StartPosition.Column || 0 } : undefined,
            endPosition: s.EndPosition ? { line: s.EndPosition.Line || 0, column: s.EndPosition.Column || 0 } : undefined,
          })),
          missingContextValues: r.MissingContextValues || [],
          organizationsDecisionDetail: r.OrganizationsDecisionDetail ? {
            allowedByOrganizations: r.OrganizationsDecisionDetail.AllowedByOrganizations,
          } : undefined,
          permissionsBoundaryDecisionDetail: r.PermissionsBoundaryDecisionDetail ? {
            allowedByPermissionsBoundary: r.PermissionsBoundaryDecisionDetail.AllowedByPermissionsBoundary,
          } : undefined,
          evalDecisionDetails: r.EvalDecisionDetails as Record<string, string>,
        }));

        return {
          success: true,
          data: results,
          message: `Simulated ${options.actionNames.length} actions`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to simulate policy',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    // Policy templates
    getPolicyTemplate(template: PolicyTemplate, variables?: Record<string, string>): PolicyDocument {
      const templateDef = policyTemplates[template];
      if (!templateDef) {
        throw new Error(`Unknown policy template: ${template}`);
      }
      return substituteVariables(templateDef.document, variables);
    },

    // Security Hub operations
    async listSecurityFindings(options: ListSecurityFindingsOptions = {}): Promise<SecurityOperationResult<SecurityFinding[]>> {
      try {
        const region = options.region || defaultRegion;
        const client = createSecurityHubClient(region);

        const filters: Record<string, unknown> = {};
        if (options.severities?.length) {
          filters.SeverityLabel = options.severities.map(s => ({ Value: s, Comparison: 'EQUALS' }));
        }
        if (options.resourceTypes?.length) {
          filters.ResourceType = options.resourceTypes.map(t => ({ Value: t, Comparison: 'EQUALS' }));
        }
        if (options.complianceStatus) {
          filters.ComplianceStatus = [{ Value: options.complianceStatus, Comparison: 'EQUALS' }];
        }
        if (options.recordState) {
          filters.RecordState = [{ Value: options.recordState, Comparison: 'EQUALS' }];
        }
        if (options.productArn) {
          filters.ProductArn = [{ Value: options.productArn, Comparison: 'EQUALS' }];
        }

        const sortCriteria = options.sortField ? [{
          Field: options.sortField,
          SortOrder: (options.sortOrder === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
        }] : undefined;

        const response = await client.send(new GetFindingsCommand({
          Filters: Object.keys(filters).length > 0 ? filters as any : undefined,
          SortCriteria: sortCriteria,
          MaxResults: options.maxResults || 100,
        }));

        const findings = (response.Findings || []).map((f) => securityHubFindingToInfo(f, region));

        return {
          success: true,
          data: findings,
          message: `Found ${findings.length} Security Hub findings`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to list Security Hub findings',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async updateSecurityFindings(findingIds: string[], workflow: { status: string }, region?: string): Promise<SecurityOperationResult<void>> {
      try {
        const client = createSecurityHubClient(region);
        await client.send(new BatchUpdateFindingsCommand({
          FindingIdentifiers: findingIds.map(id => ({
            Id: id,
            ProductArn: `arn:aws:securityhub:${region || defaultRegion}::product/aws/securityhub`,
          })),
          Workflow: { Status: workflow.status as 'NEW' | 'NOTIFIED' | 'RESOLVED' | 'SUPPRESSED' },
        }));

        return {
          success: true,
          message: `Updated ${findingIds.length} Security Hub findings`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to update Security Hub findings',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async enableSecurityHub(region?: string): Promise<SecurityOperationResult<void>> {
      try {
        const client = createSecurityHubClient(region);
        await client.send(new EnableSecurityHubCommand({
          EnableDefaultStandards: true,
        }));

        return {
          success: true,
          message: 'Security Hub enabled',
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to enable Security Hub',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async disableSecurityHub(region?: string): Promise<SecurityOperationResult<void>> {
      try {
        const client = createSecurityHubClient(region);
        await client.send(new DisableSecurityHubCommand({}));

        return {
          success: true,
          message: 'Security Hub disabled',
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to disable Security Hub',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async listSecurityStandards(region?: string): Promise<SecurityOperationResult<SecurityStandard[]>> {
      try {
        const client = createSecurityHubClient(region);
        
        // Get all available standards
        const standardsResp = await client.send(new DescribeStandardsCommand({}));
        
        // Get enabled standards
        const enabledResp = await client.send(new GetEnabledStandardsCommand({}));
        const enabledArns = new Set((enabledResp.StandardsSubscriptions || []).map((s) => s.StandardsArn));

        const standards: SecurityStandard[] = (standardsResp.Standards || []).map((s) => ({
          standardsArn: s.StandardsArn!,
          name: s.Name!,
          description: s.Description,
          enabledByDefault: s.EnabledByDefault || false,
          enabled: enabledArns.has(s.StandardsArn!),
        }));

        return {
          success: true,
          data: standards,
          message: `Found ${standards.length} security standards`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to list security standards',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async enableSecurityStandard(standardArn: string, region?: string): Promise<SecurityOperationResult<void>> {
      try {
        const client = createSecurityHubClient(region);
        await client.send(new BatchEnableStandardsCommand({
          StandardsSubscriptionRequests: [{ StandardsArn: standardArn }],
        }));

        return {
          success: true,
          message: `Enabled security standard ${standardArn}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to enable security standard ${standardArn}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    // GuardDuty operations
    async listGuardDutyFindings(options: ListGuardDutyFindingsOptions = {}): Promise<SecurityOperationResult<GuardDutyFinding[]>> {
      try {
        const region = options.region || defaultRegion;
        const client = createGuardDutyClient(region);

        // Get detector ID
        let detectorId = options.detectorId;
        if (!detectorId) {
          const detectorsResp = await client.send(new ListDetectorsCommand({}));
          detectorId = detectorsResp.DetectorIds?.[0];
          if (!detectorId) {
            return {
              success: false,
              message: 'No GuardDuty detector found',
              error: 'GuardDuty is not enabled in this region',
            };
          }
        }

        // Build finding criteria
        const criterion: Record<string, unknown> = {};
        if (options.severities?.length) {
          const severityValues = options.severities.map(s => 
            s === 'High' ? 7 : s === 'Medium' ? 4 : 1
          );
          criterion.severity = { Gte: Math.min(...severityValues) };
        }
        if (options.types?.length) {
          criterion.type = { Eq: options.types };
        }
        if (options.archived !== undefined) {
          criterion['service.archived'] = { Eq: [String(options.archived)] };
        }

        // Get finding IDs
        const listResp = await client.send(new ListFindingsCommand({
          DetectorId: detectorId,
          FindingCriteria: Object.keys(criterion).length > 0 ? { Criterion: criterion as any } : undefined,
          SortCriteria: options.sortBy ? {
            AttributeName: options.sortBy === 'Severity' ? 'severity' : options.sortBy === 'CreatedAt' ? 'createdAt' : 'updatedAt',
            OrderBy: options.sortOrder || 'DESC',
          } : undefined,
          MaxResults: options.maxResults || 50,
        }));

        if (!listResp.FindingIds?.length) {
          return {
            success: true,
            data: [],
            message: 'No GuardDuty findings found',
          };
        }

        // Get finding details
        const findingsResp = await client.send(new GetGuardDutyFindingsCommand({
          DetectorId: detectorId,
          FindingIds: listResp.FindingIds,
        }));

        const findings = (findingsResp.Findings || []).map((f) => guardDutyFindingToInfo(f, region));

        return {
          success: true,
          data: findings,
          message: `Found ${findings.length} GuardDuty findings`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to list GuardDuty findings',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getGuardDutyDetector(detectorId?: string, region?: string): Promise<SecurityOperationResult<GuardDutyDetector>> {
      try {
        const targetRegion = region || defaultRegion;
        const client = createGuardDutyClient(targetRegion);

        // Get detector ID if not provided
        if (!detectorId) {
          const detectorsResp = await client.send(new ListDetectorsCommand({}));
          detectorId = detectorsResp.DetectorIds?.[0];
          if (!detectorId) {
            return {
              success: false,
              message: 'No GuardDuty detector found',
              error: 'GuardDuty is not enabled in this region',
            };
          }
        }

        const response = await client.send(new GetDetectorCommand({
          DetectorId: detectorId,
        }));

        const detector: GuardDutyDetector = {
          detectorId,
          status: response.Status as 'ENABLED' | 'DISABLED',
          createdAt: new Date(response.CreatedAt!),
          updatedAt: new Date(response.UpdatedAt!),
          findingPublishingFrequency: response.FindingPublishingFrequency as GuardDutyDetector['findingPublishingFrequency'],
          dataSources: {
            cloudTrail: { status: response.DataSources?.CloudTrail?.Status as 'ENABLED' | 'DISABLED' || 'DISABLED' },
            dnsLogs: { status: response.DataSources?.DNSLogs?.Status as 'ENABLED' | 'DISABLED' || 'DISABLED' },
            flowLogs: { status: response.DataSources?.FlowLogs?.Status as 'ENABLED' | 'DISABLED' || 'DISABLED' },
            s3Logs: { status: response.DataSources?.S3Logs?.Status as 'ENABLED' | 'DISABLED' || 'DISABLED' },
            kubernetes: response.DataSources?.Kubernetes ? {
              auditLogs: { status: response.DataSources.Kubernetes.AuditLogs?.Status as 'ENABLED' | 'DISABLED' || 'DISABLED' },
            } : undefined,
            malwareProtection: response.DataSources?.MalwareProtection ? {
              scanEc2InstanceWithFindings: {
                ebsVolumes: { status: response.DataSources.MalwareProtection.ScanEc2InstanceWithFindings?.EbsVolumes?.Status as 'ENABLED' | 'DISABLED' || 'DISABLED' },
              },
            } : undefined,
          },
          tags: response.Tags || {},
          region: targetRegion,
        };

        return {
          success: true,
          data: detector,
          message: `Retrieved GuardDuty detector ${detectorId}`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to get GuardDuty detector',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async enableGuardDuty(region?: string): Promise<SecurityOperationResult<string>> {
      try {
        const client = createGuardDutyClient(region);
        const response = await client.send(new CreateDetectorCommand({
          Enable: true,
          FindingPublishingFrequency: 'FIFTEEN_MINUTES',
          DataSources: {
            S3Logs: { Enable: true },
            Kubernetes: { AuditLogs: { Enable: true } },
            MalwareProtection: { ScanEc2InstanceWithFindings: { EbsVolumes: true } },
          },
        }));

        return {
          success: true,
          data: response.DetectorId!,
          message: `GuardDuty enabled with detector ID ${response.DetectorId}`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to enable GuardDuty',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async disableGuardDuty(detectorId: string, region?: string): Promise<SecurityOperationResult<void>> {
      try {
        const client = createGuardDutyClient(region);
        await client.send(new DeleteDetectorCommand({
          DetectorId: detectorId,
        }));

        return {
          success: true,
          message: `GuardDuty detector ${detectorId} deleted`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to disable GuardDuty detector ${detectorId}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async archiveGuardDutyFindings(detectorId: string, findingIds: string[], region?: string): Promise<SecurityOperationResult<void>> {
      try {
        const client = createGuardDutyClient(region);
        await client.send(new ArchiveFindingsCommand({
          DetectorId: detectorId,
          FindingIds: findingIds,
        }));

        return {
          success: true,
          message: `Archived ${findingIds.length} GuardDuty findings`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to archive GuardDuty findings',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    // KMS operations
    async listKMSKeys(options: ListKMSKeysOptions = {}): Promise<SecurityOperationResult<KMSKeyInfo[]>> {
      try {
        const region = options.region || defaultRegion;
        const client = createKMSClient(region);

        const response = await client.send(new ListKeysCommand({
          Limit: options.maxResults,
        }));

        const keys: KMSKeyInfo[] = [];
        for (const key of response.Keys || []) {
          const keyInfo = await kmsKeyToInfo(
            key.KeyId!,
            region,
            options.includeAliases,
            options.includeTags,
            options.includePolicy,
            options.includeRotationStatus
          );
          
          // Filter by key manager if specified
          if (options.keyManager && keyInfo.keyManager !== options.keyManager) {
            continue;
          }
          
          keys.push(keyInfo);
        }

        return {
          success: true,
          data: keys,
          message: `Found ${keys.length} KMS keys`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to list KMS keys',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getKMSKey(keyId: string, region?: string): Promise<SecurityOperationResult<KMSKeyInfo>> {
      try {
        const targetRegion = region || defaultRegion;
        const keyInfo = await kmsKeyToInfo(keyId, targetRegion, true, true, true, true);

        return {
          success: true,
          data: keyInfo,
          message: `Retrieved KMS key ${keyId}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to get KMS key ${keyId}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async createKMSKey(options: CreateKMSKeyOptions = {}): Promise<SecurityOperationResult<KMSKeyInfo>> {
      try {
        const region = options.region || defaultRegion;
        const client = createKMSClient(region);

        const response = await client.send(new CreateKeyCommand({
          Description: options.description,
          KeyUsage: options.keyUsage,
          KeySpec: options.keySpec,
          Origin: options.origin,
          MultiRegion: options.multiRegion,
          BypassPolicyLockoutSafetyCheck: options.bypassPolicyLockoutSafetyCheck,
          Policy: options.policy,
          Tags: options.tags ? Object.entries(options.tags).map(([TagKey, TagValue]) => ({ TagKey, TagValue })) : undefined,
        }));

        const keyId = response.KeyMetadata?.KeyId!;

        // Enable rotation if requested
        if (options.enableKeyRotation && options.keySpec === 'SYMMETRIC_DEFAULT') {
          await client.send(new EnableKeyRotationCommand({ KeyId: keyId }));
        }

        const keyInfo = await kmsKeyToInfo(keyId, region, true, true, true, true);

        return {
          success: true,
          data: keyInfo,
          message: `Created KMS key ${keyId}`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to create KMS key',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async scheduleKeyDeletion(keyId: string, pendingWindowDays = 30, region?: string): Promise<SecurityOperationResult<Date>> {
      try {
        const client = createKMSClient(region);
        const response = await client.send(new ScheduleKeyDeletionCommand({
          KeyId: keyId,
          PendingWindowInDays: pendingWindowDays,
        }));

        return {
          success: true,
          data: response.DeletionDate!,
          message: `KMS key ${keyId} scheduled for deletion on ${response.DeletionDate?.toISOString()}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to schedule deletion for KMS key ${keyId}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async enableKeyRotation(keyId: string, region?: string): Promise<SecurityOperationResult<void>> {
      try {
        const client = createKMSClient(region);
        await client.send(new EnableKeyRotationCommand({ KeyId: keyId }));

        return {
          success: true,
          message: `Enabled rotation for KMS key ${keyId}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to enable rotation for KMS key ${keyId}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async disableKeyRotation(keyId: string, region?: string): Promise<SecurityOperationResult<void>> {
      try {
        const client = createKMSClient(region);
        await client.send(new DisableKeyRotationCommand({ KeyId: keyId }));

        return {
          success: true,
          message: `Disabled rotation for KMS key ${keyId}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to disable rotation for KMS key ${keyId}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    // Secrets Manager operations
    async listSecrets(options: ListSecretsOptions = {}): Promise<SecurityOperationResult<SecretInfo[]>> {
      try {
        const region = options.region || defaultRegion;
        const client = createSecretsManagerClient(region);

        const response = await client.send(new ListSecretsCommand({
          MaxResults: options.maxResults,
          IncludePlannedDeletion: options.includePlannedDeletion,
          Filters: options.filters?.map(f => ({
            Key: f.key as 'description' | 'name' | 'tag-key' | 'tag-value' | 'primary-region' | 'owning-service' | 'all',
            Values: f.values,
          })),
          SortOrder: options.sortOrder,
        }));

        const secrets = (response.SecretList || []).map((s) => secretToInfo(s, region));

        return {
          success: true,
          data: secrets,
          message: `Found ${secrets.length} secrets`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to list secrets',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getSecret(secretId: string, region?: string): Promise<SecurityOperationResult<SecretInfo>> {
      try {
        const targetRegion = region || defaultRegion;
        const client = createSecretsManagerClient(targetRegion);

        const response = await client.send(new DescribeSecretCommand({
          SecretId: secretId,
        }));

        const secret: SecretInfo = {
          arn: response.ARN!,
          name: response.Name!,
          description: response.Description,
          kmsKeyId: response.KmsKeyId,
          rotationEnabled: response.RotationEnabled || false,
          rotationLambdaArn: response.RotationLambdaARN,
          rotationRules: response.RotationRules ? {
            automaticallyAfterDays: response.RotationRules.AutomaticallyAfterDays,
            scheduleExpression: response.RotationRules.ScheduleExpression,
          } : undefined,
          lastRotatedDate: response.LastRotatedDate,
          lastChangedDate: response.LastChangedDate,
          lastAccessedDate: response.LastAccessedDate,
          deletedDate: response.DeletedDate,
          createdDate: response.CreatedDate!,
          primaryRegion: response.PrimaryRegion,
          replicationStatus: response.ReplicationStatus?.map((r) => ({
            region: r.Region!,
            kmsKeyId: r.KmsKeyId,
            status: r.Status as 'InSync' | 'Failed' | 'InProgress',
            statusMessage: r.StatusMessage,
            lastAccessedDate: r.LastAccessedDate,
          })),
          tags: (response.Tags || []).reduce((acc: Record<string, string>, t) => {
            if (t.Key && t.Value) acc[t.Key] = t.Value;
            return acc;
          }, {} as Record<string, string>),
          owningService: response.OwningService,
          region: targetRegion,
        };

        return {
          success: true,
          data: secret,
          message: `Retrieved secret ${secretId}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to get secret ${secretId}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getSecretValue(secretId: string, versionId?: string, region?: string): Promise<SecurityOperationResult<SecretValue>> {
      try {
        const client = createSecretsManagerClient(region);
        const response = await client.send(new GetSecretValueCommand({
          SecretId: secretId,
          VersionId: versionId,
        }));

        return {
          success: true,
          data: {
            arn: response.ARN!,
            name: response.Name!,
            versionId: response.VersionId!,
            versionStages: response.VersionStages || [],
            secretString: response.SecretString,
            secretBinary: response.SecretBinary,
            createdDate: response.CreatedDate!,
          },
          message: `Retrieved secret value for ${secretId}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to get secret value for ${secretId}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async createSecret(options: CreateSecretOptions): Promise<SecurityOperationResult<SecretInfo>> {
      try {
        const region = options.region || defaultRegion;
        const client = createSecretsManagerClient(region);

        const response = await client.send(new CreateSecretCommand({
          Name: options.name,
          Description: options.description,
          KmsKeyId: options.kmsKeyId,
          SecretString: options.secretString,
          SecretBinary: options.secretBinary,
          Tags: options.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
          AddReplicaRegions: options.addReplicaRegions?.map(r => ({
            Region: r.region,
            KmsKeyId: r.kmsKeyId,
          })),
          ForceOverwriteReplicaSecret: options.forceOverwriteReplicaSecret,
        }));

        // Get full secret info
        const secretResult = await this.getSecret(response.Name!, region);
        if (!secretResult.success || !secretResult.data) {
          return {
            success: true,
            data: {
              arn: response.ARN!,
              name: response.Name!,
              createdDate: new Date(),
              rotationEnabled: false,
              tags: options.tags || {},
              region,
            },
            message: `Created secret ${options.name}`,
          };
        }

        return {
          success: true,
          data: secretResult.data,
          message: `Created secret ${options.name}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create secret ${options.name}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async updateSecret(options: UpdateSecretOptions): Promise<SecurityOperationResult<void>> {
      try {
        const client = createSecretsManagerClient(options.region);
        await client.send(new UpdateSecretCommand({
          SecretId: options.secretId,
          Description: options.description,
          KmsKeyId: options.kmsKeyId,
          SecretString: options.secretString,
          SecretBinary: options.secretBinary,
        }));

        return {
          success: true,
          message: `Updated secret ${options.secretId}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to update secret ${options.secretId}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async deleteSecret(secretId: string, forceDelete = false, recoveryWindow = 30, region?: string): Promise<SecurityOperationResult<void>> {
      try {
        const client = createSecretsManagerClient(region);
        await client.send(new DeleteSecretCommand({
          SecretId: secretId,
          ForceDeleteWithoutRecovery: forceDelete,
          RecoveryWindowInDays: forceDelete ? undefined : recoveryWindow,
        }));

        return {
          success: true,
          message: forceDelete
            ? `Deleted secret ${secretId} permanently`
            : `Scheduled deletion for secret ${secretId} in ${recoveryWindow} days`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to delete secret ${secretId}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async rotateSecret(options: RotateSecretOptions): Promise<SecurityOperationResult<void>> {
      try {
        const client = createSecretsManagerClient(options.region);
        await client.send(new RotateSecretCommand({
          SecretId: options.secretId,
          RotationLambdaARN: options.rotationLambdaArn,
          RotationRules: options.rotationRules ? {
            AutomaticallyAfterDays: options.rotationRules.automaticallyAfterDays,
            ScheduleExpression: options.rotationRules.scheduleExpression,
          } : undefined,
          RotateImmediately: options.rotateImmediately,
        }));

        return {
          success: true,
          message: `Initiated rotation for secret ${options.secretId}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to rotate secret ${options.secretId}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    // Access Analyzer operations
    async listAccessAnalyzers(region?: string): Promise<SecurityOperationResult<AccessAnalyzerInfo[]>> {
      try {
        const targetRegion = region || defaultRegion;
        const client = createAccessAnalyzerClient(targetRegion);

        const response = await client.send(new ListAnalyzersCommand({}));
        const analyzers = (response.analyzers || []).map((a) => analyzerToInfo(a, targetRegion));

        return {
          success: true,
          data: analyzers,
          message: `Found ${analyzers.length} Access Analyzers`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to list Access Analyzers',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async listAccessAnalyzerFindings(options: ListAccessAnalyzerFindingsOptions = {}): Promise<SecurityOperationResult<AccessAnalyzerFinding[]>> {
      try {
        const region = options.region || defaultRegion;
        const client = createAccessAnalyzerClient(region);

        // Get analyzer ARN if not provided
        let analyzerArn = options.analyzerArn;
        if (!analyzerArn) {
          const analyzersResp = await client.send(new ListAnalyzersCommand({}));
          analyzerArn = analyzersResp.analyzers?.[0]?.arn;
          if (!analyzerArn) {
            return {
              success: false,
              message: 'No Access Analyzer found',
              error: 'Access Analyzer is not enabled in this region',
            };
          }
        }

        const filter: Record<string, unknown> = {};
        if (options.status) {
          filter.status = { eq: [options.status] };
        }
        if (options.resourceType) {
          filter.resourceType = { eq: [options.resourceType] };
        }

        const response = await client.send(new ListAccessAnalyzerFindingsCommand({
          analyzerArn,
          filter: Object.keys(filter).length > 0 ? filter as any : undefined,
          maxResults: options.maxResults,
          sort: options.sortBy ? {
            attributeName: options.sortBy,
            orderBy: options.sortOrder || 'ASC',
          } : undefined,
        }));

        const findings = (response.findings || []).map((f) => accessAnalyzerFindingToInfo(f, region, analyzerArn));

        return {
          success: true,
          data: findings,
          message: `Found ${findings.length} Access Analyzer findings`,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to list Access Analyzer findings',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async createAccessAnalyzer(options: CreateAccessAnalyzerOptions): Promise<SecurityOperationResult<AccessAnalyzerInfo>> {
      try {
        const region = options.region || defaultRegion;
        const client = createAccessAnalyzerClient(region);

        const response = await client.send(new CreateAnalyzerCommand({
          analyzerName: options.analyzerName,
          type: options.type,
          archiveRules: options.archiveRules?.map(r => ({
            ruleName: r.ruleName,
            filter: r.filter,
          })),
          tags: options.tags,
        }));

        const analyzerInfo: AccessAnalyzerInfo = {
          analyzerArn: response.arn!,
          analyzerName: options.analyzerName,
          type: options.type,
          createdAt: new Date(),
          status: 'CREATING',
          tags: options.tags || {},
          region,
        };

        return {
          success: true,
          data: analyzerInfo,
          message: `Created Access Analyzer ${options.analyzerName}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create Access Analyzer ${options.analyzerName}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async deleteAccessAnalyzer(analyzerName: string, region?: string): Promise<SecurityOperationResult<void>> {
      try {
        const client = createAccessAnalyzerClient(region);
        await client.send(new DeleteAnalyzerCommand({
          analyzerName,
        }));

        return {
          success: true,
          message: `Deleted Access Analyzer ${analyzerName}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to delete Access Analyzer ${analyzerName}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async archiveAccessAnalyzerFinding(analyzerArn: string, findingId: string, region?: string): Promise<SecurityOperationResult<void>> {
      try {
        const client = createAccessAnalyzerClient(region);
        await client.send(new UpdateFindingsCommand({
          analyzerArn,
          ids: [findingId],
          status: 'ARCHIVED',
        }));

        return {
          success: true,
          message: `Archived Access Analyzer finding ${findingId}`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to archive Access Analyzer finding ${findingId}`,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    // Security posture summary
    async getSecurityPosture(region?: string): Promise<SecurityOperationResult<SecurityPostureSummary>> {
      try {
        const targetRegion = region || defaultRegion;

        // Gather data from all security services
        const [
          rolesResult,
          usersResult,
          policiesResult,
          securityFindingsResult,
          guardDutyResult,
          accessAnalyzerResult,
          kmsResult,
          secretsResult,
        ] = await Promise.all([
          this.listRoles({ includeAttachedPolicies: true }),
          this.listUsers({ includeAccessKeys: true, includeMFADevices: true }),
          this.listPolicies({ scope: 'Local' }),
          this.listSecurityFindings({ region: targetRegion }),
          this.listGuardDutyFindings({ region: targetRegion }),
          this.listAccessAnalyzerFindings({ region: targetRegion }),
          this.listKMSKeys({ region: targetRegion, keyManager: 'CUSTOMER', includeRotationStatus: true }),
          this.listSecrets({ region: targetRegion }),
        ]);

        const roles = rolesResult.data || [];
        const users = usersResult.data || [];
        const policies = policiesResult.data || [];
        const securityFindings = securityFindingsResult.data || [];
        const guardDutyFindings = guardDutyResult.data || [];
        const accessAnalyzerFindings = accessAnalyzerResult.data || [];
        const kmsKeys = kmsResult.data || [];
        const secrets = secretsResult.data || [];

        // Calculate IAM metrics
        const now = new Date();
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        
        const usersWithoutMFA = users.filter(u => u.mfaDevices.length === 0).length;
        const accessKeysOlderThan90Days = users.reduce((count, user) => {
          return count + user.accessKeys.filter(k => k.createDate < ninetyDaysAgo).length;
        }, 0);

        // Calculate Security Hub metrics
        const criticalFindings = securityFindings.filter(f => f.severity.label === 'CRITICAL').length;
        const highFindings = securityFindings.filter(f => f.severity.label === 'HIGH').length;
        const mediumFindings = securityFindings.filter(f => f.severity.label === 'MEDIUM').length;
        const lowFindings = securityFindings.filter(f => f.severity.label === 'LOW').length;
        const informationalFindings = securityFindings.filter(f => f.severity.label === 'INFORMATIONAL').length;

        // Calculate GuardDuty metrics
        const highSeverityGuardDuty = guardDutyFindings.filter(f => f.severityLabel === 'High').length;
        const mediumSeverityGuardDuty = guardDutyFindings.filter(f => f.severityLabel === 'Medium').length;
        const lowSeverityGuardDuty = guardDutyFindings.filter(f => f.severityLabel === 'Low').length;

        // Calculate Access Analyzer metrics
        const publicResources = accessAnalyzerFindings.filter(f => f.isPublic).length;
        const crossAccountAccess = accessAnalyzerFindings.filter(f => !f.isPublic).length;

        // Calculate KMS metrics
        const keysWithoutRotation = kmsKeys.filter(k => k.keySpec === 'SYMMETRIC_DEFAULT' && !k.rotationEnabled).length;
        const keysInPendingDeletion = kmsKeys.filter(k => k.keyState === 'PendingDeletion').length;

        // Calculate Secrets Manager metrics
        const secretsWithRotation = secrets.filter(s => s.rotationEnabled).length;
        const secretsWithoutRotation = secrets.filter(s => !s.rotationEnabled).length;
        const secretsLastAccessedOver90Days = secrets.filter(s => 
          s.lastAccessedDate && s.lastAccessedDate < ninetyDaysAgo
        ).length;

        const summary: SecurityPostureSummary = {
          timestamp: now,
          region: targetRegion,
          iamSummary: {
            totalRoles: roles.length,
            totalUsers: users.length,
            totalPolicies: policies.length,
            usersWithoutMFA,
            accessKeysOlderThan90Days,
            unusedRoles: 0, // Would require more analysis
            overprivilegedEntities: 0, // Would require policy analysis
          },
          securityHubSummary: {
            enabled: securityFindingsResult.success,
            criticalFindings,
            highFindings,
            mediumFindings,
            lowFindings,
            informationalFindings,
            enabledStandards: [], // Would need separate call
            complianceScore: undefined,
          },
          guardDutySummary: {
            enabled: guardDutyResult.success,
            highSeverityFindings: highSeverityGuardDuty,
            mediumSeverityFindings: mediumSeverityGuardDuty,
            lowSeverityFindings: lowSeverityGuardDuty,
            totalFindings: guardDutyFindings.length,
          },
          accessAnalyzerSummary: {
            enabled: accessAnalyzerResult.success,
            activeFindings: accessAnalyzerFindings.length,
            publicResources,
            crossAccountAccess,
          },
          kmsSummary: {
            totalKeys: kmsKeys.length,
            customerManagedKeys: kmsKeys.length,
            keysWithoutRotation,
            keysInPendingDeletion,
          },
          secretsManagerSummary: {
            totalSecrets: secrets.length,
            secretsWithRotation,
            secretsWithoutRotation,
            secretsLastAccessedOver90Days,
          },
        };

        return {
          success: true,
          data: summary,
          message: 'Retrieved security posture summary',
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to get security posture',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

// Helper function to generate secure password
function generateSecurePassword(): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*()_+-=[]{}|';
  const all = uppercase + lowercase + numbers + special;
  
  let password = '';
  // Ensure at least one of each type
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  // Fill the rest randomly
  for (let i = 4; i < 20; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}
