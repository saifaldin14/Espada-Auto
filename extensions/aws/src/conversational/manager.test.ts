/**
 * AWS Enhanced Conversational UX Manager Tests
 *
 * Comprehensive test suite for infrastructure context management,
 * proactive insights, natural language queries, and wizard mode.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AWSConversationalManager,
  createConversationalManager,
  WIZARD_TEMPLATES,
  INSIGHT_CHECKS,
  QUERY_PATTERNS,
} from './index.js';
import type {
  ResourceReference,
  OperationRecord,
  ResourceFilter,
  WizardState,
} from './types.js';

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  DescribeInstancesCommand: vi.fn(),
  DescribeVolumesCommand: vi.fn(),
  DescribeSecurityGroupsCommand: vi.fn(),
  DescribeAddressesCommand: vi.fn(),
  DescribeSnapshotsCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-rds', () => ({
  RDSClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  DescribeDBInstancesCommand: vi.fn(),
  DescribeDBClustersCommand: vi.fn(),
  DescribePendingMaintenanceActionsCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  ListFunctionsCommand: vi.fn(),
  GetFunctionCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  ListBucketsCommand: vi.fn(),
  GetBucketPolicyStatusCommand: vi.fn(),
  GetBucketEncryptionCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  DescribeAlarmsCommand: vi.fn(),
  GetMetricStatisticsCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-iam', () => ({
  IAMClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  ListUsersCommand: vi.fn(),
  ListAccessKeysCommand: vi.fn(),
  GetAccessKeyLastUsedCommand: vi.fn(),
  GetAccountSummaryCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-resource-groups-tagging-api', () => ({
  ResourceGroupsTaggingAPIClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({ ResourceTagMappingList: [] }),
  })),
  GetResourcesCommand: vi.fn(),
}));

describe('AWSConversationalManager', () => {
  let manager: AWSConversationalManager;

  beforeEach(() => {
    manager = createConversationalManager({
      defaultRegion: 'us-east-1',
    });
  });

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe('createConversationalManager', () => {
    it('should create manager with default config', () => {
      const mgr = createConversationalManager();
      expect(mgr).toBeInstanceOf(AWSConversationalManager);
      const context = mgr.getContext();
      expect(context.activeRegion).toBe('us-east-1');
    });

    it('should create manager with custom config', () => {
      const mgr = createConversationalManager({
        defaultRegion: 'eu-west-1',
        maxRecentResources: 25,
        maxSessionHistory: 50,
      });
      const context = mgr.getContext();
      expect(context.activeRegion).toBe('eu-west-1');
    });
  });

  // ===========================================================================
  // Context Management Tests
  // ===========================================================================

  describe('Context Management', () => {
    describe('getContext', () => {
      it('should return current context', () => {
        const context = manager.getContext();
        expect(context).toBeDefined();
        expect(context.sessionId).toBeDefined();
        expect(context.sessionStarted).toBeInstanceOf(Date);
        expect(context.recentResources).toEqual([]);
        expect(context.activeRegion).toBe('us-east-1');
        expect(context.sessionHistory).toEqual([]);
        expect(context.pinnedResources).toEqual([]);
        expect(context.activeFilters).toEqual([]);
        expect(context.variables).toEqual({});
      });

      it('should update lastActivity on access', () => {
        const context1 = manager.getContext();
        const time1 = context1.lastActivity;

        // Second access should have same or later timestamp
        const context2 = manager.getContext();
        expect(context2.lastActivity.getTime()).toBeGreaterThanOrEqual(time1.getTime());
      });
    });

    describe('setActiveRegion', () => {
      it('should update active region', () => {
        manager.setActiveRegion('eu-west-1');
        const context = manager.getContext();
        expect(context.activeRegion).toBe('eu-west-1');
      });
    });

    describe('setActiveAccount', () => {
      it('should update active account', () => {
        manager.setActiveAccount('123456789012');
        const context = manager.getContext();
        expect(context.activeAccount).toBe('123456789012');
      });
    });

    describe('setEnvironment', () => {
      it('should update environment', () => {
        manager.setEnvironment('production');
        const context = manager.getContext();
        expect(context.environment).toBe('production');
      });

      it('should accept different environment types', () => {
        const environments = ['dev', 'development', 'staging', 'uat', 'production', 'prod', 'test', 'sandbox'] as const;
        for (const env of environments) {
          manager.setEnvironment(env);
          const context = manager.getContext();
          expect(context.environment).toBe(env);
        }
      });
    });

    describe('addRecentResource', () => {
      it('should add new resource to recent resources', () => {
        const resource: ResourceReference = {
          type: 'ec2:instance',
          id: 'i-1234567890abcdef0',
          name: 'web-server-1',
          region: 'us-east-1',
          lastAccessed: new Date(),
          accessCount: 1,
        };

        manager.addRecentResource(resource);
        const context = manager.getContext();
        expect(context.recentResources).toHaveLength(1);
        expect(context.recentResources[0].id).toBe('i-1234567890abcdef0');
      });

      it('should increment access count for existing resource', () => {
        const resource: ResourceReference = {
          type: 'ec2:instance',
          id: 'i-1234567890abcdef0',
          name: 'web-server-1',
          region: 'us-east-1',
          lastAccessed: new Date(),
          accessCount: 1,
        };

        manager.addRecentResource(resource);
        manager.addRecentResource(resource);

        const context = manager.getContext();
        expect(context.recentResources).toHaveLength(1);
        expect(context.recentResources[0].accessCount).toBe(2);
      });

      it('should move existing resource to front', () => {
        const resource1: ResourceReference = {
          type: 'ec2:instance',
          id: 'i-111',
          name: 'server-1',
          region: 'us-east-1',
          lastAccessed: new Date(),
          accessCount: 1,
        };

        const resource2: ResourceReference = {
          type: 'ec2:instance',
          id: 'i-222',
          name: 'server-2',
          region: 'us-east-1',
          lastAccessed: new Date(),
          accessCount: 1,
        };

        manager.addRecentResource(resource1);
        manager.addRecentResource(resource2);
        manager.addRecentResource(resource1);

        const context = manager.getContext();
        expect(context.recentResources[0].id).toBe('i-111');
        expect(context.recentResources[1].id).toBe('i-222');
      });

      it('should respect maxRecentResources limit', () => {
        const mgr = createConversationalManager({ maxRecentResources: 3 });

        for (let i = 0; i < 5; i++) {
          mgr.addRecentResource({
            type: 'ec2:instance',
            id: `i-${i}`,
            name: `server-${i}`,
            region: 'us-east-1',
            lastAccessed: new Date(),
            accessCount: 1,
          });
        }

        const context = mgr.getContext();
        expect(context.recentResources).toHaveLength(3);
        expect(context.recentResources[0].id).toBe('i-4');
      });
    });

    describe('pinResource / unpinResource', () => {
      it('should pin a resource', () => {
        const resource: ResourceReference = {
          type: 's3:bucket',
          id: 'my-bucket',
          name: 'my-bucket',
          region: 'us-east-1',
          lastAccessed: new Date(),
          accessCount: 1,
        };

        manager.pinResource(resource);
        const context = manager.getContext();
        expect(context.pinnedResources).toHaveLength(1);
        expect(context.pinnedResources[0].id).toBe('my-bucket');
      });

      it('should not duplicate pinned resources', () => {
        const resource: ResourceReference = {
          type: 's3:bucket',
          id: 'my-bucket',
          name: 'my-bucket',
          region: 'us-east-1',
          lastAccessed: new Date(),
          accessCount: 1,
        };

        manager.pinResource(resource);
        manager.pinResource(resource);

        const context = manager.getContext();
        expect(context.pinnedResources).toHaveLength(1);
      });

      it('should unpin a resource', () => {
        const resource: ResourceReference = {
          type: 's3:bucket',
          id: 'my-bucket',
          name: 'my-bucket',
          region: 'us-east-1',
          lastAccessed: new Date(),
          accessCount: 1,
        };

        manager.pinResource(resource);
        manager.unpinResource('my-bucket');

        const context = manager.getContext();
        expect(context.pinnedResources).toHaveLength(0);
      });
    });

    describe('Filter Management', () => {
      it('should add filter', () => {
        const filter: ResourceFilter = {
          id: 'f1',
          name: 'region-filter',
          type: 'region',
          operator: 'equals',
          value: 'us-east-1',
          active: true,
        };

        manager.addFilter(filter);
        const context = manager.getContext();
        expect(context.activeFilters).toHaveLength(1);
        expect(context.activeFilters[0].id).toBe('f1');
      });

      it('should remove filter', () => {
        const filter: ResourceFilter = {
          id: 'f1',
          name: 'region-filter',
          type: 'region',
          operator: 'equals',
          value: 'us-east-1',
          active: true,
        };

        manager.addFilter(filter);
        manager.removeFilter('f1');

        const context = manager.getContext();
        expect(context.activeFilters).toHaveLength(0);
      });

      it('should clear all filters', () => {
        manager.addFilter({
          id: 'f1',
          name: 'filter-1',
          type: 'region',
          operator: 'equals',
          value: 'us-east-1',
          active: true,
        });
        manager.addFilter({
          id: 'f2',
          name: 'filter-2',
          type: 'environment',
          operator: 'equals',
          value: 'production',
          active: true,
        });

        manager.clearFilters();
        const context = manager.getContext();
        expect(context.activeFilters).toHaveLength(0);
      });
    });

    describe('Variable Management', () => {
      it('should set and get variable', () => {
        manager.setVariable('project', 'alpha');
        expect(manager.getVariable('project')).toBe('alpha');
      });

      it('should return undefined for non-existent variable', () => {
        expect(manager.getVariable('nonexistent')).toBeUndefined();
      });

      it('should overwrite existing variable', () => {
        manager.setVariable('project', 'alpha');
        manager.setVariable('project', 'beta');
        expect(manager.getVariable('project')).toBe('beta');
      });
    });

    describe('clearSession', () => {
      it('should reset context to initial state', () => {
        // Set up some state
        manager.setActiveRegion('eu-west-1');
        manager.setEnvironment('production');
        manager.addRecentResource({
          type: 'ec2:instance',
          id: 'i-123',
          name: 'server',
          region: 'eu-west-1',
          lastAccessed: new Date(),
          accessCount: 1,
        });
        manager.setVariable('test', 'value');

        // Clear session
        manager.clearSession();

        const context = manager.getContext();
        expect(context.recentResources).toHaveLength(0);
        expect(context.activeRegion).toBe('us-east-1');
        expect(context.environment).toBeUndefined();
        expect(context.sessionHistory).toHaveLength(0);
        expect(context.pinnedResources).toHaveLength(0);
        expect(context.variables).toEqual({});
      });

      it('should generate new session ID', () => {
        const oldSessionId = manager.getContext().sessionId;
        manager.clearSession();
        const newSessionId = manager.getContext().sessionId;
        expect(newSessionId).not.toBe(oldSessionId);
      });
    });

    describe('recordOperation', () => {
      it('should record operation to history', () => {
        const operation: OperationRecord = {
          id: 'op1',
          action: 'describe-instances',
          service: 'EC2',
          resources: [],
          timestamp: new Date(),
          status: 'success',
          durationMs: 150,
        };

        manager.recordOperation(operation);
        const context = manager.getContext();
        expect(context.sessionHistory).toHaveLength(1);
        expect(context.sessionHistory[0].id).toBe('op1');
      });

      it('should add accessed resources to recent', () => {
        const resource: ResourceReference = {
          type: 'ec2:instance',
          id: 'i-123',
          name: 'server',
          region: 'us-east-1',
          lastAccessed: new Date(),
          accessCount: 1,
        };

        const operation: OperationRecord = {
          id: 'op1',
          action: 'describe-instances',
          service: 'EC2',
          resources: [resource],
          timestamp: new Date(),
          status: 'success',
        };

        manager.recordOperation(operation);
        const context = manager.getContext();
        expect(context.recentResources).toHaveLength(1);
        expect(context.recentResources[0].id).toBe('i-123');
      });

      it('should respect maxSessionHistory limit', () => {
        const mgr = createConversationalManager({ maxSessionHistory: 3 });

        for (let i = 0; i < 5; i++) {
          mgr.recordOperation({
            id: `op${i}`,
            action: `action-${i}`,
            service: 'EC2',
            resources: [],
            timestamp: new Date(),
            status: 'success',
          });
        }

        const context = mgr.getContext();
        expect(context.sessionHistory).toHaveLength(3);
        expect(context.sessionHistory[0].id).toBe('op4');
      });
    });
  });

  // ===========================================================================
  // Natural Language Query Tests
  // ===========================================================================

  describe('Natural Language Queries', () => {
    describe('parseQuery', () => {
      it('should parse simple list query', async () => {
        const result = await manager.parseQuery('list all EC2 instances');
        expect(result.success).toBe(true);
        expect(result.data?.intent).toBe('list');
        expect(result.data?.resourceTypes).toContain('ec2:instance');
      });

      it('should detect count intent', async () => {
        const result = await manager.parseQuery('how many Lambda functions do I have?');
        expect(result.success).toBe(true);
        expect(result.data?.intent).toBe('count');
        expect(result.data?.resourceTypes).toContain('lambda:function');
      });

      it('should parse time range expressions', async () => {
        const result = await manager.parseQuery('find resources created in the last 24 hours');
        expect(result.success).toBe(true);
        expect(result.data?.timeRange?.type).toBe('last-day');
      });

      it('should parse region filter', async () => {
        const result = await manager.parseQuery('show instances in us-west-2');
        expect(result.success).toBe(true);
        expect(result.data?.region).toBe('us-west-2');
      });

      it('should parse environment filter', async () => {
        const result = await manager.parseQuery("what's running in production?");
        expect(result.success).toBe(true);
        expect(result.data?.environment).toBe('production');
      });

      it('should parse tag filters', async () => {
        const result = await manager.parseQuery('show resources tagged with project=alpha');
        expect(result.success).toBe(true);
        expect(result.data?.tags).toHaveProperty('project', 'alpha');
      });

      it('should handle multiple resource types', async () => {
        const result = await manager.parseQuery('list EC2 instances and RDS databases');
        expect(result.success).toBe(true);
        expect(result.data?.resourceTypes).toContain('ec2:instance');
        expect(result.data?.resourceTypes).toContain('rds:instance');
      });

      it('should set lower confidence for ambiguous queries', async () => {
        const result = await manager.parseQuery('show me stuff');
        expect(result.success).toBe(true);
        expect(result.data?.confidence).toBeLessThan(0.8);
        expect(result.data?.ambiguities).toBeDefined();
      });
    });

    describe('executeQuery', () => {
      it('should execute query and return results', async () => {
        const result = await manager.executeQuery('list all S3 buckets');
        expect(result.success).toBe(true);
        expect(result.data?.resources).toBeDefined();
        expect(result.data?.summary).toBeDefined();
        expect(result.data?.executionTimeMs).toBeGreaterThanOrEqual(0);
      });

      it('should execute pre-parsed query', async () => {
        const parseResult = await manager.parseQuery('list Lambda functions');
        expect(parseResult.success).toBe(true);

        const result = await manager.executeQuery(parseResult.data!);
        expect(result.success).toBe(true);
      });

      it('should include suggestions in results', async () => {
        const result = await manager.executeQuery('show EC2 instances');
        expect(result.success).toBe(true);
        expect(result.data?.suggestions).toBeDefined();
      });
    });

    describe('getSuggestions', () => {
      it('should return query suggestions', async () => {
        const result = await manager.getSuggestions('show');
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data!.length).toBeGreaterThan(0);
      });

      it('should return context-aware suggestions', async () => {
        // Add a recent resource
        manager.addRecentResource({
          type: 'ec2:instance',
          id: 'i-123',
          name: 'web-server',
          region: 'us-east-1',
          lastAccessed: new Date(),
          accessCount: 1,
        });

        const result = await manager.getSuggestions('show');
        expect(result.success).toBe(true);
        // Verify we get suggestions (context-aware suggestions include recent resources)
        expect(result.data).toBeDefined();
        expect(result.data!.length).toBeGreaterThan(0);
      });
    });
  });

  // ===========================================================================
  // Proactive Insights Tests
  // ===========================================================================

  describe('Proactive Insights', () => {
    describe('getInsights', () => {
      it('should return empty list initially', async () => {
        const result = await manager.getInsights();
        expect(result.success).toBe(true);
        expect(result.data).toEqual([]);
      });

      it('should filter by category', async () => {
        const result = await manager.getInsights({ category: 'cost' });
        expect(result.success).toBe(true);
      });

      it('should filter by severity', async () => {
        const result = await manager.getInsights({ severity: 'critical' });
        expect(result.success).toBe(true);
      });

      it('should filter by status', async () => {
        const result = await manager.getInsights({ status: 'new' });
        expect(result.success).toBe(true);
      });

      it('should respect limit', async () => {
        const result = await manager.getInsights({ limit: 5 });
        expect(result.success).toBe(true);
        expect(result.data!.length).toBeLessThanOrEqual(5);
      });
    });

    describe('getInsight', () => {
      it('should return failure for non-existent insight', async () => {
        const result = await manager.getInsight('non-existent-id');
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });
    });

    describe('Insight Status Management', () => {
      it('should return failure when acknowledging non-existent insight', async () => {
        const result = await manager.acknowledgeInsight('non-existent');
        expect(result.success).toBe(false);
      });

      it('should return failure when dismissing non-existent insight', async () => {
        const result = await manager.dismissInsight('non-existent');
        expect(result.success).toBe(false);
      });

      it('should return failure when snoozing non-existent insight', async () => {
        const result = await manager.snoozeInsight('non-existent', new Date());
        expect(result.success).toBe(false);
      });

      it('should return failure when resolving non-existent insight', async () => {
        const result = await manager.resolveInsight('non-existent');
        expect(result.success).toBe(false);
      });
    });

    describe('runInsightChecks', () => {
      it('should run insight checks', async () => {
        const result = await manager.runInsightChecks();
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      });

      it('should run specific checks by ID', async () => {
        const result = await manager.runInsightChecks(['unused-ebs-volumes']);
        expect(result.success).toBe(true);
      });
    });

    describe('getInsightChecks', () => {
      it('should return all insight checks', async () => {
        const result = await manager.getInsightChecks();
        expect(result.success).toBe(true);
        expect(result.data!.length).toBeGreaterThan(0);
      });
    });

    describe('updateInsightCheck', () => {
      it('should enable/disable insight check', async () => {
        const result = await manager.updateInsightCheck('unused-ebs-volumes', false);
        expect(result.success).toBe(true);

        const checks = await manager.getInsightChecks();
        const check = checks.data!.find(c => c.id === 'unused-ebs-volumes');
        expect(check?.enabled).toBe(false);
      });

      it('should return failure for non-existent check', async () => {
        const result = await manager.updateInsightCheck('non-existent', true);
        expect(result.success).toBe(false);
      });
    });
  });

  // ===========================================================================
  // Wizard Mode Tests
  // ===========================================================================

  describe('Wizard Mode', () => {
    describe('getWizardTemplates', () => {
      it('should return all wizard templates', async () => {
        const result = await manager.getWizardTemplates();
        expect(result.success).toBe(true);
        expect(result.data!.length).toBeGreaterThan(0);
      });
    });

    describe('getWizardTemplate', () => {
      it('should return specific template', async () => {
        const result = await manager.getWizardTemplate('production-web-app');
        expect(result.success).toBe(true);
        expect(result.data?.id).toBe('production-web-app');
        expect(result.data?.name).toBe('Production Web Application');
      });

      it('should return failure for non-existent template', async () => {
        const result = await manager.getWizardTemplate('non-existent');
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });
    });

    describe('startWizard', () => {
      it('should start wizard from template', async () => {
        const result = await manager.startWizard('serverless-api');
        expect(result.success).toBe(true);
        expect(result.data?.wizardId).toBeDefined();
        expect(result.data?.status).toBe('in-progress');
        expect(result.data?.currentStepIndex).toBe(0);
        expect(result.data?.steps.length).toBeGreaterThan(0);
      });

      it('should return failure for non-existent template', async () => {
        const result = await manager.startWizard('non-existent');
        expect(result.success).toBe(false);
      });
    });

    describe('getWizardState', () => {
      it('should return wizard state', async () => {
        const startResult = await manager.startWizard('static-website');
        expect(startResult.success).toBe(true);

        const result = await manager.getWizardState(startResult.data!.wizardId);
        expect(result.success).toBe(true);
        expect(result.data?.wizardId).toBe(startResult.data!.wizardId);
      });

      it('should return failure for non-existent wizard', async () => {
        const result = await manager.getWizardState('non-existent');
        expect(result.success).toBe(false);
      });
    });

    describe('answerWizardStep', () => {
      it('should answer step and advance', async () => {
        const startResult = await manager.startWizard('serverless-api');
        const wizardId = startResult.data!.wizardId;
        const firstStep = startResult.data!.steps[0];

        const result = await manager.answerWizardStep(wizardId, firstStep.id, 'rest');
        expect(result.success).toBe(true);
        expect(result.data?.values[firstStep.id]).toBe('rest');
        expect(result.data?.currentStepIndex).toBe(1);
        expect(result.data?.steps[0].completed).toBe(true);
      });

      it('should return failure for non-existent wizard', async () => {
        const result = await manager.answerWizardStep('non-existent', 'step1', 'value');
        expect(result.success).toBe(false);
      });

      it('should return failure for non-existent step', async () => {
        const startResult = await manager.startWizard('serverless-api');
        const result = await manager.answerWizardStep(startResult.data!.wizardId, 'non-existent', 'value');
        expect(result.success).toBe(false);
      });
    });

    describe('goBackWizard', () => {
      it('should go back to previous step', async () => {
        const startResult = await manager.startWizard('serverless-api');
        const wizardId = startResult.data!.wizardId;
        const firstStep = startResult.data!.steps[0];

        // Answer first step
        await manager.answerWizardStep(wizardId, firstStep.id, 'rest');

        // Go back
        const result = await manager.goBackWizard(wizardId);
        expect(result.success).toBe(true);
        expect(result.data?.currentStepIndex).toBe(0);
      });

      it('should stay at first step if already there', async () => {
        const startResult = await manager.startWizard('serverless-api');
        const result = await manager.goBackWizard(startResult.data!.wizardId);
        expect(result.success).toBe(true);
        expect(result.data?.currentStepIndex).toBe(0);
      });
    });

    describe('skipWizardStep', () => {
      it('should skip skippable step', async () => {
        // Find a wizard with skippable steps
        const startResult = await manager.startWizard('production-web-app');
        const wizardId = startResult.data!.wizardId;

        // Answer required steps until we reach a skippable one
        let state = startResult.data!;
        while (state.currentStepIndex < state.steps.length && !state.steps[state.currentStepIndex].canSkip) {
          const step = state.steps[state.currentStepIndex];
          const answerResult = await manager.answerWizardStep(wizardId, step.id, step.options?.[0]?.id || 'value');
          if (!answerResult.success) break;
          state = answerResult.data!;
        }

        if (state.currentStepIndex < state.steps.length && state.steps[state.currentStepIndex].canSkip) {
          const result = await manager.skipWizardStep(wizardId);
          expect(result.success).toBe(true);
        }
      });

      it('should return failure when skipping non-skippable step', async () => {
        const startResult = await manager.startWizard('serverless-api');
        const result = await manager.skipWizardStep(startResult.data!.wizardId);
        // First step is usually not skippable
        expect(result.success).toBe(false);
      });
    });

    describe('cancelWizard', () => {
      it('should cancel wizard', async () => {
        const startResult = await manager.startWizard('serverless-api');
        const result = await manager.cancelWizard(startResult.data!.wizardId);
        expect(result.success).toBe(true);

        const stateResult = await manager.getWizardState(startResult.data!.wizardId);
        expect(stateResult.data?.status).toBe('cancelled');
      });
    });

    describe('generateWizardPlan', () => {
      it('should generate execution plan', async () => {
        const startResult = await manager.startWizard('static-website');
        const wizardId = startResult.data!.wizardId;

        // Complete the wizard steps
        let state = startResult.data!;
        for (const step of state.steps) {
          if (step.type === 'review') break;
          const value = step.inputConfig ? 'test-bucket-name' : step.options?.[0]?.id || 'value';
          const answerResult = await manager.answerWizardStep(wizardId, step.id, value);
          if (answerResult.success) state = answerResult.data!;
        }

        const result = await manager.generateWizardPlan(wizardId);
        expect(result.success).toBe(true);
        expect(result.data?.resourcesToCreate.length).toBeGreaterThan(0);
        expect(result.data?.estimatedMonthlyCost).toBeDefined();
      });
    });

    describe('executeWizard', () => {
      it('should execute wizard in dry run mode', async () => {
        const startResult = await manager.startWizard('static-website');
        const wizardId = startResult.data!.wizardId;

        // Complete steps
        let state = startResult.data!;
        for (const step of state.steps) {
          if (step.type === 'review') continue;
          const value = step.inputConfig ? 'test-bucket' : step.options?.[0]?.id || 'value';
          const answerResult = await manager.answerWizardStep(wizardId, step.id, value);
          if (answerResult.success) state = answerResult.data!;
        }

        // Generate plan
        await manager.generateWizardPlan(wizardId);

        // Execute in dry run
        const result = await manager.executeWizard(wizardId, true);
        expect(result.success).toBe(true);
        expect(result.message).toContain('Dry run');
      });

      it('should return failure without execution plan', async () => {
        const startResult = await manager.startWizard('serverless-api');
        const result = await manager.executeWizard(startResult.data!.wizardId);
        expect(result.success).toBe(false);
        expect(result.error).toContain('No execution plan');
      });
    });
  });

  // ===========================================================================
  // Summary and Reporting Tests
  // ===========================================================================

  describe('Summary and Reporting', () => {
    describe('getInfrastructureSummary', () => {
      it('should return infrastructure summary', async () => {
        const result = await manager.getInfrastructureSummary();
        expect(result.success).toBe(true);
        expect(result.data?.resourceCounts).toBeDefined();
        expect(result.data?.resourcesByRegion).toBeDefined();
        expect(result.data?.resourcesByEnvironment).toBeDefined();
        expect(result.data?.overallHealth).toBeDefined();
        expect(result.data?.lastUpdated).toBeInstanceOf(Date);
      });

      it('should include recent resources in counts', async () => {
        manager.addRecentResource({
          type: 'ec2:instance',
          id: 'i-123',
          name: 'server',
          region: 'us-east-1',
          lastAccessed: new Date(),
          accessCount: 1,
          environment: 'production',
        });

        const result = await manager.getInfrastructureSummary();
        expect(result.success).toBe(true);
        expect(result.data?.resourceCounts['ec2:instance']).toBe(1);
        expect(result.data?.resourcesByRegion['us-east-1']).toBe(1);
        expect(result.data?.resourcesByEnvironment['production']).toBe(1);
      });
    });

    describe('getSessionSummary', () => {
      it('should return session summary', async () => {
        const result = await manager.getSessionSummary();
        expect(result.success).toBe(true);
        expect(result.data?.durationMinutes).toBeGreaterThanOrEqual(0);
        expect(result.data?.operationCount).toBe(0);
        expect(result.data?.successRate).toBe(100);
        expect(result.data?.resourcesAccessed).toBe(0);
      });

      it('should include operation statistics', async () => {
        manager.recordOperation({
          id: 'op1',
          action: 'describe-instances',
          service: 'EC2',
          resources: [],
          timestamp: new Date(),
          status: 'success',
        });

        manager.recordOperation({
          id: 'op2',
          action: 'list-buckets',
          service: 'S3',
          resources: [],
          timestamp: new Date(),
          status: 'success',
        });

        manager.recordOperation({
          id: 'op3',
          action: 'describe-instances',
          service: 'EC2',
          resources: [],
          timestamp: new Date(),
          status: 'failed',
        });

        const result = await manager.getSessionSummary();
        expect(result.success).toBe(true);
        expect(result.data?.operationCount).toBe(3);
        expect(result.data?.operationsByService['EC2']).toBe(2);
        expect(result.data?.operationsByService['S3']).toBe(1);
        expect(result.data?.successRate).toBeCloseTo(66.67, 0);
      });

      it('should include top accessed resources', async () => {
        const resource: ResourceReference = {
          type: 'ec2:instance',
          id: 'i-123',
          name: 'popular-server',
          region: 'us-east-1',
          lastAccessed: new Date(),
          accessCount: 1,
        };

        manager.addRecentResource(resource);
        manager.addRecentResource(resource);
        manager.addRecentResource(resource);

        const result = await manager.getSessionSummary();
        expect(result.success).toBe(true);
        expect(result.data?.topResources.length).toBeGreaterThan(0);
        expect(result.data?.topResources[0].accessCount).toBe(3);
      });
    });
  });

  // ===========================================================================
  // Constants Tests
  // ===========================================================================

  describe('Constants', () => {
    describe('WIZARD_TEMPLATES', () => {
      it('should have valid wizard templates', () => {
        expect(WIZARD_TEMPLATES.length).toBeGreaterThan(0);

        for (const template of WIZARD_TEMPLATES) {
          expect(template.id).toBeDefined();
          expect(template.name).toBeDefined();
          expect(template.type).toBeDefined();
          expect(template.stepDefinitions.length).toBeGreaterThan(0);
        }
      });

      it('should have production-web-app template', () => {
        const template = WIZARD_TEMPLATES.find(t => t.id === 'production-web-app');
        expect(template).toBeDefined();
        expect(template?.complexity).toBe('intermediate');
      });

      it('should have serverless-api template', () => {
        const template = WIZARD_TEMPLATES.find(t => t.id === 'serverless-api');
        expect(template).toBeDefined();
        expect(template?.complexity).toBe('beginner');
      });
    });

    describe('INSIGHT_CHECKS', () => {
      it('should have valid insight checks', () => {
        expect(INSIGHT_CHECKS.length).toBeGreaterThan(0);

        for (const check of INSIGHT_CHECKS) {
          expect(check.id).toBeDefined();
          expect(check.name).toBeDefined();
          expect(check.category).toBeDefined();
          expect(check.intervalMinutes).toBeGreaterThan(0);
        }
      });

      it('should have cost-related checks', () => {
        const costChecks = INSIGHT_CHECKS.filter(c => c.category === 'cost');
        expect(costChecks.length).toBeGreaterThan(0);
      });

      it('should have security-related checks', () => {
        const securityChecks = INSIGHT_CHECKS.filter(c => c.category === 'security');
        expect(securityChecks.length).toBeGreaterThan(0);
      });
    });

    describe('QUERY_PATTERNS', () => {
      it('should have valid query patterns', () => {
        expect(QUERY_PATTERNS.length).toBeGreaterThan(0);

        for (const pattern of QUERY_PATTERNS) {
          expect(pattern.id).toBeDefined();
          expect(pattern.name).toBeDefined();
          expect(pattern.patterns.length).toBeGreaterThan(0);
          expect(pattern.examples.length).toBeGreaterThan(0);
        }
      });

      it('should have list patterns', () => {
        const listPatterns = QUERY_PATTERNS.filter(p => p.intent === 'list');
        expect(listPatterns.length).toBeGreaterThan(0);
      });

      it('should have find patterns', () => {
        const findPatterns = QUERY_PATTERNS.filter(p => p.intent === 'find');
        expect(findPatterns.length).toBeGreaterThan(0);
      });
    });
  });
});
