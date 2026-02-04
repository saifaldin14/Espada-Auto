/**
 * PR Comment Service
 *
 * Generates and manages terraform plan style PR comments
 * with rich formatting and status updates.
 */

import type {
  InfrastructurePlan,
  PlanOutput,
  PlannedResource,
  CostEstimate,
  PolicyCheckResult,
  PlanComment,
  GitOpsResult,
} from './types.js';
import type { RepositoryManager, GitProviderClient } from './repository.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface CommentStorage {
  create(comment: PlanComment): Promise<void>;
  get(commentId: string): Promise<PlanComment | null>;
  getByPlan(planId: string): Promise<PlanComment | null>;
  list(repositoryId: string, prNumber: number): Promise<PlanComment[]>;
  update(commentId: string, updates: Partial<PlanComment>): Promise<void>;
  delete(commentId: string): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryCommentStorage implements CommentStorage {
  private comments = new Map<string, PlanComment>();

  async create(comment: PlanComment): Promise<void> {
    this.comments.set(comment.id, comment);
  }

  async get(commentId: string): Promise<PlanComment | null> {
    return this.comments.get(commentId) ?? null;
  }

  async getByPlan(planId: string): Promise<PlanComment | null> {
    for (const comment of this.comments.values()) {
      if (comment.planId === planId) {
        return comment;
      }
    }
    return null;
  }

  async list(repositoryId: string, prNumber: number): Promise<PlanComment[]> {
    return Array.from(this.comments.values()).filter(
      c => c.repositoryId === repositoryId && c.pullRequestNumber === prNumber,
    );
  }

  async update(commentId: string, updates: Partial<PlanComment>): Promise<void> {
    const comment = this.comments.get(commentId);
    if (comment) {
      this.comments.set(commentId, { ...comment, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  async delete(commentId: string): Promise<void> {
    this.comments.delete(commentId);
  }
}

// =============================================================================
// PR Comment Service
// =============================================================================

export interface PRCommentServiceConfig {
  botName?: string;
  headerEmoji?: string;
  collapseLargePlans?: boolean;
  collapseThreshold?: number;
  showCostEstimates?: boolean;
  showPolicyResults?: boolean;
  showDetailedDiff?: boolean;
}

export class PRCommentService {
  private storage: CommentStorage;
  private config: PRCommentServiceConfig;
  private repositoryManager: RepositoryManager;

  constructor(
    repositoryManager: RepositoryManager,
    config?: PRCommentServiceConfig,
    storage?: CommentStorage,
  ) {
    this.repositoryManager = repositoryManager;
    this.config = {
      botName: 'IDIO',
      headerEmoji: '🏗️',
      collapseLargePlans: true,
      collapseThreshold: 50,
      showCostEstimates: true,
      showPolicyResults: true,
      showDetailedDiff: true,
      ...config,
    };
    this.storage = storage ?? new InMemoryCommentStorage();
  }

  // ===========================================================================
  // Comment Creation/Update
  // ===========================================================================

  async createOrUpdatePlanComment(
    plan: InfrastructurePlan,
  ): Promise<GitOpsResult<PlanComment>> {
    if (!plan.pullRequestNumber) {
      return { success: false, errors: ['Plan is not associated with a PR'] };
    }

    // Get repository
    const repoResult = await this.repositoryManager.getRepository(plan.repositoryId);
    if (!repoResult.success || !repoResult.data) {
      return { success: false, errors: ['Repository not found'] };
    }
    const repo = repoResult.data;

    // Get provider client
    const client = this.repositoryManager.getClient(repo.provider);
    if (!client) {
      return { success: false, errors: ['Provider client not configured'] };
    }

    // Generate comment body
    const body = this.generateCommentBody(plan);
    const title = this.generateTitle(plan);
    const summary = this.generateSummary(plan);

    // Check if we already have a comment for this plan
    const existingComment = await this.storage.getByPlan(plan.id);

    try {
      let providerCommentId: string;
      let commentUrl: string;

      if (existingComment) {
        // Update existing comment
        await client.updateComment(repo.owner, repo.name, existingComment.commentId, body);
        providerCommentId = existingComment.commentId;
        commentUrl = existingComment.commentUrl;

        await this.storage.update(existingComment.id, {
          title,
          summary,
          details: body,
          status: 'updated',
        });

        const updated = await this.storage.get(existingComment.id);
        return { success: true, data: updated! };
      } else {
        // Create new comment
        const response = await client.createComment(repo.owner, repo.name, plan.pullRequestNumber, body);
        providerCommentId = response.id;
        commentUrl = response.url;

        const comment: PlanComment = {
          id: `pc_${plan.id}`,
          planId: plan.id,
          repositoryId: plan.repositoryId,
          pullRequestNumber: plan.pullRequestNumber,
          commentId: providerCommentId,
          commentUrl,
          title,
          summary,
          details: body,
          status: 'created',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await this.storage.create(comment);
        return { success: true, data: comment };
      }
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to create/update comment: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  // ===========================================================================
  // Comment Generation
  // ===========================================================================

  private generateTitle(plan: InfrastructurePlan): string {
    const { headerEmoji, botName } = this.config;
    const statusIcon = this.getStatusIcon(plan.status);
    return `${headerEmoji} ${botName} - ${plan.environment} ${statusIcon}`;
  }

  private generateSummary(plan: InfrastructurePlan): string {
    if (!plan.output) {
      return `Plan is ${plan.status}`;
    }

    const { changesCount, hasChanges } = plan.output;
    if (!hasChanges) {
      return 'No changes. Your infrastructure matches the configuration.';
    }

    const parts: string[] = [];
    if (changesCount.add > 0) parts.push(`${changesCount.add} to add`);
    if (changesCount.change > 0) parts.push(`${changesCount.change} to change`);
    if (changesCount.destroy > 0) parts.push(`${changesCount.destroy} to destroy`);
    
    return parts.join(', ');
  }

  private generateCommentBody(plan: InfrastructurePlan): string {
    const { headerEmoji, botName } = this.config;
    const statusIcon = this.getStatusIcon(plan.status);
    const statusText = this.getStatusText(plan.status);

    const sections: string[] = [];

    // Header
    sections.push(`## ${headerEmoji} ${botName} Plan - ${plan.environment}`);
    sections.push('');
    sections.push(`**Status:** ${statusIcon} ${statusText}`);
    sections.push(`**Path:** \`${plan.iacPath}\``);
    sections.push(`**Commit:** \`${plan.commitSha.slice(0, 7)}\``);
    sections.push(`**Branch:** \`${plan.branch}\``);
    sections.push('');

    // Summary
    if (plan.output) {
      sections.push(this.generateChangeSummary(plan.output));
      sections.push('');

      // Cost estimate
      if (this.config.showCostEstimates && plan.output.costEstimate) {
        sections.push(this.generateCostSection(plan.output.costEstimate));
        sections.push('');
      }

      // Policy results
      if (this.config.showPolicyResults && plan.output.policyResults?.length) {
        sections.push(this.generatePolicySection(plan.output.policyResults));
        sections.push('');
      }

      // Resource changes
      if (plan.output.hasChanges && plan.output.resources.length > 0) {
        sections.push(this.generateResourcesSection(plan.output.resources));
        sections.push('');
      }

      // Plan output
      if (plan.output.humanReadable) {
        sections.push(this.generatePlanOutputSection(plan.output.humanReadable));
        sections.push('');
      }
    } else if (plan.status === 'pending' || plan.status === 'planning') {
      sections.push('⏳ Plan in progress...');
      sections.push('');
    } else if (plan.status === 'plan_failed') {
      sections.push('❌ Plan failed. Check the logs for details.');
      sections.push('');
    }

    // Actions section
    sections.push(this.generateActionsSection(plan));
    sections.push('');

    // Footer
    sections.push('---');
    sections.push(`*Updated at ${new Date().toISOString()}*`);

    return sections.join('\n');
  }

  private generateChangeSummary(output: PlanOutput): string {
    const { changesCount, hasChanges } = output;

    if (!hasChanges) {
      return '### ✅ No Changes\n\nYour infrastructure matches the configuration.';
    }

    const lines = ['### 📊 Change Summary', ''];
    
    const parts: string[] = [];
    if (changesCount.add > 0) parts.push(`🟢 **${changesCount.add}** to add`);
    if (changesCount.change > 0) parts.push(`🟡 **${changesCount.change}** to change`);
    if (changesCount.destroy > 0) parts.push(`🔴 **${changesCount.destroy}** to destroy`);
    
    lines.push(parts.join(' | '));

    return lines.join('\n');
  }

  private generateCostSection(cost: CostEstimate): string {
    const lines = ['### 💰 Cost Estimate', ''];
    
    const deltaSign = cost.monthlyDelta >= 0 ? '+' : '';
    const deltaColor = cost.monthlyDelta > 0 ? '🔺' : cost.monthlyDelta < 0 ? '🔻' : '➡️';
    
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Monthly cost before | ${cost.currency} ${cost.monthlyCostBefore.toFixed(2)} |`);
    lines.push(`| Monthly cost after | ${cost.currency} ${cost.monthlyCostAfter.toFixed(2)} |`);
    lines.push(`| Change | ${deltaColor} ${deltaSign}${cost.currency} ${cost.monthlyDelta.toFixed(2)} |`);

    return lines.join('\n');
  }

  private generatePolicySection(results: PolicyCheckResult[]): string {
    const lines = ['### 🛡️ Policy Checks', ''];
    
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const warnings = results.filter(r => r.status === 'warning').length;
    
    lines.push(`✅ ${passed} passed | ⚠️ ${warnings} warnings | ❌ ${failed} failed`);
    lines.push('');
    
    // Show failed and warning policies
    const important = results.filter(r => r.status === 'failed' || r.status === 'warning');
    if (important.length > 0) {
      lines.push('<details>');
      lines.push('<summary>Policy Details</summary>');
      lines.push('');
      
      for (const result of important) {
        const icon = result.status === 'failed' ? '❌' : '⚠️';
        lines.push(`- ${icon} **${result.policyName}** (${result.severity}): ${result.message}`);
        if (result.remediation) {
          lines.push(`  - Remediation: ${result.remediation}`);
        }
      }
      
      lines.push('');
      lines.push('</details>');
    }

    return lines.join('\n');
  }

  private generateResourcesSection(resources: PlannedResource[]): string {
    const lines = ['### 📋 Resources', ''];
    
    const shouldCollapse = this.config.collapseLargePlans && 
                          resources.length > (this.config.collapseThreshold ?? 50);

    if (shouldCollapse) {
      lines.push('<details>');
      lines.push(`<summary>View ${resources.length} resource changes</summary>`);
      lines.push('');
    }

    // Group by action
    const byAction = new Map<string, PlannedResource[]>();
    for (const resource of resources) {
      const list = byAction.get(resource.action) ?? [];
      list.push(resource);
      byAction.set(resource.action, list);
    }

    const actionOrder = ['create', 'update', 'replace', 'delete', 'read', 'no-op'];
    for (const action of actionOrder) {
      const actionResources = byAction.get(action);
      if (!actionResources?.length) continue;

      const icon = this.getActionIcon(action);
      lines.push(`#### ${icon} ${action.charAt(0).toUpperCase() + action.slice(1)} (${actionResources.length})`);
      lines.push('');
      
      for (const resource of actionResources) {
        lines.push(`- \`${resource.address}\` (${resource.type})`);
        
        if (this.config.showDetailedDiff && resource.changedAttributes?.length) {
          for (const attr of resource.changedAttributes.slice(0, 5)) {
            lines.push(`  - ${attr}`);
          }
          if (resource.changedAttributes.length > 5) {
            lines.push(`  - ... and ${resource.changedAttributes.length - 5} more`);
          }
        }
      }
      lines.push('');
    }

    if (shouldCollapse) {
      lines.push('</details>');
    }

    return lines.join('\n');
  }

  private generatePlanOutputSection(output: string): string {
    const lines = ['### 📜 Plan Output', ''];
    
    // Always collapse the raw output
    lines.push('<details>');
    lines.push('<summary>Show terraform plan output</summary>');
    lines.push('');
    lines.push('```hcl');
    
    // Truncate if too long
    const maxLength = 65000; // GitHub comment limit is ~65535
    if (output.length > maxLength) {
      lines.push(output.slice(0, maxLength));
      lines.push('');
      lines.push('... output truncated ...');
    } else {
      lines.push(output);
    }
    
    lines.push('```');
    lines.push('');
    lines.push('</details>');

    return lines.join('\n');
  }

  private generateActionsSection(plan: InfrastructurePlan): string {
    const lines = ['### 🎯 Actions', ''];
    
    switch (plan.status) {
      case 'planned':
        if (plan.requiresApproval) {
          lines.push('This plan requires approval before apply.');
          lines.push('');
          lines.push('- Comment `/approve` to approve and apply');
          lines.push('- Comment `/reject` to reject this plan');
        } else {
          lines.push('- Comment `/apply` to apply this plan');
        }
        lines.push('- Comment `/plan` to re-run the plan');
        break;
        
      case 'awaiting_approval':
        lines.push('⏳ **Waiting for approval**');
        lines.push('');
        lines.push('- Comment `/approve` to approve and apply');
        lines.push('- Comment `/reject` to reject this plan');
        break;
        
      case 'approved':
        lines.push('✅ **Approved** - Apply in progress...');
        break;
        
      case 'applying':
        lines.push('🔄 **Apply in progress...**');
        break;
        
      case 'applied':
        lines.push('✅ **Successfully applied!**');
        break;
        
      case 'plan_failed':
      case 'apply_failed':
        lines.push('❌ **Failed** - Check logs for details');
        lines.push('');
        lines.push('- Comment `/plan` to retry');
        break;
        
      case 'rejected':
        lines.push('🚫 **Rejected**');
        lines.push('');
        lines.push('- Comment `/plan` to create a new plan');
        break;
        
      default:
        lines.push('- Comment `/plan` to generate a plan');
    }

    return lines.join('\n');
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'pending':
      case 'planning':
        return '⏳';
      case 'planned':
        return '📋';
      case 'awaiting_approval':
        return '👀';
      case 'approved':
        return '✅';
      case 'applying':
        return '🔄';
      case 'applied':
        return '🎉';
      case 'plan_failed':
      case 'apply_failed':
        return '❌';
      case 'rejected':
        return '🚫';
      case 'cancelled':
        return '⛔';
      default:
        return '❓';
    }
  }

  private getStatusText(status: string): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'planning':
        return 'Planning...';
      case 'planned':
        return 'Plan Complete';
      case 'awaiting_approval':
        return 'Awaiting Approval';
      case 'approved':
        return 'Approved';
      case 'applying':
        return 'Applying...';
      case 'applied':
        return 'Applied Successfully';
      case 'plan_failed':
        return 'Plan Failed';
      case 'apply_failed':
        return 'Apply Failed';
      case 'rejected':
        return 'Rejected';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  }

  private getActionIcon(action: string): string {
    switch (action) {
      case 'create':
        return '🟢';
      case 'update':
        return '🟡';
      case 'replace':
        return '🔄';
      case 'delete':
        return '🔴';
      case 'read':
        return '📖';
      default:
        return '⚪';
    }
  }

  // ===========================================================================
  // Status Updates
  // ===========================================================================

  async postStatusCheck(
    plan: InfrastructurePlan,
  ): Promise<GitOpsResult> {
    // Get repository
    const repoResult = await this.repositoryManager.getRepository(plan.repositoryId);
    if (!repoResult.success || !repoResult.data) {
      return { success: false, errors: ['Repository not found'] };
    }
    const repo = repoResult.data;

    // Get provider client
    const client = this.repositoryManager.getClient(repo.provider);
    if (!client) {
      return { success: false, errors: ['Provider client not configured'] };
    }

    const status = this.mapPlanStatusToCheck(plan.status);
    const conclusion = this.mapPlanStatusToConclusion(plan.status);
    const summary = this.generateSummary(plan);

    try {
      await client.createCheckRun(repo.owner, repo.name, {
        name: `IDIO Plan (${plan.environment})`,
        headSha: plan.commitSha,
        status,
        conclusion,
        title: this.generateTitle(plan),
        summary,
        detailsUrl: plan.commentUrl,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to post status check: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  private mapPlanStatusToCheck(status: string): 'queued' | 'in_progress' | 'completed' {
    switch (status) {
      case 'pending':
        return 'queued';
      case 'planning':
      case 'applying':
        return 'in_progress';
      default:
        return 'completed';
    }
  }

  private mapPlanStatusToConclusion(
    status: string,
  ): 'success' | 'failure' | 'neutral' | 'cancelled' | 'action_required' | undefined {
    switch (status) {
      case 'applied':
        return 'success';
      case 'planned':
        return 'neutral';
      case 'awaiting_approval':
        return 'action_required';
      case 'plan_failed':
      case 'apply_failed':
        return 'failure';
      case 'cancelled':
      case 'rejected':
        return 'cancelled';
      default:
        return undefined;
    }
  }

  // ===========================================================================
  // Label Management
  // ===========================================================================

  async updateLabels(
    plan: InfrastructurePlan,
  ): Promise<GitOpsResult> {
    if (!plan.pullRequestNumber) {
      return { success: false, errors: ['Plan is not associated with a PR'] };
    }

    // Get repository
    const repoResult = await this.repositoryManager.getRepository(plan.repositoryId);
    if (!repoResult.success || !repoResult.data) {
      return { success: false, errors: ['Repository not found'] };
    }
    const repo = repoResult.data;

    // Get provider client
    const client = this.repositoryManager.getClient(repo.provider);
    if (!client) {
      return { success: false, errors: ['Provider client not configured'] };
    }

    const { planLabelPrefix, applyLabelPrefix } = repo.settings;
    
    // Determine labels to add/remove
    const labelsToAdd: string[] = [];
    const labelsToRemove: string[] = [];

    const statusLabel = `${planLabelPrefix}${plan.status}`;
    labelsToAdd.push(statusLabel);

    // Remove old status labels
    const allStatusLabels = [
      'pending', 'planning', 'planned', 'awaiting_approval',
      'approved', 'applying', 'applied', 'plan_failed', 'apply_failed',
      'rejected', 'cancelled',
    ].map(s => `${planLabelPrefix}${s}`);
    
    labelsToRemove.push(...allStatusLabels.filter(l => l !== statusLabel));

    try {
      if (labelsToRemove.length > 0) {
        await client.removeLabels(repo.owner, repo.name, plan.pullRequestNumber, labelsToRemove)
          .catch(() => {}); // Ignore errors for labels that don't exist
      }
      
      if (labelsToAdd.length > 0) {
        await client.addLabels(repo.owner, repo.name, plan.pullRequestNumber, labelsToAdd);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to update labels: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createPRCommentService(
  repositoryManager: RepositoryManager,
  config?: PRCommentServiceConfig,
  storage?: CommentStorage,
): PRCommentService {
  return new PRCommentService(repositoryManager, config, storage);
}
