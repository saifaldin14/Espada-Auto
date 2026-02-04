/**
 * Approval Workflow Service
 *
 * Multi-stage approval workflows with escalation, timeouts, and
 * integration support for deployment approvals.
 */

import { randomUUID } from 'node:crypto';
import type {
  ApprovalWorkflow,
  ApprovalStage,
  ApprovalRequest,
  StageApproval,
  IndividualApproval,
  ApprovalRequestStatus,
  ApprovalChangesSummary,
  ApproverDefinition,
  CollaborationResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface ApprovalStorage {
  // Workflows
  createWorkflow(workflow: ApprovalWorkflow): Promise<void>;
  getWorkflow(workflowId: string): Promise<ApprovalWorkflow | null>;
  listWorkflows(workspaceId: string, options?: { enabled?: boolean }): Promise<ApprovalWorkflow[]>;
  updateWorkflow(workflowId: string, updates: Partial<ApprovalWorkflow>): Promise<void>;
  deleteWorkflow(workflowId: string): Promise<void>;
  
  // Requests
  createRequest(request: ApprovalRequest): Promise<void>;
  getRequest(requestId: string): Promise<ApprovalRequest | null>;
  listRequests(options: {
    workspaceId?: string;
    projectId?: string;
    status?: ApprovalRequestStatus;
    requestedBy?: string;
  }): Promise<ApprovalRequest[]>;
  updateRequest(requestId: string, updates: Partial<ApprovalRequest>): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryApprovalStorage implements ApprovalStorage {
  private workflows = new Map<string, ApprovalWorkflow>();
  private requests = new Map<string, ApprovalRequest>();

  async createWorkflow(workflow: ApprovalWorkflow): Promise<void> {
    this.workflows.set(workflow.id, workflow);
  }

  async getWorkflow(workflowId: string): Promise<ApprovalWorkflow | null> {
    return this.workflows.get(workflowId) ?? null;
  }

  async listWorkflows(workspaceId: string, options?: { enabled?: boolean }): Promise<ApprovalWorkflow[]> {
    return Array.from(this.workflows.values()).filter(w => {
      if (w.workspaceId !== workspaceId) return false;
      if (options?.enabled !== undefined && w.enabled !== options.enabled) return false;
      return true;
    });
  }

  async updateWorkflow(workflowId: string, updates: Partial<ApprovalWorkflow>): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (workflow) {
      this.workflows.set(workflowId, { ...workflow, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    this.workflows.delete(workflowId);
  }

  async createRequest(request: ApprovalRequest): Promise<void> {
    this.requests.set(request.id, request);
  }

  async getRequest(requestId: string): Promise<ApprovalRequest | null> {
    return this.requests.get(requestId) ?? null;
  }

  async listRequests(options: {
    workspaceId?: string;
    projectId?: string;
    status?: ApprovalRequestStatus;
    requestedBy?: string;
  }): Promise<ApprovalRequest[]> {
    return Array.from(this.requests.values()).filter(r => {
      if (options.workspaceId && r.workspaceId !== options.workspaceId) return false;
      if (options.projectId && r.projectId !== options.projectId) return false;
      if (options.status && r.status !== options.status) return false;
      if (options.requestedBy && r.requestedBy !== options.requestedBy) return false;
      return true;
    });
  }

  async updateRequest(requestId: string, updates: Partial<ApprovalRequest>): Promise<void> {
    const request = this.requests.get(requestId);
    if (request) {
      this.requests.set(requestId, { ...request, ...updates });
    }
  }
}

// =============================================================================
// Approval Service
// =============================================================================

export interface ApprovalServiceConfig {
  defaultTimeoutHours?: number;
}

export class ApprovalService {
  private storage: ApprovalStorage;
  private config: ApprovalServiceConfig;

  constructor(config?: ApprovalServiceConfig, storage?: ApprovalStorage) {
    this.config = config ?? {};
    this.storage = storage ?? new InMemoryApprovalStorage();
  }

  // ===========================================================================
  // Workflow Management
  // ===========================================================================

  async createWorkflow(
    tenantId: string,
    workspaceId: string,
    name: string,
    createdBy: string,
    options?: {
      description?: string;
      projectId?: string;
      stages?: ApprovalStage[];
    },
  ): Promise<CollaborationResult<ApprovalWorkflow>> {
    const now = new Date().toISOString();
    
    const defaultStages: ApprovalStage[] = options?.stages ?? [{
      id: `stage_${randomUUID()}`,
      name: 'Review',
      order: 0,
      approvers: [],
      requiredApprovals: 1,
      timeoutHours: this.config.defaultTimeoutHours ?? 24,
      timeoutAction: 'escalate',
    }];

    const workflow: ApprovalWorkflow = {
      id: `wf_${randomUUID()}`,
      tenantId,
      workspaceId,
      projectId: options?.projectId,
      name,
      description: options?.description,
      stages: defaultStages,
      triggers: [],
      enabled: true,
      createdAt: now,
      updatedAt: now,
      createdBy,
    };

    await this.storage.createWorkflow(workflow);
    return { success: true, data: workflow };
  }

  async getWorkflow(workflowId: string): Promise<CollaborationResult<ApprovalWorkflow>> {
    const workflow = await this.storage.getWorkflow(workflowId);
    if (!workflow) {
      return { success: false, errors: ['Workflow not found'] };
    }
    return { success: true, data: workflow };
  }

  async listWorkflows(
    workspaceId: string,
    options?: { enabledOnly?: boolean },
  ): Promise<CollaborationResult<ApprovalWorkflow[]>> {
    const workflows = await this.storage.listWorkflows(workspaceId, { enabled: options?.enabledOnly });
    return { success: true, data: workflows };
  }

  async updateWorkflow(
    workflowId: string,
    updates: Partial<Pick<ApprovalWorkflow, 'name' | 'description' | 'stages' | 'triggers' | 'enabled'>>,
  ): Promise<CollaborationResult<ApprovalWorkflow>> {
    const workflow = await this.storage.getWorkflow(workflowId);
    if (!workflow) {
      return { success: false, errors: ['Workflow not found'] };
    }

    await this.storage.updateWorkflow(workflowId, updates);
    const updated = await this.storage.getWorkflow(workflowId);
    return { success: true, data: updated! };
  }

  async disableWorkflow(workflowId: string): Promise<CollaborationResult> {
    await this.storage.updateWorkflow(workflowId, { enabled: false });
    return { success: true, message: 'Workflow disabled' };
  }

  // ===========================================================================
  // Approval Requests
  // ===========================================================================

  async requestApproval(
    workflowId: string,
    requestedBy: string,
    metadata: {
      title: string;
      description?: string;
      projectId: string;
      targetType: ApprovalRequest['targetType'];
      targetId: string;
      targetName: string;
      changes: ApprovalChangesSummary;
    },
  ): Promise<CollaborationResult<ApprovalRequest>> {
    const workflow = await this.storage.getWorkflow(workflowId);
    if (!workflow) {
      return { success: false, errors: ['Workflow not found'] };
    }

    if (!workflow.enabled) {
      return { success: false, errors: ['Workflow is not enabled'] };
    }

    const now = new Date().toISOString();
    const sortedStages = [...workflow.stages].sort((a, b) => a.order - b.order);
    const firstStage = sortedStages[0];

    const request: ApprovalRequest = {
      id: `ar_${randomUUID()}`,
      tenantId: workflow.tenantId,
      workspaceId: workflow.workspaceId,
      projectId: metadata.projectId,
      workflowId,
      targetType: metadata.targetType,
      targetId: metadata.targetId,
      targetName: metadata.targetName,
      title: metadata.title,
      description: metadata.description,
      changes: metadata.changes,
      requestedBy,
      requestedAt: now,
      status: 'pending',
      currentStageId: firstStage.id,
      stageApprovals: sortedStages.map(s => ({
        stageId: s.id,
        stageName: s.name,
        status: s.id === firstStage.id ? 'pending' : 'pending',
        approvals: [],
        requiredApprovals: s.requiredApprovals,
      })),
    };

    await this.storage.createRequest(request);
    return { success: true, data: request };
  }

  async getRequest(requestId: string): Promise<CollaborationResult<ApprovalRequest>> {
    const request = await this.storage.getRequest(requestId);
    if (!request) {
      return { success: false, errors: ['Request not found'] };
    }
    return { success: true, data: request };
  }

  async listRequests(options: {
    workspaceId?: string;
    projectId?: string;
    status?: ApprovalRequestStatus;
    requestedBy?: string;
  }): Promise<CollaborationResult<ApprovalRequest[]>> {
    const requests = await this.storage.listRequests(options);
    return { success: true, data: requests };
  }

  async approve(
    requestId: string,
    userId: string,
    userName: string,
    comment?: string,
  ): Promise<CollaborationResult<ApprovalRequest>> {
    const request = await this.storage.getRequest(requestId);
    if (!request) {
      return { success: false, errors: ['Request not found'] };
    }

    if (request.status !== 'pending' && request.status !== 'in_review') {
      return { success: false, errors: ['Request is not pending'] };
    }

    // Find current stage
    const currentStageApproval = request.stageApprovals.find(s => s.stageId === request.currentStageId);
    if (!currentStageApproval) {
      return { success: false, errors: ['Current stage not found'] };
    }

    // Check if already approved by this user
    if (currentStageApproval.approvals.some(a => a.userId === userId)) {
      return { success: false, errors: ['User has already approved this stage'] };
    }

    // Add approval
    const approval: IndividualApproval = {
      userId,
      userName,
      decision: 'approved',
      comment,
      decidedAt: new Date().toISOString(),
    };
    currentStageApproval.approvals.push(approval);

    // Check if stage is complete
    const approvedCount = currentStageApproval.approvals.filter(a => a.decision === 'approved').length;
    if (approvedCount >= currentStageApproval.requiredApprovals) {
      currentStageApproval.status = 'approved';
      currentStageApproval.completedAt = new Date().toISOString();

      // Move to next stage or complete
      const currentIndex = request.stageApprovals.findIndex(s => s.stageId === request.currentStageId);
      const nextStage = request.stageApprovals[currentIndex + 1];
      
      if (nextStage) {
        request.currentStageId = nextStage.stageId;
        request.status = 'in_review';
      } else {
        // All stages complete
        request.status = 'approved';
        request.resolvedAt = new Date().toISOString();
        request.resolvedBy = userId;
        request.resolution = 'approved';
      }
    }

    await this.storage.updateRequest(requestId, request);
    return { success: true, data: request };
  }

  async reject(
    requestId: string,
    userId: string,
    userName: string,
    reason: string,
  ): Promise<CollaborationResult<ApprovalRequest>> {
    const request = await this.storage.getRequest(requestId);
    if (!request) {
      return { success: false, errors: ['Request not found'] };
    }

    if (request.status !== 'pending' && request.status !== 'in_review') {
      return { success: false, errors: ['Request is not pending'] };
    }

    // Find current stage
    const currentStageApproval = request.stageApprovals.find(s => s.stageId === request.currentStageId);
    if (!currentStageApproval) {
      return { success: false, errors: ['Current stage not found'] };
    }

    // Add rejection
    const approval: IndividualApproval = {
      userId,
      userName,
      decision: 'rejected',
      comment: reason,
      decidedAt: new Date().toISOString(),
    };
    currentStageApproval.approvals.push(approval);
    currentStageApproval.status = 'rejected';
    currentStageApproval.completedAt = new Date().toISOString();

    request.status = 'rejected';
    request.resolvedAt = new Date().toISOString();
    request.resolvedBy = userId;
    request.resolution = 'rejected';
    request.resolutionNote = reason;

    await this.storage.updateRequest(requestId, request);
    return { success: true, data: request };
  }

  async cancel(requestId: string, userId: string): Promise<CollaborationResult> {
    const request = await this.storage.getRequest(requestId);
    if (!request) {
      return { success: false, errors: ['Request not found'] };
    }

    if (request.status !== 'pending' && request.status !== 'in_review') {
      return { success: false, errors: ['Only pending requests can be cancelled'] };
    }

    if (request.requestedBy !== userId) {
      return { success: false, errors: ['Only the requester can cancel the request'] };
    }

    await this.storage.updateRequest(requestId, {
      status: 'cancelled',
      resolvedAt: new Date().toISOString(),
      resolution: 'cancelled',
    });

    return { success: true, message: 'Request cancelled' };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createApprovalService(
  config?: ApprovalServiceConfig,
  storage?: ApprovalStorage,
): ApprovalService {
  return new ApprovalService(config, storage);
}
