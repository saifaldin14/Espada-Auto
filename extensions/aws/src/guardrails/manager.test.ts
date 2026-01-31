/**
 * AWS Guardrails Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGuardrailsManager } from './manager.js';
import type {
  OperationContext,
  ApprovalStatus,
  Environment,
} from './types.js';

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockImplementation((command: any) => {
      const commandName = command.constructor.name;
      
      if (commandName === 'DescribeInstancesCommand') {
        return Promise.resolve({
          Reservations: [{
            Instances: [{
              InstanceId: 'i-test123',
              BlockDeviceMappings: [{
                Ebs: { VolumeId: 'vol-test123', DeleteOnTermination: true }
              }],
              SecurityGroups: [{ GroupId: 'sg-test123', GroupName: 'test-sg' }],
            }]
          }]
        });
      }
      
      if (commandName === 'DescribeVolumesCommand') {
        return Promise.resolve({
          Volumes: [{ VolumeId: 'vol-test123', State: 'in-use' }]
        });
      }
      
      if (commandName === 'DescribeTagsCommand') {
        return Promise.resolve({
          Tags: [
            { Key: 'Environment', Value: 'production' },
            { Key: 'Name', Value: 'test-instance' },
          ]
        });
      }
      
      if (commandName === 'CreateSnapshotCommand') {
        return Promise.resolve({
          SnapshotId: 'snap-test123'
        });
      }
      
      return Promise.resolve({});
    }),
  })),
  DescribeInstancesCommand: vi.fn(),
  DescribeVolumesCommand: vi.fn(),
  DescribeSnapshotsCommand: vi.fn(),
  CreateSnapshotCommand: vi.fn(),
  DescribeTagsCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-rds', () => ({
  RDSClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockImplementation((command: any) => {
      const commandName = command.constructor.name;
      
      if (commandName === 'DescribeDBInstancesCommand') {
        return Promise.resolve({
          DBInstances: [{
            DBInstanceIdentifier: 'test-db',
            DBInstanceStatus: 'available',
            ReadReplicaDBInstanceIdentifiers: ['test-db-replica'],
          }]
        });
      }
      
      if (commandName === 'CreateDBSnapshotCommand') {
        return Promise.resolve({
          DBSnapshot: { DBSnapshotIdentifier: 'test-snapshot' }
        });
      }
      
      return Promise.resolve({});
    }),
  })),
  DescribeDBInstancesCommand: vi.fn(),
  DescribeDBClustersCommand: vi.fn(),
  CreateDBSnapshotCommand: vi.fn(),
  CreateDBClusterSnapshotCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  GetFunctionCommand: vi.fn(),
  ListVersionsByFunctionCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  HeadBucketCommand: vi.fn(),
  GetBucketTaggingCommand: vi.fn(),
  PutBucketVersioningCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({ MessageId: 'msg-123' }),
  })),
  PublishCommand: vi.fn(),
}));

describe('GuardrailsManager', () => {
  let manager: ReturnType<typeof createGuardrailsManager>;
  
  beforeEach(() => {
    vi.clearAllMocks();
    manager = createGuardrailsManager({
      defaultRegion: 'us-east-1',
      environmentTagKey: 'Environment',
      defaultEnvironment: 'unknown',
      defaultApprovers: [
        { id: 'approver1', name: 'Test Approver', email: 'approver@test.com' },
        { id: 'approver2', name: 'Test Approver 2', email: 'approver2@test.com' },
      ],
      defaultApprovalTimeout: 30,
      rateLimits: {
        maxResourcesPerOperation: 50,
        maxOperationsPerMinute: 30,
        maxOperationsPerHour: 500,
        maxDestructiveOperationsPerDay: 100,
        bulkOperationCooldownSeconds: 60,
        confirmationThreshold: 10,
      },
      safetyChecks: {
        confirmProductionChanges: true,
        createBackupBeforeDelete: true,
        checkDependenciesBeforeDelete: true,
        preventChangesOutsideWindow: false,
        requireApprovalForProtectedEnvs: true,
        dryRunByDefault: true,
        blockOnProtectedTags: ['DoNotDelete', 'Protected'],
      },
    });
  });
  
  describe('Approval Workflows', () => {
    const testContext: OperationContext = {
      userId: 'user-123',
      userName: 'Test User',
      sessionId: 'session-123',
      action: 'terminate',
      service: 'ec2',
      resourceIds: ['i-test123'],
      resourceType: 'ec2:instance',
      environment: 'production',
      region: 'us-east-1',
    };
    
    it('should create an approval request', async () => {
      const result = await manager.createApprovalRequest(testContext, 'Testing');
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.status).toBe('pending');
      expect(result.data!.action).toBe('terminate');
      expect(result.data!.environment).toBe('production');
      expect(result.data!.requiredApprovals).toBe(2); // Production requires 2
    });
    
    it('should retrieve an approval request', async () => {
      const createResult = await manager.createApprovalRequest(testContext);
      const getResult = await manager.getApprovalRequest(createResult.data!.id);
      
      expect(getResult.success).toBe(true);
      expect(getResult.data!.id).toBe(createResult.data!.id);
    });
    
    it('should return error for non-existent request', async () => {
      const result = await manager.getApprovalRequest('non-existent');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('not_found');
    });
    
    it('should list approval requests', async () => {
      await manager.createApprovalRequest(testContext);
      await manager.createApprovalRequest({ ...testContext, resourceIds: ['i-test456'] });
      
      const result = await manager.listApprovalRequests();
      
      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(2);
    });
    
    it('should filter approval requests by status', async () => {
      await manager.createApprovalRequest(testContext);
      
      const pendingResult = await manager.listApprovalRequests({ status: 'pending' });
      const approvedResult = await manager.listApprovalRequests({ status: 'approved' });
      
      expect(pendingResult.data!.length).toBe(1);
      expect(approvedResult.data!.length).toBe(0);
    });
    
    it('should approve a request with sufficient approvals', async () => {
      const createResult = await manager.createApprovalRequest(testContext);
      const requestId = createResult.data!.id;
      
      // First approval
      await manager.submitApprovalResponse(requestId, {
        approverId: 'approver1',
        approverName: 'Test Approver',
        decision: 'approved',
      });
      
      let getResult = await manager.getApprovalRequest(requestId);
      expect(getResult.data!.status).toBe('pending'); // Still pending, needs 2
      
      // Second approval
      await manager.submitApprovalResponse(requestId, {
        approverId: 'approver2',
        approverName: 'Test Approver 2',
        decision: 'approved',
      });
      
      getResult = await manager.getApprovalRequest(requestId);
      expect(getResult.data!.status).toBe('approved');
    });
    
    it('should reject a request on first rejection', async () => {
      const createResult = await manager.createApprovalRequest(testContext);
      const requestId = createResult.data!.id;
      
      await manager.submitApprovalResponse(requestId, {
        approverId: 'approver1',
        approverName: 'Test Approver',
        decision: 'rejected',
        reason: 'Not justified',
      });
      
      const getResult = await manager.getApprovalRequest(requestId);
      expect(getResult.data!.status).toBe('rejected');
    });
    
    it('should prevent duplicate responses', async () => {
      const createResult = await manager.createApprovalRequest(testContext);
      const requestId = createResult.data!.id;
      
      await manager.submitApprovalResponse(requestId, {
        approverId: 'approver1',
        approverName: 'Test Approver',
        decision: 'approved',
      });
      
      const duplicateResult = await manager.submitApprovalResponse(requestId, {
        approverId: 'approver1',
        approverName: 'Test Approver',
        decision: 'approved',
      });
      
      expect(duplicateResult.success).toBe(false);
      expect(duplicateResult.error).toBe('already_responded');
    });
    
    it('should prevent unauthorized approvers', async () => {
      const createResult = await manager.createApprovalRequest(testContext);
      const requestId = createResult.data!.id;
      
      const result = await manager.submitApprovalResponse(requestId, {
        approverId: 'unauthorized-user',
        approverName: 'Unauthorized',
        decision: 'approved',
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('unauthorized');
    });
    
    it('should cancel an approval request', async () => {
      const createResult = await manager.createApprovalRequest(testContext);
      const requestId = createResult.data!.id;
      
      const cancelResult = await manager.cancelApprovalRequest(requestId, 'No longer needed');
      expect(cancelResult.success).toBe(true);
      
      const getResult = await manager.getApprovalRequest(requestId);
      expect(getResult.data!.status).toBe('cancelled');
    });
  });
  
  describe('Dry Run', () => {
    it('should perform dry run and return affected resources', async () => {
      const context: OperationContext = {
        userId: 'user-123',
        userName: 'Test User',
        action: 'terminate',
        service: 'ec2',
        resourceIds: ['i-test123'],
        resourceType: 'ec2:instance',
        region: 'us-east-1',
      };
      
      const result = await manager.performDryRun(context);
      
      expect(result.success).toBe(true);
      expect(result.data!.affectedResources.length).toBe(1);
      expect(result.data!.plannedChanges.length).toBe(1);
      expect(result.data!.plannedChanges[0].changeType).toBe('delete');
      expect(result.data!.plannedChanges[0].isDestructive).toBe(true);
    });
    
    it('should include warnings for production resources', async () => {
      const context: OperationContext = {
        userId: 'user-123',
        userName: 'Test User',
        action: 'terminate',
        service: 'ec2',
        resourceIds: ['i-test123'],
        resourceType: 'ec2:instance',
        environment: 'production',
        region: 'us-east-1',
      };
      
      const result = await manager.performDryRun(context);
      
      expect(result.data!.warnings.some(w => w.includes('production'))).toBe(true);
    });
  });
  
  describe('Safety Checks', () => {
    it('should block actions on protected environments', async () => {
      // Set up a blocked action
      manager.setEnvironmentProtection({
        environment: 'production',
        isProtected: true,
        protectionLevel: 'full',
        approvalRequiredActions: ['terminate', 'delete'],
        blockedActions: ['terminate'],
        minApprovals: 2,
      });
      
      const context: OperationContext = {
        userId: 'user-123',
        userName: 'Test User',
        action: 'terminate',
        service: 'ec2',
        resourceIds: ['i-test123'],
        resourceType: 'ec2:instance',
        environment: 'production',
        region: 'us-east-1',
      };
      
      const result = await manager.runSafetyChecks(context);
      
      expect(result.success).toBe(true);
      expect(result.data!.passed).toBe(false);
      expect(result.data!.blockingIssues.length).toBeGreaterThan(0);
    });
    
    it('should require confirmation for production changes', async () => {
      const context: OperationContext = {
        userId: 'user-123',
        userName: 'Test User',
        action: 'stop',
        service: 'ec2',
        resourceIds: ['i-test123'],
        resourceType: 'ec2:instance',
        environment: 'production',
        region: 'us-east-1',
        hasConfirmation: false,
      };
      
      const result = await manager.runSafetyChecks(context);
      
      expect(result.data!.requiredConfirmations.length).toBeGreaterThan(0);
    });
    
    it('should pass with confirmation', async () => {
      const context: OperationContext = {
        userId: 'user-123',
        userName: 'Test User',
        action: 'stop',
        service: 'ec2',
        resourceIds: ['i-test123'],
        resourceType: 'ec2:instance',
        environment: 'development',
        region: 'us-east-1',
        hasConfirmation: true,
      };
      
      const result = await manager.runSafetyChecks(context);
      
      expect(result.success).toBe(true);
      expect(result.data!.passed).toBe(true);
    });
    
    it('should require confirmation for bulk operations', async () => {
      const context: OperationContext = {
        userId: 'user-123',
        userName: 'Test User',
        action: 'stop',
        service: 'ec2',
        resourceIds: Array.from({ length: 15 }, (_, i) => `i-test${i}`),
        resourceType: 'ec2:instance',
        environment: 'development',
        region: 'us-east-1',
        hasConfirmation: false,
      };
      
      const result = await manager.runSafetyChecks(context);
      
      expect(result.data!.requiredConfirmations.some(c => c.includes('15 resources'))).toBe(true);
    });
  });
  
  describe('Environment Protection', () => {
    it('should detect environment from tags', () => {
      expect(manager.detectEnvironment({ Environment: 'production' })).toBe('production');
      expect(manager.detectEnvironment({ Environment: 'prod-east' })).toBe('production');
      expect(manager.detectEnvironment({ Environment: 'staging' })).toBe('staging');
      expect(manager.detectEnvironment({ Environment: 'development' })).toBe('development');
      expect(manager.detectEnvironment({ Environment: 'sandbox' })).toBe('sandbox');
      expect(manager.detectEnvironment({})).toBe('unknown');
    });
    
    it('should get environment protection settings', () => {
      const protection = manager.getEnvironmentProtection('production');
      
      expect(protection).toBeDefined();
      expect(protection!.isProtected).toBe(true);
      expect(protection!.approvalRequiredActions).toContain('terminate');
    });
    
    it('should set custom environment protection', () => {
      manager.setEnvironmentProtection({
        environment: 'sandbox',
        isProtected: true,
        protectionLevel: 'partial',
        approvalRequiredActions: ['delete'],
        blockedActions: [],
        minApprovals: 1,
      });
      
      const protection = manager.getEnvironmentProtection('sandbox');
      expect(protection!.isProtected).toBe(true);
    });
  });
  
  describe('Rate Limiting', () => {
    it('should track operation counts', () => {
      const userId = 'user-123';
      
      manager.recordOperation(userId, 'read');
      manager.recordOperation(userId, 'read');
      manager.recordOperation(userId, 'read');
      
      const status = manager.checkRateLimit(userId, 'read');
      
      expect(status.operationsThisMinute).toBe(3);
      expect(status.isRateLimited).toBe(false);
    });
    
    it('should rate limit when threshold exceeded', () => {
      const userId = 'user-456';
      
      // Exceed minute limit
      for (let i = 0; i < 35; i++) {
        manager.recordOperation(userId, 'read');
      }
      
      const status = manager.checkRateLimit(userId, 'read');
      
      expect(status.isRateLimited).toBe(true);
      expect(status.rateLimitReason).toContain('per minute');
    });
    
    it('should track destructive operations separately', () => {
      const userId = 'user-789';
      
      manager.recordOperation(userId, 'terminate');
      manager.recordOperation(userId, 'delete');
      
      const status = manager.checkRateLimit(userId, 'terminate');
      
      expect(status.destructiveOperationsToday).toBe(2);
    });
    
    it('should allow getting and setting rate limit config', () => {
      const currentConfig = manager.getRateLimitConfig();
      expect(currentConfig.maxOperationsPerMinute).toBe(30);
      
      manager.setRateLimitConfig({ maxOperationsPerMinute: 60 });
      
      const newConfig = manager.getRateLimitConfig();
      expect(newConfig.maxOperationsPerMinute).toBe(60);
    });
  });
  
  describe('Audit Logging', () => {
    it('should log actions', async () => {
      const result = await manager.logAction({
        userId: 'user-123',
        userName: 'Test User',
        action: 'terminate',
        service: 'ec2',
        resourceIds: ['i-test123'],
        environment: 'production',
        region: 'us-east-1',
        outcome: 'success',
        dryRun: false,
      });
      
      expect(result.success).toBe(true);
      expect(result.data!.id).toBeDefined();
      expect(result.data!.timestamp).toBeDefined();
    });
    
    it('should query audit logs', async () => {
      await manager.logAction({
        userId: 'user-123',
        userName: 'Test User',
        action: 'terminate',
        service: 'ec2',
        resourceIds: ['i-test123'],
        environment: 'production',
        region: 'us-east-1',
        outcome: 'success',
        dryRun: false,
      });
      
      await manager.logAction({
        userId: 'user-456',
        userName: 'Other User',
        action: 'stop',
        service: 'ec2',
        resourceIds: ['i-test456'],
        environment: 'development',
        region: 'us-east-1',
        outcome: 'blocked',
        dryRun: false,
      });
      
      const allLogs = await manager.queryAuditLogs({});
      expect(allLogs.data!.entries.length).toBe(2);
      
      const userLogs = await manager.queryAuditLogs({ userId: 'user-123' });
      expect(userLogs.data!.entries.length).toBe(1);
      
      const blockedLogs = await manager.queryAuditLogs({ outcomes: ['blocked'] });
      expect(blockedLogs.data!.entries.length).toBe(1);
    });
    
    it('should generate audit log summary', async () => {
      await manager.logAction({
        userId: 'user-123',
        userName: 'Test User',
        action: 'terminate',
        service: 'ec2',
        resourceIds: ['i-test123'],
        environment: 'production',
        region: 'us-east-1',
        outcome: 'success',
        dryRun: false,
      });
      
      await manager.logAction({
        userId: 'user-123',
        userName: 'Test User',
        action: 'stop',
        service: 'ec2',
        resourceIds: ['i-test456'],
        environment: 'production',
        region: 'us-east-1',
        outcome: 'blocked',
        dryRun: false,
      });
      
      const now = new Date();
      const start = new Date(now.getTime() - 60 * 60 * 1000);
      
      const summary = await manager.getAuditLogSummary(start, now);
      
      expect(summary.success).toBe(true);
      expect(summary.data!.totalActions).toBe(2);
      expect(summary.data!.successfulActions).toBe(1);
      expect(summary.data!.blockedActions).toBe(1);
      expect(summary.data!.byService['ec2']).toBe(2);
    });
  });
  
  describe('Guardrails Evaluation', () => {
    it('should evaluate guardrails comprehensively', async () => {
      const context: OperationContext = {
        userId: 'user-123',
        userName: 'Test User',
        action: 'terminate',
        service: 'ec2',
        resourceIds: ['i-test123'],
        resourceType: 'ec2:instance',
        environment: 'production',
        region: 'us-east-1',
      };
      
      const result = await manager.evaluateGuardrails(context);
      
      expect(result.success).toBe(true);
      expect(result.data!.requiresApproval).toBe(true);
      expect(result.data!.requiresDryRun).toBe(true);
      expect(result.data!.safetyCheckResult).toBeDefined();
    });
    
    it('should allow non-destructive operations in dev', async () => {
      const context: OperationContext = {
        userId: 'user-123',
        userName: 'Test User',
        action: 'read',
        service: 'ec2',
        resourceIds: ['i-test123'],
        resourceType: 'ec2:instance',
        environment: 'development',
        region: 'us-east-1',
      };
      
      const result = await manager.evaluateGuardrails(context);
      
      expect(result.success).toBe(true);
      expect(result.data!.allowed).toBe(true);
      expect(result.data!.requiresApproval).toBe(false);
    });
  });
  
  describe('Impact Assessment', () => {
    it('should assess impact of destructive operations', async () => {
      const context: OperationContext = {
        userId: 'user-123',
        userName: 'Test User',
        action: 'terminate',
        service: 'ec2',
        resourceIds: ['i-test123'],
        resourceType: 'ec2:instance',
        environment: 'production',
        region: 'us-east-1',
      };
      
      const result = await manager.assessImpact(context);
      
      expect(result.success).toBe(true);
      expect(result.data!.severity).toBe('critical');
      expect(result.data!.riskFactors.length).toBeGreaterThan(0);
      expect(result.data!.recommendations.length).toBeGreaterThan(0);
    });
  });
  
  describe('Pre-operation Backups', () => {
    it('should create pre-operation backup for EC2 instance', async () => {
      const result = await manager.createPreOperationBackup(
        'i-test123',
        'ec2:instance',
        'terminate'
      );
      
      expect(result.success).toBe(true);
      expect(result.data!.backupType).toBeDefined();
      expect(['snapshot', 'configuration']).toContain(result.data!.backupType);
      expect(result.data!.backupReference).toBeDefined();
    });
    
    it('should list pre-operation backups', async () => {
      await manager.createPreOperationBackup('i-test123', 'ec2:instance', 'terminate');
      await manager.createPreOperationBackup('i-test456', 'ec2:instance', 'terminate');
      
      const allBackups = await manager.listPreOperationBackups();
      expect(allBackups.data!.length).toBe(2);
      
      const filteredBackups = await manager.listPreOperationBackups('i-test123');
      expect(filteredBackups.data!.length).toBe(1);
    });
  });
  
  describe('Change Requests', () => {
    it('should create a change request', async () => {
      const result = await manager.createChangeRequest({
        title: 'Terminate dev instances',
        description: 'Clean up unused dev instances',
        changeType: 'normal',
        priority: 'medium',
        requestedBy: 'user-123',
        plannedActions: [{
          order: 1,
          description: 'Terminate instances',
          service: 'ec2',
          actionType: 'terminate',
          targetResources: ['i-test123', 'i-test456'],
          expectedOutcome: 'Instances terminated',
        }],
        impactAssessment: {
          severity: 'medium',
          affectedResourceCount: 2,
          affectedResourceTypes: ['ec2:instance'],
          rollbackPossible: false,
          riskFactors: ['Data loss'],
          recommendations: ['Backup data first'],
        },
      });
      
      expect(result.success).toBe(true);
      expect(result.data!.status).toBe('draft');
    });
    
    it('should update change request status', async () => {
      const createResult = await manager.createChangeRequest({
        title: 'Test change',
        description: 'Test',
        changeType: 'normal',
        priority: 'low',
        requestedBy: 'user-123',
        plannedActions: [],
        impactAssessment: {
          severity: 'low',
          affectedResourceCount: 0,
          affectedResourceTypes: [],
          rollbackPossible: true,
          riskFactors: [],
          recommendations: [],
        },
      });
      
      const updateResult = await manager.updateChangeRequestStatus(
        createResult.data!.id,
        'approved',
        'Approved by manager'
      );
      
      expect(updateResult.success).toBe(true);
      expect(updateResult.data!.status).toBe('approved');
      expect(updateResult.data!.notes).toContain('Approved by manager');
    });
    
    it('should list change requests', async () => {
      await manager.createChangeRequest({
        title: 'Change 1',
        description: 'Test',
        changeType: 'normal',
        priority: 'low',
        requestedBy: 'user-123',
        plannedActions: [],
        impactAssessment: {
          severity: 'low',
          affectedResourceCount: 0,
          affectedResourceTypes: [],
          rollbackPossible: true,
          riskFactors: [],
          recommendations: [],
        },
      });
      
      const result = await manager.listChangeRequests();
      expect(result.data!.length).toBe(1);
    });
  });
  
  describe('Policies', () => {
    it('should add and list policies', () => {
      const policy = manager.addPolicy({
          name: 'Block production deletes',
          description: 'Block all delete operations in production',
          enabled: true,
          priority: 1,
          conditions: [
              { type: 'environment', operator: 'equals', value: 'production' },
              { type: 'action', operator: 'equals', value: 'delete' },
          ],
          actions: [{ type: 'block' }],
          error: undefined,
          data: undefined,
          success: undefined
      });
      
      expect(policy.id).toBeDefined();
      
      const policies = manager.listPolicies();
      expect(policies.length).toBe(1);
    });
    
    it('should update a policy', () => {
      const policy = manager.addPolicy({
          name: 'Test Policy',
          description: 'Test',
          enabled: true,
          priority: 1,
          conditions: [],
          actions: [],
          error: undefined,
          data: undefined,
          success: undefined
      });
      
      const updated = manager.updatePolicy(policy.id, { enabled: false });
      
      expect(updated!.enabled).toBe(false);
    });
    
    it('should remove a policy', () => {
      const policy = manager.addPolicy({
          name: 'To Remove',
          description: 'Test',
          enabled: true,
          priority: 1,
          conditions: [],
          actions: [],
          error: undefined,
          data: undefined,
          success: undefined
      });
      
      const removed = manager.removePolicy(policy.id);
      expect(removed).toBe(true);
      
      const policies = manager.listPolicies();
      expect(policies.length).toBe(0);
    });
  });
  
  describe('Action Classification', () => {
    it('should classify terminate as critical and destructive', () => {
      const classification = manager.classifyAction('terminate', 'ec2');
      
      expect(classification.severity).toBe('critical');
      expect(classification.isDestructive).toBe(true);
      expect(classification.isReversible).toBe(false);
    });
    
    it('should classify read as low severity', () => {
      const classification = manager.classifyAction('read', 'ec2');
      
      expect(classification.severity).toBe('low');
      expect(classification.isDestructive).toBe(false);
    });
    
    it('should classify stop as high severity but reversible', () => {
      const classification = manager.classifyAction('stop', 'ec2');
      
      expect(classification.severity).toBe('high');
      expect(classification.isDestructive).toBe(false);
      expect(classification.isReversible).toBe(true);
    });
  });
  
  describe('Notifications', () => {
    it('should configure notification channels', () => {
      manager.configureNotificationChannel({
        type: 'sns',
        enabled: true,
        endpoint: 'arn:aws:sns:us-east-1:123456789:alerts',
        events: ['approval_requested', 'action_blocked'],
      });
      
      // No error means success
      expect(true).toBe(true);
    });
    
    it('should send notifications to configured channels', async () => {
      manager.configureNotificationChannel({
        type: 'sns',
        enabled: true,
        endpoint: 'arn:aws:sns:us-east-1:123456789:alerts',
        events: ['approval_requested'],
      });
      
      const result = await manager.sendNotification({
        event: 'approval_requested',
        timestamp: new Date(),
        title: 'Test Notification',
        message: 'This is a test',
        severity: 'medium',
      });
      
      expect(result.success).toBe(true);
    });
  });
  
  describe('Configuration', () => {
    it('should get current configuration', () => {
      const config = manager.getConfig();
      
      expect(config.defaultRegion).toBe('us-east-1');
      expect(config.rateLimits).toBeDefined();
      expect(config.safetyChecks).toBeDefined();
    });
    
    it('should update configuration', () => {
      manager.updateConfig({
        rateLimits: { maxOperationsPerMinute: 100 },
      });
      
      const config = manager.getConfig();
      expect(config.rateLimits!.maxOperationsPerMinute).toBe(100);
    });
  });
});
