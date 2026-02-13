/**
 * Intent-Driven Infrastructure Orchestration (IDIO) - Main Orchestrator
 * 
 * Coordinates intent compilation, policy validation, execution, and reconciliation.
 */

import { randomUUID } from 'node:crypto';
import type {
  ApplicationIntent,
  InfrastructurePlan,
  IntentExecutionResult,
  ReconciliationResult,
} from '../intent/types.js';
import { createIntentCompiler, type CompilerConfig } from '../intent/compiler.js';
import { createPolicyEngine, type PolicyEngineConfig } from '../policy/engine.js';
import { createReconciliationEngine, type ReconciliationConfig } from '../reconciliation/engine.js';
import { getTemplate, applyTemplate, listTemplates } from '../catalog/templates.js';
import { validateIntent } from '../intent/schema.js';
import { createExecutionEngine, type ExecutionEngineConfig } from './execution-engine.js';

/**
 * Custom error types for better error handling
 */
export class IntentValidationError extends Error {
  constructor(message: string, public errors: string[]) {
    super(message);
    this.name = 'IntentValidationError';
  }
}

export class PlanExecutionError extends Error {
  constructor(message: string, public planId: string, public cause?: Error) {
    super(message);
    this.name = 'PlanExecutionError';
  }
}

export class TemplateNotFoundError extends Error {
  constructor(public templateId: string) {
    super(`Template ${templateId} not found`);
    this.name = 'TemplateNotFoundError';
  }
}

export interface IDIOConfig {
  compiler: Partial<CompilerConfig>;
  policyEngine: Partial<PolicyEngineConfig>;
  reconciliation: Partial<ReconciliationConfig>;
  /** Execution engine configuration */
  executionEngine?: Partial<ExecutionEngineConfig>;
  /** Store for persisting plans and executions */
  stateDirectory?: string;
}

export interface IDIOResult {
  success: boolean;
  message: string;
  data?: unknown;
  errors?: string[];
}

/**
 * IDIO Orchestrator - Main entry point for intent-driven infrastructure
 */
export class IDIOOrchestrator {
  private compiler;
  private policyEngine;
  private reconciliationEngine;
  private executionEngine;
  private plans: Map<string, InfrastructurePlan>;
  private executions: Map<string, IntentExecutionResult>;

  constructor(private config: IDIOConfig) {
    this.compiler = createIntentCompiler(config.compiler);
    this.policyEngine = createPolicyEngine(config.policyEngine);
    this.reconciliationEngine = createReconciliationEngine(
      config.reconciliation,
      this.policyEngine,
    );
    this.executionEngine = createExecutionEngine({
      region: config.compiler.defaultRegion ?? 'us-east-1',
      enableRollback: true,
      ...config.executionEngine,
    });
    this.plans = new Map();
    this.executions = new Map();
  }

  /**
   * Create infrastructure plan from intent
   */
  async createPlanFromIntent(
    intent: ApplicationIntent,
    userId?: string,
  ): Promise<IDIOResult> {
    try {
      const plan = await this.validateAndCompile(intent, userId);
      this.plans.set(plan.id, plan);

      return {
        success: true,
        message: `Infrastructure plan created successfully`,
        data: {
          planId: plan.id,
          estimatedCostUsd: plan.estimatedMonthlyCostUsd,
          resourceCount: plan.resources.length,
          policyValidation: plan.policyValidation,
          guardrailChecks: plan.guardrailChecks,
          requiresApproval: plan.guardrailChecks.some(c => c.approvalLevel !== 'none'),
        },
      };
    } catch (error) {
      if (error instanceof IntentValidationError) {
        return {
          success: false,
          message: error.message,
          errors: error.errors,
        };
      }
      return {
        success: false,
        message: 'Failed to create infrastructure plan',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Validate intent and compile into plan
   */
  private async validateAndCompile(
    intent: ApplicationIntent,
    userId?: string,
  ): Promise<InfrastructurePlan> {
    // Validate intent structure
    const validation = validateIntent(intent);
    if (!validation.valid) {
      throw new IntentValidationError('Intent validation failed', validation.errors || []);
    }

    // Compile intent into plan
    return await this.compiler.compile(intent, {
      executionId: randomUUID(),
      timestamp: new Date().toISOString(),
      userId,
    });
  }

  /**
   * Create plan from template
   */
  async createPlanFromTemplate(
    templateId: string,
    parameters: Record<string, unknown>,
    userId?: string,
  ): Promise<IDIOResult> {
    try {
      const intent = applyTemplate(templateId, parameters);
      
      if (!intent) {
        throw new TemplateNotFoundError(templateId);
      }

      return await this.createPlanFromIntent(intent as ApplicationIntent, userId);
    } catch (error) {
      if (error instanceof TemplateNotFoundError) {
        return {
          success: false,
          message: error.message,
        };
      }
      return {
        success: false,
        message: 'Failed to create plan from template',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Validate intent without creating plan
   */
  async validateIntent(intent: ApplicationIntent): Promise<IDIOResult> {
    try {
      const validation = validateIntent(intent);
      
      if (!validation.valid) {
        return {
          success: false,
          message: 'Intent validation failed',
          errors: validation.errors,
        };
      }

      // Compile for policy validation
      const plan = await this.compiler.compile(intent, {
        executionId: 'validation-only',
        timestamp: new Date().toISOString(),
      });

      return {
        success: plan.policyValidation.passed,
        message: plan.policyValidation.passed 
          ? 'Intent is valid and compliant'
          : 'Intent has policy violations',
        data: {
          policyValidation: plan.policyValidation,
          guardrailChecks: plan.guardrailChecks,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Validation failed',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Estimate cost for intent
   */
  async estimateCost(intent: ApplicationIntent): Promise<IDIOResult> {
    try {
      const plan = await this.compiler.compile(intent, {
        executionId: 'cost-estimation-only',
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: `Estimated monthly cost: $${plan.estimatedMonthlyCostUsd.toFixed(2)}`,
        data: {
          totalCostUsd: plan.estimatedMonthlyCostUsd,
          costBreakdown: plan.costBreakdown,
          withinBudget: plan.estimatedMonthlyCostUsd <= intent.cost.monthlyBudgetUsd,
          budgetUtilization: (plan.estimatedMonthlyCostUsd / intent.cost.monthlyBudgetUsd * 100).toFixed(1),
        },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Cost estimation failed',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Execute infrastructure plan
   */
  async executePlan(
    planId: string,
    options: {
      dryRun?: boolean;
      autoApprove?: boolean;
    } = {},
  ): Promise<IDIOResult> {
    try {
      const plan = this.plans.get(planId);
      
      if (!plan) {
        return {
          success: false,
          message: `Plan ${planId} not found`,
        };
      }

      // Check approval requirements
      const requiresApproval = plan.guardrailChecks.some(c => c.approvalLevel !== 'none');
      
      if (requiresApproval && !options.autoApprove && !options.dryRun) {
        return {
          success: false,
          message: 'Plan requires approval before execution',
          data: {
            requiredApprovals: plan.guardrailChecks
              .filter(c => c.approvalLevel !== 'none')
              .map(c => ({ check: c.check, level: c.approvalLevel })),
          },
        };
      }

      // Check policy violations
      if (!plan.policyValidation.passed) {
        const criticalViolations = plan.policyValidation.violations.filter(
          v => v.severity === 'critical'
        );
        
        if (criticalViolations.length > 0) {
          return {
            success: false,
            message: 'Cannot execute plan with critical policy violations',
            data: {
              violations: criticalViolations,
            },
          };
        }
      }

      if (options.dryRun) {
        return {
          success: true,
          message: 'Dry run completed successfully',
          data: {
            planId,
            resourceCount: plan.resources.length,
            executionOrder: plan.executionOrder,
            estimatedTimeMinutes: plan.resources.length * 2, // Rough estimate
          },
        };
      }

      // Execute plan via the real AWS Execution Engine
      const execution = await this.executionEngine.execute(plan);
      this.executions.set(execution.executionId, execution);

      return {
        success: true,
        message: execution.status === 'completed'
          ? `Plan executed successfully — ${execution.provisionedResources.length} resource(s) provisioned`
          : 'Plan execution started',
        data: {
          executionId: execution.executionId,
          planId,
          status: execution.status,
          provisionedResources: execution.provisionedResources.length,
          errors: execution.errors.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Plan execution failed',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Check execution status
   */
  async checkStatus(executionId: string): Promise<IDIOResult> {
    const execution = this.executions.get(executionId);
    
    if (!execution) {
      return {
        success: false,
        message: `Execution ${executionId} not found`,
      };
    }

    return {
      success: true,
      message: `Execution status: ${execution.status}`,
      data: {
        executionId: execution.executionId,
        planId: execution.planId,
        status: execution.status,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        provisionedResourcesCount: execution.provisionedResources.length,
        errorsCount: execution.errors.length,
        actualCostUsd: execution.actualMonthlyCostUsd,
      },
    };
  }

  /**
   * Perform reconciliation check
   */
  async reconcile(executionId: string): Promise<IDIOResult> {
    try {
      const execution = this.executions.get(executionId);
      
      if (!execution) {
        return {
          success: false,
          message: `Execution ${executionId} not found`,
        };
      }

      const plan = this.plans.get(execution.planId);
      
      if (!plan) {
        return {
          success: false,
          message: `Plan ${execution.planId} not found`,
        };
      }

      const result = await this.reconciliationEngine.reconcile({
        plan,
        execution,
        region: plan.intent.primaryRegion,
      });

      return {
        success: true,
        message: 'Reconciliation completed',
        data: {
          reconciliationId: result.id,
          driftDetected: result.driftDetected,
          driftCount: result.drifts.length,
          complianceViolations: result.complianceViolations.length,
          costAnomalies: result.costAnomalies.length,
          recommendedActions: result.recommendedActions.length,
          autoRemediationApplied: result.autoRemediationApplied,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Reconciliation failed',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Rollback execution
   */
  async rollback(executionId: string): Promise<IDIOResult> {
    try {
      const execution = this.executions.get(executionId);
      
      if (!execution) {
        return {
          success: false,
          message: `Execution ${executionId} not found`,
        };
      }

      const plan = this.plans.get(execution.planId);
      
      if (!plan) {
        return {
          success: false,
          message: `Plan ${execution.planId} not found`,
        };
      }

      // Trigger actual resource deletion via the execution engine
      await this.executionEngine.rollback(executionId);

      execution.status = 'rolled-back';
      execution.rollbackTriggered = true;

      return {
        success: true,
        message: 'Rollback completed successfully — provisioned resources deleted',
        data: {
          executionId,
          rollbackSteps: plan.rollbackPlan?.steps.length ?? execution.provisionedResources.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Rollback failed',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * List available templates
   */
  listTemplates(category?: string): IDIOResult {
    try {
      const templates = listTemplates();
      const filtered = category
        ? templates.filter(t => t.category === category)
        : templates;

      return {
        success: true,
        message: `Found ${filtered.length} template(s)`,
        data: { templates: filtered },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to list templates',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Get template details
   */
  getTemplate(templateId: string): IDIOResult {
    try {
      const template = getTemplate(templateId);
      
      if (!template) {
        return {
          success: false,
          message: `Template ${templateId} not found`,
        };
      }

      return {
        success: true,
        message: `Template: ${template.name}`,
        data: { template },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get template',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Get plan details
   */
  getPlan(planId: string): IDIOResult {
    const plan = this.plans.get(planId);
    
    if (!plan) {
      return {
        success: false,
        message: `Plan ${planId} not found`,
      };
    }

    return {
      success: true,
      message: `Plan for ${plan.intent.name}`,
      data: { plan },
    };
  }
}

/**
 * Create IDIO orchestrator instance
 */
export function createIDIOOrchestrator(config?: Partial<IDIOConfig>): IDIOOrchestrator {
  const defaultConfig: IDIOConfig = {
    compiler: {
      defaultRegion: 'us-east-1',
      enableCostOptimization: true,
      enableGuardrails: true,
      dryRun: false,
    },
    policyEngine: {
      enableAutoFix: false,
      failOnCritical: true,
    },
    reconciliation: {
      intervalMinutes: 15,
      enableAutoRemediation: false,
      costAnomalyThreshold: 20,
      maxRemediationAttempts: 3,
    },
  };

  return new IDIOOrchestrator({
    compiler: { ...defaultConfig.compiler, ...config?.compiler },
    policyEngine: { ...defaultConfig.policyEngine, ...config?.policyEngine },
    reconciliation: { ...defaultConfig.reconciliation, ...config?.reconciliation },
    executionEngine: config?.executionEngine,
    stateDirectory: config?.stateDirectory,
  });
}
