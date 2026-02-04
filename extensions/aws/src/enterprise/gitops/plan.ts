/**
 * Infrastructure Plan Service
 *
 * Executes and manages infrastructure plans (terraform plan style)
 * with PR integration and approval workflows.
 */

import { randomUUID } from 'node:crypto';
import type {
  InfrastructurePlan,
  PlanStatus,
  PlanOutput,
  PlannedResource,
  CostEstimate,
  PolicyCheckResult,
  GitOpsResult,
} from './types.js';
import type { RepositoryManager, GitProviderClient } from './repository.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface PlanStorage {
  create(plan: InfrastructurePlan): Promise<void>;
  get(planId: string): Promise<InfrastructurePlan | null>;
  getByPR(repositoryId: string, prNumber: number): Promise<InfrastructurePlan[]>;
  getByCommit(repositoryId: string, commitSha: string): Promise<InfrastructurePlan | null>;
  list(options: {
    tenantId?: string;
    workspaceId?: string;
    repositoryId?: string;
    status?: PlanStatus;
    environment?: string;
    limit?: number;
    offset?: number;
  }): Promise<InfrastructurePlan[]>;
  update(planId: string, updates: Partial<InfrastructurePlan>): Promise<void>;
  delete(planId: string): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryPlanStorage implements PlanStorage {
  private plans = new Map<string, InfrastructurePlan>();

  async create(plan: InfrastructurePlan): Promise<void> {
    this.plans.set(plan.id, plan);
  }

  async get(planId: string): Promise<InfrastructurePlan | null> {
    return this.plans.get(planId) ?? null;
  }

  async getByPR(repositoryId: string, prNumber: number): Promise<InfrastructurePlan[]> {
    return Array.from(this.plans.values()).filter(
      p => p.repositoryId === repositoryId && p.pullRequestNumber === prNumber,
    );
  }

  async getByCommit(repositoryId: string, commitSha: string): Promise<InfrastructurePlan | null> {
    for (const plan of this.plans.values()) {
      if (plan.repositoryId === repositoryId && plan.commitSha === commitSha) {
        return plan;
      }
    }
    return null;
  }

  async list(options: {
    tenantId?: string;
    workspaceId?: string;
    repositoryId?: string;
    status?: PlanStatus;
    environment?: string;
    limit?: number;
    offset?: number;
  }): Promise<InfrastructurePlan[]> {
    let results = Array.from(this.plans.values()).filter(p => {
      if (options.tenantId && p.tenantId !== options.tenantId) return false;
      if (options.workspaceId && p.workspaceId !== options.workspaceId) return false;
      if (options.repositoryId && p.repositoryId !== options.repositoryId) return false;
      if (options.status && p.status !== options.status) return false;
      if (options.environment && p.environment !== options.environment) return false;
      return true;
    });

    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (options.offset) {
      results = results.slice(options.offset);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async update(planId: string, updates: Partial<InfrastructurePlan>): Promise<void> {
    const plan = this.plans.get(planId);
    if (plan) {
      this.plans.set(planId, { ...plan, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  async delete(planId: string): Promise<void> {
    this.plans.delete(planId);
  }
}

// =============================================================================
// Plan Executor Interface
// =============================================================================

export interface PlanExecutor {
  format: string;
  
  plan(params: PlanExecutionParams): Promise<PlanExecutionResult>;
  apply(params: ApplyExecutionParams): Promise<ApplyExecutionResult>;
  
  // Optional: estimate costs
  estimateCost?(params: CostEstimationParams): Promise<CostEstimate>;
  
  // Optional: run policy checks
  checkPolicies?(params: PolicyCheckParams): Promise<PolicyCheckResult[]>;
}

export interface PlanExecutionParams {
  workingDir: string;
  environment: string;
  variables?: Record<string, string>;
  targets?: string[];
  planFile?: string;
  refreshOnly?: boolean;
}

export interface PlanExecutionResult {
  success: boolean;
  hasChanges: boolean;
  planFile?: string;
  planJson?: string;
  humanReadable: string;
  resources: PlannedResource[];
  logs: string;
  errorLogs?: string;
}

export interface ApplyExecutionParams {
  workingDir: string;
  planFile?: string;
  autoApprove: boolean;
  targets?: string[];
}

export interface ApplyExecutionResult {
  success: boolean;
  logs: string;
  errorLogs?: string;
  appliedResources: string[];
}

export interface CostEstimationParams {
  planFile?: string;
  planJson?: string;
  workingDir: string;
}

export interface PolicyCheckParams {
  planFile?: string;
  planJson?: string;
  workingDir: string;
  policyPaths?: string[];
}

// =============================================================================
// Plan Service
// =============================================================================

export interface PlanServiceConfig {
  workDir?: string;
  planTimeout?: number;
  applyTimeout?: number;
  maxConcurrentPlans?: number;
}

export class PlanService {
  private storage: PlanStorage;
  private config: PlanServiceConfig;
  private repositoryManager: RepositoryManager;
  private executors = new Map<string, PlanExecutor>();

  constructor(
    repositoryManager: RepositoryManager,
    config?: PlanServiceConfig,
    storage?: PlanStorage,
  ) {
    this.repositoryManager = repositoryManager;
    this.config = config ?? {};
    this.storage = storage ?? new InMemoryPlanStorage();
  }

  // ===========================================================================
  // Executor Registration
  // ===========================================================================

  registerExecutor(executor: PlanExecutor): void {
    this.executors.set(executor.format, executor);
  }

  // ===========================================================================
  // Plan Creation
  // ===========================================================================

  async createPlan(
    repositoryId: string,
    triggeredBy: string,
    params: {
      triggerType: InfrastructurePlan['triggerType'];
      commitSha: string;
      branch: string;
      baseBranch?: string;
      pullRequestId?: string;
      pullRequestNumber?: number;
      environment: string;
      iacPath?: string;
    },
  ): Promise<GitOpsResult<InfrastructurePlan>> {
    // Get repository
    const repoResult = await this.repositoryManager.getRepository(repositoryId);
    if (!repoResult.success || !repoResult.data) {
      return { success: false, errors: ['Repository not found'] };
    }
    const repo = repoResult.data;

    const now = new Date().toISOString();
    const iacPath = params.iacPath ?? repo.iacPath;

    // Check if plan already exists for this commit
    const existingPlan = await this.storage.getByCommit(repositoryId, params.commitSha);
    if (existingPlan && existingPlan.status !== 'plan_failed' && existingPlan.status !== 'cancelled') {
      return { success: true, data: existingPlan, message: 'Plan already exists for this commit' };
    }

    // Determine if approval is required
    const requiresApproval = this.requiresApproval(repo, params.environment, params.branch);

    const plan: InfrastructurePlan = {
      id: `plan_${randomUUID()}`,
      tenantId: repo.tenantId,
      workspaceId: repo.workspaceId,
      repositoryId,
      triggerType: params.triggerType,
      triggeredBy,
      pullRequestId: params.pullRequestId,
      pullRequestNumber: params.pullRequestNumber,
      commitSha: params.commitSha,
      branch: params.branch,
      baseBranch: params.baseBranch,
      iacPath,
      environment: params.environment,
      status: 'pending',
      requiresApproval,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.create(plan);
    return { success: true, data: plan };
  }

  private requiresApproval(
    repo: { settings: { protectedEnvironments: Record<string, string[]> } },
    environment: string,
    branch: string,
  ): boolean {
    const protectedEnvs = repo.settings.protectedEnvironments;
    const allowedBranches = protectedEnvs[environment];
    
    if (!allowedBranches) return false;
    
    // If the branch is not in the allowed list, approval is required
    return !allowedBranches.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(`^${pattern.replace('*', '.*')}$`);
        return regex.test(branch);
      }
      return pattern === branch;
    });
  }

  // ===========================================================================
  // Plan Execution
  // ===========================================================================

  async executePlan(planId: string): Promise<GitOpsResult<InfrastructurePlan>> {
    const plan = await this.storage.get(planId);
    if (!plan) {
      return { success: false, errors: ['Plan not found'] };
    }

    if (plan.status !== 'pending') {
      return { success: false, errors: [`Cannot execute plan in ${plan.status} status`] };
    }

    // Get repository
    const repoResult = await this.repositoryManager.getRepository(plan.repositoryId);
    if (!repoResult.success || !repoResult.data) {
      return { success: false, errors: ['Repository not found'] };
    }
    const repo = repoResult.data;

    // Get executor for the IaC format
    const executor = this.executors.get(repo.iacFormat);
    if (!executor) {
      await this.storage.update(planId, {
        status: 'plan_failed',
        output: {
          hasChanges: false,
          changesCount: { add: 0, change: 0, destroy: 0, import: 0 },
          resources: [],
          humanReadable: '',
          logs: `No executor configured for format: ${repo.iacFormat}`,
        },
      });
      return { success: false, errors: [`No executor for format: ${repo.iacFormat}`] };
    }

    // Update status to planning
    await this.storage.update(planId, {
      status: 'planning',
      startedAt: new Date().toISOString(),
    });

    try {
      // Clone/checkout repository (in a real implementation)
      const workingDir = `${this.config.workDir ?? '/tmp/plans'}/${plan.id}`;
      
      // Get workspace mapping for environment
      const mapping = repo.settings.workspaceMappings.find(
        m => m.environment === plan.environment,
      );
      
      const variables = {
        ...mapping?.variables,
        AWS_REGION: mapping?.awsRegion ?? 'us-east-1',
      };

      // Execute plan
      const result = await executor.plan({
        workingDir: `${workingDir}/${plan.iacPath}`,
        environment: plan.environment,
        variables,
      });

      // Estimate costs if available
      let costEstimate: CostEstimate | undefined;
      if (executor.estimateCost && result.planFile) {
        try {
          costEstimate = await executor.estimateCost({
            planFile: result.planFile,
            planJson: result.planJson,
            workingDir: `${workingDir}/${plan.iacPath}`,
          });
        } catch {
          // Cost estimation is optional
        }
      }

      // Run policy checks if available
      let policyResults: PolicyCheckResult[] | undefined;
      if (executor.checkPolicies && result.planFile) {
        try {
          policyResults = await executor.checkPolicies({
            planFile: result.planFile,
            planJson: result.planJson,
            workingDir: `${workingDir}/${plan.iacPath}`,
          });
        } catch {
          // Policy checks are optional
        }
      }

      // Build output
      const output: PlanOutput = {
        hasChanges: result.hasChanges,
        changesCount: this.countChanges(result.resources),
        resources: result.resources,
        costEstimate,
        policyResults,
        planFile: result.planFile,
        planJson: result.planJson,
        humanReadable: result.humanReadable,
        logs: result.logs,
        errorLogs: result.errorLogs,
      };

      // Determine next status
      let nextStatus: PlanStatus = 'planned';
      if (!result.success) {
        nextStatus = 'plan_failed';
      } else if (plan.requiresApproval && result.hasChanges) {
        nextStatus = 'awaiting_approval';
      }

      await this.storage.update(planId, {
        status: nextStatus,
        completedAt: new Date().toISOString(),
        output,
      });

      const updated = await this.storage.get(planId);
      return { success: result.success, data: updated! };
    } catch (error) {
      await this.storage.update(planId, {
        status: 'plan_failed',
        completedAt: new Date().toISOString(),
        output: {
          hasChanges: false,
          changesCount: { add: 0, change: 0, destroy: 0, import: 0 },
          resources: [],
          humanReadable: '',
          logs: '',
          errorLogs: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      return {
        success: false,
        errors: [`Plan execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  private countChanges(resources: PlannedResource[]): PlanOutput['changesCount'] {
    return resources.reduce(
      (acc, r) => {
        switch (r.action) {
          case 'create':
            acc.add++;
            break;
          case 'update':
          case 'replace':
            acc.change++;
            break;
          case 'delete':
            acc.destroy++;
            break;
        }
        return acc;
      },
      { add: 0, change: 0, destroy: 0, import: 0 },
    );
  }

  // ===========================================================================
  // Approval Operations
  // ===========================================================================

  async approvePlan(
    planId: string,
    userId: string,
    approvalRequestId?: string,
  ): Promise<GitOpsResult<InfrastructurePlan>> {
    const plan = await this.storage.get(planId);
    if (!plan) {
      return { success: false, errors: ['Plan not found'] };
    }

    if (plan.status !== 'awaiting_approval') {
      return { success: false, errors: ['Plan is not awaiting approval'] };
    }

    await this.storage.update(planId, {
      status: 'approved',
      approvedBy: userId,
      approvedAt: new Date().toISOString(),
      approvalRequestId,
    });

    const updated = await this.storage.get(planId);
    return { success: true, data: updated! };
  }

  async rejectPlan(planId: string, reason?: string): Promise<GitOpsResult<InfrastructurePlan>> {
    const plan = await this.storage.get(planId);
    if (!plan) {
      return { success: false, errors: ['Plan not found'] };
    }

    if (plan.status !== 'awaiting_approval') {
      return { success: false, errors: ['Plan is not awaiting approval'] };
    }

    await this.storage.update(planId, {
      status: 'rejected',
      completedAt: new Date().toISOString(),
    });

    const updated = await this.storage.get(planId);
    return { success: true, data: updated!, message: reason };
  }

  // ===========================================================================
  // Apply Operations
  // ===========================================================================

  async applyPlan(planId: string): Promise<GitOpsResult<InfrastructurePlan>> {
    const plan = await this.storage.get(planId);
    if (!plan) {
      return { success: false, errors: ['Plan not found'] };
    }

    if (!['planned', 'approved'].includes(plan.status)) {
      return { success: false, errors: [`Cannot apply plan in ${plan.status} status`] };
    }

    // If approval required but not approved
    if (plan.requiresApproval && plan.status !== 'approved') {
      return { success: false, errors: ['Plan requires approval before apply'] };
    }

    // Get repository
    const repoResult = await this.repositoryManager.getRepository(plan.repositoryId);
    if (!repoResult.success || !repoResult.data) {
      return { success: false, errors: ['Repository not found'] };
    }
    const repo = repoResult.data;

    // Get executor
    const executor = this.executors.get(repo.iacFormat);
    if (!executor) {
      return { success: false, errors: [`No executor for format: ${repo.iacFormat}`] };
    }

    // Update status
    await this.storage.update(planId, { status: 'applying' });

    try {
      const workingDir = `${this.config.workDir ?? '/tmp/plans'}/${plan.id}`;
      
      const result = await executor.apply({
        workingDir: `${workingDir}/${plan.iacPath}`,
        planFile: plan.output?.planFile,
        autoApprove: true,
      });

      const nextStatus: PlanStatus = result.success ? 'applied' : 'apply_failed';
      
      await this.storage.update(planId, {
        status: nextStatus,
        completedAt: new Date().toISOString(),
        output: plan.output ? {
          ...plan.output,
          logs: plan.output.logs + '\n\n--- Apply ---\n' + result.logs,
          errorLogs: result.errorLogs,
        } : undefined,
      });

      const updated = await this.storage.get(planId);
      return { success: result.success, data: updated! };
    } catch (error) {
      await this.storage.update(planId, {
        status: 'apply_failed',
        completedAt: new Date().toISOString(),
      });
      return {
        success: false,
        errors: [`Apply failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  // ===========================================================================
  // Cancel Operations
  // ===========================================================================

  async cancelPlan(planId: string): Promise<GitOpsResult> {
    const plan = await this.storage.get(planId);
    if (!plan) {
      return { success: false, errors: ['Plan not found'] };
    }

    if (['applied', 'apply_failed', 'cancelled'].includes(plan.status)) {
      return { success: false, errors: ['Plan cannot be cancelled'] };
    }

    await this.storage.update(planId, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    });

    return { success: true, message: 'Plan cancelled' };
  }

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  async getPlan(planId: string): Promise<GitOpsResult<InfrastructurePlan>> {
    const plan = await this.storage.get(planId);
    if (!plan) {
      return { success: false, errors: ['Plan not found'] };
    }
    return { success: true, data: plan };
  }

  async listPlans(options: {
    tenantId?: string;
    workspaceId?: string;
    repositoryId?: string;
    status?: PlanStatus;
    environment?: string;
    limit?: number;
    offset?: number;
  }): Promise<GitOpsResult<InfrastructurePlan[]>> {
    const plans = await this.storage.list(options);
    return { success: true, data: plans };
  }

  async getPlansForPR(
    repositoryId: string,
    prNumber: number,
  ): Promise<GitOpsResult<InfrastructurePlan[]>> {
    const plans = await this.storage.getByPR(repositoryId, prNumber);
    return { success: true, data: plans };
  }

  // ===========================================================================
  // Comment Tracking
  // ===========================================================================

  async setCommentId(
    planId: string,
    commentId: string,
    commentUrl: string,
  ): Promise<GitOpsResult> {
    await this.storage.update(planId, { commentId, commentUrl });
    return { success: true };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createPlanService(
  repositoryManager: RepositoryManager,
  config?: PlanServiceConfig,
  storage?: PlanStorage,
): PlanService {
  return new PlanService(repositoryManager, config, storage);
}
