/**
 * AWS Compliance Manager Tests
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { AWSComplianceManager } from './manager.js';
import type {
  ComplianceFramework,
  ComplianceSeverity,
  CreateConfigRuleOptions,
  CreateConformancePackOptions,
  EnforceTagsOptions,
  GenerateReportOptions,
} from './types.js';

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-config-service', () => ({
  ConfigServiceClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  DescribeConfigRulesCommand: vi.fn(),
  DescribeComplianceByConfigRuleCommand: vi.fn(),
  DescribeConformancePacksCommand: vi.fn(),
  DescribeConformancePackComplianceCommand: vi.fn(),
  PutConfigRuleCommand: vi.fn(),
  DeleteConfigRuleCommand: vi.fn(),
  PutConformancePackCommand: vi.fn(),
  DeleteConformancePackCommand: vi.fn(),
  GetComplianceDetailsByConfigRuleCommand: vi.fn(),
  StartConfigRulesEvaluationCommand: vi.fn(),
  DescribeRemediationExecutionStatusCommand: vi.fn(),
  StartRemediationExecutionCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-resource-groups-tagging-api', () => ({
  ResourceGroupsTaggingAPIClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  GetResourcesCommand: vi.fn(),
  TagResourcesCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-securityhub', () => ({
  SecurityHubClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  GetFindingsCommand: vi.fn(),
  BatchUpdateFindingsCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  PutObjectCommand: vi.fn(),
}));

describe('AWSComplianceManager', () => {
  let manager: AWSComplianceManager;
  let mockConfigSend: Mock;
  let mockTaggingSend: Mock;
  let mockSecurityHubSend: Mock;
  let mockS3Send: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    manager = new AWSComplianceManager({
      defaultRegion: 'us-east-1',
    });

    // Get mock send functions
    mockConfigSend = (manager as unknown as { configClient: { send: Mock } }).configClient.send;
    mockTaggingSend = (manager as unknown as { taggingClient: { send: Mock } }).taggingClient.send;
    mockSecurityHubSend = (manager as unknown as { securityHubClient: { send: Mock } }).securityHubClient.send;
    mockS3Send = (manager as unknown as { s3Client: { send: Mock } }).s3Client.send;
  });

  // ==========================================================================
  // Framework Tests
  // ==========================================================================

  describe('Framework Management', () => {
    it('should get all available frameworks', async () => {
      const result = await manager.getFrameworks();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBeGreaterThan(0);

      const frameworks = result.data!;
      const cisFramework = frameworks.find(f => f.id === 'CIS');
      expect(cisFramework).toBeDefined();
      expect(cisFramework?.name).toContain('CIS');
    });

    it('should get specific framework details', async () => {
      const result = await manager.getFramework('CIS');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.id).toBe('CIS');
      expect(result.data!.categories.length).toBeGreaterThan(0);
    });

    it('should return error for unknown framework', async () => {
      const result = await manager.getFramework('UNKNOWN' as ComplianceFramework);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should get controls for a framework', async () => {
      const result = await manager.getControls('CIS');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBeGreaterThan(0);

      const control = result.data![0];
      expect(control.framework).toBe('CIS');
      expect(control.controlId).toBeDefined();
      expect(control.severity).toBeDefined();
    });
  });

  // ==========================================================================
  // Compliance Check Tests
  // ==========================================================================

  describe('Compliance Checks', () => {
    beforeEach(() => {
      mockConfigSend.mockResolvedValue({
        ComplianceByConfigRules: [
          {
            ConfigRuleName: 's3-bucket-public-read-prohibited',
            Compliance: {
              ComplianceType: 'COMPLIANT',
            },
          },
        ],
      });

      mockSecurityHubSend.mockResolvedValue({
        Findings: [],
      });
    });

    it('should check compliance for a framework', async () => {
      const result = await manager.checkCompliance('CIS');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should filter compliance checks by control IDs', async () => {
      const result = await manager.checkCompliance('CIS', {
        controlIds: ['s3-bucket-public-read-prohibited'],
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should filter compliance checks by resource types', async () => {
      const result = await manager.checkCompliance('CIS', {
        resourceTypes: ['AWS::S3::Bucket'],
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should get compliance summary', async () => {
      const result = await manager.getComplianceSummary('CIS');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.framework).toBe('CIS');
      expect(typeof result.data!.totalControls).toBe('number');
      expect(typeof result.data!.compliancePercentage).toBe('number');
    });

    it('should include severity breakdown in summary', async () => {
      const result = await manager.getComplianceSummary('SOC2');

      expect(result.success).toBe(true);
      expect(result.data!.bySeverity).toBeDefined();
      expect(result.data!.bySeverity.critical).toBeDefined();
      expect(result.data!.bySeverity.high).toBeDefined();
    });
  });

  // ==========================================================================
  // Violation Tests
  // ==========================================================================

  describe('Violation Management', () => {
    beforeEach(async () => {
      // Create some violations by running a compliance check
      mockConfigSend.mockResolvedValue({
        ComplianceByConfigRules: [],
      });

      mockSecurityHubSend.mockResolvedValue({
        Findings: [
          {
            Id: 'finding-1',
            GeneratorId: 'arn:aws:securityhub:::ruleset/cis-aws-foundations-benchmark/v/1.2.0/rule/2.1.1',
            Title: 'S3 bucket has public read access',
            Description: 'This S3 bucket allows public read access',
            Compliance: { Status: 'FAILED' },
            Region: 'us-east-1',
            Resources: [
              {
                Type: 'AWS::S3::Bucket',
                Id: 'arn:aws:s3:::test-bucket',
              },
            ],
          },
        ],
      });

      await manager.checkCompliance('CIS');
    });

    it('should list violations', async () => {
      const result = await manager.listViolations();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should filter violations by framework', async () => {
      const result = await manager.listViolations({ framework: 'CIS' });

      expect(result.success).toBe(true);
      if (result.data && result.data.length > 0) {
        expect(result.data.every(v => v.framework === 'CIS')).toBe(true);
      }
    });

    it('should filter violations by severity', async () => {
      const result = await manager.listViolations({ severity: 'critical' });

      expect(result.success).toBe(true);
      if (result.data && result.data.length > 0) {
        expect(result.data.every(v => v.severity === 'critical')).toBe(true);
      }
    });

    it('should sort violations by severity', async () => {
      const result = await manager.listViolations({
        sortBy: 'severity',
        sortOrder: 'desc',
      });

      expect(result.success).toBe(true);
    });

    it('should limit violation results', async () => {
      const result = await manager.listViolations({ limit: 5 });

      expect(result.success).toBe(true);
      expect(result.data!.length).toBeLessThanOrEqual(5);
    });

    it('should suppress a violation', async () => {
      // First get a violation
      const listResult = await manager.listViolations();
      if (listResult.data && listResult.data.length > 0) {
        const violationId = listResult.data[0].violationId;

        const result = await manager.suppressViolation(
          violationId,
          'Approved exception for testing'
        );

        expect(result.success).toBe(true);

        // Verify it's suppressed
        const getResult = await manager.getViolation(violationId);
        expect(getResult.data?.status).toBe('suppressed');
        expect(getResult.data?.exceptionGranted).toBe(true);
      }
    });

    it('should unsuppress a violation', async () => {
      const listResult = await manager.listViolations();
      if (listResult.data && listResult.data.length > 0) {
        const violationId = listResult.data[0].violationId;

        // Suppress first
        await manager.suppressViolation(violationId, 'Test');

        // Then unsuppress
        const result = await manager.unsuppressViolation(violationId);
        expect(result.success).toBe(true);

        const getResult = await manager.getViolation(violationId);
        expect(getResult.data?.status).toBe('open');
        expect(getResult.data?.exceptionGranted).toBe(false);
      }
    });

    it('should return error for unknown violation', async () => {
      const result = await manager.getViolation('non-existent-id');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ==========================================================================
  // Config Rule Tests
  // ==========================================================================

  describe('Config Rule Management', () => {
    it('should list Config rules', async () => {
      mockConfigSend.mockResolvedValueOnce({
        ConfigRules: [
          {
            ConfigRuleName: 'test-rule',
            ConfigRuleArn: 'arn:aws:config:us-east-1:123456789012:config-rule/test-rule',
            ConfigRuleId: 'config-rule-123',
            Description: 'Test rule',
            Source: {
              Owner: 'AWS',
              SourceIdentifier: 'S3_BUCKET_PUBLIC_READ_PROHIBITED',
            },
            ConfigRuleState: 'ACTIVE',
          },
        ],
      });

      const result = await manager.listConfigRules();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBeGreaterThan(0);
    });

    it('should get a specific Config rule', async () => {
      mockConfigSend.mockResolvedValueOnce({
        ConfigRules: [
          {
            ConfigRuleName: 'test-rule',
            ConfigRuleArn: 'arn:aws:config:us-east-1:123456789012:config-rule/test-rule',
            ConfigRuleId: 'config-rule-123',
            Description: 'Test rule',
            Source: {
              Owner: 'AWS',
              SourceIdentifier: 'S3_BUCKET_PUBLIC_READ_PROHIBITED',
            },
            ConfigRuleState: 'ACTIVE',
          },
        ],
      });

      const result = await manager.getConfigRule('test-rule');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.ruleName).toBe('test-rule');
    });

    it('should create a Config rule', async () => {
      // Mock for PutConfigRuleCommand
      mockConfigSend.mockResolvedValueOnce({});
      // Mock for subsequent DescribeConfigRulesCommand (to fetch the created rule)
      mockConfigSend.mockResolvedValueOnce({
        ConfigRules: [
          {
            ConfigRuleName: 'new-test-rule',
            ConfigRuleArn: 'arn:aws:config:us-east-1:123456789012:config-rule/new-test-rule',
            ConfigRuleId: 'config-rule-456',
            Description: 'New test rule',
            Source: {
              Owner: 'AWS',
              SourceIdentifier: 'S3_BUCKET_PUBLIC_READ_PROHIBITED',
            },
            ConfigRuleState: 'ACTIVE',
          },
        ],
      });

      const options: CreateConfigRuleOptions = {
        ruleName: 'new-test-rule',
        description: 'New test rule',
        sourceType: 'AWS',
        sourceIdentifier: 'S3_BUCKET_PUBLIC_READ_PROHIBITED',
        resourceTypes: ['AWS::S3::Bucket'],
      };

      const result = await manager.createConfigRule(options);

      expect(result.success).toBe(true);
      expect(mockConfigSend).toHaveBeenCalled();
    });

    it('should delete a Config rule', async () => {
      mockConfigSend.mockResolvedValueOnce({});

      const result = await manager.deleteConfigRule('test-rule');

      expect(result.success).toBe(true);
      expect(result.message).toContain('deleted');
    });

    it('should get Config rule compliance', async () => {
      mockConfigSend.mockResolvedValueOnce({
        ComplianceByConfigRules: [
          {
            ConfigRuleName: 'test-rule',
            Compliance: {
              ComplianceType: 'COMPLIANT',
              ComplianceContributorCount: { CappedCount: 5 },
            },
          },
        ],
      });

      const result = await manager.getConfigRuleCompliance('test-rule');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.ruleName).toBe('test-rule');
      expect(result.data!.complianceType).toBeDefined();
    });

    it('should get Config rule compliance details', async () => {
      mockConfigSend.mockResolvedValueOnce({
        EvaluationResults: [
          {
            EvaluationResultIdentifier: {
              EvaluationResultQualifier: {
                ResourceType: 'AWS::S3::Bucket',
                ResourceId: 'test-bucket',
              },
            },
            ComplianceType: 'COMPLIANT',
            ResultRecordedTime: new Date(),
          },
        ],
      });

      const result = await manager.getConfigRuleComplianceDetails('test-rule');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should start Config rules evaluation', async () => {
      mockConfigSend.mockResolvedValueOnce({});

      const result = await manager.startConfigRulesEvaluation(['test-rule']);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Started evaluation');
    });
  });

  // ==========================================================================
  // Conformance Pack Tests
  // ==========================================================================

  describe('Conformance Pack Management', () => {
    it('should list conformance packs', async () => {
      mockConfigSend.mockResolvedValueOnce({
        ConformancePackDetails: [
          {
            ConformancePackName: 'test-pack',
            ConformancePackArn: 'arn:aws:config:us-east-1:123456789012:conformance-pack/test-pack',
            ConformancePackId: 'conformance-pack-123',
            DeliveryS3Bucket: 'config-bucket',
            LastUpdateRequestedTime: new Date(),
          },
        ],
      });

      const result = await manager.listConformancePacks();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should get a specific conformance pack', async () => {
      mockConfigSend.mockResolvedValueOnce({
        ConformancePackDetails: [
          {
            ConformancePackName: 'test-pack',
            ConformancePackArn: 'arn:aws:config:us-east-1:123456789012:conformance-pack/test-pack',
            ConformancePackId: 'conformance-pack-123',
            DeliveryS3Bucket: 'config-bucket',
            LastUpdateRequestedTime: new Date(),
          },
        ],
      });

      const result = await manager.getConformancePack('test-pack');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.packName).toBe('test-pack');
    });

    it('should create a conformance pack', async () => {
      // Mock for PutConformancePackCommand
      mockConfigSend.mockResolvedValueOnce({});
      // Mock for subsequent DescribeConformancePacksCommand (to fetch the created pack)
      mockConfigSend.mockResolvedValueOnce({
        ConformancePackDetails: [
          {
            ConformancePackName: 'new-test-pack',
            ConformancePackArn: 'arn:aws:config:us-east-1:123456789012:conformance-pack/new-test-pack',
            ConformancePackId: 'conformance-pack-456',
            DeliveryS3Bucket: 'config-bucket',
            LastUpdateRequestedTime: new Date(),
          },
        ],
      });

      const options: CreateConformancePackOptions = {
        packName: 'new-test-pack',
        templateBody: 'AWSTemplateFormatVersion: "2010-09-09"\nDescription: Test',
        deliveryS3Bucket: 'config-bucket',
      };

      const result = await manager.createConformancePack(options);

      expect(result.success).toBe(true);
      expect(mockConfigSend).toHaveBeenCalled();
    });

    it('should delete a conformance pack', async () => {
      mockConfigSend.mockResolvedValueOnce({});

      const result = await manager.deleteConformancePack('test-pack');

      expect(result.success).toBe(true);
      expect(result.message).toContain('deleted');
    });

    it('should get conformance pack compliance', async () => {
      mockConfigSend.mockResolvedValueOnce({
        ConformancePackRuleComplianceList: [
          {
            ConfigRuleName: 's3-bucket-public-read-prohibited',
            ComplianceType: 'COMPLIANT',
          },
        ],
      });

      const result = await manager.getConformancePackCompliance('test-pack');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should deploy conformance pack from template', async () => {
      // Mock for PutConformancePackCommand
      mockConfigSend.mockResolvedValueOnce({});
      // Mock for subsequent DescribeConformancePacksCommand
      mockConfigSend.mockResolvedValueOnce({
        ConformancePackDetails: [
          {
            ConformancePackName: 'cis-aws-foundations-123456',
            ConformancePackArn: 'arn:aws:config:us-east-1:123456789012:conformance-pack/cis-aws-foundations',
            ConformancePackId: 'conformance-pack-789',
            LastUpdateRequestedTime: new Date(),
          },
        ],
      });

      const result = await manager.deployConformancePackFromTemplate('cis-aws-foundations');

      expect(result.success).toBe(true);
    });

    it('should return error for unknown template', async () => {
      const result = await manager.deployConformancePackFromTemplate('unknown-template');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ==========================================================================
  // Tag Compliance Tests
  // ==========================================================================

  describe('Tag Compliance', () => {
    beforeEach(() => {
      mockTaggingSend.mockResolvedValue({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:s3:::test-bucket-1',
            Tags: [
              { Key: 'Environment', Value: 'Production' },
              { Key: 'Owner', Value: 'team-a' },
            ],
          },
          {
            ResourceARN: 'arn:aws:s3:::test-bucket-2',
            Tags: [
              { Key: 'Environment', Value: 'Development' },
            ],
          },
          {
            ResourceARN: 'arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0',
            Tags: [],
          },
        ],
      });
    });

    it('should check tag compliance', async () => {
      const options: EnforceTagsOptions = {
        requiredTags: [
          { key: 'Environment' },
          { key: 'Owner' },
        ],
        mode: 'audit',
      };

      const result = await manager.checkTagCompliance(options);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.totalChecked).toBe(3);
      expect(result.data!.compliant).toBe(1); // Only first bucket has both tags
      expect(result.data!.nonCompliant).toBe(2);
    });

    it('should check tag compliance with allowed values', async () => {
      const options: EnforceTagsOptions = {
        requiredTags: [
          {
            key: 'Environment',
            allowedValues: ['Production', 'Staging', 'Development'],
          },
        ],
        mode: 'audit',
      };

      const result = await manager.checkTagCompliance(options);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should check tag compliance with value pattern', async () => {
      const options: EnforceTagsOptions = {
        requiredTags: [
          {
            key: 'Owner',
            valuePattern: '^team-[a-z]+$',
          },
        ],
        mode: 'audit',
      };

      const result = await manager.checkTagCompliance(options);

      expect(result.success).toBe(true);
    });

    it('should perform dry run remediation', async () => {
      const options: EnforceTagsOptions = {
        requiredTags: [
          { key: 'Environment', defaultValue: 'Unknown' },
          { key: 'Owner', defaultValue: 'unassigned' },
        ],
        mode: 'remediate',
        dryRun: true,
        applyDefaults: true,
      };

      const result = await manager.checkTagCompliance(options);

      expect(result.success).toBe(true);
      expect(result.data!.dryRun).toBe(true);
      expect(result.data!.remediated).toBe(0); // Dry run doesn't remediate
    });

    it('should enforce tag policy', async () => {
      const options: EnforceTagsOptions = {
        requiredTags: [
          { key: 'CostCenter', defaultValue: 'default' },
        ],
        mode: 'remediate',
        dryRun: true,
      };

      const result = await manager.enforceTagPolicy(options);

      expect(result.success).toBe(true);
      expect(result.data!.mode).toBe('remediate');
    });

    it('should return error when no tags specified', async () => {
      const result = await manager.checkTagCompliance({ mode: 'audit' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No required tags');
    });
  });

  // ==========================================================================
  // Tag Policy Tests
  // ==========================================================================

  describe('Tag Policy Management', () => {
    it('should create a tag policy', async () => {
      const result = await manager.createTagPolicy({
        name: 'Standard Tags',
        description: 'Standard tagging policy',
        requiredTags: [
          { key: 'Environment', allowedValues: ['Production', 'Staging', 'Development'] },
          { key: 'Owner' },
          { key: 'CostCenter' },
        ],
        resourceTypes: ['AWS::S3::Bucket', 'AWS::EC2::Instance'],
        enforcementMode: 'audit',
        isActive: true,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.policyId).toBeDefined();
      expect(result.data!.name).toBe('Standard Tags');
    });

    it('should list tag policies', async () => {
      // Create a policy first
      await manager.createTagPolicy({
        name: 'Test Policy',
        description: 'Test',
        requiredTags: [{ key: 'Test' }],
        resourceTypes: [],
        enforcementMode: 'audit',
        isActive: true,
      });

      const result = await manager.listTagPolicies();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBeGreaterThan(0);
    });

    it('should delete a tag policy', async () => {
      // Create a policy first
      const createResult = await manager.createTagPolicy({
        name: 'To Delete',
        description: 'Will be deleted',
        requiredTags: [{ key: 'Test' }],
        resourceTypes: [],
        enforcementMode: 'audit',
        isActive: true,
      });

      const policyId = createResult.data!.policyId;

      const result = await manager.deleteTagPolicy(policyId);

      expect(result.success).toBe(true);
      expect(result.message).toContain('deleted');
    });

    it('should return error when deleting unknown policy', async () => {
      const result = await manager.deleteTagPolicy('unknown-policy-id');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should use tag policy in compliance check', async () => {
      // Setup tagging mock for this test
      mockTaggingSend.mockResolvedValueOnce({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:s3:::test-bucket-1',
            Tags: [
              { Key: 'Environment', Value: 'Production' },
              { Key: 'Owner', Value: 'team-a' },
            ],
          },
        ],
      });

      // Create a policy
      const createResult = await manager.createTagPolicy({
        name: 'Check Policy',
        description: 'For compliance check',
        requiredTags: [
          { key: 'Environment' },
          { key: 'Owner' },
        ],
        resourceTypes: ['AWS::S3::Bucket'],
        enforcementMode: 'audit',
        isActive: true,
      });

      const result = await manager.checkTagCompliance({
        policyId: createResult.data!.policyId,
        mode: 'audit',
      });

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Remediation Tests
  // ==========================================================================

  describe('Remediation', () => {
    beforeEach(async () => {
      // Create violations
      mockConfigSend.mockResolvedValue({
        ComplianceByConfigRules: [],
      });

      mockSecurityHubSend.mockResolvedValue({
        Findings: [
          {
            Id: 'finding-1',
            GeneratorId: 'arn:aws:securityhub:::ruleset/cis-aws-foundations-benchmark',
            Title: 'S3 bucket has public read access',
            Description: 'Test finding',
            Compliance: { Status: 'FAILED' },
            Region: 'us-east-1',
            Resources: [
              {
                Type: 'AWS::S3::Bucket',
                Id: 'arn:aws:s3:::test-bucket',
              },
            ],
          },
        ],
      });

      await manager.checkCompliance('CIS');
    });

    it('should list available remediation actions', async () => {
      const result = await manager.listRemediationActions();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBeGreaterThan(0);

      const action = result.data![0];
      expect(action.actionType).toBeDefined();
      expect(action.targetType).toBeDefined();
    });

    it('should perform dry run remediation', async () => {
      const listResult = await manager.listViolations();

      if (listResult.data && listResult.data.length > 0) {
        const violation = listResult.data[0];

        const result = await manager.remediateViolation({
          violationId: violation.violationId,
          dryRun: true,
        });

        if (violation.autoRemediationAvailable) {
          expect(result.success).toBe(true);
          expect(result.message).toContain('Dry run');
        }
      }
    });

    it('should return error for unknown violation', async () => {
      const result = await manager.remediateViolation({
        violationId: 'unknown-violation-id',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should get remediation status', async () => {
      // This will return not found since we haven't started a real remediation
      const result = await manager.getRemediationStatus('unknown-remediation-id');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ==========================================================================
  // Reporting Tests
  // ==========================================================================

  describe('Compliance Reporting', () => {
    beforeEach(() => {
      mockConfigSend.mockResolvedValue({
        ComplianceByConfigRules: [
          {
            ConfigRuleName: 's3-bucket-public-read-prohibited',
            Compliance: { ComplianceType: 'COMPLIANT' },
          },
        ],
      });

      mockSecurityHubSend.mockResolvedValue({
        Findings: [],
      });

      mockS3Send.mockResolvedValue({});
    });

    it('should generate JSON report', async () => {
      const options: GenerateReportOptions = {
        type: 'executive_summary',
        framework: 'CIS',
        format: 'json',
      };

      const result = await manager.generateReport(options);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.format).toBe('json');
      expect(result.data!.content).toBeDefined();

      // Verify JSON is valid
      const content = JSON.parse(result.data!.content!);
      expect(content.summary).toBeDefined();
    });

    it('should generate CSV report', async () => {
      const options: GenerateReportOptions = {
        type: 'detailed_findings',
        framework: 'SOC2',
        format: 'csv',
      };

      const result = await manager.generateReport(options);

      expect(result.success).toBe(true);
      expect(result.data!.format).toBe('csv');
      expect(result.data!.content).toContain('Violation ID');
    });

    it('should generate HTML report', async () => {
      const options: GenerateReportOptions = {
        type: 'framework_assessment',
        framework: 'HIPAA',
        format: 'html',
        includeResourceDetails: true,
      };

      const result = await manager.generateReport(options);

      expect(result.success).toBe(true);
      expect(result.data!.format).toBe('html');
      expect(result.data!.content).toContain('<!DOCTYPE html>');
      expect(result.data!.content).toContain('HIPAA');
    });

    it('should upload report to S3', async () => {
      const options: GenerateReportOptions = {
        type: 'executive_summary',
        framework: 'PCI-DSS',
        format: 'json',
        s3Bucket: 'compliance-reports-bucket',
        s3KeyPrefix: 'reports/2024',
      };

      const result = await manager.generateReport(options);

      expect(result.success).toBe(true);
      expect(result.data!.s3Location).toContain('s3://compliance-reports-bucket');
      expect(mockS3Send).toHaveBeenCalled();
    });

    it('should include trend analysis in report', async () => {
      const options: GenerateReportOptions = {
        type: 'trend_analysis',
        framework: 'AWS-Foundational-Security',
        format: 'json',
        includeTrendAnalysis: true,
      };

      const result = await manager.generateReport(options);

      expect(result.success).toBe(true);
      expect(result.data!.summary).toBeDefined();
    });

    it('should list reports', async () => {
      // Generate a report first
      await manager.generateReport({
        type: 'executive_summary',
        framework: 'CIS',
        format: 'json',
      });

      const result = await manager.listReports();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBeGreaterThan(0);
    });

    it('should filter reports by framework', async () => {
      // Generate reports for different frameworks
      await manager.generateReport({
        type: 'executive_summary',
        framework: 'CIS',
        format: 'json',
      });

      await manager.generateReport({
        type: 'executive_summary',
        framework: 'SOC2',
        format: 'json',
      });

      const result = await manager.listReports('CIS');

      expect(result.success).toBe(true);
      expect(result.data!.every(r => r.framework === 'CIS')).toBe(true);
    });

    it('should get a specific report', async () => {
      // Generate a report
      const generateResult = await manager.generateReport({
        type: 'executive_summary',
        framework: 'CIS',
        format: 'json',
      });

      const reportId = generateResult.data!.reportId;

      const result = await manager.getReport(reportId);

      expect(result.success).toBe(true);
      expect(result.data!.reportId).toBe(reportId);
    });

    it('should return error for unknown report', async () => {
      const result = await manager.getReport('unknown-report-id');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should include recommendations in report', async () => {
      const result = await manager.generateReport({
        type: 'executive_summary',
        framework: 'CIS',
        format: 'json',
      });

      expect(result.success).toBe(true);
      expect(result.data!.summary.topRecommendations).toBeDefined();
      expect(result.data!.summary.topRecommendations.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle Config service errors gracefully', async () => {
      mockConfigSend.mockRejectedValue(new Error('AWS Config service error'));

      const result = await manager.listConfigRules();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to list Config rules');
    });

    it('should handle Security Hub errors gracefully', async () => {
      mockConfigSend.mockResolvedValue({ ComplianceByConfigRules: [] });
      mockSecurityHubSend.mockRejectedValue(new Error('Security Hub error'));

      // Should still succeed, just without Security Hub data
      const result = await manager.checkCompliance('CIS');

      expect(result.success).toBe(true);
    });

    it('should handle S3 upload errors', async () => {
      mockConfigSend.mockResolvedValue({ ComplianceByConfigRules: [] });
      mockSecurityHubSend.mockResolvedValue({ Findings: [] });
      mockS3Send.mockRejectedValue(new Error('S3 upload failed'));

      const result = await manager.generateReport({
        type: 'executive_summary',
        framework: 'CIS',
        format: 'json',
        s3Bucket: 'test-bucket',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to generate report');
    });

    it('should handle tagging API errors', async () => {
      mockTaggingSend.mockRejectedValue(new Error('Tagging API error'));

      const result = await manager.checkTagCompliance({
        requiredTags: [{ key: 'Test' }],
        mode: 'audit',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to check tag compliance');
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('Integration Scenarios', () => {
    it('should perform end-to-end compliance check and reporting', async () => {
      // Setup mocks
      mockConfigSend.mockResolvedValue({
        ComplianceByConfigRules: [
          { ConfigRuleName: 's3-bucket-public-read-prohibited', Compliance: { ComplianceType: 'COMPLIANT' } },
          { ConfigRuleName: 'iam-user-mfa-enabled', Compliance: { ComplianceType: 'NON_COMPLIANT' } },
        ],
      });

      mockSecurityHubSend.mockResolvedValue({
        Findings: [
          {
            Id: 'finding-1',
            GeneratorId: 'test',
            Title: 'MFA not enabled',
            Description: 'IAM user does not have MFA',
            Compliance: { Status: 'FAILED' },
            Severity: { Label: 'HIGH' },
            Region: 'us-east-1',
            Resources: [{ Type: 'AWS::IAM::User', Id: 'arn:aws:iam::123456789012:user/test-user' }],
          },
        ],
      });

      // 1. Check compliance
      const checkResult = await manager.checkCompliance('CIS');
      expect(checkResult.success).toBe(true);

      // 2. Get summary
      const summaryResult = await manager.getComplianceSummary('CIS');
      expect(summaryResult.success).toBe(true);

      // 3. List violations
      const violationsResult = await manager.listViolations({ framework: 'CIS' });
      expect(violationsResult.success).toBe(true);

      // 4. Generate report
      const reportResult = await manager.generateReport({
        type: 'executive_summary',
        framework: 'CIS',
        format: 'json',
        includeResourceDetails: true,
      });
      expect(reportResult.success).toBe(true);
      expect(reportResult.data!.summary.complianceScore).toBeDefined();
    });

    it('should manage tag compliance with policy', async () => {
      mockTaggingSend.mockResolvedValue({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:s3:::bucket-1',
            Tags: [{ Key: 'Environment', Value: 'Production' }],
          },
        ],
      });

      // 1. Create tag policy
      const policyResult = await manager.createTagPolicy({
        name: 'Mandatory Tags',
        description: 'All resources must have these tags',
        requiredTags: [
          { key: 'Environment', allowedValues: ['Production', 'Development', 'Staging'] },
          { key: 'Owner' },
          { key: 'CostCenter' },
        ],
        resourceTypes: ['AWS::S3::Bucket'],
        enforcementMode: 'audit',
        isActive: true,
      });
      expect(policyResult.success).toBe(true);

      // 2. Check compliance using policy
      const complianceResult = await manager.checkTagCompliance({
        policyId: policyResult.data!.policyId,
        mode: 'audit',
      });
      expect(complianceResult.success).toBe(true);
      expect(complianceResult.data!.nonCompliant).toBe(1); // Missing Owner and CostCenter

      // 3. List policies
      const listResult = await manager.listTagPolicies();
      expect(listResult.success).toBe(true);
      expect(listResult.data!.length).toBe(1);
    });

    it('should deploy and check conformance pack', async () => {
      // Mock for PutConformancePackCommand
      mockConfigSend.mockResolvedValueOnce({});
      // Mock for DescribeConformancePacksCommand (called after put)
      mockConfigSend.mockResolvedValueOnce({
        ConformancePackDetails: [
          {
            ConformancePackName: 'cis-aws-foundations-123456',
            ConformancePackArn: 'arn:aws:config:us-east-1:123456789012:conformance-pack/cis-aws-foundations',
            ConformancePackId: 'cp-123',
          },
        ],
      });
      // Mock for DescribeConformancePackComplianceCommand
      mockConfigSend.mockResolvedValueOnce({
        ConformancePackRuleComplianceList: [
          { ConfigRuleName: 'iam-root-access-key-check', ComplianceType: 'COMPLIANT' },
          { ConfigRuleName: 'iam-user-mfa-enabled', ComplianceType: 'NON_COMPLIANT' },
        ],
      });

      // 1. Deploy conformance pack
      const deployResult = await manager.deployConformancePackFromTemplate('cis-aws-foundations');
      expect(deployResult.success).toBe(true);

      // 2. Get compliance
      const complianceResult = await manager.getConformancePackCompliance('cis-aws-foundations');
      expect(complianceResult.success).toBe(true);
      expect(complianceResult.data!.length).toBe(2);
    });
  });
});
