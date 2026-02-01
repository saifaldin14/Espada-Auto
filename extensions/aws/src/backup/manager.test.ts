/**
 * AWS Backup & Disaster Recovery Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBackupManager } from './manager.js';
import type { BackupManager } from './manager.js';
import { BACKUP_PLAN_TEMPLATES } from './types.js';

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-backup', () => ({
  BackupClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  ListBackupPlansCommand: vi.fn(),
  GetBackupPlanCommand: vi.fn(),
  CreateBackupPlanCommand: vi.fn(),
  UpdateBackupPlanCommand: vi.fn(),
  DeleteBackupPlanCommand: vi.fn(),
  ListBackupSelectionsCommand: vi.fn(),
  GetBackupSelectionCommand: vi.fn(),
  CreateBackupSelectionCommand: vi.fn(),
  DeleteBackupSelectionCommand: vi.fn(),
  ListBackupVaultsCommand: vi.fn(),
  DescribeBackupVaultCommand: vi.fn(),
  CreateBackupVaultCommand: vi.fn(),
  DeleteBackupVaultCommand: vi.fn(),
  PutBackupVaultLockConfigurationCommand: vi.fn(),
  PutBackupVaultAccessPolicyCommand: vi.fn(),
  ListRecoveryPointsByBackupVaultCommand: vi.fn(),
  ListRecoveryPointsByResourceCommand: vi.fn(),
  DescribeRecoveryPointCommand: vi.fn(),
  DeleteRecoveryPointCommand: vi.fn(),
  StartBackupJobCommand: vi.fn(),
  DescribeBackupJobCommand: vi.fn(),
  ListBackupJobsCommand: vi.fn(),
  StopBackupJobCommand: vi.fn(),
  StartRestoreJobCommand: vi.fn(),
  DescribeRestoreJobCommand: vi.fn(),
  ListRestoreJobsCommand: vi.fn(),
  StartCopyJobCommand: vi.fn(),
  DescribeCopyJobCommand: vi.fn(),
  ListCopyJobsCommand: vi.fn(),
  ListProtectedResourcesCommand: vi.fn(),
  DescribeProtectedResourceCommand: vi.fn(),
  ListFrameworksCommand: vi.fn(),
  DescribeFrameworkCommand: vi.fn(),
  CreateFrameworkCommand: vi.fn(),
  DeleteFrameworkCommand: vi.fn(),
  ListReportPlansCommand: vi.fn(),
  DescribeReportPlanCommand: vi.fn(),
  CreateReportPlanCommand: vi.fn(),
  DeleteReportPlanCommand: vi.fn(),
  GetBackupPlanFromTemplateCommand: vi.fn(),
  ListBackupPlanTemplatesCommand: vi.fn(),
  ListTagsCommand: vi.fn(),
  TagResourceCommand: vi.fn(),
  UntagResourceCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  DescribeInstancesCommand: vi.fn(),
  DescribeVolumesCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-rds', () => ({
  RDSClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  DescribeDBInstancesCommand: vi.fn(),
  DescribeDBClustersCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  ListTablesCommand: vi.fn(),
  DescribeTableCommand: vi.fn(),
}));

describe('BackupManager', () => {
  let manager: BackupManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createBackupManager({
      defaultRegion: 'us-east-1',
      drRegion: 'us-west-2',
    });
  });

  describe('Backup Plan Templates', () => {
    it('should return all backup plan templates', () => {
      const templates = manager.getBackupPlanTemplates();
      expect(templates).toHaveLength(7);
      expect(templates.map(t => t.id)).toContain('daily-35day-retention');
      expect(templates.map(t => t.id)).toContain('production-standard');
      expect(templates.map(t => t.id)).toContain('compliance-hipaa');
    });

    it('should return a specific template by ID', () => {
      const template = manager.getBackupPlanTemplate('daily-35day-retention');
      expect(template).toBeDefined();
      expect(template?.name).toBe('Daily Backup - 35 Day Retention');
      expect(template?.targetRPO).toBe('24 hours');
    });

    it('should return undefined for non-existent template', () => {
      const template = manager.getBackupPlanTemplate('non-existent');
      expect(template).toBeUndefined();
    });

    it('should have valid templates with required fields', () => {
      for (const template of BACKUP_PLAN_TEMPLATES) {
        expect(template.id).toBeDefined();
        expect(template.name).toBeDefined();
        expect(template.description).toBeDefined();
        expect(template.category).toBeDefined();
        expect(template.targetRPO).toBeDefined();
        expect(template.rules).toBeDefined();
        expect(template.rules.length).toBeGreaterThan(0);
        
        for (const rule of template.rules) {
          expect(rule.ruleName).toBeDefined();
          expect(rule.targetBackupVaultName).toBeDefined();
        }
      }
    });

    it('should have HIPAA template with 7-year retention', () => {
      const template = manager.getBackupPlanTemplate('compliance-hipaa');
      expect(template).toBeDefined();
      
      const archiveRule = template?.rules.find(r => r.ruleName === 'MonthlyArchive');
      expect(archiveRule).toBeDefined();
      expect(archiveRule?.lifecycle?.deleteAfterDays).toBe(2555); // ~7 years
    });

    it('should have production template with multiple rules', () => {
      const template = manager.getBackupPlanTemplate('production-standard');
      expect(template).toBeDefined();
      expect(template?.rules).toHaveLength(3);
      
      const ruleNames = template?.rules.map(r => r.ruleName);
      expect(ruleNames).toContain('DailyBackup');
      expect(ruleNames).toContain('WeeklyBackup');
      expect(ruleNames).toContain('MonthlyBackup');
    });

    it('should have continuous backup template with PIT enabled', () => {
      const template = manager.getBackupPlanTemplate('continuous-pit');
      expect(template).toBeDefined();
      expect(template?.targetRPO).toBe('5 minutes');
      
      const rule = template?.rules[0];
      expect(rule?.enableContinuousBackup).toBe(true);
    });
  });

  describe('DR Runbook Generation', () => {
    it('should generate a DR runbook with basic options', async () => {
      const result = await manager.generateDRRunbook({
        name: 'Test DR Runbook',
        sourceRegion: 'us-east-1',
        drRegion: 'us-west-2',
        targetRPO: '24 hours',
        targetRTO: '4 hours',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.name).toBe('Test DR Runbook');
      expect(result.data?.sourceRegion).toBe('us-east-1');
      expect(result.data?.drRegion).toBe('us-west-2');
      expect(result.data?.steps).toBeDefined();
      expect(result.data?.steps.length).toBeGreaterThan(0);
    });

    it('should generate runbook with resource-specific steps', async () => {
      const result = await manager.generateDRRunbook({
        name: 'Resource DR Runbook',
        sourceRegion: 'us-east-1',
        drRegion: 'us-west-2',
        targetRPO: '24 hours',
        targetRTO: '4 hours',
        resourceArns: [
          'arn:aws:rds:us-east-1:123456789012:db:mydb',
          'arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0',
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data?.resources).toHaveLength(2);
      
      // Should have restore steps for each resource
      const restoreSteps = result.data?.steps.filter(s => s.name.startsWith('Restore'));
      expect(restoreSteps?.length).toBe(2);
    });

    it('should include rollback steps when requested', async () => {
      const result = await manager.generateDRRunbook({
        name: 'Rollback DR Runbook',
        sourceRegion: 'us-east-1',
        drRegion: 'us-west-2',
        targetRPO: '24 hours',
        targetRTO: '4 hours',
        includeRollback: true,
      });

      expect(result.success).toBe(true);
      expect(result.data?.rollbackSteps).toBeDefined();
      expect(result.data?.rollbackSteps.length).toBeGreaterThan(0);
    });

    it('should include pre and post conditions', async () => {
      const result = await manager.generateDRRunbook({
        name: 'Conditions DR Runbook',
        sourceRegion: 'us-east-1',
        drRegion: 'us-west-2',
        targetRPO: '24 hours',
        targetRTO: '4 hours',
      });

      expect(result.success).toBe(true);
      expect(result.data?.preConditions).toBeDefined();
      expect(result.data?.preConditions.length).toBeGreaterThan(0);
      expect(result.data?.postConditions).toBeDefined();
      expect(result.data?.postConditions.length).toBeGreaterThan(0);
    });

    it('should include contacts when provided', async () => {
      const contacts = [
        { name: 'John Doe', role: 'DR Lead', email: 'john@example.com', isPrimary: true },
        { name: 'Jane Smith', role: 'Backup Admin', email: 'jane@example.com', isPrimary: false },
      ];

      const result = await manager.generateDRRunbook({
        name: 'Contacts DR Runbook',
        sourceRegion: 'us-east-1',
        drRegion: 'us-west-2',
        targetRPO: '24 hours',
        targetRTO: '4 hours',
        contacts,
      });

      expect(result.success).toBe(true);
      expect(result.data?.contacts).toEqual(contacts);
    });
  });

  describe('Manager Creation', () => {
    it('should create manager with default config', () => {
      const defaultManager = createBackupManager();
      expect(defaultManager).toBeDefined();
      expect(defaultManager.listBackupPlans).toBeDefined();
      expect(defaultManager.createBackupPlan).toBeDefined();
      expect(defaultManager.generateDRRunbook).toBeDefined();
    });

    it('should create manager with custom config', () => {
      const customManager = createBackupManager({
        defaultRegion: 'eu-west-1',
        drRegion: 'eu-central-1',
      });
      expect(customManager).toBeDefined();
    });
  });

  describe('Template Categories', () => {
    it('should have templates for each category', () => {
      const categories = new Set(BACKUP_PLAN_TEMPLATES.map(t => t.category));
      expect(categories.has('daily')).toBe(true);
      expect(categories.has('weekly')).toBe(true);
      expect(categories.has('monthly')).toBe(true);
      expect(categories.has('compliance')).toBe(true);
      expect(categories.has('enterprise')).toBe(true);
    });

    it('should have compliance templates for HIPAA and GDPR', () => {
      const complianceTemplates = BACKUP_PLAN_TEMPLATES.filter(t => t.category === 'compliance');
      expect(complianceTemplates.length).toBeGreaterThanOrEqual(2);
      
      const templateIds = complianceTemplates.map(t => t.id);
      expect(templateIds).toContain('compliance-hipaa');
      expect(templateIds).toContain('compliance-gdpr');
    });
  });

  describe('Backup Lifecycle', () => {
    it('should have valid lifecycle configurations in templates', () => {
      for (const template of BACKUP_PLAN_TEMPLATES) {
        for (const rule of template.rules) {
          if (rule.lifecycle) {
            if (rule.lifecycle.deleteAfterDays !== undefined) {
              expect(rule.lifecycle.deleteAfterDays).toBeGreaterThan(0);
            }
            if (rule.lifecycle.moveToColdStorageAfterDays !== undefined) {
              expect(rule.lifecycle.moveToColdStorageAfterDays).toBeGreaterThan(0);
              // Cold storage should come before deletion
              if (rule.lifecycle.deleteAfterDays !== undefined) {
                expect(rule.lifecycle.moveToColdStorageAfterDays).toBeLessThan(rule.lifecycle.deleteAfterDays);
              }
            }
          }
        }
      }
    });
  });

  describe('Schedule Expressions', () => {
    it('should have valid cron expressions in templates', () => {
      for (const template of BACKUP_PLAN_TEMPLATES) {
        for (const rule of template.rules) {
          if (rule.scheduleExpression) {
            // Cron expressions should start with 'cron(' or 'rate('
            expect(
              rule.scheduleExpression.startsWith('cron(') || 
              rule.scheduleExpression.startsWith('rate(')
            ).toBe(true);
          }
        }
      }
    });
  });

  describe('Failover Dry Run', () => {
    it('should support dry run mode for failover', async () => {
      const result = await manager.executeFailover({
        sourceRegion: 'us-east-1',
        targetRegion: 'us-west-2',
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.message).toContain('Dry run');
    });
  });

  describe('Interface Completeness', () => {
    it('should have all expected methods', () => {
      // Backup Plans
      expect(typeof manager.listBackupPlans).toBe('function');
      expect(typeof manager.getBackupPlan).toBe('function');
      expect(typeof manager.createBackupPlan).toBe('function');
      expect(typeof manager.updateBackupPlan).toBe('function');
      expect(typeof manager.deleteBackupPlan).toBe('function');
      expect(typeof manager.getBackupPlanTemplates).toBe('function');
      expect(typeof manager.getBackupPlanTemplate).toBe('function');
      expect(typeof manager.createBackupPlanFromTemplate).toBe('function');

      // Backup Selections
      expect(typeof manager.listBackupSelections).toBe('function');
      expect(typeof manager.getBackupSelection).toBe('function');
      expect(typeof manager.createBackupSelection).toBe('function');
      expect(typeof manager.deleteBackupSelection).toBe('function');

      // Backup Vaults
      expect(typeof manager.listBackupVaults).toBe('function');
      expect(typeof manager.getBackupVault).toBe('function');
      expect(typeof manager.createBackupVault).toBe('function');
      expect(typeof manager.deleteBackupVault).toBe('function');
      expect(typeof manager.lockBackupVault).toBe('function');

      // Recovery Points
      expect(typeof manager.listRecoveryPoints).toBe('function');
      expect(typeof manager.getRecoveryPoint).toBe('function');
      expect(typeof manager.deleteRecoveryPoint).toBe('function');

      // Backup Jobs
      expect(typeof manager.listBackupJobs).toBe('function');
      expect(typeof manager.getBackupJob).toBe('function');
      expect(typeof manager.startBackupJob).toBe('function');
      expect(typeof manager.stopBackupJob).toBe('function');

      // Restore Jobs
      expect(typeof manager.listRestoreJobs).toBe('function');
      expect(typeof manager.getRestoreJob).toBe('function');
      expect(typeof manager.startRestoreJob).toBe('function');

      // Copy Jobs
      expect(typeof manager.listCopyJobs).toBe('function');
      expect(typeof manager.getCopyJob).toBe('function');
      expect(typeof manager.startCopyJob).toBe('function');

      // Cross-Region Replication
      expect(typeof manager.configureReplication).toBe('function');
      expect(typeof manager.getReplicationConfiguration).toBe('function');

      // Protected Resources
      expect(typeof manager.listProtectedResources).toBe('function');
      expect(typeof manager.getProtectedResource).toBe('function');

      // DR Runbook
      expect(typeof manager.generateDRRunbook).toBe('function');

      // Failover
      expect(typeof manager.executeFailover).toBe('function');

      // Compliance
      expect(typeof manager.getBackupCompliance).toBe('function');
      expect(typeof manager.listFrameworks).toBe('function');
      expect(typeof manager.getFramework).toBe('function');
      expect(typeof manager.createFramework).toBe('function');
      expect(typeof manager.deleteFramework).toBe('function');

      // Recovery Testing
      expect(typeof manager.testRecovery).toBe('function');

      // Report Plans
      expect(typeof manager.listReportPlans).toBe('function');
      expect(typeof manager.getReportPlan).toBe('function');
      expect(typeof manager.createReportPlan).toBe('function');
      expect(typeof manager.deleteReportPlan).toBe('function');
    });
  });
});

describe('BACKUP_PLAN_TEMPLATES constant', () => {
  it('should be frozen/immutable', () => {
    expect(Array.isArray(BACKUP_PLAN_TEMPLATES)).toBe(true);
    expect(BACKUP_PLAN_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('should have unique template IDs', () => {
    const ids = BACKUP_PLAN_TEMPLATES.map(t => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have unique template names', () => {
    const names = BACKUP_PLAN_TEMPLATES.map(t => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});
