/**
 * AWS CI/CD Manager Tests
 *
 * Unit tests for CI/CD pipeline management operations covering
 * CodePipeline, CodeBuild, CodeDeploy, and pipeline templates.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCICDManager, PIPELINE_TEMPLATES } from './index.js';
import type { CICDManager, PipelineTemplate } from './types.js';

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-codepipeline', () => ({
  CodePipelineClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  ListPipelinesCommand: vi.fn(),
  GetPipelineCommand: vi.fn(),
  CreatePipelineCommand: vi.fn(),
  UpdatePipelineCommand: vi.fn(),
  DeletePipelineCommand: vi.fn(),
  StartPipelineExecutionCommand: vi.fn(),
  StopPipelineExecutionCommand: vi.fn(),
  RetryStageExecutionCommand: vi.fn(),
  ListPipelineExecutionsCommand: vi.fn(),
  GetPipelineExecutionCommand: vi.fn(),
  GetPipelineStateCommand: vi.fn(),
  ListActionExecutionsCommand: vi.fn(),
  EnableStageTransitionCommand: vi.fn(),
  DisableStageTransitionCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-codebuild', () => ({
  CodeBuildClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  ListProjectsCommand: vi.fn(),
  BatchGetProjectsCommand: vi.fn(),
  CreateProjectCommand: vi.fn(),
  UpdateProjectCommand: vi.fn(),
  DeleteProjectCommand: vi.fn(),
  StartBuildCommand: vi.fn(),
  StopBuildCommand: vi.fn(),
  RetryBuildCommand: vi.fn(),
  ListBuildsCommand: vi.fn(),
  ListBuildsForProjectCommand: vi.fn(),
  BatchGetBuildsCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-codedeploy', () => ({
  CodeDeployClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  ListApplicationsCommand: vi.fn(),
  GetApplicationCommand: vi.fn(),
  CreateApplicationCommand: vi.fn(),
  DeleteApplicationCommand: vi.fn(),
  ListDeploymentGroupsCommand: vi.fn(),
  GetDeploymentGroupCommand: vi.fn(),
  CreateDeploymentGroupCommand: vi.fn(),
  UpdateDeploymentGroupCommand: vi.fn(),
  DeleteDeploymentGroupCommand: vi.fn(),
  CreateDeploymentCommand: vi.fn(),
  GetDeploymentCommand: vi.fn(),
  ListDeploymentsCommand: vi.fn(),
  StopDeploymentCommand: vi.fn(),
  ContinueDeploymentCommand: vi.fn(),
  ListDeploymentConfigsCommand: vi.fn(),
  GetDeploymentConfigCommand: vi.fn(),
  CreateDeploymentConfigCommand: vi.fn(),
  DeleteDeploymentConfigCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  GetLogEventsCommand: vi.fn(),
}));

describe('CICDManager', () => {
  let manager: CICDManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createCICDManager({
      defaultRegion: 'us-east-1',
    });
  });

  describe('createCICDManager', () => {
    it('should create a manager with default config', () => {
      const mgr = createCICDManager();
      expect(mgr).toBeDefined();
      expect(typeof mgr.listPipelines).toBe('function');
      expect(typeof mgr.createPipeline).toBe('function');
      expect(typeof mgr.startBuild).toBe('function');
      expect(typeof mgr.createDeployment).toBe('function');
    });

    it('should create a manager with custom config', () => {
      const mgr = createCICDManager({
        defaultRegion: 'eu-west-1',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
      });
      expect(mgr).toBeDefined();
    });
  });

  describe('Pipeline Templates', () => {
    it('should return all predefined templates', async () => {
      const result = await manager.getPipelineTemplates();
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data!.length).toBeGreaterThan(0);
    });

    it('should have templates for common CI/CD patterns', async () => {
      const result = await manager.getPipelineTemplates();
      const templates = result.data!;
      
      // Check for specific template patterns
      const templateIds = templates.map(t => t.id);
      expect(templateIds).toContain('github-codebuild-ecs');
      expect(templateIds).toContain('github-codebuild-s3');
      expect(templateIds).toContain('github-codebuild-lambda');
    });

    it('should return a specific template by ID', async () => {
      const result = await manager.getPipelineTemplate('github-codebuild-ecs');
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.id).toBe('github-codebuild-ecs');
      expect(result.data!.name).toBe('GitHub → CodeBuild → ECS');
    });

    it('should return error for non-existent template', async () => {
      const result = await manager.getPipelineTemplate('non-existent-template');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should have valid template structure', async () => {
      const result = await manager.getPipelineTemplates();
      
      for (const template of result.data!) {
        // Check required fields
        expect(template.id).toBeTruthy();
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.category).toBeTruthy();
        expect(template.sourceProvider).toBeTruthy();
        expect(template.deployTarget).toBeTruthy();
        
        // Check stages
        expect(Array.isArray(template.stages)).toBe(true);
        expect(template.stages.length).toBeGreaterThan(0);
        
        for (const stage of template.stages) {
          expect(stage.name).toBeTruthy();
          expect(stage.description).toBeTruthy();
          expect(stage.actionType).toBeTruthy();
        }
        
        // Check parameters
        expect(Array.isArray(template.requiredParameters)).toBe(true);
        expect(Array.isArray(template.optionalParameters)).toBe(true);
        
        for (const param of template.requiredParameters) {
          expect(param.name).toBeTruthy();
          expect(param.description).toBeTruthy();
          expect(param.type).toBeTruthy();
        }
      }
    });
  });

  describe('PIPELINE_TEMPLATES constant', () => {
    it('should be exported and contain templates', () => {
      expect(Array.isArray(PIPELINE_TEMPLATES)).toBe(true);
      expect(PIPELINE_TEMPLATES.length).toBeGreaterThan(0);
    });

    it('should contain github-codebuild-ecs template', () => {
      const template = PIPELINE_TEMPLATES.find(t => t.id === 'github-codebuild-ecs');
      expect(template).toBeDefined();
      expect(template!.stages.length).toBe(3); // Source, Build, Deploy
    });

    it('should contain multi-env-pipeline template', () => {
      const template = PIPELINE_TEMPLATES.find(t => t.id === 'multi-env-pipeline');
      expect(template).toBeDefined();
      expect(template!.category).toBe('multi-stage');
      expect(template!.stages.some(s => s.actionType === 'Approval')).toBe(true);
    });
  });

  describe('Interface completeness', () => {
    it('should have all pipeline operations', () => {
      expect(typeof manager.listPipelines).toBe('function');
      expect(typeof manager.getPipeline).toBe('function');
      expect(typeof manager.createPipeline).toBe('function');
      expect(typeof manager.updatePipeline).toBe('function');
      expect(typeof manager.deletePipeline).toBe('function');
    });

    it('should have all pipeline execution operations', () => {
      expect(typeof manager.startPipelineExecution).toBe('function');
      expect(typeof manager.stopPipelineExecution).toBe('function');
      expect(typeof manager.retryStageExecution).toBe('function');
      expect(typeof manager.listPipelineExecutions).toBe('function');
      expect(typeof manager.getPipelineExecution).toBe('function');
      expect(typeof manager.getPipelineState).toBe('function');
    });

    it('should have all stage transition operations', () => {
      expect(typeof manager.enableStageTransition).toBe('function');
      expect(typeof manager.disableStageTransition).toBe('function');
    });

    it('should have all build project operations', () => {
      expect(typeof manager.listBuildProjects).toBe('function');
      expect(typeof manager.getBuildProject).toBe('function');
      expect(typeof manager.getBuildProjects).toBe('function');
      expect(typeof manager.createBuildProject).toBe('function');
      expect(typeof manager.updateBuildProject).toBe('function');
      expect(typeof manager.deleteBuildProject).toBe('function');
    });

    it('should have all build operations', () => {
      expect(typeof manager.startBuild).toBe('function');
      expect(typeof manager.stopBuild).toBe('function');
      expect(typeof manager.retryBuild).toBe('function');
      expect(typeof manager.listBuilds).toBe('function');
      expect(typeof manager.listBuildsForProject).toBe('function');
      expect(typeof manager.getBuild).toBe('function');
      expect(typeof manager.getBuilds).toBe('function');
      expect(typeof manager.getBuildLogs).toBe('function');
    });

    it('should have all CodeDeploy application operations', () => {
      expect(typeof manager.listApplications).toBe('function');
      expect(typeof manager.getApplication).toBe('function');
      expect(typeof manager.createApplication).toBe('function');
      expect(typeof manager.deleteApplication).toBe('function');
    });

    it('should have all deployment group operations', () => {
      expect(typeof manager.listDeploymentGroups).toBe('function');
      expect(typeof manager.getDeploymentGroup).toBe('function');
      expect(typeof manager.createDeploymentGroup).toBe('function');
      expect(typeof manager.updateDeploymentGroup).toBe('function');
      expect(typeof manager.deleteDeploymentGroup).toBe('function');
    });

    it('should have all deployment operations', () => {
      expect(typeof manager.createDeployment).toBe('function');
      expect(typeof manager.getDeployment).toBe('function');
      expect(typeof manager.listDeployments).toBe('function');
      expect(typeof manager.stopDeployment).toBe('function');
      expect(typeof manager.continueDeployment).toBe('function');
    });

    it('should have all deployment config operations', () => {
      expect(typeof manager.listDeploymentConfigs).toBe('function');
      expect(typeof manager.getDeploymentConfig).toBe('function');
      expect(typeof manager.createDeploymentConfig).toBe('function');
      expect(typeof manager.deleteDeploymentConfig).toBe('function');
    });

    it('should have blue/green deployment operations', () => {
      expect(typeof manager.configureBlueGreenDeployment).toBe('function');
    });

    it('should have rollback operations', () => {
      expect(typeof manager.rollbackDeployment).toBe('function');
    });

    it('should have template operations', () => {
      expect(typeof manager.getPipelineTemplates).toBe('function');
      expect(typeof manager.getPipelineTemplate).toBe('function');
      expect(typeof manager.createPipelineFromTemplate).toBe('function');
    });
  });

  describe('Template categories', () => {
    it('should have source-to-deploy templates', () => {
      const templates = PIPELINE_TEMPLATES.filter(t => t.category === 'source-to-deploy');
      expect(templates.length).toBeGreaterThan(0);
      
      for (const template of templates) {
        expect(template.stages.some(s => s.actionType === 'Source')).toBe(true);
        expect(template.stages.some(s => s.actionType === 'Deploy')).toBe(true);
      }
    });

    it('should have deploy-only templates', () => {
      const templates = PIPELINE_TEMPLATES.filter(t => t.category === 'deploy-only');
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should have multi-stage templates', () => {
      const templates = PIPELINE_TEMPLATES.filter(t => t.category === 'multi-stage');
      expect(templates.length).toBeGreaterThan(0);
      
      for (const template of templates) {
        // Multi-stage should have multiple deploy stages or approval stages
        const deployCount = template.stages.filter(s => 
          s.actionType === 'Deploy' || s.actionType === 'Approval'
        ).length;
        expect(deployCount).toBeGreaterThan(1);
      }
    });
  });

  describe('Source providers', () => {
    it('should support GitHub via CodeStar Connection', () => {
      const templates = PIPELINE_TEMPLATES.filter(
        t => t.sourceProvider === 'CodeStarSourceConnection'
      );
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should support CodeCommit', () => {
      const templates = PIPELINE_TEMPLATES.filter(
        t => t.sourceProvider === 'CodeCommit'
      );
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should support S3', () => {
      const templates = PIPELINE_TEMPLATES.filter(t => t.sourceProvider === 'S3');
      expect(templates.length).toBeGreaterThan(0);
    });
  });

  describe('Deploy targets', () => {
    it('should support ECS deployment', () => {
      const templates = PIPELINE_TEMPLATES.filter(t => t.deployTarget === 'ECS');
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should support S3 deployment', () => {
      const templates = PIPELINE_TEMPLATES.filter(t => t.deployTarget === 'S3');
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should support Lambda deployment', () => {
      const templates = PIPELINE_TEMPLATES.filter(t => t.deployTarget === 'Lambda');
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should support CloudFormation deployment', () => {
      const templates = PIPELINE_TEMPLATES.filter(t => t.deployTarget === 'CloudFormation');
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should support EC2 deployment', () => {
      const templates = PIPELINE_TEMPLATES.filter(t => t.deployTarget === 'EC2');
      expect(templates.length).toBeGreaterThan(0);
    });
  });

  describe('Required parameters validation', () => {
    it('should have connection ARN for GitHub templates', () => {
      const githubTemplates = PIPELINE_TEMPLATES.filter(
        t => t.sourceProvider === 'CodeStarSourceConnection'
      );
      
      for (const template of githubTemplates) {
        const hasConnectionArn = template.requiredParameters.some(
          p => p.name === 'connectionArn'
        );
        expect(hasConnectionArn).toBe(true);
      }
    });

    it('should have repository ID for GitHub templates', () => {
      const githubTemplates = PIPELINE_TEMPLATES.filter(
        t => t.sourceProvider === 'CodeStarSourceConnection'
      );
      
      for (const template of githubTemplates) {
        const hasRepoId = template.requiredParameters.some(
          p => p.name === 'repositoryId'
        );
        expect(hasRepoId).toBe(true);
      }
    });

    it('should have ECS parameters for ECS templates', () => {
      const ecsTemplates = PIPELINE_TEMPLATES.filter(
        t => t.deployTarget === 'ECS' && t.category === 'source-to-deploy'
      );
      
      for (const template of ecsTemplates) {
        const hasCluster = template.requiredParameters.some(
          p => p.name === 'ecsClusterName' || p.name === 'devCluster'
        );
        const hasService = template.requiredParameters.some(
          p => p.name === 'ecsServiceName' || p.name === 'devService'
        );
        expect(hasCluster).toBe(true);
        expect(hasService).toBe(true);
      }
    });
  });
});

describe('Pipeline template consistency', () => {
  it('should have unique template IDs', () => {
    const ids = PIPELINE_TEMPLATES.map(t => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have descriptive names', () => {
    for (const template of PIPELINE_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(5);
      expect(template.name).not.toBe(template.id);
    }
  });

  it('should have meaningful descriptions', () => {
    for (const template of PIPELINE_TEMPLATES) {
      expect(template.description.length).toBeGreaterThan(20);
    }
  });
});
