/**
 * IDIO CLI Commands
 * 
 * Command-line interface for Intent-Driven Infrastructure Orchestration.
 * Provides commands for planning, deploying, and managing AWS infrastructure
 * using declarative intent specifications.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { IDIOOrchestrator, createIDIOOrchestrator } from '../idio/orchestrator.js';
import { IDIOStateStore, createStateStore } from '../idio/state-store.js';
import type { ApplicationIntent, InfrastructurePlan } from '../intent/types.js';
import type { IDIOResult } from '../idio/orchestrator.js';

// =============================================================================
// Types
// =============================================================================

export interface IDIOCLIConfig {
  /** Default AWS region */
  defaultRegion?: string;
  /** State store table name */
  stateTableName?: string;
  /** Enable verbose output */
  verbose?: boolean;
  /** Output format */
  outputFormat?: 'json' | 'yaml' | 'table';
  /** Dry run mode */
  dryRun?: boolean;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
  errors?: string[];
}

// =============================================================================
// Command Handlers
// =============================================================================

/**
 * IDIO CLI - Command-line interface for infrastructure management
 */
export class IDIOCLI {
  private orchestrator: IDIOOrchestrator;
  private stateStore: IDIOStateStore | null = null;
  private config: IDIOCLIConfig;

  constructor(config: IDIOCLIConfig = {}) {
    this.config = {
      defaultRegion: 'us-east-1',
      verbose: false,
      outputFormat: 'table',
      dryRun: false,
      ...config,
    };

    this.orchestrator = createIDIOOrchestrator({
      compiler: {},
      policyEngine: {
        enableAutoFix: false,
        failOnCritical: true,
      },
      reconciliation: {
        intervalMinutes: 30,
        enableAutoRemediation: false,
        costAnomalyThreshold: 20,
        maxRemediationAttempts: 3,
      },
    });
  }

  /**
   * Initialize state store for persistent storage
   */
  async initStateStore(): Promise<void> {
    if (!this.stateStore) {
      this.stateStore = createStateStore({
        tablePrefix: this.config.stateTableName ?? 'idio-state',
        region: this.config.defaultRegion ?? 'us-east-1',
      });
    }
  }

  // ===========================================================================
  // Plan Commands
  // ===========================================================================

  /**
   * Create an infrastructure plan from an intent file
   */
  async planFromFile(intentFilePath: string): Promise<CommandResult> {
    try {
      const absolutePath = path.resolve(intentFilePath);
      const content = await fs.readFile(absolutePath, 'utf-8');
      
      let intent: ApplicationIntent;
      if (intentFilePath.endsWith('.json')) {
        intent = JSON.parse(content);
      } else if (intentFilePath.endsWith('.yaml') || intentFilePath.endsWith('.yml')) {
        // Basic YAML parsing (for simple cases)
        intent = this.parseSimpleYaml(content);
      } else {
        return {
          success: false,
          message: 'Unsupported file format. Use .json or .yaml',
          errors: ['File must have .json, .yaml, or .yml extension'],
        };
      }

      return this.planFromIntent(intent);
    } catch (error) {
      return {
        success: false,
        message: 'Failed to read intent file',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Create an infrastructure plan from an intent object
   */
  async planFromIntent(intent: ApplicationIntent): Promise<CommandResult> {
    const result = await this.orchestrator.createPlanFromIntent(intent);
    
    if (result.success && result.data) {
      const planData = result.data as { planId?: string; resourceCount?: number; estimatedCostUsd?: number };
      return {
        success: true,
        message: `Plan created successfully`,
        data: {
          planId: planData.planId,
          resourceCount: planData.resourceCount,
          estimatedMonthlyCost: planData.estimatedCostUsd ? `$${planData.estimatedCostUsd.toFixed(2)}` : 'N/A',
          ...result.data,
        },
      };
    }

    return this.convertResult(result);
  }

  /**
   * Create a plan from a template
   */
  async planFromTemplate(
    templateId: string,
    parameters: Record<string, unknown>,
  ): Promise<CommandResult> {
    const result = await this.orchestrator.createPlanFromTemplate(templateId, parameters);
    return this.convertResult(result);
  }

  /**
   * Get details of an existing plan
   */
  getPlanDetails(planId: string): CommandResult {
    const result = this.orchestrator.getPlan(planId);
    return this.convertResult(result);
  }

  /**
   * List all plans (from state store)
   */
  async listPlans(_options: { limit?: number; status?: string } = {}): Promise<CommandResult> {
    // Plans are stored in-memory in the orchestrator for now
    // In a production system, this would query the state store
    return {
      success: true,
      message: 'Plan listing requires state store integration',
      data: { plans: [] },
    };
  }

  // ===========================================================================
  // Execution Commands
  // ===========================================================================

  /**
   * Execute a plan to provision infrastructure
   */
  async execute(
    planId: string,
    options: { dryRun?: boolean; autoApprove?: boolean } = {},
  ): Promise<CommandResult> {
    const effectiveDryRun = options.dryRun ?? this.config.dryRun;

    if (effectiveDryRun) {
      return this.dryRun(planId);
    }

    const result = await this.orchestrator.executePlan(planId, {
      dryRun: false,
      autoApprove: options.autoApprove,
    });

    return this.convertResult(result);
  }

  /**
   * Preview what would be created without actually provisioning
   */
  async dryRun(planId: string): Promise<CommandResult> {
    const result = await this.orchestrator.executePlan(planId, {
      dryRun: true,
    });

    if (result.success) {
      return {
        success: true,
        message: '🔍 Dry run completed - no resources were created',
        data: result.data,
      };
    }

    return this.convertResult(result);
  }

  /**
   * Check the status of an execution
   */
  async checkStatus(executionId: string): Promise<CommandResult> {
    const result = await this.orchestrator.checkStatus(executionId);
    return this.convertResult(result);
  }

  /**
   * Rollback an execution
   */
  async rollback(executionId: string): Promise<CommandResult> {
    const result = await this.orchestrator.rollback(executionId);
    return this.convertResult(result);
  }

  // ===========================================================================
  // Template Commands
  // ===========================================================================

  /**
   * List available templates
   */
  listTemplates(category?: string): CommandResult {
    const result = this.orchestrator.listTemplates(category);
    return this.convertResult(result);
  }

  /**
   * Get details of a specific template
   */
  getTemplateDetails(templateId: string): CommandResult {
    const result = this.orchestrator.getTemplate(templateId);
    return this.convertResult(result);
  }

  // ===========================================================================
  // Validation Commands
  // ===========================================================================

  /**
   * Validate an intent without creating a plan
   */
  async validate(intent: ApplicationIntent): Promise<CommandResult> {
    const result = await this.orchestrator.validateIntent(intent);
    
    if (result.success) {
      return {
        success: true,
        message: '✓ Intent is valid',
        data: result.data,
      };
    }

    return {
      success: false,
      message: '✗ Intent validation failed',
      errors: result.errors,
    };
  }

  /**
   * Validate an intent file
   */
  async validateFile(intentFilePath: string): Promise<CommandResult> {
    try {
      const absolutePath = path.resolve(intentFilePath);
      const content = await fs.readFile(absolutePath, 'utf-8');
      
      let intent: ApplicationIntent;
      if (intentFilePath.endsWith('.json')) {
        intent = JSON.parse(content);
      } else if (intentFilePath.endsWith('.yaml') || intentFilePath.endsWith('.yml')) {
        intent = this.parseSimpleYaml(content);
      } else {
        return {
          success: false,
          message: 'Unsupported file format',
          errors: ['File must have .json, .yaml, or .yml extension'],
        };
      }

      return this.validate(intent);
    } catch (error) {
      return {
        success: false,
        message: 'Failed to read or parse intent file',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // ===========================================================================
  // Cost Commands
  // ===========================================================================

  /**
   * Estimate cost for an intent
   */
  async estimateCost(intent: ApplicationIntent): Promise<CommandResult> {
    const result = await this.orchestrator.estimateCost(intent);
    
    if (result.success && result.data) {
      const costData = result.data as { 
        totalMonthlyUsd?: number; 
        breakdown?: Record<string, number>;
      };
      
      return {
        success: true,
        message: `Estimated monthly cost: $${costData.totalMonthlyUsd?.toFixed(2) ?? 'N/A'}`,
        data: {
          totalMonthly: costData.totalMonthlyUsd ? `$${costData.totalMonthlyUsd.toFixed(2)}` : 'N/A',
          breakdown: costData.breakdown,
          ...result.data,
        },
      };
    }

    return this.convertResult(result);
  }

  // ===========================================================================
  // Reconciliation Commands
  // ===========================================================================

  /**
   * Detect and report drift from desired state
   */
  async detectDrift(executionId: string): Promise<CommandResult> {
    const result = await this.orchestrator.reconcile(executionId);
    return this.convertResult(result);
  }

  /**
   * Reconcile infrastructure to match desired state
   */
  async reconcile(
    executionId: string,
    options: { autoRemediate?: boolean } = {},
  ): Promise<CommandResult> {
    // First detect drift
    const driftResult = await this.orchestrator.reconcile(executionId);
    
    if (!driftResult.success) {
      return this.convertResult(driftResult);
    }

    const driftData = driftResult.data as { drifts?: unknown[]; hasDrift?: boolean };
    
    if (!driftData.hasDrift) {
      return {
        success: true,
        message: '✓ Infrastructure is in sync with desired state',
        data: driftResult.data,
      };
    }

    if (options.autoRemediate) {
      return {
        success: true,
        message: `Found ${driftData.drifts?.length ?? 0} drift(s) - remediation would be applied`,
        data: driftResult.data,
      };
    }

    return {
      success: true,
      message: `Found ${driftData.drifts?.length ?? 0} drift(s) - use --auto-remediate to fix`,
      data: driftResult.data,
    };
  }

  // ===========================================================================
  // Quick Deploy Commands
  // ===========================================================================

  /**
   * Quick deploy: plan + execute in one step
   */
  async deploy(
    intent: ApplicationIntent,
    options: { dryRun?: boolean; autoApprove?: boolean } = {},
  ): Promise<CommandResult> {
    // Step 1: Validate
    const validationResult = await this.validate(intent);
    if (!validationResult.success) {
      return validationResult;
    }

    // Step 2: Create plan
    const planResult = await this.planFromIntent(intent);
    if (!planResult.success) {
      return planResult;
    }

    const planData = planResult.data as { planId?: string };
    if (!planData.planId) {
      return {
        success: false,
        message: 'Plan created but no plan ID returned',
      };
    }

    // Step 3: Execute (or dry run)
    return this.execute(planData.planId, options);
  }

  /**
   * Quick deploy from template
   */
  async deployTemplate(
    templateId: string,
    parameters: Record<string, unknown>,
    options: { dryRun?: boolean; autoApprove?: boolean } = {},
  ): Promise<CommandResult> {
    // Step 1: Create plan from template
    const planResult = await this.planFromTemplate(templateId, parameters);
    if (!planResult.success) {
      return planResult;
    }

    const planData = planResult.data as { planId?: string };
    if (!planData.planId) {
      return {
        success: false,
        message: 'Plan created but no plan ID returned',
      };
    }

    // Step 2: Execute
    return this.execute(planData.planId, options);
  }

  // ===========================================================================
  // Intent Generation Helpers
  // ===========================================================================

  /**
   * Generate a sample intent file
   */
  async generateSampleIntent(
    type: 'web-api' | 'serverless' | 'data-pipeline' | 'ml-platform',
    outputPath?: string,
  ): Promise<CommandResult> {
    const samples: Record<string, ApplicationIntent> = {
      'web-api': {
        name: 'my-web-api',
        description: 'A sample three-tier web API',
        environment: 'development',
        availability: '99.9',
        primaryRegion: 'us-east-1',
        cost: {
          monthlyBudgetUsd: 500,
          prioritizeCost: true,
          alertThreshold: 80,
        },
        compliance: ['none'],
        security: {
          encryptionAtRest: true,
          encryptionInTransit: true,
          networkIsolation: 'private-subnet',
        },
        tiers: [
          {
            type: 'web',
            trafficPattern: 'steady',
            runtime: {
              language: 'nodejs',
              version: '20',
              containerImage: 'node:20-alpine',
              healthCheckPath: '/health',
            },
            scaling: {
              min: 2,
              max: 10,
              targetCpuUtilization: 70,
            },
          },
          {
            type: 'api',
            trafficPattern: 'steady',
            runtime: {
              language: 'nodejs',
              version: '20',
              containerImage: 'node:20-alpine',
              healthCheckPath: '/api/health',
            },
            scaling: {
              min: 2,
              max: 20,
              targetCpuUtilization: 60,
            },
            dependsOn: ['web'],
          },
          {
            type: 'database',
            trafficPattern: 'steady',
            dataSizeGb: 100,
            scaling: {
              min: 1,
              max: 1,
            },
            dependsOn: ['api'],
          },
        ],
      },
      'serverless': {
        name: 'my-serverless-api',
        description: 'A serverless API with Lambda and DynamoDB',
        environment: 'development',
        availability: '99.9',
        primaryRegion: 'us-east-1',
        cost: {
          monthlyBudgetUsd: 100,
          prioritizeCost: true,
          alertThreshold: 80,
        },
        compliance: ['none'],
        security: {
          encryptionAtRest: true,
          encryptionInTransit: true,
          networkIsolation: 'none',
        },
        tiers: [
          {
            type: 'api',
            trafficPattern: 'burst',
            runtime: {
              language: 'nodejs',
              version: '20',
            },
            scaling: {
              min: 0,
              max: 1000,
            },
          },
          {
            type: 'database',
            trafficPattern: 'burst',
            dataSizeGb: 10,
            scaling: {
              min: 1,
              max: 1,
            },
            dependsOn: ['api'],
          },
        ],
      },
      'data-pipeline': {
        name: 'my-data-pipeline',
        description: 'A data processing pipeline',
        environment: 'development',
        availability: '99.9',
        primaryRegion: 'us-east-1',
        cost: {
          monthlyBudgetUsd: 300,
          prioritizeCost: true,
          alertThreshold: 80,
        },
        compliance: ['none'],
        security: {
          encryptionAtRest: true,
          encryptionInTransit: true,
          networkIsolation: 'private-subnet',
        },
        tiers: [
          {
            type: 'queue',
            trafficPattern: 'burst',
            scaling: {
              min: 1,
              max: 100,
            },
          },
          {
            type: 'storage',
            trafficPattern: 'steady',
            dataSizeGb: 1000,
            scaling: {
              min: 1,
              max: 1,
            },
          },
          {
            type: 'analytics',
            trafficPattern: 'predictable-daily',
            scaling: {
              min: 1,
              max: 10,
            },
            dependsOn: ['queue', 'storage'],
          },
        ],
      },
      'ml-platform': {
        name: 'my-ml-platform',
        description: 'A machine learning training and inference platform',
        environment: 'development',
        availability: '99.9',
        primaryRegion: 'us-east-1',
        cost: {
          monthlyBudgetUsd: 2000,
          prioritizeCost: false,
          alertThreshold: 90,
        },
        compliance: ['none'],
        security: {
          encryptionAtRest: true,
          encryptionInTransit: true,
          networkIsolation: 'vpc-isolated',
        },
        tiers: [
          {
            type: 'storage',
            trafficPattern: 'steady',
            dataSizeGb: 5000,
            scaling: {
              min: 1,
              max: 1,
            },
          },
          {
            type: 'api',
            trafficPattern: 'burst',
            runtime: {
              language: 'python',
              version: '3.11',
              containerImage: 'python:3.11-slim',
              healthCheckPath: '/health',
            },
            scaling: {
              min: 1,
              max: 50,
            },
            dependsOn: ['storage'],
          },
        ],
      },
    };

    const sample = samples[type];
    if (!sample) {
      return {
        success: false,
        message: `Unknown sample type: ${type}`,
        errors: [`Valid types: ${Object.keys(samples).join(', ')}`],
      };
    }

    if (outputPath) {
      try {
        const absolutePath = path.resolve(outputPath);
        await fs.writeFile(absolutePath, JSON.stringify(sample, null, 2), 'utf-8');
        return {
          success: true,
          message: `Sample intent written to ${absolutePath}`,
          data: sample,
        };
      } catch (error) {
        return {
          success: false,
          message: 'Failed to write sample file',
          errors: [error instanceof Error ? error.message : String(error)],
        };
      }
    }

    return {
      success: true,
      message: `Sample ${type} intent`,
      data: sample,
    };
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private convertResult(result: IDIOResult): CommandResult {
    return {
      success: result.success,
      message: result.message,
      data: result.data,
      errors: result.errors,
    };
  }

  private parseSimpleYaml(content: string): ApplicationIntent {
    // Very basic YAML parsing - for production use a proper YAML library
    // This handles simple key: value structures
    const lines = content.split('\n');
    const result: Record<string, unknown> = {};
    const stack: { indent: number; obj: Record<string, unknown> }[] = [{ indent: -1, obj: result }];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = line.search(/\S/);
      const match = trimmed.match(/^([^:]+):\s*(.*)$/);
      
      if (!match) continue;

      const [, key, value] = match;
      
      // Pop stack until we find parent
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const parent = stack[stack.length - 1].obj;

      if (value) {
        // Simple value
        let parsedValue: unknown = value;
        if (value === 'true') parsedValue = true;
        else if (value === 'false') parsedValue = false;
        else if (/^\d+$/.test(value)) parsedValue = parseInt(value, 10);
        else if (/^\d+\.\d+$/.test(value)) parsedValue = parseFloat(value);
        else if (value.startsWith('[') && value.endsWith(']')) {
          // Simple array
          parsedValue = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        }
        parent[key.trim()] = parsedValue;
      } else {
        // Nested object
        const newObj: Record<string, unknown> = {};
        parent[key.trim()] = newObj;
        stack.push({ indent, obj: newObj });
      }
    }

    return result as unknown as ApplicationIntent;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createIDIOCLI(config?: IDIOCLIConfig): IDIOCLI {
  return new IDIOCLI(config);
}

// =============================================================================
// Command Definitions for CLI Integration
// =============================================================================

export interface CLICommand {
  name: string;
  description: string;
  usage: string;
  examples: string[];
  options?: {
    name: string;
    description: string;
    required?: boolean;
    default?: string;
  }[];
}

export const idioCommands: CLICommand[] = [
  {
    name: 'idio plan',
    description: 'Create an infrastructure plan from an intent file',
    usage: 'espada aws idio plan <intent-file>',
    examples: [
      'espada aws idio plan ./my-app.intent.json',
      'espada aws idio plan ./infrastructure/prod.yaml',
    ],
    options: [
      { name: '--dry-run', description: 'Preview without creating resources' },
      { name: '--output', description: 'Output format (json, yaml, table)', default: 'table' },
    ],
  },
  {
    name: 'idio plan template',
    description: 'Create a plan from a template',
    usage: 'espada aws idio plan template <template-id> [parameters]',
    examples: [
      'espada aws idio plan template three-tier-web --name=my-app --env=prod',
      'espada aws idio plan template serverless-api --name=api --region=us-west-2',
    ],
    options: [
      { name: '--name', description: 'Application name', required: true },
      { name: '--env', description: 'Environment (development, staging, production)', default: 'development' },
    ],
  },
  {
    name: 'idio execute',
    description: 'Execute a plan to provision infrastructure',
    usage: 'espada aws idio execute <plan-id>',
    examples: [
      'espada aws idio execute plan-abc123',
      'espada aws idio execute plan-abc123 --dry-run',
    ],
    options: [
      { name: '--dry-run', description: 'Preview changes without provisioning' },
      { name: '--skip-approval', description: 'Skip manual approval prompt' },
    ],
  },
  {
    name: 'idio deploy',
    description: 'Quick deploy: validate, plan, and execute in one step',
    usage: 'espada aws idio deploy <intent-file>',
    examples: [
      'espada aws idio deploy ./my-app.intent.json',
      'espada aws idio deploy ./my-app.intent.json --dry-run',
    ],
    options: [
      { name: '--dry-run', description: 'Preview without creating resources' },
      { name: '--skip-approval', description: 'Skip manual approval prompt' },
    ],
  },
  {
    name: 'idio status',
    description: 'Check the status of an execution',
    usage: 'espada aws idio status <execution-id>',
    examples: [
      'espada aws idio status exec-abc123',
    ],
  },
  {
    name: 'idio rollback',
    description: 'Rollback an execution to remove provisioned resources',
    usage: 'espada aws idio rollback <execution-id>',
    examples: [
      'espada aws idio rollback exec-abc123',
    ],
  },
  {
    name: 'idio templates',
    description: 'List available infrastructure templates',
    usage: 'espada aws idio templates [category]',
    examples: [
      'espada aws idio templates',
      'espada aws idio templates --category=web',
    ],
    options: [
      { name: '--category', description: 'Filter by category (web, api, data, ml, security)' },
    ],
  },
  {
    name: 'idio template',
    description: 'Get details of a specific template',
    usage: 'espada aws idio template <template-id>',
    examples: [
      'espada aws idio template three-tier-web',
      'espada aws idio template serverless-api',
    ],
  },
  {
    name: 'idio validate',
    description: 'Validate an intent file without creating a plan',
    usage: 'espada aws idio validate <intent-file>',
    examples: [
      'espada aws idio validate ./my-app.intent.json',
    ],
  },
  {
    name: 'idio cost',
    description: 'Estimate the cost of an intent',
    usage: 'espada aws idio cost <intent-file>',
    examples: [
      'espada aws idio cost ./my-app.intent.json',
    ],
  },
  {
    name: 'idio drift',
    description: 'Detect drift from desired state',
    usage: 'espada aws idio drift <execution-id>',
    examples: [
      'espada aws idio drift exec-abc123',
    ],
  },
  {
    name: 'idio reconcile',
    description: 'Reconcile infrastructure to match desired state',
    usage: 'espada aws idio reconcile <execution-id>',
    examples: [
      'espada aws idio reconcile exec-abc123',
      'espada aws idio reconcile exec-abc123 --auto-remediate',
    ],
    options: [
      { name: '--auto-remediate', description: 'Automatically fix detected drift' },
    ],
  },
  {
    name: 'idio init',
    description: 'Generate a sample intent file',
    usage: 'espada aws idio init <type> [output-file]',
    examples: [
      'espada aws idio init web-api ./my-app.intent.json',
      'espada aws idio init serverless',
      'espada aws idio init data-pipeline ./pipeline.intent.json',
    ],
    options: [
      { name: '--type', description: 'Type of sample (web-api, serverless, data-pipeline, ml-platform)', required: true },
    ],
  },
];
